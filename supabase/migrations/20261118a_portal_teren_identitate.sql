-- E1-1a: numai identitate. NU activeaza hook-ul si NU modifica handle_new_user.
-- Tranzactia apartine runnerului. Inventarul este DML autorizat numai la apply.
-- r3 (09.11.2026, Copilot r2 P1-01/P1-02): 'erp' numai din lista aprobata explicit de owner (hash pe id);
-- amprentele functiilor net fixate inainte de apply. Ambele liste se completeaza din inventarul read-only
-- (scripts/portal/inventar_prod_e1.sql) inainte de DRY; necompletate = refuz atomic.
-- Completate 10.11.2026 din inventarul read-only pe prod: net (12) si lista ERP (27, confirmata de Razvan).
-- r9 (11.11.2026, al doilea recenzent r8 P1-01 / P2-03; decizia lui Razvan pe adrese):
--  * buget de lock: nicio asteptare nelimitata; lock-urile pe tabelele folosite de utilizatori se iau O SINGURA DATA,
--    cat mai tarziu ($locks$, dupa toate verificarile care doar citesc catalogul), cu NOWAIT + reincercare 3 s;
--    peste buget = refuz 55P03, nimic schimbat. Nivelurile: auth.users si employees SHARE ROW EXCLUSIVE (cerut oricum
--    de FK-urile noi), profiles SHARE; citirile nu sunt blocate. user_module_access nu mai e blocat (18a nu-l citeste).
--  * preflight de drepturi ($priv$) inaintea oricarei schimbari;
--  * conturile teren existente: sha256 pe auth.users.id::text (fara adrese in repo), ca lista ERP.
-- r10 (11.11.2026, al doilea recenzent r9 P1-01 + Jakarinos r9 P2): plafon pe DURATA sectiunii critice, nu doar pe
-- asteptare. (1) timeout-urile sunt PRIMELE instructiuni (inaintea oricarui lock, inclusiv cel consultativ, luat acum cu
-- pg_try_advisory_xact_lock + refuz); (2) inainte de $locks$ nu se atinge niciun tabel existent: tabelele portalului se
-- creeaza fara FK, listele se verifica ca format; (3) dupa $locks$ ramane O SINGURA instructiune ($critic$: FK-urile pe
-- tabelele noi goale, inventarul, clasificarea, poarta, amprenta); (4) [INLOCUIT in r12] ceasul de tranzactie
-- (transaction timeout) pornit in $locks$ + statement_timeout pe $critic$.
-- r11 (Jakarinos r10 P2 + al doilea recenzent r10 P1-01): GARANTIA, formulata exact:
--  * [INFIRMATA de harness-ul PG17 real, inlocuita in r12 - vezi mai jos] plafon de 2 s socotit de la obtinerea
--    lock-urilor ($locks$);
--  * NEplafonat (ramane valabil): COMMIT-ul propriu-zis. PG17 opreste ceasul la intrarea in COMMIT, iar lock-urile se elibereaza abia
--    dupa scrierea commit-ului: COMMIT-ul adauga durata scrierii WAL (de regula milisecunde) si, numai pe un server cu
--    replicare sincrona, asteptarea standby-ului. Limita = decizie scrisa pentru Razvan (E1_RAPORT.md, r11).
-- Masurat si dovedit in harness pe PG17 real (scripts/portal/concurrency_lock.sh: lock_cap_refusal, lock_commit_lent).
-- r12 (harness-ul PG17 real, proba "mostenit" r11): un ceas de tranzactie DEJA pornit nu se reporneste cu set_config in
-- mijlocul tranzactiei (0 apoi 2 s nu au dat 2 s de la lock-uri: 3,7 s si tranzactia a ajuns la COMMIT). Deci fisierul NU
-- mai schimba ceasul deloc. PLAFONUL = ceasul pornit de PostgreSQL la BEGIN (inceputul tranzactiei), cu valoarea pusa de
-- runner (livrare_migrare.sh --plafon-tranzactie-ms 2000, PR #1054). [r12-r13: ca parametru de pornire, sursa 'client';
-- INLOCUIT in r14, vezi mai jos.]
-- r14 (11.11.2026, faptele de pe productie + Jakarinos r13 P2 + al doilea recenzent r13 P1/P2): conexiunea de productie
-- trece prin pooler-ul Supabase (session mode), care NU transmite optiunile de conectare (serverul vedea 0/default) => cu
-- r13 livrarea ar fi refuzat mereu. Runnerul pune acum plafonul ca instructiune de SESIUNE pe aceeasi conexiune, INAINTE
-- de BEGIN ("SET ... = 2000", apoi BEGIN): trece prin pooler, ceasul porneste la BEGIN cu 2000 (sursa 'session', prioritara
-- fata de rol / baza). $pre$ cere exact 2000/session, citit din vederea de setari CALIFICATA cu schema pg_catalog (un
-- tabel temporar omonim din pg_temp nu mai poate umbri vederea reala), si marcajul plafonului gazpet.plafon_tranzactie = '2000:<txid>',
-- pus de prologul runnerului numai dupa ce a verificat el insusi 2000/session ca PRIMA instructiune dupa BEGIN.
-- DE CE e dovada ca ceasul a pornit la BEGIN cu 2000: valoarea se schimba intr-un backend doar prin instructiuni rulate in
-- el; intre BEGIN si prolog nu ruleaza nimic, deci valoarea de la BEGIN = cea vazuta de prolog. SQL-ul singur nu poate
-- deosebi "SET inainte de BEGIN" de "SET LOCAL dupa BEGIN" (aceeasi sursa) => ordinea o garanteaza runnerul (fisierele lui),
-- iar fisierul cere marcajul. In plus, cu plafon, validatorul runnerului refuza orice artefact care atinge ceasul, iar
-- garda finala a runnerului reverifica valoarea si timpul de la BEGIN inainte de COMMIT.
-- GARANTIA (formulare exacta, r14): aproximativ 2 s de la BEGIN-ul runnerului (deci si de la primul lock) PANA LA
-- INTRAREA IN COMMIT - pregatirea, lock-urile, $critic$, inregistrarea runnerului, orice pauza a clientului / retelei;
-- altfel serverul inchide sesiunea => ROLLBACK la TOT (pregatirea e in aceeasi tranzactie: nimic nu ramane). E un timeout
-- PostgreSQL pe ceasul serverului, nu timp real strict (masurat: 2000-2003 ms). COMMIT-ul propriu-zis NU e plafonat (limita
-- r11): pe productie, fara replicare sincrona (synchronous_standby_names gol), inseamna scrierea WAL a commit-ului.
-- Asteptarea lock-urilor: NOWAIT + reincercare pana la 1 s de la BEGIN.
-- r21 (12.11.2026, varianta c din E1_RAPORT.md r20; citirea read-only de pe productie, porti_citire.sql A-L):
--  * obiectele pg_net la care ajunge teren prin PUBLIC (net._http_response, net.http_request_queue si secventa ei) sunt
--    acceptate de poarta DOAR cu amprenta fixata din productie (lista unica: fn_portal_net_rel_aprobat, cu marcajul
--    listei in corp; definitia amprentei: fn_portal_net_rel_amprenta = sectiunea G din porti_citire.sql, L19).
--    Orice drept nou, coloana noua, alt proprietar sau alt obiect in net = poarta rosie, ca pana acum. Mai putine drepturi
--    (PUBLIC retras de platforma) = obiectul nu mai e accesibil, poarta ramane verde;
--  * dreptul lui teren pe o relatie / secventa = o singura functie (fn_portal_teren_rel_drept), folosita de poarta si de
--    preconditia $public_pre$;
--  * poarta: schemele expuse de PostgREST, daca sunt setate in baza (rolul authenticator), nu au voie sa contina net;
--  * postconditia (pasul 5 din $critic$) spune in mesaj CE porti lipsesc: numarul si lista lor.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261118a_portal_teren_identitate:' || txid_current() THEN
    RAISE EXCEPTION 'PORTAL_RUNNER_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED';
  END IF;
  -- r10: plafonul cere ceasul de tranzactie al PostgreSQL 17 (ca productia).
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'; END IF;
  -- r14: PLAFONUL = ceasul pornit la BEGIN cu 2000, pus de runner ca SET de sesiune inainte de BEGIN (sursa 'session'),
  -- citit CALIFICAT (pg_catalog) + marcajul prologului runnerului (verificat de el primul dupa BEGIN). Vezi antetul.
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
    OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION 'PORTAL_PLAFON_TRANZACTIE_REQUIRED: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- Ordine comuna (L06): advisory livrare -> obiectele noi (rol, functii, baseline, tabelele portalului fara FK)
  -- -> auth.users -> employees -> profiles ($locks$) -> FK-urile tabelelor noi ($critic$).
  -- Calea de login/creare cont: auth.users -> profiles (aceeasi ordine).
  -- r10: runnerul tine deja lock-ul consultativ (1_pre, reintrant); fara runner nu se asteapta: ocupat = refuz.
  IF NOT pg_try_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) THEN
    RAISE EXCEPTION 'PORTAL_DELIVERY_BUSY' USING ERRCODE = '55P03';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'teren')
    OR to_regclass('public.conturi_tip') IS NOT NULL
    OR to_regclass('public.conturi_teren') IS NOT NULL
    OR to_regclass('public.conturi_tip_jurnal') IS NOT NULL
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil',
        'fn_portal_porti_lipsa','fn_portal_public_aprobat','fn_portal_public_md5','fn_portal_net_md5','fn_portal_catalog_amprenta','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid',
        'fn_portal_net_rel_aprobat','fn_portal_net_rel_amprenta','fn_portal_net_rel_acceptat','fn_portal_teren_rel_drept')) THEN
    RAISE EXCEPTION 'PORTAL_ALREADY_EXISTS';
  END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- r9 (P2-03): drepturile de care are nevoie postgres NOSUPERUSER, verificate INAINTEA oricarei schimbari.
