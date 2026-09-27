-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 · lic. 95 (Vâlcelele) · DERIVATELE rândurilor 1751–1756 (status 'extras', tip_sursa NULL, extrase din planșa 470)
-- PROPUNERE NEEXECUTATĂ — se rulează DOAR cu GO Razvan, pas cu pas (preview → confirmare → aplicare → sanity).
-- Context: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §3.
--
-- La 25.09.2026 (SELECT-uri, după transferul din 16:51:08 UTC) NU există niciun derivat în BD: 0 grafic_parametri,
-- 0 grafic_versiuni, 0 grafic_activitati, 0 ofertare_pt_poarta, 0 ofertare_pt_pachet, 0 ofertare_pt_capitole,
-- 0 ofertare_verificari, 0 ofertare_rfq, 0 clarificări legate de 1751–1756 sau generate de platformă după transfer;
-- ai_usage_log după transfer: 0 pe licitație (ref_table='ofertare_licitatii') și 1 pe documentele ei — #4632
-- (ofertare-plansa-citeste, doc 470, 16:52:38 = pasul „note lipite” al ACELEIAȘI citiri, nu un derivat al rândurilor;
-- runda 4: preview-ul acoperă acum și ref_table='ofertare_documente_atribuire'; recontrolat 26.09.2026, identic);
-- v_ofertare_pt_stare: lista_f3_m / memoriu_m / plansa_m / grafic_fronturi_m = NULL;
-- v_ofertare_contradictii: 0 rânduri. Blocul (1) e deci o PLASĂ pentru fereastra până la merge-ul ramurii
-- claude/cantitati-nevalidate-consumatori: dacă între timp cineva generează grafic / semnează poarta / rulează
-- clarificările pe aceste cifre, rezultatul primește un marcaj vizibil „de reverificat". Pe starea de azi nu modifică nimic.
--
-- Marcajul NU atinge rândurile 1751–1756 (ar strica gărzile SQL-ului R5 v2 pe diferenta_nota) și nici doc 470
-- (analiza.citire_ai e scrisă cu CAS pe `rev` de handler — o scriere manuală ar concura cu el).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- (0) PREVIEW — un singur SELECT (execute_sql întoarce doar ultimul rezultat). Așteptat azi: n = 0 peste tot, cu excepția
--     ai_usage_log = 1 (#4632, vezi mai sus: apelul citirii planșei 470, nu un derivat) — un apel NOU pe licitație sau pe
--     documentele ei, după 16:51:08, e de citit (ce funcție, pe ce document).
SELECT 'grafic_versiuni' AS tabel, count(*) AS n, array_agg(id) AS ids FROM grafic_versiuni WHERE licitatie_id = 95
UNION ALL SELECT 'grafic_parametri (fronturi)', count(*), array_agg(id) FROM grafic_parametri
  WHERE licitatie_id = 95 AND jsonb_array_length(coalesce(parametri->'fronturi', '[]'::jsonb)) > 0
UNION ALL SELECT 'grafic_activitati', count(*), array_agg(id) FROM grafic_activitati WHERE licitatie_id = 95
UNION ALL SELECT 'ofertare_pt_poarta', count(*), array_agg(id) FROM ofertare_pt_poarta WHERE licitatie_id = 95
UNION ALL SELECT 'ofertare_pt_pachet', count(*), array_agg(id) FROM ofertare_pt_pachet WHERE licitatie_id = 95
UNION ALL SELECT 'ofertare_pt_capitole cu cifrele 1751–1756', count(*), array_agg(id) FROM ofertare_pt_capitole
  WHERE licitatie_id = 95 AND continut ~ '(17[.]?785|48[.]?195|13[.]?140|9[.]?670|4[.]?545|2[.]?275)'
UNION ALL SELECT 'ofertare_verificari', count(*), array_agg(id) FROM ofertare_verificari WHERE licitatie_id = 95
UNION ALL SELECT 'ofertare_clarificari din cantități (legate sau platforma după transfer)', count(*), array_agg(id) FROM ofertare_clarificari
  WHERE licitatie_id = 95 AND (cantitate_id BETWEEN 1751 AND 1756 OR (origine = 'platforma' AND created_at >= '2026-09-25 16:51:08+00'))
UNION ALL SELECT 'ofertare_rfq', count(*), array_agg(id) FROM ofertare_rfq WHERE licitatie_id = 95
UNION ALL SELECT 'ai_usage_log după transfer (licitația sau documentele ei)', count(*), array_agg(id) FROM ai_usage_log
  WHERE created_at >= '2026-09-25 16:51:08+00' AND ((ref_table = 'ofertare_licitatii' AND ref_id = 95)
     OR (ref_table = 'ofertare_documente_atribuire' AND ref_id IN (SELECT id FROM ofertare_documente_atribuire WHERE licitatie_id = 95)));

-- (1) APLICARE — un singur bloc DO (o tranzacție; orice RAISE EXCEPTION anulează tot). Idempotent: marcajul se pune o dată.
--     Ce e deja trimis / depus NU se modifică: se raportează în NOTICE, pentru decizia omului.
DO $$
DECLARE
  c_marcaj constant text := ' [R5-reverificare 25.09.2026: calculat pe cantități NEVALIDATE (ofertare_cantitati 1751–1756, status extras, extrase automat din planșa 470; 1751 Dn200 17.785 m include 13.765 m din afara UAT) — reverifică după validarea cantităților]';
  v_gv bigint[]; v_pp bigint[]; v_pk bigint[]; v_cap bigint[]; v_cl bigint[];
  v_cl_trimise bigint[]; v_pk_depuse bigint[]; v_par bigint[]; v_ver bigint[];
BEGIN
  -- lucrăm doar dacă rândurile-sursă sunt încă nevalidate (dacă Razvan / Oana le-au validat între timp, nu mai e cazul)
  IF NOT EXISTS (SELECT 1 FROM ofertare_cantitati WHERE licitatie_id = 95 AND id BETWEEN 1751 AND 1756 AND status <> 'validat') THEN
    RAISE NOTICE 'R5 lic. 95: toate rândurile 1751–1756 sunt validate sau lipsesc — nimic de marcat'; RETURN;
  END IF;

  -- grafic_versiuni: versiunile al căror snapshot conține un rând 1751–1756 nevalidat
  WITH u AS (UPDATE grafic_versiuni g SET nota = coalesce(g.nota, '') || c_marcaj
     WHERE g.licitatie_id = 95 AND coalesce(g.nota, '') NOT LIKE '%[R5-reverificare%'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g.snapshot->'cantitati', '[]'::jsonb)) e
                    WHERE (e->>'id')::bigint BETWEEN 1751 AND 1756 AND coalesce(e->>'status', '') <> 'validat')
     RETURNING g.id) SELECT array_agg(id) INTO v_gv FROM u;

  -- poarta propunerii semnată cât timp existau rândurile nevalidate (orice semnătură de după transfer)
  WITH u AS (UPDATE ofertare_pt_poarta p SET nota = coalesce(p.nota, '') || c_marcaj
     WHERE p.licitatie_id = 95 AND p.semnat_la >= '2026-09-25 16:51:08+00' AND coalesce(p.nota, '') NOT LIKE '%[R5-reverificare%'
     RETURNING p.id) SELECT array_agg(id) INTO v_pp FROM u;

  -- pachetul: doar cel nedepus primește marcaj; cel depus se raportează
  WITH u AS (UPDATE ofertare_pt_pachet k SET nota = coalesce(k.nota, '') || c_marcaj
     WHERE k.licitatie_id = 95 AND k.depus_la IS NULL AND k.created_at >= '2026-09-25 16:51:08+00' AND coalesce(k.nota, '') NOT LIKE '%[R5-reverificare%'
     RETURNING k.id) SELECT array_agg(id) INTO v_pk FROM u;
  SELECT array_agg(id) INTO v_pk_depuse FROM ofertare_pt_pachet WHERE licitatie_id = 95 AND depus_la IS NOT NULL AND created_at >= '2026-09-25 16:51:08+00';

  -- capitolele PT care citează cifrele 1751–1756
  WITH u AS (UPDATE ofertare_pt_capitole k SET nota = coalesce(k.nota, '') || c_marcaj
     WHERE k.licitatie_id = 95 AND k.continut ~ '(17[.]?785|48[.]?195|13[.]?140|9[.]?670|4[.]?545|2[.]?275)'
       AND coalesce(k.nota, '') NOT LIKE '%[R5-reverificare%'
     RETURNING k.id) SELECT array_agg(id) INTO v_cap FROM u;

  -- clarificări născute din aceste cantități: doar ciornele (propunere / de_trimis) primesc marcaj în `sursa` (eticheta pentru om)
  WITH u AS (UPDATE ofertare_clarificari c SET sursa = coalesce(c.sursa, '') || c_marcaj, updated_at = now()
     WHERE c.licitatie_id = 95 AND c.status IN ('propunere', 'de_trimis')
       AND (c.cantitate_id BETWEEN 1751 AND 1756 OR (c.origine = 'platforma' AND c.created_at >= '2026-09-25 16:51:08+00'))
       AND coalesce(c.sursa, '') NOT LIKE '%[R5-reverificare%'
     RETURNING c.id) SELECT array_agg(id) INTO v_cl FROM u;
  SELECT array_agg(id) INTO v_cl_trimise FROM ofertare_clarificari c
   WHERE c.licitatie_id = 95 AND c.status NOT IN ('propunere', 'de_trimis', 'retrasa')
     AND (c.cantitate_id BETWEEN 1751 AND 1756 OR (c.origine = 'platforma' AND c.created_at >= '2026-09-25 16:51:08+00'));

  -- fără câmp de notă: doar raportate (grafic_parametri.fronturi, verificările finale)
  SELECT array_agg(id) INTO v_par FROM grafic_parametri WHERE licitatie_id = 95 AND jsonb_array_length(coalesce(parametri->'fronturi', '[]'::jsonb)) > 0;
  SELECT array_agg(id) INTO v_ver FROM ofertare_verificari WHERE licitatie_id = 95 AND created_at >= '2026-09-25 16:51:08+00';

  RAISE NOTICE 'R5 lic. 95 — marcate: grafic_versiuni=% · ofertare_pt_poarta=% · ofertare_pt_pachet=% · ofertare_pt_capitole=% · ofertare_clarificari=%',
    coalesce(v_gv, '{}'), coalesce(v_pp, '{}'), coalesce(v_pk, '{}'), coalesce(v_cap, '{}'), coalesce(v_cl, '{}');
  RAISE NOTICE 'R5 lic. 95 — DOAR raportate (decide omul): pachete depuse=% · clarificări trimise/răspunse=% · grafic_parametri cu fronturi=% · verificări finale=%',
    coalesce(v_pk_depuse, '{}'), coalesce(v_cl_trimise, '{}'), coalesce(v_par, '{}'), coalesce(v_ver, '{}');
