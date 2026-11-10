-- Revenire 20261208b_executie_raport_lucrari_doar_rpc. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Redă lui authenticated scrierea directă în raport_lucrari (INSERT / UPDATE / DELETE, ca înainte de 20261208b). anon NU o primește înapoi
-- (n-o putea folosi: politicile tabelului cer auth.uid()); e singura asimetrie, voită. Se rulează ÎNAINTEA revenirii 20261208a, dacă e nevoie de ambele.
-- Gestionarul tranzacției e operatorul. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261208b', 'REDA_SCRIEREA_LINIILOR:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261208b REDA_SCRIEREA_LINIILOR
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261208b', true) IS DISTINCT FROM 'REDA_SCRIEREA_LINIILOR:' || txid_current() THEN
    RAISE EXCEPTION '20261208b revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261208b=%') THEN
    RAISE EXCEPTION '20261208b revenire: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT') OR has_table_privilege('authenticated', 'public.raport_lucrari', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE') THEN
    RAISE EXCEPTION '20261208b revenire: starea nu e cea din 20261208b (authenticated scrie deja direct)';
  END IF;
  GRANT INSERT, UPDATE, DELETE ON public.raport_lucrari TO authenticated;
  IF NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT') OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE') THEN
    RAISE EXCEPTION '20261208b revenire post: drepturile nu s-au redat';
  END IF;
  PERFORM set_config('gazpet.revenire_20261208b', '', true);   -- dezarmare
END $revenire$;
