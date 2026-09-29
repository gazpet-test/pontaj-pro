-- Suita extinsă J04×J07 — helper-e de test (schema jx). NU este schemă de aplicație: nu e expusă prin PostgREST,
-- există doar în baza locală de test jakv0407_test_*, creată și ștearsă de scripts/pg/test_j04xj07.mjs.
-- Runner-ul o încarcă O DATĂ, după migrări, în aceeași tranzacție cu schema (COMMIT în baza de unică folosință).
--
-- Convenții:
--   * Rolurile se schimbă cu macro-urile psql :admin / :editor / :owner / :fara_acces / :anon / :service
--     (definite de runner): „editor” = authenticated cu modulul Ofertare, sesiune NE-postgres (session_user = jx_actor).
--   * Pașii „-- @edge j04|j07 …” din fișierele de test rulează MODULELE REALE ale edge-urilor (verificare.mjs,
--     evalueaza.mjs) ca service_role, în aceeași sesiune/tranzacție; după pas, sesiunea rămâne pe :admin.
--   * jx.refuza(sql, sqlstate, fragment) = refuz obligatoriu + dovada că starea și dovezile NU s-au schimbat.

GRANT USAGE ON SCHEMA jx TO authenticated, anon, service_role;

-- Configurație (hash-ul fotografiei de bază, pentru dovada izolării ROLLBACK după fiecare test).
CREATE TABLE jx.config(cheie text PRIMARY KEY, valoare text NOT NULL);

-- Storage simulat: storage.objects ține metadatele (ca în Supabase), jx.bucket ține bytes-ii serviți la download.
CREATE TABLE jx.bucket(name text PRIMARY KEY, continut bytea NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON jx.bucket TO authenticated, service_role;
CREATE SEQUENCE jx.obj_seq;
GRANT USAGE ON SEQUENCE jx.obj_seq TO authenticated, service_role;

-- Răspunsurile edge-urilor (scrise de runner după fiecare pas @edge; dispar la ROLLBACK, ca tot testul).
CREATE TABLE jx.raspunsuri(id bigserial PRIMARY KEY, edge text NOT NULL, r jsonb NOT NULL);
-- Fotografii nominale (ex. „înainte de refuz”, „după verificare”), tot în tranzacția testului.
CREATE TABLE jx.fotografii(eticheta text PRIMARY KEY, f jsonb NOT NULL);

CREATE FUNCTION jx.sha(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

-- Aserțiuni (ASSERT PL/pgSQL; runner-ul verifică plpgsql.check_asserts = on).
CREATE FUNCTION jx.ok(c boolean, mesaj text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT c IS TRUE, mesaj; END $$;
CREATE FUNCTION jx.egal(obtinut jsonb, asteptat jsonb, mesaj text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ASSERT obtinut IS NOT DISTINCT FROM asteptat, format('%s — obținut %s, așteptat %s', mesaj, obtinut, asteptat);
END $$;

-- Starea care NU are voie să se schimbe la un refuz: pachete, manifest, dovezi J04, rezultate J07, licitații,
-- audit J05, Storage (metadate + bytes) și sursele J07. SECURITY DEFINER: vede tot, indiferent de RLS-ul apelantului.
CREATE FUNCTION jx.foto() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'pachete',    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id), '[]') FROM ofertare_pt_pachet p),
    'manifest',   (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id), '[]') FROM ofertare_pt_pachet_fisiere f),
    'verificari', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id), '[]') FROM ofertare_pt_pachet_verificari v),
    'text',       (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') FROM ofertare_poarta_rezultate_text t),
    'licitatii',  (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM ofertare_licitatii l),
    'j05',        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id), '[]') FROM ofertare_derogari_audit a),
    'storage',    (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY name), '[]') FROM storage.objects o),
    'bytes',      (SELECT coalesce(jsonb_agg(jsonb_build_array(name, md5(continut)) ORDER BY name), '[]') FROM jx.bucket),
    'surse',      jsonb_build_array(
                    (SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY id), '[]') FROM ofertare_pt_capitole k),
                    (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM ofertare_pt_legaturi l),
                    (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id), '[]') FROM grafic_versiuni g),
                    (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id), '[]') FROM ofertare_cerinte c),
                    (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY licitatie_id), '[]') FROM ofertare_pt_garantie g),
                    (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id), '[]') FROM ofertare_pt_anexe_asteptate a)))
