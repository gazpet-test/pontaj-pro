-- Revenire 20261131i_redari_mail_link_personal. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce starea de dinainte de 20261131i:
--   * fn_red_mail_lot_creeaza, fn_red_mail_destinatari = corpurile EXACTE din 20261131a (amprentele a4363270… / 4db265cc…); fn_red_mail_rezerva,
--     fn_red_mail_apel_incepe = corpurile EXACTE din 20261131h (d779e03d… / 9e8dbac7…), aceleași proprietăți și ACELAȘI ACL (CREATE OR REPLACE nu schimbă
--     drepturile; postcondiția le compară cu cele de dinainte de revenire);
--   * fn_red_link_raspuns, fn_red_mail_f2_token, fn_red_mail_f2_campuri, fn_red_mail_f2_completeaza, fn_red_mail_f2_link_forma (r4), fn_red_mail_f2_link_strain scoase;
--   * red_mail_jurnal_f2: CHECK-ul codului fără `campuri` (lista din 20261131a).
-- CONTRACTUL L14 (textual, tiparul 20261131h): revenirea REFUZĂ la ORICE istoric produs după aplicare: un rând `campuri` în jurnalul F2 (append-only —
--   fiecare lot creat cu câmpuri scrie unul), un eveniment `f2` / `f2_campuri`, un mesaj cu eroare_cod `token_expirat`. Nimic nu se șterge din istoric. Deci
--   revenirea e posibilă DOAR pe o bază pe care niciun lot n-a fost creat cu migrarea aplicată; după primul lot, întoarcerea = migrare nouă, revizuită.
--   Migrarea garantează în $pre$ că la aplicare acest istoric nu exista (altfel refuză), ca testul de aici să fie neechivoc. Loturile vechi (fără câmpuri)
--   rămân valide sub codul vechi (snapshoturile sunt imuabile; hash-urile nu depind de RPC).
-- Starea EXACTĂ a migrării e verificată de două ori (înainte și după lock): corpuri + proprietăți + ACL, CHECK. Altă stare = refuz.
--
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261131i_redari_mail_link_personal_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261131190001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (L06): red_mail_jurnal_f2 ACCESS EXCLUSIVE (ALTER TABLE … CHECK), NOWAIT, bugetul 1 s de la prima încercare.
-- Probe: scripts/pglite/test_redari_mail_link_local.mjs (aplicare -> revenire -> reaplicare pe bază nefolosită; refuzurile revenirii, inclusiv istoricul).
DO $pre$
DECLARE v_plafon text; v_incercari integer := 0; v_t0 timestamptz; v_buget constant interval := interval '1 second'; v_pas integer; v_def text; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131i_redari_mail_link_personal_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261131i revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131i revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131i revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131i revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261131i revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      v_t0 := clock_timestamp();
      LOOP
        IF clock_timestamp() >= v_t0 + v_buget THEN
          RAISE EXCEPTION '20261131i revenire: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= v_t0 + v_buget THEN
        RAISE EXCEPTION '20261131i revenire: BUGET_LOCK: lock-ul obtinut abia la % ms de la prima incercare (% incercari); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
      RAISE NOTICE '20261131i revenire: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
    END IF;
    -- funcțiile: EXACT cele din 20261131i (amprentele AMPRENTE-NOI 20261131i din migrare) + proprietățile + ACL-urile celor noi
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        -- >>> AMPRENTE-NOI 20261131i
        ('public.fn_red_link_raspuns(text)', '6732f7c215cac70f630f08c572a24d65', 'sql', false, 'i', 'text'),
        ('public.fn_red_mail_f2_token(uuid)', '604a8adddf23112c5c0f70c89cff0244', 'sql', false, 's', 'text'),
        ('public.fn_red_mail_f2_campuri(uuid,uuid)', '503dc3c94d4e255ac5e827658b38a0ff', 'plpgsql', true, 's', 'jsonb'),
        ('public.fn_red_mail_f2_completeaza(text,jsonb)', '61331ec6fc15d05e02517825877084d6', 'plpgsql', false, 'i', 'text'),
        ('public.fn_red_mail_f2_link_forma(text)', '2edc6ff0b6dd289c61b2ada16cdba025', 'plpgsql', false, 's', 'record'),
        ('public.fn_red_mail_f2_link_strain(text,text)', 'bc86bcb99b37756246c84e41d4308e05', 'plpgsql', false, 's', 'boolean'),
        ('public.fn_red_mail_destinatari(uuid,uuid,uuid)', 'b1fbfaf746f1e05fd88f9204bfbbea68', 'plpgsql', true, 's', 'record'),
        ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', '4b4bb5c43d83d0a3ea8ee41abecff956', 'plpgsql', true, 'v', 'uuid'),
        ('public.fn_red_mail_rezerva(uuid)', 'dbd0cbf99e8e2e0715441333ad17664c', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
        ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9dc0d38f7ad39238618463e0fa7892b6', 'plpgsql', true, 'v', 'boolean')
        -- <<< AMPRENTE-NOI 20261131i
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
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_mail_f2_campuri(uuid,uuid)')
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}')
       OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_red_link_raspuns(text)'), to_regprocedure('public.fn_red_mail_f2_token(uuid)'), to_regprocedure('public.fn_red_mail_f2_completeaza(text,jsonb)'),
                                                          to_regprocedure('public.fn_red_mail_f2_link_forma(text)'), to_regprocedure('public.fn_red_mail_f2_link_strain(text,text)'))
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}')
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('fn_red_link_raspuns', 'fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza', 'fn_red_mail_f2_link_forma', 'fn_red_mail_f2_link_strain', 'fn_red_mail_destinatari', 'fn_red_mail_lot_creeaza', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe')) <> 10 THEN
      RAISE EXCEPTION '20261131i revenire: starea nu e cea din 20261131i (pasul %, functii: %)', v_pas, coalesce(v_rau, 'drepturi / variante');
    END IF;
    -- CHECK-ul jurnalului: exact cel pus de 20261131i
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = to_regclass('public.red_mail_jurnal_f2') AND c.conname = 'red_mail_jurnal_f2_cod_check';
    IF v_def IS DISTINCT FROM 'CHECK ((cod = ANY (ARRAY[''creat''::text, ''aprobat''::text, ''rezervat''::text, ''apel_inceput''::text, ''trimis''::text, ''esuat_sigur''::text, ''necunoscut''::text, ''esuat_confirmat''::text, ''anulat''::text, ''lot_integritate''::text, ''lot_incheiat''::text, ''golit''::text, ''lot_sters_final''::text, ''setari''::text, ''optout''::text, ''campuri''::text])))' THEN
      RAISE EXCEPTION '20261131i revenire: starea nu e cea din 20261131i (pasul %, CHECK jurnal: %)', v_pas, coalesce(v_def, 'lipsa');
    END IF;
    -- L14: refuz pe ORICE istoric produs după aplicare (nimic nu se șterge)
    IF EXISTS (SELECT 1 FROM public.red_mail_jurnal_f2 j WHERE j.cod = 'campuri')
       OR EXISTS (SELECT 1 FROM public.red_mail_evenimente e WHERE e.tip = 'f2' AND e.cod = 'f2_campuri')
       OR EXISTS (SELECT 1 FROM public.red_mail_mesaje m WHERE m.eroare_cod = 'token_expirat') THEN
      RAISE EXCEPTION '20261131i revenire: ISTORIC_NOU (L14): loturi create cu campuri / mesaje anulate token_expirat dupa aplicare (jurnal F2, evenimente, mesaje) — nimic sters; intoarcerea = migrare noua, revizuita (pasul %)', v_pas;
    END IF;
  END LOOP;
END $pre$;

-- drepturile EXACTE ale celor patru funcții repuse, ÎNAINTE (postcondiția: aceleași după CREATE OR REPLACE)
CREATE TEMP TABLE red_acl_20261131i_rev ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)'::regprocedure, 'public.fn_red_mail_destinatari(uuid,uuid,uuid)'::regprocedure,
                                   'public.fn_red_mail_rezerva(uuid)'::regprocedure, 'public.fn_red_mail_apel_incepe(uuid,uuid)'::regprocedure);

