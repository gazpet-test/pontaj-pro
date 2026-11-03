-- Version 20261130120000. Runner supplies one transaction.
-- 20261130a_sms_mvp — SMS MVP (decizii Razvan 03.11.2026; docs/sms/RAPORT_SMS_2026-11-03.md, RAPORT_SMSLINK_API_2026-11-03.md).
-- Ce face: coada + jurnalul SMS, independente de furnizor (SMSLink / simulator stau in edge, _shared/smsFurnizor.ts):
--   sms_setari (un rand: kill-switch, plafoane zi/luna, comutatorul Redari + referinta autorizarii scrise Transgaz),
--   sms_loturi (un lot = un text + o lista de destinatari = O aprobare a owner-ului), sms_mesaje (un rand per telefon),
--   sms_optout (telefoane care nu mai primesc nimic), sms_dlr (jurnal minim al rapoartelor de livrare, fara payload brut).
-- Reguli in BD (nu doar in UI):
--   * aplicatia NU scrie direct in nicio tabela sms_* (fara INSERT/UPDATE/DELETE pentru anon / authenticated / service_role);
--     scrierea trece doar prin RPC-urile SECURITY DEFINER de mai jos, iar triggerele verifica din nou fiecare trecere de stare;
--   * citirea (RLS) si toate RPC-urile UI: DOAR owner-ul (profiles.is_owner); aprobarea unui lot: DOAR owner-ul, pe versiunea vazuta;
--   * nimic nu pleaca fara lot aprobat; kill-switch-ul (pornit la instalare) si plafoanele (200/zi, 1500/luna) se verifica ATOMIC
--     la rezervare (fn_sms_rezerva tine randul de setari FOR UPDATE: rezervarile se serializeaza); erorile de configurare / credit
--     de la furnizor opresc automat trimiterea (kill-switch);
--   * categoria `redari` e construita complet, dar BLOCATA cat timp sms_setari.redari_autorizat = false (il seteaza doar owner-ul, cu
--     nr. + data autorizarii scrise Transgaz): crearea, aprobarea si rezervarea unui lot redari sunt refuzate in BD; extern doar 08-20;
--   * textul: GSM-7 fara diacritice (transliterare ș→s, ț→t, ă/â→a, î→i), maximum 160 (concatenarea oprita) — aceeasi tabela ca
--     _shared/smsText.mjs (UI + edge);
--   * DLR-ul doar muta starea inainte (trimis → livrat | esuat), deduplicat; nu poate porni nicio trimitere;
--   * timeout dupa trimitere = `necunoscut`, fara retrimitere; codul de eroare e doar un cod scurt ([a-z0-9_]), niciodata textul
--     furnizorului (eroarea 7 SMSLink contine parola).
-- Fara date reale atinse (doar randul de setari). Revenire: supabase/revenire/20261130a_sms_mvp_ROLLBACK.sql (NU sterge: muta tabelele
-- cu date in schema sms_retras_<data>). DRY: supabase/tests/20261130a_sms_mvp_dryrun.sql. Izolare: READ COMMITTED (ca PostgREST).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130a_sms_mvp:' || txid_current() THEN
    RAISE EXCEPTION '20261130a: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261130a: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'sms!_%' ESCAPE '!') THEN
    RAISE EXCEPTION '20261130a: exista deja relatii sms_* in public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') THEN
    RAISE EXCEPTION '20261130a: exista deja functii fn_sms_*';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261130a: lipsesc rolurile Supabase sau auth.uid()';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261130a: anon/authenticated pot crea obiecte in public (functiile SECURITY DEFINER ar fi expuse la umbrire)';
  END IF;
  -- sursele de destinatari: employees.telefon (NU profiles.phone_whatsapp, pe care il editeaza utilizatorul) si red_detinatori_contact.telefon
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('id', 'is_owner')) <> 2
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'
           AND column_name IN ('id', 'name', 'department', 'active', 'telefon')) <> 5
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'id') IS DISTINCT FROM 'integer'
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori_contact' AND column_name IN ('detinator_id', 'telefon')) <> 2
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name IN ('detinator_id', 'stare', 'sters_la')) <> 3
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori' AND column_name IN ('id', 'parcela_id', 'sters_la', 'decedat')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name IN ('id', 'proiect_id', 'uat_id', 'sters_la')) <> 4
     OR to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_uat') IS NULL THEN
    RAISE EXCEPTION '20261130a: lipsesc coloanele sursa (profiles / employees / red_*)';
  END IF;
END $pre$;

-- ─── 1. Tabele ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.sms_setari (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  kill_switch boolean NOT NULL DEFAULT true,
  kill_motiv text CHECK (kill_motiv IS NULL OR length(kill_motiv) <= 200),
  plafon_zi integer NOT NULL DEFAULT 200 CHECK (plafon_zi BETWEEN 0 AND 5000),
  plafon_luna integer NOT NULL DEFAULT 1500 CHECK (plafon_luna BETWEEN 0 AND 50000),
  redari_autorizat boolean NOT NULL DEFAULT false,
  redari_autorizare_nr text CHECK (redari_autorizare_nr IS NULL OR length(btrim(redari_autorizare_nr)) BETWEEN 1 AND 100),
  redari_autorizare_data date,
  actualizat_de uuid,
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  versiune integer NOT NULL DEFAULT 1,
  CONSTRAINT sms_setari_plafoane CHECK (plafon_zi <= plafon_luna),
  CONSTRAINT sms_setari_redari_ref CHECK (NOT redari_autorizat OR (redari_autorizare_nr IS NOT NULL AND redari_autorizare_data IS NOT NULL))
);
COMMENT ON TABLE public.sms_setari IS 'SMS: un singur rand. kill_switch = true inseamna trimiterea OPRITA (asa porneste). Plafoane in SMS-uri (segmente) pe zi / luna (Europe/Bucharest). redari_autorizat = SMS extern catre proprietari permis (doar owner, cu nr. + data autorizarii scrise Transgaz). Scris doar prin RPC.';

