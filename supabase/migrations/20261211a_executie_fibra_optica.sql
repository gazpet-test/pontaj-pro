-- Version 20261211120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261211a_executie_fibra_optica — Execuție: urmărirea fibrei optice pe tronsoane (decizia lui Răzvan, 10.11.2026, Lot 1, termen 17.12.2026).
--
-- Ce face:
--   * executie_fibra_camerete: cameretele (bucăți): tronson, poziție km (metri întregi de la originea traseului, ca
--     executie_tronsoane.km_start_m / km_end_m), cod, stare (de montat / montată / scoasă din listă), data montării, cine a raportat,
--     observații. Lista inițială vine din proiect (import făcut de chat cu scripts/fibra_camerete_import_sql.mjs, sursa = 'proiect');
--     șeful de șantier poate adăuga una lipsă (sursa = 'santier'). Codul e unic pe proiect între cameretele din listă.
--   * executie_fibra_intervale: raportările pe intervale [de_la, pana_la) ale celor 3 etape liniare, în ordinea de lucru:
--     monotub montat -> validat (pregătit de suflare; o bifă pe interval, fără PV) -> fibră suflată. O raportare nu se modifică:
--     una greșită se ANULEAZĂ (cu motiv, rândul rămâne) și se raportează din nou.
--   * executie_fibra_jurnal: jurnalul operațiilor (raportare, anulare, cameretă adăugată / montată / montare anulată / scoasă), doar
--     adăugare; ține cheia de idempotență a fiecărei apăsări (UNIQUE + amprentă).
-- Regulile, în BAZĂ (trigger BEFORE pe rândul scris, deci pe orice cale: RPC, import, mentenanță):
--   * intervalul stă în limitele tronsonului lui (km_start_m <= de_la < pana_la <= km_end_m); camereta: km_start_m <= km <= km_end_m;
--     tronsonul fără km de început / sfârșit nu primește raportări (se completează întâi la Tronsoane);
--   * intervalele ACTIVE ale aceleiași etape pe același tronson nu se suprapun (mesaj: „porțiunea km X–Y e deja raportată pe DD.LL”);
--     plasa de siguranță: 3 constrângeri EXCLUDE (gist pe int8range(tronson) && int4range(km), tipuri de bază, fără extensii);
--   * „validat” cere monotub pe TOT intervalul, „suflat” cere validat pe tot intervalul (acoperire din unul sau mai multe intervale
--     active ale etapei anterioare, pe același tronson), raportate cel târziu în aceeași zi (data etapei anterioare <= data raportării);
--   * anularea unui interval de care depinde etapa următoare (un interval activ al ei care se suprapune) = refuz. Cum intervalele
--     aceleiași etape nu se suprapun, orice suprapunere a etapei următoare e acoperită DOAR de intervalul anulat;
--   * un tronson cu fibră raportată nu-și schimbă proiectul și nu-și strânge km-ii peste raportări / camerete (trigger pe
--     executie_tronsoane); ștergerea lui e oprită de cheile străine.
-- Doar în RPC (depind de cine apasă și de azi): dreptul de scriere, fereastra datei (azi … 7 zile în urmă; owner-ul până la 365 de
--   zile, pentru ce s-a lucrat înainte de modul), anularea doar de cel care a raportat sau de owner, idempotența.
-- Scrierea din aplicație: DOAR prin cele 4 RPC-uri SECURITY DEFINER (fn_executie_fibra_raporteaza / _anuleaza / _camereta_adauga /
--   _camereta_stare): auth.uid() obligatoriu, drept pe proiect prin fn_executie_fibra_drept (UN SINGUR loc: azi = dreptul pe modul din
--   fn_executie_nod_drept; poarta „acces pe proiect” se adaugă acolo, într-un rând), lock, cheie de idempotență per apăsare.
--   Nicio scriere directă (fără INSERT / UPDATE / DELETE pentru anon / authenticated / service_role). Citirea: același drept, orice
--   nivel (viewer citește), prin RLS.
-- Concurența: fiecare scriere blochează ÎNTÂI rândul tronsonului (SELECT … FOR NO KEY UPDATE), apoi verifică regulile. Două raportări
--   pe același tronson se execută una după alta, deci a doua vede rândul primei (READ COMMITTED: instantaneu nou la fiecare
--   instrucțiune) și primește mesajul clar; o modificare de km a tronsonului ia același lock (UPDATE). De ce lock pe tronson și nu
--   doar EXCLUDE: acoperirea de către etapa anterioară și dependența la anulare sunt reguli între rânduri pe care EXCLUDE nu le poate
--   exprima; sub lock-ul tronsonului ele nu pot fi ocolite de două tranzacții concurente. FOR NO KEY UPDATE (nu FOR UPDATE) nu intră
--   în conflict cu FOR KEY SHARE, deci cheile străine din alte module (Izometrie, Probe) spre tronson nu sunt blocate.
-- Ordinea lock-urilor (L06), aceeași pe toate căile:
--   executie_tronsoane (rândul, FOR NO KEY UPDATE) -> rândul propriu (FOR UPDATE, la anulare / schimbare de stare) -> INSERT în jurnal
--   (FOR KEY SHARE implicit pe tronson / rând, deja blocate mai tare). Un UPDATE pe executie_tronsoane ține rândul tronsonului și doar
--   CITEȘTE tabelele de aici (trigger-ul de gardă). Importul cameretelor blochează tronsoanele proiectului ORDER BY id, apoi scrie.
--   Revenirea ia toate lock-urile cu NOWAIT, în aceeași ordine (tronsoane, apoi tabelele de aici).
-- Ce NU face: nicio dată (cameretele le importă chat-ul, cu „da”-ul lui Răzvan), niciun drept, nicio atingere pe izo_* / probe.
--   Pe executie_tronsoane adaugă DOAR trigger-ul de gardă trg_executie_fibra_garda_tronson (scos de revenire).
-- Depinde de 20261201a (fn_executie_nod_drept, amprenta verificată la start). Cere PostgreSQL >= 15 (range_agg / multirange).
-- Revenire: supabase/revenire/20261211a_executie_fibra_optica_ROLLBACK.sql. Test pe clonă: scripts/test_executie_fibra_optica.sql
--   (o sesiune) și scripts/test_executie_fibra_concurenta.sh (două sesiuni reale).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261211a_executie_fibra_optica:' || txid_current() THEN
    RAISE EXCEPTION '20261211a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261211a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_fibra_intervale') IS NOT NULL OR to_regclass('public.executie_fibra_camerete') IS NOT NULL
     OR to_regclass('public.executie_fibra_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND starts_with(p.proname, 'fn_executie_fibra_'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_fibra_garda_tronson') THEN
    RAISE EXCEPTION '20261211a: obiectele exista deja (reaplicare)';
  END IF;
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '20261211a: necesita PostgreSQL >= 15 (range_agg / multirange)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; executie_tronsoane: id PK întreg, proiect_id, km_* integer)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR to_regclass('public.executie_tronsoane') IS NULL
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'proiect_id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'km_start_m' AND NOT attisdropped), '') <> 'integer'
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'km_end_m' AND NOT attisdropped), '') <> 'integer'
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'cod' AND NOT attisdropped), '') <> 'text'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.executie_tronsoane') AND contype = 'p'
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.executie_tronsoane') AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'name' AND data_type = 'text') THEN
    RAISE EXCEPTION '20261211a: dependentele (executie_proiecte.id bigint, executie_tronsoane id / proiect_id / cod / km_start_m / km_end_m, profiles.is_owner / name) difera';
  END IF;
  -- L15: funcția de drept pe Execuție folosită aici, cu amprenta revizuită (aceeași ca în 20261202a); corpul fără CR (checkout Windows)
  --   fn_executie_nod_drept (20261201a): md5 144649bae9a218b41b7e6df90cba5d9e
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)')
                  AND md5(replace(p.prosrc, chr(13), '')) = '144649bae9a218b41b7e6df90cba5d9e'
                  AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
                  AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                  AND p.prorettype = 'boolean'::regtype::oid AND p.provolatile = 's'
                  AND pg_get_userbyid(p.proowner) = current_user
                  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261211a: fn_executie_nod_drept (20261201a) lipseste sau difera de amprenta revizuita: aplica intai 20261201a / verifica';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261211a: auth.uid() lipseste sau difera';
  END IF;
