-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261014a_ofertare_clarificari_temeiuri — pasul B din docs/juridic/MAPARE_CNSC_IN_ERP.md (sesiunea juridică, 05.10.2026)
-- Legătura dintre o întrebare de clarificare (sau un punct al ei) și temeiul ei: o decizie CNSC, o cerință normativă
-- sau un tipar de clarificări. Citatul din decizie se copiază ÎNGHEȚAT (citat_text) și e verificat la insert/update că e
-- identic cu cnsc_decizii.citate_cheie[citat_idx].text, iar citat_loc e rescris din corpus — platforma nu produce citate.
-- „Include în adresă” pe o țintă cu tipar ce cere review juridic → doar owner, impus în trigger (nu doar în UI).
--
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT, ca
--   postgres, cu acordul explicit al lui Răzvan pe schemă (CLAUDE.md pct. 3/6). Pregătită în sesiunea de chat (PR #615),
--   review Jakarinos + Copilot. Gate 0e = 0 (fără constatări noi la get_advisors).
-- Revenire: supabase/revenire/20261014a_ofertare_clarificari_temeiuri_ROLLBACK.sql (șterge tabelul ȘI datele din el).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261014a_ofertare_clarificari_temeiuri:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261014a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.ofertare_clarificari_temeiuri') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: public.ofertare_clarificari_temeiuri există deja — migrarea nu e idempotentă prin design';
  END IF;
  IF to_regprocedure('public.fn_temei_citat_verifica()') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_temei_citat_verifica() există deja';
  END IF;
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR to_regprocedure('public.fn_is_app_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0d: lipsesc fn_are_acces_ofertare() / fn_is_app_owner(uuid) — politicile și trigger-ul depind de ele';
  END IF;
  IF to_regclass('public.cnsc_decizii') IS NULL OR to_regclass('public.norme_cerinte') IS NULL OR to_regclass('public.clarificari_tipare') IS NULL
     OR to_regclass('public.ofertare_clarificari') IS NULL OR to_regclass('public.ofertare_clarificari_puncte') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0e: lipsește una din tabelele referite (corpus / clarificări / puncte)';
  END IF;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cnsc_decizii' AND column_name = 'citate_cheie') IS DISTINCT FROM 'jsonb'
     OR (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clarificari_tipare' AND column_name = 'requires_human_legal_review') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Precondiție 0f: cnsc_decizii.citate_cheie nu e jsonb sau clarificari_tipare.requires_human_legal_review nu e boolean';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cnsc_decizii'::regclass AND contype = 'p' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.cnsc_decizii'::regclass AND attname = 'id')])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.norme_cerinte'::regclass AND contype IN ('p','u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.norme_cerinte'::regclass AND attname = 'requirement_id')])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.clarificari_tipare'::regclass AND contype IN ('p','u') AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.clarificari_tipare'::regclass AND attname = 'pattern_id')]) THEN
    RAISE EXCEPTION 'Precondiție 0g: cheile referite (cnsc_decizii.id, norme_cerinte.requirement_id, clarificari_tipare.pattern_id) nu sunt PK/UNIQUE';
  END IF;
END
$pre$;

