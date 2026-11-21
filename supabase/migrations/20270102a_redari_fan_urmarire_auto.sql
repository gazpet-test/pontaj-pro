-- Version 20270102120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270102a_redari_fan_urmarire_auto.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ a runnerului. Lista OBIECTELOR din manifest e în
--   supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv (generată pe PGlite cu pașii reali ai runnerului). Pe lângă ea, migrarea
--   verifică pe amprentă (corp fără CR + proprietăți + EXECUTE), ÎNAINTE: poarta de drept fn_red_nivel (20261126a) și TOATE cele 52 de funcții
--   fn_red_fan_* ale bazei, EXACT lista AMPRENTE-NOI din 20261228a (listă scrisă, nu citită din catalog); DUPĂ: cele 56 de funcții (51 neschimbate,
--   fn_red_fan_srv_urmarire înlocuită, 4 noi) cu amprentele lor (AMPRENTE-NOI 20270102a) și EXECUTE exact pe clasă.
-- BAZA = 20261212a + 20261227a + 20261228a aplicate, în această ordine.
-- 20270102a_redari_fan_urmarire_auto — Redări FAN: urmărirea AWB-urilor actualizată AUTOMAT (decizia owner-ului, 21.11.2026; spec
--   docs/redari/FAN_FLUX_OPERATOR_SPEC.md §9, felia „F2a” din docs/redari/FAN_URMARIRE_AUTOMATA.md). Faptul de pornire: un AWB livrat pe 20.11 la
--   10:40 a ajuns în ERP abia pe 21.11, la apăsarea butonului „Urmărire”.
--   Ce adaugă: (1) red_fan_rulari = jurnalul rulărilor automate (una singură în curs odată; o rulare de cron pe slotul zilei — dimineața / seara,
--   ora României; cel mult 4 rulări manuale ale owner-ului pe zi; plafonul de solicitări FAN pe rulare); (2) patru RPC-uri ale clasei B (EXECUTE
--   EXCLUSIV service_role, în corp auth.uid() IS NULL): fn_red_fan_srv_rulare_incepe (revendicarea), fn_red_fan_srv_de_urmarit (ce e de urmărit:
--   o singură definiție, L19), fn_red_fan_srv_rulare_apel (pasul durabil al plafonului ÎNAINTEA fiecărui GET către curier),
--   fn_red_fan_srv_rulare_incheie (închiderea + un rând în red_jurnal); (3) fn_red_fan_srv_urmarire acceptă p_rulare (rezervat din 20261228a):
--   exact unul dintre p_actor / p_rulare e nenul; cu p_rulare scrie prin ACELAȘI corp fn_red_fan_urmarire_intern (CAS pe versiune, propuneri) și
--   adună numerele în rândul rulării. NU se schimbă: fn_red_fan_srv_confirmari (confirmările rămân la buton: dovada de livrare e a omului, F3),
--   ridicarea (rămâne „propusă”, confirmată de om prin fn_red_fan_ridicat), plicul (nicio scriere pe red_plicuri), contradicțiile („de verificat”).
--   Jobul cron NU e în migrare (postgres nu e superuser pe Supabase): îl pune coordonatorul cu cron.schedule DUPĂ aplicare (docs/redari/FAN_URMARIRE_AUTOMATA.md §5).
-- ORDINEA lock-urilor la rulare (L06; se adaugă la §6.2 ca poziția 12, DUPĂ red_fan_awb și ÎNAINTEA red_jurnal): fn_red_fan_srv_rulare_incepe =
--   advisory (cheia fixă a rulărilor) → rândurile red_fan_rulari; fn_red_fan_srv_rulare_apel = rândul rulării (UPDATE CAS); fn_red_fan_srv_urmarire
--   cu p_rulare = 3 red_fan_awb (ORDER BY id, în corpul comun) → 12 rândul rulării (UPDATE); fn_red_fan_srv_rulare_incheie = 12 rândul rulării →
--   11 red_jurnal (INSERT, ultimul). Nicio cale nu ia rândul rulării înaintea rândurilor FAN.
-- Lock-uri la APLICARE: niciunul pe tabelele existente (tabel nou, funcții noi, CREATE OR REPLACE pe o funcție = doar rândul ei din pg_proc;
--   politica nouă e pe tabelul nou). Nicio funcție creată nu rulează la aplicare (în afara postcondițiilor, care doar citesc).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms și garda finală a runnerului.
-- Revenire: supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql (prin runner, plafonul 2000; LOCK … NOWAIT pe red_fan_rulari;
--   refuză cu orice rulare sau eveniment urmarire_auto în red_jurnal; readuce TEXTUAL corpul din 20261228a al fn_red_fan_srv_urmarire, cu amprenta verificată DUPĂ).
-- Probe: scripts/pglite/test_redari_fan_urmarire_auto_local.mjs (PGlite: aplicarea ca runnerul peste 20261212a + 20261227a + 20261228a, clasa B
--   ca authenticated / anon / service_role, revendicarea și suprapunerea, plafonul, expirarea, selecția, scrierea cu p_rulare, revenirea, mutanți)
--   + supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh (două sesiuni reale pe un cluster dispensabil; netestat local).
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto:' || txid_current() THEN
    RAISE EXCEPTION '20270102a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270102a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270102a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270102a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270102a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270102a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- baza: 20261228a aplicată (tabelele F1, exact 52 de funcții fn_red_fan_*); reaplicare = refuz
  IF to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_intentii') IS NULL
     OR to_regclass('public.red_fan_operatori') IS NULL THEN
    RAISE EXCEPTION '20270102a: 20261228a nu e aplicata (tabelele FAN F1 lipsesc): ordinea e 20261212a -> 20261227a -> 20261228a -> 20270102a';
  END IF;
  IF to_regclass('public.red_fan_rulari') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_apel(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_de_urmarit(uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 52 THEN
    RAISE EXCEPTION '20270102a: obiectele exista deja sau numarul functiilor fn_red_fan_* nu e 52 (reaplicare / stare neasteptata)';
  END IF;
  -- coloanele citite / scrise, cu tipurile din migrările lor (20261126a, 20261129i, 20261212a, 20261228a)
  FOR r IN SELECT * FROM (VALUES
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'),
      ('red_proiecte', 'id', '^uuid$'), ('red_proiecte', 'cod', '^text$'),
      ('red_loturi_plicuire', 'id', '^uuid$'), ('red_loturi_plicuire', 'proiect_id', '^uuid$'),
      ('red_fan_awb', 'id', '^uuid$'), ('red_fan_awb', 'lot_id', '^uuid$'), ('red_fan_awb', 'awb', '^text$'), ('red_fan_awb', 'stare', '^text$'),
      ('red_fan_awb', 'versiune_urmarire', '^integer$'), ('red_fan_awb', 'urmarire_stare', '^text$'), ('red_fan_awb', 'livrat_la', '^timestamp with time zone$'),
      ('red_fan_awb', 'retur_cunoscut', '^boolean$'), ('red_fan_awb', 'generat_la', '^timestamp with time zone$'), ('red_fan_awb', 'urmarit_la', '^timestamp with time zone$'),
      ('red_fan_loturi', 'lot_id', '^uuid$'), ('red_fan_loturi', 'test', '^boolean$'),
      ('red_jurnal', 'tabela', '^text$'), ('red_jurnal', 'inregistrare_id', '^uuid$'), ('red_jurnal', 'actiune', '^text$'),
      ('red_jurnal', 'date_noi', '^jsonb$'), ('red_jurnal', 'user_id', '^uuid$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20270102a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  -- trigger-ele de pe red_fan_awb: EXACT cele două ale 20261228a (garda F1 + jurnalul oPOD 20261227a); scrierea urmăririi trece prin ele ca azi
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_garda' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_garda()') AND tg.tgtype = (1 | 2 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') AND tg.tgtype = (1 | 4 | 8 | 16)
                      AND tg.tgattr::text = '') THEN
    RAISE EXCEPTION '20270102a: red_fan_awb nu are exact trigger-ele din 20261228a (garda F1 + jurnalul oPOD)';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') OR NOT pg_has_role('postgres', 'service_role', 'USAGE') THEN
    RAISE EXCEPTION '20270102a: dependentele (auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── lanțul verificat pe amprentă ÎNAINTE: poarta de drept fn_red_nivel (20261126a) + cele 52 de funcții fn_red_fan_* EXACT ca după 20261228a
-- (lista AMPRENTE-NOI 20261228a, copiată: corp fără CR, limbaj, DEFINER, volatilitate, tipul întors, proprietar, EXECUTE pe clasă). Garanția
-- completă (orice altă funcție / politică / drept) = amprenta globală L15 v2 a runnerului. DUPĂ: lista AMPRENTE-NOI 20270102a din postcondiții.
CREATE FUNCTION pg_temp.lant_20270102a() RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_nivel()') AND md5(replace(p.prosrc, chr(13), '')) = '21db8e5d4b69b7f19e571a7087c361ae'
                   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270102a: lantul (inainte) difera: poarta de drept public.fn_red_nivel()';
  END IF;
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_fan_anulare_cere(uuid,text,text,text)', 'ca53da3cbf13b5dc8edb2e24ddfe2f85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_anulat(uuid,text,text)', '6af4ea9ab74f812a29a82ee076550ff2', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'f19e630e2e105cab2f0d65f18dcf47d8', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_awb_garda()', '7e8e1302f342d268bcd4a8c9906bce4f', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', false, false),
      ('public.fn_red_fan_cerere_decide(uuid,boolean,text)', '7515320fedb0b29fa2c23bc9d685966f', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_cerere_retrage(uuid)', '1825378bc3b3ae1f799186cd53e8c409', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_claim_intern(uuid,uuid[],text[],text[],uuid,uuid,boolean)', 'c36df6081bb2e28766f0d5e6e31def02', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'bb7fe9239528916d08e5e9a905fe587f', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', '437ae4f2662ea5626aa0dff220fdfa3c', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', 'da2e4ec6ab90886ffcf40a7dbc5562ca', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari_intern(uuid,jsonb)', 'f34677deebaf08abb03deec737e9db05', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_e_operator()', 'e1c0af5d6997c9c751929bcf652edc10', 'sql', true, 's', 'boolean', true, false),
      ('public.fn_red_fan_e_operator_profil(uuid)', 'c3ebc7662c7a99cf9122c7d0b0905671', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_intentie_incheie_intern(uuid,text,jsonb)', 'ac018ee8fe12ca3e8fe087a08c42ebf3', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_intentie_sumar(uuid)', '706c9c1fb43ee56f2ef030f7e226c62d', 'sql', true, 's', 'jsonb', false, false),
      ('public.fn_red_fan_lot_incheiat(uuid)', 'a788cd02f2ccbbf5fc6b1b5515790c58', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '49a056c348411ba320061c4da1ab3c25', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_lot_permis(uuid)', '74a3a78930b42f6100c2d76917461475', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_permis_valori(boolean,text,boolean)', '1b1110d5bb4934075e626e23a49e8d79', 'sql', false, 'i', 'boolean', false, false),
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', false, false),
      ('public.fn_red_fan_operator_seteaza(uuid,boolean,text)', '2312ff35d3b98c5a0fb41a4d385166de', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_propune(uuid,text,numeric)', '98ed533dba82a221c3e874aee2af62d5', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '95d5b20b47d04dd11ba230017d8fde85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_reconciliaza_intern(uuid,text,numeric,numeric,text,uuid,boolean)', '64afc6f76bcd26692ad694f8297d6334', 'plpgsql', true, 'v', 'text', false, false),
      ('public.fn_red_fan_retrage(uuid,text)', '1c786f1641f82f0287f2e8ee943465e9', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'f2a5a8d722a06dc34e5060321be15e12', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_rezultate_intern(uuid,jsonb,integer,uuid,uuid)', 'c46607410f5b6c8cdcb6710d0f9f2982', 'plpgsql', true, 'v', 'integer', false, false),
      ('public.fn_red_fan_ridicat(uuid,date)', '99fc55589bdf77c775d7ae1046edd537', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_setari_doar_test(boolean)', '5ca6a20b3ff16f37ee0fb497194a6c83', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_limita_zi(integer)', 'e6b5c61362b113c681298a8a66c0e2ca', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_setari_presupunere_429(boolean,text)', 'd7aa9ac982db4139f048452b7e71ff9f', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_srv_anuleaza(uuid,uuid,text,text)', '08958a14896e5b07c0892567f012c90d', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_claim(uuid,uuid,uuid,uuid[],text[],text[])', 'b8625e36c2dfec0a549287391b83374e', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_confirmari(uuid,uuid,uuid,jsonb)', 'a142ed8f327967633ed3b1e1bc334e87', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', '1017ae767ed3d8f947a18f8d3b9c2c6d', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_poarta(uuid,boolean)', 'eae0c2fa2fc3ec18b44ce55b60a96848', 'plpgsql', true, 's', 'void', false, false),
      ('public.fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', '38e16206cef4468c73e2cf103b163127', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', '216688178ad5d77bb059054a96a31a7a', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', '63ffdb70ebefb68fc1e944e0cd7305c7', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false, false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false, false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '36cafe6b98cf2436e5ffb42370139765', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '966a88fd8c20655714cf7a72dc25e748', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '40109588fdeb59c56784ab4b7ff616be', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_zi_garda()', '5c51181772f185ac5559913dd32918ec', 'plpgsql', true, 'v', 'trigger', false, false)
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, exec_auth, exec_srv)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_srv
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20270102a: lantul (inainte) difera de amprentele revizuite din 20261228a: %', v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20270102a(); END $l15_inainte$;

-- ═══ 1. Jurnalul rulărilor (RLS citire admin / editor Redări; scrieri DOAR prin RPC-urile clasei B: niciun GRANT de scriere pentru nimeni) ═══
CREATE TABLE public.red_fan_rulari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zi_ro date NOT NULL,                                   -- ziua în ora României a pornirii
  slot text NOT NULL CHECK (slot IN ('dimineata', 'seara', 'manual')),
  sursa text NOT NULL CHECK (sursa IN ('cron', 'owner')),
  pornita_de uuid,                                       -- owner-ul (rulare manuală); NULL la cron
  pornita_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  incheiata_la timestamptz,
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'incheiata', 'oprita_plafon', 'oprita_eroare', 'expirata')),
  plafon_apeluri integer NOT NULL CHECK (plafon_apeluri BETWEEN 1 AND 20),
  apeluri integer NOT NULL DEFAULT 0,                    -- solicitări GET către curier rezervate (pasul de dinaintea fiecărui apel)
  randuri integer NOT NULL DEFAULT 0 CHECK (randuri >= 0),
  scrise integer NOT NULL DEFAULT 0 CHECK (scrise >= 0),
  pastrate integer NOT NULL DEFAULT 0 CHECK (pastrate >= 0),
  depasite integer NOT NULL DEFAULT 0 CHECK (depasite >= 0),
  loturi integer CHECK (loturi IS NULL OR loturi >= 0),                    -- raportate la închidere
  loturi_sarite integer CHECK (loturi_sarite IS NULL OR loturi_sarite >= 0),
  eroare_cod text CHECK (eroare_cod IS NULL OR eroare_cod ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT red_fan_rulari_apeluri_plafon CHECK (apeluri >= 0 AND apeluri <= plafon_apeluri),
  CONSTRAINT red_fan_rulari_suma CHECK (scrise + pastrate + depasite = randuri),
  CONSTRAINT red_fan_rulari_pornire CHECK ((sursa = 'cron' AND pornita_de IS NULL AND slot <> 'manual') OR (sursa = 'owner' AND pornita_de IS NOT NULL AND slot = 'manual')),
  CONSTRAINT red_fan_rulari_inchiderea CHECK ((stare = 'in_curs') = (incheiata_la IS NULL)),
  CONSTRAINT red_fan_rulari_motiv CHECK ((stare IN ('oprita_plafon', 'oprita_eroare', 'expirata')) = (eroare_cod IS NOT NULL))
);
COMMENT ON TABLE public.red_fan_rulari IS 'Redări FAN: rulările automate ale urmăririi AWB-urilor (cron dimineața / seara, ora României, sau owner-ul). Una singură în curs odată; o rulare de cron pe slot; plafonul de solicitări pe rulare. Scris doar prin fn_red_fan_srv_rulare_* și fn_red_fan_srv_urmarire (clasa B, service_role). 20270102a.';
-- o singură rulare în curs (orice sursă) și o singură rulare de cron pe (zi, slot): suprapunerea = „ocupat”, nimic cerut curierului
CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari (stare) WHERE stare = 'in_curs';
CREATE UNIQUE INDEX red_fan_rulari_slot_uq ON public.red_fan_rulari (zi_ro, slot) WHERE slot <> 'manual';
ALTER TABLE public.red_fan_rulari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_rulari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_fan_rulari TO authenticated;
CREATE POLICY red_fan_rulari_citire ON public.red_fan_rulari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

-- ═══ 2. Clasa B — rularea automată (EXECUTE EXCLUSIV service_role; un JWT de om = 42501) ═══
-- Revendicarea: lock (advisory pe cheia fixă a rulărilor, L01) → rularea în curs de peste 15 minute se închide „expirata” (limita de execuție a
-- funcției edge e mult mai mică) → una în curs = „ocupat” → slotul de cron deja rulat azi = „ocupat” → rularea manuală: cel mult 4 pe zi → INSERT.
CREATE FUNCTION public.fn_red_fan_srv_rulare_incepe(p_sursa text, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_now timestamptz := clock_timestamp(); v_ro timestamp; v_zi date; v_slot text; v_id uuid; v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_sursa IS NULL OR p_sursa NOT IN ('cron', 'owner') OR (p_sursa = 'cron') <> (p_actor IS NULL) THEN
    RAISE EXCEPTION 'redari fan: pornire invalida (cron fara actor, owner cu actor)' USING ERRCODE = '22023'; END IF;
  IF p_sursa = 'owner' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'redari fan: rularea manuala o porneste doar owner-ul' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('redari_fan_rulari', 0));
  UPDATE public.red_fan_rulari SET stare = 'expirata', incheiata_la = v_now, eroare_cod = 'lease_expirat'
   WHERE stare = 'in_curs' AND pornita_la < v_now - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE stare = 'in_curs') THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'rulare_in_curs'); END IF;
  v_ro := v_now AT TIME ZONE 'Europe/Bucharest';
  v_zi := v_ro::date;
  IF p_sursa = 'cron' THEN
    v_slot := CASE WHEN extract(hour FROM v_ro) < 13 THEN 'dimineata' ELSE 'seara' END;
    IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE zi_ro = v_zi AND slot = v_slot) THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'slot_rulat'); END IF;
  ELSE
    v_slot := 'manual';
    SELECT count(*) INTO v_n FROM public.red_fan_rulari WHERE zi_ro = v_zi AND slot = 'manual';
    IF v_n >= 4 THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'plafon_manual_zi'); END IF;
  END IF;
  INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, pornita_de, pornita_la, plafon_apeluri)
  VALUES (v_zi, v_slot, p_sursa, p_actor, v_now, 20) RETURNING id INTO v_id;
  RETURN jsonb_build_object('rulare_id', v_id, 'zi_ro', v_zi, 'slot', v_slot, 'plafon_apeluri', 20);
