#!/usr/bin/env python3
# ============================================================================
# extract_nativ.py — Import Documente, ramura A (PDF NATIV → intermediar.md)
# Faza 1 din spec (claude_docs slug spec_import_documente_v3, §8).
#
# Implementeaza integral regulile validate practic in spec:
#   - decrypt pikepdf (capcana RC4-permisiuni: fisierul PARE scanat, nu e)
#   - PyMuPDF rawdict (nu dict) — spatiile se reconstruiesc din gap-ul glifelor
#   - antet/subsol: linii identice pe >20 pagini + prag Y (<95pt / >~800pt)
#   - logo repetat: xref pe >20 pagini → ignorat
#   - titluri: CAP. N. / CAP. IV. / N.N / N.N.N / all-caps bold (numerotarea
#     originala se pastreaza — nu se converteste roman→arab)
#   - fragmentele de pe acelasi baseline (titluri justificate sparte de PyMuPDF
#     in cate o "linie" pe cuvant) → unite geometric
#   - titluri rupte pe mai multe randuri → absorbtie iterativa, ghidata de
#     cuprinsul original (intrarea din cuprins = forma completa a titlului)
#   - cuprins original: dot-leader (\.{4,}\s*\d+$) → eliminat, dar intrarile
#     se pastreaza in meta (validare §10: titluri vs cuprins)
#   - tabele pdfplumber; tabele-lista (≥80% celule goale pe o coloana) → lista
#   - buline Wingdings/Symbol → •
#   - defect 5: un bloc de text suprapus cu bbox de tabel NU se arunca daca
#     textul lui nu apare in tabelul extras (protejeaza „CAP. 5" pierdut)
#
# Output: <out>/intermediar.md (markeri <!-- pagina N -->) + <out>/media/*.png
#         + <out>/extract_meta.json (statistici pt validare)
# Originalul NU se modifica niciodata.
# ============================================================================
import json
import os
import re
import statistics
import sys
import unicodedata

import pikepdf
import pymupdf
import pdfplumber

A_HEADER_Y = 95        # pt — sub linia asta e antet (spec §8)
FOOTER_MARGIN = 65     # pt de la baza paginii — subsol (842-65 ≈ 777; spec: >800 pe A4 plin)
REPEAT_PAGES = 20      # linii/imagini identice pe mai mult de atatea pagini = mobilier de pagina
GAP_FACTOR = 0.35      # spatiu daca gap > 0.35 × latimea medie a glifelor din rand (spec)
DOT_LEADER = re.compile(r'\.{4,}\s*\d+\s*$')
RX_CAP = re.compile(r'^\s*(CAP(?:ITOLUL)?)\b\s*\.?\s*(?:(\d{1,2})|([IVXLC]{1,6})(?![A-ZĂÎÂȘȚ]))\s*[.\-–]?\s*(.*)', re.I)
RX_CAP_LIT = re.compile(r'^\s*CAPITOLUL\s+([A-Z])\s*[.\-–]?\s*(.*)')
# numerotari de sub-titlu: arabe si ROMANE, 2-4 niveluri; spatiul dupa punct
# poate lipsi in sursa („5.4.Materiale utilizate") — cerem doar majuscula
RX_H4 = re.compile(r'^\s*(\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,2})\s*\.?\s*([A-ZĂÎÂȘȚŞŢ].*)')
RX_H3 = re.compile(r'^\s*(\d{1,2}\.\d{1,2}\.\d{1,2})\s*\.?\s*([A-ZĂÎÂȘȚŞŢ].*)')
RX_H3R = re.compile(r'^\s*([IVXLC]{1,4}\.\d{1,2}\.\d{1,2})\s*\.?\s*([A-ZĂÎÂȘȚŞŢ].*)')
RX_H2 = re.compile(r'^\s*(\d{1,2}\.\d{1,2})\s*\.?\s*([A-ZĂÎÂȘȚŞŢ].*)')
RX_H2R = re.compile(r'^\s*([IVXLC]{1,4}\.\d{1,2})\s*\.?\s*([A-ZĂÎÂȘȚŞŢ].*)')
RX_NUMEROTATE = (RX_H4, RX_H3, RX_H3R, RX_H2, RX_H2R)  # ordinea = specificitate
BULLET_CHARS = {'', '', '', '', '•', '●', '▪', '·', '', ''}
BULLET_FONTS = ('wingdings', 'symbol', 'zapf')


def norm_txt(s):
    return re.sub(r'\s+', ' ', s).strip()


