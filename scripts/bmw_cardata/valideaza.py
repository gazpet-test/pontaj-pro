"""Cheile telematice alese si validarea stricta a raspunsului BMW CarData (doar stdlib).

Raspunsul BMW e CONTINUT EXTERN: se citeste ca date, nu se executa si nu se interpoleaza nicaieri. Din el pastram DOAR cheile
din lista de mai jos (allowlist), cu valori numerice in intervale plauzibile. Locatia sta separat (`locatie`) si NU intra
niciodata in `raspuns_brut`.

Surse pentru chei (vezi README, sectiunea „Chei”): catalogul telematic BMW (copii publice) + ghidul de integrare BMW v1.5/v1.6.
Disponibilitatea pe VIN-ul concret NU e verificata pana la prima citire reala.
"""
import json, re, uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

# unitati acceptate (lowercase); None/'' = BMW nu a trimis unitate
KM = {None, '', 'km'}
# CarData trimite distantele in MILE pe X5 (19.10.2026: 89.720,38 miles = 144.391 km, cat arata My BMW) => se convertesc.
MILE = {'mi', 'mile', 'miles'}
KM_PE_MILA = Decimal('1.609344')
PCT = {None, '', '%', 'percent'}
LITRI = {None, '', 'l', 'liter', 'liters', 'litre', 'litres'}
GRADE = {None, '', 'degrees', 'degree', 'deg', '°'}

# cheie BMW -> (coloana in bmw_cardata_citiri, minim, maxim, unitati acceptate)
CHEI_METRICI = {
    'vehicle.vehicle.travelledDistance': ('odometru_km', 0, 1000000, KM),
    'vehicle.drivetrain.fuelSystem.level': ('combustibil_pct', 0, 100, PCT),
    'vehicle.drivetrain.fuelSystem.remainingFuel': ('combustibil_litri', 0, 150, LITRI),
    'vehicle.cabin.infotainment.navigation.remainingRange': ('autonomie_termic_km', 0, 2000, KM),
    'vehicle.drivetrain.electricEngine.kombiRemainingElectricRange': ('autonomie_electric_km', 0, 1000, KM),
    'vehicle.drivetrain.lastRemainingRange': ('autonomie_totala_km', 0, 3000, KM),
    'vehicle.drivetrain.batteryManagement.header': ('soc_pct', 0, 100, PCT),
    'vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.fuel': ('obfcm_combustibil_l', 0, 50000, LITRI),
    'vehicle.drivetrain.fuelSystem.consumptionOverLifeTime.overall.referenceDistance': ('obfcm_distanta_km', 0, 1000000, KM),
}
# locatia (decizia Razvan 14.10.2026: masina lui, condusa de el) — tabel separat, RLS doar owner
CHEI_LOCATIE = {
    'vehicle.cabin.infotainment.navigation.currentLocation.latitude': ('lat', -90, 90, GRADE),
    'vehicle.cabin.infotainment.navigation.currentLocation.longitude': ('lon', -180, 180, GRADE),
    'vehicle.cabin.infotainment.navigation.currentLocation.heading': ('heading', 0, 360, GRADE),
}
CHEI_CONTAINER = list(CHEI_METRICI) + list(CHEI_LOCATIE)
COLOANE = [v[0] for v in CHEI_METRICI.values()]
OBLIGATORIU = 'odometru_km'
SURSA = 'bmw_cardata_rest'
FORMAT = 1

VIN_RE = re.compile(r'^[A-HJ-NPR-Z0-9]{17}$')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
NUMAR_RE = re.compile(r'^[+-]?\d{1,10}(\.\d{1,12})?$')
TS_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$')
# acelasi tipar ca CHECK-ul din BD: nimic de locatie in raspuns_brut (aparare in adancime)
LOCATIE_RE = re.compile(r'latitude|longitude|currentlocation|destinationset|heading|altitude', re.I)
VALORI_NULE = {'', 'INVALID', 'NULL', 'NONE', 'N/A', 'NA', '-'}
LUNGIME_MAX = {'value': 40, 'unit': 16, 'timestamp': 40}
BRUT_MAX_OCTETI = 8192
TS_MINIM = datetime(2010, 1, 1, tzinfo=timezone.utc)
TOLERANTA_VIITOR = timedelta(minutes=10)


class EroareValidare(Exception):
    """Citire refuzata (mesaj sigur de afisat: nu contine tokenuri)."""


def vin_valid(vin):
    return isinstance(vin, str) and bool(VIN_RE.match(vin))


def parse_ts(text):
    """ISO 8601 cu fus orar -> datetime UTC; altfel ValueError."""
    if not isinstance(text, str):
        raise ValueError('timestamp nu e text')
    m = TS_RE.match(text.strip())
    if not m:
        raise ValueError('timestamp in format necunoscut')
    zi, ora, frac, fus = m.groups()
    frac = (frac or '.0')[1:][:6].ljust(6, '0')
    fus = '+00:00' if fus == 'Z' else (fus if ':' in fus else fus[:3] + ':' + fus[3:])
    return datetime.fromisoformat(f'{zi}T{ora}.{frac}{fus}').astimezone(timezone.utc)


