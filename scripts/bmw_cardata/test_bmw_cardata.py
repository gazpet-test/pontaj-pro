"""Teste fara retea si fara BD: python -B -m unittest bmw_cardata.test_bmw_cardata -v (PYTHONPATH=scripts).
HTTP-ul BMW e simulat (HttpFals: raspunsuri pe rand, cererile inregistrate); psql e simulat in testele de scriere.
Datele sunt FICTIVE (VIN de test, tokenuri inventate)."""
import base64, contextlib, hashlib, http.server, io, json, os, re, tempfile, threading, time, unittest, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from unittest import mock
from decimal import Decimal

from . import bd as B
from . import client as C
from . import valideaza as V
from . import __main__ as M

VIN = 'WBATEST0000000001'           # fictiv, 17 caractere fara I/O/Q
VIN2 = 'WBATEST0000000002'
CLIENT = '11111111-2222-4333-8444-555555555555'
AT1, RT1 = 'ACCESS-TOKEN-UNU-' + 'a' * 40, 'REFRESH-TOKEN-UNU-' + 'b' * 40
AT2, RT2 = 'ACCESS-TOKEN-DOI-' + 'c' * 40, 'REFRESH-TOKEN-DOI-' + 'd' * 40
T0 = 1792000000.0                   # 2026-10-14 (UTC) — ceas fix
ACUM = datetime.fromtimestamp(T0, timezone.utc)
TS = (ACUM - timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
CONTAINER = 'abcDEF1234567'


class HttpFals:
    """Raspunsuri pe rand: lista de (status, json); fiecare cerere e inregistrata (metoda, url, antete, campuri/corp)."""
    def __init__(self, raspunsuri):
        self.raspunsuri, self.cereri = list(raspunsuri), []

    def cerere(self, metoda, url, antete=None, corp=None):
        u = urllib.parse.urlsplit(url)
        assert u.scheme == 'https' and u.hostname in C.GAZDE_PERMISE, url
        campuri = None
        if corp is not None:
            if (antete or {}).get('Content-Type') == 'application/x-www-form-urlencoded':
                campuri = dict(urllib.parse.parse_qsl(corp.decode('ascii')))
            else:
                campuri = json.loads(corp.decode('utf-8'))
        self.cereri.append((metoda, url, dict(antete or {}), campuri))
        if not self.raspunsuri:
            raise AssertionError(f'cerere neasteptata: {metoda} {url}')
        return self.raspunsuri.pop(0)


class Ceas:
    def __init__(self, t=T0):
        self.t, self.dormit = t, []

    def __call__(self):
        return self.t

    def dormi(self, s):
        self.dormit.append(s)
        self.t += s


def telematic(**suprascrie):
    td = {
        'vehicle.vehicle.travelledDistance': {'value': '48213', 'unit': 'km', 'timestamp': TS},
        'vehicle.drivetrain.fuelSystem.level': {'value': '62', 'unit': '%', 'timestamp': TS},
        'vehicle.drivetrain.fuelSystem.remainingFuel': {'value': '41.5', 'unit': 'l', 'timestamp': TS},
        'vehicle.cabin.infotainment.navigation.remainingRange': {'value': '410', 'unit': 'km', 'timestamp': TS},
        'vehicle.drivetrain.electricEngine.kombiRemainingElectricRange': {'value': '38', 'unit': 'km', 'timestamp': TS},
        'vehicle.drivetrain.lastRemainingRange': {'value': '448', 'unit': 'km', 'timestamp': TS},
        'vehicle.drivetrain.batteryManagement.header': {'value': '87', 'unit': '%', 'timestamp': TS},
        'vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.fuel': {'value': '4120.33', 'unit': 'l', 'timestamp': TS},
        'vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.referenceDistance': {'value': '47990.1', 'unit': 'km', 'timestamp': TS},
        'vehicle.cabin.infotainment.navigation.currentLocation.latitude': {'value': '44.936667', 'unit': 'degrees', 'timestamp': TS},
        'vehicle.cabin.infotainment.navigation.currentLocation.longitude': {'value': '26.012345', 'unit': 'degrees', 'timestamp': TS},
        'vehicle.cabin.infotainment.navigation.currentLocation.heading': {'value': '181', 'unit': 'degrees', 'timestamp': TS},
    }
    for k, v in suprascrie.items():
        cheie = next(c for c in td if c.endswith(k))
        if v is None:
            del td[cheie]
        else:
            td[cheie] = v
    return {'telematicData': td}


class Baza(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.st = C.Stocare(self.tmp.name)
        with open(self.st.f_client, 'w', encoding='utf-8') as f:
            f.write(CLIENT + '\n')
        self.ceas = Ceas()
        self.iesire = []

    def tearDown(self):
        self.tmp.cleanup()

    def afis(self, *a):
        self.iesire.append(' '.join(str(x) for x in a))

    def tokenuri(self, expira_in=3600, refresh_in=C.REFRESH_TTL_S):
        t = self.ceas.t
        self.st.scrie_atomic(self.st.f_tokenuri, {'access_token': AT1, 'refresh_token': RT1, 'token_type': 'Bearer',
                                                  'scope': C.SCOPE, 'gcid': 'g', 'obtinut_la': int(t),
                                                  'expira_la': int(t + expira_in), 'refresh_expira_la': int(t + refresh_in)})

    def setup_local(self, basic=True):
        self.st.salveaza_setup({'vin': VIN, 'container_id': CONTAINER, 'chei': V.CHEI_CONTAINER, 'setup_la': ACUM.isoformat(),
                                'basic': {'modelName': 'X5 xDrive45e', 'driveTrain': 'PHEV'} if basic else None})

    def fara_scurgeri(self):
        tot = '\n'.join(self.iesire)
        jurnal = os.path.join(self.st.dir, 'bmw_cardata_jurnal.log')
        if os.path.exists(jurnal):
            with open(jurnal, encoding='utf-8') as f:
                tot += f.read()
        for secret in (AT1, RT1, AT2, RT2, CLIENT, 'DEVICE-CODE-SECRET'):
            self.assertNotIn(secret, tot)
        for nume in os.listdir(self.st.dir):
            self.assertFalse(nume.startswith('.tmp_'), f'fisier temporar ramas: {nume}')


# ── Device Code Flow ─────────────────────────────────────────────────────────────────────────
class TestLogin(Baza):
    def raspuns_device(self, interval=5, expira=600):
        return (200, {'device_code': 'DEVICE-CODE-SECRET', 'user_code': 'sDzZXXmD', 'expires_in': expira, 'interval': interval,
                      'verification_uri': 'https://customer.bmwgroup.com/oneid/link',
                      'verification_uri_complete': 'https://customer.bmwgroup.com/oneid/link?code=sDzZXXmD'})

    def test_device_flow_pkce_pending_slow_down_ok(self):
        http = HttpFals([self.raspuns_device(),
                         (403, {'error': 'authorization_pending', 'error_description': 'The user has not yet completed authorization'}),
                         (400, {'error': 'slow_down', 'error_description': 'The polling interval has not elapsed'}),
                         (403, {'error': 'authorization_pending'}),
                         (200, {'access_token': AT1, 'refresh_token': RT1, 'id_token': 'ID-' + 'e' * 40, 'expires_in': 3599,
                                'token_type': 'Bearer', 'scope': C.SCOPE, 'gcid': 'aa111192-d570-4d3d-8835-656ee00edcd7'})])
        C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)
        # 1) device/code: campurile cerute de BMW, PKCE S256 corect
        m, url, antete, f = http.cereri[0]
        self.assertEqual((m, url), ('POST', C.URL_DEVICE_CODE))
        self.assertEqual(f['client_id'], CLIENT)
        self.assertEqual(f['response_type'], 'device_code')
        self.assertEqual(f['code_challenge_method'], 'S256')
        self.assertEqual(f['scope'], 'authenticate_user openid cardata:api:read')
        # 2) polling: grant device_code + acelasi code_verifier, care se potriveste cu challenge-ul
        polls = http.cereri[1:]
        self.assertEqual(len(polls), 4)
        verif = {p[3]['code_verifier'] for p in polls}
        self.assertEqual(len(verif), 1)
        v = verif.pop()
        self.assertTrue(re.match(r'^[A-Za-z0-9_-]{43}$', v))
        self.assertEqual(f['code_challenge'], base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b'=').decode())
        for p in polls:
            self.assertEqual(p[3]['grant_type'], C.GRANT_DEVICE)
            self.assertEqual(p[3]['device_code'], 'DEVICE-CODE-SECRET')
        # 3) intervalul respectat; slow_down adauga 5 s (RFC 8628)
        self.assertEqual(self.ceas.dormit, [5, 5, 10, 10])
        # 4) se afiseaza DOAR verification_uri + user_code
        self.assertEqual(self.iesire, ['verification_uri: https://customer.bmwgroup.com/oneid/link', 'user_code: sDzZXXmD'])
        t = self.st.tokenuri()
        self.assertEqual((t['access_token'], t['refresh_token']), (AT1, RT1))
        self.assertEqual(t['expira_la'], int(self.ceas.t) + 3599)
        self.assertEqual(t['refresh_expira_la'], int(self.ceas.t) + C.REFRESH_TTL_S)
        self.assertNotIn('id_token', t)   # nefolosit pentru REST: nu se pastreaza
        self.fara_scurgeri()

    def test_expired_token(self):
        http = HttpFals([self.raspuns_device(), (401, {'error': 'expired_token', 'error_description': 'The code is expired'})])
        with self.assertRaises(C.ReloginNecesar) as e:
            C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)
        self.assertIn('login din nou', str(e.exception))
        self.assertIsNone(self.st.tokenuri())

    def test_termen_depasit_fara_bucla_infinita(self):
        http = HttpFals([self.raspuns_device(interval=5, expira=30)] + [(403, {'error': 'authorization_pending'})] * 10)
        with self.assertRaises(C.ReloginNecesar):
            C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)
        self.assertLessEqual(len(http.cereri), 1 + 6)
        self.assertIsNone(self.st.tokenuri())

    def test_access_denied(self):
        http = HttpFals([self.raspuns_device(), (403, {'error': 'access_denied'})])
        with self.assertRaises(C.EroareBMW):
            C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)

    def test_verification_uri_nesigur_refuzat(self):
        http = HttpFals([(200, {'device_code': 'x', 'user_code': 'ABCD1234', 'verification_uri': 'http://evil.example/x',
                                'expires_in': 300, 'interval': 5})])
        with self.assertRaises(C.EroareBMW):
            C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)
        self.assertEqual(self.iesire, [])

    def test_device_code_esuat_fara_corp_complet(self):
        http = HttpFals([(400, {'error': 'invalid_request', 'error_description': 'Missing parameter', 'altceva': 'X' * 500})])
        with self.assertRaises(C.EroareBMW) as e:
            C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)
        self.assertIn('invalid_request', str(e.exception))
        self.assertNotIn('XXXX', str(e.exception))


