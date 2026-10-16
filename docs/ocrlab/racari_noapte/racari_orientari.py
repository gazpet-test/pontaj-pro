"""Orientarile rularii de TEST rt1. Native: din directia textului nativ (fitz 'dir'). Scanate: clasificare vizuala a laboratorului
pe foile de contact + verificare dupa aplicarea rotatiei (d205 p7 = 270, p73 = 90; d203 p4 = 90; d1624 p27 = 270). NU e confirmare umana."""
import collections, json, pathlib
import fitz
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1')
def rng(*ab): return [p for a, b in ab for p in range(a, b + 1)]
VIZUAL = {
    # verificat dupa aplicare (verif_orient.png): grupul p7 = 270, grupul p73 = 90 (prima clasificare era inversata)
    'd205': {270: rng((7, 11), (18, 22), (29, 33), (40, 44), (51, 55), (62, 66), (95, 99), (106, 110), (117, 121), (128, 132), (139, 143)),
             90: rng((73, 77), (84, 88), (150, 154), (161, 165), (172, 176))},
    'd1624': {270: rng((24, 30))},
    'd203': {90: [4, 5, 103]}, 'd204': {90: [23, 53, 83, 113]}, 'd198': {}, 'd211': {}, 'd316': {},
}
sursa = {}
for pdf in sorted((RT / 'pdf').glob('*.pdf')):
    k = pdf.stem; out = {}; src = {}
    with fitz.open(pdf) as d:
        for i, p in enumerate(d):
            n = i + 1
            if k in VIZUAL:
                o = next((a for a, ps in VIZUAL[k].items() if n in ps), 0); out[str(n)] = o; src[str(n)] = 'vizual_laborator'; continue
            c = collections.Counter()
            for b in p.get_text('dict')['blocks']:
                for l in b.get('lines', []):
                    dx, dy = l['dir']; L = sum(len(s['text']) for s in l['spans'])
                    o = 0 if dx > 0.9 else 180 if dx < -0.9 else 90 if dy < -0.9 else 270 if dy > 0.9 else None
                    if o is not None: c[o] += L
            if not c: out[str(n)] = 0; src[str(n)] = 'fara_text_nativ_implicit_0'; continue
            o, m = c.most_common(1)[0]
            o = (o - p.rotation) % 360 if False else o  # get_pixmap aplica /Rotate; 'dir' e in spatiul paginii afisate
            out[str(n)] = o; src[str(n)] = 'text_nativ'
    (RT / ('orientari_%s.json' % k)).write_text(json.dumps(out), encoding='utf-8'); sursa[k] = src
    print(k, dict(collections.Counter(out.values())), dict(collections.Counter(src.values())))
(RT / 'orientari_sursa.json').write_text(json.dumps(sursa), encoding='utf-8')
