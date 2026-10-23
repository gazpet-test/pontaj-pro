"""E4b-1 generator. Read-only E4a baseline; no database or network."""
import json
import hashlib
import re
import runpy
from pathlib import Path

SP = Path(__file__).resolve().parent
A = runpy.run_path(str(SP / 'gen_e4a.py'), run_name='e4b_baseline')
R, q, arr, block, src = (A[k] for k in ('R', 'q', 'arr', 'block', 'src'))
baseline = (R / 'supabase/migrations/20261109a_izometrie_e4a_flux.sql').read_text(encoding='utf-8')
tables = ['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii',
          'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii',
          'izo_declaratii_versiuni', 'izo_declaratii_gps', 'izo_sync_incercari', 'izo_rata_apeluri','izo_aprobari','izo_suduri','izo_suduri_capete']
journals = ['izo_operatii', 'izo_declaratii_versiuni', 'izo_sync_incercari', 'izo_declaratii_gps','izo_aprobari']
schema = (SP / 'e4b_schema_tpl.sql').read_text(encoding='utf-8').replace('CREATE FUNCTION public.', '  CREATE FUNCTION public.')
cut_cols = A['B']['C'] + ['id', 'uid', 'radacina_id', 'server_ver', 'created_at', 'updated_at']
api = '\n'.join((SP / f).read_text(encoding='utf-8') for f in ('e4b_api_tpl.sql','e4b_aprobare_tpl.sql','e4b_simulare_tpl.sql','e4b_suduri_tpl.sql','e4b_writer_tpl.sql','e4b_normalizare_tpl.sql','e4b_alerte_tpl.sql')).replace('CREATE FUNCTION public.', '  CREATE FUNCTION public.')
api = api.replace('@@CUT_COLS@@', ','.join(cut_cols)).replace('@@CUT_VALUES@@', ','.join('v_child.'+c for c in cut_cols))
security, implicit = [], list(A['B']['IMPL_POST'] + A['implicit'])
for table in tables:
    security += [f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;',
                 f'REVOKE ALL ON public.{table} FROM PUBLIC,anon,authenticated,service_role;']
    if table not in ('izo_declaratii_gps', 'izo_rata_apeluri'):
        cols = None
        if table == 'izo_operatii':
            cols = 'id,autor_profile_id,op_id,canal,proiect_id,tronson_id,dispozitiv_id,seq,versiune_format,tip_op,payload,rezultat,cod,raspuns,ora_tableta,ora_server,offset_ceas_s,server_ver'
        elif table == 'izo_declaratii_versiuni':
            cols = 'declaratie_id,versiune,payload,op_id,la'
        elif table == 'izo_aprobari':
            cols = 'id,cheie_operatie,proiect_id,tronson_id,aprobator,aprobator_angajat,randuri,decizii,amprenta_preview,eveniment_ids,raspuns,creat_la'
        security.append(f'GRANT SELECT{("("+cols+")") if cols else ""} ON public.{table} TO authenticated;')
        expr = 'auth.uid() IS NOT NULL AND public.fn_izo_citire(proiect_id)'
        if table == 'izo_dispozitive':
            expr = 'auth.uid() IS NOT NULL AND profile_id=auth.uid()'
        if table == 'izo_suduri_capete':
            expr = 'auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_suduri s WHERE s.id=izo_suduri_capete.sudura_id)'
        if table in ('izo_bucati_declarate', 'izo_declaratii_versiuni'):
            expr = f'auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.id={table}.declaratie_id)'
        security.append(f'CREATE POLICY {table}_api_sel ON public.{table} FOR SELECT TO authenticated USING ({expr});')
        if table not in ('izo_bucati_declarate', 'izo_declaratii_versiuni', 'izo_dispozitive','izo_suduri_capete'):
            implicit.append(f'policy|{table}_api_sel on public.{table}|public.fn_izo_citire(bigint)')
    if table != 'izo_rata_apeluri':
        for event, level in [('DELETE', 'ROW'), ('TRUNCATE', 'STATEMENT')]:
            name = 'a0_izo_teren_' + event.lower()
            security.append(f'CREATE TRIGGER {name} BEFORE {event} ON public.{table} FOR EACH {level} EXECUTE FUNCTION public.fn_izo_teren_imuabil();')
            security.append(f'ALTER TABLE public.{table} ENABLE ALWAYS TRIGGER {name};')
            implicit.append(f'trigger|{name} on public.{table}|public.fn_izo_teren_imuabil()')
        if table in journals:
            security.append(f'CREATE TRIGGER a0_izo_teren_update BEFORE UPDATE ON public.{table} FOR EACH ROW EXECUTE FUNCTION public.fn_izo_teren_imuabil();')
            security.append(f'ALTER TABLE public.{table} ENABLE ALWAYS TRIGGER a0_izo_teren_update;')
            implicit.append(f'trigger|a0_izo_teren_update on public.{table}|public.fn_izo_teren_imuabil()')

