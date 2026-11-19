-- Revenire 20261229a_administrativ_upa_alerta. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce upa_achizitii la politica veche upa_achizitii_all (ALL, auth.uid() IS NOT NULL, cu rolurile ei de dinainte, păstrate de migrare în
--   comentariul politicii upa_achizitii_citire: roluri_vechi=public|authenticated) și scoate tot ce a creat migrarea: upa_plafon_lunar,
--   upa_luna_inchisa, upa_alerta_jurnal (cu politicile, triggerul și secvența lor) și cele 14 funcții fn_upa_*.
-- REFUZĂ (nimic schimbat) dacă: starea nu e EXACT cea lăsată de migrare (politici, tabele, funcții) sau dacă au apărut DATE noi: o lună închisă,
--   un rând în jurnalul alertei sau un plafon schimbat din ecran (orice rând în afara celui de la aplicare). Lock-urile se iau ÎNAINTE de verificarea
--   datelor (L14). Notificările deja puse în aplicație rămân (sunt mesaje către oameni, nu se șterg).
-- Ordinea: edge-ul upa-plafon-alerta se retrage ÎNAINTE (versiunea anterioară, v9, citește doar logistica_setari / upa_achizitii); ecranul la fel.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261229a_administrativ_upa_alerta_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261229120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri (NOWAIT, ordinea FIXĂ): upa_achizitii -> upa_plafon_lunar -> upa_luna_inchisa -> upa_alerta_jurnal, toate ACCESS EXCLUSIVE.
-- Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_pol text; v_rol text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.upa_plafon_lunar') IS NULL OR to_regclass('public.upa_luna_inchisa') IS NULL OR to_regclass('public.upa_alerta_jurnal') IS NULL
     OR to_regprocedure('public.fn_upa_poate_scrie()') IS NULL THEN
    RAISE EXCEPTION '20261229a revenire: starea nu e cea din 20261229a (tabelele / functiile migrarii lipsesc)';
  END IF;
  -- lock-urile ÎNAINTEA verificării datelor (L14), NOWAIT, ordinea fixă
  LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_plafon_lunar IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_luna_inchisa IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_alerta_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- politicile upa_achizitii: EXACT cele patru ale migrării
  SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | '
                    || (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',' ORDER BY 1) FROM unnest(p.polroles) ro) || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass;
  IF v_pol IS DISTINCT FROM concat_ws(chr(10),
       'upa_achizitii_adaugare | a | authenticated | - | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie)',
       'upa_achizitii_citire | r | authenticated | (auth.uid() IS NOT NULL) | -',
       'upa_achizitii_modificare | w | authenticated | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie) | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie)',
       'upa_achizitii_stergere | d | authenticated | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie) | -') THEN
    RAISE EXCEPTION '20261229a revenire: starea nu e cea din 20261229a (politicile upa_achizitii)';
  END IF;
  SELECT substring(obj_description(p.oid, 'pg_policy') FROM 'roluri_vechi=(public|authenticated)$') INTO v_rol
    FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_citire';
  IF v_rol IS NULL THEN RAISE EXCEPTION '20261229a revenire: rolurile vechi ale politicii (roluri_vechi) lipsesc din comentariu'; END IF;
  -- fără date noi
  IF EXISTS (SELECT 1 FROM public.upa_luna_inchisa) THEN
    RAISE EXCEPTION '20261229a revenire: exista luni inchise (istoric nou); nimic schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_alerta_jurnal) THEN
    RAISE EXCEPTION '20261229a revenire: jurnalul alertei are randuri (istoric nou); nimic schimbat';
  END IF;
  IF (SELECT count(*) FROM public.upa_plafon_lunar) > 1 OR EXISTS (SELECT 1 FROM public.upa_plafon_lunar p WHERE p.sursa <> 'migrare' OR p.setat_de IS NOT NULL) THEN
    RAISE EXCEPTION '20261229a revenire: plafonul a fost schimbat din ecran (configurare noua); nimic schimbat';
  END IF;
END $pre$;

DO $rev$
DECLARE v_rol text;
BEGIN
  SELECT substring(obj_description(p.oid, 'pg_policy') FROM 'roluri_vechi=(public|authenticated)$') INTO v_rol
    FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_citire';
  DROP POLICY upa_achizitii_citire ON public.upa_achizitii;
  DROP POLICY upa_achizitii_adaugare ON public.upa_achizitii;
  DROP POLICY upa_achizitii_modificare ON public.upa_achizitii;
  DROP POLICY upa_achizitii_stergere ON public.upa_achizitii;
  IF v_rol = 'public' THEN
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO public USING (auth.uid() IS NOT NULL);
  ELSE
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);
  END IF;
END $rev$;

DROP TABLE public.upa_alerta_jurnal;
DROP TABLE public.upa_luna_inchisa;
DROP TABLE public.upa_plafon_lunar;
DROP FUNCTION public.fn_upa_alerta_marcheaza(bigint, text, text, text);
DROP FUNCTION public.fn_upa_alerta_proba();
DROP FUNCTION public.fn_upa_alerta_rezerva();
DROP FUNCTION public.fn_upa_alerta_rezerva_la(date);
DROP FUNCTION public.fn_upa_alerta_inscrie(text, date, date, numeric, numeric, numeric, integer, text[], text);
DROP FUNCTION public.fn_upa_plafon_seteaza(numeric, numeric);
DROP FUNCTION public.fn_upa_zile_text(integer);
DROP FUNCTION public.fn_upa_luna_text(date);
DROP FUNCTION public.fn_upa_lei(numeric);
DROP FUNCTION public.fn_upa_destinatari(text);
DROP FUNCTION public.fn_upa_luni(date, integer);
DROP FUNCTION public.fn_upa_plafon_la(date);
DROP FUNCTION public.fn_upa_poate_scrie();
DROP FUNCTION public.fn_upa_luna_inchisa_nemodificabil();

DO $post$
DECLARE v_pol text;
BEGIN
  SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass;
  IF v_pol IS DISTINCT FROM 'upa_achizitii_all | * | P | (auth.uid() IS NOT NULL) | -' THEN
    RAISE EXCEPTION '20261229a revenire: postconditie: politica veche upa_achizitii_all (%)', v_pol;
  END IF;
  IF to_regclass('public.upa_plafon_lunar') IS NOT NULL OR to_regclass('public.upa_luna_inchisa') IS NOT NULL OR to_regclass('public.upa_alerta_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_poate_scrie', 'fn_upa_plafon_la',
                  'fn_upa_luni', 'fn_upa_destinatari', 'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_plafon_seteaza', 'fn_upa_alerta_inscrie',
                  'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza', 'fn_upa_luna_inchisa_nemodificabil'])) THEN
    RAISE EXCEPTION '20261229a revenire: postconditie: obiectele migrarii au ramas';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: garda final invalida';
  END IF;
END $post$;
