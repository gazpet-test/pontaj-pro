-- Revenire 20261108b: corpul original din 20261108a (cu bug-ul 42702). Armare: SELECT set_config('gazpet.revenire_20261108b','OCR_ADMITE_FIX_REVENIRE:'||txid_current(),true);
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261108b', true) IS DISTINCT FROM 'OCR_ADMITE_FIX_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261108b: necesita armare per tranzactie';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261108b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ocr_local_admite(uuid,bigint,bigint,text,integer)') IS NULL THEN RAISE EXCEPTION '20261108b: fn_ocr_local_admite lipseste'; END IF;
END $pre$;
CREATE OR REPLACE FUNCTION public.fn_ocr_local_admite(p_user uuid, p_proiect bigint, p_depozit bigint, p_sablon text, p_bytes int)
RETURNS TABLE(id uuid, cale text, termen_upload timestamptz, status text, motiv text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE t timestamptz; c public.ocr_local_config%ROWTYPE; v_id uuid; v_attempt bigint; v_motiv text; x uuid;
BEGIN
  -- Identitate invalidă nu este un apel care a trecut poarta E3.
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = p_user) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'refuzata'::text, 'parametri_invalizi'::text; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ocr_local_cota'));
  t := clock_timestamp();
  SELECT * INTO STRICT c FROM public.ocr_local_config WHERE ocr_local_config.id;
  INSERT INTO public.ocr_local_incercari("user", la, rezultat) VALUES (p_user, t, 'inceputa') RETURNING ocr_local_incercari.id INTO v_attempt;
  -- Include încercarea curentă. Refuzurile rămân comise dacă apelantul comite RPC-ul.
  IF (SELECT count(*) FROM public.ocr_local_incercari WHERE "user" = p_user AND la > t - interval '1 hour') > 60 THEN v_motiv := 'limita_incercari';
  ELSIF p_proiect IS NULL OR p_proiect <= 0 OR p_depozit IS NULL OR p_depozit <= 0
     OR p_sablon IS NULL OR p_sablon NOT IN ('aviz_teava','lista_curbe')
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 8388608
     OR NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = p_proiect)
     OR NOT EXISTS (SELECT 1 FROM public.logistica_depozite WHERE id = p_depozit) THEN v_motiv := 'parametri_invalizi';
  ELSE
    FOR x IN SELECT q.id FROM public.ocr_local_cereri q WHERE q.creat_de = p_user AND q.stare IN ('admisa','ceruta','preluata','fallback') ORDER BY q.id LOOP
      PERFORM public.fn_ocr_local_expira_una(x);
    END LOOP;
    v_motiv := public.fn_ocr_local_disponibilitate(t);
    IF v_motiv IS NOT NULL THEN NULL;
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_de = p_user AND stare IN ('admisa','ceruta','preluata','fallback')) >= 2 THEN v_motiv := 'limita_active';
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_de = p_user AND creat_la > t - interval '1 hour') >= 30 THEN v_motiv := 'limita_ora';
    ELSIF (SELECT count(*) FROM public.ocr_local_cereri WHERE creat_la >= (date_trunc('day', t AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')) >= 400 THEN v_motiv := 'limita_zi';
    END IF;
  END IF;
  UPDATE public.ocr_local_incercari SET rezultat = coalesce(v_motiv, 'admisa') WHERE ocr_local_incercari.id = v_attempt;
  IF v_motiv IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, 'refuzata'::text, v_motiv; RETURN;
  END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.ocr_local_cereri(id, proiect_id, depozit_id, sablon, creat_de, creat_la, pdf_cale, pdf_bytes, stare, termen_upload, sterge_dupa)
    VALUES (v_id, p_proiect, p_depozit, p_sablon, p_user, t, 'ocr-local-cereri/' || v_id || '.pdf', p_bytes, 'admisa', t + make_interval(secs => c.upload_s), t + c.retentie);
  RETURN QUERY SELECT q.id, q.pdf_cale, q.termen_upload, 'admisa'::text, NULL::text FROM public.ocr_local_cereri q WHERE q.id = v_id;
END $f$;