$$;
CREATE FUNCTION jx.fotografiaza(p_eticheta text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ INSERT INTO jx.fotografii VALUES (p_eticheta, jx.foto()) ON CONFLICT (eticheta) DO UPDATE SET f = EXCLUDED.f $$;
CREATE FUNCTION jx.neschimbat(p_eticheta text, p_mesaj text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  ASSERT jx.foto() = (SELECT f FROM jx.fotografii WHERE eticheta = p_eticheta),
    format('%s: starea/dovezile s-au schimbat față de fotografia „%s”', p_mesaj, p_eticheta);
END $$;

-- Refuz obligatoriu, cu codul SQLSTATE și fragmentul de mesaj așteptate; la refuz NIMIC nu se schimbă (fotografie
-- completă înainte/după). Instrucțiunea rulează cu rolul CURENT al sesiunii (SECURITY INVOKER). Întoarce mesajul.
CREATE FUNCTION jx.refuza(p_sql text, p_cod text, p_fragment text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE f0 jsonb := jx.foto(); refuzat boolean := false; m text; c text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS m = MESSAGE_TEXT, c = RETURNED_SQLSTATE;
    ASSERT c = p_cod, format('Refuz cu alt cod: %s în loc de %s — %s — pentru: %s', c, p_cod, m, p_sql);
    ASSERT position(p_fragment IN m) > 0, format('Refuz fără fragmentul „%s”: %s — pentru: %s', p_fragment, m, p_sql);
    refuzat := true;
  END;
  ASSERT refuzat, 'Refuz obligatoriu, dar instrucțiunea a TRECUT: ' || p_sql;
  ASSERT jx.foto() = f0, 'Refuzul a schimbat starea sau dovezile: ' || p_sql;
  RETURN m;
END $$;
-- Variantă pentru refuzurile care pot veni din două straturi (ex. INSERT „depus”: RLS WITH CHECK sau trigger).
CREATE FUNCTION jx.refuza_oricare(p_sql text, p_coduri text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE f0 jsonb := jx.foto(); refuzat boolean := false; m text; c text;
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS m = MESSAGE_TEXT, c = RETURNED_SQLSTATE;
    ASSERT c = ANY(p_coduri), format('Refuz cu cod neașteptat %s (%s) pentru: %s', c, m, p_sql);
    refuzat := true;
  END;
  ASSERT refuzat, 'Refuz obligatoriu, dar instrucțiunea a TRECUT: ' || p_sql;
  ASSERT jx.foto() = f0, 'Refuzul a schimbat starea sau dovezile: ' || p_sql;
  RETURN m;
END $$;
-- Instrucțiune care trebuie să nu aibă NICIUN efect (ex. UPDATE filtrat de RLS la 0 rânduri), fără eroare.
CREATE FUNCTION jx.fara_efect(p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f0 jsonb := jx.foto(); n bigint;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, format('Trebuia 0 rânduri afectate, au fost %s: %s', n, p_sql);
  ASSERT jx.foto() = f0, 'Instrucțiunea a schimbat starea: ' || p_sql;
END $$;

-- Verdictul porții J07 (agregatorul real) și starea pachetului, citite ca owner-ul funcției (fără RLS).
CREATE FUNCTION jx.blocaje(p_lic bigint DEFAULT 1) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT public.ofertare_poarta_server(p_lic)->'blocaje' $$;
CREATE FUNCTION jx.control(p_lic bigint, p_cod text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT c FROM jsonb_array_elements(public.ofertare_poarta_server(p_lic)->'controale') c WHERE c->>'control_code' = p_cod $$;
CREATE FUNCTION jx.stare(p_pachet bigint) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT stare FROM ofertare_pt_pachet WHERE id = p_pachet $$;
CREATE FUNCTION jx.ultim(p_edge text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
$$ SELECT r FROM jx.raspunsuri WHERE edge = p_edge ORDER BY id DESC LIMIT 1 $$;
CREATE FUNCTION jx.raspuns(p_edge text, p_r jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS
$$ INSERT INTO jx.raspunsuri(edge, r) VALUES (p_edge, p_r) $$;

-- Storage: încărcare ca rolul CURENT (politicile R12 se aplică), cu metadatele Supabase (size, eTag = md5).
CREATE FUNCTION jx.urca(p_path text, p_continut text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b bytea := convert_to(p_continut, 'UTF8'); n bigint := nextval('jx.obj_seq'); v_id uuid;
BEGIN
  v_id := ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid;
  INSERT INTO storage.objects(id, bucket_id, name, updated_at, metadata)
  VALUES (v_id, 'ofertare', p_path, timestamptz '2026-10-02 10:00:00+00' + n * interval '1 millisecond',
          jsonb_build_object('size', length(b), 'eTag', md5(b)));
  INSERT INTO jx.bucket VALUES (p_path, b) ON CONFLICT (name) DO UPDATE SET continut = EXCLUDED.continut;
  RETURN v_id;
END $$;
-- Suprascriere la aceeași cale (upsert Storage cu cheia de serviciu / administrare): id păstrat, updated_at + eTag noi.
CREATE FUNCTION jx.inlocuieste(p_path text, p_continut text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b bytea := convert_to(p_continut, 'UTF8');
BEGIN
  UPDATE storage.objects SET updated_at = updated_at + interval '1 second',
    metadata = jsonb_build_object('size', length(b), 'eTag', md5(b))
  WHERE bucket_id = 'ofertare' AND name = p_path;
  ASSERT FOUND, 'jx.inlocuieste: obiect inexistent ' || p_path;
  UPDATE jx.bucket SET continut = b WHERE name = p_path;
END $$;
-- Șters + reurcat cu ACEEAȘI bytes: alt id de obiect.
CREATE FUNCTION jx.reurca(p_path text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b bytea;
BEGIN
  SELECT continut INTO b FROM jx.bucket WHERE name = p_path;
  DELETE FROM storage.objects WHERE bucket_id = 'ofertare' AND name = p_path;
  PERFORM jx.urca(p_path, convert_from(b, 'UTF8'));
END $$;
CREATE FUNCTION jx.sterge(p_path text) RETURNS void LANGUAGE sql AS $$
  DELETE FROM storage.objects WHERE bucket_id = 'ofertare' AND name = p_path;
  DELETE FROM jx.bucket WHERE name = p_path;
$$;
CREATE FUNCTION jx.goleste(p_path text) RETURNS void LANGUAGE sql AS $$
  UPDATE storage.objects SET updated_at = updated_at + interval '1 second',
    metadata = jsonb_build_object('size', 0, 'eTag', md5(''::bytea)) WHERE bucket_id = 'ofertare' AND name = p_path;
  UPDATE jx.bucket SET continut = ''::bytea WHERE name = p_path;
$$;

-- Manifest: rând nou ca rolul CURENT (RLS R11: depus_final/dovada_seap doar în pachet aprobat), SHA-256 al
-- conținutului DECLARAT (poate diferi intenționat de bytes-ii din bucket).
CREATE FUNCTION jx.fisier(p_pachet bigint, p_rol text, p_nume text, p_path text, p_declarat text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO ofertare_pt_pachet_fisiere(pachet_id, rol, nume, sha256, fisier_path, size_bytes)
  VALUES (p_pachet, p_rol, p_nume, jx.sha(p_declarat), p_path, octet_length(convert_to(p_declarat, 'UTF8')))
  RETURNING id
$$;

-- Starea editorială „neutră” pentru J07: capitol editat (text care nu schimbă verdictul evaluatorului) +
-- legătura reverificată de om la noua versiune (altfel „neverificate” ar bloca pe bună dreptate).
CREATE FUNCTION jx.editeaza_capitol(p_capitol bigint, p_continut text) RETURNS void LANGUAGE sql AS $$
  UPDATE ofertare_pt_capitole SET continut = p_continut WHERE id = p_capitol;
  UPDATE ofertare_pt_legaturi SET verificat_la_versiunea = (SELECT versiune FROM ofertare_pt_capitole WHERE id = p_capitol)
  WHERE capitol_id = p_capitol;
$$;

-- Marcaje pentru runner (NOTICE): început / reușită / izolare ROLLBACK / constatare.
CREATE FUNCTION jx.start(p_id text, p_descriere text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'JX_START|%|%', p_id, p_descriere; END $$;
CREATE FUNCTION jx.trecut(p_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'JX_PASS|%', p_id; END $$;
CREATE FUNCTION jx.constatare(p_id text, p_text text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE 'JX_CONSTATARE|%|%', p_id, p_text; END $$;
-- După ROLLBACK: baza e EXACT cea de la început (nimic din test nu a scăpat din tranzacție).
CREATE FUNCTION jx.baza_intacta(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  ASSERT md5(jx.foto()::text) = (SELECT valoare FROM jx.config WHERE cheie = 'foto_baza'),
    p_id || ': după ROLLBACK baza diferă de fotografia de bază';
  RAISE NOTICE 'JX_BAZA|%', p_id;
END $$;

GRANT SELECT, INSERT ON jx.raspunsuri, jx.fotografii TO authenticated, anon, service_role;
GRANT USAGE ON SEQUENCE jx.raspunsuri_id_seq TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jx TO authenticated, anon, service_role;

-- Sursa J07 citită ca edge-ul (rolul curent = service_role): orice eroare RPC → NULL → edge-ul răspunde 409.
CREATE FUNCTION jx.sursa_text(p_lic bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN public.ofertare_poarta_text_sursa(p_lic); EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
GRANT EXECUTE ON FUNCTION jx.sursa_text(bigint) TO service_role;

-- Instrucțiune fără efect: fie filtrată la 0 rânduri (RLS), fie refuzată cu unul din codurile date; starea neschimbată.
CREATE FUNCTION jx.fara_efect_sau(p_sql text, p_coduri text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE f0 jsonb := jx.foto(); n bigint; c text; m text;
BEGIN
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, format('Trebuia 0 rânduri sau refuz, au fost %s: %s', n, p_sql);
    m := '0 rânduri';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS m = MESSAGE_TEXT, c = RETURNED_SQLSTATE;
    IF c = 'P0004' THEN RAISE; END IF;   -- ASSERT-ul de mai sus nu se înghite
    ASSERT c = ANY(p_coduri), format('Refuz cu cod neașteptat %s (%s) pentru: %s', c, m, p_sql);
  END;
  ASSERT jx.foto() = f0, 'Instrucțiunea a schimbat starea: ' || p_sql;
  RETURN m;
END $$;
GRANT EXECUTE ON FUNCTION jx.fara_efect_sau(text, text[]) TO authenticated, anon, service_role;

-- Doar dovezile și starea de business (fără Storage/surse): pentru „la refuz, dovezile anterioare rămân byte-identice”.
CREATE FUNCTION jx.dovezi() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jx.foto() - 'storage' - 'bytes' - 'surse'
$$;
GRANT EXECUTE ON FUNCTION jx.dovezi() TO authenticated, anon, service_role;
