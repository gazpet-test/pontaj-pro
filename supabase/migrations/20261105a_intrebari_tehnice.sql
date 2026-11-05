-- ════════════════════════════════════════════════════════════════════════════
-- 20261105a — „❓ Întreabă echipa”: întrebări tehnice (spețe) → răspuns AI INFORMATIV pentru cel care a întrebat.
-- Decizie Răzvan 05.11.2026 („da 1-2-3-4”): primul utilizator Silviu Stănescu (Director Tehnic); răspunsul ajunge DOAR la autor,
-- ca informație — e decizia lui dacă îl folosește. Worker pe serverul AI (worker/intrebari-tehnice/), edge intrebari-tehnice-worker.
--
-- FIȘA DE SECURITATE (CLAUDE.md pct. 7):
--  (a) conținut EXTERN: textul întrebării + atașamentele (PDF/imagini) scrise de utilizatori → date pentru model, nu instrucțiuni;
--  (b) scrie: doar răspunsul text pe rândul întrebării + o notificare către autor. Fără mail, fără bani, fără drepturi, fără alte tabele;
--  (c) identitate: utilizatorul (RLS) la scriere/citire; workerul prin edge cu service_role (n-are cont Supabase), RPC-uri doar service_role;
--  (d) cine pornește: inserarea doar cu cheia de modul 'intrebari_tehnice' (sau owner), max 5/zi/utilizator (owner 20);
--      workerul doar cu secretul Vault INTREBARI_WORKER_SECRET (fn_verifica_secret, fail closed);
--  (e) confirmare umană: nu e nevoie — răspunsul nu produce nicio acțiune, e informativ și marcat „AI, neverificat”.
-- LIVRARE: doar prin scripts/livrare_migrare.sh.
-- ════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261105a_intrebari_tehnice:' || txid_current() THEN
    RAISE EXCEPTION '20261105a: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.intrebari_tehnice') IS NOT NULL OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'intrebari-tehnice') THEN
    RAISE EXCEPTION '20261105a: intrebari_tehnice / bucket-ul exista deja';
  END IF;
  IF to_regprocedure('public.fn_verifica_secret(text,text)') IS NULL OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.user_module_access') IS NULL OR to_regprocedure('storage.foldername(text)') IS NULL THEN
    RAISE EXCEPTION '20261105a: lipsesc precondițiile (fn_verifica_secret, notifications, user_module_access, storage.foldername)';
  END IF;
END $pre$;

-- ─── acces ─────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_are_acces_intrebari() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND (uma.module = 'intrebari_tehnice' OR uma.module LIKE 'intrebari\_tehnice.%'))
  );
$$;
REVOKE ALL ON FUNCTION public.fn_are_acces_intrebari() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_intrebari() TO authenticated, service_role;

-- ─── tabelul ───────────────────────────────────────────────────────────────
CREATE TABLE public.intrebari_tehnice (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  autor       uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  titlu       text NOT NULL CHECK (char_length(btrim(titlu)) BETWEEN 3 AND 200),
  intrebare   text NOT NULL CHECK (char_length(btrim(intrebare)) BETWEEN 10 AND 12000),
  context     text CHECK (context IS NULL OR char_length(context) <= 2000),          -- proiect / licitație / localitate, liber
  atasamente  jsonb NOT NULL DEFAULT '[]'::jsonb,                                     -- [{path, nume, mime, marime}] în bucket-ul intrebari-tehnice
  stare       text NOT NULL DEFAULT 'noua' CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare')),
  raspuns_md  text CHECK (raspuns_md IS NULL OR char_length(raspuns_md) <= 60000),
  model       text,
  tokeni      jsonb,
  eroare      text CHECK (eroare IS NULL OR char_length(eroare) <= 500),
  incercari   smallint NOT NULL DEFAULT 0,                                         -- de câte ori a fost preluată (amânările certe o readuc în coadă)
  incercare_id uuid,                                                               -- identitatea preluării curente; finalizarea o cere exact (review Jakarinos P1-1)
  creat_la    timestamptz NOT NULL DEFAULT now(),
  preluat_la  timestamptz,
  raspuns_la  timestamptz,
  CONSTRAINT intrebari_atasamente_lista CHECK (jsonb_typeof(atasamente) = 'array' AND jsonb_array_length(atasamente) <= 5)
);
COMMENT ON TABLE public.intrebari_tehnice IS '❓ Întreabă echipa (20261105a): spețe tehnice → răspuns AI informativ, vizibil doar autorului (și ownerului).';
CREATE INDEX intrebari_tehnice_autor_idx ON public.intrebari_tehnice (autor, creat_la DESC);
CREATE INDEX intrebari_tehnice_coada_idx ON public.intrebari_tehnice (creat_la) WHERE stare IN ('noua', 'in_lucru');

