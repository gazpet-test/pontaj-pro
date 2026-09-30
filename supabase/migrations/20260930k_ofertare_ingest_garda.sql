-- ════════════════════════════════════════════════════════════════════════════
-- 20260930k_ofertare_ingest_garda — DRAFT, NEAPLICAT. Runda 2 (NO-GO Copilot r1 pe #553).
-- Garda citirii automate Ofertare (docs/INGEST_GARDA.md) — condițiile de reluare după incidentul de egress 24–25.09.2026.
-- Contor PERSISTENT pe document: încercări eșuate (backoff exponențial, blocare la plafon), descărcări complete
-- (plafon ⇒ EGRESS MĂRGINIT: ≤ 80 descărcări/document între două reactivări, fiecare ≤ 60 MiB pe calea edge),
-- amprenta ultimei citiri încheiate (sha256 / mărime / etag) pentru scurtcircuit — după încheiere nu se mai descarcă.
-- Runda 2: LEASE + TOKEN de încercare persistent (incercare_token, in_curs_pana; 10 min): _incearca acordă atomic un token
-- nou doar dacă nu există lease neexpirat (altfel „in_curs”, fără descărcare); _rezultat acceptă DOAR tokenul memorat
-- (vechi/străin ⇒ ignorat, numărat în rezultate_respinse și raportat în răspuns) și eliberează lease-ul. Un lease expirat
-- fără rezultat = încercare abandonată ⇒ următorul _incearca o închide ca eșec (backoff socotit de la expirare).
-- Blocarea se scoate DOAR de om (owner), cu ofertare_ingest_garda_reactiveaza.
-- Constantele oglindesc GARDA din supabase/functions/_shared/gardaIngestLogica.ts (5 eșecuri, 60 s × 2^(n−1) ≤ 6 h,
-- 80 descărcări, lease 10 min).
--
-- LIVRARE: doar prin scripts/livrare_migrare.sh (psql --single-transaction; garda gazpet.livrare_migrare legată de txid la
--   start și la final; fișierul NU conține BEGIN/COMMIT). apply_migration / execute_sql / psql -f simplu sunt refuzate.
-- Precondiții (fail-closed): rolul postgres; TOATE obiectele noi ABSENTE (în orice schemă) — dacă starea e exact cea a
--   patch-ului ⇒ REFUZ „deja aplicat”, dacă doar o parte ⇒ REFUZ „stare parțială”; dependențele: ofertare_documente_atribuire
--   (id bigint cheie, status_procesare text), auth.users(id uuid), auth.uid(), profiles(id, is_owner boolean), coloanele
--   notifications folosite, fn_are_acces_ofertare() cu amprenta exactă citită pe 30.09 (aceeași ca în 20261004b) și fără overload.
-- ACL (independent de ordinea față de SEC F1 #551, care retrage TRUNCATE global): tabelul pornește din setările implicite
--   (arwdDxtm sau, după F1, fără TRUNCATE) și se aduce EXPLICIT la aceeași stare finală: REVOKE ALL de la PUBLIC, anon,
--   authenticated; SELECT doar pentru authenticated (RLS: fn_are_acces_ofertare()); ALL pentru service_role; fără politici
--   de scriere (scrierea doar prin RPC-urile SECURITY DEFINER de mai jos). Funcțiile: REVOKE ALL de la PUBLIC, anon,
--   authenticated, service_role, apoi EXECUTE exact: _incearca/_rezultat → service_role; _reactiveaza → authenticated
--   (verifică owner în corp); _notifica → nimeni (internă).
-- Postcondiții (înainte de COMMIT-ul runnerului; orice abatere anulează tot): amprenta EXACTĂ a patch-ului (structură, index,
--   constrângeri, RLS, politică, ACL tabel, 0 ACL pe coloane, 0 triggere, md5 corpuri + SECDEF + search_path + ACL EXECUTE pe
--   cele 4 funcții); explicit: anon 0 din 8 privilegii (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
--   MAINTAIN) și 0 pe coloane, authenticated EXACT SELECT fără grant option, PUBLIC absent din ACL-ul brut, service_role 8/8;
--   EXECUTE efectiv pe funcții; amprenta helper-ului reverificată.
-- Revenire (NU e migrare): supabase/revenire/20260930k_ofertare_ingest_garda_ROLLBACK.sql — armare proprie, pornește
--   doar din amprenta exactă a patch-ului. Test: node scripts/test_ingest_garda.mjs (PG17 local).
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930k_ofertare_ingest_garda:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20260930k_ofertare_ingest_garda se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare, start)' USING ERRCODE = '42501';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții — fail-closed
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  -- amprenta obiectelor patch-ului (IDENTICĂ în postcondiție și în revenire — testul verifică textul)
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
                   OR (d.classoid = 'pg_catalog.pg_policy'::regclass AND d.objoid IN (SELECT p.oid FROM pg_catalog.pg_policy p WHERE p.polrelid = to_regclass('public.ofertare_ingest_garda')))
                   OR (d.classoid = 'pg_catalog.pg_class'::regclass AND d.objoid IN (SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = to_regclass('public.ofertare_ingest_garda')))),
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
  v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'REFUZ 20260930k: rulează ca postgres (current_user = %) — amprenta cere proprietarul postgres', current_user;
  END IF;
  -- 0a. obiectele noi: toate ABSENTE, în orice schemă (tabel/index/tip, funcții cu oricare semnătură, politică, constrângeri)
  v_n := (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relname IN ('ofertare_ingest_garda', 'ofertare_ingest_garda_pkey', 'ofertare_ingest_garda_blocat_idx'))
       + (SELECT count(*) FROM pg_catalog.pg_type t WHERE t.typname IN ('ofertare_ingest_garda', '_ofertare_ingest_garda'))
       + (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname IN ('ofertare_ingest_garda_notifica', 'ofertare_ingest_garda_incearca', 'ofertare_ingest_garda_rezultat', 'ofertare_ingest_garda_reactiveaza'))
       + (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polname = 'ofertare_ingest_garda_select')
       + (SELECT count(*) FROM pg_catalog.pg_constraint k WHERE left(k.conname, 21) = 'ofertare_ingest_garda');
  IF v_n IS DISTINCT FROM 0 THEN
    EXECUTE v_q INTO v_gasit;
    IF v_gasit = v_asteptat THEN
      RAISE EXCEPTION 'REFUZ 20260930k: deja aplicat (amprenta exactă a patch-ului e prezentă) — nu se reaplică';
    END IF;
    RAISE EXCEPTION 'REFUZ 20260930k: stare parțială/străină — % obiecte cu numele patch-ului există, dar amprenta diferă: %', v_n, v_gasit;
  END IF;
  -- 0b. dependențe: ofertare_documente_atribuire(id bigint, cheie primară/unică pe (id); status_procesare text)
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.ofertare_documente_atribuire')
        AND a.attname = 'id' AND a.atttypid = 'bigint'::regtype AND NOT a.attisdropped) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = to_regclass('public.ofertare_documente_atribuire')
        AND k.contype IN ('p', 'u') AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = to_regclass('public.ofertare_documente_atribuire') AND a.attname = 'id')]::int2[])
     OR (SELECT a.atttypid FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.ofertare_documente_atribuire')
        AND a.attname = 'status_procesare' AND NOT a.attisdropped) IS DISTINCT FROM 'text'::regtype THEN
    RAISE EXCEPTION 'REFUZ 20260930k: public.ofertare_documente_atribuire lipsește sau diferă (id bigint cheie, status_procesare text)';
  END IF;
  -- 0c. auth.users(id uuid cheie), auth.uid() → uuid; profiles(id uuid, is_owner boolean); coloanele notifications folosite
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('auth.users') AND a.attname = 'id'
        AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = to_regclass('auth.users') AND k.contype IN ('p', 'u')
        AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('auth.users') AND a.attname = 'id')]::int2[])
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT p.prorettype FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype
     OR (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.profiles') AND NOT a.attisdropped
        AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype) OR (a.attname = 'is_owner' AND a.atttypid = 'boolean'::regtype))) IS DISTINCT FROM 2
     OR (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.notifications') AND NOT a.attisdropped
        AND a.attname IN ('profile_id', 'type', 'modul', 'title', 'message', 'link_to')) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'REFUZ 20260930k: dependențe lipsă/diferite (auth.users.id uuid cheie, auth.uid() uuid, profiles.id/is_owner, notifications: profile_id/type/modul/title/message/link_to)';
  END IF;
  -- 0d. fn_are_acces_ofertare() — amprenta EXACTĂ citită pe 30.09 (identică cu precondiția din 20261004b), fără overload
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text = 'fn_are_acces_ofertare()' AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.prokind = 'f' AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'REFUZ 20260930k: fn_are_acces_ofertare() lipsește sau diferă de amprenta citită pe 30.09 (postgres, sql, search_path=public, pg_temp, boolean, SECDEF, STABLE, md5 429d28e2a61fb24c8009d67050c16c85, EXECUTE doar authenticated/service_role)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION 'REFUZ 20260930k: există alt overload fn_are_acces_ofertare (în orice schemă) — politica ar putea fi deturnată';
  END IF;
  -- 0d'. coloanele documentului pe care _rezultat le poate scrie atomic (runda 3, J2) — toate trebuie să existe
  -- runda 4: nume ȘI tip (citite read-only pe live de Claude, 01.10.2026)
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.ofertare_documente_atribuire') AND NOT a.attisdropped
        AND (a.attname, format_type(a.atttypid, a.atttypmod)) IN (('text_extras', 'text'), ('pagini', 'integer'), ('size_bytes', 'bigint'),
          ('pagini_procesate', 'integer'), ('pagini_felie', 'integer'), ('pagini_necitite', 'integer[]'), ('status_procesare', 'text'),
          ('eroare', 'text'), ('antet', 'jsonb'), ('revizie', 'text'), ('ocr', 'boolean'), ('procesat_la', 'timestamp with time zone'),
          ('procesat_de', 'uuid'))) IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION 'REFUZ 20260930k: ofertare_documente_atribuire nu are toate cele 13 coloane scrise prin _rezultat, cu tipurile așteptate';
  END IF;
  -- 0e. rolurile și gen_random_uuid()
  IF (SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')) IS DISTINCT FROM 3
     OR to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'REFUZ 20260930k: lipsesc rolurile anon/authenticated/service_role sau pg_catalog.gen_random_uuid()';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Tabelul + index + RLS + ACL explicit (aceeași stare finală înainte sau după F1)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ofertare_ingest_garda (
  doc_id              bigint PRIMARY KEY REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  incercari_esuate    integer NOT NULL DEFAULT 0 CHECK (incercari_esuate >= 0),
  descarcari          integer NOT NULL DEFAULT 0 CHECK (descarcari >= 0),
  blocat              boolean NOT NULL DEFAULT false,
  blocat_motiv        text,
  blocat_la           timestamptz,
  urmatoarea_dupa     timestamptz,
  incercare_token     uuid,
  in_curs_pana        timestamptz,
  rezultate_respinse  integer NOT NULL DEFAULT 0 CHECK (rezultate_respinse >= 0),
  ultima_incercare_la timestamptz,
  ultima_sursa        text,
  ultima_eroare       text,
  ingerat_hash        text,
  ingerat_size        bigint,
  ingerat_etag        text,
  ingerat_la          timestamptz,
  reactivat_de        uuid REFERENCES auth.users(id),
  reactivat_la        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_ingest_garda_lease_ck CHECK ((incercare_token IS NULL) = (in_curs_pana IS NULL))
);
CREATE INDEX ofertare_ingest_garda_blocat_idx ON public.ofertare_ingest_garda (blocat) WHERE blocat;

ALTER TABLE public.ofertare_ingest_garda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ofertare_ingest_garda FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ofertare_ingest_garda TO authenticated;
GRANT ALL ON TABLE public.ofertare_ingest_garda TO service_role;
CREATE POLICY ofertare_ingest_garda_select ON public.ofertare_ingest_garda FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
-- fără politici de scriere: scrierea doar prin funcțiile de mai jos (SECURITY DEFINER, proprietar postgres)

-- ---------------------------------------------------------------------------
-- 2. Funcțiile
-- ---------------------------------------------------------------------------
-- Notificare owner-i (fără dependență de monitorul de egress, care poate să nu fie aplicat). Internă: fără EXECUTE pentru nimeni.
CREATE FUNCTION public.ofertare_ingest_garda_notifica(p_doc_id bigint, p_motiv text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE n integer;
BEGIN
  INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
  SELECT p.id, 'ingest_blocat', 'Ofertare', 'Ofertare: citirea automată a unui document a fost BLOCATĂ',
         format('Documentul #%s: %s. Reactivare doar manuală, după verificare.', p_doc_id, left(coalesce(p_motiv, '?'), 300)), '/ofertare'
  FROM profiles p WHERE p.is_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.ofertare_ingest_garda_notifica(bigint, text) FROM PUBLIC, anon, authenticated, service_role;

-- RPC 1 — ÎNAINTE de descărcare. Atomic (rândul documentului sub FOR UPDATE). Întoarce
-- {actiune: blocat|in_curs|asteapta|deja_ingerat|continua, motiv, pana_la, token, descarcari, incercari_esuate, ingerat_hash}.
-- 'continua' = token NOU + lease 10 min + descărcarea numărată; 'in_curs' = altă încercare deține lease-ul (fără descărcare).
CREATE FUNCTION public.ofertare_ingest_garda_incearca(p_doc_id bigint, p_size bigint, p_etag text, p_sursa text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  g ofertare_ingest_garda;
  v_st text;
  v_n integer;
  v_motiv text;
  MAX_INC CONSTANT integer := 5;
  MAX_DL CONSTANT integer := 80;
  LEASE CONSTANT interval := interval '10 minutes';
BEGIN
  INSERT INTO ofertare_ingest_garda (doc_id) VALUES (p_doc_id) ON CONFLICT (doc_id) DO NOTHING;
  SELECT * INTO g FROM ofertare_ingest_garda WHERE doc_id = p_doc_id FOR UPDATE;
  SELECT status_procesare INTO v_st FROM ofertare_documente_atribuire WHERE id = p_doc_id;
  IF g.blocat THEN RETURN jsonb_build_object('actiune', 'blocat', 'motiv', coalesce(g.blocat_motiv, 'blocat')); END IF;
  -- (a) lease activ: o singură încercare pe document — fără descărcare, fără numărare
  IF g.incercare_token IS NOT NULL AND g.in_curs_pana > now() THEN
    RETURN jsonb_build_object('actiune', 'in_curs', 'motiv', format('altă încercare (%s) lucrează pe document', coalesce(g.ultima_sursa, '?')),
      'pana_la', g.in_curs_pana);
  END IF;
  -- (b) lease expirat fără rezultat = încercare ABANDONATĂ (proces oprit, rezultat pierdut) ⇒ eșec; backoff de la expirare
  IF g.incercare_token IS NOT NULL THEN
    v_n := g.incercari_esuate + 1;
    UPDATE ofertare_ingest_garda SET incercari_esuate = v_n, incercare_token = NULL, in_curs_pana = NULL, updated_at = now(),
      ultima_eroare = format('încercare abandonată: lease expirat la %s fără rezultat (sursa %s)', g.in_curs_pana, coalesce(g.ultima_sursa, '?')),
      urmatoarea_dupa = g.in_curs_pana + make_interval(secs => least(21600, 60 * power(2, v_n - 1)))
    WHERE doc_id = p_doc_id RETURNING * INTO g;
  END IF;
  IF g.descarcari >= MAX_DL OR g.incercari_esuate >= MAX_INC THEN
    v_motiv := CASE WHEN g.descarcari >= MAX_DL THEN format('plafon de descărcări atins (%s/%s)', g.descarcari, MAX_DL)
                    ELSE format('plafon de încercări eșuate atins (%s/%s); ultima: %s', g.incercari_esuate, MAX_INC, left(coalesce(g.ultima_eroare, '?'), 200)) END;
    UPDATE ofertare_ingest_garda SET blocat = true, blocat_motiv = v_motiv, blocat_la = now(), updated_at = now() WHERE doc_id = p_doc_id;
    PERFORM ofertare_ingest_garda_notifica(p_doc_id, v_motiv);
    RETURN jsonb_build_object('actiune', 'blocat', 'motiv', v_motiv);
  END IF;
  IF g.urmatoarea_dupa IS NOT NULL AND g.urmatoarea_dupa > now() THEN
    RETURN jsonb_build_object('actiune', 'asteapta', 'motiv', 'backoff după eșec', 'pana_la', g.urmatoarea_dupa);
  END IF;
  IF v_st IN ('procesat', 'partial') AND p_size IS NOT NULL AND g.ingerat_size = p_size
     AND p_etag IS NOT NULL AND g.ingerat_etag IS NOT NULL
     AND replace(replace(p_etag, 'W/', ''), '"', '') = replace(replace(g.ingerat_etag, 'W/', ''), '"', '') THEN
    RETURN jsonb_build_object('actiune', 'deja_ingerat', 'motiv', 'același fișier (mărime + etag) a fost deja citit');
  END IF;
  UPDATE ofertare_ingest_garda SET descarcari = descarcari + 1, incercare_token = gen_random_uuid(), in_curs_pana = now() + LEASE,
    ultima_incercare_la = now(), ultima_sursa = left(p_sursa, 100), updated_at = now()
  WHERE doc_id = p_doc_id RETURNING * INTO g;
  RETURN jsonb_build_object('actiune', 'continua', 'token', g.incercare_token, 'pana_la', g.in_curs_pana,
    'descarcari', g.descarcari, 'incercari_esuate', g.incercari_esuate, 'ingerat_hash', g.ingerat_hash);
END $f$;
REVOKE ALL ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) TO service_role;

-- RPC 2 — închide încercarea p_token (EXACT o dată). Doar tokenul memorat e acceptat; vechi/străin/NULL ⇒ ignorat (starea
-- neatinsă, în afară de contorul rezultate_respinse) și raportat {acceptat:false, motiv}. Tokenul memorat e acceptat și după
-- expirarea lease-ului, cât timp nicio altă încercare nu l-a preluat (preluarea îl închide ca abandonat și îl înlocuiește).
-- p_rezultat: succes (încheiat: eșecuri 0 + amprenta) | progres (felie: eșecuri 0) | predat (NAS → edge/citire_mare:
-- contoarele neatinse) | esec (eșecuri +1, backoff 60 s × 2^(n−1) ≤ 6 h). Blocare + notificare owner la plafon.
CREATE FUNCTION public.ofertare_ingest_garda_rezultat(p_doc_id bigint, p_token uuid, p_rezultat text,
  p_hash text, p_size bigint, p_etag text, p_eroare text, p_doc jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  g ofertare_ingest_garda;
  v_motiv text;
  MAX_INC CONSTANT integer := 5;
  MAX_DL CONSTANT integer := 80;
BEGIN
  IF p_rezultat IS NULL OR p_rezultat NOT IN ('succes', 'progres', 'predat', 'esec', 'marcaj') THEN
    RAISE EXCEPTION 'garda: rezultat necunoscut „%” (succes|progres|predat|esec|marcaj)', coalesce(p_rezultat, '<null>');
  END IF;
  IF p_doc IS NOT NULL AND (jsonb_typeof(p_doc) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_doc) k WHERE k NOT IN ('text_extras', 'pagini',
       'size_bytes', 'pagini_procesate', 'pagini_felie', 'pagini_necitite', 'status_procesare', 'eroare', 'antet', 'revizie', 'ocr', 'procesat_la', 'procesat_de'))) THEN
    RAISE EXCEPTION 'garda: p_doc conține coloane nepermise';
  END IF;
  SELECT * INTO g FROM ofertare_ingest_garda WHERE doc_id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('acceptat', false, 'motiv', 'nicio încercare pe document');
  END IF;
  IF p_token IS NULL OR g.incercare_token IS DISTINCT FROM p_token THEN
    UPDATE ofertare_ingest_garda SET rezultate_respinse = rezultate_respinse + 1, updated_at = now() WHERE doc_id = p_doc_id;
    RETURN jsonb_build_object('acceptat', false, 'rezultate_respinse', g.rezultate_respinse + 1,
      'motiv', CASE WHEN g.incercare_token IS NULL THEN 'token vechi: încercarea nu mai e deschisă (închisă deja sau preluată ca abandonată)'
                    ELSE 'token străin: altă încercare deține lease-ul' END);
  END IF;
  -- token ACTIV: scrierea documentului (dacă există) în ACEEAȘI tranzacție cu verificarea tokenului (rândul gărzii e blocat
  -- FOR UPDATE, deci nicio preluare nu se poate strecura între verificare și scriere)
  IF p_doc IS NOT NULL THEN
    UPDATE ofertare_documente_atribuire d SET
      text_extras      = CASE WHEN p_doc ? 'text_extras' THEN r.text_extras ELSE d.text_extras END,
      pagini           = CASE WHEN p_doc ? 'pagini' THEN r.pagini ELSE d.pagini END,
      size_bytes       = CASE WHEN p_doc ? 'size_bytes' THEN r.size_bytes ELSE d.size_bytes END,
      pagini_procesate = CASE WHEN p_doc ? 'pagini_procesate' THEN r.pagini_procesate ELSE d.pagini_procesate END,
      pagini_felie     = CASE WHEN p_doc ? 'pagini_felie' THEN r.pagini_felie ELSE d.pagini_felie END,
      pagini_necitite  = CASE WHEN p_doc ? 'pagini_necitite' THEN r.pagini_necitite ELSE d.pagini_necitite END,
      status_procesare = CASE WHEN p_doc ? 'status_procesare' THEN r.status_procesare ELSE d.status_procesare END,
      eroare           = CASE WHEN p_doc ? 'eroare' THEN r.eroare ELSE d.eroare END,
      antet            = CASE WHEN p_doc ? 'antet' THEN r.antet ELSE d.antet END,
      revizie          = CASE WHEN p_doc ? 'revizie' THEN r.revizie ELSE d.revizie END,
      ocr              = CASE WHEN p_doc ? 'ocr' THEN r.ocr ELSE d.ocr END,
      procesat_la      = CASE WHEN p_doc ? 'procesat_la' THEN r.procesat_la ELSE d.procesat_la END,
      procesat_de      = CASE WHEN p_doc ? 'procesat_de' THEN r.procesat_de ELSE d.procesat_de END
    FROM jsonb_populate_record(NULL::ofertare_documente_atribuire, p_doc) r
    WHERE d.id = p_doc_id;
  END IF;
  -- marcaj = scriere intermediară (ex. in_lucru) + prelungirea lease-ului; încercarea rămâne deschisă
  IF p_rezultat = 'marcaj' THEN
    UPDATE ofertare_ingest_garda SET in_curs_pana = now() + interval '10 minutes', updated_at = now() WHERE doc_id = p_doc_id RETURNING * INTO g;
    RETURN jsonb_build_object('acceptat', true, 'pana_la', g.in_curs_pana);
  END IF;
  UPDATE ofertare_ingest_garda SET incercare_token = NULL, in_curs_pana = NULL, updated_at = now(),
    incercari_esuate = CASE p_rezultat WHEN 'esec' THEN incercari_esuate + 1 WHEN 'predat' THEN incercari_esuate ELSE 0 END,
    urmatoarea_dupa  = CASE p_rezultat WHEN 'esec' THEN now() + make_interval(secs => least(21600, 60 * power(2, incercari_esuate)))
                                       WHEN 'predat' THEN urmatoarea_dupa ELSE NULL END,
    ultima_eroare    = CASE p_rezultat WHEN 'esec' THEN left(p_eroare, 500) WHEN 'predat' THEN ultima_eroare ELSE NULL END,
    ingerat_hash     = CASE WHEN p_rezultat = 'succes' THEN coalesce(p_hash, ingerat_hash) ELSE ingerat_hash END,
    ingerat_size     = CASE WHEN p_rezultat = 'succes' THEN coalesce(p_size, ingerat_size) ELSE ingerat_size END,
    ingerat_etag     = CASE WHEN p_rezultat = 'succes' THEN coalesce(p_etag, ingerat_etag) ELSE ingerat_etag END,
    ingerat_la       = CASE WHEN p_rezultat = 'succes' THEN now() ELSE ingerat_la END
  WHERE doc_id = p_doc_id RETURNING * INTO g;
  IF NOT g.blocat AND (g.incercari_esuate >= MAX_INC OR g.descarcari >= MAX_DL) THEN
    v_motiv := CASE WHEN g.incercari_esuate >= MAX_INC THEN format('%s încercări eșuate consecutive; ultima: %s', g.incercari_esuate, left(coalesce(p_eroare, '?'), 200))
                    ELSE format('plafon de descărcări atins (%s/%s)', g.descarcari, MAX_DL) END;
    UPDATE ofertare_ingest_garda SET blocat = true, blocat_motiv = v_motiv, blocat_la = now() WHERE doc_id = p_doc_id;
    PERFORM ofertare_ingest_garda_notifica(p_doc_id, v_motiv);
    RETURN jsonb_build_object('acceptat', true, 'blocat', true, 'motiv', v_motiv);
  END IF;
  RETURN jsonb_build_object('acceptat', true, 'blocat', g.blocat, 'incercari_esuate', g.incercari_esuate, 'urmatoarea_dupa', g.urmatoarea_dupa);
END $f$;
REVOKE ALL ON FUNCTION public.ofertare_ingest_garda_rezultat(bigint, uuid, text, text, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_rezultat(bigint, uuid, text, text, bigint, text, text, jsonb) TO service_role;

-- RPC 3 — reactivare UMANĂ, doar owner, doar pe un document BLOCAT. Resetează contoarele (nu și amprenta citirii).
CREATE FUNCTION public.ofertare_ingest_garda_reactiveaza(p_doc_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_owner) THEN
    RAISE EXCEPTION 'doar ownerul reactivează citirea automată a unui document blocat';
  END IF;
  UPDATE ofertare_ingest_garda SET blocat = false, blocat_motiv = NULL, incercari_esuate = 0, descarcari = 0,
    urmatoarea_dupa = NULL, reactivat_de = auth.uid(), reactivat_la = now(), updated_at = now()
  WHERE doc_id = p_doc_id AND blocat;   -- runda 3: pe un document neblocat NU resetează nimic (întoarce false)
  RETURN FOUND;
END $f$;
REVOKE ALL ON FUNCTION public.ofertare_ingest_garda_reactiveaza(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_reactiveaza(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Postcondiții — înainte de înregistrare și de COMMIT-ul runnerului (orice abatere anulează tot)
-- ---------------------------------------------------------------------------
DO $post$
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
                   OR (d.classoid = 'pg_catalog.pg_policy'::regclass AND d.objoid IN (SELECT p.oid FROM pg_catalog.pg_policy p WHERE p.polrelid = to_regclass('public.ofertare_ingest_garda')))
                   OR (d.classoid = 'pg_catalog.pg_class'::regclass AND d.objoid IN (SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = to_regclass('public.ofertare_ingest_garda')))),
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
  v_t CONSTANT regclass := to_regclass('public.ofertare_ingest_garda');
  v_n integer;
  v_k text;
BEGIN
  -- 3a. amprenta EXACTĂ a patch-ului (structură, index, constrângeri, RLS, politică, ACL tabel/coloane, funcții)
  EXECUTE v_q INTO v_gasit;
  IF v_gasit IS DISTINCT FROM v_asteptat THEN
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_k FROM jsonb_object_keys(v_asteptat) k WHERE v_gasit -> k IS DISTINCT FROM v_asteptat -> k;
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: amprenta diferă de a patch-ului la: % — găsit: %', coalesce(v_k, '?'), v_gasit;
  END IF;
  -- 3b. ACL-ul tabelului, explicit (efectiv: include PUBLIC și moștenirea): anon 0 din 8; authenticated EXACT SELECT fără
  --     grant option; service_role 8 din 8; PUBLIC absent din ACL-ul brut; 0 ACL pe coloane; anon fără privilegii pe coloane
  SELECT count(*) INTO v_n FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
   WHERE has_table_privilege('anon', v_t, pr);
  IF v_n IS DISTINCT FROM 0 OR has_any_column_privilege('anon', v_t, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: anon are % din 8 privilegii pe tabel (sau pe coloane) — așteptat 0', v_n;
  END IF;
  IF (SELECT string_agg(pr, ',' ORDER BY pr) FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
       WHERE has_table_privilege('authenticated', v_t, pr)) IS DISTINCT FROM 'SELECT'
     OR has_table_privilege('authenticated', v_t, 'SELECT WITH GRANT OPTION')
     OR (SELECT string_agg(x.privilege_type || ':' || x.is_grantable::text, ',') FROM pg_catalog.pg_class c, aclexplode(c.relacl) x
          WHERE c.oid = v_t AND x.grantee = 'authenticated'::regrole) IS DISTINCT FROM 'SELECT:false' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: authenticated nu are EXACT SELECT (fără grant option) pe tabel';
  END IF;
  SELECT count(*) INTO v_n FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
   WHERE has_table_privilege('service_role', v_t, pr);
  IF v_n IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: service_role are % din 8 privilegii — așteptat 8', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.oid = v_t AND x.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: PUBLIC apare în ACL-ul brut al tabelului sau există ACL pe coloane';
  END IF;
  -- 3c. RLS pornit + exact o politică (SELECT, authenticated)
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_t)
     OR (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = v_t) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: RLS oprit sau alt număr de politici decât 1';
  END IF;
  -- 3d. EXECUTE efectiv pe funcții: anon nimic; authenticated doar _reactiveaza; service_role doar _incearca/_rezultat;
  --     toate SECURITY DEFINER cu search_path=public, pg_temp, proprietar postgres, fără PUBLIC în ACL
  IF (SELECT string_agg(format('%s:%s%s%s', p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')::int,
            has_function_privilege('authenticated', p.oid, 'EXECUTE')::int, has_function_privilege('service_role', p.oid, 'EXECUTE')::int), ',' ORDER BY p.proname)
        FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
         AND pg_get_userbyid(p.proowner) = 'postgres' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)
         AND p.proname = ANY (ARRAY['ofertare_ingest_garda_notifica', 'ofertare_ingest_garda_incearca', 'ofertare_ingest_garda_rezultat', 'ofertare_ingest_garda_reactiveaza']))
     IS DISTINCT FROM 'ofertare_ingest_garda_incearca:001,ofertare_ingest_garda_notifica:000,ofertare_ingest_garda_reactiveaza:010,ofertare_ingest_garda_rezultat:001' THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: funcțiile gărzii nu au SECDEF/search_path/proprietar/EXECUTE exact (anon/authenticated/service_role)';
  END IF;
  -- 3e. amprenta helper-ului reverificată la final (drift concurent → fail-closed)
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text = 'fn_are_acces_ofertare()' AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.prokind = 'f' AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20260930k: fn_are_acces_ofertare() nu mai are amprenta exactă (sau a apărut un overload)';
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930k_ofertare_ingest_garda:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20260930k_ofertare_ingest_garda — garda de livrare (final): marcajul s-a pierdut în timpul migrării; se anulează tot' USING ERRCODE = '42501';
  END IF;
END $livrare_final$;
