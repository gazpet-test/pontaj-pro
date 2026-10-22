"""E4: teste independente de generatorul migrarii; nu acceseaza BD."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Refolosim numai preambulul/fixture-ul E3, fara a executa generarea iesirii E3.
source = ROOT / 'scripts/izometrie/e3b_build_garzi.py'
shared = {'__file__': str(source)}
exec(compile(source.read_text(encoding='utf-8').split('\nguards =', 1)[0], str(source), 'exec'), shared)
fixture, helpers, api, reset, jwt, quote, payload = (
    shared[k] for k in ('fixture', 'helpers', 'api', 'reset', 'jwt', 'quote', 'payload'))
parts = []

def block(label, body, imported=True):
    parts.append('-- ' + label + (fixture() if imported else '\nBEGIN;\n' + helpers)
        + "\nDO $baseline$ BEGIN IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'E4 baseline: poarta trebuie verde inaintea probei'; END IF; END $baseline$;\n"
        + body + '\nROLLBACK;\n')

# §9.13: niciun obiect de proba nu este pastrat intre mutatii.
mutations = [
    ('ENABLE simplu', 'ALTER TABLE public.izo_corectii ENABLE TRIGGER trg_izo_cor_garda;'),
    ('index deschisa', 'DROP INDEX public.ux_izo_cor_deschisa;'),
    ('politica slabita', 'ALTER POLICY magbuc_izo_corectie_sel ON public.magazie_bucati USING (true);'),
    ('membership', 'GRANT izo_cor_editor TO service_role;'),
    ('corp helper', "DO $mut$ DECLARE v_def text; BEGIN SELECT pg_get_functiondef('public.fn_izo_cor_chei(text,text,text)'::regprocedure) INTO v_def; EXECUTE replace(v_def,'AS $function$',E'AS $function$\\n-- E4 corp schimbat\\n'); END $mut$;"),
    ('ACL helper', 'GRANT EXECUTE ON FUNCTION public.fn_izo_cor_chei(text,text,text) TO service_role;'),
    ('config helper', "ALTER FUNCTION public.fn_izo_cor_chei(text,text,text) SET search_path TO public;"),
    ('capcana wrapper', "CREATE FUNCTION public.fn_izo_import_storno_x() RETURNS void LANGUAGE plpgsql AS $trap$ BEGIN NULL; END $trap$; CREATE FUNCTION teste.e4_trap() RETURNS void LANGUAGE sql AS $caller$ SELECT public.fn_izo_import_storno_x() $caller$; DO $wrapper$ BEGIN IF NOT EXISTS(SELECT 1 FROM unnest(public.fn_izo_porti_lipsa()) x WHERE x LIKE '%wrapper nerevizuit%') THEN RAISE EXCEPTION 'E4 capcana nu este raportata ca wrapper nerevizuit'; END IF; END $wrapper$;"),
]
for label, mutation in mutations:
    body = mutation + r"""
DO $gate$ BEGIN
 IF coalesce(cardinality(public.fn_izo_porti_lipsa()),0)=0 THEN RAISE EXCEPTION 'E4 mutatie nedetectata'; END IF;
END $gate$;
""" + api + jwt('121') + r"""
SELECT teste.e3_refuz('SELECT public.fn_izo_cor_propune(''camp'',3,1,''{"perete_mm":9}'',''E4 poarta'')','42501','E3b: porți incomplete%');
SELECT teste.e3_refuz('SELECT public.fn_izo_doc_salveaza(NULL,NULL,''{}'',''[]'',NULL)','42501','izo E3: porțile registrului nu sunt complete:%');
""" + reset + r"""
SELECT set_config('request.jwt.claims','{}',true);
SELECT teste.e3_refuz('SELECT public.fn_izo_cor_storno_import(3,''E4'',ARRAY[1::bigint],''E4 poarta'',''00000000-0000-0000-0000-000000000121'')','42501','E3b: porți incomplete%');
SELECT teste.e3_refuz('SELECT public.fn_izo_seteaza_nivel(3,''stoc'',''E4 poarta'')','P0001','izo: activarea stoc refuzată — porți lipsă sau modificate:%');
SELECT teste.e3_refuz('SELECT public.fn_izo_activeaza_si_importa(3,''E4'',''{"surse":[],"bucati":[]}'',''E4 poarta'')','P0001','izo: activarea stoc refuzată — porți lipsă sau modificate:%');
SELECT teste.e3_refuz('SELECT public.fn_izo_import_storno(3,''E4'',''E4 poarta'')','42501','E3b: porti incomplete');
SELECT teste.e3_refuz('SELECT public.fn_izo_import_sold_initial(3,''E4'',''{}'')','42501','E3b: porti incomplete');
"""
    block('§9.13 ' + label, body, imported=False)

# §3.5/9.12: asteptari scrise din design, nu din MATRICE a generatorului.
block('§9.12 matrice completa pe coloane, tabele, secvente si helpere', r"""
DO $priv$
DECLARE v_role text; v_t text; v_p text; v_a record; v_expected boolean; v_cols text[]; v_actual text[];
 v_prop text[]:=ARRAY['proiect_id','tip','bucata_id','document_intrare_id','inainte','dupa','ncr_ref','motiv','stare','versiune','cale','propus_de','propus_rol','propus_la'];
 v_dec text[]:=ARRAY['stare','versiune','decis_de','decis_rol','decis_la'];
