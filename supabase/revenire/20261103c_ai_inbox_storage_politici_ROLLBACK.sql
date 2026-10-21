-- ============================================================================
-- REVENIRE 20261103c — readuce EXACT starea live din 21.10.2026 pe bucket-ul ai-documente-inbox: scoate politicile
-- ai_inbox_obj_insert / _select / _delete și recreează ai_inbox_obj_all (FOR ALL TO authenticated, doar bucket_id); scoate
-- trigger-ul trg_ai_inbox_fisier_imutabil, funcția ai_inbox_fisier_imutabil() și indexul idx_ai_inbox_fisier_path. Nu atinge alte
-- politici / bucket-uri / date.
--
-- ⚠ REDESCHIDE GAURA DE CONFIDENȚIALITATE: după revenire orice cont logat listează, descarcă, suprascrie și șterge din nou fișierele
--   din coadă ale tuturor modulelor (inclusiv actele de identitate HR), iar fisier_path / uploadat_de redevin editabile.
--   ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Doar la cererea explicită a lui
--   Răzvan, cu motivul consemnat și review separat. O problemă în panou / wizard (ex. o cale de upload nouă refuzată) se repară
--   ÎNAINTE (forward-fix: o migrare nouă care adaugă calea), nu prin revenire.
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN;
--     SELECT set_config('gazpet.revenire_20261103c', 'REDESCHIDE_INBOX_STORAGE:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- harness-armare: gazpet.revenire_20261103c REDESCHIDE_INBOX_STORAGE
-- Siguranțe: armare legată de txid; armare persistentă (ALTER DATABASE/ROLE … SET) = refuz; precondiție = exact obiectele patch-ului
--   (expresiile comparate cu aceleași constante ca postcondiția migrării); DROP fără CASCADE; postcondiție = exact politica veche și
--   niciun obiect al patch-ului rămas; dezarmare la final. Fără date: nu contează izolarea tranzacției.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $rb_pre$
DECLARE
  c_ins CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR (((storage.foldername(name))[1] = ''wizard-angajare''::text) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_owner = true) OR (p.can_access_personal_data = true))))))))';
  c_sel CONSTANT text := '((bucket_id = ''ai-documente-inbox''::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND ((owner_id = (( SELECT auth.uid() AS uid))::text) OR (EXISTS ( SELECT 1 FROM ai_documente_inbox i WHERE ((i.fisier_path = objects.name) AND ((i.uploadat_de)::text = objects.owner_id) AND fn_ai_inbox_poate_confirma(i.modul_tinta, i.entitate_id)))) OR (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_owner = true))))))';
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
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND starts_with(p.polname::text, 'ai_inbox_obj')) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_insert'
                    AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polqual IS NULL
                    AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]+', ' ', 'g') = c_ins)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_select'
                    AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel)
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'ai_inbox_obj_delete'
                    AND p.polcmd = 'd' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] AND p.polwithcheck IS NULL
                    AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g') = c_sel)
     OR to_regclass('public.idx_ai_inbox_fisier_path') IS NULL
     OR to_regprocedure('public.ai_inbox_fisier_imutabil()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_inbox_fisier_imutabil' AND tgrelid = 'public.ai_documente_inbox'::regclass) THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103c: starea curentă nu e patch-ul 20261103c (exact) — nu se revine tacit' USING ERRCODE = '55000';
  END IF;
END $rb_pre$;

DROP POLICY ai_inbox_obj_delete ON storage.objects;
DROP POLICY ai_inbox_obj_select ON storage.objects;
DROP POLICY ai_inbox_obj_insert ON storage.objects;
CREATE POLICY ai_inbox_obj_all ON storage.objects AS PERMISSIVE FOR ALL TO authenticated
  USING (bucket_id = 'ai-documente-inbox'::text) WITH CHECK (bucket_id = 'ai-documente-inbox'::text);
DROP TRIGGER trg_ai_inbox_fisier_imutabil ON public.ai_documente_inbox;
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
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_inbox_fisier_imutabil') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE revenire 20261103c: starea nu e exact cea dinainte (ai_inbox_obj_all) sau au rămas obiecte ale patch-ului';
  END IF;
  IF current_setting('gazpet.revenire_20261103c', true) IS DISTINCT FROM 'REDESCHIDE_INBOX_STORAGE:' || txid_current() THEN
    RAISE EXCEPTION 'REVENIRE 20261103c: armarea s-a pierdut în timpul revenirii; se anulează tot';
  END IF;
  PERFORM set_config('gazpet.revenire_20261103c', '', true);   -- dezarmare
END $rb_post$;
