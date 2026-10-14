"""Pasul 1 (CPU, fara retea): randare, selectia paginilor, rutare, orientare, deskew, benzi.
Adaptat din pipeline-ul Codex 0.1.0 (pipeline.process): aceeasi geometrie si aceleasi reguli de blocare, fara inferenta.
Iese plan.json + PNG-urile benzilor, citite apoi de ambele cititoare (read.py)."""
import hashlib, io, json, pathlib, re, time

# PIL / numpy (geometry) se importa doar in functiile care randeaza: load_plan / save raman doar biblioteca standard, ca clientul ERP
# (client.py) sa poata fi testat cap-coada pe functiile SQL reale si in WSL, fara PIL (scripts/test_ofertare_ocr_local.sh).
PACKAGE = pathlib.Path(__file__).parent
KINDS = ('continuous_text', 'quantity_table', 'grid_form', 'drawing', 'unknown')
NATIVE_MIN_CHARS = 200  # doar SEMNAL: un strat de text nativ (poate fi OCR ascuns, gresit) NU scuteste pagina de dubla citire (review Copilot r1)

def sha(data): return hashlib.sha256(data).hexdigest()
def save(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def native_chars(page):
    return sum(1 for c in page.get_text('text') if c.isalnum())

def pages_of(path, dpi, max_pixels, wanted):
    """Genereaza (numar_pagina, imagine | None, text_nativ_caractere). Numerotarea e 1-based, ca pagini_necitite."""
    from PIL import Image
    if path.suffix.lower() == '.pdf':
        import fitz
        with fitz.open(path) as pdf:
            for number in (wanted or range(1, len(pdf) + 1)):
                if not 1 <= number <= len(pdf): raise ValueError('Pagina %d nu exista (PDF are %d)' % (number, len(pdf)))
                page = pdf[number - 1]; nat = native_chars(page)
                if page.rect.width * page.rect.height * (dpi / 72) ** 2 > max_pixels: raise ValueError('Randarea depaseste max_pixels')
                pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False)
                yield number, Image.frombytes('RGB', [pix.width, pix.height], pix.samples), nat
    elif path.suffix.lower() == '.png':
        if wanted and list(wanted) != [1]: raise ValueError('PNG are o singura pagina')
        with Image.open(path) as im:
            if im.width * im.height > max_pixels: raise ValueError('Imaginea depaseste max_pixels')
            yield 1, im.convert('RGB'), 0
    else: raise ValueError('Doar PDF sau PNG')

