-- DRY 20270111a_ctc_autorizatii_ndt: se ruleaza DUPA 20270111a, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_ctc_autorizatii_ndt_local.mjs). Nimic nu ramane scris.
-- Conturi si firme SINTETICE (fara date reale): u_of = doar modulul ofertare (introduce documentele), u_ctc = doar modulul ctc (citeste in CTC),
--   u_nimic = niciun modul. Fiecare pas ruleaza ca rolul authenticated cu JWT-ul contului (ambele surse: request.jwt.claim.sub si
--   request.jwt.claims), verificat la fiecare pas: auth.uid(), current_user, rol fara BYPASSRLS.
--   t_categorie  categoria noua acceptata, una necunoscuta refuzata de CHECK (23514);
--   t_garda      calea: NDT al altei firme / non-NDT sub ndt/ / segment .. / cale de licitatie pe un rand NDT = refuz (23514);
--                certificat..pdf acceptat la NDT si la certificat_legal; schimbarea categoriei cu fisier: fara cale noua refuz, cu cale noua ok;
--   t_unic       aceeasi cale pe doua randuri = 23505;
--   t_lista      contul CTC vede DOAR randurile NDT ale firmelor sintetice, DOAR coloanele permise, cu starea corecta; ofertare / nimic = 42501;
--                contul CTC NU citeste tabelul direct (RLS-ul Ofertare neschimbat);
--   t_fisier     calea doar pentru NDT cu cale valida; non-NDT / inexistent / fara fisier / rand scris ocolind trigger-ul = NULL; ofertare = 42501.
-- FIXTURI: pe clona, daca profiles / user_module_access / ofertare_parteneri cer alte coloane NOT NULL, se completeaza doar aici.
BEGIN;
SET LOCAL search_path = public, pg_temp;
DO $fix$
DECLARE u uuid; m text; v_pid1 bigint; v_pid2 bigint;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DRY 20270111a PRECONDITIE: se ruleaza ca postgres (acum %)', current_user; END IF;
  IF nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'DRY 20270111a PRECONDITIE: sesiune proaspata (fara JWT setat inainte)';
  END IF;
  IF to_regprocedure('public.fn_ctc_autorizatii_ndt()') IS NULL OR to_regprocedure('public.fn_ctc_autorizatie_ndt_fisier(bigint)') IS NULL THEN
    RAISE EXCEPTION 't_categorie FAIL: migrarea 20270111a nu e aplicata (RPC-urile lipsesc)';
  END IF;
  FOR u, m IN SELECT * FROM (VALUES ('f0000000-0000-4000-8000-0000000111a1'::uuid, 'ofertare'), ('f0000000-0000-4000-8000-0000000111a2'::uuid, 'ctc'),
                                    ('f0000000-0000-4000-8000-0000000111a3'::uuid, NULL)) v LOOP
    IF to_regclass('auth.users') IS NOT NULL THEN
      EXECUTE 'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING' USING u;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'role' AND NOT attisdropped) THEN
      EXECUTE 'INSERT INTO public.profiles (id, is_owner, role) VALUES ($1, false, ''teren'') ON CONFLICT (id) DO NOTHING' USING u;
    ELSE
      INSERT INTO public.profiles (id, is_owner) VALUES (u, false) ON CONFLICT (id) DO NOTHING;
    END IF;
    IF m IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_module_access'::regclass AND attname = 'access_level' AND NOT attisdropped) THEN
        EXECUTE 'INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ($1, $2, ''viewer'')' USING u, m;
      ELSE
        INSERT INTO public.user_module_access (profile_id, module) VALUES (u, m);
      END IF;
    END IF;
  END LOOP;
  INSERT INTO public.ofertare_parteneri (nume, cui) VALUES ('DRY NDT FIRMA UNU', 'RO-DRY-1') RETURNING id INTO v_pid1;
  INSERT INTO public.ofertare_parteneri (nume, cui) VALUES ('DRY NDT FIRMA DOI', 'RO-DRY-2') RETURNING id INTO v_pid2;
  PERFORM set_config('dry.p1', v_pid1::text, true);
  PERFORM set_config('dry.p2', v_pid2::text, true);
