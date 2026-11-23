-- Costul salvărilor MARI cu garda liniilor 20261217a (review r3, P2) — DOAR pe CLONĂ, o singură tranzacție ANULATĂ la final (nimic rămas).
-- Rulare (din rădăcina repo-ului; parola din pgpass, niciodată în comandă):
--   psql -X -v ON_ERROR_STOP=1 -v sistem=<system_identifier al clonei> [-v varianta=curenta|r3|fara_garda] -h <host clonă> -p <port> \
--        -U postgres -d postgres -f scripts/raport_linii_proiect_cost.sql
-- Variante (fiecare rulare = una; comparația = ÎNAINTE de migrare, apoi DUPĂ, pe aceeași clonă):
--   curenta (implicit) = ce e pe clonă acum: înainte de 20261217a = fără gardă, după = garda r4 (o instrucțiune pe linie, fără așteptare);
--   r3         = DOAR cu migrarea aplicată: corpul gărzii din r3 (patru citiri pe linie, două cu lock) pus în locul celui r4, în tranzacția
--                anulată (amprenta corpului r3 verificată: 27c216e9…), ca să se vadă diferența r3 -> r4 pe aceeași bază;
--   fara_garda = DOAR cu migrarea aplicată: trigger-ul liniilor oprit în tranzacția anulată (= costul de dinainte, pe aceeași bază; ține un
--                lock SHARE ROW EXCLUSIVE pe raport_lucrari până la ROLLBACK — pe clonă, câteva secunde).
-- Ce măsoară: fn_raport_zilnic_salveaza (RPC-ul real, ca owner-ul, rolul authenticated, JWT în ambele surse) pe un raport NOU cu 50 / 200 / 500
--   de linii (activități SINTETICE ale proiectului șantierului, create în tranzacție), de 5 ori fiecare; fiecare salvare se anulează în
--   sub-tranzacția ei (raportul nu rămâne nici în tranzacție). Tipărește, pe fiecare mărime, min / median / max în ms (doar apelul RPC-ului).
-- Garda țintei: system_identifier al bazei = -v sistem, altfel refuz înainte de orice scriere. Nu rula pe producție (scrie, chiar dacă anulat).
\set ON_ERROR_STOP 1
\if :{?sistem}
\else
\echo 'REFUZ: lipseste -v sistem=<system_identifier al clonei>; nimic scris'
\set sistem lipsa
\endif
\if :{?varianta}
\else
\set varianta curenta
\endif
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout = '300s';
SELECT set_config('cost.sistem', :'sistem', true) IS NOT NULL AS sistem_setat, set_config('cost.varianta', :'varianta', true) AS varianta;
DO $c$
DECLARE own uuid; s1 bigint; p1 bigint; v_var text := current_setting('cost.varianta'); v_stare text; v_md5 text;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM current_setting('cost.sistem') THEN
    RAISE EXCEPTION 'REFUZ: system_identifier al bazei <> -v sistem (nu e clona ceruta); nimic scris';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'REFUZ: ruleaza ca postgres (clona)'; END IF;
  IF v_var NOT IN ('curenta', 'r3', 'fara_garda') THEN RAISE EXCEPTION 'REFUZ: varianta % (curenta | r3 | fara_garda)', v_var; END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_lucrari_proiect_garda()');
  v_stare := CASE WHEN v_md5 IS NULL THEN 'fara_migrare' WHEN v_md5 = '27c216e9e8952b8b63acc88acae6e802' THEN 'r3' ELSE 'migrare_md5_' || v_md5 END;
  IF v_var <> 'curenta' AND v_md5 IS NULL THEN RAISE EXCEPTION 'REFUZ: varianta % cere 20261217a aplicata pe clona', v_var; END IF;
  IF v_var = 'r3' THEN
    EXECUTE $r3$
