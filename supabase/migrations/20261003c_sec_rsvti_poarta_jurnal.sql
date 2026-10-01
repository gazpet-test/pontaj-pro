-- ============================================================================
-- SEC RSVTI (P1 / constatarea (1) din docs/SECURITATE_ADVISORS_2026-09-30.md) — 03.10.2026, runda 3 (30.09)
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
-- Tranzacția (runda 4, verdict Copilot r3): UN SINGUR gestionar = RUNNERUL scripts/livrare_migrare.sh
--   (psql -X -v ON_ERROR_STOP=1 --single-transaction: marcaj de livrare + ACEST fișier + INSERT în
--   supabase_migrations.schema_migrations, toate în aceeași tranzacție). Fișierul NU mai conține BEGIN/COMMIT.
--   Precondițiile (§0), postcondițiile (§4) și garda de final rulează înainte de înregistrare și de COMMIT-ul
--   runnerului: orice eșec (inclusiv chiar la INSERT-ul înregistrării) anulează tot.
--   Garda de livrare (start + final): fără marcajul pus de runner în ACEEAȘI tranzacție (legat de txid) fișierul
--   refuză — psql -f simplu, psql -c, apply_migration / execute_sql MCP nu îl pot aplica (docs §13).
--   Ce se verifică imediat după apply: docs §7 pasul 4.
--
-- Ce face:
--   0. Precondiții fail-closed, NULL-safe (IS DISTINCT FROM; o valoare NULL = refuz), ÎNAINTE de orice modificare:
--      0a RLS activ pe hr_autorizatii (tabelul sursă) + politica sursă cu textul analizat (o politică fără USING/
--         WITH CHECK are md5 NULL ⇒ refuz); 0b exclusivitatea ei; 0c setul EXACT de triggere pe profiles (4, cu md5);
--      0d RPC-ul = varianta live sau cea din acest patch (md5 corp + semnătură); 0e jurnalul: RLS activ și EXACT o
--      politică de scriere; 0f helperul: absent sau EXACT definiția aprobată (md5 corp + atribute + ACL).
--   1. fn_poate_scrie_hr_autorizatii() — sursa unică a PORȚII RSVTI (cine confirmă o viză prin RPC și cine
--      inserează direct în jurnal): predicat IDENTIC cu politica hr_autorizatii_write_authorized (verificat în
--      precondiții). Nu schimbă dreptul nimănui. NU descrie toate căile de scriere în hr_autorizatii:
--      fn_hr_autorizatie_propunere_accepta (acceptarea propunerilor AI) are poarta ei și nu atinge rsvti_*.
--   2. confirm_hr_autorizatie_rsvti — același contract (tipuri, tip returnat, efecte), plus:
--      a) poarta, ÎNAINTE de orice citire/scriere: identitate explicită = sub-ul JWT rezolvat la un profil
--         care trece fn_poate_scrie_hr_autorizatii() (IS NOT TRUE ⇒ refuz, și pe NULL); fără identitate
--         (auth.uid() NULL: service_role, conexiune directă, claims golite) ⇒ REFUZ 42501 — nicio cale „sistem”;
--      b) regula datei: p_data_confirmare = data confirmării EFECTUATE (UI: „Data ultimei vize”, HR.jsx
--         ~L2005, și „data confirmării vizei”, ~L2108) ⇒ nu în viitor (> azi în Europe/Bucharest,
--         independent de TimeZone-ul sesiunii), nu înainte de 2000-01-01 și finită (regulă de business, nu o
--         dovadă că o dată anterioară e greșită) și nu înainte de data_emitere (dacă e completată);
--         semnătura are DEFAULT NULL::date (runda 3): data OMISĂ și NULL explicit = azi în Europe/Bucharest,
--         aceeași referință ca limita (înainte, data omisă lua CURRENT_DATE-ul fusului sesiunii);
--      c) scadența următoarei confirmări se calculează AICI din tipul autorizației (neschimbat);
--         apelantul nu o poate trimite (semnătura nu are un astfel de parametru).
--   3. Jurnalul:
--      a) politica INSERT (orice cont logat) → înlocuită cu una pe aceeași poartă + atribuire:
--         confirmat_de = cel care inserează (nu se mai poate semna în numele altcuiva). Consemnarea corectă a
--         efectului: „INSERT direct restrâns la grupul autorizat și identitatea proprie” — NU „jurnal de
--         confirmări integral verificabil” (decizia A e separată, docs §8.2);
--      b) REVOKE UPDATE, DELETE de la anon și authenticated: azi NU există politici UPDATE/DELETE, deci
--         RLS le refuză deja (0 rânduri) — REVOKE-ul nu schimbă niciun comportament, doar închide GRANT-ul;
--      c) REVOKE INSERT de la anon: nu există politică INSERT pentru anon (RLS refuză deja).
--   4. Postcondiții înainte de COMMIT-ul runnerului: md5 corpuri + semnătura RPC-ului, atributele funcțiilor (limbaj, volatilitate,
--      SECURITY DEFINER, proconfig exact, proprietar, tip întors), politica jurnalului + RLS, PRIVILEGIILE EFECTIVE
--      (has_function_privilege / has_table_privilege / has_any_column_privilege pentru PUBLIC, anon, authenticated —
--      acoperă moștenirea prin roluri și granturile pe coloane) și ACL-ul exact al celor două funcții.
--   RPC-ul scrie în continuare (proprietar postgres, ocolește RLS) — calea legitimă a UI-ului rămâne.
--   Rămân OPEN (docs §8): P1b (scrierea directă rsvti_* de către HR — pasul următor prioritar), ștergerea
--   prin cascadă a istoricului, suprascrierea fișei prin confirmări retroactive.
--
-- Revenire: supabase/revenire/20261003c_sec_rsvti_poarta_jurnal_ROLLBACK.sql = rollback TEHNIC, în afara migrărilor
--           forward; artefact de test/revenire excepțională, FĂRĂ GO de execuție (supabase/revenire/README.md).
--           Revenirea operațională (păstrează poarta): docs/SECURITATE_PATCH_RSVTI.md §6.
-- ============================================================================
DO $livrare_start$
BEGIN
  -- Garda de livrare (start): marcajul e pus de scripts/livrare_migrare.sh ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003c_sec_rsvti_poarta_jurnal:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții — fail-closed dacă producția s-a schimbat față de analiza din 29.09 (NULL = refuz)
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_pol     record;
  v_n       integer;
  v_ok      integer;
  v_md5     text;
  v_arg     text;
  v_corp_ok boolean;
  v_atr_ok  boolean;
  v_acl_ok  boolean;
