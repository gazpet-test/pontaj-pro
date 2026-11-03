-- Revenire 20261129j_redari_plicuri_0e: corpurile din 20261129i + UPDATE pe tabel (reintroduce constatarea 0e; doar la urgenta). Nu atinge date.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129j', true) IS DISTINCT FROM 'REDARI_PLICURI_0E_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261129j revenire: garda invalida';
  END IF;
  IF false
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_incearca_lock(uuid)'::regprocedure)) IS DISTINCT FROM 'af77d2e7c85bdea490f76b12eb18dff1'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_reguli()'::regprocedure)) IS DISTINCT FROM 'cda947fbd65187a73b7929b59c74f2fb'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_plic_creeaza(uuid,uuid[])'::regprocedure)) IS DISTINCT FROM '3ecc79e23de600a3b29235abed0a5c1c'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_lot_plicuire_creeaza(uuid,uuid[],date)'::regprocedure)) IS DISTINCT FROM '08b4f10e97fd3530a70bec56bcbaa954' THEN
    RAISE EXCEPTION '20261129j revenire: functiile nu sunt cele din 29j';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_red_plic_incearca_lock(p_uat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_uat IS NULL THEN RETURN; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('red_plic_uat:' || p_uat::text, 0)) THEN
    RAISE EXCEPTION 'redari: o plicuire / expediere sau o modificare de deținători e în curs în acest UAT; reîncercați peste câteva secunde' USING ERRCODE = '55P03';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_plic_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- lot_id se schimbă doar din fn_red_lot_plicuire_creeaza: RPC-ul pune o marcă în tranzacție (GUC local), pe care aplicația nu o poate seta
