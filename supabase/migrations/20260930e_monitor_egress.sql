-- Monitor egress Storage (varianta C = A + B, decizia lui Răzvan după incidentul 24–25.09.2026,
-- docs/INCIDENT_EGRESS_2026-09-25.md: doc 770, 95 MB, ~16.000 descărcări, 1,6 TB cached egress).
-- A) jurnal descărcări + detector la 5 min + circuit breaker pe obiect (deblocare doar owner)
-- B) statistici pentru widget-ul din ERP (doar owner) + alerte cotă ciclu la 50% / 80% din 250 GB.
-- NEAPLICATĂ pe live: se aplică doar cu acordul lui Răzvan (apply_migration). Rollback: 20260930e_monitor_egress_ROLLBACK.sql
BEGIN;

-- ── Config (un singur rând) ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_egress_config (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  prag_obiect_ora     int    NOT NULL DEFAULT 20,                         -- >20 descărcări/oră pe același obiect → blocare
  prag_zilnic_bytes   bigint NOT NULL DEFAULT 21474836480,             -- total/zi peste prag → alertă (20 GB; normal ~0,6 GB/zi)
  cota_ciclu_bytes    bigint NOT NULL DEFAULT 268435456000,          -- cota planului: 250 GB
  ciclu_zi_start      int    NOT NULL DEFAULT 7 CHECK (ciclu_zi_start BETWEEN 1 AND 28),  -- ciclul de facturare 07→07
  alerte_procent      int[]  NOT NULL DEFAULT '{50,80}',
  blocare_activa      boolean NOT NULL DEFAULT true,                      -- false = doar alertă, fără circuit breaker
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.storage_egress_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Jurnal descărcări ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_descarcari_jurnal (
  id         bigserial PRIMARY KEY,
  bucket     text   NOT NULL,
  obiect     text   NOT NULL,
  doc_id     bigint,
  bytes      bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  sursa      text   NOT NULL,                 -- ex. 'edge:ofertare-ingest-doc', 'nas:ingest', 'nas:citire_mare'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_descarcari_jurnal_obiect_idx ON public.storage_descarcari_jurnal (bucket, obiect, created_at DESC);
CREATE INDEX IF NOT EXISTS storage_descarcari_jurnal_created_idx ON public.storage_descarcari_jurnal (created_at DESC);

-- ── Obiecte blocate (circuit breaker) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_obiecte_blocate (
  bucket       text NOT NULL,
  obiect       text NOT NULL,
  blocat       boolean NOT NULL DEFAULT true,
  motiv        text,
  descarcari_ora int,
  blocat_la    timestamptz NOT NULL DEFAULT now(),
  deblocat_la  timestamptz,
  deblocat_de  uuid REFERENCES auth.users(id),
  PRIMARY KEY (bucket, obiect)
);

-- ── Alerte emise (dedupe: o alertă pe cheie) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_egress_alerte (
  id         bigserial PRIMARY KEY,
  tip        text NOT NULL CHECK (tip IN ('obiect_repetat','prag_zilnic','cota_ciclu')),
  cheie      text NOT NULL,                  -- ex. 'ofertare/…pdf', '2026-09-25', '2026-09-07:80'
  detalii    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tip, cheie)
);

-- ── RLS: citire doar owner; scrierea doar prin funcțiile SECURITY DEFINER ────────────────
ALTER TABLE public.storage_egress_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_descarcari_jurnal  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_obiecte_blocate    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_egress_alerte      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.storage_egress_config, public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte FROM PUBLIC, anon;
GRANT SELECT ON public.storage_egress_config, public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte TO authenticated;
GRANT ALL ON public.storage_egress_config, public.storage_descarcari_jurnal, public.storage_obiecte_blocate, public.storage_egress_alerte TO service_role;
GRANT USAGE ON SEQUENCE public.storage_descarcari_jurnal_id_seq, public.storage_egress_alerte_id_seq TO service_role;

-- Helper owner (SECURITY DEFINER: nu depinde de RLS-ul din profiles)
CREATE OR REPLACE FUNCTION public.egress_este_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_owner)
$f$;
REVOKE EXECUTE ON FUNCTION public.egress_este_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_este_owner() TO authenticated, service_role;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['storage_egress_config','storage_descarcari_jurnal','storage_obiecte_blocate','storage_egress_alerte'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND public.egress_este_owner())$p$, t || '_owner_select', t);
  END LOOP;
END $$;

