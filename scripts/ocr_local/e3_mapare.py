"""Adaptor E3 separat de compare.py. HTML nativ și exporturile text din laborator."""
import html
import re
from .e3_antet import D, norm, camp_antet, extrage_antet
from .e3_contract import E3Error, TEXT, NUM, obiect_gol, valida_brut, validaStructuraE3, comparable
from .e3_grila import grile


SPAN_EXPORT = re.compile(r'⟦(rowspan|colspan)=([1-9][0-9]*)⟧')


def celula_text(text):
    """Consumă numai markerii de span ai exportului; punctuația valorilor rămâne intactă."""
    spans = {}
    def marker(match):
        key, value = match.groups()
        if key in spans:
            raise E3Error('structura_incerta')
        spans[key] = value
        return ''
    value = SPAN_EXPORT.sub(marker, text)
    if re.search(r'⟦(?:rowspan|colspan)\b', value):
        raise E3Error('structura_incerta')
    attrs = ''.join(' %s="%s"' % pair for pair in spans.items())
    return '<td%s>%s</td>' % (attrs, html.escape(value.strip()))


def tabele_text(raw):
    """Doar exportul laboratorului; refacem explicit rowspan-urile păstrate de export."""
    blocks, current = [], []
    for line in raw.split('## CSV')[0].splitlines() + ['']:
        if line.strip().startswith('|'):
            cells = []
            for text in line.strip().strip('|').split('|'):
                cells.append(celula_text(text))
            current.append('<tr>' + ''.join(cells) + '</tr>')
        elif current:
            blocks.append('<table>' + ''.join(current) + '</table>')
            current = []
    return ''.join(blocks)


def colonnes(row, sablon):
    out = {}
    for ci, c in enumerate(row):
        label = norm(c['text'])
        for k, aliases in D[sablon].items():
            if label in aliases:
                if k in out:
                    raise E3Error('structura_incerta')
                out[k] = ci
    required = {'nr_crt', 'serie', 'sarja', 'lungime_doc'} if sablon == 'aviz_teava' else {'serie', 'cod', 'sarja', 'cantitate'}
    return out if required <= out.keys() else None


def gaseste_antet(grid, sablon):
    for i, row in enumerate(grid):
        cols = colonnes(row, sablon)
        if cols:
            return i, cols
        if i + 1 < len(grid):
            joined = [{**a, 'text': a['text'] if a['origine'] == b['origine'] else a['text'] + ' ' + b['text']} for a, b in zip(row, grid[i + 1])]
            cols = colonnes(joined, sablon)
            if cols:
                return i + 1, cols
    return None


def mapare(raw, sablon, *, valideaza=True):
    obj = obiect_gol(sablon)
    extrage_antet(raw, obj['antet'])
    if sablon == 'lista_curbe':
        total = re.search(r'^TOTAL:\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s*$', raw.split('## CSV')[0], re.M)
        if total:
            for k, value in zip(['total_bucati', 'total_pachete', 'total_net_kg', 'total_brut_kg'], total.groups()):
                if obj['antet'][k] is None:
                    obj['antet'][k] = value
    grids = grile(raw if re.search(r'<table\b', raw, re.I) else tabele_text(raw))
    found = []
    for grid in grids:
        header = gaseste_antet(grid, sablon)
        if header:
            found.append((grid, *header))
        else:
            for row in grid:
                for i in range(len(row) - 1):
                    key = camp_antet(row[i]['text'], obj['antet'])
                    if key and not obj['antet'][key]:
                        obj['antet'][key] = row[i + 1]['text'].strip(' :') or None
    if not found:
        raise E3Error('tabel_negasit')
    if len(found) != 1:
        raise E3Error('structura_incerta')
    grid, hi, cols = found[0]
    if sablon == 'aviz_teava' and any(re.search(r'\b(BUC|PCS|QTY)\b', norm(c['text'])) for row in grid[:hi + 1] for c in row):
        raise E3Error('structura_incerta')
    packages = {}
    for ri, row in enumerate(grid[hi + 1:], hi + 1):
        if colonnes(row, sablon):
            continue
        if any(norm(c['text']).startswith('TOTAL') for c in row):
            for field, dest in [('lungime_doc', 'total_metri'), ('greutate_kg', 'total_kg')]:
                if field in cols:
                    obj['totaluri_tiparite'][dest] = row[cols[field]]['text'] or None
            if sablon == 'lista_curbe':
                for field, dest in [('cantitate','total_bucati'), ('pachet_nr','total_pachete'), ('net_kg','total_net_kg'), ('brut_kg','total_brut_kg')]:
                    if field in cols:
                        obj['antet'][dest] = row[cols[field]]['text'] or None
            continue
        first = next((i for i, c in enumerate(row) if c['text']), None)
        key = camp_antet(row[first]['text'], obj['antet']) if first is not None else None
        if key:
            obj['antet'][key] = next((c['text'] for c in row[first + 1:] if c['text']), None)
            continue
        r = dict.fromkeys(TEXT + NUM)
        for k, ci in cols.items():
            cell = row[ci]
            r[k] = cell['text'] or None
            if k in ('net_kg', 'brut_kg') and not cell['e_origine']:
                r[k] = None
        if sablon == 'lista_curbe':
            r['nr_crt'] = str(len(obj['randuri']) + 1)
            # Greutatea și dimensiunile trebuie să aparțină aceluiași grup de rânduri ca pachetul.
            if 'pachet_nr' not in cols:
                raise E3Error('structura_incerta')
            p = row[cols['pachet_nr']]
            if r['pachet_nr'] in packages and packages[r['pachet_nr']] != p['origine']:
                raise E3Error('structura_incerta')
            packages[r['pachet_nr']] = p['origine']
            for k in ('dimensiuni_cm', 'net_kg', 'brut_kg'):
                if k in cols:
                    c = row[cols[k]]
                    if (c['origine'][0], c['rowspan']) != (p['origine'][0], p['rowspan']):
                        raise E3Error('structura_incerta')
        r['pagina'] = '1'
        for field in NUM:
            if r[field] is not None and comparable(field, r[field]) is None:
                obj['avertismente'].append('Rând %s: verifică %s ilizibil.' % (len(obj['randuri']) + 1, field))
        obj['randuri'].append(r)
    if sablon == 'aviz_teava':
        verifica_numar_tiparit(raw, grids, len(obj['randuri']))
    valida_brut(obj, sablon)
    if valideaza:
        validaStructuraE3(obj, sablon)
    return obj


def verifica_numar_tiparit(raw, grids, count):
    """Număr de poziții tipărit explicit, separat de nr. crt. și de greutăți."""
    labels = {'TOTAL POZITII', 'TOTAL RANDURI', 'TOTAL TEVI', 'NUMAR TOTAL POZITII',
              'NUMAR TOTAL RANDURI', 'NUMAR TOTAL TEVI'}
    printed = []
    for line in raw.split('## CSV')[0].splitlines():
        label, sep, value = line.partition(':')
        if sep and norm(label) in labels:
            printed.append(value.strip())
    for grid in grids:
        for row in grid:
            for i, cell in enumerate(row[:-1]):
                if norm(cell['text']) in labels:
                    printed.append(row[i + 1]['text'].strip())
    if any(not re.fullmatch(r'[0-9]+', value) or int(value) != count for value in printed):
        raise E3Error('structura_incerta')
