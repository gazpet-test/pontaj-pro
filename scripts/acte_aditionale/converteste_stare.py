# converteste_stare.py — O SINGURA DATA, la mutarea pe serverul AI (16.10.2026): cheile din stare.tsv trec de la cale
# absoluta (Z:\Oferte\... de pe laptop, sau \\gazpet-tnas\Licitatii_Executate\...) la cale RELATIVA la radacina NAS.
# Fara rescriere oarba:
#   python converteste_stare.py --preview [--fisier <stare.tsv>]
#       -> doar afiseaza: cate randuri, cate se convertesc, cate sunt deja relative, exemple, probleme. Nu scrie nimic.
#   python converteste_stare.py --aplica --asteptat <N> [--fisier <stare.tsv>]
#       -> scrie DOAR daca numarul de chei convertite == N (cifra din preview) si nu exista probleme;
#          pastreaza copia veche ca stare.tsv.inainte_<AAAAMMZZ_HHMMSS> si inlocuieste atomic (fisier temporar + os.replace).
# Idempotent: a doua rulare gaseste 0 de convertit. Nu atinge NAS-ul.
import argparse, datetime, os, re, shutil, sys

FISIER_IMPLICIT = r'C:\Users\Public\paw\acte\stare.tsv'
PREFIXE_IMPLICITE = [r'Z:' + '\\', r'\\gazpet-tnas\Licitatii_Executate' + '\\']


def e_absoluta(cheie):
    return bool(re.match(r'^[A-Za-z]:', cheie)) or cheie.startswith('\\\\') or cheie.startswith('//')


def analizeaza(linii, prefixe):
    """Intoarce (randuri_noi, statistici). randuri_noi = lista (cheie, valoare) in ordinea fisierului, fara duplicate."""
    st = {'total': 0, 'convertite': 0, 'deja_relative': 0, 'goale': 0, 'duplicate_identice': 0,
          'probleme': [], 'exemple': []}
    noi, vazut = [], {}
    for nr, linie in enumerate(linii, 1):
        linie = linie.rstrip('\r\n')
        if not linie.strip():
            st['goale'] += 1
            continue
        st['total'] += 1
        parti = linie.split('\t')
        if len(parti) != 2 or not parti[0] or not parti[1]:
            st['probleme'].append(f'rand {nr}: format nerecunoscut (astept cale<TAB>marime|data)')
            continue
        cheie, val = parti
        if e_absoluta(cheie):
            p = next((p for p in prefixe if cheie.lower().startswith(p.lower())), None)
            if p is None:
                st['probleme'].append(f'rand {nr}: cale absoluta cu prefix necunoscut: {cheie[:60]}')
                continue
            rel = cheie[len(p):].lstrip('\\/')
            if not rel or re.search(r'(^|\\)\.\.(\\|$)', rel):
                st['probleme'].append(f'rand {nr}: cale relativa invalida dupa conversie: {cheie[:60]}')
                continue
            st['convertite'] += 1
            if len(st['exemple']) < 3:
                st['exemple'].append((cheie, rel))
        else:
            rel = cheie
            st['deja_relative'] += 1
        # cheile din scanare sunt case-insensitive (hashtable PowerShell) -> comparam la fel
        k = rel.lower()
        if k in vazut:
            if noi[vazut[k]][1] == val:
                st['duplicate_identice'] += 1
                continue
            st['probleme'].append(f'rand {nr}: aceeasi cale de doua ori cu valori diferite: {rel[:60]}')
            continue
        vazut[k] = len(noi)
        noi.append((rel, val))
    return noi, st


def main(argv=None):
    ap = argparse.ArgumentParser(description='Conversie o singura data a cheilor din stare.tsv la cale relativa.')
    mod = ap.add_mutually_exclusive_group(required=True)
    mod.add_argument('--preview', action='store_true', help='doar afiseaza ce s-ar schimba')
    mod.add_argument('--aplica', action='store_true', help='scrie (cere --asteptat)')
    ap.add_argument('--asteptat', type=int, help='numarul de chei convertite vazut in preview')
    ap.add_argument('--fisier', default=FISIER_IMPLICIT)
    ap.add_argument('--prefix', action='append', help='prefix absolut de scos (repetabil); implicit Z:\\ si UNC-ul NAS')
    a = ap.parse_args(argv)
    prefixe = a.prefix or PREFIXE_IMPLICITE
    if not os.path.isfile(a.fisier):
        print('LIPSESTE', a.fisier)
        return 3
    with open(a.fisier, encoding='utf-8-sig', newline='') as f:
        linii = f.read().splitlines()
    noi, st = analizeaza(linii, prefixe)
    print(f'fisier: {a.fisier}')
    print(f'randuri: {st["total"]} | de convertit: {st["convertite"]} | deja relative: {st["deja_relative"]} | '
          f'duplicate identice (comasate): {st["duplicate_identice"]} | goale: {st["goale"]} | probleme: {len(st["probleme"])}')
    print(f'randuri dupa conversie: {len(noi)}')
    for vechi, nou in st['exemple']:
        print(f'  exemplu: {vechi}\n       -> {nou}')
    for p in st['probleme'][:20]:
        print('  PROBLEMA', p)
    if a.preview:
        if st['convertite']:
            print(f'pentru aplicare: python converteste_stare.py --aplica --asteptat {st["convertite"]} --fisier "{a.fisier}"')
        return 0
    # --aplica
    if a.asteptat is None:
        print('REFUZ: --aplica cere --asteptat <N> (cifra "de convertit" din --preview)')
        return 5
    if st['probleme']:
        print('REFUZ: exista probleme - se rezolva intai (fisierul nu a fost atins)')
        return 6
    if st['convertite'] != a.asteptat:
        print(f'REFUZ: de convertit acum {st["convertite"]}, asteptat {a.asteptat} - fisierul s-a schimbat de la preview')
        return 7
    if st['convertite'] == 0 and st['duplicate_identice'] == 0:
        print('nimic de convertit - fisierul ramane neatins')
        return 0
    copie = a.fisier + '.inainte_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(a.fisier, copie)
    tmp = a.fisier + '.tmp_conversie'
    # BOM + CRLF, ca Set-Content -Encoding UTF8 din PowerShell 5.1 (scan_acte.ps1 il citeste la fel)
    with open(tmp, 'w', encoding='utf-8-sig', newline='\r\n') as f:
        for k, v in sorted(noi, key=lambda kv: kv[0].lower()):
            f.write(f'{k}\t{v}\n')
    os.replace(tmp, a.fisier)
    print(f'APLICAT: {st["convertite"]} chei convertite, {len(noi)} randuri scrise; copia veche: {copie}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
