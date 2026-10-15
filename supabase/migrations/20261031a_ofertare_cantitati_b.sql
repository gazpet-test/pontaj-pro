-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031a — Ofertare TKT-0329 B, PR2: schema de bază pentru cantități structurate + audit al răspunsurilor Autorității.
-- Specificația: docs/ofertare/TKT0329_B_SPEC.md v8 (aprobată la r8: Copilot GO, Jakarinos GO cu fix-uri), §4 + §5.3.
-- Obiecte NOI (nu schimbă date existente). Excepții, ambele aditive:
--   * (niciuna pe ofertare_licitatii: termenul de clarificări stă în tabelul nou ofertare_termen_clarificari);
--   * triggerul trg_ofertare_cb_clarificari_jurnal pe ofertare_clarificari (jurnal + înghețarea D1; erorile NU blochează
--     scrierea clarificării).
-- Tabele (19): ofertare_termen_clarificari, ofertare_ai_buget_jurnal, ofertare_doc_texte, ofertare_doc_texte_prov, ofertare_cant_extrageri, ofertare_cant_felii, ofertare_ai_buget,
--   ofertare_ai_cereri, ofertare_ai_rezervari, ofertare_cant_obs, ofertare_cant_doc_decizii, ofertare_cant_alias,
--   ofertare_cant_calcul, ofertare_cant_cmp, ofertare_analiza_versiuni, ofertare_analiza_completari,
--   ofertare_clarificari_jurnal, ofertare_analiza_erori, ofertare_audit_raspunsuri.
-- Drepturi: SELECT pentru authenticated cu fn_are_acces_ofertare() (NU pe ofertare_doc_texte — doar prin RPC); nimeni nu scrie
-- direct. Scrierea: funcții fn_ofertare_cb_* SECURITY DEFINER; EXECUTE doar service_role (edge) sau doar authenticated (RPC UI
-- cu poartă de rol în corp). Imuabilitate: triggere BEFORE UPDATE/DELETE care refuză orice rol (inclusiv service_role),
-- coloană cu coloană; stările se schimbă doar prin automatul de stare din funcții.
-- Plafonul: pe licitație + scop (ofertare_ai_buget), comun tuturor cererilor; consum = decontat + (deschise + necunoscute +
-- abandonate); rezervare per apel unică pe (munca_id, incercare) în toate stările; depășirea blochează bugetul.
-- Revenire: supabase/revenire/20261031a_ofertare_cantitati_b_ROLLBACK.sql (verifică amprenta; datele noi se pierd).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031a_ofertare_cantitati_b:' || txid_current() THEN
    RAISE EXCEPTION '20261031a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('check_function_bodies', 'off', true);
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%')
     OR to_regclass('public.ofertare_cant_obs') IS NOT NULL OR to_regclass('public.ofertare_ai_buget') IS NOT NULL
     OR to_regclass('public.ofertare_termen_clarificari') IS NOT NULL THEN
    RAISE EXCEPTION '20261031a: obiectele exista deja';
  END IF;
  IF to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)') IS NULL
     OR to_regprocedure('public.fn_ofertare_document_eligibil(bigint)') IS NULL
     OR to_regprocedure('public.fn_are_acces_ofertare()') IS NULL
     OR to_regclass('public.ofertare_clarificari') IS NULL OR to_regclass('public.ai_usage_log') IS NULL THEN
    RAISE EXCEPTION '20261031a: dependinte lipsa';
  END IF;
END $pre$;

-- lotul canonic: sortat, fără duplicate, fără NULL (review r1: [1,2] și [2,1] nu pot fi scope-uri diferite)
CREATE FUNCTION public.fn_ofertare_cb_lot_canonic(p integer[])
RETURNS integer[] LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp
AS $f$ SELECT coalesce(array_agg(DISTINCT x ORDER BY x) FILTER (WHERE x IS NOT NULL), '{}') FROM unnest(p) x $f$;

-- termenul de clarificări (decizia Răzvan 15.10, A): tabel SEPARAT (ofertare_licitatii are triggere de gardă pe scriere — J05,
-- poarta de depunere, loturi, service_role doar pe termen_depunere — deci nu se adaugă coloane acolo). AI-ul îl propune din Fișa de
-- date: clar = completat automat (propus_ai); neclar = candidații la responsabil, care confirmă (confirmat_om); manual = scris de om.
-- Fără rând / termen gol = înghețarea la termen folosește termen_depunere, marcat „termen aproximat”.
CREATE TABLE public.ofertare_termen_clarificari (
  licitatie_id bigint PRIMARY KEY REFERENCES public.ofertare_licitatii(id),
  termen       timestamptz,
  sursa        text CHECK (sursa IS NULL OR sursa IN ('propus_ai', 'confirmat_om', 'manual')),
  candidati    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(candidati) = 'object'),
  neclar       boolean NOT NULL DEFAULT false,
  setat_de     uuid,
  setat_la     timestamptz NOT NULL DEFAULT now(),
  CHECK ((termen IS NULL) = (sursa IS NULL))
);

-- ── texte (conținut) + proveniență ───────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_doc_texte (
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  text         text NOT NULL CHECK (length(text) <= 5000000),
  creat_la     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licitatie_id, sha256),
  CHECK (encode(sha256(convert_to(text, 'UTF8')), 'hex') = sha256)
);

CREATE TABLE public.ofertare_doc_texte_prov (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id    bigint NOT NULL,
  document_id     bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  sha256          text NOT NULL,
  origine         text NOT NULL CHECK (origine IN ('transcriere', 'sinteza_ai')),
  producator      text NOT NULL CHECK (producator ~ '^[a-z0-9-]{1,60}$'),
  completitudine  text NOT NULL CHECK (completitudine IN ('integral', 'partial')),
  pagini_necitite integer[] NOT NULL DEFAULT '{}',
  constatat_la    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (licitatie_id, sha256) REFERENCES public.ofertare_doc_texte(licitatie_id, sha256)
);
CREATE INDEX ofertare_doc_texte_prov_doc ON public.ofertare_doc_texte_prov (document_id, sha256, id DESC);

-- ── cheltuiala: buget pe licitație + scop, cereri, rezervări per apel ─────────────────────────────────────
CREATE TABLE public.ofertare_ai_buget (
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  scop         text NOT NULL CHECK (scop IN ('cant_extragere', 'audit_raspunsuri')),
  plafon_usd   numeric(8,2) NOT NULL CHECK (plafon_usd > 0 AND plafon_usd <= 100),
  blocat       boolean NOT NULL DEFAULT false,
  blocat_motiv text CHECK (blocat_motiv IS NULL OR length(blocat_motiv) <= 300),
  setat_de     uuid,
  setat_la     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licitatie_id, scop),
  CHECK (blocat = (blocat_motiv IS NOT NULL))
);

CREATE TABLE public.ofertare_ai_buget_jurnal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL,
  scop         text NOT NULL,
  actiune      text NOT NULL CHECK (actiune IN ('plafon', 'deblocare')),
  plafon_vechi numeric(8,2),
  plafon_nou   numeric(8,2) NOT NULL,
  consum       numeric(10,4) NOT NULL,
  motiv        text,
  de           uuid NOT NULL,
  la           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ofertare_ai_cereri (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  lot_domeniu  text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr       integer[] NOT NULL DEFAULT '{}',
  scop         text NOT NULL CHECK (scop IN ('cant_extragere', 'audit_raspunsuri')),
  aprobat_de   uuid NOT NULL,
  aprobat_la   timestamptz NOT NULL DEFAULT now(),
  valabil_pana timestamptz NOT NULL,
  stare        text NOT NULL DEFAULT 'activa' CHECK (stare IN ('activa', 'consumata', 'anulata')),
  stare_la     timestamptz,
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK (valabil_pana > aprobat_la AND valabil_pana <= aprobat_la + interval '30 days'),
  CHECK ((stare = 'activa') = (stare_la IS NULL)),
  FOREIGN KEY (licitatie_id, scop) REFERENCES public.ofertare_ai_buget(licitatie_id, scop)
);

CREATE TABLE public.ofertare_ai_rezervari (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerere_id      bigint NOT NULL REFERENCES public.ofertare_ai_cereri(id),
  licitatie_id   bigint NOT NULL,
  scop           text NOT NULL,
  munca_id       text NOT NULL CHECK (length(munca_id) BETWEEN 10 AND 400),
  incercare      integer NOT NULL DEFAULT 1 CHECK (incercare BETWEEN 1 AND 20),
  suma_rezervata numeric(10,4) NOT NULL CHECK (suma_rezervata >= 0.0001 AND suma_rezervata <= 2),
  stare          text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa', 'decontata', 'necunoscuta', 'abandonata')),
  cost_real      numeric(10,4) CHECK (cost_real IS NULL OR cost_real >= 0),
  tokeni_in      integer CHECK (tokeni_in IS NULL OR tokeni_in >= 0),
  tokeni_out     integer CHECK (tokeni_out IS NULL OR tokeni_out >= 0),
  model          text CHECK (model IS NULL OR length(model) <= 100),
  creat_la       timestamptz NOT NULL DEFAULT now(),
  inchisa_la     timestamptz,
  UNIQUE (munca_id, incercare),
  CHECK ((stare = 'deschisa') = (inchisa_la IS NULL)),
  CHECK ((stare = 'decontata') = (cost_real IS NOT NULL)),
  FOREIGN KEY (licitatie_id, scop) REFERENCES public.ofertare_ai_buget(licitatie_id, scop)
);
CREATE INDEX ofertare_ai_rezervari_buget ON public.ofertare_ai_rezervari (licitatie_id, scop);

-- ── decizii umane: documente (proveniență / rol / secțiune) + aliasuri ───────────────────────────────────
CREATE TABLE public.ofertare_cant_doc_decizii (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL,
  document_id  bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256   text NOT NULL CHECK (doc_sha256 ~ '^[0-9a-f]{64}$'),
  rol          text CHECK (rol IS NULL OR rol IN ('f3', 'c6', 'lista_alt', 'atr', 'cs', 'fisa_date', 'memoriu', 'plansa', 'raspuns', 'alt')),
  sectiune     text CHECK (sectiune IS NULL OR sectiune ~ '^(\*|[0-9]{1,5}-[0-9]{1,5})$'),
  decizie      text NOT NULL CHECK (decizie IN ('nu_e_sursa_cantitativa', 'rol_confirmat', 'verificat_fara_lungimi',
                                                'sursa_partiala_acceptata', 'text_confirmat', 'revocare')),
  revoca_id    bigint REFERENCES public.ofertare_cant_doc_decizii(id),
  motiv        text NOT NULL CHECK (length(motiv) BETWEEN 3 AND 500),
  decis_de     uuid NOT NULL,
  decis_la     timestamptz NOT NULL DEFAULT now(),
  -- text_confirmat = decizie de PROVENIENȚĂ: document + sha, fără rol / secțiune (Copilot r6)
  CHECK ((decizie = 'text_confirmat') <= (rol IS NULL AND sectiune IS NULL)),
  CHECK (decizie IN ('text_confirmat', 'revocare') OR (rol IS NOT NULL AND sectiune IS NOT NULL)),
  CHECK ((decizie = 'revocare') = (revoca_id IS NOT NULL))
);
CREATE INDEX ofertare_cant_doc_decizii_doc ON public.ofertare_cant_doc_decizii (document_id, doc_sha256);

CREATE TABLE public.ofertare_cant_alias (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  cheie_a      text NOT NULL CHECK (length(cheie_a) BETWEEN 3 AND 600),
  cheie_b      text NOT NULL CHECK (length(cheie_b) BETWEEN 3 AND 600),
  revoca_id    bigint REFERENCES public.ofertare_cant_alias(id),
  confirmat_de uuid NOT NULL,
  confirmat_la timestamptz NOT NULL DEFAULT now(),
  CHECK (cheie_a < cheie_b)
);

-- ── extrageri + felii (munca) ────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_cant_extrageri (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  document_id    bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256     text NOT NULL,
  prov_id        bigint REFERENCES public.ofertare_doc_texte_prov(id),
  dovada_decizie_id bigint REFERENCES public.ofertare_cant_doc_decizii(id),
  familie_id     text NOT NULL CHECK (length(familie_id) BETWEEN 1 AND 200),
  extractor_id   text NOT NULL CHECK (extractor_id ~ '^[A-Za-z0-9._:@/-]{3,200}$'),
  felii_total    integer NOT NULL CHECK (felii_total BETWEEN 1 AND 500),
  stare          text NOT NULL DEFAULT 'in_lucru' CHECK (stare IN ('in_lucru', 'gata', 'partial', 'esuat')),
  obs_relevante  integer CHECK (obs_relevante IS NULL OR obs_relevante >= 0),
  cerere_id      bigint NOT NULL REFERENCES public.ofertare_ai_cereri(id),
  reluari        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reluari) = 'array'),
  pornit_de      uuid,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  terminat_la    timestamptz,
  CHECK ((stare = 'in_lucru') = (terminat_la IS NULL)),
  CHECK ((stare = 'gata') = (obs_relevante IS NOT NULL)),
  CHECK (num_nonnulls(prov_id, dovada_decizie_id) = 1),
  FOREIGN KEY (licitatie_id, doc_sha256) REFERENCES public.ofertare_doc_texte(licitatie_id, sha256)
);
CREATE UNIQUE INDEX ofertare_cant_extrageri_cache ON public.ofertare_cant_extrageri (document_id, doc_sha256, extractor_id) WHERE stare = 'gata';
CREATE UNIQUE INDEX ofertare_cant_extrageri_o_activa ON public.ofertare_cant_extrageri (document_id, doc_sha256, extractor_id) WHERE stare = 'in_lucru';