BEGIN
  -- 0a. tabelul sursă: RLS activ (altfel politica pe care o copiază poarta nu se mai aplică nimănui) ...
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Precondiție 0a: RLS nu e activ pe hr_autorizatii (tabelul sursă) — politica pe care o copiază poarta nu se mai aplică; se reanalizează';
  END IF;
  -- ... și politica sursă: textul analizat, ALL, authenticated, permisivă. O politică fără USING/WITH CHECK are
  --     qual/with_check NULL ⇒ md5 NULL ⇒ IS DISTINCT FROM ⇒ refuz (runda 2 folosea operatorul „diferit”: NULL ⇒ trecea).
  SELECT * INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND policyname = 'hr_autorizatii_write_authorized';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Precondiție 0a: politica hr_autorizatii_write_authorized lipsește';
  END IF;
  IF v_pol.cmd IS DISTINCT FROM 'ALL' OR v_pol.permissive IS DISTINCT FROM 'PERMISSIVE'
     OR v_pol.roles::text IS DISTINCT FROM '{authenticated}'
     OR md5(regexp_replace(v_pol.qual, '\s+', ' ', 'g'))       IS DISTINCT FROM 'cc78b7fd25efb09a9a572d7b6d8f554b'
     OR md5(regexp_replace(v_pol.with_check, '\s+', ' ', 'g')) IS DISTINCT FROM 'cc78b7fd25efb09a9a572d7b6d8f554b' THEN
    RAISE EXCEPTION 'Precondiție 0a: hr_autorizatii_write_authorized s-a schimbat față de analiza din 29.09 (comandă, roluri, USING sau WITH CHECK — inclusiv lipsă: USING %, WITH CHECK %) — fn_poate_scrie_hr_autorizatii() n-ar mai fi identică; se reanalizează',
      CASE WHEN v_pol.qual IS NULL THEN 'absent' ELSE 'prezent' END, CASE WHEN v_pol.with_check IS NULL THEN 'absent' ELSE 'prezent' END;
  END IF;
  -- 0b. e SINGURA politică prin care se scrie în hr_autorizatii (altfel poarta n-ar mai fi „aceeași regulă”)
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Precondiție 0b: hr_autorizatii are % politici de scriere (așteptat 1)', v_n;
  END IF;
  -- 0c. sursa drepturilor nu se poate autoatribui: setul EXACT de triggere pe profiles (live PG17, citit 29.09):
  --     4 triggere BEFORE UPDATE FOR EACH ROW (tgtype 19), activate, fără WHEN/listă de coloane, cu corpurile
  --     analizate — is_owner/role (prevent_role_escalation), can_modify_employees (enforce_owner_only_salary_flags),
  --     department (S-A), can_access_pontaj_brut. Un trigger în plus (de ex. unul care scrie department dintr-un
  --     câmp editabil, sortat după S-A), unul lipsă, dezactivat sau cu alt corp ⇒ refuz.
  SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal;
  SELECT count(*) INTO v_ok
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN (VALUES ('prevent_role_escalation_trigger',     'prevent_role_escalation',         '16112659be92143e6539ae0e54e47a06'),
                 ('trg_enforce_owner_only_salary_flags', 'enforce_owner_only_salary_flags', '0470660c0a819981ff914355c7f6d00a'),
                 ('trg_profiles_campuri_owner_only',     'fn_profiles_campuri_owner_only',  'c06d7ce0f212c7bba2093c50614a88fc'),
                 ('trg_protect_can_access_pontaj_brut',  'protect_can_access_pontaj_brut',  'ff277c90e02ef03d1efb34cd7e87b1d4'))
         AS x(tg, fn, m)
      ON t.tgname::text IS NOT DISTINCT FROM x.tg AND p.proname::text IS NOT DISTINCT FROM x.fn
     AND md5(p.prosrc) IS NOT DISTINCT FROM x.m
   WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
     AND t.tgenabled IS NOT DISTINCT FROM 'O'::"char" AND t.tgtype IS NOT DISTINCT FROM 19::int2
     AND t.tgqual IS NULL AND t.tgattr::text IS NOT DISTINCT FROM ''
     AND p.pronamespace IS NOT DISTINCT FROM 'public'::regnamespace::oid AND p.pronargs IS NOT DISTINCT FROM 0::int2
     AND p.prosecdef IS NOT DISTINCT FROM true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres';
  IF v_n IS DISTINCT FROM 4 OR v_ok IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondiție 0c: triggerele de pe profiles nu sunt exact cele 4 analizate (% triggere, % conforme din 4) — sursa drepturilor porții s-ar putea autoatribui; se reanalizează', v_n, v_ok;
  END IF;
  -- 0d. RPC-ul e cel analizat (live 29.09) sau deja cel din acest patch (reaplicare): md5 corp ȘI semnătură, în
  --     pereche (valoarea implicită a datei nu e în prosrc).
  SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_md5, v_arg
    FROM pg_proc p WHERE p.oid = 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)'::regprocedure;
  IF NOT ((v_md5 IS NOT DISTINCT FROM '527c0e4708dfe1f88cec03a77b6a26dd'
           AND v_arg IS NOT DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT CURRENT_DATE, p_observatii text DEFAULT NULL::text')
       OR (v_md5 IS NOT DISTINCT FROM '6185a9ddf13a9e666368858decfa9611'
           AND v_arg IS NOT DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text')) THEN
    RAISE EXCEPTION 'Precondiție 0d: confirm_hr_autorizatie_rsvti nu e nici versiunea live analizată, nici cea din acest patch (md5 %, argumente: %)', v_md5, v_arg;
  END IF;
  -- 0e. jurnalul: RLS activ și EXACT o politică de scriere — cea de azi sau (reaplicare) cea din acest patch.
  --     Politicile permisive se adună cu OR: una în plus ar lăsa falsificarea deschisă și după migrare.
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Precondiție 0e: RLS nu e activ pe hr_autorizatii_rsvti_confirmari';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND cmd IS NOT DISTINCT FROM 'INSERT' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE'
     AND roles::text IS NOT DISTINCT FROM '{authenticated}' AND qual IS NULL
     AND ((policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_authenticated'
           AND md5(with_check) IS NOT DISTINCT FROM 'dc71e447411e7aaf354179a11ad2e2ae')
       OR (policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_autorizat'
           AND md5(with_check) IS NOT DISTINCT FROM '780014ba883836d16ffb7a014c7430c6'));
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Precondiție 0e: jurnalul are % politici de scriere (% recunoscute) — așteptat exact 1: cea de azi sau cea din acest patch; se reanalizează', v_n, v_ok;
  END IF;
  -- 0f. helperul: ABSENT (prima aplicare) sau EXACT definiția aprobată (reaplicare): md5 corp + atribute + ACL, și
  --     nicio altă funcție cu același nume (supraîncărcare). Altfel CREATE OR REPLACE ar suprascrie tacit o funcție
  --     necunoscută, pe care o folosesc politica și RPC-ul ⇒ refuz înainte de orice modificare.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'fn_poate_scrie_hr_autorizatii';
  IF v_n IS DISTINCT FROM 0 THEN
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
      RAISE EXCEPTION 'Precondiție 0f: fn_poate_scrie_hr_autorizatii există deja, dar nu e definiția aprobată (funcții cu acest nume: %, corp md5: %, atribute: %, ACL: %) — nu se suprascrie; se reanalizează',
        v_n, coalesce(v_corp_ok::text, 'absent'), coalesce(v_atr_ok::text, 'absent'), coalesce(v_acl_ok::text, 'absent');
    END IF;
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Poarta RSVTI: cine confirmă vize / inserează în jurnal (= hr_autorizatii_write_authorized)
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
  'SEC RSVTI 03.10.2026: poarta RSVTI — cine confirmă o viză prin confirm_hr_autorizatie_rsvti și cine inserează direct în hr_autorizatii_rsvti_confirmari. Predicat identic cu politica hr_autorizatii_write_authorized (owner, can_modify_employees, superadmin, department HR/Administrativ). Nu e sursa tuturor scrierilor în hr_autorizatii: fn_hr_autorizatie_propunere_accepta are poarta ei. Fără identitate (auth.uid() NULL) ⇒ false.';

-- ---------------------------------------------------------------------------
-- 2. RPC-ul: poartă + regula datei; scadența calculată aici. DEFAULT NULL::date (runda 3): data omisă = NULL = azi
--    în Europe/Bucharest (aceleași tipuri și același număr de valori implicite ⇒ CREATE OR REPLACE o acceptă)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text)
 RETURNS hr_autorizatii_rsvti_confirmari
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aut public.hr_autorizatii%rowtype;
  v_tip public.hr_autorizatii_tipuri%rowtype;
  v_user uuid := auth.uid();
  -- „azi” pentru o firmă din România, independent de TimeZone-ul sesiunii (UTC în producție)
  v_azi  date := (now() at time zone 'Europe/Bucharest')::date;
  -- data confirmării EFECTUATE (nu scadența). Data omisă (DEFAULT NULL din semnătură) și NULL explicit = azi în
  -- Europe/Bucharest: aceeași referință ca limita „nu în viitor”, oricare ar fi fusul sesiunii
  v_data date := coalesce(p_data_confirmare, v_azi);
  v_next date;
  v_row public.hr_autorizatii_rsvti_confirmari%rowtype;
begin
  -- (a) Poarta — înainte de orice citire/scriere. Identitate explicită: sub-ul JWT al unui profil cu drept
  --     (aceeași regulă ca politica hr_autorizatii_write_authorized). Fără identitate ⇒ refuz, nu „sistem”.
  --     IS NOT TRUE: și un rezultat NULL al porții înseamnă refuz.
  if v_user is null or public.fn_poate_scrie_hr_autorizatii() is not true then
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

  -- (b) Regula datei: o confirmare efectuată e o zi trecută sau de azi, nu precede emiterea autorizației și nu e
  --     înainte de 2000-01-01 (regulă de business pentru date plauzibile, nu dovadă că o dată anterioară e greșită)
  if v_data > v_azi then
    raise exception 'Data confirmării (%) nu poate fi în viitor (azi: %)', v_data, v_azi
      using errcode = '22023';
  end if;
  if not isfinite(v_data) or v_data < date '2000-01-01' then
    raise exception 'Data confirmării (%) e în afara intervalului acceptat: minimul e 2000-01-01', v_data
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
  'SEC RSVTI 03.10.2026: poartă fn_poate_scrie_hr_autorizatii() (42501); data confirmării EFECTUATE: finită, între 2000-01-01 și azi (Europe/Bucharest), ≥ data_emitere (22023); omisă sau NULL = azi (Europe/Bucharest). Scadența = data + interval_confirmare_rsvti_luni al tipului (implicit 6), calculată aici.';

-- ---------------------------------------------------------------------------
-- 3. Jurnalul: aceeași poartă la INSERT direct; fără UPDATE/DELETE din API
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_authenticated ON public.hr_autorizatii_rsvti_confirmari;
DROP POLICY IF EXISTS hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari;
CREATE POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_poate_scrie_hr_autorizatii()) AND confirmat_de = (SELECT auth.uid()));
COMMENT ON POLICY hr_autorizatii_rsvti_confirmari_insert_autorizat ON public.hr_autorizatii_rsvti_confirmari IS
  'SEC RSVTI 03.10.2026: INSERT direct doar pentru cine trece poarta RSVTI (fn_poate_scrie_hr_autorizatii) și doar în nume propriu. Calea normală rămâne RPC-ul confirm_hr_autorizatie_rsvti.';

