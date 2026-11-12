-- ════════════════════════════════════════════════════════════════════════════
-- REVENIRE 20261131e — „❓ Întreabă echipa” din cercetare (NEAPLICAT; artefact de revenire, FĂRĂ GO de execuție).
-- Readuce starea exactă de după 20261105a: fără `surse` / `de_verificat_la` / `interogari_web`, fără starea 'de_verificat',
-- fără jurnalul `intrebari_preluari`, fără fn_intrebari_de_verificat / fn_intrebari_reia; fn_intrebari_raspunde cu 6 parametri,
-- fn_intrebari_preia / fn_intrebari_amana / fn_intrebari_inainte_insert cu corpurile VERBATIM din 20261105a.
-- Consecință: plafonul de 40/zi revine la numărarea din preluat_la / raspuns_la (fără reluare în UI, gaura P1-c nu se redeschide).
-- Runda 4 (review r3 P2 / L15): înainte de orice DROP, fiecare funcție trebuie să fie EXACT versiunea 20261131e (md5 pe corpul fără
-- CR + SECURITY DEFINER, search_path, proprietar, o singură supraîncărcare) — o versiune ulterioară sub același nume = refuz; după
-- revenire, corpurile readuse se verifică la fel față de 20261105a (md5-urile le recalculează scripts/intrebari_cercetare_amprente.test.js).
--
-- BLOC TRANZACȚIONAL COMPLET: gestionarul tranzacției e operatorul (convenția supabase/revenire/README.md — fișierul nu are
-- BEGIN/COMMIT); armarea e legată de txid_current(), deci rulat în afara unei tranzacții explicite fișierul REFUZĂ
-- (fiecare instrucțiune ar avea alt txid). Orice eroare ⇒ ROLLBACK la tot. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261131e', 'SCOATE_CERCETARE:' || txid_current(), true);
--   <conținutul exact al acestui fișier>
--   COMMIT;
-- Două niveluri de armare:
--   SCOATE_CERCETARE           — DOAR dacă nu există date noi: nicio întrebare cu surse / interogari_web nenule, în 'de_verificat'
--                                sau marcată vreodată (de_verificat_la), și niciun rând de jurnal de după livrare (NOT din_istoric).
--                                Altfel REFUZ (nu se pierde nimic pe tăcute).
--   SCOATE_CERCETARE_ARHIVEAZA — după decizia lui Răzvan: copiază EXPLICIT datele noi (sursele, interogările, marcajele și tot
--                                jurnalul de preluări, cu costul pe încercare) în public.intrebari_cercetare_arhiva_20261131e
--                                (RLS activ, fără politici, SELECT doar service_role), trece 'de_verificat' → 'raspuns', apoi scoate.
-- harness-armare: gazpet.revenire_20261131e SCOATE_CERCETARE
-- ORDINEA: întâi edge-ul intrebari-tehnice-worker v1 și workerul de dinainte de cercetare (edge-ul v2 trimite p_surse /
--   p_interogari, pe care funcția cu 6 parametri nu le are), apoi acest fișier; UI-ul de pe main merge pe coloanele v1 (fallback).
-- ════════════════════════════════════════════════════════════════════════════
DO $start$
DECLARE
  v text := current_setting('gazpet.revenire_20261131e', true);
  v_date_noi boolean;
  -- runda 4 (review r3 P2 / L15): md5(corpul fără CR) al FIECĂREI funcții create / înlocuite de 20261131e — aceleași valori ca în
  -- postcondiția migrării (testul vitest scripts/intrebari_cercetare_amprente.test.js le recalculează din migrarea din repo)
  c_mig CONSTANT jsonb := '{
    "public.fn_intrebari_amana(bigint,uuid)": "badeb4273e51b12d4ba868bc67312148",
    "public.fn_intrebari_de_verificat(bigint)": "532002403818cdb223e896c971abce0e",
    "public.fn_intrebari_inainte_insert()": "faeca2cd890341524950ca45d0d5156d",
    "public.fn_intrebari_preia()": "65336457781dc5a796376bdaadd31b54",
    "public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)": "1c676fa234d086b8e8368eaa04414b5a",
    "public.fn_intrebari_reia(bigint)": "8745d896032fb72cda593ca11f3f6bd7"
  }'::jsonb;
  k text;
  f record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261131e revenire: doar postgres'; END IF;
  IF v IS DISTINCT FROM 'SCOATE_CERCETARE:' || txid_current() AND v IS DISTINCT FROM 'SCOATE_CERCETARE_ARHIVEAZA:' || txid_current() THEN
    RAISE EXCEPTION '20261131e revenire: nearmat (armarea trebuie făcută în aceeași tranzacție)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261131e=%') THEN
    RAISE EXCEPTION '20261131e revenire: armare persistentă refuzată';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131e revenire: doar READ COMMITTED (altfel numărarea datelor noi poate fi pe un instantaneu vechi)';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- lock ÎNAINTEA verificărilor: o preluare / un răspuns concurent nu poate scrie între numărare și DROP
  LOCK TABLE public.intrebari_tehnice, public.intrebari_preluari IN ACCESS EXCLUSIVE MODE;

  -- precondiție: exact obiectele lui 20261131e
  IF to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_de_verificat(bigint)') IS NULL
     OR to_regprocedure('public.fn_intrebari_reia(bigint)') IS NULL
     OR to_regprocedure('public.fn_intrebari_preia()') IS NULL
     OR to_regprocedure('public.fn_intrebari_amana(bigint,uuid)') IS NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intrebari_tehnice'
           AND column_name IN ('surse', 'de_verificat_la', 'interogari_web')) <> 3
     OR to_regclass('public.intrebari_cercetare_arhiva_20261131e') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_surse_lista')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_interogari_lista')
     -- nimic altceva nu depinde de jurnal sau de coloanele noi (DROP fără CASCADE ar eșua oricum; aici refuzul e explicit)
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                 WHERE rw.ev_class <> d.refobjid
                   AND (d.refobjid = to_regclass('public.intrebari_preluari')
                        OR (d.refobjid = 'public.intrebari_tehnice'::regclass AND d.refobjsubid IN (
                              SELECT attnum FROM pg_attribute WHERE attrelid = 'public.intrebari_tehnice'::regclass
                                AND attname IN ('surse', 'de_verificat_la', 'interogari_web')))))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid = to_regclass('public.intrebari_preluari'))
     -- nimic nou agățat de jurnal (trigger / politică), iar triggerul de inserare e tot cel din 20261105a, pe funcția de mai jos
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.intrebari_preluari') AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.intrebari_tehnice'::regclass AND t.tgname = 'intrebari_tehnice_inainte_insert'
                      AND t.tgfoid = 'public.fn_intrebari_inainte_insert()'::regprocedure AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '20261131e revenire: starea nu e exact cea a lui 20261131e';
  END IF;
  -- exact versiunea 20261131e a fiecărei funcții (corp + atribute), nu fragmente de text: o versiune ulterioară sub același nume
  -- (alt corp, SECURITY INVOKER, alt search_path / proprietar, o supraîncărcare nouă) = REFUZ — revenirea nu suprascrie munca altei
  -- migrări cu corpurile din 20261105a
  FOR k IN SELECT jsonb_object_keys(c_mig) LOOP
    SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, l.lanname, md5(replace(p.prosrc, chr(13), '')) AS corp,
           (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS supraincarcari
      INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(k);
    IF NOT FOUND OR f.corp IS DISTINCT FROM c_mig->>k THEN
      RAISE EXCEPTION '20261131e revenire: % are alt corp decat versiunea 20261131e (alta versiune sub acelasi nume) - refuz', k;
    END IF;
    IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR f.owner IS DISTINCT FROM 'postgres'
       OR f.lanname <> 'plpgsql' OR f.supraincarcari <> 1 THEN
      RAISE EXCEPTION '20261131e revenire: atributele % difera de versiunea 20261131e - refuz', k;
    END IF;
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM public.intrebari_tehnice
                  WHERE surse IS DISTINCT FROM '[]'::jsonb OR interogari_web IS DISTINCT FROM '[]'::jsonb
                     OR stare = 'de_verificat' OR de_verificat_la IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.intrebari_preluari WHERE NOT din_istoric)
    INTO v_date_noi;
  IF v_date_noi AND v = 'SCOATE_CERCETARE:' || txid_current() THEN
    RAISE EXCEPTION '20261131e revenire: există date noi (surse / interogări / de_verificat / preluări după livrare) — nu se pierd pe tăcute. După decizia lui Răzvan: token SCOATE_CERCETARE_ARHIVEAZA (le copiază în intrebari_cercetare_arhiva_20261131e).';
  END IF;
