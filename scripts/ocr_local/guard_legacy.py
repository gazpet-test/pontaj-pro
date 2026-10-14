import re, collections
# Celulele de tabel (<td...>) au regula lor: intr-un tabel corect aceeasi celula apare legitim in multe randuri
# (ex. d772 p0255_b0, „1C–T200–S1”), deci o celula lunga se socoteste bucla doar daca se repeta de 4 ori LA RAND.
# Celelalte linii lungi raman pe regula veche (de 4 ori oriunde), ca sa prinda si buclele cu spatiere variabila
# pe care blocul de 200 de caractere (guard_base) nu le vede. Un rand de tabel INTREG identic de 4 ori ramane bucla.
CELL_LINE = re.compile(r'<td\b', re.I)
def repeated_long_line(text, times=4, min_len=46):
    lines = [s.strip() for s in text.splitlines() if s.strip()]
    norm = [re.sub(r'\s+', ' ', s.lower()) for s in lines]
    other = collections.Counter(n for s, n in zip(lines, norm) if len(s) >= min_len and not CELL_LINE.match(s))
    if any(c >= times for c in other.values()): return 'Repeated long line (4 times)'
    rows, cur = collections.Counter(), None
    for n in norm:  # randuri de tabel pe mai multe linii: acelasi rand INTREG de 4 ori = bucla (indentarea nu conteaza)
        if n.startswith('<tr'): cur = [n]
        elif cur is not None:
            cur.append(n)
            if n.startswith('</tr'):
                row = ' '.join(cur); cur = None
                if len(re.sub(r"<[^>]*>|\ue000|\s", "", row)) >= 20:  # doar randuri cu continut (nu randuri goale)
                    rows[row] += 1
                    if rows[row] >= times: return 'Repeated table row (4 times)'
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
