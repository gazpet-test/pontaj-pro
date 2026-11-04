-- Revenire 20261130g_redari_rls_initplan. Runner: o tranzactie, GUC gazpet.revenire_20261130g = 'REDARI_RLS_INITPLAN_SCOASA:'||txid_current().
-- Readuce EXACT expresiile celor 42 de politici red_* din 04.11.2026 (public.fn_red_nivel() direct, per rand) si scoate cele 9 indexuri create de 30g.
-- Nu atinge date, drepturi, functii sau politicile storage / sms_* (30g nu le-a schimbat). Garda: expresiile curente trebuie sa fie EXACT cele puse
-- de 30g (altfel cineva le-a schimbat intre timp -> refuz), exact 42 de politici, RLS neschimbat, indexurile exact cele create de 30g.
-- Acelasi model ca migrarea: verificarile (doar catalog) intai FARA lock-uri, apoi lock_timeout 2 s + statement_timeout 5 s, un LOCK in ordine
-- alfabetica (ACCESS EXCLUSIVE si pe sms_loturi: DROP INDEX il cere), verificare autoritara sub lock-uri, apoi cate o instructiune per schimbare.
-- Limita superioara a ferestrei de lock: 15 instructiuni x 5 s = 75 s; real sub 1 s. Fiecare instructiune care schimba schema apeleaza
-- pg_temp.r30g_rev_garda() (refuz in afara runner-ului). Testat local (PG 17.6): apply -> revenire -> re-apply, refuz la a doua revenire si la drift.
-- garda reverificata de fiecare instructiune care modifica schema: aceeasi tranzactie (GUC legat de txid), postgres, preflight-ul rulat (tabela lui
--   temp exista). Rulat in afara runner-ului (autocommit), fiecare instructiune are alt txid -> refuz, nimic nu se aplica fara preflight.
CREATE FUNCTION pg_temp.r30g_rev_garda() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130g', true) IS DISTINCT FROM 'REDARI_RLS_INITPLAN_SCOASA:' || txid_current()
     OR to_regclass('pg_temp.r30g_rev_pol') IS NULL THEN
    RAISE EXCEPTION '20261130g revenire: garda / preflight lipsa in aceasta tranzactie';
  END IF;
END $f$;

CREATE FUNCTION pg_temp.r30g_rev_verifica_nou() RETURNS void LANGUAGE plpgsql AS $f$
-- doar catalog (rapid): forma noua, pusa de 30g
DECLARE v_dif text[]; v_n integer;
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g revenire: search_path neasteptat'; END IF;
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_rev_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_nou OR l.w IS DISTINCT FROM b.w_nou;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: politicile nu sunt cele asteptate (forma noua, pusa de 30g): %', v_dif; END IF;
  SELECT count(*) INTO v_n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_';
  IF v_n <> 42 THEN RAISE EXCEPTION '20261130g revenire: % politici pe red_* (asteptat exact 42)', v_n; END IF;
  -- RLS: activ pe toate tabelele red_* / sms_*; pe tabelele atinse exact relrowsecurity = true si relforcerowsecurity = false (baseline live 04.11)
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity)
     OR (SELECT count(*) FROM (VALUES ('red_convocari'), ('red_corespondenta'), ('red_corespondenta_fisiere'), ('red_corespondenta_mailuri'), ('red_detinatori'), ('red_detinatori_contact'), ('red_detinatori_token'), ('red_import_loturi'), ('red_jurnal'), ('red_loturi_plicuire'), ('red_numere'), ('red_parcele'), ('red_plicuri'), ('red_procese_verbale'), ('red_proiecte'), ('red_raspunsuri'), ('red_raspunsuri_meta'), ('red_uat'), ('sms_loturi')) t(n) JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
          WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION '20261130g revenire: configuratia RLS (relrowsecurity / relforcerowsecurity) difera de baseline';
  END IF;
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_rev_idx i WHERE NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                      WHERE x.indexrelid = to_regclass('public.' || i.idx) AND x.indrelid = to_regclass('public.' || i.tabela)
                        AND x.indnatts = 1 AND x.indisvalid AND x.indisready AND NOT x.indisunique AND x.indpred IS NULL AND x.indexprs IS NULL
                        AND a.attname = i.coloana)
      OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = to_regclass('public.' || i.idx));
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: indexurile nu sunt cele create de 30g: %', v_dif; END IF;
END $f$;

