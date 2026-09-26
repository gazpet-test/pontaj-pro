-- R5 F01–F06 + F08. După aprobare_istoric + 1b + migrarea 2, înainte de workerul F08.
-- CREATE OR REPLACE: OID, triggere și ACL existente păstrate; zero rescrieri de date.
-- Funcția nouă CAS este SECURITY INVOKER, accesibilă numai service_role.
-- F04 schimbă amprenta tuturor bazelor R9b: ciornele vechi cer reverificare.
-- Raportul sarcinii: 0 reconfirmate în producție; număr neconfirmat independent.
BEGIN;

CREATE OR REPLACE FUNCTION public.ofertare_r5_blocaj_sursa(p_licitatie_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tot jsonb; v_um int; v_tcd int; v_tcn int; v_tic int; v_tcl text; v_err text; v_c jsonb; v_k text; v_n bigint;
BEGIN
  BEGIN
    v_tot := public.ofertare_totaluri_control(p_licitatie_id);
    IF jsonb_typeof(v_tot) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'control TOTAL indisponibil'; END IF;
    SELECT count(*) INTO v_um FROM public.ofertare_cantitati q WHERE q.licitatie_id=p_licitatie_id
      AND public.ofertare_clasa_unitate(q.um)->>'tip'='de_verificat';
    SELECT to_jsonb(c) INTO v_c FROM public.v_ofertare_cantitati_nevalidate c WHERE c.licitatie_id = p_licitatie_id;
    SELECT coalesce(c.transfer_conflicte_docs, 0), coalesce(c.transfer_conflicte_n, 0), coalesce(c.transfer_in_curs, 0), c.transfer_conflicte_lista
      INTO v_tcd, v_tcn, v_tic, v_tcl FROM public.v_ofertare_cantitati_nevalidate c WHERE c.licitatie_id = p_licitatie_id;
  EXCEPTION WHEN others THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    RETURN format(': nu putem verifica sursa cantităților (conflictele transferului din planșe: %s) — nu înseamnă zero restanțe', v_err);
  END IF;
  -- F01: aceleași șapte contoare ca poarta JS; înainte de restanțele transferului.
  FOREACH v_k IN ARRAY ARRAY['lista_f3_nevalidate','lista_f3_validate_fara_cant','invalidate_in_afara_retea',
    'total_invalidate','unitate_schimbata_in_afara_retea','um_de_normalizat_f3','retea_alte_unitati_lungimi_f3'] LOOP
    IF v_c IS NOT NULL AND (v_c->>v_k IS NULL) THEN
      RETURN format(' — nu putem verifica cantitățile: contorul %s lipsește', v_k);
    END IF;
    v_n := coalesce((v_c->>v_k)::bigint,0);
    IF v_n > 0 THEN RETURN format(' — cantități de verificat: %s = %s; verifică și validează pozițiile în Cantități',v_k,v_n); END IF;
  END LOOP;
  IF v_um > 0 THEN RETURN ' — unitate de verificat: baza cantităților este incompletă'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_tot) t WHERE t->>'stare' <> 'ok') THEN
    RETURN ' — ' || (SELECT string_agg(DISTINCT t->>'text',' ') FROM jsonb_array_elements(v_tot) t WHERE t->>'stare'<>'ok');
  END IF;
  IF coalesce(v_tcd, 0) > 0 THEN
    RETURN format(' — sursa cantităților e incompletă: %s la transferul din %s (%s): rezolvă-le (recitire care le acoperă) sau confirmă-le în Documente (rezolvare / excepție justificată, cu drept de decizie)',
      CASE WHEN v_tcn = 1 THEN '1 restanță deschisă' ELSE v_tcn || ' restanțe deschise' END, CASE WHEN v_tcd = 1 THEN '1 planșă' ELSE v_tcd || ' planșe' END,
      coalesce(v_tcl, '—'));
  END IF;
  IF coalesce(v_tic, 0) > 0 THEN
    RETURN format(' — transfer din planșă în curs (%s documente): impactul asupra cantităților nu e stabilit; reîncearcă după ce se termină', v_tic);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_clarificari_baza()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb; v_auto boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF coalesce(OLD.cheie,'') LIKE 'auto_planse_%' THEN RAISE EXCEPTION 'Proveniența și deciziile se păstrează; retrage ciorna în loc de ștergere'; END IF;
    RETURN OLD;
  END IF;
  v_auto := coalesce(NEW.cheie,'') LIKE 'auto_planse_%' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') LIKE 'auto_planse_%');
  -- F02/F03: proveniența veche contează și când clientul încearcă s-o schimbe.
  IF NEW.origine IN ('platforma','automat') OR (TG_OP='UPDATE' AND OLD.origine IN ('platforma','automat')) OR v_auto THEN
    IF TG_OP='UPDATE' AND (NEW.origine,NEW.licitatie_id) IS DISTINCT FROM (OLD.origine,OLD.licitatie_id) THEN
      RAISE EXCEPTION 'Proveniența clarificării de platformă este imuabilă';
    END IF;
    IF NEW.status='raspunsa' AND (TG_OP='INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('trimisa','raspunsa')) THEN
      RAISE EXCEPTION 'Clarificare blocată: răspunsul cere o clarificare trimisă';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('trimisa','raspunsa') AND ((NEW.intrebare,NEW.fisier_path) IS DISTINCT FROM (OLD.intrebare,OLD.fisier_path)
        OR NEW.status IS NULL OR NEW.status NOT IN ('trimisa','raspunsa')) THEN RAISE EXCEPTION 'Documentul transmis este imuabil'; END IF;
      -- O editare nu moștenește aprobarea textului anterior, indiferent de writer.
      IF NEW.intrebare IS DISTINCT FROM OLD.intrebare
         AND (OLD.status='de_trimis' OR NEW.status='de_trimis') THEN NEW.status := 'propunere'; END IF;
    END IF;
    IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
       AND current_user IN ('authenticated','anon')
       AND NOT coalesce(public.fn_ofertare_source_pack_poate_decide(NEW.licitatie_id),false) THEN
      RAISE EXCEPTION 'Clarificare blocată: aprobarea cere drept de decizie pe licitație';
    END IF;
  END IF;
  -- Amprenta R9b rămâne exclusiv pe auto_planse_%. 
  IF NOT v_auto THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.cheie,NEW.licitatie_id,NEW.origine) IS DISTINCT FROM (OLD.cheie,OLD.licitatie_id,OLD.origine) THEN
      RAISE EXCEPTION 'Proveniența clarificării automate este imuabilă';
    END IF;
  END IF;
  IF current_user IN ('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Ciorna automată se creează doar prin generatorul controlat'; END IF;
    IF NEW.baza_generare IS DISTINCT FROM OLD.baza_generare THEN RAISE EXCEPTION 'Baza și aprobarea se scriu doar prin reconfirmare'; END IF;
    NEW.sursa := OLD.sursa;
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare AND current_user IN ('authenticated','anon','service_role') THEN
    -- Textul se salvează, aprobarea nu se transferă. Istoricul deciziilor se păstrează.
    NEW.baza_generare := (coalesce(NEW.baza_generare,'{}'::jsonb)-'reconfirmare') ||
      CASE WHEN OLD.baza_generare ? 'reconfirmare' AND NOT (OLD.baza_generare ? 'istoric_decizii')
        THEN jsonb_build_object('istoric_decizii',jsonb_build_array(OLD.baza_generare->'reconfirmare')) ELSE '{}'::jsonb END ||
      jsonb_build_object('text_editat_de',auth.uid(),'text_editat_la',now());
    IF NEW.status='de_trimis' THEN NEW.status := 'propunere'; END IF;
  END IF;
  -- F04: o editare nu poate reactiva excepția nici după revenirea la textul anterior.
  -- Generatorul poate rescrie baza unei propuneri încă nereconfirmate: nu pierde auditul excepției.
  IF TG_OP='UPDATE' AND OLD.baza_generare ? 'istoric_decizii'
     AND NOT (coalesce(NEW.baza_generare,'{}'::jsonb) ? 'istoric_decizii') THEN
    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) ||
      jsonb_build_object('istoric_decizii',OLD.baza_generare->'istoric_decizii');
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare THEN
    NEW.baza_generare := NEW.baza_generare - 'exceptie_identitate';
  END IF;
  IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_st := public.ofertare_clarificare_baza_stare(NEW.licitatie_id,NEW.intrebare,NEW.sursa,NEW.baza_generare);
    IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') OR coalesce((v_st->>'marcaj_planse')::boolean,true) THEN
      RAISE EXCEPTION 'Clarificare blocată: %. Reconfirmă textul pe baza curentă.',v_st->>'text';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.ofertare_f3_baza(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_randuri jsonb; v_conflicte jsonb; v_doc jsonb; v_totaluri jsonb; v_suma numeric; v_n int; v_nev int; v_um int; v_alte jsonb;
BEGIN
  -- Perimetru: lista financiară și rețeaua licitației. În hash intră toate atributele relevante,
  -- inclusiv validarea, baza planșei și sursa, fără timestamp-uri sau ordinea afișării.
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::bigint),'[]'::jsonb) INTO v_randuri FROM (
    SELECT jsonb_build_object('id',q.id,'c',round(q.cantitate,6),'cp',round(q.cantitate_plansa,6),
      'um',public.ofertare_norm_text(q.um),'s',q.status,'o',public.ofertare_norm_text(q.obiect),
      'd',public.ofertare_norm_text(q.denumire),'categorie',public.ofertare_norm_text(q.categorie),
      'sursa',public.ofertare_norm_text(q.sursa),'tip_sursa',q.tip_sursa,'specificatii',public.ofertare_norm_text(q.specificatii),
      'cod_articol',public.ofertare_norm_text(q.cod_articol),'unitate',public.ofertare_clasa_unitate(q.um),
      'total',(coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total') x
    FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id
      AND (q.tip_sursa = 'lista_f3' OR q.categorie ~* 'conduct|re[țt]ea'
        OR (coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total'
        OR EXISTS (SELECT 1 FROM public.ofertare_cantitati t WHERE t.licitatie_id=q.licitatie_id
          AND (coalesce(t.obiect,'') || ' ' || coalesce(t.denumire,'') || ' ' || coalesce(t.sursa,'')) ~* 'total'
          AND (public.ofertare_norm_text(t.obiect),public.ofertare_norm_text(t.sursa),public.ofertare_norm_text(t.categorie),public.ofertare_norm_text(t.tip_sursa))
            IS NOT DISTINCT FROM (public.ofertare_norm_text(q.obiect),public.ofertare_norm_text(q.sursa),public.ofertare_norm_text(q.categorie),public.ofertare_norm_text(q.tip_sursa))))
  ) r;
  SELECT coalesce(jsonb_agg(x || jsonb_build_object('h',md5(x::text)) ORDER BY (x->>'id')::bigint),'[]'::jsonb)
    INTO v_randuri FROM jsonb_array_elements(v_randuri) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.document_id,'token',t.token,'stare',t.stare,
      'conflicte',t.conflicte,'restante',t.restante,'in_curs',t.in_curs) ORDER BY t.document_id),'[]'::jsonb)
    INTO v_conflicte FROM public.v_ofertare_transfer_conflicte t WHERE t.licitatie_id = p_licitatie_id AND (t.deschis OR t.in_curs);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'nume',d.nume_original,'plansa',d.analiza->'plansa',
      'eroare',d.eroare,'fisier_path',d.fisier_path,'marime',d.size_bytes,
      'sha256',h.sha256,'fisier_sha256',to_jsonb(d)->'fisier_sha256','integritate',d.analiza->'integritate',
      'identitate',CASE WHEN h.sha256 IS NULL THEN 'limitata' ELSE 'verificata' END,
      'identitate_incompleta',h.sha256 IS NULL) ORDER BY d.id),'[]'::jsonb) INTO v_doc
    FROM public.ofertare_documente_atribuire d
    -- F04 B: asociere exclusiv prin document_id; ultimul manifest eligibil, cu mărimea exactă.
    LEFT JOIN LATERAL (
      SELECT lower(m.sha256) sha256 FROM public.ofertare_seap_manifest m
      WHERE m.document_id=d.id AND m.licitatie_id=d.licitatie_id AND m.marime=d.size_bytes
        AND m.sha256 ~* '^[0-9a-f]{64}$'
      ORDER BY m.verificat_la DESC, m.id DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT lower(x.hash) sha256 FROM unnest(ARRAY[to_jsonb(d)->>'sha256',to_jsonb(d)->>'fisier_sha256',
        d.analiza#>>'{integritate,sha256}',d.analiza#>>'{integritate,fisier_sha256}',m.sha256])
        WITH ORDINALITY x(hash,poz) WHERE x.hash ~* '^[0-9a-f]{64}$' ORDER BY x.poz LIMIT 1
    ) h ON true
    WHERE d.licitatie_id = p_licitatie_id AND (d.analiza ? 'plansa' OR d.tip = 'lista_cantitati');
  v_totaluri := public.ofertare_totaluri_control(p_licitatie_id);
  SELECT count(*) FILTER (WHERE x->>'tip_sursa' = 'lista_f3'),
    count(*) FILTER (WHERE NOT (x->>'total')::boolean AND (x->>'s' IS DISTINCT FROM 'validat' OR x->>'c' IS NULL)),
    count(*) FILTER (WHERE x->'unitate'->>'tip' = 'de_verificat'),
    sum((x->>'c')::numeric * (x->'unitate'->>'factor')::numeric)
      FILTER (WHERE x->>'tip_sursa' = 'lista_f3' AND x->>'categorie' ~* 'conduct|re[țt]ea' AND x->>'s' = 'validat' AND NOT (x->>'total')::boolean AND x->'unitate'->>'tip' = 'lungime')
    INTO v_n,v_nev,v_um,v_suma FROM jsonb_array_elements(v_randuri) x;
  SELECT coalesce(jsonb_object_agg(u,jsonb_build_object('suma',s,'randuri',n)),'{}'::jsonb) INTO v_alte FROM (
    SELECT x->>'um' u,sum((x->>'c')::numeric) s,count(*) n FROM jsonb_array_elements(v_randuri) x
    WHERE x->'unitate'->>'tip' = 'alta' AND NOT (x->>'total')::boolean GROUP BY 1
  ) a;
  RETURN jsonb_build_object('v',2,'evaluare','r9b','mod','corespondenta',
    'amprenta',md5(jsonb_build_array('r5_f04_v2',v_randuri,v_conflicte,v_doc)::text),'randuri',v_randuri,
    'identitate_incompleta',EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc) x WHERE (x->>'identitate_incompleta')::boolean),
    'documente',v_doc,'n_f3',v_n,'n_de_verificat',v_nev+v_um,'de_verificat',jsonb_build_object('nevalidate',v_nev,'unitate_de_verificat',v_um),
    'suma',v_suma,'alte_unitati',v_alte,'totaluri',v_totaluri,'conflicte_transfer',jsonb_array_length(v_conflicte),
    'text',format('Review intern: %s poziții de verificat; %s cu unitate de verificat. Suma lungimilor F3 validate: %s m (detalii, fără TOTAL). Alte unități: %s. Conflicte deschise: %s.',
      v_nev,v_um,coalesce(v_suma::text,'nedeterminată'),v_alte::text,jsonb_array_length(v_conflicte)) ||
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc) x WHERE (x->>'identitate_incompleta')::boolean)
        THEN ' Identitate limitată: nu putem detecta înlocuirea fișierului cu alt conținut la aceeași cale și aceeași mărime (documente: ' ||
          (SELECT string_agg(format('#%s %s',x->>'id',x->>'nume'),', ' ORDER BY (x->>'id')::bigint)
            FROM jsonb_array_elements(v_doc) x WHERE x->>'identitate'='limitata') || ').' ELSE '' END);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_blocaj text; v_gasit boolean; v_r5 text;
