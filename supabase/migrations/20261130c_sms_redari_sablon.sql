-- Version 20261130122000. Runner supplies one transaction.
-- 20261130c_sms_redari_sablon — SMS Redari cu SABLON FIX pe UAT (deciziile lui Razvan, 03.11.2026): operatorul alege primaria (UAT),
-- textul se completeaza singur, iar destinatarii sunt DOAR persoanele convocate din acel UAT care nu au raspuns si mai au parcele fara PV semnat.
-- Peste 20261130b (aplicata; corpurile functiilor folosite / inlocuite verificate prin md5 inainte de orice schimbare).
-- Ce face:
--   * fn_sms_redari_sablon_model(): textul PROVIZORIU al sablonului (unul singur: reamintirea sesiunii + raspunsul online), oglinda
--     constantei SABLON_REDARI din src/sms/sablonRedari.js; se inlocuieste dupa formularea Juridicului (migrare noua, ambele deodata);
--   * fn_sms_redari_sablon_calc(..., p_acum): completarea, pura, oglinda completeazaSablon() din src/sms/sablonRedari.js (aceleasi cazuri
--     P1-P15 in vitest si in DRY, TEST2): {COMUNA} = red_uat.nume; {ZI} = prima zi de sesiune (sesiune_zi1..3), ZZ.LL, care NU a inceput
--     (data + ora de inceput, ora Romaniei: o sesiune de azi deja inceputa => urmatoarea); {ORA} = ora de inceput (HH:MM) din programul
--     acelei zile; {TEL} = red_proiecte.contact_telefon. Lipseste un camp => lista exacta a lipsurilor; GSM-7, max 160;
--   * fn_sms_redari_persoane(proiect, uat): SINGURA definitie a eligibilitatii (folosita la creare si la fiecare rezervare):
--       - randuri: detinatori activi (sters_la NULL), nedecedati, pe parcele active din UAT; „convocat” = cel putin o convocare activa;
--       - persoana = cheia fn_red_cheie_calc (nume normalizat + adresa, aceeasi cheie ca plicul / fn_red_cheie_persoana; fara adresa =
--         randul singur), in UAT;
--       - „a raspuns” = cel putin un rand in red_raspunsuri pe ORICARE rand al persoanei din UAT, orice canal (online prin QR, telefon,
--         scris, sesiune, e-mail, sms) => persoana NU primeste (decizia Razvan 03.11); r5 (P3-03, implicit, de confirmat de Razvan):
--         conteaza si raspunsul de pe un rand ARHIVAT (sters_la) al aceleiasi persoane din UAT; eligibilitatea vine doar din randurile active;
--       - „PV semnat” = PV A activ cu stare 'semnat' pe detinator SAU PV B activ cu stare 'semnat' pe parcela lui; exclude persoana doar
--         cand NU mai are nicio parcela convocata fara PV semnat (PV doar pe unele parcele => primeste);
--       - telefonul = cel mai mic mobil RO valid fara opt-out de pe randurile deschise (convocate, fara PV semnat); tels = toate aceste
--         numere (verificarea numarului inghetat la rezervare);
--   * fn_sms_lot_redari_sablon_creeaza(p_proiect_id, p_uat_id, p_text_afisat, p_set_hash, p_doar_preview): singura cale a aplicatiei
--     pentru loturi Redari. Textul il face BD-ul; previzualizarea intoarce si set_hash (md5 peste persoane + telefoane + randuri, fara sa
--     le expuna). La creare textul si set_hash trebuie sa fie cele afisate (altfel 40001). Un SMS de persoana si de telefon.
--     Sub lock-ul UAT-ului: un singur lot Redari activ pe UAT (draft / aprobat / in_trimitere, sau coada_golita cu mesaje inca
--     `necunoscut`) si o singura campanie (UAT + zi de sesiune + sablon) cat timp lotul ei nu e anulat;
--   * fn_sms_redari_lot_motiv(lot) = fn_sms_redari_lot_motiv_la(lot, clock_timestamp()): r3 (Jakarinos P2) momentul EFECTIV al apelului,
--     nu now() (inceputul tranzactiei): se cheama doar DUPA lock-urile pe setari / lot, deci o asteptare la lock nu intinereste sesiunea;
--     pentru loturile Redari: r5 (Copilot P2-02) 'lot_vechi_fara_sablon' daca lotul nu are filtru.sablon = 'redari_v1' (text liber,
--     dinainte de 20261130c); altfel 'sesiune_expirata' daca sesiunea din filtru a inceput,
--     'text_schimbat' daca textul recalculat acum difera de cel al lotului; altfel NULL. Verificat:
--       - la APROBARE (triggerul fn_sms_loturi_reguli, deci pe orice cale);
--       - la FIECARE REZERVARE (fn_sms_rezerva, si pentru loturile deja in_trimitere, intre transe); cronul sare loturile refuzate;
--     operatorul anuleaza lotul si il recreeaza;
--   * la rezervare, intai opt-out-ul (anulat 'optout'), apoi: un mesaj in_coada pleaca doar daca persoana e INCA eligibila (exclus NULL)
--     SI numarul inghetat in mesaj e inca pe un rand deschis al ei, fara opt-out (r5, Copilot P2-01); altfel trece ATOMIC in `anulat` cu
--     cod_eroare 'ne_eligibil' (raspuns / PV pe toate parcelele / rand disparut / numar schimbat sau sters) si nu pleaca; numarul nu se
--     inlocuieste automat; lista fixata ramane pentru audit;
--   * r3 (Jakarinos P2): tot la rezervare, mesajele se regrupeaza pe cheia ACTUALA a persoanei (fn_red_cheie_persoana): cel mult UN
--     mesaj pe persoana pleaca (cel deja rezervat / trimis, altfel primul in ordinea creat_la, id); restul in_coada -> anulat,
--     cod_eroare 'duplicat_persoana'; r4 (Jakarinos P2): opt-out-ul si ne_eligibil se aplica INAINTE de regrupare, deci un telefon care
--     nu mai poate primi nu ocupa locul persoanei si pleaca mesajul pe telefonul ei valabil;
--   * r5 (Copilot P2-03): reperul de timp al trimiterii e momentul efectiv (clock_timestamp), dupa lock-uri: fereastra 08-20
--     (fn_sms_fereastra_externa, imediat inainte de rezervare), consumul zi / luna (fn_sms_consum), bugetul contului de test
--     (fn_sms_test_consum_zi) si rezervat_la (fn_sms_mesaje_reguli); loturile interne raman la fel, doar cu acest reper;
--   * fn_sms_lot_redari_creeaza (text liber) ramane in BD, fara drept de apel pentru aplicatie.
-- Ordinea lock-urilor (r5, P3-02: mecanismul real, neschimbat fata de 20261130b in afara de lock-ul UAT-ului):
--   * aprobarea (fn_sms_lot_aproba): setari FOR SHARE -> contul de test (lock consultativ, doar loturi de test) -> lot FOR UPDATE ->
--     UPDATE-ul lotului (triggerul fn_sms_loturi_reguli cheama fn_sms_redari_lot_motiv);
--   * rezervarea (fn_sms_rezerva): setari FOR UPDATE -> lot FOR UPDATE -> mesajele lotului (UPDATE-uri, rezervarea cu SKIP LOCKED);
--   * crearea din sablon: lock consultativ 'sms_redari_uat:<uat>' (asteapta) -> INSERT lot (triggerul citeste setarile FARA lock) ->
--     INSERT mesaje (triggerul ia lotul nou, deja al tranzactiei, FOR UPDATE SKIP LOCKED); nicio alta cale nu ia lock-ul UAT-ului,
--     deci nu exista ciclu;
-- Nivelurile 20261130b raman neschimbate (test refuzat, utilizator cu modulul Redari, comutatorul Redari pornit).
-- Corpurile noi fn_sms_loturi_reguli / fn_sms_rezerva / fn_sms_mesaje_reguli / fn_sms_test_consum_zi (20261130b) si fn_sms_consum
-- (20261130a) = corpurile originale + blocurile marcate „20261130c” (generate, nu de mana).
-- Ordinea de livrare: intai migrarea, apoi UI-ul. Intre ele UI-ul vechi primeste 42501 (fail-closed).
-- Fara date reale atinse. Revenire: supabase/revenire/20261130c_sms_redari_sablon_ROLLBACK.sql (fail-closed: corpurile 20261130b inapoi,
-- functiile noi scoase, textul liber NU se redeschide). DRY: supabase/tests/20261130c_sms_redari_sablon_dryrun.sql. Izolare: READ COMMITTED.
DO $pre$
DECLARE r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130c_sms_redari_sablon:' || txid_current() THEN
    RAISE EXCEPTION '20261130c: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130c: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 20261130b e cea aplicata: corpurile functiilor folosite sau inlocuite (md5 fara CR; confirmate de DRY-ul pe productie pe r1)
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
      ('public.fn_sms_lot_aproba(uuid,integer)', '1f14c19429a94c1146557e41db01e190'),
      ('public.fn_sms_rezerva(uuid,integer,text,uuid)', '5c53f8f306c213f8d5037bac0aca920b'),
      ('public.fn_sms_consum()', '5ea88d56e11ed99307a6c53fcbd18c4e'),
      ('public.fn_sms_test_consum_zi(uuid)', 'ba7fbcf800adcea8c733f195e72dab9e'),
      ('public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', '68cf079824121f9da1dffdcdbd54dcd6'),
      ('public.fn_red_cheie_persoana(uuid)', '2d2a98bf9d8747668718c5a7eb6404e7'),
      ('public.fn_red_cheie_calc(text,text,text,text,text,text,boolean)', '826d79dd53dc47c14410ed8ce0a6ce12')) AS v(semnatura, md5_corp) LOOP
    IF to_regprocedure(r.semnatura) IS NULL
       OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.semnatura)), chr(13), '')) IS DISTINCT FROM r.md5_corp THEN
      RAISE EXCEPTION '20261130c: functia % lipseste sau difera de 20261130b', r.semnatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 40 THEN
    RAISE EXCEPTION '20261130c: functiile fn_sms_* nu sunt cele 40 din 20261130b';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND (p.proname LIKE 'fn!_sms!_redari!_sablon%' ESCAPE '!' OR p.proname IN ('fn_sms_lot_redari_sablon_creeaza', 'fn_sms_redari_persoane', 'fn_sms_redari_lot_motiv', 'fn_sms_redari_lot_motiv_la',
                                'fn_sms_fereastra_externa'))) THEN
    RAISE EXCEPTION '20261130c: sablonul exista deja';
  END IF;
  IF has_function_privilege('anon', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130c: fn_sms_lot_redari_creeaza e apelabila de anon';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.sms_loturi'::regclass AND NOT tgisinternal AND tgfoid = 'public.fn_sms_loturi_reguli()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION '20261130c: triggerul de pe sms_loturi nu e cel din 20261130b';
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
  -- r5 (Copilot P2-02): loturile Redari dinainte de 20261130c (text liber) inca active; dupa migrare nu mai pot fi aprobate / trimise
  RAISE NOTICE '20261130c: loturi Redari active fara sablon inainte de migrare: % (de anulat din SMS -> Istoric; nu mai pleaca: lot_vechi_fara_sablon)',
    (SELECT count(*) FROM public.sms_loturi l WHERE l.categorie = 'redari' AND (l.stare IN ('draft', 'aprobat', 'in_trimitere')
          OR (l.stare = 'coada_golita' AND EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'necunoscut'))));
