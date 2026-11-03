-- Version 20261130122000. Runner supplies one transaction.
-- 20261130c_sms_redari_sablon — SMS Redari cu SABLON FIX pe UAT (deciziile lui Razvan, 03.11.2026): operatorul alege primaria (UAT),
-- textul se completeaza singur, iar destinatarii sunt DOAR detinatorii convocati din acel UAT care nu au raspuns inca si nu au PV semnat.
-- Peste 20261130b (aplicata; corpurile functiilor folosite verificate prin md5 inainte de orice schimbare).
-- Ce face:
--   * fn_sms_redari_sablon_model(): textul PROVIZORIU al sablonului (unul singur: reamintirea sesiunii + raspunsul online), oglinda
--     constantei SABLON_REDARI din src/sms/sablonRedari.js; se inlocuieste dupa formularea Juridicului (migrare noua, ambele deodata);
--   * fn_sms_redari_sablon_calc(...): completarea, pura, oglinda completeazaSablon() din src/sms/sablonRedari.js (aceleasi cazuri P1-P12
--     in vitest si in DRY, TEST2): {COMUNA} = red_uat.nume; {ZI} = prima zi de sesiune (sesiune_zi1..3) de azi incolo, ZZ.LL (ziua de azi
--     conteaza; ziua 1 trecuta => urmatoarea); {ORA} = ora de inceput (HH:MM) din programul acelei zile; {TEL} = red_proiecte.contact_telefon.
--     Lipseste un camp => lista exacta a lipsurilor; textul trece prin fn_sms_text_final / fn_sms_text_verifica (GSM-7, max 160);
--   * fn_sms_lot_redari_sablon_creeaza(p_proiect_id, p_uat_id, p_text_afisat, p_doar_preview): singura cale a aplicatiei pentru loturi
--     Redari. Textul il face BD-ul (nu se primeste text liber); la creare trebuie sa fie identic cu cel afisat operatorului (altfel 40001:
--     setarile s-au schimbat intre timp). Destinatarii se fixeaza AICI, in BD:
--       - randurile: detinatori activi (sters_la NULL), nedecedati, pe parcele active din UAT, cu cel putin o convocare activa;
--       - „a raspuns” = exista cel putin un rand in red_raspunsuri pentru detinator (orice canal: online prin QR, telefon, scris, sesiune,
--         e-mail, sms; red_raspunsuri nu are stergere logica, deci orice rand conteaza);
--       - „PV semnat” = PV A activ (sters_la NULL) cu stare 'semnat' pe detinator SAU PV B activ cu stare 'semnat' pe parcela lui
--         (PV-urile generate / trimise spre semnare / anulate NU exclud);
--       - persoana = fn_red_cheie_persoana (nume normalizat + adresa de corespondenta, aceeasi cheie ca plicul; fara adresa = randul singur);
--         persoana primeste SMS daca are cel putin un rand deschis (fara raspuns si fara PV semnat), pe un mobil RO valid fara opt-out din
--         randurile deschise (cel mai mic, determinist); UN SINGUR SMS de persoana si unul de telefon;
--       - excluderile se numara pe persoane: pv_semnat / a_raspuns / fara_mobil / optout / duplicat (telefon deja folosit);
--     un singur lot Redari activ (draft / aprobat / in_trimitere) pe UAT: crearea se serializeaza pe UAT (lock consultativ) si refuza al doilea;
--   * fn_sms_lot_redari_creeaza (text liber, convocarile active ale proiectului) ramane in BD, dar fara drept de apel pentru aplicatie.
-- Nivelurile 20261130b raman neschimbate: contul de test e refuzat, utilizatorul cere modulul Redari (editor / admin), toti cer comutatorul
-- Redari pornit; aprobarea si trimiterea raman in 📱 SMS -> Istoric (fn_sms_lot_aproba / fn_sms_rezerva neschimbate).
-- Ordinea de livrare: intai migrarea, apoi UI-ul. Intre ele UI-ul vechi primeste 42501 pe fn_sms_lot_redari_creeaza (fail-closed).
-- Fara date reale atinse. Revenire: supabase/revenire/20261130c_sms_redari_sablon_ROLLBACK.sql (fail-closed: scoate sablonul, NU
-- redeschide textul liber). DRY: supabase/tests/20261130c_sms_redari_sablon_dryrun.sql. Izolare: READ COMMITTED (ca PostgREST).
DO $pre$
DECLARE r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130c_sms_redari_sablon:' || txid_current() THEN
    RAISE EXCEPTION '20261130c: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130c: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 20261130b e cea aplicata: corpurile functiilor pe care le foloseste 20261130c (md5 din fisierele 20261129i / 20261130a / 20261130b,
  -- aplicate local peste schema de productie; CR scos inainte de md5)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_sms_tel_normalizat(text)', '36549798f8f7dcb40aee8cce7a0516b4'),
      ('public.fn_sms_text_final(text)', '5b6c4ac4c68d42fb45949b027f96fabb'),
      ('public.fn_sms_text_verifica(text)', 'fb828f896937261687a9b2c386284218'),
      ('public.fn_sms_nivel_cont(uuid)', 'c9e02a81cb350ce85195fb717605eaf6'),
      ('public.fn_sms_redari_modul_cont(uuid)', 'd0c42a7aaa17906d69f6012dddc3257a'),
      ('public.fn_sms_redari_permis()', '0e98a2766beccc32831f5fd86c6b2531'),
      ('public.fn_sms_cere_nivel()', 'a277d01ee685cf0e21bb49dc0c583ce3'),
      ('public.fn_sms_lot_acces(uuid,text,public.sms_loturi,boolean)', '93a85a6cb1a0e99bfd5cade3228f1019'),
      ('public.fn_sms_cere_lot(uuid,text,public.sms_loturi)', 'a1663148092c531bf31e938538cc5149'),
      ('public.fn_sms_loturi_reguli()', '0ecde5e2b8aaa8a6dcd74c857ec920e4'),
      ('public.fn_sms_mesaje_reguli()', 'b3785d4b157a5ec18f5b8e23965e6e5d'),
      ('public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', '68cf079824121f9da1dffdcdbd54dcd6'),
      ('public.fn_red_cheie_persoana(uuid)', '2d2a98bf9d8747668718c5a7eb6404e7'),
      ('public.fn_red_cheie_calc(text,text,text,text,text,text,boolean)', '826d79dd53dc47c14410ed8ce0a6ce12')) AS v(semnatura, md5_corp) LOOP
    IF to_regprocedure(r.semnatura) IS NULL
       OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.semnatura)), chr(13), '')) IS DISTINCT FROM r.md5_corp THEN
      RAISE EXCEPTION '20261130c: functia % lipseste sau difera de 20261130b', r.semnatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 40
     OR to_regprocedure('public.fn_sms_rezerva(uuid,integer,text,uuid)') IS NULL THEN
    RAISE EXCEPTION '20261130c: functiile fn_sms_* nu sunt cele 40 din 20261130b';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_redari!_sablon%' ESCAPE '!')
     OR to_regprocedure('public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '20261130c: sablonul exista deja';
  END IF;
  -- dupa o revenire 20261130c functia veche ramane fara drept pentru aplicatie: aici se accepta ambele stari, nu se redeschide nimic
  IF has_function_privilege('anon', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130c: fn_sms_lot_redari_creeaza e apelabila de anon';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat'
        AND column_name IN ('nume', 'proiect_id', 'sesiune_zi1', 'sesiune_zi2', 'sesiune_zi3', 'program_zi1', 'program_zi2', 'program_zi3')) <> 8
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'contact_telefon') <> 1
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_procese_verbale'
           AND column_name IN ('tip', 'stare', 'sters_la', 'detinator_id', 'parcela_id')) <> 5
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_raspunsuri' AND column_name = 'detinator_id') <> 1
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_raspunsuri' AND column_name = 'sters_la') THEN
    RAISE EXCEPTION '20261130c: coloanele Redari folosite nu sunt cele asteptate (red_raspunsuri fara stergere logica)';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261130c: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- ─── 1. Sablonul (pur): modelul si completarea ────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_model() IS 'SMS Redari (pura, interna): textul PROVIZORIU al sablonului fix, oglinda SABLON_REDARI din src/sms/sablonRedari.js. Se schimba doar printr-o migrare noua, impreuna cu constanta din UI.';

