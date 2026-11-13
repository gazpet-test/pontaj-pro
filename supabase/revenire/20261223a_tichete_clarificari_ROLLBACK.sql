-- Revenire 20261223a_tichete_clarificari. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate cele 7 funcții create de migrare (amprenta corpului + proprietățile verificate înainte: altă stare = refuz, nimic schimbat).
-- Tabelele, triggerele și funcțiile existente NU se ating.
-- REFUZĂ dacă protocolul a fost folosit: un tichet cu metadata.clarificari_erp sau un comentariu automat (fără autor, cu antetul
--   protocolului). Evidența și mesajele trimise rămân dovada discuției; NU se șterg de aici. ÎN LOC de revenire, oprirea se face din
--   promptul rutinei (se scoate pasul de clarificări, docs/TICHETE_CLARIFICARI.md): funcțiile rămân, dar nu le mai cheamă nimeni.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261223120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261223a_tichete_clarificari_ROLLBACK:<txid>') și plafonul; fără ele
--   fișierul refuză.
-- Ordinea: 1. gărzile și starea EXACTĂ a migrării (doar catalog); 2. tichete EXCLUSIVE + tichete_comentarii SHARE (NOWAIT, reîncercat
--   până la 1 s de la BEGIN) ÎNAINTEA verificării „nefolosit”: un apel în curs (ține rândul tichetului: ROW SHARE / ROW EXCLUSIVE) face
--   blocarea să aștepte până își termină scrierea, deci scrierea lui e numărată; un apel care pornește după blocare așteaptă rândul,
--   iar după COMMIT-ul revenirii găsește funcția scoasă (verificarea „protocol_retras” de după lock) și nu scrie nimic. Sub lock:
--   reverificarea stării, „nefolosit”, DROP, postcondiția.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261223a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261223a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261223a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.tichete IN EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.tichete_comentarii IN SHARE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261223a revenire: BUGET_LOCK: tichete / tichete_comentarii ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
    END IF;
    -- starea exactă: cele 7 funcții, cu corpul revizuit (amprenta) și proprietățile din migrare
    FOR r IN SELECT * FROM (VALUES
        ('public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz)', 'fn_tichet_clarificare_zile_lucratoare', 'sql', false,
         -- AMPRENTA-START zile
         '8b0789e91b0e0dfe626dcd296c2ccf18'
         -- AMPRENTA-END zile
        ),
        ('public.fn_tichet_clarificare_intrebari_motiv(text[])', 'fn_tichet_clarificare_intrebari_motiv', 'sql', false,
         -- AMPRENTA-START intrebari
         '1bf18bc29805356843e22705c6fac79c'
         -- AMPRENTA-END intrebari
        ),
        ('public.fn_tichet_clarificare_apelant_ok()', 'fn_tichet_clarificare_apelant_ok', 'sql', false,
         -- AMPRENTA-START apelant
         'd42b2449714cd346a7182c8a7901775e'
         -- AMPRENTA-END apelant
        ),
        ('public.fn_tichet_clarificare_stare_tichet(bigint)', 'fn_tichet_clarificare_stare_tichet', 'plpgsql', false,
         -- AMPRENTA-START stare_tichet
         '3d76bb3352105c14f020f37e29579c27'
         -- AMPRENTA-END stare_tichet
        ),
        ('public.fn_tichet_clarificare_trimite(bigint, integer, text[])', 'fn_tichet_clarificare_trimite', 'plpgsql', true,
         -- AMPRENTA-START trimite
         'c7fb536b2c1cd977b46036e865a8691b'
         -- AMPRENTA-END trimite
        ),
        ('public.fn_tichet_clarificare_incheie(bigint, text)', 'fn_tichet_clarificare_incheie', 'plpgsql', true,
         -- AMPRENTA-START incheie
         '1f1c1be5743f40eeda7a3db4a6be927f'
         -- AMPRENTA-END incheie
        ),
        ('public.fn_tichet_clarificare_stare()', 'fn_tichet_clarificare_stare', 'plpgsql', true,
         -- AMPRENTA-START stare
         '08d76f390450e5d11a777637640fb76e'
         -- AMPRENTA-END stare
        )
      ) v(fn, nume, limbaj, definer, amp) LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                      WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp
                        AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
         OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.nume) <> 1 THEN
        RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, %)', v_pas, r.nume;
      END IF;
      -- nimic din afara migrării nu depinde de funcție (catalog + apeluri textuale: plpgsql nu lasă dependențe)
      IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure(r.fn)
                   AND NOT (d.classid = 'pg_proc'::regclass AND d.objid IN (SELECT p.oid FROM pg_proc p
                              WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%')))
         OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                       AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_tichet\_clarificare\_%')
                       AND p.prosrc ~ ('\m' || r.nume || '\M')) THEN
        RAISE EXCEPTION '20261223a revenire: alte obiecte depind de functia %', r.nume;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') <> 7 THEN
      RAISE EXCEPTION '20261223a revenire: starea nu e cea din 20261223a (pasul %, alte functii fn_tichet_clarificare_*)', v_pas;
    END IF;
  END LOOP;
  -- sub lock: protocolul nefolosit (evidența și mesajele trimise nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.tichete x WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) THEN
    RAISE EXCEPTION '20261223a revenire: exista tichete cu clarificari (metadata.clarificari_erp); in loc: oprirea pasului din promptul rutinei';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tichete_comentarii c
              WHERE c.autor IS NULL AND (c.text LIKE 'Clarificare _/2' || chr(10) || '%' OR c.text LIKE 'Clarificările automate s-au încheiat.%')) THEN
    RAISE EXCEPTION '20261223a revenire: exista comentarii automate de clarificare; in loc: oprirea pasului din promptul rutinei';
  END IF;
  DROP FUNCTION public.fn_tichet_clarificare_stare();
  DROP FUNCTION public.fn_tichet_clarificare_incheie(bigint, text);
  DROP FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[]);
  DROP FUNCTION public.fn_tichet_clarificare_stare_tichet(bigint);
  DROP FUNCTION public.fn_tichet_clarificare_apelant_ok();
  DROP FUNCTION public.fn_tichet_clarificare_intrebari_motiv(text[]);
  DROP FUNCTION public.fn_tichet_clarificare_zile_lucratoare(timestamptz, timestamptz);
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_tichet\_clarificare\_%') THEN
    RAISE EXCEPTION '20261223a revenire post: au ramas functii';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261223a_tichete_clarificari_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261223a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261223a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
