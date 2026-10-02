-- ============================================================================
-- 20261002b — Conturi (c/d live din 02.10.2026, v20261001230000 / v20261001231500 / v20261001233000): follow-up pentru cele 4 P2
-- acceptate de Jakarinos ca risc documentat pe #529 (docs/AUDIT_OFERTARE_V2/529_DELTA_COPILOT.md, r11 „P2 declarate acceptabile”;
-- decizia Răzvan 16A). Migrare ADITIVĂ, în stilul runner-ului (gardă de livrare start/final cu marcaj txid, precondiții fail-closed
-- cu md5 pe funcțiile LIVE pe care le înlocuiește, postcondiții, fără BEGIN/COMMIT). Revenire: supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql.
--
--   (a) P2-1 — deadlock în legarea pe loturi (c:858-875, fn_cont_leaga_automat, aplicare multiplă). După legarea elementului A
--       tranzacția lotului ține fișa A, cheile persoanei (cheia comună de nume!), profilul A și rândul auth.users A până la COMMIT.
--       HR ține fișa B și așteaptă cheia de nume ținută de lot; lotul ajunge la B și AȘTEAPTĂ fișa B ⇒ ciclu (40P01, victimă posibil HR).
--       Fix: aceeași politică ca sweep-ul (r8/r9, gazpet.cont_lock_nowait): lotul AȘTEAPTĂ doar cât timp nu ține nimic de la un
--       element anterior; de la al doilea element ținut încolo fișa, cheile persoanei și profilul se iau FĂRĂ așteptare
--       (fn_cont_revalideaza_candidat citește GUC-ul: FOR UPDATE NOWAIT + fn_cont_lock_chei NOWAIT) ⇒ 55P03 ⇒ rezultat EXPLICIT
--       de reîncercare 'amanat_lock' (subtranzacția elementului abandonată, nimic ținut de la el; owner-ul reia „Leagă automat”).
--       Calea cont-nou (fn_cont_leaga_la_creare) e un singur element ⇒ neschimbată (GUC off ⇒ așteaptă ca până acum).
--   (b) P2-2 — fn_cont_serializare_activa nu verifica tgqual / tgattr (c:341-350): un trigger cu același nume, tip, funcție și md5
--       dar cu WHEN (…) sau UPDATE OF pe mai puține coloane trecea garda. Fix: garda cere și tgqual IS NULL (fără WHEN) și lista
--       EXACTĂ a coloanelor din UPDATE OF (nume, nu attnum — stabile între medii): employees {active, cnp, email, name, termination_date},
--       hr_employees_private {cnp, employee_id} — exact ce livrează d.
--   (c) P2-3 — notificări pierdute fără reluare: fn_cont_notifica_owneri sare un owner ținut FOR UPDATE (c:436-437, corect: fără
--       așteptare), dar handlerul sweep-ului marca notificat_la = now() CHIAR dacă notificatorul livrase 0 mesaje (d:1232) ⇒ intrarea
--       nu se mai anunța niciodată; la fel anunțul de abandonare (o singură șansă). Fix: notificatorul întoarce numărul de owneri
--       ACOPERIȚI (mesaj inserat acum SAU același mesaj deja necitit la acel owner — dedupe-ul nu mai „pierde” acoperirea);
--       handlerul marchează notificat_la DOAR dacă rezultatul > 0, altfel intrarea rămâne reluabilă (la eroarea următoare se anunță
--       din nou); la abandonare, 0 livrate ⇒ notificat_la = NULL și un pas final al sweep-ului („reluare notificări”) re-trimite
--       anunțul de abandonare la fiecare rulare până ajunge (abandonat_la IS NOT NULL AND notificat_la IS NULL).
--   (d) P2-4 — amânare nelimitată la contenție (d:1190-1192, amanat_lock fără contor / alertă). Fix: coloană nouă ADITIVĂ
--       conturi_inchideri_coada.amanari integer NOT NULL DEFAULT 0; la fiecare amânare sweep-ul incrementează contorul pe intrare
--       (intrarea luată FOR UPDATE NOWAIT în subtranzacție proprie — ținută de altcineva ⇒ WARNING, fără așteptare, fără incrementare)
--       și după prag (6 amânări la rând = ~30 min la cron de 5 min; apoi la fiecare multiplu de 6) anunță owner-ul
--       (cont_inchidere_amanata). Semantica amanat_lock e NEschimbată: intrarea rămâne fără incercari / backoff / abandon, se reia la
--       rularea următoare; contorul se resetează când elementul e procesat normal și rămâne deschis (ex. scadența mutată).
--
-- Funcții înlocuite (precondiție = md5 LIVE r11, calculat pe harness din fișierele cu sha256 identic cu docs/CONTURI_CICLU_VIATA.md r11;
-- la reaplicare = md5 propriu): fn_cont_notifica_owneri (c), fn_cont_serializare_activa (c), fn_cont_revalideaza_candidat (c),
-- fn_cont_leaga_automat (c), fn_conturi_inchideri_sweep (d). Semnături, ACL-uri, SECURITY DEFINER + search_path: neschimbate.
-- NOTĂ: precondițiile lui d / e verifică md5-ul lui fn_cont_notifica_owneri (0bbbf41d…) — după acest follow-up o REAPLICARE a lui d / e
-- pe live ar fi refuzată de ele (corect: starea de pornire s-a schimbat); harness-ul reaplică c → d → e → 20261002b în ordine.
-- Idempotentă. Nu atinge datele (coloana nouă pornește pe 0).
-- ============================================================================