BEGIN
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','izo_cor_editor','izo_corectie_writer','izo_doc_editor'] LOOP
  FOREACH v_t IN ARRAY ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric'] LOOP
   FOREACH v_p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    v_cols:='{}';
    IF v_p='SELECT' AND (v_role='authenticated' OR (v_role IN ('izo_cor_editor','izo_corectie_writer') AND v_t<>'izo_documente_istoric') OR (v_role='izo_doc_editor' AND v_t='izo_documente_istoric')) THEN
      SELECT array_agg(attname::text) INTO v_cols FROM pg_attribute WHERE attrelid=('public.'||v_t)::regclass AND attnum>0 AND NOT attisdropped;
    ELSIF v_p='INSERT' AND v_t='izo_corectii' AND v_role IN ('izo_cor_editor','izo_corectie_writer') THEN
      v_cols:=v_prop || (CASE WHEN v_role='izo_corectie_writer' THEN ARRAY['import_id'] ELSE '{}'::text[] END);
    ELSIF v_p='UPDATE' AND v_t='izo_corectii' AND v_role IN ('izo_cor_editor','izo_corectie_writer') THEN
      v_cols:=v_dec || (CASE WHEN v_role='izo_cor_editor' THEN ARRAY['motiv_decizie'] ELSE ARRAY['eveniment_id','bucata_id'] END);
    ELSIF v_p='INSERT' AND v_t='izo_corectii_bucati' AND v_role='izo_corectie_writer' THEN v_cols:=ARRAY['corectie_id','bucata_id'];
    ELSIF v_p='INSERT' AND v_t='izo_documente_istoric' AND v_role='izo_doc_editor' THEN
      v_cols:=ARRAY['document_id','versiune','salvat_de','salvat_rol','salvat_la','continut','hash','diff','baza'];
    END IF;
    FOR v_a IN SELECT attname::text AS n FROM pg_attribute WHERE attrelid=('public.'||v_t)::regclass AND attnum>0 AND NOT attisdropped LOOP
      v_expected:=v_a.n=ANY(v_cols);
      IF has_column_privilege(v_role,'public.'||v_t,v_a.n,v_p) IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'E4 ACL % %.% % asteptat %',v_role,v_t,v_a.n,v_p,v_expected; END IF;
    END LOOP;
   END LOOP;
   FOREACH v_p IN ARRAY ARRAY['DELETE','TRUNCATE','TRIGGER'] LOOP
    IF has_table_privilege(v_role,'public.'||v_t,v_p) THEN RAISE EXCEPTION 'E4 ACL surplus % % %',v_role,v_t,v_p; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 FOREACH v_t IN ARRAY ARRAY['izo_proiect_config','izo_importuri','izo_atribuiri'] LOOP
  FOR v_a IN SELECT attname::text AS n FROM pg_attribute WHERE attrelid=('public.'||v_t)::regclass AND attnum>0 AND NOT attisdropped LOOP
   FOREACH v_p IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
    IF has_column_privilege('izo_corectie_writer','public.'||v_t,v_a.n,v_p) THEN RAISE EXCEPTION 'E4 writer scrie %.%',v_t,v_a.n; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY['izo_cor_editor','izo_corectie_writer'] LOOP
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname),'{}') INTO v_actual
   FROM (SELECT c0.oid, c0.relname FROM pg_class c0 WHERE c0.relkind='S' AND c0.relnamespace='public'::regnamespace OFFSET 0) c WHERE has_sequence_privilege(v_role,c.oid,'USAGE');
  v_cols:=(CASE WHEN v_role='izo_corectie_writer' THEN ARRAY['izo_server_ver_seq','magazie_bucati_evenimente_id_seq','magazie_bucati_id_seq','magazie_bucati_miscari_id_seq'] ELSE '{}'::text[] END);
  IF v_actual IS DISTINCT FROM v_cols THEN RAISE EXCEPTION 'E4 secvente %: % != %',v_role,v_actual,v_cols; END IF;
 END LOOP;
 FOREACH v_t IN ARRAY ARRAY['magazie_bucati','izo_documente_intrare'] LOOP
  FOR v_a IN SELECT attname::text AS n FROM pg_attribute WHERE attrelid=('public.'||v_t)::regclass AND attnum>0 AND NOT attisdropped LOOP
   IF has_column_privilege('izo_cor_editor','public.'||v_t,v_a.n,'UPDATE') THEN RAISE EXCEPTION 'E4 editor are UPDATE %.%',v_t,v_a.n; END IF;
  END LOOP;
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','izo_cor_editor','izo_corectie_writer','izo_doc_editor','izo_registru_writer','izo_receptie_writer'] LOOP
  IF has_function_privilege(v_role,'public.fn_izo_lant_blocant(bigint[],bigint[])','EXECUTE') IS DISTINCT FROM (v_role=ANY(ARRAY['izo_corectie_writer','izo_registru_writer','izo_receptie_writer'])) THEN RAISE EXCEPTION 'E4 lant EXECUTE %',v_role; END IF;
  IF has_function_privilege(v_role,'public.fn_izo_cor_deschise(bigint[])','EXECUTE') IS DISTINCT FROM (v_role=ANY(ARRAY['izo_registru_writer','izo_receptie_writer'])) THEN RAISE EXCEPTION 'E4 deschise EXECUTE %',v_role; END IF;
 END LOOP;
END $priv$;
""", imported=False)

block('§9.11 diff scan adaugat/scos, renumerotare', r"""
DO $diff$ DECLARE v_d jsonb; BEGIN
 v_d:=public.fn_izo_doc_diff(
 '{"antet":{},"aviz":{},"lista":{},"totaluri":{},"randuri":[{"nr_crt":1,"serie":"A"}],"scanuri":[{"cale":"vechi.pdf","sha256_pdf":"a"}]}',
 '{"antet":{},"aviz":{},"lista":{},"totaluri":{},"randuri":[{"nr_crt":2,"serie":"A"}],"scanuri":[{"cale":"nou.pdf","sha256_pdf":"b"}]}');
 IF v_d#>'{scanuri,adaugate}' IS DISTINCT FROM '[{"cale":"nou.pdf","sha256_pdf":"b"}]'::jsonb
 OR v_d#>'{scanuri,scoase}' IS DISTINCT FROM '[{"cale":"vechi.pdf","sha256_pdf":"a"}]'::jsonb
 OR v_d#>'{scanuri,modificate}' IS DISTINCT FROM '{}'::jsonb
 OR v_d#>'{randuri,adaugate}' IS DISTINCT FROM '[{"nr_crt":2,"serie":"A"}]'::jsonb
 OR v_d#>'{randuri,sterse}' IS DISTINCT FROM '[{"nr_crt":1,"serie":"A"}]'::jsonb
 OR v_d#>'{randuri,modificate}' IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'E4 diff %',v_d; END IF;