END $fn$;

-- Pasul durabil ÎNAINTEA fiecărui GET către curier: contorul rulării, CAS (rularea în curs, neexpirată, sub plafon). Plafon atins = RD040;
-- rularea închisă / expirată / inexistentă = RD041. Nimic altceva scris.
CREATE FUNCTION public.fn_red_fan_srv_rulare_apel(p_rulare uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_rulare IS NULL THEN RAISE EXCEPTION 'redari fan: rularea lipseste' USING ERRCODE = '22023'; END IF;
  UPDATE public.red_fan_rulari SET apeluri = apeluri + 1
   WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes' AND apeluri < plafon_apeluri
  RETURNING apeluri INTO v_n;
  IF v_n IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes') THEN
      RAISE EXCEPTION 'redari fan: plafonul de solicitari al rularii e atins' USING ERRCODE = 'RD040';
    END IF;
    RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041';
  END IF;
  RETURN v_n;
END $fn$;

-- Ce e de urmărit (o singură definiție, L19): rândurile generat / ridicat cu AWB, încă nelivrate și fără retur cunoscut, generate în ultimele
-- 60 de zile, pe loturile permise de garda „doar TEST” (fn_red_fan_lot_permis, ca pe orice cale cu efect); cele mai vechi urmărite primele
-- (urmarit_la NULLS FIRST, id), cel mult plafon × 100 de rânduri; grupate pe lot, cu codul proiectului și marcajul TEST (garda din cod).
CREATE FUNCTION public.fn_red_fan_srv_de_urmarit(p_rulare uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plafon integer; v_lim integer; v_loturi jsonb; v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  SELECT plafon_apeluri INTO v_plafon FROM public.red_fan_rulari
   WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes';
  IF v_plafon IS NULL THEN RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041'; END IF;
  v_lim := v_plafon * 100;
  WITH ales AS (
    SELECT a.id, a.lot_id, a.awb, a.stare, a.versiune_urmarire, a.urmarit_la
      FROM public.red_fan_awb a
     WHERE a.stare IN ('generat', 'ridicat') AND a.awb IS NOT NULL
       AND a.livrat_la IS NULL AND NOT a.retur_cunoscut AND a.urmarire_stare <> 'livrat'
       AND a.generat_la >= clock_timestamp() - interval '60 days'
       AND public.fn_red_fan_lot_permis(a.lot_id)
     ORDER BY a.urmarit_la ASC NULLS FIRST, a.id
     LIMIT v_lim
  ), pe_lot AS (
    SELECT x.lot_id, count(*)::integer AS n, min(coalesce(x.urmarit_la, '-infinity'::timestamptz)) AS primul, min(x.id::text) AS primul_id,
           jsonb_agg(jsonb_build_object('id', x.id, 'awb', x.awb, 'stare', x.stare, 'versiune_urmarire', x.versiune_urmarire)
                     ORDER BY x.urmarit_la ASC NULLS FIRST, x.id) AS randuri
      FROM ales x GROUP BY x.lot_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('lot_id', l.lot_id, 'proiect_cod', pr.cod, 'test', coalesce(fl.test, false), 'randuri', l.randuri)
                            ORDER BY l.primul, l.primul_id), '[]'::jsonb),
         coalesce(sum(l.n), 0)::integer
    INTO v_loturi, v_n
    FROM pe_lot l
    JOIN public.red_loturi_plicuire lp ON lp.id = l.lot_id
    JOIN public.red_proiecte pr ON pr.id = lp.proiect_id
    LEFT JOIN public.red_fan_loturi fl ON fl.lot_id = l.lot_id;
  RETURN jsonb_build_object('loturi', v_loturi, 'randuri', v_n, 'limita', v_lim);
END $fn$;

-- Închiderea rulării (o dată; a doua oară = starea ei, fără scriere): numerele de urmărire le-a adunat BD-ul (fn_red_fan_srv_urmarire), nu
-- funcția edge; loturile raportate de edge se păstrează doar ca diagnostic. Lock: 12 rândul rulării → 11 red_jurnal (INSERT, ultimul).
CREATE FUNCTION public.fn_red_fan_srv_rulare_incheie(p_rulare uuid, p_stare text, p_eroare_cod text, p_loturi integer, p_loturi_sarite integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r public.red_fan_rulari; v_deja boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_rulare IS NULL OR p_stare IS NULL OR p_stare NOT IN ('incheiata', 'oprita_plafon', 'oprita_eroare') OR (p_stare = 'incheiata') <> (p_eroare_cod IS NULL)
     OR (p_eroare_cod IS NOT NULL AND p_eroare_cod !~ '^[a-z0-9_]{1,60}$') OR coalesce(p_loturi, 0) < 0 OR coalesce(p_loturi_sarite, 0) < 0 THEN
    RAISE EXCEPTION 'redari fan: inchidere de rulare invalida' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_r FROM public.red_fan_rulari WHERE id = p_rulare FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'redari fan: rulare inexistenta' USING ERRCODE = 'P0002'; END IF;
  IF v_r.stare <> 'in_curs' THEN
    v_deja := true;
  ELSE
    UPDATE public.red_fan_rulari SET stare = p_stare, incheiata_la = clock_timestamp(), eroare_cod = p_eroare_cod, loturi = p_loturi, loturi_sarite = p_loturi_sarite
     WHERE id = p_rulare RETURNING * INTO v_r;
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_rulari', v_r.id, 'update', jsonb_build_object('eveniment', 'urmarire_auto', 'sursa', v_r.sursa, 'slot', v_r.slot, 'zi_ro', v_r.zi_ro,
              'stare', v_r.stare, 'eroare_cod', v_r.eroare_cod, 'apeluri', v_r.apeluri, 'randuri', v_r.randuri, 'scrise', v_r.scrise, 'pastrate', v_r.pastrate,
              'depasite', v_r.depasite, 'loturi', v_r.loturi, 'loturi_sarite', v_r.loturi_sarite, 'pornita_la', v_r.pornita_la, 'la', v_r.incheiata_la), v_r.pornita_de);
  END IF;
  RETURN jsonb_build_object('rulare_id', v_r.id, 'stare', v_r.stare, 'eroare_cod', v_r.eroare_cod, 'apeluri', v_r.apeluri, 'randuri', v_r.randuri,
    'scrise', v_r.scrise, 'pastrate', v_r.pastrate, 'depasite', v_r.depasite, 'deja_inchisa', v_deja);
