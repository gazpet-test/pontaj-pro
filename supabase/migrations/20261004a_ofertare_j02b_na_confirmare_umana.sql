-- ============================================================================
-- J02b (DRAFT, NEAPLICAT — freeze Ofertare până după depunerea Jilava 02.10.2026)
-- Incident: o cerință e tratată ca închisă/verde doar pentru că AI-ul a scris „nu se aplică”
--   (ofertare_acoperire.status='nu_se_aplica') sau „exceptat” (ofertare_pt_legaturi fel='exceptat' sursa='ai').
--   * fn_gate_depunere (poarta J02, triggerul trg_gate_depunere pe ofertare_licitatii) numără cerința acoperită
--     dacă EXISTĂ un rând a.status='nu_se_aplica' (propunere AI) — audit S05-02;
--   * v_ofertare_pt_stare numără cerința „exceptată” (scoasă din fara_capitol ⇒ poarta PT verde) pe orice legătură
--     fel='exceptat', inclusiv sursa='ai'.
-- Regula nouă: „nu se aplică”/„exceptat” închide o cerință DOAR prin confirmare umană explicită
--   (actor = auth.uid(), motiv, amprenta sursei — textul/versiunea cerinței + documentul sursă —, moment),
--   invalidată AUTOMAT când sursa se schimbă (amprenta confirmată ≠ amprenta curentă ⇒ nevalidă, calculat la citire).
--   AI-ul rămâne PROPUNERE: vizibilă, dar poarta rămâne deschisă (cerința neînchisă).
--   ofertare_cerinte.stare='nu_se_aplica' fără confirmare cu amprentă NU mai închide în poarta de depunere
--   (poarta nu o folosea oricum; UI-ul o folosea la contoare — vezi src/ofertareNeaplicabil.js).
-- Aditiv: tabel nou + funcții noi + view nou; fn_gate_depunere și v_ofertare_pt_stare sunt înlocuite doar după
--   pre-verificarea md5 a definițiilor LIVE citite pe 30.09.2026 (altfel REFUZ). Rollback:
--   supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana_ROLLBACK.sql
-- Tranzacția: UN SINGUR gestionar = scripts/livrare_migrare.sh (psql --single-transaction); fără BEGIN/COMMIT aici.
-- ============================================================================

DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261004a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții (fail-closed): producția identică cu analiza din 30.09.2026
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE v_md5 text; v_cnt int;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.fn_gate_depunere()');
  IF v_md5 IS DISTINCT FROM '4bddf68cfe53107a622d210f4ef3ec51' THEN
    RAISE EXCEPTION 'J02b pre: fn_gate_depunere live diferă de analiză (md5 %) — REFUZ', v_md5;
  END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass)) IS DISTINCT FROM 'c77c49b87642c5c2f584d2ed008c7bf3' THEN
    RAISE EXCEPTION 'J02b pre: v_ofertare_pt_stare live diferă de analiză — REFUZ';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_class WHERE oid = 'public.v_ofertare_pt_stare'::regclass
     AND reloptions @> ARRAY['security_invoker=on'];
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'J02b pre: v_ofertare_pt_stare nu e security_invoker=on — REFUZ'; END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_are_acces_ofertare()'))) IS DISTINCT FROM '429d28e2a61fb24c8009d67050c16c85' THEN
    RAISE EXCEPTION 'J02b pre: fn_are_acces_ofertare live diferă de analiză — REFUZ';
  END IF;
  IF to_regclass('public.ofertare_cerinte_na_confirmari') IS NOT NULL
     OR to_regclass('public.v_ofertare_cerinte_na_stare') IS NOT NULL
     OR to_regprocedure('public.fn_ofertare_cerinta_amprenta(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_ofertare_cerinta_na_confirmata(bigint,text)') IS NOT NULL
     OR to_regprocedure('public.ofertare_confirma_neaplicabil(bigint,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.ofertare_revoca_neaplicabil(bigint,text)') IS NOT NULL
     OR to_regclass('public.ofertare_j02b_rollback_def') IS NOT NULL THEN
    RAISE EXCEPTION 'J02b pre: obiecte J02b există deja — REFUZ (reaplicare)';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgname = 'trg_gate_depunere' AND tgrelid = 'public.ofertare_licitatii'::regclass
     AND tgfoid = to_regprocedure('public.fn_gate_depunere()');
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'J02b pre: trg_gate_depunere lipsă/diferit — REFUZ'; END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Confirmările umane (append-only din aplicație: fără INSERT/UPDATE/DELETE direct; doar prin RPC)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ofertare_cerinte_na_confirmari (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id        bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  tip               text   NOT NULL CHECK (tip IN ('nu_se_aplica','exceptat_pt')),
  actor             uuid   NOT NULL REFERENCES public.profiles(id),
  motiv             text   NOT NULL CHECK (length(btrim(motiv)) >= 5),
  amprenta_sursa    text   NOT NULL CHECK (amprenta_sursa ~ '^[0-9a-f]{32}$'),
  cerinta_versiune  integer,
  sursa_document_id bigint,
  confirmat_la      timestamptz NOT NULL DEFAULT now(),
  revocata_la       timestamptz,
  revocata_de       uuid REFERENCES public.profiles(id),
  revocata_motiv    text,
  CONSTRAINT ofertare_na_conf_revocare_chk CHECK (
    (revocata_la IS NULL AND revocata_de IS NULL AND revocata_motiv IS NULL)
    OR (revocata_la IS NOT NULL AND revocata_de IS NOT NULL AND length(btrim(COALESCE(revocata_motiv, ''))) >= 5))
);
CREATE INDEX ofertare_na_conf_cerinta_idx ON public.ofertare_cerinte_na_confirmari (cerinta_id, tip) WHERE revocata_la IS NULL;
COMMENT ON TABLE public.ofertare_cerinte_na_confirmari IS
  'J02b: confirmări UMANE „nu se aplică”/„exceptat PT”. Valide doar cât amprenta_sursa = fn_ofertare_cerinta_amprenta(cerinta_id). Scriere doar prin ofertare_confirma_neaplicabil / ofertare_revoca_neaplicabil.';

ALTER TABLE public.ofertare_cerinte_na_confirmari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_cerinte_na_confirmari FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ofertare_cerinte_na_confirmari TO authenticated;
GRANT ALL ON public.ofertare_cerinte_na_confirmari TO service_role;
CREATE POLICY ofertare_na_conf_select ON public.ofertare_cerinte_na_confirmari
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());

