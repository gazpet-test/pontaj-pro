-- ════════════════════════════════════════════════════════════════════════════
-- 20261002c_conturi_0e_nowait_param_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
-- LIVE r4 a lui 20261002b (v20261002124500): fn_cont_leaga_automat revine VERBATIM la corpul din 20261002b (liniile 322-420, md5 prosrc
-- a32cb851d317d273feee8e975eba66a4 — corpul cu cele două PERFORM set_config(...)) și fn_cont_lot_nowait dispare. ATENȚIE: starea
-- readusă e cea care NU trece gate-ul permanent 0e (scripts/control_0e.sql ⇒ 1 rând: fn_cont_leaga_automat [set_config]) — revenirea
-- REDESCHIDE incidentul 0e, nu îl rezolvă altfel. Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review
-- Copilot. Armarea nu e autorizare. Ordine: ÎNAINTEA revenirii 20261002b (care cere md5 a32cb851… pe fn_cont_leaga_automat).
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261002c', 'REVINE_0E_NOWAIT:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.rollback_tehnic_20261002c REVINE_0E_NOWAIT
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE v_lipsa text[];
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261002c', true) IS DISTINCT FROM 'REVINE_0E_NOWAIT:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261002c: nearmată (gazpet.rollback_tehnic_20261002c legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261002c=%') THEN
    RAISE EXCEPTION 'Revenire 20261002c: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261002c: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- precondiție: starea e EXACT cea a lui 20261002c (md5 propriu pe fn_cont_leaga_automat + fn_cont_lot_nowait prezentă, unică, neexpusă)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_leaga_automat', 'fn_cont_leaga_automat(boolean,jsonb)', 'b07f3800bebe399057d47336582b26c6', '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_lot_nowait',    'fn_cont_lot_nowait(boolean)',          '0477bce8444e8265d3a469f8f14c3a54', '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261002c: precondiție — funcțiile nu sunt varianta 20261002c (md5 / ACL / unicitate): %', v_lipsa;
  END IF;
  -- nimic altceva nu depinde de fn_cont_lot_nowait (singurul apelant e corpul înlocuit mai jos)
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.oid <> to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)')
               AND p.oid <> to_regprocedure('public.fn_cont_lot_nowait(boolean)') AND p.prosrc ~ 'fn_cont_lot_nowait') THEN
    RAISE EXCEPTION 'Revenire 20261002c: precondiție — altă funcție apelează fn_cont_lot_nowait; se reanalizează';
  END IF;
END $arm$;

-- ── c, A.5 (20261002b r4): fn_cont_leaga_automat — VERBATIM din 20261002b (liniile 322-420; md5 prosrc a32cb851…) ──
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

-- ── funcția adăugată de 20261002c dispare (fără CASCADE: nimic nu depinde de ea — verificat în precondiție) ──
DROP FUNCTION public.fn_cont_lot_nowait(boolean);

-- ── Postcondiție: EXACT starea live r4 (md5 a32cb851…, ACL neschimbat, funcțiile neatinse tot r4), fără fn_cont_lot_nowait; apoi dezarmare ──
DO $post$
DECLARE v_lipsa text[];
BEGIN
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4', '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                 ('fn_cont_lock_chei',            'fn_cont_lock_chei(text[])',                          'db9b9899dbbece0ea56d6f0a71361aff', '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres' AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Revenire 20261002c: postcondiție — amprenta nu e cea live r4: %', v_lipsa; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_cont_lot_nowait') THEN
    RAISE EXCEPTION 'Revenire 20261002c: postcondiție — fn_cont_lot_nowait a rămas';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002c', '', true);
END $post$;
