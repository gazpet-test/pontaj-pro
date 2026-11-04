-- Revenire 20261130f_redari_coresp_mail. Runner: o tranzactie, GUC gazpet.revenire_20261130f = 'REDARI_CORESP_MAIL_SCOS:'||txid_current().
-- Ca la 20261130e: revenirea NU sterge date. Tabelul red_corespondenta_mailuri (cu randuri, indecsi, constrangeri) si valorile coloanelor noi
-- (id, cod, destinatar_email, mail_subiect, mail_text, expeditor_email din red_corespondenta) se muta / copiaza intr-o schema de arhiva proprie
-- (redari_retras_<data_ora>), fara acces pentru aplicatie. FK-urile arhivei spre tabelele active se scot (valorile raman), ca arhiva sa nu blocheze
-- tabelele active. fn_red_corespondenta_reguli() revine TEXTUAL la versiunea din 20261130e (md5 pe corp 0705e04f3e26656c2116b6d1b9f87c6e, verificat),
-- apoi coloanele noi se scot, iar RPC-urile si triggerul urmei se scot. red_jurnal ramane neatins. Edge function-ul redari-coresp-mail se opreste separat
-- (fara RPC-uri raspunde cu eroare; nu trimite nimic).
-- Numele schemei de arhiva si numaratorile trec intre pasi prin GUC-uri LOCALE tranzactiei (set_config(..., true)), verificate in pasul 2.
DO $rev$
DECLARE v_schema text := 'redari_retras_' || to_char(clock_timestamp() AT TIME ZONE 'Europe/Bucharest', 'YYYYMMDD_HH24MISS'); v_n bigint; v_a bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130f', true) IS DISTINCT FROM 'REDARI_CORESP_MAIL_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130f revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta_mailuri') IS NULL THEN RAISE EXCEPTION '20261130f revenire: migrarea lipseste'; END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN RAISE EXCEPTION '20261130f revenire: schema de arhiva exista deja (%)', v_schema; END IF;
  -- functia de reguli trebuie sa fie versiunea din 20261130f (altfel s-a schimbat intre timp si revenirea textuala ar pierde munca altcuiva)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_corespondenta_reguli()')) IS DISTINCT FROM 'e49bf054b32057acea04c3913a5c76f5' THEN
    RAISE EXCEPTION '20261130f revenire: fn_red_corespondenta_reguli nu e versiunea din 20261130f';
  END IF;
  -- LOCK inainte de numarare (L14): nimic nu se mai scrie in urma / in coloanele noi pana la COMMIT
  LOCK TABLE public.red_corespondenta, public.red_corespondenta_mailuri IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_corespondenta_mailuri;
  SELECT count(*) INTO v_a FROM public.red_corespondenta WHERE destinatar_email IS NOT NULL OR mail_subiect IS NOT NULL OR mail_text IS NOT NULL OR expeditor_email IS NOT NULL;
  EXECUTE format('CREATE SCHEMA %I', v_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', v_schema);
  -- valorile coloanelor noi (altfel s-ar pierde la DROP COLUMN)
  EXECUTE format('CREATE TABLE %I.red_corespondenta_mail_campuri AS SELECT id AS corespondenta_id, cod, destinatar_email, mail_subiect, mail_text, expeditor_email '
                 'FROM public.red_corespondenta WHERE destinatar_email IS NOT NULL OR mail_subiect IS NOT NULL OR mail_text IS NOT NULL OR expeditor_email IS NOT NULL', v_schema);
  EXECUTE format('REVOKE ALL ON %I.red_corespondenta_mail_campuri FROM PUBLIC, anon, authenticated, service_role', v_schema);
  DROP TRIGGER trg_red_coresp_mail_inainte ON public.red_corespondenta_mailuri;
  DROP TRIGGER trg_red_jurnal ON public.red_corespondenta_mailuri;
  DROP POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri;
  PERFORM set_config('gazpet.revenire_20261130f_schema', v_schema, true);
  PERFORM set_config('gazpet.revenire_20261130f_n', v_n::text || '/' || v_a::text, true);
END $rev$;

-- functia de reguli: textual versiunea din 20261130e (inainte de DROP COLUMN, ca triggerul sa nu mai citeasca coloanele noi)
CREATE OR REPLACE FUNCTION public.fn_red_corespondenta_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_owner boolean; v_mentenanta boolean; v_era_aprobat boolean; v_continut boolean;
        v_cerut uuid; v_fis_id uuid; v_fis_sha text; v_fis_etag text;
BEGIN
  -- Jakarinos r1 P1-02: mentenanta = sesiune SQL directa ca postgres (session_user nu se schimba in SECURITY DEFINER; PostgREST are session_user
  -- „authenticator”) si FARA claims JWT. service_role / anon / authenticated prin API nu sunt mentenanta.
  v_mentenanta := session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
  v_owner := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner);
  v_cerut := NEW.aprobat_fisier_id;   -- 20261130e: fisierul confirmat de owner (folosit DOAR la trecerea in aprobat, altfel ignorat)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id OR NEW.cod IS DISTINCT FROM OLD.cod OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'redari: proiectul, codul si autorul unei corespondente nu se schimba' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;   -- le pune doar triggerul
    NEW.aprobat_fisier_id := OLD.aprobat_fisier_id; NEW.aprobat_sha256 := OLD.aprobat_sha256; NEW.aprobat_storage_etag := OLD.aprobat_storage_etag;   -- 20261130e
  ELSE
    -- Jakarinos r1 P2-03: autorul il pune triggerul (din aplicatie nu se poate falsifica)
    IF NOT v_mentenanta THEN NEW.created_by := auth.uid(); END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  -- Jakarinos r1 P1-01: aprobarea e pe CONTINUT. Daca se schimba destinatarul, ce se trimite, expeditorul sau documentele, aprobarea cade;
  -- cu continut schimbat randul poate ramane doar in draft / la avocat / anulat (altfel ar pleca ceva neaprobat).
  v_continut := TG_OP = 'UPDATE' AND (NEW.destinatar, NEW.subiect, NEW.expeditor, NEW.documente) IS DISTINCT FROM (OLD.destinatar, OLD.subiect, OLD.expeditor, OLD.documente);
  IF v_continut AND OLD.aprobat_la IS NOT NULL THEN
    IF NEW.stare NOT IN ('draft', 'la_avocat', 'anulat') THEN
      RAISE EXCEPTION 'redari: continutul s-a schimbat dupa aprobare; treci randul in draft si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  v_era_aprobat := NEW.aprobat_la IS NOT NULL;
  IF NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat' OR NEW.aprobat_la IS NULL) THEN
    IF NOT (v_owner OR v_mentenanta) THEN RAISE EXCEPTION 'redari: doar Razvan (owner) aproba o corespondenta' USING ERRCODE = '42501'; END IF;
    -- 20261130e: ultimul de_trimis (created_at desc, id desc), citit cu randul parinte deja blocat de acest UPDATE (fn_red_coresp_fisier_inainte
    -- blocheaza acelasi rand la INSERT, deci nu poate aparea un de_trimis nou intre citire si commit). Owner-ul trebuie sa fi confirmat EXACT acest fisier.
    IF TG_OP = 'UPDATE' THEN
      SELECT f.id, f.sha256, f.storage_etag INTO v_fis_id, v_fis_sha, v_fis_etag FROM public.red_corespondenta_fisiere f
       WHERE f.corespondenta_id = NEW.id AND f.rol = 'de_trimis' ORDER BY f.created_at DESC, f.id DESC LIMIT 1;
    END IF;
    IF NOT v_mentenanta THEN
      IF v_fis_id IS NULL THEN RAISE EXCEPTION 'redari: aproba doar dupa ce ai urcat fisierul de trimis' USING ERRCODE = '23514'; END IF;
      IF v_cerut IS NULL THEN RAISE EXCEPTION 'redari: aprobarea trebuie sa indice fisierul de trimis confirmat; reincarca si verifica' USING ERRCODE = '23514'; END IF;
      IF v_cerut IS DISTINCT FROM v_fis_id THEN
        RAISE EXCEPTION 'redari: intre timp s-a urcat alt fisier de trimis; reincarca si verifica' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now(); v_era_aprobat := true;
    NEW.aprobat_fisier_id := v_fis_id; NEW.aprobat_sha256 := v_fis_sha; NEW.aprobat_storage_etag := v_fis_etag;   -- 20261130e
  END IF;
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND NOT v_era_aprobat THEN
    RAISE EXCEPTION 'redari: o corespondenta se marcheaza trimisa doar dupa aprobarea owner-ului' USING ERRCODE = '23514';
  END IF;
  -- 20261130e r3/r4 (Copilot C-P1-01, partea fara edge function): la ORICE schimbare de stare spre trimis / raspuns_primit (inclusiv trimis -> raspuns_primit),
  -- in afara mentenantei, randul trebuie sa aiba fisierul aprobat, iar obiectul lui sa existe in Storage cu ACELASI eTag ca la aprobare.
  -- Singura exceptie: randurile deja trimise istoric fara fisier (D1/D2: OLD in trimis / raspuns_primit cu aprobat_fisier_id NULL) pot trece intre
  -- cele doua stari finale. Un rand `aprobat` dinainte de fisiere (fara aprobat_fisier_id) NU se mai poate marca trimis: cere fisier + o aprobare noua.
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND (TG_OP = 'INSERT' OR NEW.stare IS DISTINCT FROM OLD.stare) AND NOT v_mentenanta
     AND NOT (TG_OP = 'UPDATE' AND OLD.stare IN ('trimis', 'raspuns_primit') AND OLD.aprobat_fisier_id IS NULL) THEN
    IF NEW.aprobat_fisier_id IS NULL THEN
      RAISE EXCEPTION 'redari: aprobarea e dinainte de fisiere: urca PDF-ul de trimis si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.red_corespondenta_fisiere f JOIN storage.objects o ON o.bucket_id = 'redari' AND o.name = f.path
                    WHERE f.id = NEW.aprobat_fisier_id AND left(btrim(o.metadata ->> 'eTag'), 200) = NEW.aprobat_storage_etag) THEN
      RAISE EXCEPTION 'redari: fisierul aprobat s-a schimbat sau lipseste din Storage; nu se poate marca trimis' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- revenirea din aprobat/trimis la draft/la_avocat sterge aprobarea (alt „da” la urmatoarea trimitere)
  IF NEW.stare IN ('draft', 'la_avocat') THEN
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_corespondenta_reguli() FROM PUBLIC, anon, authenticated;

