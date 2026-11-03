-- Revenire 20261129k_redari_ar_calitate. Doar la urgenta. NU sterge date: coloana ar_primit_calitate RAMANE, cu valorile ei (calitatea AR-urilor
-- deja inregistrate se pastreaza pentru dosar). Se scot doar regulile adaugate de 29k:
--   * triggerul trg_red_zz_ar_calitate + functia fn_red_plic_ar_calitate (imutabilitatea calitatii dupa AR);
--   * CHECK-urile red_plicuri_ar_calitate_valori si red_plicuri_ar_calitate;
--   * dreptul de UPDATE pe coloana pentru authenticated / service_role (lista alba revine la cele 13 coloane din 29j).
-- Efect: aplicatia nu mai poate scrie coloana. UI-ul din PR-ul 29k o trimite DOAR la AR „alta persoana”, deci pana la revenirea UI-ului
-- acel UPDATE e refuzat (42501, fail-closed); AR-ul „destinatar”, expedierea, returul si restul regulilor 29i/29j nu sunt afectate.
-- Reaplicarea dupa revenire cere o migrare noua (coloana exista deja, iar perechea nume + versiune 29k ramane in istoric).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129k', true) IS DISTINCT FROM 'REDARI_AR_CALITATE_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261129k revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- starea de dupa 29k, exact (functia revizuita, triggerul, cele doua CHECK-uri). md5 pe corpul fara CR: acelasi rezultat daca migrarea
  -- s-a aplicat dintr-o copie cu LF sau cu CRLF (core.autocrlf)
  IF to_regprocedure('public.fn_red_plic_ar_calitate()') IS NULL
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_ar_calitate()'::regprocedure), chr(13), '')) IS DISTINCT FROM '2034d30779ea05a58c45fc6516fe7f8e'
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_plicuri'::regclass AND tgname = 'trg_red_zz_ar_calitate')
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.red_plicuri'::regclass AND conname IN ('red_plicuri_ar_calitate', 'red_plicuri_ar_calitate_valori')) <> 2 THEN
    RAISE EXCEPTION '20261129k revenire: starea nu e cea din 29k';
  END IF;
  LOCK TABLE public.red_plicuri IN ACCESS EXCLUSIVE MODE;
END $pre$;

DROP TRIGGER trg_red_zz_ar_calitate ON public.red_plicuri;
DROP FUNCTION public.fn_red_plic_ar_calitate();
ALTER TABLE public.red_plicuri DROP CONSTRAINT red_plicuri_ar_calitate;
ALTER TABLE public.red_plicuri DROP CONSTRAINT red_plicuri_ar_calitate_valori;
REVOKE UPDATE (ar_primit_calitate) ON public.red_plicuri FROM authenticated, service_role;
COMMENT ON COLUMN public.red_plicuri.ar_primit_calitate IS 'Redari: coloana pastrata la revenirea 20261129k (fara reguli, fara drept de scriere pentru aplicatie). Calitatea primitorului AR-urilor inregistrate inainte de revenire.';

DO $post$
DECLARE v_lista text[] := string_to_array(replace('stare, motiv_anulare, opis_path, awb, data_expediere, data_ar, ar_scan_path, ar_primit_de, ar_mentiune, retur, retur_detaliu, retur_data, retur_scan_path', ' ', ''), ',');
BEGIN
  -- coloana (si datele ei) raman; lista alba e exact cea din 29j, pentru FIECARE rol si FIECARE coloana (25 de coloane)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_plicuri' AND column_name = 'ar_primit_calitate')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_plicuri') <> 25
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, information_schema.columns c
                 WHERE c.table_schema = 'public' AND c.table_name = 'red_plicuri'
                   AND (has_column_privilege(r, 'public.red_plicuri', c.column_name, 'UPDATE') IS DISTINCT FROM (r <> 'anon' AND c.column_name = ANY (v_lista))
                        OR has_column_privilege(r, 'public.red_plicuri', c.column_name, 'INSERT')))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['UPDATE', 'INSERT', 'DELETE', 'TRUNCATE']) pr
                 WHERE has_table_privilege(r, 'public.red_plicuri', pr)) THEN
    RAISE EXCEPTION '20261129k revenire: coloana / privilegii pe coloane gresite';
  END IF;
  IF to_regprocedure('public.fn_red_plic_ar_calitate()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_plicuri'::regclass AND tgname = 'trg_red_zz_ar_calitate')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_plicuri'::regclass AND conname IN ('red_plicuri_ar_calitate', 'red_plicuri_ar_calitate_valori')) THEN
    RAISE EXCEPTION '20261129k revenire: reguli 29k ramase';
  END IF;
  -- regulile din 29i/29j raman neatinse
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_reguli()'::regprocedure)) IS DISTINCT FROM 'cda947fbd65187a73b7929b59c74f2fb' THEN
    RAISE EXCEPTION '20261129k revenire: fn_red_plic_reguli modificata';
  END IF;
END $post$;