END $start$;

-- ─── arhivarea explicită (doar cu SCOATE_CERCETARE_ARHIVEAZA) ───────────────
DO $arhiva$
BEGIN
  IF current_setting('gazpet.revenire_20261131e', true) IS DISTINCT FROM 'SCOATE_CERCETARE_ARHIVEAZA:' || txid_current() THEN RETURN; END IF;
  CREATE TABLE public.intrebari_cercetare_arhiva_20261131e (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fel text NOT NULL CHECK (fel IN ('intrebare', 'preluare')),
    intrebare_id bigint NOT NULL,
    date jsonb NOT NULL,
    arhivat_la timestamptz NOT NULL DEFAULT now()
  );
  COMMENT ON TABLE public.intrebari_cercetare_arhiva_20261131e IS 'Revenirea 20261131e (SCOATE_CERCETARE_ARHIVEAZA): sursele, interogările, marcajele de_verificat și jurnalul de preluări (costul pe încercare), păstrate înainte de scoaterea coloanelor.';
  INSERT INTO public.intrebari_cercetare_arhiva_20261131e (fel, intrebare_id, date)
  SELECT 'intrebare', id, jsonb_build_object('stare', stare, 'surse', surse, 'interogari_web', interogari_web, 'de_verificat_la', de_verificat_la)
    FROM public.intrebari_tehnice
   WHERE surse IS DISTINCT FROM '[]'::jsonb OR interogari_web IS DISTINCT FROM '[]'::jsonb OR stare = 'de_verificat' OR de_verificat_la IS NOT NULL;
  INSERT INTO public.intrebari_cercetare_arhiva_20261131e (fel, intrebare_id, date)
  SELECT 'preluare', p.intrebare_id, to_jsonb(p) FROM public.intrebari_preluari p ORDER BY p.id;
  ALTER TABLE public.intrebari_cercetare_arhiva_20261131e ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.intrebari_cercetare_arhiva_20261131e FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE public.intrebari_cercetare_arhiva_20261131e TO service_role;
  REVOKE ALL ON SEQUENCE public.intrebari_cercetare_arhiva_20261131e_id_seq FROM PUBLIC, anon, authenticated, service_role;
  -- starea 'de_verificat' nu există în 20261105a: răspunsul rămâne, marcajul e în arhivă
  UPDATE public.intrebari_tehnice SET stare = 'raspuns' WHERE stare = 'de_verificat';
