-- DOAR CITIRE (doar funcții pg_temp, anulate la final): ce ajunge la un proiect de Execuție în BD-ul pe care rulează, ca listă de clasificat
-- în inventarul migrării 20261209a ÎNAINTE de dry-run. Nu scrie nimic în tabele.
-- Rulare (din rădăcina repo-ului):  psql -X -v ON_ERROR_STOP=1 -f scripts/executie_acces_catalog_lista.sql
-- Ieșire: 1) tabelele (cu adâncimea și expresia proiectului), 2) vederile peste ele, 3) funcțiile SECURITY DEFINER care le numesc (cu amprenta).
\set ON_ERROR_STOP 1
-- (nu READ ONLY: o tranzacție read-only refuză și CREATE FUNCTION pg_temp; nimic nu rămâne după ROLLBACK)
BEGIN;
\ir executie_acces_catalog.sql
SELECT t.adancime, t.nume AS tabel, NOT t.e_public AS alta_schema, pg_temp.t_cat_proiect_expr(t.rel) AS proiect_din
  FROM pg_temp.t_cat_tabele('{}', '{}') t ORDER BY t.adancime, t.nume;
SELECT v.nume AS vedere, v.invoker, v.materializata, v.citibila
  FROM pg_temp.t_cat_vederi(ARRAY(SELECT rel FROM pg_temp.t_cat_tabele('{}', '{}'))) v ORDER BY v.nume;
SELECT f.fn AS functie, f.amprenta
  FROM pg_temp.t_cat_functii(ARRAY(SELECT nume FROM pg_temp.t_cat_tabele('{}', '{}') WHERE e_public
                                   UNION SELECT nume FROM pg_temp.t_cat_vederi(ARRAY(SELECT rel FROM pg_temp.t_cat_tabele('{}', '{}'))))) f
 ORDER BY f.nume;
ROLLBACK;