CREATE TABLE public.sms_loturi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie text NOT NULL CHECK (categorie IN ('intern', 'redari')),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 160),
  stare text NOT NULL DEFAULT 'draft' CHECK (stare IN ('draft', 'aprobat', 'in_trimitere', 'trimis', 'anulat')),
  proiect_id uuid REFERENCES public.red_proiecte(id),
  uat_id uuid REFERENCES public.red_uat(id),
  filtru jsonb NOT NULL DEFAULT '{}'::jsonb,
  nr_destinatari integer NOT NULL CHECK (nr_destinatari BETWEEN 1 AND 5000),
  segmente integer NOT NULL DEFAULT 1 CHECK (segmente = 1),
  cost_estimat_eur numeric(10,3) NOT NULL CHECK (cost_estimat_eur >= 0),
  excluse_optout integer NOT NULL DEFAULT 0 CHECK (excluse_optout >= 0),
  excluse_fara_mobil integer NOT NULL DEFAULT 0 CHECK (excluse_fara_mobil >= 0),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  aprobat_de uuid,
  aprobat_la timestamptz,
  aprobat_autorizare_nr text,
  aprobat_autorizare_data date,
  anulat_de uuid,
  anulat_la timestamptz,
  motiv_anulare text CHECK (motiv_anulare IS NULL OR length(motiv_anulare) <= 500),
  trimis_la timestamptz,
  versiune integer NOT NULL DEFAULT 1,
  CONSTRAINT sms_loturi_proiect CHECK ((categorie = 'redari') = (proiect_id IS NOT NULL) AND (uat_id IS NULL OR categorie = 'redari')),
  CONSTRAINT sms_loturi_aprobare CHECK (stare NOT IN ('aprobat', 'in_trimitere', 'trimis') OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)),
  CONSTRAINT sms_loturi_aprobare_redari CHECK (categorie <> 'redari' OR aprobat_la IS NULL OR (aprobat_autorizare_nr IS NOT NULL AND aprobat_autorizare_data IS NOT NULL))
);
CREATE INDEX idx_sms_loturi_stare ON public.sms_loturi (stare, aprobat_la);
COMMENT ON TABLE public.sms_loturi IS 'SMS: un lot = un text (GSM-7, max 160) + destinatarii lui = O aprobare a owner-ului. Continutul e imuabil dupa creare (se anuleaza si se creeaza altul). draft -> aprobat (doar owner) -> in_trimitere -> trimis; anulat din orice stare deschisa (doar owner).';

CREATE TABLE public.sms_mesaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.sms_loturi(id),
  telefon text NOT NULL CHECK (telefon ~ '^[+]407[0-9]{8}$'),
  destinatar_tip text NOT NULL CHECK (destinatar_tip IN ('angajat', 'detinator')),
  destinatar_id text NOT NULL CHECK (length(destinatar_id) BETWEEN 1 AND 64),
  stare text NOT NULL DEFAULT 'in_coada' CHECK (stare IN ('in_coada', 'trimis', 'livrat', 'esuat', 'necunoscut', 'anulat')),
  segmente integer NOT NULL DEFAULT 1 CHECK (segmente BETWEEN 1 AND 4),
  furnizor text CHECK (furnizor IS NULL OR furnizor IN ('smslink', 'simulator')),
  furnizor_id text CHECK (furnizor_id IS NULL OR furnizor_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  cod_eroare text CHECK (cod_eroare IS NULL OR cod_eroare ~ '^[a-z0-9_]{1,40}$'),
  rezervat_la timestamptz,
  trimis_la timestamptz,
  livrat_la timestamptz,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  versiune integer NOT NULL DEFAULT 1,
  CONSTRAINT sms_mesaje_lot_telefon UNIQUE (lot_id, telefon)
);
CREATE UNIQUE INDEX ux_sms_mesaje_furnizor_id ON public.sms_mesaje (furnizor, furnizor_id) WHERE furnizor_id IS NOT NULL;
CREATE INDEX idx_sms_mesaje_lot_stare ON public.sms_mesaje (lot_id, stare);
CREATE INDEX idx_sms_mesaje_rezervat ON public.sms_mesaje (rezervat_la) WHERE rezervat_la IS NOT NULL;
COMMENT ON TABLE public.sms_mesaje IS 'SMS: un rand per telefon (E.164 +407xxxxxxxx) in lot. in_coada -> necunoscut (rezervat: cererea poate fi plecat) -> trimis (id de la furnizor) -> livrat | esuat (DLR). necunoscut fara raspuns = NU se retrimite. cod_eroare = doar cod scurt, niciodata textul furnizorului.';