-- ---------------------------------------------------------------------------
-- 2. Amprenta sursei unei cerințe (textul + versiunea cerinței + documentul sursă)
--    Orice schimbare ⇒ altă amprentă ⇒ confirmările vechi devin nevalide automat.
--    Documentul: cale + mărime + revizie + procesat_la + pg_column_size(text_extras) (ieftin: fără md5 pe MB de text
--    la fiecare cerință din poartă; o reprocesare schimbă procesat_la).
--    Fără acces Ofertare (utilizator logat) ⇒ NULL (fail-closed: nimic nu e confirmat).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ofertare_cerinta_amprenta(p_cerinta_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE v text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RETURN NULL;
  END IF;
  SELECT md5(concat_ws('|', 'j02b-v1',
           c.id::text, c.licitatie_id::text, c.tip, COALESCE(c.text_cerinta, ''), COALESCE(c.versiune, 0)::text,
           COALESCE(c.sursa_document_id, 0)::text, COALESCE(c.sursa_pagina, 0)::text, md5(COALESCE(c.sursa_pasaj, '')),
           COALESCE(c.inlocuita_de, 0)::text, COALESCE(c.duplicat_al, 0)::text,
           COALESCE(d.fisier_path, ''), COALESCE(d.size_bytes, -1)::text, COALESCE(d.revizie, ''),
           COALESCE(extract(epoch FROM d.procesat_la)::text, ''), COALESCE(pg_column_size(d.text_extras), -1)::text))
    INTO v
    FROM public.ofertare_cerinte c
    LEFT JOIN public.ofertare_documente_atribuire d ON d.id = c.sursa_document_id
   WHERE c.id = p_cerinta_id;
  RETURN v;
END $fn$;

-- ---------------------------------------------------------------------------
-- 3. Există o confirmare umană VALIDĂ (nerevocată, pe amprenta curentă)?
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ofertare_cerinta_na_confirmata(p_cerinta_id bigint, p_tip text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE v_amp text;
BEGIN
  v_amp := public.fn_ofertare_cerinta_amprenta(p_cerinta_id);
  IF v_amp IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.ofertare_cerinte_na_confirmari k
                  WHERE k.cerinta_id = p_cerinta_id AND k.tip = p_tip
                    AND k.revocata_la IS NULL AND k.amprenta_sursa = v_amp);
END $fn$;

-- ---------------------------------------------------------------------------
-- 4. RPC: confirmarea umană. Stale (amprenta văzută ≠ curentă) ⇒ REFUZ.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ofertare_confirma_neaplicabil(p_cerinta_id bigint, p_tip text, p_motiv text, p_amprenta_vazuta text)
 RETURNS bigint
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_amp text; v_id bigint; c record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'J02b: confirmarea „nu se aplică” cere un utilizator autentificat (actor uman)' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'J02b: fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('nu_se_aplica','exceptat_pt') THEN
    RAISE EXCEPTION 'J02b: tip necunoscut %', p_tip USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_motiv, ''))) < 5 THEN
    RAISE EXCEPTION 'J02b: motivul e obligatoriu (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT id, versiune, sursa_document_id, inlocuita_de, duplicat_al INTO c
    FROM public.ofertare_cerinte WHERE id = p_cerinta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'J02b: cerința % nu există', p_cerinta_id USING ERRCODE = 'P0002'; END IF;
  IF c.inlocuita_de IS NOT NULL OR c.duplicat_al IS NOT NULL THEN
    RAISE EXCEPTION 'J02b: cerința % e înlocuită/duplicat — confirmă versiunea activă', p_cerinta_id USING ERRCODE = 'P0001';
  END IF;
  v_amp := public.fn_ofertare_cerinta_amprenta(p_cerinta_id);
  IF v_amp IS NULL OR p_amprenta_vazuta IS DISTINCT FROM v_amp THEN
    RAISE EXCEPTION 'J02b: sursa cerinței s-a schimbat față de ce ai văzut — recitește și confirmă din nou' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.ofertare_cerinte_na_confirmari (cerinta_id, tip, actor, motiv, amprenta_sursa, cerinta_versiune, sursa_document_id)
  VALUES (p_cerinta_id, p_tip, v_uid, btrim(p_motiv), v_amp, c.versiune, c.sursa_document_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- ---------------------------------------------------------------------------
-- 5. RPC: revocarea (doar autorul confirmării sau ownerul); rândul rămâne (istoric)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ofertare_revoca_neaplicabil(p_confirmare_id bigint, p_motiv text)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_actor uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'J02b: fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_motiv, ''))) < 5 THEN
    RAISE EXCEPTION 'J02b: motivul revocării e obligatoriu (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT actor INTO v_actor FROM public.ofertare_cerinte_na_confirmari
   WHERE id = p_confirmare_id AND revocata_la IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'J02b: confirmarea % nu există sau e deja revocată', p_confirmare_id USING ERRCODE = 'P0002'; END IF;
  IF v_actor <> v_uid AND NOT COALESCE((SELECT is_owner FROM public.profiles WHERE id = v_uid), false) THEN
    RAISE EXCEPTION 'J02b: doar autorul confirmării sau ownerul o poate revoca' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ofertare_cerinte_na_confirmari
     SET revocata_la = now(), revocata_de = v_uid, revocata_motiv = btrim(p_motiv)
   WHERE id = p_confirmare_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinta_amprenta(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinta_na_confirmata(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ofertare_confirma_neaplicabil(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ofertare_revoca_neaplicabil(bigint, text) FROM PUBLIC, anon, authenticated;
-- authenticated: amprenta (UI o trimite înapoi la confirmare), helperul (e chemat din v_ofertare_pt_stare,
-- care e security_invoker), cele două RPC-uri. anon: nimic.
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_amprenta(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_na_confirmata(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_confirma_neaplicabil(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_revoca_neaplicabil(bigint, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. View pentru UI: ultima stare a confirmărilor, cu `valida` calculat pe amprenta curentă
-- ---------------------------------------------------------------------------
CREATE VIEW public.v_ofertare_cerinte_na_stare WITH (security_invoker = on) AS
SELECT k.id AS confirmare_id, k.cerinta_id, k.tip, k.actor, k.motiv, k.confirmat_la,
       k.cerinta_versiune, k.sursa_document_id, k.revocata_la, k.revocata_de, k.revocata_motiv,
       (k.revocata_la IS NULL AND k.amprenta_sursa = public.fn_ofertare_cerinta_amprenta(k.cerinta_id)) AS valida
  FROM public.ofertare_cerinte_na_confirmari k;
REVOKE ALL ON public.v_ofertare_cerinte_na_stare FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_cerinte_na_stare TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. fn_gate_depunere: nu_se_aplica AI ⇒ NU mai acoperă; acoperă doar confirmarea umană validă.
--    Singurele diferențe față de live (md5 4bddf68c…): ramura de acoperire + contorul n_na_ai din mesaj.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_active int; n_neconfirmate int; n_neacoperite int; n_rosii int; n_reverif int; n_na_ai int; msg text; v_r5 text;
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
    -- J02b: „nu se aplică” acoperă DOAR prin confirmare umană validă (amprenta sursei curente), nu prin a.status AI.
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))
      AND NOT public.fn_ofertare_cerinta_na_confirmata(c.id, 'nu_se_aplica');
    SELECT count(*) INTO n_na_ai FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
      AND EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status = 'nu_se_aplica')
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))
      AND NOT public.fn_ofertare_cerinta_na_confirmata(c.id, 'nu_se_aplica');
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
      msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă; din ele %s au doar „nu se aplică” propus de AI — cer confirmare umană cu motiv pe versiunea curentă a sursei), %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii), %s dovezi cu reverificare cerută. Rezolvă-le sau derogare_depunere=true (o poate pune doar ownerul).', n_neconfirmate, n_neacoperite, n_na_ai, n_rosii, n_reverif);
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
-- ACL neschimbat față de live ({postgres=X, service_role=X}); CREATE OR REPLACE păstrează ACL-ul, iar re-REVOKE e explicit.
REVOKE EXECUTE ON FUNCTION public.fn_gate_depunere() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. v_ofertare_pt_stare: „exceptată” DOAR cu confirmare umană validă; coloană nouă (la final)
--    exceptate_propuse_ai = legături 'exceptat' fără confirmare validă (vizibile, dar cerința rămâne în fara_capitol).
--    Înlocuire textuală pe definiția LIVE verificată prin md5 în §0; fiecare fragment trebuie să apară EXACT o dată.
-- ---------------------------------------------------------------------------
-- Definiția live de dinainte se păstrează pentru ROLLBACK exact (verificat prin md5 la rollback).
CREATE TABLE public.ofertare_j02b_rollback_def (
  obiect text PRIMARY KEY, definitie text NOT NULL, md5 text NOT NULL, salvat_la timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ofertare_j02b_rollback_def ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_j02b_rollback_def FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ofertare_j02b_rollback_def TO service_role;
INSERT INTO public.ofertare_j02b_rollback_def (obiect, definitie, md5)
SELECT 'v_ofertare_pt_stare', pg_get_viewdef('public.v_ofertare_pt_stare'::regclass), md5(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass));

DO $view$
DECLARE
  v_def text := pg_get_viewdef('public.v_ofertare_pt_stare'::regclass);
  a1 text := $a$(l_1.fel = 'exceptat'::text)))) AS exceptata,$a$;
  b1 text := $b$(l_1.fel = 'exceptat'::text)))) AND public.fn_ofertare_cerinta_na_confirmata(c.id, 'exceptat_pt'::text) AS exceptata,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_3 WHERE ((l_3.cerinta_id = c.id) AND (l_3.fel = 'exceptat'::text)))) AS exceptata_propusa,$b$;
  a2 text := 'AS dovada_de_verificat' || chr(10) || '   FROM (ofertare_licitatii l';
  b2 text := 'AS dovada_de_verificat,' || chr(10)
          || '    count(*) FILTER (WHERE (cer.exceptata_propusa AND (NOT cer.exceptata) AND (NOT cer.are_capitol))) AS exceptate_propuse_ai'
          || chr(10) || '   FROM (ofertare_licitatii l';
