-- Revenire 20261215c_izometrie_muta_pozitie. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate RPC-ul fn_executie_tevi_muta_pozitie (mutarea unei piese la poziția N). Nu atinge date: ordinea pieselor rămâne cea de acum.
-- Butonul ⤒ din editor revine la „disponibil după actualizarea bazei de date”; ↑ / ↓ rămân ca azi.
-- Trebuie rulată ÎNAINTEA revenirii 20261209a dacă amândouă se scot (funcția de aici numește schimbul cu poartă).
-- Gestionarul tranzacției e operatorul. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261215c', 'SCOATE_MUTA_POZITIE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261215c SCOATE_MUTA_POZITIE
DO $revenire$
DECLARE v_fn regprocedure := to_regprocedure('public.fn_executie_tevi_muta_pozitie(bigint, integer)');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261215c', true) IS DISTINCT FROM 'SCOATE_MUTA_POZITIE:' || txid_current() THEN
    RAISE EXCEPTION '20261215c revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261215c=%') THEN
    RAISE EXCEPTION '20261215c revenire: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- r2 (L15): amprenta EXACTĂ a ce scoatem = ce a creat 20261215c: corpul (md5 fără CR, același cu postcondiția migrării), INVOKER,
  -- plpgsql, search_path propriu, jsonb, proprietarul și drepturile exacte (authenticated + proprietarul). Altă formă = refuz (de analizat).
  IF v_fn IS NULL OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_executie_tevi_muta_pozitie') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef AND p.prorettype = 'jsonb'::regtype::oid
                     AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proisstrict
                     AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = current_user
                     AND md5(replace(p.prosrc, chr(13), '')) = '74c10379b9c971f0f98e4490be5601fc')
     OR (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
           SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                  || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
             FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = v_fn) a)
        IS DISTINCT FROM 'authenticated:EXECUTE, ' || current_user || ':EXECUTE' THEN
    RAISE EXCEPTION '20261215c revenire: starea nu e cea din 20261215c (functia lipseste sau difera: corp, proprietati, drepturi)';
  END IF;
  -- nimic altceva nu depinde de ea (vedere, funcție SQL standard, trigger): DROP fără CASCADE oricum refuză
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_fn) THEN
    RAISE EXCEPTION '20261215c revenire: obiecte legate de fn_executie_tevi_muta_pozitie (de analizat)';
  END IF;
  DROP FUNCTION public.fn_executie_tevi_muta_pozitie(bigint, integer);
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_executie_tevi_muta_pozitie') THEN
    RAISE EXCEPTION '20261215c revenire: starea finala difera (functia inca exista)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261215c', '', true);   -- dezarmare
END $revenire$;