-- ─── 1. Corpurile EXACTE din 20261131a (lot_creeaza, destinatari) ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza(p_operatie uuid,p_proiect uuid,p_uat uuid,p_destinatari uuid[],p_subiect text,p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE h text; existent public.red_mail_loturi; dst record; msg public.red_mail_mesaje; n bigint; pr public.red_proiecte; nou boolean;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_operatie IS NULL OR p_proiect IS NULL OR p_uat IS NULL OR cardinality(p_destinatari) IS NULL OR cardinality(p_destinatari) NOT BETWEEN 1 AND 300 OR array_position(p_destinatari,NULL) IS NOT NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;
 IF p_subiect IS NULL OR length(btrim(p_subiect)) NOT BETWEEN 1 AND 400 OR p_subiect ~ '[[:cntrl:]]' OR p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 19000 THEN RAISE EXCEPTION 'continut_invalid' USING ERRCODE='22023'; END IF;
 h:=public.fn_red_mail_f2_hash(jsonb_build_object('proiect',p_proiect,'uat',p_uat,'destinatari',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_destinatari)x),'subiect',p_subiect,'text',p_text));
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 INSERT INTO public.red_mail_loturi(id,proiect_id,uat_id,cerere_sha256,lot_sha256,creat_de) VALUES(p_operatie,p_proiect,p_uat,h,public.fn_red_mail_f2_hash('[]'::jsonb),auth.uid()) ON CONFLICT(id) DO NOTHING RETURNING * INTO existent;
 nou:=FOUND;
 SELECT * INTO existent FROM public.red_mail_loturi WHERE id=p_operatie FOR UPDATE;
 IF NOT nou THEN IF existent.cerere_sha256<>h THEN RAISE EXCEPTION 'operatie_reutilizata'; END IF; RETURN existent.id; END IF;
 SELECT * INTO pr FROM public.red_proiecte WHERE id=p_proiect;
 IF NOT FOUND OR pr.activ IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.red_uat WHERE id=p_uat AND proiect_id=p_proiect) THEN RAISE EXCEPTION 'tinta_invalida'; END IF;
 IF cardinality(p_destinatari)<>(SELECT count(DISTINCT x) FROM unnest(p_destinatari)x) OR cardinality(p_destinatari)<>(SELECT count(*) FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) AND d.sters_la IS NULL AND p.sters_la IS NULL AND p.proiect_id=p_proiect AND p.uat_id=p_uat AND public.fn_red_mail_f2_email(c.email)) THEN RAISE EXCEPTION 'destinatari_invalizi'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_detinatori_contact c WHERE c.detinator_id=ANY(p_destinatari)
 AND EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ))
 OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id
 WHERE m.detinator_id=ANY(p_destinatari) AND l.proiect_id=p_proiect
 AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;
 FOR dst IN SELECT d.id,c.email FROM public.red_detinatori d JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) ORDER BY d.id LOOP
  -- Numerotare M atomică, fără modificarea RPC-ului existent de numerotare.
  INSERT INTO public.red_numere(cheie,ultimul) VALUES('M',1) ON CONFLICT(cheie) DO UPDATE SET ultimul=red_numere.ultimul+1 RETURNING ultimul INTO n;
  msg.id:=gen_random_uuid(); msg.lot_id:=p_operatie; msg.detinator_id:=dst.id; msg.tip:='convocare'; msg.nr_document:='M-'||lpad(n::text,6,'0');
  msg.catre:=lower(dst.email); msg.message_id:='<'||msg.id::text||'@gazpet.ro>';
  msg.subiect_final:=public.fn_red_mail_f2_text(p_subiect); msg.corp_text_final:=public.fn_red_mail_f2_text(p_text); msg.corp_html_final:=NULL;
  msg.antete_snapshot:=jsonb_build_object('From','redari@gazpet.ro','To',msg.catre,'Message-ID',msg.message_id,'List-Unsubscribe','<mailto:redari@gazpet.ro?subject=dezabonare>');
  msg.mesaj_sha256:=public.fn_red_mail_f2_mesaj_hash(msg);
  INSERT INTO public.red_mail_mesaje(id,lot_id,detinator_id,nr_document,catre,message_id,subiect_final,corp_text_final,antete_snapshot,mesaj_sha256) VALUES(msg.id,msg.lot_id,msg.detinator_id,msg.nr_document,msg.catre,msg.message_id,msg.subiect_final,msg.corp_text_final,msg.antete_snapshot,msg.mesaj_sha256);
 END LOOP;
 UPDATE public.red_mail_loturi SET lot_sha256=public.fn_red_mail_f2_lot_hash(p_operatie) WHERE id=p_operatie;
 PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); RETURN p_operatie;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text) IS NULL;
