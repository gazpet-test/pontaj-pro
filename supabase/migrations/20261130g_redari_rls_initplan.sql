-- Version 20261130126000. Runner supplies one transaction.
-- 20261130g_redari_rls_initplan — Redări: PERFORMANȚĂ RLS, fără nicio schimbare de drepturi.
-- Problema (citire read-only pe live, 04.11.2026): politicile tabelelor red_* apelează public.fn_red_nivel() (STABLE, SECURITY DEFINER) direct în
-- USING / WITH CHECK, deci funcția se evaluează PE FIECARE RÂND („Filter: (fn_red_nivel() IS NOT NULL)” pe fiecare scan). Ca utilizator real:
-- red_v_centralizator_uat ~0,8–1,1 s, red_v_tronson ~1,05–1,1 s, ultima pagină din registru ~1,4 s.
-- Ce face: (1) ALTER POLICY pe cele 42 de politici red_* din public (inclusiv red_corespondenta_mailuri_sel din 20261130f, aplicată live),
--   cu SINGURA schimbare public.fn_red_nivel() → (select public.fn_red_nivel()) — InitPlan, evaluat o dată pe interogare. Semantica e identică:
--   funcția nu depinde de rând (doar de auth.uid() și de user_module_access / profiles, citite în același snapshot al interogării).
--   (2) 9 indexuri pe FK-uri neindexate (advisor „unindexed_foreign_keys”, verificat pe live 04.11.2026).
-- NU se ating: politicile storage red_storage_* (verificate textual de fn_red_storage_verifica_redari din 20261130e; filtrul bucket_id = 'redari'
--   e primul operand, deci costul per rând e mic și doar pe obiectele bucket-ului) și politicile sms_* (au deja forma ( SELECT fn_sms_e_owner() ...)).
--   Nicio politică red_* nu apelează auth.uid() direct (doar prin fn_red_nivel), deci nu e nimic de schimbat acolo.
--   De ce nu storage: în bucket-ul redari sunt 6 obiecte (din ~15,9k în storage.objects); bucket_id = 'redari' (cost mic) e evaluat înaintea funcției
--   (cost 100), deci fn_red_nivel() rulează doar pe obiectele bucket-ului. Câștig neglijabil vs riscul de a rescrie și verificatorul textual din 30e.
-- Ordinea față de 20261130f (PR #980): 30f e APLICATĂ live (04.11; verificat read-only: red_corespondenta_mailuri există, RLS activ, o singură
--   politică red_corespondenta_mailuri_sel FOR SELECT TO authenticated, PERMISSIVE, „(fn_red_nivel() IS NOT NULL)”). 30g o CERE: baseline-ul are
--   exact 42 de politici (refuz dacă tabelul lipsește). fn_red_coresp_mail_verifica_baza (30f) verifică doar funcții și triggerele red_corespondenta —
--   nu politicile — deci 30g nu îl strică; 30g nu atinge fn_red_nivel / fn_red_jurnal / fn_red_corespondenta_reguli / fn_red_versiune_creste / triggere.
-- Preflight (L15): amprenta fn_red_nivel + auth.uid (corp, limbaj, volatilitate, definer, proconfig, owner, ACL); fiecare politică are EXACT expresia
--   live (deparsată cu search_path = public, pg_temp), roluri {authenticated}, PERMISSIVE, comanda; exact 42 de politici pe red_*; RLS activ pe toate
--   red_* / sms_*, iar pe tabelele atinse relrowsecurity = true și relforcerowsecurity = false; indexurile lipsesc și FK-urile există. Rulează o dată
--   ÎNAINTE de lock-uri (refuz devreme, fără să țină tabele) și încă o dată SUB lock-uri (autoritar, L01) — doar catalog, rapid.
-- Postcondiție (doar catalog): forma nouă exactă pe fiecare politică, tot 42, RLS neschimbat, indexurile valide pe coloana corectă, storage neschimbat.
-- Lock-uri (L06): o singură instrucțiune LOCK, tabelele cu politici în ordine alfabetică, ACCESS EXCLUSIVE (îl cere oricum ALTER POLICY); apoi
--   sms_loturi în SHARE (doar CREATE INDEX). Limita superioară a ferestrei: 15 instrucțiuni × 5 s = 75 s (vezi blocul FEREASTRA).
-- ALTER POLICY e idempotent: fiecare instrucțiune care schimbă schema apelează întâi pg_temp.r30g_garda() (refuz în afara runner-ului).
-- Testat local (PG 17.6, harness cu privilegiile / funcțiile / politicile de pe live): DRY complet, apply → revenire → re-apply, refuz la politică
--   schimbată / politică în plus / a doua aplicare / fără gardă / ACL schimbat / lock ocupat (2 s) / instrucțiune lentă (5 s) / lipsă 30f.
-- Revenire: supabase/revenire/20261130g_redari_rls_initplan_ROLLBACK.sql (același model). DRY: supabase/tests/20261130g_redari_rls_initplan_dryrun*.sql.
-- Atenție: revenirile mai vechi care compară md5-ul politicilor (ex. 20261129a_redari_pv_schema_ROLLBACK) cer întâi revenirea 30g.
-- garda reverificata de fiecare instructiune care modifica schema: aceeasi tranzactie (GUC legat de txid), postgres, preflight-ul rulat (tabela lui
--   temp exista). Rulat in afara runner-ului (autocommit), fiecare instructiune are alt txid -> refuz, nimic nu se aplica fara preflight.
CREATE FUNCTION pg_temp.r30g_garda() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current()
     OR to_regclass('pg_temp.r30g_pol') IS NULL THEN
    RAISE EXCEPTION '20261130g: garda / preflight lipsa in aceasta tranzactie';
  END IF;
