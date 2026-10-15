-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031a — Ofertare TKT-0329 B, PR2: schema de bază pentru cantități structurate + audit al răspunsurilor Autorității.
-- Specificația: docs/ofertare/TKT0329_B_SPEC.md v8 (aprobată la r8: Copilot GO, Jakarinos GO cu fix-uri), §4 + §5.3.
-- Obiecte NOI (nu schimbă date existente). Excepții, ambele aditive:
--   * (niciuna pe ofertare_licitatii: termenul de clarificări stă în tabelul nou ofertare_termen_clarificari);
--   * triggerul trg_ofertare_cb_clarificari_jurnal pe ofertare_clarificari (jurnal + înghețarea D1; erorile NU blochează
--     scrierea clarificării).
-- Tabele (18): ofertare_termen_clarificari, ofertare_doc_texte, ofertare_doc_texte_prov, ofertare_cant_extrageri, ofertare_cant_felii, ofertare_ai_buget,
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

-- ── extrageri + felii (munca) ────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_cant_extrageri (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  document_id    bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256     text NOT NULL,
  prov_id        bigint NOT NULL REFERENCES public.ofertare_doc_texte_prov(id),
  familie_id     text NOT NULL CHECK (length(familie_id) BETWEEN 1 AND 200),
  extractor_id   text NOT NULL CHECK (extractor_id ~ '^[A-Za-z0-9._:@/-]{3,200}$'),
  felii_total    integer NOT NULL CHECK (felii_total BETWEEN 1 AND 500),
  stare          text NOT NULL DEFAULT 'in_lucru' CHECK (stare IN ('in_lucru', 'gata', 'partial', 'esuat')),
  obs_relevante  integer CHECK (obs_relevante IS NULL OR obs_relevante >= 0),
  cerere_id      bigint NOT NULL REFERENCES public.ofertare_ai_cereri(id),
  pornit_de      uuid,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  terminat_la    timestamptz,
  CHECK ((stare = 'in_lucru') = (terminat_la IS NULL)),
  CHECK ((stare = 'gata') = (obs_relevante IS NOT NULL)),
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
  CHECK (NOT pozitie_dovedita OR (cantitate_offset IS NOT NULL AND citat_interval IS NOT NULL AND rand_interval IS NOT NULL)),
  CHECK (NOT (pozitie_dovedita AND valoare_ambigua))
);
CREATE INDEX ofertare_cant_obs_lic ON public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256);

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
CREATE TABLE public.ofertare_analiza_versiuni (
  id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id                 bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  lot_domeniu                  text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr                       integer[] NOT NULL DEFAULT '{}',
  tip                          text NOT NULL CHECK (tip IN ('initiala', 'recalcul')),
  declansator                  text NOT NULL CHECK (declansator IN ('clarificare_trimisa', 'termen_clarificari', 'manual')),
  clarificare_declansatoare_id bigint,
  moment_referinta             timestamptz NOT NULL,
  inghetat_tardiv              boolean NOT NULL,
  termen_aproximat             boolean NOT NULL DEFAULT false,
  inghetata_la                 timestamptz NOT NULL DEFAULT now(),
  inghetata_de                 uuid,
  doc_manifest                 jsonb NOT NULL CHECK (jsonb_typeof(doc_manifest) = 'array'),
  clarificari                  jsonb NOT NULL CHECK (jsonb_typeof(clarificari) = 'array'),
  amprenta                     text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
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
  -- câmpuri imuabile + stare (automatul de stare e în funcții)
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_buget FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''plafon_usd'', ''blocat'', ''blocat_motiv'', ''setat_de'', ''setat_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_cereri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''stare_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_ai_rezervari FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''cost_real'', ''tokeni_in'', ''tokeni_out'', ''model'', ''inchisa_la'')';
  EXECUTE 'CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_extrageri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil(''stare'', ''obs_relevante'', ''terminat_la'')';
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
                           'ofertare_clarificari_jurnal', 'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari'] LOOP
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
              AND array_position(p_nr, NULL) IS NULL $f$;

