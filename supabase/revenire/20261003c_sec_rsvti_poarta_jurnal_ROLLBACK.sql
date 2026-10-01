-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20261003c_sec_rsvti_poarta_jurnal.sql (SEC RSVTI, 03.10.2026, runda 3 din 30.09).
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (verdict Copilot pe runda 2). Stă în
--   supabase/revenire/, în afara migrărilor forward: niciun runner nu parcurge acest director (supabase/revenire/README.md).
--   Readuce EXACT starea de azi a producției și deci REDESCHIDE GAURA (orice cont logat poate prelungi viza RSVTI a
--   oricui cu orice dată și poate scrie direct în jurnal în numele oricui). Există pentru harness-ul de teste (dovada
--   că migrarea se desface curat: schema după rollback = schema dinainte). O eventuală folosire în producție cere
--   decizia explicită a lui Răzvan, cu motivul consemnat, și un review separat (Copilot) — comutatorul de armare NU e
--   o autorizare.
--
-- Tranzacția: fișierul NU conține BEGIN/COMMIT — gestionarul e operatorul. Execuția documentată = UN SINGUR string:
--     BEGIN;
--     SELECT set_config('gazpet.rollback_tehnic_20261003c', 'REDESCHIDE_GAURA_RSVTI:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
--
-- Siguranțe (runda 3):
--   1. Armare PERSISTENTĂ = refuz: orice ALTER DATABASE / ALTER ROLE … SET gazpet.rollback_tehnic_20261003c (în
--      pg_db_role_setting; numele GUC nu ține cont de majuscule, deci comparat cu lower()), chiar dacă armarea
--      tranzacției e validă. Ar transforma rollback-ul într-o capcană pentru orice sesiune viitoare.
--   2. Armarea e LEGATĂ DE TRANZACȚIA CURENTĂ: valoarea trebuie să fie 'REDESCHIDE_GAURA_RSVTI:' || txid_current().
--      set_config(…, true) moare la COMMIT/ROLLBACK; o setare rămasă în sesiune (SET, set_config(…, false), armare
--      dintr-o tranzacție anterioară sau eșuată) poartă alt txid ⇒ refuz 42501, nimic schimbat.
--   3. PRECONDIȚII: starea curentă = EXACT patch-ul 20261003c runda 3 (md5 RPC 6185a9dd… + semnătura DEFAULT NULL::date,
--      helper a59aeb46… + atribute + ACL, politica din patch = singura de scriere pe jurnal). Peste o corecție
--      ulterioară ⇒ refuz: varianta fără poartă nu se readuce tacit peste o versiune neanalizată.
--   4. POSTCONDIȚII: RPC = live 29.09 (md5 527c0e47… + DEFAULT CURRENT_DATE), helper absent, politica veche = singura
--      de scriere, RLS activ, privilegiile efective de azi. Altfel se anulează tot: fișierul e UN SINGUR bloc DO (o
--      singură instrucțiune), iar o dependență nouă de helper face DROP FUNCTION să eșueze (fail-closed).
--   5. DEZARMARE la final, și la nivel de sesiune.
--
-- Revenirea operațională (PĂSTREAZĂ poarta) — docs/SECURITATE_PATCH_RSVTI.md §6:
--   * un utilizator legitim refuzat (42501 „Nu ai dreptul să confirmi viza RSVTI…”): dreptul se dă prin
--     mecanismul existent (department HR/Administrativ sau can_modify_employees, setate de owner), cu
--     acordul lui Răzvan (CLAUDE.md pct. 3 — drepturi); funcția rămâne;
--   * o dată refuzată (22023): se verifică documentele și versiunea autorizației (ex. „Reînnoiește” cu viza
--     autorizației vechi). Refuzul „înainte de emitere” NU dovedește că data_emitere e greșită, iar o dată reală nu
--     se modifică doar ca să treacă validarea. Pragul 2000-01-01 e o regulă de business, nu o dovadă că orice dată
--     anterioară e o greșeală; un caz real sub prag se discută, nu se forțează;
--   * funcția defectă: CREATE OR REPLACE cu corecția, revizuit (GO Copilot) — niciodată întoarcerea la
--     varianta fără poartă.
-- Migrarea nu modifică date → nu e nimic de restaurat în rânduri.
-- ============================================================================
DO $rollback_tehnic$
DECLARE
  v_md5     text;
  v_arg     text;
  v_n       integer;
  v_ok      integer;
  v_corp_ok boolean;
  v_atr_ok  boolean;
  v_acl_ok  boolean;
  v_are     boolean;
  r         record;
BEGIN
  -- 1. Armare persistentă = refuz (numele GUC-urilor nu țin cont de majuscule, deci nici căutarea)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.rollback_tehnic_20261003c') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003c blocat: comutatorul e armat PERSISTENT (ALTER DATABASE/ROLE … SET gazpet.rollback_tehnic_20261003c, în pg_db_role_setting). Armarea e valabilă doar în tranzacția rollback-ului: șterge întâi setarea (ALTER DATABASE/ROLE … RESET) și află cine a pus-o.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Armarea: în ACEEAȘI tranzacție, legată de txid-ul ei (o setare rămasă din altă tranzacție nu armează)
  IF current_setting('gazpet.rollback_tehnic_20261003c', true) IS DISTINCT FROM ('REDESCHIDE_GAURA_RSVTI:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003c blocat: redeschide gaura RSVTI. Artefact fără GO de execuție: doar la decizia explicită a lui Răzvan + review. Armarea se face în aceeași tranzacție, imediat după BEGIN: SELECT set_config(''gazpet.rollback_tehnic_20261003c'', ''REDESCHIDE_GAURA_RSVTI:'' || txid_current(), true); — o setare de sesiune sau din altă tranzacție (inclusiv eșuată) nu armează. Revenirea care păstrează poarta: docs/SECURITATE_PATCH_RSVTI.md §6.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Precondiții: starea curentă = EXACT patch-ul 20261003c (runda 3)
  SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_md5, v_arg
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)');
  IF v_md5 IS DISTINCT FROM '6185a9ddf13a9e666368858decfa9611'
     OR v_arg IS DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text' THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: confirm_hr_autorizatie_rsvti nu e versiunea patch-ului (md5 %, argumente: %) — o corecție ulterioară nu se înlocuiește tacit cu varianta fără poartă; se reanalizează', v_md5, v_arg
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'fn_poate_scrie_hr_autorizatii';
  SELECT md5(p.prosrc) IS NOT DISTINCT FROM 'a59aeb46d5007222067276184a63aaa0',
         (l.lanname::text IS NOT DISTINCT FROM 'sql' AND p.provolatile IS NOT DISTINCT FROM 's'::"char"
          AND p.prosecdef IS NOT DISTINCT FROM true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
          AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
          AND p.prorettype IS NOT DISTINCT FROM 'boolean'::regtype::oid AND p.proretset IS NOT DISTINCT FROM false
          AND p.prokind IS NOT DISTINCT FROM 'f'::"char"),
         (SELECT array_agg(s.e ORDER BY s.e COLLATE "C")
            FROM (SELECT format('%s:%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                a.privilege_type, a.is_grantable::text) AS e
                    FROM aclexplode(p.proacl) a) s)
           IS NOT DISTINCT FROM ARRAY['authenticated:EXECUTE:false', 'postgres:EXECUTE:false', 'service_role:EXECUTE:false']
    INTO v_corp_ok, v_atr_ok, v_acl_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.fn_poate_scrie_hr_autorizatii()');
  IF v_n IS DISTINCT FROM 1 OR v_corp_ok IS NOT TRUE OR v_atr_ok IS NOT TRUE OR v_acl_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: fn_poate_scrie_hr_autorizatii lipsește sau nu e versiunea patch-ului (funcții cu acest nume: %, corp md5: %, atribute: %, ACL: %); se reanalizează',
      v_n, coalesce(v_corp_ok::text, 'absent'), coalesce(v_atr_ok::text, 'absent'), coalesce(v_acl_ok::text, 'absent')
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_autorizat'
     AND cmd IS NOT DISTINCT FROM 'INSERT' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE'
     AND roles::text IS NOT DISTINCT FROM '{authenticated}' AND qual IS NULL
     AND md5(with_check) IS NOT DISTINCT FROM '780014ba883836d16ffb7a014c7430c6';
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: jurnalul are % politici de scriere (% = cea din patch) — așteptat exact politica din patch; se reanalizează', v_n, v_ok
      USING ERRCODE = '55000';
  END IF;

  -- 4. Restaurarea stării LIVE din 29.09 (RPC verbatim pg_get_functiondef; md5(prosrc) = 527c0e4708dfe1f88cec03a77b6a26dd).
  --    Semnătura revine la DEFAULT CURRENT_DATE (același tip, același număr de valori implicite ⇒ acceptat).
  EXECUTE $def_rpc$CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text)
 RETURNS hr_autorizatii_rsvti_confirmari
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aut public.hr_autorizatii%rowtype;
  v_tip public.hr_autorizatii_tipuri%rowtype;
  v_user uuid := auth.uid();
  v_next date;
  v_row public.hr_autorizatii_rsvti_confirmari%rowtype;
begin
  select * into v_aut
  from public.hr_autorizatii
  where id = p_autorizatie_id
    and deleted_at is null;

  if not found then
    raise exception 'Autorizatia nu exista sau este stearsa';
  end if;

  select * into v_tip
  from public.hr_autorizatii_tipuri
  where id = v_aut.tip_id;

  if not coalesce(v_tip.necesita_confirmare_rsvti, false) then
    raise exception 'Tipul de autorizatie nu necesita confirmare RSVTI';
  end if;

  v_next := (coalesce(p_data_confirmare, current_date) + make_interval(months => coalesce(v_tip.interval_confirmare_rsvti_luni, 6)))::date;

  insert into public.hr_autorizatii_rsvti_confirmari (
    autorizatie_id,
    employee_id,
    data_confirmare,
    urmatoarea_confirmare,
    confirmat_de,
    observatii
  ) values (
    p_autorizatie_id,
    v_aut.employee_id,
    coalesce(p_data_confirmare, current_date),
    v_next,
    v_user,
    nullif(trim(coalesce(p_observatii, '')), '')
  )
  returning * into v_row;

  update public.hr_autorizatii
  set rsvti_ultima_confirmare = v_row.data_confirmare,
      rsvti_urmatoarea_confirmare = v_row.urmatoarea_confirmare,
      rsvti_confirmat_de = v_user,
      rsvti_confirmat_la = now(),
      rsvti_observatii = nullif(trim(coalesce(p_observatii, '')), ''),
      modificat_la = now()
  where id = p_autorizatie_id;

  return v_row;
end;
$function$
$def_rpc$;
  REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;
  COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) IS NULL;

  -- Jurnalul: politica INSERT și GRANT-urile de azi
  DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari;
  DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari;
  CREATE POLICY hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari
    FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));
  GRANT INSERT, UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari TO anon;
  GRANT UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari TO authenticated;

  -- Helperul (după ce nicio politică nu-l mai folosește; o dependență nouă ⇒ eroare ⇒ se anulează tot)
  DROP FUNCTION public.fn_poate_scrie_hr_autorizatii();

  -- 5. Postcondiții: starea rezultată = EXACT starea live din 29.09
  SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_md5, v_arg
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)');
  IF v_md5 IS DISTINCT FROM '527c0e4708dfe1f88cec03a77b6a26dd'
     OR v_arg IS DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text'
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_poate_scrie_hr_autorizatii') IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261003c: RPC-ul rezultat nu e byte-identic cu starea din 29.09 (corp sau semnătură) sau helperul n-a dispărut';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_authenticated'
     AND cmd IS NOT DISTINCT FROM 'INSERT' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE'
     AND roles::text IS NOT DISTINCT FROM '{authenticated}' AND qual IS NULL
     AND md5(with_check) IS NOT DISTINCT FROM 'dc71e447411e7aaf354179a11ad2e2ae';
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261003c: politica de scriere a jurnalului nu e cea din 29.09 (% politici, % conforme) sau RLS e oprit', v_n, v_ok;
  END IF;
  -- privilegiile efective de azi (PUBLIC, moștenire, coloane incluse): RPC doar authenticated; jurnalul cu GRANT-urile largi
  FOR r IN SELECT * FROM (VALUES
      ('public', 'EXECUTE', false), ('anon', 'EXECUTE', false), ('authenticated', 'EXECUTE', true)) AS x(rol, priv, asteptat)
  LOOP
    IF has_function_privilege(r.rol, 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)', r.priv) IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'Postcondiție rollback 20261003c: privilegiul efectiv EXECUTE pe RPC pentru % nu e cel din 29.09 (așteptat %)', r.rol, r.asteptat::text;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public', 'INSERT', false), ('public', 'UPDATE', false), ('public', 'DELETE', false),
      ('anon', 'INSERT', true), ('anon', 'UPDATE', true), ('anon', 'DELETE', true),
      ('authenticated', 'INSERT', true), ('authenticated', 'UPDATE', true), ('authenticated', 'DELETE', true)) AS x(rol, priv, asteptat)
  LOOP
    v_are := CASE WHEN r.priv IS NOT DISTINCT FROM 'DELETE'
                  THEN has_table_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', r.priv)
                  ELSE has_any_column_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', r.priv) END;
    IF v_are IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'Postcondiție rollback 20261003c: privilegiul efectiv % pe jurnal pentru % = % (așteptat %, ca în 29.09)', r.priv, r.rol, v_are::text, r.asteptat::text;
    END IF;
  END LOOP;

  -- 6. Dezarmare (și la nivel de sesiune, dacă cineva a armat și cu set_config(…, false) în aceeași tranzacție)
  PERFORM set_config('gazpet.rollback_tehnic_20261003c', '', false);
  RAISE WARNING 'ROLLBACK TEHNIC 20261003c aplicat: gaura RSVTI e REDESCHISĂ (RPC fără poartă, jurnal falsificabil).';
END $rollback_tehnic$;