def ts_iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def _numar(valoare):
    """Text/numar -> Decimal finit; None pentru valorile „lipsa” BMW (INVALID etc.); ValueError altfel."""
    if valoare is None:
        return None
    if isinstance(valoare, bool):
        raise ValueError('valoare booleana')
    if isinstance(valoare, (int, float)):
        valoare = repr(valoare) if isinstance(valoare, float) else str(valoare)
    if not isinstance(valoare, str):
        raise ValueError('valoare de tip neasteptat')
    t = valoare.strip()
    if t.upper() in VALORI_NULE:
        return None
    if not NUMAR_RE.match(t):
        raise ValueError('valoare nenumerica')
    try:
        d = Decimal(t)
    except InvalidOperation:
        raise ValueError('valoare nenumerica')
    if not d.is_finite():
        raise ValueError('valoare nefinita')
    return d


def _verifica(cheie, intrare, spec, acum):
    """intrare BMW {value, unit, timestamp} -> (Decimal|None, ts_iso|None); ValueError cu motivul (fara valoarea bruta)."""
    _, mn, mx, unitati = spec
    if intrare is None:
        return None, None
    if not isinstance(intrare, dict):
        raise ValueError('intrare care nu e obiect')
    d = _numar(intrare.get('value'))
    if d is None:
        return None, None
    unit = intrare.get('unit')
    if unit is not None and not isinstance(unit, str):
        raise ValueError('unitate de tip neasteptat')
    u = unit.strip().lower() if isinstance(unit, str) else None
    if unitati is KM and u in MILE:
        d = (d * KM_PE_MILA).quantize(Decimal('0.1'))
    elif unitati is KM and not u:
        # distanta fara unitate: BMW amesteca mile si km, nu ghicim (19.10.2026). Odometrul e obligatoriu => eroare acolo.
        if spec[0] == OBLIGATORIU:
            raise ValueError('odometru fara unitate')
        return None, None
    elif u not in unitati:
        raise ValueError(f'unitate neacceptata ({str(unit)[:12]!r})')
    if d < mn or d > mx:
        raise ValueError(f'in afara intervalului plauzibil [{mn}, {mx}]')
    ts = intrare.get('timestamp')
    if ts is None:
        return d, None
    t = parse_ts(ts)
    if t > acum + TOLERANTA_VIITOR or t < TS_MINIM:
        raise ValueError('timestamp in viitor sau implauzibil')
    return d, ts_iso(t)


def _brut(intrare):
    """Copia „bruta” pastrata in BD: doar value/unit/timestamp, ca text scurtat. Nu se interpreteaza."""
    if not isinstance(intrare, dict):
        return None
    out = {}
    for k, lim in LUNGIME_MAX.items():
        v = intrare.get(k)
        if v is None:
            out[k] = None
        elif isinstance(v, (str, int, float)) and not isinstance(v, bool):
            out[k] = str(v)[:lim]
        else:
            out[k] = None
    return out


def din_raspuns(raspuns, vin, acum=None):
    """Raspunsul GET telematicData -> inregistrarea locala (dict JSON-serializabil). Odometrul e obligatoriu."""
    acum = acum or datetime.now(timezone.utc)
    if not vin_valid(vin):
        raise EroareValidare('VIN-ul mapat lipseste sau e invalid (rulati setup)')
    if not isinstance(raspuns, dict) or not isinstance(raspuns.get('telematicData'), dict):
        raise EroareValidare('raspuns BMW fara obiectul telematicData')
    td = raspuns['telematicData']
    rec = {'format': FORMAT, 'id_citire': str(uuid.uuid4()), 'citit_la': ts_iso(acum), 'vin': vin, 'sursa': SURSA}
    respinse, brut = [], {}
    for col in COLOANE:
        rec[col] = None
    rec['odometru_la'] = None
    for cheie, spec in CHEI_METRICI.items():
        intrare = td.get(cheie)
        if intrare is not None:
            b = _brut(intrare)
            if b is not None:
                brut[cheie] = b
        try:
            d, ts = _verifica(cheie, intrare, spec, acum)
        except ValueError as e:
            respinse.append({'cheie': cheie, 'motiv': str(e)})
            continue
        rec[spec[0]] = None if d is None else str(d)
        if spec[0] == OBLIGATORIU:
            rec['odometru_la'] = ts
    if rec[OBLIGATORIU] is None:
        motiv = next((r['motiv'] for r in respinse if r['cheie'] == 'vehicle.vehicle.travelledDistance'), 'lipseste din raspuns')
        raise EroareValidare(f'odometrul (vehicle.vehicle.travelledDistance) nu e utilizabil: {motiv}')
    # locatia: doar daca lat si lon sunt valide si nu (0, 0); niciodata in raspuns_brut
    loc, pozitie_la = {}, None
    for cheie, spec in CHEI_LOCATIE.items():
        try:
            d, ts = _verifica(cheie, td.get(cheie), spec, acum)
        except ValueError as e:
            respinse.append({'cheie': cheie, 'motiv': str(e)})
            d, ts = None, None
        loc[spec[0]] = None if d is None else str(d)
        if spec[0] == 'lat':
            pozitie_la = ts
    if loc['lat'] is not None and loc['lon'] is not None and not (Decimal(loc['lat']) == 0 and Decimal(loc['lon']) == 0):
        rec['locatie'] = {'lat': loc['lat'], 'lon': loc['lon'], 'heading': loc['heading'], 'pozitie_la': pozitie_la}
    else:
        rec['locatie'] = None
    rec['raspuns_brut'] = brut
    rec['respinse'] = respinse
    if LOCATIE_RE.search(json.dumps(brut)):
        # o valoare/unitate cu text de locatie: nu se pastreaza nimic din ea
        raise EroareValidare('raspunsul brut contine text de locatie intr-o cheie non-locatie — refuzat')
    return rec


