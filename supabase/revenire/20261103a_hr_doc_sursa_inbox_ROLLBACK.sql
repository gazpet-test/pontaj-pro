-- ============================================================================
-- REVENIRE 20261103a — scoate proveniența structurală din dosarul HR: trigger-ul trg_hr_docp_sursa_inbox_imutabil, funcția
-- hr_docp_sursa_inbox_imutabil(), indexul unic hr_documente_personale_sursa_inbox_unic și coloana
-- hr_documente_personale.sursa_inbox_id. Nu atinge alte obiecte / alte date.
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Doar la cererea lui Răzvan.
--   REFUZĂ dacă vreun document are sursa_inbox_id (nu se scoate o coloană cu date: proveniența s-ar pierde, iar un rând din
--   coadă ar putea salva din nou același document). Datele se tratează întâi, printr-o decizie separată (nu de aici).
--   ÎNAINTE de revenire se revine și UI-ul: CitesteOricePanel de pe branch-ul hr/citeste-orice-dubluri cere coloana
--   (fără ea, salvarea din «Citește orice» HR se oprește cu „migrarea pentru sursa_inbox_id nu e aplicată”).
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN ISOLATION LEVEL READ COMMITTED;
--     SELECT set_config('gazpet.revenire_20261103a', 'SCOATE_SURSA_INBOX:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- harness-armare: gazpet.revenire_20261103a SCOATE_SURSA_INBOX
-- Siguranțe: DOAR la READ COMMITTED (altfel refuz); armare legată de txid; armare persistentă (ALTER DATABASE/ROLE … SET) =
--   refuz; precondiție = exact obiectele patch-ului; LOCK ACCESS EXCLUSIVE pe hr_documente_personale ÎNAINTEA verificării
--   „niciun sursa_inbox_id” (un INSERT concurent din «Citește orice» nu scapă numărării); DROP fără CASCADE; postcondiție =
--   niciun obiect al patch-ului rămas; NOTIFY pgrst; dezarmare la final.
-- ============================================================================
-- (ca la 20261030c) la REPEATABLE READ / SERIALIZABLE snapshot-ul se fixează la armare, ÎNAINTEA LOCK-ului: un INSERT comis cât
-- așteptăm lock-ul ar rămâne invizibil pentru count(*), iar DROP COLUMN i-ar pierde proveniența. Doar READ COMMITTED ia un
-- snapshot nou la fiecare instrucțiune.
DO $rb_izolare$
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'REVENIRE 20261103a blocată: izolarea tranzacției este „%”; revenirea rulează DOAR la READ COMMITTED (BEGIN ISOLATION LEVEL READ COMMITTED)', current_setting('transaction_isolation')
      USING ERRCODE = '25001';
  END IF;
END $rb_izolare$;

DO $rb_pre$
DECLARE v_n bigint; v_att int2;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.revenire_20261103a') THEN
    RAISE EXCEPTION 'REVENIRE 20261103a blocată: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('gazpet.revenire_20261103a', true) IS DISTINCT FROM 'SCOATE_SURSA_INBOX:' || txid_current() THEN
    RAISE EXCEPTION 'REVENIRE 20261103a blocată: fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.revenire_20261103a'', ''SCOATE_SURSA_INBOX:'' || txid_current(), true);'
      USING ERRCODE = '42501';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261103a: revenirea necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT a.attnum INTO v_att FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.hr_documente_personale') AND a.attname = 'sursa_inbox_id' AND NOT a.attisdropped
     AND a.atttypid = 'bigint'::regtype;
  IF v_att IS NULL
     OR to_regclass('public.hr_documente_personale_sursa_inbox_unic') IS NULL
     OR to_regprocedure('public.hr_docp_sursa_inbox_imutabil()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil'
                    AND tgrelid = 'public.hr_documente_personale'::regclass) THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103a: starea curentă nu e patch-ul 20261103a (exact) — nu se revine tacit' USING ERRCODE = '55000';
  END IF;
  -- alte obiecte (view-uri / reguli) care folosesc coloana: DROP fără CASCADE ar cădea oricum; mesaj clar înainte
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.hr_documente_personale'::regclass
                AND d.refobjsubid = v_att) THEN
    RAISE EXCEPTION 'Precondiție revenire 20261103a: alte view-uri folosesc hr_documente_personale.sursa_inbox_id — se reanalizează' USING ERRCODE = '55000';
  END IF;
  -- lock-ul cel mai tare ÎNAINTEA numărării: un INSERT în curs se termină întâi (și e numărat), cele noi așteaptă după DROP
  LOCK TABLE public.hr_documente_personale IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.hr_documente_personale WHERE sursa_inbox_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'REVENIRE 20261103a blocată: % document(e) din dosarul HR au sursa_inbox_id (proveniența «Citește orice») — nu se scoate o coloană cu date; decizie separată întâi', v_n
      USING ERRCODE = '42501';
  END IF;
END $rb_pre$;

DROP TRIGGER trg_hr_docp_sursa_inbox_imutabil ON public.hr_documente_personale;
DROP FUNCTION public.hr_docp_sursa_inbox_imutabil();
DROP INDEX public.hr_documente_personale_sursa_inbox_unic;
ALTER TABLE public.hr_documente_personale DROP COLUMN sursa_inbox_id;

NOTIFY pgrst, 'reload schema';

DO $rb_post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_documente_personale'
             AND column_name = 'sursa_inbox_id')
     OR to_regclass('public.hr_documente_personale_sursa_inbox_unic') IS NOT NULL
     OR to_regprocedure('public.hr_docp_sursa_inbox_imutabil()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE revenire 20261103a: au rămas obiecte ale patch-ului';
  END IF;
  PERFORM set_config('gazpet.revenire_20261103a', '', true);   -- dezarmare
END $rb_post$;
