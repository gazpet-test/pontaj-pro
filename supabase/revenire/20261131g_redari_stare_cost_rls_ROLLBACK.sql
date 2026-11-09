-- ROLLBACK 20261131g — readuce red_v_stare_parcela (definiția din 20261131d) și red_v_tronson (definiția din 20261130n, verificată de 31d)
-- exact cum erau și scoate fn_red_detinatori_cu_adresa(). Nu atinge politici, drepturi sau alte funcții (31g nu le-a schimbat).
-- Se aplică DOAR prin scripts/livrare_migrare.sh (psql --single-transaction + marcajul
-- gazpet.livrare_migrare = '20261131g_redari_stare_cost_rls_ROLLBACK:' || txid_current()). Fără BEGIN / COMMIT.
-- Vederile nu țin date ⇒ nimic de pierdut. Lock înaintea verificărilor (L01, L14), în aceeași ordine ca migrarea (L06).
-- Refuză (stare nouă) dacă: vederile nu au exact definițiile 31g / owner-ul / opțiunile / ACL-ul așteptate; funcția nouă are alt corp /
-- alte atribute / alt ACL; ALTCEVA decât red_v_stare_parcela depinde de funcția nouă; funcțiile vechi chemate de definițiile restaurate
-- nu mai au amprentele din 31d. DROP FUNCTION fără CASCADE. După: exact definițiile vechi, aceleași coloane / ACL, funcția absentă.
-- Ordinea: înaintea revenirii 20261131d (care cere definițiile 31d). Independentă de revenirea 20261131f.
-- De testat pe clonă, într-o tranzacție cu ROLLBACK: apply 31g → această revenire → re-apply 31g (porțile trec de fiecare dată).
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261131g_redari_stare_cost_rls_ROLLBACK:' || txid_current() THEN RAISE EXCEPTION 'rollback 20261131g: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION 'rollback 20261131g: armare persistenta refuzata'; END IF;
  IF to_regclass('public.red_v_stare_parcela') IS NULL OR to_regclass('public.red_v_tronson') IS NULL
     OR to_regclass('public.red_v_centralizator_uat') IS NULL THEN RAISE EXCEPTION 'rollback 20261131g: lipsesc vederile'; END IF;
  IF to_regprocedure('public.fn_red_detinatori_cu_adresa()') IS NULL THEN
    RAISE EXCEPTION 'rollback 20261131g: fn_red_detinatori_cu_adresa lipseste (31g neaplicata?)'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  LOCK TABLE public.red_procese_verbale, public.red_parcele, public.red_detinatori, public.red_uat, public.red_detinatori_contact,
    public.red_raspunsuri, public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_v_stare_parcela, public.red_v_centralizator_uat, public.red_v_tronson IN SHARE ROW EXCLUSIVE MODE;
END $start$;
-- stare nouă: singurul dependent permis al funcției noi e regula vederii red_v_stare_parcela (verificat înaintea vederilor temporare
-- de comparație de mai jos, care ar adăuga propriile dependențe)
DO $dependente$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_depend d
      WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.fn_red_detinatori_cu_adresa()'::regprocedure
        AND NOT (d.classid = 'pg_rewrite'::regclass AND d.deptype = 'n'
                 AND EXISTS (SELECT 1 FROM pg_rewrite w WHERE w.oid = d.objid AND w.ev_class = 'public.red_v_stare_parcela'::regclass)))
     OR NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
      WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_proc'::regclass
        AND d.refobjid = 'public.fn_red_detinatori_cu_adresa()'::regprocedure AND w.ev_class = 'public.red_v_stare_parcela'::regclass) THEN
    RAISE EXCEPTION 'rollback 20261131g: alte obiecte depind de fn_red_detinatori_cu_adresa (sau vederea nu o mai foloseste) — refuz';
  END IF;
END $dependente$;
DROP VIEW IF EXISTS pg_temp.g31r_stare_31g, pg_temp.g31r_tronson_31g, pg_temp.g31r_stare_31d, pg_temp.g31r_tronson_31d;
DROP TABLE IF EXISTS pg_temp.g31r_meta;

