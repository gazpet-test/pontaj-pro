-- 20261127a_redari_uat_setari — Redări faza 2, felia 1: ecranul UAT + Setări proiect (după 20261126a).
-- Deciziile lui Răzvan, 02.11.2026 (chat): (1) faza 2 începe cu UAT + Setări; (2) `link_afisare` se SCOATE din adresa către UAT — nu există
-- pagină publică pe UAT, formularul public rămâne doar cu token personal; (3) refuzul de a semna fără obiecții = MOTIV pe PV B (felia PV,
-- nu aici); (4) adresele către UAT au serie proprie AU-0001 (red_numere, cheia 'AU').
-- Ce face: coloane noi nullable pe red_uat / red_proiecte (SABLOANE.md §3), ordinea zilelor de sesiune verificată în BD, unicitatea numărului
-- de adresă, cheia 'AU' în fn_red_numar_document. Fără date, fără drepturi, fără politici noi: red_uat / red_proiecte au deja SELECT pentru
-- orice nivel și INSERT/UPDATE doar admin (20261126a §RLS); GRANT-ul e pe tabel, deci acoperă și coloanele noi.
-- Revenire: supabase/revenire/20261127a_redari_uat_setari_ROLLBACK.sql. DRY: supabase/tests/20261127a_redari_uat_setari_dryrun.sql.

-- LIVRARE: doar prin scripts/livrare_migrare.sh, după GO Jakarinos + Copilot (regula #1877) și DRY verde pe prod.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261127a_redari_uat_setari:' || txid_current() THEN
    RAISE EXCEPTION '20261127a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261127a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- ALTER TABLE ia ACCESS EXCLUSIVE pe red_uat / red_proiecte; lock_timeout 5 s => dacă cineva ține tabelele, migrarea pică fără efect
  IF to_regclass('public.red_uat') IS NULL OR to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_numere') IS NULL THEN
    RAISE EXCEPTION '20261127a: lipseste schema 20261126a (red_uat / red_proiecte / red_numere)';
  END IF;
  IF to_regprocedure('public.fn_red_numar_document(text,text,integer)') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL THEN
    RAISE EXCEPTION '20261127a: lipsesc fn_red_numar_document / fn_red_nivel';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat'
               AND column_name IN ('reprezentant_uat_telefon', 'termen_confirmare', 'afisare_ora', 'afisare_reprezentant_gazpet', 'adresa_nr', 'adresa_data'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'apm_nume') THEN
    RAISE EXCEPTION '20261127a: coloanele noi exista deja (migrarea a rulat?)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_numere WHERE cheie = 'AU') THEN RAISE EXCEPTION '20261127a: cheia AU exista deja in red_numere'; END IF;
  -- zilele de sesiune: constrângerea nouă e validată pe rândurile existente; dacă un UAT are deja zile în altă ordine, migrarea refuză explicit
  IF EXISTS (SELECT 1 FROM public.red_uat WHERE (sesiune_zi2 IS NOT NULL AND (sesiune_zi1 IS NULL OR sesiune_zi2 <= sesiune_zi1))
                                           OR (sesiune_zi3 IS NOT NULL AND (sesiune_zi2 IS NULL OR sesiune_zi3 <= sesiune_zi2))) THEN
    RAISE EXCEPTION '20261127a: exista UAT-uri cu zilele de sesiune neordonate — se corecteaza intai';
  END IF;
END $pre$;

-- ─── 1. Coloane noi (SABLOANE.md §3) ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.red_uat
  ADD COLUMN reprezentant_uat_telefon text CONSTRAINT red_uat_repr_tel_len CHECK (reprezentant_uat_telefon IS NULL OR length(reprezentant_uat_telefon) <= 40),
  ADD COLUMN termen_confirmare date,
  ADD COLUMN afisare_ora text CONSTRAINT red_uat_afisare_ora_fmt CHECK (afisare_ora IS NULL OR afisare_ora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN afisare_reprezentant_gazpet text CONSTRAINT red_uat_afisare_repr_len CHECK (afisare_reprezentant_gazpet IS NULL OR length(afisare_reprezentant_gazpet) <= 200),
  ADD COLUMN adresa_nr text CONSTRAINT red_uat_adresa_nr_fmt CHECK (adresa_nr IS NULL OR adresa_nr ~ '^AU-[0-9]{4}$'),
  ADD COLUMN adresa_data date,
  -- zilele se completează în ordine (zi2 cere zi1, zi3 cere zi2) și strict crescător; NULL-urile de la coadă sunt permise
  ADD CONSTRAINT red_uat_zile_ordonate CHECK (
        (sesiune_zi2 IS NULL OR (sesiune_zi1 IS NOT NULL AND sesiune_zi2 > sesiune_zi1))
    AND (sesiune_zi3 IS NULL OR (sesiune_zi2 IS NOT NULL AND sesiune_zi3 > sesiune_zi2))),
  -- termenul de confirmare (adresa UAT) e înaintea primei zile de sesiune, când ambele există
  ADD CONSTRAINT red_uat_termen_inainte CHECK (termen_confirmare IS NULL OR sesiune_zi1 IS NULL OR termen_confirmare < sesiune_zi1),
  ADD CONSTRAINT red_uat_afisare_ordonata CHECK (afisare_data_start IS NULL OR afisare_data_end IS NULL OR afisare_data_end >= afisare_data_start);
CREATE UNIQUE INDEX red_uat_adresa_nr_uq ON public.red_uat (adresa_nr) WHERE adresa_nr IS NOT NULL;

COMMENT ON COLUMN public.red_uat.reprezentant_uat_telefon IS 'Redări: telefonul reprezentantului nominalizat de primărie (Model 4 pct. 3). Persoană publică în funcție, nu deținător.';
COMMENT ON COLUMN public.red_uat.termen_confirmare IS 'Redări: termenul până la care primăria confirmă sala / reprezentantul (adresa UAT). Introdus de operator; înaintea primei zile de sesiune.';
COMMENT ON COLUMN public.red_uat.afisare_ora IS 'Redări: ora afișării la primărie (HH:MM, PV de afișare).';
COMMENT ON COLUMN public.red_uat.afisare_reprezentant_gazpet IS 'Redări: cine afișează fizic la primărie din partea Gazpet (PV de afișare).';
COMMENT ON COLUMN public.red_uat.adresa_nr IS 'Redări: numărul adresei către UAT, seria proprie AU-0001 (fn_red_numar_document(''AU'')), unic. Decizia Răzvan 02.11.2026.';
COMMENT ON COLUMN public.red_uat.adresa_data IS 'Redări: data adresei către UAT.';

ALTER TABLE public.red_proiecte
  ADD COLUMN apm_nume text CONSTRAINT red_proiecte_apm_len CHECK (apm_nume IS NULL OR length(apm_nume) <= 200);
COMMENT ON COLUMN public.red_proiecte.apm_nume IS 'Redări: reprezentantul A.P.M. semnatar pe PV B / PV C (gol = se completează de mână).';

-- ─── 2. Numerotare: cheia AU (adrese către UAT) ───────────────────────────────────────────────────────────────────────────
-- Același corp ca în 20261126a, plus ramura 'AU'. CREATE OR REPLACE păstrează owner-ul, GRANT EXECUTE (authenticated) și REVOKE-ul de la PUBLIC.
CREATE OR REPLACE FUNCTION public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson int) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cheie text; v_n int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  CASE p_tip
    WHEN 'C' THEN v_cheie := 'C';
    WHEN 'AU' THEN v_cheie := 'AU';
    WHEN 'PVA', 'PVB' THEN
      IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
      v_cheie := p_tip || '-' || p_uat3;
    WHEN 'PVC' THEN
      IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
      v_cheie := 'PVC-T' || p_tronson;
    ELSE RAISE EXCEPTION 'redari: tip document necunoscut (%)', p_tip;
  END CASE;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, 1)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1
  RETURNING ultimul INTO v_n;
  IF v_n > 9999 THEN RAISE EXCEPTION 'redari: numerotarea pe % depaseste 9999', v_cheie; END IF;
  RETURN v_cheie || '-' || lpad(v_n::text, 4, '0');
