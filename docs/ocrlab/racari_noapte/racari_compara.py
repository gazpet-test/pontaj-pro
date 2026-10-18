"""Comparatia de noapte (Racari, licitatia 15): numere pe pagina - LightOn / MinerU (rularea locala rt1) vs Haiku 4.5 / Haiku 5.5
(ofertare_citire_test, doar numerele extrase in SQL). Consens AI = valoare prezenta in >= 3 din 4 surse (cu multiplicitate).
Referinta verificata pe imagine e SEPARATA (verificat_imagine.json)."""
import collections, json, pathlib, re
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1'); R = RT.parent
NUM = re.compile(r'[0-9]+(?:[.,][0-9]+)*')
DATAURI = re.compile(r'data:image/[^"\s)]+')
MAP = {198: ('d198', 0), 199: ('d199', 0), 201: ('d201', 0), 212: ('d205', 0), 213: ('d205', 104), 214: ('d203', 0), 217: ('d204', 0),
       318: ('d318', 0), 1624: ('d1624', 0)}


def haiku():
    s = (R / 'haiku_numere_raw.txt').read_text(encoding='utf-8')
    outer = json.loads(s)['result']; i = outer.index('[{'); j = outer.rindex('}]') + 2
    arr = json.loads(outer[i:j])[0]['j']
    out = {}
    for x in arr:
        m = 'h45' if 'haiku-4-5' in x['model'] else 'h55'
        out[(x['doc'], x['p'], m)] = x['nums']
    return out


def ocr(doc, page, reader):
    d = RT / doc / ('page%04d' % page)
    if not d.exists(): return None, 'fara_banda'
    txt = []; st = 'ok'
    for b in sorted(p for p in d.iterdir() if p.is_dir()):
        rp = b / reader / 'result.json'
        if not rp.exists(): return None, 'necitit'
        r = json.loads(rp.read_text(encoding='utf-8'))
        if not r.get('ok'): st = 'incomplet'
        raw = (b / reader / 'raw.txt')
        txt.append(raw.read_text(encoding='utf-8') if raw.exists() else '')
    return NUM.findall(DATAURI.sub(' ', '\n'.join(txt))), st


def main():
    H = haiku(); rows = []; agg = collections.defaultdict(collections.Counter)
    for bd, (doc, off) in MAP.items():
        for p in range(1, 9):
            src = {'lighton': ocr(doc, p + off, 'lighton'), 'mineru': ocr(doc, p + off, 'mineru'),
                   'h45': (H.get((bd, p, 'h45')), 'ok' if (bd, p, 'h45') in H else 'lipsa'),
                   'h55': (H.get((bd, p, 'h55')), 'ok' if (bd, p, 'h55') in H else 'lipsa')}
            cnt = {k: collections.Counter(v[0] or []) for k, v in src.items() if v[0] is not None}
            vals = set().union(*cnt.values()) if cnt else set()
            cons = collections.Counter()
            if len(cnt) >= 3:
                for v in vals:
                    c = sorted((cnt[k][v] for k in cnt), reverse=True)
                    if c[2] > 0: cons[v] = c[2]
            ncons = sum(cons.values())
            row = {'bd_doc': bd, 'pagina_bd': p, 'rt1': '%s p%d' % (doc, p + off), 'consens': ncons}
            for k, (nums, st) in src.items():
                if nums is None: row[k] = {'stare': st}; agg[k]['pagini_lipsa'] += 1; continue
                c = cnt[k]; hit = sum(min(c[v], n) for v, n in cons.items())
                singur = sum(n for v, n in c.items() if all(cnt[o][v] == 0 for o in cnt if o != k))
                row[k] = {'stare': st, 'numere': sum(c.values()), 'din_consens': hit, 'unice': singur}
                agg[k]['pagini'] += 1; agg[k]['numere'] += sum(c.values()); agg[k]['din_consens'] += hit; agg[k]['consens'] += ncons
                agg[k]['unice'] += singur
                if ncons and not c: agg[k]['pagini_goale'] += 1
                if st != 'ok': agg[k]['pagini_incomplete'] += 1
            rows.append(row)
    rez = {'pe_pagina': rows, 'total': {k: dict(v, acoperire_consens=round(v['din_consens'] / max(v['consens'], 1), 3)) for k, v in agg.items()}}
    (R / 'comparatie_numere.json').write_text(json.dumps(rez, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(rez['total'], indent=1))


main()
