#!/bin/bash
# Test local (PG16, WSL) pentru 20261101b: garda, deja aplicata, amprenta (pre/post/revenire), CHECK, fn_ofertare_doc_prov_curent
# (curent / necurent), test COMPORTAMENTAL pe fn_ofertare_cb_text_valid_asof REALA (definitia de pe live): ocr_local_neverificat => '{}'.
set -e
pg_ctlcluster 16 main start 2>/dev/null || true
DB=t20261101b; su postgres -c "dropdb --if-exists $DB; createdb $DB" 2>/dev/null
run(){ su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB $*"; }
q(){ su postgres -c "psql -X -At -d $DB -c \"$1\""; }
run <<'SQL'
DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $r$;
CREATE TABLE public.ofertare_documente_atribuire (id bigint PRIMARY KEY, text_extras text);
CREATE TABLE public.ofertare_doc_texte_prov (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint, document_id bigint,
  sha256 text, origine text NOT NULL CHECK (origine IN ('transcriere', 'sinteza_ai')), producator text, completitudine text,
  constatat_la timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ofertare_cant_doc_decizii (id bigint PRIMARY KEY, licitatie_id bigint, document_id bigint, doc_sha256 text, decizie text,
  decis_la timestamptz, revoca_id bigint);
CREATE TABLE public.ofertare_analiza_versiuni (id int);
CREATE FUNCTION public.fn_ofertare_cb_amprenta() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT md5(string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname)) FROM pg_constraint k
   WHERE k.conrelid = 'public.ofertare_doc_texte_prov'::regclass $f$;
DO $x$ BEGIN EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a + 20261031b + 20261031d). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta()); END $x$;
SQL
# definitia REALA: psql ... -At -c "select pg_get_functiondef('public.fn_ofertare_cb_text_valid_asof(bigint,bigint,text,timestamptz)'::regprocedure)" > valid_asof_live.sql
run -f /mnt/c/Users/Gazpet-Ai/ocrlab_tmp/valid_asof_live.sql >/dev/null
FP0=$(q "SELECT public.fn_ofertare_cb_amprenta()")
M=/mnt/c/Users/Gazpet-Ai/gazpet-erp-ocrlab-pv/supabase/migrations/20261101b_ofertare_text_prov_ocr_local.sql
R=/mnt/c/Users/Gazpet-Ai/gazpet-erp-ocrlab-pv/supabase/revenire/20261101b_ofertare_text_prov_ocr_local_ROLLBACK.sql
G="SELECT set_config('gazpet.livrare_migrare','20261101b_ofertare_text_prov_ocr_local:'||txid_current(),true);"
ok(){ echo "OK  $1"; }
nu(){ echo "FAIL $1"; exit 1; }
(echo "BEGIN;"; cat $M; echo "COMMIT;") | run -f - 2>&1 | grep -q "garda start invalida" && ok "fara garda: refuz" || nu "fara garda"
q "COMMENT ON TABLE public.ofertare_analiza_versiuni IS 'amprenta=alta'" >/dev/null
(echo "BEGIN; $G"; cat $M; echo "COMMIT;") | run -f - 2>&1 | grep -q "amprenta difera" && ok "amprenta schimbata: refuz" || nu "amprenta"
run <<'SQL'
DO $x$ BEGIN EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a + 20261031b + 20261031d). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta()); END $x$;
SQL
(echo "BEGIN; $G"; cat $M; echo "COMMIT;") | run -f - >/dev/null && ok "aplicata cu garda" || nu "aplicare"
[ "$(q "SELECT obj_description('public.ofertare_analiza_versiuni'::regclass,'pg_class') LIKE '%20261101b%amprenta=' || public.fn_ofertare_cb_amprenta()")" = t ] && ok "amprenta recalculata si salvata" || nu "amprenta post"
(echo "BEGIN; $G"; cat $M; echo "COMMIT;") | run -f - 2>&1 | grep -q "deja aplicata" && ok "a doua oara: deja aplicata" || nu "deja aplicata"
q "INSERT INTO ofertare_documente_atribuire VALUES (1654, 'TEXT A'), (1655, 'TEXT B')" >/dev/null
SA=$(q "SELECT encode(sha256(convert_to('TEXT A','UTF8')),'hex')"); SB=$(q "SELECT encode(sha256(convert_to('TEXT B','UTF8')),'hex')")
q "INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine) VALUES (15,1654,'$SA','ocr_local_neverificat','laborator-ocr-lighton','integral'), (15,1655,'$SB','transcriere','ofertare-ingest-doc','integral')" >/dev/null
[ "$(q "SELECT fn_ofertare_cb_text_valid_asof(15,1654,'$SA',now())")" = "{}" ] && ok "valid_asof REAL: ocr_local_neverificat => {} (nu e sursa)" || nu "valid_asof ocr"
q "SELECT fn_ofertare_cb_text_valid_asof(15,1655,'$SB',now())" | grep -q '"tip": "prov"' && ok "valid_asof REAL: transcriere => sursa (control)" || nu "valid_asof control"
q "INSERT INTO ofertare_cant_doc_decizii VALUES (1,15,1654,'$SA','text_confirmat',now(),NULL)" >/dev/null
q "SELECT fn_ofertare_cb_text_valid_asof(15,1654,'$SA',now())" | grep -q '"tip": "decizie"' && ok "valid_asof REAL: ocr_local + text_confirmat de om => sursa" || nu "valid_asof decizie"
q "DELETE FROM ofertare_cant_doc_decizii" >/dev/null
[ "$(q "SELECT string_agg(document_id||':'||origine||':'||curent, ',' ORDER BY document_id) FROM fn_ofertare_doc_prov_curent(15)")" = "1654:ocr_local_neverificat:true,1655:transcriere:true" ] && ok "prov_curent: ambele curente" || nu "prov_curent"
q "UPDATE ofertare_documente_atribuire SET text_extras='TEXT B2' WHERE id=1655" >/dev/null
[ "$(q "SELECT curent FROM fn_ofertare_doc_prov_curent(15) WHERE document_id=1655")" = f ] && ok "prov_curent: text schimbat fara prov => curent=false" || nu "necurent"
[ "$(q "SELECT has_function_privilege('anon','public.fn_ofertare_doc_prov_curent(bigint)','EXECUTE')")" = f ] && ok "anon fara EXECUTE" || nu "anon"
[ "$(q "SELECT has_function_privilege('authenticated','public.fn_ofertare_doc_prov_curent(bigint)','EXECUTE')")" = t ] && ok "authenticated cu EXECUTE" || nu "authenticated"
q "INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine) VALUES (15,1,'x','altceva')" 2>&1 | grep -q "violates check" && ok "alta origine: refuz" || nu "check"
RG="SELECT set_config('gazpet.revenire_20261101b','PROV_OCR_REVENIRE:'||txid_current(),true);"
(echo "BEGIN; $RG"; cat $R; echo "COMMIT;") | run -f - 2>&1 | grep -q "exista proveniente ocr_local_neverificat" && ok "revenire cu randuri noi: refuz" || nu "revenire randuri"
q "DELETE FROM ofertare_doc_texte_prov WHERE origine='ocr_local_neverificat'" >/dev/null
(echo "BEGIN;"; cat $R; echo "COMMIT;") | run -f - 2>&1 | grep -q "garda start invalida" && ok "revenire fara armare: refuz" || nu "revenire garda"
(echo "BEGIN; $RG"; cat $R; echo "COMMIT;") | run -f - >/dev/null && ok "revenire armata" || nu "revenire"
[ "$(q "SELECT public.fn_ofertare_cb_amprenta()")" = "$FP0" ] && ok "amprenta revenita EXACT la valoarea de dinainte" || nu "amprenta revenire"
[ "$(q "SELECT obj_description('public.ofertare_analiza_versiuni'::regclass,'pg_class') = 'TKT-0329 B (20261031a + 20261031b + 20261031d). Imuabil. amprenta=$FP0'")" = t ] && ok "comentariul amprentei refacut" || nu "comentariu"
[ "$(q "SELECT to_regprocedure('public.fn_ofertare_doc_prov_curent(bigint)') IS NULL")" = t ] && ok "functia scoasa" || nu "functie"
su postgres -c "dropdb $DB"; echo TOATE_OK
