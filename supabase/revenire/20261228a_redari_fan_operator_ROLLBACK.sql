-- Revenire 20261228a_redari_fan_operator. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate TOT ce a creat migrarea (Jakarinos: „nu doar obiectele enumerate sumar”): view-urile, trigger-ul gărzii rândului FAN, cele 31 de funcții noi
-- (clasa A, clasa B, interne), tabelele red_fan_zi_consum / red_fan_zi (cu trigger-ul ei) / red_fan_cereri_aprobare / red_fan_intentii /
-- red_fan_operatori, cele 14 coloane noi și CHECK-urile noi din red_fan_awb (indexul viu readus la forma veche, CHECK-urile stare / aprobare / generat
-- readuse textual), cele 3 coloane noi din red_fan_setari; readuce TEXTUAL corpurile din 20261212a ale celor 11 funcții înlocuite (extrase din
-- fișierul 20261212a de scripts generator; amprenta md5 verificată DUPĂ revenire, împreună cu proprietățile și EXECUTE-ul celor 21 de funcții ale bazei 20261212a + 20261227a).
-- REFUZĂ (L14, textual) dacă există ORICE urmă a fluxului nou: operatori numiți, zile / consum de plafon, cereri de aprobare, intenții, rânduri
-- de_aprobat / retras, intentie_cheie / aprobare_owner_la / anulare_ceruta_la / retras_la nenule, anulat_de nenul în afara rândurilor completate de
-- backfill (motiv_anulare = alt_motiv AND anulat_la = updated_at: acestea se golesc odată cu coloanele), setări schimbate (limita_zi <> 20,
-- doar_proiecte_test / presupunere_429 <> true) sau evenimente noi în red_jurnal (append-only, nu se șterge). Cu urme: NU se rulează.
-- LIVRAREA = prin runner, plafonul 2000 al revenirilor, fără amprentă globală (docs/LIVRARE_L15_V2.md §9, varianta A):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261228a_redari_fan_operator_ROLLBACK.sql --sha256 <sha256> --versiune 20261228120001
--        --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres --plafon-tranzactie-ms 2000
-- Ordinea (L06, L14): 1. gărzile + starea (doar catalog); 2. lock-urile, NOWAIT, cu bugetul de 1 s de la BEGIN, în ordinea §6.2 a căilor aplicației:
--   red_proiecte, red_loturi_plicuire (SHARE ROW EXCLUSIVE), red_fan_awb, red_fan_loturi, red_fan_setari, red_fan_zi, red_fan_zi_consum,
--   red_fan_cereri_aprobare, red_fan_intentii, red_fan_operatori (ACCESS EXCLUSIVE), ÎNAINTEA verificării „fără date”; 3. sub lock: starea din nou,
--   „fără urme”, DROP-urile și readucerile, postcondiția (amprentele vechi). Totul într-o tranzacție (runnerul): un refuz anulează tot.
-- Probe: scripts/pglite/test_redari_fan_operator_local.mjs (aplicare → revenire → re-aplicare pe bază curată; refuz la fiecare urmă).
DO $garda$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text;
  v_functii constant text[] := ARRAY['fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', 'fn_red_fan_srv_anuleaza(uuid,uuid,text,text)', 'fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', 'fn_red_fan_srv_confirmari(uuid,uuid,uuid,jsonb)', 'fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', 'fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', 'fn_red_fan_srv_claim(uuid,uuid,uuid,uuid[],text[],text[])', 'fn_red_fan_srv_poarta(uuid,boolean)', 'fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', 'fn_red_fan_anulare_cere(uuid,text,text,text)', 'fn_red_fan_cerere_retrage(uuid)', 'fn_red_fan_cerere_decide(uuid,boolean,text)', 'fn_red_fan_retrage(uuid,text)', 'fn_red_fan_setari_presupunere_429(boolean,text)', 'fn_red_fan_setari_doar_test(boolean)', 'fn_red_fan_setari_limita_zi(integer)', 'fn_red_fan_operator_seteaza(uuid,boolean,text)', 'fn_red_fan_e_operator()', 'fn_red_fan_reconciliaza_intern(uuid,text,numeric,numeric,text,uuid,boolean)', 'fn_red_fan_confirmari_intern(uuid,jsonb)', 'fn_red_fan_urmarire_intern(uuid,jsonb)', 'fn_red_fan_rezultate_intern(uuid,jsonb,integer,uuid,uuid)', 'fn_red_fan_claim_intern(uuid,uuid[],text[],text[],uuid,uuid,boolean)', 'fn_red_fan_intentie_incheie_intern(uuid,text,jsonb)', 'fn_red_fan_intentie_sumar(uuid)', 'fn_red_fan_e_operator_profil(uuid)', 'fn_red_fan_lot_incheiat(uuid)', 'fn_red_fan_lot_permis(uuid)', 'fn_red_fan_lot_permis_valori(boolean,text,boolean)', 'fn_red_fan_zi_garda()', 'fn_red_fan_awb_garda()', 'fn_red_fan_anulat(uuid,text,text)', 'fn_red_fan_aproba(uuid,uuid[],text[])', 'fn_red_fan_camp(text)', 'fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'fn_red_fan_confirmari(uuid,jsonb)', 'fn_red_fan_e_owner()', 'fn_red_fan_lot_marcheaza(uuid,boolean)', 'fn_red_fan_loturi_garda()', 'fn_red_fan_propune(uuid,text,numeric)', 'fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', 'fn_red_fan_rezultate(uuid,jsonb)', 'fn_red_fan_ridicat(uuid,date)', 'fn_red_fan_setari_seteaza(integer)', 'fn_red_fan_suma(numeric)', 'fn_red_fan_surse(uuid)', 'fn_red_fan_tiraj(uuid,text,text)', 'fn_red_fan_tiraj_opreste(uuid,text,boolean)', 'fn_red_fan_urmarire(uuid,jsonb)', 'fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'fn_red_fan_lot_opod(uuid,boolean)', 'fn_red_fan_awb_opod_jurnal()'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261228a_redari_fan_operator_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261228a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261228a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261228a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261228a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261228a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20261228a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_loturi_plicuire IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_awb IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_zi IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_zi_consum IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_cereri_aprobare IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_intentii IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_operatori IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261228a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    -- starea = cea de după 20261228a: tabelele, view-urile, exact cele 52 de funcții (nicio altă fn_red_fan_*; 2 sunt ale 20261227a și rămân), trigger-ele
    IF to_regclass('public.red_fan_operatori') IS NULL OR to_regclass('public.red_fan_zi') IS NULL OR to_regclass('public.red_fan_zi_consum') IS NULL
       OR to_regclass('public.red_fan_cereri_aprobare') IS NULL OR to_regclass('public.red_fan_intentii') IS NULL
       OR to_regclass('public.v_red_fan_plafon_azi') IS NULL OR to_regclass('public.v_red_fan_anulari') IS NULL OR to_regclass('public.v_red_fan_intentii') IS NULL
       OR to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_setari') IS NULL THEN
      RAISE EXCEPTION '20261228a revenire: starea nu e cea din 20261228a (pasul %, tabele / view-uri)', v_pas;
    END IF;
    SELECT string_agg(x.f, ', ') INTO v_rau FROM (
      SELECT f FROM unnest(v_functii) f WHERE to_regprocedure('public.' || f) IS NULL
      UNION ALL
      SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%'
         AND NOT (p.oid = ANY (SELECT to_regprocedure('public.' || f)::oid FROM unnest(v_functii) f))) x;
    IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261228a revenire: starea nu e cea din 20261228a (pasul %, functii: %)', v_pas, v_rau; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND tgname = 'trg_red_fan_awb_garda' AND tgfoid = 'public.fn_red_fan_awb_garda()'::regprocedure)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_fan_zi'::regclass AND tgname = 'trg_red_fan_zi_garda' AND tgfoid = 'public.fn_red_fan_zi_garda()'::regprocedure)
       OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_setari' AND column_name IN ('limita_zi', 'doar_proiecte_test', 'presupunere_429')) <> 3 THEN
      RAISE EXCEPTION '20261228a revenire: starea nu e cea din 20261228a (pasul %, trigger-e / coloane)', v_pas;
    END IF;
    -- dependențe străine spre obiectele migrării (vederi / chei străine / politici ale altei migrări) = refuz
    IF EXISTS (SELECT 1 FROM pg_depend d
                WHERE d.refclassid = 'pg_class'::regclass
                  AND d.refobjid IN ('public.red_fan_operatori'::regclass, 'public.red_fan_zi'::regclass, 'public.red_fan_zi_consum'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass)
                  AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_class'::regclass AND d.objid IN ('public.red_fan_operatori'::regclass, 'public.red_fan_zi'::regclass, 'public.red_fan_zi_consum'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass))
                  AND NOT (d.classid = 'pg_constraint'::regclass AND d.objid IN (SELECT oid FROM pg_constraint WHERE conrelid IN ('public.red_fan_operatori'::regclass, 'public.red_fan_zi'::regclass, 'public.red_fan_zi_consum'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass)))
                  AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT oid FROM pg_policy WHERE polrelid IN ('public.red_fan_operatori'::regclass, 'public.red_fan_zi'::regclass, 'public.red_fan_zi_consum'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass)))
                  AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT oid FROM pg_trigger WHERE tgrelid = 'public.red_fan_zi'::regclass))
                  AND NOT (d.classid = 'pg_rewrite'::regclass AND d.objid IN (SELECT oid FROM pg_rewrite WHERE ev_class IN ('public.v_red_fan_plafon_azi'::regclass, 'public.v_red_fan_anulari'::regclass, 'public.v_red_fan_intentii'::regclass))))
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN ('public.red_fan_operatori'::regclass, 'public.red_fan_zi'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass)) THEN
      RAISE EXCEPTION '20261228a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără NICIO urmă a fluxului nou (L14, textual)
  IF EXISTS (SELECT 1 FROM public.red_fan_operatori) THEN RAISE EXCEPTION '20261228a revenire: exista operatori numiti (si istoric) - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_zi) OR EXISTS (SELECT 1 FROM public.red_fan_zi_consum) THEN RAISE EXCEPTION '20261228a revenire: exista consum al plafonului zilei - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_cereri_aprobare) THEN RAISE EXCEPTION '20261228a revenire: exista cereri de aprobare - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_intentii) THEN RAISE EXCEPTION '20261228a revenire: exista intentii de trimitere - refuz'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE stare IN ('de_aprobat', 'retras') OR intentie_cheie IS NOT NULL OR aprobare_owner_la IS NOT NULL OR cerere_aprobare_id IS NOT NULL
              OR anulare_ceruta_la IS NOT NULL OR retras_la IS NOT NULL
              OR (anulat_la IS NOT NULL AND NOT (motiv_anulare = 'alt_motiv' AND anulat_la = updated_at))) THEN
    RAISE EXCEPTION '20261228a revenire: red_fan_awb are randuri scrise de fluxul nou (stari / coloane noi) - refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_setari WHERE limita_zi <> 20 OR doar_proiecte_test IS NOT TRUE OR presupunere_429 IS NOT TRUE) THEN
    RAISE EXCEPTION '20261228a revenire: setarile noi au fost schimbate - refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.tabela IN ('red_fan_awb', 'red_fan_loturi', 'red_fan_setari', 'red_fan_operatori', 'red_fan_cereri_aprobare', 'red_fan_intentii')
              AND j.date_noi ->> 'eveniment' IN ('comanda', 'marcaj_automat', 'retragere', 'anulare_ceruta', 'anulare_golita', 'anulat', 'cerere_deschisa', 'cerere_decisa', 'cerere_retrasa', 'intentie_incheiata', 'intentie_neincheiata', 'claim', 'rezultate', 'rezultate_neincercat', 'reconciliere', 'presupunere_429_schimbata', 'presupunere_429_contrazisa', 'operator_numit', 'operator_retras', 'operator_retras_intre_timp', 'setari_limita_zi', 'setari_doar_test')) THEN
    RAISE EXCEPTION '20261228a revenire: red_jurnal are evenimente ale fluxului nou - refuz (jurnalul nu se sterge)';
  END IF;