END $pre$;

-- ─── 1. Sablonul (pur): modelul si completarea ────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_model() IS 'SMS Redari (pura, interna): textul PROVIZORIU al sablonului fix, oglinda SABLON_REDARI din src/sms/sablonRedari.js. Se schimba doar printr-o migrare noua, impreuna cu constanta din UI.';

CREATE FUNCTION public.fn_sms_redari_sablon_calc(p_comuna text, p_zile date[], p_programe text[], p_tel text, p_acum timestamp) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_spatii text := ' ' || chr(9); v_comuna text; v_nr integer; v_zi date; v_ora text; v_m text[]; v_tel text; v_lips text[] := ARRAY[]::text[];
        v_brut text; v record; z record; v_o text;
BEGIN
  v_comuna := btrim(coalesce(p_comuna, ''), v_spatii);
  IF v_comuna = '' THEN v_lips := array_append(v_lips, 'uat_nume'); END IF;
  -- prima zi de sesiune care NU a inceput (ora Romaniei, p_acum), in ordinea datelor; o zi de azi fara ora de inceput se alege (lipsa)
  IF p_acum IS NOT NULL THEN
    FOR z IN SELECT x.zi, x.nr FROM unnest(coalesce(p_zile, ARRAY[]::date[])) WITH ORDINALITY AS x(zi, nr)
              WHERE x.nr BETWEEN 1 AND 3 AND x.zi IS NOT NULL AND x.zi >= p_acum::date ORDER BY x.zi, x.nr LOOP
      -- ora de inceput la inceputul programului: HH:MM / H:MM (si cu punct), urmata de altceva decat o cifra
      v_m := regexp_match(ltrim(coalesce(p_programe[z.nr], ''), v_spatii), '^(2[0-3]|[01]?[0-9])[:.]([0-5][0-9])([^0-9]|$)');
      v_o := CASE WHEN v_m IS NULL THEN NULL ELSE lpad(v_m[1], 2, '0') || ':' || v_m[2] END;
      IF z.zi = p_acum::date AND v_o IS NOT NULL AND (z.zi + v_o::time) <= p_acum THEN
        CONTINUE;
      END IF;
      v_zi := z.zi; v_nr := z.nr; v_ora := v_o;
      EXIT;
    END LOOP;
  END IF;
  IF v_zi IS NULL THEN
    v_lips := array_append(v_lips, 'zi_sesiune');
  ELSIF v_ora IS NULL THEN
    v_lips := array_append(v_lips, 'program_zi');
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
COMMENT ON FUNCTION public.fn_sms_redari_sablon_calc(text, date[], text[], text, timestamp) IS 'SMS Redari (pura, interna): completeaza sablonul. {COMUNA} = numele UAT, {ZI} = prima zi din p_zile (1..3) a carei sesiune nu a inceput la p_acum (ora Romaniei, fara fus), ZZ.LL; {ORA} = ora de inceput HH:MM din programul acelei zile; {TEL} = telefonul de contact (6-15 cifre). Intoarce ok, motiv (lipsuri / prea_lung / caractere_nepermise / gol), lipsuri (uat_nume, zi_sesiune, program_zi, telefon_contact), text, lungime GSM-7, zi, zi_nr, ora. Oglinda completeazaSablon() din src/sms/sablonRedari.js.';