CREATE TABLE public.ofertare_clarificari_temeiuri (
  id                bigserial PRIMARY KEY,
  -- ținta: exact una dintre întrebare / punct
  clarificare_id    bigint REFERENCES public.ofertare_clarificari(id) ON DELETE CASCADE,
  punct_id          bigint REFERENCES public.ofertare_clarificari_puncte(id) ON DELETE CASCADE,
  -- temeiul: exact unul dintre decizie / cerință normativă / tipar (FK-uri reale, nu ref polimorfic)
  cnsc_decizie_id   text REFERENCES public.cnsc_decizii(id),
  requirement_id    text REFERENCES public.norme_cerinte(requirement_id),
  pattern_id        text REFERENCES public.clarificari_tipare(pattern_id),
  -- proveniența: tiparul din care a fost PROPUSĂ o decizie/cerință (nu e temei, e urma propunerii) — B1 Jakarinos r1
  pattern_id_origine text REFERENCES public.clarificari_tipare(pattern_id),
  -- citatul (doar pentru decizii): indexul în citate_cheie + copia înghețată + locul (pagina)
  citat_idx         int,
  citat_text        text,
  citat_loc         text,
  nota              text,                                   -- internă, NU iese din platformă
  sursa             text NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual', 'propus_tipar', 'propus_ai')),
  confirmat         boolean NOT NULL DEFAULT true,          -- propunerile (propus_*) intră cu false până bifează omul
  include_in_adresa boolean NOT NULL DEFAULT false,         -- implicit NU se exportă în adresa către AC
  creat_de          uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temei_tinta_exact_una CHECK (num_nonnulls(clarificare_id, punct_id) = 1),
  CONSTRAINT temei_sursa_exact_una CHECK (num_nonnulls(cnsc_decizie_id, requirement_id, pattern_id) = 1),
  CONSTRAINT temei_citat_doar_decizie CHECK (citat_idx IS NULL OR cnsc_decizie_id IS NOT NULL),
  CONSTRAINT temei_citat_idx_pozitiv CHECK (citat_idx IS NULL OR citat_idx >= 0),      -- indexul negativ ar dubla același citat (B10)
  CONSTRAINT temei_origine_nu_tipar CHECK (pattern_id_origine IS NULL OR pattern_id IS NULL),
  CONSTRAINT temei_citat_complet CHECK ((citat_idx IS NULL) = (citat_text IS NULL)),
  CONSTRAINT temei_export_doar_confirmat CHECK (NOT include_in_adresa OR confirmat)
);
COMMENT ON TABLE public.ofertare_clarificari_temeiuri IS 'Temeiurile unei întrebări/unui punct de clarificare: decizie CNSC (cu citat înghețat + pagină), cerință normativă sau tipar. Pasul B, MAPARE_CNSC_IN_ERP.md. Citatul e verificat la insert că e identic cu corpusul.';

-- un temei o singură dată per țintă (NULLS NOT DISTINCT — PG15+, live e PG17)
CREATE UNIQUE INDEX ofertare_clarificari_temeiuri_unic
  ON public.ofertare_clarificari_temeiuri (clarificare_id, punct_id, cnsc_decizie_id, requirement_id, pattern_id, citat_idx) NULLS NOT DISTINCT;
CREATE INDEX ofertare_clarificari_temeiuri_clarificare_idx ON public.ofertare_clarificari_temeiuri (clarificare_id);
CREATE INDEX ofertare_clarificari_temeiuri_punct_idx ON public.ofertare_clarificari_temeiuri (punct_id);

-- Garanțiile de BACKEND (nu doar de UI — review Jakarinos r1, B1/B2):
--  1. citatul e EXACT cel din corpus: citat_text verificat, citat_loc rescris din citate_cheie[citat_idx] la orice insert/update
--  2. „include în adresă” când ținta are un tipar cu review juridic (ca temei sau ca proveniență) → doar un owner
-- Nu e SECURITY DEFINER: rulează cu drepturile celui care scrie (are SELECT pe corpus și pe tabel).
CREATE OR REPLACE FUNCTION public.fn_temei_citat_verifica()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_citat jsonb;
  v_review boolean;
BEGIN
  IF NEW.include_in_adresa AND (TG_OP = 'INSERT' OR NOT OLD.include_in_adresa) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.clarificari_tipare t
      WHERE t.requires_human_legal_review
        AND (t.pattern_id = NEW.pattern_id OR t.pattern_id = NEW.pattern_id_origine
             OR t.pattern_id IN (SELECT x.pattern_id FROM public.ofertare_clarificari_temeiuri x
                                 WHERE x.pattern_id IS NOT NULL
                                   AND ((NEW.clarificare_id IS NOT NULL AND x.clarificare_id = NEW.clarificare_id)
                                     OR (NEW.punct_id IS NOT NULL AND x.punct_id = NEW.punct_id))))
    ) INTO v_review;
    IF v_review AND NOT public.fn_is_app_owner(auth.uid()) THEN
      RAISE EXCEPTION 'Tiparul cere review juridic: includerea în adresă o poate face doar un owner' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.citat_idx IS NULL THEN
    NEW.citat_loc := NULL;
    RETURN NEW;
  END IF;
  SELECT d.citate_cheie -> NEW.citat_idx INTO v_citat FROM public.cnsc_decizii d WHERE d.id = NEW.cnsc_decizie_id;
  IF v_citat IS NULL OR v_citat->>'text' IS NULL THEN
    RAISE EXCEPTION 'Decizia % nu are citatul cu indexul %', NEW.cnsc_decizie_id, NEW.citat_idx USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.citat_text IS DISTINCT FROM (v_citat->>'text') THEN
    RAISE EXCEPTION 'Citatul nu e identic cu cel din corpus (decizia %, idx %) — platforma nu produce citate', NEW.cnsc_decizie_id, NEW.citat_idx USING ERRCODE = 'check_violation';
  END IF;
  NEW.citat_loc := v_citat->>'loc';
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_temei_citat_verifica() FROM PUBLIC;

