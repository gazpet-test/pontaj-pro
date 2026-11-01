"""Asamblarea textului pe document dintr-o rulare de laborator (pasul (2a), decizia chatului 20.10; înainte în ocrlab_tmp/rt_text_conv.py).
Reguli: (1) o bandă intră în text DOAR din citirea ei VALIDĂ (result.json ok = true și raw_sha256 = raw.txt): LightOn întâi, apoi MinerU;
o bandă oprită de gardă (ok = false, ex. buclă) nu intră niciodată, rămâne marcată „necitită”; (2) tabelele HTML se convertesc determinist
în rânduri „| celula | … |” (compare.segments + reconcile.render, aceleași funcții ca pipeline-ul) ÎNAINTE de lipirea benzilor
(reconcile.join_bands); (3) „nr. crt. + simbol” lipite în prima celulă se despart; (4) tabelele cu o singură coloană devin linii de text.
Paginile cu text nativ (> 50 de caractere) iau textul nativ. Fără rețea, fără modele, fără BD."""
import hashlib, json, pathlib, re

from .compare import segments
from .reconcile import join_bands, render

PRAG_NATIV = 50
CITITORI = ('lighton', 'mineru')
# „| 001 RPCXA04 | M.C. | 70.200 |” -> „| 001 | RPCXA04 | …”; codul acceptă „%” (lecția: parserul pierdea codurile cu „%”, F3 1654 = 804, nu 772)
NR_COD = re.compile(r'^\s*(\d{1,4})\s+([A-Z0-9][A-Z0-9%]*[0-9][A-Z0-9%]*)\s*$')
MARCAJ_NECITITA = '[BANDĂ NECITITĂ %s: fără citire validă la ambii cititori]'


def fara_tabele_o_coloana(segs):
    """O „tabelă” cu o singură coloană (LightOn redă uneori o listă monospațiată ca <table>) se scrie ca linii de text, fără „|”:
    altfel o continuare de denumire („2405”) devine un nr. crt. fals."""
    return [('text', '\n'.join(r[0] if r else '' for r in v)) if k == 'table' and all(len(r) <= 1 for r in v) else (k, v) for k, v in segs]


# context de deviz pe același rând, independent de numere: o celulă care e EXACT o unitate de măsură sau începe cu „Cantitate=”
UM_CELULA = re.compile(r'^\s*(?:\[\s*\d+\]\s*)?(?:M\.?C\.?|M\.?P\.?|M\.?L\.?|M|MC|MP|ML|KG|TO|TONA|T|BUC\.?|SET|ORE|L|KM|ORA)\s*$', re.I)
CANTITATE_ETICHETA = re.compile(r'^\s*Cantitate\s*=', re.I)


def desparte_nr_cod_tabel(rows):
    """„nr. crt. + simbol” lipite în prima celulă se despart DOAR cu un indiciu de deviz independent de numere (Jakarinos #906 r3):
    (c) nr. scris cu zerouri în față („007”), sau (d) pe același rând o celulă e exact o UM („M.C.”, „BUC.”, „TONA”, „[ 1] M”)
    ori începe cu „Cantitate=”. Consecutivitatea / anii nu contează: „| 2024 ABC1 | Raport anual 2023 |” rămâne neschimbat."""
    out = []
    for r in rows:
        m = NR_COD.match(r[0]) if r else None
        if m and ((len(m.group(1)) >= 2 and m.group(1).startswith('0'))
                  or any(UM_CELULA.match(c) or CANTITATE_ETICHETA.match(c) for c in r[1:])):
            r = [m.group(1), m.group(2)] + list(r[1:])
        out.append(r)
    return out


def desparte_nr_cod(segs):
    return [(k, desparte_nr_cod_tabel(v)) if k == 'table' else (k, v) for k, v in segs]


