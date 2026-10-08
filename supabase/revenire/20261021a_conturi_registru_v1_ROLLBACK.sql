-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261021a_conturi_registru_v1_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate public.conturi_registru (tabel, secvență, politici, trigger). set_updated_at() rămâne neatinsă.
-- REFUZĂ dacă tabelul are rânduri: registrul ține date reale ale lui Răzvan — se exportă întâi (SELECT * … ca CSV) și se
--   golește explicit, cu acordul lui, într-o operație separată. Revenirea nu șterge niciodată date pe tăcute.
-- Refuză și dacă tabelul nu mai e exact cel lăsat de 20261021a (coloane, politici, trigger), ca să nu șteargă o versiune
--   ulterioară. UI-ul (tab-ul 🔐 Conturi) se retrage ÎNAINTE (revert PR), altfel ecranul dă eroare la încărcare.
-- UN SINGUR bloc DO (review intern, P1): armarea, LOCK-ul, toate verificările, DROP-ul și postcondițiile sunt în aceeași
--   instrucțiune, deci orice refuz anulează și DROP-ul — și la o rulare greșită cu `psql -f` simplu (autocommit, fără
--   ON_ERROR_STOP), unde instrucțiunile separate s-ar fi executat una după alta.
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

  -- 3. amprenta: fără date, exact obiectul din 20261021a, fără dependenți
  SELECT count(*) INTO v_n FROM public.conturi_registru;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Revenire 20261021a: conturi_registru are % rânduri (date reale) — exportă și golește întâi, cu acordul lui Răzvan; refuz', v_n;
  END IF;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
       WHERE attrelid = 'public.conturi_registru'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['id','categorie','serviciu','url','utilizator','titular','cod_client','personal','locatie_ids',
                            'observatii','activ','created_by','created_at','updated_at']::text[] THEN
    RAISE EXCEPTION 'Revenire 20261021a: coloanele diferă de cele din 20261021a (o migrare ulterioară a schimbat tabelul) — refuz';
  END IF;
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conturi_registru')
     IS DISTINCT FROM ARRAY['conturi_registru_del','conturi_registru_ins','conturi_registru_sel','conturi_registru_upd']::text[] THEN
    RAISE EXCEPTION 'Revenire 20261021a: politicile diferă de cele din 20261021a — refuz';
  END IF;
  IF (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.conturi_registru'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM ARRAY['trg_conturi_registru_updated_at']::text[] THEN
    RAISE EXCEPTION 'Revenire 20261021a: trigger-ele diferă de cele din 20261021a — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = 'public.conturi_registru'::regclass AND d.deptype = 'n'
              AND d.classid = 'pg_rewrite'::regclass) THEN
    RAISE EXCEPTION 'Revenire 20261021a: există view-uri care depind de conturi_registru — refuz (le-ar șterge CASCADE)';
  END IF;

  -- 4. scoaterea (fără CASCADE)
  DROP TABLE public.conturi_registru;

  -- 5. postcondiții + dezarmare
  IF to_regclass('public.conturi_registru') IS NOT NULL OR to_regclass('public.conturi_registru_id_seq') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261021a: postcondiție — tabelul sau secvența au rămas';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.set_updated_at()')) IS DISTINCT FROM '1c4318bee4240d4113d86fad7eb15623' THEN
    RAISE EXCEPTION 'Revenire 20261021a: postcondiție — set_updated_at() trebuie să rămână neatinsă';
  END IF;
  PERFORM set_config('gazpet.revenire_20261021a', '', true);
END
$revenire$;
