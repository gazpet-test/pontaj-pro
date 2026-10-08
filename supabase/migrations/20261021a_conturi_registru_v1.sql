-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261021a — conturi_registru v1: registrul „unde intru și cu ce cont” (Administrativ → 🔐 Conturi, owner-only)
-- Spec: claude_docs.spec_conturi_registru (sesiunea de chat, decizia lui Răzvan 08.10.2026, varianta C „mic”).
--
-- Ce face:
--   - tabel public.conturi_registru: categorie → serviciu → utilizator/titular/cod client, personal/firmă, locații legate
--     (locatie_ids = id-uri din locatii_inchiriate, legătură logică, fără FK pe array), observații, activ (ștergere = activ=false).
--   - FĂRĂ parole: nicio coloană de parolă; parolele stau în managerul de parole.
--   - RLS doar owner (profiles.is_owner) pe SELECT/INSERT/UPDATE/DELETE — NU auth.uid() IS NOT NULL: conținutul e privat.
--   - drepturi explicite: anon nimic (default privileges de pe live i-ar da arwdxt), authenticated SELECT/INSERT/UPDATE/DELETE
--     (filtrat de RLS), service_role tot; secvența doar authenticated + service_role.
--   - updated_at prin funcția existentă public.set_updated_at() (amprentă verificată, nu o atingem).
--   - CHECK-uri: categorie din listă, serviciu cu cel puțin o literă/cifră (nu doar spații, tab-uri, NBSP), url doar http(s)
--     fără utilizator/parolă în link (https://user:parola@…), lungimi rezonabile, locatie_ids fără NULL-uri și cel mult 20.
-- Ce NU face: niciun seed (datele lui Răzvan intră separat, DOAR după confirmarea lui — CLAUDE.md pct. 3), nicio funcție,
--   nicio modificare pe locatii_inchiriate / locatii_furnizori (opționalul B din spec e lăsat pe dinafară: acele tabele sunt
--   citibile de orice utilizator logat — RLS auth.uid() IS NOT NULL —, deci un cont de portal pus acolo ar ieși din „owner-only”).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261021a_conturi_registru_v1_ROLLBACK.sql. Harness: scripts/test_conturi_registru.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261021a_conturi_registru_v1:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261021a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
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
END
$pre$;

-- ── A. tabelul ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.conturi_registru (
  id          bigserial PRIMARY KEY,
  categorie   text NOT NULL CHECK (categorie IN ('utilitati','aplicatii','institutii','firma','retea','altele')),
  serviciu    text NOT NULL CHECK (serviciu ~ '[[:alnum:]]' AND char_length(serviciu) <= 200),
  url         text CHECK (url IS NULL OR (url ~* '^https?://[^[:space:]]+$' AND url !~ '^[^/]*//[^/?#]*@' AND char_length(url) <= 500)),
  utilizator  text CHECK (utilizator IS NULL OR char_length(utilizator) <= 200),
  titular     text CHECK (titular IS NULL OR char_length(titular) <= 200),
  cod_client  text CHECK (cod_client IS NULL OR char_length(cod_client) <= 100),
  personal    boolean NOT NULL DEFAULT false,
  locatie_ids bigint[] CHECK (locatie_ids IS NULL OR (array_position(locatie_ids, NULL) IS NULL AND cardinality(locatie_ids) <= 20)),
  observatii  text CHECK (observatii IS NULL OR char_length(observatii) <= 2000),
  activ       boolean NOT NULL DEFAULT true,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.conturi_registru IS
  'Registru conturi și accesuri (Administrativ → 🔐 Conturi). Owner-only (RLS). FĂRĂ parole — stau în managerul de parole. Ștergere = activ=false. 20261021a.';
COMMENT ON COLUMN public.conturi_registru.locatie_ids IS 'id-uri din locatii_inchiriate (legătură logică, validată în UI; fără FK pe array)';

CREATE TRIGGER trg_conturi_registru_updated_at BEFORE UPDATE ON public.conturi_registru
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── B. drepturi (explicite; default privileges de pe live ar da anon/authenticated arwdxt) ──────────────
REVOKE ALL ON TABLE public.conturi_registru FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conturi_registru TO authenticated;
GRANT ALL ON TABLE public.conturi_registru TO service_role;
REVOKE ALL ON SEQUENCE public.conturi_registru_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.conturi_registru_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.conturi_registru_id_seq TO service_role;

-- ── C. RLS doar owner ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.conturi_registru ENABLE ROW LEVEL SECURITY;
CREATE POLICY conturi_registru_sel ON public.conturi_registru FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));
CREATE POLICY conturi_registru_ins ON public.conturi_registru FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));
CREATE POLICY conturi_registru_upd ON public.conturi_registru FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));
CREATE POLICY conturi_registru_del ON public.conturi_registru FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner));

-- ── postcondiții ────────────────────────────────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_registru'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 1: RLS nu e activ pe conturi_registru';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conturi_registru') <> 4
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conturi_registru'
                 AND (roles <> '{authenticated}' OR permissive <> 'PERMISSIVE'
                      OR coalesce(qual, with_check) NOT LIKE '%is_owner%'
                      OR (with_check IS NOT NULL AND with_check NOT LIKE '%is_owner%'))) THEN
    RAISE EXCEPTION 'Postcondiție 2: politicile nu sunt exact cele 4 owner-only pe authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.conturi_registru', 'SELECT') OR has_table_privilege('anon', 'public.conturi_registru', 'INSERT')
     OR has_table_privilege('anon', 'public.conturi_registru', 'UPDATE') OR has_table_privilege('anon', 'public.conturi_registru', 'DELETE')
     OR has_table_privilege('anon', 'public.conturi_registru', 'TRUNCATE') OR has_table_privilege('authenticated', 'public.conturi_registru', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.conturi_registru', 'TRIGGER') OR has_table_privilege('authenticated', 'public.conturi_registru', 'REFERENCES')
     OR has_sequence_privilege('anon', 'public.conturi_registru_id_seq', 'USAGE') OR has_sequence_privilege('authenticated', 'public.conturi_registru_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Postcondiție 3: anon are drepturi sau authenticated are mai mult decât SELECT/INSERT/UPDATE/DELETE';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.conturi_registru', 'SELECT') AND has_table_privilege('authenticated', 'public.conturi_registru', 'INSERT')
          AND has_table_privilege('authenticated', 'public.conturi_registru', 'UPDATE') AND has_table_privilege('service_role', 'public.conturi_registru', 'SELECT')
          AND has_sequence_privilege('authenticated', 'public.conturi_registru_id_seq', 'USAGE')) THEN
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
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261021a_conturi_registru_v1:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261021a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
