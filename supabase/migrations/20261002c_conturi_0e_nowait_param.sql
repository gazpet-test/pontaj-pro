-- ============================================================================
-- 20261002c — Conturi (follow-up 20261002b LIVE din 02.10.2026, v20261002124500, sha256 6e0a1fb0…): corecție pentru gate-ul
-- permanent 0e al runner-ului (scripts/control_0e.sql, SEC F2 r8). Livrarea lui 20261002b a ieșit cu cod 30 (GATE 0e): migrarea e
-- COMISĂ și înregistrată, dar controlul 0e a găsit o funcție EXPUSĂ (EXECUTE pentru authenticated) al cărei corp conține textual
-- set_config — fn_cont_leaga_automat(boolean,jsonb), care de la P2-1 scria gazpet.cont_lock_nowait (de două ori: în buclă, la fiecare
-- element, și după buclă). Gate-ul e LEXICAL și fail-closed: orice set_config într-o funcție expusă = refuz, fără listă albă pe numele
-- GUC-ului (invariantul 0e nu deosebește un GUC de identitate de unul aplicativ). Cauza: fix-ul P2-1 a copiat politica sweep-ului
-- (neexpus) într-o funcție expusă.
--
-- Fix (aditiv, fără schimbare de semantică): scrierea GUC-ului se mută într-o funcție NOUĂ, NEEXPUSĂ, cu nume de GUC FIX și valoare
-- booleană — public.fn_cont_lot_nowait(p_tine boolean) (REVOKE ALL; o apelează doar fn_cont_leaga_automat, SECURITY DEFINER, poarta
-- owner). fn_cont_leaga_automat primește EXACT corpul r4 (20261002b) cu cele două linii PERFORM set_config(...) înlocuite prin
-- PERFORM public.fn_cont_lot_nowait(v_tine) / (false), în aceleași poziții (înaintea subtranzacției elementului; după buclă) ⇒ semantica
-- P2-1 e păstrată bit cu bit: primul element al lotului AȘTEAPTĂ; de la primul element ȚINUT încolo fișa, cheile persoanei și profilul
-- se iau NOWAIT (fn_cont_revalideaza_candidat + fn_cont_lock_chei citesc același GUC, local tranzacției) ⇒ 55P03 ⇒ 'amanat_lock';
-- după buclă GUC-ul revine pe off. Corpul nou al lui fn_cont_leaga_automat nu conține set_config / current_setting nici în comentarii.
--
-- De ce NU varianta „parametru p_nowait pe fn_cont_revalideaza_candidat” (recomandarea inițială): ar schimba semnătura unei funcții
-- pe care 20260929c o (re)creează cu CREATE OR REPLACE pe semnătura (uuid,integer,boolean) ⇒ la o reaplicare a lui c (harness-ul
-- reaplică c → d → e → 20261002b → 20261002c) ar apărea DOUĂ overload-uri, iar precondiția „exact o funcție cu numele ăsta” din
-- 20261002b ar refuza. Varianta de față lasă fn_cont_revalideaza_candidat (md5 ecbbd64c…) și fn_cont_lock_chei (md5 db9b9899…)
-- NEATINSE (verificate ca precondiție: contractul GUC-ului pe care îl citesc e cel cunoscut) și schimbă o singură funcție expusă.
-- Echivalența de securitate: în ambele variante funcția expusă poate cere DOAR comutarea unui GUC aplicativ cu nume fix, printr-o
-- funcție neexpusă; niciuna nu poate scrie role / request.jwt.* / session_authorization. Sweep-ul (neexpus) rămâne neschimbat.
--
-- Stilul runner-ului: gardă de livrare start/final (marcaj legat de txid), precondiții fail-closed cu md5 pe funcțiile LIVE r4
-- (leaga_automat a32cb851…, revalideaza ecbbd64c…, lock_chei db9b9899…), postcondiții (md5 nou, ACL-uri, EXACT interogarea
-- scripts/control_0e.sql ⇒ 0 rânduri), fără BEGIN/COMMIT. Idempotentă (la reaplicare: md5 propriu). Nu atinge datele.
-- Revenire: supabase/revenire/20261002c_conturi_0e_nowait_param_ROLLBACK.sql (readuce verbatim corpul r4 al lui fn_cont_leaga_automat
-- — adică starea comisă pe live, care NU trece gate-ul 0e — și șterge fn_cont_lot_nowait).
-- ============================================================================

