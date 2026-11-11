-- Revenire 20261209a_executie_acces_proiect. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelul executie_acces_proiect, cele 16 funcții (lista exactă; r6: + nerestrans_cont, lista_cont, candidati;
-- r8: − parinti, + obiect_permis; r9: − obiect_proiecte, − inbox_obiect, + inbox_propriu; r10: − inbox_propriu; r11: obiect_permis cu al 4-lea argument;
-- r12: + inbox_propriu_liber; r13: − inbox_rand, − inbox_propriu_liber, obiect_permis din nou cu 3 argumente), politicile RESTRICTIVE executie_acces_*
-- și trigger-ele trg_executie_acces_garda de pe tabelele 'proiect' / 'proiect_optional' / 'copil' din inventar (r4: și antetul
-- raportului zilnic, graficul intern), trigger-ul a0_executie_acces_inbox de pe coada Inboxului AI (r13), cele 4 politici de pe
-- storage.objects, și redă EXACT corpurile vechi ale celor 5 funcții de drept (fn_executie_nod_drept / contract / grafic / tinte,
-- fn_raport_santier_drept) și al predicatului Inboxului fn_ai_inbox_poate_confirma (r13), cu amprenta verificată înainte și după;
-- mută înapoi în public originalul fn_executie_swap_tevi_pozitie (neschimbat) și șterge schema internă (r3).
-- REFUZĂ dacă vreun cont e restrâns (are rânduri): după revenire acel cont ar vedea DIN NOU toate proiectele, pe tăcute. Scoaterea
-- restricțiilor e o decizie separată (din ecranul owner-ului, „scoate restricția”, sau preview -> „da” Răzvan -> apply).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261209a SCOATE_ACCES_PROIECT
-- Ordinea lock-urilor: executie_acces_proiect ACCESS EXCLUSIVE NOWAIT ÎNAINTEA verificării „fără rânduri” (o setare concurentă nu poate fi
-- numărată 0 și apoi pierdută la DROP), apoi tabelele acoperite, în ordinea numelui, ACCESS EXCLUSIVE NOWAIT; storage.objects la DROP POLICY
-- (lock_timeout 5s). Ocupat = 55P03, nimic scris.
-- Trebuie rulată ÎNAINTEA revenirii oricăreia dintre 20261201a / 20261203a / 20261204a / 20261208a (acelea verifică amprenta veche).
-- ORDINEA REVENIRII (r8, review SQL P2-03): (1) restricțiile scoase din ecranul owner-ului („scoate restricția” pe fiecare cont; altfel
-- fișierul refuză), (2) DOAR dacă edge-ul citeste-orice v19 a fost publicat (r13: nu mai e cerut pentru siguranță): înapoi la versiunea
-- care NU cheamă fn_executie_acces_candidati (cu v19 rămasă, după acest fișier documentele de Execuție cu indiciu de proiect pot intra
-- în eroare), (3) abia apoi acest fișier, armat.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
DECLARE r record; v_n integer; v_swap text; v_inbox text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261209a', true) IS DISTINCT FROM 'SCOATE_ACCES_PROIECT:' || txid_current() THEN
    RAISE EXCEPTION '20261209a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261209a=%') THEN
    RAISE EXCEPTION '20261209a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261209a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelul, cele 16 funcții, corpurile noi ale funcțiilor de drept și al predicatului Inboxului (r13)
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['fn_executie_acces_inventar', 'fn_executie_acces_e_owner', 'fn_executie_acces_nerestrans',
            'fn_executie_acces_lista', 'fn_executie_proiect_permis', 'fn_executie_acces_parinte_permis', 'fn_executie_acces_obiect_permis',
            'fn_executie_acces_canon', 'fn_executie_acces_proiect_seteaza', 'fn_executie_acces_proiect_prov',
            'fn_executie_acces_garda', 'fn_executie_acces_garda_copil', 'fn_executie_acces_garda_inbox',
            'fn_executie_acces_nerestrans_cont', 'fn_executie_acces_lista_cont', 'fn_executie_acces_candidati']::name[])) <> 16
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 16
     OR to_regprocedure('public.fn_executie_acces_obiect_permis(text, text, boolean)') IS NULL
     OR (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ai_inbox_poate_confirma(text, bigint)'))
        IS DISTINCT FROM 'ee831a07d9ec33ea5be8de44a2d0a00c'
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_ai_inbox_poate_confirma') <> 1
     OR EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '1f0faa030d0459412aafb6e1a024beff'),
               ('public.fn_executie_contract_drept(bigint, boolean)', 'f3c3dc6add32d563682494e804864e99'),
               ('public.fn_executie_grafic_drept(bigint)', '5df5d4ecce38a81472fc4f17cf410b97'),
               ('public.fn_executie_tinte_drept(bigint, text)', '9bc9c10212d8f0a7ca5ad94e0220c7c2'),
               ('public.fn_raport_santier_drept(bigint)', '640bdc86e81468fc7c5025f6eb54a23f')) a(semnatura, amprenta)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta)
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_acces\_%') <> 4 THEN
    RAISE EXCEPTION '20261209a revenire: starea nu e cea din 20261209a';
  END IF;
  -- poarta (6b): poarta revizuită în public, originalul (amprenta din inventar) în schema internă, nimic altceva acolo
  SELECT i.cheie INTO v_swap FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'functie' AND i.obiect = 'fn_executie_swap_tevi_pozitie' AND i.clasa = 'poarta';
  IF v_swap IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                     AND md5(replace(p.prosrc, chr(13), '')) = 'ab1f7875a2784791f9584580b71be38f')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                     AND md5(replace(p.prosrc, chr(13), '')) = v_swap)
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'executie_acces_intern')) <> 1
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'executie_acces_intern')) THEN
    RAISE EXCEPTION '20261209a revenire: poarta / originalul fn_executie_swap_tevi_pozitie difera de cele din 20261209a';
  END IF;
  -- r13: amprenta veche a predicatului Inboxului (din inventar), verificată după redare
  SELECT i.cheie INTO v_inbox FROM public.fn_executie_acces_inventar() i WHERE i.tip = 'functie' AND i.obiect = 'fn_ai_inbox_poate_confirma' AND i.clasa = 'inbox';
  IF v_inbox IS NULL THEN
    RAISE EXCEPTION '20261209a revenire: inventarul nu are amprenta veche a lui fn_ai_inbox_poate_confirma';
  END IF;
  -- lock ÎNAINTE de numărare
  LOCK TABLE public.executie_acces_proiect IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;
  -- tabelele acoperite: din inventarul migrării (aceeași listă), în ordinea numelui
  v_n := 0;
  -- (r13: trigger-ul cozii Inboxului se numește a0_executie_acces_inbox, ca să ruleze primul)
  FOR r IN SELECT obiect, CASE clasa WHEN 'inbox' THEN 'a0_executie_acces_inbox' ELSE 'trg_executie_acces_garda' END AS tg_nume
             FROM public.fn_executie_acces_inventar() WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox') ORDER BY obiect LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE NOWAIT', r.obiect);
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.' || r.obiect) AND polname LIKE 'executie\_acces\_%') <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || r.obiect) AND tgname = r.tg_nume) THEN
      RAISE EXCEPTION '20261209a revenire: politicile / trigger-ul lipsesc pe %', r.obiect;
    END IF;
    EXECUTE format('DROP TRIGGER %I ON public.%I', r.tg_nume, r.obiect);
    EXECUTE format('DROP POLICY executie_acces_citire ON public.%I', r.obiect);
    EXECUTE format('DROP POLICY executie_acces_adauga ON public.%I', r.obiect);
    EXECUTE format('DROP POLICY executie_acces_modifica ON public.%I', r.obiect);
    EXECUTE format('DROP POLICY executie_acces_sterge ON public.%I', r.obiect);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_executie_acces_garda', 'a0_executie_acces_inbox')) THEN
    RAISE EXCEPTION '20261209a revenire: au ramas trigger-e de garda in afara inventarului';
  END IF;
  DROP POLICY executie_acces_obiect_citire ON storage.objects;
  DROP POLICY executie_acces_obiect_adauga ON storage.objects;
  DROP POLICY executie_acces_obiect_modifica ON storage.objects;
  DROP POLICY executie_acces_obiect_sterge ON storage.objects;
  -- poarta jos, originalul înapoi în public NESCHIMBAT (corp, owner, drepturi, OID), schema internă ștearsă (RESTRICT: goală)
  DROP FUNCTION public.fn_executie_swap_tevi_pozitie(bigint, bigint);
  ALTER FUNCTION executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint) SET SCHEMA public;
  DROP SCHEMA executie_acces_intern;

  -- corpurile vechi, EXACT ca în 20261201a / 20261203a / 20261204a / 20261208a (CREATE OR REPLACE păstrează owner / ACL)
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level = 'admin' OR (p_scriere IS FALSE AND u.access_level IN ('viewer', 'editor')))))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_grafic_drept(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_tinte_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'configurare')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_nivel = 'citire' AND u.access_level = 'viewer')))
         OR (p_nivel = 'citire' AND EXISTS (
               SELECT 1 FROM public.profile_sites ps JOIN public.sites s ON s.id = ps.site_id
                WHERE ps.profile_id = auth.uid() AND s.proiect_id = p_proiect
                  AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date))))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_raport_santier_drept(p_site bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_site IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profile_sites ps WHERE ps.profile_id = auth.uid() AND ps.site_id = p_site
                      AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date)))