CREATE TABLE public.ofertare_cant_felii (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  munca_id      text NOT NULL CHECK (length(munca_id) BETWEEN 10 AND 400),
  incercare     integer NOT NULL DEFAULT 1 CHECK (incercare BETWEEN 1 AND 20),
  extragere_id  bigint NOT NULL REFERENCES public.ofertare_cant_extrageri(id),
  felie_nr      integer NOT NULL CHECK (felie_nr BETWEEN 0 AND 499),
  de_la         integer NOT NULL CHECK (de_la >= 0),
  pana_la       integer NOT NULL,
  sha_felie     text NOT NULL CHECK (sha_felie ~ '^[0-9a-f]{64}$'),
  stare         text NOT NULL DEFAULT 'in_zbor' CHECK (stare IN ('in_zbor', 'gata', 'esuat', 'necunoscut')),
  rezervare_id  bigint REFERENCES public.ofertare_ai_rezervari(id),
  motiv_reluare text CHECK (motiv_reluare IS NULL OR length(motiv_reluare) <= 300),
  creat_la      timestamptz NOT NULL DEFAULT now(),
  inchisa_la    timestamptz,
  UNIQUE (munca_id, incercare),
  CHECK (pana_la > de_la),
  CHECK ((stare = 'in_zbor') = (inchisa_la IS NULL)),
  CHECK ((incercare = 1) = (motiv_reluare IS NULL))
);

-- ── observații (append-only, imuabile) ───────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_cant_obs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id      bigint NOT NULL,
  document_id       bigint NOT NULL,
  doc_sha256        text NOT NULL,
  familie_id        text NOT NULL,
  extragere_id      bigint NOT NULL REFERENCES public.ofertare_cant_extrageri(id),
  felie_nr          integer NOT NULL,
  lot_domeniu       text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr            integer[] NOT NULL DEFAULT '{}',
  rol_sursa         text NOT NULL CHECK (rol_sursa IN ('f3', 'c6', 'lista_alt', 'atr', 'cs', 'fisa_date', 'memoriu', 'plansa', 'raspuns', 'alt')),
  rol_decis_de      text NOT NULL CHECK (rol_decis_de IN ('antet', 'marcaj', 'titlu', 'model', 'om')),
  pagina            integer CHECK (pagina IS NULL OR pagina BETWEEN 1 AND 99999),
  cod_articol       text CHECK (cod_articol IS NULL OR length(cod_articol) <= 100),
  denumire          text NOT NULL CHECK (length(denumire) BETWEEN 1 AND 1000),
  rand_interval     int4range,
  citat_interval    int4range,
  cantitate_offset  integer CHECK (cantitate_offset IS NULL OR cantitate_offset >= 0),
  pozitie_dovedita  boolean NOT NULL,
  valoare_ambigua   boolean NOT NULL DEFAULT false,
  tip_lucrare       text NOT NULL CHECK (tip_lucrare IN ('conducta', 'bransament', 'protectie', 'alt')),
  masura            text NOT NULL CHECK (masura IN ('lungime', 'montaj', 'proba', 'material', 'alt')),
  obiect_brut       text CHECK (obiect_brut IS NULL OR length(obiect_brut) <= 300),
  obiect_cheie      text CHECK (obiect_cheie IS NULL OR length(obiect_cheie) <= 300),
  material          text CHECK (material IS NULL OR material ~ '^[A-Z0-9]{2,12}$'),
  dn_mm             numeric[] NOT NULL DEFAULT '{}',
  dn_model          numeric,
  dn_ambiguu        boolean NOT NULL DEFAULT false,
  sdr               numeric,
  um_norm           text CHECK (um_norm IS NULL OR um_norm ~ '^[a-z0-9.%/]{1,10}$'),
  cantitate         numeric,
  e_total           boolean NOT NULL DEFAULT false,
  e_subtotal        boolean NOT NULL DEFAULT false,
  citat             text NOT NULL CHECK (length(citat) BETWEEN 1 AND 300),
  extractor_id      text NOT NULL,
  hash_rand         text NOT NULL CHECK (hash_rand ~ '^[0-9a-f]{64}$'),
  creat_la          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extragere_id, felie_nr, hash_rand),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK (NOT pozitie_dovedita OR (cantitate_offset IS NOT NULL AND citat_interval IS NOT NULL AND rand_interval IS NOT NULL)),
  CHECK (NOT (pozitie_dovedita AND valoare_ambigua))
);
CREATE INDEX ofertare_cant_obs_lic ON public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256);

-- ── calcule + comparații (imuabile) ──────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_cant_calcul (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id       bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  lot_domeniu        text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr             integer[] NOT NULL DEFAULT '{}',
  tip                text NOT NULL CHECK (tip IN ('curent', 'simulare')),
  pe_snapshot_id     bigint,
  algoritm_versiune  text NOT NULL CHECK (algoritm_versiune ~ '^[a-z0-9._-]{1,40}$'),
  praguri            jsonb NOT NULL CHECK (jsonb_typeof(praguri) = 'object'),
  extractor_id       text NOT NULL,
  doc_manifest       jsonb NOT NULL CHECK (jsonb_typeof(doc_manifest) = 'array'),
  obs_manifest       jsonb NOT NULL CHECK (jsonb_typeof(obs_manifest) = 'array'),
  alias_manifest     jsonb NOT NULL CHECK (jsonb_typeof(alias_manifest) = 'array'),
  decizii_manifest   jsonb NOT NULL CHECK (jsonb_typeof(decizii_manifest) = 'array'),
  acoperire          jsonb NOT NULL CHECK (jsonb_typeof(acoperire) = 'object'),
  stare              text NOT NULL CHECK (stare IN ('incomplet', 'gata')),
  amprenta           text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  creat_la           timestamptz NOT NULL DEFAULT now(),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK ((tip = 'simulare') = (pe_snapshot_id IS NOT NULL))
);

CREATE TABLE public.ofertare_cant_cmp (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calcul_id       bigint NOT NULL REFERENCES public.ofertare_cant_calcul(id),
  cheie           text NOT NULL CHECK (length(cheie) BETWEEN 3 AND 600),
  rol_a           text NOT NULL,
  rol_b           text NOT NULL,
  val_a           numeric,
  val_b           numeric,
  obs_a           bigint[] NOT NULL DEFAULT '{}',
  obs_b           bigint[] NOT NULL DEFAULT '{}',
  delta_abs       numeric,
  delta_rel       numeric,
  verdict         text NOT NULL CHECK (verdict IN ('concordant', 'diferenta', 'lipsa_a', 'lipsa_b', 'conflict_sursa', 'neasociat', 'incomplet')),
  motiv_incomplet text CHECK (motiv_incomplet IS NULL OR length(motiv_incomplet) <= 300),
  importanta      numeric NOT NULL DEFAULT 0,
  UNIQUE (calcul_id, rol_a, rol_b, cheie),
  CHECK ((verdict = 'incomplet') = (motiv_incomplet IS NOT NULL))
);

-- ── snapshot (imuabil) + completări (append-only) + jurnalul clarificărilor + erori ──────────────────────
-- licitatie_id FĂRĂ FK (review r2, Jakarinos): inserarea din triggerul clarificărilor nu are voie să aștepte FOR KEY SHARE pe
-- ofertare_licitatii (ținut FOR UPDATE de cerere / termen); existența licitației o verifică fn_ofertare_cb_ingheata.
CREATE TABLE public.ofertare_analiza_versiuni (
  id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id                 bigint NOT NULL,
  lot_domeniu                  text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr                       integer[] NOT NULL DEFAULT '{}',
  tip                          text NOT NULL CHECK (tip IN ('initiala', 'recalcul')),
  declansator                  text NOT NULL CHECK (declansator IN ('clarificare_trimisa', 'termen_clarificari', 'manual')),
  clarificare_declansatoare_id bigint,
  moment_referinta             timestamptz NOT NULL,
  inghetat_tardiv              boolean NOT NULL,
  termen_aproximat             boolean NOT NULL DEFAULT false,
  -- eligibilitatea / loturile NU au istoric as-of: „exacta” = momentul e acum SAU loturile nu s-au schimbat după moment;
  -- altfel „modificata_dupa_moment” → auditul pe acest snapshot rămâne „nedeterminabil” (review r2, Jakarinos)
  eligibilitate                text NOT NULL CHECK (eligibilitate IN ('exacta', 'modificata_dupa_moment')),
  inghetata_la                 timestamptz NOT NULL DEFAULT now(),
  inghetata_de                 uuid,
  doc_manifest                 jsonb NOT NULL CHECK (jsonb_typeof(doc_manifest) = 'array'),
  clarificari                  jsonb NOT NULL CHECK (jsonb_typeof(clarificari) = 'array'),
  amprenta                     text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK (moment_referinta <= inghetata_la)
);
CREATE UNIQUE INDEX ofertare_analiza_versiuni_initiala ON public.ofertare_analiza_versiuni (licitatie_id, lot_domeniu, lot_nr) WHERE tip = 'initiala';
ALTER TABLE public.ofertare_cant_calcul ADD FOREIGN KEY (pe_snapshot_id) REFERENCES public.ofertare_analiza_versiuni(id);

CREATE TABLE public.ofertare_analiza_completari (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES public.ofertare_analiza_versiuni(id),
  texte       jsonb NOT NULL CHECK (jsonb_typeof(texte) = 'array'),   -- [{document_id, sha256}] materializate în ofertare_doc_texte
  calcul_id   bigint REFERENCES public.ofertare_cant_calcul(id),
  coerenta    text NOT NULL CHECK (coerenta IN ('calcul_curent', 'calcul_depasit', 'fara_calcul')),
  motiv       text CHECK (motiv IS NULL OR length(motiv) <= 500),
  creat_la    timestamptz NOT NULL DEFAULT now(),
  CHECK ((coerenta = 'calcul_curent') = (calcul_id IS NOT NULL))
);
CREATE INDEX ofertare_analiza_completari_snap ON public.ofertare_analiza_completari (snapshot_id, id DESC);

CREATE TABLE public.ofertare_clarificari_jurnal (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clarificare_id bigint NOT NULL,
  licitatie_id   bigint NOT NULL,
  eveniment      text NOT NULL CHECK (eveniment IN ('trimisa', 'raspunsa', 'retrasa')),
  text           text NOT NULL,
  text_sha256    text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  la             timestamptz NOT NULL DEFAULT now(),
  CHECK (encode(sha256(convert_to(text, 'UTF8')), 'hex') = text_sha256)
);
CREATE INDEX ofertare_clarificari_jurnal_lic ON public.ofertare_clarificari_jurnal (licitatie_id, clarificare_id, la, id);

CREATE TABLE public.ofertare_analiza_erori (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint,
  clarificare_id bigint,
  faza           text NOT NULL CHECK (faza IN ('jurnal', 'ingheata', 'completare')),
  eroare         text NOT NULL CHECK (length(eroare) <= 1000),
  la             timestamptz NOT NULL DEFAULT now()
);

-- ── auditul răspunsurilor ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_audit_raspunsuri (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id       bigint NOT NULL,
  lot_domeniu        text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr             integer[] NOT NULL DEFAULT '{}',
  versiune_analiza_id bigint NOT NULL REFERENCES public.ofertare_analiza_versiuni(id),
  document_id        bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256         text NOT NULL CHECK (doc_sha256 ~ '^[0-9a-f]{64}$'),
  citire_id          text NOT NULL CHECK (length(citire_id) BETWEEN 10 AND 300),
  citire_sursa_tip   text NOT NULL CHECK (citire_sursa_tip IN ('pdf', 'text')),
  citire_sursa_sha   text NOT NULL CHECK (citire_sursa_sha ~ '^[0-9a-f]{64}$'),
  citire_completa    boolean NOT NULL,
  executie_id        text NOT NULL CHECK (executie_id ~ '^[0-9a-f]{64}$'),
  inlocuieste_id     bigint REFERENCES public.ofertare_audit_raspunsuri(id),
  pereche_id         text NOT NULL CHECK (pereche_id ~ '^[0-9a-f]{64}$'),
  pozitii            jsonb NOT NULL CHECK (jsonb_typeof(pozitii) = 'array'),
  multiplicitate     integer NOT NULL DEFAULT 1 CHECK (multiplicitate >= 1),
  intrebare_text     text NOT NULL CHECK (length(intrebare_text) <= 20000),
  raspuns_text       text NOT NULL CHECK (length(raspuns_text) <= 50000),
  text_verificat     boolean NOT NULL,
  asociere_dovedita  boolean NOT NULL,
  ancore             jsonb NOT NULL CHECK (jsonb_typeof(ancore) = 'object'),
  efect              text NOT NULL CHECK (efect IN ('confirmare', 'modificare', 'cantitati', 'neclar')),
  clasificare        text NOT NULL CHECK (clasificare IN ('omisiune', 'modificare_ulterioara', 'deja_observat', 'nedeterminabil')),
  cauza              text CHECK (cauza IS NULL OR cauza IN ('intrebat_de_noi', 'document_nou', 'detectat_neintrebat', 'analiza_incompleta')),
  regula             text NOT NULL CHECK (regula ~ '^[a-z0-9._@-]{1,60}$'),
  dovezi_istoric     jsonb NOT NULL CHECK (jsonb_typeof(dovezi_istoric) = 'object'),
  dovezi_simulare    jsonb CHECK (dovezi_simulare IS NULL OR jsonb_typeof(dovezi_simulare) = 'object'),
  decizie_om         text CHECK (decizie_om IS NULL OR decizie_om IN ('confirmat', 'respins')),
  decis_de           uuid,
  decis_la           timestamptz,
  nota               text CHECK (nota IS NULL OR length(nota) <= 1000),
  creat_la           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (versiune_analiza_id, executie_id, pereche_id),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  -- automatul de clasificare (spec §5.4): nimic automat fără text și asociere dovedite; cauza obligatorie în afara „nedeterminabil”
  CHECK (clasificare = 'nedeterminabil' OR (text_verificat AND asociere_dovedita AND citire_completa)),
  CHECK ((clasificare = 'nedeterminabil') = (cauza IS NULL)),
  CHECK (clasificare <> 'deja_observat' OR cauza = 'intrebat_de_noi'),
  CHECK (clasificare <> 'modificare_ulterioara' OR cauza = 'document_nou'),
  CHECK (clasificare <> 'omisiune' OR cauza IN ('detectat_neintrebat', 'analiza_incompleta')),
  CHECK (cauza IS DISTINCT FROM 'analiza_incompleta' OR dovezi_simulare IS NOT NULL),
  CHECK ((decizie_om IS NULL) = (decis_de IS NULL) AND (decizie_om IS NULL) = (decis_la IS NULL))
);

