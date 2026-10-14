"""Date de test pentru harness-ul 20261029a (scripts/test_ofertare_ocr_local.sh), produse de ACELAȘI cod ca pipeline-ul
(scripts/ocr_local/compare.py): segmentele unei citiri, dezacordurile reale dintre două citiri ale unei benzi și adevărul despre
granițele de token (pentru fn_ofertare_ocr_granita). Doar biblioteca standard — rulează și în WSL fără PIL.
Utilizare: python3 ofertare_ocr_local_fixtures.py seg TEXT | dez PAGINA BANDA TEXT_L TEXT_M | src TEXT SEG ACUL DELTA LUNGIME
           | set CHEIE VALOARE_JSON [...] (JSON pe stdin) | granita"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))
from ocr_local.compare import TOKEN, compare_band, item_hash, segmente  # noqa: E402

def dez(page, band, raw_l, raw_m):
    b = {'id': 'p%04d_b%d' % (page, band), 'page': page, 'kind': 'text', 'image': 'x.png', 'image_sha256': '0' * 64}
    ok = {'ok': True, 'protocol': 'lighton-mineru-v2', 'weights_sha256': '0' * 64}
    _, items = compare_band(b, raw_l, ok, raw_m, ok)
    for it in items:
        it['item_sha256'] = item_hash(it)
        # forma pe care o încarcă pipeline-ul (D3b): item_id + document / pagină, restul câmpurilor ca în dezacorduri.jsonl
        it['item_id'] = it['id']; it['document_id'] = 1247; it['pagina'] = page
        print(json.dumps(it, ensure_ascii=False))

def src(raw, seg, needle, delta, length):
    s = segmente(raw)[seg][1]; i = s.index(needle) + delta
    print(json.dumps({'seg': [seg, seg], 'start': i, 'end': i + length}))

def setk(pairs):
    o = json.loads(sys.stdin.read())
    for k, v in zip(pairs[::2], pairs[1::2]):
        cur = o; ks = k.split('.')
        for x in ks[:-1]: cur = cur[x]
        cur[ks[-1]] = json.loads(v)
    print(json.dumps(o, ensure_ascii=False))

PROBE = ['Cantitate 10.5 m și 5 buc', '1e3 kg', '1e-3 / 1E+4', '5e', '5em', 'x-5', 'a.5', '5,.5', 'DN110', '10**2 + 3**2', '±0,5 ±.5',
         '−5', '5% 50‰ 5 %', 'abe3', '5.', '1,234.56', '+.5', 'e5', '5ee5', '--5', 'Țeavă PEHD', 'ăîâșț ĂÎÂȘȚ', 'x<5 si z>3', 'm^{2}',
         'Dimensiune 10×2', '5-3', 'a_b', '1.2.3', '(5)', 'km/h', 'L=12,5m', 'e-5', '3e+', '0,056 mc', "it's 5'"]

def granita():
    for s in PROBE:
        mid = {i for m in TOKEN.finditer(s) for i in range(m.start() + 1, m.end())}
        for i in range(len(s) + 1): print('%s\t%d\t%s' % (s, i, 'f' if i in mid else 't'))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'seg': print(json.dumps(segmente(a[1]), ensure_ascii=False))
    elif a[0] == 'dez': dez(int(a[1]), int(a[2]), a[3], a[4])
    elif a[0] == 'src': src(a[1], int(a[2]), a[3], int(a[4]), int(a[5]))
    elif a[0] == 'set': setk(a[1:])
    elif a[0] == 'granita': granita()
    else: sys.exit('comandă necunoscută')
