-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- Proiectul de TEST „TEST IZOMETRIE” — pasul 2: atribuirea Janetei (gestionar pe depozitul de test) + activarea
-- nivelului „stoc” + importul datelor de test (documentele fictive pv_test), ÎNTR-O tranzacție. Aprobat de Razvan
-- (21.10.2026); îl aplică DOAR sesiunea de chat, ca postgres, SESIUNE DIRECTĂ (intrările registrului cer
-- session_user = postgres).
-- Rulare:
--   psql -X -v ON_ERROR_STOP=1 -v proiect_id=<id> -v depozit_id=<id> -v payload_fisier=<cale>/TEST_IZO_PREVIEW.payload.json \
--        -f scripts/izometrie/test_izo_2_activare_import.sql
-- payload-ul = ieșirea lui scripts/izometrie/payload_test_avize.mjs cu ACELEAȘI --proiect / --depozit (verdict APLICABIL;
-- sha256-ul fișierului e în raportul .md — îl compari înainte).
-- Rezultatul așteptat: 41 de bucăți (29 țevi / 259,73 m + 12 curbe), 40 sosit + 1 carantina (curba 9006), toate pe depozitul
-- de test; retry → duplicat = true.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set payload `cat :payload_fisier`

-- ── preview (doar citire) ──
SELECT 'PREVIEW' AS pas,
       (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id)                       AS proiect,
       (SELECT name FROM public.logistica_depozite WHERE id = :depozit_id)                             AS depozit,
       (SELECT d.site_id = p.site_id FROM public.logistica_depozite d, public.executie_proiecte p
         WHERE d.id = :depozit_id AND p.id = :proiect_id)                                              AS depozit_pe_site_proiect,
       public.fn_izo_nivel(:proiect_id)                                                                AS nivel_inainte,
       (SELECT count(*) FROM public.magazie_bucati WHERE proiect_id = :proiect_id)                     AS bucati_inainte,
       (SELECT count(*) FROM public.izo_atribuiri WHERE proiect_id = :proiect_id)                      AS atribuiri_inainte,
       jsonb_array_length(:'payload'::jsonb -> 'bucati')                                               AS bucati_payload,
       md5(:'payload')                                                                                 AS md5_payload;

BEGIN;
-- doar pe proiectul de test (gardă: codul intern)
SELECT 1 / (CASE WHEN (SELECT cod_intern FROM public.executie_proiecte WHERE id = :proiect_id) = 'TEST-IZO' THEN 1 ELSE 0 END) AS e_proiectul_de_test;

INSERT INTO public.izo_atribuiri (proiect_id, profile_id, rol, depozit_id, acordat_de, motiv)
VALUES (:proiect_id, '70d6bb90-d920-4768-a758-1a0df99853b2', 'gestionar', :depozit_id, 'Razvan Trusu',
        'Gestionar pe depozitul de TEST (testul de recepție Izometrie, documente fictive)')
RETURNING id, proiect_id, profile_id, rol, depozit_id;

SELECT public.fn_izo_activeaza_si_importa(:proiect_id, 'test-receptie-1', :'payload'::jsonb,
         'Date de TEST — recepție Izometrie (documente fictive pv_test: 2 avize țeavă + listă curbe), proiect TEST IZOMETRIE') AS rezultat;

-- ── verificare înainte de COMMIT ──
SELECT 'VERIFICARE' AS pas, public.fn_izo_nivel(:proiect_id) AS nivel, cardinality(public.fn_izo_porti_lipsa()) AS porti_lipsa;
SELECT stare, tip_cod, count(*), round(sum(coalesce(lungime_mm, 0)) / 1000.0, 2) AS metri
  FROM public.magazie_bucati WHERE proiect_id = :proiect_id GROUP BY 1, 2 ORDER BY 1, 2;
COMMIT;

-- idempotența (după COMMIT): același import → duplicat = true, nimic nou
SELECT public.fn_izo_import_sold_initial(:proiect_id, 'test-receptie-1', :'payload'::jsonb) ->> 'duplicat' AS retry_duplicat;