security += ['CREATE TRIGGER a0_izo_decl_ceas BEFORE UPDATE ON public.izo_declaratii FOR EACH ROW EXECUTE FUNCTION public.fn_izo_decl_ceas();',
             'ALTER TABLE public.izo_declaratii ENABLE ALWAYS TRIGGER a0_izo_decl_ceas;']
for table in ('izo_fronturi','izo_preverificari','izo_declaratii','izo_rezervari','izo_operatii','izo_sync_incercari','izo_aprobari','izo_suduri','izo_suduri_capete'):
    security.append(f'REVOKE ALL ON SEQUENCE public.{table}_id_seq FROM PUBLIC,anon,authenticated,service_role;')
implicit.append('trigger|a0_izo_decl_ceas on public.izo_declaratii|public.fn_izo_decl_ceas()')
for table in ('magazie_bucati_evenimente','magazie_bucati_miscari'):
    for op in ('SELECT','INSERT'):
        name = 'izo_montaj_' + table.removeprefix('magazie_bucati_') + '_' + ('sel' if op == 'SELECT' else 'ins')
        security.append(f'CREATE POLICY {name} ON public.{table} FOR {op} TO izo_montaj_writer ' +
                        ('USING' if op == 'SELECT' else 'WITH CHECK') + ' (proiect_id IS NOT NULL);')
security += [
 'CREATE POLICY magbuc_izo_montaj_ins ON public.magazie_bucati FOR INSERT TO izo_montaj_writer WITH CHECK (proiect_id IS NOT NULL);',
 'GRANT INSERT('+','.join(cut_cols)+') ON public.magazie_bucati TO izo_montaj_writer;',
 'GRANT USAGE ON SEQUENCE public.magazie_bucati_id_seq,public.izo_rezervari_id_seq TO izo_montaj_writer;',
 'GRANT SELECT ON public.izo_declaratii,public.izo_bucati_declarate,public.izo_rezervari TO izo_montaj_writer;',
 'GRANT UPDATE(stare,bucata_id,server_ver) ON public.izo_bucati_declarate TO izo_montaj_writer;',
 'GRANT UPDATE(activa,eliberata_la,motiv_eliberare,eveniment_id,server_ver) ON public.izo_rezervari TO izo_montaj_writer;',
 'GRANT INSERT(proiect_id,tronson_id,declaratie_id,declaratie_versiune,autor_profile_id,bucata_id,din_depozit,expira_dupa,transfer_din_id) ON public.izo_rezervari TO izo_montaj_writer;',
]
for t,expr in [('izo_declaratii','proiect_id IS NOT NULL'),('izo_bucati_declarate','declaratie_id IS NOT NULL'),('izo_rezervari','proiect_id IS NOT NULL')]:
    for op in (['SELECT'] if t=='izo_declaratii' else ['SELECT','UPDATE'] + (['INSERT'] if t=='izo_rezervari' else [])):
        tail = {'SELECT':f'USING ({expr})','INSERT':f'WITH CHECK ({expr})','UPDATE':f'USING ({expr}) WITH CHECK ({expr})'}[op]
        security.append(f'CREATE POLICY izo_montaj_{t.removeprefix("izo_")}_{op[:3].lower()} ON public.{t} FOR {op} TO izo_montaj_writer {tail};')