-- (PostgREST nu expune set_config). Mentenanța (sesiune postgres fără JWT) e și ea permisă.
-- coalesce: GUC-ul nesetat intoarce NULL, iar NOT NULL nu ar declansa refuzul (prins de DRY TEST2)
DECLARE v_din_rpc boolean := coalesce(current_setting('gazpet.red_lot_rpc', true), '') = txid_current()::text
                            OR (session_user = 'postgres' AND coalesce(current_setting('request.jwt.claims', true), '') = '');
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1; RETURN NEW; END IF;
  NEW.updated_at := now();
  IF (NEW.proiect_id, NEW.uat_id, NEW.nr_plic, NEW.cheie_persoana, NEW.destinatar_nume, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.proiect_id, OLD.uat_id, OLD.nr_plic, OLD.cheie_persoana, OLD.destinatar_nume, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'redari: identitatea plicului nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF OLD.stare = 'anulat' AND (to_jsonb(NEW) - 'updated_at' - 'versiune') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'versiune') THEN
    RAISE EXCEPTION 'redari: plicul anulat nu se mai modifica' USING ERRCODE = '23514';
  END IF;
  IF NOT v_din_rpc AND NEW.lot_id IS DISTINCT FROM OLD.lot_id THEN
    RAISE EXCEPTION 'redari: lotul de plicuire se atribuie doar prin fn_red_lot_plicuire_creeaza' USING ERRCODE = '23514';
  END IF;
  IF (OLD.awb IS NOT NULL AND NEW.awb IS DISTINCT FROM OLD.awb) OR (OLD.data_expediere IS NOT NULL AND NEW.data_expediere IS DISTINCT FROM OLD.data_expediere) THEN
    RAISE EXCEPTION 'redari: expedierea plicului e deja inregistrata' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_expediere IS NOT NULL AND OLD.data_expediere IS NULL THEN
    IF NEW.lot_id IS NULL THEN RAISE EXCEPTION 'redari: plicul se expediaza doar dupa PV-ul de plicuire (lot)' USING ERRCODE = '23514'; END IF;
    -- juridic#021: fara imputernicire nu pleaca nimic (pasul 4 din planul de verificare, cap. 6); opisul de la dosar e atasat
    BEGIN   -- Jakarinos r8 P2-01: proiectul si lotul se blocheaza NOWAIT (nicio asteptare inaintea lock-ului UAT)
    -- Jakarinos r3 P2: proiectul citit si blocat FOR SHARE (retragerea concurenta a imputernicirii cedeaza sau e vazuta)
    IF NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = NEW.proiect_id AND length(btrim(coalesce(pr.imputernicire_nr, ''))) > 0 AND pr.imputernicire_data IS NOT NULL FOR SHARE NOWAIT) THEN
      RAISE EXCEPTION 'redari: proiectul nu are inca imputernicirea Beneficiarului (nr. + data); plicurile nu pleaca' USING ERRCODE = '23514';
    END IF;
    IF NEW.opis_path IS NULL THEN RAISE EXCEPTION 'redari: atasati intai opisul plicului (exemplarul de la dosar)' USING ERRCODE = '23514'; END IF;
    -- Jakarinos r1 P1-02 / Gemini r1: lotul trebuie finalizat (PV semnat atasat, ambii semnatari) si datat inainte de expediere; blocat FOR SHARE
    IF NOT EXISTS (SELECT 1 FROM public.red_loturi_plicuire l WHERE l.id = NEW.lot_id AND l.pv_path IS NOT NULL
                     AND l.semnatar1_id IS NOT NULL AND l.semnatar2_id IS NOT NULL AND l.data_plicuire <= NEW.data_expediere FOR SHARE NOWAIT) THEN
      RAISE EXCEPTION 'redari: PV-ul de plicuire nu e finalizat (PV semnat atasat, 2 semnatari) sau expedierea e inaintea plicuirii' USING ERRCODE = '23514';
    END IF;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'redari: un rand implicat (proiect / UAT / lot / plic / convocare / detinator / contact / parcela) e modificat chiar acum de altcineva; reincercati peste cateva secunde' USING ERRCODE = '55P03';
    END;
    -- Jakarinos r2 P1/P2: la expediere se reverifica, sub acelasi advisory lock, ca plicul e complet si identitatea postala neschimbata
    -- Jakarinos r7 P2-01: executorul a blocat deja randul plicului inaintea triggerului, deci aici lock-ul UAT se INCEARCA (nu se asteapta):
    -- doua expedieri / o expediere si o plicuire in acelasi UAT nu pot forma ciclu; cea care pierde primeste 55P03 si reincearca
    PERFORM public.fn_red_plic_incearca_lock(NEW.uat_id);
    BEGIN   -- harness conc29i S6 (r10): nicio blocare de rand din plicuire / expediere / propagare nu asteapta (NOWAIT) -> fara cicluri cu UPDATE-uri multi-rand
    PERFORM 1 FROM public.red_detinatori d WHERE d.id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.plic_id = NEW.id) ORDER BY d.id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.red_detinatori_contact k WHERE k.detinator_id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.plic_id = NEW.id) ORDER BY k.detinator_id FOR SHARE NOWAIT;
    PERFORM 1 FROM public.red_parcele p WHERE p.id IN (SELECT d.parcela_id FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.plic_id = NEW.id) ORDER BY p.id FOR SHARE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'redari: un rand implicat (proiect / UAT / lot / plic / convocare / detinator / contact / parcela) e modificat chiar acum de altcineva; reincercati peste cateva secunde' USING ERRCODE = '55P03';
    END;
    -- Jakarinos r3 P2: fiecare membru reverificat pe TOT criteriul de eligibilitate (parcela nestearsa, acelasi proiect si UAT), blocat FOR SHARE
    IF EXISTS (SELECT 1 FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
                WHERE c.plic_id = NEW.id
                  AND (c.stare <> 'activ' OR c.sters_la IS NOT NULL OR d.sters_la IS NOT NULL OR p.sters_la IS NOT NULL
                       OR p.proiect_id <> NEW.proiect_id OR p.uat_id <> NEW.uat_id OR public.fn_red_cheie_persoana(c.detinator_id) IS DISTINCT FROM NEW.cheie_persoana)) THEN
      RAISE EXCEPTION 'redari: plicul % nu mai corespunde (nume / adresa schimbate sau convocare anulata); anuleaza-l si refa-l', NEW.nr_plic USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
                WHERE p.proiect_id = NEW.proiect_id AND p.uat_id = NEW.uat_id AND p.sters_la IS NULL AND d.sters_la IS NULL
                  AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
                  AND public.fn_red_cheie_persoana(c.detinator_id) = NEW.cheie_persoana) THEN
      RAISE EXCEPTION 'redari: persoana are convocari noi care nu sunt in plicul %; anuleaza-l si refa-l complet', NEW.nr_plic USING ERRCODE = '23514';
    END IF;
    NEW.awb := upper(regexp_replace(NEW.awb, '\s', '', 'g'));
  END IF;
  IF OLD.opis_path IS NOT NULL AND NEW.opis_path IS DISTINCT FROM OLD.opis_path THEN
    RAISE EXCEPTION 'redari: opisul plicului e deja atasat' USING ERRCODE = '23514';
  END IF;
  IF NEW.opis_path IS NOT NULL AND OLD.opis_path IS NULL AND NOT (NEW.opis_path ~ ('^plicuri/' || NEW.id::text || '/[A-Za-z0-9._-]+\.(docx|DOCX|pdf|PDF)$')
     AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.opis_path)) THEN
    RAISE EXCEPTION 'redari: opisul lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF (OLD.data_ar IS NOT NULL AND (NEW.data_ar, NEW.ar_scan_path, NEW.ar_primit_de, NEW.ar_mentiune) IS DISTINCT FROM (OLD.data_ar, OLD.ar_scan_path, OLD.ar_primit_de, OLD.ar_mentiune))
     OR (OLD.retur IS NOT NULL AND (NEW.retur, NEW.retur_data, NEW.retur_scan_path, NEW.retur_detaliu) IS DISTINCT FROM (OLD.retur, OLD.retur_data, OLD.retur_scan_path, OLD.retur_detaliu)) THEN
    RAISE EXCEPTION 'redari: AR-ul / returul plicului e deja inregistrat' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_ar IS NOT NULL AND OLD.data_ar IS NULL AND NOT public.fn_red_plic_scan_exista(NEW.id, NEW.ar_scan_path) THEN
    RAISE EXCEPTION 'redari: scanul AR lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF NEW.retur IS NOT NULL AND OLD.retur IS NULL AND NOT public.fn_red_plic_scan_exista(NEW.id, NEW.retur_scan_path) THEN
    RAISE EXCEPTION 'redari: scanul plicului returnat lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF NEW.stare = 'anulat' AND OLD.stare = 'activ' AND NEW.lot_id IS DISTINCT FROM OLD.lot_id THEN
    RAISE EXCEPTION 'redari: anularea nu schimba lotul' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_plic_creeaza(p_proiect_id uuid, p_convocari uuid[]) RETURNS public.red_plicuri
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_n integer; v_uat uuid; v_uat3 text; v_chei text[]; v_nr integer; v_plic public.red_plicuri; v_nume text; v_gasite integer;
        v_cheie0 text; v_uat0 uuid; v_lipsa integer; v_exista text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: fara drept de plicuire' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL OR p_convocari IS NULL OR cardinality(p_convocari) = 0 OR cardinality(p_convocari) > 200 THEN
    RAISE EXCEPTION 'redari: lista de convocari invalida (1..200)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_convocari) x) <> cardinality(p_convocari) THEN RAISE EXCEPTION 'redari: convocari duplicate in lista' USING ERRCODE = '22023'; END IF;
  -- r1 P1 / r6: serializare pe UAT (advisory lock), inainte de blocarea randurilor; doua plicuiri in acelasi UAT se asteapta
  SELECT public.fn_red_cheie_persoana(c.detinator_id), p.uat_id INTO v_cheie0, v_uat0
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = p_convocari[1];
  IF v_cheie0 IS NULL OR v_uat0 IS NULL THEN
    RAISE EXCEPTION 'redari: convocarea nu are o persoana cu adresa cunoscuta (nume + adresa)' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('red_plic_uat:' || v_uat0::text, 0));   -- r6: lock-ul UAT-ului (vezi protocolul)
  -- după lock, cheia și UAT-ul primei convocări se recitesc (o gardă comisă între timp e acum vizibilă)
  SELECT public.fn_red_cheie_persoana(c.detinator_id), p.uat_id INTO v_cheie0, v_uat0
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = p_convocari[1];
  -- blocare în ordine fixă (id), ca două plicuiri concurente să nu se blocheze reciproc
  BEGIN   -- harness conc29i S6 (r10): nicio blocare de rand din plicuire / expediere / propagare nu asteapta (NOWAIT) -> fara cicluri cu UPDATE-uri multi-rand
  PERFORM 1 FROM public.red_convocari WHERE id = ANY(p_convocari) ORDER BY id FOR UPDATE NOWAIT;
  -- Jakarinos r3 P1: identitatea (nume + adresa) se stabilizeaza: detinatorii si contactele lor blocate FOR SHARE pana la commit
  -- (o schimbare de nume/adresa asteapta, apoi e refuzata de garda de identitate fiindca persoana are plic)
  PERFORM 1 FROM public.red_detinatori d WHERE d.id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.id = ANY(p_convocari)) ORDER BY d.id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.red_detinatori_contact k WHERE k.detinator_id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.id = ANY(p_convocari)) ORDER BY k.detinator_id FOR SHARE NOWAIT;
  -- Jakarinos r4 P2: si parcelele, inainte de validarea eligibilitatii (o stergere logica concurenta asteapta si apoi e refuzata de garda)
  PERFORM 1 FROM public.red_parcele p WHERE p.id IN (SELECT d.parcela_id FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.id = ANY(p_convocari)) ORDER BY p.id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'redari: un rand implicat (proiect / UAT / lot / plic / convocare / detinator / contact / parcela) e modificat chiar acum de altcineva; reincercati peste cateva secunde' USING ERRCODE = '55P03';
  END;
  SELECT count(*), min(p.uat_id::text)::uuid, count(DISTINCT p.uat_id), array_agg(DISTINCT coalesce(public.fn_red_cheie_persoana(c.detinator_id), '<fara>'))
    INTO v_gasite, v_uat, v_n, v_chei
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = ANY(p_convocari) AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
     AND p.proiect_id = p_proiect_id AND p.sters_la IS NULL AND d.sters_la IS NULL;
  IF v_gasite <> cardinality(p_convocari) THEN
    RAISE EXCEPTION 'redari: % din % convocari nu se pot pune in plic (inactive, alt canal, deja in plic, expediate sau din alt proiect)', cardinality(p_convocari) - v_gasite, cardinality(p_convocari) USING ERRCODE = 'P0001';
  END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'redari: convocarile sunt din UAT-uri diferite' USING ERRCODE = 'P0001'; END IF;
  IF cardinality(v_chei) <> 1 OR v_chei[1] = '<fara>' THEN
    RAISE EXCEPTION 'redari: convocarile nu sunt ale aceleiasi persoane cu adresa cunoscuta (nume + adresa)' USING ERRCODE = 'P0001';
  END IF;
  IF v_chei[1] IS DISTINCT FROM v_cheie0 OR v_uat IS DISTINCT FROM v_uat0 THEN
    RAISE EXCEPTION 'redari: numele / adresa s-au schimbat in timpul plicuirii; reincercati' USING ERRCODE = 'P0001';
  END IF;
  -- r1 P1: plicul cuprinde TOATE convocarile eligibile ale persoanei din UAT (nu se fac plicuri partiale)
  SELECT count(*) INTO v_lipsa
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE p.proiect_id = p_proiect_id AND p.uat_id = v_uat AND p.sters_la IS NULL AND d.sters_la IS NULL
     AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
     AND NOT (c.id = ANY(p_convocari)) AND public.fn_red_cheie_persoana(c.detinator_id) = v_chei[1];
  IF v_lipsa > 0 THEN
    RAISE EXCEPTION 'redari: plicul trebuie sa cuprinda toate convocarile persoanei din UAT (lipsesc %)', v_lipsa USING ERRCODE = 'P0001';
  END IF;
  SELECT nr_plic INTO v_exista FROM public.red_plicuri WHERE proiect_id = p_proiect_id AND uat_id = v_uat AND cheie_persoana = v_chei[1] AND stare = 'activ' AND data_expediere IS NULL;
  IF v_exista IS NOT NULL THEN
    RAISE EXCEPTION 'redari: persoana are deja plicul neexpediat %; anuleaza-l si refa-l cu toate convocarile', v_exista USING ERRCODE = 'P0001';
  END IF;
  BEGIN   -- Jakarinos r8 P2-01
    SELECT u.uat3 INTO v_uat3 FROM public.red_uat u WHERE u.id = v_uat AND u.proiect_id = p_proiect_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'redari: un rand implicat (proiect / UAT / lot / plic / convocare / detinator / contact / parcela) e modificat chiar acum de altcineva; reincercati peste cateva secunde' USING ERRCODE = '55P03';
  END;
  IF v_uat3 IS NULL THEN RAISE EXCEPTION 'redari: UAT inexistent in proiect' USING ERRCODE = '23503'; END IF;
  SELECT d.nume INTO v_nume FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.id = p_convocari[1];
  INSERT INTO public.red_numere (cheie, ultimul) VALUES ('PL-' || v_uat3, 1)
    ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1 RETURNING ultimul INTO v_nr;
  IF v_nr > 9999 THEN RAISE EXCEPTION 'redari: numerotarea plicurilor pe % depaseste 9999', v_uat3; END IF;
  INSERT INTO public.red_plicuri (proiect_id, uat_id, nr_plic, cheie_persoana, destinatar_nume, created_by)
    VALUES (p_proiect_id, v_uat, 'PL-' || v_uat3 || '-' || lpad(v_nr::text, 4, '0'), v_chei[1], v_nume, auth.uid()) RETURNING * INTO v_plic;
  UPDATE public.red_convocari SET plic_id = v_plic.id WHERE id = ANY(p_convocari);
  RETURN v_plic;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_lot_plicuire_creeaza(p_proiect_id uuid, p_plicuri uuid[], p_data date) RETURNS public.red_loturi_plicuire
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_gasite integer; v_nr integer; v_lot public.red_loturi_plicuire;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: fara drept de plicuire' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL OR p_data IS NULL OR p_plicuri IS NULL OR cardinality(p_plicuri) = 0 OR cardinality(p_plicuri) > 2000 THEN
    RAISE EXCEPTION 'redari: lot invalid (1..2000 plicuri, data obligatorie)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_plicuri) x) <> cardinality(p_plicuri) THEN RAISE EXCEPTION 'redari: plicuri duplicate in lista' USING ERRCODE = '22023'; END IF;
  BEGIN   -- harness conc29i S6 (r10): nicio blocare de rand din plicuire / expediere / propagare nu asteapta (NOWAIT) -> fara cicluri cu UPDATE-uri multi-rand
  PERFORM 1 FROM public.red_plicuri WHERE id = ANY(p_plicuri) ORDER BY id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'redari: un rand implicat (proiect / UAT / lot / plic / convocare / detinator / contact / parcela) e modificat chiar acum de altcineva; reincercati peste cateva secunde' USING ERRCODE = '55P03';
  END;
  SELECT count(*) INTO v_gasite FROM public.red_plicuri
   WHERE id = ANY(p_plicuri) AND proiect_id = p_proiect_id AND stare = 'activ' AND lot_id IS NULL AND data_expediere IS NULL;
  IF v_gasite <> cardinality(p_plicuri) THEN
    RAISE EXCEPTION 'redari: % din % plicuri nu se pot pune in lot (anulate, deja in lot, expediate sau din alt proiect)', cardinality(p_plicuri) - v_gasite, cardinality(p_plicuri) USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES ('PP', 1) ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1 RETURNING ultimul INTO v_nr;
  IF v_nr > 9999 THEN RAISE EXCEPTION 'redari: numerotarea loturilor de plicuire depaseste 9999'; END IF;
  INSERT INTO public.red_loturi_plicuire (proiect_id, nr_lot, data_plicuire, created_by) VALUES (p_proiect_id, 'PP-' || lpad(v_nr::text, 4, '0'), p_data, auth.uid()) RETURNING * INTO v_lot;
  PERFORM set_config('gazpet.red_lot_rpc', txid_current()::text, true);
  UPDATE public.red_plicuri SET lot_id = v_lot.id WHERE id = ANY(p_plicuri);
  PERFORM set_config('gazpet.red_lot_rpc', '', true);
  RETURN v_lot;
END $fn$;

REVOKE UPDATE ON public.red_plicuri FROM authenticated, service_role;
GRANT UPDATE ON public.red_plicuri TO authenticated, service_role;
-- Copilot 29j r1 P2-03: FAIL-CLOSED — corpul din 29i al RPC-ului de lot (cu marca GUC) nu ramane expus aplicatiei, deci poarta 0e ramane verde;
-- crearea loturilor de plicuire e indisponibila din aplicatie pana la o remediere noua (expedierea plicurilor deja in lot nu e afectata)
REVOKE EXECUTE ON FUNCTION public.fn_red_lot_plicuire_creeaza(uuid, uuid[], date) FROM PUBLIC, anon, authenticated, service_role;
DO $post$
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_red_lot_plicuire_creeaza(uuid,uuid[],date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_lot_plicuire_creeaza(uuid,uuid[],date)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261129j revenire: RPC-ul de lot inca expus (poarta 0e)';
  END IF;
END $post$;
