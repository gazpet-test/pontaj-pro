-- ════════════════════════════════════════════════════════════════════════════
-- Suitele de comportament pentru 20261003d (se încarcă după schelet; rulează ca superuser local).
--   SELECT t.suita_patch();  -- starea DUPĂ patch: trebuie să treacă pe patch și să PICE pe live
--   SELECT t.suita_gaura();  -- starea LIVE (gaura): trebuie să treacă pe live și să PICE pe patch
-- Fiecare verificare ridică „TEST EȘUAT: <id>” la prima abatere. Controale pozitive în aceeași stare:
-- tabelul are 5 rânduri (service_role le vede), deci „0 rânduri” nu vine dintr-un tabel gol.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
CREATE FUNCTION t.toate() RETURNS text LANGUAGE sql AS $f$ SELECT t.vede('service_role', NULL) $f$;

CREATE FUNCTION t.suita_patch() RETURNS int LANGUAGE plpgsql AS $f$
DECLARE
  n int := 0; v_tot text := t.toate(); r record;
  c_owner uuid := '00000000-0000-4000-8000-000000000121';
  c_hr    uuid := '00000000-0000-4000-8000-000000000126';
  c_fara  uuid := '00000000-0000-4000-8000-000000000301';
BEGIN
  -- E1–E4: edge-ul concediu-mobil (service_role) funcționează ca azi
  PERFORM t.verifica('E1 service_role vede toate cele 5 tokenuri (control pozitiv)', split_part(v_tot, ':', 2), '5'); n := n + 1;
  PERFORM t.verifica('E2 edge: lookup token+activ → employee_id (flux /co)',
    t.ca('service_role', NULL, $q$SELECT employee_id::text FROM public.hr_concediu_tokens WHERE token = 'f1c7f1c7000000000000000000000003' AND activ = true$q$), 'OK:3'); n := n + 1;
  PERFORM t.verifica('E3 service_role poate revoca (UPDATE activ) — anulat',
    t.ca('service_role', NULL, $q$UPDATE public.hr_concediu_tokens SET activ = false WHERE employee_id = 1$q$), 'OK:1'); n := n + 1;
  PERFORM t.verifica('E4 service_role poate reemite (INSERT) — anulat',
    t.ca('service_role', NULL, $q$INSERT INTO public.hr_concediu_tokens (employee_id) VALUES (6)$q$), 'OK:1'); n := n + 1;
  -- I1–I4: conturile care văd azi butonul „🔗 Link mobil” văd EXACT ce văd azi (toate rândurile)
  FOR r IN SELECT * FROM (VALUES
      ('I1 owner fără modul', '00000000-0000-4000-8000-000000000121'::uuid),
      ('I2 HR (modul hr admin)', '00000000-0000-4000-8000-000000000126'),
      ('I3 Ofertare cu modul hr (editor)', '00000000-0000-4000-8000-000000000201'),
      ('I4 sub-modul hr.concedii', '00000000-0000-4000-8000-000000000202')) x(id, uid) LOOP
    PERFORM t.verifica(r.id || ' vede toate tokenurile', t.vede('authenticated', r.uid), v_tot); n := n + 1;
  END LOOP;
  -- N1–N8: conturile fără poarta UI → 0 rânduri (tabelul NU e gol: vezi E1)
  FOR r IN SELECT * FROM (VALUES
      ('N1 cont logat fără modul', '00000000-0000-4000-8000-000000000301'::uuid),
      ('N2 alte module (logistica/ofertare)', '00000000-0000-4000-8000-000000000302'),
      ('N3 capcane: HR / hrana / hr_extern / xhr. / " hr"', '00000000-0000-4000-8000-000000000303'),
      ('N4 departament HR fără modul', '00000000-0000-4000-8000-000000000304'),
      ('N5 superadmin fără modul', '00000000-0000-4000-8000-000000000305'),
      ('N6 can_access_personal_data fără modul', '00000000-0000-4000-8000-000000000306'),
      ('N7 uid fără profil și fără module', '00000000-0000-4000-8000-000000000399'),
      ('N8 authenticated fără sub în JWT', NULL)) x(id, uid) LOOP
    PERFORM t.verifica(r.id || ' → 0 rânduri', t.vede('authenticated', r.uid), 'OK:0:-'); n := n + 1;
  END LOOP;
  -- A1–A3: anon — fără niciun privilegiu (nici citire, nici TRUNCATE)
  PERFORM t.verifica('A1 anon SELECT → refuz de privilegiu', t.vede('anon', NULL), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('A2 anon TRUNCATE → refuz', t.ca('anon', NULL, 'TRUNCATE public.hr_concediu_tokens'), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('A3 anon INSERT → refuz', t.ca('anon', NULL, 'INSERT INTO public.hr_concediu_tokens (employee_id) VALUES (6)'), 'ERR:42501'); n := n + 1;
  -- W1–W8: scrierea prin API rămâne închisă pentru orice cont logat, inclusiv HR și owner (azi: doar service_role)
  FOR r IN SELECT * FROM (VALUES ('fără modul', c_fara), ('HR', c_hr), ('owner', c_owner)) x(id, uid) LOOP
    PERFORM t.verifica('W TRUNCATE ' || r.id, t.ca('authenticated', r.uid, 'TRUNCATE public.hr_concediu_tokens'), 'ERR:42501'); n := n + 1;
  END LOOP;
  PERFORM t.verifica('W4 HR INSERT', t.ca('authenticated', c_hr, 'INSERT INTO public.hr_concediu_tokens (employee_id) VALUES (6)'), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('W5 HR UPDATE', t.ca('authenticated', c_hr, 'UPDATE public.hr_concediu_tokens SET activ = false'), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('W6 HR DELETE', t.ca('authenticated', c_hr, 'DELETE FROM public.hr_concediu_tokens'), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('W7 fără modul UPDATE', t.ca('authenticated', c_fara, 'UPDATE public.hr_concediu_tokens SET token = token'), 'ERR:42501'); n := n + 1;
  PERFORM t.verifica('W8 owner UPDATE (token cunoscut impus)', t.ca('authenticated', c_owner,
    $q$UPDATE public.hr_concediu_tokens SET token = 'f1c7f1c70000000000000000000000ff' WHERE employee_id = 1$q$), 'ERR:42501'); n := n + 1;
  -- P1–P4: privilegii efective (PUBLIC, coloane, opțiune de acordare)
  PERFORM t.verifica('P1 PUBLIC fără SELECT', has_table_privilege('public', 'public.hr_concediu_tokens', 'SELECT')::text, 'false'); n := n + 1;
  PERFORM t.verifica('P2 anon fără privilegiu pe coloane', has_any_column_privilege('anon', 'public.hr_concediu_tokens', 'SELECT')::text, 'false'); n := n + 1;
  PERFORM t.verifica('P3 authenticated fără UPDATE pe coloane', has_any_column_privilege('authenticated', 'public.hr_concediu_tokens', 'UPDATE')::text, 'false'); n := n + 1;
  PERFORM t.verifica('P4 authenticated fără GRANT OPTION', has_table_privilege('authenticated', 'public.hr_concediu_tokens', 'SELECT WITH GRANT OPTION')::text, 'false'); n := n + 1;
  -- R1: robustețe — dacă profiles/user_module_access ar deveni „doar rândul propriu”, HR tot vede
  CREATE POLICY t_tmp_propriu ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (id = auth.uid());
  CREATE POLICY t_tmp_propriu ON public.user_module_access AS RESTRICTIVE FOR SELECT TO authenticated USING (profile_id = auth.uid());
  PERFORM t.verifica('R1 HR vede și cu profiles/module restrânse la rândul propriu', t.vede('authenticated', c_hr), v_tot); n := n + 1;
  PERFORM t.verifica('R2 fără modul tot 0 cu restrângerea', t.vede('authenticated', c_fara), 'OK:0:-'); n := n + 1;
  DROP POLICY t_tmp_propriu ON public.profiles;
  DROP POLICY t_tmp_propriu ON public.user_module_access;
  RETURN n;
END $f$;

-- Starea LIVE: gaura trebuie să existe (orice cont logat citește; anon/authenticated au TRUNCATE)
CREATE FUNCTION t.suita_gaura() RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int := 0; v_tot text := t.toate();
BEGIN
  PERFORM t.verifica('G0 service_role vede 5 (control)', split_part(v_tot, ':', 2), '5'); n := n + 1;
  PERFORM t.verifica('G1 cont fără modul citește TOATE tokenurile', t.vede('authenticated', '00000000-0000-4000-8000-000000000301'), v_tot); n := n + 1;
  PERFORM t.verifica('G2 capcane de prefix citesc toate', t.vede('authenticated', '00000000-0000-4000-8000-000000000303'), v_tot); n := n + 1;
  PERFORM t.verifica('G3 HR citește toate (flux legitim)', t.vede('authenticated', '00000000-0000-4000-8000-000000000126'), v_tot); n := n + 1;
  PERFORM t.verifica('G4 anon SELECT → 0 rânduri (fără politică, dar cu GRANT)', t.vede('anon', NULL), 'OK:0:-'); n := n + 1;
  PERFORM t.verifica('G5 anon are TRUNCATE (ocolește RLS) — anulat', t.ca('anon', NULL, 'TRUNCATE public.hr_concediu_tokens'), 'OK:0'); n := n + 1;
  PERFORM t.verifica('G6 fără modul are TRUNCATE — anulat', t.ca('authenticated', '00000000-0000-4000-8000-000000000301', 'TRUNCATE public.hr_concediu_tokens'), 'OK:0'); n := n + 1;
  PERFORM t.verifica('G7 fără modul UPDATE → 0 rânduri (RLS fără politică de scriere)', t.ca('authenticated', '00000000-0000-4000-8000-000000000301', 'UPDATE public.hr_concediu_tokens SET activ = false'), 'OK:0'); n := n + 1;
  RETURN n;
END $f$;

-- ════════════════════════════════════════════════════════════════════════════
-- RUNDA 2 (verdict Copilot §4)
-- ════════════════════════════════════════════════════════════════════════════
-- Autoatribuire: ca authenticated cu sub = p_uid, încearcă p_sql (escaladarea), apoi citește tokenurile
-- ÎN ACEEAȘI tranzacție. Totul se anulează. Întoarce '<ERR:stare|OK:rânduri> vede=<n>' (fără tokenuri).
CREATE FUNCTION t.escaladare(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text; n bigint; v_n bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; v := 'OK:' || n;
    EXCEPTION WHEN OTHERS THEN v := 'ERR:' || SQLSTATE;
    END;
    SELECT count(*) INTO v_n FROM public.hr_concediu_tokens;
    RAISE EXCEPTION 'sentinela_t_esc' USING DETAIL = v || ' vede=' || v_n;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'sentinela_t_esc' THEN GET STACKED DIAGNOSTICS v = PG_EXCEPTION_DETAIL; RETURN v; END IF;
    RETURN 'ERR_EXT:' || SQLSTATE;
  END;
END $f$;

-- Încercările de autoatribuire (cont fără modul 301, cont cu alte module 302, uid fără profil 399).
CREATE FUNCTION t.incercari_autoatribuire() RETURNS TABLE (id text, rezultat text) LANGUAGE sql AS $f$
  SELECT x.id, t.escaladare(x.uid, x.q) FROM (VALUES
   ('X1 fără modul: UPDATE propriul profil is_owner=true', '00000000-0000-4000-8000-000000000301'::uuid,
      $q$UPDATE public.profiles SET is_owner = true WHERE id = auth.uid()$q$),
   ('X2 fără modul: UPDATE is_owner + can_access_personal_data', '00000000-0000-4000-8000-000000000301',
      $q$UPDATE public.profiles SET is_owner = true, can_access_personal_data = true WHERE id = auth.uid()$q$),
   ('X3 fără modul: INSERT propriul acces hr', '00000000-0000-4000-8000-000000000301',
      $q$INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (auth.uid(), 'hr', 'admin')$q$),
   ('X4 fără modul: INSERT propriul acces hr.concedii', '00000000-0000-4000-8000-000000000301',
      $q$INSERT INTO public.user_module_access (profile_id, module) VALUES (auth.uid(), 'hr.concedii')$q$),
   ('X5 alte module: UPDATE propriul rând logistica → hr', '00000000-0000-4000-8000-000000000302',
      $q$UPDATE public.user_module_access SET module = 'hr' WHERE profile_id = auth.uid()$q$),
   ('X6 fără modul: preia rândul hr al altcuiva (UPDATE profile_id)', '00000000-0000-4000-8000-000000000301',
      $q$UPDATE public.user_module_access SET profile_id = auth.uid() WHERE module = 'hr'$q$),
   ('X7 uid fără profil: INSERT profil propriu is_owner=true', '00000000-0000-4000-8000-000000000399',
      $q$INSERT INTO public.profiles (id, name, is_owner) VALUES (auth.uid(), 'x', true)$q$),
   ('X8 fără modul: DELETE profilul ownerului (nu dă drept, dar nici nu trebuie să poată)', '00000000-0000-4000-8000-000000000301',
      $q$DELETE FROM public.profiles WHERE is_owner$q$)
  ) x(id, uid, q)
$f$;

CREATE FUNCTION t.suita_runda2() RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int := 0; v_tot text := t.toate(); r record;
BEGIN
  PERFORM t.verifica('R2-0 control: 5 rânduri', split_part(v_tot, ':', 2), '5'); n := n + 1;
  FOR r IN SELECT * FROM t.incercari_autoatribuire() LOOP
    -- escaladarea NU reușește (eroare sau 0 rânduri) ȘI tokenurile rămân invizibile în aceeași tranzacție
    PERFORM t.verifica(r.id, CASE WHEN r.rezultat ~ '^(ERR:[0-9A-Z]{5}|OK:0) vede=0$' THEN 'refuzat' ELSE r.rezultat END, 'refuzat'); n := n + 1;
  END LOOP;
  -- Limitele grupului țintă: regula actuală (= poarta UI) le dă acces. ALEGERE DE APROBAT de Răzvan.
  FOR r IN SELECT * FROM (VALUES
      ('L1 [DE APROBAT] modul hr cu access_level=viewer vede toate tokenurile', '00000000-0000-4000-8000-000000000203'::uuid),
      ('L2 [DE APROBAT] sub-modul hr.recrutare vede toate tokenurile', '00000000-0000-4000-8000-000000000204'),
      ('L3 [DE APROBAT] valoarea exactă ''hr.'' vede toate tokenurile', '00000000-0000-4000-8000-000000000205')) x(id, uid) LOOP
    PERFORM t.verifica(r.id, t.vede('authenticated', r.uid), v_tot); n := n + 1;
  END LOOP;
  RETURN n;
END $f$;
