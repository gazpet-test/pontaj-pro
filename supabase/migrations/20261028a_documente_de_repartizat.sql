-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261028a — Coada „de repartizat” pentru corespondența Gmail (cerere Răzvan 13.10.2026)
-- Scriptul Gmail „Ingestie Corespondența” v2 trimite mesajele cu 2+ proiecte candidate neclare la ingest-document cu
-- proiect_slug = '_de_repartizat' + candidati (etichete Gmail). Ele intră aici, nu într-un proiect ghicit.
-- Obiecte NOI:
--   * tabel public.documente_de_repartizat — un rând per (gmail_message_id, nume_fisier); fișierul stă în bucketul
--     documente-proiect sub _de_repartizat/AAAA/LL/…; stare de_repartizat | repartizat | ignorat.
--     RLS: SELECT pentru authenticated (auth.uid() IS NOT NULL, ca documente_proiect); NICIUN drept de scriere direct
--     pentru authenticated — scrierile trec doar prin funcțiile de mai jos (inserția o face edge-ul, ca service_role).
--   * fn_doc_repartizeaza(p_id, p_proiect_id) — owner sau acces explicit „executie”: mută rândul în documente_proiect
--     ATOMIC (FOR UPDATE + INSERT … ON CONFLICT DO NOTHING pe cheia de dedup existentă), fără copiere de fișier.
--   * fn_doc_ignora(p_id) — același acces; marchează ignorat (nu șterge nimic).
--   * fn_doc_muta_in_coada(p_doc_ids, p_aplica) — DOAR owner: pentru curățarea mesajelor amestecate deja intrate în
--     documente_proiect. p_aplica=false = previzualizare (număr de rânduri, mesaje unice, ordine detectate legate);
--     p_aplica=true = mută (un rând de coadă per mesaj+fișier, candidații = etichetele proiectelor în care era) și
--     șterge rândurile din documente_proiect. ATENȚIE: ștergerea face CASCADE pe executie_ordine_detectate legate
--     (previzualizarea le numără). Fișierele din Storage și de pe NAS NU se șterg.
-- Nu atinge date existente. Revenire: supabase/revenire/20261028a_documente_de_repartizat_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028a_documente_de_repartizat:' || txid_current() THEN
    RAISE EXCEPTION '20261028a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261028a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.documente_de_repartizat') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_doc_repartizeaza', 'fn_doc_ignora', 'fn_doc_muta_in_coada', 'fn_doc_acces_executie')) THEN
    RAISE EXCEPTION '20261028a: obiectele exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'documente_proiect_dedup_key')
     OR to_regprocedure('public.fn_is_app_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION '20261028a: documente_proiect_dedup_key / fn_is_app_owner lipsesc';
  END IF;
END $pre$;

CREATE TABLE public.documente_de_repartizat (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sursa                    text NOT NULL DEFAULT 'gmail',
  gmail_message_id         text NOT NULL,
  nume_fisier              text NOT NULL,
  mime_type                text,
  marime_bytes             bigint,
  expeditor                text,
  subiect                  text,
  data_mail                timestamptz,
  candidati                text[] NOT NULL DEFAULT '{}' CHECK (cardinality(candidati) <= 20),
  storage_path             text NOT NULL,
  drive_file_id            text,
  hash_sha256              text,
  stare                    text NOT NULL DEFAULT 'de_repartizat' CHECK (stare IN ('de_repartizat', 'repartizat', 'ignorat')),
  repartizat_in_proiect_id bigint REFERENCES public.executie_proiecte(id) ON DELETE SET NULL,
  document_proiect_id      bigint REFERENCES public.documente_proiect(id) ON DELETE SET NULL,
  rezolvat_de              uuid,
  rezolvat_la              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gmail_message_id, nume_fisier),
  CHECK (stare <> 'repartizat' OR repartizat_in_proiect_id IS NOT NULL),
  CHECK ((stare = 'de_repartizat') = (rezolvat_la IS NULL))
);
COMMENT ON TABLE public.documente_de_repartizat IS 'Coada corespondenței Gmail cu proiect neclar (2+ candidați). Scrieri doar prin edge ingest-document și fn_doc_*.';
CREATE INDEX documente_de_repartizat_stare_idx ON public.documente_de_repartizat (stare, data_mail DESC);
ALTER TABLE public.documente_de_repartizat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.documente_de_repartizat FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.documente_de_repartizat TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.documente_de_repartizat TO service_role;
CREATE POLICY documente_de_repartizat_select ON public.documente_de_repartizat FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DO $seq$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', pg_get_serial_sequence('public.documente_de_repartizat', 'id'));
END $seq$;