-- ── buget (owner) ──
CREATE FUNCTION public.fn_ofertare_cb_buget_seteaza(p_licitatie_id bigint, p_scop text, p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_consum numeric;
BEGIN
  IF NOT public.fn_ofertare_cb_este_owner() THEN RAISE EXCEPTION 'Doar owner-ul setează plafonul' USING ERRCODE = '42501'; END IF;
  IF p_scop NOT IN ('cant_extragere', 'audit_raspunsuri') OR p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 100
     OR p_plafon_usd <> round(p_plafon_usd, 2) THEN RAISE EXCEPTION 'Scop sau plafon invalid' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  v_consum := public.fn_ofertare_cb_consum(p_licitatie_id, p_scop);
  IF p_plafon_usd < v_consum THEN RAISE EXCEPTION 'Plafonul (%) e sub consumul existent (%)', p_plafon_usd, v_consum USING ERRCODE = '22023'; END IF;
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd, setat_de) VALUES (p_licitatie_id, p_scop, p_plafon_usd, auth.uid())
  ON CONFLICT (licitatie_id, scop) DO UPDATE SET plafon_usd = EXCLUDED.plafon_usd, setat_de = EXCLUDED.setat_de, setat_la = now();
  RETURN jsonb_build_object('ok', true, 'plafon_usd', p_plafon_usd, 'consum', v_consum);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_buget_deblocheaza(p_licitatie_id bigint, p_scop text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF NOT public.fn_ofertare_cb_este_owner() THEN RAISE EXCEPTION 'Doar owner-ul deblochează bugetul' USING ERRCODE = '42501'; END IF;
  UPDATE public.ofertare_ai_buget SET blocat = false, blocat_motiv = NULL, setat_de = auth.uid(), setat_la = now()
   WHERE licitatie_id = p_licitatie_id AND scop = p_scop AND blocat;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bugetul nu e blocat' USING ERRCODE = '55000'; END IF;
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
DECLARE v_id bigint;
BEGIN
  IF NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare aprobă cheltuiala' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_ofertare_cb_lot_ok(p_lot_domeniu, p_lot_nr) OR p_ore IS NULL OR p_ore < 1 OR p_ore > 720 THEN
    RAISE EXCEPTION 'Lot sau valabilitate invalidă' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(p_licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop) THEN
    RAISE EXCEPTION 'Nu există plafon pentru % pe această licitație (îl setează owner-ul)', p_scop USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ai_cereri (licitatie_id, lot_domeniu, lot_nr, scop, aprobat_de, valabil_pana)
  VALUES (p_licitatie_id, p_lot_domeniu, p_lot_nr, p_scop, auth.uid(), now() + make_interval(hours => p_ore)) RETURNING id INTO v_id;
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
CREATE FUNCTION public.fn_ofertare_cb_rezerva(p_cerere_id bigint, p_munca_id text, p_incercare integer, p_suma numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c record; b record; v_consum numeric; v_id bigint;
BEGIN
  IF p_suma IS NULL OR p_suma < 0.0001 OR p_suma > 2 OR p_suma <> round(p_suma, 4) OR p_munca_id IS NULL OR p_incercare IS NULL THEN
    RETURN jsonb_build_object('refuz', 'parametri');
  END IF;
  SELECT * INTO c FROM public.ofertare_ai_cereri WHERE id = p_cerere_id;
  IF NOT FOUND OR c.stare <> 'activa' OR c.valabil_pana <= now() THEN RETURN jsonb_build_object('refuz', 'cerere'); END IF;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = c.licitatie_id AND scop = c.scop FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'buget'); END IF;
  IF b.blocat THEN RETURN jsonb_build_object('refuz', 'buget_blocat'); END IF;
  -- reluarea (incercare > 1) există doar dacă felia respectivă a fost creată de RPC-ul uman
  IF p_incercare > 1 AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_felii WHERE munca_id = p_munca_id AND incercare = p_incercare) THEN
    RETURN jsonb_build_object('refuz', 'reluare_neautorizata');
  END IF;
  v_consum := public.fn_ofertare_cb_consum(c.licitatie_id, c.scop);
  IF v_consum + p_suma > b.plafon_usd THEN RETURN jsonb_build_object('refuz', 'plafon', 'consum', v_consum, 'plafon', b.plafon_usd); END IF;
  INSERT INTO public.ofertare_ai_rezervari (cerere_id, licitatie_id, scop, munca_id, incercare, suma_rezervata)
  VALUES (p_cerere_id, c.licitatie_id, c.scop, p_munca_id, p_incercare, p_suma)
  ON CONFLICT (munca_id, incercare) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('refuz', 'munca_deja_rezervata'); END IF;
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
  INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
  VALUES ('ofertare-cant-' || r.scop, p_model, coalesce(p_tokeni_in, 0), coalesce(p_tokeni_out, 0), round(p_cost, 4), 'ofertare_licitatii', r.licitatie_id);
  IF v_peste THEN
    UPDATE public.ofertare_ai_buget SET blocat = true, blocat_motiv = format('cost real %s peste rezervarea %s (rezervare %s)', round(p_cost, 4), r.suma_rezervata, r.id)
     WHERE licitatie_id = r.licitatie_id AND scop = r.scop AND NOT blocat;
  END IF;
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
AS $f$
  SELECT coalesce(
    (SELECT jsonb_build_object('tip', 'prov', 'id', p.id, 'origine', 'transcriere', 'completitudine', p.completitudine)
       FROM public.ofertare_doc_texte_prov p
      WHERE p.licitatie_id = p_licitatie_id AND p.document_id = p_document_id AND p.sha256 = p_sha256
      ORDER BY p.id DESC LIMIT 1),
    '{}'::jsonb) - CASE WHEN (SELECT p.origine FROM public.ofertare_doc_texte_prov p
                               WHERE p.licitatie_id = p_licitatie_id AND p.document_id = p_document_id AND p.sha256 = p_sha256
                               ORDER BY p.id DESC LIMIT 1) = 'sinteza_ai' THEN ARRAY['tip','id','origine','completitudine'] ELSE ARRAY[]::text[] END
  || coalesce((SELECT jsonb_build_object('decizie_id', d.id, 'origine_confirmata', true)
                 FROM public.ofertare_cant_doc_decizii d
                WHERE d.licitatie_id = p_licitatie_id AND d.document_id = p_document_id AND d.doc_sha256 = p_sha256 AND d.decizie = 'text_confirmat'
                  AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = d.id)
                ORDER BY d.id DESC LIMIT 1), '{}'::jsonb)