-- Inserarea: câmpurile de server se forțează, limita pe zi și atașamentele (doar în folderul autorului) se verifică aici.
CREATE FUNCTION public.fn_intrebari_inainte_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean; v_azi integer; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  NEW.autor := auth.uid();
  NEW.stare := 'noua'; NEW.raspuns_md := NULL; NEW.model := NULL; NEW.tokeni := NULL; NEW.eroare := NULL;
  NEW.incercari := 0; NEW.incercare_id := NULL; NEW.creat_la := now(); NEW.preluat_la := NULL; NEW.raspuns_la := NULL;
  NEW.titlu := btrim(NEW.titlu); NEW.intrebare := btrim(NEW.intrebare); NEW.context := nullif(btrim(coalesce(NEW.context, '')), '');
  SELECT coalesce(is_owner, false) INTO v_owner FROM public.profiles WHERE id = NEW.autor;
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:' || NEW.autor::text));
  SELECT count(*) INTO v_azi FROM public.intrebari_tehnice
   WHERE autor = NEW.autor AND creat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest');
  IF v_azi >= CASE WHEN v_owner THEN 20 ELSE 5 END THEN
    RAISE EXCEPTION 'Limita zilnică atinsă (% întrebări pe zi). Mâine poți pune din nou.', CASE WHEN v_owner THEN 20 ELSE 5 END;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(NEW.atasamente) LOOP
    IF jsonb_typeof(a) <> 'object'
       OR NOT (a->>'path') ~ ('^' || NEW.autor::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$')
       OR coalesce(a->>'mime', '') NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR char_length(coalesce(a->>'nume', '')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Atașament invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'intrebari-tehnice' AND o.name = a->>'path') THEN
      RAISE EXCEPTION 'Atașamentul nu a fost încărcat: %', a->>'nume';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_inainte_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER intrebari_tehnice_inainte_insert BEFORE INSERT ON public.intrebari_tehnice
  FOR EACH ROW EXECUTE FUNCTION public.fn_intrebari_inainte_insert();

ALTER TABLE public.intrebari_tehnice ENABLE ROW LEVEL SECURITY;
CREATE POLICY intrebari_tehnice_sel ON public.intrebari_tehnice FOR SELECT TO authenticated
  USING (autor = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = (SELECT auth.uid()) AND pr.is_owner));
CREATE POLICY intrebari_tehnice_ins ON public.intrebari_tehnice FOR INSERT TO authenticated
  WITH CHECK (autor = (SELECT auth.uid()) AND (SELECT public.fn_are_acces_intrebari()));
REVOKE ALL ON TABLE public.intrebari_tehnice FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.intrebari_tehnice TO authenticated;
GRANT ALL ON TABLE public.intrebari_tehnice TO service_role;

-- ─── atașamente: bucket privat, fiecare utilizator în folderul lui ─────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('intrebari-tehnice', 'intrebari-tehnice', false, 26214400, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
CREATE POLICY intrebari_storage_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'intrebari-tehnice' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text AND (SELECT public.fn_are_acces_intrebari()));
CREATE POLICY intrebari_storage_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'intrebari-tehnice' AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = (SELECT auth.uid()) AND pr.is_owner)));

