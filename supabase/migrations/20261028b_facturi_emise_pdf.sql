-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261028b — Facturi emise: PDF-urile facturilor făcute în afara platformei + bucketul facturi-emise restrâns
-- (decizia Răzvan 13.10.2026 prin chat: preview 35 facturi + varianta A + Q1 = A)
-- Obiecte NOI:
--   * fn_facturi_pdf_acces() — owner SAU intrare EXPLICITĂ „financiar” în user_module_access (NU financiar.garantii).
--     Azi: 2 owneri + Cristina Dumitrescu, Mădălina Tănase, Mirela Popescu, Oana Nica.
--   * fn_factura_ataseaza_pdf(p_id, p_pdf_path, p_nas_path) — DOAR owner: leagă un PDF deja urcat în facturi-emise de
--     o factură fără PDF. Un singur UPDATE: pdf_path + nas_synced = true + nas_path (calea EXISTENTĂ de pe NAS), doar
--     WHERE pdf_path IS NULL → containerul facturi-sync (ia pdf_path NOT NULL AND nas_synced = false) nu le re-scrie.
--     Idempotent: aceeași legare repetată (răspuns pierdut) întoarce ok + deja=true. nas_path = afirmația owner-ului
--     (UI-ul cere confirmarea explicită că fișierele sunt alese direct din folderul NAS).
-- Politici storage.objects „facturi_storage_*” (azi: orice authenticated, pentru toate 4 operațiile):
--   select / insert / update → bucket facturi-emise AND fn_facturi_pdf_acces()   (upload-ul din Financiar folosește upsert)
--   delete                   → bucket facturi-emise AND fn_is_app_owner(auth.uid())
-- Edge-urile / containerul cu service_role nu sunt afectate (ocolesc RLS). Tabela facturi_emise NU se atinge aici.
-- Revenire: supabase/revenire/20261028b_facturi_emise_pdf_ROLLBACK.sql (expresiile vechi exacte + DROP funcții).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  c_vechi CONSTANT text := '((bucket_id = ''facturi-emise''::text) AND (auth.uid() IS NOT NULL))';
  r record;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028b_facturi_emise_pdf:' || txid_current() THEN
    RAISE EXCEPTION '20261028b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_facturi_pdf_acces()') IS NOT NULL
     OR to_regprocedure('public.fn_factura_ataseaza_pdf(bigint,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261028b: obiectele exista deja';
  END IF;
  IF to_regprocedure('public.fn_is_app_owner(uuid)') IS NULL THEN RAISE EXCEPTION '20261028b: fn_is_app_owner lipseste'; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'facturi_storage_%') <> 4 THEN
    RAISE EXCEPTION '20261028b: numar politici facturi_storage_* neasteptat';
  END IF;
  -- precondiții exacte pe expresiile de azi
  FOR r IN SELECT p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) w,
                  p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid] ok_rol
             FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname LIKE 'facturi_storage_%' LOOP
    IF NOT r.ok_rol
       OR (r.polname = 'facturi_storage_select' AND (r.polcmd <> 'r' OR r.q IS DISTINCT FROM c_vechi OR r.w IS NOT NULL))
       OR (r.polname = 'facturi_storage_delete' AND (r.polcmd <> 'd' OR r.q IS DISTINCT FROM c_vechi OR r.w IS NOT NULL))
       OR (r.polname = 'facturi_storage_insert' AND (r.polcmd <> 'a' OR r.q IS NOT NULL OR r.w IS DISTINCT FROM c_vechi))
       OR (r.polname = 'facturi_storage_update' AND (r.polcmd <> 'w' OR r.q IS DISTINCT FROM c_vechi OR r.w IS DISTINCT FROM c_vechi)) THEN
      RAISE EXCEPTION '20261028b: preconditie %', r.polname;
    END IF;
  END LOOP;
END $pre$;

CREATE FUNCTION public.fn_facturi_pdf_acces()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT auth.uid() IS NOT NULL AND (
    public.fn_is_app_owner(auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access m WHERE m.profile_id = auth.uid() AND m.module = 'financiar'))
$f$;
REVOKE ALL ON FUNCTION public.fn_facturi_pdf_acces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_facturi_pdf_acces() TO authenticated;

