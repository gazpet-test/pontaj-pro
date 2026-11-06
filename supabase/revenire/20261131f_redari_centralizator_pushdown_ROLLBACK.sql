-- ROLLBACK 20261131f — readuce definiția red_v_centralizator_uat din 20261131d (PARTITION BY v.uat_id). NEAPLICAT, ca migrarea.
-- Vederea nu ține date → nimic de pierdut. Porți: ÎNAINTE exact definiția 31f (refuz altfel), DUPĂ exact definiția 31d.
-- Se rulează ÎNAINTEA revenirii 20261131d, dacă aceea e necesară. De testat pe clonă: apply → rollback → re-apply (cifre identice).

BEGIN;
DO $pre$ BEGIN
  IF to_regclass('public.red_v_centralizator_uat') IS NULL THEN RAISE EXCEPTION 'rollback 20261131f: vederea lipsește'; END IF;
END $pre$;
CREATE TEMP VIEW f31_cent_31d AS
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
CREATE TEMP VIEW f31_cent_31f AS
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
       (sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.proiect_id, v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id), 1) AS procent_inchise
  FROM parcele v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;
DO $poarta_inainte$ BEGIN
  IF pg_get_viewdef(to_regclass('public.red_v_centralizator_uat'), true) IS DISTINCT FROM pg_get_viewdef('pg_temp.f31_cent_31f'::regclass, true)
    OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.red_v_centralizator_uat') AND c.relkind = 'v'
      AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(c.relacl::text[]) a)
        = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]) THEN
    RAISE EXCEPTION 'rollback 20261131f (inainte): red_v_centralizator_uat nu are definitia / owner-ul / optiunile / ACL-ul asteptate — refuz';
  END IF;
END $poarta_inainte$;

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

DO $poarta_dupa$ BEGIN
  IF pg_get_viewdef(to_regclass('public.red_v_centralizator_uat'), true) IS DISTINCT FROM pg_get_viewdef('pg_temp.f31_cent_31d'::regclass, true)
    OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.red_v_centralizator_uat') AND c.relkind = 'v'
      AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(c.relacl::text[]) a)
        = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]) THEN
    RAISE EXCEPTION 'rollback 20261131f (dupa): red_v_centralizator_uat nu are definitia / owner-ul / optiunile / ACL-ul asteptate — refuz';
  END IF;
END $poarta_dupa$;
COMMIT;