CREATE FUNCTION public.fn_sms_redari_sablon_calc(p_comuna text, p_zile date[], p_programe text[], p_tel text, p_azi date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_spatii text := ' ' || chr(9); v_comuna text; v_nr integer; v_zi date; v_ora text; v_m text[]; v_tel text; v_lips text[] := ARRAY[]::text[];
        v_brut text; v record;
BEGIN
  v_comuna := btrim(coalesce(p_comuna, ''), v_spatii);
  IF v_comuna = '' THEN v_lips := array_append(v_lips, 'uat_nume'); END IF;
  -- prima zi de sesiune de azi incolo, in ordinea datelor (la egalitate, ziua cu numarul mai mic)
  IF p_azi IS NOT NULL THEN
    SELECT z.nr, z.zi INTO v_nr, v_zi
      FROM unnest(coalesce(p_zile, ARRAY[]::date[])) WITH ORDINALITY AS z(zi, nr)
     WHERE z.nr BETWEEN 1 AND 3 AND z.zi IS NOT NULL AND z.zi >= p_azi
     ORDER BY z.zi, z.nr LIMIT 1;
  END IF;
  IF v_zi IS NULL THEN
    v_lips := array_append(v_lips, 'zi_sesiune');
  ELSE
    -- ora de inceput la inceputul programului: HH:MM / H:MM (si cu punct), urmata de altceva decat o cifra
    v_m := regexp_match(ltrim(coalesce(p_programe[v_nr], ''), v_spatii), '^(2[0-3]|[01]?[0-9])[:.]([0-5][0-9])([^0-9]|$)');
    IF v_m IS NULL THEN v_lips := array_append(v_lips, 'program_zi'); ELSE v_ora := lpad(v_m[1], 2, '0') || ':' || v_m[2]; END IF;
  END IF;
  v_tel := btrim(coalesce(p_tel, ''), v_spatii);
  IF v_tel !~ '^[-0-9+ ()./]{6,40}$' OR length(regexp_replace(v_tel, '[^0-9]', '', 'g')) NOT BETWEEN 6 AND 15 THEN
    v_lips := array_append(v_lips, 'telefon_contact');
  END IF;
  IF cardinality(v_lips) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'lipsuri', 'lipsuri', to_jsonb(v_lips), 'text', NULL, 'lungime', 0,
      'zi', v_zi, 'zi_nr', v_nr, 'ora', v_ora);
  END IF;
  v_brut := replace(replace(replace(replace(public.fn_sms_redari_sablon_model(), '{COMUNA}', v_comuna), '{ZI}', to_char(v_zi, 'DD.MM')),
              '{ORA}', v_ora), '{TEL}', v_tel);
  SELECT * INTO v FROM public.fn_sms_text_verifica(v_brut);
  RETURN jsonb_build_object('ok', v.text_final <> '' AND v.nepermise = '' AND v.lungime <= 160,
    'motiv', CASE WHEN v.text_final = '' THEN 'gol' WHEN v.nepermise <> '' THEN 'caractere_nepermise' WHEN v.lungime > 160 THEN 'prea_lung' END,
    'lipsuri', '[]'::jsonb, 'text', v.text_final, 'lungime', v.lungime, 'nepermise', v.nepermise, 'zi', v_zi, 'zi_nr', v_nr, 'ora', v_ora);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_calc(text, date[], text[], text, date) IS 'SMS Redari (pura, interna): completeaza sablonul. {COMUNA} = numele UAT, {ZI} = prima zi din p_zile (1..3) >= p_azi (ZZ.LL), {ORA} = ora de inceput HH:MM din programul acelei zile, {TEL} = telefonul de contact (6-15 cifre). Intoarce ok, motiv (lipsuri / prea_lung / caractere_nepermise / gol), lipsuri (uat_nume, zi_sesiune, program_zi, telefon_contact), text, lungime GSM-7. Oglinda completeazaSablon() din src/sms/sablonRedari.js.';