END $diff$;
""", imported=False)

create_doc = r"""
DO $doc$ DECLARE v_r jsonb; BEGIN
 v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
 '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"E4 fixture","nr_document":"E4-DOC","data_document":"2026-10-22","total_m":12}',
 '[{"nr_crt":1,"serie":"E4-DOC-1","sarja":"E4-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
 PERFORM set_config('test.e4_doc',v_r->>'document_id',true);
END $doc$;
"""
confirm_doc = r"""
DO $confirm$ DECLARE v_r jsonb; BEGIN
 v_r:=public.fn_izo_doc_verifica(current_setting('test.e4_doc')::bigint);
 PERFORM public.fn_izo_doc_confirma(current_setting('test.e4_doc')::bigint,(v_r->>'versiune')::bigint,v_r->>'hash');
 PERFORM set_config('izo.receptie_ctx','',true);
END $confirm$;
"""

block('§9.11 istoric API, imutabilitate, anulare draft', api + jwt('030') + create_doc + r"""
SELECT teste.e3_refuz(format('INSERT INTO public.izo_documente_istoric(document_id,versiune,salvat_de,salvat_rol,continut,hash,diff,baza) VALUES(%s,1,''00000000-0000-0000-0000-000000000030'',''authenticator'',''{}'',''fals'',''{}'',true)',current_setting('test.e4_doc')),'42501','permission denied%');
""" + reset + r"""
SELECT teste.e3_refuz(format('DELETE FROM public.izo_documente_istoric WHERE document_id=%s',current_setting('test.e4_doc')),'42501','E3b: istoric imutabil');
SELECT teste.e3_refuz('TRUNCATE public.izo_documente_istoric','42501','E3b: istoric imutabil');
SELECT set_config('test.e4_hist',(SELECT jsonb_agg(to_jsonb(h) ORDER BY versiune)::text FROM public.izo_documente_istoric h WHERE document_id=current_setting('test.e4_doc')::bigint),true);
""" + api + jwt('030') + r"""
SELECT public.fn_izo_doc_anuleaza_draft(current_setting('test.e4_doc')::bigint,1,'E4 anulare draft');
""" + reset + r"""
DO $hist$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(h) ORDER BY versiune) FROM public.izo_documente_istoric h WHERE document_id=current_setting('test.e4_doc')::bigint) IS DISTINCT FROM current_setting('test.e4_hist')::jsonb THEN RAISE EXCEPTION 'E4 anulare draft a scris istoric'; END IF;
 IF (SELECT stare FROM public.izo_documente_intrare WHERE id=current_setting('test.e4_doc')::bigint) IS DISTINCT FROM 'anulat' THEN RAISE EXCEPTION 'E4 draft neanulat'; END IF;
END $hist$;
""")

block('§9.11 hash_confirmat = ultima intrare', api + jwt('030') + create_doc + r"""
SELECT public.fn_izo_doc_salveaza(current_setting('test.e4_doc')::bigint,1,
 '{"furnizor":"E4 fixture","nr_document":"E4-DOC","data_document":"2026-10-22","total_m":12,"observatii":"a doua salvare"}',
 '[{"nr_crt":1,"serie":"E4-DOC-1","sarja":"E4-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
""" + confirm_doc + reset + r"""
DO $hash$ DECLARE v_d public.izo_documente_intrare; v_h public.izo_documente_istoric; BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_documente_intrare WHERE id=current_setting('test.e4_doc')::bigint;
 SELECT * INTO STRICT v_h FROM public.izo_documente_istoric WHERE document_id=v_d.id ORDER BY versiune DESC LIMIT 1;
 IF v_d.stare<>'confirmat' OR v_h.versiune<>2 OR v_d.hash_confirmat IS DISTINCT FROM v_h.hash
 OR v_h.hash IS DISTINCT FROM 'e3-doc-v1:'||encode(sha256(convert_to(v_h.continut::text,'UTF8')),'hex')
 OR (SELECT count(*) FROM public.izo_documente_istoric WHERE document_id=v_d.id)<>2 THEN RAISE EXCEPTION 'E4 hash confirmat/istoric'; END IF;
END $hash$;
""")

block('§9.17 reaprobare alta versiune / alta persoana', api + jwt('030') + r"""
SELECT set_config('test.e4_cor',(teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"E4"}'',''E4 reaprobare'')',current_setting('test.e3_b')))->>'corectie_id'),true);
""" + jwt('121') + r"""
SELECT teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e4_cor')));
SELECT teste.e3_refuz(format('SELECT teste.e3_rpc(''SELECT public.fn_izo_cor_aproba(%s,2)'')',current_setting('test.e4_cor')),'40001','E3b: corecția s-a schimbat%');
""" + reset + r"""
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-000000000117','manager_aprobator',NULL,'test','E4 alt aprobator');
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES('00000000-0000-0000-0000-000000000117','magazie','editor') ON CONFLICT(profile_id,module) DO UPDATE SET access_level='editor';
SELECT set_config('test.e4_before',(SELECT jsonb_build_object('c',to_jsonb(c),'b',(SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE b.id=c.bucata_id),'events',(SELECT count(*) FROM public.magazie_bucati_evenimente),'moves',(SELECT count(*) FROM public.magazie_bucati_miscari))::text FROM public.izo_corectii c WHERE c.id=current_setting('test.e4_cor')::bigint),true);
""" + api + jwt('117') + r"""
SELECT teste.e3_refuz(format('SELECT teste.e3_rpc(''SELECT public.fn_izo_cor_aproba(%s,1)'')',current_setting('test.e4_cor')),'42501','E3b: retry permis numai decidentului');
""" + jwt('121') + r"""
DO $retry$ DECLARE v_r jsonb; BEGIN
 v_r:=teste.e3_rpc(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e4_cor')));
 IF v_r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'E4 retry ne-idempotent'; END IF;
END $retry$;
""" + reset + r"""
DO $unchanged$ BEGIN
 IF (SELECT jsonb_build_object('c',to_jsonb(c),'b',(SELECT to_jsonb(b) FROM public.magazie_bucati b WHERE b.id=c.bucata_id),'events',(SELECT count(*) FROM public.magazie_bucati_evenimente),'moves',(SELECT count(*) FROM public.magazie_bucati_miscari)) FROM public.izo_corectii c WHERE c.id=current_setting('test.e4_cor')::bigint) IS DISTINCT FROM current_setting('test.e4_before')::jsonb THEN RAISE EXCEPTION 'E4 retry a scris'; END IF;
END $unchanged$;
""")

block('§9.8 PV corectat, vechiul RPC, anulare, document anulat', api + jwt('030') + create_doc + confirm_doc + r"""
SELECT public.fn_izo_doc_pv(current_setting('test.e4_doc')::bigint,2,'E4-PV','2026-10-22');
SELECT set_config('izo.receptie_ctx','',true);
""" + reset + r"""
SELECT set_config('test.e4_pv',(SELECT to_jsonb(e)::text FROM public.magazie_bucati_evenimente e JOIN public.izo_documente_intrare d ON d.eveniment_pv_id=e.id WHERE d.id=current_setting('test.e4_doc')::bigint),true);
SELECT set_config('test.e4_pieces',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)::text FROM public.magazie_bucati b WHERE aviz_intrare_id=current_setting('test.e4_doc')::bigint),true);
""" + api + jwt('121') + r"""
DO $finite$ DECLARE v_data text; BEGIN
 FOREACH v_data IN ARRAY ARRAY['infinity','-infinity'] LOOP
  PERFORM teste.e3_refuz(format('SELECT teste.e3_rpc(%L)',format('SELECT public.fn_izo_cor_pv(%s,3,%L,%L,%L)',current_setting('test.e4_doc'),'E4-PV-NOU',v_data,'F1 data infinita')),'22023','E3b: PV invalid');
 END LOOP;
