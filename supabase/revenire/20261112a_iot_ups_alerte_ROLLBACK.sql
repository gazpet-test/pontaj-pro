-- UPS alerts. Runner version: 20261112120000. LF / ASCII.
-- Unicode placeholders preserve the previous prosrc byte for byte.
DO $iot_ups_rollback$
DECLARE
  v_oid oid := to_regprocedure('public.iot_verifica_retea()')::oid;
  v_corp text := $iot_ups_body_20261112a$
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
            p_title => format('Re@U539@ea: %s nu r@U259@spunde (gateway)', d.nume),
            p_message => format('Routerul principal nu r@U259@spunde @U8212@ posibil re@U539@ea c@U259@zut@U259@. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodat@U259@')));
        ELSE
          PERFORM public.iot_alerta(
            p_type => 'warning',
            p_title => format('Re@U539@ea: %s nu r@U259@spunde', d.nume),
            p_message => format('Dispozitiv offline sau t@U259@cut. Ultima citire: %s.',
              COALESCE(d.citit_la::text, 'niciodat@U259@')));
        END IF;
        n := n + 1;
        CONTINUE;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    -- 09.10.2026: + gpu_temp > 80 @U176@C @U537@i disk_pct > 90 % (doar warning; critical NULL = f@U259@r@U259@ prag de eroare)
    FOR prag IN SELECT * FROM (VALUES
      ('cpu_temp', 'CPU', 70::numeric, 85::numeric, '@U176@C'),
      ('hdd_max', 'discuri', 50, 60, '@U176@C'),
      ('gpu_temp', 'GPU', 80, NULL, '@U176@C'),
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

    -- 09.10.2026: limita s@U259@pt@U259@m@U226@nal@U259@ a contului Antigravity (Gemini) sub 15 % @U8594@ warning (prag @U8222@sub@U8221@, nu @U8222@peste@U8221@)
    IF jsonb_typeof(d.ultima_citire -> 'ai_gemini_ramas_pct') = 'number'
       AND (d.ultima_citire ->> 'ai_gemini_ramas_pct')::numeric < 15 THEN
      PERFORM public.iot_alerta(
        p_type => 'warning',
        p_title => 'Limita Gemini (Antigravity) aproape consumat@U259@',
        p_message => format('%s: r@U259@mas %s %%. Reset: %s. Ora citirii: %s.', d.nume,
          d.ultima_citire ->> 'ai_gemini_ramas_pct',
          COALESCE(to_timestamp((d.ultima_citire ->> 'ai_gemini_reset_s')::double precision)::text, 'necunoscut'),
          d.citit_la));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$iot_ups_body_20261112a$;
  v_meta jsonb;
BEGIN
  IF current_user <> 'postgres'
     OR current_setting('gazpet.revenire_20261112a', true) IS DISTINCT FROM 'IOT_UPS_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION '20261112a: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261112a: necesita READ COMMITTED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c
             WHERE lower(c) LIKE 'gazpet.revenire_20261112a=%') THEN
    RAISE EXCEPTION '20261112a: armare persistenta interzisa';
  END IF;
  IF v_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_oid AND md5(p.prosrc) = '6b82a10d73fe3480dfcdc480719f0555' AND l.lanname = 'plpgsql' AND p.prosecdef
      AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
      AND p.proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20261112a: preconditie iot_verifica_retea (corp/atribute/ACL)';
  END IF;
  v_corp := replace(v_corp, '@U539@', chr(539));
  v_corp := replace(v_corp, '@U259@', chr(259));
  v_corp := replace(v_corp, '@U8212@', chr(8212));
  v_corp := replace(v_corp, '@U176@', chr(176));
  v_corp := replace(v_corp, '@U537@', chr(537));
  v_corp := replace(v_corp, '@U226@', chr(226));
  v_corp := replace(v_corp, '@U8594@', chr(8594));
  v_corp := replace(v_corp, '@U8222@', chr(8222));
  v_corp := replace(v_corp, '@U8221@', chr(8221));
  IF md5(v_corp) IS DISTINCT FROM 'd6e0db3c7c2f6b49497b267e1bf06ac5' THEN
    RAISE EXCEPTION '20261112a: corp tinta neasteptat';
  END IF;
  SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') INTO v_meta FROM pg_proc p WHERE p.oid = v_oid;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.iot_verifica_retea() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO %L, %L AS %L',
    'public', 'pg_temp', v_corp);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM 'd6e0db3c7c2f6b49497b267e1bf06ac5'
     OR (SELECT (to_jsonb(p) - 'prosrc' - 'proargdefaults') FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_meta THEN
    RAISE EXCEPTION '20261112a: postconditie iot_verifica_retea';
  END IF;
  IF current_user <> 'postgres'
     OR current_setting('gazpet.revenire_20261112a', true) IS DISTINCT FROM 'IOT_UPS_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION '20261112a: garda final invalida';
  END IF;
END $iot_ups_rollback$;
