"""Clientul BMW CarData: Device Code Flow cu PKCE (S256), refresh, apeluri REST cu limita locala de cereri/zi (doar stdlib).

Fapte din ghidul BMW de integrare (v1.5/v1.6) + Swagger-ul public — vezi README, sectiunea „Ce stim despre API”:
  auth:  POST https://customer.bmwgroup.com/gcdm/oauth/device/code  (client_id, response_type=device_code, scope,
         code_challenge, code_challenge_method=S256)  ->  device_code, user_code, verification_uri, expires_in, interval
         POST https://customer.bmwgroup.com/gcdm/oauth/token  (device_code + code_verifier | refresh_token)
         access token 3600 s, refresh token 1.209.600 s (14 zile); refresh-ul intoarce un set NOU (refresh token rotit).
         In polling: authorization_pending (HTTP 403), slow_down (HTTP 400), expired_token (HTTP 401), access_denied (403).
  REST:  https://api-cardata.bmwgroup.com, antete Authorization: Bearer + x-version: v1; 50 cereri/zi/utilizator
         (reset 00:00 UTC), eroarea CU-429 — poate veni si ca HTTP 403, deci se recunoaste dupa cod, nu doar dupa HTTP.

SECRETE: tokenurile se scriu DOAR in <dir>/bmw_cardata_tokens.json (scriere atomica) si nu se afiseaza niciodata.
Mesajele de eroare contin doar campurile error / error_description / exveErrorId / exveErrorMsg, scurtate.
"""
import base64, hashlib, json, os, re, secrets, tempfile, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

from . import valideaza as V

AUTH_HOST = 'https://customer.bmwgroup.com'
URL_DEVICE_CODE = AUTH_HOST + '/gcdm/oauth/device/code'
URL_TOKEN = AUTH_HOST + '/gcdm/oauth/token'
API_BASE = 'https://api-cardata.bmwgroup.com'
API_VERSIUNE = 'v1'
# doar REST (streaming-ul nu e folosit): cel mai mic set de drepturi cerut
SCOPE = 'authenticate_user openid cardata:api:read'
GRANT_DEVICE = 'urn:ietf:params:oauth:grant-type:device_code'
REFRESH_TTL_S = 1209600            # 14 zile (ghidul BMW §2.3)
REFRESH_INAINTE_S = 300            # access token reinnoit daca expira in < 5 minute
CONTAINER_NUME = 'GAZPET_ERP_ZILNIC'
CONTAINER_SCOP = 'Kilometraj zilnic pentru ERP (append-only)'
LIMITA_ZI_IMPLICIT = 10
LIMITA_ZI_MAX = 49                 # sub limita BMW de 50/zi
GAZDE_PERMISE = frozenset({'customer.bmwgroup.com', 'api-cardata.bmwgroup.com'})
# verification_uri afisat omului: DOAR gazda serverului OAuth de productie (ghid BMW §2.3.2; link-ul …/oneid/link).
# Swagger-ul device flow da ca exemplu customer-i.bmwgroup.com (mediul de integrare) — nu e acceptat.
GAZDE_VERIFICARE = frozenset({'customer.bmwgroup.com'})
EXPIRA_MAX_S = 3600                # fereastra de login urmarita cel mult 1 h (sub vechimea maxima a blocarii)
CORP_MAX = 1024 * 1024
DIR_IMPLICIT = r'C:\Users\Gazpet-Ai\.secrete'
# radacina repo-ului din care ruleaza pachetul (scripts/bmw_cardata/client.py -> ../..), cu symlink/junction rezolvate
RADACINA_REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir))
CONTAINER_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')
USER_CODE_RE = re.compile(r'^[A-Za-z0-9-]{4,32}$')


class EroareBMW(Exception):
    """Eroare cu mesaj sigur de afisat (fara tokenuri)."""


class ReloginNecesar(EroareBMW):
    pass


class LimitaAtinsa(EroareBMW):
    pass


def b64url(octeti):
    return base64.urlsafe_b64encode(octeti).rstrip(b'=').decode('ascii')


def pkce():
    """(code_verifier, code_challenge) — S256, RFC 7636: verifier de 43 caractere din 32 octeti aleatori."""
    verifier = b64url(secrets.token_bytes(32))
    return verifier, b64url(hashlib.sha256(verifier.encode('ascii')).digest())