END $arhiva$;

-- ─── funcțiile UI noi și semnătura nouă a răspunsului ─────────────────────
DROP FUNCTION public.fn_intrebari_reia(bigint);
DROP FUNCTION public.fn_intrebari_de_verificat(bigint);
DROP FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb);

-- ─── corpurile VERBATIM din 20261105a ─────────────────────────────────────
CREATE FUNCTION public.fn_intrebari_raspunde(p_id bigint, p_incercare uuid, p_raspuns text, p_model text, p_tokeni jsonb, p_eroare text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_autor uuid; v_titlu text;
BEGIN
  IF (p_raspuns IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'exact unul dintre raspuns / eroare'; END IF;
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN p_raspuns IS NULL THEN 'eroare' ELSE 'raspuns' END,
         raspuns_md = p_raspuns, model = left(p_model, 80), tokeni = p_tokeni, eroare = left(p_eroare, 500), raspuns_la = now(), incercare_id = NULL
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING autor, titlu INTO v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  VALUES (v_autor, 'info', 'general',
          CASE WHEN p_raspuns IS NULL THEN '❓ Întrebarea nu a primit răspuns' ELSE '❓ Ai primit răspuns la întrebare' END,
          left(v_titlu, 200), '/intrebari?id=' || p_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_intrebari_preia() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.intrebari_tehnice; v_inc uuid := gen_random_uuid();
BEGIN
  WITH expirate AS (
    UPDATE public.intrebari_tehnice
       SET stare = 'eroare', eroare = 'Procesarea a fost întreruptă. Pune întrebarea din nou.', raspuns_la = now(), incercare_id = NULL,
           tokeni = coalesce(tokeni, '{"cost_necunoscut": true}'::jsonb)   -- apelul AI întrerupt poate fi fost facturat (review r3 P2-4)
     WHERE stare = 'in_lucru' AND preluat_la < now() - interval '30 minutes'
     RETURNING autor, titlu, id)
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT autor, 'info', 'general', '❓ Întrebarea nu a primit răspuns', left(titlu, 200), '/intrebari?id=' || id FROM expirate;
  -- plafon global de cost: max 40 de preluări pe zi (toți utilizatorii); peste el întrebările așteaptă ziua următoare (review r2 P1-2)
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:preia'));
  IF (SELECT count(*) FROM public.intrebari_tehnice
       WHERE preluat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
          OR raspuns_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')) >= 40 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.intrebari_tehnice WHERE stare = 'noua' ORDER BY creat_la LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.intrebari_tehnice SET stare = 'in_lucru', preluat_la = now(), incercari = incercari + 1, incercare_id = v_inc WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'incercare', v_inc, 'titlu', r.titlu, 'intrebare', r.intrebare, 'context', r.context,
                            'atasamente', r.atasamente, 'creat_la', r.creat_la);
END $$;

CREATE OR REPLACE FUNCTION public.fn_intrebari_amana(p_id bigint, p_incercare uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_stare text; v_autor uuid; v_titlu text;
BEGIN
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN incercari >= 3 THEN 'eroare' ELSE 'noua' END,
         eroare = CASE WHEN incercari >= 3 THEN 'Serviciul AI a fost ocupat de 3 ori. Pune întrebarea din nou mai târziu.' END,
         raspuns_la = CASE WHEN incercari >= 3 THEN now() END,
         preluat_la = NULL, incercare_id = NULL
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING stare, autor, titlu INTO v_stare, v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_stare = 'eroare' THEN   -- tranziția finală notifică autorul, atomic (review r2 P2-7)
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (v_autor, 'info', 'general', '❓ Întrebarea nu a primit răspuns', left(v_titlu, 200), '/intrebari?id=' || p_id);
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fn_intrebari_inainte_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean; v_azi integer; v_limita integer; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  NEW.autor := auth.uid();
  NEW.stare := 'noua'; NEW.raspuns_md := NULL; NEW.model := NULL; NEW.tokeni := NULL; NEW.eroare := NULL;
  NEW.incercari := 0; NEW.incercare_id := NULL; NEW.creat_la := now(); NEW.preluat_la := NULL; NEW.raspuns_la := NULL;
  NEW.titlu := btrim(NEW.titlu); NEW.intrebare := btrim(NEW.intrebare); NEW.context := nullif(btrim(coalesce(NEW.context, '')), '');
  SELECT coalesce(is_owner, false) INTO v_owner FROM public.profiles WHERE id = NEW.autor;
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:' || NEW.autor::text));
  SELECT count(*) INTO v_azi FROM public.intrebari_tehnice
   WHERE autor = NEW.autor AND creat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest');
  v_limita := CASE WHEN v_owner THEN 20 ELSE 5 END;   -- variabilă: IF … CASE … THEN … END THEN se rupe la primul THEN în PL/pgSQL
  IF v_azi >= v_limita THEN
    RAISE EXCEPTION 'Limita zilnică atinsă (% întrebări pe zi). Mâine poți pune din nou.', v_limita;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(NEW.atasamente) LOOP
    IF jsonb_typeof(a) <> 'object'
       OR NOT (a->>'path') ~ ('^' || NEW.autor::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$')
       OR coalesce(a->>'mime', '') NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR char_length(coalesce(a->>'nume', '')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Atașament invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'intrebari-tehnice' AND o.name = a->>'path') THEN
      RAISE EXCEPTION 'Atașamentul nu a fost încărcat: %', a->>'nume';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- ─── schema: jurnalul, stările, coloanele ─────────────────────────────────
DROP TABLE public.intrebari_preluari;
ALTER TABLE public.intrebari_tehnice DROP CONSTRAINT intrebari_tehnice_stare_check;
ALTER TABLE public.intrebari_tehnice ADD CONSTRAINT intrebari_tehnice_stare_check CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare'));
ALTER TABLE public.intrebari_tehnice
  DROP CONSTRAINT intrebari_surse_lista, DROP CONSTRAINT intrebari_interogari_lista,
  DROP COLUMN surse, DROP COLUMN de_verificat_la, DROP COLUMN interogari_web;
NOTIFY pgrst, 'reload schema';

-- ─── postcondiție = starea 20261105a; dezarmare ───────────────────────────
-- Runda 3 (review r2 P2-4): arhiva se verifică DOAR prin OID-ul din to_regclass(), într-un bloc separat, executat doar pe calea
-- ARHIVEAZA. Un literal '…arhiva…'::regclass (sau has_table_privilege pe numele ei ca text) se rezolvă și când ramura nu e luată,
-- deci revenirea standard (fără arhivă) ar fi picat chiar în postcondiție.
DO $final$
DECLARE
  v text := current_setting('gazpet.revenire_20261131e', true);
  v_arhiva oid := to_regclass('public.intrebari_cercetare_arhiva_20261131e');
  -- runda 4 (L15): md5(corpul fără CR) al funcțiilor readuse = corpurile VERBATIM din 20261105a (testul vitest verifică egalitatea
  -- cu supabase/migrations/20261105a_intrebari_tehnice.sql și cu corpurile din acest fișier)
  c_105a CONSTANT jsonb := '{
    "public.fn_intrebari_amana(bigint,uuid)": "5a0f5e883119206ec0f2d37230fd9529",
    "public.fn_intrebari_inainte_insert()": "534153df75132ee7054e8cbbbeb3f6b2",
    "public.fn_intrebari_preia()": "23acffcb5a216ca21e7f4dd1186d11b6",
    "public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)": "d9bec061a41ff310b323557e4e4a794b"
  }'::jsonb;
  k text;
  f record;
BEGIN
  IF v IS DISTINCT FROM 'SCOATE_CERCETARE:' || txid_current() AND v IS DISTINCT FROM 'SCOATE_CERCETARE_ARHIVEAZA:' || txid_current() THEN
    RAISE EXCEPTION '20261131e revenire: armarea s-a pierdut pe parcurs';
  END IF;
  IF to_regclass('public.intrebari_preluari') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_de_verificat(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_reia(bigint)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intrebari_tehnice'
                  AND column_name IN ('surse', 'de_verificat_la', 'interogari_web'))
     OR has_function_privilege('authenticated', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_amana(bigint, uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'UPDATE')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_tehnice_stare_check'
                      AND pg_get_constraintdef(oid) NOT LIKE '%de_verificat%')
     OR EXISTS (SELECT 1 FROM public.intrebari_tehnice WHERE stare NOT IN ('noua', 'in_lucru', 'raspuns', 'eroare')) THEN
    RAISE EXCEPTION '20261131e revenire: postcondiția (starea 20261105a) a eșuat';
  END IF;
  FOR k IN SELECT jsonb_object_keys(c_105a) LOOP
    SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, l.lanname, md5(replace(p.prosrc, chr(13), '')) AS corp,
           (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS supraincarcari
      INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(k);
    IF NOT FOUND OR f.corp IS DISTINCT FROM c_105a->>k OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
       OR f.owner IS DISTINCT FROM 'postgres' OR f.lanname <> 'plpgsql' OR f.supraincarcari <> 1 THEN
      RAISE EXCEPTION '20261131e revenire: postcondiția % (corpul / atributele din 20261105a) a eșuat', k;
    END IF;
  END LOOP;
  IF v = 'SCOATE_CERCETARE:' || txid_current() THEN
    IF v_arhiva IS NOT NULL THEN RAISE EXCEPTION '20261131e revenire: postcondiția a eșuat (arhivă creată fără token de arhivare)'; END IF;
  ELSE
    -- calea ARHIVEAZA: arhiva există, are RLS, fără politici, și nu e citibilă de anon / authenticated (verificat pe OID)
    IF v_arhiva IS NULL
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_arhiva)
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_arhiva)
       OR has_table_privilege('authenticated', v_arhiva, 'SELECT')
       OR has_table_privilege('anon', v_arhiva, 'SELECT')
       OR NOT has_table_privilege('service_role', v_arhiva, 'SELECT') THEN
      RAISE EXCEPTION '20261131e revenire: postcondiția arhivei a eșuat';
    END IF;
  END IF;
  PERFORM set_config('gazpet.revenire_20261131e', '', true);   -- dezarmare
END $final$;
