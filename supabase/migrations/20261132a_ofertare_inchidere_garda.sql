-- Version 20261132120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261132a_ofertare_inchidere_garda — auditul Ofertare 08.11.2026, PR #1027 (review Jakarinos r2, P1 / L07); r2 = PR #1029 după
-- verdictul Jakarinos din 11.11.2026 (merge GO cu condiții, aplicare NO-GO: 2 × P1, 2 × P2).
-- Versiunea de 14 cifre 20261132120000 e liberă: niciun fișier 20261132* și niciun „Version 20261132…” pe main sau pe alt branch din
-- origin (verificat 12.11.2026, main avea migrări până la 20261214a). Runnerul primește versiunea separat (--versiune), deci numele
-- 20261132a rămâne (ordonarea după nume nu contează pentru runner — verdictul 11.11).
--
-- CE FACE. Cine poate trece o licitație în status 'abandonata' (NO-GO sau „închisă ca nedepusă” după termen), impus în BD pe ORICE cale
-- (UI, PATCH direct prin API), nu doar în ecran:
--   * ownerul (profiles.is_owner al auth.uid()), oricând — ca decizia NO-GO de azi (owner-only doar în JS);
--   * responsabilul 1 / 2 numit de owner (fn_ofertare_poate_cheltui, aceeași regulă ca poarta pe cheltuiala AI), DOAR din go / in_lucru
--     și DOAR după termenul de depunere (OLD.termen_depunere <= now()) = închiderea „nedepusă”;
--   * sesiunea SQL de administrare fără utilizator (session_user postgres, fără auth.uid()) — neschimbat față de a00_ofertare_licitatii_scriere.
-- Orice alt apelant: refuz 42501. Celelalte tranziții nu sunt atinse; poarta de depunere (fn_gate_depunere) rămâne neschimbată.
-- Ordinea trigger-elor BEFORE (alfabetic): a00_ofertare_derogare_garda_j05 → a00_ofertare_licitatii_scriere → a01_ofertare_licitatii_loturi_garda
-- → a02 (aceasta) → trg_*. a00_ofertare_licitatii_scriere poate refuza ÎNAINTEA gărzii cu P0001 (service_role care schimbă altceva decât
-- termenul, Financiar, sesiune fără identitate care nu e postgres), deci nu orice refuz din lanț are codul 42501.
-- Garda folosește OLD (status, termen, responsabili): antedatarea termenului sau autoatribuirea în același UPDATE nu dau drept.
-- Lock-uri (L06): un singur lock, SHARE ROW EXCLUSIVE pe ofertare_licitatii — același pe care îl ia oricum CREATE TRIGGER — luat la
-- început, ca trigger-ele să nu se schimbe între verificarea amprentelor și crearea gărzii. Funcția gărzii nu ia lock-uri.
--
-- CE A OBSERVAT RECENZENTUL ȘI NU E DEFECT (verdictul Jakarinos 11.11, notat ca să nu se piardă):
--   * excepția de administrare (auth.uid() NULL) e DOAR session_user = 'postgres' (psql / runner / pg_cron care rulează ca postgres).
--     service_role prin PostgREST și supabase_admin NU o primesc: pentru ele refuză întâi a00 (P0001), iar garda însăși (42501) — testat
--     în dry-run cu a00 oprit (cazurile „izolat”);
--   * fn_ofertare_poate_cheltui admite, intenționat, și responsabilii numiți de un ADMIN Ofertare (nu doar de owner), și numirile vechi
--     (fără „numit de” și fără dovadă; decizia A, 01.11.2026) — aceeași regulă ca poarta pe cheltuiala AI (L19), nu strict „numit de owner”;
--   * SET status = status și editarea unei licitații deja abandonate trec intenționat (NEW = OLD = abandonata sau NEW <> abandonata);
--     redeschiderea unei licitații abandonate nu e atinsă de această gardă;
--   * nicio RPC / edge / cron nu scrie azi 'abandonata' (doar UI-ul: închiderea „nedepusă” din OfertareLicitatii.jsx, cu CAS, și NO-GO-ul
--     ownerului); termen_depunere e timestamptz în fixture-uri, iar tipul live e fixat în amprenta „coloane:public.ofertare_licitatii”.
--
-- AMPRENTELE (L15, review P1). Migrarea refuză dacă schema de pe țintă nu e EXACT baseline-ul revizuit. Valorile stau într-UN SINGUR loc,
-- blocul „AMPRENTE BASELINE” din $pre$ de mai jos; până se completează, migrarea refuză (fail-closed) cu mesajul „nu sunt completate”.
-- Ce acoperă (interogarea „AMPRENTE”, identică în scripts/ofertare_inchidere_garda_amprente.sql — testul vitest compară textul):
--   * funcțiile lanțului de autorizare: fn_ofertare_poate_cheltui, fn_ofertare_responsabil_setat_de, fn_ofertare_licitatii_scriere,
--     fn_are_acces_ofertare, auth.uid() — definiția completă (pg_get_functiondef: corp, SECURITY DEFINER, search_path, volatilitate),
--     proprietar, ACL (sortat; NULL marcat explicit = drepturile implicite), supraîncărcări;
--   * FIECARE trigger ne-intern de pe ofertare_licitatii: definiția, tgtype, activare, WHEN, UPDATE OF (pe nume), argumente, amânare
--     ȘI materialul complet al funcției lui (corp + atribute + ACL) — un CREATE OR REPLACE pe funcția unui trigger, care păstrează
--     semnătura, schimbă amprenta; un trigger nou sau scos schimbă lista;
--   * FIECARE politică RLS de pe ofertare_licitatii (comandă, permisivă, roluri pe nume, USING / WITH CHECK; NULL marcat explicit);
--   * tabelul: proprietar, RLS, FORCE RLS, ACL pe tabel și pe coloane — fiecare termen cu marcaj propriu pentru NULL (relacl NULL nu mai
--     poate ascunde RLS / FORCE, ca în r1);
--   * tipurile coloanelor citite de gardă (ofertare_licitatii, profiles).
-- Interogarea stă într-o funcție TEMPORARĂ (pg_temp.fn_20261132a_amprente, SET search_path = pg_catalog, pg_temp: deparsarea expresiilor
-- nu depinde de sesiune), valorile așteptate în pg_temp.fn_20261132a_asteptat; ambele sunt folosite în $pre$ și în $post$ (după crearea
-- gărzii, amprentele trebuie să fie tot baseline-ul + exact trigger-ul nou) și se șterg înainte de garda finală (nu rămân în schemă).
--
-- PAȘII COORDONATORULUI (chat-ul; sesiunea de cod nu are acces la BD):
--   1. Pe PRODUCȚIE, tranzacție READ ONLY (scriptul o deschide singur), din rădăcina repo-ului:
--        psql -X -v ON_ERROR_STOP=1 -f scripts/ofertare_inchidere_garda_amprente.sql -o <ieșire_prod.txt>
--      Scriptul tipărește pentru fiecare etichetă amprenta (md5) și MATERIALUL din care s-a calculat, apoi blocul gata de lipit.
--   2. Review pe material (nu doar copiere): definițiile trebuie să fie cele din migrările din repo (20260912, 20260928p, 20261001a,
--      20261004a, 20261024b, 20261029a…, 20261124a), politicile cele din 20260928p, ACL-urile cele așteptate. Orice diferență = stop.
--   3. Același script pe CLONĂ: ieșirea trebuie să fie identică cu cea de pe producție (diff), altfel dry-run-ul nu dovedește nimic.
--   4. Blocul tipărit înlocuiește INTEGRAL conținutul dintre marcajele „>>> AMPRENTE BASELINE” și „<<< AMPRENTE BASELINE” (nimic altceva).
--   5. sha256 pe fișierul completat (sha256sum supabase/migrations/20261132a_ofertare_inchidere_garda.sql) → la review, împreună cu
--      ieșirea scriptului; acest sha256 merge la runner (--sha256) și la Copilot / Jakarinos.
--   6. Dry-run pe clonă: supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql (comanda exactă în antetul lui).
-- NEAPLICATĂ. Se aplică doar cu „da”-ul lui Răzvan, prin runner-ul echipei, după pașii de mai sus.
-- Revenire: supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql (verifică amprenta exactă a obiectelor create aici).
DO $start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261132a_ofertare_inchidere_garda:' || txid_current() THEN
    RAISE EXCEPTION '20261132a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261132a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_licitatii') IS NULL OR to_regprocedure('public.fn_ofertare_poate_cheltui(bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION '20261132a: lipseste ofertare_licitatii sau fn_ofertare_poate_cheltui (20261124a)';
  END IF;
  -- același lock pe care îl ia CREATE TRIGGER, luat ÎNAINTEA amprentelor: trigger-ele nu se mai pot schimba până la COMMIT
  LOCK TABLE public.ofertare_licitatii IN SHARE ROW EXCLUSIVE MODE;
END $start$;

CREATE FUNCTION pg_temp.fn_20261132a_asteptat()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $asteptat$
  -- >>> AMPRENTE BASELINE (singurul loc de completat: îl înlocuiește INTEGRAL blocul tipărit de scripts/ofertare_inchidere_garda_amprente.sql)
  SELECT '{
    "coloane:public.ofertare_licitatii": "f4744c6e4ab2b2480bd44c45950dd15b",
    "coloane:public.profiles": "a18d16a2edd79d5ceb02eae299d5e745",
    "fn:auth.uid()": "388dc2e37b0b91d0e7333ce308af8670",
    "fn:public.fn_are_acces_ofertare()": "35ac0991e0739d265a7997c0115df120",
    "fn:public.fn_ofertare_licitatii_scriere()": "237284a2a2e70520f28ac1638a4b961d",
    "fn:public.fn_ofertare_poate_cheltui(bigint,uuid)": "c01245b9c8676ef6e05004a818271107",
    "fn:public.fn_ofertare_responsabil_setat_de()": "ebcd68026bedd5fdb3598a390de2ae06",
    "pol:ofertare_licitatii_delete": "6b8723228b3dbd6e9a2b6cb7535d8eed",
    "pol:ofertare_licitatii_insert": "dca4cc4d23acb9818de1fcddcf3a73a5",
    "pol:ofertare_licitatii_select": "81c323cb060b947c51b99b320b2e0f7e",
    "pol:ofertare_licitatii_update": "8fe95639a0a05b11f3445d2d67b3dffb",
    "tabel:public.ofertare_licitatii": "7aa97656582563bb7db3312d64c9d045",
    "trg:a00_ofertare_derogare_garda_j05": "f967d77f80686c3338d3b7029ac27d75",
    "trg:a00_ofertare_licitatii_scriere": "dd087e59d127121fc17e298e7cc1211f",
    "trg:a01_ofertare_licitatii_loturi_garda": "2789f8df478200542a1680dbeda81b9a",
    "trg:trg_gate_depunere": "1d1ccc07b65edfe078e34b1993ba314e",
    "trg:trg_ofertare_j02b_sens_unic": "ab7a9e20e13c4638724cae682db24986",
    "trg:trg_ofertare_responsabil_setat_de": "c90c5fb867a6c9ecb2254bb8e7635c93"
  }'::jsonb
  -- <<< AMPRENTE BASELINE
