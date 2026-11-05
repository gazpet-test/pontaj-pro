-- Version 20261130150000. Runner supplies one transaction.
-- 20261130m_redari_autorizare_tgz — Redări: autorizarea scrisă Transgaz (art. 28 alin. (2) GDPR) pe proiect; deblochează informarea GDPR (#939).
-- Decizia lui Răzvan, 05.11.2026: informarea completă (pagina /redari/informare + versoul convocatorului) se deblochează AUTOMAT când owner-ul
-- încarcă autorizarea Transgaz în ⚙️ Setări proiect (nr. + dată + PDF). Fără document nu există deblocare manuală.
-- Ce face:
--   • red_proiecte: autorizare_tgz_nr (text), autorizare_tgz_data (date), autorizare_tgz_fisier (calea PDF-ului în bucket-ul `redari`),
--     autorizare_tgz_obiect (uuid = storage.objects.id al PDF-ului legat), autorizare_tgz_etag (eTag-ul conținutului, din metadata Storage),
--     autorizare_tgz_de (uuid) + autorizare_tgz_la (timestamptz). _obiect / _etag / _de / _la le scrie DOAR serverul.
--     r4 (Copilot r2 P1-03): id-ul rândului nu dovedește conținutul; eTag-ul legat la salvare trebuie să fie același la fiecare verificare,
--     deci un conținut rescris pe loc (upsert / update) nu mai publică. Politicile storage nu permit oricum UPDATE / DELETE pe bucket-ul redari.
--   • CHECK de formă pe cale: `<cod proiect>/autorizare_tgz/<nume>.pdf` (fără „..”, fără subfoldere).
--   • trg_red_autorizare_tgz (BEFORE INSERT OR UPDATE pe red_proiecte):
--       - nr / dată / PDF le schimbă DOAR owner-ul (profiles.is_owner, fn_sms_e_owner);
--       - PDF-ul trebuie să existe în storage.objects (bucket redari), sub codul proiectului, ÎNCĂRCAT DE ACEST OWNER (owner_id = auth.uid());
--         serverul leagă autorizarea de obiectul exact (autorizare_tgz_obiect = id-ul lui) — r2 Jakarinos P1-2: un PDF urcat de altcineva
--         nu se poate lega, iar un fișier înlocuit la aceeași cale (alt id) NU mai publică;
--       - codul proiectului nu se schimbă cât există o autorizare (r2 Jakarinos P1-1: altfel autorizarea s-ar „muta” pe alt cod).
--     Mentenanța (sesiune SQL directă ca postgres, fără claims JWT) trece, ca la 20261130h.
--   • fn_red_informare_publicata(cod) → boolean: proiect activ + nr + dată + PDF sub codul proiectului + obiectul LEGAT încă există la aceeași cale,
--     cu același eTag.
--     Singura informație expusă public (anon): da / nu. Pagina publică /redari/informare o folosește pentru banda „PROIECT” + noindex.
--   • trg_red_convocari_informare (BEFORE INSERT OR UPDATE pe red_convocari) — r2 Jakarinos P1-3 / Copilot P1-03, garda în BD: o convocare POȘTALĂ
--     nouă, orice fișier / hash nou al ei și marcarea expedierii (data_expediere NULL -> dată) cer informarea publicată pe proiect (convocatorul
--     poștal tipărește informarea pe verso). Anularea, AR-ul, retururile, tracking-ul nu sunt atinse. Celelalte canale nu sunt atinse.
--     La 05.11.2026 existau 3 convocări poștale, toate pe TEST-RAZVAN, neexpediate. r4 (Copilot r2 P1-02): garda ia FOR SHARE pe rândul proiectului
--     ÎNAINTE de verificare, deci o revocare concurentă (UPDATE pe proiect) și o expediere se serializează (ordinea lock-urilor: red_convocari, apoi
--     red_proiecte — aceeași ordine o folosește și migrarea / revenirea).
-- Politicile, privilegiile (authenticated are drepturi la nivel de tabel pe red_proiecte, deci și pe coloanele noi; RLS = fn_red_nivel() = 'admin'
-- la UPDATE), politicile storage (red_storage_ins rămâne: admin / editor pot urca în bucket; legarea cere însă PDF-ul urcat de owner) și jurnalul
-- (fn_red_jurnal) NU se ating.
-- Revenire: supabase/revenire/20261130m_redari_autorizare_tgz_ROLLBACK.sql. DRY: supabase/tests/20261130m_redari_autorizare_tgz_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130m_redari_autorizare_tgz:' || txid_current() THEN
    RAISE EXCEPTION '20261130m: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_convocari') IS NULL OR to_regclass('public.red_detinatori') IS NULL
     OR to_regclass('public.red_parcele') IS NULL OR to_regprocedure('public.fn_sms_e_owner()') IS NULL THEN
    RAISE EXCEPTION '20261130m: lipseste schema Redari / SMS (red_proiecte / red_convocari / red_detinatori / red_parcele / fn_sms_e_owner)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%') THEN
    RAISE EXCEPTION '20261130m: coloanele autorizare_tgz_* exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_autorizare_tgz_garda()') IS NOT NULL OR to_regprocedure('public.fn_red_informare_publicata(text)') IS NOT NULL
     OR to_regprocedure('public.fn_red_convocari_informare_garda()') IS NOT NULL THEN
    RAISE EXCEPTION '20261130m: functiile exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari') THEN RAISE EXCEPTION '20261130m: lipseste bucket-ul redari'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.red_proiecte', 'UPDATE') OR has_table_privilege('anon', 'public.red_proiecte', 'SELECT') THEN
    RAISE EXCEPTION '20261130m: privilegiile pe red_proiecte nu mai sunt cele din 20261126a';
  END IF;
  -- r2 (Jakarinos P2-5, L15): amprenta portii de owner (singura poarta a triggerului) + a lui auth.uid(); baseline citit read-only pe live 05.11.2026.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'public.fn_sms_e_owner()'::regprocedure AND g.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND md5(p.prosrc) = '4ea29d605a2a8b491594f9d43da7385c') THEN
    RAISE EXCEPTION '20261130m: fn_sms_e_owner() nu mai are amprenta revizuita (SQL / DEFINER / STABLE / () -> boolean / search_path / owner / corp)';
  END IF;
  IF (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_sms_e_owner()'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130m: ACL-ul lui fn_sms_e_owner() nu e cel revizuit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'auth.uid()'::regprocedure AND g.lanname = 'sql' AND NOT p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'uuid'::regtype AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49') THEN
    RAISE EXCEPTION '20261130m: auth.uid() nu mai are amprenta revizuita';
  END IF;
  -- r3 (Jakarinos r2 P2-2, L15): triggerele existente pe red_proiecte / red_convocari / storage.objects = exact cele revizuite
  -- (nume, activare, tip, functie, conditie WHEN); baseline citit read-only pe live 05.11.2026
  IF (SELECT md5(string_agg(t.tgname || '|' || t.tgenabled::text || '|' || t.tgtype::text || '|' || t.tgfoid::regprocedure::text || '|' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), ''), E'\n' ORDER BY t.tgname))
        FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM '7c38249f4202bd6ce16605a394565d97' THEN
    RAISE EXCEPTION '20261130m: triggerele de pe red_proiecte nu sunt cele revizuite';
  END IF;
  IF (SELECT md5(string_agg(t.tgname || '|' || t.tgenabled::text || '|' || t.tgtype::text || '|' || t.tgfoid::regprocedure::text || '|' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), ''), E'\n' ORDER BY t.tgname))
        FROM pg_trigger t WHERE t.tgrelid = 'public.red_convocari'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM '2d4f1baef2ebed5532ab20a98af70b45' THEN
    RAISE EXCEPTION '20261130m: triggerele de pe red_convocari nu sunt cele revizuite';
  END IF;
  IF (SELECT md5(string_agg(t.tgname || '|' || t.tgenabled::text || '|' || t.tgtype::text || '|' || t.tgfoid::regprocedure::text, E'\n' ORDER BY t.tgname))
        FROM pg_trigger t WHERE t.tgrelid = 'storage.objects'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM '5affd4b1d5b2be31d40fe6c81fabac52' THEN
    RAISE EXCEPTION '20261130m: triggerele de pe storage.objects nu sunt cele revizuite';
  END IF;
  -- r3 (Jakarinos r2 P2-2): TOATE politicile de pe storage.objects (nu doar cele care pomenesc bucket-ul): o politica globala permisiva ar
  -- acoperi si obiectele autorizarii. Legarea PDF-ului se bazeaza pe owner_id pus de Storage la upload si pe id-ul obiectului.
  IF (SELECT md5(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' ORDER BY policyname))
        FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') IS DISTINCT FROM '8fa9339261517543c8a20f97ea4d751b' THEN
    RAISE EXCEPTION '20261130m: politicile de pe storage.objects nu sunt cele revizuite (132 politici, baseline 05.11.2026)';
  END IF;
END $pre$;

-- r4 (Copilot r2 P2-03): ordinea lock-urilor, aceeași ca a gărzii de convocări: întâi red_convocari, apoi red_proiecte (lock_timeout 5s din preflight)
LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.red_proiecte
  ADD COLUMN autorizare_tgz_nr text NULL CONSTRAINT red_proiecte_autorizare_tgz_nr_forma CHECK (autorizare_tgz_nr IS NULL OR length(btrim(autorizare_tgz_nr)) BETWEEN 1 AND 100),
  ADD COLUMN autorizare_tgz_data date NULL,
  ADD COLUMN autorizare_tgz_fisier text NULL CONSTRAINT red_proiecte_autorizare_tgz_fisier_forma
    CHECK (autorizare_tgz_fisier IS NULL OR (length(autorizare_tgz_fisier) <= 300 AND autorizare_tgz_fisier ~ '^[A-Za-z0-9_-]+/autorizare_tgz/[A-Za-z0-9_.-]+[.]pdf$' AND position('..' IN autorizare_tgz_fisier) = 0)),
  ADD COLUMN autorizare_tgz_obiect uuid NULL,
  ADD COLUMN autorizare_tgz_etag text NULL,
  ADD COLUMN autorizare_tgz_de uuid NULL,
  ADD COLUMN autorizare_tgz_la timestamptz NULL;
ALTER TABLE public.red_proiecte ADD CONSTRAINT red_proiecte_autorizare_tgz_obiect_cu_fisier
  CHECK ((autorizare_tgz_fisier IS NULL) = (autorizare_tgz_obiect IS NULL) AND (autorizare_tgz_fisier IS NULL) = (autorizare_tgz_etag IS NULL));
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_nr IS 'Nr. autorizării scrise Transgaz (art. 28 alin. (2) GDPR, sub-împuterniciți). Doar owner-ul (trg_red_autorizare_tgz). 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_data IS 'Data autorizării Transgaz (art. 28). Doar owner-ul. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_fisier IS 'Calea PDF-ului autorizării în bucket-ul redari: <cod>/autorizare_tgz/<nume>.pdf; urcat de owner. Doar owner-ul. Nr + dată + PDF legat = informarea GDPR publicată (fn_red_informare_publicata). 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_obiect IS 'storage.objects.id al PDF-ului legat la salvare; un fișier înlocuit la aceeași cale are alt id și nu mai publică. Scris doar de trg_red_autorizare_tgz. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_etag IS 'eTag-ul conținutului PDF-ului legat la salvare (storage.objects.metadata eTag); un conținut rescris pe loc are alt eTag și nu mai publică. Scris doar de trg_red_autorizare_tgz. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_de IS 'Cine a schimbat ultima dată autorizarea Transgaz (auth.uid()); scris doar de trg_red_autorizare_tgz. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_la IS 'Când s-a schimbat ultima dată autorizarea Transgaz; scris doar de trg_red_autorizare_tgz. 20261130m.';

CREATE FUNCTION public.fn_red_autorizare_tgz_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_jwt boolean := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}') <> '{}';
  v_schimbat boolean;
  v_obiect uuid;
  v_etag text;
BEGIN
  -- mentenanta (sesiune SQL directa ca postgres, fara claims): trece neschimbat, inclusiv _obiect / _de / _la.
  -- session_user, nu current_user: in SECURITY DEFINER current_user e mereu proprietarul functiei.
  IF NOT v_jwt AND session_user = 'postgres' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_schimbat := NEW.autorizare_tgz_nr IS NOT NULL OR NEW.autorizare_tgz_data IS NOT NULL OR NEW.autorizare_tgz_fisier IS NOT NULL;
  ELSE
    -- r2 (Jakarinos P1-1): codul proiectului nu se schimba cat exista o autorizare (s-ar muta pe alt cod), pentru nimeni in afara mentenantei
    IF NEW.cod IS DISTINCT FROM OLD.cod AND (OLD.autorizare_tgz_nr IS NOT NULL OR OLD.autorizare_tgz_data IS NOT NULL OR OLD.autorizare_tgz_fisier IS NOT NULL) THEN
      RAISE EXCEPTION 'red_proiecte: codul proiectului nu se schimba cat exista autorizarea Transgaz (art. 28); owner-ul o goleste intai' USING ERRCODE = '42501';
    END IF;
    v_schimbat := NEW.autorizare_tgz_nr IS DISTINCT FROM OLD.autorizare_tgz_nr OR NEW.autorizare_tgz_data IS DISTINCT FROM OLD.autorizare_tgz_data
               OR NEW.autorizare_tgz_fisier IS DISTINCT FROM OLD.autorizare_tgz_fisier;
  END IF;
  IF NOT v_schimbat THEN
    -- _obiect / _de / _la nu se scriu de mana
    IF TG_OP = 'INSERT' THEN NEW.autorizare_tgz_obiect := NULL; NEW.autorizare_tgz_etag := NULL; NEW.autorizare_tgz_de := NULL; NEW.autorizare_tgz_la := NULL;
    ELSE NEW.autorizare_tgz_obiect := OLD.autorizare_tgz_obiect; NEW.autorizare_tgz_etag := OLD.autorizare_tgz_etag;
         NEW.autorizare_tgz_de := OLD.autorizare_tgz_de; NEW.autorizare_tgz_la := OLD.autorizare_tgz_la; END IF;
    RETURN NEW;
  END IF;
  -- r2 (Copilot P2-01): IS NOT TRUE, ca un NULL sa nu treaca
  IF public.fn_sms_e_owner() IS NOT TRUE THEN
    RAISE EXCEPTION 'red_proiecte: autorizarea Transgaz (art. 28) o schimba doar owner-ul' USING ERRCODE = '42501';
  END IF;
  IF NEW.autorizare_tgz_fisier IS NULL THEN
    NEW.autorizare_tgz_obiect := NULL; NEW.autorizare_tgz_etag := NULL;
  ELSE
    IF split_part(NEW.autorizare_tgz_fisier, '/', 1) IS DISTINCT FROM NEW.cod THEN
      RAISE EXCEPTION 'red_proiecte: PDF-ul autorizarii trebuie sa stea sub codul proiectului (%/autorizare_tgz/...)', NEW.cod USING ERRCODE = '22023';
    END IF;
    -- r2 (Jakarinos P1-2): obiectul trebuie urcat de ACEST owner; autorizarea se leaga de id-ul lui (re-legat la orice schimbare a autorizarii)
    SELECT o.id, nullif(o.metadata->>'eTag', '') INTO v_obiect, v_etag FROM storage.objects o
     WHERE o.bucket_id = 'redari' AND o.name = NEW.autorizare_tgz_fisier AND o.owner_id = auth.uid()::text;
    IF v_obiect IS NULL OR v_etag IS NULL THEN
      RAISE EXCEPTION 'red_proiecte: PDF-ul autorizarii nu exista in storage (bucket redari) sau nu l-a urcat owner-ul care salveaza' USING ERRCODE = '22023';
    END IF;
    NEW.autorizare_tgz_obiect := v_obiect;
    NEW.autorizare_tgz_etag := v_etag;
  END IF;
  NEW.autorizare_tgz_de := auth.uid();
  NEW.autorizare_tgz_la := now();
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_autorizare_tgz_garda() IS 'Redări: trigger pe red_proiecte — autorizarea Transgaz (art. 28) o schimbă doar owner-ul; PDF-ul urcat de el, sub codul proiectului, legat prin id; codul nu se schimbă cât există autorizarea; _obiect / _de / _la puse de server. 20261130m.';
REVOKE ALL ON FUNCTION public.fn_red_autorizare_tgz_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_autorizare_tgz BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_autorizare_tgz_garda();

CREATE FUNCTION public.fn_red_informare_publicata(p_cod text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce((
    SELECT p.activ IS TRUE AND nullif(btrim(p.autorizare_tgz_nr), '') IS NOT NULL AND p.autorizare_tgz_data IS NOT NULL
       AND p.autorizare_tgz_fisier IS NOT NULL AND split_part(p.autorizare_tgz_fisier, '/', 1) = p.cod
       AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.id = p.autorizare_tgz_obiect AND o.bucket_id = 'redari' AND o.name = p.autorizare_tgz_fisier
                     AND o.metadata->>'eTag' = p.autorizare_tgz_etag)
    FROM public.red_proiecte p WHERE p.cod = p_cod), false)
$fn$;
COMMENT ON FUNCTION public.fn_red_informare_publicata(text) IS 'Redări: informarea GDPR a proiectului e publicată = proiect activ + autorizarea Transgaz (art. 28) completă: nr + dată + PDF sub codul proiectului, iar obiectul legat la salvare încă există la aceeași cale. Public (anon): întoarce DOAR true / false. 20261130m.';
REVOKE ALL ON FUNCTION public.fn_red_informare_publicata(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_red_informare_publicata(text) TO anon, authenticated, service_role;

-- r2 (Jakarinos P1-3): garda in BD pentru convocatorul postal — fara informarea publicata nu se rezerva o convocare postala noua si nu i se
-- schimba fisierul / hash-ul (regenerare). Mentenanta trece. Proiectul se afla din detinator -> parcela -> proiect (aceleasi legaturi ca trg_red_legaturi).
CREATE FUNCTION public.fn_red_convocari_informare_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cod text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}') = '{}' AND session_user = 'postgres' THEN RETURN NEW; END IF;
  IF NEW.canal IS DISTINCT FROM 'posta' THEN RETURN NEW; END IF;
  -- UPDATE fara fisier / hash nou si fara marcarea expedierii (anulare, AR, retur, tracking) trece; r2 (Copilot P1-03): marcarea expedierii
  -- (data_expediere NULL -> data) cere si ea informarea publicata, ca un document generat inainte sa nu plece fara autorizare
  IF TG_OP = 'UPDATE' AND OLD.canal = 'posta' AND NEW.fisier_convocator_path IS NOT DISTINCT FROM OLD.fisier_convocator_path
     AND NEW.continut_hash IS NOT DISTINCT FROM OLD.continut_hash AND NOT (OLD.data_expediere IS NULL AND NEW.data_expediere IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- r4 (Copilot r2 P1-02): FOR SHARE pe rândul proiectului înainte de verificare — o revocare concurentă așteaptă (sau e așteptată), apoi se recitește
  SELECT pr.cod INTO v_cod FROM public.red_detinatori d JOIN public.red_parcele x ON x.id = d.parcela_id JOIN public.red_proiecte pr ON pr.id = x.proiect_id
   WHERE d.id = NEW.detinator_id FOR SHARE OF pr;
  IF v_cod IS NULL OR NOT public.fn_red_informare_publicata(v_cod) THEN
    RAISE EXCEPTION 'red_convocari: convocatorul postal cere informarea GDPR publicata (autorizarea Transgaz art. 28 incarcata de owner in Setari proiect)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_convocari_informare_garda() IS 'Redări: trigger pe red_convocari — o convocare poștală nouă și orice fișier / hash nou al ei cer informarea GDPR publicată pe proiect (fn_red_informare_publicata). 20261130m.';
REVOKE ALL ON FUNCTION public.fn_red_convocari_informare_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_convocari_informare BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_informare_garda();

DO $post$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%') <> 7 THEN
    RAISE EXCEPTION '20261130m: coloane';
  END IF;
  IF (SELECT array_agg(t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
       WHERE t.tgrelid = 'public.red_proiecte'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_red_autorizare_tgz'
         AND t.tgfoid = 'public.fn_red_autorizare_tgz_garda()'::regprocedure)
       IS DISTINCT FROM ARRAY['trg_red_autorizare_tgz:O:23']::text[] THEN
    RAISE EXCEPTION '20261130m: trigger red_proiecte (BEFORE INSERT OR UPDATE, ROW, activ)';
  END IF;
  IF (SELECT array_agg(t.tgname || ':' || t.tgenabled::text || ':' || t.tgtype::text ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
       WHERE t.tgrelid = 'public.red_convocari'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_red_convocari_informare'
         AND t.tgfoid = 'public.fn_red_convocari_informare_garda()'::regprocedure)
       IS DISTINCT FROM ARRAY['trg_red_convocari_informare:O:23']::text[] THEN
    RAISE EXCEPTION '20261130m: trigger red_convocari (BEFORE INSERT OR UPDATE, ROW, activ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_autorizare_tgz_garda()'::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR has_function_privilege('authenticated', 'public.fn_red_autorizare_tgz_garda()', 'EXECUTE') OR has_function_privilege('anon', 'public.fn_red_autorizare_tgz_garda()', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocari_informare_garda()'::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR has_function_privilege('authenticated', 'public.fn_red_convocari_informare_garda()', 'EXECUTE') OR has_function_privilege('anon', 'public.fn_red_convocari_informare_garda()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130m: functiile trigger au setari gresite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_informare_publicata(text)'::regprocedure AND prosecdef AND provolatile = 's' AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR NOT has_function_privilege('anon', 'public.fn_red_informare_publicata(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130m: fn_red_informare_publicata are setari gresite';
  END IF;
  -- la aplicare niciun proiect nu are autorizare: informarea ramane nepublicata peste tot
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE public.fn_red_informare_publicata(cod)) THEN RAISE EXCEPTION '20261130m: informare publicata la aplicare'; END IF;
END $post$;
