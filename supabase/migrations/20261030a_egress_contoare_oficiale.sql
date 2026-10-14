-- ============================================================================
-- 20261030a — Monitor egress aliniat la contoarele OFICIALE Supabase (cerere Răzvan 14.10.2026).
-- Supabase facturează separat DOUĂ contoare (Dashboard → Org Usage, plan Pro, ciclu 07→07):
--   * „Egress”        = trafic NECACHE (DB, API, Auth, Edge, Storage, pooler) — inclus 250 GB;
--   * „Cached Egress” = servit din CDN (API, Storage, Edge)                    — inclus 250 GB.
--   Incidentul din 09.2026 (1,6 TB) a fost pe CACHED. Jurnalul propriu (storage_descarcari_jurnal) vede doar descărcările
--   instrumentate ⇒ e o limită inferioară, nu cifra facturată.
-- Ce face:
--   1. storage_egress_config.cota_cached_bytes (implicit 250 GB). cota_ciclu_bytes rămâne cota egress-ului NECACHE.
--   2. public.supabase_usage_oficial — un rând per citire a contoarelor oficiale (bytes). RLS: SELECT doar owner
--      (egress_este_owner() = profiles.is_owner pentru auth.uid()); authenticated/anon NU scriu. Scrie un COLECTOR
--      (rol postgres / service_role); sursa = pagina Usage din Dashboard (decizia Răzvan 14.10), implementarea
--      colectorului NU face parte din migrare (docs/MONITOR_EGRESS.md).
--      Fiecare citire are AMBELE contoare (colectorul citește pagina Usage, unde apar mereu amândouă — decizia
--      Răzvan 14.10, review PR #706): egress_bytes și cached_egress_bytes NOT NULL.
--   3. egress_statistici(p_zile): aceleași chei ca înainte + 'oficial' (ultima citire din ciclul curent sau null)
--      + 'oficial_ultima' (ultima citire din ORICE ciclu sau null) + 'oficial_vechime_ore' (vârsta ei, ore)
--      + 'cota_cached'. Widgetul vechi nu se strică (cheile vechi neschimbate).
--   4. egress_detector(): pe lângă alertele existente (neschimbate), alerte 50/80% pe contoarele oficiale (egress și
--      cached), o dată per prag per ciclu (dedupe ca la 'cota_ciclu': UNIQUE (tip, cheie), cheie = ciclu_start:procent);
--      plus „colector oprit” dacă ultima citire oficială e mai veche de 26 h, cel mult o dată la 24 h (nu se emite dacă
--      există deja o alertă colector_oprit mai nouă de 24 h; verificarea + inserarea sunt serializate cu
--      pg_advisory_xact_lock(hashtext('egress_colector_oprit')), deci și rulările concurente o respectă).
--      Pe contoarele oficiale NU se blochează nimic (doar notificare owner). Notificările izolate ca în 20261002a.
--      Fără nicio citire oficială (colectorul încă nedecis) ⇒ nicio alertă „colector oprit”.
--   5. CHECK-ul storage_egress_alerte.tip primește 'oficial_egress', 'oficial_cached', 'colector_oprit'.
-- Pornește DOAR peste starea live 20260930e + 20261002a (amprente md5(prosrc) verificate); nu modifică date existente.
-- ⚠ NEAPLICATĂ. Se livrează DOAR prin scripts/livrare_migrare.sh, cu acordul lui Răzvan. Fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261030a_egress_contoare_oficiale_ROLLBACK.sql (tehnic, fără GO de execuție).
-- Test local: scripts/test_egress_contoare_oficiale.sh (+ supabase/tests/monitor_egress_oficial.test.sql).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261030a_egress_contoare_oficiale:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261030a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── 0. Precondiții fail-closed ──────────────────────────────────────────────────────────
DO $pre$
DECLARE v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 0b. funcțiile înlocuite = exact varianta live (statistici din 20260930e, detector din 20261002a)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_statistici(integer)')) IS DISTINCT FROM 'dd67c392797115482c54387408d7bcf6'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '2cc00f0d41b9900c568fc82d9f5aec22' THEN
    RAISE EXCEPTION 'Precondiție 0b: egress_statistici/egress_detector ≠ amprentele live (dd67c392… / 2cc00f0d…) — se reanalizează';
  END IF;
  -- 0c. funcțiile folosite neschimbate (owner, notificare, ciclu) + 9 funcții egress_* (fără supraîncărcări)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_notifica_owner(text,text)')) IS DISTINCT FROM 'e4165baf10b67bc65ed0865d3f434778'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_este_owner()')) IS DISTINCT FROM '25c9b49412f80567bdb0b2baec4cd2f3'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_ciclu_start(timestamp with time zone)')) IS DISTINCT FROM '2cc40273fe610ac844c17bb4508d6959' THEN
    RAISE EXCEPTION 'Precondiție 0c: egress_notifica_owner/este_owner/ciclu_start ≠ amprentele live';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'Precondiție 0c: % funcții egress_* (așteptat 9)', v_n; END IF;
  -- 0d. obiectele noi nu există (aplicare parțială/manuală ⇒ se reanalizează, nu se suprascrie)
  IF to_regclass('public.supabase_usage_oficial') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0d: public.supabase_usage_oficial există deja';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'storage_egress_config' AND column_name = 'cota_cached_bytes') THEN
    RAISE EXCEPTION 'Precondiție 0d: storage_egress_config.cota_cached_bytes există deja';
  END IF;
  -- 0e. CHECK-ul pe tip = exact cel din 20260930e (îl înlocuim cu o listă extinsă)
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.storage_egress_alerte'::regclass AND contype = 'c' AND conname = 'storage_egress_alerte_tip_check'
     AND pg_get_constraintdef(oid) LIKE '%obiect_repetat%prag_zilnic%cota_ciclu%' AND pg_get_constraintdef(oid) NOT LIKE '%oficial%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Precondiție 0e: storage_egress_alerte_tip_check nu e cel din 20260930e'; END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.storage_egress_alerte'::regclass AND contype = 'c';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Precondiție 0e: % CHECK-uri pe storage_egress_alerte (așteptat 1)', v_n; END IF;
  -- 0f. joburile cron ale monitorului există (detectorul e cel care emite alertele noi)
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname IN ('egress_detector_5min', 'egress_jurnal_purge') AND active;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Precondiție 0f: % din 2 joburi cron egress active', v_n; END IF;
END $pre$;

