-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK pentru docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql — NEAPLICAT, doar cu GO Razvan.
-- 1) scoate view-ul nou; 2) readuce ofertare_clarificare_planse_auto EXACT la versiunea live din 25.09.2026
--    (md5 al corpului fără comentarii și spații = 0875c2200e072289cd5b972b49cabb0c, identic cu pg_proc.prosrc live).
-- ATENȚIE: după rollback-ul view-ului, codul ramurii claude/cantitati-nevalidate-consumatori (dacă e deja pe main) face H2 să
-- blocheze cu „nu putem verifica" pe licitațiile cu F3 — rollback-ul de BD se face ÎMPREUNĂ cu revert-ul codului.
-- Sarcina 2 (26.09.2026): scoate și v_ofertare_transfer_conflicte, ofertare_transfer_conflicte_confirma, ofertare_transfer_stare.
--   Datele NU se ating: cheia analiza.transfer_cantitati (scrisă de codul nou al ofertare-plansa-citeste) rămâne în documente — e jsonb,
--   codul vechi o ignoră și o păstrează (toate scrierile fac { ...analiza, ... }); o eventuală reaplicare o citește din nou.
--   Ciornele marcate ',revizie_planse_auto' de v6 își păstrează marcajul (se scoate din Clarificări, „✓ revizuită”, sau cu SQL, cu GO).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Reparația rundei 1 (26.09.2026): și trigger-ul care păstrează cheile serverului (fn_trg_ofertare_doc_chei_server), funcția ajutătoare
-- ofertare_transfer_stare / ofertare_ts_valid, confirmarea cu 4 parametri, iar trigger-ul aprobării pachetului revine EXACT la corpul live
-- (md5(prosrc) a45ccdb853da8d7a6cabead04d9a95af; ACL postgres + service_role, fără comentariu — verificat pe PGlite).
DROP TRIGGER IF EXISTS trg_ofertare_doc_chei_server ON public.ofertare_documente_atribuire;
DROP FUNCTION IF EXISTS public.fn_trg_ofertare_doc_chei_server();
CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_blocaj text; v_gasit boolean;
BEGIN
  IF (NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat'))
     OR (NEW.stare = 'depus' AND (TG_OP = 'INSERT' OR OLD.stare NOT IN ('aprobat', 'depus'))) THEN
    SELECT true, blocaj INTO v_gasit, v_blocaj FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = NEW.licitatie_id;
    IF v_gasit IS NULL THEN
      RAISE EXCEPTION 'Aprobare blocată: nu putem verifica completitudinea documentației (licitația % nu apare în control)', NEW.licitatie_id USING ERRCODE = 'P0001';
    END IF;
    IF v_blocaj IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată — documentația nu e completă: %', v_blocaj USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
DROP VIEW IF EXISTS public.v_ofertare_cantitati_nevalidate;
DROP VIEW IF EXISTS public.v_ofertare_transfer_conflicte;
DROP FUNCTION IF EXISTS public.ofertare_transfer_conflicte_confirma(bigint, text, text, text);
DROP FUNCTION IF EXISTS public.ofertare_transfer_conflicte_confirma(bigint, text, text);
DROP FUNCTION IF EXISTS public.ofertare_transfer_stare(jsonb);
DROP FUNCTION IF EXISTS public.ofertare_ts_valid(text);

CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[]; v_nume text[]; v_motive text[]; v_acoperite bigint[]; v_draft record; v_lot int; v_f3 numeric;
  v_text text; v_lista text; v_det text; v_id bigint; v_nou boolean := false; v_resp uuid; v_nr int; v_noi int;
  v_antet constant text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe';
  v_standard boolean; v_tok text; v_det_fd text; v_ilizibile int; v_fara_date int;
BEGIN
  SELECT array_agg(id ORDER BY nume_original),
         array_agg(regexp_replace(nume_original, '\.pdf$', '', 'i') ORDER BY nume_original),
         array_agg(CASE
           WHEN analiza->'plansa'->>'rezultat' = 'citita_fara_date_cantitative'
             OR eroare IN ('citită fără rezultat','citită fără date cantitative') THEN 'fara_date'
           ELSE 'ilizibil' END ORDER BY nume_original)
    INTO v_ids, v_nume, v_motive
  FROM ofertare_documente_atribuire
  WHERE licitatie_id = p_licitatie_id
    AND coalesce(analiza->'plansa'->>'rezultat','') NOT IN ('sursa_gresita_sigla','ok','partial')
    AND NOT (analiza->'plansa'->>'rezultat' IS NULL
             AND NOT coalesce((analiza->'plansa'->>'vectorial')::boolean, false)
             AND greatest(coalesce((analiza->'plansa'->>'latime')::int,0), coalesce((analiza->'plansa'->>'inaltime')::int,0)) BETWEEN 1 AND 1999)
    AND ( analiza->'plansa'->>'rezultat' IN ('ilizibil','citita_fara_date_cantitative')
          OR (analiza->'plansa'->>'citibila') = 'false'
          OR eroare IN ('citită fără rezultat','citită fără date cantitative','ilizibilă')
          OR (analiza->'plansa'->>'randare_esuata') = 'true' );
    -- v4: eșecul tehnic (status eroare fără verdict de lizibilitate) NU mai e tratat ca „ilizibil”.
  IF v_ids IS NULL THEN
    -- v4: se retrag DOAR ciornele cu textul standard; o ciornă editată de om rămâne (decide omul).
    UPDATE ofertare_clarificari SET status = 'retrasa', updated_at = now()
     WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
       AND left(coalesce(intrebare,''), length(v_antet)) = v_antet;
    RETURN jsonb_build_object('actiune','nimic');
  END IF;

  SELECT coalesce(array_agg(x::bigint), '{}') INTO v_acoperite
  FROM ofertare_clarificari c, unnest(string_to_array(replace(c.sursa, 'planse_auto:', ''), ',')) x
  WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%'
    AND c.status NOT IN ('propunere','de_trimis') AND x ~ '^\d+$';
  SELECT array_agg(i), array_agg(n), array_agg(m) INTO v_ids, v_nume, v_motive
  FROM unnest(v_ids, v_nume, v_motive) AS t(i, n, m) WHERE NOT (i = ANY(v_acoperite));
  IF v_ids IS NULL THEN RETURN jsonb_build_object('actiune','deja_trimise'); END IF;

  SELECT round(sum(cantitate), 1) INTO v_f3 FROM ofertare_cantitati
  WHERE licitatie_id = p_licitatie_id AND tip_sursa = 'lista_f3'
    AND lower(coalesce(um,'')) ~ '^m(l|\.l\.)?\.?$' AND denumire ~* '(conduct|teav|țeav|tub)';

  v_lista := array_to_string(v_nume, ', ');
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det, v_ilizibile FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'ilizibil';
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det_fd, v_fara_date FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'fara_date';
  v_text := v_antet || E'\n\n' ||
    CASE WHEN v_ilizibile > 0 THEN
      'În documentația de atribuire, următoarele planșe nu au putut fi citite (textul — cote, lungimi, diametre, materiale, notări de tronsoane — nu este lizibil sau fișierul nu poate fi deschis):' || E'\n' || v_det || E'\n\n'
    ELSE '' END ||
    CASE WHEN v_fara_date > 0 THEN
      'Pentru următoarele planșe, în lectura efectuată nu au fost identificate date cantitative (lungimi, diametre, tronsoane):' || E'\n' || v_det_fd || E'\n\n'
    ELSE '' END ||
    'Pentru fundamentarea corectă a ofertei, vă rugăm să ne comunicați, pentru planșele de mai sus:' || E'\n' ||
    '1. Lista tronsoanelor: denumire/capete tronson, lungime (m), diametru nominal, material și SDR, mod de pozare, subtraversări/traversări;' || E'\n' ||
    CASE WHEN coalesce(v_f3,0) > 0
      THEN '2. Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins (lungimea totală de conductă din F3: ' ||
           replace(to_char(v_f3, 'FM999G999G990D0'), ',', '.') || ' m);'
      ELSE '2. Dacă documentația de atribuire cuprinde liste de cantități de lucrări pentru rețea (nu le-am identificat în documentația publicată) și, în caz afirmativ, publicarea acestora;'
    END ||
    CASE WHEN v_ilizibile > 0 THEN E'\n' || '3. Ca alternativă, pentru planșele care nu au putut fi citite, varianta în format editabil (DWG/DXF) sau PDF cu text selectabil.' ELSE '' END ||
    E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';

  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1;

  IF FOUND THEN
    -- textul e încă cel generat de funcție? (orice text care nu începe cu antetul standard = editat de om)
    v_standard := left(coalesce(v_draft.intrebare, ''), length(v_antet)) = v_antet;
    -- v4: marcajele rezervate de revizie (,revizie_*) din sursa se PĂSTREAZĂ la rescriere
    SELECT coalesce(string_agg(',' || t, '' ORDER BY o), '') INTO v_tok
      FROM unnest(string_to_array(v_draft.sursa, ',')) WITH ORDINALITY AS x(t, o) WHERE o > 1 AND t ~ '^revizie_[a-z0-9_]+$';
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    IF v_noi = 0 AND v_draft.sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok
       AND (NOT v_standard OR v_draft.intrebare = v_text) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard);
    END IF;
    -- v5: ciorna editată/aprobată de om NU se retrogradează la 'propunere' (doar sursa se actualizează)
    UPDATE ofertare_clarificari SET
      intrebare = CASE WHEN v_standard THEN v_text ELSE intrebare END,
      sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok,
      status = CASE WHEN v_noi > 0 AND v_standard THEN 'propunere' ELSE status END, updated_at = now()
      WHERE id = v_draft.id;
    v_id := v_draft.id; v_nou := v_noi > 0 AND v_standard;
  ELSE
    SELECT count(*) + 1 INTO v_lot FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id AND cheie LIKE 'auto_planse_%';
    SELECT coalesce(max(nr), 0) + 1 INTO v_nr FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id;
    INSERT INTO ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie)
      VALUES (p_licitatie_id, v_nr, v_text, 'planse_auto:' || array_to_string(v_ids, ','), 'propunere', 'automat', 'auto_planse_' || v_lot)
      ON CONFLICT (licitatie_id, cheie) DO NOTHING RETURNING id INTO v_id;
    v_nou := v_id IS NOT NULL;
  END IF;

  IF v_nou THEN
    SELECT responsabil_id INTO v_resp FROM ofertare_licitatii WHERE id = p_licitatie_id;
    IF v_resp IS NOT NULL THEN
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_resp, 'info', 'Ofertare', '💭 Propunere de clarificare (planșe)',
        'Licitația #' || p_licitatie_id || ': ' || cardinality(v_ids) || ' planșe fără date extrase (' || left(v_lista, 160) ||
        '). Verifică dacă datele nu sunt în memoriu/F3, apoi confirmă motivul în Clarificări. NU s-a trimis nimic.',
        '/ofertare');
    END IF;
  END IF;
  RETURN jsonb_build_object('actiune', CASE WHEN v_draft.id IS NOT NULL THEN 'actualizat' ELSE 'creat' END, 'id', v_id,
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'f3_m', v_f3);
END $function$;
REVOKE EXECUTE ON FUNCTION public.ofertare_clarificare_planse_auto(bigint) FROM PUBLIC, anon, authenticated;
