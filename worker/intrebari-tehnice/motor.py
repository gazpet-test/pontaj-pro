"""Adaptorul workerului către MOTORUL UNIC de reguli (r4, PR #1086; deciziile owner-ului 13.11.2026: A și B).

Toate regulile (mascarea numelor, învățarea / propagarea, etichetele, demascarea, regula B) stau într-un singur loc:
src/intrebariMascare.js — același modul pe care îl folosește și ecranul pentru previzualizare. Aici NU e nicio regulă: doar
transportul către un proces Node (worker/intrebari-tehnice/motor_cli.mjs) și verificările lui. Python nu face „mici corecții”
nici înainte, nici după motor: ce întoarce motorul se folosește ca atare sau, la orice abatere, nimic (MotorEroare).

Livrarea verificabilă:
- motor_manifest.json (din repo, copiat lângă script) = sha256 (cu LF) pentru motor și TOATE fișierele lui locale (protocolul,
  intrarea, cele trei JSON-uri), plus protocolul, versiunea motorului, versiunea majoră Node (24, ca package.json) și versiunea
  Unicode a lui Node; la pornirea workerului fiecare fișier se citește O DATĂ, se verifică și se copiază într-un instantaneu
  privat (directorul temporar al utilizatorului, doar citire). Toate procesele pornesc din instantaneu, deci o copiere nouă a
  fișierelor din repo în timpul rulării nu schimbă motorul folosit; înainte de fiecare proces instantaneul se reverifică.
- procesul Node primește în salut amprentele fișierelor pe care le încarcă și versiunile lui; orice diferență față de manifest →
  MotorEroare, procesul e oprit.

Protocolul (motor_protocol.mjs): câte un obiect JSON pe linie, UTF-8 explicit, cu versiunea protocolului și câmpurile validate la
ambele capete; stdout doar pentru protocol; stderr închis (nimic din speță sau din dicționar nu ajunge în jurnale); procesul se
lansează DIRECT (listă de argumente, fără shell), cu un mediu minim (fără NODE_OPTIONS moștenit), iar dicționarul vine pe stdin,
nu ca argument. Un proces = o speță: starea (dicționarul, etichetele, ce s-a învățat, tabelul de demascare) nu se împarte cu
altă speță, nici la rulări concurente.

Fail-closed: Node lipsă, versiune greșită, amprentă greșită, proces căzut, timp depășit, JSON trunchiat, schemă greșită, ieșire
prea mare → MotorEroare (cu un cod scurt, fără text). Workerul nu mai trimite nicio cerere către model și nu publică nimic;
textul original nu ia niciodată locul celui mascat.

Fără rețea în motor: Node rulează cu --permission (fără scriere pe disc, fără procese copil, fără workeri / module native,
citire doar din instantaneu); Node 24 nu are încă permisiune pentru rețea, așa că motorul și protocolul sunt verificați STATIC
(src/intrebariMascare.motor.test.js: nu importă nimic în afara propriilor fișiere, nu folosesc fetch / socket / eval), iar
motor_cli.mjs scoate funcțiile de rețea globale înainte să încarce motorul.

Garda spre furnizor (decizia A, pct. 2): TextMascat e SINGURUL tip de conținut pe care apel() din intrebari_worker.py îl lasă
să plece; se obține doar din Sesiune.mascheaza() (sigiliu privat) și e legat de SESIUNEA care l-a produs (Sesiune.a_produs).
"""
import hashlib, json, os, pathlib, queue, re, shutil, stat, subprocess, sys, tempfile, threading, time  # noqa: F401

