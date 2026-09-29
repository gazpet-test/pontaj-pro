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
--       normală. Patch: poarta fn_are_acces_ofertare() + prag limitat la [0.30, 0.95]
--       + verdictele omului (confirmat_de_om, respins_de_om, orice rând cu verdict_de)
--       nu se mai ating.
--
-- ⚠ NU SE APLICĂ fără: (a) excepția de securitate la freeze-ul Ofertare, acordată explicit
--   de Răzvan pe domeniul exact al acestui fișier; (b) GO Copilot pe revizie. Pașii (preview →
--   confirmare → apply → verificare) sunt în docs/SECURITATE_PATCH_OFERTARE.md.
-- ⚠ Se aplică DOAR întreg, într-o singură tranzacție (apply_migration). Nu pe bucăți.
--
-- Model de identitate (S-A): nicio ramură „auth.uid() IS NULL ⇒ sistem”. Fără uid = refuz
-- 42501, inclusiv pentru service_role și postgres. Apelanții legitimi (OfertareCerinte.jsx,
-- OfertareLicitatii.jsx, ruta /ofertare cu requireModule:'ofertare') sunt toți utilizatori
-- cu uid și cu modulul Ofertare (sau owner).
--
-- Ce NU face: nu atinge tabele, politici, date, semnături. CREATE OR REPLACE păstrează
-- semnătura, tipul întors și ACL-ul; ACL-ul e reafirmat explicit mai jos.
-- Revenire: _REVENIRE_OPERATIONALA.sql (păstrează poarta) sau _ROLLBACK.sql (TEHNIC —
-- redeschide bypass-ul; doar la cererea explicită a lui Răzvan).
-- Test: scripts/test_sec_ofertare.sh (PG16 local) + supabase/tests/sec_ofertare_porti.test.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Precondiții: nu suprascriem o versiune pe care n-am auditat-o ─────────────
-- md5(pg_get_functiondef) citit read-only din live pe 29.09.2026 (PG 17.6). Se acceptă
-- starea auditată sau o stare care poartă deja markerul acestui patch (reaplicare).
DO $pre$
DECLARE
  v_acces   text := pg_get_functiondef('public.fn_are_acces_ofertare()'::regprocedure);
  v_alege   text := pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure);
  v_pereche text := pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure);
BEGIN
  IF md5(v_acces) <> '6991b618d5fabbefdbd14684d335db48' THEN
    RAISE EXCEPTION 'Precondiție 20261003b: fn_are_acces_ofertare() diferă de starea auditată (md5 %). Poarta se sprijină pe ea: recitește definiția live și reauditează înainte de apply.', md5(v_acces);
  END IF;
  IF md5(v_alege) <> '6c9995646a6dbe6da995e48a3a885fc9' AND position('SEC-20261003b' IN v_alege) = 0 THEN
    RAISE EXCEPTION 'Precondiție 20261003b: fn_ofertare_alege_acoperire s-a schimbat față de starea auditată (md5 %). Cineva a lucrat pe ea între timp: oprește-te și compară.', md5(v_alege);
  END IF;
  IF md5(v_pereche) <> '500263dacba2b44e0caa1cb07db88d6e' AND position('SEC-20261003b' IN v_pereche) = 0 THEN
    RAISE EXCEPTION 'Precondiție 20261003b: ofertare_inventar_pereche s-a schimbat față de starea auditată (md5 %). Cineva a lucrat pe ea între timp: oprește-te și compară.', md5(v_pereche);
  END IF;
  IF to_regprocedure('extensions.similarity(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261003b: extensions.similarity(text,text) (pg_trgm) lipsește.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'ofertare_acoperire'   AND column_name IN ('ales', 'ales_de', 'pozitie_id'))
           OR (table_name = 'ofertare_inventar_ai' AND column_name IN ('verdict', 'verdict_de', 'pereche_cerinta_id')))) <> 6 THEN
    RAISE EXCEPTION 'Precondiție 20261003b: coloanele ales/ales_de/pozitie_id sau verdict/verdict_de/pereche_cerinta_id nu sunt cele auditate.';
  END IF;
END $pre$;

