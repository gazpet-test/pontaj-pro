-- ============================================================================
-- Monitor egress — follow-up la 20260930e_monitor_egress.sql (APLICATĂ live 01.10.2026, versiunea 20261001175000;
-- fișierul ei NU se mai modifică). Repară cele două NO-GO-uri Copilot pentru activarea workerului/edge-ului:
--   1. egress_detector(): fiecare apel egress_notifica_owner(...) e izolat într-un bloc BEGIN … EXCEPTION WHEN OTHERS
--      THEN RAISE WARNING … END. Blocarea (storage_obiecte_blocate) și alerta (storage_egress_alerte) rămân comise chiar
--      dacă notificarea eșuează (CHECK nou pe notifications, trigger, RLS etc.). Înainte: o notificare eșuată anula tot
--      jobul cron ⇒ niciun obiect blocat ⇒ fail-open. Rezultatul jobului raportează și 'notificari_esuate'.
--   2. Cheia obiectului e canonicalizată de UN SINGUR helper, public.egress_cheie_obiect(text), folosit de logger
--      (egress_log_descarcare), de poartă (egress_obiect_blocat) și de deblocare (egress_deblocheaza). Înainte: loggerul
--      scria left(p_obiect,1024), poarta compara b.obiect = p_obiect ⇒ o cheie > 1024 caractere era blocată sub forma
--      trunchiată, dar poarta, întrebată cu cheia întreagă, răspundea „neblocat” (ocolire).
--      Forma canonică: cheia neschimbată dacă are ≤ 1024 caractere; altfel left(cheie,991) || '#' || md5(cheie)
--      (exact 1024 caractere). Două chei lungi cu același prefix NU se confundă (md5 pe cheia întreagă).
--      Helperul e IMMUTABLE, SECURITY INVOKER, fără acces la tabele; EXECUTE doar service_role (și postgres, proprietar).
--   Detectorul nu se schimbă la cheie: grupează pe ce a scris loggerul (deja canonic). egress_statistici: neschimbată
--   (join jurnal ↔ blocate pe chei deja canonice).
--
-- Notă: comentariul din 20260930e „Fără edge/worker cablat, poarta și jurnalul stau inerte” e depășit — workerul NAS
--   (worker/ofertare/egress.ts) e cablat în PR #543; edge-ul rămâne amânat. Fișierul aplicat nu se atinge (sha-ul lui e
--   înregistrat în schema_migrations); nota stă aici și în docs/AUDIT_OFERTARE_V2/543b_DELTA_COPILOT.md.
--
-- ⚠ NEAPLICATĂ. Se livrează DOAR prin scripts/livrare_migrare.sh, după GO Copilot + acordul lui Răzvan.
--   Fișierul NU conține BEGIN/COMMIT (o singură tranzacție = runnerul). Garda de livrare la start și la final.
-- Precondiții fail-closed: amprentele md5(prosrc) live citite read-only pe dxczwkbciseqniprspcu (01.10.2026) pentru cele
--   4 funcții înlocuite (sau varianta din acest patch, la reaplicare) + celelalte 4 funcții egress_* neschimbate.
-- Postcondiții: amprente exacte, atribute (SECURITY DEFINER + search_path), ACL-uri, 9 funcții egress_*, joburile cron.
-- Gate 0e (scripts/control_0e.sql) trebuie să rămână 0 rânduri (helperul nu e expus lui anon/authenticated; corpurile
--   nu conțin set_config/execute).
-- Revenire: supabase/revenire/20261002a_monitor_egress_fix_ROLLBACK.sql (rollback TEHNIC, fără GO de execuție).
-- Migrarea nu modifică date (jurnalul e gol pe live; o cheie istorică > 1024, dacă ar exista, ar rămâne în forma veche).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002a_monitor_egress_fix:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── 0. Precondiții fail-closed ──────────────────────────────────────────────────────────
DO $pre$
DECLARE v_n integer; v_md5 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- 0b. funcțiile înlocuite: varianta live 20260930e SAU cea din acest patch (reaplicare); altceva ⇒ reanalizare
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('2db8766e07f60c779aa4fd0dd6c06ef4', '2cc00f0d41b9900c568fc82d9f5aec22') THEN
    RAISE EXCEPTION 'Precondiție 0b: egress_detector() nu e varianta live (2db8766e…) nici cea din patch (md5 %)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.egress_log_descarcare(text,text,bigint,text,bigint)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('b376e5f08c48a3dbf48d0a0a1d9d1a45', 'ef4c8c01d648a4c6f029807c97a03a4b') THEN
    RAISE EXCEPTION 'Precondiție 0b: egress_log_descarcare nu e varianta live (b376e5f0…) nici cea din patch (md5 %)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.egress_obiect_blocat(text,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('db91e3dc3d3eee63f82324bda3f9fd5b', '73cd68ed6bf1a07759c11ff2f73f9afb') THEN
    RAISE EXCEPTION 'Precondiție 0b: egress_obiect_blocat nu e varianta live (db91e3dc…) nici cea din patch (md5 %)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.egress_deblocheaza(text,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('8e59b353863755dab7654d898c1806f1', 'de5e29c4173761637b85021422fee119') THEN
    RAISE EXCEPTION 'Precondiție 0b: egress_deblocheaza nu e varianta live (8e59b353…) nici cea din patch (md5 %)', v_md5;
  END IF;
  -- 0c. funcțiile neschimbate de patch = exact cele live
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_notifica_owner(text,text)')) IS DISTINCT FROM 'e4165baf10b67bc65ed0865d3f434778'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_este_owner()')) IS DISTINCT FROM '25c9b49412f80567bdb0b2baec4cd2f3'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_ciclu_start(timestamp with time zone)')) IS DISTINCT FROM '2cc40273fe610ac844c17bb4508d6959'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_statistici(integer)')) IS DISTINCT FROM 'dd67c392797115482c54387408d7bcf6' THEN
    RAISE EXCEPTION 'Precondiție 0c: egress_notifica_owner/este_owner/ciclu_start/statistici ≠ amprentele live din 01.10';
  END IF;
  -- 0d. helperul: absent, sau exact cel din patch; fără supraîncărcări; total egress_* = 8 (live) sau 9 (reaplicare)
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.egress_cheie_obiect(text)');
  IF v_md5 IS NOT NULL AND v_md5 IS DISTINCT FROM '80cb4557c7020f51672f3dc7b62c8a91' THEN
    RAISE EXCEPTION 'Precondiție 0d: egress_cheie_obiect(text) există cu altă definiție (md5 %)', v_md5;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM (CASE WHEN v_md5 IS NULL THEN 8 ELSE 9 END) THEN
    RAISE EXCEPTION 'Precondiție 0d: % funcții egress_* (așteptat 8 live / 9 la reaplicare) — supraîncărcare sau rest neanalizat', v_n;
  END IF;
  -- 0e. tabelele monitorului există (cu cheia (bucket, obiect) pe storage_obiecte_blocate)
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND c.relname IN ('storage_egress_config','storage_descarcari_jurnal','storage_obiecte_blocate','storage_egress_alerte');
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'Precondiție 0e: % din 4 tabele storage_egress_* cu RLS', v_n; END IF;
END $pre$;

