-- Rerularea motorului nu mai calcă peste ce a ales un om.
--
-- Până acum poarta se uita doar la `verificat_pe_scan`. Dar un coleg care alege din registru
-- („Caută în firmă") nu bifează nimic pe scan — pune o alegere. UPDATE-ul de mai jos rescria
-- `referinta_text`, `status` și toate legăturile, deci alegerea lui dispărea la următoarea
-- rulare, fără mesaj. Pe 21.09.2026 erau 5 astfel de alegeri (Mirela Roșu ×2, Oana Nica ×3),
-- recuperabile doar din textul „ales manual de ...".
--
-- Acum poarta e `verificat_pe_scan OR ales_de IS NOT NULL`, iar motivul se întoarce separat,
-- ca UI-ul să poată spune „verificat pe scan" și „ales de un coleg" cu cuvinte diferite.

CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_rescrie(p_randuri jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[];
  v_id bigint;
  v_conflicte bigint[] := '{}';
  v_pe_scan   bigint[] := '{}';
  v_alese_om  bigint[] := '{}';
  v_scrise bigint[] := '{}';
  r record;
BEGIN
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' THEN
    RAISE EXCEPTION 'p_randuri trebuie sa fie un array JSON';
  END IF;
  SELECT array_agg(DISTINCT (x->>'cerinta_id')::bigint ORDER BY (x->>'cerinta_id')::bigint)
    INTO v_ids FROM jsonb_array_elements(p_randuri) x WHERE x->>'cerinta_id' IS NOT NULL;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('scrise', '[]'::jsonb, 'conflicte', '[]'::jsonb,
                              'pe_scan', '[]'::jsonb, 'alese_de_om', '[]'::jsonb);
  END IF;
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
           NULLIF(x->>'experienta_id','')::bigint      AS experienta_id,
           NULLIF(x->>'recomandare_id','')::bigint     AS recomandare_id,
           NULLIF(x->>'document_personal_id','')::bigint AS document_personal_id,
           x->>'referinta_text'                        AS referinta_text,
           x->>'status'                                AS status,
           NULLIF(x->>'valabil_la_depunere','')::boolean AS valabil_la_depunere,
           NULLIF(x->>'domeniu_rte','')                AS domeniu_rte
      FROM jsonb_array_elements(p_randuri) x
     WHERE x->>'cerinta_id' IS NOT NULL
     ORDER BY (x->>'cerinta_id')::bigint
  LOOP
    IF EXISTS (SELECT 1 FROM public.ofertare_acoperire
                WHERE cerinta_id = r.cerinta_id AND verificat_pe_scan) THEN
      v_pe_scan   := v_pe_scan   || r.cerinta_id;
      v_conflicte := v_conflicte || r.cerinta_id;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ofertare_acoperire
                WHERE cerinta_id = r.cerinta_id AND ales_de IS NOT NULL) THEN
      v_alese_om  := v_alese_om  || r.cerinta_id;
      v_conflicte := v_conflicte || r.cerinta_id;
      CONTINUE;
    END IF;

    UPDATE public.ofertare_acoperire
       SET mod = r.mod, autorizatie_id = r.autorizatie_id, doc_firma_id = r.doc_firma_id,
           partener_id = r.partener_id, experienta_id = r.experienta_id, recomandare_id = r.recomandare_id,
           document_personal_id = r.document_personal_id,
           referinta_text = r.referinta_text, status = r.status,
           valabil_la_depunere = r.valabil_la_depunere, domeniu_rte = r.domeniu_rte, updated_at = now()
     WHERE cerinta_id = r.cerinta_id AND NOT verificat_pe_scan AND ales_de IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.ofertare_acoperire
        (cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id, experienta_id, recomandare_id,
         document_personal_id, referinta_text, status, valabil_la_depunere, verificat_pe_scan, domeniu_rte)
      VALUES
        (r.cerinta_id, r.mod, r.autorizatie_id, r.doc_firma_id, r.partener_id, r.experienta_id, r.recomandare_id,
         r.document_personal_id, r.referinta_text, r.status, r.valabil_la_depunere, false, r.domeniu_rte);
    END IF;
    v_scrise := v_scrise || r.cerinta_id;
  END LOOP;
  RETURN jsonb_build_object('scrise', to_jsonb(v_scrise), 'conflicte', to_jsonb(v_conflicte),
                            'pe_scan', to_jsonb(v_pe_scan), 'alese_de_om', to_jsonb(v_alese_om));
END;
$function$;