-- ─── 2. Crearea lotului Redari din sablon (singura cale a aplicatiei) ─────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_lot_redari_sablon_creeaza(p_proiect_id uuid, p_uat_id uuid, p_text_afisat text DEFAULT NULL,
                                                       p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_niv text; v_s jsonb; v_text text; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_pv integer;
        v_rasp integer; v_dup integer; v_nr integer; v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_activ uuid;
        u public.red_uat; v_tel_contact text; v_preview boolean := coalesce(p_doar_preview, true);
BEGIN
  -- Ordinea lock-urilor: UAT (lock consultativ 'sms_redari_uat:<uat>', doar la creare) -> lot nou (triggerele lui nu asteapta) -> mesaje.
  -- Nicio alta cale nu ia lock-ul UAT-ului, deci nu exista ciclu cu fn_sms_lot_aproba / fn_sms_rezerva (setari -> lot -> mesaje).
  v_niv := public.fn_sms_cere_nivel();
  -- nivelurile 20261130b: contul de test nu face loturi Redari; utilizatorul are nevoie si de modulul Redari (editor / admin)
  IF v_niv = 'test' THEN RAISE EXCEPTION 'sms test: contul de test nu face loturi Redari' USING ERRCODE = '42501'; END IF;
  IF NOT public.fn_sms_redari_permis() THEN
    RAISE EXCEPTION 'sms redari: lotul Redari cere si modulul Redari (editor / admin)' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce((SELECT s.redari_autorizat FROM public.sms_setari s WHERE s.id), false) THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit; il seteaza doar owner-ul, cu nr. si data)'
      USING ERRCODE = '42501';
  END IF;
  IF p_proiect_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: proiect inexistent' USING ERRCODE = '22023';
  END IF;
  IF p_uat_id IS NULL THEN RAISE EXCEPTION 'sms redari: alege UAT-ul (sablonul e pe primarie)' USING ERRCODE = '22023'; END IF;
  IF NOT v_preview THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sms_redari_uat:' || p_uat_id::text, 0));
  END IF;
  SELECT * INTO u FROM public.red_uat x WHERE x.id = p_uat_id AND x.proiect_id = p_proiect_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms redari: UAT-ul nu e al proiectului' USING ERRCODE = '22023'; END IF;
  SELECT pr.contact_telefon INTO v_tel_contact FROM public.red_proiecte pr WHERE pr.id = p_proiect_id;
  -- textul il face BD-ul, din setarile de ACUM (ziua de azi la Bucuresti)
  v_s := public.fn_sms_redari_sablon_calc(u.nume, ARRAY[u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3], ARRAY[u.program_zi1, u.program_zi2, u.program_zi3],
                                          v_tel_contact, (now() AT TIME ZONE 'Europe/Bucharest')::date);
  IF v_s->>'motiv' = 'lipsuri' THEN
    RAISE EXCEPTION 'sms redari: sablonul nu se poate completa, lipseste: % (Setari UAT / Setari proiect)',
      (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_s->'lipsuri') x) USING ERRCODE = '22023';
  END IF;
  IF (v_s->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'sms redari: textul sablonului are % caractere GSM-7 (%); maximum 160', v_s->>'lungime', v_s->>'motiv' USING ERRCODE = '22023';
  END IF;
  v_text := v_s->>'text';
  IF NOT v_preview AND p_text_afisat IS DISTINCT FROM v_text THEN
    RAISE EXCEPTION 'sms redari: textul s-a schimbat fata de cel afisat (setarile UAT / proiectului sau ziua); refa previzualizarea' USING ERRCODE = '40001';
  END IF;
  -- un singur lot Redari activ pe UAT (sub lock-ul UAT-ului la creare)
  SELECT l.id INTO v_activ FROM public.sms_loturi l
   WHERE l.categorie = 'redari' AND l.uat_id = p_uat_id AND l.stare IN ('draft', 'aprobat', 'in_trimitere')
   ORDER BY l.creat_la DESC, l.id LIMIT 1;
  IF NOT v_preview AND v_activ IS NOT NULL THEN
    RAISE EXCEPTION 'sms redari: UAT-ul are deja un lot activ (draft / aprobat / in trimitere); anuleaza-l sau asteapta-l din SMS -> Istoric'
      USING ERRCODE = '23505';
  END IF;
  -- destinatarii, intr-un singur instantaneu: randuri -> persoane -> telefoane
  WITH r AS (
    SELECT d.id, coalesce(public.fn_red_cheie_persoana(d.id), 'd:' || d.id::text) AS pers, public.fn_sms_tel_normalizat(k.telefon) AS tel,
           EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = d.id) AS raspuns,
           EXISTS (SELECT 1 FROM public.red_procese_verbale v
                    WHERE v.sters_la IS NULL AND v.stare = 'semnat'
                      AND ((v.tip = 'A' AND v.detinator_id = d.id) OR (v.tip = 'B' AND v.parcela_id = d.parcela_id))) AS pv
      FROM public.red_detinatori d
      JOIN public.red_parcele pa ON pa.id = d.parcela_id AND pa.sters_la IS NULL AND pa.proiect_id = p_proiect_id AND pa.uat_id = p_uat_id
      LEFT JOIN public.red_detinatori_contact k ON k.detinator_id = d.id
     WHERE d.sters_la IS NULL AND d.decedat IS NOT TRUE
       AND EXISTS (SELECT 1 FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL)
  ), r2 AS (
    SELECT r.*, NOT r.raspuns AND NOT r.pv AS deschis,
           (r.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = r.tel AND o.activ)) AS opt
      FROM r
  ), p AS (
    SELECT r2.pers, bool_or(r2.deschis) AS deschis, bool_or(r2.pv) AS pv, bool_or(r2.deschis AND r2.tel IS NOT NULL) AS are_tel,
           min(r2.tel) FILTER (WHERE r2.deschis AND r2.tel IS NOT NULL AND NOT r2.opt) AS tel
      FROM r2 GROUP BY r2.pers
  ), c AS (
    SELECT p.*, CASE WHEN NOT p.deschis AND p.pv THEN 'pv_semnat' WHEN NOT p.deschis THEN 'a_raspuns'
                     WHEN NOT p.are_tel THEN 'fara_mobil' WHEN p.tel IS NULL THEN 'optout' END AS exclus
      FROM p
  ), d AS (
    SELECT DISTINCT ON (c.tel) c.tel, c.pers FROM c WHERE c.exclus IS NULL ORDER BY c.tel, c.pers
  ), f AS (
    SELECT d.tel, (SELECT min(r2.id::text) FROM r2 WHERE r2.pers = d.pers AND r2.deschis AND r2.tel = d.tel) AS det FROM d
  )
  SELECT (SELECT count(*) FROM c), (SELECT count(*) FROM c WHERE c.exclus = 'pv_semnat'), (SELECT count(*) FROM c WHERE c.exclus = 'a_raspuns'),
         (SELECT count(*) FROM c WHERE c.exclus = 'fara_mobil'), (SELECT count(*) FROM c WHERE c.exclus = 'optout'),
         (SELECT array_agg(f.tel ORDER BY f.tel) FROM f), (SELECT array_agg(f.det ORDER BY f.tel) FROM f)
    INTO v_cand, v_pv, v_rasp, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  v_dup := v_cand - v_pv - v_rasp - v_fara - v_opt - v_nr;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT v_preview THEN
    IF v_cand = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu convocare activa in UAT' USING ERRCODE = '22023'; END IF;
    IF v_nr = 0 THEN
      RAISE EXCEPTION 'sms redari: niciun proprietar de anuntat (au raspuns / PV semnat / fara mobil RO / opt-out)' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.sms_loturi (categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('redari', v_text, p_proiect_id, p_uat_id,
            jsonb_build_object('uat_id', p_uat_id, 'sablon', 'redari_v1', 'zi', v_s->'zi', 'zi_nr', v_s->'zi_nr', 'ora', v_s->'ora',
                               'candidati', v_cand, 'excluse_pv_semnat', v_pv, 'excluse_a_raspuns', v_rasp, 'excluse_duplicat', v_dup),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, x.t, 'detinator', x.i FROM unnest(v_tel, v_ids) AS x(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'redari', 'sablon', 'redari_v1', 'text_final', v_text, 'lungime', (v_s->>'lungime')::integer,
    'segmente', 1, 'zi', v_s->'zi', 'zi_nr', v_s->'zi_nr', 'ora', v_s->'ora',
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_pv_semnat', v_pv, 'excluse_a_raspuns', v_rasp, 'excluse_fara_mobil', v_fara,
    'excluse_optout', v_opt, 'excluse_duplicat', v_dup, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'lot_activ_uat', v_activ, 'preview', v_preview, 'nivel', v_niv);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, boolean) IS 'SMS Redari: previzualizeaza / creeaza (draft) lotul din sablonul fix pe un UAT. Textul il completeaza BD-ul (fn_sms_redari_sablon_calc); la creare p_text_afisat trebuie sa fie identic (altfel 40001). Destinatari: detinatorii activi, nedecedati, cu convocare activa in UAT, fara niciun raspuns si fara PV semnat (A pe detinator / B pe parcela), un SMS de persoana (fn_red_cheie_persoana) si de telefon, mobil RO fara opt-out. Un singur lot Redari activ pe UAT. Niveluri ca 20261130b: test refuzat, utilizator cu modulul Redari, comutatorul Redari pornit.';

-- ─── 3. Drepturi (privilegiile implicite Supabase dau EXECUTE pe functii noi: se scot explicit) ────────────────────────────
REVOKE ALL ON FUNCTION public.fn_sms_redari_sablon_model(), public.fn_sms_redari_sablon_calc(text, date[], text[], text, date),
  public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, boolean) TO authenticated;