# ── refresh ──────────────────────────────────────────────────────────────────────────────────
class TestRefresh(Baza):
    def test_refresh_roteste_atomic(self):
        self.tokenuri()
        http = HttpFals([(200, {'access_token': AT2, 'refresh_token': RT2, 'expires_in': 3600, 'token_type': 'Bearer'})])
        C.refresh(self.st, http, ceas=self.ceas)
        m, url, antete, f = http.cereri[0]
        self.assertEqual((m, url), ('POST', C.URL_TOKEN))
        self.assertEqual(f, {'grant_type': 'refresh_token', 'refresh_token': RT1, 'client_id': CLIENT})
        t = self.st.tokenuri()
        self.assertEqual((t['access_token'], t['refresh_token']), (AT2, RT2))
        self.assertEqual(t['refresh_expira_la'], int(T0) + C.REFRESH_TTL_S)
        self.fara_scurgeri()

    def test_refresh_fara_refresh_nou_pastreaza_expirarea_veche(self):
        self.tokenuri(refresh_in=1000)
        http = HttpFals([(200, {'access_token': AT2, 'expires_in': 3600})])
        C.refresh(self.st, http, ceas=self.ceas)
        t = self.st.tokenuri()
        self.assertEqual((t['access_token'], t['refresh_token'], t['refresh_expira_la']), (AT2, RT1, int(T0) + 1000))

    def test_refresh_expirat_local_fara_cerere(self):
        self.tokenuri(refresh_in=-10)
        http = HttpFals([])
        with self.assertRaises(C.ReloginNecesar) as e:
            C.refresh(self.st, http, ceas=self.ceas)
        self.assertIn('rulati login din nou', str(e.exception))
        self.assertEqual(http.cereri, [])

    def test_refresh_refuzat_de_bmw(self):
        self.tokenuri()
        http = HttpFals([(400, {'error': 'invalid_grant', 'error_description': 'Refresh token expired'})])
        with self.assertRaises(C.ReloginNecesar) as e:
            C.refresh(self.st, http, ceas=self.ceas)
        self.assertIn('rulati login din nou', str(e.exception))
        self.assertEqual(self.st.tokenuri()['refresh_token'], RT1)   # fisierul nu e stricat

    def test_fara_tokenuri(self):
        with self.assertRaises(C.ReloginNecesar):
            C.refresh(self.st, HttpFals([]), ceas=self.ceas)

    def test_access_token_reinnoit_automat_inainte_de_expirare(self):
        self.tokenuri(expira_in=100)
        http = HttpFals([(200, {'access_token': AT2, 'refresh_token': RT2, 'expires_in': 3600})])
        self.assertEqual(C.access_token(self.st, http, ceas=self.ceas), AT2)

    def test_scriere_atomica_esuata_pastreaza_fisierul_vechi(self):
        self.tokenuri()
        with self.assertRaises(TypeError):
            self.st.scrie_atomic(self.st.f_tokenuri, {'x': object()})
        self.assertEqual(self.st.tokenuri()['access_token'], AT1)
        self.fara_scurgeri()


