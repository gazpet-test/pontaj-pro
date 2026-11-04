-- Version 20261130130000. Runner supplies one transaction.
-- 20261130k_redari_mail_f1_reguli — Redări e-mail F1, pasul (1), partea a doua: REGULILE schemei (după 20261130j_redari_mail_f1_schema).
-- Plan: docs/redari/PLAN_EMAIL_REDARI.md r19e, §1.10 (proveniența răspunsurilor, stările), §1.12 (inventarul), §1.2 (ciclul Gmail, tombstone),
-- §1.8 (golire, blocaj, eliberare), §1.11 (adrese propuse), §2.1 (numărătorile viewer-ului, termenele doar owner).
-- Ce face (fără tabele noi, fără date):
--   A. Proveniența pe red_raspunsuri (L07, Jak r3 P1-01), fără GUC-uri (L08):
--      • constraint trigger DEFERRABLE INITIALLY DEFERRED (AFTER INSERT, canal = 'email'): la commit, orice rând NOU cu canal = email are rândul
--        red_mail_raspuns_sursa (același deținător) și obiectii_text = NULL sau EXACT referința fixă (fără text din mail). INSERT direct prin
--        PostgREST (tranzacție proprie, fără sursă) → refuz la commit. Rândurile vechi nu sunt verificate (preflight: 0 rânduri email pe live);
--      • BEFORE UPDATE (ultimul în ordinea triggerelor, după fn_red_raspunsuri_valideaza): canal nu se schimbă nici spre, nici dinspre email;
--        pe rândurile cu sursă e-mail, optiune / data / zi_sesiune_aleasa / obiectii_text / declaratie_confirmata / semnatura_electronica_ref /
--        detinator_id / created_by / created_at sunt imuabile pentru TOATE rolurile (refuz înainte de jurnal: nicio urmă în red_jurnal).
--        Răspunsurile fără sursă e-mail rămân editabile ca azi (red_raspunsuri_upd neschimbată).
--   B. red_mail_raspuns_sursa: INSERT doar pentru un răspuns email al aceluiași deținător, cu mesajul sursă din redari@ (test IS FALSE),
--      ok + asociat / rezolvat + activ (gmail_redari) sau neprocesabil + activ, fără claim (mesaj_sursa_id, manual); UPDATE doar
--      primit_id → NULL cu gmail_redari → gmail_redari_sters și mesaj_sursa_id → NULL; DELETE doar în cascada ștergerii răspunsului.
--   C. Mașinile de stări / imutabilitatea pe red_mail_* (plasa de siguranță sub RPC-urile pașilor 2–6; niciun rol nu scrie direct):
--      primite (tranzițiile stare × stare_ingestie din §1.10, a_fost_asociat definitiv, „ignorat” doar fără legătură juridică, conținutul
--      înghețat după ingestie în afara golirii, eliberarea / anularea ei, ciclul Gmail, asocierea înghețată după înregistrare, DELETE doar
--      după golire și cu dedup-ul închis sau transferat); obiecte (calea = exact cea deterministă pe căsuța / HMAC-ul mesajului); dedup;
--      flux (data_start imuabil); evenimente (append-only); adrese propuse; oauth_state; setari (fără DELETE). versiune +1 la UPDATE.
--   D. red_proiecte.retentie_mail_pana: doar owner-ul îl schimbă (context de aplicație fără is_owner → 42501; mentenanța e scutită, ca la tronson).
--   E. Funcțiile de bază: fn_red_mail_are_legatura_juridica(uuid) (§1.12, fail-closed), fn_red_mail_referinta_obiectii(text, uuid),
--      fn_red_mail_gmail_tranzitie_ok(text, text), fn_red_mail_numaratori(uuid) (§2.1: viewer-ul primește doar contoare).
-- Ce NU face: RPC-urile de business (ingestie, lease, triere, înregistrare, confirmare, golire, trash, OAuth / Vault) — pașii 2–6; cronuri; vederi.
-- ATENȚIE (comportament schimbat): după k, un răspuns cu canal = 'email' NU mai poate fi înregistrat fără sursă (nici de operator, nici de RPC-ul
-- public) — calea e fn_red_mail_inregistreaza_raspuns[_manual] (pasul 4). UI-ul azi nu oferă „email” la răspunsuri (CANALE_CONVOCARE e pentru convocări).
-- Revenire: supabase/revenire/20261130k_redari_mail_f1_reguli_ROLLBACK.sql (refuză dacă există răspunsuri email sau rânduri de sursă).
-- DRY: supabase/tests/20261130j_redari_mail_f1_dryrun.sql (prod) și _dryrun_local.sql (PG17 local), care acoperă j + k.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130k_redari_mail_f1_reguli:' || txid_current() THEN
    RAISE EXCEPTION '20261130k: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_mail_verifica_baza(text)') IS NULL OR to_regclass('public.red_mail_primite') IS NULL THEN
    RAISE EXCEPTION '20261130k: 20261130j nu e aplicata';
  END IF;
  IF to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_mail_numaratori(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
                 AND t.tgname ~ '^trg_red_(mail|raspunsuri_zz_mail|raspunsuri_mail|proiecte_retentie)') THEN
    RAISE EXCEPTION '20261130k: obiectele exista deja';
  END IF;
  -- starea lui j, exact (funcții, politici, storage)
  PERFORM public.fn_red_mail_verifica_baza('dupa_j');
  -- red_raspunsuri: exact cele 3 triggere din baseline, cu funcțiile exacte (md5 live 04.11.2026) — triggerele noi se pun după ele
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND NOT tgisinternal) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_jurnal' AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_legaturi' AND t.tgfoid = 'public.fn_red_legaturi()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_raspunsuri_valideaza' AND t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_legaturi()'::regprocedure AND md5(replace(prosrc, chr(13), '')) = 'd1912ec6514cba162babea3bcebdfb24')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND md5(replace(prosrc, chr(13), '')) = '3528222d7d8379dbbe8f3d2e64c60b94')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_versiune_creste()'::regprocedure AND md5(replace(prosrc, chr(13), '')) = 'e7ab9318de671f0a94c678ee382250db') THEN
    RAISE EXCEPTION '20261130k: triggerele / functiile red_raspunsuri nu sunt cele din baseline';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '20261130k: red_proiecte are alte triggere decat baseline-ul (jurnal + versiune)';
  END IF;
  -- §1.10 / §8: răspunsurile email preexistente (live 04.11.2026: 0). >0 = decizia lui Răzvan înainte de apply (operație pe date reale).
  IF EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE canal = 'email') THEN
    RAISE EXCEPTION '20261130k: exista raspunsuri canal = email preexistente (%); decizia lui Razvan inainte de apply', (SELECT count(*) FROM public.red_raspunsuri WHERE canal = 'email');
  END IF;
  -- j e încă inertă: doar cele 3 rânduri inițiale
  IF (SELECT count(*) FROM public.red_mail_setari) <> 1 OR (SELECT count(*) FROM public.red_mail_flux) <> 2 OR EXISTS (SELECT 1 FROM public.red_mail_primite)
     OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa) OR EXISTS (SELECT 1 FROM public.red_mail_adrese_propuse) OR EXISTS (SELECT 1 FROM public.red_mail_evenimente) THEN
    RAISE EXCEPTION '20261130k: tabelele red_mail_* au deja randuri';
  END IF;
