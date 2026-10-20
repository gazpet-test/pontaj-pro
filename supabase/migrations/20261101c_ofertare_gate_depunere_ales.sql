-- 20261101c — poarta de depunere (fn_gate_depunere): acoperirea verificată, dovezile roșii și reverificările — DOAR pe candidatul ALES
-- (Răzvan 20.10.2026: „da” pentru schemă, transmis de chat). De ce: auditul Codex (19.10) a găsit că fn_gate_depunere număra dovezile
-- roșii / cu reverificare cerută pe TOȚI candidații de acoperire, inclusiv alternativele nealese (ales = false) — o alternativă
-- expirată pe care nimeni n-o depune bloca depunerea.
-- Regula nouă (helper ofertare_acoperire_la_poarta): un rând contează dacă ales = true (indiferent cine l-a ales — omul sau propunerea
-- inițială; un candidat ales roșu se depune, deci blochează), SAU dacă pe cerința / poziția lui nu e ales niciun candidat (atunci
-- contează toți, ca înainte — fail-closed). Restul porții (cerințe neconfirmate, acoperire verificată, J02b, R5, derogare, J07) NESCHIMBAT.
-- Același set de candidați și pentru ACOPERIREA verificată (n_neacoperite / n_na_ai, review Copilot / Gemini r1 P1): candidatul
-- ales trebuie să fie el însuși acoperire verificată; o alternativă nealeasă verificată nu mai acoperă cerința.
-- Precondiție: fn_gate_depunere exact cea live (md5 pg_get_functiondef 0fcfd5a7…); postcondiție: md5 nou d491e90d5a3e1666dbfecc4b81c4d118.
-- Verificare live (read-only, 20.10): licitația 15 — 4 dovezi roșii înainte, 4 după (toate pe candidatul ales: certificatul
-- constatator doc 59, valabil 02.10.2026, candidat unic), 0 reverificări înainte / după; cerințe neacoperite 118 → 118 (J02b oprit pe 15);
-- pe nicio licitație deschisă numărătoarea „neacoperite” nu se schimbă azi (verificat pe ambele ramuri J02b).
-- Revenire: supabase/revenire/20261101c_ofertare_gate_depunere_ales_ROLLBACK.sql (armată; doar la cererea lui Răzvan).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261101c_ofertare_gate_depunere_ales:' || txid_current() THEN
    RAISE EXCEPTION '20261101c: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_gate_depunere()') IS NULL
     OR md5(pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)) IS DISTINCT FROM '0fcfd5a7ca4813fa4ab7ff3ef60c185f' THEN
    RAISE EXCEPTION '20261101c: fn_gate_depunere nu e versiunea asteptata';
  END IF;
  IF to_regprocedure('public.ofertare_acoperire_la_poarta(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261101c: helperul exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_acoperire'
                 AND column_name = 'ales' AND data_type = 'boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_acoperire'
                 AND column_name = 'pozitie_id') THEN
    RAISE EXCEPTION '20261101c: ofertare_acoperire fara ales / pozitie_id';
  END IF;
END $pre$;

CREATE FUNCTION public.ofertare_acoperire_la_poarta(p_acoperire_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- un rând de acoperire contează la poarta de depunere (dovezi roșii, reverificări) dacă e candidatul ALES pe cerința / poziția lui
  -- (ales = true, indiferent dacă l-a ales omul sau propunerea inițială), SAU dacă pe acea cerință / poziție nu e ales niciun candidat
  -- (atunci contează toți — regula veche, conservatoare). Alternativele nealese de lângă un candidat ales nu blochează.
  SELECT a.ales OR NOT EXISTS (SELECT 1 FROM public.ofertare_acoperire b
                                WHERE b.cerinta_id = a.cerinta_id AND COALESCE(b.pozitie_id, 0) = COALESCE(a.pozitie_id, 0) AND b.ales)
  FROM public.ofertare_acoperire a WHERE a.id = p_acoperire_id
$function$
;
REVOKE ALL ON FUNCTION public.ofertare_acoperire_la_poarta(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_active int; n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; n_na_ai int; msg text; v_r5 text; v_j02b boolean;
BEGIN
  -- J02b r5: comutatorul licitației (OLD inclus: o cerere care ar încerca să-l stingă odată cu depunerea rămâne pe regula nouă)
  v_j02b := COALESCE(NEW.j02b_activ, true) OR (TG_OP = 'UPDATE' AND COALESCE(OLD.j02b_activ, true));
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
    IF v_j02b THEN
    -- J02b: „nu se aplică” acoperă DOAR prin confirmare umană validă (amprenta sursei curente), nu prin a.status AI.
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)
            AND public.ofertare_acoperire_la_poarta(a.id))
      AND NOT public.fn_ofertare_cerinta_na_confirmata(c.id, 'nu_se_aplica');
    SELECT count(*) INTO n_na_ai FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status = 'nu_se_aplica')
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)
            AND public.ofertare_acoperire_la_poarta(a.id))
      AND NOT public.fn_ofertare_cerinta_na_confirmata(c.id, 'nu_se_aplica');
    ELSE
      -- J02b oprit pe licitație: exact regula live (nu_se_aplica AI acoperă)
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)))
            AND public.ofertare_acoperire_la_poarta(a.id));
    END IF;
    SELECT count(*) INTO n_rosii FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      JOIN documente_firma d ON d.id = a.doc_firma_id
      -- 20261101c: doar candidatul ALES (sau toți candidații dacă pe acea cerință / poziție nu e ales niciunul) — o alternativă nealeasă
      -- expirată nu mai blochează depunerea; candidatul ales roșu blochează în continuare
      WHERE public.ofertare_acoperire_la_poarta(a.id)
        AND (NOT d.utilizabil
         OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
             d.data_valabilitate < COALESCE(NEW.termen_depunere::date, CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END));
    SELECT count(*) INTO n_reverif FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      WHERE a.status IN ('acoperit','acoperit_partener') AND COALESCE(a.reverificare_ceruta, false)
        AND public.ofertare_acoperire_la_poarta(a.id);
    IF n_neconfirmate > 0 OR n_neacoperite > 0 OR n_rosii > 0 OR n_reverif > 0 THEN
      IF v_j02b THEN
        msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă; din ele %s au doar „nu se aplică” propus de AI — cer confirmare umană cu motiv pe versiunea curentă a sursei), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_na_ai, n_rosii, n_reverif);
      ELSE
        msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_rosii, n_reverif);
      END IF;
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
  
  -- J07 BEGIN
  IF NEW.status='depusa' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'depusa') THEN
    PERFORM public.ofertare_poarta_impune(NEW.id);
  END IF;
  -- J07 END
  RETURN NEW;
END $function$
;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_gate_depunere()'::regprocedure)) IS DISTINCT FROM 'd491e90d5a3e1666dbfecc4b81c4d118' THEN
    RAISE EXCEPTION '20261101c: postconditie fn_gate_depunere';
  END IF;
  IF has_function_privilege('anon', 'public.ofertare_acoperire_la_poarta(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ofertare_acoperire_la_poarta(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261101c: postconditie drepturi helper';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gate_depunere' AND tgrelid = 'public.ofertare_licitatii'::regclass
                 AND tgfoid = 'public.fn_gate_depunere()'::regprocedure AND tgenabled <> 'D') THEN
    RAISE EXCEPTION '20261101c: trigger-ul trg_gate_depunere lipseste / dezactivat';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261101c_ofertare_gate_depunere_ales:' || txid_current() THEN
    RAISE EXCEPTION '20261101c: garda final invalida';
  END IF;
END $post$;
