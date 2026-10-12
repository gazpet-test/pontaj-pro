-- 20261026a: PR-ul de RIGOARE pe proveniența datelor derivate (blocant înainte de prima generare pe 102).
-- Plan: docs/ofertare/PROVENIENTA_DERIVATE_PLAN.md, secțiunea BLOCANT (follow-up #677, Jakarinos r14).
--
-- Ce face:
--   1. ofertare_cerinte.surse_document_ids (bigint[]): TOATE documentele din care provine cerința. Validat de același trigger
--      ca la clarificări / cantități (20261025a): ID-uri din aceeași licitație, fără NULL, normalizat, scris doar de server.
--      Cititorii (filtreazaDerivate) cer eligibilitatea pe TOATE sursele. NICIO dată atinsă (live 12.10: 0 cerințe din seturi).
--   2. fn_ofertare_raspuns_set_aplica: (a) garda de loturi mutată ÎN RPC, sub blocarea licitației și înaintea oricărei scrieri;
--      (b) fiecare cerință scrisă primește surse_document_ids = sursele operației ∪ documentul de răspuns ∪ (la modifică /
--      anulează) sursele versiunii vechi; (c) o sursă nevalidă / inexistentă / din altă licitație = conflict, nimic scris pentru
--      operație (înainte, documentul de răspuns intra nevalidat). Restul corpului: neschimbat (diff în PR).
--   3. ofertare_clarificare_planse_auto: sursele (planșe, documentele financiare citate, documentele și cantitățile din baza
--      F3) se scriu explicit, ODATĂ cu textul; fn_ofertare_surse_valideaza face reuniunea cu ce scrie serverul, nu le mai
--      suprascrie cu derivarea (derivarea rămâne plasă de siguranță).
--   Garda a03 din 20261025a RĂMÂNE: aplicarea automată pe licitațiile cu loturi rămâne manuală (decizia Răzvan, varianta B).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261026a_ofertare_rigoare_provenienta_ROLLBACK.sql (arhivează sursele cerințelor înainte de drop, corpurile vechi exacte).
DO $migrare$
DECLARE
  v_n int;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261026a_ofertare_rigoare_provenienta:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261026a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF to_regprocedure('public.fn_ofertare_raspuns_set_garda_loturi()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a03_ofertare_raspuns_set_garda_loturi') THEN
    RAISE EXCEPTION 'Precondiție 20261026a: 20261025a (proveniență) nu e aplicată';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ofertare_cerinte' AND column_name = 'surse_document_ids';
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a02_ofertare_cerinte_surse') THEN
    RAISE EXCEPTION 'Precondiție 20261026a: ofertare_cerinte.surse_document_ids / triggerul există deja (reaplicare?)';
  END IF;
  -- corpurile înlocuite trebuie să fie EXACT versiunile citite la 12.10.2026 (corp md5 fără CR + atribute + ACL)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)')
                    AND md5(replace(p.prosrc, chr(13), '')) = '2033717feec11bb1bdd2b7caf97ef807'
                    AND NOT p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție 20261026a: fn_ofertare_raspuns_set_aplica diferă de versiunea citită (corp md5 2033717f… sau atribute/ACL)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_clarificare_planse_auto(bigint)')
                    AND md5(replace(p.prosrc, chr(13), '')) = '2e0eaa89663d5f3f4d6d49aa8443fae2'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție 20261026a: ofertare_clarificare_planse_auto diferă de versiunea citită (corp md5 2e0eaa89… sau atribute/ACL)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ofertare_surse_valideaza()')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'a4e41e9e4e93d430386ae7f55c3be977'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție 20261026a: fn_ofertare_surse_valideaza diferă de versiunea citită (corp md5 a4e41e9e… sau atribute/ACL)';
  END IF;

  -- ── 1. coloana ────────────────────────────────────────────────────────────────────────────────────────
  ALTER TABLE public.ofertare_cerinte ADD COLUMN surse_document_ids bigint[];
  COMMENT ON COLUMN public.ofertare_cerinte.surse_document_ids IS
    'Toate documentele din care provine cerința (20261026a) — la cerințele scrise de fn_ofertare_raspuns_set_aplica: sursele operației ∪ documentul de răspuns ∪ sursele versiunii vechi. Toate trebuie eligibile la refolosire. Scrise doar de server.';
END
$migrare$;

-- ── 1b. validarea la scriere pe cerințe (aceeași funcție ca la clarificări / cantități) ─────────────────
CREATE TRIGGER a02_ofertare_cerinte_surse
  BEFORE INSERT OR UPDATE OF surse_document_ids, licitatie_id ON public.ofertare_cerinte
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();

