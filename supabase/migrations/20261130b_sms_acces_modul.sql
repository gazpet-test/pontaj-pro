-- Version 20261130121000. Runner supplies one transaction.
-- 20261130b_sms_acces_modul — modulul SMS iese din „doar owner” (decizia lui Razvan, 03.11.2026: „trebuie sa fie si un utilizator,
-- ca eu nu sunt mereu la calculator si nu e treaba de administrator”, plus un acces de test limitat pentru contul AI claude@gazpet.ro).
-- Peste 20261130a (aplicata; corpurile functiilor verificate prin md5 inainte de orice schimbare).
-- Ce face:
--   * cheia de modul `sms` in app_modules (un rand de configurare; nimeni nu primeste acces aici, drepturile le da Razvan);
--   * nivelul SMS vine din user_module_access (module = 'sms'), pe valorile pe care tabela le accepta deja (CHECK admin / editor /
--     viewer, acelasi tipar ca la Redari, fn_red_nivel): editor (sau admin) = utilizator · viewer = test · profiles.is_owner = owner;
--     fn_sms_nivel() -> owner / utilizator / test / NULL (fara parametru: nu poate sonda alte conturi);
--   * reguli in BD (RPC-uri si triggere), nu doar in UI:
--       owner + utilizator + test: compun, previzualizeaza, creeaza lot intern, vad lista fixata, aproba pe versiunea afisata, pornesc
--         trimiterea si anuleaza;
--       test: DOAR loturile create de el (creat_de = contul, creat_nivel = 'test'), interne, cu maximum 5 destinatari (verificat la
--         creare, la aprobare, la anulare, la lista fixata si la rezervare, si in triggere); niciun lot Redari, nici la vedere; plus un
--         buget pe cont: fn_sms_test_buget_zi() = 10 SMS / zi (ora Romaniei), rezervat atomic, numara si mesajele „necunoscut”,
--         nu se elibereaza prin anulare sau recreare;
--       utilizator: loturi Redari (la vedere si la actiune) doar cu comutatorul Redari pornit de owner SI cu modulul Redari
--         editor / admin (contactul proprietarilor ramane in spatele drepturilor Redari);
--       DOAR owner: kill-switch, plafoane, autorizarea Redari, opt-out, setari (functiile 20261130a raman neschimbate);
--   * citirea DIRECTA a tabelelor si a vederii sms_v_loturi ramane DOAR a owner-ului (politicile RLS 20261130a nu se ating:
--     RLS limiteaza randuri, nu coloane, iar sms_mesaje.telefon e in clar). Utilizatorul si testul citesc prin RPC-uri SECURITY
--     DEFINER care aplica aceeasi regula de vizibilitate si intorc doar telefonul mascat: fn_sms_loturi_lista (loturi + numaratori),
--     fn_sms_lot_destinatari (lista fixata / mesajele lotului);
--   * pe lot raman creat_de / aprobat_de / anulat_de si, nou, nivelul cu care s-a facut fiecare pas (creat_nivel / aprobat_nivel /
--     anulat_nivel), scrise de trigger, nu de aplicatie;
--   * fn_sms_rezerva primeste apelantul (p_apelant = uid-ul verificat de edge; NULL = cronul intern) si ii verifica nivelul in BD.
-- r2 (03.11.2026, NO-GO Jakarinos + Copilot pe r1): P1 citirea directa a sms_mesaje / sms_loturi / sms_v_loturi ramane doar owner
-- (r1 deschidea telefoanele complete); P2-02 testul doar pe loturile lui; P2-01 bugetul zilnic pe contul de test; P2-03 Redari la vedere
-- doar cu comutatorul pornit; P3-01 insertul de mesaje se serializeaza pe lot.
-- r3 (03.11.2026, GO cu observatii Jakarinos + Copilot pe r2): coada contului de test plafonata (fn_sms_test_coada_max() = 10 mesaje
-- nerezervate in loturile lui active), verificata atomic la creare si la aprobare (lock consultativ pe cont); la rezervare (si pe calea
-- cronului) nivelul ACTUAL al creatorului unui lot de test e revalidat (fara drept test = creator_fara_drept); testul nu vede loturi
-- cu peste 5 destinatari (nici la vedere); bugetul din triggerul mesajelor se serializeaza cu fn_sms_rezerva fara asteptare (NOWAIT).
-- Ordinea lock-urilor (aceeasi peste tot, fara cicluri): setari (FOR SHARE / FOR UPDATE) -> contul de test (lock consultativ
-- 'sms_test_coada:<uid>') -> lot (FOR UPDATE) -> mesaje. RPC-urile asteapta lock-urile in aceasta ordine; triggerele NU asteapta
-- niciodata un lock (pg_try_advisory_xact_lock / FOR UPDATE NOWAIT): in RPC il au deja, la scrierea directa esueaza imediat (55P03).
-- Ordinea de livrare: intai migrarea, apoi edge-ul sms-trimite. Intre ele edge-ul vechi nu mai gaseste fn_sms_rezerva cu 3 argumente:
-- nu trimite nimic (fail-closed).
-- Fara date reale atinse. Revenire: supabase/revenire/20261130b_sms_acces_modul_ROLLBACK.sql (fail-closed: inapoi la doar owner,
-- nu sterge nimic). DRY: supabase/tests/20261130b_sms_acces_modul_dryrun.sql. Izolare: READ COMMITTED (ca PostgREST).
DO $pre$
DECLARE r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130b_sms_acces_modul:' || txid_current() THEN
    RAISE EXCEPTION '20261130b: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130b: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.sms_loturi') IS NULL OR to_regclass('public.sms_mesaje') IS NULL OR to_regclass('public.sms_setari') IS NULL
     OR to_regclass('public.sms_v_loturi') IS NULL THEN
    RAISE EXCEPTION '20261130b: 20261130a lipseste';
  END IF;
  -- 20261130a e exact cea revizuita si aplicata: corpurile celor 25 de functii (md5 citit din productie, 03.11.2026, read-only)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_sms_tel_normalizat(text)', '36549798f8f7dcb40aee8cce7a0516b4'),
      ('public.fn_sms_text_final(text)', '5b6c4ac4c68d42fb45949b027f96fabb'),
      ('public.fn_sms_text_verifica(text)', 'fb828f896937261687a9b2c386284218'),
      ('public.fn_sms_text_valid(text)', '8c551b7bb9d0580a0ad9a29a286ceda6'),
      ('public.fn_sms_e_owner()', '4ea29d605a2a8b491594f9d43da7385c'),
      ('public.fn_sms_cere_owner()', 'd6f5485f3f415ac746b580bb100cbd78'),
      ('public.fn_sms_consum()', '5ea88d56e11ed99307a6c53fcbd18c4e'),
      ('public.fn_sms_setari_reguli()', '48c6393049c77bc257c4e19161838927'),
      ('public.fn_sms_loturi_reguli()', '047811f11b9eb383a67e696a8c33281e'),
      ('public.fn_sms_mesaje_reguli()', '6e5a3442e406901efb6bffe1b9ab64c4'),
      ('public.fn_sms_optout_reguli()', '8c13b3633cdcb974150430fcf14a14ab'),
      ('public.fn_sms_dlr_reguli()', 'eca8c83ad782ba9a8514f7462296f395'),
      ('public.fn_sms_panou()', '4268a4e7e136f7347fed768a4754e698'),
      ('public.fn_sms_angajati_lista()', '44ac4de1b6d65eae2db97a33c000f639'),
      ('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'f870f8f33b4c41341404cbe464b17468'),
      ('public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', '68f3d395e2daa8baa260cc90cbc44cc0'),
      ('public.fn_sms_lot_destinatari(uuid)', 'ed5f409c425c5c21b4342def475cad9f'),
      ('public.fn_sms_lot_aproba(uuid,integer)', '893f96a2813053dd5bc67c6b7f184248'),
      ('public.fn_sms_lot_anuleaza(uuid,text)', 'fc4bc5cfff5d1ce11e24a894fc33bffc'),
      ('public.fn_sms_setari_salveaza(boolean,integer,integer,integer)', 'f7a1165c664db48a28fa6c2040c9abe9'),
      ('public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', '325dd028140a251a121fdbfc78a87106'),
      ('public.fn_sms_optout_seteaza(text,boolean,text)', 'cf86478ac731b04b102c430613fa1f6e'),
      ('public.fn_sms_rezerva(uuid,integer,text)', '415726344645926cc99fac661b7846d5'),
      ('public.fn_sms_rezultat(uuid,boolean,text,text,text)', 'b641f8c12d851541be4e0fc300f44dc3'),
      ('public.fn_sms_dlr_aplica(text,text,boolean,timestamp with time zone)', '38b0a5a364756412f10415282889d9da')) AS v(semnatura, md5_corp) LOOP
    IF to_regprocedure(r.semnatura) IS NULL
       OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.semnatura))) IS DISTINCT FROM r.md5_corp THEN
      RAISE EXCEPTION '20261130b: functia % lipseste sau difera de 20261130a', r.semnatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 25 THEN
    RAISE EXCEPTION '20261130b: exista alte functii fn_sms_* decat cele 25 din 20261130a';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sms_setari', 'sms_loturi', 'sms_mesaje', 'sms_optout', 'sms_dlr')) <> 5
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'sms!_%' ESCAPE '!' AND qual !~ 'fn_sms_e_owner') THEN
    RAISE EXCEPTION '20261130b: politicile RLS SMS nu sunt cele din 20261130a';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_loturi'
               AND column_name IN ('creat_nivel', 'aprobat_nivel', 'anulat_nivel')) THEN
    RAISE EXCEPTION '20261130b: coloanele de nivel exista deja pe sms_loturi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'sms') OR EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'sms') THEN
    RAISE EXCEPTION '20261130b: cheia de modul sms exista deja';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
        AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_modules'
           AND column_name IN ('key', 'parent_key', 'name', 'icon', 'color', 'description', 'is_active', 'display_order', 'show_on_homepage')) <> 9 THEN
    RAISE EXCEPTION '20261130b: lipsesc coloanele user_module_access / app_modules folosite';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261130b: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- ─── 1. Cheia de modul + nivelul cu care s-a facut fiecare pas pe lot ─────────────────────────────────────────────────────