END $pre$;

-- ============================================================================ E. funcțiile de bază
-- §1.12: are_legatura_juridica, literal; NULL / rând lipsă / eroare de evaluare = true (fail-closed). Doar id-ul de la apelant.
CREATE FUNCTION public.fn_red_mail_are_legatura_juridica(p_primit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce((
    SELECT p.a_fost_asociat
        OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.primit_id = p.id)
        OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.mesaj_sursa_id = p.id)
        OR EXISTS (SELECT 1 FROM public.red_mail_adrese_propuse a WHERE a.primit_id = p.id AND a.stare = 'confirmata')
        OR p.corespondenta_id IS NOT NULL
      FROM public.red_mail_primite p WHERE p.id = p_primit_id), true);
$fn$;
COMMENT ON FUNCTION public.fn_red_mail_are_legatura_juridica(uuid) IS 'Redări e-mail (§1.12): a_fost_asociat OR răspuns cu sursa = mesajul OR răspuns manual care îl citează (mesaj_sursa_id) OR adresă confirmată din el OR legătură cu red_corespondenta. NULL / lipsă = true (fail-closed). Nu se stochează.';
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_are_legatura_juridica(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Referința fixă din obiectii_text pentru un răspuns venit pe e-mail (§1.10): textul mailului NU se copiază în Registru.
CREATE FUNCTION public.fn_red_mail_referinta_obiectii(p_tip_sursa text, p_primit_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE
    WHEN p_tip_sursa = 'gmail_redari' AND p_primit_id IS NOT NULL
      THEN 'Obiecții transmise pe e-mail — mesajul RED-' || upper(left(replace(p_primit_id::text, '-', ''), 8)) || '; textul în 📥 Mesaje'
    WHEN p_tip_sursa = 'manual_verificat'
      THEN 'Obiecții transmise pe e-mail — înregistrare manuală; textul mailului nu e în ERP'
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_referinta_obiectii(text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_referinta_obiectii(text, uuid) TO authenticated;

-- Ciclul originalului din Gmail (§1.2 pașii 1–6): lista ÎNCHISĂ de tranziții (aceeași pe red_mail_primite și red_mail_dedup). Propunere r19e.
CREATE FUNCTION public.fn_red_mail_gmail_tranzitie_ok(p_vechi text, p_nou text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT p_vechi = p_nou OR (p_vechi, p_nou) IN (
    ('necerut', 'de_mutat_in_cos'),
    ('de_mutat_in_cos', 'trash_in_apel'),
    ('trash_in_apel', 'in_cos'), ('trash_in_apel', 'verificat_absent'), ('trash_in_apel', 'de_decis'), ('trash_in_apel', 'esuat'),
    ('in_cos', 'verificat_absent'), ('in_cos', 'de_decis'),
    ('de_decis', 'trash_in_apel'), ('de_decis', 'pastrat_de_om'),
    ('esuat', 'trash_in_apel'), ('esuat', 'pastrat_de_om'),
    ('pastrat_de_om', 'trash_in_apel'),
    ('de_mutat_in_cos', 'expirat'), ('trash_in_apel', 'expirat'), ('in_cos', 'expirat'), ('de_decis', 'expirat'), ('esuat', 'expirat'), ('pastrat_de_om', 'expirat'));
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_gmail_tranzitie_ok(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- §2.1: numărătorile pentru oricine are nivel Redări (inclusiv viewer): doar contoare pe (UAT, stare), fără id-uri, adrese sau date.
-- Mesajele neasociate nu au proiect: apar cu uat_id NULL (contorul căsuței redari@). Mesajele de test nu se numără.
CREATE FUNCTION public.fn_red_mail_numaratori(p_proiect_id uuid) RETURNS TABLE (uat_id uuid, stare text, nr integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF public.fn_red_nivel() IS NULL THEN RAISE EXCEPTION 'redari: acces refuzat (fara nivel pe modulul redari)' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL THEN RAISE EXCEPTION 'redari: proiect lipsa' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT pa.uat_id, CASE WHEN m.stare_ingestie <> 'ok' THEN m.stare_ingestie ELSE m.stare END, count(*)::integer
    FROM public.red_mail_primite m
    LEFT JOIN public.red_parcele pa ON pa.id = m.parcela_id
   WHERE m.casuta = 'redari@gazpet.ro' AND m.test IS FALSE AND (m.parcela_id IS NULL OR pa.proiect_id = p_proiect_id)
   GROUP BY 1, 2;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_numaratori(uuid) IS 'Redări e-mail (§2.1): contoare pe (UAT, stare) pentru 📥 Mesaje — singurul lucru pe care îl vede viewer-ul. uat_id NULL = neasociate (căsuța redari@). Fără id-uri, adrese, subiecte, date. 42501 fără nivel Redări.';
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_numaratori(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_numaratori(uuid) TO authenticated;

-- ============================================================================ A. proveniența pe red_raspunsuri
CREATE FUNCTION public.fn_red_mail_raspuns_sursa_ceruta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.red_mail_raspuns_sursa%ROWTYPE; v_ob text; v_det uuid;
BEGIN
  -- la commit: rândul poate fi deja șters în aceeași tranzacție (cascada a scos și sursa) → nimic de verificat
  SELECT r.obiectii_text, r.detinator_id INTO v_ob, v_det FROM public.red_raspunsuri r WHERE r.id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.red_mail_raspuns_sursa WHERE raspuns_id = NEW.id;
  IF NOT FOUND OR s.detinator_id IS DISTINCT FROM v_det THEN
    RAISE EXCEPTION 'redari: un raspuns pe e-mail se inregistreaza doar prin fluxul 📥 Mesaje (sursa lipsa)' USING ERRCODE = '42501';
  END IF;
  IF v_ob IS NOT NULL AND v_ob IS DISTINCT FROM public.fn_red_mail_referinta_obiectii(s.tip_sursa, s.primit_id) THEN
    RAISE EXCEPTION 'redari: obiectii_text al unui raspuns pe e-mail e doar referinta fixa (textul mailului nu se copiaza)' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_raspuns_sursa_ceruta() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER trg_red_raspunsuri_mail_sursa AFTER INSERT ON public.red_raspunsuri DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.canal = 'email') EXECUTE FUNCTION public.fn_red_mail_raspuns_sursa_ceruta();

CREATE FUNCTION public.fn_red_mail_raspuns_protejat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.canal IS DISTINCT FROM OLD.canal AND (NEW.canal = 'email' OR OLD.canal = 'email') THEN
    RAISE EXCEPTION 'redari: canalul email nu se schimba (nici spre, nici dinspre)' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.raspuns_id = OLD.id)
     AND (NEW.optiune, NEW.data, NEW.zi_sesiune_aleasa, NEW.obiectii_text, NEW.declaratie_confirmata, NEW.semnatura_electronica_ref, NEW.detinator_id, NEW.created_by, NEW.created_at)
         IS DISTINCT FROM (OLD.optiune, OLD.data, OLD.zi_sesiune_aleasa, OLD.obiectii_text, OLD.declaratie_confirmata, OLD.semnatura_electronica_ref, OLD.detinator_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'redari: raspunsul venit pe e-mail e neschimbabil (corectura = operatie pe date reale, §8)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_raspuns_protejat() FROM PUBLIC, anon, authenticated, service_role;
-- numele sortează DUPĂ trg_red_raspunsuri_valideaza (ordinea alfabetică a triggerelor BEFORE): vede NEW după toate celelalte
CREATE TRIGGER trg_red_raspunsuri_zz_mail BEFORE UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_raspuns_protejat();

-- ============================================================================ B. red_mail_raspuns_sursa
CREATE FUNCTION public.fn_red_mail_sursa_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r public.red_raspunsuri%ROWTYPE; m public.red_mail_primite%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- doar cascada ștergerii răspunsului (rândul red_raspunsuri nu mai există)
    IF EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.id = OLD.raspuns_id) THEN
      RAISE EXCEPTION 'redari: sursa unui raspuns nu se sterge cat exista raspunsul' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.raspuns_id, NEW.detinator_id, NEW.operatie_id, NEW.cerere_sha256, NEW.metoda_verificare, NEW.verificat_de, NEW.verificat_la, NEW.data_raspuns, NEW.motiv_data, NEW.creat_la)
       IS DISTINCT FROM (OLD.id, OLD.raspuns_id, OLD.detinator_id, OLD.operatie_id, OLD.cerere_sha256, OLD.metoda_verificare, OLD.verificat_de, OLD.verificat_la, OLD.data_raspuns, OLD.motiv_data, OLD.creat_la)
       OR (NEW.primit_id IS DISTINCT FROM OLD.primit_id AND NOT (NEW.primit_id IS NULL AND OLD.tip_sursa = 'gmail_redari' AND NEW.tip_sursa = 'gmail_redari_sters'))
       OR (NEW.tip_sursa IS DISTINCT FROM OLD.tip_sursa AND NOT (OLD.tip_sursa = 'gmail_redari' AND NEW.tip_sursa = 'gmail_redari_sters' AND NEW.primit_id IS NULL))
       OR (NEW.mesaj_sursa_id IS DISTINCT FROM OLD.mesaj_sursa_id AND NEW.mesaj_sursa_id IS NOT NULL) THEN
      RAISE EXCEPTION 'redari: sursa raspunsului e imuabila (doar primit_id / mesaj_sursa_id -> NULL la stergerea auditului)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.red_raspunsuri WHERE id = NEW.raspuns_id;
  IF NOT FOUND OR r.canal IS DISTINCT FROM 'email' OR r.detinator_id IS DISTINCT FROM NEW.detinator_id THEN
    RAISE EXCEPTION 'redari: sursa cere un raspuns canal = email al aceluiasi detinator' USING ERRCODE = '23514';
  END IF;
  IF NEW.tip_sursa = 'gmail_redari_sters' THEN RAISE EXCEPTION 'redari: gmail_redari_sters nu se insereaza' USING ERRCODE = '23514'; END IF;
  IF NEW.tip_sursa = 'gmail_redari' THEN
    SELECT * INTO m FROM public.red_mail_primite WHERE id = NEW.primit_id;
    -- Cop r6 P2-02 / r13 P2-03: condiția POZITIVĂ (NULL nu trece); mesajul trebuie asociat (cu acest deținător sau un coproprietar al parcelei)
    IF NOT FOUND OR NOT (m.casuta = 'redari@gazpet.ro' AND m.test IS FALSE) OR m.stare_ingestie IS DISTINCT FROM 'ok'
       OR m.stare NOT IN ('asociat', 'rezolvat') OR m.retentie_stare IS DISTINCT FROM 'activ'
       OR NOT EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.id = NEW.detinator_id AND d.parcela_id = m.parcela_id) THEN
      RAISE EXCEPTION 'redari: mesajul sursa nu e un mesaj asociat, activ, din redari@ (nu de test) pentru acest detinator' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.mesaj_sursa_id IS NOT NULL THEN
    SELECT * INTO m FROM public.red_mail_primite WHERE id = NEW.mesaj_sursa_id;
    IF NOT FOUND OR NOT (m.casuta = 'redari@gazpet.ro' AND m.test IS FALSE) OR m.stare_ingestie IS DISTINCT FROM 'neprocesabil'
       OR m.retentie_stare IS DISTINCT FROM 'activ' OR m.golire_claim_token IS NOT NULL THEN
      RAISE EXCEPTION 'redari: mesaj_sursa_invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.tip_sursa = 'manual_verificat' AND NEW.data_raspuns > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN
    RAISE EXCEPTION 'redari: data raspunsului manual nu poate fi in viitor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_sursa_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_sursa_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_raspuns_sursa FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_sursa_reguli();

-- ============================================================================ C. mașinile de stări pe red_mail_*
-- red_mail_primite
CREATE FUNCTION public.fn_red_mail_primite_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_inghetat boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- rândul se naște în ingestie: in_curs, netriat, activ, fără niciun pas uman / Gmail
    IF NEW.stare <> 'nou' OR NEW.stare_ingestie <> 'in_curs' OR NEW.a_fost_asociat OR NEW.detinator_id IS NOT NULL OR NEW.verificare <> 'neverificat'
       OR NEW.retentie_stare <> 'activ' OR NEW.blocaj_stare <> 'fara' OR NEW.eliberat_golire_la IS NOT NULL OR NEW.gmail_stergere_stare <> 'necerut'
       OR NEW.inregistrat_in_registru OR NEW.gmail_id IS NULL OR NEW.gmail_id_hmac IS NULL OR NEW.dedup_incheiat_la IS NOT NULL OR NEW.corespondenta_id IS NOT NULL THEN
      RAISE EXCEPTION 'redari: un mesaj primit se creeaza doar in starea initiala a ingestiei' USING ERRCODE = '23514';
    END IF;
    NEW.creat_la := now(); NEW.ingestie_inceputa_la := now(); NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- ștergerea finală a auditului: doar după golire, fără claim, fără încercare trash în curs, cu dedup-ul închis sau transferat pe tombstone
    IF OLD.retentie_stare <> 'golit' OR OLD.golire_claim_token IS NOT NULL OR OLD.gmail_stergere_stare = 'trash_in_apel'
       OR NOT (OLD.dedup_incheiat_la IS NOT NULL OR OLD.gmail_id_hmac IS NULL
               OR EXISTS (SELECT 1 FROM public.red_mail_dedup d WHERE d.casuta = OLD.casuta AND d.gmail_id_hmac = OLD.gmail_id_hmac)) THEN
      RAISE EXCEPTION 'redari: auditul unui mesaj se sterge doar dupa golire, fara claim / trash in curs si cu dedup-ul inchis sau transferat' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: identitatea și ancorele
  IF (NEW.id, NEW.casuta, NEW.test, NEW.hmac_versiune, NEW.primit_la, NEW.creat_la, NEW.ingestie_inceputa_la)
     IS DISTINCT FROM (OLD.id, OLD.casuta, OLD.test, OLD.hmac_versiune, OLD.primit_la, OLD.creat_la, OLD.ingestie_inceputa_la)
     OR (NEW.gmail_id IS DISTINCT FROM OLD.gmail_id AND NEW.gmail_id IS NOT NULL)
     OR (NEW.gmail_id_hmac IS DISTINCT FROM OLD.gmail_id_hmac AND NEW.gmail_id_hmac IS NOT NULL)
     OR (OLD.golit_la IS NOT NULL AND (NEW.golit_la, NEW.limita_absoluta_la) IS DISTINCT FROM (OLD.golit_la, OLD.limita_absoluta_la))
     OR (OLD.dedup_incheiat_la IS NOT NULL AND NEW.dedup_incheiat_la IS DISTINCT FROM OLD.dedup_incheiat_la)
     OR (OLD.a_fost_asociat AND NOT NEW.a_fost_asociat)
     OR (OLD.inregistrat_in_registru AND NOT NEW.inregistrat_in_registru)
     OR (OLD.motiv_cod IS NOT NULL AND NEW.motiv_cod IS DISTINCT FROM OLD.motiv_cod)
     OR (OLD.corespondenta_id IS NOT NULL AND NEW.corespondenta_id IS DISTINCT FROM OLD.corespondenta_id) THEN
    RAISE EXCEPTION 'redari: identitatea / ancorele mesajului sunt imuabile (gmail_id / HMAC doar -> NULL)' USING ERRCODE = '42501';
  END IF;
  -- ingestia: in_curs -> ok | neprocesabil, apoi finală
  IF NEW.stare_ingestie IS DISTINCT FROM OLD.stare_ingestie AND NOT (OLD.stare_ingestie = 'in_curs' AND NEW.stare_ingestie IN ('ok', 'neprocesabil')) THEN
    RAISE EXCEPTION 'redari: tranzitie de ingestie nepermisa (% -> %)', OLD.stare_ingestie, NEW.stare_ingestie USING ERRCODE = '42501';
  END IF;
  -- conținutul extern: se scrie doar cât ingestia e in_curs; după aceea doar -> NULL, la golire
  IF OLD.stare_ingestie <> 'in_curs' AND (NEW.thread_id, NEW.rfc_message_id, NEW.raw_sha256, NEW.in_reply_to, NEW.references_ids, NEW.de_la_adresa, NEW.de_la_nume,
        NEW.reply_to, NEW.catre, NEW.subiect, NEW.corp_text, NEW.data_declarata, NEW.corp_trunchiat, NEW.subiect_trunchiat, NEW.charset_necunoscut, NEW.doar_html,
        NEW.fara_corp, NEW.eml_absent, NEW.auth_spf, NEW.auth_dkim, NEW.auth_dmarc, NEW.auth_sursa)
     IS DISTINCT FROM (OLD.thread_id, OLD.rfc_message_id, OLD.raw_sha256, OLD.in_reply_to, OLD.references_ids, OLD.de_la_adresa, OLD.de_la_nume,
        OLD.reply_to, OLD.catre, OLD.subiect, OLD.corp_text, OLD.data_declarata, OLD.corp_trunchiat, OLD.subiect_trunchiat, OLD.charset_necunoscut, OLD.doar_html,
        OLD.fara_corp, OLD.eml_absent, OLD.auth_spf, OLD.auth_dkim, OLD.auth_dmarc, OLD.auth_sursa)
     AND NOT (NEW.retentie_stare = 'golit' AND (NEW.thread_id, NEW.rfc_message_id, NEW.raw_sha256, NEW.in_reply_to, NEW.references_ids, NEW.de_la_adresa,
        NEW.de_la_nume, NEW.reply_to, NEW.catre, NEW.subiect, NEW.corp_text, NEW.data_declarata) IS NOT DISTINCT FROM
        (NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz)
        AND (NEW.corp_trunchiat, NEW.subiect_trunchiat, NEW.charset_necunoscut, NEW.doar_html, NEW.fara_corp, NEW.eml_absent, NEW.auth_spf, NEW.auth_dkim, NEW.auth_dmarc, NEW.auth_sursa)
            IS NOT DISTINCT FROM (OLD.corp_trunchiat, OLD.subiect_trunchiat, OLD.charset_necunoscut, OLD.doar_html, OLD.fara_corp, OLD.eml_absent, OLD.auth_spf, OLD.auth_dkim, OLD.auth_dmarc, OLD.auth_sursa)) THEN
    RAISE EXCEPTION 'redari: continutul unui mesaj primit nu se modifica dupa ingestie (doar golirea il pune pe NULL)' USING ERRCODE = '42501';
  END IF;
  -- triere (§1.10): exact tranzițiile permise; „ignorat” doar fără legătură juridică (implicit (i))
  IF NEW.stare IS DISTINCT FROM OLD.stare THEN
    IF NOT ((OLD.stare, NEW.stare) IN (('nou', 'asociat'), ('asociat', 'rezolvat'), ('rezolvat', 'asociat'), ('nou', 'ignorat'), ('ignorat', 'nou'))) THEN
      RAISE EXCEPTION 'redari: tranzitie de triere nepermisa (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '42501';
    END IF;
    IF OLD.retentie_stare <> 'activ' OR NEW.retentie_stare <> 'activ' THEN
      RAISE EXCEPTION 'redari: un mesaj in golire / golit nu se mai trieaza' USING ERRCODE = '42501';
    END IF;
    IF NEW.stare = 'ignorat' AND public.fn_red_mail_are_legatura_juridica(OLD.id) THEN
      RAISE EXCEPTION 'redari: neeligibil_asociat (mesajul are legatura juridica si nu poate fi marcat nepotrivit)' USING ERRCODE = '42501';
    END IF;
    IF OLD.stare = 'nou' AND NEW.stare = 'asociat' THEN NEW.a_fost_asociat := true; END IF;
  END IF;
  -- după înregistrarea în Registru (sau cu o sursă care îl citează), asocierea și verificarea se îngheață (§1.10)
  v_inghetat := OLD.inregistrat_in_registru OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa s WHERE s.primit_id = OLD.id);
  IF (NEW.detinator_id, NEW.parcela_id, NEW.asociat_de, NEW.asociat_la, NEW.verificare, NEW.verificat_de, NEW.verificat_la)
     IS DISTINCT FROM (OLD.detinator_id, OLD.parcela_id, OLD.asociat_de, OLD.asociat_la, OLD.verificare, OLD.verificat_de, OLD.verificat_la) THEN
    IF v_inghetat THEN RAISE EXCEPTION 'redari: asocierea / verificarea sunt inghetate dupa inregistrarea raspunsului' USING ERRCODE = '42501'; END IF;
    IF OLD.retentie_stare <> 'activ' OR NEW.retentie_stare <> 'activ' THEN RAISE EXCEPTION 'redari: un mesaj in golire / golit nu se mai asociaza / verifica' USING ERRCODE = '42501'; END IF;
    -- legătura se pune o dată (nou -> asociat); nu se mută pe alt deținător
    IF OLD.detinator_id IS NOT NULL AND NEW.detinator_id IS DISTINCT FROM OLD.detinator_id THEN
      RAISE EXCEPTION 'redari: asocierea confirmata nu se muta (corectura = operatie pe date reale)' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- retenția: activ -> in_golire -> golit (sau activ -> golit fără obiecte); in_golire -> activ; golit e final; blocajul oprește începerea golirii
  IF NEW.retentie_stare IS DISTINCT FROM OLD.retentie_stare THEN
    IF NOT ((OLD.retentie_stare, NEW.retentie_stare) IN (('activ', 'in_golire'), ('in_golire', 'activ'), ('in_golire', 'golit'), ('activ', 'golit'))) THEN
      RAISE EXCEPTION 'redari: tranzitie de retentie nepermisa (% -> %)', OLD.retentie_stare, NEW.retentie_stare USING ERRCODE = '42501';
    END IF;
    IF NEW.retentie_stare IN ('in_golire', 'golit') AND OLD.retentie_stare = 'activ' AND (OLD.blocaj_stare <> 'fara' OR NEW.blocaj_stare <> 'fara') THEN
      RAISE EXCEPTION 'redari: blocajul legal opreste golirea' USING ERRCODE = '42501';
    END IF;
    IF NEW.retentie_stare = 'golit' AND OLD.stare_ingestie = 'in_curs' THEN
      RAISE EXCEPTION 'redari: un mesaj in curs de ingestie nu se goleste' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- eliberarea pentru golire (§1.10, r16–r18): set (toate trei) pe neprocesabil activ fără legătură juridică; anulare (toate trei -> NULL) cât e
  -- activ și fără claim; motivul -> NULL doar împreună cu golirea. Orice altă schimbare = refuz.
  IF (NEW.eliberat_golire_la, NEW.eliberat_golire_de, NEW.eliberat_golire_motiv) IS DISTINCT FROM (OLD.eliberat_golire_la, OLD.eliberat_golire_de, OLD.eliberat_golire_motiv) THEN
    IF OLD.eliberat_golire_la IS NULL AND NEW.eliberat_golire_la IS NOT NULL THEN
      IF OLD.stare_ingestie <> 'neprocesabil' OR OLD.retentie_stare <> 'activ' OR public.fn_red_mail_are_legatura_juridica(OLD.id) THEN
        RAISE EXCEPTION 'redari: neeligibil_asociat (eliberarea cere un mesaj neprocesabil, activ, fara legatura juridica)' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.eliberat_golire_la IS NOT NULL AND NEW.eliberat_golire_la IS NULL THEN
      IF OLD.retentie_stare <> 'activ' OR NEW.retentie_stare <> 'activ' OR OLD.golire_claim_token IS NOT NULL THEN
        RAISE EXCEPTION 'redari: mesaj_sursa_invalid (eliberarea nu se mai anuleaza dupa inceperea golirii)' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT ((NEW.eliberat_golire_la, NEW.eliberat_golire_de) IS NOT DISTINCT FROM (OLD.eliberat_golire_la, OLD.eliberat_golire_de)
               AND NEW.eliberat_golire_motiv IS NULL AND NEW.retentie_stare = 'golit') THEN
      RAISE EXCEPTION 'redari: eliberarea nu se modifica (doar setare, anulare sau motivul -> NULL la golire)' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- ciclul Gmail: lista închisă; o încercare nouă = UUID nou, doar la intrarea în trash_in_apel; termenul absolut nu se mută
  IF NOT public.fn_red_mail_gmail_tranzitie_ok(OLD.gmail_stergere_stare, NEW.gmail_stergere_stare) THEN
    RAISE EXCEPTION 'redari: tranzitie Gmail nepermisa (% -> %)', OLD.gmail_stergere_stare, NEW.gmail_stergere_stare USING ERRCODE = '42501';
  END IF;
  IF (NEW.gmail_trash_incercare_id, NEW.gmail_trash_inceput_la, NEW.gmail_trash_valabil_pana) IS DISTINCT FROM (OLD.gmail_trash_incercare_id, OLD.gmail_trash_inceput_la, OLD.gmail_trash_valabil_pana)
     AND NOT (NEW.gmail_stergere_stare = 'trash_in_apel' AND OLD.gmail_stergere_stare <> 'trash_in_apel'
              AND NEW.gmail_trash_incercare_id IS DISTINCT FROM OLD.gmail_trash_incercare_id AND NEW.gmail_trash_incercare_id IS NOT NULL) THEN
    RAISE EXCEPTION 'redari: evidenta incercarii trash se scrie doar la intrarea in trash_in_apel, cu UUID nou' USING ERRCODE = '42501';
  END IF;
  IF NEW.gmail_stergere_stare = 'trash_in_apel' AND OLD.gmail_stergere_stare <> 'trash_in_apel' AND OLD.limita_absoluta_la IS NOT NULL AND now() >= OLD.limita_absoluta_la THEN
    RAISE EXCEPTION 'redari: limita absoluta a trecut; nicio incercare noua' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_primite_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_primite_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_primite FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_primite_reguli();

-- red_mail_obiecte: calea = exact cea deterministă pe (casuta, gmail_id_hmac) a mesajului; stările din manifest
CREATE FUNCTION public.fn_red_mail_obiecte_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE m public.red_mail_primite%ROWTYPE; v_cale text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.stare NOT IN ('sters', 'respins_tip', 'respins_marime', 'respins_structura', 'respins_buget')
       OR NOT EXISTS (SELECT 1 FROM public.red_mail_primite p WHERE p.id = OLD.primit_id AND p.retentie_stare = 'golit') THEN
      RAISE EXCEPTION 'redari: un obiect se sterge din manifest doar sters / respins, pe un mesaj golit' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO m FROM public.red_mail_primite WHERE id = NEW.primit_id;
    IF NOT FOUND OR m.stare_ingestie <> 'in_curs' OR m.gmail_id_hmac IS NULL THEN
      RAISE EXCEPTION 'redari: manifestul se scrie doar pentru un mesaj in curs de ingestie' USING ERRCODE = '23514';
    END IF;
    IF NEW.stare NOT IN ('asteptat', 'respins_tip', 'respins_marime', 'respins_structura', 'respins_buget') OR NEW.sha256 IS NOT NULL OR NEW.marime IS NOT NULL THEN
      RAISE EXCEPTION 'redari: un obiect intra in manifest asteptat sau respins, fara amprenta' USING ERRCODE = '23514';
    END IF;
    v_cale := 'mail/' || CASE m.casuta WHEN 'redari@gazpet.ro' THEN 'redari' WHEN 'redari-test@gazpet.ro' THEN 'redari-test' END || '/'
              || CASE NEW.tip WHEN 'eml' THEN 'carantina/' || m.gmail_id_hmac || '.eml' ELSE 'atasamente/' || m.gmail_id_hmac || '/' || NEW.nr END;
    IF NEW.cale IS DISTINCT FROM v_cale AND NOT (NEW.cale IS NULL AND NEW.stare LIKE 'respins%') THEN
      RAISE EXCEPTION 'redari: calea obiectului nu e cea determinista a mesajului' USING ERRCODE = '23514';
    END IF;
    NEW.creat_la := now(); NEW.stergere_autorizata_la := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.primit_id, NEW.tip, NEW.nr, NEW.mime_declarat, NEW.marime_declarata, NEW.creat_la) IS DISTINCT FROM (OLD.id, OLD.primit_id, OLD.tip, OLD.nr, OLD.mime_declarat, OLD.marime_declarata, OLD.creat_la)
     OR (NEW.cale IS DISTINCT FROM OLD.cale AND NOT (NEW.cale IS NULL AND NEW.stare IN ('sters', 'respins_tip', 'respins_marime', 'respins_structura', 'respins_buget')))
     OR (NEW.nume IS DISTINCT FROM OLD.nume AND NOT (NEW.nume IS NULL AND NEW.stare IN ('sters', 'respins_tip', 'respins_marime', 'respins_structura', 'respins_buget')) AND OLD.stare <> 'asteptat')
     OR (OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256 AND NOT (NEW.sha256 IS NULL AND NEW.stare = 'sters'))
     OR (OLD.marime IS NOT NULL AND NEW.marime IS DISTINCT FROM OLD.marime) THEN
    RAISE EXCEPTION 'redari: obiectul din manifest e imuabil (doar starea, amprenta la stocare si golirea)' USING ERRCODE = '42501';
  END IF;
  IF NEW.stare IS DISTINCT FROM OLD.stare AND NOT ((OLD.stare, NEW.stare) IN (('asteptat', 'stocat'), ('asteptat', 'conflict_obiect'), ('stocat', 'conflict_obiect'),
        ('stocat', 'in_stergere'), ('conflict_obiect', 'in_stergere'), ('in_stergere', 'sters'), ('in_stergere', 'stocat'))) THEN
    RAISE EXCEPTION 'redari: tranzitie de obiect nepermisa (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '42501';
  END IF;
  IF NEW.stare = 'in_stergere' AND OLD.stare <> 'in_stergere' THEN
    -- cel mult un obiect autorizat la ștergere pe mesaj (§1.8): niciun alt obiect al mesajului nu e in_stergere
    IF EXISTS (SELECT 1 FROM public.red_mail_obiecte o WHERE o.primit_id = NEW.primit_id AND o.id <> NEW.id AND o.stare = 'in_stergere') THEN
      RAISE EXCEPTION 'redari: alt obiect al mesajului e deja in stergere' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.red_mail_primite p WHERE p.id = NEW.primit_id AND p.retentie_stare = 'in_golire' AND p.blocaj_stare = 'fara') THEN
      RAISE EXCEPTION 'redari: stergerea unui obiect cere mesajul in golire, fara blocaj' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_obiecte_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_obiecte_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_obiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_obiecte_reguli();

