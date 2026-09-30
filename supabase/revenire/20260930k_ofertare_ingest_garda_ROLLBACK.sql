-- ════════════════════════════════════════════════════════════════════════════
-- 20260930k_ofertare_ingest_garda — ROLLBACK TEHNIC: scoate garda citirii automate Ofertare (tabelul ofertare_ingest_garda
-- + cele 4 funcții). ARTEFACT FĂRĂ GO DE EXECUȚIE. NU e migrare: stă în supabase/revenire/ și nu îl parcurge niciun runner
-- (supabase/revenire/README.md). Folosire doar la cererea explicită a lui Răzvan, cu decizie și review specifice (Copilot).
-- Existența comutatorului de armare NU e autorizare.
--
-- CE PIERZI: contoarele (eșecuri, descărcări, blocări, lease-uri, amprentele citirilor). Cu edge-ul v13 deployat, citirea
-- automată se OPREȘTE complet după rollback (RPC-ul gărzii lipsește ⇒ fail-closed, nu descarcă) — stare sigură. Revenirea la
-- v12 (care are calea anon) e o decizie separată, NU face parte din acest fișier.
--
-- GESTIONARUL TRANZACȚIEI E OPERATORUL: fișierul NU conține BEGIN/COMMIT. Se trimite UN SINGUR string:
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20260930k', 'SCOATE_GARDA_INGEST:' || txid_current(), true);
--   <acest fișier, întreg>
--   COMMIT;
-- Refuz (42501, nimic schimbat) pentru: armare persistentă (ALTER DATABASE / ROLE … SET, în pg_db_role_setting, nume
-- comparat cu lower()); armare lipsă, veche, de sesiune sau dintr-o altă tranzacție. Precondiție: amprenta EXACTĂ a patch-ului
-- (același text de amprentă și aceeași valoare așteptată ca postcondiția migrării: md5 corpuri funcții + SECDEF + search_path +
-- ACL EXECUTE, structura tabelului, constrângeri, index, RLS, politică, ACL) — altfel refuz. DROP fără CASCADE: un obiect
-- străin care depinde de ele ⇒ eroare ⇒ nimic schimbat. Postcondiție înainte de COMMIT: niciun obiect cu numele patch-ului,
-- în nicio schemă. La final se dezarmează comutatorul. Tot fișierul e UN bloc DO.
-- ════════════════════════════════════════════════════════════════════════════
DO $revenire_20260930k$
DECLARE
  v_q CONSTANT text := $amprenta$
