-- PR3a DRY — NUMAI pe o clona izolata cu schema completa (30l + 30m + 31c).
-- Nu foloseste identitati/proiecte reale. psql -v ON_ERROR_STOP=1 -f acest_fisier.
-- Tranzactie explicit ANULATA. Nu aplica migrari. La orice eroare runnerul trebuie sa opreasca sesiunea.
BEGIN;
SET LOCAL request.jwt.claims = '';
DO $g$
BEGIN
  IF current_user <> 'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'DRY31C cere postgres NOSUPERUSER, ca in productie';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('31310000-0000-0000-0000-000000000001','31310000-0000-0000-0000-000000000002'))
    OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod = 'DRY31C') THEN
    RAISE EXCEPTION 'DRY31C: coliziune fixture; refuz fara modificari';
  END IF;
  IF to_regprocedure('public.fn_red_convocari_utilizatori_garda()') IS NULL THEN RAISE EXCEPTION 'DRY31C: poarta lipseste'; END IF;
END $g$;


-- R2 L15: executam exact blocul portii pentru plicuri (paritatea cu migrarea e verificata de Vitest).
CREATE FUNCTION pg_temp.dry31c_preflight_plicuri() RETURNS void LANGUAGE plpgsql AS $check$
BEGIN
  -- BEGIN L15_PLICURI_R2 (baseline 29i/29j/29k, callees comune verificate mai sus)
  IF EXISTS (SELECT 1 FROM (VALUES
    ('fn_red_plic_creeaza(uuid,uuid[])', '3ecc79e23de600a3b29235abed0a5c1c', 'plpgsql', true, 'v', '{authenticated=X/postgres,postgres=X/postgres}', ARRAY['search_path=public, pg_temp','lock_timeout=5s']::text[]),
    ('fn_red_plic_reguli()', 'cda947fbd65187a73b7929b59c74f2fb', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_propaga()', '888ad343fc14223ce5260e5e89305927', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_scan_exista(uuid,text)', '1fabc3317c0b7d655d7701ee9d500d7b', 'sql', true, 's', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_ar_calitate()', '2034d30779ea05a58c45fc6516fe7f8e', 'plpgsql', false, 'v', '{postgres=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_identitate_garda()', 'edce63d7568ccb5c51574007b42e17ad', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_detinatori_before()', 'dbdd7dc25c6da9322e1275e582642e66', 'plpgsql', true, 'v', '{postgres=X/postgres}', ARRAY['search_path=public, pg_temp']::text[])
  ) b(sig, hash, limbaj, definer, volatilitate, acl, config)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || b.sig)
    LEFT JOIN pg_language g ON g.oid = p.prolang
  WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.hash OR g.lanname IS DISTINCT FROM b.limbaj
    OR p.prosecdef IS DISTINCT FROM b.definer OR p.provolatile::text IS DISTINCT FROM b.volatilitate
    OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM b.config
    OR coalesce((SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)::text, '') IS DISTINCT FROM b.acl) THEN
    RAISE EXCEPTION '31c: preflight plicuri - functii/callee/ACL/config schimbate';
  END IF;
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_plicuri'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_plic_propaga=fn_red_plic_propaga()/O/17//0//;trg_red_plic_reguli=fn_red_plic_reguli()/O/23//0//;trg_red_versiune=fn_red_versiune_creste()/O/19//0//;trg_red_zz_ar_calitate=fn_red_plic_ar_calitate()/O/19//0//' THEN
    RAISE EXCEPTION '31c: preflight plicuri - triggere/argumente/coloane schimbate';
  END IF;
  -- END L15_PLICURI_R2