-- red_mail_dedup: identitatea și termenul absolut imuabile; aceeași listă de tranziții Gmail; DELETE doar după verificare sau la termen
CREATE FUNCTION public.fn_red_mail_dedup_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.gmail_stergere_stare NOT IN ('verificat_absent', 'expirat') AND now() < OLD.limita_absoluta_la THEN
      RAISE EXCEPTION 'redari: tombstone-ul se sterge doar dupa verificat_absent sau la limita absoluta' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF now() >= NEW.limita_absoluta_la OR NEW.gmail_stergere_stare IN ('verificat_absent', 'expirat') THEN
      RAISE EXCEPTION 'redari: tombstone doar cat dedup-ul e deschis' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.casuta, NEW.gmail_id_hmac, NEW.hmac_versiune, NEW.golit_la, NEW.limita_absoluta_la) IS DISTINCT FROM (OLD.casuta, OLD.gmail_id_hmac, OLD.hmac_versiune, OLD.golit_la, OLD.limita_absoluta_la)
     OR (NEW.gmail_id IS DISTINCT FROM OLD.gmail_id AND NEW.gmail_id IS NOT NULL) THEN
    RAISE EXCEPTION 'redari: identitatea / termenul tombstone-ului sunt imuabile' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_red_mail_gmail_tranzitie_ok(OLD.gmail_stergere_stare, NEW.gmail_stergere_stare) THEN
    RAISE EXCEPTION 'redari: tranzitie Gmail nepermisa pe tombstone (% -> %)', OLD.gmail_stergere_stare, NEW.gmail_stergere_stare USING ERRCODE = '42501';
  END IF;
  IF (NEW.gmail_trash_incercare_id, NEW.gmail_trash_inceput_la, NEW.gmail_trash_valabil_pana) IS DISTINCT FROM (OLD.gmail_trash_incercare_id, OLD.gmail_trash_inceput_la, OLD.gmail_trash_valabil_pana)
     AND NOT (NEW.gmail_stergere_stare = 'trash_in_apel' AND OLD.gmail_stergere_stare <> 'trash_in_apel'
              AND NEW.gmail_trash_incercare_id IS DISTINCT FROM OLD.gmail_trash_incercare_id AND NEW.gmail_trash_incercare_id IS NOT NULL) THEN
    RAISE EXCEPTION 'redari: evidenta incercarii trash se scrie doar la intrarea in trash_in_apel, cu UUID nou' USING ERRCODE = '42501';
  END IF;
  IF NEW.gmail_stergere_stare = 'trash_in_apel' AND OLD.gmail_stergere_stare <> 'trash_in_apel' AND now() >= OLD.limita_absoluta_la THEN
    RAISE EXCEPTION 'redari: limita absoluta a trecut; nicio incercare noua' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_dedup_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_dedup_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_dedup FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_dedup_reguli();