$f$;

-- ── extragere + felii (service_role) ──
CREATE FUNCTION public.fn_ofertare_cb_extragere_incepe(p_cerere_id bigint, p_document_id bigint, p_sha256 text, p_prov_id bigint,
                                                       p_familie_id text, p_extractor_id text, p_felii_total integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE c record; d record; v_id bigint; v_cache bigint; e jsonb;
BEGIN
  SELECT * INTO c FROM public.ofertare_ai_cereri WHERE id = p_cerere_id;
  IF NOT FOUND OR c.stare <> 'activa' OR c.valabil_pana <= now() OR c.scop <> 'cant_extragere' THEN RETURN jsonb_build_object('refuz', 'cerere'); END IF;
  SELECT id, licitatie_id INTO d FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR d.licitatie_id <> c.licitatie_id THEN RETURN jsonb_build_object('refuz', 'document'); END IF;
  e := public.fn_ofertare_document_eligibil(p_document_id);
  IF NOT coalesce((e->>'eligibil')::boolean, false) THEN RETURN jsonb_build_object('refuz', 'neeligibil', 'motiv', e->>'motiv'); END IF;
  -- dovada textului: prov de transcriere pe exact acest document + sha (sau text_confirmat)
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_doc_texte_prov p WHERE p.id = p_prov_id AND p.document_id = p_document_id AND p.sha256 = p_sha256
                   AND p.origine = 'transcriere')
     AND (public.fn_ofertare_cb_text_valid(c.licitatie_id, p_document_id, p_sha256) ? 'decizie_id') IS NOT TRUE THEN
    RETURN jsonb_build_object('refuz', 'text_nevalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_doc_texte_prov p WHERE p.id = p_prov_id AND p.document_id = p_document_id AND p.sha256 = p_sha256) THEN
    RETURN jsonb_build_object('refuz', 'prov');
  END IF;
  SELECT id INTO v_cache FROM public.ofertare_cant_extrageri WHERE document_id = p_document_id AND doc_sha256 = p_sha256
     AND extractor_id = p_extractor_id AND stare = 'gata';
  IF v_cache IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'cache', true, 'extragere_id', v_cache); END IF;
  INSERT INTO public.ofertare_cant_extrageri (licitatie_id, document_id, doc_sha256, prov_id, familie_id, extractor_id, felii_total, cerere_id, pornit_de)
  VALUES (c.licitatie_id, p_document_id, p_sha256, p_prov_id, p_familie_id, p_extractor_id, p_felii_total, p_cerere_id, c.aprobat_de)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('refuz', 'extragere_in_lucru'); END IF;
  RETURN jsonb_build_object('ok', true, 'cache', false, 'extragere_id', v_id);
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
DECLARE f record; v_lic bigint; v_id bigint; v_max integer;
BEGIN
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Felie inexistentă' USING ERRCODE = '42501'; END IF;
  SELECT licitatie_id INTO v_lic FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id;
  IF NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'Motiv obligatoriu' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_felie:' || f.munca_id));
  SELECT max(incercare) INTO v_max FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id;
  IF EXISTS (SELECT 1 FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id AND incercare = v_max AND stare NOT IN ('esuat', 'necunoscut')) THEN
    RAISE EXCEPTION 'Ultima încercare nu e eșuată / necunoscută' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, motiv_reluare)
  VALUES (f.munca_id, v_max + 1, f.extragere_id, f.felie_nr, f.de_la, f.pana_la, f.sha_felie, btrim(p_motiv)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'felie_id', v_id, 'incercare', v_max + 1);
END $f$;