def plan(source, output, *, pages=None, clockwise=None, orientations=None, kind=None, dpi=150, max_pages=2000, max_pixels=40000000):
    """clockwise/kind = suprascrieri explicite, confirmate local de om, aplicate tuturor paginilor selectate (se inregistreaza).
    orientations = {pagina: 0/90/180/270} confirmat de om pe foaia de contact (contact_sheet), are prioritate fata de clockwise."""
    from .geometry import classify, orientation, deskew, text_bands
    orientations = {int(k): int(v) for k, v in (orientations or {}).items()}
    if kind not in (None,) + KINDS: raise ValueError('kind necunoscut')
    if not 36 <= dpi <= 600 or max_pixels < 1: raise ValueError('Limite invalide')
    if pages is not None:
        pages = sorted(set(int(p) for p in pages))
        if not pages or len(pages) > max_pages: raise ValueError('Lista de pagini goala sau peste max_pages')
    source = pathlib.Path(source).resolve(); output = pathlib.Path(output).resolve()
    if str(output).startswith(('\\\\', '//')): raise ValueError('NAS-ul e doar citire; iesirea pe disc local')
    if output == source or source in output.parents: raise ValueError('Cale de iesire invalida')
    output.mkdir(parents=True, exist_ok=True)
    src = source.read_bytes()
    with (output / 'plan_claim.json').open('x', encoding='utf-8') as f:
        json.dump({'started': time.time(), 'source_sha256': sha(src)}, f)
    protocol_bytes = (PACKAGE / 'protocol.json').read_bytes()
    doc = {'schema_version': '2.0.0', 'source': str(source), 'input_sha256': sha(src), 'status': 'planning',
           'versions': {'pipeline': '0.2.0', 'protocol': json.loads(protocol_bytes)['version'], 'protocol_sha256': sha(protocol_bytes),
                        'guard': 'empty-cells-v3-consecutive600', 'guard_sha256': sha((PACKAGE / 'guard.py').read_bytes())},
           'selection': {'pages_requested': pages, 'clockwise_override': clockwise, 'orientations_confirmed': {str(k): v for k, v in sorted(orientations.items())}, 'kind_override': kind, 'dpi': dpi},
           'pages': [], 'bands': [],
           'limits': ['Clasificarea pixelilor da candidati, nu semantica.', 'Orientarea automata nerezolvata blocheaza pagina.',
                      'Planse, fise, formulare, pagini albe = excluse din pilot (lista de rezolvat manual).']}
    for number, image, nat in pages_of(source, dpi, max_pixels, pages):
        p = {'page': number, 'native_chars': nat, 'signals': []}; doc['pages'].append(p)
        if nat >= NATIVE_MIN_CHARS: p['signals'].append({'type': 'text_nativ_prezent', 'chars': nat, 'nota': 'pagina merge oricum la ambele cititoare'})
        p['classification'] = classify(image); category = kind or p['classification']['candidate']
        p['routing_category'] = category
        rotated, orient = orientation(image, orientations.get(number, clockwise)); p['orientation'] = orient
        if category in ('grid_form', 'drawing'):
            p['route'] = 'exclus_' + category; continue
        if category == 'unknown':
            p['route'] = 'exclus_neclasificat'; continue
        if orient['status'] == 'unresolved':
            p['route'] = 'orientare_nerezolvata'; p['signals'].append({'type': 'orientation_unresolved', 'candidates': orient['candidates']}); continue
        corrected, skew = deskew(rotated); p['deskew'] = skew
        if category == 'continuous_text': specs, cut = text_bands(corrected)
        else: specs = [{'box': [0, 0, *corrected.size], 'core_y': [0, corrected.height]}]; cut = {'mode': 'whole_table', 'line_runs': []}
        p['route'] = 'ocr'; p['cut'] = {k: v for k, v in cut.items() if k != 'line_runs'}
        page_dir = output / ('page%04d' % number); page_dir.mkdir()
        buf = io.BytesIO(); corrected.save(buf, format='PNG'); (page_dir / 'processed.png').write_bytes(buf.getvalue()); p['processed_sha256'] = sha(buf.getvalue())
        for index, spec in enumerate(specs):
            bid = 'p%04d_b%d' % (number, index)
            crop = corrected.crop(spec['box']); b = io.BytesIO(); crop.save(b, format='PNG'); data = b.getvalue()
            (page_dir / (bid + '.png')).write_bytes(data)
            doc['bands'].append({'id': bid, 'page': number, 'index': index, 'kind': category, 'box': spec['box'], 'core_y': spec['core_y'],
                                 'image': (page_dir / (bid + '.png')).relative_to(output).as_posix(), 'image_sha256': sha(data)})
        save(output / 'plan.json', doc)
    doc['status'] = 'plan_complete'
    doc['summary'] = {'pages': len(doc['pages']), 'bands': len(doc['bands']),
                      'routes': {r: sum(1 for p in doc['pages'] if p['route'] == r) for r in sorted({p['route'] for p in doc['pages']})}}
    save(output / 'plan.json', doc)
    return doc

BAND_ID = re.compile(r'^p(\d{4})_b\d+$')

def load_plan(plan_dir):
    plan_dir = pathlib.Path(plan_dir).resolve(); doc = json.loads((plan_dir / 'plan.json').read_text(encoding='utf-8'))
    if doc.get('status') != 'plan_complete': raise ValueError('Planul nu e complet')
    for b in doc['bands']:
        # plan.json nu e de incredere pentru cai: id generat, imagine relativa sub plan_dir, fara '..'
        m = BAND_ID.match(str(b.get('id', '')))
        if not m or int(m.group(1)) != b.get('page') or b.get('image') != 'page%04d/%s.png' % (b['page'], b['id']):
            raise ValueError('Banda cu id/cale neasteptate in plan.json: %r' % b.get('id'))
        if plan_dir not in (plan_dir / b['image']).resolve().parents: raise ValueError('Cale in afara planului')
        if sha((plan_dir / b['image']).read_bytes()) != b['image_sha256']: raise ValueError('Imaginea benzii %s s-a schimbat' % b['id'])
    return doc

def contact_sheet(source, output_png, pages, *, dpi=40, per_row=8, cell=220):
    """Foaie de contact pentru confirmarea orientarii de catre om (fara AI): miniaturi cu numarul paginii.
    Rezultatul (orientari.json {pagina: grade_in_sens_orar}) se da inapoi la plan(orientations=...)."""
    import fitz
    from PIL import Image, ImageDraw
    pages = sorted(set(int(p) for p in pages)); rows = (len(pages) + per_row - 1) // per_row
    sheet = Image.new('RGB', (per_row * cell, rows * (cell + 20)), 'white'); draw = ImageDraw.Draw(sheet)
    with fitz.open(pathlib.Path(source)) as pdf:
        for i, number in enumerate(pages):
            pix = pdf[number - 1].get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False)
            im = Image.frombytes('RGB', [pix.width, pix.height], pix.samples); im.thumbnail((cell - 10, cell - 10))
            x, y = (i % per_row) * cell, (i // per_row) * (cell + 20)
            sheet.paste(im, (x + 5, y + 20)); draw.text((x + 5, y + 4), 'p%d' % number, fill='red')
    sheet.save(output_png)
    return {'pages': pages, 'image': str(output_png)}
