-- 20261025a: proveniența structurată a datelor DERIVATE pe loturi (PR #677, review Jakarinos r5 P1 #2 și #4 pe #676).
-- Decizie Răzvan 12.10.2026 (varianta B): #676 livrat cu P1 cunoscute, rezolvate aici. Plan: docs/ofertare/PROVENIENTA_DERIVATE_PLAN.md
--
-- Ce face (DOAR schemă, NICIO dată atinsă, fără backfill — rândurile vechi rămân NULL = „fără proveniență”):
--   1. ofertare_clarificari: surse_cerinte_ids / surse_cantitati_ids / surse_document_ids (bigint[]) — din ce cerințe,
--      cantități și documente a generat platforma întrebarea. Azi ID-urile stau doar în textul `sursa`.
--   2. ofertare_cantitati: surse_document_ids (bigint[]) — documentele din care vine cantitatea, cantitatea din planșă și
--      diferența (azi: doar textul `sursa`).
--   3. Validare la scriere (trigger, inclusiv service_role): fiecare ID există și e din ACEEAȘI licitație cu rândul; fără
--      NULL în listă, maxim 500; lista se normalizează (sortată, fără duplicate), lista goală devine NULL.
-- Cum se folosesc (codul din același PR): un derivat intră într-un prompt plătit doar dacă TOATE sursele lui sunt eligibile
-- acum (fn_ofertare_document_eligibil); pe licitațiile are_loturi, derivatul generat automat fără surse = exclus
-- (fara_provenienta). Pe fara_loturi nu se schimbă nimic. Impact live 12.10: pe are_loturi 0 clarificări de platformă,
-- 2 cantități — de aceea nu e nevoie de backfill.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261025a_ofertare_provenienta_derivate_ROLLBACK.sql (arhivează sursele înainte de drop).
DO $migrare$
DECLARE
  v_n int;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261025a_ofertare_provenienta_derivate:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261025a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF to_regclass('public.ofertare_clarificari') IS NULL OR to_regclass('public.ofertare_cantitati') IS NULL
     OR to_regclass('public.ofertare_cerinte') IS NULL OR to_regclass('public.ofertare_documente_atribuire') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261025a: lipsește una din tabelele ofertare_clarificari / cantitati / cerinte / documente_atribuire';
  END IF;
  IF to_regprocedure('public.fn_ofertare_document_eligibil(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261025a: 20261024b (loturi MVP) nu e aplicată';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('ofertare_clarificari', 'ofertare_cantitati') AND column_name LIKE 'surse\_%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Precondiție 20261025a: % coloane surse_* există deja (reaplicare?)', v_n;
  END IF;
  -- corpul RPC-ului de transfer trebuie să fie exact cel citit la 12.10.2026 (altfel CREATE OR REPLACE ar pierde o schimbare)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)'))
     IS DISTINCT FROM 'c00ba5566c7d231ef7eefe926a8ed56a' THEN
    RAISE EXCEPTION 'Precondiție 20261025a: ofertare_transfer_plansa_cantitati diferă de versiunea citită (md5 c00ba556…)';
  END IF;
  IF to_regprocedure('public.fn_ofertare_surse_valideaza()') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 20261025a: fn_ofertare_surse_valideaza există deja';
  END IF;

  -- ── 1 + 2. coloanele ──────────────────────────────────────────────────────────────────────────────────
  ALTER TABLE public.ofertare_clarificari
    ADD COLUMN surse_cerinte_ids bigint[],
    ADD COLUMN surse_cantitati_ids bigint[],
    ADD COLUMN surse_document_ids bigint[];
  ALTER TABLE public.ofertare_cantitati
    ADD COLUMN surse_document_ids bigint[];
  COMMENT ON COLUMN public.ofertare_clarificari.surse_cerinte_ids IS
    'Cerințele din care platforma a generat întrebarea (20261025a). NULL = fără proveniență: pe are_loturi nu se refolosește în prompturi.';
  COMMENT ON COLUMN public.ofertare_clarificari.surse_cantitati_ids IS
    'Cantitățile din care platforma a generat întrebarea (20261025a).';
  COMMENT ON COLUMN public.ofertare_clarificari.surse_document_ids IS
    'Documentele-sursă ale cerințelor/cantităților la generare + documentul clarificării (20261025a). Toate trebuie eligibile la refolosire.';
  COMMENT ON COLUMN public.ofertare_cantitati.surse_document_ids IS
    'Documentele din care vin cantitatea, cantitatea din planșă și diferența (20261025a). NULL la rând extras automat = fără proveniență (exclus pe are_loturi).';
END
$migrare$;

-- ── 3. validarea la scriere ──────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: verifică existența în tabele cu RLS indiferent cine scrie; nu e expusă (REVOKE mai jos), rulează doar
-- ca trigger. Fără SQL dinamic: câte un bloc explicit pe fiecare coloană.
CREATE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_derivat boolean := false;   -- sursele derivate de server (clarificarea automată): fără refuz pe ID dispărut
BEGIN
  IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
    -- Clarificarea AUTOMATĂ din planșe (ofertare_clarificare_planse_auto, scrisă doar de server): sursele se derivă din
    -- ce a folosit funcția — planșele din `sursa` („planse_auto:475,474,…”), documentele și rândurile de cantități din
    -- baza_generare. Fără să rescriem RPC-ul de 12k; se recalculează la fiecare schimbare a sursei / bazei.
    IF NEW.origine = 'automat' AND (TG_OP = 'INSERT' OR NEW.sursa IS DISTINCT FROM OLD.sursa
                                    OR NEW.baza_generare IS DISTINCT FROM OLD.baza_generare OR NEW.origine IS DISTINCT FROM OLD.origine) THEN
      NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT t::bigint AS x FROM unnest(string_to_array(replace(coalesce(NEW.sursa, ''), 'planse_auto:', ''), ',')) t
           WHERE coalesce(NEW.sursa, '') LIKE 'planse_auto:%' AND t ~ '^[0-9]{1,18}$'
          UNION
          SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'documente') = 'array'
                                                                   THEN NEW.baza_generare->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$') s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT (e->>'id')::bigint ORDER BY (e->>'id')::bigint)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                         THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
         WHERE e->>'id' ~ '^[0-9]{1,18}$');
      v_derivat := true;
    END IF;
    IF NEW.surse_cerinte_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cerinte_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cerinte_ids) > 500 THEN
        RAISE EXCEPTION 'surse_cerinte_ids: fără NULL, maxim 500' USING ERRCODE = '22023';
      END IF;
      NEW.surse_cerinte_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cerinte_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cerinte_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = x AND c.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cerinte_ids: cerința % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.surse_cantitati_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cantitati_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cantitati_ids) > 500 THEN
        RAISE EXCEPTION 'surse_cantitati_ids: fără NULL, maxim 500' USING ERRCODE = '22023';
      END IF;
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cantitati_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cantitati_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x AND q.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND AND NOT v_derivat THEN RAISE EXCEPTION 'surse_cantitati_ids: cantitatea % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  -- surse_document_ids: pe ambele tabele
  IF NEW.surse_document_ids IS NOT NULL THEN
    IF array_position(NEW.surse_document_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_document_ids) > 500 THEN
      RAISE EXCEPTION 'surse_document_ids: fără NULL, maxim 500' USING ERRCODE = '22023';
    END IF;
    NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_document_ids) x);
    SELECT x INTO v_lipsa FROM unnest(NEW.surse_document_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = NEW.licitatie_id) LIMIT 1;
    IF FOUND AND NOT v_derivat THEN RAISE EXCEPTION 'surse_document_ids: documentul % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_surse_valideaza() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER a02_ofertare_clarificari_surse
  BEFORE INSERT OR UPDATE OF surse_cerinte_ids, surse_cantitati_ids, surse_document_ids, licitatie_id, origine, sursa, baza_generare
  ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();
