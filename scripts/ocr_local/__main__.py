"""python -m ocr_local <comanda> ... (PYTHONPATH=scripts, interpretorul env_mineru al lui Codex).
Comenzi: plan | foaie-orientare | citeste | compara | reconciliaza | erp <pas> (legatura cu ERP, client.py).
Nicio comanda nu porneste un server sau un model."""
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
    e = sub.add_parser('erp', help='legatura cu ERP prin edge-urile cu secret (client.py): o rulare ceruta din ERP, pas cu pas')
    e.add_argument('--secret-file', help='implicit OCR_LOCAL_SECRET din mediu, apoi ' + 'C:/Users/Gazpet-Ai/.secrete/ocr_local_secret.txt')
    es = e.add_subparsers(dest='pas', required=True)
    es.add_parser('preia', help='ia prima rulare ceruta (stare ceruta -> preluata)').add_argument('--work', required=True)
    for nume, ajutor in (('descarca', 'PDF-urile documentelor (link semnat 5 min)'), ('foaie', 'CPU: foile de contact pentru orientare (fara retea)'),
                         ('plan', 'CPU: planul per document + manifestul in BD (o singura data)'), ('incarca-citiri', 'citirile ambilor cititori in BD, apoi citita'),
                         ('compara', 'CPU: dezacordurile in BD + marcajul de comparatie'), ('arbitreaza', 'PLATIT: arbitrajul Claude pe dezacorduri, apoi arbitrata'),
                         ('reconciliaza', 'CPU: textul reconciliat in BD, apoi finalizata'), ('citeste', 'GPU: un cititor pe toate documentele (fara ERP)'),
                         ('oprire', 'opreste rularea (motiv obligatoriu)'), ('reluata', 'DUPA fn_ofertare_ocr_reia in BD (om, psql): marcajul local oprita -> istoric, fereastra noua a pragului'), ('stare', 'starea rularii din BD (doar citire) + pasii locali')):
        s = es.add_parser(nume, help=ajutor); s.add_argument('rulare_dir')
        if nume == 'citeste': s.add_argument('--cititor', required=True, choices=['lighton', 'mineru'])
        if nume == 'oprire': s.add_argument('--motiv', required=True)
        if nume == 'arbitreaza':  # proba platita (laborator): N apeluri, fara `arbitrata`; filtrul = JSONL de la `masoara --jsonl`
            s.add_argument('--max-apeluri', type=int); s.add_argument('--filtru', type=pathlib.Path); s.add_argument('--seed')
            s.add_argument('--triere', action='store_true', help='doar HIGH_RISK la Claude (ocr_local/triere.py)')
            s.add_argument('--doar-haiku', action='store_true', help='a doua trecere: restante DEFER fara cifre, un apel Haiku (doar in proba, cu --triere)')
    es.add_parser('abandon', help='abandoneaza o rezervare deschisa (dupa 15 min)').add_argument('--rezervare', type=int, required=True)
    x = p.parse_args(argv)
    if x.cmd == 'erp':
        from . import client as C
        if x.pas == 'foaie': res = C.foaie(x.rulare_dir)
        elif x.pas == 'citeste': res = C.citeste_rulare(x.rulare_dir, x.cititor)
        else:
            edge = C.Edge(C.citeste_secret(x.secret_file))
            res = {'preia': lambda: C.preia(x.work, edge), 'descarca': lambda: C.descarca(x.rulare_dir, edge), 'plan': lambda: C.plan_rulare(x.rulare_dir, edge),
                   'incarca-citiri': lambda: C.incarca_citiri(x.rulare_dir, edge), 'compara': lambda: C.compara_rulare(x.rulare_dir, edge),
                   'arbitreaza': lambda: C.arbitreaza(x.rulare_dir, edge, max_apeluri=x.max_apeluri, seed=x.seed, triere=x.triere, doar_haiku=x.doar_haiku, filtru=None if not x.filtru else {
                       C.cheie_proba(json.loads(l)) for l in x.filtru.read_text(encoding='utf-8').splitlines() if l.strip()}), 'reconciliaza': lambda: C.reconciliaza_rulare(x.rulare_dir, edge),
                   'oprire': lambda: C.oprire(x.rulare_dir, edge, x.motiv), 'reluata': lambda: C.reluata(x.rulare_dir, edge), 'abandon': lambda: C.abandon(edge, x.rezervare),
                   'stare': lambda: C.stare(x.rulare_dir, edge)}[x.pas]()
    elif x.cmd == 'plan':
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