-- ── imuabilitate: un singur trigger generic; TG_ARGV = coloanele care se pot schimba (doar prin funcțiile migrației) ──
CREATE FUNCTION public.fn_ofertare_cb_imuabil()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
DECLARE v_vechi jsonb; v_nou jsonb; c text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '%: rândurile nu se șterg (imuabil)', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  v_vechi := to_jsonb(OLD); v_nou := to_jsonb(NEW);
  FOREACH c IN ARRAY coalesce(TG_ARGV, ARRAY[]::text[]) LOOP v_vechi := v_vechi - c; v_nou := v_nou - c; END LOOP;
  IF v_vechi IS DISTINCT FROM v_nou THEN RAISE EXCEPTION '%: coloane imuabile modificate', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $f$;

DO $imuabil$
BEGIN
  -- integral imuabile
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_doc_texte FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_doc_texte_prov FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_obs FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_cmp FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_calcul FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_analiza_versiuni FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_analiza_completari FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_clarificari_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_doc_decizii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_alias FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_analiza_erori FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_buget_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()';
  -- câmpuri imuabile + stare (automatul de stare e în funcții)
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_buget FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''plafon_usd'', ''blocat'', ''blocat_motiv'', ''setat_de'', ''setat_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_cereri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''stare_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_rezervari FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''cost_real'', ''tokeni_in'', ''tokeni_out'', ''model'', ''inchisa_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_extrageri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''obs_relevante'', ''terminat_la'', ''cerere_id'', ''reluari'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_felii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''rezervare_id'', ''inchisa_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_audit_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''decizie_om'', ''decis_de'', ''decis_la'', ''nota'')';
END $imuabil$;

-- automatul de stare (tranziții permise o singură dată), verificat de triggere separate
CREATE FUNCTION public.fn_ofertare_cb_tranzitie()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.stare IS NOT DISTINCT FROM NEW.stare THEN RETURN NEW; END IF;
  IF (TG_TABLE_NAME = 'ofertare_ai_cereri' AND OLD.stare = 'activa' AND NEW.stare IN ('consumata', 'anulata'))
     OR (TG_TABLE_NAME = 'ofertare_ai_rezervari' AND OLD.stare = 'deschisa' AND NEW.stare IN ('decontata', 'necunoscuta', 'abandonata'))
     OR (TG_TABLE_NAME = 'ofertare_ai_rezervari' AND OLD.stare = 'necunoscuta' AND NEW.stare = 'abandonata')
     OR (TG_TABLE_NAME = 'ofertare_cant_extrageri' AND OLD.stare = 'in_lucru' AND NEW.stare IN ('gata', 'partial', 'esuat'))
     -- redeschiderea (doar fn_ofertare_cb_extragere_redeschide: om, cu motiv și cerere activă) — calea de reluare (review r2)
     OR (TG_TABLE_NAME = 'ofertare_cant_extrageri' AND OLD.stare IN ('partial', 'esuat') AND NEW.stare = 'in_lucru')
     OR (TG_TABLE_NAME = 'ofertare_cant_felii' AND OLD.stare = 'in_zbor' AND NEW.stare IN ('gata', 'esuat', 'necunoscut')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: tranziție de stare nepermisă % → %', TG_TABLE_NAME, OLD.stare, NEW.stare USING ERRCODE = '42501';
END $f$;
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_ai_cereri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_ai_rezervari FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_cant_extrageri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_cant_felii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
-- decizia umană din audit: o singură dată (NULL → confirmat / respins)
CREATE FUNCTION public.fn_ofertare_cb_decizie_o_data()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
BEGIN
  IF OLD.decizie_om IS NOT NULL THEN RAISE EXCEPTION 'Decizia umană e deja înregistrată' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER a02_decizie BEFORE UPDATE ON public.ofertare_audit_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_decizie_o_data();

-- ── drepturi + RLS ───────────────────────────────────────────────────────────────────────────────────────
DO $drepturi$
DECLARE t text; s text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_doc_texte', 'ofertare_doc_texte_prov', 'ofertare_ai_buget', 'ofertare_ai_cereri', 'ofertare_ai_rezervari',
                           'ofertare_cant_extrageri', 'ofertare_cant_felii', 'ofertare_cant_obs', 'ofertare_cant_doc_decizii', 'ofertare_cant_alias',
                           'ofertare_cant_calcul', 'ofertare_cant_cmp', 'ofertare_analiza_versiuni', 'ofertare_analiza_completari',
                           'ofertare_clarificari_jurnal', 'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari', 'ofertare_ai_buget_jurnal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    s := CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attname = 'id' AND NOT attisdropped)
              THEN pg_get_serial_sequence('public.' || t, 'id') END;
    IF s IS NOT NULL THEN EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', s); END IF;
    IF t <> 'ofertare_doc_texte' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))', t || '_select', t);
    END IF;
    EXECUTE format('COMMENT ON TABLE public.%I IS %L', t, 'TKT-0329 B (20261031a). Scriere doar prin fn_ofertare_cb_*.');
  END LOOP;
END $drepturi$;

-- ═════════════════════════════════════ funcții ════════════════════════════════════════════════════════════
-- poarta de rol (owner / responsabil / admin Ofertare) — aceeași ca la OCR local
CREATE FUNCTION public.fn_ofertare_cb_poate(p_licitatie_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT auth.uid() IS NOT NULL AND coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) $f$;

CREATE FUNCTION public.fn_ofertare_cb_este_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT auth.uid() IS NOT NULL AND coalesce((SELECT is_owner FROM public.profiles WHERE id = auth.uid()), false) $f$;