-- ── 1. (2) fn_ofertare_alege_acoperire: poarta de modul ──────────────────────────
-- Corpul e cel live (varianta „doi pași” din 25.09); se adaugă doar poarta și urma în jurnal.
CREATE OR REPLACE FUNCTION public.fn_ofertare_alege_acoperire(p_acoperire_id bigint)
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
  IF NOT public.fn_are_acces_ofertare() THEN
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
$function$;

-- ── 2. (3) ofertare_inventar_pereche: poartă + prag limitat + verdictele omului neatinse ──
-- similarity() e calificat cu schema (extensions), deci search_path = public, pg_temp (pct. 4).
CREATE OR REPLACE FUNCTION public.ofertare_inventar_pereche(p_lic bigint, p_furnizor text DEFAULT NULL::text, p_versiune integer DEFAULT NULL::integer, p_prag real DEFAULT 0.45)
 RETURNS TABLE(imperecheate integer, ramase_fara_pereche integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
-- SEC-20261003b (constatarea 3): poarta de modul Ofertare, pragul nu mai e la alegerea
-- apelantului, iar ce a decis omul nu se mai rescrie.
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
  IF NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Nu ai acces la modulul Ofertare: nu poți compara inventarul cu registrul.'
      USING ERRCODE = '42501';
  END IF;

  -- Prag limitat la [0.30, 0.95]; NULL → 0.45, ca implicitul pe care îl folosește UI-ul.
  -- Cu 0 (sau negativ) totul ar ieși „acoperit”; peste 1 nimic. NaN/+∞ → 0.95, −∞ → 0.30.
  v_prag := greatest(0.30::real, least(coalesce(p_prag, 0.45::real), 0.95::real));

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
     -- ce a decis omul nu se rescrie: nici „✓ adăugată” (confirmat_de_om), nici „✕ respinsă”
     -- (respins_de_om), nici orice rând pe care un om și-a pus semnătura (verdict_de).
     AND COALESCE(i.verdict, '') NOT IN ('confirmat_de_om', 'respins_de_om')
     AND i.verdict_de IS NULL;
  GET DIAGNOSTICS v_atinse = ROW_COUNT;

  RAISE LOG 'SEC-20261003b inventar_pereche: lic=% furnizor=% versiune=% prag_cerut=% prag_aplicat=% actualizate=% de=%',
    p_lic, v_furnizor, v_versiune, p_prag, v_prag, v_atinse, v_uid;

  RETURN QUERY
  SELECT count(*) FILTER (WHERE i.pereche_cerinta_id IS NOT NULL)::int,
         count(*) FILTER (WHERE i.pereche_cerinta_id IS NULL)::int
  FROM ofertare_inventar_ai i
  WHERE i.licitatie_id = p_lic AND i.furnizor = v_furnizor AND i.versiune = v_versiune;
END $function$;

-- ── 3. ACL explicit (azi e deja așa; îl reafirmăm ca să nu depindem de default privileges) ──
REVOKE ALL ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_alege_acoperire(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_inventar_pereche(bigint, text, integer, real) TO authenticated, service_role;

-- ── 4. Postcondiții: dacă ceva nu iese cum trebuie, se anulează toată tranzacția ──────
DO $post$
DECLARE
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_alege_acoperire(bigint)'::regprocedure,
                           'public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure] LOOP
    IF has_function_privilege('public', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondiție 20261003b: % e executabilă de PUBLIC/anon.', f;
    END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondiție 20261003b: authenticated a pierdut EXECUTE pe % (UI-ul s-ar rupe).', f;
    END IF;
    IF NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
              FROM pg_proc p WHERE p.oid = f) THEN
      RAISE EXCEPTION 'Postcondiție 20261003b: % nu e SECURITY DEFINER cu search_path = public, pg_temp.', f;
    END IF;
    IF position('fn_are_acces_ofertare()' IN pg_get_functiondef(f)) = 0
       OR position('SEC-20261003b' IN pg_get_functiondef(f)) = 0 THEN
      RAISE EXCEPTION 'Postcondiție 20261003b: % nu conține poarta/markerul patch-ului.', f;
    END IF;
  END LOOP;
END $post$;