END $garda$;

-- ── DROP-urile (ordinea inversă creării) ──
DROP VIEW public.v_red_fan_intentii;
DROP VIEW public.v_red_fan_anulari;
DROP VIEW public.v_red_fan_plafon_azi;
DROP TRIGGER trg_red_fan_awb_garda ON public.red_fan_awb;
DROP FUNCTION public.fn_red_fan_srv_intentie_incheie(uuid, uuid, jsonb);
DROP FUNCTION public.fn_red_fan_srv_anuleaza(uuid, uuid, text, text);
DROP FUNCTION public.fn_red_fan_srv_reconciliaza(uuid, uuid, text, numeric, numeric);
DROP FUNCTION public.fn_red_fan_srv_confirmari(uuid, uuid, uuid, jsonb);
DROP FUNCTION public.fn_red_fan_srv_urmarire(uuid, uuid, uuid, jsonb);
DROP FUNCTION public.fn_red_fan_srv_rezultate(uuid, uuid, uuid, jsonb, integer);
DROP FUNCTION public.fn_red_fan_srv_claim(uuid, uuid, uuid, uuid[], text[], text[]);
DROP FUNCTION public.fn_red_fan_srv_poarta(uuid, boolean);
DROP FUNCTION public.fn_red_fan_comanda(uuid, uuid, jsonb, text, boolean);
DROP FUNCTION public.fn_red_fan_anulare_cere(uuid, text, text, text);
DROP FUNCTION public.fn_red_fan_cerere_retrage(uuid);
DROP FUNCTION public.fn_red_fan_cerere_decide(uuid, boolean, text);
DROP FUNCTION public.fn_red_fan_retrage(uuid, text);
DROP FUNCTION public.fn_red_fan_setari_presupunere_429(boolean, text);
DROP FUNCTION public.fn_red_fan_setari_doar_test(boolean);
DROP FUNCTION public.fn_red_fan_setari_limita_zi(integer);
DROP FUNCTION public.fn_red_fan_operator_seteaza(uuid, boolean, text);
DROP FUNCTION public.fn_red_fan_e_operator();
DROP FUNCTION public.fn_red_fan_reconciliaza_intern(uuid, text, numeric, numeric, text, uuid, boolean);
DROP FUNCTION public.fn_red_fan_confirmari_intern(uuid, jsonb);
DROP FUNCTION public.fn_red_fan_urmarire_intern(uuid, jsonb);
DROP FUNCTION public.fn_red_fan_rezultate_intern(uuid, jsonb, integer, uuid, uuid);
DROP FUNCTION public.fn_red_fan_claim_intern(uuid, uuid[], text[], text[], uuid, uuid, boolean);
DROP FUNCTION public.fn_red_fan_intentie_incheie_intern(uuid, text, jsonb);
DROP FUNCTION public.fn_red_fan_intentie_sumar(uuid);
DROP FUNCTION public.fn_red_fan_e_operator_profil(uuid);
DROP FUNCTION public.fn_red_fan_lot_incheiat(uuid);
DROP FUNCTION public.fn_red_fan_lot_permis(uuid);
DROP FUNCTION public.fn_red_fan_lot_permis_valori(boolean, text, boolean);
DROP TABLE public.red_fan_zi_consum;
DROP TABLE public.red_fan_zi;
DROP TABLE public.red_fan_cereri_aprobare;
DROP TABLE public.red_fan_intentii;
DROP TABLE public.red_fan_operatori;
DROP FUNCTION public.fn_red_fan_zi_garda();
DROP FUNCTION public.fn_red_fan_awb_garda();
ALTER TABLE public.red_fan_awb
  DROP CONSTRAINT red_fan_awb_de_aprobat, DROP CONSTRAINT red_fan_awb_anulare_conf, DROP CONSTRAINT red_fan_awb_anulare_cerere, DROP CONSTRAINT red_fan_awb_anulat,
  DROP CONSTRAINT red_fan_awb_retras, DROP CONSTRAINT red_fan_awb_stare_check, DROP CONSTRAINT red_fan_awb_aprobare, DROP CONSTRAINT red_fan_awb_generat;
