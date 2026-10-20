-- Dry-run 20261101c (poarta de depunere pe candidatul ALES): aplică migrarea, testează helperul și numărătorile porții pe licitația 15,
-- aplică revenirea, verifică md5-ul vechi — totul ÎNTR-UN SINGUR bloc DO terminat cu RAISE EXCEPTION => nimic nu rămâne.
-- Rezultatul vine în mesajul excepției („REZULTAT …”). Corpul migrării și al revenirii se lipesc exact în locurile marcate (MIG / RB).
-- Fixture (în aceeași tranzacție anulată): o alternativă NEALEASĂ pe cerința 1987 (candidat ales 1453, doc 11) cu documentul expirat 59.
DO $do$
DECLARE
  r text := ''; n_alt bigint; v_ales boolean; v_alt boolean; v_fara_ales boolean; ok boolean := true;
  rosii_inainte int; rosii_dupa int; rosii_cu_alt int; rosii_fara_ales int; rev_dupa int;
BEGIN
  -- numărătoarea veche (toți candidații) pe licitația 15, înainte de migrare
  SELECT count(*) INTO rosii_inainte FROM ofertare_acoperire a
    JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    JOIN documente_firma d ON d.id = a.doc_firma_id
    WHERE NOT d.utilizabil OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
          d.data_valabilitate < COALESCE((SELECT termen_depunere::date FROM ofertare_licitatii WHERE id = 15), CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END);

  PERFORM set_config('gazpet.livrare_migrare', '20261101c_ofertare_gate_depunere_ales:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;

  -- numărătoarea porții NOI (exact predicatul din fn_gate_depunere)
  SELECT count(*) INTO rosii_dupa FROM ofertare_acoperire a
    JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    JOIN documente_firma d ON d.id = a.doc_firma_id
    WHERE public.ofertare_acoperire_la_poarta(a.id) AND (NOT d.utilizabil OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
          d.data_valabilitate < COALESCE((SELECT termen_depunere::date FROM ofertare_licitatii WHERE id = 15), CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END));
  r := r || format('rosii15: inainte=%s dupa=%s; ', rosii_inainte, rosii_dupa);
  ok := ok AND rosii_dupa = rosii_inainte;

  -- (1) alternativă NEALEASĂ expirată lângă un candidat ales => NU contează (nu blochează)
  INSERT INTO ofertare_acoperire (cerinta_id, mod, status, doc_firma_id, ales) VALUES (1987, 'firma', 'acoperit', 59, false) RETURNING id INTO n_alt;
  v_alt := public.ofertare_acoperire_la_poarta(n_alt);
  v_ales := public.ofertare_acoperire_la_poarta(1453);
  SELECT count(*) INTO rosii_cu_alt FROM ofertare_acoperire a
    JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    JOIN documente_firma d ON d.id = a.doc_firma_id
    WHERE public.ofertare_acoperire_la_poarta(a.id) AND (NOT d.utilizabil OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
          d.data_valabilitate < COALESCE((SELECT termen_depunere::date FROM ofertare_licitatii WHERE id = 15), CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END));
  r := r || format('alt_nealeasa_conteaza=%s ales_conteaza=%s rosii_cu_alt=%s; ', v_alt, v_ales, rosii_cu_alt);
  ok := ok AND v_alt IS FALSE AND v_ales IS TRUE AND rosii_cu_alt = rosii_dupa;

  -- (2) candidatul ales ROȘU tot blochează: cele 4 rânduri doc 59 (ales) contează
  SELECT bool_and(public.ofertare_acoperire_la_poarta(a.id)) INTO v_ales FROM ofertare_acoperire a
    JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15 WHERE a.doc_firma_id = 59 AND a.ales;
  r := r || format('ales_rosu_conteaza=%s; ', v_ales);
  ok := ok AND v_ales IS TRUE;

  -- (3) niciun candidat ales pe cerință => toți contează (fail-closed): dezaleg 1453, alternativa expirată devine numărată
  UPDATE ofertare_acoperire SET ales = false WHERE id = 1453;
  v_fara_ales := public.ofertare_acoperire_la_poarta(n_alt);
  SELECT count(*) INTO rosii_fara_ales FROM ofertare_acoperire a
    JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15 AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    JOIN documente_firma d ON d.id = a.doc_firma_id
    WHERE public.ofertare_acoperire_la_poarta(a.id) AND (NOT d.utilizabil OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
          d.data_valabilitate < COALESCE((SELECT termen_depunere::date FROM ofertare_licitatii WHERE id = 15), CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END));
  r := r || format('fara_ales_alt_conteaza=%s rosii_fara_ales=%s; ', v_fara_ales, rosii_fara_ales);
  ok := ok AND v_fara_ales IS TRUE AND rosii_fara_ales = rosii_dupa + 1;

  -- (4) reverificare cerută pe alternativa nealeasă: nu contează; pe candidatul ales: contează
  UPDATE ofertare_acoperire SET ales = true WHERE id = 1453;
  UPDATE ofertare_acoperire SET reverificare_ceruta = true WHERE id = n_alt;
  SELECT count(*) INTO rev_dupa FROM ofertare_acoperire a JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15
    AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false) AND public.ofertare_acoperire_la_poarta(a.id);
  r := r || format('rev_alt=%s; ', rev_dupa);
  ok := ok AND rev_dupa = 0;
  UPDATE ofertare_acoperire SET reverificare_ceruta = true WHERE id = 1453;
  SELECT count(*) INTO rev_dupa FROM ofertare_acoperire a JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = 15
    AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
    WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false) AND public.ofertare_acoperire_la_poarta(a.id);
  r := r || format('rev_ales=%s; ', rev_dupa);
  ok := ok AND rev_dupa = 1;

  -- (5) review r1 P1: candidatul ales NEverificat + alternativă nealeasă verificată => cerința rămâne NEacoperită
  UPDATE ofertare_acoperire SET reverificare_ceruta = false WHERE id IN (1453, n_alt);
  UPDATE ofertare_acoperire SET verificat_pe_scan = true, fisier_path = coalesce(fisier_path, 'test/20261101c.pdf') WHERE id = n_alt;
  UPDATE ofertare_acoperire SET verificat_pe_scan = false WHERE id = 1453;
  v_alt := NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = 1987
            AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)
            AND public.ofertare_acoperire_la_poarta(a.id));
  r := r || format('ales_neverificat_alt_verificata_neacoperita=%s; ', v_alt);
  ok := ok AND v_alt IS TRUE;

  -- (6) review r2 P1 (J02b oprit): un „nu_se_aplica” NEALES nu acoperă cerința al cărei candidat ales e neverificat
  UPDATE ofertare_acoperire SET status = 'nu_se_aplica', verificat_pe_scan = false WHERE id = n_alt;
  v_alt := NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = 1987
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)))
            AND public.ofertare_acoperire_la_poarta(a.id));
  r := r || format('j02b_oprit_nsa_nealeasa_neacoperita=%s; ', v_alt);
  ok := ok AND v_alt IS TRUE;

  -- drepturi helper
  r := r || format('anon=%s auth=%s; ', has_function_privilege('anon', 'public.ofertare_acoperire_la_poarta(bigint)', 'EXECUTE'),
                   has_function_privilege('authenticated', 'public.ofertare_acoperire_la_poarta(bigint)', 'EXECUTE'));

  -- revenirea: exact funcția veche, helper scos
  PERFORM set_config('gazpet.revenire_20261101c', 'POARTA_TOTI_CANDIDATII:' || txid_current(), true);
  EXECUTE $rb$:RB$rb$;
  r := r || format('dupa_revenire md5=%s helper=%s; ', md5(pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)),
                   to_regprocedure('public.ofertare_acoperire_la_poarta(bigint)'));
  ok := ok AND md5(pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)) = '0fcfd5a7ca4813fa4ab7ff3ef60c185f';
  RAISE EXCEPTION 'REZULTAT %: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r;
END
$do$;
