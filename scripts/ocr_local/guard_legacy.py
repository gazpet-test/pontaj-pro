import re, collections
# Celulele de tabel (<td...>) au regula lor: intr-un tabel corect aceeasi celula apare legitim in multe randuri
# (ex. d772 p0255_b0, „1C–T200–S1”), deci o celula lunga se socoteste bucla doar daca se repeta de 4 ori LA RAND.
# Celelalte linii lungi raman pe regula veche (de 4 ori oriunde), ca sa prinda si buclele cu spatiere variabila
# pe care blocul de 200 de caractere (guard_base) nu le vede. Un rand de tabel INTREG identic de 4 ori la rand ramane bucla
# (repeated_table_row, pe textul BRUT: vederea filtrata comaseaza celulele goale peste granitele de rand).
CELL_LINE = re.compile(r'<td\b', re.I)
ROW = re.compile(r'<tr\b[^>]*>(.*?)</tr\s*>', re.I | re.S)
GAP_OTHER = re.compile(r'\s+|</?(?:thead|tbody|tfoot)\b[^>]*>', re.I)
def repeated_table_row(text, times=4, min_content=20):
    """Acelasi rand <tr>...</tr> intreg (cu continut) de `times` ori LA RAND; delimitatorii pot sta oriunde pe linie,
    spatierea si indentarea nu conteaza. Nu „oriunde”: randurile de subtotal din devize sau straturile din fisele de
    foraj se repeta legitim, intercalate (corpus Codex: 71 de alarme false cu „oriunde”)."""
    prev, run, end = None, 0, None
    for m in ROW.finditer(text):
        row = re.sub(r'\s*(<[^>]*>)\s*', r'\1', re.sub(r'\s+', ' ', m[1].lower())).strip()
        # „la rand” = in acelasi tabel: intre doua randuri doar spatii sau <thead>/<tbody>/<tfoot>; alt tabel / text rupe sirul
        if end is not None and GAP_OTHER.sub('', text[end:m.start()]): prev, run = None, 0
        end = m.end()
        if len(re.sub(r'<[^>]*>|\s', '', row)) < min_content: prev, run = None, 0; continue  # randuri goale / doar structura
        run = run + 1 if row == prev else 1; prev = row
        if run >= times: return 'Repeated table row (4 times in a row)'
    return None
def repeated_long_line(text, times=4, min_len=46):
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    norm = [re.sub(r'\s+', ' ', s.lower()) for s in lines]
    other = collections.Counter(n for s, n in zip(lines, norm) if len(s) >= min_len and not CELL_LINE.match(s))
    if any(c >= times for c in other.values()): return 'Repeated long line (4 times)'
    prev, run = None, 0
    for s, n in zip(lines, norm):  # celule: doar la rand (liniile goale nu rup sirul)
        if len(s) < min_len or not CELL_LINE.match(s): prev, run = None, 0; continue
        run = run + 1 if n == prev else 1; prev = n
        if run >= times: return 'Repeated table cell line (4 times in a row)'
    return None
def repetition_reason(text):
    if re.search(r'([a-zăâîșțşţ])\1{31,}', text, re.I):
        return 'Repeated letter run (32 characters)'
    r = repeated_long_line(text)
    if r: return r
    if re.search(r'(?:\[ILIZIBIL\]\s*[,;. ]*\s*){16,}', text, re.I):
        return 'Repeated unreadable markers (16 times)'
    if re.search(r'(?:alin\.\s*\d+\s*[,; ]+){16,}', text, re.I):
        return 'Suspicious consecutive paragraph enumeration (16 items)'
    return None