END $fn$;

-- fn_red_fan_srv_urmarire: p_rulare prinde viață (rezervat din 20261228a). Exact unul dintre p_actor / p_rulare: p_actor = omul verificat din JWT
-- (F1, neschimbat: poarta operator / owner activ); p_rulare = rularea automată în curs, neexpirată (fără om: auth.uid() NULL, p_actor NULL).
-- Ambele căi scriu prin ACELAȘI corp fn_red_fan_urmarire_intern (L19). Cu p_rulare, numerele se adună în rândul rulării DUPĂ scriere; rularea
-- închisă între timp = RD041 și TOTUL se anulează (nici urmărirea nu rămâne scrisă). Lock: 3 red_fan_awb (în corpul comun) → 12 rândul rulării.
CREATE OR REPLACE FUNCTION public.fn_red_fan_srv_urmarire(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r jsonb;
BEGIN
  IF p_rulare IS NULL THEN
    PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
    RETURN public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
  END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_actor IS NOT NULL THEN RAISE EXCEPTION 'redari fan: exact unul dintre actor si rulare' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes') THEN
    RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041'; END IF;
  v_r := public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
  UPDATE public.red_fan_rulari SET randuri = randuri + jsonb_array_length(p_randuri), scrise = scrise + (v_r ->> 'scrise')::integer,
         pastrate = pastrate + (v_r ->> 'pastrate')::integer, depasite = depasite + (v_r ->> 'depasite')::integer
   WHERE id = p_rulare AND stare = 'in_curs';
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: rularea s-a inchis in timpul scrierii' USING ERRCODE = 'RD041'; END IF;
  RETURN v_r;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_red_fan_srv_rulare_incepe(text, uuid), public.fn_red_fan_srv_rulare_apel(uuid), public.fn_red_fan_srv_de_urmarit(uuid),
  public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_srv_rulare_incepe(text, uuid), public.fn_red_fan_srv_rulare_apel(uuid), public.fn_red_fan_srv_de_urmarit(uuid),
  public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer) TO service_role;