-- Rolul: proba EFECTIVA (CREATE ROLE + GRANT catre authenticator + REVOKE + DROP pe un rol de proba, intr-o
-- subtranzactie anulata intentionat). Tabelele: cate un drept pe rand (has_table_privilege cu lista = ORICARE drept).
-- LOCK in alt mod decat ACCESS SHARE cere UPDATE, DELETE, TRUNCATE sau MAINTAIN (PG17) pe tabel.
DO $priv$
DECLARE v text[] := '{}'; t text;
BEGIN
  IF (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) IS NOT TRUE THEN
    v:=array_append(v,'CREATEROLE'); END IF;
  IF to_regrole('authenticator') IS NULL OR to_regrole('supabase_auth_admin') IS NULL THEN
    v:=array_append(v,'rolurile authenticator / supabase_auth_admin'); END IF;
  IF NOT has_schema_privilege('public','CREATE') THEN v:=array_append(v,'CREATE pe schema public'); END IF;
  IF NOT has_schema_privilege('auth','USAGE') THEN v:=array_append(v,'USAGE pe schema auth'); END IF;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees'] LOOP
    IF NOT has_table_privilege(t,'REFERENCES') THEN v:=array_append(v,'REFERENCES pe '||t); END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees','public.profiles'] LOOP
    IF NOT has_table_privilege(t,'SELECT') THEN v:=array_append(v,'SELECT pe '||t); END IF;
    IF NOT (has_table_privilege(t,'UPDATE') OR has_table_privilege(t,'DELETE') OR has_table_privilege(t,'TRUNCATE')
      OR has_table_privilege(t,CASE WHEN current_setting('server_version_num')::int >= 170000 THEN 'MAINTAIN' ELSE 'UPDATE' END)) THEN
      v:=array_append(v,'LOCK (UPDATE/DELETE/TRUNCATE/MAINTAIN) pe '||t); END IF;
  END LOOP;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='portal_e1_proba_drepturi') THEN
    v:=array_append(v,'rolul de proba exista deja');
  ELSIF to_regrole('authenticator') IS NOT NULL THEN
    BEGIN
      CREATE ROLE portal_e1_proba_drepturi NOLOGIN NOINHERIT;
      GRANT portal_e1_proba_drepturi TO authenticator;
      REVOKE portal_e1_proba_drepturi FROM authenticator;
      DROP ROLE portal_e1_proba_drepturi;
      RAISE EXCEPTION 'PORTAL_PROBA_DREPTURI_OK';
    EXCEPTION
      WHEN raise_exception THEN IF SQLERRM <> 'PORTAL_PROBA_DREPTURI_OK' THEN RAISE; END IF;
      WHEN insufficient_privilege THEN v:=array_append(v,'CREATE ROLE / GRANT rol TO authenticator: '||SQLERRM);
    END;
  END IF;
  IF cardinality(v) > 0 THEN
    RAISE EXCEPTION 'PORTAL_PRIVILEGES_MISSING: %', array_to_string(v,'; '); END IF;
END $priv$;

CREATE ROLE teren NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT teren TO authenticator;
GRANT USAGE ON SCHEMA public TO teren;

-- r10: tabelele conturi_* se creeaza INAINTE de $locks$, fara FK (un FK ia SHARE ROW EXCLUSIVE pe auth.users /
-- employees); FK-urile se adauga in $critic$, pe tabele goale (validare instantanee). Functiile de mai jos le folosesc
-- doar la executie (plpgsql: corpul nu se analizeaza la creare, deci nu blocheaza tabelele pe care le citeste).
CREATE FUNCTION public.fn_conturi_tip_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  INSERT INTO public.conturi_tip_jurnal(auth_user_id,operatie,vechi,nou,autor,rol_sesiune)
    VALUES (coalesce(NEW.auth_user_id,OLD.auth_user_id), TG_OP,
      CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, auth.uid(), session_user);
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_tip_audit() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE FUNCTION public.fn_conturi_jurnal_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
BEGIN RAISE EXCEPTION 'PORTAL_AUDIT_APPEND_ONLY'; END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_jurnal_imuabil() FROM PUBLIC,anon,authenticated,service_role,teren;

