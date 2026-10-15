-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20261030c_bmw_cardata.sql (BMW CarData, append-only).
-- Scoate: v_bmw_cardata_vs_evogps, bmw_cardata_brut, bmw_cardata_locatii, bmw_cardata_citiri (cu triggerele și politicile
-- lor) și cele 6 funcții bmw_cardata_*. Nu atinge niciun alt obiect (logistica_* doar erau citite de view).
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Folosire doar la decizia
--   lui Răzvan. Citirile sunt date de audit append-only ⇒ două niveluri de armare:
--     'SCOATE_BMW_CARDATA:'          || txid_current()  — DOAR dacă toate trei tabelele sunt goale (altfel refuz);
--     'SCOATE_BMW_CARDATA_CU_DATE:'  || txid_current()  — PIERDE citirile, locațiile și brutul (export înainte, decizie explicită).
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN ISOLATION LEVEL READ COMMITTED;
--     SELECT set_config('gazpet.rollback_tehnic_20261030c', 'SCOATE_BMW_CARDATA:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- Siguranțe: DOAR la izolarea READ COMMITTED (altfel refuz); armare persistentă (ALTER DATABASE/ROLE … SET) = refuz;
--   armare legată de txid; precondiție = exact obiectele patch-ului; LOCK ACCESS EXCLUSIVE pe toate trei tabelele ÎNAINTEA
--   verificării „goale” (fără cursă cu un INSERT concurent); DROP fără CASCADE; postcondiție = niciun obiect bmw_cardata_*
--   rămas; dezarmare la final.
-- ============================================================================
-- Jakarinos r2 P1: la REPEATABLE READ / SERIALIZABLE snapshot-ul se fixează la prima interogare (armarea), ÎNAINTEA LOCK-ului;
-- un INSERT comis cât așteptăm lock-ul ar rămâne invizibil pentru count(*), iar DROP-ul l-ar pierde. Doar READ COMMITTED
-- ia un snapshot nou la fiecare instrucțiune (count-ul de după LOCK vede tot ce s-a comis până atunci).
DO $rollback_izolare$
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030c blocat: izolarea tranzacției este „%”; revenirea rulează DOAR la READ COMMITTED (BEGIN ISOLATION LEVEL READ COMMITTED)', current_setting('transaction_isolation')
      USING ERRCODE = '25001';
  END IF;
END $rollback_izolare$;

DO $rollback_pre$
DECLARE v_armare text := current_setting('gazpet.rollback_tehnic_20261030c', true); v_n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.rollback_tehnic_20261030c') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030c blocat: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF v_armare IS DISTINCT FROM ('SCOATE_BMW_CARDATA:' || txid_current()::text)
     AND v_armare IS DISTINCT FROM ('SCOATE_BMW_CARDATA_CU_DATE:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030c blocat: fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.rollback_tehnic_20261030c'', ''SCOATE_BMW_CARDATA:'' || txid_current(), true);' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.bmw_cardata_citiri') IS NULL OR to_regclass('public.bmw_cardata_locatii') IS NULL
     OR to_regclass('public.bmw_cardata_brut') IS NULL OR to_regclass('public.v_bmw_cardata_vs_evogps') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND left(p.proname, 12) = 'bmw_cardata_') IS DISTINCT FROM 6::bigint THEN
    RAISE EXCEPTION 'Precondiție rollback 20261030c: starea curentă nu e patch-ul 20261030c — nu se revine tacit' USING ERRCODE = '55000';
  END IF;
  -- dependențe străine (alt view / FK spre tabele): DROP fără CASCADE ar cădea oricum; mesaj clar înainte
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
              WHERE d.refobjid IN ('public.bmw_cardata_citiri'::regclass, 'public.bmw_cardata_locatii'::regclass,
                                   'public.bmw_cardata_brut'::regclass)
                AND r.ev_class <> 'public.v_bmw_cardata_vs_evogps'::regclass) THEN
    RAISE EXCEPTION 'Precondiție rollback 20261030c: alte view-uri depind de tabelele bmw_cardata_* — se reanalizează' USING ERRCODE = '55000';
  END IF;
  -- Jakarinos r1 P1-2: fără lock, un INSERT concurent necomis nu se vede la count(*), iar DROP-ul de mai jos îl așteaptă și
  -- apoi șterge rândul comis. Lock-ul cel mai tare, luat O DATĂ, în ordinea scriptului (citiri → locatii → brut), înaintea numărării:
  -- scrierile în curs se termină întâi, cele noi așteaptă după DROP (și cad pe tabel inexistent). lock_timeout ⇒ fără coadă.
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.bmw_cardata_citiri, public.bmw_cardata_locatii, public.bmw_cardata_brut IN ACCESS EXCLUSIVE MODE;
  SELECT (SELECT count(*) FROM public.bmw_cardata_citiri) + (SELECT count(*) FROM public.bmw_cardata_locatii)
       + (SELECT count(*) FROM public.bmw_cardata_brut) INTO v_n;
  IF v_n > 0 AND v_armare IS DISTINCT FROM ('SCOATE_BMW_CARDATA_CU_DATE:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030c blocat: tabelele au % rânduri (date de audit). Export + decizie, apoi armarea SCOATE_BMW_CARDATA_CU_DATE', v_n
      USING ERRCODE = '42501';
  END IF;
END $rollback_pre$;

DROP VIEW public.v_bmw_cardata_vs_evogps;
DROP TABLE public.bmw_cardata_brut;
DROP TABLE public.bmw_cardata_locatii;
DROP TABLE public.bmw_cardata_citiri;
DROP FUNCTION public.bmw_cardata_doar_adaugare();
DROP FUNCTION public.bmw_cardata_citiri_valideaza();
DROP FUNCTION public.bmw_cardata_locatii_valideaza();
DROP FUNCTION public.bmw_cardata_brut_valideaza();
DROP FUNCTION public.bmw_cardata_este_owner();
DROP FUNCTION public.bmw_cardata_poate_citi();

DO $rollback_post$
BEGIN
  IF to_regclass('public.bmw_cardata_citiri') IS NOT NULL OR to_regclass('public.bmw_cardata_locatii') IS NOT NULL
     OR to_regclass('public.bmw_cardata_brut') IS NOT NULL OR to_regclass('public.v_bmw_cardata_vs_evogps') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND left(p.proname, 12) = 'bmw_cardata_') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE rollback 20261030c: au rămas obiecte bmw_cardata_*';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261030c', '', true);   -- dezarmare
END $rollback_post$;
