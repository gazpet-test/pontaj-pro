-- ════════════════════════════════════════════════════════════════════════════
-- 20261003b — ROLLBACK TEHNIC: REDESCHIDE bypass-ul (2)+(3) pe Ofertare
-- ARTEFACT FĂRĂ GO DE EXECUȚIE (verdictul Copilot din 30.09). NU e migrare: stă în
-- supabase/revenire/ și nu îl parcurge niciun runner (supabase/revenire/README.md).
-- O eventuală folosire cere cererea explicită a lui Răzvan PLUS o decizie și un review specifice
-- (Copilot). Existența comutatorului de armare NU e autorizare.
-- ════════════════════════════════════════════════════════════════════════════
-- Readuce EXACT starea live din 29.09.2026 pentru fn_ofertare_alege_acoperire(bigint) și
-- ofertare_inventar_pereche(bigint,text,integer,real): corpurile (md5(prosrc)), atributele și
-- ACL-ul, verificate înainte de COMMIT. Asta REDESCHIDE constatările (2) și (3) din incidentul
-- de expunere OPEN:
--   • orice cont logat, fără modulul Ofertare, schimbă dovada aleasă pe orice cerință;
--   • orice cont logat rulează împerecherea cu p_prag=0 (golurile dispar), iar
--     „respins_de_om” se rescrie la fiecare „Compară cu registrul”.
-- Dacă patch-ul strică un flux legitim, calea NU e asta, ci oprirea controlată
-- (20261003b_sec_ofertare_porti_alege_inventar_OPRIRE_CONTROLATA.sql): păstrează corpurile
-- patch-ului și retrage EXECUTE — funcționalitatea se oprește, nu se redeschide.
--
-- GESTIONARUL TRANZACȚIEI E RUNNER-UL (operatorul): fișierul NU conține BEGIN/COMMIT.
-- Execuția documentată e UN SINGUR string, trimis ca un singur query (ex. execute_sql):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261003b', 'REDESCHIDE_BYPASS:' || txid_current(), true);
--   <acest fișier, întreg>
--   COMMIT;
-- Armarea e legată de TRANZACȚIA CURENTĂ: fișierul cere exact 'REDESCHIDE_BYPASS:' || txid_current().
-- O armare rămasă în sesiune — SET de sesiune dat înaintea tranzacției, set_config(…, false),
-- armare dintr-o tranzacție eșuată, conexiune refolosită de pooler — poartă alt txid (sau niciunul)
-- și e refuzată în tranzacția următoare.
-- Tot fișierul e UN SINGUR bloc DO: orice refuz sau eroare îl anulează întreg, oricum ar fi rulat.
-- Refuză (42501, nimic schimbat):
--   • armare PERSISTENTĂ (ALTER DATABASE / ALTER ROLE … SET gazpet.rollback_tehnic_20261003b,
--     orice scriere a numelui, în pg_db_role_setting);
--   • armare lipsă, greșită sau din altă tranzacție;
--   • stare de pornire care nu e o stare COMPLETĂ cunoscută: patch | oprire controlată | live
--     (reluare fără efect). O stare mixtă sau o versiune ulterioară nu se suprascrie.
-- Postcondiție înainte de COMMIT: starea rezultată = EXACT live 29.09 (inclusiv privilegiile efective,
-- runda 4), altfel RAISE (se anulează tot). Mesajul final nu e dovadă de COMMIT.
-- La final dezarmează comutatorul (și varianta de sesiune).
-- ════════════════════════════════════════════════════════════════════════════
DO $rollback_tehnic$
DECLARE
  v_q CONSTANT text := $stari$
