-- Revenire 20261220a_sms_numere_serviciu. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelul sms_numere_serviciu (cu triggerul, funcția lui și secvența), funcțiile fn_sms_numere_serviciu_lista,
-- fn_sms_numere_serviciu_admin, fn_sms_numar_serviciu_salveaza, fn_sms_numar_serviciu_dezactiveaza; varianta cu 5 parametri a
-- fn_sms_lot_intern_creeaza -> înapoi varianta cu 4 parametri (corpul 20261130b, EXACT, cu drepturile ei: EXECUTE doar authenticated);
-- fn_sms_lot_destinatari -> corpul 20261130b (drepturile neschimbate); CHECK-ul sms_mesaje.destinatar_tip -> ('angajat', 'detinator').
-- Starea EXACTĂ a migrării se verifică înainte (amprentele corpurilor noi, drepturile, triggerul, CHECK-ul): altă stare = refuz, nimic schimbat.
-- r2: și cele cinci funcții noi au amprenta COMPLETĂ de la aplicare (blocul „AMPRENTE-NOI 20261220a”, identic cu postcondiția migrării):
--   corp, DEFINER, proprietar, search_path, volatilitate, tipul întors, ACL, o singură variantă; una modificată după aplicare = refuz.
--
-- REFUZĂ (nimic schimbat), verificat SUB lock-uri:
--   * dacă există mesaje către numere de serviciu (sms_mesaje.destinatar_tip = 'serviciu', în orice lot, în orice stare): sunt jurnalul
--     trimiterii, nu se șterg, iar CHECK-ul vechi nu le-ar mai accepta. ÎN LOC de revenire se face OPRIREA: owner-ul dezactivează toate
--     numerele din ⚙ Setări -> Numere de serviciu (dispar din „Compune”, crearea unui lot cu ele e refuzată în BD), iar loturile active care le
--     mai au se anulează din Istoric. Tabelul și tipul 'serviciu' rămân (istoricul „Mesajele lotului” arată în continuare denumirea).
--     Dacă trebuie și ascuns codul, o migrare nouă retrage EXECUTE pe cele patru funcții noi (fără să atingă datele) — necesită aprobare;
--   * dacă tabelul are rânduri (numere salvate, chiar dezactivate), fără mesaje: sunt configurare nouă (L14). Coordonatorul le citește
--     (SELECT id, denumire, activ — telefonul îl vede doar owner-ul în ecran), owner-ul spune „da” și le notează, apoi tot el decide: fie
--     OPRIREA de mai sus, fie ștergerea lor conștientă înainte de revenire (DML separat, cu preview, după regula 3 din CLAUDE.md).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (comanda exactă):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261220a_sms_numere_serviciu_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261220120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul de livrare (gazpet.livrare_migrare = '20261220a_sms_numere_serviciu_ROLLBACK:<txid>') și plafonul; fără ele
--   fișierul refuză.
-- Ordinea lock-urilor (aceeași ca la crearea unui lot: numere -> lot -> mesaje): sms_numere_serviciu ACCESS EXCLUSIVE (DROP TABLE),
--   sms_loturi SHARE UPDATE EXCLUSIVE (doar DDL), sms_mesaje ACCESS EXCLUSIVE (CHECK); NOWAIT, reîncercat până la 1 s de la BEGIN.
--   „Fără date” se verifică DUPĂ lock-uri (L14).
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_n bigint; v_dif text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261220a_sms_numere_serviciu_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261220a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261220a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261220a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261220a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261220a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- pasul 1 fără lock (refuz devreme, nimic ținut), pasul 2 sub lock-uri (catalog + „fără date”)
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.sms_numere_serviciu IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.sms_loturi IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.sms_mesaje IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          IF clock_timestamp() >= now() + interval '1 second' THEN
            RAISE EXCEPTION '20261220a revenire: BUGET_LOCK: sms_numere_serviciu / sms_loturi / sms_mesaje ocupate; % incercari, % ms de la BEGIN; nimic schimbat',
              v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
          END IF;
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      RAISE NOTICE '20261220a revenire: lock-uri la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
    END IF;
    -- starea exactă a migrării: tabelul + triggerul, funcțiile noi (corpuri revizuite, DEFINER, search_path, proprietar, drepturi), CHECK-ul
    IF to_regclass('public.sms_numere_serviciu') IS NULL
       OR to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)') IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_sms_lot_intern_creeaza') <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])')
                        AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        AND md5(replace(p.prosrc, chr(13), '')) =
                            -- AMPRENTA-START crearea lotului
                            '4f2c94e800d629f783290971550298f6'
                            -- AMPRENTA-END crearea lotului
                        AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                        AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0))
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_lot_destinatari(uuid)')
                        AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                        AND md5(replace(p.prosrc, chr(13), '')) =
                            -- AMPRENTA-START lista fixata
                            '16b73cb340232b8eef78449102d565aa'
                            -- AMPRENTA-END lista fixata
                        )
       OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid = 'public.sms_numere_serviciu'::regclass AND NOT tg.tgisinternal) <> 1
       OR (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = to_regprocedure('public.fn_sms_numere_serviciu_reguli()')) <> 1
       OR (SELECT string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
            WHERE c.conrelid = 'public.sms_mesaje'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%destinatar\_tip%')
          IS DISTINCT FROM 'sms_mesaje_destinatar_tip_check CHECK ((destinatar_tip = ANY (ARRAY[''angajat''::text, ''detinator''::text, ''serviciu''::text])))' THEN
      RAISE EXCEPTION '20261220a revenire: starea nu e cea din 20261220a (pasul %)', v_pas;
    END IF;
    -- r2 (P2, L14 / L15): cele cinci funcții noi = EXACT amprenta de la aplicare (corp md5, DEFINER, proprietar, search_path, volatilitate,
    -- strict / leakproof, tipul întors, ACL, o singură variantă); blocul e IDENTIC cu postcondiția migrării. Modificată după aplicare = refuz.
    -- >>> AMPRENTE-NOI 20261220a
  SELECT string_agg(e.fn || ' = ' || coalesce(a.d, 'LIPSESTE'), '; ' ORDER BY e.fn COLLATE "C") INTO v_dif
    FROM (VALUES
      ('public.fn_sms_numar_serviciu_dezactiveaza(integer,integer)', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=e45e7fc9f8d8c1bb9181acc508a6f098'),
      ('public.fn_sms_numar_serviciu_salveaza(integer,text,text,integer,text,integer)', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=bb417d0955884f0d1d5b760e555dec31'),
      ('public.fn_sms_numere_serviciu_admin()', 'tip=f, limbaj=plpgsql, definer=true, volatil=s, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=fe18333d6e850487d1266088faf290f6'),
      ('public.fn_sms_numere_serviciu_lista()', 'tip=f, limbaj=plpgsql, definer=true, volatil=s, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=jsonb, acl=authenticated:EXECUTE, postgres:EXECUTE, variante=1, corp_md5=720c72b8d1c097677055eb179e7ec2a3'),
      ('public.fn_sms_numere_serviciu_reguli()', 'tip=f, limbaj=plpgsql, definer=true, volatil=v, strict=false, leakproof=false, proprietar=postgres, config=search_path=public, pg_temp, intoarce=trigger, acl=postgres:EXECUTE, variante=1, corp_md5=7fa25a176a6c1a54f8b809c44c7e7011')
    ) e(fn, asteptat)
    LEFT JOIN LATERAL (
      SELECT 'tip=' || p.prokind::text || ', limbaj=' || l.lanname::text || ', definer=' || p.prosecdef::text || ', volatil=' || p.provolatile::text
             || ', strict=' || p.proisstrict::text || ', leakproof=' || p.proleakproof::text || ', proprietar=' || pg_get_userbyid(p.proowner)
             || ', config=' || coalesce(array_to_string(p.proconfig, '; '), '(mostenit)') || ', intoarce=' || coalesce(pg_get_function_result(p.oid), '-')
             || ', acl=' || coalesce((SELECT string_agg(x.d, ', ' ORDER BY x.d COLLATE "C") FROM (
                  SELECT CASE g.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END || ':' || g.privilege_type
                         || CASE WHEN g.is_grantable THEN '*' ELSE '' END AS d
                    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g) x), '(niciun drept)')
             || ', variante=' || (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname)::text
             || ', corp_md5=' || md5(replace(p.prosrc, chr(13), '')) AS d
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(e.fn)) a ON true
   WHERE a.d IS DISTINCT FROM e.asteptat;
  -- <<< AMPRENTE-NOI 20261220a
    IF v_dif IS NOT NULL THEN
      RAISE EXCEPTION '20261220a revenire: functiile noi difera de amprenta de la aplicare (pasul %): %; nimic schimbat', v_pas, v_dif;
    END IF;
    -- nimic altceva nu depinde de tabel / de funcțiile scoase (vederi, cheie străină, alte corpuri care le cheamă; plpgsql nu lasă dependențe)
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.sms_numere_serviciu'::regclass
                 AND d.classid IN ('pg_rewrite'::regclass, 'pg_constraint'::regclass)
                 AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.oid = d.objid AND c.conrelid = 'public.sms_numere_serviciu'::regclass))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT IN ('fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_admin', 'fn_sms_numar_serviciu_salveaza',
                                           'fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numere_serviciu_reguli', 'fn_sms_lot_intern_creeaza',
                                           'fn_sms_lot_destinatari')
                     AND p.prosrc ~ '\m(sms_numere_serviciu|fn_sms_numere_serviciu_lista|fn_sms_numere_serviciu_admin|fn_sms_numar_serviciu_salveaza|fn_sms_numar_serviciu_dezactiveaza)\M') THEN
      RAISE EXCEPTION '20261220a revenire: alte obiecte depind de tabelul / functiile 20261220a';
    END IF;
    IF v_pas = 2 THEN
      -- „fără date”, sub lock-uri: istoricul trimiterii și configurarea nouă nu se pierd tacit
      SELECT count(*) INTO v_n FROM public.sms_mesaje m WHERE m.destinatar_tip = 'serviciu';
      IF v_n > 0 THEN
        RAISE EXCEPTION '20261220a revenire: REFUZ: % mesaje catre numere de serviciu in istoric (nu se sterg); in loc de revenire: OPRIREA (dezactivarea numerelor din Setari, antetul fisierului); nimic schimbat', v_n;
      END IF;
      SELECT count(*) INTO v_n FROM public.sms_numere_serviciu;
      IF v_n > 0 THEN
        RAISE EXCEPTION '20261220a revenire: REFUZ: % numere de serviciu salvate (configurare noua); intai decizia owner-ului (antetul fisierului); nimic schimbat', v_n;
      END IF;
    END IF;
  END LOOP;