-- ── 3a. validarea: reuniunea cu sursele scrise explicit de server (CREATE OR REPLACE păstrează owner + ACL) ─
CREATE OR REPLACE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_utilizator boolean;
  -- 20261026a: pe ofertare_cerinte se validează surse_document_ids (blocul comun de la final), ca pe cantități.
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
        -- originile rezervate serverului (automat, platforma) nu se inserează de utilizator (review Copilot r3 P1)
        IF NEW.surse_cerinte_ids IS NOT NULL OR NEW.surse_cantitati_ids IS NOT NULL OR NEW.origine IN ('automat', 'platforma') THEN
          RAISE EXCEPTION 'Sursele (surse_*) și clarificările generate (automat / platforma) le scrie doar serverul' USING ERRCODE = '42501';
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
        -- originea e atribut de proveniență: imuabilă pentru utilizator după INSERT (fără spălare platforma -> manual, Copilot r3 P1)
        IF NEW.origine IS DISTINCT FROM OLD.origine THEN
          RAISE EXCEPTION 'Originea clarificării nu se schimbă după creare' USING ERRCODE = '42501';
        END IF;
        IF OLD.origine = 'automat' AND (NEW.sursa, NEW.baza_generare) IS DISTINCT FROM (OLD.sursa, OLD.baza_generare) THEN
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
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_document_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: sursele scrise EXPLICIT de server odată cu textul (ofertare_clarificare_planse_auto)
          SELECT y FROM unnest(NEW.surse_document_ids) y WHERE y IS NOT NULL) s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT (e->>'id')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                           THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_cantitati_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: idem, cantitățile scrise explicit
          SELECT y FROM unnest(NEW.surse_cantitati_ids) y WHERE y IS NOT NULL) s);
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

