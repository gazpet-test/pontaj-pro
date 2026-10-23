-- E9 B1. Numai obiecte noi; fără acces la tabelele domeniului.
-- Contractul B2 corectat: admite returnează status/motiv; rezervarea se face
-- EXCLUSIV prin fn_ocr_local_rezerva_apel, niciodată separat în edge.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261108a_ocr_local_cereri:' || txid_current() THEN
    RAISE EXCEPTION '20261108a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261108a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ocr_local_cereri') IS NOT NULL
     OR to_regclass('public.ocr_local_config') IS NOT NULL
     OR to_regclass('public.ocr_local_worker') IS NOT NULL
     OR to_regclass('public.ocr_local_incercari') IS NOT NULL THEN
    RAISE EXCEPTION '20261108a: obiectele exista deja';
  END IF;
END $pre$;

-- Configurație imuabilă pentru apelanți; toate termenele sunt calculate aici.
CREATE TABLE public.ocr_local_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  upload_s int NOT NULL DEFAULT 60 CHECK (upload_s = 60),
  preluare_s int NOT NULL DEFAULT 20 CHECK (preluare_s = 20),
  local_s int NOT NULL DEFAULT 90 CHECK (local_s = 90),
  arbitraj_marja_s int NOT NULL DEFAULT 40 CHECK (arbitraj_marja_s = 40),
  apel_s int NOT NULL DEFAULT 120 CHECK (apel_s = 120),
  semn_s int NOT NULL DEFAULT 45 CHECK (semn_s = 45),
  retentie interval NOT NULL DEFAULT interval '7 days' CHECK (retentie = interval '7 days'),
  rezerva_usd numeric NOT NULL DEFAULT 0.05 CHECK (rezerva_usd = 0.05),
  plafon_usd numeric NOT NULL DEFAULT 10 CHECK (plafon_usd = 10)
);
INSERT INTO public.ocr_local_config DEFAULT VALUES;
CREATE TABLE public.ocr_local_worker (
  worker_id text PRIMARY KEY CHECK (length(worker_id) BETWEEN 1 AND 100),
  stare text NOT NULL CHECK (stare IN ('disponibil','ocupat','pornire','eroare','noapte','oprit')),
  ora_server timestamptz NOT NULL,
  ultimul_semn timestamptz NOT NULL,
  modele jsonb CHECK (pg_column_size(modele) <= 16384),
  versiune text CHECK (length(versiune) <= 100)
);
CREATE TABLE public.ocr_local_incercari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "user" uuid NOT NULL REFERENCES public.profiles(id),
  la timestamptz NOT NULL DEFAULT clock_timestamp(),
  rezultat text NOT NULL CHECK (rezultat ~ '^[a-z_]{1,40}$')
);
CREATE INDEX ocr_local_incercari_user_la ON public.ocr_local_incercari ("user", la);
CREATE INDEX ocr_local_incercari_la ON public.ocr_local_incercari (la);
CREATE TABLE public.ocr_local_cereri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip text NOT NULL DEFAULT 'aviz_e3' CHECK (tip = 'aviz_e3'),
  proiect_id bigint NOT NULL CHECK (proiect_id > 0),
  depozit_id bigint NOT NULL CHECK (depozit_id > 0),
  sablon text NOT NULL CHECK (sablon IN ('aviz_teava','lista_curbe')),
  creat_de uuid NOT NULL REFERENCES public.profiles(id),
  creat_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  pdf_cale text UNIQUE,
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_bytes int NOT NULL CHECK (pdf_bytes BETWEEN 1 AND 8388608),
  pagini int CHECK (pagini = 1),
  stare text NOT NULL CHECK (stare IN ('admisa','ceruta','preluata','gata','esuata','expirata','fallback')),
  ramura text CHECK (ramura IN ('locala','haiku')),
  termen_upload timestamptz NOT NULL,
  -- NULL până la T0 = confirmarea upload-ului (R3 are prioritate).
  termen_preluare timestamptz,
  termen_local timestamptz,
  termen_fallback timestamptz,
  token_executie uuid,
  worker_id text,
  preluata_la timestamptz,
  drept_platit_de text CHECK (drept_platit_de IN ('arbitraj','fallback')),
  drept_platit_la timestamptz,
  rezervare_id bigint UNIQUE REFERENCES public.ai_plafon_rezervari(id),
  apel_faza text CHECK (apel_faza IN ('acordat','rezervat','trimis','raspuns','decontat','esuat_inainte','esuat_dupa')),
  apel_raspuns jsonb CHECK (pg_column_size(apel_raspuns) <= 524288),
  rezultat jsonb CHECK (pg_column_size(rezultat) <= 524288),
  eroare text CHECK (eroare ~ '^[a-z_]{1,40}$'),
  cost_usd numeric CHECK (cost_usd >= 0 AND cost_usd < 'Infinity'::numeric),
  terminata_la timestamptz,
  sterge_dupa timestamptz NOT NULL,
  sters_la timestamptz,
  stergere_incercari int NOT NULL DEFAULT 0 CHECK (stergere_incercari >= 0),
  -- Numai coduri, niciun mesaj extern care ar putea conține OCR / URL / secret.
  stergere_eroare text CHECK (stergere_eroare ~ '^[a-z_]{1,40}$'),
  CHECK ((stare = 'preluata') = (token_executie IS NOT NULL AND preluata_la IS NOT NULL)),
  CHECK ((token_executie IS NULL) = (preluata_la IS NULL)),
  CHECK ((apel_faza IS NULL) = (drept_platit_de IS NULL)),
  CHECK ((drept_platit_de IS NULL) = (drept_platit_la IS NULL)),
  CHECK (apel_faza IS NULL OR apel_faza IN ('acordat','esuat_inainte') OR rezervare_id IS NOT NULL),
  CHECK (apel_faza IS DISTINCT FROM 'acordat' OR rezervare_id IS NULL),
  CHECK (stare NOT IN ('ceruta','preluata','fallback') OR (termen_local IS NOT NULL AND termen_preluare IS NOT NULL)),
  CHECK (stare <> 'fallback' OR termen_fallback IS NOT NULL),
  CHECK (sters_la IS NULL OR (pdf_cale IS NULL AND pdf_sha256 IS NULL AND rezultat IS NULL AND apel_raspuns IS NULL))
);
CREATE INDEX ocr_local_cereri_stare_termen ON public.ocr_local_cereri (stare, termen_preluare);
CREATE INDEX ocr_local_cereri_creator_la ON public.ocr_local_cereri (creat_de, creat_la);
CREATE INDEX ocr_local_cereri_la ON public.ocr_local_cereri (creat_la);
CREATE INDEX ocr_local_cereri_retine ON public.ocr_local_cereri (sterge_dupa) WHERE sters_la IS NULL;
ALTER TABLE public.ocr_local_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_local_worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_local_incercari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_local_cereri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ocr_local_config, public.ocr_local_worker, public.ocr_local_incercari, public.ocr_local_cereri FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ocr_local_incercari_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- UI exclusiv prin B2 → fn_ocr_local_stare; fără SELECT direct pe tabel.
CREATE POLICY ocr_local_creator ON public.ocr_local_cereri FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND creat_de = auth.uid());

