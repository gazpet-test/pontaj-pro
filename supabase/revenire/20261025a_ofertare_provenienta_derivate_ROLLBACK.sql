-- REVENIRE 20261025a — scoate coloanele surse_* și validarea lor, dar PĂSTREAZĂ sursele: înainte de drop se copiază ca jsonb
-- în ofertare_provenienta_arhiva_revenire (RLS activ, fără politici, fără drepturi API).
-- Codul care scrie/citește surse_* (PR #677) trebuie scos ÎNAINTE (altfel scrierile pică pe coloane inexistente).
-- RPC-ul ofertare_transfer_plansa_cantitati revine la corpul de dinainte (md5 c00ba556…) ÎN ACELAȘI bloc, după gardă și doar
-- dacă versiunea curentă e EXACT cea pusă de 20261025a (corp md5 cdb15a2a… + atribute + ACL) — altfel refuz fără nicio
-- modificare, ca să nu calce o versiune mai nouă (review Copilot r1 P1 #3). Totul într-un singur DO: o gardă refuzată nu
-- lasă nimic în urmă, indiferent de modul de rulare.
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261025a', 'OFERTARE_PROVENIENTA_REVENIRE:' || txid_current(), true);
DO $revenire$
BEGIN
  IF current_setting('gazpet.revenire_20261025a', true) IS DISTINCT FROM 'OFERTARE_PROVENIENTA_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261025a=%') THEN
    RAISE EXCEPTION '20261025a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261025a: necesita postgres'; END IF;
  IF to_regprocedure('public.fn_ofertare_surse_valideaza()') IS NULL THEN RAISE EXCEPTION '20261025a: migrarea nu e aplicata'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'cdb15a2a246a590a5172ba4ed3ce9b30'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20261025a: RPC-ul de transfer nu mai e versiunea pusa de migrare (md5 cdb15a2a… / atribute) — revenire oprita, nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  CREATE TABLE IF NOT EXISTS public.ofertare_provenienta_arhiva_revenire (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    la timestamptz NOT NULL DEFAULT now(),
    continut jsonb NOT NULL
  );
  ALTER TABLE public.ofertare_provenienta_arhiva_revenire ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.ofertare_provenienta_arhiva_revenire FROM PUBLIC, anon, authenticated, service_role;

  INSERT INTO public.ofertare_provenienta_arhiva_revenire (continut)
  SELECT jsonb_build_object(
    'clarificari', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'surse_cerinte_ids', surse_cerinte_ids,
                      'surse_cantitati_ids', surse_cantitati_ids, 'surse_document_ids', surse_document_ids) ORDER BY id), '[]'::jsonb)
                      FROM public.ofertare_clarificari
                     WHERE surse_cerinte_ids IS NOT NULL OR surse_cantitati_ids IS NOT NULL OR surse_document_ids IS NOT NULL),
    'cantitati', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'surse_document_ids', surse_document_ids) ORDER BY id), '[]'::jsonb)
                    FROM public.ofertare_cantitati WHERE surse_document_ids IS NOT NULL));

  DROP TRIGGER a02_ofertare_clarificari_surse ON public.ofertare_clarificari;
  DROP TRIGGER a02_ofertare_cantitati_surse ON public.ofertare_cantitati;
  DROP FUNCTION public.fn_ofertare_surse_valideaza();
  ALTER TABLE public.ofertare_clarificari DROP COLUMN surse_cerinte_ids, DROP COLUMN surse_cantitati_ids, DROP COLUMN surse_document_ids;
  ALTER TABLE public.ofertare_cantitati DROP COLUMN surse_document_ids;

  -- RPC-ul de transfer: corpul exact de dinainte de 20261025a (CREATE OR REPLACE păstrează owner + ACL)
  EXECUTE $cod$
CREATE OR REPLACE FUNCTION public.ofertare_transfer_plansa_cantitati(p_doc_id bigint, p_rulare text, p_randuri jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_doc record; v_tr jsonb; r jsonb; v_row jsonb; v_patch jsonb; v_n int; v_adaugate int := 0; v_actualizate int := 0; v_sarite int := 0;
BEGIN
  SELECT id, licitatie_id, analiza INTO v_doc FROM ofertare_documente_atribuire WHERE id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('eroare', 'lease_pierdut', 'motiv', 'document inexistent'); END IF;
  v_tr := v_doc.analiza -> 'citire_ai' -> 'transfer';
  IF v_tr IS NULL OR v_tr ->> 'rulare' IS DISTINCT FROM p_rulare OR v_tr ->> 'stare' IS DISTINCT FROM 'in_curs' THEN
    RETURN jsonb_build_object('eroare', 'lease_pierdut');
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_randuri, '[]'::jsonb)) LOOP
    IF r ->> 'op' = 'update' THEN
      v_patch := r -> 'patch';
      UPDATE ofertare_cantitati SET
        cantitate_plansa = CASE WHEN v_patch ? 'cantitate_plansa' THEN (v_patch ->> 'cantitate_plansa')::numeric ELSE cantitate_plansa END,
        diferenta_nota   = CASE WHEN v_patch ? 'diferenta_nota' THEN v_patch ->> 'diferenta_nota' ELSE diferenta_nota END,
        status           = CASE WHEN v_patch ? 'status' THEN v_patch ->> 'status' ELSE status END,
        updated_at       = now()
      WHERE id = (r ->> 'id')::bigint AND licitatie_id = v_doc.licitatie_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_actualizate := v_actualizate + v_n;
    ELSIF r ->> 'op' = 'insert' THEN
      v_row := r -> 'row';
      IF EXISTS (SELECT 1 FROM ofertare_cantitati WHERE licitatie_id = v_doc.licitatie_id AND denumire = v_row ->> 'denumire'
                   AND sursa IS NOT DISTINCT FROM v_row ->> 'sursa') THEN
        v_sarite := v_sarite + 1; CONTINUE;
      END IF;
      INSERT INTO ofertare_cantitati (licitatie_id, denumire, um, cantitate, cantitate_plansa, status, extras_de_ai, sursa, specificatii, diferenta_nota)
      VALUES (v_doc.licitatie_id, v_row ->> 'denumire', v_row ->> 'um', (v_row ->> 'cantitate')::numeric,
              (v_row ->> 'cantitate_plansa')::numeric, COALESCE(v_row ->> 'status', 'extras'),
              COALESCE((v_row ->> 'extras_de_ai')::boolean, true), v_row ->> 'sursa', v_row ->> 'specificatii', v_row ->> 'diferenta_nota');
      v_adaugate := v_adaugate + 1;
    END IF;
  END LOOP;
  UPDATE ofertare_documente_atribuire SET analiza = jsonb_set(
      jsonb_set(analiza, '{citire_ai,transfer}', v_tr || jsonb_build_object('stare', 'facut', 'la', to_jsonb(now()))),
      '{citire_ai,rev}', to_jsonb(gen_random_uuid()::text))
  WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'adaugate', v_adaugate, 'actualizate', v_actualizate, 'sarite_existente', v_sarite);
END; $function$
$cod$;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.ofertare_transfer_plansa_cantitati(bigint,text,jsonb)')
                    AND md5(replace(p.prosrc, chr(13), '')) = 'c00ba5566c7d231ef7eefe926a8ed56a'
                    AND p.prosecdef AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20261025a: RPC-ul de transfer nu a revenit exact la versiunea veche (md5 c00ba556…)';
  END IF;

  IF current_setting('gazpet.revenire_20261025a', true) IS DISTINCT FROM 'OFERTARE_PROVENIENTA_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda final invalida';
  END IF;
END
$revenire$;