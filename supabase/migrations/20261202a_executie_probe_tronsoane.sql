-- Version 20261202120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261202a_executie_probe_tronsoane — Execuție: probele pe tronsoane (cererea lui Răzvan, 09.11.2026, Lot 1).
--
-- Ce face:
--   * executie_probe_tronsoane: „tronsonul de probă” = un interval de km (km_de_la_m, km_pana_la_m, în metri întregi de la originea
--     traseului, ca executie_tronsoane.km_start_m / km_end_m) pe un proiect, cu un cod (P1, P2…). Intervalele ACTIVE ale aceluiași
--     proiect nu se suprapun: constrângere EXCLUDE (gist pe int8range(proiect) && int4range(km), tipuri de bază, fără extensii),
--     plus verificarea cu mesaj clar în RPC. Din ce tronsoane de execuție e format (ex. P1 = T1 + T2 + T3 + 400 m din T4) se
--     calculează în aplicație din executie_tronsoane (nu se stochează: se schimbă singur când se corectează km-ii tronsoanelor).
--   * executie_probe_etape: cele 4 etape ale fiecărui tronson de probă, create odată cu el (pistonare / curățare, uscare, calibrare,
--     probă de presiune), fiecare cu starea ei (urmează / în curs / făcut / de refăcut / nu se aplică) și valorile ei:
--     nr. de treceri, punct de rouă, placa de calibrare OK / deformată, presiunea de probă, presiunea curentă (cu ora citirii,
--     pusă de server), durata, rezultat, observații. Coloanele unei etape sunt goale pe celelalte (CHECK).
--   * Proba de presiune se poate lega OPȚIONAL de modulul Probe existent (probe_calcule.id): PV-ul rămâne acolo, aici e doar legătura.
--     - „același proiect” e impus structural: FK compus (probe_calc_id, proiect_id) -> probe_calcule(id, proiect_id), cu un UNIQUE nou
--       (id, proiect_id) pe probe_calcule (trivial unic: id e PK). Un calcul legat nu mai poate fi mutat pe alt proiect (FK refuză), iar
--       FOR KEY SHARE din FK blochează și mutarea concurentă (proiect_id intră în cheia unică).
--     - ON DELETE SET NULL (probe_calc_id): ștergerea unui calcul din modulul Probe nu e blocată de Execuție (doar legătura se golește).
--     - Legarea (sau schimbarea legăturii) cere și dreptul de citire pe modulul Probe (probe_teren_drept(false), predicatul modulului);
--       păstrarea legăturii existente sau dezlegarea nu îl cer. Decizie explicită: fără excepție de acces între module.
--   * executie_probe_jurnal: jurnalul operațiilor, în ordine (creare, modificare de interval, anulare, fiecare schimbare de etapă),
--     scris DOAR de RPC-uri, niciodată modificat (trigger). Ține și cheia de idempotență a fiecărei apăsări (UNIQUE + amprentă).
--   * Scrierea din aplicație: DOAR prin cele 3 RPC-uri SECURITY DEFINER (fn_executie_proba_salveaza / _anuleaza / _etapa):
--     auth.uid() obligatoriu, drept pe proiect (owner sau user_module_access 'executie' editor / admin, prin fn_executie_nod_drept
--     din 20261201a — O SINGURĂ definiție a dreptului pe Execuție), lock, CAS pe versiune (+ stare la etape), tranziții din lista
--     albă, cheie de idempotență per apăsare. Nicio scriere directă (fără INSERT / UPDATE / DELETE pentru anon / authenticated /
--     service_role). Citirea: același drept, orice nivel (viewer citește), prin RLS.
-- Ce NU face: nicio dată (tronsoanele de probă le definesc oamenii din aplicație), niciun drept, nicio atingere pe executie_tronsoane
--   sau izo_*. Pe probe_calcule adaugă DOAR constrângerea UNIQUE (id, proiect_id) pentru FK-ul compus (scoasă de revenire).
-- Depinde de 20261201a (fn_executie_nod_drept) și de 20261114a (probe_teren_drept): amprentele lor (corpul normalizat, limbajul,
--   DEFINER, search_path, proprietarul, EXECUTE) sunt verificate la start. Cere PostgreSQL >= 15 (ON DELETE SET NULL (coloană)).
--   Revenirea lui 20261201a refuză cât timp politicile de aici o folosesc.
-- Ordinea lock-urilor (L06), aceeași pe toate căile:
--   advisory pe proiect (doar salveaza / anuleaza) -> executie_probe_tronsoane FOR UPDATE -> executie_probe_etape FOR UPDATE
--   -> (doar etapa, la orice legătură rezultată nenulă, nouă sau păstrată) probe_calcule FOR KEY SHARE NOWAIT -> INSERT în jurnal
--   (FOR KEY SHARE implicit pe părinți, deja blocați mai tare).
--   De ce NOWAIT pe calcul: o ștergere / mutare din modulul Probe blochează întâi calculele (în ordinea ei, posibil mai multe), apoi
--   golește / verifică legătura din etapă. Noi nu așteptăm NICIODATĂ un calcul ținând etapa: dacă e ocupat, refuz imediat (55P03,
--   nimic scris, „reîncearcă”). Astfel nu există ciclu, oricare ar fi ordinea ștergerilor din Probe. Legătura veche, înlocuită, nu se
--   blochează (FK-ul verifică doar valoarea nouă); legătura PĂSTRATĂ se blochează tot NOWAIT, pentru că FK-ul o reverifică atunci când
--   rândul etapei a fost scris deja în aceeași tranzacție. O golire a legăturii de către Probe (ON DELETE SET NULL) crește versiunea etapei (trigger),
--   deci un client care o vedea încă legată primește conflict (CAS), nu o re-legare tacită.
--   Revenirea ia toate lock-urile cu NOWAIT (refuz la contenție), deci nu intră nici ea în cicluri cu RPC-urile.
-- Revenire: supabase/revenire/20261202a_executie_probe_tronsoane_ROLLBACK.sql. Test pe clonă: scripts/test_executie_probe_tronsoane.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261202a_executie_probe_tronsoane:' || txid_current() THEN
    RAISE EXCEPTION '20261202a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261202a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_probe_tronsoane') IS NOT NULL OR to_regclass('public.executie_probe_etape') IS NOT NULL
     OR to_regclass('public.executie_probe_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proba\_%') THEN
    RAISE EXCEPTION '20261202a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; probe_calcule.id / proiect_id întregi)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR to_regclass('public.probe_calcule') IS NULL
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.probe_calcule') AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.probe_calcule') AND attname = 'proiect_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.probe_calcule') AND contype = 'p'
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.probe_calcule') AND attname = 'id')]::int2[])
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261202a: dependentele (executie_proiecte.id bigint, probe_calcule.id PK / proiect_id, auth.uid) difera';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '20261202a: necesita PostgreSQL >= 15 (ON DELETE SET NULL pe o coloana)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.probe_calcule') AND conname = 'probe_calcule_id_proiect_uq')
     OR to_regclass('public.probe_calcule_id_proiect_uq') IS NOT NULL THEN
    RAISE EXCEPTION '20261202a: probe_calcule_id_proiect_uq exista deja (reaplicare)';
  END IF;
  -- L15: funcțiile de drept folosite de politici / RPC-uri, cu amprenta revizuită în PR (fiecare apelează doar auth.uid() și citește
  -- profiles / user_module_access; executie_proiecte în plus la prima). Corpul se compară după scoaterea CR (checkout Windows).
  --   fn_executie_nod_drept (20261201a): md5 144649bae9a218b41b7e6df90cba5d9e
  --   probe_teren_drept (20261114a):     md5 9873647ecb1a8aedad274e24e6d32da9
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '144649bae9a218b41b7e6df90cba5d9e'),
               ('public.probe_teren_drept(boolean)', '9873647ecb1a8aedad274e24e6d32da9')) a(semnatura, amprenta)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL
                 OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
                 OR p.prosecdef IS NOT TRUE
                 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype::oid
                 OR p.provolatile IS DISTINCT FROM 's'
                 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261202a: fn_executie_nod_drept (20261201a) sau probe_teren_drept (20261114a) lipsesc sau difera de amprenta revizuita: aplica intai 20261201a / verifica';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261202a: auth.uid() lipseste sau difera';
  END IF;