BEGIN
  IF (NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat'))
     OR (NEW.stare = 'depus' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'depus')) THEN
    SELECT true, blocaj INTO v_gasit, v_blocaj FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = NEW.licitatie_id;
    IF v_gasit IS NULL THEN
      RAISE EXCEPTION 'Aprobare blocată: nu putem verifica completitudinea documentației (licitația % nu apare în control)', NEW.licitatie_id USING ERRCODE = 'P0001';
    END IF;
    IF v_blocaj IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată — documentația nu e completă: %', v_blocaj USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- R5 (reparația rundei 1): sursa cantităților — conflictele transferului planșă → cantități DESCHISE blochează aprobarea finală.
  -- Reparația rundei 2 (verificatorul BD, minor): și la aprobat → depus — un conflict apărut DUPĂ aprobare (ex. dintr-o recitire) nu mai
  -- trece la depunere. F05: și completitudinea SEAP se reverifică la aprobat → depus.
  IF NEW.stare IN ('aprobat', 'depus') AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM NEW.stare) THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.licitatie_id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată%', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_aprobare()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c_campuri constant text[] := ARRAY['licitatie_id','um','cantitate','cantitate_plansa','denumire','specificatii','obiect','categorie','tip_sursa','sursa','cod_articol'];
  c_etichete constant jsonb := '{"licitatie_id":"licitația","um":"unitatea de măsură","cantitate":"cantitatea","cantitate_plansa":"cifra din planșă","denumire":"denumirea","specificatii":"specificațiile","obiect":"obiectul (tronson / etapă)","categorie":"categoria","tip_sursa":"tipul sursei","sursa":"sursa","cod_articol":"codul articolului (poziția din listă)"}';
  c_prefix constant text := 'Rândul era VALIDAT — aprobarea veche';
  c_final constant text := 'validarea se reface.';
  v_old jsonb; v_new jsonb; v_ref jsonb; v_sursa_ref text; k text; a text; b text; r text; v_distinct boolean; v_rel boolean;
  na numeric; nb numeric; nr numeric; ea numeric; eb numeric; v_rel_c text[] := '{}'; v_sub_c text[] := '{}'; v_desc text[] := '{}'; v_der text[] := '{}';
  ta jsonb; tb jsonb; d text; v_motiv text; v_nota text; v_status_cerut text; v_aprob jsonb; v_nou jsonb := '{}';
  v_rol text; v_ref_cant numeric; v_ref_cp numeric; v_ref_um text; v_ref_upd timestamptz;
  -- 1b: severitatea din notă (pereche cu descrieDiferenta din JS) și unitățile afișate
  v_sev text; v_u_vechi text; v_u_nou text; v_dmu numeric; v_amu numeric; v_pct numeric; v_lung boolean; v_semn text;