END $pre$;

-- ── dreptul pe proiect: UN SINGUR loc (RLS, RPC-uri, UI). Azi = dreptul pe modulul Execuție (fn_executie_nod_drept). ──
-- POARTA-PROIECT: după PR-ul „acces pe proiect” se adaugă aici, într-un rând:   AND public.fn_executie_proiect_permis(p_proiect)
CREATE FUNCTION public.fn_executie_fibra_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(public.fn_executie_nod_drept(p_proiect, p_scriere), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) TO authenticated, service_role;

-- owner-ul apelantului (folosit doar în RPC-urile DEFINER de aici; nimeni altcineva nu o apelează)
CREATE FUNCTION public.fn_executie_fibra_owner() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_owner() FROM PUBLIC, anon, authenticated, service_role;

-- ── etapele liniare, în ordinea de lucru (aceeași listă ca ETAPE / ETAPA_ANTERIOARA din src/fibraOpticaLogica.js; testul de paritate
-- citește blocul de mai jos). NULL = etapă necunoscută. ──
CREATE FUNCTION public.fn_executie_fibra_etapa_anterioara(p_etapa text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT t.anterioara FROM (VALUES
    -- ETAPE-START
    ('monotub', NULL::text), ('validat', 'monotub'), ('suflat', 'validat')
    -- ETAPE-END
  ) t(etapa, anterioara) WHERE t.etapa = p_etapa
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_etapa_anterioara(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_etapa_anterioara(text) TO authenticated, service_role;

-- ── stările cameretei: tranzițiile permise (aceeași listă ca TRANZITII_CAMERETA din src/fibraOpticaLogica.js; test de paritate) ──
CREATE FUNCTION public.fn_executie_fibra_cam_tranzitie(p_veche text, p_noua text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    -- TRANZITII-START
    ('de_montat', 'montata'), ('montata', 'de_montat'), ('de_montat', 'anulata')
    -- TRANZITII-END
  ) t(v, n) WHERE t.v = p_veche AND t.n = p_noua)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_cam_tranzitie(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_cam_tranzitie(text, text) TO authenticated, service_role;

-- km în formatul șantierului: 12350 -> '12+350' (mesajele de eroare; aceeași formă ca fmtKm din src/lib/izoKml.js)
CREATE FUNCTION public.fn_executie_fibra_km(p_m integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_m IS NULL OR p_m < 0 THEN '?' ELSE (p_m / 1000)::text || '+' || lpad((p_m % 1000)::text, 3, '0') END
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_km(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_km(integer) TO authenticated, service_role;

-- ── cameretele ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_fibra_camerete (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
  cod text NOT NULL CHECK (cod ~ '^[A-Z0-9][A-Z0-9./_-]{0,29}$'),
  km_m integer NOT NULL CHECK (km_m BETWEEN 0 AND 9999999),
  stare text NOT NULL DEFAULT 'de_montat' CHECK (stare IN ('de_montat', 'montata', 'anulata')),
  data_montare date,
  montat_de uuid,
  montat_nume text,
  sursa text NOT NULL CHECK (sursa IN ('proiect', 'santier')),
  observatii text CHECK (observatii IS NULL OR (length(observatii) BETWEEN 1 AND 1000 AND observatii ~ '[^[:space:]]')),
  motiv text CHECK (motiv IS NULL OR (length(motiv) BETWEEN 1 AND 500 AND motiv ~ '[^[:space:]]')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  creat_de uuid,
  creat_nume text,
  creat_la timestamptz NOT NULL DEFAULT now(),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_fibra_camerete_montare CHECK ((stare = 'montata') = (data_montare IS NOT NULL)
                                                   AND (stare = 'montata' OR (montat_de IS NULL AND montat_nume IS NULL))),
  CONSTRAINT executie_fibra_camerete_scoasa CHECK (stare <> 'anulata' OR motiv IS NOT NULL),
  CONSTRAINT executie_fibra_camerete_id_tronson_uq UNIQUE (id, tronson_id)
);
-- codul e unic pe proiect între cameretele din listă (una scoasă își eliberează codul)
CREATE UNIQUE INDEX executie_fibra_camerete_cod_uq ON public.executie_fibra_camerete (proiect_id, cod) WHERE stare <> 'anulata';
CREATE INDEX executie_fibra_camerete_proiect_idx ON public.executie_fibra_camerete (proiect_id, id);
CREATE INDEX executie_fibra_camerete_tronson_idx ON public.executie_fibra_camerete (tronson_id, km_m);
COMMENT ON TABLE public.executie_fibra_camerete IS
  'Execuție: cameretele fibrei optice (tronson, km, cod, stare). Scriere DOAR prin fn_executie_fibra_camereta_adauga / _stare și importul chat-ului. 20261211a.';
COMMENT ON COLUMN public.executie_fibra_camerete.km_m IS 'Poziția, metri întregi de la originea traseului (ca executie_tronsoane.km_start_m), în limitele tronsonului.';
COMMENT ON COLUMN public.executie_fibra_camerete.sursa IS 'proiect = din lista proiectului (import, fără autor în aplicație); santier = adăugată din aplicație. Pusă de server.';

-- ── intervalele raportate (monotub / validat / suflat) ───────────────────────────────────────────────────
CREATE TABLE public.executie_fibra_intervale (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
  etapa text NOT NULL CHECK (etapa IN ('monotub', 'validat', 'suflat')),
  km_de_la_m integer NOT NULL CHECK (km_de_la_m BETWEEN 0 AND 9999999),
  km_pana_la_m integer NOT NULL CHECK (km_pana_la_m BETWEEN 1 AND 10000000),
  data_lucru date NOT NULL,
  observatii text CHECK (observatii IS NULL OR (length(observatii) BETWEEN 1 AND 1000 AND observatii ~ '[^[:space:]]')),
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  motiv_anulare text CHECK (motiv_anulare IS NULL OR (length(motiv_anulare) BETWEEN 1 AND 500 AND motiv_anulare ~ '[^[:space:]]')),
  anulat_de uuid,
  anulat_nume text,
  anulat_la timestamptz,
  raportat_de uuid,
  raportat_nume text,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_fibra_intervale_ordine CHECK (km_pana_la_m > km_de_la_m),
  CONSTRAINT executie_fibra_intervale_anulare CHECK ((stare = 'anulat') = (motiv_anulare IS NOT NULL) AND (stare = 'anulat') = (anulat_la IS NOT NULL)
                                                    AND (stare = 'anulat' OR (anulat_de IS NULL AND anulat_nume IS NULL))),
  CONSTRAINT executie_fibra_intervale_id_tronson_uq UNIQUE (id, tronson_id),
  -- intervalele active ale aceleiași etape pe același tronson nu se suprapun; capetele se pot atinge ([de_la, pana_la))
  CONSTRAINT executie_fibra_intervale_monotub_excl EXCLUDE USING gist (
    int8range(tronson_id, tronson_id, '[]') WITH &&, int4range(km_de_la_m, km_pana_la_m, '[)') WITH &&) WHERE (stare = 'activ' AND etapa = 'monotub'),
  CONSTRAINT executie_fibra_intervale_validat_excl EXCLUDE USING gist (
    int8range(tronson_id, tronson_id, '[]') WITH &&, int4range(km_de_la_m, km_pana_la_m, '[)') WITH &&) WHERE (stare = 'activ' AND etapa = 'validat'),
  CONSTRAINT executie_fibra_intervale_suflat_excl EXCLUDE USING gist (
    int8range(tronson_id, tronson_id, '[]') WITH &&, int4range(km_de_la_m, km_pana_la_m, '[)') WITH &&) WHERE (stare = 'activ' AND etapa = 'suflat')
);
CREATE INDEX executie_fibra_intervale_proiect_idx ON public.executie_fibra_intervale (proiect_id, id);
CREATE INDEX executie_fibra_intervale_tronson_idx ON public.executie_fibra_intervale (tronson_id, etapa, km_de_la_m);
COMMENT ON TABLE public.executie_fibra_intervale IS
  'Execuție: raportările fibrei optice pe intervale de km (monotub / validat / suflat). Scriere DOAR prin fn_executie_fibra_raporteaza / _anuleaza. 20261211a.';
COMMENT ON COLUMN public.executie_fibra_intervale.km_de_la_m IS 'Începutul intervalului, metri întregi de la originea traseului. Interval [de_la, pana_la), în limitele tronsonului.';
COMMENT ON COLUMN public.executie_fibra_intervale.data_lucru IS 'Ziua lucrării (contorul „azi”). Etapa anterioară trebuie raportată cel târziu în aceeași zi.';

-- ── jurnalul operațiilor (doar adăugare) ─────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_fibra_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
  interval_id bigint,
  camereta_id bigint,
  actiune text NOT NULL CHECK (actiune IN ('raportare', 'anulare', 'camereta_adaugata', 'camereta_montata', 'camereta_montare_anulata', 'camereta_scoasa')),
  valori jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valori) = 'object'),
  cheie uuid NOT NULL,
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  creat_de uuid,
  creat_nume text,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_fibra_jurnal_interval_fk FOREIGN KEY (interval_id, tronson_id) REFERENCES public.executie_fibra_intervale (id, tronson_id),
  CONSTRAINT executie_fibra_jurnal_camereta_fk FOREIGN KEY (camereta_id, tronson_id) REFERENCES public.executie_fibra_camerete (id, tronson_id),
  CONSTRAINT executie_fibra_jurnal_cheie_uq UNIQUE (cheie),
  CONSTRAINT executie_fibra_jurnal_tinta CHECK ((interval_id IS NOT NULL) = (actiune IN ('raportare', 'anulare'))
                                               AND (camereta_id IS NOT NULL) = (actiune NOT IN ('raportare', 'anulare')))
);
CREATE INDEX executie_fibra_jurnal_proiect_idx ON public.executie_fibra_jurnal (proiect_id, id);
CREATE INDEX executie_fibra_jurnal_tronson_idx ON public.executie_fibra_jurnal (tronson_id, id);
CREATE INDEX executie_fibra_jurnal_interval_idx ON public.executie_fibra_jurnal (interval_id) WHERE interval_id IS NOT NULL;
CREATE INDEX executie_fibra_jurnal_camereta_idx ON public.executie_fibra_jurnal (camereta_id) WHERE camereta_id IS NOT NULL;
COMMENT ON TABLE public.executie_fibra_jurnal IS
  'Execuție: jurnalul operațiilor fibrei optice, în ordine; scris doar de RPC-urile fn_executie_fibra_*, nu se modifică. Ține cheile de idempotență. 20261211a.';

-- ── regulile intervalelor (trigger BEFORE: pe orice cale de scriere; L07, L08, L16, L20) ──
-- INSERT: proveniența (server), tronsonul blocat (FOR NO KEY UPDATE), proiectul tronsonului, limitele, suprapunerea, acoperirea.
-- UPDATE: singura schimbare permisă e activ -> anulat (cu motiv), fără o etapă următoare activă peste el.
CREATE FUNCTION public.fn_executie_fibra_reguli_interval() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  t record;
  v_alt record;
  v_ant text;
  v_urm text;
  v_lipsa record;
  v_tarziu date;
  v_et text;
  v_et_ant text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.proiect_id, NEW.tronson_id, NEW.etapa, NEW.km_de_la_m, NEW.km_pana_la_m, NEW.data_lucru, NEW.observatii,
        NEW.raportat_de, NEW.raportat_nume, NEW.creat_la)
       IS DISTINCT FROM (OLD.id, OLD.proiect_id, OLD.tronson_id, OLD.etapa, OLD.km_de_la_m, OLD.km_pana_la_m, OLD.data_lucru, OLD.observatii,
        OLD.raportat_de, OLD.raportat_nume, OLD.creat_la) THEN
      RAISE EXCEPTION 'fibra: o raportare nu se modifică (se anulează și se raportează din nou)' USING ERRCODE = '23514';
    END IF;
    IF NEW.stare IS NOT DISTINCT FROM OLD.stare THEN
      IF (NEW.motiv_anulare, NEW.anulat_de, NEW.anulat_nume, NEW.anulat_la) IS DISTINCT FROM (OLD.motiv_anulare, OLD.anulat_de, OLD.anulat_nume, OLD.anulat_la) THEN
        RAISE EXCEPTION 'fibra: anularea nu se modifică' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.stare <> 'activ' OR NEW.stare <> 'anulat' THEN
      RAISE EXCEPTION 'fibra: o raportare anulată nu se reactivează (se raportează din nou)' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.executie_tronsoane WHERE id = OLD.tronson_id FOR NO KEY UPDATE;
    -- etapa următoare (cea care o are pe aceasta ca anterioară): un interval activ al ei peste acesta = refuz
    SELECT e INTO v_urm FROM unnest(ARRAY['monotub', 'validat', 'suflat']) e WHERE public.fn_executie_fibra_etapa_anterioara(e) = OLD.etapa;
    IF v_urm IS NOT NULL THEN
      SELECT greatest(i.km_de_la_m, OLD.km_de_la_m) AS a, least(i.km_pana_la_m, OLD.km_pana_la_m) AS b, i.data_lucru INTO v_alt
        FROM public.executie_fibra_intervale i
       WHERE i.tronson_id = OLD.tronson_id AND i.etapa = v_urm AND i.stare = 'activ'
         AND int4range(i.km_de_la_m, i.km_pana_la_m, '[)') && int4range(OLD.km_de_la_m, OLD.km_pana_la_m, '[)')
       ORDER BY i.km_de_la_m, i.id LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'fibra: nu se poate anula: pe km %–% există „%” raportat pe % (anulează întâi acea raportare)',
          public.fn_executie_fibra_km(v_alt.a), public.fn_executie_fibra_km(v_alt.b),
          CASE v_urm WHEN 'validat' THEN 'validat' ELSE 'suflat' END, to_char(v_alt.data_lucru, 'DD.MM') USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.anulat_de := auth.uid();
    NEW.anulat_nume := (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid());
    NEW.anulat_la := now();
    RETURN NEW;
  END IF;

  -- INSERT: o raportare nouă e activă; proveniența o pune serverul (L08)
  IF NEW.stare IS DISTINCT FROM 'activ' OR NEW.motiv_anulare IS NOT NULL OR NEW.anulat_la IS NOT NULL OR NEW.anulat_de IS NOT NULL THEN
    RAISE EXCEPTION 'fibra: o raportare nouă e activă' USING ERRCODE = '23514';
  END IF;
  NEW.raportat_de := auth.uid();
  NEW.raportat_nume := (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid());
  NEW.anulat_nume := NULL;
  NEW.creat_la := now();
  SELECT x.proiect_id, x.cod, x.km_start_m, x.km_end_m INTO t FROM public.executie_tronsoane x WHERE x.id = NEW.tronson_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fibra: tronsonul nu există' USING ERRCODE = '23503'; END IF;
  IF t.proiect_id IS DISTINCT FROM NEW.proiect_id THEN
    RAISE EXCEPTION 'fibra: tronsonul nu e pe proiectul raportării' USING ERRCODE = '23514';
  END IF;
  IF t.km_start_m IS NULL OR t.km_end_m IS NULL OR t.km_end_m <= t.km_start_m THEN
    RAISE EXCEPTION 'fibra: tronsonul % nu are km de început și de sfârșit (se completează întâi la Tronsoane)', t.cod USING ERRCODE = '23514';
  END IF;
  IF NEW.km_de_la_m < t.km_start_m OR NEW.km_pana_la_m > t.km_end_m THEN
    RAISE EXCEPTION 'fibra: intervalul km %–% iese din tronsonul % (km %–%)', public.fn_executie_fibra_km(NEW.km_de_la_m),
      public.fn_executie_fibra_km(NEW.km_pana_la_m), t.cod, public.fn_executie_fibra_km(t.km_start_m), public.fn_executie_fibra_km(t.km_end_m)
      USING ERRCODE = '23514';
  END IF;
  v_et := CASE NEW.etapa WHEN 'monotub' THEN 'monotub montat' WHEN 'validat' THEN 'validat' WHEN 'suflat' THEN 'fibră suflată' ELSE NEW.etapa END;
  -- suprapunerea cu aceeași etapă (sub lock-ul tronsonului; EXCLUDE rămâne plasa de siguranță)
  SELECT greatest(i.km_de_la_m, NEW.km_de_la_m) AS a, least(i.km_pana_la_m, NEW.km_pana_la_m) AS b, i.data_lucru INTO v_alt
    FROM public.executie_fibra_intervale i
   WHERE i.tronson_id = NEW.tronson_id AND i.etapa = NEW.etapa AND i.stare = 'activ'
     AND int4range(i.km_de_la_m, i.km_pana_la_m, '[)') && int4range(NEW.km_de_la_m, NEW.km_pana_la_m, '[)')
   ORDER BY i.km_de_la_m, i.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'fibra: porțiunea km %–% e deja raportată pe % (%)', public.fn_executie_fibra_km(v_alt.a), public.fn_executie_fibra_km(v_alt.b),
      to_char(v_alt.data_lucru, 'DD.MM'), v_et USING ERRCODE = '23514';
  END IF;
  -- acoperirea completă de către etapa anterioară, raportată cel târziu în ziua acestei raportări
  v_ant := public.fn_executie_fibra_etapa_anterioara(NEW.etapa);
  IF v_ant IS NOT NULL THEN
    v_et_ant := CASE v_ant WHEN 'monotub' THEN 'monotub montat' ELSE 'validat' END;
    SELECT lower(r) AS a, upper(r) AS b INTO v_lipsa
      FROM unnest(int4multirange(int4range(NEW.km_de_la_m, NEW.km_pana_la_m, '[)'))
                  - coalesce((SELECT range_agg(int4range(i.km_de_la_m, i.km_pana_la_m, '[)')) FROM public.executie_fibra_intervale i
                               WHERE i.tronson_id = NEW.tronson_id AND i.etapa = v_ant AND i.stare = 'activ' AND i.data_lucru <= NEW.data_lucru),
                             '{}'::int4multirange)) r
     ORDER BY lower(r) LIMIT 1;
    IF FOUND THEN
      SELECT min(i.data_lucru) INTO v_tarziu FROM public.executie_fibra_intervale i
       WHERE i.tronson_id = NEW.tronson_id AND i.etapa = v_ant AND i.stare = 'activ' AND i.data_lucru > NEW.data_lucru
         AND int4range(i.km_de_la_m, i.km_pana_la_m, '[)') && int4range(v_lipsa.a, v_lipsa.b, '[)');
      IF v_tarziu IS NOT NULL THEN
        RAISE EXCEPTION 'fibra: pe km %–% „%” e raportat abia pe %, după data aleasă (%)', public.fn_executie_fibra_km(v_lipsa.a),
          public.fn_executie_fibra_km(v_lipsa.b), v_et_ant, to_char(v_tarziu, 'DD.MM'), to_char(NEW.data_lucru, 'DD.MM') USING ERRCODE = '23514';
      END IF;
      RAISE EXCEPTION 'fibra: porțiunea km %–% nu are „%” raportat („%” se raportează doar peste „%”)', public.fn_executie_fibra_km(v_lipsa.a),
        public.fn_executie_fibra_km(v_lipsa.b), v_et_ant, v_et, v_et_ant USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_reguli_interval() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_fibra_reguli_interval BEFORE INSERT OR UPDATE ON public.executie_fibra_intervale
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_fibra_reguli_interval();

-- ── regulile cameretelor (trigger BEFORE: pe orice cale; proveniența, limitele tronsonului, identitatea imuabilă, tranzițiile) ──
CREATE FUNCTION public.fn_executie_fibra_reguli_camereta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  t record;
  v_alt record;
  v_nume text := (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid());
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.proiect_id, NEW.tronson_id, NEW.cod, NEW.km_m, NEW.sursa, NEW.creat_de, NEW.creat_nume, NEW.creat_la)
       IS DISTINCT FROM (OLD.id, OLD.proiect_id, OLD.tronson_id, OLD.cod, OLD.km_m, OLD.sursa, OLD.creat_de, OLD.creat_nume, OLD.creat_la) THEN
      RAISE EXCEPTION 'fibra: codul, poziția și tronsonul cameretei nu se schimbă (o greșeală se scoate din listă și se adaugă din nou)' USING ERRCODE = '23514';
    END IF;
    IF NEW.stare IS DISTINCT FROM OLD.stare AND NOT public.fn_executie_fibra_cam_tranzitie(OLD.stare, NEW.stare) THEN
      RAISE EXCEPTION 'fibra: schimbare de stare nepermisă pentru cameretă (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '23514';
    END IF;
    IF NEW.stare = 'montata' AND OLD.stare <> 'montata' THEN
      NEW.montat_de := auth.uid(); NEW.montat_nume := v_nume;
    ELSIF NEW.stare = 'montata' THEN
      NEW.montat_de := OLD.montat_de; NEW.montat_nume := OLD.montat_nume;
    ELSE
      NEW.montat_de := NULL; NEW.montat_nume := NULL;
    END IF;
    NEW.versiune := OLD.versiune + 1;
    NEW.modificat_de := auth.uid();
    NEW.modificat_la := now();
    RETURN NEW;
  END IF;

  IF NEW.stare NOT IN ('de_montat', 'montata') THEN
    RAISE EXCEPTION 'fibra: o cameretă nouă e de montat sau montată' USING ERRCODE = '23514';
  END IF;
  SELECT x.proiect_id, x.cod, x.km_start_m, x.km_end_m INTO t FROM public.executie_tronsoane x WHERE x.id = NEW.tronson_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fibra: tronsonul nu există' USING ERRCODE = '23503'; END IF;
  IF t.proiect_id IS DISTINCT FROM NEW.proiect_id THEN
    RAISE EXCEPTION 'fibra: tronsonul nu e pe proiectul cameretei' USING ERRCODE = '23514';
  END IF;
  IF t.km_start_m IS NULL OR t.km_end_m IS NULL OR t.km_end_m <= t.km_start_m THEN
    RAISE EXCEPTION 'fibra: tronsonul % nu are km de început și de sfârșit (se completează întâi la Tronsoane)', t.cod USING ERRCODE = '23514';
  END IF;
  IF NEW.km_m < t.km_start_m OR NEW.km_m > t.km_end_m THEN
    RAISE EXCEPTION 'fibra: camereta % la km % iese din tronsonul % (km %–%)', NEW.cod, public.fn_executie_fibra_km(NEW.km_m), t.cod,
      public.fn_executie_fibra_km(t.km_start_m), public.fn_executie_fibra_km(t.km_end_m) USING ERRCODE = '23514';
  END IF;
  SELECT c.km_m, x.cod AS tronson INTO v_alt FROM public.executie_fibra_camerete c JOIN public.executie_tronsoane x ON x.id = c.tronson_id
   WHERE c.proiect_id = NEW.proiect_id AND c.cod = NEW.cod AND c.stare <> 'anulata' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'fibra: camereta % există deja pe proiect (tronsonul %, km %)', NEW.cod, v_alt.tronson, public.fn_executie_fibra_km(v_alt.km_m)
      USING ERRCODE = '23505';
  END IF;
  NEW.sursa := CASE WHEN auth.uid() IS NULL THEN 'proiect' ELSE 'santier' END;
  NEW.creat_de := auth.uid(); NEW.creat_nume := v_nume; NEW.creat_la := now();
  NEW.modificat_de := auth.uid(); NEW.modificat_la := now();
  NEW.versiune := 1;
  IF NEW.stare = 'montata' THEN NEW.montat_de := auth.uid(); NEW.montat_nume := v_nume; ELSE NEW.montat_de := NULL; NEW.montat_nume := NULL; END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_reguli_camereta() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_fibra_reguli_camereta BEFORE INSERT OR UPDATE ON public.executie_fibra_camerete
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_fibra_reguli_camereta();