END $check$;
SELECT pg_temp.dry31c_preflight_plicuri();
DO $mutant_test$
DECLARE refuzat boolean := false;
BEGIN
  BEGIN
    -- Mutant real de 2 niveluri: plic -> trigger AFTER -> propagare golita (nu mai scrie data_expediere).
    EXECUTE $ddl$CREATE OR REPLACE FUNCTION public.fn_red_plic_propaga() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $mutant$BEGIN RETURN NULL; END $mutant$;$ddl$;
    BEGIN
      PERFORM pg_temp.dry31c_preflight_plicuri();
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM IS DISTINCT FROM '31c: preflight plicuri - functii/callee/ACL/config schimbate' THEN RAISE; END IF;
      refuzat := true;
    END;
    IF NOT refuzat THEN RAISE EXCEPTION 'DRY31C FAIL: mutantul propagarii a trecut preflight'; END IF;
    -- Anulam subtranzactia DOAR dupa refuzul exact: restauram corpul, owner/ACL/config originale.
    RAISE EXCEPTION 'restore mutant' USING ERRCODE = 'ZC001';
  EXCEPTION WHEN SQLSTATE 'ZC001' THEN NULL;
  END;
  PERFORM pg_temp.dry31c_preflight_plicuri();
  RAISE NOTICE 'DRY31C OK: preflight refuza mutantul propagarii; originalul restaurat trece';
END $mutant_test$;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('31310000-0000-0000-0000-000000000001', 'owner31c@example.invalid', 'authenticated', 'authenticated'),
  ('31310000-0000-0000-0000-000000000002', 'admin31c@example.invalid', 'authenticated', 'authenticated');
-- Compatibil si cu triggerul auth care creeaza deja profiles; sunt exclusiv UUID-urile fictive verificate mai sus.
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('31310000-0000-0000-0000-000000000001', 'owner31c@example.invalid', 'OWNER FICTIV 31C', true),
  ('31310000-0000-0000-0000-000000000002', 'admin31c@example.invalid', 'ADMIN FICTIV 31C', false)
ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner;
INSERT INTO public.user_module_access (profile_id, module, access_level)
  VALUES ('31310000-0000-0000-0000-000000000002', 'redari', 'admin');
INSERT INTO storage.objects (id, bucket_id, name, owner_id, metadata)
  VALUES ('31310000-0000-0000-0000-000000000010', 'redari', 'DRY31C/autorizare_tgz/fictiv.pdf',
    '31310000-0000-0000-0000-000000000001', '{"eTag":"fictiv31c"}');
INSERT INTO public.red_proiecte (id, cod, denumire, contract_nr, contract_data, imputernicire_nr, imputernicire_data,
  contact_nume, contact_telefon, contact_email, reprezentant_tgz_nume, reprezentant_tgz_telefon,
  autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_obiect, autorizare_tgz_etag)
VALUES ('31310000-0000-0000-0000-000000000020', 'DRY31C', 'PROIECT FICTIV', 'DRY', '2026-11-05', 'DRY', '2026-11-05',
  'CONTACT FICTIV', '0000000000', 'contact@example.invalid', 'TGZ FICTIV', '0000000000',
  'DRY', '2026-11-05', 'DRY31C/autorizare_tgz/fictiv.pdf', '31310000-0000-0000-0000-000000000010', 'fictiv31c');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, program_zi1)
  VALUES ('31310000-0000-0000-0000-000000000030', '31310000-0000-0000-0000-000000000020', 'UAT FICTIV', 'DRY', '2026-12-01', '09-15');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela, tronson)
  VALUES ('31310000-0000-0000-0000-000000000040', '31310000-0000-0000-0000-000000000020', '31310000-0000-0000-0000-000000000030', 'DRY-0001', 1);
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
  ('31310000-0000-0000-0000-000000000051', '31310000-0000-0000-0000-000000000040', 'UTILIZATOR FICTIV', 'UTILIZATOR FICTIV', 'utilizator'),
  ('31310000-0000-0000-0000-000000000052', '31310000-0000-0000-0000-000000000040', 'ARENDAS FICTIV', 'ARENDAS FICTIV', 'arendas'),
  ('31310000-0000-0000-0000-000000000053', '31310000-0000-0000-0000-000000000040', 'PROPRIETAR FICTIV', 'PROPRIETAR FICTIV', 'proprietar');
INSERT INTO public.red_detinatori_contact (detinator_id, adresa_strada, adresa_comuna, adresa_judet, adresa_cunoscuta)
  SELECT id, 'Strada Fictiva 1', 'UAT FICTIV', 'Judet fictiv', true FROM public.red_detinatori
    WHERE id IN ('31310000-0000-0000-0000-000000000051','31310000-0000-0000-0000-000000000052','31310000-0000-0000-0000-000000000053');
