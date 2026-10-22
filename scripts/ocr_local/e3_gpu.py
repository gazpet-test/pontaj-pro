"""Coordonare E3 și reconciliere WSL. Nicio comandă derivată din conținutul OCR."""
import contextlib
import datetime as dt
import http.client
import json
import math
import os
import pathlib
import socket
import subprocess
import time
import uuid
from .client import save
from .e3_contract import E3Error


@contextlib.contextmanager
def mutex(path):
    """Lacăt OS eliberat și la crash; serializează instanțele E3, nu lacătele laboratorului."""
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('a+b') as f:
        if not p.stat().st_size:
            f.write(b'0')
            f.flush()
        f.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise E3Error('ocupat') from None
        try:
            yield
        finally:
            f.seek(0)
            if os.name == 'nt':
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(f, fcntl.LOCK_UN)


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return kernel.GetLastError() == 5  # access denied ≠ proces dispărut
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        try:
            code = ctypes.c_ulong()
            return not kernel.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def boot_time():
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
        return time.time() - ctypes.windll.kernel32.GetTickCount64() / 1000
    return time.time() - float(pathlib.Path('/proc/uptime').read_text().split()[0])


def process_start(pid):
    """Identitatea procesului: PID-ul singur poate fi reutilizat după crash."""
    if not isinstance(pid, int) or pid <= 0:
        return None
    if os.name == 'nt':
        import ctypes as c
        from ctypes import wintypes as w
        kernel = c.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        kernel.OpenProcess.restype = w.HANDLE
        kernel.CloseHandle.argtypes = [w.HANDLE]
        kernel.GetProcessTimes.argtypes = [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return None
        try:
            times = [w.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(handle, *(c.byref(t) for t in times)):
                return None
            return ((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime) / 10000000 - 11644473600
        finally:
            kernel.CloseHandle(handle)
    try:
        ticks = int(pathlib.Path('/proc/%s/stat' % pid).read_text().rsplit(')', 1)[1].split()[19])
        boot = next(line.split()[1] for line in pathlib.Path('/proc/stat').read_text().splitlines() if line.startswith('btime '))
        return int(boot) + ticks / os.sysconf('SC_CLK_TCK')
    except (OSError, ValueError, IndexError, StopIteration):
        return None


class GpuLock:
    def __init__(self, path, *, alive=pid_alive, boot=boot_time, clock=time.time, start=process_start):
        self.path, self.alive, self.boot, self.clock = pathlib.Path(path), alive, boot, clock
        self.start = start
        self.token = uuid.uuid4().hex

    def claim(self):
        with mutex(str(self.path) + '.coord'):
            if self.path.exists():
                try:
                    old = json.loads(self.path.read_text(encoding='utf-8'))
                except ValueError:
                    # Sub .coord nu există un writer E3 viu; JSON-ul rupt este un crash vechi.
                    old = None
                except OSError:
                    return False
                if isinstance(old, dict):
                    if old.get('detinator') != 'e3_serviciu' or old.get('gazda') != socket.gethostname():
                        return False
                    pid = old.get('pid')
                    actual_start = self.start(pid)
                    recorded_start = old.get('proces_pornit_la')
                    since = old.get('pornit_la')
                    stale = (not self.alive(pid) or not isinstance(since, (int, float)) or not math.isfinite(since)
                             or since < self.boot()
                             or (actual_start is not None and
                                 (actual_start != recorded_start if recorded_start is not None else actual_start > since)))
                    if not stale:
                        return old.get('token') == self.token
                self.path.unlink()
            # save = temp + flush/fsync + os.replace; fără fereastră cu lock JSON parțial.
            pending = self.path.with_name(self.path.name + '.pending')
            save(pending, {'detinator': 'e3_serviciu', 'pid': os.getpid(), 'pornit_la': self.clock(),
                           'proces_pornit_la': self.start(os.getpid()),
                           'gazda': socket.gethostname(), 'token': self.token})
            try:
                if os.name == 'nt':
                    os.rename(pending, self.path)  # Windows: atomic, refuză destinația existentă.
                else:
                    os.link(pending, self.path)  # POSIX rename ar suprascrie lacătul laboratorului.
            except FileExistsError:
                return False
            finally:
                pending.unlink(missing_ok=True)
            return True

    def release(self):
        with mutex(str(self.path) + '.coord'):
            try:
                old = json.loads(self.path.read_text(encoding='utf-8'))
                if old.get('token') == self.token and old.get('detinator') == 'e3_serviciu':
                    self.path.unlink()
            except FileNotFoundError:
                pass


class WslModels:
    """Config locală verificată de operator: interpretoare WSL și fracții VRAM măsurate.

    Nu reutilizăm cele două valori 0.85 din protocol: împreună ar depăși GPU-ul.
    """
    def __init__(self, config, protocol):
        self.config, self.protocol = config, protocol
        self.verified = {}
        models = config['modele']
        if set(models) != {'lighton', 'mineru'} or sum(v['gpu_memory_utilization'] for v in models.values()) > .85:
            raise E3Error('config_memorie')
        if any(not .05 <= v['gpu_memory_utilization'] <= .8 for v in models.values()):
            raise E3Error('config_memorie')
        self.baseline = config['vram_baza_mb']

    def wsl(self, args, timeout=15):
        command = ['wsl.exe']
        if self.config.get('distributie'):
            command += ['--distribution', self.config['distributie']]
        result = subprocess.run(command + ['--exec'] + args, capture_output=True, timeout=timeout,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise E3Error('vllm_control')
        return result.stdout.decode('utf-8').strip()

    def py(self, code, *args):
        return self.wsl([self.config['python_control'], '-c', code, *map(str, args)])

    def processes(self):
        code = "import pathlib,json,sys; roots=json.loads(sys.argv[1]); out={k:[] for k in roots}\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit(): continue\n try: a=(p/'cmdline').read_bytes().decode().split('\\0')\n except (OSError,UnicodeError): continue\n if 'serve' not in a or not any(pathlib.Path(x).name=='vllm' for x in a[:2]): continue\n for k,r in roots.items():\n  if r in a: out[k].append(int(p.name))\nprint(json.dumps(out))"
        return json.loads(self.py(code, json.dumps({k: v['served_root'] for k, v in self.protocol['readers'].items()})))

    def healthy(self, name):
        from .read import verify_server, endpoint_parts
        cfg = self.protocol['readers'][name]
        host, port = endpoint_parts(cfg['endpoint'])
        c = http.client.HTTPConnection(host, port, timeout=2)
        try:
            c.request('GET', '/health')
            response = c.getresponse()
            response.read()
            return response.status == 200 and verify_server(cfg)
        except Exception:
            return False
        finally:
            c.close()

    def verify(self, name):
        from .read import verify_weights
        cfg = self.protocol['readers'][name]
        p = pathlib.Path(cfg['weights'])
        signature = (p.stat().st_mtime_ns, p.stat().st_size)
        if self.verified.get(name) != signature:
            verify_weights(cfg)
            self.verified[name] = signature

    def start(self, name):
        cfg, local = self.protocol['readers'][name], self.config['modele'][name]
        from .read import endpoint_parts
        _, port = endpoint_parts(cfg['endpoint'])
        args = [str(pathlib.PurePosixPath(local['python']).parent / 'vllm'), 'serve', cfg['served_root'],
                '--host', '127.0.0.1', '--port', str(port), '--tensor-parallel-size', '1',
                '--gpu-memory-utilization', str(local['gpu_memory_utilization']), '--max-model-len',
                '16384' if name == 'lighton' else '8192', '--max-num-seqs', '1', '--served-model-name', cfg['served_model_name']]
        code = "import subprocess,json,sys; p=subprocess.Popen(json.loads(sys.argv[1]),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); print(p.pid)"
        return int(self.py(code, json.dumps(args)))

    def stop(self, name, pids):
        # Revalidează PID-urile înainte de signal; nu opri alt proces după reutilizarea unui PID.
        current = self.processes()[name]
        targets = [p for p in pids if p in current]
        code = "import os,signal,json,sys\nfor pid in json.loads(sys.argv[1]):\n try:\n  if os.getpgid(pid)==pid: os.killpg(pid,signal.SIGKILL)\n  else: os.kill(pid,signal.SIGKILL)\n except ProcessLookupError: pass"
        self.py(code, json.dumps(targets))

    def memory_mb(self):
        raw = self.wsl(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'])
        return max(float(v) for v in raw.splitlines())


class Coordinator:
    def __init__(self, lock, models, state_path, *, clock=time.time):
        self.lock, self.models, self.path, self.clock = lock, models, pathlib.Path(state_path), clock
        self.last_lab = float('-inf')
        self.restart_requested = False

    def invalidate(self):
        self.restart_requested = True

    def reconcile(self, night):
        if self.clock() - self.last_lab < 300:
            return 'ocupat'
        if not self.lock.claim():
            self.last_lab = self.clock()
            return 'ocupat'
        running = self.models.processes()
        if night:
            for name, pids in running.items():
                if pids:
                    self.models.stop(name, pids)
            if any(self.models.processes().values()) or self.models.memory_mb() >= self.models.baseline + 1024:
                return 'eroare'  # păstrează lock-ul până se dovedește oprirea
            save(self.path, {})
            self.lock.release()
            return 'noapte'
        restart = self.restart_requested
        self.restart_requested = False
        try:
            old = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            old = {}
        state, ready = {}, True
        for name, cfg in self.models.protocol['readers'].items():
            self.models.verify(name)
            prior = old.get(name, {})
            pids = running[name]
            adopt = (not restart and len(pids) == 1 and prior.get('pid') == pids[0] and
                     prior.get('sha') == cfg['weights_sha256'] and self.models.healthy(name))
            # Un model pornit de această instanță poate fi încă în încălzire.
            warming = (not restart and len(pids) == 1 and prior.get('pid') == pids[0] and prior.get('sha') == cfg['weights_sha256']
                       and prior.get('starter') == self.lock.token and self.clock() - prior.get('pornit_la', 0) < 240)
            if adopt or warming:
                state[name] = prior
                ready &= adopt
            else:
                if pids:
                    self.models.stop(name, pids)
                state[name] = {'pid': self.models.start(name), 'pornit_la': self.clock(),
                               'sha': cfg['weights_sha256'], 'starter': self.lock.token}
                ready = False
            # Persistă fiecare pornire: o cădere între modele nu pierde identitatea primului.
            save(self.path, {**old, **state})
        save(self.path, state)
        return 'disponibil' if ready else 'pornire'
