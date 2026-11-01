-- 20261126a_redari_teren — modulul „Redări teren” (Lot 1 Transgaz): schema red_*, drepturi prin user_module_access (module = 'redari'),
-- jurnal append-only, numerotare fără refolosire, token de răspuns generat în BD, vederile de stare, cele 2 RPC publice ale formularului
-- și bucket-ul privat `redari`. Contractul OBLIGATORIU: docs/redari/CONTRACT_SCHEMA.md (§1–§6; deciziile agentului de migrare sunt notate
-- acolo: §4 valoare_lei = privilegii pe coloană + red_v_parcele + fn_red_valoare_parcela / _seteaza; §5 câmpurile în plus ale RPC-urilor).
-- Brief: docs/redari/BRIEF_2026-11-01.md. Decizia 6 (Răzvan 01.11): răspunsul public NU trimite mail/SMS și NU generează PV — totul manual.
-- Ce creează (TOT nou; nu atinge niciun obiect existent în afară de un rând în app_modules și 3 politici pe storage.objects):
--   • app_modules: cheia `redari` (nimeni nu primește acces aici — drepturile le dă Răzvan din UI);
--   • fn_red_nivel() — admin | editor | viewer | NULL (owner = admin), fără parametru, ca fn_are_acces_ofertare();
--   • 13 tabele red_* cu RLS, GRANT SELECT/INSERT/UPDATE pentru authenticated (cu politici) și service_role, FĂRĂ DELETE pentru nimeni;
--     red_parcele.valoare_lei fără privilegiu de coloană pentru authenticated (se citește/scrie DOAR prin fn_red_valoare_parcela /
--     fn_red_valoare_parcela_seteaza, admin); red_jurnal: doar SELECT, INSERT numai prin trigger, UPDATE/DELETE/TRUNCATE refuzate de trigger
--     și pentru postgres; red_rate_limit: nimic pentru authenticated/anon (doar funcțiile publice scriu în el); red_detinatori_token
--     (tokenul de răspuns + expirarea, Jakarinos r1 pct. 5): SELECT doar admin/editor, scris doar de trigger-e — viewer-ul nu vede tokenul;
--   • trigger-ele: jurnal pe 10 tabele (toate în afară de red_jurnal, red_rate_limit — contorul anonim ar umple jurnalul — și
--     red_detinatori_token — secret), token + expirare la inserarea deținătorului, recalcul expirare la schimbarea sesiunilor UAT / a
--     UAT-ului parcelei / a parcelei deținătorului, updated_at pe contact, imutabilitate jurnal și token;
--   • fn_red_numar_document(tip, uat3, tronson) — C-0001 / PVA-HUS-0001 / PVB-HUS-0001 / PVC-T3-0001, admin/editor;
--     fn_red_rezerva_numere_parcele(uat3, tronson, n) — bloc de numere pentru id_parcela (cheie P-T{tronson}-{uat3}), pornește de la
--     max(nnnn) existent; red_parcele.cheie_sursa (identitatea din Excel-ul TGZ) UNIQUE parțial pe proiect — reimportul cade pe parcela existentă;
--   • vederile security_invoker: red_v_stare_parcela (12 stări, contract §3), red_v_centralizator_uat, red_v_tronson, red_v_parcele;
--   • RPC publice (anon + authenticated): fn_red_formular_public(token), fn_red_raspuns_public(…) — erori așteptate prin jsonb, rate limit
--     30 / IP / 10 min și 5 / token / 10 min în red_rate_limit (cheia tokenului = sha256, nu tokenul);
--   • bucket privat `redari` (pdf / docx / jpeg / png, 25 MB) cu politicile red_storage_sel / _ins / _upd (fără DELETE).
-- Revenire: supabase/revenire/20261126a_redari_teren_ROLLBACK.sql (armată; refuză cu date în red_parcele fără al doilea GUC).
-- DRY: supabase/tests/20261126a_redari_teren_dryrun.sql (în aceeași tranzacție cu migrarea; nu rulează pe o migrare comisă).
-- LIVRARE: doar prin scripts/livrare_migrare.sh, după GO Jakarinos + Copilot (regula #1877) și DRY verde pe prod.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261126a_redari_teren:' || txid_current() THEN
    RAISE EXCEPTION '20261126a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261126a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- nimic red_* nu există încă (tabele, vederi, funcții, bucket, politici storage, cheia de modul)
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'red\_%') THEN
    RAISE EXCEPTION '20261126a: exista deja relatii red_* in public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_%') THEN
    RAISE EXCEPTION '20261126a: exista deja functii fn_red_*';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari') THEN RAISE EXCEPTION '20261126a: bucket-ul redari exista deja'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'red\_storage\_%') THEN
    RAISE EXCEPTION '20261126a: politici red_storage_* existente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'redari') THEN RAISE EXCEPTION '20261126a: cheia de modul redari exista deja'; END IF;
  -- dependențele platformei
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN RAISE EXCEPTION '20261126a: lipseste extensions.gen_random_bytes (pgcrypto)'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.jwt()') IS NULL THEN RAISE EXCEPTION '20261126a: lipsesc auth.uid / auth.jwt'; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN RAISE EXCEPTION '20261126a: lipsesc rolurile anon/authenticated/service_role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access' AND column_name = 'access_level')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_modules' AND column_name = 'key') THEN
    RAISE EXCEPTION '20261126a: lipsesc profiles.is_owner / user_module_access.access_level / app_modules.key';
  END IF;
  -- nivelurile admin / editor / viewer sunt cele permise de CHECK-ul existent (contractul §1 se sprijină pe el)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_module_access'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%admin%' AND pg_get_constraintdef(oid) LIKE '%editor%' AND pg_get_constraintdef(oid) LIKE '%viewer%') THEN
    RAISE EXCEPTION '20261126a: CHECK-ul user_module_access.access_level nu are admin/editor/viewer';
  END IF;
  IF to_regclass('storage.objects') IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION '20261126a: storage.objects lipseste sau nu are RLS';
  END IF;
END $pre$;

-- ─── 1. Cheia de modul (acordabilă din UI; nimeni n-o primește aici) ──────────────────────────────────────────────────────
INSERT INTO public.app_modules (key, name, icon, color, description, is_active, display_order, show_on_homepage)
VALUES ('redari', 'Redări teren', '🌾', '#2E7D32', 'Redări teren Lot 1 Transgaz: parcele, deținători, convocări, PV-uri', true, 33, true);

-- ─── 2. Nivelul de acces al utilizatorului curent ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_red_nivel() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN 'admin'
    ELSE (SELECT uma.access_level FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'redari')
  END;
$fn$;
COMMENT ON FUNCTION public.fn_red_nivel() IS 'Redări: nivelul utilizatorului curent — admin | editor | viewer | NULL (owner = admin). Fără parametru (nu poate sonda alte conturi). SECURITY DEFINER pentru că profiles și user_module_access au RLS.';

