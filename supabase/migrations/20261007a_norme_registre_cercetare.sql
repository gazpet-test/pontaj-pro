-- ════════════════════════════════════════════════════════════════════════════
-- 20261007a_norme_registre_cercetare — registrele de cercetare normativă (varianta B, decizia Razvan 02.10.2026)
-- Brief: docs/cercetare/BRIEF_registre_supabase.md. Doar DDL (fără date); importul e separat
-- (scripts/import_registre_cercetare.py → SQL generat, aplicat după preview + confirmare).
-- 5 tabele noi, independente de ofertare_normative (care rămâne lista de lucru din UI):
--   norme_surse ← registru_surse.json · norme_cerinte ← registru_cerinte.json · norme_graf ← graf_aplicabilitate.json
--   cnsc_decizii ← cnsc_practica.json · clarificari_tipare ← clarificari_tipare.json
-- Câmpurile tipizate = cele folosite la interogare; restul cheilor din JSON → coloana `extra` (jsonb), nimic pierdut.
-- RLS: citire pentru orice utilizator logat; scriere DOAR owner (fn_is_app_owner) — e cunoaștere juridică, nu date operaționale.
-- Fără funcții noi, fără triggere, fără edge functions. Revenire: DROP TABLE pe cele 5 (nu există dependențe).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.norme_surse (
  source_id              text PRIMARY KEY,
  tip                    text NOT NULL,
  cod                    text,
  titlu                  text NOT NULL,
  emitent                text,
  editie                 text,
  data_publicarii        date,
  effective_from         date,
  effective_to           date,
  status                 text NOT NULL,
  inlocuit_de            text,
  url_oficial            text,
  acces                  text,
  domenii                text[] NOT NULL DEFAULT '{}',
  aplicabilitate_gazpet  text CHECK (aplicabilitate_gazpet IN ('directa','conditionata','doar_referinta','neaplicabil')),
  motiv_aplicabilitate   text,
  verificat_pe_sursa_primara boolean,
  ofertare_normative_id  bigint REFERENCES public.ofertare_normative(id) ON DELETE SET NULL,
  snapshot_sha256        text,
  snapshot_data          date,
  ultima_verificare      date,
  nota                   text,
  extra                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.norme_cerinte (
  requirement_id         text PRIMARY KEY,
  source_id              text NOT NULL REFERENCES public.norme_surse(source_id),
  editie                 text,
  locator                text,
  cerinta                text NOT NULL,
  conditii_aplicabilitate text,
  temei_tip              text NOT NULL CHECK (temei_tip IN ('OBLIGATORIE_LEGE','OBLIGATORIE_DOC_ACHIZITIE','STANDARD_INCORPORAT_PRIN_REFERINTA','VOLUNTAR_BUNA_PRACTICA','GHID_INTERPRETARE','PRACTICA_CNSC')),
  obligatoriu_de_ce      text,
  evidenta_ceruta        text[] NOT NULL DEFAULT '{}',
  verificare             text,
  prag                   jsonb,
  tip_consum             text,
  domeniu                text,
  faza                   text,
  incredere              text,
  verificat_pe_sursa     boolean NOT NULL DEFAULT false,
  necesita_standard_licentiat boolean NOT NULL DEFAULT false,
  note                   text,
  tema                   text,
  extra                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX norme_cerinte_source_idx ON public.norme_cerinte(source_id);

CREATE TABLE public.norme_graf (
  id                     bigserial PRIMARY KEY,
  from_source_id         text NOT NULL REFERENCES public.norme_surse(source_id),
  to_source_id           text NOT NULL REFERENCES public.norme_surse(source_id),
  relatie                text NOT NULL,
  locator                text NOT NULL DEFAULT '',
  nota                   text,
  tema                   text,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_source_id, to_source_id, relatie, locator)
);
CREATE INDEX norme_graf_to_idx ON public.norme_graf(to_source_id);

CREATE TABLE public.cnsc_decizii (
  id                     text PRIMARY KEY,
  source_id              text REFERENCES public.norme_surse(source_id),
  nr_decizie             text,
  buletin_oficial        text,
  alias_buletin_oficial  text,
  data                   date,
  an                     integer,
  domeniu                text,
  tema                   text[] NOT NULL DEFAULT '{}',
  regula                 text NOT NULL,
  temei_legal            text[] NOT NULL DEFAULT '{}',
  link_sursa             text,
  autoritate             text,
  obiect                 text,
  problema               text,
  solutie                text,
  rationament_cnsc       text,
  cum_ne_ajuta           text,
  tip_procedura          text,
  lege_aplicabila        text,
  valoare_estimata       numeric,
  sub_prag               boolean,
  fapte_relevante        text,
  concluzie_cnsc         text,
  comparabilitate        jsonb,
  citate_cheie           jsonb NOT NULL DEFAULT '[]'::jsonb,
  control_judiciar       jsonb,
  avertisment_instanta   text,
  verificat              boolean NOT NULL DEFAULT false,
  snapshot_text_sha256   text,
  temei_tip              text NOT NULL DEFAULT 'PRACTICA_CNSC' CHECK (temei_tip = 'PRACTICA_CNSC'),
  extra                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cnsc_decizii_domeniu_idx ON public.cnsc_decizii(domeniu);
CREATE INDEX cnsc_decizii_tema_idx ON public.cnsc_decizii USING gin(tema);

CREATE TABLE public.clarificari_tipare (
  pattern_id             text PRIMARY KEY,
  cod_vechi              text[] NOT NULL DEFAULT '{}',
  tip_problema           text NOT NULL,
  titlu                  text NOT NULL,
  trigger                jsonb NOT NULL,
  documente_de_verificat text[] NOT NULL DEFAULT '{}',
  normative_refs         text[] NOT NULL DEFAULT '{}',
  precedente_cnsc        text[] NOT NULL DEFAULT '{}',
  intrebare_propusa      text,
  impact_intern          jsonb,
  confidence             text CHECK (confidence IN ('ridicata','medie','scazuta')),
  requires_human_legal_review boolean NOT NULL DEFAULT false,
  note                   text,
  versiune_import        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- RLS + drepturi (CLAUDE.md pct. 4): citire auth.uid() IS NOT NULL, scriere doar owner.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['norme_surse','norme_cerinte','norme_graf','cnsc_decizii','clarificari_tipare'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.fn_is_app_owner(auth.uid()))', t || '_insert_owner', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.fn_is_app_owner(auth.uid())) WITH CHECK (public.fn_is_app_owner(auth.uid()))', t || '_update_owner', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.fn_is_app_owner(auth.uid()))', t || '_delete_owner', t);
  END LOOP;
END $rls$;
GRANT USAGE, SELECT ON SEQUENCE public.norme_graf_id_seq TO authenticated, service_role;

COMMENT ON TABLE public.norme_surse IS 'Registrul surselor normative (cercetare docs/cercetare/registru_surse.json). Scriere doar owner.';
COMMENT ON TABLE public.norme_cerinte IS 'Cerințe atomice cu locator și temei_tip. În întrebări către AC se citează doar verificat_pe_sursa=true.';
COMMENT ON TABLE public.norme_graf IS 'Graf de aplicabilitate între surse (modifica/abroga/incorporeaza/...).';
COMMENT ON TABLE public.cnsc_decizii IS 'Practica CNSC (temei_tip PRACTICA_CNSC — interpretare, NU lege).';
COMMENT ON TABLE public.clarificari_tipare IS 'Tipare de clarificare: întrebare neutră + impact intern (nu se trimite). requires_human_legal_review=true ⇒ review juridic uman obligatoriu.';
