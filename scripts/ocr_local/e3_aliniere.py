"""Aliniere pe identitate; nicio reparare implicită a seriilor/cantităților."""
import copy
from .e3_contract import (E3Error, ARBITRABILE, comparable, validaStructuraE3,
                          valida_brut, numarE3, numarKgE3)


def compara(lighton, mineru, sablon):
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
        if (comparable(field, l) != comparable(field, m) or ((l is None) != (m is None))
                or (comparable(field, l) is None and l != m)):
            suggestion = None
            if sablon == 'lista_curbe' and field == 'sarja':
                parts = obj['randuri'][rand - 1]['cod'].split('-')
                candidates = [v for v in (l, m) if v and v == parts[-2]]
                if len(candidates) == 1:
                    suggestion = candidates[0]
            cells.append({'rand': rand, 'camp': field, 'lighton': l, 'mineru': m, 'sugestie': suggestion})
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


def aplica_arbitraj(obj, cells, response, sablon):
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
    answers = {(v['rand'], v['camp']): v for v in values} if valid else {}
    for c in cells:
        target = obj['antet'] if c['rand'] == 0 else obj['randuri'][c['rand'] - 1]
        answer = answers.get((c['rand'], c['camp']))
        target[c['camp']] = answer['valoare'] if answer else None
        if not answer or not answer['sigur']:
            obj['avertismente'].append('Rând %s: verifică %s: L=%s, M=%s, ales %s' %
                                         (c['rand'], c['camp'], c['lighton'], c['mineru'], target[c['camp']]))
    if sablon == 'aviz_teava':
        obj['totaluri_tiparite'].update(total_metri=obj['antet']['total_m'], total_kg=obj['antet']['total_kg'])
    for total, field, conv in [('total_metri', 'lungime_doc', numarE3), ('total_kg', 'greutate_kg', numarKgE3)]:
        values = [conv(r[field]) for r in obj['randuri']]
        printed = conv(obj['totaluri_tiparite'][total])
        if printed is not None and all(v is not None for v in values) and abs(sum(values) - printed) > .01:
            obj['avertismente'].append('Totalul tipărit %s diferă de suma rândurilor.' % total)
    valida_brut(obj, sablon)
    validaStructuraE3(obj, sablon, dupa_arbitraj=True)
    return obj