-- ─── 3. Tabele ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.red_proiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cod text NOT NULL UNIQUE CHECK (btrim(cod) <> ''),
  denumire text, beneficiar text, contract_nr text, contract_data date, imputernicire_nr text, imputernicire_data date,
  reprezentant_tgz_nume text, reprezentant_tgz_functie text, reprezentant_gazpet_nume text, reprezentant_gazpet_functie text,
  contact_nume text, contact_telefon text, contact_email text, text_gdpr text,
  text_declaratie text NOT NULL DEFAULT 'Declar că nu particip la constatarea pe teren și că nu am obiecții privind readucerea terenului la starea inițială.',
  activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.red_proiecte IS 'Redări: proiectul (ex. LOT1-PRUNISOR-JUPA) — contract, împuternicire, reprezentanți, contact, texte GDPR / declarație.';

CREATE TABLE public.red_uat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  nume text NOT NULL,
  uat3 text NOT NULL CHECK (uat3 ~ '^[A-Z]{3}$'),
  judet text, primarie_adresa text, primarie_email text, primarie_telefon text, reprezentant_uat_nume text, reprezentant_uat_functie text,
  sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, program_zi1 text, program_zi2 text, program_zi3 text,
  afisare_pv_nr text, afisare_data_start date, afisare_data_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proiect_id, uat3)
);
COMMENT ON TABLE public.red_uat IS 'Redări: UAT-urile proiectului (primărie, reprezentant nominalizat, cele 3 zile de sesiune, afișarea).';

CREATE TABLE public.red_parcele (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  id_parcela text NOT NULL CHECK (id_parcela ~ '^T([1-9]|1[01])-[A-Z]{3}-[0-9]{4}$'),
  tronson int NOT NULL CHECK (tronson BETWEEN 1 AND 11),
  km_de_la numeric, km_pana_la numeric, sat text, tarla text, nr_cadastral text, poz_hg text,
  suprafata_temporara_mp numeric, categoria_folosinta text, articol_deviz text, cantitate numeric,
  valoare_lei numeric,
  observatii text,
  cheie_sursa text CHECK (cheie_sursa IS NULL OR (btrim(cheie_sursa) <> '' AND cheie_sursa = upper(cheie_sursa))),
  sters_la timestamptz, sters_de uuid, sters_motiv text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proiect_id, id_parcela)
);
CREATE INDEX idx_red_parcele_uat ON public.red_parcele (uat_id);
CREATE UNIQUE INDEX ux_red_parcele_cheie_sursa ON public.red_parcele (proiect_id, cheie_sursa) WHERE cheie_sursa IS NOT NULL AND sters_la IS NULL;
COMMENT ON COLUMN public.red_parcele.cheie_sursa IS 'Identitatea stabilă a rândului din Excel-ul TGZ: {uat3}|{poz_hg}|{nr_cadastral}|{tarla}, majuscule, fără diacritice / spații duble; NULL când toate trei sunt goale. UNIQUE parțial pe proiect (activ) — reimportul aceluiași fișier cade pe parcela existentă.';
COMMENT ON TABLE public.red_parcele IS 'Redări: parcelele afectate temporar (T{tronson}-{uat3}-{nnnn}); valoare_lei fără privilegiu de coloană pentru authenticated — doar prin fn_red_valoare_parcela (admin).';
COMMENT ON COLUMN public.red_parcele.valoare_lei IS 'Doar admin: citire prin fn_red_valoare_parcela(id), scriere prin fn_red_valoare_parcela_seteaza(id, valoare). Coloana NU e în GRANT-ul authenticated; UI citește red_v_parcele.';

CREATE TABLE public.red_detinatori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcela_id uuid NOT NULL REFERENCES public.red_parcele(id),
  nume text NOT NULL CHECK (btrim(nume) <> ''),
  nume_normalizat text NOT NULL CHECK (btrim(nume_normalizat) <> '' AND nume_normalizat = upper(nume_normalizat)),
  calitate text NOT NULL CHECK (calitate IN ('proprietar', 'coproprietar', 'mostenitor', 'arendas', 'utilizator', 'neidentificat')),
  cota text,
  decedat boolean NOT NULL DEFAULT false,
  sursa_date text, versiune_lista_tgz text,
  sters_la timestamptz, sters_de uuid, sters_motiv text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_red_detinatori_parcela_nume ON public.red_detinatori (parcela_id, nume_normalizat) WHERE sters_la IS NULL;
COMMENT ON TABLE public.red_detinatori IS 'Redări: persoana pe parcelă, FĂRĂ contact (PII în red_detinatori_contact) și FĂRĂ token (secret, în red_detinatori_token — viewer-ul vede persoana, nu tokenul).';

CREATE TABLE public.red_detinatori_token (
  detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id),
  token_raspuns text NOT NULL UNIQUE CHECK (length(token_raspuns) >= 32),
  token_expira_la timestamptz
);
COMMENT ON TABLE public.red_detinatori_token IS 'Redări: tokenul de răspuns al deținătorului (43 caractere base64url, generat de trigger la inserarea deținătorului, imutabil) + expirarea (= max(sesiune_zi1..3 UAT) + 30 zile, recalculată de trigger-e). SELECT doar admin/editor; nimeni nu scrie direct; RPC-urile publice îl caută ca SECURITY DEFINER. Nu intră în jurnal.';

CREATE TABLE public.red_detinatori_contact (
  detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id),
  adresa_strada text, adresa_sat text, adresa_comuna text, adresa_judet text, cod_postal text,
  adresa_cunoscuta boolean NOT NULL DEFAULT true,
  telefon text, email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.red_detinatori_contact IS 'Redări: PII (adresă, telefon, email) — SELECT doar admin/editor; viewer-ul nu vede rândurile (RLS), nici prin jurnal.';