def _scurt(text, n=200):
    t = re.sub(r'[\x00-\x1f\x7f]+', ' ', str(text))
    return t[:n]


def _eroare_din(data):
    """Doar campurile de eroare cunoscute (OAuth + BMW CarData), scurtate — niciodata corpul intreg."""
    if not isinstance(data, dict):
        return ''
    parti = [_scurt(data[k], 120) for k in ('error', 'error_description', 'exveErrorId', 'exveErrorMsg')
             if isinstance(data.get(k), str) and data.get(k)]
    return ' / '.join(parti)


# ── stocare locala (in afara repo-ului) ─────────────────────────────────────────────────────
def _in_interior(cale, radacina):
    try:
        cale, radacina = os.path.normcase(cale), os.path.normcase(radacina)
        return os.path.commonpath([cale, radacina]) == radacina
    except ValueError:   # alt disc (Windows) sau cai amestecate
        return False


def director_sigur(director):
    """Calea reala a directorului de tokenuri/stare (symlink/junction rezolvate). Refuz daca e in repo-ul pachetului sau in
    ORICE arbore git (un .git in el sau mai sus): tokenurile nu au voie sa ajunga intr-un folder care se poate comite."""
    real = os.path.realpath(os.path.abspath(director))
    if _in_interior(real, RADACINA_REPO):
        raise EroareBMW(f'directorul local e in interiorul repo-ului ({real}) — tokenurile stau DOAR in afara lui (implicit {DIR_IMPLICIT})')
    p = real
    while True:
        if os.path.lexists(os.path.join(p, '.git')):
            raise EroareBMW(f'directorul local e intr-un arbore git ({p}) — refuz: tokenurile stau DOAR in afara oricarui repo')
        parinte = os.path.dirname(p)
        if parinte == p:
            return real
        p = parinte


