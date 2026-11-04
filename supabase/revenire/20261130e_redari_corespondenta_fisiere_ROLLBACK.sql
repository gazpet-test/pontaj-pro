-- Revenire 20261130e_redari_corespondenta_fisiere. Runner: o tranzactie, GUC gazpet.revenire_20261130e = 'REDARI_CORESP_FISIERE_SCOASE:'||txid_current().
-- Ca la 20261129h: revenirea NU sterge date. Tabelul red_corespondenta_fisiere (cu randuri, indecsi, constrangeri) si legaturile aprobarilor
-- (id, aprobat_fisier_id, aprobat_sha256, aprobat_storage_etag din red_corespondenta) se muta / copiaza intr-o schema de arhiva proprie
-- (redari_retras_<data_ora>), fara acces pentru aplicatie. FK-ul arhivei spre red_corespondenta se scoate (valoarea corespondenta_id ramane), ca arhiva
-- sa nu blocheze tabelele active. fn_red_corespondenta_reguli() revine TEXTUAL la versiunea din 20261129h (verificat prin md5 pe corp), coloanele
-- noi se scot, politica storage red_storage_coresp_sel si verificatorul storage se scot. Obiectele din bucket raman (imutabile). red_jurnal ramane neatins.
-- Numele schemei de arhiva si numaratorile trec intre pasi prin GUC-uri LOCALE tranzactiei (set_config(..., true)), verificate in pasul 2.
DO $rev$
DECLARE v_schema text := 'redari_retras_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS'); v_n bigint; v_a bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130e', true) IS DISTINCT FROM 'REDARI_CORESP_FISIERE_SCOASE:' || txid_current() THEN
    RAISE EXCEPTION '20261130e revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta_fisiere') IS NULL THEN RAISE EXCEPTION '20261130e revenire: migrarea lipseste'; END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261130e revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  LOCK TABLE public.red_corespondenta, public.red_corespondenta_fisiere IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_corespondenta_fisiere;
  SELECT count(*) INTO v_a FROM public.red_corespondenta WHERE aprobat_fisier_id IS NOT NULL OR aprobat_sha256 IS NOT NULL OR aprobat_storage_etag IS NOT NULL;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  -- legaturile aprobarilor (altfel s-ar pierde la DROP COLUMN)
  EXECUTE format('CREATE TABLE %I.red_corespondenta_aprobari_fisier AS SELECT id AS corespondenta_id, cod, aprobat_fisier_id, aprobat_sha256, aprobat_storage_etag, '
                 'aprobat_de, aprobat_la, stare FROM public.red_corespondenta WHERE aprobat_fisier_id IS NOT NULL OR aprobat_sha256 IS NOT NULL OR aprobat_storage_etag IS NOT NULL', v_schema);
  EXECUTE format('REVOKE ALL ON %I.red_corespondenta_aprobari_fisier FROM PUBLIC, anon, authenticated, service_role', v_schema);
  DROP POLICY red_storage_coresp_sel ON storage.objects;
  DROP TRIGGER trg_red_coresp_fisier_inainte ON public.red_corespondenta_fisiere;
  DROP TRIGGER trg_red_coresp_fisier_imutabil ON public.red_corespondenta_fisiere;
  DROP TRIGGER trg_red_coresp_fisier_dupa ON public.red_corespondenta_fisiere;
  DROP TRIGGER trg_red_jurnal ON public.red_corespondenta_fisiere;
  DROP POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere;
  DROP POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere;
  PERFORM set_config('gazpet.revenire_20261130e_schema', v_schema, true);
  PERFORM set_config('gazpet.revenire_20261130e_n', v_n::text || '/' || v_a::text, true);
END $rev$;

-- functia de reguli: textual versiunea din 20261129h (inainte de DROP COLUMN, ca triggerul sa nu mai citeasca coloanele noi)
CREATE OR REPLACE FUNCTION public.fn_red_corespondenta_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_owner boolean; v_mentenanta boolean; v_era_aprobat boolean; v_continut boolean;
BEGIN
  -- Jakarinos r1 P1-02: mentenanta = sesiune SQL directa ca postgres (session_user nu se schimba in SECURITY DEFINER; PostgREST are session_user
  -- „authenticator”) si FARA claims JWT. service_role / anon / authenticated prin API nu sunt mentenanta.
  v_mentenanta := session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
  v_owner := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id OR NEW.cod IS DISTINCT FROM OLD.cod OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'redari: proiectul, codul si autorul unei corespondente nu se schimba' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;   -- le pune doar triggerul
  ELSE
    -- Jakarinos r1 P2-03: autorul il pune triggerul (din aplicatie nu se poate falsifica)
    IF NOT v_mentenanta THEN NEW.created_by := auth.uid(); END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1;
  END IF;
  -- Jakarinos r1 P1-01: aprobarea e pe CONTINUT. Daca se schimba destinatarul, ce se trimite, expeditorul sau documentele, aprobarea cade;
  -- cu continut schimbat randul poate ramane doar in draft / la avocat / anulat (altfel ar pleca ceva neaprobat).
  v_continut := TG_OP = 'UPDATE' AND (NEW.destinatar, NEW.subiect, NEW.expeditor, NEW.documente) IS DISTINCT FROM (OLD.destinatar, OLD.subiect, OLD.expeditor, OLD.documente);
  IF v_continut AND OLD.aprobat_la IS NOT NULL THEN
    IF NEW.stare NOT IN ('draft', 'la_avocat', 'anulat') THEN
      RAISE EXCEPTION 'redari: continutul s-a schimbat dupa aprobare; treci randul in draft si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
  END IF;
  v_era_aprobat := NEW.aprobat_la IS NOT NULL;
  IF NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat' OR NEW.aprobat_la IS NULL) THEN
    IF NOT (v_owner OR v_mentenanta) THEN RAISE EXCEPTION 'redari: doar Razvan (owner) aproba o corespondenta' USING ERRCODE = '42501'; END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now(); v_era_aprobat := true;
  END IF;
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND NOT v_era_aprobat THEN
    RAISE EXCEPTION 'redari: o corespondenta se marcheaza trimisa doar dupa aprobarea owner-ului' USING ERRCODE = '23514';
  END IF;
  -- revenirea din aprobat/trimis la draft/la_avocat sterge aprobarea (alt „da” la urmatoarea trimitere)
  IF NEW.stare IN ('draft', 'la_avocat') THEN NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_corespondenta_reguli() FROM PUBLIC, anon, authenticated;

