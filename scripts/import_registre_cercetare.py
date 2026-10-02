#!/usr/bin/env python3
"""Generează SQL-ul de import pentru registrele de cercetare (migrarea 20261007a_norme_registre_cercetare).

Citește docs/cercetare/{registru_surse,registru_cerinte,graf_aplicabilitate,cnsc_practica,clarificari_tipare}.json,
validează legăturile (fără orfane) și scrie INSERT-uri idempotente (ON CONFLICT DO NOTHING) în fișierele din --out,
câte unul pe tabelă, în ordinea FK. Nu se conectează la BD — SQL-ul se aplică separat, după preview + confirmare.

  python3 scripts/import_registre_cercetare.py --out /tmp/import_registre [--versiune cercetare-2026-10-02] [--max-ofertare-id 49]
"""
import argparse, json, os, re, sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'cercetare')

def load(n):
    with open(os.path.join(D, n + '.json'), encoding='utf-8') as f:
        return json.load(f)

def q(v):
    """Literal SQL sigur (dollar-quoting cu tag care nu apare în text)."""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v)
    tag = 'q'
    while f'${tag}$' in s:
        tag += 'q'
    return f'${tag}${s}${tag}$'

def arr(v):
    return 'ARRAY[]::text[]' if not v else 'ARRAY[' + ','.join(q(str(x)) for x in v) + ']::text[]'

def js(v):
    return 'NULL' if v is None else q(json.dumps(v, ensure_ascii=False)) + '::jsonb'

def dt(v, extra, key):
    """date ISO sau DD.MM.YYYY; altceva (ex. „2018”) → NULL + valoarea brută păstrată în extra."""
    if not v:
        return 'NULL'
    s = str(v)
    if re.fullmatch(r'\d{4}-\d\d-\d\d', s):
        return q(s) + '::date'
    m = re.fullmatch(r'(\d\d)\.(\d\d)\.(\d{4})', s)
    if m:
        return q(f'{m[3]}-{m[2]}-{m[1]}') + '::date'
    extra[key + '_brut'] = s
    return 'NULL'

