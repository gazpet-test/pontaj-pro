-- ROLLBACK 20261131f — readuce definiția red_v_centralizator_uat din 20261131d (PARTITION BY v.uat_id). NEAPLICAT, ca migrarea.
-- Vederea nu ține date → revenirea nu pierde nimic. De testat pe clonă: apply → rollback → re-apply (cifrele identice în toate trei).

BEGIN;
DO $pre$ BEGIN
  IF to_regclass('public.red_v_centralizator_uat') IS NULL THEN RAISE EXCEPTION 'rollback 20261131f: vederea lipsește'; END IF;
END $pre$;

CREATE OR REPLACE VIEW public.red_v_centralizator_uat WITH (security_invoker = on) AS
WITH parcele AS (
  SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.parcela_id,
    CASE WHEN bool_or(v.stare='PV_A_ACOPERIT_PARCELA') THEN 'PV_A_ACOPERIT_PARCELA'
         WHEN bool_and(v.stare='PV_A_SEMNAT') THEN 'PV_A_SEMNAT'
         WHEN bool_or(v.stare='PV_B_CONSTATARE') THEN 'PV_B_CONSTATARE'
         ELSE (array_agg(v.stare ORDER BY v.stare_ordine DESC, v.stare COLLATE "C"))[1] END AS stare
  FROM public.red_v_stare_parcela v
  GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.parcela_id
)
SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare,
       count(*)::int AS numar,
       (sum(count(*)) OVER (PARTITION BY v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.uat_id), 1) AS procent_inchise
  FROM parcele v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;

DO $post$ BEGIN
  IF NOT coalesce((SELECT 'security_invoker=on' = ANY (reloptions) FROM pg_class WHERE oid = 'public.red_v_centralizator_uat'::regclass), false) THEN
    RAISE EXCEPTION 'rollback 20261131f: security_invoker pierdut'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.red_v_centralizator_uat', 'SELECT') THEN RAISE EXCEPTION 'rollback 20261131f: GRANT SELECT pierdut'; END IF;
END $post$;
COMMIT;