DO $rev2$
DECLARE v_schema text := current_setting('gazpet.revenire_20261130e_schema', true); v_nr text := current_setting('gazpet.revenire_20261130e_n', true);
        v_ns oid; v_dupa text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130e', true) IS DISTINCT FROM 'REDARI_CORESP_FISIERE_SCOASE:' || txid_current() THEN
    RAISE EXCEPTION '20261130e revenire: garda invalida (pas 2)';
  END IF;
  -- schema vine din pasul 1 (GUC local tranzactiei), nu din „ultima redari_retras_%”
  IF v_schema IS NULL OR v_schema !~ '^redari_retras_[0-9]{8}_[0-9]{6}$' OR to_regnamespace(v_schema) IS NULL
     OR to_regclass(format('%I.red_corespondenta_aprobari_fisier', v_schema)) IS NULL OR coalesce(v_nr, '') !~ '^[0-9]+/[0-9]+$' THEN
    RAISE EXCEPTION '20261130e revenire: pasul 1 nu a rulat in aceasta tranzactie (schema %)', v_schema;
  END IF;
  v_ns := to_regnamespace(v_schema)::oid;
  ALTER TABLE public.red_corespondenta DROP COLUMN aprobat_fisier_id, DROP COLUMN aprobat_sha256, DROP COLUMN aprobat_storage_etag;
  REVOKE ALL ON public.red_corespondenta_fisiere FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE format('ALTER TABLE public.red_corespondenta_fisiere SET SCHEMA %I', v_schema);
  -- arhiva nu mai refera tabelele active (corespondenta_id ramane ca valoare)
  EXECUTE format('ALTER TABLE %I.red_corespondenta_fisiere DROP CONSTRAINT red_corespondenta_fisiere_coresp_fk', v_schema);
  DROP FUNCTION public.fn_red_coresp_fisier_inainte();
  DROP FUNCTION public.fn_red_coresp_fisier_imutabil();
  DROP FUNCTION public.fn_red_coresp_fisier_dupa();
  DROP FUNCTION public.fn_red_storage_verifica_redari(boolean);
  IF to_regclass('public.red_corespondenta_fisiere') IS NOT NULL OR to_regclass(format('%I.red_corespondenta_fisiere', v_schema)) IS NULL
     OR to_regprocedure('public.fn_red_coresp_fisier_inainte()') IS NOT NULL OR to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
                 AND column_name IN ('aprobat_fisier_id', 'aprobat_sha256', 'aprobat_storage_etag'))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_coresp_sel')
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure) IS DISTINCT FROM 'dd78583b43f54010962aad0e0d69ae9c'
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta'::regclass AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION '20261130e revenire: stare finala gresita';
  END IF;
  -- nimic pierdut: aceleasi numaratori ca inainte de mutare
  EXECUTE format('SELECT (SELECT count(*) FROM %1$I.red_corespondenta_fisiere)::text || ''/'' || (SELECT count(*) FROM %1$I.red_corespondenta_aprobari_fisier)::text', v_schema) INTO v_dupa;
  IF v_dupa IS DISTINCT FROM v_nr THEN RAISE EXCEPTION '20261130e revenire: numaratori diferite dupa arhivare (% fata de %)', v_dupa, v_nr; END IF;
  -- nicio constrangere FK intre arhiva si tabelele active (in niciun sens)
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid WHERE c.contype = 'f' AND c.connamespace = v_ns AND t.relnamespace <> v_ns)
     OR EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid WHERE c.contype = 'f' AND c.connamespace <> v_ns AND t.relnamespace = v_ns) THEN
    RAISE EXCEPTION '20261130e revenire: arhiva inca e legata de tabelele active';
  END IF;
  RAISE NOTICE '20261130e revenire: fisierele si aprobarile pastrate in % (fisiere/aprobari = %)', v_schema, v_nr;
END $rev2$;
