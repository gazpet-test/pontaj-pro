"""Fixed E4b privilege matrix, evaluated by gen_e4b (no catalog/network)."""
teren_owned = {'fn_izo_teren_intern','fn_izo_teren_push','fn_izo_teren_op','fn_izo_sudura_decl'}
writer_owned = set(internals) | {'fn_izo_birou_jurnal','fn_izo_sudura_aproba','fn_izo_capete_muta','fn_izo_taiere_miscare',
                               'fn_izo_tranzitie_intern','fn_izo_tranzitie_confirma','fn_izo_lot_efecte'}
shared_invoker = {'fn_izo_suduri_marcheaza','fn_izo_suduri_garda','fn_izo_sudura_ins','fn_izo_capat_ins',
                  'fn_izo_capat_modifica','fn_izo_sudura_stare','fn_izo_suduri_invalideaza',
                  'fn_izo_dependenti','fn_izo_taiere_ramura','fn_izo_corectie_mm','fn_izo_sudura_normalizeaza',
                  'fn_izo_teren_payload','fn_izo_decl_ceas','fn_izo_teren_imuabil'}
matrix_acl = ['GRANT CREATE ON SCHEMA public TO izo_teren_editor,izo_montaj_writer;']
for sig in signatures:
    name = sig.split('(')[0]
    role = 'izo_teren_editor' if name in teren_owned else 'izo_montaj_writer' if name in writer_owned | shared_invoker else None
    if role:
        matrix_acl.append(f'ALTER FUNCTION public.{sig} OWNER TO {role};')
matrix_acl.append('REVOKE CREATE ON SCHEMA public FROM izo_teren_editor,izo_montaj_writer;')

# Dependencies are derived from fixed source, never from an unrestricted catalog scan.
# Preserve only newly added EXECUTE grants for exact rollback of baseline functions.
role_dependencies = {}
for role,owned in [('izo_teren_editor',teren_owned),('izo_montaj_writer',writer_owned)]:
    refs = set(shared_invoker) | {'fn_izo_uid','fn_izo_citire','fn_izo_nivel'}
    for name in owned | shared_invoker:
        refs.update(re.findall(r'public\.(fn_izo_\w+)\(', src(block(api+schema, name))))
    role_dependencies[role] = refs
dependencies = set.union(*role_dependencies.values())
known = {s.split('(')[0]: s for s in signatures}
for file in sorted((R/'supabase/migrations').glob('*izometrie*.sql')):
    if file.name.startswith('20261109b'):
        continue
    for name,args in re.findall(r'CREATE (?:OR REPLACE )?FUNCTION public\.(fn_izo_\w+)\(([^)]*)\)',file.read_text(encoding='utf8')):
        if name not in dependencies or name in known:
            continue
        parts = [re.sub(r'\s+DEFAULT\s+.*$', '', re.sub(r'^p_\w+\s+', '', re.sub(r'^(?:VARIADIC|IN)\s+', '', p.strip(), flags=re.I)), flags=re.I) for p in args.split(',') if p.strip()]
        known[name] = name+'('+','.join(parts)+')'
missing = dependencies - known.keys()
assert not missing, missing
matrix_acl.append("v_meta:=v_meta||jsonb_build_object('e4b_execute_added','[]'::jsonb);")
for name in sorted(dependencies | shared_invoker):
    sig = known[name]
    for role in ('izo_teren_editor','izo_montaj_writer'):
        if name not in role_dependencies[role]: continue
        matrix_acl.append(f"IF NOT has_function_privilege('{role}','public.{sig}','EXECUTE') THEN "
                          f"v_meta:=jsonb_set(v_meta,'{{e4b_execute_added}}',(v_meta->'e4b_execute_added')||jsonb_build_array(jsonb_build_object('sig','public.{sig}','role','{role}')));")
        matrix_acl.append(f'GRANT EXECUTE ON FUNCTION public.{sig} TO {role}; END IF;')
matrix_acl += ['SET LOCAL ROLE izo_montaj_writer;',
              'GRANT EXECUTE ON FUNCTION public.fn_izo_tranzitie_confirma(bigint,text) TO authenticated;', 'RESET ROLE;']

