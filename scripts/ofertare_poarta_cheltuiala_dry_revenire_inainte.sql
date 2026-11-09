-- DRY revenire 20261124a, PASUL 1 (r5, review r5 Jakarinos P2-01): rulat ÎN tranzacția de probă, ÎNAINTE de fișierul de revenire.
-- Fotografia independentă a dovezilor de numire (cele 6 câmpuri ale asocierii) într-un tabel temporar al tranzacției; pasul 2
-- (ofertare_poarta_cheltuiala_dry_revenire_teste.sql) o compară EXACT, în ambele sensuri, cu arhiva scrisă de revenire.
-- Ordinea:  -f <migrare> -f <teste DRY> -f <acest fișier> -f <revenire> -f ofertare_poarta_cheltuiala_dry_revenire_teste.sql
CREATE TEMP TABLE _dry_dovezi_908 ON COMMIT DROP AS
SELECT l.id AS licitatie_id, r.rol, r.resp AS responsabil_id, r.numit_de, r.dovada
  FROM public.ofertare_licitatii l
  CROSS JOIN LATERAL (VALUES (1::smallint, l.responsabil_id, l.responsabil_setat_de, l.responsabil_numitor_autorizat),
                             (2::smallint, l.responsabil2_id, l.responsabil2_setat_de, l.responsabil2_numitor_autorizat)) AS r(rol, resp, numit_de, dovada)
 WHERE r.dovada IS NOT NULL;
SELECT count(*) AS dovezi_inainte_de_revenire, count(*) FILTER (WHERE dovada) AS true_, count(*) FILTER (WHERE NOT dovada) AS false_ FROM _dry_dovezi_908;
