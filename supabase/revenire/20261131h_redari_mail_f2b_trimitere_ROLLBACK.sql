-- Revenire 20261131h_redari_mail_f2b_trimitere. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce starea de dinainte de 20261131h:
--   * fn_red_mail_f2_poate, fn_red_mail_f2_setari, fn_red_mail_rezerva, fn_red_mail_apel_incepe = corpurile EXACTE din 20261131a (amprentele
--     d239c6cc… / 88b2a3f1… / a5bf83c9… / b3834ab1…), aceleași proprietăți și ACELAȘI ACL (CREATE OR REPLACE nu schimbă drepturile; postcondiția le
--     compară cu cele de dinainte de revenire);
--   * trg_red_proiect_cod_test scos; fn_red_proiect_cod_test_garda, fn_red_proiect_e_test, fn_red_mail_oauth_start / _consuma / _eveniment,
--     fn_red_mail_secret_seteaza / _citeste scoase;
--   * red_mail_setari: constrângerile red_mail_f2b_* scoase, coloanele doar_proiecte_test / trimitere_conectata_la / _de / trimitere_casuta
--     scoase, CHECK-ul inert red_mail_f2_inert_ck (OFF și extern = false) repus;
--   * red_mail_oauth_state: CHECK-ul scopului fără `trimitere`.
-- CONTRACTUL L14 (textual, runda 2 — Jakarinos #1134): revenirea REFUZĂ la ORICE istoric nou produs după aplicare, nu doar la starea „în folosință”:
--   trimiterea pornită / căsuța conectată; ORICE state `trimitere` (activ, consumat sau expirat); ORICE eveniment oauth_conectat / oauth_revocat cu
--   cod `trimitere` sau oauth_respins (jurnalul OAuth al trimiterii e append-only); rândul REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN în Vault (cu sau fără
--   valoare: rândul apare doar prin fn_red_mail_secret_seteaza); mesaje / jurnal F2 în stări de transport (rezervat, in_apel, trimis, esuat_sigur,
--   necunoscut, esuat_confirmat; rezervat_la pus). Nimic nu se șterge din istoric. Deci revenirea e posibilă DOAR pe o bază pe care trimiterea n-a fost
--   folosită deloc (de ex. aplicată și abandonată înaintea primei conectări); după prima conectare, întoarcerea = migrare nouă, revizuită (înainte),
--   nu revenire. Migrarea garantează în $pre$ că la aplicare acest istoric nu exista (altfel refuză), ca testul de aici să fie neechivoc.
-- Starea EXACTĂ a migrării e verificată de două ori (înainte și după lock): corpuri + proprietăți + ACL, trigger, constrângeri, coloane. Altă stare = refuz.
--
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261131h_redari_mail_f2b_trimitere_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261131180001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (L06): red_mail_setari → red_mail_oauth_state → red_proiecte (SHARE ROW EXCLUSIVE: DROP TRIGGER cere lock pe tabel; după setări, ca în
--   RPC-urile de trimitere), toate NOWAIT, bugetul 1 s de la prima încercare.
-- Probe: scripts/pglite/test_redari_mail_f2b_local.mjs (aplicare -> revenire -> reaplicare pe bază nefolosită; refuzurile revenirii, inclusiv istoricul).
DO $pre$
DECLARE v_plafon text; v_incercari integer := 0; v_t0 timestamptz; v_buget constant interval := interval '1 second'; v_pas integer; v_def text; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131h_redari_mail_f2b_trimitere_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261131h revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131h revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131h revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131h revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261131h revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      v_t0 := clock_timestamp();
      LOOP
        IF clock_timestamp() >= v_t0 + v_buget THEN
          RAISE EXCEPTION '20261131h revenire: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_mail_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_mail_oauth_state IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= v_t0 + v_buget THEN
        RAISE EXCEPTION '20261131h revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
      RAISE NOTICE '20261131h revenire: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
    END IF;
    -- funcțiile: EXACT cele din 20261131h (amprentele AMPRENTE-NOI 20261131h din migrare) + proprietățile + ACL-urile celor noi
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        -- >>> AMPRENTE-NOI 20261131h
        ('public.fn_red_mail_f2_poate(public.red_mail_loturi)', '01d3390b765bedc9fd64801f113109c9', 'plpgsql', false, 's', 'text'),
        ('public.fn_red_mail_f2_setari(boolean,boolean,integer)', '06f8a334c57a61109aa2086870712ace', 'plpgsql', true, 'v', 'boolean'),
        ('public.fn_red_mail_rezerva(uuid)', 'd779e03d0644e437db412b0c3721e6c0', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
        ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9e8dbac708ee9512cd402a960d1d446a', 'plpgsql', true, 'v', 'boolean'),
        ('public.fn_red_proiect_e_test(text)', 'b3a152708e032c698980981ab0eb3cf9', 'sql', false, 'i', 'boolean'),
        ('public.fn_red_proiect_cod_test_garda()', '5754b1afd6385c9a2c96a5330be85bb5', 'plpgsql', true, 'v', 'trigger'),
        ('public.fn_red_mail_oauth_start(text,text)', '3c99764f8b3ae99b845301477387dd31', 'plpgsql', true, 'v', 'uuid'),
        ('public.fn_red_mail_oauth_consuma(text)', '376c86dba339df3453368f1964359452', 'plpgsql', true, 'v', 'text'),
        ('public.fn_red_mail_oauth_eveniment(text,text)', 'c7c0629bcde5687075f531278987c374', 'plpgsql', true, 'v', 'void'),
        ('public.fn_red_mail_secret_seteaza(text,text,uuid,text)', '0044821f5c4f4b33fbef1ecfc7d27e54', 'plpgsql', true, 'v', 'boolean'),
        ('public.fn_red_mail_secret_citeste(text,uuid,text)', '48306df63e0ef6383a610563687e8271', 'plpgsql', true, 'v', 'text')
        -- <<< AMPRENTE-NOI 20261131h
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
    -- (to_regprocedure, nu ::regprocedure: pe o bază fără migrare refuzul trebuie să fie al gărzii, nu o eroare de cast)
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_red_mail_oauth_start(text,text)'), to_regprocedure('public.fn_red_mail_oauth_consuma(text)'), to_regprocedure('public.fn_red_mail_oauth_eveniment(text,text)'))
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}')
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_red_mail_secret_seteaza(text,text,uuid,text)'), to_regprocedure('public.fn_red_mail_secret_citeste(text,uuid,text)'))
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_red_proiect_e_test(text)'), to_regprocedure('public.fn_red_proiect_cod_test_garda()'))
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}')
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('fn_red_mail_f2_poate', 'fn_red_mail_f2_setari', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe', 'fn_red_proiect_e_test', 'fn_red_proiect_cod_test_garda',
                               'fn_red_mail_oauth_start', 'fn_red_mail_oauth_consuma', 'fn_red_mail_oauth_eveniment', 'fn_red_mail_secret_seteaza', 'fn_red_mail_secret_citeste')) <> 11 THEN
      RAISE EXCEPTION '20261131h revenire: starea nu e cea din 20261131h (pasul %, functii: %)', v_pas, coalesce(v_rau, 'drepturi / variante');
    END IF;
    -- triggerul: exact cel pus de 20261131h
    IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.red_proiecte') AND t.tgname = 'trg_red_proiect_cod_test' AND NOT t.tgisinternal
          AND t.tgfoid = to_regprocedure('public.fn_red_proiect_cod_test_garda()') AND t.tgenabled = 'O' AND t.tgtype = 19 AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1 THEN
      RAISE EXCEPTION '20261131h revenire: starea nu e cea din 20261131h (pasul %, trigger trg_red_proiect_cod_test)', v_pas;
    END IF;
    -- constrângerile și coloanele: exact cele din 20261131h
    SELECT string_agg(c.conname, ', ' ORDER BY c.conname) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_setari'::regclass AND c.conname LIKE 'red_mail_f2%';
    IF v_def IS DISTINCT FROM 'red_mail_f2b_conectare_ck, red_mail_f2b_doar_test_ck, red_mail_f2b_extern_ck, red_mail_f2b_pornire_ck'
       OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.red_mail_setari'::regclass AND NOT a.attisdropped
             AND a.attname IN ('doar_proiecte_test', 'trimitere_conectata_la', 'trimitere_conectata_de', 'trimitere_casuta')) <> 4
       OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_oauth_state'::regclass AND c.conname = 'red_mail_oauth_state_scop_ck')
          IS DISTINCT FROM 'CHECK ((scop = ANY (ARRAY[''citire''::text, ''citire_test''::text, ''golire''::text, ''golire_test''::text, ''trimitere''::text])))' THEN
      RAISE EXCEPTION '20261131h revenire: starea nu e cea din 20261131h (pasul %, constrangeri / coloane: %)', v_pas, coalesce(v_def, 'lipsa');
    END IF;
    -- L14: refuz pe stare „în folosință” SAU pe ORICE istoric produs după aplicare (nimic nu se șterge)
    IF EXISTS (SELECT 1 FROM public.red_mail_setari WHERE id = 1 AND (trimitere_oprita IS NOT TRUE OR trimitere_conectata_la IS NOT NULL OR trimitere_casuta IS NOT NULL OR trimitere_conectata_de IS NOT NULL)) THEN
      RAISE EXCEPTION '20261131h revenire: trimiterea e pornita / casuta conectata — opreste si revoca intai (pasul %)', v_pas;
    END IF;
    IF EXISTS (SELECT 1 FROM public.red_mail_oauth_state WHERE scop = 'trimitere')
       OR EXISTS (SELECT 1 FROM public.red_mail_evenimente e WHERE (e.tip IN ('oauth_conectat', 'oauth_revocat') AND e.cod = 'trimitere') OR e.tip = 'oauth_respins')
       OR EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN')
       OR EXISTS (SELECT 1 FROM public.red_mail_jurnal_f2 j WHERE j.cod IN ('rezervat', 'apel_inceput', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat'))
       OR EXISTS (SELECT 1 FROM public.red_mail_mesaje m WHERE m.stare IN ('rezervat', 'in_apel', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat') OR m.rezervat_la IS NOT NULL) THEN
      RAISE EXCEPTION '20261131h revenire: ISTORIC_NOU (L14): trimiterea / conectarea au fost folosite dupa aplicare (state, evenimente oauth, rand Vault, mesaje sau jurnal F2 de transport) — nimic sters; intoarcerea = migrare noua, revizuita (pasul %)', v_pas;
    END IF;
  END LOOP;
END $pre$;

-- drepturile EXACTE ale celor patru funcții repuse, ÎNAINTE (postcondiția: aceleași după CREATE OR REPLACE)
CREATE TEMP TABLE red_acl_20261131h_rev ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_f2_setari(boolean,boolean,integer)'::regprocedure, 'public.fn_red_mail_f2_poate(public.red_mail_loturi)'::regprocedure,
                                   'public.fn_red_mail_rezerva(uuid)'::regprocedure, 'public.fn_red_mail_apel_incepe(uuid,uuid)'::regprocedure);

-- ─── 1. triggerul și RPC-urile / funcțiile noi scoase ─────────────────────────────────────────────────────────────────────────
DROP TRIGGER trg_red_proiect_cod_test ON public.red_proiecte;
DROP FUNCTION public.fn_red_proiect_cod_test_garda();
DROP FUNCTION public.fn_red_mail_oauth_start(text,text);
DROP FUNCTION public.fn_red_mail_oauth_consuma(text);
DROP FUNCTION public.fn_red_mail_oauth_eveniment(text,text);
DROP FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text);
DROP FUNCTION public.fn_red_mail_secret_citeste(text,uuid,text);

-- ─── 2. Corpurile EXACTE din 20261131a ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(l public.red_mail_loturi) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND trimitere_oprita IS FALSE AND (pauza_pana IS NULL OR pauza_pana<=now())) THEN RETURN 'trimitere_oprita'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_informare_publicata(cod) IS TRUE) THEN RETURN 'informare_nepublicata'; END IF;
 IF l.stare NOT IN ('aprobat','in_trimitere') OR l.aprobat_de IS NULL THEN RETURN 'lot_neaprobat'; END IF;
 IF l.aprobat_la IS NULL OR l.aprobat_la+interval '7 days'<=now() THEN RETURN 'aprobare_expirata'; END IF;
 IF public.fn_red_mail_f2_lot_hash(l.id) IS DISTINCT FROM l.lot_sha256 OR l.lot_sha256 IS DISTINCT FROM l.aprobat_lot_sha256 THEN RETURN 'lot_integritate'; END IF;
 RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_poate(public.red_mail_loturi) IS NULL;
