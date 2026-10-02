-- ════════════════════════════════════════════════════════════════════════════
-- 20261002b_conturi_p2_followup_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
-- LIVE r11 a pachetului Conturi (c v20261001230000 / d v20261001231500): cele 6 funcții înlocuite de 20261002b (r2: + fn_cont_coada_pune) revin VERBATIM la
-- corpurile din 20260929c / 20260929d (md5 prosrc: fn_cont_notifica_owneri 0bbbf41d…, fn_cont_serializare_activa 8327108d…,
-- fn_cont_revalideaza_candidat 7bb0d97e…, fn_cont_leaga_automat 349f5402…, fn_cont_coada_pune 890a0025…, fn_conturi_inchideri_sweep
-- 7bc5ddf2…) și coloanele conturi_inchideri_coada.amanari / ultima_amanare_alertata dispar (contorul de amânări se pierde — doar diagnostic). REDESCHIDE cele 4 P2 (risc documentat
-- pe #529, r11). Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review Copilot. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261002b', 'REVINE_P2_FOLLOWUP:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.rollback_tehnic_20261002b REVINE_P2_FOLLOWUP
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE v_lipsa text[];
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261002b', true) IS DISTINCT FROM 'REVINE_P2_FOLLOWUP:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261002b: nearmată (gazpet.rollback_tehnic_20261002b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261002b=%') THEN
    RAISE EXCEPTION 'Revenire 20261002b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261002b: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- precondiție: starea e EXACT cea a lui 20261002b (md5 propriu pe toate cele 6 funcții + coloanele amanari / ultima_amanare_alertata)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       'f969f77614176d63341f69e1909c11f1'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '526b9a2c30d4d70df3d94928e597de17'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'facbcd2b4059a16b24f95674b0986ad2')) AS w(f, sig, m)
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m);
  IF v_lipsa IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261002b: precondiție — funcțiile nu sunt varianta 20261002b (md5): %', v_lipsa;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.conturi_inchideri_coada'::regclass AND attname IN ('amanari', 'ultima_amanare_alertata') AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'Revenire 20261002b: precondiție — coloanele conturi_inchideri_coada.amanari / ultima_amanare_alertata lipsesc';
  END IF;
END $arm$;

-- ── c, A.3: fn_cont_notifica_owneri — VERBATIM din 20260929c (liniile 429-456) ──
CREATE OR REPLACE FUNCTION public.fn_cont_notifica_owneri(p_type text, p_title text, p_message text, p_link text DEFAULT '/admin')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer := 0; v_id uuid; v_k integer;
BEGIN
  BEGIN
    FOR v_id IN SELECT p.id FROM public.profiles p WHERE p.is_owner IS TRUE ORDER BY p.id LOOP
      BEGIN
        PERFORM 1 FROM public.profiles p WHERE p.id = v_id FOR KEY SHARE NOWAIT;   -- lock-ul implicit al FK-ului, luat FĂRĂ așteptare
        INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
        SELECT v_id, p_type, 'HR', p_title, p_message, p_link
         WHERE NOT EXISTS (SELECT 1 FROM public.notifications n
                            WHERE n.profile_id = v_id AND n.type = p_type
                              AND n.message IS NOT DISTINCT FROM p_message AND n.read_at IS NULL);
        GET DIAGNOSTICS v_k = ROW_COUNT;
        v_n := v_n + v_k;
      EXCEPTION WHEN lock_not_available THEN
        RAISE WARNING 'fn_cont_notifica_owneri (%): owner-ul % e ținut de altă tranzacție — notificarea e sărită, fără așteptare', p_type, v_id;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_cont_notifica_owneri (%): % [%]', p_type, SQLERRM, SQLSTATE;
    v_n := 0;
  END;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_notifica_owneri(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── c, r10: fn_cont_serializare_activa — VERBATIM din 20260929c (liniile 341-356) ──
CREATE OR REPLACE FUNCTION public.fn_cont_serializare_activa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 23
                    AND g.tgfoid = to_regprocedure('public.fn_employees_persoana_lock()')
                    AND md5(p.prosrc) = 'a1cd5859f28b4f0c8483835d640d6cb8')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.hr_employees_private') AND g.tgname = 'trg_hr_employees_private_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 31
                    AND g.tgfoid = to_regprocedure('public.fn_hr_employees_private_persoana_lock()')
                    AND md5(p.prosrc) = 'aa5e1a5a83c6c2b1eb39416579347293');
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_serializare_activa() FROM PUBLIC, anon, authenticated, service_role;