-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002b_conturi_p2_followup:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed ──────────────────────────────────────────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[]; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- pachetul c/d/e e livrat (obiectele de care depinde follow-up-ul)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_cont_leaga_automat','fn_cont_revalideaza_candidat','fn_cont_serializare_activa',
                                                      'fn_cont_notifica_owneri','fn_conturi_inchideri_sweep','fn_cont_lock_chei','fn_cont_chei_potrivire',
                                                      'fn_cont_candidati_angajat','fn_identitate_privilegiata','fn_cont_inchide','fn_cont_garda_persoana',
                                                      'fn_cont_motiv_garda','fn_cont_flaguri','fn_cont_restaurare_activa']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile pachetului c/d: %', v_lipsa; END IF;
  IF to_regclass('public.conturi_inchideri_coada') IS NULL OR to_regclass('public.conturi_inchideri_jurnal') IS NULL THEN
    RAISE EXCEPTION 'Precondiție: tabelele cozii / jurnalului (20260929d) lipsesc';
  END IF;
  -- Funcțiile înlocuite pornesc EXACT din varianta LIVE r11 (md5 prosrc) sau, la reaplicare, din varianta proprie (semnătură unică,
  -- SECURITY DEFINER, proconfig, owner postgres).
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',   '0bbbf41d3097840c16a97a263ff4cd5f', 'f969f77614176d63341f69e1909c11f1'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                   '8327108ddc25b66c312b7ba82e3a83b2', '526b9a2c30d4d70df3d94928e597de17'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',           '349f540203eeb73639c4cfa4316a8cd6', 'a32cb851d317d273feee8e975eba66a4'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', '9e203157af28de6961876d2ce06ee678')) AS w(f, sig, m_live, m_nou)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) IN (w.m_live, w.m_nou) AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: funcțiile înlocuite nu au amprenta LIVE r11 (semnătură/md5/secdef/proconfig/owner): % — se reanalizează', v_lipsa; END IF;
  -- (a) ACL-urile de pornire (păstrate de CREATE OR REPLACE): fn_cont_leaga_automat = owner + authenticated; celelalte doar postgres
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)')) IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_cont_notifica_owneri(text,text,text,text)'), to_regprocedure('public.fn_cont_serializare_activa()'),
                                                        to_regprocedure('public.fn_cont_revalideaza_candidat(uuid,integer,boolean)'), to_regprocedure('public.fn_conturi_inchideri_sweep()'))
                   AND p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție: ACL-urile funcțiilor înlocuite diferă de cele livrate de c/d — se reanalizează';
  END IF;
  -- (b) triggerele de serializare ale lui d sunt live în forma livrată (fără WHEN, UPDATE OF pe coloanele exacte) — garda nouă le cere
  IF NOT public.fn_cont_serializare_activa() THEN
    RAISE EXCEPTION 'Precondiție: fn_cont_serializare_activa() = false (triggerele de lock ale lui d nu sunt instalate / active) — se reanalizează';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock' AND g.tgqual IS NULL
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                       = ARRAY['active','cnp','email','name','termination_date'])
     OR NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.hr_employees_private') AND g.tgname = 'trg_hr_employees_private_persoana_lock' AND g.tgqual IS NULL
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                       = ARRAY['cnp','employee_id']) THEN
    RAISE EXCEPTION 'Precondiție: triggerele de lock ale lui d nu au forma livrată (WHEN / UPDATE OF) — se reanalizează';
  END IF;
  -- (d) coloana nouă: absentă (prima aplicare) sau exact integer NOT NULL DEFAULT 0 (reaplicare)
  SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || ' default ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-')
    INTO v_tip
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.conturi_inchideri_coada'::regclass AND a.attname = 'amanari' AND NOT a.attisdropped;
  IF v_tip IS NOT NULL AND v_tip IS DISTINCT FROM 'integer not null default 0' THEN
    RAISE EXCEPTION 'Precondiție: conturi_inchideri_coada.amanari există cu altă definiție (%) — se reanalizează', v_tip;
  END IF;
