-- E1-1b. O singura tranzactie: exclusiv scripts/livrare_migrare.sh.
-- Nu activeaza hook-ul Auth, nu modifica inventarul legacy.
-- r3 (09.11.2026): amprenta si poarta 1b pe lista alba (fn_portal_1b_snapshot); vezi comentariul de acolo.
-- r7 (10.11.2026): ancorele revizuite ale obiectelor externe (scripts/portal/ancore_1b.sql) inainte de apply.
-- r21 (12.11.2026, varianta c in 18a): fn_portal_1b_snapshot amprenteaza si cei 4 helperi noi ai portii 18a; postconditia
--  1b spune CE porti lipsesc (PORTAL_1B_POSTCONDITION: <n> porti: <lista>).
-- r9 (11.11.2026, al doilea recenzent r8 P1-01 / P2-01 / P2-03):
--  * buget de lock: lock_timeout / statement_timeout; tot ce nu cere lock pe tabelele utilizatorilor (ancore, tabele si
--    functii noi) ruleaza INAINTE; lock-urile pe auth.users / employees / profiles / user_module_access se iau o singura
--    data, la final ($locks$, NOWAIT + reincercare 3 s, peste buget = 55P03, nimic schimbat). Dupa ele: doar CHECK-ul pe
--    profiles, FK-urile, triggerul pe employees, handle_new_user si poarta finala. employees nu mai e ACCESS EXCLUSIVE
--    (citirile HR nu se blocheaza); profiles ACCESS EXCLUSIVE doar pe coada (cerut de ALTER ... CHECK);
--  * cont nou dupa 19a: handle_new_user scrie si clasificarea 'neaprobat' in conturi_tip (inventar Auth complet);
--  * preflight de drepturi ($priv$) inaintea oricarei schimbari.
-- r10 (11.11.2026, al doilea recenzent r9 P1-01 / P2-01 + Jakarinos r9 P2):
--  * timeout-urile sunt PRIMELE instructiuni; lock-ul consultativ se ia cu pg_try_advisory_xact_lock + refuz;
--  * inainte de $locks$ nu se atinge niciun tabel existent (nici al utilizatorilor, nici conturi_* din 18a): functiile
--    care citesc tabelele utilizatorilor sunt plpgsql (corpul nu se analizeaza la creare => niciun ACCESS SHARE implicit),
--    handle_new_user si fn_teren_eligibil se inlocuiesc tot inainte (vizibile altor sesiuni abia la COMMIT, atomic cu
--    CHECK-ul nou); lock-urile pe conturi_* (cascada din auth.users) s-au mutat in $locks$;
--  * dupa $locks$ ramane O SINGURA instructiune ($critic$);
--    [plafonul r10 / r11 "2 s de la obtinerea lock-urilor" e INFIRMAT de harness-ul PG17 real si inlocuit in r12]
--  * fereastra 18a -> 19a (P2-01): conturile aparute intre cele doua livrari (handle_new_user vechi nu le clasifica) se
--    clasifica explicit 'neaprobat' in $critic$, sub lock-ul pe auth.users; un cont teren neclasificat = refuz.
-- r12 (harness-ul PG17 real, proba "mostenit" r11; aceeasi solutie ca 18a): un ceas de tranzactie deja pornit nu se
-- reporneste in mijlocul tranzactiei, deci fisierul NU schimba niciun timeout dupa $pre$. PLAFONUL = ceasul pornit de
-- PostgreSQL la BEGIN cu valoarea pusa de runner (livrare_migrare.sh --plafon-tranzactie-ms 2000, PR #1054).
-- r14 (aceeasi solutie ca 18a, vezi antetul de acolo): pooler-ul de productie nu transmite optiunile de conectare =>
-- runnerul pune plafonul ca SET de SESIUNE inainte de BEGIN; $pre$ cere exact 2000/session din vederea de setari
-- calificata cu pg_catalog (fara umbrire prin pg_temp) + marcajul plafonului pus de prologul runnerului. GARANTIA: aproximativ 2 s de la
-- BEGIN (deci si de la primul lock) PANA LA INTRAREA IN COMMIT, altfel ROLLBACK la tot (pregatirea e in aceeasi
-- tranzactie); timeout PostgreSQL, nu timp real strict. COMMIT-ul propriu-zis ramane neplafonat (limita r11; pe productie,
-- fara replicare sincrona, = scrierea WAL a commit-ului). Reincercarea lock-urilor: pana la 1 s de la BEGIN.
-- Nota (P2, al doilea recenzent r13): atomicitatea e completa pentru schema si datele comise, nu si pentru secvente: daca
-- reconcilierea din $critic$ insereaza in conturi_tip, triggerul de audit consuma valori din secventa EXISTENTA
-- conturi_tip_jurnal_id_seq (din 18a); un refuz ulterior anuleaza randurile si schema, dar poate lasa GOLURI in secventa.
-- Nu e pierdere de date (id-urile jurnalului nu au voie sa fie consecutive; nimic nu se bazeaza pe asta).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $pre$
DECLARE v_plafon text;
BEGIN
 IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare',true)
   IS DISTINCT FROM '20261119a_portal_teren_provisioning:'||txid_current() THEN
   RAISE EXCEPTION 'PORTAL_RUNNER_REQUIRED'; END IF;
 IF current_setting('transaction_isolation') <> 'read committed' THEN
   RAISE EXCEPTION 'PORTAL_READ_COMMITTED_REQUIRED'; END IF;
 IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'; END IF;
 -- r14: plafonul pus de runner ca SET de sesiune inainte de BEGIN (2000/session, citit calificat) + marcajul prologului.
 SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
 IF v_plafon IS DISTINCT FROM '2000/session'
   OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
   RAISE EXCEPTION 'PORTAL_PLAFON_TRANZACTIE_REQUIRED: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
     coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa'); END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('gazpet.livrare_migrare')) THEN
   RAISE EXCEPTION 'PORTAL_DELIVERY_BUSY' USING ERRCODE = '55P03'; END IF;
END $pre$;
SET LOCAL search_path = public, pg_temp;
-- r9 (P2-03): drepturile de care are nevoie postgres NOSUPERUSER, inaintea oricarei schimbari, cate unul pe rand.
-- REFERENCES pentru FK-urile noi, TRIGGER pe employees, proprietar pe profiles (ALTER ... CHECK) si pe functiile
-- inlocuite, LOCK in alt mod decat ACCESS SHARE = UPDATE / DELETE / TRUNCATE / MAINTAIN (PG17).
DO $priv$
DECLARE v text[] := '{}'; t text;
BEGIN
  IF NOT has_schema_privilege('public','CREATE') THEN v:=array_append(v,'CREATE pe schema public'); END IF;
  IF NOT has_schema_privilege('auth','USAGE') THEN v:=array_append(v,'USAGE pe schema auth'); END IF;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees'] LOOP
    IF NOT has_table_privilege(t,'REFERENCES') THEN v:=array_append(v,'REFERENCES pe '||t); END IF;
  END LOOP;
  IF NOT has_table_privilege('public.employees','TRIGGER') THEN v:=array_append(v,'TRIGGER pe public.employees'); END IF;
  IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='public.profiles'::regclass),'USAGE') THEN
    v:=array_append(v,'proprietar pe public.profiles'); END IF;
  IF EXISTS (SELECT FROM pg_proc p WHERE p.oid IN ('public.handle_new_user()'::regprocedure,
      'public.fn_teren_eligibil(uuid)'::regprocedure) AND NOT pg_has_role(current_user,p.proowner,'USAGE')) THEN
    v:=array_append(v,'proprietar pe handle_new_user / fn_teren_eligibil'); END IF;
  FOREACH t IN ARRAY ARRAY['auth.users','public.employees','public.profiles','public.user_module_access'] LOOP
    IF NOT has_table_privilege(t,'SELECT') THEN v:=array_append(v,'SELECT pe '||t); END IF;
    IF NOT (has_table_privilege(t,'UPDATE') OR has_table_privilege(t,'DELETE') OR has_table_privilege(t,'TRUNCATE')
      OR has_table_privilege(t,CASE WHEN current_setting('server_version_num')::int >= 170000 THEN 'MAINTAIN' ELSE 'UPDATE' END)) THEN
      v:=array_append(v,'LOCK (UPDATE/DELETE/TRUNCATE/MAINTAIN) pe '||t); END IF;
  END LOOP;
  IF cardinality(v) > 0 THEN
    RAISE EXCEPTION 'PORTAL_PRIVILEGES_MISSING: %', array_to_string(v,'; '); END IF;