$asteptat$;

CREATE FUNCTION pg_temp.fn_20261132a_amprente()
 RETURNS TABLE (eticheta text, amprenta text, material text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $amprente$
-- >>> AMPRENTE: interogarea (text IDENTIC în migrarea 20261132a și în scripts/ofertare_inchidere_garda_amprente.sql; testul vitest compară)
WITH tabel AS (
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.ofertare_licitatii')
), fn_lista(eticheta, sig) AS (VALUES
  ('fn:auth.uid()', 'auth.uid()'),
  ('fn:public.fn_are_acces_ofertare()', 'public.fn_are_acces_ofertare()'),
  ('fn:public.fn_ofertare_licitatii_scriere()', 'public.fn_ofertare_licitatii_scriere()'),
  ('fn:public.fn_ofertare_poate_cheltui(bigint,uuid)', 'public.fn_ofertare_poate_cheltui(bigint,uuid)'),
  ('fn:public.fn_ofertare_responsabil_setat_de()', 'public.fn_ofertare_responsabil_setat_de()')
), trg AS (
  SELECT t.* FROM pg_catalog.pg_trigger t JOIN tabel ON t.tgrelid = tabel.oid WHERE NOT t.tgisinternal
), fn_mat AS (
  SELECT p.oid,
         'semnatura: ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || E'\nproprietar: ' || pg_get_userbyid(p.proowner)
      || E'\nsecurity_definer: ' || p.prosecdef::text
      || E'\nproconfig: ' || coalesce(p.proconfig::text, '<NULL>')
      || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(p.proacl) AS a),
                               '<NULL = drepturile implicite, inclusiv EXECUTE pentru PUBLIC>')
      || E'\nlimbaj: ' || l.lanname || ', volatil: ' || p.provolatile::text || ', strict: ' || p.proisstrict::text
      || ', leakproof: ' || p.proleakproof::text || ', paralel: ' || p.proparallel::text
      || E'\nsupraincarcari cu acelasi nume: ' || (SELECT count(*) FROM pg_catalog.pg_proc q
                                                     WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname)::text
      || E'\ndefinitia (pg_get_functiondef, fara CR):\n' || replace(pg_get_functiondef(p.oid), chr(13), '') AS material
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(f.sig)::oid FROM fn_lista f UNION SELECT trg.tgfoid FROM trg)
), amprente(eticheta, material) AS (
  SELECT f.eticheta, coalesce(m.material, '<LIPSA: ' || f.sig || '>')
    FROM fn_lista f LEFT JOIN fn_mat m ON m.oid = to_regprocedure(f.sig)::oid
  UNION ALL
  SELECT 'trg:' || t.tgname,
         'definitia: ' || pg_get_triggerdef(t.oid)
      || E'\ntgtype: ' || t.tgtype::text || ', activ: ' || t.tgenabled::text || ', amanabil: ' || t.tgdeferrable::text
      || ', amanat_initial: ' || t.tginitdeferred::text || ', constrangere: ' || (t.tgconstraint <> 0)::text
      || E'\nWHEN: ' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), '<NULL = fara conditie>')
      || E'\nUPDATE OF: ' || coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                                         FROM unnest(t.tgattr::int2[]) WITH ORDINALITY AS k(attnum, ord)
                                         JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.attnum),
                                      '<toate coloanele>')
      || E'\nargumente: ' || t.tgnargs::text || ' ' || encode(t.tgargs, 'hex')
      || E'\ntabele de tranzitie: ' || coalesce(t.tgoldtable::text, '<NULL>') || ' / ' || coalesce(t.tgnewtable::text, '<NULL>')
      || E'\n--- functia triggerului ---\n' || coalesce(m.material, '<LIPSA>')
    FROM trg t LEFT JOIN fn_mat m ON m.oid = t.tgfoid
  UNION ALL
  SELECT 'pol:' || pol.polname,
         'comanda: ' || pol.polcmd::text || ', permisiva: ' || pol.polpermissive::text
      || E'\nroluri: ' || coalesce((SELECT string_agg(r.nume, ',' ORDER BY r.nume COLLATE "C")
                                      FROM (SELECT CASE WHEN x.rol = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.rol)::text END AS nume
                                              FROM unnest(pol.polroles) AS x(rol)) AS r), '<NULL>')
      || E'\nUSING: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '<NULL = true>')
      || E'\nWITH CHECK: ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
    FROM pg_catalog.pg_policy pol JOIN tabel ON pol.polrelid = tabel.oid
  UNION ALL
  SELECT 'tabel:public.ofertare_licitatii',
         coalesce((SELECT 'proprietar: ' || pg_get_userbyid(tb.relowner)
                       || E'\nrls: ' || tb.relrowsecurity::text
                       || E'\nforce_rls: ' || tb.relforcerowsecurity::text
                       || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(tb.relacl) AS a),
                                                 '<NULL = drepturile implicite ale proprietarului>')
                       || E'\nacl pe coloane: ' || coalesce((SELECT string_agg(at.attname::text || '=' || (SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                                                                                          FROM unnest(at.attacl) AS a),
                                                                               '; ' ORDER BY at.attname::text COLLATE "C")
                                                            FROM pg_catalog.pg_attribute at
                                                           WHERE at.attrelid = tb.oid AND at.attacl IS NOT NULL AND NOT at.attisdropped),
                                                          '<niciunul>')
                    FROM tabel tb), '<LIPSA: public.ofertare_licitatii>')
  UNION ALL
  SELECT 'coloane:' || c.tabel,
         string_agg(c.col || ': ' || coalesce((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                                                 FROM pg_catalog.pg_attribute a
                                                WHERE a.attrelid = to_regclass(c.tabel) AND a.attname = c.col AND NOT a.attisdropped),
                                              '<LIPSA>'),
                    E'\n' ORDER BY c.col COLLATE "C")
    FROM (VALUES ('public.ofertare_licitatii', 'id'), ('public.ofertare_licitatii', 'status'),
                 ('public.ofertare_licitatii', 'termen_depunere'), ('public.ofertare_licitatii', 'responsabil_id'),
                 ('public.ofertare_licitatii', 'responsabil2_id'), ('public.ofertare_licitatii', 'responsabil_setat_de'),
                 ('public.ofertare_licitatii', 'responsabil2_setat_de'), ('public.ofertare_licitatii', 'responsabil_numitor_autorizat'),
                 ('public.ofertare_licitatii', 'responsabil2_numitor_autorizat'),
                 ('public.profiles', 'id'), ('public.profiles', 'is_owner')) AS c(tabel, col)
   GROUP BY c.tabel
)
SELECT eticheta, md5(material) AS amprenta, material FROM amprente ORDER BY eticheta COLLATE "C"
-- <<< AMPRENTE: interogarea
$amprente$;

