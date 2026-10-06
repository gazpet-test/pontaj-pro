-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261017a_executie_sef_santier_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate coloana executie_proiecte.sef_santier_employee_id și FK-ul ei (starea dinainte de 20261017a).
-- ⚠️ Ireversibil pentru date: șefii de șantier completați pe proiecte se pierd. Dacă există valori, întâi export:
--    SELECT id, cod_intern, sef_santier_employee_id FROM public.executie_proiecte WHERE sef_santier_employee_id IS NOT NULL;
-- ⚠️ UI-ul (src/Executie.jsx) care cere coloana trebuie revenit ÎNAINTE (altfel fișa proiectului nu se mai salvează)
--    la fel funcțiile/edge-urile care scriu coloana (ex. fn_completare_aplica v2) — scriptul le refuză explicit.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN ISOLATION LEVEL READ COMMITTED;   -- obligatoriu (altă izolare e refuzată)
--   SELECT set_config('gazpet.revenire_20261017a', 'SEF_SANTIER_DROP:' || txid_current(), true);
--   -- doar dacă există valori (după export): SELECT set_config('gazpet.revenire_20261017a_cu_date', 'DA:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';   -- nu așteaptă la nesfârșit după lock-ul exclusiv din $arm$
SET LOCAL search_path = public, pg_temp;   -- deparse determinist pentru amprenta FK (pg_get_constraintdef)

DO $arm$
DECLARE
  v_rel oid := to_regclass('public.executie_proiecte');
  n bigint;
BEGIN
  IF current_setting('gazpet.revenire_20261017a', true) IS DISTINCT FROM 'SEF_SANTIER_DROP:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261017a: nearmată (gazpet.revenire_20261017a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261017a%') THEN
    RAISE EXCEPTION 'Revenire 20261017a: armare persistentă (ALTER DATABASE/ROLE SET, oricare din cele două chei) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261017a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- lock exclusiv ÎNAINTE de verificări (Jakarinos 06.10): fără el, între count(*) și DROP COLUMN o scriere concurentă
  -- poate completa câmpul și s-ar pierde fără armarea _cu_date. Lock-ul ține până la COMMIT (READ COMMITTED: count-ul de
  -- mai jos ia snapshot nou, după lock, deci vede tot ce s-a comis). În REPEATABLE READ/SERIALIZABLE snapshot-ul e cel
  -- de la armare, de dinaintea lock-ului — de aceea refuz explicit (Jakarinos r2).
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'Revenire 20261017a: rulează în READ COMMITTED (acum: %) — BEGIN ISOLATION LEVEL READ COMMITTED', current_setting('transaction_isolation');
  END IF;
  LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE;
  -- starea EXACTĂ a patch-ului
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = v_rel AND attname = 'sef_santier_employee_id' AND NOT attisdropped) IS DISTINCT FROM 'integer'
     OR (SELECT pg_get_constraintdef(oid) || '|' || confdeltype::text || confupdtype::text
           FROM pg_constraint WHERE conrelid = v_rel AND conname = 'executie_proiecte_sef_santier_employee_id_fkey')
        IS DISTINCT FROM 'FOREIGN KEY (sef_santier_employee_id) REFERENCES employees(id)|aa' THEN
    RAISE EXCEPTION 'Revenire 20261017a: precondiție — starea nu e cea a patch-ului 20261017a (coloană integer + FK NO ACTION)';
  END IF;
  -- nimic altceva nu depinde de coloană (view, index, altă constrângere) — DROP fără CASCADE oricum, dar refuzul e explicit
  IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = v_rel
                AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = v_rel AND attname = 'sef_santier_employee_id')
                AND NOT (d.classid = 'pg_constraint'::regclass
                         AND d.objid = (SELECT oid FROM pg_constraint WHERE conrelid = v_rel AND conname = 'executie_proiecte_sef_santier_employee_id_fkey'))) THEN
    RAISE EXCEPTION 'Revenire 20261017a: alte obiecte depind de sef_santier_employee_id (view/index/constrângere) — reanalizează';
  END IF;
  -- corpurile funcțiilor nu apar în pg_depend (ex. fn_completare_aplica v2 cu câmpul în whitelist) — refuz explicit
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
                AND prosrc LIKE '%sef_santier_employee_id%') THEN
    RAISE EXCEPTION 'Revenire 20261017a: funcții care folosesc sef_santier_employee_id în corp — întâi revino-le';
  END IF;
  SELECT count(*) INTO n FROM public.executie_proiecte WHERE sef_santier_employee_id IS NOT NULL;
  IF n > 0 AND current_setting('gazpet.revenire_20261017a_cu_date', true) IS DISTINCT FROM 'DA:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261017a: % proiecte au șef de șantier completat — exportă-le și armează și gazpet.revenire_20261017a_cu_date = DA:<txid_current()> în aceeași tranzacție', n;
  END IF;
END
$arm$;

ALTER TABLE public.executie_proiecte DROP CONSTRAINT executie_proiecte_sef_santier_employee_id_fkey;
ALTER TABLE public.executie_proiecte DROP COLUMN sef_santier_employee_id;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'sef_santier_employee_id' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.executie_proiecte'::regclass AND conname = 'executie_proiecte_sef_santier_employee_id_fkey') THEN
    RAISE EXCEPTION 'Revenire 20261017a: postcondiție — coloana sau FK-ul încă există';
  END IF;
  PERFORM set_config('gazpet.revenire_20261017a', '', true);
  PERFORM set_config('gazpet.revenire_20261017a_cu_date', '', true);
END
$post$;
