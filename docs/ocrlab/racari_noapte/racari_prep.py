"""Rularea de TEST rt1 pe Racari (licitatia 15): copiaza PDF-urile din NAS (verificate SHA fata de manifest) si face foile de contact."""
import hashlib, json, pathlib, shutil, subprocess, sys
M = json.loads(pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari_manifest.json').read_text(encoding='utf-8'))
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1'); (RT / 'pdf').mkdir(parents=True, exist_ok=True); (RT / 'orientare').mkdir(exist_ok=True)
PY = sys.executable
docs = {}
for d in M['documente']:
    if not d['nas']: continue
    key = 'd%d' % (d['parinte']['id'] if d.get('parinte') else d['id'])
    docs.setdefault(key, d['nas'])
for key, nas in docs.items():
    dst = RT / 'pdf' / (key + '.pdf')
    if not dst.exists(): shutil.copyfile(nas['cale'], dst)
    if hashlib.sha256(dst.read_bytes()).hexdigest() != nas['sha256']: sys.exit('SHA diferit la ' + key)
    n = nas['pagini_pdf']
    for a in range(1, n + 1, 48):
        b = min(n, a + 47); out = RT / 'orientare' / ('%s_p%03d-%03d.png' % (key, a, b))
        if out.exists(): continue
        subprocess.run([PY, '-B', '-m', 'ocr_local', 'foaie-orientare', str(dst), '--output', str(out), '--pagini', '%d-%d' % (a, b)], check=True)
    print(key, n, 'pagini')
(RT / 'documente.json').write_text(json.dumps({k: v for k, v in docs.items()}, ensure_ascii=False, indent=1), encoding='utf-8')