END $revenire$;

DROP TABLE public.sms_numere_serviciu;
DROP FUNCTION public.fn_sms_numere_serviciu_reguli(), public.fn_sms_numere_serviciu_lista(), public.fn_sms_numere_serviciu_admin(),
  public.fn_sms_numar_serviciu_salveaza(integer, text, text, integer, text, integer), public.fn_sms_numar_serviciu_dezactiveaza(integer, integer);
DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[]);
ALTER TABLE public.sms_mesaje DROP CONSTRAINT sms_mesaje_destinatar_tip_check,
  ADD CONSTRAINT sms_mesaje_destinatar_tip_check CHECK (destinatar_tip IN ('angajat', 'detinator'));

-- corpul 20261130b, EXACT (copiat din supabase/migrations/20261130b_sms_acces_modul.sql; amprenta verificată mai jos)
CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL,
                                                            p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- un singur instantaneu: candidatii (angajati activi din filtre), excluderile si lista finala (un SMS per telefon)
  WITH c AS (
    SELECT e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (coalesce(cardinality(p_angajati), 0) = 0 OR e.id = ANY (p_angajati))
       AND (coalesce(cardinality(p_departamente), 0) = 0 OR e.department = ANY (p_departamente))
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms: niciun angajat activ in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms: niciun destinatar cu mobil RO valid (dupa filtre si opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  -- 20261130b: contul de test, maximum 5 destinatari (si in previzualizare)
  IF v_niv = 'test' AND v_nr > 5 THEN
    RAISE EXCEPTION 'sms test: contul de test trimite unui lot de maximum 5 destinatari (selectia are %)', v_nr USING ERRCODE = '42501';
  END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    -- r3 (P2-01 b) / r4: coada contului de test DOAR la crearea efectiva (previzualizarea nu ia lock si nu e refuzata de coada):
    -- lock consultativ pe cont cu asteptare, inaintea oricarui alt lock, tinut pana la final
    IF v_niv = 'test' THEN
      PERFORM public.fn_sms_test_coada_lock(auth.uid(), true);
      PERFORM public.fn_sms_test_coada_cere(auth.uid(), v_nr);
    END IF;
    INSERT INTO public.sms_loturi (categorie, text, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0)),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'angajat', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  -- plafonul zilnic e o setare: numarul il vede doar owner-ul; ceilalti afla doar daca lotul il depaseste
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'intern', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost,
    'plafon_zi', CASE WHEN v_niv = 'owner' THEN v_plafon END, 'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0),
    'preview', coalesce(p_doar_preview, true), 'nivel', v_niv,
    'coada_libera', CASE WHEN v_niv = 'test' THEN greatest(0, public.fn_sms_test_coada_max() - public.fn_sms_test_coada(auth.uid())) END);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_lista jsonb; v_lungime integer; v_niv text;
