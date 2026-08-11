#!/usr/bin/env python3
# ============================================================================
# valideaza_nativ.py — Import Documente, validare automata NARATIV (spec §10)
#
# REGULA DE AUR: sistemul nu ghiceste niciodata. Ce nu trece se MARCHEAZA.
#
# Verificari (spec §10 narativ + criterii §12):
#   V1  pagini procesate = pagini PDF
#   V2  paginile <100 caractere — raportate (nu-s eroare: coperti, pagini goale)
#   V3  titluri vs cuprinsul original: fiecare intrare din cuprins are titlu
#       corespondent in document (potrivire normalizata, tolerant la ş/ș)
#   V4  H1 care nu apar in cuprins — informativ
#   V5  tabelele markdown sunt coerente (acelasi numar de coloane pe rand)
#   V6  imaginile referite exista pe disc
#   V7  diacritice romanesti prezente (ș/ț sau ş/ţ)
#   V8  ierarhie titluri: H3 fara H2 parinte pe aceeasi pagina — informativ
#   opt. comparatie cu un intermediar de REFERINTA (delta caractere/titluri)
#
# Iesire: <out>/raport_validare.json + rezumat om-lizibil pe stdout.
# Exit code 0 = nicio problema blocanta; 1 = exista verdicte FAIL.
# ============================================================================
import json
import os
import re
import sys
import unicodedata

DOT_LEADER = re.compile(r'\.{4,}\s*\d+\s*$')


def norm_match(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Za-z0-9]+', ' ', s).upper().strip()


