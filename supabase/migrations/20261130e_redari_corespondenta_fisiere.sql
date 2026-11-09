-- Version 20261130124000. Runner supplies one transaction.
-- 20261130e_redari_corespondenta_fisiere — Redări: fișierele unei corespondențe (decizia lui Răzvan 04.11.2026), ca să se știe EXACT ce s-a trimis.
-- Ce face: tabel nou red_corespondenta_fisiere (un rând = un fișier din bucket-ul `redari`, sub {proiect.cod}/corespondenta/{cod}/), IMUTABIL
-- (fără UPDATE / DELETE; o variantă nouă = rând nou + cale nouă). Roluri: de_trimis | dovada_trimitere | raspuns | altul.
--   • A1: descarcă toți cei cu acces la Redări (admin / editor prin red_storage_sel; viewer prin politica nouă red_storage_coresp_sel, doar sub
--     /corespondenta/ și doar pentru fișierele înregistrate în tabel).  • B: urcă doar admin / editor (RLS + red_storage_ins existent).
--   • Aprobarea owner-ului se leagă de FIȘIERUL EXACT: UI-ul trimite aprobat_fisier_id = fișierul pe care l-a arătat owner-ului; triggerul de reguli
--     îl acceptă DOAR dacă e ultimul `de_trimis` citit sub blocarea rândului (altfel 23514) și reține aprobat_fisier_id + aprobat_sha256 +
--     aprobat_storage_etag. Fără `de_trimis` aprobarea e refuzată (mentenanța e scutită, pentru D1/D2 istorice).
--   • Un `de_trimis` nou după aprobare face aprobarea să cadă (rândul revine în draft, aprobat_* golite).
--   • După trimis / raspuns_primit / anulat nu se mai urcă `de_trimis` (refuz); dovada_trimitere / raspuns / altul se pot urca oricând.
--   • Amprenta: sha256 e DECLARAT de cel care a urcat (calculat în browser); amprenta SERVERULUI e storage_etag, copiat de trigger din
--     storage.objects.metadata->>'eTag' (clientul nu-l poate alege). Argumentul principal e imutabilitatea obiectului (vezi COMMENT pe tabel).
--     Decizie 04.11.2026, aprobat de Răzvan (varianta A): obiect imutabil pentru utilizatori + eTag = amprenta serverului; service_role / mentenanța = risc acceptat.
--   • La orice trecere în trimis / raspuns_primit (și trimis → raspuns_primit), obiectul aprobat trebuie să existe în Storage cu același eTag (altfel 23514).
--     Rândurile `aprobat` dinainte de fișiere NU se mai pot marca trimis: urcă PDF-ul de trimis și cere din nou aprobarea. Excepție: D1/D2 (deja trimise istoric).
-- fn_red_corespondenta_reguli() se înlocuiește (CREATE OR REPLACE) păstrând TOATĂ logica din 20261129h; garda de start cere ca versiunea curentă
-- să fie exact cea din 20261129h (md5 pe corp), iar revenirea o readuce textual.
-- Revenire: supabase/revenire/20261130e_redari_corespondenta_fisiere_ROLLBACK.sql (NU șterge: tabelul cu date și legăturile aprobărilor merg în
-- schema redari_retras_<data>). DRY: supabase/tests/20261130e_redari_corespondenta_fisiere_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130e_redari_corespondenta_fisiere:' || txid_current() THEN
    RAISE EXCEPTION '20261130e: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_corespondenta_fisiere') IS NOT NULL THEN RAISE EXCEPTION '20261130e: tabelul exista deja'; END IF;
  IF to_regclass('public.red_corespondenta') IS NULL OR to_regclass('public.red_proiecte') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL
     OR to_regprocedure('public.fn_red_jurnal()') IS NULL OR to_regprocedure('public.fn_red_storage_expr_bucket(text)') IS NULL THEN
    RAISE EXCEPTION '20261130e: lipseste schema Redari (red_corespondenta / red_proiecte / fn_red_nivel / fn_red_jurnal / fn_red_storage_expr_bucket)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
              AND column_name IN ('aprobat_fisier_id', 'aprobat_sha256', 'aprobat_storage_etag')) THEN
    RAISE EXCEPTION '20261130e: coloanele noi exista deja';
  END IF;
  -- functia de reguli trebuie sa fie EXACT cea din 20261129h (altfel CREATE OR REPLACE ar pierde o schimbare facuta intre timp)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_corespondenta_reguli()')) IS DISTINCT FROM 'dd78583b43f54010962aad0e0d69ae9c' THEN
    RAISE EXCEPTION '20261130e: fn_red_corespondenta_reguli nu e versiunea din 20261129h';
  END IF;
  IF to_regprocedure('public.fn_red_coresp_fisier_inainte()') IS NOT NULL OR to_regprocedure('public.fn_red_coresp_fisier_imutabil()') IS NOT NULL
     OR to_regprocedure('public.fn_red_coresp_fisier_dupa()') IS NOT NULL OR to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '20261130e: functiile exista deja';
  END IF;
  IF to_regprocedure('storage.foldername(text)') IS NULL THEN RAISE EXCEPTION '20261130e: lipseste storage.foldername'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_coresp_sel') THEN
    RAISE EXCEPTION '20261130e: politica storage exista deja';
  END IF;
