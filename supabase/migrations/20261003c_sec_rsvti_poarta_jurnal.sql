-- ============================================================================
-- SEC RSVTI (P1 / constatarea (1) din docs/SECURITATE_ADVISORS_2026-09-30.md) — 03.10.2026
-- Poarta pe confirm_hr_autorizatie_rsvti + jurnalul hr_autorizatii_rsvti_confirmari, TRATATE ÎMPREUNĂ.
--
-- ⚠ NEAPLICAT. Se aplică doar după GO Copilot pe revizie + acordul explicit al lui Răzvan
--   (pașii: docs/SECURITATE_PATCH_RSVTI.md §7). Nu atinge Ofertare, date, profiles sau alte funcții.
--
-- Gaura (azi, verificată pe definițiile live din 29.09):
--   * RPC-ul e SECURITY DEFINER, apelabil de orice cont logat, FĂRĂ poartă → ocolește RLS pe hr_autorizatii
--     (unde scrie doar grupul HR/Administrativ/owner/superadmin/can_modify_employees) și acceptă ORICE dată:
--     p_data_confirmare = '2099-01-01' ⇒ viza „valabilă” până în 2099-07-01 (ascunde o viză expirată);
--   * jurnalul se poate falsifica direct prin REST: politica INSERT e doar „auth.uid() IS NOT NULL”,
--     cu orice confirmat_de / date / scadență.
--
-- Ce face:
--   1. fn_poate_scrie_hr_autorizatii() — SURSA UNICĂ DE ADEVĂR pentru „cine scrie autorizații HR”:
--      predicat IDENTIC cu politica hr_autorizatii_write_authorized (verificat în precondiții: textul
--      politicii live și faptul că e singura politică de scriere pe hr_autorizatii). Nu schimbă dreptul nimănui.
--   2. confirm_hr_autorizatie_rsvti — același contract (semnătură, tip returnat, efecte), plus:
--      a) poarta, ÎNAINTE de orice citire/scriere: identitate explicită = sub-ul JWT rezolvat la un profil
--         care trece fn_poate_scrie_hr_autorizatii(); fără identitate (auth.uid() NULL: service_role,
--         conexiune directă, claims golite) ⇒ REFUZ 42501 — nicio decizie „uid NULL ⇒ sistem” (model S-A);
--      b) regula datei: p_data_confirmare = data confirmării EFECTUATE (UI: „Data ultimei vize”, HR.jsx
--         ~L2005, și „data confirmării vizei”, ~L2108) ⇒ nu în viitor (> azi în Europe/Bucharest,
--         independent de TimeZone-ul sesiunii) și nu înainte de data_emitere (dacă e completată);
--      c) scadența următoarei confirmări se calculează AICI din tipul autorizației (neschimbat);
--         apelantul nu o poate trimite (semnătura nu are un astfel de parametru).
--   3. Jurnalul:
--      a) politica INSERT (orice cont logat) → înlocuită cu una pe aceeași sursă de adevăr + atribuire:
--         confirmat_de = cel care inserează (nu se mai poate semna în numele altcuiva);
--      b) REVOKE UPDATE, DELETE de la anon și authenticated: azi NU există politici UPDATE/DELETE, deci
--         RLS le refuză deja (0 rânduri) — REVOKE-ul nu schimbă niciun comportament, doar închide GRANT-ul;
--      c) REVOKE INSERT de la anon: nu există politică INSERT pentru anon (RLS refuză deja).
--   RPC-ul scrie în continuare (proprietar postgres, ocolește RLS) — calea legitimă a UI-ului rămâne.
--
-- Revenire: …_ROLLBACK.sql = rollback TEHNIC (redeschide gaura; doar la cererea explicită a lui Răzvan).
--           Revenirea operațională (păstrează poarta): docs/SECURITATE_PATCH_RSVTI.md §6.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Precondiții — fail-closed dacă producția s-a schimbat față de analiza din 29.09
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_pol record;
  v_n   integer;
  v_md5 text;
