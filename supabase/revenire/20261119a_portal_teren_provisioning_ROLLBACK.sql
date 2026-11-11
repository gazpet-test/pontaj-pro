-- Revenire E1-1b: numai prin runner, refuz cu orice date/istoric/DDL noi.
-- r9 (11.11.2026, al doilea recenzent r8 P2-02) — CAND REFUZA revenirea (PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG, nimic
-- schimbat): orice cont nou aparut dupa apply (profil 'in_asteptare' + rand 'neaprobat' in conturi_tip; CHECK-ul vechi pe
-- profiles nu l-ar mai accepta), orice aprobare (fn_cont_aproba_erp), rezervare / cont teren / revocare, orice rand nou
-- in jurnale, orice deriva pe lista alba (functii, triggere, RLS, ACL, secvente). Refuzul e sigur pentru date, dar dupa
-- utilizare normala revenirea NU e un buton de urgenta. Procedura de urgenta (E1_REVENIRE_AUTH.md, sectiunea r9):
--  1. hook-ul de login nu e pornit de 18a / 19a: o problema de login nu se rezolva cu revenirea (hook-ul se opreste din
--     configuratia Auth, fara SQL);
--  2. daca problema e la crearea conturilor (handle_new_user nou), livrare separata, revizuita si testata, care pune la loc
--     DOAR definitia 'handle_live' din portal_e1_1b_manifest (CHECK-ul nou accepta si rolul vechi 'manager_santier');
--  3. revenirea completa dupa utilizare = migrare de curatenie noua, cu decizia owner-ului pe fiecare cont nou (rol
--     valid pentru CHECK-ul vechi sau stergere); nu se forteaza aceasta revenire si nu se editeaza amprenta.
-- r9 (P1-01): buget de lock ca la apply; lock-urile se iau o singura data ($locks$, NOWAIT, 3 s) INAINTEA verificarii
--  „fara date noi” (L14). DROP-ul FK-urilor / triggerului si ALTER ... CHECK cer ACCESS EXCLUSIVE pe auth.users, employees
--  si profiles: revenirea blocheaza si citirile (login, ERP) pe durata ei.
-- r10 (al doilea recenzent r9 P1-01, punctul 7): aceleasi reguli ca aplicarea: timeout-urile primele (lock-ul consultativ
--  cu pg_try_advisory_xact_lock + refuz), niciun tabel existent atins inainte de $locks$, o singura instructiune dupa
--  ($critic$), transaction_timeout = 2 s de la obtinerea lock-urilor pana la COMMIT. ACCESS EXCLUSIVE e cerut exact de:
--  DROP TABLE portal_provisioning (FK-urile spre auth.users / employees: stergerea triggerelor RI de pe tabelul referit),
--  DROP TRIGGER portal_revoca_la_plecare ON employees si ALTER ... CHECK pe profiles; durata lui e plafonata la 2 s.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $pre$
BEGIN
 IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
  IS DISTINCT FROM '20261119a_portal_teren_provisioning_ROLLBACK:'||txid_current() THEN
  RAISE EXCEPTION 'PORTAL_ROLLBACK_RUNNER_REQUIRED'; END IF;
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
 IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) THEN
  RAISE EXCEPTION 'PORTAL_DELIVERY_BUSY' USING ERRCODE = '55P03'; END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- r9 (P2-03): drepturile revenirii, inaintea oricarei schimbari (cate unul pe rand): proprietar pe profiles (CHECK) si
-- pe employees (DROP TRIGGER), proprietar pe functiile restaurate, LOCK pe tabelele de mai jos.
DO $priv$
DECLARE v text[] := '{}'; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.profiles','public.employees'] LOOP
    IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid=t::regclass),'USAGE') THEN
      v:=array_append(v,'proprietar pe '||t); END IF;
  END LOOP;
  IF EXISTS (SELECT FROM pg_proc p WHERE p.oid IN ('public.handle_new_user()'::regprocedure,
      'public.fn_teren_eligibil(uuid)'::regprocedure) AND NOT pg_has_role(current_user,p.proowner,'USAGE')) THEN
    v:=array_append(v,'proprietar pe handle_new_user / fn_teren_eligibil'); END IF;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees','public.profiles','public.user_module_access'] LOOP
    IF NOT (has_table_privilege(t,'UPDATE') OR has_table_privilege(t,'DELETE') OR has_table_privilege(t,'TRUNCATE')
      OR has_table_privilege(t,CASE WHEN current_setting('server_version_num')::int >= 170000 THEN 'MAINTAIN' ELSE 'UPDATE' END)) THEN
      v:=array_append(v,'LOCK (UPDATE/DELETE/TRUNCATE/MAINTAIN) pe '||t); END IF;
  END LOOP;
  IF cardinality(v) > 0 THEN
    RAISE EXCEPTION 'PORTAL_PRIVILEGES_MISSING: %', array_to_string(v,'; '); END IF;