-- ── 2. RPC-ul de aplicare a seturilor de răspunsuri ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ofertare_raspuns_set_aplica(p_set_id bigint, p_op_ids text[], p_actor uuid, p_dupa_depunere boolean DEFAULT false, p_motiv text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lic bigint; v_status text; v_prop jsonb; v_lot text; v_titlu text;
  v_rezultat jsonb; v_ids bigint[]; v_id bigint; v_op jsonb; v_c record;
  v_nou_id bigint; v_amp text; v_amp_prop text; v_text_nou text; v_sect text;
  v_aplicate jsonb := '[]'::jsonb; v_conflicte jsonb := '[]'::jsonb;
  v_nr_ordine int; v_snapshot jsonb; v_mutate int; v_dubla boolean;
  v_nr_mod int := 0; v_nr_anul int := 0; v_nr_noi int := 0; v_nr_acop int := 0;
  v_stare_loturi text; v_surse bigint[]; v_sursa_rea bigint; v_surse_ok boolean;   -- 20261026a
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  -- 0) Reluare dupa un commit al carui raspuns s-a pierdut: acelasi key, acelasi rezultat, zero scrieri.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT rezultat INTO v_rezultat FROM public.ofertare_raspuns_set
     WHERE id = p_set_id AND idempotency_key = p_idempotency_key AND rezultat IS NOT NULL;
    IF v_rezultat IS NOT NULL THEN RETURN v_rezultat || jsonb_build_object('reluare', true); END IF;
  END IF;

  IF p_op_ids IS NULL OR array_length(p_op_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'nicio operatie selectata' USING ERRCODE = '22023';
  END IF;

  -- 1) Ordinea de blocare, fixa peste tot: licitatie -> set -> cerinte (id crescator).
  SELECT licitatie_id INTO v_lic FROM public.ofertare_raspuns_set WHERE id = p_set_id;
  IF v_lic IS NULL THEN RAISE EXCEPTION 'setul % nu exista', p_set_id USING ERRCODE = 'P0002'; END IF;

  SELECT status, stare_loturi INTO v_status, v_stare_loturi FROM public.ofertare_licitatii WHERE id = v_lic FOR NO KEY UPDATE;
  -- 20261026a: garda de loturi ÎN RPC, sub blocarea licitației (FOR NO KEY UPDATE intră în conflict cu FOR UPDATE-ul
  -- setter-ului de loturi) și ÎNAINTE de orice scriere. Pe licitațiile care nu sunt fara_loturi, schimbările din seturile
  -- de răspunsuri se aplică manual (decizia Răzvan 12.10, varianta B). Triggerul a03 (20261025a) rămâne a doua barieră.
  IF v_stare_loturi IS DISTINCT FROM 'fara_loturi' THEN
    RAISE EXCEPTION 'Pe o licitație cu loturi (sau neinițializată: %), schimbările din seturile de răspunsuri se aplică manual — aplicarea automată e blocată', coalesce(v_stare_loturi, 'necunoscută')
      USING ERRCODE = '42501';
  END IF;

  SELECT propunere, lot, titlu INTO v_prop, v_lot, v_titlu
    FROM public.ofertare_raspuns_set WHERE id = p_set_id FOR UPDATE;
  IF v_prop IS NULL OR jsonb_typeof(v_prop -> 'operatii') <> 'array' THEN
    RAISE EXCEPTION 'setul % nu are propunere generata', p_set_id USING ERRCODE = 'P0002';
  END IF;

  -- 2) Whitelist de status, nu blacklist: 'incheiata' nu exista in CHECK, iar castigata/pierduta
  --    lipseau din lista negativa initiala.
  IF v_status IN ('castigata','pierduta','abandonata') THEN
    RAISE EXCEPTION 'licitatia e in starea „%" — registrul nu se mai modifica', v_status USING ERRCODE = '42501';
  ELSIF v_status = 'depusa' THEN
    IF NOT p_dupa_depunere OR btrim(coalesce(p_motiv,'')) = '' THEN
      RAISE EXCEPTION 'licitatia e depusa: aplicarea cere confirmare explicita si motiv scris' USING ERRCODE = '42501';
    END IF;
  ELSIF v_status NOT IN ('identificata','analiza','go','in_lucru') THEN
    RAISE EXCEPTION 'status neasteptat pentru aplicare: „%"', v_status USING ERRCODE = '42501';
  END IF;

  -- 3) Blocarea cerintelor vizate, o data, in ordine crescatoare de id (anti-deadlock cu
  --    fn_ofertare_acoperire_rescrie, care foloseste aceeasi ordine pe acelasi tabel).
  SELECT array_agg(DISTINCT (o ->> 'cerinta_id')::bigint ORDER BY (o ->> 'cerinta_id')::bigint)
    INTO v_ids
    FROM jsonb_array_elements(v_prop -> 'operatii') o
   WHERE o ->> 'op_id' = ANY (p_op_ids) AND o ->> 'cerinta_id' IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM 1 FROM public.ofertare_cerinte WHERE id = v_id FOR UPDATE;
    END LOOP;
  END IF;

  SELECT coalesce(max(nr_ordine), 0) INTO v_nr_ordine
    FROM public.ofertare_cerinte WHERE licitatie_id = v_lic;

  -- 4) Operatiile, in ordine stabila: intai modificarile/anularile, apoi cerintele noi.
  FOR v_op IN
    SELECT o FROM jsonb_array_elements(v_prop -> 'operatii') o
     WHERE o ->> 'op_id' = ANY (p_op_ids)
     ORDER BY CASE o ->> 'fel' WHEN 'noua' THEN 2 ELSE 1 END,
              (o ->> 'cerinta_id')::bigint NULLS LAST, o ->> 'op_id'
  LOOP
    -- Sectiunea-sursa a operatiei, daca o are; altfel titlul setului.
    v_sect := coalesce(nullif(btrim(coalesce(v_op ->> 'sursa_sectiune','')), ''), v_titlu);

    IF v_op ->> 'fel' IN ('modifica','anuleaza') THEN
      SELECT * INTO v_c FROM public.ofertare_cerinte
       WHERE id = (v_op ->> 'cerinta_id')::bigint;

      IF v_c.id IS NULL OR v_c.licitatie_id <> v_lic THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_op ->> 'cerinta_id', 'motiv', 'cerinta nu exista sau e din alta licitatie');
        CONTINUE;
      END IF;
      IF v_c.inlocuita_de IS NOT NULL OR v_c.duplicat_al IS NOT NULL THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'cerinta nu mai e activa (inlocuita sau marcata duplicat)',
          'text_curent', v_c.text_cerinta);
        CONTINUE;
      END IF;

      -- Amprenta se recalculeaza AICI, sub lock, nu la citirea de dinainte.
      SELECT amprenta INTO v_amp FROM public.fn_ofertare_cerinte_amprente(v_lic, ARRAY[v_c.id]);
      v_amp_prop := v_prop -> 'amprente' ->> (v_c.id::text);
      IF v_amp_prop IS NULL OR v_amp IS DISTINCT FROM v_amp_prop THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'cerinta s-a schimbat intre analiza si aprobare',
          'text_curent', v_c.text_cerinta);
        CONTINUE;
      END IF;

      v_text_nou := CASE WHEN v_op ->> 'fel' = 'anuleaza'
        THEN '[ANULATA prin ' || v_titlu || '] ' || v_c.text_cerinta
        ELSE btrim(coalesce(v_op ->> 'text_nou','')) END;
      IF v_text_nou = '' THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'operatia de modificare nu are text nou');
        CONTINUE;
      END IF;

      -- 20261026a: proveniența completă a cerinței scrise = sursele operației (surse_doc_ids) ∪ documentul de răspuns ∪ sursele versiunii
      -- vechi (textul nou pornește de la ea).
      -- Verificată ÎNAINTE de orice scriere pentru operație: listă nevalidă, sursă inexistentă sau din altă licitație = conflict.
      v_surse := NULL; v_sursa_rea := NULL;
      v_surse_ok := coalesce(v_op ->> 'document_id', '') ~ '^([0-9]{1,18})?$'
        AND (jsonb_typeof(v_op -> 'surse_doc_ids') IS NULL OR jsonb_typeof(v_op -> 'surse_doc_ids') = 'null'
             OR (jsonb_typeof(v_op -> 'surse_doc_ids') = 'array' AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(v_op -> 'surse_doc_ids') e WHERE coalesce(e #>> '{}', '') !~ '^[0-9]{1,18}$')));
      IF v_surse_ok THEN
        SELECT array_agg(DISTINCT s.x ORDER BY s.x) INTO v_surse FROM (
          SELECT (e #>> '{}')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_op -> 'surse_doc_ids') = 'array' THEN v_op -> 'surse_doc_ids' ELSE '[]'::jsonb END) e
          UNION SELECT nullif(v_op ->> 'document_id', '')::bigint
          UNION SELECT unnest(v_c.surse_document_ids)
          UNION SELECT v_c.sursa_document_id) s
         WHERE s.x IS NOT NULL;
        SELECT x INTO v_sursa_rea FROM unnest(v_surse) x
         WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = v_lic) LIMIT 1;
      END IF;
      IF NOT v_surse_ok OR v_sursa_rea IS NOT NULL THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id,
          'motiv', CASE WHEN NOT v_surse_ok THEN 'sursele operatiei sunt invalide (provenienta neverificabila)'
                        ELSE 'sursa #' || v_sursa_rea || ' nu exista in aceasta licitatie (provenienta neverificabila)' END);
        CONTINUE;
      END IF;

      -- Fotografia acoperirii pe versiunea VECHE, inainte de mutare. Fara ea nu s-ar mai putea
      -- afla ce dovezi si ce verificari sustineau textul vechi.
      SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb) INTO v_snapshot
        FROM public.ofertare_acoperire a WHERE a.cerinta_id = v_c.id;
      UPDATE public.ofertare_cerinte
         SET acoperire_snapshot = jsonb_build_object(
               'la', now(), 'set_id', p_set_id, 'set_titlu', v_titlu, 'acoperiri', v_snapshot),
             updated_at = now()
       WHERE id = v_c.id;

      INSERT INTO public.ofertare_cerinte (
        licitatie_id, sursa_document_id, sursa_sectiune, sursa_pagina, sursa_pasaj, pasaj_verificat,
        text_cerinta, tip, lot, document_probant, cand_se_prezinta, versiune, raspuns_set_id,
        extras_de_ai, confirmata_de, stare, stare_motiv, stare_de, stare_la, nr_ordine, surse_document_ids)
      VALUES (
        v_lic,
        nullif(v_op ->> 'document_id','')::bigint,     -- provenienta = documentul de RASPUNS, nu cel vechi
        v_sect,
        nullif(v_op ->> 'pagina','')::int,
        nullif(v_op ->> 'sursa_pasaj',''),
        false,
        v_text_nou,
        v_c.tip,
        v_c.lot,
        v_c.document_probant,                          -- la anulare dovada NU se sterge din istoric
        CASE WHEN v_op ->> 'fel' = 'modifica' AND v_op ->> 'cand_se_prezinta' IN ('duae','depunere','primul_loc')
             THEN v_op ->> 'cand_se_prezinta' ELSE v_c.cand_se_prezinta END,
        coalesce(v_c.versiune, 1) + 1,
        p_set_id,
        true,
        NULL,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN 'nu_se_aplica' ELSE v_c.stare END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza'
             THEN 'anulata prin ' || v_titlu || coalesce(' — ' || nullif(v_op ->> 'motiv',''), '')
             ELSE v_c.stare_motiv END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN p_actor ELSE v_c.stare_de END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN now() ELSE v_c.stare_la END,
        v_c.nr_ordine,                                  -- versiunea noua ramane pe locul celei vechi
        v_surse)                                        -- 20261026a: toate sursele (operație ∪ răspuns ∪ versiunea veche)
      RETURNING id INTO v_nou_id;

      UPDATE public.ofertare_cerinte SET inlocuita_de = v_nou_id, updated_at = now()
       WHERE id = v_c.id AND inlocuita_de IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'cerinta % a fost inlocuita in paralel', v_c.id USING ERRCODE = '40001';
      END IF;

      UPDATE public.ofertare_acoperire
         SET cerinta_id = v_nou_id,
             reverificare_ceruta = true,
             reverificare_motiv = 'textul cerintei s-a schimbat prin „' || v_titlu || '" (set #'
               || p_set_id || ', de la cerinta #' || v_c.id || ') — revezi dovada',
             updated_at = now()
       WHERE cerinta_id = v_c.id;
      GET DIAGNOSTICS v_mutate = ROW_COUNT;
      v_nr_acop := v_nr_acop + v_mutate;

      IF v_op ->> 'fel' = 'anuleaza' THEN v_nr_anul := v_nr_anul + 1;
      ELSE v_nr_mod := v_nr_mod + 1; END IF;
      v_aplicate := v_aplicate || jsonb_build_object('op_id', v_op ->> 'op_id', 'fel', v_op ->> 'fel',
        'cerinta_veche', v_c.id, 'cerinta_noua', v_nou_id, 'acoperiri_mutate', v_mutate,
        'surse_document_ids', to_jsonb(v_surse));

    ELSIF v_op ->> 'fel' = 'noua' THEN
      IF btrim(coalesce(v_op ->> 'text_cerinta','')) = '' THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'motiv', 'cerinta noua fara text');
        CONTINUE;
      END IF;
      -- 20261026a: proveniența completă a cerinței scrise = sursele operației (surse_doc_ids) ∪ documentul de răspuns.
      -- Verificată ÎNAINTE de orice scriere pentru operație: listă nevalidă, sursă inexistentă sau din altă licitație = conflict.
      v_surse := NULL; v_sursa_rea := NULL;
      v_surse_ok := coalesce(v_op ->> 'document_id', '') ~ '^([0-9]{1,18})?$'
        AND (jsonb_typeof(v_op -> 'surse_doc_ids') IS NULL OR jsonb_typeof(v_op -> 'surse_doc_ids') = 'null'
             OR (jsonb_typeof(v_op -> 'surse_doc_ids') = 'array' AND NOT EXISTS (
                   SELECT 1 FROM jsonb_array_elements(v_op -> 'surse_doc_ids') e WHERE coalesce(e #>> '{}', '') !~ '^[0-9]{1,18}$')));
      IF v_surse_ok THEN
        SELECT array_agg(DISTINCT s.x ORDER BY s.x) INTO v_surse FROM (
          SELECT (e #>> '{}')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_op -> 'surse_doc_ids') = 'array' THEN v_op -> 'surse_doc_ids' ELSE '[]'::jsonb END) e
          UNION SELECT nullif(v_op ->> 'document_id', '')::bigint) s
         WHERE s.x IS NOT NULL;
        SELECT x INTO v_sursa_rea FROM unnest(v_surse) x
         WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = v_lic) LIMIT 1;
      END IF;
      IF NOT v_surse_ok OR v_sursa_rea IS NOT NULL THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'motiv', CASE WHEN NOT v_surse_ok THEN 'sursele operatiei sunt invalide (provenienta neverificabila)'
                        ELSE 'sursa #' || v_sursa_rea || ' nu exista in aceasta licitatie (provenienta neverificabila)' END);
        CONTINUE;
      END IF;
      v_nr_ordine := v_nr_ordine + 1;
      v_dubla := false;
      BEGIN
        INSERT INTO public.ofertare_cerinte (
          licitatie_id, sursa_document_id, sursa_sectiune, sursa_pasaj, pasaj_verificat,
          text_cerinta, tip, lot, document_probant, cand_se_prezinta, versiune, raspuns_set_id,
          extras_de_ai, stare, nr_ordine, surse_document_ids)
        VALUES (
          v_lic,
          nullif(v_op ->> 'document_id','')::bigint,
          v_sect,
          nullif(v_op ->> 'sursa_pasaj',''),
          false,
          btrim(v_op ->> 'text_cerinta'),
          CASE WHEN v_op ->> 'tip' IN ('eliminatorie','propunere','forma','contractuala')
               THEN v_op ->> 'tip' ELSE 'propunere' END,
          coalesce(nullif(v_op ->> 'lot',''), v_lot),   -- lotul setului, nu NULL
          nullif(v_op ->> 'document_probant',''),
          CASE WHEN v_op ->> 'cand_se_prezinta' IN ('duae','depunere','primul_loc')
               THEN v_op ->> 'cand_se_prezinta' ELSE NULL END,
          1, p_set_id, true, 'de_analizat', v_nr_ordine, v_surse)
        RETURNING id INTO v_nou_id;
      EXCEPTION WHEN unique_violation THEN
        v_dubla := true;
      END;
      IF v_dubla THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'motiv', 'cerinta noua a fost deja introdusa de acest set');
        CONTINUE;
      END IF;
      v_nr_noi := v_nr_noi + 1;
      v_aplicate := v_aplicate || jsonb_build_object('op_id', v_op ->> 'op_id', 'fel', 'noua',
        'cerinta_noua', v_nou_id, 'surse_document_ids', to_jsonb(v_surse));
    ELSE
      v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
        'motiv', 'fel necunoscut: ' || coalesce(v_op ->> 'fel','(lipsa)'));
    END IF;
  END LOOP;

  v_rezultat := jsonb_build_object(
    'set_id', p_set_id, 'licitatie_id', v_lic, 'status_licitatie', v_status,
    'modificate', v_nr_mod, 'anulate', v_nr_anul, 'noi', v_nr_noi,
    'acoperiri_mutate', v_nr_acop,
    'aplicate', v_aplicate, 'conflicte', v_conflicte);

  -- Audit R04 (28.09.2026): „aplicat" = TOATE operațiile propuse au fost aplicate, cumulat peste
  -- aplicările succesive; o selecție parțială fără conflicte rămâne „aplicat_partial". Istoricul
  -- aplicărilor anterioare se păstrează în rezultat (nu mai e înlocuit de ultima).
  DECLARE v_prev jsonb; v_cumulat jsonb; v_total int; v_rest int;
  BEGIN
    SELECT rezultat INTO v_prev FROM public.ofertare_raspuns_set WHERE id = p_set_id;
    SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO v_cumulat FROM (
      SELECT jsonb_array_elements_text(coalesce(v_prev -> 'aplicate_cumulat', '[]'::jsonb)) x
      UNION SELECT e ->> 'op_id' FROM jsonb_array_elements(v_aplicate) e) q;
    SELECT count(*) INTO v_total FROM jsonb_array_elements(v_prop -> 'operatii');
    SELECT count(*) INTO v_rest FROM jsonb_array_elements(v_prop -> 'operatii') op
     WHERE NOT (v_cumulat ? (op ->> 'op_id'));
    v_rezultat := v_rezultat || jsonb_build_object(
      'aplicate_cumulat', v_cumulat, 'operatii_total', v_total, 'operatii_ramase', v_rest,
      'istoric', coalesce(v_prev -> 'istoric', '[]'::jsonb)
                 || CASE WHEN v_prev IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_prev - 'istoric') END);
  END;
  UPDATE public.ofertare_raspuns_set
     SET stare = CASE WHEN jsonb_array_length(v_conflicte) > 0 OR (v_rezultat ->> 'operatii_ramase')::int > 0
                      THEN 'aplicat_partial' ELSE 'aplicat' END,
         aplicat_la = now(), aplicat_de = p_actor,
         aplicat_dupa_depunere = (v_status = 'depusa'),
         aplicat_motiv = CASE WHEN v_status = 'depusa' THEN p_motiv ELSE aplicat_motiv END,
         status_licitatie_la_aplicare = v_status,
         idempotency_key = coalesce(p_idempotency_key, idempotency_key),
         rezultat = v_rezultat,
         updated_at = now()
   WHERE id = p_set_id;

  RETURN v_rezultat;
