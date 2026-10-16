import hashlib, json, pathlib, sys, time
import fitz
ROOT = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2]); BD = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'))
by_size = {}
EXCLUS = ('propunere', 'oferta', 'financiar', 'personal', 'cv', 'diplom')  # doar documentatia autoritatii, nimic intern (oferte, HR)
for p in ROOT.rglob('*.pdf'):
    if any(x in part.lower() for part in p.relative_to(ROOT).parts[:-1] for x in EXCLUS): continue
    try: by_size.setdefault(p.stat().st_size, []).append(p)
    except OSError: continue
docs = []
for d in BD:
    cand = by_size.get(d['size_bytes'] or -1, []) if d.get('size_bytes') else []
    parinte = d.get('parinte')
    if not cand and parinte: cand = by_size.get(parinte['size_bytes'], [])
    ent = dict(d, nas=None)
    if cand:
        p = cand[0]; b = p.read_bytes()
        with fitz.open(stream=b, filetype='pdf') as pdf: n = len(pdf)
        ent['nas'] = {'cale': str(p), 'sha256': hashlib.sha256(b).hexdigest(), 'pagini_pdf': n, 'candidati_aceeasi_marime': len(cand),
                      'potrivire': 'marime_exacta' if d.get('size_bytes') in by_size else 'parinte_split'}
    docs.append(ent)
OUT.write_text(json.dumps({'licitatie_id': 15, 'generat_la': time.strftime('%Y-%m-%dT%H:%M:%S'), 'sursa_pdf': str(ROOT),
                           'nota': 'BD doar citit (metadate + md5 text_extras, fara text). Orientarea paginilor pentru rularea de TEST e confirmata '
                                   'de laboratorul OCR (Claude) pe foile de contact, nu de om.',
                           'documente': docs}, ensure_ascii=False, indent=1), encoding='utf-8')
for e in docs: print(e['id'], e['tip'], e['pagini'], (e['nas'] or {}).get('pagini_pdf'), (e['nas'] or {}).get('potrivire'), ((e['nas'] or {}).get('cale') or '-')[-70:])
