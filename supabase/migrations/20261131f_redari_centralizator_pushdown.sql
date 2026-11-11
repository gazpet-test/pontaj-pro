-- 20261131f_redari_centralizator_pushdown.sql — Dashboard / Centralizator xlsx: „canceling statement due to statement timeout”.
-- NUMAI fișier; se aplică DOAR prin scripts/livrare_migrare.sh (psql --single-transaction + marcajul gazpet.livrare_migrare),
-- după DRY pe clonă și „da”-ul lui Răzvan. Fără BEGIN / COMMIT: tranzacția o face runner-ul.
-- DRY (o singură tranzacție, ROLLBACK la final): scripts/redari_1022_dry_inainte.sql → această migrare → scripts/redari_1022_dry.sql.
-- Cauza (mecanism confirmat de Jakarinos, PG 15/17): funcțiile fereastră erau partiționate doar pe uat_id; un filtru coboară sub
-- o fereastră doar dacă coloana e în toate PARTITION BY → proiect_id = X nu cobora, iar red_v_stare_parcela se calcula pentru toate
-- proiectele. Un UAT aparține unui singur proiect (trigger existent) → PARTITION BY proiect_id, uat_id dă aceleași cifre.
-- Porți (L15, tiparul 31c/31d): ÎNAINTE se cere exact definiția din 20261131d + owner postgres + security_invoker + ACL-ul cunoscut;
-- DUPĂ se cere exact definiția nouă, cu același owner / opțiuni / ACL.
-- ORDINEA REVENIRILOR: dacă se revine 20261131d, întâi revenirea ACESTEI migrări (31f), apoi cea a lui 31d.
-- Revenire: supabase/revenire/20261131f_redari_centralizator_pushdown_ROLLBACK.sql.
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261131f_redari_centralizator_pushdown:' || txid_current() THEN RAISE EXCEPTION '20261131f: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131f: armare persistenta refuzata'; END IF;
  IF to_regclass('public.red_v_centralizator_uat') IS NULL OR to_regclass('public.red_v_stare_parcela') IS NULL THEN
    RAISE EXCEPTION '20261131f: lipsesc vederile'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
END $start$;

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
    -- fără ACL pe coloane (ca în porțile 31c/31d)
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
    -- fără ACL pe coloane (ca în porțile 31c/31d)
    OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.red_v_centralizator_uat') AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261131f (dupa): red_v_centralizator_uat nu are definitia / owner-ul / optiunile / ACL-ul asteptate — refuz';
  END IF;
END $poarta_dupa$;
-- vederile temporare de comparație nu rămân în sesiune după tranzacție
DROP VIEW pg_temp.f31_cent_31f;
DROP VIEW pg_temp.f31_cent_31d;