-- Acces la acțiuni: owner sau intrare EXPLICITĂ „executie” (ori sub-modul „executie.*”) în user_module_access.
CREATE FUNCTION public.fn_doc_acces_executie()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT auth.uid() IS NOT NULL AND (
    public.fn_is_app_owner(auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access m
                WHERE m.profile_id = auth.uid() AND (m.module = 'executie' OR m.module LIKE 'executie.%')))
$f$;

CREATE FUNCTION public.fn_doc_repartizeaza(p_id bigint, p_proiect_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r public.documente_de_repartizat%ROWTYPE; v_doc bigint; v_eticheta text;
BEGIN
  IF NOT public.fn_doc_acces_executie() THEN RAISE EXCEPTION 'fn_doc_repartizeaza: acces refuzat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.documente_de_repartizat WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fn_doc_repartizeaza: documentul % nu există', p_id; END IF;
  IF r.stare <> 'de_repartizat' THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'deja_' || r.stare, 'document_proiect_id', r.document_proiect_id);
  END IF;
  SELECT eticheta_gmail INTO v_eticheta FROM public.executie_proiecte WHERE id = p_proiect_id AND activ;
  IF NOT FOUND THEN RAISE EXCEPTION 'fn_doc_repartizeaza: proiectul % nu există sau nu e activ', p_proiect_id; END IF;
  -- Doar spre unul din candidați; owner-ul poate alege orice proiect activ.
  IF NOT public.fn_is_app_owner(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM unnest(r.candidati) c WHERE lower(c) = lower(coalesce(v_eticheta, ''))) THEN
    RAISE EXCEPTION 'fn_doc_repartizeaza: proiectul ales nu e printre candidați' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.documente_proiect (proiect_id, sursa, gmail_message_id, nume_fisier, mime_type, marime_bytes,
                                        expeditor, subiect, data_mail, storage_path, drive_file_id, hash_sha256)
  VALUES (p_proiect_id, r.sursa, r.gmail_message_id, r.nume_fisier, r.mime_type, r.marime_bytes,
          r.expeditor, r.subiect, r.data_mail, r.storage_path, r.drive_file_id, r.hash_sha256)
  ON CONFLICT (proiect_id, gmail_message_id, nume_fisier) DO NOTHING
  RETURNING id INTO v_doc;
  IF v_doc IS NULL THEN   -- era deja în proiect (fără dublură): legăm rândul existent
    SELECT id INTO v_doc FROM public.documente_proiect
     WHERE proiect_id = p_proiect_id AND gmail_message_id = r.gmail_message_id AND nume_fisier = r.nume_fisier;
  END IF;
  UPDATE public.documente_de_repartizat
     SET stare = 'repartizat', repartizat_in_proiect_id = p_proiect_id, document_proiect_id = v_doc,
         rezolvat_de = auth.uid(), rezolvat_la = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'document_proiect_id', v_doc);
END
$f$;

CREATE FUNCTION public.fn_doc_ignora(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_n integer;
BEGIN
  IF NOT public.fn_doc_acces_executie() THEN RAISE EXCEPTION 'fn_doc_ignora: acces refuzat' USING ERRCODE = '42501'; END IF;
  UPDATE public.documente_de_repartizat SET stare = 'ignorat', rezolvat_de = auth.uid(), rezolvat_la = now()
   WHERE id = p_id AND stare = 'de_repartizat';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1);
END
$f$;

