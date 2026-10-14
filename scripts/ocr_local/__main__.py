"""python -m ocr_local <comanda> ... (PYTHONPATH=scripts, interpretorul env_mineru al lui Codex).
Comenzi: plan | foaie-orientare | citeste | compara | reconciliaza. Nicio comanda nu porneste un server sau un model."""
import argparse, json, pathlib, sys, uuid

def pagini(spec):
    out = []
    for part in spec.split(','):
        part = part.strip()
        if not part: continue
        if '-' in part:
            a, b = part.split('-', 1); out += range(int(a), int(b) + 1)
        else: out.append(int(part))
    return out

def main(argv=None):
    p = argparse.ArgumentParser(prog='ocr_local', description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('plan', help='CPU: randare, rutare, orientare, deskew, benzi')
    a.add_argument('source'); a.add_argument('--output', required=True); a.add_argument('--pagini')
    a.add_argument('--clockwise', type=int, choices=[0, 90, 180, 270]); a.add_argument('--orientari', type=pathlib.Path)
    a.add_argument('--kind', choices=['continuous_text', 'quantity_table', 'grid_form', 'drawing', 'unknown']); a.add_argument('--dpi', type=int, default=150)
    f = sub.add_parser('foaie-orientare', help='CPU: miniaturi pentru confirmarea orientarii de catre om')
    f.add_argument('source'); f.add_argument('--output', required=True); f.add_argument('--pagini', required=True)
    c = sub.add_parser('citeste', help='GPU: un cititor peste toate benzile (serverul vLLM trebuie sa fie deja pornit de om)')
    c.add_argument('plan_dir'); c.add_argument('--cititor', required=True, choices=['lighton', 'mineru']); c.add_argument('--rulare')
    k = sub.add_parser('compara', help='CPU: dezacorduri intre cele doua citiri'); k.add_argument('plan_dir')
    r = sub.add_parser('reconciliaza', help='CPU: aplica deciziile arbitrului (JSONL)'); r.add_argument('plan_dir'); r.add_argument('--decizii', required=True)
    x = p.parse_args(argv)
    if x.cmd == 'plan':
        from .plan import plan
        ori = json.loads(x.orientari.read_text(encoding='utf-8')) if x.orientari else None
        doc = plan(x.source, x.output, pages=pagini(x.pagini) if x.pagini else None, clockwise=x.clockwise, orientations=ori, kind=x.kind, dpi=x.dpi)
        res = {'status': doc['status'], **doc['summary']}
    elif x.cmd == 'foaie-orientare':
        from .plan import contact_sheet
        res = contact_sheet(x.source, x.output, pagini(x.pagini))
    elif x.cmd == 'citeste':
        from .read import run_reader
        res = run_reader(x.plan_dir, x.cititor, run_id=x.rulare or uuid.uuid4().hex)
    elif x.cmd == 'compara':
        from .compare import compare
        res = {k2: v for k2, v in compare(x.plan_dir)[0].items() if k2 != 'per_band'}
    else:
        from .reconcile import reconcile
        res = reconcile(x.plan_dir, x.decizii)['summary']
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0

if __name__ == '__main__':
    sys.exit(main())
