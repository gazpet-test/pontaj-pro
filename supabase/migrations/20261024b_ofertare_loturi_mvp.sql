-- 20261024b: loturile licitației + starea pe document + poarta unică „document eligibil” (MVP loturi, etapele 1+2).
-- Decizii: claude_docs propunere_loturi_ofertare (review Jakarinos NO-GO / Copilot GO cu ajustări, 12.10.2026),
-- „da MVP” Răzvan 12.10 prin chat; Răzvan 12.10 în sesiunea Ofertare: neinițializat = BLOCAT (fail-closed, un click
-- deblochează), trierea = owner + responsabilul licitației + admin Ofertare (același cerc ca fn_ofertare_source_pack_poate_decide).
--
-- Ce face (doar schemă, NICIO dată atinsă; codul care cheamă poarta vine separat, deci comportamentul nu se schimbă la apply):
--   1. ofertare_licitatii.stare_loturi: neinitializat (implicit, toate cele existente) / fara_loturi / are_loturi.
--   2. ofertare_licitatie_loturi: loturile licitației (nr, denumire, valoare, participam) — model normalizat, nu jsonb.
--   3. ofertare_documente_atribuire.lot_stare: necunoscut (implicit) / comun / alocat + proveniență (sursă, autor, dată, notă).
--      ofertare_document_loturi: legătura document → lot, cu FK compus (licitație, nr) = integritate referențială.
--   4. ofertare_loturi_jurnal: istoricul fiecărei schimbări (vechi/nou, cine, când).
--   5. Scrierea stărilor DOAR prin RPC (fn_ofertare_licitatie_loturi_seteaza / fn_ofertare_documente_lot_seteaza), cu
--      verificare de rol în funcție; triggerele de gardă refuză orice scriere directă (inclusiv service_role).
--   6. Poarta unică: fn_ofertare_eligibilitate(licitație, doc?) — sursa ÎNTREGII logici; fn_ofertare_document_eligibil(doc)
--      e doar un filtru peste ea. Fail-closed: orice stare neprevăzută = neeligibil. Fără excepții (nici fișa de date).
--   7. v_ofertare_loturi_triere (security_invoker): numărătoarea procesate / în afara loturilor / de triat pe licitație.
--   8. Etapa 2 (doar coloane, fără backfill): lot_nr int[] + lot_domeniu + lot_sursa + lot_brut pe ofertare_cerinte și
--      ofertare_cantitati, validat de trigger față de loturile licitației; fn_ofertare_parse_lot(text) = parsarea canonică
--      („Lot 12” → {12}, necunoscut ≠ toate). Review Copilot r1 (NO-GO, 12.10) integrat: fără bootstrap, CHECK strict,
--      coerență lot canonic, valoare nenumerică refuzată, document triat nu se mută între licitații, interval max 50.
--      Review Copilot r2 (NO-GO, 12.10) integrat: lock FOR KEY SHARE pe licitație în triggerul lotului canonic (cursa
--      setter vs. scriere lot_nr), regresie cu două tranzacții paralele în harness.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261024b_ofertare_loturi_mvp_ROLLBACK.sql (arhivează clasificarea + jurnalul în
-- ofertare_loturi_arhiva_revenire înainte de drop, deci nimic din triere nu se pierde).
DO $migrare$
DECLARE
  v_n int;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261024b_ofertare_loturi_mvp:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261024b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF to_regclass('public.ofertare_licitatii') IS NULL OR to_regclass('public.ofertare_documente_atribuire') IS NULL
     OR to_regclass('public.ofertare_cerinte') IS NULL OR to_regclass('public.ofertare_cantitati') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261024b: lipsește una din tabelele ofertare_licitatii / documente_atribuire / cerinte / cantitati';
  END IF;
  IF to_regclass('public.ofertare_licitatie_loturi') IS NOT NULL OR to_regclass('public.ofertare_document_loturi') IS NOT NULL
     OR to_regclass('public.ofertare_loturi_jurnal') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 20261024b: tabelele de loturi există deja (reaplicare?)';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'ofertare_licitatii' AND column_name = 'stare_loturi')
       OR (table_name = 'ofertare_documente_atribuire' AND column_name LIKE 'lot\_%')
       OR (table_name IN ('ofertare_cerinte', 'ofertare_cantitati') AND column_name IN ('lot_nr', 'lot_domeniu', 'lot_sursa', 'lot_brut')));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Precondiție 20261024b: % coloane de lot există deja', v_n;
  END IF;
  IF to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)') IS NULL
     OR to_regprocedure('public.fn_are_acces_ofertare()') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 20261024b: lipsesc funcțiile de acces (fn_ofertare_source_pack_poate_decide / fn_are_acces_ofertare)';
  END IF;

  -- ── 1. starea loturilor pe licitație ──────────────────────────────────────────────────────────────────
  ALTER TABLE public.ofertare_licitatii
    ADD COLUMN stare_loturi text NOT NULL DEFAULT 'neinitializat'
      CONSTRAINT ofertare_licitatii_stare_loturi_check CHECK (stare_loturi IN ('neinitializat', 'fara_loturi', 'are_loturi')),
    ADD COLUMN stare_loturi_setat_de uuid,
    ADD COLUMN stare_loturi_setat_la timestamptz;

  -- ── 2. loturile licitației ────────────────────────────────────────────────────────────────────────────
  CREATE TABLE public.ofertare_licitatie_loturi (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
    nr           integer NOT NULL CHECK (nr BETWEEN 1 AND 999),
    denumire     text,
    valoare      numeric CHECK (valoare IS NULL OR valoare >= 0),
    participam   boolean NOT NULL DEFAULT false,
    setat_de     uuid,
    setat_la     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ofertare_licitatie_loturi_nr_uq UNIQUE (licitatie_id, nr)
  );

  -- ── 3. starea pe document + legătura document → lot ───────────────────────────────────────────────────
  ALTER TABLE public.ofertare_documente_atribuire
    ADD COLUMN lot_stare text NOT NULL DEFAULT 'necunoscut'
      CONSTRAINT ofertare_documente_lot_stare_check CHECK (lot_stare IN ('necunoscut', 'comun', 'alocat')),
    ADD COLUMN lot_sursa text
      CONSTRAINT ofertare_documente_lot_sursa_check CHECK (lot_sursa IS NULL OR lot_sursa IN ('manual', 'regula', 'ai', 'import')),
    ADD COLUMN lot_setat_de uuid,
    ADD COLUMN lot_setat_la timestamptz,
    ADD COLUMN lot_nota text;

  CREATE TABLE public.ofertare_document_loturi (
    document_id  bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
    licitatie_id bigint NOT NULL,
    lot_nr       integer NOT NULL,
    PRIMARY KEY (document_id, lot_nr),
    CONSTRAINT ofertare_document_loturi_lot_fk FOREIGN KEY (licitatie_id, lot_nr)
      REFERENCES public.ofertare_licitatie_loturi(licitatie_id, nr) ON DELETE RESTRICT
  );
  CREATE INDEX ofertare_document_loturi_lic_idx ON public.ofertare_document_loturi (licitatie_id, lot_nr);

  -- ── 4. jurnal ─────────────────────────────────────────────────────────────────────────────────────────
  CREATE TABLE public.ofertare_loturi_jurnal (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    licitatie_id bigint NOT NULL,
    document_id  bigint,
    actiune      text NOT NULL CHECK (actiune IN ('licitatie_loturi', 'document_lot')),
    vechi        jsonb,
    nou          jsonb,
    de           uuid,
    la           timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ofertare_loturi_jurnal_lic_idx ON public.ofertare_loturi_jurnal (licitatie_id, la DESC);

  -- ── 8. etapa 2: lotul canonic pe cerință / cantitate (coloane goale, fără backfill) ───────────────────
  ALTER TABLE public.ofertare_cerinte
    ADD COLUMN lot_nr integer[],
    ADD COLUMN lot_domeniu text CONSTRAINT ofertare_cerinte_lot_domeniu_check
      CHECK (lot_domeniu IS NULL OR lot_domeniu IN ('toate', 'lista', 'necunoscut')),
    ADD COLUMN lot_sursa text,
    ADD COLUMN lot_brut text,
    ADD CONSTRAINT ofertare_cerinte_lot_nr_coerent CHECK (CASE  -- CASE: mereu true/false, niciodată NULL (un CHECK NULL trece)
      WHEN lot_domeniu IS NULL THEN lot_nr IS NULL
      WHEN lot_domeniu = 'lista' THEN coalesce(cardinality(lot_nr), 0) > 0
      ELSE lot_nr IS NULL END);
  ALTER TABLE public.ofertare_cantitati
    ADD COLUMN lot_nr integer[],
    ADD COLUMN lot_domeniu text CONSTRAINT ofertare_cantitati_lot_domeniu_check
      CHECK (lot_domeniu IS NULL OR lot_domeniu IN ('toate', 'lista', 'necunoscut')),
    ADD COLUMN lot_sursa text,
    ADD COLUMN lot_brut text,
    ADD CONSTRAINT ofertare_cantitati_lot_nr_coerent CHECK (CASE  -- CASE: mereu true/false, niciodată NULL (un CHECK NULL trece)
      WHEN lot_domeniu IS NULL THEN lot_nr IS NULL
      WHEN lot_domeniu = 'lista' THEN coalesce(cardinality(lot_nr), 0) > 0
      ELSE lot_nr IS NULL END);

  -- ── RLS + GRANT pe tabelele noi: citire = acces Ofertare; scriere directă = nimeni (doar RPC) ──────────
  ALTER TABLE public.ofertare_licitatie_loturi ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.ofertare_document_loturi  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.ofertare_loturi_jurnal    ENABLE ROW LEVEL SECURITY;
  CREATE POLICY ofertare_licitatie_loturi_select ON public.ofertare_licitatie_loturi FOR SELECT TO authenticated
    USING ((SELECT public.fn_are_acces_ofertare()));
  CREATE POLICY ofertare_document_loturi_select ON public.ofertare_document_loturi FOR SELECT TO authenticated
    USING ((SELECT public.fn_are_acces_ofertare()));
  CREATE POLICY ofertare_loturi_jurnal_select ON public.ofertare_loturi_jurnal FOR SELECT TO authenticated
    USING ((SELECT public.fn_are_acces_ofertare()));
  REVOKE ALL ON public.ofertare_licitatie_loturi, public.ofertare_document_loturi, public.ofertare_loturi_jurnal
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON public.ofertare_licitatie_loturi, public.ofertare_document_loturi, public.ofertare_loturi_jurnal
    TO authenticated, service_role;
END
$migrare$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Funcții (în afara blocului DO ca să rămână lizibile; tot în tranzacția runner-ului).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════

-- Gardă: lotul pe document / starea pe licitație se schimbă DOAR din RPC-urile de mai jos (flag legat de txid)
-- sau de postgres (migrare / admin). Refuză scrierea directă, inclusiv din service_role și din INSERT-uri
-- (un import nu poate naște un document deja „comun”).
CREATE FUNCTION public.fn_trg_ofertare_loturi_garda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rpc boolean := current_setting('gazpet.ofertare_loturi_rpc', true) IS NOT DISTINCT FROM ('rpc:' || txid_current());
BEGIN
  -- Integritate (pentru toți, inclusiv postgres): un document triat nu se mută în altă licitație.
  -- (IF-uri imbricate: PL/pgSQL nu garantează scurtcircuitarea lui AND, iar ofertare_licitatii nu are licitatie_id.)
  IF TG_TABLE_NAME = 'ofertare_documente_atribuire' AND TG_OP = 'UPDATE' THEN
    IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id
       AND (OLD.lot_stare <> 'necunoscut' OR EXISTS (SELECT 1 FROM public.ofertare_document_loturi dl WHERE dl.document_id = OLD.id)) THEN
      RAISE EXCEPTION 'Documentul % e triat pe loturi — întâi se resetează trierea, apoi se mută', OLD.id USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_rpc OR session_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'ofertare_documente_atribuire' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.lot_stare <> 'necunoscut' OR NEW.lot_sursa IS NOT NULL OR NEW.lot_setat_de IS NOT NULL
         OR NEW.lot_setat_la IS NOT NULL OR NEW.lot_nota IS NOT NULL THEN
        RAISE EXCEPTION 'Lotul documentului se setează doar din trierea pe loturi (RPC)' USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.lot_stare, NEW.lot_sursa, NEW.lot_setat_de, NEW.lot_setat_la, NEW.lot_nota)
          IS DISTINCT FROM (OLD.lot_stare, OLD.lot_sursa, OLD.lot_setat_de, OLD.lot_setat_la, OLD.lot_nota) THEN
      RAISE EXCEPTION 'Lotul documentului se setează doar din trierea pe loturi (RPC)' USING ERRCODE = '42501';
    END IF;
  ELSE -- ofertare_licitatii
    IF TG_OP = 'INSERT' THEN
      IF NEW.stare_loturi <> 'neinitializat' OR NEW.stare_loturi_setat_de IS NOT NULL OR NEW.stare_loturi_setat_la IS NOT NULL THEN
        RAISE EXCEPTION 'Starea loturilor se setează doar din RPC-ul de loturi' USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.stare_loturi, NEW.stare_loturi_setat_de, NEW.stare_loturi_setat_la)
          IS DISTINCT FROM (OLD.stare_loturi, OLD.stare_loturi_setat_de, OLD.stare_loturi_setat_la) THEN
      RAISE EXCEPTION 'Starea loturilor se setează doar din RPC-ul de loturi' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_loturi_garda() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER a01_ofertare_doc_lot_garda BEFORE INSERT OR UPDATE ON public.ofertare_documente_atribuire
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_loturi_garda();
CREATE TRIGGER a01_ofertare_licitatii_loturi_garda BEFORE INSERT OR UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_loturi_garda();

