-- 20261131f_redari_centralizator_pushdown.sql — Dashboard / Centralizator xlsx: „canceling statement due to statement timeout”.
-- STARE: NEAPLICATĂ și NETESTATĂ pe BD (redari@, test weekend 06.11.2026, fără acces la BD). Înainte de apply: EXPLAIN (ANALYZE, BUFFERS)
-- înainte / după cu filtrul real (proiect_id = X AND stare IS NOT NULL) și rolul authenticated; paritate EXCEPT ALL în ambele sensuri;
-- apply → rollback → re-apply pe clonă; review; „da” Răzvan.
-- Cauza (confirmată ca mecanism de Jakarinos, PG 15/17): funcțiile fereastră erau partiționate doar pe uat_id; un filtru coboară sub
-- o fereastră doar dacă coloana e în toate PARTITION BY → proiect_id = X nu cobora, iar red_v_stare_parcela se calcula pentru toate
-- proiectele. Un UAT aparține unui singur proiect (trigger existent) → PARTITION BY proiect_id, uat_id dă aceleași cifre.
-- Porți (L15, tiparul 31c/31d): ÎNAINTE se cere exact definiția din 20261131d + owner postgres + security_invoker + ACL-ul cunoscut;
-- DUPĂ se cere exact definiția nouă, cu același owner / opțiuni / ACL.
-- ORDINEA REVENIRILOR: dacă se revine 20261131d, întâi se rulează revenirea ACESTEI migrări (31f), apoi cea a lui 31d
-- (rollback-ul 31d compară vederea cu definiția 31d). Poarta din 31c a rulat o singură dată, la aplicarea ei; nu e afectată.
-- Revenire: supabase/revenire/20261131f_redari_centralizator_pushdown_ROLLBACK.sql.

BEGIN;
DO $pre$ BEGIN
  IF to_regclass('public.red_v_centralizator_uat') IS NULL OR to_regclass('public.red_v_stare_parcela') IS NULL THEN RAISE EXCEPTION '20261131f: lipsesc vederile'; END IF;
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
  IF pg_get_viewdef(to_regclass('public.red_v_centralizator_uat'), true) IS DISTINCT FROM pg_get_viewdef('pg_temp.f31_cent_31d'::regclass, true)
    OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.red_v_centralizator_uat') AND c.relkind = 'v'
      AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(c.relacl::text[]) a)
        = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[])
    -- Jakarinos r2 P1 (L15): fără ACL pe coloane (ca în porțile 31c/31d)
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.red_v_centralizator_uat') AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261131f (inainte): red_v_centralizator_uat nu are definitia / owner-ul / optiunile / ACL-ul asteptate — refuz';
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
       (sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.proiect_id, v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.proiect_id, v.uat_id), 1) AS procent_inchise
  FROM parcele v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;

DO $poarta_dupa$ BEGIN
  IF pg_get_viewdef(to_regclass('public.red_v_centralizator_uat'), true) IS DISTINCT FROM pg_get_viewdef('pg_temp.f31_cent_31f'::regclass, true)
    OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.red_v_centralizator_uat') AND c.relkind = 'v'
      AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(c.relacl::text[]) a)
        = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[])
    -- Jakarinos r2 P1 (L15): fără ACL pe coloane (ca în porțile 31c/31d)
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.red_v_centralizator_uat') AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261131f (dupa): red_v_centralizator_uat nu are definitia / owner-ul / optiunile / ACL-ul asteptate — refuz';
  END IF;
END $poarta_dupa$;
-- Jakarinos r2 P2: vederile temporare de comparație nu rămân în sesiune după COMMIT
DROP VIEW pg_temp.f31_cent_31f;
DROP VIEW pg_temp.f31_cent_31d;
COMMIT;
