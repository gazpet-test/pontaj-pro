-- Livrabil de revenire prin acelasi runner, sub numele de mai jos.
-- r9 (11.11.2026, al doilea recenzent r8 P2-02) — CAND REFUZA revenirea (PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG, nimic schimbat):
--  * orice rand nou / schimbat in conturi_tip, conturi_teren sau jurnalul lor dupa apply. Dupa 19a, ORICE cont nou
--    (inclusiv un cont ERP obisnuit) primeste un rand 'neaprobat' in conturi_tip => dupa primul cont nou revenirea 18a
--    refuza; la fel aprobarea unui cont, ban-ul / stergerea unui cont teren, orice deriva de configuratie sau de lista alba;
--  * revenirea 19a nu a rulat inainte (obiectele 1b depind de cele 18a).
--  Refuzul e sigur pentru date, dar revenirea NU e un buton de urgenta dupa utilizare normala. Procedura de urgenta
--  (docs/portal_angajat/E1_REVENIRE_AUTH.md, sectiunea r9): nu se forteaza revenirea; hook-ul de login nu e pornit de
--  aceste migrari (problema de login = hook-ul, se opreste din configuratia Auth, fara SQL); conturile noi si
--  aprobarile raman valide si fara revenire; o revenire completa dupa utilizare = migrare de curatenie noua, revizuita.
-- r9: fn_auth_token_hook RAMANE dupa revenire, ca stub (nu exista inainte de 18a), intentionat: daca hook-ul Auth ar fi
--  ramas configurat pe aceasta functie, stergerea ei ar opri TOATE login-urile; stub-ul lasa conturile ERP sa intre si
--  refuza conturile teren. INVOKER, fara acces la tabele, EXECUTE numai supabase_auth_admin. Se sterge doar printr-o
--  migrare separata de curatenie, dupa confirmarea dezactivarii hook-ului (E1_REVENIRE_AUTH.md).
-- r9 (P1-01): buget de lock ca la apply; lock-urile pe auth.users / employees se iau o singura data ($locks$, NOWAIT,
--  3 s), INAINTEA verificarii „fara date noi” (L14). DROP-ul FK-urilor conturi_* -> auth.users / employees cere
--  ACCESS EXCLUSIVE pe acestea: revenirea blocheaza si citirile (login, citiri HR) pe durata ei.
-- r10 (al doilea recenzent r9 P1-01, punctul 7): aceleasi reguli ca aplicarea. Timeout-urile sunt primele instructiuni
--  (inaintea lock-ului consultativ, luat cu pg_try_advisory_xact_lock + refuz); inainte de $locks$ nu se atinge niciun
--  tabel existent; dupa $locks$ ramane o singura instructiune ($critic$: verificarea „fara date noi” + DROP-urile).
--  ACCESS EXCLUSIVE pe auth.users / employees e cerut exact de DROP TABLE conturi_tip / conturi_teren: stergerea unui
--  FK sterge triggerele RI de pe tabelul referit (RemoveTriggerById), care cer ACCESS EXCLUSIVE; nu exista varianta
--  mai slaba. Durata lui e plafonata (r12, mai jos) si masurata in harness.
-- r11: [plafonul „2 s de la obtinerea lock-urilor” e INFIRMAT de harness-ul PG17 real si inlocuit in r12]. Ramane
--  valabil: COMMIT-ul propriu-zis NU e plafonat (PG17 opreste ceasul la intrarea in COMMIT; ACCESS EXCLUSIVE se
--  elibereaza dupa scrierea commit-ului: flush WAL, de regula milisecunde; standby-ul numai cu replicare sincrona).
-- r12 (aceeasi solutie ca 18a): fisierul NU schimba niciun timeout dupa $pre$ (un ceas pornit nu se reporneste in
--  mijlocul tranzactiei). PLAFONUL = ceasul pornit de PostgreSQL la BEGIN cu valoarea din CONEXIUNEA runnerului
--  (livrare_migrare.sh --plafon-tranzactie-ms 2000, PR #1054; sursa 'client'); $pre$ cere exact 2000/client. GARANTIA:
--  de la BEGIN (deci si de la primul lock) PANA LA INTRAREA IN COMMIT cel mult 2 s, altfel ROLLBACK la tot.
--  Reincercarea lock-urilor: pana la 1 s de la BEGIN. Dovedit in harness (lock_cap_refusal rev18a).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
    IS DISTINCT FROM '20261118a_portal_teren_identitate_ROLLBACK:'||txid_current() THEN
    RAISE EXCEPTION 'PORTAL_ROLLBACK_RUNNER_REQUIRED'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'; END IF;
  -- r12: plafonul din conexiunea runnerului, neschimbat de la BEGIN (sursa 'client').
  SELECT setting || '/' || source INTO v_plafon FROM pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/client' THEN
    RAISE EXCEPTION 'PORTAL_PLAFON_TRANZACTIE_REQUIRED: % (cerut 2000/client: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) THEN
    RAISE EXCEPTION 'PORTAL_DELIVERY_BUSY' USING ERRCODE = '55P03'; END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- Auth extern nu poate fi interogat din SQL; atestarea operatorului este obligatorie (verificata inaintea lock-urilor).
DO $auth$ BEGIN
 IF current_setting('gazpet.hook_auth_dezactivat',true) IS DISTINCT FROM 'ATEST:'||txid_current() THEN
   RAISE EXCEPTION 'PORTAL_AUTH_HOOK_ATTESTATION_REQUIRED'; END IF;
END $auth$;
-- r9 (P2-03): drepturile revenirii, inaintea oricarei schimbari: ADMIN pe teren (REVOKE din authenticator + DROP ROLE),
-- CREATEROLE, LOCK pe auth.users / employees (cate un drept pe rand).
DO $priv$
DECLARE v text[] := '{}'; t text;
BEGIN
  IF (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) IS NOT TRUE THEN
    v:=array_append(v,'CREATEROLE'); END IF;
  IF to_regrole('teren') IS NULL OR NOT pg_has_role(current_user,'teren','MEMBER WITH ADMIN OPTION') THEN
    v:=array_append(v,'ADMIN OPTION pe rolul teren'); END IF;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees'] LOOP
    IF NOT (has_table_privilege(t,'UPDATE') OR has_table_privilege(t,'DELETE') OR has_table_privilege(t,'TRUNCATE')
      OR has_table_privilege(t,CASE WHEN current_setting('server_version_num')::int >= 170000 THEN 'MAINTAIN' ELSE 'UPDATE' END)) THEN
      v:=array_append(v,'LOCK (UPDATE/DELETE/TRUNCATE/MAINTAIN) pe '||t); END IF;
  END LOOP;
  IF cardinality(v) > 0 THEN
    RAISE EXCEPTION 'PORTAL_PRIVILEGES_MISSING: %', array_to_string(v,'; '); END IF;
END $priv$;
-- Lock inainte de citirea baseline-ului (L14): blocheaza inclusiv cascadele concurente. Punct unic, NOWAIT + reincercare
-- pana la 1 s de la BEGIN (nu intra in coada); peste buget = 55P03 PORTAL_LOCK_BUDGET, nimic schimbat. Ordinea:
-- auth.users -> employees -> tabelele portalului. auth.users / employees ACCESS EXCLUSIVE = nivelul cerut oricum de
-- DROP-ul FK-urilor. r12: niciun timeout schimbat aici; plafonul = ceasul de la BEGIN (vezi antetul).
DO $locks$
DECLARE v_n integer := 0;
BEGIN
  LOOP
    v_n := v_n + 1;
    BEGIN
      LOCK TABLE auth.users IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.employees IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.portal_public_baseline,public.conturi_tip,public.conturi_teren,public.conturi_tip_jurnal
        IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION 'PORTAL_LOCK_BUDGET: auth.users / employees / portal ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE 'PORTAL_LOCKS 18a revenire: % incercari, lock-uri la % ms de la BEGIN; plafon 2 s de la BEGIN pana la intrarea in COMMIT', v_n,
    round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $locks$;
-- r10: sectiunea critica = o singura instructiune: verificarea „fara date noi” (L14, sub lock) si stergerile.
DO $critic$
DECLARE v_snapshot jsonb;
BEGIN
  -- [check] amprenta + poarta, refuz la orice rand / configuratie noua
  SELECT jsonb_build_object(
    'tip',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_tip t),
    'teren',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_teren t),
    'jurnal',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.conturi_tip_jurnal t),
    'baseline',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY semnatura),'[]') FROM public.portal_public_baseline b),
    'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
      SELECT 'f:'||p.oid AS cheie,jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa',
        'fn_portal_public_aprobat','fn_portal_public_md5','fn_portal_net_md5','fn_portal_catalog_amprenta','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid')
      UNION ALL
      SELECT 'r:'||c.oid,jsonb_build_array('relatie',c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
      FROM pg_class c WHERE c.oid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass,'public.conturi_tip_jurnal_id_seq'::regclass)
      UNION ALL
      SELECT 'a:'||a.attrelid||':'||a.attnum,jsonb_build_array('coloana',a.attrelid,a.attnum,a.attname,
        a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass) AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'c:'||c.oid,jsonb_build_array('constrangere',c.conrelid,c.conname,pg_get_constraintdef(c.oid))
      FROM pg_constraint c WHERE c.conrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 'p:'||p.oid,jsonb_build_array('politica',p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
        pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
      FROM pg_policy p WHERE p.polrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 't:'||t.oid,jsonb_build_array('trigger',t.tgrelid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid))
      FROM pg_trigger t WHERE t.tgrelid IN ('public.conturi_tip'::regclass,'public.conturi_teren'::regclass,
        'public.portal_public_baseline'::regclass,'public.conturi_tip_jurnal'::regclass)
      UNION ALL
      SELECT 's:'||s.seqrelid,to_jsonb(s) FROM pg_sequence s
      WHERE s.seqrelid='public.conturi_tip_jurnal_id_seq'::regclass
    ) x)) INTO v_snapshot;
  IF v_snapshot IS DISTINCT FROM obj_description('public.conturi_tip'::regclass,'pg_class')::jsonb
    OR public.fn_portal_porti_lipsa() <> '{}'::text[] THEN
    RAISE EXCEPTION 'PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG'; END IF;
  -- [drop] tabelele cu FK (ACCESS EXCLUSIVE pe auth.users / employees, deja detinut), stub-ul hook-ului, restul
  DROP TABLE public.conturi_tip;
  DROP TABLE public.conturi_teren;
  DROP TABLE public.conturi_tip_jurnal;
  CREATE OR REPLACE FUNCTION public.fn_auth_token_hook(event jsonb) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 IF event->'claims'->'app_metadata'->>'tip_cont'='teren'
   OR event->'app_metadata'->>'tip_cont'='teren'
   OR lower(split_part(event->'claims'->>'email','@',2))='teren.gazpet.ro'
   OR lower(split_part(event->>'email','@',2))='teren.gazpet.ro' THEN
   RETURN '{"error":{"http_code":403,"message":"Cont neautorizat"}}'::jsonb;
 END IF;
 RETURN event;
END $fn$;
  REVOKE ALL ON FUNCTION public.fn_auth_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.fn_auth_token_hook(jsonb) TO supabase_auth_admin;
  DROP TABLE public.portal_public_baseline;
  DROP FUNCTION public.fn_portal_public_md5();
  DROP FUNCTION public.fn_portal_net_md5();
  DROP FUNCTION public.fn_portal_catalog_amprenta(oid);
  DROP FUNCTION public.fn_teren_eligibil(uuid);
  DROP FUNCTION public.fn_portal_porti_lipsa();
  DROP FUNCTION public.fn_portal_public_aprobat();
  DROP FUNCTION public.fn_conturi_tip_audit();
  DROP FUNCTION public.fn_conturi_jurnal_imuabil();
  DROP FUNCTION public.fn_portal_uid();
  REVOKE teren FROM authenticator;
  REVOKE USAGE ON SCHEMA public FROM teren;
  DROP ROLE teren;
END $critic$;
-- Istoricul runnerului ramane intact: reaplicarea aceleiasi livrari este refuzata.
