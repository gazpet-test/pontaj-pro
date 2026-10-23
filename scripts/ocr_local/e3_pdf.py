"""Validare și randare PDF numai în copii terminabili, cu limite de resurse."""
import multiprocessing
import threading
from .e3_contract import E3Error

MAX_PIXELS = 25000000
MAX_MEMORY = 768 * 1024 * 1024


def limite_memorie():
    if __import__('os').name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY, MAX_MEMORY))
        return None
    # Job Object limitează inclusiv alocările native PyMuPDF pe Windows.
    import ctypes as c
    from ctypes import wintypes as w
    class Basic(c.Structure):
        _fields_ = [('process_time', c.c_int64), ('job_time', c.c_int64),
                    ('flags', w.DWORD), ('min_ws', c.c_size_t), ('max_ws', c.c_size_t),
                    ('active', w.DWORD), ('affinity', c.c_size_t),
                    ('priority', w.DWORD), ('scheduling', w.DWORD)]
    class IO(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in ('ro', 'wo', 'oo', 'rb', 'wb', 'ob')]
    class Limits(c.Structure):
        _fields_ = [('basic', Basic), ('io', IO), ('process_memory', c.c_size_t),
                    ('job_memory', c.c_size_t), ('peak_process', c.c_size_t), ('peak_job', c.c_size_t)]
    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    limits = Limits()
    limits.basic.flags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
    limits.process_memory = MAX_MEMORY
    if (not job or not kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits))
            or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())):
        raise OSError('pdf_resource_limit')
    return job  # handle păstrat până la ieșirea copilului


def clasifica(data):
    if not data.startswith(b'%PDF') or len(data) > 8388608 or b'%%EOF' not in data[-2048:]:
        return 'invalid'
    try:
        import fitz
    except ImportError:
        return 'neverificabil'
    try:
        with fitz.open(stream=data, filetype='pdf') as pdf:
            if pdf.is_encrypted or pdf.needs_pass or pdf.xref_get_key(-1, 'Encrypt')[0] != 'null' or pdf.is_repaired or pdf.page_count < 1:
                return 'invalid'
            # Forțează citirea arborelui real, nu o căutare textuală /Type /Page.
            for page in pdf:
                if page.rect.is_empty or page.rect.is_infinite:
                    return 'invalid'
            return 'mono' if pdf.page_count == 1 else 'multi'
    except (ValueError, RuntimeError):
        return 'invalid'
    except Exception:
        return 'neverificabil'


def _pdf_child(data, render, conn):
    try:
        job = limite_memorie()
        kind = clasifica(data)
        if not render or kind != 'mono':
            conn.send((kind, None))
            return
        import fitz
        import math
        with fitz.open(stream=data, filetype='pdf') as pdf:
            page = pdf[0]
            scale = 150 / 72
            width, height = math.ceil(page.rect.width * scale), math.ceil(page.rect.height * scale)
            if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                conn.send(('invalid', None))
                return
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            if pix.width * pix.height > MAX_PIXELS or pix.n != 3:
                conn.send(('invalid', None))
                return
            conn.send(('mono', (pix.width, pix.height, pix.samples)))
    except Exception:
        conn.send(('neverificabil', None))
    finally:
        conn.close()


def _izolat(data, render, timeout):
    ctx = multiprocessing.get_context('spawn')
    parent, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_pdf_child, args=(data, render, child), daemon=True)
    timer = None
    try:
        process.start()
        child.close()
        # Termenul acoperă și transferul imaginii, nu doar primul octet din pipe.
        timer = threading.Timer(max(0, timeout), process.terminate)
        timer.start()
        return parent.recv() if parent.poll(max(0, timeout)) else ('neverificabil', None)
    except (OSError, EOFError):
        return 'neverificabil', None
    finally:
        if timer is not None:
            timer.cancel()
            timer.join()
        if process.pid:
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
        parent.close()
        child.close()


def valideaza_pdf(data, timeout=3):
    return _izolat(data, False, timeout)[0]


def randeaza(data, timeout=3):
    from PIL import Image
    kind, result = _izolat(data, True, timeout)
    if kind != 'mono' or result is None:
        raise E3Error('pdf_invalid')
    width, height, samples = result
    return Image.frombytes('RGB', (width, height), samples)