AICI = pathlib.Path(__file__).resolve().parent
MANIFEST_FILE = AICI / 'motor_manifest.json'
# rădăcina din care se citesc fișierele motorului (căile din manifest sunt relative la ea): INTREBARI_MOTOR_RADACINA, dacă e setată;
# altfel subfolderul `motor` de lângă worker (pe server: fișierele copiate cu structura repo-ului — docs, „Pașii de pornire”); altfel
# (în repo) rădăcina repo-ului
_LANGA = AICI / 'motor'
RADACINA = pathlib.Path(os.environ.get('INTREBARI_MOTOR_RADACINA') or (_LANGA if _LANGA.is_dir() else AICI.parent.parent))
TERMEN_CERERE = 30.0          # secunde pe o operație
TERMEN_INIT = 120.0           # salutul + încărcarea dicționarului
TERMEN_SESIUNE = 30 * 60.0    # o speță întreagă (BD închide oricum preluarea după 30 de minute)
MAX_IESIRE = 16 * 1024 * 1024   # octeți pe o linie de răspuns (= MAX_IESIRE din motor_cli.mjs)
MAX_INTRARE = 64 * 1024 * 1024  # octeți pe o linie de cerere (= MAX_INTRARE din motor_cli.mjs)
CHEI_MANIFEST = frozenset(('versiune', 'protocol', 'motor', 'node_major', 'unicode', 'intrare', 'fisiere', '_despre'))
MOTIVE_DEMASCARE = frozenset(('eticheta_neemisa', 'eticheta_din_model', 'eticheta_rupta'))
MOTIVE_REGULA_B = frozenset(('citat', 'fara_citat', 'depinde', 'incert', 'fara_verdict'))
TIPURI_VERDICT = frozenset(('da', 'nu', 'incert', None))
CATEGORII = frozenset(('PERSOANA', 'FIRMA', 'CNP', 'CUI', 'TELEFON', 'EMAIL', 'IBAN', 'NR_AUTO', 'ASCUNS'))
COD_EROARE = re.compile(r'[a-z_]{1,40}')
CHEI_SURSA = ('id', 'titlu', 'extras', 'inceput_sigur', 'sfarsit_sigur')


class MotorEroare(Exception):
    """Motorul nu poate fi folosit sigur. `cod` e scurt și fără date (merge în jurnal)."""

    def __init__(self, cod):
        super().__init__(cod)
        self.cod = str(cod)


def _lf(b):
    return b.replace(b'\r\n', b'\n')


def citeste_manifest(cale=None):
    """Manifestul motorului, validat (formă, căi relative sigure, amprente sha256). Altfel MotorEroare('manifest')."""
    try:
        m = json.loads(pathlib.Path(cale or MANIFEST_FILE).read_text(encoding='utf-8'))
    except Exception:
        raise MotorEroare('manifest') from None
    if not isinstance(m, dict) or not set(m) <= CHEI_MANIFEST or not (CHEI_MANIFEST - {'_despre'}) <= set(m): raise MotorEroare('manifest')
    if m['versiune'] != 1 or type(m['protocol']) is not int or type(m['node_major']) is not int: raise MotorEroare('manifest')
    if not isinstance(m['motor'], str) or not isinstance(m['unicode'], str) or not isinstance(m['fisiere'], dict): raise MotorEroare('manifest')
    for rel, h in m['fisiere'].items():
        if (not isinstance(rel, str) or not re.fullmatch(r'[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-.]+)*\.(?:js|mjs|json)', rel) or '..' in rel
                or not isinstance(h, str) or not re.fullmatch(r'[0-9a-f]{64}', h)):
            raise MotorEroare('manifest')
    if m['intrare'] not in m['fisiere']: raise MotorEroare('manifest')
    return m


def _mediu_minim():
    """Mediul procesului Node: fără NODE_OPTIONS / NODE_PATH moștenite (ar putea încărca alt cod)."""
    return {k: os.environ[k] for k in ('SYSTEMROOT', 'WINDIR') if k in os.environ}


class TextMascat(str):
    """Text întors de Sesiune.mascheaza(). Singurul tip de conținut acceptat de apel() spre furnizor. Orice operație pe el
    (concatenare, felii, format) întoarce un str simplu. Tipul singur nu dovedește proveniența (str.__new__ ocolește
    constructorul): garda cere și Sesiune.a_produs(x) — același obiect, din registrul sesiunii care a mascat."""
    __slots__ = ()

    def __new__(cls, valoare, sigiliu=None):
        if sigiliu is not _SIGILIU:
            raise TypeError('TextMascat se obține doar din Sesiune.mascheaza()')
        return super().__new__(cls, valoare)