DO $pre$
DECLARE
  v_asteptat jsonb := pg_temp.fn_20261132a_asteptat();
  v_calc jsonb;
  v_dif text;
BEGIN
  IF position('__DE_COMPLETAT__' IN v_asteptat::text) > 0 THEN
    RAISE EXCEPTION '20261132a: amprentele baseline nu sunt completate (pasii 1-5 din antet: scripts/ofertare_inchidere_garda_amprente.sql)';
  END IF;
  SELECT coalesce(jsonb_object_agg(a.eticheta, a.amprenta), '{}'::jsonb) INTO v_calc FROM pg_temp.fn_20261132a_amprente() AS a;
  IF v_calc IS DISTINCT FROM v_asteptat THEN
    SELECT string_agg(coalesce(c.key, a.key) || ' (' || CASE WHEN c.key IS NULL THEN 'lipseste pe tinta' WHEN a.key IS NULL THEN 'nou pe tinta'
                                                           ELSE 'difera' END || ')', '; ' ORDER BY coalesce(c.key, a.key) COLLATE "C")
      INTO v_dif
      FROM jsonb_each_text(v_calc) AS c FULL JOIN jsonb_each_text(v_asteptat) AS a ON a.key = c.key
     WHERE c.value IS DISTINCT FROM a.value;
    RAISE EXCEPTION '20261132a: amprentele schemei difera de baseline-ul revizuit: %', coalesce(v_dif, '?');
  END IF;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NOT NULL THEN
    RAISE EXCEPTION '20261132a: fn_ofertare_inchidere_garda exista deja';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda') THEN
    RAISE EXCEPTION '20261132a: trigger-ul exista deja';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_ofertare_inchidere_garda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.status IS DISTINCT FROM 'abandonata' OR OLD.status IS NOT DISTINCT FROM 'abandonata' THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    -- administrare SQL fără utilizator (psql / runner / pg_cron ca postgres); orice altă sesiune fără identitate e refuzată (L08)
    IF session_user = 'postgres' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Închiderea licitației cere un utilizator autentificat.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE((SELECT p.is_owner FROM public.profiles p WHERE p.id = v_uid), false) THEN
    RETURN NEW;
  END IF;
  -- doar OLD: termenul și responsabilii de DINAINTEA acestui UPDATE (fn_ofertare_poate_cheltui citește rândul încă nemodificat)
  IF OLD.status IN ('go', 'in_lucru')
     AND OLD.termen_depunere IS NOT NULL AND OLD.termen_depunere <= now()
     AND public.fn_ofertare_poate_cheltui(OLD.id, v_uid) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Închiderea licitației o face ownerul; după termenul de depunere, la licitațiile cu GO, și responsabilul numit de owner.'
    USING ERRCODE = '42501';
