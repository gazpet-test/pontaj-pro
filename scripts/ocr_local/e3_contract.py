"""Contractul brut E9. Conversiile sunt doar pentru comparație, niciodată pentru payload."""
import math
import re


class E3Error(ValueError):
    def __init__(self, cod):
        self.cod = cod
        super().__init__(cod)


TEXT = 'serie sarja lot specificatie standard dimensiune grad_otel izolatie cod item pachet_nr dimensiuni_cm motiv observatie'.split()
NUM = 'nr_crt lungime_doc greutate_kg perete_mm diametru_mm unghi_doc cantitate net_kg brut_kg pagina'.split()
COMUN = 'furnizor furnizor_cif nr_document data_document observatii'.split()
SPECIFIC = {
    'aviz_teava': 'cumparator transport_nr nume_proiect lot loc_livrare data_incarcare data_descarcare nr_camion total_m total_kg'.split(),
    'lista_curbe': 'factura importator destinatar referinta_client referinta_furnizor placa_camion_container total_bucati total_pachete total_net_kg total_brut_kg'.split(),
}
ARBITRABILE = {
    'aviz_teava': 'sarja lot specificatie dimensiune grad_otel izolatie lungime_doc greutate_kg'.split(),
    'lista_curbe': 'sarja item diametru_mm perete_mm specificatie unghi_doc standard dimensiuni_cm net_kg brut_kg'.split(),
}


def numarE3(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    if not isinstance(v, str):
        return None
    s = re.sub(r'[\s\u00a0\u202f]', '', v)
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.', 1) if s.rfind(',') > s.rfind('.') else s.replace(',', '')
    else:
        s = s.replace(',', '.', 1)
    if not re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', s):
        return None
    n = float(s)
    return n if math.isfinite(n) else None


def numarKgE3(v):
    if isinstance(v, str) and re.fullmatch(r'[0-9]{1,3}(?:[.,][0-9]{3})+', re.sub(r'\s', '', v)):
        return float(re.sub(r'[^0-9]', '', v))
    return numarE3(v)


def comparable(k, v):
    return (numarKgE3(v) if k.endswith('_kg') else numarE3(v)) if k in NUM or k.startswith('total_') else v


def obiect_gol(sablon):
    if sablon not in SPECIFIC:
        raise E3Error('structura_incerta')
    return {'antet': dict.fromkeys(COMUN + SPECIFIC[sablon]), 'randuri': [], 'rotatie_grade': 0,
            'totaluri_tiparite': dict.fromkeys(['total_metri', 'total_kg']), 'avertismente': []}


def valida_brut(obj, sablon):
    expected = obiect_gol(sablon)
    if not isinstance(obj, dict) or obj.keys() != expected.keys() or type(obj['rotatie_grade']) is not int or obj['rotatie_grade'] not in (0, 90, 180, 270):
        raise E3Error('structura_incerta')
    def leaves(value, keys):
        if not isinstance(value, dict) or set(value) != set(keys) or any(v is not None and not isinstance(v, str) for v in value.values()):
            raise E3Error('structura_incerta')
    leaves(obj['antet'], expected['antet'])
    leaves(obj['totaluri_tiparite'], expected['totaluri_tiparite'])
    if not isinstance(obj['randuri'], list) or not isinstance(obj['avertismente'], list) or not all(isinstance(v, str) for v in obj['avertismente']):
        raise E3Error('structura_incerta')
    for r in obj['randuri']:
        leaves(r, TEXT + NUM)


def validaStructuraE3(obj, sablon, *, dupa_arbitraj=False):
    """R3-2: acordul dintre două valori invalide nu constituie dovadă."""
    rows = obj['randuri']
    if len(rows) > 200:
        raise E3Error('limita_randuri')
    if not rows:
        raise E3Error('structura_incerta')
    seen_nr, seen_serie = set(), set()
    for i, r in enumerate(rows, 1):
        nr = numarE3(r.get('nr_crt'))
        serie = r.get('serie')
        if nr is None or nr < 1 or nr != int(nr) or nr in seen_nr or not isinstance(serie, str) or not serie.strip() or serie in seen_serie:
            raise E3Error('structura_incerta')
        seen_nr.add(nr)
        seen_serie.add(serie)
        if sablon == 'lista_curbe':
            cod = r.get('cod')
            if nr != i or numarE3(r.get('cantitate')) != 1 or not r.get('pachet_nr') or not cod or cod.split('-')[0] != serie or r.get('lungime_doc') is not None:
                raise E3Error('structura_incerta')
        elif sablon == 'aviz_teava':
            lungime = numarE3(r.get('lungime_doc'))
            if r.get('cantitate') is not None or (not (dupa_arbitraj and r.get('lungime_doc') is None) and (lungime is None or lungime <= 0)):
                raise E3Error('structura_incerta')
        else:
            raise E3Error('structura_incerta')
