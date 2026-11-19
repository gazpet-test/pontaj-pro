"""Serviciul E9: doar contractele edge B2, fără RPC SQL sau chei de administrare."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import random
import shutil
import threading
import time
import uuid
from zoneinfo import ZoneInfo
from .client import save
from .e3_contract import E3Error
from .e3_aliniere import compara, aplica_arbitraj
from .e3_pdf import valideaza_pdf, randeaza, cod_pdf
from .e3_perspectiva import perspectiva
from .e3_read import Reader, citeste_orientat
from .e3_gpu import mutex, GpuLock, Coordinator, WslModels, GpuLaCerere, Pauza
from .gpu_cedare import CerereGpu

ROOT = pathlib.Path('C:/ProgramData/Gazpet/e3_ocr')
# Aceeași listă ca ERORI_LOCALE din supabase/functions/izo-e3-ocr-local/contract.ts (test de paritate).
# E9: retea, model_indisponibil, timeout, pdf_corupt, oprit spun cauza reală; intern = numai defecte.
# Se instalează DUPĂ deploy-ul edge-ului care le acceptă (edge-ul vechi refuză 400 un cod necunoscut).
ERRORS = {'structura_incerta', 'tabel_negasit', 'garda', 'prea_multe_dezacorduri', 'limita_randuri', 'pdf_invalid', 'multipagina', 'intern',
          'retea', 'model_indisponibil', 'timeout', 'pdf_corupt', 'oprit'}
PAUZA_PLAFON = 300  # secunde între două încercări preia, la eșecuri consecutive
# Întreținerea (reconciliere / WSL / descărcare) căzută: pauză min(60 * 2^k, 3600) s, nu o reîncercare pe minut.
INTRETINERE_BAZA, INTRETINERE_PLAFON = 60, 3600
# La cerere: modelele trebuie să fie gata cu cel puțin atâtea secunde înainte de termen_local, altfel lucrarea
# merge pe fallback (`model_indisponibil` = „Serverul local nu e pregătit”). Citirile reale: 10–67 s.
REZERVA_CITIRE_S = 45
MODURI_GPU = ('la_cerere', 'zi')


class NeincarcatLaTimp(E3Error):
    """Modelele nu s-au încărcat până la termen_local − REZERVA_CITIRE_S: fallback, fără invalidarea modelelor
    (încălzirea continuă pentru lucrarea următoare)."""
    def __init__(self):
        super().__init__('model_indisponibil')


def cod_jurnal(exc):
    """Cauza locală pentru jurnal (nu pleacă la edge): codul E3Error, altfel numele tipului."""
    if isinstance(exc, E3Error):
        return str(exc.cod)[:40]
    return type(exc).__name__[:40]


def cod_eroare(exc):
    """Excepție → cod de rezultat. Transportul spre edge sau edge-ul indisponibil (5xx) = retea (L05);
    un refuz 4xx sau orice altceva neprevăzut = intern."""
    if isinstance(exc, E3Error):
        if exc.cod in ERRORS:
            return exc.cod
        if exc.cod == 'edge_transport' or (exc.cod == 'edge_refuz' and (getattr(exc, 'status', 0) or 0) >= 500):
            return 'retea'
    return 'intern'


def noapte(now):
    hour = now.astimezone(ZoneInfo('Europe/Bucharest')).hour
    return hour >= 22 or hour < 6


def curata(work, *, now=None, toate=False, active=None, resturi=None):
    """Șterge numai directoare UUID directe; nu urmează symlink/junction/reparse points."""
    work = pathlib.Path(work).resolve()
    if not work.exists():
        return
    now = time.time() if now is None else now
    if resturi is not None:
        resturi.difference_update(name for name in tuple(resturi) if not (work / name).exists())
    for p in work.iterdir():
        try:
            if str(uuid.UUID(p.name)) != p.name or p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
                continue
            resolved = p.resolve()
            if resolved.parent != work or not p.is_dir() or p.name == active:
                continue
            if toate or (resturi is not None and p.name in resturi) or now - p.stat().st_mtime > 3600:
                shutil.rmtree(resolved)
                if resturi is not None:
                    resturi.discard(p.name)
        except (OSError, ValueError):
            continue


class Worker:
    def __init__(self, edge, coordinator, *, root=ROOT, reader=None, clock=None, pdf_validator=valideaza_pdf,
                 render=randeaza, perspective=perspectiva, rnd=random.random, la_cerere=None, monotonic=time.monotonic):
        # la_cerere (GpuLaCerere) = modul nou: modelele se încarcă doar pentru lucrări. None = modul „zi” (06–22 pornite).
        self.edge, self.coordinator, self.root = edge, coordinator, pathlib.Path(root)
        self.gpu, self.mono = la_cerere, monotonic
        self.reader, self.now = reader or Reader(), clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.rnd = rnd
        self.validate_pdf, self.render, self.perspective = pdf_validator, render, perspective
        self.worker_id = 'e3-' + os.environ.get('COMPUTERNAME', 'server')
        self.state, self.active, self.gpu_state = 'pornire', None, 'pornire'
        self.stop_event = threading.Event()
        self.mu = threading.RLock()
        self.resturi = set()

    def journal(self, id, state, code=None, elapsed=None):
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / 'jurnal.jsonl').open('a', encoding='utf-8') as f:
            f.write(json.dumps({'id': id, 'stare': state, 'cod': code, 'secunde': elapsed,
                                'la': self.now().isoformat()}) + '\n')

    def heartbeat(self):
        with self.mu:
            state = self.state
        from .read import protocol
        gata = self.gpu.modele_gata() if self.gpu is not None else self.gpu_state == 'disponibil'
        modele = {k: {'nume': v['served_model_name'], 'sha': v['weights_sha256'],
                      'gata': gata} for k, v in protocol()['readers'].items()}
        # r4: coduri reale de eroare + backoff (E9); r5: GPU la cerere (modelele se încarcă doar pentru lucrări)
        self.edge.call('heartbeat', worker_id=self.worker_id, stare=state, ora_server=self.now().isoformat(),
                       modele=modele, versiune='e9-b3-r5-la-cerere' if self.gpu is not None else 'e9-b3-r5-zi')
        save(self.root / 'stare.json', {'stare': state, 'la': self.now().isoformat(), 'pid': os.getpid()})

    def verifica_continuare(self, end):
        """Noaptea sau oprirea cerută = oprit; termenul local trecut = timeout (E9: nu mai apar ca intern)."""
        if noapte(self.now()) or self.stop_event.is_set():
            raise E3Error('oprit')
        if self.now() >= end:
            raise E3Error('timeout')

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
        if self.gpu is not None:
            self.gpu.cere()  # la cerere: încălzirea pornește acum, în paralel cu descărcarea / randarea
        in_citire = False
        try:
            work.mkdir(parents=True, exist_ok=False)
            self.verifica_continuare(end)
            link = self.edge.call('link', cerere_id=id, token=token)
            data = self.edge.download(link['url'])
            if hashlib.sha256(data).hexdigest() != request['sha']:
                raise E3Error('pdf_invalid')
            kind = self.validate_pdf(data)
            if kind != 'mono':
                # B2 nu include verificare_indisponibila în lista erorilor rezultat; E9: termen / corupt / mediu separate.
                raise E3Error(cod_pdf(kind))
            image = self.render(data)
            image, source['perspectiva'] = self.perspective(image)
            # Descărcarea / randarea pot consuma termenul: verificăm ÎNAINTE de citire, ca un termen deja trecut
            # să nu fie socotit „în citire” (și să nu repornească modelele) — Jakarinos r1 P2.
            self.verifica_continuare(end)
            if self.gpu is not None:
                # La cerere: modelele trebuie să fie calde cu REZERVA_CITIRE_S înainte de termen; altfel fallback,
                # fără invalidare (încălzirea continuă pentru lucrarea următoare). Citirea în sine e neschimbată.
                limita = (end - dt.timedelta(seconds=REZERVA_CITIRE_S) - self.now()).total_seconds()
                if not self.gpu.asteapta(limita, self.stop_event):
                    self.verifica_continuare(end)
                    raise NeincarcatLaTimp()
                self.verifica_continuare(end)
            remaining = (end - self.now()).total_seconds()
            in_citire = True
            l, m = citeste_orientat(image, request['sablon'], work, self.reader, time.monotonic() + remaining)
            in_citire = False
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
            self.verifica_continuare(end)
        except Exception as exc:
            error = cod_eroare(exc)
            obj = None
            # Modelele se repornesc numai când citirea le-ar fi putut lăsa blocate (ca până acum la garda / intern),
            # nu la rețea, PDF, noapte sau termenul depășit înainte / după citire.
            repornire = (error in ('garda', 'intern', 'model_indisponibil') or (error == 'timeout' and in_citire)) \
                and not isinstance(exc, NeincarcatLaTimp)
            if repornire and self.gpu is not None:
                self.gpu.invalidate()  # la cerere: descărcare; încărcarea curată vine cu lucrarea următoare
            elif repornire and self.coordinator is not None:
                self.coordinator.invalidate()
                with self.mu:
                    self.gpu_state = 'eroare'
        try:
            source['secunde'] = round(time.monotonic() - started, 3)
            # Exact o ramură și O SINGURĂ livrare: după o livrare reușită edge-ul răspunde 409 token_invalid
            # (nu „deja primit”), deci o reîncercare n-ar deosebi livrarea reușită de tokenul expirat (L05).
            try:
                self.edge.call('rezultat', cerere_id=id, token=token, obiect=obj, eroare=error, sursa=source)
            except Exception as exc:
                cod = cod_eroare(exc)
                refuzat = cod != 'retea' and isinstance(exc, E3Error) and exc.cod == 'edge_refuz'
                self.journal(id, 'nelivrat', 'refuzat' if refuzat else cod, source['secunde'])
            else:
                self.journal(id, 'esuata' if error else 'gata', error, source['secunde'])
        finally:
            if self.gpu is not None:
                self.gpu.gata()
            with self.mu:
                self.active = None
                self.state = self.gpu.stare(noapte(self.now())) if self.gpu is not None else self.gpu_state
                self.resturi.add(id)
                curata(self.root / 'work', active=self.active, resturi=self.resturi)
            if id in self.resturi:
                self.journal(id, 'cleanup_amanat')

    def maintenance(self):
        if self.gpu is not None:
            return self.intretinere_la_cerere()
        last_reconcile = last_cleanup = float('-inf')
        last_night = None
        # Eșecurile reconcilierii (WSL, hash-uri, oprire neconfirmată): pauză min(60 * 2^k, 3600) s, jurnal doar la
        # schimbarea treptei / a cauzei. Înainte, la pornire și la schimbarea zi / noapte, o reconciliere căzută se
        # reîncerca la fiecare secundă, cu câte o linie „intern” în jurnal (last_night rămânea vechi).
        pauza, jurnalizat, retry_at = Pauza(plafon=INTRETINERE_PLAFON, baza=INTRETINERE_BAZA, rnd=self.rnd), None, float('-inf')
        while not self.stop_event.is_set():
            t, night = self.mono(), noapte(self.now())
            if (self.root / 'opreste').exists():
                self.stop_event.set()
                break
            try:
                if t >= retry_at and (t - last_reconcile >= 60 or night != last_night):
                    with self.mu:
                        if night != last_night:
                            self.state = 'ocupat' if self.active else 'pornire'
                    # Reconcilierea poate aștepta WSL / hash-uri; heartbeat-ul are fir separat.
                    state = self.coordinator.reconcile(night)
                    with self.mu:
                        self.gpu_state = state
                        self.state = 'ocupat' if self.active and state == 'disponibil' else state
                    last_reconcile, last_night = t, night
                    if pauza.esecuri:
                        self.journal(None, 'intretinere_reluata')
                    pauza.reset()
                    jurnalizat = None
                if t - last_cleanup >= 3600:
                    with self.mu:
                        curata(self.root / 'work', active=self.active, resturi=self.resturi)
                    last_cleanup = t
            except Exception as exc:
                with self.mu:
                    self.state = self.gpu_state = 'eroare'
                cod = cod_jurnal(exc)
                treapta, asteptare = pauza.esec()
                retry_at, last_reconcile = t + asteptare, t
                if (treapta, cod) != jurnalizat:
                    self.journal(None, 'eroare', cod, treapta)
                    jurnalizat = (treapta, cod)
            self.stop_event.wait(1)

    def intretinere_la_cerere(self):
        """Pasul GPU la fiecare secundă (ieftin când nu e nimic de făcut: fără WSL cât e rece), starea pentru edge,
        curățenia orară. O excepție (WSL, lacăt) = fereastra de eroare a GpuLaCerere, cu pauză crescătoare și plafon."""
        last_cleanup = float('-inf')
        while not self.stop_event.is_set():
            t, night = self.mono(), noapte(self.now())
            if (self.root / 'opreste').exists():
                self.stop_event.set()
                break
            try:
                self.gpu.pas(night)
            except Exception as exc:
                self.gpu.esec(cod_jurnal(exc))
            with self.mu:
                self.state = 'ocupat' if self.active else self.gpu.stare(night)
            try:
                if t - last_cleanup >= 3600:
                    with self.mu:
                        curata(self.root / 'work', active=self.active, resturi=self.resturi)
                    last_cleanup = t
            except Exception:
                last_cleanup = t
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

    def bucla_preia(self):
        """Câte o cerere odată, la 1 s când serviciul e disponibil. preia eșuat (rețea, edge indisponibil,
        refuz) = pauză crescătoare min(2^k, 300) s + jitter, resetată la primul succes. În jurnal intră
        doar schimbarea treptei / a cauzei și revenirea, nu câte o linie pe încercare."""
        pauza, jurnalizat = Pauza(plafon=PAUZA_PLAFON, rnd=self.rnd), None
        while not self.stop_event.is_set():
            with self.mu:
                available = self.state == 'disponibil'
            asteapta = 1
            if available and not noapte(self.now()):
                try:
                    request = self.edge.call('preia', worker_id=self.worker_id).get('cerere')
                except Exception as exc:
                    cod = cod_eroare(exc)
                    treapta, asteapta = pauza.esec()
                    if (treapta, cod) != jurnalizat:
                        self.journal(None, 'pauza', cod, treapta)
                        jurnalizat = (treapta, cod)
                else:
                    if pauza.esecuri:
                        self.journal(None, 'reluat', None, None)
                    pauza.reset()
                    jurnalizat = None
                    if request:
                        try:
                            self.process(request)
                        except Exception as exc:
                            self.journal(None, 'eroare', cod_eroare(exc))
            self.stop_event.wait(asteapta)

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
                self.bucla_preia()
            finally:
                self.stop_event.set()
                thread.join(timeout=45)
                heartbeat_thread.join(timeout=10)
                if thread.is_alive():
                    self.state = 'eroare'
                    self.heartbeat()
                    raise E3Error('vllm_control')  # fără release când oprirea nu e confirmată
                if self.gpu is not None:
                    self.state = 'oprit' if self.gpu.opreste_tot() else 'eroare'
                else:
                    state = self.coordinator.reconcile(True)
                    self.state = 'oprit' if state == 'noapte' else state
                self.heartbeat()


def config_gpu(cfg):
    """`gpu_mod`: 'la_cerere' (implicit, decizia 19.11.2026) sau 'zi' (comportamentul vechi: modele pornite 06–22,
    revenirea fără reinstalare). `inactiv_minute`: 1..120, implicit 10. Orice altă valoare = refuz la pornire."""
    mod = cfg.get('gpu_mod', 'la_cerere')
    minute = cfg.get('inactiv_minute', 10)
    if mod not in MODURI_GPU or isinstance(minute, bool) or not isinstance(minute, (int, float)) or not 1 <= minute <= 120:
        raise E3Error('config_gpu')
    return mod, float(minute) * 60


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
        mod, inactiv_s = config_gpu(cfg)
        models = WslModels(cfg, proto)
        lock = GpuLock(proto['gpu_lock'])
        coordinator = Coordinator(lock, models, x.root / 'servicii.json')
        worker = Worker(Edge(citeste_secret()), coordinator, root=x.root)
        if mod == 'la_cerere':
            worker.gpu = GpuLaCerere(coordinator, CerereGpu(proto['gpu_lock'], token=lock.token),
                                     inactiv_s=inactiv_s, jurnal=worker.journal)
        try:
            worker.serve()
        except KeyboardInterrupt:
            worker.stop_event.set()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
