"""Două cititoare pe același cadru; reutilizează read.py / garda v5, fără lock per cerere."""
import concurrent.futures
import io
import multiprocessing
import pathlib
import time
from .e3_contract import E3Error
from .e3_mapare import mapare


def _reader_process(out, name, timeout, conn):
    """Izolează inclusiv firul intern MinerU: la termen nu rămân apeluri în fundal."""
    from . import read
    try:
        proto = read.protocol()
        proto['deadline_seconds'] = min(40, timeout)
        read.protocol = lambda: proto  # numai în procesul copil E3, fără efect asupra Ofertării
        state = read.run_reader(out, name, run_id='e3', check_weights=False, check_server=False, lock=False)
        result = json_load(pathlib.Path(out) / 'page0001/p0001_b0' / name / 'result.json')
        if state.get('benzi_garda') or read.garda_oprita(result):
            conn.send((None, 'garda'))
        elif state['status'] != 'complete' or not result.get('ok'):
            conn.send((None, 'intern'))
        else:
            raw = (pathlib.Path(out) / 'page0001/p0001_b0' / name / 'raw.txt').read_text(encoding='utf-8')
            conn.send((raw, None))
    except Exception:
        conn.send((None, 'intern'))
    finally:
        conn.close()


def json_load(path):
    import json
    return json.loads(path.read_text(encoding='utf-8'))


class Reader:
    def __call__(self, name, image, out, timeout):
        from .plan import save, sha
        out = pathlib.Path(out)
        out.mkdir(parents=True)
        buf = io.BytesIO()
        image.save(buf, format='PNG')
        data = buf.getvalue()
        (out / 'page0001').mkdir()
        (out / 'page0001/p0001_b0.png').write_bytes(data)
        save(out / 'plan.json', {'status': 'plan_complete', 'bands': [{
            'id': 'p0001_b0', 'page': 1, 'image': 'page0001/p0001_b0.png', 'image_sha256': sha(data)}]})
        ctx = multiprocessing.get_context('spawn')
        parent, child = ctx.Pipe(duplex=False)
        process = ctx.Process(target=_reader_process, args=(out, name, timeout, child), daemon=True)
        try:
            process.start()
            child.close()
            if not parent.poll(min(40, timeout)):
                # run_reader poate aștepta backend_idle după o gardă deja înregistrată.
                guard = False
                try:
                    from .read import garda_oprita
                    result = json_load(out / 'page0001/p0001_b0' / name / 'result.json')
                    guard = garda_oprita(result)
                except (OSError, ValueError):
                    pass
                raise E3Error('garda' if guard else 'intern')
            raw, error = parent.recv()
            if error:
                raise E3Error(error)
            return raw
        finally:
            if process.pid:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=2)
            parent.close()
            child.close()


def citeste_orientat(image, sablon, root, reader, deadline, clock=time.monotonic):
    root = pathlib.Path(root)
    def call(name, im, angle):
        remaining = deadline - clock()
        if remaining <= 0:
            raise E3Error('intern')
        return reader(name, im, root / ('r%s_%s' % (angle, name)), remaining)
    def pair(im, angle):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(call, 'lighton', im, angle)
            b = pool.submit(call, 'mineru', im, angle)
            return a.result(), b.result()
    def parse(raw):
        try:
            return mapare(raw, sablon)
        except E3Error as e:
            if e.cod == 'tabel_negasit':
                return None
            raise
    for angle in (0, 90, 180, 270):
        rotated = image if angle == 0 else image.rotate(-angle, expand=True)
        l, m = pair(rotated, angle)
        lp, mp = parse(l), parse(m)
        if lp is not None and mp is not None:
            lp['rotatie_grade'] = mp['rotatie_grade'] = angle
            return lp, mp
    raise E3Error('tabel_negasit')
