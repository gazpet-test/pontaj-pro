-- ════════════════════════════════════════════════════════════════════════════
-- 20261002d_sec_gbe_iban — DRAFT, NEAPLICAT. Contul de garanție (IBAN) al contractelor îl citesc DOAR cei care pot scrie GBE.
-- Decizia Răzvan (docs/RAPORT_0210.md, decizia 10 → A). Modelul: 20261006b (coloane fără IBAN + funcție SECURITY DEFINER
--   pentru scriitori), adaptat la contracte_terti.
-- Gaura (citită read-only pe live dxczwkbciseqniprspcu, 02.10.2026): contracte_terti.gbe_cont_iban (87 contracte, 1 cu IBAN)
--   e citibil de orice cont logat prin 2 căi: (1) tabela contracte_terti (SELECT pe tabel pentru anon/authenticated + politica
--   contracte_terti_select = auth.uid() IS NOT NULL), (2) view-ul v_gbe_per_contract (security_invoker, expune c.gbe_cont_iban).
--   Nicio funcție din public nu citește gbe_cont_iban (prosrc); singura regulă dependentă de coloană e v_gbe_per_contract.
-- De ce NU privilegii pe coloane (ca în 20261006b): patru ecrane fac select('*') pe contracte_terti (ContracteTertiTab,
--   GbeEvidenta, TabSituatiiPlata, Financiar) — un REVOKE pe coloană ar rupe „*” pentru orice utilizator. Aici IBAN-ul se MUTĂ:
--   1. public.contracte_terti_gbe_cont (contract_id PK → contracte_terti ON DELETE CASCADE, iban, actualizat_la, actualizat_de):
--      RLS pornit, FĂRĂ politici, FĂRĂ privilegii pentru anon/authenticated/PUBLIC (fail-closed); service_role ca la orice tabel.
--   2. public.fn_gbe_cont_iban(bigint) — SECDEF, STABLE, sql: IBAN-ul contractului dacă fn_poate_scrie_garantii(), altfel NULL.
--   3. public.fn_gbe_cont_iban_set(bigint, text) — SECDEF, VOLATILE, plpgsql: scrie/șterge IBAN-ul DOAR dacă fn_poate_scrie_garantii()
--      (altfel 42501); NULL/gol = ștergere; btrim; max 200 caractere; contractul trebuie să existe.
--      EXECUTE pe ambele: authenticated, service_role (nu PUBLIC/anon).
--   4. v_gbe_per_contract: aceeași listă și ordine de coloane; „gbe_cont_iban” devine public.fn_gbe_cont_iban(c.id) (NULL pentru
--      cine nu poate scrie GBE). security_invoker = on păstrat; ACL-ul view-ului neatins.
--   5. Datele: rândurile cu IBAN se copiază VERBATIM în tabela nouă (snapshot în pg_temp, comparat în postcondiție), apoi coloana
--      contracte_terti.gbe_cont_iban e ȘTEARSĂ (nicio cale directă nu mai rămâne; select('*') merge în continuare).
-- Poarta de scriitori e cea din 20261005b (#561), deja pe live: fn_poate_scrie_garantii() = owner ∨ superadmin/contabilitate/
--   admin_logistica ∨ financiar|financiar.garantii admin/editor — aceeași care guvernează UPDATE pe contracte_terti pentru GBE
--   (politica contracte_terti_update_garantii). Scrierea celorlalte câmpuri GBE rămâne prin UPDATE direct (RLS neatins).
-- Ecrane: Financiar › GBE și Ofertare › fișa licitației › GBE (GbeEvidenta: citește prin RPC fn_gbe_cont_iban, scrie prin
--   fn_gbe_cont_iban_set — adaptate în același PR). Administrativ › Contracte comerciale nu citește câmpul.
-- Precondiții (fail-closed): postgres; helper exact (md5 e8ee20a0…, SECDEF, STABLE, search_path, fără EXECUTE anon/PUBLIC);
--   coloanele contracte_terti exact cele live (md5 e10866a7…, 55); SELECT pe tabel la anon/authenticated, fără ACL pe coloane;
--   politicile celor 4 tabele = starea 20261005b (md5 baf4aced…); view md5 b9861ba0… + coloane cae5aa7b… + security_invoker;
--   singura dependență de gbe_cont_iban = v_gbe_per_contract; nicio funcție din public nu citește coloana; IBAN-urile existente
--   fără spații la margini și negoale (copierea e verbatim, nimic nu se pierde tacit); obiectele noi nu există.
-- Postcondiții: coloana ștearsă (md5 23368c6e…, 54 coloane); tabela nouă fără privilegii pentru anon/authenticated/PUBLIC, RLS,
--   fără politici; funcțiile cu atribute/ACL exacte; view-ul cu aceleași coloane și IBAN prin funcție; datele = snapshot;
--   EXACT interogarea scripts/control_0e.sql ⇒ 0 rânduri.
-- Revenire (NU e migrare): supabase/revenire/20261002d_sec_gbe_iban_ROLLBACK.sql (readaugă coloana — la FINALUL listei, deci
--   amprenta de coloane se schimbă; o reaplicare după revenire cere re-amprentare).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT. Gate 0e = 0.
--   ALTER TABLE … DROP COLUMN ia ACCESS EXCLUSIVE scurt pe contracte_terti: se livrează într-o fereastră liniștită.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002d_sec_gbe_iban:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002d: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_n integer; v_s text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  -- 0b. helperul din 20261005b, exact
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.proname = 'fn_poate_scrie_garantii';
  IF v_n <> 1 OR to_regprocedure('public.fn_poate_scrie_garantii()') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: public.fn_poate_scrie_garantii() lipsește sau are supraîncărcări (%) — 20261005b (#561) trebuie aplicată întâi', v_n;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_poate_scrie_garantii()'::regprocedure) IS DISTINCT FROM 'e8ee20a08440f3c93c763e4bff0670cf'
     OR NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_poate_scrie_garantii()'::regprocedure)
     OR has_function_privilege('anon', 'public.fn_poate_scrie_garantii()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_poate_scrie_garantii()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.fn_poate_scrie_garantii()'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'Precondiție 0b: fn_poate_scrie_garantii() ≠ varianta live din 20261005b (md5 e8ee20a0…, SECDEF, STABLE, search_path, EXECUTE authenticated fără anon/PUBLIC)';
  END IF;
  -- 0c. coloanele contracte_terti = cele live (55, cu gbe_cont_iban text)
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_s
    FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_s IS DISTINCT FROM 'e10866a735d996751a2961f936871a20' THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele public.contracte_terti s-au schimbat (md5 % ≠ e10866a7…) — se reanalizează (amprenta de după mutare e calculată pe lista live)', v_s;
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attname = 'gbe_cont_iban' AND NOT attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Precondiție 0c: contracte_terti.gbe_cont_iban lipsește sau nu e text';
  END IF;
  -- 0d. SELECT pe tabel la anon și authenticated; fără ACL pe coloane; PUBLIC fără nimic; proprietar postgres
  IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.contracte_terti'::regclass AND a.privilege_type = 'SELECT' AND a.grantee = 'anon'::regrole)
     OR NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.contracte_terti'::regclass AND a.privilege_type = 'SELECT' AND a.grantee = 'authenticated'::regrole)
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.contracte_terti'::regclass AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attacl IS NOT NULL)
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.contracte_terti'::regclass) IS DISTINCT FROM 'postgres'
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contracte_terti'::regclass) THEN
    RAISE EXCEPTION 'Precondiție 0d: ACL-ul contracte_terti ≠ cel live (SELECT pe tabel pentru anon/authenticated, nimic pentru PUBLIC, fără ACL pe coloane, owner postgres, RLS pornit)';
  END IF;
  -- 0e. politicile celor 4 tabele = starea 20261005b (contracte_terti_update_garantii cu helperul)
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),'')) INTO v_s
    FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY['contracte_terti','garantii','gbe_polite','gbe_restituiri']);
  IF v_s IS DISTINCT FROM 'baf4acedb64d79573a83804196d6b156' THEN
    RAISE EXCEPTION 'Precondiție 0e: politicile pe contracte_terti/garantii/gbe_polite/gbe_restituiri (md5 %) ≠ starea 20261005b (baf4aced…) — se reanalizează', v_s;
  END IF;
  -- 0f. view-ul = cel live (definiție, coloane, security_invoker, owner)
  IF md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass)) IS DISTINCT FROM 'b9861ba0ac5ffe289fdc1f82a4c09f5c'
     OR NOT coalesce((SELECT 'security_invoker=on' = ANY(reloptions) FROM pg_class WHERE oid = 'public.v_gbe_per_contract'::regclass), false)
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.v_gbe_per_contract'::regclass) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0f: v_gbe_per_contract ≠ varianta live (md5 b9861ba0…, security_invoker=on, owner postgres)';
  END IF;
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_s
    FROM pg_attribute WHERE attrelid = 'public.v_gbe_per_contract'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_s IS DISTINCT FROM 'cae5aa7bd328ce2b3649230cae40bbc8' THEN
    RAISE EXCEPTION 'Precondiție 0f: coloanele v_gbe_per_contract s-au schimbat (md5 % ≠ cae5aa7b…)', v_s;
  END IF;
  -- 0g. singura regulă (view) care depinde de gbe_cont_iban = v_gbe_per_contract; nicio funcție din public nu citește coloana
  SELECT count(DISTINCT r.ev_class) INTO v_n FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.refobjid = 'public.contracte_terti'::regclass
     AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attname = 'gbe_cont_iban')
     AND r.ev_class <> 'public.v_gbe_per_contract'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0g: % view-uri noi depind de contracte_terti.gbe_cont_iban — se reanalizează', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosrc ILIKE '%gbe_cont_iban%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0g: % funcții din public citesc gbe_cont_iban — se reanalizează', v_n; END IF;
  -- 0h. obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.contracte_terti_gbe_cont') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fn_gbe_cont_iban', 'fn_gbe_cont_iban_set')) THEN
    RAISE EXCEPTION 'Precondiție 0h: contracte_terti_gbe_cont / fn_gbe_cont_iban / fn_gbe_cont_iban_set există deja — reaplicare sau coliziune de nume';
  END IF;
  -- 0i. datele: copierea e VERBATIM — refuz dacă vreun IBAN e gol sau are spații la margini (nimic nu se pierde / nu se transformă tacit)
  SELECT count(*) INTO v_n FROM public.contracte_terti WHERE gbe_cont_iban IS NOT NULL AND (btrim(gbe_cont_iban) = '' OR btrim(gbe_cont_iban) <> gbe_cont_iban OR length(gbe_cont_iban) > 200);
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0i: % IBAN-uri goale / cu spații la margini / peste 200 caractere — se curăță întâi (preview → confirm → apply), apoi se reia', v_n; END IF;
  -- snapshot (pg_temp, moare cu sesiunea): comparat cu tabela nouă în postcondiție, după ștergerea coloanei
  CREATE TEMP TABLE sec_gbe_iban_snapshot AS SELECT id AS contract_id, gbe_cont_iban AS iban FROM public.contracte_terti WHERE gbe_cont_iban IS NOT NULL;
  SELECT count(*) INTO v_n FROM pg_temp.sec_gbe_iban_snapshot;
  RAISE NOTICE '20261002d înainte: % contracte cu IBAN de mutat', v_n;