CREATE TABLE public.red_convocari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  canal text NOT NULL CHECK (canal IN ('posta', 'sms', 'email', 'afisare', 'telefon')),
  nr_document text UNIQUE,
  data_expediere date, nr_tracking text, data_confirmare_primire date,
  retur text CHECK (retur IS NULL OR retur IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta')),
  retur_data date, continut_hash text, fisier_convocator_path text,
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  motiv_anulare text,
  sters_la timestamptz, sters_de uuid, sters_motiv text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_red_convocari_detinator ON public.red_convocari (detinator_id);
COMMENT ON TABLE public.red_convocari IS 'Redări: convocările (canal, nr_document C-nnnn, expediere, AR, retur, hash conținut, cale în bucket).';

CREATE TABLE public.red_raspunsuri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  canal text NOT NULL CHECK (canal IN ('online', 'telefon', 'scris', 'sesiune', 'email', 'sms')),
  data timestamptz NOT NULL DEFAULT now(),
  optiune text NOT NULL CHECK (optiune IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren')),
  zi_sesiune_aleasa date, obiectii_text text, declaratie_confirmata boolean,
  ip_sau_sursa text, user_agent text, semnatura_electronica_ref text, raw_payload jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_red_raspunsuri_detinator ON public.red_raspunsuri (detinator_id, data DESC);
COMMENT ON TABLE public.red_raspunsuri IS 'Redări: răspunsurile deținătorilor (online prin RPC public, created_by NULL; telefon/scris/sesiune de operator). Ultimul contează în stare.';

CREATE TABLE public.red_procese_verbale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcela_id uuid REFERENCES public.red_parcele(id),
  detinator_id uuid REFERENCES public.red_detinatori(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  tronson int CHECK (tronson IS NULL OR tronson BETWEEN 1 AND 11),
  tip text NOT NULL CHECK (tip IN ('A', 'B', 'C')),
  nr_pv text NOT NULL UNIQUE CHECK (nr_pv ~ '^PV[ABC]-'),
  data_pv date, locul text, stare_teren_text text,
  obiectii_redare boolean NOT NULL DEFAULT false, obiectii_text text, termen_remediere date, remediat_la date,
  stare text NOT NULL DEFAULT 'generat' CHECK (stare IN ('generat', 'trimis_spre_semnare', 'semnat', 'anulat')),
  motiv_anulare text, trimis_spre_semnare_data date, semnat_primit_data date,
  semnat_fizic boolean NOT NULL DEFAULT false,
  fisier_generat_path text, fisier_semnat_path text, semnatari jsonb,
  sters_la timestamptz, sters_de uuid, sters_motiv text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_pv_tip_coerent CHECK (
    (tip = 'A' AND parcela_id IS NOT NULL AND detinator_id IS NOT NULL) OR
    (tip = 'B' AND parcela_id IS NOT NULL AND detinator_id IS NULL) OR
    (tip = 'C' AND parcela_id IS NULL AND detinator_id IS NULL AND tronson IS NOT NULL))
);
CREATE INDEX idx_red_pv_parcela ON public.red_procese_verbale (parcela_id);
CREATE INDEX idx_red_pv_detinator ON public.red_procese_verbale (detinator_id);
CREATE INDEX idx_red_pv_uat ON public.red_procese_verbale (uat_id);
COMMENT ON TABLE public.red_procese_verbale IS 'Redări: PV tip A (deținător), B (parcelă fără deținător), C (recepție tronson). Numere PVA-{uat3}-nnnn / PVB-{uat3}-nnnn / PVC-T{n}-nnnn, nerefolosite; anulare = stare anulat + motiv.';

CREATE TABLE public.red_jurnal (
  id bigserial PRIMARY KEY,
  tabela text NOT NULL,
  inregistrare_id uuid,
  actiune text NOT NULL CHECK (actiune IN ('insert', 'update', 'delete')),
  date_vechi jsonb, date_noi jsonb,
  user_id uuid, user_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_red_jurnal_inregistrare ON public.red_jurnal (tabela, inregistrare_id);
COMMENT ON TABLE public.red_jurnal IS 'Redări: jurnal append-only (trigger pe toate red_* în afară de red_jurnal și red_rate_limit). Fără INSERT direct; UPDATE/DELETE/TRUNCATE refuzate de trigger pentru oricine. valoare_lei și token_raspuns nu intră în jurnal; rândurile red_detinatori_contact le văd doar admin/editor.';

CREATE TABLE public.red_numere (
  cheie text PRIMARY KEY,
  ultimul int NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.red_numere IS 'Redări: ultimul număr alocat pe cheie (C, PVA-HUS, PVB-HUS, PVC-T3). Scris doar de fn_red_numar_document.';

CREATE TABLE public.red_import_loturi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  versiune_lista_tgz text NOT NULL,
  sursa text, fisier_nume text,
  randuri_total int, parcele_noi int, detinatori_noi int, dubluri int, neidentificati int, diferente jsonb,
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'finalizat', 'esuat')),
  eroare text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.red_import_loturi IS 'Redări: loturile de import (TGZ / ANEXA7) cu raportul lor. UI-ul creează lotul la început (in_curs) și îl închide la final (finalizat / esuat + eroare) — reluarea unui lot eșuat e vizibilă.';

CREATE TABLE public.red_rate_limit (
  cheie text PRIMARY KEY,
  fereastra_start timestamptz NOT NULL DEFAULT now(),
  numar int NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.red_rate_limit IS 'Redări: contor pe fereastră de 10 min pentru RPC-urile publice (ip:<ip> max 30, t:<sha256 token> max 5). Fără acces pentru authenticated/anon.';

-- ─── 4. Funcții interne (trigger-e, calcule) — SECURITY DEFINER, search_path fix, fără EXECUTE pentru roluri ─────────────
CREATE FUNCTION public.fn_red_token_expira_calc(p_uat_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT ((greatest(u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3) + 30) + time '23:59:59') AT TIME ZONE 'Europe/Bucharest'
  FROM public.red_uat u WHERE u.id = p_uat_id;
$fn$;
COMMENT ON FUNCTION public.fn_red_token_expira_calc(uuid) IS 'Redări: expirarea tokenului = ultima zi de sesiune a UAT-ului + 30 zile, ora 23:59:59 București; NULL când UAT-ul nu are încă zile.';

CREATE FUNCTION public.fn_red_detinatori_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_red_detinatori_token_dupa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  -- tokenul se generează DOAR aici (clientul nu are nicio cale de scriere): 32 octeți aleatori → base64url, 43 caractere;
  -- la schimbarea parcelei se recalculează doar expirarea (tokenul rămâne)
  INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la)
  VALUES (NEW.id, rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='),
          public.fn_red_token_expira_calc((SELECT p.uat_id FROM public.red_parcele p WHERE p.id = NEW.parcela_id)))
  ON CONFLICT (detinator_id) DO UPDATE SET token_expira_la = excluded.token_expira_la;
  RETURN NULL;
END $fn$;

CREATE FUNCTION public.fn_red_token_imutabil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.token_raspuns := OLD.token_raspuns;
  NEW.detinator_id := OLD.detinator_id;
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_red_uat_sesiuni_dupa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public.red_detinatori_token t SET token_expira_la = public.fn_red_token_expira_calc(NEW.id)
  FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id
  WHERE t.detinator_id = d.id AND p.uat_id = NEW.id;
  RETURN NULL;
END $fn$;

CREATE FUNCTION public.fn_red_parcela_uat_dupa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  UPDATE public.red_detinatori_token t SET token_expira_la = public.fn_red_token_expira_calc(NEW.uat_id)
  FROM public.red_detinatori d WHERE t.detinator_id = d.id AND d.parcela_id = NEW.id;
  RETURN NULL;
END $fn$;

CREATE FUNCTION public.fn_red_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

CREATE FUNCTION public.fn_red_jurnal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_vechi jsonb; v_noi jsonb; v_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_vechi := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_noi := to_jsonb(NEW); END IF;
  -- actualizările care schimbă doar updated_at nu se jurnalizează
  IF TG_OP = 'UPDATE' AND (v_vechi - 'updated_at') = (v_noi - 'updated_at') THEN
    RETURN NULL;
  END IF;
  -- mascare: valoarea (admin) nu intră în jurnal — doar faptul că e setată
  IF TG_TABLE_NAME = 'red_parcele' THEN
    IF v_vechi IS NOT NULL THEN v_vechi := (v_vechi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_vechi ->> 'valoare_lei') IS NOT NULL); END IF;
    IF v_noi IS NOT NULL THEN v_noi := (v_noi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_noi ->> 'valoare_lei') IS NOT NULL); END IF;
  END IF;
  v_id := coalesce(v_noi ->> 'id', v_vechi ->> 'id', v_noi ->> 'detinator_id', v_vechi ->> 'detinator_id')::uuid;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id, user_email)
  VALUES (TG_TABLE_NAME, v_id, lower(TG_OP), v_vechi, v_noi, auth.uid(), auth.jwt() ->> 'email');
  RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.fn_red_jurnal() IS 'Redări: trigger AFTER INSERT/UPDATE/DELETE pe red_* → rând în red_jurnal (user_id = auth.uid(), user_email din JWT). Mascare valoare_lei; sare peste actualizările care schimbă doar updated_at.';

