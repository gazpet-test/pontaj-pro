-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261018a — Generator de decizii de numire, PR1 (registru HR): docs/HR/GENERATOR_DECIZII_SPEC.md v1.6, §3 + §10
--
-- Ce face:
--   * 5 tabele noi: hr_decizii_semnatari, hr_decizii_tipuri, hr_decizii, hr_decizii_contor, hr_decizii_evenimente;
--   * coloana aditivă executie_completari_propuse.hr_decizie_id (FK hr_decizii);
--   * view v_hr_decizii_curente (security_invoker), bucket privat hr-decizii (doar PDF, 20 MB) cu politici SELECT/INSERT
--     (fără UPDATE, fără DELETE, VA19);
--   * drepturi: fn_hr_decizii_poate (fail-closed) peste _hr_decizii_termeni (o singură copie a predicatelor, §3.3);
--   * RPC-urile §3.6 (contor, previzualizare, emitere, PDF, scan, înlocuire scan, anulare, rezervare, import, emitenți);
--   * triggere: imuabilitate (SECURITY INVOKER, Vf2), revocare, versiune, jurnal, jurnal insert-only (J17);
--   * SCHIMBĂ obiecte EXISTENTE (OK explicit Răzvan, §3.4/J5/P3-2):
--       - politica completari_ins: + `hr_decizie_id IS NULL AND sursa NOT IN ('decizie_numire','decizie_revocare')`;
--       - fn_completare_aplica: rândurile cu hr_decizie_id merg pe _hr_completare_aplica_decizie (numire / golire);
--         rândurile fără hr_decizie_id: același comportament, dar scrierea dinamică a câmpului e mutată în funcția internă
--         _completare_scrie_camp (fără EXECUTE pentru authenticated) — corpul public nu mai conține SQL dinamic, deci
--         gate-ul 0e nu mai are nevoie de excepția md5 47a75428 (rămâne în control_0e.sql ca intrare moartă);
--   * seed: 3 semnatari (121 reprezentant legal; 90 și 125 împuterniciți) + 15 tipuri (§5.3). Textele 121 / RTE / RTE_MEC /
--     SEF_SANTIER transcrise din PDF-urile 916, 913, 915 (28.09.2026), RESPONSABIL_DESEURI P din 227/2026; restul din §5.3.
-- Neatins: app_modules (fără cheia hr.decizii, VA24), user_module_access, profiles, executie_proiecte (nicio scriere),
--   sef_santier_employee_id nu apare în niciun corp de funcție (revenirea 20261017a rămâne posibilă).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261018a_hr_decizii_registru_ROLLBACK.sql. Teste: scripts/test_hr_decizii.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261018a_hr_decizii_registru:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261018a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

-- ─── 0. Precondiții (starea exactă citită pe live 06.10.2026) ───────────────────────────────────────────
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.hr_decizii') IS NOT NULL OR to_regclass('public.hr_decizii_tipuri') IS NOT NULL
     OR to_regclass('public.hr_decizii_semnatari') IS NOT NULL OR to_regclass('public.hr_decizii_contor') IS NOT NULL
     OR to_regclass('public.hr_decizii_evenimente') IS NOT NULL OR to_regclass('public.v_hr_decizii_curente') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hr-decizii')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_completari_propuse'::regclass
                  AND attname = 'hr_decizie_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Precondiție 0b: obiectele registrului există deja — reaplicare';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_completare_aplica(bigint,boolean)'))
       IS DISTINCT FROM '47a7542895c0ce71cb0e44d2c26d0609' THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_completare_aplica nu e versiunea revizuită 47a75428';
  END IF;
  IF (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
       WHERE polrelid = 'public.executie_completari_propuse'::regclass AND polname = 'completari_ins' AND polcmd = 'a')
     IS DISTINCT FROM E'(EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.id = auth.uid()) AND (p.is_owner OR p.can_manage_contracts))))' THEN
    RAISE EXCEPTION 'Precondiție 0d: politica completari_ins nu e cea citită pe live';
  END IF;
  IF (SELECT count(*) FROM public.employees WHERE id IN (121, 90, 125)) <> 3 THEN
    RAISE EXCEPTION 'Precondiție 0e: semnatarii 121/90/125 lipsesc din employees';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'hr.decizii') THEN
    RAISE EXCEPTION 'Precondiție 0f: cheia hr.decizii există în app_modules (VA24: PR1 nu o creează)';
  END IF;
  IF (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
       WHERE attrelid = 'public.executie_proiecte'::regclass AND NOT attisdropped
         AND attname IN ('rte_employee_id','rts_employee_id','mp_employee_id','activ','nr_contract','data_contract','nume'))
     IS DISTINCT FROM ARRAY['activ','data_contract','mp_employee_id','nr_contract','nume','rte_employee_id','rts_employee_id'] THEN
    RAISE EXCEPTION 'Precondiție 0g: coloanele așteptate din executie_proiecte lipsesc';
  END IF;
END
$pre$;

-- ─── 1. Tabele (§3.1) ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.hr_decizii_semnatari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id int NOT NULL REFERENCES public.employees(id),
  calitate text NOT NULL,
  este_reprezentant_legal boolean NOT NULL DEFAULT false,
  preambul_text text NOT NULL,
  bloc_semnatura text NOT NULL,
  preambul_validat boolean NOT NULL DEFAULT false,
  imputernicire_decizie_id bigint,
  activ boolean NOT NULL DEFAULT true,
  ordine int,
  UNIQUE (employee_id)
);
COMMENT ON TABLE public.hr_decizii_semnatari IS 'Semnatarii deciziilor HR (spec §3.1, D2). Scriere doar prin migrare; preambul literal pe persoană (VA3).';

CREATE TABLE public.hr_decizii_tipuri (
  cod text PRIMARY KEY,
  denumire text NOT NULL,
  eticheta_functie text NOT NULL,
  etichete_alternative text[] NOT NULL DEFAULT '{}',
  nivel text NOT NULL CHECK (nivel IN ('proiect','firma','ambele')),
  are_sablon boolean NOT NULL DEFAULT true,
  art1_proiect text, art1_firma text,
  temei_implicit text,
  temei_sursa text NOT NULL DEFAULT 'model_nas' CHECK (temei_sursa IN ('model_nas','propunere','validat_juridic')),
  art_valabilitate_proiect text,
  autorizatie_tipuri text[],
  autorizatie_ceruta text NOT NULL CHECK (autorizatie_ceruta IN ('obligatorie','recomandata','nu')),
  necesita_domeniu_isc boolean NOT NULL DEFAULT false,
  camp_efect text CHECK (camp_efect IN ('rte_employee_id','rts_employee_id','mp_employee_id','sef_santier_employee_id')),
  rol_cod text,
  unic_activ boolean NOT NULL DEFAULT true,
  semnatar_implicit_id bigint REFERENCES public.hr_decizii_semnatari(id),
  activ boolean NOT NULL DEFAULT true,
  ordine int
);
COMMENT ON TABLE public.hr_decizii_tipuri IS 'Nomenclatorul funcțiilor din deciziile de numire și șabloanele lor (spec §3.1, §5).';

CREATE TABLE public.hr_decizii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serie text NOT NULL DEFAULT 'HR' CHECK (serie IN ('HR','carte_tehnica')),
  an int, numar int, numar_sufix text NOT NULL DEFAULT '',
  mod_numar text CHECK (mod_numar IN ('auto','manual')),
  origine text NOT NULL DEFAULT 'platforma' CHECK (origine IN ('platforma','import','rezervare')),
  tip_cod text NOT NULL REFERENCES public.hr_decizii_tipuri(cod),
  eticheta_functie text NOT NULL,
  descriere text,
  nivel text NOT NULL CHECK (nivel IN ('proiect','firma')),
  employee_id int REFERENCES public.employees(id),
  persoana_nume text,
  proiect_id bigint REFERENCES public.executie_proiecte(id),
  proiect_denumire text,
  autorizatie_id bigint REFERENCES public.hr_autorizatii(id),
  domenii_isc text[],
  titlu text CHECK (titlu IN ('Dl.','D-na')),
  temei text,
  data_emitere date, data_efect date, data_efect_pana date,
  semnatar_id bigint REFERENCES public.hr_decizii_semnatari(id),
  luare_la_cunostinta boolean NOT NULL DEFAULT false,
  propune_efect boolean NOT NULL DEFAULT true,
  inlocuieste_id bigint REFERENCES public.hr_decizii(id),
  revoca_id bigint REFERENCES public.hr_decizii(id),
  versiune int NOT NULL DEFAULT 1,
  cerere_id uuid UNIQUE,
  cerere_hash text,
  cerere_emitere uuid,
  cerere_emitere_hash text,
  snapshot jsonb NOT NULL DEFAULT '{}',
  continut jsonb,
  cod_verificare text,
  avertismente jsonb NOT NULL DEFAULT '[]',
  stare text NOT NULL DEFAULT 'draft' CHECK (stare IN ('draft','emisa','semnata','anulata','revocata','inlocuita')),
  motiv_anulare text,
  pdf_path text, pdf_sha256 text, scan_path text, scan_sha256 text,
  creat_de uuid NOT NULL DEFAULT auth.uid(), creat_la timestamptz NOT NULL DEFAULT now(),
  emis_de uuid, emis_la timestamptz, scan_de uuid, scan_la timestamptz,
  anulat_de uuid, anulat_la timestamptz,
  UNIQUE (serie, an, numar, numar_sufix),
  CHECK ((stare = 'draft') = (numar IS NULL)),
  CHECK ((numar IS NULL) = (an IS NULL)),
  CHECK (numar_sufix = '' OR origine = 'import'),
  CHECK (serie = 'HR' OR origine = 'import'),
  CHECK ((nivel = 'proiect') = (proiect_id IS NOT NULL)),
  CHECK ((tip_cod = 'REVOCARE') = (revoca_id IS NOT NULL)),
  CHECK (tip_cod <> 'ALTA_DECIZIE' OR descriere IS NOT NULL),
  CHECK (data_emitere IS NOT NULL OR origine = 'import' OR stare = 'draft'),
  CHECK (employee_id IS NOT NULL OR origine <> 'platforma' OR stare = 'draft'
         OR (tip_cod = 'REVOCARE' AND persoana_nume IS NOT NULL)),
  CHECK (employee_id IS NOT NULL OR persoana_nume IS NOT NULL OR tip_cod = 'ALTA_DECIZIE' OR stare = 'draft'),
  CHECK (origine <> 'platforma' OR stare = 'draft'
         OR (titlu IS NOT NULL AND data_efect IS NOT NULL AND semnatar_id IS NOT NULL AND continut IS NOT NULL)),
  CHECK (data_efect_pana IS NULL OR data_efect IS NULL OR data_efect_pana >= data_efect),
  CHECK (inlocuieste_id IS NULL OR revoca_id IS NULL),
  CHECK (numar IS NULL OR numar BETWEEN 1 AND 99999),
  CHECK (an IS NULL OR an >= 2000),
  CHECK (data_emitere IS NULL OR an IS NULL OR extract(year FROM data_emitere) = an),
  CHECK (numar_sufix ~ '^([a-z]{1,6})?$'),
  CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (scan_sha256 IS NULL OR scan_sha256 ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE public.hr_decizii IS 'Registrul HR comun (D1): decizii generate, rezervate sau importate. Imuabil după emitere (spec §2).';
CREATE UNIQUE INDEX hr_decizii_tinta_vie ON public.hr_decizii ((coalesce(inlocuieste_id, revoca_id)))
  WHERE coalesce(inlocuieste_id, revoca_id) IS NOT NULL AND stare NOT IN ('draft','anulata');
CREATE UNIQUE INDEX hr_decizii_cerere_emitere ON public.hr_decizii (cerere_emitere) WHERE cerere_emitere IS NOT NULL;
CREATE INDEX hr_decizii_employee_idx ON public.hr_decizii (employee_id);
CREATE INDEX hr_decizii_proiect_idx ON public.hr_decizii (proiect_id);
CREATE INDEX hr_decizii_tip_idx ON public.hr_decizii (tip_cod);
CREATE INDEX hr_decizii_serie_an_idx ON public.hr_decizii (serie, an);
ALTER TABLE public.hr_decizii_semnatari ADD CONSTRAINT hr_decizii_semnatari_imputernicire_fkey
  FOREIGN KEY (imputernicire_decizie_id) REFERENCES public.hr_decizii(id);

CREATE TABLE public.hr_decizii_contor (
  serie text NOT NULL DEFAULT 'HR' CHECK (serie = 'HR'),
  an int NOT NULL,
  ultimul int NOT NULL DEFAULT 0 CHECK (ultimul BETWEEN 0 AND 99999),
  auto_permis boolean NOT NULL DEFAULT false,
  ultimul_initial int,
  baza_fizica int CHECK (baza_fizica BETWEEN 0 AND 99999),
  initializat_de uuid, initializat_la timestamptz, initializat_sursa text,
  PRIMARY KEY (serie, an)
);
COMMENT ON TABLE public.hr_decizii_contor IS 'Contorul registrului HR pe an (spec §3.7, §4.G). Scriere doar prin RPC-uri.';

CREATE TABLE public.hr_decizii_evenimente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decizie_id bigint,
  serie text, an int,
  eveniment text NOT NULL,
  stare_veche text, stare_noua text,
  de uuid, la timestamptz NOT NULL DEFAULT now(),
  detalii jsonb
);
COMMENT ON TABLE public.hr_decizii_evenimente IS 'Jurnalul registrului HR: insert-only pentru toată lumea (J17); decizie_id fără FK (J1).';
CREATE INDEX hr_decizii_evenimente_decizie_idx ON public.hr_decizii_evenimente (decizie_id);
CREATE UNIQUE INDEX hr_decizii_evenimente_scan_inlocuit_cerere ON public.hr_decizii_evenimente ((detalii->>'cerere_id'))
  WHERE eveniment = 'scan_inlocuit';

ALTER TABLE public.executie_completari_propuse ADD COLUMN hr_decizie_id bigint REFERENCES public.hr_decizii(id);
CREATE INDEX executie_completari_propuse_hr_decizie_idx ON public.executie_completari_propuse (hr_decizie_id)
  WHERE hr_decizie_id IS NOT NULL;

-- ─── 2. Funcții pure și termenii de drept (§3.3, §3.6 „Funcții interne”) ────────────────────────────────
-- Ziua de business Europe/Bucharest (P2.2). Singura _hr_* cu EXECUTE pentru authenticated (rulează în view, J2-1).
CREATE FUNCTION public._hr_azi() RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $f$ SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date $f$;

