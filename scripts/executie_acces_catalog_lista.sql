-- DOAR CITIRE (doar funcții pg_temp, anulate la final): ce ajunge la un proiect de Execuție în BD-ul pe care rulează, ca listă de clasificat
-- în inventarul migrării 20261209a ÎNAINTE de dry-run. Nu scrie nimic în tabele.
-- Rulare (din rădăcina repo-ului):  psql -X -v ON_ERROR_STOP=1 -f scripts/executie_acces_catalog_lista.sql
-- Lista e LARGĂ intenționat (fără opriri: coboară și prin sites → employees → profiles), ca nimic să nu scape la clasificare; preflight-ul
-- migrării e mai îngust (se oprește la tabelele 'exclus' / 'comun' și caută la funcții doar numele tabelelor acoperite și ale vederilor peste
-- ele). Ieșire: 1) tabelele (adâncimea, expresia proiectului, RLS pornit, numărul de politici), 2) vederile peste ele, 3) funcțiile SECURITY
-- DEFINER care le numesc (cu amprenta și numele găsite în corp), 4) cheile străine dintre tabelele listate (graful complet, r3).
\set ON_ERROR_STOP 1
-- (nu READ ONLY: o tranzacție read-only refuză și CREATE FUNCTION pg_temp; nimic nu rămâne după ROLLBACK)
BEGIN;
\ir executie_acces_catalog.sql
CREATE TEMP TABLE t_lista_tab ON COMMIT DROP AS SELECT * FROM pg_temp.t_cat_tabele('{}', '{}');
CREATE TEMP TABLE t_lista_ved ON COMMIT DROP AS SELECT * FROM pg_temp.t_cat_vederi(ARRAY(SELECT rel FROM t_lista_tab));
SELECT t.adancime, t.nume AS tabel, NOT t.e_public AS alta_schema, pg_temp.t_cat_proiect_expr(t.rel) AS proiect_din,
       c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.rel) AS politici
  FROM t_lista_tab t JOIN pg_class c ON c.oid = t.rel ORDER BY t.adancime, t.nume;
SELECT v.nume AS vedere, v.invoker, v.materializata, v.citibila FROM t_lista_ved v ORDER BY v.nume;
SELECT f.fn AS functie, f.amprenta,
       (SELECT string_agg(DISTINCT lower(m[1]), ',') FROM regexp_matches(p.prosrc, '\m(' || x.alternative || ')\M', 'gi') m) AS nume_gasite
  FROM pg_temp.t_cat_functii(ARRAY(SELECT nume FROM t_lista_tab WHERE e_public UNION SELECT nume FROM t_lista_ved)) f
  JOIN pg_proc p ON p.oid = f.fn
  CROSS JOIN (SELECT string_agg(nume, '|') AS alternative FROM (SELECT nume FROM t_lista_tab WHERE e_public UNION SELECT nume FROM t_lista_ved) q) x
 ORDER BY f.nume;
SELECT k.conrelid::regclass AS copil, a.attname AS coloana, k.confrelid::regclass AS parinte, a.attnotnull AS not_null
  FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
 WHERE k.contype = 'f' AND k.conrelid IN (SELECT rel FROM t_lista_tab) AND k.confrelid IN (SELECT rel FROM t_lista_tab)
 ORDER BY k.conrelid::regclass::text, a.attname;
ROLLBACK;
