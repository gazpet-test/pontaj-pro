-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20261030a_egress_contoare_oficiale.sql (contoare oficiale Supabase).
-- Readuce EXACT: egress_statistici (20260930e, md5 dd67c392…), egress_detector (20261002a, md5 2cc00f0d…), CHECK-ul
-- inițial pe storage_egress_alerte.tip, cota_ciclu_bytes = 268435456000 (250 GiB, valoarea live dinainte; doar dacă e încă
-- 250000000000 pusă de migrare) + DEFAULT-ul ei; șterge supabase_usage_oficial (cu triggerul și funcția lui),
-- storage_egress_config.cota_cached_bytes și oficial_activat_la.
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Folosire doar la decizia
--   lui Răzvan. PIERDE DATE: citirile din supabase_usage_oficial și alertele de tip oficial_egress / oficial_cached /
--   colector_oprit (fără ele CHECK-ul vechi nu se poate repune). Cifrele oficiale rămân în Dashboard-ul Supabase.
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN;
--     SELECT set_config('gazpet.rollback_tehnic_20261030a', 'SCOATE_CONTOARE_OFICIALE:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- Siguranțe: armare persistentă = refuz; armare legată de txid; precondiții = EXACT patch-ul 20261030a;
--   postcondiții = EXACT starea 20260930e + 20261002a; dezarmare la final.
-- ============================================================================
DO $rollback_pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.rollback_tehnic_20261030a') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030a blocat: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('gazpet.rollback_tehnic_20261030a', true) IS DISTINCT FROM ('SCOATE_CONTOARE_OFICIALE:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261030a blocat: fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.rollback_tehnic_20261030a'', ''SCOATE_CONTOARE_OFICIALE:'' || txid_current(), true);' USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_statistici(integer)')) IS DISTINCT FROM '0bf2bd142b86d1effbe462d2e4426e50'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '0bee895a79cae0b8db55d02dc40c0f48'
     OR to_regclass('public.supabase_usage_oficial') IS NULL THEN
    RAISE EXCEPTION 'Precondiție rollback 20261030a: starea curentă nu e patch-ul 20261030a — nu se revine tacit peste o versiune neanalizată' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);  -- ca în migrare: nu stă la coadă nelimitat (poarta de descărcare citește config-ul)
END $rollback_pre$;

-- Lock-uri luate o dată, în ordinea detectorului (config → alerte → citiri): fără deadlock cu egress_detector_5min și
-- fără ca un detector concurent să insereze o alertă de tip nou între DELETE și repunerea CHECK-ului vechi.
LOCK TABLE public.storage_egress_config, public.storage_egress_alerte, public.supabase_usage_oficial IN ACCESS EXCLUSIVE MODE;

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
-- ACL-urile funcțiilor înlocuite rămân (CREATE OR REPLACE nu le schimbă).

-- alertele de tip nou trebuie scoase ca CHECK-ul vechi să poată fi repus (PIERDERE de date, vezi antetul)
DELETE FROM public.storage_egress_alerte WHERE tip IN ('oficial_egress', 'oficial_cached', 'colector_oprit');
ALTER TABLE public.storage_egress_alerte DROP CONSTRAINT storage_egress_alerte_tip_check;
ALTER TABLE public.storage_egress_alerte ADD CONSTRAINT storage_egress_alerte_tip_check
  CHECK (tip IN ('obiect_repetat','prag_zilnic','cota_ciclu'));
DROP TABLE public.supabase_usage_oficial;  -- politica, indexul, secvența și triggerul pleacă odată cu tabela
DROP FUNCTION public.supabase_usage_oficial_valideaza();
-- cota egress necache: înapoi la valoarea live dinainte (268435456000 = 250 GiB) DOAR dacă e încă cea pusă de migrare;
-- o valoare schimbată între timp de owner rămâne (decizie umană, nu se rescrie tacit)
UPDATE public.storage_egress_config SET cota_ciclu_bytes = 268435456000, updated_at = now() WHERE id = 1 AND cota_ciclu_bytes = 250000000000;
ALTER TABLE public.storage_egress_config ALTER COLUMN cota_ciclu_bytes SET DEFAULT 268435456000;
ALTER TABLE public.storage_egress_config DROP COLUMN cota_cached_bytes, DROP COLUMN oficial_activat_la;
COMMENT ON COLUMN public.storage_egress_config.cota_ciclu_bytes IS NULL;

DO $rollback_post$
DECLARE v_n integer;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_statistici(integer)')) IS DISTINCT FROM 'dd67c392797115482c54387408d7bcf6'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.egress_detector()')) IS DISTINCT FROM '2cc00f0d41b9900c568fc82d9f5aec22'
     OR to_regclass('public.supabase_usage_oficial') IS NOT NULL
     OR to_regprocedure('public.supabase_usage_oficial_valideaza()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'storage_egress_config'
                  AND column_name IN ('cota_cached_bytes', 'oficial_activat_la')) THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261030a: starea nu e exact 20260930e + 20261002a';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'egress\_%';
  IF v_n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'Postcondiție rollback 20261030a: % funcții egress_* (așteptat 9)', v_n; END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261030a', '', true);  -- dezarmare
END $rollback_post$;