CAMPURI_REC = {'format', 'id_citire', 'citit_la', 'vin', 'sursa', 'odometru_la', 'raspuns_brut', 'respinse', 'locatie', *COLOANE}


def reverifica(rec, vin_mapat, acum=None):
    """Verificarea STRICTA inainte de scriere (fisierul local putea fi modificat intre citeste si scrie).
    Intoarce payload-ul pentru BD (fara respinse/format); EroareValidare la orice abatere."""
    acum = acum or datetime.now(timezone.utc)

    def refuz(motiv):
        raise EroareValidare(f'citire refuzata la scriere: {motiv}')

    if not isinstance(rec, dict):
        refuz('nu e obiect')
    if set(rec) != CAMPURI_REC:
        refuz('campuri lipsa sau necunoscute')
    if rec['format'] != FORMAT:
        refuz('format necunoscut')
    if not isinstance(rec['id_citire'], str) or not UUID_RE.match(rec['id_citire']):
        refuz('id_citire invalid')
    if not vin_valid(vin_mapat):
        refuz('VIN-ul mapat local e invalid (rulati setup)')
    if rec['vin'] != vin_mapat:
        refuz('VIN-ul citirii nu e VIN-ul mapat')
    if rec['sursa'] != SURSA:
        refuz('sursa necunoscuta')
    for camp in ('citit_la', 'odometru_la'):
        v = rec[camp]
        if v is None and camp == 'odometru_la':
            continue
        try:
            t = parse_ts(v)
        except ValueError:
            refuz(f'{camp} invalid')
        if t > acum + TOLERANTA_VIITOR or t < TS_MINIM:
            refuz(f'{camp} in viitor sau implauzibil')
    for cheie, (col, mn, mx, _) in CHEI_METRICI.items():
        v = rec[col]
        if v is None:
            if col == OBLIGATORIU:
                refuz('odometru lipsa')
            continue
        if not isinstance(v, str) or not NUMAR_RE.match(v):
            refuz(f'{col} nenumeric')
        if not (mn <= Decimal(v) <= mx):
            refuz(f'{col} in afara intervalului [{mn}, {mx}]')
    brut = rec['raspuns_brut']
    if not isinstance(brut, dict) or not set(brut) <= set(CHEI_METRICI):
        refuz('raspuns_brut cu chei in afara listei')
    for intrare in brut.values():
        if not isinstance(intrare, dict) or set(intrare) != set(LUNGIME_MAX):
            refuz('raspuns_brut: intrare cu structura neasteptata')
        for k, lim in LUNGIME_MAX.items():
            if intrare[k] is not None and (not isinstance(intrare[k], str) or len(intrare[k]) > lim):
                refuz('raspuns_brut: valoare prea lunga sau de tip neasteptat')
    text_brut = json.dumps(brut, ensure_ascii=True)
    if LOCATIE_RE.search(text_brut):
        refuz('raspuns_brut contine locatie')
    if len(text_brut.encode()) > BRUT_MAX_OCTETI:
        refuz('raspuns_brut prea mare')
    loc = rec['locatie']
    if loc is not None:
        if not isinstance(loc, dict) or set(loc) != {'lat', 'lon', 'heading', 'pozitie_la'}:
            refuz('locatie cu structura neasteptata')
        for cheie, (col, mn, mx, _) in CHEI_LOCATIE.items():
            v = loc[col]
            if v is None and col == 'heading':
                continue
            if not isinstance(v, str) or not NUMAR_RE.match(v) or not (mn <= Decimal(v) <= mx):
                refuz(f'locatie: {col} invalid')
        if Decimal(loc['lat']) == 0 and Decimal(loc['lon']) == 0:
            refuz('locatie (0, 0)')
        if loc['pozitie_la'] is not None:
            try:
                t = parse_ts(loc['pozitie_la'])
            except ValueError:
                refuz('locatie: pozitie_la invalid')
            if t > acum + TOLERANTA_VIITOR or t < TS_MINIM:
                refuz('locatie: pozitie_la in viitor sau implauzibil')
    if not isinstance(rec['respinse'], list):
        refuz('respinse nu e lista')
    return {k: v for k, v in rec.items() if k not in ('respinse', 'format')}
