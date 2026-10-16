"""Orientare pentru rularea de TEST rt1 (Racari): doua semnale - axa din proiectie (geometry) + citire de proba LightOn pe 2 fasii in
fiecare orientare candidata. Se decide DOAR cand ambele fasii aleg aceeasi orientare cu marja; altfel 'nerezolvat' (pagina exclusa)."""
import base64, io, json, pathlib, re, sys, concurrent.futures as cf, urllib.request
import fitz
from PIL import Image
from ocr_local.geometry import orientation
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1'); AXE = json.loads((RT / 'axe.json').read_text(encoding='utf-8'))
WORD = re.compile(r'^[A-Za-zĂÂÎȘȚŞŢăâîșțşţ]{3,}$'); VOW = re.compile(r'[aeiouăâîAEIOUĂÂÎ]')


def citeste(png):
    body = {'model': 'LightOnOCR2', 'messages': [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {
        'url': 'data:image/png;base64,' + base64.b64encode(png).decode()}}]}], 'temperature': 0, 'max_tokens': 300}
    r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8017/v1/chat/completions', json.dumps(body).encode(),
                                                      {'Content-Type': 'application/json'}), timeout=120)
    return json.loads(r.read())['choices'][0]['message']['content'] or ''


def scor(t):
    toks = re.findall(r'\S+', t); toks = [re.sub(r'^[^\w]+|[^\w]+$', '', x) for x in toks]
    w = [x for x in toks if WORD.match(x) and VOW.search(x)]
    return len(w)


def pagina(key, n, path):
    with fitz.open(path) as d:
        pix = d[n - 1].get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72), alpha=False)
        im = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
    cand = AXE[key][str(n)]
    if len(cand) == 2 and cand == [0, 180]: oo = [0, 180]
    elif len(cand) == 2: oo = [90, 270]
    else: oo = [0, 90, 180, 270]
    res = {}
    for o in oo:
        r, _ = orientation(im, o); w, h = r.size; sc = []
        for y0 in (0.05, 0.45):
            strip = r.crop((0, int(h * y0), w, int(h * (y0 + 0.18)))); b = io.BytesIO(); strip.save(b, format='PNG')
            try: sc.append(scor(citeste(b.getvalue())))
            except Exception as e: sc.append(-1)
        res[o] = sc
    best = []
    for i in range(2):
        s = sorted(((v[i], o) for o, v in res.items()), reverse=True)
        best.append(s[0][1] if s[0][0] >= 4 and s[0][0] >= 2 * max(s[1][0], 0) + 1 else None)
    dec = best[0] if best[0] is not None and best[0] == best[1] else (best[0] if best[1] is None and best[0] is not None and len(oo) == 2 else None)
    return key, n, {'axa': cand, 'scoruri': res, 'fasii': best, 'decizie': dec}


def main():
    rez = {}; jobs = []
    with cf.ThreadPoolExecutor(8) as ex:
        for pdf in sorted((RT / 'pdf').glob('*.pdf')):
            key = pdf.stem
            with fitz.open(pdf) as d: n = len(d)
            for i in range(n): jobs.append(ex.submit(pagina, key, i + 1, str(pdf)))
        for j in cf.as_completed(jobs):
            key, n, r = j.result(); rez.setdefault(key, {})[str(n)] = r
    (RT / 'orientare_proba.json').write_text(json.dumps(rez, indent=0), encoding='utf-8')
    for key, v in sorted(rez.items()):
        c = {}
        for r in v.values(): c[str(r['decizie'])] = c.get(str(r['decizie']), 0) + 1
        print(key, c)


main()