# ── limita de cereri + 429 ───────────────────────────────────────────────────────────────────
class TestLimite(Baza):
    def api(self, raspunsuri, limita=10):
        self.tokenuri()
        self.setup_local()
        self.http = HttpFals(raspunsuri)
        return C.Api(self.st, self.http, C.Contor(self.st, limita, ceas=self.ceas), ceas=self.ceas)

    def test_429_http_opreste_fara_retry_si_blocheaza_ziua(self):
        api = self.api([(429, {'exveErrorId': 'CU-429', 'exveErrorMsg': 'API rate limit reached'})])
        with self.assertRaises(C.LimitaAtinsa):
            C.citeste(api, afis=self.afis)
        self.assertEqual(len(self.http.cereri), 1)
        with self.assertRaises(C.LimitaAtinsa):       # a doua rulare in aceeasi zi: nicio cerere
            C.citeste(api, afis=self.afis)
        self.assertEqual(len(self.http.cereri), 1)
        self.assertEqual(self.st.citiri_nescrise(), [])
        self.ceas.t += 86400                            # ziua UTC urmatoare: deblocat
        self.tokenuri()
        self.http.raspunsuri.append((200, telematic()))
        C.citeste(api, afis=self.afis)
        self.assertEqual(len(self.st.citiri_nescrise()), 1)

    def test_cu429_venit_ca_403(self):
        api = self.api([(403, {'exveErrorId': 'CU-429', 'exveErrorMsg': 'API rate limit reached'})])
        with self.assertRaises(C.LimitaAtinsa):
            C.citeste(api, afis=self.afis)
        self.assertTrue(C.Contor(self.st, ceas=self.ceas).stare()['blocat_cu429'])

    def test_limita_locala(self):
        api = self.api([(200, telematic()), (200, telematic())], limita=2)
        C.citeste(api, afis=self.afis)
        C.citeste(api, afis=self.afis)
        with self.assertRaises(C.LimitaAtinsa):
            C.citeste(api, afis=self.afis)
        self.assertEqual(len(self.http.cereri), 2)

    def test_limita_peste_50_refuzata(self):
        with self.assertRaises(C.EroareBMW):
            C.Contor(self.st, 50)

    def test_antete_rest(self):
        api = self.api([(200, telematic())])
        C.citeste(api, afis=self.afis)
        m, url, antete, _ = self.http.cereri[0]
        self.assertEqual(m, 'GET')
        self.assertEqual(url, f'{C.API_BASE}/customers/vehicles/{VIN}/telematicData?containerId={CONTAINER}')
        self.assertEqual(antete['x-version'], 'v1')
        self.assertEqual(antete['Authorization'], 'Bearer ' + AT1)

    def test_401(self):
        api = self.api([(401, {'exveErrorId': 'CU-102', 'exveErrorMsg': 'Token expired'})])
        with self.assertRaises(C.EroareBMW) as e:
            C.citeste(api, afis=self.afis)
        self.assertIn('refresh', str(e.exception))