END $pre$;

-- Verificatorul politicilor storage pentru bucket-ul `redari` (preflight cu p_cu_viewer = false, postconditie si DRY cu true). Arunca la orice abatere:
--   • bucket-ul redari exista si e PRIVAT;
--   • red_storage_sel / red_storage_ins au EXACT predicatul din 20261126a (bucket redari + nivel admin/editor);
--   • red_storage_* = exact 2 (sau 3 cu red_storage_coresp_sel: SELECT, legat de redari, viewer, doar fisiere inregistrate), doar SELECT / INSERT;
--   • (ca 20261126a) nicio politica PERMISIVA non-red_storage_* — pentru ORICE comanda (SELECT / INSERT / UPDATE / DELETE / ALL) — nu poate acoperi
--     bucket-ul: expresia ceruta a comenzii exista si fiecare expresie e legata sigur de ALT bucket (fn_red_storage_expr_bucket).
-- SECURITY INVOKER (citeste doar cataloage); search_path fix → pg_policies deparseaza fara „public.”; fara EXECUTE pentru aplicatie.
CREATE FUNCTION public.fn_red_storage_verifica_redari(p_cu_viewer boolean) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_pred constant text := '((bucket_id = ''redari''::text) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))';
        -- r3 (J-P2-3 / C-P2-04): predicatul viewer, deparsat de PostgreSQL 17 cu search_path = public, pg_temp, cu spatiile albe normalizate
        v_pred_viewer constant text := '((bucket_id = ''redari''::text) AND ((storage.foldername(name))[2] = ''corespondenta''::text) AND (fn_red_nivel() = ''viewer''::text) '
                                       'AND (EXISTS ( SELECT 1 FROM red_corespondenta_fisiere f WHERE (f.path = objects.name))))';
        v_expuse text[]; v_asteptate integer := CASE WHEN p_cu_viewer THEN 3 ELSE 2 END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari' AND public IS FALSE) THEN
    RAISE EXCEPTION 'redari storage: bucket-ul redari lipseste sau e public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_sel' AND cmd = 'SELECT'
                  AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND qual = v_pred)
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_ins' AND cmd = 'INSERT'
                  AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check = v_pred) THEN
    RAISE EXCEPTION 'redari storage: red_storage_sel / red_storage_ins nu mai au predicatul admin/editor din 20261126a';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'red\_storage\_%') <> v_asteptate
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'red\_%' AND cmd NOT IN ('SELECT', 'INSERT'))
     OR (p_cu_viewer AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_coresp_sel'
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL
           AND btrim(regexp_replace(qual, '\s+', ' ', 'g')) = v_pred_viewer)) THEN
    RAISE EXCEPTION 'redari storage: politicile red_storage_* nu sunt cele asteptate';
  END IF;
  SELECT array_agg(p.policyname::text ORDER BY p.policyname) INTO v_expuse
    FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.permissive = 'PERMISSIVE' AND p.policyname NOT LIKE 'red\_storage\_%'
     AND ((p.cmd IN ('SELECT', 'DELETE', 'UPDATE', 'ALL') AND p.qual IS NULL) OR (p.cmd = 'INSERT' AND p.with_check IS NULL)
          OR EXISTS (SELECT 1 FROM unnest(ARRAY[p.qual, p.with_check]) e
                      WHERE e IS NOT NULL AND coalesce(public.fn_red_storage_expr_bucket(e), 'redari') = 'redari'));
  IF v_expuse IS NOT NULL THEN
    RAISE EXCEPTION 'redari storage: politici storage.objects care ar putea acoperi bucket-ul redari (nelegate sigur de alt bucket): %', v_expuse;
  END IF;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_storage_verifica_redari(boolean) FROM PUBLIC, anon, authenticated, service_role;