END $f$;

CREATE FUNCTION pg_temp.r30g_verifica_vechi() RETURNS void LANGUAGE plpgsql AS $f$
-- doar catalog (rapid): forma veche, per rand
DECLARE v_dif text[]; v_n integer;
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g: search_path neasteptat'; END IF;
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_vechi OR l.w IS DISTINCT FROM b.w_vechi;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: politicile nu sunt cele asteptate (forma veche, per rand): %', v_dif; END IF;
  SELECT count(*) INTO v_n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_';
  IF v_n <> 42 THEN RAISE EXCEPTION '20261130g: % politici pe red_* (asteptat exact 42)', v_n; END IF;
  -- RLS: activ pe toate tabelele red_* / sms_*; pe tabelele atinse exact relrowsecurity = true si relforcerowsecurity = false (baseline live 04.11)
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity)
     OR (SELECT count(*) FROM (VALUES ('red_convocari'), ('red_corespondenta'), ('red_corespondenta_fisiere'), ('red_corespondenta_mailuri'), ('red_detinatori'), ('red_detinatori_contact'), ('red_detinatori_token'), ('red_import_loturi'), ('red_jurnal'), ('red_loturi_plicuire'), ('red_numere'), ('red_parcele'), ('red_plicuri'), ('red_procese_verbale'), ('red_proiecte'), ('red_raspunsuri'), ('red_raspunsuri_meta'), ('red_uat'), ('sms_loturi')) t(n) JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
          WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION '20261130g: configuratia RLS (relrowsecurity / relforcerowsecurity) difera de baseline';
  END IF;
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_idx i WHERE to_regclass('public.' || i.idx) IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                      WHERE c.conrelid = to_regclass('public.' || i.tabela) AND c.conname = i.fk AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND a.attname = i.coloana)
      OR EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                  WHERE x.indrelid = to_regclass('public.' || i.tabela) AND a.attname = i.coloana);
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: indexuri deja existente / FK-uri schimbate: %', v_dif; END IF;
END $f$;

CREATE FUNCTION pg_temp.r30g_verifica_nou() RETURNS void LANGUAGE plpgsql AS $f$
-- doar catalog (rapid): forma noua, InitPlan
DECLARE v_dif text[]; v_n integer;
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g: search_path neasteptat'; END IF;
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_nou OR l.w IS DISTINCT FROM b.w_nou;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: politicile nu sunt cele asteptate (forma noua, InitPlan): %', v_dif; END IF;
  SELECT count(*) INTO v_n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_';
  IF v_n <> 42 THEN RAISE EXCEPTION '20261130g: % politici pe red_* (asteptat exact 42)', v_n; END IF;
  -- RLS: activ pe toate tabelele red_* / sms_*; pe tabelele atinse exact relrowsecurity = true si relforcerowsecurity = false (baseline live 04.11)
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity)
     OR (SELECT count(*) FROM (VALUES ('red_convocari'), ('red_corespondenta'), ('red_corespondenta_fisiere'), ('red_corespondenta_mailuri'), ('red_detinatori'), ('red_detinatori_contact'), ('red_detinatori_token'), ('red_import_loturi'), ('red_jurnal'), ('red_loturi_plicuire'), ('red_numere'), ('red_parcele'), ('red_plicuri'), ('red_procese_verbale'), ('red_proiecte'), ('red_raspunsuri'), ('red_raspunsuri_meta'), ('red_uat'), ('sms_loturi')) t(n) JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
          WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION '20261130g: configuratia RLS (relrowsecurity / relforcerowsecurity) difera de baseline';
  END IF;
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_idx i WHERE NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                      WHERE x.indexrelid = to_regclass('public.' || i.idx) AND x.indrelid = to_regclass('public.' || i.tabela)
                        AND x.indnatts = 1 AND x.indisvalid AND x.indisready AND NOT x.indisunique AND x.indpred IS NULL AND x.indexprs IS NULL
                        AND a.attname = i.coloana)
      OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = to_regclass('public.' || i.idx));
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: indexuri lipsa / gresite: %', v_dif; END IF;
END $f$;

