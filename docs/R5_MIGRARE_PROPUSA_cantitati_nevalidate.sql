-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 (Copilot 25.09.2026) — MIGRARE PROPUSĂ, NEAPLICATĂ. Nu e în supabase/migrations/ tocmai ca să nu fie luată drept aplicată.
-- „Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta aprobată."
-- Context și inventarul consumatorilor: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md.
--
-- Se aplică DOAR cu GO Razvan, prin apply_migration (nume propus: r5_cantitati_nevalidate), ÎNAINTE de merge-ul ramurii
-- claude/cantitati-nevalidate-consumatori. Ordinea contează: codul nou citește v_ofertare_cantitati_nevalidate; fără view,
-- rândul H2 („cantitati") din poarta propunerii spune „nu putem verifica" pe orice licitație care are F3 (fail-closed, ca
-- P0c cu v_ofertare_pt_cerinte_neconfirmate). Azi (SELECT 25.09.2026) doar lic. 5 are F3 de rețea: 47 rânduri, toate 'extras'.
--
-- Conține:
--   1) VIEW NOU v_ofertare_cantitati_nevalidate (security_invoker) — câte rânduri de rețea NU sunt validate de om, pe surse.
--      Filtrul de rețea e IDENTIC cu CTE-ul qm din v_ofertare_pt_stare (dacă îl schimbi acolo, schimbă-l și aici).
--   2) ofertare_clarificare_planse_auto v6 — totalul F3 citat AUTORITĂȚII vine doar din rânduri validate; cât există
--      rânduri F3 de conductă nevalidate, textul cere corespondența fără total. Baza = funcția LIVE (verificat: repo v5
--      + linia `v_nou := v_noi > 0 AND v_standard` = live, md5 fără comentarii/spații 0875c2200e072289cd5b972b49cabb0c).
--      Atenție: fișierul supabase/migrations/20260926b_…_v5.sql din repo NU e identic cu live (are `v_nou := v_noi > 0`).
--
-- Rollback exact: docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate_ROLLBACK.sql.
-- Testat pe un Postgres 16 local de unică folosință (schemă minimă), nu pe BD-ul de producție.
--
-- PREVIEW (rulează ÎNAINTE, doar SELECT; execute_sql întoarce doar ultimul rezultat → un SELECT per apel):
--   (P1) ce va arăta view-ul, pe licitații:
--     SELECT q.licitatie_id, count(*) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat') f3_nev,
--            round(sum(q.cantitate) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat')) f3_nev_m,
--            count(*) FILTER (WHERE q.tip_sursa='plansa' AND q.status<>'validat') plansa_nev,
--            count(*) FILTER (WHERE q.tip_sursa IS NULL AND q.status<>'validat') fara_tip_nev, count(*) retea
--       FROM ofertare_cantitati q
--      WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--        AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total'
--      GROUP BY 1 ORDER BY 1;
--     La 25.09.2026: lic. 3 → 0 F3 (memoriu 3 din 5 nevalidate); lic. 5 → F3 47 nevalidate / 6.520 m; lic. 95 → 6 fără tip,
--     toate nevalidate (48.195 m); lic. 102 → 2 fără tip, nevalidate.
--   (P2) ciornele automate „planse_auto" al căror text s-ar schimba la următorul apel (text standard + F3 cu rânduri nevalidate):
--     SELECT c.id, c.licitatie_id, c.status, left(c.intrebare, 60) FROM ofertare_clarificari c
--      WHERE c.origine='automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
--        AND left(coalesce(c.intrebare,''), 92) = 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe'
--        AND EXISTS (SELECT 1 FROM ofertare_cantitati q WHERE q.licitatie_id=c.licitatie_id AND q.tip_sursa='lista_f3' AND q.status<>'validat');
--     (#63 de la lic. 95 NU intră: text editat de om, iar lic. 95 n-are F3.)
-- SANITY (după): SELECT * FROM v_ofertare_cantitati_nevalidate WHERE licitatie_id IN (3,5,95,102) ORDER BY 1;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 1) ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_ofertare_cantitati_nevalidate WITH (security_invoker = on) AS
SELECT q.licitatie_id,
       count(*) FILTER (WHERE q.tip_sursa = 'lista_f3' AND q.status <> 'validat')                  AS lista_f3_nevalidate,
       round(sum(q.cantitate) FILTER (WHERE q.tip_sursa = 'lista_f3' AND q.status <> 'validat'))   AS lista_f3_nevalidate_m,
       count(*) FILTER (WHERE q.tip_sursa = 'lista_c6' AND q.status <> 'validat')                  AS lista_c6_nevalidate,
       count(*) FILTER (WHERE q.tip_sursa = 'memoriu'  AND q.status <> 'validat')                  AS memoriu_nevalidate,
       count(*) FILTER (WHERE q.tip_sursa = 'plansa'   AND q.status <> 'validat')                  AS plansa_nevalidate,
       count(*) FILTER (WHERE q.tip_sursa IS NULL      AND q.status <> 'validat')                  AS fara_tip_nevalidate,
       count(*) FILTER (WHERE q.status <> 'validat')                                              AS retea_nevalidate,
       count(*)                                                                                   AS retea_randuri
  FROM public.ofertare_cantitati q
 -- ACELAȘI filtru ca v_ofertare_pt_stare.qm (pg_get_viewdef, 25.09.2026)
 WHERE q.um = 'm'::text AND q.categorie ~* 'conduct|re[țt]ea'::text
   AND ((((COALESCE(q.obiect, ''::text) || ' '::text) || COALESCE(q.denumire, ''::text)) || ' '::text) || COALESCE(q.sursa, ''::text)) !~* 'total'::text
 GROUP BY q.licitatie_id;
REVOKE ALL ON public.v_ofertare_cantitati_nevalidate FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_cantitati_nevalidate TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_cantitati_nevalidate IS 'R5 (25.09.2026): per licitație, câte rânduri de rețea (filtrul qm din v_ofertare_pt_stare) NU sunt validate de om (status<>validat), pe tip_sursa. Citit de OfertarePropunere (H2, controlCantitati): F3 cu rânduri nevalidate nu e referință aprobată. security_invoker.';

-- 2) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- v6 (R5): față de live se schimbă DOAR: v_f3_n/v_f3_nev declarate; SELECT-ul F3 (sumă doar din 'validat' + numărători);
-- ramura nouă „2. Corespondența … (F3) în care este cuprins;" fără total; 'f3_nevalidate' în rezultat. Restul = live.
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
  v_f3_n int; v_f3_nev int;
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

  -- v6 (R5, Copilot 25.09.2026): cifra F3 citată AUTORITĂȚII vine DOAR din rânduri validate de om (status='validat').
  -- Cât există rânduri F3 de conductă nevalidate (transcriere AI neverificată), textul cere corespondența FĂRĂ total.
  SELECT round(sum(cantitate) FILTER (WHERE status = 'validat'), 1), count(*), count(*) FILTER (WHERE status <> 'validat')
    INTO v_f3, v_f3_n, v_f3_nev
  FROM ofertare_cantitati
  WHERE licitatie_id = p_licitatie_id AND tip_sursa = 'lista_f3'
    AND lower(coalesce(um,'')) ~ '^m(l|\.l\.)?\.?$' AND denumire ~* '(conduct|teav|țeav|tub)';
  IF v_f3_nev > 0 THEN v_f3 := NULL; END IF;

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
      WHEN v_f3_n > 0
      THEN '2. Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins;'
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
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'f3_m', v_f3, 'f3_nevalidate', v_f3_nev);
END $function$;
REVOKE EXECUTE ON FUNCTION public.ofertare_clarificare_planse_auto(bigint) FROM PUBLIC, anon, authenticated;
