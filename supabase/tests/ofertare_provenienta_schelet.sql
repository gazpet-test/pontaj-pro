-- Schelet sintetic LOCAL pentru 20261025a_ofertare_provenienta_derivate — peste scheletul loturi (ofertare_loturi_mvp_schelet.sql)
-- + 20261024b livrată. NICIODATĂ pe producție (garda de mai jos). Adaugă doar ce atinge 20261025a:
--   * coloanele de pe ofertare_cantitati / ofertare_documente_atribuire folosite de RPC-ul de transfer;
--   * ofertare_clarificari redusă la coloanele relevante (RLS ca în producție: doar cine are acces la Ofertare);
--   * ofertare_transfer_plansa_cantitati cu corpul EXACT din producție (citit 12.10.2026, md5(prosrc) c00ba556…) — harness-ul
--     verifică md5-ul, deci și fidelitatea copiei din ROLLBACK — și drepturile din producție (doar postgres + service_role).
DO $garda$ BEGIN
  IF current_database() <> 'ofertare_loturi_test' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Schelet permis numai pe ofertare_loturi_test local';
  END IF;
END $garda$;

ALTER TABLE public.ofertare_cantitati
  ADD COLUMN um text, ADD COLUMN cantitate numeric, ADD COLUMN cantitate_plansa numeric, ADD COLUMN extras_de_ai boolean DEFAULT true,
  ADD COLUMN sursa text, ADD COLUMN specificatii text, ADD COLUMN diferenta_nota text, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.ofertare_documente_atribuire ADD COLUMN analiza jsonb;

CREATE TABLE public.ofertare_clarificari(
  id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL, nr integer, intrebare text, sursa text,
  status text NOT NULL DEFAULT 'propunere', origine text, cheie text, baza_generare jsonb, raspuns text,
  updated_at timestamptz DEFAULT now(), UNIQUE (licitatie_id, cheie));
ALTER TABLE public.ofertare_clarificari ENABLE ROW LEVEL SECURITY;
CREATE POLICY clar_acces ON public.ofertare_clarificari FOR ALL TO authenticated
  USING (public.fn_are_acces_ofertare()) WITH CHECK (public.fn_are_acces_ofertare());
-- cerințele: RLS fără nicio politică pentru authenticated — validarea (SECURITY DEFINER) trebuie să le vadă oricum
ALTER TABLE public.ofertare_cerinte ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.ofertare_transfer_plansa_cantitati(p_doc_id bigint, p_rulare text, p_randuri jsonb)
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
END; $function$;
REVOKE ALL ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint, text, jsonb) TO service_role;
