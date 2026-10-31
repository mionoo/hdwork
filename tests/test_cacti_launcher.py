"""Local supervisor and offline migration tests; never connect to Cacti/backend."""
import contextlib
import errno
import io
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cacti_agent'))
import agent_support as support
import launcher


def config():
    values = {'HDWORK_BASE_URL': 'https://backend.example', 'HDWORK_API_KEY': 'collector-key',
              'DATIN_CACTI_AGENT_API_KEY': 'sync-key'}
    for server in ('SBS', 'SBU'):
        for kind in ('CACTI', 'NODEB'):
            values.update({f'{kind}_{server}_BASE_URL': 'http://cacti.example/ont',
                           f'{kind}_{server}_USERNAME': 'user', f'{kind}_{server}_PASSWORD': 'password'})
    return values


class ConfigurationTests(unittest.TestCase):
    def test_one_env_and_distinct_keys_and_accounts(self):
        values = config()
        values['DATIN_SBS_USERNAME'] = 'monitor-only'
        with patch.dict(os.environ, {}, clear=True):
            env = support.worker_environment(values)
        support.validate_environment(env)
        self.assertEqual(env['HDWORK_URL'], 'https://backend.example/api/cactys/cacti')
        self.assertEqual(env['DATIN_SBU_USERNAME'], 'user')
        self.assertEqual(env['DATIN_SBS_USERNAME'], 'monitor-only')
        self.assertNotEqual(env['HDWORK_API_KEY'], env['DATIN_CACTI_AGENT_API_KEY'])

    def test_config_file_overrides_inherited_environment_without_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / '.env'
            file.write_text('SECRET="literal${HOME}value"\nHDWORK_API_KEY=new\n')
            with patch.dict(os.environ, {'HDWORK_API_KEY': 'old'}):
                env = support.worker_environment(support.read_config(file))
            self.assertEqual(env['SECRET'], 'literal${HOME}value')
            self.assertEqual(env['HDWORK_API_KEY'], 'new')

    def test_missing_and_bad_intervals_fail_without_secret_values(self):
        for key, value in [('SYNC_INTERVAL_SECONDS', '599'), ('COLLECTOR_INTERVAL_SECONDS', '0'),
                           ('WORKER_RESTART_SECONDS', 'bad'), ('HDWORK_BASE_URL', 'http://backend.example')]:
            with patch.dict(os.environ, {}, clear=True):
                env = support.worker_environment({**config(), key: value})
            with self.assertRaises(RuntimeError) as error:
                support.validate_environment(env)
            self.assertIn(key, str(error.exception))
            self.assertNotIn('sync-key', str(error.exception))
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'DATIN_CACTI_AGENT_API_KEY'):
                support.validate_environment(support.worker_environment({}))

    def test_command_paths_absolute_and_shared_env_and_current_interpreter(self):
        root = Path('/tmp/a folder/cacti_agent')
        commands = launcher.commands(root, {'SYNC_INTERVAL_SECONDS': '900'})
        self.assertEqual(commands['SYNC'][0], sys.executable)
        self.assertIn(str(root / '.env'), commands['SYNC'])
        self.assertIn('900', commands['SYNC'])
        self.assertIn('--apply', commands['SYNC'])
        self.assertEqual(commands['COLLECTOR'][-1], str(root / 'collector/cactydown.py'))


