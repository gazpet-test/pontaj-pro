-- Aplicata pe 12.09.2026 prin apply_migration (numele migrarii:
-- ofertare_acoperire_index_unic_si_rescriere_atomica). Pastrata aici pentru istoric.
--
-- Un singur rand AI (nevalidat) per cerinta. Randurile verificate de om raman in afara
-- predicatului: o cerinta poate avea dovada verificata SI propunerea AI.
CREATE UNIQUE INDEX IF NOT EXISTS ofertare_acoperire_cerinta_unic_nevalidat
  ON public.ofertare_acoperire (cerinta_id) WHERE verificat_pe_scan = false;

-- Rescrierea acoperirilor unei felii, INTR-O SINGURA tranzactie. Vezi comentariile din
-- supabase/functions/ofertare-acoperire/index.ts pentru de ce.
CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_rescrie(p_randuri jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ids bigint[];
  v_id bigint;
  v_conflicte bigint[] := '{}';
  v_scrise bigint[] := '{}';
  r record;
BEGIN
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' THEN
    RAISE EXCEPTION 'p_randuri trebuie sa fie un array JSON';
  END IF;

  SELECT array_agg(DISTINCT (x->>'cerinta_id')::bigint ORDER BY (x->>'cerinta_id')::bigint)
    INTO v_ids
    FROM jsonb_array_elements(p_randuri) x
   WHERE x->>'cerinta_id' IS NOT NULL;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('scrise', '[]'::jsonb, 'conflicte', '[]'::jsonb);
  END IF;

  -- blocare in ordine crescatoare, una cate una: ordinea e garantata, nu lasata pe seama planului
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.ofertare_cerinte WHERE id = v_id FOR UPDATE;
  END LOOP;

  FOR r IN
    SELECT DISTINCT ON ((x->>'cerinta_id')::bigint)
           (x->>'cerinta_id')::bigint                  AS cerinta_id,
           x->>'mod'                                   AS mod,
           NULLIF(x->>'autorizatie_id','')::bigint     AS autorizatie_id,
           NULLIF(x->>'doc_firma_id','')::bigint       AS doc_firma_id,
           NULLIF(x->>'partener_id','')::bigint        AS partener_id,
           x->>'referinta_text'                        AS referinta_text,
           x->>'status'                                AS status,
           NULLIF(x->>'valabil_la_depunere','')::boolean AS valabil_la_depunere
      FROM jsonb_array_elements(p_randuri) x
     WHERE x->>'cerinta_id' IS NOT NULL
     ORDER BY (x->>'cerinta_id')::bigint
  LOOP
    IF EXISTS (SELECT 1 FROM public.ofertare_acoperire
                WHERE cerinta_id = r.cerinta_id AND verificat_pe_scan) THEN
      v_conflicte := v_conflicte || r.cerinta_id;
      CONTINUE;
    END IF;

    UPDATE public.ofertare_acoperire
       SET mod = r.mod, autorizatie_id = r.autorizatie_id, doc_firma_id = r.doc_firma_id,
           partener_id = r.partener_id, referinta_text = r.referinta_text, status = r.status,
           valabil_la_depunere = r.valabil_la_depunere, updated_at = now()
     WHERE cerinta_id = r.cerinta_id AND NOT verificat_pe_scan;

    IF NOT FOUND THEN
      INSERT INTO public.ofertare_acoperire
        (cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id,
         referinta_text, status, valabil_la_depunere, verificat_pe_scan)
      VALUES
        (r.cerinta_id, r.mod, r.autorizatie_id, r.doc_firma_id, r.partener_id,
         r.referinta_text, r.status, r.valabil_la_depunere, false);
    END IF;

    v_scrise := v_scrise || r.cerinta_id;
  END LOOP;

  RETURN jsonb_build_object('scrise', to_jsonb(v_scrise), 'conflicte', to_jsonb(v_conflicte));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_ofertare_acoperire_rescrie(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_acoperire_rescrie(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_acoperire_rescrie(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_acoperire_rescrie(jsonb) TO service_role;