-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002c_conturi_0e_nowait_param:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed ──────────────────────────────────────────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[]; v_acl text; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- pachetul c/d + follow-up-ul 20261002b sunt livrate (obiectele de care depinde corecția)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_cont_leaga_automat','fn_cont_revalideaza_candidat','fn_cont_lock_chei',
                                                      'fn_cont_serializare_activa','fn_cont_candidati_angajat','fn_identitate_privilegiata',
                                                      'fn_conturi_inchideri_sweep']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile pachetului c/d: %', v_lipsa; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conturi_inchideri_coada'::regclass AND attname = 'amanari' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Precondiție: 20261002b nu e aplicat (conturi_inchideri_coada.amanari lipsește) — corecția pornește din starea r4 live';
  END IF;
  -- Funcția înlocuită pornește EXACT din varianta LIVE r4 (20261002b, md5 prosrc a32cb851…) sau, la reaplicare, din varianta proprie;
  -- funcțiile NEATINSE care citesc GUC-ul (revalideaza, lock_chei) au EXACT amprenta live r4 (contractul gazpet.cont_lock_nowait e cel
  -- cunoscut). Toate: semnătură unică, SECURITY DEFINER, proconfig, owner postgres.
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4', 'b07f3800bebe399057d47336582b26c6'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                 ('fn_cont_lock_chei',            'fn_cont_lock_chei(text[])',                          'db9b9899dbbece0ea56d6f0a71361aff', 'db9b9899dbbece0ea56d6f0a71361aff')) AS w(f, sig, m_live, m_nou)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) IN (w.m_live, w.m_nou) AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: funcțiile nu au amprenta LIVE r4 / 20261002b (semnătură/md5/secdef/proconfig/owner): % — se reanalizează', v_lipsa; END IF;
  -- ACL-urile de pornire (păstrate de CREATE OR REPLACE): fn_cont_leaga_automat = owner + authenticated; revalideaza / lock_chei doar postgres
  SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)');
  IF v_acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_cont_revalideaza_candidat(uuid,integer,boolean)'), to_regprocedure('public.fn_cont_lock_chei(text[])'))
                   AND p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție: ACL-urile funcțiilor diferă de cele livrate de c / 20261002b (leaga_automat = %) — se reanalizează', v_acl;
  END IF;
  -- funcția nouă: absentă (prima aplicare) sau exact varianta proprie (reaplicare), neexpusă; niciun alt overload cu numele ăsta
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_cont_lot_nowait';
  IF v_n > 0 AND (v_n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc p
                                            WHERE p.oid = to_regprocedure('public.fn_cont_lot_nowait(boolean)') AND md5(p.prosrc) = '0477bce8444e8265d3a469f8f14c3a54'
                                              AND p.prosecdef AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                                              AND pg_get_userbyid(p.proowner)::text = 'postgres' AND p.proacl::text = '{postgres=X/postgres}')) THEN
    RAISE EXCEPTION 'Precondiție: public.fn_cont_lot_nowait există cu altă definiție / alt ACL — se reanalizează';
  END IF;
  -- gate-ul 0e e satisfăcut de TOT restul catalogului: singura funcție expusă cu set_config e cea pe care o înlocuim (altfel corecția
  -- n-ar închide incidentul și se reanalizează înainte de livrare). Aceeași interogare ca scripts/control_0e.sql, fără rândul nostru.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p', 'w')
                AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
                AND p.oid <> to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)')
                AND lower(replace(regexp_replace(regexp_replace(COALESCE(CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_get_function_sqlbody(p.oid) END, '') || E'\n ; ' || pg_get_function_arguments(p.oid), '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'), '"', '')) ~ 'set_config') THEN
    RAISE EXCEPTION 'Precondiție: altă funcție expusă conține set_config — incidentul 0e nu se închide cu migrarea asta; se reanalizează';
  END IF;