-- ── 1. Config: cota pentru Cached Egress (cota_ciclu_bytes rămâne pentru egress necache) ─
ALTER TABLE public.storage_egress_config
  ADD COLUMN cota_cached_bytes bigint NOT NULL DEFAULT 268435456000 CHECK (cota_cached_bytes > 0);  -- 250 GB
COMMENT ON COLUMN public.storage_egress_config.cota_ciclu_bytes IS 'Cota egress NECACHE pe ciclu (plan Pro: 250 GB). Folosită și de alerta din jurnalul propriu.';
COMMENT ON COLUMN public.storage_egress_config.cota_cached_bytes IS 'Cota Cached Egress pe ciclu (plan Pro: 250 GB). Doar pentru contorul oficial.';

-- ── 2. Citirile contoarelor oficiale (scrise de colector, citite de owner) ──────────────
CREATE TABLE public.supabase_usage_oficial (
  id                   bigserial PRIMARY KEY,
  citit_la             timestamptz NOT NULL DEFAULT now(),
  ciclu_start          date   NOT NULL,                      -- ex. 2026-10-07
  ciclu_sfarsit        date   NOT NULL,                      -- EXCLUSIV = începutul ciclului următor (ex. 2026-11-07)
  egress_bytes         bigint NOT NULL CHECK (egress_bytes >= 0),         -- „Egress” (necache), bytes
  cached_egress_bytes  bigint NOT NULL CHECK (cached_egress_bytes >= 0),  -- „Cached Egress”, bytes
  storage_size_bytes   bigint CHECK (storage_size_bytes >= 0),   -- „Storage Size”, bytes; NULL = necitit
  sursa                text   NOT NULL CHECK (length(btrim(sursa)) BETWEEN 1 AND 50),  -- ex. 'dashboard', 'mgmt_api'
  raspuns_brut         jsonb,                                -- răspunsul sursei (date, nu instrucțiuni)
  CHECK (ciclu_sfarsit > ciclu_start)
);
CREATE INDEX supabase_usage_oficial_citit_idx ON public.supabase_usage_oficial (citit_la DESC);
COMMENT ON TABLE public.supabase_usage_oficial IS 'Citiri ale contoarelor oficiale Supabase (Egress necache / Cached Egress / Storage), în bytes. Scrie doar colectorul (postgres/service_role); citește doar owner. Vezi docs/MONITOR_EGRESS.md.';