REVOKE UPDATE, DELETE ON public.hr_autorizatii_rsvti_confirmari FROM anon, authenticated;
REVOKE INSERT ON public.hr_autorizatii_rsvti_confirmari FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Postcondiții — ÎNAINTE de înregistrare și de COMMIT-ul runnerului: starea rezultată e EXACT cea din acest patch (altfel se anulează tot)
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_n   integer;
  v_ok  integer;
  v_are boolean;
  r     record;
BEGIN
  -- 4a. amprentele: corpurile + semnătura RPC-ului; o singură funcție cu fiecare nume
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'))
       IS DISTINCT FROM '6185a9ddf13a9e666368858decfa9611'
     OR pg_get_function_arguments(to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'))
       IS DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'))
       IS DISTINCT FROM 'a59aeb46d5007222067276184a63aaa0'
     OR (SELECT count(*) FROM pg_proc WHERE proname IN ('confirm_hr_autorizatie_rsvti', 'fn_poate_scrie_hr_autorizatii')) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'Postcondiție 4a: corpul RPC-ului, semnătura lui (DEFAULT NULL::date) sau corpul helperului nu sunt cele din acest patch (md5), ori există supraîncărcări';
  END IF;
  -- 4b. atributele funcțiilor: limbaj, volatilitate, SECURITY DEFINER, proconfig exact, proprietar, tip întors, fără SETOF
  SELECT count(*) INTO v_ok
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    JOIN (VALUES ('public.confirm_hr_autorizatie_rsvti(bigint,date,text)', 'plpgsql', 'v'::"char", 'public.hr_autorizatii_rsvti_confirmari'),
                 ('public.fn_poate_scrie_hr_autorizatii()',                'sql',     's'::"char", 'boolean'))
         AS x(fn, limbaj, volatilitate, tip)
      ON p.oid = to_regprocedure(x.fn)
   WHERE l.lanname::text IS NOT DISTINCT FROM x.limbaj AND p.provolatile IS NOT DISTINCT FROM x.volatilitate
     AND p.prosecdef IS NOT DISTINCT FROM true AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
     AND p.prorettype IS NOT DISTINCT FROM to_regtype(x.tip)::oid AND p.proretset IS NOT DISTINCT FROM false
     AND p.prokind IS NOT DISTINCT FROM 'f'::"char";
  IF v_ok IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Postcondiție 4b: atributele funcțiilor nu sunt cele din acest patch (limbaj, volatilitate, SECURITY DEFINER, proconfig exact, proprietar postgres, tip întors): % din 2 conforme', v_ok;
  END IF;
  -- 4c. jurnalul: RLS activ și EXACT politica de scriere din acest patch
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_autorizat'
     AND cmd IS NOT DISTINCT FROM 'INSERT' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE'
     AND roles::text IS NOT DISTINCT FROM '{authenticated}' AND qual IS NULL
     AND md5(with_check) IS NOT DISTINCT FROM '780014ba883836d16ffb7a014c7430c6';
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Postcondiție 4c: jurnalul nu are exact politica de scriere din acest patch (% politici de scriere, % conforme) sau RLS e oprit', v_n, v_ok;
  END IF;
  -- 4d. PRIVILEGIILE EFECTIVE (nu doar ACL-ul direct): has_* includ PUBLIC, rolurile moștenite (grant WITH INHERIT) și,
  --     prin has_any_column_privilege, granturile pe coloane. DELETE există doar la nivel de tabel.
  FOR r IN SELECT * FROM (VALUES
      ('public',        'public.confirm_hr_autorizatie_rsvti(bigint,date,text)', false),
      ('anon',          'public.confirm_hr_autorizatie_rsvti(bigint,date,text)', false),
      ('authenticated', 'public.confirm_hr_autorizatie_rsvti(bigint,date,text)', true),
      ('public',        'public.fn_poate_scrie_hr_autorizatii()',                false),
      ('anon',          'public.fn_poate_scrie_hr_autorizatii()',                false),
      ('authenticated', 'public.fn_poate_scrie_hr_autorizatii()',                true)) AS x(rol, fn, asteptat)
  LOOP
    IF has_function_privilege(r.rol, r.fn, 'EXECUTE') IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'Postcondiție 4d: privilegiul efectiv EXECUTE pentru % pe % = % (așteptat %) — include PUBLIC și rolurile moștenite',
        r.rol, r.fn, has_function_privilege(r.rol, r.fn, 'EXECUTE')::text, r.asteptat::text;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public', 'INSERT', false), ('public', 'UPDATE', false), ('public', 'DELETE', false),
      ('anon',   'INSERT', false), ('anon',   'UPDATE', false), ('anon',   'DELETE', false),
      ('authenticated', 'UPDATE', false), ('authenticated', 'DELETE', false),
      -- INSERT rămâne (politica de mai sus îl restrânge); retragerea lui e decizia A, separată (docs §8.2)
      ('authenticated', 'INSERT', true)) AS x(rol, priv, asteptat)
  LOOP
    v_are := CASE WHEN r.priv IS NOT DISTINCT FROM 'DELETE'
                  THEN has_table_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', r.priv)
                  ELSE has_any_column_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', r.priv) END;
    IF v_are IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'Postcondiție 4d: privilegiul efectiv % pentru % pe hr_autorizatii_rsvti_confirmari = % (așteptat %) — include PUBLIC, rolurile moștenite și granturile pe coloane',
        r.priv, r.rol, v_are::text, r.asteptat::text;
    END IF;
  END LOOP;
  -- 4e. ACL-ul exact al celor două funcții: EXECUTE doar pentru postgres (proprietar), service_role, authenticated
  SELECT count(*) INTO v_ok
    FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'), to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'))
     AND (SELECT array_agg(s.e ORDER BY s.e COLLATE "C")
            FROM (SELECT format('%s:%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                a.privilege_type, a.is_grantable::text) AS e
                    FROM aclexplode(p.proacl) a) s)
         IS NOT DISTINCT FROM ARRAY['authenticated:EXECUTE:false', 'postgres:EXECUTE:false', 'service_role:EXECUTE:false'];
  IF v_ok IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Postcondiție 4e: ACL-ul funcțiilor nu e exact EXECUTE pentru postgres, service_role, authenticated (% din 2 conforme)', v_ok;
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  -- Garda de livrare (final, după postcondiții): marcajul e pus de scripts/livrare_migrare.sh ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003c_sec_rsvti_poarta_jurnal:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003c: garda de livrare (final, după postcondiții) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_final$;