END $$;

-- (2) SANITY după (1): același SELECT ca (0) + marcajele puse
-- SELECT 'grafic_versiuni' t, array_agg(id) FROM grafic_versiuni WHERE nota LIKE '%[R5-reverificare 25.09.2026%'
-- UNION ALL SELECT 'ofertare_pt_poarta', array_agg(id) FROM ofertare_pt_poarta WHERE nota LIKE '%[R5-reverificare 25.09.2026%'
-- UNION ALL SELECT 'ofertare_pt_pachet', array_agg(id) FROM ofertare_pt_pachet WHERE nota LIKE '%[R5-reverificare 25.09.2026%'
-- UNION ALL SELECT 'ofertare_pt_capitole', array_agg(id) FROM ofertare_pt_capitole WHERE nota LIKE '%[R5-reverificare 25.09.2026%'
-- UNION ALL SELECT 'ofertare_clarificari', array_agg(id) FROM ofertare_clarificari WHERE sursa LIKE '%[R5-reverificare 25.09.2026%';

-- (R) ROLLBACK (1) — scoate EXACT marcajul (aceeași constantă ca în (1)); textul dinainte rămâne neatins; GO separat.
--     Pe ofertare_pt_capitole, UPDATE-ul pe `nota` NU creează versiune nouă (trg_pt_capitol_versioneaza reacționează doar la
--     continut / fisier_path); pe ofertare_pt_pachet trigger-ul de poartă e doar pe `stare` (verificat în pg_trigger, 25.09).
-- DO $$
-- DECLARE c_marcaj constant text := ' [R5-reverificare 25.09.2026: calculat pe cantități NEVALIDATE (ofertare_cantitati 1751–1756, status extras, extrase automat din planșa 470; 1751 Dn200 17.785 m include 13.765 m din afara UAT) — reverifică după validarea cantităților]';
-- BEGIN
--   UPDATE grafic_versiuni      SET nota  = NULLIF(replace(nota,  c_marcaj, ''), '') WHERE licitatie_id = 95 AND strpos(nota,  c_marcaj) > 0;
--   UPDATE ofertare_pt_poarta   SET nota  = NULLIF(replace(nota,  c_marcaj, ''), '') WHERE licitatie_id = 95 AND strpos(nota,  c_marcaj) > 0;
--   UPDATE ofertare_pt_pachet   SET nota  = NULLIF(replace(nota,  c_marcaj, ''), '') WHERE licitatie_id = 95 AND strpos(nota,  c_marcaj) > 0;
--   UPDATE ofertare_pt_capitole SET nota  = NULLIF(replace(nota,  c_marcaj, ''), '') WHERE licitatie_id = 95 AND strpos(nota,  c_marcaj) > 0;
--   UPDATE ofertare_clarificari SET sursa = NULLIF(replace(sursa, c_marcaj, ''), '') WHERE licitatie_id = 95 AND strpos(sursa, c_marcaj) > 0;
-- END $$;

-- (3) OPȚIONAL — derivatul din documentație: handoff_activ (claude_docs v5, 25.09 17:47) spune
--     „- 470 re-citită complet: 35 felii, 130 tronsoane, 48.195 m, 0 erori (candidat; +3.840 m vs 44.355 CS = Dn200 din afara UAT → punctul 3b din #63). NU aplicat în ofertă."
--     Două afirmații de reverificat: „NU aplicat în ofertă" (rândurile 1751–1756 EXISTĂ în ofertare_cantitati, cu Σ cantitate 48.195 —
--     nevalidate, deci neaprobate, dar prezente) și „+3.840 = Dn200 din afara UAT" (R5 v2 a respins atribuirea: Nr 1–4 = 13.765 m;
--     diferența candidată față de 44.355 e +4.440…+4.560). Actualizarea se face la ritualul de final de sesiune (handoff), nu separat.