END $priv$;
-- r10: tabelele portalului din 18a (conturi_tip / conturi_teren / jurnalul) se blocheaza abia in $locks$, dupa tabelele
-- utilizatorilor (aceeasi ordine ca stergerea unui cont: auth.users -> conturi_*, in cascada).
-- Jakarinos r6 P1: callee-urile EXTERNE din lista alba 1b si triggerele de pe auth.users / profiles / notifications
-- (definitie, owner, DEFINER, config, ACL; triggere: activare, definitie, functie) se compara cu valorile revizuite
-- din inventarul read-only pe prod (sectiunea 9 = scripts/portal/ancore_1b.sql), INAINTE de apply si inca o data la
-- final, inaintea fixarii amprentei: nimic din afara portalului nu intra nerevizuit in baseline. Gol / diferit = refuz.
-- r8 (11.11.2026): valoarea rulata read-only pe prod de chat (scripts/portal/ancore_1b.sql la c0e22df7, 11.11.2026),
-- dupa aplicarea 20261203a-20261208b si 20261211a; 16 functii (10 numite + 6 ale triggerelor), 7 triggere.
CREATE TEMP TABLE portal_1b_ancore_revizuit ON COMMIT DROP AS
SELECT '{"functii":{"auth.jwt()":["a1d279af3fcb9a5b722a51e0e4fac2ed","supabase_admin",false,null,["=X/supabase_admin","supabase_admin=X/supabase_admin"]],"auth.uid()":["be88fac9f85df6eed53838367e4beac8","supabase_admin",false,null,["=X/supabase_admin","supabase_admin=X/supabase_admin"]],"public.fn_cont_candidati_angajat(text)":["4d8c0c315b31befe374cd10e6dc3903d","postgres",false,["search_path=public, pg_temp"],["postgres=X/postgres"]],"public.fn_cont_notifica_owneri(text, text, text, text)":["2f00c876005ff9cfe5a4d03aee77bbce","postgres",false,["search_path=public, pg_temp"],["postgres=X/postgres"]],"public.fn_identitate_claims()":["0c7e2da16a7d3613d1fc05ddde480c37","postgres",false,["search_path=public, pg_temp"],["postgres=X/postgres"]],"public.fn_identitate_privilegiata()":["1579fcc114dee8ba6324e578a6c7da40","postgres",false,["search_path=public, pg_temp"],["postgres=X/postgres"]],"public.fn_notificari_ruteaza_ofertare()":["4b4e44eed63b27c51dad632cb3443d8e","postgres",true,["search_path=public, pg_temp"],["postgres=X/postgres"]],"public.fn_profiles_protectie_legatura()":["182365d0edb0614648b45a38c5bff46e","postgres",false,["search_path=public, pg_temp"],["postgres=X/postgres"]]},"triggere":{"auth.users:on_auth_user_created":["O","786e53a33077b3a68f1ec248e238d18a","public.handle_new_user()"],"public.notifications:trg_notificari_ruteaza_ofertare":["O","feb918b53d67da664f62ab821f29df5f","public.fn_notificari_ruteaza_ofertare()"],"public.profiles:trg_profiles_protectie_legatura":["O","19d8f154a1d7dad36787d3f92f6b11a3","public.fn_profiles_protectie_legatura()"]}}'::jsonb AS v; -- PORTAL_1B_ANCORE
CREATE FUNCTION pg_temp.portal_1b_ancore() RETURNS jsonb LANGUAGE sql STABLE AS $anc$
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
$anc$;
DO $ancore_pre$
BEGIN
 IF (SELECT v FROM pg_temp.portal_1b_ancore_revizuit) = '{}'::jsonb
  OR pg_temp.portal_1b_ancore() IS DISTINCT FROM (SELECT v FROM pg_temp.portal_1b_ancore_revizuit) THEN
  RAISE EXCEPTION 'PORTAL_1B_ANCHOR_CHANGED'; END IF;
END $ancore_pre$;
CREATE TABLE public.portal_e1_1b_manifest (
 cheie text PRIMARY KEY CHECK (cheie IN ('handle_live','eligibil_live','role_live','post_snapshot')),valoare jsonb NOT NULL);
ALTER TABLE public.portal_e1_1b_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_e1_1b_manifest FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
DO $manifest$
DECLARE p record; v_expected_source text := $live_source$
DECLARE
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$live_source$;
 v_expected text; v_manifest jsonb; c record;
