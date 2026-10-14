-- Dry-run 20261029a: aplică migrarea ÎNTR-UN SINGUR bloc DO, testează ca 4 utilizatori, apoi RAISE EXCEPTION
-- => totul se anulează. Rezultatul vine în mesajul excepției („REZULTAT …”). Corpul migrării se lipește în :MIG.
DO $do$
DECLARE
  r text := '';
  u record;
  n_doc int; n_lans int; n_obj int; n_upd int;
BEGIN
  EXECUTE $mig$:MIG$mig$;
  FOR u IN SELECT * FROM (VALUES
      ('owner',     '01ab5a45-31f1-4868-81ec-c30fe05ab523'),
      ('ctc+exec',  'fff585e0-f9ea-4830-a6fb-bd51d167ef43'),
      ('doar_exec', 'cb29a12a-b318-40bc-85c0-bb4f5b3bc2d3'),
      ('fara',      'c982f928-536f-4ffe-a2dd-b8981e9eb690')) v(eticheta, uid) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO n_doc FROM public.executie_pachete_documente;
    SELECT count(*) INTO n_lans FROM public.executie_pachete_lansare;
    SELECT count(*) INTO n_obj FROM storage.objects WHERE bucket_id = 'executie-pachete-pdf';
    WITH x AS (UPDATE public.executie_pachete_documente SET observatii = observatii RETURNING 1) SELECT count(*) INTO n_upd FROM x;
    EXECUTE 'RESET ROLE';
    r := r || format('%s: doc=%s lans=%s obj=%s upd=%s; ', u.eticheta, n_doc, n_lans, n_obj, n_upd);
  END LOOP;
  -- anon nu are EXECUTE pe funcție
  r := r || 'anon_exec=' || has_function_privilege('anon', 'public.fn_executie_pachete_acces(boolean)', 'EXECUTE');
  RAISE EXCEPTION 'REZULTAT %', r;
END
$do$;
