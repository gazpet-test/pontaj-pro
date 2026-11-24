"""Coada de citire OCR local (decizia Răzvan 24.11.2026, varianta A): sesiunile (Cowork, chat, juridic) NU pornesc modele.
Ele CER citirea unui plan (`coada adauga`); UN singur proces pe serverul AI (`coada lucreaza`) rulează cererile pe rând.

Cererile = câte un fișier JSON în <root>/cereri/ (scriere atomică: temp + fsync + os.replace). Tranzițiile (adăugare,
anulare, preluare în lot) se fac sub lacătul scurt <root>/coada.lock. Instanța unică și obligația de recuperare sunt ale
PLĂCII, nu ale rădăcinii (Jakarinos #1190 r1 P1): procesul ține toată viața `ocr_coada.instanta.lock`, iar obligația de a
dovedi memoria eliberată stă în `ocr_coada.modele.json`, ambele lângă gpu.lock (cai_globale) -> două `--root` diferite nu
pot rula două procese și oricare instanță nouă vede obligația celei căzute.
O cerere ilizibilă / cu structură invalidă se izolează (originalul în <root>/cereri/invalide/, cererea = eroare cu motiv),
restul cozii merge mai departe (r1 P2).

Lotul = toate cererile active în clipa preluării, în ordinea numerelor. Pe lot:
  gpu.lock (deținător `ocr_coada`) -> pornește LightOn -> `citeste` pe toate planurile -> oprește LightOn (eliberare
  confirmată pe memorie, Coordinator.descarca) -> MinerU la fel -> `compara` + textul convocator (CPU, fără lacăt) -> gata.
Lacătul se ține doar cât un model e pornit (între cele două modele și la comparare E3 îl poate lua).
Prioritatea E3 (gpu_cedare.py): o cerere E3 activă oprește citirea după banda curentă (`cedat_e3`); modelul se oprește,
lacătul se eliberează DOAR după memoria confirmată, coada așteaptă până nu mai e nicio cerere E3 și lacătul e liber, apoi
reia (`citeste` sare benzile gata). Cu E3 oprit, placa e a cozii.
La pornire: modelele rămase după o cădere se opresc (cu memoria confirmată) înainte de orice. Erorile de infrastructură
(WSL, vLLM, memorie neconfirmată) = pauză crescătoare cu plafon (Pauza din e3_gpu), fără reîncercări în buclă rapidă.
Un plan stricat / o citire oprită (termen, bandă întreruptă) = eroare pe acea cerere; restul cozii continuă.
Nicio comandă de aici nu e derivată din conținutul OCR; căile vin doar de la sesiuni și se validează (sub paw-data,
fără UNC / ADS / reparse points), la adăugare și din nou înainte de fiecare citire. La fel și DESTINAȚIILE scrierilor
(r1 P1): tot arborele planului (benzi, rezultate, comparații), folderul cozii și fișierele de lângă gpu.lock — fără
reparse points, fără legături fizice (st_nlink > 1), doar foldere și fișiere obișnuite."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import time
from .client import save
from .e3_contract import E3Error
from .e3_gpu import GpuLock, Coordinator, Pauza, mutex, cod_exceptie
from .gpu_cedare import cerere_activa

RADACINI = (pathlib.Path('C:/Users/Public/paw-data'),)
ROOT = pathlib.Path('C:/Users/Public/paw-data/ocr_coada')
DETINATOR = 'ocr_coada'
VERSIUNE = 'coada-v2'
READERS = ('lighton', 'mineru')
ACTIVE = ('asteapta', 'citeste_lighton', 'citeste_mineru', 'compara')
FINALE = ('gata', 'eroare', 'anulata')
ID_RE = re.compile(r'^c(\d{6})$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
# Fișierele scrise de citire / comparare / textul convocator direct în folderul planului (restul: sub page*/<banda>/<cititor>/)
FISIERE_PLAN = ('read_lighton.json', 'read_mineru.json', 'comparatie.json', 'dezacorduri.jsonl', 'text_conv.txt')
CINE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$')
MAX_PLANURI = 200
MAX_INCERCARI_PLAN = 3       # excepții neprevăzute pe același plan (nu termen / gardă): apoi eroare pe cerere, coada merge mai departe
PORNIRE_MAX_S = 300          # modelul trebuie să răspundă la /health în atât, altfel oprire + pauză
SANATATE_POLL_S = 2
ASTEPTARE_POLL_S = 5
VRAM_MARJA_MB = 1024         # ca E3: memoria peste bază + 1 GB fără procese vLLM = ținută de altcineva
STARE_MAX_S = 60             # stare.json se reîmprospătează cel puțin o dată pe minut cât procesul trăiește
# Sursa PDF pentru textul convocator: doar de pe aceste rădăcini (citire), cu sha256 = cel din plan.
SURSE_TEXT = ('C:/Users/Public/paw-data/', 'Z:/', 'G:/', '//gazpet-tnas/')


def acum_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


# --- căi -----------------------------------------------------------------------------------------------------------
def _reparse(st):
    if os.name == 'nt':
        return bool(getattr(st, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)
    return stat.S_ISLNK(st.st_mode)


def sub_radacini(full, radacini=None):
    """Strict sub una din rădăcini (rădăcina însăși nu). radacini=None = RADACINI (citit la apel, testele îl înlocuiesc)."""
    nf = os.path.normcase(full)
    return any(nf.startswith(os.path.normcase(os.path.abspath(str(r))).rstrip('\\/') + os.sep)
               for r in (RADACINI if radacini is None else radacini))


def cale_sigura(p, radacini=None):
    """Calea unui plan de la o sesiune -> pathlib.Path absolută, sub una din rădăcini. Refuz (ValueError): gol, caractere
    de control / ghilimele, UNC (\\\\server, //server, \\\\?\\), ADS (al doilea ':'), relativă, în afara rădăcinilor
    (după normalizarea '..'), oricare componentă reparse point (symlink / junction), director lipsă, plan.json lipsă /
    reparse / nu e fișier. Aceleași reguli ca lansatorul Paw (CaleSigura)."""
    if not isinstance(p, str) or not p.strip():
        raise ValueError('cale goala')
    if re.search(r'["\x00-\x1f]', p):
        raise ValueError('caractere interzise in cale')
    if p.startswith(('\\\\', '//', '\\/', '/\\')):
        raise ValueError('UNC refuzat: %s' % p)
    if re.match(r'^[A-Za-z]:.*:', p) or (os.name == 'nt' and ':' in p[2:]):
        raise ValueError('ADS refuzat: %s' % p)
    if not os.path.isabs(p) or (os.name == 'nt' and not re.match(r'^[A-Za-z]:[\\/]', p)):
        raise ValueError('cale relativa refuzata: %s' % p)
    full = os.path.abspath(p)
    if not sub_radacini(full, radacini):
        raise ValueError('in afara radacinilor permise: %s' % full)
    stramosi_fara_reparse(full)
    if not os.path.isdir(full):
        raise ValueError('director lipsa: %s' % full)
    pj = os.path.join(full, 'plan.json')
    try:
        st = os.lstat(pj)
    except FileNotFoundError:
        raise ValueError('plan.json lipsa: %s' % full) from None
    if _reparse(st) or not stat.S_ISREG(st.st_mode):
        raise ValueError('plan.json nu e fisier obisnuit: %s' % full)
    return pathlib.Path(full)


def stramosi_fara_reparse(full):
    """Calea însăși (dacă există) și fiecare strămoș până la rădăcina discului: niciun reparse point (symlink / junction)."""
    cur = os.path.abspath(str(full))
    while True:
        try:
            st = os.lstat(cur)
        except FileNotFoundError:
            st = None
        if st is not None and _reparse(st):
            raise ValueError('reparse point refuzat: %s' % cur)
        parinte = os.path.dirname(cur)
        if parinte == cur:
            return
        cur = parinte


def _intrare_sigura(cale, st, *, dir_asteptat=None):
    """O destinație de scriere existentă: folder sau fișier obișnuit, fără reparse point, fără legături fizice (o scriere
    pe loc — write_bytes / open('w'|'a') — ar ajunge în celălalt nume al fișierului, oriunde ar fi el pe disc)."""
    if _reparse(st):
        raise ValueError('reparse point refuzat: %s' % cale)
    if stat.S_ISDIR(st.st_mode):
        if dir_asteptat is False:
            raise ValueError('folder in locul unui fisier: %s' % cale)
        return True
    if not stat.S_ISREG(st.st_mode):
        raise ValueError('nu e fisier obisnuit: %s' % cale)
    if st.st_nlink > 1:
        raise ValueError('legatura fizica refuzata: %s' % cale)
    if dir_asteptat is True:
        raise ValueError('fisier in locul unui folder: %s' % cale)
    return False


def verifica_arbore(d, max_intrari=200000, sari=None):
    """Toate intrările de sub `d` (inclusiv `d`), fără a urma nimic (lstat + scandir): vezi _intrare_sigura. Prinde și
    numele pe care nu le scrie nimeni direct, dar le scrie `client.save` PE LOC înainte de os.replace (`<nume>.tmp`) sau
    GpuLock (`.pending`). Un folder lipsă = nimic de verificat (se creează la scriere, ca folder obișnuit).
    `sari(cale)` = adevărat -> intrarea nu se verifică și nu se coboară în ea (fișierele cererilor: Coada.citeste)."""
    try:
        st = os.lstat(d)
    except FileNotFoundError:
        return 0
    stiva, n = [(str(d), st)], 0
    while stiva:
        cale, st = stiva.pop()
        n += 1
        if n > max_intrari:
            raise ValueError('prea multe intrari sub %s' % d)
        if _intrare_sigura(cale, st):
            try:
                with os.scandir(cale) as it:
                    nume = [e.path for e in it]
            except FileNotFoundError:
                continue  # folderul a dispărut între timp: nimic sub el
            for x in nume:  # în afara try-ului de mai sus: o intrare dispărută nu ascunde restul folderului
                if sari is None or not sari(x):
                    try:
                        stiva.append((x, os.lstat(x)))
                    except FileNotFoundError:
                        pass  # dispărută între listare și lstat (ex. `.tmp`-ul unui save din altă comandă): nimic de scris prin ea
    return n


def verifica_destinatii_plan(d, doc):
    """Destinațiile scrierilor citirii (read.run_reader), comparării și textului convocator (Jakarinos #1190 r1 P1):
    tot arborele planului fără reparse / legături fizice, iar căile scrise au tipul așteptat (folder / fișier)."""
    d = pathlib.Path(d)
    stramosi_fara_reparse(d)
    verifica_arbore(d)

    def tip(p, dir_asteptat):
        try:
            _intrare_sigura(str(p), os.lstat(p), dir_asteptat=dir_asteptat)
        except FileNotFoundError:
            pass
    for nume in FISIERE_PLAN:
        tip(d / nume, False)
    for b in doc['bands']:
        pag = d / ('page%04d' % b['page'])
        tip(pag, True)
        tip(pag / b['id'], True)
        for r in READERS:
            tip(pag / b['id'] / r, True)
            for nume in ('raw.txt', 'result.json', 'request_started.json', 'layout.json'):
                tip(pag / b['id'] / r / nume, False)


def verifica_fisiere_globale(*cai):
    """Fișierele cozii de lângă gpu.lock (instanța, obligația memoriei, gpu.lock cu .pending / .coord): strămoșii fără
    reparse, fișierul (dacă există) obișnuit și fără legături fizice; la fel temporarul lui `client.save` (`<nume>.tmp`)."""
    for p in cai:
        p = pathlib.Path(p)
        stramosi_fara_reparse(p)
        for x in (p, p.with_name(p.name + '.tmp')):
            try:
                _intrare_sigura(str(x), os.lstat(x), dir_asteptat=False)
            except FileNotFoundError:
                pass


def cai_globale(gpu_lock_path):
    """Instanța unică și obligația de recuperare = ale plăcii (lângă gpu.lock), nu ale rădăcinii cozii (r1 P1)."""
    g = pathlib.Path(gpu_lock_path)
    return {'instanta': g.with_name(DETINATOR + '.instanta.lock'), 'modele': g.with_name(DETINATOR + '.modele.json'),
            'info': g.with_name(DETINATOR + '.instanta.json')}  # info = ultima pornire (rădăcina, pid), doar pentru `stare`


def cheie_cale(p):
    return os.path.normcase(os.path.abspath(str(p)))


def sha_fisier(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


def valideaza_plan(p, radacini=None):
    """Calea sigură + planul complet și neschimbat (load_plan verifică id-urile, căile și sha-ul fiecărei imagini)
    + destinațiile scrierilor (verifica_destinatii_plan)."""
    from .plan import load_plan
    d = cale_sigura(p, radacini)
    try:
        doc = load_plan(d)
    except (ValueError, KeyError, TypeError, OSError) as e:
        raise ValueError('plan invalid (%s): %s' % (d, str(e)[:200])) from None
    verifica_destinatii_plan(d, doc)
    nerez = sum(1 for x in doc.get('pages', []) if x.get('route') == 'orientare_nerezolvata')
    return d, doc, {'cale': str(d), 'plan_sha256': sha_fisier(d / 'plan.json'), 'benzi': len(doc['bands']),
                    'pagini_nerezolvate': nerez}


# --- coada pe disc ----------------------------------------------------------------------------------------------------
def _intreg(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def valideaza_cerere(c, id):
    """Structura unei cereri citite de pe disc (Jakarinos #1190 r1 P2): orice abatere = ValueError cu motiv, ca nimic să
    nu ajungă la `.get` pe un ne-obiect sau la un tip neașteptat în proces. id-ul din fișier = numele fișierului (altfel
    scrie() ar scrie peste altă cerere). Cererile active au și `cine` + cel puțin un plan cu cale și sha256."""
    if not isinstance(c, dict):
        raise ValueError('structura: cererea nu e un obiect JSON (%s)' % type(c).__name__)
    if c.get('id') != id:
        raise ValueError('structura: id-ul din cerere (%r) nu e numele fisierului' % (c.get('id'),))
    st = c.get('stare')
    if st not in ACTIVE + FINALE:
        raise ValueError('structura: stare necunoscuta %r' % (st,))
    if not _intreg(c.get('versiune', 0)):
        raise ValueError('structura: versiune invalida')
    for k in ('motiv', 'creat_la', 'actualizat_la', 'preluat_la'):
        if c.get(k) is not None and not isinstance(c[k], str):
            raise ValueError('structura: %s nu e text' % k)
    if c.get('dezacorduri') is not None and not _intreg(c['dezacorduri']):
        raise ValueError('structura: dezacorduri invalid')
    planuri = c.get('planuri')
    if not isinstance(planuri, list) or len(planuri) > MAX_PLANURI or (st in ACTIVE and not planuri):
        raise ValueError('structura: lista de planuri invalida')
    if st in ACTIVE and not (isinstance(c.get('cine'), str) and CINE_RE.match(c['cine'])):
        raise ValueError('structura: cine invalid')
    if c.get('cine') is not None and not isinstance(c['cine'], str):
        raise ValueError('structura: cine invalid')
    for i, p in enumerate(planuri):
        if not isinstance(p, dict):
            raise ValueError('structura: planul %d nu e obiect' % i)
        if not isinstance(p.get('cale'), str) or not p['cale'].strip():
            raise ValueError('structura: planul %d fara cale' % i)
        if not isinstance(p.get('plan_sha256'), str) or not SHA_RE.match(p['plan_sha256']):
            raise ValueError('structura: planul %d fara plan_sha256' % i)
        for k in READERS + ('eroare',):
            if p.get(k) is not None and not isinstance(p[k], str):
                raise ValueError('structura: planul %d, %s nu e text' % (i, k))
        for k in ('incercari', 'dezacorduri', 'pagini_nerezolvate', 'benzi'):
            if p.get(k) is not None and not _intreg(p[k]):
                raise ValueError('structura: planul %d, %s invalid' % (i, k))
    return c


def verifica_radacina(root):
    """Destinațiile din folderul cozii (r1 P1): strămoșii fără reparse, tot arborele (inclusiv temporarele `.tmp`) fără
    reparse / legături fizice, iar folderele și fișierele scrise de coadă au tipul așteptat. Se sar DOAR fișierele
    cererilor (le verifică Coada.citeste la fiecare citire și, dacă sunt nesigure, le izolează) și conținutul lui
    cereri/invalide (originale mutate, nescrise niciodată): o singură cerere nesigură nu oprește coada (r1 P2)."""
    root = pathlib.Path(root)
    stramosi_fara_reparse(root)
    cereri, inv = cheie_cale(root / 'cereri'), cheie_cale(root / 'cereri' / 'invalide')

    def sari(cale):
        parinte, nume = os.path.split(cheie_cale(cale))
        return parinte == inv or (parinte == cereri and ID_RE.match(nume[:-5] if nume.endswith('.json') else '') is not None)
    verifica_arbore(root, sari=sari)
    for p, d in ((root, True), (root / 'cereri', True), (root / 'cereri' / 'invalide', True),
                 (root / 'jurnal.jsonl', False), (root / 'stare.json', False), (root / 'coada.lock', False),
                 (root / 'opreste', False)):
        try:
            _intrare_sigura(str(p), os.lstat(p), dir_asteptat=d)
        except FileNotFoundError:
            pass
    return root


class Coada:
    def __init__(self, root=ROOT, *, radacini=None, sleep=time.sleep, lacat_s=10.0):
        self.root, self.radacini, self.sleep, self.lacat_s = pathlib.Path(root), radacini, sleep, lacat_s
        self.cereri = self.root / 'cereri'
        self._izolare_esuata = set()

    class _Tranzitie:
        """Lacătul scurt al tranzițiilor (mutex de OS, non-blocant) cu reîncercare la 0,1 s, cel mult `lacat_s`."""
        def __init__(self, coada):
            self.coada, self.cm = coada, None

        def __enter__(self):
            c = self.coada
            end = time.monotonic() + c.lacat_s
            c.root.mkdir(parents=True, exist_ok=True)
            while True:
                cm = mutex(c.root / 'coada.lock')
                try:
                    cm.__enter__()
                    self.cm = cm
                    return self
                except E3Error:
                    if time.monotonic() >= end:
                        raise E3Error('ocupat') from None
                    c.sleep(0.1)

        def __exit__(self, *exc):
            return self.cm.__exit__(*exc)

    def tranzitie(self):
        return Coada._Tranzitie(self)

    def ids(self):
        if not self.cereri.exists():
            return []
        out = []
        for p in self.cereri.iterdir():
            m = ID_RE.match(p.stem) if p.suffix == '.json' else None
            if m and p.is_file():
                out.append(p.stem)
        return sorted(out, key=lambda s: int(s[1:]))

    def citeste(self, id):
        """Cererea validată (valideaza_cerere). ValueError = cerere invalidă (JSON stricat, structură, fișier nesigur);
        OSError = citire eșuată acum (tranzitoriu)."""
        if not ID_RE.match(str(id)):
            raise ValueError('id invalid: %r' % id)
        p = self.cereri / (id + '.json')
        st = os.lstat(p)
        if _reparse(st) or not stat.S_ISREG(st.st_mode) or st.st_nlink > 1:
            raise ValueError('fisierul cererii nu e un fisier obisnuit (reparse / legatura fizica)')
        try:
            c = json.loads(p.read_text(encoding='utf-8'))
        except UnicodeDecodeError:
            raise ValueError('JSON ilizibil (nu e UTF-8)') from None
        except ValueError as e:
            raise ValueError('JSON ilizibil: %s' % str(e)[:120]) from None
        return valideaza_cerere(c, id)

    def izoleaza(self, id, motiv):
        """Cerere invalidă (r1 P2): originalul (orice ar fi, fără a-l urma) se mută în cereri/invalide/, iar în locul lui
        rămâne o cerere `eroare` cu motivul și urma originalului. Se cheamă DOAR sub tranziție. Coada merge mai departe."""
        p = self.cereri / (id + '.json')
        inv = self.cereri / 'invalide'
        inv.mkdir(exist_ok=True)
        _intrare_sigura(str(inv), os.lstat(inv), dir_asteptat=True)
        original_sha = None
        try:
            st = os.lstat(p)
            if not _reparse(st) and stat.S_ISREG(st.st_mode) and st.st_nlink == 1:
                original_sha = sha_fisier(p)
        except OSError:
            pass
        dest = inv / ('%s_%s.json' % (id, dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
        os.replace(p, dest)  # mută numele (link-ul însuși, nu ținta)
        c = {'id': id, 'cine': None, 'creat_la': None, 'stare': 'eroare', 'motiv': ('cerere invalida: %s' % motiv)[:500],
             'planuri': [], 'dezacorduri': None, 'versiune': 0,
             'original': str(dest.relative_to(self.root)), 'original_sha256': original_sha}
        self.scrie(c)
        jurnal(self.root, 'cerere_invalida', cerere=id, motiv=c['motiv'], original=c['original'])
        return c

    def scrie(self, c):
        c['actualizat_la'] = acum_iso()
        c['versiune'] = int(c.get('versiune', 0)) + 1
        self.cereri.mkdir(parents=True, exist_ok=True)
        save(self.cereri / (c['id'] + '.json'), c)

    def toate(self):
        out = []
        for id in self.ids():
            try:
                out.append(self.citeste(id))
            except (OSError, ValueError) as e:
                out.append({'id': id, 'stare': 'ilizibil', 'motiv': str(e)[:200], 'planuri': []})
        return out

    def adauga(self, planuri, cine):
        """Validează tot ÎNAINTE de scriere; o singură cerere cu toate planurile. Refuz (ValueError) dacă un plan e deja
        într-o cerere activă (așteaptă sau în lucru) sau apare de două ori în aceeași comandă."""
        if not isinstance(cine, str) or not CINE_RE.match(cine):
            raise ValueError('--cine: litere, cifre, _ . - (max 40), ex. chat, juridic, cowork')
        if not planuri:
            raise ValueError('niciun plan')
        if len(planuri) > MAX_PLANURI:
            raise ValueError('cel mult %d planuri pe cerere' % MAX_PLANURI)
        intrari, chei = [], set()
        for p in planuri:
            _, _, info = valideaza_plan(p, self.radacini)
            k = cheie_cale(info['cale'])
            if k in chei:
                raise ValueError('planul apare de doua ori: %s' % info['cale'])
            chei.add(k)
            intrari.append(dict(info, lighton=None, mineru=None, dezacorduri=None, e_cantitate=None, text_conv=None,
                                eroare=None, incercari=0))
        with self.tranzitie():
            existente = self.toate()
            for c in existente:
                if c.get('stare') in ACTIVE:
                    for p in c.get('planuri', []):
                        if cheie_cale(p.get('cale', '')) in chei:
                            raise ValueError('planul %s e deja in cererea %s (%s)' % (p.get('cale'), c['id'], c['stare']))
            n = 1 + max([int(c['id'][1:]) for c in existente if ID_RE.match(str(c.get('id', '')))] or [0])
            c = {'id': 'c%06d' % n, 'cine': cine, 'creat_la': acum_iso(), 'stare': 'asteapta', 'motiv': None,
                 'planuri': intrari, 'dezacorduri': None, 'versiune': 0}
            self.scrie(c)
        jurnal(self.root, 'adaugat', cerere=c['id'], cine=cine, planuri=len(intrari))
        return c

    def anuleaza(self, id):
        with self.tranzitie():
            c = self.citeste(id)
            if c.get('stare') != 'asteapta':
                raise ValueError('cererea %s e %s: se anuleaza doar cererile in asteptare' % (id, c.get('stare')))
            c.update(stare='anulata', motiv='anulata inainte de preluare')
            self.scrie(c)
        jurnal(self.root, 'anulat', cerere=id)
        return c

    def preia_lot(self):
        """Lotul = toate cererile active, în ordinea numerelor. Cele în așteptare trec în `citeste_lighton` sub lacăt
        (CAS pe stare: o cerere anulată între timp nu intră). Cele rămase în lucru după o cădere se reiau.
        O cerere invalidă (ValueError) se izolează ca eroare, cu motiv (r1 P2); o citire eșuată acum (OSError) se sare
        în lotul acesta și se încearcă la următorul (nu e dovadă că cererea e stricată)."""
        with self.tranzitie():
            lot = []
            for id in self.ids():
                try:
                    c = self.citeste(id)
                except ValueError as e:
                    try:
                        self.izoleaza(id, str(e))
                    except (OSError, ValueError) as e2:
                        # nici izolarea n-a mers (ex. cereri/invalide nesigur): cererea rămâne pe loc, sărită, o linie în jurnal
                        if id not in self._izolare_esuata:
                            jurnal(self.root, 'izolare_esuata', cerere=id, motiv=str(e2)[:200])
                        self._izolare_esuata.add(id)
                    continue
                except OSError:
                    continue
                if c.get('stare') == 'asteapta':
                    c['stare'] = 'citeste_lighton'
                    c['preluat_la'] = acum_iso()
                    self.scrie(c)
                    lot.append(c)
                elif c.get('stare') in ACTIVE:
                    lot.append(c)
            return lot

    def stare(self, cine=None):
        out = []
        for c in self.toate():
            if cine and c.get('cine') != cine:
                continue
            out.append({'id': c.get('id'), 'cine': c.get('cine'), 'stare': c.get('stare'), 'motiv': c.get('motiv'),
                        'planuri': len(c.get('planuri', [])), 'dezacorduri': c.get('dezacorduri'),
                        'pagini_nerezolvate': sum(p.get('pagini_nerezolvate') or 0 for p in c.get('planuri', [])),
                        'creat_la': c.get('creat_la'), 'actualizat_la': c.get('actualizat_la')})
        try:
            proces = json.loads((self.root / 'stare.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            proces = {'faza': 'necunoscut'}
        return {'proces': proces, 'cereri': out}


def jurnal(root, ev, **campuri):
    root = pathlib.Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'jurnal.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'la': acum_iso(), 'ev': ev, **campuri}, ensure_ascii=False) + '\n')


# --- textul convocator -------------------------------------------------------------------------------------------------
def text_plan(plan_dir, doc):
    """Textul pe document (asamblare.asambleaza_document) în <plan>/text_conv.txt. Paginile native se citesc din PDF-ul sursă
    DOAR dacă e pe o rădăcină de citire și are sha256 = input_sha256 din plan; altfel textul se sare (nu e eroare)."""
    from .asamblare import asambleaza_document
    plan_dir = pathlib.Path(plan_dir)
    candidati = [plan_dir.parent / 'pdf' / (plan_dir.name + '.pdf')]
    src = doc.get('source')
    if isinstance(src, str):
        norm = src.replace('\\', '/')
        if (norm.lower().endswith('.pdf') and ':' not in norm[2:] and '/../' not in norm + '/'
                and norm.lower().startswith(tuple(s.lower() for s in SURSE_TEXT))):
            candidati.append(pathlib.Path(src))
    sursa = None
    for cand in candidati:
        try:
            if cand.is_file() and sha_fisier(cand) == doc.get('input_sha256'):
                sursa = cand
                break
        except OSError:
            continue
    if sursa is None:
        return {'sarit': 'sursa PDF negasita sau schimbata fata de plan'}
    import fitz
    pagini = sorted({int(p['page']) for p in doc.get('pages', [])})
    with fitz.open(sursa) as pdf:
        native = {n: pdf[n - 1].get_text() for n in pagini if 1 <= n <= pdf.page_count}
    text, st = asambleaza_document(plan_dir.parent, plan_dir.name, pagini_native=native)
    (plan_dir / 'text_conv.txt').write_text(text, encoding='utf-8', newline='\n')
    return {'cale': str(plan_dir / 'text_conv.txt'), 'caractere': st['caractere'], 'sha256': st['sha256'],
            'pagini_native': st.get('native'), 'pagini_ocr': st.get('ocr')}


# --- procesul unic -------------------------------------------------------------------------------------------------------
class Oprit(BaseException):
    """Oprirea cerută (fișierul <root>/opreste): ieșire curată după banda curentă. BaseException: niciun
    `except Exception` de pe drum nu o înghite."""


class Lucrator:
    def __init__(self, root, coordinator, models, *, gpu_lock_path, radacini=None, run_reader=None, compare=None,
                 text=text_plan, clock=time.monotonic, sleep=time.sleep, pauza=None, pornire_max_s=PORNIRE_MAX_S,
                 poll_s=ASTEPTARE_POLL_S):
        from .read import run_reader as _rr
        from .compare import compare as _cmp
        self.root = pathlib.Path(root)
        self.coada = Coada(self.root, radacini=radacini, sleep=sleep)
        self.c, self.models, self.lock = coordinator, models, coordinator.lock
        self.gpu_lock_path = pathlib.Path(gpu_lock_path)
        self.globale = cai_globale(self.gpu_lock_path)
        # Instanța și obligația memoriei sunt ale plăcii (r1 P1): un coordinator cu starea în altă parte (ex. în rădăcina
        # cozii) sau cu alt lacăt / alt deținător ar reface exact defectul -> refuz la construire.
        if (cheie_cale(coordinator.path) != cheie_cale(self.globale['modele'])
                or cheie_cale(self.lock.path) != cheie_cale(self.gpu_lock_path) or self.lock.detinator != DETINATOR):
            raise ValueError('coordinatorul cozii trebuie sa foloseasca %s, %s si detinatorul %s'
                             % (self.gpu_lock_path, self.globale['modele'], DETINATOR))
        self.radacini, self.run_reader, self.compare, self.text = radacini, run_reader or _rr, compare or _cmp, text
        self.clock, self._sleep, self.pornire_max_s, self.poll_s = clock, sleep, pornire_max_s, poll_s
        self.pauza = pauza or Pauza(plafon=3600, baza=60)
        self.vram_inainte, self._ultim_esec, self._faza, self._stare_la = None, None, None, float('-inf')
        # tin = coada a luat lacătul și încă nu are dovada eliberării (model pornit sau doar lacătul). False = nimic al cozii
        # pe placă: elibereaza() nu mai ia un lacăt liber doar ca să-l elibereze (fereastră furată lui E3).
        self.tin = False

    # --- mici ajutoare -----------------------------------------------------------------------------------------------
    def jurnal(self, ev, **k):
        jurnal(self.root, ev, **k)

    def oprire_ceruta(self):
        return (self.root / 'opreste').exists()

    def cerere_e3(self):
        return cerere_activa(self.gpu_lock_path)

    def cedare(self):
        """Pentru read.run_reader, înaintea fiecărei benzi: oprirea cozii, apoi cererea E3."""
        if self.oprire_ceruta():
            return 'oprit'
        if self.cerere_e3():
            return 'cedat_e3'
        return None

    def dormi(self, s):
        """Somn în pași de cel mult 1 s; oprirea cerută îl scurtează (Oprit)."""
        end = self.clock() + max(0.0, s)
        while True:
            if self.oprire_ceruta():
                raise Oprit()
            rest = end - self.clock()
            if rest <= 0:
                return
            self._sleep(min(1.0, rest))

    def stare(self, faza, **k):
        t = self.clock()
        if faza == self._faza and t - self._stare_la < STARE_MAX_S and not k:
            return
        self._faza, self._stare_la = faza, t
        save(self.root / 'stare.json', {'faza': faza, 'pid': os.getpid(), 'la': acum_iso(), 'versiune': VERSIUNE, **k})

    def esec(self, cod):
        """Pauză crescătoare cu plafon (60 s -> 3600 s); în jurnal o linie pe treaptă / cauză nouă."""
        treapta, asteptare = self.pauza.esec()
        if self._ultim_esec != (treapta, cod):
            self.jurnal('pauza', cod=cod, treapta=treapta)
        self._ultim_esec = (treapta, cod)
        self.stare('pauza', cod=cod)
        self.dormi(asteptare)

    def reusita(self):
        if self.pauza.esecuri:
            self.jurnal('reluat')
        self.pauza.reset()
        self._ultim_esec = None

    # --- placa video ---------------------------------------------------------------------------------------------------
    def elibereaza(self, motiv):
        """Oprește modelele și eliberează lacătul DOAR după dovada opririi (procese + memorie, Coordinator.descarca).
        Neconfirmat = lacătul rămâne al cozii, pauză, se reîncearcă. Oprirea cerută în timp ce memoria nu e confirmată:
        ieșire cu lacătul păstrat (curățenia de la pornire îl rezolvă), niciodată eliberare fără dovadă."""
        while self.tin:
            try:
                ok = self.c.descarca(self.vram_inainte, verifica_memoria=self.vram_inainte is not None)
            except Exception as exc:
                ok, cod = False, cod_exceptie(exc)
            else:
                cod = 'descarcare_neconfirmata'
            if ok is None or ok:
                # None = lacătul e acum al altcuiva (șters de mână și preluat): sub lacătul altuia nu se oprește nimic
                self.vram_inainte, self.tin = None, False
                self.jurnal('descarcat' if ok else 'lacat_pierdut', motiv=motiv)
                return
            self.esec(cod)

    def _lacat_existent(self):
        """None = gpu.lock nu există; altfel tokenul din el ('' = ilizibil / fără token: tot preluare)."""
        try:
            old = json.loads(self.gpu_lock_path.read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            return ''
        return str(old.get('token') or '') if isinstance(old, dict) else ''

    def curata_pornire(self):
        """Înainte de orice: dacă lacătul e liber sau e al unei instanțe moarte a cozii, modelele rămase se opresc
        (memoria confirmată dacă există obligația pe disc, ocr_coada.modele.json, comună tuturor rădăcinilor). Lacătul
        altuia (E3, laborator) nu se atinge. Lacătul preluat de la o instanță căzută (sau ilizibil) = memoria se verifică
        ORICUM, chiar dacă fișierul obligației lipsește (Jakarinos #1190 r1 P1: necunoscut ≠ liber, L18)."""
        preluat = False
        while True:
            try:
                if not self.tin:
                    vechi = self._lacat_existent()
                    if not self.lock.claim():
                        self.jurnal('pornire_lacat_altcuiva')
                        return
                    preluat = vechi is not None and vechi != self.lock.token
                    if preluat:
                        self.jurnal('lacat_preluat_la_pornire')
                self.tin = True
                ok = self.c.descarca(None, verifica_memoria=preluat)
            except Exception as exc:
                self.esec(cod_exceptie(exc))
                continue
            if ok is None or ok:
                self.tin = False
                self.jurnal('curatat_la_pornire')
                self.reusita()
                return
            self.esec('descarcare_neconfirmata')

    def ia_placa(self, reader):
        """'gata' = lacătul e al cozii și modelul răspunde; 'reia' = încă nu (cedare / memorie ținută / eroare cu pauză).
        Așteptarea după o cedare e tot aici: cât e o cerere E3 activă sau lacătul e al altcuiva (E3 îl ia înainte să-și
        retragă cererea), coada nu ia nimic."""
        while True:
            if self.cerere_e3():
                self.stare('asteapta_e3')
                self.dormi(self.poll_s)
                continue
            if not self.lock.claim():
                self.stare('asteapta_lacat')
                self.dormi(self.poll_s)
                continue
            self.tin = True
            break
        try:
            if any(self.models.processes().values()):
                # vLLM pe căile modelelor sub lacătul nostru (rest neadoptat): oprit cu dovadă, apoi de la capăt
                self.elibereaza('rest_la_preluare')
                return 'reia'
            vram = self.models.memory_mb()
            if vram >= self.models.baseline + VRAM_MARJA_MB:
                # Memoria plăcii e ținută de cineva fără lacăt: nu pornim vLLM peste el (OOM). Nimic pornit = nimic de dovedit.
                self.lock.release()
                self.tin = False
                if self._ultim_esec != ('memorie', None):
                    self.jurnal('memorie_tinuta', mb=round(vram))
                self._ultim_esec = ('memorie', None)
                self.stare('asteapta_memorie')
                self.dormi(self.poll_s)
                return 'reia'
            # Obligația de a dovedi eliberarea memoriei se scrie pe disc ÎNAINTE de pornire (o cădere nu o pierde).
            self.vram_inainte = vram
            save(self.c.path, {'cititor': reader, 'vram_inainte': vram, 'starter': self.lock.token})
            self.models.verify(reader)
            pid = self.models.start(reader)
            save(self.c.path, {'cititor': reader, 'vram_inainte': vram, 'starter': self.lock.token, 'pid': pid})
            self.stare('pornire_' + reader)
            t0 = self.clock()
            while not self.models.healthy(reader):
                motiv = self.cedare()
                if motiv == 'oprit':
                    raise Oprit()
                if motiv:
                    self.elibereaza(motiv)
                    self.jurnal('cedat_e3', cititor=reader, faza='pornire')
                    return 'reia'
                if self.clock() - t0 >= self.pornire_max_s:
                    raise E3Error('pornire_esuata')
                self.dormi(SANATATE_POLL_S)
            self.jurnal('incarcat', cititor=reader, secunde=round(self.clock() - t0, 1))
            # pauza NU se resetează aici: doar un plan citit complet dovedește progresul (altfel model ok + plan care
            # cade mereu = aceeași treaptă la nesfârșit)
            return 'gata'
        except Oprit:
            self.elibereaza('oprit')
            raise
        except Exception as exc:
            self.elibereaza('pornire_esuata')
            self.esec(cod_exceptie(exc))
            return 'reia'

    # --- o cerere / un plan ----------------------------------------------------------------------------------------------
    def _eroare_plan(self, c, p, motiv):
        p['eroare'] = motiv[:300]
        self.coada.scrie(c)
        self.jurnal('plan_eroare', cerere=c['id'], plan=p['cale'], motiv=p['eroare'])

    def _plan_dir(self, p):
        """Înaintea fiecărei citiri și a comparării: calea, plan.json neschimbat, planul valid ȘI destinațiile scrierilor
        (arborele planului fără reparse / legături fizice, r1 P1) -> (folder, plan)."""
        from .plan import load_plan
        d = cale_sigura(p['cale'], self.radacini)
        if sha_fisier(d / 'plan.json') != p.get('plan_sha256'):
            raise ValueError('plan.json s-a schimbat dupa adaugare')
        doc = load_plan(d)
        verifica_destinatii_plan(d, doc)
        return d, doc

    def citeste_plan(self, c, p, reader):
        """'complete' | 'plan_eroare' | 'repornire' (plan în eroare + modelul se oprește, backend neconfirmat liber)
        | 'cedat_e3' | 'oprit' | 'infra' (excepție neprevăzută, se reîncearcă după pauză, cel mult MAX_INCERCARI_PLAN)."""
        try:
            d, _ = self._plan_dir(p)
        except (ValueError, OSError, KeyError, TypeError) as e:
            self._eroare_plan(c, p, 'plan: %s' % str(e)[:200])
            return 'plan_eroare'
        try:
            st = self.run_reader(d, reader, run_id='coada_%s_%s' % (c['id'], reader), lock=False, cedare=self.cedare)
        except Exception as exc:
            p['incercari'] = int(p.get('incercari') or 0) + 1
            if p['incercari'] >= MAX_INCERCARI_PLAN:
                self._eroare_plan(c, p, '%s: %s (de %d ori)' % (reader, cod_exceptie(exc), p['incercari']))
                return 'repornire'
            self.coada.scrie(c)
            self.jurnal('citire_exceptie', cerere=c['id'], plan=p['cale'], cod=cod_exceptie(exc), incercari=p['incercari'])
            return 'infra'
        status = st.get('status')
        if status == 'complete':
            p[reader] = 'complete'
            self.coada.scrie(c)
            return 'complete'
        if status in ('cedat_e3', 'oprit'):
            return status
        p[reader] = status
        self._eroare_plan(c, p, '%s %s (banda %s)' % (reader, status, st.get('band')))
        # stopped_no_retry: cererea către vLLM poate rula încă -> modelul se oprește (cu dovadă) înainte de planul următor
        return 'repornire' if status == 'stopped_no_retry' else 'plan_eroare'

    def sesiune_cititor(self, reader, de_citit):
        ramase = list(de_citit)
        while ramase:
            if self.ia_placa(reader) != 'gata':
                continue
            iesire = None
            while ramase:
                c, p = ramase[0]
                motiv = self.cedare()
                if motiv:
                    iesire = motiv
                    break
                if not self.models.healthy(reader):
                    iesire = 'model_cazut'
                    break
                self.stare('citeste_' + reader, cerere=c['id'], plan=p['cale'])
                r = self.citeste_plan(c, p, reader)
                if r == 'complete':
                    self.reusita()
                if r in ('complete', 'plan_eroare', 'repornire'):
                    ramase.pop(0)
                if r not in ('complete', 'plan_eroare'):
                    iesire = r
                    break
            self.elibereaza(iesire or 'gata_' + reader)
            if iesire == 'oprit':
                raise Oprit()
            if iesire == 'cedat_e3':
                self.jurnal('cedat_e3', cititor=reader, faza='citire')  # ia_placa așteaptă E3 la pasul următor
            elif iesire in ('infra', 'model_cazut'):
                self.esec(iesire)

    def _finalizeaza(self, c):
        erori = [p for p in c['planuri'] if p.get('eroare')]
        c['dezacorduri'] = sum(p.get('dezacorduri') or 0 for p in c['planuri'] if p.get('dezacorduri') is not None)
        c['stare'] = 'eroare' if erori else 'gata'
        c['motiv'] = ('; '.join('%s: %s' % (pathlib.Path(p['cale']).name, p['eroare']) for p in erori))[:500] or None
        self.coada.scrie(c)
        self.jurnal(c['stare'], cerere=c['id'], dezacorduri=c['dezacorduri'], motiv=c['motiv'])

    def compara(self, c):
        for p in c['planuri']:
            if p.get('eroare') or p.get('lighton') != 'complete' or p.get('mineru') != 'complete':
                if not p.get('eroare'):
                    self._eroare_plan(c, p, 'citire neterminata')
                continue
            try:
                d, doc = self._plan_dir(p)
                rez = self.compare(d)[0]
                p['dezacorduri'], p['e_cantitate'] = rez.get('disagreements'), rez.get('e_cantitate')
            except Exception as e:
                self._eroare_plan(c, p, 'compara: %s' % str(e)[:200])
                continue
            try:
                p['text_conv'] = self.text(d, doc)
            except Exception as e:
                p['text_conv'] = {'eroare': '%s: %s' % (type(e).__name__, str(e)[:160])}
            self.coada.scrie(c)
        self._finalizeaza(c)

    def proceseaza(self, lot):
        for reader in READERS:
            de_citit = []
            for c in lot:
                if c['stare'] not in ACTIVE:
                    continue
                tinta = 'citeste_' + reader
                if ACTIVE.index(c['stare']) < ACTIVE.index(tinta):  # o cerere reluată după cădere nu dă înapoi
                    c['stare'] = tinta
                    self.coada.scrie(c)
                de_citit += [(c, p) for p in c['planuri'] if not p.get('eroare') and p.get(reader) != 'complete']
            if de_citit:
                self.sesiune_cititor(reader, de_citit)
            for c in lot:  # cererile fără niciun plan reușit nu mai așteaptă celălalt cititor
                if c['stare'] in ACTIVE and all(p.get('eroare') for p in c['planuri']):
                    self._finalizeaza(c)
        self.stare('compara')
        for c in lot:
            if c['stare'] in ACTIVE:
                c['stare'] = 'compara'
                self.coada.scrie(c)
                self.compara(c)

    def lucreaza(self, o_data=False):
        """Procesul unic pe MAȘINĂ: mutex de OS (eliberat și la cădere) pe ocr_coada.instanta.lock de lângă gpu.lock,
        oricare ar fi --root (r1 P1). Înainte: destinațiile din rădăcină și de lângă gpu.lock verificate (fără reparse /
        legături fizice). o_data = iese când coada e goală."""
        verifica_radacina(self.root)
        verifica_fisiere_globale(self.globale['instanta'], self.globale['modele'], self.globale['info'],
                                 # GpuLock: .coord = mutex (scriere pe loc), .pending (+ .tmp) = save înainte de rename;
                                 # gpu.lock însuși nu (pe POSIX are un al doilea nume o clipă, os.link + unlink)
                                 str(self.gpu_lock_path) + '.coord', str(self.gpu_lock_path) + '.pending')
        self.root.mkdir(parents=True, exist_ok=True)
        with mutex(self.globale['instanta']):
            (self.root / 'opreste').unlink(missing_ok=True)
            save(self.globale['info'], {'root': str(self.root), 'pid': os.getpid(), 'la': acum_iso(), 'versiune': VERSIUNE})
            self.jurnal('pornire', pid=os.getpid(), versiune=VERSIUNE, radacina=str(self.root))
            self.stare('pornire')
            try:
                self.curata_pornire()
                while True:
                    if self.oprire_ceruta():
                        raise Oprit()
                    lot = self.coada.preia_lot()
                    if not lot:
                        if o_data:
                            break
                        self.stare('liber')
                        self.dormi(self.poll_s)
                        continue
                    self.jurnal('lot', cereri=[c['id'] for c in lot])
                    self.proceseaza(lot)
            except Oprit:
                try:
                    self.elibereaza('oprit')  # încă o încercare cu dovadă; fără dovadă lacătul rămâne
                except Oprit:
                    pass
                # lacat_pastrat = memoria n-a fost confirmată la oprire: lacătul rămâne (curățenia de la pornire îl rezolvă)
                self.jurnal('oprit', lacat_pastrat=self.tin)
            except Exception as exc:
                self.jurnal('cadere', cod=cod_exceptie(exc), lacat_pastrat=self.tin)
                raise
            self.stare('oprit', lacat_pastrat=self.tin)
        return 0


# --- linia de comandă ------------------------------------------------------------------------------------------------
def main(argv=None):
    p = argparse.ArgumentParser(prog='ocr_local coada', description='Coada de citire OCR local: sesiunile cer, un singur proces citeste.')
    comun = argparse.ArgumentParser(add_help=False)
    comun.add_argument('--root', type=pathlib.Path, default=ROOT, help='folderul cozii (implicit %s)' % ROOT)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('adauga', parents=[comun], help='cere citirea unor planuri (plan_dir cu plan.json, sub paw-data)')
    a.add_argument('planuri', nargs='+'); a.add_argument('--cine', required=True)
    s = sub.add_parser('stare', parents=[comun], help='cererile si procesul'); s.add_argument('--cine')
    n = sub.add_parser('anuleaza', parents=[comun], help='anuleaza o cerere in asteptare'); n.add_argument('id')
    w = sub.add_parser('lucreaza', parents=[comun], help='procesul unic (Task Scheduler); --config = config-ul WSL al E3')
    w.add_argument('--config', type=pathlib.Path, required=True)
    w.add_argument('--o-data', action='store_true', help='iese cand coada e goala')
    sub.add_parser('opreste', parents=[comun], help='opreste procesul dupa banda curenta (modelul oprit, lacatul eliberat)')
    x = p.parse_args(argv)
    try:
        # rădăcina cozii respectă aceleași reguli ca planurile (fără plan.json): sub paw-data, fără UNC / ADS / reparse
        root = verifica_radacina(cale_radacina(str(x.root)))
        q = Coada(root)
        if x.cmd == 'adauga':
            res = q.adauga(x.planuri, x.cine)
        elif x.cmd == 'stare':
            res = q.stare(x.cine)
            from .read import protocol
            try:  # procesul unic e al mașinii: arată și pe ce rădăcină rulează (poate fi alta decât --root)
                res['instanta'] = json.loads(cai_globale(protocol()['gpu_lock'])['info'].read_text(encoding='utf-8'))
            except (OSError, ValueError, KeyError):
                res['instanta'] = None
        elif x.cmd == 'anuleaza':
            res = q.anuleaza(x.id)
        elif x.cmd == 'opreste':
            root.mkdir(parents=True, exist_ok=True)
            (root / 'opreste').touch()
            res = {'opreste': True}
        else:
            from .e3_gpu import WslModels
            from .read import protocol
            cfg, proto = json.loads(x.config.read_text(encoding='utf-8')), protocol()
            models = WslModels(cfg, proto)
            lock = GpuLock(proto['gpu_lock'], detinator=DETINATOR)
            coord = Coordinator(lock, models, cai_globale(proto['gpu_lock'])['modele'])  # obligația = a plăcii (r1 P1)
            return Lucrator(root, coord, models, gpu_lock_path=proto['gpu_lock']).lucreaza(o_data=x.o_data)
    except (ValueError, E3Error) as e:
        print(json.dumps({'eroare': str(getattr(e, 'cod', None) or e)}, ensure_ascii=False))
        return 2
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))
    return 0


def cale_radacina(p, radacini=None):
    """Rădăcina cozii: aceleași verificări de cale ca la planuri, fără cerința plan.json (poate să nu existe încă)."""
    if not isinstance(p, str) or p.startswith(('\\\\', '//')) or re.search(r'["\x00-\x1f]', p):
        raise ValueError('radacina cozii refuzata: %s' % p)
    if os.name == 'nt' and (':' in p[2:] or not re.match(r'^[A-Za-z]:[\\/]', p)):
        raise ValueError('radacina cozii refuzata: %s' % p)
    full = os.path.abspath(p)
    if not sub_radacini(full, radacini):
        raise ValueError('radacina cozii in afara paw-data: %s' % full)
    cur = full
    while True:
        try:
            if _reparse(os.lstat(cur)):
                raise ValueError('reparse point refuzat: %s' % cur)
        except FileNotFoundError:
            pass
        parinte = os.path.dirname(cur)
        if parinte == cur:
            return pathlib.Path(full)
        cur = parinte


if __name__ == '__main__':
    sys.exit(main())
