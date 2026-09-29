-- ============================================================================
-- ROLLBACK TEHNIC pentru 20261003c_sec_rsvti_poarta_jurnal.sql (SEC RSVTI, 03.10.2026).
--
-- ⚠ NU este procedura de revenire operațională: readuce EXACT starea de azi a producției și deci
--   REDESCHIDE GAURA (orice cont logat poate prelungi viza RSVTI a oricui cu orice dată și poate
--   scrie direct în jurnal în numele oricui). Există pentru harness-ul de teste (dovada că migrarea se
--   desface curat: schema după rollback = schema dinainte) și se rulează în producție DOAR la cererea
--   explicită a lui Răzvan, cu motivul consemnat.
--
-- Revenirea operațională (PĂSTREAZĂ poarta) — docs/SECURITATE_PATCH_RSVTI.md §6:
--   * un utilizator legitim refuzat (42501 „Nu ai dreptul să confirmi viza RSVTI…”): dreptul se dă prin
--     mecanismul existent (department HR/Administrativ sau can_modify_employees, setate de owner), cu
--     acordul lui Răzvan (CLAUDE.md pct. 3 — drepturi); funcția rămâne;
--   * o dată legitimă refuzată (22023): în viitor = greșeală de introducere; înainte de emitere = data_emitere
--     greșită în fișă → se corectează fișa (Editează), apoi se confirmă viza;
--   * funcția defectă: CREATE OR REPLACE cu corecția, revizuit (GO Copilot) — niciodată întoarcerea la
--     varianta fără poartă.
-- Migrarea nu modifică date → nu e nimic de restaurat în rânduri.
-- ============================================================================

-- 1. RPC-ul LIVE din 29.09 (verbatim pg_get_functiondef; md5(prosrc) = 527c0e4708dfe1f88cec03a77b6a26dd)
CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text)
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
$function$;
REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) IS NULL;

-- 2. Jurnalul: politica INSERT și GRANT-urile de azi
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari;
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari;
CREATE POLICY hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari
  FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));
GRANT INSERT, UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari TO anon;
GRANT UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari TO authenticated;

-- 3. Helperul (după ce nicio politică nu-l mai folosește)
DROP FUNCTION IF EXISTS public.fn_poate_scrie_hr_autorizatii();