class MigrationTests(unittest.TestCase):
    def setup_tree(self, directory):
        base = Path(directory)
        root = base / 'cacti_agent'
        root.mkdir()
        (root / 'sync').mkdir()
        old = base / 'integrations/cacti-agent'
        old.mkdir(parents=True)
        collector = base / 'collector_cacti'
        collector.mkdir()
        return root, old, collector

    def test_merge_and_move_active_journal_without_changing_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old, collector = self.setup_tree(directory)
            (old / '.env').write_text('DATIN_CACTI_AGENT_API_KEY="secret${literal}"\n')
            (collector / '.env').write_text('HDWORK_API_KEY=another-secret\n')
            # Example files must never be considered runtime credentials.
            (old / '.env.example').write_text('DONT_IMPORT=credential\n')
            journal = {'run_id': 'r', 'token': 'private', 'jobs': [{'status': 'ATTEMPTED'}]}
            (old / 'reconcile-active.report.json').write_text(json.dumps(journal))
            with patch.object(support, 'require_no_legacy_workers'):
                count = support.migrate_local(root)
                self.assertEqual(support.migrate_local(root), 0)
            self.assertEqual(count, 1)
            self.assertEqual(json.loads((root / 'sync/reconcile-active.report.json').read_text()), journal)
            self.assertFalse((old / 'reconcile-active.report.json').exists())
            self.assertTrue((old / '.env').exists())
            values = support.read_config(root / '.env')
            self.assertEqual(values['DATIN_CACTI_AGENT_API_KEY'], 'secret${literal}')
            self.assertEqual(values['HDWORK_API_KEY'], 'another-secret')
            self.assertNotIn('DONT_IMPORT', values)
            if os.name != 'nt':
                self.assertEqual((root / '.env').stat().st_mode & 0o777, 0o600)
                self.assertEqual((root / 'sync/reconcile-active.report.json').stat().st_mode & 0o777, 0o600)

    def test_conflicting_env_fails_no_secret_leak_or_journal_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old, collector = self.setup_tree(directory)
            (old / '.env').write_text('KEY=first-secret\n')
            (collector / '.env').write_text('KEY=second-secret\n')
            journal = old / 'reconcile-active.report.json'
            journal.write_text('{}')
            with patch.object(support, 'require_no_legacy_workers'):
                with self.assertRaisesRegex(RuntimeError, 'KEY') as error:
                    support.migrate_local(root)
            self.assertNotIn('first-secret', str(error.exception))
            self.assertFalse((root / '.env').exists())
            self.assertTrue(journal.exists())

    def test_resolved_new_env_wins_and_duplicate_journal_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old, collector = self.setup_tree(directory)
            (old / '.env').write_text('KEY=old\n')
            (collector / '.env').write_text('KEY=conflict\n')
            (root / '.env').write_text('KEY=resolved\n')
            (old / 'reconcile-active.report.json').write_text('old')
            (root / 'sync/reconcile-active.report.json').write_text('new')
            with patch.object(support, 'require_no_legacy_workers'):
                with self.assertRaisesRegex(RuntimeError, 'ganda'):
                    support.migrate_local(root)
            self.assertEqual((root / '.env').read_text(), 'KEY=resolved\n')
            self.assertEqual((root / 'sync/reconcile-active.report.json').read_text(), 'new')
            self.assertEqual((old / 'reconcile-active.report.json').read_text(), 'old')

    def test_legacy_or_new_worker_lock_blocks_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old, collector = self.setup_tree(directory)
            (old / '.env').write_text('KEY=value\n')
            for lock in (old / '.sync_headers.lock', root / '.sync.lock', root / '.collector.lock'):
                with support.exclusive_lock(lock), patch.object(support, 'require_no_legacy_workers'):
                    with self.assertRaisesRegex(RuntimeError, 'masih aktif'):
                        support.migrate_local(root)
            self.assertFalse((root / '.env').exists())

    def test_pending_legacy_journal_blocks_new_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            root, old, _ = self.setup_tree(directory)
            (old / 'reconcile-active.report.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'migrate-local'):
                support.require_migrated(root)

    def test_legacy_process_detection_redacts_command_and_blocks(self):
        output = '123 python3 integrations/cacti-agent/reconcile.py --watch\n124 python3 collector_cacti/cactydown.py\n125 python3 cacti_agent/launcher.py\n'
        with patch.object(support.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, output)):
            self.assertEqual(support.legacy_workers(), [123, 124])
            with self.assertRaisesRegex(RuntimeError, '123, 124'):
                support.require_no_legacy_workers()