END $pre_livrare$;

-- (d) coloana contorului de amânări — aditivă, cu valoare implicită; intrările existente pornesc de la 0 -------------------------
ALTER TABLE public.conturi_inchideri_coada ADD COLUMN IF NOT EXISTS amanari integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.conturi_inchideri_coada.amanari IS
  'P2-4 (20261002b): de câte ori LA RÂND sweep-ul a amânat intrarea din contenție (amanat_lock). Se resetează când elementul e procesat normal și rămâne deschis. Owner-ul e anunțat (cont_inchidere_amanata) la fiecare 6 amânări (~30 min).';

-- (c) A.3 Notificări pentru owneri (c) — întoarce numărul de owneri ACOPERIȚI ---------------------------------------------------
-- r10: destinatarii se iau FOR KEY SHARE NOWAIT (owner ținut ⇒ sărit cu WARNING, fără așteptare) — neschimbat.
-- 20261002b (P2-3): rezultatul = owneri care AU notificarea după apel: mesajul inserat acum SAU același mesaj (type + message) deja
-- necitit la acel owner (dedupe-ul nu mai înseamnă „0 livrate”). Un owner sărit (ținut) NU contează. Apelanții care au nevoie de
-- garanția livrării (handlerul sweep-ului) marchează „anunțat” DOAR dacă rezultatul > 0; ceilalți (PERFORM) rămân best-effort.
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
        -- 20261002b (P2-3): dedupe = owner-ul are deja exact acest mesaj necitit ⇒ e acoperit, nu „pierdut”
        IF v_k = 0 AND EXISTS (SELECT 1 FROM public.notifications n
                                WHERE n.profile_id = v_id AND n.type = p_type
                                  AND n.message IS NOT DISTINCT FROM p_message AND n.read_at IS NULL) THEN
          v_k := 1;
        END IF;
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