-- ── jurnalul: doar adăugare; autorul îl pune serverul; proiectul = al tronsonului ──
CREATE FUNCTION public.fn_executie_fibra_prov_jurnal() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'fibra: jurnalul nu se modifică' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_tronsoane x WHERE x.id = NEW.tronson_id AND x.proiect_id = NEW.proiect_id) THEN
    RAISE EXCEPTION 'fibra: jurnal pe alt proiect decât al tronsonului' USING ERRCODE = '23514';
  END IF;
  NEW.creat_de := auth.uid();
  NEW.creat_nume := (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid());
  NEW.creat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_prov_jurnal() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_fibra_prov_jurnal BEFORE INSERT OR UPDATE ON public.executie_fibra_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_fibra_prov_jurnal();

-- ── garda pe executie_tronsoane: un tronson cu fibră nu-și schimbă proiectul și nu-și strânge km-ii peste raportări / camerete ──
-- SECURITY DEFINER: cine modifică tronsonul (TabTronsoane, orice cont logat) trebuie să fie oprit și de rândurile pe care RLS nu i le
-- arată. Doar CITEȘTE tabelele de aici; rândul tronsonului e deja blocat de UPDATE (aceeași ordine ca RPC-urile).
CREATE FUNCTION public.fn_executie_fibra_garda_tronson() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v record;
BEGIN
  IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id
     AND (EXISTS (SELECT 1 FROM public.executie_fibra_intervale WHERE tronson_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.executie_fibra_camerete WHERE tronson_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.executie_fibra_jurnal WHERE tronson_id = OLD.id)) THEN
    RAISE EXCEPTION 'tronsoane: tronsonul % are fibră optică raportată: proiectul lui nu se mai schimbă', OLD.cod USING ERRCODE = '23514';
  END IF;
  IF (NEW.km_start_m, NEW.km_end_m) IS DISTINCT FROM (OLD.km_start_m, OLD.km_end_m) THEN
    SELECT i.km_de_la_m AS a, i.km_pana_la_m AS b INTO v FROM public.executie_fibra_intervale i
     WHERE i.tronson_id = OLD.id AND i.stare = 'activ'
       AND (NEW.km_start_m IS NULL OR NEW.km_end_m IS NULL OR i.km_de_la_m < NEW.km_start_m OR i.km_pana_la_m > NEW.km_end_m)
     ORDER BY i.km_de_la_m, i.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'tronsoane: fibra optică raportată pe km %–% iese din noile limite ale tronsonului %; se anulează întâi raportarea',
        public.fn_executie_fibra_km(v.a), public.fn_executie_fibra_km(v.b), OLD.cod USING ERRCODE = '23514';
    END IF;
    SELECT c.cod, c.km_m INTO v FROM public.executie_fibra_camerete c
     WHERE c.tronson_id = OLD.id AND c.stare <> 'anulata'
       AND (NEW.km_start_m IS NULL OR NEW.km_end_m IS NULL OR c.km_m < NEW.km_start_m OR c.km_m > NEW.km_end_m)
     ORDER BY c.km_m, c.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'tronsoane: camereta % (km %) iese din noile limite ale tronsonului %; se scoate întâi din listă',
        v.cod, public.fn_executie_fibra_km(v.km_m), OLD.cod USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_garda_tronson() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_fibra_garda_tronson BEFORE UPDATE ON public.executie_tronsoane
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_fibra_garda_tronson();

