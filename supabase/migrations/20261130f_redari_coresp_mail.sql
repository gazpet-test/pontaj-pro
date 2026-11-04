-- Version 20261130125000. Runner supplies one transaction.
-- 20261130f_redari_coresp_mail — Redări Corespondență: „📧 Pregătește mailul” (deciziile lui Răzvan 04.11.2026; r2 după review Jakarinos + Copilot r1).
-- Ce face: pe un rând APROBAT de owner, cu fișier de_trimis aprobat, admin / editor pe Redări pot cere platformei un mail INTERN către expeditor
-- (o adresă @gazpet.ro), CC office@gazpet.ro, cu adresa instituției, subiectul, textul și PDF-ul aprobat atașat. Expeditorul îl copiază într-un mail
-- nou și îl trimite el. Platforma NU trimite nimic în afara firmei (destinatarul mailului intern e verificat @gazpet.ro în BD și în edge).
--   • Coloane noi pe red_corespondenta: destinatar_email (adresa instituției, CHECK de formă), mail_subiect (un rând, ≤300), mail_text (≤20000),
--     expeditor_email (CHECK: doar @gazpet.ro). Toate patru intră în CONȚINUTUL aprobat: schimbarea lor după aprobare face aprobarea să cadă
--     (fn_red_corespondenta_reguli, singura modificare față de 20261130e = tuplul v_continut, marcat „20261130f”).
--   • Tabel nou red_corespondenta_mailuri = urma INTENȚIILOR (r2, J-P2-2 / C-P2-01): un rând = o intenție de mail (intentie_id UUID generat de UI la
--     primul click, UNIQUE), cu amprenta payload-ului semantic. Fără DELETE / INSERT / UPDATE direct. Tranziții (trigger): in_curs → trimis / eroare /
--     necunoscut; necunoscut / in_curs → in_curs DOAR ca reluare a aceleiași intenții (reluari + 1, max 5) — aceeași cheie de idempotență la Resend.
--   • fn_red_coresp_mail_incepe(corespondenta_id, intentie_id, versiune_confirmata, fisier_id_confirmat): SECURITY DEFINER, apelat de edge-ul
--     redari-coresp-mail cu JWT-ul UTILIZATORULUI (nu service_role). Ordinea blocărilor (L06): advisory pe proiect → rândul red_corespondenta
--     FOR UPDATE → rândul intenției FOR UPDATE (dacă există) → INSERT / UPDATE în urmă (FK: KEY SHARE pe părinți). Verifică: auth.uid(), nivel
--     admin/editor, versiunea și fișierul VĂZUTE de utilizator = cele curente (J-P2-3), rând aprobat, fișierul = de_trimis al rândului, PDF, eTag-ul
--     curent din storage.objects = aprobat_storage_etag, câmpurile mailului complete, expeditor @gazpet.ro. Intenție nouă: fereastra de 60 s pe rând
--     pe TOATE încercările, indiferent de stare (J-P2-1), plafonul de 20 de intenții / zi (Europe/Bucharest) / proiect. Intenție existentă: aceeași
--     amprentă → reluare (sau „deja trimis”), altă amprentă / alt autor → refuz.
--   • fn_red_coresp_mail_inchide(uuid, text, text, text): închide intenția proprie din in_curs; un rând `trimis` nu se mai retrogradează (întoarce 'trimis').
--   • fn_red_coresp_mail_verifica_baza(text): amprenta L15 a obiectelor de care depinde migrarea (J-P2-4), folosită în preflight, postcondiție și DRY.
-- fn_red_corespondenta_reguli() se înlocuiește (CREATE OR REPLACE); garda de start cere EXACT versiunea din 20261130e (md5 pe corp, citit live
-- 04.11.2026: 0705e04f3e26656c2116b6d1b9f87c6e) + aceleași setări / ACL / triggere ca live, iar revenirea o readuce textual.
-- Revenire: supabase/revenire/20261130f_redari_coresp_mail_ROLLBACK.sql (NU șterge: tabelul de urmă și valorile coloanelor noi merg în schema
-- redari_retras_<data>). DRY: supabase/tests/20261130f_redari_coresp_mail_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130f_redari_coresp_mail:' || txid_current() THEN
    RAISE EXCEPTION '20261130f: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL THEN RAISE EXCEPTION '20261130f: tabelul exista deja'; END IF;
  IF to_regclass('public.red_corespondenta') IS NULL OR to_regclass('public.red_corespondenta_fisiere') IS NULL OR to_regclass('public.red_proiecte') IS NULL
     OR to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_jurnal()') IS NULL OR to_regprocedure('public.fn_red_versiune_creste()') IS NULL THEN
    RAISE EXCEPTION '20261130f: lipseste schema Redari (red_corespondenta / red_corespondenta_fisiere / red_proiecte / fn_red_nivel / fn_red_jurnal / fn_red_versiune_creste)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
       AND column_name IN ('aprobat_fisier_id', 'aprobat_sha256', 'aprobat_storage_etag')) <> 3 THEN
    RAISE EXCEPTION '20261130f: 20261130e nu e aplicata (coloanele aprobat_* lipsesc)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
              AND column_name IN ('destinatar_email', 'mail_subiect', 'mail_text', 'expeditor_email')) THEN
    RAISE EXCEPTION '20261130f: coloanele noi exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_coresp_mail_incepe(uuid,uuid,integer,uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_coresp_mail_inchide(uuid,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.fn_red_coresp_mail_inainte()') IS NOT NULL OR to_regprocedure('public.fn_red_coresp_mail_verifica_baza(text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261130f: functiile exista deja';
  END IF;
  IF to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION '20261130f: lipseste storage.objects'; END IF;
END $pre$;

-- Amprenta L15 (r2, J-P2-4) a obiectelor de care depind regulile corespondentei, comparata cu baseline-ul citit live 04.11.2026 (revizuit in PR).
-- Arunca la orice abatere. p_md5_reguli = corpul asteptat al fn_red_corespondenta_reguli (30e in preflight, 30f in postconditie).
--   • fn_red_corespondenta_reguli / fn_red_nivel / fn_red_jurnal / fn_red_versiune_creste: md5(prosrc), limbaj, SECURITY DEFINER (sau nu), proconfig
--     = {search_path=public, pg_temp}, owner postgres, EXECUTE pentru PUBLIC / anon / authenticated exact ca baseline-ul (service_role nu se compara:
--     privilegiile lui implicite difera intre medii);
--   • triggerele de pe red_corespondenta: exact cele 3 nume, fiecare cu functia exacta (tgfoid), tgenabled = 'O', tgtype (BEFORE/AFTER + evenimente),
--     fara argumente si fara WHEN.
-- SECURITY INVOKER (citeste doar cataloage); fara EXECUTE pentru aplicatie.
CREATE FUNCTION public.fn_red_coresp_mail_verifica_baza(p_md5_reguli text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE r record; v_n integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_corespondenta_reguli()', p_md5_reguli,                       'plpgsql', true,  false),
      ('public.fn_red_nivel()',                '21db8e5d4b69b7f19e571a7087c361ae', 'sql',     true,  true),
      ('public.fn_red_jurnal()',               '27479409c823996f436459089945c789', 'plpgsql', true,  false),
      ('public.fn_red_versiune_creste()',      'e7ab9318de671f0a94c678ee382250db', 'plpgsql', false, false)
    ) AS b(fn, md5_corp, limbaj, definer, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND md5(p.prosrc) = r.md5_corp AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION 'redari baza: % nu mai e cea din baseline (corp / limbaj / SECURITY DEFINER / search_path / owner)', r.fn;
    END IF;
    IF has_function_privilege('anon', r.fn, 'EXECUTE') OR has_function_privilege('authenticated', r.fn, 'EXECUTE') IS DISTINCT FROM r.exec_auth
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure(r.fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'redari baza: % are alt EXECUTE decat baseline-ul (PUBLIC / anon / authenticated)', r.fn;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta'::regclass AND NOT tgisinternal;
  IF v_n <> 3 THEN RAISE EXCEPTION 'redari baza: red_corespondenta are % triggere (asteptat 3)', v_n; END IF;
  FOR r IN SELECT * FROM (VALUES
      ('trg_red_corespondenta_reguli', 'public.fn_red_corespondenta_reguli()', 23),   -- ROW BEFORE INSERT OR UPDATE
      ('trg_red_jurnal',               'public.fn_red_jurnal()',               29),   -- ROW AFTER INSERT OR DELETE OR UPDATE
      ('trg_red_versiune',             'public.fn_red_versiune_creste()',      19)    -- ROW BEFORE UPDATE
    ) AS b(nume, fn, tip) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_corespondenta'::regclass AND t.tgname = r.nume AND NOT t.tgisinternal
                    AND t.tgfoid = to_regprocedure(r.fn) AND t.tgenabled = 'O' AND t.tgtype = r.tip AND t.tgnargs = 0 AND t.tgqual IS NULL) THEN
      RAISE EXCEPTION 'redari baza: triggerul % nu mai e cel din baseline (functie / activ / tip)', r.nume;
    END IF;
  END LOOP;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_mail_verifica_baza(text) FROM PUBLIC, anon, authenticated, service_role;
SELECT public.fn_red_coresp_mail_verifica_baza('0705e04f3e26656c2116b6d1b9f87c6e');   -- preflight: exact starea din 20261130e

-- Coloanele mailului. Regex-urile = aceleasi ca in supabase/functions/_shared/redariCorespMail.mjs (RX_EMAIL / RX_GAZPET); paritatea e testata in DRY.
ALTER TABLE public.red_corespondenta
  ADD COLUMN destinatar_email text CONSTRAINT red_corespondenta_destinatar_email_ck CHECK (destinatar_email IS NULL OR (length(destinatar_email) <= 254
    AND destinatar_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$')),
  ADD COLUMN mail_subiect text CONSTRAINT red_corespondenta_mail_subiect_ck CHECK (mail_subiect IS NULL OR (length(mail_subiect) <= 300
    AND mail_subiect ~ '[^[:space:]]' AND mail_subiect !~ '[\r\n]')),
  ADD COLUMN mail_text text CONSTRAINT red_corespondenta_mail_text_ck CHECK (mail_text IS NULL OR (length(mail_text) <= 20000 AND mail_text ~ '[^[:space:]]')),
  ADD COLUMN expeditor_email text CONSTRAINT red_corespondenta_expeditor_email_ck CHECK (expeditor_email IS NULL OR (length(expeditor_email) <= 254
    AND lower(expeditor_email) ~ '^[a-z0-9._%+-]+@gazpet\.ro$'));
COMMENT ON COLUMN public.red_corespondenta.destinatar_email IS 'Adresa de e-mail a instituției (o copiază expeditorul în mailul lui). Intră în conținutul aprobat.';
COMMENT ON COLUMN public.red_corespondenta.expeditor_email IS 'Cine trimite mailul către instituție: DOAR @gazpet.ro (CHECK). Primește mailul intern „Pregătește mailul”. Intră în conținutul aprobat.';

-- Urma intentiilor de mail intern. Un rand = o intentie (intentie_id de la UI, UNIQUE). Fara DELETE, fara INSERT / UPDATE direct.
CREATE TABLE public.red_corespondenta_mailuri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intentie_id uuid NOT NULL CONSTRAINT red_corespondenta_mailuri_intentie_uq UNIQUE,
  corespondenta_id uuid NOT NULL CONSTRAINT red_corespondenta_mailuri_coresp_fk REFERENCES public.red_corespondenta(id),
  proiect_id uuid NOT NULL CONSTRAINT red_corespondenta_mailuri_proiect_fk REFERENCES public.red_proiecte(id),
  fisier_id uuid NOT NULL CONSTRAINT red_corespondenta_mailuri_fisier_fk REFERENCES public.red_corespondenta_fisiere(id),
  versiune_confirmata integer NOT NULL,
  fisier_etag text NOT NULL CHECK (length(fisier_etag) BETWEEN 1 AND 200),
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  catre text NOT NULL CHECK (length(catre) <= 254 AND lower(catre) ~ '^[a-z0-9._%+-]+@gazpet\.ro$'),
  cc text NOT NULL CHECK (cc = 'office@gazpet.ro'),
  subiect text NOT NULL CHECK (length(subiect) BETWEEN 1 AND 300),
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'trimis', 'eroare', 'necunoscut')),
  reluari integer NOT NULL DEFAULT 0 CHECK (reluari BETWEEN 0 AND 5),
  resend_id text CHECK (resend_id IS NULL OR length(resend_id) <= 200),
  eroare text CHECK (eroare IS NULL OR length(eroare) <= 500),
  pregatit_de_nume text CHECK (pregatit_de_nume IS NULL OR length(pregatit_de_nume) <= 200),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalizat_la timestamptz,
  CONSTRAINT red_corespondenta_mailuri_final_ck CHECK ((stare = 'in_curs') = (finalizat_la IS NULL)),
  CONSTRAINT red_corespondenta_mailuri_trimis_ck CHECK (stare <> 'trimis' OR resend_id IS NOT NULL)
);
CREATE INDEX idx_red_corespondenta_mailuri_coresp ON public.red_corespondenta_mailuri (corespondenta_id, created_at DESC);
CREATE INDEX idx_red_corespondenta_mailuri_proiect ON public.red_corespondenta_mailuri (proiect_id, created_at DESC, id DESC);
COMMENT ON TABLE public.red_corespondenta_mailuri IS 'Redări: urma mailurilor INTERNE „Pregătește mailul” (către expeditorul @gazpet.ro, CC office@). Un rând = o INTENȚIE (intentie_id de la UI, '
  'UNIQUE; = Idempotency-Key la Resend), cu amprenta payload-ului semantic. Se scrie doar prin fn_red_coresp_mail_incepe și se închide prin fn_red_coresp_mail_inchide. '
  'Tranziții: in_curs → trimis / eroare / necunoscut; necunoscut / in_curs → in_curs doar ca reluare a aceleiași intenții (reluari + 1, max 5). Fără DELETE. '
  'in_curs rămas deschis = edge-ul nu a apucat să închidă (necunoscut). Platforma nu trimite nimic în afara firmei.';

-- BEFORE INSERT / UPDATE / DELETE pe urma: autorul / data / starea initiala le pune serverul; UPDATE doar pe tranzitiile permise; DELETE refuzat.
-- SECURITY DEFINER: citeste profiles.name pentru „pregatit de” indiferent de RLS-ul apelantului.
CREATE FUNCTION public.fn_red_coresp_mail_inainte() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'redari: urma mailurilor nu se sterge' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari: mailul se pregateste doar de un utilizator autentificat' USING ERRCODE = '42501'; END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := clock_timestamp();
    NEW.stare := 'in_curs'; NEW.reluari := 0; NEW.finalizat_la := NULL; NEW.resend_id := NULL; NEW.eroare := NULL;
    NEW.pregatit_de_nume := (SELECT left(p.name, 200) FROM public.profiles p WHERE p.id = auth.uid());
    RETURN NEW;
  END IF;
  -- UPDATE: campurile intentiei sunt imutabile; se schimba doar starea (si rezultatul ei)
  IF (NEW.id, NEW.intentie_id, NEW.corespondenta_id, NEW.proiect_id, NEW.fisier_id, NEW.versiune_confirmata, NEW.fisier_etag, NEW.amprenta, NEW.catre, NEW.cc,
      NEW.subiect, NEW.pregatit_de_nume, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.intentie_id, OLD.corespondenta_id, OLD.proiect_id, OLD.fisier_id, OLD.versiune_confirmata, OLD.fisier_etag, OLD.amprenta, OLD.catre, OLD.cc,
      OLD.subiect, OLD.pregatit_de_nume, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'redari: urma mailurilor e imutabila (se schimba doar starea)' USING ERRCODE = '23514';
  END IF;
  IF OLD.stare = 'in_curs' AND NEW.stare IN ('trimis', 'eroare', 'necunoscut') AND NEW.reluari = OLD.reluari THEN
    NEW.finalizat_la := clock_timestamp();
  ELSIF OLD.stare IN ('in_curs', 'necunoscut') AND NEW.stare = 'in_curs' AND NEW.reluari = OLD.reluari + 1 THEN
    NEW.finalizat_la := NULL; NEW.resend_id := NULL; NEW.eroare := NULL;   -- reluarea aceleiasi intentii (aceeasi cheie de idempotenta)
  ELSE
    RAISE EXCEPTION 'redari: tranzitie nepermisa pe urma mailurilor (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_mail_inainte() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_coresp_mail_inainte BEFORE INSERT OR UPDATE OR DELETE ON public.red_corespondenta_mailuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_coresp_mail_inainte();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_corespondenta_mailuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- Inceputul (sau reluarea) unei intentii: toate verificarile + randul de urma, intr-o singura tranzactie (L01 / L02 / L04). Apelat de edge cu JWT-ul utilizatorului.
-- Ordinea blocarilor (L06): pg_advisory_xact_lock(proiect) → red_corespondenta FOR UPDATE (acelasi rand pe care il blocheaza si urcarea de fisiere /
-- aprobarea) → red_corespondenta_mailuri FOR UPDATE pe intentie (daca exista) → INSERT / UPDATE in urma (FK: FOR KEY SHARE pe parinti).
-- Raspuns: mod = 'nou' | 'reluare' (trimite cu aceeasi cheie) | 'deja_trimis' (NU retrimite).
-- Erorile de business: 42501 (drept), 23514 (stare / date / versiune / intentie / fereastra / plafon), P0002 (rand inexistent / invizibil, mesaj generic).
CREATE FUNCTION public.fn_red_coresp_mail_incepe(p_corespondenta_id uuid, p_intentie_id uuid, p_versiune_confirmata integer, p_fisier_id_confirmat uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_nivel text; v_proiect uuid; c public.red_corespondenta%ROWTYPE; v_proiect_cod text; m public.red_corespondenta_mailuri%ROWTYPE;
        f public.red_corespondenta_fisiere%ROWTYPE; v_etag text; v_ultim timestamptz; v_n integer; v_zi timestamptz; v_amprenta text; v_mod text; v_aprobat_de text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'redari: autentificare lipsa' USING ERRCODE = '42501'; END IF;
  v_nivel := public.fn_red_nivel();
  IF v_nivel IS NULL OR v_nivel NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: doar admin / editor pe Redari pregatesc mailul' USING ERRCODE = '42501';
  END IF;
  IF p_intentie_id IS NULL OR p_versiune_confirmata IS NULL OR p_fisier_id_confirmat IS NULL THEN
    RAISE EXCEPTION 'redari: lipsesc intentia, versiunea sau fisierul confirmat; reincarca' USING ERRCODE = '23514';
  END IF;
  SELECT proiect_id INTO v_proiect FROM public.red_corespondenta WHERE id = p_corespondenta_id;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'redari: corespondenta nu exista' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('red_coresp_mail:' || v_proiect::text, 0));
  SELECT * INTO c FROM public.red_corespondenta WHERE id = p_corespondenta_id FOR UPDATE;
  IF NOT FOUND OR c.proiect_id IS DISTINCT FROM v_proiect THEN RAISE EXCEPTION 'redari: corespondenta nu exista' USING ERRCODE = 'P0002'; END IF;
  -- r2 (J-P2-3): click-ul confirma ce a vazut utilizatorul; orice schimbare intre timp (versiune / fisier aprobat) = refuz
  IF c.versiune IS DISTINCT FROM p_versiune_confirmata OR c.aprobat_fisier_id IS DISTINCT FROM p_fisier_id_confirmat THEN
    RAISE EXCEPTION 'redari: randul s-a schimbat intre timp; reincarca si verifica' USING ERRCODE = '23514';
  END IF;
  IF c.stare IS DISTINCT FROM 'aprobat' OR c.aprobat_la IS NULL OR c.aprobat_fisier_id IS NULL OR c.aprobat_storage_etag IS NULL THEN
    RAISE EXCEPTION 'redari: mailul se pregateste doar pentru un rand aprobat de owner, cu fisier de trimis aprobat' USING ERRCODE = '23514';
  END IF;
  IF c.expeditor_email IS NULL OR lower(c.expeditor_email) !~ '^[a-z0-9._%+-]+@gazpet\.ro$' THEN
    RAISE EXCEPTION 'redari: expeditorul mailului trebuie sa aiba o adresa @gazpet.ro' USING ERRCODE = '23514';
  END IF;
  IF c.destinatar_email IS NULL OR c.mail_subiect IS NULL OR c.mail_text IS NULL THEN
    RAISE EXCEPTION 'redari: completeaza e-mailul institutiei, subiectul si textul mailului (cere o noua aprobare)' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO f FROM public.red_corespondenta_fisiere WHERE id = c.aprobat_fisier_id AND corespondenta_id = c.id AND rol = 'de_trimis';
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: fisierul aprobat nu e fisierul de trimis al randului' USING ERRCODE = '23514'; END IF;
  IF lower(f.path) !~ '\.pdf$' THEN RAISE EXCEPTION 'redari: fisierul aprobat nu e PDF' USING ERRCODE = '23514'; END IF;
  SELECT left(btrim(o.metadata ->> 'eTag'), 200) INTO v_etag FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = f.path;
  IF v_etag IS NULL OR v_etag IS DISTINCT FROM c.aprobat_storage_etag THEN
    RAISE EXCEPTION 'redari: fisierul aprobat s-a schimbat sau lipseste din Storage; mailul nu se pregateste' USING ERRCODE = '23514';
  END IF;
  -- amprenta payload-ului semantic al intentiei (L04): rand, versiune, fisier, eTag, destinatar intern, adresa institutiei, subiect, text
  v_amprenta := md5(jsonb_build_array(c.id, c.versiune, f.id, v_etag, lower(c.expeditor_email), c.destinatar_email, c.mail_subiect, c.mail_text)::text);
  SELECT * INTO m FROM public.red_corespondenta_mailuri WHERE intentie_id = p_intentie_id FOR UPDATE;
  IF FOUND THEN
    -- intentie existenta: doar autorul ei, pe acelasi rand, cu acelasi payload
    IF m.created_by IS DISTINCT FROM v_uid OR m.corespondenta_id IS DISTINCT FROM c.id OR m.amprenta IS DISTINCT FROM v_amprenta THEN
      RAISE EXCEPTION 'redari: aceeasi intentie cu alt continut (sau alt autor); pregateste un mail nou' USING ERRCODE = '23514';
    END IF;
    IF m.stare = 'trimis' THEN
      v_mod := 'deja_trimis';
    ELSIF m.stare = 'eroare' THEN
      RAISE EXCEPTION 'redari: incercarea a esuat definitiv; pregateste un mail nou' USING ERRCODE = '23514';
    ELSIF m.created_at < clock_timestamp() - interval '23 hours' THEN
      RAISE EXCEPTION 'redari: incercarea e mai veche de 23 h (cheia de idempotenta expira); verifica inboxul si pregateste un mail nou' USING ERRCODE = '23514';
    ELSIF m.reluari >= 5 THEN
      RAISE EXCEPTION 'redari: prea multe reluari ale aceleiasi incercari; verifica inboxul' USING ERRCODE = '23514';
    ELSE
      UPDATE public.red_corespondenta_mailuri SET stare = 'in_curs', reluari = reluari + 1 WHERE id = m.id RETURNING * INTO m;
      v_mod := 'reluare';
    END IF;
  ELSE
    -- r2 (J-P2-1): fereastra de 60 s pe rand, pe TOATE intentiile, indiferent de stare (o eroare inchisa de apelant nu deblocheaza)
    SELECT max(x.created_at) INTO v_ultim FROM public.red_corespondenta_mailuri x
     WHERE x.corespondenta_id = c.id AND x.created_at > clock_timestamp() - interval '60 seconds';
    IF v_ultim IS NOT NULL THEN
      RAISE EXCEPTION 'redari: mailul a fost deja pregatit acum % s; asteapta un minut', greatest(0, floor(extract(epoch FROM clock_timestamp() - v_ultim)))::int
        USING ERRCODE = '23514';
    END IF;
    -- plafonul: 20 de intentii (orice stare) pe zi calendaristica Europe/Bucharest, pe proiect
    v_zi := date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest';
    SELECT count(*) INTO v_n FROM public.red_corespondenta_mailuri x WHERE x.proiect_id = c.proiect_id AND x.created_at >= v_zi;
    IF v_n >= 20 THEN RAISE EXCEPTION 'redari: plafonul de 20 de mailuri pregatite pe zi pe proiect a fost atins' USING ERRCODE = '23514'; END IF;
    INSERT INTO public.red_corespondenta_mailuri (intentie_id, corespondenta_id, proiect_id, fisier_id, versiune_confirmata, fisier_etag, amprenta, catre, cc, subiect, created_by)
    VALUES (p_intentie_id, c.id, c.proiect_id, f.id, c.versiune, v_etag, v_amprenta, lower(c.expeditor_email), 'office@gazpet.ro', left(c.mail_subiect, 300), v_uid)
    RETURNING * INTO m;
    v_mod := 'nou';
  END IF;
  SELECT p.cod INTO v_proiect_cod FROM public.red_proiecte p WHERE p.id = c.proiect_id;
  SELECT left(p.name, 200) INTO v_aprobat_de FROM public.profiles p WHERE p.id = c.aprobat_de;
  RETURN jsonb_build_object('mod', v_mod, 'mail_id', m.id, 'intentie_id', m.intentie_id, 'reluari', m.reluari, 'resend_id', m.resend_id,
    'corespondenta_id', c.id, 'cod', c.cod, 'proiect_cod', v_proiect_cod, 'destinatar', c.destinatar,
    'destinatar_email', c.destinatar_email, 'mail_subiect', c.mail_subiect, 'mail_text', c.mail_text, 'expeditor_email', m.catre,
    'cc', m.cc, 'aprobat_la', c.aprobat_la, 'aprobat_de_nume', v_aprobat_de, 'pregatit_de_nume', m.pregatit_de_nume,
    'fisier', jsonb_build_object('id', f.id, 'path', f.path, 'nume_original', f.nume_original, 'marime', f.marime, 'etag', v_etag));
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_mail_incepe(uuid, uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_coresp_mail_incepe(uuid, uuid, integer, uuid) TO authenticated;

-- Inchiderea intentiei proprii. Din in_curs → trimis / eroare / necunoscut. Un rand deja `trimis` NU se retrogradeaza: intoarce 'trimis' fara schimbare
-- (doua reluari concurente cu aceeasi cheie: prima confirma, a doua nu strica). Intoarce starea finala a randului.
CREATE FUNCTION public.fn_red_coresp_mail_inchide(p_mail_id uuid, p_stare text, p_resend_id text, p_eroare text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := auth.uid(); v_nivel text; v_stare text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'redari: autentificare lipsa' USING ERRCODE = '42501'; END IF;
  v_nivel := public.fn_red_nivel();
  IF v_nivel IS NULL OR v_nivel NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: doar admin / editor pe Redari pregatesc mailul' USING ERRCODE = '42501'; END IF;
  IF p_stare IS NULL OR p_stare NOT IN ('trimis', 'eroare', 'necunoscut') THEN RAISE EXCEPTION 'redari: stare de inchidere invalida' USING ERRCODE = '23514'; END IF;
  IF p_stare = 'trimis' AND nullif(btrim(p_resend_id), '') IS NULL THEN RAISE EXCEPTION 'redari: trimis fara id Resend' USING ERRCODE = '23514'; END IF;
  SELECT stare INTO v_stare FROM public.red_corespondenta_mailuri WHERE id = p_mail_id AND created_by = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: incercarea de mail nu exista sau nu e a ta' USING ERRCODE = '23514'; END IF;
  IF v_stare = 'trimis' THEN RETURN 'trimis'; END IF;
  IF v_stare <> 'in_curs' THEN RAISE EXCEPTION 'redari: incercarea de mail e deja inchisa (%)', v_stare USING ERRCODE = '23514'; END IF;
  UPDATE public.red_corespondenta_mailuri SET stare = p_stare, resend_id = left(nullif(btrim(p_resend_id), ''), 200), eroare = left(nullif(btrim(p_eroare), ''), 500)
   WHERE id = p_mail_id;
  RETURN p_stare;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_mail_inchide(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_coresp_mail_inchide(uuid, text, text, text) TO authenticated;

-- Regulile corespondentei: logica din 20261130e NESCHIMBATA + cele 4 campuri ale mailului in continutul aprobat (marcat „20261130f”).
CREATE OR REPLACE FUNCTION public.fn_red_corespondenta_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_owner boolean; v_mentenanta boolean; v_era_aprobat boolean; v_continut boolean;
        v_cerut uuid; v_fis_id uuid; v_fis_sha text; v_fis_etag text;
BEGIN
  -- Jakarinos r1 P1-02: mentenanta = sesiune SQL directa ca postgres (session_user nu se schimba in SECURITY DEFINER; PostgREST are session_user
  -- „authenticator”) si FARA claims JWT. service_role / anon / authenticated prin API nu sunt mentenanta.
  v_mentenanta := session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
  v_owner := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner);
  v_cerut := NEW.aprobat_fisier_id;   -- 20261130e: fisierul confirmat de owner (folosit DOAR la trecerea in aprobat, altfel ignorat)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.proiect_id IS DISTINCT FROM OLD.proiect_id OR NEW.cod IS DISTINCT FROM OLD.cod OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'redari: proiectul, codul si autorul unei corespondente nu se schimba' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;   -- le pune doar triggerul
    NEW.aprobat_fisier_id := OLD.aprobat_fisier_id; NEW.aprobat_sha256 := OLD.aprobat_sha256; NEW.aprobat_storage_etag := OLD.aprobat_storage_etag;   -- 20261130e
  ELSE
    -- Jakarinos r1 P2-03: autorul il pune triggerul (din aplicatie nu se poate falsifica)
    IF NOT v_mentenanta THEN NEW.created_by := auth.uid(); END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL; NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  -- Jakarinos r1 P1-01: aprobarea e pe CONTINUT. Daca se schimba destinatarul, ce se trimite, expeditorul sau documentele, aprobarea cade;
  -- cu continut schimbat randul poate ramane doar in draft / la avocat / anulat (altfel ar pleca ceva neaprobat).
  -- 20261130f: e-mailul institutiei, subiectul / textul mailului si e-mailul expeditorului fac parte din continutul aprobat
  v_continut := TG_OP = 'UPDATE' AND (NEW.destinatar, NEW.subiect, NEW.expeditor, NEW.documente, NEW.destinatar_email, NEW.mail_subiect, NEW.mail_text, NEW.expeditor_email)
    IS DISTINCT FROM (OLD.destinatar, OLD.subiect, OLD.expeditor, OLD.documente, OLD.destinatar_email, OLD.mail_subiect, OLD.mail_text, OLD.expeditor_email);
  IF v_continut AND OLD.aprobat_la IS NOT NULL THEN
    IF NEW.stare NOT IN ('draft', 'la_avocat', 'anulat') THEN
      RAISE EXCEPTION 'redari: continutul s-a schimbat dupa aprobare; treci randul in draft si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  v_era_aprobat := NEW.aprobat_la IS NOT NULL;
  IF NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat' OR NEW.aprobat_la IS NULL) THEN
    IF NOT (v_owner OR v_mentenanta) THEN RAISE EXCEPTION 'redari: doar Razvan (owner) aproba o corespondenta' USING ERRCODE = '42501'; END IF;
    -- 20261130e: ultimul de_trimis (created_at desc, id desc), citit cu randul parinte deja blocat de acest UPDATE (fn_red_coresp_fisier_inainte
    -- blocheaza acelasi rand la INSERT, deci nu poate aparea un de_trimis nou intre citire si commit). Owner-ul trebuie sa fi confirmat EXACT acest fisier.
    IF TG_OP = 'UPDATE' THEN
      SELECT f.id, f.sha256, f.storage_etag INTO v_fis_id, v_fis_sha, v_fis_etag FROM public.red_corespondenta_fisiere f
       WHERE f.corespondenta_id = NEW.id AND f.rol = 'de_trimis' ORDER BY f.created_at DESC, f.id DESC LIMIT 1;
    END IF;
    IF NOT v_mentenanta THEN
      IF v_fis_id IS NULL THEN RAISE EXCEPTION 'redari: aproba doar dupa ce ai urcat fisierul de trimis' USING ERRCODE = '23514'; END IF;
      IF v_cerut IS NULL THEN RAISE EXCEPTION 'redari: aprobarea trebuie sa indice fisierul de trimis confirmat; reincarca si verifica' USING ERRCODE = '23514'; END IF;
      IF v_cerut IS DISTINCT FROM v_fis_id THEN
        RAISE EXCEPTION 'redari: intre timp s-a urcat alt fisier de trimis; reincarca si verifica' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now(); v_era_aprobat := true;
    NEW.aprobat_fisier_id := v_fis_id; NEW.aprobat_sha256 := v_fis_sha; NEW.aprobat_storage_etag := v_fis_etag;   -- 20261130e
  END IF;
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND NOT v_era_aprobat THEN
    RAISE EXCEPTION 'redari: o corespondenta se marcheaza trimisa doar dupa aprobarea owner-ului' USING ERRCODE = '23514';
  END IF;
  -- 20261130e r3/r4 (Copilot C-P1-01, partea fara edge function): la ORICE schimbare de stare spre trimis / raspuns_primit (inclusiv trimis -> raspuns_primit),
  -- in afara mentenantei, randul trebuie sa aiba fisierul aprobat, iar obiectul lui sa existe in Storage cu ACELASI eTag ca la aprobare.
  -- Singura exceptie: randurile deja trimise istoric fara fisier (D1/D2: OLD in trimis / raspuns_primit cu aprobat_fisier_id NULL) pot trece intre
  -- cele doua stari finale. Un rand `aprobat` dinainte de fisiere (fara aprobat_fisier_id) NU se mai poate marca trimis: cere fisier + o aprobare noua.
  IF NEW.stare IN ('trimis', 'raspuns_primit') AND (TG_OP = 'INSERT' OR NEW.stare IS DISTINCT FROM OLD.stare) AND NOT v_mentenanta
     AND NOT (TG_OP = 'UPDATE' AND OLD.stare IN ('trimis', 'raspuns_primit') AND OLD.aprobat_fisier_id IS NULL) THEN
    IF NEW.aprobat_fisier_id IS NULL THEN
      RAISE EXCEPTION 'redari: aprobarea e dinainte de fisiere: urca PDF-ul de trimis si cere din nou aprobarea' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.red_corespondenta_fisiere f JOIN storage.objects o ON o.bucket_id = 'redari' AND o.name = f.path
                    WHERE f.id = NEW.aprobat_fisier_id AND left(btrim(o.metadata ->> 'eTag'), 200) = NEW.aprobat_storage_etag) THEN
      RAISE EXCEPTION 'redari: fisierul aprobat s-a schimbat sau lipseste din Storage; nu se poate marca trimis' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- revenirea din aprobat/trimis la draft/la_avocat sterge aprobarea (alt „da” la urmatoarea trimitere)
  IF NEW.stare IN ('draft', 'la_avocat') THEN
    NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_fisier_id := NULL; NEW.aprobat_sha256 := NULL; NEW.aprobat_storage_etag := NULL;   -- 20261130e
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_corespondenta_reguli() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.red_corespondenta_mailuri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_corespondenta_mailuri FROM PUBLIC, anon, authenticated, service_role;   -- privilegiile implicite Supabase dau ALL pe tabelele noi
GRANT SELECT ON public.red_corespondenta_mailuri TO authenticated, service_role;
CREATE POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);

DO $post$
BEGIN
  -- baseline L15 dupa inlocuire: corpul 30f al regulilor, restul neschimbat
  PERFORM public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5');
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_corespondenta_mailuri') <> 1 THEN RAISE EXCEPTION '20261130f: politici'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_corespondenta_mailuri'::regclass) THEN RAISE EXCEPTION '20261130f: RLS oprit'; END IF;
  IF has_table_privilege('anon', 'public.red_corespondenta_mailuri', 'SELECT')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr
                 WHERE has_table_privilege(r, 'public.red_corespondenta_mailuri', pr))
     OR NOT has_table_privilege('authenticated', 'public.red_corespondenta_mailuri', 'SELECT') THEN
    RAISE EXCEPTION '20261130f: drepturi gresite pe red_corespondenta_mailuri';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.fn_red_coresp_mail_inainte()', 'public.fn_red_coresp_mail_incepe(uuid,uuid,integer,uuid)',
                                        'public.fn_red_coresp_mail_inchide(uuid,text,text,text)']) fn
              WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn::regprocedure AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']
                                  AND pg_get_userbyid(proowner) = 'postgres')
                 OR has_function_privilege('anon', fn, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261130f: functiile au setari gresite';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_red_coresp_mail_inainte()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_red_coresp_mail_verifica_baza(text)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_coresp_mail_verifica_baza(text)'::regprocedure)
     OR NOT has_function_privilege('authenticated', 'public.fn_red_coresp_mail_incepe(uuid,uuid,integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_coresp_mail_inchide(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130f: EXECUTE gresit pe functii';
  END IF;
  IF (SELECT prosrc NOT LIKE '%NEW.destinatar_email, NEW.mail_subiect, NEW.mail_text, NEW.expeditor_email%' OR prosrc NOT LIKE '%fisierul aprobat s-a schimbat sau lipseste%'
        FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure) THEN
    RAISE EXCEPTION '20261130f: functia de reguli nu a fost inlocuita';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta_mailuri'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '20261130f: triggere pe urma';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.red_corespondenta'::regclass AND conname IN ('red_corespondenta_destinatar_email_ck',
       'red_corespondenta_mail_subiect_ck', 'red_corespondenta_mail_text_ck', 'red_corespondenta_expeditor_email_ck')) <> 4 THEN
    RAISE EXCEPTION '20261130f: CHECK-urile coloanelor noi lipsesc';
  END IF;
END $post$;
