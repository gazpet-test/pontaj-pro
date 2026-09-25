-- 25.09.2026 v3 (revizie Copilot/owner după auditul țintit):
--  1) textul editat de om NU mai e suprascris: funcția rescrie `intrebare` doar cât timp ciorna are încă
--     textul ei standard; altfel actualizează numai lista de planșe (sursa) și, la planșe noi, statusul.
--  2) fără F3 în BD, punctul 2 nu mai trimite la „lista de cantități (F3)” (inexistentă la Vâlcelele):
--     întreabă dacă documentația cuprinde liste de cantități.
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
  v_standard boolean;
BEGIN
  SELECT array_agg(id ORDER BY nume_original),
         array_agg(regexp_replace(nume_original, '\.pdf$', '', 'i') ORDER BY nume_original),
         array_agg(CASE
           WHEN (analiza->'plansa'->>'randare_esuata') = 'true' THEN 'fișierul nu a putut fi deschis/randat'
           WHEN (analiza->'plansa'->>'citibila') = 'false' AND (analiza->'plansa'->>'vectorial') = 'true' THEN 'desen vectorial fără conținut lizibil'
           WHEN (analiza->'plansa'->>'citibila') = 'false' THEN 'imagine deteriorată / fără desen'
           WHEN eroare = 'citită fără rezultat' THEN 'citită, dar fără cote/lungimi/diametre identificabile'
           ELSE 'citire eșuată' END ORDER BY nume_original)
    INTO v_ids, v_nume, v_motive
  FROM ofertare_documente_atribuire
  WHERE licitatie_id = p_licitatie_id
    AND ((analiza->'plansa'->>'citibila') = 'false' OR eroare = 'citită fără rezultat'
         OR (status_procesare = 'eroare' AND analiza ? 'citire_ai'));
  IF v_ids IS NULL THEN
    UPDATE ofertare_clarificari SET status = 'retrasa', updated_at = now()
     WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis');
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
  SELECT string_agg('   – ' || n, E'\n') INTO v_det FROM unnest(v_nume) n;
  v_text := v_antet || E'\n\n' ||
    'În documentația de atribuire, următoarele planșe nu permit identificarea datelor necesare corelării cu listele de cantități (textul — cote, lungimi, diametre, materiale, notări de tronsoane — este convertit în elemente grafice sau nu este lizibil):' || E'\n' ||
    v_det || E'\n\n' ||
    'Pentru fundamentarea corectă a ofertei, vă rugăm să ne comunicați, pentru fiecare planșă de mai sus:' || E'\n' ||
    '1. Lista tronsoanelor: denumire/capete tronson, lungime (m), diametru nominal, material și SDR, mod de pozare, subtraversări/traversări;' || E'\n' ||
    CASE WHEN coalesce(v_f3,0) > 0
      THEN '2. Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins (lungimea totală de conductă din F3: ' ||
           replace(to_char(v_f3, 'FM999G999G990D0'), ',', '.') || ' m);'
      ELSE '2. Dacă documentația de atribuire cuprinde liste de cantități de lucrări pentru rețea (nu le-am identificat în documentația publicată) și, în caz afirmativ, publicarea acestora;'
    END || E'\n' ||
    '3. Ca alternativă, planșele în format editabil (DWG/DXF) sau PDF cu text selectabil.' || E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';

  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1;

  IF FOUND THEN
    -- textul e încă cel generat de funcție? (orice text care nu începe cu antetul standard = editat de om)
    v_standard := left(coalesce(v_draft.intrebare, ''), length(v_antet)) = v_antet;
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    IF v_noi = 0 AND v_draft.sursa = 'planse_auto:' || array_to_string(v_ids, ',')
       AND (NOT v_standard OR v_draft.intrebare = v_text) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard);
    END IF;
    -- o ciornă deja confirmată care primește planșe NOI revine la 'propunere' (motivul pt cele noi e neconfirmat)
    UPDATE ofertare_clarificari SET
      intrebare = CASE WHEN v_standard THEN v_text ELSE intrebare END,
      sursa = 'planse_auto:' || array_to_string(v_ids, ','),
      status = CASE WHEN v_noi > 0 THEN 'propunere' ELSE status END, updated_at = now()
      WHERE id = v_draft.id;
    v_id := v_draft.id; v_nou := v_noi > 0;
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
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'f3_m', v_f3);
END $function$;
REVOKE EXECUTE ON FUNCTION public.ofertare_clarificare_planse_auto(bigint) FROM PUBLIC, anon, authenticated;