-- ── c, r6–r10: fn_cont_revalideaza_candidat — VERBATIM din 20260929c (liniile 590-654) ──
CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer, p_cere_marcaj boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_p      public.profiles%ROWTYPE;
  v_email  text;
  v_conf   boolean;
  v_incr   boolean;
  v_n      integer;
  v_emp    integer;
  v_ocupat boolean;
  v_pas    integer := 0;
  v_email0 text;
BEGIN
  IF p_emp IS NULL OR p_profile_id IS NULL THEN RETURN 'fara_candidat'; END IF;
  -- r10 (fereastra c→d): fără triggerele de serializare ale scriitorilor (d) instalate ȘI active, cheile luate mai jos nu
  -- serializează nimic ⇒ refuz explicit, ÎNAINTEA oricărui lock (nimic ținut), pe toate căile de legare.
  IF NOT public.fn_cont_serializare_activa() THEN RETURN 'serializare_indisponibila'; END IF;
  BEGIN
    v_pas := 1;
    PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;                 -- 1) fișa
    -- 1b) r9 (P1-c Copilot „candidat-fantomă”): universul candidaților (fn_cont_candidati_angajat) se recalculează mai jos, dar o
    --     ALTĂ fișă putea deveni candidată între timp (T2 redenumește / pune emailul pe B și comite; d ia cheile advisory ale lui B,
    --     c nu le lua) ⇒ „candidat unic” fals. Acum legarea ia cheile identității de potrivire (emailul de logare + tokenii de nume
    --     pentru @gazpet.ro — fn_cont_chei_potrivire, EXACT cheile pe care le iau triggerele employees din d), în poziția comună a
    --     pachetului: fișă → persoană (advisory) → profil → auth.users. Emailul de aici e citit fără lock; dacă sub lock (pasul 3)
    --     e altul, cheile luate nu acoperă noul univers ⇒ 'schimbat' (de reîncercat), niciodată legare pe chei vechi.
    SELECT u.email::text INTO v_email0 FROM auth.users u WHERE u.id = p_profile_id;
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
    PERFORM public.fn_cont_lock_chei(public.fn_cont_chei_potrivire(v_email0));
    v_pas := 2;
    SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;       -- 2) profilul (recitit SUB lock)
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
    v_pas := 3;
    SELECT u.email::text, u.email_confirmed_at IS NOT NULL, COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true'
      INTO v_email, v_conf, v_incr
      FROM auth.users u WHERE u.id = p_profile_id FOR NO KEY UPDATE NOWAIT;         -- 3) rândul de logare, BLOCAT FĂRĂ așteptare (r9) și recitit (r8)
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
  EXCEPTION WHEN lock_not_available THEN
    IF v_pas = 3 THEN
      RETURN 'auth_ocupat';     -- r9: rândul din auth.users e ținut de GoTrue (ștergere / schimbare în curs): retragere curată, fără ciclu
    END IF;
    RAISE;
  END;
  IF lower(btrim(COALESCE(v_email, ''))) <> lower(btrim(COALESCE(v_email0, ''))) THEN RETURN 'schimbat'; END IF;   -- r9 (P1-c): chei luate pe alt email
  IF p_cere_marcaj AND NOT v_incr THEN RETURN 'fara_marcaj_incredere'; END IF;    -- marcajul retras cât timp se aștepta (r8)
  IF v_p.employee_id IS NOT NULL THEN RETURN 'legatura_existenta'; END IF;
  IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN RETURN 'tip_cont_exceptat'; END IF;
  IF NULLIF(lower(btrim(COALESCE(v_email, ''))), '') IS NULL
     OR lower(btrim(COALESCE(v_p.email, ''))) <> lower(btrim(v_email)) THEN RETURN 'email_diferit'; END IF;
  IF NOT v_conf THEN RETURN 'email_neconfirmat'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e
                  WHERE e.id = p_emp AND e.active IS TRUE AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)) THEN
    RETURN 'fara_candidat';
  END IF;
  SELECT count(*), min(c.employee_id), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
    INTO v_n, v_emp, v_ocupat
    FROM public.fn_cont_candidati_angajat(v_email) c;
  IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
  IF v_n <> 1 OR v_emp IS DISTINCT FROM p_emp THEN RETURN 'schimbat'; END IF;
  IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(uuid, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ── c, A.5: fn_cont_leaga_automat — VERBATIM din 20260929c (liniile 800-893; CREATE OR REPLACE ca să păstreze ACL-ul) ──
CREATE OR REPLACE FUNCTION public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true, p_confirmate jsonb DEFAULT NULL)
RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text,
              metoda text, cont_creat_la timestamptz, cont_provider text, cont_incredere boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate lega automat conturile' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_simulare, true) AND (p_confirmate IS NULL OR jsonb_typeof(p_confirmate) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Aplicarea cere lista perechilor confirmate din previzualizare: p_confirmate = [{profile_id, employee_id}]'
      USING ERRCODE = '22023';
  END IF;
  FOR r IN
    WITH baza AS (
      SELECT pr.id AS pid, u.email AS uemail, u.created_at AS creat,
             u.raw_app_meta_data ->> 'provider' AS prov,
             COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true' AS incr,
             lower(btrim(COALESCE(pr.email, ''))) = lower(btrim(COALESCE(u.email, ''))) AS email_ok,
             u.email_confirmed_at IS NOT NULL AS conf
        FROM public.profiles pr
        JOIN auth.users u ON u.id = pr.id
       WHERE pr.employee_id IS NULL AND COALESCE(pr.tip_cont, 'angajat') = 'angajat'
    ),
    cand AS (
      SELECT b.pid, count(c.employee_id) AS n, min(c.employee_id) AS emp, min(c.employee_name) AS nume,
             min(c.metoda) AS met, COALESCE(bool_or(c.profil_legat IS NOT NULL), false) AS ocupat
        FROM baza b
        LEFT JOIN LATERAL public.fn_cont_candidati_angajat(b.uemail) c ON true
       WHERE b.email_ok AND b.conf
       GROUP BY b.pid
    )
    SELECT b.pid, b.uemail, b.creat, b.prov, b.incr, b.email_ok, b.conf, c.n, c.emp, c.nume, c.met, c.ocupat,
           count(*) FILTER (WHERE c.n = 1) OVER (PARTITION BY c.emp) AS pe_aceeasi_fisa
      FROM baza b
      LEFT JOIN cand c ON c.pid = b.pid
     ORDER BY b.uemail, b.pid
  LOOP
    profile_id := r.pid; email := r.uemail; cont_creat_la := r.creat; cont_provider := r.prov; cont_incredere := r.incr;
    employee_id := NULL; employee_name := NULL; metoda := NULL;
    IF NOT r.email_ok THEN
      rezultat := 'email_diferit';                        -- profiles.email ≠ emailul de logare: verifică manual
    ELSIF NOT r.conf THEN
      rezultat := 'email_neconfirmat';                    -- adresa de logare nedovedită: fără potrivire automată
    ELSIF COALESCE(r.n, 0) = 0 THEN
      rezultat := 'fara_candidat';
    ELSIF r.n > 1 THEN
      rezultat := 'ambiguu';
    ELSE
      employee_id := r.emp; employee_name := r.nume; metoda := r.met;
      IF r.ocupat THEN
        rezultat := 'candidat_ocupat';
      ELSIF r.pe_aceeasi_fisa > 1 THEN
        rezultat := 'ambiguu';                            -- mai multe conturi nelegate vor aceeași fișă
      ELSIF NOT public.fn_cont_serializare_activa() THEN
        rezultat := 'serializare_indisponibila';          -- r10 (fereastra c→d): și în previzualizare, ca owner-ul să vadă refuzul
      ELSIF COALESCE(p_simulare, true) THEN
        rezultat := 'de_legat';
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text) THEN
        rezultat := 'neconfirmat';                        -- nu era în previzualizarea confirmată
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text
                           AND x ->> 'employee_id' = r.emp::text) THEN
        rezultat := 'schimbat';                           -- potrivirea s-a schimbat de la previzualizare
      ELSE
        BEGIN
          -- r6 (C-RACE-LINK-1) + r7 (P1-C): lock fișă → profil (ordinea comună a pachetului) și revalidarea AMBELOR jumătăți
          -- sub lock (fișă activă; profil încă nelegat, tip angajat, email profil = email de logare recitit, confirmat;
          -- potrivire recalculată identică). Altfel rezultatul revalidării (schimbat / fara_candidat / tip_cont_exceptat /
          -- email_diferit / email_neconfirmat / legatura_existenta / candidat_ocupat / auth_ocupat — r9: rândul de logare
          -- ținut de GoTrue, fără așteptare; owner-ul reia „Leagă automat”), fără legare.
          rezultat := public.fn_cont_revalideaza_candidat(r.pid, r.emp);
          IF rezultat IS NULL THEN
            UPDATE public.profiles pr SET employee_id = r.emp
             WHERE pr.id = r.pid AND pr.employee_id IS NULL;
            rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
          END IF;
        EXCEPTION
          WHEN unique_violation THEN rezultat := 'candidat_ocupat';
          WHEN OTHERS THEN
            RAISE WARNING 'fn_cont_leaga_automat (%): % [%]', r.uemail, SQLERRM, SQLSTATE;
            rezultat := 'eroare';
        END;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END $fn$;
