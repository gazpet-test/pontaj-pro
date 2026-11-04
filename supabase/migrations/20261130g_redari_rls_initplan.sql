-- Version 20261130126000. Runner supplies one transaction.
-- 20261130g_redari_rls_initplan — Redări: PERFORMANȚĂ RLS, fără nicio schimbare de drepturi.
-- Problema (citire read-only pe live, 04.11.2026): politicile tabelelor red_* apelează public.fn_red_nivel() (STABLE, SECURITY DEFINER) direct în
-- USING / WITH CHECK, deci funcția se evaluează PE FIECARE RÂND („Filter: (fn_red_nivel() IS NOT NULL)” pe fiecare scan). Ca utilizator real:
-- red_v_centralizator_uat ~0,8–1,1 s, red_v_tronson ~1,05–1,1 s, ultima pagină din registru ~1,4 s.
-- Ce face: (1) ALTER POLICY pe cele 41 de politici red_* din public (+ red_corespondenta_mailuri_sel din 20261130f, DOAR dacă tabelul există),
--   cu SINGURA schimbare public.fn_red_nivel() → (select public.fn_red_nivel()) — InitPlan, evaluat o dată pe interogare. Semantica e identică:
--   funcția nu depinde de rând (doar de auth.uid() și de user_module_access / profiles, citite în același snapshot al interogării).
--   (2) 9 indexuri pe FK-uri neindexate (advisor „unindexed_foreign_keys”, verificat pe live 04.11.2026).
-- NU se ating: politicile storage red_storage_* (verificate textual de fn_red_storage_verifica_redari din 20261130e; filtrul bucket_id = 'redari'
--   e primul operand, deci costul per rând e mic și doar pe obiectele bucket-ului) și politicile sms_* (au deja forma ( SELECT fn_sms_e_owner() ...)).
--   Nicio politică red_* nu apelează auth.uid() direct (doar prin fn_red_nivel), deci nu e nimic de schimbat acolo.
--   De ce nu storage: în bucket-ul redari sunt 6 obiecte (din ~15,9k în storage.objects); bucket_id = 'redari' (cost mic) e evaluat înaintea funcției
--   (cost 100), deci fn_red_nivel() rulează doar pe obiectele bucket-ului. Câștig neglijabil vs riscul de a rescrie și verificatorul textual din 30e.
-- Ordinea față de 20261130f (PR #980): 30f apoi 30g. La 04.11 seara 30f e APLICATĂ live (verificat read-only: red_corespondenta_mailuri există,
--   RLS activ, o singură politică red_corespondenta_mailuri_sel FOR SELECT TO authenticated, PERMISSIVE, „(fn_red_nivel() IS NOT NULL)” → 42 de politici). Dacă 30g se aplică înainte, politica red_corespondenta_mailuri_sel rămâne
--   în forma per rând (corectă, doar mai lentă) și se tratează într-o migrare ulterioară; revenirea 30g acceptă ambele forme pe acea politică.
--   fn_red_coresp_mail_verifica_baza (30f) verifică doar funcții (md5 corp, ACL, owner) și triggerele red_corespondenta — nu politicile — deci 30g
--   nu îl strică; 30g nu atinge fn_red_nivel / fn_red_jurnal / fn_red_corespondenta_reguli / fn_red_versiune_creste și niciun trigger.
-- Preflight: fiecare politică are EXACT expresia live din 04.11.2026 (deparsată cu search_path = public, pg_temp), roluri {authenticated}, PERMISSIVE,
--   comanda așteptată, numărul de politici red_* neschimbat; indexurile lipsesc și FK-urile există. Altfel refuz (cineva a schimbat schema între timp).
-- Postcondiție: forma nouă exactă pe fiecare politică, același număr de politici, RLS activ pe toate tabelele red_* / sms_*, storage neschimbat,
--   indexurile valide pe coloana corectă.
-- Ordinea lock-urilor (L06): tabelele în ordine alfabetică, ACCESS EXCLUSIVE, înainte de orice verificare.
-- ALTER POLICY e idempotent, deci rulat în afara runner-ului (autocommit, fără ON_ERROR_STOP) s-ar aplica fără preflight: de aceea politicile și
--   indexurile stau într-un bloc DO care reverifică garda și existența tabelei temp a preflight-ului din ACEEAȘI tranzacție (testat local).
-- Testat local (PG 17.6, harness cu stub-uri, expresii identice cu live): DRY complet, apply → revenire → re-apply, cu / fără red_corespondenta_mailuri
--   (30f înainte și după 30g), refuz la politică schimbată / politică în plus / a doua aplicare / fără gardă.
-- Revenire: supabase/revenire/20261130g_redari_rls_initplan_ROLLBACK.sql. DRY: supabase/tests/20261130g_redari_rls_initplan_dryrun.sql.
-- Atenție: revenirile mai vechi care compară md5-ul politicilor (ex. 20261129a_redari_pv_schema_ROLLBACK) cer întâi revenirea 30g.
DO $pre$
DECLARE v_lipsa text[]; v_dif text[]; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION '20261130g: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- deparsare determinista a expresiilor (fara „public.”), restaurata in postconditie
  PERFORM set_config('gazpet.r30g_search_path', current_setting('search_path'), true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NULL THEN
    RAISE EXCEPTION '20261130g: lipseste fn_red_nivel / fn_red_storage_verifica_redari (30e)';
  END IF;
  -- L15: functia (si callee-ul ei auth.uid()) trebuie sa fie cea revizuita; pe ea se sprijina echivalenta „per rand” = „o data pe interogare”
  --   (STABLE, nu depinde de rand). Baseline live 04.11.2026: corp, limbaj, volatilitate, SECURITY DEFINER, proconfig, owner, ACL EXACT.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE (p.oid = 'public.fn_red_nivel()'::regprocedure AND md5(p.prosrc) = '21db8e5d4b69b7f19e571a7087c361ae' AND l.lanname = 'sql'
              AND p.provolatile = 's' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
              AND p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
          OR (p.oid = 'auth.uid()'::regprocedure AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49' AND l.lanname = 'sql'
              AND p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig IS NULL AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin')) <> 2 THEN
    RAISE EXCEPTION '20261130g: fn_red_nivel / auth.uid nu mai sunt cele din baseline (corp / limbaj / volatilitate / definer / search_path / owner / EXECUTE)';
  END IF;
  -- L06: lock-uri in ordine alfabetica, inainte de verificari
  LOCK TABLE public.red_convocari, public.red_corespondenta, public.red_corespondenta_fisiere IN ACCESS EXCLUSIVE MODE;
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL THEN LOCK TABLE public.red_corespondenta_mailuri IN ACCESS EXCLUSIVE MODE; END IF;
  LOCK TABLE public.red_detinatori, public.red_detinatori_contact, public.red_detinatori_token, public.red_import_loturi, public.red_jurnal,
             public.red_loturi_plicuire, public.red_numere, public.red_parcele, public.red_plicuri, public.red_procese_verbale, public.red_proiecte,
             public.red_raspunsuri, public.red_raspunsuri_meta, public.red_uat, public.sms_loturi IN ACCESS EXCLUSIVE MODE;

  -- baseline: expresiile live din 04.11.2026 (N = IS NOT NULL, AE = admin/editor, A = admin, J = jurnal); forma noua = fn_red_nivel() -> InitPlan
  CREATE TEMP TABLE r30g_pol ON COMMIT DROP AS
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
  SELECT b.tabela, b.politica, b.cmd::"char" AS cmd, kq.expr AS q_vechi, kw.expr AS w_vechi,
         replace(kq.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS q_nou,
         replace(kw.expr, 'fn_red_nivel()', '( SELECT fn_red_nivel() AS fn_red_nivel)') AS w_nou
    FROM b LEFT JOIN k kq ON kq.cod = b.q LEFT JOIN k kw ON kw.cod = b.w
   WHERE NOT b.optional OR to_regclass('public.' || b.tabela) IS NOT NULL;
  SELECT count(*) INTO v_n FROM pg_temp.r30g_pol;
  IF v_n NOT IN (41, 42) THEN RAISE EXCEPTION '20261130g: baseline incomplet (%)', v_n; END IF;

  -- live = baseline, pe ambele directii (nicio politica lipsa, nicio politica in plus pe tabelele red_*)
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'red\_%') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_vechi OR l.w IS DISTINCT FROM b.w_vechi;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: politicile live difera de baseline-ul din 04.11.2026: %', v_dif; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity) THEN
    RAISE EXCEPTION '20261130g: exista tabele red_* / sms_* fara RLS';
  END IF;

  -- indexurile: numele lipsesc, FK-ul exista pe exact coloana asteptata si nicio alta cheie de index nu incepe cu ea
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
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_lipsa FROM pg_temp.r30g_idx i
   WHERE to_regclass('public.' || i.idx) IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                      WHERE c.conrelid = to_regclass('public.' || i.tabela) AND c.conname = i.fk AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND a.attname = i.coloana)
      OR EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                  WHERE x.indrelid = to_regclass('public.' || i.tabela) AND a.attname = i.coloana);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION '20261130g: indexuri deja existente / FK-uri schimbate: %', v_lipsa; END IF;
END $pre$;
SELECT public.fn_red_storage_verifica_redari(true);   -- storage neschimbat (3 politici red_storage_*, predicatele din 26a / 30e)

DO $apl$
BEGIN
  -- aceeasi garda ca preflight-ul + dovada ca preflight-ul a rulat in ACEEASI tranzactie (tabela temp a lui): rulat in afara runner-ului
  -- (autocommit, fara ON_ERROR_STOP), blocul refuza in loc sa aplice politicile / indexurile fara verificari
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() OR to_regclass('pg_temp.r30g_pol') IS NULL THEN
    RAISE EXCEPTION '20261130g: garda / preflight lipsa in aceasta tranzactie';
  END IF;
-- (1) politicile: singura schimbare = public.fn_red_nivel() -> (select public.fn_red_nivel()); rolurile / comanda raman (ALTER POLICY fara TO)
  ALTER POLICY red_convocari_ins ON public.red_convocari WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_convocari_sel ON public.red_convocari USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_convocari_upd ON public.red_convocari USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_ins ON public.red_corespondenta WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_sel ON public.red_corespondenta USING ((select public.fn_red_nivel()) IS NOT NULL);
  ALTER POLICY red_corespondenta_upd ON public.red_corespondenta USING ((select public.fn_red_nivel()) IN ('admin', 'editor')) WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_ins ON public.red_corespondenta_fisiere WITH CHECK ((select public.fn_red_nivel()) IN ('admin', 'editor'));
  ALTER POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere USING ((select public.fn_red_nivel()) IS NOT NULL);
  IF to_regclass('public.red_corespondenta_mailuri') IS NOT NULL THEN   -- 20261130f aplicata inainte
    ALTER POLICY red_corespondenta_mailuri_sel ON public.red_corespondenta_mailuri USING ((select public.fn_red_nivel()) IS NOT NULL);
  END IF;
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

-- (2) indexuri pe FK-urile neindexate (fara CONCURRENTLY: runner-ul e o tranzactie, tabelele sunt mici — sub ~2,6k randuri)
  CREATE INDEX idx_red_corespondenta_aprobat_fisier ON public.red_corespondenta (aprobat_fisier_id);
  CREATE INDEX idx_red_import_loturi_proiect ON public.red_import_loturi (proiect_id);
  CREATE INDEX idx_red_loturi_plicuire_proiect ON public.red_loturi_plicuire (proiect_id);
  CREATE INDEX idx_red_loturi_plicuire_semnatar1 ON public.red_loturi_plicuire (semnatar1_id);
  CREATE INDEX idx_red_loturi_plicuire_semnatar2 ON public.red_loturi_plicuire (semnatar2_id);
  CREATE INDEX idx_red_plicuri_uat ON public.red_plicuri (uat_id);
  CREATE INDEX idx_red_uat_responsabil ON public.red_uat (responsabil_id);
  CREATE INDEX idx_sms_loturi_proiect ON public.sms_loturi (proiect_id);
  CREATE INDEX idx_sms_loturi_uat ON public.sms_loturi (uat_id);
END $apl$;

DO $post$
DECLARE v_dif text[];
BEGIN
  IF current_setting('search_path') IS DISTINCT FROM 'public, pg_temp' THEN RAISE EXCEPTION '20261130g: search_path schimbat in timpul migrarii'; END IF;
  -- fiecare politica are EXACT forma noua, aceleasi roluri / comanda, nicio politica noua sau disparuta
  SELECT array_agg(coalesce(b.politica, l.polname::text) ORDER BY coalesce(b.politica, l.polname::text)) INTO v_dif
    FROM pg_temp.r30g_pol b
    FULL JOIN (SELECT c.relname::text AS tabela, p.polname, p.polcmd, p.polpermissive, p.polroles,
                      pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
                 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'red\_%') l
      ON l.tabela = b.tabela AND l.polname::text = b.politica
   WHERE b.politica IS NULL OR l.polname IS NULL OR l.polcmd IS DISTINCT FROM b.cmd OR NOT l.polpermissive
      OR l.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] OR l.q IS DISTINCT FROM b.q_nou OR l.w IS DISTINCT FROM b.w_nou;
  -- (egalitatea exacta pe ambele directii acopera toate politicile red_* din public: nicio verificare regex pe text SQL, L15)
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: politicile nu au forma noua: %', v_dif; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND relname ~ '^(red|sms)_' AND NOT relrowsecurity) THEN
    RAISE EXCEPTION '20261130g: RLS oprit pe un tabel red_* / sms_*';
  END IF;
  -- indexurile: exista, valide, ne-unice, fara predicat, exact o coloana = coloana FK
  SELECT array_agg(i.idx ORDER BY i.idx) INTO v_dif FROM pg_temp.r30g_idx i
   WHERE NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
                      WHERE x.indexrelid = to_regclass('public.' || i.idx) AND x.indrelid = to_regclass('public.' || i.tabela)
                        AND x.indnatts = 1 AND x.indisvalid AND x.indisready AND NOT x.indisunique AND x.indpred IS NULL AND x.indexprs IS NULL
                        AND a.attname = i.coloana);
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261130g: indexuri lipsa / gresite: %', v_dif; END IF;
  PERFORM public.fn_red_storage_verifica_redari(true);
  PERFORM set_config('search_path', current_setting('gazpet.r30g_search_path'), true);
END $post$;