-- ── Helper: notificare către toți owner-ii (modul 'general' — în CHECK-ul existent) ──────
CREATE OR REPLACE FUNCTION public.egress_notifica_owner(p_title text, p_message text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE n int;
BEGIN
  INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
  SELECT id, 'egress_alerta', 'general', p_title, p_message, '/' FROM profiles WHERE is_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_notifica_owner(text, text) FROM PUBLIC, anon, authenticated;

-- ── RPC 1: poarta înainte de descărcare (circuit breaker). Doar service_role. ────────────
CREATE OR REPLACE FUNCTION public.egress_obiect_blocat(p_bucket text, p_obiect text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM storage_obiecte_blocate b WHERE b.bucket = p_bucket AND b.obiect = p_obiect AND b.blocat)
     AND (SELECT blocare_activa FROM storage_egress_config WHERE id = 1)
$f$;
REVOKE EXECUTE ON FUNCTION public.egress_obiect_blocat(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_obiect_blocat(text, text) TO service_role;

-- ── RPC 2: înregistrare descărcare. Doar service_role. ───────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION public.egress_log_descarcare(text, text, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_log_descarcare(text, text, bigint, text, bigint) TO service_role;

-- ── Începutul ciclului de facturare curent ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_ciclu_start(p_la timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN extract(day FROM p_la AT TIME ZONE 'UTC') >= c.ciclu_zi_start
    THEN (date_trunc('month', p_la AT TIME ZONE 'UTC') + (c.ciclu_zi_start - 1) * interval '1 day') AT TIME ZONE 'UTC'
    ELSE (date_trunc('month', p_la AT TIME ZONE 'UTC') - interval '1 month' + (c.ciclu_zi_start - 1) * interval '1 day') AT TIME ZONE 'UTC' END
  FROM storage_egress_config c WHERE c.id = 1
$f$;
REVOKE EXECUTE ON FUNCTION public.egress_ciclu_start(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_ciclu_start(timestamptz) TO authenticated, service_role;

-- ── Detector (pg_cron la 5 min) ──────────────────────────────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION public.egress_detector() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_detector() TO service_role;

-- ── Deblocare: doar is_owner ─────────────────────────────────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION public.egress_deblocheaza(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_deblocheaza(text, text) TO authenticated;

-- ── Statistici pentru widget: doar is_owner ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.egress_statistici(p_zile int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c storage_egress_config; v_start timestamptz; v_zile int := least(greatest(coalesce(p_zile, 30), 1), 90);
BEGIN
  IF NOT egress_este_owner() THEN
    RAISE EXCEPTION 'Doar owner-ul vede monitorul de egress' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM storage_egress_config WHERE id = 1;
  v_start := egress_ciclu_start(now());
  RETURN jsonb_build_object(
    'pe_zi', (SELECT coalesce(jsonb_agg(jsonb_build_object('zi', z.zi, 'bytes', coalesce(j.b, 0), 'n', coalesce(j.n, 0)) ORDER BY z.zi), '[]')
              FROM generate_series((now() AT TIME ZONE 'UTC')::date - (v_zile - 1), (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS z(zi)
              LEFT JOIN (SELECT (created_at AT TIME ZONE 'UTC')::date AS zi, sum(bytes) AS b, count(*) AS n FROM storage_descarcari_jurnal
                         WHERE created_at >= now() - v_zile * interval '1 day' GROUP BY 1) j ON j.zi = z.zi::date),
    'top_obiecte', (SELECT coalesce(jsonb_agg(t), '[]') FROM (
              SELECT j.bucket, j.obiect, max(j.doc_id) AS doc_id, count(*) AS n, sum(j.bytes) AS bytes, max(j.created_at) AS ultima,
                     array_agg(DISTINCT j.sursa) AS surse, coalesce(bool_or(b.blocat), false) AS blocat
              FROM storage_descarcari_jurnal j LEFT JOIN storage_obiecte_blocate b ON b.bucket = j.bucket AND b.obiect = j.obiect
              WHERE j.created_at >= now() - v_zile * interval '1 day'
              GROUP BY j.bucket, j.obiect ORDER BY sum(j.bytes) DESC LIMIT 10) t),
    'blocate', (SELECT coalesce(jsonb_agg(b ORDER BY b.blocat_la DESC), '[]') FROM storage_obiecte_blocate b WHERE b.blocat),
    'ciclu', jsonb_build_object('start', v_start, 'bytes', (SELECT coalesce(sum(bytes), 0) FROM storage_descarcari_jurnal WHERE created_at >= v_start),
              'cota', c.cota_ciclu_bytes, 'alerte_procent', to_jsonb(c.alerte_procent)),
    'config', jsonb_build_object('prag_obiect_ora', c.prag_obiect_ora, 'prag_zilnic_bytes', c.prag_zilnic_bytes, 'blocare_activa', c.blocare_activa)
  );
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_statistici(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_statistici(int) TO authenticated;

-- ── pg_cron: detector la 5 min + curățenie jurnal > 180 zile (doar dacă există pg_cron) ─
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('egress_detector_5min', 'egress_jurnal_purge');
    PERFORM cron.schedule('egress_detector_5min', '*/5 * * * *', 'SELECT public.egress_detector()');
    PERFORM cron.schedule('egress_jurnal_purge', '17 3 * * *', $c$DELETE FROM public.storage_descarcari_jurnal WHERE created_at < now() - interval '180 days'$c$);
  END IF;
END $$;

COMMIT;