CREATE FUNCTION public.fn_ofertare_cb_felie_inchide(p_felie_id bigint, p_stare text, p_rezervare_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF p_stare NOT IN ('gata', 'esuat', 'necunoscut') THEN RAISE EXCEPTION 'Stare invalidă' USING ERRCODE = '22023'; END IF;
  UPDATE public.ofertare_cant_felii SET stare = p_stare, rezervare_id = p_rezervare_id, inchisa_la = now() WHERE id = p_felie_id AND stare = 'in_zbor';
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'nu_e_in_zbor'); END IF;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- observațiile unei felii (service_role), validate; imuabile după scriere
CREATE FUNCTION public.fn_ofertare_cb_obs_scrie(p_felie_id bigint, p_obs jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; o jsonb; v_n integer := 0;
BEGIN
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id;
  IF NOT FOUND OR f.stare <> 'in_zbor' THEN RAISE EXCEPTION 'Felia nu e în zbor' USING ERRCODE = '55000'; END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id;
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
DECLARE v_lic bigint; v_prec bigint; v_id bigint;
BEGIN
  SELECT licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  IF NOT FOUND OR NOT public.fn_ofertare_cb_poate(v_lic) THEN RAISE EXCEPTION 'Document inexistent sau fără drept' USING ERRCODE = '42501'; END IF;
  IF p_decizie NOT IN ('nu_e_sursa_cantitativa', 'rol_confirmat', 'verificat_fara_lungimi', 'sursa_partiala_acceptata', 'text_confirmat') THEN
    RAISE EXCEPTION 'Decizie invalidă' USING ERRCODE = '22023';
  END IF;
  -- verificat_fara_lungimi pe tot documentul doar dacă NICIO observație relevantă pe acest document + sha + rol
  IF p_decizie = 'verificat_fara_lungimi' AND p_sectiune = '*' AND EXISTS (
       SELECT 1 FROM public.ofertare_cant_obs WHERE document_id = p_document_id AND doc_sha256 = p_doc_sha256 AND rol_sursa = p_rol AND um_norm = 'm') THEN
    RAISE EXCEPTION 'Documentul are observații cu lungimi pe acest rol: decizia se ia pe secțiune' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_decizie:' || p_document_id || ':' || p_doc_sha256 || ':' || coalesce(p_rol, '-') || ':'
                                         || coalesce(p_sectiune, '-') || ':' || p_decizie));
  SELECT d.id INTO v_prec FROM public.ofertare_cant_doc_decizii d
   WHERE d.document_id = p_document_id AND d.doc_sha256 = p_doc_sha256 AND d.rol IS NOT DISTINCT FROM p_rol
     AND d.sectiune IS NOT DISTINCT FROM p_sectiune AND d.decizie = p_decizie
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii r WHERE r.revoca_id = d.id) ORDER BY d.id DESC LIMIT 1;
  IF v_prec IS NOT NULL THEN
    INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, revoca_id, motiv, decis_de)
    VALUES (v_lic, p_document_id, p_doc_sha256, 'revocare', v_prec, 'înlocuită de o decizie nouă', auth.uid());
  END IF;
  INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, rol, sectiune, decizie, motiv, decis_de)
  VALUES (v_lic, p_document_id, p_doc_sha256, CASE WHEN p_decizie = 'text_confirmat' THEN NULL ELSE p_rol END,
          CASE WHEN p_decizie = 'text_confirmat' THEN NULL ELSE p_sectiune END, p_decizie, btrim(p_motiv), auth.uid()) RETURNING id INTO v_id;
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
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = v_lic) THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  IF v_snap IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni WHERE id = v_snap AND licitatie_id = v_lic) THEN
    RAISE EXCEPTION 'Snapshot străin licitației' USING ERRCODE = '22023';
  END IF;
  -- observațiile din manifest trebuie să fie ale licitației
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_calcul->'obs_manifest') e
              WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cant_obs o WHERE o.id = (e->>'id')::bigint AND o.licitatie_id = v_lic)) THEN
    RAISE EXCEPTION 'Observație străină licitației în manifest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ofertare_cant_calcul (licitatie_id, lot_domeniu, lot_nr, tip, pe_snapshot_id, algoritm_versiune, praguri, extractor_id,
    doc_manifest, obs_manifest, alias_manifest, decizii_manifest, acoperire, stare, amprenta)
  VALUES (v_lic, p_calcul->>'lot_domeniu', coalesce(ARRAY(SELECT jsonb_array_elements_text(p_calcul->'lot_nr')::int), '{}'), p_calcul->>'tip', v_snap,
    p_calcul->>'algoritm_versiune', p_calcul->'praguri', p_calcul->>'extractor_id', p_calcul->'doc_manifest', p_calcul->'obs_manifest',
    p_calcul->'alias_manifest', p_calcul->'decizii_manifest', p_calcul->'acoperire', p_calcul->>'stare', p_calcul->>'amprenta') RETURNING id INTO v_id;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_cmp, '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(c->'obs_a', '[]') || coalesce(c->'obs_b', '[]')) x
                WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cant_obs o WHERE o.id = x::bigint AND o.licitatie_id = v_lic)) THEN
      RAISE EXCEPTION 'Comparație cu observație străină' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ofertare_cant_cmp (calcul_id, cheie, rol_a, rol_b, val_a, val_b, obs_a, obs_b, delta_abs, delta_rel, verdict, motiv_incomplet, importanta)
    VALUES (v_id, c->>'cheie', c->>'rol_a', c->>'rol_b', (c->>'val_a')::numeric, (c->>'val_b')::numeric,
      coalesce(ARRAY(SELECT jsonb_array_elements_text(c->'obs_a')::bigint), '{}'), coalesce(ARRAY(SELECT jsonb_array_elements_text(c->'obs_b')::bigint), '{}'),
      (c->>'delta_abs')::numeric, (c->>'delta_rel')::numeric, c->>'verdict', c->>'motiv_incomplet', coalesce((c->>'importanta')::numeric, 0));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'calcul_id', v_id);
