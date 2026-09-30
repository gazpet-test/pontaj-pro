-- ============================================================================
-- ROLLBACK J02b (20261004a_ofertare_j02b_na_confirmare_umana) — DRAFT
-- Reface EXACT definițiile live din 30.09.2026: fn_gate_depunere (md5(prosrc) 4bddf68c…) și v_ofertare_pt_stare
-- (md5(pg_get_viewdef) c77c49b8…, security_invoker=on, ACL ca pe live), apoi scoate obiectele J02b.
-- Confirmările umane NU se pierd: dacă tabelul are rânduri, se redenumește în ofertare_cerinte_na_confirmari_arhiva_j02b
-- (fără acces din aplicație); dacă e gol, se șterge.
-- Rulează DOAR prin scripts/livrare_migrare.sh (garda de livrare, tranzacție unică).
-- ============================================================================

DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_ofertare_j02b_rollback:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261004b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
BEGIN
  IF to_regclass('public.ofertare_cerinte_na_confirmari') IS NULL
     OR position('fn_ofertare_cerinta_na_confirmata' IN pg_get_viewdef('public.v_ofertare_pt_stare'::regclass)) = 0
     OR position('fn_ofertare_cerinta_na_confirmata' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_gate_depunere()'))) = 0 THEN
    RAISE EXCEPTION 'J02b rollback pre: migrarea J02b nu pare aplicată — REFUZ';
  END IF;
  IF to_regclass('public.ofertare_j02b_rollback_def') IS NULL THEN
    RAISE EXCEPTION 'J02b rollback pre: lipsește copia definiției view-ului — REFUZ';
  END IF;
  IF to_regclass('public.ofertare_cerinte_na_confirmari_arhiva_j02b') IS NOT NULL THEN
    RAISE EXCEPTION 'J02b rollback pre: arhiva există deja — REFUZ';
  END IF;
END $pre$;

-- 1. poarta de depunere: definiția live exactă de dinainte
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_active int; n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; msg text; v_r5 text;
BEGIN
  IF COALESCE(NEW.derogare_depunere, false) AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false))
     AND NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') AND NOT COALESCE(NEW.derogare_depunere, false) THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet p WHERE p.licitatie_id = NEW.id AND p.stare = 'depus') THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: lipseste pachetul PT in stare depus pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_active FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL;
    IF n_active = 0 THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE: 0 cerinte extrase active pentru licitatia %.', NEW.id USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO n_neconfirmate FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.confirmata_de IS NULL;
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))));
    SELECT count(*) INTO n_rosii FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      JOIN documente_firma d ON d.id = a.doc_firma_id
      WHERE NOT d.utilizabil
         OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
             d.data_valabilitate < COALESCE(NEW.termen_depunere::date, CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END);
    SELECT count(*) INTO n_reverif FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false);
    IF n_neconfirmate > 0 OR n_neacoperite > 0 OR n_rosii > 0 OR n_reverif > 0 THEN
      msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_rosii, n_reverif);
      RAISE EXCEPTION '%', msg;
    END IF;
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa') THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE%. Oferta nu se depune cu sursa cantităților nerezolvată; derogare_depunere=true doar cu decizia lui Razvan (pentru partea asta contează doar dacă depunerea o face ownerul / responsabilul / un admin Ofertare).', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF COALESCE(NEW.derogare_depunere, false)
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.derogare_depunere, false)) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'derogare_acordata', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
  END IF;
  IF NEW.status = 'depusa' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'depusa')
     AND COALESCE(NEW.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (NEW.id, 'depusa_pe_derogare', auth.uid(), session_user, NEW.derogare_motiv,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status);
    RAISE NOTICE 'DEROGARE LA DEPUNERE: licitatie_id=%, auth.uid=%, session_user=%, operatie=%, derogare_depunere=true',
      NEW.id, auth.uid(), session_user, TG_OP;
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere() FROM PUBLIC, anon, authenticated;

-- 2. v_ofertare_pt_stare: definiția exactă salvată de migrare în ofertare_j02b_rollback_def (coloana adăugată cere DROP + CREATE)
DO $view$
DECLARE v_def text; v_dep int;
BEGIN
  SELECT count(*) INTO v_dep FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.refobjid = 'public.v_ofertare_pt_stare'::regclass AND r.ev_class <> 'public.v_ofertare_pt_stare'::regclass;
  IF v_dep > 0 THEN RAISE EXCEPTION 'J02b rollback: v_ofertare_pt_stare are obiecte dependente — REFUZ'; END IF;
  SELECT definitie INTO v_def FROM public.ofertare_j02b_rollback_def
   WHERE obiect = 'v_ofertare_pt_stare' AND md5 = 'c77c49b87642c5c2f584d2ed008c7bf3' AND md5(definitie) = md5;
  IF v_def IS NULL THEN RAISE EXCEPTION 'J02b rollback: copia definiției view-ului lipsește/diferă — REFUZ'; END IF;
  DROP VIEW public.v_ofertare_pt_stare;
  EXECUTE 'CREATE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS ' || v_def;
END $view$;
-- ACL identic cu live (30.09.2026)
GRANT ALL ON public.v_ofertare_pt_stare TO anon, authenticated, service_role;

-- 3. obiectele J02b
DROP VIEW public.v_ofertare_cerinte_na_stare;
DROP FUNCTION public.ofertare_revoca_neaplicabil(bigint, text);
DROP FUNCTION public.ofertare_confirma_neaplicabil(bigint, text, text, text);
DROP FUNCTION public.fn_ofertare_cerinta_na_confirmata(bigint, text);
DROP FUNCTION public.fn_ofertare_cerinta_amprenta(bigint);
DROP TABLE public.ofertare_j02b_rollback_def;
DO $tab$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ofertare_cerinte_na_confirmari;
  IF n = 0 THEN
    EXECUTE 'DROP TABLE public.ofertare_cerinte_na_confirmari';
  ELSE
    EXECUTE 'DROP POLICY ofertare_na_conf_select ON public.ofertare_cerinte_na_confirmari';
    EXECUTE 'REVOKE ALL ON public.ofertare_cerinte_na_confirmari FROM PUBLIC, anon, authenticated';
    EXECUTE 'ALTER TABLE public.ofertare_cerinte_na_confirmari RENAME TO ofertare_cerinte_na_confirmari_arhiva_j02b';
    RAISE NOTICE 'J02b rollback: % confirmări umane păstrate în ofertare_cerinte_na_confirmari_arhiva_j02b', n;
  END IF;
END $tab$;

-- 4. postcondiții: definițiile live exacte de dinainte
DO $post$
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_gate_depunere()'))) IS DISTINCT FROM '4bddf68cfe53107a622d210f4ef3ec51' THEN
    RAISE EXCEPTION 'J02b rollback post: fn_gate_depunere ≠ live dinainte';
  END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass)) IS DISTINCT FROM 'c77c49b87642c5c2f584d2ed008c7bf3' THEN
    RAISE EXCEPTION 'J02b rollback post: v_ofertare_pt_stare ≠ live dinainte';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_ofertare_pt_stare'::regclass AND reloptions @> ARRAY['security_invoker=on']) THEN
    RAISE EXCEPTION 'J02b rollback post: security_invoker lipsă';
  END IF;
  IF to_regprocedure('public.fn_ofertare_cerinta_amprenta(bigint)') IS NOT NULL OR to_regclass('public.v_ofertare_cerinte_na_stare') IS NOT NULL
     OR to_regclass('public.ofertare_cerinte_na_confirmari') IS NOT NULL OR to_regclass('public.ofertare_j02b_rollback_def') IS NOT NULL THEN
    RAISE EXCEPTION 'J02b rollback post: obiecte J02b rămase';
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004b_ofertare_j02b_rollback:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261004b: garda de livrare (final) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_final$;
