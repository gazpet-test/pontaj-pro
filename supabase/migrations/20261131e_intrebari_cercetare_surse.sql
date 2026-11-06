-- ════════════════════════════════════════════════════════════════════════════
-- 20261131e — „❓ Întreabă echipa”: răspunsuri DIN CERCETARE, cu surse (cerere Silviu + Răzvan 06.11.2026).
-- Workerul (worker/intrebari-tehnice/) caută întâi în corpusul intern (docs/cercetare) și pe web DOAR pe domeniile oficiale
-- (listă fixă în cod), apoi răspunde doar din surse; sursele citate se salvează aici, în `surse`, și se afișează sub răspuns.
-- Se adaugă și starea 'de_verificat' (butonul „Răspuns neclar — trimite la verificare”, fără alte efecte) și reluarea la cerere
-- (DOAR ownerul — reluarea costă, „poarta pe cheltuială”; nimic nu se reia automat).
--
-- FIȘA DE SECURITATE (CLAUDE.md pct. 7) — diferențele față de 20261105a:
--  (a) conținut EXTERN nou: paginile web de pe domeniile oficiale (citite server-side de unealta web search a API-ului) → DATE;
--  (b) scrie în plus: `surse` (listă de {id, tip, cale|url, titlu, extras}) pe rândul întrebării; starea 'de_verificat';
--      reluarea readuce întrebarea în coadă. Fără mail, bani, drepturi, alte tabele; fără notificări noi;
--  (c) identitate: fn_intrebari_raspunde rămâne doar service_role (edge); fn_intrebari_de_verificat / fn_intrebari_reia sunt
--      SECURITY DEFINER pentru authenticated (n-au UPDATE pe tabel), cu verificarea autorului / ownerului în funcție;
--  (d) cine pornește: marcarea — autorul (sau ownerul), doar din 'raspuns'; reluarea — doar ownerul, din 'raspuns' / 'de_verificat' /
--      'eroare'; plafonul global de 40 de preluări pe zi din fn_intrebari_preia rămâne;
--  (e) confirmare umană: reluarea (care costă) e un clic al ownerului; răspunsul rămâne informativ.
-- ORDINEA LA DEPLOY: migrarea → edge intrebari-tehnice-worker v2 (trimite p_surse) → workerul nou pe server.
--   Edge-ul vechi merge și după migrare (p_surse are DEFAULT NULL); edge-ul nou NU merge înainte de migrare.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. NEAPLICATĂ la commit — o aplică chat-ul.
-- REVENIRE (manual, după „da”): vezi blocul de la final.
-- ════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131e_intrebari_cercetare_surse:' || txid_current() THEN
    RAISE EXCEPTION '20261131e: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.intrebari_tehnice') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.fn_are_acces_intrebari()') IS NULL
     OR to_regprocedure('public.fn_intrebari_inainte_insert()') IS NULL THEN
    RAISE EXCEPTION '20261131e: lipsește 20261105a (intrebari_tehnice / fn_intrebari_raspunde / fn_are_acces_intrebari)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intrebari_tehnice' AND column_name IN ('surse', 'de_verificat_la'))
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_de_verificat(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_reia(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261131e: rulata deja (surse / funcțiile noi există)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_tehnice_stare_check') THEN
    RAISE EXCEPTION '20261131e: lipsește constrângerea intrebari_tehnice_stare_check';
  END IF;
END $pre$;

-- ─── coloane + stări ───────────────────────────────────────────────────────
ALTER TABLE public.intrebari_tehnice
  ADD COLUMN surse jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN de_verificat_la timestamptz,
  ADD CONSTRAINT intrebari_surse_lista CHECK (jsonb_typeof(surse) = 'array' AND jsonb_array_length(surse) <= 30 AND octet_length(surse::text) <= 100000);
ALTER TABLE public.intrebari_tehnice DROP CONSTRAINT intrebari_tehnice_stare_check;
ALTER TABLE public.intrebari_tehnice ADD CONSTRAINT intrebari_tehnice_stare_check
  CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare', 'de_verificat'));
COMMENT ON COLUMN public.intrebari_tehnice.surse IS '20261131e: sursele citate în răspuns — [{id C1|W1, tip corpus|web, cale|url, titlu, extras}]; web doar pe domeniile oficiale.';
COMMENT ON COLUMN public.intrebari_tehnice.de_verificat_la IS '20261131e: când autorul a marcat răspunsul ca neclar (stare de_verificat).';

-- Inserarea: aceleași reguli ca în 20261105a + câmpurile noi forțate (utilizatorul nu-și poate scrie singur surse / stare).
CREATE OR REPLACE FUNCTION public.fn_intrebari_inainte_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean; v_azi integer; v_limita integer; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  NEW.autor := auth.uid();
  NEW.stare := 'noua'; NEW.raspuns_md := NULL; NEW.model := NULL; NEW.tokeni := NULL; NEW.eroare := NULL;
  NEW.incercari := 0; NEW.incercare_id := NULL; NEW.creat_la := now(); NEW.preluat_la := NULL; NEW.raspuns_la := NULL;
  NEW.surse := '[]'::jsonb; NEW.de_verificat_la := NULL;
  NEW.titlu := btrim(NEW.titlu); NEW.intrebare := btrim(NEW.intrebare); NEW.context := nullif(btrim(coalesce(NEW.context, '')), '');
  SELECT coalesce(is_owner, false) INTO v_owner FROM public.profiles WHERE id = NEW.autor;
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:' || NEW.autor::text));
  SELECT count(*) INTO v_azi FROM public.intrebari_tehnice
   WHERE autor = NEW.autor AND creat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest');
  v_limita := CASE WHEN v_owner THEN 20 ELSE 5 END;   -- variabilă: IF … CASE … THEN … END THEN se rupe la primul THEN în PL/pgSQL
  IF v_azi >= v_limita THEN
    RAISE EXCEPTION 'Limita zilnică atinsă (% întrebări pe zi). Mâine poți pune din nou.', v_limita;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(NEW.atasamente) LOOP
    IF jsonb_typeof(a) <> 'object'
       OR NOT (a->>'path') ~ ('^' || NEW.autor::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$')
       OR coalesce(a->>'mime', '') NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR char_length(coalesce(a->>'nume', '')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Atașament invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'intrebari-tehnice' AND o.name = a->>'path') THEN
      RAISE EXCEPTION 'Atașamentul nu a fost încărcat: %', a->>'nume';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_inainte_insert() FROM PUBLIC, anon, authenticated;

-- ─── worker: răspunsul vine cu sursele (p_surse DEFAULT NULL → edge-ul vechi merge în continuare) ───
DROP FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text);
CREATE FUNCTION public.fn_intrebari_raspunde(p_id bigint, p_incercare uuid, p_raspuns text, p_model text, p_tokeni jsonb, p_eroare text,
                                             p_surse jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_autor uuid; v_titlu text;
BEGIN
  IF (p_raspuns IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'exact unul dintre raspuns / eroare'; END IF;
  IF p_surse IS NOT NULL AND jsonb_typeof(p_surse) <> 'array' THEN RAISE EXCEPTION 'surse: se așteaptă o listă'; END IF;
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN p_raspuns IS NULL THEN 'eroare' ELSE 'raspuns' END,
         raspuns_md = p_raspuns, model = left(p_model, 80), tokeni = p_tokeni, eroare = left(p_eroare, 500), raspuns_la = now(), incercare_id = NULL,
         surse = CASE WHEN p_raspuns IS NULL THEN '[]'::jsonb ELSE coalesce(p_surse, '[]'::jsonb) END
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING autor, titlu INTO v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  VALUES (v_autor, 'info', 'general',
          CASE WHEN p_raspuns IS NULL THEN '❓ Întrebarea nu a primit răspuns' ELSE '❓ Ai primit răspuns la întrebare' END,
          left(v_titlu, 200), '/intrebari?id=' || p_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb) TO service_role;

-- ─── UI: „Răspuns neclar — trimite la verificare” (autorul sau ownerul; doar marchează, fără alte efecte) ───
CREATE FUNCTION public.fn_intrebari_de_verificat(p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  UPDATE public.intrebari_tehnice SET stare = 'de_verificat', de_verificat_la = now()
   WHERE id = p_id AND stare = 'raspuns'
     AND (autor = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner));
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_de_verificat(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_de_verificat(bigint) TO authenticated;

-- ─── UI: reluarea cu cercetare (DOAR ownerul — costă; nimic nu se reia automat) ───
CREATE FUNCTION public.fn_intrebari_reia(p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN
    RAISE EXCEPTION 'Doar ownerul poate relua o întrebare';
  END IF;
  UPDATE public.intrebari_tehnice
     SET stare = 'noua', raspuns_md = NULL, surse = '[]'::jsonb, model = NULL, tokeni = NULL, eroare = NULL, incercari = 0,
         incercare_id = NULL, preluat_la = NULL, raspuns_la = NULL, de_verificat_la = NULL
   WHERE id = p_id AND stare IN ('raspuns', 'de_verificat', 'eroare');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_reia(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_reia(bigint) TO authenticated;

DO $final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131e_intrebari_cercetare_surse:' || txid_current() THEN
    RAISE EXCEPTION '20261131e: garda final invalida';
  END IF;
  IF to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NOT NULL
     OR has_function_privilege('authenticated', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_de_verificat(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_reia(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_intrebari_de_verificat(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_intrebari_reia(bigint)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'DELETE')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_tehnice_stare_check'
                      AND pg_get_constraintdef(oid) LIKE '%de_verificat%')
     OR EXISTS (SELECT 1 FROM public.intrebari_tehnice WHERE surse IS DISTINCT FROM '[]'::jsonb) THEN
    RAISE EXCEPTION '20261131e: verificarea finală a eșuat';
  END IF;
END $final$;

-- ─── REVENIRE (NU rulează aici; manual, prin livrare_migrare.sh, după „da”) ───
-- UPDATE public.intrebari_tehnice SET stare = 'raspuns' WHERE stare = 'de_verificat';
-- DROP FUNCTION public.fn_intrebari_reia(bigint); DROP FUNCTION public.fn_intrebari_de_verificat(bigint);
-- DROP FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb);
--   + CREATE FUNCTION fn_intrebari_raspunde(…6 parametri) din 20261105a, cu REVOKE / GRANT service_role (și edge-ul v1 la loc);
-- ALTER TABLE public.intrebari_tehnice DROP CONSTRAINT intrebari_tehnice_stare_check,
--   ADD CONSTRAINT intrebari_tehnice_stare_check CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare'));
-- ALTER TABLE public.intrebari_tehnice DROP CONSTRAINT intrebari_surse_lista, DROP COLUMN surse, DROP COLUMN de_verificat_la;
--   + fn_intrebari_inainte_insert din 20261105a (fără liniile surse / de_verificat_la).