SELECT public.fn_red_storage_verifica_redari(false);   -- preflight: starea storage dinainte (2 politici red_storage_*, nimic altceva pe redari)

CREATE TABLE public.red_corespondenta_fisiere (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corespondenta_id uuid NOT NULL CONSTRAINT red_corespondenta_fisiere_coresp_fk REFERENCES public.red_corespondenta(id),
  rol text NOT NULL CHECK (rol IN ('de_trimis', 'dovada_trimitere', 'raspuns', 'altul')),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 500),
  nume_original text CHECK (nume_original IS NULL OR length(nume_original) <= 255),
  mime text CHECK (mime IS NULL OR length(mime) <= 200),
  marime bigint NOT NULL CHECK (marime > 0 AND marime <= 26214400),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_etag text NOT NULL CHECK (length(storage_etag) BETWEEN 1 AND 200),
  observatii text CHECK (observatii IS NULL OR length(observatii) <= 1000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT red_corespondenta_fisiere_path_uq UNIQUE (path)
);
CREATE INDEX idx_red_corespondenta_fisiere_coresp ON public.red_corespondenta_fisiere (corespondenta_id, created_at);
COMMENT ON TABLE public.red_corespondenta_fisiere IS 'Redări: fișierele unei corespondențe (de_trimis / dovada_trimitere / raspuns / altul), în bucket-ul redari sub {proiect}/corespondenta/{cod}/. Imutabile: o variantă nouă = rând nou + cale nouă. Aprobarea owner-ului reține fișierul de_trimis confirmat (= ultimul). '
  'De ce „ce s-a aprobat” = obiectul de la path: (1) bucket-ul nu are politici UPDATE/DELETE pentru aplicație și UI-ul urcă cu upsert:false, deci obiectul de la o cale nu se mai schimbă după urcare (postcondiția migrării 20261130e verifică politicile); '
  '(2) storage_etag = metadata.eTag din Storage, copiat de trigger la înregistrare (amprenta serverului, nealeasă de client); (3) sha256 = SHA-256 DECLARAT de cel care a urcat (calculat în browser, neverificat de server). '
  'Limită cunoscută: service_role / mentenanța pot încă rescrie obiecte prin API-ul Storage; eTag-ul reținut la aprobare permite detectarea: marcarea trimis / raspuns_primit e refuzată dacă obiectul aprobat lipsește sau are alt eTag. '
  'DECIZIE 04.11.2026, aprobat de Răzvan (varianta A, review Copilot r1 C-P1-01): modelul de încredere = obiectul din Storage e imutabil pentru utilizatori + eTag-ul Storage e amprenta de server; '
  'service_role / mentenanța = risc acceptat; SHA-256 declarat rămâne informativ. Fără edge function de verificare.';
COMMENT ON COLUMN public.red_corespondenta_fisiere.sha256 IS 'SHA-256 declarat de cel care a urcat (calculat în browser). Serverul nu-l recalculează; amprenta serverului e storage_etag.';
COMMENT ON COLUMN public.red_corespondenta_fisiere.storage_etag IS 'metadata->>eTag al obiectului din storage.objects la momentul înregistrării (pus de trigger).';

