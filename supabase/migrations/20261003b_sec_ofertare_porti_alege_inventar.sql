-- ════════════════════════════════════════════════════════════════════════════
-- 20261003b — SECURITATE Ofertare: porți pe constatările (2) și (3) ale incidentului
-- de expunere din 29.09.2026 (docs/SECURITATE_ADVISORS_2026-09-30.md, §0 și §1).
--
--   (2) public.fn_ofertare_alege_acoperire(bigint)
--       Azi singura poartă e auth.uid() IS NOT NULL. Funcția e SECURITY DEFINER, deci
--       ocolește RLS: orice cont logat schimbă dovada aleasă pe orice cerință din orice
--       licitație. Patch: poarta fn_are_acces_ofertare() (aceeași ca RLS-ul de scriere).
--   (3) public.ofertare_inventar_pereche(bigint,text,integer,real)
--       Azi nu are nicio poartă, iar p_prag îl alege apelantul (cu 0 totul iese „acoperit”,
--       golurile dispar). În plus, UPDATE-ul rescrie „respins_de_om” chiar în folosire
--       normală. Patch: poarta fn_are_acces_ofertare() + prag limitat la [0.45, 0.95]
--       (podeaua = implicitul din UI) + verdictele omului (vocabularul confirmat_de_om /
--       respins_de_om) nu se mai ating.
--
-- Runda 2 (30.09): podeaua 0.45; protecția verdictelor doar pe vocabularul uman.
-- Runda 3 (30.09, răspuns la NO-GO Copilot pe 94909d6):
--   • poarta e NULL-safe: IF fn_are_acces_ofertare() IS NOT TRUE (NULL = refuz, nu trecere);
--   • amprente independente de versiunea PG: md5(prosrc) = md5 al textului literal al corpului,
--     așa cum e scris în acest fișier (identic în PG16 și PG17), plus atributele verificate explicit:
--     SECURITY DEFINER, proconfig exact, proprietar, limbaj, volatilitate, STRICT/LEAKPROOF/
--     PARALLEL/COST/ROWS, semnătura (nume, tipuri, DEFAULT-uri, fără supraîncărcări), tipul
--     întors și ACL-ul (sortat);
--   • precondiția acceptă doar STĂRI COMPLETE (helper + alege + pereche, fiecare cu atributele
--     lui): live 29.09 | patch | oprire controlată (ultimele două: bază unde funcțiile au ajuns deja
--     acolo fără înregistrare; runner-ul refuză oricum o migrare deja înregistrată). Stare mixtă = refuz;
--   • postcondiția, ÎNAINTE de COMMIT (ultimul pas al blocului): starea rezultată = exact starea
--     patch-ului, altfel RAISE și se anulează tot, inclusiv înregistrarea runner-ului;
--   • tabelul stărilor cunoscute (constanta v_q) e identic, octet cu octet, în toate fișierele
--     20261003b (harness-ul verifică). NICIO listă nu se actualizează automat după apply: o
--     amprentă nouă intră doar printr-un commit revizuit.
--
-- ⚠ NU SE APLICĂ fără: (a) excepția de securitate la freeze-ul Ofertare, acordată explicit
--   de Răzvan pe domeniul exact al acestui fișier; (b) GO Copilot pe revizie. Pașii (preview →
--   confirmare → apply → verificare) sunt în docs/SECURITATE_PATCH_OFERTARE.md §7.
-- ⚠ LIVRARE (runda 4, traseul comun cu #538): UN SINGUR gestionar de tranzacție = runner-ul
--   scripts/livrare_migrare.sh (psql --single-transaction): marcajul de livrare legat de txid +
--   acest fișier + INSERT-ul în supabase_migrations.schema_migrations, în aceeași tranzacție.
--   Fișierul NU conține BEGIN/COMMIT și are GARDĂ la început și la final (după postcondiții): cere
--   current_setting('gazpet.livrare_migrare') = '<numele migrării>:' || txid_current(). Fără runner
--   (psql -f simplu, execute_sql, apply_migration) refuză: nimic comis, nimic înregistrat.
--   Tot fișierul e UN SINGUR bloc DO. Se trimite întreg, cu LF (cu CRLF md5(prosrc) iese altfel și
--   postcondiția refuză).
--
-- Model de identitate (S-A): nicio ramură „auth.uid() IS NULL ⇒ sistem”. Fără uid = refuz
-- 42501, inclusiv pentru service_role și postgres. Apelanții legitimi (OfertareCerinte.jsx,
-- OfertareLicitatii.jsx) sunt utilizatori cu uid și cu modulul Ofertare (sau owner). Atenție:
-- ruta /ofertare lasă să intre și un sub-modul „ofertare.*”, poarta cere module = 'ofertare'
-- exact (ca RLS-ul de scriere); vezi docs §7, interogarea de preview pe sub-module.
--
-- Ce NU face: nu atinge tabele, politici, date, semnături. CREATE OR REPLACE păstrează
-- semnătura, tipul întors și ACL-ul; ACL-ul e reafirmat explicit mai jos (și refăcut, dacă
-- pornim din oprirea controlată).
-- Reveniri (NU sunt migrări; stau în supabase/revenire/, nu le parcurge niciun runner):
--   _OPRIRE_CONTROLATA.sql — păstrează corpurile patch-ului, retrage EXECUTE (funcționalitatea
--     se oprește, nu se redeschide); ieșirea din oprire = _REPORNIRE.sql (runner-ul comun nu reia o
--     migrare deja înregistrată);
--   _ROLLBACK.sql — TEHNIC, redeschide bypass-ul; artefact fără GO de execuție.
-- Test: scripts/test_sec_ofertare.sh (PG16 local) + supabase/tests/sec_ofertare_porti.test.sql
-- ════════════════════════════════════════════════════════════════════════════
DO $migrare_20261003b$
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
), cunoscut(stare, fn, md5_prosrc, config, acl) AS (VALUES
  -- STĂRI COMPLETE: o stare e recunoscută doar dacă TOATE trei funcțiile au rândul ei.
  -- md5(prosrc) = md5 al textului literal al corpului; ACL sortat (COLLATE "C").
  ('live',   'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('live',   'alege',   '56a7c6ddd1e342c77e7b34f4e08ecab1', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('live',   'pereche', 'edd4819c81844baafc7eeade838cbcff', '{"search_path=public, extensions, pg_temp"}', '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('patch',  'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('patch',  'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('patch',  'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('oprire', 'acces',   '429d28e2a61fb24c8009d67050c16c85', '{"search_path=public, pg_temp"}',            '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('oprire', 'alege',   '51865b69766f6baa53def9a6e6c6232b', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}'),
  ('oprire', 'pereche', '4d90bf90b4bbfd6aea944e734f6c9ed9', '{"search_path=public, pg_temp"}',            '{postgres=X/postgres}')
), observat AS (
  SELECT fn.ord, fn.fn, md5(p.prosrc) AS md5_prosrc, p.proconfig::text AS config,
         (SELECT array_agg(a::text ORDER BY a::text COLLATE "C")
            FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a)::text AS acl,
         format('secdef=%s lang=%s vol=%s strict=%s leakproof=%s parallel=%s cost=%s rows=%s owner=%s n=%s args=(%s) rez=%s',
                p.prosecdef, l.lanname, p.provolatile, p.proisstrict, p.proleakproof, p.proparallel, p.procost, p.prorows,
                pg_get_userbyid(p.proowner),
                (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = fn.nume),
                pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS atribute
    FROM fn
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(fn.sig)
    LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
), potrivit AS (
  SELECT o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute,
         array_agg(c.stare ORDER BY c.stare) FILTER (WHERE c.stare IS NOT NULL) AS stari
    FROM observat o
    JOIN fixe f ON f.fn = o.fn
    LEFT JOIN cunoscut c ON c.fn = o.fn AND c.md5_prosrc = o.md5_prosrc AND c.config IS NOT DISTINCT FROM o.config
                        AND c.acl = o.acl AND f.atribute = o.atribute
   GROUP BY o.ord, o.fn, o.md5_prosrc, o.config, o.acl, o.atribute
)
SELECT (SELECT s.stare FROM (SELECT unnest(p.stari) AS stare FROM potrivit p) s
         GROUP BY s.stare HAVING count(*) = 3) AS stare,
       string_agg(format('%s=%s', p.fn, coalesce(array_to_string(p.stari, '/'), 'NECUNOSCUTĂ')), ', ' ORDER BY p.ord) AS rezumat,
       string_agg(format('%s: md5(prosrc)=%s config=%s acl=%s %s', p.fn, p.md5_prosrc, p.config, p.acl, p.atribute),
                  E'\n' ORDER BY p.ord) AS detaliu
  FROM potrivit p
$stari$;
  v_stare text; v_rezumat text; v_detaliu text;
BEGIN
  -- Garda de livrare (start): marcajul e pus de scripts/livrare_migrare.sh ÎN ACEEAȘI tranzacție (legat de txid).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003b_sec_ofertare_porti_alege_inventar:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;

  -- ── 0. Precondiții: pornim doar dintr-o STARE COMPLETĂ cunoscută ───────────────
  -- live 29.09 (prima aplicare) | patch (reaplicare, fără efect) | oprire controlată (ieșirea din
  -- oprire: corpurile sunt deja ale patch-ului, se refac GRANT-urile). Orice altceva — o stare
  -- mixtă, o versiune ulterioară, alt proprietar, alt ACL, alt helper — e refuzat.
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF coalesce(v_stare, '') NOT IN ('live', 'patch', 'oprire') THEN
    RAISE EXCEPTION 'Precondiție 20261003b: starea curentă nu e o stare completă cunoscută (%). Se acceptă doar live 29.09, patch sau oprire controlată, pe toate trei funcțiile deodată. Cineva a lucrat pe funcții între timp: oprește-te și compară.', v_rezumat
      USING DETAIL = v_detaliu;
  END IF;
  RAISE NOTICE 'Precondiție 20261003b: pornim din starea completă „%”.', v_stare;
  IF to_regprocedure('extensions.similarity(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261003b: extensions.similarity(text,text) (pg_trgm) lipsește.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'ofertare_acoperire'   AND column_name IN ('ales', 'ales_de', 'pozitie_id'))
           OR (table_name = 'ofertare_inventar_ai' AND column_name IN ('verdict', 'verdict_de', 'pereche_cerinta_id')))) <> 6 THEN
    RAISE EXCEPTION 'Precondiție 20261003b: coloanele ales/ales_de/pozitie_id sau verdict/verdict_de/pereche_cerinta_id nu sunt cele auditate.';
  END IF;

  -- ── 1. (2) fn_ofertare_alege_acoperire: poarta de modul ──────────────────────────
  -- Corpul e cel live (varianta „doi pași” din 25.09); se adaugă doar poarta și urma în jurnal.
  EXECUTE $def_alege$CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
 RETURNS TABLE(cerinta_id bigint, pozitie_id bigint, ales_id bigint, inlocuit_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
-- SEC-20261003b (constatarea 2): poarta de modul Ofertare. Funcția e SECURITY DEFINER și ocolește
-- RLS-ul, deci aplică ea aceeași regulă ca politicile de scriere de pe ofertare_acoperire.
DECLARE
  v_uid      uuid := auth.uid();
  v_cerinta  bigint;
  v_pozitie  bigint;
  v_vechi    bigint;
  v_vechi_de uuid;
BEGIN
  -- Identitate explicită (S-A): fără uid nu există „sistem”, există doar refuz.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să alegi o variantă de acoperire.'
      USING ERRCODE = '42501';
  END IF;
  -- Poarta verifică înainte de orice citire: fără drept nu afli nici dacă varianta există.
  -- IS NOT TRUE, nu NOT: un răspuns NULL al helperului înseamnă refuz, nu trecere (runda 3).
  IF public.fn_are_acces_ofertare() IS NOT TRUE THEN
    RAISE EXCEPTION 'Nu ai acces la modulul Ofertare: nu poți schimba varianta de acoperire aleasă.'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.cerinta_id, a.pozitie_id INTO v_cerinta, v_pozitie
  FROM ofertare_acoperire a WHERE a.id = p_acoperire_id;
  IF v_cerinta IS NULL THEN
    RAISE EXCEPTION 'Varianta % nu există.', p_acoperire_id;
  END IF;

  SELECT a.id, a.ales_de INTO v_vechi, v_vechi_de
  FROM ofertare_acoperire a
  WHERE a.cerinta_id = v_cerinta AND a.ales
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.id <> p_acoperire_id;

  -- pasul 1: scoate varianta aleasă până acum din poziția asta
  UPDATE ofertare_acoperire a
  SET ales = false, ales_de = NULL, updated_at = now()
  WHERE a.cerinta_id = v_cerinta
    AND COALESCE(a.pozitie_id, 0) = COALESCE(v_pozitie, 0)
    AND a.ales AND a.id <> p_acoperire_id;

  -- pasul 2: pune noua variantă, semnată cu identitatea apelantului (proveniența: ales_de)
  UPDATE ofertare_acoperire a
  SET ales = true, ales_de = v_uid, updated_at = now()
  WHERE a.id = p_acoperire_id;

  -- Alegerea înlocuită (rând + cine o făcuse) nu are tabel de istoric. Fără schemă nouă,
  -- lăsăm o urmă în jurnalul Postgres. LIMITARE: e volatilă (retenția jurnalelor), nu istoric.
  RAISE LOG 'SEC-20261003b alege_acoperire: cerinta=% pozitie=% ales=% inlocuit=% inlocuit_ales_de=% de=%',
    v_cerinta, v_pozitie, p_acoperire_id, v_vechi, v_vechi_de, v_uid;

  RETURN QUERY SELECT v_cerinta, v_pozitie, p_acoperire_id, v_vechi;
END;
$function$
$def_alege$;

  -- ── 2. (3) ofertare_inventar_pereche: poartă + prag limitat + verdictele omului neatinse ──
  -- similarity() e calificat cu schema (extensions), deci search_path = public, pg_temp (pct. 4).
  EXECUTE $def_pereche$CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
-- SEC-20261003b (constatarea 3): poarta de modul Ofertare, pragul nu mai poate coborî sub cel
-- din UI, iar ce a decis omul nu se mai rescrie.
DECLARE
  v_uid       uuid := auth.uid();
  v_furnizor  text;
  v_versiune  int;
  v_prag      real;
  v_atinse    int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Trebuie să fii autentificat ca să compari inventarul cu registrul.'
      USING ERRCODE = '42501';
  END IF;
  -- IS NOT TRUE, nu NOT: un răspuns NULL al helperului înseamnă refuz, nu trecere (runda 3).
  IF public.fn_are_acces_ofertare() IS NOT TRUE THEN
    RAISE EXCEPTION 'Nu ai acces la modulul Ofertare: nu poți compara inventarul cu registrul.'
      USING ERRCODE = '42501';
  END IF;

  -- Prag limitat la [0.45, 0.95]; NULL → 0.45. Podeaua e chiar implicitul din UI: apelantul poate
  -- cere o potrivire mai strictă (mai multe goluri), niciodată una mai laxă. Sub 0.45 dispar goluri
  -- reale din același domeniu (ISO 45001 vs 9001 = 0.375, diriginte ISC vs RTE = 0.362, garanție
  -- de participare vs de bună execuție = 0.333). NaN/+∞ → 0.95, −∞ → 0.45.
  v_prag := greatest(0.45::real, least(coalesce(p_prag, 0.45::real), 0.95::real));

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
             WHERE extensions.similarity(cer.t, inv.t) >= v_prag
             ORDER BY extensions.similarity(cer.t, inv.t) DESC, cer.id LIMIT 1) AS cer_id
    FROM inv WHERE length(inv.t) > 0
  )
  UPDATE ofertare_inventar_ai i
     SET pereche_cerinta_id = b.cer_id,
         verdict = CASE WHEN b.cer_id IS NOT NULL THEN 'acoperit' ELSE 'lipsa_din_registru' END
    FROM best b
   WHERE i.id = b.inv_id
     -- ce a decis omul nu se rescrie: „✓ adăugată” (confirmat_de_om) și „✕ respinsă” (respins_de_om),
     -- exact vocabularul pe care UI-ul îl tratează ca decizie. verdict_de NU contează: un verdict de
     -- mașină cu verdict_de pus prin REST se recalculează, ca înainte (nu rămâne înghețat).
     AND COALESCE(i.verdict, '') NOT IN ('confirmat_de_om', 'respins_de_om');
  GET DIAGNOSTICS v_atinse = ROW_COUNT;

  RAISE LOG 'SEC-20261003b inventar_pereche: lic=% furnizor=% versiune=% prag_cerut=% prag_aplicat=% actualizate=% de=%',
    p_lic, v_furnizor, v_versiune, p_prag, v_prag, v_atinse, v_uid;

  RETURN QUERY
  SELECT count(*) FILTER (WHERE i.pereche_cerinta_id IS NOT NULL)::int,
         count(*) FILTER (WHERE i.pereche_cerinta_id IS NULL)::int
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune;
END $function$
$def_pereche$;

  -- ── 3. ACL explicit: fără PUBLIC/anon; EXECUTE pentru authenticated (UI) și service_role ──
  -- Din starea live/patch nu schimbă nimic; din oprirea controlată reface GRANT-urile retrase.
  REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

  -- ── 4. Postcondiție, ÎNAINTE de COMMIT: starea rezultată = EXACT starea patch-ului ────────
  -- (helper neatins; alege + pereche cu md5(prosrc) al corpurilor de mai sus, atributele și ACL-ul
  -- patch-ului). Orice abatere — alt text al corpului (CRLF, altă versiune PG care l-ar rescrie),
  -- alt ACL, alt proprietar — oprește tot: RAISE, iar tranzacția se anulează cu totul.
  EXECUTE v_q INTO v_stare, v_rezumat, v_detaliu;
  IF v_stare IS DISTINCT FROM 'patch' THEN
    RAISE EXCEPTION 'Postcondiție 20261003b: starea rezultată nu e exact starea patch-ului (%). Nimic nu se comite: tranzacția se anulează.', v_rezumat
      USING DETAIL = v_detaliu;
  END IF;

  -- Garda de livrare (final, după postcondiții): tot în tranzacția runner-ului, care înregistrează apoi migrarea.
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003b_sec_ofertare_porti_alege_inventar:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003b: garda de livrare (final, după postcondiții) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $migrare_20261003b$;