BEGIN
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 THEN
    RAISE EXCEPTION 'J02b view: fragmentul exceptata nu apare exact o dată — REFUZ';
  END IF;
  IF (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'J02b view: fragmentul dovada_de_verificat nu apare exact o dată — REFUZ';
  END IF;
  v_def := replace(replace(v_def, a1, b1), a2, b2);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS ' || v_def;
END $view$;

-- ---------------------------------------------------------------------------
-- 9. Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
DECLARE v_src text; v_def text; v_cnt int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.fn_gate_depunere()');
  IF position('(a.status = ''nu_se_aplica''' || chr(10) IN v_src) > 0 OR position('fn_ofertare_cerinta_na_confirmata(c.id, ''nu_se_aplica'')' IN v_src) = 0 THEN
    RAISE EXCEPTION 'J02b post: fn_gate_depunere nu are ramura nouă';
  END IF;
  IF md5(v_src) IS DISTINCT FROM '59b42d41f8b67f60bfc283cbe0841017' THEN
    RAISE EXCEPTION 'J02b post: fn_gate_depunere ≠ versiunea din acest fișier';
  END IF;
  v_def := pg_get_viewdef('public.v_ofertare_pt_stare'::regclass);
  IF position('fn_ofertare_cerinta_na_confirmata' IN v_def) = 0 OR position('exceptate_propuse_ai' IN v_def) = 0 THEN
    RAISE EXCEPTION 'J02b post: v_ofertare_pt_stare nu are regula nouă';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_class WHERE oid IN ('public.v_ofertare_pt_stare'::regclass, 'public.v_ofertare_cerinte_na_stare'::regclass)
     AND reloptions @> ARRAY['security_invoker=on'];
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'J02b post: view-urile nu sunt security_invoker'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.fn_ofertare_cerinta_amprenta(bigint)'), to_regprocedure('public.fn_ofertare_cerinta_na_confirmata(bigint,text)'),
                   to_regprocedure('public.ofertare_confirma_neaplicabil(bigint,text,text,text)'), to_regprocedure('public.ofertare_revoca_neaplicabil(bigint,text)'),
                   to_regprocedure('public.fn_gate_depunere()'))
     AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'J02b post: SECURITY DEFINER / search_path / ACL anon incorecte (%/5)', v_cnt; END IF;
  IF has_function_privilege('authenticated', 'public.fn_gate_depunere()', 'EXECUTE') THEN
    RAISE EXCEPTION 'J02b post: authenticated are EXECUTE pe fn_gate_depunere';
  END IF;
  IF has_table_privilege('authenticated', 'public.ofertare_cerinte_na_confirmari', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ofertare_cerinte_na_confirmari', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.ofertare_cerinte_na_confirmari', 'DELETE')
     OR has_table_privilege('anon', 'public.ofertare_cerinte_na_confirmari', 'SELECT') THEN
    RAISE EXCEPTION 'J02b post: ACL pe ofertare_cerinte_na_confirmari prea larg';
  END IF;
  IF (SELECT md5 FROM public.ofertare_j02b_rollback_def WHERE obiect = 'v_ofertare_pt_stare') IS DISTINCT FROM 'c77c49b87642c5c2f584d2ed008c7bf3' THEN
    RAISE EXCEPTION 'J02b post: copia pentru rollback a view-ului lipsește/diferă';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.ofertare_cerinte_na_confirmari;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'J02b post: tabelul de confirmări trebuie să fie gol la livrare'; END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261004a: garda de livrare (final, după postcondiții) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_final$;
