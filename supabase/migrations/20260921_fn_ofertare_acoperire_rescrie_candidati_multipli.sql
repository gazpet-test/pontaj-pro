-- Motorul poate propune mai mulți candidați pe o cerință. Scrierea devine RECONCILIERE.
--
-- Ce era: `SELECT DISTINCT ON (cerinta_id)` păstra UN singur rând per cerință, apoi UPDATE
-- peste el. Chiar dacă AI-ul ar fi întors trei variante, două se pierdeau tăcut în RPC —
-- de-asta ecranul „alege mereu Dădulescu": nu promptul, ci scrierea.
--
-- Ce e acum: rândurile intră toate, identificate prin CE candidat sunt (mod + legătura),
-- nu prin poziția lor în listă. Un candidat care revine la o rerulare își păstrează `id`-ul,
-- deci păstrează și ce a pus omul peste el (`raspuns_coleg`, `raspuns_de`, `tichet_id`).
-- Un candidat care dispare din propunere se șterge DOAR dacă n-are nicio urmă umană.
--
-- Trei lucruri pe care funcția NU le atinge, niciodată:
--   · cerințele cu `verificat_pe_scan` sau `ales_de` — poarta de la 21.09.2026;
--   · rândurile cu `pozitie_id` — alea sunt alegeri pe poziții, făcute de om;
--   · `ales` — motorul propune, nu alege. Rândurile noi intră cu `ales = false`.

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
  v_scrise    bigint[] := '{}';
  v_sterse int := 0;
  v_pastrate int := 0;
  v_candidati int := 0;
