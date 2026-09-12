-- Provenienta fina se pierdea: RPC-ul scria sursa_sectiune = titlul setului pe TOATE randurile
-- aplicate, deci detaliul „Clarificarea nr. 7, pct. 8" — singurul care spune UNDE anume in raspuns
-- scrie asta — disparea. Acum operatia isi poate duce propria sectiune; titlul setului ramane
-- doar ca varianta de rezerva.
CREATE OR REPLACE FUNCTION public.fn_ofertare_raspuns_set_aplica(
  p_set_id bigint,
  p_op_ids text[],
  p_actor uuid,
  p_dupa_depunere boolean DEFAULT false,
  p_motiv text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lic bigint; v_status text; v_prop jsonb; v_lot text; v_titlu text;
  v_rezultat jsonb; v_ids bigint[]; v_id bigint; v_op jsonb; v_c record;
  v_nou_id bigint; v_amp text; v_amp_prop text; v_text_nou text; v_sect text;
  v_aplicate jsonb := '[]'::jsonb; v_conflicte jsonb := '[]'::jsonb;
  v_nr_ordine int; v_snapshot jsonb; v_mutate int; v_dubla boolean;
  v_nr_mod int := 0; v_nr_anul int := 0; v_nr_noi int := 0; v_nr_acop int := 0;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  -- 0) Reluare dupa un commit al carui raspuns s-a pierdut: acelasi key, acelasi rezultat, zero scrieri.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT rezultat INTO v_rezultat FROM public.ofertare_raspuns_set
     WHERE id = p_set_id AND idempotency_key = p_idempotency_key AND rezultat IS NOT NULL;
    IF v_rezultat IS NOT NULL THEN RETURN v_rezultat || jsonb_build_object('reluare', true); END IF;
  END IF;

  IF p_op_ids IS NULL OR array_length(p_op_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'nicio operatie selectata' USING ERRCODE = '22023';
  END IF;

  -- 1) Ordinea de blocare, fixa peste tot: licitatie -> set -> cerinte (id crescator).
  SELECT licitatie_id INTO v_lic FROM public.ofertare_raspuns_set WHERE id = p_set_id;
  IF v_lic IS NULL THEN RAISE EXCEPTION 'setul % nu exista', p_set_id USING ERRCODE = 'P0002'; END IF;

  SELECT status INTO v_status FROM public.ofertare_licitatii WHERE id = v_lic FOR NO KEY UPDATE;

  SELECT propunere, lot, titlu INTO v_prop, v_lot, v_titlu
    FROM public.ofertare_raspuns_set WHERE id = p_set_id FOR UPDATE;
  IF v_prop IS NULL OR jsonb_typeof(v_prop -> 'operatii') <> 'array' THEN
    RAISE EXCEPTION 'setul % nu are propunere generata', p_set_id USING ERRCODE = 'P0002';
  END IF;

  -- 2) Whitelist de status, nu blacklist: 'incheiata' nu exista in CHECK, iar castigata/pierduta
  --    lipseau din lista negativa initiala.
  IF v_status IN ('castigata','pierduta','abandonata') THEN
    RAISE EXCEPTION 'licitatia e in starea „%" — registrul nu se mai modifica', v_status USING ERRCODE = '42501';
  ELSIF v_status = 'depusa' THEN
    IF NOT p_dupa_depunere OR btrim(coalesce(p_motiv,'')) = '' THEN
      RAISE EXCEPTION 'licitatia e depusa: aplicarea cere confirmare explicita si motiv scris' USING ERRCODE = '42501';
    END IF;
  ELSIF v_status NOT IN ('identificata','analiza','go','in_lucru') THEN
    RAISE EXCEPTION 'status neasteptat pentru aplicare: „%"', v_status USING ERRCODE = '42501';
  END IF;

  -- 3) Blocarea cerintelor vizate, o data, in ordine crescatoare de id (anti-deadlock cu
  --    fn_ofertare_acoperire_rescrie, care foloseste aceeasi ordine pe acelasi tabel).
  SELECT array_agg(DISTINCT (o ->> 'cerinta_id')::bigint ORDER BY (o ->> 'cerinta_id')::bigint)
    INTO v_ids
    FROM jsonb_array_elements(v_prop -> 'operatii') o
   WHERE o ->> 'op_id' = ANY (p_op_ids) AND o ->> 'cerinta_id' IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM 1 FROM public.ofertare_cerinte WHERE id = v_id FOR UPDATE;
    END LOOP;
  END IF;

  SELECT coalesce(max(nr_ordine), 0) INTO v_nr_ordine
    FROM public.ofertare_cerinte WHERE licitatie_id = v_lic;

  -- 4) Operatiile, in ordine stabila: intai modificarile/anularile, apoi cerintele noi.
  FOR v_op IN
    SELECT o FROM jsonb_array_elements(v_prop -> 'operatii') o
     WHERE o ->> 'op_id' = ANY (p_op_ids)
     ORDER BY CASE o ->> 'fel' WHEN 'noua' THEN 2 ELSE 1 END,
              (o ->> 'cerinta_id')::bigint NULLS LAST, o ->> 'op_id'
  LOOP
    -- Sectiunea-sursa a operatiei, daca o are; altfel titlul setului.
    v_sect := coalesce(nullif(btrim(coalesce(v_op ->> 'sursa_sectiune','')), ''), v_titlu);

    IF v_op ->> 'fel' IN ('modifica','anuleaza') THEN
      SELECT * INTO v_c FROM public.ofertare_cerinte
       WHERE id = (v_op ->> 'cerinta_id')::bigint;

      IF v_c.id IS NULL OR v_c.licitatie_id <> v_lic THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_op ->> 'cerinta_id', 'motiv', 'cerinta nu exista sau e din alta licitatie');
        CONTINUE;
      END IF;
      IF v_c.inlocuita_de IS NOT NULL OR v_c.duplicat_al IS NOT NULL THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'cerinta nu mai e activa (inlocuita sau marcata duplicat)',
          'text_curent', v_c.text_cerinta);
        CONTINUE;
      END IF;

      -- Amprenta se recalculeaza AICI, sub lock, nu la citirea de dinainte.
      SELECT amprenta INTO v_amp FROM public.fn_ofertare_cerinte_amprente(v_lic, ARRAY[v_c.id]);
      v_amp_prop := v_prop -> 'amprente' ->> (v_c.id::text);
      IF v_amp_prop IS NULL OR v_amp IS DISTINCT FROM v_amp_prop THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'cerinta s-a schimbat intre analiza si aprobare',
          'text_curent', v_c.text_cerinta);
        CONTINUE;
      END IF;

      v_text_nou := CASE WHEN v_op ->> 'fel' = 'anuleaza'
        THEN '[ANULATA prin ' || v_titlu || '] ' || v_c.text_cerinta
        ELSE btrim(coalesce(v_op ->> 'text_nou','')) END;
      IF v_text_nou = '' THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'cerinta_id', v_c.id, 'motiv', 'operatia de modificare nu are text nou');
        CONTINUE;
      END IF;

      -- Fotografia acoperirii pe versiunea VECHE, inainte de mutare. Fara ea nu s-ar mai putea
      -- afla ce dovezi si ce verificari sustineau textul vechi.
      SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb) INTO v_snapshot
        FROM public.ofertare_acoperire a WHERE a.cerinta_id = v_c.id;
      UPDATE public.ofertare_cerinte
         SET acoperire_snapshot = jsonb_build_object(
               'la', now(), 'set_id', p_set_id, 'set_titlu', v_titlu, 'acoperiri', v_snapshot),
             updated_at = now()
       WHERE id = v_c.id;

      INSERT INTO public.ofertare_cerinte (
        licitatie_id, sursa_document_id, sursa_sectiune, sursa_pagina, sursa_pasaj, pasaj_verificat,
        text_cerinta, tip, lot, document_probant, cand_se_prezinta, versiune, raspuns_set_id,
        extras_de_ai, confirmata_de, stare, stare_motiv, stare_de, stare_la, nr_ordine)
      VALUES (
        v_lic,
        nullif(v_op ->> 'document_id','')::bigint,     -- provenienta = documentul de RASPUNS, nu cel vechi
        v_sect,
        nullif(v_op ->> 'pagina','')::int,
        nullif(v_op ->> 'sursa_pasaj',''),
        false,
        v_text_nou,
        v_c.tip,
        v_c.lot,
        v_c.document_probant,                          -- la anulare dovada NU se sterge din istoric
        CASE WHEN v_op ->> 'fel' = 'modifica' AND v_op ->> 'cand_se_prezinta' IN ('duae','depunere','primul_loc')
             THEN v_op ->> 'cand_se_prezinta' ELSE v_c.cand_se_prezinta END,
        coalesce(v_c.versiune, 1) + 1,
        p_set_id,
        true,
        NULL,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN 'nu_se_aplica' ELSE v_c.stare END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza'
             THEN 'anulata prin ' || v_titlu || coalesce(' — ' || nullif(v_op ->> 'motiv',''), '')
             ELSE v_c.stare_motiv END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN p_actor ELSE v_c.stare_de END,
        CASE WHEN v_op ->> 'fel' = 'anuleaza' THEN now() ELSE v_c.stare_la END,
        v_c.nr_ordine)                                  -- versiunea noua ramane pe locul celei vechi
      RETURNING id INTO v_nou_id;

      UPDATE public.ofertare_cerinte SET inlocuita_de = v_nou_id, updated_at = now()
       WHERE id = v_c.id AND inlocuita_de IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'cerinta % a fost inlocuita in paralel', v_c.id USING ERRCODE = '40001';
      END IF;

      UPDATE public.ofertare_acoperire
         SET cerinta_id = v_nou_id,
             reverificare_ceruta = true,
             reverificare_motiv = 'textul cerintei s-a schimbat prin „' || v_titlu || '" (set #'
               || p_set_id || ', de la cerinta #' || v_c.id || ') — revezi dovada',
             updated_at = now()
       WHERE cerinta_id = v_c.id;
      GET DIAGNOSTICS v_mutate = ROW_COUNT;
      v_nr_acop := v_nr_acop + v_mutate;

      IF v_op ->> 'fel' = 'anuleaza' THEN v_nr_anul := v_nr_anul + 1;
      ELSE v_nr_mod := v_nr_mod + 1; END IF;
      v_aplicate := v_aplicate || jsonb_build_object('op_id', v_op ->> 'op_id', 'fel', v_op ->> 'fel',
        'cerinta_veche', v_c.id, 'cerinta_noua', v_nou_id, 'acoperiri_mutate', v_mutate);

    ELSIF v_op ->> 'fel' = 'noua' THEN
      IF btrim(coalesce(v_op ->> 'text_cerinta','')) = '' THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'motiv', 'cerinta noua fara text');
        CONTINUE;
      END IF;
      v_nr_ordine := v_nr_ordine + 1;
      v_dubla := false;
      BEGIN
        INSERT INTO public.ofertare_cerinte (
          licitatie_id, sursa_document_id, sursa_sectiune, sursa_pasaj, pasaj_verificat,
          text_cerinta, tip, lot, document_probant, cand_se_prezinta, versiune, raspuns_set_id,
          extras_de_ai, stare, nr_ordine)
        VALUES (
          v_lic,
          nullif(v_op ->> 'document_id','')::bigint,
          v_sect,
          nullif(v_op ->> 'sursa_pasaj',''),
          false,
          btrim(v_op ->> 'text_cerinta'),
          CASE WHEN v_op ->> 'tip' IN ('eliminatorie','propunere','forma','contractuala')
               THEN v_op ->> 'tip' ELSE 'propunere' END,
          coalesce(nullif(v_op ->> 'lot',''), v_lot),   -- lotul setului, nu NULL
          nullif(v_op ->> 'document_probant',''),
          CASE WHEN v_op ->> 'cand_se_prezinta' IN ('duae','depunere','primul_loc')
               THEN v_op ->> 'cand_se_prezinta' ELSE NULL END,
          1, p_set_id, true, 'de_analizat', v_nr_ordine)
        RETURNING id INTO v_nou_id;
      EXCEPTION WHEN unique_violation THEN
        v_dubla := true;
      END;
      IF v_dubla THEN
        v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
          'motiv', 'cerinta noua a fost deja introdusa de acest set');
        CONTINUE;
      END IF;
      v_nr_noi := v_nr_noi + 1;
      v_aplicate := v_aplicate || jsonb_build_object('op_id', v_op ->> 'op_id', 'fel', 'noua',
        'cerinta_noua', v_nou_id);
    ELSE
      v_conflicte := v_conflicte || jsonb_build_object('op_id', v_op ->> 'op_id',
        'motiv', 'fel necunoscut: ' || coalesce(v_op ->> 'fel','(lipsa)'));
    END IF;
  END LOOP;

  v_rezultat := jsonb_build_object(
    'set_id', p_set_id, 'licitatie_id', v_lic, 'status_licitatie', v_status,
    'modificate', v_nr_mod, 'anulate', v_nr_anul, 'noi', v_nr_noi,
    'acoperiri_mutate', v_nr_acop,
    'aplicate', v_aplicate, 'conflicte', v_conflicte);

  UPDATE public.ofertare_raspuns_set
     SET stare = CASE WHEN jsonb_array_length(v_conflicte) > 0 THEN 'aplicat_partial' ELSE 'aplicat' END,
         aplicat_la = now(), aplicat_de = p_actor,
         aplicat_dupa_depunere = (v_status = 'depusa'),
         aplicat_motiv = CASE WHEN v_status = 'depusa' THEN p_motiv ELSE aplicat_motiv END,
         status_licitatie_la_aplicare = v_status,
         idempotency_key = coalesce(p_idempotency_key, idempotency_key),
         rezultat = v_rezultat,
         updated_at = now()
   WHERE id = p_set_id;

  RETURN v_rezultat;
END
$fn$;
