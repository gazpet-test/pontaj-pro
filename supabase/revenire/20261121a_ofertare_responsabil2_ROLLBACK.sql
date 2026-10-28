-- REVENIRE 20261121a_ofertare_responsabil2 (armată; doar la cererea lui Răzvan). ÎNTÂI se retrage UI-ul / edge-ul care citesc responsabil2_id, apoi:
-- reface EXACT cele 7 funcții și v_ofertare_dashboard dinaintea migrării, apoi scoate coloanele (ATENȚIE: numirile de responsabil 2 se pierd —
-- lista lor e afișată în NOTICE înainte de ștergere, pentru reconstituire manuală).
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261121a', true) IS DISTINCT FROM 'RESPONSABIL2_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261121a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261121a revenire: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  RAISE NOTICE '20261121a revenire: responsabil 2 setat pe %', (SELECT coalesce(jsonb_agg(jsonb_build_object('licitatie', id, 'r2', responsabil2_id, 'setat_de', responsabil2_setat_de) ORDER BY id), '[]')
                                                              FROM public.ofertare_licitatii WHERE responsabil2_id IS NOT NULL);
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_responsabil_setat_de()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.responsabil_setat_de := CASE WHEN NEW.responsabil_id IS NULL THEN NULL ELSE auth.uid() END;
  ELSIF NEW.responsabil_id IS DISTINCT FROM OLD.responsabil_id THEN
    NEW.responsabil_setat_de := auth.uid();
  ELSE
    NEW.responsabil_setat_de := OLD.responsabil_setat_de;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_necitit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid; v_amprenta text; v_ampr_mail text; v_claim text; v_mail boolean; v_max bigint;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile_necitit int; v_zile_dep int; v_trimise int := 0; v_lic jsonb := '[]'::jsonb;