ALTER TABLE public.red_corespondenta
  ADD COLUMN aprobat_fisier_id uuid CONSTRAINT red_corespondenta_aprobat_fisier_fk REFERENCES public.red_corespondenta_fisiere(id),
  ADD COLUMN aprobat_sha256 text CHECK (aprobat_sha256 IS NULL OR aprobat_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN aprobat_storage_etag text CHECK (aprobat_storage_etag IS NULL OR length(aprobat_storage_etag) <= 200);
COMMENT ON COLUMN public.red_corespondenta.aprobat_fisier_id IS 'Fișierul de_trimis aprobat de owner. La aprobare UI-ul trimite id-ul arătat owner-ului; triggerul îl acceptă doar dacă e ultimul de_trimis. Altfel îl pune / golește doar triggerul.';

-- BEFORE INSERT: calea în folderul corespondenței, obiectul există în Storage, autorul / data / mărimea / tipul / eTag-ul puse de server.
-- SECURITY DEFINER: citește red_proiecte / storage.objects și blochează rândul părinte indiferent de RLS-ul apelantului.
CREATE FUNCTION public.fn_red_coresp_fisier_inainte() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_mentenanta boolean; v_stare text; v_prefix text; v_meta jsonb; v_gasit boolean;
BEGIN
  v_mentenanta := session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '';
  -- blocarea randului parinte serializeaza urcarea cu aprobarea (UPDATE pe acelasi rand): aprobarea vede fisierul, sau fisierul vede aprobarea
  SELECT c.stare, p.cod || '/corespondenta/' || c.cod || '/' INTO v_stare, v_prefix
    FROM public.red_corespondenta c JOIN public.red_proiecte p ON p.id = c.proiect_id
   WHERE c.id = NEW.corespondenta_id FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: corespondenta nu exista' USING ERRCODE = '23503'; END IF;
  IF NEW.rol = 'de_trimis' AND v_stare IN ('trimis', 'raspuns_primit', 'anulat') THEN
    RAISE EXCEPTION 'redari: fisierul de trimis nu se mai urca dupa trimitere / anulare; urca dovada sau raspunsul' USING ERRCODE = '23514';
  END IF;
  IF NEW.path IS NULL OR NOT starts_with(NEW.path, v_prefix)
     OR substr(NEW.path, length(v_prefix) + 1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.([Pp][Dd][Ff]|[Dd][Oo][Cc][Xx]|[Jj][Pp][Ee]?[Gg]|[Pp][Nn][Gg])$'
     OR NEW.path LIKE '%..%' THEN
    RAISE EXCEPTION 'redari: calea fisierului nu e in folderul corespondentei (%...)', v_prefix USING ERRCODE = '23514';
  END IF;
  SELECT true, o.metadata INTO v_gasit, v_meta FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.path;
  IF v_gasit IS NOT TRUE THEN RAISE EXCEPTION 'redari: fisierul lipseste din Storage (%)', NEW.path USING ERRCODE = '23514'; END IF;
  -- amprenta serverului: eTag-ul din metadata Storage (pe live, 04.11.2026, toate obiectele din redari / ofertare / templates il au)
  IF nullif(btrim(v_meta ->> 'eTag'), '') IS NULL THEN
    RAISE EXCEPTION 'redari: obiectul nu are amprenta (eTag) in Storage; reincearca urcarea' USING ERRCODE = '23514';
  END IF;
  NEW.storage_etag := left(btrim(v_meta ->> 'eTag'), 200);
  -- marimea si tipul le da Storage-ul cand le are (nu clientul); sha256 vine din browser (declarat)
  IF (v_meta ->> 'size') ~ '^[0-9]+$' THEN NEW.marime := (v_meta ->> 'size')::bigint; END IF;
  IF nullif(v_meta ->> 'mimetype', '') IS NOT NULL THEN NEW.mime := left(v_meta ->> 'mimetype', 200); END IF;
  IF NOT v_mentenanta THEN NEW.created_by := auth.uid(); END IF;
  NEW.created_at := clock_timestamp();   -- clock_timestamp: ordinea „ultimul de_trimis” e stricta si in aceeasi tranzactie
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_fisier_inainte() FROM PUBLIC, anon, authenticated;

-- BEFORE UPDATE OR DELETE: fisierele sunt imutabile, pentru oricine (si mentenanta: revenirea muta tabelul, nu sterge randuri).
CREATE FUNCTION public.fn_red_coresp_fisier_imutabil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'redari: fisierele corespondentei sunt imutabile; urca o varianta noua' USING ERRCODE = '23514';
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_fisier_imutabil() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT de_trimis: atinge randul parinte (versiunea creste → aprobarile din UI pe o lista veche cad la CAS); daca era aprobat, revine in draft
-- (fn_red_corespondenta_reguli goleste aprobat_*). SECURITY DEFINER: si un editor cu acces doar la fisiere poate declansa caderea aprobarii.
CREATE FUNCTION public.fn_red_coresp_fisier_dupa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.rol = 'de_trimis' THEN
    UPDATE public.red_corespondenta
       SET stare = CASE WHEN stare = 'aprobat' AND aprobat_la IS NOT NULL THEN 'draft' ELSE stare END
     WHERE id = NEW.corespondenta_id;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_coresp_fisier_dupa() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_red_coresp_fisier_inainte BEFORE INSERT ON public.red_corespondenta_fisiere FOR EACH ROW EXECUTE FUNCTION public.fn_red_coresp_fisier_inainte();
CREATE TRIGGER trg_red_coresp_fisier_imutabil BEFORE UPDATE OR DELETE ON public.red_corespondenta_fisiere FOR EACH ROW EXECUTE FUNCTION public.fn_red_coresp_fisier_imutabil();
CREATE TRIGGER trg_red_coresp_fisier_dupa AFTER INSERT ON public.red_corespondenta_fisiere FOR EACH ROW EXECUTE FUNCTION public.fn_red_coresp_fisier_dupa();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_corespondenta_fisiere FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- Regulile corespondentei: logica din 20261129h NESCHIMBATA + aprobat_fisier_id / aprobat_sha256 / aprobat_storage_etag (marcate „20261130e”).
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
  v_continut := TG_OP = 'UPDATE' AND (NEW.destinatar, NEW.subiect, NEW.expeditor, NEW.documente) IS DISTINCT FROM (OLD.destinatar, OLD.subiect, OLD.expeditor, OLD.documente);
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

ALTER TABLE public.red_corespondenta_fisiere ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_corespondenta_fisiere FROM PUBLIC, anon, authenticated, service_role;   -- privilegiile implicite Supabase dau ALL pe tabelele noi
GRANT SELECT, INSERT ON public.red_corespondenta_fisiere TO authenticated;
-- service_role: doar SELECT / INSERT (fara UPDATE / DELETE / TRUNCATE — TRUNCATE ar ocoli triggerul de imutabilitate; ca la red_plicuri, Jakarinos 29i r1 P1-03)
GRANT SELECT, INSERT ON public.red_corespondenta_fisiere TO service_role;
CREATE POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere FOR INSERT TO authenticated WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));

