-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261017a — „Șef de șantier” pe fișa proiectului din Execuție (cerere Răzvan, 06.10.2026)
--
-- Ce face (aditiv, nimic altceva):
--   executie_proiecte.sef_santier_employee_id integer, FK -> employees(id), aceeași regulă ca
--   executie_proiecte_rts_employee_id_fkey (fără ON DELETE explicit = NO ACTION, citit read-only pe live 06.10) + COMMENT.
-- Neatins: fără backfill (coloana pornește NULL pe toate proiectele), fără RLS/policy nou (tabela are RLS activ,
--   policy-urile executie_proiecte_select / _modify pentru authenticated acoperă și coloana nouă), fără GRANT pe coloane
--   (nu există ACL pe coloane; drepturile de tabel se aplică), fără funcții noi (gate 0e = 0), fără view-uri.
--   public.fn_completare_aplica (whitelist-ul din docs/sec_f2_whitelist) NU propune încă șef de șantier — v2.
-- Ordine: migrarea ÎNAINTEA merge-ului UI (src/Executie.jsx cere coloana în select-uri și în payload-ul de salvare).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261017a_executie_sef_santier_ROLLBACK.sql. Gate 0e = 0.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261017a_executie_sef_santier:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261017a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;   -- deparse determinist pentru amprentele FK (pg_get_constraintdef)

DO $pre$
DECLARE
  v_rel oid := to_regclass('public.executie_proiecte');
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF v_rel IS NULL
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = v_rel) <> 'postgres'
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE THEN
    RAISE EXCEPTION 'Precondiție 0b: executie_proiecte lipsește, nu e a lui postgres sau nu are RLS activ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attname = 'sef_santier_employee_id' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_rel AND conname = 'executie_proiecte_sef_santier_employee_id_fkey') THEN
    RAISE EXCEPTION 'Precondiție 0c: coloana sef_santier_employee_id sau FK-ul ei există deja — reaplicare';
  END IF;
  -- modelul: FK-ul RTS, exact cum e pe live (NO ACTION la ștergere și la update, validat)
  IF (SELECT pg_get_constraintdef(oid) || '|' || confdeltype::text || confupdtype::text || '|' || convalidated::text
        FROM pg_constraint WHERE conrelid = v_rel AND conname = 'executie_proiecte_rts_employee_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (rts_employee_id) REFERENCES employees(id)|aa|true' THEN
    RAISE EXCEPTION 'Precondiție 0d: executie_proiecte_rts_employee_id_fkey diferă de modelul citit pe live (NO ACTION, validat)';
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.employees'::regclass AND attname = 'id') IS DISTINCT FROM 'integer'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.employees'::regclass AND contype = 'p'
                       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.employees'::regclass AND attname = 'id')]) THEN
    RAISE EXCEPTION 'Precondiție 0e: employees.id nu e integer PRIMARY KEY';
  END IF;
END
$pre$;

ALTER TABLE public.executie_proiecte ADD COLUMN IF NOT EXISTS sef_santier_employee_id integer;
ALTER TABLE public.executie_proiecte ADD CONSTRAINT executie_proiecte_sef_santier_employee_id_fkey
  FOREIGN KEY (sef_santier_employee_id) REFERENCES public.employees(id);
COMMENT ON COLUMN public.executie_proiecte.sef_santier_employee_id IS
  'Șef de șantier (employees.id). Adăugat 20261017a; completat manual din fișa proiectului (Execuție), fără propuneri automate în v1.';

DO $post$
DECLARE
  v_rel oid := to_regclass('public.executie_proiecte');
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) || '|' || attnotnull::text || '|' || atthasdef::text
        FROM pg_attribute WHERE attrelid = v_rel AND attname = 'sef_santier_employee_id' AND NOT attisdropped)
     IS DISTINCT FROM 'integer|false|false' THEN
    RAISE EXCEPTION 'Postcondiție 1: sef_santier_employee_id nu e integer NULL fără default';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) || '|' || confdeltype::text || confupdtype::text || '|' || convalidated::text
        FROM pg_constraint WHERE conrelid = v_rel AND conname = 'executie_proiecte_sef_santier_employee_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (sef_santier_employee_id) REFERENCES employees(id)|aa|true' THEN
    RAISE EXCEPTION 'Postcondiție 2: FK-ul nou nu e identic ca regulă cu cel RTS (NO ACTION, validat)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_proiecte WHERE sef_santier_employee_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 3: coloana nouă are valori — migrarea nu face backfill';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT attacl FROM pg_attribute WHERE attrelid = v_rel AND attname = 'sef_santier_employee_id') IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 4: RLS dezactivat sau ACL pe coloana nouă (nu era în plan)';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261017a_executie_sef_santier:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261017a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