CREATE FUNCTION pg_temp.r30g_rev_verifica_vechi() RETURNS void LANGUAGE plpgsql AS $f$
-- doar catalog (rapid): forma veche, readusa
DECLARE v_dif text[]; v_n integer;
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g revenire: search_path neasteptat'; END IF;
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_rev_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_vechi OR l.w IS DISTINCT FROM b.w_vechi;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: politicile nu sunt cele asteptate (forma veche, readusa): %', v_dif; END IF;
  SELECT count(*) INTO v_n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_';
  IF v_n <> 42 THEN RAISE EXCEPTION '20261130g revenire: % politici pe red_* (asteptat exact 42)', v_n; END IF;
  -- RLS: activ pe toate tabelele red_* / sms_*; pe tabelele atinse exact relrowsecurity = true si relforcerowsecurity = false (baseline live 04.11)
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity)
     OR (SELECT count(*) FROM (VALUES ('red_convocari'), ('red_corespondenta'), ('red_corespondenta_fisiere'), ('red_corespondenta_mailuri'), ('red_detinatori'), ('red_detinatori_contact'), ('red_detinatori_token'), ('red_import_loturi'), ('red_jurnal'), ('red_loturi_plicuire'), ('red_numere'), ('red_parcele'), ('red_plicuri'), ('red_procese_verbale'), ('red_proiecte'), ('red_raspunsuri'), ('red_raspunsuri_meta'), ('red_uat'), ('sms_loturi')) t(n) JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
          WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION '20261130g revenire: configuratia RLS (relrowsecurity / relforcerowsecurity) difera de baseline';
  END IF;
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_rev_idx i WHERE to_regclass('public.' || i.idx) IS NOT NULL;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: indexuri ramase: %', v_dif; END IF;
END $f$;

DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130g', true) IS DISTINCT FROM 'REDARI_RLS_INITPLAN_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261130g revenire: garda invalida';
  END IF;
  PERFORM set_config('gazpet.r30g_search_path', current_setting('search_path'), true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NULL THEN RAISE EXCEPTION '20261130g revenire: lipseste verificatorul storage (30e)'; END IF;
  -- acelasi baseline ca in migrare (generat din acelasi text)
  CREATE TEMP TABLE r30g_rev_pol ON COMMIT DROP AS
  WITH k(cod, expr) AS (VALUES
      ('N',  '(fn_red_nivel() IS NOT NULL)'),
      ('AE', '(fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text]))'),
      ('A',  '(fn_red_nivel() = ''admin''::text)'),
      ('J',  '((fn_red_nivel() IS NOT NULL) AND ((tabela <> ALL (ARRAY[''red_detinatori_contact''::text, ''red_raspunsuri_meta''::text])) OR (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text]))))')),
  b(tabela, politica, cmd, q, w) AS (VALUES
      ('red_convocari', 'red_convocari_ins', 'a', NULL, 'AE'), ('red_convocari', 'red_convocari_sel', 'r', 'N', NULL),
      ('red_convocari', 'red_convocari_upd', 'w', 'AE', 'AE'),
      ('red_corespondenta', 'red_corespondenta_ins', 'a', NULL, 'AE'), ('red_corespondenta', 'red_corespondenta_sel', 'r', 'N', NULL),
      ('red_corespondenta', 'red_corespondenta_upd', 'w', 'AE', 'AE'),
      ('red_corespondenta_fisiere', 'red_corespondenta_fisiere_ins', 'a', NULL, 'AE'),
      ('red_corespondenta_fisiere', 'red_corespondenta_fisiere_sel', 'r', 'N', NULL),
      ('red_corespondenta_mailuri', 'red_corespondenta_mailuri_sel', 'r', 'N', NULL),   -- 20261130f (aplicata live 04.11)
      ('red_detinatori', 'red_detinatori_ins', 'a', NULL, 'AE'), ('red_detinatori', 'red_detinatori_sel', 'r', 'N', NULL),
      ('red_detinatori', 'red_detinatori_upd', 'w', 'AE', 'AE'),
      ('red_detinatori_contact', 'red_contact_ins', 'a', NULL, 'AE'), ('red_detinatori_contact', 'red_contact_sel', 'r', 'AE', NULL),
      ('red_detinatori_contact', 'red_contact_upd', 'w', 'AE', 'AE'),
      ('red_detinatori_token', 'red_token_sel', 'r', 'AE', NULL),
      ('red_import_loturi', 'red_import_loturi_ins', 'a', NULL, 'AE'), ('red_import_loturi', 'red_import_loturi_sel', 'r', 'N', NULL),
      ('red_import_loturi', 'red_import_loturi_upd', 'w', 'AE', 'AE'),
      ('red_jurnal', 'red_jurnal_sel', 'r', 'J', NULL),
      ('red_loturi_plicuire', 'red_loturi_plicuire_sel', 'r', 'N', NULL), ('red_loturi_plicuire', 'red_loturi_plicuire_upd', 'w', 'AE', 'AE'),
      ('red_numere', 'red_numere_sel', 'r', 'N', NULL),
      ('red_parcele', 'red_parcele_ins', 'a', NULL, 'AE'), ('red_parcele', 'red_parcele_sel', 'r', 'N', NULL),
      ('red_parcele', 'red_parcele_upd', 'w', 'AE', 'AE'),
      ('red_plicuri', 'red_plicuri_sel', 'r', 'N', NULL), ('red_plicuri', 'red_plicuri_upd', 'w', 'AE', 'AE'),
      ('red_procese_verbale', 'red_pv_ins', 'a', NULL, 'AE'), ('red_procese_verbale', 'red_pv_sel', 'r', 'N', NULL),
      ('red_procese_verbale', 'red_pv_upd', 'w', 'AE', 'AE'),
      ('red_proiecte', 'red_proiecte_ins', 'a', NULL, 'A'), ('red_proiecte', 'red_proiecte_sel', 'r', 'N', NULL),
      ('red_proiecte', 'red_proiecte_upd', 'w', 'A', 'A'),
      ('red_raspunsuri', 'red_raspunsuri_ins', 'a', NULL, 'AE'), ('red_raspunsuri', 'red_raspunsuri_sel', 'r', 'N', NULL),
      ('red_raspunsuri', 'red_raspunsuri_upd', 'w', 'AE', 'AE'),
      ('red_raspunsuri_meta', 'red_meta_ins', 'a', NULL, 'AE'), ('red_raspunsuri_meta', 'red_meta_sel', 'r', 'AE', NULL),
      ('red_uat', 'red_uat_ins', 'a', NULL, 'A'), ('red_uat', 'red_uat_sel', 'r', 'N', NULL),
      ('red_uat', 'red_uat_upd', 'w', 'A', 'A'))
  SELECT b.tabela, b.politica, b.cmd::"char" AS cmd, kq.expr AS q_vechi, kw.expr AS w_vechi,
         replace(kq.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS q_nou,
         replace(kw.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS w_nou
    FROM b LEFT JOIN k kq ON kq.cod = b.q LEFT JOIN k kw ON kw.cod = b.w;
  IF (SELECT count(*) FROM pg_temp.r30g_rev_pol) <> 42 THEN RAISE EXCEPTION '20261130g revenire: baseline incomplet'; END IF;
  CREATE TEMP TABLE r30g_rev_idx ON COMMIT DROP AS
  SELECT * FROM (VALUES
      ('idx_red_corespondenta_aprobat_fisier', 'red_corespondenta', 'aprobat_fisier_id', 'red_corespondenta_aprobat_fisier_fk'),
      ('idx_red_import_loturi_proiect', 'red_import_loturi', 'proiect_id', 'red_import_loturi_proiect_id_fkey'),
      ('idx_red_loturi_plicuire_proiect', 'red_loturi_plicuire', 'proiect_id', 'red_loturi_plicuire_proiect_id_fkey'),
      ('idx_red_loturi_plicuire_semnatar1', 'red_loturi_plicuire', 'semnatar1_id', 'red_loturi_plicuire_semnatar1_id_fkey'),
      ('idx_red_loturi_plicuire_semnatar2', 'red_loturi_plicuire', 'semnatar2_id', 'red_loturi_plicuire_semnatar2_id_fkey'),
      ('idx_red_plicuri_uat', 'red_plicuri', 'uat_id', 'red_plicuri_uat_id_fkey'),
      ('idx_red_uat_responsabil', 'red_uat', 'responsabil_id', 'red_uat_responsabil_fk'),
      ('idx_sms_loturi_proiect', 'sms_loturi', 'proiect_id', 'sms_loturi_proiect_id_fkey'),
      ('idx_sms_loturi_uat', 'sms_loturi', 'uat_id', 'sms_loturi_uat_id_fkey')) v(idx, tabela, coloana, fk);
  PERFORM pg_temp.r30g_rev_verifica_nou();   -- refuz devreme, fara lock-uri
END $rev$;
SELECT public.fn_red_storage_verifica_redari(true);

-- fereastra de lock: lock_timeout 2 s + statement_timeout 5 s, 15 instructiuni dupa primul LOCK -> cel mult 75 s
SELECT set_config('gazpet.r30g_lock_la', clock_timestamp()::text, true);
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
LOCK TABLE public.red_convocari, public.red_corespondenta, public.red_corespondenta_fisiere, public.red_corespondenta_mailuri, public.red_detinatori,
           public.red_detinatori_contact, public.red_detinatori_token, public.red_import_loturi, public.red_jurnal, public.red_loturi_plicuire, public.red_numere,
           public.red_parcele, public.red_plicuri, public.red_procese_verbale, public.red_proiecte, public.red_raspunsuri, public.red_raspunsuri_meta, public.red_uat IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sms_loturi IN ACCESS EXCLUSIVE MODE;   -- DROP INDEX cere ACCESS EXCLUSIVE
SELECT pg_temp.r30g_rev_garda(), pg_temp.r30g_rev_verifica_nou();   -- autoritar, sub lock-uri
SELECT public.fn_red_storage_verifica_redari(true);

-- politicile: inapoi la forma din 04.11.2026 (apel direct, per rand)
DO $apl$
BEGIN
  PERFORM pg_temp.r30g_rev_garda();
  ALTER POLICY red_convocari_ins ON public.red_convocari WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_convocari_sel ON public.red_convocari USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_convocari_upd ON public.red_convocari USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_ins ON public.red_corespondenta WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_sel ON public.red_corespondenta USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_corespondenta_upd ON public.red_corespondenta USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_detinatori_ins ON public.red_detinatori WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_detinatori_sel ON public.red_detinatori USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_detinatori_upd ON public.red_detinatori USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_contact_ins ON public.red_detinatori_contact WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_contact_sel ON public.red_detinatori_contact USING (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_contact_upd ON public.red_detinatori_contact USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_token_sel ON public.red_detinatori_token USING (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_import_loturi_ins ON public.red_import_loturi WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_import_loturi_sel ON public.red_import_loturi USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_import_loturi_upd ON public.red_import_loturi USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_jurnal_sel ON public.red_jurnal
    USING (public.fn_red_nivel() IS NOT NULL AND (tabela NOT IN ('red_detinatori_contact', 'red_raspunsuri_meta') OR public.fn_red_nivel() IN ('admin', 'editor')));
  ALTER POLICY red_loturi_plicuire_sel ON public.red_loturi_plicuire USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_loturi_plicuire_upd ON public.red_loturi_plicuire USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_numere_sel ON public.red_numere USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_parcele_ins ON public.red_parcele WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_parcele_sel ON public.red_parcele USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_parcele_upd ON public.red_parcele USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_plicuri_sel ON public.red_plicuri USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_plicuri_upd ON public.red_plicuri USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_pv_ins ON public.red_procese_verbale WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_pv_sel ON public.red_procese_verbale USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_pv_upd ON public.red_procese_verbale USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_proiecte_ins ON public.red_proiecte WITH CHECK (public.fn_red_nivel() = 'admin');
  ALTER POLICY red_proiecte_sel ON public.red_proiecte USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_proiecte_upd ON public.red_proiecte USING (public.fn_red_nivel() = 'admin') WITH CHECK (public.fn_red_nivel() = 'admin');
  ALTER POLICY red_raspunsuri_ins ON public.red_raspunsuri WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_raspunsuri_sel ON public.red_raspunsuri USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_raspunsuri_upd ON public.red_raspunsuri USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_meta_ins ON public.red_raspunsuri_meta WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_meta_sel ON public.red_raspunsuri_meta USING (public.fn_red_nivel() IN ('admin', 'editor'));
  ALTER POLICY red_uat_ins ON public.red_uat WITH CHECK (public.fn_red_nivel() = 'admin');
  ALTER POLICY red_uat_sel ON public.red_uat USING (public.fn_red_nivel() IS NOT NULL);
  ALTER POLICY red_uat_upd ON public.red_uat USING (public.fn_red_nivel() = 'admin') WITH CHECK (public.fn_red_nivel() = 'admin');
END $apl$;

DO $d1$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_corespondenta_aprobat_fisier; END $d1$;
DO $d2$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_import_loturi_proiect; END $d2$;
DO $d3$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_loturi_plicuire_proiect; END $d3$;
DO $d4$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_loturi_plicuire_semnatar1; END $d4$;
DO $d5$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_loturi_plicuire_semnatar2; END $d5$;
DO $d6$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_plicuri_uat; END $d6$;
DO $d7$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_red_uat_responsabil; END $d7$;
DO $d8$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_sms_loturi_proiect; END $d8$;
DO $d9$ BEGIN PERFORM pg_temp.r30g_rev_garda(); DROP INDEX public.idx_sms_loturi_uat; END $d9$;

DO $post$
BEGIN
  PERFORM pg_temp.r30g_rev_garda();
  PERFORM pg_temp.r30g_rev_verifica_vechi();
  PERFORM public.fn_red_storage_verifica_redari(true);
  PERFORM set_config('search_path', current_setting('gazpet.r30g_search_path'), true);
END $post$;
