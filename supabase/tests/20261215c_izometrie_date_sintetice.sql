-- Date SINTETICE pentru proba 20261215c (TKT-2026-0388) — doar pe CLONĂ, niciodată pe producție. Se include cu \ir, în tranzacția apelantului:
--   * supabase/tests/20261215c_izometrie_muta_pozitie.sql (mod sintetic: tranzacția se termină cu ROLLBACK, nimic nu rămâne);
--   * scripts/izometrie_muta_pozitie_concurenta.sh (proba cu două sesiuni: datele se COMIT pe clonă și se șterg la final).
-- Creează: 1 proiect, 1 pachet, 5 țevi (poz_in_pachet 1..5, lungimi diferite dacă tabelul are o coloană „lungime…”), și setează în
--   tranzacție t.proiect / t.pachet / t.tevi (id-urile, în ordinea pozițiilor). Dacă t.editor e setat (cont NON-owner), îi dă, DOAR în
--   tranzacția curentă, modulul executie = 'editor' (fără el contul nu poate scrie; pe clonă, tranzacție anulată sau curățată).
-- Tabelele reale ale izometriei au fost create direct în BD (structura lor nu e în repo): coloanele NOT NULL fără valoare implicită se
--   completează cu valori de test după tip. Un FK NOT NULL necunoscut, un CHECK care respinge valoarea de test sau un tip fără valoare
--   de test = eroare clară, cu numele coloanei (se completează aici, în p_valori).
CREATE FUNCTION pg_temp.t15c_rand(p_tabel regclass, p_valori jsonb, p_eticheta text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE r record; v_cols text[] := '{}'; v_vals text[] := '{}'; v_id bigint; v_k text; v_tip text;
BEGIN
  FOR v_k IN SELECT jsonb_object_keys(p_valori) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tip FROM pg_attribute a WHERE a.attrelid = p_tabel AND a.attname = v_k AND NOT a.attisdropped;
    IF v_tip IS NULL THEN RAISE EXCEPTION 'date sintetice: %.% nu exista', p_tabel, v_k; END IF;
    v_cols := v_cols || quote_ident(v_k);
    v_vals := v_vals || format('%L::%s', p_valori ->> v_k, v_tip);
  END LOOP;
  FOR r IN SELECT a.attname, a.atttypid, a.atttypmod, format_type(a.atttypid, a.atttypmod) AS tip, t.typtype, t.typcategory
             FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
            WHERE a.attrelid = p_tabel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef
              AND a.attidentity = '' AND a.attgenerated = '' AND NOT (p_valori ? a.attname::text)
            ORDER BY a.attnum LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint c, pg_attribute a2 WHERE c.conrelid = p_tabel AND c.contype = 'f'
                AND a2.attrelid = p_tabel AND a2.attname = r.attname AND a2.attnum = ANY (c.conkey)) THEN
      RAISE EXCEPTION 'date sintetice: %.% e NOT NULL, cu FK si fara valoare implicita: completeaza-l in supabase/tests/20261215c_izometrie_date_sintetice.sql', p_tabel, r.attname;
    END IF;
    v_cols := v_cols || quote_ident(r.attname);
    v_vals := v_vals || CASE
      WHEN r.typtype = 'e' THEN format('%L::%s', (SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = r.atttypid ORDER BY e.enumsortorder LIMIT 1), r.tip)
      WHEN r.typcategory = 'S' THEN format('%L::%s', left(p_eticheta || '-' || r.attname, CASE WHEN r.atttypmod > 4 THEN r.atttypmod - 4 ELSE 60 END), r.tip)
      WHEN r.typcategory = 'N' THEN format('1::%s', r.tip)
      WHEN r.typcategory = 'B' THEN 'false'
      WHEN r.typcategory = 'D' THEN format('now()::%s', r.tip)
      WHEN r.tip = 'uuid' THEN 'gen_random_uuid()'
      WHEN r.tip IN ('json', 'jsonb') THEN format('%L::%s', '{}', r.tip)
      WHEN r.typcategory = 'A' THEN format('%L::%s', '{}', r.tip)
      END;
    IF v_vals[cardinality(v_vals)] IS NULL THEN
      RAISE EXCEPTION 'date sintetice: %.% (tip %) nu are o valoare de test: completeaza-l in p_valori', p_tabel, r.attname, r.tip;
    END IF;
  END LOOP;
  EXECUTE format('INSERT INTO %s (%s) VALUES (%s) RETURNING id', p_tabel, array_to_string(v_cols, ', '), array_to_string(v_vals, ', ')) INTO v_id;
  RETURN v_id;