-- Marcajul „scriere din RPC-ul de loturi”, legat de txid. Separat și NEEXPUS (EXECUTE revocat de la toți rolurile API):
-- gate-ul permanent 0e refuză set_config în orice funcție expusă către anon/authenticated.
CREATE FUNCTION public.fn_ofertare_loturi_rpc_marcaj(p_activ boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('gazpet.ofertare_loturi_rpc', CASE WHEN p_activ THEN 'rpc:' || txid_current() ELSE '' END, true);
END $$;
REVOKE ALL ON FUNCTION public.fn_ofertare_loturi_rpc_marcaj(boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Legătura document → lot trebuie să rămână în aceeași licitație ca documentul.
CREATE FUNCTION public.fn_trg_ofertare_document_loturi_coerent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = NEW.document_id AND d.licitatie_id = NEW.licitatie_id) THEN
    RAISE EXCEPTION 'Documentul % nu aparține licitației %', NEW.document_id, NEW.licitatie_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_document_loturi_coerent() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_ofertare_document_loturi_coerent BEFORE INSERT OR UPDATE ON public.ofertare_document_loturi
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_document_loturi_coerent();

-- Lotul canonic pe cerință / cantitate: lista se normalizează (sortată, fără duplicate) și se verifică față de loturile
-- licitației. Un element inexistent / NULL / < 1 NU se acceptă ca listă: rândul devine „necunoscut” (fail-closed),
-- cu lot_sursa = 'invalidat_lot_inexistent' și lot_brut păstrat — explicit, vizibil în UI, nu o conversie tăcută.
-- (Review Copilot r1: preferă FK; aici lotul poate fi citit din text înainte să existe loturile, deci validarea
-- se face la scriere, iar scoaterea unui lot referit e refuzată în fn_ofertare_licitatie_loturi_seteaza.)
CREATE FUNCTION public.fn_trg_ofertare_lot_canonic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NEW.lot_domeniu IS DISTINCT FROM 'lista' THEN
    RETURN NEW;
  END IF;
  -- Serializare cu fn_ofertare_licitatie_loturi_seteaza (review Copilot r2, cursă TOCTOU): setter-ul ia FOR UPDATE pe
  -- licitație; aici FOR KEY SHARE (intră în conflict cu FOR UPDATE, nu blochează UPDATE-urile obișnuite pe licitație).
  -- Setter întâi → scrierea așteaptă și vede lotul scos (necunoscut); scrierea întâi → setter-ul așteaptă și refuză.
  -- Validarea de mai jos e instrucțiune separată, deci în READ COMMITTED vede starea de după lock.
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = NEW.licitatie_id FOR KEY SHARE;
  SELECT coalesce(cardinality(NEW.lot_nr), 0) > 0
     AND NOT EXISTS (SELECT 1 FROM unnest(NEW.lot_nr) x WHERE x IS NULL OR x < 1
                       OR NOT EXISTS (SELECT 1 FROM public.ofertare_licitatie_loturi l WHERE l.licitatie_id = NEW.licitatie_id AND l.nr = x))
    INTO v_ok;
  IF v_ok THEN
    NEW.lot_nr := ARRAY(SELECT DISTINCT x FROM unnest(NEW.lot_nr) x ORDER BY x);
  ELSE
    NEW.lot_domeniu := 'necunoscut';
    NEW.lot_nr := NULL;
    NEW.lot_sursa := 'invalidat_lot_inexistent';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_lot_canonic() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER a01_ofertare_cerinte_lot_canonic BEFORE INSERT OR UPDATE OF lot_domeniu, lot_nr, licitatie_id ON public.ofertare_cerinte
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_lot_canonic();
CREATE TRIGGER a01_ofertare_cantitati_lot_canonic BEFORE INSERT OR UPDATE OF lot_domeniu, lot_nr, licitatie_id ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_lot_canonic();

-- ── Poarta unică ─────────────────────────────────────────────────────────────────────────────────────────
-- Motive (stabile, folosite de cod și UI): fara_loturi, comun, lot_participam → eligibil;
-- loturi_neinitializate, nicio_participare, de_triat, in_afara_loturilor, stare_invalida → neeligibil.
-- Fără excepții (review Copilot 12.10, NO-GO r1): nici fișa de date nu trece pe licitație neinițializată — `tip` e
-- modificabil direct, deci o excepție pe tip ar fi o ocolire. Loturile se aleg manual (un click) înainte de orice cost.
CREATE FUNCTION public.fn_ofertare_eligibilitate(p_licitatie_id bigint, p_document_id bigint DEFAULT NULL)
RETURNS TABLE (document_id bigint, eligibil boolean, motiv text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH l AS (
    SELECT li.id, li.stare_loturi,
           EXISTS (SELECT 1 FROM public.ofertare_licitatie_loturi x WHERE x.licitatie_id = li.id AND x.participam) AS are_participare
      FROM public.ofertare_licitatii li WHERE li.id = p_licitatie_id
  ), d AS (
    SELECT doc.id, doc.lot_stare,
           EXISTS (SELECT 1 FROM public.ofertare_document_loturi dl WHERE dl.document_id = doc.id) AS are_lot,
           EXISTS (SELECT 1 FROM public.ofertare_document_loturi dl
                     JOIN public.ofertare_licitatie_loturi x ON x.licitatie_id = dl.licitatie_id AND x.nr = dl.lot_nr
                    WHERE dl.document_id = doc.id AND x.participam) AS are_lot_participat
      FROM public.ofertare_documente_atribuire doc
     WHERE doc.licitatie_id = p_licitatie_id AND (p_document_id IS NULL OR doc.id = p_document_id)
  ), r AS (
    SELECT d.id,
           CASE
             WHEN l.stare_loturi = 'neinitializat'             THEN 'loturi_neinitializate'
             WHEN l.stare_loturi = 'fara_loturi'               THEN 'fara_loturi'
             WHEN l.stare_loturi <> 'are_loturi'               THEN 'stare_invalida'
             WHEN NOT l.are_participare                        THEN 'nicio_participare'
             WHEN d.lot_stare = 'necunoscut'                   THEN 'de_triat'
             WHEN d.lot_stare = 'comun'                        THEN 'comun'
             WHEN d.lot_stare = 'alocat' AND d.are_lot_participat THEN 'lot_participam'
             WHEN d.lot_stare = 'alocat' AND d.are_lot        THEN 'in_afara_loturilor'
             ELSE 'stare_invalida'
           END AS motiv
      FROM d CROSS JOIN l
  )
  SELECT r.id, r.motiv IN ('fara_loturi', 'comun', 'lot_participam'), r.motiv FROM r
$$;
REVOKE ALL ON FUNCTION public.fn_ofertare_eligibilitate(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_eligibilitate(bigint, bigint) TO authenticated, service_role;

-- Un document: {eligibil, motiv, licitatie_id}. Document inexistent = neeligibil (fail-closed), nu eroare.
CREATE FUNCTION public.fn_ofertare_document_eligibil(p_document_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('eligibil', e.eligibil, 'motiv', e.motiv, 'licitatie_id', doc.licitatie_id)
       FROM public.ofertare_documente_atribuire doc
       CROSS JOIN LATERAL public.fn_ofertare_eligibilitate(doc.licitatie_id, doc.id) e
      WHERE doc.id = p_document_id),
    jsonb_build_object('eligibil', false, 'motiv', 'document_inexistent', 'licitatie_id', NULL))
$$;
REVOKE ALL ON FUNCTION public.fn_ofertare_document_eligibil(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_document_eligibil(bigint) TO authenticated, service_role;

-- ── Setare loturi pe licitație ───────────────────────────────────────────────────────────────────────────
-- p_loturi (doar pentru are_loturi): [{"nr":2,"denumire":"…","valoare":123.4,"participam":true}, …].
-- Lotul eliminat din listă se șterge doar dacă nu are documente alocate (FK RESTRICT → eroare clară).
-- Trecerea din are_loturi în altă stare e refuzată cât există documente „alocat” (întâi se resetează trierea).
CREATE FUNCTION public.fn_ofertare_licitatie_loturi_seteaza(p_licitatie_id bigint, p_stare text, p_loturi jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vechi jsonb;
  v_el jsonb;
  v_nr int;
  v_nrs int[] := '{}';
  v_n int;
BEGIN
  IF v_uid IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare setează loturile' USING ERRCODE = '42501';
  END IF;
  IF p_stare NOT IN ('neinitializat', 'fara_loturi', 'are_loturi') THEN
    RAISE EXCEPTION 'Stare loturi invalidă: %', p_stare USING ERRCODE = '22023';
  END IF;
  p_loturi := coalesce(p_loturi, '[]'::jsonb);
  IF jsonb_typeof(p_loturi) <> 'array' THEN
    RAISE EXCEPTION 'p_loturi trebuie să fie listă' USING ERRCODE = '22023';
  END IF;
  IF p_stare = 'are_loturi' AND jsonb_array_length(p_loturi) = 0 THEN
    RAISE EXCEPTION 'are_loturi cere cel puțin un lot' USING ERRCODE = '22023';
  END IF;
  IF p_stare <> 'are_loturi' AND jsonb_array_length(p_loturi) > 0 THEN
    RAISE EXCEPTION 'Lista de loturi se trimite doar cu are_loturi' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('stare', li.stare_loturi,
           'loturi', coalesce((SELECT jsonb_agg(jsonb_build_object('nr', x.nr, 'denumire', x.denumire, 'valoare', x.valoare, 'participam', x.participam) ORDER BY x.nr)
                                 FROM public.ofertare_licitatie_loturi x WHERE x.licitatie_id = li.id), '[]'::jsonb))
    INTO v_vechi FROM public.ofertare_licitatii li WHERE li.id = p_licitatie_id FOR UPDATE;
  IF v_vechi IS NULL THEN
    RAISE EXCEPTION 'Licitația % nu există', p_licitatie_id USING ERRCODE = 'P0002';
  END IF;

  IF p_stare <> 'are_loturi' THEN
    SELECT count(*) INTO v_n FROM public.ofertare_documente_atribuire WHERE licitatie_id = p_licitatie_id AND lot_stare = 'alocat';
    IF v_n > 0 THEN
      RAISE EXCEPTION 'Licitația are % documente alocate pe loturi — întâi se resetează trierea', v_n USING ERRCODE = '55000';
    END IF;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_loturi) LOOP
    IF jsonb_typeof(v_el) <> 'object' OR jsonb_typeof(v_el->'nr') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Fiecare lot cere „nr” numeric: %', v_el USING ERRCODE = '22023';
    END IF;
    v_nr := (v_el->>'nr')::numeric::int;
    IF v_nr::numeric <> (v_el->>'nr')::numeric OR v_nr < 1 OR v_nr > 999 THEN
      RAISE EXCEPTION 'Număr de lot invalid: %', v_el->>'nr' USING ERRCODE = '22023';
    END IF;
    IF v_nr = ANY (v_nrs) THEN
      RAISE EXCEPTION 'Lotul % apare de două ori', v_nr USING ERRCODE = '22023';
    END IF;
    IF v_el ? 'valoare' AND jsonb_typeof(v_el->'valoare') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'valoare trebuie să fie număr la lotul %', v_nr USING ERRCODE = '22023';
    END IF;
    IF v_el ? 'valoare' AND jsonb_typeof(v_el->'valoare') = 'number' AND (v_el->>'valoare')::numeric < 0 THEN
      RAISE EXCEPTION 'valoare negativă la lotul %', v_nr USING ERRCODE = '22023';
    END IF;
    IF v_el ? 'participam' AND jsonb_typeof(v_el->'participam') <> 'boolean' THEN
      RAISE EXCEPTION 'participam trebuie să fie true/false la lotul %', v_nr USING ERRCODE = '22023';
    END IF;
    v_nrs := v_nrs || v_nr;
  END LOOP;

  -- Un lot scos din listă nu poate rămâne referit de cerințe / cantități (lot_nr canonic) — echivalentul FK RESTRICT.
  SELECT count(*) INTO v_n FROM (
    SELECT unnest(c.lot_nr) AS nr FROM public.ofertare_cerinte c WHERE c.licitatie_id = p_licitatie_id AND c.lot_nr IS NOT NULL
    UNION ALL
    SELECT unnest(q.lot_nr) FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id AND q.lot_nr IS NOT NULL
  ) r WHERE NOT (r.nr = ANY (v_nrs));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Loturile scoase sunt încă referite de % cerințe/cantități — întâi se reatribuie', v_n USING ERRCODE = '23503';
  END IF;

  PERFORM public.fn_ofertare_loturi_rpc_marcaj(true);

  DELETE FROM public.ofertare_licitatie_loturi WHERE licitatie_id = p_licitatie_id AND NOT (nr = ANY (v_nrs));
  INSERT INTO public.ofertare_licitatie_loturi (licitatie_id, nr, denumire, valoare, participam, setat_de, setat_la)
  SELECT p_licitatie_id, (e->>'nr')::numeric::int, nullif(btrim(e->>'denumire'), ''),
         CASE WHEN jsonb_typeof(e->'valoare') = 'number' THEN (e->>'valoare')::numeric END,
         coalesce((e->>'participam')::boolean, false), v_uid, now()
    FROM jsonb_array_elements(p_loturi) e
  ON CONFLICT (licitatie_id, nr) DO UPDATE
    SET denumire = EXCLUDED.denumire, valoare = EXCLUDED.valoare, participam = EXCLUDED.participam,
        setat_de = EXCLUDED.setat_de, setat_la = EXCLUDED.setat_la;

  UPDATE public.ofertare_licitatii
     SET stare_loturi = p_stare, stare_loturi_setat_de = v_uid, stare_loturi_setat_la = now()
   WHERE id = p_licitatie_id;

  INSERT INTO public.ofertare_loturi_jurnal (licitatie_id, actiune, vechi, nou, de)
  VALUES (p_licitatie_id, 'licitatie_loturi', v_vechi, jsonb_build_object('stare', p_stare, 'loturi', p_loturi), v_uid);

  PERFORM public.fn_ofertare_loturi_rpc_marcaj(false);
  RETURN jsonb_build_object('ok', true, 'licitatie_id', p_licitatie_id, 'stare', p_stare, 'loturi', cardinality(v_nrs));
END $$;
REVOKE ALL ON FUNCTION public.fn_ofertare_licitatie_loturi_seteaza(bigint, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_licitatie_loturi_seteaza(bigint, text, jsonb) TO authenticated;

-- ── Trierea documentelor ─────────────────────────────────────────────────────────────────────────────────
-- p_stare: necunoscut (resetare) / comun / alocat (cu p_loturi nevid, loturi existente ale licitației).
-- Toate documentele trebuie să fie din aceeași licitație; comun/alocat cer licitația în are_loturi.
CREATE FUNCTION public.fn_ofertare_documente_lot_seteaza(p_document_ids bigint[], p_stare text, p_loturi integer[] DEFAULT '{}', p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lic bigint;
  v_nlic int;
  v_ndoc int;
  v_stare_lic text;
  v_lipsa int[];
  v_n int;
BEGIN
  IF p_document_ids IS NULL OR cardinality(p_document_ids) = 0 THEN
    RAISE EXCEPTION 'Niciun document' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_document_ids) > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 de documente pe apel' USING ERRCODE = '22023';
  END IF;
  IF p_stare NOT IN ('necunoscut', 'comun', 'alocat') THEN
    RAISE EXCEPTION 'Stare document invalidă: %', p_stare USING ERRCODE = '22023';
  END IF;
  p_loturi := coalesce(p_loturi, '{}');
  IF p_stare = 'alocat' AND cardinality(p_loturi) = 0 THEN
    RAISE EXCEPTION 'alocat cere cel puțin un lot' USING ERRCODE = '22023';
  END IF;
  IF p_stare <> 'alocat' AND cardinality(p_loturi) > 0 THEN
    RAISE EXCEPTION 'Loturile se trimit doar cu alocat' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT licitatie_id), min(licitatie_id), count(*) INTO v_nlic, v_lic, v_ndoc
    FROM public.ofertare_documente_atribuire WHERE id = ANY (p_document_ids);
  IF v_ndoc <> (SELECT count(DISTINCT x) FROM unnest(p_document_ids) x) THEN
    RAISE EXCEPTION 'Unele documente nu există' USING ERRCODE = 'P0002';
  END IF;
  IF v_nlic <> 1 THEN
    RAISE EXCEPTION 'Documentele trebuie să fie din aceeași licitație' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(v_lic), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare triază documentele' USING ERRCODE = '42501';
  END IF;
  SELECT stare_loturi INTO v_stare_lic FROM public.ofertare_licitatii WHERE id = v_lic FOR SHARE;
  IF p_stare <> 'necunoscut' AND v_stare_lic <> 'are_loturi' THEN
    RAISE EXCEPTION 'Licitația nu e în starea „are loturi” (e %)', v_stare_lic USING ERRCODE = '55000';
  END IF;
  SELECT array_agg(x) INTO v_lipsa FROM unnest(p_loturi) x
   WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_licitatie_loturi l WHERE l.licitatie_id = v_lic AND l.nr = x);
  IF v_lipsa IS NOT NULL THEN
    RAISE EXCEPTION 'Loturi inexistente pe licitație: %', v_lipsa USING ERRCODE = '22023';
  END IF;

  PERFORM public.fn_ofertare_loturi_rpc_marcaj(true);

  INSERT INTO public.ofertare_loturi_jurnal (licitatie_id, document_id, actiune, vechi, nou, de)
  SELECT v_lic, d.id, 'document_lot',
         jsonb_build_object('stare', d.lot_stare, 'sursa', d.lot_sursa, 'nota', d.lot_nota,
           'loturi', coalesce((SELECT jsonb_agg(dl.lot_nr ORDER BY dl.lot_nr) FROM public.ofertare_document_loturi dl WHERE dl.document_id = d.id), '[]'::jsonb)),
         jsonb_build_object('stare', p_stare, 'sursa', 'manual', 'nota', p_nota,
           'loturi', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM unnest(p_loturi) x)),
         v_uid
    FROM public.ofertare_documente_atribuire d WHERE d.id = ANY (p_document_ids);

  DELETE FROM public.ofertare_document_loturi WHERE document_id = ANY (p_document_ids);
  IF p_stare = 'alocat' THEN
    INSERT INTO public.ofertare_document_loturi (document_id, licitatie_id, lot_nr)
    SELECT d, v_lic, l FROM unnest(p_document_ids) d CROSS JOIN (SELECT DISTINCT unnest(p_loturi) l) ll
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.ofertare_documente_atribuire
     SET lot_stare = p_stare,
         lot_sursa = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE 'manual' END,
         lot_setat_de = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE v_uid END,
         lot_setat_la = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE now() END,
         lot_nota = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE nullif(btrim(p_nota), '') END
   WHERE id = ANY (p_document_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM public.fn_ofertare_loturi_rpc_marcaj(false);
  RETURN jsonb_build_object('ok', true, 'licitatie_id', v_lic, 'documente', v_n, 'stare', p_stare);
END $$;
REVOKE ALL ON FUNCTION public.fn_ofertare_documente_lot_seteaza(bigint[], text, integer[], text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_documente_lot_seteaza(bigint[], text, integer[], text) TO authenticated;

-- ── Parsarea canonică a lotului (etapa 2) ───────────────────────────────────────────────────────────────
-- {"domeniu":"toate"|"lista"|"necunoscut","loturi":[…]}. NULL/gol = necunoscut (NU toate). „toate” doar explicit.
-- Acceptă: „2”, „Lot 12”, „LOT2”, „1,2,3”, „Lot 1, Lot 2”, „loturile 1 și 2”, „1-3” (interval de maximum 50 de loturi: 1-50 da, 1-51 nu).
CREATE FUNCTION public.fn_ofertare_parse_lot(p text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  s text;
  parte text;
  a int;
  b int;
  rez int[] := '{}';
BEGIN
  s := lower(btrim(coalesce(p, '')));
  IF s = '' THEN
    RETURN jsonb_build_object('domeniu', 'necunoscut', 'loturi', '[]'::jsonb);
  END IF;
  IF s IN ('toate', 'toate loturile', 'all', 'toate cele') THEN
    RETURN jsonb_build_object('domeniu', 'toate', 'loturi', '[]'::jsonb);
  END IF;
  s := regexp_replace(s, 'loturile|lotul|loturi|lot', ' ', 'g');
  s := regexp_replace(s, '\s+(și|si|and)\s+', ',', 'g');
  s := regexp_replace(s, '\s*([,;/-])\s*', '\1', 'g');
  s := regexp_replace(s, '[;/]', ',', 'g');
  s := regexp_replace(s, '\s*,\s*', ',', 'g');
  s := btrim(regexp_replace(s, '\s+', ',', 'g'), ', ');
  s := regexp_replace(s, ',+', ',', 'g');
  IF s !~ '^[0-9]{1,3}(-[0-9]{1,3})?(,[0-9]{1,3}(-[0-9]{1,3})?)*$' THEN
    RETURN jsonb_build_object('domeniu', 'necunoscut', 'loturi', '[]'::jsonb);
  END IF;
  FOREACH parte IN ARRAY string_to_array(s, ',') LOOP
    IF position('-' IN parte) > 0 THEN
      a := split_part(parte, '-', 1)::int;
      b := split_part(parte, '-', 2)::int;
      IF a < 1 OR b < a OR b - a >= 50 THEN
        RETURN jsonb_build_object('domeniu', 'necunoscut', 'loturi', '[]'::jsonb);
      END IF;
      rez := rez || ARRAY(SELECT generate_series(a, b));
    ELSE
      a := parte::int;
      IF a < 1 THEN
        RETURN jsonb_build_object('domeniu', 'necunoscut', 'loturi', '[]'::jsonb);
      END IF;
      rez := rez || a;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('domeniu', 'lista', 'loturi', (SELECT jsonb_agg(DISTINCT x ORDER BY x) FROM unnest(rez) x));
END $$;
REVOKE ALL ON FUNCTION public.fn_ofertare_parse_lot(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_parse_lot(text) TO authenticated, service_role;

-- ── Numărătoarea pentru ecranul de triere ────────────────────────────────────────────────────────────────
CREATE VIEW public.v_ofertare_loturi_triere WITH (security_invoker = on) AS
SELECT l.id AS licitatie_id, l.stare_loturi,
       count(e.document_id) AS documente,
       count(e.document_id) FILTER (WHERE e.eligibil) AS procesabile,
       count(e.document_id) FILTER (WHERE e.motiv = 'in_afara_loturilor') AS in_afara_loturilor,
       count(e.document_id) FILTER (WHERE e.motiv = 'de_triat') AS de_triat,
       count(e.document_id) FILTER (WHERE NOT e.eligibil AND e.motiv NOT IN ('in_afara_loturilor', 'de_triat')) AS blocate_alt_motiv
  FROM public.ofertare_licitatii l
  LEFT JOIN LATERAL public.fn_ofertare_eligibilitate(l.id) e ON true
 GROUP BY l.id, l.stare_loturi;
REVOKE ALL ON public.v_ofertare_loturi_triere FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_loturi_triere TO authenticated, service_role;

-- ── postcondiții + garda de livrare (final) ─────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.ofertare_licitatie_loturi'::regclass, 'public.ofertare_document_loturi'::regclass,
        'public.ofertare_loturi_jurnal'::regclass) AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'Postcondiție 20261024b: RLS lipsă pe tabelele noi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE stare_loturi <> 'neinitializat')
     OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire WHERE lot_stare <> 'necunoscut') THEN
    RAISE EXCEPTION 'Postcondiție 20261024b: datele existente trebuie să pornească neinițializat / necunoscut';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ofertare_document_eligibil(bigint)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ofertare_documente_lot_seteaza(bigint[], text, integer[], text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.ofertare_document_loturi', 'INSERT') THEN
    RAISE EXCEPTION 'Postcondiție 20261024b: drepturi prea largi pe obiectele noi';
  END IF;
  IF (SELECT public.fn_ofertare_parse_lot('Lot 12')) <> '{"domeniu":"lista","loturi":[12]}'::jsonb
     OR (SELECT public.fn_ofertare_parse_lot(NULL)->>'domeniu') <> 'necunoscut' THEN
    RAISE EXCEPTION 'Postcondiție 20261024b: fn_ofertare_parse_lot greșit';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261024b_ofertare_loturi_mvp:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261024b: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$post$;