-- ─── 2. Eligibilitatea (o singura definitie: creare + rezervare) si valabilitatea unui lot din sablon ─────────────────────────
CREATE FUNCTION public.fn_sms_redari_persoane(p_proiect_id uuid, p_uat_id uuid)
RETURNS TABLE (pers text, exclus text, tel text, det text, dets text[], tels text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH r AS (
    SELECT d.id, (d.sters_la IS NULL AND pa.sters_la IS NULL) AS activ,
           coalesce(public.fn_red_cheie_calc(d.nume_normalizat, k.adresa_strada, k.adresa_sat, k.adresa_comuna, k.adresa_judet, k.cod_postal,
                                             k.adresa_cunoscuta), 'd:' || d.id::text) AS pers,
           public.fn_sms_tel_normalizat(k.telefon) AS tel,
           EXISTS (SELECT 1 FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) AS conv,
           EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = d.id) AS raspuns,
           EXISTS (SELECT 1 FROM public.red_procese_verbale v
                    WHERE v.sters_la IS NULL AND v.stare = 'semnat'
                      AND ((v.tip = 'A' AND v.detinator_id = d.id) OR (v.tip = 'B' AND v.parcela_id = d.parcela_id))) AS pv
      FROM public.red_detinatori d
      JOIN public.red_parcele pa ON pa.id = d.parcela_id AND pa.proiect_id = p_proiect_id AND pa.uat_id = p_uat_id
      LEFT JOIN public.red_detinatori_contact k ON k.detinator_id = d.id
     WHERE d.decedat IS NOT TRUE
  ), r2 AS (
    -- randurile arhivate (rand sau parcela stearsa) aduc DOAR raspunsul lor; eligibilitatea vine din randurile active
    SELECT r.*, r.activ AND r.conv AND NOT r.pv AS deschis,
           (r.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = r.tel AND o.activ)) AS opt
      FROM r
  ), p AS (
    SELECT r2.pers, bool_or(r2.activ AND r2.conv) AS convocat, bool_or(r2.raspuns) AS raspuns, bool_or(r2.deschis) AS deschis,
           bool_or(r2.deschis AND r2.tel IS NOT NULL) AS are_tel,
           min(r2.tel) FILTER (WHERE r2.deschis AND r2.tel IS NOT NULL AND NOT r2.opt) AS tel,
           array_agg(r2.id::text ORDER BY r2.id::text) FILTER (WHERE r2.activ) AS dets,
           coalesce(array_agg(DISTINCT r2.tel) FILTER (WHERE r2.deschis AND r2.tel IS NOT NULL AND NOT r2.opt), ARRAY[]::text[]) AS tels
      FROM r2 GROUP BY r2.pers
  )
  SELECT p.pers,
         CASE WHEN p.raspuns THEN 'a_raspuns' WHEN NOT p.deschis THEN 'pv_semnat' WHEN NOT p.are_tel THEN 'fara_mobil' WHEN p.tel IS NULL THEN 'optout' END,
         p.tel, (SELECT min(x.id::text) FROM r2 x WHERE x.pers = p.pers AND x.deschis AND x.tel = p.tel), p.dets, p.tels
    FROM p
   WHERE p.convocat
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_persoane(uuid, uuid) IS 'SMS Redari (intern, fara drept de apel): persoanele convocate din UAT (cheia fn_red_cheie_calc; randuri active, nedecedate) cu motivul excluderii: a_raspuns (raspuns pe oricare rand al persoanei, si arhivat, orice canal), pv_semnat (nicio parcela convocata fara PV semnat), fara_mobil, optout; NULL = eligibila. tel = cel mai mic mobil fara opt-out de pe randurile deschise, det = randul lui, dets = randurile active ale persoanei in UAT, tels = mobilele fara opt-out de pe randurile deschise. Singura definitie, folosita la creare si la rezervare.';

