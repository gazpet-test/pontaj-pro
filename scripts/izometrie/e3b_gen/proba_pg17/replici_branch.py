# Replicile EXACTE de prod ale funcțiilor de platformă de pe lista albă r5h (E3_CONFIRMA_DESIGN §17.2 / §18.4), pentru un BRANCH
# Supabase de probă: pe un branch nou platforma are alte versiuni (ex. pg_net 0.20.4 față de 0.20.0 pe prod), deci corpul lui
# extensions.grant_pg_net_access (și poate al celorlalte) diferă de amprenta din poarta E3 → E3 / E3b refuzate pe branch
# (fail-closed, corect). Proba E3b pune întâi pe branch corpurile de prod (CREATE OR REPLACE, ca la baseline-ul Storage).
# Sursa: scripts/izometrie/e3_gen/baseline_pre_e3.json, cheia „implicite” (captură READ-ONLY de pe prod, revizuită); formula
# amprentei, lista excepțiilor și lista replicilor se citesc din gen_e3.py (AST, fără să-l execute), ca să nu existe o a doua copie.
# Utilizare: python3 replici_branch.py <gen_e3.py> <baseline_pre_e3.json> <director ieșire>
# Ieșire: manifest.tsv (functia, tip retur, md5_corp prod, owner prod, secdef, config, fișier), replica_<n>.sql (una pe funcție),
#         verifica.sql (amprenta fiecărei excepții de pe lista albă, pe țintă vs prod: OK / DIFERIT / ABSENT).
# NICIODATĂ pe prod: fișierele generate sunt doar pentru branch-ul de probă (proba_e3b.sh refuză ref-ul de producție).
import ast, hashlib, json, os, re, sys

gen_py, baza_json, iesire = sys.argv[1], sys.argv[2], sys.argv[3]
md5 = lambda s: hashlib.md5(s.encode('utf-8')).hexdigest()
q_ = lambda s: "'%s'" % s.replace("'", "''")

# constantele din gen_e3.py, citite prin AST (gen_e3.py generează la import — nu se importă)
cst = {}
for nod in ast.parse(open(gen_py, encoding='utf-8').read()).body:
    if isinstance(nod, ast.Assign) and len(nod.targets) == 1 and isinstance(nod.targets[0], ast.Name) \
            and nod.targets[0].id in ('AMPR_IMPL_SQL', 'IMPLICITE_REVIZUITE', 'REPLICI'):
        cst[nod.targets[0].id] = ast.literal_eval(nod.value)
assert sorted(cst) == ['AMPR_IMPL_SQL', 'IMPLICITE_REVIZUITE', 'REPLICI'], sorted(cst)
AMPR, REVIZ, REPLICI = cst['AMPR_IMPL_SQL'], cst['IMPLICITE_REVIZUITE'], cst['REPLICI']

IMPL = json.load(open(baza_json, encoding='utf-8'))['implicite']
rev = IMPL['revizuite']
assert sorted((r['tip'], r['identitate']) for r in rev) == sorted(REVIZ), 'captura implicite ≠ lista revizuită din gen_e3.py'
for r in rev:   # aceeași reverificare ca gen_e3.py: amprenta = formula pe componente
    a = md5('|'.join([r['tip'], r['identitate'], r['functia'], r['owner'], 'true' if r['secdef'] else 'false', r['config'],
                      r['limbaj'], r['md5_corp']]))
    assert a == r['amprenta'], r['identitate']
CORP = {c['functia']: c['prosrc'] for c in IMPL['corpuri']}
assert sorted(CORP) == sorted(REPLICI)
pe_fn = {}
for r in rev:
    pe_fn.setdefault(r['functia'], r)