INSERT INTO public.app_modules (key, parent_key, name, icon, color, description, is_active, display_order, show_on_homepage)
VALUES ('sms', NULL, 'SMS', '📱', '#24778B',
        'SMS catre angajati (Redari doar cu autorizarea Transgaz) · editor = utilizator · viewer = test (max 5 destinatari, fara Redari) · setarile doar owner',
        true, 34, true);

ALTER TABLE public.sms_loturi
  ADD COLUMN creat_nivel text CHECK (creat_nivel IN ('owner', 'utilizator', 'test')),
  ADD COLUMN aprobat_nivel text CHECK (aprobat_nivel IN ('owner', 'utilizator', 'test')),
  ADD COLUMN anulat_nivel text CHECK (anulat_nivel IN ('owner', 'utilizator', 'test'));
COMMENT ON COLUMN public.sms_loturi.creat_nivel IS 'SMS: nivelul contului care a creat lotul (owner / utilizator / test), scris de trigger. NULL = creat inainte de 20261130b (doar owner) sau din mentenanta.';
COMMENT ON COLUMN public.sms_loturi.aprobat_nivel IS 'SMS: nivelul contului care a aprobat lotul, scris de trigger la aprobare.';
COMMENT ON COLUMN public.sms_loturi.anulat_nivel IS 'SMS: nivelul contului care a anulat lotul, scris de trigger la anulare.';

-- ─── 2. Nivelul SMS si regulile pe lot ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_nivel_cont(p_uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE
           WHEN p_uid IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_uid AND p.is_owner IS TRUE) THEN 'owner'
           ELSE (SELECT CASE WHEN bool_or(a.access_level IN ('editor', 'admin')) THEN 'utilizator'
                             WHEN bool_or(a.access_level = 'viewer') THEN 'test' END
                   FROM public.user_module_access a WHERE a.profile_id = p_uid AND a.module = 'sms')
         END
$fn$;
COMMENT ON FUNCTION public.fn_sms_nivel_cont(uuid) IS 'SMS (intern, fara drept de apel pentru aplicatie): nivelul unui cont. Owner = profiles.is_owner; altfel user_module_access module = sms: editor sau admin = utilizator, viewer = test; altceva = NULL.';

CREATE FUNCTION public.fn_sms_redari_modul_cont(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_module_access a
                                        WHERE a.profile_id = p_uid AND a.module = 'redari' AND a.access_level IN ('editor', 'admin'))
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_modul_cont(uuid) IS 'SMS (intern): contul are modulul Redari editor / admin (aceiasi care vad contactul proprietarilor).';

CREATE FUNCTION public.fn_sms_lot_permis(p_nivel text, p_redari_ok boolean, p_al_testului boolean, p_categorie text, p_nr integer, p_actiune boolean)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(CASE p_nivel
           WHEN 'owner' THEN true
           WHEN 'utilizator' THEN p_categorie = 'intern' OR (p_categorie = 'redari' AND p_redari_ok IS TRUE)
           WHEN 'test' THEN p_categorie = 'intern' AND p_al_testului IS TRUE AND p_nr BETWEEN 1 AND 5
         END, false)
$fn$;
COMMENT ON FUNCTION public.fn_sms_lot_permis(text, boolean, boolean, text, integer, boolean) IS 'SMS (pura, interna): ce poate un nivel pe un lot. p_actiune = false: vede lotul; true: il creeaza / aproba / anuleaza / trimite. p_redari_ok = modulul Redari editor / admin SI comutatorul Redari pornit; p_al_testului = lotul e creat de acest cont, cu nivelul test. test: doar loturile lui, interne, de 1-5 destinatari (r3: si la vedere); utilizator: Redari doar cu p_redari_ok.';

-- bugetul zilnic al unui cont de test (P2-01, Copilot r1 pe 30b): constanta, o schimba Razvan cu CREATE OR REPLACE (migrare noua)
CREATE FUNCTION public.fn_sms_test_buget_zi() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 10
$fn$;
COMMENT ON FUNCTION public.fn_sms_test_buget_zi() IS 'SMS (pura, interna): cate SMS (segmente) poate rezerva pe zi (ora Romaniei) un cont de test, peste toate loturile lui. Constanta: 10.';