CREATE FUNCTION public.fn_sms_redari_lot_motiv_la(p_lot public.sms_loturi, p_acum timestamptz) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_start timestamptz; u public.red_uat; v_tel text; v_s jsonb;
BEGIN
  IF p_lot.categorie IS DISTINCT FROM 'redari' THEN RETURN NULL; END IF;
  -- r5 (Copilot P2-02): un lot Redari fara sablonul recunoscut (text liber, dinainte de 20261130c) nu se mai aproba / trimite
  IF (p_lot.filtru->>'sablon') IS DISTINCT FROM 'redari_v1' THEN RETURN 'lot_vechi_fara_sablon'; END IF;
  -- inceputul sesiunii din lot (ora Romaniei); lipsa / invalid = expirat (fail-closed)
  IF coalesce(p_lot.filtru->>'zi', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p_lot.filtru->>'ora', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN 'sesiune_expirata';
  END IF;
  v_start := ((p_lot.filtru->>'zi')::date + (p_lot.filtru->>'ora')::time) AT TIME ZONE 'Europe/Bucharest';
  IF p_acum IS NULL OR v_start <= p_acum THEN RETURN 'sesiune_expirata'; END IF;
  -- textul recalculat ACUM din setarile UAT / proiectului trebuie sa fie cel al lotului
  SELECT * INTO u FROM public.red_uat x WHERE x.id = p_lot.uat_id AND x.proiect_id = p_lot.proiect_id;
  IF NOT FOUND THEN RETURN 'text_schimbat'; END IF;
  SELECT pr.contact_telefon INTO v_tel FROM public.red_proiecte pr WHERE pr.id = p_lot.proiect_id;
  v_s := public.fn_sms_redari_sablon_calc(u.nume, ARRAY[u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3], ARRAY[u.program_zi1, u.program_zi2, u.program_zi3],
                                          v_tel, (p_acum AT TIME ZONE 'Europe/Bucharest'));
  IF (v_s->>'ok')::boolean IS NOT TRUE OR (v_s->>'text') IS DISTINCT FROM p_lot.text THEN RETURN 'text_schimbat'; END IF;
  RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_redari_lot_motiv_la(public.sms_loturi, timestamptz) IS 'SMS Redari (intern): pentru un lot Redari fara filtru.sablon = redari_v1 intoarce lot_vechi_fara_sablon; pentru un lot din sablon intoarce sesiune_expirata (sesiunea din filtru.zi + filtru.ora, ora Romaniei, a inceput la p_acum; p_acum NULL = expirat) sau text_schimbat (textul recalculat la p_acum difera); NULL = lotul poate fi aprobat / rezervat. Alte loturi: NULL. Momentul e parametru ca sa fie testabil.';

-- r3 (Jakarinos P2): momentul efectiv (clock_timestamp), nu inceputul tranzactiei; apelantii il cheama dupa lock-uri
CREATE FUNCTION public.fn_sms_redari_lot_motiv(p_lot public.sms_loturi) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.fn_sms_redari_lot_motiv_la(p_lot, clock_timestamp())
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_lot_motiv(public.sms_loturi) IS 'SMS Redari (intern): fn_sms_redari_lot_motiv_la(lot, clock_timestamp()). Se cheama dupa lock-urile pe setari / lot (triggerul de aprobare, fn_sms_rezerva), deci o asteptare la lock nu face o sesiune inceputa sa para viitoare.';

-- r5 (Copilot P2-03): fereastra SMS-ului extern (08:00-20:00 ora Romaniei) pe un moment dat; fn_sms_rezerva o cheama cu clock_timestamp()
CREATE FUNCTION public.fn_sms_fereastra_externa(p_acum timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT p_acum IS NOT NULL AND extract(hour FROM p_acum AT TIME ZONE 'Europe/Bucharest') BETWEEN 8 AND 19
$fn$;
COMMENT ON FUNCTION public.fn_sms_fereastra_externa(timestamptz) IS 'SMS (pura, interna): p_acum e in fereastra SMS-ului extern 08:00-20:00 ora Romaniei (ora 8..19). NULL = nu. Aceeasi regula ca inFereastraExterna din _shared/smsText.mjs.';

-- ─── 3. Crearea lotului Redari din sablon (singura cale a aplicatiei) ─────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_lot_redari_sablon_creeaza(p_proiect_id uuid, p_uat_id uuid, p_text_afisat text DEFAULT NULL,
                                                       p_set_hash text DEFAULT NULL, p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_niv text; v_s jsonb; v_text text; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_pv integer;
        v_rasp integer; v_dup integer; v_nr integer; v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_activ uuid;
        v_campanie uuid; v_hash text; u public.red_uat; v_tel_contact text; v_preview boolean := coalesce(p_doar_preview, true);
BEGIN
  -- Ordinea lock-urilor: UAT (lock consultativ 'sms_redari_uat:<uat>', doar la creare) -> INSERT lot (triggerul citeste setarile fara
  -- lock) -> INSERT mesaje (triggerul ia lotul nou, al acestei tranzactii). Nicio alta cale nu ia lock-ul UAT-ului: fara ciclu.
  -- r5 (P3-02): verificarile (lot activ, campanie, lista) presupun READ COMMITTED (instantaneu nou dupa lock), ca fn_sms_rezerva
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'sms redari: crearea cere izolarea READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
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
  -- textul il face BD-ul, din setarile de ACUM si ora Romaniei (o sesiune deja inceputa nu se mai alege); r3: clock_timestamp(), dupa
  -- lock-ul UAT-ului (la creare), ca o asteptare la lock sa nu aleaga o sesiune care a inceput intre timp
  v_s := public.fn_sms_redari_sablon_calc(u.nume, ARRAY[u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3], ARRAY[u.program_zi1, u.program_zi2, u.program_zi3],
                                          v_tel_contact, (clock_timestamp() AT TIME ZONE 'Europe/Bucharest'));
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
  -- un singur lot Redari activ pe UAT: draft / aprobat / in_trimitere, sau coada_golita cu mesaje inca necunoscut (sub lock-ul UAT-ului)
  SELECT l.id INTO v_activ FROM public.sms_loturi l
   WHERE l.categorie = 'redari' AND l.uat_id = p_uat_id
     AND (l.stare IN ('draft', 'aprobat', 'in_trimitere')
          OR (l.stare = 'coada_golita' AND EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'necunoscut')))
   ORDER BY l.creat_la DESC, l.id LIMIT 1;
  -- o singura campanie (UAT + zi de sesiune + sablon) cat timp lotul ei nu e anulat
  SELECT l.id INTO v_campanie FROM public.sms_loturi l
   WHERE l.categorie = 'redari' AND l.uat_id = p_uat_id AND l.stare <> 'anulat' AND l.filtru->>'sablon' = 'redari_v1'
     AND l.filtru->>'zi' = v_s->>'zi'
   ORDER BY l.creat_la DESC, l.id LIMIT 1;
  IF NOT v_preview AND v_activ IS NOT NULL THEN
    RAISE EXCEPTION 'sms redari: UAT-ul are deja un lot activ (draft / aprobat / in trimitere / mesaje in curs); anuleaza-l sau asteapta-l din SMS -> Istoric'
      USING ERRCODE = '23505';
  END IF;
  IF NOT v_preview AND v_campanie IS NOT NULL THEN
    RAISE EXCEPTION 'sms redari: campania pentru acest UAT si ziua de sesiune % exista deja (un lot neanulat); nu se trimite de doua ori', v_s->>'zi'
      USING ERRCODE = '23505';
  END IF;
  -- destinatarii, intr-un singur instantaneu: persoanele eligibile (fn_sms_redari_persoane) -> un SMS de telefon
  WITH c AS (
    SELECT * FROM public.fn_sms_redari_persoane(p_proiect_id, p_uat_id)
  ), d AS (
    SELECT DISTINCT ON (c.tel) c.tel, c.pers, c.det FROM c WHERE c.exclus IS NULL ORDER BY c.tel, c.pers
  )
  SELECT (SELECT count(*) FROM c), (SELECT count(*) FROM c WHERE c.exclus = 'pv_semnat'), (SELECT count(*) FROM c WHERE c.exclus = 'a_raspuns'),
         (SELECT count(*) FROM c WHERE c.exclus = 'fara_mobil'), (SELECT count(*) FROM c WHERE c.exclus = 'optout'),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.det ORDER BY d.tel) FROM d),
         (SELECT md5(coalesce(string_agg(d.pers || '|' || d.tel || '|' || d.det, ',' ORDER BY d.tel, d.pers), '')) FROM d)
    INTO v_cand, v_pv, v_rasp, v_fara, v_opt, v_tel, v_ids, v_hash;
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
    IF p_set_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'sms redari: lista s-a schimbat, previzualizeaza din nou' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.sms_loturi (categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('redari', v_text, p_proiect_id, p_uat_id,
            jsonb_build_object('uat_id', p_uat_id, 'sablon', 'redari_v1', 'zi', v_s->'zi', 'zi_nr', v_s->'zi_nr', 'ora', v_s->'ora',
                               'candidati', v_cand, 'excluse_pv_semnat', v_pv, 'excluse_a_raspuns', v_rasp, 'excluse_duplicat', v_dup, 'set_hash', v_hash),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, x.t, 'detinator', x.i FROM unnest(v_tel, v_ids) AS x(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'redari', 'sablon', 'redari_v1', 'text_final', v_text, 'lungime', (v_s->>'lungime')::integer,
    'segmente', 1, 'zi', v_s->'zi', 'zi_nr', v_s->'zi_nr', 'ora', v_s->'ora', 'set_hash', v_hash,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_pv_semnat', v_pv, 'excluse_a_raspuns', v_rasp, 'excluse_fara_mobil', v_fara,
    'excluse_optout', v_opt, 'excluse_duplicat', v_dup, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'lot_activ_uat', v_activ, 'campanie_existenta', v_campanie, 'preview', v_preview, 'nivel', v_niv);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, text, boolean) IS 'SMS Redari: previzualizeaza / creeaza (draft) lotul din sablonul fix pe un UAT. Textul il completeaza BD-ul (fn_sms_redari_sablon_calc, sesiunea care nu a inceput); la creare p_text_afisat si p_set_hash (din previzualizare) trebuie sa fie identice (altfel 40001). Destinatari: fn_sms_redari_persoane (fara raspuns pe nicio parcela, cu parcele fara PV semnat), un SMS de persoana si de telefon. Un singur lot activ pe UAT si o singura campanie UAT + zi + sablon neanulata. Niveluri ca 20261130b.';

-- ─── 4. Aprobarea (trigger) si rezervarea: corpurile 20261130b + verificarile lotului din sablon ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_loturi_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; v record; v_niv text; v_motiv text;
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
      -- 20261130c: lotul Redari se aproba doar din sablon, inainte de inceputul sesiunii si cu textul inca valabil (pe orice cale)
      v_motiv := public.fn_sms_redari_lot_motiv(NEW);
      IF v_motiv IS NOT NULL THEN
        RAISE EXCEPTION 'sms redari: % - %; anuleaza lotul si creeaza altul', v_motiv,
          CASE v_motiv WHEN 'sesiune_expirata' THEN 'sesiunea din text a inceput deja'
                       WHEN 'lot_vechi_fara_sablon' THEN 'lot Redari vechi, cu text liber (fara sablon)'
                       ELSE 'textul nu mai corespunde setarilor UAT / proiectului' END
          USING ERRCODE = '22023';
      END IF;
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
        v_test integer; v_motiv text;
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
  -- 20261130c r5 (Copilot P2-03): reperul de timp e momentul efectiv (clock_timestamp), dupa lock-ul pe setari, nu inceputul tranzactiei;
  -- fereastra 08-20 se decide prin fn_sms_fereastra_externa(clock_timestamp()) (v_ora ramane doar informativ)
  v_ora := extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::integer;
  -- cron intern (fara lot): cel mai vechi lot aprobat care poate pleca acum (niciodata un lot de test in afara limitelor sau cu
  -- bugetul zilnic al contului atins)
  IF p_lot_id IS NULL THEN
    SELECT * INTO l FROM public.sms_loturi x
     WHERE x.stare IN ('aprobat', 'in_trimitere') AND (x.categorie = 'intern' OR (s.redari_autorizat AND public.fn_sms_fereastra_externa(clock_timestamp())))
       AND NOT ('test' IN (coalesce(x.creat_nivel, ''), coalesce(x.aprobat_nivel, ''))
                AND NOT public.fn_sms_lot_permis('test', false, true, x.categorie, x.nr_destinatari, true))
       AND NOT coalesce(x.creat_nivel = 'test' AND public.fn_sms_test_consum_zi(x.creat_de) + x.segmente > public.fn_sms_test_buget_zi(), false)
       AND NOT coalesce(x.creat_nivel = 'test' AND public.fn_sms_nivel_cont(x.creat_de) IS NULL, false)
       -- 20261130c: cronul sare loturile Redari refuzate (vechi fara sablon / expirate / cu textul schimbat), nu le blocheaza pe celelalte
       AND public.fn_sms_redari_lot_motiv(x) IS NULL
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
  -- 20261130c: lotul Redari pleaca doar din sablon (lot_vechi_fara_sablon), inainte de inceputul sesiunii si cu textul inca valabil,
  -- la fiecare transa (fn_sms_redari_lot_motiv pe clock_timestamp, dupa lock-urile pe setari si pe lot)
  v_motiv := public.fn_sms_redari_lot_motiv(l);
  IF v_motiv IS NOT NULL THEN RETURN jsonb_build_object('motiv', v_motiv, 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND l.filtru->>'sablon' = 'redari_v1' THEN
    -- r4 (Jakarinos P2): intai opt-out-ul (acelasi UPDATE ca mai jos, adus inainte pentru loturile din sablon): mesajul cu opt-out
    -- pastreaza motivul real 'optout' si nu ocupa locul persoanei la regrupare
    UPDATE public.sms_mesaje m SET stare = 'anulat', cod_eroare = 'optout'
     WHERE m.lot_id = l.id AND m.stare = 'in_coada' AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = m.telefon AND o.activ);
    -- r5 (Copilot P2-01): pleaca doar daca persoana e INCA eligibila (fn_sms_redari_persoane: exclus NULL, aceeasi regula ca la creare)
    -- SI numarul inghetat in mesaj e inca pe un rand deschis al ei (mobil RO normalizat, fara opt-out); altfel anulat / ne_eligibil,
    -- fara sa se inlocuiasca numarul cu cel nou
    WITH e AS MATERIALIZED (
      SELECT unnest(p.dets) AS det, p.tels FROM public.fn_sms_redari_persoane(l.proiect_id, l.uat_id) p WHERE p.exclus IS NULL
    )
    UPDATE public.sms_mesaje m SET stare = 'anulat', cod_eroare = 'ne_eligibil'
     WHERE m.lot_id = l.id AND m.stare = 'in_coada'
       AND NOT EXISTS (SELECT 1 FROM e WHERE e.det = m.destinatar_id AND m.telefon = ANY (e.tels));
    -- r3: cel mult UN mesaj pe persoana, regrupat pe cheia ACTUALA (nume / adresa corectate dupa creare): ramane cel deja plecat
    -- (orice stare in afara de anulat si in_coada), altfel primul in ordinea creat_la, id; restul din coada -> duplicat_persoana
    WITH k AS MATERIALIZED (
      SELECT m.id, m.stare,
             row_number() OVER (PARTITION BY coalesce(public.fn_red_cheie_persoana(
                                  CASE WHEN m.destinatar_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN m.destinatar_id::uuid END),
                                  'd:' || m.destinatar_id)
                                ORDER BY (m.stare = 'in_coada'), m.creat_la, m.id) AS rang
        FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare <> 'anulat'
    )
    UPDATE public.sms_mesaje m SET stare = 'anulat', cod_eroare = 'duplicat_persoana'
      FROM k WHERE m.id = k.id AND k.rang > 1 AND k.stare = 'in_coada';
  END IF;
  -- 20261130c r5: fereastra 08-20 pe momentul efectiv, dupa lock-urile pe setari si pe lot, imediat inainte de rezervare
  IF l.categorie = 'redari' AND NOT public.fn_sms_fereastra_externa(clock_timestamp()) THEN RETURN jsonb_build_object('motiv', 'in_afara_orelor', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
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

CREATE OR REPLACE FUNCTION public.fn_sms_mesaje_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari; v_cd uuid; v_cn text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: mesajele nu se sterg (sunt jurnalul trimiterii)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- r3: ordinea lock-urilor cont de test -> lot (ca la aprobare); contul fara asteptare (in RPC lock-ul e deja luat)
    SELECT x.creat_de, x.creat_nivel INTO v_cd, v_cn FROM public.sms_loturi x WHERE x.id = NEW.lot_id;
    IF v_cn = 'test' THEN PERFORM public.fn_sms_test_coada_lock(v_cd, false); END IF;
    -- 20261130b r2 (P3-01): randul lotului blocat FOR UPDATE inainte de numarare: inserturile concurente in acelasi lot se serializeaza.
    -- r4 (P3-02): fara asteptare (SKIP LOCKED): RPC-ul care a creat lotul il tine deja (nu e sarit); alta tranzactie => 55P03 imediat
    SELECT * INTO l FROM public.sms_loturi x WHERE x.id = NEW.lot_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND AND EXISTS (SELECT 1 FROM public.sms_loturi x WHERE x.id = NEW.lot_id) THEN
      RAISE EXCEPTION 'sms: lotul e modificat chiar acum de altcineva; scrierea directa nu asteapta (reincearca)' USING ERRCODE = '55P03';
    END IF;
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
      -- r3 (P2-01 a) / r4: creatorul trebuie sa aiba INCA un drept SMS (test, utilizator sau owner); limitele lotului raman cele de test
      IF public.fn_sms_nivel_cont(l.creat_de) IS NULL THEN
        RAISE EXCEPTION 'sms test: creatorul lotului de test nu mai are niciun drept SMS; lotul nu mai pleaca' USING ERRCODE = '42501';
      END IF;
      -- r3 (P3-01 Jakarinos): bugetul se verifica sub acelasi lock ca fn_sms_rezerva (randul de setari). Din fn_sms_rezerva lock-ul e deja
      -- al tranzactiei (SKIP LOCKED nu il sare); la o scriere directa privilegiata nu se asteapta niciodata (55P03), deci nu exista ciclu
      PERFORM 1 FROM public.sms_setari x WHERE x.id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'sms: o rezervare e in curs; scrierea directa nu asteapta (reincearca)' USING ERRCODE = '55P03';
      END IF;
      -- 20261130b r2 (P2-01): bugetul zilnic al contului de test, si la scriere directa (randurile deja rezervate in aceeasi comanda se vad)
      IF public.fn_sms_test_consum_zi(l.creat_de) + NEW.segmente > public.fn_sms_test_buget_zi() THEN
        RAISE EXCEPTION 'sms test: bugetul zilnic al contului de test (% SMS) e atins', public.fn_sms_test_buget_zi() USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.furnizor IS NULL OR NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: rezervarea cere furnizorul, fara id' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = NEW.telefon AND o.activ) THEN
      RAISE EXCEPTION 'sms: numarul are opt-out' USING ERRCODE = '23514';
    END IF;
    -- 20261130c r5: acelasi reper de timp ca plafoanele / bugetul (clock_timestamp dupa lock-uri), nu inceputul tranzactiei
    NEW.rezervat_la := clock_timestamp();
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

CREATE OR REPLACE FUNCTION public.fn_sms_consum(OUT zi integer, OUT luna integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(sum(m.segmente) FILTER (WHERE m.rezervat_la >= (date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::integer,
         coalesce(sum(m.segmente), 0)::integer
    FROM public.sms_mesaje m
   WHERE m.rezervat_la >= (date_trunc('month', clock_timestamp() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
$fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_test_consum_zi(p_uid uuid) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(sum(m.segmente), 0)::integer
    FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
   WHERE p_uid IS NOT NULL AND l.creat_de = p_uid AND l.creat_nivel = 'test'
     AND m.rezervat_la >= (date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
$fn$;

-- ─── 5. Drepturi (privilegiile implicite Supabase dau EXECUTE pe functii noi: se scot explicit) ────────────────────────────
REVOKE ALL ON FUNCTION public.fn_sms_redari_sablon_model(), public.fn_sms_redari_sablon_calc(text, date[], text[], text, timestamp),
  public.fn_sms_redari_persoane(uuid, uuid), public.fn_sms_redari_lot_motiv(public.sms_loturi), public.fn_sms_redari_lot_motiv_la(public.sms_loturi, timestamptz),
  public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, text, boolean), public.fn_sms_fereastra_externa(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_lot_redari_sablon_creeaza(uuid, uuid, text, text, boolean) TO authenticated;
-- textul liber + convocarile active ale proiectului: nu mai e o cale a aplicatiei (decizia: un singur sablon, destinatarii filtrati in BD)
REVOKE EXECUTE ON FUNCTION public.fn_sms_lot_redari_creeaza(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

DO $post$
DECLARE v_o oid; v_n integer; v_j jsonb;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_e_owner()', 'public.fn_sms_nivel()', 'public.fn_sms_loturi_lista(integer)', 'public.fn_sms_panou()',
    'public.fn_sms_angajati_lista()', 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)',
    'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)', 'public.fn_sms_lot_destinatari(uuid)', 'public.fn_sms_lot_aproba(uuid,integer)',
    'public.fn_sms_lot_anuleaza(uuid,text)', 'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)',
    'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', 'public.fn_sms_optout_seteaza(text,boolean,text)']::regprocedure[];
  v_serviciu regprocedure[] := ARRAY['public.fn_sms_rezerva(uuid,integer,text,uuid)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)',
    'public.fn_sms_dlr_aplica(text,text,boolean,timestamptz)']::regprocedure[];
  v_pure regprocedure[] := ARRAY['public.fn_sms_tel_normalizat(text)', 'public.fn_sms_text_final(text)', 'public.fn_sms_text_verifica(text)',
    'public.fn_sms_text_valid(text)', 'public.fn_sms_lot_permis(text,boolean,boolean,text,integer,boolean)', 'public.fn_sms_test_buget_zi()',
    'public.fn_sms_test_coada_max()', 'public.fn_sms_redari_sablon_model()', 'public.fn_sms_redari_sablon_calc(text,date[],text[],text,timestamp)',
    'public.fn_sms_fereastra_externa(timestamptz)']::regprocedure[];
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!';
  IF v_n <> 47 THEN RAISE EXCEPTION '20261130c: % functii fn_sms_* (asteptat 47)', v_n; END IF;
  -- r5 (P2-03): trimiterea, consumul si bugetul nu mai decid pe now(); fereastra 08-20 corecta pe margini
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_rezerva(uuid,integer,text,uuid)'::regprocedure) ~ 'now[(][)]'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_consum()'::regprocedure) ~ 'now[(][)]'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_test_consum_zi(uuid)'::regprocedure) ~ 'now[(][)]'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_mesaje_reguli()'::regprocedure) !~ 'NEW[.]rezervat_la := clock_timestamp[(][)];'
     OR public.fn_sms_fereastra_externa('2026-11-03 19:59:59+02') IS NOT TRUE OR public.fn_sms_fereastra_externa('2026-11-03 20:00:00+02')
     OR public.fn_sms_fereastra_externa('2026-11-03 07:59:59+02') OR public.fn_sms_fereastra_externa('2026-07-01 17:00:00+00')
     OR public.fn_sms_fereastra_externa(NULL) THEN
    RAISE EXCEPTION '20261130c: reperul de timp al trimiterii (clock_timestamp) / fereastra 08-20';
  END IF;
  -- r5 (P3-02): garda de izolare in creare
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)'::regprocedure) !~ 'transaction_isolation' THEN
    RAISE EXCEPTION '20261130c: crearea fara garda READ COMMITTED';
  END IF;
  -- r5 (P2-02): niciun lot Redari activ fara sablon nu mai poate fi aprobat / trimis
  IF EXISTS (SELECT 1 FROM public.sms_loturi l WHERE l.categorie = 'redari' AND (l.filtru->>'sablon') IS DISTINCT FROM 'redari_v1'
               AND (l.stare IN ('draft', 'aprobat', 'in_trimitere')
          OR (l.stare = 'coada_golita' AND EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'necunoscut')))
               AND public.fn_sms_redari_lot_motiv(l) IS DISTINCT FROM 'lot_vechi_fara_sablon') THEN
    RAISE EXCEPTION '20261130c: un lot Redari vechi (fara sablon) mai poate fi trimis';
  END IF;
  -- r3: expirarea se decide pe clock_timestamp() (dupa lock-uri), nicaieri pe now()
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_redari_lot_motiv(public.sms_loturi)'::regprocedure) !~ 'clock_timestamp[(][)]'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_redari_lot_motiv_la(public.sms_loturi,timestamptz)'::regprocedure) ~ 'now[(][)]'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_lot_redari_sablon_creeaza(uuid,uuid,text,text,boolean)'::regprocedure) ~ 'now[(][)]' THEN
    RAISE EXCEPTION '20261130c: expirarea trebuie decisa pe clock_timestamp()';
  END IF;
  -- corpurile inlocuite sunt exact cele generate (20261130b + blocurile 20261130c)
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_loturi_reguli()'::regprocedure), chr(13), '')) <> '8aa147ed61db466ebef5a8500176a951'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_rezerva(uuid,integer,text,uuid)'::regprocedure), chr(13), '')) <> 'e2247722e1b8bee24ddb7578e2e08b68'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_mesaje_reguli()'::regprocedure), chr(13), '')) <> '15ac579d87cd38f650a4b3181b0b50d1'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_consum()'::regprocedure), chr(13), '')) <> 'e004e5f05184fa0a43c2add057302a8a'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_sms_test_consum_zi(uuid)'::regprocedure), chr(13), '')) <> '491335c03706a356cdb7ed8804bd5910' THEN
    RAISE EXCEPTION '20261130c: corpurile inlocuite nu sunt cele generate';
  END IF;
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
  -- sablonul: modelul + completari de control (ziua 1 trecuta -> ziua 2; sesiunea de azi inceputa -> urmatoarea; lipsuri)
  IF public.fn_sms_redari_sablon_model() <> 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}' THEN
    RAISE EXCEPTION '20261130c: modelul sablonului';
  END IF;
  v_j := public.fn_sms_redari_sablon_calc('Jupa', ARRAY['2026-11-05', '2026-11-12', NULL]::date[], ARRAY['08:00-12:00', '9.30 - 15:00', NULL], '0700000112', '2026-11-10 08:00');
  IF v_j->>'text' IS DISTINCT FROM 'Gazpet pt Transgaz: sesiune redare teren la Primaria Jupa, 12.11 ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700000112'
     OR (v_j->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '20261130c: completarea de control %', v_j;
  END IF;
  v_j := public.fn_sms_redari_sablon_calc('Jupa', ARRAY['2026-11-10', '2026-11-12', NULL]::date[], ARRAY['09:00', '10:00', NULL], '0700000112', '2026-11-10 09:00');
  IF (v_j->>'zi_nr')::integer IS DISTINCT FROM 2 THEN RAISE EXCEPTION '20261130c: sesiunea inceputa nu e sarita %', v_j; END IF;
  v_j := public.fn_sms_redari_sablon_calc(' ', NULL, NULL, NULL, '2026-11-10 08:00');
  IF v_j->'lipsuri' IS DISTINCT FROM '["uat_nume", "zi_sesiune", "telefon_contact"]'::jsonb THEN RAISE EXCEPTION '20261130c: lipsurile de control %', v_j; END IF;
END $post$;
