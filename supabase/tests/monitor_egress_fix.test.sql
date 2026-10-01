-- Suita smoke pentru 20261002a_monitor_egress_fix (DOAR PG local). psql -v faza=fix|vechi
-- faza=vechi: dovedește gaurile pe 20260930e (notificare eșuată anulează blocarea; cheie lungă ocolește poarta).
-- faza=fix:   aceleași scenarii trebuie să fie închise.
\set ON_ERROR_STOP 1
TRUNCATE public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte, public.notifications;
DROP TRIGGER IF EXISTS t_notif_pica ON public.notifications;
CREATE OR REPLACE FUNCTION public.t_notif_pica() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notificare forțată să eșueze'; END $$;
SET client_min_messages = error;
SELECT set_config('teste.faza', :'faza', false);

-- A. 21 descărcări pe același obiect → detector → blocat → poarta = true; notificarea a plecat la owner
SET ROLE service_role;
SELECT count(public.egress_log_descarcare('ofertare', 'doc/770.pdf', 95000000, 'nas:test', 770)) FROM generate_series(1, 21);
SELECT public.egress_detector() AS rez_a \gset
RESET ROLE;
DO $$ BEGIN
  IF NOT (SELECT blocat FROM storage_obiecte_blocate WHERE bucket='ofertare' AND obiect='doc/770.pdf') THEN RAISE EXCEPTION 'A: nu e blocat'; END IF;
  IF (SELECT count(*) FROM notifications WHERE type='egress_alerta') <> 1 THEN RAISE EXCEPTION 'A: notificare lipsă'; END IF;
END $$;
SET ROLE service_role;
SELECT public.egress_obiect_blocat('ofertare', 'doc/770.pdf') AS gate_a \gset
RESET ROLE;
\if :gate_a
\echo 'OK   A: 21 log → detector → blocat=true → gate=true'
\else
SELECT 1/0 AS a_gate_false;
\endif

-- B. notificarea forțată să eșueze → blocarea + alerta rămân (fix) / tot jobul cade (vechi)
CREATE TRIGGER t_notif_pica BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_notif_pica();
SET ROLE service_role;
SELECT count(public.egress_log_descarcare('ofertare', 'doc/771.pdf', 1000, 'nas:test')) FROM generate_series(1, 21);
RESET ROLE;
DO $$ DECLARE v jsonb; v_err text;
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    v := public.egress_detector();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; RESET ROLE;
  END;
  IF current_setting('teste.faza') = 'vechi' THEN
    IF v_err IS NULL OR EXISTS (SELECT 1 FROM storage_obiecte_blocate WHERE obiect='doc/771.pdf') THEN
      RAISE EXCEPTION 'B(vechi): așteptat ca detectorul să cadă și blocarea să se piardă (err=%)', v_err; END IF;
    RAISE NOTICE 'GAURA B reprodusă pe 20260930e: %', v_err;
  ELSE
    IF v_err IS NOT NULL THEN RAISE EXCEPTION 'B: detectorul a căzut: %', v_err; END IF;
    IF (v->>'notificari_esuate')::int < 1 THEN RAISE EXCEPTION 'B: notificari_esuate=% (rez %)', v->>'notificari_esuate', v; END IF;
    IF NOT coalesce((SELECT blocat FROM storage_obiecte_blocate WHERE obiect='doc/771.pdf'), false) THEN RAISE EXCEPTION 'B: blocarea s-a pierdut'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage_egress_alerte WHERE tip='obiect_repetat' AND cheie LIKE 'ofertare/doc/771.pdf@%') THEN RAISE EXCEPTION 'B: alerta s-a pierdut'; END IF;
  END IF;
END $$;
DROP TRIGGER t_notif_pica ON public.notifications;
SET ROLE service_role;
SELECT public.egress_obiect_blocat('ofertare', 'doc/771.pdf') AS gate_b \gset
RESET ROLE;
\if :gate_b
\echo 'OK   B: notificare eșuată → blocarea și alerta rămân comise, gate=true'
\else
\echo 'INFO B: gate=false (așteptat doar în faza vechi)'
\endif

-- C. deblocare de către owner → gate = false; non-owner refuzat
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
DO $$ BEGIN PERFORM public.egress_deblocheaza('ofertare', 'doc/770.pdf'); RAISE EXCEPTION 'C: non-owner a deblocat';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000121', false);
SET ROLE authenticated;
SELECT public.egress_deblocheaza('ofertare', 'doc/770.pdf') AS debloc_c \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE service_role;
SELECT NOT public.egress_obiect_blocat('ofertare', 'doc/770.pdf') AND :'debloc_c'::boolean AS gate_c_liber \gset
RESET ROLE;
\if :gate_c_liber
\echo 'OK   C: deblocare owner → gate=false (non-owner refuzat 42501)'
\else
SELECT 1/0 AS c_gate;
\endif

-- D. cheie > 1024 caractere: blocată corect, poarta o vede cu cheia ÎNTREAGĂ; cheia-soră (același prefix) nu e blocată
SELECT 'proiecte/' || repeat('x', 1500) || '/a.pdf' AS lung, 'proiecte/' || repeat('x', 1500) || '/b.pdf' AS sora \gset
SET ROLE service_role;
SELECT count(public.egress_log_descarcare('ofertare', :'lung', 10, 'nas:test')) FROM generate_series(1, 21);
SELECT public.egress_detector() AS rez_d \gset
SELECT public.egress_obiect_blocat('ofertare', :'lung') AS gate_d, NOT public.egress_obiect_blocat('ofertare', :'sora') AS sora_libera \gset
RESET ROLE;
\if :gate_d
\echo 'OK   D: cheie de 1515 caractere → blocată, gate(cheia întreagă)=true'
\if :sora_libera
\echo 'OK   D: cheia-soră cu același prefix de 1500 → gate=false (fără coliziune)'
\else
SELECT 1/0 AS d_coliziune;
\endif
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000121', false);
SET ROLE authenticated;
SELECT public.egress_deblocheaza('ofertare', :'lung') AS debloc_d \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE service_role;
SELECT :'debloc_d'::boolean AND NOT public.egress_obiect_blocat('ofertare', :'lung') AS d_liber \gset
RESET ROLE;
\if :d_liber
\echo 'OK   D: deblocare cu cheia lungă întreagă → gate=false'
\else
SELECT 1/0 AS d_debloc;
\endif
\else
\if :sora_libera
\echo 'GAURA D reprodusă pe 20260930e: cheia lungă e blocată trunchiat, dar gate(cheia întreagă)=false'
\else
SELECT 1/0 AS d_vechi_neasteptat;
\endif
\endif
\echo 'SUITA_OK'
