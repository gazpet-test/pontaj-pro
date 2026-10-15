"""Banca de proba a garzii (doar citire): garda ruleaza pe toate raw*.txt din radacinile date, cum ruleaza la citire:
LightOn / restul „in flux” (prefixe la fiecare 128 de caractere), MinerU o data pe textul intreg (vezi aproximarea din mineru()).
Verdictele merg intr-un jsonl.
Cu --fata-de <baza.jsonl> listeaza orice schimbare (motiv, detaliu, punct de oprire) si fisierele aparute / disparute.
Orice schimbare de garda se judeca pe aceste cifre (alarme pierdute = bucle ratate posibile).

  python -B -m ocr_local.banca_garda <iesire.jsonl> <radacina>... [--fata-de baza.jsonl]
"""
import argparse, collections, json, pathlib, sys
from .guard import Guard, IMG_PIPELINE

PAS = 128

def in_flux(text, pas=PAS):
    g = Guard(); n = len(text); pos = min(pas, n)
    while True:
        r = g(text[:pos])
        if r: return r, pos, (g.event or {}).get('detail')
        if pos >= n: return None, n, None
        pos = min(pos + pas, n)

FARA_SCUTIRE = False  # --fara-scutire: baza = garda v4 (fara imagini scutite)

def mineru(text):
    # APROXIMARE de banca: la citire, scutirile vin din inregistrarea codificarii (read._inregistreaza_decupaje); rularile vechi
    # nu au inregistrarea, asa ca aici fiecare payload JPEG din forma exacta conteaza ca inregistrat o data (textele sunt ale
    # pipeline-ului). Copiile in plus raman vazute, ca la citire.
    imagini = [] if FARA_SCUTIRE else list(dict.fromkeys(m[1] for m in IMG_PIPELINE.finditer(text)))
    g = Guard(imagini); r = g(text)
    return r, len(text), (g.event or {}).get('detail')

def verdict(p):
    text = p.read_text(encoding='utf-8', errors='replace')
    if p.parent.name == 'mineru': return mineru(text)
    return in_flux(text)

def grupa(f):
    return 'r1' if 'ocr_rulari' in f else 'codex' if 'Codex' in f else 'alte'

CHEI = ('r', 'pos', 'detail')

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument('iesire'); ap.add_argument('radacini', nargs='+'); ap.add_argument('--fata-de'); ap.add_argument('--fara-scutire', action='store_true')
    a = ap.parse_args(argv); sys.stdout.reconfigure(encoding='utf-8')
    global FARA_SCUTIRE; FARA_SCUTIRE = a.fara_scutire
    rez = {}
    with open(a.iesire, 'w', encoding='utf-8') as f:
        for root in map(pathlib.Path, a.radacini):
            for p in sorted(root.rglob('raw*.txt')):
                if '_arhiva' in str(p): continue  # copiile vechi ale benzilor reluate
                r, pos, det = verdict(p)
                rez[str(p)] = j = {'f': str(p), 'r': r, 'pos': pos, 'detail': det}
                f.write(json.dumps(j, ensure_ascii=False) + '\n')
    c = collections.Counter((grupa(k), j['r']) for k, j in rez.items())
    for (g, r), n in sorted(c.items(), key=lambda x: (x[0][0], str(x[0][1]))): print(f'{g:6s} {str(r):45s} {n}')
    if a.fata_de:
        baza = {j['f']: j for j in map(json.loads, open(a.fata_de, encoding='utf-8'))}
        noi, lipsa = sorted(set(rez) - set(baza)), sorted(set(baza) - set(rez))
        dif = [(k, baza[k], j) for k, j in rez.items() if k in baza and any(baza[k].get(x) != j.get(x) for x in CHEI)]
        print(f'fata de baza: {len(dif)} schimbate, {len(noi)} fisiere noi, {len(lipsa)} lipsa')
        for k, x, y in dif: print('  ' + ' | '.join(f'{c}: {x.get(c)} -> {y.get(c)}' for c in CHEI if x.get(c) != y.get(c)) + f'  {k}')
        for k in noi: print('  NOU', k)
        for k in lipsa: print('  LIPSA', k)
    return 0

if __name__ == '__main__':
    sys.exit(main())