CREATE FUNCTION public._hr_decizii_norm_sufix(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE v text := lower(trim(coalesce(p, '')));
BEGIN
  IF v <> '' AND v !~ '^[a-z]{1,6}$' THEN
    RAISE EXCEPTION 'sufix invalid: „%” (doar 1–6 litere, ex. bis, a, b)', p;
  END IF;
  RETURN v;
END $f$;

-- Id-ul deciziei din calea din bucket (VA23, J15): NULL dacă numele nu respectă forma; cast doar după regex.
CREATE FUNCTION public.fn_hr_decizii_id_din_cale(p_name text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$
  SELECT CASE WHEN p_name ~ '^(HR|carte_tehnica)/[0-9]{4}/[1-9][0-9]{0,17}/(generat|semnat)_[0-9]{1,15}[.]pdf$'
              THEN split_part(p_name, '/', 3)::bigint END
$f$;

-- Normalizarea domeniilor ISC: port SQL al normalizeazaDomeniiISC (src/iscRte.js). Doar coduri (fără schema MLPAT).
CREATE FUNCTION public._hr_norm_domenii_isc(p text[]) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE
  v_out text[] := '{}'; v_f text; v_t text; v_m text[]; v_cod text; v_loc text[];
BEGIN
  FOREACH v_f IN ARRAY coalesce(p, '{}') LOOP
    v_t := btrim(translate(lower(coalesce(v_f, '')), 'ăâîșşțţ', 'aaisstt'));
    CONTINUE WHEN v_t = '';
    v_loc := '{}';
    FOR v_m IN SELECT regexp_matches(v_t, '(^|[^0-9a-z_])8[.]4[[:space:]]*[(-]?[[:space:]]*([dt])', 'g') LOOP
      v_loc := v_loc || ('8.4' || upper(v_m[2]));
    END LOOP;
    FOR v_m IN SELECT regexp_matches(v_t,
        '(^|[^0-9a-z_])(1[.][1-4]|2[.][1-4]|3[.]1|4[.][12]|5[.]1|6[.][1-3]|7[.]1|8[.][1-5]|9[.]1|11[.]1)(?![0-9a-z_])(?![[:space:]]*[(-]?[[:space:]]*[dt])', 'g') LOOP
      v_cod := v_m[2];
      IF NOT (v_cod = '8.4' AND EXISTS (SELECT 1 FROM unnest(v_loc) x WHERE x LIKE '8.4%')) THEN
        v_loc := v_loc || v_cod;
      END IF;
    END LOOP;
    IF cardinality(v_loc) = 0 THEN
      v_loc := CASE
        WHEN v_t ~ 'constructii civile|cladir|hala|civile' THEN ARRAY['1.1']
        WHEN v_t ~ 'drum|rutier|strazi' THEN ARRAY['2.1']
        WHEN v_t ~ 'pod(uri)?([^0-9a-z_]|$)' THEN ARRAY['2.3']
        WHEN v_t ~ 'hidrotehnic' THEN ARRAY['5.1']
        WHEN v_t ~ 'instalatii electrice' THEN ARRAY['6.1']
        WHEN v_t ~ 'instalatii (termice|sanitare)|ventila|climatiz' THEN ARRAY['6.2']
        WHEN v_t ~ 'instalatii( de utilizare)? gaze' THEN ARRAY['6.3']
        WHEN v_t ~ 'retele electrice' THEN ARRAY['8.1']
        WHEN v_t ~ 'retele (termice|sanitare)|apa.?canal|alimentare cu apa|canalizare' THEN ARRAY['8.2']
        WHEN v_t ~ 'telecomunicati' THEN ARRAY['8.3']
        WHEN v_t ~ 'retele (de )?gaze|distributie gaze' THEN ARRAY['8.4D']
        WHEN v_t ~ 'transport gaze' THEN ARRAY['8.4T']
        WHEN v_t ~ 'petrolier|titei' THEN ARRAY['8.5']
        WHEN v_t ~ 'edilitar|gospodarie comunala' THEN ARRAY['9.1']
        WHEN v_t ~ 'fundatii' THEN ARRAY['11.1']
        ELSE '{}'::text[] END;
    END IF;
    FOREACH v_cod IN ARRAY v_loc LOOP
      IF NOT v_cod = ANY (v_out) THEN v_out := v_out || v_cod; END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END $f$;

-- Acoperirea domeniilor (P3-1, J3-2): pură; true doar dacă TOATE codurile cerute sunt acoperite. Port acoperaDomeniul.
CREATE FUNCTION public._hr_acopera_domeniu(p_cerute text[], p_domenii_autorizate text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$
  SELECT cardinality(coalesce(p_cerute, '{}')) > 0 AND NOT EXISTS (
    SELECT 1 FROM unnest(p_cerute) c(x)
     WHERE NOT (
       upper(regexp_replace(coalesce(c.x, ''), '[[:space:]]', '', 'g')) = ANY (
         SELECT upper(a) FROM unnest(coalesce(p_domenii_autorizate, '{}')) a)
       OR (upper(regexp_replace(coalesce(c.x, ''), '[[:space:]]', '', 'g')) = '8.4'
           AND EXISTS (SELECT 1 FROM unnest(coalesce(p_domenii_autorizate, '{}')) a WHERE upper(a) IN ('8.4D','8.4T')))
     ) OR coalesce(c.x, '') = '')
$f$;

-- Termenii de drept (§3.3) pe un profil: o singură copie, fail-closed (toți booleeni, niciodată NULL).
CREATE FUNCTION public._hr_decizii_termeni(p_profile_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  WITH p AS (SELECT * FROM public.profiles WHERE id = p_profile_id),
  t AS (
    SELECT coalesce((SELECT p.is_owner FROM p), false) AS owner,
           coalesce((SELECT p.department = 'HR' FROM p), false)
             OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id
                          AND u.module = 'hr.decizii' AND u.access_level IN ('editor','admin')) AS hr,
           EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id AND u.module = 'hr.decizii') AS hr_dec,
           EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id AND u.module = 'executie')
             OR coalesce((SELECT p.can_manage_contracts FROM p), false) AS exec,
           coalesce((SELECT p.can_manage_contracts FROM p), false) AS cmc,
           coalesce((SELECT p.employee_id IS NOT NULL FROM p), false) AS are_fisa
  )
  SELECT jsonb_build_object(
    'owner', t.owner, 'hr', t.hr, 'hr_citire', t.hr OR t.hr_dec, 'exec', t.exec,
    'confirm', t.owner OR t.cmc, 'are_fisa', t.are_fisa)
  FROM t
$f$;

-- Helper-ul unic de drept (§3.3). Fail-closed: întoarce mereu true/false.
CREATE FUNCTION public.fn_hr_decizii_poate(p_actiune text, p_decizie_id bigint DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  t jsonb; v_owner boolean; v_hr boolean; v_hrc boolean; v_exec boolean; v_conf boolean; v_fisa boolean;
  v_pe_proiect boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  t := public._hr_decizii_termeni(auth.uid());
  v_owner := coalesce((t->>'owner')::boolean, false);
  v_hr := coalesce((t->>'hr')::boolean, false);
  v_hrc := coalesce((t->>'hr_citire')::boolean, false);
  v_exec := coalesce((t->>'exec')::boolean, false);
  v_conf := coalesce((t->>'confirm')::boolean, false);
  v_fisa := coalesce((t->>'are_fisa')::boolean, false);
  IF p_decizie_id IS NOT NULL THEN
    v_pe_proiect := coalesce((SELECT d.nivel = 'proiect' AND d.stare <> 'draft' AND d.tip_cod <> 'ALTA_DECIZIE'
                                FROM public.hr_decizii d WHERE d.id = p_decizie_id), false);
  END IF;
  RETURN coalesce(CASE p_actiune
    WHEN 'citire' THEN v_owner OR v_hrc
    WHEN 'citire_doc' THEN v_owner OR v_hrc OR (v_exec AND v_pe_proiect)
    WHEN 'citire_scan' THEN v_owner OR v_hr OR (v_conf AND v_pe_proiect AND v_fisa)
    WHEN 'redactare' THEN v_owner OR v_hr
    WHEN 'emitere' THEN v_owner OR v_hr
    WHEN 'rezervare' THEN v_owner OR v_hr
    WHEN 'scan' THEN v_owner OR v_hr
    WHEN 'anulare' THEN v_owner OR v_hr
    WHEN 'import' THEN v_owner OR v_hr
    WHEN 'contor' THEN v_owner OR v_hr
    WHEN 'owner' THEN v_owner
    ELSE false END, false);
END $f$;

-- Politica de storage (§3.5): o singură funcție, chemată doar pe bucket-ul hr-decizii.
CREATE FUNCTION public.fn_hr_decizii_storage_poate(p_name text, p_op text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_id bigint := public.fn_hr_decizii_id_din_cale(p_name); d public.hr_decizii; v_cat text;
BEGIN
  IF v_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = v_id;
  IF NOT FOUND OR d.stare = 'draft' OR d.an IS NULL
     OR split_part(p_name, '/', 1) IS DISTINCT FROM d.serie OR split_part(p_name, '/', 2) IS DISTINCT FROM d.an::text THEN
    RETURN false;
  END IF;
  v_cat := split_part(split_part(p_name, '/', 4), '_', 1);
  RETURN coalesce(CASE
    WHEN p_op = 'select' AND v_cat = 'generat' THEN public.fn_hr_decizii_poate('citire_doc', v_id)
    WHEN p_op = 'select' AND v_cat = 'semnat' THEN public.fn_hr_decizii_poate('citire_scan', v_id)
    WHEN p_op = 'insert' AND v_cat = 'generat' THEN public.fn_hr_decizii_poate('emitere') AND d.stare = 'emisa' AND d.origine = 'platforma'
    WHEN p_op = 'insert' AND v_cat = 'semnat' THEN
      (public.fn_hr_decizii_poate('scan') AND d.stare = 'emisa') OR (public.fn_hr_decizii_poate('owner') AND d.stare = 'semnata')
    ELSE false END, false);
END $f$;

-- Șablon (§5.2, J2-13, J3-8): o singură trecere, nerecursivă. strict = variabilă lipsă → eroare; altfel NULL (segment omis).
CREATE FUNCTION public._hr_subst(p_txt text, p_vars jsonb, p_strict boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE v_out text := ''; v_rest text := coalesce(p_txt, ''); v_m text; v_i int; v_val text;
BEGIN
  LOOP
    v_m := substring(v_rest FROM '[{][a-z_]+[}]');
    EXIT WHEN v_m IS NULL;
    v_i := strpos(v_rest, v_m);
    v_val := p_vars->>substr(v_m, 2, length(v_m) - 2);
    IF v_val IS NULL OR v_val = '' THEN
      IF p_strict THEN RAISE EXCEPTION 'sablon: variabila % fara valoare', v_m; END IF;
      RETURN NULL;
    END IF;
    v_out := v_out || left(v_rest, v_i - 1) || v_val;
    v_rest := substr(v_rest, v_i + length(v_m));
  END LOOP;
  RETURN v_out || v_rest;
END $f$;

CREATE FUNCTION public._hr_sablon(p_tpl text, p_vars jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE v_out text := ''; v_rest text := coalesce(p_tpl, ''); v_i int; v_j int; v_seg text;
BEGIN
  LOOP
    v_i := strpos(v_rest, '[[');
    IF v_i = 0 THEN
      IF strpos(v_rest, ']]') > 0 THEN RAISE EXCEPTION 'sablon invalid: ]] fara [['; END IF;
      RETURN v_out || public._hr_subst(v_rest, p_vars, true);
    END IF;
    v_out := v_out || public._hr_subst(left(v_rest, v_i - 1), p_vars, true);
    v_rest := substr(v_rest, v_i + 2);
    v_j := strpos(v_rest, ']]');
    IF v_j = 0 THEN RAISE EXCEPTION 'sablon invalid: [[ neinchis'; END IF;
    v_seg := left(v_rest, v_j - 1);
    IF strpos(v_seg, '[[') > 0 THEN RAISE EXCEPTION 'sablon invalid: segmente imbricate'; END IF;
    v_out := v_out || coalesce(public._hr_subst(v_seg, p_vars, false), '');
    v_rest := substr(v_rest, v_j + 2);
  END LOOP;
END $f$;

-- Validatorul comun de număr/an/dată (§2.1, J12).
CREATE FUNCTION public._hr_decizii_valideaza_numar(p_serie text, p_an int, p_numar int, p_sufix text, p_data_emitere date, p_origine text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE v_an_azi int := extract(year FROM public._hr_azi());
BEGIN
  IF p_serie IS NULL OR p_serie NOT IN ('HR','carte_tehnica') THEN RAISE EXCEPTION 'serie invalida'; END IF;
  IF p_serie = 'carte_tehnica' AND p_origine IS DISTINCT FROM 'import' THEN RAISE EXCEPTION 'seria carte tehnica e doar la import'; END IF;
  IF p_an IS NULL OR p_an < 2000 OR p_an > v_an_azi THEN RAISE EXCEPTION 'an invalid: % (2000…%)', p_an, v_an_azi; END IF;
  IF p_numar IS NOT NULL AND (p_numar < 1 OR p_numar > 99999) THEN RAISE EXCEPTION 'numar invalid: % (1…99999)', p_numar; END IF;
  IF coalesce(p_sufix, '') <> '' AND p_origine IS DISTINCT FROM 'import' THEN RAISE EXCEPTION 'sufix permis doar la import'; END IF;
  IF p_data_emitere IS NULL AND p_origine IS DISTINCT FROM 'import' THEN RAISE EXCEPTION 'data emiterii e obligatorie'; END IF;
  IF p_data_emitere IS NOT NULL THEN
    IF p_data_emitere > public._hr_azi() THEN RAISE EXCEPTION 'data emiterii % e in viitor', to_char(p_data_emitere, 'DD.MM.YYYY'); END IF;
    IF extract(year FROM p_data_emitere) <> p_an THEN RAISE EXCEPTION 'anul % nu e anul datei emiterii (%)', p_an, to_char(p_data_emitere, 'DD.MM.YYYY'); END IF;
  END IF;
END $f$;

-- Mod de validare ales pe server (J2-2): REVOCARE → revocare; altfel operația RPC-ului.
CREATE FUNCTION public._hr_decizie_mod(p_tip_cod text, p_operatie text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
BEGIN
  IF p_operatie NOT IN ('emitere','rezervare','import') THEN RAISE EXCEPTION 'operatie necunoscuta: %', p_operatie; END IF;
  IF p_tip_cod = 'REVOCARE' THEN RETURN 'revocare'; END IF;
  RETURN p_operatie;
END $f$;

-- Jurnal (insert) — folosit doar din funcțiile SECURITY DEFINER.
CREATE FUNCTION public._hr_ev(p_decizie_id bigint, p_eveniment text, p_veche text, p_noua text, p_detalii jsonb,
                              p_serie text DEFAULT NULL, p_an int DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  INSERT INTO public.hr_decizii_evenimente (decizie_id, serie, an, eveniment, stare_veche, stare_noua, de, detalii)
  VALUES (p_decizie_id, p_serie, p_an, p_eveniment, p_veche, p_noua, auth.uid(), p_detalii)
$f$;

-- Forma afișată a numărului: „916/28.09.2026”, „912-bis/28.09.2026”, „391/2025 (seria carte tehnica)” (J3-7).
CREATE FUNCTION public._hr_nr_afisat(p_serie text, p_an int, p_numar int, p_sufix text, p_data date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$
  SELECT CASE WHEN p_numar IS NULL THEN NULL ELSE
    p_numar::text || CASE WHEN coalesce(p_sufix, '') <> '' THEN '-' || p_sufix ELSE '' END
    || '/' || CASE WHEN p_data IS NOT NULL THEN to_char(p_data, 'DD.MM.YYYY') ELSE p_an::text END
    || CASE WHEN p_serie = 'carte_tehnica' THEN ' (seria carte tehnica)' ELSE '' END END
$f$;

-- ─── 3. Intrări, context, avertismente, randare, eligibilitate (§3.6, §4.A.2, §5) ──────────────────────
CREATE FUNCTION public._hr_nume_afis(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULL ELSE initcap(lower(btrim(regexp_replace(p, '[[:space:]]+', ' ', 'g')))) END $f$;

-- Singura citire a intrărilor mutabile (P2-1, J2-5). p_r = rândul deciziei (din tabel, sau construit în memorie la rezervare).
-- Cu p_blocheaza ia lock-urile în ordinea fixă §3.8: ținta (UPDATE) → semnatar (SHARE) → împuternicire (SHARE) →
-- angajat → atestat → proiect → tip (SHARE). Decizia însăși o blochează apelantul. Fără date din registrul anului (V2-1).
CREATE FUNCTION public._hr_decizie_intrari_rand(p_r public.hr_decizii, p_blocheaza boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  v_tinta_id bigint := coalesce(p_r.inlocuieste_id, p_r.revoca_id);
  t public.hr_decizii; v_tinta jsonb; s public.hr_decizii_semnatari; v_sem jsonb; i public.hr_decizii; v_imp jsonb;
  v_emp jsonb; v_at jsonb; v_pr jsonb; v_tip jsonb; v_dom jsonb; v_tinta_emp jsonb;
BEGIN
  -- 2.2 ținta
  IF v_tinta_id IS NOT NULL THEN
    IF p_blocheaza THEN SELECT * INTO t FROM public.hr_decizii WHERE id = v_tinta_id FOR UPDATE;
    ELSE SELECT * INTO t FROM public.hr_decizii WHERE id = v_tinta_id; END IF;
    IF FOUND THEN
      SELECT jsonb_build_object('activ', coalesce(e.active, false), 'termination_date', e.termination_date)
        INTO v_tinta_emp FROM public.employees e WHERE e.id = t.employee_id;
      v_tinta := jsonb_build_object(
        'id', t.id, 'serie', t.serie, 'an', t.an, 'numar', t.numar, 'numar_sufix', t.numar_sufix,
        'data_emitere', t.data_emitere, 'titlu', t.titlu, 'tip_cod', t.tip_cod, 'nivel', t.nivel, 'proiect_id', t.proiect_id,
        'stare', t.stare, 'employee_id', t.employee_id, 'persoana_nume', t.persoana_nume, 'eticheta_functie', t.eticheta_functie,
        'nume', coalesce(t.snapshot->'persoana'->>'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = t.employee_id)), t.persoana_nume),
        'nr_afisat', public._hr_nr_afisat(t.serie, t.an, t.numar, t.numar_sufix, t.data_emitere),
        'angajat', v_tinta_emp,
        'relatie_alta', EXISTS (SELECT 1 FROM public.hr_decizii x WHERE coalesce(x.inlocuieste_id, x.revoca_id) = t.id
                                  AND x.stare NOT IN ('draft','anulata') AND x.id IS DISTINCT FROM p_r.id));
    END IF;
  END IF;
  -- 2.3 semnatarul; legătura împuternicirii se citește DIN rândul blocat (J3-3)
  IF p_r.semnatar_id IS NOT NULL THEN
    IF p_blocheaza THEN SELECT * INTO s FROM public.hr_decizii_semnatari WHERE id = p_r.semnatar_id FOR SHARE;
    ELSE SELECT * INTO s FROM public.hr_decizii_semnatari WHERE id = p_r.semnatar_id; END IF;
    IF FOUND THEN
      v_sem := jsonb_build_object('id', s.id, 'employee_id', s.employee_id, 'calitate', s.calitate,
        'este_reprezentant_legal', s.este_reprezentant_legal, 'preambul_text', s.preambul_text, 'bloc_semnatura', s.bloc_semnatura,
        'preambul_validat', s.preambul_validat, 'imputernicire_decizie_id', s.imputernicire_decizie_id, 'activ', s.activ,
        'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = s.employee_id)));
      -- 2.4 decizia de împuternicire
      IF s.imputernicire_decizie_id IS NOT NULL THEN
        IF p_blocheaza THEN SELECT * INTO i FROM public.hr_decizii WHERE id = s.imputernicire_decizie_id FOR SHARE;
        ELSE SELECT * INTO i FROM public.hr_decizii WHERE id = s.imputernicire_decizie_id; END IF;
        IF FOUND THEN
          v_imp := jsonb_build_object('id', i.id, 'tip_cod', i.tip_cod, 'stare', i.stare, 'are_scan', i.scan_path IS NOT NULL,
            'serie', i.serie, 'an', i.an, 'numar', i.numar, 'numar_sufix', i.numar_sufix, 'data_emitere', i.data_emitere);
        END IF;
      END IF;
    END IF;
  END IF;
  -- 2.5 angajat, atestat, proiect, tip
  IF p_r.employee_id IS NOT NULL THEN
    IF p_blocheaza THEN PERFORM 1 FROM public.employees WHERE id = p_r.employee_id FOR SHARE; END IF;
    SELECT jsonb_build_object('id', e.id, 'name', e.name, 'nume', public._hr_nume_afis(e.name), 'activ', coalesce(e.active, false),
                              'termination_date', e.termination_date)
      INTO v_emp FROM public.employees e WHERE e.id = p_r.employee_id;
  END IF;
  IF p_r.autorizatie_id IS NOT NULL THEN
    IF p_blocheaza THEN PERFORM 1 FROM public.hr_autorizatii WHERE id = p_r.autorizatie_id FOR SHARE; END IF;
    SELECT jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'tip_cod', at.cod, 'numar', a.numar_autorizatie,
             'emitent', a.emitent, 'data_emitere', a.data_emitere, 'data_expirare', a.data_expirare,
             'fara_expirare', coalesce(a.fara_expirare, false), 'sters', a.deleted_at IS NOT NULL, 'inlocuit', a.inlocuita_de_id IS NOT NULL,
             'verificat_pe_scan', a.verificat_pe_scan, 'uploadat_de', a.uploadat_de,
             'domenii', to_jsonb(public._hr_norm_domenii_isc(a.domenii)))
      INTO v_at FROM public.hr_autorizatii a LEFT JOIN public.hr_autorizatii_tipuri at ON at.id = a.tip_id
     WHERE a.id = p_r.autorizatie_id;
  END IF;
  IF p_r.proiect_id IS NOT NULL THEN
    IF p_blocheaza THEN PERFORM 1 FROM public.executie_proiecte WHERE id = p_r.proiect_id FOR SHARE; END IF;
    SELECT jsonb_build_object('id', p.id, 'nume', p.nume, 'nr_contract', p.nr_contract, 'data_contract', p.data_contract,
             'beneficiar', p.beneficiar, 'data_termen', p.data_termen, 'activ', coalesce(p.activ, false))
      INTO v_pr FROM public.executie_proiecte p WHERE p.id = p_r.proiect_id;
  END IF;
  IF p_blocheaza THEN PERFORM 1 FROM public.hr_decizii_tipuri WHERE cod = p_r.tip_cod FOR SHARE; END IF;
  SELECT to_jsonb(x) INTO v_tip FROM public.hr_decizii_tipuri x WHERE x.cod = p_r.tip_cod;
  -- denumirile ISC ale domeniilor cerute (J3-2): „8.4D” → rândul „8.4”
  SELECT coalesce(jsonb_object_agg(c.x, d.denumire), '{}'::jsonb) INTO v_dom
    FROM unnest(coalesce(p_r.domenii_isc, '{}')) c(x)
    JOIN public.isc_rte_domenii d ON d.cod = regexp_replace(c.x, '[DT]$', '');
  RETURN jsonb_build_object(
    'decizie', jsonb_build_object('id', p_r.id, 'versiune', p_r.versiune, 'tip_cod', p_r.tip_cod, 'eticheta_functie', p_r.eticheta_functie,
       'nivel', p_r.nivel, 'employee_id', p_r.employee_id, 'persoana_nume', p_r.persoana_nume, 'proiect_id', p_r.proiect_id,
       'proiect_denumire', p_r.proiect_denumire, 'autorizatie_id', p_r.autorizatie_id, 'domenii_isc', to_jsonb(coalesce(p_r.domenii_isc, '{}')),
       'titlu', p_r.titlu, 'temei', p_r.temei, 'data_emitere', p_r.data_emitere, 'data_efect', p_r.data_efect,
       'data_efect_pana', p_r.data_efect_pana, 'semnatar_id', p_r.semnatar_id, 'luare_la_cunostinta', p_r.luare_la_cunostinta,
       'propune_efect', p_r.propune_efect, 'inlocuieste_id', p_r.inlocuieste_id, 'revoca_id', p_r.revoca_id,
       'descriere', p_r.descriere, 'origine', p_r.origine),
    'tip', v_tip, 'angajat', v_emp, 'atestat', v_at, 'proiect', v_pr, 'semnatar', v_sem, 'imputernicire', v_imp,
    'tinta', v_tinta, 'domenii_den', v_dom);
END $f$;

CREATE FUNCTION public._hr_decizie_intrari(p_id bigint, p_blocheaza boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r public.hr_decizii;
BEGIN
  SELECT * INTO r FROM public.hr_decizii WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  RETURN public._hr_decizie_intrari_rand(r, p_blocheaza);
END $f$;

-- Context informativ pentru G2/G7 (J3-2): fără lock, în afara hash-ului.
CREATE FUNCTION public._hr_decizie_context(p_in jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE d jsonb := p_in->'decizie'; v_g2 jsonb; v_g7 boolean := false; v_dom text[];
BEGIN
  SELECT array_agg(x) INTO v_dom FROM jsonb_array_elements_text(coalesce(d->'domenii_isc', '[]')) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nr', public._hr_nr_afisat(c.serie, c.an, c.numar, c.numar_sufix, c.data_emitere))), '[]')
    INTO v_g2
    FROM public.hr_decizii c JOIN public.hr_decizii_tipuri ct ON ct.cod = c.tip_cod
   WHERE c.stare IN ('emisa','semnata') AND c.tip_cod = d->>'tip_cod' AND c.tip_cod NOT IN ('REVOCARE','ALTA_DECIZIE')
     AND ct.unic_activ AND c.id IS DISTINCT FROM (d->>'id')::bigint
     AND c.employee_id IS DISTINCT FROM (d->>'employee_id')::int
     AND (c.data_efect_pana IS NULL OR c.data_efect_pana >= public._hr_azi())
     AND CASE WHEN d->>'nivel' = 'proiect'
              THEN c.nivel = 'proiect' AND c.proiect_id = (d->>'proiect_id')::bigint
                   AND (NOT coalesce((p_in->'tip'->>'necesita_domeniu_isc')::boolean, false) OR coalesce(c.domenii_isc, '{}') && coalesce(v_dom, '{}'))
              ELSE c.nivel = 'firma' END;
  IF d->>'tip_cod' = 'RTE' AND d->>'nivel' = 'proiect' AND NOT coalesce((d->>'propune_efect')::boolean, true) THEN
    v_g7 := EXISTS (SELECT 1 FROM public.hr_decizii c
                     WHERE c.stare IN ('emisa','semnata') AND c.tip_cod = 'RTE' AND c.proiect_id = (d->>'proiect_id')::bigint
                       AND c.id IS DISTINCT FROM (d->>'id')::bigint AND NOT (coalesce(c.domenii_isc, '{}') && coalesce(v_dom, '{}')));
  END IF;
  RETURN jsonb_build_object('g2', v_g2, 'g7', v_g7);
END $f$;

-- Avertismentele (§4.A.2) din structurile primite, fără citiri de tabele (P2-1). p_mod obligatoriu (J2-2).
CREATE FUNCTION public._hr_decizie_avertismente(p_in jsonb, p_ctx jsonb, p_numar int, p_mod text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE
  d jsonb := p_in->'decizie'; tip jsonb := p_in->'tip'; e jsonb := p_in->'angajat'; a jsonb := p_in->'atestat';
  p jsonb := p_in->'proiect'; s jsonb := p_in->'semnatar'; i jsonb := p_in->'imputernicire'; t jsonb := p_in->'tinta';
  v_out jsonb := '[]'; v_azi date := public._hr_azi();
  v_de date := (d->>'data_emitere')::date; v_ef date := (d->>'data_efect')::date;
  v_emp int := (d->>'employee_id')::int; v_tpl text; v_alta boolean := d->>'tip_cod' = 'ALTA_DECIZIE';
  v_cerute text[]; v_aut text[]; v_r4 boolean; v_lipsa text[] := '{}';
BEGIN
  IF p_mod NOT IN ('emitere','revocare','rezervare','import') THEN RAISE EXCEPTION 'mod de validare invalid: %', p_mod; END IF;
  IF tip IS NULL THEN RAISE EXCEPTION 'tip de decizie inexistent: %', d->>'tip_cod'; END IF;
  v_tpl := CASE WHEN d->>'nivel' = 'proiect' THEN tip->>'art1_proiect' ELSE tip->>'art1_firma' END;
  SELECT array_agg(x) INTO v_cerute FROM jsonb_array_elements_text(coalesce(d->'domenii_isc', '[]')) x;
  SELECT array_agg(x) INTO v_aut FROM jsonb_array_elements_text(coalesce(a->'domenii', '[]')) x;

  -- B1 (emitere, rezervare numire)
  IF p_mod IN ('emitere','rezervare') AND NOT v_alta AND s IS NOT NULL
     AND NOT coalesce((s->>'este_reprezentant_legal')::boolean, false) AND (s->>'employee_id')::int = v_emp THEN
    v_out := v_out || jsonb_build_object('cod','B1','nivel','B','mesaj','Semnatarul imputernicit nu-si poate semna propria numire');
  END IF;
  -- B2
  IF p_mod = 'emitere' AND e IS NOT NULL AND (NOT coalesce((e->>'activ')::boolean, false)
       OR (e->>'termination_date' IS NOT NULL AND (e->>'termination_date')::date < coalesce(v_ef, v_de))) THEN
    v_out := v_out || jsonb_build_object('cod','B2','nivel','B','mesaj','Angajatul e inactiv sau incetat inainte de data efectului');
  END IF;
  -- B3
  IF p_mod IN ('emitere','revocare','rezervare') AND v_de IS NOT NULL
     AND (v_de > v_azi OR (extract(year FROM v_de) <> extract(year FROM v_azi) AND p_numar IS NULL)) THEN
    v_out := v_out || jsonb_build_object('cod','B3','nivel','B','mesaj','Data emiterii e in viitor sau anul e altul decat cel curent fara numar manual');
  END IF;
  -- B4
  IF p_mod IN ('emitere','rezervare','import') THEN
    IF NOT (tip->>'nivel' = 'ambele' OR tip->>'nivel' = d->>'nivel')
       OR (NOT v_alta AND d->>'tip_cod' <> 'REVOCARE'
           AND NOT (d->>'eticheta_functie' = tip->>'eticheta_functie'
                    OR d->>'eticheta_functie' IN (SELECT jsonb_array_elements_text(coalesce(tip->'etichete_alternative', '[]')))))
       OR (v_alta AND coalesce(btrim(d->>'descriere'), '') = '') THEN
      v_out := v_out || jsonb_build_object('cod','B4','nivel','B','mesaj','Nivelul sau eticheta nu sunt compatibile cu tipul');
    END IF;
  END IF;
  -- B5
  IF p_mod IN ('emitere','revocare') AND v_tpl LIKE '%{contract}%' AND coalesce(btrim(p->>'nr_contract'), '') = '' THEN
    v_out := v_out || jsonb_build_object('cod','B5','nivel','B','mesaj','Proiectul nu are numar de contract');
  END IF;
  -- B6
  IF p_mod = 'emitere' AND d->>'autorizatie_id' IS NOT NULL AND (a IS NULL
       OR (a->>'employee_id')::bigint IS DISTINCT FROM v_emp::bigint OR (a->>'sters')::boolean OR (a->>'inlocuit')::boolean
       OR (tip->'autorizatie_tipuri' IS NOT NULL AND jsonb_typeof(tip->'autorizatie_tipuri') = 'array'
           AND NOT (tip->'autorizatie_tipuri') ? coalesce(a->>'tip_cod', ''))) THEN
    v_out := v_out || jsonb_build_object('cod','B6','nivel','B','mesaj','Atestatul ales nu e al angajatului, e sters/inlocuit sau are alt tip');
  END IF;
  -- B9
  IF p_mod IN ('emitere','revocare') AND (d->>'inlocuieste_id' IS NOT NULL OR d->>'revoca_id' IS NOT NULL) THEN
    IF t IS NULL OR t->>'stare' <> 'semnata' OR coalesce((t->>'relatie_alta')::boolean, true)
       OR t->>'tip_cod' IN ('REVOCARE','ALTA_DECIZIE') OR v_ef > v_de
       OR (d->>'inlocuieste_id' IS NOT NULL AND (t->>'tip_cod' IS DISTINCT FROM d->>'tip_cod' OR t->>'nivel' IS DISTINCT FROM d->>'nivel'
            OR t->>'proiect_id' IS DISTINCT FROM d->>'proiect_id')) THEN
      v_out := v_out || jsonb_build_object('cod','B9','nivel','B','mesaj','Tinta nu poate fi inlocuita/revocata (nesemnata, alta relatie vie, nu e numire, efect viitor sau alt tip/nivel/proiect)');
    END IF;
  END IF;
  -- B10
  IF p_mod = 'emitere' THEN
    IF v_emp IS NULL THEN v_lipsa := v_lipsa || 'angajat'; END IF;
    IF d->>'titlu' IS NULL THEN v_lipsa := v_lipsa || 'titlu'; END IF;
    IF v_de IS NULL THEN v_lipsa := v_lipsa || 'data emiterii'; END IF;
    IF v_ef IS NULL THEN v_lipsa := v_lipsa || 'data efectului'; END IF;
    IF d->>'semnatar_id' IS NULL OR s IS NULL THEN v_lipsa := v_lipsa || 'semnatar'; END IF;
    IF d->>'nivel' = 'proiect' AND (p IS NULL OR coalesce(btrim(d->>'proiect_denumire'), '') = '') THEN v_lipsa := v_lipsa || 'proiect'; END IF;
    IF coalesce((tip->>'necesita_domeniu_isc')::boolean, false) AND cardinality(coalesce(v_cerute, '{}')) = 0 THEN v_lipsa := v_lipsa || 'domenii ISC'; END IF;
    IF v_tpl LIKE '%{temei}%' AND coalesce(btrim(d->>'temei'), '') = '' THEN v_lipsa := v_lipsa || 'temei'; END IF;
  ELSIF p_mod = 'revocare' THEN
    IF d->>'titlu' IS NULL THEN v_lipsa := v_lipsa || 'titlu'; END IF;
    IF v_de IS NULL THEN v_lipsa := v_lipsa || 'data emiterii'; END IF;
    IF v_ef IS NULL THEN v_lipsa := v_lipsa || 'data efectului'; END IF;
    IF d->>'semnatar_id' IS NULL OR s IS NULL THEN v_lipsa := v_lipsa || 'semnatar'; END IF;
    IF v_emp IS NULL AND coalesce(btrim(d->>'persoana_nume'), '') = '' THEN v_lipsa := v_lipsa || 'persoana'; END IF;
    IF t IS NULL THEN v_lipsa := v_lipsa || 'tinta'; END IF;
  ELSIF p_mod = 'rezervare' AND NOT v_alta THEN
    IF v_emp IS NULL AND coalesce(btrim(d->>'persoana_nume'), '') = '' THEN v_lipsa := v_lipsa || 'persoana'; END IF;
    IF d->>'semnatar_id' IS NULL OR s IS NULL THEN v_lipsa := v_lipsa || 'semnatar'; END IF;
  END IF;
  IF cardinality(v_lipsa) > 0 THEN
    v_out := v_out || jsonb_build_object('cod','B10','nivel','B','mesaj','Campuri obligatorii lipsa: ' || array_to_string(v_lipsa, ', '));
  END IF;
  -- B11 (nu la import; la revocare tipul e REVOCARE, nu tipul țintei — Vr4-3)
  IF p_mod IN ('emitere','revocare','rezervare')
     AND (NOT coalesce((tip->>'activ')::boolean, false) OR (NOT v_alta AND s IS NOT NULL AND NOT coalesce((s->>'activ')::boolean, false))) THEN
    v_out := v_out || jsonb_build_object('cod','B11','nivel','B','mesaj','Semnatarul sau tipul deciziei e inactiv');
  END IF;

  -- R1–R3 (doar emitere numire)
  IF p_mod = 'emitere' THEN
    IF tip->>'autorizatie_ceruta' = 'obligatorie' AND a IS NULL THEN
      v_out := v_out || jsonb_build_object('cod','R1','nivel','R','mesaj','Atestat obligatoriu lipsa');
    END IF;
    IF a IS NOT NULL AND NOT coalesce((a->>'fara_expirare')::boolean, false)
       AND (a->>'data_expirare' IS NULL OR (a->>'data_expirare')::date < coalesce(v_ef, v_de)) THEN
      v_out := v_out || jsonb_build_object('cod','R2','nivel','R','mesaj','Atestatul e expirat la data efectului');
    END IF;
    IF coalesce((tip->>'necesita_domeniu_isc')::boolean, false) AND a IS NOT NULL AND cardinality(coalesce(v_cerute, '{}')) > 0
       AND NOT public._hr_acopera_domeniu(v_cerute, v_aut) THEN
      v_out := v_out || jsonb_build_object('cod','R3','nivel','R','mesaj','Domeniul cerut nu e acoperit de atestat');
    END IF;
  END IF;
  -- R4 (o singură formulă, VA2/P1-4)
  IF p_mod IN ('emitere','revocare','rezervare') AND NOT v_alta AND s IS NOT NULL
     AND NOT coalesce((s->>'este_reprezentant_legal')::boolean, false) THEN
    v_r4 := i IS NULL OR i->>'tip_cod' <> 'ALTA_DECIZIE' OR i->>'stare' <> 'semnata' OR NOT coalesce((i->>'are_scan')::boolean, false)
            OR i->>'data_emitere' IS NULL OR v_de IS NULL OR (i->>'data_emitere')::date > v_de
            OR NOT coalesce((s->>'preambul_validat')::boolean, false);
    IF v_r4 THEN
      v_out := v_out || jsonb_build_object('cod','R4','nivel','R','mesaj','Semnatarul nu e reprezentant legal, iar imputernicirea nu e inregistrata sau preambulul nu e validat juridic');
    END IF;
  END IF;
  -- R5 (J3-5)
  IF p_mod IN ('emitere','revocare') AND (tip->>'temei_sursa' = 'propunere' OR d->>'data_efect_pana' IS NOT NULL OR d->>'inlocuieste_id' IS NOT NULL) THEN
    v_out := v_out || jsonb_build_object('cod','R5','nivel','R','mesaj','Text nevalidat juridic: '
      || array_to_string(array_remove(ARRAY[
           CASE WHEN tip->>'temei_sursa' = 'propunere' THEN 'temeiul/articolul tipului' END,
           CASE WHEN d->>'data_efect_pana' IS NOT NULL THEN 'articolul de termen' END,
           CASE WHEN d->>'inlocuieste_id' IS NOT NULL THEN 'articolul de inlocuire' END], NULL), ', '));
  END IF;
  -- R6
  IF p_mod IN ('emitere','revocare','rezervare') AND v_de IS NOT NULL AND extract(year FROM v_de) <> extract(year FROM v_azi) THEN
    v_out := v_out || jsonb_build_object('cod','R6','nivel','R','mesaj','Anul emiterii e altul decat anul curent');
  END IF;

  -- Galbene
  IF p_mod = 'emitere' THEN
    IF a IS NOT NULL AND NOT coalesce((a->>'fara_expirare')::boolean, false) AND p->>'data_termen' IS NOT NULL
       AND a->>'data_expirare' IS NOT NULL AND (a->>'data_expirare')::date < (p->>'data_termen')::date THEN
      v_out := v_out || jsonb_build_object('cod','G1','nivel','G','mesaj','Atestatul expira inainte de termenul proiectului');
    END IF;
    IF jsonb_array_length(coalesce(p_ctx->'g2', '[]')) > 0 THEN
      v_out := v_out || jsonb_build_object('cod','G2','nivel','G','mesaj','Exista deja o decizie curenta pe acelasi tip pentru alta persoana', 'decizii', p_ctx->'g2');
    END IF;
    IF d->>'nivel' = 'proiect' AND p IS NOT NULL AND p->>'data_contract' IS NULL THEN
      v_out := v_out || jsonb_build_object('cod','G4','nivel','G','mesaj','Proiectul nu are data contractului');
    END IF;
    IF s IS NOT NULL AND coalesce((s->>'este_reprezentant_legal')::boolean, false) AND (s->>'employee_id')::int = v_emp THEN
      v_out := v_out || jsonb_build_object('cod','G5','nivel','G','mesaj','Reprezentantul legal se numeste pe sine');
    END IF;
    IF d->>'tip_cod' = 'RSVTI' AND v_emp IS DISTINCT FROM 81 THEN
      v_out := v_out || jsonb_build_object('cod','G6','nivel','G','mesaj','RSVTI diferit de cel din Adeverinte (81)');
    END IF;
    IF coalesce((p_ctx->>'g7')::boolean, false) THEN
      v_out := v_out || jsonb_build_object('cod','G7','nivel','G','mesaj','Exista un RTE activ pe alt domeniu; efectul pe echipa nu se propune');
    END IF;
    IF a IS NOT NULL AND NOT coalesce((a->>'verificat_pe_scan')::boolean, false) THEN
      v_out := v_out || jsonb_build_object('cod','G9','nivel','G','mesaj','Atestatul nu e verificat pe scan');
    END IF;
    IF d->>'temei' IS DISTINCT FROM tip->>'temei_implicit' OR tip->>'temei_sursa' = 'model_nas' THEN
      v_out := v_out || jsonb_build_object('cod','G10','nivel','G','mesaj','Temeiul difera de cel implicit sau nu e validat juridic');
    END IF;
  ELSIF p_mod = 'revocare' THEN
    IF s IS NOT NULL AND NOT coalesce((s->>'este_reprezentant_legal')::boolean, false)
       AND (s->>'employee_id')::int = (t->>'employee_id')::int THEN
      v_out := v_out || jsonb_build_object('cod','G11','nivel','G','mesaj','Semnatarul imputernicit revoca propria numire');
    END IF;
    IF t IS NOT NULL AND (t->>'employee_id' IS NULL OR NOT coalesce((t->'angajat'->>'activ')::boolean, false)) THEN
      v_out := v_out || jsonb_build_object('cod','G12','nivel','G','mesaj','Persoana din tinta e inactiva sau externa');
    END IF;
  END IF;
  RETURN v_out;
END $f$;

-- Randarea (§5, P2-1): numai din structura primită; p_numar NULL = rezerva de lățime maximă „99999-bis” (J20).
CREATE FUNCTION public._hr_decizie_randeaza(p_in jsonb, p_numar int, p_data date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE
  d jsonb := p_in->'decizie'; tip jsonb := p_in->'tip'; e jsonb := p_in->'angajat'; a jsonb := p_in->'atestat';
  p jsonb := p_in->'proiect'; s jsonb := p_in->'semnatar'; i jsonb := p_in->'imputernicire'; t jsonb := p_in->'tinta';
  v_vars jsonb; v_imp text; v_dom text; v_cod text; v_den text; v_n int := 0; v_art jsonb := '[]';
  v_coduri text[]; v_part text[] := '{}'; v_tpl text; v_rev boolean := d->>'tip_cod' = 'REVOCARE';
  v_de date := (d->>'data_emitere')::date; v_ef date := (d->>'data_efect')::date; v_pana date := (d->>'data_efect_pana')::date;
BEGIN
  IF NOT coalesce((tip->>'are_sablon')::boolean, false) THEN RAISE EXCEPTION 'tipul % nu are sablon (doar rezervare/import)', d->>'tip_cod'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'randare fara data emiterii'; END IF;
  SELECT array_agg(x) INTO v_coduri FROM jsonb_array_elements_text(coalesce(d->'domenii_isc', '[]')) x;
  FOREACH v_cod IN ARRAY coalesce(v_coduri, '{}') LOOP
    v_den := translate(coalesce(p_in->'domenii_den'->>v_cod, ''), 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaisstsAAISSTT');
    v_part := v_part || (regexp_replace(v_cod, '^8[.]4([DT])$', '8.4 (\1)')
                         || CASE WHEN v_den <> '' THEN CASE WHEN cardinality(v_coduri) = 1 THEN ' – ' ELSE ' - ' END || v_den ELSE '' END);
  END LOOP;
  IF cardinality(v_part) = 1 THEN v_dom := 'domeniul ' || v_part[1];
  ELSIF cardinality(v_part) > 1 THEN v_dom := 'domeniile: ' || array_to_string(v_part, '; '); END IF;
  IF i IS NOT NULL AND i->>'tip_cod' = 'ALTA_DECIZIE' AND i->>'stare' = 'semnata' AND coalesce((i->>'are_scan')::boolean, false)
     AND i->>'data_emitere' IS NOT NULL AND (i->>'data_emitere')::date <= p_data THEN
    v_imp := 'Imputernicirea nr. ' || public._hr_nr_afisat(i->>'serie', (i->>'an')::int, (i->>'numar')::int, i->>'numar_sufix', (i->>'data_emitere')::date);
  END IF;
  v_vars := jsonb_strip_nulls(jsonb_build_object(
    'data_efect', to_char(v_ef, 'DD.MM.YYYY'),
    'titlu', d->>'titlu',
    'pe_titlu', CASE d->>'titlu' WHEN 'Dl.' THEN 'pe domnul' WHEN 'D-na' THEN 'pe doamna' END,
    'numit_a', CASE d->>'titlu' WHEN 'Dl.' THEN 'numit' WHEN 'D-na' THEN 'numita' END,
    'nume', coalesce(e->>'nume', d->>'persoana_nume'),
    'functie', d->>'eticheta_functie',
    'proiect', d->>'proiect_denumire',
    'contract', CASE WHEN coalesce(btrim(p->>'nr_contract'), '') <> '' THEN
                  btrim(p->>'nr_contract') || CASE WHEN p->>'data_contract' IS NOT NULL THEN '/' || to_char((p->>'data_contract')::date, 'DD.MM.YYYY') ELSE '' END END,
    'domenii', v_dom,
    'aut_nr', a->>'numar',
    'aut_data', to_char((a->>'data_emitere')::date, 'DD.MM.YYYY'),
    'aut_emitent', a->>'emitent',
    'aut_expirare', CASE WHEN NOT coalesce((a->>'fara_expirare')::boolean, false) THEN to_char((a->>'data_expirare')::date, 'DD.MM.YYYY') END,
    'temei', d->>'temei',
    'nr_tinta', t->>'nr_afisat',
    'functie_tinta', t->>'eticheta_functie',
    'nume_tinta', t->>'nume',
    'titlu_tinta', t->>'titlu',
    'data_efect_pana', to_char(v_pana, 'DD.MM.YYYY')));
  v_tpl := CASE WHEN d->>'nivel' = 'proiect' THEN tip->>'art1_proiect' ELSE tip->>'art1_firma' END;
  IF v_tpl IS NULL THEN RAISE EXCEPTION 'tipul % nu are articolul 1 pe nivelul %', d->>'tip_cod', d->>'nivel'; END IF;
  v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text', public._hr_sablon(v_tpl, v_vars));
  IF d->>'inlocuieste_id' IS NOT NULL THEN
    v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text', public._hr_sablon(
      'Prezenta decizie inlocuieste Decizia nr. {nr_tinta} privind numirea [[{titlu_tinta} ]]{nume_tinta} in functia de {functie_tinta}, care isi inceteaza efectele incepand cu data de {data_efect}.', v_vars));
  END IF;
  IF NOT v_rev THEN
    v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text', 'Atributiile legate de aceasta functie sunt cele prevazute in Fisa Postului.');
    IF d->>'nivel' = 'proiect' THEN
      v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text', CASE WHEN v_pana IS NOT NULL
        THEN public._hr_sablon('Aceasta decizie isi pastreaza valabilitatea pana la data de {data_efect_pana}.', v_vars)
        ELSE coalesce(tip->>'art_valabilitate_proiect', 'Aceasta decizie isi pastreaza valabilitatea pana la receptia definitiva a lucrarii.') END);
    ELSIF v_pana IS NOT NULL THEN
      v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text', public._hr_sablon('Prezenta decizie isi produce efectele pana la data de {data_efect_pana}.', v_vars));
    END IF;
  END IF;
  v_n := v_n + 1; v_art := v_art || jsonb_build_object('nr', v_n, 'text',
    'Prezenta decizie se comunica salariatului si va fi dusa la indeplinire prin intermediul Departamentului Personal.');
  RETURN jsonb_build_object(
    'titlu', 'DECIZIA NR',
    'nr', CASE WHEN p_numar IS NULL THEN '99999-bis/' || to_char(p_data, 'DD.MM.YYYY') ELSE p_numar::text || '/' || to_char(p_data, 'DD.MM.YYYY') END,
    'previzualizare', p_numar IS NULL,
    'preambul', public._hr_sablon(s->>'preambul_text', jsonb_strip_nulls(jsonb_build_object('imputernicire', v_imp))),
    'decide', 'DECIDE:',
    'articole', v_art,
    'bloc_semnatura', public._hr_sablon(s->>'bloc_semnatura', '{}'::jsonb),
    'luare_la_cunostinta', CASE WHEN coalesce((d->>'luare_la_cunostinta')::boolean, false) THEN 'ANGAJAT,' || chr(10) || 'am luat la cunostinta' END);
END $f$;

-- Eligibilitatea efectului (§2.8; J6, J8, J9): NULL = eligibilă, altfel motivul.
CREATE FUNCTION public._hr_decizie_motiv_neeligibil(p_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE d public.hr_decizii; tip public.hr_decizii_tipuri; s public.hr_decizii_semnatari; v_activ boolean;
BEGIN
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'decizie inexistenta'; END IF;
  SELECT * INTO tip FROM public.hr_decizii_tipuri WHERE cod = d.tip_cod;
  IF d.stare <> 'semnata' THEN RETURN 'decizia nu e semnata'; END IF;
  IF d.tip_cod IN ('REVOCARE','ALTA_DECIZIE') THEN RETURN 'nu e o numire'; END IF;
  IF NOT d.propune_efect THEN RETURN 'fara efect pe echipa (propune_efect = false)'; END IF;
  IF d.employee_id IS NULL THEN RETURN 'extern'; END IF;
  IF d.nivel <> 'proiect' THEN RETURN 'decizie pe firma'; END IF;
  IF tip.camp_efect IS NULL OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass
                                             AND attname = tip.camp_efect AND NOT attisdropped) THEN
    RETURN 'tipul nu are camp de efect';
  END IF;
  SELECT p.activ INTO v_activ FROM public.executie_proiecte p WHERE p.id = d.proiect_id;
  IF NOT coalesce(v_activ, false) THEN RETURN 'proiect inactiv'; END IF;
  IF d.data_efect_pana IS NOT NULL AND d.data_efect_pana < public._hr_azi() THEN RETURN 'decizie expirata'; END IF;
  IF d.origine IN ('platforma','rezervare') THEN
    SELECT * INTO s FROM public.hr_decizii_semnatari WHERE id = d.semnatar_id;
    IF FOUND AND NOT s.este_reprezentant_legal AND s.employee_id = d.employee_id THEN RETURN 'B1: semnatarul imputernicit pe propria numire'; END IF;
  END IF;
  RETURN NULL;
END $f$;

CREATE FUNCTION public._hr_decizie_eligibila_efect(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT public._hr_decizie_motiv_neeligibil(p_id) IS NULL $f$;

-- Valoarea curentă a unui câmp de echipă, fără SQL dinamic (to_jsonb pe rând; câmpul nu e scris literal, C40/20261017a).
CREATE FUNCTION public._hr_valoare_camp(p_proiect_id bigint, p_camp text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT to_jsonb(p)->>p_camp FROM public.executie_proiecte p WHERE p.id = p_proiect_id $f$;

-- Scrierea unui câmp de proiect (mutată din fn_completare_aplica; INTERNĂ, fără EXECUTE pentru authenticated).
CREATE FUNCTION public._completare_scrie_camp(p_proiect_id bigint, p_camp text, p_valoare text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_sql text;
BEGIN
  IF p_camp NOT IN ('rte_employee_id','rts_employee_id','mp_employee_id','coordonator_transgaz','garantie_buna_exec_pct','penalitati_zi_pct',
                    'valoare_lei','valoare_eur','data_start','data_termen','durata_contract_luni','nr_contract','data_contract','beneficiar_final','lungime_proiect_m') THEN
    RAISE EXCEPTION 'câmp nepermis: %', p_camp;
  END IF;
  v_sql := format('UPDATE public.executie_proiecte SET %I = $1::%s, updated_at = now() WHERE id = $2', p_camp,
    CASE WHEN p_camp LIKE '%employee_id' OR p_camp = 'durata_contract_luni' THEN 'int'
         WHEN p_camp LIKE 'data_%' THEN 'date'
         WHEN p_camp IN ('garantie_buna_exec_pct','penalitati_zi_pct','valoare_lei','valoare_eur','lungime_proiect_m') THEN 'numeric'
         ELSE 'text' END);
  EXECUTE v_sql USING p_valoare, p_proiect_id;
END $f$;

-- Golirea câmpului la revocare (P3-2): doar dacă valoarea e încă persoana revocată. Întoarce numărul de rânduri.
CREATE FUNCTION public._completare_goleste_camp(p_proiect_id bigint, p_camp text, p_employee_id int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE n int;
BEGIN
  IF p_camp NOT IN ('rte_employee_id','rts_employee_id','mp_employee_id') THEN RAISE EXCEPTION 'câmp nepermis: %', p_camp; END IF;
  EXECUTE format('UPDATE public.executie_proiecte SET %I = NULL, updated_at = now() WHERE id = $1 AND %I = $2', p_camp, p_camp)
    USING p_proiect_id, p_employee_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;

-- ─── 4. Numerotare și contor (§3.7, §3.6) ───────────────────────────────────────────────────────────────
CREATE FUNCTION public._hr_decizii_aloca(p_serie text, p_an int, p_numar int, p_numar_sufix text, p_confirm_salt boolean,
                                         p_origine text, p_data_emitere date)
RETURNS TABLE (numar int, sufix text, salt jsonb, g3 jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_suf text := public._hr_decizii_norm_sufix(p_numar_sufix); c public.hr_decizii_contor; v_n int; v_ocupat bigint;
        v_salt jsonb; v_g3 jsonb; v_max date;
BEGIN
  IF v_suf <> '' AND p_origine IS DISTINCT FROM 'import' THEN RAISE EXCEPTION 'sufix permis doar la import'; END IF;
  IF p_serie = 'carte_tehnica' THEN
    IF p_origine IS DISTINCT FROM 'import' OR p_numar IS NULL THEN RAISE EXCEPTION 'seria carte tehnica: doar import cu numar'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('hr_decizii:carte_tehnica:' || p_an || ':' || p_numar));
    SELECT d.id INTO v_ocupat FROM public.hr_decizii d
     WHERE d.serie = 'carte_tehnica' AND d.an = p_an AND d.numar = p_numar AND d.numar_sufix = v_suf;
    IF FOUND THEN RAISE EXCEPTION 'nr %/% (carte tehnica) e folosit de decizia #%', p_numar || CASE WHEN v_suf <> '' THEN '-' || v_suf ELSE '' END, p_an, v_ocupat; END IF;
    RETURN QUERY SELECT p_numar, v_suf, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF p_serie IS DISTINCT FROM 'HR' THEN RAISE EXCEPTION 'serie invalida'; END IF;
  INSERT INTO public.hr_decizii_contor (serie, an) VALUES ('HR', p_an) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
  IF p_numar IS NULL THEN
    IF NOT c.auto_permis THEN
      RAISE EXCEPTION 'numar automat oprit pentru %: initializeaza anul cu ultimul numar din registrul fizic', p_an;
    END IF;
    v_n := c.ultimul + 1;
    WHILE EXISTS (SELECT 1 FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = p_an AND d.numar = v_n) LOOP
      v_n := v_n + 1;
    END LOOP;
    IF v_n > 99999 THEN RAISE EXCEPTION 'registru epuizat pentru %', p_an; END IF;
  ELSE
    IF p_origine = 'import' THEN
      SELECT d.id INTO v_ocupat FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = p_an AND d.numar = p_numar AND d.numar_sufix = v_suf;
    ELSE
      SELECT d.id INTO v_ocupat FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = p_an AND d.numar = p_numar ORDER BY d.id LIMIT 1;
    END IF;
    IF v_ocupat IS NOT NULL THEN
      RAISE EXCEPTION 'nr %/% e folosit de decizia #%', p_numar || CASE WHEN v_suf <> '' THEN '-' || v_suf ELSE '' END, p_an, v_ocupat;
    END IF;
    IF p_origine IS DISTINCT FROM 'import' AND p_numar > c.ultimul + 20 THEN
      IF p_confirm_salt IS NOT TRUE THEN RAISE EXCEPTION 'salt_mare: % fata de ultimul %; confirma explicit', p_numar, c.ultimul; END IF;
      v_salt := jsonb_build_object('cod','R7','nivel','R','mesaj','Numar manual peste ultimul + 20','contor', c.ultimul, 'cerut', p_numar,
                                   'confirmat_de', auth.uid(), 'confirmat_la', now());
    END IF;
    v_n := p_numar;
  END IF;
  IF p_origine IS DISTINCT FROM 'import' AND p_data_emitere IS NOT NULL THEN
    SELECT max(d.data_emitere) INTO v_max FROM public.hr_decizii d
     WHERE d.serie = 'HR' AND d.an = p_an AND d.stare <> 'anulata' AND d.data_emitere > p_data_emitere;
    IF v_max IS NOT NULL THEN
      v_g3 := jsonb_build_object('cod','G3','nivel','G','mesaj','Data emiterii e anterioara ultimei decizii din registrul anului','ultima', v_max);
    END IF;
  END IF;
  UPDATE public.hr_decizii_contor SET ultimul = GREATEST(ultimul, v_n) WHERE serie = 'HR' AND an = p_an;
  RETURN QUERY SELECT v_n, v_suf, v_salt, v_g3;
END $f$;

CREATE FUNCTION public.fn_hr_decizii_urmatorul_numar(p_an int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c public.hr_decizii_contor; v_n int;
BEGIN
  IF public.fn_hr_decizii_poate('citire') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an;
  IF NOT FOUND OR NOT c.auto_permis THEN RETURN jsonb_build_object('numar', NULL, 'motiv', 'an neinitializat'); END IF;
  v_n := c.ultimul + 1;
  WHILE EXISTS (SELECT 1 FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = p_an AND d.numar = v_n) LOOP v_n := v_n + 1; END LOOP;
  RETURN jsonb_build_object('numar', CASE WHEN v_n <= 99999 THEN v_n END);
END $f$;

CREATE FUNCTION public._hr_contor_valideaza(p_an int, p_val int) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
BEGIN
  IF p_an IS NULL OR p_an < 2000 OR p_an > extract(year FROM public._hr_azi()) THEN RAISE EXCEPTION 'an invalid: %', p_an; END IF;
  IF p_val IS NULL OR p_val < 0 OR p_val > 99999 THEN RAISE EXCEPTION 'valoare invalida: % (0…99999)', p_val; END IF;
END $f$;

CREATE FUNCTION public.fn_hr_decizii_contor_initializeaza(p_an int, p_ultimul_fizic int, p_sursa text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c public.hr_decizii_contor; v_nou int;
BEGIN
  IF public.fn_hr_decizii_poate('contor') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  PERFORM public._hr_contor_valideaza(p_an, p_ultimul_fizic);
  IF coalesce(btrim(p_sursa), '') = '' THEN RAISE EXCEPTION 'sursa e obligatorie (cine a verificat registrul fizic si unde)'; END IF;
  INSERT INTO public.hr_decizii_contor (serie, an) VALUES ('HR', p_an) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
  IF c.auto_permis THEN RAISE EXCEPTION 'anul % e deja initializat cu numar automat pornit; foloseste corecteaza', p_an; END IF;
  v_nou := GREATEST(c.ultimul, p_ultimul_fizic);
  UPDATE public.hr_decizii_contor
     SET ultimul = v_nou, ultimul_initial = coalesce(ultimul_initial, v_nou), auto_permis = true,
         baza_fizica = GREATEST(coalesce(baza_fizica, 0), p_ultimul_fizic),
         initializat_de = auth.uid(), initializat_la = now(), initializat_sursa = btrim(p_sursa)
   WHERE serie = 'HR' AND an = p_an;
  PERFORM public._hr_ev(NULL, 'contor_initializat', NULL, NULL,
    jsonb_build_object('ultimul_vechi', c.ultimul, 'ultimul_nou', v_nou, 'ultimul_fizic', p_ultimul_fizic, 'baza_veche', c.baza_fizica,
                       'baza_noua', GREATEST(coalesce(c.baza_fizica, 0), p_ultimul_fizic), 'sursa', btrim(p_sursa)), 'HR', p_an);
  RETURN jsonb_build_object('an', p_an, 'ultimul', v_nou, 'auto_permis', true);
END $f$;

CREATE FUNCTION public.fn_hr_decizii_contor_opreste_auto(p_an int, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c public.hr_decizii_contor;
BEGIN
  IF public.fn_hr_decizii_poate('contor') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
  IF NOT FOUND OR NOT c.auto_permis THEN RAISE EXCEPTION 'numarul automat nu e pornit pentru %', p_an; END IF;
  IF coalesce(btrim(p_motiv), '') = '' THEN RAISE EXCEPTION 'motivul e obligatoriu'; END IF;
  UPDATE public.hr_decizii_contor SET auto_permis = false WHERE serie = 'HR' AND an = p_an;
  PERFORM public._hr_ev(NULL, 'contor_auto_oprit', NULL, NULL, jsonb_build_object('motiv', btrim(p_motiv), 'ultimul', c.ultimul), 'HR', p_an);
  RETURN jsonb_build_object('an', p_an, 'auto_permis', false);
END $f$;

CREATE FUNCTION public.fn_hr_decizii_contor_corecteaza(p_an int, p_ultimul int, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c public.hr_decizii_contor; v_max int; v_min int;
BEGIN
  IF public.fn_hr_decizii_poate('owner') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  PERFORM public._hr_contor_valideaza(p_an, p_ultimul);
  IF coalesce(btrim(p_motiv), '') = '' THEN RAISE EXCEPTION 'motivul e obligatoriu'; END IF;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'anul % nu are contor', p_an; END IF;
  SELECT max(d.numar) INTO v_max FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = p_an AND d.stare <> 'anulata';
  v_min := GREATEST(coalesce(v_max, 0), coalesce(c.baza_fizica, 0));
  IF p_ultimul < v_min THEN
    RAISE EXCEPTION 'sub ultimul numar folosit (%) sau sub ultimul numar din registrul fizic (%); daca baza e gresita, corecteaza baza',
      coalesce(v_max, 0), coalesce(c.baza_fizica, 0);
  END IF;
  UPDATE public.hr_decizii_contor SET ultimul = p_ultimul WHERE serie = 'HR' AND an = p_an;
  PERFORM public._hr_ev(NULL, 'contor_corectat', NULL, NULL,
    jsonb_build_object('ultimul_vechi', c.ultimul, 'ultimul_nou', p_ultimul, 'motiv', btrim(p_motiv)), 'HR', p_an);
  RETURN jsonb_build_object('an', p_an, 'ultimul', p_ultimul);
END $f$;

CREATE FUNCTION public.fn_hr_decizii_contor_corecteaza_baza(p_an int, p_baza int, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c public.hr_decizii_contor;
BEGIN
  IF public.fn_hr_decizii_poate('owner') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  PERFORM public._hr_contor_valideaza(p_an, p_baza);
  IF coalesce(btrim(p_motiv), '') = '' THEN RAISE EXCEPTION 'motivul e obligatoriu'; END IF;
  SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = p_an FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'anul % nu are contor', p_an; END IF;
  IF p_baza > c.ultimul THEN RAISE EXCEPTION 'baza % peste ultimul %: ridica intai contorul cu corecteaza', p_baza, c.ultimul; END IF;
  UPDATE public.hr_decizii_contor SET baza_fizica = p_baza WHERE serie = 'HR' AND an = p_an;
  PERFORM public._hr_ev(NULL, 'contor_baza_corectata', NULL, NULL,
    jsonb_build_object('baza_veche', c.baza_fizica, 'baza_noua', p_baza, 'motiv', btrim(p_motiv)), 'HR', p_an);
  RETURN jsonb_build_object('an', p_an, 'baza_fizica', p_baza);
END $f$;

-- ─── 5. Previzualizare și emitere (§3.6, §3.8) ──────────────────────────────────────────────────────────
CREATE FUNCTION public._hr_hash_prev(p_in jsonb, p_continut jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT encode(sha256(convert_to(p_in::text || '|' || p_continut::text, 'UTF8')), 'hex') $f$;

CREATE FUNCTION public.fn_hr_decizie_previzualizeaza(p_id bigint, p_numar int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r public.hr_decizii; v_in jsonb; v_ctx jsonb; v_av jsonb; v_cont jsonb; v_an int; v_ocupat bigint; c public.hr_decizii_contor; v_g3 date;
BEGIN
  IF public.fn_hr_decizii_poate('redactare') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.hr_decizii WHERE id = p_id;
  IF NOT FOUND OR r.stare <> 'draft' OR r.origine <> 'platforma' THEN RAISE EXCEPTION 'decizia % nu e un draft', p_id; END IF;
  v_in := public._hr_decizie_intrari_rand(r, false);
  v_ctx := public._hr_decizie_context(v_in);
  v_av := public._hr_decizie_avertismente(v_in, v_ctx, p_numar, public._hr_decizie_mod(r.tip_cod, 'emitere'));
  IF r.data_emitere IS NOT NULL THEN
    v_an := extract(year FROM r.data_emitere);
    IF p_numar IS NOT NULL THEN
      SELECT d.id INTO v_ocupat FROM public.hr_decizii d WHERE d.serie = 'HR' AND d.an = v_an AND d.numar = p_numar LIMIT 1;
      IF v_ocupat IS NOT NULL THEN
        v_av := v_av || jsonb_build_object('cod','B8','nivel','B','mesaj', format('nr %s/%s e folosit de decizia #%s', p_numar, v_an, v_ocupat));
      END IF;
    ELSE
      SELECT * INTO c FROM public.hr_decizii_contor WHERE serie = 'HR' AND an = v_an;
      IF NOT FOUND OR NOT c.auto_permis THEN
        v_av := v_av || jsonb_build_object('cod','B8','nivel','B','mesaj', format('numar automat cerut pe un an neinitializat (%s)', v_an));
      END IF;
    END IF;
    SELECT max(d.data_emitere) INTO v_g3 FROM public.hr_decizii d
     WHERE d.serie = 'HR' AND d.an = v_an AND d.stare <> 'anulata' AND d.data_emitere > r.data_emitere;
    IF v_g3 IS NOT NULL THEN
      v_av := v_av || jsonb_build_object('cod','G3','nivel','G','mesaj','Data emiterii e anterioara ultimei decizii din registrul anului','ultima', v_g3, 'informativ', true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_av) x WHERE x->>'nivel' = 'B') THEN
    RETURN jsonb_build_object('continut', NULL, 'avertismente', v_av, 'versiune', r.versiune, 'hash_previzualizare', NULL, 'context', v_ctx);
  END IF;
  v_cont := public._hr_decizie_randeaza(v_in, NULL, r.data_emitere);
  RETURN jsonb_build_object('continut', v_cont, 'avertismente', v_av, 'versiune', r.versiune,
                            'hash_previzualizare', public._hr_hash_prev(v_in, v_cont), 'context', v_ctx);
END $f$;

CREATE FUNCTION public.fn_hr_decizie_emite(p_id bigint, p_hash_previzualizare text, p_cerere_id uuid, p_font_pt int,
                                          p_numar int DEFAULT NULL, p_confirmari jsonb DEFAULT '[]', p_confirm_salt boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  r public.hr_decizii; v_in jsonb; v_ctx jsonb; v_av jsonb; v_cont jsonb; v_hash text; v_hash_cerere text; v_coduri text[];
  v_conf jsonb := coalesce(p_confirmari, '[]'::jsonb); v_salt_c boolean := coalesce(p_confirm_salt, false); v_an int;
  v_n int; v_salt jsonb; v_g3 jsonb; v_blocante jsonb; v_rosii_neconf text[]; v_final jsonb := '[]'; v_snap jsonb; v_cod text;
  v_alt bigint; v_imp_scan jsonb; v_el jsonb;
BEGIN
  IF public.fn_hr_decizii_poate('emitere') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  IF p_font_pt IS NULL OR p_font_pt NOT IN (11, 12) THEN RAISE EXCEPTION 'p_font_pt trebuie sa fie 11 sau 12'; END IF;
  IF p_cerere_id IS NULL THEN RAISE EXCEPTION 'cerere_id lipsa'; END IF;
  IF p_hash_previzualizare IS NULL OR p_hash_previzualizare !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'previzualizeaza din nou (hash lipsa sau invalid)'; END IF;
  IF jsonb_typeof(v_conf) <> 'array' THEN RAISE EXCEPTION 'p_confirmari trebuie sa fie lista de coduri'; END IF;
  SELECT array_agg(DISTINCT c ORDER BY c) INTO v_coduri FROM jsonb_array_elements_text(v_conf) c;
  v_hash_cerere := encode(sha256(convert_to(concat_ws('|', p_id, p_hash_previzualizare, coalesce(p_numar::text, ''),
                     array_to_string(coalesce(v_coduri, '{}'), ','), v_salt_c, p_font_pt), 'UTF8')), 'hex');
  SELECT * INTO r FROM public.hr_decizii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  -- retry (J10, Vf10, P2-5)
  IF r.stare <> 'draft' AND r.cerere_emitere = p_cerere_id THEN
    IF r.cerere_emitere_hash IS DISTINCT FROM v_hash_cerere THEN RAISE EXCEPTION 'cerere de emitere refolosita cu alt continut'; END IF;
    RETURN jsonb_build_object('id', r.id, 'an', r.an, 'numar', r.numar, 'nr_afisat', public._hr_nr_afisat(r.serie, r.an, r.numar, r.numar_sufix, r.data_emitere),
                              'cod_verificare', r.cod_verificare, 'avertismente', r.avertismente);
  END IF;
  IF r.stare <> 'draft' OR r.origine <> 'platforma' THEN RAISE EXCEPTION 'decizia % nu e un draft', p_id; END IF;
  SELECT d.id INTO v_alt FROM public.hr_decizii d WHERE d.cerere_emitere = p_cerere_id AND d.id <> p_id;
  IF FOUND THEN RAISE EXCEPTION 'cerere de emitere folosita pe alt draft'; END IF;
  -- 2. citirea unică sub lock
  v_in := public._hr_decizie_intrari_rand(r, true);
  -- 3. versiunea
  v_cont := public._hr_decizie_randeaza(v_in, NULL, r.data_emitere);
  v_hash := public._hr_hash_prev(v_in, v_cont);
  IF v_hash IS DISTINCT FROM p_hash_previzualizare THEN RAISE EXCEPTION 'draftul s-a schimbat de la previzualizare; previzualizeaza din nou'; END IF;
  -- 4. avertismente (R3 pe server)
  v_ctx := public._hr_decizie_context(v_in);
  v_av := public._hr_decizie_avertismente(v_in, v_ctx, p_numar, public._hr_decizie_mod(r.tip_cod, 'emitere'));
  SELECT jsonb_agg(x) INTO v_blocante FROM jsonb_array_elements(v_av) x WHERE x->>'nivel' = 'B';
  IF v_blocante IS NOT NULL THEN RAISE EXCEPTION 'blocante: %', (SELECT string_agg(x->>'cod' || ' ' || (x->>'mesaj'), '; ') FROM jsonb_array_elements(v_blocante) x); END IF;
  SELECT array_agg(x->>'cod') INTO v_rosii_neconf FROM jsonb_array_elements(v_av) x
   WHERE x->>'nivel' = 'R' AND NOT (x->>'cod') = ANY (coalesce(v_coduri, '{}'));
  IF v_rosii_neconf IS NOT NULL THEN RAISE EXCEPTION 'confirmari necesare: %', array_to_string(v_rosii_neconf, ', '); END IF;
  v_an := extract(year FROM r.data_emitere);
  PERFORM public._hr_decizii_valideaza_numar('HR', v_an, p_numar, '', r.data_emitere, 'platforma');
  -- 5. alocare
  SELECT a.numar, a.salt, a.g3 INTO v_n, v_salt, v_g3 FROM public._hr_decizii_aloca('HR', v_an, p_numar, '', v_salt_c, 'platforma', r.data_emitere) a;
  FOR v_el IN SELECT * FROM jsonb_array_elements(v_av) LOOP
    v_final := v_final || CASE WHEN v_el->>'nivel' = 'R' THEN v_el || jsonb_build_object('confirmat_de', auth.uid(), 'confirmat_la', now()) ELSE v_el END;
  END LOOP;
  IF v_salt IS NOT NULL THEN v_final := v_final || v_salt; END IF;
  IF v_g3 IS NOT NULL THEN v_final := v_final || v_g3; END IF;
  -- 6. snapshot din v_in
  v_snap := jsonb_build_object(
    'sursa', 'platforma', 'font_pt', p_font_pt, 'temei', r.temei, 'data_efect_pana', r.data_efect_pana,
    'persoana', jsonb_build_object('employee_id', r.employee_id, 'nume', v_in->'angajat'->>'nume', 'titlu', r.titlu),
    'proiect', CASE WHEN r.nivel = 'proiect' THEN jsonb_build_object('id', r.proiect_id, 'denumire', r.proiect_denumire,
                 'nr_contract', v_in->'proiect'->>'nr_contract', 'data_contract', v_in->'proiect'->>'data_contract',
                 'beneficiar', v_in->'proiect'->>'beneficiar', 'data_termen', v_in->'proiect'->>'data_termen') END,
    'atestat', CASE WHEN v_in->'atestat' IS NOT NULL THEN jsonb_build_object('id', v_in->'atestat'->>'id', 'tip', v_in->'atestat'->>'tip_cod',
                 'numar', v_in->'atestat'->>'numar', 'data_emitere', v_in->'atestat'->>'data_emitere', 'emitent', v_in->'atestat'->>'emitent',
                 'data_expirare', v_in->'atestat'->>'data_expirare', 'verificat_pe_scan', v_in->'atestat'->'verificat_pe_scan',
                 'uploadat_de', v_in->'atestat'->>'uploadat_de') END,
    'semnatar', jsonb_build_object('id', r.semnatar_id, 'employee_id', v_in->'semnatar'->'employee_id', 'nume', v_in->'semnatar'->>'nume',
                 'calitate', v_in->'semnatar'->>'calitate', 'preambul_text', v_in->'semnatar'->>'preambul_text',
                 'bloc_semnatura', v_in->'semnatar'->>'bloc_semnatura',
                 'imputernicire', CASE WHEN v_in->'imputernicire' IS NOT NULL THEN jsonb_build_object('id', v_in->'imputernicire'->'id',
                    'nr', public._hr_nr_afisat(v_in->'imputernicire'->>'serie', (v_in->'imputernicire'->>'an')::int,
                          (v_in->'imputernicire'->>'numar')::int, v_in->'imputernicire'->>'numar_sufix', (v_in->'imputernicire'->>'data_emitere')::date),
                    'data', v_in->'imputernicire'->>'data_emitere') END),
    'tinta', CASE WHEN v_in->'tinta' IS NOT NULL THEN jsonb_build_object('id', v_in->'tinta'->'id', 'nr', v_in->'tinta'->>'nr_afisat',
                 'data', v_in->'tinta'->>'data_emitere', 'functie', v_in->'tinta'->>'eticheta_functie', 'nume', v_in->'tinta'->>'nume') END);
  -- 7–8. randare finală + cod
  v_cont := public._hr_decizie_randeaza(v_in, v_n, r.data_emitere);
  v_cod := 'D' || r.id || '-' || left(encode(sha256(convert_to(v_cont::text, 'UTF8')), 'hex'), 8);
  IF v_in->'semnatar'->>'imputernicire_decizie_id' IS NOT NULL THEN
    SELECT jsonb_build_object('path', i.scan_path, 'sha256', i.scan_sha256) INTO v_imp_scan
      FROM public.hr_decizii i WHERE i.id = (v_in->'semnatar'->>'imputernicire_decizie_id')::bigint;
  END IF;
  -- 9. tranziția, strict pe coloanele ei
  BEGIN
    UPDATE public.hr_decizii
       SET stare = 'emisa', an = v_an, numar = v_n, mod_numar = CASE WHEN p_numar IS NULL THEN 'auto' ELSE 'manual' END,
           snapshot = v_snap, continut = v_cont, cod_verificare = v_cod, avertismente = v_final,
           cerere_emitere = p_cerere_id, cerere_emitere_hash = v_hash_cerere, emis_de = auth.uid(), emis_la = now()
     WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'cerere de emitere folosita pe alt draft sau numar ocupat';
  END;
  PERFORM public._hr_ev(p_id, 'emitere', 'draft', 'emisa', jsonb_build_object('versiune', r.versiune, 'hash_previzualizare', p_hash_previzualizare,
    'font_pt', p_font_pt, 'numar', v_n, 'mod_numar', CASE WHEN p_numar IS NULL THEN 'auto' ELSE 'manual' END, 'imputernicire_scan', v_imp_scan));
  IF v_salt IS NOT NULL THEN PERFORM public._hr_ev(p_id, 'salt_confirmat', NULL, NULL, v_salt, 'HR', v_an); END IF;
  RETURN jsonb_build_object('id', p_id, 'an', v_an, 'numar', v_n, 'nr_afisat', public._hr_nr_afisat('HR', v_an, v_n, '', r.data_emitere),
                            'cod_verificare', v_cod, 'avertismente', v_final);
END $f$;

-- ─── 6. Fișiere, scan, anulare (§3.6, §3.9) ─────────────────────────────────────────────────────────────
-- Verificarea de fișier (VA20, J2-7): obiect existent, PDF, 1 B…20 MB, urcat de apelant, cale a deciziei, categoria cerută.
CREATE FUNCTION public._hr_fisier_ok(p_d public.hr_decizii, p_path text, p_categorie text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE o record;
BEGIN
  IF public.fn_hr_decizii_id_din_cale(p_path) IS DISTINCT FROM p_d.id
     OR split_part(p_path, '/', 1) IS DISTINCT FROM p_d.serie OR split_part(p_path, '/', 2) IS DISTINCT FROM p_d.an::text
     OR split_part(split_part(p_path, '/', 4), '_', 1) IS DISTINCT FROM p_categorie THEN
    RAISE EXCEPTION 'cale invalida pentru decizia %: %', p_d.id, p_path;
  END IF;
  SELECT metadata, owner_id INTO o FROM storage.objects WHERE bucket_id = 'hr-decizii' AND name = p_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'fisierul % nu exista in bucket', p_path; END IF;
  IF o.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
     OR coalesce((o.metadata->>'size')::bigint, 0) NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'fisierul % nu e un PDF valid (tip/marime)', p_path;
  END IF;
  IF o.owner_id IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'fisierul % a fost urcat de alt utilizator', p_path; END IF;
END $f$;

CREATE FUNCTION public.fn_hr_decizie_seteaza_pdf(p_id bigint, p_path text, p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE d public.hr_decizii;
BEGIN
  IF public.fn_hr_decizii_poate('emitere') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  IF d.pdf_path IS NOT DISTINCT FROM p_path AND d.pdf_sha256 IS NOT DISTINCT FROM p_sha256 AND d.pdf_path IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'retry', true);
  END IF;
  IF d.stare <> 'emisa' OR d.origine <> 'platforma' THEN RAISE EXCEPTION 'PDF-ul se inregistreaza doar pe o decizie generata emisa'; END IF;
  IF d.pdf_path IS NOT NULL THEN RAISE EXCEPTION 'PDF deja atasat'; END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'amprenta invalida (64 hex)'; END IF;
  PERFORM public._hr_fisier_ok(d, p_path, 'generat');
  UPDATE public.hr_decizii SET pdf_path = p_path, pdf_sha256 = p_sha256 WHERE id = p_id;
  PERFORM public._hr_ev(p_id, 'pdf', d.stare, d.stare, jsonb_build_object('path', p_path, 'sha256', p_sha256));
  RETURN jsonb_build_object('ok', true);
END $f$;

-- Verificările bifate la scan (C15b, VA5, VA6, VA17, VA31, D5).
CREATE FUNCTION public._hr_verificari_ok(p_d public.hr_decizii, p_v jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE k text; v_chei text[];
BEGIN
  IF p_v IS NULL OR jsonb_typeof(p_v) <> 'object' THEN RAISE EXCEPTION 'verificarile scanului lipsesc'; END IF;
  v_chei := CASE WHEN p_d.tip_cod = 'ALTA_DECIZIE' THEN ARRAY['nr','semnatura']
                 WHEN p_d.origine = 'platforma' THEN ARRAY['nr','persoana','semnatura','stampila','cod']
                 ELSE ARRAY['nr','persoana','semnatar','semnatura','stampila'] END;
  FOREACH k IN ARRAY v_chei || ARRAY['lizibil'] LOOP
    IF (p_v->>k) IS DISTINCT FROM 'true' THEN
      IF k = 'stampila' AND p_d.origine = 'import' AND (p_v->>k) = 'false' AND coalesce(btrim(p_v->>'observatie'), '') <> '' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'verificarea „%” nu e bifata', k;
    END IF;
  END LOOP;
  IF p_v->>'sursa' IS NULL OR p_v->>'sursa' NOT IN ('pdf','foto') THEN RAISE EXCEPTION 'verificari: sursa trebuie sa fie pdf sau foto'; END IF;
  IF jsonb_typeof(p_v->'pagini') IS DISTINCT FROM 'number' OR (p_v->>'pagini')::numeric < 1 OR (p_v->>'pagini')::numeric <> trunc((p_v->>'pagini')::numeric) THEN
    RAISE EXCEPTION 'verificari: pagini trebuie sa fie un intreg >= 1';
  END IF;
  IF p_v->>'pagini_sursa' IS NULL OR p_v->>'pagini_sursa' NOT IN ('detectat','manual') THEN RAISE EXCEPTION 'verificari: pagini_sursa invalid'; END IF;
  IF jsonb_typeof(p_v->'generat') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'verificari: generat lipsa'; END IF;
END $f$;

CREATE FUNCTION public.fn_hr_decizie_ataseaza_scan(p_id bigint, p_path text, p_sha256 text, p_verificari jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  d public.hr_decizii; t public.hr_decizii; tip public.hr_decizii_tipuri; tip_t public.hr_decizii_tipuri; v_tinta_id bigint;
  v_motiv text; v_cur text; v_prop bigint; v_conc int := 0; v_nume text; v_n int; g record;
BEGIN
  IF public.fn_hr_decizii_poate('scan') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  IF d.stare = 'semnata' AND d.scan_path IS NOT DISTINCT FROM p_path AND d.scan_sha256 IS NOT DISTINCT FROM p_sha256 THEN
    RETURN jsonb_build_object('stare', 'semnata', 'retry', true);
  END IF;
  IF d.stare <> 'emisa' THEN RAISE EXCEPTION 'scanul se ataseaza doar unei decizii emise (acum: %)', d.stare; END IF;
  IF d.origine = 'platforma' AND d.pdf_path IS NULL THEN
    RAISE EXCEPTION 'inregistreaza intai PDF-ul generat (regenereaza din continut si reincearca)';
  END IF;
  v_tinta_id := coalesce(d.inlocuieste_id, d.revoca_id);
  IF v_tinta_id IS NOT NULL THEN
    SELECT * INTO t FROM public.hr_decizii WHERE id = v_tinta_id FOR UPDATE;
    IF NOT FOUND OR t.stare <> 'semnata' OR EXISTS (SELECT 1 FROM public.hr_decizii x WHERE coalesce(x.inlocuieste_id, x.revoca_id) = t.id
                                                      AND x.stare NOT IN ('draft','anulata') AND x.id <> d.id) THEN
      RAISE EXCEPTION 'tinta % nu mai e semnata sau are alta relatie vie', v_tinta_id;
    END IF;
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'amprenta invalida (64 hex)'; END IF;
  PERFORM public._hr_fisier_ok(d, p_path, 'semnat');
  PERFORM public._hr_verificari_ok(d, p_verificari);
  UPDATE public.hr_decizii SET scan_path = p_path, scan_sha256 = p_sha256, scan_de = auth.uid(), scan_la = now(), stare = 'semnata' WHERE id = p_id;
  PERFORM public._hr_ev(p_id, 'scan', 'emisa', 'semnata', jsonb_build_object('path', p_path, 'sha256', p_sha256, 'verificari', p_verificari));
  SELECT * INTO tip FROM public.hr_decizii_tipuri WHERE cod = d.tip_cod;
  -- 5. ținte
  IF v_tinta_id IS NOT NULL THEN
    UPDATE public.hr_decizii SET stare = CASE WHEN d.inlocuieste_id IS NOT NULL THEN 'inlocuita' ELSE 'revocata' END WHERE id = t.id;
    PERFORM public._hr_ev(t.id, CASE WHEN d.inlocuieste_id IS NOT NULL THEN 'inlocuita' ELSE 'revocata' END, 'semnata',
                          CASE WHEN d.inlocuieste_id IS NOT NULL THEN 'inlocuita' ELSE 'revocata' END, jsonb_build_object('de_decizia', d.id));
    FOR g IN SELECT id FROM public.executie_completari_propuse WHERE hr_decizie_id = t.id AND status = 'propus' ORDER BY id FOR UPDATE LOOP
      UPDATE public.executie_completari_propuse SET status = 'expirat', decis_la = now() WHERE id = g.id;
      PERFORM public._hr_ev(t.id, 'propunere_expirata', NULL, NULL, jsonb_build_object('propunere_id', g.id, 'motiv', 'decizia ' || d.id || ' a inlocuit/revocat tinta'));
    END LOOP;
    IF d.revoca_id IS NOT NULL THEN
      SELECT * INTO tip_t FROM public.hr_decizii_tipuri WHERE cod = t.tip_cod;
      IF t.nivel = 'proiect' AND tip_t.camp_efect IS NOT NULL AND t.employee_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = tip_t.camp_efect AND NOT attisdropped)
         AND public._hr_valoare_camp(t.proiect_id, tip_t.camp_efect) = t.employee_id::text THEN
        v_nume := coalesce(t.snapshot->'persoana'->>'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = t.employee_id)));
        INSERT INTO public.executie_completari_propuse (proiect_id, camp, valoare, valoare_afisata, sursa, sursa_detaliu, dovada_path,
                                                        confidenta, motiv, status, hr_decizie_id)
        VALUES (t.proiect_id, tip_t.camp_efect, '', '(gol)', 'decizie_revocare',
                'Decizia nr ' || public._hr_nr_afisat(d.serie, d.an, d.numar, d.numar_sufix, d.data_emitere), p_path, 100,
                'revoca ' || coalesce(v_nume, '?') || '; campul se goleste', 'propus', d.id)
        RETURNING id INTO v_prop;
        PERFORM public._hr_ev(d.id, 'propunere_golire', NULL, NULL, jsonb_build_object('propunere_id', v_prop, 'camp', tip_t.camp_efect));
        RETURN jsonb_build_object('stare', 'semnata', 'propunere_id', v_prop, 'concurente', 0);
      END IF;
      RETURN jsonb_build_object('stare', 'semnata', 'concurente', 0);
    END IF;
  END IF;
  IF d.tip_cod IN ('REVOCARE','ALTA_DECIZIE') THEN RETURN jsonb_build_object('stare', 'semnata', 'concurente', 0); END IF;
  -- numire nouă: golirile expiră doar dacă echipa nu-l mai are pe cel revocat (P4-1, J4-1)
  IF tip.camp_efect IS NOT NULL AND d.nivel = 'proiect'
     AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = tip.camp_efect AND NOT attisdropped) THEN
    v_cur := public._hr_valoare_camp(d.proiect_id, tip.camp_efect);
    FOR g IN SELECT p.id, rv.revoca_id FROM public.executie_completari_propuse p JOIN public.hr_decizii rv ON rv.id = p.hr_decizie_id
              WHERE p.proiect_id = d.proiect_id AND p.camp = tip.camp_efect AND p.sursa = 'decizie_revocare' AND p.status = 'propus'
              ORDER BY p.id FOR UPDATE OF p LOOP
      IF v_cur IS DISTINCT FROM (SELECT x.employee_id::text FROM public.hr_decizii x WHERE x.id = g.revoca_id) THEN
        UPDATE public.executie_completari_propuse SET status = 'expirat', decis_la = now() WHERE id = g.id;
        PERFORM public._hr_ev(d.id, 'propunere_expirata', NULL, NULL, jsonb_build_object('propunere_id', g.id, 'motiv', 'echipa nu-l mai are pe cel revocat'));
      END IF;
    END LOOP;
  END IF;
  -- 6. efect
  v_motiv := public._hr_decizie_motiv_neeligibil(p_id);
  IF v_motiv IS NOT NULL THEN
    IF tip.camp_efect IS NOT NULL OR v_motiv <> 'tipul nu are camp de efect' THEN
      PERFORM public._hr_ev(p_id, 'propunere_omisa', NULL, NULL, jsonb_build_object('motiv', v_motiv));
    END IF;
    RETURN jsonb_build_object('stare', 'semnata', 'concurente', 0);
  END IF;
  v_cur := public._hr_valoare_camp(d.proiect_id, tip.camp_efect);
  IF v_cur IS DISTINCT FROM d.employee_id::text
     OR EXISTS (SELECT 1 FROM public.executie_completari_propuse p JOIN public.hr_decizii rv ON rv.id = p.hr_decizie_id
                 JOIN public.hr_decizii tg ON tg.id = rv.revoca_id
                 WHERE p.proiect_id = d.proiect_id AND p.camp = tip.camp_efect AND p.sursa = 'decizie_revocare' AND p.status = 'propus'
                   AND tg.employee_id = d.employee_id) THEN
    SELECT count(*) INTO v_conc FROM public.executie_completari_propuse p
     WHERE p.proiect_id = d.proiect_id AND p.camp = tip.camp_efect AND p.status = 'propus';
    INSERT INTO public.executie_completari_propuse (proiect_id, camp, valoare, valoare_afisata, sursa, sursa_detaliu, dovada_path,
                                                    confidenta, motiv, status, hr_decizie_id)
    VALUES (d.proiect_id, tip.camp_efect, d.employee_id::text, coalesce(d.snapshot->'persoana'->>'nume', d.persoana_nume), 'decizie_numire',
            'Decizia nr ' || public._hr_nr_afisat(d.serie, d.an, d.numar, d.numar_sufix, d.data_emitere), p_path, 100,
            CASE WHEN v_cur IS NOT NULL AND v_cur <> d.employee_id::text THEN 'inlocuieste '
                 || coalesce(public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id::text = v_cur)), v_cur) END,
            'propus', d.id)
    RETURNING id INTO v_prop;
    PERFORM public._hr_ev(p_id, 'propunere_efect', NULL, NULL, jsonb_build_object('propunere_id', v_prop, 'camp', tip.camp_efect, 'concurente', v_conc));
  END IF;
  RETURN jsonb_build_object('stare', 'semnata', 'propunere_id', v_prop, 'concurente', v_conc);
END $f$;

CREATE FUNCTION public.fn_hr_decizie_inlocuieste_scan(p_id bigint, p_cerere_id uuid, p_scan_vechi_path text, p_scan_vechi_sha256 text,
                                                     p_path text, p_sha256 text, p_motiv text, p_verificari jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE d public.hr_decizii; v_hash text; v_ev public.hr_decizii_evenimente;
BEGIN
  IF public.fn_hr_decizii_poate('owner') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  IF p_cerere_id IS NULL THEN RAISE EXCEPTION 'cerere_id lipsa'; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_scan_vechi_path, p_scan_vechi_sha256, p_path, p_sha256, p_motiv, p_verificari)::text, 'UTF8')), 'hex');
  SELECT * INTO v_ev FROM public.hr_decizii_evenimente WHERE eveniment = 'scan_inlocuit' AND detalii->>'cerere_id' = p_cerere_id::text;
  IF FOUND THEN
    IF v_ev.decizie_id IS DISTINCT FROM p_id OR v_ev.detalii->>'cerere_hash' IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'cerere refolosita cu alt continut';
    END IF;
    RETURN jsonb_build_object('ok', true, 'retry', true);
  END IF;
  IF d.stare <> 'semnata' THEN RAISE EXCEPTION 'scanul se inlocuieste doar pe o decizie semnata'; END IF;
  IF d.scan_path IS DISTINCT FROM p_scan_vechi_path OR d.scan_sha256 IS DISTINCT FROM p_scan_vechi_sha256 THEN
    RAISE EXCEPTION 'scanul s-a schimbat intre timp; reincarca';
  END IF;
  IF p_path IS NOT DISTINCT FROM d.scan_path THEN RAISE EXCEPTION 'noul scan are aceeasi cale ca cel vechi'; END IF;
  IF coalesce(btrim(p_motiv), '') = '' THEN RAISE EXCEPTION 'motivul e obligatoriu'; END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'amprenta invalida (64 hex)'; END IF;
  PERFORM public._hr_fisier_ok(d, p_path, 'semnat');
  PERFORM public._hr_verificari_ok(d, p_verificari);
  UPDATE public.hr_decizii SET scan_path = p_path, scan_sha256 = p_sha256, scan_de = auth.uid(), scan_la = now() WHERE id = p_id;
  UPDATE public.executie_completari_propuse SET dovada_path = p_path WHERE hr_decizie_id = p_id AND status = 'propus';
  PERFORM public._hr_ev(p_id, 'scan_inlocuit', 'semnata', 'semnata', jsonb_build_object('cerere_id', p_cerere_id::text, 'cerere_hash', v_hash,
    'path_vechi', d.scan_path, 'sha256_vechi', d.scan_sha256, 'path', p_path, 'sha256', p_sha256, 'motiv', btrim(p_motiv), 'verificari', p_verificari));
  RETURN jsonb_build_object('ok', true);
END $f$;

CREATE FUNCTION public.fn_hr_decizie_anuleaza(p_id bigint, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE d public.hr_decizii;
BEGIN
  IF public.fn_hr_decizii_poate('anulare') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decizia % nu exista', p_id; END IF;
  IF d.stare <> 'emisa' THEN RAISE EXCEPTION 'se anuleaza doar o decizie emisa si nesemnata (acum: %)', d.stare; END IF;
  IF coalesce(btrim(p_motiv), '') = '' THEN RAISE EXCEPTION 'motivul e obligatoriu'; END IF;
  UPDATE public.hr_decizii SET stare = 'anulata', motiv_anulare = btrim(p_motiv), anulat_de = auth.uid(), anulat_la = now() WHERE id = p_id;
  PERFORM public._hr_ev(p_id, 'anulare', 'emisa', 'anulata', jsonb_build_object('motiv', btrim(p_motiv)));
  RETURN jsonb_build_object('ok', true);
END $f$;

-- ─── 7. Rezervare și import (§4.E, §4.F) ───────────────────────────────────────────────────────────────
-- Rândul construit din payload (comun rezervării și importului); nimic nu se scrie aici.
CREATE FUNCTION public._hr_rand_din_payload(p jsonb, p_origine text) RETURNS public.hr_decizii
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r public.hr_decizii; v_tip public.hr_decizii_tipuri;
BEGIN
  IF p ? 'inlocuieste_id' AND p->>'inlocuieste_id' IS NOT NULL OR p ? 'revoca_id' AND p->>'revoca_id' IS NOT NULL THEN
    RAISE EXCEPTION 'inlocuirea/revocarea nu se fac prin %', p_origine;
  END IF;
  SELECT * INTO v_tip FROM public.hr_decizii_tipuri WHERE cod = p->>'tip_cod';
  IF NOT FOUND THEN RAISE EXCEPTION 'tip de decizie inexistent: %', p->>'tip_cod'; END IF;
  IF v_tip.cod = 'REVOCARE' THEN
    RAISE EXCEPTION 'REVOCARE nu se % : o revocare istorica se inregistreaza ca ALTA_DECIZIE cu descriere', CASE WHEN p_origine = 'import' THEN 'importa' ELSE 'rezerva' END;
  END IF;
  r.origine := p_origine;
  r.serie := coalesce(p->>'serie', 'HR');
  r.tip_cod := v_tip.cod;
  r.eticheta_functie := coalesce(nullif(btrim(p->>'eticheta_functie'), ''), v_tip.eticheta_functie);
  r.descriere := nullif(btrim(p->>'descriere'), '');
  r.nivel := coalesce(p->>'nivel', CASE WHEN p->>'proiect_id' IS NOT NULL THEN 'proiect' ELSE 'firma' END);
  r.employee_id := (p->>'employee_id')::int;
  r.persoana_nume := nullif(btrim(p->>'persoana_nume'), '');
  r.proiect_id := (p->>'proiect_id')::bigint;
  r.proiect_denumire := coalesce(nullif(btrim(p->>'proiect_denumire'), ''), (SELECT x.nume FROM public.executie_proiecte x WHERE x.id = (p->>'proiect_id')::bigint));
  r.autorizatie_id := (p->>'autorizatie_id')::bigint;
  r.titlu := nullif(p->>'titlu', '');
  r.temei := nullif(btrim(p->>'temei'), '');
  r.data_emitere := (p->>'data_emitere')::date;
  r.data_efect := (p->>'data_efect')::date;
  r.semnatar_id := coalesce((p->>'semnatar_id')::bigint, CASE WHEN v_tip.cod <> 'ALTA_DECIZIE' OR p_origine = 'import' THEN v_tip.semnatar_implicit_id END);
  r.luare_la_cunostinta := false;
  r.propune_efect := coalesce((p->>'propune_efect')::boolean, p_origine <> 'import');
  r.versiune := 1;
  r.numar_sufix := public._hr_decizii_norm_sufix(p->>'numar_sufix');
  IF r.nivel NOT IN ('proiect','firma') OR (r.nivel = 'proiect') <> (r.proiect_id IS NOT NULL) THEN RAISE EXCEPTION 'nivel/proiect incoerente'; END IF;
  IF r.employee_id IS NOT NULL AND r.persoana_nume IS NOT NULL THEN RAISE EXCEPTION 'alege angajat SAU nume extern, nu ambele'; END IF;
  RETURN r;
END $f$;

CREATE FUNCTION public._hr_snapshot_simplu(r public.hr_decizii, p_sursa text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT jsonb_build_object('sursa', p_sursa,
    'persoana', jsonb_build_object('employee_id', r.employee_id, 'titlu', r.titlu,
                  'nume', coalesce(public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = r.employee_id)), r.persoana_nume)),
    'proiect', CASE WHEN r.proiect_id IS NOT NULL THEN jsonb_build_object('id', r.proiect_id, 'denumire', r.proiect_denumire) END,
    'semnatar', CASE WHEN r.semnatar_id IS NOT NULL THEN (SELECT jsonb_build_object('id', s.id, 'employee_id', s.employee_id, 'calitate', s.calitate,
                  'nume', public._hr_nume_afis((SELECT e.name FROM public.employees e WHERE e.id = s.employee_id)))
                  FROM public.hr_decizii_semnatari s WHERE s.id = r.semnatar_id) END)
$f$;

CREATE FUNCTION public.fn_hr_decizie_rezerva(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  v_cerere uuid; v_hash text; e public.hr_decizii; r public.hr_decizii; v_in jsonb; v_av jsonb; v_final jsonb := '[]'; v_coduri text[];
  v_rosii text[]; v_n int; v_salt jsonb; v_g3 jsonb; v_an int; v_numar int := (p_payload->>'numar')::int; v_el jsonb; v_id bigint;
BEGIN
  IF public.fn_hr_decizii_poate('rezervare') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'payload invalid'; END IF;
  v_cerere := (p_payload->>'cerere_id')::uuid;
  IF v_cerere IS NULL THEN RAISE EXCEPTION 'cerere_id lipsa'; END IF;
  v_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext(v_cerere::text));
  SELECT * INTO e FROM public.hr_decizii WHERE cerere_id = v_cerere;
  IF FOUND THEN
    IF e.cerere_hash IS DISTINCT FROM v_hash OR e.origine <> 'rezervare' THEN RAISE EXCEPTION 'cerere refolosita cu alt continut'; END IF;
    RETURN jsonb_build_object('id', e.id, 'an', e.an, 'numar', e.numar, 'nr_afisat', public._hr_nr_afisat(e.serie, e.an, e.numar, e.numar_sufix, e.data_emitere), 'retry', true);
  END IF;
  r := public._hr_rand_din_payload(p_payload, 'rezervare');
  IF r.serie <> 'HR' OR r.numar_sufix <> '' THEN RAISE EXCEPTION 'rezervarea e doar in seria HR, fara sufix'; END IF;
  IF r.data_emitere IS NULL THEN RAISE EXCEPTION 'data emiterii e obligatorie'; END IF;
  v_an := extract(year FROM r.data_emitere);
  v_in := public._hr_decizie_intrari_rand(r, true);
  v_av := public._hr_decizie_avertismente(v_in, '{}'::jsonb, v_numar, public._hr_decizie_mod(r.tip_cod, 'rezervare'));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_av) y WHERE y->>'nivel' = 'B') THEN
    RAISE EXCEPTION 'blocante: %', (SELECT string_agg(y->>'cod' || ' ' || (y->>'mesaj'), '; ') FROM jsonb_array_elements(v_av) y WHERE y->>'nivel' = 'B');
  END IF;
  SELECT array_agg(DISTINCT c) INTO v_coduri FROM jsonb_array_elements_text(coalesce(p_payload->'confirmari', '[]')) c;
  SELECT array_agg(y->>'cod') INTO v_rosii FROM jsonb_array_elements(v_av) y WHERE y->>'nivel' = 'R' AND NOT (y->>'cod') = ANY (coalesce(v_coduri, '{}'));
  IF v_rosii IS NOT NULL THEN RAISE EXCEPTION 'confirmari necesare: %', array_to_string(v_rosii, ', '); END IF;
  PERFORM public._hr_decizii_valideaza_numar('HR', v_an, v_numar, '', r.data_emitere, 'rezervare');
  SELECT a.numar, a.salt, a.g3 INTO v_n, v_salt, v_g3 FROM public._hr_decizii_aloca('HR', v_an, v_numar, '', (p_payload->>'confirm_salt')::boolean, 'rezervare', r.data_emitere) a;
  FOR v_el IN SELECT * FROM jsonb_array_elements(v_av) LOOP
    v_final := v_final || CASE WHEN v_el->>'nivel' = 'R' THEN v_el || jsonb_build_object('confirmat_de', auth.uid(), 'confirmat_la', now()) ELSE v_el END;
  END LOOP;
  IF v_salt IS NOT NULL THEN v_final := v_final || v_salt; END IF;
  IF v_g3 IS NOT NULL THEN v_final := v_final || v_g3; END IF;
  INSERT INTO public.hr_decizii (serie, an, numar, numar_sufix, mod_numar, origine, tip_cod, eticheta_functie, descriere, nivel, employee_id,
      persoana_nume, proiect_id, proiect_denumire, autorizatie_id, titlu, temei, data_emitere, data_efect, semnatar_id, propune_efect,
      cerere_id, cerere_hash, snapshot, avertismente, stare, creat_de, emis_de, emis_la)
  VALUES ('HR', v_an, v_n, '', CASE WHEN v_numar IS NULL THEN 'auto' ELSE 'manual' END, 'rezervare', r.tip_cod, r.eticheta_functie, r.descriere,
      r.nivel, r.employee_id, r.persoana_nume, r.proiect_id, r.proiect_denumire, r.autorizatie_id, r.titlu, r.temei, r.data_emitere, r.data_efect,
      r.semnatar_id, r.propune_efect, v_cerere, v_hash, public._hr_snapshot_simplu(r, 'rezervare'), v_final, 'emisa', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;
  PERFORM public._hr_ev(v_id, 'rezervare', NULL, 'emisa', jsonb_build_object('numar', v_n, 'an', v_an, 'cerere_id', v_cerere));
  IF v_salt IS NOT NULL THEN PERFORM public._hr_ev(v_id, 'salt_confirmat', NULL, NULL, v_salt, 'HR', v_an); END IF;
  RETURN jsonb_build_object('id', v_id, 'an', v_an, 'numar', v_n, 'nr_afisat', public._hr_nr_afisat('HR', v_an, v_n, '', r.data_emitere), 'avertismente', v_final);
END $f$;

CREATE FUNCTION public.fn_hr_decizie_importa(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  v_cerere uuid; v_hash text; e public.hr_decizii; r public.hr_decizii; v_tip public.hr_decizii_tipuri; v_an int := (p_payload->>'an')::int;
  v_numar int := (p_payload->>'numar')::int; v_n int; v_suf text; v_id bigint;
BEGIN
  IF public.fn_hr_decizii_poate('import') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'payload invalid'; END IF;
  v_cerere := (p_payload->>'cerere_id')::uuid;
  IF v_cerere IS NULL THEN RAISE EXCEPTION 'cerere_id lipsa'; END IF;
  v_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext(v_cerere::text));
  SELECT * INTO e FROM public.hr_decizii WHERE cerere_id = v_cerere;
  IF FOUND THEN
    IF e.cerere_hash IS DISTINCT FROM v_hash OR e.origine <> 'import' THEN RAISE EXCEPTION 'cerere refolosita cu alt continut'; END IF;
    RETURN jsonb_build_object('id', e.id, 'an', e.an, 'numar', e.numar, 'nr_afisat', public._hr_nr_afisat(e.serie, e.an, e.numar, e.numar_sufix, e.data_emitere), 'retry', true);
  END IF;
  r := public._hr_rand_din_payload(p_payload, 'import');
  IF v_numar IS NULL THEN RAISE EXCEPTION 'numarul e obligatoriu la import'; END IF;
  PERFORM public._hr_decizii_valideaza_numar(r.serie, v_an, v_numar, r.numar_sufix, r.data_emitere, 'import');
  SELECT * INTO v_tip FROM public.hr_decizii_tipuri WHERE cod = r.tip_cod;
  IF NOT (v_tip.nivel = 'ambele' OR v_tip.nivel = r.nivel) THEN RAISE EXCEPTION 'B4: nivelul % nu e compatibil cu tipul %', r.nivel, r.tip_cod; END IF;
  IF r.tip_cod <> 'ALTA_DECIZIE' AND NOT (r.eticheta_functie = v_tip.eticheta_functie OR r.eticheta_functie = ANY (v_tip.etichete_alternative)) THEN
    RAISE EXCEPTION 'B4: eticheta „%” nu e in lista tipului %', r.eticheta_functie, r.tip_cod;
  END IF;
  IF r.tip_cod = 'ALTA_DECIZIE' AND r.descriere IS NULL THEN RAISE EXCEPTION 'ALTA_DECIZIE cere descriere'; END IF;
  IF r.tip_cod <> 'ALTA_DECIZIE' AND r.employee_id IS NULL AND r.persoana_nume IS NULL THEN RAISE EXCEPTION 'persoana (angajat sau nume extern) e obligatorie'; END IF;
  SELECT a.numar, a.sufix INTO v_n, v_suf FROM public._hr_decizii_aloca(r.serie, v_an, v_numar, r.numar_sufix, false, 'import', r.data_emitere) a;
  BEGIN
    INSERT INTO public.hr_decizii (serie, an, numar, numar_sufix, mod_numar, origine, tip_cod, eticheta_functie, descriere, nivel, employee_id,
        persoana_nume, proiect_id, proiect_denumire, autorizatie_id, titlu, temei, data_emitere, data_efect, semnatar_id, propune_efect,
        cerere_id, cerere_hash, snapshot, stare, creat_de, emis_de, emis_la)
    VALUES (r.serie, v_an, v_n, v_suf, 'manual', 'import', r.tip_cod, r.eticheta_functie, r.descriere, r.nivel, r.employee_id, r.persoana_nume,
        r.proiect_id, r.proiect_denumire, r.autorizatie_id, r.titlu, r.temei, r.data_emitere, r.data_efect, r.semnatar_id, r.propune_efect,
        v_cerere, v_hash, public._hr_snapshot_simplu(r, 'import'), 'emisa', auth.uid(), auth.uid(), now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'nr %/% e deja in registru', v_numar || CASE WHEN v_suf <> '' THEN '-' || v_suf ELSE '' END, v_an;
  END;
  PERFORM public._hr_ev(v_id, 'import', NULL, 'emisa', jsonb_build_object('serie', r.serie, 'numar', v_n, 'sufix', v_suf, 'an', v_an, 'cerere_id', v_cerere));
  RETURN jsonb_build_object('id', v_id, 'an', v_an, 'numar', v_n, 'nr_afisat', public._hr_nr_afisat(r.serie, v_an, v_n, v_suf, r.data_emitere));
END $f$;

CREATE FUNCTION public.fn_hr_decizii_emitenti() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF public.fn_hr_decizii_poate('citire') IS NOT TRUE THEN RAISE EXCEPTION 'fără drepturi' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('profile_id', x.id, 'nume', x.name, 'employee_id', x.employee_id,
           'cale', CASE WHEN (x.t->>'owner')::boolean THEN 'owner' WHEN x.department = 'HR' THEN 'department = HR' ELSE 'hr.decizii' END)
           ORDER BY x.name), '[]')
    INTO v
    FROM (SELECT p.id, p.name, p.employee_id, p.department, public._hr_decizii_termeni(p.id) AS t FROM public.profiles p) x
   WHERE (x.t->>'owner')::boolean OR (x.t->>'hr')::boolean;
  RETURN v;
END $f$;

-- ─── 8. Confirmarea efectului (§3.4; RPC existent schimbat — OK explicit Răzvan) ──────────────────────
CREATE FUNCTION public._hr_completare_aplica_decizie(p_id bigint, p_accepta boolean, p_hr_decizie_id bigint, p_sursa text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  d public.hr_decizii; t public.hr_decizii; r public.executie_completari_propuse; tip public.hr_decizii_tipuri; v_motiv text;
  v_cur text; g record; v_n int; v_reg bigint;
BEGIN
  IF p_sursa NOT IN ('decizie_numire','decizie_revocare') THEN RAISE EXCEPTION 'propunere necorelata cu decizia'; END IF;
  SELECT * INTO d FROM public.hr_decizii WHERE id = p_hr_decizie_id FOR UPDATE;            -- (1) decizia
  IF NOT FOUND THEN RAISE EXCEPTION 'propunere necorelata cu decizia'; END IF;
  IF p_sursa = 'decizie_revocare' AND d.revoca_id IS NOT NULL THEN
    SELECT * INTO t FROM public.hr_decizii WHERE id = d.revoca_id FOR SHARE;               -- (2) ținta revocării
  END IF;
  SELECT * INTO r FROM public.executie_completari_propuse WHERE id = p_id AND status = 'propus' FOR UPDATE;   -- (3) propunerea
  IF NOT FOUND THEN RAISE EXCEPTION 'propunerea nu există sau a fost deja decisă'; END IF;
  IF r.hr_decizie_id IS DISTINCT FROM p_hr_decizie_id OR r.sursa IS DISTINCT FROM p_sursa THEN RAISE EXCEPTION 'propunere necorelata cu decizia'; END IF;
  IF p_accepta AND p_sursa = 'decizie_numire' THEN
    SELECT * INTO tip FROM public.hr_decizii_tipuri WHERE cod = d.tip_cod;
    v_motiv := public._hr_decizie_motiv_neeligibil(d.id);
    IF v_motiv IS NOT NULL THEN RAISE EXCEPTION 'decizia nu mai e in vigoare (%)', v_motiv; END IF;
    IF r.proiect_id IS DISTINCT FROM d.proiect_id OR r.camp IS DISTINCT FROM tip.camp_efect OR r.valoare IS DISTINCT FROM d.employee_id::text THEN
      RAISE EXCEPTION 'propunere necorelata cu decizia';
    END IF;
    IF d.data_efect IS NOT NULL AND d.data_efect > public._hr_azi() THEN
      RAISE EXCEPTION 'efect de la %', to_char(d.data_efect, 'DD.MM.YYYY');
    END IF;
    -- golirile pe același (proiect, câmp) se blochează ÎNAINTEA proiectului (Vr4-1)
    PERFORM 1 FROM public.executie_completari_propuse p
      WHERE p.proiect_id = r.proiect_id AND p.camp = r.camp AND p.sursa = 'decizie_revocare' AND p.status = 'propus'
      ORDER BY p.id FOR UPDATE;
    PERFORM public._completare_scrie_camp(r.proiect_id, r.camp, r.valoare);
    FOR g IN SELECT p.id FROM public.executie_completari_propuse p
              WHERE p.proiect_id = r.proiect_id AND p.camp = r.camp AND p.sursa = 'decizie_revocare' AND p.status = 'propus' ORDER BY p.id LOOP
      UPDATE public.executie_completari_propuse SET status = 'expirat', decis_de = auth.uid(), decis_la = now() WHERE id = g.id;
      PERFORM public._hr_ev(d.id, 'propunere_expirata', NULL, NULL, jsonb_build_object('propunere_id', g.id,
        'motiv', 'echipa schimbata prin numirea nr ' || public._hr_nr_afisat(d.serie, d.an, d.numar, d.numar_sufix, d.data_emitere)));
    END LOOP;
  ELSIF p_accepta AND p_sursa = 'decizie_revocare' THEN
    IF d.tip_cod <> 'REVOCARE' OR d.stare <> 'semnata' OR t.id IS NULL OR t.stare <> 'revocata' THEN RAISE EXCEPTION 'propunere necorelata cu decizia'; END IF;
    SELECT * INTO tip FROM public.hr_decizii_tipuri WHERE cod = t.tip_cod;
    IF r.camp IS DISTINCT FROM tip.camp_efect OR r.proiect_id IS DISTINCT FROM t.proiect_id OR t.employee_id IS NULL THEN
      RAISE EXCEPTION 'propunere necorelata cu decizia';
    END IF;
    v_cur := public._hr_valoare_camp(r.proiect_id, r.camp);
    IF v_cur IS DISTINCT FROM t.employee_id::text THEN
      RAISE EXCEPTION 'echipa nu-l mai are pe %; propunerea nu mai e necesara', coalesce(t.snapshot->'persoana'->>'nume', t.employee_id::text);
    END IF;
    SELECT c.id INTO v_reg FROM public.hr_decizii c JOIN public.hr_decizii_tipuri ct ON ct.cod = c.tip_cod
     WHERE c.stare = 'semnata' AND c.proiect_id = r.proiect_id AND ct.camp_efect = r.camp AND c.employee_id = t.employee_id
       AND c.id <> t.id AND public._hr_decizie_eligibila_efect(c.id) AND (c.data_efect IS NULL OR c.data_efect <= public._hr_azi())
     ORDER BY c.id DESC LIMIT 1;
    IF v_reg IS NOT NULL THEN
      RAISE EXCEPTION '% are o decizie in vigoare (#%); respinge golirea', coalesce(t.snapshot->'persoana'->>'nume', t.employee_id::text), v_reg;
    END IF;
    v_n := public._completare_goleste_camp(r.proiect_id, r.camp, t.employee_id);
    IF v_n <> 1 THEN RAISE EXCEPTION 'echipa s-a schimbat intre timp; propunerea nu mai e necesara'; END IF;
  END IF;
  UPDATE public.executie_completari_propuse SET status = CASE WHEN p_accepta THEN 'confirmat' ELSE 'respins' END, decis_de = auth.uid(), decis_la = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'camp', r.camp, 'aplicat', p_accepta);
END $f$;

CREATE OR REPLACE FUNCTION public.fn_completare_aplica(p_id bigint, p_accepta boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.executie_completari_propuse; v_ok boolean; v_hd bigint; v_sursa text;
BEGIN
  SELECT (p.is_owner OR p.can_manage_contracts) INTO v_ok FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'fără drepturi'; END IF;
  -- 20261018a: propunerile legate de o decizie HR merg pe calea lor (decizia se blochează ÎNAINTEA propunerii, J2-4)
  SELECT c.hr_decizie_id, c.sursa INTO v_hd, v_sursa FROM public.executie_completari_propuse c WHERE c.id = p_id;
  IF v_hd IS NOT NULL THEN RETURN public._hr_completare_aplica_decizie(p_id, p_accepta, v_hd, v_sursa); END IF;
  SELECT * INTO r FROM public.executie_completari_propuse WHERE id = p_id AND status = 'propus' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'propunerea nu există sau a fost deja decisă'; END IF;
  IF r.hr_decizie_id IS NOT NULL OR r.sursa IN ('decizie_numire','decizie_revocare') THEN RAISE EXCEPTION 'propunere necorelata cu decizia'; END IF;
  IF p_accepta THEN
    IF r.camp NOT IN ('rte_employee_id','rts_employee_id','mp_employee_id','coordonator_transgaz','garantie_buna_exec_pct','penalitati_zi_pct',
                      'valoare_lei','valoare_eur','data_start','data_termen','durata_contract_luni','nr_contract','data_contract','beneficiar_final','lungime_proiect_m') THEN
      RAISE EXCEPTION 'câmp nepermis: %', r.camp;
    END IF;
    PERFORM public._completare_scrie_camp(r.proiect_id, r.camp, r.valoare);
  END IF;
  UPDATE public.executie_completari_propuse SET status = CASE WHEN p_accepta THEN 'confirmat' ELSE 'respins' END, decis_de = auth.uid(), decis_la = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'camp', r.camp, 'aplicat', p_accepta);
END $function$;

-- ─── 9. Triggere (§3.4) ─────────────────────────────────────────────────────────────────────────────────
-- Imuabilitate: SECURITY INVOKER obligatoriu (Vf2) — decide pe current_user (rolurile API); RPC-urile (owner postgres) trec.
CREATE FUNCTION public._hr_trg_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
BEGIN
  IF current_user NOT IN ('authenticated','anon','service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.stare <> 'draft' THEN RAISE EXCEPTION 'decizia % nu e draft: nu se sterge', OLD.id USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare <> 'draft' OR NEW.origine <> 'platforma' OR NEW.serie <> 'HR' OR NEW.numar IS NOT NULL OR NEW.an IS NOT NULL
       OR NEW.numar_sufix <> '' OR NEW.mod_numar IS NOT NULL OR NEW.versiune <> 1 OR NEW.snapshot <> '{}'::jsonb OR NEW.continut IS NOT NULL
       OR NEW.cod_verificare IS NOT NULL OR NEW.avertismente <> '[]'::jsonb OR NEW.motiv_anulare IS NOT NULL
       OR NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.scan_path IS NOT NULL OR NEW.scan_sha256 IS NOT NULL
       OR NEW.emis_de IS NOT NULL OR NEW.emis_la IS NOT NULL OR NEW.scan_de IS NOT NULL OR NEW.scan_la IS NOT NULL
       OR NEW.anulat_de IS NOT NULL OR NEW.anulat_la IS NOT NULL OR NEW.cerere_id IS NOT NULL OR NEW.cerere_hash IS NOT NULL
       OR NEW.cerere_emitere IS NOT NULL OR NEW.cerere_emitere_hash IS NOT NULL OR NEW.descriere IS NOT NULL THEN
      RAISE EXCEPTION 'din client se creeaza doar drafturi curate' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.stare <> 'draft' OR NEW.stare <> 'draft' THEN RAISE EXCEPTION 'decizia nu e draft: se modifica doar prin RPC' USING ERRCODE = '42501'; END IF;
  IF (NEW.serie, NEW.an, NEW.numar, NEW.numar_sufix, NEW.mod_numar, NEW.origine, NEW.versiune, NEW.snapshot, NEW.continut, NEW.cod_verificare,
      NEW.avertismente, NEW.motiv_anulare, NEW.pdf_path, NEW.pdf_sha256, NEW.scan_path, NEW.scan_sha256, NEW.creat_de, NEW.creat_la,
      NEW.emis_de, NEW.emis_la, NEW.scan_de, NEW.scan_la, NEW.anulat_de, NEW.anulat_la, NEW.cerere_id, NEW.cerere_hash,
      NEW.cerere_emitere, NEW.cerere_emitere_hash, NEW.descriere, NEW.id)
     IS DISTINCT FROM
     (OLD.serie, OLD.an, OLD.numar, OLD.numar_sufix, OLD.mod_numar, OLD.origine, OLD.versiune, OLD.snapshot, OLD.continut, OLD.cod_verificare,
      OLD.avertismente, OLD.motiv_anulare, OLD.pdf_path, OLD.pdf_sha256, OLD.scan_path, OLD.scan_sha256, OLD.creat_de, OLD.creat_la,
      OLD.emis_de, OLD.emis_la, OLD.scan_de, OLD.scan_la, OLD.anulat_de, OLD.anulat_la, OLD.cerere_id, OLD.cerere_hash,
      OLD.cerere_emitere, OLD.cerere_emitere_hash, OLD.descriere, OLD.id) THEN
    RAISE EXCEPTION 'coloanele serverului nu se modifica din client' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;

-- Revocarea copiază din țintă (C12, Vf7, J18).
CREATE FUNCTION public._hr_trg_revocare() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE t public.hr_decizii;
BEGIN
  SELECT * INTO t FROM public.hr_decizii WHERE id = NEW.revoca_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tinta revocarii % nu exista', NEW.revoca_id; END IF;
  IF t.tip_cod IN ('REVOCARE','ALTA_DECIZIE') THEN RAISE EXCEPTION 'tinta unei revocari trebuie sa fie o numire'; END IF;
  NEW.nivel := t.nivel; NEW.proiect_id := t.proiect_id; NEW.proiect_denumire := coalesce(NEW.proiect_denumire, t.proiect_denumire);
  NEW.employee_id := t.employee_id; NEW.persoana_nume := t.persoana_nume; NEW.eticheta_functie := t.eticheta_functie;
  NEW.titlu := coalesce(t.titlu, NEW.titlu); NEW.propune_efect := false; NEW.autorizatie_id := NULL; NEW.domenii_isc := NULL;
  RETURN NEW;
END $f$;

CREATE FUNCTION public._hr_trg_versiune() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$ BEGIN NEW.versiune := OLD.versiune + 1; RETURN NEW; END $f$;

-- Jurnalul operațiilor pe draft (J1, Vf11): SECURITY DEFINER (clientul nu scrie în jurnal).
CREATE FUNCTION public._hr_trg_jurnal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._hr_ev(NEW.id, 'creare', NULL, 'draft', jsonb_build_object('tip_cod', NEW.tip_cod));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._hr_ev(NEW.id, 'modificare_draft', 'draft', 'draft', jsonb_build_object('versiune', NEW.versiune));
  ELSE
    PERFORM public._hr_ev(OLD.id, 'stergere_draft', 'draft', NULL, to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $f$;

CREATE FUNCTION public._hr_trg_jurnal_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$ BEGIN RAISE EXCEPTION 'jurnalul registrului HR e insert-only' USING ERRCODE = '42501'; END $f$;

CREATE TRIGGER trg_hr_decizii_a_imuabil BEFORE INSERT OR UPDATE OR DELETE ON public.hr_decizii
  FOR EACH ROW EXECUTE FUNCTION public._hr_trg_imuabil();
CREATE TRIGGER trg_hr_decizii_b_revocare BEFORE INSERT OR UPDATE ON public.hr_decizii
  FOR EACH ROW WHEN (NEW.tip_cod = 'REVOCARE' AND NEW.stare = 'draft') EXECUTE FUNCTION public._hr_trg_revocare();
CREATE TRIGGER trg_hr_decizii_c_versiune BEFORE UPDATE ON public.hr_decizii
  FOR EACH ROW WHEN (OLD.stare = 'draft' AND NEW.stare = 'draft') EXECUTE FUNCTION public._hr_trg_versiune();
CREATE TRIGGER trg_hr_decizii_jurnal_ins AFTER INSERT ON public.hr_decizii
  FOR EACH ROW WHEN (NEW.stare = 'draft') EXECUTE FUNCTION public._hr_trg_jurnal();
CREATE TRIGGER trg_hr_decizii_jurnal_upd AFTER UPDATE ON public.hr_decizii
  FOR EACH ROW WHEN (OLD.stare = 'draft' AND NEW.stare = 'draft') EXECUTE FUNCTION public._hr_trg_jurnal();
CREATE TRIGGER trg_hr_decizii_jurnal_del AFTER DELETE ON public.hr_decizii
  FOR EACH ROW WHEN (OLD.stare = 'draft') EXECUTE FUNCTION public._hr_trg_jurnal();
CREATE TRIGGER trg_hr_decizii_evenimente_imuabil BEFORE UPDATE OR DELETE ON public.hr_decizii_evenimente
  FOR EACH ROW EXECUTE FUNCTION public._hr_trg_jurnal_imuabil();
CREATE TRIGGER trg_hr_decizii_evenimente_fara_truncate BEFORE TRUNCATE ON public.hr_decizii_evenimente
  FOR EACH STATEMENT EXECUTE FUNCTION public._hr_trg_jurnal_imuabil();

-- ─── 10. RLS, GRANT (§3.4) ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hr_decizii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_evenimente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_contor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_semnatari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_decizii_tipuri ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.hr_decizii, public.hr_decizii_evenimente, public.hr_decizii_contor, public.hr_decizii_semnatari, public.hr_decizii_tipuri
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON public.hr_decizii TO authenticated;
GRANT INSERT (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id, domenii_isc, titlu, temei,
              data_emitere, data_efect, data_efect_pana, semnatar_id, luare_la_cunostinta, propune_efect, inlocuieste_id, revoca_id)
  ON public.hr_decizii TO authenticated;
GRANT UPDATE (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id, domenii_isc, titlu, temei,
              data_emitere, data_efect, data_efect_pana, semnatar_id, luare_la_cunostinta, propune_efect, inlocuieste_id, revoca_id)
  ON public.hr_decizii TO authenticated;
GRANT SELECT ON public.hr_decizii, public.hr_decizii_evenimente, public.hr_decizii_contor, public.hr_decizii_semnatari, public.hr_decizii_tipuri
  TO service_role;
GRANT SELECT ON public.hr_decizii_evenimente, public.hr_decizii_contor, public.hr_decizii_semnatari, public.hr_decizii_tipuri TO authenticated;

CREATE POLICY hr_decizii_select ON public.hr_decizii FOR SELECT TO authenticated
  USING (public.fn_hr_decizii_poate('citire')
         OR (nivel = 'proiect' AND stare <> 'draft' AND tip_cod <> 'ALTA_DECIZIE' AND public.fn_hr_decizii_poate('citire_doc', id)));
CREATE POLICY hr_decizii_insert ON public.hr_decizii FOR INSERT TO authenticated
  WITH CHECK (public.fn_hr_decizii_poate('redactare') AND stare = 'draft' AND numar IS NULL AND origine = 'platforma' AND creat_de = auth.uid());
CREATE POLICY hr_decizii_update ON public.hr_decizii FOR UPDATE TO authenticated
  USING (stare = 'draft' AND public.fn_hr_decizii_poate('redactare'))
  WITH CHECK (stare = 'draft' AND numar IS NULL);
CREATE POLICY hr_decizii_delete ON public.hr_decizii FOR DELETE TO authenticated
  USING (stare = 'draft' AND public.fn_hr_decizii_poate('redactare') AND (creat_de = auth.uid() OR public.fn_hr_decizii_poate('owner')));
CREATE POLICY hr_decizii_evenimente_select ON public.hr_decizii_evenimente FOR SELECT TO authenticated
  USING (public.fn_hr_decizii_poate('citire'));
CREATE POLICY hr_decizii_contor_select ON public.hr_decizii_contor FOR SELECT TO authenticated
  USING (public.fn_hr_decizii_poate('citire'));
CREATE POLICY hr_decizii_semnatari_select ON public.hr_decizii_semnatari FOR SELECT TO authenticated
  USING (public.fn_hr_decizii_poate('citire'));
CREATE POLICY hr_decizii_tipuri_select ON public.hr_decizii_tipuri FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Politica existentă completari_ins (J5, P3-2): aceeași condiție + fără propuneri „de decizie” din client
ALTER POLICY completari_ins ON public.executie_completari_propuse
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.can_manage_contracts))
              AND hr_decizie_id IS NULL AND sursa NOT IN ('decizie_numire','decizie_revocare'));

-- ─── 11. View (§3.2) ────────────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.v_hr_decizii_curente WITH (security_invoker = on) AS
SELECT d.id, d.serie, d.an, d.numar, d.numar_sufix,
       d.numar::text || CASE WHEN d.numar_sufix <> '' THEN '-' || d.numar_sufix ELSE '' END || '/'
         || CASE WHEN d.data_emitere IS NOT NULL THEN to_char(d.data_emitere, 'DD.MM.YYYY') ELSE d.an::text END AS nr_afisat,
       d.data_emitere, d.tip_cod, t.rol_cod, t.camp_efect, d.eticheta_functie, d.nivel,
       d.employee_id, coalesce(d.snapshot->'persoana'->>'nume', d.persoana_nume) AS nume, d.proiect_id, d.domenii_isc,
       d.data_efect, d.data_efect_pana, d.stare, d.stare = 'semnata' AS semnata
  FROM public.hr_decizii d
  JOIN public.hr_decizii_tipuri t ON t.cod = d.tip_cod
  LEFT JOIN public.executie_proiecte p ON p.id = d.proiect_id
 WHERE d.stare IN ('emisa','semnata')
   AND d.tip_cod NOT IN ('REVOCARE','ALTA_DECIZIE')
   AND (d.data_efect IS NULL OR d.data_efect <= public._hr_azi())
   AND (d.data_efect_pana IS NULL OR d.data_efect_pana >= public._hr_azi())
   AND (d.nivel = 'firma' OR coalesce(p.activ, false));
REVOKE ALL ON public.v_hr_decizii_curente FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_hr_decizii_curente TO authenticated, service_role;

-- ─── 12. Bucket hr-decizii (§3.5): doar PDF, 20 MB, fără UPDATE/DELETE (VA19) ─────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('hr-decizii', 'hr-decizii', false, 20971520, ARRAY['application/pdf']);
CREATE POLICY hr_decizii_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-decizii' AND public.fn_hr_decizii_storage_poate(name, 'select'));
CREATE POLICY hr_decizii_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-decizii' AND public.fn_hr_decizii_storage_poate(name, 'insert'));

-- ─── 13. Drepturi pe funcții (Vf3): totul retras, apoi EXECUTE doar pe cele publice ────────────────────
DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.proname LIKE '\_hr\_%' OR p.proname LIKE 'fn\_hr\_decizi%' OR p.proname LIKE '\_completare\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f.sig);
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public._hr_azi() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_poate(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_id_din_cale(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_storage_poate(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_urmatorul_numar(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_contor_initializeaza(int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_contor_opreste_auto(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_contor_corecteaza(int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_contor_corecteaza_baza(int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_previzualizeaza(bigint, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_emite(bigint, text, uuid, int, int, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_seteaza_pdf(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_ataseaza_scan(bigint, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_inlocuieste_scan(bigint, uuid, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_anuleaza(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_rezerva(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizie_importa(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hr_decizii_emitenti() TO authenticated;

-- ─── 14. Seed (§3.1, §5.3; D2, D4, D6) ─────────────────────────────────────────────────────────────────
INSERT INTO public.hr_decizii_semnatari (employee_id, calitate, este_reprezentant_legal, preambul_text, bloc_semnatura, preambul_validat, ordine)
VALUES
  (121, 'Administrator', true,
   'D-nul TRUSU RAZVAN MIHAIL, reprezentant legal al S.C. GAZPET INSTAL SRL cu sediul in Ploiesti, str. Fluturilor, nr. 34, inregistrata la Registrul Comertului sub nr. J2007001650296 cod fiscal RO 22029920 in calitate de angajator;',
   'Administrator' || chr(10) || 'Trusu Razvan,', true, 1),
  (90, 'Imputernicit', false,
   'S.C. GAZPET INSTAL SRL cu sediul in Ploiesti, str. Fluturilor, nr. 34, inregistrata la Registrul Comertului sub nr. J2007001650296 cod fiscal RO 22029920, reprezentata legal prin D-nul TRUSU RAZVAN MIHAIL, administrator, prin D-nul PANTEA CONSTANTIN, imputernicit[[ prin {imputernicire}]], in calitate de angajator;',
   'Pentru Administrator,' || chr(10) || 'Pantea Constantin', false, 2),
  (125, 'Imputernicita', false,
   'S.C. GAZPET INSTAL SRL cu sediul in Ploiesti, str. Fluturilor, nr. 34, inregistrata la Registrul Comertului sub nr. J2007001650296 cod fiscal RO 22029920, reprezentata legal prin D-nul TRUSU RAZVAN MIHAIL, administrator, prin D-na TUDORACHE MARILENA CLAUDIA, imputernicita[[ prin {imputernicire}]], in calitate de angajator;',
   'Pentru Administrator,' || chr(10) || 'Tudorache Marilena', false, 3);

-- Textele P „se numeste” urmează 913/915/916 (28.09.2026), inclusiv spațiul dinaintea virgulei după dată.
INSERT INTO public.hr_decizii_tipuri (cod, denumire, eticheta_functie, etichete_alternative, nivel, are_sablon, art1_proiect, art1_firma,
    temei_implicit, temei_sursa, autorizatie_tipuri, autorizatie_ceruta, necesita_domeniu_isc, camp_efect, rol_cod, unic_activ, ordine)
VALUES
  ('RTE', 'Responsabil tehnic cu executia (RTE)', 'RTE', '{}', 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de RTE pentru {domenii}[[, in baza Autorizatiei nr. {aut_nr}/{aut_data}]] in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, NULL, 'model_nas', ARRAY['RTE'], 'obligatorie', true, 'rte_employee_id', 'rte', true, 1),
  ('RTE_MEC', 'RTE atestat MEC', 'RTE atestat MEC', '{}', 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de RTE atestat MEC[[, in baza atestatului nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, 'Ord. 364/2010', 'propunere', ARRAY['RTE_MONTAJ_IT'], 'recomandata', false, NULL, NULL, true, 2),
  ('RTS', 'Responsabil tehnic cu sudura (RTS)', 'Responsabil Tehnic cu Sudura', '{}', 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de Responsabil Tehnic cu Sudura[[ in baza atestatului {aut_emitent} nr. {aut_nr}]] in cadrul proiectului „{proiect}”, contract nr. {contract}',
   NULL, NULL, 'model_nas', ARRAY['RTS'], 'obligatorie', false, 'rts_employee_id', NULL, true, 3),
  ('SEF_SANTIER', 'Sef de santier', 'Sef Santier', ARRAY['Sef de santier'], 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, NULL, 'model_nas', NULL, 'nu', false, NULL, 'sef_santier', true, 4),
  ('MP', 'Manager de proiect', 'Manager Proiect', ARRAY['Manager de proiect'], 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, NULL, 'model_nas', ARRAY['MANAGER_PROIECT_240','MANAGER_PROIECT_60'], 'recomandata', false, 'mp_employee_id', 'manager_proiect', true, 5),
  ('CTC_QC', 'Responsabil CTC / CQ / AQ', 'Responsabil CTC', ARRAY['Responsabil CQ','Responsabil cu Asigurarea Calitatii (AQ)'], 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, NULL, 'model_nas', NULL, 'nu', false, NULL, 'responsabil_cq', true, 6),
  ('INSPECTOR_SSM', 'Inspector SSM pe proiect', 'Inspector Sanatate si Securitate in Munca', ARRAY['Responsabil SSM'], 'proiect', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   NULL, NULL, 'model_nas', ARRAY['INSPECTOR_SSM_80','INSPECTOR_SSM_40'], 'recomandata', false, NULL, 'responsabil_ssm', true, 7),
  ('LUCRATOR_DESEMNAT_SSM', 'Lucrator desemnat SSM (firma)', 'Lucrator desemnat SSM', '{}', 'firma', true, NULL,
   'Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de lucrator desemnat privind prevenirea si protectia cat si cadru SSM conform art. 14 si art. 20 din HGR 1425/2006 actualizata prin HGR 955/2010.',
   NULL, 'model_nas', ARRAY['INSPECTOR_SSM_80','INSPECTOR_SSM_40'], 'recomandata', false, NULL, NULL, true, 8),
  ('COORDONATOR_SSM', 'Coordonator SSM', 'Coordonator Sanatate si Securitate in Munca', ARRAY['Coordonator SSM'], 'ambele', true,
   'Incepand cu data de {data_efect} , {titlu} {nume} se numeste in functia de {functie} in cadrul proiectului „{proiect}”, contract de executie a lucrarilor nr. {contract}',
   'Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de Coordonator SSM conform HGR 300/2006 actualizata.',
   NULL, 'model_nas', ARRAY['COORDONATOR_SSM_90'], 'obligatorie', false, NULL, NULL, true, 9),
  ('RSVTI', 'RSVTI', 'RSVTI', '{}', 'firma', true, NULL,
   'Incepand cu data de {data_efect}, {titlu} {nume} se numeste in functia de Responsabil cu Supravegherea si Verificarea Tehnica a Instalatiilor (RSVTI)[[, in baza Autorizatiei ISCIR nr. {aut_nr}]][[, valabila pana la {aut_expirare}]], conform {temei}.',
   'Legea 64/2008 republicata si prescriptiile tehnice ISCIR', 'propunere', ARRAY['RSVTI'], 'obligatorie', false, NULL, NULL, true, 10),
  ('PSI', 'Responsabil PSI / SU', 'Responsabil PSI', ARRAY['Responsabil SU','Responsabil PSI / SU'], 'ambele', true,
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, in cadrul proiectului „{proiect}”.',
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 12 din Legea 307/2006 si art. 13 din Legea 481/2004.',
   NULL, 'model_nas', ARRAY['CADRU_TEHNIC_PSI'], 'recomandata', false, NULL, NULL, true, 11),
  ('MEDIU', 'Responsabil de mediu', 'Responsabil de mediu', '{}', 'ambele', true,
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, in cadrul proiectului „{proiect}”',
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 2 din Ordinul 175/2005 si art. 94 din OUG nr. 195/2005',
   NULL, 'model_nas', ARRAY['RESPONSABIL_MEDIU'], 'recomandata', false, NULL, 'responsabil_mediu', true, 12),
  ('RESPONSABIL_DESEURI', 'Responsabil gestionarea deseurilor', 'Responsabil pentru gestionarea deseurilor',
   ARRAY['Responsabil deseuri','Responsabil gestiunea deseurilor'], 'ambele', true,
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, in cadrul proiectului „{proiect}”.',
   'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}.',
   NULL, 'model_nas', ARRAY['RESPONSABIL_DESEURI'], 'recomandata', false, NULL, 'responsabil_deseuri', true, 13),
  ('REVOCARE', 'Revocare', 'Revocare', '{}', 'ambele', true,
   'Incepand cu data de {data_efect}, se revoca Decizia nr. {nr_tinta} privind numirea {titlu} {nume_tinta} in functia de {functie_tinta}.',
   'Incepand cu data de {data_efect}, se revoca Decizia nr. {nr_tinta} privind numirea {titlu} {nume_tinta} in functia de {functie_tinta}.',
   NULL, 'propunere', NULL, 'nu', false, NULL, NULL, false, 14),
  ('ALTA_DECIZIE', 'Alta decizie HR (doar numar)', 'Alta decizie', '{}', 'ambele', false, NULL, NULL,
   NULL, 'model_nas', NULL, 'nu', false, NULL, NULL, false, 15);
UPDATE public.hr_decizii_tipuri SET semnatar_implicit_id = (SELECT id FROM public.hr_decizii_semnatari WHERE employee_id = 121);
UPDATE public.hr_decizii_tipuri SET art_valabilitate_proiect = 'Aceasta decizie isi pastreaza valabilitatea pana la receptia definitiva a lucrarii.'
 WHERE nivel IN ('proiect','ambele') AND cod NOT IN ('REVOCARE','ALTA_DECIZIE');

-- ─── 15. Postcondiții ───────────────────────────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF (SELECT count(*) FROM public.hr_decizii_tipuri) <> 15 OR (SELECT count(*) FROM public.hr_decizii_semnatari) <> 3
     OR EXISTS (SELECT 1 FROM public.hr_decizii_tipuri WHERE semnatar_implicit_id IS DISTINCT FROM (SELECT id FROM public.hr_decizii_semnatari WHERE employee_id = 121))
     OR (SELECT count(*) FROM public.hr_decizii_semnatari WHERE este_reprezentant_legal) <> 1 THEN
    RAISE EXCEPTION 'Postcondiție 1: seed incomplet';
  END IF;
  -- test 66: pe tipurile cu atestat, {aut_*} apar doar în segmente opționale
  IF EXISTS (SELECT 1 FROM public.hr_decizii_tipuri t, unnest(ARRAY[t.art1_proiect, t.art1_firma]) a(x)
              WHERE t.autorizatie_ceruta <> 'nu' AND a.x IS NOT NULL AND regexp_replace(a.x, '\[\[[^]]*\]\]', '', 'g') ~ '[{]aut_') THEN
    RAISE EXCEPTION 'Postcondiție 2: {aut_*} in afara unui segment optional';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%sef_santier_employee_id%') THEN
    RAISE EXCEPTION 'Postcondiție 3: un corp de funcție numește sef_santier_employee_id (revenirea 20261017a ar fi blocată)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public._hr_trg_imuabil()'::regprocedure) THEN
    RAISE EXCEPTION 'Postcondiție 4: triggerul de imuabilitate trebuie sa fie SECURITY INVOKER (Vf2)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '\_hr\_%' AND p.proname <> '_hr_azi'
              AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'Postcondiție 5: o functie interna _hr_* are EXECUTE pentru rolurile API';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['hr_decizii','hr_decizii_evenimente','hr_decizii_contor','hr_decizii_semnatari','hr_decizii_tipuri']) t(n),
                           unnest(ARRAY['anon','service_role']) r(n2), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) pr(n3)
              WHERE has_table_privilege(r.n2, 'public.' || t.n, pr.n3)) THEN
    RAISE EXCEPTION 'Postcondiție 6: anon/service_role au drept de scriere pe registru';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'hr.decizii') THEN RAISE EXCEPTION 'Postcondiție 7: hr.decizii in app_modules'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_completare_aplica(bigint,boolean)')) ~* 'execute' THEN
    RAISE EXCEPTION 'Postcondiție 8: fn_completare_aplica nu trebuie sa mai contina SQL dinamic (gate 0e)';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261018a_hr_decizii_registru:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261018a: garda de livrare (final)';
  END IF;
END
$livrare_final$;