-- ── RPC 1: raportarea unui interval (L01, L02, L04, L07, L08, L09, L17) ──
-- Ordinea: identitate -> tronsonul FOR NO KEY UPDATE -> proiectul tronsonului = p_proiect + drept -> idempotență -> etapă, dată
--   -> INSERT (trigger-ul: limite, suprapunere, acoperire) -> jurnal, totul în aceeași tranzacție.
-- Rezultat: {ok, duplicat, interval}. Refuzurile (reguli, drept) = excepții cu SQLSTATE (22023 / 23514 / 42501), nimic scris.
CREATE FUNCTION public.fn_executie_fibra_raporteaza(p_proiect bigint, p_tronson bigint, p_etapa text, p_km_de_la_m integer,
  p_km_pana_la_m integer, p_data date, p_observatii text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_proiect bigint;
  r public.executie_fibra_intervale;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile integer;
  v_obs text := nullif(btrim(coalesce(p_observatii, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'fibra: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_tronson IS NULL OR p_etapa IS NULL OR p_km_de_la_m IS NULL OR p_km_pana_la_m IS NULL OR p_data IS NULL OR p_cheie IS NULL THEN
    RAISE EXCEPTION 'fibra: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  SELECT x.proiect_id INTO v_proiect FROM public.executie_tronsoane x WHERE x.id = p_tronson FOR NO KEY UPDATE;
  IF NOT FOUND OR v_proiect IS DISTINCT FROM p_proiect OR NOT public.fn_executie_fibra_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'fibra: tronsonul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'raporteaza', 'proiect', p_proiect, 'tronson', p_tronson, 'etapa', p_etapa,
                                       'de_la', p_km_de_la_m, 'pana_la', p_km_pana_la_m, 'data', p_data, 'observatii', v_obs)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  SELECT jj.interval_id, jj.amprenta INTO j FROM public.executie_fibra_jurnal jj WHERE jj.cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta AND j.interval_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true,
                                'interval', (SELECT to_jsonb(i) FROM public.executie_fibra_intervale i WHERE i.id = j.interval_id));
    END IF;
    RAISE EXCEPTION 'fibra: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF public.fn_executie_fibra_etapa_anterioara(p_etapa) IS NULL AND p_etapa IS DISTINCT FROM 'monotub' THEN
    RAISE EXCEPTION 'fibra: etapă necunoscută (monotub / validat / suflat)' USING ERRCODE = '22023';
  END IF;
  IF p_km_de_la_m < 0 OR p_km_pana_la_m <= p_km_de_la_m OR p_km_pana_la_m > 10000000 THEN
    RAISE EXCEPTION 'fibra: intervalul de km e greșit (sfârșitul trebuie să fie după început)' USING ERRCODE = '22023';
  END IF;
  -- data lucrării (Europe/Bucharest): nu în viitor; cel mult 7 zile în urmă (owner-ul: 365, pentru ce s-a lucrat înainte de modul)
  v_zile := CASE WHEN public.fn_executie_fibra_owner() THEN 365 ELSE 7 END;
  IF p_data > v_azi OR p_data < v_azi - v_zile THEN
    RAISE EXCEPTION 'fibra: data trebuie să fie între % și %', to_char(v_azi - v_zile, 'DD.MM.YYYY'), to_char(v_azi, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(v_obs, '')) > 1000 THEN RAISE EXCEPTION 'fibra: observațiile au cel mult 1000 de caractere' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.executie_fibra_intervale (proiect_id, tronson_id, etapa, km_de_la_m, km_pana_la_m, data_lucru, observatii)
  VALUES (p_proiect, p_tronson, p_etapa, p_km_de_la_m, p_km_pana_la_m, p_data, v_obs)
  RETURNING * INTO r;
  INSERT INTO public.executie_fibra_jurnal (proiect_id, tronson_id, interval_id, actiune, valori, cheie, amprenta)
  VALUES (r.proiect_id, r.tronson_id, r.id, 'raportare',
          jsonb_strip_nulls(jsonb_build_object('etapa', r.etapa, 'km_de_la_m', r.km_de_la_m, 'km_pana_la_m', r.km_pana_la_m,
                                               'data', r.data_lucru, 'observatii', r.observatii)),
          p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'interval', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid) TO authenticated;

-- ── RPC 2: anularea unei raportări (cu motiv; doar cine a raportat sau owner-ul; rândul rămâne, jurnalul la fel) ──
-- Ordinea: identitate -> tronsonul rândului (imuabil, citit fără lock) -> tronsonul FOR NO KEY UPDATE -> rândul FOR UPDATE -> drept
--   -> idempotență -> stare -> autor -> UPDATE (trigger-ul: dependența etapei următoare) -> jurnal.
CREATE FUNCTION public.fn_executie_fibra_anuleaza(p_id bigint, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_tronson bigint;
  r public.executie_fibra_intervale;
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'fibra: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_cheie IS NULL THEN RAISE EXCEPTION 'fibra: parametri lipsă' USING ERRCODE = '22023'; END IF;
  SELECT i.tronson_id INTO v_tronson FROM public.executie_fibra_intervale i WHERE i.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fibra: raportarea nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.executie_tronsoane x WHERE x.id = v_tronson FOR NO KEY UPDATE;
  SELECT * INTO r FROM public.executie_fibra_intervale WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_executie_fibra_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'fibra: raportarea nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'anuleaza', 'id', p_id, 'motiv', v_motiv)::text);
  SELECT jj.interval_id, jj.amprenta INTO j FROM public.executie_fibra_jurnal jj WHERE jj.cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta AND j.interval_id = p_id THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'interval', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'fibra: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF r.stare <> 'activ' THEN RAISE EXCEPTION 'fibra: raportarea e deja anulată' USING ERRCODE = '22023'; END IF;
  IF r.raportat_de IS DISTINCT FROM v_uid AND NOT public.fn_executie_fibra_owner() THEN
    RAISE EXCEPTION 'fibra: o raportare o anulează doar cine a făcut-o sau owner-ul' USING ERRCODE = '42501';
  END IF;
  IF v_motiv IS NULL OR length(v_motiv) > 500 THEN
    RAISE EXCEPTION 'fibra: motivul anulării e obligatoriu (cel mult 500 de caractere)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.executie_fibra_intervale SET stare = 'anulat', motiv_anulare = v_motiv WHERE id = p_id
  RETURNING * INTO r;
  INSERT INTO public.executie_fibra_jurnal (proiect_id, tronson_id, interval_id, actiune, valori, cheie, amprenta)
  VALUES (r.proiect_id, r.tronson_id, r.id, 'anulare', jsonb_build_object('motiv', v_motiv, 'etapa', r.etapa,
          'km_de_la_m', r.km_de_la_m, 'km_pana_la_m', r.km_pana_la_m), p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'interval', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_anuleaza(bigint, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_anuleaza(bigint, text, uuid) TO authenticated;

-- ── RPC 3: o cameretă lipsă din listă, adăugată de pe șantier (de montat sau direct montată) ──
-- Ordinea: identitate -> tronsonul FOR NO KEY UPDATE -> proiect + drept -> idempotență -> cod / dată -> INSERT (trigger-ul: limite,
--   cod unic, proveniență) -> jurnal.
CREATE FUNCTION public.fn_executie_fibra_camereta_adauga(p_proiect bigint, p_tronson bigint, p_cod text, p_km_m integer,
  p_montata boolean, p_data date, p_observatii text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_proiect bigint;
  r public.executie_fibra_camerete;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile integer;
  v_cod text := upper(btrim(coalesce(p_cod, '')));
  v_obs text := nullif(btrim(coalesce(p_observatii, '')), '');
  v_amprenta text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'fibra: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_tronson IS NULL OR p_km_m IS NULL OR p_montata IS NULL OR p_cheie IS NULL OR (p_montata AND p_data IS NULL) THEN
    RAISE EXCEPTION 'fibra: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  SELECT x.proiect_id INTO v_proiect FROM public.executie_tronsoane x WHERE x.id = p_tronson FOR NO KEY UPDATE;
  IF NOT FOUND OR v_proiect IS DISTINCT FROM p_proiect OR NOT public.fn_executie_fibra_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'fibra: tronsonul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'camereta_adauga', 'proiect', p_proiect, 'tronson', p_tronson, 'cod', v_cod, 'km', p_km_m,
                                       'montata', p_montata, 'data', CASE WHEN p_montata THEN p_data END, 'observatii', v_obs)::text);
  SELECT jj.camereta_id, jj.amprenta INTO j FROM public.executie_fibra_jurnal jj WHERE jj.cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta AND j.camereta_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicat', true,
                                'camereta', (SELECT to_jsonb(c) FROM public.executie_fibra_camerete c WHERE c.id = j.camereta_id));
    END IF;
    RAISE EXCEPTION 'fibra: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF v_cod !~ '^[A-Z0-9][A-Z0-9./_-]{0,29}$' THEN
    RAISE EXCEPTION 'fibra: codul cameretei: litere mari, cifre și . / _ - (cel mult 30)' USING ERRCODE = '22023';
  END IF;
  IF p_km_m < 0 OR p_km_m > 9999999 THEN RAISE EXCEPTION 'fibra: km greșit' USING ERRCODE = '22023'; END IF;
  IF p_montata THEN
    v_zile := CASE WHEN public.fn_executie_fibra_owner() THEN 365 ELSE 7 END;
    IF p_data > v_azi OR p_data < v_azi - v_zile THEN
      RAISE EXCEPTION 'fibra: data trebuie să fie între % și %', to_char(v_azi - v_zile, 'DD.MM.YYYY'), to_char(v_azi, 'DD.MM.YYYY') USING ERRCODE = '22023';
    END IF;
  END IF;
  IF length(coalesce(v_obs, '')) > 1000 THEN RAISE EXCEPTION 'fibra: observațiile au cel mult 1000 de caractere' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.executie_fibra_camerete (proiect_id, tronson_id, cod, km_m, stare, data_montare, observatii)
  VALUES (p_proiect, p_tronson, v_cod, p_km_m, CASE WHEN p_montata THEN 'montata' ELSE 'de_montat' END, CASE WHEN p_montata THEN p_data END, v_obs)
  RETURNING * INTO r;
  INSERT INTO public.executie_fibra_jurnal (proiect_id, tronson_id, camereta_id, actiune, valori, cheie, amprenta)
  VALUES (r.proiect_id, r.tronson_id, r.id, 'camereta_adaugata',
          jsonb_strip_nulls(jsonb_build_object('cod', r.cod, 'km_m', r.km_m, 'stare', r.stare, 'data', r.data_montare, 'observatii', r.observatii)),
          p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'camereta', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_camereta_adauga(bigint, bigint, text, integer, boolean, date, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_camereta_adauga(bigint, bigint, text, integer, boolean, date, text, uuid) TO authenticated;

-- ── RPC 4: starea unei camerete: montată (cu data) / montarea anulată (motiv) / scoasă din listă (motiv) ──
-- Ordinea: identitate -> tronsonul cameretei (imuabil, fără lock) -> tronsonul FOR NO KEY UPDATE -> camereta FOR UPDATE -> drept
--   -> idempotență -> CAS (versiune) -> tranziție -> reguli (dată, motiv, autor) -> UPDATE (trigger-ul: proveniența, versiunea) -> jurnal.
-- Rezultat: {ok, duplicat, camereta} sau {ok:false, motiv:'conflict', camereta} (s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_fibra_camereta_stare(p_id bigint, p_versiune integer, p_stare_noua text, p_data date, p_motiv text, p_cheie uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_tronson bigint;
  r public.executie_fibra_camerete;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile integer;
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_amprenta text;
  v_veche text;
  j record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'fibra: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_stare_noua IS NULL OR p_cheie IS NULL THEN
    RAISE EXCEPTION 'fibra: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  SELECT c.tronson_id INTO v_tronson FROM public.executie_fibra_camerete c WHERE c.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fibra: camereta nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.executie_tronsoane x WHERE x.id = v_tronson FOR NO KEY UPDATE;
  SELECT * INTO r FROM public.executie_fibra_camerete WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_executie_fibra_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'fibra: camereta nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('op', 'camereta_stare', 'id', p_id, 'versiune', p_versiune, 'noua', p_stare_noua,
                                       'data', CASE WHEN p_stare_noua = 'montata' THEN p_data END, 'motiv', v_motiv)::text);
  SELECT jj.camereta_id, jj.amprenta INTO j FROM public.executie_fibra_jurnal jj WHERE jj.cheie = p_cheie;
  IF FOUND THEN
    IF j.amprenta = v_amprenta AND j.camereta_id = p_id THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'camereta', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'fibra: cheia apăsării a fost folosită pentru altă operație' USING ERRCODE = '22023';
  END IF;
  IF r.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'camereta', to_jsonb(r));
  END IF;
  IF NOT public.fn_executie_fibra_cam_tranzitie(r.stare, p_stare_noua) THEN
    RAISE EXCEPTION 'fibra: schimbare de stare nepermisă pentru cameretă (% -> %)', r.stare, p_stare_noua USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'montata' THEN
    v_zile := CASE WHEN public.fn_executie_fibra_owner() THEN 365 ELSE 7 END;
    IF p_data IS NULL OR p_data > v_azi OR p_data < v_azi - v_zile THEN
      RAISE EXCEPTION 'fibra: data trebuie să fie între % și %', to_char(v_azi - v_zile, 'DD.MM.YYYY'), to_char(v_azi, 'DD.MM.YYYY') USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_motiv IS NULL OR length(v_motiv) > 500 THEN
      RAISE EXCEPTION 'fibra: motivul e obligatoriu (cel mult 500 de caractere)' USING ERRCODE = '22023';
    END IF;
    -- montarea o anulează cine a raportat-o sau owner-ul; din listă scoate cine a adăugat-o de pe șantier sau owner-ul
    IF p_stare_noua = 'de_montat' AND r.montat_de IS DISTINCT FROM v_uid AND NOT public.fn_executie_fibra_owner() THEN
      RAISE EXCEPTION 'fibra: montarea o anulează doar cine a raportat-o sau owner-ul' USING ERRCODE = '42501';
    END IF;
    IF p_stare_noua = 'anulata' AND NOT (r.sursa = 'santier' AND r.creat_de IS NOT DISTINCT FROM v_uid) AND NOT public.fn_executie_fibra_owner() THEN
      RAISE EXCEPTION 'fibra: din listă scoate doar cine a adăugat camereta de pe șantier sau owner-ul (cele din proiect: owner-ul)' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_veche := r.stare;
  UPDATE public.executie_fibra_camerete SET
    stare = p_stare_noua,
    data_montare = CASE WHEN p_stare_noua = 'montata' THEN p_data END,
    motiv = CASE WHEN p_stare_noua = 'montata' THEN NULL ELSE v_motiv END
  WHERE id = p_id
  RETURNING * INTO r;
  INSERT INTO public.executie_fibra_jurnal (proiect_id, tronson_id, camereta_id, actiune, valori, cheie, amprenta)
  VALUES (r.proiect_id, r.tronson_id, r.id,
          CASE p_stare_noua WHEN 'montata' THEN 'camereta_montata' WHEN 'de_montat' THEN 'camereta_montare_anulata' ELSE 'camereta_scoasa' END,
          jsonb_strip_nulls(jsonb_build_object('cod', r.cod, 'stare_veche', v_veche, 'stare_noua', r.stare, 'data', r.data_montare, 'motiv', v_motiv)),
          p_cheie, v_amprenta);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'camereta', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_camereta_stare(bigint, integer, text, date, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_camereta_stare(bigint, integer, text, date, text, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC-uri ──
ALTER TABLE public.executie_fibra_camerete ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_fibra_intervale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_fibra_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_fibra_camerete, public.executie_fibra_intervale, public.executie_fibra_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_fibra_camerete, public.executie_fibra_intervale, public.executie_fibra_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_fibra_camerete_id_seq, public.executie_fibra_intervale_id_seq, public.executie_fibra_jurnal_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_fibra_camerete_citire ON public.executie_fibra_camerete FOR SELECT TO authenticated
  USING (public.fn_executie_fibra_drept(proiect_id, false));
CREATE POLICY executie_fibra_intervale_citire ON public.executie_fibra_intervale FOR SELECT TO authenticated
  USING (public.fn_executie_fibra_drept(proiect_id, false));
CREATE POLICY executie_fibra_jurnal_citire ON public.executie_fibra_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_fibra_drept(proiect_id, false));

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid; v_tab text;
BEGIN
  FOREACH v_tab IN ARRAY ARRAY['executie_fibra_camerete', 'executie_fibra_intervale', 'executie_fibra_jurnal'] LOOP
    v_rel := to_regclass('public.' || v_tab);
    -- RLS + exact o politică: SELECT, permisivă, doar authenticated, fără WITH CHECK, expresia EXACTĂ, dependentă de funcția de drept
    IF v_rel IS NULL OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = v_rel) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = v_rel AND pol.polname = v_tab || '_citire'
                       AND pol.polcmd = 'r' AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid]
                       AND pol.polwithcheck IS NULL
                       AND pg_get_expr(pol.polqual, pol.polrelid) IN ('fn_executie_fibra_drept(proiect_id, false)', 'public.fn_executie_fibra_drept(proiect_id, false)')
                       AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                                    AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.fn_executie_fibra_drept(bigint, boolean)'::regprocedure)) THEN
      RAISE EXCEPTION '20261211a post: RLS / politica %', v_tab;
    END IF;
    -- privilegiile efective: doar SELECT pentru authenticated / service_role, nimic pentru anon; nimic pe coloane / secvențe
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                WHERE has_table_privilege(r, v_rel, p))
       OR has_table_privilege('anon', v_rel, 'SELECT')
       OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
                   WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.' || v_tab, 'id'), p)) THEN
      RAISE EXCEPTION '20261211a post: privilegii pe % / secventa', v_tab;
    END IF;
  END LOOP;
  -- funcțiile: exact cele 13; DEFINER doar cele 6; search_path fix; EXECUTE pe lista exactă (L15: lista exactă, nu prefixul)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND starts_with(p.proname, 'fn_executie_fibra_')) <> 13
     OR EXISTS (SELECT 1 FROM (VALUES
          -- semnătura, DEFINER, EXECUTE authenticated, EXECUTE service_role
          ('public.fn_executie_fibra_drept(bigint, boolean)', true, true, true),
          ('public.fn_executie_fibra_owner()', false, false, false),
          ('public.fn_executie_fibra_etapa_anterioara(text)', false, true, true),
          ('public.fn_executie_fibra_cam_tranzitie(text, text)', false, true, true),
          ('public.fn_executie_fibra_km(integer)', false, true, true),
          ('public.fn_executie_fibra_reguli_interval()', false, false, false),
          ('public.fn_executie_fibra_reguli_camereta()', false, false, false),
          ('public.fn_executie_fibra_prov_jurnal()', false, false, false),
          ('public.fn_executie_fibra_garda_tronson()', true, false, false),
          ('public.fn_executie_fibra_raporteaza(bigint, bigint, text, integer, integer, date, text, uuid)', true, true, false),
          ('public.fn_executie_fibra_anuleaza(bigint, text, uuid)', true, true, false),
          ('public.fn_executie_fibra_camereta_adauga(bigint, bigint, text, integer, boolean, date, text, uuid)', true, true, false),
          ('public.fn_executie_fibra_camereta_stare(bigint, integer, text, date, text, uuid)', true, true, false)) a(semnatura, definer, ex_auth, ex_srv)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL
           OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.prosecdef IS DISTINCT FROM a.definer
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
           OR has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.ex_auth
           OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.ex_srv) THEN
    RAISE EXCEPTION '20261211a post: functii (lista / definer / search_path / EXECUTE)';
  END IF;
  -- trigger-ele: exact cele 4, pe funcția lor, active (origin), fără WHEN, fără listă de coloane; tgtype: BEFORE ROW INSERT OR UPDATE = 23,
  -- BEFORE ROW UPDATE = 19; niciun alt trigger ne-intern pe cele 3 tabele de aici
  IF (SELECT count(*) FROM pg_trigger tg JOIN (VALUES
        ('public.executie_fibra_intervale'::regclass, 'trg_executie_fibra_reguli_interval', 'public.fn_executie_fibra_reguli_interval()'::regprocedure, 23),
        ('public.executie_fibra_camerete'::regclass, 'trg_executie_fibra_reguli_camereta', 'public.fn_executie_fibra_reguli_camereta()'::regprocedure, 23),
        ('public.executie_fibra_jurnal'::regclass, 'trg_executie_fibra_prov_jurnal', 'public.fn_executie_fibra_prov_jurnal()'::regprocedure, 23),
        ('public.executie_tronsoane'::regclass, 'trg_executie_fibra_garda_tronson', 'public.fn_executie_fibra_garda_tronson()'::regprocedure, 19)) a(rel, nume, fn, tip)
        ON tg.tgrelid = a.rel AND tg.tgname = a.nume
       WHERE NOT tg.tgisinternal AND tg.tgfoid = a.fn AND tg.tgtype = a.tip AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
         AND coalesce(array_length(tg.tgattr::int2[], 1), 0) = 0) <> 4
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('public.executie_fibra_intervale'::regclass, 'public.executie_fibra_camerete'::regclass, 'public.executie_fibra_jurnal'::regclass)) <> 3 THEN
    RAISE EXCEPTION '20261211a post: trigger-ele';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.executie_fibra_intervale'::regclass AND contype = 'x'
        AND conname IN ('executie_fibra_intervale_monotub_excl', 'executie_fibra_intervale_validat_excl', 'executie_fibra_intervale_suflat_excl')) <> 3 THEN
    RAISE EXCEPTION '20261211a post: constrangerile de nesuprapunere';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_fibra_camerete) OR EXISTS (SELECT 1 FROM public.executie_fibra_intervale)
     OR EXISTS (SELECT 1 FROM public.executie_fibra_jurnal) THEN
    RAISE EXCEPTION '20261211a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261211a_executie_fibra_optica:' || txid_current() THEN
    RAISE EXCEPTION '20261211a: garda final invalida';
  END IF;
END $post$;