BEGIN
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar,l.lanname
 INTO STRICT p FROM pg_proc pr JOIN pg_language l ON l.oid=pr.prolang
 WHERE pr.oid='public.handle_new_user()'::regprocedure;
 -- Corpul este EXACT cel din live/prod_fapte_27_10.txt, nu invatat din tinta.
 -- Antetul pg_get_functiondef este formatat de versiunea PG locala; toate atributele sale sunt verificate separat.
 v_expected := replace(pg_get_functiondef(p.oid),p.prosrc,v_expected_source);
 IF p.prosrc IS DISTINCT FROM v_expected_source OR p.proprietar <> 'postgres'
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.lanname <> 'plpgsql' OR p.prorettype <> 'trigger'::regtype
  OR p.prosecdef IS NOT TRUE OR p.provolatile <> 'v' OR p.proisstrict
  OR p.proleakproof OR p.prokind <> 'f' OR p.proparallel <> 'u'
  OR sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')) IS DISTINCT FROM sha256(convert_to(v_expected,'UTF8')) THEN
  RAISE EXCEPTION 'PORTAL_HANDLE_LIVE_CHANGED'; END IF;
 v_manifest := jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,
  'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 INSERT INTO public.portal_e1_1b_manifest VALUES ('handle_live',v_manifest||jsonb_build_object(
  'sha256',encode(sha256(convert_to(v_manifest::text,'UTF8')),'hex')));
 SELECT oid,conname,pg_get_constraintdef(oid) AS def INTO STRICT c
 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_chk';
 IF c.def IS DISTINCT FROM 'CHECK ((role = ANY (ARRAY[''superadmin''::text, ''admin_logistica''::text, ''manager_santier''::text, ''sef_echipa''::text, ''contabilitate''::text, ''hr''::text, ''gestionar''::text, ''magazioner''::text])))'
 THEN RAISE EXCEPTION 'PORTAL_PROFILE_ROLES_CHANGED'; END IF;
 INSERT INTO public.portal_e1_1b_manifest VALUES ('role_live',jsonb_build_object('name',c.conname,'definition',c.def));
 -- r9: verificarea randurilor din profiles (roluri) se face sub lock, in $roles$, imediat inaintea ALTER-ului.
END $manifest$;

