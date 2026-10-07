-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261020a_ofertare_completitudine_arhive_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce SEMANTICA din 20260924 a v_ofertare_seap_completitudine: arhivele și semnăturile NU mai blochează poarta.
-- Fără DROP: CREATE OR REPLACE nu poate șterge coloane, deci arhive_nerezolvate / arhive_lista rămân, neutre (0 / NULL) —
-- consumatorii care le citesc nu cad; ACL-ul și security_invoker se păstrează.
-- ⚠️ Readuce gaura din auditul #11: o arhivă nedespachetată (sau o semnătură nedesfăcută) nu mai oprește aprobarea / depunerea.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261020a', 'COMPLETITUDINE_FARA_ARHIVE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261020a', true) IS DISTINCT FROM 'COMPLETITUDINE_FARA_ARHIVE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261020a: nearmată (gazpet.revenire_20261020a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261020a=%') THEN
    RAISE EXCEPTION 'Revenire 20261020a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_ofertare_seap_completitudine'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['licitatie_id','din_seap','enumerare','enumerare_la','seap_total','seap_erori','seap_in_curs','seap_erori_lista',
                            'esentiale','caiete','esentiale_necitite','necitite_total','blocaj','ignorate_neverificate','ignorate_lista',
                            'arhive_nerezolvate','arhive_lista']::text[]
     OR position('arhive_nerezolvate' IN pg_get_viewdef('public.v_ofertare_seap_completitudine'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'Revenire 20261020a: precondiție — view-ul nu e în starea patch-ului 20261020a (17 coloane, CTE arh)';
  END IF;
END $arm$;

CREATE OR REPLACE VIEW public.v_ofertare_seap_completitudine WITH (security_invoker = on) AS
WITH ess AS (
  SELECT d.licitatie_id,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati')) AS esentiale,
         count(*) FILTER (WHERE d.tip = 'cs_volum') AS caiete,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati') AND d.status_procesare <> 'procesat') AS esentiale_necitite,
         count(*) FILTER (WHERE d.status_procesare = 'neprocesat') AS necitite_total
  FROM public.ofertare_documente_atribuire d GROUP BY d.licitatie_id
), sf AS (
  SELECT f.licitatie_id,
         count(*) FILTER (WHERE f.stare = 'eroare') AS seap_erori,
         count(*) FILTER (WHERE f.stare = 'identificat') AS seap_in_curs,
         string_agg(f.nume_seap || ' [' || coalesce(f.etapa, '?') || ']', '; ' ORDER BY f.nume_seap) FILTER (WHERE f.stare = 'eroare') AS seap_erori_lista
  FROM public.ofertare_seap_fisiere f GROUP BY f.licitatie_id
), ign AS (
  SELECT d.licitatie_id,
         count(*) AS ignorate_neverificate,
         string_agg(regexp_replace(d.nume_original, '^.*/', ''), '; ' ORDER BY d.id) AS ignorate_lista
  FROM public.ofertare_documente_atribuire d
  WHERE d.status_procesare IN ('ignorat', 'eroare')
    AND d.text_extras IS NULL
    AND d.relevanta_verificata_la IS NULL
    AND d.nume_original !~* E'\\.(rar|zip|7z|p7s|p7m|xml|log)(\\s*\\d*)$'
    AND d.nume_original !~ E'(^|/)~\\$'
    AND NOT public.ofertare_doc_are_bucati(d.licitatie_id, d.id, d.nume_original)
  GROUP BY d.licitatie_id
)
SELECT l.id AS licitatie_id,
       (l.c_notice_id IS NOT NULL) AS din_seap,
       CASE WHEN l.c_notice_id IS NULL THEN 'n/a'
            WHEN c.licitatie_id IS NULL OR c.terminat_la IS NULL THEN 'nerulata'
            WHEN c.raport ? 'eroare' THEN 'eroare'
            ELSE 'ok' END AS enumerare,
       c.terminat_la AS enumerare_la,
       (c.raport->>'seap')::int AS seap_total,
       coalesce(sf.seap_erori, 0) AS seap_erori,
       coalesce(sf.seap_in_curs, 0) AS seap_in_curs,
       sf.seap_erori_lista,
       coalesce(e.esentiale, 0) AS esentiale,
       coalesce(e.caiete, 0) AS caiete,
       coalesce(e.esentiale_necitite, 0) AS esentiale_necitite,
       coalesce(e.necitite_total, 0) AS necitite_total,
       CASE
         WHEN l.c_notice_id IS NOT NULL AND (c.licitatie_id IS NULL OR c.terminat_la IS NULL)
           THEN 'nu putem verifica completitudinea: documentația din SEAP nu a fost încă enumerată'
         WHEN l.c_notice_id IS NOT NULL AND c.raport ? 'eroare'
           THEN 'nu putem verifica completitudinea: enumerarea SEAP a eșuat (' || left(c.raport->>'eroare', 120) || ')'
         WHEN coalesce(sf.seap_erori, 0) > 0
           THEN sf.seap_erori || ' fișier(e) din SEAP nerecuperate: ' || left(sf.seap_erori_lista, 300)
         WHEN coalesce(sf.seap_in_curs, 0) > 0
           THEN sf.seap_in_curs || ' fișier(e) din SEAP încă în curs de aducere'
         WHEN coalesce(e.caiete, 0) = 0
           THEN 'niciun caiet de sarcini / volum de proiect identificat în documentație'
         WHEN coalesce(e.esentiale_necitite, 0) > 0
           THEN e.esentiale_necitite || ' document(e) esențiale (fișa de date, caiete/PT, liste de cantități) necitite sau citite parțial'
         WHEN coalesce(g.ignorate_neverificate, 0) > 0
           THEN g.ignorate_neverificate || ' document(e) necitite automat, fără bifa unui om (consultat / nerelevant): ' || left(g.ignorate_lista, 300)
       END AS blocaj,
       coalesce(g.ignorate_neverificate, 0) AS ignorate_neverificate,
       g.ignorate_lista,
       0::bigint AS arhive_nerezolvate,
       NULL::text AS arhive_lista
FROM public.ofertare_licitatii l
LEFT JOIN public.ofertare_seap_cereri c ON c.licitatie_id = l.id
LEFT JOIN sf ON sf.licitatie_id = l.id
LEFT JOIN ess e ON e.licitatie_id = l.id
LEFT JOIN ign g ON g.licitatie_id = l.id;

DO $post$
BEGIN
  IF position('arhive_nerezolvate' IN pg_get_viewdef('public.v_ofertare_seap_completitudine'::regclass, true)) = 0
     OR position('arh.' IN pg_get_viewdef('public.v_ofertare_seap_completitudine'::regclass, true)) > 0
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.v_ofertare_seap_completitudine'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION 'Revenire 20261020a: postcondiție — view-ul nu a revenit la semantica din 20260924 (fără CTE arh, security_invoker)';
  END IF;
END $post$;
