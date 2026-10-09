-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVENIRE 20261023a — readuce _hr_decizii_termeni și fn_hr_decizii_poate exact la corpurile dinainte (md5 d307b73b… /
-- 23fbcb51…), cu aceleași ACL-uri și atribute. Armare per tranzacție (nu persistentă):
--   BEGIN; SELECT set_config('gazpet.revenire_20261023a', 'CTC_CITIRE_DECIZII_REVENIRE:' || txid_current(), true); \i …; COMMIT;
-- Nu șterge istoricul migrării.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE
  v_ids oid[] := ARRAY[
    to_regprocedure('public._hr_decizii_termeni(uuid)')::oid,
    to_regprocedure('public.fn_hr_decizii_poate(text,bigint)')::oid];
  v_live text[] := ARRAY['d307b73b1d22bc750ca41fb249afa6cf', '23fbcb51b62c65ce20ec04ecb8395107'];
  v_nou text[] := ARRAY['1d4dcdc7c59ef1da385cec87335fb02b', 'ce7f8fabc2d74fbd8237ea0a5e6c3748'];
  v_meta jsonb[] := ARRAY[]::jsonb[];
  v_corp text; v_def text; v_acl text[]; p record; r record; i integer;
BEGIN
  IF current_setting('gazpet.revenire_20261023a', true)
       IS DISTINCT FROM 'CTC_CITIRE_DECIZII_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c
             WHERE lower(c) LIKE 'gazpet.revenire_20261023a=%') THEN
    RAISE EXCEPTION '20261023a: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20261023a: necesita postgres';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  FOR i IN 1..2 LOOP
    SELECT q.*, l.lanname INTO p FROM pg_proc q
      JOIN pg_language l ON l.oid = q.prolang WHERE q.oid = v_ids[i];
    IF NOT FOUND THEN RAISE EXCEPTION '20261023a: functie lipsa (%)', i; END IF;
    SELECT array_agg(a::text ORDER BY a::text COLLATE "C") INTO v_acl
      FROM unnest(p.proacl) a;
    IF md5(p.prosrc) IS DISTINCT FROM v_nou[i]
       OR v_acl IS DISTINCT FROM (CASE i
         WHEN 1 THEN ARRAY['postgres=X/postgres']
         ELSE ARRAY['authenticated=X/postgres','postgres=X/postgres'] END)
       OR pg_get_userbyid(p.proowner) <> 'postgres'
       OR NOT p.prosecdef OR p.provolatile <> 's'
       OR p.lanname <> (CASE i WHEN 1 THEN 'sql' ELSE 'plpgsql' END)
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION '20261023a: preconditie corp/ACL/atribute (%)', i;
    END IF;
    v_meta := array_append(v_meta, (SELECT (to_jsonb(q) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(q.oid)) FROM pg_proc q WHERE q.oid = v_ids[i]));
  END LOOP;
  FOR i IN 1..2 LOOP
    SELECT prosrc, pg_get_functiondef(oid) INTO v_corp, v_def FROM pg_proc WHERE oid = v_ids[i];
    FOR r IN SELECT * FROM (VALUES
      (1, $vechi$'are_fisa', t.are_fisa)$vechi$, $nou$'are_fisa', t.are_fisa,
    'ctc', EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profile_id
                     AND (u.module = 'ctc' OR u.module LIKE 'ctc.%')))$nou$),
      (2, $vechi$v_fisa boolean;$vechi$, $nou$v_fisa boolean; v_ctc boolean;$nou$),
      (2, $vechi$  v_fisa := coalesce((t->>'are_fisa')::boolean, false);$vechi$, $nou$  v_fisa := coalesce((t->>'are_fisa')::boolean, false);
  v_ctc := coalesce((t->>'ctc')::boolean, false);$nou$),
      (2, $vechi$WHEN 'citire_doc' THEN v_owner OR v_hrc OR (v_exec AND v_pe_proiect)$vechi$, $nou$WHEN 'citire_doc' THEN v_owner OR v_hrc OR (v_exec AND v_pe_proiect) OR (v_ctc AND v_pe_proiect)$nou$),
      (2, $vechi$WHEN 'citire_scan' THEN v_owner OR v_hr OR (v_conf AND v_pe_proiect AND v_fisa)$vechi$, $nou$WHEN 'citire_scan' THEN v_owner OR v_hr OR (v_conf AND v_pe_proiect AND v_fisa) OR (v_ctc AND v_pe_proiect)$nou$)
    ) AS x(n, vechi, nou) WHERE n = i LOOP
      v_corp := replace(v_corp, r.nou, r.vechi);
    END LOOP;
    IF md5(v_corp) IS DISTINCT FROM v_live[i] THEN
      RAISE EXCEPTION '20261023a: corp rezultat neasteptat (%)', i;
    END IF;
    -- pg_get_functiondef produce CREATE OR REPLACE cu atributele existente.
    SELECT replace(v_def, prosrc, v_corp) INTO v_def FROM pg_proc WHERE oid = v_ids[i];
    EXECUTE v_def;
  END LOOP;
  FOR i IN 1..2 LOOP
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_ids[i]) IS DISTINCT FROM v_live[i]
       OR (SELECT (to_jsonb(q) - 'prosrc' - 'proargdefaults') || jsonb_build_object('arguments', pg_get_function_arguments(q.oid)) FROM pg_proc q WHERE oid = v_ids[i])
          IS DISTINCT FROM v_meta[i] THEN
      RAISE EXCEPTION '20261023a: postconditie corp/ACL/atribute (%)', i;
    END IF;
  END LOOP;
  IF current_setting('gazpet.revenire_20261023a', true)
       IS DISTINCT FROM 'CTC_CITIRE_DECIZII_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023a: garda final invalida';
  END IF;
END $revenire$;