BEGIN
  -- 0a. politica sursă: textul analizat, ALL, authenticated, permisivă
  SELECT * INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND policyname = 'hr_autorizatii_write_authorized';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Precondiție: politica hr_autorizatii_write_authorized lipsește';
  END IF;
  IF v_pol.cmd <> 'ALL' OR v_pol.permissive <> 'PERMISSIVE' OR v_pol.roles::text <> '{authenticated}'
     OR md5(regexp_replace(v_pol.qual, '\s+', ' ', 'g'))       <> 'cc78b7fd25efb09a9a572d7b6d8f554b'
     OR md5(regexp_replace(v_pol.with_check, '\s+', ' ', 'g')) <> 'cc78b7fd25efb09a9a572d7b6d8f554b' THEN
    RAISE EXCEPTION 'Precondiție: hr_autorizatii_write_authorized s-a schimbat față de analiza din 29.09 — fn_poate_scrie_hr_autorizatii() n-ar mai fi identică; se reanalizează';
  END IF;
  -- 0b. e SINGURA politică prin care se scrie în hr_autorizatii (altfel „sursa unică” ar fi incompletă)
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Precondiție: hr_autorizatii are % politici de scriere (așteptat 1)', v_n;
  END IF;
  -- 0c. sursa drepturilor nu se poate autoatribui: is_owner/role (prevent_role_escalation),
  --     can_modify_employees (enforce_owner_only_salary_flags), department (S-A, live din 29.09 20:21 UTC)
  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgname = 'prevent_role_escalation_trigger'     AND p.prosrc LIKE '%OLD.role IS DISTINCT FROM NEW.role%'
                                                             AND p.prosrc LIKE '%OLD.is_owner IS DISTINCT FROM NEW.is_owner%')
       OR (t.tgname = 'trg_enforce_owner_only_salary_flags' AND p.prosrc LIKE '%NEW.can_modify_employees := OLD.can_modify_employees%')
       OR (t.tgname = 'trg_profiles_campuri_owner_only'     AND p.prosrc LIKE '%NEW.department%IS DISTINCT FROM OLD.department%'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Precondiție: protecțiile pe profiles (role/is_owner, can_modify_employees, department/S-A) nu sunt toate active (%/3) — poarta s-ar putea ocoli prin autoatribuire', v_n;
  END IF;
  -- 0d. RPC-ul e cel analizat (live 29.09) sau deja cel din acest patch (reaplicare)
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
   WHERE oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure;
  IF v_md5 NOT IN ('527c0e4708dfe1f88cec03a77b6a26dd', '49a9d3a7fb8f30d9cb043db25f97f57f') THEN
    RAISE EXCEPTION 'Precondiție: confirm_hr_autorizatie_rsvti diferă de versiunea analizată (md5 %)', v_md5;
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Sursa unică de adevăr: cine scrie autorizații HR (= hr_autorizatii_write_authorized)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_poate_scrie_hr_autorizatii()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner = true
            OR p.can_modify_employees = true
            OR p.role = 'superadmin'
            OR p.department = ANY (ARRAY['HR', 'Administrativ']))
  )
$fn$;
-- Politica jurnalului o evaluează ca authenticated ⇒ EXECUTE necesar. Întoarce doar dreptul apelantului.
REVOKE ALL ON FUNCTION public.fn_poate_scrie_hr_autorizatii() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_hr_autorizatii() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_poate_scrie_hr_autorizatii() IS
  'SEC RSVTI 03.10.2026: sursa unică pentru „cine scrie autorizații HR” — predicat identic cu politica hr_autorizatii_write_authorized (owner, can_modify_employees, superadmin, department HR/Administrativ). Fără identitate (auth.uid() NULL) ⇒ false.';

-- ---------------------------------------------------------------------------
-- 2. RPC-ul: poartă + regula datei; scadența calculată aici
-- ---------------------------------------------------------------------------
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
  -- data confirmării EFECTUATE (nu scadența); NULL explicit = azi, ca înainte
  v_data date := coalesce(p_data_confirmare, current_date);
  -- „azi” pentru o firmă din România, independent de TimeZone-ul sesiunii (UTC în producție)
  v_azi  date := (now() at time zone 'Europe/Bucharest')::date;
  v_next date;
  v_row public.hr_autorizatii_rsvti_confirmari%rowtype;
begin
  -- (a) Poarta — înainte de orice citire/scriere. Identitate explicită: sub-ul JWT al unui profil cu drept
  --     (aceeași sursă ca politica hr_autorizatii_write_authorized). Fără identitate ⇒ refuz, nu „sistem”.
  if v_user is null or not public.fn_poate_scrie_hr_autorizatii() then
    raise exception 'Nu ai dreptul să confirmi viza RSVTI (doar HR/Administrativ, owner, superadmin sau can_modify_employees)'
      using errcode = '42501';
  end if;

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

  -- (b) Regula datei: o confirmare efectuată nu poate fi în viitor și nici înainte de emiterea autorizației
  if v_data > v_azi then
    raise exception 'Data confirmării (%) nu poate fi în viitor (azi: %)', v_data, v_azi
      using errcode = '22023';
  end if;
  if v_aut.data_emitere is not null and v_data < v_aut.data_emitere then
    raise exception 'Data confirmării (%) nu poate fi înainte de emiterea autorizației (%)', v_data, v_aut.data_emitere
      using errcode = '22023';
  end if;

  -- (c) Scadența următoarei confirmări: calculată din tipul autorizației, nu primită de la apelant
  v_next := (v_data + make_interval(months => coalesce(v_tip.interval_confirmare_rsvti_luni, 6)))::date;

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
    v_data,
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
-- ACL neschimbat (UI-ul îl apelează ca authenticated); reafirmat idempotent.
REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) IS
  'SEC RSVTI 03.10.2026: poartă fn_poate_scrie_hr_autorizatii() (42501), dată confirmare efectuată ≤ azi (Europe/Bucharest) și ≥ data_emitere (22023); scadența = data + interval_confirmare_rsvti_luni al tipului (implicit 6).';

-- ---------------------------------------------------------------------------
-- 3. Jurnalul: aceeași sursă de adevăr la INSERT direct; fără UPDATE/DELETE din API
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari;
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari;
CREATE POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_poate_scrie_hr_autorizatii()) AND confirmat_de = (SELECT auth.uid()));
COMMENT ON POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari IS
  'SEC RSVTI 03.10.2026: INSERT direct doar pentru cine scrie autorizații HR (fn_poate_scrie_hr_autorizatii) și doar în nume propriu. Calea normală rămâne RPC-ul confirm_hr_autorizatie_rsvti.';

REVOKE UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari FROM anon, authenticated;
REVOKE INSERT ON public.hr_autorizatii_rsvti_confirmari FROM anon;