-- fn_red_proiect_e_test se scoate DUPĂ ce fn_red_mail_f2_poate nu o mai cheamă (corpurile plpgsql nu țin dependență în catalog, dar ordinea e cea logică)
DROP FUNCTION public.fn_red_proiect_e_test(text);
CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_setari(p_oprit boolean,p_extern boolean,p_versiune integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 IF p_oprit IS NULL OR p_extern IS NULL THEN RAISE EXCEPTION 'setari_invalide'; END IF;
 -- OFF nu depinde de cotă sau de versiunea dintr-un ecran vechi.
 IF NOT p_oprit AND s.versiune IS DISTINCT FROM p_versiune THEN RAISE EXCEPTION 'versiune_veche'; END IF;
 -- Decizia de livrare: pornirea nu este expusă până la integrarea OAuth + SENT + probe.
 IF NOT p_oprit OR p_extern THEN RAISE EXCEPTION 'activare_amanata'; END IF;
 UPDATE public.red_mail_setari SET trimitere_oprita=true,extern_permis=false WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(NULL,NULL,'setari'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_setari(boolean,boolean,integer) IS NULL;
CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; s public.red_mail_setari; cod text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje ORDER BY id. Setările serializează și cotele globale.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 -- Reconcilierea locală a lease-urilor nu reia un send ambiguu.
 PERFORM 1 FROM public.red_mail_mesaje WHERE lot_id=l.id ORDER BY id FOR UPDATE;
 UPDATE public.red_mail_mesaje SET stare='necunoscut',eroare_cod='lease_expirat' WHERE lot_id=l.id AND stare='in_apel' AND lease_pana<=now();
 UPDATE public.red_mail_mesaje SET stare=CASE WHEN l.stare IN ('incheiat','blocat_integritate') THEN 'anulat' ELSE 'in_coada' END,rezervat_la=NULL,lease_token=NULL,lease_pana=NULL WHERE lot_id=l.id AND stare='rezervat' AND lease_pana<=now();
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,NULL,cod); END IF;
 IF cod='aprobare_expirata' THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod=cod WHERE lot_id=l.id AND stare='in_coada'; END IF;
 IF cod IS NOT NULL THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE stare IN ('rezervat','in_apel','necunoscut'))>=50 THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND (rezervat_la AT TIME ZONE 'Europe/Bucharest')::date=(now() AT TIME ZONE 'Europe/Bucharest')::date)>=s.plafon_zi OR (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND date_trunc('month',rezervat_la AT TIME ZONE 'Europe/Bucharest')=date_trunc('month',now() AT TIME ZONE 'Europe/Bucharest'))>=s.plafon_luna THEN RETURN; END IF;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare='in_coada' ORDER BY id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; RETURN; END IF;
 IF NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro' THEN RETURN; END IF;
 IF l.stare='aprobat' THEN UPDATE public.red_mail_loturi SET stare='in_trimitere',versiune=versiune+1 WHERE id=l.id; END IF;
 UPDATE public.red_mail_mesaje SET stare='rezervat',lease_token=gen_random_uuid(),lease_pana=now()+interval '2 minutes',rezervat_la=now(),rezervare_nr=rezervare_nr+1 WHERE id=m.id RETURNING * INTO m;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'rezervat'); RETURN NEXT m;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_rezerva(uuid) IS NULL;
CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(p_mesaj uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; cod text; s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaj; primul SELECT al id-ului nu blochează.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.stare<>'rezervat' OR m.lease_token IS DISTINCT FROM p_token OR m.lease_pana<=now() THEN RETURN false; END IF;
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,cod); END IF;
 IF cod IS NOT NULL OR (NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro') OR EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) OR s.ultim_apel_la>now()-interval '2 seconds' THEN RETURN false; END IF;
 UPDATE public.red_mail_mesaje SET stare='in_apel',apel_inceput_la=now() WHERE id=m.id;
 UPDATE public.red_mail_setari SET ultim_apel_la=now() WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'apel_inceput'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_apel_incepe(uuid,uuid) IS NULL;

-- ─── 3. red_mail_setari / red_mail_oauth_state înapoi la 20261131a / 20261130j (fără ștergeri: L14 a refuzat deja orice istoric) ─────────────
ALTER TABLE public.red_mail_setari
  DROP CONSTRAINT red_mail_f2b_extern_ck, DROP CONSTRAINT red_mail_f2b_doar_test_ck, DROP CONSTRAINT red_mail_f2b_conectare_ck, DROP CONSTRAINT red_mail_f2b_pornire_ck,
  DROP COLUMN doar_proiecte_test, DROP COLUMN trimitere_conectata_la, DROP COLUMN trimitere_conectata_de, DROP COLUMN trimitere_casuta;
ALTER TABLE public.red_mail_setari ADD CONSTRAINT red_mail_f2_inert_ck CHECK (trimitere_oprita IS TRUE AND extern_permis IS FALSE);
ALTER TABLE public.red_mail_oauth_state DROP CONSTRAINT red_mail_oauth_state_scop_ck;
ALTER TABLE public.red_mail_oauth_state ADD CONSTRAINT red_mail_oauth_state_scop_ck CHECK (scop IN ('citire', 'citire_test', 'golire', 'golire_test'));

-- ─── 4. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_def text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_mail_f2_setari(boolean,boolean,integer)', '88b2a3f13a95d346b1fec56736aa89e3', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_f2_poate(public.red_mail_loturi)', 'd239c6cc7bcb13691d798f99d4f1aa58', 'plpgsql', false, 's', 'text'),
      ('public.fn_red_mail_rezerva(uuid)', 'a5bf83c98b41d8665cce7e536eea4343', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', 'b3834ab1c09d2671c0778621f3271255', 'plpgsql', true, 'v', 'boolean')
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131h revenire: postconditie: corpurile 20261131a nu sunt repuse: %', v_rau; END IF;
  IF (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '20261131h revenire: postconditie: fn_red_mail_rezerva nu e SETOF'; END IF;
  IF EXISTS (SELECT 1 FROM red_acl_20261131h_rev a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl) OR (SELECT count(*) FROM red_acl_20261131h_rev) <> 4 THEN
    RAISE EXCEPTION '20261131h revenire: postconditie: drepturile functiilor repuse difera';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_red_mail_oauth_start', 'fn_red_mail_oauth_consuma', 'fn_red_mail_oauth_eveniment', 'fn_red_mail_secret_seteaza', 'fn_red_mail_secret_citeste', 'fn_red_proiect_e_test', 'fn_red_proiect_cod_test_garda'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_proiect_cod_test') THEN
    RAISE EXCEPTION '20261131h revenire: postconditie: functii / trigger ramase';
  END IF;
  SELECT string_agg(c.conname || ' = ' || pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname) INTO v_def
    FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_setari'::regclass AND c.conname LIKE 'red_mail_f2%';
  IF v_def IS DISTINCT FROM 'red_mail_f2_inert_ck = CHECK (((trimitere_oprita IS TRUE) AND (extern_permis IS FALSE)))'
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_mail_setari'::regclass AND NOT a.attisdropped
                  AND a.attname IN ('doar_proiecte_test', 'trimitere_conectata_la', 'trimitere_conectata_de', 'trimitere_casuta'))
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_oauth_state'::regclass AND c.conname = 'red_mail_oauth_state_scop_ck')
        IS DISTINCT FROM 'CHECK ((scop = ANY (ARRAY[''citire''::text, ''citire_test''::text, ''golire''::text, ''golire_test''::text])))'
     OR EXISTS (SELECT 1 FROM public.red_mail_oauth_state WHERE scop = 'trimitere') THEN
    RAISE EXCEPTION '20261131h revenire: postconditie: constrangeri / coloane / state (%)', coalesce(v_def, 'lipsa');
  END IF;
  RAISE NOTICE '20261131h revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
