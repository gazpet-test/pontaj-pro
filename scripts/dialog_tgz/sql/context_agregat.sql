-- Dialog TGZ (c): context AGREGAT pentru verificare. Interogare FIXA, doar SELECT, tranzactie READ ONLY.
-- FARA date personale: nu se selecteaza nume / nume_normalizat / cota (red_detinatori), nicio coloana de adresa,
-- telefon sau email ca valoare (red_detinatori_contact - doar numaratori), nici destinatar / subiect / expeditor /
-- documente / observatii (red_corespondenta), nici valoare_lei (doar admin), nici fisier_nume / eroare / diferente.
-- Identificatori pastrati: codul proiectului, codul UAT (uat3) si numele UAT-ului (localitate publica), codul
-- corespondentei (ex. A1), starile si datele.
-- Coloane verificate in supabase/migrations: 20261126a_redari_teren.sql, 20261129a_redari_pv_schema.sql,
-- 20261129g_redari_tronson_optional.sql, 20261129h_redari_corespondenta.sql.
\pset footer off
\pset null '-'
BEGIN READ ONLY;

\echo '## 1. Loturi de import (red_import_loturi)'
\echo '```'
SELECT p.cod AS proiect, l.versiune_lista_tgz, l.stare, to_char(l.created_at AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS creat,
       l.randuri_total, l.parcele_noi, l.detinatori_noi, l.dubluri, l.neidentificati
FROM public.red_import_loturi l JOIN public.red_proiecte p ON p.id = l.proiect_id
ORDER BY p.cod, l.created_at DESC;
\echo '```'

\echo '## 2. Parcele active pe UAT (red_parcele, sters_la IS NULL)'
\echo '```'
SELECT p.cod AS proiect, u.uat3, u.nume AS uat,
       count(*) AS parcele,
       count(*) FILTER (WHERE x.nr_cadastral IS NULL OR btrim(x.nr_cadastral) = '') AS fara_nr_cadastral,
       count(*) FILTER (WHERE x.tarla IS NULL OR btrim(x.tarla) = '') AS fara_tarla,
       count(*) FILTER (WHERE x.tronson IS NULL) AS fara_tronson,
       count(*) FILTER (WHERE x.verificare_data IS NOT NULL) AS verificate,
       round(coalesce(sum(x.suprafata_temporara_mp), 0)::numeric, 2) AS suprafata_temporara_mp,
       (SELECT count(*) FROM public.red_parcele s WHERE s.uat_id = u.id AND s.sters_la IS NOT NULL) AS parcele_sterse
FROM public.red_parcele x
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE x.sters_la IS NULL
GROUP BY p.cod, u.id, u.uat3, u.nume
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 3. Detinatori activi pe UAT si calitate (red_detinatori, sters_la IS NULL; parcela activa)'
\echo '```'
SELECT p.cod AS proiect, u.uat3, d.calitate,
       count(*) AS detinatori,
       count(*) FILTER (WHERE d.decedat) AS decedati,
       count(*) FILTER (WHERE d.act_doveditor_cunoscut IS TRUE) AS act_doveditor_da,
       count(*) FILTER (WHERE d.act_doveditor_cunoscut IS FALSE) AS act_doveditor_nu,
       count(DISTINCT d.parcela_id) AS parcele_acoperite
FROM public.red_detinatori d
JOIN public.red_parcele x ON x.id = d.parcela_id AND x.sters_la IS NULL
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE d.sters_la IS NULL
GROUP BY p.cod, u.uat3, d.calitate
ORDER BY p.cod, u.uat3, d.calitate;
\echo '```'

\echo '## 4. Parcele active fara niciun detinator activ, pe UAT'
\echo '```'
SELECT p.cod AS proiect, u.uat3, count(*) AS parcele_fara_detinator
FROM public.red_parcele x
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
WHERE x.sters_la IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = x.id AND d.sters_la IS NULL)
GROUP BY p.cod, u.uat3
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 5. Completitudinea contactelor (red_detinatori_contact) - DOAR numaratori, fara valori'
\echo '```'
SELECT p.cod AS proiect, u.uat3,
       count(DISTINCT d.id) AS detinatori_activi,
       count(c.detinator_id) AS cu_fisa_contact,
       count(*) FILTER (WHERE c.detinator_id IS NOT NULL AND c.adresa_cunoscuta IS FALSE) AS adresa_necunoscuta,
       count(*) FILTER (WHERE c.adresa_strada IS NOT NULL AND btrim(c.adresa_strada) <> '') AS cu_strada,
       count(*) FILTER (WHERE c.adresa_comuna IS NOT NULL AND btrim(c.adresa_comuna) <> '') AS cu_comuna,
       count(*) FILTER (WHERE c.cod_postal IS NOT NULL AND btrim(c.cod_postal) <> '') AS cu_cod_postal,
       count(*) FILTER (WHERE c.telefon IS NOT NULL AND btrim(c.telefon) <> '') AS cu_telefon,
       count(*) FILTER (WHERE c.email IS NOT NULL AND btrim(c.email) <> '') AS cu_email
FROM public.red_detinatori d
JOIN public.red_parcele x ON x.id = d.parcela_id AND x.sters_la IS NULL
JOIN public.red_uat u ON u.id = x.uat_id
JOIN public.red_proiecte p ON p.id = x.proiect_id
LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
WHERE d.sters_la IS NULL
GROUP BY p.cod, u.uat3
ORDER BY p.cod, u.uat3;
\echo '```'

\echo '## 6. Corespondenta (red_corespondenta) - pe stare'
\echo '```'
SELECT p.cod AS proiect, c.stare, count(*) AS bucati
FROM public.red_corespondenta c JOIN public.red_proiecte p ON p.id = c.proiect_id
GROUP BY p.cod, c.stare
ORDER BY p.cod, c.stare;
\echo '```'

\echo '## 7. Corespondenta - lista fara text (cod, ordine, stare, date)'
\echo '```'
SELECT p.cod AS proiect, c.cod, c.ordine, c.stare, c.versiune,
       to_char(c.aprobat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS aprobat_la,
       c.trimis_la,
       (c.nr_inregistrare IS NOT NULL AND btrim(c.nr_inregistrare) <> '') AS are_nr_inregistrare,
       to_char(c.updated_at AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI') AS modificat
FROM public.red_corespondenta c JOIN public.red_proiecte p ON p.id = c.proiect_id
ORDER BY p.cod, c.ordine, c.cod;
\echo '```'

COMMIT;
