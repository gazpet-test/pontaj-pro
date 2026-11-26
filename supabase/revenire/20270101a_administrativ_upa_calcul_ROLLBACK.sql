-- Revenire 20270101a_administrativ_upa_calcul. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Reface IDENTIC (sursa, din 20261229a) cele 5 funcții înlocuite: fn_upa_achizitii_intentie (triggerul), fn_upa_achizitie_adauga,
--   fn_upa_alerta_inscrie, fn_upa_alerta_rezerva_la, fn_upa_alerta_proba, și CHECK-urile upa_alerta_jurnal_fel / _forma_cheie (textul din
--   20261229a); scoate tot ce a creat migrarea: upa_parametri, upa_calcul_lunar, upa_calcul_angajat, upa_angajat_perioade (cu politicile,
--   indecșii și triggerele lor), cele 22 de funcții noi, coloanele upa_achizitii.valoare_fara_tva / data_plata / stare_plata (cu CHECK-urile lor).
--   fn_upa_campuri_intentie / fn_upa_hash_intentie nu au fost atinse: amprentele intențiilor fără valorile noi sunt EXACT cele din 20261229a,
--   deci reîncercările lor rămân 'existent' și după revenire.
-- REFUZĂ (nimic schimbat) dacă: amprenta COMPLETĂ a obiectelor migrării (blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă
--   de constanta revizuită, sau dacă au apărut DATE noi: o lună închisă, un parametru schimbat sau adăugat din ecran (față de cele 4 rânduri
--   ale migrării: salariul minim, reportul inițial, ziua termenului 21 / 25), o corecție HR, o achiziție cu valoarea fără TVA / starea /
--   data plății completate sau cu amprenta v2, un rând de jurnal de felul 'calcul'.
--   Lock-urile se iau ÎNAINTE de verificări (L14). DROP fără CASCADE: o dependență nouă pe tabelele / funcțiile migrării oprește tranzacția.
-- Ordinea: edge-ul upa-plafon-alerta v11 rămâne (merge cu ambele forme ale rezervării); ecranul se retrage ÎNAINTE (versiunea anterioară
--   citește fn_upa_luni / upa_plafon_lunar, neatinse de migrare). Revenirea lui 20261229a / b / c se face DUPĂ aceasta (c -> b -> a vin după).
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270101a_administrativ_upa_calcul_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270101120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri (NOWAIT, ordinea FIXĂ, aceeași ca în migrare și RPC-uri): upa_achizitii -> upa_alerta_jurnal -> upa_parametri -> upa_calcul_lunar ->
--   upa_calcul_angajat -> upa_angajat_perioade, toate ACCESS EXCLUSIVE.
-- Probe: scripts/pglite/test_upa_calcul_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270101a_administrativ_upa_calcul_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270101a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270101a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270101a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270101a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270101a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.upa_parametri') IS NULL OR to_regclass('public.upa_calcul_lunar') IS NULL OR to_regclass('public.upa_calcul_angajat') IS NULL
     OR to_regclass('public.upa_angajat_perioade') IS NULL
     OR to_regprocedure('public.fn_upa_calcul_la(date, date, integer)') IS NULL OR to_regprocedure('public.fn_upa_calcul_previziune_la(date, date, integer)') IS NULL
     OR to_regprocedure('public.fn_upa_situatie(date, integer)') IS NULL
     OR to_regprocedure('public.fn_upa_hash_intentie_v2(jsonb)') IS NULL THEN
    RAISE EXCEPTION '20270101a revenire: starea nu e cea din 20270101a (tabelele / functiile migrarii lipsesc)';
  END IF;
  -- lock-urile ÎNAINTEA verificărilor (L14), NOWAIT, ordinea fixă
  LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_alerta_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_parametri IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_calcul_lunar IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_calcul_angajat IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_angajat_perioade IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- AMPRENTA_20270101a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul; PG17 / PG18: NOT NULL-urile din pg_constraint scoase)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' own=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(c.relacl) e) a), '-') AS l
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade',
                                                                     'upa_angajat_perioade_id_seq')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text
           || ' gen=' || a.attgenerated::text || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' acl=' || coalesce((SELECT string_agg(e.d, ',' ORDER BY e.d COLLATE "C") FROM (
                SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type
                       || CASE WHEN x.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(a.attacl) x) e), '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
            OR (c.relname = 'upa_achizitii' AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata')))
    UNION ALL
    SELECT 'con ' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
            OR (c.relname = 'upa_achizitii' AND k.conname IN ('upa_achizitii_fara_tva_interval', 'upa_achizitii_stare_plata'))
            OR (c.relname = 'upa_alerta_jurnal' AND k.conname IN ('upa_alerta_jurnal_fel', 'upa_alerta_jurnal_forma_cheie')))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' own=' || pg_get_userbyid(ic.relowner)
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE t.relnamespace = 'public'::regnamespace AND t.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    SELECT 'trg ' || c.relname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    -- ORICE obiect care depinde de coloanele noi din upa_achizitii (DROP COLUMN le-ar scoate tăcut la revenire)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> upa_achizitii.' || a.attname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata')
    UNION ALL
    -- orice obiect care depinde de tabelele noi (vederi, chei străine, politici în alte tabele): DROP TABLE fără CASCADE ar pica, dar se vede aici
    SELECT 'deptab ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || c.relname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid
     WHERE d.refclassid = 'pg_class'::regclass AND c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
       AND d.deptype = 'n' AND d.classid <> 'pg_class'::regclass
    UNION ALL
    SELECT 'pol ' || c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_parametru_la', 'fn_upa_inceput_calcul', 'fn_upa_pontaj_inchis',
             'fn_upa_zi_lucratoare', 'fn_upa_calendar_lipsa', 'fn_upa_termen_stat', 'fn_upa_cauza_cod', 'fn_upa_nma_angajati', 'fn_upa_rand_amprenta',
             'fn_upa_amprenta_achizitii', 'fn_upa_calcul_previziune_la', 'fn_upa_calcul_la', 'fn_upa_situatie_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la', 'fn_upa_calcul_inchide',
             'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_perioada_adauga', 'fn_upa_perioada_sterge', 'fn_upa_campuri_intentie_v2',
             'fn_upa_hash_intentie_v2', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga', 'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la',
             'fn_upa_alerta_proba')
  ) x;
  -- AMPRENTA_20270101a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '10d0f74e66c5b40b4dda297d1df21edc' THEN
    RAISE NOTICE 'AMPRENTA_20270101a_TEXT %', v_amp;
    RAISE EXCEPTION '20270101a revenire: AMPRENTA obiectelor % (asteptat 10d0f74e66c5b40b4dda297d1df21edc); nimic schimbat', md5(coalesce(v_amp, ''));
  END IF;
  -- date noi = refuz (calculul închis, parametrii schimbați, corecțiile HR, achizițiile cu valori în coloanele noi, alerta exactă)
  IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar) OR EXISTS (SELECT 1 FROM public.upa_calcul_angajat) THEN
    RAISE EXCEPTION '20270101a revenire: exista luni cu calculul inchis (upa_calcul_lunar); nimic schimbat';
  END IF;
  -- runda 6: cele 4 rânduri ale migrării (salariul minim, reportul inițial 0, termenul 21 din noiembrie 2026 și 25 din decembrie 2026)
  IF (SELECT count(*) FROM public.upa_parametri) <> 4
     OR (SELECT count(*) FROM public.upa_parametri p WHERE p.sursa = 'migrare' AND p.setat_de IS NULL
           AND ((p.cheie = 'salariu_minim' AND p.de_la = DATE '2026-07-01' AND p.valoare = 4325)
                OR (p.cheie = 'report_initial' AND p.de_la = DATE '2026-10-01' AND p.valoare = 0)
                OR (p.cheie = 'termen_stat_zi' AND p.de_la = DATE '2026-11-01' AND p.valoare = 21)
                OR (p.cheie = 'termen_stat_zi' AND p.de_la = DATE '2026-12-01' AND p.valoare = 25))) <> 4 THEN
    RAISE EXCEPTION '20270101a revenire: parametrii au fost schimbati sau adaugati din ecran (upa_parametri); nimic schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_angajat_perioade) THEN
    RAISE EXCEPTION '20270101a revenire: exista corectii HR (upa_angajat_perioade); nimic schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_achizitii a WHERE a.valoare_fara_tva IS NOT NULL OR a.data_plata IS NOT NULL OR a.stare_plata IS NOT NULL
                                                     OR a.hash_intentie LIKE 'v2:%') THEN
    RAISE EXCEPTION '20270101a revenire: exista achizitii cu valoarea fara TVA sau plata completate (sau cu amprenta v2); nimic schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.fel = 'calcul') THEN
    RAISE EXCEPTION '20270101a revenire: jurnalul are alerte exacte (fel calcul); nimic schimbat';
  END IF;