CREATE OR REPLACE FUNCTION public.fn_red_mail_destinatari(p_proiect uuid,p_uat uuid,p_dupa uuid DEFAULT NULL)
RETURNS TABLE(id uuid,nume text,email text,motive text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 RETURN QUERY SELECT d.id,d.nume,lower(c.email),array_remove(ARRAY[
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE THEN 'fara_email' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ) THEN 'opt_out' END,
 -- Canalul poștal NU exclude e-mailul suplimentar. Este inventariat separat.
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE AND EXISTS(SELECT 1 FROM public.red_convocari cv WHERE cv.detinator_id=d.id AND cv.canal='posta' AND cv.stare='activ' AND cv.sters_la IS NULL) THEN 'canal_postal' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id WHERE m.detinator_id=d.id AND l.proiect_id=p_proiect AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN 'deja_rezervat_trimis' END
 ]::text[],NULL)
 FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id
 LEFT JOIN public.red_detinatori_contact c ON c.detinator_id=d.id
 WHERE p.proiect_id=p_proiect AND p.uat_id=p_uat AND p.sters_la IS NULL AND d.sters_la IS NULL
 AND (p_dupa IS NULL OR d.id>p_dupa) ORDER BY d.id LIMIT 300;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_destinatari(uuid,uuid,uuid) IS NULL;