BEGIN
  FOR l IN
    SELECT li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id,
           count(*) AS nr,
           min((d.created_at AT TIME ZONE 'Europe/Bucharest')::date) AS de_la,
           string_agg(d.id::text, ',' ORDER BY d.id) AS ids,
           max(d.id) AS max_id,
           string_agg(left(coalesce(d.nume_original, '#' || d.id), 60), '; ' ORDER BY d.created_at) AS lista
    FROM ofertare_licitatii li
    JOIN ofertare_documente_atribuire d ON d.licitatie_id = li.id
    WHERE d.tip = 'raspuns_clarificare'
      AND public.ofertare_rc_doc_necitit(d.id)
      AND li.status IN ('go', 'in_lucru')
      AND li.termen_depunere > now()
    GROUP BY li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id
  LOOP
    v_zile_necitit := v_azi - l.de_la;
    v_zile_dep := (l.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - v_azi;
    -- ziua sosirii: doar bannerul — dar nu când depunerea e azi / mâine (urgență)
    CONTINUE WHEN v_zile_necitit < 1 AND v_zile_dep > 1;

    -- amprenta DIRECȚIONALĂ (review Copilot r4 P2 / Gemini r4 P2): '<zi>|<id maxim necitit>' — o alertă nouă în aceeași zi DOAR dacă a
    -- apărut un document NOU (id mai mare; id-urile cresc la inserare); procesarea parțială (dispariția unor id-uri) nu re-alertează
    v_max := l.max_id;
    v_amprenta := v_azi::text || '|' || v_max::text;
    v_claim := NULL;
    INSERT INTO ofertare_alerte_amprenta AS a (licitatie_id, fel, amprenta, trimisa_la)
    VALUES (l.id, 'rc_necitit', v_amprenta, now())
    ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now()
      WHERE split_part(a.amprenta, '|', 1) IS DISTINCT FROM v_azi::text
         OR (CASE WHEN split_part(a.amprenta, '|', 2) ~ '^[0-9]{1,18}$' THEN split_part(a.amprenta, '|', 2)::bigint ELSE 0 END) < v_max
    RETURNING 'x' INTO v_claim;
    IF v_claim IS NOT NULL THEN
      FOR v_pid IN
        SELECT p FROM unnest(ARRAY[l.responsabil_id]) p WHERE p IS NOT NULL
        UNION
        SELECT id FROM profiles WHERE is_owner = true AND (v_zile_necitit >= 2 OR v_zile_dep <= 2 OR l.responsabil_id IS NULL)
      LOOP
        INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
        VALUES (v_pid, 'critical', 'Ofertare',
          format('⚠ RC necitit — %s — %s', coalesce(l.nr_anunt, 'licitația ' || l.id),
                 CASE WHEN v_zile_dep = 0 THEN 'depunerea e AZI' WHEN v_zile_dep = 1 THEN '1 zi până la depunere'
                      ELSE v_zile_dep || ' zile până la depunere' END),
          format('Răspuns de la autoritate necitit %s (din %s): %s. Deschide fișa licitației → Documentație → Procesează. Alerta se repetă zilnic până la procesare.',
                 CASE WHEN v_zile_necitit = 0 THEN 'de azi' WHEN v_zile_necitit = 1 THEN 'de 1 zi' ELSE 'de ' || v_zile_necitit || ' zile' END,
                 to_char(l.de_la, 'DD.MM'), l.lista),
          '/ofertare');
        v_trimise := v_trimise + 1;
      END LOOP;
    END IF;

    -- mailul (doar owner, ≤ 5 zile până la depunere): CEL MULT UN MAIL PE ZI per licitație (decizia coordonării 20.10, review Copilot
    -- r5 / Gemini r5: varianta „mail nou la document nou” stricase cheia de idempotență la reîncercare și pragul „deja trimis” la
    -- eliberare); un document nou în aceeași zi aduce doar clopoțelul. Stări: '<zi>|p|<lease>' (în curs, lease unic per preluare),
    -- '<zi>|s' (trimis), '<zi>|r' (eliberat = sigur netrimis). Revendicare atomică dacă: zi nouă, SAU „eliberat”, SAU „în curs” mai vechi
    -- de 10 minute (rezultat ambiguu → reîncercare cu ACEEAȘI cheie 'rc-necitit-<licitație>-<zi>', deci Resend nu dublează).
    -- Confirmarea / eliberarea fac CAS pe valoarea exactă, cu lease (un worker vechi nu atinge preluarea altuia).
    v_mail := false; v_ampr_mail := NULL;
    IF v_zile_dep <= 5 THEN
      v_ampr_mail := v_azi::text || '|p|' || gen_random_uuid()::text;
      v_claim := NULL;
      INSERT INTO ofertare_alerte_amprenta AS a (licitatie_id, fel, amprenta, trimisa_la)
      VALUES (l.id, 'rc_necitit_mail', v_ampr_mail, now())
      ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now()
        WHERE split_part(a.amprenta, '|', 1) IS DISTINCT FROM v_azi::text
           OR split_part(a.amprenta, '|', 2) = 'r'
           OR (split_part(a.amprenta, '|', 2) = 'p' AND a.trimisa_la < now() - interval '10 minutes')
      RETURNING 'x' INTO v_claim;
      v_mail := v_claim IS NOT NULL;
    END IF;

    v_lic := v_lic || jsonb_build_object('licitatie_id', l.id, 'nr_anunt', l.nr_anunt, 'obiect', left(coalesce(l.obiect, ''), 160),
      'zile_necitit', v_zile_necitit, 'zile_depunere', v_zile_dep, 'de_la', l.de_la, 'nr', l.nr, 'lista', l.lista,
      'doc_ids', string_to_array(l.ids, ',')::bigint[], 'mail', v_mail, 'amprenta_mail', CASE WHEN v_mail THEN v_ampr_mail END,
      -- cheia de idempotență Resend PER LICITAȚIE și ZI — aceeași la orice reîncercare (indiferent ce s-a procesat între timp)
      'cheie_mail', CASE WHEN v_mail THEN 'rc-necitit-' || l.id || '-' || v_azi::text END);
  END LOOP;
  RETURN jsonb_build_object('azi', v_azi, 'notificari', v_trimise, 'licitatii', v_lic);
END
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_alerte_atentie(p_zile integer DEFAULT 14)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid; v_amprenta text; v_veche text; v_trimise int := 0;
  v_zile int; v_lista text; v_nr int;
BEGIN
  FOR l IN
    SELECT id, nr_anunt, obiect, termen_depunere, responsabil_id, created_by
    FROM ofertare_licitatii
    WHERE termen_depunere > now()
      AND status IN ('in_lucru','go','identificata')
  LOOP
    v_zile := (l.termen_depunere::date - CURRENT_DATE);

    -- (1) fara responsabil, cu termenul in fata
    IF l.responsabil_id IS NULL AND v_zile <= p_zile THEN
      -- amprenta pe numarul de zile: revine daca situatia se inrautateste (mai putine zile),
      -- nu in fiecare dimineata cu acelasi text
      v_amprenta := md5(l.id::text || '|fara_resp|' || v_zile::text);
      SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta
       WHERE licitatie_id = l.id AND fel = 'fara_responsabil';
      IF v_veche IS DISTINCT FROM v_amprenta THEN
        FOR v_pid IN
          SELECT DISTINCT p FROM unnest(ARRAY[l.created_by]) p WHERE p IS NOT NULL
          UNION SELECT id FROM profiles WHERE is_owner = true
        LOOP
          INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
          VALUES (v_pid, 'warning', 'Ofertare',
            format('Fara responsabil, %s zile pana la depunere: %s', v_zile, coalesce(l.nr_anunt, 'licitatia ' || l.id)),
            format('„%s" nu are responsabil alocat si se depune peste %s zile. Fara responsabil nu se poate porni citirea integrala, registrul sau acoperirea (poarta pe cheltuiala) — deci licitatia nu avanseaza. Alege un responsabil in fisa licitatiei sau inchide-o daca nu o mai facem.',
                   left(coalesce(l.obiect, ''), 90), v_zile),
            '/ofertare');
          v_trimise := v_trimise + 1;
        END LOOP;
        INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
        VALUES (l.id, 'fara_responsabil', v_amprenta, now())
        ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
      END IF;
    END IF;

    -- (2) arhive pe care nu le putem desface, ramase neincarcate
    SELECT count(*), string_agg(left(nume_original, 50), '; ' ORDER BY nume_original)
      INTO v_nr, v_lista
    FROM ofertare_documente_atribuire d
    WHERE d.licitatie_id = l.id
      AND d.nume_original ~* '\.(rar|7z|z[0-9]{2}|part[0-9]+\.rar)$'
      AND (d.fisier_path IS NULL OR d.fisier_path LIKE '%/neincarcat/%');

    IF coalesce(v_nr, 0) > 0 THEN
      v_amprenta := md5(l.id::text || '|arhive|' || coalesce(v_lista, ''));
      SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta
       WHERE licitatie_id = l.id AND fel = 'arhiva_nedesfacuta';
      IF v_veche IS DISTINCT FROM v_amprenta THEN
        FOR v_pid IN
          SELECT DISTINCT p FROM unnest(ARRAY[l.responsabil_id, l.created_by]) p WHERE p IS NOT NULL
          UNION SELECT id FROM profiles WHERE is_owner = true
        LOOP
          INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
          VALUES (v_pid, 'warning', 'Ofertare',
            format('%s arhiva(e) de urcat manual: %s', v_nr, coalesce(l.nr_anunt, 'licitatia ' || l.id)),
            format('Pe „%s" au aparut in SEAP arhive pe care platforma nu le poate desface: %s. Dezarhiveaza-le pe calculator si trage folderul in „Urca folder" — altfel continutul lor NU intra in analiza. Termen: %s zile.',
                   left(coalesce(l.obiect, ''), 70), left(coalesce(v_lista, ''), 300), v_zile),
            '/ofertare');
          v_trimise := v_trimise + 1;
        END LOOP;
        INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
        VALUES (l.id, 'arhiva_nedesfacuta', v_amprenta, now())
        ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
      END IF;
    END IF;
  END LOOP;
  RETURN v_trimise;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_alerta_pagini_goale(p_lic bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid;
  n_pag int; n_doc int; v_lista text; v_amprenta text; v_veche text; v_trimise int := 0;
BEGIN
  FOR l IN
    SELECT id, nr_anunt, obiect, termen_depunere, responsabil_id, created_by
    FROM ofertare_licitatii
    WHERE (p_lic IS NULL OR id = p_lic)
      AND (p_lic IS NOT NULL OR (termen_depunere > now() AND status IN ('in_lucru','go','identificata')))
  LOOP
    SELECT count(*) FILTER (WHERE motiv = 'pagina_goala'),
           count(*) FILTER (WHERE motiv = 'document_neextras'),
           string_agg(DISTINCT CASE WHEN motiv = 'pagina_goala'
                THEN left(nume, 34) || ' p.' || pagina ELSE left(nume, 34) || ' (neextras)' END, '; ')
      INTO n_pag, n_doc, v_lista
    FROM ofertare_pagini_goale(l.id);

    IF coalesce(n_pag,0) + coalesce(n_doc,0) = 0 THEN CONTINUE; END IF;

    v_amprenta := md5(l.id::text || '|' || coalesce(v_lista,''));
    SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta
     WHERE licitatie_id = l.id AND fel = 'pagini_goale';
    IF v_veche = v_amprenta THEN CONTINUE; END IF;

    FOR v_pid IN
      SELECT DISTINCT p FROM unnest(ARRAY[l.responsabil_id, l.created_by]) p WHERE p IS NOT NULL
      UNION SELECT id FROM profiles WHERE is_owner = true
    LOOP
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_pid, 'warning', 'Ofertare',
        format('Extragere incompletă: %s', coalesce(l.nr_anunt, 'licitația ' || l.id)),
        format('%s pagină(i) cu text dar fără nicio cerință extrasă, %s document(e) citite și neextrase, la „%s". %s. Paginile astea au conținut care n-a ajuns în registru — așa s-au pierdut paginile 19-21 de la Mănăstirea.',
               coalesce(n_pag,0), coalesce(n_doc,0), left(coalesce(l.obiect,''), 60), left(coalesce(v_lista,''), 400)),
        '/ofertare');
      v_trimise := v_trimise + 1;
    END LOOP;

    INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
    VALUES (l.id, 'pagini_goale', v_amprenta, now())
    ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
  END LOOP;
  RETURN v_trimise;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_clarificari_notifica(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_resp uuid; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;
  SELECT responsabil_id INTO v_resp FROM public.ofertare_licitatii WHERE id=p_licitatie_id;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND cheie LIKE 'auto_planse_%' AND status <> 'retrasa' ORDER BY id FOR UPDATE LOOP
    v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
    IF v_st->>'stare' IN ('schimbata','indisponibila') AND v_st->>'amprenta_curenta' IS NOT NULL AND v_resp IS NOT NULL AND c.baza_generare->>'notificat_neactual' IS DISTINCT FROM v_st->>'amprenta_curenta' THEN
      INSERT INTO public.notifications(profile_id,type,modul,title,message,link_to) VALUES
        (v_resp,'info','Ofertare','Clarificare de reverificat','Licitația #'||p_licitatie_id||': baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.','/ofertare');
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('notificat_neactual',v_st->>'amprenta_curenta') WHERE id=c.id;
      v_n:=v_n+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'notificari',v_n);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('error',SQLERRM);
END $function$
;

CREATE OR REPLACE FUNCTION public.ofertare_clarificari_reminder()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_trimise integer := 0;
  r record;
  v_pid uuid;
BEGIN
  FOR r IN
    SELECT l.id AS lic_id, l.nr_anunt, l.obiect, l.termen_depunere, l.responsabil_id, l.created_by,
           count(*) AS nr_nedepuse,
           (l.termen_depunere::date - current_date) AS zile_pana_la_depunere
    FROM ofertare_clarificari k
    JOIN ofertare_licitatii l ON l.id = k.licitatie_id
    WHERE k.status = 'de_trimis'
      AND k.origine = 'platforma'
      AND l.termen_depunere IS NOT NULL
      AND l.termen_depunere > now()
    GROUP BY l.id, l.nr_anunt, l.obiect, l.termen_depunere, l.responsabil_id, l.created_by
  LOOP
    FOR v_pid IN
      SELECT DISTINCT p FROM unnest(ARRAY[r.responsabil_id, r.created_by]) p WHERE p IS NOT NULL
      UNION
      SELECT id FROM profiles WHERE is_owner = true
    LOOP
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (
        v_pid,
        CASE WHEN r.zile_pana_la_depunere <= 10 THEN 'warning' ELSE 'info' END,
        'Ofertare',
        format('Clarificare nedepusă: %s', coalesce(r.nr_anunt, 'licitație ' || r.lic_id)),
        format('Ai %s solicitare(ări) de clarificare scrise în platformă, dar nebifate ca trimise, la „%s". Depunerea ofertelor e în %s zile (%s). Termenul de întrebări e mai devreme — de regulă cu 8-10 zile înainte, verifică fișa. După ce o depui în SEAP, bifeaz-o „trimisă" în platformă, altfel nimeni nu știe dacă a plecat.',
               r.nr_nedepuse, left(coalesce(r.obiect, ''), 70), r.zile_pana_la_depunere, to_char(r.termen_depunere, 'DD.MM.YYYY')),
        '/ofertare'
      );
      v_trimise := v_trimise + 1;
    END LOOP;
  END LOOP;
  RETURN v_trimise;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[]; v_nume text[]; v_motive text[]; v_acoperite bigint[]; v_draft record; v_lot int;
  v_text text; v_lista text; v_det text; v_id bigint; v_nou boolean := false; v_resp uuid; v_nr int; v_noi int;
  v_antet constant text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe';
  v_standard boolean; v_tok text; v_det_fd text; v_ilizibile int; v_fara_date int;
  v_protejat boolean; v_flag int := 0; v_tc int;
  v_gen text; v_ev text; v_tok_gen text; v_tok_ev text; v_ids_sursa text; v_sursa_noua text;
  v_ev_fara constant text := left(md5('fara_planse_de_clarificat'), 12);
  v_baza jsonb; v_baza_gen jsonb; v_financiar text;
  v_surse_doc bigint[]; v_surse_cant bigint[]; v_fin_ids bigint[];   -- 20261026a
BEGIN
  SELECT count(*) INTO v_tc FROM public.v_ofertare_transfer_conflicte WHERE licitatie_id = p_licitatie_id AND deschis;
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
  IF v_ids IS NULL THEN
    UPDATE ofertare_clarificari c SET status = 'retrasa', updated_at = now()
     WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status = 'propunere'
       AND c.baza_generare->>'evaluare'='r9b' AND NOT (c.baza_generare ? 'reconfirmare' OR c.baza_generare ? 'text_editat_de')
       AND EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                    WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' AND substr(x.t, 5) = left(md5(coalesce(c.intrebare, '')), 12));
    WITH m AS (
      UPDATE ofertare_clarificari c SET
        sursa = coalesce((SELECT string_agg(x.t, ',' ORDER BY x.o) FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                  WHERE x.o = 1 OR x.t !~ '^ev_[0-9a-f]{12}$'), '')
                || ',ev_' || v_ev_fara
                || CASE WHEN 'revizie_planse_auto' = ANY (string_to_array(coalesce(c.sursa, ''), ',')) THEN '' ELSE ',revizie_planse_auto' END,
        updated_at = now()
       WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
         AND NOT (('ev_' || v_ev_fara) = ANY (string_to_array(coalesce(c.sursa, ''), ',')))
      RETURNING c.id)
    SELECT count(*) INTO v_flag FROM m;
    RETURN jsonb_build_object('actiune','nimic', 'de_revizuit', v_flag, 'transfer_conflicte_deschise', v_tc);
  END IF;
  SELECT coalesce(array_agg(x::bigint), '{}') INTO v_acoperite
  FROM ofertare_clarificari c, unnest(string_to_array(replace(c.sursa, 'planse_auto:', ''), ',')) x
  WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%'
    AND c.status NOT IN ('propunere','de_trimis') AND x ~ '^\d+$';
  SELECT array_agg(i), array_agg(n), array_agg(m) INTO v_ids, v_nume, v_motive
  FROM unnest(v_ids, v_nume, v_motive) AS t(i, n, m) WHERE NOT (i = ANY(v_acoperite));
  IF v_ids IS NULL THEN RETURN jsonb_build_object('actiune','deja_trimise', 'transfer_conflicte_deschise', v_tc); END IF;
  -- 20261026a: ID-urile documentelor financiare citate, din ACEEAȘI interogare ca textul (Jakarinos r1 P1 #2)
  SELECT string_agg('documentul #' || d.id || ' „' || d.nume_original || '”', '; ' ORDER BY d.id), array_agg(d.id ORDER BY d.id)
    INTO v_financiar, v_fin_ids
    FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id=p_licitatie_id AND d.tip='lista_cantitati';
  v_baza := public.ofertare_f3_baza(p_licitatie_id);
  -- 20261026a: proveniența textului, scrisă ODATĂ cu el (nu dedusă ulterior): planșele citate, documentele financiare citate
  -- în punctul 2 (exact ID-urile citite odată cu v_financiar), documentele și rândurile de cantități din baza F3.
  SELECT array_agg(DISTINCT s.x ORDER BY s.x) INTO v_surse_doc FROM (
    SELECT unnest(v_ids) AS x
    UNION SELECT unnest(v_fin_ids)
    UNION SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_baza->'documente') = 'array'
                                                            THEN v_baza->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$') s WHERE s.x IS NOT NULL;
  SELECT array_agg(DISTINCT (e->>'id')::bigint ORDER BY (e->>'id')::bigint) INTO v_surse_cant
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_baza->'randuri') = 'array' THEN v_baza->'randuri' ELSE '[]'::jsonb END) e
   WHERE e->>'id' ~ '^[0-9]{1,18}$';
  v_baza_gen := v_baza || jsonb_build_object('la', now(), 'sursa_generare', 'v6-r9b');
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
    '2. Vă rugăm să precizați corespondența dintre pozițiile din ' || coalesce(v_financiar,'documentul financiar aplicabil (vă rugăm să îl identificați)') || ' și tronsoanele din planșele identificate mai sus, pentru obiectele / loturile / etapele aferente, precum și modul de tratare a neclarităților descrise. Vă rugăm să indicați paginile, pozițiile și reperele corespunzătoare;' ||
    CASE WHEN v_ilizibile > 0 THEN E'\n' || '3. Ca alternativă, pentru planșele care nu au putut fi citite, varianta în format editabil (DWG/DXF) sau PDF cu text selectabil.' ELSE '' END ||
    E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';
  v_baza_gen := v_baza_gen || jsonb_build_object('text_hash',md5(v_text));
  v_gen := left(md5(v_text), 12);
  v_ev := left(md5(array_to_string(v_ids, ',') || '|' || array_to_string(v_motive, ',')), 12);
  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT string_agg(x.t, ',' ORDER BY x.o) INTO v_ids_sursa
      FROM unnest(string_to_array(replace(coalesce(v_draft.sursa, ''), 'planse_auto:', ''), ',')) WITH ORDINALITY AS x(t, o) WHERE x.t ~ '^\d+$';
    SELECT substr(x.t, 5) INTO v_tok_gen FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    SELECT substr(x.t, 4) INTO v_tok_ev FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^ev_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    v_standard := CASE WHEN v_draft.baza_generare->>'evaluare' = 'r9b' AND v_tok_gen IS NOT NULL THEN left(md5(coalesce(v_draft.intrebare, '')), 12) = v_tok_gen
                       ELSE false END;
    v_protejat := NOT v_standard OR v_draft.status = 'de_trimis' OR v_draft.baza_generare ? 'reconfirmare' OR v_draft.baza_generare ? 'text_editat_de';
    SELECT coalesce(string_agg(',' || t, '' ORDER BY o), '') INTO v_tok
      FROM unnest(string_to_array(v_draft.sursa, ',')) WITH ORDINALITY AS x(t, o) WHERE o > 1 AND t ~ '^revizie_[a-z0-9_]+$';
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    IF v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND (v_tok_ev IS NULL OR v_tok_ev = v_ev) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard, 'transfer_conflicte_deschise', v_tc);
    END IF;
    IF NOT v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND v_draft.intrebare = v_text
       AND v_tok_gen IS NOT DISTINCT FROM v_gen THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', false, 'baza_actualizata', false,
        'transfer_conflicte_deschise', v_tc, 'f3_baza', v_baza - 'randuri');
    END IF;
    IF v_protejat THEN
      v_flag := CASE WHEN v_tok_ev IS NOT DISTINCT FROM v_ev THEN 0 ELSE 1 END;
      SELECT 'planse_auto:' || array_to_string(v_ids, ',') || coalesce(string_agg(',' || x.t, '' ORDER BY x.o), '') INTO v_sursa_noua
        FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
       WHERE x.o > 1 AND x.t !~ '^\d+$' AND x.t !~ '^ev_[0-9a-f]{12}$' AND (v_flag = 0 OR x.t <> 'revizie_planse_auto');
      v_sursa_noua := v_sursa_noua || ',ev_' || v_ev || CASE WHEN v_flag = 1 THEN ',revizie_planse_auto' ELSE '' END;
      UPDATE ofertare_clarificari SET sursa = v_sursa_noua, updated_at = now()
        WHERE id = v_draft.id AND sursa IS DISTINCT FROM v_sursa_noua;
      RETURN jsonb_build_object('actiune','protejat_de_revizuit','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard,
        'status', v_draft.status, 'marcat_acum', v_flag = 1, 'transfer_conflicte_deschise', v_tc);
    END IF;
    UPDATE ofertare_clarificari SET
      intrebare = v_text,
      sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok || ',gen_' || v_gen || ',ev_' || v_ev,
      baza_generare = v_baza_gen,
      surse_document_ids = v_surse_doc, surse_cantitati_ids = v_surse_cant,   -- 20261026a (triggerul face reuniunea cu cele vechi)
      status = 'propunere', updated_at = now()
      WHERE id = v_draft.id AND status = 'propunere' AND intrebare IS NOT DISTINCT FROM v_draft.intrebare;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('actiune','neschimbat_concurent','id',v_draft.id,'planse',cardinality(v_ids), 'transfer_conflicte_deschise', v_tc);
    END IF;
    v_id := v_draft.id; v_nou := v_noi > 0;
  ELSE
    SELECT count(*) + 1 INTO v_lot FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id AND cheie LIKE 'auto_planse_%';
    SELECT coalesce(max(nr), 0) + 1 INTO v_nr FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id;
    INSERT INTO ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare,
                                      surse_document_ids, surse_cantitati_ids)   -- 20261026a
      VALUES (p_licitatie_id, v_nr, v_text, 'planse_auto:' || array_to_string(v_ids, ',') || ',gen_' || v_gen || ',ev_' || v_ev, 'propunere', 'automat', 'auto_planse_' || v_lot, v_baza_gen,
              v_surse_doc, v_surse_cant)
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
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'transfer_conflicte_deschise', v_tc,
    'f3_baza', v_baza - 'randuri');
