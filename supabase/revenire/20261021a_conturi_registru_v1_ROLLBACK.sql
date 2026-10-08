-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261021a_conturi_registru_v1_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate public.conturi_registru (tabel, secvența identity, politici, trigger). set_updated_at() rămâne neatinsă.
-- REFUZĂ dacă tabelul are rânduri: registrul ține date reale ale lui Răzvan — se exportă întâi (SELECT * … ca CSV) și se
--   golește explicit, cu acordul lui, într-o operație separată (DELETE cere service_role/postgres: authenticated nu are DELETE).
--   Revenirea nu șterge niciodată date pe tăcute.
-- AMPRENTĂ COMPLETĂ (r2, Copilot P15-3 / Jakarinos J16-4): recalculează amprenta tabelului (coloane+tipuri+default-uri,
--   constrângeri, politici cu expresii, trigger cu funcția, indecși, drepturi pe tabel și secvență, owner, RLS) cu EXACT
--   expresia din migrare și o compară cu „amprenta=<md5>” scrisă de 20261021a în COMMENT. Orice schimbare ulterioară
--   (ALTER POLICY, CHECK, default, coloană, drept) ⇒ refuz, ca să nu șteargă o versiune mai nouă.
-- UN SINGUR bloc DO: armarea, LOCK-ul, verificările, DROP-ul și postcondițiile sunt o singură instrucțiune — și la o rulare
--   greșită cu `psql -f` simplu (autocommit, fără ON_ERROR_STOP) orice refuz anulează și DROP-ul.
-- UI-ul (tab-ul 🔐 Conturi) se retrage ÎNAINTE (revert PR), altfel ecranul dă eroare la încărcare.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261021a', 'CONTURI_REGISTRU_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE
  v_n bigint;
  v_acum text;
  v_scrisa text;
BEGIN
  -- 1. armare legată de tranzacția curentă; fără armare persistentă; doar postgres
  IF current_setting('gazpet.revenire_20261021a', true) IS DISTINCT FROM 'CONTURI_REGISTRU_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261021a: nearmată (gazpet.revenire_20261021a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261021a=%') THEN
    RAISE EXCEPTION 'Revenire 20261021a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261021a: rulează ca postgres';
  END IF;
  IF to_regclass('public.conturi_registru') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261021a: public.conturi_registru nu există — nimic de scos';
  END IF;

  -- 2. lock exclusiv (nimeni nu mai scrie între verificare și DROP)
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.conturi_registru IN ACCESS EXCLUSIVE MODE;

  -- 3. fără date
  SELECT count(*) INTO v_n FROM public.conturi_registru;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Revenire 20261021a: conturi_registru are % rânduri (date reale) — exportă și golește întâi, cu acordul lui Răzvan; refuz', v_n;
  END IF;

  -- 4. amprenta exactă a obiectului lăsat de 20261021a
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s:%s:%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), '')), ',' ORDER BY a.attnum)
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid = t.oid),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s', p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY p.polname)
         FROM pg_policy p WHERE p.polrelid = t.oid),
      (SELECT string_agg(format('%s:%s:%s:%s', g.tgname, g.tgfoid::regprocedure, g.tgtype, g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal),
      (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid))
         FROM pg_index i WHERE i.indrelid = t.oid),
      (SELECT string_agg(format('%s:%s:%s', r.n, p.n, has_table_privilege(r.n, t.oid, p.n)), ',' ORDER BY r.n, p.n)
         FROM unnest(ARRAY['anon','authenticated','service_role']) r(n),
              unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)),
      (SELECT string_agg(format('%s:%s:%s', r.n, p.n, has_sequence_privilege(r.n, 'public.conturi_registru_id_seq', p.n)), ',' ORDER BY r.n, p.n)
         FROM unnest(ARRAY['anon','authenticated','service_role']) r(n), unnest(ARRAY['USAGE','SELECT','UPDATE']) p(n)),
      pg_get_userbyid(t.relowner), t.relrowsecurity, t.relforcerowsecurity))
    INTO v_acum
    FROM pg_class t WHERE t.oid = 'public.conturi_registru'::regclass;
  v_scrisa := substring(obj_description('public.conturi_registru'::regclass, 'pg_class') FROM 'amprenta=([0-9a-f]{32})');
  IF v_scrisa IS NULL OR v_acum IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Revenire 20261021a: amprenta tabelului diferă de cea scrisă de 20261021a (acum %, scrisă %) — o migrare ulterioară l-a schimbat; refuz',
      v_acum, coalesce(v_scrisa, 'lipsă');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = 'public.conturi_registru'::regclass AND d.deptype = 'n'
              AND d.classid = 'pg_rewrite'::regclass) THEN
    RAISE EXCEPTION 'Revenire 20261021a: există view-uri care depind de conturi_registru — refuz (le-ar șterge CASCADE)';
  END IF;

  -- 5. scoaterea (fără CASCADE)
  DROP TABLE public.conturi_registru;

  -- 6. postcondiții + dezarmare
  IF to_regclass('public.conturi_registru') IS NOT NULL OR to_regclass('public.conturi_registru_id_seq') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261021a: postcondiție — tabelul sau secvența au rămas';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.set_updated_at()')) IS DISTINCT FROM '1c4318bee4240d4113d86fad7eb15623' THEN
    RAISE EXCEPTION 'Revenire 20261021a: postcondiție — set_updated_at() trebuie să rămână neatinsă';
  END IF;
  PERFORM set_config('gazpet.revenire_20261021a', '', true);
END
$revenire$;
