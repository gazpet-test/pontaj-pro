-- Revenire 20261130g_redari_rls_initplan. Runner: o tranzactie, GUC gazpet.revenire_20261130g = 'REDARI_RLS_INITPLAN_SCOASA:'||txid_current().
-- Readuce EXACT expresiile politicilor red_* din 04.11.2026 (public.fn_red_nivel() direct, per rand) si scoate cele 9 indexuri create de 30g.
-- Nu atinge date, drepturi, functii sau politicile storage / sms_* (30g nu le-a schimbat). Garda: expresiile curente trebuie sa fie EXACT cele
-- puse de 30g (altfel cineva le-a schimbat intre timp -> refuz), iar indexurile exact cele create de 30g. Lock-uri in ordine alfabetica (L06 / L14).
-- red_corespondenta_mailuri_sel (20261130f) se readuce doar daca tabelul exista (simetric cu migrarea). Daca 30f a fost aplicata DUPA 30g,
-- politica ei e inca in forma veche (creata asa de 30f): garda accepta DOAR pe acea politica forma veche sau noua (ambele legitime), restul strict.
-- Testat local (PG 17.6, harness cu stub-uri): apply -> revenire -> re-apply, cu si fara red_corespondenta_mailuri.
DO $rev$
DECLARE v_dif text[]; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130g', true) IS DISTINCT FROM 'REDARI_RLS_INITPLAN_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261130g revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('gazpet.r30g_search_path', current_setting('search_path'), true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NULL THEN RAISE EXCEPTION '20261130g revenire: lipseste verificatorul storage (30e)'; END IF;
  -- L06 / L14: lock-uri in ordine alfabetica, inainte de verificari
  LOCK TABLE public.red_convocari, public.red_corespondenta, public.red_corespondenta_fisiere IN ACCESS EXCLUSIVE MODE;
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL THEN LOCK TABLE public.red_corespondenta_mailuri IN ACCESS EXCLUSIVE MODE; END IF;
  LOCK TABLE public.red_detinatori, public.red_detinatori_contact, public.red_detinatori_token, public.red_import_loturi, public.red_jurnal,
             public.red_loturi_plicuire, public.red_numere, public.red_parcele, public.red_plicuri, public.red_procese_verbale, public.red_proiecte,
             public.red_raspunsuri, public.red_raspunsuri_meta, public.red_uat, public.sms_loturi IN ACCESS EXCLUSIVE MODE;

  -- acelasi baseline ca in migrare (copiat textual din 20261130g)
  CREATE TEMP TABLE r30g_rev_pol ON COMMIT DROP AS
  WITH k(cod, expr) AS (VALUES
      ('N',  '(fn_red_nivel() IS NOT NULL)'),
      ('AE', '(fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text]))'),
      ('A',  '(fn_red_nivel() = ''admin''::text)'),
      ('J',  '((fn_red_nivel() IS NOT NULL) AND ((tabela <> ALL (ARRAY[''red_detinatori_contact''::text, ''red_raspunsuri_meta''::text])) OR (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text]))))')),
  b(tabela, politica, cmd, q, w, optional) AS (VALUES
      ('red_convocari', 'red_convocari_ins', 'a', NULL, 'AE', false), ('red_convocari', 'red_convocari_sel', 'r', 'N', NULL, false),
      ('red_convocari', 'red_convocari_upd', 'w', 'AE', 'AE', false),
      ('red_corespondenta', 'red_corespondenta_ins', 'a', NULL, 'AE', false), ('red_corespondenta', 'red_corespondenta_sel', 'r', 'N', NULL, false),
      ('red_corespondenta', 'red_corespondenta_upd', 'w', 'AE', 'AE', false),
      ('red_corespondenta_fisiere', 'red_corespondenta_fisiere_ins', 'a', NULL, 'AE', false),
      ('red_corespondenta_fisiere', 'red_corespondenta_fisiere_sel', 'r', 'N', NULL, false),
      ('red_corespondenta_mailuri', 'red_corespondenta_mailuri_sel', 'r', 'N', NULL, true),   -- 20261130f (PR #980), doar daca exista
      ('red_detinatori', 'red_detinatori_ins', 'a', NULL, 'AE', false), ('red_detinatori', 'red_detinatori_sel', 'r', 'N', NULL, false),
      ('red_detinatori', 'red_detinatori_upd', 'w', 'AE', 'AE', false),
      ('red_detinatori_contact', 'red_contact_ins', 'a', NULL, 'AE', false), ('red_detinatori_contact', 'red_contact_sel', 'r', 'AE', NULL, false),
      ('red_detinatori_contact', 'red_contact_upd', 'w', 'AE', 'AE', false),
      ('red_detinatori_token', 'red_token_sel', 'r', 'AE', NULL, false),
      ('red_import_loturi', 'red_import_loturi_ins', 'a', NULL, 'AE', false), ('red_import_loturi', 'red_import_loturi_sel', 'r', 'N', NULL, false),
      ('red_import_loturi', 'red_import_loturi_upd', 'w', 'AE', 'AE', false),
      ('red_jurnal', 'red_jurnal_sel', 'r', 'J', NULL, false),
      ('red_loturi_plicuire', 'red_loturi_plicuire_sel', 'r', 'N', NULL, false), ('red_loturi_plicuire', 'red_loturi_plicuire_upd', 'w', 'AE', 'AE', false),
      ('red_numere', 'red_numere_sel', 'r', 'N', NULL, false),
      ('red_parcele', 'red_parcele_ins', 'a', NULL, 'AE', false), ('red_parcele', 'red_parcele_sel', 'r', 'N', NULL, false),
      ('red_parcele', 'red_parcele_upd', 'w', 'AE', 'AE', false),
      ('red_plicuri', 'red_plicuri_sel', 'r', 'N', NULL, false), ('red_plicuri', 'red_plicuri_upd', 'w', 'AE', 'AE', false),
      ('red_procese_verbale', 'red_pv_ins', 'a', NULL, 'AE', false), ('red_procese_verbale', 'red_pv_sel', 'r', 'N', NULL, false),
      ('red_procese_verbale', 'red_pv_upd', 'w', 'AE', 'AE', false),
      ('red_proiecte', 'red_proiecte_ins', 'a', NULL, 'A', false), ('red_proiecte', 'red_proiecte_sel', 'r', 'N', NULL, false),
      ('red_proiecte', 'red_proiecte_upd', 'w', 'A', 'A', false),
      ('red_raspunsuri', 'red_raspunsuri_ins', 'a', NULL, 'AE', false), ('red_raspunsuri', 'red_raspunsuri_sel', 'r', 'N', NULL, false),
      ('red_raspunsuri', 'red_raspunsuri_upd', 'w', 'AE', 'AE', false),
      ('red_raspunsuri_meta', 'red_meta_ins', 'a', NULL, 'AE', false), ('red_raspunsuri_meta', 'red_meta_sel', 'r', 'AE', NULL, false),
      ('red_uat', 'red_uat_ins', 'a', NULL, 'A', false), ('red_uat', 'red_uat_sel', 'r', 'N', NULL, false),
      ('red_uat', 'red_uat_upd', 'w', 'A', 'A', false))
  SELECT b.tabela, b.politica, b.optional, b.cmd::"char" AS cmd, kq.expr AS q_vechi, kw.expr AS w_vechi,
         replace(kq.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS q_nou,
         replace(kw.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS w_nou
    FROM b LEFT JOIN k kq ON kq.cod = b.q LEFT JOIN k kw ON kw.cod = b.w
   WHERE NOT b.optional OR to_regclass('public.' || b.tabela) IS NOT NULL;
  SELECT count(*) INTO v_n FROM pg_temp.r30g_rev_pol;
  IF v_n NOT IN (41, 42) THEN RAISE EXCEPTION '20261130g revenire: baseline incomplet (%)', v_n; END IF;
  -- garda: live = forma NOUA (cea pusa de 30g), pe ambele directii
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_rev_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'red\_%') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
      OR ((l.q IS DISTINCT FROM b.q_nou OR l.w IS DISTINCT FROM b.w_nou)
          AND NOT (b.optional AND l.q IS NOT DISTINCT FROM b.q_vechi AND l.w IS NOT DISTINCT FROM b.w_vechi));   -- doar mailuri: 30f aplicata dupa 30g
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: politicile nu sunt cele puse de 30g: %', v_dif; END IF;

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
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_rev_idx i
   WHERE NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                      WHERE x.indexrelid = to_regclass('public.' || i.idx) AND x.indrelid = to_regclass('public.' || i.tabela)
                        AND x.indnatts = 1 AND NOT x.indisunique AND x.indpred IS NULL AND x.indexprs IS NULL AND a.attname = i.coloana)
      OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = to_regclass('public.' || i.idx));   -- nicio constrangere nu foloseste indexul
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: indexurile nu sunt cele create de 30g: %', v_dif; END IF;
END $rev$;
SELECT public.fn_red_storage_verifica_redari(true);

-- politicile: inapoi la forma din 04.11.2026 (apel direct, per rand)
ALTER POLICY red_convocari_ins ON public.red_convocari WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
ALTER POLICY red_convocari_sel ON public.red_convocari USING (public.fn_red_nivel() IS NOT NULL);
ALTER POLICY red_convocari_upd ON public.red_convocari USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
ALTER POLICY red_corespondenta_ins ON public.red_corespondenta WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
ALTER POLICY red_corespondenta_sel ON public.red_corespondenta USING (public.fn_red_nivel() IS NOT NULL);
ALTER POLICY red_corespondenta_upd ON public.red_corespondenta USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
ALTER POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
ALTER POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere USING (public.fn_red_nivel() IS NOT NULL);
DO $mail$
BEGIN
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL THEN   -- simetric cu migrarea
    ALTER POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri USING (public.fn_red_nivel() IS NOT NULL);
  END IF;
END $mail$;
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


DROP INDEX public.idx_red_corespondenta_aprobat_fisier;
DROP INDEX public.idx_red_import_loturi_proiect;
DROP INDEX public.idx_red_loturi_plicuire_proiect;
DROP INDEX public.idx_red_loturi_plicuire_semnatar1;
DROP INDEX public.idx_red_loturi_plicuire_semnatar2;
DROP INDEX public.idx_red_plicuri_uat;
DROP INDEX public.idx_red_uat_responsabil;
DROP INDEX public.idx_sms_loturi_proiect;
DROP INDEX public.idx_sms_loturi_uat;

DO $post$
DECLARE v_dif text[];
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g revenire: search_path schimbat'; END IF;
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_rev_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'red\_%') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_vechi OR l.w IS DISTINCT FROM b.w_vechi;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g revenire: politicile nu au revenit la forma veche: %', v_dif; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.r30g_rev_idx i WHERE to_regclass('public.' || i.idx) IS NOT NULL) THEN RAISE EXCEPTION '20261130g revenire: indexuri ramase'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity) THEN
    RAISE EXCEPTION '20261130g revenire: RLS oprit pe un tabel red_* / sms_*';
  END IF;
  PERFORM public.fn_red_storage_verifica_redari(true);
  PERFORM set_config('search_path', current_setting('gazpet.r30g_search_path'), true);
END $post$;