-- starea de plecare: exact definițiile din 20261131g
CREATE TEMP VIEW g31r_stare_31g AS
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
CREATE TEMP VIEW g31r_tronson_31g AS
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
-- ținta: exact definițiile din 20261131d / 20261130n (aceleași texte ca blocurile CREATE OR REPLACE de mai jos)
CREATE TEMP VIEW g31r_stare_31d AS
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
CREATE TEMP VIEW g31r_tronson_31d AS
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
CREATE TEMP TABLE g31r_meta ON COMMIT DROP AS
SELECT c.oid, c.relowner, c.relacl, c.reloptions,
       (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS coloane,
       CASE WHEN c.oid = 'public.red_v_centralizator_uat'::regclass THEN pg_get_viewdef(c.oid, true) END AS definitie
  FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass);

DO $poarta_inainte$
DECLARE r record;
BEGIN
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31r_stare_31g'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31r_tronson_31g'::regclass, true) THEN
    RAISE EXCEPTION 'rollback 20261131g (inainte): vederile nu au definitiile din 31g — refuz'; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass)
        AND c.relkind = 'v' AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL)) <> 3 THEN
    RAISE EXCEPTION 'rollback 20261131g (inainte): owner / optiuni / ACL vederi neasteptate — refuz'; END IF;
  -- funcția nouă exact cum a lăsat-o 31g (corp, atribute, ACL)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.fn_red_detinatori_cu_adresa()') AND md5(p.prosrc) = '0a4973184a6955c00038bcee7818ac4f'
        AND l.lanname = 'sql' AND p.prorettype = 'uuid'::regtype AND p.proretset AND p.prosecdef AND p.provolatile = 's'
        AND NOT p.proleakproof AND NOT p.proisstrict AND p.pronargs = 0
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(p.proowner) = 'postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
          = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[])
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') <> 1 THEN
    RAISE EXCEPTION 'rollback 20261131g (inainte): fn_red_detinatori_cu_adresa schimbata dupa 31g — refuz'; END IF;
  -- funcțiile chemate de definițiile restaurate: amprentele din 20261131d
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
      RAISE EXCEPTION 'rollback 20261131g (inainte): functie in afara baseline revizuit: %', r.sig; END IF;
  END LOOP;
END $poarta_inainte$;

-- definițiile vechi, copiate exact din 20261131d (red_v_stare_parcela) și 20261130n (red_v_tronson)
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
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
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

DO $poarta_dupa$
BEGIN
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31r_stare_31d'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31r_tronson_31d'::regclass, true) THEN
    RAISE EXCEPTION 'rollback 20261131g (dupa): definitiile restaurate nu sunt cele din 31d — refuz'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.g31r_meta m JOIN pg_class c ON c.oid = m.oid
      WHERE c.relowner IS DISTINCT FROM m.relowner OR c.relacl IS DISTINCT FROM m.relacl OR c.reloptions IS DISTINCT FROM m.reloptions
        OR (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM m.coloane
        OR (m.definitie IS NOT NULL AND pg_get_viewdef(c.oid, true) IS DISTINCT FROM m.definitie))
     OR (SELECT count(*) FROM pg_temp.g31r_meta) <> 3 THEN
    RAISE EXCEPTION 'rollback 20261131g (dupa): coloane / owner / ACL / optiuni / centralizator schimbate — refuz'; END IF;
END $poarta_dupa$;
-- întâi vederile temporare (cele „31g” depind de funcție), apoi funcția, fără CASCADE: un dependent rămas = eroare, nu ștergere
DROP VIEW pg_temp.g31r_tronson_31g, pg_temp.g31r_stare_31g, pg_temp.g31r_tronson_31d, pg_temp.g31r_stare_31d;
DROP TABLE pg_temp.g31r_meta;
DROP FUNCTION public.fn_red_detinatori_cu_adresa();
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') THEN
    RAISE EXCEPTION 'rollback 20261131g (post): fn_red_detinatori_cu_adresa inca exista'; END IF;
END $post$;