-- PREFLIGHT fara lock-uri pe tabele
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION '20261130g: garda start invalida';
  END IF;
  -- deparsare determinista a expresiilor (fara „public.”), restaurata in postconditie
  PERFORM set_config('gazpet.r30g_search_path', current_setting('search_path'), true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NULL THEN
    RAISE EXCEPTION '20261130g: lipseste fn_red_nivel / fn_red_storage_verifica_redari (30e)';
  END IF;
  IF to_regclass('public.red_corespondenta_mailuri') IS NULL THEN RAISE EXCEPTION '20261130g: lipseste red_corespondenta_mailuri (aplica intai 20261130f)'; END IF;
  -- L15: functia (si callee-ul ei auth.uid()) trebuie sa fie cea revizuita; pe ea se sprijina echivalenta „per rand” = „o data pe interogare”
  --   (STABLE, nu depinde de rand). Baseline live 04.11.2026: corp, limbaj, volatilitate, SECURITY DEFINER, proconfig, owner, ACL EXACT.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE (p.oid = 'public.fn_red_nivel()'::regprocedure AND md5(p.prosrc) = '21db8e5d4b69b7f19e571a7087c361ae' AND l.lanname = 'sql'
              AND p.provolatile = 's' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
              AND p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
          OR (p.oid = 'auth.uid()'::regprocedure AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49' AND l.lanname = 'sql'
              AND p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig IS NULL AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin'
              AND p.proacl::text = '{=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}')) <> 2 THEN
    RAISE EXCEPTION '20261130g: fn_red_nivel / auth.uid nu mai sunt cele din baseline (corp / limbaj / volatilitate / definer / search_path / owner / EXECUTE)';
  END IF;
  -- baseline: expresiile live din 04.11.2026 (N = IS NOT NULL, AE = admin/editor, A = admin, J = jurnal); forma noua = fn_red_nivel() -> InitPlan
  CREATE TEMP TABLE r30g_pol ON COMMIT DROP AS
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
  IF (SELECT count(*) FROM pg_temp.r30g_pol) <> 42 THEN RAISE EXCEPTION '20261130g: baseline incomplet'; END IF;
  CREATE TEMP TABLE r30g_idx ON COMMIT DROP AS
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
  PERFORM pg_temp.r30g_verifica_vechi();   -- refuz devreme, fara lock-uri
END $pre$;
SELECT public.fn_red_storage_verifica_redari(true);   -- storage neschimbat (3 politici red_storage_*), inca fara lock-uri pe tabelele red_*

-- ═══ FEREASTRA DE LOCK — limită superioară EXPLICITĂ (modelul simplu, fără buget dinamic) ═══
-- Totul de mai sus a rulat FĂRĂ lock-uri pe tabele (doar catalog). De aici: lock_timeout 2 s (fiecare așteptare de lock) și statement_timeout 5 s
-- (fiecare instrucțiune, inclusiv LOCK-urile). După primul LOCK urmează exact 15 instrucțiuni (2 LOCK + verificare + storage + ALTER POLICY + 9 × CREATE INDEX + postcondiție), deci tabelele sunt ținute
-- cel mult 15 × 5 s = 75 s (cel mai rău caz teoretic); estimarea reală pe prod: 1–3 s. Momentul de dinaintea primului lock e reținut în
-- gazpet.r30g_lock_la (doar informativ: DRY-ul îl raportează ca NOTICE).
SELECT set_config('gazpet.r30g_lock_la', clock_timestamp()::text, true);
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
LOCK TABLE public.red_convocari, public.red_corespondenta, public.red_corespondenta_fisiere, public.red_corespondenta_mailuri, public.red_detinatori,
           public.red_detinatori_contact, public.red_detinatori_token, public.red_import_loturi, public.red_jurnal, public.red_loturi_plicuire, public.red_numere,
           public.red_parcele, public.red_plicuri, public.red_procese_verbale, public.red_proiecte, public.red_raspunsuri, public.red_raspunsuri_meta, public.red_uat IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sms_loturi IN SHARE MODE;   -- doar CREATE INDEX (cere SHARE); politicile sms_* nu se ating
SELECT pg_temp.r30g_garda(), pg_temp.r30g_verifica_vechi();   -- autoritar, sub lock-uri (L01)
SELECT public.fn_red_storage_verifica_redari(true);

-- (1) politicile: singura schimbare = public.fn_red_nivel() -> (select public.fn_red_nivel()); rolurile / comanda raman (ALTER POLICY fara TO)
DO $apl$
BEGIN
  PERFORM pg_temp.r30g_garda();
  ALTER POLICY red_convocari_ins ON public.red_convocari WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_convocari_sel ON public.red_convocari USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_convocari_upd ON public.red_convocari USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_ins ON public.red_corespondenta WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_sel ON public.red_corespondenta USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_corespondenta_upd ON public.red_corespondenta USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_detinatori_ins ON public.red_detinatori WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_detinatori_sel ON public.red_detinatori USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_detinatori_upd ON public.red_detinatori USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_contact_ins ON public.red_detinatori_contact WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_contact_sel ON public.red_detinatori_contact USING ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_contact_upd ON public.red_detinatori_contact USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_token_sel ON public.red_detinatori_token USING ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_import_loturi_ins ON public.red_import_loturi WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_import_loturi_sel ON public.red_import_loturi USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_import_loturi_upd ON public.red_import_loturi USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_jurnal_sel ON public.red_jurnal
    USING ((select public.fn_red_nivel()) IS NOT NULL AND (tabela NOT IN ('red_detinatori_contact', 'red_raspunsuri_meta') OR (select public.fn_red_nivel()) IN ('admin', 'editor')));
  ALTER POLICY red_loturi_plicuire_sel ON public.red_loturi_plicuire USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_loturi_plicuire_upd ON public.red_loturi_plicuire USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_numere_sel ON public.red_numere USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_parcele_ins ON public.red_parcele WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_parcele_sel ON public.red_parcele USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_parcele_upd ON public.red_parcele USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_plicuri_sel ON public.red_plicuri USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_plicuri_upd ON public.red_plicuri USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_pv_ins ON public.red_procese_verbale WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_pv_sel ON public.red_procese_verbale USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_pv_upd ON public.red_procese_verbale USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_proiecte_ins ON public.red_proiecte WITH CHECK ((select public.fn_red_nivel()) = 'admin');
  ALTER POLICY red_proiecte_sel ON public.red_proiecte USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_proiecte_upd ON public.red_proiecte USING ((select public.fn_red_nivel()) = 'admin') WITH CHECK ((select public.fn_red_nivel()) = 'admin');
  ALTER POLICY red_raspunsuri_ins ON public.red_raspunsuri WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_raspunsuri_sel ON public.red_raspunsuri USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_raspunsuri_upd ON public.red_raspunsuri USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_meta_ins ON public.red_raspunsuri_meta WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_meta_sel ON public.red_raspunsuri_meta USING ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_uat_ins ON public.red_uat WITH CHECK ((select public.fn_red_nivel()) = 'admin');
  ALTER POLICY red_uat_sel ON public.red_uat USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_uat_upd ON public.red_uat USING ((select public.fn_red_nivel()) = 'admin') WITH CHECK ((select public.fn_red_nivel()) = 'admin');

END $apl$;

-- (2) indexuri pe FK-urile neindexate, fiecare o instructiune (fara CONCURRENTLY: runner-ul e o tranzactie; tabele sub ~2,6k randuri)
DO $i1$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_corespondenta_aprobat_fisier ON public.red_corespondenta (aprobat_fisier_id); END $i1$;
DO $i2$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_import_loturi_proiect ON public.red_import_loturi (proiect_id); END $i2$;
DO $i3$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_loturi_plicuire_proiect ON public.red_loturi_plicuire (proiect_id); END $i3$;
DO $i4$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_loturi_plicuire_semnatar1 ON public.red_loturi_plicuire (semnatar1_id); END $i4$;
DO $i5$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_loturi_plicuire_semnatar2 ON public.red_loturi_plicuire (semnatar2_id); END $i5$;
DO $i6$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_plicuri_uat ON public.red_plicuri (uat_id); END $i6$;
DO $i7$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_red_uat_responsabil ON public.red_uat (responsabil_id); END $i7$;
DO $i8$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_sms_loturi_proiect ON public.sms_loturi (proiect_id); END $i8$;
DO $i9$ BEGIN PERFORM pg_temp.r30g_garda(); CREATE INDEX idx_sms_loturi_uat ON public.sms_loturi (uat_id); END $i9$;

-- POSTCONDITIE (doar catalog)
DO $post$
BEGIN
  PERFORM pg_temp.r30g_garda();
  PERFORM pg_temp.r30g_verifica_nou();
  PERFORM public.fn_red_storage_verifica_redari(true);
  PERFORM set_config('search_path', current_setting('gazpet.r30g_search_path'), true);
END $post$;
