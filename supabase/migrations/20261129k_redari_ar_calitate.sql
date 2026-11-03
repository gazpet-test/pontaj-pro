-- Version 20261129121000. Runner supplies one transaction.
-- 20261129k_redari_ar_calitate — Redari: calitatea primitorului unui AR semnat de alta persoana (decizia lui Razvan, juridic#026 pct. 1, 03.11.2026).
-- La ar_primit_de = 'alta_persoana' se cere si calitatea, dintr-o lista scurta: membru_familie / vecin / alta_persoana. Mentiunea libera
-- (ar_mentiune) ramane separat si obligatorie (29i). Catre Transgaz (registrul TGZ, PV B) merge DOAR calitatea; mentiunea libera ramane in registrul intern.
-- Calitatea se scrie o singura data, odata cu AR-ul (CHECK-urile o leaga de ar_primit_de), si nu se mai schimba dupa inregistrarea AR-ului
-- (trigger nou, separat de fn_red_plic_reguli); mentenanta postgres fara JWT ramane permisa, ca in 29j.
-- Nu atinge date (in productie nu exista plicuri la 03.11.2026; pre-checkul refuza daca exista AR-uri „alta persoana” fara calitate).
-- Revenire: supabase/revenire/20261129k_redari_ar_calitate_ROLLBACK.sql (coloana RAMANE cu valorile ei; se scot triggerul, CHECK-urile noi si dreptul
-- de UPDATE pe coloana). DRY: supabase/tests/20261129k_redari_ar_calitate_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261129k_redari_ar_calitate:' || txid_current() THEN
    RAISE EXCEPTION '20261129k: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_plicuri') IS NULL OR to_regprocedure('public.fn_red_plic_reguli()') IS NULL THEN RAISE EXCEPTION '20261129k: 20261129i lipseste'; END IF;
  -- 29j aplicata: regulile plicului (imutabilitatea AR pe care o completeaza triggerul nou) sunt exact cele din 29j
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_reguli()'::regprocedure)) IS DISTINCT FROM 'cda947fbd65187a73b7929b59c74f2fb' THEN
    RAISE EXCEPTION '20261129k: fn_red_plic_reguli difera de cea din 29j';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_plicuri') <> 24 THEN
    RAISE EXCEPTION '20261129k: red_plicuri nu are cele 24 de coloane din 29j (schema diferita)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_plicuri' AND column_name = 'ar_primit_calitate')
     OR to_regprocedure('public.fn_red_plic_ar_calitate()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_plicuri'::regclass AND tgname = 'trg_red_zz_ar_calitate')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_plicuri'::regclass AND conname IN ('red_plicuri_ar_calitate', 'red_plicuri_ar_calitate_valori')) THEN
    RAISE EXCEPTION '20261129k: obiectele noi exista deja';
  END IF;
  -- blocare exclusiva inaintea verificarii datelor (ALTER TABLE o cere oricum): nimeni nu inregistreaza un AR intre verificare si CHECK-ul nou
  LOCK TABLE public.red_plicuri IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.red_plicuri WHERE ar_primit_de = 'alta_persoana') THEN
    RAISE EXCEPTION '20261129k: exista AR-uri „alta persoana” fara calitate; se trateaza intai (CHECK-ul nou le-ar refuza)';
  END IF;
END $pre$;

ALTER TABLE public.red_plicuri ADD COLUMN ar_primit_calitate text;
ALTER TABLE public.red_plicuri ADD CONSTRAINT red_plicuri_ar_calitate_valori
  CHECK (ar_primit_calitate IS NULL OR ar_primit_calitate IN ('membru_familie', 'vecin', 'alta_persoana'));
-- calitatea exista exact cand AR-ul e semnat de alta persoana. Forma NULL-safe (IS NOT DISTINCT FROM): cu „ar_primit_de = 'alta_persoana'”
-- un ar_primit_de NULL (plic fara AR) ar da NULL, iar CHECK-ul ar trece si cu o calitate scrisa fara AR.
ALTER TABLE public.red_plicuri ADD CONSTRAINT red_plicuri_ar_calitate
  CHECK ((ar_primit_de IS NOT DISTINCT FROM 'alta_persoana') = (ar_primit_calitate IS NOT NULL));
COMMENT ON COLUMN public.red_plicuri.ar_primit_calitate IS 'Redari (juridic#026 pct. 1): calitatea primitorului AR-ului semnat de alta persoana (membru_familie / vecin / alta_persoana). Doar ea ajunge la TGZ; ar_mentiune (text liber) ramane intern. Imuabila dupa inregistrarea AR.';

