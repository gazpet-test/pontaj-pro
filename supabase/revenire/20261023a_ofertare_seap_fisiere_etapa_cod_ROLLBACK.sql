-- ROLLBACK 20261023a: lista veche de etape. Un singur bloc DO (atomic, Copilot r1 pe #661): precondiția oprește ÎNAINTE de
-- DROP dacă există rânduri cu etapa „cod” / „identitate” (se curăță întâi, cu preview + OK Răzvan) — altfel tabela ar
-- rămâne fără constrângere. Revenirea de cod (worker) se face întâi, ca să nu mai scrie etapele noi.
DO $revenire$
DECLARE
  v_n bigint;
  v_def text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT count(*) INTO v_n FROM public.ofertare_seap_fisiere WHERE etapa IN ('cod', 'identitate');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Revenire 20261023a: % rânduri au etapa cod/identitate — curăță-le întâi (preview + OK), apoi reia', v_n;
  END IF;
  ALTER TABLE public.ofertare_seap_fisiere DROP CONSTRAINT ofertare_seap_fisiere_etapa_check;
  ALTER TABLE public.ofertare_seap_fisiere ADD CONSTRAINT ofertare_seap_fisiere_etapa_check
    CHECK (etapa IN ('identificare', 'descarcare', 'semnatura', 'set_volume', 'listare', 'extragere', 'urcare'));
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.ofertare_seap_fisiere'::regclass AND conname = 'ofertare_seap_fisiere_etapa_check';
  IF v_def IS NULL OR position('''cod''::text' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Revenire 20261023a: postcondiție — constrângerea lipsește sau conține încă etapele noi: %', v_def;
  END IF;
END
$revenire$;
