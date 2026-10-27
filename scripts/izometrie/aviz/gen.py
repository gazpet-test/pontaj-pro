"""Offline generator; LIVE artifacts are read-only. Run from this worktree."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
live = (ROOT/'supabase/migrations/20261111a_izometrie_gps_curatare.sql').read_text(encoding='utf-8')
amp = live[live.rindex('  SELECT md5(concat_ws(\' | \','):]
amp = amp[:amp.index('  -- </amprenta>')]
amp = '  -- <amprenta>\n'+amp+'  -- </amprenta>\n'
start = live.index('CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4b_definitii()')
end = live.index('$f$;', live.index('AS $f$', start))+5
old = live[start:end]
new = old.replace("'izo_gps_stergeri'", "'izo_gps_stergeri','izo_avize_serii','izo_avize_iesire'")
new = new.replace("'izo_gps_stergeri_id_seq'", "'izo_gps_stergeri_id_seq','izo_avize_iesire_id_seq'")
# FORCE RLS is part of the extended gate, including the two new tables.
new = new.replace("format('%s:%s:%s:%s:%s',c.relname,c.relowner,c.relrowsecurity,c.relacl,c.reloptions)",
                  "format('%s:%s:%s:%s:%s:%s',c.relname,c.relowner,c.relrowsecurity,c.relacl,c.reloptions,c.relforcerowsecurity)")
stamps = [('porti',''),('e3','_e3'),('e3b','_e3b'),('e4','_e4'),('e4b','_e4b')]
save = ',\n'.join(f"'{k}',obj_description('public.fn_izo_porti{s}_definitii()'::regprocedure,'pg_proc')" for k,s in stamps)
stamp = '\n'.join(f"EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti{s}_definitii() IS %L','porti{s}='||public.fn_izo_porti{s}_definitii());" for k,s in stamps)
restore = '\n'.join(f"EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti{s}_definitii() IS %L',v_meta->>'{k}');" for k,s in stamps)
pre = """-- AVIZ-1; runner uses --single-transaction. Never apply directly.
-- Baseline captured 27.10.2026; refuses drift rather than restamping unknown code.
DO $migrare$
DECLARE v_amprenta text; v_meta jsonb; v_lipsa text[];
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
 IS DISTINCT FROM '20261120a_izometrie_aviz_iesire:'||txid_current() THEN RAISE EXCEPTION 'AVIZ numai runner postgres'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 IF to_regclass('public.izo_avize_serii') IS NOT NULL OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='izo-avize')
 THEN RAISE EXCEPTION 'AVIZ deja exista'; END IF;
 -- Corpurile exacte de pe prod (27.10.2026) ale funcțiilor pe care se sprijină avizul; COMMENT-urile cu amprente
 -- conțin OID-uri de rol și diferă între medii, deci drift-ul lor se verifică prin <amprenta> = COMMENT (mai jos), ca la 20261109b.
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_iesire_intern(uuid,integer,bigint,bigint[],text,date)'::regprocedure) IS DISTINCT FROM '5bd014cb48c161784e00989d92ea048c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_birou_autorizat(bigint,integer,boolean)'::regprocedure) IS DISTINCT FROM 'c4c0cbd475c224a44ea5a3eae4fe98e2'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_birou_intrare(bigint,integer,text)'::regprocedure) IS DISTINCT FROM '84c2318be04fb33fba5c8695bfb7635a'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_citire(bigint)'::regprocedure) IS DISTINCT FROM 'b077d01aface67bb26dc9fea4baef0e2'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM '3c136ab43387e8d7807efcadb0768dda'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_e4_lipsa()'::regprocedure) IS DISTINCT FROM '6905733e1c2ccddce2a5757757f24b6b'
 THEN RAISE EXCEPTION 'AVIZ baseline prod diferit'; END IF;
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] OR public.fn_izo_porti_e4_lipsa() IS DISTINCT FROM '{}'::text[]
 THEN RAISE EXCEPTION 'AVIZ baseline porti'; END IF;
