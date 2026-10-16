"""Replan cu rutarea v2 (CPU) pe rt1 (Racari) si r1 (102), in directoare NOI; compara cu planul vechi: rute, benzi identice."""
import json, pathlib, sys, collections
sys.path.insert(0, r'C:\Users\Gazpet-Ai\gazpet-erp-ocrlab-c\scripts')
from ocr_local.plan import plan
OUT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\clasificator_v2')
CAZURI = [
    ('rt1_d205', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\pdf\d205.pdf', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\d205_auto', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\orientari_d205.json'),
    ('rt1_d203', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\pdf\d203.pdf', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\d203', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\orientari_d203.json'),
    ('rt1_d204', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\pdf\d204.pdf', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\d204', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\orientari_d204.json'),
    ('rt1_d1624', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\pdf\d1624.pdf', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\d1624', r'C:\Users\Public\paw-data\ocrlab\racari\rt1\orientari_d1624.json'),
    ('r1_d772', 'C:/Users/Public/paw-data/ocr_rulari/r1/pdf/772.pdf', 'C:/Users/Public/paw-data/ocr_rulari/r1/d772', None),
    ('r1_d1247', 'C:/Users/Public/paw-data/ocr_rulari/r1/pdf/1247.pdf', 'C:/Users/Public/paw-data/ocr_rulari/r1/d1247', None),
]
rez = {}
for nume, pdf, vechi_dir, ori in CAZURI:
    vechi = json.loads((pathlib.Path(vechi_dir) / 'plan.json').read_text(encoding='utf-8'))
    out = OUT / nume
    if not (out / 'plan.json').exists():
        if ori:
            n = len(json.loads(pathlib.Path(ori).read_text(encoding='utf-8')))
            plan(pdf, out, pages=list(range(1, n + 1)), orientations=json.loads(pathlib.Path(ori).read_text(encoding='utf-8')))
        else:  # r1: exact selectia confirmata de om in planul vechi
            sel = vechi['selection']; plan(pdf, out, pages=sel['pages_requested'], orientations=sel['orientations_confirmed'])
    nou = json.loads((out / 'plan.json').read_text(encoding='utf-8'))
    rv = {p['page']: p['route'] for p in vechi['pages']}; rn = {p['page']: p['route'] for p in nou['pages']}
    trec = collections.Counter((rv[k], rn[k]) for k in rn if rv.get(k) != rn[k])
    bv = {b['id']: b['image_sha256'] for b in vechi['bands']}; bn = {b['id']: b['image_sha256'] for b in nou['bands']}
    neaf = [k for k in bv if rv.get(int(k[1:5])) == 'ocr']
    diferite = [k for k in neaf if bn.get(k) != bv[k]]
    rez[nume] = {'rute_vechi': dict(collections.Counter(rv.values())), 'rute_noi': dict(collections.Counter(rn.values())),
                 'tranzitii': {'%s->%s' % k: v for k, v in trec.items()}, 'benzi_neafectate': len(neaf), 'benzi_neafectate_diferite': diferite[:10],
                 'semnale_clasificare': sum(1 for p in nou['pages'] for s in p['signals'] if s['type'] == 'clasificare_incerta')}
(OUT / 'masurare.json').write_text(json.dumps(rez, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(rez, ensure_ascii=False, indent=1))