END $finite$;
SELECT teste.e3_rpc(format('SELECT public.fn_izo_cor_pv(%s,3,''E4-PV-NOU'',''2026-10-23'',''E4 corectie PV'')',current_setting('test.e4_doc')));
SELECT teste.e3_refuz(format('SELECT public.fn_izo_doc_pv(%s,4,''E4-PV'',''2026-10-22'')',current_setting('test.e4_doc')),'23505','%PV%');
""" + reset + r"""
DO $pv$ BEGIN
 IF (SELECT to_jsonb(e) FROM public.magazie_bucati_evenimente e JOIN public.izo_documente_intrare d ON d.eveniment_pv_id=e.id WHERE d.id=current_setting('test.e4_doc')::bigint) IS DISTINCT FROM current_setting('test.e4_pv')::jsonb
 OR (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.magazie_bucati b WHERE aviz_intrare_id=current_setting('test.e4_doc')::bigint) IS DISTINCT FROM current_setting('test.e4_pieces')::jsonb
 OR EXISTS(SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.izo_corectii c ON c.eveniment_id=m.eveniment_id WHERE c.document_intrare_id=current_setting('test.e4_doc')::bigint AND c.tip='pv') THEN RAISE EXCEPTION 'E4 PV a rescris receptia/bucatile'; END IF;
END $pv$;
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.fn_izo_doc_anuleaza(current_setting('test.e4_doc')::bigint,'E4 anulare dupa corectie PV','00000000-0000-0000-0000-000000000121');
SELECT set_config('izo.receptie_ctx','',true);
""" + api + jwt('121') + r"""
SELECT set_config('izo.corectie_ctx','',true);
SELECT teste.e3_refuz(format('SELECT public.fn_izo_cor_pv(%s,(SELECT versiune FROM public.izo_documente_intrare WHERE id=%s),%L,%L,%L)',current_setting('test.e4_doc'),current_setting('test.e4_doc'),'E4-PV-ALT','2026-10-24','E4 anulat'),'22023','E3b: document neconfirmat sau fara PV');
""" + reset)

# §9.16: date invalide, fara a modifica un obiect pazit sau corpul RPC-ului.
# Trei puncte ale pipeline-ului real writer; CHECK pe un domeniu auxiliar.
for stage in (1, 2, 3):
    body = r"""
CREATE DOMAIN teste.e4_positive AS integer CHECK (VALUE>0);
DO $green$ BEGIN IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'E4 injection a change la poarta'; END IF; END $green$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SET LOCAL ROLE izo_cor_editor;
INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
 VALUES(3,'camp',current_setting('test.e3_b')::bigint,NULL,'{"serie":"E4-ATOMIC"}','E4 atom propusa','00000000-0000-0000-0000-000000000030');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"authenticated"}',true);
SELECT set_config('test.e4_atom_before',jsonb_build_object(
 'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.izo_corectii c),
 'b',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.magazie_bucati b),
 'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.magazie_bucati_evenimente e),
 'm',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.magazie_bucati_miscari m))::text,true);
