-- 20261131g_redari_stare_cost_rls.sql — Dashboard / Registru Redări lente ca utilizator logat (PR #1022, cauza găsită după DRY 1).
-- NUMAI fișier; se aplică DOAR prin scripts/livrare_migrare.sh (psql --single-transaction + marcajul gazpet.livrare_migrare),
-- după DRY cu ROLLBACK și „da”-ul lui Răzvan. Fără BEGIN / COMMIT: tranzacția o face runner-ul.
-- DRY (o tranzacție, ROLLBACK la final): scripts/redari_1022b_dry_inainte.sql → această migrare → scripts/redari_1022b_dry.sql.
-- Independentă de 20261131f: nu atinge red_v_centralizator_uat; se poate aplica înainte sau după ea.
-- Cauza (DRY 1, 09.11.2026): ca postgres ~1,2 s, ca utilizator logat ~34 s pe LOT1. Diferența vine din două funcții chemate PE RÂND
--   în red_v_stare_parcela (20261131d) și red_v_tronson (20261130n): fn_red_parcela_acoperita_a (SECURITY INVOKER: politicile tabelelor
--   ei se evaluează din nou la fiecare apel, cu fn_red_nivel() de fiecare dată) și fn_red_adresa_cunoscuta (cu utilizator logat
--   cheamă fn_red_nivel() la fiecare apel). Ca postgres, fără utilizator, niciuna nu ajunge la fn_red_nivel().
-- Ce face (NU schimbă drepturi, politici sau funcții existente; aceleași coloane, același owner / ACL / security_invoker):
--   (1) în red_v_stare_parcela și red_v_tronson, corpul fn_red_parcela_acoperita_a(p.id) din 20261130n e copiat în vedere. Aceleași
--       tabele, același apelant (vederile sunt security_invoker, funcția e INVOKER), același snapshot (funcția e STABLE) ⇒ același
--       rezultat; politicile se evaluează o dată pe interogare. Copia e verificată față de funcție în DRY (L19), iar poarta de mai jos
--       cere corpul exact al funcției (md5): o schimbare a regulii de acoperire se face de acum în funcție ȘI în cele două vederi.
--   (2) ramura FARA_ADRESA_AFISARE: fără utilizator (auth.uid() NULL — căile server) rămâne fn_red_adresa_cunoscuta, exact ca înainte;
--       cu utilizator, fn_red_detinatori_cu_adresa() (nouă, DEFINER, fără parametri) aplică aceeași poartă ca fn_red_adresa_cunoscuta
--       (auth.uid() + fn_red_nivel()) o singură dată pe apel și întoarce deținătorii cu adresă cunoscută; fără drept Redări — nimic.
-- Porți (L15): ÎNAINTE exact definițiile 31d ale celor două vederi, owner / opțiuni / ACL, fără ACL pe coloane, amprenta funcțiilor pe
--   care se sprijină echivalența (fn_red_parcela_acoperita_a, fn_red_adresa_cunoscuta, fn_red_nivel, auth.uid); DUPĂ exact definițiile
--   noi, aceleași coloane / owner / ACL, funcția nouă cu amprenta și ACL-ul așteptate, red_v_centralizator_uat neschimbată.
-- Lock-uri (L01, L06): înaintea verificărilor, în ordinea din 31d (tabelele, apoi vederile), SHARE ROW EXCLUSIVE (oprește scrierile și
--   DDL-ul concurent, nu și citirile), lock_timeout 5 s; CREATE OR REPLACE VIEW ia apoi ACCESS EXCLUSIVE doar pe cele două vederi.
-- ORDINEA REVENIRILOR: dacă se revine 20261131d, întâi revenirea ACESTEI migrări (31g) și a lui 31f, apoi 31d.
-- Revenire: supabase/revenire/20261131g_redari_stare_cost_rls_ROLLBACK.sql.
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261131g_redari_stare_cost_rls:' || txid_current() THEN RAISE EXCEPTION '20261131g: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131g: armare persistenta refuzata'; END IF;
  IF to_regclass('public.red_v_stare_parcela') IS NULL OR to_regclass('public.red_v_tronson') IS NULL
     OR to_regclass('public.red_v_centralizator_uat') IS NULL THEN RAISE EXCEPTION '20261131g: lipsesc vederile'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') THEN
    RAISE EXCEPTION '20261131g: fn_red_detinatori_cu_adresa exista deja (a doua aplicare?)'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  LOCK TABLE public.red_procese_verbale, public.red_parcele, public.red_detinatori, public.red_uat, public.red_detinatori_contact,
    public.red_raspunsuri, public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_v_stare_parcela, public.red_v_centralizator_uat, public.red_v_tronson IN SHARE ROW EXCLUSIVE MODE;
END $start$;
DROP VIEW IF EXISTS pg_temp.g31_stare_31d, pg_temp.g31_tronson_31d, pg_temp.g31_stare_31g, pg_temp.g31_tronson_31g;
DROP TABLE IF EXISTS pg_temp.g31_meta;

-- definițiile de plecare, exact ca în 20261131d (red_v_stare_parcela) și 20261130n (red_v_tronson, verificată și de 31d)
CREATE TEMP VIEW g31_stare_31d AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE WHEN a.stare IS DISTINCT FROM 'semnat' AND ac.acoperita_a THEN 'PV_A_ACOPERIT_PARCELA' ELSE CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END END AS stare,
       o.stare_ordine,
       k.ultima_convocare_data, r.optiune AS ultimul_raspuns_optiune, r.data AS ultimul_raspuns_data,
       a.nr_pv AS pv_nr, a.stare AS pv_stare
  FROM public.red_parcele p
  JOIN public.red_detinatori d ON d.parcela_id = p.id AND d.sters_la IS NULL
  JOIN public.red_uat u ON u.id = p.uat_id
  LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  LEFT JOIN LATERAL (
    SELECT pv.nr_pv, pv.stare FROM public.red_procese_verbale pv
     WHERE pv.detinator_id = d.id AND pv.tip = 'A' AND pv.sters_la IS NULL AND pv.stare <> 'anulat'
     ORDER BY CASE pv.stare WHEN 'semnat' THEN 1 WHEN 'trimis_spre_semnare' THEN 2 ELSE 3 END, pv.created_at DESC
     LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT r1.optiune, r1.data FROM public.red_raspunsuri r1 WHERE r1.detinator_id = d.id
     ORDER BY r1.data DESC, r1.seq DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL (
    SELECT max(cv.data_expediere) AS ultima_convocare_data,
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL AND c2.data_confirmare_primire IS NOT NULL
                AND (coalesce(cv.retur_data, cv.data_expediere) IS NULL OR c2.data_confirmare_primire >= coalesce(cv.retur_data, cv.data_expediere)))), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  CROSS JOIN LATERAL (SELECT public.fn_red_parcela_acoperita_a(p.id) AS acoperita_a) ac
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' OR ac.acoperita_a THEN 1
      WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.sters_la IS NULL AND pb.stare <> 'anulat') THEN 2
      WHEN a.stare = 'trimis_spre_semnare' THEN 3
      WHEN r.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN 4
      WHEN r.optiune = 'nu_particip_fara_obiectii' THEN 5
      WHEN r.optiune = 'particip' THEN 6
      WHEN k.returnata THEN 7
      WHEN k.confirmata THEN 8
      WHEN k.expediata THEN 9
      WHEN d.calitate = 'neidentificat' THEN 10
      WHEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;