END
$function$;

-- ── 3b. clarificarea automată din planșe ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[]; v_nume text[]; v_motive text[]; v_acoperite bigint[]; v_draft record; v_lot int;
  v_text text; v_lista text; v_det text; v_id bigint; v_nou boolean := false; v_resp uuid; v_nr int; v_noi int;
  v_antet constant text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe';
  v_standard boolean; v_tok text; v_det_fd text; v_ilizibile int; v_fara_date int;
  v_protejat boolean; v_flag int := 0; v_tc int;
  v_gen text; v_ev text; v_tok_gen text; v_tok_ev text; v_ids_sursa text; v_sursa_noua text;
  v_ev_fara constant text := left(md5('fara_planse_de_clarificat'), 12);
  v_baza jsonb; v_baza_gen jsonb; v_financiar text;
  v_surse_doc bigint[]; v_surse_cant bigint[];   -- 20261026a
BEGIN
  SELECT count(*) INTO v_tc FROM public.v_ofertare_transfer_conflicte WHERE licitatie_id = p_licitatie_id AND deschis;
  SELECT array_agg(id ORDER BY nume_original),
         array_agg(regexp_replace(nume_original, '\.pdf$', '', 'i') ORDER BY nume_original),
         array_agg(CASE
           WHEN analiza->'plansa'->>'rezultat' = 'citita_fara_date_cantitative'
             OR eroare IN ('citită fără rezultat','citită fără date cantitative') THEN 'fara_date'
           ELSE 'ilizibil' END ORDER BY nume_original)
    INTO v_ids, v_nume, v_motive
  FROM ofertare_documente_atribuire
  WHERE licitatie_id = p_licitatie_id
    AND coalesce(analiza->'plansa'->>'rezultat','') NOT IN ('sursa_gresita_sigla','ok','partial')
    AND NOT (analiza->'plansa'->>'rezultat' IS NULL
             AND NOT coalesce((analiza->'plansa'->>'vectorial')::boolean, false)
             AND greatest(coalesce((analiza->'plansa'->>'latime')::int,0), coalesce((analiza->'plansa'->>'inaltime')::int,0)) BETWEEN 1 AND 1999)
    AND ( analiza->'plansa'->>'rezultat' IN ('ilizibil','citita_fara_date_cantitative')
          OR (analiza->'plansa'->>'citibila') = 'false'
          OR eroare IN ('citită fără rezultat','citită fără date cantitative','ilizibilă')
          OR (analiza->'plansa'->>'randare_esuata') = 'true' );
  IF v_ids IS NULL THEN
    UPDATE ofertare_clarificari c SET status = 'retrasa', updated_at = now()
     WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status = 'propunere'
       AND c.baza_generare->>'evaluare'='r9b' AND NOT (c.baza_generare ? 'reconfirmare' OR c.baza_generare ? 'text_editat_de')
       AND EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                    WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' AND substr(x.t, 5) = left(md5(coalesce(c.intrebare, '')), 12));
    WITH m AS (
      UPDATE ofertare_clarificari c SET
        sursa = coalesce((SELECT string_agg(x.t, ',' ORDER BY x.o) FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                  WHERE x.o = 1 OR x.t !~ '^ev_[0-9a-f]{12}$'), '')
                || ',ev_' || v_ev_fara
                || CASE WHEN 'revizie_planse_auto' = ANY (string_to_array(coalesce(c.sursa, ''), ',')) THEN '' ELSE ',revizie_planse_auto' END,
        updated_at = now()
       WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
         AND NOT (('ev_' || v_ev_fara) = ANY (string_to_array(coalesce(c.sursa, ''), ',')))
      RETURNING c.id)
    SELECT count(*) INTO v_flag FROM m;
    RETURN jsonb_build_object('actiune','nimic', 'de_revizuit', v_flag, 'transfer_conflicte_deschise', v_tc);
  END IF;
  SELECT coalesce(array_agg(x::bigint), '{}') INTO v_acoperite
  FROM ofertare_clarificari c, unnest(string_to_array(replace(c.sursa, 'planse_auto:', ''), ',')) x
  WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%'
    AND c.status NOT IN ('propunere','de_trimis') AND x ~ '^\d+$';
  SELECT array_agg(i), array_agg(n), array_agg(m) INTO v_ids, v_nume, v_motive
  FROM unnest(v_ids, v_nume, v_motive) AS t(i, n, m) WHERE NOT (i = ANY(v_acoperite));
  IF v_ids IS NULL THEN RETURN jsonb_build_object('actiune','deja_trimise', 'transfer_conflicte_deschise', v_tc); END IF;
  SELECT string_agg('documentul #' || d.id || ' „' || d.nume_original || '”', '; ' ORDER BY d.id) INTO v_financiar
    FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id=p_licitatie_id AND d.tip='lista_cantitati';
  v_baza := public.ofertare_f3_baza(p_licitatie_id);
  -- 20261026a: proveniența textului, scrisă ODATĂ cu el (nu dedusă ulterior): planșele citate, documentele financiare citate
  -- în punctul 2 (tip lista_cantitati — exact cele din v_financiar), documentele și rândurile de cantități din baza F3.
  SELECT array_agg(DISTINCT s.x ORDER BY s.x) INTO v_surse_doc FROM (
    SELECT unnest(v_ids) AS x
    UNION SELECT d.id FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = p_licitatie_id AND d.tip = 'lista_cantitati'
    UNION SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_baza->'documente') = 'array'
                                                            THEN v_baza->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$') s WHERE s.x IS NOT NULL;
  SELECT array_agg(DISTINCT (e->>'id')::bigint ORDER BY (e->>'id')::bigint) INTO v_surse_cant
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_baza->'randuri') = 'array' THEN v_baza->'randuri' ELSE '[]'::jsonb END) e
   WHERE e->>'id' ~ '^[0-9]{1,18}$';
  v_baza_gen := v_baza || jsonb_build_object('la', now(), 'sursa_generare', 'v6-r9b');
  v_lista := array_to_string(v_nume, ', ');
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det, v_ilizibile FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'ilizibil';
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det_fd, v_fara_date FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'fara_date';
  v_text := v_antet || E'\n\n' ||
    CASE WHEN v_ilizibile > 0 THEN
      'În documentația de atribuire, următoarele planșe nu au putut fi citite (textul — cote, lungimi, diametre, materiale, notări de tronsoane — nu este lizibil sau fișierul nu poate fi deschis):' || E'\n' || v_det || E'\n\n'
    ELSE '' END ||
    CASE WHEN v_fara_date > 0 THEN
      'Pentru următoarele planșe, în lectura efectuată nu au fost identificate date cantitative (lungimi, diametre, tronsoane):' || E'\n' || v_det_fd || E'\n\n'
    ELSE '' END ||
    'Pentru fundamentarea corectă a ofertei, vă rugăm să ne comunicați, pentru planșele de mai sus:' || E'\n' ||
    '1. Lista tronsoanelor: denumire/capete tronson, lungime (m), diametru nominal, material și SDR, mod de pozare, subtraversări/traversări;' || E'\n' ||
    '2. Vă rugăm să precizați corespondența dintre pozițiile din ' || coalesce(v_financiar,'documentul financiar aplicabil (vă rugăm să îl identificați)') || ' și tronsoanele din planșele identificate mai sus, pentru obiectele / loturile / etapele aferente, precum și modul de tratare a neclarităților descrise. Vă rugăm să indicați paginile, pozițiile și reperele corespunzătoare;' ||
    CASE WHEN v_ilizibile > 0 THEN E'\n' || '3. Ca alternativă, pentru planșele care nu au putut fi citite, varianta în format editabil (DWG/DXF) sau PDF cu text selectabil.' ELSE '' END ||
    E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';
  v_baza_gen := v_baza_gen || jsonb_build_object('text_hash',md5(v_text));
  v_gen := left(md5(v_text), 12);
  v_ev := left(md5(array_to_string(v_ids, ',') || '|' || array_to_string(v_motive, ',')), 12);
  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT string_agg(x.t, ',' ORDER BY x.o) INTO v_ids_sursa
      FROM unnest(string_to_array(replace(coalesce(v_draft.sursa, ''), 'planse_auto:', ''), ',')) WITH ORDINALITY AS x(t, o) WHERE x.t ~ '^\d+$';
    SELECT substr(x.t, 5) INTO v_tok_gen FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    SELECT substr(x.t, 4) INTO v_tok_ev FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^ev_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    v_standard := CASE WHEN v_draft.baza_generare->>'evaluare' = 'r9b' AND v_tok_gen IS NOT NULL THEN left(md5(coalesce(v_draft.intrebare, '')), 12) = v_tok_gen
                       ELSE false END;
    v_protejat := NOT v_standard OR v_draft.status = 'de_trimis' OR v_draft.baza_generare ? 'reconfirmare' OR v_draft.baza_generare ? 'text_editat_de';
    SELECT coalesce(string_agg(',' || t, '' ORDER BY o), '') INTO v_tok
      FROM unnest(string_to_array(v_draft.sursa, ',')) WITH ORDINALITY AS x(t, o) WHERE o > 1 AND t ~ '^revizie_[a-z0-9_]+$';
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    IF v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND (v_tok_ev IS NULL OR v_tok_ev = v_ev) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard, 'transfer_conflicte_deschise', v_tc);
    END IF;
    IF NOT v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND v_draft.intrebare = v_text
       AND v_tok_gen IS NOT DISTINCT FROM v_gen THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', false, 'baza_actualizata', false,
        'transfer_conflicte_deschise', v_tc, 'f3_baza', v_baza - 'randuri');
    END IF;
    IF v_protejat THEN
      v_flag := CASE WHEN v_tok_ev IS NOT DISTINCT FROM v_ev THEN 0 ELSE 1 END;
      SELECT 'planse_auto:' || array_to_string(v_ids, ',') || coalesce(string_agg(',' || x.t, '' ORDER BY x.o), '') INTO v_sursa_noua
        FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
       WHERE x.o > 1 AND x.t !~ '^\d+$' AND x.t !~ '^ev_[0-9a-f]{12}$' AND (v_flag = 0 OR x.t <> 'revizie_planse_auto');
      v_sursa_noua := v_sursa_noua || ',ev_' || v_ev || CASE WHEN v_flag = 1 THEN ',revizie_planse_auto' ELSE '' END;
      UPDATE ofertare_clarificari SET sursa = v_sursa_noua, updated_at = now()
        WHERE id = v_draft.id AND sursa IS DISTINCT FROM v_sursa_noua;
      RETURN jsonb_build_object('actiune','protejat_de_revizuit','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard,
        'status', v_draft.status, 'marcat_acum', v_flag = 1, 'transfer_conflicte_deschise', v_tc);
    END IF;
    UPDATE ofertare_clarificari SET
      intrebare = v_text,
      sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok || ',gen_' || v_gen || ',ev_' || v_ev,
      baza_generare = v_baza_gen,
      surse_document_ids = v_surse_doc, surse_cantitati_ids = v_surse_cant,   -- 20261026a (triggerul face reuniunea cu cele vechi)
      status = 'propunere', updated_at = now()
      WHERE id = v_draft.id AND status = 'propunere' AND intrebare IS NOT DISTINCT FROM v_draft.intrebare;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('actiune','neschimbat_concurent','id',v_draft.id,'planse',cardinality(v_ids), 'transfer_conflicte_deschise', v_tc);
    END IF;
    v_id := v_draft.id; v_nou := v_noi > 0;
  ELSE
    SELECT count(*) + 1 INTO v_lot FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id AND cheie LIKE 'auto_planse_%';
    SELECT coalesce(max(nr), 0) + 1 INTO v_nr FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id;
    INSERT INTO ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare,
                                      surse_document_ids, surse_cantitati_ids)   -- 20261026a
      VALUES (p_licitatie_id, v_nr, v_text, 'planse_auto:' || array_to_string(v_ids, ',') || ',gen_' || v_gen || ',ev_' || v_ev, 'propunere', 'automat', 'auto_planse_' || v_lot, v_baza_gen,
              v_surse_doc, v_surse_cant)
      ON CONFLICT (licitatie_id, cheie) DO NOTHING RETURNING id INTO v_id;
    v_nou := v_id IS NOT NULL;
  END IF;
  IF v_nou THEN
    SELECT responsabil_id INTO v_resp FROM ofertare_licitatii WHERE id = p_licitatie_id;
    IF v_resp IS NOT NULL THEN
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_resp, 'info', 'Ofertare', '💭 Propunere de clarificare (planșe)',
        'Licitația #' || p_licitatie_id || ': ' || cardinality(v_ids) || ' planșe fără date extrase (' || left(v_lista, 160) ||
        '). Verifică dacă datele nu sunt în memoriu/F3, apoi confirmă motivul în Clarificări. NU s-a trimis nimic.',
        '/ofertare');
    END IF;
  END IF;
  RETURN jsonb_build_object('actiune', CASE WHEN v_draft.id IS NOT NULL THEN 'actualizat' ELSE 'creat' END, 'id', v_id,
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'transfer_conflicte_deschise', v_tc,
    'f3_baza', v_baza - 'randuri');