END $f$;

-- ── înghețarea (D1), faza 1: manifest + clarificări as-of din jurnal; idempotentă, serializată ──
-- Documentele eligibile as-of moment: ale licitației, create ≤ moment, neînlocuite ≤ moment (seap_meta.inlocuieste_id), eligibile
-- pentru lot (fn_ofertare_document_eligibil). sha-ul = al textului curent; dacă documentul a fost reprocesat DUPĂ moment → text_indisponibil.
CREATE FUNCTION public.fn_ofertare_cb_ingheata(p_licitatie_id bigint, p_lot_domeniu text, p_lot_nr integer[], p_declansator text,
                                              p_clarificare_id bigint, p_de uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE l record; v_moment timestamptz; v_tardiv boolean := false; v_aprox boolean := false; v_termen timestamptz;
        v_docs jsonb; v_clar jsonb; v_amp text; v_id bigint; v_existent bigint;
BEGIN
  IF NOT public.fn_ofertare_cb_lot_ok(p_lot_domeniu, p_lot_nr) OR p_declansator NOT IN ('clarificare_trimisa', 'termen_clarificari', 'manual') THEN
    RAISE EXCEPTION 'Parametri invalizi' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_ingheata:' || p_licitatie_id || ':' || p_lot_domeniu || ':' || p_lot_nr::text));
  SELECT id INTO v_existent FROM public.ofertare_analiza_versiuni
   WHERE licitatie_id = p_licitatie_id AND lot_domeniu = p_lot_domeniu AND lot_nr = p_lot_nr AND tip = 'initiala';
  IF v_existent IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'snapshot_id', v_existent, 'existent', true); END IF;
  SELECT x.id, t.termen AS termen_clarificari, x.termen_depunere INTO l
    FROM public.ofertare_licitatii x LEFT JOIN public.ofertare_termen_clarificari t ON t.licitatie_id = x.id WHERE x.id = p_licitatie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  v_termen := coalesce(l.termen_clarificari, l.termen_depunere);
  v_aprox := l.termen_clarificari IS NULL AND l.termen_depunere IS NOT NULL;
  -- moment_referinta pe orice cale: după termen → termenul (tardiv); altfel acum
  IF v_termen IS NOT NULL AND now() > v_termen THEN v_moment := v_termen; v_tardiv := true; ELSE v_moment := now(); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.id, 'tip', d.tip,
           'sha256', CASE WHEN d.text_extras IS NULL OR (d.procesat_la IS NOT NULL AND d.procesat_la > v_moment) THEN NULL
                          ELSE encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex') END,
           'text_indisponibil', d.text_extras IS NULL OR (d.procesat_la IS NOT NULL AND d.procesat_la > v_moment),
           'familie', coalesce(d.seap_meta->>'inlocuieste_id', d.id::text),
           -- dovada textului pe EXACT acest document + sha (prov de transcriere / text_confirmat), la momentul înghețării
           'text_dovada', CASE WHEN d.text_extras IS NULL THEN '{}'::jsonb
                               ELSE public.fn_ofertare_cb_text_valid(p_licitatie_id, d.id, encode(sha256(convert_to(d.text_extras, 'UTF8')), 'hex')) END)
           ORDER BY d.id), '[]'::jsonb)
    INTO v_docs
    FROM public.ofertare_documente_atribuire d
   WHERE d.licitatie_id = p_licitatie_id AND d.created_at <= v_moment
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire n
                      WHERE n.licitatie_id = d.licitatie_id AND n.seap_meta->>'inlocuieste_id' = d.id::text AND n.created_at <= v_moment)
     AND coalesce((public.fn_ofertare_document_eligibil(d.id)->>'eligibil')::boolean, false);
  -- clarificările as-of, DOAR din jurnal: textul din ultimul „trimisa” ≤ moment; statusul = ultimul eveniment ≤ moment
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
  v_amp := encode(sha256(convert_to(jsonb_build_object('lic', p_licitatie_id, 'lot', p_lot_domeniu, 'nr', p_lot_nr, 'moment', v_moment,
                                                       'docs', v_docs, 'clar', v_clar)::text, 'UTF8')), 'hex');
  INSERT INTO public.ofertare_analiza_versiuni (licitatie_id, lot_domeniu, lot_nr, tip, declansator, clarificare_declansatoare_id, moment_referinta,
    inghetat_tardiv, termen_aproximat, inghetata_de, doc_manifest, clarificari, amprenta)
  VALUES (p_licitatie_id, p_lot_domeniu, p_lot_nr, 'initiala', p_declansator, p_clarificare_id, v_moment, v_tardiv, v_aprox, p_de, v_docs, v_clar, v_amp)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.ofertare_analiza_versiuni WHERE licitatie_id = p_licitatie_id AND lot_domeniu = p_lot_domeniu AND lot_nr = p_lot_nr AND tip = 'initiala';
    RETURN jsonb_build_object('ok', true, 'snapshot_id', v_id, 'existent', true);
  END IF;
  -- faza 2 (completare) într-un sub-bloc: o eroare lasă snapshot-ul minimal + rândul de eroare
  BEGIN
    PERFORM public.fn_ofertare_cb_completeaza_intern(v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (p_licitatie_id, p_clarificare_id, 'completare', left(SQLERRM, 1000));
  END;
  RETURN jsonb_build_object('ok', true, 'snapshot_id', v_id, 'existent', false, 'moment_referinta', v_moment, 'tardiv', v_tardiv);
END $f$;

-- faza 2: texte materializate (doar sha-urile din manifest, din textul curent când sha-ul coincide) + legătura cu calculul
CREATE FUNCTION public.fn_ofertare_cb_completeaza_intern(p_snapshot_id bigint)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE s record; e jsonb; v_texte jsonb := '[]'::jsonb; v_txt text; v_calc bigint; v_coer text := 'fara_calcul'; v_id bigint; v_set text;
BEGIN
  SELECT * INTO s FROM public.ofertare_analiza_versiuni WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot inexistent' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(s.doc_manifest) LOOP
    CONTINUE WHEN e->>'sha256' IS NULL;
    SELECT text_extras INTO v_txt FROM public.ofertare_documente_atribuire WHERE id = (e->>'document_id')::bigint;
    CONTINUE WHEN v_txt IS NULL OR encode(sha256(convert_to(v_txt, 'UTF8')), 'hex') <> e->>'sha256';
    INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (s.licitatie_id, e->>'sha256', v_txt) ON CONFLICT DO NOTHING;
    v_texte := v_texte || jsonb_build_array(jsonb_build_object('document_id', (e->>'document_id')::bigint, 'sha256', e->>'sha256'));
  END LOOP;
  -- calculul: curent, creat ≤ moment, pe EXACT aceleași documente + sha-uri
  v_set := (SELECT string_agg((dm->>'document_id') || ':' || coalesce(dm->>'sha256', '-'), ',' ORDER BY (dm->>'document_id')::bigint)
              FROM jsonb_array_elements(s.doc_manifest) dm);
  SELECT c.id INTO v_calc FROM public.ofertare_cant_calcul c
   WHERE c.licitatie_id = s.licitatie_id AND c.lot_domeniu = s.lot_domeniu AND c.lot_nr = s.lot_nr AND c.tip = 'curent' AND c.creat_la <= s.moment_referinta
     AND (SELECT string_agg((m->>'document_id') || ':' || coalesce(m->>'sha256', '-'), ',' ORDER BY (m->>'document_id')::bigint)
            FROM jsonb_array_elements(c.doc_manifest) m) = v_set
   ORDER BY c.id DESC LIMIT 1;
  IF v_calc IS NOT NULL THEN v_coer := 'calcul_curent';
  ELSIF EXISTS (SELECT 1 FROM public.ofertare_cant_calcul c WHERE c.licitatie_id = s.licitatie_id AND c.tip = 'curent') THEN v_coer := 'calcul_depasit';
  END IF;
  INSERT INTO public.ofertare_analiza_completari (snapshot_id, texte, calcul_id, coerenta) VALUES (p_snapshot_id, v_texte, v_calc, v_coer) RETURNING id INTO v_id;
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
  RETURN public.fn_ofertare_cb_ingheata(p_licitatie_id, p_lot_domeniu, p_lot_nr, 'manual', NULL, auth.uid());
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
      PERFORM public.fn_ofertare_cb_ingheata(l.id, 'toate', '{}', 'termen_clarificari', NULL, NULL);
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
AS $f$
  WITH s AS (SELECT * FROM public.ofertare_analiza_versiuni WHERE id = p_snapshot_id AND (SELECT public.fn_are_acces_ofertare())),
  man AS (SELECT (e->>'document_id')::bigint AS doc, e->>'sha256' AS sha FROM s, jsonb_array_elements(s.doc_manifest) e WHERE e->>'sha256' IS NOT NULL),
  tx AS (SELECT DISTINCT ON (t->>'sha256') (t->>'sha256') AS sha, c.id AS completare_id
           FROM public.ofertare_analiza_completari c, jsonb_array_elements(c.texte) t
          WHERE c.snapshot_id = p_snapshot_id ORDER BY t->>'sha256', c.id DESC),
  calc AS (SELECT c.id, c.calcul_id FROM public.ofertare_analiza_completari c
            WHERE c.snapshot_id = p_snapshot_id AND c.coerenta = 'calcul_curent' ORDER BY c.id DESC LIMIT 1)
  SELECT jsonb_build_object(
    'snapshot_id', (SELECT id FROM s),
    'complet', (SELECT count(*) FROM man) = (SELECT count(*) FROM man WHERE sha IN (SELECT sha FROM tx))
               AND NOT EXISTS (SELECT 1 FROM s, jsonb_array_elements(s.doc_manifest) e WHERE (e->>'text_indisponibil')::boolean),
    'calcul_id', (SELECT calcul_id FROM calc),
    'completari', coalesce((SELECT jsonb_agg(DISTINCT completare_id) FROM tx), '[]'::jsonb) || coalesce((SELECT jsonb_agg(id) FROM calc), '[]'::jsonb))
  WHERE EXISTS (SELECT 1 FROM s)
$f$;

-- ── jurnalul clarificărilor + înghețarea D1: UN singur trigger, întâi jurnalul, apoi înghețarea; nu blochează clarificarea ──
CREATE FUNCTION public.fn_ofertare_cb_trg_clarificari()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_ev text;
BEGIN
  IF NEW.status IN ('trimisa', 'raspunsa', 'retrasa') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_ev := NEW.status;
    BEGIN
      INSERT INTO public.ofertare_clarificari_jurnal (clarificare_id, licitatie_id, eveniment, text, text_sha256)
      VALUES (NEW.id, NEW.licitatie_id, v_ev, coalesce(NEW.intrebare, ''), encode(sha256(convert_to(coalesce(NEW.intrebare, ''), 'UTF8')), 'hex'));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'jurnal', left(SQLERRM, 1000));
    END;
    IF v_ev = 'trimisa' AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id = NEW.licitatie_id AND v.tip = 'initiala'
                                          AND v.lot_domeniu = 'toate') THEN
      BEGIN
        PERFORM public.fn_ofertare_cb_ingheata(NEW.licitatie_id, 'toate', '{}', 'clarificare_trimisa', NEW.id, auth.uid());
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'ingheata', left(SQLERRM, 1000));
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
DECLARE s record; v_snap bigint := (p_audit->>'versiune_analiza_id')::bigint; v_calc bigint; v_sim bigint; v_id bigint; x text;
BEGIN
  SELECT * INTO s FROM public.ofertare_analiza_versiuni WHERE id = v_snap;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot inexistent' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire WHERE id = (p_audit->>'document_id')::bigint AND licitatie_id = s.licitatie_id) THEN
    RAISE EXCEPTION 'Document străin licitației' USING ERRCODE = '22023';
  END IF;
  -- dovezi istorice: comparații din calculul snapshot-ului (vederea efectivă) + clarificări din snapshot
  v_calc := (public.fn_ofertare_cb_snapshot_efectiv_intern(v_snap)->>'calcul_id')::bigint;
  FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_istoric'->'cmp_ids', '[]')) LOOP
    IF v_calc IS NULL OR NOT EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND calcul_id = v_calc) THEN
      RAISE EXCEPTION 'Dovadă istorică străină snapshot-ului (cmp %)', x USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_istoric'->'clarificare_ids', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.clarificari) c WHERE (c->>'clarificare_id') = x AND NOT (c->>'versiune_necunoscuta')::boolean) THEN
      RAISE EXCEPTION 'Clarificare străină snapshot-ului sau fără versiune trimisă (%)', x USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- dovezi de simulare: calcul simulare legat de ACEST snapshot
  IF p_audit ? 'dovezi_simulare' AND p_audit->'dovezi_simulare' <> 'null'::jsonb THEN
    v_sim := (p_audit->'dovezi_simulare'->>'calcul_id')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_cant_calcul WHERE id = v_sim AND tip = 'simulare' AND pe_snapshot_id = v_snap) THEN
      RAISE EXCEPTION 'Simulare străină snapshot-ului' USING ERRCODE = '22023';
    END IF;
    FOR x IN SELECT jsonb_array_elements_text(coalesce(p_audit->'dovezi_simulare'->'cmp_ids', '[]')) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.ofertare_cant_cmp WHERE id = x::bigint AND calcul_id = v_sim) THEN
        RAISE EXCEPTION 'Dovadă de simulare străină (cmp %)', x USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.ofertare_audit_raspunsuri (licitatie_id, lot_domeniu, lot_nr, versiune_analiza_id, document_id, doc_sha256, citire_id, citire_sursa_tip,
    citire_sursa_sha, citire_completa, executie_id, inlocuieste_id, pereche_id, pozitii, multiplicitate, intrebare_text, raspuns_text, text_verificat,
    asociere_dovedita, ancore, efect, clasificare, cauza, regula, dovezi_istoric, dovezi_simulare)
  VALUES (s.licitatie_id, s.lot_domeniu, s.lot_nr, v_snap, (p_audit->>'document_id')::bigint, p_audit->>'doc_sha256', p_audit->>'citire_id',
    p_audit->>'citire_sursa_tip', p_audit->>'citire_sursa_sha', (p_audit->>'citire_completa')::boolean, p_audit->>'executie_id',
    (p_audit->>'inlocuieste_id')::bigint, p_audit->>'pereche_id', coalesce(p_audit->'pozitii', '[]'), coalesce((p_audit->>'multiplicitate')::int, 1),
    p_audit->>'intrebare_text', p_audit->>'raspuns_text', (p_audit->>'text_verificat')::boolean, (p_audit->>'asociere_dovedita')::boolean,
    coalesce(p_audit->'ancore', '{}'), p_audit->>'efect', p_audit->>'clasificare', p_audit->>'cauza', p_audit->>'regula',
    coalesce(p_audit->'dovezi_istoric', '{}'), CASE WHEN p_audit->'dovezi_simulare' = 'null'::jsonb THEN NULL ELSE p_audit->'dovezi_simulare' END)
  ON CONFLICT (versiune_analiza_id, executie_id, pereche_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'deja', true); END IF;
  RETURN jsonb_build_object('ok', true, 'audit_id', v_id);