# ── setup + citeste ──────────────────────────────────────────────────────────────────────────
class TestSetupCiteste(Baza):
    def api(self, raspunsuri):
        self.tokenuri()
        self.http = HttpFals(raspunsuri)
        return C.Api(self.st, self.http, C.Contor(self.st, 10, ceas=self.ceas), ceas=self.ceas)

    def test_setup_primary_si_container_nou(self):
        api = self.api([(200, [{'vin': VIN, 'mappingType': 'PRIMARY', 'mappedSince': TS},
                               {'vin': VIN2, 'mappingType': 'SECONDARY', 'mappedSince': TS}]),
                        (200, {'containers': [{'containerId': 'zzz0000000001', 'name': 'Altceva', 'state': 'ACTIVE'}]}),
                        (201, {'containerId': CONTAINER, 'name': C.CONTAINER_NUME, 'state': 'ACTIVE'})])
        s = C.setup(api, afis=self.afis)
        self.assertEqual((s['vin'], s['container_id']), (VIN, CONTAINER))
        m, url, antete, corp = self.http.cereri[2]
        self.assertEqual((m, url), ('POST', C.API_BASE + '/customers/containers'))
        self.assertEqual(corp['technicalDescriptors'], V.CHEI_CONTAINER)
        self.assertEqual(antete['Content-Type'], 'application/json')
        self.assertEqual(self.st.setup()['container_id'], CONTAINER)
        # a doua oara: nicio cerere
        n = len(self.http.cereri)
        C.setup(api, afis=self.afis)
        self.assertEqual(len(self.http.cereri), n)

    def test_setup_refoloseste_containerul_existent_cu_aceleasi_chei(self):
        api = self.api([(200, [{'vin': VIN, 'mappingType': 'PRIMARY'}]),
                        (200, {'containers': [{'containerId': CONTAINER, 'name': C.CONTAINER_NUME, 'state': 'ACTIVE'}]}),
                        (200, {'containerId': CONTAINER, 'technicalDescriptors': list(reversed(V.CHEI_CONTAINER))})])
        s = C.setup(api, afis=self.afis)
        self.assertEqual(s['container_id'], CONTAINER)
        self.assertNotIn('POST', [c[0] for c in self.http.cereri])

    def test_setup_fara_primary(self):
        api = self.api([(200, [{'vin': VIN, 'mappingType': 'SECONDARY'}])])
        with self.assertRaises(C.EroareBMW):
            C.setup(api, afis=self.afis)

    def test_setup_vin_cerut_nemapat(self):
        api = self.api([(200, [{'vin': VIN, 'mappingType': 'PRIMARY'}])])
        with self.assertRaises(C.EroareBMW):
            C.setup(api, vin=VIN2, afis=self.afis)

    def test_basic_data_doar_o_data(self):
        self.st.salveaza_setup({'vin': VIN, 'container_id': CONTAINER, 'chei': V.CHEI_CONTAINER, 'setup_la': 'x', 'basic': None})
        api = self.api([(200, {'brand': 'BMW', 'modelName': 'X5 xDrive45e', 'driveTrain': 'PHEV', 'fullSAList': 'secret?'}),
                        (200, telematic()), (200, telematic())])
        C.citeste(api, afis=self.afis)
        C.citeste(api, afis=self.afis)
        cai = [urllib.parse.urlsplit(c[1]).path for c in self.http.cereri]
        self.assertEqual(cai, [f'/customers/vehicles/{VIN}/basicData'] + [f'/customers/vehicles/{VIN}/telematicData'] * 2)
        self.assertEqual(self.st.setup()['basic'], {'brand': 'BMW', 'modelName': 'X5 xDrive45e', 'driveTrain': 'PHEV'})
        self.assertEqual(len(self.st.citiri_nescrise()), 2)
        self.fara_scurgeri()