CREATE FUNCTION public.fn_ofertare_cb_lot_ok(p_dom text, p_nr integer[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT p_dom IN ('toate', 'lista', 'necunoscut') AND p_nr IS NOT NULL AND (p_dom = 'lista') = (cardinality(p_nr) > 0)
              AND p_nr = public.fn_ofertare_cb_lot_canonic(p_nr) $f$;

-- ── buget (owner) ──
CREATE FUNCTION public.fn_ofertare_cb_buget_seteaza(p_licitatie_id bigint, p_scop text, p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE b record; v_consum numeric;
BEGIN
  IF NOT public.fn_ofertare_cb_este_owner() THEN RAISE EXCEPTION 'Doar owner-ul setează plafonul' USING ERRCODE = '42501'; END IF;
  IF p_scop NOT IN ('cant_extragere', 'audit_raspunsuri') OR p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 100
     OR p_plafon_usd <> round(p_plafon_usd, 2) THEN RAISE EXCEPTION 'Scop sau plafon invalid' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id) THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  -- același lock ca rezervarea: rândul bugetului (creat dacă lipsește), ÎNAINTEA citirii consumului (review r1)
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd, setat_de) VALUES (p_licitatie_id, p_scop, p_plafon_usd, auth.uid())
  ON CONFLICT (licitatie_id, scop) DO NOTHING;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop FOR UPDATE;
  v_consum := public.fn_ofertare_cb_consum(p_licitatie_id, p_scop);
  IF p_plafon_usd < v_consum THEN RAISE EXCEPTION 'Plafonul (%) e sub consumul existent (%)', p_plafon_usd, v_consum USING ERRCODE = '22023'; END IF;
  UPDATE public.ofertare_ai_buget SET plafon_usd = p_plafon_usd, setat_de = auth.uid(), setat_la = now() WHERE licitatie_id = p_licitatie_id AND scop = p_scop;
  INSERT INTO public.ofertare_ai_buget_jurnal (licitatie_id, scop, actiune, plafon_vechi, plafon_nou, consum, de)
  VALUES (p_licitatie_id, p_scop, 'plafon', b.plafon_usd, p_plafon_usd, v_consum, auth.uid());
  RETURN jsonb_build_object('ok', true, 'plafon_usd', p_plafon_usd, 'consum', v_consum);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_buget_deblocheaza(p_licitatie_id bigint, p_scop text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE b record;
BEGIN
  IF NOT public.fn_ofertare_cb_este_owner() THEN RAISE EXCEPTION 'Doar owner-ul deblochează bugetul' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop FOR UPDATE;
  IF NOT FOUND OR NOT b.blocat THEN RAISE EXCEPTION 'Bugetul nu e blocat' USING ERRCODE = '55000'; END IF;
  UPDATE public.ofertare_ai_buget SET blocat = false, blocat_motiv = NULL, setat_de = auth.uid(), setat_la = now()
   WHERE licitatie_id = p_licitatie_id AND scop = p_scop;
  INSERT INTO public.ofertare_ai_buget_jurnal (licitatie_id, scop, actiune, plafon_vechi, plafon_nou, consum, motiv, de)
  VALUES (p_licitatie_id, p_scop, 'deblocare', b.plafon_usd, b.plafon_usd, public.fn_ofertare_cb_consum(p_licitatie_id, p_scop), b.blocat_motiv, auth.uid());
  RETURN jsonb_build_object('ok', true);
END $f$;

-- consumul canonic (spec §4.3): decontat + deschise + necunoscute + abandonate
CREATE FUNCTION public.fn_ofertare_cb_consum(p_licitatie_id bigint, p_scop text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT coalesce(sum(CASE WHEN stare = 'decontata' THEN cost_real ELSE suma_rezervata END), 0)
    FROM public.ofertare_ai_rezervari WHERE licitatie_id = p_licitatie_id AND scop = p_scop
$f$;

-- ── cerere (owner / responsabil) ──
CREATE FUNCTION public.fn_ofertare_cb_cerere(p_licitatie_id bigint, p_scop text, p_lot_domeniu text, p_lot_nr integer[], p_ore integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_id bigint; v_nr integer[] := public.fn_ofertare_cb_lot_canonic(p_lot_nr);
BEGIN
  IF NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare aprobă cheltuiala' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_ofertare_cb_lot_ok(p_lot_domeniu, v_nr) OR p_ore IS NULL OR p_ore < 1 OR p_ore > 720 THEN
    RAISE EXCEPTION 'Lot sau valabilitate invalidă' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  -- loturile din listă: ale licitației și cu participare
  IF p_lot_domeniu = 'lista' AND EXISTS (SELECT 1 FROM unnest(v_nr) x WHERE NOT EXISTS (
       SELECT 1 FROM public.ofertare_licitatie_loturi l WHERE l.licitatie_id = p_licitatie_id AND l.nr = x AND l.participam)) THEN
    RAISE EXCEPTION 'Lot inexistent sau fără participare' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop) THEN
    RAISE EXCEPTION 'Nu există plafon pentru % pe această licitație (îl setează owner-ul)', p_scop USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ai_cereri (licitatie_id, lot_domeniu, lot_nr, scop, aprobat_de, valabil_pana)
  VALUES (p_licitatie_id, p_lot_domeniu, v_nr, p_scop, auth.uid(), now() + make_interval(hours => p_ore)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'cerere_id', v_id);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_cerere_anuleaza(p_cerere_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.ofertare_ai_cereri WHERE id = p_cerere_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(r.licitatie_id) THEN RAISE EXCEPTION 'Cerere inexistentă sau fără drept' USING ERRCODE = '42501'; END IF;
  IF r.stare <> 'activa' THEN RAISE EXCEPTION 'Cererea nu mai e activă' USING ERRCODE = '55000'; END IF;
  UPDATE public.ofertare_ai_cereri SET stare = 'anulata', stare_la = now() WHERE id = p_cerere_id;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- ── rezervare per apel (service_role): FOR UPDATE pe bugetul licitației + scop; unic pe (munca_id, incercare) în toate stările ──
CREATE FUNCTION public.fn_ofertare_cb_rezerva(p_felie_id bigint, p_suma numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; c record; b record; v_consum numeric; v_id bigint;
BEGIN
  IF p_suma IS NULL OR p_suma < 0.0001 OR p_suma > 2 OR p_suma <> round(p_suma, 4) THEN RETURN jsonb_build_object('refuz', 'parametri'); END IF;
  -- ordinea lock-urilor (aceeași peste tot): felie → extragere → cerere → buget (review r2: extragerea blocată, re-verificată)
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id FOR UPDATE;
  IF NOT FOUND OR f.stare <> 'in_zbor' OR f.rezervare_id IS NOT NULL THEN RETURN jsonb_build_object('refuz', 'felie'); END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id FOR SHARE;
  IF NOT FOUND OR x.stare <> 'in_lucru' THEN RETURN jsonb_build_object('refuz', 'extragere'); END IF;
  SELECT * INTO c FROM public.ofertare_ai_cereri WHERE id = x.cerere_id FOR UPDATE;
  IF c.stare <> 'activa' OR c.valabil_pana <= now() THEN RETURN jsonb_build_object('refuz', 'cerere'); END IF;
  IF NOT public.fn_ofertare_cb_doc_in_lot(x.document_id, c.lot_domeniu, c.lot_nr) THEN RETURN jsonb_build_object('refuz', 'lot'); END IF;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = c.licitatie_id AND scop = c.scop FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'buget'); END IF;
  IF b.blocat THEN RETURN jsonb_build_object('refuz', 'buget_blocat'); END IF;
  v_consum := public.fn_ofertare_cb_consum(c.licitatie_id, c.scop);
  IF v_consum + p_suma > b.plafon_usd THEN RETURN jsonb_build_object('refuz', 'plafon', 'consum', v_consum, 'plafon', b.plafon_usd); END IF;
  INSERT INTO public.ofertare_ai_rezervari (cerere_id, licitatie_id, scop, munca_id, incercare, suma_rezervata)
  VALUES (c.id, c.licitatie_id, c.scop, f.munca_id, f.incercare, p_suma)
  ON CONFLICT (munca_id, incercare) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('refuz', 'munca_deja_rezervata'); END IF;
  UPDATE public.ofertare_cant_felii SET rezervare_id = v_id WHERE id = p_felie_id;
  RETURN jsonb_build_object('ok', true, 'rezervare_id', v_id);
END $f$;

-- decontare (o singură dată): costul real se înregistrează întotdeauna; peste rezervare → bugetul se blochează
CREATE FUNCTION public.fn_ofertare_cb_deconteaza(p_rezervare_id bigint, p_cost numeric, p_tokeni_in integer, p_tokeni_out integer, p_model text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_peste boolean;
BEGIN
  IF p_cost IS NULL OR p_cost < 0 OR p_cost > 100 OR p_model IS NULL OR length(p_model) > 100 THEN RAISE EXCEPTION 'Parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.ofertare_ai_rezervari WHERE id = p_rezervare_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rezervare inexistentă' USING ERRCODE = '22023'; END IF;
  IF r.stare <> 'deschisa' THEN RETURN jsonb_build_object('refuz', 'deja_inchisa', 'stare', r.stare); END IF;
  PERFORM 1 FROM public.ofertare_ai_buget WHERE licitatie_id = r.licitatie_id AND scop = r.scop FOR UPDATE;
  v_peste := round(p_cost, 4) > r.suma_rezervata;
  UPDATE public.ofertare_ai_rezervari SET stare = 'decontata', cost_real = round(p_cost, 4), tokeni_in = p_tokeni_in, tokeni_out = p_tokeni_out,
         model = p_model, inchisa_la = now() WHERE id = p_rezervare_id;
  IF v_peste THEN
    UPDATE public.ofertare_ai_buget SET blocat = true, blocat_motiv = format('cost real %s peste rezervarea %s (rezervare %s)', round(p_cost, 4), r.suma_rezervata, r.id)
     WHERE licitatie_id = r.licitatie_id AND scop = r.scop AND NOT blocat;
  END IF;
  -- jurnalul de consum e best-effort: o eroare aici NU anulează decontarea / blocarea (ca la OCR; review r1)
  BEGIN
    INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
    VALUES ('ofertare-cant-' || r.scop, p_model, coalesce(p_tokeni_in, 0), coalesce(p_tokeni_out, 0), round(p_cost, 4), 'ofertare_licitatii', r.licitatie_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'peste_rezervare', v_peste);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_rezervare_necunoscuta(p_rezervare_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  UPDATE public.ofertare_ai_rezervari SET stare = 'necunoscuta', inchisa_la = now() WHERE id = p_rezervare_id AND stare = 'deschisa';
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'nu_e_deschisa'); END IF;
  RETURN jsonb_build_object('ok', true);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_rezervare_abandon(p_rezervare_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  UPDATE public.ofertare_ai_rezervari SET stare = 'abandonata', inchisa_la = coalesce(inchisa_la, now())
   WHERE id = p_rezervare_id AND ((stare = 'deschisa' AND creat_la < now() - interval '15 minutes') OR stare = 'necunoscuta');
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'nu_se_poate_abandona'); END IF;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- ── texte + proveniență (service_role: scrise de PRODUCĂTOR, pe exact sha-ul) ──
CREATE FUNCTION public.fn_ofertare_cb_text_scrie(p_document_id bigint, p_text text, p_origine text, p_producator text,
                                                 p_completitudine text, p_pagini_necitite integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_sha text; v_prov bigint;
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR p_text IS NULL THEN RAISE EXCEPTION 'Document inexistent sau text gol' USING ERRCODE = '22023'; END IF;
  v_sha := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (v_lic, v_sha, p_text) ON CONFLICT DO NOTHING;
  INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine, pagini_necitite)
  VALUES (v_lic, p_document_id, v_sha, p_origine, p_producator, p_completitudine, coalesce(p_pagini_necitite, '{}')) RETURNING id INTO v_prov;
  RETURN jsonb_build_object('ok', true, 'sha256', v_sha, 'prov_id', v_prov);
END $f$;

-- citirea textului (authenticated, acces Ofertare) — singura cale de citire a ofertare_doc_texte
CREATE FUNCTION public.fn_ofertare_cb_text(p_licitatie_id bigint, p_sha256 text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT t.text FROM public.ofertare_doc_texte t WHERE t.licitatie_id = p_licitatie_id AND t.sha256 = p_sha256
          AND (SELECT public.fn_are_acces_ofertare()) $f$;

-- predicatul unic (spec §4.1): text valid pentru ACEST document și ACEST sha → id-ul dovezii (prov / decizie) sau NULL
CREATE FUNCTION public.fn_ofertare_cb_text_valid(p_licitatie_id bigint, p_document_id bigint, p_sha256 text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT public.fn_ofertare_cb_text_valid_asof(p_licitatie_id, p_document_id, p_sha256, 'infinity'::timestamptz) $f$;

-- ── extragere + felii (service_role) ──
CREATE FUNCTION public.fn_ofertare_cb_extragere_incepe(p_cerere_id bigint, p_document_id bigint, p_sha256 text,
                                                       p_familie_id text, p_extractor_id text, p_felii_total integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c record; d record; v_id bigint; v_cache bigint; v_dov jsonb; v_txt text;
BEGIN
  SELECT * INTO c FROM public.ofertare_ai_cereri WHERE id = p_cerere_id;
  IF NOT FOUND OR c.stare <> 'activa' OR c.valabil_pana <= now() OR c.scop <> 'cant_extragere' THEN RETURN jsonb_build_object('refuz', 'cerere'); END IF;
  SELECT id, licitatie_id INTO d FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR d.licitatie_id <> c.licitatie_id THEN RETURN jsonb_build_object('refuz', 'document'); END IF;
  IF NOT public.fn_ofertare_cb_doc_in_lot(p_document_id, c.lot_domeniu, c.lot_nr) THEN RETURN jsonb_build_object('refuz', 'lot'); END IF;
  -- dovada = EXACT predicatul unic (proveniență de transcriere SAU text_confirmat), persistată pe extragere (review r1)
  v_dov := public.fn_ofertare_cb_text_valid(c.licitatie_id, p_document_id, p_sha256);
  IF v_dov = '{}'::jsonb THEN RETURN jsonb_build_object('refuz', 'text_nevalid'); END IF;
  -- text confirmat de om pe un document vechi (fără text_scrie): se materializează din textul curent, DOAR dacă sha-ul coincide (review r2)
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_doc_texte WHERE licitatie_id = c.licitatie_id AND sha256 = p_sha256) THEN
    SELECT text_extras INTO v_txt FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
    IF v_txt IS NOT NULL AND encode(sha256(convert_to(v_txt, 'UTF8')), 'hex') = p_sha256 THEN
      INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (c.licitatie_id, p_sha256, v_txt) ON CONFLICT DO NOTHING;
    ELSE
      RETURN jsonb_build_object('refuz', 'text_nematerializat');
    END IF;
  END IF;
  SELECT id INTO v_cache FROM public.ofertare_cant_extrageri WHERE document_id = p_document_id AND doc_sha256 = p_sha256
     AND extractor_id = p_extractor_id AND stare = 'gata';
  IF v_cache IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'cache', true, 'extragere_id', v_cache); END IF;
  -- o extragere partial / esuat pe aceeași muncă se REDESCHIDE (fn_ofertare_cb_extragere_redeschide), nu se dublează
  IF EXISTS (SELECT 1 FROM public.ofertare_cant_extrageri WHERE document_id = p_document_id AND doc_sha256 = p_sha256
               AND extractor_id = p_extractor_id AND stare IN ('partial', 'esuat')) THEN
    RETURN jsonb_build_object('refuz', 'de_redeschis');
  END IF;
  INSERT INTO public.ofertare_cant_extrageri (licitatie_id, document_id, doc_sha256, prov_id, dovada_decizie_id, familie_id, extractor_id,
                                              felii_total, cerere_id, pornit_de)
  VALUES (c.licitatie_id, p_document_id, p_sha256, CASE WHEN v_dov->>'tip' = 'prov' THEN (v_dov->>'id')::bigint END,
          CASE WHEN v_dov->>'tip' = 'decizie' THEN (v_dov->>'id')::bigint END, p_familie_id, p_extractor_id, p_felii_total, p_cerere_id, c.aprobat_de)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('refuz', 'extragere_in_lucru'); END IF;
  RETURN jsonb_build_object('ok', true, 'cache', false, 'extragere_id', v_id, 'dovada', v_dov);
END $f$;

-- felia: identitatea muncii = document:sha:extractor:de_la:sha_felie (o a doua inserare pe aceeași muncă e refuzată ÎNAINTEA apelului)
CREATE FUNCTION public.fn_ofertare_cb_felie_incepe(p_extragere_id bigint, p_felie_nr integer, p_de_la integer, p_pana_la integer, p_sha_felie text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE x record; v_munca text; v_id bigint;
BEGIN
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = p_extragere_id;
  IF NOT FOUND OR x.stare <> 'in_lucru' THEN RETURN jsonb_build_object('refuz', 'extragere'); END IF;
  IF p_felie_nr IS NULL OR p_felie_nr >= x.felii_total THEN RETURN jsonb_build_object('refuz', 'felie_nr'); END IF;
  v_munca := x.document_id || ':' || x.doc_sha256 || ':' || x.extractor_id || ':' || p_de_la || ':' || p_sha_felie;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie)
  VALUES (v_munca, 1, p_extragere_id, p_felie_nr, p_de_la, p_pana_la, p_sha_felie) ON CONFLICT (munca_id, incercare) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('refuz', 'munca_existenta', 'munca_id', v_munca); END IF;
  RETURN jsonb_build_object('ok', true, 'felie_id', v_id, 'munca_id', v_munca, 'incercare', 1);
END $f$;

-- reluarea unei felii esuat / necunoscut: DOAR om (owner / responsabil), cu motiv → incercare + 1
CREATE FUNCTION public.fn_ofertare_cb_felie_reia(p_felie_id bigint, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; v_id bigint; v_max integer;
BEGIN
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Felie inexistentă' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id FOR SHARE;
  IF NOT public.fn_ofertare_cb_poate(x.licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'Motiv obligatoriu' USING ERRCODE = '22023'; END IF;
  IF x.stare <> 'in_lucru' THEN RAISE EXCEPTION 'Extragerea nu e în lucru (se redeschide întâi)' USING ERRCODE = '55000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_felie:' || f.munca_id));
  SELECT max(incercare) INTO v_max FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id;
  IF EXISTS (SELECT 1 FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id AND incercare = v_max AND stare NOT IN ('esuat', 'necunoscut')) THEN
    RAISE EXCEPTION 'Ultima încercare nu e eșuată / necunoscută' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, motiv_reluare)
  VALUES (f.munca_id, v_max + 1, f.extragere_id, f.felie_nr, f.de_la, f.pana_la, f.sha_felie, btrim(p_motiv)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'felie_id', v_id, 'incercare', v_max + 1);
END $f$;

-- închiderea feliei (review r2, Copilot): „gata” DOAR cu rezervarea aceleiași munci + încercări DECONTATĂ; „necunoscut” DOAR cu o
-- rezervare (apelul a plecat) — rezervarea deschisă devine „necunoscuta” (rămâne în consum); fără apel = „esuat”.
CREATE FUNCTION public.fn_ofertare_cb_felie_inchide(p_felie_id bigint, p_stare text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; r record;
BEGIN
  IF p_stare IS NULL OR p_stare NOT IN ('gata', 'esuat', 'necunoscut') THEN RAISE EXCEPTION 'Stare invalidă' USING ERRCODE = '22023'; END IF;
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id FOR UPDATE;
  IF NOT FOUND OR f.stare <> 'in_zbor' THEN RETURN jsonb_build_object('refuz', 'nu_e_in_zbor'); END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id FOR SHARE;
  IF f.rezervare_id IS NOT NULL THEN
    SELECT * INTO r FROM public.ofertare_ai_rezervari WHERE id = f.rezervare_id FOR UPDATE;
    IF r.munca_id <> f.munca_id OR r.incercare <> f.incercare THEN RETURN jsonb_build_object('refuz', 'rezervare_straina'); END IF;
  END IF;
  IF p_stare = 'gata' THEN
    IF x.stare <> 'in_lucru' THEN RETURN jsonb_build_object('refuz', 'extragere'); END IF;
    IF f.rezervare_id IS NULL THEN RETURN jsonb_build_object('refuz', 'rezervare_nedecontata'); END IF;
    IF r.stare <> 'decontata' THEN RETURN jsonb_build_object('refuz', 'rezervare_nedecontata'); END IF;
  ELSIF p_stare = 'necunoscut' THEN
    IF f.rezervare_id IS NULL THEN RETURN jsonb_build_object('refuz', 'fara_rezervare'); END IF;
    IF r.stare = 'deschisa' THEN
      UPDATE public.ofertare_ai_rezervari SET stare = 'necunoscuta', inchisa_la = now() WHERE id = r.id;
    END IF;
  END IF;
  UPDATE public.ofertare_cant_felii SET stare = p_stare, inchisa_la = now() WHERE id = p_felie_id;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- observațiile unei felii (service_role), validate; imuabile după scriere
CREATE FUNCTION public.fn_ofertare_cb_obs_scrie(p_felie_id bigint, p_obs jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; o jsonb; v_n integer := 0;
BEGIN
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id FOR SHARE;
  IF NOT FOUND OR f.stare <> 'in_zbor' THEN RAISE EXCEPTION 'Felia nu e în zbor' USING ERRCODE = '55000'; END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id FOR SHARE;
  IF x.stare <> 'in_lucru' THEN RAISE EXCEPTION 'Extragerea nu e în lucru' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p_obs) <> 'array' OR jsonb_array_length(p_obs) > 2000 THEN RAISE EXCEPTION 'Observații invalide' USING ERRCODE = '22023'; END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(p_obs) LOOP
    INSERT INTO public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256, familie_id, extragere_id, felie_nr, lot_domeniu, lot_nr,
      rol_sursa, rol_decis_de, pagina, cod_articol, denumire, rand_interval, citat_interval, cantitate_offset, pozitie_dovedita, valoare_ambigua,
      tip_lucrare, masura, obiect_brut, obiect_cheie, material, dn_mm, dn_model, dn_ambiguu, sdr, um_norm, cantitate, e_total, e_subtotal,
      citat, extractor_id, hash_rand)
    VALUES (x.licitatie_id, x.document_id, x.doc_sha256, x.familie_id, x.id, f.felie_nr, o->>'lot_domeniu',
      coalesce(ARRAY(SELECT jsonb_array_elements_text(o->'lot_nr')::int), '{}'), o->>'rol_sursa', o->>'rol_decis_de', (o->>'pagina')::int,
      o->>'cod_articol', o->>'denumire', (o->>'rand_interval')::int4range, (o->>'citat_interval')::int4range, (o->>'cantitate_offset')::int,
      (o->>'pozitie_dovedita')::boolean, coalesce((o->>'valoare_ambigua')::boolean, false), o->>'tip_lucrare', o->>'masura', o->>'obiect_brut',
      o->>'obiect_cheie', o->>'material', coalesce(ARRAY(SELECT jsonb_array_elements_text(o->'dn_mm')::numeric), '{}'), (o->>'dn_model')::numeric,
      coalesce((o->>'dn_ambiguu')::boolean, false), (o->>'sdr')::numeric, o->>'um_norm', (o->>'cantitate')::numeric,
      coalesce((o->>'e_total')::boolean, false), coalesce((o->>'e_subtotal')::boolean, false), o->>'citat', x.extractor_id, o->>'hash_rand')
    ON CONFLICT (extragere_id, felie_nr, hash_rand) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'n', v_n);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_extragere_inchide(p_extragere_id bigint, p_stare text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE x record; v_gata integer; v_rel integer;
BEGIN
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = p_extragere_id FOR UPDATE;
  IF NOT FOUND OR x.stare <> 'in_lucru' OR p_stare NOT IN ('gata', 'partial', 'esuat') THEN RETURN jsonb_build_object('refuz', 'stare'); END IF;
  SELECT count(DISTINCT felie_nr) INTO v_gata FROM public.ofertare_cant_felii WHERE extragere_id = p_extragere_id AND stare = 'gata';
  -- „gata” doar cu TOATE feliile gata (altfel partial / esuat, ales de server)
  IF p_stare = 'gata' AND v_gata <> x.felii_total THEN RETURN jsonb_build_object('refuz', 'felii_negata', 'gata', v_gata, 'total', x.felii_total); END IF;
  SELECT count(*) INTO v_rel FROM public.ofertare_cant_obs WHERE extragere_id = p_extragere_id AND um_norm = 'm';
  UPDATE public.ofertare_cant_extrageri SET stare = p_stare, obs_relevante = CASE WHEN p_stare = 'gata' THEN v_rel END, terminat_la = now()
   WHERE id = p_extragere_id;
  RETURN jsonb_build_object('ok', true, 'obs_relevante', v_rel);
END $f$;

-- ── decizii umane (authenticated, poartă de rol), o singură activă per cheie, serializat ──
CREATE FUNCTION public.fn_ofertare_cb_decizie(p_document_id bigint, p_doc_sha256 text, p_rol text, p_sectiune text, p_decizie text, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_prec bigint; v_id bigint; v_clasa text; v_rol text := p_rol; v_sect text := p_sectiune; v_clase text[];
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Document inexistent sau fără drept' USING ERRCODE = '42501'; END IF;
  v_clasa := CASE p_decizie WHEN 'text_confirmat' THEN 'provenienta' WHEN 'nu_e_sursa_cantitativa' THEN 'rol' WHEN 'rol_confirmat' THEN 'rol'
                            WHEN 'verificat_fara_lungimi' THEN 'acoperire' WHEN 'sursa_partiala_acceptata' THEN 'sursa' END;
  IF v_clasa IS NULL OR p_doc_sha256 IS NULL OR p_doc_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Decizie invalidă' USING ERRCODE = '22023'; END IF;
  IF v_clasa = 'provenienta' THEN v_rol := NULL; v_sect := NULL;
  ELSIF v_rol IS NULL OR v_sect IS NULL THEN RAISE EXCEPTION 'Rolul și secțiunea sunt obligatorii' USING ERRCODE = '22023'; END IF;
  v_clase := CASE v_clasa WHEN 'rol' THEN ARRAY['nu_e_sursa_cantitativa', 'rol_confirmat'] ELSE ARRAY[p_decizie] END;
  IF p_decizie = 'verificat_fara_lungimi' AND v_sect = '*' AND EXISTS (
       SELECT 1 FROM public.ofertare_cant_obs WHERE document_id = p_document_id AND doc_sha256 = p_doc_sha256 AND rol_sursa = v_rol AND um_norm = 'm') THEN
    RAISE EXCEPTION 'Documentul are observații cu lungimi pe acest rol: decizia se ia pe secțiune' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_decizie:' || p_document_id || ':' || p_doc_sha256 || ':' || coalesce(v_rol, '-') || ':'
                                         || coalesce(v_sect, '-') || ':' || v_clasa));
  SELECT d.id INTO v_prec FROM public.ofertare_cant_doc_decizii d
   WHERE d.document_id = p_document_id AND d.doc_sha256 = p_doc_sha256 AND d.rol IS NOT DISTINCT FROM v_rol
     AND d.sectiune IS NOT DISTINCT FROM v_sect AND d.decizie = ANY (v_clase)
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = d.id) ORDER BY d.id DESC LIMIT 1;
  IF v_prec IS NOT NULL THEN
    INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, revoca_id, motiv, decis_de)
    VALUES (v_lic, p_document_id, p_doc_sha256, 'revocare', v_prec, 'înlocuită de o decizie nouă', auth.uid());
  END IF;
  INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, rol, sectiune, decizie, motiv, decis_de)
  VALUES (v_lic, p_document_id, p_doc_sha256, v_rol, v_sect, p_decizie, btrim(p_motiv), auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'decizie_id', v_id, 'inlocuieste', v_prec);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_alias(p_licitatie_id bigint, p_cheie_1 text, p_cheie_2 text, p_revoca boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_a text := least(p_cheie_1, p_cheie_2); v_b text := greatest(p_cheie_1, p_cheie_2); v_activ bigint; v_id bigint;
BEGIN
  IF NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF v_a IS NULL OR v_a = v_b THEN RAISE EXCEPTION 'Chei invalide' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_alias:' || p_licitatie_id || ':' || v_a || ':' || v_b));
  SELECT a.id INTO v_activ FROM public.ofertare_cant_alias a
   WHERE a.licitatie_id = p_licitatie_id AND a.cheie_a = v_a AND a.cheie_b = v_b AND a.revoca_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_alias r WHERE r.revoca_id = a.id);
  IF p_revoca THEN
    IF v_activ IS NULL THEN RAISE EXCEPTION 'Nu există alias activ' USING ERRCODE = '55000'; END IF;
    INSERT INTO public.ofertare_cant_alias (licitatie_id, cheie_a, cheie_b, revoca_id, confirmat_de) VALUES (p_licitatie_id, v_a, v_b, v_activ, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    IF v_activ IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'alias_id', v_activ, 'deja', true); END IF;
    INSERT INTO public.ofertare_cant_alias (licitatie_id, cheie_a, cheie_b, confirmat_de) VALUES (p_licitatie_id, v_a, v_b, auth.uid()) RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'alias_id', v_id);
