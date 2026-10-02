-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20261002a_monitor_egress_fix.sql (monitor egress: notificare izolată +
-- cheie canonică). Readuce EXACT definițiile live din 20260930e (aplicată 01.10.2026) pentru egress_detector,
-- egress_log_descarcare, egress_obiect_blocat, egress_deblocheaza și șterge helperul egress_cheie_obiect(text).
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Redeschide cele două
--   găuri (notificare eșuată ⇒ detector fail-open; cheie > 1024 ⇒ ocolirea porții). Folosire doar la decizia lui Răzvan.
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN;
--     SELECT set_config('gazpet.rollback_tehnic_20261002a', 'REDESCHIDE_EGRESS_FIX:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- Siguranțe: armare persistentă = refuz; armare legată de txid; precondiții = EXACT patch-ul 20261002a;
--   postcondiții = EXACT amprentele live 20260930e; dezarmare la final. Nu modifică date.
-- ============================================================================
DO $rollback_pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.rollback_tehnic_20261002a') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261002a blocat: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('gazpet.rollback_tehnic_20261002a', true) IS DISTINCT FROM ('REDESCHIDE_EGRESS_FIX:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261002a blocat: fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.rollback_tehnic_20261002a'', ''REDESCHIDE_EGRESS_FIX:'' || txid_current(), true);' USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_cheie_obiect(text)')) IS DISTINCT FROM '80cb4557c7020f51672f3dc7b62c8a91'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_obiect_blocat(text,text)')) IS DISTINCT FROM '73cd68ed6bf1a07759c11ff2f73f9afb'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_log_descarcare(text,text,bigint,text,bigint)')) IS DISTINCT FROM 'ef4c8c01d648a4c6f029807c97a03a4b'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_deblocheaza(text,text)')) IS DISTINCT FROM 'de5e29c4173761637b85021422fee119'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '2cc00f0d41b9900c568fc82d9f5aec22' THEN
    RAISE EXCEPTION 'Precondiție rollback 20261002a: starea curentă nu e patch-ul 20261002a — nu se revine tacit peste o versiune neanalizată' USING ERRCODE = '55000';
  END IF;
END $rollback_pre$;

CREATE OR REPLACE FUNCTION public.egress_obiect_blocat(p_bucket text, p_obiect text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM storage_obiecte_blocate b WHERE b.bucket = p_bucket AND b.obiect = p_obiect AND b.blocat)
     AND (SELECT blocare_activa FROM storage_egress_config WHERE id = 1)
$f$;

CREATE OR REPLACE FUNCTION public.egress_log_descarcare(p_bucket text, p_obiect text, p_bytes bigint, p_sursa text, p_doc_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint;
BEGIN
  IF coalesce(p_bucket, '') = '' OR coalesce(p_obiect, '') = '' OR coalesce(p_sursa, '') = '' THEN
    RAISE EXCEPTION 'bucket, obiect și sursa sunt obligatorii';
  END IF;
  INSERT INTO storage_descarcari_jurnal (bucket, obiect, doc_id, bytes, sursa)
  VALUES (p_bucket, left(p_obiect, 1024), p_doc_id, greatest(coalesce(p_bytes, 0), 0), left(p_sursa, 100))
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE OR REPLACE FUNCTION public.egress_deblocheaza(p_bucket text, p_obiect text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT egress_este_owner() THEN
    RAISE EXCEPTION 'Doar owner-ul poate debloca descărcările' USING ERRCODE = '42501';
  END IF;
  UPDATE storage_obiecte_blocate SET blocat = false, deblocat_la = now(), deblocat_de = auth.uid()
  WHERE bucket = p_bucket AND obiect = p_obiect AND blocat;
  RETURN FOUND;
END $f$;

CREATE OR REPLACE FUNCTION public.egress_detector()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c storage_egress_config; r record; n_blocate int := 0; n_alerte int := 0;
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
      PERFORM egress_notifica_owner('⚠️ Egress: descărcări repetate' || CASE WHEN c.blocare_activa THEN ' — obiect BLOCAT' ELSE '' END,
        format('%s/%s descărcat de %s ori în ultima oră (%s MB). %s', r.bucket, r.obiect, r.n, round(r.b / 1048576.0),
          CASE WHEN c.blocare_activa THEN 'Descărcările automate sunt oprite până la deblocare din widget-ul Monitor egress.' ELSE '' END));
      n_alerte := n_alerte + 1;
    END IF;
  END LOOP;

  -- 2) total zilnic (UTC) peste prag
  SELECT coalesce(sum(bytes), 0) INTO v_zi FROM storage_descarcari_jurnal WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF v_zi > c.prag_zilnic_bytes THEN
    INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES ('prag_zilnic', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('bytes', v_zi, 'prag', c.prag_zilnic_bytes)) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM egress_notifica_owner('⚠️ Egress: prag zilnic depășit',
        format('Azi (UTC) s-au descărcat %s GB din Storage (prag %s GB).', round(v_zi / 1073741824.0, 1), round(c.prag_zilnic_bytes / 1073741824.0, 1)));
      n_alerte := n_alerte + 1;
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
        PERFORM egress_notifica_owner(format('⚠️ Egress: %s%% din cota ciclului', v_pct),
          format('Din %s s-au descărcat %s GB (jurnal propriu) din %s GB.', to_char(v_start, 'DD.MM'), round(v_ciclu / 1073741824.0, 1), round(c.cota_ciclu_bytes / 1073741824.0)));
        n_alerte := n_alerte + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('blocate', n_blocate, 'alerte', n_alerte, 'bytes_azi', v_zi, 'bytes_ciclu', v_ciclu);
END $f$;

-- ACL-urile funcțiilor înlocuite rămân (CREATE OR REPLACE nu le schimbă). Helperul nu mai e referit ⇒ se șterge.
DROP FUNCTION public.egress_cheie_obiect(text);

DO $rollback_post$
DECLARE v_n integer;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_obiect_blocat(text,text)')) IS DISTINCT FROM 'db91e3dc3d3eee63f82324bda3f9fd5b'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_log_descarcare(text,text,bigint,text,bigint)')) IS DISTINCT FROM 'b376e5f08c48a3dbf48d0a0a1d9d1a45'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_deblocheaza(text,text)')) IS DISTINCT FROM '8e59b353863755dab7654d898c1806f1'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '2db8766e07f60c779aa4fd0dd6c06ef4'
     OR to_regprocedure('public.egress_cheie_obiect(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261002a: starea nu e exact 20260930e';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'Postcondiție rollback 20261002a: % funcții egress_* (așteptat 8)', v_n; END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002a', '', true);  -- dezarmare
END $rollback_post$;
