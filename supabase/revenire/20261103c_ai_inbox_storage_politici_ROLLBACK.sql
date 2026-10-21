-- ============================================================================
-- REVENIRE 20261103c — readuce EXACT starea live din 21.10.2026 pe bucket-ul ai-documente-inbox: scoate politicile
-- ai_inbox_obj_insert / _select / _delete și recreează ai_inbox_obj_all (FOR ALL TO authenticated, doar bucket_id); scoate
-- trigger-ele trg_ai_inbox_fisier_legat / trg_ai_inbox_fisier_imutabil, funcțiile ai_inbox_fisier_legat() /
-- ai_inbox_fisier_imutabil() și indexul unic idx_ai_inbox_fisier_path. Nu atinge alte politici / bucket-uri / date.
--
-- ⚠ REDESCHIDE GAURA DE CONFIDENȚIALITATE: după revenire orice cont logat listează, descarcă, suprascrie și șterge din nou fișierele
--   din coadă ale tuturor modulelor (inclusiv actele de identitate HR), fisier_path / uploadat_de redevin editabile, iar un rând
--   nou se poate lega din nou de fișierul altcuiva (exploatabil prin edge-urile service_role citeste-orice / cleanup-recycle-bin).
--   ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Doar la cererea explicită a lui
--   Răzvan, cu motivul consemnat și review separat. O problemă în panou / wizard (ex. o cale de upload nouă refuzată) se repară
--   ÎNAINTE (forward-fix: o migrare nouă care adaugă calea), nu prin revenire. Fișierele șterse între timp nu se recuperează
--   (bucket fără versionare) — revenirea nu atinge date.
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN;
--     SELECT set_config('gazpet.revenire_20261103c', 'REDESCHIDE_INBOX_STORAGE:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- harness-armare: gazpet.revenire_20261103c REDESCHIDE_INBOX_STORAGE
-- Siguranțe: armare legată de txid, verificată ÎNAINTEA lock-urilor; armare persistentă (ALTER DATABASE/ROLE … SET) = refuz;
--   LOCK ai_documente_inbox (SHARE ROW EXCLUSIVE) apoi storage.objects (ACCESS EXCLUSIVE) până la COMMIT, înaintea verificării
--   stării — ordinea coadă → storage e cea a unui INSERT în coadă (trigger-ul trg_ai_inbox_fisier_legat citește storage): invers,
--   revenirea ar ține storage și ar aștepta coada, iar INSERT-ul ar ține coada și ar aștepta storage → deadlock (Jakarinos /
--   Copilot #832 r2 P2); E3 nu e atinsă (doar ai_inbox_obj_* + obiectele patch-ului);
--   precondiție = EXACT obiectele patch-ului: expresiile politicilor (aceleași constante ca postcondiția migrării), definiția
--   indexului, atributele + ACL-ul + corpul (md5 cu spațiile albe comprimate) ale celor două funcții, tipul / funcția / starea
--   celor două trigger-e; DROP fără CASCADE; postcondiție = exact politica veche și niciun obiect al patch-ului rămas; dezarmare
--   la final. Fără date: nu contează izolarea tranzacției.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $rb_arm$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.revenire_20261103c') THEN
    RAISE EXCEPTION 'REVENIRE 20261103c blocată: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('gazpet.revenire_20261103c', true) IS DISTINCT FROM 'REDESCHIDE_INBOX_STORAGE:' || txid_current() THEN
    RAISE EXCEPTION 'REVENIRE 20261103c blocată: fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.revenire_20261103c'', ''REDESCHIDE_INBOX_STORAGE:'' || txid_current(), true);'
      USING ERRCODE = '42501';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261103c: revenirea necesita postgres'; END IF;
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103c: search_path = „%” (aștept „public, pg_temp”)', current_setting('search_path') USING ERRCODE = '55000';
  END IF;
END $rb_arm$;
LOCK TABLE public.ai_documente_inbox IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;

DO $rb_pre$
DECLARE
  c_ins CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR (((storage.foldername(name))[1] = ''wizard-angajare''::text) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_owner = true) OR (p.can_access_personal_data = true))))))) AND (NOT (EXISTS ( SELECT 1 FROM ai_documente_inbox i WHERE (i.fisier_path = objects.name)))))';
  c_sel CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (EXISTS ( SELECT 1 FROM ai_documente_inbox i WHERE ((i.fisier_path = objects.name) AND ((i.uploadat_de)::text = objects.owner_id) AND fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id)))) OR (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_owner = true))))))';
  -- md5 al corpului (prosrc) cu spațiile albe comprimate la un spațiu și capetele tăiate — independent de CRLF / LF
  c_md5_imut CONSTANT text := '8b8f00a4db9b7cd9ec3d456ad94c9818';
  c_md5_legat CONSTANT text := 'dc0321296cdba52b813b37ff28f2cf89';
  v_fn oid := to_regprocedure('public.ai_inbox_fisier_imutabil()');
  v_fl oid := to_regprocedure('public.ai_inbox_fisier_legat()');