END $fn$;
COMMENT ON FUNCTION public.fn_red_numar_document(text, text, integer) IS 'Redări: următorul număr (C-0001, AU-0001, PVA-HUS-0001, PVB-HUS-0001, PVC-T3-0001), fără refolosire (UPDATE … RETURNING sub lock de rând). Doar admin/editor. AU = adrese către UAT (20261127a).';
COMMENT ON TABLE public.red_numere IS 'Redări: ultimul număr alocat pe cheie (C, AU, PVA-HUS, PVB-HUS, PVC-T3, P-T3-HUS). Scris doar de fn_red_numar_document / fn_red_rezerva_numere_parcele.';

-- ─── 3. Postcondiții ──────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat'
        AND column_name IN ('reprezentant_uat_telefon', 'termen_confirmare', 'afisare_ora', 'afisare_reprezentant_gazpet', 'adresa_nr', 'adresa_data')) <> 6
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'apm_nume') THEN
    RAISE EXCEPTION 'Postconditie: coloanele noi lipsesc';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.red_uat'::regclass
        AND conname IN ('red_uat_zile_ordonate', 'red_uat_termen_inainte', 'red_uat_afisare_ordonata', 'red_uat_adresa_nr_fmt', 'red_uat_afisare_ora_fmt', 'red_uat_repr_tel_len', 'red_uat_afisare_repr_len')) <> 7 THEN
    RAISE EXCEPTION 'Postconditie: constrangerile red_uat lipsesc';
  END IF;
  IF position('''AU''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Postconditie: fn_red_numar_document fara ramura AU';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure)
     OR has_function_privilege('anon', 'public.fn_red_numar_document(text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_numar_document(text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postconditie: drepturile pe fn_red_numar_document s-au schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_uat', 'red_proiecte')
               AND policyname NOT IN ('red_uat_sel', 'red_uat_ins', 'red_uat_upd', 'red_proiecte_sel', 'red_proiecte_ins', 'red_proiecte_upd')) THEN
    RAISE EXCEPTION 'Postconditie: politici neasteptate pe red_uat / red_proiecte';
  END IF;
END $post$;