CREATE TRIGGER trg_temei_citat_verifica
  BEFORE INSERT OR UPDATE ON public.ofertare_clarificari_temeiuri   -- la ORICE update: și citat_loc e rescris din corpus
  FOR EACH ROW EXECUTE FUNCTION public.fn_temei_citat_verifica();

-- RLS: citire ȘI scriere doar pentru cine are acces la modulul Ofertare (fn_are_acces_ofertare, ca la scrierea pe
-- ofertare_clarificari). Citirea e mai strictă decât pe ofertare_clarificari pentru că `nota` e internă (review Jakarinos r1).
ALTER TABLE public.ofertare_clarificari_temeiuri ENABLE ROW LEVEL SECURITY;
CREATE POLICY temeiuri_sel ON public.ofertare_clarificari_temeiuri FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY temeiuri_ins ON public.ofertare_clarificari_temeiuri FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY temeiuri_upd ON public.ofertare_clarificari_temeiuri FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY temeiuri_del ON public.ofertare_clarificari_temeiuri FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

REVOKE ALL ON public.ofertare_clarificari_temeiuri FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_clarificari_temeiuri TO authenticated;
GRANT ALL ON public.ofertare_clarificari_temeiuri TO service_role;
REVOKE ALL ON SEQUENCE public.ofertare_clarificari_temeiuri_id_seq FROM PUBLIC, anon;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_clarificari_temeiuri_id_seq TO authenticated, service_role;

DO $post$
DECLARE
  v_rel oid := 'public.ofertare_clarificari_temeiuri'::regclass;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN
    RAISE EXCEPTION 'Postcondiție 1: RLS nu e activ pe ofertare_clarificari_temeiuri';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_clarificari_temeiuri') <> 4 THEN
    RAISE EXCEPTION 'Postcondiție 2: nu sunt exact 4 politici (sel/ins/upd/del)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_temei_citat_verifica' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Postcondiție 3: trigger-ul trg_temei_citat_verifica lipsește';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = v_rel AND contype = 'c') < 6 THEN
    RAISE EXCEPTION 'Postcondiție 4: lipsesc CHECK-uri (țintă exact una, temei exact unul, citat doar decizie, citat complet, idx pozitiv, origine nu tipar, export doar confirmat)';
  END IF;
  IF NOT has_table_privilege('authenticated', v_rel, 'SELECT') OR NOT has_table_privilege('authenticated', v_rel, 'INSERT')
     OR NOT has_table_privilege('authenticated', v_rel, 'UPDATE') OR NOT has_table_privilege('authenticated', v_rel, 'DELETE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR NOT has_table_privilege('service_role', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 5: GRANT-uri greșite (authenticated CRUD prin RLS, service_role da, anon nu)';
  END IF;
  IF has_sequence_privilege('anon', 'public.ofertare_clarificari_temeiuri_id_seq', 'USAGE')
     OR NOT has_sequence_privilege('authenticated', 'public.ofertare_clarificari_temeiuri_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'Postcondiție 6: GRANT-uri greșite pe secvență';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.fn_temei_citat_verifica()')) IS TRUE
     OR (SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.fn_temei_citat_verifica()')) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 7: fn_temei_citat_verifica trebuie să fie SECURITY INVOKER cu search_path = public, pg_temp';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261014a_ofertare_clarificari_temeiuri:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261014a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
