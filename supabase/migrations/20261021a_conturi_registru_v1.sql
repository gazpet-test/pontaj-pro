-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261021a — conturi_registru v1: registrul „unde intru și cu ce cont” (Administrativ → 🔐 Conturi, owner-only)
-- Spec: claude_docs.spec_conturi_registru (sesiunea de chat, decizia lui Răzvan 08.10.2026, varianta C „mic”).
-- Decizii Răzvan 08.10 (claude_context #1666): toți is_owner văd registrul; fără coloane pe locatii_*; seed separat.
--
-- Ce face:
--   - tabel public.conturi_registru: categorie → serviciu → utilizator/titular/cod client, personal/firmă, locații legate
--     (locatie_ids = id-uri din locatii_inchiriate, legătură logică, fără FK pe array), observații, activ.
--   - ȘTERGERE = DEZACTIVARE, impusă în BD (r2, Copilot P15-1): authenticated NU are DELETE și nu există politică de DELETE.
--   - FĂRĂ parole: nicio coloană de parolă; CHECK conturi_registru_fara_parole respinge tiparele evidente („parola: …”,
--     „?password=…”, „PIN-ul: …”) și în BD, nu doar în UI (r2, P15-4) — plasă, nu garanție.
--   - RLS doar owner (profiles.is_owner) pe SELECT/INSERT/UPDATE — NU auth.uid() IS NOT NULL: conținutul e privat.
--   - id = IDENTITY (r2, P15-2): authenticated nu are niciun drept pe secvență (nici last_value, nici nextval).
--   - drepturi explicite: anon nimic (default privileges de pe live i-ar da arwdxt), authenticated SELECT/INSERT/UPDATE
--     (filtrat de RLS), service_role tot.
--   - updated_at prin funcția existentă public.set_updated_at() (amprentă verificată, nu o atingem).
--   - CHECK-uri: categorie din listă; serviciu cu cel puțin o literă/cifră; url strict https?://<gazdă>[:port][/?#…] — gazda
--     doar litere/cifre/„.”/„-” (deci fără „@”, slash-uri în plus, backslash), portul doar cifre (r2 J16-2, r3 J17-3); lungimi;
--     locatie_ids fără NULL-uri și cel mult 20.
--   - AMPRENTA tabelului (coloane+tipuri+default-uri+ACL pe coloane, constrângeri, politici, trigger-ul complet
--     — pg_get_triggerdef, inclusiv WHEN —, indecși, drepturi pe tabel și secvență, proprietățile secvenței identity, owner,
--     RLS) se calculează la final și se scrie în COMMENT („amprenta=<md5>”); revenirea o recalculează și cere ca ea să fie
--     ȘI cea din COMMENT, ȘI una dintre amprentele fixate în fișierul de revenire (r2 P15-3/J16-4, r3 J17-1/P16-1/P16-2).
--   - UN SINGUR bloc DO (r2, J16-1): garda, precondițiile, DDL-ul și postcondițiile sunt o singură instrucțiune — o rulare
--     greșită cu `psql -f` simplu (autocommit, fără ON_ERROR_STOP) nu mai poate lăsa un tabel creat pe jumătate, cu
--     drepturile implicite permisive.
-- Ce NU face: niciun seed (datele lui Răzvan intră separat, DOAR după confirmarea lui — CLAUDE.md pct. 3), nicio funcție,
--   nicio modificare pe locatii_inchiriate / locatii_furnizori (acele tabele sunt citibile de orice utilizator logat).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261021a_conturi_registru_v1_ROLLBACK.sql. Harness: scripts/test_conturi_registru.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE
  v_amprenta text;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261021a_conturi_registru_v1:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261021a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.conturi_registru') IS NOT NULL OR to_regclass('public.conturi_registru_id_seq') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: public.conturi_registru (sau secvența ei) există deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
                  AND column_name = 'is_owner' AND data_type = 'boolean' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'Precondiție 0c: profiles.is_owner lipsește sau nu e boolean NOT NULL';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.set_updated_at()')) IS DISTINCT FROM '1c4318bee4240d4113d86fad7eb15623' THEN
    RAISE EXCEPTION 'Precondiție 0d: public.set_updated_at() lipsește sau diferă de forma live (md5 1c4318be…)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locatii_inchiriate'
                  AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION 'Precondiție 0e: locatii_inchiriate.id lipsește sau nu e bigint';
  END IF;
  IF has_schema_privilege('authenticated', 'public', 'CREATE') OR has_schema_privilege('anon', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0f: anon/authenticated au CREATE pe schema public';
  END IF;

  -- ── A. tabelul ────────────────────────────────────────────────────────────────────────────────────────
  CREATE TABLE public.conturi_registru (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    categorie   text NOT NULL CHECK (categorie IN ('utilitati','aplicatii','institutii','firma','retea','altele')),
    serviciu    text NOT NULL CHECK (serviciu ~ '[[:alnum:]]' AND char_length(serviciu) <= 200),
    url         text CHECK (url IS NULL OR (url ~* '^https?://[[:alnum:]]([[:alnum:].-]*[[:alnum:]])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
                                             AND strpos(url, chr(92)) = 0 AND char_length(url) <= 500)),
    utilizator  text CHECK (utilizator IS NULL OR char_length(utilizator) <= 200),
    titular     text CHECK (titular IS NULL OR char_length(titular) <= 200),
    cod_client  text CHECK (cod_client IS NULL OR char_length(cod_client) <= 100),
    personal    boolean NOT NULL DEFAULT false,
    locatie_ids bigint[] CHECK (locatie_ids IS NULL OR (array_position(locatie_ids, NULL) IS NULL AND cardinality(locatie_ids) <= 20)),
    observatii  text CHECK (observatii IS NULL OR char_length(observatii) <= 2000),
    activ       boolean NOT NULL DEFAULT true,
    created_by  uuid DEFAULT auth.uid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- aceeași plasă ca pareParola() din src/conturiUtil.js, PE FIECARE CÂMP (r3, J17-2: concatenarea fabrica tipare false,
    -- ex. serviciu „Proton Pass” + observații „Contact: IT” → „Pass Contact:”)
    CONSTRAINT conturi_registru_fara_parole CHECK (NOT (
         coalesce(serviciu, '')   ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'
      OR coalesce(url, '')        ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'
      OR coalesce(utilizator, '') ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'
      OR coalesce(titular, '')    ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'
      OR coalesce(cod_client, '') ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'
      OR coalesce(observatii, '') ~* '(^|[^[:alnum:]])(parol[[:alpha:]]*|passw(or)?d|pass|psw|pwd|pin(-?ul)?)([[:space:]]+[[:alpha:]]+)?[[:space:]]*[:=：]'))
  );
  COMMENT ON COLUMN public.conturi_registru.locatie_ids IS 'id-uri din locatii_inchiriate (legătură logică, validată în UI; fără FK pe array)';
  CREATE TRIGGER trg_conturi_registru_updated_at BEFORE UPDATE ON public.conturi_registru
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

  -- ── B. drepturi (explicite; default privileges de pe live ar da anon/authenticated arwdxt / rwU) ────────
  REVOKE ALL ON TABLE public.conturi_registru FROM PUBLIC, anon, authenticated;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.conturi_registru TO authenticated;
  GRANT ALL ON TABLE public.conturi_registru TO service_role;
  REVOKE ALL ON SEQUENCE public.conturi_registru_id_seq FROM PUBLIC, anon, authenticated;
  GRANT ALL ON SEQUENCE public.conturi_registru_id_seq TO service_role;

  -- ── C. RLS doar owner (fără DELETE) ───────────────────────────────────────────────────────────────────
  ALTER TABLE public.conturi_registru ENABLE ROW LEVEL SECURITY;
  CREATE POLICY conturi_registru_sel ON public.conturi_registru FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));
  CREATE POLICY conturi_registru_ins ON public.conturi_registru FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));
  CREATE POLICY conturi_registru_upd ON public.conturi_registru FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_registru'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 1: RLS nu e activ pe conturi_registru';
  END IF;
  IF (SELECT array_agg(policyname::text || ':' || cmd ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conturi_registru')
       IS DISTINCT FROM ARRAY['conturi_registru_ins:INSERT','conturi_registru_sel:SELECT','conturi_registru_upd:UPDATE']::text[]
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conturi_registru'
                 AND (roles <> '{authenticated}' OR permissive <> 'PERMISSIVE'
                      OR coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_owner%'
                      OR (qual IS NOT NULL AND qual NOT LIKE '%is_owner%')
                      OR (with_check IS NOT NULL AND with_check NOT LIKE '%is_owner%'))) THEN
    RAISE EXCEPTION 'Postcondiție 2: politicile nu sunt exact SELECT/INSERT/UPDATE owner-only pe authenticated (fără DELETE)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)
              WHERE has_table_privilege('anon', 'public.conturi_registru', p.n))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)
                 WHERE has_table_privilege('authenticated', 'public.conturi_registru', p.n))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r(n), unnest(ARRAY['USAGE','SELECT','UPDATE']) p(n)
                 WHERE has_sequence_privilege(r.n, 'public.conturi_registru_id_seq', p.n)) THEN
    RAISE EXCEPTION 'Postcondiție 3: anon are drepturi, authenticated are DELETE/TRUNCATE/… sau drepturi pe secvență';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.conturi_registru', 'SELECT') AND has_table_privilege('authenticated', 'public.conturi_registru', 'INSERT')
          AND has_table_privilege('authenticated', 'public.conturi_registru', 'UPDATE') AND has_table_privilege('service_role', 'public.conturi_registru', 'SELECT')) THEN
    RAISE EXCEPTION 'Postcondiție 4: authenticated/service_role nu au drepturile necesare';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conturi_registru'::regclass AND tgname = 'trg_conturi_registru_updated_at'
                  AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Postcondiție 5: trigger-ul updated_at lipsește';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.set_updated_at()'::regprocedure) IS DISTINCT FROM '1c4318bee4240d4113d86fad7eb15623' THEN
    RAISE EXCEPTION 'Postcondiție 6: set_updated_at() s-a schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conturi_registru) THEN
    RAISE EXCEPTION 'Postcondiție 7: tabelul trebuie să plece gol (seed-ul e separat, după confirmarea lui Răzvan)';
  END IF;
  IF (SELECT attidentity FROM pg_attribute WHERE attrelid = 'public.conturi_registru'::regclass AND attname = 'id') IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'Postcondiție 8: id nu e GENERATED ALWAYS AS IDENTITY';
  END IF;

  -- ── D. amprenta (aceeași expresie ca în revenire; COMMENT-ul nu intră în amprentă) ──────────────────────
  -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_conturi_registru.sh)
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY a.attnum)
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid = t.oid),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY p.polname)
         FROM pg_policy p WHERE p.polrelid = t.oid),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal),
      (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid))
         FROM pg_index i WHERE i.indrelid = t.oid),
      (SELECT string_agg(format('%s:%s:%s', r.n, p.n, has_table_privilege(r.n, t.oid, p.n)), ',' ORDER BY r.n, p.n)
         FROM unnest(ARRAY['anon','authenticated','service_role']) r(n),
              unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)),
      (SELECT string_agg(format('%s:%s:%s', r.n, p.n, has_sequence_privilege(r.n, 'public.conturi_registru_id_seq', p.n)), ',' ORDER BY r.n, p.n)
         FROM unnest(ARRAY['anon','authenticated','service_role']) r(n), unnest(ARRAY['USAGE','SELECT','UPDATE']) p(n)),
      (SELECT format('%s:%s:%s:%s:%s:%s:%s:%s', s.seqtypid::regtype, s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache,
                     s.seqcycle, pg_get_userbyid(sc.relowner))
         FROM pg_sequence s JOIN pg_class sc ON sc.oid = s.seqrelid WHERE s.seqrelid = 'public.conturi_registru_id_seq'::regclass),
      pg_get_userbyid(t.relowner), t.relrowsecurity, t.relforcerowsecurity))
    INTO v_amprenta
    FROM pg_class t WHERE t.oid = 'public.conturi_registru'::regclass;
  -- </amprenta>
  IF v_amprenta IS NULL OR v_amprenta !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Postcondiție 9: amprenta nu s-a putut calcula';
  END IF;
  EXECUTE format('COMMENT ON TABLE public.conturi_registru IS %L',
    'Registru conturi și accesuri (Administrativ → 🔐 Conturi). Owner-only (RLS). FĂRĂ parole — stau în managerul de parole. '
    || 'Ștergere = activ=false (fără DELETE). 20261021a. amprenta=' || v_amprenta);

  -- ── garda de livrare (final) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261021a_conturi_registru_v1:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261021a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