-- r9: FK-urile spre employees / auth.users se adauga la final, sub $locks$ (SHARE ROW EXCLUSIVE pe acestea doar pe coada).
-- Numele explicite = numele generate automat in r8 (aceeasi definitie in catalog).
CREATE TABLE public.portal_provisioning (
 provisioning_id uuid PRIMARY KEY,
 employee_id integer NOT NULL,
 email_calculat text NOT NULL UNIQUE CHECK (email_calculat ~ '^[a-z0-9]+([.][a-z0-9]+)*@teren[.]gazpet[.]ro$'),
 stare text NOT NULL CHECK (stare IN ('rezervat','creat','finalizat','anulat')),
 cerut_de uuid NOT NULL, cerut_la timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256)=32),
 auth_user_id uuid UNIQUE,
 CHECK ((stare='rezervat' AND auth_user_id IS NULL) OR stare='anulat'
   OR (stare IN ('creat','finalizat') AND auth_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX portal_provisioning_employee_deschis ON public.portal_provisioning(employee_id)
 WHERE stare IN ('rezervat','creat');
-- r10: coloanele noi pe conturi_teren (tabel din 18a) se adauga in $critic$, sub lock-ul din $locks$.
CREATE TABLE public.portal_provisioning_jurnal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tabela text NOT NULL, operatie text NOT NULL, vechi jsonb,nou jsonb,
 autor uuid,rol_sesiune text NOT NULL,la timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.portal_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_provisioning_jurnal ENABLE ROW LEVEL SECURITY;
-- Fara politici permisive si fara granturi client: numai RPC-uri DEFINER gardate.
REVOKE ALL ON public.portal_provisioning,public.portal_provisioning_jurnal
 FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
REVOKE ALL ON SEQUENCE public.portal_provisioning_jurnal_id_seq
 FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE FUNCTION public.fn_portal_provisioning_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 INSERT INTO public.portal_provisioning_jurnal(tabela,operatie,vechi,nou,autor,rol_sesiune)
 VALUES (TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,
 CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,auth.uid(),session_user);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_provisioning_audit() FROM PUBLIC,anon,authenticated,service_role,teren;
CREATE TRIGGER portal_provisioning_audit AFTER INSERT OR UPDATE OR DELETE ON public.portal_provisioning
 FOR EACH ROW EXECUTE FUNCTION public.fn_portal_provisioning_audit();
-- r10: triggerul de audit pe conturi_teren se creeaza in $critic$ (tabel din 18a).
CREATE TRIGGER portal_provisioning_jurnal_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.portal_provisioning_jurnal
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
CREATE TRIGGER portal_provisioning_no_truncate BEFORE TRUNCATE ON public.portal_provisioning
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();

-- Brief E1-1b: UPDATE termination_date=azi revoca imediat; r6 avea ultima zi inclusiva.
-- Predicat comun pentru pregatire, creare, finalizare, trigger si hook. Fisierul 18a ramane nemodificat.
-- r10 (Jakarinos r9 P2): plpgsql, nu sql: corpul unei functii sql se analizeaza la creare (check_function_bodies) si ia
-- ACCESS SHARE pe employees inainte de $locks$; corpul plpgsql se analizeaza abia la primul apel.
CREATE FUNCTION public.fn_portal_angajat_eligibil(p_employee_id integer) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 RETURN EXISTS (SELECT FROM public.employees e WHERE e.id=p_employee_id AND e.active IS TRUE
  AND (e.termination_date IS NULL OR e.termination_date > (now() AT TIME ZONE 'Europe/Bucharest')::date));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_angajat_eligibil(integer) FROM PUBLIC,anon,authenticated,service_role,teren;

DO $elig_manifest$
DECLARE p record; m jsonb;
BEGIN
 SELECT pr.*,pg_get_userbyid(pr.proowner) AS proprietar INTO STRICT p
 FROM pg_proc pr WHERE pr.oid='public.fn_teren_eligibil(uuid)'::regprocedure;
 IF NOT EXISTS (SELECT FROM jsonb_array_elements(obj_description('public.conturi_tip'::regclass,'pg_class')::jsonb->'ddl') x
  WHERE x.value=jsonb_build_array('functie',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig))
 THEN RAISE EXCEPTION 'PORTAL_ELIGIBILITY_MANIFEST_CHANGED'; END IF;
 IF p.prosrc IS DISTINCT FROM $elig_source$
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
END $elig_source$
  OR p.proprietar<>'postgres' OR p.prosecdef IS NOT TRUE
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
 THEN RAISE EXCEPTION 'PORTAL_ELIGIBILITY_BASELINE_CHANGED'; END IF;
 m:=jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proprietar,'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig));
 INSERT INTO public.portal_e1_1b_manifest VALUES('eligibil_live',m||jsonb_build_object('sha256',encode(sha256(convert_to(m::text,'UTF8')),'hex')));
END $elig_manifest$;
CREATE OR REPLACE FUNCTION public.fn_teren_eligibil(p_uid uuid) RETURNS boolean
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
    WHERE c.auth_user_id=p_uid AND c.stare='activ' AND public.fn_portal_angajat_eligibil(e.id) IS TRUE
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $fn$;

CREATE FUNCTION public.fn_portal_cont_pregateste(p_employee_id integer,p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_name text; v_parts text[]; v_base text; v_email text;
 v_i integer:=1; r public.portal_provisioning%ROWTYPE;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS (SELECT FROM public.profiles p WHERE p.id=v_uid AND
  (p.is_owner IS TRUE OR EXISTS (SELECT FROM public.user_module_access a
   WHERE a.profile_id=v_uid AND a.module='hr')))
 THEN RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 IF p_cheie IS NULL OR p_employee_id IS NULL THEN RAISE EXCEPTION 'PORTAL_INVALID_REQUEST'; END IF;
 -- Ordine: advisory email (global) -> employees -> portal_provisioning -> conturi_tip -> conturi_teren/profiles.
 -- Serializarea namespace-ului email acopera si coliziunile intre angajati diferiti.
 PERFORM pg_advisory_xact_lock(hashtext('portal.email.teren'));
 SELECT e.name INTO v_name FROM public.employees e WHERE e.id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_INVALID_REQUEST'; END IF;
 SELECT * INTO r FROM public.portal_provisioning WHERE provisioning_id=p_cheie FOR UPDATE;
 IF FOUND THEN
  IF r.employee_id IS DISTINCT FROM p_employee_id OR r.cerut_de IS DISTINCT FROM v_uid
   OR r.payload_sha256 IS DISTINCT FROM sha256(convert_to(jsonb_build_array(p_employee_id,v_uid)::text,'UTF8'))
   OR r.stare='anulat' THEN RAISE EXCEPTION 'PORTAL_KEY_CONFLICT'; END IF;
  RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'email',r.email_calculat,
   'stare',r.stare,'auth_user_id',r.auth_user_id);
 END IF;
 IF public.fn_portal_angajat_eligibil(p_employee_id) IS NOT TRUE
  OR EXISTS (SELECT FROM public.conturi_teren WHERE employee_id=p_employee_id)
  OR EXISTS (SELECT FROM public.profiles WHERE employee_id=p_employee_id)
  OR EXISTS (SELECT FROM public.portal_provisioning WHERE employee_id=p_employee_id AND stare IN ('rezervat','creat'))
 THEN RAISE EXCEPTION 'PORTAL_EMPLOYEE_UNAVAILABLE'; END IF;
 v_name:=lower(translate(v_name,'ĂÂÎȘŞȚŢăâîșşțţ','AAISSTTaaisstt'));
 v_parts:=regexp_split_to_array(btrim(v_name),'[[:space:]]+');
 IF cardinality(v_parts)<2 THEN RAISE EXCEPTION 'PORTAL_EMPLOYEE_NAME_INVALID'; END IF;
 v_base:=array_to_string(v_parts[2:cardinality(v_parts)],'.')||'.'||v_parts[1];
 -- Diacritice eliminate explicit, cratime/apostrofuri devin separatori; alte alfabete sunt refuzate.
 v_base:=regexp_replace(v_base,'[-''’]+','.','g');
 IF v_base !~ '^[a-z0-9]+([.][a-z0-9]+)*$' OR length(v_base)>55 THEN
  RAISE EXCEPTION 'PORTAL_EMPLOYEE_NAME_INVALID'; END IF;
 LOOP
  v_email:=v_base||CASE WHEN v_i=1 THEN '' ELSE '.'||v_i::text END||'@teren.gazpet.ro';
  EXIT WHEN NOT EXISTS (SELECT FROM public.portal_provisioning WHERE email_calculat=v_email)
   AND NOT EXISTS (SELECT FROM auth.users WHERE lower(email)=v_email);
  v_i:=v_i+1;
 END LOOP;
 INSERT INTO public.portal_provisioning(provisioning_id,employee_id,email_calculat,stare,cerut_de,payload_sha256)
 VALUES(p_cheie,p_employee_id,v_email,'rezervat',v_uid,sha256(convert_to(jsonb_build_array(p_employee_id,v_uid)::text,'UTF8')))
 ON CONFLICT (provisioning_id) DO NOTHING RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_KEY_CONFLICT'; END IF;
 RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'email',r.email_calculat,
  'stare',r.stare,'auth_user_id',r.auth_user_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_cont_pregateste(integer,uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_cont_pregateste(integer,uuid) TO authenticated;

CREATE FUNCTION public.fn_portal_cont_finalizeaza(p_provisioning_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE r public.portal_provisioning%ROWTYPE; v_emp integer; c public.conturi_teren%ROWTYPE;
BEGIN
 -- Exceptie server L08: rol SQL real; nu auth.role() sau claim/GUC custom.
 IF session_user <> 'service_role' AND current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 -- Ordine: employees -> portal_provisioning -> conturi_tip -> conturi_teren -> profiles -> user_module_access.
 SELECT employee_id INTO v_emp FROM public.portal_provisioning WHERE provisioning_id=p_provisioning_id;
 PERFORM 1 FROM public.employees WHERE id=v_emp FOR UPDATE;
 SELECT * INTO r FROM public.portal_provisioning WHERE provisioning_id=p_provisioning_id FOR UPDATE;
 IF NOT FOUND OR r.stare NOT IN ('creat','finalizat') OR r.auth_user_id IS NULL
  OR public.fn_portal_angajat_eligibil(v_emp) IS NOT TRUE THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 PERFORM 1 FROM public.conturi_tip WHERE auth_user_id=r.auth_user_id AND tip='teren' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 SELECT * INTO c FROM public.conturi_teren WHERE auth_user_id=r.auth_user_id FOR UPDATE;
 IF NOT FOUND OR c.employee_id IS DISTINCT FROM r.employee_id OR c.provisioning_id IS DISTINCT FROM r.provisioning_id
  OR (r.stare='creat' AND c.stare IS DISTINCT FROM 'in_creare')
  OR (r.stare='finalizat' AND c.stare IS DISTINCT FROM 'activ') THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=r.auth_user_id AND role='teren'
   AND employee_id=r.employee_id AND is_owner IS NOT TRUE FOR UPDATE;
 IF NOT FOUND OR EXISTS (SELECT FROM public.user_module_access WHERE profile_id=r.auth_user_id)
  OR NOT EXISTS (SELECT FROM auth.users u WHERE u.id=r.auth_user_id AND u.email=r.email_calculat
    AND u.raw_app_meta_data->>'tip_cont'='teren'
    AND u.raw_app_meta_data->>'employee_id'=r.employee_id::text
    AND u.raw_app_meta_data->>'provisioning_id'=r.provisioning_id::text
    AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RAISE EXCEPTION 'PORTAL_FINALIZE_INVALID'; END IF;
 IF r.stare='creat' THEN
  UPDATE public.portal_provisioning SET stare='finalizat'
   WHERE provisioning_id=r.provisioning_id AND stare='creat' AND auth_user_id=r.auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_CONFLICT'; END IF;
  UPDATE public.conturi_teren SET stare='activ' WHERE auth_user_id=r.auth_user_id
    AND provisioning_id=r.provisioning_id AND stare='in_creare';
  IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_FINALIZE_CONFLICT'; END IF;
 END IF;
 IF NOT EXISTS (SELECT FROM public.portal_provisioning z
   JOIN public.conturi_tip t ON t.auth_user_id=z.auth_user_id AND t.tip='teren'
   JOIN public.conturi_teren ct ON ct.auth_user_id=z.auth_user_id AND ct.employee_id=z.employee_id
    AND ct.provisioning_id=z.provisioning_id AND ct.stare='activ'
   JOIN public.profiles p ON p.id=z.auth_user_id AND p.role='teren' AND p.employee_id=z.employee_id
   WHERE z.provisioning_id=r.provisioning_id AND z.auth_user_id=r.auth_user_id AND z.stare='finalizat'
    AND p.is_owner IS NOT TRUE)
  OR EXISTS (SELECT FROM public.user_module_access WHERE profile_id=r.auth_user_id)
 THEN RAISE EXCEPTION 'PORTAL_FINALIZE_POSTCONDITION'; END IF;
 RETURN jsonb_build_object('provisioning_id',r.provisioning_id,'auth_user_id',r.auth_user_id,'stare','finalizat');
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_cont_finalizeaza(uuid) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_portal_cont_finalizeaza(uuid) TO service_role;

CREATE FUNCTION public.fn_cont_aproba_erp(p_auth_user_id uuid,p_rol text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_uid uuid:=auth.uid(); v_emp integer;
BEGIN
 IF v_uid IS NULL OR NOT EXISTS (SELECT FROM public.profiles WHERE id=v_uid AND is_owner IS TRUE)
 THEN RAISE EXCEPTION 'PORTAL_ACCESS_DENIED'; END IF;
 IF p_rol IS NULL OR p_rol NOT IN ('superadmin','admin_logistica','manager_santier','sef_echipa',
   'contabilitate','hr','gestionar','magazioner') THEN RAISE EXCEPTION 'PORTAL_ROLE_INVALID'; END IF;
 -- Ordine: employees (daca este legat) -> conturi_tip -> conturi_teren -> profiles.
 SELECT employee_id INTO v_emp FROM public.profiles WHERE id=p_auth_user_id;
 IF v_emp IS NOT NULL THEN PERFORM 1 FROM public.employees WHERE id=v_emp FOR UPDATE; END IF;
 -- Lock pe parintele Auth serializeaza doua aprobari pentru aceeasi tinta fara clasificare.
 -- Provisioning nu ia lock pe auth.users existent (NEW este propria insertie).
 PERFORM 1 FROM auth.users WHERE id=p_auth_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_TARGET_INVALID'; END IF;
 IF EXISTS (SELECT FROM public.conturi_tip WHERE auth_user_id=p_auth_user_id AND tip <> 'neaprobat')
  OR EXISTS (SELECT FROM public.conturi_teren WHERE auth_user_id=p_auth_user_id)
  OR EXISTS (SELECT FROM auth.users WHERE id=p_auth_user_id AND raw_app_meta_data->>'tip_cont'='teren')
 THEN RAISE EXCEPTION 'PORTAL_TARGET_CLASSIFIED'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_auth_user_id AND (role='in_asteptare' OR EXISTS
   (SELECT FROM public.conturi_tip WHERE auth_user_id=p_auth_user_id AND tip='neaprobat')) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_TARGET_INVALID'; END IF;
 INSERT INTO public.conturi_tip(auth_user_id,tip,sursa,clasificat_de)
  VALUES(p_auth_user_id,'erp','aprobare_owner_e1_1b',v_uid)
 ON CONFLICT (auth_user_id) DO UPDATE SET tip='erp',sursa=EXCLUDED.sursa,
  clasificat_de=EXCLUDED.clasificat_de,clasificat_la=clock_timestamp()
 WHERE conturi_tip.tip='neaprobat';
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_APPROVAL_CONFLICT'; END IF;
 UPDATE public.profiles SET role=p_rol WHERE id=p_auth_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_APPROVAL_CONFLICT'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_aproba_erp(uuid,text) FROM PUBLIC,anon,authenticated,service_role,teren;
GRANT EXECUTE ON FUNCTION public.fn_cont_aproba_erp(uuid,text) TO authenticated;

CREATE FUNCTION public.fn_portal_revoca_la_plecare() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 -- Ordine: employees (deja blocat de UPDATE) -> conturi_teren; nu exista lock invers.
 IF public.fn_portal_angajat_eligibil(NEW.id) IS NOT TRUE THEN
  UPDATE public.conturi_teren SET stare='revocat',revocat_la=clock_timestamp(),
   revocat_motiv=CASE WHEN NEW.active IS NOT TRUE THEN 'angajat_inactiv' ELSE 'incetare_contract' END
   WHERE employee_id=NEW.id AND stare IN ('in_creare','activ');
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_revoca_la_plecare() FROM PUBLIC,anon,authenticated,service_role,teren;

-- r3 (09.11.2026): amprenta pe LISTA ALBA (L15), nu pe toata schema public. Varianta r2 amprenta orice functie /
-- tabel / politica din public si orice rand din employees / profiles / auth.users: orice migrare a altui modul sau
-- orice editare HR inrosea poarta si bloca revenirea. Acoperirea r3:
--  * functiile portalului, handle_new_user si callee-urile lui tranzitive revizuite din migrari
--    (fn_cont_candidati_angajat -> fn_nume_cuvinte / fn_nume_familie -> extensions.unaccent;
--    fn_cont_notifica_owneri), helperii Auth; o semnatura absenta se inregistreaza ca absenta;
--  * triggerele (si functiile lor) de pe tabelele in care scriu handle_new_user si RPC-urile portalului:
--    auth.users, profiles, notifications si tabelele portalului; pe employees numai triggerul portalului;
--  * tabelele portalului complet (ACL, RLS, coloane, constrangeri, politici); pe profiles constrangerile (rolurile);
--  * datele portalului + profilurile cu rolurile noi (teren / in_asteptare) + conturile Auth teren si drepturile lor.
-- Enumerarea e din catalog (semnatura canonica cu oidvectortypes), fara regex pe text SQL.
-- r10 (Jakarinos r9 P2): plpgsql (RETURN (interogare)), ca la crearea ei sa nu se analizeze interogarea si sa nu se ia
-- ACCESS SHARE pe auth.users / profiles / user_module_access / conturi_* inainte de $locks$.
CREATE FUNCTION public.fn_portal_1b_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
BEGIN
 RETURN (WITH sig AS (SELECT unnest(ARRAY[
   'public.handle_new_user()','public.fn_cont_candidati_angajat(text)','public.fn_nume_cuvinte(text)',
   'public.fn_nume_familie(text)','extensions.unaccent(text)','public.fn_cont_notifica_owneri(text, text, text, text)',
   'public.fn_teren_eligibil(uuid)','public.fn_portal_angajat_eligibil(integer)','public.fn_portal_uid()',
   'public.fn_auth_token_hook(jsonb)','public.fn_portal_porti_lipsa()','public.fn_portal_public_aprobat()',
   'public.fn_portal_public_md5()','public.fn_portal_net_md5()','public.fn_portal_catalog_amprenta(oid)','public.fn_conturi_tip_audit()',
   -- r21 (varianta c): helperii portii 18a pentru obiectele pg_net (lista + amprenta + predicat) si dreptul lui teren.
   'public.fn_portal_net_rel_aprobat()','public.fn_portal_net_rel_amprenta(oid)','public.fn_portal_net_rel_acceptat(oid)',
   'public.fn_portal_teren_rel_drept(oid)',
   'public.fn_conturi_jurnal_imuabil()','public.fn_portal_cont_pregateste(integer, uuid)',
   'public.fn_portal_cont_finalizeaza(uuid)','public.fn_cont_aproba_erp(uuid, text)',
   'public.fn_portal_revoca_la_plecare()','public.fn_portal_provisioning_audit()',
   'public.fn_portal_1b_snapshot()','public.fn_portal_porti_lipsa_1b()','auth.uid()','auth.jwt()',
   -- Jakarinos r3 P1: callee-urile tranzitive ale triggerelor de pe profiles (UPDATE din fn_cont_aproba_erp, INSERT din
   -- handle_new_user), revizuite din migrarile 20260929c / 20260929g / 20260930a / 20260930j; de confirmat pe prod cu
   -- sectiunea 8 a inventarului inainte de DRY (orice callee nou = lista se completeaza, nu se ocoleste).
   'public.fn_profiles_protectie_legatura()','public.fn_identitate_privilegiata()','public.fn_identitate_claims()',
   'public.fn_identitate_eticheta()','public.fn_profiles_campuri_owner_only()','public.prevent_role_escalation()',
   'public.enforce_owner_only_salary_flags()','public.protect_can_access_pontaj_brut()']::text[]) AS s),
 rel AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('conturi_tip','conturi_teren','conturi_tip_jurnal','conturi_tip_jurnal_id_seq',
    'portal_public_baseline','portal_provisioning','portal_provisioning_jurnal','portal_provisioning_jurnal_id_seq',
    'portal_e1_1b_manifest')),
 trg AS (SELECT t.oid,t.tgrelid,t.tgfoid,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (t.tgrelid IN (SELECT oid FROM rel)
    OR (n.nspname='auth' AND c.relname='users') OR (n.nspname='public' AND c.relname IN ('profiles','notifications'))
    OR (n.nspname='public' AND c.relname='employees' AND t.tgname='portal_revoca_la_plecare'))),
 teren_uid AS (SELECT auth_user_id AS id FROM public.conturi_teren
   UNION SELECT auth_user_id FROM public.portal_provisioning WHERE auth_user_id IS NOT NULL
   UNION SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data->>'tip_cont'='teren'
    OR lower(split_part(u.email,'@',2))='teren.gazpet.ro')
 SELECT jsonb_build_object(
  'auth_teren',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]')::text,'UTF8')),'hex')
   FROM (SELECT u.id,u.email,u.raw_app_meta_data,u.banned_until FROM auth.users u WHERE u.id IN (SELECT id FROM teren_uid)) t),
  'profiles_noi',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]')::text,'UTF8')),'hex')
   FROM (SELECT p.id,p.role,p.employee_id,p.is_owner FROM public.profiles p
    WHERE p.role IN ('teren','in_asteptare') OR p.id IN (SELECT id FROM teren_uid)) t),
  'access_teren',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]')::text,'UTF8')),'hex')
   FROM (SELECT a.id,a.profile_id,a.module,a.access_level FROM public.user_module_access a
    WHERE a.profile_id IN (SELECT id FROM teren_uid)) t),
  'tip',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]')::text,'UTF8')),'hex') FROM public.conturi_tip t),
  'teren',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY auth_user_id),'[]')::text,'UTF8')),'hex') FROM public.conturi_teren t),
  'tip_jurnal',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.conturi_tip_jurnal t),
  'provisioning',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY provisioning_id),'[]')::text,'UTF8')),'hex') FROM public.portal_provisioning t),
  'jurnal',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text,'UTF8')),'hex') FROM public.portal_provisioning_jurnal t),
  'ddl',(SELECT coalesce(jsonb_agg(x.obj ORDER BY x.cheie COLLATE "C"),'[]') FROM (
   SELECT 's:'||sig.s AS cheie,jsonb_build_array('function',sig.s,pg_get_functiondef(f.oid),f.proowner,f.proacl,f.proconfig,f.prosecdef) AS obj
    FROM sig LEFT JOIN (SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef,
      n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS s
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')) f ON f.s=sig.s
   UNION ALL SELECT 'g:'||p.oid,jsonb_build_array('trigger_function',p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef)
    FROM pg_proc p WHERE p.oid IN (SELECT tgfoid FROM trg)
   UNION ALL SELECT 't:'||t.oid,jsonb_build_array('trigger',t.tgrelid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid)) FROM trg t
   UNION ALL SELECT 'r:'||c.oid,jsonb_build_array('relation',c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
    FROM pg_class c WHERE c.oid IN (SELECT oid FROM rel)
   UNION ALL SELECT 'a:'||a.attrelid||':'||a.attnum,jsonb_build_array('column',a.attrelid,a.attnum,a.attname,a.atttypid,
    a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid IN (SELECT oid FROM rel) AND a.attnum>0 AND NOT a.attisdropped
   -- Jakarinos r4 P2: configuratia secventelor din lista alba (fara contorul curent, care nu e DDL).
   UNION ALL SELECT 'q:'||s.seqrelid,jsonb_build_array('sequence',s.seqrelid,s.seqtypid,s.seqstart,s.seqincrement,
    s.seqmax,s.seqmin,s.seqcache,s.seqcycle) FROM pg_sequence s WHERE s.seqrelid IN (SELECT oid FROM rel)
   UNION ALL SELECT 'c:'||c.oid,jsonb_build_array('constraint',c.conrelid,c.conname,pg_get_constraintdef(c.oid))
    FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM rel) OR c.conrelid='public.profiles'::regclass
   UNION ALL SELECT 'p:'||p.oid,jsonb_build_array('policy',p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
    pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) FROM pg_policy p
    WHERE p.polrelid IN (SELECT oid FROM rel)
  ) x)));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_1b_snapshot() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE FUNCTION public.fn_portal_porti_lipsa_1b() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v text[]; r record;