BEGIN
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND starts_with(p.polname::text, 'ai_inbox_obj')) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_insert'
                    AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polqual IS NULL
                    AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]+', ' ', 'g') = c_ins)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_select'
                    AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_delete'
                    AND p.polcmd = 'd' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel) THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103c: starea curentă nu e patch-ul 20261103c (exact) — politicile — nu se revine tacit' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_get_indexdef(to_regclass('public.idx_ai_inbox_fisier_path'))) IS DISTINCT FROM
       'CREATE UNIQUE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox USING btree (fisier_path)'
     OR v_fn IS NULL OR v_fl IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.proacl IS NOT NULL
                    AND md5(btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g'))) = c_md5_imut)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fl AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.proacl IS NOT NULL
                    AND md5(btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g'))) = c_md5_legat)
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid IN (v_fn, v_fl) AND a.grantee <> p.proowner)
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgname IN ('trg_ai_inbox_fisier_imutabil', 'trg_ai_inbox_fisier_legat')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_imutabil' AND t.tgrelid = 'public.ai_documente_inbox'::regclass
                    AND t.tgfoid = v_fn AND NOT t.tgisinternal AND t.tgtype = 19 AND t.tgenabled <> 'D' AND t.tgqual IS NULL
                    AND cardinality(t.tgattr::int2[]) = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_legat' AND t.tgrelid = 'public.ai_documente_inbox'::regclass
                    AND t.tgfoid = v_fl AND NOT t.tgisinternal AND t.tgtype = 7 AND t.tgenabled <> 'D' AND t.tgqual IS NULL
                    AND cardinality(t.tgattr::int2[]) = 0) THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103c: starea curentă nu e patch-ul 20261103c (exact) — index / funcții / trigger-e — nu se revine tacit' USING ERRCODE = '55000';
  END IF;
END $rb_pre$;

DROP POLICY ai_inbox_obj_delete ON storage.objects;
DROP POLICY ai_inbox_obj_select ON storage.objects;
DROP POLICY ai_inbox_obj_insert ON storage.objects;
CREATE POLICY ai_inbox_obj_all ON storage.objects AS PERMISSIVE FOR ALL TO authenticated
  USING (bucket_id = 'ai-documente-inbox'::text) WITH CHECK (bucket_id = 'ai-documente-inbox'::text);
DROP TRIGGER trg_ai_inbox_fisier_legat ON public.ai_documente_inbox;
DROP TRIGGER trg_ai_inbox_fisier_imutabil ON public.ai_documente_inbox;
DROP FUNCTION public.ai_inbox_fisier_legat();
DROP FUNCTION public.ai_inbox_fisier_imutabil();
DROP INDEX public.idx_ai_inbox_fisier_path;

DO $rb_post$
DECLARE c_vechi CONSTANT text := '(bucket_id = ''ai-documente-inbox''::text)';
BEGIN
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND starts_with(p.polname::text, 'ai_inbox_obj')) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_all'
                    AND p.polcmd = '*' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
                    AND pg_get_expr(p.polqual, p.polrelid) = c_vechi AND pg_get_expr(p.polwithcheck, p.polrelid) = c_vechi)
     OR to_regclass('public.idx_ai_inbox_fisier_path') IS NOT NULL
     OR to_regprocedure('public.ai_inbox_fisier_imutabil()') IS NOT NULL
     OR to_regprocedure('public.ai_inbox_fisier_legat()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_ai_inbox_fisier_imutabil', 'trg_ai_inbox_fisier_legat')) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE revenire 20261103c: starea nu e exact cea dinainte (ai_inbox_obj_all) sau au rămas obiecte ale patch-ului';
  END IF;
  IF current_setting('gazpet.revenire_20261103c', true) IS DISTINCT FROM 'REDESCHIDE_INBOX_STORAGE:' || txid_current() THEN
    RAISE EXCEPTION 'REVENIRE 20261103c: armarea s-a pierdut în timpul revenirii; se anulează tot';
  END IF;
  PERFORM set_config('gazpet.revenire_20261103c', '', true);   -- dezarmare
END $rb_post$;
