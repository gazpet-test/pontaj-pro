-- ============================================================================
-- ROLLBACK TEHNIC pentru 20261003c_sec_rsvti_poarta_jurnal.sql (SEC RSVTI, 03.10.2026, runda 2 din 30.09).
--
-- ⚠ NU este procedura de revenire operațională: readuce EXACT starea de azi a producției și deci
--   REDESCHIDE GAURA (orice cont logat poate prelungi viza RSVTI a oricui cu orice dată și poate
--   scrie direct în jurnal în numele oricui). Există pentru harness-ul de teste (dovada că migrarea se
--   desface curat: schema după rollback = schema dinainte) și se rulează în producție DOAR la cererea
--   explicită a lui Răzvan, cu motivul consemnat.
--
-- Siguranțe (runda 2, constatarea S3 a verificatorului):
--   1. ARMARE explicită, proprie acestui rollback, în ACEEAȘI tranzacție, ca prima linie:
--        SET LOCAL gazpet.rollback_tehnic_20261003c = 'REDESCHIDE_GAURA_RSVTI';
--      SET LOCAL moare odată cu tranzacția (nu rămâne armat în sesiune) și comutatorul e al acestui patch
--      (Ofertare are gazpet.rollback_tehnic_20261003b). Fără armare ⇒ eroare 42501, nimic schimbat.
--   2. PRECONDIȚII: starea curentă e EXACT patch-ul (md5 RPC 42e0528e…, md5 helper a59aeb46…, politica
--      nouă = singura politică de scriere pe jurnal). Peste o corecție ulterioară a RPC-ului (alt md5) ⇒
--      refuz: varianta fără poartă nu se readuce tacit peste o versiune neanalizată.
--   3. POSTCONDIȚII: RPC = live 29.09 (md5 527c0e47…), helper absent, politica veche = singura de scriere,
--      GRANT-urile de azi. Altfel se anulează tot.
--   Tot fișierul e UN SINGUR bloc DO ⇒ nu se poate aplica „pe jumătate”, nici fără tranzacție; o dependență
--   nouă de helper face DROP FUNCTION să eșueze și anulează tot (fail-closed).
--
-- Folosire (doar la cererea explicită a lui Răzvan): preview read-only (md5 curente) → apply_migration cu
--   linia SET LOCAL de mai sus + acest fișier → verificare read-only (md5 RPC = 527c0e47…, helper absent).
-- Revenirea operațională (PĂSTREAZĂ poarta) — docs/SECURITATE_PATCH_RSVTI.md §6:
--   * un utilizator legitim refuzat (42501 „Nu ai dreptul să confirmi viza RSVTI…”): dreptul se dă prin
--     mecanismul existent (department HR/Administrativ sau can_modify_employees, setate de owner), cu
--     acordul lui Răzvan (CLAUDE.md pct. 3 — drepturi); funcția rămâne;
--   * o dată legitimă refuzată (22023): în viitor sau înainte de 2000 = greșeală de introducere; înainte de
--     emitere = data_emitere greșită în fișă → se corectează fișa (Editează), apoi se confirmă viza;
--   * funcția defectă: CREATE OR REPLACE cu corecția, revizuit (GO Copilot) — niciodată întoarcerea la
--     varianta fără poartă.
-- Migrarea nu modifică date → nu e nimic de restaurat în rânduri.
-- ============================================================================
DO $rollback_tehnic$
DECLARE
  v_md5 text;
  v_n   integer;
  v_ok  integer;
BEGIN
  -- 1. Armarea (SET LOCAL propriu, în aceeași tranzacție)
  IF coalesce(current_setting('gazpet.rollback_tehnic_20261003c', true), '') <> 'REDESCHIDE_GAURA_RSVTI' THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003c blocat: redeschide gaura RSVTI. Doar la cererea explicită a lui Răzvan, cu SET LOCAL gazpet.rollback_tehnic_20261003c = ''REDESCHIDE_GAURA_RSVTI''; în aceeași tranzacție. Revenirea care păstrează poarta: docs/SECURITATE_PATCH_RSVTI.md §6.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Precondiții: starea curentă = EXACT patch-ul 20261003c (runda 2)
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
   WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '42e0528ed5af58c0cccc7b801aef4193' THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: confirm_hr_autorizatie_rsvti nu e versiunea patch-ului (md5 %) — o corecție ulterioară nu se înlocuiește tacit cu varianta fără poartă; se reanalizează', v_md5
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fn_poate_scrie_hr_autorizatii()') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'))
        IS DISTINCT FROM 'a59aeb46d5007222067276184a63aaa0' THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: fn_poate_scrie_hr_autorizatii lipsește sau nu e versiunea patch-ului; se reanalizează'
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_autorizat'
     AND cmd = 'INSERT' AND permissive = 'PERMISSIVE' AND roles::text = '{authenticated}' AND qual IS NULL
     AND md5(with_check) = '780014ba883836d16ffb7a014c7430c6';
  IF v_n <> 1 OR v_ok <> 1 THEN
    RAISE EXCEPTION 'Precondiție rollback 20261003c: jurnalul are % politici de scriere (% = cea din patch) — așteptat exact politica din patch; se reanalizează', v_n, v_ok
      USING ERRCODE = '55000';
  END IF;

  -- 3. Restaurarea stării LIVE din 29.09 (RPC verbatim pg_get_functiondef; md5(prosrc) = 527c0e4708dfe1f88cec03a77b6a26dd)
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

  -- 4. Postcondiții: starea rezultată = EXACT starea live din 29.09
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure)
       IS DISTINCT FROM '527c0e4708dfe1f88cec03a77b6a26dd'
     OR to_regprocedure('public.fn_poate_scrie_hr_autorizatii()') IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261003c: RPC-ul rezultat nu e byte-identic cu starea din 29.09 sau helperul n-a dispărut';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname = 'hr_autorizatii_rsvti_confirmari_insert_authenticated'
     AND cmd = 'INSERT' AND permissive = 'PERMISSIVE' AND roles::text = '{authenticated}' AND qual IS NULL
     AND md5(with_check) = 'dc71e447411e7aaf354179a11ad2e2ae';
  IF v_n <> 1 OR v_ok <> 1 THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261003c: politica de scriere a jurnalului nu e cea din 29.09 (% politici, % conforme)', v_n, v_ok;
  END IF;

  -- 5. Dezarmare (și la nivel de sesiune, dacă cineva a folosit SET în loc de SET LOCAL)
  PERFORM set_config('gazpet.rollback_tehnic_20261003c', '', false);
  RAISE WARNING 'ROLLBACK TEHNIC 20261003c aplicat: gaura RSVTI e REDESCHISĂ (RPC fără poartă, jurnal falsificabil).';
END $rollback_tehnic$;