END $f$;

-- varianta internă a vederii efective (fără filtrul de acces; folosită de funcțiile server)
CREATE FUNCTION public.fn_ofertare_cb_snapshot_efectiv_intern(p_snapshot_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT jsonb_build_object('calcul_id', (SELECT c.calcul_id FROM public.ofertare_analiza_completari c
                                           WHERE c.snapshot_id = p_snapshot_id AND c.coerenta = 'calcul_curent' ORDER BY c.id DESC LIMIT 1))
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
           || ':' || coalesce((SELECT string_agg(po.polname || ' ' || po.polcmd::text || ' ' || coalesce(pg_get_expr(po.polqual, po.polrelid), ''), ',' ORDER BY po.polname)
                                 FROM pg_policy po WHERE po.polrelid = c.oid), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('ofertare_doc_texte', 'ofertare_doc_texte_prov', 'ofertare_ai_buget', 'ofertare_ai_cereri',
           'ofertare_ai_rezervari', 'ofertare_cant_extrageri', 'ofertare_cant_felii', 'ofertare_cant_obs', 'ofertare_cant_doc_decizii', 'ofertare_cant_alias',
           'ofertare_cant_calcul', 'ofertare_cant_cmp', 'ofertare_analiza_versiuni', 'ofertare_analiza_completari', 'ofertare_clarificari_jurnal',
           'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari')
    UNION ALL
    SELECT 'g:' || pg_get_triggerdef(g.oid) FROM pg_trigger g WHERE g.tgname = 'trg_ofertare_cb_clarificari_jurnal' AND NOT g.tgisinternal) s
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
                           'public.fn_ofertare_cb_snapshot_efectiv(bigint)', 'public.fn_ofertare_cb_consum(bigint,text)',
                           'public.fn_ofertare_cb_termen_seteaza(bigint,timestamptz,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_cb_rezerva(bigint,text,integer,numeric)', 'public.fn_ofertare_cb_deconteaza(bigint,numeric,integer,integer,text)',
                           'public.fn_ofertare_cb_rezervare_necunoscuta(bigint)', 'public.fn_ofertare_cb_rezervare_abandon(bigint)',
                           'public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])', 'public.fn_ofertare_cb_text_valid(bigint,bigint,text)',
                           'public.fn_ofertare_cb_extragere_incepe(bigint,bigint,text,bigint,text,text,integer)',
                           'public.fn_ofertare_cb_felie_incepe(bigint,integer,integer,integer,text)', 'public.fn_ofertare_cb_felie_inchide(bigint,text,bigint)',
                           'public.fn_ofertare_cb_obs_scrie(bigint,jsonb)', 'public.fn_ofertare_cb_extragere_inchide(bigint,text)',
                           'public.fn_ofertare_cb_calcul_scrie(jsonb,jsonb)', 'public.fn_ofertare_cb_completeaza(bigint)',
                           'public.fn_ofertare_cb_ingheata_la_termen()', 'public.fn_ofertare_cb_audit_scrie(jsonb)',
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
                           'ofertare_clarificari_jurnal', 'ofertare_analiza_erori', 'ofertare_audit_raspunsuri', 'ofertare_termen_clarificari'] LOOP
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
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%') <> 40 THEN
    RAISE EXCEPTION '20261031a: numar functii neasteptat (%)', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                                                WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_cb\_%');
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031a_ofertare_cantitati_b:' || txid_current() THEN
    RAISE EXCEPTION '20261031a: garda final invalida';
  END IF;
END $post$;