$f$$sql$;
  -- r13: predicatul Inboxului, EXACT corpul de dinainte de 20261209a (amprenta din inventar, verificată în postcondiții); CREATE OR
  -- REPLACE păstrează OID-ul (politicile din 20261103c), owner-ul și drepturile. Trebuie înaintea DROP-ului lui
  -- fn_executie_acces_nerestrans_cont, pe care corpul nou îl cheamă.
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_ai_inbox_poate_confirma(p_modul text, p_entitate_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid UUID := auth.uid(); v_owner BOOLEAN; v_rec RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN true; END IF;  -- service_role / migrări
  SELECT is_owner, role, can_access_personal_data, can_access_financiar
    INTO v_rec FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_rec.is_owner THEN RETURN true; END IF;              -- owner vede tot
  IF p_modul IS NULL THEN RETURN true; END IF;             -- coada „nedecis": oricine logat
  IF p_modul = 'hr'         THEN RETURN COALESCE(v_rec.can_access_personal_data,false); END IF;
  IF p_modul = 'logistica'  THEN RETURN v_rec.role = 'admin_logistica'; END IF;
  IF p_modul = 'financiar'  THEN RETURN COALESCE(v_rec.can_access_financiar,false); END IF;
  IF p_modul = 'executie'   THEN
    -- MP: are profile_sites pe site_id-ul proiectului documentului
    IF p_entitate_id IS NULL THEN RETURN false; END IF;    -- fără proiect determinat → owner-only
    RETURN EXISTS (
      SELECT 1 FROM public.executie_proiecte ep
      JOIN public.profile_sites ps ON ps.site_id = ep.site_id AND ps.profile_id = v_uid
      WHERE ep.id = p_entitate_id
        AND (ps.valid_until IS NULL OR ps.valid_until >= CURRENT_DATE)
    );
  END IF;
  RETURN false;
END $function$$sql$;

  DROP FUNCTION public.fn_executie_acces_candidati(uuid);   -- r6 (edge-ul citeste-orice revine singur la calea de azi, fără funcție)
  DROP FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb);
  DROP FUNCTION public.fn_executie_acces_canon(jsonb);
  DROP FUNCTION public.fn_executie_acces_garda();
  DROP FUNCTION public.fn_executie_acces_garda_copil();
  DROP FUNCTION public.fn_executie_acces_garda_inbox();
  DROP FUNCTION public.fn_executie_acces_obiect_permis(text, text, boolean);   -- r8 (predicatul Storage public; r13: din nou 3 argumente)
  DROP FUNCTION public.fn_executie_acces_parinte_permis(text, bigint, boolean);
  DROP FUNCTION public.fn_executie_proiect_permis(bigint, boolean);
  DROP TABLE public.executie_acces_proiect;   -- ia cu el politica și trigger-ul de proveniență
  DROP FUNCTION public.fn_executie_acces_proiect_prov();
  DROP FUNCTION public.fn_executie_acces_lista(boolean);
  DROP FUNCTION public.fn_executie_acces_nerestrans();
  DROP FUNCTION public.fn_executie_acces_lista_cont(uuid, boolean);
  DROP FUNCTION public.fn_executie_acces_nerestrans_cont(uuid);
  DROP FUNCTION public.fn_executie_acces_e_owner();
  DROP FUNCTION public.fn_executie_acces_inventar();

  -- postcondiții: amprentele vechi la loc, nimic rămas
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '144649bae9a218b41b7e6df90cba5d9e', true, true),
               ('public.fn_executie_contract_drept(bigint, boolean)', '85a131c3aa59813b1a8cb8535c53e703', true, true),
               ('public.fn_executie_grafic_drept(bigint)', '1dbaedfd117f7234a6e30fdaf856ac7b', true, true),
               ('public.fn_executie_tinte_drept(bigint, text)', 'bda0b6c3e01a5a039732b2713df8ebab', false, true),
               ('public.fn_raport_santier_drept(bigint)', '2c8833d76db7145ab0bd2fc5103e55e9', false, false)) a(semnatura, amprenta, cu_service, cu_auth)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prosecdef IS NOT TRUE OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service) THEN
    RAISE EXCEPTION '20261209a revenire post: functiile de drept nu au revenit la amprenta veche';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ai_inbox_poate_confirma(text, bigint)')
                  AND md5(replace(p.prosrc, chr(13), '')) = v_inbox AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261209a revenire post: fn_ai_inbox_poate_confirma nu a revenit la amprenta veche';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')
                  AND md5(replace(p.prosrc, chr(13), '')) = v_swap AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_swap_tevi_pozitie') <> 1
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'executie_acces_intern') THEN
    RAISE EXCEPTION '20261209a revenire post: fn_executie_swap_tevi_pozitie nu a revenit (originalul in public, schema interna stearsa)';
  END IF;
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis'))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_executie_acces_garda', 'a0_executie_acces_inbox')) THEN
    RAISE EXCEPTION '20261209a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.revenire_20261209a', true) IS DISTINCT FROM 'SCOATE_ACCES_PROIECT:' || txid_current() THEN
    RAISE EXCEPTION '20261209a revenire: garda final invalida';
  END IF;
END $revenire$;