-- (b) Garda ferestrei c→d (c, r10) — acum verifică și WHEN (tgqual) și lista coloanelor din UPDATE OF (tgattr) --------------------
-- Constantele md5 ale funcțiilor de lock din d sunt NEschimbate (a1cd5859… / aa5e1a5a…); coloanele se compară pe NUME (sortate),
-- nu pe attnum — stabile între live și harness. Un trigger cu WHEN (…) sau cu UPDATE OF restrâns nu mai trece garda.
CREATE OR REPLACE FUNCTION public.fn_cont_serializare_activa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 23
                    AND g.tgfoid = to_regprocedure('public.fn_employees_persoana_lock()')
                    AND md5(p.prosrc) = 'a1cd5859f28b4f0c8483835d640d6cb8'
                    AND g.tgqual IS NULL                                                     -- 20261002b (P2-2): fără WHEN
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)                -- 20261002b (P2-2): UPDATE OF exact
                           FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_catalog.pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                        = ARRAY['active', 'cnp', 'email', 'name', 'termination_date'])
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.hr_employees_private') AND g.tgname = 'trg_hr_employees_private_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 31
                    AND g.tgfoid = to_regprocedure('public.fn_hr_employees_private_persoana_lock()')
                    AND md5(p.prosrc) = 'aa5e1a5a83c6c2b1eb39416579347293'
                    AND g.tgqual IS NULL
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_catalog.pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                        = ARRAY['cnp', 'employee_id']);
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_serializare_activa() FROM PUBLIC, anon, authenticated, service_role;

-- (a) Revalidarea sub lock (c, r6–r10) — pașii 1 (fișă + chei) și 2 (profil) FĂRĂ așteptare când apelantul ține deja lock-uri -----
-- gazpet.cont_lock_nowait = 'on' (setare locală tranzacției, pusă de fn_cont_leaga_automat de la al doilea element ținut încolo,
-- ca în sweep): fișa FOR UPDATE NOWAIT, cheile persoanei prin fn_cont_lock_chei (care citește același GUC), profilul FOR UPDATE NOWAIT.
-- 55P03 la pașii 1–2 în modul fără așteptare ⇒ 'amanat_lock' (subtranzacția abandonată ⇒ nimic ținut de la acest element; de reîncercat).
-- Cu GUC-ul off (cont-nou, primul element al lotului) comportamentul e identic cu r11: așteaptă; 55P03 la pașii 1–2 se propagă.
-- Pasul 3 (auth.users) rămâne NOWAIT întotdeauna ⇒ 'auth_ocupat' (r9).
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
  v_nowait boolean := COALESCE(current_setting('gazpet.cont_lock_nowait', true), '') = 'on';   -- 20261002b (P2-1)
BEGIN
  IF p_emp IS NULL OR p_profile_id IS NULL THEN RETURN 'fara_candidat'; END IF;
  -- r10 (fereastra c→d): fără triggerele de serializare ale scriitorilor (d) instalate ȘI active, cheile luate mai jos nu
  -- serializează nimic ⇒ refuz explicit, ÎNAINTEA oricărui lock (nimic ținut), pe toate căile de legare.
  IF NOT public.fn_cont_serializare_activa() THEN RETURN 'serializare_indisponibila'; END IF;
  BEGIN
    v_pas := 1;
    IF v_nowait THEN
      PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE NOWAIT;      -- 1) fișa (fără așteptare: lotul ține deja lock-uri)
    ELSE
      PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;             -- 1) fișa
    END IF;
    -- 1b) r9 (P1-c Copilot „candidat-fantomă”): cheile identității de potrivire (fn_cont_chei_potrivire, EXACT cheile pe care le iau
    --     triggerele employees din d), în poziția comună a pachetului: fișă → persoană (advisory) → profil → auth.users.
    --     Emailul de aici e citit fără lock; dacă sub lock (pasul 3) e altul ⇒ 'schimbat' (de reîncercat), niciodată legare pe chei vechi.
    SELECT u.email::text INTO v_email0 FROM auth.users u WHERE u.id = p_profile_id;
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
    PERFORM public.fn_cont_lock_chei(public.fn_cont_chei_potrivire(v_email0));     -- (NOWAIT prin același GUC)
    v_pas := 2;
    IF v_nowait THEN
      SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE NOWAIT;   -- 2) profilul (recitit SUB lock)
    ELSE
      SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
    END IF;
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
    IF v_nowait THEN
      RETURN 'amanat_lock';     -- 20261002b (P2-1): fișa / cheile persoanei / profilul ținute de altă tranzacție cât timp lotul ține deja
                                -- lock-uri de la un element anterior ⇒ retragere fără așteptare (fără ciclu cu HR); de reîncercat
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