END $f$;

-- ── calcul (service_role; comparatorul e în PR4) — imuabil; ID-urile verificate pe licitație ──
CREATE FUNCTION public.fn_ofertare_cb_calcul_scrie(p_calcul jsonb, p_cmp jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint := (p_calcul->>'licitatie_id')::bigint; v_id bigint; c jsonb; v_snap bigint := (p_calcul->>'pe_snapshot_id')::bigint;
        v_obs bigint[]; v_nr integer[]; s record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = v_lic) THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  v_nr := public.fn_ofertare_cb_lot_canonic(coalesce(ARRAY(SELECT jsonb_array_elements_text(p_calcul->'lot_nr')::int), '{}'));
  IF NOT public.fn_ofertare_cb_lot_ok(p_calcul->>'lot_domeniu', v_nr) THEN RAISE EXCEPTION 'Lot invalid' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_calcul->'doc_manifest') IS DISTINCT FROM 'array' OR jsonb_typeof(p_calcul->'obs_manifest') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Manifest invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_calcul->'doc_manifest') e
              WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = (e->>'document_id')::bigint AND d.licitatie_id = v_lic)) THEN
    RAISE EXCEPTION 'Document străin licitației în manifest' USING ERRCODE = '22023';
  END IF;
  -- simularea (review r2): pe ACELAȘI lot și pe EXACT documentele + sha-urile snapshot-ului (nu documente apărute după)
  IF p_calcul->>'tip' = 'simulare' THEN
    SELECT * INTO s FROM public.ofertare_analiza_versiuni WHERE id = v_snap AND licitatie_id = v_lic;
    IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot străin licitației' USING ERRCODE = '22023'; END IF;
    IF s.lot_domeniu <> p_calcul->>'lot_domeniu' OR s.lot_nr <> v_nr THEN RAISE EXCEPTION 'Simulare pe alt lot decât snapshot-ul' USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_ofertare_cb_manifest_egal(p_calcul->'doc_manifest', s.doc_manifest) THEN
      RAISE EXCEPTION 'Simularea nu are exact manifestul snapshot-ului' USING ERRCODE = '22023';
    END IF;
  ELSIF v_snap IS NOT NULL THEN
    RAISE EXCEPTION 'Doar simularea are snapshot' USING ERRCODE = '22023';
  END IF;
  v_obs := ARRAY(SELECT (e->>'id')::bigint FROM jsonb_array_elements(p_calcul->'obs_manifest') e);
  -- fiecare observație: a licitației ȘI a unei perechi (document, sha) din manifestul calculului
  IF EXISTS (SELECT 1 FROM unnest(v_obs) o WHERE NOT EXISTS (
       SELECT 1 FROM public.ofertare_cant_obs x WHERE x.id = o AND x.licitatie_id = v_lic
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_calcul->'doc_manifest') e
                       WHERE (e->>'document_id')::bigint = x.document_id AND e->>'sha256' = x.doc_sha256))) THEN
    RAISE EXCEPTION 'Observație străină licitației sau manifestului de documente' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_calcul->'alias_manifest') e
              WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cant_alias a WHERE a.id = (e->>'id')::bigint AND a.licitatie_id = v_lic))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_calcul->'decizii_manifest') e
              WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii x WHERE x.id = (e->>'id')::bigint AND x.licitatie_id = v_lic)) THEN
    RAISE EXCEPTION 'Alias / decizie străină licitației în manifest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ofertare_cant_calcul (licitatie_id, lot_domeniu, lot_nr, tip, pe_snapshot_id, algoritm_versiune, praguri, extractor_id,
    doc_manifest, obs_manifest, alias_manifest, decizii_manifest, acoperire, stare, amprenta)
  VALUES (v_lic, p_calcul->>'lot_domeniu', v_nr, p_calcul->>'tip', v_snap,
    p_calcul->>'algoritm_versiune', p_calcul->'praguri', p_calcul->>'extractor_id', p_calcul->'doc_manifest', p_calcul->'obs_manifest',
    p_calcul->'alias_manifest', p_calcul->'decizii_manifest', p_calcul->'acoperire', p_calcul->>'stare', p_calcul->>'amprenta') RETURNING id INTO v_id;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_cmp, '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(c->'obs_a', '[]') || coalesce(c->'obs_b', '[]')) x WHERE NOT (x::bigint = ANY (v_obs))) THEN
      RAISE EXCEPTION 'Comparație cu observație din afara manifestului' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ofertare_cant_cmp (calcul_id, cheie, rol_a, rol_b, val_a, val_b, obs_a, obs_b, delta_abs, delta_rel, verdict, motiv_incomplet, importanta)
    VALUES (v_id, c->>'cheie', c->>'rol_a', c->>'rol_b', (c->>'val_a')::numeric, (c->>'val_b')::numeric,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(c->'obs_a')::bigint), '{}'), coalesce(ARRAY(SELECT jsonb_array_elements_text(c->'obs_b')::bigint), '{}'),
      (c->>'delta_abs')::numeric, (c->>'delta_rel')::numeric, c->>'verdict', c->>'motiv_incomplet', coalesce((c->>'importanta')::numeric, 0));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'calcul_id', v_id);
END $f$;