CREATE FUNCTION public.fn_factura_ataseaza_pdf(p_id bigint, p_pdf_path text, p_nas_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_nr text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_app_owner(auth.uid()) THEN
    RAISE EXCEPTION 'fn_factura_ataseaza_pdf: doar owner' USING ERRCODE = '42501';
  END IF;
  IF p_pdf_path IS NULL OR p_pdf_path !~ '^[0-9]{4}/[A-Za-z0-9._-]+\.pdf$' THEN
    RAISE EXCEPTION 'fn_factura_ataseaza_pdf: cale Storage invalida';
  END IF;
  IF p_nas_path IS NULL OR p_nas_path !~ '^/data/facturi/Facturi [0-9]{4}/[^/]+\.pdf$' OR p_nas_path ~ '[[:cntrl:]]' OR length(p_nas_path) > 300 THEN
    RAISE EXCEPTION 'fn_factura_ataseaza_pdf: cale NAS invalida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'facturi-emise' AND name = p_pdf_path) THEN
    RAISE EXCEPTION 'fn_factura_ataseaza_pdf: fisierul % nu e in bucket', p_pdf_path;
  END IF;
  UPDATE public.facturi_emise
     SET pdf_path = p_pdf_path, nas_synced = true, nas_path = p_nas_path
   WHERE id = p_id AND pdf_path IS NULL
     AND split_part(p_pdf_path, '/', 1) = an::text AND p_nas_path LIKE '/data/facturi/Facturi ' || an || '/%'  -- anul facturii
  RETURNING nr_complet INTO v_nr;
  IF v_nr IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'nr_complet', v_nr, 'deja', false);
  END IF;
  -- idempotent: reîncercarea după un răspuns pierdut găsește exact aceeași legare
  SELECT nr_complet INTO v_nr FROM public.facturi_emise
   WHERE id = p_id AND pdf_path = p_pdf_path AND nas_path = p_nas_path AND nas_synced;
  IF v_nr IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'nr_complet', v_nr, 'deja', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'motiv', 'factura inexistenta sau are alt PDF');
END
$f$;
REVOKE ALL ON FUNCTION public.fn_factura_ataseaza_pdf(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_factura_ataseaza_pdf(bigint, text, text) TO authenticated;

ALTER POLICY facturi_storage_select ON storage.objects
  USING ((bucket_id = 'facturi-emise'::text) AND public.fn_facturi_pdf_acces());
ALTER POLICY facturi_storage_insert ON storage.objects
  WITH CHECK ((bucket_id = 'facturi-emise'::text) AND public.fn_facturi_pdf_acces());
ALTER POLICY facturi_storage_update ON storage.objects
  USING ((bucket_id = 'facturi-emise'::text) AND public.fn_facturi_pdf_acces())
  WITH CHECK ((bucket_id = 'facturi-emise'::text) AND public.fn_facturi_pdf_acces());
ALTER POLICY facturi_storage_delete ON storage.objects
  USING ((bucket_id = 'facturi-emise'::text) AND public.fn_is_app_owner(auth.uid()));

DO $post$
DECLARE
  c_acces CONSTANT text := '((bucket_id = ''facturi-emise''::text) AND fn_facturi_pdf_acces())';
  c_owner CONSTANT text := '((bucket_id = ''facturi-emise''::text) AND fn_is_app_owner(auth.uid()))';
  r record; n integer := 0;
BEGIN
  FOR r IN SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) w
             FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass AND p.polname LIKE 'facturi_storage_%' LOOP
    n := n + 1;
    IF (r.polname = 'facturi_storage_select' AND (r.q IS DISTINCT FROM c_acces OR r.w IS NOT NULL))
       OR (r.polname = 'facturi_storage_insert' AND (r.q IS NOT NULL OR r.w IS DISTINCT FROM c_acces))
       OR (r.polname = 'facturi_storage_update' AND (r.q IS DISTINCT FROM c_acces OR r.w IS DISTINCT FROM c_acces))
       OR (r.polname = 'facturi_storage_delete' AND (r.q IS DISTINCT FROM c_owner OR r.w IS NOT NULL)) THEN
      RAISE EXCEPTION '20261028b: postconditie % (q=%, w=%)', r.polname, r.q, r.w;
    END IF;
  END LOOP;
  IF n <> 4
     OR has_function_privilege('anon', 'public.fn_factura_ataseaza_pdf(bigint,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_facturi_pdf_acces()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_is_app_owner(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_facturi_pdf_acces()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_factura_ataseaza_pdf(bigint,text,text)', 'EXECUTE')
     OR NOT (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc
              WHERE oid IN ('public.fn_facturi_pdf_acces()'::regprocedure, 'public.fn_factura_ataseaza_pdf(bigint,text,text)'::regprocedure)) THEN
    RAISE EXCEPTION '20261028b: postconditie drepturi functii';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028b_facturi_emise_pdf:' || txid_current() THEN
    RAISE EXCEPTION '20261028b: garda final invalida';
  END IF;
END $post$;
