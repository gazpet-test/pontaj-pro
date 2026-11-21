-- Revenire 20270102a_redari_fan_urmarire_auto. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate TOT ce a creat migrarea: cele 4 funcții noi ale clasei B (fn_red_fan_srv_rulare_incepe / _rulare_apel / _de_urmarit / _rulare_incheie), corpul
-- comun nou fn_red_fan_urmarire_scrie (runda 2), tabelele red_fan_contradictii și red_fan_rulari (cu indexurile și politicile lor) și readuce TEXTUAL
-- corpurile din 20261228a ale fn_red_fan_srv_urmarire (p_rulare nenul = 22023), fn_red_fan_urmarire (owner) și fn_red_fan_urmarire_intern (corpul vechi:
-- contradicția → *_contrazis + „de verificat”), cu amprentele md5 verificate DUPĂ, împreună cu proprietățile și EXECUTE-ul celor 52 de funcții ale bazei.
-- REFUZĂ (L14, textual) dacă există ORICE urmă a migrării în date: un rând în red_fan_rulari (istoricul rulărilor), un rând în red_fan_contradictii
--   (semnalele de audit nu se pierd), un eveniment urmarire_auto / ridicare_auto sau un rând red_fan_rulari în red_jurnal (append-only, nu se șterge).
--   Faptele de urmărire fără urmă (de ex. o livrare simplă scrisă de buton după migrare) sunt de aceeași natură cu cele de dinainte și respectă
--   CHECK-urile vechi; revenirea nu le atinge.
-- ÎNAINTE de revenire: jobul cron se oprește (cron.unschedule), altfel apelurile lui primesc erori după revenire (funcțiile lipsesc; nimic nu se scrie).
-- LIVRAREA = prin runner, plafonul 2000 al revenirilor, fără amprentă globală (docs/LIVRARE_L15_V2.md §9, varianta A):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql --sha256 <sha256> --versiune 20270102120001
--        --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres --plafon-tranzactie-ms 2000
-- Ordinea (L06, L14): 1. gărzile + starea (doar catalog); 2. LOCK red_fan_rulari + red_fan_contradictii ACCESS EXCLUSIVE NOWAIT (bugetul de 1 s de la
--   BEGIN), ÎNAINTEA verificării „fără date”; 3. sub lock: starea din nou, „fără urme”, readucerea corpurilor vechi, DROP-urile, postcondiția. Totul
--   într-o tranzacție (runnerul). (Lock-ul pe red_fan_contradictii ia și SHARE ROW EXCLUSIVE pe red_fan_awb, prin cheia străină, la DROP.)
-- Probe: scripts/pglite/test_redari_fan_urmarire_auto_local.mjs (aplicare → revenire → re-aplicare pe bază curată; refuz la fiecare urmă).
DO $garda$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270102a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270102a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20270102a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270102a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270102a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20270102a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_fan_rulari, public.red_fan_contradictii IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20270102a revenire: BUGET_LOCK: lock-ul obtinut abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    -- starea = cea de după 20270102a: tabelele, cele 5 funcții noi, exact 57 de funcții fn_red_fan_*, corpurile noi ale celor 3 funcții înlocuite
    -- (to_regclass / to_regprocedure: pe o bază fără migrare refuzul e al gărzii, nu o eroare de cast)
    IF to_regclass('public.red_fan_rulari') IS NULL OR to_regclass('public.red_fan_contradictii') IS NULL
       OR to_regprocedure('public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid)') IS NULL
       OR to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_apel(uuid)') IS NULL
       OR to_regprocedure('public.fn_red_fan_srv_de_urmarit(uuid)') IS NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer)') IS NULL
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 57
       OR (SELECT count(*) FROM pg_proc p JOIN (VALUES
                        -- >>> AMPRENTE-NOI 20270102a (corpurile noi ale celor 3 funcții înlocuite)
                        ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', 'c822d21b2f713f5a61ebb65b403718c6'),
                        ('public.fn_red_fan_urmarire(uuid,jsonb)', 'f310b4933f6064f4c2187e1602b46bb1'),
                        ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '50512f2506fcbf23bda6e4559cfbc71f')
                        -- <<< AMPRENTE-NOI 20270102a
                     ) a(semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura) AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta) <> 3 THEN
      RAISE EXCEPTION '20270102a revenire: starea nu e cea din 20270102a (pasul %)', v_pas;
    END IF;
    -- dependențe străine spre tabelele migrării (vederi / chei străine / politici ale altei migrări) = refuz
    IF EXISTS (SELECT 1 FROM pg_depend d CROSS JOIN unnest(ARRAY['public.red_fan_rulari'::regclass, 'public.red_fan_contradictii'::regclass]) AS t(rel)
                WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = t.rel AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_class'::regclass AND d.objid = t.rel)
                  AND NOT (d.classid = 'pg_constraint'::regclass AND d.objid IN (SELECT oid FROM pg_constraint WHERE conrelid = t.rel))
                  AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT oid FROM pg_policy WHERE polrelid = t.rel)))
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid IN ('public.red_fan_rulari'::regclass, 'public.red_fan_contradictii'::regclass))
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.red_fan_rulari'::regclass, 'public.red_fan_contradictii'::regclass) AND NOT tgisinternal) THEN
      RAISE EXCEPTION '20270102a revenire: alte obiecte depind de red_fan_rulari / red_fan_contradictii (vederi / chei straine / trigger-e)';
    END IF;
  END LOOP;
  -- sub lock: fără NICIO urmă a migrării în date (L14, textual)
  IF EXISTS (SELECT 1 FROM public.red_fan_rulari) THEN RAISE EXCEPTION '20270102a revenire: exista rulari automate (istoric) - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_contradictii) THEN
    RAISE EXCEPTION '20270102a revenire: exista contradictii FAN inregistrate (semnalele de audit nu se pierd) - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.tabela = 'red_fan_rulari' OR j.date_noi ->> 'eveniment' IN ('urmarire_auto', 'ridicare_auto')) THEN
    RAISE EXCEPTION '20270102a revenire: red_jurnal are evenimente ale rularilor / ridicarilor automate - refuz (jurnalul nu se sterge)';
  END IF;
