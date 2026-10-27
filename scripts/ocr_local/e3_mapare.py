"""Adaptor E3 separat de compare.py. HTML nativ și exporturile text din laborator."""
import html
import re
import unicodedata
from .e3_antet import D, norm, camp_antet, extrage_antet
from .e3_contract import E3Error, TEXT, NUM, obiect_gol, valida_brut, validaStructuraE3, comparable, numarE3, numarKgE3
from .e3_grila import grile


SPAN_EXPORT = re.compile(r'⟦(rowspan|colspan)=([1-9][0-9]*)⟧')

# Gradul oțelului de țeavă (EN ISO 3183 L…, API 5L X…), fără spații: „L 360 NE” → „L360NE”. Listă închisă de clase, ca
# „610x7.10” / „L = 12 m” să nu devină grad; X nu după „cifră + spațiu” (610 X 52 = dimensiune). Mai multe grade diferite
# (dublă certificare) → toate, cu „/”. Aceeași regulă ca gradOtelE3 din supabase/functions/ocr-packing-list/avizE3.ts.
GRAD_OTEL = re.compile(r'(?<![A-Z0-9])(?:L[\s-]?(175|210|245|290|320|360|390|415|450|485|555)|(?<![0-9]\s)X[\s-]?(42|46|52|56|60|65|70|80))'
                       r'(?:[\s-]?([NQM])(?:[\s-]?([EB]))?)?(?![A-Z0-9])')
NUMAR_TIPARIT = r'([0-9]+(?:[.,][0-9]+)*)'
# Caseta de totaluri de sub tabel (aviz COMTECH P 0160): „Total lungime: 178.97 m”, „Total greutate neta: 20.564 kg”,
# „Total cantitate: 30”. Unitatea e obligatorie (înainte sau după număr), altfel nu e total de metri / kg.
CASETA_TOTALURI = [
    ('total_metri', numarE3, re.compile(r'\bTOTAL LUNGIMEA? (?:M %s|%s ?M(?![A-Z0-9]))' % (NUMAR_TIPARIT, NUMAR_TIPARIT))),
    ('total_kg', numarKgE3, re.compile(r'\bTOTAL GREUTATEA?(?: NETA)? (?:KG %s|%s ?KG(?![A-Z0-9]))' % (NUMAR_TIPARIT, NUMAR_TIPARIT))),
]
TOTAL_BUCATI = re.compile(r'\bTOTAL CANTITATEA? %s(?![0-9.,])' % NUMAR_TIPARIT)


def fara_diacritice(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c)).upper()


def grad_otel_din_text(value):
    if not isinstance(value, str):
        return None
    grade = []
    for m in GRAD_OTEL.finditer(fara_diacritice(value)):
        g = ('L' + m.group(1) if m.group(1) else 'X' + m.group(2)) + (m.group(3) or '') + (m.group(4) or '')
        if g not in grade:
            grade.append(g)
    return '/'.join(grade) or None


def text_plat(raw):
    """Textul documentului (fără CSV) pe un singur rând: fără taguri, „|”, „*”, „:”, paranteze, diacritice; cifrele rămân."""
    s = fara_diacritice(re.sub(r'<[^>]*>', ' ', raw.split('## CSV')[0]))
    return ' '.join(re.sub(r'[|*:()\[\]]', ' ', s).split())


def rand_numerotare(row):
    """Rândul cu numerele coloanelor (0 1 2 … sau 1 2 3 …) de sub capul de tabel: nu e o țeavă."""
    values = [c['text'].strip() for c in row]
    if len(values) < 3 or not all(re.fullmatch(r'[0-9]{1,2}', v) for v in values):
        return False
    numbers = [int(v) for v in values]
    return numbers[0] in (0, 1) and numbers == list(range(numbers[0], numbers[0] + len(numbers)))


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
    out, rezerva = {}, {}
    for ci, c in enumerate(row):
        label = norm(c['text'])
        for k, aliases in D[sablon].items():
            if label in aliases:
                if k in out:
                    raise E3Error('structura_incerta')
                out[k] = ci
        # Antete de rezervă (27.10.2026, aviz COMTECH P 0160): „Cod articol” = numărul țevii doar când lipsește „Nr. țeavă”.
        for k, aliases in D.get(sablon + '_rezerva', {}).items():
            if label in aliases:
                rezerva.setdefault(k, []).append(ci)
    for k, cis in rezerva.items():
        if k in out:
            continue  # coloana principală există: rezervele se ignoră, oricâte ar fi (P2-01, review Copilot #894)
        if len(cis) != 1:
            raise E3Error('structura_incerta')  # două coloane „Cod articol” fără „Nr. țeavă” = ambiguu
        out[k] = cis[0]
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
        if colonnes(row, sablon) or (ri == hi + 1 and rand_numerotare(row)):
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
            if k.startswith('_'):
                continue  # coloane doar de verificare, nu intră în contract
            r[k] = cell['text'] or None
            if k in ('net_kg', 'brut_kg') and not cell['e_origine']:
                r[k] = None
        # „Cantitatea/ml” pe aviz = bucăți pe rând: numai 1 (o țeavă pe rând); altfel rândul nu e o singură piesă.
        if '_bucati' in cols and numarE3(row[cols['_bucati']]['text']) != 1:
            raise E3Error('structura_incerta')
        if sablon == 'aviz_teava':
            r['grad_otel'] = grad_otel_din_text(r['specificatie'])
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
        totaluri_caseta(raw, obj, '_bucati' in cols)
    valida_brut(obj, sablon)
    if valideaza:
        validaStructuraE3(obj, sablon)
    return obj


def totaluri_caseta(raw, obj, bucati):
    """Totalurile din caseta de sub tabel → totaluri_tiparite, dacă tabelul n-are rând TOTAL; două valori diferite = refuz."""
    text = text_plat(raw)
    for dest, conv, rx in CASETA_TOTALURI:
        values = [m.group(1) or m.group(2) for m in rx.finditer(text)]
        if not values:
            continue
        numbers = {conv(v) for v in values}
        printed = obj['totaluri_tiparite'][dest]
        if None in numbers or len(numbers) != 1 or (printed is not None and conv(printed) not in numbers):
            raise E3Error('structura_incerta')
        if printed is None:
            obj['totaluri_tiparite'][dest] = values[0]
    # „Total cantitate” = numărul de țevi numai când coloana de bucăți a fost verificată (1 pe fiecare rând).
    if bucati:
        for m in TOTAL_BUCATI.finditer(text):
            if numarE3(m.group(1)) != len(obj['randuri']):
                raise E3Error('structura_incerta')


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
