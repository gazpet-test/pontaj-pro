-- 20261030b — Un contract din Administrativ (contracte_terti) se leagă de cel mult UN proiect din Execuție.
-- TKT-2026-0333 / PR #709, review Jakarinos r1 (P1): regula 1:1 era doar în UI. Administrativ dezleagă celelalte
-- proiecte înainte să lege unul nou, iar butonul „Leagă” din Execuție ascunde contractele ocupate, dar două sesiuni
-- deschise în paralel puteau lega același contract de două proiecte. Indexul unic parțial închide cursa în BD;
-- UI-ul tratează 23505 („contractul tocmai a fost legat de alt proiect”) și reîncarcă lista.
-- contract_id NULL rămâne liber (oricâte proiecte fără contract).
-- Precondiție: nu există deja duplicate (verificat live 14.10.2026: 0). Dacă apar între timp, migrarea se oprește și le
-- listează; duplicatele se rezolvă întâi (decizie Răzvan), nu de aici.
-- Revenire: supabase/revenire/20261030b_executie_contract_id_unic_ROLLBACK.sql. Test: scripts/test_executie_contract_id_unic.sh.

DO $pre$
DECLARE v_dubluri text;
BEGIN
  SELECT string_agg(format('contract %s → proiectele %s', d.contract_id, d.proiecte), '; ' ORDER BY d.contract_id)
    INTO v_dubluri
  FROM (SELECT contract_id, string_agg(id::text, ',' ORDER BY id) AS proiecte
        FROM public.executie_proiecte
        WHERE contract_id IS NOT NULL
        GROUP BY contract_id
        HAVING count(*) > 1) d;
  IF v_dubluri IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDIȚIE 20261030b: același contract e legat de mai multe proiecte — %', v_dubluri
      USING HINT = 'Se rezolvă întâi duplicatele (preview + decizia lui Răzvan), apoi se reaplică migrarea.';
  END IF;
END $pre$;

CREATE UNIQUE INDEX IF NOT EXISTS executie_proiecte_contract_id_unic
  ON public.executie_proiecte (contract_id)
  WHERE contract_id IS NOT NULL;

COMMENT ON INDEX public.executie_proiecte_contract_id_unic IS
  'TKT-2026-0333: un contract din contracte_terti se leagă de cel mult un proiect din Execuție (1:1, ca în Administrativ).';

DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'executie_proiecte_contract_id_unic'
      AND c.relnamespace = 'public'::regnamespace
      AND i.indrelid = 'public.executie_proiecte'::regclass
      AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (contract_id) WHERE (contract_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030b: indexul unic parțial pe executie_proiecte(contract_id) lipsește sau are altă definiție';
  END IF;
END $post$;