END $f$;

DO $sintetic$
DECLARE
  v_et text := 'T15C-' || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
  v_proiect bigint; v_tronson bigint; v_pachet bigint; v_teava bigint; v_tevi bigint[] := '{}'; k integer; v_extra jsonb;
  v_editor uuid := nullif(current_setting('t.editor', true), '')::uuid;
BEGIN
  -- câmpurile de identificare, dacă există (ca un om să recunoască rândurile de test pe clonă)
  SELECT coalesce(jsonb_object_agg(a.attname, v_et), '{}') INTO v_extra FROM pg_attribute a
   WHERE a.attrelid = 'public.executie_proiecte'::regclass AND a.attname IN ('cod_intern', 'nume') AND NOT a.attisdropped;
  v_proiect := pg_temp.t15c_rand('public.executie_proiecte', v_extra, v_et || '-P');
  -- tronsonul de test (pachetul îl cere: tronson_id NOT NULL cu FK pe executie_tronsoane)
  v_tronson := pg_temp.t15c_rand('public.executie_tronsoane', jsonb_build_object('proiect_id', v_proiect, 'status', 'neinceput'), v_et || '-R');
  v_pachet := pg_temp.t15c_rand('public.executie_pachete_lansare', jsonb_build_object('proiect_id', v_proiect, 'tronson_id', v_tronson, 'status', 'draft', 'tip_pachet', 'lansare_conducta'), v_et || '-K');
  FOR k IN 1 .. 5 LOOP
    -- lungimi diferite pe fiecare țeavă (dacă tabelul are o coloană numerică „lungime…”), ca POZ KM să iasă diferit pe fiecare rând
    SELECT coalesce(jsonb_object_agg(a.attname, 10 * k + 0.5), '{}') INTO v_extra FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.executie_tevi'::regclass AND a.attname LIKE 'lungime%' AND NOT a.attisdropped AND t.typcategory = 'N';
    v_teava := pg_temp.t15c_rand('public.executie_tevi', jsonb_build_object('pachet_id', v_pachet, 'poz_in_pachet', k, 'tip_rand', 'teava') || v_extra, v_et || '-T' || k);
    v_tevi := v_tevi || v_teava;
  END LOOP;
  -- editorul (NON-owner): modulul executie 'editor', doar în tranzacția curentă
  IF v_editor IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_editor) THEN
      RAISE EXCEPTION 'date sintetice: editorul % nu are profil pe clona', v_editor;
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_editor AND p.is_owner IS TRUE) THEN
      RAISE EXCEPTION 'date sintetice: editorul % e owner; proba cere un cont NON-owner (-v editor=<uuid>)', v_editor;
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = v_editor AND u.module = 'executie') THEN
      UPDATE public.user_module_access SET access_level = 'editor' WHERE profile_id = v_editor AND module = 'executie';
    ELSE
      PERFORM pg_temp.t15c_rand('public.user_module_access', jsonb_build_object('profile_id', v_editor, 'module', 'executie', 'access_level', 'editor'), v_et || '-U');
    END IF;
  END IF;
  PERFORM set_config('t.proiect', v_proiect::text, true), set_config('t.pachet', v_pachet::text, true),
          set_config('t.tevi', array_to_string(v_tevi, ','), true);
  RAISE NOTICE 'date sintetice %: proiect %, pachet %, tevi %', v_et, v_proiect, v_pachet, v_tevi;
END $sintetic$;