-- ─── worker (doar service_role, prin edge-ul intrebari-tehnice-worker) ─────
-- Preia cea mai veche întrebare nouă, cu o identitate de preluare nouă. O întrebare rămasă „în lucru” peste 30 min (worker oprit în
-- timpul apelului AI) NU se reia automat — costul apelului întrerupt e necunoscut (L22) — ci se închide cu eroare vizibilă autorului.
CREATE FUNCTION public.fn_intrebari_preia() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.intrebari_tehnice; v_inc uuid := gen_random_uuid();
BEGIN
  WITH expirate AS (
    UPDATE public.intrebari_tehnice
       SET stare = 'eroare', eroare = 'Procesarea a fost întreruptă. Pune întrebarea din nou.', raspuns_la = now(), incercare_id = NULL
     WHERE stare = 'in_lucru' AND preluat_la < now() - interval '30 minutes'
     RETURNING autor, titlu, id)
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT autor, 'info', 'Întreabă echipa', '❓ Întrebarea nu a primit răspuns', left(titlu, 200), '/intrebari?id=' || id FROM expirate;
  SELECT * INTO r FROM public.intrebari_tehnice WHERE stare = 'noua' ORDER BY creat_la LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.intrebari_tehnice SET stare = 'in_lucru', preluat_la = now(), incercari = incercari + 1, incercare_id = v_inc WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'incercare', v_inc, 'titlu', r.titlu, 'intrebare', r.intrebare, 'context', r.context,
                            'atasamente', r.atasamente, 'creat_la', r.creat_la);
END $$;

-- Amânare CERTĂ (API a refuzat fără cost: 429 / 529): înapoi în coadă; după 3 preluări → eroare.
CREATE FUNCTION public.fn_intrebari_amana(p_id bigint, p_incercare uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN incercari >= 3 THEN 'eroare' ELSE 'noua' END,
         eroare = CASE WHEN incercari >= 3 THEN 'Serviciul AI a fost ocupat de 3 ori. Pune întrebarea din nou mai târziu.' END,
         raspuns_la = CASE WHEN incercari >= 3 THEN now() END,
         preluat_la = NULL, incercare_id = NULL
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.fn_intrebari_raspunde(p_id bigint, p_incercare uuid, p_raspuns text, p_model text, p_tokeni jsonb, p_eroare text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_autor uuid; v_titlu text;
BEGIN
  IF (p_raspuns IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'exact unul dintre raspuns / eroare'; END IF;
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN p_raspuns IS NULL THEN 'eroare' ELSE 'raspuns' END,
         raspuns_md = p_raspuns, model = left(p_model, 80), tokeni = p_tokeni, eroare = left(p_eroare, 500), raspuns_la = now(), incercare_id = NULL
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING autor, titlu INTO v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  VALUES (v_autor, 'info', 'Întreabă echipa',
          CASE WHEN p_raspuns IS NULL THEN '❓ Întrebarea nu a primit răspuns' ELSE '❓ Ai primit răspuns la întrebare' END,
          left(v_titlu, 200), '/intrebari?id=' || p_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_preia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_intrebari_amana(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_preia() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_amana(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text) TO service_role;

DO $final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261105a_intrebari_tehnice:' || txid_current() THEN
    RAISE EXCEPTION '20261105a: garda final invalida';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.intrebari_tehnice'::regclass)
     OR has_table_privilege('anon', 'public.intrebari_tehnice', 'SELECT')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'DELETE')
     OR has_table_privilege('anon', 'public.intrebari_tehnice', 'INSERT')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_amana(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_amana(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_are_acces_intrebari()', 'EXECUTE')
     OR has_sequence_privilege('authenticated', pg_get_serial_sequence('public.intrebari_tehnice', 'id'), 'UPDATE')
     OR has_sequence_privilege('anon', pg_get_serial_sequence('public.intrebari_tehnice', 'id'), 'USAGE')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'intrebari-tehnice' AND public IS FALSE) THEN
    RAISE EXCEPTION '20261105a: verificarea finală a drepturilor a eșuat';
  END IF;
  -- politicile Storage se combină prin OR: nicio politică permisivă pe storage.objects fără filtru pe bucket (review P2-7)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
               AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%bucket_id%') THEN
    RAISE EXCEPTION '20261105a: exista politici storage.objects fara filtru pe bucket — atasamentele n-ar fi izolate';
  END IF;
END $final$;