SET LOCAL ROLE izo_corectie_writer;
DO $atom$ DECLARE v_c public.izo_corectii; v_b public.magazie_bucati; v_j jsonb; v_direct boolean; v_constraint text; BEGIN
 FOREACH v_direct IN ARRAY ARRAY[false,true] LOOP
  BEGIN
   IF v_direct THEN
    INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,propus_de)
     VALUES(3,'camp',current_setting('test.e3_b2')::bigint,NULL,'{"perete_mm":9}','E4 atom directa','00000000-0000-0000-0000-000000000121') RETURNING * INTO v_c;
   ELSE SELECT * INTO STRICT v_c FROM public.izo_corectii WHERE motiv='E4 atom propusa'; END IF;
   SELECT * INTO STRICT v_b FROM public.magazie_bucati WHERE id=v_c.bucata_id;
   PERFORM public.fn_izo_cor_marcheaza(v_c.id);
   PERFORM teste.e3_ev(v_c.id);
   IF @@STAGE@@>=2 THEN PERFORM teste.e3_mis(v_c.id,v_b.id); END IF;
   IF @@STAGE@@>=3 THEN
    v_j:=public.fn_izo_cor_bucata_dupa(v_c,v_b)||jsonb_build_object('server_ver',nextval('public.izo_server_ver_seq'));
    UPDATE public.magazie_bucati SET serie=v_j->>'serie',perete_mm=(v_j->>'perete_mm')::numeric,
      server_ver=(v_j->>'server_ver')::bigint,updated_at=now() WHERE id=v_b.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'E4 atom UPDATE absent'; END IF;
   END IF;
   -- Nu prindem erori din operatiile anterioare; cerem CHECK-ul injectat exact.
   PERFORM (-1)::teste.e4_positive;
   RAISE EXCEPTION 'E4 CHECK nu a refuzat';
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
   IF v_constraint<>'e4_positive_check' THEN RAISE; END IF;
  END;
 END LOOP;
END $atom$;
RESET ROLE;
DO $atomic_result$ BEGIN
 IF jsonb_build_object(
 'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.izo_corectii c),
 'b',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.magazie_bucati b),
 'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.magazie_bucati_evenimente e),
 'm',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.magazie_bucati_miscari m)) IS DISTINCT FROM current_setting('test.e4_atom_before')::jsonb THEN RAISE EXCEPTION 'E4 efecte dupa esec injectat'; END IF;
END $atomic_result$;
""".replace('@@STAGE@@', str(stage))
    block('§9.16 atomicitate dupa etapa ' + str(stage), body)

block('§9.9 partial: bucata document / deja anulata', api + jwt('030') + create_doc + confirm_doc + reset + r"""
SELECT set_config('request.jwt.claims','{}',true);
SELECT teste.e3_refuz(format('SELECT public.fn_izo_cor_storno_import(3,''E3-import'',ARRAY[%s::bigint],''E4 origine document'',''00000000-0000-0000-0000-000000000121'')',(SELECT id FROM public.magazie_bucati WHERE aviz_intrare_id=current_setting('test.e4_doc')::bigint)),'22023','E3b: bucati neeligibile%');
SELECT public.fn_izo_cor_storno_import(3,'E3-import',ARRAY[current_setting('test.e3_b')::bigint],'E4 prima anulare','00000000-0000-0000-0000-000000000121');
SELECT set_config('izo.corectie_ctx','',true);
SELECT teste.e3_refuz(format('SELECT public.fn_izo_cor_storno_import(3,''E3-import'',ARRAY[%s::bigint],''E4 dubla anulare'',''00000000-0000-0000-0000-000000000121'')',current_setting('test.e3_b')),'22023','E3b: bucati neeligibile%');
DO $partial$ BEGIN
 IF (SELECT count(*) FROM public.izo_corectii WHERE tip='storno_import')<>1
 OR (SELECT stare FROM public.izo_importuri WHERE proiect_id=3 AND import_id='E3-import')<>'aplicat'
 OR (SELECT count(*) FROM public.magazie_bucati_miscari WHERE bucata_id=current_setting('test.e3_b')::bigint AND rol='anulat')<>1 THEN RAISE EXCEPTION 'E4 partial a lasat duplicate'; END IF;
END $partial$;
""")

# Import suplimentar intr-un bloc nou, fara import in fixture-ul acestui bloc.
# Originea/anularea sunt construite ca in E3-ALT-1; testul partial de mai sus
# probeaza separat RPC-ul real. Nu se pretinde o continuitate peste ROLLBACK.
foreign_piece = fixture().split('-- bucata E3-ALT-1', 1)[1].split('INSERT INTO public.izo_atribuiri', 1)[0]
# Coliziunea seriei este globala. Folosim alt proiect pentru fixture-ul sintetic:
# garda registrului ia un advisory xact lock, iar E2a refuza importul daca
# tranzactia tine deja lock-ul proiectului DESTINATIE (lectia E3 #1).
foreign_piece = foreign_piece.replace("_seq'),3,1,'teava'", "_seq'),2,1,'teava'").replace("'depozit',6,11,'manual'", "'depozit',9,4,'manual'")
foreign_piece = foreign_piece.replace('DO $alt$', "INSERT INTO public.izo_proiect_config(proiect_id,nivel_izo,server_ver) VALUES(2,'stoc',nextval('public.izo_server_ver_seq'));\nDO $alt$", 1)
block('§9.9 serie eliberata: import suplimentar intr-o tranzactie curata',
    "-- bucata E3-ALT-1" + foreign_piece + r"""
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E3-ALT-1';
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SELECT set_config('request.jwt.claims','{}',true);
""" + "SELECT public.fn_izo_activeaza_si_importa(3,'E4-suplimentar'," + quote(payload('E3-ALT', 1)) + "::jsonb,'E4 serie eliberata');\n" + r"""
DO $freed$ BEGIN
 IF (SELECT count(*) FROM public.magazie_bucati WHERE serie='E3-ALT-1' AND stare='anulata')<>1
 OR (SELECT count(*) FROM public.magazie_bucati WHERE serie='E3-ALT-1' AND stare='receptionat')<>1 THEN RAISE EXCEPTION 'E4 serie neeliberata'; END IF;
END $freed$;
""", imported=False)

block('§9.10 propunere deschisa -> respingere -> full storno', api + jwt('030') + r"""
SELECT set_config('test.e4_cor',(teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"E4"}'',''E4 respinge storno'')',current_setting('test.e3_b')))->>'corectie_id'),true);
""" + reset + r"""
SELECT set_config('request.jwt.claims','{}',true);
SELECT teste.e3_refuz('SELECT public.fn_izo_import_storno(3,''E3-import'',''E4 propunere deschisa'')','23514','E3b: decide / retrage intai propunerile:%');
""" + api + jwt('121') + r"""
SELECT teste.e3_rpc(format('SELECT public.fn_izo_cor_respinge(%s,1,''E4 respins'')',current_setting('test.e4_cor')));
""" + reset + r"""
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.fn_izo_import_storno(3,'E3-import','E4 full dupa respingere');
DO $full$ BEGIN
 IF (SELECT stare FROM public.izo_importuri WHERE proiect_id=3 AND import_id='E3-import') IS DISTINCT FROM 'stornat'
 OR (SELECT stare FROM public.izo_corectii WHERE id=current_setting('test.e4_cor')::bigint) IS DISTINCT FROM 'respinsa'
 OR EXISTS(SELECT 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id=b.id JOIN public.izo_importuri i ON i.eveniment_id=m.eveniment_id WHERE i.import_id='E3-import' AND b.stare<>'anulata') THEN RAISE EXCEPTION 'E4 full incomplet'; END IF;