CREATE TEMP VIEW g31_tronson_31d AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN public.fn_red_parcela_acoperita_a(p.id) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
-- instantaneul metadatelor (owner, ACL, opțiuni, coloane; definiția centralizatorului) — comparat la final
CREATE TEMP TABLE g31_meta ON COMMIT DROP AS
SELECT c.oid, c.relowner, c.relacl, c.reloptions,
       (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS coloane,
       CASE WHEN c.oid = 'public.red_v_centralizator_uat'::regclass THEN pg_get_viewdef(c.oid, true) END AS definitie
  FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass);

DO $poarta_inainte$
DECLARE r record;
BEGIN
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_stare_31d'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_tronson_31d'::regclass, true) THEN
    RAISE EXCEPTION '20261131g (inainte): red_v_stare_parcela / red_v_tronson nu au definitiile din 31d — refuz'; END IF;
  -- cele trei vederi: owner, security_invoker, ACL exact, fără ACL pe coloane (ca în porțile 31c / 31d / 31f)
  IF (SELECT count(*) FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass)
        AND c.relkind = 'v' AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL)) <> 3 THEN
    RAISE EXCEPTION '20261131g (inainte): owner / optiuni / ACL vederi neasteptate — refuz'; END IF;
  -- L15: funcțiile pe care se sprijină echivalența, cu amprentele din 20261131d (corp, limbaj, tip, definer, volatilitate, search_path, owner, ACL)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_parcela_acoperita_a(uuid)', 'b932aaf307761d3c504608a30c117bca', 'boolean', false),
      ('public.fn_red_adresa_cunoscuta(uuid)', '55cb31fc3f291cb27bea16a2b9291146', 'boolean', true),
      ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae', 'text', true)) b(sig, corp, ret, definer) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure(r.sig) AND md5(p.prosrc) = r.corp AND l.lanname = 'sql' AND p.prorettype = to_regtype(r.ret)
          AND NOT p.proretset AND p.prosecdef = r.definer AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
          AND pg_get_userbyid(p.proowner) = 'postgres'
          AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
            = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]) THEN
      RAISE EXCEPTION '20261131g (inainte): functie in afara baseline revizuit: %', r.sig; END IF;
  END LOOP;
  -- auth.uid(): apelat de vedere și de funcția nouă (amprenta din 20261131d)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('auth.uid()') AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49' AND l.lanname = 'sql'
        AND NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig IS NULL AND NOT p.proretset AND p.prorettype = 'uuid'::regtype
        AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
          = ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin']::text[]) THEN
    RAISE EXCEPTION '20261131g (inainte): auth.uid in afara baseline revizuit'; END IF;