CREATE FUNCTION public.fn_red_jurnal_imuabil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'red_jurnal este append-only (% refuzat)', TG_OP USING ERRCODE = '42501';
END $fn$;

CREATE FUNCTION public.fn_red_adresa_cunoscuta(p_detinator_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND public.fn_red_nivel() IS NULL THEN NULL
              ELSE (SELECT c.adresa_cunoscuta FROM public.red_detinatori_contact c WHERE c.detinator_id = p_detinator_id) END;
$fn$;
COMMENT ON FUNCTION public.fn_red_adresa_cunoscuta(uuid) IS 'Redări: doar boolean-ul adresa_cunoscuta al unui deținător (fără PII), ca viewer-ul să primească starea FARA_ADRESA_AFISARE din view. NULL = fără rând de contact.';

-- ─── 5. Numerotare, valoare (admin), RPC publice ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cheie text; v_n int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  CASE p_tip
    WHEN 'C' THEN v_cheie := 'C';
    WHEN 'PVA', 'PVB' THEN
      IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
      v_cheie := p_tip || '-' || p_uat3;
    WHEN 'PVC' THEN
      IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
      v_cheie := 'PVC-T' || p_tronson;
    ELSE RAISE EXCEPTION 'redari: tip document necunoscut (%)', p_tip;
  END CASE;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, 1)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1
  RETURNING ultimul INTO v_n;
  RETURN v_cheie || '-' || lpad(v_n::text, 4, '0');
END $fn$;
COMMENT ON FUNCTION public.fn_red_numar_document(text, text, integer) IS 'Redări: următorul număr (C-0001, PVA-HUS-0001, PVB-HUS-0001, PVC-T3-0001), fără refolosire (UPDATE … RETURNING sub lock de rând). Doar admin/editor.';

CREATE FUNCTION public.fn_red_rezerva_numere_parcele(p_uat3 text, p_tronson int, p_n int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cheie text; v_baza int; v_ultim int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
  IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
  IF p_n IS NULL OR p_n NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'redari: numar de parcele invalid (%)', p_n; END IF;
  v_cheie := 'P-T' || p_tronson || '-' || p_uat3;
  -- baza = cel mai mare nnnn deja folosit pe (tronson, uat3) — un import anterior fără rezervare nu poate fi depășit
  SELECT coalesce(max(substring(p.id_parcela from '[0-9]{4}$')::int), 0) INTO v_baza
    FROM public.red_parcele p WHERE p.tronson = p_tronson AND p.id_parcela LIKE 'T' || p_tronson || '-' || p_uat3 || '-%';
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, v_baza + p_n)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = greatest(red_numere.ultimul, v_baza) + p_n
  RETURNING ultimul INTO v_ultim;
  IF v_ultim > 9999 THEN RAISE EXCEPTION 'redari: numerotarea parcelelor pe % depaseste 9999', v_cheie; END IF;
  RETURN v_ultim - p_n + 1;
END $fn$;
COMMENT ON FUNCTION public.fn_red_rezerva_numere_parcele(text, integer, integer) IS 'Redări: rezervă un bloc de p_n numere (1..5000) pentru id_parcela pe cheia P-T{tronson}-{uat3} și întoarce PRIMUL număr din bloc; id_parcela = T{tronson}-{uat3}-{nnnn}. Pornește de la max(nnnn) existent în red_parcele. Doar admin/editor; sigură la concurență (UPDATE sub lock de rând).';

CREATE FUNCTION public.fn_red_valoare_parcela(p_parcela_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: valoare_lei doar pentru admin' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT p.valoare_lei FROM public.red_parcele p WHERE p.id = p_parcela_id);
END $fn$;
COMMENT ON FUNCTION public.fn_red_valoare_parcela(uuid) IS 'Redări: valoare_lei a parcelei — doar admin (coloana nu e în GRANT-ul authenticated).';

CREATE FUNCTION public.fn_red_valoare_parcela_seteaza(p_parcela_id uuid, p_valoare numeric) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: valoare_lei doar pentru admin' USING ERRCODE = '42501'; END IF;
  UPDATE public.red_parcele SET valoare_lei = p_valoare WHERE id = p_parcela_id AND sters_la IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: parcela inexistenta sau stearsa'; END IF;
END $fn$;
COMMENT ON FUNCTION public.fn_red_valoare_parcela_seteaza(uuid, numeric) IS 'Redări: scrie valoare_lei — doar admin. Jurnalul primește doar valoare_lei_setata (bool), nu suma.';

CREATE FUNCTION public.fn_red_ip_client() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT nullif(left(btrim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1)), 64), '');
$fn$;

CREATE FUNCTION public.fn_red_rate_limit_atinge(p_cheie text, p_max int) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n int;
BEGIN
  INSERT INTO public.red_rate_limit (cheie, fereastra_start, numar) VALUES (p_cheie, now(), 1)
  ON CONFLICT (cheie) DO UPDATE SET
    numar = CASE WHEN red_rate_limit.fereastra_start < now() - interval '10 minutes' THEN 1 ELSE red_rate_limit.numar + 1 END,
    fereastra_start = CASE WHEN red_rate_limit.fereastra_start < now() - interval '10 minutes' THEN now() ELSE red_rate_limit.fereastra_start END
  RETURNING numar INTO v_n;
  RETURN v_n > p_max;
END $fn$;
COMMENT ON FUNCTION public.fn_red_rate_limit_atinge(text, integer) IS 'Redări: incrementează contorul cheii în fereastra curentă de 10 min; true = peste limită.';