BEGIN
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' THEN
    RAISE EXCEPTION 'p_randuri trebuie sa fie un array JSON';
  END IF;

  SELECT array_agg(DISTINCT (x->>'cerinta_id')::bigint ORDER BY (x->>'cerinta_id')::bigint)
    INTO v_ids FROM jsonb_array_elements(p_randuri) x WHERE x->>'cerinta_id' IS NOT NULL;
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('scrise','[]'::jsonb,'conflicte','[]'::jsonb,
                              'pe_scan','[]'::jsonb,'alese_de_om','[]'::jsonb,
                              'candidati',0,'sterse',0,'pastrate_cu_urma_umana',0);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.ofertare_cerinte WHERE id = v_id FOR UPDATE;
  END LOOP;

  -- Cerințele pe care nu avem voie să le atingem, stabilite o dată, nu în buclă.
  SELECT coalesce(array_agg(DISTINCT cerinta_id), '{}') INTO v_pe_scan
  FROM public.ofertare_acoperire
  WHERE cerinta_id = ANY(v_ids) AND verificat_pe_scan;

  SELECT coalesce(array_agg(DISTINCT cerinta_id), '{}') INTO v_alese_om
  FROM public.ofertare_acoperire
  WHERE cerinta_id = ANY(v_ids) AND ales_de IS NOT NULL AND NOT (cerinta_id = ANY(v_pe_scan));

  v_conflicte := v_pe_scan || v_alese_om;

  -- Identitatea unui candidat = ce anume propune, nu unde stă în listă. Se calculează aici,
  -- în CREATE TABLE AS, nu printr-un UPDATE ulterior: rolul prin care intră Edge Function-ul
  -- rulează cu `safeupdate` pornit, iar Postgres refuză UPDATE/DELETE fără WHERE. Prin MCP
  -- (alt rol) trecea, deci n-a ieșit la teste — prima rulare reală a picat cu
  -- „UPDATE requires a WHERE clause", tranzacția s-a anulat și felia de AI s-a plătit degeaba.
  CREATE TEMP TABLE _noi ON COMMIT DROP AS
  SELECT t.*, concat_ws('|', t.mod,
           coalesce(t.autorizatie_id::text,''), coalesce(t.doc_firma_id::text,''),
           coalesce(t.partener_id::text,''), coalesce(t.experienta_id::text,''),
           coalesce(t.recomandare_id::text,''), coalesce(t.document_personal_id::text,'')) AS cheie
  FROM (
  SELECT (x->>'cerinta_id')::bigint                       AS cerinta_id,
         x->>'mod'                                        AS mod,
         NULLIF(x->>'autorizatie_id','')::bigint          AS autorizatie_id,
         NULLIF(x->>'doc_firma_id','')::bigint            AS doc_firma_id,
         NULLIF(x->>'partener_id','')::bigint             AS partener_id,
         NULLIF(x->>'experienta_id','')::bigint           AS experienta_id,
         NULLIF(x->>'recomandare_id','')::bigint          AS recomandare_id,
         NULLIF(x->>'document_personal_id','')::bigint    AS document_personal_id,
         x->>'referinta_text'                             AS referinta_text,
         x->>'status'                                     AS status,
         NULLIF(x->>'valabil_la_depunere','')::boolean    AS valabil_la_depunere,
         NULLIF(x->>'domeniu_rte','')                     AS domeniu_rte,
         NULLIF(x->>'scor','')::smallint                  AS scor,
         x->>'motiv'                                      AS motiv,
         row_number() OVER (PARTITION BY (x->>'cerinta_id')::bigint ORDER BY ordinalitate) AS rang
    FROM jsonb_array_elements(p_randuri) WITH ORDINALITY AS e(x, ordinalitate)
   WHERE x->>'cerinta_id' IS NOT NULL
     AND NOT ((x->>'cerinta_id')::bigint = ANY(v_conflicte))
  ) t;

  -- Cel mult 3 candidați per cerință. Plafonul stă AICI, nu doar în prompt: promptul e o
  -- rugăminte către model, asta e o limită. Fără ea, un răspuns scăpat de sub control ar
  -- putea umple ecranul omului cu zeci de variante.
  DELETE FROM _noi WHERE rang > 3;

  -- Același candidat propus de două ori în aceeași felie: păstrăm prima apariție.
  DELETE FROM _noi a USING _noi b
   WHERE a.cerinta_id = b.cerinta_id AND a.cheie = b.cheie AND a.rang > b.rang;

  -- 1. Candidatul care revine își păstrează rândul, deci și ce a scris omul peste el.
  UPDATE public.ofertare_acoperire a
     SET status = n.status, referinta_text = n.referinta_text, motiv = n.motiv, scor = n.scor,
         valabil_la_depunere = n.valabil_la_depunere, domeniu_rte = n.domeniu_rte,
         updated_at = now()
    FROM _noi n
   WHERE a.cerinta_id = n.cerinta_id
     AND a.pozitie_id IS NULL AND a.ales_de IS NULL AND NOT a.verificat_pe_scan
     AND concat_ws('|', a.mod,
           coalesce(a.autorizatie_id::text,''), coalesce(a.doc_firma_id::text,''),
           coalesce(a.partener_id::text,''), coalesce(a.experienta_id::text,''),
           coalesce(a.recomandare_id::text,''), coalesce(a.document_personal_id::text,'')) = n.cheie;

  -- 2. Candidatul nou intră ca propunere, niciodată ca alegere.
  INSERT INTO public.ofertare_acoperire
    (cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id, experienta_id, recomandare_id,
     document_personal_id, referinta_text, status, valabil_la_depunere, verificat_pe_scan,
     domeniu_rte, scor, motiv, ales)
  SELECT n.cerinta_id, n.mod, n.autorizatie_id, n.doc_firma_id, n.partener_id, n.experienta_id,
         n.recomandare_id, n.document_personal_id, n.referinta_text, n.status,
         n.valabil_la_depunere, false, n.domeniu_rte, n.scor, n.motiv, false
    FROM _noi n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.ofertare_acoperire a
      WHERE a.cerinta_id = n.cerinta_id AND a.pozitie_id IS NULL
        AND a.ales_de IS NULL AND NOT a.verificat_pe_scan
        AND concat_ws('|', a.mod,
              coalesce(a.autorizatie_id::text,''), coalesce(a.doc_firma_id::text,''),
              coalesce(a.partener_id::text,''), coalesce(a.experienta_id::text,''),
              coalesce(a.recomandare_id::text,''), coalesce(a.document_personal_id::text,'')) = n.cheie);

  -- 3. Candidatul care nu mai e propus pleacă — dar numai dacă n-a trecut nimeni pe la el.
  --    Un răspuns de coleg sau un tichet e muncă omenească: rândul rămâne, ca să se vadă
  --    că motorul s-a răzgândit, nu ca să dispară discuția.
  WITH atinse AS (SELECT DISTINCT cerinta_id FROM _noi),
  vechi AS (
    SELECT a.id, (a.raspuns_coleg IS NOT NULL OR a.tichet_id IS NOT NULL) AS are_urma
      FROM public.ofertare_acoperire a
      JOIN atinse t ON t.cerinta_id = a.cerinta_id
     WHERE a.pozitie_id IS NULL AND a.ales_de IS NULL AND NOT a.verificat_pe_scan AND NOT a.ales
       AND NOT EXISTS (
         SELECT 1 FROM _noi n WHERE n.cerinta_id = a.cerinta_id
           AND n.cheie = concat_ws('|', a.mod,
                 coalesce(a.autorizatie_id::text,''), coalesce(a.doc_firma_id::text,''),
                 coalesce(a.partener_id::text,''), coalesce(a.experienta_id::text,''),
                 coalesce(a.recomandare_id::text,''), coalesce(a.document_personal_id::text,'')))
  ), gone AS (
    DELETE FROM public.ofertare_acoperire WHERE id IN (SELECT id FROM vechi WHERE NOT are_urma)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM gone), (SELECT count(*) FROM vechi WHERE are_urma)
    INTO v_sterse, v_pastrate;

  SELECT coalesce(array_agg(DISTINCT cerinta_id ORDER BY cerinta_id), '{}'), count(*)
    INTO v_scrise, v_candidati FROM _noi;

  RETURN jsonb_build_object('scrise', to_jsonb(v_scrise), 'conflicte', to_jsonb(v_conflicte),
                            'pe_scan', to_jsonb(v_pe_scan), 'alese_de_om', to_jsonb(v_alese_om),
                            'candidati', v_candidati, 'sterse', v_sterse,
                            'pastrate_cu_urma_umana', v_pastrate);
END;
$function$;