END $poarta_inainte$;

-- (2) aceeași poartă ca fn_red_adresa_cunoscuta (20261126a), o singură dată pe apel, nu pe rând; fără parametri (identitatea = auth.uid())
CREATE FUNCTION public.fn_red_detinatori_cu_adresa() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT c.detinator_id FROM public.red_detinatori_contact c
   WHERE c.adresa_cunoscuta IS TRUE
     AND (SELECT auth.uid() IS NOT NULL AND public.fn_red_nivel() IS NOT NULL);
$fn$;
REVOKE ALL ON FUNCTION public.fn_red_detinatori_cu_adresa() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_detinatori_cu_adresa() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_red_detinatori_cu_adresa() IS 'Redari: id-urile detinatorilor cu adresa cunoscuta, doar pentru utilizatorul logat cu drept Redari (auth.uid + fn_red_nivel, aceeasi poarta ca fn_red_adresa_cunoscuta), evaluata o data pe apel; altfel nimic. Folosita de red_v_stare_parcela (ramura FARA_ADRESA_AFISARE). Vederile red_v_stare_parcela / red_v_tronson contin si o copie a corpului fn_red_parcela_acoperita_a (20261131g): regula se schimba in toate trei.';

-- (1) + (2): aceleași 20 de coloane, în aceeași ordine
CREATE OR REPLACE VIEW public.red_v_stare_parcela WITH (security_invoker = on) AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE WHEN a.stare IS DISTINCT FROM 'semnat' AND ac.acoperita_a THEN 'PV_A_ACOPERIT_PARCELA' ELSE CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END END AS stare,
       o.stare_ordine,
       k.ultima_convocare_data, r.optiune AS ultimul_raspuns_optiune, r.data AS ultimul_raspuns_data,
       a.nr_pv AS pv_nr, a.stare AS pv_stare
  FROM public.red_parcele p
  JOIN public.red_detinatori d ON d.parcela_id = p.id AND d.sters_la IS NULL
  JOIN public.red_uat u ON u.id = p.uat_id
  LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  LEFT JOIN LATERAL (
    SELECT pv.nr_pv, pv.stare FROM public.red_procese_verbale pv
     WHERE pv.detinator_id = d.id AND pv.tip = 'A' AND pv.sters_la IS NULL AND pv.stare <> 'anulat'
     ORDER BY CASE pv.stare WHEN 'semnat' THEN 1 WHEN 'trimis_spre_semnare' THEN 2 ELSE 3 END, pv.created_at DESC
     LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT r1.optiune, r1.data FROM public.red_raspunsuri r1 WHERE r1.detinator_id = d.id
     ORDER BY r1.data DESC, r1.seq DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL (
    SELECT max(cv.data_expediere) AS ultima_convocare_data,
           -- retur „neacoperit”: nicio convocare activă confirmată la/după data returului (sau a expedierii; fără nicio dată, orice
           -- confirmare contează) — aceeași regulă ca src/redari/stare.js
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL AND c2.data_confirmare_primire IS NOT NULL
                AND (coalesce(cv.retur_data, cv.data_expediere) IS NULL OR c2.data_confirmare_primire >= coalesce(cv.retur_data, cv.data_expediere)))), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  -- = fn_red_parcela_acoperita_a(p.id): corpul din 20261130n, cu p_parcela = p.id (alias-uri a1 / d1 / d2 / a2)
  CROSS JOIN LATERAL (SELECT (
    EXISTS (SELECT 1 FROM public.red_procese_verbale a1
             WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
               AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
    OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                  AND d1.calitate NOT IN ('utilizator', 'arendas'))
        AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                  AND d2.calitate NOT IN ('utilizator', 'arendas')
                  AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                        AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))
  ) AS acoperita_a) ac
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' OR ac.acoperita_a THEN 1
      WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.sters_la IS NULL AND pb.stare <> 'anulat') THEN 2
      WHEN a.stare = 'trimis_spre_semnare' THEN 3
      WHEN r.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN 4
      WHEN r.optiune = 'nu_particip_fara_obiectii' THEN 5
      WHEN r.optiune = 'particip' THEN 6
      WHEN k.returnata THEN 7
      WHEN k.confirmata THEN 8
      WHEN k.expediata THEN 9
      WHEN d.calitate = 'neidentificat' THEN 10
      -- = coalesce(fn_red_adresa_cunoscuta(d.id), false) = false: fără utilizator funcția veche (nu cheamă fn_red_nivel);
      --   cu utilizator, aceeași poartă evaluată o dată (lista e goală fără drept Redări, ca NULL-ul funcției vechi)
      WHEN CASE WHEN (SELECT auth.uid()) IS NULL THEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false
                ELSE d.id NOT IN (SELECT x.detinator_id FROM public.fn_red_detinatori_cu_adresa() x(detinator_id)) END THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;

