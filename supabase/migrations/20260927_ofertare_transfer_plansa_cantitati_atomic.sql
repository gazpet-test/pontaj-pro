-- R4 (Copilot): transferul citirii planșei în ofertare_cantitati devine ATOMIC.
-- Verificarea lease-ului (analiza->citire_ai->transfer: rulare + stare='in_curs') și TOATE scrierile în
-- ofertare_cantitati + marcarea transfer.stare='facut' se fac în aceeași tranzacție, sub FOR UPDATE pe doc.
-- Idempotență: insert doar dacă nu există deja (licitatie_id, denumire, sursa) — sursa e determinist per planșă
-- ('Planșa X — tabel de dimensionare…'); lock-ul pe doc serializează transferurile aceluiași document.
-- p_randuri: [{op:'update', id, patch:{cantitate_plansa, diferenta_nota, status?}} | {op:'insert', row:{...}}]
-- Apelată DOAR cu service_role din edge fn ofertare-plansa-citeste.
CREATE OR REPLACE FUNCTION public.ofertare_transfer_plansa_cantitati(p_doc_id bigint, p_rulare text, p_randuri jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc record;
  v_tr jsonb;
  r jsonb;
  v_row jsonb;
  v_patch jsonb;
  v_n int;
  v_adaugate int := 0;
  v_actualizate int := 0;
  v_sarite int := 0;
BEGIN
  SELECT id, licitatie_id, analiza INTO v_doc
  FROM ofertare_documente_atribuire WHERE id = p_doc_id FOR UPDATE;
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
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_actualizate := v_actualizate + v_n;
    ELSIF r ->> 'op' = 'insert' THEN
      v_row := r -> 'row';
      IF EXISTS (SELECT 1 FROM ofertare_cantitati
                 WHERE licitatie_id = v_doc.licitatie_id AND denumire = v_row ->> 'denumire'
                   AND sursa IS NOT DISTINCT FROM v_row ->> 'sursa') THEN
        v_sarite := v_sarite + 1;
        CONTINUE;
      END IF;
      INSERT INTO ofertare_cantitati (licitatie_id, denumire, um, cantitate, cantitate_plansa, status, extras_de_ai,
                                      sursa, specificatii, diferenta_nota)
      VALUES (v_doc.licitatie_id, v_row ->> 'denumire', v_row ->> 'um', (v_row ->> 'cantitate')::numeric,
              (v_row ->> 'cantitate_plansa')::numeric, COALESCE(v_row ->> 'status', 'extras'),
              COALESCE((v_row ->> 'extras_de_ai')::boolean, true), v_row ->> 'sursa', v_row ->> 'specificatii',
              v_row ->> 'diferenta_nota');
      v_adaugate := v_adaugate + 1;
    END IF;
  END LOOP;

  -- lease încheiat în aceeași tranzacție; rev nou ca scrierile CAS concurente (pe rev vechi) să eșueze și să recitească
  UPDATE ofertare_documente_atribuire SET analiza = jsonb_set(
      jsonb_set(analiza, '{citire_ai,transfer}', v_tr || jsonb_build_object('stare', 'facut', 'la', to_jsonb(now()))),
      '{citire_ai,rev}', to_jsonb(gen_random_uuid()::text))
  WHERE id = p_doc_id;

  RETURN jsonb_build_object('ok', true, 'adaugate', v_adaugate, 'actualizate', v_actualizate, 'sarite_existente', v_sarite);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_transfer_plansa_cantitati(bigint, text, jsonb) TO service_role;
