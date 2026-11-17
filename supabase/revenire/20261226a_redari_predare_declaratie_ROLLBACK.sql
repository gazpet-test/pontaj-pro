-- Revenire 20261226a_redari_predare_declaratie. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce starea de dinainte de 20261226a:
--   * fn_red_raspunsuri_valideaza și fn_red_raspuns_public = corpurile EXACTE din 20261126a (amprentele 3528222d… / 230aa93e…), cu aceleași
--     proprietăți și ACELAȘI ACL (CREATE OR REPLACE nu schimbă drepturile; postcondiția le compară cu cele de dinainte de revenire);
--   * fn_red_optiune_retrasa(text) scoasă (după ce niciun corp nu o mai cheamă);
--   * DEFAULT-ul red_proiecte.text_declaratie = VECHI;
--   * rândurile schimbate de migrare înapoi la VECHI — DOAR cele neatinse de atunci: proiectul are textul NOU și rândul lui e IDENTIC cu
--     date_noi din rândul de jurnal scris de migrare (red_jurnal: tabela red_proiecte, update, fără utilizator, VECHI -> NOU, nimic altceva
--     schimbat în afară de versiune). Orice salvare ulterioară crește versiunea (trg_red_versiune), deci un proiect editat între timp de un om
--     NU se atinge; nici unul creat după migrare cu DEFAULT-ul nou (nu are rândul de jurnal „update”). Cele rămase cu textul NOU sunt numărate
--     în NOTICE (de lămurit separat, cu preview și acord).
-- Fără refuz pe date: revenirea nu șterge nimic (răspunsurile rămân; regula de dinainte era mai largă), iar textele editate de oameni rămân.
-- Starea EXACTĂ a migrării e verificată înainte (corpuri + proprietăți + ACL, funcția nouă, DEFAULT-ul, triggerul, CHECK-ul), de două ori:
--   înainte și după lock. Altă stare = refuz, nimic schimbat.
--
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261226120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (L06): red_proiecte ACCESS EXCLUSIVE, NOWAIT, bugetul 1 s de la prima încercare, verificat înainte de fiecare încercare și după obținere.
--   Implicit: INSERT în red_jurnal (ROW EXCLUSIVE) la UPDATE-ul rândurilor. red_raspunsuri nu se blochează.
-- Probe: scripts/pglite/test_redari_predare_declaratie_local.mjs (aplicare -> revenire -> reaplicare, refuzurile revenirii).
DO $pre$
DECLARE v_plafon text; v_incercari integer := 0; v_t0 timestamptz; v_buget constant interval := interval '1 second'; v_pas integer; v_def text; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261226a_redari_predare_declaratie_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261226a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261226a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261226a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261226a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261226a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      v_t0 := clock_timestamp();
      LOOP
        IF clock_timestamp() >= v_t0 + v_buget THEN
          RAISE EXCEPTION '20261226a revenire: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= v_t0 + v_buget THEN
        RAISE EXCEPTION '20261226a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
      RAISE NOTICE '20261226a revenire: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
    END IF;
    -- funcțiile: EXACT cele din 20261226a (amprentele AMPRENTE-NOI 20261226a din migrare) + proprietățile; funcția nouă doar a proprietarului
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        -- >>> AMPRENTE-NOI 20261226a
        ('public.fn_red_optiune_retrasa(text)', '212cdf9e3b9bbca29f4517444e5c5fbf', 'sql', false, 'i', 'boolean'),
        ('public.fn_red_raspunsuri_valideaza()', '49e20867bfb42325cb954e5858045d1a', 'plpgsql', true, 'v', 'trigger'),
        ('public.fn_red_raspuns_public(text,text,date,text,boolean,text)', 'f316b7a75a868c36ffe491d6628b0e98', 'plpgsql', true, 'v', 'jsonb')
        -- <<< AMPRENTE-NOI 20261226a
      ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
     WHERE p.oid IS NULL
        OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
        OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
        OR p.prosecdef IS DISTINCT FROM a.definer
        OR p.provolatile IS DISTINCT FROM a.volatil
        OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
    IF v_rau IS NOT NULL
       OR (SELECT coalesce(p.proacl, acldefault('f', p.proowner))::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_optiune_retrasa(text)'))
          IS DISTINCT FROM '{postgres=X/postgres}'
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('fn_red_raspunsuri_valideaza', 'fn_red_raspuns_public', 'fn_red_optiune_retrasa')) <> 3 THEN
      RAISE EXCEPTION '20261226a revenire: starea nu e cea din 20261226a (pasul %, functii: %)', v_pas, coalesce(v_rau, 'drepturi / variante');
    END IF;
    IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_raspunsuri_valideaza'
          AND t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O' AND NOT t.tgisinternal
          AND t.tgqual IS NULL AND t.tgnargs = 0 AND cardinality(t.tgattr::int2[]) = 0) <> 1
       OR (SELECT string_agg(pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
            WHERE c.conrelid = 'public.red_raspunsuri'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%optiune%')
          IS DISTINCT FROM 'CHECK ((optiune = ANY (ARRAY[''particip''::text, ''nu_particip_fara_obiectii''::text, ''nu_particip_cu_obiectii''::text, ''constatare_teren''::text])))' THEN
      RAISE EXCEPTION '20261226a revenire: starea nu e cea din 20261226a (pasul %, trigger / CHECK)', v_pas;
    END IF;
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';
    IF v_def IS DISTINCT FROM quote_literal('Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.') || '::text' THEN
      RAISE EXCEPTION '20261226a revenire: starea nu e cea din 20261226a (pasul %, DEFAULT %)', v_pas, coalesce(v_def, 'lipsa');
    END IF;
    -- evidența (jurnalul + versiunea) e tot cea din 20261130j / 20261127a
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_jurnal()') AND md5(replace(p.prosrc, chr(13), '')) = '41ab451b7fcb499a2284c9c82367069e')
       OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_jurnal'
             AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1
       OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_versiune'
             AND t.tgfoid = 'public.fn_red_versiune_creste()'::regprocedure AND t.tgtype = 19 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1 THEN
      RAISE EXCEPTION '20261226a revenire: jurnalul / versiunea pe red_proiecte nu mai sunt cele asteptate (pasul %)', v_pas;
    END IF;
  END LOOP;
END $pre$;

CREATE TEMP TABLE red_acl_rev_20261226a ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_raspunsuri_valideaza()'::regprocedure, 'public.fn_red_raspuns_public(text,text,date,text,boolean,text)'::regprocedure);

-- ─── corpurile EXACTE din 20261126a ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
  v_ob text := nullif(btrim(coalesce(NEW.obiectii_text, '')), '');
BEGIN
  -- created_at = momentul recepției: pus de trigger la INSERT (clientul nu are privilegiu pe coloană), imutabil la UPDATE;
  -- `data` = momentul declarat (editabil de operator) — „ultimul răspuns” = data DESC, seq DESC
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
    -- la UPDATE verificările rulează doar când se schimbă conținutul răspunsului
    IF NEW.canal IS NOT DISTINCT FROM OLD.canal AND NEW.optiune IS NOT DISTINCT FROM OLD.optiune AND NEW.zi_sesiune_aleasa IS NOT DISTINCT FROM OLD.zi_sesiune_aleasa
       AND NEW.obiectii_text IS NOT DISTINCT FROM OLD.obiectii_text AND NEW.declaratie_confirmata IS NOT DISTINCT FROM OLD.declaratie_confirmata THEN
      RETURN NEW;
    END IF;
  END IF;
  IF length(coalesce(NEW.obiectii_text, '')) > 4000 THEN RAISE EXCEPTION 'redari: obiectii_text peste 4000 de caractere' USING ERRCODE = '23514'; END IF;
  -- aceleași reguli ca în RPC-ul public, și pentru operatori (telefon / scris / sesiune); RPC-ul își păstrează mesajele jsonb înaintea insertului
  IF NEW.optiune = 'particip' THEN
    IF NEW.zi_sesiune_aleasa IS NULL THEN RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa' USING ERRCODE = '23514'; END IF;
    -- apartenența la sesiunile CURENTE ale UAT-ului: la INSERT, când se schimbă ziua și când opțiunea DEVINE particip (sesiunile se pot muta ulterior)
    IF TG_OP = 'INSERT' OR NEW.zi_sesiune_aleasa IS DISTINCT FROM OLD.zi_sesiune_aleasa OR OLD.optiune IS DISTINCT FROM 'particip' THEN
      SELECT u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3 INTO r
        FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id JOIN public.red_uat u ON u.id = p.uat_id
       WHERE d.id = NEW.detinator_id;
      IF NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi1 AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi2
         AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi3 THEN
        RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa = una din zilele de sesiune ale UAT-ului' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RAISE EXCEPTION 'redari: % cere obiectii_text nevid', NEW.optiune USING ERRCODE = '23514'; END IF;
  ELSIF NEW.optiune = 'nu_particip_fara_obiectii' AND NEW.canal = 'online' AND NEW.declaratie_confirmata IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redari: nu_particip_fara_obiectii online cere declaratie_confirmata = true' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_raspunsuri_valideaza() IS 'Redări: trigger BEFORE INSERT/UPDATE pe red_raspunsuri — particip ⇒ zi din sesiunile UAT-ului deținătorului; nu_particip_cu_obiectii / constatare_teren ⇒ obiectii_text nevid; nu_particip_fara_obiectii pe canal online ⇒ declaratie_confirmata = true (telefon / scris / sesiune: operatorul confirmă); obiectii_text ≤ 4000; la UPDATE doar când se schimbă canal / opțiune / zi / obiecții / declarație (trecerea la particip re-verifică ziua); created_at = now() la INSERT, imutabil apoi.';

CREATE OR REPLACE FUNCTION public.fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata boolean, p_user_agent text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ip text := coalesce(public.fn_red_ip_client(), 'necunoscut');
  v_ob text := nullif(btrim(coalesce(p_obiectii, '')), '');
  v_deja boolean; v_id uuid; v_gasit boolean;
  r record;
BEGIN
  -- formatul tokenului (exact 43 caractere base64url) se verifică ÎNAINTE de orice scriere în red_rate_limit
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid');
  END IF;
  SELECT d.id AS detinator_id, t.token_expira_la, u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3
    INTO r
    FROM public.red_detinatori_token t
    JOIN public.red_detinatori d ON d.id = t.detinator_id AND d.sters_la IS NULL
    JOIN public.red_parcele p ON p.id = d.parcela_id AND p.sters_la IS NULL
    JOIN public.red_uat u ON u.id = p.uat_id
   WHERE t.token_raspuns = p_token;
  v_gasit := FOUND AND (r.token_expira_la IS NULL OR now() <= r.token_expira_la);
  -- contorul IP se atinge mereu (ip:necunoscut cand x-forwarded-for lipseste — limita reala e la gateway-ul Supabase); cheia de token DOAR
  -- pentru tokenuri existente si valide (multime finita → fara DoS prin chei arbitrare)
  IF public.fn_red_rate_limit_atinge('ip:' || v_ip, 30) THEN RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe'); END IF;
  PERFORM public.fn_red_rate_limit_curata(false);
  IF NOT v_gasit THEN RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid'); END IF;
  IF public.fn_red_rate_limit_atinge('t:' || encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), 5) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe');
  END IF;
  IF p_optiune IS NULL OR p_optiune NOT IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren') THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'optiune_invalida');
  END IF;
  -- particip: ziua e obligatorie și trebuie să fie una din zilele de sesiune ale UAT-ului deținătorului
  IF p_optiune = 'particip' AND (p_zi IS NULL
     OR (p_zi IS DISTINCT FROM r.sesiune_zi1 AND p_zi IS DISTINCT FROM r.sesiune_zi2 AND p_zi IS DISTINCT FROM r.sesiune_zi3)) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'zi_invalida');
  END IF;
  IF p_optiune = 'nu_particip_fara_obiectii' AND coalesce(p_declaratie_confirmata, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'declaratie_neconfirmata');
  END IF;
  IF p_optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_lipsa'); END IF;
    IF length(v_ob) > 4000 THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_prea_lungi'); END IF;
  ELSE
    v_ob := NULL;
  END IF;
  v_deja := EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = r.detinator_id);
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, created_by)
  VALUES (r.detinator_id, 'online', p_optiune, CASE WHEN p_optiune = 'particip' THEN p_zi END, v_ob,
          CASE WHEN p_optiune = 'nu_particip_fara_obiectii' THEN true END, NULL)
  RETURNING id INTO v_id;
  INSERT INTO public.red_raspunsuri_meta (raspuns_id, ip_sau_sursa, user_agent, raw_payload)
  VALUES (v_id, nullif(v_ip, 'necunoscut'), left(p_user_agent, 500),
          jsonb_build_object('optiune', p_optiune, 'zi', p_zi, 'obiectii_caractere', coalesce(length(v_ob), 0),
                             'declaratie_confirmata', p_declaratie_confirmata, 'user_agent', left(p_user_agent, 500)));
  RETURN jsonb_build_object('ok', true, 'raspuns_id', v_id, 'optiune', p_optiune, 'deja_raspuns', v_deja)
         || CASE WHEN v_deja THEN jsonb_build_object('mesaj', 'Răspunsul anterior a fost înlocuit.') ELSE '{}'::jsonb END;