old = block(baseline, 'fn_izo_porti_lipsa')
old_guard = block(baseline, 'fn_izo_garda_montaj')
guard_branch = (SP / 'e4b_garda_tpl.sql').read_text(encoding='utf-8')
assert old_guard.count('  BEGIN\n') == 1
new_guard = old_guard.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1).replace('  BEGIN\n', '  BEGIN\n' + guard_branch, 1)
old_flux = block(baseline, 'fn_izo_flux_admin')
old_e4_gate = block(baseline,'fn_izo_porti_e4_lipsa')
old_depot = block((R/'supabase/migrations/20261102a_izometrie_e2a_registru.sql').read_text(encoding='utf-8'),'fn_izo_depozit_in_registru')
depot_anchor = "b.atribute->>'depozit_origine_id' = p_depozit::text"
assert old_depot.count(depot_anchor) == 1
new_depot = old_depot.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(depot_anchor,
    depot_anchor + " OR b.atribute->>'destinatie_depozit_id' = p_depozit::text")
seq_anchor = "(c.oid='public.izo_server_ver_seq'::regclass)"
assert old_e4_gate.count(seq_anchor) == 1
new_e4_gate = old_e4_gate.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(seq_anchor,
    "(c.oid IN ('public.izo_server_ver_seq'::regclass,'public.magazie_bucati_evenimente_id_seq'::regclass,'public.magazie_bucati_miscari_id_seq'::regclass,'public.magazie_bucati_id_seq'::regclass,'public.izo_rezervari_id_seq'::regclass))")
flux_anchor = """      IF to_regclass('public.izo_declaratii') IS NOT NULL OR to_regclass('public.izo_rezervari') IS NOT NULL
        OR to_regclass('public.izo_fronturi') IS NOT NULL THEN RAISE EXCEPTION 'E4a oprirea necesita garda E4b'; END IF;"""
assert old_flux.count(flux_anchor) == 1
new_flux = old_flux.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(flux_anchor,"""      IF EXISTS(SELECT 1 FROM public.izo_declaratii WHERE tronson_id=p_tronson AND stare NOT IN ('aprobata','respinsa','stearsa'))
        OR EXISTS(SELECT 1 FROM public.izo_rezervari WHERE tronson_id=p_tronson AND activa)
        OR EXISTS(SELECT 1 FROM public.izo_fronturi WHERE tronson_id=p_tronson AND activ)
        THEN RAISE EXCEPTION 'E4b front/declaratii/rezervari; oprire refuzata'; END IF;""")
anchor = '    RETURN v;\n  END $f$;'
assert old.count(anchor) == 1
new = old.replace(anchor, '    v := v || public.fn_izo_porti_e4b_lipsa();\n' + anchor)
def inventory(xs):
    return 'v_impl := %s; IF v_impl IS DISTINCT FROM %s THEN RAISE EXCEPTION \'E4b inventar implicit: %%\',v_impl; END IF;' % (A['B']['const']['IMPL_EXPR'], arr(sorted(xs)))