-- (1) aceleași 11 coloane, în aceeași ordine
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       -- = fn_red_parcela_acoperita_a(p.id) IS TRUE: corpul din 20261130n, cu p_parcela = p.id
       CASE WHEN (EXISTS (SELECT 1 FROM public.red_procese_verbale a1
                           WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
                             AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
                  OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                                AND d1.calitate NOT IN ('utilizator', 'arendas'))
                      AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                                AND d2.calitate NOT IN ('utilizator', 'arendas')
                                AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                                      AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;

-- definițiile așteptate DUPĂ (aceleași texte ca mai sus, trecute prin același deparser)
CREATE TEMP VIEW g31_stare_31g AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE WHEN a.stare IS DISTINCT FROM 'semnat' AND ac.acoperita_a THEN 'PV_A_ACOPERIT_PARCELA' ELSE CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END END AS stare,
       o.stare_ordine,
       k.ultima_convocare_data, r.optiune AS ultimul_raspuns_optiune, r.data AS ultimul_raspuns_data,
       a.nr_pv AS pv_nr, a.stare AS pv_stare
  FROM public.red_parcele p
  JOIN public.red_detinatori d ON d.parcela_id = p.id AND d.sters_la IS NULL
  JOIN public.red_uat u ON u.id = p.uat_id
  LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  LEFT JOIN LATERAL (
    SELECT pv.nr_pv, pv.stare FROM public.red_procese_verbale pv
     WHERE pv.detinator_id = d.id AND pv.tip = 'A' AND pv.sters_la IS NULL AND pv.stare <> 'anulat'
     ORDER BY CASE pv.stare WHEN 'semnat' THEN 1 WHEN 'trimis_spre_semnare' THEN 2 ELSE 3 END, pv.created_at DESC
     LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT r1.optiune, r1.data FROM public.red_raspunsuri r1 WHERE r1.detinator_id = d.id
     ORDER BY r1.data DESC, r1.seq DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL (
    SELECT max(cv.data_expediere) AS ultima_convocare_data,
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL AND c2.data_confirmare_primire IS NOT NULL
                AND (coalesce(cv.retur_data, cv.data_expediere) IS NULL OR c2.data_confirmare_primire >= coalesce(cv.retur_data, cv.data_expediere)))), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  CROSS JOIN LATERAL (SELECT (
    EXISTS (SELECT 1 FROM public.red_procese_verbale a1
             WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
               AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
    OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                  AND d1.calitate NOT IN ('utilizator', 'arendas'))
        AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                  AND d2.calitate NOT IN ('utilizator', 'arendas')
                  AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                        AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))
  ) AS acoperita_a) ac
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' OR ac.acoperita_a THEN 1
      WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.sters_la IS NULL AND pb.stare <> 'anulat') THEN 2
      WHEN a.stare = 'trimis_spre_semnare' THEN 3
      WHEN r.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN 4
      WHEN r.optiune = 'nu_particip_fara_obiectii' THEN 5
      WHEN r.optiune = 'particip' THEN 6
      WHEN k.returnata THEN 7
      WHEN k.confirmata THEN 8
      WHEN k.expediata THEN 9
      WHEN d.calitate = 'neidentificat' THEN 10
      WHEN CASE WHEN (SELECT auth.uid()) IS NULL THEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false
                ELSE d.id NOT IN (SELECT x.detinator_id FROM public.fn_red_detinatori_cu_adresa() x(detinator_id)) END THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;