columns = {}
for table,body in re.findall(r'CREATE TABLE public\.(\w+) \((.*?)\);', schema, re.S):
    columns[table] = re.findall(r'(?:^|,)\s*(\w+)\s+(?:bigint|integer|uuid|boolean|timestamptz|text|date|jsonb|numeric)\b', body)
assert len(columns)==len(tables)
teren_upd = {
 'izo_fronturi':'expira_la,predat_la,activ,server_ver', 'izo_dispozitive':'ultimul_seq,server_ver',
 'izo_preverificari':'stare,trimisa_la,trimisa_op_id,versiune,server_ver',
 'izo_declaratii':'versiune,ultimul_op_id,stare,conflict_cod,stare_inainte_blocare,blocata_motiv,identificare,bucata_id,bucata_decl_uid,sursa_bucata_id,sursa_decl_uid,depinde_de_uid,depinde_de_versiune,payload,gps_prezent,data_montaj,server_ver',
 'izo_bucati_declarate':'stare,declaratie_versiune,lungime_mm,lungime_calculata,capat_stanga,capat_dreapta,cod_bucata,destinatie,depozit_destinatie_id,server_ver',
 'izo_rezervari':'activa,eliberata_la,motiv_eliberare,expira_dupa,server_ver',
 'izo_suduri':'nr,sufix,executant,poanson,data_sudura,stare,server_ver', 'izo_suduri_capete':'activ,server_ver'}
writer_upd = {
 'izo_fronturi':'activ,predat_la,eliberat_de,eliberat_motiv,server_ver',
 'izo_preverificari':'stare,versiune,server_ver',
 'izo_declaratii':'stare,conflict_cod,stare_inainte_blocare,blocata_motiv,versiune,bucata_id,identificare,payload,aprobat_de,aprobat_de_angajat,decis_la,decizie_motiv,eveniment_ids,server_ver',
 'izo_bucati_declarate':'stare,bucata_id,depozit_destinatie_id,server_ver',
 'izo_rezervari':'activa,eliberata_la,motiv_eliberare,eveniment_id,server_ver',
 'izo_suduri':'stare,tranzitie_perete,tranzitie_confirmata_de,tranzitie_confirmata_la,tranzitie_confirmata_motiv,server_ver',
 'izo_suduri_capete':'activ,bucata_id,bucata_decl_uid,de_la_eveniment_id,server_ver'}
decision_cols = {'aprobat_de','aprobat_de_angajat','decis_la','decizie_motiv','eveniment_ids'}
for role,prefix,upd in [('izo_teren_editor','izo_teren',teren_upd),('izo_montaj_writer','izo_montaj',writer_upd)]:
    for table,cols in columns.items():
        if table=='izo_rata_apeluri' or role=='izo_teren_editor' and table=='izo_aprobari' or role=='izo_montaj_writer' and table=='izo_dispozitive': continue
        commands = []
        if table!='izo_declaratii_gps': commands.append('SELECT')
        inserts = table!='izo_aprobari' if role=='izo_teren_editor' else table in ('izo_operatii','izo_aprobari','izo_declaratii_versiuni','izo_rezervari','izo_suduri_capete')
        if inserts: commands.append('INSERT')
        if table in upd: commands.append('UPDATE')
        for cmd in commands:
            cs = [c for c in cols if c!='id' and not (role=='izo_teren_editor' and table=='izo_declaratii' and c in decision_cols)]
            projection = '('+(','.join(cs) if cmd=='INSERT' else upd[table])+')' if cmd!='SELECT' else ''
            matrix_acl.append(f'GRANT {cmd}{projection} ON public.{table} TO {role};')
            pn = prefix+'_'+table.removeprefix('izo_')+'_'+{'SELECT':'sel','INSERT':'ins','UPDATE':'upd'}[cmd]
            expr = 'true' if table=='izo_dispozitive' else 'declaratie_id IS NOT NULL' if table in ('izo_declaratii_versiuni','izo_declaratii_gps','izo_bucati_declarate') else 'sudura_id IS NOT NULL' if table=='izo_suduri_capete' else 'proiect_id IS NOT NULL'
            if table=='izo_dispozitive': expr='profile_id IS NOT NULL'
            if table=='izo_operatii' and cmd=='INSERT': expr="canal='teren' AND autor_profile_id IS NOT NULL" if role=='izo_teren_editor' else "canal IN ('aprobare','depozit','pachet')"
            if not any('CREATE POLICY '+pn+' ' in s for s in security):
                tail = f'USING ({expr})' if cmd=='SELECT' else f'WITH CHECK ({expr})' if cmd=='INSERT' else f'USING ({expr}) WITH CHECK ({expr})'
                matrix_acl.append(f'CREATE POLICY {pn} ON public.{table} FOR {cmd} TO {role} {tail};')
        if inserts and 'id' in cols:
            matrix_acl.append(f'GRANT USAGE ON SEQUENCE public.{table}_id_seq TO {role};')
