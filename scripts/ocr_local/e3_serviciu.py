"""Serviciul E9: doar contractele edge B2, fără RPC SQL sau chei de administrare."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import threading
import time
import uuid
from zoneinfo import ZoneInfo
from .client import save
from .e3_contract import E3Error
from .e3_aliniere import compara, aplica_arbitraj
from .e3_pdf import valideaza_pdf, randeaza
from .e3_perspectiva import perspectiva
from .e3_read import Reader, citeste_orientat
from .e3_gpu import mutex, GpuLock, Coordinator, WslModels

ROOT = pathlib.Path('C:/ProgramData/Gazpet/e3_ocr')
ERRORS = {'structura_incerta', 'tabel_negasit', 'garda', 'prea_multe_dezacorduri', 'limita_randuri', 'pdf_invalid', 'multipagina', 'intern'}


def noapte(now):
    hour = now.astimezone(ZoneInfo('Europe/Bucharest')).hour
    return hour >= 22 or hour < 6


def curata(work, *, now=None, toate=False, active=None):
    """Șterge numai directoare UUID directe; nu urmează symlink/junction/reparse points."""
    work = pathlib.Path(work).resolve()
    if not work.exists():
        return
    now = time.time() if now is None else now
    for p in work.iterdir():
        try:
            if str(uuid.UUID(p.name)) != p.name or p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
                continue
            resolved = p.resolve()
            if resolved.parent != work or not p.is_dir() or p.name == active:
                continue
            if toate or now - p.stat().st_mtime > 3600:
                shutil.rmtree(resolved)
        except (OSError, ValueError):
            continue


class Worker:
    def __init__(self, edge, coordinator, *, root=ROOT, reader=None, clock=None, pdf_validator=valideaza_pdf,
                 render=randeaza, perspective=perspectiva):
        self.edge, self.coordinator, self.root = edge, coordinator, pathlib.Path(root)
        self.reader, self.now = reader or Reader(), clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.validate_pdf, self.render, self.perspective = pdf_validator, render, perspective
        self.worker_id = 'e3-' + os.environ.get('COMPUTERNAME', 'server')
        self.state, self.active, self.gpu_state = 'pornire', None, 'pornire'
        self.stop_event = threading.Event()
        self.mu = threading.RLock()

    def journal(self, id, state, code=None, elapsed=None):
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / 'jurnal.jsonl').open('a', encoding='utf-8') as f:
            f.write(json.dumps({'id': id, 'stare': state, 'cod': code, 'secunde': elapsed,
                                'la': self.now().isoformat()}) + '\n')

    def heartbeat(self):
        with self.mu:
            state = self.state
        from .read import protocol
        modele = {k: {'nume': v['served_model_name'], 'sha': v['weights_sha256'],
                      'gata': self.gpu_state == 'disponibil'} for k, v in protocol()['readers'].items()}
        self.edge.call('heartbeat', worker_id=self.worker_id, stare=state, ora_server=self.now().isoformat(),
                       modele=modele, versiune='e9-b3-r3')
        save(self.root / 'stare.json', {'stare': state, 'la': self.now().isoformat(), 'pid': os.getpid()})

    def process(self, request):
        # Nicio recuperare automată a unui token de pe disc. preia este unica autoritate.
        id = str(uuid.UUID(request['id']))
        if id != request['id'] or not isinstance(request.get('token'), str):
            raise E3Error('intern')
        token = str(uuid.UUID(request['token']))
        end = dt.datetime.fromisoformat(request['termen_local'].replace('Z', '+00:00'))
        if end.tzinfo is None:
            raise E3Error('intern')
        work = self.root / 'work' / id
        started, obj, error = time.monotonic(), None, None
        source = {'perspectiva': 'nesigura', 'dezacorduri': 0}
        with self.mu:
            self.active, self.state = id, 'ocupat'
        try:
            work.mkdir(parents=True, exist_ok=False)
            if self.now() >= end or noapte(self.now()) or self.stop_event.is_set():
                raise E3Error('intern')
            link = self.edge.call('link', cerere_id=id, token=token)
            data = self.edge.download(link['url'])
            if hashlib.sha256(data).hexdigest() != request['sha']:
                raise E3Error('pdf_invalid')
            kind = self.validate_pdf(data)
            if kind != 'mono':
                # B2 nu include verificare_indisponibila în lista erorilor rezultat.
                raise E3Error({'multi': 'multipagina', 'invalid': 'pdf_invalid'}.get(kind, 'intern'))
            image = self.render(data)
            image, source['perspectiva'] = self.perspective(image)
            remaining = (end - self.now()).total_seconds()
            l, m = citeste_orientat(image, request['sablon'], work, self.reader, time.monotonic() + remaining)
            obj, cells = compara(l, m, request['sablon'])
            source['dezacorduri'] = len(cells)
            response = {'arbitraj': 'invalid'}
            # R3-1: strict înainte de termen_local − 40 secunde. Niciodată retry plătit.
            if cells and self.now() < end - dt.timedelta(seconds=40) and not self.stop_event.is_set():
                try:
                    response = self.edge.call('arbitreaza', cerere_id=id, token=token,
                                              rotatie_grade=obj['rotatie_grade'], celule=cells)
                except Exception:
                    pass
            obj = aplica_arbitraj(obj, cells, response, request['sablon'])
            if self.now() >= end or noapte(self.now()) or self.stop_event.is_set():
                raise E3Error('intern')
        except Exception as exc:
            error = exc.cod if isinstance(exc, E3Error) and exc.cod in ERRORS else 'intern'
            obj = None
            if error in ('garda', 'intern') and self.coordinator is not None:
                self.coordinator.invalidate()
                with self.mu:
                    self.gpu_state = 'eroare'
        try:
            source['secunde'] = round(time.monotonic() - started, 3)
            # Exact o ramură; refuzul tokenului expirat nu produce altă preluare sau arbitraj.
            self.edge.call('rezultat', cerere_id=id, token=token, obiect=obj, eroare=error, sursa=source)
            self.journal(id, 'esuata' if error else 'gata', error, source['secunde'])
        finally:
            if work.exists() and work.resolve().parent == (self.root / 'work').resolve():
                shutil.rmtree(work)
            with self.mu:
                self.active = None
                self.state = self.gpu_state

    def maintenance(self):
        last_reconcile = last_cleanup = float('-inf')
        last_night = None
        while not self.stop_event.is_set():
            t, night = time.monotonic(), noapte(self.now())
            if (self.root / 'opreste').exists():
                self.stop_event.set()
                break
            try:
                if t - last_reconcile >= 60 or night != last_night:
                    with self.mu:
                        if night != last_night:
                            self.state = 'ocupat' if self.active else 'pornire'
                    # Reconcilierea poate aștepta WSL / hash-uri; heartbeat-ul are fir separat.
                    state = self.coordinator.reconcile(night)
                    with self.mu:
                        self.gpu_state = state
                        self.state = 'ocupat' if self.active and state == 'disponibil' else state
                    last_reconcile, last_night = t, night
                if t - last_cleanup >= 3600:
                    with self.mu:
                        curata(self.root / 'work', active=self.active)
                    last_cleanup = t
            except Exception:
                with self.mu:
                    self.state = self.gpu_state = 'eroare'
                self.journal(None, 'eroare', 'intern')
                last_reconcile = t
            self.stop_event.wait(1)

    def heartbeat_loop(self):
        while not self.stop_event.is_set():
            try:
                self.heartbeat()
            except Exception:
                # Canalul căzut nu anunță fals disponibilitatea; după revenire se reconciliază.
                with self.mu:
                    self.state = self.gpu_state = 'eroare'
            self.stop_event.wait(15)

    def serve(self):
        self.root.mkdir(parents=True, exist_ok=True)
        with mutex(self.root / 'instanta.lock'):
            (self.root / 'opreste').unlink(missing_ok=True)
            curata(self.root / 'work', toate=True)
            thread = threading.Thread(target=self.maintenance, daemon=True)
            heartbeat_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
            heartbeat_thread.start()
            thread.start()
            try:
                while not self.stop_event.is_set():
                    with self.mu:
                        available = self.state == 'disponibil'
                    if available and not noapte(self.now()):
                        try:
                            request = self.edge.call('preia', worker_id=self.worker_id).get('cerere')
                            if request:
                                self.process(request)
                        except Exception:
                            self.journal(None, 'eroare', 'intern')
                    self.stop_event.wait(1)
            finally:
                self.stop_event.set()
                thread.join(timeout=45)
                heartbeat_thread.join(timeout=10)
                if thread.is_alive():
                    self.state = 'eroare'
                    self.heartbeat()
                    raise E3Error('vllm_control')  # fără release când oprirea nu e confirmată
                state = self.coordinator.reconcile(True)
                self.state = 'oprit' if state == 'noapte' else state
                self.heartbeat()


def main(argv=None):
    p = argparse.ArgumentParser(description='Serviciul E9: coada E3 prin edge, fara acces SQL.')
    p.add_argument('comanda', choices=['serveste', 'opreste', 'stare'])
    p.add_argument('--root', type=pathlib.Path, default=ROOT)
    p.add_argument('--config', type=pathlib.Path, help='Config locala WSL + fractii VRAM masurate; fara secrete')
    x = p.parse_args(argv)
    if x.comanda == 'stare':
        print((x.root / 'stare.json').read_text(encoding='utf-8') if (x.root / 'stare.json').exists() else '{"stare":"oprit"}')
    elif x.comanda == 'opreste':
        x.root.mkdir(parents=True, exist_ok=True)
        (x.root / 'opreste').touch()
    else:
        from .e3_client import Edge, citeste_secret
        from .read import protocol
        if not x.config:
            p.error('serveste cere --config cu memoria validată pe server')
        ZoneInfo('Europe/Bucharest')  # eșec înainte de GPU dacă tzdata lipsește pe Windows
        cfg, proto = json.loads(x.config.read_text(encoding='utf-8')), protocol()
        models = WslModels(cfg, proto)
        coordinator = Coordinator(GpuLock(proto['gpu_lock']), models, x.root / 'servicii.json')
        worker = Worker(Edge(citeste_secret()), coordinator, root=x.root)
        try:
            worker.serve()
        except KeyboardInterrupt:
            worker.stop_event.set()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