-- textul liber + convocarile active ale proiectului: nu mai e o cale a aplicatiei (decizia: un singur sablon, destinatarii filtrati in BD)
REVOKE EXECUTE ON FUNCTION public.fn_sms_lot_redari_creeaza(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

DO $post$
DECLARE v_o oid; v_n integer;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_e_owner()', 'public.fn_sms_nivel()', 'public.fn_sms_loturi_lista(integer)', 'public.fn_sms_panou()',
    'public.fn_sms_angajati_lista()', 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)',
    'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,boolean)', 'public.fn_sms_lot_destinatari(uuid)', 'public.fn_sms_lot_aproba(uuid,integer)',
    'public.fn_sms_lot_anuleaza(uuid,text)', 'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)',
    'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', 'public.fn_sms_optout_seteaza(text,boolean,text)']::regprocedure[];
  v_serviciu regprocedure[] := ARRAY['public.fn_sms_rezerva(uuid,integer,text,uuid)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)',
    'public.fn_sms_dlr_aplica(text,text,boolean,timestamptz)']::regprocedure[];
  v_pure regprocedure[] := ARRAY['public.fn_sms_tel_normalizat(text)', 'public.fn_sms_text_final(text)', 'public.fn_sms_text_verifica(text)',
    'public.fn_sms_text_valid(text)', 'public.fn_sms_lot_permis(text,boolean,boolean,text,integer,boolean)', 'public.fn_sms_test_buget_zi()',
    'public.fn_sms_test_coada_max()', 'public.fn_sms_redari_sablon_model()', 'public.fn_sms_redari_sablon_calc(text,date[],text[],text,date)']::regprocedure[];
  v_j jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!';
  IF v_n <> 43 THEN RAISE EXCEPTION '20261130c: % functii fn_sms_* (asteptat 43)', v_n; END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_o) IS DISTINCT FROM (NOT (v_o::regprocedure = ANY (v_pure)))
       OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_o)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_expuse))
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_serviciu)) THEN
      RAISE EXCEPTION '20261130c: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
    -- echivalentul local al portii permanente 0e (scripts/control_0e.sql) pe functiile expuse
    IF v_o::regprocedure = ANY (v_expuse) AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o
         AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]u&|[[:<:]](set|reset)[[:space:]]+(local[[:space:]]+|session[[:space:]]+)?role[[:>:]])') THEN
      RAISE EXCEPTION '20261130c: functia expusa % contine o constructie interzisa de poarta 0e', v_o::regprocedure;
    END IF;
  END LOOP;
  -- sablonul: modelul + doua completari de control (ziua 1 trecuta -> ziua 2; lipsuri)
  IF public.fn_sms_redari_sablon_model() <> 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}' THEN
    RAISE EXCEPTION '20261130c: modelul sablonului';
  END IF;
  v_j := public.fn_sms_redari_sablon_calc('Jupa', ARRAY['2026-11-05', '2026-11-12', NULL]::date[], ARRAY['08:00-12:00', '9.30 - 15:00', NULL], '0700000112', '2026-11-10');
  IF v_j->>'text' IS DISTINCT FROM 'Gazpet pt Transgaz: sesiune redare teren la Primaria Jupa, 12.11 ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700000112'
     OR (v_j->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '20261130c: completarea de control %', v_j;
  END IF;
  v_j := public.fn_sms_redari_sablon_calc(' ', NULL, NULL, NULL, '2026-11-10');
  IF v_j->'lipsuri' IS DISTINCT FROM '["uat_nume", "zi_sesiune", "telefon_contact"]'::jsonb THEN RAISE EXCEPTION '20261130c: lipsurile de control %', v_j; END IF;
END $post$;