def citire_valida(banda_dir):
    """(cititor, raw) din prima citire validă, sau (None, None). Validă = result.json cu ok = true și raw_sha256 OBLIGATORIU, egal cu
    sha256(raw.txt): lipsă / null / nepotrivire = citire neverificată, se trece la următorul cititor (Jakarinos #906 P1)."""
    for c in CITITORI:
        r, f = banda_dir / c / 'result.json', banda_dir / c / 'raw.txt'
        if not (r.exists() and f.exists()): continue
        try: res = json.loads(r.read_text(encoding='utf-8'))
        except ValueError: continue
        if not isinstance(res, dict) or res.get('ok') is not True: continue
        raw = f.read_bytes().decode('utf-8')
        if res.get('raw_sha256') != hashlib.sha256(raw.encode()).hexdigest(): continue
        return c, raw
    return None, None


def text_banda(raw):
    return render(desparte_nr_cod(fara_tabele_o_coloana(segments(raw))))


def asambleaza_pagina(benzi_dirs, st):
    """Benzile unei pagini OCR (în ordine) -> text. Tabelele sunt deja rânduri „| … |” când ajung la join_bands."""
    tx = []
    for bid, d in benzi_dirs:
        c, raw = citire_valida(d)
        if raw is None:
            st['benzi_necitite'] += 1; st['lista_necitite'].append(bid); tx.append(MARCAJ_NECITITA % bid); continue
        if c == 'mineru': st['benzi_din_mineru'] += 1; st['lista_din_mineru'].append(bid)
        tx.append(text_banda(raw))
    if not tx: return ''
    t = join_bands(tx, [], nu_numara=frozenset({'|'}))
    if t is None: st['cusaturi_nesigure'] += 1; t = '\n'.join(tx)
    if '<td' in t.lower() or '<tr' in t.lower(): st['html_ramas'] += 1
    return t


def stare_noua():
    return {'native': 0, 'ocr': 0, 'cusaturi_nesigure': 0, 'html_ramas': 0, 'benzi_necitite': 0, 'lista_necitite': [],
            'benzi_din_mineru': 0, 'lista_din_mineru': []}


def asambleaza_document(rulare_dir, doc, pagini_native=None):
    """rulare_dir/<doc>/plan.json + rulare_dir/pdf/<doc>.pdf -> (text, statistici). pagini_native = {n: text} doar pentru teste
    (altfel textul nativ se citește cu PyMuPDF)."""
    rd = pathlib.Path(rulare_dir); plan = json.loads((rd / doc / 'plan.json').read_text(encoding='utf-8')); benzi = {}
    for b in plan['bands']: benzi.setdefault(b['page'], []).append(b)
    if pagini_native is None:
        import fitz
        with fitz.open(rd / 'pdf' / (doc + '.pdf')) as pdf: pagini_native = {n: pdf[n - 1].get_text() for n in range(1, pdf.page_count + 1)}
    st = stare_noua(); parti = []
    for n in sorted(pagini_native):
        nativ = (pagini_native[n] or '').strip()
        if len(nativ) > PRAG_NATIV: t = nativ; st['native'] += 1
        else:
            t = asambleaza_pagina([(b['id'], rd / doc / ('page%04d' % n) / b['id']) for b in sorted(benzi.get(n, []), key=lambda b: b['index'])], st)
            st['ocr'] += 1
        parti.append('⟦PAGINA %d⟧\n%s' % (n, t.strip('\n')))
    text = '\n\n'.join(parti)
    return text, dict(st, pagini=len(pagini_native), caractere=len(text), sha256=hashlib.sha256(text.encode('utf-8')).hexdigest())


def text_conv(rulare_dir, documente):
    """Scrie <rulare>/text_conv/<doc>.txt (UTF-8, LF) + manifest.json; întoarce manifestul."""
    out = pathlib.Path(rulare_dir) / 'text_conv'; out.mkdir(exist_ok=True); rez = {}
    for k in documente:
        text, st = asambleaza_document(rulare_dir, k)
        (out / (k + '.txt')).write_text(text, encoding='utf-8', newline='\n'); rez[k] = st
    (out / 'manifest.json').write_text(json.dumps(rez, ensure_ascii=False, indent=1), encoding='utf-8')
    return rez