END
$fn$;
COMMENT ON FUNCTION public.fn_ofertare_inchidere_garda() IS
  'Garda trecerii în abandonata (20261132a, audit Ofertare 08.11.2026): owner oricând; responsabil numit (fn_ofertare_poate_cheltui) doar din go/in_lucru după termen; SQL admin fără utilizator.';
REVOKE ALL ON FUNCTION public.fn_ofertare_inchidere_garda() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a02_ofertare_licitatii_inchidere_garda
  BEFORE UPDATE OF status ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_inchidere_garda();

DO $post$
DECLARE
  -- md5(corpul $fn$ de mai sus, fără CR); aceeași valoare în revenire (testul vitest o recalculează din acest fișier)
  c_corp_md5 CONSTANT text := '6caa19f256fba618e9b8c29cfe868104';
  v_calc jsonb;
  v_dif text;
  f record; t record;
BEGIN
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, l.lanname, p.prorettype, p.pronargs, p.provolatile,
         md5(replace(p.prosrc, chr(13), '')) AS corp,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                  WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_exec
    INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_ofertare_inchidere_garda()'::regprocedure;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR f.owner <> 'postgres' OR f.lanname <> 'plpgsql'
     OR f.prorettype <> 'trigger'::regtype OR f.pronargs <> 0 OR f.provolatile <> 'v' OR f.corp IS DISTINCT FROM c_corp_md5
     OR f.auth_exec OR f.anon_exec OR f.public_exec THEN
    RAISE EXCEPTION '20261132a: postconditie functie (corp/definer/search_path/owner/ACL)';
  END IF;
  SELECT tgenabled, tgfoid, tgtype, tgqual IS NULL AS fara_when, tgnargs, tgdeferrable, tgconstraint, tgoldtable, tgnewtable,
         (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(tgattr::int2[]) AS k(attnum)
            JOIN pg_attribute a ON a.attrelid = tgrelid AND a.attnum = k.attnum) AS coloane
    INTO t FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda';
  IF t.tgenabled IS DISTINCT FROM 'O' OR t.tgfoid IS DISTINCT FROM 'public.fn_ofertare_inchidere_garda()'::regprocedure
     OR t.tgtype IS DISTINCT FROM 19::int2 OR NOT t.fara_when OR t.tgnargs <> 0 OR t.tgdeferrable OR t.tgconstraint <> 0
     OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL OR t.coloane IS DISTINCT FROM ARRAY['status'] THEN
    RAISE EXCEPTION '20261132a: postconditie trigger';
  END IF;
  -- amprentele din nou, după creare: baseline-ul neschimbat (o schimbare comisă între timp de altă sesiune = refuz) + exact trigger-ul nou
  SELECT coalesce(jsonb_object_agg(a.eticheta, a.amprenta), '{}'::jsonb) INTO v_calc FROM pg_temp.fn_20261132a_amprente() AS a;
  IF NOT (v_calc ? 'trg:a02_ofertare_licitatii_inchidere_garda') THEN
    RAISE EXCEPTION '20261132a: postconditie amprente (lipseste trigger-ul nou)';
  END IF;
  IF (v_calc - 'trg:a02_ofertare_licitatii_inchidere_garda') IS DISTINCT FROM pg_temp.fn_20261132a_asteptat() THEN
    SELECT string_agg(coalesce(c.key, a.key), '; ' ORDER BY coalesce(c.key, a.key) COLLATE "C") INTO v_dif
      FROM jsonb_each_text(v_calc - 'trg:a02_ofertare_licitatii_inchidere_garda') AS c
      FULL JOIN jsonb_each_text(pg_temp.fn_20261132a_asteptat()) AS a ON a.key = c.key
     WHERE c.value IS DISTINCT FROM a.value;
    RAISE EXCEPTION '20261132a: postconditie amprente (schema s-a schimbat in timpul migrarii): %', coalesce(v_dif, '?');
  END IF;
END $post$;

-- funcțiile temporare ale amprentelor nu rămân (sunt în pg_temp, dar se șterg explicit înaintea gărzii finale)
DROP FUNCTION pg_temp.fn_20261132a_amprente();
DROP FUNCTION pg_temp.fn_20261132a_asteptat();

DO $livrare_final$
BEGIN
  -- Garda de livrare (final, după postcondiții): marcajul e pus de scripts/livrare_migrare.sh ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261132a_ofertare_inchidere_garda:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261132a: garda de livrare (final, după postcondiții) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_final$;