CREATE FUNCTION public.fn_red_formular_public(p_token text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ip text := coalesce(public.fn_red_ip_client(), 'necunoscut');
  v_contact jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF public.fn_red_rate_limit_atinge('ip:' || v_ip, 30) THEN RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe'); END IF;
  -- contactul proiectului activ, ca omul să ne poată suna și când linkul nu e bun
  SELECT jsonb_build_object('contact_nume', pr.contact_nume, 'contact_telefon', pr.contact_telefon, 'contact_email', pr.contact_email)
    INTO v_contact FROM public.red_proiecte pr WHERE pr.activ ORDER BY pr.created_at LIMIT 1;
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 128 OR p_token !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid') || coalesce(v_contact, '{}'::jsonb);
  END IF;
  SELECT d.id AS detinator_id, t.token_expira_la, p.id_parcela, u.nume AS uat_nume,
         u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3, u.program_zi1, u.program_zi2, u.program_zi3,
         pr.denumire AS proiect_denumire, pr.text_declaratie, pr.contact_nume, pr.contact_telefon, pr.contact_email
    INTO r
    FROM public.red_detinatori_token t
    JOIN public.red_detinatori d ON d.id = t.detinator_id AND d.sters_la IS NULL
    JOIN public.red_parcele p ON p.id = d.parcela_id AND p.sters_la IS NULL
    JOIN public.red_uat u ON u.id = p.uat_id
    JOIN public.red_proiecte pr ON pr.id = p.proiect_id
   WHERE t.token_raspuns = p_token;
  -- inexistent și expirat primesc același răspuns (fără enumerare)
  IF NOT FOUND OR (r.token_expira_la IS NOT NULL AND now() > r.token_expira_la) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid') || coalesce(v_contact, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'id_parcela', r.id_parcela,
    'uat_nume', r.uat_nume,
    'proiect_denumire', r.proiect_denumire,
    'sesiune', (SELECT coalesce(jsonb_agg(jsonb_build_object('zi', to_char(z.zi, 'YYYY-MM-DD'), 'program', z.program) ORDER BY z.zi), '[]'::jsonb)
                  FROM (VALUES (r.sesiune_zi1, r.program_zi1), (r.sesiune_zi2, r.program_zi2), (r.sesiune_zi3, r.program_zi3)) z(zi, program)
                 WHERE z.zi IS NOT NULL),
    'deja_raspuns', EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = r.detinator_id),
    'expirat', false,
    'text_declaratie', r.text_declaratie,
    'contact_nume', r.contact_nume,
    'contact_telefon', r.contact_telefon,
    'contact_email', r.contact_email);
END $fn$;
COMMENT ON FUNCTION public.fn_red_formular_public(text) IS 'Redări, RPC public (anon): datele formularului /redari/raspuns/{token} — parcela, UAT, proiect, zilele de sesiune, declarația, contactul; niciun nume / adresă / telefon de deținător. Token necunoscut sau expirat → token_invalid; rate limit 30 / IP / 10 min → prea_multe.';

CREATE FUNCTION public.fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata boolean, p_user_agent text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ip text := coalesce(public.fn_red_ip_client(), 'necunoscut');
  v_ob text := nullif(btrim(coalesce(p_obiectii, '')), '');
  v_deja boolean; v_id uuid;
  r record;
BEGIN
  IF public.fn_red_rate_limit_atinge('ip:' || v_ip, 30) THEN RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe'); END IF;
  IF public.fn_red_rate_limit_atinge('t:' || encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex'), 5) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe');
  END IF;
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 128 OR p_token !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid');
  END IF;
  SELECT d.id AS detinator_id, t.token_expira_la, u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3
    INTO r
    FROM public.red_detinatori_token t
    JOIN public.red_detinatori d ON d.id = t.detinator_id AND d.sters_la IS NULL
    JOIN public.red_parcele p ON p.id = d.parcela_id AND p.sters_la IS NULL
    JOIN public.red_uat u ON u.id = p.uat_id
   WHERE t.token_raspuns = p_token;
  IF NOT FOUND OR (r.token_expira_la IS NOT NULL AND now() > r.token_expira_la) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid');
  END IF;
  IF p_optiune IS NULL OR p_optiune NOT IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren') THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'optiune_invalida');
  END IF;
  IF p_optiune = 'particip' AND p_zi IS NOT NULL
     AND p_zi IS DISTINCT FROM r.sesiune_zi1 AND p_zi IS DISTINCT FROM r.sesiune_zi2 AND p_zi IS DISTINCT FROM r.sesiune_zi3 THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'zi_invalida');
  END IF;
  IF p_optiune = 'nu_particip_fara_obiectii' AND coalesce(p_declaratie_confirmata, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'declaratie_neconfirmata');
  END IF;
  IF p_optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_lipsa'); END IF;
    IF length(v_ob) > 4000 THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_prea_lungi'); END IF;
  ELSE
    v_ob := NULL;
  END IF;
  v_deja := EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = r.detinator_id);
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata,
                                     ip_sau_sursa, user_agent, raw_payload, created_by)
  VALUES (r.detinator_id, 'online', p_optiune, CASE WHEN p_optiune = 'particip' THEN p_zi END, v_ob,
          CASE WHEN p_optiune = 'nu_particip_fara_obiectii' THEN true END,
          nullif(v_ip, 'necunoscut'), left(p_user_agent, 500),
          jsonb_build_object('optiune', p_optiune, 'zi', p_zi, 'obiectii_caractere', coalesce(length(v_ob), 0),
                             'declaratie_confirmata', p_declaratie_confirmata, 'user_agent', left(p_user_agent, 500)),
          NULL)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'raspuns_id', v_id, 'optiune', p_optiune, 'deja_raspuns', v_deja)
         || CASE WHEN v_deja THEN jsonb_build_object('mesaj', 'Răspunsul anterior a fost înlocuit.') ELSE '{}'::jsonb END;
END $fn$;
COMMENT ON FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text) IS 'Redări, RPC public (anon): înregistrează răspunsul online (canal online, created_by NULL, IP din x-forwarded-for). Validări prin jsonb (token_invalid, optiune_invalida, zi_invalida, declaratie_neconfirmata, obiectii_lipsa, obiectii_prea_lungi, prea_multe). Al doilea răspuns se acceptă (istoricul rămâne, ultimul contează) cu deja_raspuns = true. NU trimite mail/SMS, NU generează PV (decizia 6).';

-- ─── 6. Trigger-e ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_red_detinatori_before BEFORE INSERT OR UPDATE ON public.red_detinatori
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_detinatori_before();
CREATE TRIGGER trg_red_detinatori_token AFTER INSERT OR UPDATE OF parcela_id ON public.red_detinatori
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_detinatori_token_dupa();
CREATE TRIGGER trg_red_token_imutabil BEFORE UPDATE ON public.red_detinatori_token
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_token_imutabil();
CREATE TRIGGER trg_red_uat_sesiuni AFTER UPDATE OF sesiune_zi1, sesiune_zi2, sesiune_zi3 ON public.red_uat
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_uat_sesiuni_dupa();
CREATE TRIGGER trg_red_parcele_uat AFTER UPDATE OF uat_id ON public.red_parcele
  FOR EACH ROW WHEN (OLD.uat_id IS DISTINCT FROM NEW.uat_id) EXECUTE FUNCTION public.fn_red_parcela_uat_dupa();