class SupervisorTests(unittest.TestCase):
    def test_restart_one_worker_and_independent_collector_then_graceful_shutdown(self):
        # Real local subprocesses, synthetic scripts only. First worker exits once
        # then remains alive; collector keeps running throughout that restart.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / 'started'
            script = """import pathlib, signal, sys, time
p = pathlib.Path(sys.argv[1])
if not p.exists():
    p.write_text('once')
    print('first exit', flush=True)
    sys.exit(3)
signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
if hasattr(signal, 'SIGBREAK'): signal.signal(signal.SIGBREAK, lambda *_: sys.exit(0))
print('restarted', flush=True)
while True: time.sleep(.05)
"""
            collector = "import signal,sys,time\nsignal.signal(signal.SIGINT,lambda *_:sys.exit(0))\nif hasattr(signal,'SIGBREAK'): signal.signal(signal.SIGBREAK,lambda *_:sys.exit(0))\nprint('collecting',flush=True)\ntime.sleep(30)"
            commands = {'SYNC': [sys.executable, '-u', '-c', script, str(marker)],
                        'COLLECTOR': [sys.executable, '-u', '-c', collector]}
            stopped = threading.Event()
            timer = threading.Timer(2, stopped.set)
            output = io.StringIO()
            timer.start()
            try:
                with patch.object(launcher, 'commands', return_value=commands), contextlib.redirect_stdout(output):
                    launcher.supervise(root, {**os.environ, 'WORKER_RESTART_SECONDS': '1'}, stopped)
            finally:
                stopped.set()
                timer.cancel()
            log = output.getvalue()
            self.assertIn('[SYNC] first exit', log)
            self.assertIn('[SYNC] restarted', log)
            self.assertIn('[COLLECTOR] collecting', log)
            self.assertEqual(log.count('[COLLECTOR] Worker dimulai'), 1)
            self.assertIn('Kedua worker berhenti', log)

    def test_check_does_not_start_workers_or_access_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'read_config', return_value=config()), \
                    patch.object(launcher, 'require_no_legacy_workers'), patch.object(launcher, 'require_migrated'), \
                    patch.object(launcher, 'sync_locks', return_value=contextlib.nullcontext()), \
                    patch.object(launcher, 'supervise') as supervise, \
                    patch.object(sys, 'argv', ['launcher.py', '--check']), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(launcher.main(), 0)
                supervise.assert_not_called()