BEGIN
  v_niv := public.fn_sms_cere_nivel();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id;
  IF NOT FOUND OR NOT public.fn_sms_lot_acces(auth.uid(), v_niv, l, false) THEN
    RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002';
  END IF;
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(l.text) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mesaj_id', x.id, 'destinatar_tip', x.destinatar_tip, 'nume', x.nume,
           'telefon_mascat', '07** *** ' || right(x.telefon, 3), 'stare', x.stare, 'cod_eroare', x.cod_eroare,
           'rezervat_la', x.rezervat_la, 'trimis_la', x.trimis_la, 'livrat_la', x.livrat_la) ORDER BY x.nume, x.id), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT m.id, m.destinatar_tip, m.telefon, m.stare, m.cod_eroare, m.rezervat_la, m.trimis_la, m.livrat_la,
                 coalesce(CASE WHEN m.destinatar_tip = 'angajat' THEN e.name ELSE d.nume END, '(destinatar indisponibil)') AS nume
            FROM public.sms_mesaje m
            LEFT JOIN public.employees e
              ON e.id = CASE WHEN m.destinatar_tip = 'angajat' AND m.destinatar_id ~ '^[0-9]{1,9}$' THEN m.destinatar_id::integer END
            LEFT JOIN public.red_detinatori d
              ON d.id = CASE WHEN m.destinatar_tip = 'detinator' AND m.destinatar_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN m.destinatar_id::uuid END
           WHERE m.lot_id = l.id) x;
  RETURN jsonb_build_object('lot_id', l.id, 'categorie', l.categorie, 'stare', l.stare, 'versiune', l.versiune, 'text', l.text,
    'lungime', v_lungime, 'segmente', l.segmente, 'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur,
    'excluse_optout', l.excluse_optout, 'excluse_fara_mobil', l.excluse_fara_mobil, 'proiect_id', l.proiect_id, 'uat_id', l.uat_id,
    'creat_la', l.creat_la, 'creat_nivel', l.creat_nivel, 'aprobat_nivel', l.aprobat_nivel, 'nivel', v_niv,
    'actiune_permisa', public.fn_sms_lot_acces(auth.uid(), v_niv, l, true), 'destinatari', v_lista);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean) TO authenticated;