-- ─── 2. Corpurile EXACTE din 20261131h (rezerva, apel_incepe) ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; s public.red_mail_setari; cod text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaje ORDER BY id. Setările serializează și cotele globale.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 -- 20261131h: decizia „doar TEST” a lui fn_red_mail_f2_poate e serializată cu orice UPDATE al proiectului (redenumire); trg_red_proiect_cod_test refuză
 -- schimbarea categoriei cât lotul nu e încheiat sau are mesaje rezervate / în apel, deci și între COMMIT-ul de aici și apelul HTTP.
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
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
COMMENT ON FUNCTION public.fn_red_mail_rezerva(uuid) IS 'Redări e-mail F2 (owner): rezervă următorul mesaj al lotului sub lock (setări → lot → proiect FOR SHARE → mesaje). 20261131h: proiectul FOR SHARE, ca decizia „doar TEST” să fie serializată cu redenumirea (trg_red_proiect_cod_test).';
CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(p_mesaj uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; cod text; s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaj; primul SELECT al id-ului nu blochează.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 -- 20261131h: proiectul FOR SHARE (vezi fn_red_mail_rezerva); autorizarea apelului HTTP nu poate fi dată cu un cod de proiect care se schimbă în paralel
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.stare<>'rezervat' OR m.lease_token IS DISTINCT FROM p_token OR m.lease_pana<=now() THEN RETURN false; END IF;
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,cod); END IF;
 IF cod IS NOT NULL OR (NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro') OR EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) OR s.ultim_apel_la>now()-interval '2 seconds' THEN RETURN false; END IF;
 UPDATE public.red_mail_mesaje SET stare='in_apel',apel_inceput_la=now() WHERE id=m.id;
 UPDATE public.red_mail_setari SET ultim_apel_la=now() WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'apel_inceput'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_apel_incepe(uuid,uuid) IS 'Redări e-mail F2 (owner): autorizează UN apel Gmail pentru mesajul rezervat (CAS pe lease). 20261131h: proiectul FOR SHARE, ca decizia „doar TEST” să fie serializată cu redenumirea (trg_red_proiect_cod_test).';

-- ─── 3. Funcțiile noi scoase (după ce niciun corp nu le mai cheamă) ─────────────────────────────────────────────────────────────
DROP FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid);
DROP FUNCTION public.fn_red_mail_f2_completeaza(text,jsonb);
DROP FUNCTION public.fn_red_mail_f2_link_strain(text,text);
DROP FUNCTION public.fn_red_mail_f2_link_forma(text);
DROP FUNCTION public.fn_red_mail_f2_token(uuid);
DROP FUNCTION public.fn_red_link_raspuns(text);

