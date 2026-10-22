-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- Proiectul de TEST „TEST IZOMETRIE” (cod_intern TEST-IZO) — pasul 1: site + proiect + depozit. Aprobat de Razvan
-- (21.10.2026). Îl aplică DOAR sesiunea de chat, ca postgres, după ce i-a arătat lui Razvan rândurile de mai jos.
-- Rulare: psql -X -v ON_ERROR_STOP=1 -f scripts/izometrie/test_izo_1_creare.sql   (sesiune directă, pooler 5432)
--
-- Ce se creează (și ce efecte secundare au trigger-ele live — verificate pe catalog, 21.10.2026):
--   1. public.sites: 1 rând „TEST IZOMETRIE” (tip_locatie santier, raport_zilnic_necesar = false, meteo_activ = false —
--      ca să nu ceară raport zilnic / meteo pentru un șantier fictiv);
--      → trigger-ul tr_auto_create_executie_proiect CREEAZĂ AUTOMAT proiectul (cod din nume, beneficiar NULL);
--   2. public.executie_proiecte: proiectul de mai sus, redenumit apoi în cod_intern TEST-IZO, nume TEST IZOMETRIE,
--      prefix_cod_document TEST_IZO_; efecte ale trigger-elor de proiect:
--      → trg_magazie_auto: 1 rând în public.magazii („TEST IZOMETRIE”, santier, activa);
--      → tr_notif_proiect_fara_contract: câte o notificare „Proiect nou fără contract” pentru fiecare owner;
--      → tg_ep_auto_mp: nimic (site-ul nou nu are manager de șantier);
--   3. public.logistica_depozite: 1 rând „DM TEST IZO”, cod_3litere TIZ, pe site-ul de test;
--   4. sites.proiect_id = proiectul de test.
-- NU atinge LOT 1 / LOT 2. Registrul (izo_*) se activează abia la pasul 2.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── preview (doar citire): nimic de test nu există deja ──
SELECT 'PREVIEW' AS pas,
       (SELECT count(*) FROM public.sites WHERE name = 'TEST IZOMETRIE')            AS site_existent,
       (SELECT count(*) FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')  AS proiect_existent,
       (SELECT count(*) FROM public.logistica_depozite WHERE cod_3litere = 'TIZ')     AS depozit_cod_tiz,
       (SELECT count(*) FROM public.executie_proiecte)                                AS proiecte_total,
       (SELECT count(*) FROM public.logistica_depozite)                               AS depozite_total;

BEGIN;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sites WHERE name = 'TEST IZOMETRIE') OR EXISTS (SELECT 1 FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO')
     OR EXISTS (SELECT 1 FROM public.logistica_depozite WHERE cod_3litere = 'TIZ') THEN
    RAISE EXCEPTION 'Proiectul de test există deja (site / proiect / depozit TIZ) — nimic de făcut';
  END IF;
END $g$;

INSERT INTO public.sites (name, active, raport_zilnic_necesar, meteo_activ, tip_locatie)
VALUES ('TEST IZOMETRIE', true, false, false, 'santier')
RETURNING id AS site_id, name \gset

-- proiectul creat de tr_auto_create_executie_proiect: exact unul pe site-ul nou (altfel împărțire la zero → eroare,
-- ON_ERROR_STOP oprește scriptul și tranzacția se anulează)
SELECT 1 / (CASE WHEN count(*) = 1 THEN 1 ELSE 0 END) AS un_singur_proiect_auto FROM public.executie_proiecte WHERE site_id = :site_id;

UPDATE public.executie_proiecte
   SET cod_intern = 'TEST-IZO', nume = 'TEST IZOMETRIE', prefix_cod_document = 'TEST_IZO_'
 WHERE site_id = :site_id
RETURNING id AS proiect_id, cod_intern, nume, site_id, activ \gset

UPDATE public.sites SET proiect_id = :proiect_id WHERE id = :site_id RETURNING id, name, proiect_id;

INSERT INTO public.logistica_depozite (name, cod_3litere, site_id, activ)
VALUES ('DM TEST IZO', 'TIZ', :site_id, true)
RETURNING id AS depozit_id, name, cod_3litere, site_id \gset

-- ── verificare înainte de COMMIT ──
SELECT 'CREAT' AS pas, :site_id AS site_id, :proiect_id AS proiect_id, :depozit_id AS depozit_id,
       (SELECT count(*) FROM public.magazii WHERE executie_proiect_id = :proiect_id) AS magazii_proiect,
       (SELECT count(*) FROM public.executie_proiecte WHERE cod_intern = 'TEST-IZO') AS proiect_test;
COMMIT;

\echo 'Pasul 2 — payload-ul (căile cu / sau cu ghilimele):'
\echo '  node scripts/izometrie/payload_test_avize.mjs --pv-test C:/Users/Public/claude-server/pv_test --proiect' :proiect_id '--depozit' :depozit_id '--iesire <dir>/TEST_IZO_PREVIEW.md'
\echo '  psql -X -v ON_ERROR_STOP=1 -v proiect_id=':proiect_id '-v depozit_id=':depozit_id '-v payload_fisier=<dir>/TEST_IZO_PREVIEW.payload.json -f scripts/izometrie/test_izo_2_activare_import.sql'