BEGIN
  BEGIN v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
  EXCEPTION WHEN others THEN v_rol := session_user::text; END;

  IF TG_OP = 'DELETE' THEN
    -- F06: ultima validare identificabilă rămâne referință și după invalidare.
    SELECT jsonb_build_object('istoric_id',h.id,'status','validat','ultima_scriere',h.created_at,
      'cantitate',h.valori_noi->'cantitate','cantitate_plansa',h.valori_noi->'cantitate_plansa',
      'um',h.valori_noi->'um','nota',h.valori_noi->'diferenta_nota')
      INTO v_aprob FROM public.ofertare_cantitati_istoric h
      WHERE h.cantitate_id=OLD.id AND h.motiv='validat' ORDER BY h.id DESC LIMIT 1;
    IF v_aprob IS NULL THEN
      -- Rânduri aprobate înaintea istoricului: invalidarea/redeschiderea păstrează dovada.
      -- Un eveniment unitate_schimbata nu dovedește o aprobare anterioară.
      SELECT coalesce(h.aprobare_veche,'{}'::jsonb) || jsonb_build_object(
        'istoric_id',h.id,'status','validat',
        'ultima_scriere',coalesce(h.aprobare_veche->>'ultima_scriere',h.valori_vechi->>'updated_at'),
        'cantitate',coalesce(h.aprobare_veche->'cantitate',h.valori_vechi->'cantitate'),
        'cantitate_plansa',coalesce(h.aprobare_veche->'cantitate_plansa',h.valori_vechi->'cantitate_plansa'),
        'um',coalesce(h.aprobare_veche->'um',h.valori_vechi->'um'),
        'nota',coalesce(h.aprobare_veche->'nota',h.valori_vechi->'diferenta_nota'))
        INTO v_aprob FROM public.ofertare_cantitati_istoric h
        WHERE h.cantitate_id=OLD.id AND h.motiv IN ('invalidat','redeschis')
          AND (h.aprobare_veche->>'status'='validat' OR h.status_vechi='validat')
        ORDER BY h.id DESC LIMIT 1;
    END IF;
    IF OLD.status = 'validat' OR v_aprob IS NOT NULL THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, valori_vechi, aprobare_veche, autor, rol)
      VALUES (OLD.id, OLD.licitatie_id, 'sters', OLD.status, to_jsonb(OLD),
              coalesce(v_aprob,jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota)),
              auth.uid(), v_rol);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM 'validat' THEN
    -- validarea explicită (✓) și orice rând nevalidat: NEATINSE (ca înainte). VALIDAREA se înregistrează — rândul aprobat
    -- (valori_noi = rândul întreg) e referința cu care se compară scrierile următoare; schimbarea de unitate din / în „m”
    -- (normalizat) pe un rând nevalidat = 'unitate_schimbata' (semnal, fără modificare).
    IF NEW.status IS DISTINCT FROM 'validat'
       AND public.ofertare_norm_text(OLD.um) <> public.ofertare_norm_text(NEW.um)
       AND 'm' IN (public.ofertare_norm_text(OLD.um), public.ofertare_norm_text(NEW.um)) THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'unitate_schimbata', OLD.status, NEW.status, NEW.status, ARRAY['um'], to_jsonb(OLD),
              jsonb_build_object('um', NEW.um),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    IF NEW.status = 'validat' THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'validat', OLD.status, NEW.status, NEW.status, to_jsonb(OLD), to_jsonb(NEW),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  -- valoarea APROBATĂ (aceeași regulă ca referinteDinIstoric din JS)
  SELECT h.valori_noi INTO v_ref FROM public.ofertare_cantitati_istoric h
   WHERE h.cantitate_id = OLD.id AND h.motiv = 'validat' AND h.valori_noi IS NOT NULL ORDER BY h.id DESC LIMIT 1;
  v_sursa_ref := 'validare';
  IF v_ref IS NULL THEN
    SELECT h.valori_vechi INTO v_ref FROM public.ofertare_cantitati_istoric h
     WHERE h.cantitate_id = OLD.id AND h.motiv NOT IN ('validat', 'unitate_schimbata') ORDER BY h.id LIMIT 1;
    v_sursa_ref := 'prima_scriere_inregistrata';
  END IF;
  IF v_ref IS NULL THEN v_ref := v_old; v_sursa_ref := 'randul_curent'; END IF;
  v_ref_cant := (v_ref ->> 'cantitate')::numeric; v_ref_cp := (v_ref ->> 'cantitate_plansa')::numeric;
  v_ref_um := v_ref ->> 'um'; v_ref_upd := (v_ref ->> 'updated_at')::timestamptz;

  -- 1b: fără v_tol (toleranța de 1 m) — cifrele se compară EXACT, pe valoarea canonică round(x, 6)
  FOREACH k IN ARRAY c_campuri LOOP
    a := v_old ->> k; b := v_new ->> k; r := v_ref ->> k; v_sev := NULL;
    IF k IN ('cantitate', 'cantitate_plansa', 'licitatie_id') THEN
      na := a::numeric; nb := b::numeric; nr := r::numeric;
      v_distinct := na IS DISTINCT FROM nb;   -- numeric: 100 = 100.000 (doar forma) => nicio scriere distinctă
      IF NOT v_distinct THEN CONTINUE; END IF;
      IF k = 'licitatie_id' THEN v_rel := nr IS DISTINCT FROM nb;
      ELSE
        IF k = 'cantitate' THEN ea := nr; eb := nb;
        ELSE   -- cifra din planșă EFECTIVĂ (ca referintaCitire / cifraSchimbata), față de cea aprobată
          -- Observația e în metri; doar fallback-ul poartă unitatea rândului.
          ea := coalesce(v_ref_cp, v_ref_cant * coalesce((public.ofertare_clasa_unitate(v_ref_um)->>'factor')::numeric,1));
          eb := coalesce(NEW.cantitate_plansa, NEW.cantitate * coalesce((public.ofertare_clasa_unitate(NEW.um)->>'factor')::numeric,1));
        END IF;
        v_rel := round(ea, 6) IS DISTINCT FROM round(eb, 6);   -- 1b: exact (apariția / dispariția cifrei = schimbare)
        IF k = 'cantitate_plansa' THEN v_rel := v_rel AND round(nr, 6) IS DISTINCT FROM round(nb, 6); END IF;
        -- unitățile afișate: cantitatea în unitatea rândului (aprobată / nouă); cifra din planșă e o lungime
        v_u_vechi := CASE WHEN k = 'cantitate' THEN coalesce(nullif(v_ref_um, ''), 'm') ELSE 'm' END;
        v_u_nou := CASE WHEN k = 'cantitate' THEN coalesce(nullif(NEW.um, ''), 'm') ELSE 'm' END;
        -- severitatea (doar text): pe cifrele efective, ambele prezente, aceeași unitate normalizată
        IF v_rel AND ea IS NOT NULL AND eb IS NOT NULL
           AND (k = 'cantitate_plansa' OR public.ofertare_norm_text(v_ref_um) = public.ofertare_norm_text(NEW.um)) THEN
          v_lung := k = 'cantitate_plansa' OR public.ofertare_norm_text(NEW.um) IN ('', 'm', 'ml');
          v_dmu := (round(eb, 6) - round(ea, 6)) * 1000000;   -- Δ în milionimi (întreg exact)
          v_amu := abs(round(ea, 6)) * 1000000;
          v_semn := CASE WHEN v_dmu > 0 THEN '+' ELSE '-' END;
          -- reparația rundei 1: procentul AFIȘAT e TRUNCHIAT (div pe pozitive = floor), pragul se compară pe valoarea exactă (mai jos)
          v_pct := CASE WHEN v_amu = 0 THEN NULL ELSE div(abs(v_dmu) * 10000, v_amu) END;   -- sutimi de procent, trunchiat
          -- |Δ| exact, cu toate zecimalele semnificative (max. 6): „+0,8”, „+0,001”, „-1.110” (ca fmtMilionimi din JS)
          v_sev := 'diferență ' || CASE WHEN v_amu > 0 AND abs(v_dmu) * 100 < v_amu AND (NOT v_lung OR abs(v_dmu) < 1000000) THEN 'mică' ELSE 'mare' END || ': ' || v_semn ||
                   rtrim(rtrim(translate(to_char(abs(v_dmu) / 1000000, 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ',') || ' ' || v_u_nou ||
                   CASE WHEN v_pct IS NULL THEN '' WHEN v_pct = 0 THEN ', sub 0,01 %' ELSE ', ' || v_semn || rtrim(rtrim(translate(to_char(round(v_pct, 2) / 100, 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.00'), ',.', '.,'), '0'), ',') || ' %' END ||
                   CASE WHEN k = 'cantitate_plansa' AND (nr IS NULL OR nb IS NULL)
                        THEN ', efectiv ' || coalesce(rtrim(rtrim(translate(to_char(round(ea, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m → ' || coalesce(rtrim(rtrim(translate(to_char(round(eb, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' ELSE '' END;
        END IF;
      END IF;
    ELSIF k = 'um' THEN   -- unitatea NORMALIZATĂ (ca normUm din JS și filtrele de rețea ale view-ului / v6)
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    ELSE
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    END IF;
    v_nou := v_nou || jsonb_build_object(k, v_new -> k);
    IF v_rel THEN
      v_rel_c := v_rel_c || k;
      v_desc := v_desc || format('%s (%s → %s%s)', c_etichete ->> k,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(r::numeric, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN r IS NULL THEN '' ELSE ' ' || v_u_vechi END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(r, '—')
             ELSE '„' || CASE WHEN length(coalesce(r, '—')) > 60 THEN left(coalesce(r, '—'), 59) || '…' ELSE coalesce(r, '—') END || '”' END,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(b::numeric, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN b IS NULL THEN '' ELSE ' ' || v_u_nou END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(b, '—')
             ELSE '„' || CASE WHEN length(coalesce(b, '—')) > 60 THEN left(coalesce(b, '—'), 59) || '…' ELSE coalesce(b, '—') END || '”' END,
        CASE WHEN v_sev IS NULL THEN '' ELSE '; ' || v_sev END);
    ELSE
      v_sub_c := v_sub_c || k;
    END IF;
  END LOOP;

  IF 'denumire' = ANY (v_rel_c) OR 'specificatii' = ANY (v_rel_c) THEN
    ta := public.ofertare_cantitati_atribute(coalesce(v_ref ->> 'denumire', '') || ' ' || coalesce(v_ref ->> 'specificatii', ''));
    tb := public.ofertare_cantitati_atribute(coalesce(NEW.denumire, '') || ' ' || coalesce(NEW.specificatii, ''));
    FOREACH d IN ARRAY ARRAY['dn', 'material', 'sdr'] LOOP
      IF (ta ->> d) IS DISTINCT FROM (tb ->> d) THEN
        v_der := v_der || format('%s %s → %s', CASE d WHEN 'dn' THEN 'Dn' WHEN 'material' THEN 'materialul' ELSE 'SDR' END,
                                 coalesce(ta ->> d, '—'), coalesce(tb ->> d, '—'));
      END IF;
    END LOOP;
  END IF;

  v_status_cerut := NEW.status;
  IF array_length(v_rel_c, 1) > 0 THEN
    v_motiv := 'invalidat';
    IF NEW.status = 'validat' THEN
      v_nota := coalesce(NEW.diferenta_nota, '');
      -- orice prefix de invalidare anterior (al regulii sau „Rândul era VALIDAT cu … —” al transferului) se taie: fără prefixe adunate
      IF v_nota LIKE 'Rândul era VALIDAT%' AND strpos(v_nota, c_final) > 0 THEN
        v_nota := ltrim(substr(v_nota, strpos(v_nota, c_final) + length(c_final)));
      END IF;
      -- reparația rundei 1: cifrele aprobate EXACT (max. 6 zecimale); SINGURA schimbare relevantă = cifra din planșă (observația unei
      -- citiri) => „e de reverificat … o citire nouă a planșei nu infirmă aprobarea” (pereche cu notaInvalidare / doarObservatiePlansa)
      v_nota := format(CASE WHEN v_rel_c = ARRAY['cantitate_plansa'] AND cardinality(v_der) = 0
                  THEN '%s (cantitate %s%s%s%s) e de reverificat: s-a schimbat %s — o citire nouă a planșei nu infirmă aprobarea. Valoarea și aprobarea veche rămân în rând și în istoric; %s '
                  ELSE '%s (cantitate %s%s%s%s) nu mai e valabilă: s-a schimbat %s. Valoarea și aprobarea veche rămân în istoric; %s ' END,
                  c_prefix, coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cant, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—'), CASE WHEN v_ref_cant IS NULL THEN '' ELSE ' ' || coalesce(nullif(v_ref_um, ''), 'm') END,
                  CASE WHEN v_ref_cp IS NULL THEN '' ELSE ', cifra din planșă ' || coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cp, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' END,
                  CASE WHEN v_ref_upd IS NULL THEN '' ELSE ', ultima scriere ' || to_char(v_ref_upd AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END,
                  array_to_string(v_der || v_desc, '; '), c_final) || v_nota;
      NEW.status := 'diferenta';
      NEW.diferenta_nota := v_nota;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'validat' THEN
    v_motiv := 'redeschis';
  ELSIF array_length(v_sub_c, 1) > 0 THEN
    v_motiv := 'modificat_sub_prag';   -- 1b: doar formă (texte, „m” → „M”, cifre egale canonic) — validarea rămâne
  ELSE
    RETURN NEW;   -- nimic din aprobare atins (doar notă, ordine, updated_at, extras_de_ai)
  END IF;

  v_aprob := jsonb_build_object('status', OLD.status, 'ultima_scriere', v_ref -> 'updated_at', 'cantitate', v_ref -> 'cantitate',
                                'cantitate_plansa', v_ref -> 'cantitate_plansa', 'um', v_ref -> 'um', 'nota', v_ref -> 'diferenta_nota',
                                'referinta', v_sursa_ref, 'valori_aprobate', CASE WHEN v_sursa_ref = 'randul_curent' THEN NULL ELSE v_ref END);
  INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                 campuri_sub_prag, valori_vechi, valori_noi, aprobare_veche, nota, autor, rol)
  VALUES (OLD.id, OLD.licitatie_id, v_motiv, OLD.status, v_status_cerut, NEW.status, v_rel_c, v_sub_c, v_old, v_nou, v_aprob,
          CASE WHEN v_motiv = 'invalidat' AND v_status_cerut = 'validat' THEN v_nota END, auth.uid(), v_rol);
  RETURN NEW;
END;
$fn$;

-- F08: CAS atomic prin POST, fără JSON mare în URL. Doar workerul are EXECUTE;
-- SECURITY INVOKER păstrează RLS și privilegiile apelantului.
CREATE OR REPLACE FUNCTION public.ofertare_plansa_analiza_cas(p_doc_id bigint, p_analiza_veche jsonb, p_patch jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(p_patch->'analiza') IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN
       ('analiza','analiza_la','status_procesare','eroare','text_extras','procesat_la')) THEN
    RAISE EXCEPTION 'Patch de citire planșă invalid';
  END IF;
  UPDATE public.ofertare_documente_atribuire d SET
    analiza=p_patch->'analiza',
    analiza_la=CASE WHEN p_patch ? 'analiza_la' THEN (p_patch->>'analiza_la')::timestamptz ELSE d.analiza_la END,
    status_procesare=CASE WHEN p_patch ? 'status_procesare' THEN p_patch->>'status_procesare' ELSE d.status_procesare END,
    eroare=CASE WHEN p_patch ? 'eroare' THEN p_patch->>'eroare' ELSE d.eroare END,
    text_extras=CASE WHEN p_patch ? 'text_extras' THEN p_patch->>'text_extras' ELSE d.text_extras END,
    procesat_la=CASE WHEN p_patch ? 'procesat_la' THEN (p_patch->>'procesat_la')::timestamptz ELSE d.procesat_la END
  WHERE d.id=p_doc_id AND d.analiza IS NOT DISTINCT FROM p_analiza_veche;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n=1;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_plansa_analiza_cas(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_plansa_analiza_cas(bigint,jsonb,jsonb) TO service_role;

-- Contract unități (întrebarea din review): cantitate = unitatea rândului; cantitate_plansa = metri (handler.ts o scrie în m).
-- Factorul unității se aplică doar pe baza „cantitate” — fără a doua conversie pe planșă. Pereche: factorBaza din src/ofertareUnitati.js.
CREATE OR REPLACE FUNCTION public.ofertare_totaluri_control(p_licitatie_id bigint, p_baza text DEFAULT 'cantitate')
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
WITH r AS (
 SELECT q.id, q.status, q.obiect, q.sursa,
   public.ofertare_norm_text(q.obiect) o, public.ofertare_norm_text(q.sursa) s,
   public.ofertare_norm_text(q.categorie) k, public.ofertare_norm_text(q.tip_sursa) ts,
   public.ofertare_norm_text(q.um) um, public.ofertare_clasa_unitate(q.um) u,
   CASE p_baza WHEN 'cantitate' THEN q.cantitate WHEN 'cantitate_plansa' THEN q.cantitate_plansa END v,
   (coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total' tot
 FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id
), t AS (
 SELECT r.*, a.n, a.nt, a.complet, a.suma,
   r.v * CASE WHEN p_baza = 'cantitate_plansa' THEN 1 ELSE coalesce((r.u->>'factor')::numeric,1) END declarat
 FROM r CROSS JOIN LATERAL (
   SELECT count(*) FILTER (WHERE NOT d.tot) n, count(*) FILTER (WHERE d.tot) nt,
     bool_and(d.status IS NOT DISTINCT FROM 'validat' AND d.v IS NOT NULL AND d.u->>'tip' = r.u->>'tip'
       AND (r.u->>'tip' = 'lungime' OR (r.u->>'tip' = 'alta' AND d.um = r.um))) FILTER (WHERE NOT d.tot) complet,
     sum(d.v * CASE WHEN p_baza = 'cantitate_plansa' THEN 1 ELSE coalesce((d.u->>'factor')::numeric,1) END) FILTER (WHERE NOT d.tot AND d.status = 'validat'
       AND d.u->>'tip' = r.u->>'tip' AND (r.u->>'tip' = 'lungime' OR (r.u->>'tip' = 'alta' AND d.um = r.um))) suma
   FROM r d WHERE (d.o,d.s,d.k,d.ts) IS NOT DISTINCT FROM (r.o,r.s,r.k,r.ts)
 ) a WHERE r.tot
), e AS (
 SELECT t.*, CASE WHEN coalesce(o,'') = '' OR coalesce(s,'') = '' OR coalesce(ts,'') = ''
   OR n = 0 OR nt <> 1 OR NOT coalesce(complet,false) OR status IS DISTINCT FROM 'validat' OR v IS NULL OR u->>'tip' = 'de_verificat'
   THEN 'necomparabil' WHEN round(declarat,6) IS DISTINCT FROM round(suma,6) THEN 'diferit' ELSE 'ok' END stare FROM t
)
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'baza',p_baza,'obiect',obiect,'sursa',sursa,
 'declarat',declarat,'suma_detalii',suma,'um',CASE WHEN u->>'tip' = 'lungime' THEN 'm' ELSE um END,
 'stare',stare,'text',CASE stare WHEN 'necomparabil' THEN 'Totalul declarat nu poate fi verificat din detaliile disponibile.'
 WHEN 'diferit' THEN 'Totalul declarat diferă de suma detaliilor validate.' ELSE '' END) ORDER BY id),'[]'::jsonb) FROM e
$function$;
REVOKE ALL ON FUNCTION public.ofertare_totaluri_control(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_totaluri_control(bigint,text) TO authenticated, service_role;

-- F04 B: stări, excepție auditată și porțile de ieșire.
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_baza_stare(p_licitatie_id bigint,p_intrebare text,p_sursa text,p_baza jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cur jsonb; v_st text; v_token text; v_hash text := md5(coalesce(p_intrebare,'')); v_old jsonb; v_dif jsonb; v_avertisment text; v_exceptie boolean;
BEGIN
  v_cur := public.ofertare_f3_baza(p_licitatie_id);
  IF nullif(v_cur->>'amprenta','') IS NULL THEN RAISE EXCEPTION 'bază indisponibilă'; END IF;
  v_token := md5((v_cur->>'amprenta') || '|' || v_hash);
  v_st := CASE WHEN p_baza->>'evaluare' IS DISTINCT FROM 'r9b' THEN 'indisponibila'
    WHEN p_baza->>'amprenta' IS DISTINCT FROM v_cur->>'amprenta' THEN 'schimbata'
    WHEN p_baza->'reconfirmare'->>'token' IS DISTINCT FROM v_token THEN 'necesita_review'
    ELSE 'ok' END;
  -- Luarea la cunoștință este informativă, NICIODATĂ aprobare pentru export sau de_trimis.
  IF v_st <> 'ok' AND p_baza->'luat_act'->>'token' = v_token THEN v_st := 'luat_act'; END IF;
  -- Identitatea limitată are prioritate inclusiv față de luat_act. Excepția NU ține loc de review.
  IF coalesce((v_cur->>'identitate_incompleta')::boolean,false) THEN
    SELECT 'Identitate limitată: nu putem detecta înlocuirea fișierului cu alt conținut la aceeași cale și aceeași mărime (documente: ' ||
      string_agg(format('#%s %s',x->>'id',x->>'nume'),', ' ORDER BY (x->>'id')::bigint) || ').'
      INTO v_avertisment FROM jsonb_array_elements(v_cur->'documente') x WHERE x->>'identitate'='limitata';
    v_exceptie := coalesce(p_baza->'exceptie_identitate'->>'token'=v_token
      AND p_baza->'exceptie_identitate'->>'de' IS NOT NULL
      AND p_baza->'exceptie_identitate'->>'la' IS NOT NULL
      AND length(btrim(p_baza->'exceptie_identitate'->>'motiv')) >= 10,false);
    v_st := CASE WHEN v_st='ok' AND v_exceptie THEN 'ok_identitate_limitata' ELSE 'identitate_limitata' END;
  END IF;
  v_old := CASE WHEN jsonb_typeof(p_baza->'randuri') = 'array' THEN p_baza->'randuri' ELSE '[]'::jsonb END;
  SELECT jsonb_build_object(
    'adaugate',coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(v_cur->'randuri') n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_old) o WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'scoase',coalesce((SELECT jsonb_agg(o) FROM jsonb_array_elements(v_old) o WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_cur->'randuri') n WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'modificate',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o->'id','inainte',o,'acum',n)) FROM jsonb_array_elements(v_old) o JOIN jsonb_array_elements(v_cur->'randuri') n ON o->>'id'=n->>'id' WHERE o->>'h' IS DISTINCT FROM n->>'h'),'[]'::jsonb)) INTO v_dif;
  RETURN jsonb_build_object('stare',v_st,'evaluare','r9b','amprenta_curenta',v_token,'amprenta_baza',v_cur->>'amprenta',
    'avertisment_identitate',v_avertisment,'exceptie_identitate_valida',coalesce(v_exceptie,false),
    'text_hash',v_hash,'curent',v_cur-'randuri','diferente',v_dif,'mod_ciorna','corespondenta',
    'marcaj_planse','revizie_planse_auto'=ANY(string_to_array(coalesce(p_sursa,''),',')),
    'text',CASE v_st WHEN 'ok' THEN 'Text aprobat de om pe baza curentă. Cantitățile din text nu sunt validate automat.'
      WHEN 'identitate_limitata' THEN v_avertisment || CASE WHEN v_exceptie THEN ' Excepție înregistrată; reconfirmă textul pe baza curentă.' ELSE '' END
      WHEN 'ok_identitate_limitata' THEN v_avertisment || ' Excepție acceptată și text reconfirmat pe baza curentă.'
      WHEN 'schimbata' THEN 'baza s-a schimbat — de reverificat'
      WHEN 'luat_act' THEN 'baza s-a schimbat după transmitere — luat act; textul transmis rămâne neschimbat'
      WHEN 'indisponibila' THEN 'necesită review — baza ciornei vechi nu este demonstrabilă'
      ELSE 'necesită review — aprobă textul exact pe baza curentă' END);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('stare','indisponibila','text','nu putem verifica baza: ' || SQLERRM);
END $function$;

CREATE OR REPLACE FUNCTION public.ofertare_clarificare_reconfirma(p_id bigint,p_amprenta text,p_decizie text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_cur jsonb; v_decizie jsonb; v_sursa text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces la Ofertare'); END IF;
  IF coalesce(p_decizie,'') NOT IN ('revizuit','luat_act') THEN RETURN jsonb_build_object('error','alege revizuit sau, după transmitere, luat_act'); END IF;
  IF length(btrim(coalesce(p_nota,''))) < (CASE WHEN p_decizie='luat_act' THEN 10 ELSE 5 END) THEN RETURN jsonb_build_object('error','nota de review este prea scurtă'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  -- R9b (Copilot): reconfirmarea cere DREPT DE DECIZIE pe licitație (owner / responsabil / admin Ofertare), nu doar acces la modul.
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN RETURN jsonb_build_object('error','fără drept de decizie pe licitație'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','textul sau baza s-au schimbat — reîncarcă și verifică'); END IF;
  v_decizie := jsonb_build_object('token',p_amprenta,'text_hash',md5(coalesce(c.intrebare,'')),
    'amprenta',v_st->>'amprenta_baza','text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
  IF c.status IN ('trimisa','raspunsa') THEN
    IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
    UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie,
      'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
  ELSE
    IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
    v_cur := public.ofertare_f3_baza(c.licitatie_id);
    IF md5((v_cur->>'amprenta') || '|' || md5(coalesce(c.intrebare,''))) IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
    SELECT string_agg(t,',' ORDER BY o) INTO v_sursa FROM unnest(string_to_array(coalesce(c.sursa,''),',')) WITH ORDINALITY x(t,o) WHERE t <> 'revizie_planse_auto';
    UPDATE public.ofertare_clarificari SET sursa=v_sursa, updated_at=now(),
      baza_generare=v_cur||
        CASE WHEN c.baza_generare->'exceptie_identitate'->>'token'=p_amprenta
          THEN jsonb_build_object('exceptie_identitate',c.baza_generare->'exceptie_identitate') ELSE '{}'::jsonb END ||
        jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
END $function$;

CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') LIKE 'auto_planse_%' THEN
      v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;

-- Excepție temporară, per ciornă și per text+bază; aceeași cale DEFINER ca reconfirmarea.
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_exceptie_identitate(p_id bigint,p_amprenta text,p_motiv text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_decizie jsonb; v_documente jsonb; v_metadate jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','autentificare necesară'); END IF;
  IF length(btrim(coalesce(p_motiv,''))) < 10 THEN RETURN jsonb_build_object('error','motivul trebuie să aibă minimum 10 caractere'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN
    RETURN jsonb_build_object('error','fără drept de decizie pe licitație');
  END IF;
  IF c.status IS NULL OR c.status NOT IN ('propunere','de_trimis') THEN RETURN jsonb_build_object('error','excepția se acceptă doar pentru o ciornă netransmisă'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN
    RETURN jsonb_build_object('error','baza s-a schimbat — reîncarcă și verifică textul și documentele');
  END IF;
  IF coalesce(v_st->>'stare','') NOT IN ('identitate_limitata','ok_identitate_limitata') THEN
    RETURN jsonb_build_object('error','baza curentă nu cere excepție de identitate');
  END IF;
  SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint),
    jsonb_object_agg(x->>'id',jsonb_build_object('fisier_path',x->'fisier_path','marime',x->'marime'))
    INTO v_documente,v_metadate FROM jsonb_array_elements(v_st->'curent'->'documente') x WHERE x->>'identitate'='limitata';
  v_decizie := jsonb_build_object('token',p_amprenta,'de',auth.uid(),'la',now(),'motiv',btrim(p_motiv),
    'documente',v_documente,'metadate',v_metadate,'decizie','exceptie_identitate');
  UPDATE public.ofertare_clarificari SET updated_at=now(),
    baza_generare=coalesce(c.baza_generare,'{}'::jsonb)||jsonb_build_object('exceptie_identitate',v_decizie,
      'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
        CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii')
          THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
    WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'id',p_id);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_exceptie_identitate(bigint,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_exceptie_identitate(bigint,text,text) TO authenticated;

COMMIT;