-- ═══ 3. Postcondiții ═══
DO $post$
DECLARE r record; v_rau text; v_n integer;
BEGIN
  -- tabelul nou: RLS activ (fără FORCE), proprietar postgres, exact politica de citire; drepturi: DOAR SELECT pentru authenticated (service_role nimic)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.red_fan_rulari'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = 'postgres')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.red_fan_rulari'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.red_fan_rulari'::regclass AND pol.polname = 'red_fan_rulari_citire' AND pol.polcmd = 'r'
                      AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) = '((auth.uid() IS NOT NULL) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))') THEN
    RAISE EXCEPTION '20270102a post: RLS / politica pe red_fan_rulari';
  END IF;
  SELECT string_agg(y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, 'public.red_fan_rulari'::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol = 'authenticated');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.red_fan_rulari'::regclass AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_fan_rulari'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20270102a post: drepturi pe red_fan_rulari (%)', coalesce(v_rau, 'PUBLIC / coloane');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_fan_rulari'::regclass AND NOT tgisinternal)
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_rulari_in_curs_uq')
        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari USING btree (stare) WHERE (stare = ''in_curs''::text)'
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_rulari_slot_uq')
        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_rulari_slot_uq ON public.red_fan_rulari USING btree (zi_ro, slot) WHERE (slot <> ''manual''::text)' THEN
    RAISE EXCEPTION '20270102a post: trigger-e sau indexurile unice pe red_fan_rulari';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('red_fan_rulari_apeluri_plafon'), ('red_fan_rulari_suma'), ('red_fan_rulari_pornire'), ('red_fan_rulari_inchiderea'), ('red_fan_rulari_motiv')) v(c) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_rulari'::regclass AND conname = r.c AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION '20270102a post: CHECK-ul % lipseste', r.c; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.red_fan_rulari) THEN RAISE EXCEPTION '20270102a post: red_fan_rulari are randuri'; END IF;
  -- funcțiile: exact 56 fn_red_fan_* (52 ale bazei, dintre care 1 înlocuită, + 4 noi), fiecare cu corpul (AMPRENTE-NOI), limbajul, DEFINER, volatilitatea, tipul întors, proprietarul și EXECUTE EXACT pe clasă
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20270102a (semnătura, md5(replace(prosrc, chr(13), '')), limbaj, DEFINER, volatilitate, tipul întors, EXECUTE authenticated, EXECUTE service_role)
      ('public.fn_red_fan_anulare_cere(uuid,text,text,text)', 'ca53da3cbf13b5dc8edb2e24ddfe2f85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_anulat(uuid,text,text)', '6af4ea9ab74f812a29a82ee076550ff2', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'f19e630e2e105cab2f0d65f18dcf47d8', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_awb_garda()', '7e8e1302f342d268bcd4a8c9906bce4f', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', false, false),
      ('public.fn_red_fan_cerere_decide(uuid,boolean,text)', '7515320fedb0b29fa2c23bc9d685966f', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_cerere_retrage(uuid)', '1825378bc3b3ae1f799186cd53e8c409', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_claim_intern(uuid,uuid[],text[],text[],uuid,uuid,boolean)', 'c36df6081bb2e28766f0d5e6e31def02', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'bb7fe9239528916d08e5e9a905fe587f', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', '437ae4f2662ea5626aa0dff220fdfa3c', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', 'da2e4ec6ab90886ffcf40a7dbc5562ca', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari_intern(uuid,jsonb)', 'f34677deebaf08abb03deec737e9db05', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_e_operator()', 'e1c0af5d6997c9c751929bcf652edc10', 'sql', true, 's', 'boolean', true, false),
      ('public.fn_red_fan_e_operator_profil(uuid)', 'c3ebc7662c7a99cf9122c7d0b0905671', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_intentie_incheie_intern(uuid,text,jsonb)', 'ac018ee8fe12ca3e8fe087a08c42ebf3', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_intentie_sumar(uuid)', '706c9c1fb43ee56f2ef030f7e226c62d', 'sql', true, 's', 'jsonb', false, false),
      ('public.fn_red_fan_lot_incheiat(uuid)', 'a788cd02f2ccbbf5fc6b1b5515790c58', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '49a056c348411ba320061c4da1ab3c25', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_lot_permis(uuid)', '74a3a78930b42f6100c2d76917461475', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_permis_valori(boolean,text,boolean)', '1b1110d5bb4934075e626e23a49e8d79', 'sql', false, 'i', 'boolean', false, false),
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', false, false),
      ('public.fn_red_fan_operator_seteaza(uuid,boolean,text)', '2312ff35d3b98c5a0fb41a4d385166de', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_propune(uuid,text,numeric)', '98ed533dba82a221c3e874aee2af62d5', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '95d5b20b47d04dd11ba230017d8fde85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_reconciliaza_intern(uuid,text,numeric,numeric,text,uuid,boolean)', '64afc6f76bcd26692ad694f8297d6334', 'plpgsql', true, 'v', 'text', false, false),
      ('public.fn_red_fan_retrage(uuid,text)', '1c786f1641f82f0287f2e8ee943465e9', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'f2a5a8d722a06dc34e5060321be15e12', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_rezultate_intern(uuid,jsonb,integer,uuid,uuid)', 'c46607410f5b6c8cdcb6710d0f9f2982', 'plpgsql', true, 'v', 'integer', false, false),
      ('public.fn_red_fan_ridicat(uuid,date)', '99fc55589bdf77c775d7ae1046edd537', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_setari_doar_test(boolean)', '5ca6a20b3ff16f37ee0fb497194a6c83', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_limita_zi(integer)', 'e6b5c61362b113c681298a8a66c0e2ca', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_setari_presupunere_429(boolean,text)', 'd7aa9ac982db4139f048452b7e71ff9f', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_srv_anuleaza(uuid,uuid,text,text)', '08958a14896e5b07c0892567f012c90d', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_claim(uuid,uuid,uuid,uuid[],text[],text[])', 'b8625e36c2dfec0a549287391b83374e', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_confirmari(uuid,uuid,uuid,jsonb)', 'a142ed8f327967633ed3b1e1bc334e87', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_de_urmarit(uuid)', 'a2544c9bed724e4a26e40e77b8ac25ae', 'plpgsql', true, 's', 'jsonb', false, true),
      ('public.fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', '1017ae767ed3d8f947a18f8d3b9c2c6d', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_poarta(uuid,boolean)', 'eae0c2fa2fc3ec18b44ce55b60a96848', 'plpgsql', true, 's', 'void', false, false),
      ('public.fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', '38e16206cef4468c73e2cf103b163127', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', '216688178ad5d77bb059054a96a31a7a', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_rulare_apel(uuid)', 'ca597a7446e9b9bd1a1d3c4029f13c43', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_rulare_incepe(text,uuid)', '2b1f1bf31f225284a2d9f4ca613933c8', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_rulare_incheie(uuid,text,text,integer,integer)', 'd2fb7ab776c99003b1ff8ee2c62a3546', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', 'df871dc075ad55c6bda19d675f3f4cf9', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false, false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false, false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '36cafe6b98cf2436e5ffb42370139765', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '966a88fd8c20655714cf7a72dc25e748', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '40109588fdeb59c56784ab4b7ff616be', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_zi_garda()', '5c51181772f185ac5559913dd32918ec', 'plpgsql', true, 'v', 'trigger', false, false)
      -- <<< AMPRENTE-NOI 20270102a
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, exec_auth, exec_srv)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_srv
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270102a post: functiile (corp / proprietati / EXECUTE) difera: %', v_rau; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%';
  IF v_n <> 56 THEN RAISE EXCEPTION '20270102a post: numarul functiilor fn_red_fan_* este %, asteptat 56', v_n; END IF;
  -- porțile 0e / Izometrie E2 (ca 20261228a runda 4): marcajul gărzii rândului FAN scris DOAR de cele 7 funcții ale listelor trigger-ului; niciun corp
  -- fn_red_fan_* nu cheamă funcția de configurare, nu numește calea de căutare și nu are SQL dinamic
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
         AND (p.prosrc ~* 'set\s+(local\s+|session\s+)?redari_fan\.garda' OR p.prosrc ~* 'set_config\s*\(\s*''redari_fan\.garda'))
     IS DISTINCT FROM ARRAY['fn_red_fan_anulare_cere', 'fn_red_fan_anulat', 'fn_red_fan_cerere_decide', 'fn_red_fan_claim_intern', 'fn_red_fan_comanda',
                            'fn_red_fan_retrage', 'fn_red_fan_srv_anuleaza']::text[]
     OR EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE c ILIKE 'redari_fan.garda=%') THEN
    RAISE EXCEPTION '20270102a post: marcajul redari_fan.garda e scris de alte functii decat cele 7 de pe listele trigger-ului (sau apare in proconfig)';
  END IF;
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%'
     AND (p.prosrc ~* '(set_config|search_path)' OR p.prosrc ~* '\mexecute\M');
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20270102a post: corpuri fn_red_fan_* prinse de portile 0e / Izometrie E2 (configurare, cale de cautare sau SQL dinamic): %', v_rau;
  END IF;
  -- trigger-ele de pe red_fan_awb: neschimbate (exact cele două)
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '20270102a post: trigger-ele de pe red_fan_awb s-au schimbat';
  END IF;
  -- nimic scris în red_jurnal de această migrare
  IF EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.xmin::text = (txid_current() % 4294967296)::text) THEN
    RAISE EXCEPTION '20270102a post: migrarea a scris in red_jurnal';
  END IF;
  RAISE NOTICE '20270102a: sfarsit la % ms de la BEGIN (fara lock-uri pe tabelele existente)', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;

-- L15: lanțul verificat și DUPĂ pentru poarta de drept neschimbată (fn_red_nivel); garda finală; funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_nivel()') AND md5(replace(p.prosrc, chr(13), '')) = '21db8e5d4b69b7f19e571a7087c361ae'
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270102a: poarta de drept (dupa) difera de amprenta revizuita';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20270102a: garda final invalida';
  END IF;
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20270102a();