END $function$
;

DROP VIEW public.v_ofertare_dashboard;
CREATE VIEW public.v_ofertare_dashboard WITH (security_invoker = on) AS
 SELECT l.id,
    l.nr_anunt,
    l.autoritate,
    l.obiect,
    l.valoare_estimata,
    l.moneda,
    l.termen_depunere,
    l.status,
    l.decizie_go,
    l.nas_path,
    l.created_at,
    GREATEST(0::numeric, ceil(EXTRACT(epoch FROM l.termen_depunere - now()) / 86400.0))::integer AS zile_ramase,
    ( SELECT count(*) AS count
           FROM ofertare_documente_atribuire d
          WHERE d.licitatie_id = l.id) AS nr_documente,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL) AS nr_cerinte,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.tip = 'eliminatorie'::text) AS nr_eliminatorii,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.tip = 'eliminatorie'::text AND c.stare <> 'nu_se_aplica'::text AND NOT (EXISTS ( SELECT 1
                   FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])) AND NOT a.reverificare_ceruta))) AS eliminatorii_neacoperite,
    l.responsabil_id,
    p.name AS responsabil_nume,
    ( SELECT g.status
           FROM ofertare_garantii g
          WHERE g.licitatie_id = l.id AND g.status <> 'anulata'::text
          ORDER BY g.id DESC
         LIMIT 1) AS garantie_status,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.stare = 'nu_se_aplica'::text) AS cerinte_nu_se_aplica,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.stare = 'blocata'::text) AS cerinte_blocate,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND (EXISTS ( SELECT 1
                   FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND a.reverificare_ceruta))) AS cerinte_de_reverificat
   FROM ofertare_licitatii l
     LEFT JOIN profiles p ON p.id = l.responsabil_id;