END $fn$;
COMMENT ON FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text) IS 'Redări, RPC public (anon): înregistrează răspunsul online (canal online, created_by NULL, IP din x-forwarded-for). Validări prin jsonb (token_invalid — la format greșit înainte de orice contor, la token inexistent / expirat după contorul IP; cheia de token se atinge doar pentru tokenuri existente; optiune_invalida; zi_invalida — particip cere o zi din sesiunile UAT-ului; declaratie_neconfirmata; obiectii_lipsa; obiectii_prea_lungi; prea_multe). Al doilea răspuns se acceptă (istoricul rămâne, ultimul contează) cu deja_raspuns = true. NU trimite mail/SMS, NU generează PV (decizia 6).';

DROP FUNCTION public.fn_red_optiune_retrasa(text);

ALTER TABLE public.red_proiecte ALTER COLUMN text_declaratie
  SET DEFAULT 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.';

-- rândurile schimbate de migrare și NEATINSE de atunci (rândul = date_noi din jurnalul migrării) -> VECHI
CREATE TEMP TABLE red_decl_rev_20261226a (id uuid, cod text, versiune integer) ON COMMIT DROP;
WITH t AS (
  SELECT pr.id FROM public.red_proiecte pr
   WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
     AND EXISTS (SELECT 1 FROM public.red_jurnal j
                  WHERE j.tabela = 'red_proiecte' AND j.actiune = 'update' AND j.inregistrare_id = pr.id AND j.user_id IS NULL
                    AND j.date_vechi ->> 'text_declaratie' = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
                    AND j.date_noi ->> 'text_declaratie' = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
                    AND (j.date_vechi - 'text_declaratie' - 'versiune') = (j.date_noi - 'text_declaratie' - 'versiune')
                    AND j.date_noi = to_jsonb(pr))
), s AS (
  UPDATE public.red_proiecte pr
     SET text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
    FROM t WHERE pr.id = t.id
  RETURNING pr.id, pr.cod, pr.versiune)
