-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- Proiectul de TEST „TEST IZOMETRIE” — pasul 2, varianta FĂRĂ IMPORT (Razvan „da” 21.10.2026, chat): atribuirea Janetei
-- (gestionar pe depozitul de test TIZ) + activarea nivelului „stoc” cu 0 bucăți, ÎNTR-O tranzacție. Janeta introduce
-- documentele ea, prin ecranul E3 (testul de recepție de luni 26.10, PDF-urile pv_test).
-- Se rulează DUPĂ ce E3 (20261103b) e LIVE și după test_izo_1_creare.sql. Înlocuiește test_izo_2_activare_import.sql
-- (care rămâne pentru un eventual test cu sold inițial). Îl aplică DOAR sesiunea de chat, ca postgres, SESIUNE DIRECTĂ
-- (fn_izo_seteaza_nivel cere session_user = postgres).
-- Rulare:
--   psql -X -v ON_ERROR_STOP=1 -v proiect_id=<id> -v depozit_id=<id> -f scripts/izometrie/test_izo_2b_activare_fara_import.sql
-- Rezultatul așteptat: nivel = stoc, porți lipsă = 0, 0 bucăți, 1 atribuire activă (Janeta, gestionar, depozitul TIZ).
-- Reluarea e sigură: atribuirea nu se dublează, iar fn_izo_seteaza_nivel pe un proiect deja „stoc” doar reverifică porțile.
-- Revenire (doar cât proiectul n-are niciun fapt în registru): fn_izo_seteaza_nivel(<id>, 'off', '<motiv>') +
--   UPDATE public.izo_atribuiri SET activ = false WHERE id = <id-ul întors mai jos>.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── preview (doar citire) ──
SELECT 'PREVIEW' AS pas,
       (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id)                       AS proiect,
       (SELECT name FROM public.logistica_depozite WHERE id = :depozit_id)                             AS depozit,
       (SELECT d.site_id = p.site_id FROM public.logistica_depozite d, public.executie_proiecte p
         WHERE d.id = :depozit_id AND p.id = :proiect_id)                                              AS depozit_pe_site_proiect,
       public.fn_izo_nivel(:proiect_id)                                                                AS nivel_inainte,
       cardinality(public.fn_izo_porti_lipsa())                                                        AS porti_lipsa,
       to_regclass('public.izo_documente_intrare') IS NOT NULL                                         AS e3_live,
       (SELECT count(*) FROM public.magazie_bucati WHERE proiect_id = :proiect_id)                     AS bucati_inainte,
       (SELECT count(*) FROM public.izo_atribuiri WHERE proiect_id = :proiect_id)                      AS atribuiri_inainte;

BEGIN;
-- gărzi: doar proiectul de test, depozitul pe site-ul lui, E3 deja LIVE
SELECT 1 / (CASE WHEN (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id) = 'TEST-IZO' THEN 1 ELSE 0 END) AS e_proiectul_de_test;
SELECT 1 / (CASE WHEN (SELECT d.site_id = p.site_id FROM public.logistica_depozite d, public.executie_proiecte p
                        WHERE d.id = :depozit_id AND p.id = :proiect_id) THEN 1 ELSE 0 END)                         AS depozit_pe_site;
SELECT 1 / (CASE WHEN to_regclass('public.izo_documente_intrare') IS NOT NULL THEN 1 ELSE 0 END)                    AS e3_live;

-- 1. atribuirea Janetei (gestionar pe depozitul de test); la reluare nu se dublează
INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv)
SELECT :proiect_id, '70d6bb90-d920-4768-a758-1a0df99853b2', 'gestionar', :depozit_id, 'Razvan Trusu',
       'Gestionar pe depozitul de TEST (testul de recepție Izometrie E3, documente fictive pv_test)'
 WHERE NOT EXISTS (SELECT 1 FROM public.izo_atribuiri WHERE proiect_id = :proiect_id AND profile_id = '70d6bb90-d920-4768-a758-1a0df99853b2'
                     AND rol = 'gestionar' AND depozit_id = :depozit_id AND activ)
RETURNING id, proiect_id, profile_id, rol, depozit_id, activ;

-- 2. activarea „stoc” cu 0 bucăți (fără import): porțile E2a + E3 se verifică la apel
SELECT public.fn_izo_seteaza_nivel(:proiect_id, 'stoc',
         'Proiect de TEST — recepție Izometrie E3 fără sold inițial (Janeta introduce documentele), aprobat Razvan 21.10.2026') AS nivel_setat;
SELECT proiect_id, nivel_izo, nivel_motiv, nivel_schimbat_la, nivel_schimbat_de, server_ver
  FROM public.izo_proiect_config WHERE proiect_id = :proiect_id;

-- ── verificare înainte de COMMIT ──
SELECT 'VERIFICARE' AS pas, public.fn_izo_nivel(:proiect_id) AS nivel, cardinality(public.fn_izo_porti_lipsa()) AS porti_lipsa,
       (SELECT count(*) FROM public.magazie_bucati WHERE proiect_id = :proiect_id)                     AS bucati,
       (SELECT count(*) FROM public.magazie_bucati_evenimente WHERE proiect_id = :proiect_id)          AS evenimente,
       (SELECT count(*) FROM public.izo_atribuiri WHERE proiect_id = :proiect_id AND activ)            AS atribuiri_active;
SELECT 1 / (CASE WHEN public.fn_izo_nivel(:proiect_id) = 'stoc' AND cardinality(public.fn_izo_porti_lipsa()) = 0 THEN 1 ELSE 0 END) AS stare_ok;
COMMIT;

-- ── după COMMIT (doar citire) ──
SELECT a.id, a.rol, a.depozit_id, d.name AS depozit, a.activ, a.valabil_de, a.acordat_de
  FROM public.izo_atribuiri a LEFT JOIN public.logistica_depozite d ON d.id = a.depozit_id
 WHERE a.proiect_id = :proiect_id ORDER BY a.id;