CREATE FUNCTION public.fn_sms_test_consum_zi(p_uid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(sum(m.segmente), 0)::integer
    FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
   WHERE p_uid IS NOT NULL AND l.creat_de = p_uid AND l.creat_nivel = 'test'
     AND m.rezervat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
$fn$;
COMMENT ON FUNCTION public.fn_sms_test_consum_zi(uuid) IS 'SMS (intern): segmentele rezervate azi (ora Romaniei) din loturile create de acest cont cu nivelul test. Orice mesaj rezervat se numara (si necunoscut / esuat / din lot anulat ulterior): bugetul nu se elibereaza prin anulare sau recreare.';

-- coada contului de test (r3, P2-01 Copilot pe r2): cate mesaje NEREZERVATE poate avea in loturile lui active; constanta separata
CREATE FUNCTION public.fn_sms_test_coada_max() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 10
$fn$;
COMMENT ON FUNCTION public.fn_sms_test_coada_max() IS 'SMS (pura, interna): cate mesaje nerezervate (in_coada) poate avea un cont de test in loturile lui active (draft / aprobat / in_trimitere). Constanta: 10.';

CREATE FUNCTION public.fn_sms_test_coada(p_uid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT count(*)::integer
    FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
   WHERE p_uid IS NOT NULL AND l.creat_de = p_uid AND l.creat_nivel = 'test'
     AND l.stare IN ('draft', 'aprobat', 'in_trimitere') AND m.stare = 'in_coada'
$fn$;
COMMENT ON FUNCTION public.fn_sms_test_coada(uuid) IS 'SMS (intern): mesajele inca nerezervate (in_coada) din loturile active (draft / aprobat / in_trimitere) create de acest cont cu nivelul test. Anularea unui lot le scoate (elibereaza coada, nu bugetul zilnic).';

-- lock-ul consultativ al contului de test: in RPC-uri cu asteptare (inaintea lock-ului pe lot), in triggere fara asteptare
CREATE FUNCTION public.fn_sms_test_coada_lock(p_uid uuid, p_asteapta boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_uid IS NULL THEN RETURN; END IF;
  IF p_asteapta THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sms_test_coada:' || p_uid::text, 0));
  ELSIF NOT pg_try_advisory_xact_lock(hashtextextended('sms_test_coada:' || p_uid::text, 0)) THEN
    RAISE EXCEPTION 'sms test: coada contului de test e modificata chiar acum; reincearca' USING ERRCODE = '55P03';
  END IF;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_test_coada_lock(uuid, boolean) IS 'SMS (intern): serializeaza pe cont crearea / aprobarea loturilor de test (pg_advisory_xact_lock pe sms_test_coada:<uid>). p_asteapta = false (triggere): nu asteapta niciodata.';

CREATE FUNCTION public.fn_sms_test_coada_cere(p_uid uuid, p_noi integer) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_coada integer := public.fn_sms_test_coada(p_uid);
BEGIN
  IF v_coada + coalesce(p_noi, 0) > public.fn_sms_test_coada_max() THEN
    RAISE EXCEPTION 'sms test: contul de test poate avea cel mult % mesaje nerezervate in loturile active (are %, cere inca %); anuleaza sau trimite intai',
      public.fn_sms_test_coada_max(), v_coada, coalesce(p_noi, 0) USING ERRCODE = '42501';
  END IF;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_test_coada_cere(uuid, integer) IS 'SMS (intern): refuza (42501) daca coada contului de test + p_noi depaseste fn_sms_test_coada_max(). Se apeleaza dupa fn_sms_test_coada_lock.';

CREATE FUNCTION public.fn_sms_nivel() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.fn_sms_nivel_cont(auth.uid())
$fn$;
COMMENT ON FUNCTION public.fn_sms_nivel() IS 'SMS: nivelul utilizatorului curent: owner / utilizator / test / NULL. Fara parametru (nu poate sonda alte conturi). Folosita de UI si de poarta edge-ului sms-trimite (apelata cu JWT-ul utilizatorului).';

CREATE FUNCTION public.fn_sms_redari_permis() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.fn_sms_nivel_cont(auth.uid())
           WHEN 'owner' THEN true
           WHEN 'utilizator' THEN public.fn_sms_redari_modul_cont(auth.uid())
           ELSE false
         END
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_permis() IS 'SMS (intern): utilizatorul curent are dreptul Redari in SMS (owner, sau utilizator SMS cu modulul Redari editor / admin). Comutatorul Redari (autorizarea scrisa Transgaz) se verifica separat.';

CREATE FUNCTION public.fn_sms_cere_nivel() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v text := public.fn_sms_nivel_cont(auth.uid());
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'sms: nu ai acces la modulul SMS (owner sau nivelul utilizator / test, acordat de Razvan)' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END $fn$;

-- regula unica de vizibilitate / actiune pe un lot (RPC-urile UI, triggerele, rezervarea): comutatorul Redari citit din setari
CREATE FUNCTION public.fn_sms_lot_acces(p_uid uuid, p_nivel text, p_lot public.sms_loturi, p_actiune boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.fn_sms_lot_permis(p_nivel,
           public.fn_sms_redari_modul_cont(p_uid) AND coalesce((SELECT s.redari_autorizat FROM public.sms_setari s WHERE s.id), false),
           coalesce(p_uid IS NOT NULL AND (p_lot).creat_de = p_uid AND (p_lot).creat_nivel = 'test', false),
           (p_lot).categorie, (p_lot).nr_destinatari, p_actiune)
$fn$;
COMMENT ON FUNCTION public.fn_sms_lot_acces(uuid, text, public.sms_loturi, boolean) IS 'SMS (intern): contul / nivelul vede (p_actiune = false) sau poate actiona (true) pe lot. test: doar loturile create de el; utilizator: Redari doar cu modulul Redari si comutatorul pornit.';

CREATE FUNCTION public.fn_sms_cere_lot(p_uid uuid, p_nivel text, p_lot public.sms_loturi) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.fn_sms_lot_acces(p_uid, p_nivel, p_lot, true) THEN RETURN; END IF;
  IF p_nivel = 'test' THEN
    RAISE EXCEPTION 'sms test: contul de test lucreaza doar cu loturile lui interne, de maximum 5 destinatari (fara Redari)' USING ERRCODE = '42501';
  END IF;
  IF p_lot.categorie = 'redari' THEN
    RAISE EXCEPTION 'sms redari: lotul Redari cere modulul Redari (editor / admin) si autorizarea Transgaz pornita' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'sms: nivelul tau nu permite actiunea pe acest lot' USING ERRCODE = '42501';
END $fn$;
COMMENT ON FUNCTION public.fn_sms_cere_lot(uuid, text, public.sms_loturi) IS 'SMS (intern): refuza (42501, cu motivul) o actiune pe lot pe care nivelul nu o permite.';

-- ─── 3. Triggere (aparare in adancime: si pentru postgres / service_role) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_loturi_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; v record; v_niv text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: loturile nu se sterg (anularea e o stare)' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.sms_setari WHERE id;
  -- nivelul SMS al contului din JWT; NULL = fara utilizator (mentenanta postgres, service_role din edge)
  v_niv := public.fn_sms_nivel_cont(auth.uid());
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'sms: un lot nou e mereu draft' USING ERRCODE = '23514'; END IF;
    SELECT * INTO v FROM public.fn_sms_text_verifica(NEW.text);
    IF v.text_final IS DISTINCT FROM NEW.text OR v.text_final = '' OR v.nepermise <> '' OR v.lungime > 160 THEN
      RAISE EXCEPTION 'sms: textul lotului nu e GSM-7 normalizat (fara diacritice, max 160)' USING ERRCODE = '23514';
    END IF;
    IF NEW.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
    IF NEW.uat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = NEW.uat_id AND u.proiect_id = NEW.proiect_id) THEN
      RAISE EXCEPTION 'sms: UAT-ul nu e al proiectului' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := auth.uid(); NEW.creat_la := now(); NEW.creat_nivel := v_niv; NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_nivel := NULL; NEW.aprobat_autorizare_nr := NULL; NEW.aprobat_autorizare_data := NULL; NEW.anulat_de := NULL;
    NEW.anulat_la := NULL; NEW.anulat_nivel := NULL; NEW.motiv_anulare := NULL; NEW.coada_golita_la := NULL; NEW.versiune := 1;
    -- 20261130b: test = doar intern, maximum 5 destinatari; utilizator pe Redari = modulul Redari editor / admin si comutatorul pornit
    IF v_niv IS NOT NULL THEN PERFORM public.fn_sms_cere_lot(auth.uid(), v_niv, NEW); END IF;
    -- r3: coada contului de test (lock-ul consultativ il are deja RPC-ul; la scriere directa nu se asteapta)
    IF v_niv = 'test' THEN
      PERFORM public.fn_sms_test_coada_lock(auth.uid(), false);
      PERFORM public.fn_sms_test_coada_cere(auth.uid(), NEW.nr_destinatari);
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.categorie, NEW.text, NEW.proiect_id, NEW.uat_id, NEW.filtru, NEW.nr_destinatari, NEW.segmente, NEW.cost_estimat_eur,
      NEW.excluse_optout, NEW.excluse_fara_mobil, NEW.creat_de, NEW.creat_la, NEW.creat_nivel)
     IS DISTINCT FROM (OLD.id, OLD.categorie, OLD.text, OLD.proiect_id, OLD.uat_id, OLD.filtru, OLD.nr_destinatari, OLD.segmente, OLD.cost_estimat_eur,
      OLD.excluse_optout, OLD.excluse_fara_mobil, OLD.creat_de, OLD.creat_la, OLD.creat_nivel) THEN
    RAISE EXCEPTION 'sms: continutul unui lot nu se schimba (anuleaza-l si creeaza altul)' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.stare = 'draft' AND NEW.stare IN ('aprobat', 'anulat'))
       OR (OLD.stare = 'aprobat' AND NEW.stare IN ('in_trimitere', 'anulat'))
       OR (OLD.stare = 'in_trimitere' AND NEW.stare IN ('coada_golita', 'anulat'))) THEN
    RAISE EXCEPTION 'sms: trecere de stare nepermisa pentru lot: % -> %', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la; NEW.aprobat_nivel := OLD.aprobat_nivel;
  NEW.aprobat_autorizare_nr := OLD.aprobat_autorizare_nr; NEW.aprobat_autorizare_data := OLD.aprobat_autorizare_data;
  NEW.anulat_de := OLD.anulat_de; NEW.anulat_la := OLD.anulat_la; NEW.anulat_nivel := OLD.anulat_nivel; NEW.coada_golita_la := OLD.coada_golita_la;
  IF NEW.stare <> 'anulat' THEN NEW.motiv_anulare := OLD.motiv_anulare; END IF;
  IF NEW.stare = 'aprobat' THEN
    IF v_niv IS NULL THEN RAISE EXCEPTION 'sms: doar un cont cu acces SMS (owner / utilizator / test) aproba un lot' USING ERRCODE = '42501'; END IF;
    PERFORM public.fn_sms_cere_lot(auth.uid(), v_niv, NEW);
    IF NEW.categorie = 'redari' THEN
      IF NOT coalesce(s.redari_autorizat, false) THEN
        RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
      END IF;
      NEW.aprobat_autorizare_nr := s.redari_autorizare_nr; NEW.aprobat_autorizare_data := s.redari_autorizare_data;
    END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now(); NEW.aprobat_nivel := v_niv;
  ELSIF NEW.stare = 'anulat' THEN
    IF v_niv IS NULL THEN RAISE EXCEPTION 'sms: doar un cont cu acces SMS (owner / utilizator / test) anuleaza un lot' USING ERRCODE = '42501'; END IF;
    PERFORM public.fn_sms_cere_lot(auth.uid(), v_niv, NEW);
    NEW.anulat_de := auth.uid(); NEW.anulat_la := now(); NEW.anulat_nivel := v_niv;
  ELSIF NEW.stare = 'in_trimitere' THEN
    IF coalesce(s.kill_switch, true) THEN RAISE EXCEPTION 'sms: trimiterea e oprita (kill-switch)' USING ERRCODE = '42501'; END IF;
    IF NEW.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
    -- 20261130b: lotul creat / aprobat de un cont test pleaca doar daca e intern, cu maximum 5 destinatari
    IF 'test' IN (coalesce(NEW.creat_nivel, ''), coalesce(NEW.aprobat_nivel, ''))
       AND NOT public.fn_sms_lot_permis('test', false, true, NEW.categorie, NEW.nr_destinatari, true) THEN
      RAISE EXCEPTION 'sms test: lotul unui cont de test pleaca doar intern, cu maximum 5 destinatari' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = NEW.id AND m.stare = 'in_coada') THEN
      RAISE EXCEPTION 'sms: lotul mai are mesaje in coada' USING ERRCODE = '23514';
    END IF;
    NEW.coada_golita_la := now();
  END IF;
  NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_mesaje_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari; v_cd uuid; v_cn text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: mesajele nu se sterg (sunt jurnalul trimiterii)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- r3: ordinea lock-urilor cont de test -> lot (ca la aprobare); contul fara asteptare (in RPC lock-ul e deja luat)
    SELECT x.creat_de, x.creat_nivel INTO v_cd, v_cn FROM public.sms_loturi x WHERE x.id = NEW.lot_id;
    IF v_cn = 'test' THEN PERFORM public.fn_sms_test_coada_lock(v_cd, false); END IF;
    -- 20261130b r2 (P3-01): randul lotului blocat FOR UPDATE inainte de numarare: inserturile concurente in acelasi lot se serializeaza
    SELECT * INTO l FROM public.sms_loturi x WHERE x.id = NEW.lot_id FOR UPDATE;
    IF l.stare IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'sms: mesajele se adauga doar la crearea lotului (draft)' USING ERRCODE = '23514';
    END IF;
    -- 20261130b: lotul unui cont de test are cel mult 5 mesaje (si la scriere directa, ocolind RPC-ul)
    IF 'test' IN (coalesce(l.creat_nivel, ''), coalesce(l.aprobat_nivel, ''))
       AND (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = NEW.lot_id) >= 5 THEN
      RAISE EXCEPTION 'sms test: maximum 5 destinatari intr-un lot' USING ERRCODE = '42501';
    END IF;
    -- r3: fiecare mesaj nou intra in coada contului de test (cel mult fn_sms_test_coada_max() nerezervate)
    IF l.creat_nivel = 'test' THEN
      IF v_cn IS DISTINCT FROM 'test' THEN PERFORM public.fn_sms_test_coada_lock(l.creat_de, false); END IF;
      PERFORM public.fn_sms_test_coada_cere(l.creat_de, 1);
    END IF;
    IF NEW.stare IS DISTINCT FROM 'in_coada' THEN RAISE EXCEPTION 'sms: un mesaj nou e mereu in_coada' USING ERRCODE = '23514'; END IF;
    NEW.furnizor := NULL; NEW.furnizor_id := NULL; NEW.cod_eroare := NULL;
    NEW.rezervat_la := NULL; NEW.trimis_la := NULL; NEW.livrat_la := NULL;
    NEW.creat_la := now(); NEW.actualizat_la := now(); NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.lot_id, NEW.telefon, NEW.destinatar_tip, NEW.destinatar_id, NEW.segmente, NEW.creat_la)
     IS DISTINCT FROM (OLD.id, OLD.lot_id, OLD.telefon, OLD.destinatar_tip, OLD.destinatar_id, OLD.segmente, OLD.creat_la) THEN
    RAISE EXCEPTION 'sms: destinatarul unui mesaj nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF (OLD.furnizor IS NOT NULL AND NEW.furnizor IS DISTINCT FROM OLD.furnizor)
     OR (OLD.furnizor_id IS NOT NULL AND NEW.furnizor_id IS DISTINCT FROM OLD.furnizor_id) THEN
    RAISE EXCEPTION 'sms: furnizorul si id-ul de la furnizor se scriu o singura data' USING ERRCODE = '23514';
  END IF;
  NEW.rezervat_la := OLD.rezervat_la; NEW.trimis_la := OLD.trimis_la; NEW.livrat_la := OLD.livrat_la;
  IF OLD.stare = 'in_coada' AND NEW.stare = 'necunoscut' THEN
    -- rezervarea: din lot in trimitere, cu trimiterea pornita, Redari doar autorizat, fara opt-out, fara id inca
    SELECT * INTO l FROM public.sms_loturi WHERE id = NEW.lot_id;
    SELECT * INTO s FROM public.sms_setari WHERE id;
    IF l.stare IS DISTINCT FROM 'in_trimitere' THEN RAISE EXCEPTION 'sms: mesajul pleaca doar dintr-un lot aprobat, in trimitere' USING ERRCODE = '23514'; END IF;
    IF coalesce(s.kill_switch, true) THEN RAISE EXCEPTION 'sms: trimiterea e oprita (kill-switch)' USING ERRCODE = '42501'; END IF;
    IF l.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
    -- 20261130b: lotul unui cont de test pleaca doar intern, cu maximum 5 destinatari
    IF 'test' IN (coalesce(l.creat_nivel, ''), coalesce(l.aprobat_nivel, ''))
       AND NOT public.fn_sms_lot_permis('test', false, true, l.categorie, l.nr_destinatari, true) THEN
      RAISE EXCEPTION 'sms test: lotul unui cont de test pleaca doar intern, cu maximum 5 destinatari' USING ERRCODE = '42501';
    END IF;
    IF l.creat_nivel = 'test' THEN
      -- r3 (P2-01 a): nivelul ACTUAL al creatorului (dreptul sms viewer inca exista); altfel lotul nu mai pleaca
      IF public.fn_sms_nivel_cont(l.creat_de) IS DISTINCT FROM 'test' THEN
        RAISE EXCEPTION 'sms test: creatorul lotului nu mai are nivelul test (dreptul sms viewer); lotul nu mai pleaca' USING ERRCODE = '42501';
      END IF;
      -- r3 (P3-01 Jakarinos): bugetul se verifica sub acelasi lock ca fn_sms_rezerva (randul de setari). Din fn_sms_rezerva lock-ul e deja
      -- luat (NOWAIT reuseste); la o scriere directa privilegiata nu se asteapta niciodata (55P03), deci nu exista ciclu de lock-uri
      BEGIN
        PERFORM 1 FROM public.sms_setari x WHERE x.id FOR UPDATE NOWAIT;
      EXCEPTION WHEN lock_not_available THEN
        RAISE EXCEPTION 'sms test: o rezervare e in curs; scrierea directa nu asteapta (reincearca)' USING ERRCODE = '55P03';
      END;
      -- 20261130b r2 (P2-01): bugetul zilnic al contului de test, si la scriere directa (randurile deja rezervate in aceeasi comanda se vad)
      IF public.fn_sms_test_consum_zi(l.creat_de) + NEW.segmente > public.fn_sms_test_buget_zi() THEN
        RAISE EXCEPTION 'sms test: bugetul zilnic al contului de test (% SMS) e atins', public.fn_sms_test_buget_zi() USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.furnizor IS NULL OR NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: rezervarea cere furnizorul, fara id' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = NEW.telefon AND o.activ) THEN
      RAISE EXCEPTION 'sms: numarul are opt-out' USING ERRCODE = '23514';
    END IF;
    NEW.rezervat_la := now();
  ELSIF OLD.stare = 'in_coada' AND NEW.stare = 'anulat' THEN
    NULL;
  ELSIF OLD.stare = 'necunoscut' AND NEW.stare = 'trimis' THEN
    IF NEW.furnizor_id IS NULL THEN RAISE EXCEPTION 'sms: trimis cere id-ul de la furnizor' USING ERRCODE = '23514'; END IF;
    NEW.trimis_la := now();
  ELSIF OLD.stare = 'necunoscut' AND NEW.stare IN ('esuat', 'necunoscut') THEN
    IF NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: id-ul de la furnizor vine doar cu trimis' USING ERRCODE = '23514'; END IF;
    IF NEW.cod_eroare IS NULL THEN RAISE EXCEPTION 'sms: esecul / necunoscutul cer un cod' USING ERRCODE = '23514'; END IF;
  ELSIF OLD.stare = 'trimis' AND NEW.stare IN ('livrat', 'esuat') THEN
    IF NEW.stare = 'livrat' THEN NEW.livrat_la := now(); END IF;
  ELSE
    RAISE EXCEPTION 'sms: trecere de stare nepermisa pentru mesaj: % -> %', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  NEW.actualizat_la := now(); NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