END $full$;
""")

guard_doc = create_doc.replace(
    '"lungime_doc_mm":12000}]',
    '"lungime_doc_mm":12000},{"nr_crt":2,"serie":"E4-DOC-2","sarja":"E4-S","perete_mm":8,"lungime_doc_mm":12000,"decizie":"primit_neconform","motiv":"E4 NCR"}]').replace('"total_m":12}', '"total_m":24}')
block('§9.10 garda: pierduta / in afara PV / stare intrare interzisa',
    api + jwt('030') + guard_doc + confirm_doc + r"""
SELECT public.fn_izo_doc_pv(current_setting('test.e4_doc')::bigint,2,'E4-PV','2026-10-22');
""" + reset + r"""
SELECT set_config('izo.receptie_ctx','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare=(CASE serie WHEN 'E4-DOC-1' THEN 'pierduta' ELSE 'receptionat' END),server_ver=nextval('public.izo_server_ver_seq') WHERE aviz_intrare_id=current_setting('test.e4_doc')::bigint;
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SET LOCAL ROLE izo_receptie_writer;
DO $pv_guard$
DECLARE v_d public.izo_documente_intrare; v_ev bigint; v_b bigint; v_n int:=0;
BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_documente_intrare WHERE id=current_setting('test.e4_doc')::bigint;
 PERFORM public.fn_izo_receptie_marcheaza('anulare',v_d.id,3,11,v_d.versiune,'E4 garda storno');
 PERFORM set_config('izo.anulare_cerut_de',txid_current()::text||'|'||v_d.id||'|00000000-0000-0000-0000-000000000121',true);
 INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,storno_de_eveniment_id,motiv,declarat_de,aplicat_de,server_ver)
 VALUES('storno',3,'doc_intrare',v_d.id::text,v_d.eveniment_pv_id,'E4 garda storno','00000000-0000-0000-0000-000000000121',NULL,nextval('public.izo_server_ver_seq')) RETURNING id INTO v_ev;
 FOR v_b IN SELECT id FROM public.magazie_bucati WHERE aviz_intrare_id=v_d.id ORDER BY id LOOP
  BEGIN
   INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
    VALUES(v_ev,3,v_b,'stare','receptionat','sosit',nextval('public.izo_server_ver_seq'));
   RAISE EXCEPTION 'E4 PV storno fals acceptat';
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'E3b: miscare storno invalida / repetata' THEN RAISE; END IF;
   v_n:=v_n+1;
  END;
 END LOOP;
 IF v_n<>2 OR EXISTS(SELECT 1 FROM public.magazie_bucati_miscari WHERE eveniment_id=v_ev) THEN RAISE EXCEPTION 'E4 garda PV incompleta'; END IF;
END $pv_guard$;
RESET ROLE;
-- Modificare exclusiv in fixture, ca writer real. Nu alteram trigger-e/ACL.
SET LOCAL ROLE izo_registru_writer;
SELECT set_config('izo.registru_tx',txid_current()::text,true);
UPDATE public.magazie_bucati SET stare='taiata',server_ver=nextval('public.izo_server_ver_seq') WHERE serie='E4-DOC-2';
RESET ROLE;
SELECT set_config('izo.registru_tx','',true);
SET LOCAL ROLE izo_receptie_writer;
DO $entry_guard$ DECLARE v_d public.izo_documente_intrare; v_ev bigint; v_b bigint; BEGIN
 SELECT * INTO STRICT v_d FROM public.izo_documente_intrare WHERE id=current_setting('test.e4_doc')::bigint;
 SELECT id INTO STRICT v_b FROM public.magazie_bucati WHERE aviz_intrare_id=v_d.id AND serie='E4-DOC-2';
 INSERT INTO public.magazie_bucati_evenimente(tip,proiect_id,document_tip,document_id,storno_de_eveniment_id,motiv,declarat_de,aplicat_de,server_ver)
 VALUES('storno',3,'doc_intrare',v_d.id::text,v_d.eveniment_intrare_id,'E4 garda storno','00000000-0000-0000-0000-000000000121',NULL,nextval('public.izo_server_ver_seq')) RETURNING id INTO v_ev;
 BEGIN
  INSERT INTO public.magazie_bucati_miscari(eveniment_id,proiect_id,bucata_id,rol,stare_inainte,stare_dupa,server_ver)
   VALUES(v_ev,3,v_b,'anulat','taiata','anulata',nextval('public.izo_server_ver_seq'));
  RAISE EXCEPTION 'E4 storno intrare din taiata acceptat';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'E3b: miscare storno invalida / repetata' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.magazie_bucati_miscari WHERE eveniment_id=v_ev) THEN RAISE EXCEPTION 'E4 storno intrare a scris'; END IF;
