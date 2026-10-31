"""Local process/configuration safety. No Cacti or backend calls."""
from contextlib import contextmanager, ExitStack
import os
from pathlib import Path
import subprocess
import sys
import errno
import json
import re

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / '.env'
IS_WINDOWS = sys.platform == 'win32'


@contextmanager
def exclusive_lock(path):
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(str(path), flags, 0o600)
    locked = False
    try:
        try:
            if IS_WINDOWS:
                import msvcrt
                # Lock one byte at offset zero; it may extend beyond EOF.
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise
            raise RuntimeError(f'Proses lain masih aktif ({path.name}); hentikan proses lama dahulu.') from error
        yield
    finally:
        try:
            if locked and IS_WINDOWS:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        finally:
            os.close(fd)  # POSIX flock is released by close too.


def fsync_directory(path):
    # Windows cannot open a directory using CRT os.open. File contents are still
    # flushed before os.replace; do not suppress file fsync/replace errors.
    if IS_WINDOWS:
        return
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def install_worker_signals():
    # CREATE_NEW_PROCESS_GROUP allows a targeted Ctrl+Break from the launcher.
    if IS_WINDOWS:
        import signal
        signal.signal(signal.SIGBREAK, signal.default_int_handler)


def legacy_directory(root=ROOT):
    return root.parent / 'integrations' / 'cacti-agent'


def legacy_workers():
    """Legacy collector had no lock; conservatively detect its live command too."""
    if IS_WINDOWS:
        # CIM is available in Windows PowerShell; do not depend on retired wmic.
        powershell = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) /
                         'System32/WindowsPowerShell/v1.0/powershell.exe')
        script = ("$ErrorActionPreference='Stop'; "
                  "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); "
                  "@(Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%' OR Name = 'py.exe'\" | "
                  "Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress")
        try:
            result = subprocess.run([powershell, '-NoProfile', '-NonInteractive', '-Command', script],
                                    capture_output=True, encoding='utf-8-sig', text=True,
                                    check=True, timeout=20)
            processes = json.loads(result.stdout or '[]')
            if processes is None:
                processes = []
            if isinstance(processes, dict):
                processes = [processes]
            pairs = [(int(p['ProcessId']), p.get('CommandLine') or '') for p in processes]
        except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError) as error:
            raise RuntimeError('Pemeriksaan proses Windows gagal. Pastikan Windows PowerShell/Get-CimInstance '
                               'tersedia dan diizinkan; worker tidak dimulai.') from error
    else:
        result = subprocess.run(['ps', '-axo', 'pid=,args='], capture_output=True, text=True, check=True, timeout=20)
        pairs = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) == 2:
                pairs.append((int(fields[0]), fields[1]))
    found = []
    for pid, command in pairs:
        if pid == os.getpid():
            continue
        command = command.replace('\\', '/').lower()
        if ('python' in command and
                ('integrations/cacti-agent/' in command or 'collector_cacti/' in command or
                 re.search(r'''(?:\s|["'])(?:\./)?(?:cactydown|reconcile)\.py(?:["']|\s|$)''', command))):
            found.append(pid)
    return found


def require_no_legacy_workers():
    pids = legacy_workers()
    if pids:
        raise RuntimeError('Agent/collector lama masih berjalan (PID ' + ', '.join(map(str, pids)) +
                           '). Hentikan dengan Ctrl+C sebelum migrasi/launcher baru.')


@contextmanager
def sync_locks(root=ROOT):
    with ExitStack() as stack:
        stack.enter_context(exclusive_lock(root / '.sync.lock'))
        old = legacy_directory(root)
        if old.is_dir():
            stack.enter_context(exclusive_lock(old / '.sync_headers.lock'))
        yield


def require_migrated(root=ROOT):
    old = legacy_directory(root)
    if any(old.glob('*.report.json')) or any(old.glob('*.report.csv')):
        raise RuntimeError('Laporan/jurnal masih di folder lama. Hentikan worker lama lalu jalankan '
                           'python3 cacti_agent/launcher.py --migrate-local.')


def read_config(path=ENV_FILE):
    if not path.is_file():
        raise RuntimeError('cacti_agent/.env belum ada; migrasikan konfigurasi lama atau isi dari .env.example.')
    return {k: v for k, v in dotenv_values(path, interpolate=False, encoding='utf-8-sig').items() if v is not None}


