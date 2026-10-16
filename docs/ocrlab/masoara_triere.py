import collections, json, pathlib, sys
sys.path.insert(0, r'C:\Users\Gazpet-Ai\gazpet-erp-ocrlab-t\scripts')
from ocr_local.masoara import bands
from ocr_local.compare import compare_band
from ocr_local.triere import triaza_banda
rez = {}; per_item = {}
for nume, root in (('r1', r'C:\Users\Public\paw-data\ocr_rulari\r1'), ('rt1', r'C:\Users\Public\paw-data\ocrlab\racari\rt1')):
    c = collections.Counter(); m = collections.Counter(); ct = collections.defaultdict(collections.Counter)
    for doc, band, ra, sa, rb, sb in bands(root):
        if doc.endswith('_auto'): continue
        _, its = compare_band(band, ra, sa, rb, sb)
        tr = triaza_banda(ra, rb, its)
        for it in its:
            k, motiv = tr[it['id']]; c[k] += 1; m[motiv] += 1; ct[it['tip']][k] += 1
            per_item[(nume, doc, it['band'], it['tip'], it['citire_lighton'], it['citire_mineru'])] = k
    rez[nume] = {'clase': dict(c), 'motive': dict(m), 'per_tip': {k: dict(v) for k, v in ct.items()}}
# proba arb-v2 pe r1: clasa itemilor decisi
R1 = pathlib.Path(r'C:\Users\Public\paw-data\ocr_rulari\r1')
baza = json.loads((R1 / 'pasi.json').read_text(encoding='utf-8'))['reluare']['valoare']['baza']
pc = collections.Counter()
for doc in ('772', '1247'):
    loc = {j['id']: j for j in (json.loads(l) for l in (R1 / ('d' + doc) / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines() if l.strip())}
    for l in (R1 / ('d' + doc) / 'decizii.jsonl').read_text(encoding='utf-8').splitlines():
        if not l.strip(): continue
        d = json.loads(l)
        if d['id'] in set(baza.get(doc, [])): continue
        it = loc[d['id']]; k = per_item.get(('r1', 'd' + doc, it['band'], it['tip'], it['citire_lighton'], it['citire_mineru']), 'nepotrivit')
        pc[(k, 'needs_human' if d['decizie'] == 'needs_human' else 'decis')] += 1
rez['proba_arbv2'] = {'%s|%s' % k: v for k, v in sorted(pc.items())}
pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\masurare_triere.json').write_text(json.dumps(rez, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(rez, ensure_ascii=False, indent=1))