CREATE TEMP VIEW g31_tronson_31g AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN (EXISTS (SELECT 1 FROM public.red_procese_verbale a1
                           WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
                             AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
                  OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                                AND d1.calitate NOT IN ('utilizator', 'arendas'))
                      AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                                AND d2.calitate NOT IN ('utilizator', 'arendas')
                                AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                                      AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;

DO $poarta_dupa$
BEGIN
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_stare_31g'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_tronson_31g'::regclass, true) THEN
    RAISE EXCEPTION '20261131g (dupa): definitiile noi nu sunt cele asteptate — refuz'; END IF;
  -- aceleași coloane / owner / ACL / opțiuni pe cele trei vederi; centralizatorul neschimbat
  IF EXISTS (SELECT 1 FROM pg_temp.g31_meta m JOIN pg_class c ON c.oid = m.oid
      WHERE c.relowner IS DISTINCT FROM m.relowner OR c.relacl IS DISTINCT FROM m.relacl OR c.reloptions IS DISTINCT FROM m.reloptions
        OR (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM m.coloane
        OR (m.definitie IS NOT NULL AND pg_get_viewdef(c.oid, true) IS DISTINCT FROM m.definitie))
     OR (SELECT count(*) FROM pg_temp.g31_meta) <> 3 THEN
    RAISE EXCEPTION '20261131g (dupa): coloane / owner / ACL / optiuni / centralizator schimbate — refuz'; END IF;
  -- funcția nouă: corp exact, SETOF uuid, DEFINER, STABLE, search_path fix, owner postgres, EXECUTE doar authenticated + service_role
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.fn_red_detinatori_cu_adresa()') AND md5(p.prosrc) = '0a4973184a6955c00038bcee7818ac4f'
        AND l.lanname = 'sql' AND p.prorettype = 'uuid'::regtype AND p.proretset AND p.prosecdef AND p.provolatile = 's'
        AND NOT p.proleakproof AND NOT p.proisstrict AND p.pronargs = 0
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(p.proowner) = 'postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
          = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[])
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') <> 1 THEN
    RAISE EXCEPTION '20261131g (dupa): fn_red_detinatori_cu_adresa nu are amprenta / ACL-ul asteptate — refuz'; END IF;
END $poarta_dupa$;
-- obiectele temporare de comparație nu rămân în sesiune după tranzacție
DROP VIEW pg_temp.g31_tronson_31g, pg_temp.g31_stare_31g, pg_temp.g31_tronson_31d, pg_temp.g31_stare_31d;
DROP TABLE pg_temp.g31_meta;