_SIGILIU = object()


class Motor:
    """Instalarea VERIFICATĂ a motorului (manifest + instantaneu). Din ea pornește câte o Sesiune pe speță."""

    def __init__(self, manifest_file=None, radacina=None, node=None, termen_cerere=TERMEN_CERERE, termen_init=TERMEN_INIT,
                 termen_sesiune=TERMEN_SESIUNE, max_iesire=MAX_IESIRE):
        self.manifest = citeste_manifest(manifest_file)
        radacina = pathlib.Path(radacina or RADACINA)
        continut = {}
        for rel, h in self.manifest['fisiere'].items():
            try:
                b = _lf((radacina / rel).read_bytes())
            except OSError:
                raise MotorEroare('fisier_lipsa') from None
            if hashlib.sha256(b).hexdigest() != h: raise MotorEroare('amprenta')
            continut[rel] = b
        self.node = node if node is not None else (os.environ.get('INTREBARI_NODE') or shutil.which('node'))
        if not self.node or not pathlib.Path(self.node).is_file(): raise MotorEroare('node_lipsa')
        self.limite = {'termen_cerere': termen_cerere, 'termen_init': termen_init, 'termen_sesiune': termen_sesiune,
                       'max_iesire': max_iesire}
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix='intrebari_motor_'))
        try:
            for rel, b in continut.items():
                p = self.dir / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b)
                p.chmod(stat.S_IREAD)
            Sesiune(self.argv(), self.asteptat(), None, **self.limite).inchide()   # proba: salutul (versiuni + amprente)
        except BaseException:
            self.inchide()
            raise

    def asteptat(self):
        m = self.manifest
        return {'protocol': m['protocol'], 'motor': m['motor'], 'node_major': m['node_major'], 'unicode': m['unicode'],
                'amprente': dict(m['fisiere'])}

    def argv(self):
        return [self.node, '--permission', f'--allow-fs-read={self.dir}', '--disallow-code-generation-from-strings',
                str(self.dir / self.manifest['intrare'])]

    def verifica_instantaneul(self):
        for rel, h in self.manifest['fisiere'].items():
            try:
                b = (self.dir / rel).read_bytes()
            except OSError:
                raise MotorEroare('instantaneu') from None
            if hashlib.sha256(b).hexdigest() != h: raise MotorEroare('instantaneu')

    def sesiune(self, dictionar):
        """O sesiune nouă (un proces nou) pentru o speță, cu dicționarul (răspunsul „nume” al edge-ului, neatins)."""
        self.verifica_instantaneul()
        return Sesiune(self.argv(), self.asteptat(), dictionar, **self.limite)

    def inchide(self):
        d = getattr(self, 'dir', None)
        if not d: return
        def scrie_si_sterge(f, p, _):   # fișierele instantaneului sunt doar-citire: pe Windows se șterg după chmod
            try: os.chmod(p, stat.S_IWRITE); f(p)
            except OSError: pass
        if sys.version_info >= (3, 12): shutil.rmtree(d, onexc=scrie_si_sterge)
        else: shutil.rmtree(d, onerror=scrie_si_sterge)
        self.dir = None