CREATE FUNCTION pg_temp.dry31c_refuz(p_sql text, p_cod text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE cod text; mesaj text;
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; mesaj := SQLERRM; END;
  IF cod IS DISTINCT FROM p_cod THEN RAISE EXCEPTION 'DRY31C: asteptat %, primit % (%)', p_cod, coalesce(cod, 'succes'), mesaj; END IF;
  IF p_cod = 'RD006' AND mesaj IS DISTINCT FROM 'utilizator - convocare neaprobata' THEN RAISE EXCEPTION 'DRY31C: motiv gresit %', mesaj; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.dry31c_refuz(text,text) TO authenticated;

SELECT set_config('dry31c.nr_inainte', coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0)::text, true);
-- Nici sesiunea SQL fara identitate nu poate aproba (fara bypass de mentenanta nou).
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_proiecte SET convocare_utilizatori_aprobata = true WHERE cod = 'DRY31C'$q$, '42501');
-- Non-owner ADMIN (nu viewer): UPDATE direct ajunge la trigger, nu e mascat de RLS.
SET LOCAL request.jwt.claims = '{"sub":"31310000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_proiecte SET convocare_utilizatori_aprobata = true WHERE cod = 'DRY31C'$q$, '42501');
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_proiecte SET convocare_utilizatori_aprobata_de = '31310000-0000-0000-0000-000000000002' WHERE cod = 'DRY31C'$q$, '42501');
SELECT pg_temp.dry31c_refuz($q$INSERT INTO public.red_proiecte (cod, convocare_utilizatori_aprobata) VALUES ('DRY31C-REFUZ', true)$q$, '42501');
-- R2: mascarea utilizator/arendas -> proprietar este refuzata chiar INAINTE de prima rezervare.
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000051'$q$, 'RD007');
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000052'$q$, 'RD007');
-- False: ambele calitati, toate canalele rezervate de RPC; confirmarea de numar nou nu ocoleste poarta.
DO $t$
DECLARE d uuid; canal text;
BEGIN
  FOREACH d IN ARRAY ARRAY['31310000-0000-0000-0000-000000000051'::uuid,'31310000-0000-0000-0000-000000000052'::uuid] LOOP
    FOREACH canal IN ARRAY ARRAY['posta','email','sms','afisare'] LOOP
      PERFORM pg_temp.dry31c_refuz(format('SELECT * FROM public.fn_red_convocare_rezerva(%L, true, %L)', d, canal), 'RD006');
    END LOOP;
  END LOOP;
END $t$;
DO $t$
BEGIN
  IF coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0)::text IS DISTINCT FROM current_setting('dry31c.nr_inainte')
    OR EXISTS (SELECT 1 FROM public.red_convocari WHERE detinator_id IN ('31310000-0000-0000-0000-000000000051','31310000-0000-0000-0000-000000000052')) THEN
    RAISE EXCEPTION 'DRY31C: refuzul a consumat numere / a inserat convocari';
  END IF;
END $t$;
-- Proprietar neafectat (inclusiv informarea publicata si protocolul 30l).
SELECT * FROM public.fn_red_convocare_rezerva('31310000-0000-0000-0000-000000000053');

-- Rezervare in masa UAT: clientul filtreaza; simularea server-side a unui client vechi raporteaza RD006 si continua.
CREATE TEMP TABLE dry31c_raport (calitate text, rezultat text);
DO $t$
DECLARE d record; cod text; motiv text;
BEGIN
  FOR d IN SELECT x.id, x.calitate FROM public.red_detinatori x JOIN public.red_parcele p ON p.id = x.parcela_id
    WHERE p.uat_id = '31310000-0000-0000-0000-000000000030' ORDER BY x.id LOOP
    BEGIN
      PERFORM * FROM public.fn_red_convocare_rezerva(d.id, true, 'email');
      INSERT INTO dry31c_raport VALUES (d.calitate, 'rezervat');
    EXCEPTION WHEN SQLSTATE 'RD006' THEN
      GET STACKED DIAGNOSTICS cod = RETURNED_SQLSTATE, motiv = MESSAGE_TEXT;
      INSERT INTO dry31c_raport VALUES (d.calitate, cod || ': ' || motiv);
    END;
  END LOOP;
  IF (SELECT count(*) FROM dry31c_raport WHERE rezultat = 'RD006: utilizator - convocare neaprobata') <> 2
    OR (SELECT count(*) FROM dry31c_raport WHERE calitate = 'proprietar' AND rezultat = 'rezervat') <> 1 THEN
    RAISE EXCEPTION 'DRY31C: lot UAT incorect';
  END IF;
