"""Aliniere pe identitate; nicio reparare implicită a seriilor/cantităților."""
import copy
from .e3_contract import (E3Error, ARBITRABILE, comparable, validaStructuraE3,
                          valida_brut)


def dezacord(rand, field, left, right, obj, sablon):
    l, m = comparable(field, left), comparable(field, right)
    if l == m and (left is None) == (right is None) and (l is not None or left == right):
        return None
    suggestion = None
    if sablon == 'lista_curbe' and field == 'sarja':
        heat = obj['randuri'][rand - 1]['cod'].split('-')[-2]
        candidates = [v for v in (left, right) if v and v == heat]
        if len(candidates) == 1:
            suggestion = candidates[0]
    return {'rand': rand, 'camp': field, 'lighton': left, 'mineru': right, 'sugestie': suggestion}


def compara(lighton, mineru, sablon):
    """Întoarce obiectul și setul de dezacorduri. Numai aceste celule se trimit la arbitraj."""
    for obj in (lighton, mineru):
        valida_brut(obj, sablon)
        validaStructuraE3(obj, sablon)
    key_fields = ('nr_crt', 'serie') if sablon == 'aviz_teava' else ('serie', 'cod')
    def key(row):
        return tuple(comparable(k, row[k]) for k in key_fields)
    left = {key(r): r for r in lighton['randuri']}
    right = {key(r): r for r in mineru['randuri']}
    if left.keys() != right.keys() or len(left) != len(lighton['randuri']) or len(right) != len(mineru['randuri']):
        raise E3Error('structura_incerta')
    obj, cells = copy.deepcopy(lighton), []
    structural = ['nr_crt', 'serie', 'cantitate'] + (['cod', 'pachet_nr'] if sablon == 'lista_curbe' else [])
    def diff(rand, field, l, m):
        cell = dezacord(rand, field, l, m, obj, sablon)
        if cell is not None:
            cells.append(cell)
    for i, r in enumerate(obj['randuri'], 1):
        other = right[key(r)]
        if any(comparable(k, r[k]) != comparable(k, other[k]) for k in structural):
            raise E3Error('structura_incerta')
        # Dovada apartenenței: aceleași serii în fiecare pachet, nu doar același număr de pachet.
        if sablon == 'lista_curbe':
            for kg in ('net_kg', 'brut_kg'):
                if (r[kg] is None) != (other[kg] is None):
                    diff(i, kg, r[kg], other[kg])
        for k in ARBITRABILE[sablon]:
            diff(i, k, r[k], other[k])
    for k in obj['antet']:
        diff(0, k, obj['antet'][k], mineru['antet'][k])
    # B2 nu acceptă rand=-1 pentru totaluri. Rutăm prin cheile antetului și sincronizăm la aplicare.
    aliases = {'total_metri': 'total_m', 'total_kg': 'total_kg'} if sablon == 'aviz_teava' else {}
    for total, field in aliases.items():
        l, m = lighton['totaluri_tiparite'][total], mineru['totaluri_tiparite'][total]
        obj['antet'][field] = l
        cells = [c for c in cells if (c['rand'], c['camp']) != (0, field)]
        diff(0, field, l, m)
    # O singură celulă per pereche; contractul edge refuză dublurile.
    cells = list({(c['rand'], c['camp']): c for c in cells}.values())
    if len(cells) > 120:
        raise E3Error('prea_multe_dezacorduri')
    return obj, cells


def raspunsuri_arbitraj(cells, response):
    """Acceptă exact setul trimis: fără celule suplimentare, lipsă sau duplicate."""
    if not isinstance(response, dict):
        response = {'arbitraj': 'invalid'}
    values = response.get('celule', []) if isinstance(response, dict) else []
    expected = {(c['rand'], c['camp']) for c in cells}
    valid = (response.get('arbitraj') == 'ok' and isinstance(values, list)
             and len(values) == len(expected) and all(isinstance(v, dict) and set(v) == {'rand', 'camp', 'valoare', 'sigur'}
             and type(v['rand']) is int and isinstance(v['camp'], str) and type(v['sigur']) is bool
             and (v['valoare'] is None or isinstance(v['valoare'], str)) for v in values))
    if valid:
        valid = {(v['rand'], v['camp']) for v in values} == expected
    return {(v['rand'], v['camp']): v for v in values} if valid else {}


def aplica_arbitraj(obj, cells, response, sablon):
    """Aplică exclusiv dezacordurile produse de compara; celulele agreate sunt intangibile."""
    answers = raspunsuri_arbitraj(cells, response)
    for c in cells:
        target = obj['antet'] if c['rand'] == 0 else obj['randuri'][c['rand'] - 1]
        answer = answers.get((c['rand'], c['camp']))
        target[c['camp']] = answer['valoare'] if answer else None
        if not answer or not answer['sigur']:
            obj['avertismente'].append('Rând %s: verifică %s: L=%s, M=%s, ales %s' %
                                         (c['rand'], c['camp'], c['lighton'], c['mineru'], target[c['camp']]))
    if sablon == 'aviz_teava':
        obj['totaluri_tiparite'].update(total_metri=obj['antet']['total_m'], total_kg=obj['antet']['total_kg'])
    valida_brut(obj, sablon)
    validaStructuraE3(obj, sablon, dupa_arbitraj=True)
    return obj