-- ─── 4. RLS si vederea sms_v_loturi: NESCHIMBATE (doar owner, ca in 20261130a) ─────────────────────────────────────────────
-- r2 (P1): RLS limiteaza randuri, nu coloane: o politica pe niveluri ar da utilizatorului / testului sms_mesaje.telefon in clar.
-- Utilizatorul si testul citesc DOAR prin fn_sms_loturi_lista si fn_sms_lot_destinatari (mai jos), cu telefonul mascat.

-- ─── 5. RPC-uri pentru UI: owner + utilizator + test (setarile raman ale owner-ului, neschimbate) ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_panou() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; c record; v_niv text; v_ramas integer;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  SELECT * INTO s FROM public.sms_setari WHERE id;
  SELECT * INTO c FROM public.fn_sms_consum();
  v_ramas := greatest(0, least(s.plafon_zi - c.zi, s.plafon_luna - c.luna));
  -- contul de test: si bugetul lui zilnic (loturile lui)
  IF v_niv = 'test' THEN
    v_ramas := greatest(0, least(v_ramas, public.fn_sms_test_buget_zi() - public.fn_sms_test_consum_zi(auth.uid())));
  END IF;
  IF v_niv = 'owner' THEN
    RETURN jsonb_build_object('nivel', v_niv, 'kill_switch', s.kill_switch, 'kill_motiv', s.kill_motiv, 'plafon_zi', s.plafon_zi,
      'plafon_luna', s.plafon_luna, 'consum_zi', c.zi, 'consum_luna', c.luna, 'ramas_zi', v_ramas, 'redari_autorizat', s.redari_autorizat,
      'redari_autorizare_nr', s.redari_autorizare_nr, 'redari_autorizare_data', s.redari_autorizare_data, 'redari_modul', true,
      'versiune', s.versiune, 'actualizat_la', s.actualizat_la, 'max_destinatari', 5000, 'tarif_eur', 0.049, 'max_caractere', 160);
  END IF;
  -- utilizator / test: starea trimiterii si cat se mai poate trimite azi, fara setari (plafoane, motive, versiune, autorizare)
  RETURN jsonb_build_object('nivel', v_niv, 'kill_switch', s.kill_switch, 'ramas_zi', v_ramas, 'redari_autorizat', s.redari_autorizat,
    'redari_modul', public.fn_sms_redari_permis(), 'max_destinatari', CASE WHEN v_niv = 'test' THEN 5 ELSE 5000 END,
    'buget_test_zi', CASE WHEN v_niv = 'test' THEN public.fn_sms_test_buget_zi() END,
    'coada_test_max', CASE WHEN v_niv = 'test' THEN public.fn_sms_test_coada_max() END,
    'coada_test', CASE WHEN v_niv = 'test' THEN public.fn_sms_test_coada(auth.uid()) END, 'tarif_eur', 0.049, 'max_caractere', 160);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_angajati_lista() RETURNS TABLE (id integer, nume text, departament text, telefon_mascat text, optout boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_sms_cere_nivel();
  RETURN QUERY
  SELECT e.id, e.name, e.department,
         CASE WHEN t.tel IS NULL THEN NULL::text ELSE '07** *** ' || right(t.tel, 3) END,
         (t.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = t.tel AND o.activ))
    FROM public.employees e CROSS JOIN LATERAL (SELECT public.fn_sms_tel_normalizat(e.telefon) AS tel) t
   WHERE e.active IS TRUE
   ORDER BY e.name, e.id;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL,
                                                            p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- un singur instantaneu: candidatii (angajati activi din filtre), excluderile si lista finala (un SMS per telefon)
  WITH c AS (
    SELECT e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (coalesce(cardinality(p_angajati), 0) = 0 OR e.id = ANY (p_angajati))
       AND (coalesce(cardinality(p_departamente), 0) = 0 OR e.department = ANY (p_departamente))
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms: niciun angajat activ in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms: niciun destinatar cu mobil RO valid (dupa filtre si opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  -- 20261130b: contul de test, maximum 5 destinatari (si in previzualizare)
  IF v_niv = 'test' AND v_nr > 5 THEN
    RAISE EXCEPTION 'sms test: contul de test trimite unui lot de maximum 5 destinatari (selectia are %)', v_nr USING ERRCODE = '42501';
  END IF;
  -- r3 (P2-01 b): coada contului de test, atomic pe cont (lock consultativ cu asteptare, inainte de orice alt lock; tinut pana la final)
  IF v_niv = 'test' THEN
    PERFORM public.fn_sms_test_coada_lock(auth.uid(), true);
    PERFORM public.fn_sms_test_coada_cere(auth.uid(), v_nr);
  END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0)),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'angajat', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  -- plafonul zilnic e o setare: numarul il vede doar owner-ul; ceilalti afla doar daca lotul il depaseste
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'intern', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'preview', coalesce(p_doar_preview, true), 'nivel', v_niv);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_redari_creeaza(p_text text, p_proiect_id uuid, p_uat_id uuid DEFAULT NULL, p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  -- 20261130b: contul de test nu face loturi Redari; utilizatorul are nevoie si de modulul Redari (editor / admin)
  IF v_niv = 'test' THEN RAISE EXCEPTION 'sms test: contul de test nu face loturi Redari' USING ERRCODE = '42501'; END IF;
  IF NOT public.fn_sms_redari_permis() THEN
    RAISE EXCEPTION 'sms redari: lotul Redari cere si modulul Redari (editor / admin)' USING ERRCODE = '42501';
  END IF;
  -- Decizia lui Razvan (03.11.2026): construit complet, dar BLOCAT pana la autorizarea scrisa Transgaz (sub-imputernicit art. 28 GDPR)
  IF NOT coalesce((SELECT s.redari_autorizat FROM public.sms_setari s WHERE s.id), false) THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit; il seteaza doar owner-ul, cu nr. si data)'
      USING ERRCODE = '42501';
  END IF;
  IF p_proiect_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: proiect inexistent' USING ERRCODE = '22023';
  END IF;
  IF p_uat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = p_uat_id AND u.proiect_id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: UAT-ul nu e al proiectului' USING ERRCODE = '22023';
  END IF;
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- destinatarii = detinatorii (activi, nedecedati) cu convocare activa pe parcelele proiectului / UAT-ului; telefonul din contact
  WITH c AS (
    SELECT DISTINCT d.id, public.fn_sms_tel_normalizat(k.telefon) AS tel
      FROM public.red_convocari cv
      JOIN public.red_detinatori d ON d.id = cv.detinator_id AND d.sters_la IS NULL AND d.decedat IS NOT TRUE
      JOIN public.red_parcele pa ON pa.id = d.parcela_id AND pa.sters_la IS NULL AND pa.proiect_id = p_proiect_id
                                AND (p_uat_id IS NULL OR pa.uat_id = p_uat_id)
      LEFT JOIN public.red_detinatori_contact k ON k.detinator_id = d.id
     WHERE cv.stare = 'activ' AND cv.sters_la IS NULL
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu convocare activa in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu mobil RO valid (dupa opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('redari', v_text, p_proiect_id, p_uat_id, jsonb_build_object('uat_id', p_uat_id), v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'detinator', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'redari', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'preview', coalesce(p_doar_preview, true), 'nivel', v_niv);
END $fn$;

-- Lista FIXATA in lot (si „Mesajele lotului”): exact mesajele din sms_mesaje (nume, telefon MASCAT, stare, momente), plus textul,
-- segmentele, costul, versiunea si daca nivelul permite actiunea. Un lot pe care contul nu il vede = inexistent (P0002).
CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_lista jsonb; v_lungime integer; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id;
  IF NOT FOUND OR NOT public.fn_sms_lot_acces(auth.uid(), v_niv, l, false) THEN
    RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002';
  END IF;
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(l.text) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mesaj_id', x.id, 'destinatar_tip', x.destinatar_tip, 'nume', x.nume,
           'telefon_mascat', '07** *** ' || right(x.telefon, 3), 'stare', x.stare, 'cod_eroare', x.cod_eroare,
           'rezervat_la', x.rezervat_la, 'trimis_la', x.trimis_la, 'livrat_la', x.livrat_la) ORDER BY x.nume, x.id), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT m.id, m.destinatar_tip, m.telefon, m.stare, m.cod_eroare, m.rezervat_la, m.trimis_la, m.livrat_la,
                 coalesce(CASE WHEN m.destinatar_tip = 'angajat' THEN e.name ELSE d.nume END, '(destinatar indisponibil)') AS nume
            FROM public.sms_mesaje m
            LEFT JOIN public.employees e
              ON e.id = CASE WHEN m.destinatar_tip = 'angajat' AND m.destinatar_id ~ '^[0-9]{1,9}$' THEN m.destinatar_id::integer END
            LEFT JOIN public.red_detinatori d
              ON d.id = CASE WHEN m.destinatar_tip = 'detinator' AND m.destinatar_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN m.destinatar_id::uuid END
           WHERE m.lot_id = l.id) x;
  RETURN jsonb_build_object('lot_id', l.id, 'categorie', l.categorie, 'stare', l.stare, 'versiune', l.versiune, 'text', l.text,
    'lungime', v_lungime, 'segmente', l.segmente, 'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur,
    'excluse_optout', l.excluse_optout, 'excluse_fara_mobil', l.excluse_fara_mobil, 'proiect_id', l.proiect_id, 'uat_id', l.uat_id,
    'creat_la', l.creat_la, 'creat_nivel', l.creat_nivel, 'aprobat_nivel', l.aprobat_nivel, 'nivel', v_niv,
    'actiune_permisa', public.fn_sms_lot_acces(auth.uid(), v_niv, l, true), 'destinatari', v_lista);