CREATE TRIGGER a02_ofertare_cantitati_surse
  BEFORE INSERT OR UPDATE OF surse_document_ids, licitatie_id ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();

-- ── 4. transferul planșă → cantități notează planșa în surse (singura modificare față de corpul live, citit 12.10.2026:
--      `surse_document_ids` pe UPDATE = sursele vechi ∪ planșa, pe INSERT = {planșa}). CREATE OR REPLACE păstrează drepturile.
CREATE OR REPLACE FUNCTION public.ofertare_transfer_plansa_cantitati(p_doc_id bigint, p_rulare text, p_randuri jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_doc record; v_tr jsonb; r jsonb; v_row jsonb; v_patch jsonb; v_n int; v_adaugate int := 0; v_actualizate int := 0; v_sarite int := 0;
BEGIN
  SELECT id, licitatie_id, analiza INTO v_doc FROM ofertare_documente_atribuire WHERE id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('eroare', 'lease_pierdut', 'motiv', 'document inexistent'); END IF;
  v_tr := v_doc.analiza -> 'citire_ai' -> 'transfer';
  IF v_tr IS NULL OR v_tr ->> 'rulare' IS DISTINCT FROM p_rulare OR v_tr ->> 'stare' IS DISTINCT FROM 'in_curs' THEN
    RETURN jsonb_build_object('eroare', 'lease_pierdut');
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_randuri, '[]'::jsonb)) LOOP
    IF r ->> 'op' = 'update' THEN
      v_patch := r -> 'patch';
      UPDATE ofertare_cantitati SET
        cantitate_plansa = CASE WHEN v_patch ? 'cantitate_plansa' THEN (v_patch ->> 'cantitate_plansa')::numeric ELSE cantitate_plansa END,
        diferenta_nota   = CASE WHEN v_patch ? 'diferenta_nota' THEN v_patch ->> 'diferenta_nota' ELSE diferenta_nota END,
        status           = CASE WHEN v_patch ? 'status' THEN v_patch ->> 'status' ELSE status END,
        surse_document_ids = array_append(coalesce(surse_document_ids, '{}'::bigint[]), p_doc_id),   -- 20261025a
        updated_at       = now()
      WHERE id = (r ->> 'id')::bigint AND licitatie_id = v_doc.licitatie_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_actualizate := v_actualizate + v_n;
    ELSIF r ->> 'op' = 'insert' THEN
      v_row := r -> 'row';
      IF EXISTS (SELECT 1 FROM ofertare_cantitati WHERE licitatie_id = v_doc.licitatie_id AND denumire = v_row ->> 'denumire'
                   AND sursa IS NOT DISTINCT FROM v_row ->> 'sursa') THEN
        v_sarite := v_sarite + 1; CONTINUE;
      END IF;
      INSERT INTO ofertare_cantitati (licitatie_id, denumire, um, cantitate, cantitate_plansa, status, extras_de_ai, sursa, specificatii, diferenta_nota,
                                      surse_document_ids)
      VALUES (v_doc.licitatie_id, v_row ->> 'denumire', v_row ->> 'um', (v_row ->> 'cantitate')::numeric,
              (v_row ->> 'cantitate_plansa')::numeric, COALESCE(v_row ->> 'status', 'extras'),
              COALESCE((v_row ->> 'extras_de_ai')::boolean, true), v_row ->> 'sursa', v_row ->> 'specificatii', v_row ->> 'diferenta_nota',
              ARRAY[p_doc_id]);   -- 20261025a
      v_adaugate := v_adaugate + 1;
    END IF;
  END LOOP;
  UPDATE ofertare_documente_atribuire SET analiza = jsonb_set(
      jsonb_set(analiza, '{citire_ai,transfer}', v_tr || jsonb_build_object('stare', 'facut', 'la', to_jsonb(now()))),
      '{citire_ai,rev}', to_jsonb(gen_random_uuid()::text))
  WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'adaugate', v_adaugate, 'actualizate', v_actualizate, 'sarite_existente', v_sarite);
END; $function$;

-- ── postcondiții + garda de livrare (final) ─────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND ((table_name = 'ofertare_clarificari' AND column_name IN ('surse_cerinte_ids', 'surse_cantitati_ids', 'surse_document_ids'))
          OR (table_name = 'ofertare_cantitati' AND column_name = 'surse_document_ids'))) <> 4 THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: coloanele surse_* lipsesc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_clarificari WHERE surse_cerinte_ids IS NOT NULL OR surse_cantitati_ids IS NOT NULL OR surse_document_ids IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.ofertare_cantitati WHERE surse_document_ids IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: datele existente trebuie să rămână fără surse (fără backfill)';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_ofertare_surse_valideaza()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_surse_valideaza()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: funcția de validare e expusă';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('a02_ofertare_clarificari_surse', 'a02_ofertare_cantitati_surse')) <> 2 THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: triggerele de validare lipsesc';
  END IF;
  IF has_function_privilege('authenticated', 'public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: drepturile RPC-ului de transfer s-au schimbat';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261025a_ofertare_provenienta_derivate:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261025a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$post$;