CREATE TABLE public.sms_optout (
  telefon text PRIMARY KEY CHECK (telefon ~ '^[+]407[0-9]{8}$'),
  activ boolean NOT NULL DEFAULT true,
  motiv text CHECK (motiv IS NULL OR length(motiv) <= 200),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_de uuid,
  actualizat_la timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sms_optout IS 'SMS: telefoane care nu mai primesc niciun SMS (verificat la crearea lotului si din nou la rezervare). Nu se sterg: se dezactiveaza. Doar owner-ul.';

CREATE TABLE public.sms_dlr (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  furnizor text NOT NULL CHECK (furnizor IN ('smslink', 'simulator')),
  furnizor_id text NOT NULL CHECK (furnizor_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  status text NOT NULL CHECK (status IN ('livrat', 'esuat')),
  rezultat text NOT NULL CHECK (rezultat IN ('necunoscut', 'aplicat', 'ignorat', 'aplicat_tarziu')),
  raportat_la timestamptz,
  primit_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_dlr_unic UNIQUE (furnizor, furnizor_id, status)
);
COMMENT ON TABLE public.sms_dlr IS 'SMS: jurnal minim al rapoartelor de livrare (id furnizor, status, rezultat) — fara payload brut, fara telefon. Un DLR repetat (acelasi id + status) nu adauga rand.';

-- ─── 2. Reguli de text si telefon (pure; aceeasi tabela ca _shared/smsText.mjs) ───────────────────────────────────────────
CREATE FUNCTION public.fn_sms_tel_normalizat(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE
           WHEN x.t ~ '^[+]407[0-9]{8}$' THEN x.t
           WHEN x.t ~ '^00407[0-9]{8}$' THEN '+' || substr(x.t, 3)
           WHEN x.t ~ '^407[0-9]{8}$' THEN '+' || x.t
           WHEN x.t ~ '^07[0-9]{8}$' THEN '+4' || x.t
           WHEN x.t ~ '^7[0-9]{8}$' THEN '+40' || x.t
         END
    FROM (SELECT translate(coalesce(p, ''), ' -./:;()' || chr(9) || chr(160), '') AS t) x
$fn$;
COMMENT ON FUNCTION public.fn_sms_tel_normalizat(text) IS 'SMS: mobil RO -> +407xxxxxxxx (accepta 07…, 7…, 407…, +407…, 00407…, cu spatii / - . / : ; ( )); altceva -> NULL.';

CREATE FUNCTION public.fn_sms_text_final(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT btrim(regexp_replace(replace(translate(coalesce(p, ''),
             'șşȘŞțţȚŢăĂâÂîÎ„”“«»"’‘‚`´–—' || chr(13) || chr(10) || chr(9) || chr(160),
             'ssSSttTTaAaAiI' || repeat(chr(39), 11) || '--    '),
           '…', '...'), ' {2,}', ' ', 'g'), ' ')
$fn$;
COMMENT ON FUNCTION public.fn_sms_text_final(text) IS 'SMS: textul trimis — fara diacritice (ș/ş->s, ț/ţ->t, ă/â->a, î->i), ghilimele -> apostrof, liniute -> -, rand nou / tab -> spatiu, spatii comprimate.';

CREATE FUNCTION public.fn_sms_text_verifica(p text, OUT text_final text, OUT lungime integer, OUT segmente integer, OUT nepermise text)
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_baza text := '@£' || chr(36) || '¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !#¤%&' || chr(39) || '()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  v_ext text := '^{}[~]|' || chr(92) || chr(8364);
BEGIN
  text_final := public.fn_sms_text_final(p);
  lungime := 2 * length(text_final) - length(translate(text_final, v_ext, ''));
  segmente := CASE WHEN lungime = 0 THEN 0 WHEN lungime <= 160 THEN 1 ELSE ceil(lungime / 152.0)::integer END;
  SELECT coalesce(string_agg(x.c, '' ORDER BY x.c), '') INTO nepermise
    FROM (SELECT DISTINCT t.c FROM regexp_split_to_table(translate(text_final, v_baza || v_ext, ''), '') AS t(c) WHERE t.c <> '') x;
END $fn$;
COMMENT ON FUNCTION public.fn_sms_text_verifica(text) IS 'SMS: text final + lungime GSM-7 (caracterele extinse ^ { } [ ~ ] | backslash si euro = 2) + segmente (<=160 = 1, altfel la 152) + caracterele care nu exista in GSM-7.';

CREATE FUNCTION public.fn_sms_text_valid(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.fn_sms_text_verifica(p);
  IF v.text_final = '' THEN RAISE EXCEPTION 'sms: textul e gol' USING ERRCODE = '22023'; END IF;
  IF v.nepermise <> '' THEN RAISE EXCEPTION 'sms: caractere care nu exista in GSM-7 (scoate-le): %', v.nepermise USING ERRCODE = '22023'; END IF;
  IF v.lungime > 160 THEN
    RAISE EXCEPTION 'sms: textul are % caractere GSM-7; maximum 160 intr-un SMS (concatenarea e oprita in MVP)', v.lungime USING ERRCODE = '22023';
  END IF;
  RETURN v.text_final;
END $fn$;

-- ─── 3. Identitate, consum ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$fn$;
COMMENT ON FUNCTION public.fn_sms_e_owner() IS 'SMS: utilizatorul curent e owner (profiles.is_owner). Fara parametru (nu poate sonda alte conturi). Folosita de RLS si de RPC-uri.';

CREATE FUNCTION public.fn_sms_cere_owner() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_sms_e_owner() THEN
    RAISE EXCEPTION 'sms: doar owner-ul (Razvan) foloseste modulul SMS' USING ERRCODE = '42501';
  END IF;
END $fn$;

CREATE FUNCTION public.fn_sms_consum(OUT zi integer, OUT luna integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(sum(m.segmente) FILTER (WHERE m.rezervat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')), 0)::integer,
         coalesce(sum(m.segmente), 0)::integer
    FROM public.sms_mesaje m
   WHERE m.rezervat_la >= (date_trunc('month', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
$fn$;
COMMENT ON FUNCTION public.fn_sms_consum() IS 'SMS: segmentele rezervate azi / luna aceasta (ora Romaniei). Orice mesaj rezervat se numara (si cel esuat sau necunoscut).';

-- ─── 4. Triggere de reguli (aparare in adancime: si pentru postgres / service_role) ──────────────────────────────────────────
CREATE FUNCTION public.fn_sms_setari_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: setarile nu se sterg' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.id := true; NEW.kill_switch := true; NEW.kill_motiv := 'instalare: trimiterea o porneste owner-ul';
    NEW.redari_autorizat := false; NEW.redari_autorizare_nr := NULL; NEW.redari_autorizare_data := NULL;
    NEW.actualizat_de := auth.uid(); NEW.actualizat_la := now(); NEW.versiune := 1;
    RETURN NEW;
  END IF;
  -- fara owner se poate DOAR opri trimiterea (oprirea automata la eroare de configurare / credit); restul cere owner-ul
  IF NOT public.fn_sms_e_owner() AND (
       (NEW.plafon_zi, NEW.plafon_luna, NEW.redari_autorizat, NEW.redari_autorizare_nr, NEW.redari_autorizare_data)
         IS DISTINCT FROM (OLD.plafon_zi, OLD.plafon_luna, OLD.redari_autorizat, OLD.redari_autorizare_nr, OLD.redari_autorizare_data)
       OR (OLD.kill_switch AND NOT NEW.kill_switch)) THEN
    RAISE EXCEPTION 'sms: doar owner-ul schimba setarile SMS (fara owner se poate doar opri trimiterea)' USING ERRCODE = '42501';
  END IF;
  NEW.id := OLD.id; NEW.actualizat_de := auth.uid(); NEW.actualizat_la := now(); NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_sms_loturi_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; v record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: loturile nu se sterg (anularea e o stare)' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.sms_setari WHERE id;
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
    NEW.creat_de := auth.uid(); NEW.creat_la := now(); NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_autorizare_nr := NULL; NEW.aprobat_autorizare_data := NULL; NEW.anulat_de := NULL; NEW.anulat_la := NULL;
    NEW.motiv_anulare := NULL; NEW.trimis_la := NULL; NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.categorie, NEW.text, NEW.proiect_id, NEW.uat_id, NEW.filtru, NEW.nr_destinatari, NEW.segmente, NEW.cost_estimat_eur,
      NEW.excluse_optout, NEW.excluse_fara_mobil, NEW.creat_de, NEW.creat_la)
     IS DISTINCT FROM (OLD.id, OLD.categorie, OLD.text, OLD.proiect_id, OLD.uat_id, OLD.filtru, OLD.nr_destinatari, OLD.segmente, OLD.cost_estimat_eur,
      OLD.excluse_optout, OLD.excluse_fara_mobil, OLD.creat_de, OLD.creat_la) THEN
    RAISE EXCEPTION 'sms: continutul unui lot nu se schimba (anuleaza-l si creeaza altul)' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.stare = 'draft' AND NEW.stare IN ('aprobat', 'anulat'))
       OR (OLD.stare = 'aprobat' AND NEW.stare IN ('in_trimitere', 'anulat'))
       OR (OLD.stare = 'in_trimitere' AND NEW.stare IN ('trimis', 'anulat'))) THEN
    RAISE EXCEPTION 'sms: trecere de stare nepermisa pentru lot: % -> %', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;
  NEW.aprobat_autorizare_nr := OLD.aprobat_autorizare_nr; NEW.aprobat_autorizare_data := OLD.aprobat_autorizare_data;
  NEW.anulat_de := OLD.anulat_de; NEW.anulat_la := OLD.anulat_la; NEW.trimis_la := OLD.trimis_la;
  IF NEW.stare <> 'anulat' THEN NEW.motiv_anulare := OLD.motiv_anulare; END IF;
  IF NEW.stare = 'aprobat' THEN
    IF NOT public.fn_sms_e_owner() THEN RAISE EXCEPTION 'sms: doar owner-ul aproba un lot' USING ERRCODE = '42501'; END IF;
    IF NEW.categorie = 'redari' THEN
      IF NOT coalesce(s.redari_autorizat, false) THEN
        RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
      END IF;
      NEW.aprobat_autorizare_nr := s.redari_autorizare_nr; NEW.aprobat_autorizare_data := s.redari_autorizare_data;
    END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now();
  ELSIF NEW.stare = 'anulat' THEN
    IF NOT public.fn_sms_e_owner() THEN RAISE EXCEPTION 'sms: doar owner-ul anuleaza un lot' USING ERRCODE = '42501'; END IF;
    NEW.anulat_de := auth.uid(); NEW.anulat_la := now();
  ELSIF NEW.stare = 'in_trimitere' THEN
    IF coalesce(s.kill_switch, true) THEN RAISE EXCEPTION 'sms: trimiterea e oprita (kill-switch)' USING ERRCODE = '42501'; END IF;
    IF NEW.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = NEW.id AND m.stare = 'in_coada') THEN
      RAISE EXCEPTION 'sms: lotul mai are mesaje in coada' USING ERRCODE = '23514';
    END IF;
    NEW.trimis_la := now();
  END IF;
  NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_sms_mesaje_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: mesajele nu se sterg (sunt jurnalul trimiterii)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sms_loturi x WHERE x.id = NEW.lot_id AND x.stare = 'draft') THEN
      RAISE EXCEPTION 'sms: mesajele se adauga doar la crearea lotului (draft)' USING ERRCODE = '23514';
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
    IF NEW.furnizor IS NULL OR NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: rezervarea cere furnizorul, fara id' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = NEW.telefon AND o.activ) THEN
      RAISE EXCEPTION 'sms: numarul are opt-out' USING ERRCODE = '23514';
    END IF;
    NEW.rezervat_la := now();
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

CREATE FUNCTION public.fn_sms_optout_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: opt-out-ul nu se sterge (se dezactiveaza)' USING ERRCODE = '42501'; END IF;
  IF NOT public.fn_sms_e_owner() THEN RAISE EXCEPTION 'sms: doar owner-ul gestioneaza opt-out-ul' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.creat_de := auth.uid(); NEW.creat_la := now();
  ELSIF (NEW.telefon, NEW.creat_de, NEW.creat_la) IS DISTINCT FROM (OLD.telefon, OLD.creat_de, OLD.creat_la) THEN
    RAISE EXCEPTION 'sms: telefonul unui opt-out nu se schimba' USING ERRCODE = '23514';
  END IF;
  NEW.actualizat_de := auth.uid(); NEW.actualizat_la := now();
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_sms_dlr_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: jurnalul DLR nu se sterge' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.primit_la := now(); RETURN NEW; END IF;
  IF (NEW.id, NEW.furnizor, NEW.furnizor_id, NEW.status, NEW.raportat_la, NEW.primit_la)
     IS DISTINCT FROM (OLD.id, OLD.furnizor, OLD.furnizor_id, OLD.status, OLD.raportat_la, OLD.primit_la) OR OLD.rezultat <> 'necunoscut' THEN
    RAISE EXCEPTION 'sms: jurnalul DLR e doar de adaugat (rezultatul se completeaza o singura data)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_sms_setari_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_setari FOR EACH ROW EXECUTE FUNCTION public.fn_sms_setari_reguli();
CREATE TRIGGER trg_sms_loturi_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_sms_loturi_reguli();
CREATE TRIGGER trg_sms_mesaje_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_mesaje FOR EACH ROW EXECUTE FUNCTION public.fn_sms_mesaje_reguli();
CREATE TRIGGER trg_sms_optout_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_optout FOR EACH ROW EXECUTE FUNCTION public.fn_sms_optout_reguli();
CREATE TRIGGER trg_sms_dlr_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.sms_dlr FOR EACH ROW EXECUTE FUNCTION public.fn_sms_dlr_reguli();

-- ─── 5. RLS: citire doar owner; nicio politica de scriere (scrierea doar prin RPC) ─────────────────────────────────────────
ALTER TABLE public.sms_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_loturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_mesaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_optout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_dlr ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_setari_sel ON public.sms_setari FOR SELECT TO authenticated USING ((SELECT public.fn_sms_e_owner()));
CREATE POLICY sms_loturi_sel ON public.sms_loturi FOR SELECT TO authenticated USING ((SELECT public.fn_sms_e_owner()));
CREATE POLICY sms_mesaje_sel ON public.sms_mesaje FOR SELECT TO authenticated USING ((SELECT public.fn_sms_e_owner()));
CREATE POLICY sms_optout_sel ON public.sms_optout FOR SELECT TO authenticated USING ((SELECT public.fn_sms_e_owner()));
CREATE POLICY sms_dlr_sel ON public.sms_dlr FOR SELECT TO authenticated USING ((SELECT public.fn_sms_e_owner()));

CREATE VIEW public.sms_v_loturi WITH (security_invoker = on) AS
SELECT l.id, l.categorie, l.text, l.stare, l.proiect_id, l.uat_id, l.filtru, l.nr_destinatari, l.segmente, l.cost_estimat_eur,
       l.excluse_optout, l.excluse_fara_mobil, l.creat_de, l.creat_la, l.aprobat_de, l.aprobat_la, l.aprobat_autorizare_nr,
       l.aprobat_autorizare_data, l.anulat_la, l.motiv_anulare, l.trimis_la, l.versiune,
       count(m.id) FILTER (WHERE m.stare = 'in_coada')::integer AS n_in_coada,
       count(m.id) FILTER (WHERE m.stare = 'necunoscut')::integer AS n_necunoscut,
       count(m.id) FILTER (WHERE m.stare = 'trimis')::integer AS n_trimis,
       count(m.id) FILTER (WHERE m.stare = 'livrat')::integer AS n_livrat,
       count(m.id) FILTER (WHERE m.stare = 'esuat')::integer AS n_esuat,
       count(m.id) FILTER (WHERE m.stare = 'anulat')::integer AS n_anulat
  FROM public.sms_loturi l LEFT JOIN public.sms_mesaje m ON m.lot_id = l.id
 GROUP BY l.id;
COMMENT ON VIEW public.sms_v_loturi IS 'SMS: loturile cu numaratoarea mesajelor pe stari (security_invoker: aceeasi RLS ca tabelele = doar owner).';

-- ─── 6. RPC-uri pentru UI (EXECUTE: authenticated; owner verificat in fiecare) ──────────────────────────────────────────────
CREATE FUNCTION public.fn_sms_panou() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; c record;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO s FROM public.sms_setari WHERE id;
  SELECT * INTO c FROM public.fn_sms_consum();
  RETURN jsonb_build_object('kill_switch', s.kill_switch, 'kill_motiv', s.kill_motiv, 'plafon_zi', s.plafon_zi, 'plafon_luna', s.plafon_luna,
    'consum_zi', c.zi, 'consum_luna', c.luna, 'redari_autorizat', s.redari_autorizat, 'redari_autorizare_nr', s.redari_autorizare_nr,
    'redari_autorizare_data', s.redari_autorizare_data, 'versiune', s.versiune, 'actualizat_la', s.actualizat_la,
    'tarif_eur', 0.049, 'max_caractere', 160);
END $fn$;

CREATE FUNCTION public.fn_sms_angajati_lista() RETURNS TABLE (id integer, nume text, departament text, telefon_mascat text, optout boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_sms_cere_owner();
  RETURN QUERY
  SELECT e.id, e.name, e.department,
         CASE WHEN t.tel IS NULL THEN NULL::text ELSE '07** *** ' || right(t.tel, 3) END,
         (t.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = t.tel AND o.activ))
    FROM public.employees e CROSS JOIN LATERAL (SELECT public.fn_sms_tel_normalizat(e.telefon) AS tel) t
   WHERE e.active IS TRUE
   ORDER BY e.name, e.id;
END $fn$;

CREATE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL,
                                                 p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- un singur instantaneu: candidatii (angajati activi din filtre), excluderile si lista finala (un SMS per telefon)
  WITH c AS (
    SELECT e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (coalesce(cardinality(p_angajati), 0) = 0 OR e.id = ANY (p_angajati))
       AND (coalesce(cardinality(p_departamente), 0) = 0 OR e.department = ANY (p_departamente))
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms: niciun angajat activ in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms: niciun destinatar cu mobil RO valid (dupa filtre si opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0)),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'angajat', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'intern', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost, 'plafon_zi', v_plafon,
    'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0), 'preview', coalesce(p_doar_preview, true));
END $fn$;

CREATE FUNCTION public.fn_sms_lot_redari_creeaza(p_text text, p_proiect_id uuid, p_uat_id uuid DEFAULT NULL, p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  -- Decizia lui Razvan (03.11.2026): construit complet, dar BLOCAT pana la autorizarea scrisa Transgaz (sub-imputernicit art. 28 GDPR)
  IF NOT coalesce((SELECT s.redari_autorizat FROM public.sms_setari s WHERE s.id), false) THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit; il seteaza doar owner-ul, cu nr. si data)'
      USING ERRCODE = '42501';
  END IF;
  IF p_proiect_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: proiect inexistent' USING ERRCODE = '22023';
  END IF;
  IF p_uat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = p_uat_id AND u.proiect_id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: UAT-ul nu e al proiectului' USING ERRCODE = '22023';
  END IF;
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- destinatarii = detinatorii (activi, nedecedati) cu convocare activa pe parcelele proiectului / UAT-ului; telefonul din contact
  WITH c AS (
    SELECT DISTINCT d.id, public.fn_sms_tel_normalizat(k.telefon) AS tel
      FROM public.red_convocari cv
      JOIN public.red_detinatori d ON d.id = cv.detinator_id AND d.sters_la IS NULL AND d.decedat IS NOT TRUE
      JOIN public.red_parcele pa ON pa.id = d.parcela_id AND pa.sters_la IS NULL AND pa.proiect_id = p_proiect_id
                                AND (p_uat_id IS NULL OR pa.uat_id = p_uat_id)
      LEFT JOIN public.red_detinatori_contact k ON k.detinator_id = d.id
     WHERE cv.stare = 'activ' AND cv.sters_la IS NULL
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu convocare activa in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu mobil RO valid (dupa opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('redari', v_text, p_proiect_id, p_uat_id, jsonb_build_object('uat_id', p_uat_id), v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'detinator', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'redari', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost, 'plafon_zi', v_plafon,
    'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0), 'preview', coalesce(p_doar_preview, true));
END $fn$;

CREATE FUNCTION public.fn_sms_lot_aproba(p_lot_id uuid, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari; v_n integer;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO s FROM public.sms_setari WHERE id FOR SHARE;   -- ordinea lock-urilor: setari -> lot (ca la rezervare)
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002'; END IF;
  IF l.stare <> 'draft' THEN RAISE EXCEPTION 'sms: doar un lot in draft se aproba (starea: %)', l.stare USING ERRCODE = '23514'; END IF;
  IF p_versiune IS DISTINCT FROM l.versiune THEN
    RAISE EXCEPTION 'sms: lotul s-a schimbat de la previzualizare; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada';
  IF v_n <> l.nr_destinatari THEN
    RAISE EXCEPTION 'sms: lotul nu mai e intreg (% mesaje din %); anuleaza-l si creeaza altul', v_n, l.nr_destinatari USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = l.id RETURNING * INTO l;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'aprobat_la', l.aprobat_la, 'versiune', l.versiune,
    'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur, 'aprobat_autorizare_nr', l.aprobat_autorizare_nr);
END $fn$;

CREATE FUNCTION public.fn_sms_lot_anuleaza(p_lot_id uuid, p_motiv text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_n integer;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002'; END IF;
  IF l.stare NOT IN ('draft', 'aprobat', 'in_trimitere') THEN
    RAISE EXCEPTION 'sms: lotul e deja inchis (%)', l.stare USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_mesaje SET stare = 'anulat', cod_eroare = 'lot_anulat' WHERE lot_id = l.id AND stare = 'in_coada';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sms_loturi SET stare = 'anulat', motiv_anulare = left(nullif(btrim(p_motiv), ''), 500) WHERE id = l.id RETURNING * INTO l;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'mesaje_anulate', v_n);
END $fn$;

CREATE FUNCTION public.fn_sms_setari_salveaza(p_kill_switch boolean, p_plafon_zi integer, p_plafon_luna integer, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  IF p_kill_switch IS NULL OR p_plafon_zi IS NULL OR p_plafon_luna IS NULL OR p_plafon_zi < 0 OR p_plafon_zi > 5000
     OR p_plafon_luna < 0 OR p_plafon_luna > 50000 OR p_plafon_zi > p_plafon_luna THEN
    RAISE EXCEPTION 'sms: setari invalide (plafon 0-5000 pe zi, 0-50000 pe luna, zi <= luna)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sms_setari
     SET kill_switch = p_kill_switch,
         kill_motiv = CASE WHEN NOT p_kill_switch THEN NULL WHEN kill_switch THEN kill_motiv ELSE 'oprit de owner' END,
         plafon_zi = p_plafon_zi, plafon_luna = p_plafon_luna
   WHERE id AND versiune = p_versiune
  RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: setarile s-au schimbat intre timp (de ex. oprire automata); reincarca' USING ERRCODE = '40001'; END IF;
  RETURN jsonb_build_object('kill_switch', s.kill_switch, 'kill_motiv', s.kill_motiv, 'plafon_zi', s.plafon_zi, 'plafon_luna', s.plafon_luna, 'versiune', s.versiune);
END $fn$;

CREATE FUNCTION public.fn_sms_redari_autorizare_seteaza(p_autorizat boolean, p_nr text, p_data date, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  IF p_autorizat IS NULL THEN RAISE EXCEPTION 'sms redari: alege da / nu' USING ERRCODE = '22023'; END IF;
  IF p_autorizat AND (length(btrim(coalesce(p_nr, ''))) NOT BETWEEN 1 AND 100 OR p_data IS NULL) THEN
    RAISE EXCEPTION 'sms redari: autorizarea scrisa Transgaz cere numarul si data documentului' USING ERRCODE = '22023';
  END IF;
  IF p_autorizat AND p_data > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN
    RAISE EXCEPTION 'sms redari: data autorizarii e in viitor' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sms_setari
     SET redari_autorizat = p_autorizat,
         redari_autorizare_nr = CASE WHEN p_autorizat THEN btrim(p_nr) ELSE redari_autorizare_nr END,
         redari_autorizare_data = CASE WHEN p_autorizat THEN p_data ELSE redari_autorizare_data END
   WHERE id AND versiune = p_versiune
  RETURNING * INTO s;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: setarile s-au schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  RETURN jsonb_build_object('redari_autorizat', s.redari_autorizat, 'redari_autorizare_nr', s.redari_autorizare_nr,
    'redari_autorizare_data', s.redari_autorizare_data, 'versiune', s.versiune);
END $fn$;

CREATE FUNCTION public.fn_sms_optout_seteaza(p_telefon text, p_activ boolean, p_motiv text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_tel text; o public.sms_optout;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  v_tel := public.fn_sms_tel_normalizat(p_telefon);
  IF v_tel IS NULL THEN RAISE EXCEPTION 'sms: numar de mobil RO invalid' USING ERRCODE = '22023'; END IF;
  IF p_activ IS NULL THEN RAISE EXCEPTION 'sms: alege activ / inactiv' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sms_optout AS x (telefon, activ, motiv) VALUES (v_tel, p_activ, left(nullif(btrim(p_motiv), ''), 200))
  ON CONFLICT (telefon) DO UPDATE SET activ = EXCLUDED.activ, motiv = coalesce(EXCLUDED.motiv, x.motiv)
  RETURNING * INTO o;
  RETURN jsonb_build_object('telefon_mascat', '07** *** ' || right(o.telefon, 3), 'activ', o.activ);
END $fn$;

-- ─── 7. RPC-uri pentru edge (EXECUTE: doar service_role; poarta de rol e in edge, inaintea lor) ────────────────────────────
CREATE FUNCTION public.fn_sms_rezerva(p_lot_id uuid, p_max integer, p_furnizor text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; l public.sms_loturi; c record; v_ora integer; v_rest integer; v_n integer; v_arr jsonb; v_ram integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'sms: rezervarea cere izolarea READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF p_max IS NULL OR p_max < 1 OR p_max > 50 THEN RAISE EXCEPTION 'sms: p_max in afara 1..50' USING ERRCODE = '22023'; END IF;
  IF p_furnizor IS NULL OR p_furnizor NOT IN ('smslink', 'simulator') THEN RAISE EXCEPTION 'sms: furnizor necunoscut' USING ERRCODE = '22023'; END IF;
  -- randul de setari FOR UPDATE serializeaza toate rezervarile: kill-switch-ul si plafonul se verifica atomic
  SELECT * INTO s FROM public.sms_setari WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF s.kill_switch THEN RETURN jsonb_build_object('motiv', 'kill_switch', 'mesaje', '[]'::jsonb); END IF;
  v_ora := extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::integer;
  IF p_lot_id IS NULL THEN   -- cron intern: cel mai vechi lot aprobat care poate pleca acum
    SELECT * INTO l FROM public.sms_loturi x
     WHERE x.stare IN ('aprobat', 'in_trimitere') AND (x.categorie = 'intern' OR (s.redari_autorizat AND v_ora BETWEEN 8 AND 19))
     ORDER BY x.aprobat_la, x.id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO l FROM public.sms_loturi x WHERE x.id = p_lot_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('motiv', 'fara_lot', 'mesaje', '[]'::jsonb); END IF;
  IF l.stare NOT IN ('aprobat', 'in_trimitere') THEN RETURN jsonb_build_object('motiv', 'lot_' || l.stare, 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN RETURN jsonb_build_object('motiv', 'redari_neautorizat', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND v_ora NOT BETWEEN 8 AND 19 THEN RETURN jsonb_build_object('motiv', 'in_afara_orelor', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  SELECT * INTO c FROM public.fn_sms_consum();
  IF c.luna >= s.plafon_luna THEN RETURN jsonb_build_object('motiv', 'plafon_luna', 'lot_id', l.id, 'consum_luna', c.luna, 'mesaje', '[]'::jsonb); END IF;
  IF c.zi >= s.plafon_zi THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
  v_rest := least(s.plafon_zi - c.zi, s.plafon_luna - c.luna) / l.segmente;
  v_n := least(p_max, v_rest);
  IF v_n < 1 THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
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
  IF v_ram = 0 THEN UPDATE public.sms_loturi SET stare = 'trimis' WHERE id = l.id AND stare = 'in_trimitere'; END IF;
  RETURN jsonb_build_object('motiv', CASE WHEN jsonb_array_length(v_arr) > 0 THEN 'ok' ELSE 'gata' END, 'lot_id', l.id, 'categorie', l.categorie,
    'text', l.text, 'mesaje', v_arr, 'ramase', v_ram);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_rezerva(uuid, integer, text) IS 'SMS (doar service_role, din edge sms-trimite dupa poarta owner / cron intern): rezerva ATOMIC pana la p_max mesaje ale unui lot aprobat, sub kill-switch si plafoane; mesajele rezervate trec in necunoscut (fara rezultat = nu se retrimit).';

CREATE FUNCTION public.fn_sms_rezultat(p_mesaj_id uuid, p_ok boolean, p_furnizor_id text, p_cod_eroare text, p_clasa text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE m public.sms_mesaje; d public.sms_dlr;
BEGIN
  IF p_ok IS NULL THEN RAISE EXCEPTION 'sms: rezultat fara ok' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.sms_mesaje WHERE id = p_mesaj_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: mesaj necunoscut' USING ERRCODE = 'P0002'; END IF;
  IF m.stare <> 'necunoscut' OR m.furnizor_id IS NOT NULL THEN RETURN 'ignorat'; END IF;
  IF p_ok THEN
    IF p_furnizor_id IS NULL OR p_furnizor_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN RAISE EXCEPTION 'sms: id de furnizor invalid' USING ERRCODE = '22023'; END IF;
    UPDATE public.sms_mesaje SET stare = 'trimis', furnizor_id = p_furnizor_id, cod_eroare = NULL WHERE id = m.id;
    -- DLR sosit inaintea raspunsului de trimitere (jurnal 'necunoscut' cu acelasi id): se aplica acum
    SELECT * INTO d FROM public.sms_dlr x WHERE x.furnizor = m.furnizor AND x.furnizor_id = p_furnizor_id AND x.rezultat = 'necunoscut'
     ORDER BY x.id DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.sms_mesaje SET stare = d.status, cod_eroare = CASE WHEN d.status = 'esuat' THEN 'dlr_nelivrat' END WHERE id = m.id;
      UPDATE public.sms_dlr SET rezultat = 'aplicat_tarziu' WHERE id = d.id;
      RETURN 'trimis_' || d.status;
    END IF;
    RETURN 'trimis';
  END IF;
  IF p_clasa IS NULL OR p_clasa NOT IN ('permanent', 'config', 'credit', 'tranzitoriu', 'necunoscut') THEN
    RAISE EXCEPTION 'sms: clasa de eroare necunoscuta' USING ERRCODE = '22023';
  END IF;
  IF p_cod_eroare IS NULL OR p_cod_eroare !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'sms: codul de eroare e doar un cod scurt (fara textul furnizorului)' USING ERRCODE = '22023';
  END IF;
  IF p_clasa = 'necunoscut' THEN
    UPDATE public.sms_mesaje SET stare = 'necunoscut', cod_eroare = p_cod_eroare WHERE id = m.id;
    RETURN 'necunoscut';
  END IF;
  UPDATE public.sms_mesaje SET stare = 'esuat', cod_eroare = p_cod_eroare WHERE id = m.id;
  IF p_clasa IN ('config', 'credit') THEN   -- cont / parola / IP / credit: opreste toata trimiterea pana o reporneste owner-ul
    UPDATE public.sms_setari SET kill_switch = true, kill_motiv = 'oprire automata: ' || p_cod_eroare WHERE id AND NOT kill_switch;
  END IF;
  RETURN 'esuat';
END $fn$;
COMMENT ON FUNCTION public.fn_sms_rezultat(uuid, boolean, text, text, text) IS 'SMS (doar service_role): rezultatul trimiterii unui mesaj rezervat. Erorile de configurare / credit opresc automat trimiterea (kill-switch).';

CREATE FUNCTION public.fn_sms_dlr_aplica(p_furnizor text, p_furnizor_id text, p_livrat boolean, p_raportat_la timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint; v_status text; m public.sms_mesaje;
BEGIN
  IF p_furnizor IS NULL OR p_furnizor NOT IN ('smslink', 'simulator') OR p_livrat IS NULL
     OR p_furnizor_id IS NULL OR p_furnizor_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
    RAISE EXCEPTION 'sms: raport de livrare invalid' USING ERRCODE = '22023';
  END IF;
  v_status := CASE WHEN p_livrat THEN 'livrat' ELSE 'esuat' END;
  INSERT INTO public.sms_dlr (furnizor, furnizor_id, status, rezultat, raportat_la)
  VALUES (p_furnizor, p_furnizor_id, v_status, 'necunoscut',
          CASE WHEN p_raportat_la BETWEEN now() - interval '30 days' AND now() + interval '1 day' THEN p_raportat_la END)
  ON CONFLICT (furnizor, furnizor_id, status) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN 'duplicat'; END IF;
  SELECT * INTO m FROM public.sms_mesaje x WHERE x.furnizor = p_furnizor AND x.furnizor_id = p_furnizor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'necunoscut'; END IF;
  IF m.stare <> 'trimis' THEN UPDATE public.sms_dlr SET rezultat = 'ignorat' WHERE id = v_id; RETURN 'ignorat'; END IF;
  UPDATE public.sms_mesaje SET stare = v_status, cod_eroare = CASE WHEN p_livrat THEN NULL ELSE 'dlr_nelivrat' END WHERE id = m.id;
  UPDATE public.sms_dlr SET rezultat = 'aplicat' WHERE id = v_id;
  RETURN 'aplicat';
END $fn$;
COMMENT ON FUNCTION public.fn_sms_dlr_aplica(text, text, boolean, timestamptz) IS 'SMS (doar service_role, din edge sms-dlr dupa secretul din URL): jurnal + mutare monotona trimis -> livrat | esuat; repetat = duplicat; nu porneste nicio trimitere.';

-- ─── 8. Drepturi (privilegiile implicite Supabase dau ALL pe tabele / EXECUTE pe functii: se scot explicit) ─────────────────
REVOKE ALL ON public.sms_setari, public.sms_loturi, public.sms_mesaje, public.sms_optout, public.sms_dlr, public.sms_v_loturi
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.sms_dlr_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sms_setari, public.sms_loturi, public.sms_mesaje, public.sms_optout, public.sms_dlr, public.sms_v_loturi TO authenticated;
REVOKE ALL ON FUNCTION
  public.fn_sms_tel_normalizat(text), public.fn_sms_text_final(text), public.fn_sms_text_verifica(text), public.fn_sms_text_valid(text),
  public.fn_sms_e_owner(), public.fn_sms_cere_owner(), public.fn_sms_consum(),
  public.fn_sms_setari_reguli(), public.fn_sms_loturi_reguli(), public.fn_sms_mesaje_reguli(), public.fn_sms_optout_reguli(), public.fn_sms_dlr_reguli(),
  public.fn_sms_panou(), public.fn_sms_angajati_lista(), public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean),
  public.fn_sms_lot_redari_creeaza(text, uuid, uuid, boolean), public.fn_sms_lot_aproba(uuid, integer), public.fn_sms_lot_anuleaza(uuid, text),
  public.fn_sms_setari_salveaza(boolean, integer, integer, integer), public.fn_sms_redari_autorizare_seteaza(boolean, text, date, integer),
  public.fn_sms_optout_seteaza(text, boolean, text),
  public.fn_sms_rezerva(uuid, integer, text), public.fn_sms_rezultat(uuid, boolean, text, text, text), public.fn_sms_dlr_aplica(text, text, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.fn_sms_e_owner(), public.fn_sms_panou(), public.fn_sms_angajati_lista(), public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean),
  public.fn_sms_lot_redari_creeaza(text, uuid, uuid, boolean), public.fn_sms_lot_aproba(uuid, integer), public.fn_sms_lot_anuleaza(uuid, text),
  public.fn_sms_setari_salveaza(boolean, integer, integer, integer), public.fn_sms_redari_autorizare_seteaza(boolean, text, date, integer),
  public.fn_sms_optout_seteaza(text, boolean, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sms_rezerva(uuid, integer, text), public.fn_sms_rezultat(uuid, boolean, text, text, text),
  public.fn_sms_dlr_aplica(text, text, boolean, timestamptz) TO service_role;

-- ─── 9. Randul de setari: trimiterea OPRITA, Redari NEAUTORIZAT (triggerul impune valorile) ─────────────────────────────────
INSERT INTO public.sms_setari (id) VALUES (true);

DO $post$
DECLARE v_t text; v_o oid; v_n integer;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_e_owner()', 'public.fn_sms_panou()', 'public.fn_sms_angajati_lista()',
    'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)',
    'public.fn_sms_lot_aproba(uuid,integer)', 'public.fn_sms_lot_anuleaza(uuid,text)', 'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)',
    'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', 'public.fn_sms_optout_seteaza(text,boolean,text)']::regprocedure[];
  v_serviciu regprocedure[] := ARRAY['public.fn_sms_rezerva(uuid,integer,text)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)',
    'public.fn_sms_dlr_aplica(text,text,boolean,timestamptz)']::regprocedure[];
  v_pure regprocedure[] := ARRAY['public.fn_sms_tel_normalizat(text)', 'public.fn_sms_text_final(text)', 'public.fn_sms_text_verifica(text)',
    'public.fn_sms_text_valid(text)']::regprocedure[];
BEGIN
  FOREACH v_t IN ARRAY ARRAY['sms_setari', 'sms_loturi', 'sms_mesaje', 'sms_optout', 'sms_dlr'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN RAISE EXCEPTION '20261130a: RLS oprit pe %', v_t; END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t) <> 1
       OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd = 'SELECT' AND roles = '{authenticated}') <> 1 THEN
      RAISE EXCEPTION '20261130a: politici gresite pe %', v_t;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || v_t)::regclass AND NOT tgisinternal) <> 1 THEN RAISE EXCEPTION '20261130a: triggere pe %', v_t; END IF;
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('authenticated', 'public.' || v_t, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('service_role', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR NOT has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') THEN
      RAISE EXCEPTION '20261130a: drepturi gresite pe %', v_t;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.sms_v_loturi', 'SELECT') OR has_table_privilege('authenticated', 'public.sms_v_loturi', 'INSERT, UPDATE, DELETE')
     OR NOT has_table_privilege('authenticated', 'public.sms_v_loturi', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.sms_v_loturi'::regclass AND reloptions::text ~ 'security_invoker=(on|true)') THEN
    RAISE EXCEPTION '20261130a: vederea sms_v_loturi are setari gresite';
  END IF;
  IF has_sequence_privilege('anon', 'public.sms_dlr_id_seq', 'USAGE, SELECT, UPDATE') OR has_sequence_privilege('authenticated', 'public.sms_dlr_id_seq', 'USAGE, SELECT, UPDATE') THEN
    RAISE EXCEPTION '20261130a: secventa sms_dlr_id_seq expusa';
  END IF;
  -- functiile: search_path fixat, SECURITY DEFINER (in afara celor pure), fara EXECUTE pentru PUBLIC / anon, EXECUTE exact pe liste
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!';
  IF v_n <> 24 THEN RAISE EXCEPTION '20261130a: % functii fn_sms_* (asteptat 24)', v_n; END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_o) IS DISTINCT FROM (NOT (v_o::regprocedure = ANY (v_pure)))
       OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_o)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_expuse))
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_serviciu)) THEN
      RAISE EXCEPTION '20261130a: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
    -- echivalentul local al portii permanente 0e (scripts/control_0e.sql) pe functiile expuse
    IF v_o::regprocedure = ANY (v_expuse) AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o
         AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]u&)') THEN
      RAISE EXCEPTION '20261130a: functia expusa % contine o constructie interzisa de poarta 0e', v_o::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.sms_setari) <> 1 OR NOT (SELECT kill_switch AND NOT redari_autorizat AND plafon_zi = 200 AND plafon_luna = 1500 FROM public.sms_setari) THEN
    RAISE EXCEPTION '20261130a: randul de setari nu e cel de instalare (oprit, Redari neautorizat, 200/1500)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sms_loturi) OR EXISTS (SELECT 1 FROM public.sms_mesaje) THEN RAISE EXCEPTION '20261130a: tabele nevide la instalare'; END IF;
END $post$;