END $function$;

-- ── postcondiții + garda de livrare (final) ─────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_cerinte'
                   AND column_name = 'surse_document_ids' AND data_type = 'ARRAY') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: ofertare_cerinte.surse_document_ids lipsește';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_cerinte WHERE surse_document_ids IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: datele existente trebuie să rămână fără surse (fără backfill)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a02_ofertare_cerinte_surse'
                   AND tgrelid = 'public.ofertare_cerinte'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a03_ofertare_raspuns_set_garda_loturi') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: triggerul de validare pe cerințe sau garda a03 lipsește';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ofertare_clarificare_planse_auto(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_surse_valideaza()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: o funcție a devenit expusă';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'dbdb69615d0ddd277cba30e0278d477d'
                    AND NOT p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: fn_ofertare_raspuns_set_aplica nou nu are corpul / atributele așteptate (md5 dbdb6961…)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_clarificare_planse_auto(bigint)')
                    AND md5(replace(p.prosrc, chr(13), '')) = '8016fbf6b5d47a049ab73d9200122fc1'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: ofertare_clarificare_planse_auto nou nu are corpul / atributele așteptate (md5 8016fbf6…)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ofertare_surse_valideaza()')
                    AND md5(replace(p.prosrc, chr(13), '')) = '03b3a62bf2b4bdce1378e75397179099'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Postcondiție 20261026a: fn_ofertare_surse_valideaza nou nu are corpul / atributele așteptate (md5 03b3a62b…)';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261026a_ofertare_rigoare_provenienta:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261026a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$post$;