END $t$;
TABLE dry31c_raport;
-- R2: proprietar -> utilizator/arendas cu convocare rezervata, apoi expediata: refuz RD007.
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'utilizator' WHERE id = '31310000-0000-0000-0000-000000000053'$q$, 'RD007');
UPDATE public.red_convocari SET data_expediere = DATE '2026-11-05'
  WHERE detinator_id = '31310000-0000-0000-0000-000000000053' AND canal = 'email';
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'arendas' WHERE id = '31310000-0000-0000-0000-000000000053'$q$, 'RD007');
-- Exceptia legitima: numai convocari anulate -> intrarea in utilizator e permisa cu false.
UPDATE public.red_convocari SET stare = 'anulat', motiv_anulare = 'DRY schimbare calitate'
  WHERE detinator_id = '31310000-0000-0000-0000-000000000053';
UPDATE public.red_detinatori SET calitate = 'utilizator' WHERE id = '31310000-0000-0000-0000-000000000053';
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000053'$q$, 'RD007');
RESET ROLE;

-- Owner aproba; triggerul pune cine/cand. Fara avizul avocatului.
SET LOCAL request.jwt.claims = '{"sub":"31310000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
UPDATE public.red_proiecte SET convocare_utilizatori_aprobata = true WHERE cod = 'DRY31C';
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod = 'DRY31C' AND convocare_utilizatori_aprobata
    AND convocare_utilizatori_aprobata_de = '31310000-0000-0000-0000-000000000001' AND convocare_utilizatori_aprobata_la IS NOT NULL) THEN
    RAISE EXCEPTION 'DRY31C: provenienta';
  END IF;
END $t$;
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_proiecte SET convocare_utilizatori_aprobata_la = '2000-01-01' WHERE cod = 'DRY31C'$q$, '42501');
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"31310000-0000-0000-0000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_proiecte SET convocare_utilizatori_aprobata = false WHERE cod = 'DRY31C'$q$, '42501');
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"31310000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT * FROM public.fn_red_convocare_rezerva('31310000-0000-0000-0000-000000000051');
SELECT * FROM public.fn_red_convocare_rezerva('31310000-0000-0000-0000-000000000052');
-- True: ambele tranzitii cu active sunt permise, jurnalizate; revenim la calitatea reala a fixture-ului.
UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000051';
UPDATE public.red_detinatori SET calitate = 'utilizator' WHERE id = '31310000-0000-0000-0000-000000000051';
UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000053';
DO $audit$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_detinatori'
    AND inregistrare_id = '31310000-0000-0000-0000-000000000051'
    AND date_vechi->>'calitate' = 'proprietar' AND date_noi->>'calitate' = 'utilizator'
    AND user_id = '31310000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'DRY31C: tranzitie permisa fara jurnal'; END IF;
END $audit$;
-- Pregatim documente fictive; niciun upload real.
UPDATE public.red_convocari SET fisier_convocator_path = 'DRY31C/fictiv.docx', continut_hash = repeat('a',64)
  WHERE detinator_id IN ('31310000-0000-0000-0000-000000000051','31310000-0000-0000-0000-000000000052');
-- Plic real prin RPC; pastram id-ul intr-un GUC doar de test (nu e folosit de autorizare).
DO $t$
DECLARE p public.red_plicuri;
BEGIN
  SELECT * INTO p FROM public.fn_red_plic_creeaza('31310000-0000-0000-0000-000000000020',
    ARRAY(SELECT id FROM public.red_convocari WHERE detinator_id = '31310000-0000-0000-0000-000000000052'));
  PERFORM set_config('dry31c.plic', p.id::text, true);