-- ─── 4. CHECK-ul jurnalului înapoi la 20261131a (fără ștergeri: L14 a refuzat deja orice rând `campuri`) ─────────────────────────
ALTER TABLE public.red_mail_jurnal_f2 DROP CONSTRAINT red_mail_jurnal_f2_cod_check;
ALTER TABLE public.red_mail_jurnal_f2 ADD CONSTRAINT red_mail_jurnal_f2_cod_check CHECK (cod IN ('creat','aprobat','rezervat','apel_inceput','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat','lot_integritate','lot_incheiat','golit','lot_sters_final','setari','optout'));

-- ─── 5. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_def text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', 'a43632708f4d31f44c50f614c0b5456c', 'plpgsql', true, 'v', 'uuid'),
      ('public.fn_red_mail_destinatari(uuid,uuid,uuid)', '4db265cc817f34726d109a8727058f65', 'plpgsql', true, 's', 'record'),
      ('public.fn_red_mail_rezerva(uuid)', 'd779e03d0644e437db412b0c3721e6c0', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9e8dbac708ee9512cd402a960d1d446a', 'plpgsql', true, 'v', 'boolean')
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131i revenire: postconditie: corpurile 20261131a / 20261131h nu sunt repuse: %', v_rau; END IF;
  IF (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE
     OR (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_destinatari(uuid,uuid,uuid)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '20261131i revenire: postconditie: fn_red_mail_rezerva / fn_red_mail_destinatari nu sunt SETOF';
  END IF;
  IF EXISTS (SELECT 1 FROM red_acl_20261131i_rev a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl) OR (SELECT count(*) FROM red_acl_20261131i_rev) <> 4 THEN
    RAISE EXCEPTION '20261131i revenire: postconditie: drepturile functiilor repuse difera';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_red_link_raspuns', 'fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza', 'fn_red_mail_f2_link_forma', 'fn_red_mail_f2_link_strain')) THEN
    RAISE EXCEPTION '20261131i revenire: postconditie: functii ramase';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_jurnal_f2'::regclass AND c.conname = 'red_mail_jurnal_f2_cod_check';
  IF v_def IS DISTINCT FROM 'CHECK ((cod = ANY (ARRAY[''creat''::text, ''aprobat''::text, ''rezervat''::text, ''apel_inceput''::text, ''trimis''::text, ''esuat_sigur''::text, ''necunoscut''::text, ''esuat_confirmat''::text, ''anulat''::text, ''lot_integritate''::text, ''lot_incheiat''::text, ''golit''::text, ''lot_sters_final''::text, ''setari''::text, ''optout''::text])))' THEN
    RAISE EXCEPTION '20261131i revenire: postconditie: CHECK jurnal (%)', coalesce(v_def, 'lipsa');
  END IF;
  RAISE NOTICE '20261131i revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