# ── validare ─────────────────────────────────────────────────────────────────────────────────
class TestValidare(unittest.TestCase):
    def test_citire_completa(self):
        r = V.din_raspuns(telematic(), VIN, ACUM)
        self.assertEqual(r['odometru_km'], '48213')
        self.assertEqual(r['combustibil_litri'], '41.5')
        self.assertEqual(r['soc_pct'], '87')
        self.assertEqual(r['odometru_la'], V.ts_iso(V.parse_ts(TS)))
        self.assertEqual(r['locatie'], {'lat': '44.936667', 'lon': '26.012345', 'heading': '181', 'pozitie_la': r['odometru_la']})
        self.assertEqual(r['respinse'], [])
        # raspuns_brut: doar cheile non-locatie din allowlist
        self.assertEqual(set(r['raspuns_brut']), set(V.CHEI_METRICI))
        self.assertIsNone(V.LOCATIE_RE.search(json.dumps(r['raspuns_brut'])))

    def test_chei_necunoscute_ignorate(self):
        t = telematic()
        t['telematicData']['vehicle.cabin.infotainment.navigation.destinationSet.latitude'] = {'value': '45.1'}
        t['telematicData']['vehicle.necunoscut'] = {'value': 'DROP TABLE x'}
        r = V.din_raspuns(t, VIN, ACUM)
        self.assertEqual(set(r['raspuns_brut']), set(V.CHEI_METRICI))

    def test_odometru_lipsa_sau_mile(self):
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(travelledDistance=None), VIN, ACUM)
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(travelledDistance={'value': '30000', 'unit': 'mi', 'timestamp': TS}), VIN, ACUM)
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(travelledDistance={'value': '-5', 'unit': 'km'}), VIN, ACUM)
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(travelledDistance={'value': '1e5', 'unit': 'km'}), VIN, ACUM)

    def test_valori_respinse_devin_null(self):
        r = V.din_raspuns(telematic(**{'fuelSystem.level': {'value': '140', 'unit': '%'},
                                       'fuelSystem.remainingFuel': {'value': '12', 'unit': 'gal'},
                                       'batteryManagement.header': {'value': 'NaN', 'unit': '%'},
                                       'kombiRemainingElectricRange': {'value': 'INVALID', 'unit': 'km'},
                                       'lastRemainingRange': {'value': '400', 'unit': 'km', 'timestamp': '2099-01-01T00:00:00Z'}}),
                          VIN, ACUM)
        self.assertIsNone(r['combustibil_pct'])
        self.assertIsNone(r['combustibil_litri'])
        self.assertIsNone(r['soc_pct'])
        self.assertIsNone(r['autonomie_electric_km'])     # INVALID = lipsa, nu eroare
        self.assertIsNone(r['autonomie_totala_km'])
        self.assertEqual(len(r['respinse']), 4)
        self.assertEqual(r['odometru_km'], '48213')

    def test_locatie_invalida_sau_zero(self):
        r = V.din_raspuns(telematic(**{'currentLocation.latitude': {'value': '0', 'unit': 'degrees'},
                                       'currentLocation.longitude': {'value': '0', 'unit': 'degrees'}}), VIN, ACUM)
        self.assertIsNone(r['locatie'])
        r = V.din_raspuns(telematic(**{'currentLocation.latitude': {'value': '95', 'unit': 'degrees'}}), VIN, ACUM)
        self.assertIsNone(r['locatie'])
        r = V.din_raspuns(telematic(**{'currentLocation.heading': None}), VIN, ACUM)
        self.assertIsNone(r['locatie']['heading'])

    def test_text_de_locatie_in_cheie_non_locatie_refuzat(self):
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(**{'fuelSystem.level': {'value': '50', 'unit': 'latitude'}}), VIN, ACUM)

    def test_vin_invalid(self):
        with self.assertRaises(V.EroareValidare):
            V.din_raspuns(telematic(), 'WBAIOQ00000000001', ACUM)

    def rec_ok(self):
        return json.loads(json.dumps(V.din_raspuns(telematic(), VIN, ACUM)))

    def test_reverifica_ok(self):
        p = V.reverifica(self.rec_ok(), VIN, ACUM)
        self.assertNotIn('respinse', p)
        self.assertNotIn('format', p)

    def test_reverifica_refuza_fisier_modificat(self):
        cazuri = [
            ('vin', lambda r: r.update(vin=VIN2)),
            ('camp in plus', lambda r: r.update(extra=1)),
            ('odometru in afara', lambda r: r.update(odometru_km='2000000')),
            ('odometru nenumeric', lambda r: r.update(odometru_km="1; DROP TABLE x")),
            ('cheie bruta in afara listei', lambda r: r['raspuns_brut'].update({'vehicle.x': {'value': '1', 'unit': None, 'timestamp': None}})),
            ('locatie in brut', lambda r: r['raspuns_brut']['vehicle.vehicle.travelledDistance'].update(unit='latitude')),
            ('brut prea lung', lambda r: r['raspuns_brut']['vehicle.vehicle.travelledDistance'].update(value='9' * 41)),
            ('lat in afara', lambda r: r['locatie'].update(lat='91')),
            ('locatie zero', lambda r: r['locatie'].update(lat='0', lon='0')),
            ('citit_la viitor', lambda r: r.update(citit_la='2099-01-01T00:00:00+00:00')),
            ('id_citire', lambda r: r.update(id_citire="x'; DROP TABLE y; --")),
            ('sursa', lambda r: r.update(sursa='altceva')),
        ]
        for nume, mod in cazuri:
            with self.subTest(nume):
                r = self.rec_ok()
                mod(r)
                with self.assertRaises(V.EroareValidare):
                    V.reverifica(r, VIN, ACUM)


