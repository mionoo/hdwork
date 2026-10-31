"""Start independent SYNC and COLLECTOR workers using one private .env."""
import argparse
from contextlib import ExitStack
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

from agent_support import (ROOT, IS_WINDOWS, exclusive_lock, migrate_local, read_config, require_migrated,
                           require_no_legacy_workers, sync_locks, validate_environment,
                           worker_environment)


def commands(root, env):
    return {
        'SYNC': [sys.executable, '-u', str(root / 'sync/reconcile.py'), '--watch', '--apply',
                 '--interval', env.get('SYNC_INTERVAL_SECONDS', '600'), '--env-file', str(root / '.env')],
        'COLLECTOR': [sys.executable, '-u', str(root / 'collector/cactydown.py')],
    }


def print_output(name, stream):
    try:
        for line in iter(stream.readline, ''):
            print(f'[{name}] {line.rstrip()}', flush=True)
    finally:
        stream.close()


def worker_process_options():
    if IS_WINDOWS:
        return {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP}
    return {'start_new_session': True}


def interrupt_worker(process):
    if process.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGINT)
    except ProcessLookupError:
        pass
    except OSError:
        # Never silently abandon a live worker. If console signalling is denied,
        # leave it time to exit, then stop_process escalates using its own handle.
        print('[LAUNCHER] Sinyal berhenti belum terkirim; menunggu sebelum penghentian paksa.', flush=True)


def stop_process(process, timeout=40, already_signalled=False):
    if process.poll() is not None:
        return
    # Both workers get a graceful interrupt first; journal writes are atomic.
    if not already_signalled:
        interrupt_worker(process)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        print('[LAUNCHER] Worker belum berhenti; hentikan proses. Jurnal dipertahankan.', flush=True)
        try:
            if IS_WINDOWS:
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                if IS_WINDOWS:
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def supervise(root, env, stopped):
    workers, readers = {}, []
    retry_at = {name: 0 for name in commands(root, env)}
    delay = int(env.get('WORKER_RESTART_SECONDS', '10'))
    try:
        while not stopped.is_set():
            for name, command in commands(root, env).items():
                process = workers.get(name)
                if process is not None:
                    code = process.poll()
                    if code is None:
                        continue
                    print(f'[{name}] Proses berhenti (exit {code}); coba lagi dalam {delay} detik.', flush=True)
                    workers.pop(name)
                    retry_at[name] = time.monotonic() + delay
                if stopped.is_set() or time.monotonic() < retry_at[name]:
                    continue
                try:
                    process = subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.PIPE,
                                               stderr=subprocess.STDOUT, text=True, encoding='utf-8',
                                               errors='replace', bufsize=1, **worker_process_options())
                except OSError:
                    print(f'[{name}] Tidak dapat memulai worker; coba lagi dalam {delay} detik.', flush=True)
                    retry_at[name] = time.monotonic() + delay
                    continue
                workers[name] = process
                reader = threading.Thread(target=print_output, args=(name, process.stdout), daemon=True)
                reader.start()
                readers = [r for r in readers if r.is_alive()]
                readers.append(reader)
                print(f'[{name}] Worker dimulai (PID {process.pid}).', flush=True)
            stopped.wait(0.25)
    finally:
        # Signal both first so a slow sync shutdown does not delay the collector.
        for process in workers.values():
            interrupt_worker(process)
        for process in workers.values():
            stop_process(process, already_signalled=True)
        for reader in readers:
            reader.join(timeout=2)
        print('[LAUNCHER] Kedua worker berhenti; progres sync tetap tersimpan.', flush=True)


def main():
    # Windows console code pages/piped logs must not crash on collector emoji.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Validate local configuration only; no network or workers')
    mode.add_argument('--migrate-local', action='store_true', help='Offline: merge old .env and MOVE journals; start no workers')
    args = parser.parse_args()
    try:
        if args.migrate_local:
            count = migrate_local()
            print(f'[LAUNCHER] Migrasi lokal selesai: {count} laporan/jurnal dipindahkan. .env lama tetap sebagai cadangan.')
            return 0
        require_no_legacy_workers()
        env = worker_environment(read_config())
        validate_environment(env)
        require_migrated()
        # Check neither a launcher nor standalone new/old workers already own the files.
        with exclusive_lock(ROOT / '.launcher.lock'):
            with ExitStack() as preflight:
                preflight.enter_context(sync_locks())
                preflight.enter_context(exclusive_lock(ROOT / '.collector.lock'))
            if args.check:
                print('[LAUNCHER] Konfigurasi lokal dan lock valid. Tidak ada akses jaringan atau worker dimulai.')
                return 0
            stopped = threading.Event()
            previous = {}
            signals = [signal.SIGINT, signal.SIGTERM]
            if IS_WINDOWS:
                signals.append(signal.SIGBREAK)
            for sig in signals:
                previous[sig] = signal.signal(sig, lambda *_: stopped.set())
            try:
                supervise(ROOT, env, stopped)
            finally:
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
        return 0
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        # Configuration validation reports variable names, never secret values.
        print(f'[LAUNCHER] {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