def insert(table, cols, rows, conflict):
    out = []
    for i in range(0, len(rows), 50):
        vals = ',\n'.join('(' + ','.join(r) + ')' for r in rows[i:i + 50])
        out.append(f'INSERT INTO public.{table} ({",".join(cols)}) VALUES\n{vals}\nON CONFLICT {conflict} DO NOTHING;\n')
    return '\n'.join(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--versiune', default='cercetare-2026-10-02')
    ap.add_argument('--max-ofertare-id', type=int, default=None,
                    help='ofertare_normative_id peste acest prag devine NULL (dacă rândul nu există în BD)')
    a = ap.parse_args()
    V = q(a.versiune)
    S, R, G, C, T = (load(n) for n in ['registru_surse', 'registru_cerinte', 'graf_aplicabilitate', 'cnsc_practica', 'clarificari_tipare'])

    # ── validări (fail-closed) ──
    sid = {s['source_id'] for s in S}
    rid = {r['requirement_id'] for r in R}
    err = []
    if len(sid) != len(S): err.append('source_id duplicat')
    if len(rid) != len(R): err.append('requirement_id duplicat')
    err += [f'cerinta {r["requirement_id"]} → sursa lipsă {r["source_id"]}' for r in R if r['source_id'] not in sid]
    err += [f'graf → sursa lipsă {g["from_source_id"]}/{g["to_source_id"]}' for g in G if g['from_source_id'] not in sid or g['to_source_id'] not in sid]
    err += [f'tipar {t["pattern_id"]} → cerinta lipsă {x}' for t in T for x in t['normative_refs'] if x not in rid]
    err += [f'tipar {t["pattern_id"]} → precedent lipsă {x}' for t in T for x in t['precedente_cnsc'] if x not in sid]
    if err:
        print('REFUZ — validare eșuată:\n' + '\n'.join(err[:50]), file=sys.stderr)
        sys.exit(3)
    os.makedirs(a.out, exist_ok=True)

    # ── norme_surse ──
    tip = ['source_id', 'tip', 'cod', 'titlu', 'emitent', 'editie', 'data_publicarii', 'effective_from', 'effective_to', 'status', 'inlocuit_de',
           'url_oficial', 'acces', 'domenii', 'aplicabilitate_gazpet', 'motiv_aplicabilitate', 'verificat_pe_sursa_primara', 'ofertare_normative_id',
           'snapshot_sha256', 'snapshot_data', 'ultima_verificare', 'nota']
    rows = []
    for s in S:
        ex = {k: v for k, v in s.items() if k not in tip}
        oid = s.get('ofertare_normative_id')
        if oid is not None and a.max_ofertare_id is not None and oid > a.max_ofertare_id:
            ex['ofertare_normative_id_neexistent'] = oid; oid = None
        dates = {k: dt(s.get(k), ex, k) for k in ['data_publicarii', 'effective_from', 'effective_to', 'snapshot_data', 'ultima_verificare']}
        rows.append([q(s['source_id']), q(s['tip']), q(s.get('cod')), q(s['titlu']), q(s.get('emitent')), q(s.get('editie')),
                     dates['data_publicarii'], dates['effective_from'], dates['effective_to'], q(s['status']), q(s.get('inlocuit_de')),
                     q(s.get('url_oficial')), q(s.get('acces')), arr(s.get('domenii')), q(s.get('aplicabilitate_gazpet')),
                     q(s.get('motiv_aplicabilitate')), q(s.get('verificat_pe_sursa_primara')), q(oid), q(s.get('snapshot_sha256')),
                     dates['snapshot_data'], dates['ultima_verificare'], q(s.get('nota')), js(ex), V])
    f1 = insert('norme_surse', tip + ['extra', 'versiune_import'], rows, '(source_id)')

    # ── norme_cerinte ──
    tc = ['requirement_id', 'source_id', 'editie', 'locator', 'cerinta', 'conditii_aplicabilitate', 'temei_tip', 'obligatoriu_de_ce', 'evidenta_ceruta',
          'verificare', 'prag', 'tip_consum', 'domeniu', 'faza', 'incredere', 'verificat_pe_sursa', 'necesita_standard_licentiat', 'note', 'tema']
    rows = []
    for r in R:
        ex = {k: v for k, v in r.items() if k not in tc}
        rows.append([q(r['requirement_id']), q(r['source_id']), q(r.get('editie')), q(r.get('locator')), q(r['cerinta']),
                     q(r.get('conditii_aplicabilitate')), q(r['temei_tip']), q(r.get('obligatoriu_de_ce')), arr(r.get('evidenta_ceruta')),
                     q(r.get('verificare')), js(r.get('prag')), q(r.get('tip_consum')), q(r.get('domeniu')), q(r.get('faza')),
                     q(r.get('incredere')), q(bool(r.get('verificat_pe_sursa'))), q(bool(r.get('necesita_standard_licentiat'))),
                     q(r.get('note')), q(r.get('tema')), js(ex), V])
    f2 = insert('norme_cerinte', tc + ['extra', 'versiune_import'], rows, '(requirement_id)')

    # ── norme_graf ──
    rows = [[q(g['from_source_id']), q(g['to_source_id']), q(g['relatie']), q(g.get('locator') or ''), q(g.get('nota')), q(g.get('tema')), V] for g in G]
    f3 = insert('norme_graf', ['from_source_id', 'to_source_id', 'relatie', 'locator', 'nota', 'tema', 'versiune_import'], rows,
                '(from_source_id, to_source_id, relatie, locator)')

    # ── cnsc_decizii ──
    tn = ['id', 'nr_decizie', 'buletin_oficial', 'alias_buletin_oficial', 'data', 'an', 'domeniu', 'tema', 'regula', 'temei_legal', 'link_sursa',
          'autoritate', 'obiect', 'problema', 'solutie', 'rationament_cnsc', 'cum_ne_ajuta', 'tip_procedura', 'lege_aplicabila', 'valoare_estimata',
          'sub_prag', 'fapte_relevante', 'concluzie_cnsc', 'comparabilitate', 'citate_cheie', 'control_judiciar', 'avertisment_instanta',
          'verificat', 'snapshot_text_sha256', 'temei_tip']
    rows = []
    for c in C:
        ex = {k: v for k, v in c.items() if k not in tn}
        src = 'SRC-' + c['id']
        cj = c.get('control_judiciar')
        rows.append([q(c['id']), q(src if src in sid else None), q(c.get('nr_decizie')), q(c.get('buletin_oficial')), q(c.get('alias_buletin_oficial')),
                     dt(c.get('data'), ex, 'data'), q(c.get('an')), q(c.get('domeniu')), arr(c.get('tema')), q(c['regula']), arr(c.get('temei_legal')),
                     q(c.get('link_sursa')), q(c.get('autoritate')), q(c.get('obiect')), q(c.get('problema')), q(c.get('solutie')),
                     q(c.get('rationament_cnsc')), q(c.get('cum_ne_ajuta')), q(c.get('tip_procedura')), q(c.get('lege_aplicabila')),
                     q(c.get('valoare_estimata')), q(c.get('sub_prag')), q(c.get('fapte_relevante')), q(c.get('concluzie_cnsc')),
                     js(c.get('comparabilitate') if isinstance(c.get('comparabilitate'), dict) else ({'text': c['comparabilitate']} if c.get('comparabilitate') else None)),
                     js(c.get('citate_cheie') or []),
                     js(cj if isinstance(cj, dict) else ({'text': cj} if cj else None)),
                     q(c.get('avertisment_instanta')), q(bool(c.get('verificat'))), q(c.get('snapshot_text_sha256')), q('PRACTICA_CNSC'), js(ex), V])
    f4 = insert('cnsc_decizii', tn[:1] + ['source_id'] + tn[1:] + ['extra', 'versiune_import'], rows, '(id)')

    # ── clarificari_tipare ──
    tt = ['pattern_id', 'cod_vechi', 'tip_problema', 'titlu', 'trigger', 'documente_de_verificat', 'normative_refs', 'precedente_cnsc',
          'intrebare_propusa', 'impact_intern', 'confidence', 'requires_human_legal_review', 'note']
    rows = [[q(t['pattern_id']), arr(t.get('cod_vechi')), q(t['tip_problema']), q(t['titlu']), js(t['trigger']), arr(t.get('documente_de_verificat')),
             arr(t.get('normative_refs')), arr(t.get('precedente_cnsc')), q(t.get('intrebare_propusa')), js(t.get('impact_intern')),
             q(t.get('confidence')), q(bool(t.get('requires_human_legal_review'))), q(t.get('note')), V] for t in T]
    f5 = insert('clarificari_tipare', tt + ['versiune_import'], rows, '(pattern_id)')

    for i, (n, body) in enumerate([('norme_surse', f1), ('norme_cerinte', f2), ('norme_graf', f3), ('cnsc_decizii', f4), ('clarificari_tipare', f5)], 1):
        with open(os.path.join(a.out, f'{i}_{n}.sql'), 'w', encoding='utf-8') as f:
            f.write(body)
    print(f'OK: surse {len(S)} · cerinte {len(R)} · graf {len(G)} · cnsc {len(C)} · tipare {len(T)} → {a.out}')

if __name__ == '__main__':
    main()
