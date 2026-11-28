-- Schelet LOCAL (PGlite) pentru 20270116a (Izometrie: coordonate, clase de locație, pachete de la subcontractor). NU se rulează pe nicio bază reală.
-- Se încarcă DUPĂ supabase/tests/20270114a_izometrie_buletine_ndt_schelet.sql și supabase/tests/20270115b_izometrie_ndt_citiri_schelet.sql, ÎNAINTEA
-- aplicării migrărilor 20270114a și 20270115b (proba le aplică ca runnerul), ca baza să fie „producția de după 20270115b”.
-- 20270116a nu citește nicio coloană în plus față de cele două schelete (executie_tronsoane.cod, executie_pachete_lansare.cod_document_full / revizie /
-- tronson_id / proiect_id, executie_tevi prin fn_sud_amprenta_pachet); blocul de mai jos doar verifică tipurile pe care migrarea le cere în preflight
-- (revizie integer, cod_document_full text — de confirmat pe producție de chat, prin information_schema, înainte de aplicare: limită declarată în raport).
DO $s$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('executie_tronsoane', 'cod', 'text'), ('executie_pachete_lansare', 'cod_document_full', 'text'),
                                   ('executie_pachete_lansare', 'revizie', 'integer'), ('executie_pachete_lansare', 'tronson_id', 'bigint')) c(t, col, tip)
              WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.t
                                  AND i.column_name = c.col AND i.data_type = c.tip)) THEN
    RAISE EXCEPTION 'schelet 20270116a: scheletele 20270114a + 20270115b lipsesc sau au alte tipuri';
  END IF;
END $s$;