BEGIN
 v:=public.fn_portal_porti_lipsa();
 IF EXISTS (SELECT FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot')
  AND public.fn_portal_1b_snapshot()->'ddl' IS DISTINCT FROM
   (SELECT valoare->'ddl' FROM public.portal_e1_1b_manifest WHERE cheie='post_snapshot') THEN
  v:=array_append(v,'1b amprenta DDL'); END IF;
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('fn_portal_cont_pregateste','fn_portal_cont_finalizeaza',
  'fn_cont_aproba_erp','fn_portal_angajat_eligibil','fn_portal_revoca_la_plecare','fn_portal_provisioning_audit',
  'fn_portal_1b_snapshot','fn_portal_porti_lipsa_1b','handle_new_user') LOOP
  IF has_function_privilege('teren',r.oid,'EXECUTE') OR has_function_privilege('anon',r.oid,'EXECUTE') THEN
   v:=array_append(v,'1b functie:'||r.proname); END IF;
 END LOOP;
 -- Inventarul lipsa ramane o alerta explicita (pending/invite nu inseamna aprobare).
 IF EXISTS (SELECT FROM public.portal_provisioning p JOIN public.conturi_teren c USING(provisioning_id)
   WHERE p.auth_user_id IS DISTINCT FROM c.auth_user_id OR p.employee_id IS DISTINCT FROM c.employee_id
    OR (p.stare='finalizat' AND c.stare NOT IN ('activ','revocat'))) THEN
   v:=array_append(v,'1b provisioning incoerent'); END IF;
 RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_portal_porti_lipsa_1b() FROM PUBLIC,anon,authenticated,service_role,teren,supabase_auth_admin;
CREATE TRIGGER portal_1b_manifest_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.portal_e1_1b_manifest
 FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_jurnal_imuabil();
-- r10: handle_new_user se inlocuieste INAINTE de $locks$ (plpgsql: fara lock pe tabelele pe care le scrie). Alte sesiuni
-- vad corpul nou abia la COMMIT, odata cu CHECK-ul care accepta rolurile noi si cu FK-urile, deci ordinea in tranzactie nu
-- conteaza pentru ele; o inlocuire concurenta (alt rand pg_proc) asteapta / esueaza sub lock_timeout, nimic partial.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_portal_emp integer; v_portal_id uuid; v_portal public.portal_provisioning%ROWTYPE;
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN

  IF NEW.raw_app_meta_data->>'tip_cont' = 'teren' THEN
    -- Ordine: employees -> portal_provisioning -> conturi_tip -> conturi_teren -> profiles.
    -- auth.users este deja inserat de GoTrue; nu blocam un alt rand auth.users pe aceasta cale.
    v_portal_emp := (NEW.raw_app_meta_data->>'employee_id')::integer;
    v_portal_id := (NEW.raw_app_meta_data->>'provisioning_id')::uuid;
    PERFORM 1 FROM public.employees WHERE id=v_portal_emp FOR UPDATE;
    IF NOT FOUND OR public.fn_portal_angajat_eligibil(v_portal_emp) IS NOT TRUE THEN
      RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    SELECT * INTO v_portal FROM public.portal_provisioning WHERE provisioning_id=v_portal_id FOR UPDATE;
    IF NOT FOUND OR v_portal.employee_id IS DISTINCT FROM v_portal_emp
      OR v_portal.stare IS DISTINCT FROM 'rezervat' OR v_portal.auth_user_id IS NOT NULL
      OR NEW.email IS DISTINCT FROM v_portal.email_calculat
      OR EXISTS (SELECT FROM public.profiles WHERE employee_id=v_portal_emp)
      OR EXISTS (SELECT FROM public.conturi_teren WHERE employee_id=v_portal_emp) THEN
      RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    INSERT INTO public.conturi_tip(auth_user_id,tip,sursa,clasificat_de)
      VALUES(NEW.id,'teren','provisioning_e1_1b',v_portal.cerut_de);
    INSERT INTO public.conturi_teren(auth_user_id,employee_id,stare,provisioning_id)
      VALUES(NEW.id,v_portal_emp,'in_creare',v_portal_id);
    INSERT INTO public.profiles(id,email,name,role,employee_id)
      SELECT NEW.id,NEW.email,e.name,'teren',e.id FROM public.employees e WHERE e.id=v_portal_emp;
    UPDATE public.portal_provisioning SET stare='creat',auth_user_id=NEW.id
      WHERE provisioning_id=v_portal_id AND stare='rezervat' AND auth_user_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_RESERVATION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  -- r9 (P2-01): contul nou primeste clasificarea 'neaprobat' odata cu profilul (inventarul Auth ramane complet;
  -- hook-ul il refuza pana la fn_cont_aproba_erp). Ordinea ca pe ramura teren: conturi_tip -> profiles.
  INSERT INTO public.conturi_tip(auth_user_id,tip,sursa) VALUES (NEW.id,'neaprobat','cont_nou_e1_1b')
  ON CONFLICT (auth_user_id) DO NOTHING;
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'in_asteptare'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;
-- r9 (P1-01) / r10: PUNCTUL UNIC de lock, la final. Inainte de el nu s-a atins niciun tabel existent (verificat static
-- de scripts/portal/buget_lock.py si in harness: lock_pre_observe). NOWAIT + reincercare la 50 ms, cel mult 3 s: cat
-- timp incearca, aplicarea NU sta in coada (citirile ERP si login-urile nu se aseaza in spatele ei); o incercare ratata
-- elibereaza tot ce luase (subtranzactie). Peste buget: 55P03 PORTAL_LOCK_BUDGET, nimic schimbat.
-- Ordinea (L06): auth.users -> employees -> profiles -> user_module_access -> conturi_tip / jurnal -> conturi_teren
-- (ca la 18a, ca la crearea unui cont si ca stergerea unui cont: auth.users -> conturi_* in cascada).
--  * auth.users          SHARE ROW EXCLUSIVE: FK portal_provisioning -> auth.users (ADD FOREIGN KEY); niciun cont nou
--                        pana la commit (reconcilierea de mai jos e completa). Blocheaza: scrierile Auth (login, cont
--                        nou). Nu blocheaza citirile.
--  * employees           SHARE ROW EXCLUSIVE: FK + CREATE TRIGGER (revocare). Blocheaza: editarile HR. Nu citirile.
--  * profiles            ACCESS EXCLUSIVE: cerut EXACT de `ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk,
--                        ADD CONSTRAINT profiles_role_chk CHECK (...)` (rolurile noi 'teren' / 'in_asteptare'). In
--                        PostgreSQL atat DROP CONSTRAINT cat si ADD CONSTRAINT ... CHECK (si varianta NOT VALID) cer
--                        ACCESS EXCLUSIVE; doar FK-ul (SHARE ROW EXCLUSIVE) si VALIDATE (SHARE UPDATE EXCLUSIVE) au
--                        niveluri mai mici, deci CHECK-ul nu se poate schimba fara sa opreasca si citirile. Blocheaza
--                        TOT pe profiles (inclusiv citirile ERP prin RLS): cel mult 2 s de la BEGIN pana la intrarea in
--                        COMMIT (plafonul de mai jos) + durata COMMIT-ului (de regula milisecunde).
--  * user_module_access  SHARE: drepturile conturilor teren nu se schimba intre poarta si amprenta. Blocheaza: scrierile.
--  * conturi_tip / jurnal SHARE (clasificarea nu se schimba; cascada unei stergeri asteapta), conturi_teren ACCESS
--                        EXCLUSIVE (coloane noi). Le foloseste doar hook-ul, care nu e pornit.
-- PLAFONUL (r12; ca 18a): ceasul pornit la BEGIN din conexiunea runnerului (verificat in $pre$); aici NU se schimba
-- niciun timeout. Plafoneaza: de la BEGIN PANA LA INTRAREA IN COMMIT (pregatirea, asteptarea lock-urilor, $critic$,
-- inregistrarea runnerului, pauzele clientului / retelei, inclusiv intre $locks$ si $critic$) cel mult 2 s, altfel serverul
-- inchide sesiunea => ROLLBACK la tot, lock-uri eliberate, nimic schimbat. NU plafoneaza COMMIT-ul propriu-zis (PG17
-- opreste ceasul la intrarea in COMMIT; lock-urile, inclusiv ACCESS EXCLUSIVE pe profiles, se elibereaza dupa scrierea
-- commit-ului): se adauga flush-ul WAL (de regula milisecunde; fara constrangeri amanate) si, numai cu replicare
-- sincrona, asteptarea standby-ului. Reincercarea NOWAIT: pana la 1 s de la BEGIN (now() = inceputul tranzactiei).
DO $locks$
DECLARE v_n integer := 0;
BEGIN
  LOOP
    v_n := v_n + 1;
    BEGIN
      LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.user_module_access IN SHARE MODE NOWAIT;
      LOCK TABLE public.conturi_tip,public.conturi_tip_jurnal IN SHARE MODE NOWAIT;
      LOCK TABLE public.conturi_teren IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION 'PORTAL_LOCK_BUDGET: auth.users / employees / profiles / user_module_access ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
          v_n, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  RAISE NOTICE 'PORTAL_LOCKS 19a: % incercari, lock-uri la % ms de la BEGIN; plafon 2 s de la BEGIN pana la intrarea in COMMIT', v_n,
    round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $locks$;
-- r10: sectiunea critica = O SINGURA instructiune (un singur drum dus-intors client-server), toata sub plafon.
DO $critic$
DECLARE c record; v_rec bigint; v_porti text[];
BEGIN
  -- 1. conturi_teren (din 18a): coloanele noi si auditul (ACCESS EXCLUSIVE, deja detinut).
  ALTER TABLE public.conturi_teren
   ADD COLUMN provisioning_id uuid UNIQUE REFERENCES public.portal_provisioning(provisioning_id),
   ADD COLUMN creat_la timestamptz,
   ADD COLUMN revocat_la timestamptz,
   ADD COLUMN revocat_motiv text;
  -- Legacy: data crearii este necunoscuta; nu o inventam la apply. DEFAULT numai pentru randurile noi.
  ALTER TABLE public.conturi_teren ALTER COLUMN creat_la SET DEFAULT now();
  CREATE TRIGGER portal_conturi_teren_audit AFTER INSERT OR UPDATE OR DELETE ON public.conturi_teren
   FOR EACH ROW EXECUTE FUNCTION public.fn_portal_provisioning_audit();
  -- 2. rolurile: CHECK-ul si rolurile existente se reverifica fata de manifest (nicio schimbare intre citire si ALTER),
  --    apoi CHECK-ul nou intr-un SINGUR ALTER (o scanare a profilurilor, nu doua).
  SELECT conname,pg_get_constraintdef(oid) AS def INTO STRICT c
  FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_role_chk';
  IF jsonb_build_object('name',c.conname,'definition',c.def) IS DISTINCT FROM
    (SELECT valoare FROM public.portal_e1_1b_manifest WHERE cheie='role_live') THEN
   RAISE EXCEPTION 'PORTAL_PROFILE_ROLES_CHANGED'; END IF;
  IF EXISTS (SELECT FROM public.profiles WHERE role IS NULL OR role NOT IN
   ('superadmin','admin_logistica','manager_santier','sef_echipa','contabilitate','hr','gestionar','magazioner'))
  THEN RAISE EXCEPTION 'PORTAL_ROLE_PREFLIGHT'; END IF;
  ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk,
   ADD CONSTRAINT profiles_role_chk CHECK (role IN
   ('superadmin','admin_logistica','manager_santier','sef_echipa','contabilitate','hr','gestionar','magazioner','teren','in_asteptare'));
  -- 3. FK-urile provisioning-ului (tabel gol) si triggerul de revocare pe employees.
  ALTER TABLE public.portal_provisioning
   ADD CONSTRAINT portal_provisioning_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id),
   ADD CONSTRAINT portal_provisioning_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
  CREATE TRIGGER portal_revoca_la_plecare AFTER UPDATE OF active,termination_date ON public.employees
   FOR EACH ROW EXECUTE FUNCTION public.fn_portal_revoca_la_plecare();
  -- 4. r10 (P2-01): reconcilierea ferestrei 18a -> 19a. Un cont creat dupa COMMIT-ul 18a are profil (handle_new_user
  --    vechi), dar nu are rand in conturi_tip. Sub SHARE ROW EXCLUSIVE pe auth.users nu mai apare niciunul pana la COMMIT.
  --    Contul obisnuit = 'neaprobat' (hook-ul il refuza pana la fn_cont_aproba_erp; rolul din profil ramane cel dat de
  --    handle_new_user vechi, ca la conturile nelistate din 18a). Un cont teren (domeniu sau tip_cont) nu putea fi creat
  --    legitim intre livrari (provisioning-ul nu exista) => refuz, nimic schimbat.
  IF EXISTS (SELECT FROM auth.users u WHERE NOT EXISTS (SELECT FROM public.conturi_tip t WHERE t.auth_user_id=u.id)
    AND (lower(split_part(u.email,'@',2))='teren.gazpet.ro' OR u.raw_app_meta_data->>'tip_cont'='teren')) THEN
   RAISE EXCEPTION 'PORTAL_1B_TERRAIN_UNCLASSIFIED'; END IF;
  INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)
  SELECT u.id,'neaprobat','reconciliere_e1_1b' FROM auth.users u
   WHERE NOT EXISTS (SELECT FROM public.conturi_tip t WHERE t.auth_user_id=u.id);
  GET DIAGNOSTICS v_rec = ROW_COUNT;
  RAISE NOTICE 'PORTAL_1B_RECONCILIATE: % conturi aparute intre 18a si 19a, clasificate neaprobat', v_rec;
  -- 5. ancorele, reverificate imediat inaintea fixarii amprentei (nicio schimbare externa in timpul apply-ului),
  --    poarta 1b (inclusiv inventarul Auth complet) si amprenta pentru revenire.
  IF pg_temp.portal_1b_ancore() IS DISTINCT FROM (SELECT v FROM pg_temp.portal_1b_ancore_revizuit) THEN
   RAISE EXCEPTION 'PORTAL_1B_ANCHOR_CHANGED'; END IF;
  -- r21: postconditia spune CE porti lipsesc (nume de obiecte de schema, fara date).
  v_porti := public.fn_portal_porti_lipsa_1b();
  IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_1B_POSTCONDITION: % porti: %', coalesce(cardinality(v_porti)::text, 'NECUNOSCUT'), coalesce(array_to_string(v_porti, '; '), 'NECUNOSCUT'); END IF;
  INSERT INTO public.portal_e1_1b_manifest VALUES ('post_snapshot',public.fn_portal_1b_snapshot());
END $critic$;
