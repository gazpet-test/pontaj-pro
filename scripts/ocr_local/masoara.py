"""Masuratoare pe o rulare existenta (laborator OCR): reface comparatia din citirile de pe disc si numara dezacordurile.
DOAR citire - nu scrie nimic in directorul rularii (spre deosebire de `compara`, care rescrie comparatie.json / dezacorduri.jsonl).

    python -B -m ocr_local.masoara C:/Users/Public/paw-data/ocr_rulari/r1 [--jsonl iesire.jsonl] [--exemple N]
"""
import argparse, collections, json, pathlib, re, sys

from .compare import compare_band


def bands(run_dir):
    """(document, banda, raw_lighton, res_lighton, raw_mineru, res_mineru) pentru fiecare banda citita de ambii cititori."""
    for plan_path in sorted(pathlib.Path(run_dir).glob('d*/plan.json')):
        d = plan_path.parent; doc = json.loads(plan_path.read_text(encoding='utf-8'))
        for band in doc['bands']:
            bd = d / ('page%04d' % band['page']) / band['id']; got = {}
            for reader in ('lighton', 'mineru'):
                rp = bd / reader / 'result.json'
                if not rp.exists(): break
                got[reader] = ((bd / reader / 'raw.txt').read_bytes().decode('utf-8') if (bd / reader / 'raw.txt').exists() else '',
                               json.loads(rp.read_text(encoding='utf-8')))
            if len(got) == 2: yield d.name, band, got['lighton'][0], got['lighton'][1], got['mineru'][0], got['mineru'][1]


def measure(run_dir):
    items = []; n = 0
    for doc, band, ra, sa, rb, sb in bands(run_dir):
        n += 1
        _, its = compare_band(band, ra, sa, rb, sb)
        for it in its: it['document'] = doc
        items += its
    return n, items


def summary(n, items):
    per = collections.Counter(i['tip'] for i in items); cant = collections.Counter(i['tip'] for i in items if i['e_cantitate'])
    return {'benzi': n, 'dezacorduri': len(items), 'e_cantitate': sum(cant.values()),
            'per_tip': {t: {'n': per[t], 'e_cantitate': cant[t]} for t in sorted(per)}}


def eliminate(base_items, items):
    """Dezacordurile TEXT din baza care nu mai sunt acoperite de niciun dezacord nou pe aceeasi banda (intervalele de caractere din
    `sursa` se suprapun la LightOn sau la MinerU). Audit individual: ce a ascuns normalizarea, nu doar cate."""
    def spans(it, who):
        s = (it.get('sursa') or {}).get(who)
        return None if not s else (s['seg'][0], s['start'], s['seg'][1], s['end'])
    def overlap(x, y):
        if x is None or y is None: return False
        return (x[0], x[1]) <= (y[2], y[3]) and (y[0], y[1]) <= (x[2], x[3])
    new = {}
    for it in items:
        if it['tip'] == 'text': new.setdefault((it.get('document'), it['band']), []).append(it)
    out = []
    for it in base_items:
        if it['tip'] != 'text': continue
        cand = new.get((it.get('document'), it['band']), [])
        if not any(overlap(spans(it, w), spans(c, w)) for c in cand for w in ('lighton', 'mineru')): out.append(it)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument('run_dir'); ap.add_argument('--jsonl'); ap.add_argument('--exemple', type=int, default=0)
    ap.add_argument('--fata-de', help='JSONL de baza (masoara --jsonl pe codul vechi): listeaza dezacordurile text eliminate cu cifre / semne')
    a = ap.parse_args(argv)
    n, items = measure(a.run_dir)
    print(json.dumps(summary(n, items), ensure_ascii=False, indent=1))
    if a.jsonl:
        with open(a.jsonl, 'w', encoding='utf-8') as f:
            for it in items:
                f.write(json.dumps({k: it.get(k) for k in ('document', 'band', 'page', 'kind', 'tip', 'citire_lighton', 'citire_mineru', 'e_cantitate',
                                                          'context_inainte', 'context_dupa', 'sursa')}, ensure_ascii=False) + '\n')
    if a.fata_de:
        base = [json.loads(l) for l in open(a.fata_de, encoding='utf-8') if l.strip()]
        gone = eliminate(base, items); risc = [i for i in gone if re.search(r'[0-9$€%+\-−–=<>≤≥±×*/^]', i['citire_lighton'] + i['citire_mineru'])]
        print('eliminate: %d din %d text; cu cifre / semne: %d' % (len(gone), sum(i['tip'] == 'text' for i in base), len(risc)))
        for i in risc: print(' ', i.get('document'), i['band'], repr(i['citire_lighton'][:70]), '||', repr(i['citire_mineru'][:70]))
    if a.exemple:
        for it in [i for i in items if i['tip'] == 'text'][:a.exemple]:
            print(repr(it['citire_lighton'][:80]), '|', repr(it['citire_mineru'][:80]))


if __name__ == '__main__':
    sys.exit(main())