REVOKE ALL ON public.v_ofertare_dashboard FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.v_ofertare_dashboard TO anon, authenticated;
GRANT ALL ON public.v_ofertare_dashboard TO service_role;
ALTER TABLE public.ofertare_licitatii DROP CONSTRAINT ofertare_licitatii_responsabil2_diferit, DROP COLUMN responsabil2_id, DROP COLUMN responsabil2_setat_de;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ofertare_responsabil_setat_de()'::regprocedure)) IS DISTINCT FROM 'bebd4ffcf9d39c1e3a5da9d67b43811c' THEN RAISE EXCEPTION '20261121a revenire: fn_ofertare_responsabil_setat_de'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_alerta_rc_necitit()'::regprocedure)) IS DISTINCT FROM '069c87b6b8a5f99ae86466d1bba365bc' THEN RAISE EXCEPTION '20261121a revenire: ofertare_alerta_rc_necitit'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_alerte_atentie(integer)'::regprocedure)) IS DISTINCT FROM '910d8bedafd03147bd81ec72bff98541' THEN RAISE EXCEPTION '20261121a revenire: ofertare_alerte_atentie'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_alerta_pagini_goale(bigint)'::regprocedure)) IS DISTINCT FROM 'dd2898d4ae155a963d1d14cd6b9dd66e' THEN RAISE EXCEPTION '20261121a revenire: ofertare_alerta_pagini_goale'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_clarificari_notifica(bigint)'::regprocedure)) IS DISTINCT FROM 'ed8e31a709681e0dbb097b52029faef7' THEN RAISE EXCEPTION '20261121a revenire: ofertare_clarificari_notifica'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_clarificari_reminder()'::regprocedure)) IS DISTINCT FROM 'a5808200589e250d6565519dd0d43868' THEN RAISE EXCEPTION '20261121a revenire: ofertare_clarificari_reminder'; END IF;
  IF md5(pg_get_functiondef('public.ofertare_clarificare_planse_auto(bigint)'::regprocedure)) IS DISTINCT FROM 'ab130df1c1516f65fed472f89ed6d93e' THEN RAISE EXCEPTION '20261121a revenire: ofertare_clarificare_planse_auto'; END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_dashboard'::regclass, true)) IS DISTINCT FROM '534a796dbfccb5f0d458a0e32cc608be'
     OR (SELECT relacl::text FROM pg_class WHERE oid = 'public.v_ofertare_dashboard'::regclass) IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=arwdxt/postgres,authenticated=arwdxt/postgres,service_role=arwdDxtm/postgres}'
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii' AND column_name LIKE 'responsabil2%') THEN
    RAISE EXCEPTION '20261121a revenire: postconditie view / coloane';
  END IF;
  IF current_setting('gazpet.revenire_20261121a', true) IS DISTINCT FROM 'RESPONSABIL2_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261121a revenire: garda final';
  END IF;
END $post$;