-- (a) A.5 Legarea la cerere, cu previzualizare (c) — politica „fără așteptare” pe elementele următoare ale lotului -----------------
-- Lotul e O tranzacție: lock-urile elementului legat (fișă, chei, profil, auth.users) rămân până la COMMIT. r11: la al doilea element
-- aștepta fișa B ținând cheia comună de nume de la A ⇒ ciclu posibil cu HR (ține fișa B, vrea cheia). 20261002b (P2-1): v_tine = true
-- după orice element care a lăsat lock-uri în urmă (subtranzacție încheiată normal: 'legat', dar și 'schimbat' / 'candidat_ocupat' /
-- 'legatura_existenta' etc., toate luate SUB lock); de atunci gazpet.cont_lock_nowait = 'on' ⇒ fn_cont_revalideaza_candidat ia fișa,
-- cheile și profilul NOWAIT ⇒ 55P03 ⇒ 'amanat_lock' (rezultat explicit; subtranzacția abandonată nu ține nimic). Rezultatele care
-- NU lasă lock-uri ('auth_ocupat', 'amanat_lock' — subtranzacția revalidării s-a anulat; 'eroare' / unique_violation — blocul s-a anulat)
-- nu schimbă v_tine. Primul element (nimic ținut) așteaptă ca până acum. Setarea e locală tranzacției și revine pe off după buclă.
CREATE OR REPLACE FUNCTION public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true, p_confirmate jsonb DEFAULT NULL)
RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text,
              metoda text, cont_creat_la timestamptz, cont_provider text, cont_incredere boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_tine boolean := false;   -- 20261002b (P2-1): lotul ține lock-uri de la un element anterior
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
        -- 20261002b (P2-1): de la al doilea element ținut încolo, toate lock-urile revalidării se iau FĂRĂ așteptare
        PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
        BEGIN
          -- r6 (C-RACE-LINK-1) + r7 (P1-C): lock fișă → profil (ordinea comună a pachetului) și revalidarea AMBELOR jumătăți
          -- sub lock (fișă activă; profil încă nelegat, tip angajat, email profil = email de logare recitit, confirmat;
          -- potrivire recalculată identică). Altfel rezultatul revalidării (schimbat / fara_candidat / tip_cont_exceptat /
          -- email_diferit / email_neconfirmat / legatura_existenta / candidat_ocupat / auth_ocupat — r9: rândul de logare
          -- ținut de GoTrue, fără așteptare; amanat_lock — 20261002b: fișa / cheile / profilul ținute, lotul nu așteaptă;
          -- owner-ul reia „Leagă automat”), fără legare.
          rezultat := public.fn_cont_revalideaza_candidat(r.pid, r.emp);
          IF rezultat IS NULL THEN
            UPDATE public.profiles pr SET employee_id = r.emp
             WHERE pr.id = r.pid AND pr.employee_id IS NULL;
            rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
          END IF;
          IF rezultat NOT IN ('auth_ocupat', 'amanat_lock') THEN
            v_tine := true;                               -- blocul a reușit ⇒ lock-urile lui rămân până la COMMIT ⇒ de aici încolo NOWAIT
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
  PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
END $fn$;
-- P3 (audit C): fără service_role — poarta e owner, service_role ar fi refuzat oricum.
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authenticated;