-- red_mail_flux: cheia și modul imuabile; data_start / data_import_de_la imuabile odată scrise (§1.1, Jak r6 P2-02); fără DELETE
CREATE FUNCTION public.fn_red_mail_flux_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari: un flux nu se sterge (se dezactiveaza)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.activ OR NEW.mod_cursor <> 'neinitializat' OR NEW.lease_token IS NOT NULL THEN
      RAISE EXCEPTION 'redari: un flux nou porneste inactiv si neinitializat' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.casuta, NEW.flux, NEW.mod_test) IS DISTINCT FROM (OLD.casuta, OLD.flux, OLD.mod_test)
     OR (OLD.data_start IS NOT NULL AND NEW.data_start IS DISTINCT FROM OLD.data_start)
     OR (OLD.data_import_de_la IS NOT NULL AND NEW.data_import_de_la IS DISTINCT FROM OLD.data_import_de_la) THEN
    RAISE EXCEPTION 'redari: casuta / flux / mod_test / data_start / data_import_de_la sunt imuabile' USING ERRCODE = '42501';
  END IF;
  IF NEW.mod_cursor IS DISTINCT FROM OLD.mod_cursor AND NOT ((OLD.mod_cursor, NEW.mod_cursor) IN (('neinitializat', 'recuperare'), ('recuperare', 'normal'), ('normal', 'recuperare'))) THEN
    RAISE EXCEPTION 'redari: tranzitie de cursor nepermisa (% -> %)', OLD.mod_cursor, NEW.mod_cursor USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_flux_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_flux_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_flux FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_flux_reguli();

