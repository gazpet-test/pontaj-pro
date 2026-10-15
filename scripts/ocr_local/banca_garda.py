"""Banca de proba a garzii (doar citire): garda ruleaza „in flux” (prefixe la fiecare 128 de caractere, ca la citire)
pe toate raw*.txt din radacinile date; verdictele merg intr-un jsonl. Cu --fata-de <baza.jsonl> listeaza fiecare
verdict schimbat. Orice schimbare de garda se judeca pe aceste cifre (alarme pierdute = bucle ratate posibile).

  python -B -m ocr_local.banca_garda <iesire.jsonl> <radacina>... [--fata-de baza.jsonl]
"""
import argparse, collections, json, pathlib, sys
from .guard import Guard

PAS = 128

def verdict(text, pas=PAS):
    g = Guard(); n = len(text); pos = min(pas, n)
    while True:
        r = g(text[:pos])
        if r: return r, pos, (g.event or {}).get('detail')
        if pos >= n: return None, n, None
        pos = min(pos + pas, n)

def grupa(f):
    return 'r1' if 'ocr_rulari' in f else 'codex' if 'Codex' in f else 'alte'

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument('iesire'); ap.add_argument('radacini', nargs='+'); ap.add_argument('--fata-de')
    a = ap.parse_args(argv); sys.stdout.reconfigure(encoding='utf-8')
    rez = {}
    with open(a.iesire, 'w', encoding='utf-8') as f:
        for root in map(pathlib.Path, a.radacini):
            for p in sorted(root.rglob('raw*.txt')):
                if '_arhiva' in str(p): continue  # copiile vechi ale benzilor reluate
                r, pos, det = verdict(p.read_text(encoding='utf-8', errors='replace'))
                rez[str(p)] = j = {'f': str(p), 'r': r, 'pos': pos, 'detail': det}
                f.write(json.dumps(j, ensure_ascii=False) + '\n')
    c = collections.Counter((grupa(k), j['r']) for k, j in rez.items())
    for (g, r), n in sorted(c.items(), key=lambda x: (x[0][0], str(x[0][1]))): print(f'{g:6s} {str(r):45s} {n}')
    if a.fata_de:
        baza = {j['f']: j for j in map(json.loads, open(a.fata_de, encoding='utf-8'))}
        dif = [(k, baza[k]['r'], j['r']) for k, j in rez.items() if k in baza and baza[k]['r'] != j['r']]
        print('schimbate fata de baza:', len(dif))
        for k, x, y in dif: print(f'  {x} -> {y}  {k}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