END $pre$;

-- ── probe_calcule: cheia (id, proiect_id) pentru FK-ul compus al legăturii (trivial unică: id e PK; preflight-ul a verificat PK-ul) ──
ALTER TABLE public.probe_calcule ADD CONSTRAINT probe_calcule_id_proiect_uq UNIQUE (id, proiect_id);
COMMENT ON CONSTRAINT probe_calcule_id_proiect_uq ON public.probe_calcule IS
  'Pentru FK-ul compus executie_probe_etape (probe_calc_id, proiect_id): legătura Execuție -> Probe rămâne pe același proiect. 20261202a.';

-- ── tronsoanele de probă ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_probe_tronsoane (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  cod text NOT NULL CHECK (cod ~ '^P[0-9]{1,3}[A-Z]?$'),
  denumire text CHECK (denumire IS NULL OR (length(denumire) BETWEEN 1 AND 200 AND denumire ~ '[^[:space:]]')),
  km_de_la_m integer NOT NULL CHECK (km_de_la_m BETWEEN 0 AND 999999),
  km_pana_la_m integer NOT NULL CHECK (km_pana_la_m BETWEEN 1 AND 1000000),
  observatii text CHECK (observatii IS NULL OR (length(observatii) BETWEEN 1 AND 2000 AND observatii ~ '[^[:space:]]')),
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  motiv_anulare text CHECK (motiv_anulare IS NULL OR (length(motiv_anulare) BETWEEN 1 AND 500 AND motiv_anulare ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_probe_tronsoane_interval CHECK (km_pana_la_m > km_de_la_m),
  CONSTRAINT executie_probe_tronsoane_anulare CHECK ((stare = 'anulat') = (motiv_anulare IS NOT NULL)),
  CONSTRAINT executie_probe_tronsoane_id_proiect_uq UNIQUE (id, proiect_id),
  -- intervalele active ale aceluiași proiect nu se suprapun; capetele se pot atinge ([de_la, pana_la): P1 0–2000 și P2 2000–5000 merg)
  CONSTRAINT executie_probe_tronsoane_fara_suprapunere EXCLUDE USING gist (
    int8range(proiect_id, proiect_id, '[]') WITH &&, int4range(km_de_la_m, km_pana_la_m, '[)') WITH &&) WHERE (stare = 'activ')
);
-- codul e unic pe proiect între tronsoanele active (unul anulat își eliberează codul)
CREATE UNIQUE INDEX executie_probe_tronsoane_cod_uq ON public.executie_probe_tronsoane (proiect_id, cod) WHERE stare = 'activ';
CREATE INDEX executie_probe_tronsoane_proiect_idx ON public.executie_probe_tronsoane (proiect_id, id);
COMMENT ON TABLE public.executie_probe_tronsoane IS
  'Execuție: tronsoanele de probă (interval de km pe proiect, cod P1, P2…). Scriere DOAR prin fn_executie_proba_salveaza / _anuleaza. 20261202a.';
COMMENT ON COLUMN public.executie_probe_tronsoane.km_de_la_m IS 'Începutul intervalului, metri întregi de la originea traseului (ca executie_tronsoane.km_start_m). Interval [de_la, pana_la).';

-- ── etapele: câte 4 pe fiecare tronson de probă (create de RPC odată cu tronsonul) ─────────────────────────
CREATE TABLE public.executie_probe_etape (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proba_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  etapa text NOT NULL CHECK (etapa IN ('pistonare', 'uscare', 'calibrare', 'presiune')),
  stare text NOT NULL DEFAULT 'urmeaza' CHECK (stare IN ('urmeaza', 'in_curs', 'facut', 'refacere', 'nu_se_aplica')),
  data_start date,
  data_final date,
  data_stare date,
  nr_treceri integer CHECK (nr_treceri BETWEEN 1 AND 500),
  punct_roua_c numeric(5,1) CHECK (punct_roua_c BETWEEN -100 AND 50),
  placa text CHECK (placa IN ('ok', 'deformata')),
  fluid text CHECK (fluid IN ('apa', 'aer', 'azot')),
  presiune_proba_bar numeric(6,2) CHECK (presiune_proba_bar > 0 AND presiune_proba_bar <= 250),
  presiune_curenta_bar numeric(6,2) CHECK (presiune_curenta_bar >= 0 AND presiune_curenta_bar <= 300),
  presiune_curenta_la timestamptz,
  durata_ore numeric(6,1) CHECK (durata_ore > 0 AND durata_ore <= 2000),
  probe_calc_id bigint,
  rezultat text CHECK (rezultat IS NULL OR (length(rezultat) BETWEEN 1 AND 300 AND rezultat ~ '[^[:space:]]')),
  observatii text CHECK (observatii IS NULL OR (length(observatii) BETWEEN 1 AND 2000 AND observatii ~ '[^[:space:]]')),
  motiv text CHECK (motiv IS NULL OR (length(motiv) BETWEEN 1 AND 500 AND motiv ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_probe_etape_proba_fk FOREIGN KEY (proba_id, proiect_id) REFERENCES public.executie_probe_tronsoane (id, proiect_id),
  -- legătura cu modulul Probe: același proiect, impus structural (MATCH SIMPLE: fără legătură = fără verificare); ștergerea calculului
  -- golește doar probe_calc_id (proiect_id rămâne); mutarea unui calcul legat pe alt proiect = refuz (NO ACTION pe UPDATE)
  CONSTRAINT executie_probe_etape_calc_fk FOREIGN KEY (probe_calc_id, proiect_id) REFERENCES public.probe_calcule (id, proiect_id)
    ON UPDATE NO ACTION ON DELETE SET NULL (probe_calc_id),
  CONSTRAINT executie_probe_etape_uq UNIQUE (proba_id, etapa),
  CONSTRAINT executie_probe_etape_id_proba_uq UNIQUE (id, proba_id),
  -- coloanele unei etape sunt goale pe celelalte
  CONSTRAINT executie_probe_etape_campuri CHECK (
    (etapa = 'pistonare' OR nr_treceri IS NULL)
    AND (etapa = 'uscare' OR punct_roua_c IS NULL)
    AND (etapa = 'calibrare' OR placa IS NULL)
    AND (etapa = 'presiune' OR (fluid IS NULL AND presiune_proba_bar IS NULL AND presiune_curenta_bar IS NULL
                                AND presiune_curenta_la IS NULL AND durata_ore IS NULL AND probe_calc_id IS NULL))),
  CONSTRAINT executie_probe_etape_citire CHECK ((presiune_curenta_bar IS NULL) = (presiune_curenta_la IS NULL)),
  -- datele: o etapă pornită are început; doar una făcută are sfârșit (după început); orice schimbare are data ei
  CONSTRAINT executie_probe_etape_date CHECK (
    (stare = 'urmeaza' OR data_stare IS NOT NULL)
    AND (stare NOT IN ('in_curs', 'facut', 'refacere') OR data_start IS NOT NULL)
    AND ((stare = 'facut') = (data_final IS NOT NULL))
    AND (data_final IS NULL OR data_final >= data_start)),
  -- ce cere starea: motiv la „de refăcut” / „nu se aplică”; la „făcut” valorile de bază ale etapei; fără valori pe o etapă neîncepută
  CONSTRAINT executie_probe_etape_reguli CHECK (
    (stare NOT IN ('refacere', 'nu_se_aplica') OR motiv IS NOT NULL)
    AND (stare <> 'facut' OR etapa <> 'pistonare' OR nr_treceri IS NOT NULL)
    AND (stare <> 'facut' OR etapa <> 'calibrare' OR placa IS NOT DISTINCT FROM 'ok')   -- NULL nu trece (un CHECK cu NULL ar trece)
    AND (stare <> 'facut' OR etapa <> 'presiune' OR (presiune_proba_bar IS NOT NULL AND durata_ore IS NOT NULL))
    AND (stare NOT IN ('urmeaza', 'nu_se_aplica') OR (nr_treceri IS NULL AND punct_roua_c IS NULL AND placa IS NULL AND fluid IS NULL
         AND presiune_proba_bar IS NULL AND presiune_curenta_bar IS NULL AND durata_ore IS NULL AND probe_calc_id IS NULL AND rezultat IS NULL)))
);
CREATE INDEX executie_probe_etape_proiect_idx ON public.executie_probe_etape (proiect_id, id);
CREATE INDEX executie_probe_etape_calc_idx ON public.executie_probe_etape (probe_calc_id) WHERE probe_calc_id IS NOT NULL;
COMMENT ON TABLE public.executie_probe_etape IS
  'Execuție: etapele unui tronson de probă (pistonare, uscare, calibrare, presiune), câte una. Scriere DOAR prin fn_executie_proba_etapa. 20261202a.';
COMMENT ON COLUMN public.executie_probe_etape.presiune_curenta_la IS 'Ora citirii presiunii curente, pusă de server (now()) la fiecare salvare cu presiune în curs sau la schimbarea valorii.';
COMMENT ON COLUMN public.executie_probe_etape.probe_calc_id IS 'Legătura opțională cu proba din modulul Probe (probe_calcule, același proiect); PV-ul rămâne acolo.';

-- ── jurnalul operațiilor (doar adăugare) ─────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_probe_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proba_id bigint NOT NULL,
  proiect_id bigint NOT NULL,
  etapa_id bigint,
  actiune text NOT NULL CHECK (actiune IN ('creare', 'modificare', 'anulare', 'etapa')),
  stare_veche text,
  stare_noua text,
  data_operatie date,
  valori jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valori) = 'object'),
  cheie uuid NOT NULL,
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_probe_jurnal_proba_fk FOREIGN KEY (proba_id, proiect_id) REFERENCES public.executie_probe_tronsoane (id, proiect_id),
  CONSTRAINT executie_probe_jurnal_etapa_fk FOREIGN KEY (etapa_id, proba_id) REFERENCES public.executie_probe_etape (id, proba_id),
  CONSTRAINT executie_probe_jurnal_cheie_uq UNIQUE (cheie),
  CONSTRAINT executie_probe_jurnal_etapa CHECK ((actiune = 'etapa') = (etapa_id IS NOT NULL)
                                               AND (actiune = 'etapa') = (stare_noua IS NOT NULL AND stare_veche IS NOT NULL AND data_operatie IS NOT NULL))
);
CREATE INDEX executie_probe_jurnal_proba_idx ON public.executie_probe_jurnal (proba_id, id);
CREATE INDEX executie_probe_jurnal_proiect_idx ON public.executie_probe_jurnal (proiect_id, id);
CREATE INDEX executie_probe_jurnal_etapa_idx ON public.executie_probe_jurnal (etapa_id) WHERE etapa_id IS NOT NULL;
COMMENT ON TABLE public.executie_probe_jurnal IS
  'Execuție: jurnalul operațiilor pe tronsoanele de probă, în ordine; scris doar de RPC-urile fn_executie_proba_*, nu se modifică. Ține cheile de idempotență. 20261202a.';

-- ── tranzițiile etapelor: lista albă (aceeași ca TRANZITII din src/probeTronsoaneLogica.js; testul de paritate citește blocul) ──
-- „in_curs -> in_curs” = o actualizare / o citire nouă de presiune; „facut -> facut” = o corectură (cu motiv).
CREATE FUNCTION public.fn_executie_proba_tranzitie(p_veche text, p_noua text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    -- TRANZITII-START
    ('urmeaza', 'in_curs'), ('urmeaza', 'facut'), ('urmeaza', 'refacere'), ('urmeaza', 'nu_se_aplica'),
    ('in_curs', 'in_curs'), ('in_curs', 'facut'), ('in_curs', 'refacere'),
    ('refacere', 'in_curs'), ('refacere', 'facut'),
    ('facut', 'facut'), ('facut', 'refacere'),
    ('nu_se_aplica', 'urmeaza')
    -- TRANZITII-END
  ) t(v, n) WHERE t.v = p_veche AND t.n = p_noua)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_proba_tranzitie(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_proba_tranzitie(text, text) TO authenticated, service_role;

-- ── proveniența (L08) și identitatea imuabilă (L16): le pune serverul la orice INSERT / UPDATE ──
CREATE FUNCTION public.fn_executie_proba_prov_tronson() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id THEN
      RAISE EXCEPTION 'probe: proiectul tronsonului de probă nu se schimbă' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := OLD.creat_de;
    NEW.creat_la := OLD.creat_la;
  ELSE
    NEW.creat_de := auth.uid();
    NEW.creat_la := now();
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
CREATE FUNCTION public.fn_executie_proba_prov_etapa() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.proba_id, NEW.proiect_id, NEW.etapa) IS DISTINCT FROM (OLD.proba_id, OLD.proiect_id, OLD.etapa) THEN
    RAISE EXCEPTION 'probe: tronsonul, proiectul și etapa nu se schimbă' USING ERRCODE = '23514';
  END IF;
  -- legătura schimbată fără creșterea versiunii (ON DELETE SET NULL din modulul Probe, mentenanță) = rând schimbat: versiunea crește,
  -- ca CAS-ul clienților care o vedeau legată să întoarcă conflict. RPC-ul crește singur versiunea, deci nu se dublează.
  IF TG_OP = 'UPDATE' AND NEW.probe_calc_id IS DISTINCT FROM OLD.probe_calc_id AND NEW.versiune = OLD.versiune THEN
    NEW.versiune := OLD.versiune + 1;
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
CREATE FUNCTION public.fn_executie_proba_prov_jurnal() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'probe: jurnalul nu se modifică' USING ERRCODE = '23514';
  END IF;
  NEW.creat_de := auth.uid();
  NEW.creat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proba_prov_tronson() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_proba_prov_etapa() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_proba_prov_jurnal() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_proba_prov_tronson BEFORE INSERT OR UPDATE ON public.executie_probe_tronsoane
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proba_prov_tronson();
CREATE TRIGGER trg_executie_proba_prov_etapa BEFORE INSERT OR UPDATE ON public.executie_probe_etape
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proba_prov_etapa();
CREATE TRIGGER trg_executie_proba_prov_jurnal BEFORE INSERT OR UPDATE ON public.executie_probe_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proba_prov_jurnal();