def worker_environment(config):
    env = dict(os.environ)
    env.update(config)
    # Explicit aliases retain separate DATIN monitoring accounts when provided.
    env.setdefault('HDWORK_URL', env.get('HDWORK_BASE_URL', '').rstrip('/') + '/api/cactys/cacti')
    for server in ('SBS', 'SBU'):
        for suffix in ('BASE_URL', 'USERNAME', 'PASSWORD'):
            key = f'DATIN_{server}_{suffix}'
            if not env.get(key):
                env[key] = env.get(f'CACTI_{server}_{suffix}', '')
    env.update(PYTHONUNBUFFERED='1', PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
    return env


def validate_environment(env):
    from urllib.parse import urlparse
    required = ['HDWORK_BASE_URL', 'DATIN_CACTI_AGENT_API_KEY', 'HDWORK_API_KEY']
    required += [f'CACTI_{s}_{k}' for s in ('SBS', 'SBU') for k in ('USERNAME', 'PASSWORD')]
    required += [f'{kind}_{s}_{k}' for kind in ('DATIN', 'NODEB') for s in ('SBS', 'SBU')
                 for k in ('BASE_URL', 'USERNAME', 'PASSWORD')]
    missing = [k for k in required if not env.get(k, '').strip()]
    if missing:
        raise RuntimeError('Konfigurasi belum lengkap: ' + ', '.join(missing))
    for key in ('HDWORK_BASE_URL', 'HDWORK_URL'):
        url = urlparse(env.get(key, ''))
        if url.scheme != 'https' or not url.netloc or url.username or url.password:
            raise RuntimeError(f'{key} wajib URL HTTPS backend tanpa kredensial di URL.')
    for key, default, minimum in (('SYNC_INTERVAL_SECONDS', 600, 600),
                                  ('COLLECTOR_INTERVAL_SECONDS', 300, 1),
                                  ('WORKER_RESTART_SECONDS', 10, 1)):
        try:
            value = int(env.get(key, str(default)))
            if value < minimum:
                raise ValueError()
        except ValueError as error:
            raise RuntimeError(f'{key} harus bilangan bulat minimal {minimum}.') from error


def migrate_local(root=ROOT):
    """Explicit offline cutover. Never overwrite config/journal or start workers."""
    require_no_legacy_workers()
    old = legacy_directory(root)
    with exclusive_lock(root / '.launcher.lock'), sync_locks(root), exclusive_lock(root / '.collector.lock'):
        target = root / '.env'
        sources = [old / '.env', root.parent / 'collector_cacti' / '.env']
        merged = {}
        for source in sources:
            if target.exists():
                break  # Explicitly resolved new config wins over old conflicts.
            if not source.is_file():
                continue
            for key, value in read_config(source).items():
                if key in merged and merged[key] != value:
                    raise RuntimeError(f'Konfigurasi lama bentrok pada {key}; satukan manual ke cacti_agent/.env.')
                merged[key] = value
        if not target.exists():
            if not merged:
                raise RuntimeError('Tidak ada .env lama untuk dimigrasikan; isi cacti_agent/.env dahulu.')
            merged.setdefault('CACTI_SBS_BASE_URL', 'http://10.96.33.156/ont')
            merged.setdefault('CACTI_SBU_BASE_URL', 'http://10.100.2.234/ont')
            merged.setdefault('SYNC_INTERVAL_SECONDS', '600')
            # JSON quoting is compatible with dotenv, except literal $ expansion is disabled.
            import json
            fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                for key, value in merged.items():
                    handle.write(key + '=' + json.dumps(value, ensure_ascii=False) + '\n')
                handle.flush()
                os.fsync(handle.fileno())
        # Existing new config is authoritative: never overwrite manual corrections.
        sync = root / 'sync'
        sync.mkdir(exist_ok=True)
        reports = sorted([*old.glob('*.report.json'), *old.glob('*.report.csv')])
        if any((sync / source.name).exists() for source in reports):
            raise RuntimeError('Ada nama jurnal/laporan ganda; tinjau kedua folder, jangan menimpa jurnal.')
        for source in reports:
            os.replace(source, sync / source.name)
            os.chmod(sync / source.name, 0o600)
        fsync_directory(sync)
        return len(reports)