END $pre_livrare$;

-- ── Funcție NOUĂ, neexpusă: singurul loc în care lotul scrie gazpet.cont_lock_nowait ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cont_lot_nowait(p_tine boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- 20261002c (gate 0e, SEC F2): singurul loc în care lotul de legare scrie gazpet.cont_lock_nowait. Numele GUC-ului e FIX
  -- (nu vine din argument), valoarea e doar 'on' / 'off', setarea e LOCALĂ tranzacției (ca în sweep, r8/r9). Funcția NU e
  -- expusă (REVOKE ALL): o apelează DOAR fn_cont_leaga_automat (SECURITY DEFINER, poarta owner), la fiecare element al lotului
  -- (p_tine = lotul ține deja lock-uri de la un element anterior ⇒ 'on') și după buclă (false ⇒ 'off').
  PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN COALESCE(p_tine, false) THEN 'on' ELSE 'off' END, true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_lot_nowait(boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ── (c) A.5 Legarea la cerere, cu previzualizare — corpul r4 (20261002b) cu cele două PERFORM set_config(...) înlocuite ──────────
-- Poziții identice: înaintea subtranzacției fiecărui element (p_tine = v_tine) și după buclă (false). Nimic altceva nu se schimbă:
-- previzualizarea, ordinea, rezultatele ('legat', 'amanat_lock', 'auth_ocupat', 'schimbat', …), regula v_tine (true după orice
-- element care a lăsat lock-uri; neschimbat la 'auth_ocupat' / 'amanat_lock' / eroare), poarta owner (42501), validarea listei (22023).
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
        PERFORM public.fn_cont_lot_nowait(v_tine);   -- 20261002c (gate 0e): GUC-ul se scrie DOAR în funcția neexpusă
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
  PERFORM public.fn_cont_lot_nowait(false);   -- 20261002c: lotul s-a terminat ⇒ modul fără așteptare revine pe off
END $fn$;
-- P3 (audit C): fără service_role — poarta e owner, service_role ar fi refuzat oricum.
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authenticated;

-- ── Postcondiții — orice abatere anulează tot ────────────────────────────────────────────
DO $post_livrare$
DECLARE v_lipsa text[]; v_n integer; v_gadget text;
BEGIN
  -- amprenta EXACTĂ a acestei migrări (semnătură unică, md5, SECURITY DEFINER, proconfig, owner, ACL) + funcțiile neatinse rămân r4
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'b07f3800bebe399057d47336582b26c6', '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_lot_nowait',           'fn_cont_lot_nowait(boolean)',                        '0477bce8444e8265d3a469f8f14c3a54', '{postgres=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                 ('fn_cont_lock_chei',            'fn_cont_lock_chei(text[])',                          'db9b9899dbbece0ea56d6f0a71361aff', '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
                        AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: amprentă diferită (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
  -- EXECUTE EFECTIV: leaga_automat doar authenticated (+ owner); fn_cont_lot_nowait pentru nimeni în afară de postgres
  IF has_function_privilege('anon', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_cont_leaga_automat(boolean,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_cont_lot_nowait(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_cont_lot_nowait(boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_cont_lot_nowait(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție: drepturi efective de EXECUTE greșite (leaga_automat ≠ doar authenticated sau fn_cont_lot_nowait expusă)';
  END IF;
  -- corpul expus nu mai conține nici set_config, nici current_setting (nici în comentarii — verificare pe textul brut)
  IF (SELECT p.prosrc ~* 'set_config|current_setting' FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)')) THEN
    RAISE EXCEPTION 'Postcondiție: fn_cont_leaga_automat conține încă set_config / current_setting';
  END IF;
  -- GATE 0e — EXACT interogarea din scripts/control_0e.sql (SEC F2 r8), rulată la finalul tranzacției: trebuie 0 rânduri, altfel se anulează tot
  SELECT count(*), string_agg(q.functie || ' [' || q.motive || ']', '; ' ORDER BY q.functie) INTO v_n, v_gadget
    FROM (
           -- SEC F2 0e (r8) — invariant de catalog: nicio funcție expusă (public/graphql_public, EXECUTE pentru anon/authenticated) nu poate scrie GUC-urile de identitate și nu interpretează SQL primit ca argument
           WITH f AS (
             SELECT p.oid, p.oid::regprocedure::text AS functie, p.prosecdef, md5(p.prosrc) AS md5_src,
                    EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c ~* '^(role|session_authorization|request\.jwt[^=]*)=') AS cfg,
                    CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_get_function_sqlbody(p.oid) END
                      || E'\n ; ' || pg_get_function_arguments(p.oid) AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p', 'w')
                AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
           ), t AS (
             SELECT f.*,
                    lower(replace(regexp_replace(regexp_replace(regexp_replace(f.def, '/\*.*?\*/', ' ', 'g'), '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'), '"', ''))
                      || ' ; ' || lower(replace(f.def, '"', '')) AS txt
               FROM f
           ), m AS (
             SELECT t.functie, t.prosecdef, array_remove(ARRAY[
                      CASE WHEN t.def IS NULL THEN 'corp necitibil' END,
                      CASE WHEN t.cfg THEN 'proconfig' END,
                      CASE WHEN t.txt ~ 'set_config' THEN 'set_config' END,
                      CASE WHEN t.txt ~ 'request(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*\.(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*jwt' THEN 'request.jwt' END,
                      CASE WHEN t.txt ~ 'session(_|\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)+authorization' THEN 'session_authorization' END,
                      CASE WHEN t.txt ~ '(^|;|>>|\m(begin|then|else|loop|atomic)\M)(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*(set|reset)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*((session|local)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*)?role\M' THEN 'set/reset role' END,
                      CASE WHEN t.txt ~ '\mu&' THEN 'u&' END,
                      CASE WHEN t.txt ~ '/\*([^*]|\*+[^*/])*/\*' THEN 'comentariu imbricat' END,
                      CASE WHEN t.txt ~ '\m(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|cursor_to_xml|cursor_to_xmlschema|table_to_xml|table_to_xmlschema|table_to_xml_and_xmlschema|schema_to_xml|schema_to_xmlschema|schema_to_xml_and_xmlschema|database_to_xml|database_to_xmlschema|database_to_xml_and_xmlschema|ts_stat|ts_rewrite|crosstab|crosstab2|crosstab3|crosstab4|connectby|dblink|dblink_exec|dblink_open|dblink_send_query|xpath_table)\M' THEN 'interpretor SQL' END,
                      CASE WHEN t.txt ~ '\mexecute\M' AND NOT EXISTS (
                             SELECT 1 FROM (VALUES ('public.fn_completare_aplica(bigint,boolean)', '47a7542895c0ce71cb0e44d2c26d0609')) AS w(semnatura, md5_prosrc)
                              WHERE t.prosecdef AND t.oid = to_regprocedure(w.semnatura) AND t.md5_src = w.md5_prosrc) THEN 'execute' END
                    ], NULL) AS motive
               FROM t
           )
           SELECT m.functie, m.prosecdef, array_to_string(m.motive, ',') AS motive
             FROM m
            WHERE cardinality(m.motive) > 0
            ORDER BY 1
         ) AS q;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 0e: % funcții expuse (public/graphql_public, EXECUTE pentru anon/authenticated) pot scrie GUC-uri sau interpretează SQL — se anulează tot (fail-closed): %', v_n, v_gadget;
  END IF;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002c_conturi_0e_nowait_param:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002c: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