-- P3 (audit C): fără service_role — poarta e owner, service_role ar fi refuzat oricum.
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authenticated;

-- ── d, B.2b: fn_cont_coada_pune — VERBATIM din 20260929d (liniile 245-260) ──
CREATE OR REPLACE FUNCTION public.fn_cont_coada_pune(p_profile_id uuid, p_employee_id integer, p_tip text, p_motiv text,
                                                     p_scadent date DEFAULT CURRENT_DATE, p_eroare text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la, ultima_eroare, creat_de_identitate,
                                              notificat_la)
  VALUES (p_profile_id, p_employee_id, p_tip, p_motiv, COALESCE(p_scadent, CURRENT_DATE), p_eroare, public.fn_identitate_eticheta(),
          CASE WHEN p_eroare IS NOT NULL THEN now() END)
  ON CONFLICT (profile_id, tip) WHERE rezolvat_la IS NULL
  DO UPDATE SET scadent_la = EXCLUDED.scadent_la, employee_id = EXCLUDED.employee_id, motiv = EXCLUDED.motiv,
                ultima_eroare = COALESCE(EXCLUDED.ultima_eroare, public.conturi_inchideri_coada.ultima_eroare),
                incercari = 0, urmatoarea_incercare_la = NULL, abandonat_la = NULL, notificat_la = EXCLUDED.notificat_la;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_coada_pune(uuid, integer, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── d, B.5b: fn_conturi_inchideri_sweep — VERBATIM din 20260929d (liniile 1061-1259) ──
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_max_incercari constant integer := 8;
  q        record;
  x        public.conturi_inchideri_coada%ROWTYPE;
  e        record;
  v_rez    text;
  v_garda  text;
  v_set    text;
  v_n      jsonb := '{}'::jsonb;
  v_rezult text;
  v_err    text;
  v_email  text;
  -- r8 (P2 Jakarinos pe b916970): sweep-ul e O tranzacție (SELECT din pg_cron) ⇒ lock-urile elementelor procesate (fișă,
  -- cheile persoanei, profil, intrare) rămân până la COMMIT. Dacă, ținându-le, AȘTEAPTĂ la elementul următor, poate intra
  -- într-un ciclu cu HR (HR ține fișa B și așteaptă o cheie de nume ținută de sweep de la A; sweep-ul ajunge la B și așteaptă
  -- fișa) — detectat de PostgreSQL ca deadlock, cu victimă posibil HR. Regula r8: sweep-ul AȘTEAPTĂ doar cât timp nu ține
  -- nimic de la un element anterior (v_tine = false: nu poate fi membru al unui ciclu — nimeni nu așteaptă după el);
  -- de la al doilea element ținut încolo, toate lock-urile se iau FĂRĂ așteptare (NOWAIT / pg_try_advisory_xact_lock prin
  -- gazpet.cont_lock_nowait) și un 55P03 = „amânat” (amanat_lock): intrarea rămâne NEATINSĂ (fără incercari / backoff /
  -- notificare) și se procesează la rularea următoare (≤ 5 min). Varianta cu commit per element ar fi cerut procedură +
  -- schimbarea jobului cron; cea cu „toate cheile sortate înainte” nu se poate (cheile persoanei se află abia sub lock-ul fișei).
  v_tine   boolean := false;
  v_amanat boolean;
  v_detail text;
BEGIN
  IF public.fn_identitate_privilegiata() IS NULL THEN
    RAISE EXCEPTION 'Coada închiderilor o procesează doar pg_cron (login postgres) sau o identitate privilegiată explicită'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(public.fn_cont_flaguri()) f;
  FOR q IN SELECT c.id, c.profile_id, c.employee_id, c.tip
             FROM public.conturi_inchideri_coada c
            WHERE c.rezolvat_la IS NULL AND c.abandonat_la IS NULL AND c.scadent_la <= CURRENT_DATE
              AND (c.urmatoarea_incercare_la IS NULL OR c.urmatoarea_incercare_la <= now())
            ORDER BY c.id LOOP
    v_rezult := NULL;
    v_garda := NULL;
    v_amanat := false;
    -- r9 (P2-2): modul „fără așteptare” e pus pe TOT elementul (nu doar pe gardă): fn_cont_lock_chei (garda) ȘI fn_cont_inchide
    -- (preblocare NOWAIT a rândurilor scrise: auth.users, module, șantiere, tokens, sesiuni, intrările din coadă) îl citesc.
    -- Setarea e locală tranzacției (set_config … true) și se reface la fiecare element după v_tine; după buclă revine pe off.
    PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
    BEGIN
      IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
        -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
        --    Fără lock, sweep-ul putea citi termination_date veche deja comisă în timp ce HR o muta în viitor ⇒ cont închis
        --    cu dată viitoare. Cu FOR UPDATE, citirea de mai jos (instrucțiune nouă, READ COMMITTED) vede versiunea comisă.
        IF v_tine THEN
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;
        ELSE
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
        END IF;
        -- 1) persoana (lock până la COMMIT); r8: fără așteptare dacă sweep-ul ține deja lock-uri de la alt element
        --    (gazpet.cont_lock_nowait, pus mai sus pe tot elementul)
        v_garda := public.fn_cont_garda_persoana(q.employee_id);
      END IF;
      IF v_tine THEN                                                           -- 2) profilul
        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;   -- 3) intrarea, recitită
      ELSE
        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE;
      END IF;
      -- (v_tine devine true DOAR la ieșirea normală din bloc — și la CONTINUE: subtranzacția reușită păstrează lock-urile
      --  până la COMMIT; o eroare anulează subtranzacția și le eliberează, deci v_tine rămâne cum era)
      IF NOT FOUND OR x.rezolvat_la IS NOT NULL OR x.abandonat_la IS NOT NULL THEN
        v_tine := true;
        CONTINUE;                                    -- rezolvată între timp (restaurare, închidere manuală, reactivare)
      END IF;
      -- r4 (Copilot pe dac4bda): upsert-ul fn_cont_coada_pune poate retargeta intrarea (employee_id A→B) cât timp sweep-ul
      -- aștepta. Fișa blocată mai sus e A; nu blocăm B DUPĂ coadă (ar inversa ordinea fișă → advisory → profil → coadă).
      -- Intrarea retargetată se procesează la rularea următoare, cu lock-urile luate în ordinea corectă.
      IF (x.profile_id, x.employee_id, x.tip) IS DISTINCT FROM (q.profile_id, q.employee_id, q.tip) THEN
        v_tine := true;
        CONTINUE;
      END IF;
      IF x.tip = 'flaguri' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id) THEN
          v_rezult := 'anulat_profil_inexistent';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL)
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.is_owner IS NOT TRUE) THEN
          IF v_set IS NOT NULL THEN
            EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING x.profile_id;
          END IF;
          v_rezult := 'flaguri_resetate';
        ELSE
          v_rezult := 'anulat_restaurat';
        END IF;
      ELSE
        SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire după lock (revalidare)
        IF NOT FOUND
           OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.employee_id = x.employee_id)
           OR e.active IS TRUE OR e.termination_date IS NULL THEN
          v_rezult := 'anulat_conditii';
        ELSIF e.termination_date > CURRENT_DATE THEN
          UPDATE public.conturi_inchideri_coada SET scadent_la = e.termination_date WHERE id = x.id;   -- data s-a mutat
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL) THEN
          v_rezult := 'deja_inchis';
        ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id
                        AND (p.is_owner IS TRUE OR COALESCE(p.tip_cont, 'angajat') <> 'angajat')) THEN
          v_rezult := 'suspendat_owner_sau_tip_cont';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j
                       WHERE j.id = public.fn_cont_restaurare_activa(x.profile_id)
                         AND (j.restaurat_la >= x.creat_la OR x.tip = 'reevaluare_istorica')) THEN
          -- restaurare mai nouă decât intrarea: decizia owner-ului rămâne. r10: pentru o REEVALUARE ISTORICĂ (fișa B deja inactivă,
          -- pusă în coadă de evenimentul pe altă fișă A a persoanei) restaurarea se respectă INDIFERENT de creat_la — nu e o plecare
          -- nouă a lui B; doar o plecare nouă ('programata' din triggerul lui B) sau închiderea manuală ridică blocajul.
          v_rezult := 'anulat_restaurat';
        ELSIF v_garda IS NOT NULL THEN
          v_rezult := 'suspendat_' || split_part(v_garda, ':', 1);
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
            format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                   (SELECT p.email FROM public.profiles p WHERE p.id = x.profile_id), e.id, e.name, public.fn_cont_motiv_garda(v_garda)),
            '/admin?tab=managers&cont=' || x.profile_id::text);
        ELSE
          v_rez := public.fn_cont_inchide(x.profile_id,
                     format('Contract încheiat la %s (fișa #%s %s) · %s', to_char(e.termination_date, 'DD.MM.YYYY'), e.id, e.name,
                            CASE x.tip WHEN 'programata' THEN 'închidere programată'
                                       WHEN 'reevaluare_istorica' THEN 'fișă istorică a aceleiași persoane (CNP comun), judecată cu garda ei'
                                       ELSE 'reîncercare după eșec' END),
                     'coada_contract_incheiat', e.id);
          v_rezult := v_rez;                                -- fn_cont_inchide a rezolvat deja intrarea
        END IF;
      END IF;
      IF v_rezult IS NOT NULL THEN
        UPDATE public.conturi_inchideri_coada
           SET rezolvat_la = COALESCE(rezolvat_la, now()), rezultat = COALESCE(rezultat, v_rezult), incercari = incercari + 1
         WHERE id = x.id;
        v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
      END IF;
      v_tine := true;
    EXCEPTION WHEN OTHERS THEN
      -- r8 (P2): 55P03 primit cât timp sweep-ul ținea lock-uri de la alt element = contenție, nu eșec: intrarea rămâne
      -- neatinsă (fără incercari / backoff / notificare), se reia la rularea următoare. (55P03 la PRIMUL element ținut —
      -- doar cu un lock_timeout pus din afară, sweep-ul nu-l pune — rămâne eroare, ca până acum.)
      -- r10 (blocant d): rândul din auth.users ținut de GoTrue (fn_cont_inchide: 55P03 cu DETAIL 'auth_ocupat') = retragere și pe
      -- PRIMUL element (v_tine = false): subtranzacția abandonată a eliberat fișa / cheile / profilul ⇒ cascada ștergerii GoTrue trece;
      -- elementul se reia la rularea următoare (amanat_lock), nu intră în backoff.
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      IF SQLSTATE = '55P03' AND (v_tine OR v_detail = 'auth_ocupat') THEN
        v_amanat := true;
        v_n := jsonb_set(v_n, ARRAY['amanat_lock'], to_jsonb(COALESCE((v_n ->> 'amanat_lock')::int, 0) + 1));
      END IF;
      IF NOT v_amanat THEN
      v_err := SQLERRM;
      v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
      BEGIN
        -- subtranzacția anulată a eliberat lock-urile din bloc → aceeași ordine: profil, apoi intrarea
        -- (r8: fără așteptare dacă se țin lock-uri de la alt element; 55P03 aici ⇒ doar WARNING, backoff-ul se face la rularea următoare)
        -- r9 (P2-3 Jakarinos pe 14dc54b): și intrarea se preblochează NOWAIT când se țin lock-uri anterioare (UPDATE-ul de mai
        -- jos ar fi așteptat); iar dacă blocul reușește, lock-urile lui (profil + intrare) rămân până la COMMIT ⇒ v_tine := true
        -- la final (înainte rămânea false ⇒ sweep-ul AȘTEPTA la elementul următor ținând profilul A: ciclu cu HR care ține fișa B
        -- a aceleiași persoane și vrea profilul A).
        IF v_tine THEN
          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
          PERFORM 1 FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;
        ELSE
          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
        END IF;
        UPDATE public.conturi_inchideri_coada
           SET incercari = incercari + 1, ultima_eroare = v_err,
               urmatoarea_incercare_la = now() + least(interval '5 minutes' * power(2, incercari), interval '6 hours'),
               abandonat_la = CASE WHEN incercari + 1 >= c_max_incercari THEN now() END
         WHERE id = q.id AND rezolvat_la IS NULL
           -- r5 (D-ERR-IDENTITY): backoff / abandon / notificare DOAR pe intrarea pe care a lucrat sweep-ul; una retargetată
           -- între timp (fn_cont_coada_pune: employee_id A→B) nu primește eroarea altei fișe ⇒ NOT FOUND, nimic de făcut
           AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)
        RETURNING * INTO x;
        IF FOUND THEN
          v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
          IF x.abandonat_la IS NOT NULL THEN
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
              format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                     v_email, x.id, x.tip, x.incercari, v_err),
              '/admin?tab=managers&cont=' || q.profile_id::text);
          ELSIF x.notificat_la IS NULL THEN
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
              format('%s (coada #%s, %s): %s · se reîncearcă automat (încercarea %s din %s; următoarea după %s)',
                     v_email, x.id, x.tip, v_err, x.incercari, c_max_incercari,
                     to_char(x.urmatoarea_incercare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = q.id;
          END IF;
        END IF;
        v_tine := true;   -- r9 (P2-3): blocul a reușit ⇒ profilul + intrarea rămân ținute până la COMMIT ⇒ de aici încolo NOWAIT
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): % [%] · eroarea inițială: %', q.id, SQLERRM, SQLSTATE, v_err;
      END;
      END IF;   -- NOT v_amanat
    END;
  END LOOP;
  PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_sweep() FROM PUBLIC, anon, authenticated, service_role;

-- ── d (coloanele aditive): contorul de amânări și markerul de alertă dispar; intrările deschise rămân neatinse ──
ALTER TABLE public.conturi_inchideri_coada DROP COLUMN IF EXISTS amanari;
ALTER TABLE public.conturi_inchideri_coada DROP COLUMN IF EXISTS ultima_amanare_alertata;

-- ── Postcondiție: EXACT starea live r11 (md5 c/d, ACL-uri neschimbate), fără coloană; apoi dezarmare ──
DO $post$
DECLARE v_lipsa text[];
BEGIN
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       '0bbbf41d3097840c16a97a263ff4cd5f', '{postgres=X/postgres}'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '8327108ddc25b66c312b7ba82e3a83b2', '{postgres=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', '{postgres=X/postgres}'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               '349f540203eeb73639c4cfa4316a8cd6', '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', '890a0025f513ca02ac9276cd4a360afb', '{postgres=X/postgres}'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       '7bc5ddf2f4097525e6c24f499a8fb5e7', '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres' AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Revenire 20261002b: postcondiție — amprenta nu e cea live r11: %', v_lipsa; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conturi_inchideri_coada'::regclass AND attname IN ('amanari', 'ultima_amanare_alertata') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Revenire 20261002b: postcondiție — coloanele amanari / ultima_amanare_alertata au rămas';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002b', '', true);
END $post$;