functions = re.findall(r'CREATE FUNCTION public\.(fn_izo_\w+)\(([^)]*)\)', schema + '\n' + api)
# Explicit signatures: parameter declarations -> types. No catalog capture during apply.
signatures = [name + '(' + ','.join(re.sub(r'^p_\w+\s+', '', p.strip()) for p in args.split(',') if p.strip()) + ')' for name,args in functions]
wrappers = ['fn_izo_aprobare_lot','fn_izo_aproba','fn_izo_respinge','fn_izo_revizie_cere','fn_izo_iesire_tronson','fn_izo_front_elibereaza','fn_izo_serie_lamureste']
internals = ['fn_izo_aprobare_intern','fn_izo_aproba_intern','fn_izo_decizie_intern','fn_izo_iesire_intern','fn_izo_front_intern','fn_izo_serie_intern']
birou_acl = ['GRANT CREATE ON SCHEMA public TO izo_montaj_writer;']
wrapper_signatures = []
for signature in signatures:
    name = signature.split('(')[0]
    if name in internals:
        birou_acl.append(f'GRANT EXECUTE ON FUNCTION public.{signature} TO izo_montaj_writer;')
    if name in wrappers:
        birou_acl.append(f'ALTER FUNCTION public.{signature} OWNER TO izo_montaj_writer;')
        wrapper_signatures.append(signature)
birou_acl.append('REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;')
birou_acl.append('SET LOCAL ROLE izo_montaj_writer;')
birou_acl.extend(f'GRANT EXECUTE ON FUNCTION public.{s} TO authenticated;' for s in wrapper_signatures)
birou_acl.append('GRANT EXECUTE ON FUNCTION public.fn_izo_birou_fapt(bigint,text,text,bigint,integer,uuid,text,timestamptz,text) TO postgres;')
birou_acl.append('RESET ROLE;')
birou_acl += [
 'GRANT CREATE ON SCHEMA public TO izo_montaj_writer;',
 'ALTER FUNCTION public.fn_izo_taiere_fapt(bigint) OWNER TO izo_montaj_writer;',
 'REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;',
 'SET LOCAL ROLE izo_montaj_writer;',
 'GRANT EXECUTE ON FUNCTION public.fn_izo_taiere_fapt(bigint) TO postgres;',
 'RESET ROLE;',
 'GRANT CREATE ON SCHEMA public TO izo_montaj_writer;',
 'ALTER FUNCTION public.fn_izo_corectie_fapt(bigint,text,bigint,uuid,text,text,integer) OWNER TO izo_montaj_writer;',
 'REVOKE CREATE ON SCHEMA public FROM izo_montaj_writer;',
 'SET LOCAL ROLE izo_montaj_writer;',
 'GRANT EXECUTE ON FUNCTION public.fn_izo_corectie_fapt(bigint,text,bigint,uuid,text,text,integer) TO postgres;',
 'RESET ROLE;',
 'GRANT EXECUTE ON FUNCTION public.fn_izo_capete_muta(bigint,bigint,bigint) TO izo_montaj_writer;',
 'GRANT EXECUTE ON FUNCTION public.fn_izo_taiere_miscare(text,bigint,text,jsonb,jsonb) TO izo_montaj_writer;',
]
old_emitere = block(baseline,'fn_izo_flux_aprobare_admin')
emitere_anchor = "    IF p_nume IS NULL OR p_nume !~"
assert old_emitere.count(emitere_anchor)==1
new_emitere = old_emitere.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(emitere_anchor,'''    PERFORM 1 FROM public.izo_suduri WHERE id IN (SELECT c.sudura_id FROM public.izo_suduri_capete c
      JOIN public.magazie_bucati b ON b.id=c.bucata_id JOIN public.executie_tevi t ON t.id=b.executie_teava_id
      WHERE t.pachet_id=p_pachet AND c.activ) ORDER BY id FOR SHARE;
    IF cardinality(public.fn_izo_emitere_blocaje(ARRAY(SELECT b.id FROM public.magazie_bucati b JOIN public.executie_tevi t
      ON t.id=b.executie_teava_id WHERE t.pachet_id=p_pachet)))>0 THEN RAISE EXCEPTION 'emitere_blocata'; END IF;
'''+emitere_anchor)
baseline_owners = {}
for file in sorted((R/'supabase/migrations').glob('*izometrie*.sql')):
    if file.name >= '20261109b': continue
    for sig,owner in re.findall(r'ALTER FUNCTION public\.(fn_izo_\w+\([^;]*?\)) OWNER TO (\w+);', file.read_text(encoding='utf8')):
        baseline_owners[sig] = owner
