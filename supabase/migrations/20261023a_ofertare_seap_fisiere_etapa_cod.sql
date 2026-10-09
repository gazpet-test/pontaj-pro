-- 20261023a: evidența SEAP acceptă etapele „cod” și „identitate” (PR-2 #659, worker NAS pe codul SEAP).
-- Workerul scrie etapa „cod” la închiderea unei evidențe dovedite pe cod și „identitate” la identitatea neverificată /
-- conflictul de nume (fail-closed). Constrângerea veche (20260924) le respingea: scrierea pica (doar log), iar evidența
-- rămânea „identificat” și ținea poarta de completitudine (lic. 3, 09.10.2026). Doar lărgirea listei, fără date atinse.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261023a_ofertare_seap_fisiere_etapa_cod_ROLLBACK.sql (eșuează dacă există deja rânduri cu
-- etapa „cod” / „identitate” — se curăță întâi, cu preview).
DO $migrare$
DECLARE
  v_def text;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261023a_ofertare_seap_fisiere_etapa_cod:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261023a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiție: constrângerea există și are lista veche (altfel s-a schimbat între timp → oprire) ──────
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.ofertare_seap_fisiere'::regclass AND conname = 'ofertare_seap_fisiere_etapa_check';
  IF v_def IS DISTINCT FROM 'CHECK ((etapa = ANY (ARRAY[''identificare''::text, ''descarcare''::text, ''semnatura''::text, ''set_volume''::text, ''listare''::text, ''extragere''::text, ''urcare''::text])))' THEN
    RAISE EXCEPTION 'Precondiție 20261023a: definiția constrângerii diferă de cea așteptată: %', v_def;
  END IF;

  ALTER TABLE public.ofertare_seap_fisiere DROP CONSTRAINT ofertare_seap_fisiere_etapa_check;
  ALTER TABLE public.ofertare_seap_fisiere ADD CONSTRAINT ofertare_seap_fisiere_etapa_check
    CHECK (etapa IN ('identificare', 'descarcare', 'semnatura', 'set_volume', 'listare', 'extragere', 'urcare', 'cod', 'identitate'));

  -- ── postcondiție ──────────────────────────────────────────────────────────────────────────────────────
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.ofertare_seap_fisiere'::regclass AND conname = 'ofertare_seap_fisiere_etapa_check';
  IF v_def IS NULL OR position('''cod''::text' IN v_def) = 0 OR position('''identitate''::text' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Postcondiție 20261023a: constrângerea nouă lipsește sau e incompletă: %', v_def;
  END IF;

  -- ── garda de livrare (final) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261023a_ofertare_seap_fisiere_etapa_cod:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261023a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