os.makedirs(iesire, exist_ok=True)
man = []
for i, f in enumerate(REPLICI, 1):
    r = pe_fn[f]
    assert md5(CORP[f] + '|') == r['md5_corp'], f
    assert r['limbaj'] == 'plpgsql' and '$corp$' not in CORP[f]
    m = re.fullmatch(r'(\{"search_path=\\"\\""\})?', r['config'])
    assert m, r['config']                      # pe prod: fie fără config, fie search_path = ''
    ret = {'event trigger': 'event_trigger', 'trigger': 'trigger'}[r['tip']]
    assert all(x['tip'] == r['tip'] for x in rev if x['functia'] == f)
    fis = 'replica_%d.sql' % i
    # CREATE OR REPLACE păstrează owner-ul și ACL-ul existente; înlocuiește corpul, SECURITY și config-ul cu cele de prod
    sql = ["-- GENERAT de scripts/izometrie/e3b_gen/proba_pg17/replici_branch.py din baseline_pre_e3.json (cheia „implicite”,",
           "-- capturat de pe prod %s) — DOAR pe un branch Supabase de probă, NICIODATĂ pe prod. Corpul exact de prod: md5(prosrc || '|') = %s"
           % (IMPL['capturat_la'][:10], r['md5_corp']),
           "SET client_min_messages = warning;",
           "CREATE OR REPLACE FUNCTION %s RETURNS %s LANGUAGE plpgsql%s%s AS $corp$%s$corp$;"
           % (f, ret, ' SECURITY DEFINER' if r['secdef'] else ' SECURITY INVOKER',
              " SET search_path = ''" if r['config'] else '', CORP[f])]
    open(os.path.join(iesire, fis), 'w', encoding='utf-8', newline='\n').write("\n".join(sql) + "\n")
    man.append('\t'.join([f, ret, r['md5_corp'], r['owner'], 'true' if r['secdef'] else 'false', r['config'] or '-', fis]))
open(os.path.join(iesire, 'manifest.tsv'), 'w', encoding='utf-8', newline='\n').write("\n".join(man) + "\n")

# verificarea: amprenta (formula porții) a fiecărei excepții de pe lista albă, calculată pe țintă, față de prod
prod = ",\n    ".join("(%s, %s, %s, %s, %s, %s)" % (q_(r['tip']), q_(r['identitate']), q_(r['functia']), q_(r['amprenta']),
                                                   q_(r['md5_corp']), q_(r['owner'])) for r in sorted(rev, key=lambda r: (r['tip'], r['identitate'])))
ver = """-- GENERAT de replici_branch.py — read-only: amprenta excepțiilor de pe lista albă r5h pe țintă vs captura de prod
-- coloane: stare (OK / DIFERIT / ABSENT) | tip | identitate | funcția pe țintă | md5_corp țintă | md5_corp prod | owner țintă | owner prod
WITH prod(tip, identitate, functia, amprenta, md5_corp, owner) AS (VALUES
    @@PROD@@),
tinta AS (
  SELECT DISTINCT o.type AS tip, o.identity AS identitate, f.identity AS functia, @@AMPR@@ AS amprenta,
         md5(q.prosrc || '|' || coalesce(q.prosqlbody::text, '')) AS md5_corp, pg_get_userbyid(q.proowner) AS owner
    FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid JOIN pg_language l ON l.oid = q.prolang
         CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
         CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
   WHERE d.refclassid = 'pg_proc'::regclass
     AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_operator'::regclass, 'pg_cast'::regclass)
     AND format('%s %s', o.type, o.identity) IN (SELECT format('%s %s', p.tip, p.identitate) FROM prod p))
SELECT CASE WHEN t.identitate IS NULL THEN 'ABSENT' WHEN t.amprenta = p.amprenta THEN 'OK' ELSE 'DIFERIT' END,
       p.tip, p.identitate, coalesce(t.functia, '-'), coalesce(t.md5_corp, '-'), p.md5_corp, coalesce(t.owner, '-'), p.owner
  FROM prod p LEFT JOIN tinta t ON t.tip = p.tip AND t.identitate = p.identitate
 ORDER BY p.tip COLLATE "C", p.identitate COLLATE "C";
""".replace('@@PROD@@', prod).replace('@@AMPR@@', AMPR)
open(os.path.join(iesire, 'verifica.sql'), 'w', encoding='utf-8', newline='\n').write(ver)
print('replici_branch: %d replici (%s), %d excepții de verificat, captura %s'
      % (len(REPLICI), ', '.join(REPLICI), len(rev), IMPL['capturat_la'][:19]))