class WindowsCompatibilityTests(unittest.TestCase):
    def test_windows_cim_process_scan_handles_backslashes_quotes_and_single_object(self):
        processes = [{'ProcessId': 123, 'CommandLine': r'"C:\Python\python.exe" "D:\BOT\integrations\cacti-agent\reconcile.py" --watch'},
                     {'ProcessId': 124, 'CommandLine': r'python .\cactydown.py'},
                     {'ProcessId': 125, 'CommandLine': r'python D:\BOT\cacti_agent\sync\reconcile.py --watch'},
                     {'ProcessId': 126, 'CommandLine': None}]
        with patch.object(support, 'IS_WINDOWS', True), \
                patch.object(support.subprocess, 'run', return_value=Mock(stdout=json.dumps(processes))) as run:
            self.assertEqual(support.legacy_workers(), [123, 124])
            self.assertIn('powershell.exe', run.call_args.args[0][0].lower())
            self.assertIn('Get-CimInstance', run.call_args.args[0][-1])
            self.assertNotIn('ps', run.call_args.args[0])
            run.return_value = Mock(stdout=json.dumps(processes[0]))
            self.assertEqual(support.legacy_workers(), [123])
            for empty in ('', '[]', 'null'):
                run.return_value = Mock(stdout=empty)
                self.assertEqual(support.legacy_workers(), [])

    def test_process_scan_errors_fail_closed_without_dumping_processes(self):
        for failure in (FileNotFoundError(), subprocess.TimeoutExpired('powershell', 20),
                        subprocess.CalledProcessError(1, 'powershell', stderr='private-output')):
            with patch.object(support, 'IS_WINDOWS', True), \
                    patch.object(support.subprocess, 'run', side_effect=failure):
                with self.assertRaisesRegex(RuntimeError, 'worker tidak dimulai') as error:
                    support.legacy_workers()
                self.assertNotIn('private-output', str(error.exception))

    def test_msvcrt_lock_unlock_and_contention(self):
        fake = SimpleNamespace(LK_NBLCK=2, LK_UNLCK=0, locking=Mock())
        with tempfile.TemporaryDirectory() as directory, patch.object(support, 'IS_WINDOWS', True), \
                patch.dict(sys.modules, {'msvcrt': fake}):
            file = Path(directory) / '.sync.lock'
            with support.exclusive_lock(file):
                self.assertEqual(fake.locking.call_args.args[1:], (2, 1))
            self.assertEqual(fake.locking.call_args.args[1:], (0, 1))
            fake.locking.reset_mock()
            fake.locking.side_effect = OSError(errno.EACCES, 'locked')
            with self.assertRaisesRegex(RuntimeError, 'masih aktif'):
                with support.exclusive_lock(file):
                    self.fail('must not acquire')
            self.assertEqual(fake.locking.call_count, 1)
            fake.locking.side_effect = OSError(errno.EIO, 'io')
            with self.assertRaises(OSError):
                with support.exclusive_lock(file):
                    self.fail('must not hide IO failures')

    def test_new_process_group_and_targeted_break_no_posix_kill(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(launcher, 'IS_WINDOWS', True), \
                patch.object(subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True), \
                patch.object(signal, 'CTRL_BREAK_EVENT', 1, create=True), \
                patch.object(os, 'killpg', create=True) as killpg:
            self.assertEqual(launcher.worker_process_options(), {'creationflags': 512})
            launcher.stop_process(process)
            process.send_signal.assert_called_once_with(1)
            process.wait.assert_called_once_with(timeout=40)
            process.terminate.assert_not_called()
            killpg.assert_not_called()

    def test_windows_timeout_escalates_only_owned_process(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('worker', 40), subprocess.TimeoutExpired('worker', 5), 0]
        with patch.object(launcher, 'IS_WINDOWS', True), \
                patch.object(os, 'killpg', create=True) as killpg, contextlib.redirect_stdout(io.StringIO()):
            launcher.stop_process(process, already_signalled=True)
            process.terminate.assert_called_once()
            process.kill.assert_called_once()
            killpg.assert_not_called()

    def test_break_handler_translates_to_keyboard_interrupt(self):
        with patch.object(support, 'IS_WINDOWS', True), \
                patch.object(signal, 'SIGBREAK', 21, create=True), patch.object(signal, 'signal') as handler:
            support.install_worker_signals()
            handler.assert_called_once_with(21, signal.default_int_handler)

    def test_windows_journal_flushes_file_but_does_not_open_directory(self):
        import bulk_sync
        with tempfile.TemporaryDirectory() as directory, patch.object(support, 'IS_WINDOWS', True), \
                patch.object(os, 'fsync', wraps=os.fsync) as fsync, \
                patch.object(os, 'open', wraps=os.open) as opened:
            path = Path(directory) / 'journal.report.json'
            bulk_sync.durable(path, {'name': 'Instansi é', 'token': 'private'})
            bulk_sync.durable(path, {'name': 'Instansi é', 'token': 'same', 'phase': 'ATTEMPTED'})
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['phase'], 'ATTEMPTED')
            self.assertEqual(fsync.call_count, 2)
            self.assertTrue(all(str(call.args[0]) != directory for call in opened.call_args_list))
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_notepad_bom_and_utf8_child_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('HDWORK_BASE_URL=https://backend.example\nSECRET=é\n', encoding='utf-8-sig')
            config = support.read_config(path)
            self.assertIn('HDWORK_BASE_URL', config)
            self.assertEqual(config['SECRET'], 'é')
            self.assertEqual(support.worker_environment(config)['PYTHONIOENCODING'], 'utf-8')

    def test_agent_folder_runs_without_backend_repository_or_credentials(self):
        source = Path(__file__).resolve().parents[1] / 'cacti_agent'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'folder with spaces/cacti_agent'
            shutil.copytree(source, root, ignore=shutil.ignore_patterns('.env', '*.report.*', '*.lock', '__pycache__'))
            for script in ('launcher.py', 'sync/reconcile.py'):
                result = subprocess.run([sys.executable, str(root / script), '--help'], cwd=directory,
                                        capture_output=True, text=True, encoding='utf-8', timeout=20,
                                        env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('usage:', result.stdout)


if __name__ == '__main__':
    unittest.main()