CREATE TRIGGER trg_red_contact_updated_at BEFORE UPDATE ON public.red_detinatori_contact
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_updated_at();
CREATE TRIGGER trg_red_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.red_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
CREATE TRIGGER trg_red_jurnal_fara_truncate BEFORE TRUNCATE ON public.red_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_uat FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_parcele FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_detinatori FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_detinatori_contact FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_procese_verbale FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_numere FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_import_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- ─── 7. Drepturi pe funcții: totul retras, apoi EXECUTE doar pe cele apelabile din UI / formular ─────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_red_nivel(), public.fn_red_token_expira_calc(uuid), public.fn_red_detinatori_before(), public.fn_red_detinatori_token_dupa(),
  public.fn_red_token_imutabil(), public.fn_red_uat_sesiuni_dupa(), public.fn_red_parcela_uat_dupa(), public.fn_red_updated_at(), public.fn_red_jurnal(),
  public.fn_red_jurnal_imuabil(), public.fn_red_adresa_cunoscuta(uuid), public.fn_red_numar_document(text, text, integer),
  public.fn_red_rezerva_numere_parcele(text, integer, integer), public.fn_red_valoare_parcela(uuid), public.fn_red_valoare_parcela_seteaza(uuid, numeric),
  public.fn_red_ip_client(), public.fn_red_rate_limit_atinge(text, integer), public.fn_red_formular_public(text),
  public.fn_red_raspuns_public(text, text, date, text, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel(), public.fn_red_adresa_cunoscuta(uuid), public.fn_red_numar_document(text, text, integer),
  public.fn_red_rezerva_numere_parcele(text, integer, integer), public.fn_red_valoare_parcela(uuid), public.fn_red_valoare_parcela_seteaza(uuid, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_formular_public(text), public.fn_red_raspuns_public(text, text, date, text, boolean, text) TO anon, authenticated, service_role;

-- ─── 8. RLS, GRANT, politici (fără DELETE nicăieri) ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.red_proiecte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_uat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_parcele ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_detinatori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_detinatori_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_detinatori_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_convocari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_raspunsuri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_procese_verbale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_jurnal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_numere ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_import_loturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_rate_limit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.red_proiecte, public.red_uat, public.red_parcele, public.red_detinatori, public.red_detinatori_contact, public.red_detinatori_token,
  public.red_convocari, public.red_raspunsuri, public.red_procese_verbale, public.red_jurnal, public.red_numere, public.red_import_loturi, public.red_rate_limit
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.red_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.red_proiecte, public.red_uat, public.red_detinatori, public.red_detinatori_contact, public.red_convocari,
  public.red_raspunsuri, public.red_procese_verbale, public.red_import_loturi TO authenticated, service_role;
-- red_parcele: authenticated fără coloana valoare_lei (select=* pe tabel pică — UI citește red_v_parcele); service_role tot
GRANT SELECT (id, proiect_id, uat_id, id_parcela, tronson, km_de_la, km_pana_la, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp,
              categoria_folosinta, articol_deviz, cantitate, observatii, cheie_sursa, sters_la, sters_de, sters_motiv, created_at),
      INSERT (id, proiect_id, uat_id, id_parcela, tronson, km_de_la, km_pana_la, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp,
              categoria_folosinta, articol_deviz, cantitate, observatii, cheie_sursa, sters_la, sters_de, sters_motiv, created_at),
      UPDATE (proiect_id, uat_id, id_parcela, tronson, km_de_la, km_pana_la, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp,
              categoria_folosinta, articol_deviz, cantitate, observatii, cheie_sursa, sters_la, sters_de, sters_motiv)
  ON public.red_parcele TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.red_parcele TO service_role;
GRANT SELECT ON public.red_jurnal, public.red_numere, public.red_detinatori_token TO authenticated, service_role;
GRANT SELECT ON public.red_rate_limit TO service_role;

-- citire: orice nivel
CREATE POLICY red_proiecte_sel ON public.red_proiecte FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_uat_sel ON public.red_uat FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_parcele_sel ON public.red_parcele FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_detinatori_sel ON public.red_detinatori FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_convocari_sel ON public.red_convocari FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_raspunsuri_sel ON public.red_raspunsuri FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_pv_sel ON public.red_procese_verbale FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_numere_sel ON public.red_numere FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_import_loturi_sel ON public.red_import_loturi FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
-- PII: contactul și rândurile lui din jurnal doar admin/editor
CREATE POLICY red_contact_sel ON public.red_detinatori_contact FOR SELECT TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_token_sel ON public.red_detinatori_token FOR SELECT TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_jurnal_sel ON public.red_jurnal FOR SELECT TO authenticated
  USING (public.fn_red_nivel() IS NOT NULL AND (tabela <> 'red_detinatori_contact' OR public.fn_red_nivel() IN ('admin', 'editor')));
-- scriere: proiect / UAT doar admin; restul admin + editor
CREATE POLICY red_proiecte_ins ON public.red_proiecte FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() = 'admin');
CREATE POLICY red_proiecte_upd ON public.red_proiecte FOR UPDATE TO authenticated USING (public.fn_red_nivel() = 'admin') WITH CHECK (public.fn_red_nivel() = 'admin');
CREATE POLICY red_uat_ins ON public.red_uat FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() = 'admin');
CREATE POLICY red_uat_upd ON public.red_uat FOR UPDATE TO authenticated USING (public.fn_red_nivel() = 'admin') WITH CHECK (public.fn_red_nivel() = 'admin');
CREATE POLICY red_parcele_ins ON public.red_parcele FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_parcele_upd ON public.red_parcele FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_detinatori_ins ON public.red_detinatori FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_detinatori_upd ON public.red_detinatori FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_contact_ins ON public.red_detinatori_contact FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_contact_upd ON public.red_detinatori_contact FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_convocari_ins ON public.red_convocari FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_convocari_upd ON public.red_convocari FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_raspunsuri_ins ON public.red_raspunsuri FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_raspunsuri_upd ON public.red_raspunsuri FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_pv_ins ON public.red_procese_verbale FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_pv_upd ON public.red_procese_verbale FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_import_loturi_ins ON public.red_import_loturi FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_import_loturi_upd ON public.red_import_loturi FOR UPDATE TO authenticated USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
-- red_numere / red_rate_limit / red_jurnal / red_detinatori_token: fără politici de scriere — scriu doar funcțiile / trigger-ele SECURITY DEFINER