DO $rev2$
DECLARE v_schema text := current_setting('gazpet.revenire_20261130f_schema', true); v_nr text := current_setting('gazpet.revenire_20261130f_n', true);
        v_ns oid; v_dupa text; v_fk text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130f', true) IS DISTINCT FROM 'REDARI_CORESP_MAIL_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130f revenire: garda invalida (pas 2)';
  END IF;
  -- schema vine din pasul 1 (GUC local tranzactiei), nu din „ultima redari_retras_%”
  IF v_schema IS NULL OR v_schema !~ '^redari_retras_[0-9]{8}_[0-9]{6}$' OR to_regnamespace(v_schema) IS NULL
     OR to_regclass(format('%I.red_corespondenta_mail_campuri', v_schema)) IS NULL OR coalesce(v_nr, '') !~ '^[0-9]+/[0-9]+$' THEN
    RAISE EXCEPTION '20261130f revenire: pasul 1 nu a rulat in aceasta tranzactie (schema %)', v_schema;
  END IF;
  v_ns := to_regnamespace(v_schema)::oid;
  ALTER TABLE public.red_corespondenta DROP COLUMN destinatar_email, DROP COLUMN mail_subiect, DROP COLUMN mail_text, DROP COLUMN expeditor_email;
  REVOKE ALL ON public.red_corespondenta_mailuri FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE format('ALTER TABLE public.red_corespondenta_mailuri SET SCHEMA %I', v_schema);
  -- arhiva nu mai refera tabelele active (valorile corespondenta_id / proiect_id / fisier_id raman)
  FOREACH v_fk IN ARRAY ARRAY['red_corespondenta_mailuri_coresp_fk', 'red_corespondenta_mailuri_proiect_fk', 'red_corespondenta_mailuri_fisier_fk'] LOOP
    EXECUTE format('ALTER TABLE %I.red_corespondenta_mailuri DROP CONSTRAINT %I', v_schema, v_fk);
  END LOOP;
  DROP FUNCTION public.fn_red_coresp_mail_incepe(uuid);
  DROP FUNCTION public.fn_red_coresp_mail_inchide(uuid, text, text, text);
  DROP FUNCTION public.fn_red_coresp_mail_inainte();
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL OR to_regclass(format('%I.red_corespondenta_mailuri', v_schema)) IS NULL
     OR to_regprocedure('public.fn_red_coresp_mail_incepe(uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_coresp_mail_inchide(uuid,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.fn_red_coresp_mail_inainte()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
                 AND column_name IN ('destinatar_email', 'mail_subiect', 'mail_text', 'expeditor_email'))
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure) IS DISTINCT FROM '0705e04f3e26656c2116b6d1b9f87c6e'
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta'::regclass AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION '20261130f revenire: stare finala gresita';
  END IF;
  -- nimic pierdut: aceleasi numaratori ca inainte de mutare
  EXECUTE format('SELECT (SELECT count(*) FROM %1$I.red_corespondenta_mailuri)::text || ''/'' || (SELECT count(*) FROM %1$I.red_corespondenta_mail_campuri)::text', v_schema) INTO v_dupa;
  IF v_dupa IS DISTINCT FROM v_nr THEN RAISE EXCEPTION '20261130f revenire: numaratori diferite dupa arhivare (% fata de %)', v_dupa, v_nr; END IF;
  -- nicio constrangere FK intre arhiva si tabelele active (in niciun sens)
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid WHERE c.contype = 'f' AND c.connamespace = v_ns AND t.relnamespace <> v_ns)
     OR EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid WHERE c.contype = 'f' AND c.connamespace <> v_ns AND t.relnamespace = v_ns) THEN
    RAISE EXCEPTION '20261130f revenire: arhiva inca e legata de tabelele active';
  END IF;
  RAISE NOTICE '20261130f revenire: urma mailurilor si campurile mailului pastrate in % (mailuri/campuri = %)', v_schema, v_nr;
END $rev2$;