-- Helper privat, separat pentru verificarea limitelor 06/22 și DST în harness.
CREATE FUNCTION public.fn_ocr_local_disponibilitate(p_la timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c public.ocr_local_config%ROWTYPE; h time;
BEGIN
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE id;
  h := (p_la AT TIME ZONE 'Europe/Bucharest')::time;
  IF h < time '06:00' OR h >= time '22:00' THEN RETURN 'noapte'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ocr_local_worker WHERE stare='disponibil'
    AND ultimul_semn > p_la-make_interval(secs=>c.semn_s)) THEN RETURN 'local_indisponibil'; END IF;
  RETURN NULL;
END $f$;

-- Helper privat: lock pe rând, apoi ORA REALĂ după lock (nu now() de la BEGIN).
-- Atât cronul cât și stare/drept/rezervare/faze folosesc exact această regulă.
CREATE FUNCTION public.fn_ocr_local_expira_una(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE; c public.ocr_local_config%ROWTYPE;
  t timestamptz; v_cost numeric; v_faza text; v_stare text; v_eroare text;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.sters_la IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE id;
  t := clock_timestamp();
  IF (r.stare = 'fallback' AND t >= r.termen_fallback)
     OR (r.apel_faza IN ('acordat','rezervat','trimis','raspuns','decontat')
         AND t >= r.drept_platit_la + make_interval(secs => c.apel_s)
         AND (r.apel_faza <> 'decontat' OR r.stare IN ('preluata','expirata'))) THEN
    IF r.apel_faza IN ('esuat_inainte','esuat_dupa') THEN
      v_cost := r.cost_usd; v_faza := r.apel_faza; v_stare := 'esuata'; v_eroare := 'apel_pierdut';
    ELSIF r.apel_faza IN ('acordat','rezervat') THEN
      IF r.rezervare_id IS NOT NULL THEN PERFORM public.fn_ai_plafon_deconteaza(r.rezervare_id, 0); END IF;
      v_cost := 0; v_faza := 'esuat_inainte'; v_stare := 'esuata'; v_eroare := 'apel_pierdut';
    ELSE
      -- Chiar cu răspuns salvat, fără decontare costul rămâne necunoscut.
      -- Nu se acceptă un cost din textul OCR și nu se inventează un cost 0.
      IF r.rezervare_id IS NOT NULL THEN
        PERFORM public.fn_ai_plafon_deconteaza(r.rezervare_id, NULL);
        SELECT coalesce(cost_real, suma_rezervata) INTO v_cost FROM public.ai_plafon_rezervari WHERE id = r.rezervare_id;
      END IF;
      v_faza := CASE WHEN r.apel_raspuns IS NOT NULL THEN 'decontat' ELSE 'esuat_dupa' END;
      v_stare := CASE WHEN r.apel_raspuns IS NOT NULL AND r.drept_platit_de = 'fallback'
                       AND NOT (r.apel_raspuns @> '{"invalid":true}'::jsonb) THEN 'gata' ELSE 'esuata' END;
      v_eroare := CASE WHEN v_stare = 'gata' THEN NULL
        WHEN r.apel_raspuns IS NOT NULL AND r.drept_platit_de = 'arbitraj' THEN 'local_cazut_dupa_arbitraj'
        ELSE 'apel_pierdut' END;
    END IF;
    -- Un rezultat local deja finalizat nu este înlocuit de recuperarea costului.
    UPDATE public.ocr_local_cereri SET apel_faza = v_faza, cost_usd = v_cost,
      stare = CASE WHEN r.stare IN ('gata','esuata') AND r.drept_platit_de = 'arbitraj' THEN r.stare ELSE v_stare END,
      rezultat = CASE WHEN r.stare = 'gata' THEN r.rezultat WHEN v_stare = 'gata' THEN r.apel_raspuns ELSE NULL END,
      eroare = CASE WHEN r.stare IN ('gata','esuata') AND r.drept_platit_de = 'arbitraj' THEN r.eroare ELSE v_eroare END,
      token_executie = NULL, preluata_la = NULL, terminata_la = coalesce(r.terminata_la, t)
      WHERE id = p_id;
    RETURN true;
  END IF;
  IF (r.stare = 'admisa' AND t >= r.termen_upload)
     OR (r.stare = 'ceruta' AND t >= r.termen_preluare)
     OR (r.stare = 'preluata' AND t >= r.termen_local) THEN
    UPDATE public.ocr_local_cereri SET stare = 'expirata', token_executie = NULL,
      preluata_la = NULL, terminata_la = t WHERE id = p_id;
    RETURN true;
  END IF;
  RETURN false;
END $f$;

CREATE FUNCTION public.fn_ocr_local_admite(p_user uuid, p_proiect bigint, p_depozit bigint, p_sablon text, p_bytes int)
RETURNS TABLE(id uuid, cale text, termen_upload timestamptz, status text, motiv text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE t timestamptz; c public.ocr_local_config%ROWTYPE; v_id uuid; v_attempt bigint; v_motiv text; x uuid;
BEGIN
  -- Identitate invalidă nu este un apel care a trecut poarta E3.
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = p_user) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'refuzata'::text, 'parametri_invalizi'::text; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ocr_local_cota'));
  t := clock_timestamp();
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE ocr_local_config.id;
  INSERT INTO public.ocr_local_incercari("user", la, rezultat) VALUES (p_user, t, 'inceputa') RETURNING ocr_local_incercari.id INTO v_attempt;
  -- Include încercarea curentă. Refuzurile rămân comise dacă apelantul comite RPC-ul.
  IF (SELECT count(*) FROM public.ocr_local_incercari WHERE "user" = p_user AND la > t - interval '1 hour') > 60 THEN v_motiv := 'limita_incercari';
  ELSIF p_proiect IS NULL OR p_proiect <= 0 OR p_depozit IS NULL OR p_depozit <= 0
     OR p_sablon IS NULL OR p_sablon NOT IN ('aviz_teava','lista_curbe')
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 8388608
     OR NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = p_proiect)
     OR NOT EXISTS (SELECT 1 FROM public.logistica_depozite WHERE id = p_depozit) THEN v_motiv := 'parametri_invalizi';
  ELSE
    FOR x IN SELECT q.id FROM public.ocr_local_cereri q WHERE q.creat_de = p_user AND q.stare IN ('admisa','ceruta','preluata','fallback') ORDER BY q.id LOOP
      PERFORM public.fn_ocr_local_expira_una(x);
    END LOOP;
    v_motiv := public.fn_ocr_local_disponibilitate(t);
    IF v_motiv IS NOT NULL THEN NULL;
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_de = p_user AND stare IN ('admisa','ceruta','preluata','fallback')) >= 2 THEN v_motiv := 'limita_active';
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_de = p_user AND creat_la > t - interval '1 hour') >= 30 THEN v_motiv := 'limita_ora';
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_la >= (date_trunc('day', t AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')) >= 400 THEN v_motiv := 'limita_zi';
    END IF;
  END IF;
  UPDATE public.ocr_local_incercari SET rezultat = coalesce(v_motiv, 'admisa') WHERE ocr_local_incercari.id = v_attempt;
  IF v_motiv IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'refuzata'::text, v_motiv; RETURN;
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.ocr_local_cereri(id, proiect_id, depozit_id, sablon, creat_de, creat_la, pdf_cale, pdf_bytes, stare, termen_upload, sterge_dupa)
    VALUES (v_id, p_proiect, p_depozit, p_sablon, p_user, t, 'ocr-local-cereri/' || v_id || '.pdf', p_bytes, 'admisa', t + make_interval(secs => c.upload_s), t + c.retentie);
  RETURN QUERY SELECT q.id, q.pdf_cale, q.termen_upload, 'admisa'::text, NULL::text FROM public.ocr_local_cereri q WHERE q.id = v_id;
END $f$;

CREATE FUNCTION public.fn_ocr_local_confirma_upload(p_id uuid, p_user uuid, p_sha text, p_bytes int)
RETURNS TABLE(termen_preluare timestamptz, termen_local timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE; c public.ocr_local_config%ROWTYPE; t timestamptz;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id = p_id AND creat_de = p_user FOR UPDATE;
  IF NOT FOUND OR r.stare <> 'admisa' THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  t := clock_timestamp();
  IF t >= r.termen_upload THEN RAISE EXCEPTION 'termen_depasit' USING ERRCODE='P0001'; END IF;
  IF p_sha IS NULL OR p_sha !~ '^[0-9a-f]{64}$' OR p_bytes IS DISTINCT FROM r.pdf_bytes THEN RAISE EXCEPTION 'parametri_invalizi' USING ERRCODE='P0001'; END IF;
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE id;
  RETURN QUERY UPDATE public.ocr_local_cereri q SET stare='ceruta', pdf_sha256=p_sha, pagini=1,
    termen_preluare=t+make_interval(secs=>c.preluare_s), termen_local=t+make_interval(secs=>c.local_s), sterge_dupa=t+c.retentie
    WHERE q.id=p_id RETURNING q.termen_preluare, q.termen_local;
END $f$;

CREATE FUNCTION public.fn_ocr_local_preia(p_worker text)
RETURNS TABLE(id uuid, token uuid, sablon text, cale text, sha text, termen_local timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE;
BEGIN
  IF p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'parametri_invalizi' USING ERRCODE='P0001'; END IF;
  SELECT * INTO r FROM public.ocr_local_cereri q WHERE q.stare='ceruta' AND clock_timestamp()<q.termen_preluare
    ORDER BY q.creat_la, q.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF clock_timestamp() >= r.termen_preluare THEN RETURN; END IF;
  RETURN QUERY UPDATE public.ocr_local_cereri q SET stare='preluata', token_executie=gen_random_uuid(),
    worker_id=p_worker, preluata_la=clock_timestamp(), ramura='locala' WHERE q.id=r.id
    RETURNING q.id, q.token_executie, q.sablon, q.pdf_cale, q.pdf_sha256, q.termen_local;
END $f$;

-- Contract B1/B2 autorizat în chat; migrarea nu este încă aplicată.
-- Lookup fără efecte: nu consumă dreptul plătit și nu expiră/modifică rândul.
-- Creatorul poate citi și după termen_local (pentru stare/fallback).
-- Workerul poate citi numai cu tokenul curent, strict înainte de termen_local.
CREATE FUNCTION public.fn_ocr_local_context(p_id uuid, p_user uuid, p_token uuid)
RETURNS TABLE(id uuid, creat_de uuid, proiect_id bigint, depozit_id bigint, sablon text,
  drept_platit_de text, apel_faza text, apel_raspuns jsonb, rezervare_id bigint, cost_usd numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT q.id,q.creat_de,q.proiect_id,q.depozit_id,q.sablon,
    q.drept_platit_de,q.apel_faza,q.apel_raspuns,q.rezervare_id,q.cost_usd
  FROM public.ocr_local_cereri q
  WHERE q.id=p_id AND q.sters_la IS NULL AND q.pdf_cale IS NOT NULL
    AND clock_timestamp()<q.sterge_dupa
    AND ((p_user IS NOT NULL AND p_token IS NULL AND q.creat_de=p_user)
      OR (p_user IS NULL AND p_token IS NOT NULL AND q.token_executie=p_token
        AND q.stare='preluata' AND clock_timestamp()<q.termen_local));
$f$;

CREATE FUNCTION public.fn_ocr_local_verifica_token(p_id uuid, p_token uuid)
RETURNS TABLE(cale text, sablon text, termen_local timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.stare <> 'preluata' OR p_token IS DISTINCT FROM r.token_executie OR p_token IS NULL THEN RAISE EXCEPTION 'token_invalid' USING ERRCODE='P0001'; END IF;
  IF clock_timestamp() >= r.termen_local THEN RAISE EXCEPTION 'termen_depasit' USING ERRCODE='P0001'; END IF;
  RETURN QUERY SELECT r.pdf_cale, r.sablon, r.termen_local;
END $f$;

CREATE FUNCTION public.fn_ocr_local_drept_platit(p_id uuid, p_ramura text, p_token uuid, p_user uuid)
RETURNS TABLE(acordat boolean, stare text, drept_platit_de text, apel_faza text, proiect bigint, "user" uuid, sablon text, cale text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE; c public.ocr_local_config%ROWTYPE; t timestamptz; v_acordat boolean := false;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR (p_ramura='fallback' AND p_user IS DISTINCT FROM r.creat_de) THEN RAISE EXCEPTION 'nu_e_creatorul' USING ERRCODE='P0001'; END IF;
  IF p_ramura IS NULL OR p_ramura NOT IN ('arbitraj','fallback') THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  -- Tokenul nu este ocolit de ramura idempotentă.
  IF p_ramura='arbitraj' AND (p_token IS NULL OR p_token IS DISTINCT FROM r.token_executie OR r.stare <> 'preluata') THEN RAISE EXCEPTION 'token_invalid' USING ERRCODE='P0001'; END IF;
  PERFORM public.fn_ocr_local_expira_una(p_id);
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id;
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE id;
  t := clock_timestamp();
  IF r.sters_la IS NOT NULL THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  IF r.drept_platit_de IS NULL THEN
    IF p_ramura='arbitraj' AND (r.stare<>'preluata' OR t >= r.termen_local-make_interval(secs=>c.arbitraj_marja_s)) THEN RAISE EXCEPTION 'termen_depasit' USING ERRCODE='P0001'; END IF;
    IF p_ramura='fallback' AND (r.stare NOT IN ('esuata','expirata') OR r.termen_local IS NULL) THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
    UPDATE public.ocr_local_cereri q SET drept_platit_de=p_ramura, drept_platit_la=t, apel_faza='acordat',
      stare=CASE WHEN p_ramura='fallback' THEN 'fallback' ELSE q.stare END,
      ramura=CASE WHEN p_ramura='fallback' THEN 'haiku' ELSE q.ramura END,
      termen_fallback=CASE WHEN p_ramura='fallback' THEN t+make_interval(secs=>c.apel_s) END,
      eroare=CASE WHEN p_ramura='fallback' THEN NULL ELSE q.eroare END,
      terminata_la=CASE WHEN p_ramura='fallback' THEN NULL ELSE q.terminata_la END
      WHERE q.id=p_id RETURNING * INTO r;
    v_acordat := true;
  END IF;
  RETURN QUERY SELECT v_acordat, r.stare, r.drept_platit_de, r.apel_faza, r.proiect_id, r.creat_de, r.sablon, r.pdf_cale;
END $f$;

-- Rezervare + asociere într-o SINGURĂ tranzacție RPC. Suma maximă și cheia
-- provin din config/rând; repetarea NU autorizează un nou apel plătit.
CREATE FUNCTION public.fn_ocr_local_rezerva_apel(p_id uuid)
RETURNS TABLE(acordat boolean, rezervare_id bigint, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE; c public.ocr_local_config%ROWTYPE; v_id bigint;
BEGIN
  PERFORM public.fn_ocr_local_expira_una(p_id);
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  IF r.apel_faza IS DISTINCT FROM 'acordat' OR r.stare NOT IN ('preluata','fallback') OR r.sters_la IS NOT NULL THEN
    RETURN QUERY SELECT false, r.rezervare_id, coalesce(r.apel_faza,'stare_invalida'); RETURN;
  END IF;
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE id;
  BEGIN
    v_id := public.fn_ai_plafon_rezerva('izo_e3_ocr:'||r.proiect_id, c.rezerva_usd, c.plafon_usd, r.creat_de);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'plafon_depasit' THEN RAISE; END IF;
    UPDATE public.ocr_local_cereri SET apel_faza='esuat_inainte', cost_usd=0 WHERE id=p_id;
    RETURN QUERY SELECT false, NULL::bigint, 'plafon_depasit'::text; RETURN;
  END;
  UPDATE public.ocr_local_cereri SET rezervare_id=v_id, apel_faza='rezervat' WHERE id=p_id;
  RETURN QUERY SELECT true, v_id, 'rezervat'::text;
END $f$;

CREATE FUNCTION public.fn_ocr_local_apel_faza(p_id uuid, p_faza text, p_rezervare bigint, p_raspuns jsonb, p_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE; v_cost numeric;
BEGIN
  PERFORM public.fn_ocr_local_expira_una(p_id);
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.sters_la IS NOT NULL THEN RAISE EXCEPTION 'faza_invalida' USING ERRCODE='P0001'; END IF;
  -- Parametrul vechi rămâne în semnătură, dar nu poate lega o rezervare externă.
  IF p_rezervare IS NOT NULL AND p_rezervare IS DISTINCT FROM r.rezervare_id THEN RAISE EXCEPTION 'deja_legata' USING ERRCODE='P0001'; END IF;
  IF p_faza IS NULL OR p_faza NOT IN ('trimis','raspuns','decontat','esuat_inainte','esuat_dupa') THEN RAISE EXCEPTION 'faza_invalida' USING ERRCODE='P0001'; END IF;
  -- Niciun ACK idempotent pentru trimis: numai prima tranzacție primește dreptul
  -- de a trimite HTTP; repetarea trebuie să consulte stare, nu să repete fetch.
  IF ((r.apel_faza='rezervat' AND p_faza='trimis' AND r.stare IN ('preluata','fallback'))
    OR (r.apel_faza='trimis' AND p_faza IN ('raspuns','esuat_dupa'))
    OR (r.apel_faza='raspuns' AND p_faza='decontat')
    OR (r.apel_faza IN ('acordat','rezervat') AND p_faza='esuat_inainte')) IS NOT TRUE THEN
    RAISE EXCEPTION 'faza_invalida' USING ERRCODE='P0001';
  END IF;
  IF p_faza='raspuns' AND (p_raspuns IS NULL OR jsonb_typeof(p_raspuns)<>'object' OR pg_column_size(p_raspuns)>524288) THEN RAISE EXCEPTION 'raspuns_invalid' USING ERRCODE='P0001'; END IF;
  IF p_faza='decontat' AND (p_cost IS NULL OR NOT (p_cost >= 0 AND p_cost < 'Infinity'::numeric)) THEN RAISE EXCEPTION 'cost_invalid' USING ERRCODE='P0001'; END IF;
  -- Decontarea și avansul fazei sunt și ele atomice; B2 nu decontează separat.
  IF p_faza IN ('decontat','esuat_inainte','esuat_dupa') AND r.rezervare_id IS NOT NULL THEN
    PERFORM public.fn_ai_plafon_deconteaza(r.rezervare_id,
      CASE p_faza WHEN 'decontat' THEN p_cost WHEN 'esuat_inainte' THEN 0 ELSE NULL END);
    SELECT coalesce(cost_real,suma_rezervata) INTO v_cost FROM public.ai_plafon_rezervari WHERE id=r.rezervare_id;
  END IF;
  UPDATE public.ocr_local_cereri SET apel_faza=p_faza,
    apel_raspuns=CASE WHEN p_faza='raspuns' THEN p_raspuns ELSE apel_raspuns END,
    cost_usd=CASE p_faza WHEN 'decontat' THEN v_cost WHEN 'esuat_inainte' THEN 0
      WHEN 'esuat_dupa' THEN v_cost
      ELSE cost_usd END WHERE id=p_id;
END $f$;

CREATE FUNCTION public.fn_ocr_local_rezultat(p_id uuid, p_token uuid, p_rezultat jsonb, p_eroare text, p_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.stare<>'preluata' THEN RAISE EXCEPTION 'ramura_inchisa' USING ERRCODE='P0001'; END IF;
  IF p_token IS NULL OR p_token IS DISTINCT FROM r.token_executie THEN RAISE EXCEPTION 'token_invalid' USING ERRCODE='P0001'; END IF;
  IF clock_timestamp()>=r.termen_local THEN RAISE EXCEPTION 'termen_depasit' USING ERRCODE='P0001'; END IF;
  IF (p_rezultat IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'rezultat_invalid' USING ERRCODE='P0001'; END IF;
  UPDATE public.ocr_local_cereri SET stare=CASE WHEN p_eroare IS NULL THEN 'gata' ELSE 'esuata' END,
    rezultat=p_rezultat, eroare=p_eroare, cost_usd=coalesce(r.cost_usd,p_cost,0), token_executie=NULL,
    preluata_la=NULL, terminata_la=clock_timestamp() WHERE id=p_id;
END $f$;

CREATE FUNCTION public.fn_ocr_local_inchide_fallback(p_id uuid, p_rezultat jsonb, p_eroare text, p_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.stare<>'fallback' OR clock_timestamp()>=r.termen_fallback
    OR r.apel_faza NOT IN ('decontat','esuat_inainte','esuat_dupa') THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  IF (p_rezultat IS NULL) = (p_eroare IS NULL) OR (p_rezultat IS NOT NULL AND
    (r.apel_faza<>'decontat' OR p_rezultat IS DISTINCT FROM r.apel_raspuns OR r.apel_raspuns @> '{"invalid":true}'::jsonb)) THEN
    RAISE EXCEPTION 'rezultat_invalid' USING ERRCODE='P0001';
  END IF;
  UPDATE public.ocr_local_cereri SET stare=CASE WHEN p_eroare IS NULL THEN 'gata' ELSE 'esuata' END,
    rezultat=p_rezultat, eroare=p_eroare, terminata_la=clock_timestamp() WHERE id=p_id;
END $f$;

CREATE FUNCTION public.fn_ocr_local_stare(p_id uuid, p_user uuid)
RETURNS TABLE(stare text, ramura text, rezultat jsonb, eroare text, termen_local timestamptz,
  termen_fallback timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM 1 FROM public.ocr_local_cereri WHERE id=p_id AND creat_de=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nu_exista' USING ERRCODE='P0001'; END IF;
  PERFORM public.fn_ocr_local_expira_una(p_id);
  RETURN QUERY SELECT q.stare, q.ramura, CASE WHEN q.stare = 'gata' THEN q.rezultat END,
    q.eroare, q.termen_local, q.termen_fallback FROM public.ocr_local_cereri q WHERE q.id=p_id;
END $f$;

CREATE FUNCTION public.fn_ocr_local_expira() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE x uuid; n int := 0;
BEGIN
  FOR x IN SELECT id FROM public.ocr_local_cereri WHERE sters_la IS NULL
    AND (stare IN ('admisa','ceruta','preluata','fallback') OR apel_faza IN ('acordat','rezervat','trimis','raspuns')
      OR (apel_faza='decontat' AND stare='expirata'))
    ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    IF public.fn_ocr_local_expira_una(x) THEN n := n+1; END IF;
  END LOOP;
  DELETE FROM public.ocr_local_incercari WHERE la < clock_timestamp()-interval '30 days';
  RETURN n;
END $f$;

CREATE FUNCTION public.fn_ocr_local_heartbeat(p_worker text, p_stare text, p_ora_server timestamptz, p_modele jsonb, p_versiune text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF p_stare IS NULL OR p_stare NOT IN ('disponibil','ocupat','pornire','eroare','noapte','oprit') THEN RAISE EXCEPTION 'stare_invalida' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ocr_local_worker(worker_id,stare,ora_server,ultimul_semn,modele,versiune)
    VALUES(p_worker,p_stare,p_ora_server,clock_timestamp(),p_modele,p_versiune)
    ON CONFLICT(worker_id) DO UPDATE SET stare=excluded.stare, ora_server=excluded.ora_server,
      ultimul_semn=excluded.ultimul_semn, modele=excluded.modele, versiune=excluded.versiune;
END $f$;

CREATE FUNCTION public.fn_ocr_local_curatenie_lista(p_limita int)
RETURNS TABLE(id uuid, cale text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  RETURN QUERY SELECT q.id,q.pdf_cale FROM public.ocr_local_cereri q
    WHERE q.sters_la IS NULL AND (q.sterge_dupa<=clock_timestamp()
      OR (q.stare='expirata' AND q.termen_local IS NULL AND q.termen_upload<=clock_timestamp()))
    ORDER BY q.sterge_dupa,q.id LIMIT greatest(0,least(coalesce(p_limita,50),50));
END $f$;

CREATE FUNCTION public.fn_ocr_local_curatenie_confirma(p_id uuid, p_ok boolean, p_eroare text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.ocr_local_cereri%ROWTYPE;
BEGIN
  PERFORM public.fn_ocr_local_expira_una(p_id);
  SELECT * INTO r FROM public.ocr_local_cereri WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.sters_la IS NOT NULL THEN RETURN; END IF;
  IF r.sterge_dupa>clock_timestamp() AND NOT (r.stare='expirata' AND r.termen_local IS NULL AND r.termen_upload<=clock_timestamp()) THEN RAISE EXCEPTION 'termen_neatins' USING ERRCODE='P0001'; END IF;
  IF p_ok IS TRUE THEN
    UPDATE public.ocr_local_cereri SET pdf_cale=NULL, pdf_sha256=NULL, rezultat=NULL, apel_raspuns=NULL,
      stergere_eroare=NULL, sters_la=clock_timestamp() WHERE id=p_id;
  ELSE
    UPDATE public.ocr_local_cereri SET stergere_incercari=stergere_incercari+1,
      stergere_eroare=CASE WHEN p_eroare ~ '^[a-z_]{1,40}$' THEN p_eroare ELSE 'storage_esuat' END WHERE id=p_id;
  END IF;
END $f$;

CREATE VIEW public.v_ocr_local_probleme WITH (security_invoker = on) AS
  SELECT id,stergere_incercari,stergere_eroare FROM public.ocr_local_cereri
  WHERE sters_la IS NULL AND stergere_incercari>10;
REVOKE ALL ON public.v_ocr_local_probleme FROM PUBLIC, anon, authenticated, service_role;
-- Fără drepturi directe nici pentru service_role. Rutina zilnică folosește RPC.
CREATE FUNCTION public.fn_ocr_local_probleme() RETURNS TABLE(id uuid, stergere_incercari int, stergere_eroare text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT * FROM public.v_ocr_local_probleme;
$f$;

-- Listă explicită: nu se modifică ACL-ul niciunei funcții existente.
-- RPC-uri JWT-side: numai B2 cu service_role, dupa verificarea identitatii/accesului
-- cu JWT-ul real. Niciun EXECUTE pentru authenticated/anon/PUBLIC.
DO $acl$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'fn_ocr_local_expira_una(uuid)',
    'fn_ocr_local_disponibilitate(timestamp with time zone)',
    'fn_ocr_local_admite(uuid,bigint,bigint,text,integer)',
    'fn_ocr_local_confirma_upload(uuid,uuid,text,integer)',
    'fn_ocr_local_preia(text)', 'fn_ocr_local_verifica_token(uuid,uuid)',
    'fn_ocr_local_context(uuid,uuid,uuid)',
    'fn_ocr_local_drept_platit(uuid,text,uuid,uuid)', 'fn_ocr_local_rezerva_apel(uuid)',
    'fn_ocr_local_apel_faza(uuid,text,bigint,jsonb,numeric)',
    'fn_ocr_local_rezultat(uuid,uuid,jsonb,text,numeric)',
    'fn_ocr_local_inchide_fallback(uuid,jsonb,text,numeric)',
    'fn_ocr_local_stare(uuid,uuid)', 'fn_ocr_local_expira()',
    'fn_ocr_local_heartbeat(text,text,timestamp with time zone,jsonb,text)',
    'fn_ocr_local_curatenie_lista(integer)', 'fn_ocr_local_curatenie_confirma(uuid,boolean,text)',
    'fn_ocr_local_probleme()'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||s||' FROM PUBLIC, anon, authenticated, service_role';
    IF s NOT IN ('fn_ocr_local_expira_una(uuid)','fn_ocr_local_disponibilitate(timestamp with time zone)') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||s||' TO service_role';
    END IF;
  END LOOP;
END $acl$;
-- Storage/cron HTTP nu se configurează în B1: ar modifica obiecte existente
-- și necesită edge-ul B2/URL/Vault. Nicio dependență de secret sau rețea aici.
