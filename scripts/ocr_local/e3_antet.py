"""Dicționar strict; antete ambigue rămân necunoscute, fără deducții."""
import json
import pathlib
import re
import unicodedata

D = json.loads(pathlib.Path(__file__).with_name('e3_dictionare.json').read_text(encoding='utf-8'))


def norm(value):
    s = ''.join(c for c in unicodedata.normalize('NFKD', value.upper()) if not unicodedata.combining(c))
    return ' '.join(re.sub(r'[^A-Z0-9]', ' ', s).split())


def camp_antet(label, allowed):
    return next((k for k, aliases in D['antet'].items() if k in allowed and norm(label) in aliases), None)


def extrage_antet(raw, antet):
    # Rapoartele laboratorului includ și CSV: nu numărăm documentul de două ori.
    raw = raw.split('## CSV')[0]
    lines = raw.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith('|') or '<' in line:
            continue
        label, sep, value = line.partition(':')
        key = camp_antet(label, antet)
        if key and not value.strip():
            value = next((s.strip() for s in lines[i + 1:] if s.strip()), '')
            if camp_antet(value, antet) or norm(value) in {'PROIECT', 'MADE IN TURKIYE'} or value.startswith(('|', '#')):
                value = ''
        if key and value.strip():
            antet[key] = value.strip()
    return antet