-- ─── 9. Vederi (security_invoker) ─────────────────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.red_v_parcele WITH (security_invoker = on) AS
SELECT p.id, p.proiect_id, p.uat_id, p.id_parcela, p.tronson, p.km_de_la, p.km_pana_la, p.sat, p.tarla, p.nr_cadastral, p.poz_hg,
       p.suprafata_temporara_mp, p.categoria_folosinta, p.articol_deviz, p.cantitate, p.observatii, p.cheie_sursa, p.sters_la, p.sters_de, p.sters_motiv, p.created_at
  FROM public.red_parcele p;
COMMENT ON VIEW public.red_v_parcele IS 'Redări: red_parcele fără valoare_lei — vederea pe care o citește UI-ul (select=*).';

CREATE VIEW public.red_v_stare_parcela WITH (security_invoker = on) AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END AS stare,
       o.stare_ordine,
       k.ultima_convocare_data, r.optiune AS ultimul_raspuns_optiune, r.data AS ultimul_raspuns_data,
       a.nr_pv AS pv_nr, a.stare AS pv_stare
  FROM public.red_parcele p
  JOIN public.red_detinatori d ON d.parcela_id = p.id AND d.sters_la IS NULL
  JOIN public.red_uat u ON u.id = p.uat_id
  LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  LEFT JOIN LATERAL (
    SELECT pv.nr_pv, pv.stare FROM public.red_procese_verbale pv
     WHERE pv.detinator_id = d.id AND pv.tip = 'A' AND pv.sters_la IS NULL AND pv.stare <> 'anulat'
     ORDER BY CASE pv.stare WHEN 'semnat' THEN 1 WHEN 'trimis_spre_semnare' THEN 2 ELSE 3 END, pv.created_at DESC
     LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT r1.optiune, r1.data FROM public.red_raspunsuri r1 WHERE r1.detinator_id = d.id
     ORDER BY r1.data DESC, r1.created_at DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL (
    SELECT max(cv.data_expediere) AS ultima_convocare_data,
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL
                AND c2.data_confirmare_primire IS NOT NULL AND c2.created_at > cv.created_at)), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' THEN 1
      WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.sters_la IS NULL AND pb.stare <> 'anulat') THEN 2
      WHEN a.stare = 'trimis_spre_semnare' THEN 3
      WHEN r.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN 4
      WHEN r.optiune = 'nu_particip_fara_obiectii' THEN 5
      WHEN r.optiune = 'particip' THEN 6
      WHEN k.returnata THEN 7
      WHEN k.confirmata THEN 8
      WHEN k.expediata THEN 9
      WHEN d.calitate = 'neidentificat' THEN 10
      WHEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;
COMMENT ON VIEW public.red_v_stare_parcela IS 'Redări: o linie per (parcelă, deținător) activ cu STAREA calculată după ierarhia din contract §3 (1 = PV_A_SEMNAT … 12 = DE_CONVOCAT). adresa_cunoscuta vine din contact (NULL pentru viewer); FARA_ADRESA_AFISARE = contact cu adresa_cunoscuta false SAU fără rând de contact.';

CREATE VIEW public.red_v_centralizator_uat WITH (security_invoker = on) AS
SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare,
       count(*)::int AS numar,
       (sum(count(*)) OVER (PARTITION BY v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.uat_id), 1) AS procent_inchise
  FROM public.red_v_stare_parcela v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;
COMMENT ON VIEW public.red_v_centralizator_uat IS 'Redări: numărul de (parcelă, deținător) pe (UAT, stare), totalul UAT-ului și % închise (PV_A_SEMNAT + PV_B_CONSTATARE), repetat pe fiecare rând al UAT-ului.';

CREATE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pa WHERE pa.parcela_id = p.id AND pa.tip = 'A' AND pa.stare = 'semnat' AND pa.sters_la IS NULL) THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
COMMENT ON VIEW public.red_v_tronson IS 'Redări: parcelele active per tronson cu tipul de PV (A dacă există PV A semnat, B dacă există PV B, altfel NULL) și obiecțiile deschise — baza PV-ului C.';

REVOKE ALL ON public.red_v_parcele, public.red_v_stare_parcela, public.red_v_centralizator_uat, public.red_v_tronson FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_v_parcele, public.red_v_stare_parcela, public.red_v_centralizator_uat, public.red_v_tronson TO authenticated, service_role;

-- ─── 10. Bucket privat `redari` + politici storage (fără DELETE) ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('redari', 'redari', false, 26214400,
        ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']);
CREATE POLICY red_storage_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'redari' AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_storage_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'redari' AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_storage_upd ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'redari' AND public.fn_red_nivel() IN ('admin', 'editor'))
  WITH CHECK (bucket_id = 'redari' AND public.fn_red_nivel() IN ('admin', 'editor'));

-- ─── 11. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_tabele text[] := ARRAY['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_detinatori_contact', 'red_detinatori_token', 'red_convocari',
                           'red_raspunsuri', 'red_procese_verbale', 'red_jurnal', 'red_numere', 'red_import_loturi', 'red_rate_limit'];
  v_vederi text[] := ARRAY['red_v_parcele', 'red_v_stare_parcela', 'red_v_centralizator_uat', 'red_v_tronson'];
  v_publice text[] := ARRAY['public.fn_red_formular_public(text)', 'public.fn_red_raspuns_public(text,text,date,text,boolean,text)'];
  v_ui text[] := ARRAY['public.fn_red_nivel()', 'public.fn_red_adresa_cunoscuta(uuid)', 'public.fn_red_numar_document(text,text,integer)',
                       'public.fn_red_rezerva_numere_parcele(text,integer,integer)', 'public.fn_red_valoare_parcela(uuid)', 'public.fn_red_valoare_parcela_seteaza(uuid,numeric)'];
  t text; f record; v_expuse text[];
