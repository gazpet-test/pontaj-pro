-- Revenire 20261222a_sites_drept_creare (runda 2). NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate EXACT ce a creat migrarea: funcția fn_sites_creeaza(text, bigint, text) (runda 3: detaliul COMPLET — proprietățile, ACL-ul întreg pe
-- toate rolurile, corpul — egal cu detaliul acceptat „după” de migrare; altă stare = refuz, nimic schimbat) și cheia de modul santiere_creare din
-- app_modules (rândul exact scris de migrare). Runda 6 (varianta B): readuce corpul EXACT de azi al lui fn_auto_create_executie_proiect
-- (corp_md5 22f95c1e3f15cde32a1d2c11e3259089, copiat din supabase/tests/20261222a_sites_drept_creare_schelet.sql), DOAR dacă detaliul ei e
-- exact cel lăsat de migrare; după readucere, detaliul ei = rândul din baseline (amprenta 65ba246342e6d1594eed6152298e5c3d), altfel refuz.
-- Politicile, triggerele și drepturile lui sites, celelalte funcții existente și restul tabelelor NU se ating (migrarea nu le-a schimbat).
-- REFUZĂ dacă dreptul a fost acordat cuiva (rânduri santiere_creare în user_module_access): ștergerea cheii ar șterge în cascadă și dreptul,
-- fără urmă. Retragerea dreptului = pas separat al coordonatorului (preview → „da” Răzvan → apply), apoi revenirea.
-- Șantierele create prin RPC între aplicare și revenire RĂMÂN (rânduri obișnuite în sites, legate de proiectele lor): sunt date ale
-- utilizatorilor, nu obiecte ale migrării; revenirea nu anulează operațiunile utilizatorilor.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261222120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261222a_sites_drept_creare_ROLLBACK:<txid>') și plafonul; fără ele fișierul
--   refuză.
-- Ordinea lock-urilor (L06): 1. gărzile și starea EXACTĂ (doar catalog); 2. rândul cheii din app_modules FOR UPDATE NOWAIT, reîncercat până la 1 s
--   de la BEGIN (o acordare concurentă a dreptului ia FOR KEY SHARE pe el prin cheia străină, deci după acest lock nu mai poate apărea niciun rând
--   nou); sub lock: reverificarea stării, „niciun drept acordat”, DROP / DELETE, readucerea triggerului, postcondiția (pasul 3). Un apel RPC în
--   curs se termină normal (șantierul lui rămâne, ca mai sus; dacă vede deja triggerul vechi, postcondiția lui refuză, nimic scris); apelurile
--   de după COMMIT primesc „funcția nu există” (interfața: „nu e încă disponibilă”, fără fals succes).
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_det text; v_auto text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261222a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261222a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261222a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- pasul 1: starea exactă (doar catalog); pasul 2: lock-ul cheii, apoi aceeași stare; pasul 3: scoaterea + readucerea triggerului, postcondiția
  FOR v_pas IN 1 .. 3 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          PERFORM 1 FROM public.app_modules WHERE key = 'santiere_creare' FOR UPDATE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261222a revenire: BUGET_LOCK: cheia santiere_creare ocupata; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    IF v_pas = 3 THEN
      -- sub lock: dreptul nu e acordat nimănui (altfel DELETE-ul cheii l-ar șterge în cascadă, fără urmă)
      IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN
        RAISE EXCEPTION '20261222a revenire: dreptul santiere_creare e acordat (user_module_access); retragerea lui e un pas separat, cu acordul owner-ului';
      END IF;
      DROP FUNCTION public.fn_sites_creeaza(text, bigint, text);
      DELETE FROM public.app_modules WHERE key = 'santiere_creare';
      -- corpul de azi al triggerului de proiect automat, readus (proprietarul și drepturile rămân: CREATE OR REPLACE)
      -- >>> TRIGGER_AUTO_VECHI 20261222a (copiat identic din supabase/tests/20261222a_sites_drept_creare_schelet.sql, FUNCTII_PRODUCTIE)
CREATE OR REPLACE FUNCTION public.fn_auto_create_executie_proiect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cod   TEXT;
  v_nume  TEXT;
  v_try   INTEGER := 0;
  v_cod_final TEXT;