END $entry_guard$;
RESET ROLE;
""")

block('§9.12 EXECUTE exact al helperelor interne, pe fiecare rol', r"""
DO $helpers_acl$ DECLARE v_f record; v_role text; v_sig text; v_allowed boolean; BEGIN
 FOR v_f IN SELECT * FROM (VALUES
 ('fn_izo_cor_chei(text,text,text)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_autorizare_lock(bigint,text,integer)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_cerut_de_valid(bigint,uuid)','izo_corectie_writer,izo_receptie_writer'),
 ('fn_izo_cor_bucata_lock(bigint,bigint)','izo_cor_editor'),
 ('fn_izo_cor_doc_lock(bigint,bigint)','izo_cor_editor'),
 ('fn_izo_cor_deschise(bigint[])','izo_registru_writer,izo_receptie_writer'),
 ('fn_izo_cor_api_verifica()','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_adm_verifica()','izo_corectie_writer'),
 ('fn_izo_cor_marcheaza(bigint)','izo_corectie_writer'),
 ('fn_izo_cor_loc(public.magazie_bucati)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_tinta_iesire(public.magazie_bucati)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_valori(public.magazie_bucati)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_valideaza(public.izo_corectii)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_inainte(public.izo_corectii)','izo_cor_editor,izo_corectie_writer'),
 ('fn_izo_cor_eveniment_asteptat(public.izo_corectii)','izo_corectie_writer'),
 ('fn_izo_cor_bucata_dupa(public.izo_corectii,public.magazie_bucati)','izo_corectie_writer'),
 ('fn_izo_cor_bucata_noua(public.izo_corectii)','izo_corectie_writer'),
 ('fn_izo_cor_miscare_asteptata(public.izo_corectii,public.magazie_bucati)','izo_corectie_writer'),
 ('fn_izo_garda_corectie(text,text,jsonb,jsonb)','izo_corectie_writer'),
 ('fn_izo_cor_garda()',''),
 ('fn_izo_lant_blocant(bigint[],bigint[])','izo_corectie_writer,izo_registru_writer,izo_receptie_writer'),
 ('fn_izo_doc_instantaneu(bigint)','izo_doc_editor'),
 ('fn_izo_doc_diff(jsonb,jsonb)','izo_doc_editor'),
 ('fn_izo_doc_ist_garda()','')
 ) x(sig,roles) LOOP
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','izo_cor_editor','izo_corectie_writer','izo_doc_editor','izo_registru_writer','izo_receptie_writer'] LOOP
   v_allowed:=v_role=ANY(string_to_array(v_f.roles,','));
   IF has_function_privilege(v_role,'public.'||v_f.sig,'EXECUTE') IS DISTINCT FROM v_allowed THEN RAISE EXCEPTION 'E4 EXECUTE % % asteptat %',v_role,v_f.sig,v_allowed; END IF;
  END LOOP;
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY['izo_cor_editor','izo_corectie_writer'] LOOP
  FOREACH v_sig IN ARRAY ARRAY['fn_izo_jwt_rol()','fn_izo_uid()','fn_izo_porti_lipsa()'] LOOP
   IF NOT has_function_privilege(v_role,'public.'||v_sig,'EXECUTE') THEN RAISE EXCEPTION 'E4 identitate EXECUTE lipsa % %',v_role,v_sig; END IF;
  END LOOP;
  IF has_function_privilege(v_role,'public.fn_izo_doc_api_verifica()','EXECUTE') THEN RAISE EXCEPTION 'E4 GRANT nou pe helperul API E3: %',v_role; END IF;
 END LOOP;
END $helpers_acl$;
""", imported=False)

for role in ('authenticated', 'service_role', 'anon'):
    block('§9.12 DML direct refuzat ' + role,
        'SET SESSION AUTHORIZATION authenticator;\nSET LOCAL ROLE ' + role + ';\n' + r"""
DO $dml_acl$ DECLARE v_t text; v_sql text; v_col text; BEGIN
 FOREACH v_t IN ARRAY ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric'] LOOP
  v_col:=(CASE v_t WHEN 'izo_corectii' THEN 'proiect_id' WHEN 'izo_corectii_bucati' THEN 'corectie_id' ELSE 'document_id' END);
  FOREACH v_sql IN ARRAY ARRAY[
    format('INSERT INTO public.%I DEFAULT VALUES',v_t),
    format('UPDATE public.%I SET %I=%I WHERE %I IS NOT NULL',v_t,v_col,v_col,v_col),
    format('DELETE FROM public.%I WHERE %I IS NOT NULL',v_t,v_col),
    format('TRUNCATE public.%I',v_t)] LOOP
   BEGIN
    EXECUTE v_sql;
    RAISE EXCEPTION 'E4 DML acceptat: %',v_sql;
   EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'permission denied for table %' THEN RAISE; END IF;
   END;
  END LOOP;
 END LOOP;
END $dml_acl$;
""" + reset, imported=False)

block('§9.11 salvari reale cu scan adaugat/scos si rand renumerotat', api + jwt('030') + create_doc + r"""
INSERT INTO storage.objects(bucket_id,name) VALUES('izo-documente',current_setting('test.e4_doc')||'/0b1c2d3e-0000-4000-8000-000000000004.pdf');
DO $saves$ DECLARE v_d bigint:=current_setting('test.e4_doc')::bigint; v_antet jsonb;
 v_scan jsonb; v_rows jsonb; v_r jsonb;
BEGIN
 v_antet:='{"furnizor":"E4 fixture","nr_document":"E4-DOC","data_document":"2026-10-22","total_m":12}';
 v_rows:='[{"nr_crt":2,"serie":"E4-DOC-1","sarja":"E4-S","perete_mm":8,"lungime_doc_mm":12000}]';
 v_scan:=jsonb_build_array(jsonb_build_object('cale',v_d||'/0b1c2d3e-0000-4000-8000-000000000004.pdf','sha256_original',repeat('a',64),'sha256_pdf',repeat('b',64),'marime',1000,'mime','application/pdf'));
 v_r:=public.fn_izo_doc_salveaza(v_d,1,v_antet,v_rows,v_scan);
 IF v_r->>'istoric_versiune' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'E4 istoric scan 2'; END IF;
 v_r:=public.fn_izo_doc_salveaza(v_d,2,v_antet,v_rows,'[]');
 IF v_r->>'istoric_versiune' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'E4 istoric scan 3'; END IF;
