-- #65 (14.09.2026): nomenclatorul ISC RTE legat de motorul de acoperire + varianta A.
-- 1. domeniu_rte: codul din isc_rte_domenii pe care motorul l-a stabilit pentru cerinta (din obiectul
--    contractului + textul cerintei), ca omul sa vada PE CE domeniu s-a judecat acoperirea.
-- 2. status/mod 'regula_propunere': cerinta e o REGULA de alcatuire a echipei (cumul functii, o persoana
--    pe un singur rol etc.) — nu se acopera cu un document, se verifica la propunerea tehnica.
--    Pana acum astea intrau la 'nu_se_aplica' si dispareau (Domnesti #4090).
ALTER TABLE public.ofertare_acoperire ADD COLUMN IF NOT EXISTS domeniu_rte text;
ALTER TABLE public.ofertare_acoperire DROP CONSTRAINT IF EXISTS ofertare_acoperire_mod_check;
ALTER TABLE public.ofertare_acoperire ADD CONSTRAINT ofertare_acoperire_mod_check
  CHECK (mod = ANY (ARRAY['firma','personal','partener','gol','nu_se_aplica','experienta','regula_propunere']));
ALTER TABLE public.ofertare_acoperire DROP CONSTRAINT IF EXISTS ofertare_acoperire_status_check;
ALTER TABLE public.ofertare_acoperire ADD CONSTRAINT ofertare_acoperire_status_check
  CHECK (status = ANY (ARRAY['acoperit','acoperit_partener','gol','in_lucru','nu_se_aplica','regula_propunere']));

CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_rescrie(p_randuri jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      v_conflicte := v_conflicte || r.cerinta_id;
      CONTINUE;
    END IF;

    UPDATE public.ofertare_acoperire
       SET mod = r.mod, autorizatie_id = r.autorizatie_id, doc_firma_id = r.doc_firma_id,
           partener_id = r.partener_id, experienta_id = r.experienta_id,
           referinta_text = r.referinta_text, status = r.status,
           valabil_la_depunere = r.valabil_la_depunere, domeniu_rte = r.domeniu_rte, updated_at = now()
     WHERE cerinta_id = r.cerinta_id AND NOT verificat_pe_scan;

    IF NOT FOUND THEN
      INSERT INTO public.ofertare_acoperire
        (cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id, experienta_id,
         referinta_text, status, valabil_la_depunere, verificat_pe_scan, domeniu_rte)
      VALUES
        (r.cerinta_id, r.mod, r.autorizatie_id, r.doc_firma_id, r.partener_id, r.experienta_id,
         r.referinta_text, r.status, r.valabil_la_depunere, false, r.domeniu_rte);
    END IF;

    v_scrise := v_scrise || r.cerinta_id;
  END LOOP;

  RETURN jsonb_build_object('scrise', to_jsonb(v_scrise), 'conflicte', to_jsonb(v_conflicte));
END;
$function$;