BEGIN
  -- Nu crea pentru Sediu
  IF NEW.name ILIKE '%sediu%' THEN
    RETURN NEW;
  END IF;

  -- Dacă există deja proiect cu același site_id, nu dubla
  IF EXISTS (SELECT 1 FROM executie_proiecte WHERE site_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Generează cod_intern din nume
  v_cod  := fn_site_name_to_cod_intern(NEW.name);
  v_nume := UPPER(TRIM(
    REGEXP_REPLACE(NEW.name, '^Gazpet\s*[-–]\s*', '', 'i')
  ));

  -- Dacă cod colizionează, adaugă sufixul _2, _3 etc.
  v_cod_final := v_cod;
  WHILE EXISTS (SELECT 1 FROM executie_proiecte WHERE cod_intern = v_cod_final) LOOP
    v_try := v_try + 1;
    v_cod_final := v_cod || '_' || v_try;
  END LOOP;

  -- INSERT proiect nou — beneficiar NULL (utilizatorul completează la adăugarea contractului)
  INSERT INTO executie_proiecte (cod_intern, nume, beneficiar, site_id, activ)
  VALUES (v_cod_final, v_nume, NULL, NEW.id, true);

  RETURN NEW;
END;
$function$;
      -- <<< TRIGGER_AUTO_VECHI 20261222a
    END IF;
    -- starea exactă a celor două funcții (runda 3, Jakarinos r2 P2-2; runda 6): detaliul COMPLET, calculat cu EXACT expresia rândului „functie”
    -- din AMPRENTA_L15 v1 (tip, limbaj, definer, volatilitate, strict, leakproof, proprietar, config, tipul întors, ACL-ul ÎNTREG pe toate
    -- rolurile — inclusiv PUBLIC, anon, service_role și GRANT OPTION —, corpul). Pașii 1-2: = EXACT detaliile acceptate „după” de migrare
    -- (amp_verifica_20261222a); orice derivă după aplicare (un GRANT nou, o proprietate schimbată, alt corp) = refuz, nimic schimbat. Pasul 3:
    -- RPC-ul lipsește, iar triggerul are EXACT detaliul din baseline. Testul leagă expresia de AMPRENTA_L15 și constantele de migrare / baseline.
    v_det := NULL; v_auto := NULL;
    SELECT max(x.d) FILTER (WHERE x.oid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)')),
           max(x.d) FILTER (WHERE x.oid = to_regprocedure('public.fn_auto_create_executie_proiect()'))
      INTO v_det, v_auto
      FROM (SELECT p.oid,
    -- >>> DETALIU_FUNCTIE (expresia din AMPRENTA_L15 v1, copiată identic)
           'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
           || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
           || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
           || ', acl=' || coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')
           || ', corp_md5=' || md5(replace(p.prosrc, chr(13), ''))
           || ', sqlbody_md5=' || coalesce(md5(replace(pg_get_function_sqlbody(p.oid), chr(13), '')), '-')
    -- <<< DETALIU_FUNCTIE
                   AS d
              FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid IN (to_regprocedure('public.fn_sites_creeaza(text, bigint, text)'), to_regprocedure('public.fn_auto_create_executie_proiect()'))) x;
    IF v_pas = 3 THEN
      IF v_det IS NOT NULL
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza')
         OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') THEN
        RAISE EXCEPTION '20261222a revenire post: au ramas obiecte';
      END IF;
      IF v_auto IS DISTINCT FROM
           -- DETALIU-BASELINE-START auto
           'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=trigger, acl=postgres:EXECUTE, service_role:EXECUTE, corp_md5=22f95c1e3f15cde32a1d2c11e3259089, sqlbody_md5=-'
           -- DETALIU-BASELINE-END auto
         OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'fn_auto_create_executie_proiect') <> 1 THEN
        RAISE EXCEPTION '20261222a revenire post: triggerul de proiect automat nu are detaliul din baseline: %', coalesce(v_auto, 'LIPSESTE');
      END IF;
      EXIT;
    END IF;
    IF v_det IS DISTINCT FROM
         -- DETALIU-DUPA-START rpc
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, corp_md5=5ab5b228461158157f833c4a242c1335, sqlbody_md5=-'
         -- DETALIU-DUPA-END rpc
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'fn_sites_creeaza') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, functia): %', v_pas, coalesce(v_det, 'LIPSESTE');
    END IF;
    IF v_auto IS DISTINCT FROM
         -- DETALIU-DUPA-START auto
         'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=trigger, acl=postgres:EXECUTE, service_role:EXECUTE, corp_md5=d6b7881fdfec0d1419a173a45a764c6a, sqlbody_md5=-'
         -- DETALIU-DUPA-END auto
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'fn_auto_create_executie_proiect') <> 1 THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, triggerul de proiect automat): %', v_pas, coalesce(v_auto, 'LIPSESTE');
    END IF;
    -- cheia de modul: exact rândul scris de migrare (coloanele pe care le-a scris; o altă stare = refuz, nu se șterge un rând schimbat de altcineva)
    IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') <> 1
       OR NOT EXISTS (SELECT 1 FROM public.app_modules m WHERE m.key = 'santiere_creare'
                        AND (m.parent_key::text, m.name::text, m.icon::text, m.description::text, m.is_active, m.show_on_homepage) IS NOT DISTINCT FROM
                            -- RAND-CHEIE-START (= VALUES din INSERT-ul migrării; testul le leagă)
                            (NULL::text, 'Creare șantiere', '🏗️',
        'Dreptul de a crea un șantier nou (Execuție → Proiect nou și Admin → Șantiere), cu Execuție editor / admin. Nivel editor sau admin. Nu dă drept de modificare sau ștergere. 20261222a.',
        true, false)
                            -- RAND-CHEIE-END
                     ) THEN
      RAISE EXCEPTION '20261222a revenire: starea nu e cea din 20261222a (pasul %, cheia de modul)', v_pas;
    END IF;
    -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass
                 AND d.refobjid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND d.deptype <> 'i')
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.oid <> to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') AND p.prosrc ~ '\mfn_sites_creeaza\M') THEN
      RAISE EXCEPTION '20261222a revenire: alte obiecte depind de functia fn_sites_creeaza';
    END IF;
  END LOOP;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261222a_sites_drept_creare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261222a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261222a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