-- (c)+(d) B.5b Procesarea cozii (d) — notificări reluabile + contor de amânări cu alertă ----------------------------------------
-- Neschimbat față de r11: identitatea, ordinea lock-urilor (fișă → persoană → profil → intrare), modul fără așteptare (v_tine),
-- backoff / abandon, semantica amanat_lock (intrarea rămâne fără incercari / backoff / notificare de eșec).
-- 20261002b:
--   (c) handlerul de eroare marchează notificat_la DOAR dacă fn_cont_notifica_owneri a acoperit ≥ 1 owner; la abandonare, 0 acoperiți
--       ⇒ notificat_la = NULL; pasul final „reluare notificări” re-trimite anunțul de abandonare pentru intrările deschise, abandonate,
--       cu notificat_la NULL (intrarea luată FOR UPDATE, NOWAIT dacă sweep-ul ține deja lock-uri) — la fiecare rulare, până ajunge.
--   (d) la fiecare amânare (amanat_lock) contorul amanari += 1 pe intrare (FOR UPDATE NOWAIT în subtranzacție proprie: intrarea ținută
--       de altcineva ⇒ WARNING, fără așteptare, fără incrementare); după prag (6, apoi la fiecare multiplu de 6) owner-ul e anunțat
--       (cont_inchidere_amanata); elementul procesat normal și rămas deschis (scadența mutată) își resetează contorul.
--       Rezultatul sweep-ului capătă cheile 'amanari_alerta' și 'notificare_reluata' (contoare, ca celelalte).
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_max_incercari constant integer := 8;
  c_prag_amanari  constant integer := 6;   -- 20261002b (P2-4): ~30 min la cron de 5 min
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
  v_k      integer;
  -- r8 (P2 Jakarinos pe b916970): sweep-ul e O tranzacție (SELECT din pg_cron) ⇒ lock-urile elementelor procesate (fișă,
  -- cheile persoanei, profil, intrare) rămân până la COMMIT. Regula r8: sweep-ul AȘTEAPTĂ doar cât timp nu ține nimic de la un
  -- element anterior (v_tine = false); de la al doilea element ținut încolo, toate lock-urile se iau FĂRĂ așteptare
  -- (NOWAIT / pg_try_advisory_xact_lock prin gazpet.cont_lock_nowait) și un 55P03 = „amânat” (amanat_lock): intrarea rămâne
  -- NEATINSĂ (fără incercari / backoff / notificare de eșec) și se procesează la rularea următoare (≤ 5 min).
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
    PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
    BEGIN
      IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
        -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
        IF v_tine THEN
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;
        ELSE
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
        END IF;
        -- 1) persoana (lock până la COMMIT); r8: fără așteptare dacă sweep-ul ține deja lock-uri de la alt element
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
          -- restaurare mai nouă decât intrarea: decizia owner-ului rămâne. r10: pentru o REEVALUARE ISTORICĂ restaurarea se respectă
          -- INDIFERENT de creat_la — nu e o plecare nouă a lui B; doar o plecare nouă ('programata') sau închiderea manuală ridică blocajul.
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
      ELSIF x.amanari > 0 THEN
        UPDATE public.conturi_inchideri_coada SET amanari = 0 WHERE id = x.id;   -- 20261002b (P2-4): procesat normal, rămâne deschis ⇒ contenția s-a încheiat
      END IF;
      v_tine := true;
    EXCEPTION WHEN OTHERS THEN
      -- r8 (P2): 55P03 primit cât timp sweep-ul ținea lock-uri de la alt element = contenție, nu eșec: intrarea rămâne
      -- neatinsă (fără incercari / backoff / notificare), se reia la rularea următoare.
      -- r10 (blocant d): rândul din auth.users ținut de GoTrue (fn_cont_inchide: 55P03 cu DETAIL 'auth_ocupat') = retragere și pe
      -- PRIMUL element (v_tine = false); elementul se reia la rularea următoare (amanat_lock), nu intră în backoff.
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      IF SQLSTATE = '55P03' AND (v_tine OR v_detail = 'auth_ocupat') THEN
        v_amanat := true;
        v_n := jsonb_set(v_n, ARRAY['amanat_lock'], to_jsonb(COALESCE((v_n ->> 'amanat_lock')::int, 0) + 1));
        -- 20261002b (P2-4): contorul de amânări pe intrare + alertă după prag. Subtranzacția elementului s-a anulat (nimic ținut de la
        -- el); intrarea se ia FĂRĂ așteptare (altcineva o ține ⇒ fără incrementare la rularea asta — nu se așteaptă niciodată aici).
        -- Dacă blocul reușește, intrarea rămâne ținută până la COMMIT ⇒ v_tine := true (regula r9 P2-3).
        BEGIN
          PERFORM 1 FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;
          UPDATE public.conturi_inchideri_coada
             SET amanari = amanari + 1
           WHERE id = q.id AND rezolvat_la IS NULL
             AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)   -- (r5: doar intrarea pe care a lucrat)
          RETURNING * INTO x;
          v_tine := true;
          IF FOUND AND x.amanari >= c_prag_amanari AND x.amanari % c_prag_amanari = 0 THEN
            v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_amanata', '⏳ Închiderea automată a contului e amânată repetat',
              format('%s (coada #%s, %s): amânată de %s ori la rând (~%s min) — altă operație ținea fișa, contul de logare sau cheile persoanei de fiecare dată; coada reîncearcă la fiecare rulare. Verifică dacă există o tranzacție blocată (HR / GoTrue) sau închide contul manual (Admin → Manageri).',
                     v_email, x.id, x.tip, x.amanari, x.amanari * 5),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            v_n := jsonb_set(v_n, ARRAY['amanari_alerta'], to_jsonb(COALESCE((v_n ->> 'amanari_alerta')::int, 0) + 1));
          END IF;
        EXCEPTION WHEN lock_not_available THEN
          RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): intrarea e ținută de altă tranzacție — contorul de amânări nu se incrementează la rularea asta', q.id;
        END;
      END IF;
      IF NOT v_amanat THEN
      v_err := SQLERRM;
      v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
      BEGIN
        -- subtranzacția anulată a eliberat lock-urile din bloc → aceeași ordine: profil, apoi intrarea
        -- (r8: fără așteptare dacă se țin lock-uri de la alt element; 55P03 aici ⇒ doar WARNING, backoff-ul se face la rularea următoare)
        -- r9 (P2-3): și intrarea se preblochează NOWAIT când se țin lock-uri anterioare; dacă blocul reușește, lock-urile lui
        -- (profil + intrare) rămân până la COMMIT ⇒ v_tine := true la final.
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
            -- 20261002b (P2-3): anunțul de abandonare e marcat DOAR dacă a acoperit ≥ 1 owner; altfel notificat_la = NULL ⇒ pasul
            -- „reluare notificări” îl re-trimite la rulările următoare (intrarea abandonată nu mai trece prin bucla principală)
            v_k := public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
              format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                     v_email, x.id, x.tip, x.incercari, v_err),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            UPDATE public.conturi_inchideri_coada SET notificat_la = CASE WHEN v_k > 0 THEN now() END WHERE id = q.id;
          ELSIF x.notificat_la IS NULL THEN
            v_k := public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
              format('%s (coada #%s, %s): %s · se reîncearcă automat (încercarea %s din %s; următoarea după %s)',
                     v_email, x.id, x.tip, v_err, x.incercari, c_max_incercari,
                     to_char(x.urmatoarea_incercare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            -- 20261002b (P2-3): 0 owneri acoperiți (toți ținuți FOR UPDATE) ⇒ intrarea rămâne „neanunțată” și se anunță la eroarea următoare
            IF v_k > 0 THEN
              UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = q.id;
            END IF;
          END IF;
        END IF;
        v_tine := true;   -- r9 (P2-3): blocul a reușit ⇒ profilul + intrarea rămân ținute până la COMMIT ⇒ de aici încolo NOWAIT
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): % [%] · eroarea inițială: %', q.id, SQLERRM, SQLSTATE, v_err;
      END;
      END IF;   -- NOT v_amanat
    END;
  END LOOP;
  -- 20261002b (P2-3): reluarea anunțului de abandonare pentru intrările deschise, abandonate, încă neanunțate (0 owneri acoperiți la
  -- abandonare). Aceeași regulă de așteptare ca bucla principală: FOR UPDATE NOWAIT dacă se țin lock-uri; blocul reușit ⇒ v_tine.
  FOR q IN SELECT c.id, c.profile_id, c.employee_id, c.tip
             FROM public.conturi_inchideri_coada c
            WHERE c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL
            ORDER BY c.id LOOP
    BEGIN
      IF v_tine THEN
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id AND c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL FOR UPDATE NOWAIT;
      ELSE
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id AND c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL FOR UPDATE;
      END IF;
      IF FOUND THEN
        v_tine := true;
        v_email := (SELECT p.email FROM public.profiles p WHERE p.id = x.profile_id);
        v_k := public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
          format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                 v_email, x.id, x.tip, x.incercari, x.ultima_eroare),
          '/admin?tab=managers&cont=' || x.profile_id::text);
        IF v_k > 0 THEN
          UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = x.id;
          v_n := jsonb_set(v_n, ARRAY['notificare_reluata'], to_jsonb(COALESCE((v_n ->> 'notificare_reluata')::int, 0) + 1));
        END IF;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): intrarea abandonată e ținută de altă tranzacție — anunțul se reia la rularea următoare', q.id;
    END;
  END LOOP;
  PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_sweep() FROM PUBLIC, anon, authenticated, service_role;

