-- 20261131f_redari_centralizator_pushdown.sql — Dashboard / Centralizator xlsx: „canceling statement due to statement timeout”.
-- STARE: NEAPLICATĂ și NETESTATĂ pe BD (redari@, test weekend 06.11.2026, fără acces la BD). Înainte de apply: EXPLAIN ANALYZE pe clonă
-- (înainte / după) pentru  SELECT ... FROM red_v_centralizator_uat WHERE proiect_id = <TEST> AND stare IS NOT NULL , DRY, review, „da” Răzvan.
-- Cauza probabilă: funcțiile fereastră sunt partiționate doar pe uat_id; Postgres împinge un filtru sub o fereastră DOAR dacă coloana
-- e în toate PARTITION BY → filtrul proiect_id = X nu coboară, iar red_v_stare_parcela se calculează pentru TOATE proiectele la fiecare
-- cerere (de aceea pică și TEST-RAZVAN, cu 6 parcele). Un UAT aparține unui singur proiect → PARTITION BY proiect_id, uat_id dă
-- exact aceleași cifre. Aceleași coloane, același tip → CREATE OR REPLACE e permis; security_invoker rămâne on; GRANT-urile rămân.
-- ATENȚIE: 20261131d verifică amprenta vederii (pr2_cent_asteptata) — amprenta de referință din scripturile de poartă trebuie actualizată odată cu aplicarea.
-- Revenire: supabase/revenire/20261131f_redari_centralizator_pushdown_ROLLBACK.sql (definiția din 20261131d, neschimbată).

BEGIN;
DO $pre$ BEGIN
  IF to_regclass('public.red_v_centralizator_uat') IS NULL OR to_regclass('public.red_v_stare_parcela') IS NULL THEN RAISE EXCEPTION '20261131f: lipsesc vederile'; END IF;
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
       (sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.proiect_id, v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id), 1) AS procent_inchise
  FROM parcele v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;

DO $post$ BEGIN
  IF NOT coalesce((SELECT 'security_invoker=on' = ANY (reloptions) FROM pg_class WHERE oid = 'public.red_v_centralizator_uat'::regclass), false) THEN
    RAISE EXCEPTION '20261131f: security_invoker pierdut'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.red_v_centralizator_uat', 'SELECT') THEN RAISE EXCEPTION '20261131f: GRANT SELECT pierdut'; END IF;
END $post$;
COMMIT;