-- ── înghețarea (D1), faza 1: manifest + clarificări as-of din jurnal; idempotentă, serializată ──
-- Momentul e CANONIC, același pe toate căile (trigger, restanțe, termen, manual — review r2): moment = min(prima trimitere din
-- jurnal, termenul de clarificări / depunere, acum). Tardiv = moment < acum: atunci NU se folosește textul curent (doar proveniența
-- ≤ moment, altfel text_indisponibil), iar eligibilitatea (fără istoric) e marcată „modificata_dupa_moment” dacă loturile s-au
-- schimbat după moment. Documentele: ale licitației, create ≤ moment, neînlocuite ≤ moment, în lot. Fără așteptări pe rânduri.
CREATE FUNCTION public.fn_ofertare_cb_ingheata(p_licitatie_id bigint, p_lot_domeniu text, p_lot_nr integer[], p_declansator text,
                                              p_clarificare_id bigint, p_de uuid, p_fara_asteptare boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE l record; v_moment timestamptz; v_tardiv boolean; v_aprox boolean; v_termen timestamptz; v_nr integer[]; v_elig text;
        v_prima timestamptz; v_clar_prima bigint; v_decl text; v_clar_id bigint;
        v_docs jsonb; v_clar jsonb; v_amp text; v_id bigint; v_existent bigint; v_cheie bigint;
BEGIN
  v_nr := public.fn_ofertare_cb_lot_canonic(p_lot_nr);
  IF NOT public.fn_ofertare_cb_lot_ok(p_lot_domeniu, v_nr) OR p_declansator NOT IN ('clarificare_trimisa', 'termen_clarificari', 'manual') THEN
    RAISE EXCEPTION 'Parametri invalizi' USING ERRCODE = '22023';
  END IF;
  v_cheie := hashtext('ofertare_cb_ingheata:' || p_licitatie_id || ':' || p_lot_domeniu || ':' || v_nr::text);
  IF coalesce(p_fara_asteptare, false) THEN
    IF NOT pg_try_advisory_xact_lock(v_cheie) THEN RETURN jsonb_build_object('ok', false, 'amanat', true); END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(v_cheie);
  END IF;
  SELECT id INTO v_existent FROM public.ofertare_analiza_versiuni
   WHERE licitatie_id = p_licitatie_id AND lot_domeniu = p_lot_domeniu AND lot_nr = v_nr AND tip = 'initiala';
  IF v_existent IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'snapshot_id', v_existent, 'existent', true); END IF;
  SELECT x.id, t.termen AS termen_clarificari, x.termen_depunere INTO l
    FROM public.ofertare_licitatii x LEFT JOIN public.ofertare_termen_clarificari t ON t.licitatie_id = x.id WHERE x.id = p_licitatie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  v_termen := coalesce(l.termen_clarificari, l.termen_depunere);
  v_aprox := l.termen_clarificari IS NULL AND l.termen_depunere IS NOT NULL;
  SELECT j.la, j.clarificare_id INTO v_prima, v_clar_prima FROM public.ofertare_clarificari_jurnal j
   WHERE j.licitatie_id = p_licitatie_id AND j.eveniment = 'trimisa' ORDER BY j.la, j.id LIMIT 1;
  v_moment := least(now(), coalesce(v_prima, 'infinity'::timestamptz), coalesce(v_termen, 'infinity'::timestamptz));
  v_tardiv := v_moment < now();
  -- declanșatorul ține de moment, nu de cine a apelat
  IF v_prima IS NOT NULL AND v_moment = v_prima THEN v_decl := 'clarificare_trimisa'; v_clar_id := v_clar_prima;
  ELSIF v_termen IS NOT NULL AND v_moment = v_termen THEN v_decl := 'termen_clarificari'; v_clar_id := NULL;
  ELSE v_decl := p_declansator; v_clar_id := CASE WHEN p_declansator = 'clarificare_trimisa' THEN p_clarificare_id END;
  END IF;
  v_elig := CASE WHEN v_tardiv AND EXISTS (SELECT 1 FROM public.ofertare_loturi_jurnal j WHERE j.licitatie_id = p_licitatie_id AND j.la > v_moment)
                 THEN 'modificata_dupa_moment' ELSE 'exacta' END;
  WITH docs AS (
    SELECT d.id, d.tip, coalesce(d.seap_meta->>'inlocuieste_id', d.id::text) AS familie,
           (SELECT p.sha256 FROM public.ofertare_doc_texte_prov p WHERE p.document_id = d.id AND p.constatat_la <= v_moment
             ORDER BY p.constatat_la DESC, p.id DESC LIMIT 1) AS sha_prov,
           CASE WHEN d.text_extras IS NULL THEN NULL ELSE encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex') END AS sha_curent
      FROM public.ofertare_documente_atribuire d
     WHERE d.licitatie_id = p_licitatie_id AND d.created_at <= v_moment
       AND NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire n
                        WHERE n.licitatie_id = d.licitatie_id AND n.seap_meta->>'inlocuieste_id' = d.id::text AND n.created_at <= v_moment)
       AND public.fn_ofertare_cb_doc_in_lot(d.id, p_lot_domeniu, v_nr)),
  ales AS (
    SELECT id, tip, familie,
           CASE WHEN sha_prov IS NOT NULL THEN sha_prov WHEN NOT v_tardiv THEN sha_curent END AS sha
      FROM docs)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'document_id', a.id, 'tip', a.tip, 'familie', a.familie, 'sha256', a.sha, 'text_indisponibil', a.sha IS NULL,
           'text_dovada', CASE WHEN a.sha IS NULL THEN '{}'::jsonb ELSE public.fn_ofertare_cb_text_valid_asof(p_licitatie_id, a.id, a.sha, v_moment) END)
           ORDER BY a.id), '[]'::jsonb)
    INTO v_docs FROM ales a;
  -- clarificările as-of, DOAR din jurnal (MVP: la nivel de licitație — clarificările nu au lot)
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'clarificare_id')::bigint), '[]'::jsonb) INTO v_clar FROM (
    SELECT jsonb_build_object('clarificare_id', j.clarificare_id,
             'text', (SELECT t.text FROM public.ofertare_clarificari_jurnal t WHERE t.clarificare_id = j.clarificare_id AND t.eveniment = 'trimisa'
                       AND t.la <= v_moment ORDER BY t.la DESC, t.id DESC LIMIT 1),
             'text_sha256', (SELECT t.text_sha256 FROM public.ofertare_clarificari_jurnal t WHERE t.clarificare_id = j.clarificare_id AND t.eveniment = 'trimisa'
                       AND t.la <= v_moment ORDER BY t.la DESC, t.id DESC LIMIT 1),
             'status', (SELECT t.eveniment FROM public.ofertare_clarificari_jurnal t WHERE t.clarificare_id = j.clarificare_id AND t.la <= v_moment
                         ORDER BY t.la DESC, t.id DESC LIMIT 1),
             'versiune_necunoscuta', NOT EXISTS (SELECT 1 FROM public.ofertare_clarificari_jurnal t WHERE t.clarificare_id = j.clarificare_id
                                                  AND t.eveniment = 'trimisa' AND t.la <= v_moment)) AS x
      FROM (SELECT DISTINCT clarificare_id FROM public.ofertare_clarificari_jurnal WHERE licitatie_id = p_licitatie_id AND la <= v_moment) j) s;
  v_amp := encode(sha256(convert_to(jsonb_build_object('lic', p_licitatie_id, 'lot', p_lot_domeniu, 'nr', v_nr, 'moment', v_moment,
                                                       'elig', v_elig, 'docs', v_docs, 'clar', v_clar)::text, 'UTF8')), 'hex');
  INSERT INTO public.ofertare_analiza_versiuni (licitatie_id, lot_domeniu, lot_nr, tip, declansator, clarificare_declansatoare_id, moment_referinta,
    inghetat_tardiv, termen_aproximat, eligibilitate, inghetata_de, doc_manifest, clarificari, amprenta)
  VALUES (p_licitatie_id, p_lot_domeniu, v_nr, 'initiala', v_decl, v_clar_id, v_moment, v_tardiv, v_aprox, v_elig, p_de, v_docs, v_clar, v_amp)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.ofertare_analiza_versiuni WHERE licitatie_id = p_licitatie_id AND lot_domeniu = p_lot_domeniu AND lot_nr = v_nr AND tip = 'initiala';
    RETURN jsonb_build_object('ok', true, 'snapshot_id', v_id, 'existent', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'snapshot_id', v_id, 'existent', false, 'moment_referinta', v_moment, 'tardiv', v_tardiv,
                            'declansator', v_decl, 'eligibilitate', v_elig);
END $f$;

-- faza 2: texte materializate (doar sha-urile din manifest, din textul curent când sha-ul coincide); calculul NU se leagă aici (PR4)
CREATE FUNCTION public.fn_ofertare_cb_completeaza_intern(p_snapshot_id bigint)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE s record; e jsonb; v_texte jsonb := '[]'::jsonb; v_txt text; v_coer text := 'fara_calcul'; v_id bigint;
BEGIN
  SELECT * INTO s FROM public.ofertare_analiza_versiuni WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot inexistent' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(s.doc_manifest) LOOP
    CONTINUE WHEN e->>'sha256' IS NULL;
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_doc_texte WHERE licitatie_id = s.licitatie_id AND sha256 = e->>'sha256') THEN
      SELECT text_extras INTO v_txt FROM public.ofertare_documente_atribuire WHERE id = (e->>'document_id')::bigint;
      CONTINUE WHEN v_txt IS NULL OR encode(sha256(convert_to(v_txt, 'UTF8')), 'hex') <> e->>'sha256';
      INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (s.licitatie_id, e->>'sha256', v_txt) ON CONFLICT DO NOTHING;
    END IF;
    v_texte := v_texte || jsonb_build_array(jsonb_build_object('document_id', (e->>'document_id')::bigint, 'sha256', e->>'sha256'));
  END LOOP;
  -- „depășit” doar față de un calcul curent al ACELUIAȘI lot (review r2)
  IF EXISTS (SELECT 1 FROM public.ofertare_cant_calcul c WHERE c.licitatie_id = s.licitatie_id AND c.tip = 'curent'
               AND c.lot_domeniu = s.lot_domeniu AND c.lot_nr = s.lot_nr) THEN v_coer := 'calcul_depasit'; END IF;
  INSERT INTO public.ofertare_analiza_completari (snapshot_id, texte, calcul_id, coerenta, motiv)
  VALUES (p_snapshot_id, v_texte, NULL, v_coer, 'PR2: calculul se leagă doar prin validatorul din PR4') RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- reluarea completării (service_role): adaugă un rând nou, nu rescrie
CREATE FUNCTION public.fn_ofertare_cb_completeaza(p_snapshot_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ BEGIN RETURN jsonb_build_object('ok', true, 'completare_id', public.fn_ofertare_cb_completeaza_intern(p_snapshot_id)); END $f$;

-- înghețarea manuală (responsabil)
CREATE FUNCTION public.fn_ofertare_cb_ingheata_manual(p_licitatie_id bigint, p_lot_domeniu text, p_lot_nr integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_ofertare_cb_ingheata(p_licitatie_id, p_lot_domeniu, p_lot_nr, 'manual', NULL, auth.uid(), false);
END $f$;

-- înghețarea la termen (service_role; rutina Ofertare) — pentru toate licitațiile cu termenul trecut și fără inițială
CREATE FUNCTION public.fn_ofertare_cb_ingheata_la_termen()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE l record; v_n integer := 0;
BEGIN
  FOR l IN SELECT x.id FROM public.ofertare_licitatii x LEFT JOIN public.ofertare_termen_clarificari t ON t.licitatie_id = x.id
            WHERE coalesce(t.termen, x.termen_depunere) < now()
              AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id = x.id AND v.tip = 'initiala'
                                AND v.lot_domeniu = 'toate') LOOP
    BEGIN
      PERFORM public.fn_ofertare_cb_ingheata(l.id, 'toate', '{}', 'termen_clarificari', NULL, NULL, false);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.ofertare_analiza_erori (licitatie_id, faza, eroare) VALUES (l.id, 'ingheata', left(SQLERRM, 1000));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inghetate', v_n);
END $f$;

-- vederea efectivă canonică a completărilor (spec §4.6)
CREATE FUNCTION public.fn_ofertare_cb_snapshot_efectiv(p_snapshot_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT public.fn_ofertare_cb_snapshot_efectiv_intern(p_snapshot_id) WHERE (SELECT public.fn_are_acces_ofertare()) $f$;

-- ── jurnalul clarificărilor + înghețarea D1: UN singur trigger, întâi jurnalul, apoi înghețarea; nu blochează clarificarea ──
-- Fără așteptări (review r2, Jakarinos): lock consultativ try, niciun FK spre rânduri ținute FOR UPDATE, lock_timeout scurt ca plasă;
-- orice eșec = rând în ofertare_analiza_erori, iar fn_ofertare_cb_restante reface înghețarea pe ACELAȘI moment canonic.
CREATE FUNCTION public.fn_ofertare_cb_trg_clarificari()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '200ms'
AS $f$
DECLARE v_r jsonb;
BEGIN
  IF NEW.status IN ('trimisa', 'raspunsa', 'retrasa') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    BEGIN
      INSERT INTO public.ofertare_clarificari_jurnal (clarificare_id, licitatie_id, eveniment, text, text_sha256)
      VALUES (NEW.id, NEW.licitatie_id, NEW.status, coalesce(NEW.intrebare, ''), encode(sha256(convert_to(coalesce(NEW.intrebare, ''), 'UTF8')), 'hex'));
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'jurnal', left(SQLERRM, 1000));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      RETURN NULL;
    END;
    IF NEW.status = 'trimisa' AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id = NEW.licitatie_id AND v.tip = 'initiala'
                                                AND v.lot_domeniu = 'toate') THEN
      BEGIN
        v_r := public.fn_ofertare_cb_ingheata(NEW.licitatie_id, 'toate', '{}', 'clarificare_trimisa', NEW.id, auth.uid(), true);
        IF coalesce((v_r->>'amanat')::boolean, false) THEN
          INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'ingheata', 'amânat (lock ocupat)');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'ingheata', left(SQLERRM, 1000));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END IF;
  END IF;
  RETURN NULL;
END $f$;
CREATE TRIGGER trg_ofertare_cb_clarificari_jurnal AFTER INSERT OR UPDATE OF status ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_trg_clarificari();