-- ── postcondiții: exact starea dinaintea migrării (corpurile 20261130b, drepturile, CHECK-ul), nimic rămas ──
DO $post$
DECLARE v_o oid;
BEGIN
  IF to_regclass('public.sms_numere_serviciu') IS NOT NULL OR to_regclass('public.sms_numere_serviciu_id_seq') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_admin', 'fn_sms_numar_serviciu_salveaza',
                                    'fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numere_serviciu_reguli'))
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_sms_lot_intern_creeaza') <> 1 THEN
    RAISE EXCEPTION '20261220a revenire post: au ramas obiecte 20261220a';
  END IF;
  FOR v_o IN SELECT unnest(ARRAY[to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)')::oid,
                                 to_regprocedure('public.fn_sms_lot_destinatari(uuid)')::oid]) LOOP
    IF v_o IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_o AND l.lanname = 'plpgsql'
                                    AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'])
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('anon', v_o, 'EXECUTE') OR has_function_privilege('service_role', v_o, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_o, 'EXECUTE') THEN
      RAISE EXCEPTION '20261220a revenire post: functia % (definer / owner / search_path / EXECUTE)', v_o::regprocedure;
    END IF;
  END LOOP;
  -- aceleași amprente ca în $pre$-ul migrării (corpurile 20261130b)
  IF md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)'::regprocedure), chr(13), ''))
       IS DISTINCT FROM 'ee0e39daf80d5abd45412e4782d5d07b'
     OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_sms_lot_destinatari(uuid)'::regprocedure), chr(13), ''))
       IS DISTINCT FROM '3fb67709c3a020cfbdb783d51e288111' THEN
    RAISE EXCEPTION '20261220a revenire post: corpurile refacute difera de 20261130b';
  END IF;
  IF (SELECT string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
       WHERE c.conrelid = 'public.sms_mesaje'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%destinatar\_tip%')
     IS DISTINCT FROM 'sms_mesaje_destinatar_tip_check CHECK ((destinatar_tip = ANY (ARRAY[''angajat''::text, ''detinator''::text])))' THEN
    RAISE EXCEPTION '20261220a revenire post: CHECK-ul pe sms_mesaje.destinatar_tip';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261220a_sms_numere_serviciu_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261220a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261220a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