END $fn$;

-- Istoricul loturilor pentru UI (r2, P1): doar loturile pe care contul le vede (aceeasi regula), cu numaratorile pe stari calculate aici
-- (sursa autorizata, fara telefoane). Inlocuieste citirea directa a vederii sms_v_loturi, care ramane doar a owner-ului.
CREATE FUNCTION public.fn_sms_loturi_lista(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_niv text; v_uid uuid := auth.uid(); v_lista jsonb;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN RAISE EXCEPTION 'sms: p_limit in afara 1..200' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'categorie', x.categorie, 'text', x.text, 'stare', x.stare,
           'proiect_id', x.proiect_id, 'uat_id', x.uat_id, 'nr_destinatari', x.nr_destinatari, 'segmente', x.segmente,
           'cost_estimat_eur', x.cost_estimat_eur, 'excluse_optout', x.excluse_optout, 'excluse_fara_mobil', x.excluse_fara_mobil,
           'creat_de', x.creat_de, 'creat_la', x.creat_la, 'creat_nivel', x.creat_nivel, 'aprobat_de', x.aprobat_de, 'aprobat_la', x.aprobat_la,
           'aprobat_nivel', x.aprobat_nivel, 'aprobat_autorizare_nr', x.aprobat_autorizare_nr, 'aprobat_autorizare_data', x.aprobat_autorizare_data,
           'anulat_de', x.anulat_de, 'anulat_la', x.anulat_la, 'anulat_nivel', x.anulat_nivel, 'motiv_anulare', x.motiv_anulare,
           'coada_golita_la', x.coada_golita_la, 'versiune', x.versiune, 'al_meu', x.creat_de IS NOT DISTINCT FROM v_uid,
           'actiune_permisa', x.actiune_permisa, 'n_in_coada', x.n_in_coada, 'n_necunoscut', x.n_necunoscut, 'n_trimis', x.n_trimis,
           'n_livrat', x.n_livrat, 'n_esuat', x.n_esuat, 'n_anulat', x.n_anulat) ORDER BY x.creat_la DESC, x.id), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT l.*, public.fn_sms_lot_acces(v_uid, v_niv, l, true) AS actiune_permisa, k.*
            FROM public.sms_loturi l
            CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE m.stare = 'in_coada')::integer AS n_in_coada,
                                       count(*) FILTER (WHERE m.stare = 'necunoscut')::integer AS n_necunoscut,
                                       count(*) FILTER (WHERE m.stare = 'trimis')::integer AS n_trimis,
                                       count(*) FILTER (WHERE m.stare = 'livrat')::integer AS n_livrat,
                                       count(*) FILTER (WHERE m.stare = 'esuat')::integer AS n_esuat,
                                       count(*) FILTER (WHERE m.stare = 'anulat')::integer AS n_anulat
                                  FROM public.sms_mesaje m WHERE m.lot_id = l.id) k
           WHERE public.fn_sms_lot_acces(v_uid, v_niv, l, false)
           ORDER BY l.creat_la DESC, l.id
           LIMIT p_limit) x;
  RETURN v_lista;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_loturi_lista(integer) IS 'SMS: istoricul loturilor vizibile contului curent (owner: toate; utilizator: interne + Redari cu modulul Redari si comutatorul pornit; test: doar loturile create de el), cu numaratorile pe stari. Fara telefoane.';

