"""E4b-1 generator. Read-only E4a baseline; no database or network."""
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
          'izo_declaratii_versiuni', 'izo_declaratii_gps', 'izo_sync_incercari', 'izo_rata_apeluri']
journals = ['izo_operatii', 'izo_declaratii_versiuni', 'izo_sync_incercari', 'izo_declaratii_gps']
schema = (SP / 'e4b_schema_tpl.sql').read_text(encoding='utf-8').replace('CREATE FUNCTION public.', '  CREATE FUNCTION public.')
api = (SP / 'e4b_api_tpl.sql').read_text(encoding='utf-8').replace('CREATE FUNCTION public.', '  CREATE FUNCTION public.')
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
        security.append(f'GRANT SELECT{("("+cols+")") if cols else ""} ON public.{table} TO authenticated;')
        expr = 'auth.uid() IS NOT NULL AND public.fn_izo_citire(proiect_id)'
        if table == 'izo_dispozitive':
            expr = 'auth.uid() IS NOT NULL AND profile_id=auth.uid()'
        if table in ('izo_bucati_declarate', 'izo_declaratii_versiuni'):
            expr = f'auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.id={table}.declaratie_id)'
        security.append(f'CREATE POLICY {table}_api_sel ON public.{table} FOR SELECT TO authenticated USING ({expr});')
        if table not in ('izo_bucati_declarate', 'izo_declaratii_versiuni', 'izo_dispozitive'):
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

old = block(baseline, 'fn_izo_porti_lipsa')
anchor = '    RETURN v;\n  END $f$;'
assert old.count(anchor) == 1
new = old.replace(anchor, '    v := v || public.fn_izo_porti_e4b_lipsa();\n' + anchor)
def inventory(xs):
    return 'v_impl := %s; IF v_impl IS DISTINCT FROM %s THEN RAISE EXCEPTION \'E4b inventar implicit: %%\',v_impl; END IF;' % (A['B']['const']['IMPL_EXPR'], arr(sorted(xs)))

functions = re.findall(r'CREATE FUNCTION public\.(fn_izo_\w+)\(([^)]*)\)', schema + '\n' + api)
# Explicit signatures: parameter declarations -> types. No catalog capture during apply.
signatures = [name + '(' + ','.join(re.sub(r'^p_\w+\s+', '', p.strip()) for p in args.split(',') if p.strip()) + ')' for name,args in functions]
values = {
    'SCHEMA': schema, 'API': api, 'SECURITY': '\n'.join(security),
    'PORTI_NEW': new, 'PORTI_OLD': old,
    'OLD_MD5': q(hashlib.md5(src(old).encode()).hexdigest()),
    'IMPL_PRE': inventory(A['B']['IMPL_POST'] + A['implicit']), 'IMPL_POST': inventory(implicit),
    'AMPRENTA': A['B']['AMP'], 'TABLES': arr(tables),
    'DROP_TABLES': '\n'.join(f'DROP TABLE public.{t};' for t in reversed(tables)),
    'DROP_FUNCTIONS_BEFORE_TABLES': '\n'.join(f'DROP FUNCTION public.{s};' for s in reversed(signatures) if not s.startswith('fn_izo_teren_imuabil(')),
    'REVOKE_FUNCTIONS': '\n'.join(f'REVOKE ALL ON FUNCTION public.{s} FROM PUBLIC,anon,authenticated,service_role;' for s in signatures),
}
def render(template):
    result = (SP / template).read_text(encoding='utf-8')
    for key,val in values.items():
        result = result.replace('@@'+key+'@@',val)
    assert '@@' not in result
    for tag in set(re.findall(r'\$[A-Za-z_]*\$',result)):
        assert result.count(tag) % 2 == 0, tag
    return result

if __name__ == '__main__':
    for tpl,dest in [('e4b_tpl.sql','supabase/migrations/20261109b_izometrie_e4b_teren.sql'),
                     ('e4b_rev_tpl.sql','supabase/revenire/20261109b_izometrie_e4b_teren_ROLLBACK.sql')]:
        (R/dest).write_text(render(tpl),encoding='utf-8',newline='\n')
    print('E4b generated:',len(tables),'tables;',len(signatures),'functions')