CREATE OR REPLACE FUNCTION public.fn_raport_lucrari_proiect_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_site bigint; v_proiect bigint; v_p bigint;
BEGIN
  -- UPDATE care nu mută linia (alt raport / alt proiect): neverificat, fără lock (liniile istorice ale unui șantier mutat rămân editabile)
  IF TG_OP = 'UPDATE' AND NEW.raport_id IS NOT DISTINCT FROM OLD.raport_id AND NEW.proiect_id IS NOT DISTINCT FROM OLD.proiect_id THEN
    RETURN NEW;
  END IF;
  -- 1. rândul raportului: șantierul lui nu se mai schimbă până la COMMIT (în RPC: rândul e deja al nostru)
  SELECT r.site_id INTO v_site FROM public.rapoarte_zilnice r WHERE r.id = NEW.raport_id FOR SHARE OF r;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- raport inexistent: refuzul îl dă cheia străină (23503)
  -- 2. proiectul șantierului, sub lock: o mutare în zbor e așteptată (READ COMMITTED: se citește proiectul nou), una ulterioară așteaptă COMMIT-ul
  SELECT s.proiect_id INTO v_proiect FROM public.sites s WHERE s.id = v_site FOR SHARE OF s;
  IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN
    RAISE EXCEPTION 'raport: linia e pentru proiectul %, dar șantierul raportului e acum în alt proiect (%); reîncarcă raportul și salvează din nou',
      coalesce(NEW.proiect_id::text, '-'), coalesce(v_proiect::text, 'fără proiect') USING ERRCODE = '22023';
  END IF;
  -- 3. activitatea și obiectul liniei: ale aceluiași proiect (inexistente: refuzul îl dă cheia străină)
  IF NEW.activitate_id IS NOT NULL THEN
    SELECT pa.proiect_id INTO v_p FROM public.proiect_activitati pa WHERE pa.id = NEW.activitate_id;
    IF FOUND AND v_p IS DISTINCT FROM v_proiect THEN
      RAISE EXCEPTION 'raport: activitatea % nu e a proiectului șantierului raportului', NEW.activitate_id USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.unitate_id IS NOT NULL THEN
    SELECT pu.proiect_id INTO v_p FROM public.proiect_unitati pu WHERE pu.id = NEW.unitate_id;
    IF FOUND AND v_p IS DISTINCT FROM v_proiect THEN
      RAISE EXCEPTION 'raport: obiectul % nu e al proiectului șantierului raportului', NEW.unitate_id USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $f$
    $r3$;
    IF (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = 'public.fn_raport_lucrari_proiect_garda()'::regprocedure)
       IS DISTINCT FROM '27c216e9e8952b8b63acc88acae6e802' THEN
      RAISE EXCEPTION 'cost: corpul r3 pus nu are amprenta din r3';
    END IF;
    v_stare := v_stare || ' -> r3 (in tranzactia anulata)';
  ELSIF v_var = 'fara_garda' THEN
    ALTER TABLE public.raport_lucrari DISABLE TRIGGER trg_raport_lucrari_zz_proiect;
    v_stare := v_stare || ' -> garda oprita (in tranzactia anulata)';
  END IF;
  -- datele (doar în tranzacție): owner-ul, primul șantier cu proiect fără rezumate corectate, 500 de activități sintetice ale proiectului
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT s.id, s.proiect_id INTO s1, p1 FROM public.sites s WHERE s.proiect_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice r WHERE r.site_id = s.id AND r.rezumat_sursa = 'editat') ORDER BY s.id LIMIT 1;
  IF own IS NULL OR s1 IS NULL THEN RAISE EXCEPTION 'cost: lipsesc owner / santier cu proiect'; END IF;
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE site_id = s1 AND data = DATE '2001-03-01') THEN
    RAISE EXCEPTION 'cost: ziua de test 2001-03-01 e ocupata pe santierul % (nu sterg nimic)', s1;
  END IF;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ)
  SELECT p1, 'Activitate cost linii ' || g, 'm', 'cantitate', 900 + g, true FROM generate_series(1, 500) g;
  PERFORM set_config('cost.own', own::text, true), set_config('cost.s1', s1::text, true), set_config('cost.p1', p1::text, true),
          set_config('cost.stare', v_stare, true);
  RAISE NOTICE 'COST stare: % (santierul %, proiectul %)', v_stare, s1, p1;
END $c$;
DO $c$
DECLARE n integer; k integer; t0 timestamptz; ms numeric[]; v text; r jsonb; l jsonb;
  s1 bigint := current_setting('cost.s1')::bigint; own uuid := current_setting('cost.own')::uuid;
BEGIN
  FOREACH n IN ARRAY ARRAY[50, 200, 500] LOOP
    SELECT jsonb_agg(jsonb_build_object('activitate_id', a.id, 'unitate_id', NULL, 'cantitate', 1) ORDER BY a.id) INTO l
      FROM (SELECT pa.id FROM public.proiect_activitati pa WHERE pa.proiect_id = current_setting('cost.p1')::bigint
              AND pa.nume LIKE 'Activitate cost linii %' ORDER BY pa.id LIMIT n) a;
    IF jsonb_array_length(l) <> n THEN RAISE EXCEPTION 'cost: % activitati in loc de %', jsonb_array_length(l), n; END IF;
    ms := ARRAY[]::numeric[];
    FOR k IN 1 .. 5 LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', own, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', own::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        t0 := clock_timestamp();
        r := public.fn_raport_zilnic_salveaza(s1, DATE '2001-03-01', '{"probleme": "cost linii"}'::jsonb, l, NULL, 0, gen_random_uuid());
        v := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1)::text;
        IF r ->> 'ok' IS DISTINCT FROM 'true' THEN v := 'rezultat ' || r::text; END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0T98', MESSAGE = v;   -- anulează salvarea (și rolul / JWT-ul) în sub-tranzacția ei
      EXCEPTION WHEN SQLSTATE 'P0T98' THEN
        v := SQLERRM;
      END;
      IF v !~ '^[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION 'cost: salvarea cu % linii nu a trecut: %', n, v; END IF;
      ms := ms || v::numeric;
    END LOOP;
    SELECT array_agg(x ORDER BY x) INTO ms FROM unnest(ms) x;
    RAISE NOTICE 'COST % linii: min % ms, median % ms, max % ms (5 salvari; %)', n, ms[1], ms[3], ms[5], current_setting('cost.stare');
  END LOOP;
END $c$;
ROLLBACK;