CREATE OR REPLACE FUNCTION public.fn_sms_lot_aproba(p_lot_id uuid, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari; v_n integer; v_niv text; v_cd uuid; v_cn text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  -- ordinea lock-urilor: setari -> contul de test al creatorului (r3) -> lot (ca la rezervare / creare)
  SELECT * INTO s FROM public.sms_setari WHERE id FOR SHARE;
  SELECT x.creat_de, x.creat_nivel INTO v_cd, v_cn FROM public.sms_loturi x WHERE x.id = p_lot_id;
  IF v_cn = 'test' THEN PERFORM public.fn_sms_test_coada_lock(v_cd, true); END IF;
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_sms_lot_acces(auth.uid(), v_niv, l, false) THEN
    RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.fn_sms_cere_lot(auth.uid(), v_niv, l);
  IF l.stare <> 'draft' THEN RAISE EXCEPTION 'sms: doar un lot in draft se aproba (starea: %)', l.stare USING ERRCODE = '23514'; END IF;
  IF p_versiune IS DISTINCT FROM l.versiune THEN
    RAISE EXCEPTION 'sms: lotul s-a schimbat de la previzualizare; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada';
  IF v_n <> l.nr_destinatari THEN
    RAISE EXCEPTION 'sms: lotul nu mai e intreg (% mesaje din %); anuleaza-l si creeaza altul', v_n, l.nr_destinatari USING ERRCODE = '23514';
  END IF;
  -- 20261130b: contul de test aproba doar un lot cu maximum 5 mesaje, numarate acum (nu doar declarate)
  IF v_niv = 'test' AND (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = l.id) > 5 THEN
    RAISE EXCEPTION 'sms test: contul de test aproba doar loturi de maximum 5 destinatari' USING ERRCODE = '42501';
  END IF;
  -- r3 (P2-01): lotul unui cont de test se aproba doar daca acel cont mai are nivelul test si coada lui (cu lotul acesta) e in plafon
  IF l.creat_nivel = 'test' THEN
    IF public.fn_sms_nivel_cont(l.creat_de) IS DISTINCT FROM 'test' THEN
      RAISE EXCEPTION 'sms test: creatorul lotului nu mai are nivelul test (dreptul sms viewer); lotul nu se mai aproba' USING ERRCODE = '42501';
    END IF;
    IF v_cn IS DISTINCT FROM 'test' THEN PERFORM public.fn_sms_test_coada_lock(l.creat_de, true); END IF;
    PERFORM public.fn_sms_test_coada_cere(l.creat_de, 0);
  END IF;
  UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = l.id RETURNING * INTO l;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'aprobat_la', l.aprobat_la, 'versiune', l.versiune,
    'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur, 'aprobat_autorizare_nr', l.aprobat_autorizare_nr,
    'aprobat_nivel', l.aprobat_nivel);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_anuleaza(p_lot_id uuid, p_motiv text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_n integer; c record; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_sms_lot_acces(auth.uid(), v_niv, l, false) THEN
    RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.fn_sms_cere_lot(auth.uid(), v_niv, l);
  IF l.stare NOT IN ('draft', 'aprobat', 'in_trimitere') THEN
    RAISE EXCEPTION 'sms: lotul e deja inchis (%)', l.stare USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_mesaje SET stare = 'anulat', cod_eroare = 'lot_anulat' WHERE lot_id = l.id AND stare = 'in_coada';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sms_loturi SET stare = 'anulat', motiv_anulare = left(nullif(btrim(p_motiv), ''), 500) WHERE id = l.id RETURNING * INTO l;
  -- ce NU mai pleaca (scoase acum din coada) separat de ce era deja rezervat / predat furnizorului (ramane in istoric, nu se opreste)
  SELECT count(*) FILTER (WHERE m.stare = 'necunoscut') AS necunoscut, count(*) FILTER (WHERE m.stare = 'trimis') AS trimis,
         count(*) FILTER (WHERE m.stare = 'livrat') AS livrat, count(*) FILTER (WHERE m.stare = 'esuat') AS esuat
    INTO c FROM public.sms_mesaje m WHERE m.lot_id = l.id;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'mesaje_anulate', v_n,
    'deja_predate', c.necunoscut + c.trimis + c.livrat + c.esuat,
    'deja_rezervate_necunoscut', c.necunoscut, 'deja_trimise', c.trimis, 'deja_livrate', c.livrat, 'deja_esuate', c.esuat,
    'anulat_nivel', l.anulat_nivel);