# ── scriere (psql simulat) ───────────────────────────────────────────────────────────────────
class TestScriere(Baza):
    def test_sql_text_bmw_nu_iese_din_literal(self):
        rec = json.loads(json.dumps(V.din_raspuns(telematic(), VIN, ACUM)))
        rec['raspuns_brut']['vehicle.vehicle.travelledDistance']['unit'] = "km$$'; DROP"   # text ostil in brut
        p = V.reverifica(rec, VIN, ACUM)
        sql = B.construieste_sql(p, tag='bmw_testtag')
        lit = re.findall(r'\$bmw_testtag\$(.*?)\$bmw_testtag\$', sql, re.S)
        self.assertEqual(len(lit), 1)
        self.assertEqual(json.loads(lit[0]), json.loads(B.payload_json(p)))
        afara = sql.replace('$bmw_testtag$' + lit[0] + '$bmw_testtag$', '')
        self.assertNotIn('\\', afara)          # nicio meta-comanda psql
        self.assertNotIn('DROP', afara)
        self.assertNotIn(':', afara.replace('::', ''))   # nicio variabila psql
        self.assertEqual(sql.count('$bmw_testtag$'), 2)

    def test_tag_in_document_refuzat(self):
        p = V.reverifica(json.loads(json.dumps(V.din_raspuns(telematic(), VIN, ACUM))), VIN, ACUM)
        p['raspuns_brut']['vehicle.vehicle.travelledDistance']['unit'] = 'bmw_x'
        with self.assertRaises(B.EroareScriere):
            B.construieste_sql(p, tag='bmw_x')

    def test_tag_aleator(self):
        p = V.reverifica(json.loads(json.dumps(V.din_raspuns(telematic(), VIN, ACUM))), VIN, ACUM)
        t1 = re.search(r'\$(bmw_[0-9a-f]{32})\$', B.construieste_sql(p)).group(1)
        t2 = re.search(r'\$(bmw_[0-9a-f]{32})\$', B.construieste_sql(p)).group(1)
        self.assertNotEqual(t1, t2)

    def test_scrie_marcheaza_si_nu_rescrie(self):
        self.setup_local()
        self.st.salveaza_citire(V.din_raspuns(telematic(), VIN, datetime.now(timezone.utc) - timedelta(minutes=1)))
        apeluri = []

        def rulare(sql, psql, pg):
            apeluri.append(sql)
            return '17', 1
        self.assertEqual(B.scrie(self.st, rulare=rulare, afis=self.afis), 1)
        self.assertEqual(self.st.citiri_nescrise(), [])
        self.assertEqual(len(os.listdir(self.st.d_scrise)), 1)
        self.assertEqual(B.scrie(self.st, rulare=rulare, afis=self.afis), 0)
        self.assertEqual(len(apeluri), 1)

    def test_scrie_esuat_pastreaza_fisierul(self):
        self.setup_local()
        self.st.salveaza_citire(V.din_raspuns(telematic(), VIN, datetime.now(timezone.utc) - timedelta(minutes=1)))

        def rulare(sql, psql, pg):
            raise B.EroareScriere('psql a esuat (cod 3): ERROR: test')
        with self.assertRaises(B.EroareScriere):
            B.scrie(self.st, rulare=rulare, afis=self.afis)
        self.assertEqual(len(self.st.citiri_nescrise()), 1)

    def test_scrie_vin_schimbat_in_setup_refuza(self):
        self.setup_local()
        self.st.salveaza_citire(V.din_raspuns(telematic(), VIN, datetime.now(timezone.utc) - timedelta(minutes=1)))
        s = self.st.setup()
        s['vin'] = VIN2
        self.st.salveaza_setup(s)
        with self.assertRaises(B.EroareScriere):
            B.scrie(self.st, rulare=lambda *a, **k: ('1', 0), afis=self.afis)

    def test_mediu_psql_curatat(self):
        os.environ['PGPASSWORD'] = 'nu-trebuie'
        os.environ['PGOPTIONS'] = '-c search_path=evil'
        try:
            env = B.mediu_psql('require')
        finally:
            del os.environ['PGPASSWORD'], os.environ['PGOPTIONS']
        self.assertNotIn('PGPASSWORD', env)
        self.assertNotIn('PGOPTIONS', env)
        self.assertEqual(env['PGSSLMODE'], 'require')

    def test_conexiune_invalida_refuzata(self):
        with self.assertRaises(B.EroareScriere):
            B.ruleaza_psql('SELECT 1', psql='psql', pg={'host': 'h;rm -rf'})


# ── CLI: coduri de iesire, fara scurgeri ─────────────────────────────────────────────────────
class TestCli(Baza):
    def setUp(self):
        super().setUp()
        self.ceas = Ceas(time.time())   # CLI-ul foloseste ceasul real

    def ruleaza(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = M.main(['--dir', self.st.dir, *argv])
        self.iesire += [out.getvalue(), err.getvalue()]
        return rc, out.getvalue(), err.getvalue()

    def test_stare_fara_valori_de_tokenuri(self):
        self.tokenuri()
        self.setup_local()
        rc, out, _ = self.ruleaza('stare')
        self.assertEqual(rc, 0)
        self.assertIn('refresh token: valid', out)
        self.fara_scurgeri()

    def test_refresh_fara_tokenuri_cod_2_si_jurnal(self):
        rc, _, err = self.ruleaza('refresh')
        self.assertEqual(rc, 2)
        self.assertIn('login', err)
        self.assertFalse(os.path.exists(self.st.f_blocare))
        with open(os.path.join(self.st.dir, 'bmw_cardata_jurnal.log'), encoding='utf-8') as f:
            self.assertRegex(f.read(), r'^\d{4}-\d{2}-\d{2}T[\d:]+\+00:00 \| refresh \| 2 \| LOGIN NECESAR: ')
        self.fara_scurgeri()

    def test_refresh_ok_prin_cli_fara_tokenuri_in_iesire_sau_jurnal(self):
        self.tokenuri()
        http = HttpFals([(200, {'access_token': AT2, 'refresh_token': RT2, 'expires_in': 3600})])
        orig = C.Http
        C.Http = lambda *a, **k: http
        try:
            rc, out, _ = self.ruleaza('refresh')
        finally:
            C.Http = orig
        self.assertEqual(rc, 0)
        self.assertIn('refresh OK', out)
        self.assertEqual(self.st.tokenuri()['refresh_token'], RT2)
        self.fara_scurgeri()

    def test_blocare_concurenta(self):
        with C.Blocare(self.st):
            rc, _, err = self.ruleaza('refresh')
        self.assertEqual(rc, 1)
        self.assertIn('alta rulare', err)

    def test_mascare(self):
        self.assertNotIn(AT1, M._mascheaza('eroare cu ' + AT1))


# ── Jakarinos r1 ─────────────────────────────────────────────────────────────────────────────
class ServerLocal:
    """HTTP real pe 127.0.0.1 (port liber): /redirect/<cod> -> <cod> cu Location = self.tinta; /json -> 200; /eroare -> 403 JSON.
    Inregistreaza fiecare cerere primita (metoda, cale, antetul Authorization)."""
    def __init__(self):
        self.cereri, parinte = [], self

        class H(http.server.BaseHTTPRequestHandler):
            def _raspunde(self):
                n = int(self.headers.get('Content-Length') or 0)
                if n:
                    self.rfile.read(n)
                parinte.cereri.append((self.command, self.path, self.headers.get('Authorization')))
                if self.path.startswith('/redirect/'):
                    self.send_response(int(self.path.split('/')[2]))
                    self.send_header('Location', parinte.tinta)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                cod, corp = (200, b'{"ok": true}') if self.path != '/eroare' else (403, b'{"exveErrorId": "CU-429"}')
                self.send_response(cod)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(corp)))
                self.end_headers()
                self.wfile.write(corp)
            do_GET = do_POST = _raspunde

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.port = self.srv.server_address[1]
        self.tinta = f'http://127.0.0.1:{self.port}/tinta-secreta'
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def url(self, cale):
        return f'http://127.0.0.1:{self.port}{cale}'

    def lovituri_tinta(self):
        return [c for c in self.cereri if c[1] == '/tinta-secreta']

    def inchide(self):
        self.srv.shutdown()
        self.srv.server_close()