class Stocare:
    def __init__(self, director=None):
        self.dir = director_sigur(director or os.environ.get('BMW_CARDATA_DIR') or DIR_IMPLICIT)
        self.f_client = os.path.join(self.dir, 'bmw_cardata_client_id.txt')
        self.f_tokenuri = os.path.join(self.dir, 'bmw_cardata_tokens.json')
        self.f_setup = os.path.join(self.dir, 'bmw_cardata_setup.json')
        self.f_contor = os.path.join(self.dir, 'bmw_cardata_cereri.json')
        self.d_citiri = os.path.join(self.dir, 'bmw_cardata_citiri')
        self.d_scrise = os.path.join(self.d_citiri, 'scrise')
        self.f_blocare = os.path.join(self.dir, 'bmw_cardata.lock')

    def scrie_atomic(self, cale, obiect):
        """JSON -> fisier temporar in acelasi director, fsync, os.replace (atomic pe acelasi volum)."""
        os.makedirs(os.path.dirname(cale), exist_ok=True)
        # un subdirector inlocuit cu junction/symlink spre alt loc (ex. repo-ul) nu primeste nimic
        if not _in_interior(os.path.realpath(os.path.dirname(cale)), self.dir):
            raise EroareBMW(f'destinatie in afara directorului local (legatura?): {os.path.dirname(cale)}')
        fd, tmp = tempfile.mkstemp(prefix='.tmp_', suffix='.json', dir=os.path.dirname(cale))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(obiect, f, ensure_ascii=False, indent=1, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
            try:
                os.chmod(tmp, 0o600)
            except OSError:
                pass
            os.replace(tmp, cale)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def citeste_json(self, cale):
        if not os.path.exists(cale):
            return None
        with open(cale, encoding='utf-8') as f:
            return json.load(f)

    def client_id(self):
        if not os.path.exists(self.f_client):
            raise EroareBMW(f'lipseste fisierul cu client ID ({self.f_client})')
        with open(self.f_client, encoding='utf-8-sig') as f:   # -sig: un BOM pus de Notepad nu strica formatul
            cid = f.read().strip()
        if not re.match(r'^[A-Za-z0-9-]{8,64}$', cid):
            raise EroareBMW('client ID-ul din fisier nu are formatul asteptat (UUID)')
        return cid

    def tokenuri(self):
        return self.citeste_json(self.f_tokenuri)

    def salveaza_tokenuri(self, data, acum, refresh_expira_la=None):
        """Raspunsul de token -> fisierul local; doar ce trebuie pentru REST (fara id_token, nefolosit)."""
        at, rt, exp = data.get('access_token'), data.get('refresh_token'), data.get('expires_in')
        if not isinstance(at, str) or not at or not isinstance(rt, str) or not rt:
            raise EroareBMW('raspunsul de token nu contine access_token / refresh_token')
        if isinstance(exp, bool) or not isinstance(exp, int) or not (60 <= exp <= 86400):
            exp = 3600
        self.scrie_atomic(self.f_tokenuri, {
            'access_token': at, 'refresh_token': rt, 'token_type': _scurt(data.get('token_type') or 'Bearer', 20),
            'scope': _scurt(data.get('scope') or '', 300), 'gcid': _scurt(data.get('gcid') or '', 64),
            'obtinut_la': int(acum), 'expira_la': int(acum) + exp,
            'refresh_expira_la': int(refresh_expira_la) if refresh_expira_la else int(acum) + REFRESH_TTL_S})

    def setup(self):
        return self.citeste_json(self.f_setup)

    def salveaza_setup(self, s):
        self.scrie_atomic(self.f_setup, s)

    def citiri_nescrise(self):
        if not os.path.isdir(self.d_citiri):
            return []
        return sorted(os.path.join(self.d_citiri, n) for n in os.listdir(self.d_citiri)
                      if n.endswith('.json') and not n.startswith('.'))

    def salveaza_citire(self, rec):
        nume = rec['citit_la'][:19].replace(':', '').replace('-', '') + '_' + rec['id_citire'] + '.json'
        cale = os.path.join(self.d_citiri, nume)
        self.scrie_atomic(cale, rec)
        return cale

    def marcheaza_scrisa(self, cale, rezultat):
        rec = self.citeste_json(cale)
        rec_scris = {'citire': rec, 'scriere': rezultat}
        dest = os.path.join(self.d_scrise, os.path.basename(cale))
        self.scrie_atomic(dest, rec_scris)
        os.unlink(cale)
        return dest


class Blocare:
    """O singura rulare odata (Task Scheduler + rulare manuala): refresh-ul roteste tokenul, doua rulari paralele l-ar pierde."""
    def __init__(self, st, vechime_max_s=3700):   # > durata maxima a unui login (expires_in plafonat la 3600 s)
        self.st, self.vechime_max_s = st, vechime_max_s

    def __enter__(self):
        os.makedirs(self.st.dir, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.st.f_blocare, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    vechime = time.time() - os.path.getmtime(self.st.f_blocare)
                except OSError:
                    continue
                if vechime > self.vechime_max_s:
                    os.unlink(self.st.f_blocare)   # ramasa de la o rulare cazuta
                    continue
                raise EroareBMW('alta rulare bmw_cardata e in curs (bmw_cardata.lock) — reincercati peste cateva minute')
        raise EroareBMW('nu pot lua blocarea bmw_cardata.lock')

    def __exit__(self, *a):
        try:
            os.unlink(self.st.f_blocare)
        except OSError:
            pass


# ── HTTP (urllib) ───────────────────────────────────────────────────────────────────────────
class _FaraRedirect(urllib.request.HTTPRedirectHandler):
    """Niciun redirect (Jakarinos r1 P1-1): urllib l-ar urma pastrand antetul Authorization, chiar spre http sau alt domeniu.
    BMW nu are de ce sa redirectioneze API-ul sau endpointurile OAuth ⇒ orice 30x e eroare, iar tinta nu se contacteaza."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            fp.close()
        except Exception:
            pass
        raise EroareBMW(f'redirect refuzat (HTTP {code}) de la {urllib.parse.urlsplit(req.full_url).hostname} — nu se urmeaza')


class Http:
    """Un singur punct de iesire in retea: doar https, doar gazdele BMW cunoscute, fara redirect-uri.
    Intoarce (status, obiect JSON | None). `gazde` / `scheme` se schimba DOAR in teste (server local)."""
    def __init__(self, timeout=30, gazde=GAZDE_PERMISE, scheme=('https',)):
        self.timeout, self.gazde, self.scheme = timeout, frozenset(gazde), tuple(scheme)
        self.opener = urllib.request.build_opener(_FaraRedirect)   # inlocuieste HTTPRedirectHandler-ul implicit

    def cerere(self, metoda, url, antete=None, corp=None):
        u = urllib.parse.urlsplit(url)
        if u.scheme not in self.scheme or u.hostname not in self.gazde or u.username or u.password:
            raise EroareBMW(f'URL nepermis: {u.scheme}://{u.hostname}')
        req = urllib.request.Request(url, data=corp, method=metoda, headers=antete or {})
        try:
            with self.opener.open(req, timeout=self.timeout) as r:
                status, octeti = r.status, r.read(CORP_MAX + 1)
        except urllib.error.HTTPError as e:
            status, octeti = e.code, e.read(CORP_MAX + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise EroareBMW(f'retea: {_scurt(getattr(e, "reason", e), 150)}')
        if len(octeti) > CORP_MAX:
            raise EroareBMW(f'raspuns prea mare de la {u.hostname}')
        if not octeti:
            return status, None
        try:
            return status, json.loads(octeti.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return status, None


def _post_form(http, url, campuri):
    corp = urllib.parse.urlencode(campuri).encode('ascii')
    return http.cerere('POST', url, {'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}, corp)


# ── OAuth: device code flow + refresh ────────────────────────────────────────────────────────
def verification_uri_permis(uri):
    """https, gazda EXACTA din GAZDE_VERIFICARE (fara port, fara user@), fara spatii/backslash/caractere de control."""
    if not isinstance(uri, str) or len(uri) > 200 or re.search(r'[\s\\\x00-\x1f\x7f]', uri):
        return False
    u = urllib.parse.urlsplit(uri)
    return u.scheme == 'https' and u.netloc.lower() in GAZDE_VERIFICARE and u.hostname in GAZDE_VERIFICARE


def login(st, http, ceas=time.time, dormi=time.sleep, afis=print):
    """Device Code Flow cu PKCE S256. Afiseaza DOAR verification_uri si user_code; asteapta autorizarea in browser."""
    client_id = st.client_id()
    verifier, challenge = pkce()
    status, data = _post_form(http, URL_DEVICE_CODE, {
        'client_id': client_id, 'response_type': 'device_code', 'scope': SCOPE,
        'code_challenge': challenge, 'code_challenge_method': 'S256'})
    if status != 200 or not isinstance(data, dict):
        raise EroareBMW(f'device/code a esuat: HTTP {status} {_eroare_din(data)}'.strip())
    device_code, user_code, uri = data.get('device_code'), data.get('user_code'), data.get('verification_uri')
    if not isinstance(device_code, str) or not device_code:
        raise EroareBMW('device/code fara device_code')
    if not isinstance(user_code, str) or not USER_CODE_RE.match(user_code):
        raise EroareBMW('device/code: user_code lipsa sau in format neasteptat')
    if not verification_uri_permis(uri):
        raise EroareBMW('device/code: verification_uri lipsa sau in afara gazdei BMW permise (%s) — nu se afiseaza'
                        % ', '.join(sorted(GAZDE_VERIFICARE)))
    # RFC 8628 §3.5: intervalul serverului se respecta (implicit 5 s), fara plafon care l-ar scurta; slow_down adauga 5 s.
    expira = data.get('expires_in')
    expira = min(expira, EXPIRA_MAX_S) if isinstance(expira, int) and not isinstance(expira, bool) and expira >= 1 else 300
    interval = data.get('interval')
    interval = interval if isinstance(interval, int) and not isinstance(interval, bool) and interval >= 1 else 5
    if interval > expira:
        raise EroareBMW(f'device/code: intervalul de interogare ({interval} s) depaseste valabilitatea codului ({expira} s)')
    afis(f'verification_uri: {uri}')
    afis(f'user_code: {user_code}')
    termen = ceas() + expira
    while True:
        if ceas() + interval > termen:   # urmatoarea interogare permisa ar cadea dupa expirarea codului: oprim fluxul
            raise ReloginNecesar('codul de autorizare expira inainte de urmatoarea interogare permisa — rulati login din nou')
        dormi(interval)
        if ceas() > termen:              # somn prelungit (suspendare / hibernare): codul a expirat, nicio cerere /token
            raise ReloginNecesar('codul de autorizare a expirat in timpul asteptarii — rulati login din nou')
        status, data = _post_form(http, URL_TOKEN, {
            'client_id': client_id, 'device_code': device_code, 'grant_type': GRANT_DEVICE, 'code_verifier': verifier})
        if status == 200 and isinstance(data, dict) and data.get('access_token'):
            st.salveaza_tokenuri(data, ceas())
            return
        eroare = data.get('error') if isinstance(data, dict) else None
        if eroare == 'authorization_pending':
            continue
        if eroare == 'slow_down':
            interval += 5                      # RFC 8628 §3.5: +5 s la fiecare slow_down, pentru tot restul fluxului
            continue
        if eroare == 'expired_token':
            raise ReloginNecesar('codul de autorizare a expirat — rulati login din nou')
        if eroare == 'access_denied':
            raise EroareBMW('autorizarea a fost refuzata in browser')
        raise EroareBMW(f'token (device flow) a esuat: HTTP {status} {_eroare_din(data)}'.strip())


def refresh(st, http, ceas=time.time):
    """Reinnoieste access + refresh token (BMW roteste refresh token-ul: se salveaza setul nou, atomic)."""
    client_id = st.client_id()
    t = st.tokenuri()
    if not t or not t.get('refresh_token'):
        raise ReloginNecesar('nu exista tokenuri locale — rulati login')
    if ceas() >= t.get('refresh_expira_la', 0) - 60:
        raise ReloginNecesar('refresh token-ul a expirat (14 zile fara reinnoire) — rulati login din nou')
    status, data = _post_form(http, URL_TOKEN, {
        'grant_type': 'refresh_token', 'refresh_token': t['refresh_token'], 'client_id': client_id})
    if status == 200 and isinstance(data, dict) and data.get('access_token'):
        if data.get('refresh_token'):
            st.salveaza_tokenuri(data, ceas())
        else:
            # fara refresh nou: pastram pe cel vechi, cu expirarea lui veche (nu prelungim nimic presupus)
            st.salveaza_tokenuri(dict(data, refresh_token=t['refresh_token']), ceas(), refresh_expira_la=t['refresh_expira_la'])
        return
    eroare = data.get('error') if isinstance(data, dict) else None
    if eroare in ('invalid_grant', 'expired_token', 'invalid_token'):
        raise ReloginNecesar(f'refresh refuzat ({eroare}): refresh token expirat sau revocat — rulati login din nou')
    if eroare in ('invalid_client', 'unauthorized_client'):
        raise ReloginNecesar(f'refresh refuzat ({eroare}): client ID invalid sau dezabonat — verificati portalul BMW, apoi login')
    raise EroareBMW(f'refresh a esuat: HTTP {status} {_eroare_din(data)}'.strip())


def access_token(st, http, ceas=time.time):
    t = st.tokenuri()
    if not t:
        raise ReloginNecesar('nu exista tokenuri locale — rulati login')
    if ceas() >= t.get('expira_la', 0) - REFRESH_INAINTE_S:
        refresh(st, http, ceas)
        t = st.tokenuri()
    return t['access_token']


# ── limita locala de cereri pe zi (zi UTC, ca resetul BMW) ─────────────────────────────────────
class Contor:
    def __init__(self, st, limita=LIMITA_ZI_IMPLICIT, ceas=time.time):
        if isinstance(limita, bool) or not isinstance(limita, int) or not (1 <= limita <= LIMITA_ZI_MAX):
            raise EroareBMW(f'limita pe zi trebuie sa fie intre 1 si {LIMITA_ZI_MAX}')
        self.st, self.limita, self.ceas = st, limita, ceas

    def _azi(self):
        return datetime.fromtimestamp(self.ceas(), timezone.utc).strftime('%Y-%m-%d')

    def stare(self):
        s = self.st.citeste_json(self.st.f_contor) or {}
        if s.get('zi_utc') != self._azi():
            s = {'zi_utc': self._azi(), 'n': 0, 'blocat_cu429': False}
        return s

    def consuma(self):
        """Inainte de FIECARE cerere CarData: refuz daca limita locala e atinsa sau BMW a raspuns CU-429 azi."""
        s = self.stare()
        if s.get('blocat_cu429'):
            raise LimitaAtinsa('BMW a raspuns azi cu CU-429 (limita zilnica) — nicio cerere pana la 00:00 UTC')
        if s.get('n', 0) >= self.limita:
            raise LimitaAtinsa(f'limita locala de {self.limita} cereri/zi atinsa ({s["zi_utc"]} UTC) — nicio cerere pana maine')
        s['n'] = s.get('n', 0) + 1
        self.st.scrie_atomic(self.st.f_contor, s)

    def blocheaza_azi(self):
        s = self.stare()
        s['blocat_cu429'] = True
        self.st.scrie_atomic(self.st.f_contor, s)


# ── REST CarData ────────────────────────────────────────────────────────────────────────────
class Api:
    def __init__(self, st, http, contor, ceas=time.time):
        self.st, self.http, self.contor, self.ceas = st, http, contor, ceas

    def _cerere(self, metoda, cale, params=None, corp=None):
        token = access_token(self.st, self.http, self.ceas)   # refresh-ul (OAuth) nu intra in limita CarData
        self.contor.consuma()
        url = API_BASE + cale + ('?' + urllib.parse.urlencode(params) if params else '')
        antete = {'Authorization': 'Bearer ' + token, 'x-version': API_VERSIUNE, 'Accept': 'application/json'}
        octeti = None
        if corp is not None:
            antete['Content-Type'] = 'application/json'
            octeti = json.dumps(corp).encode('utf-8')
        status, data = self.http.cerere(metoda, url, antete, octeti)
        cod = data.get('exveErrorId') if isinstance(data, dict) else None
        if status == 429 or cod == 'CU-429':
            self.contor.blocheaza_azi()
            raise LimitaAtinsa(f'BMW: limita de cereri pe zi atinsa (HTTP {status}, CU-429) — stop, fara reincercare, pana la 00:00 UTC')
        if status == 401:
            raise EroareBMW(f'BMW a respins tokenul (HTTP 401 {_eroare_din(data)}) — rulati refresh, apoi login daca persista'.strip())
        if status not in (200, 201):
            raise EroareBMW(f'{metoda} {cale.split("?")[0]}: HTTP {status} {_eroare_din(data)}'.strip())
        return data

    def mapari(self):
        data = self._cerere('GET', '/customers/vehicles/mappings')
        if isinstance(data, list):
            return [m for m in data if isinstance(m, dict)]
        if isinstance(data, dict):
            for k in ('mappings', 'vehicles'):
                if isinstance(data.get(k), list):
                    return [m for m in data[k] if isinstance(m, dict)]
            if 'vin' in data:
                return [data]
        return []

    def containere(self):
        data = self._cerere('GET', '/customers/containers')
        lst = data.get('containers') if isinstance(data, dict) else data
        return [c for c in lst if isinstance(c, dict)] if isinstance(lst, list) else []

    def container(self, container_id):
        return self._cerere('GET', '/customers/containers/' + urllib.parse.quote(container_id, safe=''))

    def creeaza_container(self):
        return self._cerere('POST', '/customers/containers', corp={
            'name': CONTAINER_NUME, 'purpose': CONTAINER_SCOP, 'technicalDescriptors': list(V.CHEI_CONTAINER)})

    def basic_data(self, vin):
        return self._cerere('GET', f'/customers/vehicles/{urllib.parse.quote(vin, safe="")}/basicData')

    def telematic(self, vin, container_id):
        return self._cerere('GET', f'/customers/vehicles/{urllib.parse.quote(vin, safe="")}/telematicData',
                            params={'containerId': container_id})


# ── comenzile ────────────────────────────────────────────────────────────────────────────────
def setup(api, vin=None, recreeaza=False, afis=print):
    st = api.st
    s = st.setup() or {}
    if s.get('container_id') and s.get('vin') and not recreeaza:
        afis(f'setup deja facut: VIN …{s["vin"][-6:]}, container {s["container_id"]} (folositi --recreeaza pentru un container nou)')
        return s
    primare = sorted({m.get('vin') for m in api.mapari()
                      if m.get('mappingType') == 'PRIMARY' and V.vin_valid(m.get('vin'))})
    if vin:
        vin = vin.strip().upper()
        if vin not in primare:
            raise EroareBMW('VIN-ul cerut nu e mapat PRIMARY pe acest cont (ghidul BMW: doar PRIMARY are acces la date)')
    elif len(primare) == 1:
        vin = primare[0]
    elif not primare:
        raise EroareBMW('niciun vehicul mapat PRIMARY pe cont — verificati maparea in My BMW')
    else:
        raise EroareBMW(f'{len(primare)} vehicule PRIMARY (…{", …".join(v[-6:] for v in primare)}) — alegeti cu --vin')
    container_id = None
    if not recreeaza:
        for c in api.containere():
            if c.get('name') == CONTAINER_NUME and c.get('state') == 'ACTIVE' and isinstance(c.get('containerId'), str):
                det = api.container(c['containerId'])
                if isinstance(det, dict) and sorted(det.get('technicalDescriptors') or []) == sorted(V.CHEI_CONTAINER):
                    container_id = c['containerId']
                    break
    if container_id is None:
        rasp = api.creeaza_container()
        container_id = rasp.get('containerId') if isinstance(rasp, dict) else None
    if not isinstance(container_id, str) or not CONTAINER_RE.match(container_id):
        raise EroareBMW('crearea containerului nu a intors un containerId valid')
    s = {'vin': vin, 'container_id': container_id, 'chei': list(V.CHEI_CONTAINER),
         'setup_la': datetime.fromtimestamp(api.ceas(), timezone.utc).isoformat(), 'basic': s.get('basic') if s.get('vin') == vin else None}
    st.salveaza_setup(s)
    afis(f'setup OK: VIN …{vin[-6:]}, container {container_id} ({len(V.CHEI_CONTAINER)} chei)')
    return s


BASIC_PASTRAT = ('brand', 'modelName', 'modelKey', 'series', 'bodyType', 'driveTrain', 'propulsionType', 'constructionDate', 'countryCode')


def citeste(api, afis=print):
    """O citire: basicData doar prima data (cache local), apoi telematicData cu containerul. Rezultatul -> fisier local nescris."""
    st = api.st
    s = st.setup()
    if not s or not V.vin_valid(s.get('vin')) or not isinstance(s.get('container_id'), str) or not CONTAINER_RE.match(s['container_id']):
        raise EroareBMW('setup lipsa sau invalid — rulati setup')
    vin = s['vin']
    if s.get('basic') is None:
        b = api.basic_data(vin)
        s['basic'] = {k: _scurt(b.get(k), 60) for k in BASIC_PASTRAT if isinstance(b, dict) and isinstance(b.get(k), (str, int))}
        st.salveaza_setup(s)
        afis(f'basicData (o singura data): {s["basic"].get("modelName", "?")} / {s["basic"].get("driveTrain", "?")}')
    raspuns = api.telematic(vin, s['container_id'])
    rec = V.din_raspuns(raspuns, vin, datetime.fromtimestamp(api.ceas(), timezone.utc))
    cale = st.salveaza_citire(rec)
    valori = ', '.join(f'{c}={rec[c]}' for c in V.COLOANE if rec[c] is not None)
    afis(f'citire salvata local ({os.path.basename(cale)}): {valori}; locatie: {"da" if rec["locatie"] else "nu"}')
    for r in rec['respinse']:
        afis(f'  respins: {r["cheie"]} — {r["motiv"]}')
    return cale


def stare(st, contor, ceas=time.time, afis=print):
    """Doar citire locala, fara retea si fara valori de tokenuri."""
    acum = ceas()
    afis(f'director: {st.dir}')
    afis(f'client ID: {"prezent" if os.path.exists(st.f_client) else "LIPSA"}')
    t = st.tokenuri()
    if t:
        afis(f'access token: {"valid inca " + str(int((t.get("expira_la", 0) - acum) // 60)) + " min" if t.get("expira_la", 0) > acum else "expirat"}')
        r = t.get('refresh_expira_la', 0) - acum
        afis(f'refresh token: {"valid inca %.1f zile" % (r / 86400) if r > 0 else "EXPIRAT — rulati login"}')
    else:
        afis('tokenuri: LIPSA — rulati login')
    s = st.setup()
    if s:
        b = s.get('basic') or {}
        afis(f'setup: VIN …{str(s.get("vin"))[-6:]}, container {s.get("container_id")}, model {b.get("modelName", "?")} / {b.get("driveTrain", "?")}')
    else:
        afis('setup: LIPSA — rulati setup')
    c = contor.stare()
    afis(f'cereri azi ({c["zi_utc"]} UTC): {c.get("n", 0)}/{contor.limita}{"; BLOCAT de CU-429" if c.get("blocat_cu429") else ""}')
    afis(f'citiri locale nescrise in BD: {len(st.citiri_nescrise())}')