-- Curățarea mesajelor amestecate deja intrate în proiecte. DOAR owner. Previzualizare implicită.
CREATE FUNCTION public.fn_doc_muta_in_coada(p_doc_ids bigint[], p_aplica boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_randuri integer; v_mesaje integer; v_ordine integer; v_nas integer; v_ins integer; v_del integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_is_app_owner(auth.uid()) THEN
    RAISE EXCEPTION 'fn_doc_muta_in_coada: doar owner' USING ERRCODE = '42501';
  END IF;
  IF p_doc_ids IS NULL OR cardinality(p_doc_ids) = 0 OR cardinality(p_doc_ids) > 500 THEN
    RAISE EXCEPTION 'fn_doc_muta_in_coada: între 1 și 500 de id-uri';
  END IF;
  SELECT count(*), count(DISTINCT (d.gmail_message_id, d.nume_fisier)), count(*) FILTER (WHERE d.nas_synced)
    INTO v_randuri, v_mesaje, v_nas
    FROM public.documente_proiect d WHERE d.id = ANY(p_doc_ids);
  SELECT count(*) INTO v_ordine FROM public.executie_ordine_detectate o WHERE o.documente_proiect_id = ANY(p_doc_ids);
  IF NOT p_aplica THEN
    RETURN jsonb_build_object('previzualizare', true, 'randuri', v_randuri, 'id_uri_negasite', cardinality(p_doc_ids) - v_randuri,
                              'mesaje_unice', v_mesaje, 'deja_pe_nas', v_nas, 'ordine_detectate_legate', v_ordine);
  END IF;
  PERFORM 1 FROM public.documente_proiect WHERE id = ANY(p_doc_ids) FOR UPDATE;
  INSERT INTO public.documente_de_repartizat AS q
    (sursa, gmail_message_id, nume_fisier, mime_type, marime_bytes, expeditor, subiect, data_mail, candidati,
     storage_path, drive_file_id, hash_sha256)
  SELECT min(d.sursa), d.gmail_message_id, d.nume_fisier, min(d.mime_type), max(d.marime_bytes), min(d.expeditor),
         min(d.subiect), min(d.data_mail),
         coalesce(array_agg(DISTINCT p.eticheta_gmail) FILTER (WHERE p.eticheta_gmail IS NOT NULL), '{}'),
         min(d.storage_path), min(d.drive_file_id), min(d.hash_sha256)
    FROM public.documente_proiect d JOIN public.executie_proiecte p ON p.id = d.proiect_id
   WHERE d.id = ANY(p_doc_ids)
   GROUP BY d.gmail_message_id, d.nume_fisier
  ON CONFLICT (gmail_message_id, nume_fisier) DO UPDATE
     SET candidati = (SELECT array_agg(DISTINCT c) FROM unnest(q.candidati || EXCLUDED.candidati) c),
         stare = 'de_repartizat', repartizat_in_proiect_id = NULL, document_proiect_id = NULL,
         rezolvat_de = NULL, rezolvat_la = NULL;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  DELETE FROM public.documente_proiect WHERE id = ANY(p_doc_ids);
  GET DIAGNOSTICS v_del = ROW_COUNT;
  RETURN jsonb_build_object('previzualizare', false, 'in_coada', v_ins, 'sterse_din_proiecte', v_del, 'ordine_detectate_sterse', v_ordine);
END
$f$;

REVOKE ALL ON FUNCTION public.fn_doc_acces_executie() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_doc_repartizeaza(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_doc_ignora(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_doc_muta_in_coada(bigint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_doc_acces_executie() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_doc_repartizeaza(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_doc_ignora(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_doc_muta_in_coada(bigint[], boolean) TO authenticated;

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.documente_de_repartizat'::regclass)
     OR has_table_privilege('anon', 'public.documente_de_repartizat', 'SELECT')
     OR has_table_privilege('authenticated', 'public.documente_de_repartizat', 'INSERT')
     OR has_table_privilege('authenticated', 'public.documente_de_repartizat', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.documente_de_repartizat', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.documente_de_repartizat', 'INSERT')
     OR has_function_privilege('anon', 'public.fn_doc_repartizeaza(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_doc_muta_in_coada(bigint[],boolean)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM public.documente_de_repartizat) THEN
    RAISE EXCEPTION '20261028a: postconditie';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261028a_documente_de_repartizat:' || txid_current() THEN
    RAISE EXCEPTION '20261028a: garda final invalida';
  END IF;
END $post$;