END $garda$;

-- ── readucerea TEXTUALĂ a corpurilor din 20261228a (CREATE OR REPLACE păstrează proprietarul și EXECUTE-ul) ──
CREATE OR REPLACE FUNCTION public.fn_red_fan_srv_urmarire(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_rulare IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e livrata (F2)' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
END $fn$;
CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
END $fn$;
CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire_intern(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer; v_pastrate integer;
BEGIN
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE u.id IS NOT NULL AND u.awb ~ '^[0-9]{6,20}$' AND u.versiune IS NOT NULL AND u.versiune >= 0
           AND u.urmarire_stare IN ('fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')
           AND (u.ultim_eveniment IS NULL OR u.ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$')
           AND (u.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.livrat_la IS NULL OR u.livrat_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.ridicat_propus IS NULL OR u.ridicat_propus ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           AND (u.retur_propus IS NULL OR u.retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta'))), count(DISTINCT u.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, versiune integer, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT u.id FROM jsonb_to_recordset(p_randuri) AS u(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = u.id AND a.lot_id = p_lot_id AND a.awb = u.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  UPDATE public.red_fan_awb a SET urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, ultim_eveniment_la text)
   WHERE a.id = u.id AND a.versiune_urmarire = u.versiune AND a.ultim_eveniment_la IS NOT NULL AND u.ultim_eveniment_la IS NULL;
  GET DIAGNOSTICS v_pastrate = ROW_COUNT;
  UPDATE public.red_fan_awb a SET
         urmarire_stare = CASE WHEN m.contradictie OR m.n_stare = 'de_verificat' THEN 'de_verificat' WHEN m.retur THEN 'retur'
                               WHEN m.livrat IS NOT NULL THEN 'livrat' WHEN m.ridicat IS NOT NULL AND m.n_stare IN ('fara_evenimente', 'in_tranzit') THEN 'ridicat'
                               ELSE m.n_stare END,
         ultim_eveniment = m.n_ev, ultim_eveniment_la = m.n_la, ridicat_propus = m.ridicat, livrat_la = m.livrat, retur_propus = m.motiv,
         retur_cunoscut = m.retur, ridicat_contrazis = m.c_rid, livrat_contrazis = m.c_liv, retur_contrazis = m.c_ret,
         urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM (SELECT f.*, (f.c_rid IS NOT NULL OR f.c_liv IS NOT NULL OR f.c_ret IS NOT NULL OR (f.livrat IS NOT NULL AND f.retur)) AS contradictie
            FROM (SELECT u.id, u.versiune, u.urmarire_stare AS n_stare, u.ultim_eveniment AS n_ev, n.la AS n_la,
                         coalesce(b.ridicat_propus, n.rid) AS ridicat, coalesce(b.livrat_la, n.liv) AS livrat, coalesce(b.retur_propus, u.retur_propus) AS motiv,
                         (b.retur_cunoscut OR u.urmarire_stare = 'retur' OR u.retur_propus IS NOT NULL) AS retur,
                         coalesce(b.ridicat_contrazis, CASE WHEN n.rid <> b.ridicat_propus THEN n.rid END) AS c_rid,
                         coalesce(b.livrat_contrazis, CASE WHEN n.liv <> b.livrat_la THEN n.liv END) AS c_liv,
                         coalesce(b.retur_contrazis, CASE WHEN u.retur_propus <> b.retur_propus THEN u.retur_propus END) AS c_ret
                    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, urmarire_stare text, ultim_eveniment text,
                           ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text)
                    JOIN public.red_fan_awb b ON b.id = u.id
                    CROSS JOIN LATERAL (SELECT (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS la, u.ridicat_propus::date AS rid,
                                               (u.livrat_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS liv) n) f) m
   WHERE a.id = m.id AND a.versiune_urmarire = m.versiune
     AND (a.ultim_eveniment_la IS NULL OR (m.n_la IS NOT NULL AND m.n_la >= a.ultim_eveniment_la));
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'pastrate', v_pastrate, 'depasite', v_n - v_scrise - v_pastrate);
END $fn$;

-- ── DROP-urile (ordinea inversă creării) ──
DROP FUNCTION public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer);
DROP FUNCTION public.fn_red_fan_srv_de_urmarit(uuid);
DROP FUNCTION public.fn_red_fan_srv_rulare_apel(uuid);
DROP FUNCTION public.fn_red_fan_srv_rulare_incepe(text, uuid);
DROP FUNCTION public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid);
DROP TABLE public.red_fan_contradictii;
DROP TABLE public.red_fan_rulari;

-- ── postcondiția: exact cele 52 de funcții ale bazei 20261228a, corpul vechi al fn_red_fan_srv_urmarire, tabelul scos ──
DO $post$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_fan_anulare_cere(uuid,text,text,text)', 'ca53da3cbf13b5dc8edb2e24ddfe2f85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_anulat(uuid,text,text)', '6af4ea9ab74f812a29a82ee076550ff2', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'f19e630e2e105cab2f0d65f18dcf47d8', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_awb_garda()', '7e8e1302f342d268bcd4a8c9906bce4f', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', false, false),
      ('public.fn_red_fan_cerere_decide(uuid,boolean,text)', '7515320fedb0b29fa2c23bc9d685966f', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_cerere_retrage(uuid)', '1825378bc3b3ae1f799186cd53e8c409', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_claim_intern(uuid,uuid[],text[],text[],uuid,uuid,boolean)', 'c36df6081bb2e28766f0d5e6e31def02', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'bb7fe9239528916d08e5e9a905fe587f', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', '437ae4f2662ea5626aa0dff220fdfa3c', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', 'da2e4ec6ab90886ffcf40a7dbc5562ca', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari_intern(uuid,jsonb)', 'f34677deebaf08abb03deec737e9db05', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_e_operator()', 'e1c0af5d6997c9c751929bcf652edc10', 'sql', true, 's', 'boolean', true, false),
      ('public.fn_red_fan_e_operator_profil(uuid)', 'c3ebc7662c7a99cf9122c7d0b0905671', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_intentie_incheie_intern(uuid,text,jsonb)', 'ac018ee8fe12ca3e8fe087a08c42ebf3', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_intentie_sumar(uuid)', '706c9c1fb43ee56f2ef030f7e226c62d', 'sql', true, 's', 'jsonb', false, false),
      ('public.fn_red_fan_lot_incheiat(uuid)', 'a788cd02f2ccbbf5fc6b1b5515790c58', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '49a056c348411ba320061c4da1ab3c25', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_lot_permis(uuid)', '74a3a78930b42f6100c2d76917461475', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_permis_valori(boolean,text,boolean)', '1b1110d5bb4934075e626e23a49e8d79', 'sql', false, 'i', 'boolean', false, false),
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', false, false),
      ('public.fn_red_fan_operator_seteaza(uuid,boolean,text)', '2312ff35d3b98c5a0fb41a4d385166de', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_propune(uuid,text,numeric)', '98ed533dba82a221c3e874aee2af62d5', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '95d5b20b47d04dd11ba230017d8fde85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_reconciliaza_intern(uuid,text,numeric,numeric,text,uuid,boolean)', '64afc6f76bcd26692ad694f8297d6334', 'plpgsql', true, 'v', 'text', false, false),
      ('public.fn_red_fan_retrage(uuid,text)', '1c786f1641f82f0287f2e8ee943465e9', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'f2a5a8d722a06dc34e5060321be15e12', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_rezultate_intern(uuid,jsonb,integer,uuid,uuid)', 'c46607410f5b6c8cdcb6710d0f9f2982', 'plpgsql', true, 'v', 'integer', false, false),
      ('public.fn_red_fan_ridicat(uuid,date)', '99fc55589bdf77c775d7ae1046edd537', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_setari_doar_test(boolean)', '5ca6a20b3ff16f37ee0fb497194a6c83', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_limita_zi(integer)', 'e6b5c61362b113c681298a8a66c0e2ca', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_setari_presupunere_429(boolean,text)', 'd7aa9ac982db4139f048452b7e71ff9f', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_srv_anuleaza(uuid,uuid,text,text)', '08958a14896e5b07c0892567f012c90d', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_claim(uuid,uuid,uuid,uuid[],text[],text[])', 'b8625e36c2dfec0a549287391b83374e', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_confirmari(uuid,uuid,uuid,jsonb)', 'a142ed8f327967633ed3b1e1bc334e87', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', '1017ae767ed3d8f947a18f8d3b9c2c6d', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_poarta(uuid,boolean)', 'eae0c2fa2fc3ec18b44ce55b60a96848', 'plpgsql', true, 's', 'void', false, false),
      ('public.fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', '38e16206cef4468c73e2cf103b163127', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', '216688178ad5d77bb059054a96a31a7a', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', '63ffdb70ebefb68fc1e944e0cd7305c7', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false, false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false, false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '36cafe6b98cf2436e5ffb42370139765', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '966a88fd8c20655714cf7a72dc25e748', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '40109588fdeb59c56784ab4b7ff616be', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_zi_garda()', '5c51181772f185ac5559913dd32918ec', 'plpgsql', true, 'v', 'trigger', false, false)
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, exec_auth, exec_srv)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_srv
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270102a revenire post: functiile nu sunt cele din 20261228a: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 52
     OR to_regclass('public.red_fan_rulari') IS NOT NULL OR to_regclass('public.red_fan_contradictii') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_apel(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_de_urmarit(uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer)') IS NOT NULL THEN
    RAISE EXCEPTION '20270102a revenire post: au ramas obiecte ale migrarii (sau numarul functiilor fn_red_fan_* nu e 52)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270102a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270102a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