END $fn$;

-- ─── 6. Rezervarea (doar service_role, din edge): apelantul vine cu uid-ul verificat, nivelul se recalculeaza aici ──────────
DROP FUNCTION public.fn_sms_rezerva(uuid, integer, text);
CREATE FUNCTION public.fn_sms_rezerva(p_lot_id uuid, p_max integer, p_furnizor text, p_apelant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; l public.sms_loturi; c record; v_ora integer; v_rest integer; v_n integer; v_arr jsonb; v_ram integer; v_niv text;
        v_test integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'sms: rezervarea cere izolarea READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF p_max IS NULL OR p_max < 1 OR p_max > 50 THEN RAISE EXCEPTION 'sms: p_max in afara 1..50' USING ERRCODE = '22023'; END IF;
  IF p_furnizor IS NULL OR p_furnizor NOT IN ('smslink', 'simulator') THEN RAISE EXCEPTION 'sms: furnizor necunoscut' USING ERRCODE = '22023'; END IF;
  -- 20261130b: p_apelant = contul care a apasat „Trimite” (uid verificat de edge: auth.getUser + fn_sms_nivel pe JWT-ul lui);
  -- NULL = cronul intern. Nivelul se recalculeaza aici din user_module_access, nu se primeste de la edge.
  IF p_apelant IS NOT NULL THEN
    v_niv := public.fn_sms_nivel_cont(p_apelant);
    IF v_niv IS NULL THEN RAISE EXCEPTION 'sms: apelantul nu are acces la modulul SMS' USING ERRCODE = '42501'; END IF;
    IF p_lot_id IS NULL THEN RAISE EXCEPTION 'sms: trimiterea pornita de un cont cere lotul' USING ERRCODE = '22023'; END IF;
  END IF;
  -- randul de setari FOR UPDATE serializeaza toate rezervarile: kill-switch-ul si plafonul se verifica atomic
  SELECT * INTO s FROM public.sms_setari WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF s.kill_switch THEN RETURN jsonb_build_object('motiv', 'kill_switch', 'mesaje', '[]'::jsonb); END IF;
  v_ora := extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::integer;
  -- cron intern (fara lot): cel mai vechi lot aprobat care poate pleca acum (niciodata un lot de test in afara limitelor sau cu
  -- bugetul zilnic al contului atins)
  IF p_lot_id IS NULL THEN
    SELECT * INTO l FROM public.sms_loturi x
     WHERE x.stare IN ('aprobat', 'in_trimitere') AND (x.categorie = 'intern' OR (s.redari_autorizat AND v_ora BETWEEN 8 AND 19))
       AND NOT ('test' IN (coalesce(x.creat_nivel, ''), coalesce(x.aprobat_nivel, ''))
                AND NOT public.fn_sms_lot_permis('test', false, true, x.categorie, x.nr_destinatari, true))
       AND NOT coalesce(x.creat_nivel = 'test' AND public.fn_sms_test_consum_zi(x.creat_de) + x.segmente > public.fn_sms_test_buget_zi(), false)
       AND NOT coalesce(x.creat_nivel = 'test' AND public.fn_sms_nivel_cont(x.creat_de) IS DISTINCT FROM 'test', false)
     ORDER BY x.aprobat_la, x.id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO l FROM public.sms_loturi x WHERE x.id = p_lot_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('motiv', 'fara_lot', 'mesaje', '[]'::jsonb); END IF;
  -- 20261130b: nivelul apelantului pe lotul cerut (un lot pe care nu il vede = ca inexistent; vazut, dar nepermis = refuz).
  -- r2: testul vede doar loturile create de el; utilizatorul vede Redari doar cu modulul Redari si comutatorul pornit.
  IF p_apelant IS NOT NULL THEN
    IF NOT public.fn_sms_lot_acces(p_apelant, v_niv, l, false) THEN
      RETURN jsonb_build_object('motiv', 'fara_lot', 'mesaje', '[]'::jsonb);
    END IF;
    PERFORM public.fn_sms_cere_lot(p_apelant, v_niv, l);
  END IF;
  -- r3 (P2-01 a): lotul unui cont de test pleaca doar cat creatorul are INCA nivelul test (dreptul sms viewer), oricine porneste
  -- trimiterea (contul, owner-ul, cronul): un drept retras opreste coada lui, fara sa astepte anularea loturilor
  IF l.creat_nivel = 'test' AND public.fn_sms_nivel_cont(l.creat_de) IS DISTINCT FROM 'test' THEN
    RETURN jsonb_build_object('motiv', 'creator_fara_drept', 'lot_id', l.id, 'mesaje', '[]'::jsonb);
  END IF;
  -- lotul unui cont de test, sau trimis de un cont de test: doar intern, maximum 5 mesaje (numarate acum, nu doar declarate)
  IF coalesce(v_niv, '') = 'test' OR 'test' IN (coalesce(l.creat_nivel, ''), coalesce(l.aprobat_nivel, '')) THEN
    IF NOT public.fn_sms_lot_permis('test', false, true, l.categorie, l.nr_destinatari, true)
       OR (SELECT count(*) FROM public.sms_mesaje m WHERE m.lot_id = l.id) > 5 THEN
      RAISE EXCEPTION 'sms test: contul de test trimite doar loturi interne de maximum 5 destinatari (fara Redari)' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF l.stare NOT IN ('aprobat', 'in_trimitere') THEN RETURN jsonb_build_object('motiv', 'lot_' || l.stare, 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN RETURN jsonb_build_object('motiv', 'redari_neautorizat', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND v_ora NOT BETWEEN 8 AND 19 THEN RETURN jsonb_build_object('motiv', 'in_afara_orelor', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  SELECT * INTO c FROM public.fn_sms_consum();
  IF c.luna >= s.plafon_luna THEN RETURN jsonb_build_object('motiv', 'plafon_luna', 'lot_id', l.id, 'consum_luna', c.luna, 'mesaje', '[]'::jsonb); END IF;
  IF c.zi >= s.plafon_zi THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
  v_rest := least(s.plafon_zi - c.zi, s.plafon_luna - c.luna) / l.segmente;
  v_n := least(p_max, v_rest);
  IF v_n < 1 THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
  -- 20261130b r2 (P2-01): bugetul zilnic al contului de test (toate loturile create de el), oricine porneste trimiterea; atomic, sub
  -- randul de setari blocat mai sus; numara orice mesaj rezervat azi (si necunoscut), deci nu se elibereaza prin anulare sau recreare
  IF l.creat_nivel = 'test' THEN
    v_test := public.fn_sms_test_buget_zi() - public.fn_sms_test_consum_zi(l.creat_de);
    IF v_test < l.segmente THEN
      RETURN jsonb_build_object('motiv', 'buget_test_zi', 'lot_id', l.id, 'buget_test_zi', public.fn_sms_test_buget_zi(), 'mesaje', '[]'::jsonb);
    END IF;
    v_n := least(v_n, v_test / l.segmente);
  END IF;
  IF l.stare = 'aprobat' THEN UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = l.id; END IF;
  -- opt-out verificat din nou la trimitere: numarul iese din lot (anulat), nu pleaca
  UPDATE public.sms_mesaje m SET stare = 'anulat', cod_eroare = 'optout'
   WHERE m.lot_id = l.id AND m.stare = 'in_coada' AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = m.telefon AND o.activ);
  WITH x AS (
    SELECT m.id FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada' ORDER BY m.creat_la, m.id LIMIT v_n FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.sms_mesaje m SET stare = 'necunoscut', furnizor = p_furnizor FROM x WHERE m.id = x.id RETURNING m.id, m.telefon, m.segmente
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'telefon', u.telefon, 'segmente', u.segmente) ORDER BY u.id), '[]'::jsonb) INTO v_arr FROM u;
  SELECT count(*) INTO v_ram FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada';
  -- coada goala: lotul NU e „trimis” (mesajele pot fi inca necunoscut); rezultatul real ramane pe mesaje
  IF v_ram = 0 THEN UPDATE public.sms_loturi SET stare = 'coada_golita' WHERE id = l.id AND stare = 'in_trimitere'; END IF;
  RETURN jsonb_build_object('motiv', CASE WHEN jsonb_array_length(v_arr) > 0 THEN 'ok' ELSE 'gata' END, 'lot_id', l.id, 'categorie', l.categorie,
    'text', l.text, 'mesaje', v_arr, 'ramase', v_ram);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_rezerva(uuid, integer, text, uuid) IS 'SMS (doar service_role, din edge sms-trimite dupa poarta owner / nivel SMS / cron intern): rezerva ATOMIC pana la p_max mesaje ale unui lot aprobat, sub kill-switch, plafoane si bugetul zilnic al contului de test. p_apelant = uid-ul care a pornit trimiterea (nivelul i se recalculeaza aici; test = doar loturile lui, interne, maximum 5 destinatari); NULL = cronul intern. Mesajele rezervate trec in necunoscut (fara rezultat = nu se retrimit).';

-- ─── 7. Drepturi (privilegiile implicite Supabase dau EXECUTE pe functii noi: se scot explicit) ────────────────────────────
REVOKE ALL ON FUNCTION
  public.fn_sms_nivel_cont(uuid), public.fn_sms_redari_modul_cont(uuid), public.fn_sms_lot_permis(text, boolean, boolean, text, integer, boolean),
  public.fn_sms_test_buget_zi(), public.fn_sms_test_consum_zi(uuid), public.fn_sms_test_coada_max(), public.fn_sms_test_coada(uuid),
  public.fn_sms_test_coada_lock(uuid, boolean), public.fn_sms_test_coada_cere(uuid, integer), public.fn_sms_nivel(), public.fn_sms_redari_permis(),
  public.fn_sms_cere_nivel(), public.fn_sms_lot_acces(uuid, text, public.sms_loturi, boolean), public.fn_sms_cere_lot(uuid, text, public.sms_loturi),
  public.fn_sms_loturi_lista(integer), public.fn_sms_rezerva(uuid, integer, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_nivel(), public.fn_sms_loturi_lista(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sms_rezerva(uuid, integer, text, uuid) TO service_role;

DO $post$
DECLARE v_t text; v_o oid; v_n integer;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_e_owner()', 'public.fn_sms_nivel()', 'public.fn_sms_loturi_lista(integer)', 'public.fn_sms_panou()',
    'public.fn_sms_angajati_lista()', 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)',
    'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'public.fn_sms_lot_destinatari(uuid)', 'public.fn_sms_lot_aproba(uuid,integer)',
    'public.fn_sms_lot_anuleaza(uuid,text)', 'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)',
    'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', 'public.fn_sms_optout_seteaza(text,boolean,text)']::regprocedure[];
  v_serviciu regprocedure[] := ARRAY['public.fn_sms_rezerva(uuid,integer,text,uuid)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)',
    'public.fn_sms_dlr_aplica(text,text,boolean,timestamptz)']::regprocedure[];
  v_pure regprocedure[] := ARRAY['public.fn_sms_tel_normalizat(text)', 'public.fn_sms_text_final(text)', 'public.fn_sms_text_verifica(text)',
    'public.fn_sms_text_valid(text)', 'public.fn_sms_lot_permis(text,boolean,boolean,text,integer,boolean)', 'public.fn_sms_test_buget_zi()',
    'public.fn_sms_test_coada_max()']::regprocedure[];
BEGIN
  -- r2 (P1): politicile RLS si vederea raman exact cele din 20261130a (citirea directa = doar owner)
  FOREACH v_t IN ARRAY ARRAY['sms_setari', 'sms_loturi', 'sms_mesaje', 'sms_optout', 'sms_dlr'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN RAISE EXCEPTION '20261130b: RLS oprit pe %', v_t; END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t) <> 1
       OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd = 'SELECT' AND roles = '{authenticated}') <> 1
       OR (SELECT qual = '( SELECT fn_sms_e_owner() AS fn_sms_e_owner)' FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t) IS NOT TRUE THEN
      RAISE EXCEPTION '20261130b: politici gresite pe % (trebuie sa ramana doar owner)', v_t;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || v_t)::regclass AND NOT tgisinternal) <> 1 THEN RAISE EXCEPTION '20261130b: triggere pe %', v_t; END IF;
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('authenticated', 'public.' || v_t, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('service_role', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION '20261130b: drepturi gresite pe %', v_t;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.sms_v_loturi', 'SELECT') OR has_table_privilege('authenticated', 'public.sms_v_loturi', 'INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'public.sms_v_loturi', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.sms_v_loturi', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.sms_v_loturi'::regclass AND reloptions::text ~ 'security_invoker=(on|true)')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_v_loturi') <> 28 THEN
    RAISE EXCEPTION '20261130b: vederea sms_v_loturi trebuie sa ramana cea din 20261130a';
  END IF;
  -- functiile: search_path fixat, SECURITY DEFINER (in afara celor pure), fara EXECUTE pentru PUBLIC / anon, EXECUTE exact pe liste
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!';
  IF v_n <> 40 THEN RAISE EXCEPTION '20261130b: % functii fn_sms_* (asteptat 40)', v_n; END IF;
  IF to_regprocedure('public.fn_sms_rezerva(uuid,integer,text)') IS NOT NULL THEN RAISE EXCEPTION '20261130b: fn_sms_rezerva cu 3 argumente a ramas'; END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_o) IS DISTINCT FROM (NOT (v_o::regprocedure = ANY (v_pure)))
       OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_o)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_expuse))
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_serviciu)) THEN
      RAISE EXCEPTION '20261130b: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
    -- echivalentul local al portii permanente 0e (scripts/control_0e.sql) pe functiile expuse
    IF v_o::regprocedure = ANY (v_expuse) AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o
         AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]u&)') THEN
      RAISE EXCEPTION '20261130b: functia expusa % contine o constructie interzisa de poarta 0e', v_o::regprocedure;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'sms' AND is_active AND parent_key IS NULL) THEN RAISE EXCEPTION '20261130b: cheia de modul sms lipseste'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'sms') THEN RAISE EXCEPTION '20261130b: migrarea nu acorda drepturi SMS'; END IF;
  -- regulile de nivel (pure): test doar pe loturile lui, interne, actiuni pe 1-5; utilizator pe Redari doar cu p_redari_ok
  IF public.fn_sms_lot_permis('test', false, true, 'intern', 5, true) IS NOT TRUE OR public.fn_sms_lot_permis('test', false, true, 'intern', 6, true)
     OR public.fn_sms_lot_permis('test', false, false, 'intern', 1, false) OR public.fn_sms_lot_permis('test', true, true, 'redari', 1, false)
     OR public.fn_sms_lot_permis('utilizator', false, false, 'redari', 1, false)
     OR public.fn_sms_lot_permis('utilizator', true, false, 'redari', 1, true) IS NOT TRUE
     OR public.fn_sms_lot_permis('utilizator', false, false, 'intern', 4000, true) IS NOT TRUE
     OR public.fn_sms_lot_permis(NULL, true, true, 'intern', 1, false) OR public.fn_sms_nivel_cont(NULL) IS NOT NULL
     OR public.fn_sms_lot_permis('test', false, true, 'intern', 6, false) OR public.fn_sms_lot_permis('test', false, true, 'intern', 0, false)
     OR public.fn_sms_test_buget_zi() <> 10 OR public.fn_sms_test_coada_max() <> 10 THEN
    RAISE EXCEPTION '20261130b: regulile de nivel nu sunt cele asteptate';
  END IF;
END $post$;
