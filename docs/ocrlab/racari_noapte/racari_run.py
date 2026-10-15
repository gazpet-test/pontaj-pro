"""Rularea de TEST rt1 (Racari): plan -> citire (un cititor, toate documentele) -> compara. Local, fara BD. Argument: plan | lighton | mineru | compara."""
import json, pathlib, subprocess, sys, time
RT = pathlib.Path(r'C:\Users\Public\paw-data\ocrlab\racari\rt1'); PY = sys.executable
ORD = ['d205', 'd1624', 'd316', 'd318', 'd198', 'd211', 'd199', 'd201', 'd197', 'd200', 'd315', 'd1650', 'd203', 'd204']
pas = sys.argv[1]; jurnal = RT / ('pas_%s.log' % pas)
def log(*a):
    with jurnal.open('a', encoding='utf-8') as f: f.write(time.strftime('%H:%M:%S ') + ' '.join(map(str, a)) + '\n')
for k in ORD:
    pdf = RT / 'pdf' / (k + '.pdf'); d = RT / k
    if pas == 'plan':
        if (d / 'plan.json').exists() and json.loads((d / 'plan.json').read_text(encoding='utf-8')).get('status') == 'plan_complete': log(k, 'deja'); continue
        n = len(json.loads((RT / ('orientari_%s.json' % k)).read_text(encoding='utf-8')))
        cmd = [PY, '-B', '-m', 'ocr_local', 'plan', str(pdf), '--output', str(d), '--pagini', '1-%d' % n, '--orientari', str(RT / ('orientari_%s.json' % k))]
    elif pas in ('lighton', 'mineru'):
        cmd = [PY, '-B', '-m', 'ocr_local', 'citeste', str(d), '--cititor', pas, '--rulare', 'rt1_' + pas]
    elif pas == 'compara':
        cmd = [PY, '-B', '-m', 'ocr_local.masoara', str(RT), '--jsonl', str(RT / 'dezacorduri_rt1.jsonl')]
    t0 = time.time(); p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    log(k, 'exit', p.returncode, '%ds' % (time.time() - t0), (p.stdout[-400:] + ' | ' + p.stderr[-600:]).replace('\n', ' '))
    if pas == 'compara': break
log('GATA', pas)