SELECT jsonb_build_object(
  'tabel', (SELECT format('relkind=%s owner=%s rls=%s force=%s', c.relkind, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity)
              FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.ofertare_ingest_garda')),
  'coloane', (SELECT md5(string_agg(format('%s %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
                coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')), ', ' ORDER BY a.attnum))
              FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = to_regclass('public.ofertare_ingest_garda') AND a.attnum > 0 AND NOT a.attisdropped),
  'constrangeri', (SELECT md5(string_agg(format('%s %s', k.conname, replace(pg_get_constraintdef(k.oid), 'public.', '')), ', ' ORDER BY k.conname))
              FROM pg_catalog.pg_constraint k WHERE k.conrelid = to_regclass('public.ofertare_ingest_garda')),
  'indecsi', (SELECT md5(string_agg(replace(pg_get_indexdef(i.indexrelid), 'public.', ''), ', ' ORDER BY i.indexrelid::regclass::text))
              FROM pg_catalog.pg_index i WHERE i.indrelid = to_regclass('public.ofertare_ingest_garda')),
  'triggere', (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.ofertare_ingest_garda') AND NOT t.tgisinternal),
  -- runda 3 (J5): tot ce ar dispărea TĂCUT la DROP TABLE fără CASCADE: reguli (pg_rewrite), comentarii, statistici extinse,
  -- publicații; plus dependenți străini (vederi etc.) care ar bloca DROP-ul — toate trebuie să fie 0
  'reguli', (SELECT count(*) FROM pg_catalog.pg_rewrite w WHERE w.ev_class = to_regclass('public.ofertare_ingest_garda')),
  'comentarii', (SELECT count(*) FROM pg_catalog.pg_description d WHERE (d.classoid = 'pg_catalog.pg_class'::regclass AND d.objoid = to_regclass('public.ofertare_ingest_garda'))
                   OR (d.classoid = 'pg_catalog.pg_proc'::regclass AND d.objoid IN (SELECT p.oid FROM pg_catalog.pg_proc p WHERE p.proname LIKE 'ofertare_ingest_garda_%'))
                   OR (d.classoid = 'pg_catalog.pg_constraint'::regclass AND d.objoid IN (SELECT k.oid FROM pg_catalog.pg_constraint k WHERE k.conrelid = to_regclass('public.ofertare_ingest_garda')))
                   OR (d.classoid = 'pg_catalog.pg_policy'::regclass AND d.objoid IN (SELECT p.oid FROM pg_catalog.pg_policy p WHERE p.polrelid = to_regclass('public.ofertare_ingest_garda')))),
  'statistici', (SELECT count(*) FROM pg_catalog.pg_statistic_ext s WHERE s.stxrelid = to_regclass('public.ofertare_ingest_garda')),
  'publicatii', (SELECT count(*) FROM pg_catalog.pg_publication_rel r WHERE r.prrelid = to_regclass('public.ofertare_ingest_garda')),
  'dependenti', (SELECT count(*) FROM pg_catalog.pg_depend d WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = to_regclass('public.ofertare_ingest_garda') AND d.deptype = 'n'
                   AND d.classid <> 'pg_catalog.pg_constraint'::regclass AND NOT (d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = to_regclass('public.ofertare_ingest_garda'))),
  'politici', (SELECT string_agg(format('%s|%s|%s|%s|%s|%s', p.policyname, p.permissive, p.roles::text, p.cmd,
                replace(coalesce(p.qual, ''), 'public.', ''), replace(coalesce(p.with_check, ''), 'public.', '')), ' ; ' ORDER BY p.policyname)
              FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'ofertare_ingest_garda'),
  'acl', (SELECT string_agg(s.e, ',' ORDER BY s.e COLLATE "C") FROM (
            SELECT format('%s:%s:%s', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type, x.is_grantable) AS e
              FROM pg_catalog.pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
             WHERE c.oid = to_regclass('public.ofertare_ingest_garda')) s),
  'acl_coloane', (SELECT count(*) FROM pg_catalog.pg_attribute a
                   WHERE a.attrelid = to_regclass('public.ofertare_ingest_garda') AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
  'functii', (SELECT jsonb_object_agg(format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
                format('src=%s secdef=%s cfg=%s owner=%s lang=%s vol=%s strict=%s rez=%s acl=%s', md5(p.prosrc), p.prosecdef,
                  array_to_string(p.proconfig, ';'), pg_get_userbyid(p.proowner), l.lanname, p.provolatile, p.proisstrict, pg_get_function_result(p.oid),
                  (SELECT string_agg(s.e, ',' ORDER BY s.e COLLATE "C") FROM (
                     SELECT format('%s:%s:%s', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type, x.is_grantable) AS e
                       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x) s)))
              FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace JOIN pg_catalog.pg_language l ON l.oid = p.prolang
             WHERE p.proname = ANY (ARRAY['ofertare_ingest_garda_notifica', 'ofertare_ingest_garda_incearca', 'ofertare_ingest_garda_rezultat', 'ofertare_ingest_garda_reactiveaza']))
)
$amprenta$;
  v_asteptat CONSTANT jsonb := '{
    "acl": "authenticated:SELECT:f,postgres:DELETE:f,postgres:INSERT:f,postgres:MAINTAIN:f,postgres:REFERENCES:f,postgres:SELECT:f,postgres:TRIGGER:f,postgres:TRUNCATE:f,postgres:UPDATE:f,service_role:DELETE:f,service_role:INSERT:f,service_role:MAINTAIN:f,service_role:REFERENCES:f,service_role:SELECT:f,service_role:TRIGGER:f,service_role:TRUNCATE:f,service_role:UPDATE:f",
    "acl_coloane": 0,
    "coloane": "3173b7044cb197d13b1edff9a8095cab",
    "comentarii": 0,
    "constrangeri": "10d7c9327832bcae1d093bf69297a8e2",
    "dependenti": 0,
    "functii": {
      "public.ofertare_ingest_garda_incearca(p_doc_id bigint, p_size bigint, p_etag text, p_sursa text)": "src=8471aaf1295ee51dd9b52af240c822ee secdef=t cfg=search_path=public, pg_temp owner=postgres lang=plpgsql vol=v strict=f rez=jsonb acl=postgres:EXECUTE:f,service_role:EXECUTE:f",
      "public.ofertare_ingest_garda_notifica(p_doc_id bigint, p_motiv text)": "src=4d77710e10c2081fe939f1a9f3acd88e secdef=t cfg=search_path=public, pg_temp owner=postgres lang=plpgsql vol=v strict=f rez=integer acl=postgres:EXECUTE:f",
      "public.ofertare_ingest_garda_reactiveaza(p_doc_id bigint)": "src=9c009931fc1fb163c680c83f1b399b07 secdef=t cfg=search_path=public, pg_temp owner=postgres lang=plpgsql vol=v strict=f rez=boolean acl=authenticated:EXECUTE:f,postgres:EXECUTE:f",
      "public.ofertare_ingest_garda_rezultat(p_doc_id bigint, p_token uuid, p_rezultat text, p_hash text, p_size bigint, p_etag text, p_eroare text, p_doc jsonb)": "src=d728fdc53fcb0293e91147adb77a9b59 secdef=t cfg=search_path=public, pg_temp owner=postgres lang=plpgsql vol=v strict=f rez=jsonb acl=postgres:EXECUTE:f,service_role:EXECUTE:f"
    },
    "indecsi": "a6967eb5f0bbd64e83204fa34f644bca",
    "politici": "ofertare_ingest_garda_select|PERMISSIVE|{authenticated}|SELECT|((auth.uid() IS NOT NULL) AND fn_are_acces_ofertare())|",
    "publicatii": 0,
    "reguli": 0,
    "statistici": 0,
    "tabel": "relkind=r owner=postgres rls=t force=f",
    "triggere": 0
  }'::jsonb;
  v_gasit jsonb;
  v_k text;
  v_n integer;
BEGIN
  -- 1. Armare persistentă = refuz (numele GUC nu ține cont de majuscule).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.revenire_20260930k') THEN
    RAISE EXCEPTION 'REVENIRE 20260930k blocată: comutatorul e armat PERSISTENT (pg_db_role_setting). Șterge setarea cu ALTER DATABASE/ROLE … RESET; armarea se face doar în tranzacția revenirii.'
      USING ERRCODE = '42501';
  END IF;
  -- 2. Armare legată de tranzacția curentă.
  IF current_setting('gazpet.revenire_20260930k', true) IS DISTINCT FROM ('SCOATE_GARDA_INGEST:' || txid_current()::text) THEN
    RAISE EXCEPTION 'REVENIRE 20260930k blocată: nearmată în tranzacția curentă (scoate garda citirii automate). Doar la cererea explicită a lui Răzvan, într-un singur string: BEGIN; SELECT set_config(''gazpet.revenire_20260930k'', ''SCOATE_GARDA_INGEST:'' || txid_current(), true); <fișierul>; COMMIT;'
      USING ERRCODE = '42501';
  END IF;
  -- 3. Precondiție: amprenta EXACTĂ a patch-ului (aceeași interogare și aceeași valoare ca postcondiția migrării).
  EXECUTE v_q INTO v_gasit;
  IF v_gasit IS DISTINCT FROM v_asteptat THEN
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_k FROM jsonb_object_keys(v_asteptat) k WHERE v_gasit -> k IS DISTINCT FROM v_asteptat -> k;
    RAISE EXCEPTION 'REVENIRE 20260930k: REFUZ — starea nu e amprenta exactă a patch-ului (diferă: %). Nimic schimbat. Găsit: %', coalesce(v_k, '?'), v_gasit
      USING ERRCODE = '42501';
  END IF;
  -- 4. Inventar (ce se pierde), în jurnalul operatorului.
  SELECT count(*) INTO v_n FROM public.ofertare_ingest_garda;
  RAISE NOTICE 'Revenire 20260930k: se șterg % rânduri de gardă (% blocate, % cu lease activ)', v_n,
    (SELECT count(*) FROM public.ofertare_ingest_garda WHERE blocat), (SELECT count(*) FROM public.ofertare_ingest_garda WHERE in_curs_pana > now());
  -- 5. Ștergerea (fără CASCADE: orice dependent străin ⇒ eroare ⇒ nimic schimbat).
  DROP FUNCTION public.ofertare_ingest_garda_reactiveaza(bigint);
  DROP FUNCTION public.ofertare_ingest_garda_rezultat(bigint, uuid, text, text, bigint, text, text, jsonb);
  DROP FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text);
  DROP FUNCTION public.ofertare_ingest_garda_notifica(bigint, text);
  DROP TABLE public.ofertare_ingest_garda;
  -- 6. Postcondiție: niciun obiect cu numele patch-ului, în nicio schemă.
  v_n := (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relname IN ('ofertare_ingest_garda', 'ofertare_ingest_garda_pkey', 'ofertare_ingest_garda_blocat_idx'))
       + (SELECT count(*) FROM pg_catalog.pg_type t WHERE t.typname IN ('ofertare_ingest_garda', '_ofertare_ingest_garda'))
       + (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname IN ('ofertare_ingest_garda_notifica', 'ofertare_ingest_garda_incearca', 'ofertare_ingest_garda_rezultat', 'ofertare_ingest_garda_reactiveaza'))
       + (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polname = 'ofertare_ingest_garda_select')
       + (SELECT count(*) FROM pg_catalog.pg_constraint k WHERE left(k.conname, 21) = 'ofertare_ingest_garda');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'REVENIRE 20260930k, postcondiție: % obiecte cu numele patch-ului au rămas — se anulează tot', v_n;
  END IF;
  -- 7. Dezarmare.
  PERFORM set_config('gazpet.revenire_20260930k', '', true);
END $revenire_20260930k$;