DROP INDEX public.red_fan_awb_intentie_ix;
DROP INDEX public.red_fan_awb_plic_viu_uq;
ALTER TABLE public.red_fan_awb
  DROP COLUMN anulare_nota, DROP COLUMN motiv_anulare, DROP COLUMN anulat_la, DROP COLUMN anulat_de,
  DROP COLUMN anulare_ceruta_nota, DROP COLUMN anulare_ceruta_motiv, DROP COLUMN anulare_ceruta_la, DROP COLUMN anulare_ceruta_de,
  DROP COLUMN motiv_retragere, DROP COLUMN retras_la, DROP COLUMN retras_de, DROP COLUMN intentie_cheie, DROP COLUMN aprobare_owner_la, DROP COLUMN cerere_aprobare_id;
-- CHECK-urile și indexul viu readuse TEXTUAL la forma din 20261212a
ALTER TABLE public.red_fan_awb
  ADD CONSTRAINT red_fan_awb_stare_check CHECK (stare IN ('propus', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat')),
  ADD CONSTRAINT red_fan_awb_aprobare CHECK (stare IN ('propus', 'eroare', 'anulat') OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)),
  ADD CONSTRAINT red_fan_awb_generat CHECK (
    (stare IN ('generat', 'ridicat') AND awb IS NOT NULL AND generat_la IS NOT NULL)
    OR (stare IN ('propus', 'aprobat', 'in_curs', 'eroare', 'necunoscut') AND awb IS NULL)
    OR stare = 'anulat');
CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb (plic_id) WHERE stare NOT IN ('eroare', 'anulat');
ALTER TABLE public.red_fan_setari DROP COLUMN presupunere_429, DROP COLUMN doar_proiecte_test, DROP COLUMN limita_zi;
COMMENT ON COLUMN public.red_fan_loturi.marcat_de IS NULL;

-- ── corpurile VECHI ale celor 11 funcții înlocuite, TEXTUAL din 20261212a (CREATE OR REPLACE păstrează proprietarul și ACL-ul) ──
CREATE OR REPLACE FUNCTION public.fn_red_fan_lot_marcheaza(p_lot_id uuid, p_test boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_lot record; v_vechi record;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul marcheaza lotul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_test IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT id, proiect_id INTO v_lot FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, test, prima_aprobare_la INTO v_vechi FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_vechi.lot_id IS NOT NULL AND v_vechi.test = p_test THEN RETURN p_test; END IF;   -- repetare = no-op
  IF v_vechi.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test nu se mai schimba' USING ERRCODE = 'P0001'; END IF;
  IF v_vechi.lot_id IS NULL THEN
    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, p_test, auth.uid());
  ELSE
    UPDATE public.red_fan_loturi SET test = p_test, marcat_de = auth.uid(), marcat_la = now() WHERE lot_id = p_lot_id;
  END IF;
  RETURN p_test;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_tiraj(p_lot_id uuid, p_cheie text, p_inlocuieste text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_fl record; v_stare text; v_la timestamptz;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor')
     OR (p_inlocuieste IS NOT NULL AND NOT public.fn_red_fan_e_owner()) THEN
    RAISE EXCEPTION 'redari fan: fara drept pe tiraj (inlocuirea: doar owner-ul)' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_cheie IS NULL OR p_cheie !~ '^[0-9a-f]{64}$' OR (p_inlocuieste IS NOT NULL AND p_inlocuieste !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'redari fan: cheie de tiraj invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, tiraj_cheie, tiraj_nr, tiraj_oprit_la INTO v_fl FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: lot FAN nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF p_inlocuieste IS NULL THEN
    IF v_fl.tiraj_oprit_la IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: descarcarile tirajului nr. % sunt oprite (inlocuire in curs); nimic descarcat', v_fl.tiraj_nr USING ERRCODE = 'RD021'; END IF;
    IF v_fl.tiraj_cheie IS NOT DISTINCT FROM p_cheie THEN v_stare := 'acelasi';
    ELSIF v_fl.tiraj_cheie IS NULL THEN v_stare := 'inceput';
    ELSE RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul nr. % a inceput cu alt continut); retipareste tot lotul', v_fl.tiraj_nr USING ERRCODE = 'RD020';
    END IF;
  ELSE
    IF v_fl.tiraj_cheie IS DISTINCT FROM p_inlocuieste THEN
      RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul nr. % a inceput cu alt continut); retipareste tot lotul', v_fl.tiraj_nr USING ERRCODE = 'RD020'; END IF;
    IF p_cheie = v_fl.tiraj_cheie THEN v_stare := 'acelasi';
    ELSIF v_fl.tiraj_oprit_la IS NULL OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN
      RAISE EXCEPTION 'redari fan: opreste intai descarcarile tirajului nr. % si asteapta 30 de secunde, distruge foile, apoi inlocuieste', v_fl.tiraj_nr USING ERRCODE = 'RD022';
    ELSE v_stare := 'inlocuit';
    END IF;
  END IF;
  IF v_stare <> 'acelasi' THEN
    v_la := clock_timestamp();
    UPDATE public.red_fan_loturi SET tiraj_cheie = p_cheie, tiraj_nr = tiraj_nr + 1, tiraj_la = v_la, tiraj_de = auth.uid(),
           tiraj_oprit_la = NULL, tiraj_oprit_de = NULL WHERE lot_id = p_lot_id;
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
    VALUES ('red_fan_loturi', p_lot_id, 'update',
            jsonb_build_object('tiraj_cheie', v_fl.tiraj_cheie, 'tiraj_nr', v_fl.tiraj_nr, 'tiraj_oprit_la', v_fl.tiraj_oprit_la),
            jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), auth.uid());
  END IF;
  RETURN (SELECT jsonb_build_object('stare', v_stare, 'cheie', tiraj_cheie, 'nr', tiraj_nr, 'inceput_la', tiraj_la, 'oprit_la', tiraj_oprit_la)
            FROM public.red_fan_loturi WHERE lot_id = p_lot_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_propune(p_plic_id uuid, p_hash text, p_tarif_estimat numeric) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic record; v_rand record; v_id uuid; v_lot uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari fan: fara drept' USING ERRCODE = '42501'; END IF;
  IF p_plic_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR (p_tarif_estimat IS NOT NULL AND public.fn_red_fan_suma(p_tarif_estimat) IS NULL) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  -- Jakarinos r2 P2 (L06): lotul se blochează ÎNAINTE de plic (ca în fn_red_fan_aproba); INSERT-ul ar lua altfel lock FK pe lot după plic
  SELECT lot_id INTO v_lot FROM public.red_plicuri WHERE id = p_plic_id;
  IF v_lot IS NOT NULL THEN PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_lot FOR UPDATE; END IF;
  SELECT id, proiect_id, lot_id, nr_plic, stare, data_expediere, awb INTO v_plic FROM public.red_plicuri WHERE id = p_plic_id FOR UPDATE;
  IF v_plic.id IS NULL THEN RAISE EXCEPTION 'redari fan: plic inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_plic.lot_id IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'redari fan: plicul s-a mutat intre loturi chiar acum; reincercati' USING ERRCODE = '55P03'; END IF;
  IF v_plic.stare <> 'activ' OR v_plic.data_expediere IS NOT NULL OR v_plic.awb IS NOT NULL OR v_plic.lot_id IS NULL THEN
    RAISE EXCEPTION 'redari fan: plicul nu e activ, neexpediat si intr-un lot' USING ERRCODE = 'P0001'; END IF;
  SELECT id, stare INTO v_rand FROM public.red_fan_awb WHERE plic_id = p_plic_id AND stare NOT IN ('eroare', 'anulat') FOR UPDATE;
  IF v_rand.id IS NOT NULL THEN
    IF v_rand.stare NOT IN ('propus', 'aprobat') THEN RAISE EXCEPTION 'redari fan: plicul are deja un AWB % (nu se re-propune)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_fan_awb SET stare = 'propus', hash_date = p_hash, tarif_estimat = p_tarif_estimat, propus_de = auth.uid(),
           aprobat_de = NULL, aprobat_la = NULL, updated_at = now() WHERE id = v_rand.id;
    RETURN v_rand.id;
  END IF;
  INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, tarif_estimat)
    VALUES (v_plic.proiect_id, v_plic.lot_id, p_plic_id, v_plic.nr_plic, p_hash, p_tarif_estimat) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_deja integer; v_limita integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: lista invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN
    RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul trebuie să fie ÎNCĂ activ, neexpediat și în același lot (hash-ul datelor nu dovedește starea plicului)
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'propus' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'redari fan: % din % randuri s-au schimbat de la previzualizare; reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- lotul pilot: plicurile deja aprobate / trimise din lot + cele de acum ≤ plafon
  SELECT count(*) INTO v_deja FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat');
  SELECT limita_lot INTO v_limita FROM public.red_fan_setari WHERE id;
  IF v_limita IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF v_deja + v_n > v_limita THEN
    RAISE EXCEPTION 'redari fan: lotul ar avea % plicuri aprobate, peste plafonul lotului pilot (%)', v_deja + v_n, v_limita USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = now(), updated_at = now() WHERE id = ANY(p_ids);
  UPDATE public.red_fan_loturi SET prima_aprobare_la = now(), prima_aprobare_de = auth.uid() WHERE lot_id = p_lot_id AND prima_aprobare_la IS NULL;
  RETURN v_n;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cerere uuid := gen_random_uuid(); v_n integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul genereaza' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR p_surse IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 100
     OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) <> cardinality(p_surse)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_surse) s WHERE s IS NULL OR s !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'redari fan: solicitare invalida (1..100 randuri distincte, cu hash si amprenta surselor)' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul anulat / expediat manual / mutat din lot după aprobare → nu se mai plătește un AWB
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: % din % randuri nu mai sunt aprobate cu aceleasi date (plic schimbat, anulat sau deja trimis)', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- runda 2: sursele (plicul + contactele tuturor deținătorilor lui), recalculate ACUM, = cele din care funcția edge a construit expedierea
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_surse) AS t(id, s) ON t.id = a.id
   WHERE public.fn_red_fan_surse(a.plic_id) IS NOT DISTINCT FROM t.s;
  IF v_n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: datele de contact / plicul s-au schimbat la % din % randuri dupa citire; nimic rezervat, reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- ceasul (runda 5): updated_at al rezervării = începutul celor 10 minute după care fn_red_fan_reconciliaza poate închide un „in_curs” →
  -- clock_timestamp() DUPĂ lock-uri (now() l-ar retrodata cu așteptarea lock-ului lotului și ar scurta fereastra generării în desfășurare)
  UPDATE public.red_fan_awb SET stare = 'in_curs', cerere_id = v_cerere, motiv = NULL, updated_at = clock_timestamp() WHERE id = ANY(p_ids);
  RETURN v_cerere;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_rezultate(p_cerere uuid, p_rezultate jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Fără tabele temporare: într-o funcție DEFINER un tabel pg_temp cu același nume, creat dinainte de apelant, ar fi folosit în locul lui.
DECLARE v_asteptate integer; v_n integer; v_bune integer; v_dist integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_cerere IS NULL OR p_rezultate IS NULL OR jsonb_typeof(p_rezultate) <> 'array' OR jsonb_array_length(p_rezultate) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: rezultate invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_id = p_cerere ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_asteptate FROM public.red_fan_awb WHERE cerere_id = p_cerere AND stare = 'in_curs';
  SELECT count(*), count(*) FILTER (WHERE r.id IS NOT NULL AND r.stare IN ('generat', 'eroare', 'necunoscut')
           AND ((r.stare = 'generat' AND r.awb ~ '^[0-9]{6,20}$') OR (r.stare <> 'generat' AND r.awb IS NULL))
           AND (r.tarif IS NULL OR r.tarif >= 0) AND (r.tva IS NULL OR r.tva >= 0)), count(DISTINCT r.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: rezultat invalid' USING ERRCODE = '22023'; END IF;
  IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rezultate) AS r(id uuid)
       LEFT JOIN public.red_fan_awb a ON a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs' WHERE a.id IS NULL) THEN
    RAISE EXCEPTION 'redari fan: rezultat vechi, partial sau cheie straina (CAS)' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET stare = r.stare, awb = r.awb, tarif = public.fn_red_fan_suma(r.tarif), tva = public.fn_red_fan_suma(r.tva), motiv = left(r.motiv, 500),
         generat_la = CASE WHEN r.stare = 'generat' THEN now() END, updated_at = now()
    FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text)
   WHERE a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)' USING ERRCODE = 'P0001'; END IF;
  RETURN v_n;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_reconciliaza(p_id uuid, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rand record; v_stare text;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR (p_awb IS NOT NULL AND p_awb !~ '^[0-9]{6,20}$') OR (p_awb IS NULL AND coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'redari fan: reconciliere invalida (AWB valid sau motivul verificarii)' USING ERRCODE = '22023'; END IF;
  SELECT id, stare, updated_at INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF v_rand.id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  -- ceasul (runda 5): cele 10 minute de la rezervare (updated_at = clock_timestamp() al claim-ului), verificate cu ceasul efectiv, sub lock-ul rândului
  IF NOT (v_rand.stare = 'necunoscut' OR (v_rand.stare = 'in_curs' AND v_rand.updated_at < clock_timestamp() - interval '10 minutes')) THEN
    RAISE EXCEPTION 'redari fan: doar randurile necunoscute (sau in curs de peste 10 minute) se reconciliaza' USING ERRCODE = 'P0001'; END IF;
  v_stare := CASE WHEN p_awb IS NOT NULL THEN 'generat' ELSE 'eroare' END;
  UPDATE public.red_fan_awb SET stare = v_stare, awb = p_awb, tarif = public.fn_red_fan_suma(p_tarif), tva = public.fn_red_fan_suma(p_tva), motiv = left(p_motiv, 500),
         generat_la = CASE WHEN p_awb IS NOT NULL THEN now() END, updated_at = now()
   WHERE id = p_id;
  RETURN v_stare;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_ridicat(p_id uuid, p_data date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_pl record; v_rand record; v_test boolean;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_data IS NULL OR p_data > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: data ridicarii invalida' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT id, stare, awb, data_expediere INTO v_pl FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, ridicat_la, generat_la, lot_id INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  SELECT test INTO v_test FROM public.red_fan_loturi WHERE lot_id = v_rand.lot_id;
  IF v_test IS NULL THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF v_rand.stare = 'ridicat' AND (v_test OR v_pl.awb IS NOT DISTINCT FROM v_rand.awb) THEN RETURN; END IF;   -- C0 repetat
  IF v_rand.stare <> 'generat' THEN RAISE EXCEPTION 'redari fan: doar un AWB generat poate fi ridicat (stare %)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
  IF p_data < (v_rand.generat_la AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: ridicarea nu poate fi inainte de generarea AWB-ului' USING ERRCODE = '22023'; END IF;
  IF NOT v_test THEN
    IF v_pl.stare <> 'activ' OR v_pl.data_expediere IS NOT NULL OR v_pl.awb IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: plicul e anulat sau are deja o expediere inregistrata; verificare manuala' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_plicuri SET awb = v_rand.awb, data_expediere = p_data WHERE id = v_plic_id;
  END IF;
  UPDATE public.red_fan_awb SET stare = 'ridicat', ridicat_la = (p_data::timestamp AT TIME ZONE 'Europe/Bucharest'), updated_at = now() WHERE id = p_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer; v_pastrate integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
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
  -- Runda 3 (Jakarinos #1118 r2 P2, L18): un răspuns FĂRĂ cronologie comparabilă (ultim_eveniment_la NULL: „fără evenimente”, `events: []`)
  -- NU șterge informația cunoscută: pe un rând care are deja un eveniment datat se consemnează doar „verificat la” (urmarit_la, versiunea + 1),
  -- restul rămâne neschimbat („păstrat”). Cu cronologie: evenimentul nu poate fi mai vechi decât cel scris (altfel „depășit”).
  UPDATE public.red_fan_awb a SET urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, ultim_eveniment_la text)
   WHERE a.id = u.id AND a.versiune_urmarire = u.versiune AND a.ultim_eveniment_la IS NOT NULL AND u.ultim_eveniment_la IS NULL;
  GET DIAGNOSTICS v_pastrate = ROW_COUNT;
  -- Runda 4 (Jakarinos #1118 r3 P2): FAPTELE cunoscute (ridicarea, livrarea, returul + motivul) nu se șterg și nu se înlocuiesc de un răspuns
  -- mai nou: valoarea nouă completează doar un fapt necunoscut (coalesce: cunoscut, apoi nou). O valoare nouă DIFERITĂ de un fapt cunoscut =
  -- contradicție: faptul rămâne, valoarea nouă intră în *_contrazis (prima rămâne), iar starea = „de verificat de om” (CHECK red_fan_awb_fapte);
  -- livrat ȘI retur cunoscute deodată = tot contradicție. Fără contradicție, starea ține cont de fapte: retur > livrat > ridicat (un răspuns
  -- parțial „în tranzit” nu coboară un rând livrat / returnat / ridicat); un răspuns neclar („de verificat”) rămâne „de verificat” — faptele
  -- se văd lângă el. Rândul „b” = același rând, deja blocat mai sus (valorile din această tranzacție, inclusiv „păstrate”-le de mai sus).
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

CREATE OR REPLACE FUNCTION public.fn_red_fan_confirmari(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE c.id IS NOT NULL AND c.awb ~ '^[0-9]{6,20}$' AND c.versiune IS NOT NULL AND c.versiune >= 0
           AND c.confirmare_stare IN ('lipsa', 'primita_de_verificat', 'forma_necunoscuta')), count(DISTINCT c.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT c.id FROM jsonb_to_recordset(p_randuri) AS c(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = c.id AND a.lot_id = p_lot_id AND a.awb = c.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET confirmare_stare = c.confirmare_stare, urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text) WHERE a.id = c.id AND a.versiune_urmarire = c.versiune;
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'depasite', v_n - v_scrise);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_fan_anulat(p_id uuid, p_awb text, p_motiv text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$' OR coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'redari fan: anulare invalida (AWB + motiv)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  UPDATE public.red_fan_awb SET stare = 'anulat', motiv = left(p_motiv, 500), updated_at = now() WHERE id = p_id AND stare = 'generat' AND awb = p_awb;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: doar un AWB generat, neridicat, se anuleaza (CAS)' USING ERRCODE = 'P0001'; END IF;
END $fn$;

-- ── postcondiții: starea = cea din 20261212a + 20261227a (21 de funcții cu amprentele, proprietățile și EXECUTE-ul lor; trigger-ul de jurnal oPOD
-- singurul de pe red_fan_awb; tabelele, coloanele și view-urile noi dispărute) ──
DO $post$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_fan_anulat(uuid,text,text)', '9e4edb2069281e97290bebdf7b1b219f', 'plpgsql', true, 'v', 'void', true),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'e584116e292d5a307041225b2ff27fbc', 'plpgsql', true, 'v', 'integer', true),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', false),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', '2e10d8103f144fee46ceae430eff8f6f', 'plpgsql', true, 'v', 'uuid', true),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', '38126aa49c67e10ead3106dbdfee3e02', 'plpgsql', true, 'v', 'jsonb', true),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', false),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '7ea87499188a0c7d6a7189b017fa4805', 'plpgsql', true, 'v', 'boolean', true),
      -- garda loturilor în forma din 20261227a (neatinsă de 20261228a) + cele două funcții ale 20261227a, care rămân
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', false),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', true),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', false),
      ('public.fn_red_fan_propune(uuid,text,numeric)', 'fa0e624dfc9d6a354914ce1da1784b64', 'plpgsql', true, 'v', 'uuid', true),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '156b02110854f35d8817d65c11a12274', 'plpgsql', true, 'v', 'text', true),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'd6aa943671b05296d0bf9548030c7c85', 'plpgsql', true, 'v', 'integer', true),
      ('public.fn_red_fan_ridicat(uuid,date)', 'f4d15e94e4cf50dcfa39403f42a83d81', 'plpgsql', true, 'v', 'void', true),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '07346ffd900bb6a50f213dccab4526b9', 'plpgsql', true, 'v', 'jsonb', true),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '79166f3bdbf6c219745ac47a6c984119', 'plpgsql', true, 'v', 'jsonb', true),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true)
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, exec_auth)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261228a revenire post: functiile nu sunt cele din 20261212a + 20261227a: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 21
     OR to_regclass('public.red_fan_operatori') IS NOT NULL OR to_regclass('public.red_fan_zi') IS NOT NULL OR to_regclass('public.red_fan_zi_consum') IS NOT NULL
     OR to_regclass('public.red_fan_cereri_aprobare') IS NOT NULL OR to_regclass('public.red_fan_intentii') IS NOT NULL
     OR to_regclass('public.v_red_fan_plafon_azi') IS NOT NULL OR to_regclass('public.v_red_fan_anulari') IS NOT NULL OR to_regclass('public.v_red_fan_intentii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_setari' AND column_name IN ('limita_zi', 'doar_proiecte_test', 'presupunere_429'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_awb'
                 AND column_name IN ('cerere_aprobare_id', 'aprobare_owner_la', 'intentie_cheie', 'retras_de', 'retras_la', 'motiv_retragere', 'anulare_ceruta_de', 'anulare_ceruta_la',
                                     'anulare_ceruta_motiv', 'anulare_ceruta_nota', 'anulat_de', 'anulat_la', 'motiv_anulare', 'anulare_nota'))
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_awb_opod_jurnal()'::regprocedure AND tg.tgtype = (1 | 4 | 8 | 16)
                      AND tg.tgattr::text = '') THEN
    RAISE EXCEPTION '20261228a revenire post: au ramas obiecte ale migrarii (sau trigger-ul de jurnal 20261227a nu mai e cel exact)';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.red_fan_awb'::regclass AND c.conname = 'red_fan_awb_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''propus''::text, ''aprobat''::text, ''in_curs''::text, ''generat''::text, ''eroare''::text, ''necunoscut''::text, ''anulat''::text, ''ridicat''::text])))'
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_awb_plic_viu_uq')
       IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb USING btree (plic_id) WHERE (stare <> ALL (ARRAY[''eroare''::text, ''anulat''::text]))' THEN
    RAISE EXCEPTION '20261228a revenire post: CHECK-ul starilor / indexul viu nu au forma din 20261212a';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261228a_redari_fan_operator_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261228a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261228a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