-- red_mail_evenimente: append-only; DELETE doar în cascada ștergerii auditului mesajului sau, fără mesaj, după 1 an (implicit (f))
CREATE FUNCTION public.fn_red_mail_evenimente_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.creat_la := now(); RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'redari: evenimentele sunt append-only' USING ERRCODE = '42501'; END IF;
  IF (OLD.primit_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.red_mail_primite p WHERE p.id = OLD.primit_id))
     OR (OLD.primit_id IS NULL AND OLD.creat_la >= now() - interval '1 year') THEN
    RAISE EXCEPTION 'redari: evenimentele se sterg doar cu auditul mesajului sau dupa 1 an' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_evenimente_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_evenimente_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_evenimente FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_evenimente_reguli();
CREATE TRIGGER trg_red_mail_evenimente_fara_truncate BEFORE TRUNCATE ON public.red_mail_evenimente FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();

-- red_mail_adrese_propuse: propusa -> confirmata | respinsa; o confirmată e înghețată; golirea doar pe propusă / respinsă; fără DELETE
CREATE FUNCTION public.fn_red_mail_adrese_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari: o adresa propusa nu se sterge (se goleste)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare <> 'propusa' OR NEW.golit_la IS NOT NULL THEN RAISE EXCEPTION 'redari: o adresa intra doar ca propusa' USING ERRCODE = '23514'; END IF;
    IF NEW.primit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_mail_primite p WHERE p.id = NEW.primit_id AND p.casuta = 'redari@gazpet.ro' AND p.test IS FALSE) THEN
      RAISE EXCEPTION 'redari: sursa_test (adresa propusa dintr-un mesaj de test)' USING ERRCODE = '23514';
    END IF;
    NEW.propus_la := now(); NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.detinator_id, NEW.sursa, NEW.propus_la) IS DISTINCT FROM (OLD.id, OLD.detinator_id, OLD.sursa, OLD.propus_la)
     OR (NEW.primit_id IS DISTINCT FROM OLD.primit_id AND NEW.primit_id IS NOT NULL) THEN
    RAISE EXCEPTION 'redari: detinatorul / sursa / data propunerii sunt imuabile' USING ERRCODE = '42501';
  END IF;
  IF NEW.stare IS DISTINCT FROM OLD.stare AND NOT (OLD.stare = 'propusa' AND NEW.stare IN ('confirmata', 'respinsa')) THEN
    RAISE EXCEPTION 'redari: tranzitie de adresa nepermisa (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '42501';
  END IF;
  IF OLD.stare = 'confirmata' AND (NEW.email, NEW.nota, NEW.confirmat_de, NEW.confirmat_la, NEW.metoda_verificare, NEW.confirmare_operatie_id, NEW.confirmare_cerere_sha256, NEW.golit_la)
       IS DISTINCT FROM (OLD.email, OLD.nota, OLD.confirmat_de, OLD.confirmat_la, OLD.metoda_verificare, OLD.confirmare_operatie_id, OLD.confirmare_cerere_sha256, OLD.golit_la) THEN
    RAISE EXCEPTION 'redari: o adresa confirmata e inghetata' USING ERRCODE = '42501';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND NOT (NEW.email IS NULL AND NEW.golit_la IS NOT NULL) THEN
    RAISE EXCEPTION 'redari: adresa propusa nu se rescrie (doar golirea o pune pe NULL)' USING ERRCODE = '42501';
  END IF;
  IF OLD.golit_la IS NOT NULL AND NEW.golit_la IS DISTINCT FROM OLD.golit_la THEN RAISE EXCEPTION 'redari: golit_la e imuabil' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_adrese_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_adrese_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_adrese_propuse FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_adrese_reguli();