-- Imutabilitatea calitatii dupa inregistrarea AR-ului (fn_red_plic_reguli din 29j protejeaza data / scanul / primit de / mentiunea, nu si coloana noua).
-- SECURITY INVOKER: nu citeste tabele. Numele „zz” il face ultimul trigger BEFORE UPDATE, deci vede valoarea finala a randului.
CREATE FUNCTION public.fn_red_plic_ar_calitate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
-- 29k (juridic#026 pct. 1): dupa AR calitatea primitorului nu se mai schimba din aplicatie; mentenanta (sesiune postgres fara JWT) ramane permisa, ca in 29j
BEGIN
  IF OLD.data_ar IS NOT NULL AND NEW.ar_primit_calitate IS DISTINCT FROM OLD.ar_primit_calitate
     AND NOT (session_user = 'postgres' AND coalesce(current_setting('request.jwt.claims', true), '') = '') THEN
    RAISE EXCEPTION 'redari: AR-ul plicului e deja inregistrat; calitatea primitorului nu se mai schimba' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_ar_calitate() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_zz_ar_calitate BEFORE UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_ar_calitate();

-- lista alba din 29j + coloana noua (se scrie odata cu AR-ul, din modalul AR)
GRANT UPDATE (ar_primit_calitate) ON public.red_plicuri TO authenticated, service_role;

DO $post$
DECLARE v_lista text[] := string_to_array(replace('stare, motiv_anulare, opis_path, awb, data_expediere, data_ar, ar_scan_path, ar_primit_de, ar_mentiune, ar_primit_calitate, retur, retur_detaliu, retur_data, retur_scan_path', ' ', ''), ',');
BEGIN
  -- ca in 29j (Copilot 29j r1 P2-02), cu 25 de coloane: pentru FIECARE rol si FIECARE coloana, UPDATE exact pe lista alba (authenticated, service_role),
  -- nimic pentru anon, niciun INSERT pe coloane; niciun UPDATE / INSERT / DELETE / TRUNCATE la nivel de tabel
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = 'red_plicuri'
                AND (has_column_privilege(r, 'public.red_plicuri', c.column_name, 'UPDATE') IS DISTINCT FROM (r <> 'anon' AND c.column_name = ANY (v_lista))
                     OR has_column_privilege(r, 'public.red_plicuri', c.column_name, 'INSERT')))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['UPDATE', 'INSERT', 'DELETE', 'TRUNCATE']) pr
                 WHERE has_table_privilege(r, 'public.red_plicuri', pr))
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_plicuri') <> 25
     OR cardinality(v_lista) <> 14 THEN
    RAISE EXCEPTION '20261129k: privilegii pe coloane gresite (lista alba)';
  END IF;
  -- citirea coloanei: ca restul plicului (authenticated, RLS pe rand), nu pentru anon
  IF NOT has_column_privilege('authenticated', 'public.red_plicuri', 'ar_primit_calitate', 'SELECT') OR has_column_privilege('anon', 'public.red_plicuri', 'ar_primit_calitate', 'SELECT') THEN
    RAISE EXCEPTION '20261129k: drept de citire pe coloana nou';
  END IF;
  -- functia triggerului: neexpusa, SECURITY INVOKER, search_path fixat
  IF has_function_privilege('anon', 'public.fn_red_plic_ar_calitate()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.fn_red_plic_ar_calitate()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_plic_ar_calitate()', 'EXECUTE')
     OR (SELECT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_red_plic_ar_calitate()'::regprocedure) THEN
    RAISE EXCEPTION '20261129k: functia de imutabilitate expusa sau cu configurare gresita';
  END IF;
  -- triggerul: BEFORE UPDATE FOR EACH ROW (tgtype 19), fara lista de coloane, activ
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_plicuri'::regclass AND tgname = 'trg_red_zz_ar_calitate' AND NOT tgisinternal
                   AND tgfoid = 'public.fn_red_plic_ar_calitate()'::regprocedure AND tgtype = 19 AND tgenabled = 'O' AND tgattr::text = '') THEN
    RAISE EXCEPTION '20261129k: triggerul de imutabilitate lipseste sau e diferit';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.red_plicuri'::regclass AND contype = 'c' AND convalidated
        AND conname IN ('red_plicuri_ar_calitate', 'red_plicuri_ar_calitate_valori')) <> 2 THEN
    RAISE EXCEPTION '20261129k: CHECK-urile noi lipsesc';
  END IF;
  -- regulile din 29i/29j raman neatinse
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_reguli()'::regprocedure)) IS DISTINCT FROM 'cda947fbd65187a73b7929b59c74f2fb' THEN
    RAISE EXCEPTION '20261129k: fn_red_plic_reguli modificata';
  END IF;
END $post$;
