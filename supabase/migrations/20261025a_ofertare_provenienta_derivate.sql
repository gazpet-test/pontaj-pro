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
  -- RPC-ul de transfer trebuie să fie EXACT versiunea citită la 12.10.2026 — corp (md5 fără CR) + atribute (owner, SECURITY
  -- DEFINER, search_path, volatilitate, ACL); altfel CREATE OR REPLACE ar pierde / reseta o schimbare (review Copilot r1 P1 #2)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'c00ba5566c7d231ef7eefe926a8ed56a'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție 20261025a: ofertare_transfer_plansa_cantitati diferă de versiunea citită (corp md5 c00ba556… sau atribute/ACL)';
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
-- Sursele sunt ale SERVERULUI (review Copilot r2 P1 #1): un apel cu JWT de utilizator (authenticated / anon) nu poate seta sau
-- schimba surse_*, iar pe clarificările automate nici origine / sursa / baza_generare (din ele se derivă sursele). Edge-urile
-- scriu cu service_role, RPC-urile automate rulează din edge-uri cu service_role, migrările ca postgres. UI-ul nu scrie aceste câmpuri.
CREATE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_utilizator boolean;
  -- sursele derivate de server (clarificarea automată): un ID DISPĂRUT (inexistent global) se păstrează — codul îl tratează ca
  -- neverificabil = exclus; un ID existent în ALTĂ licitație se refuză ca la orice scriere (review Copilot r1 P1 #1)
  v_derivat boolean := false;
  v_max constant int := 20000;   -- fără trunchiere: baza F3 a clarificării automate poate avea sute de rânduri (Jakarinos r6 P2)
BEGIN
  v_utilizator := v_rol IN ('authenticated', 'anon');
  IF v_utilizator THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.surse_document_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        IF NEW.surse_cerinte_ids IS NOT NULL OR NEW.surse_cantitati_ids IS NOT NULL OR NEW.origine = 'automat' THEN
          RAISE EXCEPTION 'Sursele (surse_*) și clarificările automate le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSE
      IF NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        IF NEW.surse_cerinte_ids IS DISTINCT FROM OLD.surse_cerinte_ids OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids THEN
          RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
        IF (OLD.origine = 'automat' OR NEW.origine = 'automat')
           AND (NEW.origine, NEW.sursa, NEW.baza_generare) IS DISTINCT FROM (OLD.origine, OLD.sursa, OLD.baza_generare) THEN
          RAISE EXCEPTION 'Proveniența clarificării automate (origine / sursa / baza_generare) o scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
    -- Clarificarea AUTOMATĂ din planșe (ofertare_clarificare_planse_auto, scrisă doar de server): sursele se derivă din
    -- ce a folosit funcția — planșele din `sursa` („planse_auto:475,474,…”), documentele și rândurile de cantități din
    -- baza_generare. Fără să rescriem RPC-ul de 12k. La UPDATE sursele NU scad (reuniune cu cele vechi, Jakarinos r6 P1 #6):
    -- o ciornă protejată își poate păstra textul despre o planșă scoasă din `sursa` — planșa rămâne în proveniență.
    IF NEW.origine = 'automat' AND (TG_OP = 'INSERT' OR NEW.sursa IS DISTINCT FROM OLD.sursa
                                    OR NEW.baza_generare IS DISTINCT FROM OLD.baza_generare OR NEW.origine IS DISTINCT FROM OLD.origine
                                    OR NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids
                                    OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids) THEN
      NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT t::bigint AS x FROM unnest(string_to_array(replace(coalesce(NEW.sursa, ''), 'planse_auto:', ''), ',')) t
           WHERE coalesce(NEW.sursa, '') LIKE 'planse_auto:%' AND t ~ '^[0-9]{1,18}$'
          UNION
          SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'documente') = 'array'
                                                                   THEN NEW.baza_generare->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_document_ids END) y WHERE y IS NOT NULL) s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT (e->>'id')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                           THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_cantitati_ids END) y WHERE y IS NOT NULL) s);
      v_derivat := true;
    END IF;
    IF NEW.surse_cerinte_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cerinte_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cerinte_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cerinte_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cerinte_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cerinte_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cerinte_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = x AND c.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cerinte_ids: cerința % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.surse_cantitati_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cantitati_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cantitati_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cantitati_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cantitati_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cantitati_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x AND q.licitatie_id = NEW.licitatie_id)
         AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x)) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cantitati_ids: cantitatea % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  -- surse_document_ids: pe ambele tabele
  IF NEW.surse_document_ids IS NOT NULL THEN
    IF array_position(NEW.surse_document_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_document_ids) > v_max THEN
      RAISE EXCEPTION 'surse_document_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
    END IF;
    NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_document_ids) x);
    SELECT x INTO v_lipsa FROM unnest(NEW.surse_document_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = NEW.licitatie_id)
       AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x)) LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'surse_document_ids: documentul % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_surse_valideaza() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER a02_ofertare_clarificari_surse
  BEFORE INSERT OR UPDATE OF surse_cerinte_ids, surse_cantitati_ids, surse_document_ids, licitatie_id, origine, sursa, baza_generare
  ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();
CREATE TRIGGER a02_ofertare_cantitati_surse
  BEFORE INSERT OR UPDATE OF surse_document_ids, licitatie_id ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();

-- ── 4. transferul planșă → cantități notează planșa în surse (singura modificare față de corpul live, citit 12.10.2026:
--      `surse_document_ids` pe UPDATE = sursele vechi ∪ planșa DOAR dacă erau cunoscute — NULL rămâne NULL: planșa nu justifică
--      cantitatea existentă dintr-o sursă necunoscută (Jakarinos r6 P1 #5); pe INSERT = {planșa}). CREATE OR REPLACE păstrează drepturile.
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
        surse_document_ids = CASE WHEN surse_document_ids IS NULL THEN NULL ELSE array_append(surse_document_ids, p_doc_id) END,   -- 20261025a
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
  -- versiunea nouă a RPC-ului: corp + atribute exacte (aceeași identitate pe care o cere revenirea înainte să o înlocuiască)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'cdb15a2a246a590a5172ba4ed3ce9b30'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Postcondiție 20261025a: RPC-ul de transfer nou nu are corpul / atributele așteptate (md5 cdb15a2a…)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261025a_ofertare_provenienta_derivate:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261025a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$post$;