-- red_mail_oauth_state: doar consumarea (o dată); DELETE doar consumat / expirat
CREATE FUNCTION public.fn_red_mail_oauth_state_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.consumat_la IS NOT NULL THEN RAISE EXCEPTION 'redari: state-ul se creeaza neconsumat' USING ERRCODE = '23514'; END IF;
    NEW.creat_la := now();
    IF NEW.expira_la > NEW.creat_la + interval '10 minutes' THEN NEW.expira_la := NEW.creat_la + interval '10 minutes'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.consumat_la IS NULL AND OLD.expira_la > now() THEN RAISE EXCEPTION 'redari: state-ul activ nu se sterge' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.state_sha256, NEW.scop, NEW.owner_id, NEW.creat_la, NEW.expira_la) IS DISTINCT FROM (OLD.id, OLD.state_sha256, OLD.scop, OLD.owner_id, OLD.creat_la, OLD.expira_la)
     OR OLD.consumat_la IS NOT NULL OR NEW.consumat_la IS NULL THEN
    RAISE EXCEPTION 'redari: state-ul OAuth se consuma o singura data, nimic altceva' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_oauth_state_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_oauth_state_reguli BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_oauth_state FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_oauth_state_reguli();

-- red_mail_setari: un singur rând, nu se șterge
CREATE FUNCTION public.fn_red_mail_setari_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari: setarile nu se sterg' USING ERRCODE = '42501'; END IF;
  NEW.actualizat_la := now();
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_setari_reguli() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_mail_setari_reguli BEFORE UPDATE OR DELETE ON public.red_mail_setari FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_setari_reguli();
CREATE TRIGGER trg_red_mail_fara_truncate BEFORE TRUNCATE ON public.red_mail_setari FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();

