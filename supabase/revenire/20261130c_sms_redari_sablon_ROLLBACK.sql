-- Revenire 20261130c_sms_redari_sablon. Runner: o tranzactie, GUC gazpet.revenire_20261130c = 'SMS_SABLON_SCOS:'||txid_current().
-- Fail-closed:
--   * fn_sms_loturi_reguli si fn_sms_rezerva revin EXACT la corpurile 20261130b (copiate din supabase/migrations/20261130b_sms_acces_modul.sql
--     de generator, nu de mana; md5 verificat la final); CREATE OR REPLACE pastreaza drepturile;
--   * cele 5 functii noi (sablonul, eligibilitatea, valabilitatea lotului, crearea) se scot (DROP);
--   * fn_sms_lot_redari_creeaza (textul liber) NU se redeschide: dupa revenire nimeni nu mai creeaza loturi Redari din aplicatie,
--     pana la o migrare noua. Loturile interne, aprobarea, trimiterea si istoricul raman exact ca in 20261130b.
-- NU sterge date: loturile Redari deja create din sablon raman in sms_loturi (filtru->>'sablon' = 'redari_v1'), cu mesajele lor.
-- Refuza daca exista loturi din sablon inca ACTIVE (draft / aprobat / in_trimitere): se anuleaza intai din 📱 SMS -> Istoric
-- (tabela e blocata inainte de verificare, ca sa nu apara unul nou intre verificare si DROP).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130c', true) IS DISTINCT FROM 'SMS_SABLON_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130c revenire: garda invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130c revenire: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)') IS NULL
     OR to_regprocedure('public.fn_sms_redari_sablon_calc(text,date[],text[],text,timestamp)') IS NULL
     OR to_regprocedure('public.fn_sms_redari_sablon_model()') IS NULL OR to_regprocedure('public.fn_sms_redari_persoane(uuid,uuid)') IS NULL
     OR to_regprocedure('public.fn_sms_redari_lot_motiv(public.sms_loturi)') IS NULL OR to_regclass('public.sms_loturi') IS NULL THEN
    RAISE EXCEPTION '20261130c revenire: migrarea 20261130c lipseste';
  END IF;
  -- corpurile de acum sunt cele din 20261130c (altceva = schimbat de altcineva intre timp: nu suprascriem orb)
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_loturi_reguli()'::regprocedure), chr(13), '')) <> '06e942cb552fb0cb26e17151a6cd9dc2'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_rezerva(uuid,integer,text,uuid)'::regprocedure), chr(13), '')) <> '2eca284977adca8bb64cfe57dd6c6189' THEN
    RAISE EXCEPTION '20261130c revenire: fn_sms_loturi_reguli / fn_sms_rezerva nu sunt cele din 20261130c';
  END IF;
END $pre$;

-- creatorii de loturi trec prin INSERT pe sms_loturi: SHARE ROW EXCLUSIVE ii opreste pana la COMMIT, citirile (Istoric) merg
LOCK TABLE public.sms_loturi IN SHARE ROW EXCLUSIVE MODE;

DO $date$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.sms_loturi
   WHERE categorie = 'redari' AND filtru->>'sablon' = 'redari_v1' AND stare IN ('draft', 'aprobat', 'in_trimitere');
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261130c revenire: % loturi Redari din sablon sunt inca active (draft / aprobat / in_trimitere); anuleaza-le intai', v_n;
  END IF;
END $date$;

-- ─── corpurile 20261130b ───────────────────────────────────────────────────────────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION public.fn_sms_rezerva(p_lot_id uuid, p_max integer, p_furnizor text, p_apelant uuid) RETURNS jsonb
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
       AND NOT coalesce(x.creat_nivel = 'test' AND public.fn_sms_nivel_cont(x.creat_de) IS NULL, false)
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
  -- r3 (P2-01 a) / r4: lotul unui cont de test pleaca doar cat creatorul are INCA un drept SMS (test, utilizator sau owner), oricine
  -- porneste trimiterea (contul, owner-ul, cronul): un drept retras opreste coada lui; o promovare nu (limitele de test raman mai jos)
  IF l.creat_nivel = 'test' AND public.fn_sms_nivel_cont(l.creat_de) IS NULL THEN
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

DROP FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, text, boolean);
DROP FUNCTION public.fn_sms_redari_lot_motiv(public.sms_loturi);
DROP FUNCTION public.fn_sms_redari_persoane(uuid, uuid);
DROP FUNCTION public.fn_sms_redari_sablon_calc(text, date[], text[], text, timestamp);
DROP FUNCTION public.fn_sms_redari_sablon_model();

DO $post$
DECLARE v_o oid;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 40 THEN
    RAISE EXCEPTION '20261130c revenire: functiile fn_sms_* nu sunt cele 40 din 20261130b';
  END IF;
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_loturi_reguli()'::regprocedure), chr(13), '')) <> '0ecde5e2b8aaa8a6dcd74c857ec920e4'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_rezerva(uuid,integer,text,uuid)'::regprocedure), chr(13), '')) <> '5c53f8f306c213f8d5037bac0aca920b' THEN
    RAISE EXCEPTION '20261130c revenire: corpurile nu sunt cele din 20261130b';
  END IF;
  -- fail-closed: textul liber ramane inchis pentru aplicatie
  IF has_function_privilege('authenticated', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130c revenire: fn_sms_lot_redari_creeaza nu trebuie redeschisa';
  END IF;
  -- drepturile functiilor ramase: ca dupa 20261130b (rezerva doar service_role, triggerul fara EXECUTE pentru aplicatie)
  IF NOT has_function_privilege('service_role', 'public.fn_sms_rezerva(uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_rezerva(uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_sms_loturi_reguli()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130c revenire: drepturile fn_sms_rezerva / fn_sms_loturi_reguli';
  END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE') OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0) THEN
      RAISE EXCEPTION '20261130c revenire: drepturi gresite pe %', v_o::regprocedure;
    END IF;
  END LOOP;
  RAISE NOTICE '20261130c revenire: corpurile 20261130b inapoi, sablonul scos, textul liber ramane inchis; pastrate % loturi Redari din sablon (inactive)',
    (SELECT count(*) FROM public.sms_loturi WHERE categorie = 'redari' AND filtru->>'sablon' = 'redari_v1');
END $post$;