END $fix$;
CREATE FUNCTION pg_temp.rd_p(i int) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT current_setting('dry.p' || i)::bigint $f$;
CREATE FUNCTION pg_temp.rd_u(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE k WHEN 'of' THEN 'f0000000-0000-4000-8000-0000000111a1' WHEN 'ctc' THEN 'f0000000-0000-4000-8000-0000000111a2'
                ELSE 'f0000000-0000-4000-8000-0000000111a3' END::uuid $f$;
-- devine contul k (rolul authenticated, ambele surse JWT), verificat; înapoi la postgres cu rd_postgres()
CREATE FUNCTION pg_temp.rd_ca(k text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.rd_u(k)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.rd_u(k)::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM pg_temp.rd_u(k)
     OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rd_ca: identitate gresita (rol %, uid %)', current_user, auth.uid();
  END IF;
END $f$;
CREATE FUNCTION pg_temp.rd_postgres() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'rd_postgres: rol %', current_user; END IF;
END $f$;
-- un document scris ca u_of (garda activă); întoarce id-ul
CREATE FUNCTION pg_temp.rd_doc(p int, cat text, nr text, cale text, valab date DEFAULT NULL, fara boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  PERFORM pg_temp.rd_ca('of');
  INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, numar_document, emitent, domeniu, data_valabilitate, fara_expirare, fisier_path, observatii)
    VALUES (pg_temp.rd_p(p), cat, 'DRY ' || nr, nr, 'DRY EMITENT', 'RT', valab, fara, cale, 'DRY observatie interna') RETURNING id INTO v;
  PERFORM pg_temp.rd_postgres();
  RETURN v;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.rd_p(int), pg_temp.rd_u(text), pg_temp.rd_ca(text), pg_temp.rd_postgres() TO authenticated;

-- ── t_categorie ──
DO $t$
DECLARE v bigint;
BEGIN
  v := pg_temp.rd_doc(1, 'autorizatie_ndt', 'DRY-RT-1', 'parteneri/' || pg_temp.rd_p(1) || '/ndt/1700000000001_rt.pdf', (now() AT TIME ZONE 'Europe/Bucharest')::date + 30);
  IF v IS NULL THEN RAISE EXCEPTION 't_categorie FAIL: documentul NDT nu s-a scris'; END IF;
  BEGIN
    PERFORM pg_temp.rd_doc(1, 'necunoscuta', 'DRY-X', NULL);
    RAISE EXCEPTION 't_categorie FAIL: categorie necunoscuta acceptata';
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.rd_postgres();
  END;
  RAISE NOTICE 'DRY 20270111a t_categorie OK';
END $t$;

-- ── t_garda ──
DO $t$
DECLARE r record; v_iso bigint; v_alta bigint; p1 text := pg_temp.rd_p(1)::text; p2 text := pg_temp.rd_p(2)::text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('autorizatie_ndt', 'parteneri/' || p2 || '/ndt/1700000000002_alta_firma.pdf', 'NDT in dosarul altei firme'),
      ('autorizatie_ndt', 'parteneri/' || p1 || '/1700000000003_fara_dosar.pdf', 'NDT in afara dosarului ndt'),
      ('autorizatie_ndt', 'parteneri/' || p1 || '/ndt/..', 'segment ..'),
      ('autorizatie_ndt', 'licitatii/103/caiet_de_sarcini.pdf', 'cale de licitatie'),
      ('certificat_legal', 'parteneri/' || p1 || '/ndt/1700000000004_x.pdf', 'non-NDT sub ndt/')
    ) v(cat, cale, ce) LOOP
    BEGIN
      PERFORM pg_temp.rd_doc(1, r.cat, 'DRY-G', r.cale);
      RAISE EXCEPTION 't_garda FAIL: % acceptat', r.ce;
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.rd_postgres();
    END;
  END LOOP;
  PERFORM pg_temp.rd_doc(1, 'autorizatie_ndt', 'DRY-PCT-NDT', 'parteneri/' || p1 || '/ndt/1700000000005_certificat..pdf');
  PERFORM pg_temp.rd_doc(1, 'certificat_legal', 'DRY-PCT-CL', 'parteneri/' || p1 || '/1700000000006_certificat..pdf');
  -- un rând NDT existent primește direct (PATCH) calea unui document de licitație = refuz
  BEGIN
    PERFORM pg_temp.rd_ca('of');
    UPDATE public.ofertare_parteneri_documente SET fisier_path = 'licitatii/103/caiet_de_sarcini.pdf' WHERE numar_document = 'DRY-RT-1';
    RAISE EXCEPTION 't_garda FAIL: PATCH cu cale de licitatie pe rand NDT acceptat';
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.rd_postgres();
  END;
  -- schimbarea categoriei unui document cu fișier
  v_iso := pg_temp.rd_doc(1, 'iso', 'DRY-ISO', 'parteneri/' || p1 || '/1700000000007_iso.pdf');
  BEGIN
    PERFORM pg_temp.rd_ca('of');
    UPDATE public.ofertare_parteneri_documente SET categorie = 'autorizatie_ndt' WHERE id = v_iso;
    RAISE EXCEPTION 't_garda FAIL: iso -> NDT fara cale noua acceptat';
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.rd_postgres();
  END;
  PERFORM pg_temp.rd_ca('of');
  UPDATE public.ofertare_parteneri_documente SET categorie = 'autorizatie_ndt', fisier_path = 'parteneri/' || p1 || '/ndt/1700000000008_iso.pdf' WHERE id = v_iso;
  IF NOT FOUND THEN RAISE EXCEPTION 't_garda FAIL: iso -> NDT cu cale noua nu s-a scris'; END IF;
  PERFORM pg_temp.rd_postgres();
  BEGIN
    PERFORM pg_temp.rd_ca('of');
    UPDATE public.ofertare_parteneri_documente SET categorie = 'alta' WHERE id = v_iso;
    RAISE EXCEPTION 't_garda FAIL: NDT -> alta cu cale in ndt/ acceptat';
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.rd_postgres();
  END;
  v_alta := pg_temp.rd_doc(2, 'alta', 'DRY-FARA', NULL);
  PERFORM pg_temp.rd_ca('of');
  UPDATE public.ofertare_parteneri_documente SET categorie = 'autorizatie_ndt' WHERE id = v_alta;
  IF NOT FOUND THEN RAISE EXCEPTION 't_garda FAIL: document fara fisier nu si-a putut schimba categoria'; END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270111a t_garda OK';
END $t$;

-- ── t_unic ──
DO $t$
BEGIN
  BEGIN
    PERFORM pg_temp.rd_doc(1, 'autorizatie_ndt', 'DRY-DUBLU', 'parteneri/' || pg_temp.rd_p(1) || '/ndt/1700000000001_rt.pdf');
    RAISE EXCEPTION 't_unic FAIL: aceeasi cale pe doua randuri acceptata';
  EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.rd_postgres();
  END;
  RAISE NOTICE 'DRY 20270111a t_unic OK';
END $t$;

-- ── t_lista ──
DO $t$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_chei text; v_rau text; v_n integer; v_lista jsonb;
BEGIN
  PERFORM pg_temp.rd_doc(2, 'autorizatie_ndt', 'DRY-ST-FARA', NULL, NULL, true);
  PERFORM pg_temp.rd_doc(2, 'autorizatie_ndt', 'DRY-ST-NEC', NULL, NULL, false);
  PERFORM pg_temp.rd_doc(2, 'autorizatie_ndt', 'DRY-ST-IERI', 'parteneri/' || pg_temp.rd_p(2) || '/ndt/1700000000009_ieri.pdf', v_azi - 1);
  PERFORM pg_temp.rd_doc(2, 'autorizatie_ndt', 'DRY-ST-AZI', 'parteneri/' || pg_temp.rd_p(2) || '/ndt/1700000000010_azi.pdf', v_azi);
  PERFORM pg_temp.rd_ca('ctc');
  SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) INTO v_lista FROM public.fn_ctc_autorizatii_ndt() l WHERE l.firma LIKE 'DRY NDT FIRMA %';
  PERFORM pg_temp.rd_postgres();
  SELECT string_agg(k, ',' ORDER BY k) INTO v_chei FROM (SELECT DISTINCT jsonb_object_keys(e) AS k FROM jsonb_array_elements(v_lista) e) c;
  IF v_chei IS DISTINCT FROM 'are_fisier,cui,data_emitere,data_valabilitate,emitent,fara_expirare,firma,id,metoda,numar_document,stare' THEN
    RAISE EXCEPTION 't_lista FAIL: coloane %', v_chei;
  END IF;
  -- așteptat (scris de mână): doar NDT; stările după ziua din România; are_fisier
  SELECT string_agg(coalesce(a.nr, '+' || (x.e ->> 'numar_document')) || ' ' || coalesce(x.e ->> 'stare', 'LIPSA') || '/' || coalesce(x.e ->> 'are_fisier', '-'), '; ') INTO v_rau
    FROM (VALUES ('DRY-RT-1', 'valabil', 'true'), ('DRY-PCT-NDT', 'necunoscut', 'true'), ('DRY-ISO', 'necunoscut', 'true'), ('DRY-FARA', 'necunoscut', 'false'),
                 ('DRY-ST-FARA', 'valabil', 'false'), ('DRY-ST-NEC', 'necunoscut', 'false'), ('DRY-ST-IERI', 'expirat', 'true'), ('DRY-ST-AZI', 'valabil', 'true')) a(nr, stare, fisier)
    FULL JOIN (SELECT e FROM jsonb_array_elements(v_lista) e) x ON x.e ->> 'numar_document' = a.nr
   WHERE a.nr IS NULL OR x.e IS NULL OR (x.e ->> 'stare') IS DISTINCT FROM a.stare OR (x.e ->> 'are_fisier') IS DISTINCT FROM a.fisier;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 't_lista FAIL: %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) e WHERE e ->> 'numar_document' = 'DRY-RT-1' AND e ->> 'firma' = 'DRY NDT FIRMA UNU'
                   AND e ->> 'cui' = 'RO-DRY-1' AND e ->> 'metoda' = 'RT' AND e ->> 'emitent' = 'DRY EMITENT') THEN
    RAISE EXCEPTION 't_lista FAIL: campurile profesionale ale DRY-RT-1';
  END IF;
  PERFORM pg_temp.rd_ca('ctc');
  -- contul CTC nu citește tabelul direct (RLS-ul Ofertare, neschimbat)
  SELECT count(*) INTO v_n FROM public.ofertare_parteneri_documente d WHERE d.numar_document LIKE 'DRY-%';
  IF v_n <> 0 THEN RAISE EXCEPTION 't_lista FAIL: contul CTC citeste direct % documente Ofertare', v_n; END IF;
  PERFORM pg_temp.rd_postgres();
  FOREACH v_chei IN ARRAY ARRAY['of', 'nimic'] LOOP
    BEGIN
      PERFORM pg_temp.rd_ca(v_chei);
      PERFORM 1 FROM public.fn_ctc_autorizatii_ndt();
      RAISE EXCEPTION 't_lista FAIL: contul % (fara CTC) a primit lista', v_chei;
    EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.rd_postgres();
    END;
  END LOOP;
  RAISE NOTICE 'DRY 20270111a t_lista OK';