END $saves$;
""" + reset + r"""
DO $saved_diff$ DECLARE v_a public.izo_documente_istoric; v_b public.izo_documente_istoric;
 v_old jsonb; v_doc bigint:=current_setting('test.e4_doc')::bigint; BEGIN
 SELECT * INTO STRICT v_a FROM public.izo_documente_istoric WHERE document_id=v_doc AND versiune=2;
 SELECT * INTO STRICT v_b FROM public.izo_documente_istoric WHERE document_id=v_doc AND versiune=3;
 SELECT continut INTO STRICT v_old FROM public.izo_documente_istoric WHERE document_id=v_doc AND versiune=1;
 IF v_a.diff#>'{scanuri,adaugate}' IS DISTINCT FROM v_a.continut->'scanuri'
 OR jsonb_array_length(v_a.diff#>'{scanuri,adaugate}') IS DISTINCT FROM 1
 OR v_a.diff#>'{scanuri,scoase}' IS DISTINCT FROM '[]'::jsonb
 OR v_a.diff#>'{randuri,sterse}' IS DISTINCT FROM v_old->'randuri'
 OR v_a.diff#>'{randuri,adaugate}' IS DISTINCT FROM v_a.continut->'randuri'
 OR v_a.diff#>'{randuri,modificate}' IS DISTINCT FROM '{}'::jsonb
 OR v_b.diff#>'{scanuri,scoase}' IS DISTINCT FROM v_a.continut->'scanuri'
 OR v_b.diff#>'{scanuri,adaugate}' IS DISTINCT FROM '[]'::jsonb
 OR v_b.continut->'scanuri' IS DISTINCT FROM '[]'::jsonb
 OR (SELECT count(*) FROM public.izo_documente_istoric WHERE document_id=v_doc)<>3 THEN RAISE EXCEPTION 'E4 diff persistat scan/renumerotare'; END IF;
END $saved_diff$;
""")

block('§9.16 RPC real urmat de CHECK: rollback aprobare si cale directa', r"""
CREATE DOMAIN teste.e4_positive AS integer CHECK(VALUE>0);
DO $green$ BEGIN IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'E4 domeniul a schimbat poarta'; END IF; END $green$;
""" + api + jwt('030') + r"""
SELECT set_config('test.e4_cor',(teste.e3_rpc(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"E4"}'',''E4 RPC atomic'')',current_setting('test.e3_b')))->>'corectie_id'),true);
""" + reset + r"""
SELECT set_config('test.e4_atom_before',jsonb_build_object(
 'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.izo_corectii c),
 'b',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.magazie_bucati b),
 'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.magazie_bucati_evenimente e),
 'm',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.magazie_bucati_miscari m))::text,true);
""" + api + jwt('121') + r"""
DO $rpc_atomic$ DECLARE v_sql text; v_constraint text; v_n int:=0; BEGIN
 FOREACH v_sql IN ARRAY ARRAY[
 format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e4_cor')),
 format('SELECT public.fn_izo_cor_camp(%s,%s,%L,%L)',current_setting('test.e3_b2'),(SELECT server_ver FROM public.magazie_bucati WHERE id=current_setting('test.e3_b2')::bigint),'{"perete_mm":9}','E4 direct atomic')
 ] LOOP
  BEGIN
   PERFORM teste.e3_rpc(v_sql);
   PERFORM (-1)::teste.e4_positive;
   RAISE EXCEPTION 'E4 CHECK absent';
  EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
   IF v_constraint<>'e4_positive_check' THEN RAISE; END IF;
   v_n:=v_n+1;
  END;
 END LOOP;
 IF v_n<>2 THEN RAISE EXCEPTION 'E4 RPC atomic incomplet'; END IF;
END $rpc_atomic$;
""" + reset + r"""
DO $rpc_result$ BEGIN
 IF jsonb_build_object(
 'c',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.izo_corectii c),
 'b',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.magazie_bucati b),
 'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.magazie_bucati_evenimente e),
 'm',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.magazie_bucati_miscari m)) IS DISTINCT FROM current_setting('test.e4_atom_before')::jsonb
 OR (SELECT stare FROM public.izo_corectii WHERE id=current_setting('test.e4_cor')::bigint) IS DISTINCT FROM 'propusa' THEN RAISE EXCEPTION 'E4 RPC a lasat efecte'; END IF;
END $rpc_result$;
""")

block('F1 lant blocant refuza NULL fail-closed', r"""
SET LOCAL ROLE izo_registru_writer;
DO $null_events$ DECLARE v_b bigint:=current_setting('test.e3_b')::bigint; v_ev bigint; BEGIN
 SELECT m.eveniment_id INTO STRICT v_ev FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b AND m.rol='nascut';
 BEGIN
  PERFORM * FROM public.fn_izo_lant_blocant(ARRAY[v_b],ARRAY[v_ev,NULL]::bigint[]);
  RAISE EXCEPTION 'F1 NULL in lista acceptat';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM * FROM public.fn_izo_lant_blocant(ARRAY[v_b],NULL::bigint[]);
  RAISE EXCEPTION 'F1 lista NULL acceptata';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF NOT EXISTS (SELECT 1 FROM public.fn_izo_lant_blocant(ARRAY[v_b],ARRAY[]::bigint[]))
 OR EXISTS (SELECT 1 FROM public.fn_izo_lant_blocant(ARRAY[v_b],ARRAY[v_ev])) THEN
  RAISE EXCEPTION 'F1 lant valid incorect'; END IF;
END $null_events$;
RESET ROLE;
""")

def write():
    out = ROOT / 'supabase/tests/izometrie_e3b_rest.sql'
    out.write_text('-- Generat de scripts/izometrie/e3b_build_rest.py; fara acces BD.\n'
        + "DO $safe$ BEGIN IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF; END $safe$;\n"
        + '\n'.join(parts)
        + "\nBEGIN;\nDO $end$ BEGIN IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'E4 a lasat poarta rosie'; END IF; RAISE NOTICE 'TESTE E3b-E4: TOATE OK'; END $end$;\nROLLBACK;\n",
        encoding='utf-8', newline='\n')
    print(out.relative_to(ROOT))

if __name__ == '__main__':
    write()
