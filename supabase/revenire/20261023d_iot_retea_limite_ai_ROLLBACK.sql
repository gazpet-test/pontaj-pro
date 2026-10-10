-- REVENIRE 20261023d — readuce iot_verifica_retea() la corpul 20261023c (md5 318f5ec2…), fără alerta de limită Gemini.
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261023d', 'IOT_RETEA_AI_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE
  v_oid oid := to_regprocedure('public.iot_verifica_retea()')::oid;
  v_corp text := $corp$
DECLARE
  d record;
  online boolean;
  asteptat boolean;
  tacut boolean;
  valoare numeric;
  prag record;
  nivel text;
  limita numeric;
  n int := 0;
BEGIN
  FOR d IN
    SELECT extern_id, nume, meta, ultima_citire, citit_la
    FROM public.iot_dispozitive
    WHERE sursa = 'retea' AND activ = true
  LOOP
    asteptat := COALESCE((d.meta->>'asteptat_online')::boolean, true);
    online := (d.ultima_citire->>'online') IS NOT DISTINCT FROM 'true';
    tacut := d.citit_la IS NULL OR d.citit_la < now() - interval '20 minutes';

    IF asteptat THEN
      IF (NOT online) OR tacut THEN
        IF d.extern_id = '192.168.1.1' THEN
          PERFORM public.iot_alerta(
            p_type => 'error',
            p_title => format('Rețea: %s nu răspunde (gateway)', d.nume),
            p_message => format('Routerul principal nu răspunde — posibil rețea căzută. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodată')));
        ELSE
          PERFORM public.iot_alerta(
            p_type => 'warning',
            p_title => format('Rețea: %s nu răspunde', d.nume),
            p_message => format('Dispozitiv offline sau tăcut. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodată')));
        END IF;
        n := n + 1;
        CONTINUE;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    -- 09.10.2026: + gpu_temp > 80 °C și disk_pct > 90 % (doar warning; critical NULL = fără prag de eroare)
    FOR prag IN SELECT * FROM (VALUES
      ('cpu_temp', 'CPU', 70::numeric, 85::numeric, '°C'),
      ('hdd_max', 'discuri', 50, 60, '°C'),
      ('gpu_temp', 'GPU', 80, NULL, '°C'),
      ('disk_pct', 'disc ocupat', 90, NULL, '%')
    ) AS p(cheie, eticheta, warning, critical, unitate)
    LOOP
      IF jsonb_typeof(d.ultima_citire -> prag.cheie) IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
      valoare := (d.ultima_citire ->> prag.cheie)::numeric;
      IF prag.critical IS NOT NULL AND valoare > prag.critical THEN nivel := 'error'; limita := prag.critical;
      ELSIF valoare > prag.warning THEN nivel := 'warning'; limita := prag.warning;
      ELSE CONTINUE; END IF;
      PERFORM public.iot_alerta(
        p_type => nivel,
        p_title => format('%s: %s > %s %s', d.nume, prag.eticheta, limita, prag.unitate),
        p_message => format('Valoare: %s %s. Ora citirii: %s.', valoare, prag.unitate, d.citit_la));
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$corp$;
  v_meta jsonb;
BEGIN
  IF current_setting('gazpet.revenire_20261023d', true) IS DISTINCT FROM 'IOT_RETEA_AI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023d: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261023d=%') THEN
    RAISE EXCEPTION '20261023d: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261023d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF v_oid IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid AND md5(p.prosrc) = 'd6e0db3c7c2f6b49497b267e1bf06ac5' AND l.lanname = 'plpgsql' AND p.prosecdef
          AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
          AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
          AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20261023d: preconditie iot_verifica_retea (corp/atribute/ACL)';
  END IF;
  IF md5(v_corp) IS DISTINCT FROM '318f5ec25b0e4a3ffae091b29cf58916' THEN RAISE EXCEPTION '20261023d: corp nou neasteptat'; END IF;
  SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') INTO v_meta FROM pg_proc p WHERE p.oid = v_oid;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.iot_verifica_retea() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO %L, %L AS %L',
    'public', 'pg_temp', v_corp);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '318f5ec25b0e4a3ffae091b29cf58916'
     OR (SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_meta THEN
    RAISE EXCEPTION '20261023d: postconditie iot_verifica_retea';
  END IF;
  IF current_setting('gazpet.revenire_20261023d', true) IS DISTINCT FROM 'IOT_RETEA_AI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023d: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261023d', '', true);
END $revenire$;