CREATE FUNCTION public.fn_teren_eligibil(p_uid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
  -- Hook: rol real supabase_auth_admin; client teren: numai identitatea proprie.
  -- SET ROLE necesita membership real, nu un GUC de aplicatie controlat de client.
  IF p_uid IS NULL OR (session_user <> 'supabase_auth_admin'
    AND current_setting('role',true) IS DISTINCT FROM 'supabase_auth_admin'
    AND auth.uid() IS DISTINCT FROM p_uid) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT FROM public.conturi_teren c
    JOIN public.conturi_tip t ON t.auth_user_id=c.auth_user_id AND t.tip='teren'
    JOIN public.employees e ON e.id=c.employee_id
    JOIN auth.users u ON u.id=c.auth_user_id
    WHERE c.auth_user_id=p_uid AND c.stare='activ' AND e.active IS TRUE
      AND (e.termination_date IS NULL OR e.termination_date >= (now() AT TIME ZONE 'Europe/Bucharest')::date)
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_teren_eligibil(uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_teren_eligibil(uuid) TO supabase_auth_admin,teren;

-- Pe prod, schema auth da USAGE doar lui anon/authenticated/service_role/postgres, iar postgres NU are GRANT OPTION:
-- rolul teren nu poate primi acces direct la auth.uid(). Identitatea clientului teren (si a politicilor TO teren din
-- modulele opt-in) trece prin acest helper DEFINER (proprietar postgres, care are USAGE pe auth).
CREATE FUNCTION public.fn_portal_uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
  SELECT auth.uid();
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_uid() FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_uid() TO teren;

CREATE FUNCTION public.fn_auth_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid; v_tip text;
  v_error CONSTANT jsonb := '{"error":{"http_code":403,"message":"Cont neautorizat"}}';
BEGIN
  v_uid := (event->>'user_id')::uuid;
  IF v_uid IS NULL OR jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN RETURN v_error; END IF;
  SELECT tip INTO v_tip FROM public.conturi_tip WHERE auth_user_id=v_uid;
  IF v_tip='erp' AND event->'claims'->>'role' = 'authenticated' THEN RETURN event; END IF;
  IF v_tip='teren' AND public.fn_teren_eligibil(v_uid) IS TRUE THEN
    RETURN jsonb_set(event, '{claims,role}', '"teren"'::jsonb, true);
  END IF;
  RETURN v_error;
EXCEPTION WHEN OTHERS THEN RETURN v_error;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_auth_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_auth_token_hook(jsonb) TO supabase_auth_admin;

-- Lista celor 21 de functii executabile de PUBLIC pe prod (inventar read-only 27.10, scripts/portal/inventar_public.sql),
-- 20 INVOKER si un DEFINER trigger, conform inventarului furnizat. Nu deducem siguranta doar din INVOKER;
-- corpurile sunt ancorate in md5-urile revizuite, iar orice drift al definitiei/configuratiei/ACL este refuzat.
-- Orice schimbare a setului PUBLIC pe prod face apply-ul sa refuze (precondiția de mai jos) si poarta rosie.
CREATE FUNCTION public.fn_portal_public_aprobat() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $fn$
  SELECT ARRAY[
    'public.auto_cost_from_tichet()',
    'public.auto_flag_agabaritic()',
    'public.check_alerta_consum()',
    'public.fn_claude_context_cleanup()',
    'public.fn_contracte_linii_updated_at()',
    'public.fn_executie_touch_updated_at()',
    'public.fn_notif_lipsa_fisa_service(bigint)',
    'public.fn_trg_categorie_cantitate()',
    'public.gen_numar_transport()',
    'public.get_istoric_importuri_evogps()',
    'public.hr_recrutare_touch_updated_at()',
    'public.notify_tichet_opener_on_resolve()',
    'public.set_updated_at()',
    'public.tg_active_lipsa_fisa()',
    'public.tg_hr_employees_private_touch()',
    'public.tg_lsf_touch_updated()',
    'public.update_hr_semnaturi_modificat_la()',
    'public.update_modificat_la_hr_docp()',
    'public.update_modificat_la_ord_setari()',
    'public.update_stoc_achizitie()',
    'public.update_stoc_rezervor()'
  ]::text[];
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_public_aprobat() FROM PUBLIC,anon,authenticated,service_role,teren;


-- Amprenta revizuita din inventarul read-only furnizat de owner; nu invatam corpurile public la apply.
CREATE FUNCTION public.fn_portal_public_md5() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $hash$
 SELECT '{"public.auto_cost_from_tichet()":"31132cfdbc627358a1e848cf8672606a","public.auto_flag_agabaritic()":"2768f944886579d664b477f617b8b350","public.check_alerta_consum()":"5f993634b5d73d2c819fd00f710a5487","public.fn_claude_context_cleanup()":"bddab2d4bec1914f9ba52383b80a59fc","public.fn_contracte_linii_updated_at()":"554e8749a7b13374a57833f2d27d9ea2","public.fn_executie_touch_updated_at()":"4c906448b83147209f60b2f43138eb70","public.fn_notif_lipsa_fisa_service(bigint)":"04e96ff7871768dab1fbd6ee5111853f","public.fn_trg_categorie_cantitate()":"55e73645ca631dd12428d651b3e0b08f","public.gen_numar_transport()":"c7516ef4ade0e73d7ae0e6858c127d36","public.get_istoric_importuri_evogps()":"63c9562772432344f3363ec9a80b5d68","public.hr_recrutare_touch_updated_at()":"95e1005ac999206e023f52866c68547e","public.notify_tichet_opener_on_resolve()":"79b205d113f9bf87ab49df9c67e8cb22","public.set_updated_at()":"7f72f26535f14d5d91a2cedf23265f32","public.tg_active_lipsa_fisa()":"c356c1e1e9f37fa0a12818e7ecb5b412","public.tg_hr_employees_private_touch()":"e68a08b51a46461971979211b6bf974c","public.tg_lsf_touch_updated()":"5ac90d6b16d4a6ce589897122f2fdb26","public.update_hr_semnaturi_modificat_la()":"3c013c1387867ac00e606f874508d984","public.update_modificat_la_hr_docp()":"c8a2931b006daa93bafd3576bc9e1dc4","public.update_modificat_la_ord_setari()":"4a10ec11414f85ad1e984b16fe423456","public.update_stoc_achizitie()":"d2b7ad81c50620f265e0c8de63c15164","public.update_stoc_rezervor()":"e0f68e63fd8a7222258546754531c732"}'::jsonb;
$hash$;
REVOKE ALL ON FUNCTION public.fn_portal_public_md5() FROM PUBLIC,anon,authenticated,service_role,teren;
-- r3 (Copilot r2 P1-02): lista exacta + amprentele revizuite ale functiilor net (pg_net) executabile prin PUBLIC,
-- fixate INAINTE de apply din inventarul read-only; nu se mai invata la apply. Gol = refuz atomic.
-- Forma cheii: schema.nume(tipuri) cu oidvectortypes, ca in poarta. Valoarea: md5(pg_get_functiondef).
-- Completat 10.11.2026 din inventarul read-only pe prod (scripts/portal/inventar_prod_e1.sql, sectiunea 2): 12 functii net
-- executabile prin PUBLIC, niciuna SECURITY DEFINER, toate cu owner supabase_admin.
CREATE FUNCTION public.fn_portal_net_md5() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $nethash$
 SELECT '{"net._await_response(bigint)":"227f3aebd09f0563448941d0f9407644","net._encode_url_with_params_array(text, text[])":"ba2aab33cb660306fd36d5a58c2c8767","net._http_collect_response(bigint, boolean)":"cb06cf9e5263c94f3fa2a9b5da96627a","net._urlencode_string(character varying)":"3a141d2f5fe47b13d1b38f6972e65e2b","net.check_worker_is_up()":"561dc64d13116f35f836fca419976cd6","net.http_collect_response(bigint, boolean)":"7001b98890bd394f86e82556422c106b","net.http_delete(text, jsonb, jsonb, integer, jsonb)":"b7a41eaa074deb087c82cc61ce587c07","net.http_get(text, jsonb, jsonb, integer)":"ac3508c2c864d06e8872938042456d91","net.http_post(text, jsonb, jsonb, jsonb, integer)":"05103078b4b36c776bc0925f4fecf8e2","net.wait_until_running()":"43e41c4c0abaeddf18611f473f747914","net.wake()":"9d92f13f6f65e7011090693e4ea2da26","net.worker_restart()":"384403c12f70a9d4c75d6842e249e479"}'::jsonb;
$nethash$;
REVOKE ALL ON FUNCTION public.fn_portal_net_md5() FROM PUBLIC,anon,authenticated,service_role,teren;
-- Exceptie explicita pentru catalogul SQL standard livrat de initdb (OID sub FirstNormalObjectId).
-- Nu accepta obiecte noi de aplicatie in information_schema; baseline-ul nu modifica privilegii.
CREATE FUNCTION public.fn_portal_catalog_amprenta(p_oid oid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT jsonb_build_array(c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
  CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END,
  (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl)
    ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
 FROM pg_class c WHERE c.oid=p_oid;
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_catalog_amprenta(oid) FROM PUBLIC,anon,authenticated,service_role,teren;
-- r21 (varianta c): dreptul lui teren pe o relatie / secventa (orice drept: tabel, coloane; MAINTAIN doar din PG17).
-- Definitia unica (L19), folosita de poarta (bucla relatiilor) si de preconditia $public_pre$. plpgsql: functia
-- has_sequence_privilege nu primeste niciodata altceva decat o secventa (pe productie un index a rupt o citire, r20).
CREATE FUNCTION public.fn_portal_teren_rel_drept(p_oid oid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_kind "char";
BEGIN
  SELECT c.relkind INTO v_kind FROM pg_catalog.pg_class c WHERE c.oid=p_oid;
  IF v_kind = 'S' THEN RETURN has_sequence_privilege('teren',p_oid,'USAGE,SELECT,UPDATE'); END IF;
  IF v_kind IN ('r','p','v','m','f') THEN
    -- MAINTAIN exista doar din PG17 (prod).
    RETURN has_table_privilege('teren',p_oid,CASE WHEN current_setting('server_version_num')::int >= 170000
        THEN 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ELSE 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' END)
      OR has_any_column_privilege('teren',p_oid,'SELECT,INSERT,UPDATE,REFERENCES');
  END IF;
  RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_teren_rel_drept(oid) FROM PUBLIC,anon,authenticated,service_role,teren;
-- r21 (varianta c): amprenta de structura a unui obiect din net = EXACT expresia sectiunii G din
-- scripts/portal/porti_citire.sql (tip, proprietar, ACL, RLS, FORCE RLS, coloane: numar, nume, tip, NOT NULL, ACL), cu
-- acelasi search_path (pg_catalog, pg_temp: tipul net.http_method se scrie calificat). Paritatea textului e testata static
-- (scripts/portal/test_static_net_rel.py) si pe PostgreSQL (scripts/portal/net_rel_pglite.mjs). Fara randuri din tabele.
CREATE FUNCTION public.fn_portal_net_rel_amprenta(p_oid oid) RETURNS text
LANGUAGE sql STABLE SET search_path TO 'pg_catalog','pg_temp' AS $fn$
 SELECT
  -- AMPRENTA_NET_REL inceput
  jsonb_build_array(c.relkind::text, pg_get_userbyid(c.relowner), c.relacl::text, c.relrowsecurity,
                 c.relforcerowsecurity,
                 (SELECT jsonb_agg(jsonb_build_array(at.attnum, at.attname::text, format_type(at.atttypid, at.atttypmod),
                                                     at.attnotnull, at.attacl::text) ORDER BY at.attnum)
                    FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped))::text
  -- AMPRENTA_NET_REL sfarsit
   FROM pg_class c WHERE c.oid = p_oid;
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_net_rel_amprenta(oid) FROM PUBLIC,anon,authenticated,service_role,teren;
-- r21 (varianta c): LISTA UNICA a obiectelor pg_net acceptate de poarta, cu md5-ul amprentei citit read-only pe productie
-- (12.11.2026, porti_citire.sql sectiunea G; textul amprentei e in jurnalul citirii). Cheia = schema.nume (quote_ident).
-- Se schimba DOAR prin review (SHA nou); nu se invata la apply.
CREATE FUNCTION public.fn_portal_net_rel_aprobat() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $netrel$
 -- PORTAL_NET_REL_APROBAT: net._http_response, net.http_request_queue, net.http_request_queue_id_seq (productie, 12.11.2026)
 SELECT '{"net._http_response":"af629f9c5992f34ede3bc889d2db669c","net.http_request_queue":"e0e96a399d23c7eb05ca2216618e1b72","net.http_request_queue_id_seq":"d7e907e6bf5f93c94b754f45839161d1"}'::jsonb;
$netrel$;
REVOKE ALL ON FUNCTION public.fn_portal_net_rel_aprobat() FROM PUBLIC,anon,authenticated,service_role,teren;
-- r21 (varianta c): obiectul e in net, e in lista si amprenta lui de acum = md5-ul revizuit. Cheie lipsa / amprenta NULL =
-- fals (fail-closed). Predicatul unic (L19) al poartei si al preconditiei.
CREATE FUNCTION public.fn_portal_net_rel_acceptat(p_oid oid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $fn$
 SELECT EXISTS (SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE c.oid=p_oid AND n.nspname='net'
     AND public.fn_portal_net_rel_aprobat()->>(quote_ident(n.nspname)||'.'||quote_ident(c.relname))
       = md5(public.fn_portal_net_rel_amprenta(c.oid)));
$fn$;
REVOKE ALL ON FUNCTION public.fn_portal_net_rel_acceptat(oid) FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TABLE public.portal_public_baseline (semnatura text PRIMARY KEY, amprenta jsonb NOT NULL);
ALTER TABLE public.portal_public_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_public_baseline FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE TRIGGER portal_public_baseline_imuabil BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.portal_public_baseline
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
-- INSERT initial se face mai jos, cu triggerul suspendat in aceeasi tranzactie.

CREATE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v text[] := '{}'; r record; v_signature text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='teren') THEN RETURN ARRAY['teren lipsa']; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='teren' AND
    (rolbypassrls OR rolsuper OR rolcanlogin OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    v:=array_append(v,'teren atribute'); END IF;
  IF has_schema_privilege('teren','public','CREATE') THEN v:=array_append(v,'teren CREATE public'); END IF;
  IF EXISTS (SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='teren')) THEN v:=array_append(v,'teren membership'); END IF;
  IF NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='teren')
    AND member=(SELECT oid FROM pg_roles WHERE rolname='authenticator')) THEN
    v:=array_append(v,'config incompleta: authenticator teren'); END IF;
  IF EXISTS (SELECT FROM pg_namespace n WHERE n.nspname <> 'pg_catalog'
    AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('teren',n.oid,'USAGE')
    AND has_schema_privilege('teren',n.oid,'CREATE')) THEN
    v:=array_append(v,'teren CREATE schema accesibila'); END IF;
  -- pg_catalog este suprafata interna PostgreSQL, exclusa explicit din schemele aplicatiei.
  IF (SELECT array_agg(nspname::text ORDER BY nspname COLLATE "C") FROM pg_namespace
      WHERE nspname <> 'pg_catalog' AND nspname !~ '^pg_(toast|temp)_'
        AND has_schema_privilege('teren',oid,'USAGE'))
      IS DISTINCT FROM ARRAY['information_schema','net','public']::text[] THEN
    v:=array_append(v,'teren scheme USAGE'); END IF;
  FOR r IN SELECT * FROM public.portal_public_baseline WHERE semnatura NOT LIKE 'rel:%' LOOP
    IF r.amprenta IS DISTINCT FROM (SELECT jsonb_build_array(md5(pg_get_functiondef(p.oid)),
        p.prosecdef,p.proowner,p.proconfig,p.proacl) FROM pg_proc p WHERE p.oid=to_regprocedure(r.semnatura)) THEN
      v:=array_append(v,'amprenta:'||r.semnatura); END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.portal_public_baseline WHERE semnatura LIKE 'rel:%' LOOP
    IF r.amprenta IS DISTINCT FROM public.fn_portal_catalog_amprenta(to_regclass(substr(r.semnatura,5))) THEN
      v:=array_append(v,'amprenta:'||r.semnatura); END IF;
  END LOOP;
  FOR r IN SELECT c.oid,c.relkind,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
      AND has_schema_privilege('teren',n.oid,'USAGE') AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.oid LOOP
    -- r21: orice drept al lui teren (tabel / coloane / secventa) = fn_portal_teren_rel_drept (aceeasi definitie in $public_pre$).
    CONTINUE WHEN public.fn_portal_teren_rel_drept(r.oid) IS NOT TRUE;
    -- r21 (varianta c): cele trei obiecte pg_net revizuite trec DOAR cu amprenta identica celei din productie; orice drept
    -- nou, coloana noua, alt proprietar sau alt obiect din net ramane poarta rosie (relatie: / secventa:).
    CONTINUE WHEN r.nspname='net' AND public.fn_portal_net_rel_acceptat(r.oid) IS TRUE;
    IF r.relkind='S' THEN
      v:=array_append(v,'secventa:'||r.relname);
    -- Catalogul standard permite doar SELECT-ul fixat la apply, fara DML/DDL sau granturi pe coloane noi.
    ELSIF r.nspname <> 'information_schema' OR r.oid >= 16384
      OR has_table_privilege('teren',r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('teren',r.oid,'INSERT,UPDATE,REFERENCES')
      OR NOT EXISTS (SELECT FROM public.portal_public_baseline b
        WHERE b.semnatura='rel:information_schema.'||quote_ident(r.relname)
        AND b.amprenta=public.fn_portal_catalog_amprenta(r.oid)) THEN
      v:=array_append(v,'relatie:'||r.relname);
    END IF;
  END LOOP;
  -- r21: teren ajunge la net doar daca un client poate rula SQL in net. Din baza se poate verifica doar configurarea
  -- PostgREST scrisa IN baza (setarile rolului authenticator); cea din panoul proiectului se verifica separat
  -- (scripts/portal/scheme_expuse.sh). net in schemele expuse / in search_path-ul suplimentar = poarta rosie.
  IF EXISTS (SELECT FROM pg_catalog.pg_db_role_setting rs CROSS JOIN LATERAL unnest(rs.setconfig) AS s(cfg)
      WHERE rs.setrole IN (SELECT oid FROM pg_roles WHERE rolname IN ('authenticator','teren'))
        -- `_` din LIKE prinde orice caracter: potrivire mai larga = mai stricta (fara backslash, cerut de validatorul livrarii)
        AND (s.cfg LIKE 'pgrst.db_schemas=%' OR s.cfg LIKE 'pgrst.db_extra_search_path=%')
        AND 'net' = ANY (string_to_array(replace(replace(substr(s.cfg, strpos(s.cfg, '=') + 1), ' ', ''), '"', ''), ','))) THEN
    v:=array_append(v,'teren PostgREST expune net'); END IF;
  FOR r IN SELECT p.oid,p.proname,p.proargtypes,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_'
      AND has_schema_privilege('teren',n.oid,'USAGE') AND has_function_privilege('teren',p.oid,'EXECUTE') ORDER BY p.oid LOOP
    -- Semnatura canonica: schema + nume + tipuri (fara numele argumentelor).
    v_signature := quote_ident(r.nspname) || '.' || quote_ident(r.proname) || '(' || oidvectortypes(r.proargtypes) || ')';
    IF v_signature NOT IN ('public.fn_teren_eligibil(uuid)','public.fn_portal_uid()')
      AND NOT EXISTS (SELECT FROM public.portal_public_baseline WHERE semnatura=v_signature) THEN
      v:=array_append(v,'functie:'||v_signature);
    END IF;
  END LOOP;
  IF EXISTS (SELECT id FROM auth.users EXCEPT SELECT auth_user_id FROM public.conturi_tip)
    OR EXISTS (SELECT auth_user_id FROM public.conturi_tip EXCEPT SELECT id FROM auth.users) THEN
    v:=array_append(v,'inventar identitati'); END IF;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.fn_portal_porti_lipsa() TO postgres;

DO $public_pre$
DECLARE v_live text[]; r record;
  -- Jakarinos r6 P2: owner-ul functiilor net din inventarul prod (sectiunea 2), verificat inainte de baseline.
  c_net_owner CONSTANT text := 'supabase_admin';
BEGIN
  SELECT coalesce(array_agg('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')'
    ORDER BY ('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')') COLLATE "C"),'{}')
    INTO v_live FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE');
  IF cardinality(public.fn_portal_public_aprobat()) <> 21
    OR v_live IS DISTINCT FROM public.fn_portal_public_aprobat() THEN
    RAISE EXCEPTION 'PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED';
  END IF;
  FOR r IN SELECT key,value FROM jsonb_each_text(public.fn_portal_public_md5()) LOOP
    IF r.value IS DISTINCT FROM (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
      WHERE p.oid=to_regprocedure(r.key) AND p.proowner='postgres'::regrole) THEN
      RAISE EXCEPTION 'PORTAL_PUBLIC_BASELINE_UNREVIEWED_OR_CHANGED'; END IF;
  END LOOP;
  -- net: setul live executabil de teren = exact cheile revizuite (ambele directii), fara DEFINER, corp identic.
  -- Corp schimbat inainte de apply (aceeasi semnatura, acelasi numar) = refuz.
  IF public.fn_portal_net_md5() = '{}'::jsonb
    OR (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),'{}') FROM jsonb_object_keys(public.fn_portal_net_md5()) k)
      IS DISTINCT FROM (SELECT coalesce(array_agg(x.s ORDER BY x.s COLLATE "C"),'{}') FROM (
        SELECT quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')' AS s
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='net' AND has_function_privilege('teren',p.oid,'EXECUTE')) x)
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='net' AND p.prosecdef AND has_function_privilege('teren',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED'; END IF;
  FOR r IN SELECT key,value FROM jsonb_each_text(public.fn_portal_net_md5()) LOOP
    IF r.value IS DISTINCT FROM (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p
      WHERE p.oid=to_regprocedure(r.key) AND pg_get_userbyid(p.proowner)=c_net_owner) THEN
      RAISE EXCEPTION 'PORTAL_NET_BASELINE_UNREVIEWED_OR_CHANGED'; END IF;
  END LOOP;
  -- r21 (varianta c): lista obiectelor pg_net acceptate are forma ceruta (cheie net.<nume>, md5), iar orice relatie /
  -- secventa din net la care ajunge teren e in lista, cu amprenta identica (acelasi predicat ca poarta). Un obiect din
  -- lista la care teren nu mai ajunge (drepturi retrase) nu e o abatere: e raportat, nu refuzat.
  IF jsonb_typeof(public.fn_portal_net_rel_aprobat()) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT FROM jsonb_each(public.fn_portal_net_rel_aprobat()) e
      WHERE e.key !~ '^net[.][a-z_][a-z0-9_]*$' OR jsonb_typeof(e.value) IS DISTINCT FROM 'string'
        OR e.value #>> '{}' !~ '^[0-9a-f]{32}$') THEN
    RAISE EXCEPTION 'PORTAL_NET_REL_LIST_INVALID'; END IF;
  SELECT coalesce(array_agg(quote_ident(n.nspname)||'.'||quote_ident(c.relname) ORDER BY c.relname COLLATE "C"),'{}')
    INTO v_live FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='net' AND c.relkind IN ('r','p','v','m','f','S')
      AND public.fn_portal_teren_rel_drept(c.oid) IS TRUE AND public.fn_portal_net_rel_acceptat(c.oid) IS NOT TRUE;
  IF cardinality(v_live) > 0 THEN
    RAISE EXCEPTION 'PORTAL_NET_REL_UNREVIEWED_OR_CHANGED: %', array_to_string(v_live, ', '); END IF;
  RAISE NOTICE 'PORTAL_NET_REL: % obiecte pg_net accesibile prin PUBLIC, toate cu amprenta revizuita (% in lista)',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='net' AND c.relkind IN ('r','p','v','m','f','S') AND public.fn_portal_teren_rel_drept(c.oid) IS TRUE),
    (SELECT count(*) FROM jsonb_object_keys(public.fn_portal_net_rel_aprobat()));
END $public_pre$;
ALTER TABLE public.portal_public_baseline DISABLE TRIGGER portal_public_baseline_imuabil;
INSERT INTO public.portal_public_baseline
SELECT quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')',
 jsonb_build_array(md5(pg_get_functiondef(p.oid)),p.prosecdef,p.proowner,p.proconfig,p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND ('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')')
 = ANY(public.fn_portal_public_aprobat())) OR (n.nspname='net' AND has_function_privilege('teren',p.oid,'EXECUTE'))
 OR (n.nspname='information_schema' AND p.oid<16384 AND NOT p.prosecdef AND p.proowner=n.nspowner AND has_function_privilege('teren',p.oid,'EXECUTE'));
INSERT INTO public.portal_public_baseline
SELECT 'rel:information_schema.'||quote_ident(c.relname),public.fn_portal_catalog_amprenta(c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='information_schema' AND c.oid<16384 AND c.relkind IN ('r','v')
 AND has_table_privilege('teren',c.oid,'SELECT')
 AND NOT has_table_privilege('teren',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_any_column_privilege('teren',c.oid,'INSERT,UPDATE,REFERENCES');
ALTER TABLE public.portal_public_baseline ENABLE TRIGGER portal_public_baseline_imuabil;

-- Tabelele portalului. r10: create INAINTEA lock-urilor, FARA FK (FK-urile spre auth.users / employees se adauga in
-- $critic$, sub lock-urile deja detinute; numele lor = numele generate automat in r9, aceeasi definitie in catalog).
CREATE TABLE public.conturi_tip (
  auth_user_id uuid PRIMARY KEY,
  tip text NOT NULL CHECK (tip IN ('erp','teren','neaprobat')),
  sursa text NOT NULL CHECK (sursa ~ '[^[:space:]]'),
  clasificat_de uuid,
  clasificat_la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.conturi_teren (
  auth_user_id uuid PRIMARY KEY,
  employee_id integer UNIQUE,
  stare text NOT NULL CHECK (stare IN ('in_creare','activ','revocat'))
);
CREATE TABLE public.conturi_tip_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  operatie text NOT NULL CHECK (operatie IN ('INSERT','UPDATE','DELETE')),
  vechi jsonb, nou jsonb,
  autor uuid, rol_sesiune text NOT NULL,
  la timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.conturi_tip ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conturi_teren ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conturi_tip_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conturi_tip, public.conturi_teren, public.conturi_tip_jurnal
  FROM PUBLIC, anon, authenticated, service_role, teren;
REVOKE ALL ON SEQUENCE public.conturi_tip_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role, teren;
GRANT SELECT ON public.conturi_tip TO supabase_auth_admin;
CREATE POLICY conturi_tip_hook ON public.conturi_tip FOR SELECT TO supabase_auth_admin
  USING (auth_user_id IS NOT NULL);
CREATE TRIGGER conturi_tip_audit AFTER INSERT OR UPDATE OR DELETE ON public.conturi_tip
  FOR EACH ROW EXECUTE FUNCTION public.fn_conturi_tip_audit();
CREATE TRIGGER conturi_jurnal_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.conturi_tip_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
CREATE TRIGGER conturi_tip_no_truncate BEFORE TRUNCATE ON public.conturi_tip
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();

-- r3 (Copilot r2 P1-01): 'erp' DOAR pentru conturile aprobate explicit de owner. Legarea de fisa, is_owner sau un
-- drept pe modul NU sunt dovada de aprobare. Lista = sha256 (hex) pe auth.users.id::text, revizuita de Razvan din
-- raportul INTERN al inventarului read-only si fixata aici inainte de DRY (fara UUID-uri / emailuri in repo).
-- Refuz atomic: lista goala, element invalid / duplicat / fara cont, cont teren in lista, owner care lipseste din lista.
-- Restul conturilor (nelistate) devin 'neaprobat': hook-ul le refuza tokenul pana la fn_cont_aproba_erp (E1-1b).
CREATE TEMP TABLE portal_erp_aprobat ON COMMIT DROP AS
SELECT ARRAY[
 -- PORTAL_ERP_APROBAT: 27 de conturi aprobate de Razvan (10.11.2026), sha256 pe auth.users.id::text
 '0ce4144f7ee4572cd7cb38d32f87b9e4a575738b73bf9466353670ed2d4a65be',
 '138efd36fedb66f5040b5a54f1d7b492b27fe2b8f3818ae183c0c3b6080af227',
 '13d08d44a58788d1a406d0135f907e17efdc801cac015fbc33aca6a581a8154b',
 '2acf802f3755b947926ac6d75b8ae451a16a226f3369edf3255c2c912ea455c5',
 '3ad1a281d356ec32628ff80291dfe0d3465417d4fb52a8e4271a842a35853fac',
 '3dcf115fa42c1a35870ed487704582be0c9094000fbdd9b85419199127eeed2e',
 '478f9e58eb2ce2558657ca535d47b47b9df5daceb6650c7d636c2fc1cb0cf96b',
 '526bc58552e13673a222631cdc54c9359815311a5c4fef25f07c4957b9aa707e',
 '5a95306ec8a882b8ce3fedbbe154511968a4dd124ea54592704966b844a66323',
 '5f0c44deafd2f47a4f48543b868288e14b51aa0e04dff3b9ad3941b2af4aba8b',
 '60fe5828bbe4c229d94e2e5885b42cf2ae814a3d6d0b2461fc4261ce839f786c',
 '65344e1032f8ce2f1db85a1c7884e0154da3a4fa79a351706eb5dc6ffd709725',
 '6c0dd400c3072fd601515bf3f7082397357f8dc59a8e7e302b4f162b27a4bb3d',
 '74dddf433baf99853f64e39d02d3d40fbb5b1edffd54d06dc9faece28c50d048',
 '86aecaa98b67c927afc8a58588c8eed5ce96ae1bc963b288fe4459fae5cb2a3a',
 '8b1d6d039c7b5b27d46c4abea0055418ba50bb691fe958c8c4c969db2dfe0b53',
 'a5282f3232c393dbf07154a61332e438f69abacfd8064e3ba86e56ca18369f1d',
 'afba179bfb883cd24a9524037d831b4328d3daf1d543ce396ba4a0bdec925f92',
 'b7aa077f653114adc0da9e5e985eadac7f7eea1a267d1b3239e99f9d56949218',
 'c9a855879016763e4b24e5085bc1ce1287aafd92faf661916b7a3693017fe874',
 'ca4cdbb02ad22d00ecf943046b63691f99ed371726c9ee602b8c40de49d32c0a',
 'de6b81c11146ba6df3aed5c9ddca0296e6b6e9dafb637a09a5d833fbdac79cfa',
 'dfc4e7f03b195d3680184c38357ff5b8dcd9f17140819378a0b48df723907332',
 'e3dad4ab8ec503e7c6954b29244feab696f887a31b4373006f13095814ec27a8',
 'e8d08137ed8bf7a4f117fb155b041bd46525299e56175c28aa9e7156910f6f2a',
 'ebafb7d510795a0d106b7214590447174208aa4d5ccff3fc431f4b8d8d737b36',
 'fbf7611fcaf1ec82e8abc9750ea3a8db7e4d779d8d5ad1662ddca5534351081d'
]::text[] AS lista;
-- r9 (decizia lui Razvan, 11.11.2026): conturile teren existente (create pe 27.10) se identifica prin sha256 pe
-- auth.users.id::text, ca lista ERP: fara adrese in repo. Valorile vin din inventarul read-only de pe prod (27.10):
-- doua conturi legate de fisele 55 si 70 + contul de test fara fisa. Orice alt cont pe domeniul teren = refuz.
CREATE TEMP TABLE portal_teren_aprobat ON COMMIT DROP AS
SELECT h,employee_id FROM (VALUES
 -- PORTAL_TEREN_APROBAT: sha256 pe auth.users.id::text -> employee_id (NULL = contul de test, fara fisa)
 ('d079d33f9dc730e243177bdfd52c6d1ee1d63a3ed5a2609538b5d9cb33b76a64',55),
 ('c36b1bcea80191ee714eea65d1556044d308bf56a85bfe03b52b8b0832c191f5',70),
 ('ef995b5c2b4f4de077db9103bdf5443a40247ac21ff9b519ba61faebf22d736a',NULL::integer)
) v(h,employee_id);

-- r10: verificarile de FORMAT ale listelor (doar tabelele temporare) inaintea lock-urilor; cele pe date, in $critic$.
DO $liste_pre$
DECLARE v text[];
BEGIN
  IF (SELECT count(*) FROM pg_temp.portal_teren_aprobat) <> 3
    OR (SELECT count(DISTINCT h) FROM pg_temp.portal_teren_aprobat) <> 3
    OR EXISTS (SELECT FROM pg_temp.portal_teren_aprobat WHERE h IS NULL OR h !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'PORTAL_TERRAIN_INVENTORY_CHANGED';
  END IF;
  SELECT lista INTO STRICT v FROM pg_temp.portal_erp_aprobat;
  IF v IS NULL OR cardinality(v) = 0 THEN RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_LIST_MISSING'; END IF;
  IF EXISTS (SELECT FROM unnest(v) h WHERE h IS NULL OR h !~ '^[0-9a-f]{64}$')
    OR cardinality(v) <> (SELECT count(DISTINCT h) FROM unnest(v) h) THEN
    RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_LIST_INVALID'; END IF;
END $liste_pre$;

-- r9 (P1-01) / r10: PUNCTUL UNIC de lock pe tabelele folosite de utilizatori. Inainte de el nu s-a atins niciun tabel
-- existent (doar catalogul si obiectele noi; corpurile care le citesc sunt plpgsql, neanalizate la creare).
-- NOWAIT + reincercare la 50 ms, cel mult 3 s: cat timp incearca, aplicarea NU sta in coada lock-ului (login-urile si
-- citirile ERP nu se aseaza in spatele ei); o incercare ratata elibereaza tot ce luase (subtranzactie). Peste buget:
-- 55P03 PORTAL_LOCK_BUDGET, tranzactia se anuleaza, nimic schimbat. Ordinea: auth.users -> employees -> profiles.
--  * auth.users  SHARE ROW EXCLUSIVE: cerut oricum de FK-urile conturi_* -> auth.users (ADD FOREIGN KEY); tine setul de
--    conturi fix pana la commit. Blocheaza: scrierile Auth (actualizarea la login, conturi noi, ban). Nu citirile.
--  * employees   SHARE ROW EXCLUSIVE: cerut de FK-ul conturi_teren -> employees. Blocheaza: editarile HR. Nu citirile.
--  * profiles    SHARE: legatura fisa / is_owner nu se schimba intre verificare si clasificare. Blocheaza: scrierile in
--    profiles (editari Admin, conturi noi). Nu blocheaza citirile ERP.
-- PLAFONUL (r12, forma r14): ceasul pornit la BEGIN cu 2000, pus de runner ca SET de sesiune inainte de BEGIN (verificat
-- in $pre$: 2000/session + marcaj); aici NU se schimba niciun timeout (proba r11 "mostenit": un ceas pornit nu se
-- reporneste in mijlocul tranzactiei). CE PLAFONEAZA: de la BEGIN PANA LA INTRAREA IN COMMIT trec aproximativ 2 s
-- (timeout PostgreSQL, nu timp real strict) - pregatirea de mai sus, asteptarea lock-urilor, $critic$, inregistrarea si
-- garda finala a runnerului, cat asteapta clientul / reteaua intre instructiuni (si intre $locks$ si $critic$); altfel
-- serverul termina sesiunea (FATAL, idle sau activa) => ROLLBACK la tot, lock-urile eliberate. Lock-urile, luate dupa
-- BEGIN, sunt deci tinute aproximativ 2 s cel mult pana la intrarea in COMMIT.
-- Reincercarea NOWAIT: pana la 1 s de la BEGIN (now() = inceputul tranzactiei), ca sa ramana timp pentru $critic$.
-- CE NU PLAFONEAZA (r11, neschimbat): COMMIT-ul propriu-zis. PG17 dezactiveaza ceasul de tranzactie la intrarea in COMMIT,
-- iar lock-urile se elibereaza dupa scrierea commit-ului. COMMIT-ul adauga: constrangerile amanate (niciuna aici: fara
-- DEFERRABLE), flush-ul WAL (de regula milisecunde) si, numai daca serverul are replicare sincrona, asteptarea standby-ului
-- (nelimitata de orice timeout; proba lock_commit_lent). Dupa $locks$ ramane exact o instructiune: $critic$.
DO $locks$
DECLARE v_n integer := 0;
BEGIN
  LOOP
    v_n := v_n + 1;
    BEGIN
      LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.profiles IN SHARE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION 'PORTAL_LOCK_BUDGET: auth.users / employees / profiles ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE 'PORTAL_LOCKS 18a: % incercari, lock-uri la % ms de la BEGIN; plafon 2 s de la BEGIN pana la intrarea in COMMIT', v_n,
    round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $locks$;
-- r10: sectiunea critica = O SINGURA instructiune (un singur drum dus-intors client-server), toata sub plafon.
DO $critic$
DECLARE v text[]; v_count bigint; v_erp bigint; v_snapshot jsonb; v_porti text[];
BEGIN
  -- 1. FK-urile tabelelor noi (goale): SHARE ROW EXCLUSIVE pe auth.users / employees, deja detinut.
  ALTER TABLE public.conturi_tip ADD CONSTRAINT conturi_tip_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  ALTER TABLE public.conturi_teren
    ADD CONSTRAINT conturi_teren_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    ADD CONSTRAINT conturi_teren_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);
  -- 2. inventarul teren, pe date (sub lock)
  IF (SELECT count(*) FROM auth.users u JOIN pg_temp.portal_teren_aprobat t
      ON t.h=encode(sha256(convert_to(u.id::text,'UTF8')),'hex')
      WHERE lower(split_part(u.email,'@',2))='teren.gazpet.ro') <> 3
    -- niciun alt cont pe domeniul teren
    OR EXISTS (SELECT FROM auth.users u WHERE lower(split_part(u.email,'@',2))='teren.gazpet.ro'
      AND NOT EXISTS (SELECT FROM pg_temp.portal_teren_aprobat t
        WHERE t.h=encode(sha256(convert_to(u.id::text,'UTF8')),'hex')))
    -- profilul fiecaruia exista si e legat exact de fisa revizuita
    OR EXISTS (SELECT FROM pg_temp.portal_teren_aprobat t
      LEFT JOIN auth.users u ON t.h=encode(sha256(convert_to(u.id::text,'UTF8')),'hex')
      LEFT JOIN public.profiles p ON p.id=u.id
      WHERE p.id IS NULL OR p.employee_id IS DISTINCT FROM t.employee_id) THEN
    RAISE EXCEPTION 'PORTAL_TERRAIN_INVENTORY_CHANGED';
  END IF;
  -- 3. lista ERP fata de conturile reale (formatul s-a verificat in $liste_pre$)
  SELECT lista INTO STRICT v FROM pg_temp.portal_erp_aprobat;
  IF EXISTS (SELECT FROM unnest(v) h WHERE NOT EXISTS (SELECT FROM auth.users u
      WHERE encode(sha256(convert_to(u.id::text,'UTF8')),'hex')=h)) THEN
    RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_LIST_CHANGED'; END IF;
  IF EXISTS (SELECT FROM auth.users u WHERE encode(sha256(convert_to(u.id::text,'UTF8')),'hex')=ANY(v)
      AND (lower(split_part(u.email,'@',2))='teren.gazpet.ro' OR u.raw_app_meta_data->>'tip_cont'='teren')) THEN
    RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_LIST_INVALID'; END IF;
  IF NOT EXISTS (SELECT FROM public.profiles p WHERE p.is_owner IS TRUE)
    OR EXISTS (SELECT FROM public.profiles p WHERE p.is_owner IS TRUE
      AND encode(sha256(convert_to(p.id::text,'UTF8')),'hex') <> ALL(v)) THEN
    RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_OWNER_MISSING'; END IF;
  -- 4. clasificarea: setul complet se recalculeaza sub lock, fara numar/UUID-uri ERP hardcodate.
  INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)
SELECT id,CASE WHEN EXISTS (SELECT FROM pg_temp.portal_teren_aprobat t
   WHERE t.h=encode(sha256(convert_to(u.id::text,'UTF8')),'hex')) THEN 'teren'
 -- EXISTS + ANY(coloana array): `= ANY((SELECT lista ...))` ar fi forma ANY(subinterogare) = text = text[] (Jakarinos r3).
 WHEN EXISTS (SELECT FROM pg_temp.portal_erp_aprobat a
   WHERE encode(sha256(convert_to(u.id::text,'UTF8')),'hex')=ANY(a.lista)) THEN 'erp'
 ELSE 'neaprobat' END,'inventar_e1_1a_r3' FROM auth.users u;
  SELECT count(*) FILTER (WHERE tip='neaprobat'),count(*) FILTER (WHERE tip='erp') INTO v_count,v_erp FROM public.conturi_tip;
  -- Fiecare hash aprobat a clasificat exact un cont.
  IF v_erp <> cardinality(v) THEN RAISE EXCEPTION 'PORTAL_ERP_APPROVAL_LIST_CHANGED'; END IF;
  RAISE NOTICE 'PORTAL_ERP: %, PORTAL_NEAPROBATE: %',v_erp,v_count;
  INSERT INTO public.conturi_teren(auth_user_id,employee_id,stare)
  SELECT t.auth_user_id,p.employee_id,'activ' FROM public.conturi_tip t
    JOIN public.profiles p ON p.id=t.auth_user_id WHERE t.tip='teren';
  -- 5. postconditia (poarta completa) si amprenta pentru revenire
  v_porti := public.fn_portal_porti_lipsa();
  IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED: % porti: %', coalesce(cardinality(v_porti)::text, 'NECUNOSCUT'), coalesce(array_to_string(v_porti, '; '), 'NECUNOSCUT'); END IF;
  SELECT jsonb_build_object(
    'tip',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_tip t),
    'teren',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]') FROM public.conturi_teren t),
    'jurnal',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.conturi_tip_jurnal t),
    'baseline',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY semnatura),'[]') FROM public.portal_public_baseline b),
    'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
      SELECT 'f:'||p.oid AS cheie,jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) AS obj
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('fn_auth_token_hook','fn_teren_eligibil','fn_portal_porti_lipsa',
        'fn_portal_public_aprobat','fn_portal_public_md5','fn_portal_net_md5','fn_portal_catalog_amprenta','fn_conturi_tip_audit','fn_conturi_jurnal_imuabil','fn_portal_uid',
        'fn_portal_net_rel_aprobat','fn_portal_net_rel_amprenta','fn_portal_net_rel_acceptat','fn_portal_teren_rel_drept')
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
  EXECUTE format('COMMENT ON TABLE public.conturi_tip IS %L',v_snapshot::text);
END $critic$;