-- ── 1. Helper unic de canonicalizare a cheii obiectului ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_cheie_obiect(p_obiect text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN length(p_obiect) <= 1024 THEN p_obiect
              ELSE left(p_obiect, 991) || '#' || md5(p_obiect) END
$f$;
REVOKE EXECUTE ON FUNCTION public.egress_cheie_obiect(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_cheie_obiect(text) TO service_role;

-- ── 2. Poarta: compară pe cheia canonică ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_obiect_blocat(p_bucket text, p_obiect text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM storage_obiecte_blocate b
                  WHERE b.bucket = p_bucket AND b.obiect = egress_cheie_obiect(p_obiect) AND b.blocat)
     AND (SELECT blocare_activa FROM storage_egress_config WHERE id = 1)
$f$;
REVOKE EXECUTE ON FUNCTION public.egress_obiect_blocat(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_obiect_blocat(text, text) TO service_role;

-- ── 3. Loggerul: scrie cheia canonică (același helper) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_log_descarcare(p_bucket text, p_obiect text, p_bytes bigint, p_sursa text, p_doc_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint;
BEGIN
  IF coalesce(p_bucket, '') = '' OR coalesce(p_obiect, '') = '' OR coalesce(p_sursa, '') = '' THEN
    RAISE EXCEPTION 'bucket, obiect și sursa sunt obligatorii';
  END IF;
  INSERT INTO storage_descarcari_jurnal (bucket, obiect, doc_id, bytes, sursa)
  VALUES (p_bucket, egress_cheie_obiect(p_obiect), p_doc_id, greatest(coalesce(p_bytes, 0), 0), left(p_sursa, 100))
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_log_descarcare(text, text, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_log_descarcare(text, text, bigint, text, bigint) TO service_role;

-- ── 4. Deblocarea (owner): aceeași cheie canonică ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_deblocheaza(p_bucket text, p_obiect text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT egress_este_owner() THEN
    RAISE EXCEPTION 'Doar owner-ul poate debloca descărcările' USING ERRCODE = '42501';
  END IF;
  UPDATE storage_obiecte_blocate SET blocat = false, deblocat_la = now(), deblocat_de = auth.uid()
  WHERE bucket = p_bucket AND obiect = egress_cheie_obiect(p_obiect) AND blocat;
  RETURN FOUND;
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_deblocheaza(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_deblocheaza(text, text) TO authenticated;

-- ── 5. Detectorul: notificarea izolată (blocarea + alerta rămân comise) ─────────────────
CREATE OR REPLACE FUNCTION public.egress_detector()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c storage_egress_config; r record; n_blocate int := 0; n_alerte int := 0; n_notif_esuate int := 0;
  v_zi bigint; v_ciclu bigint; v_start timestamptz; v_pct int; v_cheie text;
BEGIN
  SELECT * INTO c FROM storage_egress_config WHERE id = 1;

  -- 1) același obiect > prag descărcări în ultima oră → blocare + notificare (o dată per blocare)
  FOR r IN
    SELECT bucket, obiect, count(*) AS n, sum(bytes) AS b FROM storage_descarcari_jurnal
    WHERE created_at > now() - interval '1 hour' GROUP BY bucket, obiect HAVING count(*) > c.prag_obiect_ora
  LOOP
    IF c.blocare_activa THEN
      INSERT INTO storage_obiecte_blocate AS o (bucket, obiect, blocat, motiv, descarcari_ora, blocat_la)
      VALUES (r.bucket, r.obiect, true, format('%s descărcări în ultima oră (prag %s)', r.n, c.prag_obiect_ora), r.n, now())
      ON CONFLICT (bucket, obiect) DO UPDATE SET blocat = true, motiv = EXCLUDED.motiv, descarcari_ora = EXCLUDED.descarcari_ora,
        blocat_la = now(), deblocat_la = NULL, deblocat_de = NULL
        -- deblocat manual în ultima oră → owner-ul a decis; nu se reblochează pe aceleași descărcări vechi
        WHERE o.blocat OR o.deblocat_la IS NULL OR o.deblocat_la < now() - interval '1 hour';
      IF NOT FOUND THEN CONTINUE; END IF;
      n_blocate := n_blocate + 1;
    END IF;
    v_cheie := r.bucket || '/' || r.obiect || '@' || to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24');
    INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES ('obiect_repetat', v_cheie,
      jsonb_build_object('bucket', r.bucket, 'obiect', r.obiect, 'n', r.n, 'bytes', r.b)) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      n_alerte := n_alerte + 1;
      BEGIN  -- notificarea nu are voie să anuleze blocarea/alerta (subtranzacție)
        PERFORM egress_notifica_owner('⚠️ Egress: descărcări repetate' || CASE WHEN c.blocare_activa THEN ' — obiect BLOCAT' ELSE '' END,
          format('%s/%s descărcat de %s ori în ultima oră (%s MB). %s', r.bucket, r.obiect, r.n, round(r.b / 1048576.0),
            CASE WHEN c.blocare_activa THEN 'Descărcările automate sunt oprite până la deblocare din widget-ul Monitor egress.' ELSE '' END));
      EXCEPTION WHEN OTHERS THEN
        n_notif_esuate := n_notif_esuate + 1;
        RAISE WARNING 'egress_detector: notificarea pentru %/% a eșuat (%: %) — blocarea și alerta rămân', r.bucket, r.obiect, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  -- 2) total zilnic (UTC) peste prag
  SELECT coalesce(sum(bytes), 0) INTO v_zi FROM storage_descarcari_jurnal WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF v_zi > c.prag_zilnic_bytes THEN
    INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES ('prag_zilnic', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('bytes', v_zi, 'prag', c.prag_zilnic_bytes)) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      n_alerte := n_alerte + 1;
      BEGIN
        PERFORM egress_notifica_owner('⚠️ Egress: prag zilnic depășit',
          format('Azi (UTC) s-au descărcat %s GB din Storage (prag %s GB).', round(v_zi / 1073741824.0, 1), round(c.prag_zilnic_bytes / 1073741824.0, 1)));
      EXCEPTION WHEN OTHERS THEN
        n_notif_esuate := n_notif_esuate + 1;
        RAISE WARNING 'egress_detector: notificarea pragului zilnic a eșuat (%: %) — alerta rămâne', SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;

  -- 3) cota ciclului (50% / 80% din 250 GB), din jurnalul propriu
  v_start := egress_ciclu_start(now());
  SELECT coalesce(sum(bytes), 0) INTO v_ciclu FROM storage_descarcari_jurnal WHERE created_at >= v_start;
  FOREACH v_pct IN ARRAY c.alerte_procent LOOP
    IF v_ciclu >= c.cota_ciclu_bytes * v_pct / 100 THEN
      INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES ('cota_ciclu', to_char(v_start, 'YYYY-MM-DD') || ':' || v_pct,
        jsonb_build_object('bytes', v_ciclu, 'cota', c.cota_ciclu_bytes, 'procent', v_pct)) ON CONFLICT DO NOTHING;
      IF FOUND THEN
        n_alerte := n_alerte + 1;
        BEGIN
          PERFORM egress_notifica_owner(format('⚠️ Egress: %s%% din cota ciclului', v_pct),
            format('Din %s s-au descărcat %s GB (jurnal propriu) din %s GB.', to_char(v_start, 'DD.MM'), round(v_ciclu / 1073741824.0, 1), round(c.cota_ciclu_bytes / 1073741824.0)));
        EXCEPTION WHEN OTHERS THEN
          n_notif_esuate := n_notif_esuate + 1;
          RAISE WARNING 'egress_detector: notificarea cotei % %% a eșuat (%: %) — alerta rămâne', v_pct, SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('blocate', n_blocate, 'alerte', n_alerte, 'notificari_esuate', n_notif_esuate,
                            'bytes_azi', v_zi, 'bytes_ciclu', v_ciclu);
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_detector() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_detector() TO service_role;

-- ── Postcondiții (orice abatere ⇒ runnerul anulează tot) ────────────────────────────────
DO $post$
DECLARE v_n integer;
BEGIN
  -- p1. amprentele exacte ale funcțiilor din patch
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_cheie_obiect(text)')) IS DISTINCT FROM '80cb4557c7020f51672f3dc7b62c8a91'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_obiect_blocat(text,text)')) IS DISTINCT FROM '73cd68ed6bf1a07759c11ff2f73f9afb'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_log_descarcare(text,text,bigint,text,bigint)')) IS DISTINCT FROM 'ef4c8c01d648a4c6f029807c97a03a4b'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_deblocheaza(text,text)')) IS DISTINCT FROM 'de5e29c4173761637b85021422fee119'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '2cc00f0d41b9900c568fc82d9f5aec22' THEN
    RAISE EXCEPTION 'Postcondiție p1: amprentele funcțiilor din patch nu corespund';
  END IF;
  -- p2. 9 funcții egress_*; helperul INVOKER + IMMUTABLE; restul SECURITY DEFINER cu search_path fixat (ca în 20260930e)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'Postcondiție p2: % funcții egress_* (așteptat 9)', v_n; END IF;
  IF (SELECT p.prosecdef OR p.provolatile <> 'i' OR NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false)
        FROM pg_proc p WHERE p.oid = to_regprocedure('public.egress_cheie_obiect(text)')) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Postcondiție p2: egress_cheie_obiect trebuie INVOKER, IMMUTABLE, cu search_path fixat';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.egress_obiect_blocat(text,text)'), to_regprocedure('public.egress_log_descarcare(text,text,bigint,text,bigint)'),
                   to_regprocedure('public.egress_deblocheaza(text,text)'), to_regprocedure('public.egress_detector()'))
     AND p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false);
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'Postcondiție p2: % din 4 funcții SECURITY DEFINER cu search_path fixat', v_n; END IF;
  -- p3. ACL: nimic pentru anon; interne neexecutabile de authenticated; service_role are poarta + jurnalul + helperul
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR (p.proname IN ('egress_cheie_obiect','egress_notifica_owner','egress_obiect_blocat','egress_log_descarcare','egress_detector')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Postcondiție p3: % funcții egress_* executabile de anon (sau de authenticated, pe cele interne)', v_n; END IF;
  IF NOT has_function_privilege('service_role', 'public.egress_log_descarcare(text,text,bigint,text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.egress_obiect_blocat(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.egress_cheie_obiect(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.egress_deblocheaza(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție p3: service_role (poartă/jurnal/helper) sau authenticated (deblocare) fără EXECUTE';
  END IF;
  -- p4. helperul: identitate pe chei scurte, 1024 caractere și distincție pe chei lungi cu același prefix
  IF public.egress_cheie_obiect('a/b.pdf') IS DISTINCT FROM 'a/b.pdf'
     OR length(public.egress_cheie_obiect(repeat('x', 5000))) IS DISTINCT FROM 1024
     OR public.egress_cheie_obiect(repeat('x', 1024)) IS DISTINCT FROM repeat('x', 1024)
     OR public.egress_cheie_obiect(repeat('x', 2000) || 'A') = public.egress_cheie_obiect(repeat('x', 2000) || 'B') THEN
    RAISE EXCEPTION 'Postcondiție p4: egress_cheie_obiect nu respectă contractul de canonicalizare';
  END IF;
  -- p5. joburile cron ale monitorului neschimbate (2 active)
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname IN ('egress_detector_5min', 'egress_jurnal_purge') AND active;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Postcondiție p5: % din 2 joburi cron egress active', v_n; END IF;
  RAISE NOTICE 'Livrare 20261002a: monitor egress — notificare izolată + cheie canonică unică (9 funcții)';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002a_monitor_egress_fix:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002a: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
