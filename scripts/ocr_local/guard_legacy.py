import re
# Liniile de celule de tabel (<td...>) nu intra in regula „linie lunga repetata”: intr-un tabel corect
# aceeasi celula apare legitim in multe randuri (ex. d772 p0255_b0, „1C–T200–S1”). Buclele de randuri
# intregi le prinde garda principala (bloc de 200 de caractere repetat de 4 ori, guard_base).
CELL_LINE = re.compile(r'<td\b', re.I)
def repeated_consecutive_line(text, times=4, min_len=46):
    """Aceeasi linie lunga (>45 caractere, fara celule <td>) de `times` ori LA RAND; liniile goale nu rup sirul."""
    prev, run = None, 0
    for s in text.splitlines():
        s = s.strip()
        if not s: continue
        line = re.sub(r'\s+', ' ', s.lower())
        if len(s) < min_len or CELL_LINE.match(s): prev, run = None, 0; continue
        run = run + 1 if line == prev else 1; prev = line
        if run >= times: return True
    return False
def repetition_reason(text):
    if re.search(r'([a-zăâîșțşţ])\1{31,}', text, re.I):
        return 'Repeated letter run (32 characters)'
    if repeated_consecutive_line(text):
        return 'Repeated long line (4 times in a row)'
    if re.search(r'(?:\[ILIZIBIL\]\s*[,;. ]*\s*){16,}', text, re.I):
        return 'Repeated unreadable markers (16 times)'
    if re.search(r'(?:alin\.\s*\d+\s*[,; ]+){16,}', text, re.I):
        return 'Suspicious consecutive paragraph enumeration (16 items)'
    return None