WITH fn(ord, fn, nume, sig) AS (VALUES
  (1, 'acces',   'fn_are_acces_ofertare',       'public.fn_are_acces_ofertare()'),
  (2, 'alege',   'fn_ofertare_alege_acoperire', 'public.fn_ofertare_alege_acoperire(bigint)'),
  (3, 'pereche', 'ofertare_inventar_pereche',   'public.ofertare_inventar_pereche(bigint,text,integer,real)')
), fixe(fn, atribute) AS (VALUES
  -- atribute identice în toate stările: proprietar, SECURITY DEFINER, limbaj, volatilitate,
  -- STRICT/LEAKPROOF/PARALLEL/COST/ROWS, n = câte funcții cu numele ăsta există în public
  -- (fără supraîncărcări), semnătura cu nume și DEFAULT-uri, tipul întors
  ('acces',   'secdef=t lang=sql vol=s strict=f leakproof=f parallel=u cost=100 rows=0 owner=postgres n=1 args=() rez=boolean'),
  ('alege',   'secdef=t lang=plpgsql vol=v strict=f leakproof=f parallel=u cost=100 rows=1000 owner=postgres n=1 args=(p_acoperire_id bigint) rez=TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)'),
  ('pereche', 'secdef=t lang=plpgsql vol=v strict=f leakproof=f parallel=u cost=100 rows=1000 owner=postgres n=1 args=(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45) rez=TABLE(imperecheate integer, ramase_fara_pereche integer)')
), cunoscut(stare, fn, md5_prosrc, config, acl, efectiv) AS (VALUES
  -- STĂRI COMPLETE: o stare e recunoscută doar dacă TOATE trei funcțiile au rândul ei.
  -- md5(prosrc) = md5 al textului literal al corpului; ACL sortat (COLLATE "C").
  -- efectiv (runda 4) = privilegiile EFECTIVE (has_function_privilege, cu moștenirea prin roluri) pentru
  -- anon, PUBLIC, authenticated, service_role: același proacl cu altă apartenență la roluri = stare necunoscută.
  ('live',   'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('live',   'alege',   '56a7c6ddd1e342c77e7b34f4e08ecab1', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('live',   'pereche', 'edd4819c81844baafc7eeade838cbcff', '{"search_path=public, extensions, pg_temp"}', '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('patch',  'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('oprire', 'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}', 'anon=f public=f authenticated=t service_role=t'),
  ('oprire', 'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}', 'anon=f public=f authenticated=f service_role=f'),
  ('oprire', 'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}', 'anon=f public=f authenticated=f service_role=f')
), observat AS (
  SELECT fn.ord, fn.fn, md5(p.prosrc) AS md5_prosrc, p.proconfig::text AS config,
         (SELECT array_agg(a::text ORDER BY a::text COLLATE "C")
            FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a)::text AS acl,
         format('secdef=%s lang=%s vol=%s strict=%s leakproof=%s parallel=%s cost=%s rows=%s owner=%s n=%s args=(%s) rez=%s',
                p.prosecdef, l.lanname, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel, p.procost, p.prorows,
                pg_get_userbyid(p.proowner),
                (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = fn.nume),
                pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS atribute,
         format('anon=%s public=%s authenticated=%s service_role=%s',
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('public', p.oid, 'EXECUTE'),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE')) AS efectiv
    FROM fn
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(fn.sig)
    LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), potrivit AS (
  SELECT o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute, o.efectiv,
         array_agg(c.stare ORDER BY c.stare) FILTER (WHERE c.stare IS NOT NULL) AS stari
    FROM observat o
    JOIN fixe f ON f.fn = o.fn
    LEFT JOIN cunoscut c ON c.fn = o.fn AND c.md5_prosrc = o.md5_prosrc AND c.config IS NOT DISTINCT FROM o.config
                        AND c.acl = o.acl AND f.atribute = o.atribute AND c.efectiv = o.efectiv
   GROUP BY o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute, o.efectiv
)
SELECT (SELECT s.stare FROM (SELECT unnest(p.stari) AS stare FROM potrivit p) s
         GROUP BY s.stare HAVING count(*) = 3) AS stare,
       string_agg(format('%s=%s', p.fn, coalesce(array_to_string(p.stari, '/'), 'NECUNOSCUTĂ')), ', ' ORDER BY p.ord) AS rezumat,
       string_agg(format('%s: md5(prosrc)=%s config=%s acl=%s efectiv=[%s] %s', p.fn, p.md5_prosrc, p.config, p.acl, p.efectiv, p.atribute),
                  E'\n' ORDER BY p.ord) AS detaliu
  FROM potrivit p
$stari$;
  v_stare text; v_rezumat text; v_detaliu text; v_pornire text;
BEGIN
  -- 1. Armare persistentă = refuz. Numele GUC-urilor nu țin cont de majuscule, deci nici căutarea.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.rollback_tehnic_20261003b') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003b blocat: comutatorul e armat PERSISTENT (ALTER DATABASE/ROLE … SET gazpet.rollback_tehnic_20261003b, în pg_db_role_setting). Șterge întâi setarea cu ALTER DATABASE/ROLE … RESET; armarea se face doar în tranzacția rollback-ului.'
      USING ERRCODE = '42501';
  END IF;
  -- 2. Armare legată de tranzacția curentă (txid): nimic rămas din altă tranzacție nu trece.
  IF current_setting('gazpet.rollback_tehnic_20261003b', true) IS DISTINCT FROM ('REDESCHIDE_BYPASS:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003b blocat: nearmat în tranzacția curentă (redeschide bypass-ul pe Ofertare). Artefact fără GO de execuție; doar la cererea explicită a lui Răzvan, după decizie și review specifice, în același string: BEGIN; SELECT set_config(''gazpet.rollback_tehnic_20261003b'', ''REDESCHIDE_BYPASS:'' || txid_current(), true); <fișierul>; COMMIT;'
      USING ERRCODE = '42501';
  END IF;
  -- 3. Precondiție: pornim doar dintr-o STARE COMPLETĂ cunoscută.
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF coalesce(v_stare, '') NOT IN ('patch', 'oprire', 'live') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003b blocat: starea curentă nu e o stare completă cunoscută (%). Se pornește doar din patch, oprire controlată sau live (reluare fără efect). Cineva a lucrat pe funcții între timp: compară înainte de orice rollback.', v_rezumat
      USING ERRCODE = '42501', DETAIL = v_detaliu;
  END IF;
  v_pornire := v_stare;


  -- Starea live din 29.09.2026, copiată cu pg_get_functiondef (byte cu byte).
  EXECUTE $def_alege$CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
 RETURNS TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cerinta bigint;
  v_pozitie bigint;
  v_vechi   bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să alegi o variantă de acoperire.';
  END IF;
  SELECT a.cerinta_id, a.pozitie_id INTO v_cerinta, v_pozitie
  FROM ofertare_acoperire a WHERE a.id = p_acoperire_id;
  IF v_cerinta IS NULL THEN
    RAISE EXCEPTION 'Varianta % nu există.', p_acoperire_id;
  END IF;
  SELECT a.id INTO v_vechi
  FROM ofertare_acoperire a
  WHERE a.cerinta_id = v_cerinta AND a.ales
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = false, ales_de = NULL, updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.ales AND a.id <> p_acoperire_id;
  UPDATE ofertare_acoperire a
  SET ales = true, ales_de = auth.uid(), updated_at = now()
  WHERE a.id = p_acoperire_id;
  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$
$def_alege$;

  EXECUTE $def_pereche$CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_furnizor text; v_versiune int;
BEGIN
  -- implicit: cea mai recenta rulare a furnizorului cerut (sau a oricaruia) pe licitatia asta
  SELECT i.furnizor, i.versiune INTO v_furnizor, v_versiune
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic
    AND (p_furnizor IS NULL OR i.furnizor = p_furnizor)
    AND (p_versiune IS NULL OR i.versiune = p_versiune)
  ORDER BY i.versiune DESC, i.id DESC LIMIT 1;
  IF v_furnizor IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;

  WITH inv AS (
    SELECT i.id, left(coalesce(i.obligatie, i.pasaj, ''), 2000) AS t
    FROM ofertare_inventar_ai i
    WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune
  ), cer AS (
    SELECT c.id, left(c.text_cerinta, 2000) AS t
    FROM ofertare_cerinte c
    WHERE c.licitatie_id = p_lic AND c.inlocuita_de IS NULL
  ), best AS (
    SELECT inv.id AS inv_id,
           (SELECT cer.id FROM cer
             WHERE similarity(cer.t, inv.t) >= p_prag
             ORDER BY similarity(cer.t, inv.t) DESC, cer.id LIMIT 1) AS cer_id
    FROM inv WHERE length(inv.t) > 0
  )
  UPDATE ofertare_inventar_ai i
     SET pereche_cerinta_id = b.cer_id,
         verdict = CASE WHEN b.cer_id IS NOT NULL THEN 'acoperit' ELSE 'lipsa_din_registru' END
    FROM best b
   WHERE i.id = b.inv_id
     AND i.verdict IS DISTINCT FROM 'confirmat_de_om';  -- ce a decis omul nu se rescrie

  RETURN QUERY
  SELECT count(*) FILTER (WHERE i.pereche_cerinta_id IS NOT NULL)::int,
         count(*) FILTER (WHERE i.pereche_cerinta_id IS NULL)::int
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune;
END $function$
$def_pereche$;

  -- ACL-ul din 29.09 era deja fără PUBLIC/anon; nu-l lărgim nici la rollback.
  REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

  -- 4. Postcondiție, înainte de COMMIT: exact starea live din 29.09 (altfel se anulează tot).
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF v_stare IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'Postcondiție ROLLBACK TEHNIC 20261003b: starea rezultată nu e exact starea live din 29.09 (%). Nimic nu se comite.', v_rezumat
      USING DETAIL = v_detaliu;
  END IF;

  -- 5. Dezarmăm comutatorul (și o eventuală variantă de sesiune), apoi anunțăm.
  PERFORM set_config('gazpet.rollback_tehnic_20261003b', '', false);
  RAISE WARNING 'ROLLBACK TEHNIC 20261003b aplicat (pornit din starea „%”): bypass-ul (2)+(3) pe Ofertare e REDESCHIS.', v_pornire;
END $rollback_tehnic$;
