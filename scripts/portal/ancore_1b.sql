-- READ ONLY. Ancorele E1-1b (Jakarinos r6 P1): callee-urile EXTERNE din lista alba 1b si triggerele de pe auth.users /
-- profiles / notifications, cu functiile lor (definitie md5, owner, DEFINER, config, ACL; triggere: activare, definitie
-- md5, functie). Aceeasi interogare (intre marcaje, identica) e in migrarea 20261119a si in inventarul read-only
-- (sectiunea 9); testul static test_static_1b.py verifica paritatea. handle_new_user e exclus: e ancorat separat pe
-- corpul LIVE din 27.10 si e inlocuit de 19a. Rezultatul (o singura valoare jsonb) intra ca literal in 20261119a.
-- ANCORE_1B_START
SELECT jsonb_build_object(
 'functii',(SELECT coalesce(jsonb_object_agg(x.s,x.a),'{}'::jsonb) FROM (
   SELECT n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS s,
    jsonb_build_array(md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl) AS a
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE NOT (n.nspname='public' AND p.proname='handle_new_user')
    AND (n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' IN ('public.fn_cont_candidati_angajat(text)',
      'public.fn_nume_cuvinte(text)','public.fn_nume_familie(text)','extensions.unaccent(text)',
      'public.fn_cont_notifica_owneri(text, text, text, text)','auth.uid()','auth.jwt()',
      'public.fn_identitate_privilegiata()','public.fn_identitate_claims()','public.fn_identitate_eticheta()')
     OR p.oid IN (SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace m ON m.oid=c.relnamespace WHERE NOT t.tgisinternal
       AND ((m.nspname='auth' AND c.relname='users') OR (m.nspname='public' AND c.relname IN ('profiles','notifications')))))) x),
 'triggere',(SELECT coalesce(jsonb_object_agg(x.k,x.a),'{}'::jsonb) FROM (
   SELECT m.nspname||'.'||c.relname||':'||t.tgname AS k,
    jsonb_build_array(t.tgenabled::text,md5(pg_get_triggerdef(t.oid)),
     (SELECT n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=t.tgfoid)) AS a
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace m ON m.oid=c.relnamespace
   WHERE NOT t.tgisinternal
    AND ((m.nspname='auth' AND c.relname='users') OR (m.nspname='public' AND c.relname IN ('profiles','notifications')))) x))
-- ANCORE_1B_END
;