END $t$;

-- ── t_fisier ──
DO $t$
DECLARE r record; v_cale text; v_ocolit bigint; v_cl bigint; v_fara bigint; p1 text := pg_temp.rd_p(1)::text;
BEGIN
  SELECT id INTO STRICT v_cl FROM public.ofertare_parteneri_documente WHERE numar_document = 'DRY-PCT-CL';
  SELECT id INTO STRICT v_fara FROM public.ofertare_parteneri_documente WHERE numar_document = 'DRY-ST-FARA';
  -- un rând NDT scris OCOLIND trigger-ul (proprietarul tabelului, trigger-ul oprit doar aici; ROLLBACK la final)
  ALTER TABLE public.ofertare_parteneri_documente DISABLE TRIGGER trg_ofertare_doc_cale_garda;
  INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, numar_document, fisier_path)
    VALUES (pg_temp.rd_p(1), 'autorizatie_ndt', 'DRY ocolit', 'DRY-OCOLIT', 'licitatii/103/caiet_ocolit.pdf') RETURNING id INTO v_ocolit;
  ALTER TABLE public.ofertare_parteneri_documente ENABLE TRIGGER trg_ofertare_doc_cale_garda;
  PERFORM pg_temp.rd_ca('ctc');
  SELECT public.fn_ctc_autorizatie_ndt_fisier(d.id) INTO v_cale FROM public.fn_ctc_autorizatii_ndt() d WHERE d.numar_document = 'DRY-RT-1';
  IF v_cale IS DISTINCT FROM 'parteneri/' || p1 || '/ndt/1700000000001_rt.pdf' THEN RAISE EXCEPTION 't_fisier FAIL: calea DRY-RT-1 = %', v_cale; END IF;
  FOR r IN SELECT * FROM (VALUES (v_cl, 'document certificat_legal'), (v_fara, 'NDT fara fisier'), (v_ocolit, 'NDT scris ocolind trigger-ul'),
                                 (-1::bigint, 'inexistent')) v(id, ce) LOOP
    IF public.fn_ctc_autorizatie_ndt_fisier(r.id) IS NOT NULL THEN RAISE EXCEPTION 't_fisier FAIL: % a primit o cale', r.ce; END IF;
  END LOOP;
  PERFORM pg_temp.rd_postgres();
  BEGIN
    PERFORM pg_temp.rd_ca('of');
    PERFORM public.fn_ctc_autorizatie_ndt_fisier(v_cl);
    RAISE EXCEPTION 't_fisier FAIL: contul fara CTC a trecut de drept';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.rd_postgres();
  END;
  RAISE NOTICE 'DRY 20270111a t_fisier OK';
END $t$;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270111a TOTUL OK'; END $t$;
ROLLBACK;
