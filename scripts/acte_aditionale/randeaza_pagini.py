# randeaza_pagini.py — pe serverul AI (13.10.2026): PDF-urile copiate de scan_acte.ps1 → PNG, ca Jakarinos (Codex,
# --sandbox read-only prin run_paw) sa poata citi scanarile fara sa scrie nimic. DOAR CITIRE pe copiile locale.
# Folosire: python randeaza_pagini.py <folder rulare>   (ex. C:\Users\Public\paw-data\acte\2026-10-16)
# Iesire:   <folder>\png\P<id>\<nume>_p<N>.png  (max 20 de pagini per fisier, 110 dpi) + <folder>\png\index.tsv
import csv, os, sys
import pymupdf

MAX_PAGINI = 20

def main(folder):
    lista = os.path.join(folder, 'lista.tsv')
    if not os.path.isfile(lista):
        print('LIPSESTE lista.tsv in', folder); return 3
    out = os.path.join(folder, 'png')
    os.makedirs(out, exist_ok=True)
    index = [('id', 'fisier_local', 'pagini', 'png')]
    with open(lista, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            src = r.get('fisier_local') or ''
            if not src.lower().endswith('.pdf') or not os.path.isfile(src):
                continue
            d = os.path.join(out, 'P' + r['id'])
            os.makedirs(d, exist_ok=True)
            baza = os.path.splitext(os.path.basename(src))[0][:100]
            try:
                doc = pymupdf.open(src)
            except Exception as e:
                index.append((r['id'], src, 'EROARE ' + str(e)[:80], '-')); continue
            n = min(doc.page_count, MAX_PAGINI)
            for i in range(n):
                doc[i].get_pixmap(dpi=110).save(os.path.join(d, f'{baza}_p{i + 1}.png'))
            index.append((r['id'], src, f'{n}/{doc.page_count}', d))
    with open(os.path.join(out, 'index.tsv'), 'w', encoding='utf-8', newline='') as f:
        csv.writer(f, delimiter='\t').writerows(index)
    print('randate:', len(index) - 1, 'fisiere PDF ->', out)
    return 0

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('folosire: python randeaza_pagini.py <folder rulare>'); sys.exit(2)
    sys.exit(main(sys.argv[1]))