-- Storage: viewer-ul descarca DOAR fisierele inregistrate ale corespondentei (admin / editor au deja red_storage_sel pe tot bucket-ul).
-- Bucket-ul e primul operand AND (cerinta fn_red_storage_expr_bucket din 20261126a). Fara UPDATE / DELETE pe bucket (imutabil).
CREATE POLICY red_storage_coresp_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'redari' AND (storage.foldername(name))[2] = 'corespondenta' AND public.fn_red_nivel() = 'viewer'
         AND EXISTS (SELECT 1 FROM public.red_corespondenta_fisiere f WHERE f.path = objects.name));

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_corespondenta_fisiere') <> 2 THEN RAISE EXCEPTION '20261130e: politici'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_corespondenta_fisiere'::regclass) THEN RAISE EXCEPTION '20261130e: RLS oprit'; END IF;
  IF has_table_privilege('anon', 'public.red_corespondenta_fisiere', 'SELECT') OR has_table_privilege('anon', 'public.red_corespondenta_fisiere', 'INSERT')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['authenticated', 'service_role']) r, unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) pr
                 WHERE has_table_privilege(r, 'public.red_corespondenta_fisiere', pr))
     OR NOT has_table_privilege('authenticated', 'public.red_corespondenta_fisiere', 'INSERT') THEN
    RAISE EXCEPTION '20261130e: drepturi gresite pe red_corespondenta_fisiere';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.fn_red_coresp_fisier_inainte()', 'public.fn_red_coresp_fisier_imutabil()', 'public.fn_red_coresp_fisier_dupa()',
                                        'public.fn_red_corespondenta_reguli()']) fn
              WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = fn::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
                 OR has_function_privilege('authenticated', fn, 'EXECUTE') OR has_function_privilege('anon', fn, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261130e: functiile au setari gresite';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_red_storage_verifica_redari(boolean)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_storage_verifica_redari(boolean)'::regprocedure) THEN
    RAISE EXCEPTION '20261130e: verificatorul storage are setari gresite';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure) = 'dd78583b43f54010962aad0e0d69ae9c'
     OR (SELECT prosrc NOT LIKE '%v_cerut IS DISTINCT FROM v_fis_id%' OR prosrc NOT LIKE '%fisierul aprobat s-a schimbat sau lipseste%' OR prosrc NOT LIKE '%aprobarea e dinainte de fisiere%' FROM pg_proc WHERE oid = 'public.fn_red_corespondenta_reguli()'::regprocedure) THEN
    RAISE EXCEPTION '20261130e: functia de reguli nu a fost inlocuita';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta_fisiere'::regclass AND NOT tgisinternal) <> 4
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_corespondenta'::regclass AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION '20261130e: triggere';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_corespondenta'
       AND column_name IN ('aprobat_fisier_id', 'aprobat_sha256', 'aprobat_storage_etag')) <> 3 THEN
    RAISE EXCEPTION '20261130e: coloanele noi lipsesc';
  END IF;
  -- storage: bucket privat, predicatele admin/editor intacte, exact 3 politici red_storage_*, nimic altceva (orice comanda) pe redari
  PERFORM public.fn_red_storage_verifica_redari(true);
END $post$;