-- ── RPC 1: creare / modificare a unui tronson de probă (L01, L02, L04, L07, L08, L09, L16) ──
-- p_id NULL = tronson nou (p_versiune NULL); altfel modificare cu CAS pe versiune.
-- Ordinea: identitate -> advisory pe proiect -> rândul FOR UPDATE (la modificare) -> drept pe proiect -> idempotență -> CAS
--   -> reguli (cod, interval, suprapunere, cod dublu) -> scriere (tronson [+ 4 etape] + jurnal), totul în aceeași tranzacție.
-- Rezultat: {ok, duplicat, proba} sau {ok:false, motiv:'conflict', proba} (s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_proba_salveaza(p_proiect bigint, p_id bigint, p_versiune integer, p_cod text,
  p_km_de_la_m integer, p_km_pana_la_m integer, p_denumire text, p_observatii text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_probe_tronsoane;
  v_vechi jsonb;
  v_cod text := upper(btrim(coalesce(p_cod, '')));
  v_den text := nullif(btrim(coalesce(p_denumire, '')), '');
  v_obs text := nullif(btrim(coalesce(p_observatii, '')), '');
  v_amprenta text;
  j record;
  v_alt record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'probe: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL OR p_km_de_la_m IS NULL OR p_km_pana_la_m IS NULL OR ((p_id IS NULL) <> (p_versiune IS NULL)) THEN
    RAISE EXCEPTION 'probe: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.executie_probe:' || p_proiect::text, 0));
  IF p_id IS NOT NULL THEN
    SELECT * INTO r FROM public.executie_probe_tronsoane WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.proiect_id IS DISTINCT FROM p_proiect THEN
      RAISE EXCEPTION 'probe: tronsonul de probă nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT public.fn_executie_nod_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'probe: tronsonul de probă nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'salveaza', 'proiect', p_proiect, 'id', p_id, 'versiune', p_versiune, 'cod', v_cod,
                                       'de_la', p_km_de_la_m, 'pana_la', p_km_pana_la_m, 'denumire', v_den, 'observatii', v_obs)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  SELECT proba_id, amprenta INTO j FROM public.executie_probe_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true,
                                'proba', (SELECT to_jsonb(t) FROM public.executie_probe_tronsoane t WHERE t.id = j.proba_id));
    END IF;
    RAISE EXCEPTION 'probe: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NOT NULL THEN
    IF r.versiune IS DISTINCT FROM p_versiune THEN
      RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'proba', to_jsonb(r));
    END IF;
    IF r.stare <> 'activ' THEN RAISE EXCEPTION 'probe: tronsonul de probă e anulat' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_cod !~ '^P[0-9]{1,3}[A-Z]?$' THEN
    RAISE EXCEPTION 'probe: codul trebuie să fie de forma P1, P2, P12A' USING ERRCODE = '22023';
  END IF;
  IF p_km_de_la_m < 0 OR p_km_de_la_m > 999999 OR p_km_pana_la_m > 1000000 OR p_km_pana_la_m <= p_km_de_la_m THEN
    RAISE EXCEPTION 'probe: intervalul de km e greșit (sfârșitul trebuie să fie după început)' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(v_den, '')) > 200 OR length(coalesce(v_obs, '')) > 2000 THEN
    RAISE EXCEPTION 'probe: text prea lung' USING ERRCODE = '22023';
  END IF;
  -- suprapunerea și codul dublu, pe tronsoanele active ale proiectului (sub lock-ul proiectului; EXCLUDE / UNIQUE rămân plasa de siguranță)
  SELECT t.cod, t.km_de_la_m, t.km_pana_la_m INTO v_alt FROM public.executie_probe_tronsoane t
   WHERE t.proiect_id = p_proiect AND t.stare = 'activ' AND t.id IS DISTINCT FROM p_id
     AND int4range(t.km_de_la_m, t.km_pana_la_m, '[)') && int4range(p_km_de_la_m, p_km_pana_la_m, '[)')
   ORDER BY t.km_de_la_m, t.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'probe: intervalul se suprapune cu % (de la % m la % m)', v_alt.cod, v_alt.km_de_la_m, v_alt.km_pana_la_m USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_probe_tronsoane t WHERE t.proiect_id = p_proiect AND t.stare = 'activ' AND t.cod = v_cod AND t.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'probe: codul % există deja pe proiect', v_cod USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.executie_probe_tronsoane (proiect_id, cod, denumire, km_de_la_m, km_pana_la_m, observatii)
    VALUES (p_proiect, v_cod, v_den, p_km_de_la_m, p_km_pana_la_m, v_obs)
    RETURNING * INTO r;
    INSERT INTO public.executie_probe_etape (proba_id, proiect_id, etapa)
    SELECT r.id, r.proiect_id, x FROM unnest(ARRAY['pistonare', 'uscare', 'calibrare', 'presiune']) x;
    INSERT INTO public.executie_probe_jurnal (proba_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (r.id, r.proiect_id, 'creare',
            jsonb_strip_nulls(jsonb_build_object('cod', v_cod, 'km_de_la_m', p_km_de_la_m, 'km_pana_la_m', p_km_pana_la_m, 'denumire', v_den, 'observatii', v_obs)),
            p_cheie, v_amprenta);
  ELSE
    v_vechi := jsonb_strip_nulls(jsonb_build_object('cod', r.cod, 'km_de_la_m', r.km_de_la_m, 'km_pana_la_m', r.km_pana_la_m, 'denumire', r.denumire, 'observatii', r.observatii));
    UPDATE public.executie_probe_tronsoane SET
      cod = v_cod, denumire = v_den, km_de_la_m = p_km_de_la_m, km_pana_la_m = p_km_pana_la_m, observatii = v_obs, versiune = r.versiune + 1
    WHERE id = p_id
    RETURNING * INTO r;
    INSERT INTO public.executie_probe_jurnal (proba_id, proiect_id, actiune, valori, cheie, amprenta)
    VALUES (r.id, r.proiect_id, 'modificare',
            jsonb_build_object('inainte', v_vechi,
                               'dupa', jsonb_strip_nulls(jsonb_build_object('cod', v_cod, 'km_de_la_m', p_km_de_la_m, 'km_pana_la_m', p_km_pana_la_m, 'denumire', v_den, 'observatii', v_obs))),
            p_cheie, v_amprenta);
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'proba', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proba_salveaza(bigint, bigint, integer, text, integer, integer, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_proba_salveaza(bigint, bigint, integer, text, integer, integer, text, text, uuid) TO authenticated;

-- ── RPC 2: anularea unui tronson de probă (cu motiv; intervalul și codul se eliberează; jurnalul rămâne) ──
-- Ordinea: identitate -> proiectul rândului (imuabil, citit fără lock) -> advisory pe proiect -> rândul FOR UPDATE -> drept -> idempotență -> CAS.
CREATE FUNCTION public.fn_executie_proba_anuleaza(p_id bigint, p_versiune integer, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_probe_tronsoane;
  v_proiect bigint;
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'probe: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'probe: parametri lipsă' USING ERRCODE = '22023'; END IF;
  SELECT proiect_id INTO v_proiect FROM public.executie_probe_tronsoane WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'probe: tronsonul de probă nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.executie_probe:' || v_proiect::text, 0));
  SELECT * INTO r FROM public.executie_probe_tronsoane WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_executie_nod_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'probe: tronsonul de probă nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'anuleaza', 'id', p_id, 'versiune', p_versiune, 'motiv', v_motiv)::text);
  SELECT proba_id, amprenta INTO j FROM public.executie_probe_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'proba', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'probe: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF r.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'proba', to_jsonb(r)); END IF;
  IF r.stare <> 'activ' THEN RAISE EXCEPTION 'probe: tronsonul de probă e deja anulat' USING ERRCODE = '22023'; END IF;
  IF v_motiv IS NULL OR length(v_motiv) > 500 THEN RAISE EXCEPTION 'probe: motivul anulării e obligatoriu (cel mult 500 de caractere)' USING ERRCODE = '22023'; END IF;
  UPDATE public.executie_probe_tronsoane SET stare = 'anulat', motiv_anulare = v_motiv, versiune = r.versiune + 1
  WHERE id = p_id
  RETURNING * INTO r;
  INSERT INTO public.executie_probe_jurnal (proba_id, proiect_id, actiune, valori, cheie, amprenta)
  VALUES (r.id, r.proiect_id, 'anulare', jsonb_build_object('motiv', v_motiv), p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'proba', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proba_anuleaza(bigint, integer, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_proba_anuleaza(bigint, integer, text, uuid) TO authenticated;

-- ── RPC 3: schimbarea / actualizarea unei etape (L01, L02, L04, L07, L08, L09, L11, L17, L20) ──
-- Formularul trimite TOATE valorile etapei (cele de pe ecran); ce e NULL se golește. Câmpurile altor etape = refuz.
-- Ordinea: identitate -> tronsonul etapei (citit fără lock; e imuabil) -> tronsonul FOR UPDATE -> etapa FOR UPDATE -> drept -> idempotență
--   -> CAS (stare + versiune) -> tronson activ -> tranziție -> reguli -> legătura rezultată (dacă e nenulă): drept Probe (doar dacă e
--   nouă) -> calculul FOR KEY SHARE NOWAIT (ultimul lock; ocupat = 55P03) -> același proiect (doar dacă e nouă) -> UPDATE + jurnal.
CREATE FUNCTION public.fn_executie_proba_etapa(p_etapa_id bigint, p_stare_veche text, p_versiune integer, p_stare_noua text, p_data date,
  p_nr_treceri integer, p_punct_roua_c numeric, p_placa text, p_fluid text, p_presiune_proba_bar numeric, p_presiune_curenta_bar numeric,
  p_durata_ore numeric, p_probe_calc_id bigint, p_rezultat text, p_observatii text, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  t public.executie_probe_tronsoane;
  e public.executie_probe_etape;
  v_proba bigint;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_placa text := nullif(lower(btrim(coalesce(p_placa, ''))), '');
  v_fluid text := nullif(lower(btrim(coalesce(p_fluid, ''))), '');
  v_rez text := nullif(btrim(coalesce(p_rezultat, '')), '');
  v_obs text := nullif(btrim(coalesce(p_observatii, '')), '');
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_valori jsonb;
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'probe: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_etapa_id IS NULL OR p_versiune IS NULL OR p_stare_noua IS NULL OR p_data IS NULL OR p_cheie IS NULL THEN
    RAISE EXCEPTION 'probe: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  SELECT proba_id INTO v_proba FROM public.executie_probe_etape WHERE id = p_etapa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'probe: etapa nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.executie_probe_tronsoane WHERE id = v_proba FOR UPDATE;
  SELECT * INTO e FROM public.executie_probe_etape WHERE id = p_etapa_id FOR UPDATE;
  IF NOT public.fn_executie_nod_drept(e.proiect_id, true) THEN
    RAISE EXCEPTION 'probe: etapa nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_valori := jsonb_build_object('nr_treceri', p_nr_treceri, 'punct_roua_c', p_punct_roua_c, 'placa', v_placa, 'fluid', v_fluid,
                                 'presiune_proba_bar', p_presiune_proba_bar, 'presiune_curenta_bar', p_presiune_curenta_bar,
                                 'durata_ore', p_durata_ore, 'probe_calc_id', p_probe_calc_id, 'rezultat', v_rez, 'observatii', v_obs, 'motiv', v_motiv);
  v_amprenta := md5(jsonb_build_object('op', 'etapa', 'id', p_etapa_id, 'veche', p_stare_veche, 'versiune', p_versiune,
                                       'noua', p_stare_noua, 'data', p_data, 'valori', v_valori)::text);
  SELECT etapa_id, amprenta INTO j FROM public.executie_probe_jurnal WHERE cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'etapa', to_jsonb(e)); END IF;
    RAISE EXCEPTION 'probe: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  -- CAS: starea și versiunea văzute de client (o golire a legăturii din Probe crește și ea versiunea, prin trigger)
  IF e.stare IS DISTINCT FROM p_stare_veche OR e.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'etapa', to_jsonb(e));
  END IF;
  IF t.stare <> 'activ' THEN RAISE EXCEPTION 'probe: tronsonul de probă e anulat' USING ERRCODE = '22023'; END IF;
  IF NOT public.fn_executie_proba_tranzitie(e.stare, p_stare_noua) THEN
    RAISE EXCEPTION 'probe: tranziție nepermisă % -> %', e.stare, p_stare_noua USING ERRCODE = '22023';
  END IF;
  -- data operației (Europe/Bucharest): nu în viitor, cel mult 2 ani în urmă (se pot trece și probele vechi), „făcut” nu înaintea începutului
  IF p_data > v_azi OR p_data < v_azi - 730 THEN
    RAISE EXCEPTION 'probe: data trebuie să fie între % și %', v_azi - 730, v_azi USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'facut' AND e.data_start IS NOT NULL AND p_data < e.data_start THEN
    RAISE EXCEPTION 'probe: data de final e înaintea începutului etapei (%)', e.data_start USING ERRCODE = '22023';
  END IF;
  -- câmpurile altor etape = refuz (nu se ignoră tacit)
  IF (e.etapa <> 'pistonare' AND p_nr_treceri IS NOT NULL)
     OR (e.etapa <> 'uscare' AND p_punct_roua_c IS NOT NULL)
     OR (e.etapa <> 'calibrare' AND v_placa IS NOT NULL)
     OR (e.etapa <> 'presiune' AND (v_fluid IS NOT NULL OR p_presiune_proba_bar IS NOT NULL OR p_presiune_curenta_bar IS NOT NULL
                                    OR p_durata_ore IS NOT NULL OR p_probe_calc_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'probe: câmpuri care nu țin de etapa %', e.etapa USING ERRCODE = '22023';
  END IF;
  -- valorile: domeniu și zecimale (o valoare cu mai multe zecimale e refuzată, nu rotunjită tacit)
  IF (p_nr_treceri IS NOT NULL AND p_nr_treceri NOT BETWEEN 1 AND 500)
     OR (p_punct_roua_c IS NOT NULL AND (p_punct_roua_c NOT BETWEEN -100 AND 50 OR p_punct_roua_c <> round(p_punct_roua_c, 1)))
     OR (v_placa IS NOT NULL AND v_placa NOT IN ('ok', 'deformata'))
     OR (v_fluid IS NOT NULL AND v_fluid NOT IN ('apa', 'aer', 'azot'))
     OR (p_presiune_proba_bar IS NOT NULL AND (p_presiune_proba_bar <= 0 OR p_presiune_proba_bar > 250 OR p_presiune_proba_bar <> round(p_presiune_proba_bar, 2)))
     OR (p_presiune_curenta_bar IS NOT NULL AND (p_presiune_curenta_bar < 0 OR p_presiune_curenta_bar > 300 OR p_presiune_curenta_bar <> round(p_presiune_curenta_bar, 2)))
     OR (p_durata_ore IS NOT NULL AND (p_durata_ore <= 0 OR p_durata_ore > 2000 OR p_durata_ore <> round(p_durata_ore, 1)))
     OR length(coalesce(v_rez, '')) > 300 OR length(coalesce(v_obs, '')) > 2000 OR length(coalesce(v_motiv, '')) > 500 THEN
    RAISE EXCEPTION 'probe: valoare în afara domeniului (treceri 1–500, rouă -100…50 °C cu 1 zecimală, presiune ≤ 250 / 300 bar cu 2 zecimale, durată ≤ 2000 h cu 1 zecimală)' USING ERRCODE = '22023';
  END IF;
  -- ce cere starea nouă
  IF (p_stare_noua IN ('refacere', 'nu_se_aplica') OR e.stare IN ('facut', 'nu_se_aplica')) AND v_motiv IS NULL THEN
    RAISE EXCEPTION 'probe: motivul e obligatoriu' USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua IN ('urmeaza', 'nu_se_aplica') AND (p_nr_treceri IS NOT NULL OR p_punct_roua_c IS NOT NULL OR v_placa IS NOT NULL OR v_fluid IS NOT NULL
       OR p_presiune_proba_bar IS NOT NULL OR p_presiune_curenta_bar IS NOT NULL OR p_durata_ore IS NOT NULL OR p_probe_calc_id IS NOT NULL OR v_rez IS NOT NULL) THEN
    RAISE EXCEPTION 'probe: o etapă care urmează / nu se aplică nu are valori' USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'facut' AND e.etapa = 'pistonare' AND p_nr_treceri IS NULL THEN
    RAISE EXCEPTION 'probe: numărul de treceri e obligatoriu' USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'facut' AND e.etapa = 'calibrare' AND v_placa IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'probe: calibrarea e făcută doar cu placa OK (placa deformată = de refăcut)' USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua IN ('in_curs', 'facut') AND e.etapa = 'presiune' AND p_presiune_proba_bar IS NULL THEN
    RAISE EXCEPTION 'probe: presiunea de probă e obligatorie' USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'facut' AND e.etapa = 'presiune' AND p_durata_ore IS NULL THEN
    RAISE EXCEPTION 'probe: durata probei e obligatorie' USING ERRCODE = '22023';
  END IF;
  -- legătura NOUĂ cu modulul Probe (L09): dreptul de citire al modulului Probe (predicatul lui) + o probă a ACELUIAȘI proiect; refuz generic.
  -- Păstrarea legăturii existente sau dezlegarea nu cer dreptul Probe. FK-ul compus impune oricum același proiect, și la mutări ulterioare.
  IF p_probe_calc_id IS NOT NULL THEN
    IF p_probe_calc_id IS DISTINCT FROM e.probe_calc_id AND NOT public.probe_teren_drept(false) THEN
      RAISE EXCEPTION 'probe: proba din modulul Probe nu (mai) există pe acest proiect sau nu ai drept de citire pe Probe' USING ERRCODE = '42501';
    END IF;
    -- calculul legăturii REZULTATE (nouă SAU păstrată) se blochează ULTIMUL și FĂRĂ așteptare (vezi antetul). Și legătura păstrată:
    -- FK-ul o reverifică (deci o blochează implicit, cu așteptare) dacă rândul etapei a fost deja scris în aceeași tranzacție.
    -- Ocupat de o ștergere / mutare din Probe = refuz imediat, nimic scris.
    BEGIN
      PERFORM 1 FROM public.probe_calcule c WHERE c.id = p_probe_calc_id FOR KEY SHARE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'probe: proba din modulul Probe se modifică chiar acum; reîncearcă peste câteva secunde' USING ERRCODE = '55P03';
    END;
    IF p_probe_calc_id IS DISTINCT FROM e.probe_calc_id
       AND NOT EXISTS (SELECT 1 FROM public.probe_calcule c WHERE c.id = p_probe_calc_id AND c.proiect_id = e.proiect_id) THEN
      RAISE EXCEPTION 'probe: proba din modulul Probe nu (mai) există pe acest proiect sau nu ai drept de citire pe Probe' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.executie_probe_etape SET
    stare = p_stare_noua,
    data_stare = p_data,
    data_start = CASE WHEN p_stare_noua IN ('in_curs', 'facut', 'refacere') THEN coalesce(e.data_start, p_data) ELSE NULL END,
    data_final = CASE WHEN p_stare_noua = 'facut' THEN p_data ELSE NULL END,
    nr_treceri = p_nr_treceri,
    punct_roua_c = p_punct_roua_c,
    placa = v_placa,
    fluid = v_fluid,
    presiune_proba_bar = p_presiune_proba_bar,
    presiune_curenta_bar = p_presiune_curenta_bar,
    presiune_curenta_la = CASE WHEN p_presiune_curenta_bar IS NULL THEN NULL
                               WHEN p_presiune_curenta_bar IS DISTINCT FROM e.presiune_curenta_bar OR p_stare_noua = 'in_curs' THEN now()
                               ELSE e.presiune_curenta_la END,
    durata_ore = p_durata_ore,
    probe_calc_id = p_probe_calc_id,
    rezultat = v_rez,
    observatii = v_obs,
    motiv = v_motiv,
    versiune = e.versiune + 1
  WHERE id = p_etapa_id
  RETURNING * INTO e;
  INSERT INTO public.executie_probe_jurnal (proba_id, proiect_id, etapa_id, actiune, stare_veche, stare_noua, data_operatie, valori, cheie, amprenta)
  VALUES (e.proba_id, e.proiect_id, e.id, 'etapa', p_stare_veche, p_stare_noua, p_data,
          jsonb_strip_nulls(v_valori || jsonb_build_object('etapa', e.etapa)), p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'etapa', to_jsonb(e));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_proba_etapa(bigint, text, integer, text, date, integer, numeric, text, text, numeric, numeric, numeric, bigint, text, text, text, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC-uri ──
ALTER TABLE public.executie_probe_tronsoane ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_probe_etape ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_probe_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_probe_tronsoane, public.executie_probe_etape, public.executie_probe_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_probe_tronsoane, public.executie_probe_etape, public.executie_probe_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_probe_tronsoane_id_seq, public.executie_probe_etape_id_seq, public.executie_probe_jurnal_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_probe_tronsoane_citire ON public.executie_probe_tronsoane FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_probe_etape_citire ON public.executie_probe_etape FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY executie_probe_jurnal_citire ON public.executie_probe_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid; v_tab text;
BEGIN
  FOREACH v_tab IN ARRAY ARRAY['executie_probe_tronsoane', 'executie_probe_etape', 'executie_probe_jurnal'] LOOP
    v_rel := to_regclass('public.' || v_tab);
    -- RLS + exact o politică: SELECT, permisivă, doar authenticated, fără WITH CHECK, expresia EXACTĂ (comparată ca text deparsat,
    -- cu search_path-ul fixat la start) și dependentă de funcția de drept revizuită
    IF v_rel IS NULL OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = v_rel) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = v_rel AND pol.polname = v_tab || '_citire'
                       AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid]
                       AND pol.polwithcheck IS NULL
                       AND pg_get_expr(pol.polqual, pol.polrelid) IN ('fn_executie_nod_drept(proiect_id, false)', 'public.fn_executie_nod_drept(proiect_id, false)')
                       AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                                    AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure)) THEN
      RAISE EXCEPTION '20261202a post: RLS / politica %', v_tab;
    END IF;
    -- privilegiile efective: doar SELECT pentru authenticated / service_role, nimic pentru anon; nimic pe coloane / secvențe
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                WHERE has_table_privilege(r, v_rel, p))
       OR has_table_privilege('anon', v_rel, 'SELECT')
       OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
                   WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.' || v_tab, 'id'), 'USAGE,SELECT,UPDATE')) THEN
      RAISE EXCEPTION '20261202a post: privilegii pe % / secventa', v_tab;
    END IF;
  END LOOP;
  -- funcțiile: DEFINER doar cele 3 RPC-uri, search_path fix, EXECUTE doar unde trebuie (RPC-urile: doar authenticated)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proba\_%'
                AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                     OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_proba_salveaza', 'fn_executie_proba_anuleaza', 'fn_executie_proba_etapa'))
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname NOT LIKE 'fn\_executie\_proba\_prov\_%')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_proba_tranzitie')))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_proba\_%') <> 7 THEN
    RAISE EXCEPTION '20261202a post: functii (definer / search_path / EXECUTE)';
  END IF;
  -- trigger-ele: exact cele 3, fiecare pe funcția lui, BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype 1+2+4+16 = 23), active, fără WHEN,
  -- fără listă de coloane; niciun alt trigger ne-intern pe cele 3 tabele
  IF (SELECT count(*) FROM pg_trigger tg JOIN (VALUES
        ('public.executie_probe_tronsoane'::regclass, 'trg_executie_proba_prov_tronson', 'public.fn_executie_proba_prov_tronson()'::regprocedure),
        ('public.executie_probe_etape'::regclass, 'trg_executie_proba_prov_etapa', 'public.fn_executie_proba_prov_etapa()'::regprocedure),
        ('public.executie_probe_jurnal'::regclass, 'trg_executie_proba_prov_jurnal', 'public.fn_executie_proba_prov_jurnal()'::regprocedure)) a(rel, nume, fn)
        ON tg.tgrelid = a.rel AND tg.tgname = a.nume
       WHERE NOT tg.tgisinternal AND tg.tgfoid = a.fn AND tg.tgtype = 23 AND tg.tgenabled = 'O' AND tg.tgqual IS NULL
         AND coalesce(array_length(tg.tgattr::int2[], 1), 0) = 0) <> 3
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_probe_tronsoane'::regclass, 'public.executie_probe_etape'::regclass, 'public.executie_probe_jurnal'::regclass)) <> 3 THEN
    RAISE EXCEPTION '20261202a post: trigger-ele de provenienta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.executie_probe_tronsoane'::regclass
                  AND conname = 'executie_probe_tronsoane_fara_suprapunere' AND contype = 'x') THEN
    RAISE EXCEPTION '20261202a post: constrangerea de nesuprapunere';
  END IF;
  -- legătura cu Probe: UNIQUE (id, proiect_id) pe probe_calcule și FK-ul compus cu ON DELETE SET NULL doar pe probe_calc_id, NO ACTION la UPDATE
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_calcule'::regclass AND conname = 'probe_calcule_id_proiect_uq' AND contype = 'u'
                  AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.probe_calcule'::regclass AND attname = 'id'),
                                     (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.probe_calcule'::regclass AND attname = 'proiect_id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.executie_probe_etape'::regclass AND conname = 'executie_probe_etape_calc_fk'
                     AND contype = 'f' AND confrelid = 'public.probe_calcule'::regclass AND confupdtype = 'a' AND confdeltype = 'n'
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.executie_probe_etape'::regclass AND attname = 'probe_calc_id'),
                                        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.executie_probe_etape'::regclass AND attname = 'proiect_id')]::int2[]
                     AND confdelsetcols = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.executie_probe_etape'::regclass AND attname = 'probe_calc_id')]::int2[]) THEN
    RAISE EXCEPTION '20261202a post: legatura cu probe_calcule (UNIQUE / FK compus)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_probe_tronsoane) OR EXISTS (SELECT 1 FROM public.executie_probe_etape)
     OR EXISTS (SELECT 1 FROM public.executie_probe_jurnal) THEN
    RAISE EXCEPTION '20261202a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261202a_executie_probe_tronsoane:' || txid_current() THEN
    RAISE EXCEPTION '20261202a: garda final invalida';
  END IF;
END $post$;