"""
meta = "v_meta:=jsonb_build_object('amprenta',v_amprenta,'evenimente',obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class'),\n"+save+");\n"
meta += "IF v_amprenta IS DISTINCT FROM substring(v_meta->>'evenimente' FROM 'amprenta=([0-9a-f]{32})') THEN RAISE EXCEPTION 'AVIZ baseline amprenta'; END IF;\n"
corp = (HERE/'corp.sql').read_text(encoding='utf-8')
# The only seed block is near the TOP of the final artifact, immediately after
# creating the series table. The preview changes this block, never the generator.
offset = corp.index('CREATE TABLE public.izo_avize_iesire')
corp = corp[:offset]+(HERE/'schema.sql').read_text(encoding='utf-8')+corp[offset:]
post = """
 v_meta:=jsonb_set(v_meta,'{serii_initiale}',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.depozit_id) FROM public.izo_avize_serii s));
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ postconditie porti'; END IF;
"""+amp+"""
 EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L','AVIZ amprenta='||v_amprenta||' anterior: '||(v_meta->>'evenimente'));
 EXECUTE format('COMMENT ON TABLE public.izo_avize_serii IS %L',v_meta::text);
END $migrare$;
"""
migration = pre+amp+meta+corp+'\n'+new+'\n'+stamp+'\n'+post
rollback = """-- AVIZ-1; --single-transaction, explicitly armed by preview/apply operator.
DO $revenire$
DECLARE v_amprenta text; v_meta jsonb; v_bucket text;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261120a',true)
 IS DISTINCT FROM 'IZO_AVIZ_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'AVIZ revenire nearmata'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 LOCK TABLE public.izo_avize_serii,public.izo_avize_iesire IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.izo_avize_iesire) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='izo-avize')
 THEN RAISE EXCEPTION 'AVIZ date existente: revenire refuzata'; END IF;
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ porti'; END IF;
 v_meta:=obj_description('public.izo_avize_serii'::regclass,'pg_class')::jsonb;
 IF v_meta->>'amprenta' IS NULL THEN RAISE EXCEPTION 'AVIZ metadata lipsa'; END IF;
 IF v_meta->'serii_initiale' IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.depozit_id) FROM public.izo_avize_serii s)
 THEN RAISE EXCEPTION 'AVIZ date existente: configuratie serii schimbata'; END IF;
"""
for name in ['sel','ins','r_sel','r_ins','r_upd','r_del','r_anon']:
    rollback += f'DROP POLICY izo_aviz_pdf_{name} ON storage.objects;\n'
rollback += """-- Supabase blochează DELETE pe storage.* (trigger protect_delete) ca să nu rămână fișiere orfane. Bucket-ul e
-- dovedit gol mai sus (sub lock), deci deblocarea e locală tranzacției și se închide imediat după ștergere.
PERFORM set_config('storage.allow_delete_query','true',true);
DELETE FROM storage.buckets WHERE id='izo-avize' RETURNING id INTO v_bucket;
PERFORM set_config('storage.allow_delete_query','false',true);
IF v_bucket IS DISTINCT FROM 'izo-avize' THEN RAISE EXCEPTION 'AVIZ bucket lipsa'; END IF;
SET LOCAL ROLE izo_montaj_writer;
DROP FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date);
RESET ROLE;
DROP FUNCTION public.fn_izo_iesire_cu_aviz(uuid,int,bigint,bigint[],date,int,text,boolean,int,text,jsonb);
DROP FUNCTION public.fn_izo_aviz_pdf_ataseaza(bigint);
DROP FUNCTION public.fn_izo_aviz_anuleaza(bigint,text);
DROP TABLE public.izo_avize_iesire;
DROP TABLE public.izo_avize_serii;
"""+old+'\n'+restore+"""
EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',v_meta->>'evenimente');
IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ restore porti'; END IF;
"""+amp+"""
IF v_amprenta IS DISTINCT FROM v_meta->>'amprenta' THEN RAISE EXCEPTION 'AVIZ restore amprenta diferita'; END IF;
END $revenire$;
"""
for dest,content in [('supabase/migrations/20261120a_izometrie_aviz_iesire.sql',migration),('supabase/revenire/20261120a_izometrie_aviz_iesire_ROLLBACK.sql',rollback)]:
    (ROOT/dest).write_text(content,encoding='utf-8',newline='\n')
print('Generated AVIZ migration + rollback (LIVE files unchanged).')