-- ── Postcondiții — orice abatere anulează tot ────────────────────────────────────────────
DO $post_livrare$
DECLARE v_lipsa text[]; v_tip text;
BEGIN
  -- funcțiile înlocuite au EXACT amprenta acestei migrări (semnătură unică, md5, SECURITY DEFINER, proconfig, owner, ACL neschimbat)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       'f969f77614176d63341f69e1909c11f1',    '{postgres=X/postgres}'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '526b9a2c30d4d70df3d94928e597de17', '{postgres=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4',       '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       '9e203157af28de6961876d2ce06ee678',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
                        AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: amprentă diferită (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = ANY(ARRAY['fn_cont_notifica_owneri','fn_cont_serializare_activa','fn_cont_revalideaza_candidat','fn_cont_leaga_automat','fn_conturi_inchideri_sweep']::text[])
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
  -- (b) garda nouă trece pe triggerele live ale lui d (altfel legarea ar refuza cu serializare_indisponibila după livrare)
  IF NOT public.fn_cont_serializare_activa() THEN
    RAISE EXCEPTION 'Postcondiție: fn_cont_serializare_activa() = false după înlocuire — triggerele lui d nu au forma așteptată';
  END IF;
  -- (d) coloana contorului
  SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || ' default ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-')
    INTO v_tip
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.conturi_inchideri_coada'::regclass AND a.attname = 'amanari' AND NOT a.attisdropped;
  IF v_tip IS DISTINCT FROM 'integer not null default 0' THEN
    RAISE EXCEPTION 'Postcondiție: conturi_inchideri_coada.amanari lipsește sau are altă definiție (%)', v_tip;
  END IF;
  -- tabela cozii rămâne cu RLS și fără drepturi pentru anon (coloana nouă nu schimbă nimic, dar se verifică)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_inchideri_coada'::regclass)
     OR has_table_privilege('anon', 'public.conturi_inchideri_coada', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Postcondiție: conturi_inchideri_coada fără RLS sau cu drepturi pentru anon';
  END IF;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002b_conturi_p2_followup:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002b: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