def main(out_dir, ref_md=None):
    meta = json.load(open(os.path.join(out_dir, 'extract_meta.json'), encoding='utf-8'))
    md_path = os.path.join(out_dir, 'intermediar.md')
    md = open(md_path, encoding='utf-8').read()
    lines = md.splitlines()

    raport = {'fisier': meta['fisier'], 'verdicte': {}, 'detalii': {}}
    def verdict(k, ok, detaliu):
        raport['verdicte'][k] = 'PASS' if ok else ('INFO' if ok is None else 'FAIL')
        raport['detalii'][k] = detaliu

    # V1 — acoperire pagini
    verdict('V1_acoperire_pagini', meta['pagini_procesate'] == meta['pagini_pdf'],
            f"{meta['pagini_procesate']}/{meta['pagini_pdf']} pagini procesate")

    # V2 — pagini sarace in text (marcate, nu corectate)
    verdict('V2_pagini_sub_100_car', None,
            {'pagini': meta['pagini_sub_100_car'],
             'nota': 'de verificat vizual: coperti/pagini goale sunt normale'})

    # V3 — fiecare intrare din cuprinsul original exista in document:
    #   ideal ca TITLU; acceptabil ca TEXT (ex. sectiunile 1.1-1.6 sunt randuri
    #   intr-un tabel de identificare, nu titluri); FAIL doar daca lipseste total
    titluri = meta.get('titluri', [])
    tnorm = [norm_match(t['text']) for t in titluri]
    md_norm = norm_match(md)
    lipsa, ca_text = [], []
    for entry in meta.get('cuprins_titluri', []):
        e = norm_match(entry)
        if not e:
            continue
        # potrivire: egal, prefix (titlul poate avea coada taiata in cuprins);
        # tolerant la prefixul CAP./CAPITOLUL pierdut de corp („8. CONTROLUL...")
        e2 = re.sub(r'^(CAPITOLUL|CAP)\s+', '', e)
        gasit = any(t == e or t.startswith(e + ' ') or e.startswith(t + ' ')
                    or t == e2 or t.startswith(e2 + ' ')
                    for t in tnorm)
        if not gasit:
            if e in md_norm:
                ca_text.append(entry)
            else:
                lipsa.append(entry)
    verdict('V3_titluri_vs_cuprins', not lipsa,
            {'intrari_cuprins': len(meta.get('cuprins_titluri', [])),
             'ca_titlu': len(meta.get('cuprins_titluri', [])) - len(ca_text) - len(lipsa),
             'doar_ca_text': ca_text, 'lipsesc_total': lipsa})

    # V4 — H1 care nu-s in cuprins (informativ; copertile n-au cuprins);
    # H1 promovate au pierdut prefixul CAP. in corp → se compara si cu el
    cnorm = [norm_match(c) for c in meta.get('cuprins_titluri', [])]
    h1_necuprinse = []
    for t in (x for x in titluri if x['lvl'] == 1):
        tn = norm_match(t['text'])
        if not any(c in (tn, 'CAP ' + tn) or c.startswith(tn + ' ')
                   or c.startswith('CAP ' + tn + ' ') or tn.startswith(c + ' ')
                   for c in cnorm):
            h1_necuprinse.append(t['text'])
    verdict('V4_h1_fara_cuprins', None, h1_necuprinse)

    # V5 — coerenta tabelelor markdown
    tabele_rupte = []
    i = 0
    while i < len(lines):
        if lines[i].startswith('|') and i + 1 < len(lines) and re.match(r'^\|(-+\|)+\s*$', lines[i + 1].replace('---', '-')):
            ncol = lines[i].count('|')
            j = i + 2
            while j < len(lines) and lines[j].startswith('|'):
                if lines[j].count('|') != ncol:
                    tabele_rupte.append({'linie': j + 1, 'asteptat': ncol - 1,
                                         'gasit': lines[j].count('|') - 1})
                j += 1
            i = j
        else:
            i += 1
    verdict('V5_tabele_coerente', not tabele_rupte,
            {'tabele': meta['tabele'], 'liste_din_tabele': meta['liste_din_tabele'],
             'randuri_rupte': tabele_rupte})

    # V6 — imaginile referite exista
    img_refs = re.findall(r'!\[\]\((media/[^)]+)\)', md)
    img_lipsa = [p for p in img_refs if not os.path.exists(os.path.join(out_dir, p))]
    verdict('V6_imagini_pe_disc', not img_lipsa,
            {'referite': len(img_refs), 'lipsa': img_lipsa})

    # V7 — diacritice
    are_diac = bool(re.search(r'[șțăîâŞŢşţ]', md))
    verdict('V7_diacritice', are_diac,
            'ș/ț/ă/î/â prezente' if are_diac else 'NICIO diacritica — extractie suspecta')

    # V8 — salturi de ierarhie (H1 → H3 direct), informativ
    salturi = []
    prev_lvl = 0
    for t in titluri:
        if prev_lvl and t['lvl'] - prev_lvl > 1:
            salturi.append({'pag': t['pag'], 'de_la': prev_lvl, 'la': t['lvl'],
                            'titlu': t['text'][:60]})
        prev_lvl = t['lvl']
    verdict('V8_salturi_ierarhie', None, salturi)

    # optional — comparatie cu intermediarul de referinta
    if ref_md and os.path.exists(ref_md):
        ref = open(ref_md, encoding='utf-8').read()
        rh = {1: 0, 2: 0, 3: 0}
        for ln in ref.splitlines():
            m = re.match(r'^(#{1,3})\s', ln)
            if m:
                rh[len(m.group(1))] += 1
        nh = {1: 0, 2: 0, 3: 0}
        for ln in lines:
            m = re.match(r'^(#{1,3})\s', ln)
            if m:
                nh[len(m.group(1))] += 1
        verdict('REF_comparatie', None, {
            'caractere': {'referinta': len(ref), 'nou': len(md)},
            'titluri_referinta': rh, 'titluri_nou': nh,
            'nota': 'referinta are defectele §8 nerezolvate — diferentele in favoarea noului sunt asteptate',
        })

    cale = os.path.join(out_dir, 'raport_validare.json')
    with open(cale, 'w', encoding='utf-8') as f:
        json.dump(raport, f, ensure_ascii=False, indent=1)

    fails = [k for k, v in raport['verdicte'].items() if v == 'FAIL']
    for k, v in raport['verdicte'].items():
        d = raport['detalii'][k]
        scurt = d if isinstance(d, str) else json.dumps(d, ensure_ascii=False)[:160]
        print(f"[{v:4}] {k}: {scurt}")
    print(f"\nRaport complet: {cale}")
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'test-fixtures/import-documente/out'
    ref = sys.argv[2] if len(sys.argv) > 2 else 'test-fixtures/import-documente/intermediar.md'
    main(out, ref)
