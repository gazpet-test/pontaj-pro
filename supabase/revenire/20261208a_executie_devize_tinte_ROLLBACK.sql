-- Revenire 20261208a_executie_devize_tinte. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: vederea v_executie_tinte, tabelul executie_tinte_setari, cele 14 funcții (fn_executie_tinte_*,
-- fn_raport_lucrari_*, fn_raport_santier_drept), trigger-ele de gardă, coloanele noi de pe proiect_unitati / proiect_activitati
-- (cu constrângerile și indexurile lor) și redă authenticated scrierea directă în raport_lucrari (INSERT / UPDATE / DELETE, ca înainte).
-- anon NU primește înapoi scrierea retrasă de migrare (n-o putea folosi: politicile tabelului cer auth.uid()); e singura asimetrie, voită.
-- REFUZĂ dacă există configurare scrisă după migrare (setări, obiecte / noduri / perioade legate, activități principale sau cu factor,
-- sursă, bază, DN): ar dispărea în tăcere. Golirea ei e o decizie separată (preview -> „da” Răzvan -> apply, cu export înainte).
-- Liniile din raport_lucrari NU se ating (nici cele salvate prin RPC, pe mai multe obiecte): rămân date valide.
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261208a', 'SCOATE_DEVIZE_TINTE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261208a SCOATE_DEVIZE_TINTE
-- Ordinea lock-urilor: proiect_activitati, proiect_unitati, executie_tinte_setari, raport_lucrari — ACCESS EXCLUSIVE NOWAIT, ÎNAINTEA
-- verificării „fără configurare” (o scriere concurentă nu poate fi numărată 0 și apoi pierdută la DROP COLUMN). Ocupat = 55P03, nimic scris.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261208a', true) IS DISTINCT FROM 'SCOATE_DEVIZE_TINTE:' || txid_current() THEN
    RAISE EXCEPTION '20261208a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261208a=%') THEN
    RAISE EXCEPTION '20261208a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261208a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: vederea, tabelul, cele 14 funcții, trigger-ele, coloanele
  IF to_regclass('public.v_executie_tinte') IS NULL OR to_regclass('public.executie_tinte_setari') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_drept(bigint, text)') IS NULL
     OR to_regprocedure('public.fn_raport_santier_drept(bigint)') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_garda_cere(bigint[])') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_garda_activitati()') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_garda_unitati()') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_setari_prov()') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_cheie(bigint, bigint)') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_conversie(text, text)') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_nod(bigint, date)') IS NULL
     OR to_regprocedure('public.fn_executie_tinte_calcul()') IS NULL
     OR to_regprocedure('public.fn_raport_lucrari_amprenta_linii(jsonb)') IS NULL
     OR to_regprocedure('public.fn_raport_lucrari_json(bigint)') IS NULL
     OR to_regprocedure('public.fn_raport_lucrari_citeste(bigint)') IS NULL
     OR to_regprocedure('public.fn_raport_lucrari_salveaza(bigint, text, jsonb)') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_lucrari_citeste', 'fn_raport_lucrari_salveaza']::name[])) <> 14
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.proiect_activitati'::regclass AND tgname = 'trg_executie_tinte_garda_activitati')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.proiect_unitati'::regclass AND tgname = 'trg_executie_tinte_garda_unitati')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proiect_unitati'
          AND column_name IN ('obiect_cod', 'nod_cod', 'plan_start', 'plan_final')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proiect_activitati'
          AND column_name IN ('principala', 'factor_um', 'sursa_executat', 'baza_deviz', 'dn_min', 'dn_max')) <> 6 THEN
    RAISE EXCEPTION '20261208a revenire: starea nu e cea din 20261208a';
  END IF;
  -- nimic altceva nu depinde de obiectele scoase: vederi peste vedere / tabel / coloanele noi, politici sau funcții care le cheamă
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND w.ev_class <> 'public.v_executie_tinte'::regclass
                AND (d.refobjid IN ('public.v_executie_tinte'::regclass, 'public.executie_tinte_setari'::regclass)
                     OR (d.refobjid = 'public.proiect_unitati'::regclass AND d.refobjsubid IN (
                           SELECT attnum FROM pg_attribute WHERE attrelid = 'public.proiect_unitati'::regclass
                              AND attname IN ('obiect_cod', 'nod_cod', 'plan_start', 'plan_final')))
                     OR (d.refobjid = 'public.proiect_activitati'::regclass AND d.refobjsubid IN (
                           SELECT attnum FROM pg_attribute WHERE attrelid = 'public.proiect_activitati'::regclass
                              AND attname IN ('principala', 'factor_um', 'sursa_executat', 'baza_deviz', 'dn_min', 'dn_max')))))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'executie_tinte_setari')
                 AND coalesce(qual, '') || coalesce(with_check, '') ~ '(fn_executie_tinte_|fn_raport_lucrari_|fn_raport_santier_drept)')
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
                 WHERE d.classid = 'pg_proc'::regclass AND d.refclassid = 'pg_proc'::regclass
                   AND d.refobjid IN (SELECT p2.oid FROM pg_proc p2 JOIN pg_namespace n2 ON n2.oid = p2.pronamespace WHERE n2.nspname = 'public'
                                        AND p2.proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_lucrari_citeste', 'fn_raport_lucrari_salveaza']::name[]))
                   AND NOT p.proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_lucrari_citeste', 'fn_raport_lucrari_salveaza']::name[])) THEN
    RAISE EXCEPTION '20261208a revenire: alte obiecte depind de vedere / tabel / coloane / functii';
  END IF;
  LOCK TABLE public.proiect_activitati IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.proiect_unitati IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.executie_tinte_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.raport_lucrari IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.executie_tinte_setari) THEN
    RAISE EXCEPTION '20261208a revenire: exista setari de alerte (executie_tinte_setari) — decizie separata inainte';
  END IF;
  IF EXISTS (SELECT 1 FROM public.proiect_unitati WHERE obiect_cod IS NOT NULL OR nod_cod IS NOT NULL OR plan_start IS NOT NULL OR plan_final IS NOT NULL) THEN
    RAISE EXCEPTION '20261208a revenire: exista obiecte legate de deviz / noduri / perioade de plan — decizie separata inainte';
  END IF;
  IF EXISTS (SELECT 1 FROM public.proiect_activitati WHERE principala OR factor_um <> 1 OR sursa_executat <> 'raport' OR baza_deviz <> 'revizuita'
                                                        OR dn_min IS NOT NULL OR dn_max IS NOT NULL) THEN
    RAISE EXCEPTION '20261208a revenire: exista activitati configurate ca tinte — decizie separata inainte';
  END IF;
  -- scoaterea (fără CASCADE): întâi ce depinde, apoi ce e dependență
  DROP VIEW public.v_executie_tinte;
  DROP TRIGGER trg_executie_tinte_garda_activitati ON public.proiect_activitati;
  DROP TRIGGER trg_executie_tinte_garda_unitati ON public.proiect_unitati;
  DROP TABLE public.executie_tinte_setari;   -- cu trigger-ul de proveniență și politicile lui
  DROP FUNCTION public.fn_executie_tinte_calcul();
  DROP FUNCTION public.fn_executie_tinte_nod(bigint, date);
  DROP FUNCTION public.fn_executie_tinte_cheie(bigint, bigint);
  DROP FUNCTION public.fn_executie_tinte_conversie(text, text);
  DROP FUNCTION public.fn_raport_lucrari_salveaza(bigint, text, jsonb);
  DROP FUNCTION public.fn_raport_lucrari_citeste(bigint);
  DROP FUNCTION public.fn_raport_lucrari_json(bigint);
  DROP FUNCTION public.fn_raport_lucrari_amprenta_linii(jsonb);
  DROP FUNCTION public.fn_executie_tinte_garda_activitati();
  DROP FUNCTION public.fn_executie_tinte_garda_unitati();
  DROP FUNCTION public.fn_executie_tinte_setari_prov();
  DROP FUNCTION public.fn_executie_tinte_garda_cere(bigint[]);
  DROP FUNCTION public.fn_executie_tinte_drept(bigint, text);
  DROP FUNCTION public.fn_raport_santier_drept(bigint);
  ALTER TABLE public.proiect_unitati
    DROP CONSTRAINT proiect_unitati_tinta_obiect_ck, DROP CONSTRAINT proiect_unitati_tinta_nod_ck, DROP CONSTRAINT proiect_unitati_tinta_plan_ck,
    DROP COLUMN obiect_cod, DROP COLUMN nod_cod, DROP COLUMN plan_start, DROP COLUMN plan_final;   -- indexurile parțiale cad cu coloanele
  ALTER TABLE public.proiect_activitati
    DROP CONSTRAINT proiect_activitati_tinta_factor_ck, DROP CONSTRAINT proiect_activitati_tinta_sursa_ck,
    DROP CONSTRAINT proiect_activitati_tinta_baza_ck, DROP CONSTRAINT proiect_activitati_tinta_dn_ck,
    DROP COLUMN principala, DROP COLUMN factor_um, DROP COLUMN sursa_executat, DROP COLUMN baza_deviz, DROP COLUMN dn_min, DROP COLUMN dn_max;
  -- scrierea directă, ca înainte de migrare (preflight-ul migrării a confirmat că authenticated le avea pe toate trei)
  GRANT INSERT, UPDATE, DELETE ON public.raport_lucrari TO authenticated;
  -- postcondiție
  IF to_regclass('public.v_executie_tinte') IS NOT NULL OR to_regclass('public.executie_tinte_setari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_lucrari_citeste', 'fn_raport_lucrari_salveaza']::name[]))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_executie_tinte_garda_activitati', 'trg_executie_tinte_garda_unitati'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND ((table_name = 'proiect_unitati' AND column_name IN ('obiect_cod', 'nod_cod', 'plan_start', 'plan_final'))
                      OR (table_name = 'proiect_activitati' AND column_name IN ('principala', 'factor_um', 'sursa_executat', 'baza_deviz', 'dn_min', 'dn_max'))))
     OR EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('proiect_unitati_tinta_obiect_uq', 'proiect_unitati_tinta_nod_uq'))
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.raport_lucrari', 'DELETE') THEN
    RAISE EXCEPTION '20261208a revenire post: au ramas obiecte sau drepturile pe raport_lucrari nu sunt cele de dinainte';
  END IF;
  PERFORM set_config('gazpet.revenire_20261208a', '', true);   -- dezarmare
END $revenire$;
