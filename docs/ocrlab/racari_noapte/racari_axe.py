import json, pathlib, sys
import fitz
from PIL import Image
from ocr_local.geometry import orientation
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1')
rez = {}
for pdf in sorted((RT / 'pdf').glob('*.pdf')):
    key = pdf.stem; out = {}
    with fitz.open(pdf) as d:
        for i, p in enumerate(d):
            pix = p.get_pixmap(matrix=fitz.Matrix(100 / 72, 100 / 72), alpha=False)
            im = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
            _, o = orientation(im, None)
            out[str(i + 1)] = o['candidates']
    rez[key] = out
    c = {}
    for v in out.values(): c[str(v)] = c.get(str(v), 0) + 1
    print(key, c, [k for k, v in out.items() if len(v) == 4][:20])
(RT / 'axe.json').write_text(json.dumps(rez), encoding='utf-8')