class Sesiune:
    """Un proces Node = o speță. Orice abatere oprește procesul și sesiunea (toate apelurile următoare: MotorEroare)."""

    def __init__(self, argv, asteptat, dictionar, termen_cerere=TERMEN_CERERE, termen_init=TERMEN_INIT,
                 termen_sesiune=TERMEN_SESIUNE, max_iesire=MAX_IESIRE):
        self._termen_cerere, self._max_iesire = termen_cerere, max_iesire
        self._sfarsit = time.monotonic() + termen_sesiune
        self._id, self._stricata, self._produse, self.statistici = 0, False, {}, None
        self._coada = queue.Queue()
        try:
            self._p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False,
                                       env=_mediu_minim(), cwd=str(pathlib.Path(argv[-1]).parent),
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except OSError:
            self._stricata = True
            raise MotorEroare('pornire') from None
        threading.Thread(target=self._cititor, daemon=True).start()
        salut = self._raspuns(termen_init)
        if (not isinstance(salut, dict) or set(salut) != {'v', 'tip', 'protocol', 'motor', 'node', 'unicode', 'amprente'}
                or salut['v'] != asteptat['protocol'] or salut['tip'] != 'salut' or salut['protocol'] != asteptat['protocol']):
            self._esec('salut')
        if salut['motor'] != asteptat['motor'] or salut['amprente'] != asteptat['amprente']: self._esec('amprenta_proces')
        if not isinstance(salut['node'], str) or salut['node'].split('.')[0] != str(asteptat['node_major']): self._esec('versiune_node')
        if salut['unicode'] != asteptat['unicode']: self._esec('versiune_unicode')
        self._protocol = asteptat['protocol']
        if dictionar is not None:
            rez = self._cere('init', {'dictionar': dictionar}, termen_init)
            if set(rez) != {'statistici'} or not isinstance(rez['statistici'], dict): self._esec('schema')
            self.statistici = rez['statistici']

    # ── transport ──
    def _cititor(self):
        try:
            while True:
                linie = self._p.stdout.readline(self._max_iesire + 1)
                if not linie:
                    self._coada.put(('eof', None)); return
                if len(linie) > self._max_iesire:
                    self._coada.put(('mare', None)); return
                if not linie.endswith(b'\n'):
                    self._coada.put(('trunchiat', None)); return
                self._coada.put(('linie', linie))
        except Exception:
            self._coada.put(('eof', None))

    def _opreste(self):
        p = getattr(self, '_p', None)
        if p is None: return
        try:
            if p.poll() is None: p.kill()
            p.wait(timeout=10)
        except Exception:
            pass
        for f in (p.stdin, p.stdout):
            try: f.close()
            except Exception: pass

    def _esec(self, cod):
        self._stricata = True
        self._opreste()
        raise MotorEroare(cod)

    def _raspuns(self, termen):
        ramas = self._sfarsit - time.monotonic()
        if ramas <= 0: self._esec('timp_sesiune')
        try:
            tip, linie = self._coada.get(timeout=min(termen, ramas))
        except queue.Empty:
            self._esec('timp')
        if tip == 'eof': self._esec('proces_oprit')
        if tip == 'mare': self._esec('iesire_mare')
        if tip == 'trunchiat': self._esec('json_trunchiat')
        try:
            return json.loads(linie.decode('utf-8', errors='strict'))
        except UnicodeDecodeError:
            self._esec('utf8')
        except ValueError:
            self._esec('json')

    def _cere(self, op, campuri, termen=None):
        if self._stricata: raise MotorEroare('sesiune_oprita')
        self._id += 1
        cerere = {'v': self._protocol, 'id': self._id, 'op': op, **campuri}
        try:
            octeti = json.dumps(cerere, ensure_ascii=False).encode('utf-8') + b'\n'
        except (UnicodeEncodeError, ValueError, TypeError):   # surogat singur, valoare care nu e JSON
            self._esec('intrare_invalida')
        if len(octeti) > MAX_INTRARE: self._esec('intrare_mare')
        try:
            self._p.stdin.write(octeti); self._p.stdin.flush()
        except (OSError, ValueError):
            self._esec('proces_oprit')
        r = self._raspuns(termen or self._termen_cerere)
        if not isinstance(r, dict) or r.get('v') != self._protocol or r.get('id') != self._id or type(r.get('ok')) is not bool: self._esec('schema')
        if not r['ok']:
            if set(r) != {'v', 'id', 'ok', 'eroare'} or not isinstance(r['eroare'], str) or not COD_EROARE.fullmatch(r['eroare']): self._esec('schema')
            self._esec('motor_' + r['eroare'])
        if set(r) != {'v', 'id', 'ok', 'rez'} or not isinstance(r['rez'], dict): self._esec('schema')
        return r['rez']

    def _verifica(self, cond):
        if not cond: self._esec('schema')

    # ── operațiile (fiecare întoarce exact ce a dat motorul, validat; nimic corectat) ──
    def invata(self, *texte):
        self._verifica(self._cere('invata', {'texte': [None if t is None else str(t) for t in texte]}) == {})

    def mascheaza(self, text, protejeaza=True):
        rez = self._cere('mascheaza', {'text': str(text or ''), 'protejeaza': bool(protejeaza)})
        self._verifica(set(rez) == {'text'} and isinstance(rez['text'], str))
        x = TextMascat(rez['text'], _SIGILIU)
        self._produse[id(x)] = x                   # obiectul rămâne viu cât trăiește sesiunea → id-ul nu se refolosește
        return x

    def a_produs(self, x):
        """True DOAR pentru un TextMascat produs de ACEASTĂ sesiune (același obiect)."""
        return type(x) is TextMascat and self._produse.get(id(x)) is x

    def demascheaza_sigur(self, text):
        """(afișat, None) sau (None, motiv) — vezi demascheazaSigur din motor."""
        rez = self._cere('demascheaza_sigur', {'text': str(text or '')})
        self._verifica(set(rez) == {'afisat', 'motiv'})
        a, m = rez['afisat'], rez['motiv']
        self._verifica((isinstance(a, str) and m is None) or (a is None and m in MOTIVE_DEMASCARE))
        return a, m

    def emise_in(self, text):
        rez = self._cere('emise_in', {'text': str(text or '')})
        self._verifica(set(rez) == {'n'} and type(rez['n']) is int and rez['n'] >= 0)
        return rez['n']

    def contoare(self):
        """{'contoare': {categorie: n}, 'inlocuiri': n, 'total': n} — doar numere (pentru jurnal)."""
        rez = self._cere('contoare', {})
        self._verifica(set(rez) == {'contoare', 'inlocuiri', 'total'} and isinstance(rez['contoare'], dict)
                       and set(rez['contoare']) <= CATEGORII and all(type(v) is int for v in rez['contoare'].values())
                       and type(rez['inlocuiri']) is int and type(rez['total']) is int)
        return rez

    def contoare_sigure(self):
        """contoare() pentru jurnal, fără să arunce (sesiune oprită → {})."""
        try:
            return self.contoare()
        except MotorEroare:
            return {}

    @staticmethod
    def _surse(surse):
        return [{k: (s.get(k) is True if k in ('inceput_sigur', 'sfarsit_sigur') else str(s.get(k) or '')) for k in CHEI_SURSA}
                for s in surse or []]

    def regula_b(self, text, surse):
        """(text, motiv, tip) — regula B din motor."""
        rez = self._cere('regula_b', {'text': str(text or ''), 'surse': self._surse(surse)})
        self._verifica(set(rez) == {'text', 'motiv', 'tip'} and isinstance(rez['text'], str) and rez['motiv'] in MOTIVE_REGULA_B
                       and rez['tip'] in TIPURI_VERDICT)
        return rez['text'], rez['motiv'], rez['tip']

    def cere_citat(self, text, surse):
        rez = self._cere('cere_citat', {'text': str(text or ''), 'surse': self._surse(surse)})
        self._verifica(set(rez) == {'cere_citat'} and type(rez['cere_citat']) is bool)
        return rez['cere_citat']

    def inchide(self):
        """Închide procesul (cu „gata” dacă sesiunea e sănătoasă). Nu aruncă."""
        if not self._stricata:
            try:
                self._cere('gata', {})
            except MotorEroare:
                pass
        self._stricata = True
        self._opreste()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.inchide()