-- ── auditul: scriere (service_role, dovezi validate pe snapshot / simulare) + decizia omului (authenticated) ──
CREATE FUNCTION public.fn_ofertare_cb_audit_scrie(p_audit jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE s record; cs record; v_snap bigint := (p_audit->>'versiune_analiza_id')::bigint; v_calc bigint; v_sim bigint; v_id bigint; x text;
        v_cauza text := p_audit->>'cauza'; v_inl bigint := (p_audit->>'inlocuieste_id')::bigint; v_doc bigint := (p_audit->>'document_id')::bigint;
        v_n_cmp integer := 0; v_n_cmp_sim integer := 0; v_n_clar integer := 0; v_obs_calc bigint[];
BEGIN
  SELECT * INTO s FROM public.ofertare_analiza_versiuni WHERE id = v_snap;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot inexistent' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire WHERE id = v_doc AND licitatie_id = s.licitatie_id) THEN
    RAISE EXCEPTION 'Document străin licitației' USING ERRCODE = '22023';
  END IF;
  IF v_inl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ofertare_audit_raspunsuri a WHERE a.id = v_inl AND a.versiune_analiza_id = v_snap
                                         AND a.document_id = v_doc AND a.pereche_id = p_audit->>'pereche_id') THEN
    RAISE EXCEPTION 'inlocuieste_id străin (alt snapshot / document / pereche)' USING ERRCODE = '22023';
  END IF;
  -- eligibilitatea snapshot-ului nu e exactă as-of → nicio clasificare automată (review r2)
  IF s.eligibilitate <> 'exacta' AND p_audit->>'clasificare' IS DISTINCT FROM 'nedeterminabil' THEN
    RAISE EXCEPTION 'Snapshot cu eligibilitate modificată după moment: doar „nedeterminabil”' USING ERRCODE = '22023';
  END IF;
  -- document_nou cere dovada structurată a comparatorului (PR6); până atunci e refuzată (review r2, Copilot)
  IF v_cauza = 'document_nou' OR jsonb_array_length(coalesce(p_audit->'dovezi_istoric'->'document_ids', '[]')) > 0 THEN
    RAISE EXCEPTION 'Cauza document_nou nu e permisă înainte de PR6' USING ERRCODE = '22023';
  END IF;
  v_calc := (public.fn_ofertare_cb_snapshot_efectiv_intern(v_snap)->>'calcul_id')::bigint;
  SELECT ARRAY(SELECT (e->>'id')::bigint FROM public.ofertare_cant_calcul c, jsonb_array_elements(c.obs_manifest) e WHERE c.id = v_calc) INTO v_obs_calc;
  FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_istoric'->'cmp_ids', '[]')) LOOP
    IF v_calc IS NULL OR NOT EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND calcul_id = v_calc) THEN
      RAISE EXCEPTION 'Dovadă istorică străină snapshot-ului (cmp %)', x USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND verdict IN ('diferenta', 'conflict_sursa')) THEN v_n_cmp := v_n_cmp + 1; END IF;
  END LOOP;
  -- „întrebat de noi”: doar clarificări care la moment erau trimise / răspunse, cu versiunea trimisă cunoscută (review r2)
  FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_istoric'->'clarificare_ids', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.clarificari) c WHERE (c->>'clarificare_id') = x AND NOT (c->>'versiune_necunoscuta')::boolean
                     AND c->>'status' IN ('trimisa', 'raspunsa')) THEN
      RAISE EXCEPTION 'Clarificare străină snapshot-ului, netrimisă la moment sau fără versiune (%)', x USING ERRCODE = '22023';
    END IF;
    v_n_clar := v_n_clar + 1;
  END LOOP;
  -- observațiile istorice: DOAR din manifestul calculului efectiv al snapshot-ului (review r2, Copilot)
  FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_istoric'->'obs_ids', '[]')) LOOP
    IF v_calc IS NULL OR NOT (x::bigint = ANY (v_obs_calc)) THEN
      RAISE EXCEPTION 'Observație din afara calculului snapshot-ului (%)', x USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_audit ? 'dovezi_simulare' AND p_audit->'dovezi_simulare' <> 'null'::jsonb THEN
    v_sim := (p_audit->'dovezi_simulare'->>'calcul_id')::bigint;
    SELECT * INTO cs FROM public.ofertare_cant_calcul WHERE id = v_sim AND tip = 'simulare' AND pe_snapshot_id = v_snap;
    -- aceeași condiție ca la scriere, re-verificată: același lot + exact manifestul snapshot-ului
    IF NOT FOUND OR cs.lot_domeniu <> s.lot_domeniu OR cs.lot_nr <> s.lot_nr OR NOT public.fn_ofertare_cb_manifest_egal(cs.doc_manifest, s.doc_manifest) THEN
      RAISE EXCEPTION 'Simulare străină snapshot-ului (lot / manifest)' USING ERRCODE = '22023';
    END IF;
    FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_simulare'->'cmp_ids', '[]')) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND calcul_id = v_sim) THEN
        RAISE EXCEPTION 'Dovadă de simulare străină (cmp %)', x USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND verdict IN ('diferenta', 'conflict_sursa')) THEN v_n_cmp_sim := v_n_cmp_sim + 1; END IF;
    END LOOP;
  END IF;
  -- invariantul minim per cauză (spec §5.4)
  IF (v_cauza = 'intrebat_de_noi' AND v_n_clar = 0)
     OR (v_cauza = 'detectat_neintrebat' AND v_n_cmp = 0)
     OR (v_cauza = 'analiza_incompleta' AND v_n_cmp_sim = 0) THEN
    RAISE EXCEPTION 'Cauza % fără dovada minimă cerută', v_cauza USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ofertare_audit_raspunsuri (licitatie_id, lot_domeniu, lot_nr, versiune_analiza_id, document_id, doc_sha256, citire_id, citire_sursa_tip,
    citire_sursa_sha, citire_completa, executie_id, inlocuieste_id, pereche_id, pozitii, multiplicitate, intrebare_text, raspuns_text, text_verificat,
    asociere_dovedita, ancore, efect, clasificare, cauza, regula, dovezi_istoric, dovezi_simulare)
  VALUES (s.licitatie_id, s.lot_domeniu, s.lot_nr, v_snap, v_doc, p_audit->>'doc_sha256', p_audit->>'citire_id',
    p_audit->>'citire_sursa_tip', p_audit->>'citire_sursa_sha', (p_audit->>'citire_completa')::boolean, p_audit->>'executie_id',
    v_inl, p_audit->>'pereche_id', coalesce(p_audit->'pozitii', '[]'), coalesce((p_audit->>'multiplicitate')::int, 1),
    p_audit->>'intrebare_text', p_audit->>'raspuns_text', (p_audit->>'text_verificat')::boolean, (p_audit->>'asociere_dovedita')::boolean,
    coalesce(p_audit->'ancore', '{}'), p_audit->>'efect', p_audit->>'clasificare', v_cauza, p_audit->>'regula',
    coalesce(p_audit->'dovezi_istoric', '{}'), CASE WHEN p_audit->'dovezi_simulare' = 'null'::jsonb THEN NULL ELSE p_audit->'dovezi_simulare' END)
  ON CONFLICT (versiune_analiza_id, executie_id, pereche_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'deja', true); END IF;
  RETURN jsonb_build_object('ok', true, 'audit_id', v_id);
END $f$;