-- versiune +1 la orice UPDATE (CAS-ul RPC-urilor): funcția existentă fn_red_versiune_creste (md5 verificat în preflight)
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_mail_setari FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_mail_flux FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_mail_primite FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_mail_adrese_propuse FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();

-- ============================================================================ D. red_proiecte.retentie_mail_pana: doar owner
-- Context de aplicație = JWT cu sub SAU rol anon / authenticated în claim (ca fn_red_legaturi la tronson): fără is_owner → 42501.
-- Mentenanța (postgres / service_role fără JWT de aplicație) e scutită. Restul coloanelor red_proiecte: neschimbat (admin, ca azi).
CREATE FUNCTION public.fn_red_mail_proiect_retentie() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.retentie_mail_pana IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.retentie_mail_pana IS DISTINCT FROM OLD.retentie_mail_pana) THEN
    IF (auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('anon', 'authenticated'))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN
      RAISE EXCEPTION 'redari: termenul de retentie al corespondentei il fixeaza doar owner-ul' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_proiect_retentie() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_proiecte_retentie_mail BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_proiect_retentie();

-- ============================================================================ postcondiții
DO $post$
DECLARE r record;
BEGIN
  PERFORM public.fn_red_mail_verifica_baza('dupa_j');   -- j neatinsă (funcții, politici, storage)
  -- funcțiile noi: DEFINER / search_path / owner; EXECUTE exact
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_mail_are_legatura_juridica(uuid)', true, false), ('public.fn_red_mail_referinta_obiectii(text,uuid)', false, true),
      ('public.fn_red_mail_gmail_tranzitie_ok(text,text)', false, false), ('public.fn_red_mail_numaratori(uuid)', true, true),
      ('public.fn_red_mail_raspuns_sursa_ceruta()', true, false), ('public.fn_red_mail_raspuns_protejat()', true, false),
      ('public.fn_red_mail_sursa_reguli()', true, false), ('public.fn_red_mail_primite_reguli()', true, false),
      ('public.fn_red_mail_obiecte_reguli()', true, false), ('public.fn_red_mail_dedup_reguli()', true, false),
      ('public.fn_red_mail_flux_reguli()', true, false), ('public.fn_red_mail_evenimente_reguli()', true, false),
      ('public.fn_red_mail_adrese_reguli()', true, false), ('public.fn_red_mail_oauth_state_reguli()', true, false),
      ('public.fn_red_mail_setari_reguli()', true, false), ('public.fn_red_mail_proiect_retentie()', true, false)
    ) AS b(fn, definer, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn) AND p.prosecdef = r.definer
                    AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres')
       OR has_function_privilege('anon', r.fn, 'EXECUTE') OR has_function_privilege('service_role', r.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', r.fn, 'EXECUTE') IS DISTINCT FROM r.exec_auth
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure(r.fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION '20261130k post: % are setari / EXECUTE gresite', r.fn;
    END IF;
  END LOOP;
  -- triggerele: exact cele noi (nume, tabel, funcție, tip, activ); constraint trigger-ul amânat
  FOR r IN SELECT * FROM (VALUES
      ('red_raspunsuri', 'trg_red_raspunsuri_mail_sursa', 'public.fn_red_mail_raspuns_sursa_ceruta()', 5),
      ('red_raspunsuri', 'trg_red_raspunsuri_zz_mail', 'public.fn_red_mail_raspuns_protejat()', 19),
      ('red_mail_raspuns_sursa', 'trg_red_mail_sursa_reguli', 'public.fn_red_mail_sursa_reguli()', 31),
      ('red_mail_primite', 'trg_red_mail_primite_reguli', 'public.fn_red_mail_primite_reguli()', 31),
      ('red_mail_obiecte', 'trg_red_mail_obiecte_reguli', 'public.fn_red_mail_obiecte_reguli()', 31),
      ('red_mail_dedup', 'trg_red_mail_dedup_reguli', 'public.fn_red_mail_dedup_reguli()', 31),
      ('red_mail_flux', 'trg_red_mail_flux_reguli', 'public.fn_red_mail_flux_reguli()', 31),
      ('red_mail_evenimente', 'trg_red_mail_evenimente_reguli', 'public.fn_red_mail_evenimente_reguli()', 31),
      ('red_mail_evenimente', 'trg_red_mail_evenimente_fara_truncate', 'public.fn_red_jurnal_imuabil()', 34),
      ('red_mail_adrese_propuse', 'trg_red_mail_adrese_reguli', 'public.fn_red_mail_adrese_reguli()', 31),
      ('red_mail_oauth_state', 'trg_red_mail_oauth_state_reguli', 'public.fn_red_mail_oauth_state_reguli()', 31),
      ('red_mail_setari', 'trg_red_mail_setari_reguli', 'public.fn_red_mail_setari_reguli()', 27),
      ('red_mail_setari', 'trg_red_mail_fara_truncate', 'public.fn_red_jurnal_imuabil()', 34),
      ('red_mail_setari', 'trg_red_versiune', 'public.fn_red_versiune_creste()', 19),
      ('red_mail_flux', 'trg_red_versiune', 'public.fn_red_versiune_creste()', 19),
      ('red_mail_primite', 'trg_red_versiune', 'public.fn_red_versiune_creste()', 19),
      ('red_mail_adrese_propuse', 'trg_red_versiune', 'public.fn_red_versiune_creste()', 19),
      ('red_proiecte', 'trg_red_proiecte_retentie_mail', 'public.fn_red_mail_proiect_retentie()', 23)
    ) AS b(t, nume, fn, tip) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || r.t)::regclass AND t.tgname = r.nume AND NOT t.tgisinternal
                    AND t.tgfoid = to_regprocedure(r.fn) AND t.tgtype = r.tip AND t.tgenabled = 'O') THEN
      RAISE EXCEPTION '20261130k post: triggerul %.% nu e cel asteptat', r.t, r.nume;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND tgname = 'trg_red_raspunsuri_mail_sursa' AND tgconstraint <> 0
                  AND tgdeferrable AND tginitdeferred AND tgqual IS NOT NULL)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND NOT tgisinternal) <> 5
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND NOT tgisinternal) <> 3
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_mail_' AND NOT t.tgisinternal) <> 7 + 15 THEN
    RAISE EXCEPTION '20261130k post: numarul / forma triggerelor nu e cea asteptata';
  END IF;
  -- cele 3 rânduri inițiale neatinse
  IF (SELECT versiune FROM public.red_mail_setari WHERE id = 1) <> 1 OR (SELECT count(*) FROM public.red_mail_flux WHERE versiune = 1 AND NOT activ) <> 2 THEN
    RAISE EXCEPTION '20261130k post: randurile initiale au fost atinse';
  END IF;
END $post$;