class TestRedirectTransportReal(unittest.TestCase):
    """P1-1: Http (urllib REAL, nu HttpFals) nu urmeaza niciun redirect — tinta nu e contactata, Authorization nu pleaca."""
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost'})
        self.env.start()
        self.s = ServerLocal()
        self.http = C.Http(timeout=5, gazde={'127.0.0.1'}, scheme=('http',))

    def tearDown(self):
        self.s.inchide()
        self.env.stop()

    def test_control_urllib_implicit_urmeaza_redirectul_cu_authorization(self):
        # dovada ca scenariul reproduce problema: opener-ul implicit duce Bearer-ul la tinta redirectului
        req = urllib.request.Request(self.s.url('/redirect/302'), headers={'Authorization': 'Bearer ' + AT1})
        with urllib.request.urlopen(req, timeout=5) as r:
            r.read()
        self.assertEqual(self.s.lovituri_tinta(), [('GET', '/tinta-secreta', 'Bearer ' + AT1)])

    def test_niciun_redirect_urmat(self):
        for tinta in (self.s.tinta, f'http://localhost:{self.s.port}/tinta-secreta'):     # aceeasi gazda / alt domeniu
            self.s.tinta = tinta
            for cod in (301, 302, 303, 307, 308):
                for metoda, corp in (('GET', None), ('POST', b'a=1')):
                    with self.subTest(tinta=tinta, cod=cod, metoda=metoda):
                        with self.assertRaises(C.EroareBMW) as e:
                            self.http.cerere(metoda, self.s.url(f'/redirect/{cod}'), {'Authorization': 'Bearer ' + AT1}, corp)
                        self.assertIn('redirect refuzat', str(e.exception))
                        self.assertNotIn(AT1, str(e.exception))
        self.assertEqual(self.s.lovituri_tinta(), [])

    def test_raspunsuri_normale_prin_transport_real(self):
        self.assertEqual(self.http.cerere('GET', self.s.url('/json'), {'Authorization': 'Bearer x'}), (200, {'ok': True}))
        self.assertEqual(self.http.cerere('GET', self.s.url('/eroare')), (403, {'exveErrorId': 'CU-429'}))

    def test_gazdele_implicite_refuza_http_si_alte_gazde(self):
        with self.assertRaises(C.EroareBMW):
            C.Http().cerere('GET', self.s.url('/json'))
        with self.assertRaises(C.EroareBMW):
            C.Http().cerere('GET', 'https://customer.bmwgroup.com.evil.example/x')
        with self.assertRaises(C.EroareBMW):
            C.Http().cerere('GET', 'https://user:p@customer.bmwgroup.com/x')
        self.assertEqual(self.s.cereri, [])


class TestPollingRfc8628(Baza):
    """P2-1: intervalul serverului se respecta fara plafon; slow_down +5 s; oprire daca intervalul depaseste timpul ramas."""
    def device(self, interval, expira, uri='https://customer.bmwgroup.com/oneid/link'):
        return (200, {'device_code': 'DEVICE-CODE-SECRET', 'user_code': 'ABCD1234', 'expires_in': expira, 'interval': interval,
                      'verification_uri': uri})

    def login(self, http):
        C.login(self.st, http, ceas=self.ceas, dormi=self.ceas.dormi, afis=self.afis)

    def test_interval_mare_nu_e_scurtat(self):
        pend = (403, {'error': 'authorization_pending'})
        http = HttpFals([self.device(120, 600), pend, (400, {'error': 'slow_down'}), pend,
                         (200, {'access_token': AT1, 'refresh_token': RT1, 'expires_in': 3600})])
        self.login(http)
        self.assertEqual(self.ceas.dormit, [120, 120, 125, 125])

    def test_slow_down_fara_plafon(self):
        sd = (400, {'error': 'slow_down'})
        http = HttpFals([self.device(58, 1000), sd, sd, (200, {'access_token': AT1, 'refresh_token': RT1, 'expires_in': 3600})])
        self.login(http)
        self.assertEqual(self.ceas.dormit, [58, 63, 68])

    def test_interval_peste_timpul_ramas_opreste(self):
        pend = (403, {'error': 'authorization_pending'})
        http = HttpFals([self.device(200, 500), pend, pend, pend])
        with self.assertRaises(C.ReloginNecesar):
            self.login(http)
        self.assertEqual(self.ceas.dormit, [200, 200])        # a treia interogare ar fi la 600 s > 500 s
        self.assertEqual(len(http.cereri), 3)
        self.assertIsNone(self.st.tokenuri())

    def test_somn_prelungit_fara_cerere_dupa_expirare(self):
        # Jakarinos r2 P2: PC suspendat in timpul asteptarii — trezire dupa expires_in ⇒ stop, fara cerere /token
        pend = (403, {'error': 'authorization_pending'})
        http = HttpFals([self.device(5, 300), pend, (200, {'access_token': AT1, 'refresh_token': RT1, 'expires_in': 3600})])
        ceas, somnuri = self.ceas, []

        def dormi(s):
            somnuri.append(s)
            ceas.t += s if len(somnuri) == 1 else 10000     # al doilea somn: suspendare de ~3 ore
        with self.assertRaises(C.ReloginNecesar) as e:
            C.login(self.st, http, ceas=ceas, dormi=dormi, afis=self.afis)
        self.assertIn('in timpul asteptarii', str(e.exception))
        self.assertEqual(somnuri, [5, 5])
        self.assertEqual([urllib.parse.urlsplit(c[1]).path for c in http.cereri],
                         ['/gcdm/oauth/device/code', '/gcdm/oauth/token'])   # o singura interogare, dinaintea suspendarii
        self.assertIsNone(self.st.tokenuri())

    def test_interval_mai_mare_decat_valabilitatea(self):
        http = HttpFals([self.device(400, 300)])
        with self.assertRaises(C.EroareBMW):
            self.login(http)
        self.assertEqual((self.iesire, self.ceas.dormit, len(http.cereri)), ([], [], 1))

    def test_verification_uri_doar_gazda_bmw(self):
        refuzate = ['https://evil.example/oneid/link', 'https://customer-i.bmwgroup.com/oneid/link',
                    'https://customer.bmwgroup.com@evil.example/x', 'https://customer.bmwgroup.com:8443/x',
                    'https://customer.bmwgroup.com.evil.example/x', 'http://customer.bmwgroup.com/x',
                    'https://customer.bmwgroup.com/x y', 'https://customer.bmwgroup.com\\@evil.example/', None, 42]
        for uri in refuzate:
            with self.subTest(uri=uri):
                self.assertFalse(C.verification_uri_permis(uri))
        self.assertTrue(C.verification_uri_permis('https://customer.bmwgroup.com/oneid/link'))
        http = HttpFals([self.device(5, 300, uri='https://bmw-login.example.com/oneid/link')])
        with self.assertRaises(C.EroareBMW):
            self.login(http)
        self.assertEqual(self.iesire, [])                      # nimic afisat omului


