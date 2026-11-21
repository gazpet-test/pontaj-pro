-- Revenire 20270106a_executie_semnale. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate TOT ce a creat migrarea: vederea v_executie_semnale, tabelele executie_semnale și executie_semnale_jurnal (cu politicile, trigger-ele,
-- cheile și indexurile lor) și cele 10 funcții fn_executie_semnal_*. Tabelele și funcțiile existente (executie_proiecte, employees, lanțul
-- 20261209a) NU se ating.
-- Starea EXACTĂ a migrării e verificată înainte, pe DEFINIȚII (nu doar pe numere): coloanele fiecărui tabel (nume, tip, în ordine), constrângerile
-- și indexurile (după nume), politicile (comanda, permisivă, rolurile, expresia exactă), trigger-ele (funcția, tipul, activ, fără WHEN / argumente /
-- coloane), funcțiile (corpul = amprenta fără CR, limbajul, DEFINER-ul, search_path-ul, proprietarul, EXECUTE pe fiecare rol), drepturile pe
-- tabele / vedere / secvențe (fiecare drept, pe fiecare rol, plus PUBLIC și coloane) și ACL-ul EXACT (niciun alt rol), nimic străin dependent.
-- Altă stare = refuz, nimic schimbat. Amprentele funcțiilor se regenerează cu scripts/executie_semnale_amprente.mjs --actualizeaza-revenire.
-- REFUZĂ dacă există date: un semnal sau un rând de jurnal (semnalele și deciziile oamenilor asupra lor sunt istoric; golirea = decizie
-- separată a owner-ului: preview → „da” → export → apply, într-o tranzacție armată, înaintea acestui fișier — trigger-ele refuză DELETE / TRUNCATE
-- pentru oricine, inclusiv postgres, deci golirea cere dezactivarea lor în aceeași tranzacție).
-- ÎNAINTE de revenire: agentul de noapte (faza 2, dacă e pornit) se oprește; ecranul „🔔 Semnale” arată „indisponibil după revenire” (vederea lipsește).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270106120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul (gazpet.livrare_migrare = '20270106a_executie_semnale_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea (L06, L14): 1. gărzile + starea exactă (doar catalog); 2. lock-urile, NOWAIT, cu bugetul de 1 s de la BEGIN verificat înaintea fiecărei
--   încercări și DUPĂ obținere, în ordinea: executie_semnale, executie_semnale_jurnal (ACCESS EXCLUSIVE), ÎNAINTEA verificării „fără date”;
--   3. sub lock: starea din nou, „fără date”, DROP-urile (fără CASCADE), postcondiția. Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text;
  v_tabele constant text[] := ARRAY['executie_semnale', 'executie_semnale_jurnal'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270106a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20270106a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270106a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20270106a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.executie_semnale IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_semnale_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20270106a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    IF to_regclass('public.executie_semnale') IS NULL OR to_regclass('public.executie_semnale_jurnal') IS NULL OR to_regclass('public.v_executie_semnale') IS NULL
       OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.v_executie_semnale')) IS DISTINCT FROM 'v'
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.v_executie_semnale') AND 'security_invoker=on' = ANY (reloptions)) THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, tabele / vedere)', v_pas;
    END IF;
    -- coloanele fiecărui tabel: numele + tipul, în ordine (o coloană adăugată / schimbată = alt obiect decât cel creat)
    SELECT string_agg(t.tab, ', ') INTO v_rau FROM (VALUES
        -- COLOANE-START
        ('executie_semnale', 'id:bigint,proiect_id:bigint,flux:text,tip:text,obiect:text,gravitate:text,titlu:text,detalii:text,constatare:text,surse_consultate:text[],dovada_sursa:text,dovada_data:date,dovada_fragment:text,dovada_ref:text,dovada_amprenta:text,termen:date,termen_baza:text,termen_confirmat:boolean,incertitudine:text,propunere:text,responsabil_employee_id:integer,responsabil_sursa:text,stare:text,stare_motiv:text,stare_dovada:text,actiune_ref:text,stare_de:uuid,stare_la:timestamp with time zone,regula_versiune:text,detectat_la:timestamp with time zone,ultima_verificare:timestamp with time zone,versiune:integer'),
        ('executie_semnale_jurnal', 'id:bigint,semnal_id:bigint,proiect_id:bigint,actiune:text,stare_veche:text,stare_noua:text,actor:text,actor_profile:uuid,motiv:text,dovada:text,valori:jsonb,regula_versiune:text,creat_la:timestamp with time zone')
        -- COLOANE-END
      ) t(tab, coloane)
     WHERE t.coloane IS DISTINCT FROM (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)
                                         FROM pg_attribute a WHERE a.attrelid = ('public.' || t.tab)::regclass AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, coloane: %)', v_pas, v_rau;
    END IF;
    -- constrângerile (fără rândurile NOT NULL ale PG18) și indexurile, după nume, exact
    IF (SELECT string_agg(k.conname, ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = 'public.executie_semnale'::regclass AND k.contype <> 'n')
         IS DISTINCT FROM 'executie_semnale_amprenta_ck,executie_semnale_cheie_uq,executie_semnale_constatare_ck,executie_semnale_flux_ck,executie_semnale_gravitate_ck,executie_semnale_obiect_ck,executie_semnale_pkey,executie_semnale_proiect_id_fkey,executie_semnale_regula_ck,executie_semnale_responsabil_ck,executie_semnale_responsabil_employee_id_fkey,executie_semnale_stare_ck,executie_semnale_termen_ck,executie_semnale_texte_ck,executie_semnale_timp_ck,executie_semnale_tip_ck,executie_semnale_titlu_ck'
       OR (SELECT string_agg(k.conname, ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = 'public.executie_semnale_jurnal'::regclass AND k.contype <> 'n')
         IS DISTINCT FROM 'executie_semnale_jurnal_actiune_ck,executie_semnale_jurnal_actor_ck,executie_semnale_jurnal_pkey,executie_semnale_jurnal_semnal_id_fkey,executie_semnale_jurnal_valori_ck'
       OR (SELECT string_agg(ic.relname, ',' ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = 'public.executie_semnale'::regclass)
         IS DISTINCT FROM 'executie_semnale_cheie_uq,executie_semnale_pkey,executie_semnale_proiect_stare_idx,executie_semnale_responsabil_idx'
       OR (SELECT string_agg(ic.relname, ',' ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = 'public.executie_semnale_jurnal'::regclass)
         IS DISTINCT FROM 'executie_semnale_jurnal_pkey,executie_semnale_jurnal_semnal_idx'
       OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass) AND NOT k.convalidated) THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, constrangeri / indexuri)', v_pas;
    END IF;
    -- drepturile pe tabele / vedere, fiecare pe rând: doar SELECT pentru authenticated / service_role; nimic pentru anon, PUBLIC, pe coloane
    SELECT string_agg(DISTINCT x.tab || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
      FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x(tab), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
     WHERE has_table_privilege(y.rol, ('public.' || x.tab)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee = 0)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_attribute a ON a.attrelid = ('public.' || x.tab)::regclass WHERE a.attnum > 0 AND a.attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                   WHERE NOT c.relrowsecurity OR c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> 'postgres')
       OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.v_executie_semnale'::regclass)) <> 'postgres' THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, drepturi / RLS: %)', v_pas, coalesce(v_rau, 'PUBLIC / coloane / RLS / proprietar');
    END IF;
    -- ACL-ul EXACT: pe tabele / vedere doar proprietarul + SELECT (fără GRANT OPTION) pentru authenticated / service_role, niciun alt rol;
    -- pe secvențele de identitate doar proprietarul (postgres)
    SELECT string_agg(DISTINCT c.relname || '/' || CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '/' || e.privilege_type, ', ') INTO v_rau
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) e
     WHERE c.oid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x
                     UNION ALL SELECT pg_get_serial_sequence('public.' || x, 'id')::regclass FROM unnest(v_tabele) x)
       AND e.grantee <> c.relowner
       AND NOT (c.relkind IN ('r', 'v') AND e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid) AND e.privilege_type = 'SELECT' AND NOT e.is_grantable);
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x WHERE pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = pg_get_serial_sequence('public.' || x, 'id')::regclass)) IS DISTINCT FROM 'postgres') THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, drepturi ACL: %)', v_pas, coalesce(v_rau, 'proprietarul secventei');
    END IF;
    -- politicile: EXACT cele 2, fiecare cu definiția ei (comanda, permisivă, rolurile, expresia)
    SELECT string_agg(coalesce(a.nume, p.polname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_semnale'::regclass, 'executie_semnale_citire', 'r', 'fn_executie_semnal_drept(proiect_id, responsabil_employee_id)'),
        ('public.executie_semnale_jurnal'::regclass, 'executie_semnale_jurnal_citire', 'r', 'fn_executie_semnal_drept_id(semnal_id)')
      ) a(rel, nume, cmd, qual)
      FULL JOIN (SELECT * FROM pg_policy WHERE polrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass)) p
        ON p.polrelid = a.rel AND p.polname = a.nume
     WHERE a.nume IS NULL OR p.oid IS NULL OR p.polcmd::text IS DISTINCT FROM a.cmd OR NOT p.polpermissive
        OR p.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
        OR replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') IS DISTINCT FROM a.qual
        OR p.polwithcheck IS NOT NULL;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, politici: %)', v_pas, v_rau;
    END IF;
    -- trigger-ele: EXACT cele 4, fiecare cu funcția, tipul, activ, fără WHEN / argumente / coloane
    SELECT string_agg(coalesce(a.nume, tg.tgname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_semnale'::regclass, 'trg_executie_semnal_garda', 'public.fn_executie_semnal_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_semnale_jurnal'::regclass, 'trg_executie_semnal_jurnal_garda', 'public.fn_executie_semnal_jurnal_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_semnale'::regclass, 'trg_executie_semnale_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32),
        ('public.executie_semnale_jurnal'::regclass, 'trg_executie_semnale_jurnal_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32)
      ) a(rel, nume, fn, tip)
      FULL JOIN (SELECT * FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass)) tg
        ON tg.tgrelid = a.rel AND tg.tgname = a.nume
     WHERE a.nume IS NULL OR tg.oid IS NULL OR tg.tgfoid IS DISTINCT FROM to_regprocedure(a.fn) OR tg.tgtype IS DISTINCT FROM a.tip::int2
        OR tg.tgenabled IS DISTINCT FROM 'O' OR tg.tgqual IS NOT NULL OR tg.tgnargs <> 0 OR tg.tgattr::text <> '';
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, trigger-e: %)', v_pas, v_rau;
    END IF;
    -- funcțiile: exact cele 10, fiecare cu corpul revizuit (amprenta fără CR), limbajul, DEFINER-ul, search_path-ul, proprietarul, EXECUTE pe clasă
    SELECT string_agg(a.fn, ', ') INTO v_rau FROM (VALUES
        -- AMPRENTE-START
        ('public.fn_executie_semnal_drept(bigint, integer)', 'sql', true, 'e518d28f2e083bbbb58f1a76f408a998'),
        ('public.fn_executie_semnal_drept_id(bigint)', 'sql', true, 'fef8852a3559d16ce8ef6414c8f633ff'),
        ('public.fn_executie_semnal_tranzitie(text, text, text)', 'sql', false, 'c36465e6826f935218a565bd7768df4b'),
        ('public.fn_executie_semnal_amprenta(text, text[], text, date, text, text)', 'sql', false, 'cbcf30d2e6fd749bb639f53ee0be14f4'),
        ('public.fn_executie_semnal_dif(jsonb, jsonb)', 'sql', false, 'e12240cbab35d2468a77fe093456ee84'),
        ('public.fn_executie_semnal_garda()', 'plpgsql', false, 'ee50f35b4d60b262a53e227f1d076d62'),
        ('public.fn_executie_semnal_jurnal_garda()', 'plpgsql', false, '06bfbc1622933e7305aefe0cd2e16efb'),
        ('public.fn_executie_semnal_fara_golire()', 'plpgsql', false, 'cc70f302ba552a0d797b136a6df85b67'),
        ('public.fn_executie_semnal_scrie(jsonb)', 'plpgsql', true, 'ae665fdab77fdd4177768aa63f51953d'),
        ('public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean)', 'plpgsql', true, 'bfe08913bfec2e2e29c6bf461c7cdda3'),
        -- AMPRENTE-END
        ('', '', false, '')
      ) a(fn, limbaj, definer, amp)
      WHERE a.fn <> '' AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                         WHERE p.oid = to_regprocedure(a.fn) AND l.lanname = a.limbaj AND p.prosecdef = a.definer
                           AND md5(replace(p.prosrc, chr(13), '')) = a.amp
                           AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                           AND has_function_privilege('service_role', p.oid, 'EXECUTE') = (a.fn LIKE 'public.fn_executie_semnal_scrie(%')
                           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (a.fn LIKE 'public.fn_executie_semnal_drept(%'
                                 OR a.fn LIKE 'public.fn_executie_semnal_drept_id(%' OR a.fn LIKE 'public.fn_executie_semnal_stare(%')
                           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0));
    IF v_rau IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_semnal\_%') <> 10 THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, functii: %)', v_pas, coalesce(v_rau, 'alt numar');
    END IF;
    -- nimic din afara migrării nu depinde de obiectele ei: vederi (în afara celei proprii) / chei străine spre tabele, funcții care le numesc, alte politici
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x)
                  AND w.ev_class <> 'public.v_executie_semnale'::regclass)
       OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.v_executie_semnale'::regclass AND w.ev_class <> 'public.v_executie_semnale'::regclass)
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x)
                   AND c.conrelid NOT IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT LIKE 'fn\_executie\_semnal\_%'
                     AND p.prosrc ~ '\m(executie_semnale|executie_semnale_jurnal|v_executie_semnale|fn_executie_semnal_[a-z_]+)\M')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = ANY (v_tabele))
                   AND coalesce(qual, '') || coalesce(with_check, '') ~ '(executie_semnale|fn_executie_semnal_)') THEN
      RAISE EXCEPTION '20270106a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / functii / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără date (semnalele și deciziile oamenilor nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.executie_semnale) OR EXISTS (SELECT 1 FROM public.executie_semnale_jurnal) THEN
    RAISE EXCEPTION '20270106a revenire: exista semnale / jurnal (nu se sterg de aici)';
  END IF;
  DROP VIEW public.v_executie_semnale;
  DROP TABLE public.executie_semnale_jurnal;
  DROP TABLE public.executie_semnale;
  DROP FUNCTION public.fn_executie_semnal_scrie(jsonb);
  DROP FUNCTION public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean);
  DROP FUNCTION public.fn_executie_semnal_drept_id(bigint);
  DROP FUNCTION public.fn_executie_semnal_drept(bigint, integer);
  DROP FUNCTION public.fn_executie_semnal_garda();
  DROP FUNCTION public.fn_executie_semnal_jurnal_garda();
  DROP FUNCTION public.fn_executie_semnal_fara_golire();
  DROP FUNCTION public.fn_executie_semnal_tranzitie(text, text, text);
  DROP FUNCTION public.fn_executie_semnal_amprenta(text, text[], text, date, text, text);
  DROP FUNCTION public.fn_executie_semnal_dif(jsonb, jsonb);
  IF to_regclass('public.executie_semnale') IS NOT NULL OR to_regclass('public.executie_semnale_jurnal') IS NOT NULL OR to_regclass('public.v_executie_semnale') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_semnal\_%') THEN
    RAISE EXCEPTION '20270106a revenire post: au ramas obiecte';
  END IF;
  -- lanțul 20261209a a rămas neatins (aceleași amprente ca în garda migrării)
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES
        ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155'),
        ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'),
        ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b')
      ) a(semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura) AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta) <> 3 THEN
    RAISE EXCEPTION '20270106a revenire post: lantul de drept 20261209a difera';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270106a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