END $pre$;

-- ─── 1. Funcțiile din 20261229a, refăcute IDENTIC (sursa copiată din supabase/migrations/20261229a_administrativ_upa_alerta.sql) ─────
-- REFACERE_20261229a_INCEPUT
CREATE OR REPLACE FUNCTION public.fn_upa_achizitii_intentie() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.hash_intentie := CASE WHEN NEW.cheie_intentie IS NULL THEN NULL ELSE public.fn_upa_hash_intentie(to_jsonb(NEW)) END;
  ELSIF NEW.cheie_intentie IS DISTINCT FROM OLD.cheie_intentie OR NEW.hash_intentie IS DISTINCT FROM OLD.hash_intentie THEN
    RAISE EXCEPTION 'upa: cheia si amprenta intentiei nu se modifica' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION public.fn_upa_achizitie_adauga(p_cheie uuid, p_rand jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_r public.upa_achizitii; v_hash text; v_ex record; v_id bigint; v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'upa: cont neautentificat' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_rand IS NULL OR jsonb_typeof(p_rand) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'upa: cheia si campurile achizitiei sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  SELECT k.k INTO v_k FROM jsonb_object_keys(p_rand) AS k(k) WHERE NOT (k.k = ANY (public.fn_upa_campuri_intentie())) LIMIT 1;
  IF v_k IS NOT NULL THEN RAISE EXCEPTION 'upa: camp nepermis in achizitie (%)', left(v_k, 40) USING ERRCODE = '22023'; END IF;
  v_r := jsonb_populate_record(NULL::public.upa_achizitii, p_rand);
  v_hash := public.fn_upa_hash_intentie(to_jsonb(v_r));
  FOR v_pas IN 1..2 LOOP
    SELECT a.id, a.hash_intentie INTO v_ex FROM public.upa_achizitii a WHERE a.cheie_intentie = p_cheie;
    IF FOUND THEN
      IF v_ex.hash_intentie IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'upa: cheia intentiei exista deja cu alte valori; nimic scris' USING ERRCODE = 'UPA02';
      END IF;
      RETURN jsonb_build_object('stare', 'existent', 'id', v_ex.id);
    END IF;
    EXIT WHEN v_pas = 2;
    INSERT INTO public.upa_achizitii AS a (furnizor_id, furnizor_nume, numar_factura, data_factura, luna, valoare, descriere, document_path,
                                           cheie_intentie, created_by)
    VALUES (v_r.furnizor_id, v_r.furnizor_nume, v_r.numar_factura, v_r.data_factura, v_r.luna, v_r.valoare, v_r.descriere, v_r.document_path,
            p_cheie, auth.uid())
    ON CONFLICT (cheie_intentie) DO NOTHING
    RETURNING a.id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('stare', 'nou', 'id', v_id); END IF;
  END LOOP;
  RAISE EXCEPTION 'upa: cheia intentiei in conflict, fara rand vizibil; reincearca' USING ERRCODE = '40001';
END $f$;
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_inscrie(p_fel text, p_zi date, p_luna date, p_plafon numeric, p_consumat numeric, p_ramas numeric,
                                             p_zile integer, p_dest text[], p_ignorati integer, p_cod text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint; v_cheie text; v_stare text; v_eroare text; v_nd integer := 0; v_tip text; v_titlu text; v_mesaj text; v_n integer;
        v_ign integer := greatest(coalesce(p_ignorati, 0), 0);
BEGIN
  v_cheie := CASE p_fel WHEN 'zilnic' THEN 'zilnic:' || to_char(p_zi, 'YYYY-MM-DD')
                        WHEN 'inchidere' THEN 'inchidere:' || to_char(p_luna, 'YYYY-MM')
                        ELSE 'eroare:' || to_char(p_zi, 'YYYY-MM-DD') || ':' || p_cod END;
  IF p_fel = 'eroare' THEN v_stare := 'eroare'; v_eroare := p_cod; v_ign := 0;
  ELSIF p_dest IS NULL THEN v_stare := 'fara_mail'; v_eroare := 'prea_multi_destinatari';
  ELSIF cardinality(p_dest) = 0 AND v_ign > 0 THEN v_stare := 'fara_mail'; v_eroare := 'doar_destinatari_externi';
  ELSIF cardinality(p_dest) = 0 THEN v_stare := 'fara_mail'; v_eroare := 'fara_destinatari';
  ELSE v_stare := 'rezervat'; v_nd := cardinality(p_dest);
  END IF;
  INSERT INTO public.upa_alerta_jurnal AS j (cheie, fel, zi, luna, plafon, consumat, ramas, zile_ramase, nr_destinatari, nr_dest_ignorati, stare, eroare)
  VALUES (v_cheie, p_fel, p_zi, p_luna, p_plafon, p_consumat, p_ramas, p_zile, v_nd, v_ign, v_stare, v_eroare)
  ON CONFLICT (cheie) DO NOTHING
  RETURNING j.id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF p_fel = 'zilnic' THEN
    v_tip := CASE WHEN p_zile <= 3 THEN 'error' ELSE 'warning' END;
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': rămân ' || public.fn_upa_lei(p_ramas) || ' lei de cheltuit';
    v_mesaj := 'Cheltuit ' || public.fn_upa_lei(p_consumat) || ' din ' || public.fn_upa_lei(p_plafon) || ' lei la unități protejate; '
               || public.fn_upa_zile_text(p_zile) || ' din lună. Ce nu se cheltuie până la final se plătește la bugetul de stat.';
  ELSIF p_fel = 'inchidere' THEN
    v_tip := 'error';
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': necheltuit ' || public.fn_upa_lei(p_ramas) || ' lei';
    v_mesaj := 'Luna s-a încheiat: plafon ' || public.fn_upa_lei(p_plafon) || ' lei, cheltuit ' || public.fn_upa_lei(p_consumat)
               || ' lei la unități protejate. Suma necheltuită se plătește la bugetul de stat.';
  ELSE
    v_tip := 'error';
    v_titlu := 'Alerta fondului de handicap nu a rulat (' || p_cod || ')';
    v_mesaj := CASE p_cod WHEN 'setare_zi_invalida' THEN 'Setarea upa_alerta_zi lipsește sau nu e o zi între 1 și 31.'
                          WHEN 'fara_plafon' THEN 'Plafonul lunii curente nu e înregistrat (Administrativ → Unități protejate → Plafon).'
                          ELSE 'Eroare de configurare.' END;
  END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT d.id, v_tip, 'Administrativ', left(v_titlu, 200), left(v_mesaj, 1000), '/administrativ?tab=upa'
    FROM (SELECT p.id FROM public.profiles p WHERE p.is_owner IS TRUE
          UNION
          SELECT u.profile_id FROM public.user_module_access u
           WHERE p_fel <> 'eroare' AND u.module IN ('administrativ', 'administrativ.upa')) d
   ORDER BY d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.upa_alerta_jurnal j SET nr_notificari = v_n WHERE j.id = v_id;
  RETURN v_id;
END $f$;
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_rezerva_la(p_azi date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_activ boolean; v_dest text[]; v_ign integer; v_c record; v_a record; v_l date; v_ids bigint[] := '{}'; v_id bigint; v_rez jsonb;
        v_inchis jsonb := NULL; v_furn jsonb; v_reconciliate integer; v_cfg text[]; v_cod text;
BEGIN
  IF p_azi IS NULL THEN RAISE EXCEPTION 'upa: ziua lipseste' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_alerta_jurnal'));
  UPDATE public.upa_alerta_jurnal j SET stare = 'necunoscut', eroare = 'rezervare_veche', actualizat_la = now()
   WHERE j.stare = 'rezervat' AND j.creat_la < now() - interval '1 hour';
  GET DIAGNOSTICS v_reconciliate = ROW_COUNT;
  v_activ := (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true';
  -- doar adresele interne primesc mail; cele ignorate se numără (jurnal + răspuns), fără adrese
  SELECT d.interni, cardinality(d.ignorate) INTO v_dest, v_ign
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  SELECT * INTO v_c FROM public.fn_upa_luni(p_azi, 2) f WHERE f.e_curenta;
  SELECT * INTO v_a FROM public.fn_upa_luni(p_azi, 2) f WHERE NOT f.e_curenta;
  v_cfg := public.fn_upa_erori_config(v_c.zi_prag, v_c.plafon);
  -- (2) închiderea lunii anterioare: o dată (ON CONFLICT DO NOTHING), cu valorile din fn_upa_luni
  IF NOT v_a.inchisa AND v_a.plafon IS NOT NULL THEN
    INSERT INTO public.upa_luna_inchisa AS i (luna, plafon, consumat, ramas_necheltuit, nr_achizitii)
    VALUES (v_a.luna, v_a.plafon, v_a.consumat, greatest(v_a.plafon - v_a.consumat, 0), v_a.nr_achizitii)
    ON CONFLICT (luna) DO NOTHING
    RETURNING i.luna INTO v_l;
    IF v_l IS NOT NULL THEN
      v_inchis := jsonb_build_object('luna', v_a.luna, 'plafon', v_a.plafon, 'consumat', v_a.consumat, 'ramas', greatest(v_a.plafon - v_a.consumat, 0));
      IF v_activ AND v_a.plafon > v_a.consumat THEN
        v_id := public.fn_upa_alerta_inscrie('inchidere', p_azi, v_a.luna, v_a.plafon, v_a.consumat, v_a.plafon - v_a.consumat, NULL, v_dest, v_ign, NULL);
        IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
      END IF;
    END IF;
  END IF;
  IF NOT v_activ THEN
    RETURN jsonb_build_object('activ', false, 'zi', p_azi, 'inchis', v_inchis, 'reconciliate', v_reconciliate, 'erori_config', to_jsonb(v_cfg),
                              'destinatari_ignorati', v_ign, 'n', 0, 'randuri', '[]'::jsonb);
  END IF;
  -- (4) erorile de configurare: în jurnal (+ notificarea owner-ului) o dată pe zi și cod; în răspuns la fiecare rulare (erori_config).
  --   O lună anterioară FĂRĂ plafon nu e o eroare: fn_upa_plafon_la caută înapoi fără limită, deci NULL înseamnă că luna e dinaintea primului
  --   plafon înregistrat (de ex. luna dinaintea aplicării) — nu se închide, iar ecranul o arată „plafon neînregistrat”.
  FOREACH v_cod IN ARRAY v_cfg LOOP
    PERFORM public.fn_upa_alerta_inscrie('eroare', p_azi, v_c.luna, NULL, v_c.consumat, NULL, NULL, NULL, NULL, v_cod);
  END LOOP;
  IF cardinality(v_cfg) = 0 AND v_c.in_alerta IS TRUE THEN
    -- (5) alerta zilei: cel mult una pe zi (cheia zilnic:<zi>)
    v_id := public.fn_upa_alerta_inscrie('zilnic', p_azi, v_c.luna, v_c.plafon, v_c.consumat, v_c.plafon - v_c.consumat, v_c.zile_ramase, v_dest, v_ign, NULL);
    IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
  END IF;
  -- furnizorii UPA activi cu autorizația valabilă (doar numele; pentru mail)
  SELECT coalesce(jsonb_agg(f.nume ORDER BY f.nume), '[]'::jsonb) INTO v_furn
    FROM (SELECT DISTINCT fz.nume::text AS nume FROM public.logistica_furnizori fz
           WHERE fz.este_upa IS TRUE AND fz.activ IS TRUE AND (fz.upa_valabil_pana IS NULL OR fz.upa_valabil_pana >= p_azi)
             AND fz.nume IS NOT NULL ORDER BY 1 LIMIT 15) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'cheie', j.cheie, 'fel', j.fel, 'luna', j.luna, 'plafon', j.plafon, 'consumat', j.consumat,
                                               'ramas', j.ramas, 'zile_ramase', j.zile_ramase, 'stare', j.stare, 'eroare', j.eroare,
                                               'dest_ignorati', j.nr_dest_ignorati,
                                               'destinatari', CASE WHEN j.stare = 'rezervat' THEN to_jsonb(v_dest) ELSE '[]'::jsonb END) ORDER BY j.id), '[]'::jsonb)
    INTO v_rez FROM public.upa_alerta_jurnal j WHERE j.id = ANY (v_ids);
  RETURN jsonb_build_object('activ', true, 'zi', p_azi, 'inchis', v_inchis, 'reconciliate', v_reconciliate, 'furnizori_upa', v_furn,
                            'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign, 'n', jsonb_array_length(v_rez), 'randuri', v_rez);
END $f$;
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_c record; v_a record; v_dest text[]; v_ignorate text[];
BEGIN
  SELECT * INTO v_c FROM public.fn_upa_luni(v_azi, 2) f WHERE f.e_curenta;
  SELECT * INTO v_a FROM public.fn_upa_luni(v_azi, 2) f WHERE NOT f.e_curenta;
  SELECT d.interni, d.ignorate INTO v_dest, v_ignorate
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  RETURN jsonb_build_object(
    'zi', v_azi,
    'activ', (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true',
    'luna', v_c.luna, 'plafon', v_c.plafon, 'consumat', v_c.consumat, 'zile_ramase', v_c.zile_ramase, 'zi_prag', v_c.zi_prag, 'in_alerta', v_c.in_alerta,
    'erori_config', to_jsonb(public.fn_upa_erori_config(v_c.zi_prag, v_c.plafon)),
    'alerta_azi_deja', EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.cheie = 'zilnic:' || to_char(v_azi, 'YYYY-MM-DD')),
    'luna_anterioara', v_a.luna, 'luna_anterioara_inchisa', v_a.inchisa, 'luna_anterioara_plafon', v_a.plafon, 'luna_anterioara_consumat', v_a.consumat,
    'destinatari_valizi', v_dest IS NOT NULL, 'destinatari', coalesce(to_jsonb(v_dest), '[]'::jsonb),
    -- doar în proba owner-ului: adresele ignorate (alt domeniu / invalide), ca să poată corecta setarea
    'destinatari_ignorate', to_jsonb(v_ignorate));
END $f$;
-- REFACERE_20261229a_SFARSIT

-- ─── 2. CHECK-urile jurnalului, refăcute cu textul din 20261229a (niciun rând 'calcul': verificat mai sus) ─────────────────────
ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_fel;
ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_forma_cheie;
ALTER TABLE public.upa_alerta_jurnal ADD CONSTRAINT upa_alerta_jurnal_fel CHECK (fel = ANY (ARRAY['zilnic'::text, 'inchidere'::text, 'eroare'::text]));
ALTER TABLE public.upa_alerta_jurnal ADD CONSTRAINT upa_alerta_jurnal_forma_cheie CHECK (
    (fel = 'zilnic' AND cheie = 'zilnic:' || to_char(zi, 'YYYY-MM-DD') AND luna = date_trunc('month', zi::timestamp)::date)
    OR (fel = 'inchidere' AND cheie = 'inchidere:' || to_char(luna, 'YYYY-MM') AND luna < date_trunc('month', zi::timestamp)::date)
    OR (fel = 'eroare' AND cheie ~ ('^eroare:' || to_char(zi, 'YYYY-MM-DD') || ':[a-z_]{1,40}$')));

-- ─── 3. Ce a creat migrarea ────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.fn_upa_perioada_sterge(bigint);
DROP FUNCTION public.fn_upa_perioada_adauga(integer, date, date, numeric, boolean, boolean, text);
DROP FUNCTION public.fn_upa_parametru_seteaza(text, date, numeric, numeric, text);
DROP FUNCTION public.fn_upa_calcul_detaliu(date);
DROP FUNCTION public.fn_upa_calcul_inchide(date, text);
DROP FUNCTION public.fn_upa_calcul_inchide_la(date, date, text, uuid);
DROP FUNCTION public.fn_upa_situatie(date, integer);
DROP FUNCTION public.fn_upa_situatie_la(date, integer);
DROP FUNCTION public.fn_upa_calcul_la(date, date, integer);
DROP FUNCTION public.fn_upa_calcul_previziune_la(date, date, integer);
DROP FUNCTION public.fn_upa_amprenta_achizitii(date);
DROP FUNCTION public.fn_upa_rand_amprenta(integer, integer, integer, integer, integer, integer, numeric);
DROP FUNCTION public.fn_upa_nma_angajati(date);
DROP FUNCTION public.fn_upa_cauza_cod(text);
DROP FUNCTION public.fn_upa_termen_stat(date);
DROP FUNCTION public.fn_upa_calendar_lipsa(integer);
DROP FUNCTION public.fn_upa_zi_lucratoare(date);
DROP FUNCTION public.fn_upa_pontaj_inchis(date, date);
DROP FUNCTION public.fn_upa_inceput_calcul();
DROP FUNCTION public.fn_upa_parametru_la(text, date);
DROP FUNCTION public.fn_upa_hash_intentie_v2(jsonb);
DROP FUNCTION public.fn_upa_campuri_intentie_v2();
DROP TABLE public.upa_calcul_angajat;
DROP TABLE public.upa_calcul_lunar;
DROP TABLE public.upa_angajat_perioade;
DROP TABLE public.upa_parametri;
ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_stare_plata;
ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_fara_tva_interval;
ALTER TABLE public.upa_achizitii DROP COLUMN stare_plata;
ALTER TABLE public.upa_achizitii DROP COLUMN data_plata;
ALTER TABLE public.upa_achizitii DROP COLUMN valoare_fara_tva;

-- ─── 4. Verificarea după (aceleași amprente ca preflight-ul migrării pe funcțiile și CHECK-urile din 20261229a) ─────────────────
DO $post$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_upa_campuri_intentie()', '4e4b376f96d4dd342fa4f1bb7ca8e77c', 'sql', false, 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_hash_intentie(jsonb)', '6ed0bf58f3be8ea4322890a3fcd195d9', 'sql', false, 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_achizitii_intentie()', 'a821bc8b037b0f4a1294372ba5875cb2', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_achizitie_adauga(uuid,jsonb)', '5209c63755b845071e0921939dfb328a', 'plpgsql', false, 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_alerta_inscrie(text,date,date,numeric,numeric,numeric,integer,text[],integer,text)', '86bf8045edf180cfc16deb01b25f363b', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_rezerva_la(date)', 'a87d5f44064b658ca51828ae42184d99', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_proba()', 'fe1128ac647385bcb4c03b01906ec4bf', 'plpgsql', true, 'postgres:EXECUTE, service_role:EXECUTE')
    ) v(fn, src, limbaj, definer, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.prokind = 'f'
                      AND md5(replace(p.prosrc, chr(13), '')) = r.src
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270101a revenire post: functia % nu e refacuta exact ca in 20261229a', r.fn;
    END IF;
  END LOOP;
  IF (SELECT string_agg(k.conname || '=' || md5(pg_get_constraintdef(k.oid)), ',' ORDER BY k.conname) FROM pg_constraint k
       WHERE k.conrelid = 'public.upa_alerta_jurnal'::regclass AND k.contype = 'c' AND k.convalidated
         AND k.conname IN ('upa_alerta_jurnal_fel', 'upa_alerta_jurnal_forma_cheie'))
     IS DISTINCT FROM 'upa_alerta_jurnal_fel=12d6a4435982d7d98a7d8c142131acad,upa_alerta_jurnal_forma_cheie=8609fbc0de53efab1d1b20bcb0772969' THEN
    RAISE EXCEPTION '20270101a revenire post: CHECK-urile upa_alerta_jurnal nu sunt refacute exact ca in 20261229a';
  END IF;
  IF to_regclass('public.upa_parametri') IS NOT NULL OR to_regclass('public.upa_calcul_lunar') IS NOT NULL OR to_regclass('public.upa_calcul_angajat') IS NOT NULL
     OR to_regclass('public.upa_angajat_perioade') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_parametru_la', 'fn_upa_inceput_calcul',
                  'fn_upa_pontaj_inchis', 'fn_upa_zi_lucratoare', 'fn_upa_calendar_lipsa', 'fn_upa_termen_stat', 'fn_upa_cauza_cod', 'fn_upa_nma_angajati',
                  'fn_upa_rand_amprenta', 'fn_upa_amprenta_achizitii', 'fn_upa_calcul_previziune_la', 'fn_upa_calcul_la', 'fn_upa_situatie_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la',
                  'fn_upa_calcul_inchide', 'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_perioada_adauga', 'fn_upa_perioada_sterge',
                  'fn_upa_campuri_intentie_v2', 'fn_upa_hash_intentie_v2'])) THEN
    RAISE EXCEPTION '20270101a revenire post: au ramas obiecte ale migrarii';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270101a_administrativ_upa_calcul_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270101a revenire: garda final invalida';
  END IF;
END $post$;