def legatura_director(tinta, legatura):
    """Junction (Windows) / symlink (POSIX) spre un director; SkipTest daca sistemul nu permite."""
    try:
        if os.name == 'nt':
            import _winapi
            _winapi.CreateJunction(tinta, legatura)
        else:
            os.symlink(tinta, legatura, target_is_directory=True)
    except (OSError, ImportError, AttributeError) as e:
        raise unittest.SkipTest(f'nu pot crea junction/symlink: {e}')


class TestDirectorSigur(unittest.TestCase):
    """P2-2: tokenurile nu pot ajunge in repo (nici prin --dir / BMW_CARDATA_DIR, nici prin junction/symlink)."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = os.path.realpath(self.tmp.name)
        self.legaturi = []

    def tearDown(self):
        for l in self.legaturi:
            try:
                os.rmdir(l) if os.name == 'nt' else os.unlink(l)   # scoate legatura, nu tinta
            except OSError:
                pass
        self.tmp.cleanup()

    def leaga(self, tinta, nume):
        l = os.path.join(self.d, nume)
        legatura_director(tinta, l)
        self.legaturi.append(l)
        return l

    def test_repo_refuzat(self):
        for cale in (C.RADACINA_REPO, os.path.join(C.RADACINA_REPO, 'scripts'),
                     os.path.join(C.RADACINA_REPO, 'scripts', 'bmw_cardata', 'nu_exista_inca')):
            with self.subTest(cale=cale):
                with self.assertRaises(C.EroareBMW):
                    C.Stocare(cale)

    def test_variabila_de_mediu_in_repo_refuzata(self):
        with mock.patch.dict(os.environ, {'BMW_CARDATA_DIR': os.path.join(C.RADACINA_REPO, 'scripts')}):
            with self.assertRaises(C.EroareBMW):
                C.Stocare()

    def test_orice_arbore_git_refuzat(self):
        os.makedirs(os.path.join(self.d, 'repo', '.git'))
        os.makedirs(os.path.join(self.d, 'wt'))
        with open(os.path.join(self.d, 'wt', '.git'), 'w') as f:   # worktree: .git e fisier
            f.write('gitdir: x\n')
        for cale in (os.path.join(self.d, 'repo'), os.path.join(self.d, 'repo', 'a', 'b'), os.path.join(self.d, 'wt', 'c')):
            with self.subTest(cale=cale):
                with self.assertRaises(C.EroareBMW):
                    C.Stocare(cale)
        C.Stocare(os.path.join(self.d, 'curat'))                    # in afara oricarui repo: acceptat

    def test_legatura_spre_repo_refuzata(self):
        l = self.leaga(os.path.join(C.RADACINA_REPO, 'scripts'), 'spre_repo')
        with self.assertRaises(C.EroareBMW):
            C.Stocare(l)
        os.makedirs(os.path.join(self.d, 'g', '.git'))
        os.makedirs(os.path.join(self.d, 'g', 'sub'))
        l2 = self.leaga(os.path.join(self.d, 'g', 'sub'), 'spre_git')
        with self.assertRaises(C.EroareBMW):
            C.Stocare(l2)

    def test_subdirector_inlocuit_cu_legatura_refuzat(self):
        st = C.Stocare(os.path.join(self.d, 'stare'))
        os.makedirs(st.dir)
        afara = os.path.join(self.d, 'afara')
        os.makedirs(afara)
        legatura_director(afara, st.d_citiri)
        self.legaturi.append(st.d_citiri)
        with self.assertRaises(C.EroareBMW):
            st.salveaza_citire(V.din_raspuns(telematic(), VIN, ACUM))
        self.assertEqual(os.listdir(afara), [])

    def test_cli_dir_in_repo_cod_1_fara_fisiere(self):
        tinta = os.path.join(C.RADACINA_REPO, 'scripts')
        inainte = set(os.listdir(tinta))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = M.main(['--dir', tinta, 'stare'])
        self.assertEqual(rc, 1)
        self.assertIn('repo', err.getvalue())
        self.assertEqual(set(os.listdir(tinta)), inainte)


if __name__ == '__main__':
    unittest.main()