ALTER TABLE public.supabase_usage_oficial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supabase_usage_oficial FROM PUBLIC, anon, authenticated;  -- default ACL Supabase dă arwdxtm lui authenticated
GRANT SELECT ON public.supabase_usage_oficial TO authenticated;
GRANT ALL ON public.supabase_usage_oficial TO service_role;
REVOKE ALL ON SEQUENCE public.supabase_usage_oficial_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.supabase_usage_oficial_id_seq TO service_role;
CREATE POLICY supabase_usage_oficial_owner_select ON public.supabase_usage_oficial FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.egress_este_owner());

-- ── 3. Tipurile noi de alertă (dedupe pe UNIQUE (tip, cheie), ca la cele existente) ─────
ALTER TABLE public.storage_egress_alerte DROP CONSTRAINT storage_egress_alerte_tip_check;
ALTER TABLE public.storage_egress_alerte ADD CONSTRAINT storage_egress_alerte_tip_check
  CHECK (tip IN ('obiect_repetat','prag_zilnic','cota_ciclu','oficial_egress','oficial_cached','colector_oprit'));

-- ── 4. Statistici: aceleași chei + 'oficial' / 'oficial_ultima' / 'oficial_vechime_ore' / 'cota_cached' ─
CREATE OR REPLACE FUNCTION public.egress_statistici(p_zile int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c storage_egress_config; v_start timestamptz; v_zile int := least(greatest(coalesce(p_zile, 30), 1), 90);
  v_azi date := (now() AT TIME ZONE 'UTC')::date;
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
    'config', jsonb_build_object('prag_obiect_ora', c.prag_obiect_ora, 'prag_zilnic_bytes', c.prag_zilnic_bytes, 'blocare_activa', c.blocare_activa),
    -- ultima citire oficială din ciclul curent (ciclu_start ≤ azi < ciclu_sfarsit, UTC) sau null; fără raspuns_brut
    'oficial', (SELECT jsonb_build_object('citit_la', u.citit_la, 'ciclu_start', u.ciclu_start, 'ciclu_sfarsit', u.ciclu_sfarsit,
                       'egress_bytes', u.egress_bytes, 'cached_egress_bytes', u.cached_egress_bytes,
                       'storage_size_bytes', u.storage_size_bytes, 'sursa', u.sursa)
                FROM supabase_usage_oficial u WHERE u.ciclu_start <= v_azi AND v_azi < u.ciclu_sfarsit
                ORDER BY u.citit_la DESC, u.id DESC LIMIT 1),
    -- ultima citire din ORICE ciclu (colector oprit peste schimbarea ciclului ⇒ widgetul arată citirea veche + avertisment)
    'oficial_ultima', (SELECT jsonb_build_object('citit_la', u.citit_la, 'ciclu_start', u.ciclu_start, 'ciclu_sfarsit', u.ciclu_sfarsit,
                       'egress_bytes', u.egress_bytes, 'cached_egress_bytes', u.cached_egress_bytes,
                       'storage_size_bytes', u.storage_size_bytes, 'sursa', u.sursa)
                FROM supabase_usage_oficial u ORDER BY u.citit_la DESC, u.id DESC LIMIT 1),
    'oficial_vechime_ore', (SELECT round(extract(epoch FROM now() - max(u.citit_la)) / 3600.0, 1) FROM supabase_usage_oficial u),
    'cota_cached', c.cota_cached_bytes
  );
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_statistici(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.egress_statistici(int) TO authenticated;

-- ── 5. Detector: secțiunile 1–3 neschimbate (20261002a) + 4) contoare oficiale + 5) colector oprit ─
CREATE OR REPLACE FUNCTION public.egress_detector()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE c storage_egress_config; r record; n_blocate int := 0; n_alerte int := 0; n_notif_esuate int := 0;
  v_zi bigint; v_ciclu bigint; v_start timestamptz; v_pct int; v_cheie text;
  u supabase_usage_oficial; v_azi date := (now() AT TIME ZONE 'UTC')::date; v_ultima timestamptz; k record;
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

  -- 4) contoarele OFICIALE (ultima citire din ciclul curent): 50% / 80% pe egress necache și pe cached, o dată per
  --    prag per ciclu (cheie = ciclu_start:procent). Doar notificare — fără blocări.
  SELECT * INTO u FROM supabase_usage_oficial WHERE ciclu_start <= v_azi AND v_azi < ciclu_sfarsit ORDER BY citit_la DESC, id DESC LIMIT 1;
  IF FOUND THEN
    FOR k IN SELECT * FROM (VALUES ('oficial_egress', 'Egress (necache)', u.egress_bytes, c.cota_ciclu_bytes),
                                   ('oficial_cached', 'Cached egress', u.cached_egress_bytes, c.cota_cached_bytes)) AS t(tip, eticheta, b, cota)
    LOOP
      CONTINUE WHEN k.b IS NULL OR k.cota IS NULL OR k.cota <= 0;  -- defensiv (coloanele sunt NOT NULL)
      FOREACH v_pct IN ARRAY c.alerte_procent LOOP
        IF k.b >= k.cota * v_pct / 100 THEN
          INSERT INTO storage_egress_alerte (tip, cheie, detalii) VALUES (k.tip, to_char(u.ciclu_start, 'YYYY-MM-DD') || ':' || v_pct,
            jsonb_build_object('bytes', k.b, 'cota', k.cota, 'procent', v_pct, 'citit_la', u.citit_la, 'sursa', u.sursa, 'citire_id', u.id))
            ON CONFLICT DO NOTHING;
          IF FOUND THEN
            n_alerte := n_alerte + 1;
            BEGIN
              PERFORM egress_notifica_owner(format('⚠️ %s: %s%% din cota ciclului (oficial)', k.eticheta, v_pct),
                format('Contor oficial Supabase: %s GB din %s GB în ciclul %s–%s (citire %s UTC, sursa %s).',
                  round(k.b / 1073741824.0, 2), round(k.cota / 1073741824.0), to_char(u.ciclu_start, 'DD.MM'), to_char(u.ciclu_sfarsit, 'DD.MM'),
                  to_char(u.citit_la AT TIME ZONE 'UTC', 'DD.MM HH24:MI'), u.sursa));
            EXCEPTION WHEN OTHERS THEN
              n_notif_esuate := n_notif_esuate + 1;
              RAISE WARNING 'egress_detector: notificarea % % %% a eșuat (%: %) — alerta rămâne', k.tip, v_pct, SQLSTATE, SQLERRM;
            END;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- 5) colector oprit: ultima citire oficială (oricare ciclu) mai veche de 26 h → cel mult o alertă la 24 h (nu ziua
  --    calendaristică: altfel miezul nopții UTC ar da a doua alertă la 5 minute după prima). Verificarea + inserarea
  --    sunt serializate cu un lock consultativ de tranzacție: o a doua rulare concurentă așteaptă commit-ul primeia și,
  --    în READ COMMITTED (cron-ul), NOT EXISTS de după lock vede alerta ei (altfel, peste miezul nopții UTC, două
  --    tranzacții cu chei de zi diferite ar trece amândouă). Cheia = ziua UTC rămâne plasa UNIQUE.
  --    Fără nicio citire (colector încă nedecis/nepornit) ⇒ nimic.
  SELECT max(citit_la) INTO v_ultima FROM supabase_usage_oficial;
  IF v_ultima IS NOT NULL AND v_ultima < now() - interval '26 hours' THEN
    PERFORM pg_advisory_xact_lock(hashtext('egress_colector_oprit'));
    INSERT INTO storage_egress_alerte (tip, cheie, detalii)
    SELECT 'colector_oprit', to_char(v_azi, 'YYYY-MM-DD'),
           jsonb_build_object('ultima_citire', v_ultima, 'ore', round(extract(epoch FROM now() - v_ultima) / 3600.0, 1))
     WHERE NOT EXISTS (SELECT 1 FROM storage_egress_alerte WHERE tip = 'colector_oprit' AND created_at > now() - interval '24 hours')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      n_alerte := n_alerte + 1;
      BEGIN
        PERFORM egress_notifica_owner('⚠️ Egress: colectorul contoarelor oficiale e oprit',
          format('Ultima citire oficială Supabase e din %s UTC (acum %s h). Monitorul arată cifre vechi până la o citire nouă.',
            to_char(v_ultima AT TIME ZONE 'UTC', 'DD.MM HH24:MI'), round(extract(epoch FROM now() - v_ultima) / 3600.0)));
      EXCEPTION WHEN OTHERS THEN
        n_notif_esuate := n_notif_esuate + 1;
        RAISE WARNING 'egress_detector: notificarea „colector oprit” a eșuat (%: %) — alerta rămâne', SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object('blocate', n_blocate, 'alerte', n_alerte, 'notificari_esuate', n_notif_esuate,
                            'bytes_azi', v_zi, 'bytes_ciclu', v_ciclu,
                            'oficial_citit_la', u.citit_la, 'oficial_ultima_citire', v_ultima);