def norm_match(s):
    """Normalizare agresiva pt comparatia titlu↔cuprins (ş/ș, punctuatie, spatii)."""
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Za-z0-9]+', ' ', s).upper().strip()


def span_from_chars(span):
    """rawdict span → text cu spatii reconstruite din distanta intre glife."""
    chars = span.get('chars', [])
    if not chars:
        return ''
    widths = [c['bbox'][2] - c['bbox'][0] for c in chars if c['bbox'][2] > c['bbox'][0]]
    avg_w = statistics.mean(widths) if widths else 4.0
    out = [chars[0]['c']]
    for prev, cur in zip(chars, chars[1:]):
        gap = cur['bbox'][0] - prev['bbox'][2]
        if gap > GAP_FACTOR * avg_w:
            out.append(' ')
        out.append(cur['c'])
    return ''.join(out)


def is_bold(span):
    return bool(span.get('flags', 0) & 2 ** 4) or 'bold' in span.get('font', '').lower()


def line_record(line, page_no):
    """O linie rawdict → {text, y0, y1, x0, bold, fonts, sizes}."""
    parts, fonts, sizes, bolds = [], [], [], []
    for span in line.get('spans', []):
        t = span_from_chars(span)
        if not t:
            continue
        font = span.get('font', '')
        # buline din fonturi de simboluri → •
        if any(b in font.lower() for b in BULLET_FONTS) and len(norm_txt(t)) <= 2:
            t = '•'
        parts.append(t)
        fonts.append(font)
        sizes.append(span.get('size', 0))
        bolds.append(is_bold(span))
    text = norm_txt(' '.join(parts))
    for bc in BULLET_CHARS:
        if bc and text.startswith(bc):
            text = '• ' + text[len(bc):].lstrip()
            break
    if not text:
        return None
    bb = line['bbox']
    return {
        'text': text, 'y0': bb[1], 'y1': bb[3], 'x0': bb[0], 'page': page_no,
        'bold': (sum(bolds) >= max(1, len(bolds) // 2)) if bolds else False,
        'size': max(sizes) if sizes else 0,
    }


def classify_heading(rec):
    """→ (nivel, text_curatat) sau None."""
    t = rec['text']
    m = RX_CAP_LIT.match(t)
    if m:  # CAPITOLUL A/B/C/D (sectiunile Cartii Tehnice) → H2
        return 2, norm_txt(f"CAPITOLUL {m.group(1)}. {m.group(2)}")
    m = RX_CAP.match(t)
    if m and (rec['bold'] or t.isupper() or len(t) < 90):
        # numerotarea originala (arab SAU roman) se pastreaza; doar spatierea
        # se canonizeaza (sursa are „CAP.VI.INSTRUCTIUNI", „CAP.X .")
        cuv = 'CAPITOLUL' if len(m.group(1)) > 4 else 'CAP.'
        num = m.group(2) or m.group(3).upper()
        rest = norm_txt(m.group(4))
        return 1, f"{cuv} {num}. {rest}" if rest else f"{cuv} {num}."
    if len(t) < 120:
        for rx, lvl in zip(RX_NUMEROTATE, (4, 3, 3, 2, 2)):
            m = rx.match(t)
            if m:
                return lvl, norm_txt(f"{m.group(1)}. {m.group(2)}")
    letters = [c for c in t if c.isalpha()]
    if (rec['bold'] and letters and len(letters) >= 4
            and sum(1 for c in letters if c.isupper()) / len(letters) > 0.9
            and len(t) < 90 and not t.startswith('•')):
        return 2, t
    return None


def cell_txt(c):
    return norm_txt(c or '')


def table_to_md(rows):
    rows = [[cell_txt(c) for c in r] for r in rows]
    ncol = max(len(r) for r in rows)
    rows = [r + [''] * (ncol - len(r)) for r in rows]
    # tabel-lista (defect 2): ≥80% celule goale pe o coloana la tabel de 2 coloane
    if ncol == 2 and len(rows) >= 3:
        for col in (0, 1):
            vals = [r[col] for r in rows]
            if sum(1 for v in vals if not v) / len(vals) >= 0.8:
                other = 1 - col
                return '\n'.join(f"- {r[other]}" for r in rows if r[other]), 'lista'
    esc = lambda s: s.replace('|', '\\|')
    out = ['| ' + ' | '.join(esc(c) for c in rows[0]) + ' |',
           '|' + '---|' * ncol]
    out += ['| ' + ' | '.join(esc(c) for c in r) + ' |' for r in rows[1:]]
    return '\n'.join(out), 'tabel'


def main(pdf_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    media = os.path.join(out_dir, 'media')
    os.makedirs(media, exist_ok=True)

    # 1. DECRYPT (fara sa atingem originalul)
    work = os.path.join(out_dir, '_decrypted.pdf')
    with pikepdf.open(pdf_path) as p:
        encrypted = p.is_encrypted
        p.save(work)

    doc = pymupdf.open(work)
    n_pages = doc.page_count

    # 2. PASS 1 — linii + inventar imagini
    pages_lines, img_pages = [], {}
    for pno in range(n_pages):
        pg = doc[pno]
        raw = pg.get_text('rawdict')
        recs = []
        for block in raw.get('blocks', []):
            if block.get('type') == 1:
                continue  # imaginile le luam separat, cu xref
            for line in block.get('lines', []):
                r = line_record(line, pno + 1)
                if r:
                    recs.append(r)
        recs.sort(key=lambda r: (round(r['y0'], 1), r['x0']))
        pages_lines.append(recs)
        for xref, *_ in pg.get_images(full=True):
            img_pages.setdefault(xref, set()).add(pno + 1)

    logo_xrefs = {x for x, pgs in img_pages.items() if len(pgs) > REPEAT_PAGES}

    # 3. mobilier de pagina: text identic pe >20 pagini, in benzile antet/subsol
    freq = {}
    for recs in pages_lines:
        h = doc[0].rect.height
        for r in {norm_txt(x['text']) for x in recs
                  if x['y0'] < A_HEADER_Y or x['y1'] > h - FOOTER_MARGIN}:
            freq[r] = freq.get(r, 0) + 1
    furniture = {t for t, n in freq.items() if n > REPEAT_PAGES}
    # subsolul cu numar variabil de pagina (PAG 27 / 156)
    rx_pagefoot = re.compile(r'^(PAG\s*\.?\s*\d+\s*/?\s*(\d+)?|\d{1,3})$', re.I)

    # 4. PASS 2 — asamblare per pagina
    md, meta = [], {
        'fisier': os.path.basename(pdf_path), 'criptat_initial': encrypted,
        'pagini_pdf': n_pages, 'pagini_procesate': 0, 'pagini_sub_100_car': [],
        'titluri': [], 'tabele': 0, 'liste_din_tabele': 0, 'imagini': 0,
        'linii_cuprins_eliminate': 0, 'linii_mobilier_eliminate': 0,
        'titluri_unite': 0, 'protejate_defect5': 0, 'cuprins_titluri': [],
    }
    stats_chars = 0
    toc_norm = []  # intrarile din cuprins, normalizate — ghid pt absorbtia titlurilor

    for pno in range(n_pages):
        pg = doc[pno]
        h = pg.rect.height
        recs = pages_lines[pno]
        page_md = [f"<!-- pagina {pno + 1} -->"]

        # pagina de CUPRINS (defect 1): multe linii cu dot-leader → se elimina integral;
        # documentul generat isi face TOC propriu
        is_toc_page = sum(1 for r in recs if DOT_LEADER.search(r['text'])) >= 5

        # tabelele paginii (pdfplumber pe fisierul decriptat)
        tables = []
        if not is_toc_page:
          with pdfplumber.open(work) as pl:
            for tb in pl.pages[pno].find_tables():
                x0, top, x1, bottom = tb.bbox
                if bottom < A_HEADER_Y:      # tabel fals in zona de antet
                    continue
                try:
                    rows = tb.extract()
                except Exception:
                    rows = None
                if not rows or not any(any(cell_txt(c) for c in r) for r in rows):
                    continue
                tables.append({'bbox': tb.bbox, 'rows': rows, 'emitted': False})

        def table_text_blob(tb):
            return norm_txt(' '.join(cell_txt(c) for r in tb['rows'] for c in r)).lower()

        # imagini de continut (fara logo-uri)
        img_items = []
        for xref, *_rest in pg.get_images(full=True):
            if xref in logo_xrefs:
                continue
            try:
                rects = pg.get_image_rects(xref)
                y = rects[0].y0 if rects else 0
                pix = pymupdf.Pixmap(doc, xref)
                if pix.n - pix.alpha > 3:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                if pix.width < 24 or pix.height < 24:
                    continue  # ornamente minuscule
                name = f"p{pno + 1:03d}_{xref}.png"
                pix.save(os.path.join(media, name))
                img_items.append({'y': y, 'md': f"![](media/{name})"})
                meta['imagini'] += 1
            except Exception:
                continue

        # fragmente de pe acelasi rand vizual → o singura linie (titlurile
        # justificate ies din PyMuPDF ca o "linie" per cuvant, acelasi y0);
        # NU se unesc liniile din zona tabelelor (ar lipi celule intre coloane)
        joined = []
        for r in recs:
            cy = (r['y0'] + r['y1']) / 2
            in_tb_y = any(tb['bbox'][1] - 2 <= cy <= tb['bbox'][3] + 2 for tb in tables)
            prev = joined[-1] if joined else None
            if (prev is not None and not in_tb_y and not prev.get('_tb')
                    and abs(r['y0'] - prev['y0']) <= 2.0):
                bc = prev.pop('_bc', len(prev['text']) if prev['bold'] else 0)
                bc += len(r['text']) if r['bold'] else 0
                prev['text'] = norm_txt(prev['text'] + ' ' + r['text'])
                prev['y1'] = max(prev['y1'], r['y1'])
                prev['size'] = max(prev['size'], r['size'])
                prev['_bc'] = bc
                prev['bold'] = bc * 2 >= len(prev['text'])
            else:
                r['_tb'] = in_tb_y
                joined.append(r)
        recs = joined

        # linii → elemente, cu excluderi si protectii
        items = []
        skip_idx = set()
        toc_acc = []  # intrare de cuprins rupta pe mai multe randuri
        for i, r in enumerate(recs):
            if i in skip_idx:
                continue
            t = r['text']
            nt = norm_txt(t)
            if nt in furniture:
                meta['linii_mobilier_eliminate'] += 1
                continue
            if (r['y0'] < A_HEADER_Y or r['y1'] > h - FOOTER_MARGIN) and rx_pagefoot.match(nt):
                meta['linii_mobilier_eliminate'] += 1
                continue
            if is_toc_page:
                # se elimina din output, dar intrarile se RETIN (ghid titluri + validare)
                meta['linii_cuprins_eliminate'] += 1
                if norm_match(nt).replace(' ', '') in ('CUPRINS', 'OPIS', 'CONTENTS', 'TABLADEMATERII'):
                    toc_acc = []    # titlul paginii de cuprins (poate fi C U P R I N S)
                elif DOT_LEADER.search(t):
                    if RX_CAP.match(t) or RX_CAP_LIT.match(t) or any(rx.match(t) for rx in RX_NUMEROTATE):
                        toc_acc = []  # linia isi incepe propria intrare — acumularea e junk
                    entry = norm_txt(DOT_LEADER.sub('', ' '.join(toc_acc + [t])))
                    if entry:
                        meta['cuprins_titluri'].append(entry)
                        toc_norm.append(norm_match(entry))
                    toc_acc = []
                elif RX_CAP.match(t) or RX_CAP_LIT.match(t) or any(rx.match(t) for rx in RX_NUMEROTATE):
                    toc_acc = [t]   # intrare numerotata noua — ce era inainte e junk
                else:
                    toc_acc = (toc_acc + [t])[-3:]  # max 3 randuri per intrare
                continue
            if DOT_LEADER.search(t):
                meta['linii_cuprins_eliminate'] += 1
                entry = norm_txt(DOT_LEADER.sub('', t))
                if entry:
                    meta['cuprins_titluri'].append(entry)
                    toc_norm.append(norm_match(entry))
                continue
            # in tabel? (centrul liniei in bbox) — defect 5: doar daca textul chiar e in tabel
            cy = (r['y0'] + r['y1']) / 2
            in_tb = None
            for tb in tables:
                x0, top, x1, bottom = tb['bbox']
                if top - 2 <= cy <= bottom + 2:
                    in_tb = tb
                    break
            if in_tb is not None:
                probe = nt.lower()[:40]
                if probe and probe in table_text_blob(in_tb):
                    continue  # e continut de tabel, il emite tabelul
                meta['protejate_defect5'] += 1  # suprapus dar NEcuprins → pastram linia
            head = classify_heading(r)
            if head:
                lvl, txt = head
                # titlu rupt pe mai multe randuri (defect 4) — absorbtie iterativa.
                # Cand titlul apare in cuprins, INTRAREA din cuprins decide unde se
                # opreste (protejeaza propozitiile bold-caps de sub titlu); altfel
                # decid regulile de stil.
                last = r
                j = i + 1
                while j < len(recs) and j - i <= 3:
                    nxt = recs[j]
                    if not (0 < nxt['y0'] - last['y1'] < r['size'] * 1.6):
                        break
                    if not (abs(nxt['size'] - r['size']) < 0.6 and nxt['bold'] == r['bold']):
                        break
                    tcur = norm_match(txt)
                    cand = norm_match(txt + ' ' + nxt['text'])
                    on_path_cur = any(e == tcur or e.startswith(tcur + ' ') for e in toc_norm)
                    toc_ok = any(e == cand or e.startswith(cand + ' ') for e in toc_norm)
                    nletters = [c for c in nxt['text'] if c.isalpha()]
                    nxt_titleish = (nxt['bold'] and nletters
                                    and sum(1 for c in nletters if c.isupper()) / len(nletters) > 0.7)
                    nxt_e_titlu_numerotat = bool(RX_CAP.match(nxt['text']) or RX_CAP_LIT.match(nxt['text'])
                                                 or any(rx.match(nxt['text']) for rx in RX_NUMEROTATE))
                    style_ok = (nxt_titleish and len(txt) + len(nxt['text']) < 170
                                and not txt.rstrip().endswith(('.', ':'))
                                and not nxt_e_titlu_numerotat
                                and not DOT_LEADER.search(nxt['text']))
                    if toc_ok:
                        pass          # cuprinsul confirma continuarea
                    elif on_path_cur:
                        break         # titlul e complet conform cuprinsului — STOP
                    elif not style_ok:
                        break
                    txt = norm_txt(txt + ' ' + nxt['text'])
                    meta['titluri_unite'] += 1
                    skip_idx.add(j)
                    last = nxt
                    j += 1
                txt = txt.rstrip(',')
                # promovare la H1 ghidata de cuprins: corpul pierde uneori prefixul
                # „CAP." („8. CONTROLUL..."), dar cuprinsul il confirma drept capitol
                if lvl != 1:
                    tn = norm_match(txt)
                    if any(e == 'CAP ' + tn or e.startswith('CAP ' + tn + ' ') for e in toc_norm):
                        lvl = 1
                items.append({'y': r['y0'], 'kind': 'h', 'lvl': lvl, 'text': txt})
                meta['titluri'].append({'lvl': lvl, 'text': txt, 'pag': pno + 1})
            else:
                items.append({'y': r['y0'], 'kind': 'p', 'text': t, 'x0': r['x0']})

        for tb in tables:
            body, fel = table_to_md(tb['rows'])
            meta['tabele' if fel == 'tabel' else 'liste_din_tabele'] += 1
            items.append({'y': tb['bbox'][1], 'kind': 't', 'text': body})
        items += [{'y': im['y'], 'kind': 'i', 'text': im['md']} for im in img_items]
        items.sort(key=lambda it: it['y'])

        # paragrafe: linii consecutive de text → un paragraf; separatoare pt rest
        buf = []
        page_chars = 0
        def flush():
            nonlocal buf
            if buf:
                page_md.append(' '.join(buf) if not buf[0].startswith('• ')
                               else '\n'.join(buf))
                page_md.append('')
                buf = []
        for it in items:
            page_chars += len(it['text'])
            if it['kind'] == 'p':
                if it['text'].startswith('• '):
                    flush()
                    buf = [it['text']]
                    flush()
                else:
                    buf.append(it['text'])
            else:
                flush()
                if it['kind'] == 'h':
                    page_md += ['#' * it['lvl'] + ' ' + it['text'], '']
                else:
                    page_md += [it['text'], '']
        flush()

        stats_chars += page_chars
        meta['pagini_procesate'] += 1
        if page_chars < 100:
            meta['pagini_sub_100_car'].append(pno + 1)
        md.append('\n'.join(page_md))

    meta['caractere_total'] = stats_chars
    out_md = os.path.join(out_dir, 'intermediar.md')
    with open(out_md, 'w', encoding='utf-8') as f:
        f.write('\n\n'.join(md) + '\n')
    with open(os.path.join(out_dir, 'extract_meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    os.remove(work)

    print(json.dumps({k: v for k, v in meta.items() if k != 'titluri'},
                     ensure_ascii=False, indent=1))
    print('titluri H1:', sum(1 for t in meta['titluri'] if t['lvl'] == 1))
    print('titluri H2:', sum(1 for t in meta['titluri'] if t['lvl'] == 2))
    print('titluri H3:', sum(1 for t in meta['titluri'] if t['lvl'] == 3))


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'test-fixtures/import-documente/Caiet_de_sarcini.pdf'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'test-fixtures/import-documente/out'
    main(src, dst)
