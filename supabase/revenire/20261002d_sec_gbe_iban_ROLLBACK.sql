-- ════════════════════════════════════════════════════════════════════════════
-- 20261002d_sec_gbe_iban_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce starea live din
-- 02.10: coloana contracte_terti.gbe_cont_iban (readăugată — la FINALUL listei de coloane, PostgreSQL nu păstrează poziția),
-- valorile copiate înapoi din contracte_terti_gbe_cont, view-ul v_gbe_per_contract cu c.gbe_cont_iban direct, fără funcțiile
-- fn_gbe_cont_iban / fn_gbe_cont_iban_set și fără tabela nouă. REDESCHIDE expunerea IBAN pentru orice cont logat.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review Copilot. Armarea nu e autorizare.
-- După revenire, migrarea 20261002d NU se mai poate reaplica fără re-amprentare (precondiția 0c cere ordinea live a coloanelor).
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261002d', 'REDESCHIDE_IBAN_GBE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261002d', true) IS DISTINCT FROM 'REDESCHIDE_IBAN_GBE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261002d: nearmată (gazpet.rollback_tehnic_20261002d legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261002d=%') THEN
    RAISE EXCEPTION 'Revenire 20261002d: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regclass('public.contracte_terti_gbe_cont') IS NULL
     OR to_regprocedure('public.fn_gbe_cont_iban(bigint)') IS NULL OR to_regprocedure('public.fn_gbe_cont_iban_set(bigint, text)') IS NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attname = 'gbe_cont_iban' AND NOT attisdropped)
     OR pg_get_viewdef('public.v_gbe_per_contract'::regclass) !~ 'fn_gbe_cont_iban\(c\.id\) AS gbe_cont_iban' THEN
    RAISE EXCEPTION 'Revenire 20261002d: precondiție — starea nu e cea a patch-ului (tabela/funcțiile lipsesc, coloana există deja sau view-ul nu trece prin funcție)';
  END IF;
  CREATE TEMP TABLE sec_gbe_iban_revenire AS SELECT contract_id, iban FROM public.contracte_terti_gbe_cont;
END $arm$;

ALTER TABLE public.contracte_terti ADD COLUMN gbe_cont_iban text;
UPDATE public.contracte_terti c SET gbe_cont_iban = g.iban FROM public.contracte_terti_gbe_cont g WHERE g.contract_id = c.id;

CREATE OR REPLACE VIEW public.v_gbe_per_contract WITH (security_invoker = on) AS
 WITH retineri AS (
         SELECT p.contract_id,
            sum(abs(l.valoare)) AS gbe_retinut
           FROM ((public.executie_situatii_plata_linii l
             JOIN public.executie_situatii_plata s ON ((s.id = l.sl_id)))
             JOIN public.executie_proiecte p ON ((p.id = s.proiect_id)))
          WHERE ((l.tip = 'retinere'::text) AND ((l.denumire ~~* '%GBE%'::text) OR (l.denumire ~~* '%garan%'::text) OR (l.denumire ~~* '%bun% execu%'::text)) AND (p.contract_id IS NOT NULL))
          GROUP BY p.contract_id
        ), restituiri AS (
         SELECT gbe_restituiri.contract_id,
            sum(gbe_restituiri.valoare_lei) AS gbe_restituit
           FROM public.gbe_restituiri
          GROUP BY gbe_restituiri.contract_id
        )
 SELECT c.id AS contract_id,
    c.numar_contract,
    c.denumire,
    b.nume AS beneficiar,
    c.garantie_buna_executie_pct,
    c.garantie_perioada_luni,
    c.gbe_data_estimata_recuperare,
    c.gbe_observatii,
    COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) AS gbe_retinut,
    COALESCE(rs.gbe_restituit, (0)::numeric) AS gbe_restituit,
    (COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) - COALESCE(rs.gbe_restituit, (0)::numeric)) AS gbe_ramas,
    c.gbe_tip,
    c.gbe_pct_deblocare_receptie,
    c.gbe_pct_deblocare_final,
    c.gbe_data_receptie_terminare,
    c.gbe_data_receptie_finala,
    c.gbe_cont_iban,
    c.gbe_cont_valabil_pana,
    c.valoare_lei,
    c.valoare_actuala_lei,
    c.data_semnare,
    c.status,
    ((r.gbe_retinut IS NULL) AND (c.gbe_retinut_manual IS NOT NULL)) AS retinut_manual
   FROM (((public.contracte_terti c
     LEFT JOIN public.beneficiari b ON ((b.id = c.beneficiar_id)))
     LEFT JOIN retineri r ON ((r.contract_id = c.id)))
     LEFT JOIN restituiri rs ON ((rs.contract_id = c.id)))
  WHERE ((COALESCE(r.gbe_retinut, c.gbe_retinut_manual, (0)::numeric) > (0)::numeric) OR (COALESCE(rs.gbe_restituit, (0)::numeric) > (0)::numeric));

DROP FUNCTION public.fn_gbe_cont_iban_set(bigint, text);
DROP FUNCTION public.fn_gbe_cont_iban(bigint);
DROP TABLE public.contracte_terti_gbe_cont;

DO $post$
DECLARE v_n integer;
BEGIN
  -- valorile sunt înapoi, exact (același set de contracte, aceleași valori)
  SELECT count(*) INTO v_n FROM pg_temp.sec_gbe_iban_revenire s FULL JOIN (SELECT id, gbe_cont_iban FROM public.contracte_terti WHERE gbe_cont_iban IS NOT NULL) c ON c.id = s.contract_id
   WHERE s.contract_id IS NULL OR c.id IS NULL OR s.iban IS DISTINCT FROM c.gbe_cont_iban;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Revenire 20261002d: postcondiție — % diferențe între tabela nouă și coloana readăugată', v_n; END IF;
  IF md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass)) IS DISTINCT FROM 'b9861ba0ac5ffe289fdc1f82a4c09f5c'
     OR NOT coalesce((SELECT 'security_invoker=on' = ANY(reloptions) FROM pg_class WHERE oid = 'public.v_gbe_per_contract'::regclass), false)
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attnum > 0 AND NOT attisdropped) <> 55
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attname = 'gbe_cont_iban' AND NOT attisdropped) IS DISTINCT FROM 'text'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attacl IS NOT NULL)
     OR NOT has_table_privilege('authenticated', 'public.contracte_terti', 'SELECT') OR NOT has_table_privilege('anon', 'public.contracte_terti', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fn_gbe_cont_iban', 'fn_gbe_cont_iban_set'))
     OR to_regclass('public.contracte_terti_gbe_cont') IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261002d: postcondiție — starea nu e cea live din 02.10 (view b9861ba0…, 55 coloane cu gbe_cont_iban text, SELECT pe tabel, fără funcții/tabelă nouă)';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002d', '', true);
END $post$;
