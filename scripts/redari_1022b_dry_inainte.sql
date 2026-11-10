-- scripts/redari_1022b_dry_inainte.sql — PR #1022, DRY 2 (costul pe rând sub rolul aplicației). Rulat în ACEEAȘI tranzacție, ÎNAINTEA
-- migrării 20261131g. Nu scrie nimic persistent: doar tabele / funcții TEMP (ON COMMIT DROP), apoi ROLLBACK (îl dă cine rulează).
-- Secvența, DINTR-UN SINGUR FIȘIER rulat cu `psql -X -v ON_ERROR_STOP=1 -f <secventa.sql>` (nu tastată interactiv):
--   BEGIN;
--   \i scripts/redari_1022b_dry_inainte.sql
--   -- opțional, 31f în aceeași probă: SELECT set_config('gazpet.livrare_migrare', '20261131f_redari_centralizator_pushdown:' || txid_current(), true);
--   --                                   \i supabase/migrations/20261131f_redari_centralizator_pushdown.sql
--   SELECT set_config('gazpet.livrare_migrare', '20261131g_redari_stare_cost_rls:' || txid_current(), true);
--   \i supabase/migrations/20261131g_redari_stare_cost_rls.sql
--   \i scripts/redari_1022b_dry.sql
--   ROLLBACK;
-- Închiderea tranzacției la eroare (review Jakarinos r8 P2): cu ON_ERROR_STOP psql iese la prima eroare, conexiunea se închide și
--   tranzacția se anulează (lock-urile migrării se eliberează); în plus idle_in_transaction_session_timeout = 60 s închide pe server
--   o sesiune lăsată deschisă.
-- Plafonul ferestrei cu lock-uri (review Jakarinos r9 P2): 120 s de la începutul migrării până la final, impus, nu doar constatat:
--   • migrarea (31f: 8 instrucțiuni, 31g: 44, doar catalog) rulează cu statement_timeout = 1 s, setat la sfârșitul acestui script,
--     deci durează cel mult ~1 min chiar în cel mai rău caz (o așteptare de lock peste 1 s = eroare → ROLLBACK; se reia într-un moment liniștit);
--   • în scriptul „după”, ÎNAINTEA fiecărei instrucțiuni care citește date, dry1022b_buget refuză dacă bugetul s-a terminat și setează
--     statement_timeout = min(30 s, timpul rămas), deci nicio instrucțiune nu poate trece de plafon; în plus bugetul se verifică după
--     fiecare citire din interiorul funcțiilor (refuz cât mai devreme).
-- Ce măsoară, pe TEST-RAZVAN și LOT1-PRUNISOR-JUPA, cu aceleași citiri ca ecranele (Dashboard: red_v_centralizator_uat cu stare nenulă
-- și red_v_tronson; Registru: red_v_stare_parcela pe proiect), în ipostazele:
--   postgres (fără utilizator) · authenticated cu JWT de owner · authenticated cu JWT de non-owner pe fiecare nivel Redări
--   (admin / editor / viewer, primul cont de fiecare nivel; un nivel fără cont e sărit cu NOTICE, declarat în raport).
-- Identitatea (review Jakarinos r8 P1): fiecare ipostază setează AMBELE surse citite de auth.uid() (request.jwt.claim.sub și
--   request.jwt.claims) și, la fiecare pas, se verifică: auth.uid() = contul așteptat (NULL pentru postgres), fn_red_nivel() = nivelul
--   așteptat, current_user exact, iar rolul authenticated fără SUPERUSER / BYPASSRLS (altfel RLS nu s-ar evalua).
-- Pentru paritatea ramurii FARA_ADRESA_AFISARE se salvează aici (fără lock-uri) rezultatul funcției vechi fn_red_adresa_cunoscuta pe
--   TOȚI deținătorii activi, în fiecare ipostază cu utilizator, plus un cont FĂRĂ drept Redări (poarta închisă); scriptul „după”
--   compară funcția nouă pe aceleași rânduri (0 diferențe = condiția tare) și raportează categoriile fără cazuri în date (adresă da /
--   adresă nu / fără contact); ramura „fără contact” o verifică în plus pe o sondă fără scriere (r12, vezi scriptul „după”).
-- Pentru fiecare rând de ecran se păstrează doar amprenta md5 (fără date în clar), pentru comparația EXCEPT ALL din scriptul „după”.
-- Plus: EXPLAIN (ANALYZE, BUFFERS) ca owner pe centralizator; numărul de apeluri ale funcțiilor (dacă track_functions se poate porni).
-- Durată estimată ÎNAINTE de fix: câteva minute (o citire ca utilizator logat ~30–40 s pe LOT1, pe fiecare ipostază). Fără lock-uri.
SET LOCAL statement_timeout = '1200s';   -- citirile vechi ca utilizator logat sunt lente (motivul probei); un timeout invalidează proba
SET LOCAL idle_in_transaction_session_timeout = '60s';
DO $pre$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'dry 1022b: rulati ca postgres'; END IF;
  IF (SELECT count(*) FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA')) <> 2 THEN
    RAISE EXCEPTION 'dry 1022b: lipsesc proiectele de comparat'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') THEN
    RAISE EXCEPTION 'dry 1022b: 20261131g pare deja aplicata — scriptul „inainte” ruleaza INAINTEA ei'; END IF;
  IF to_regclass('pg_temp.dry1022b_rez') IS NOT NULL THEN RAISE EXCEPTION 'dry 1022b: scriptul „inainte” a rulat deja in aceasta sesiune'; END IF;
  -- RLS ar fi inert dacă rolul aplicației ar ocoli politicile: proba n-ar dovedi nimic
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated' AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'dry 1022b: rolul authenticated are SUPERUSER / BYPASSRLS — proba nu e valida'; END IF;
END $pre$;
-- numărarea apelurilor de funcții (diagnostic, opțional): cere drept de setare pe track_functions
DO $tf$ BEGIN
  BEGIN
    PERFORM set_config('track_functions', 'all', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dry 1022b: track_functions nu poate fi pornit (%) — apelurile de functii nu se numara', SQLSTATE;
  END;
  RAISE NOTICE 'dry 1022b: track_functions = %', current_setting('track_functions');
END $tf$;

CREATE TEMP TABLE dry1022b_rez (faza text, rol text, vedere text, cod text, amprenta text) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_timp (faza text, rol text, vedere text, cod text, randuri bigint, ms numeric) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_apeluri (faza text, rol text, vedere text, cod text, functie text, apeluri bigint) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_util (rol text PRIMARY KEY, uid uuid NOT NULL, nivel text) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_categ (detinator_id uuid PRIMARY KEY, categ text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_adresa (rol text, detinator_id uuid, categ text, veche boolean, PRIMARY KEY (rol, detinator_id)) ON COMMIT DROP;
CREATE TEMP TABLE dry1022b_ceas (eticheta text PRIMARY KEY, t timestamptz NOT NULL) ON COMMIT DROP;
-- rolul authenticated citește / scrie în tabelele probei (doar în această sesiune; dispar la ROLLBACK)
GRANT SELECT, INSERT ON pg_temp.dry1022b_rez, pg_temp.dry1022b_timp, pg_temp.dry1022b_apeluri, pg_temp.dry1022b_adresa TO authenticated;
GRANT SELECT ON pg_temp.dry1022b_util, pg_temp.dry1022b_categ, pg_temp.dry1022b_ceas TO authenticated;
-- conturile probei: owner (fn_red_nivel = 'admin'), câte un non-owner pe fiecare nivel, un cont fără drept Redări (nivel NULL)
INSERT INTO pg_temp.dry1022b_util SELECT 'owner', id, 'admin' FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
INSERT INTO pg_temp.dry1022b_util
  SELECT DISTINCT ON (uma.access_level) uma.access_level, uma.profile_id, uma.access_level
    FROM public.user_module_access uma JOIN public.profiles pr ON pr.id = uma.profile_id
   WHERE uma.module = 'redari' AND uma.access_level IN ('viewer', 'editor', 'admin') AND pr.is_owner IS NOT TRUE
   ORDER BY uma.access_level, uma.profile_id;
INSERT INTO pg_temp.dry1022b_util
  SELECT 'fara_drept', pr.id, NULL FROM public.profiles pr
   WHERE pr.is_owner IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = pr.id AND u.module = 'redari')
   ORDER BY pr.id LIMIT 1;
DO $util$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_util WHERE rol = 'owner') THEN RAISE EXCEPTION 'dry 1022b: niciun owner pentru proba cu JWT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_util WHERE rol = 'fara_drept') THEN RAISE EXCEPTION 'dry 1022b: niciun cont fara drept Redari pentru poarta inchisa'; END IF;
  RAISE NOTICE 'dry 1022b: ipostaze cu utilizator = % (niveluri fara cont: %)',
    (SELECT string_agg(rol, ', ' ORDER BY rol) FROM pg_temp.dry1022b_util),
    coalesce((SELECT string_agg(n, ', ') FROM unnest(ARRAY['admin', 'editor', 'viewer']) n WHERE NOT EXISTS (SELECT 1 FROM pg_temp.dry1022b_util u WHERE u.rol = n)), 'niciunul');
END $util$;
-- categoria fiecărui deținător activ (ca postgres, owner-ul tabelelor: fără RLS): adresă cunoscută / necunoscută / fără rând de contact
INSERT INTO pg_temp.dry1022b_categ
  SELECT d.id, CASE WHEN c.detinator_id IS NULL THEN 'fara_contact' WHEN c.adresa_cunoscuta IS TRUE THEN 'adresa_da' ELSE 'adresa_nu' END
    FROM public.red_detinatori d LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id WHERE d.sters_la IS NULL;

-- identitatea unei ipostaze: AMBELE surse citite de auth.uid() (claim.sub e citit primul), plus rolul; postgres = fără utilizator.
-- Fără clauză SET pe funcție (set_config local trebuie să rămână după ieșire); oricum dry1022b_verifica confirmă efectul la fiecare pas.
CREATE FUNCTION pg_temp.dry1022b_identitate(p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $f$
DECLARE v_uid uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'dry 1022b: identitatea se seteaza ca postgres, inainte de SET ROLE'; END IF;
  IF p_rol <> 'postgres' THEN SELECT u.uid INTO v_uid FROM pg_temp.dry1022b_util u WHERE u.rol = p_rol; END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN v_uid IS NULL THEN '' ELSE 'authenticated' END, true);
  PERFORM set_config('request.jwt.claims', CASE WHEN v_uid IS NULL THEN '' ELSE json_build_object('sub', v_uid, 'role', 'authenticated')::text END, true);
END $f$;
-- verificarea identității efective, la începutul fiecărui pas; false = ipostază fără cont (sărită)
CREATE FUNCTION pg_temp.dry1022b_verifica(p_rol text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE u record;
BEGIN
  IF p_rol = 'postgres' THEN
    IF current_user IS DISTINCT FROM 'postgres' OR auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'dry 1022b: ipostaza postgres ruleaza ca % cu auth.uid() = %', current_user, auth.uid(); END IF;
    RETURN true;
  END IF;
  SELECT * INTO u FROM pg_temp.dry1022b_util WHERE rol = p_rol;
  IF NOT FOUND THEN RETURN false; END IF;
  IF current_user IS DISTINCT FROM 'authenticated'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'dry 1022b: ipostaza % ruleaza ca % (sau rolul ocoleste RLS)', p_rol, current_user; END IF;
  IF auth.uid() IS DISTINCT FROM u.uid THEN RAISE EXCEPTION 'dry 1022b: ipostaza % — auth.uid() nu e contul asteptat', p_rol; END IF;
  IF public.fn_red_nivel() IS DISTINCT FROM u.nivel THEN
    RAISE EXCEPTION 'dry 1022b: ipostaza % — fn_red_nivel() = %, asteptat %', p_rol, public.fn_red_nivel(), u.nivel; END IF;
  RETURN true;
END $f$;
-- bugetul ferestrei cu lock-uri (120 s de la începutul migrării): refuz dacă s-a terminat; altfel statement_timeout = min(30 s, rămas),
-- care se aplică instrucțiunii următoare. Fără clauză SET pe funcție (set_config local trebuie să rămână după ieșire).
CREATE FUNCTION pg_temp.dry1022b_buget(p_pas text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $f$
DECLARE t0 timestamptz; rest_ms bigint;
BEGIN
  SELECT c.t INTO t0 FROM pg_temp.dry1022b_ceas c WHERE c.eticheta = 'start_migrare';
  IF t0 IS NULL THEN RAISE EXCEPTION 'dry 1022b: lipseste ceasul ferestrei (scriptul „inainte” incomplet)'; END IF;
  rest_ms := floor(120000 - extract(epoch FROM clock_timestamp() - t0) * 1000);
  IF rest_ms <= 0 THEN RAISE EXCEPTION 'dry 1022b: NU se aplica — fereastra cu lock-uri depaseste 120 s (la %)', p_pas; END IF;
  PERFORM set_config('statement_timeout', least(30000, rest_ms)::text, true);
END $f$;
-- apelurile cumulate în tranzacție ale funcțiilor din lanț (gol dacă track_functions = none)
CREATE FUNCTION pg_temp.dry1022b_apeluri_acum() RETURNS jsonb LANGUAGE sql VOLATILE AS $f$
  SELECT coalesce(jsonb_object_agg(f.funcname, f.calls), '{}'::jsonb) FROM pg_catalog.pg_stat_xact_user_functions f
   WHERE f.schemaname = 'public' AND f.funcname IN ('fn_red_nivel', 'fn_red_parcela_acoperita_a', 'fn_red_adresa_cunoscuta', 'fn_red_detinatori_cu_adresa');
$f$;
-- o ipostază: aceleași citiri ca ecranele, cu timpul fiecăreia; amprenta md5 a fiecărui rând (fără date în clar).
-- În faza „după”: pragul de 5 s pe LOT1 cu utilizator și bugetul ferestrei se verifică IMEDIAT după fiecare citire (refuz pe loc).
CREATE FUNCTION pg_temp.dry1022b_masoara(p_faza text, p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE r record; v record; t0 timestamptz; ms numeric; n bigint; a0 jsonb; a1 jsonb; f text;
BEGIN
  IF NOT pg_temp.dry1022b_verifica(p_rol) THEN RAISE NOTICE 'dry 1022b: % % sarit (niciun cont cu acest nivel)', p_faza, p_rol; RETURN; END IF;
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    FOR v IN SELECT * FROM (VALUES
        ('centralizator', format('SELECT md5(v::text) FROM public.red_v_centralizator_uat v WHERE v.proiect_id = %L AND v.stare IS NOT NULL', r.id)),
        ('tronson', format('SELECT md5(v::text) FROM public.red_v_tronson v WHERE v.proiect_id = %L', r.id)),
        ('stare', format('SELECT md5(v::text) FROM public.red_v_stare_parcela v WHERE v.proiect_id = %L', r.id))) x(vedere, cerere) LOOP
      a0 := pg_temp.dry1022b_apeluri_acum();
      t0 := clock_timestamp();
      EXECUTE format('INSERT INTO pg_temp.dry1022b_rez SELECT %L, %L, %L, %L, q.h FROM (%s) q(h)', p_faza, p_rol, v.vedere, r.cod, v.cerere);
      GET DIAGNOSTICS n = ROW_COUNT;
      ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
      a1 := pg_temp.dry1022b_apeluri_acum();
      INSERT INTO pg_temp.dry1022b_timp VALUES (p_faza, p_rol, v.vedere, r.cod, n, ms);
      FOR f IN SELECT jsonb_object_keys(a1) LOOP
        INSERT INTO pg_temp.dry1022b_apeluri VALUES (p_faza, p_rol, v.vedere, r.cod, f, (a1 ->> f)::bigint - coalesce((a0 ->> f)::bigint, 0));
      END LOOP;
      RAISE NOTICE 'dry 1022b % % % %: % randuri in % ms', p_faza, p_rol, v.vedere, r.cod, n, ms;
      IF p_faza = 'dupa' THEN
        IF p_rol <> 'postgres' AND r.cod = 'LOT1-PRUNISOR-JUPA' AND ms > 5000 THEN
          RAISE EXCEPTION 'dry 1022b: NU se aplica — % % LOT1 = % ms dupa fix (peste 5 s)', p_rol, v.vedere, ms; END IF;
        PERFORM pg_temp.dry1022b_buget(format('%s %s %s', p_rol, v.vedere, r.cod));
      END IF;
    END LOOP;
  END LOOP;
END $f$;
-- planul centralizatorului (ce cere Dashboard-ul), pe ambele proiecte
CREATE FUNCTION pg_temp.dry1022b_explain(p_eticheta text, p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE r record; l text;
BEGIN
  IF NOT pg_temp.dry1022b_verifica(p_rol) THEN RAISE EXCEPTION 'dry 1022b: EXPLAIN cere ipostaza %', p_rol; END IF;
  FOR r IN SELECT id, cod FROM public.red_proiecte WHERE cod IN ('TEST-RAZVAN', 'LOT1-PRUNISOR-JUPA') ORDER BY cod LOOP
    FOR l IN EXECUTE format('EXPLAIN (ANALYZE, BUFFERS) SELECT uat_id, uat3, uat_nume, stare, numar, total_uat, procent_inchise FROM public.red_v_centralizator_uat WHERE proiect_id = %L AND stare IS NOT NULL', r.id) LOOP
      RAISE NOTICE '% % | %', p_eticheta, r.cod, l;
    END LOOP;
    -- în faza „după” (ceasul există): bugetul după fiecare proiect
    IF EXISTS (SELECT 1 FROM pg_temp.dry1022b_ceas) THEN PERFORM pg_temp.dry1022b_buget(format('explain %s', r.cod)); END IF;
  END LOOP;
END $f$;
-- rezultatul funcției vechi fn_red_adresa_cunoscuta pe TOȚI deținătorii activi, în ipostaza curentă (poarta depinde de utilizator)
CREATE FUNCTION pg_temp.dry1022b_adresa_veche(p_rol text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE n bigint;
BEGIN
  IF NOT pg_temp.dry1022b_verifica(p_rol) THEN RAISE NOTICE 'dry 1022b: adresa veche % sarita (niciun cont cu acest nivel)', p_rol; RETURN; END IF;
  INSERT INTO pg_temp.dry1022b_adresa SELECT p_rol, k.detinator_id, k.categ, public.fn_red_adresa_cunoscuta(k.detinator_id) FROM pg_temp.dry1022b_categ k;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'dry 1022b: adresa veche %: % detinatori', p_rol, n;
END $f$;
REVOKE ALL ON FUNCTION pg_temp.dry1022b_identitate(text), pg_temp.dry1022b_verifica(text), pg_temp.dry1022b_buget(text), pg_temp.dry1022b_apeluri_acum(),
  pg_temp.dry1022b_masoara(text, text), pg_temp.dry1022b_explain(text, text), pg_temp.dry1022b_adresa_veche(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.dry1022b_verifica(text), pg_temp.dry1022b_buget(text), pg_temp.dry1022b_apeluri_acum(),
  pg_temp.dry1022b_masoara(text, text), pg_temp.dry1022b_explain(text, text), pg_temp.dry1022b_adresa_veche(text) TO authenticated;

-- 1. postgres, fără utilizator (auth.uid() NULL)
SELECT pg_temp.dry1022b_identitate('postgres');
SELECT pg_temp.dry1022b_masoara('inainte', 'postgres');
-- 2. authenticated cu JWT de owner (ce vede ecranul lui Răzvan)
SELECT pg_temp.dry1022b_identitate('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'owner');
SELECT pg_temp.dry1022b_explain('ROL owner INAINTE', 'owner');
SELECT pg_temp.dry1022b_adresa_veche('owner');
RESET ROLE;
-- 3. authenticated cu JWT de non-owner, pe fiecare nivel Redări (sărit dacă nivelul nu are cont)
SELECT pg_temp.dry1022b_identitate('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'admin');
SELECT pg_temp.dry1022b_adresa_veche('admin');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('editor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'editor');
SELECT pg_temp.dry1022b_adresa_veche('editor');
RESET ROLE;
SELECT pg_temp.dry1022b_identitate('viewer');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_masoara('inainte', 'viewer');
SELECT pg_temp.dry1022b_adresa_veche('viewer');
RESET ROLE;
-- 4. cont fără drept Redări: doar poarta închisă a funcției vechi (vederile nu-i arată nimic)
SELECT pg_temp.dry1022b_identitate('fara_drept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry1022b_adresa_veche('fara_drept');
RESET ROLE;
-- migrarea care urmează rulează ca postgres, fără context de utilizator; de aici pornește bugetul ferestrei cu lock-uri
SELECT pg_temp.dry1022b_identitate('postgres');
SELECT pg_temp.dry1022b_verifica('postgres');
INSERT INTO pg_temp.dry1022b_ceas VALUES ('start_migrare', clock_timestamp());
DO $gata$ BEGIN
  RAISE NOTICE 'dry 1022b: inainte salvat — % amprente, % masuratori, % randuri de adresa', (SELECT count(*) FROM pg_temp.dry1022b_rez),
    (SELECT count(*) FROM pg_temp.dry1022b_timp), (SELECT count(*) FROM pg_temp.dry1022b_adresa);
END $gata$;
-- ULTIMA instrucțiune: migrarea / migrările care urmează (doar catalog) rulează cu 1 s pe instrucțiune (plafonul ferestrei, vezi antetul)
SET LOCAL statement_timeout = '1s';