INSERT INTO red_decl_rev_20261226a (id, cod, versiune) SELECT s.id, s.cod, s.versiune FROM s;

DO $post$
DECLARE v_rau text; v_def text; v_n integer; v_ramase integer; v_lista text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_raspunsuri_valideaza()', '3528222d7d8379dbbe8f3d2e64c60b94', 'trigger'),
      ('public.fn_red_raspuns_public(text,text,date,text,boolean,text)', '230aa93e36c8d9b5f9ac5f3afc0066ad', 'jsonb')
    ) a(semnatura, amprenta, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      OR p.prosecdef IS NOT TRUE OR p.provolatile IS DISTINCT FROM 'v'
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261226a revenire: postconditie: corpurile 20261126a (%)', v_rau; END IF;
  IF EXISTS (SELECT 1 FROM red_acl_rev_20261226a a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl)
     OR (SELECT count(*) FROM red_acl_rev_20261226a) <> 2
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_red_optiune_retrasa') THEN
    RAISE EXCEPTION '20261226a revenire: postconditie: drepturile functiilor / fn_red_optiune_retrasa';
  END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';
  IF v_def IS DISTINCT FROM quote_literal('Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.') || '::text' THEN
    RAISE EXCEPTION '20261226a revenire: postconditie: DEFAULT-ul declaratiei (%)', coalesce(v_def, 'lipsa');
  END IF;
  SELECT count(*), string_agg(s.id::text || ' ' || s.cod || ' v' || s.versiune, '; ' ORDER BY s.cod) INTO v_n, v_lista FROM red_decl_rev_20261226a s;
  SELECT count(*) INTO v_ramase FROM public.red_proiecte pr
   WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.';
  RAISE NOTICE '20261226a revenire: % proiecte readuse la declaratia veche (id cod versiune: %); % proiecte raman cu textul nou (editate intre timp sau create dupa migrare: de lamurit separat)',
    v_n, coalesce(v_lista, '-'), v_ramase;
END $post$;