END $pre$;

-- 1. tabela nouă: fail-closed (RLS fără politici, fără privilegii pentru anon/authenticated/PUBLIC); doar funcțiile SECDEF de mai jos o ating
CREATE TABLE public.contracte_terti_gbe_cont (
  contract_id   bigint PRIMARY KEY REFERENCES public.contracte_terti(id) ON DELETE CASCADE,
  iban          text NOT NULL CHECK (btrim(iban) <> '' AND length(iban) <= 200),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_de uuid
);
ALTER TABLE public.contracte_terti_gbe_cont ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contracte_terti_gbe_cont FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contracte_terti_gbe_cont TO service_role;
COMMENT ON TABLE public.contracte_terti_gbe_cont IS 'Contul de garanție (IBAN, bancă) al contractului — citit/scris DOAR prin fn_gbe_cont_iban / fn_gbe_cont_iban_set (fn_poate_scrie_garantii). 20261002d';

-- 2. IBAN-ul unui contract, doar pentru cine poate scrie GBE (fără set_config / request.jwt / SET ROLE / EXECUTE dinamic — gate 0e)
CREATE FUNCTION public.fn_gbe_cont_iban(p_contract_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT g.iban FROM public.contracte_terti_gbe_cont g WHERE g.contract_id = p_contract_id AND public.fn_poate_scrie_garantii();
$fn$;
REVOKE ALL ON FUNCTION public.fn_gbe_cont_iban(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gbe_cont_iban(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_gbe_cont_iban(bigint) IS 'IBAN-ul GBE al contractului doar pentru fn_poate_scrie_garantii(); altfel NULL (20261002d)';

-- 3. scrierea IBAN-ului: poartă de rol în corp (nu doar RLS), NULL/gol = ștergere, btrim, max 200
CREATE FUNCTION public.fn_gbe_cont_iban_set(p_contract_id bigint, p_iban text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_iban text;
BEGIN
  IF NOT public.fn_poate_scrie_garantii() THEN
    RAISE EXCEPTION 'GBE: nu ai drept să modifici contul de garanție' USING ERRCODE = '42501';
  END IF;
  IF p_contract_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.contracte_terti c WHERE c.id = p_contract_id) THEN
    RAISE EXCEPTION 'GBE: contractul % nu există', p_contract_id USING ERRCODE = 'P0002';
  END IF;
  v_iban := nullif(btrim(p_iban), '');
  IF v_iban IS NOT NULL AND length(v_iban) > 200 THEN
    RAISE EXCEPTION 'GBE: contul de garanție are peste 200 de caractere' USING ERRCODE = '22001';
  END IF;
  IF v_iban IS NULL THEN
    DELETE FROM public.contracte_terti_gbe_cont g WHERE g.contract_id = p_contract_id;
  ELSE
    INSERT INTO public.contracte_terti_gbe_cont (contract_id, iban, actualizat_la, actualizat_de)
    VALUES (p_contract_id, v_iban, now(), auth.uid())
    ON CONFLICT (contract_id) DO UPDATE SET iban = excluded.iban, actualizat_la = excluded.actualizat_la, actualizat_de = excluded.actualizat_de;
  END IF;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_gbe_cont_iban_set(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gbe_cont_iban_set(bigint, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_gbe_cont_iban_set(bigint, text) IS 'Scrie/șterge (NULL sau gol) IBAN-ul GBE al contractului; doar fn_poate_scrie_garantii(), altfel 42501 (20261002d)';

-- 4. view-ul: aceeași formă, IBAN prin funcție
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
    public.fn_gbe_cont_iban(c.id) AS gbe_cont_iban,
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

-- 5. datele: copiere verbatim, apoi coloana dispare (nicio cale directă nu mai rămâne)
INSERT INTO public.contracte_terti_gbe_cont (contract_id, iban, actualizat_la, actualizat_de)
SELECT c.id, c.gbe_cont_iban, coalesce(c.updated_at, now()), NULL
  FROM public.contracte_terti c WHERE c.gbe_cont_iban IS NOT NULL;
ALTER TABLE public.contracte_terti DROP COLUMN gbe_cont_iban;

DO $post$
DECLARE v_n integer; v_s text; v_gadget text;
BEGIN
  -- 1. coloana a dispărut; restul coloanelor exact cele live, în aceeași ordine; select('*') merge (SELECT pe tabel neatins)
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_s
    FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_s IS DISTINCT FROM '23368c6ec7b0e1d91a06c37c1cd991b2'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attname = 'gbe_cont_iban' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Postcondiție 1: coloanele contracte_terti după mutare (md5 %) ≠ 23368c6e… sau gbe_cont_iban încă există', v_s;
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.contracte_terti', 'SELECT') AND has_table_privilege('anon', 'public.contracte_terti', 'SELECT')
          AND has_table_privilege('authenticated', 'public.contracte_terti', 'UPDATE'))
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti'::regclass AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 1: privilegiile pe contracte_terti s-au schimbat (trebuie neatinse — RLS decide)';
  END IF;
  -- 2. tabela nouă: RLS, fără politici, nimic pentru anon/authenticated/PUBLIC, service_role da, owner postgres
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contracte_terti_gbe_cont'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.contracte_terti_gbe_cont'::regclass)
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.contracte_terti_gbe_cont'::regclass AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole))
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.contracte_terti_gbe_cont'::regclass AND attacl IS NOT NULL)
     OR has_table_privilege('authenticated', 'public.contracte_terti_gbe_cont', 'SELECT') OR has_table_privilege('anon', 'public.contracte_terti_gbe_cont', 'SELECT')
     OR has_table_privilege('authenticated', 'public.contracte_terti_gbe_cont', 'INSERT') OR has_table_privilege('authenticated', 'public.contracte_terti_gbe_cont', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.contracte_terti_gbe_cont', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.contracte_terti_gbe_cont', 'SELECT')
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.contracte_terti_gbe_cont'::regclass) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Postcondiție 2: contracte_terti_gbe_cont — RLS / politici / ACL greșite (anon, authenticated, PUBLIC trebuie fără nimic)';
  END IF;
  -- 3. funcțiile noi: câte o singură semnătură, SECDEF, search_path, volatilitate, ACL exact authenticated + service_role (+ owner)
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'fn_gbe_cont_iban') <> 1 OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_gbe_cont_iban_set') <> 1
     OR NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres' FROM pg_proc WHERE oid = 'public.fn_gbe_cont_iban(bigint)'::regprocedure)
     OR NOT (SELECT prosecdef AND provolatile = 'v' AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres' FROM pg_proc WHERE oid = 'public.fn_gbe_cont_iban_set(bigint, text)'::regprocedure)
     OR (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.fn_gbe_cont_iban(bigint)'::regprocedure) IS DISTINCT FROM 'authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE'
     OR (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.fn_gbe_cont_iban_set(bigint, text)'::regprocedure) IS DISTINCT FROM 'authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE'
     OR has_function_privilege('anon', 'public.fn_gbe_cont_iban(bigint)', 'EXECUTE') OR has_function_privilege('anon', 'public.fn_gbe_cont_iban_set(bigint, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 3: fn_gbe_cont_iban / fn_gbe_cont_iban_set — atribute/ACL greșite';
  END IF;
  -- 4. view: aceleași coloane și tipuri, security_invoker, IBAN prin funcție (nu din coloană), SELECT authenticated păstrat
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_s
    FROM pg_attribute WHERE attrelid = 'public.v_gbe_per_contract'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_s IS DISTINCT FROM 'cae5aa7bd328ce2b3649230cae40bbc8' THEN
    RAISE EXCEPTION 'Postcondiție 4: coloanele v_gbe_per_contract s-au schimbat (md5 %)', v_s;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=on' = ANY(reloptions) FROM pg_class WHERE oid = 'public.v_gbe_per_contract'::regclass), false)
     OR pg_get_viewdef('public.v_gbe_per_contract'::regclass) !~ 'fn_gbe_cont_iban\(c\.id\) AS gbe_cont_iban'
     OR pg_get_viewdef('public.v_gbe_per_contract'::regclass) ~ 'c\.gbe_cont_iban'
     OR NOT has_table_privilege('authenticated', 'public.v_gbe_per_contract', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 4: v_gbe_per_contract — security_invoker / IBAN prin funcție / SELECT authenticated';
  END IF;
  -- 5. datele: tabela nouă = snapshot-ul de dinaintea ștergerii coloanei (același set de contracte, aceleași valori)
  SELECT count(*) INTO v_n FROM pg_temp.sec_gbe_iban_snapshot s FULL JOIN public.contracte_terti_gbe_cont g ON g.contract_id = s.contract_id
   WHERE s.contract_id IS NULL OR g.contract_id IS NULL OR s.iban IS DISTINCT FROM g.iban;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Postcondiție 5: % diferențe între snapshot și contracte_terti_gbe_cont — se anulează tot', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.contracte_terti_gbe_cont;
  -- 6. nicio funcție din public nu mai numește coloana veche; nicio regulă nu mai depinde de ea (coloana nu mai există)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosrc ILIKE '%gbe_cont_iban%' AND p.proname NOT IN ('fn_gbe_cont_iban', 'fn_gbe_cont_iban_set')) THEN
    RAISE EXCEPTION 'Postcondiție 6: o funcție din public numește gbe_cont_iban';
  END IF;
  -- GATE 0e — EXACT interogarea din scripts/control_0e.sql (SEC F2 r8), rulată la finalul tranzacției: trebuie 0 rânduri, altfel se anulează tot
  SELECT count(*), string_agg(q.functie || ' [' || q.motive || ']', '; ' ORDER BY q.functie) INTO v_n, v_gadget
    FROM (
           -- SEC F2 0e (r8) — invariant de catalog: nicio funcție expusă (public/graphql_public, EXECUTE pentru anon/authenticated) nu poate scrie GUC-urile de identitate și nu interpretează SQL primit ca argument
           WITH f AS (
             SELECT p.oid, p.oid::regprocedure::text AS functie, p.prosecdef, md5(p.prosrc) AS md5_src,
                    EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c ~* '^(role|session_authorization|request\.jwt[^=]*)=') AS cfg,
                    CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_get_function_sqlbody(p.oid) END
                      || E'\n ; ' || pg_get_function_arguments(p.oid) AS def
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'graphql_public') AND p.prokind IN ('f', 'p', 'w')
                AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
           ), t AS (
             SELECT f.*,
                    lower(replace(regexp_replace(regexp_replace(regexp_replace(f.def, '/\*.*?\*/', ' ', 'g'), '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'), '"', ''))
                      || ' ; ' || lower(replace(f.def, '"', '')) AS txt
               FROM f
           ), m AS (
             SELECT t.functie, t.prosecdef, array_remove(ARRAY[
                      CASE WHEN t.def IS NULL THEN 'corp necitibil' END,
                      CASE WHEN t.cfg THEN 'proconfig' END,
                      CASE WHEN t.txt ~ 'set_config' THEN 'set_config' END,
                      CASE WHEN t.txt ~ 'request(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*\.(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*jwt' THEN 'request.jwt' END,
                      CASE WHEN t.txt ~ 'session(_|\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)+authorization' THEN 'session_authorization' END,
                      CASE WHEN t.txt ~ '(^|;|>>|\m(begin|then|else|loop|atomic)\M)(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*(set|reset)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*((session|local)\M(\s|/\*([^*]|\*+[^*/])*\*+/|--[^\n]*\n)*)?role\M' THEN 'set/reset role' END,
                      CASE WHEN t.txt ~ '\mu&' THEN 'u&' END,
                      CASE WHEN t.txt ~ '/\*([^*]|\*+[^*/])*/\*' THEN 'comentariu imbricat' END,
                      CASE WHEN t.txt ~ '\m(query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|cursor_to_xml|cursor_to_xmlschema|table_to_xml|table_to_xmlschema|table_to_xml_and_xmlschema|schema_to_xml|schema_to_xmlschema|schema_to_xml_and_xmlschema|database_to_xml|database_to_xmlschema|database_to_xml_and_xmlschema|ts_stat|ts_rewrite|crosstab|crosstab2|crosstab3|crosstab4|connectby|dblink|dblink_exec|dblink_open|dblink_send_query|xpath_table)\M' THEN 'interpretor SQL' END,
                      CASE WHEN t.txt ~ '\mexecute\M' AND NOT EXISTS (
                             SELECT 1 FROM (VALUES ('public.fn_completare_aplica(bigint,boolean)', '47a7542895c0ce71cb0e44d2c26d0609')) AS w(semnatura, md5_prosrc)
                              WHERE t.prosecdef AND t.oid = to_regprocedure(w.semnatura) AND t.md5_src = w.md5_prosrc) THEN 'execute' END
                    ], NULL) AS motive
               FROM t
           )
           SELECT m.functie, m.prosecdef, array_to_string(m.motive, ',') AS motive
             FROM m
            WHERE cardinality(m.motive) > 0
            ORDER BY 1
         ) AS q;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Postcondiție 0e: % funcții expuse (public/graphql_public, EXECUTE pentru anon/authenticated) pot scrie GUC-uri sau interpretează SQL — se anulează tot (fail-closed): %', v_n, v_gadget;
  END IF;
  RAISE NOTICE '20261002d după: % contracte cu IBAN în contracte_terti_gbe_cont; view md5 %; fn_gbe_cont_iban md5 %; fn_gbe_cont_iban_set md5 %',
    (SELECT count(*) FROM public.contracte_terti_gbe_cont), md5(pg_get_viewdef('public.v_gbe_per_contract'::regclass)),
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_gbe_cont_iban(bigint)'::regprocedure),
    (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_gbe_cont_iban_set(bigint, text)'::regprocedure);
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002d_sec_gbe_iban:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002d: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