exec((SP/'e4b_security.py').read_text(encoding='utf8'))

# Inventar fix al owner-ilor E4b; toate celelalte obiecte noi raman postgres.
function_owners = {s: ('izo_teren_editor' if s.split('(')[0] in teren_owned | {
    'fn_izo_teren_instantaneu','fn_izo_teren_pregateste','fn_izo_sync_push'} else
    'izo_montaj_writer' if s.split('(')[0] in writer_owned | shared_invoker | set(wrappers) | {
    'fn_izo_birou_fapt','fn_izo_taiere_fapt','fn_izo_corectie_fapt'} else 'postgres') for s in signatures}

def owned_drop(s):
    stmt = f'DROP FUNCTION public.{s};'
    owner = function_owners[s]
    return stmt if owner == 'postgres' else f'SET LOCAL ROLE {owner};\n{stmt}\nRESET ROLE;'

def scope_function_acl(sql):
    """Executa ACL/ALTER ca owner-ul curent, inclusiv dupa transferul din forward.

    Nu rescrie corpurile functiilor; expresia vizeaza doar DDL static cu semnaturi.
    """
    owners, active = dict(baseline_owners), 'postgres'
    pattern = re.compile(r'SET LOCAL ROLE (\w+);|RESET ROLE;|'
        r'ALTER FUNCTION (public\.fn_izo_\w+\([^;]*?\)) OWNER TO (\w+);|'
        r'(?:GRANT|REVOKE) [^;\n]*? ON FUNCTION (public\.fn_izo_\w+\([^;]*?\)) (?:TO|FROM) [^;]+;')
    def replace(m):
        nonlocal active
        if m[1]: active = m[1]; return m[0]
        if m[0] == 'RESET ROLE;': active = 'postgres'; return m[0]
        targets = re.findall(r'public\.(fn_izo_\w+\([^)]*\))', m[2] or m[4])
        roles = {owners.get(s, 'postgres') for s in targets}
        assert len(roles) == 1, (m[0], roles)
        owner = roles.pop()
        if m[2]: owners[targets[0]] = m[3]
        if active == owner: return m[0]
        return f'SET LOCAL ROLE {owner};\n{m[0]}\n' + ('RESET ROLE;' if active == 'postgres' else f'SET LOCAL ROLE {active};')
    return pattern.sub(replace, sql)

