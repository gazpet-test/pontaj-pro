-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261020a — poarta de completitudine vede arhivele nedespachetate și semnăturile nedesfăcute
-- (audit Jakarinos al motorului de import SEAP, 07.10.2026, constatarea #11; „2 = aplica”, Răzvan 07.10 seara)
--
-- Problema: v_ofertare_seap_completitudine (din 20260924_ofertare_ignorat_tehnic_bifa) excludea din „necitite automat”
--   ORICE nume de arhivă sau semnătură (…\.(rar|zip|7z|p7s|p7m|xml|log)$). O arhivă care NU a fost despachetată
--   (eșec la extragere, respinsă de controale, „Despachetare manuală necesară”, placeholder neadus, sau urcată de
--   edge/api înainte de 07.10 și rămasă „ignorat”) nu bloca depunerea, iar erorile buclei de platformă nu intrau în
--   ofertare_seap_fisiere (pe care o vede CTE-ul sf). La fel un document semnat (.p7s / .p7m) rămas nedesfăcut, din orice
--   motiv: DER stricat (var. B, PR #649: „Semnătura electronică nu s-a putut desface…”), Storage căzut („Desfacerea
--   semnăturii a eșuat…”), „X.p7m” fără extensie, rânduri vechi „non-PDF” dinainte de var. B.
-- Acum:
--   - CTE nou „arh”: o arhivă (zip/rar/7z, opțional .p7s/.p7m) NErezolvată și fără bifa unui om blochează. Rezolvată =
--       • despachetată sau închisă de bucla workerului (status „ignorat” + nota „📦 …”), SAU
--       • adusă pe drumul SEAP al workerului (nota „Arhivă adusă pe Terra…” pe placeholder), SAU
--       • are evidență pe drumul SEAP (ofertare_seap_fisiere, aceeași cheie de nume ca workerul) în stare eroare /
--         identificat — deja numărate de CTE-ul sf (blochează oricum), deci nu se dublează; SAU
--       • evidență „ok” DOAR cu dovadă de conținut: manifestul are rândul „urcat” al ACESTUI document cu același sha256 ca
--         arhiva adusă din SEAP (Copilot NO-GO r1 pe #650: numele nu dovedește că e aceeași arhivă — o versiune B urcată sub
--         același nume nu se închide pe evidența „ok” a versiunii A; aceeași clasă ca #646/#3 în dejaDesfacutaPeSeap).
--         Fără dovadă = blocaj (fail-closed), până la despachetarea din bucla workerului sau bifa unui om.
--     Orice altceva (neprocesat / in_lucru = în curs, eroare, „ignorat” cu altă notă, placeholder neadus) = blocaj, până
--     la despachetare sau până la bifa unui om (fn_ofertare_doc_bifa_relevanta — excepția umană explicită).
--   - CTE „ign”: un document semnat (.p7s / .p7m, nu arhivă) e exclus DOAR dacă e semnătură detașată, fără conținut
--     (nota „Doar semnătura electronică…”) — orice altă stare „ignorat” / „eroare” fără text și fără bifă = necitit, blochează
--     (Jakarinos r1 #1: fail-closed, nu o listă de note de eșec care se poate desincroniza). Arhivele trec la „arh”.
--   - blocaj: mesaj nou după cele de enumerare SEAP, înaintea celor despre caiete / esențiale.
--   - două coloane noi LA FINAL (CREATE OR REPLACE VIEW nu poate reordona): arhive_nerezolvate, arhive_lista.
-- Impact măsurat pe producție (07.10 seara, read-only): arhive nerezolvate la lic. 3, 5, 87, 91, 94, 100, 103, plus 101 și 102
--   (9 volume .partN.rar fiecare, urcate de edge înainte de 07.10, cu evidență „ok” dar fără rând de manifest = fără dovadă de
--   conținut) — toate licitațiile active dintre ele (3, 94, 100, 101, 102, 103) aveau deja alt blocaj; niciuna nu trece din
--   „fără blocaj” în blocat.
--   Semnături nedesfăcute fără bifă: lic. 92 (9 — reparația var. B așteaptă OK-ul lui Răzvan) și lic. 1 (6, depusă) — ambele
--   aveau deja alt blocaj.
-- Nicio funcție, niciun drept nou: view-ul rămâne security_invoker = on, ACL-ul se păstrează (CREATE OR REPLACE).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261020a_ofertare_completitudine_arhive_ROLLBACK.sql. Harness: scripts/test_ofertare_completitudine_arhive.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261020a_ofertare_completitudine_arhive:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261020a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_seap_completitudine'::regclass, true)) IS DISTINCT FROM '52cf46a83f97f6321225d7f7a41300ea' THEN
    RAISE EXCEPTION 'Precondiție 0b: v_ofertare_seap_completitudine diferă de definiția live din 07.10 (md5 52cf46a8…) — altcineva a schimbat-o';
  END IF;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_ofertare_seap_completitudine'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['licitatie_id','din_seap','enumerare','enumerare_la','seap_total','seap_erori','seap_in_curs','seap_erori_lista',
                            'esentiale','caiete','esentiale_necitite','necitite_total','blocaj','ignorate_neverificate','ignorate_lista']::text[] THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele view-ului diferă de cele live';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.v_ofertare_seap_completitudine'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION 'Precondiție 0d: v_ofertare_seap_completitudine nu mai e security_invoker = on';
  END IF;
  IF to_regclass('public.ofertare_seap_fisiere') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ofertare_seap_fisiere'::regclass AND attname = 'cheie' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Precondiție 0e: ofertare_seap_fisiere.cheie lipsește';
  END IF;
END
$pre$;

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
    AND d.nume_original !~* E'\\.(rar|zip|7z|xml|log)(\\s*\\d*)$'
    AND d.nume_original !~* E'\\.(rar|zip|7z)\\.p7[sm](\\s*\\d*)$'
    AND NOT (d.nume_original ~* E'\\.p7[sm](\\s*\\d*)$' AND coalesce(d.eroare, '') LIKE 'Doar semnătura electronică%')
    AND d.nume_original !~ E'(^|/)~\\$'
    AND NOT public.ofertare_doc_are_bucati(d.licitatie_id, d.id, d.nume_original)
  GROUP BY d.licitatie_id
), arh AS (
  SELECT d.licitatie_id,
         count(*) AS arhive_nerezolvate,
         string_agg(regexp_replace(d.nume_original, '^.*/', '') || ' [' || coalesce(d.status_procesare, '?') || ']', '; ' ORDER BY d.id) AS arhive_lista
  FROM public.ofertare_documente_atribuire d
  WHERE d.nume_original ~* E'\\.(rar|zip|7z)(\\.p7[sm])?(\\s*\\d*)$'
    AND d.relevanta_verificata_la IS NULL
    AND NOT (d.status_procesare = 'ignorat' AND coalesce(d.eroare, '') LIKE '📦%')
    AND coalesce(d.eroare, '') NOT LIKE 'Arhivă adusă pe Terra%'
    AND NOT EXISTS (
      SELECT 1 FROM public.ofertare_seap_fisiere f
       WHERE f.licitatie_id = d.licitatie_id
         AND f.cheie = regexp_replace(regexp_replace(lower(regexp_replace(d.nume_original, E'\\.p7s$', '', 'i')), '[,()]', '', 'g'), E'\\s+', '', 'g')
         AND (f.stare IN ('eroare', 'identificat')
              OR (f.stare = 'ok' AND f.sha256 IS NOT NULL
                  AND EXISTS (SELECT 1 FROM public.ofertare_seap_manifest m
                               WHERE m.licitatie_id = d.licitatie_id AND m.document_id = d.id
                                 AND m.stare = 'urcat' AND m.sha256 = f.sha256))))
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
         WHEN coalesce(a.arhive_nerezolvate, 0) > 0
           THEN a.arhive_nerezolvate || ' arhivă(e) nedespachetate (în curs, eșuate, respinse sau neaduse), fără bifa unui om: ' || left(a.arhive_lista, 300)
         WHEN coalesce(e.caiete, 0) = 0
           THEN 'niciun caiet de sarcini / volum de proiect identificat în documentație'
         WHEN coalesce(e.esentiale_necitite, 0) > 0
           THEN e.esentiale_necitite || ' document(e) esențiale (fișa de date, caiete/PT, liste de cantități) necitite sau citite parțial'
         WHEN coalesce(g.ignorate_neverificate, 0) > 0
           THEN g.ignorate_neverificate || ' document(e) necitite automat, fără bifa unui om (consultat / nerelevant): ' || left(g.ignorate_lista, 300)
       END AS blocaj,
       coalesce(g.ignorate_neverificate, 0) AS ignorate_neverificate,
       g.ignorate_lista,
       coalesce(a.arhive_nerezolvate, 0) AS arhive_nerezolvate,
       a.arhive_lista
FROM public.ofertare_licitatii l
LEFT JOIN public.ofertare_seap_cereri c ON c.licitatie_id = l.id
LEFT JOIN sf ON sf.licitatie_id = l.id
LEFT JOIN ess e ON e.licitatie_id = l.id
LEFT JOIN ign g ON g.licitatie_id = l.id
LEFT JOIN arh a ON a.licitatie_id = l.id;

DO $post$
BEGIN
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.v_ofertare_seap_completitudine'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['licitatie_id','din_seap','enumerare','enumerare_la','seap_total','seap_erori','seap_in_curs','seap_erori_lista',
                            'esentiale','caiete','esentiale_necitite','necitite_total','blocaj','ignorate_neverificate','ignorate_lista',
                            'arhive_nerezolvate','arhive_lista']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 1: coloanele view-ului nu sunt cele 15 vechi + arhive_nerezolvate, arhive_lista';
  END IF;
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.v_ofertare_seap_completitudine'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 2: view-ul nu mai e security_invoker = on';
  END IF;
  IF has_table_privilege('anon', 'public.v_ofertare_seap_completitudine', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.v_ofertare_seap_completitudine', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.v_ofertare_seap_completitudine', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 3: drepturile de citire s-au schimbat (anon nu, authenticated + service_role da)';
  END IF;
  -- amprenta exactă a definiției revizuite (harness PG17; aceeași pe care o cere revenirea ca precondiție)
  IF md5(pg_get_viewdef('public.v_ofertare_seap_completitudine'::regclass, true)) IS DISTINCT FROM 'afc35ba096ad864abe1af37f4881f9da' THEN
    RAISE EXCEPTION 'Postcondiție 4: definiția aplicată diferă de cea revizuită (md5 afc35ba0…)';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261020a_ofertare_completitudine_arhive:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261020a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