matrix_acl.append('GRANT USAGE ON SEQUENCE public.izo_server_ver_seq TO izo_teren_editor;')
extra_read = ['magazie_bucati','izo_tronson_config','executie_proiecte','executie_tronsoane','logistica_depozite',
              'magazie_bucati_evenimente','magazie_bucati_miscari']  # teren: verificarea data_inainte_iesire (livrare)
matrix_acl.append("v_meta:=v_meta||jsonb_build_object('e4b_select_added','[]'::jsonb);")
for table in extra_read:
    for role in ('izo_teren_editor','izo_montaj_writer'):
        matrix_acl.append(f"IF NOT has_table_privilege('{role}','public.{table}','SELECT') THEN "
                          f"v_meta:=jsonb_set(v_meta,'{{e4b_select_added}}',(v_meta->'e4b_select_added')||jsonb_build_array(jsonb_build_object('table','public.{table}','role','{role}')));")
        matrix_acl.append(f'GRANT SELECT ON public.{table} TO {role}; END IF;')
        # Existing E4a writer policies on registry/config must be retained, not duplicated.
        if role=='izo_montaj_writer' and table in ('magazie_bucati','izo_tronson_config','magazie_bucati_evenimente','magazie_bucati_miscari'): continue
        name='e4b_'+table+'_'+role+'_sel'
        idcol = 'tronson_id' if table=='izo_tronson_config' else 'id'
        matrix_acl.append(f'CREATE POLICY {name} ON public.{table} FOR SELECT TO {role} USING ({idcol} IS NOT NULL);')
for table in ('izo_suduri','izo_suduri_capete'):
    matrix_acl += [f'CREATE TRIGGER a0_izo_suduri_proiectie BEFORE INSERT OR UPDATE ON public.{table} FOR EACH ROW EXECUTE FUNCTION public.fn_izo_suduri_garda();',
                   f'ALTER TABLE public.{table} ENABLE ALWAYS TRIGGER a0_izo_suduri_proiectie;']
    implicit.append(f'trigger|a0_izo_suduri_proiectie on public.{table}|public.fn_izo_suduri_garda()')
matrix_rollback = []
for table in extra_read:
    for role in ('izo_teren_editor','izo_montaj_writer'):
        if role=='izo_montaj_writer' and table in ('magazie_bucati','izo_tronson_config','magazie_bucati_evenimente','magazie_bucati_miscari'): continue
        matrix_rollback.append(f'DROP POLICY e4b_{table}_{role}_sel ON public.{table};')
matrix_rollback += ["FOR v_grant IN SELECT value FROM jsonb_array_elements(v_meta->'e4b_execute_added') LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I',v_grant->>'sig',v_grant->>'role'); END LOOP;",
                    "FOR v_grant IN SELECT value FROM jsonb_array_elements(v_meta->'e4b_select_added') LOOP EXECUTE format('REVOKE SELECT ON TABLE %s FROM %I',v_grant->>'table',v_grant->>'role'); END LOOP;",
                    'REVOKE USAGE ON SEQUENCE public.izo_server_ver_seq FROM izo_teren_editor;']

matrix_acl += ['GRANT EXECUTE ON FUNCTION public.fn_izo_teren_praguri(bigint),public.fn_izo_fisa_verifica(bigint) TO authenticated;']

new_e4_gate = new_e4_gate.replace("'public.izo_rezervari_id_seq'::regclass", "'public.izo_rezervari_id_seq'::regclass,'public.izo_operatii_id_seq'::regclass,'public.izo_aprobari_id_seq'::regclass,'public.izo_suduri_capete_id_seq'::regclass")
