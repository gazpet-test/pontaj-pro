-- REVENIRE 20261127a_redari_uat_setari (armată; doar la cererea lui Răzvan, după decizie + review). NU e migrare — niciun runner nu parcurge directorul.
-- Scoate ce a adăugat migrarea: coloanele noi din red_uat (reprezentant_uat_telefon, termen_confirmare, afisare_ora, afisare_reprezentant_gazpet,
-- adresa_nr, adresa_data) și red_proiecte.apm_nume, constrângerile red_uat_zile_ordonate / _termen_inainte / _afisare_ordonata, indexul
-- red_uat_adresa_nr_uq, coloana `versiune` + trigger-ele trg_red_versiune + fn_red_versiune_creste, ramura 'AU' din fn_red_numar_document (corpul revine exact la 20261126a) și rândul 20261127120000 din
-- supabase_migrations.schema_migrations (dacă tabelul există).
-- Refuză: nearmată; armare persistentă; migrarea neaplicată; DATE în coloanele noi sau cheia AU în red_numere fără al doilea GUC
-- gazpet.revenire_20261127a_forta = 'DA' (cu forța, valorile din coloanele noi se pierd, iar cheia AU se șterge din red_numere).
-- Procedura (un singur string, gestionarul tranzacției e operatorul):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261127a', 'REDARI_UAT_SETARI_SCOASA:' || txid_current(), true);
--   -- opțional, DOAR cu decizia explicită a lui Răzvan: SELECT set_config('gazpet.revenire_20261127a_forta', 'DA', true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261127a REDARI_UAT_SETARI_SCOASA
DO $pre$
DECLARE v_date text;
BEGIN
  IF current_setting('gazpet.revenire_20261127a', true) IS DISTINCT FROM 'REDARI_UAT_SETARI_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261127a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261127a revenire: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261127a%') THEN
    RAISE EXCEPTION '20261127a revenire: armare persistenta (pg_db_role_setting) — refuz';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat' AND column_name = 'adresa_nr') THEN
    RAISE EXCEPTION '20261127a revenire: migrarea nu e aplicata (red_uat.adresa_nr lipseste)';
  END IF;
  -- garda atomică: lock-urile înaintea verificării de date, ținute până la COMMIT
  LOCK TABLE public.red_uat, public.red_proiecte, public.red_numere IN ACCESS EXCLUSIVE MODE;
  SELECT string_agg(x, ', ') INTO v_date FROM (
    SELECT 'red_uat.' || c || ' (' || n || ')' AS x FROM (
      SELECT 'reprezentant_uat_telefon' c, count(*) FILTER (WHERE reprezentant_uat_telefon IS NOT NULL) n FROM public.red_uat
      UNION ALL SELECT 'termen_confirmare', count(*) FILTER (WHERE termen_confirmare IS NOT NULL) FROM public.red_uat
      UNION ALL SELECT 'afisare_ora', count(*) FILTER (WHERE afisare_ora IS NOT NULL) FROM public.red_uat
      UNION ALL SELECT 'afisare_reprezentant_gazpet', count(*) FILTER (WHERE afisare_reprezentant_gazpet IS NOT NULL) FROM public.red_uat
      UNION ALL SELECT 'adresa_nr', count(*) FILTER (WHERE adresa_nr IS NOT NULL) FROM public.red_uat
      UNION ALL SELECT 'adresa_data', count(*) FILTER (WHERE adresa_data IS NOT NULL) FROM public.red_uat) u WHERE n > 0
    UNION ALL SELECT 'red_proiecte.apm_nume (' || count(*) || ')' FROM public.red_proiecte WHERE apm_nume IS NOT NULL HAVING count(*) > 0
    UNION ALL SELECT 'red_numere.AU (' || ultimul || ')' FROM public.red_numere WHERE cheie = 'AU') d;
  IF v_date IS NOT NULL THEN
    IF current_setting('gazpet.revenire_20261127a_forta', true) IS DISTINCT FROM 'DA' THEN
      RAISE EXCEPTION '20261127a revenire: exista date in obiectele de scos (%) — refuz fara gazpet.revenire_20261127a_forta = DA', v_date;
    END IF;
    RAISE NOTICE '20261127a revenire FORTATA: se pierd %', v_date;
  END IF;
END $pre$;

DELETE FROM public.red_numere WHERE cheie = 'AU';
DROP INDEX public.red_uat_adresa_nr_uq;
DROP TRIGGER trg_red_versiune ON public.red_proiecte;
DROP TRIGGER trg_red_versiune ON public.red_uat;
DROP FUNCTION public.fn_red_versiune_creste();
ALTER TABLE public.red_proiecte DROP COLUMN versiune;
ALTER TABLE public.red_uat DROP COLUMN versiune;
ALTER TABLE public.red_uat
  DROP CONSTRAINT red_uat_zile_ordonate, DROP CONSTRAINT red_uat_termen_inainte, DROP CONSTRAINT red_uat_afisare_ordonata,
  DROP COLUMN reprezentant_uat_telefon, DROP COLUMN termen_confirmare, DROP COLUMN afisare_ora, DROP COLUMN afisare_reprezentant_gazpet,
  DROP COLUMN adresa_nr, DROP COLUMN adresa_data;
ALTER TABLE public.red_proiecte DROP COLUMN apm_nume;

-- corpul fn_red_numar_document exact ca în 20261126a (fără 'AU')
CREATE OR REPLACE FUNCTION public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cheie text; v_n int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  CASE p_tip
    WHEN 'C' THEN v_cheie := 'C';
    WHEN 'PVA', 'PVB' THEN
      IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
      v_cheie := p_tip || '-' || p_uat3;
    WHEN 'PVC' THEN
      IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
      v_cheie := 'PVC-T' || p_tronson;
    ELSE RAISE EXCEPTION 'redari: tip document necunoscut (%)', p_tip;
  END CASE;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, 1)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1
  RETURNING ultimul INTO v_n;
  IF v_n > 9999 THEN RAISE EXCEPTION 'redari: numerotarea pe % depaseste 9999', v_cheie; END IF;
  RETURN v_cheie || '-' || lpad(v_n::text, 4, '0');
END $fn$;
COMMENT ON FUNCTION public.fn_red_numar_document(text, text, integer) IS 'Redări: următorul număr (C-0001, PVA-HUS-0001, PVB-HUS-0001, PVC-T3-0001), fără refolosire (UPDATE … RETURNING sub lock de rând). Doar admin/editor.';
COMMENT ON TABLE public.red_numere IS 'Redări: ultimul număr alocat pe cheie (C, PVA-HUS, PVB-HUS, PVC-T3). Scris doar de fn_red_numar_document.';

DO $mig$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261127120000';
  END IF;
END $mig$;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat'
               AND column_name IN ('reprezentant_uat_telefon', 'termen_confirmare', 'afisare_ora', 'afisare_reprezentant_gazpet', 'adresa_nr', 'adresa_data'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'apm_nume') THEN
    RAISE EXCEPTION '20261127a revenire postconditie: coloanele au ramas';
  END IF;
  IF to_regprocedure('public.fn_red_versiune_creste()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('red_uat', 'red_proiecte') AND column_name = 'versiune') THEN
    RAISE EXCEPTION '20261127a revenire postconditie: versiune / fn_red_versiune_creste au ramas';
  END IF;
  IF position('''AU''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '20261127a revenire postconditie: ramura AU a ramas';
  END IF;
END $post$;