-- varianta internă a vederii efective (fără filtrul de acces; folosită de funcțiile server)
CREATE FUNCTION public.fn_ofertare_cb_snapshot_efectiv_intern(p_snapshot_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  WITH s AS (SELECT * FROM public.ofertare_analiza_versiuni WHERE id = p_snapshot_id),
  man AS (SELECT (e->>'document_id')::bigint AS doc, e->>'sha256' AS sha FROM s, jsonb_array_elements(s.doc_manifest) e WHERE e->>'sha256' IS NOT NULL),
  tx AS (SELECT DISTINCT ON ((t->>'document_id')::bigint, t->>'sha256') (t->>'document_id')::bigint AS doc, t->>'sha256' AS sha, c.id AS completare_id
           FROM public.ofertare_analiza_completari c, jsonb_array_elements(c.texte) t
          WHERE c.snapshot_id = p_snapshot_id ORDER BY (t->>'document_id')::bigint, t->>'sha256', c.id DESC),
  calc AS (SELECT c.id, c.calcul_id FROM public.ofertare_analiza_completari c
            WHERE c.snapshot_id = p_snapshot_id AND c.coerenta = 'calcul_curent' ORDER BY c.id DESC LIMIT 1)
  SELECT jsonb_build_object(
    'snapshot_id', (SELECT id FROM s),
    'complet', NOT EXISTS (SELECT 1 FROM man m WHERE NOT EXISTS (SELECT 1 FROM tx WHERE tx.doc = m.doc AND tx.sha = m.sha))
               AND NOT EXISTS (SELECT 1 FROM s, jsonb_array_elements(s.doc_manifest) e WHERE (e->>'text_indisponibil')::boolean),
    'calcul_id', (SELECT calcul_id FROM calc),
    'completari', coalesce((SELECT jsonb_agg(DISTINCT completare_id) FROM tx), '[]'::jsonb) || coalesce((SELECT jsonb_agg(id) FROM calc), '[]'::jsonb))
  WHERE EXISTS (SELECT 1 FROM s)
$f$;

CREATE FUNCTION public.fn_ofertare_cb_audit_decide(p_audit_id bigint, p_decizie text, p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint;
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_audit_raspunsuri WHERE id = p_audit_id;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Audit inexistent sau fără drept' USING ERRCODE = '42501'; END IF;
  IF p_decizie NOT IN ('confirmat', 'respins') THEN RAISE EXCEPTION 'Decizie invalidă' USING ERRCODE = '22023'; END IF;
  UPDATE public.ofertare_audit_raspunsuri SET decizie_om = p_decizie, decis_de = auth.uid(), decis_la = now(), nota = nullif(btrim(coalesce(p_nota, '')), '')
   WHERE id = p_audit_id;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- propunerea AI din Fișa de date (service_role): clar = o singură dată găsită → completată (propus_ai), dacă omul n-a decis deja;
-- neclar → doar candidații, pentru confirmarea responsabilului. Nu suprascrie confirmat_om / manual.
CREATE FUNCTION public.fn_ofertare_cb_termen_propune(p_licitatie_id bigint, p_clar boolean, p_termen timestamptz, p_candidati jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE l record;
BEGIN
  IF p_clar IS NULL OR (p_clar AND p_termen IS NULL) OR jsonb_typeof(coalesce(p_candidati, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Parametri invalizi' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  SELECT sursa INTO l FROM public.ofertare_termen_clarificari WHERE licitatie_id = p_licitatie_id;
  IF l.sursa IN ('confirmat_om', 'manual') THEN RETURN jsonb_build_object('ok', true, 'ignorat', 'decis_de_om'); END IF;
  INSERT INTO public.ofertare_termen_clarificari (licitatie_id, termen, sursa, candidati, neclar)
  VALUES (p_licitatie_id, CASE WHEN p_clar THEN p_termen END, CASE WHEN p_clar THEN 'propus_ai' END, coalesce(p_candidati, '{}'::jsonb), NOT p_clar)
  ON CONFLICT (licitatie_id) DO UPDATE SET termen = EXCLUDED.termen, sursa = EXCLUDED.sursa, candidati = EXCLUDED.candidati,
         neclar = EXCLUDED.neclar, setat_de = NULL, setat_la = now();
  RETURN jsonb_build_object('ok', true, 'completat', p_clar);
END $f$;

-- confirmarea / setarea de către responsabil: confirmat_om (din candidați) sau manual
CREATE FUNCTION public.fn_ofertare_cb_termen_seteaza(p_licitatie_id bigint, p_termen timestamptz, p_sursa text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF p_sursa NOT IN ('confirmat_om', 'manual') OR p_termen IS NULL THEN RAISE EXCEPTION 'Parametri invalizi' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  INSERT INTO public.ofertare_termen_clarificari (licitatie_id, termen, sursa, neclar, setat_de)
  VALUES (p_licitatie_id, p_termen, p_sursa, false, auth.uid())
  ON CONFLICT (licitatie_id) DO UPDATE SET termen = EXCLUDED.termen, sursa = EXCLUDED.sursa, neclar = false, setat_de = EXCLUDED.setat_de, setat_la = now();
  RETURN jsonb_build_object('ok', true);
END $f$;

-- documentul aparține scope-ului de lot: eligibil (poarta 20261024b) ȘI (toate | comun | alocat pe un lot din listă).
-- „necunoscut” = doar documentele comune (fail-closed). O licitație fără loturi admite doar scope-ul „toate”.
CREATE FUNCTION public.fn_ofertare_cb_doc_in_lot(p_document_id bigint, p_dom text, p_nr integer[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT coalesce((public.fn_ofertare_document_eligibil(p_document_id)->>'eligibil')::boolean, false)
     AND public.fn_ofertare_cb_lot_ok(p_dom, p_nr)
     AND (p_dom = 'toate'
          OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = p_document_id AND d.lot_stare = 'comun')
          OR (p_dom = 'lista' AND EXISTS (SELECT 1 FROM public.ofertare_document_loturi dl WHERE dl.document_id = p_document_id AND dl.lot_nr = ANY (p_nr))))
$f$;

-- consumul vizibil în UI: DOAR cu acces Ofertare (fn_ofertare_cb_consum e internă, fără EXECUTE pentru nimeni)
CREATE FUNCTION public.fn_ofertare_cb_consum_vezi(p_licitatie_id bigint, p_scop text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT public.fn_ofertare_cb_consum(p_licitatie_id, p_scop) WHERE (SELECT public.fn_are_acces_ofertare()) $f$;

CREATE FUNCTION public.fn_ofertare_cb_text_valid_asof(p_licitatie_id bigint, p_document_id bigint, p_sha256 text, p_moment timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  WITH p AS (SELECT id, origine, completitudine FROM public.ofertare_doc_texte_prov
              WHERE licitatie_id = p_licitatie_id AND document_id = p_document_id AND sha256 = p_sha256 AND constatat_la <= p_moment
              ORDER BY constatat_la DESC, id DESC LIMIT 1),
       d AS (SELECT x.id FROM public.ofertare_cant_doc_decizii x
              WHERE x.licitatie_id = p_licitatie_id AND x.document_id = p_document_id AND x.doc_sha256 = p_sha256 AND x.decizie = 'text_confirmat'
                AND x.decis_la <= p_moment
                AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = x.id AND r.decis_la <= p_moment)
              ORDER BY x.id DESC LIMIT 1)
  SELECT CASE
    WHEN (SELECT origine FROM p) = 'transcriere' THEN (SELECT jsonb_build_object('tip', 'prov', 'id', id, 'completitudine', completitudine) FROM p)
    WHEN EXISTS (SELECT 1 FROM d) THEN (SELECT jsonb_build_object('tip', 'decizie', 'id', id) FROM d)
    ELSE '{}'::jsonb END
$f$;

-- restanțele (service_role, rutina Ofertare): (a) înghețările amânate / eșuate din trigger (momentul e recalculat canonic);
-- (b) completările RECUPERABILE: un sha din manifest încă nematerializat, cel mult 24 de încercări pe snapshot
-- (text_indisponibil e terminal — nu se reîncearcă la nesfârșit; review r2, Copilot).
CREATE FUNCTION public.fn_ofertare_cb_restante()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_i integer := 0; v_c integer := 0;
BEGIN
  FOR r IN SELECT j.licitatie_id, (array_agg(j.clarificare_id ORDER BY j.la, j.id))[1] AS clar
             FROM public.ofertare_clarificari_jurnal j WHERE j.eveniment = 'trimisa'
              AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id = j.licitatie_id AND v.tip = 'initiala'
                                AND v.lot_domeniu = 'toate')
            GROUP BY j.licitatie_id LOOP
    BEGIN
      PERFORM public.fn_ofertare_cb_ingheata(r.licitatie_id, 'toate', '{}', 'clarificare_trimisa', r.clar, NULL, false);
      v_i := v_i + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (r.licitatie_id, r.clar, 'ingheata', left(SQLERRM, 1000));
    END;
  END LOOP;
  FOR r IN SELECT v.id FROM public.ofertare_analiza_versiuni v
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.doc_manifest) m
                           WHERE m->>'sha256' IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_completari c, jsonb_array_elements(c.texte) t
                                              WHERE c.snapshot_id = v.id AND (t->>'document_id') = (m->>'document_id') AND t->>'sha256' = m->>'sha256'))
              AND (SELECT count(*) FROM public.ofertare_analiza_completari c WHERE c.snapshot_id = v.id) < 24
              AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_completari c WHERE c.snapshot_id = v.id AND c.creat_la > now() - interval '1 hour') LOOP
    BEGIN
      PERFORM public.fn_ofertare_cb_completeaza_intern(r.id);
      v_c := v_c + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.ofertare_analiza_erori (faza, eroare) VALUES ('completare', left(r.id || ': ' || SQLERRM, 1000));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'inghetate', v_i, 'completate', v_c);
END $f$;

-- calea de reluare (review r2, Jakarinos): extragerea partial / esuat se redeschide de un OM, cu motiv și o cerere ACTIVĂ (cheltuiala
-- nouă se aprobă din nou); feliile eșuate / necunoscute se reiau apoi cu fn_ofertare_cb_felie_reia, cele gata rămân.
CREATE FUNCTION public.fn_ofertare_cb_extragere_redeschide(p_extragere_id bigint, p_cerere_id bigint, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE x record; c record;
BEGIN
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = p_extragere_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(x.licitatie_id) THEN RAISE EXCEPTION 'Extragere inexistentă sau fără drept' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 3 OR length(p_motiv) > 300 THEN RAISE EXCEPTION 'Motiv obligatoriu' USING ERRCODE = '22023'; END IF;
  IF x.stare NOT IN ('partial', 'esuat') THEN RAISE EXCEPTION 'Doar o extragere partial / esuat se redeschide' USING ERRCODE = '55000'; END IF;
  SELECT * INTO c FROM public.ofertare_ai_cereri WHERE id = p_cerere_id;
  IF NOT FOUND OR c.licitatie_id <> x.licitatie_id OR c.scop <> 'cant_extragere' OR c.stare <> 'activa' OR c.valabil_pana <= now() THEN
    RAISE EXCEPTION 'Cerere invalidă (altă licitație, alt scop sau neactivă)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fn_ofertare_cb_doc_in_lot(x.document_id, c.lot_domeniu, c.lot_nr) THEN RAISE EXCEPTION 'Documentul nu e în lotul cererii' USING ERRCODE = '22023'; END IF;
  IF public.fn_ofertare_cb_text_valid(x.licitatie_id, x.document_id, x.doc_sha256) = '{}'::jsonb THEN
    RAISE EXCEPTION 'Textul nu mai are dovadă validă' USING ERRCODE = '55000';
  END IF;
  UPDATE public.ofertare_cant_extrageri
     SET stare = 'in_lucru', terminat_la = NULL, obs_relevante = NULL, cerere_id = p_cerere_id,
         reluari = reluari || jsonb_build_array(jsonb_build_object('la', now(), 'de', auth.uid(), 'motiv', btrim(p_motiv),
                                                                   'stare_veche', x.stare, 'cerere_veche', x.cerere_id))
   WHERE id = p_extragere_id;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- egalitatea exactă a două manifeste de documente: mulțimea perechilor (document_id, sha256), intrările fără sha ignorate
CREATE FUNCTION public.fn_ofertare_cb_manifest_egal(p_a jsonb, p_b jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$
  WITH a AS (SELECT DISTINCT (e->>'document_id')::bigint AS doc, e->>'sha256' AS sha FROM jsonb_array_elements(p_a) e WHERE e->>'sha256' IS NOT NULL),
       b AS (SELECT DISTINCT (e->>'document_id')::bigint AS doc, e->>'sha256' AS sha FROM jsonb_array_elements(p_b) e WHERE e->>'sha256' IS NOT NULL)
  SELECT NOT EXISTS (SELECT * FROM a EXCEPT SELECT * FROM b) AND NOT EXISTS (SELECT * FROM b EXCEPT SELECT * FROM a)
$f$;

-- ── amprenta (revenirea refuză dacă obiectele s-au schimbat după aplicare) ──
CREATE FUNCTION public.fn_ofertare_cb_amprenta()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
    SELECT 'f:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || pg_get_userbyid(p.proowner)
           || ':' || coalesce(p.proacl::text, '') AS x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%'
    UNION ALL
    SELECT 't:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text
           || ':' || (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.attidentity::text
                                        || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' ' || coalesce(a.attacl::text, ''), ',' ORDER BY a.attnum)
                        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
           || ':' || coalesce((SELECT string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid), '')
           || ':' || coalesce((SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY 1) FROM pg_index i WHERE i.indrelid = c.oid), '')
           || ':' || coalesce((SELECT string_agg(pg_get_triggerdef(g.oid) || ' ' || g.tgenabled::text, ',' ORDER BY g.tgname) FROM pg_trigger g WHERE g.tgrelid = c.oid AND NOT g.tgisinternal), '')
           || ':' || coalesce((SELECT string_agg(po.polname || ' ' || po.polcmd::text || ' ' || po.polpermissive::text || ' ' || po.polroles::regrole[]::text || ' '
                                                 || coalesce(pg_get_expr(po.polqual, po.polrelid), '') || ' ' || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''),
                                                 ',' ORDER BY po.polname) FROM pg_policy po WHERE po.polrelid = c.oid), '')
           || ':' || c.relforcerowsecurity::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('ofertare_doc_texte', 'ofertare_doc_texte_prov', 'ofertare_ai_buget', 'ofertare_ai_cereri',
           'ofertare_ai_rezervari', 'ofertare_cant_extrageri', 'ofertare_cant_felii', 'ofertare_cant_obs', 'ofertare_cant_doc_decizii', 'ofertare_cant_alias',
           'ofertare_cant_calcul', 'ofertare_cant_cmp', 'ofertare_analiza_versiuni', 'ofertare_analiza_completari', 'ofertare_clarificari_jurnal',
           'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari', 'ofertare_ai_buget_jurnal')
    UNION ALL
    SELECT 'g:' || pg_get_triggerdef(g.oid) || ' ' || g.tgenabled::text FROM pg_trigger g WHERE g.tgname = 'trg_ofertare_cb_clarificari_jurnal' AND NOT g.tgisinternal
    UNION ALL
    SELECT 's:' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND (c.relname LIKE 'ofertare\_cant\_%' OR c.relname LIKE 'ofertare\_ai\_%'
           OR c.relname LIKE 'ofertare\_analiza\_%' OR c.relname LIKE 'ofertare\_doc\_texte%' OR c.relname LIKE 'ofertare\_clarificari\_jurnal%'
           OR c.relname LIKE 'ofertare\_audit\_raspunsuri%')) s
$f$;

-- ── execuție ─────────────────────────────────────────────────────────────────────────────────────────────
DO $exec$
DECLARE f text;
BEGIN
  -- toate funcțiile: nimeni, apoi grant explicit
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)', 'public.fn_ofertare_cb_buget_deblocheaza(bigint,text)',
                           'public.fn_ofertare_cb_cerere(bigint,text,text,integer[],integer)', 'public.fn_ofertare_cb_cerere_anuleaza(bigint)',
                           'public.fn_ofertare_cb_felie_reia(bigint,text)', 'public.fn_ofertare_cb_decizie(bigint,text,text,text,text,text)',
                           'public.fn_ofertare_cb_alias(bigint,text,text,boolean)', 'public.fn_ofertare_cb_ingheata_manual(bigint,text,integer[])',
                           'public.fn_ofertare_cb_audit_decide(bigint,text,text)', 'public.fn_ofertare_cb_text(bigint,text)',
                           'public.fn_ofertare_cb_snapshot_efectiv(bigint)', 'public.fn_ofertare_cb_consum_vezi(bigint,text)',
                           'public.fn_ofertare_cb_termen_seteaza(bigint,timestamptz,text)', 'public.fn_ofertare_cb_extragere_redeschide(bigint,bigint,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_cb_rezerva(bigint,numeric)', 'public.fn_ofertare_cb_deconteaza(bigint,numeric,integer,integer,text)',
                           'public.fn_ofertare_cb_rezervare_necunoscuta(bigint)', 'public.fn_ofertare_cb_rezervare_abandon(bigint)',
                           'public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])', 'public.fn_ofertare_cb_text_valid(bigint,bigint,text)',
                           'public.fn_ofertare_cb_extragere_incepe(bigint,bigint,text,text,text,integer)',
                           'public.fn_ofertare_cb_felie_incepe(bigint,integer,integer,integer,text)', 'public.fn_ofertare_cb_felie_inchide(bigint,text)',
                           'public.fn_ofertare_cb_obs_scrie(bigint,jsonb)', 'public.fn_ofertare_cb_extragere_inchide(bigint,text)',
                           'public.fn_ofertare_cb_calcul_scrie(jsonb,jsonb)', 'public.fn_ofertare_cb_completeaza(bigint)',
                           'public.fn_ofertare_cb_ingheata_la_termen()', 'public.fn_ofertare_cb_audit_scrie(jsonb)', 'public.fn_ofertare_cb_restante()',
                           'public.fn_ofertare_cb_termen_propune(bigint,boolean,timestamptz,jsonb)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $exec$;

-- ── postcondiții + amprenta ──────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE t text; rol text; v_fp text; s text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_doc_texte', 'ofertare_doc_texte_prov', 'ofertare_ai_buget', 'ofertare_ai_cereri', 'ofertare_ai_rezervari',
                           'ofertare_cant_extrageri', 'ofertare_cant_felii', 'ofertare_cant_obs', 'ofertare_cant_doc_decizii', 'ofertare_cant_alias',
                           'ofertare_cant_calcul', 'ofertare_cant_cmp', 'ofertare_analiza_versiuni', 'ofertare_analiza_completari',
                           'ofertare_clarificari_jurnal', 'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari', 'ofertare_ai_buget_jurnal'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN RAISE EXCEPTION '20261031a: RLS oprit pe %', t; END IF;
    s := CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attname = 'id' AND NOT attisdropped)
              THEN pg_get_serial_sequence('public.' || t, 'id') END;
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(rol, 'public.' || t, 'INSERT') OR has_table_privilege(rol, 'public.' || t, 'UPDATE')
         OR has_table_privilege(rol, 'public.' || t, 'DELETE') OR has_table_privilege(rol, 'public.' || t, 'TRUNCATE')
         OR has_any_column_privilege(rol, 'public.' || t, 'INSERT') OR has_any_column_privilege(rol, 'public.' || t, 'UPDATE')
         OR (s IS NOT NULL AND has_sequence_privilege(rol, s, 'USAGE'))
         OR (rol <> 'authenticated' AND has_table_privilege(rol, 'public.' || t, 'SELECT'))
         OR (rol = 'authenticated' AND (t = 'ofertare_doc_texte') = has_table_privilege(rol, 'public.' || t, 'SELECT')) THEN
        RAISE EXCEPTION '20261031a: postconditie drepturi % / %', t, rol;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261031a: anon are EXECUTE';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%') <> 47 THEN
    RAISE EXCEPTION '20261031a: numar functii neasteptat (%)', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                                                WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%');
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031a_ofertare_cantitati_b:' || txid_current() THEN
    RAISE EXCEPTION '20261031a: garda final invalida';
  END IF;
END $post$;
