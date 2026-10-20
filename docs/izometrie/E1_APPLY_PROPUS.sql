-- ════════════════════════════════════════════════════════════════════════
-- IZOMETRIE E1 — DATE REALE PROPUSE (NU SE RULEAZĂ fără „da”-ul lui Razvan)
-- ════════════════════════════════════════════════════════════════════════
-- Pattern CLAUDE.md pct. 3: (1) preview cu COUNT → (2) „da” explicit → (3) apply cu RETURNING
-- (id-urile se păstrează pentru rollback) → (4) SELECT de control.
-- Sursa valorilor: docs/izometrie/PREVIEW_E1.md (planșele 1413-01-NN-SM + KML-urile de predare).
-- Fiecare bloc se rulează SEPARAT (execute_sql întoarce doar ultimul rezultat).

-- ─── (1) PREVIEW — doar citire ──────────────────────────────────────────
-- 1a. LOT 2 (proiect 3): trebuie 0 tronsoane și 0 depozite pe site-ul 6
SELECT (SELECT count(*) FROM executie_tronsoane WHERE proiect_id = 3) AS tronsoane_lot2,
       (SELECT count(*) FROM logistica_depozite WHERE site_id = 6) AS depozite_site6,
       (SELECT count(*) FROM logistica_depozite WHERE cod_3litere IN ('JUP','ORN','TOP')) AS coduri_ocupate;
-- așteptat: 0, 0, 0

-- 1b. LOT 1 (proiect 1): starea de azi a celor 11 tronsoane (de comparat cu PREVIEW_E1.md)
SELECT id, cod, km_start_m, km_end_m, lungime_planificata_km, md5(row(id, cod, km_start_m, km_end_m, lungime_planificata_km)::text) AS amprenta
FROM executie_tronsoane WHERE proiect_id = 1 ORDER BY id;

-- ─── (3a) APPLY — LOT 2: tronsoanele T12–T19 (8 rânduri noi) ─────────────
INSERT INTO executie_tronsoane (proiect_id, cod, km_start_m, km_end_m, lungime_planificata_km, ordine, observatii)
VALUES
  (3, 'T12', 49000, 55000, 6.000, 12, 'Limite din PT 1413-01-12-SM (import E1 izometrie, 20.10.2026); km real din izometrii pe parcurs'),
  (3, 'T13', 55000, 60000, 5.000, 13, 'Limite din PT 1413-01-13-SM (import E1 izometrie, 20.10.2026)'),
  (3, 'T14', 60000, 66000, 6.000, 14, 'Limite din PT 1413-01-14-SM (import E1 izometrie, 20.10.2026)'),
  (3, 'T15', 66000, 71000, 5.000, 15, 'Limite din PT 1413-01-15-SM (import E1 izometrie, 20.10.2026)'),
  (3, 'T16', 71000, 75000, 4.000, 16, 'Limite din PT 1413-01-16-SM (import E1 izometrie, 20.10.2026). Sudura obiectelor speciale: Petroconst (executant, contract 390/25.05.2026)'),
  (3, 'T17', 75000, 79000, 4.000, 17, 'Limite din PT 1413-01-17-SM (import E1 izometrie, 20.10.2026). Sudura obiectelor speciale: Petroconst (executant, contract 390/25.05.2026)'),
  (3, 'T18', 79000, 83000, 4.000, 18, 'Limite din PT 1413-01-18-SM (import E1 izometrie, 20.10.2026)'),
  (3, 'T19', 83000, 89000, 6.000, 19, 'Limite din PT 1413-01-19-SM (import E1 izometrie, 20.10.2026)')
RETURNING id, cod, km_start_m, km_end_m;
-- rollback: DELETE FROM executie_tronsoane WHERE proiect_id = 3 AND id = ANY('{<id-urile întoarse>}'::bigint[]);

-- ─── (3b) APPLY — LOT 2: cele trei depozite (DM Orșova Nord separat [D2#13]) ─
INSERT INTO logistica_depozite (name, cod_3litere, site_id, adresa, activ)
VALUES
  ('DM Jupânești',   'JUP', 6, 'LOT 2 Prunișor–Jupa, km 55+116 (KML: 44.848706, 22.574222)', true),
  ('DM Orșova Nord', 'ORN', 6, 'LOT 2 Prunișor–Jupa, km 77+016 (KML: 44.771942, 22.420148)', true),
  ('OS Topleț',      'TOP', 6, 'LOT 2 Prunișor–Jupa, km 81+665 (KML: 44.776395, 22.391219)', true)
RETURNING id, name, cod_3litere;
-- rollback: DELETE FROM logistica_depozite WHERE id = ANY('{<id-urile întoarse>}'::int[]);
-- Notă: există deja contorul de avize „GAZ/TR/INTERN/ORS” (last_nr 0) fără depozit; codul ORN îl evită.

-- ─── (3c) APPLY — LOT 1: km pe T1–T11 (DOAR după Q18) ─────────────────────
-- Q18 (§8.3): T1 = 0+050 și T7 = 24+100 din BD vin din pachetele reale (_00068 rev.1, _00033 / T7S1).
--   varianta A (recomandată în design): limitele din PT (0+000, 24+000), nota din BD se păstrează în observații;
--   varianta B: păstrez 0+050 și 24+100 (începutul real al execuției).
-- Blocul de mai jos e varianta A. Rulează-l doar cu amprentele din (1b) neschimbate.
UPDATE executie_tronsoane AS t
SET km_start_m = v.s, km_end_m = v.e, lungime_planificata_km = v.l
FROM (VALUES
  ('T1', 0, 2000, 2.000), ('T2', 2000, 5000, 3.000), ('T3', 5000, 10000, 5.000), ('T4', 10000, 14000, 4.000),
  ('T5', 14000, 19000, 5.000), ('T6', 19000, 24000, 5.000), ('T7', 24000, 29000, 5.000), ('T8', 29000, 35000, 6.000),
  ('T9', 35000, 40000, 5.000), ('T10', 40000, 45000, 5.000), ('T11', 45000, 49000, 4.000)
) AS v(cod, s, e, l)
WHERE t.proiect_id = 1 AND t.cod = v.cod
RETURNING t.id, t.cod, t.km_start_m, t.km_end_m, t.lungime_planificata_km;
-- rollback (valorile de dinainte, citite pe 20.10.2026):
-- UPDATE executie_tronsoane SET km_start_m = 50,    km_end_m = 2000, lungime_planificata_km = 1.972 WHERE id = 1;
-- UPDATE executie_tronsoane SET km_start_m = 2000,  km_end_m = NULL, lungime_planificata_km = NULL  WHERE id = 2;
-- UPDATE executie_tronsoane SET km_start_m = 24100, km_end_m = NULL, lungime_planificata_km = NULL  WHERE id = 7;
-- UPDATE executie_tronsoane SET km_start_m = NULL,  km_end_m = NULL, lungime_planificata_km = NULL  WHERE id IN (3,4,5,6,8,9,10,11);

-- ─── (4) CONTROL ─────────────────────────────────────────────────────────
SELECT proiect_id, cod, km_start_m, km_end_m, lungime_planificata_km FROM executie_tronsoane WHERE proiect_id IN (1,3) ORDER BY proiect_id, km_start_m NULLS LAST;
SELECT id, name, cod_3litere, site_id FROM logistica_depozite WHERE site_id = 6;
