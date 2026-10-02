-- Rollback J07: retrage enforcement-ul și RPC-ul UI, fără pierderea istoricului append-only.
-- Obiectele noi rămân pentru audit / reaplicare. Nicio ștergere de date sau coloane.
BEGIN;
DO $rollback$
DECLARE sig text; d text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.fn_ofertare_pt_pachet_poarta_documentatie()','public.fn_gate_depunere()'] LOOP
    d:=pg_get_functiondef(sig::regprocedure);
    IF position('-- J07 BEGIN' in d)=0 THEN CONTINUE; END IF;
    d:=regexp_replace(d,E'\n  -- J07 BEGIN\n.*?  -- J07 END\n  ','','s');
    IF position('-- J07 BEGIN' in d)>0 OR position('ofertare_poarta_impune' in d)>0 THEN
      RAISE EXCEPTION 'Rollback J07: corp neașteptat în %',sig;
    END IF;
    EXECUTE d;
  END LOOP;
END $rollback$;
REVOKE EXECUTE ON FUNCTION public.ofertare_poarta_server(bigint) FROM authenticated;
COMMIT;