values = {
    'EMITERE_NEW': new_emitere, 'EMITERE_OLD': old_emitere.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1),
    'EMITERE_MD5': q(hashlib.md5(src(old_emitere).encode()).hexdigest()),
    'MATRIX_ACL': '\n'.join(matrix_acl), 'MATRIX_ROLLBACK': '\n'.join(matrix_rollback),
    'SCHEMA': schema, 'API': api, 'SECURITY': '\n'.join(security),
    'GUARD_NEW': new_guard, 'GUARD_OLD': old_guard.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1),
    'GUARD_MD5': q(hashlib.md5(src(old_guard).encode()).hexdigest()),
    'FLUX_NEW': new_flux, 'FLUX_OLD': old_flux.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1),
    'FLUX_MD5': q(hashlib.md5(src(old_flux).encode()).hexdigest()),
    'BIR0U_ACL': '\n'.join(birou_acl),
    'CUT_REVOKE': 'REVOKE INSERT('+','.join(cut_cols)+') ON public.magazie_bucati FROM izo_montaj_writer;',
    'E4_GATE_NEW': new_e4_gate, 'E4_GATE_OLD': old_e4_gate.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1),
    'E4_GATE_MD5': q(hashlib.md5(src(old_e4_gate).encode()).hexdigest()),
    'DEPOT_NEW': new_depot, 'DEPOT_OLD': old_depot.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1),
    'DEPOT_MD5': q(hashlib.md5(src(old_depot).encode()).hexdigest()),
    'PORTI_NEW': new, 'PORTI_OLD': old,
    'OLD_MD5': q(hashlib.md5(src(old).encode()).hexdigest()),
    'IMPL_PRE': inventory(A['B']['IMPL_POST'] + A['implicit']), 'IMPL_POST': inventory(implicit),
    'AMPRENTA': A['B']['AMP'], 'TABLES': arr(tables), 'SECURITY_TABLES': arr(sorted(set(tables + extra_read))),
    'DROP_TABLES': '\n'.join(f'DROP TABLE public.{t};' for t in reversed(tables)),
    'DROP_FUNCTIONS_BEFORE_TABLES': '\n'.join(owned_drop(s) for s in reversed(signatures) if not s.startswith(('fn_izo_teren_imuabil(','fn_izo_decl_ceas('))),
    'DROP_GUARDS': '\n'.join(owned_drop(s) for s in signatures if s.startswith(('fn_izo_teren_imuabil(','fn_izo_decl_ceas('))),
    'REVOKE_FUNCTIONS': '\n'.join(f'REVOKE ALL ON FUNCTION public.{s} FROM PUBLIC,anon,authenticated,service_role;' for s in signatures),
}
def render(template):
    result = (SP / template).read_text(encoding='utf-8')
    for key,val in values.items():
        result = result.replace('@@'+key+'@@',val)
    assert '@@' not in result
    if template == 'e4b_tpl.sql':
        result = scope_function_acl(result)
    for tag in set(re.findall(r'\$[A-Za-z_]*\$',result)):
        assert result.count(tag) % 2 == 0, tag
    return result

if __name__ == '__main__':
    for tpl,dest in [('e4b_tpl.sql','supabase/migrations/20261109b_izometrie_e4b_teren.sql'),
                     ('e4b_rev_tpl.sql','supabase/revenire/20261109b_izometrie_e4b_teren_ROLLBACK.sql')]:
        (R/dest).write_text(render(tpl),encoding='utf-8',newline='\n')
    vectors = json.loads((R/'src/lib/izoSudura.cazuri.json').read_text(encoding='utf8'))['cazuri']
    sql_test = """-- GENERATED: shared izoSudura.cazuri.json vectors; local harness only.
BEGIN;
DO $test$
DECLARE v_c jsonb; v_r jsonb; v_key text; v_value jsonb; v_actual jsonb;
BEGIN
 FOR v_c IN SELECT value FROM jsonb_array_elements($vectori$""" + json.dumps(vectors,ensure_ascii=False) + """$vectori$::jsonb) LOOP
  v_r:=public.fn_izo_sudura_normalizeaza(v_c->>'in',v_c->'opt');
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_c->'asteptat') LOOP
   v_actual:=CASE WHEN v_key IN ('lot1','lot2') THEN to_jsonb((CASE WHEN v_key='lot1' THEN 'T' ELSE 'TR' END)||
    (v_r->>'tronson')||'S'||(v_r->>'nr')||(v_r->>'sufix')) ELSE v_r->v_key END;
   IF v_actual IS DISTINCT FROM v_value THEN RAISE EXCEPTION 'normalizare % %: % != %',v_c->>'in',v_key,v_actual,v_value; END IF;
  END LOOP;
 END LOOP;
END $test$;
ROLLBACK;
SELECT 'E4B_NORMALIZARE_TEST_END';
"""
    (R/'supabase/tests/izometrie_e4b_normalizare.test.sql').write_text(sql_test,encoding='utf8',newline='\n')
    print('E4b generated:',len(tables),'tables;',len(signatures),'functions')