END $priv$;
-- Punct unic de lock, NOWAIT + reincercare 3 s (nu intra in coada); peste buget = 55P03 PORTAL_LOCK_BUDGET, nimic
-- schimbat. Ordinea: auth.users -> employees -> profiles -> user_module_access -> tabelele portalului.
-- auth.users / employees / profiles ACCESS EXCLUSIVE = nivelul cerut oricum de DROP FK / DROP TRIGGER / ALTER CHECK.
DO $locks$
DECLARE v_t0 timestamptz := clock_timestamp(); v_n integer := 0;
BEGIN
  LOOP
    v_n := v_n + 1;
    BEGIN
      LOCK TABLE auth.users IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.employees IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.user_module_access IN SHARE MODE NOWAIT;
      LOCK TABLE public.portal_provisioning,public.conturi_tip,public.conturi_teren,public.conturi_tip_jurnal,
        public.portal_provisioning_jurnal,public.portal_e1_1b_manifest IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() - v_t0 >= interval '3 seconds' THEN
        RAISE EXCEPTION 'PORTAL_LOCK_BUDGET: tabelele revenirii 1b ocupate % ms (% incercari); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_n USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  -- r10: plafonul sectiunii critice (vezi 19a): 2 s de aici pana la COMMIT, pornit de la zero.
  PERFORM set_config('statement_timeout', '2s', true);
  PERFORM set_config('transaction_timeout', '0', true);
  PERFORM set_config('transaction_timeout', '2s', true);
  RAISE NOTICE 'PORTAL_LOCKS 19a revenire: % incercari, % ms; plafon 2 s pana la COMMIT', v_n,
    round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $locks$;
-- r10: sectiunea critica = o singura instructiune: verificarea „fara date noi” (L14, sub lock), restaurarea, stergerile.
DO $critic$
DECLARE m jsonb; c jsonb; v_actual jsonb; p record; v_key text;
BEGIN
 -- [check]
 IF public.fn_portal_1b_snapshot() IS DISTINCT FROM
  (SELECT valoare FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot')
  OR public.fn_portal_porti_lipsa_1b() <> '{}'::text[] THEN
  RAISE EXCEPTION 'PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG'; END IF;
 -- [restore] handle_new_user / fn_teren_eligibil din manifest, apoi CHECK-ul vechi (un singur ALTER)
 FOREACH v_key IN ARRAY ARRAY['handle_live','eligibil_live'] LOOP
 SELECT valoare INTO STRICT m FROM public.portal_e1_1b_manifest WHERE cheie=v_key;
 IF encode(sha256(convert_to((m-'sha256')::text,'UTF8')),'hex') IS DISTINCT FROM m->>'sha256'
 THEN RAISE EXCEPTION 'PORTAL_HANDLE_MANIFEST_INVALID'; END IF;
 EXECUTE m->>'definition';
 -- CREATE OR REPLACE pastreaza owner/ACL exact; snapshot-ul a refuzat orice deriva.
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar INTO STRICT p
  FROM pg_proc pr WHERE pr.oid=CASE WHEN v_key='handle_live' THEN 'public.handle_new_user()'::regprocedure ELSE 'public.fn_teren_eligibil(uuid)'::regprocedure END;
 v_actual:=jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,
  'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 IF v_actual IS DISTINCT FROM m-'sha256' THEN RAISE EXCEPTION 'PORTAL_HANDLE_RESTORE_FAILED'; END IF;
 END LOOP;
 SELECT valoare INTO STRICT c FROM public.portal_e1_1b_manifest WHERE cheie='role_live';
 EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk, ADD CONSTRAINT %I %s',
  c->>'name',c->>'definition');
 -- [drop]
 DROP TRIGGER portal_revoca_la_plecare ON public.employees;
 DROP TRIGGER portal_conturi_teren_audit ON public.conturi_teren;
 ALTER TABLE public.conturi_teren DROP COLUMN provisioning_id,DROP COLUMN creat_la,
  DROP COLUMN revocat_la,DROP COLUMN revocat_motiv;
 DROP FUNCTION public.fn_portal_porti_lipsa_1b();
 DROP FUNCTION public.fn_portal_1b_snapshot();
 DROP FUNCTION public.fn_portal_cont_pregateste(integer,uuid);
 DROP FUNCTION public.fn_portal_cont_finalizeaza(uuid);
 DROP FUNCTION public.fn_cont_aproba_erp(uuid,text);
 DROP FUNCTION public.fn_portal_revoca_la_plecare();
 DROP TABLE public.portal_provisioning;
 DROP TABLE public.portal_provisioning_jurnal;
 DROP FUNCTION public.fn_portal_provisioning_audit();
 DROP FUNCTION public.fn_portal_angajat_eligibil(integer);
 DROP TABLE public.portal_e1_1b_manifest;
 -- [post]
 IF to_regclass('public.portal_provisioning') IS NOT NULL
  OR to_regprocedure('public.fn_portal_cont_finalizeaza(uuid)') IS NOT NULL
  OR public.fn_portal_porti_lipsa() <> '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_1B_ROLLBACK_POSTCONDITION'; END IF;
END $critic$;