BEGIN
  -- tabele: toate, cu RLS
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY (v_tabele) AND c.relrowsecurity) <> 13 THEN
    RAISE EXCEPTION 'Postconditie: nu sunt 13 tabele red_* cu RLS';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'red\_%' AND c.relkind IN ('r', 'v')) <> 17 THEN
    RAISE EXCEPTION 'Postconditie: alte relatii red_* decat cele 13 tabele + 4 vederi';
  END IF;
  -- vederi: toate security_invoker
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = ANY (v_vederi)
         AND EXISTS (SELECT 1 FROM unnest(c.reloptions) o WHERE o ~* '^security_invoker=(on|true)$')) <> 4 THEN
    RAISE EXCEPTION 'Postconditie: vederile red_v_* nu sunt toate security_invoker';
  END IF;
  -- politici: niciuna DELETE pe red_*; pe red_jurnal doar SELECT; fiecare tabel cu politici are doar roluri authenticated
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'red\_%' AND cmd NOT IN ('SELECT', 'INSERT', 'UPDATE')) THEN
    RAISE EXCEPTION 'Postconditie: exista politici DELETE / ALL pe red_*';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_jurnal' AND cmd <> 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_rate_limit', 'red_numere', 'red_detinatori_token') AND cmd <> 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'red\_%' AND roles <> ARRAY['authenticated']::name[]) THEN
    RAISE EXCEPTION 'Postconditie: politici neasteptate pe red_jurnal / red_numere / red_rate_limit sau cu alte roluri';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'red\_%') <> 30 THEN
    RAISE EXCEPTION 'Postconditie: numarul de politici red_* nu e 30 (%)', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'red\_%');
  END IF;
  -- tokenul: nu e coloana pe red_detinatori; red_detinatori_token doar SELECT, doar admin/editor (viewer-ul nu-l vede), fara scriere pentru nimeni
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori' AND column_name IN ('token_raspuns', 'token_expira_la'))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_detinatori_token') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_detinatori_token' AND cmd = 'SELECT'
                      AND qual LIKE '%fn_red_nivel()%' AND qual LIKE '%admin%' AND qual LIKE '%editor%' AND qual NOT LIKE '%viewer%' AND qual NOT LIKE '%IS NOT NULL%')
     OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'INSERT') OR has_any_column_privilege('authenticated', 'public.red_detinatori_token', 'UPDATE')
     OR has_any_column_privilege('service_role', 'public.red_detinatori_token', 'INSERT') OR has_any_column_privilege('service_role', 'public.red_detinatori_token', 'UPDATE') THEN
    RAISE EXCEPTION 'Postconditie: tokenul de raspuns nu e izolat in red_detinatori_token (SELECT doar admin/editor, fara scriere)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'red_parcele' AND indexname = 'ux_red_parcele_cheie_sursa' AND indexdef LIKE 'CREATE UNIQUE INDEX%') THEN
    RAISE EXCEPTION 'Postconditie: lipseste indexul unic partial pe cheie_sursa';
  END IF;
  -- privilegii: anon nimic; nimeni DELETE/TRUNCATE; red_jurnal doar SELECT; valoare_lei fara authenticated
  FOREACH t IN ARRAY v_tabele LOOP
    IF has_any_column_privilege('anon', 'public.' || t, 'SELECT') OR has_any_column_privilege('anon', 'public.' || t, 'INSERT')
       OR has_any_column_privilege('anon', 'public.' || t, 'UPDATE') OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'Postconditie: anon are drepturi pe %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'DELETE') OR has_table_privilege('service_role', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') OR has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'Postconditie: DELETE / TRUNCATE acordat pe %', t;
    END IF;
  END LOOP;
  IF has_any_column_privilege('authenticated', 'public.red_jurnal', 'INSERT') OR has_any_column_privilege('authenticated', 'public.red_jurnal', 'UPDATE')
     OR has_any_column_privilege('service_role', 'public.red_jurnal', 'INSERT') OR has_any_column_privilege('service_role', 'public.red_jurnal', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.red_rate_limit', 'SELECT') OR has_any_column_privilege('authenticated', 'public.red_numere', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.red_numere', 'UPDATE') THEN
    RAISE EXCEPTION 'Postconditie: scriere pe red_jurnal / red_numere sau citire red_rate_limit acordata';
  END IF;
  IF has_column_privilege('authenticated', 'public.red_parcele', 'valoare_lei', 'SELECT') OR has_column_privilege('authenticated', 'public.red_parcele', 'valoare_lei', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.red_parcele', 'valoare_lei', 'INSERT') OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'id_parcela', 'SELECT') THEN
    RAISE EXCEPTION 'Postconditie: privilegiile pe red_parcele.valoare_lei nu sunt cele asteptate';
  END IF;
  -- jurnal: 10 trigger-e (toate tabelele in afara de red_jurnal si red_rate_limit) + imutabilitate
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_red_jurnal' AND tgfoid = 'public.fn_red_jurnal()'::regprocedure AND NOT tgisinternal) <> 10
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_jurnal'::regclass AND tgfoid = 'public.fn_red_jurnal_imuabil()'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'Postconditie: trigger-ele de jurnal lipsesc';
  END IF;
  -- functii: toate fn_red_* SECURITY DEFINER cu search_path fix; EXECUTE exact pe listele asteptate
  FOR f IN SELECT p.oid, format('%s.%s(%s)', n.nspname, p.proname, array_to_string(p.proargtypes::oid[]::regtype[], ',')) AS sig, p.prosecdef, p.proconfig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_%' LOOP
    IF NOT f.prosecdef OR f.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(f.proconfig) c WHERE c = 'search_path=public, pg_temp') THEN
      RAISE EXCEPTION 'Postconditie: % nu e SECURITY DEFINER cu search_path = public, pg_temp', f.sig;
    END IF;
    IF has_function_privilege('anon', f.oid, 'EXECUTE') <> (f.sig = ANY (v_publice))
       OR has_function_privilege('authenticated', f.oid, 'EXECUTE') <> (f.sig = ANY (v_publice || v_ui)) THEN
      RAISE EXCEPTION 'Postconditie: EXECUTE neasteptat pe %', f.sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_%') <> 19 THEN
    RAISE EXCEPTION 'Postconditie: nu sunt exact 19 functii fn_red_*';
  END IF;
  -- control 0e echivalent pe functiile expuse: fara scriere de GUC-uri de identitate, fara SQL dinamic, fara set role
  SELECT array_agg(p.oid::regprocedure::text) INTO v_expuse
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_%'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND (lower(p.prosrc) ~ 'set_config|request[.]jwt|session_authorization|(^|[^a-z_])execute([^a-z_]|$)|(^|[^a-z_])(set|reset)[[:space:]]+((local|session)[[:space:]]+)?role([^a-z_]|$)'
          OR EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c ~* '^(role|session_authorization|request[.]jwt[^=]*)='));
  IF v_expuse IS NOT NULL THEN RAISE EXCEPTION 'Postconditie 0e: functii expuse cu GUC de identitate / SQL dinamic: %', v_expuse; END IF;
  -- storage: bucket privat + exact 3 politici (fara DELETE), toate pe fn_red_nivel
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari' AND public = false) THEN RAISE EXCEPTION 'Postconditie: bucket-ul redari lipseste sau e public'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'red\_storage\_%'
        AND cmd IN ('SELECT', 'INSERT', 'UPDATE') AND roles = ARRAY['authenticated']::name[]
        AND coalesce(qual, with_check) LIKE '%fn_red_nivel()%' AND coalesce(qual, with_check) LIKE '%redari%') <> 3
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'red\_%' AND cmd NOT IN ('SELECT', 'INSERT', 'UPDATE')) THEN
    RAISE EXCEPTION 'Postconditie: politicile storage red_storage_* nu sunt cele 3 asteptate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'redari' AND is_active) THEN RAISE EXCEPTION 'Postconditie: cheia de modul redari lipseste'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'redari') THEN RAISE EXCEPTION 'Postconditie: migrarea nu acorda drepturi'; END IF;
END $post$;