END $f$;
REVOKE EXECUTE ON FUNCTION public.egress_detector() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.egress_detector() TO service_role;

-- ── Postcondiții (orice abatere ⇒ runnerul anulează tot) ────────────────────────────────
DO $post$
DECLARE v_n integer;
BEGIN
  -- p1. amprentele exacte ale funcțiilor înlocuite (LF, ca fișierul din repo)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_statistici(integer)')) IS DISTINCT FROM '0bf2bd142b86d1effbe462d2e4426e50'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '0b731a96daf1e4af2918d07a7b4187ad' THEN
    RAISE EXCEPTION 'Postcondiție p1: amprentele egress_statistici/egress_detector nu corespund patch-ului';
  END IF;
  -- p2. tot 9 funcții egress_*; cele două înlocuite SECURITY DEFINER cu search_path fixat
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'Postcondiție p2: % funcții egress_* (așteptat 9)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.egress_statistici(integer)'), to_regprocedure('public.egress_detector()'))
     AND p.prosecdef AND coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false);
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Postcondiție p2: % din 2 funcții SECURITY DEFINER cu search_path fixat', v_n; END IF;
  -- p3. ACL funcții: detectorul doar service_role; statisticile authenticated (poarta owner e în funcție); nimic pentru anon
  IF has_function_privilege('anon', 'public.egress_detector()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.egress_detector()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.egress_statistici(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.egress_detector()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.egress_statistici(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție p3: ACL egress_detector/egress_statistici greșit';
  END IF;
  -- p4. tabela nouă: RLS, exact o politică (SELECT owner), anon nimic, authenticated doar SELECT
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.supabase_usage_oficial'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție p4: supabase_usage_oficial fără RLS';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute
   WHERE attrelid = 'public.supabase_usage_oficial'::regclass AND attname IN ('egress_bytes', 'cached_egress_bytes') AND attnotnull AND NOT attisdropped;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Postcondiție p4: egress_bytes / cached_egress_bytes trebuie NOT NULL (% din 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'supabase_usage_oficial';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Postcondiție p4: % politici pe supabase_usage_oficial (așteptat 1)', v_n; END IF;
  IF (SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'supabase_usage_oficial') IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'Postcondiție p4: politica de pe supabase_usage_oficial nu e SELECT';
  END IF;
  SELECT count(*) INTO v_n FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
   WHERE has_table_privilege('anon', 'public.supabase_usage_oficial', pr)
      OR (pr <> 'SELECT' AND has_table_privilege('authenticated', 'public.supabase_usage_oficial', pr));
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Postcondiție p4: % drepturi în plus pe supabase_usage_oficial pentru anon/authenticated', v_n; END IF;
  IF has_sequence_privilege('anon', 'public.supabase_usage_oficial_id_seq', 'USAGE') OR has_sequence_privilege('authenticated', 'public.supabase_usage_oficial_id_seq', 'USAGE')
     OR NOT has_table_privilege('service_role', 'public.supabase_usage_oficial', 'INSERT') THEN
    RAISE EXCEPTION 'Postcondiție p4: secvența/scrierea pe supabase_usage_oficial greșit acordate';
  END IF;
  -- p5. config: tot un rând, cota cached 250 GB; CHECK-ul extins pe tip
  IF (SELECT count(*) FROM public.storage_egress_config) IS DISTINCT FROM 1::bigint
     OR (SELECT cota_cached_bytes FROM public.storage_egress_config WHERE id = 1) IS DISTINCT FROM 268435456000::bigint THEN
    RAISE EXCEPTION 'Postcondiție p5: storage_egress_config (un rând, cota_cached_bytes = 250 GB)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.storage_egress_alerte'::regclass AND contype = 'c' AND conname = 'storage_egress_alerte_tip_check'
     AND pg_get_constraintdef(oid) LIKE '%oficial_egress%oficial_cached%colector_oprit%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Postcondiție p5: CHECK-ul extins pe storage_egress_alerte.tip lipsește'; END IF;
  -- p6. joburile cron ale monitorului neschimbate (2 active)
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname IN ('egress_detector_5min', 'egress_jurnal_purge') AND active;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Postcondiție p6: % din 2 joburi cron egress active', v_n; END IF;
  RAISE NOTICE 'Livrare 20261030a: contoare oficiale (tabela supabase_usage_oficial, cota cached, statistici + detector extinse)';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261030a_egress_contoare_oficiale:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261030a: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