END $t$;
-- Fixture lot finalizat cu 2 semnatari fictivi; fara upload real. INSERT-urile respecta FK/CHECK.
RESET ROLE;
SET LOCAL request.jwt.claims = '';
INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot, data_plicuire, semnatar1_id, semnatar2_id, pv_path)
  VALUES ('31310000-0000-0000-0000-000000000070', '31310000-0000-0000-0000-000000000020', 'PP-9999', '2026-11-05',
    '31310000-0000-0000-0000-000000000001', '31310000-0000-0000-0000-000000000002', 'plicuire/31310000-0000-0000-0000-000000000070/fictiv.pdf');
INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', 'plicuire/31310000-0000-0000-0000-000000000070/fictiv.pdf'),
  ('redari', 'plicuri/' || current_setting('dry31c.plic') || '/opis.pdf');
UPDATE public.red_plicuri SET lot_id = '31310000-0000-0000-0000-000000000070',
  opis_path = 'plicuri/' || id || '/opis.pdf' WHERE id = current_setting('dry31c.plic')::uuid;
SET LOCAL request.jwt.claims = '{"sub":"31310000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
-- OFF e permis; provenienta ultimei aprobari ramane pentru rollback / audit.
UPDATE public.red_proiecte SET convocare_utilizatori_aprobata = false WHERE cod = 'DRY31C';
-- R2: cu convocari active, iesirea din utilizator/arendas ramane blocata dupa revocare.
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000051'$q$, 'RD007');
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_detinatori SET calitate = 'proprietar' WHERE id = '31310000-0000-0000-0000-000000000052'$q$, 'RD007');
-- Calea legitima de expediere: UPDATE pe plic -> fn_red_plic_propaga DEFINER -> convocari.
SELECT pg_temp.dry31c_refuz(format('UPDATE public.red_plicuri SET awb = ''DRY31C'', data_expediere = DATE ''2026-11-05'' WHERE id = %L', current_setting('dry31c.plic')), 'RD006');
-- Refuzul a anulat si scrierea plicului.
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.red_plicuri WHERE id = current_setting('dry31c.plic')::uuid AND data_expediere IS NOT NULL) THEN RAISE EXCEPTION 'DRY31C: plic expediat dupa refuz'; END IF;
END $t$;
UPDATE public.red_plicuri SET stare = 'anulat', motiv_anulare = 'DRY' WHERE id = current_setting('dry31c.plic')::uuid;
DO $t$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.red_convocari WHERE detinator_id IN ('31310000-0000-0000-0000-000000000051','31310000-0000-0000-0000-000000000052') LOOP
    PERFORM pg_temp.dry31c_refuz(format('UPDATE public.red_convocari SET continut_hash = repeat(''b'',64) WHERE id = %L', c.id), 'RD006');
    PERFORM pg_temp.dry31c_refuz(format('UPDATE public.red_convocari SET data_expediere = DATE ''2026-11-05'' WHERE id = %L', c.id), 'RD006');
    -- Anularea combinata cu expedierea NU trebuie sa ocoleasca poarta.
    PERFORM pg_temp.dry31c_refuz(format('UPDATE public.red_convocari SET stare = ''anulat'', motiv_anulare = ''DRY'', data_expediere = DATE ''2026-11-05'' WHERE id = %L', c.id), 'RD006');
    UPDATE public.red_convocari SET stare = 'anulat', motiv_anulare = 'DRY' WHERE id = c.id;
    -- Reactivarea unui document vechi se verifica din nou.
    PERFORM pg_temp.dry31c_refuz(format('UPDATE public.red_convocari SET stare = ''activ'', motiv_anulare = NULL WHERE id = %L', c.id), 'RD006');
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod = 'DRY31C' AND convocare_utilizatori_aprobata IS FALSE
    AND convocare_utilizatori_aprobata_de IS NOT NULL AND convocare_utilizatori_aprobata_la IS NOT NULL) THEN RAISE EXCEPTION 'DRY31C: OFF a pierdut auditul'; END IF;
END $t$;
-- UPDATE de reparentare: proprietar -> utilizator, inclusiv pe alt canal, e refuzat.
SELECT pg_temp.dry31c_refuz($q$UPDATE public.red_convocari SET detinator_id = '31310000-0000-0000-0000-000000000051'
  WHERE detinator_id = '31310000-0000-0000-0000-000000000053' AND canal = 'email'$q$, 'RD006');
RESET ROLE;
SET LOCAL request.jwt.claims = '';
ROLLBACK;
