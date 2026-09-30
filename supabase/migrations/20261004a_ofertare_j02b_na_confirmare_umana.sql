-- ============================================================================
-- J02b (DRAFT, NEAPLICAT). Prag de apply: DUPĂ depunerea Jilava CONFIRMATĂ (SEAP 06.10.2026) — vezi docs/J02B_REMEDIERE.md.
-- Incident: o cerință e tratată ca închisă/verde doar pentru că AI-ul a scris „nu se aplică”
--   (ofertare_acoperire.status='nu_se_aplica') sau „exceptat” (ofertare_pt_legaturi fel='exceptat' sursa='ai').
--   * fn_gate_depunere (poarta J02, triggerul trg_gate_depunere pe ofertare_licitatii) numără cerința acoperită
--     dacă EXISTĂ un rând a.status='nu_se_aplica' (propunere AI) — audit S05-02;
--   * v_ofertare_pt_stare numără cerința „exceptată” (scoasă din fara_capitol ⇒ poarta PT verde) pe orice legătură
--     fel='exceptat', inclusiv sursa='ai'.
-- Regula nouă: „nu se aplică”/„exceptat” închide o cerință DOAR prin confirmare umană explicită
--   (actor = auth.uid(), motiv, amprenta sursei — textul/versiunea cerinței + documentul sursă —, moment),
--   LEGATĂ DE PROPUNEREA CONCRETĂ pe care o validează (runda 2, decizie de semantică „validează o propunere concretă”):
--     * exceptat_pt  → legătura ofertare_pt_legaturi fel='exceptat' curentă (cea mai nouă) : legatura_id + amprenta rândului;
--     * nu_se_aplica → rândul ofertare_acoperire status='nu_se_aplica' curent (cel mai nou) : acoperire_id + amprenta rândului,
--                      sau NULL dacă nu există niciun rând (decizie umană fără propunere AI).
--   Validă doar cât: nerevocată ∧ amprenta sursei = cea curentă ∧ propunerea curentă = cea confirmată (id + amprentă).
--   Propunere nouă (B după A) / sursă schimbată ⇒ nevalidă automat (calculat la citire, fără trigger/job).
--   AI-ul rămâne PROPUNERE: vizibilă, dar poarta rămâne deschisă (cerința neînchisă).
-- Scriere în ofertare_cerinte_na_confirmari DOAR prin funcțiile SECURITY DEFINER (nici authenticated, nici service_role
--   nu au INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN).
-- Aditiv: tabel nou + funcții noi + view nou; fn_gate_depunere și v_ofertare_pt_stare sunt înlocuite doar după
--   pre-verificarea amprentei definițiilor LIVE citite pe 30.09.2026 (altfel REFUZ).
-- Revenire (NU e migrare, armare proprie): supabase/revenire/20261004a_ofertare_j02b_na_confirmare_umana_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (psql --single-transaction; garda gazpet.livrare_migrare legată de txid,
--   verificată la start și la final); fără BEGIN/COMMIT în fișier.
-- ============================================================================

DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004a_ofertare_j02b_na_confirmare_umana se livrează doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare, start)' USING ERRCODE = '42501';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții (fail-closed): producția identică cu analiza din 30.09.2026
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE v_cnt int; v_sp text;
BEGIN
  -- fn_are_acces_ofertare(): amprenta EXACTĂ ca în 20261004b (proprietar, limbaj, search_path, tip, semnătură, SECDEF,
  -- STABLE, md5, EXECUTE), fără alt overload cu același nume în nicio schemă
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_are_acces_ofertare()'::regprocedure AND p.pronamespace = 'public'::regnamespace AND p.oid::regprocedure::text = 'fn_are_acces_ofertare()' AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'sql' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'boolean'::regtype AND NOT p.proretset AND p.prokind = 'f' AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.prosecdef AND p.provolatile = 's' AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85' AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b pre: fn_are_acces_ofertare() lipsește sau diferă de amprenta citită pe 30.09 (postgres, sql, search_path=public, pg_temp, boolean, SECDEF, STABLE, md5 429d28e2a61fb24c8009d67050c16c85, EXECUTE doar authenticated/service_role)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b pre: există alt overload fn_are_acces_ofertare (în orice schemă) — apelul fără argumente ar putea fi ambiguu/deturnat';
  END IF;
  -- fn_gate_depunere(): md5 + proprietar + limbaj + SECDEF + search_path + trigger + ACL EXECUTE exact (postgres, service_role)
  IF to_regprocedure('public.fn_gate_depunere()') IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_gate_depunere()'::regprocedure AND pg_get_userbyid(p.proowner)::text = 'postgres' AND l.lanname = 'plpgsql' AND p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0 AND md5(p.prosrc) = '4bddf68cfe53107a622d210f4ef3ec51' AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'postgres:EXECUTE:false,service_role:EXECUTE:false' AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b pre: fn_gate_depunere live diferă de analiză (md5 4bddf68c…, postgres, plpgsql, SECDEF, search_path, EXECUTE doar postgres/service_role)';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proname = 'fn_gate_depunere') <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b pre: există alt overload fn_gate_depunere';
  END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass)) IS DISTINCT FROM 'c77c49b87642c5c2f584d2ed008c7bf3' THEN
    RAISE EXCEPTION 'REFUZ J02b pre: v_ofertare_pt_stare live diferă de analiză';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_class WHERE oid = 'public.v_ofertare_pt_stare'::regclass
     AND reloptions @> ARRAY['security_invoker=on'];
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'REFUZ J02b pre: v_ofertare_pt_stare nu e security_invoker=on'; END IF;
  IF to_regclass('public.ofertare_cerinte_na_confirmari') IS NOT NULL
     OR to_regclass('public.ofertare_cerinte_na_confirmari_arhiva_j02b') IS NOT NULL
     OR to_regclass('public.v_ofertare_cerinte_na_stare') IS NOT NULL
     OR to_regclass('public.ofertare_j02b_rollback_def') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
          ('fn_ofertare_cerinta_amprenta','fn_ofertare_na_propunere_curenta','fn_ofertare_na_confirmare_valida',
           'fn_ofertare_cerinta_na_confirmata','ofertare_confirma_neaplicabil','ofertare_revoca_neaplicabil')) THEN
    RAISE EXCEPTION 'REFUZ J02b pre: obiecte J02b există deja (reaplicare)';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgname = 'trg_gate_depunere' AND tgrelid = 'public.ofertare_licitatii'::regclass
     AND tgfoid = to_regprocedure('public.fn_gate_depunere()');
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'REFUZ J02b pre: trg_gate_depunere lipsă/diferit'; END IF;
  -- amprenta EXACTĂ a triggerului (citită live read-only, runda 3): pg_get_triggerdef(oid, true) cu search_path fixat
  -- (altfel prefixul de schemă depinde de sesiune), md5 35e7d6a7…, tgenabled='O', nu intern; exact un trigger cu numele ăsta
  v_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'public, pg_temp', true);
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgname = 'trg_gate_depunere' AND t.tgrelid = 'public.ofertare_licitatii'::regclass
     AND md5(pg_get_triggerdef(t.oid, true)) = '35e7d6a7f7d488556be1df754c26124f' AND t.tgenabled = 'O' AND NOT t.tgisinternal;
  PERFORM set_config('search_path', v_sp, true);
  IF v_cnt <> 1 OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_gate_depunere') <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b pre: trg_gate_depunere diferă de amprenta live (md5 35e7d6a7…, BEFORE INSERT OR UPDATE, FOR EACH ROW, fără WHEN, tgenabled=O)';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Confirmările umane. Scriere DOAR prin RPC-urile SECURITY DEFINER; append-only (revocarea marchează, nu șterge).
-- ---------------------------------------------------------------------------
CREATE TABLE public.ofertare_cerinte_na_confirmari (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id         bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  tip                text   NOT NULL CHECK (tip IN ('nu_se_aplica','exceptat_pt')),
  actor              uuid   NOT NULL REFERENCES public.profiles(id),
  motiv              text   NOT NULL CHECK (length(btrim(motiv)) >= 5),
  amprenta_sursa     text   NOT NULL CHECK (amprenta_sursa ~ '^[0-9a-f]{32}$'),
  -- propunerea concretă validată (fără FK: istoricul rămâne și dacă propunerea dispare; validitatea se calculează la citire)
  legatura_id        bigint,
  acoperire_id       bigint,
  amprenta_propunere text   CHECK (amprenta_propunere ~ '^[0-9a-f]{32}$'),
  cerinta_versiune   integer,
  sursa_document_id  bigint,
  confirmat_la       timestamptz NOT NULL DEFAULT now(),
  revocata_la        timestamptz,
  revocata_de        uuid REFERENCES public.profiles(id),
  revocata_motiv     text,
  CONSTRAINT ofertare_na_conf_propunere_chk CHECK (
    (tip = 'exceptat_pt'  AND legatura_id IS NOT NULL AND acoperire_id IS NULL AND amprenta_propunere IS NOT NULL)
    OR (tip = 'nu_se_aplica' AND legatura_id IS NULL AND ((acoperire_id IS NULL) = (amprenta_propunere IS NULL)))),
  CONSTRAINT ofertare_na_conf_revocare_chk CHECK (
    (revocata_la IS NULL AND revocata_de IS NULL AND revocata_motiv IS NULL)
    OR (revocata_la IS NOT NULL AND revocata_de IS NOT NULL AND length(btrim(COALESCE(revocata_motiv, ''))) >= 5))
);
-- o singură confirmare ACTIVĂ pe aceeași (cerință, tip, sursă, propunere): confirmarea repetată e idempotentă
CREATE UNIQUE INDEX ofertare_na_conf_activa_uq ON public.ofertare_cerinte_na_confirmari
  (cerinta_id, tip, amprenta_sursa, COALESCE(legatura_id, 0), COALESCE(acoperire_id, 0), COALESCE(amprenta_propunere, ''))
  WHERE revocata_la IS NULL;
COMMENT ON TABLE public.ofertare_cerinte_na_confirmari IS
  'J02b: confirmări UMANE „nu se aplică”/„exceptat PT”, legate de propunerea concretă (legatura_id / acoperire_id + amprenta_propunere). Valide doar prin fn_ofertare_na_confirmare_valida. Scriere doar prin ofertare_confirma_neaplicabil / ofertare_revoca_neaplicabil.';

ALTER TABLE public.ofertare_cerinte_na_confirmari ENABLE ROW LEVEL SECURITY;
-- default privileges Supabase dau ALL la anon/authenticated/service_role pe tabele noi ⇒ se retrag TOATE, apoi doar SELECT
REVOKE ALL ON public.ofertare_cerinte_na_confirmari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_cerinte_na_confirmari TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ofertare_cerinte_na_confirmari_id_seq FROM PUBLIC, anon, authenticated, service_role;
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
-- 3. Propunerea CURENTĂ pe care o validează o confirmare (cea mai nouă, după id), cu amprenta rândului întreg:
--    exceptat_pt → ofertare_pt_legaturi fel='exceptat'; nu_se_aplica → ofertare_acoperire status='nu_se_aplica'.
--    Orice rând nou (B după A) sau orice modificare a rândului ⇒ alt (id, amprentă) ⇒ confirmarea veche nu se moștenește.
--    Fără acces Ofertare (utilizator logat) ⇒ (NULL, NULL); helperul de validitate cade oricum pe amprenta sursei NULL.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ofertare_na_propunere_curenta(p_cerinta_id bigint, p_tip text,
                                                        OUT propunere_id bigint, OUT amprenta_propunere text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RETURN;
  END IF;
  IF p_tip = 'exceptat_pt' THEN
    SELECT l.id, md5('j02b-leg-v1|' || to_jsonb(l)::text) INTO propunere_id, amprenta_propunere
      FROM public.ofertare_pt_legaturi l
     WHERE l.cerinta_id = p_cerinta_id AND l.fel = 'exceptat'
     ORDER BY l.id DESC LIMIT 1;
  ELSIF p_tip = 'nu_se_aplica' THEN
    SELECT a.id, md5('j02b-acop-v1|' || to_jsonb(a)::text) INTO propunere_id, amprenta_propunere
      FROM public.ofertare_acoperire a
     WHERE a.cerinta_id = p_cerinta_id AND a.status = 'nu_se_aplica'
     ORDER BY a.id DESC LIMIT 1;
  END IF;
END $fn$;

-- ---------------------------------------------------------------------------
-- 4. Validitatea UNEI confirmări (sursa unică a regulii: helperul, view-ul UI și poarta o folosesc pe aceasta)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ofertare_na_confirmare_valida(p_confirmare_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE k record; v_amp text; p record;
BEGIN
  SELECT * INTO k FROM public.ofertare_cerinte_na_confirmari WHERE id = p_confirmare_id;
  IF NOT FOUND OR k.revocata_la IS NOT NULL THEN RETURN false; END IF;
  v_amp := public.fn_ofertare_cerinta_amprenta(k.cerinta_id);
  IF v_amp IS NULL OR v_amp <> k.amprenta_sursa THEN RETURN false; END IF;
  SELECT * INTO p FROM public.fn_ofertare_na_propunere_curenta(k.cerinta_id, k.tip);
  IF k.tip = 'exceptat_pt' THEN
    RETURN p.propunere_id IS NOT NULL AND p.propunere_id = k.legatura_id AND p.amprenta_propunere = k.amprenta_propunere;
  END IF;
  -- nu_se_aplica: legată de rândul AI curent, sau (fără niciun rând AI) de „nicio propunere”
  RETURN p.propunere_id IS NOT DISTINCT FROM k.acoperire_id AND p.amprenta_propunere IS NOT DISTINCT FROM k.amprenta_propunere;
END $fn$;

-- ---------------------------------------------------------------------------
-- 5. Există o confirmare umană VALIDĂ pentru cerință/tip?
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ofertare_cerinta_na_confirmata(p_cerinta_id bigint, p_tip text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.ofertare_cerinte_na_confirmari k
                  WHERE k.cerinta_id = p_cerinta_id AND k.tip = p_tip AND k.revocata_la IS NULL
                    AND public.fn_ofertare_na_confirmare_valida(k.id));
END $fn$;

-- ---------------------------------------------------------------------------
-- 6. RPC: confirmarea umană a unei propuneri concrete. Stale (amprenta sursei sau propunerea văzută ≠ curentă) ⇒ REFUZ.
--    Idempotentă: aceeași (cerință, tip, sursă, propunere) activă ⇒ întoarce id-ul existent, nu dublează.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ofertare_confirma_neaplicabil(p_cerinta_id bigint, p_tip text, p_motiv text, p_amprenta_vazuta text,
                                                     p_propunere_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_amp text; v_id bigint; c record; p record;
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
  IF p_tip = 'exceptat_pt' AND p_propunere_id IS NULL THEN
    RAISE EXCEPTION 'J02b: exceptarea PT se confirmă pe o legătură „exceptat” concretă (p_propunere_id)' USING ERRCODE = '22023';
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
  SELECT * INTO p FROM public.fn_ofertare_na_propunere_curenta(p_cerinta_id, p_tip);
  IF p_tip = 'exceptat_pt' AND p.propunere_id IS NULL THEN
    RAISE EXCEPTION 'J02b: cerința % nu are nicio legătură „exceptat” de confirmat', p_cerinta_id USING ERRCODE = 'P0001';
  END IF;
  IF p_propunere_id IS DISTINCT FROM p.propunere_id THEN
    RAISE EXCEPTION 'J02b: propunerea s-a schimbat față de ce ai văzut (curentă: %, văzută: %) — recitește și confirmă din nou',
      COALESCE(p.propunere_id::text, 'niciuna'), COALESCE(p_propunere_id::text, 'niciuna') USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.ofertare_cerinte_na_confirmari
    (cerinta_id, tip, actor, motiv, amprenta_sursa, legatura_id, acoperire_id, amprenta_propunere, cerinta_versiune, sursa_document_id)
  VALUES (p_cerinta_id, p_tip, v_uid, btrim(p_motiv), v_amp,
          CASE WHEN p_tip = 'exceptat_pt' THEN p.propunere_id END,
          CASE WHEN p_tip = 'nu_se_aplica' THEN p.propunere_id END,
          p.amprenta_propunere, c.versiune, c.sursa_document_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN   -- idempotent: există deja confirmarea activă pe exact aceeași sursă + propunere
    SELECT k.id INTO v_id FROM public.ofertare_cerinte_na_confirmari k
     WHERE k.cerinta_id = p_cerinta_id AND k.tip = p_tip AND k.revocata_la IS NULL AND k.amprenta_sursa = v_amp
       AND COALESCE(k.legatura_id, 0) = COALESCE(CASE WHEN p_tip = 'exceptat_pt' THEN p.propunere_id END, 0)
       AND COALESCE(k.acoperire_id, 0) = COALESCE(CASE WHEN p_tip = 'nu_se_aplica' THEN p.propunere_id END, 0)
       AND COALESCE(k.amprenta_propunere, '') = COALESCE(p.amprenta_propunere, '');
    IF v_id IS NULL THEN RAISE EXCEPTION 'J02b: conflict neașteptat la confirmare' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN v_id;
END $fn$;

-- ---------------------------------------------------------------------------
-- 7. RPC: revocarea (doar autorul confirmării sau ownerul); rândul rămâne (istoric)
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

-- ACL funcții: default privileges Supabase dau EXECUTE la anon/authenticated/service_role ⇒ se retrag TOATE, apoi minim.
REVOKE ALL ON FUNCTION public.fn_ofertare_cerinta_amprenta(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ofertare_na_propunere_curenta(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ofertare_na_confirmare_valida(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ofertare_cerinta_na_confirmata(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ofertare_confirma_neaplicabil(bigint, text, text, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ofertare_revoca_neaplicabil(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
-- authenticated: amprenta + propunerea curentă (UI le trimite înapoi la confirmare), validitatea + helperul (chemate din
-- view-urile security_invoker), cele două RPC-uri. service_role: doar citire (amprentă/propunere/validitate/helper). anon: nimic.
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_amprenta(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_na_propunere_curenta(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_na_confirmare_valida(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinta_na_confirmata(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_confirma_neaplicabil(bigint, text, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_revoca_neaplicabil(bigint, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. View pentru UI: confirmările, cu `valida` calculat de aceeași funcție ca poarta
-- ---------------------------------------------------------------------------
CREATE VIEW public.v_ofertare_cerinte_na_stare WITH (security_invoker = on) AS
SELECT k.id AS confirmare_id, k.cerinta_id, k.tip, k.actor, k.motiv, k.confirmat_la,
       k.legatura_id, k.acoperire_id, k.cerinta_versiune, k.sursa_document_id,
       k.revocata_la, k.revocata_de, k.revocata_motiv,
       public.fn_ofertare_na_confirmare_valida(k.id) AS valida
  FROM public.ofertare_cerinte_na_confirmari k;
REVOKE ALL ON public.v_ofertare_cerinte_na_stare FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_cerinte_na_stare TO authenticated, service_role;

-- 9. fn_gate_depunere: nu_se_aplica AI ⇒ NU mai acoperă; acoperă doar confirmarea umană validă.
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
-- 10. v_ofertare_pt_stare: „exceptată” DOAR cu confirmare umană validă (pe legătura curentă); coloană nouă (la final)
--    exceptate_propuse_ai = legături 'exceptat' fără confirmare validă (vizibile, dar cerința rămâne în fara_capitol).
--    Înlocuire textuală pe definiția LIVE verificată prin md5 în §0; fiecare fragment trebuie să apară EXACT o dată.
-- ---------------------------------------------------------------------------
-- Definiția live de dinainte se păstrează pentru revenire exactă (verificată prin md5 la revenire). Nimeni din aplicație.
CREATE TABLE public.ofertare_j02b_rollback_def (
  obiect text PRIMARY KEY, definitie text NOT NULL, md5 text NOT NULL, salvat_la timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ofertare_j02b_rollback_def ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_j02b_rollback_def FROM PUBLIC, anon, authenticated, service_role;
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
    RAISE EXCEPTION 'REFUZ J02b view: fragmentul exceptata nu apare exact o dată';
  END IF;
  IF (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'REFUZ J02b view: fragmentul dovada_de_verificat nu apare exact o dată';
  END IF;
  v_def := replace(replace(v_def, a1, b1), a2, b2);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS ' || v_def;
END $view$;

-- ---------------------------------------------------------------------------
-- 11. Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
DECLARE v_src text; v_def text; v_cnt int; r record; v_acl text; v_sp text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('public.fn_gate_depunere()');
  IF position('(a.status = ''nu_se_aplica''' || chr(10) IN v_src) > 0 OR position('fn_ofertare_cerinta_na_confirmata(c.id, ''nu_se_aplica'')' IN v_src) = 0 THEN
    RAISE EXCEPTION 'J02b post: fn_gate_depunere nu are ramura nouă';
  END IF;
  IF md5(v_src) IS DISTINCT FROM '59b42d41f8b67f60bfc283cbe0841017' THEN
    RAISE EXCEPTION 'J02b post: fn_gate_depunere ≠ versiunea din acest fișier';
  END IF;
  -- fn_gate_depunere: proprietar + ACL neschimbate (postgres, service_role), fără PUBLIC
  IF (SELECT count(*) FROM pg_proc p WHERE p.oid = 'public.fn_gate_depunere()'::regprocedure AND pg_get_userbyid(p.proowner)::text = 'postgres'
        AND p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
        AND (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x WHERE x.grantee <> 0) = 'postgres:EXECUTE:false,service_role:EXECUTE:false'
        AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1 THEN
    RAISE EXCEPTION 'J02b post: fn_gate_depunere proprietar/ACL schimbat';
  END IF;
  v_def := pg_get_viewdef('public.v_ofertare_pt_stare'::regclass);
  IF position('fn_ofertare_cerinta_na_confirmata' IN v_def) = 0 OR position('exceptate_propuse_ai' IN v_def) = 0 THEN
    RAISE EXCEPTION 'J02b post: v_ofertare_pt_stare nu are regula nouă';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_class WHERE oid IN ('public.v_ofertare_pt_stare'::regclass, 'public.v_ofertare_cerinte_na_stare'::regclass)
     AND reloptions @> ARRAY['security_invoker=on'];
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'J02b post: view-urile nu sunt security_invoker'; END IF;
  -- funcțiile noi: proprietar postgres, SECDEF, search_path fix, ACL EXECUTE EXACT, fără PUBLIC
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ofertare_cerinta_amprenta(bigint)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false'),
      ('public.fn_ofertare_na_propunere_curenta(bigint,text)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false'),
      ('public.fn_ofertare_na_confirmare_valida(bigint)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false'),
      ('public.fn_ofertare_cerinta_na_confirmata(bigint,text)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false,service_role:EXECUTE:false'),
      ('public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false'),
      ('public.ofertare_revoca_neaplicabil(bigint,text)', 'authenticated:EXECUTE:false,postgres:EXECUTE:false')) AS t(sig, acl)
  LOOP
    SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type || ':' || x.is_grantable::text, ',' ORDER BY x.grantee::regrole::text)
      INTO v_acl FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = to_regprocedure(r.sig) AND x.grantee <> 0;
    IF (SELECT count(*) FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig) AND pg_get_userbyid(p.proowner)::text = 'postgres'
          AND p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
          AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee = 0)) <> 1
       OR v_acl IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'J02b post: % — proprietar/SECDEF/search_path/ACL incorecte (ACL %; așteptat %)', r.sig, v_acl, r.acl;
    END IF;
  END LOOP;
  -- ACL EFECTIV (include moștenirea prin membership) pe RPC-urile umane: doar authenticated
  FOR r IN SELECT * FROM (VALUES ('public.ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)'), ('public.ofertare_revoca_neaplicabil(bigint,text)')) AS t(sig) LOOP
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE')
       OR has_function_privilege('anon', r.sig, 'EXECUTE')
       OR has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'J02b post: EXECUTE efectiv pe % ≠ {authenticated} (anon/service_role îl au direct sau prin membership)', r.sig;
    END IF;
  END LOOP;
  -- triggerul porții: aceeași amprentă exactă ca înainte
  v_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'public, pg_temp', true);
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgname = 'trg_gate_depunere' AND t.tgrelid = 'public.ofertare_licitatii'::regclass
     AND md5(pg_get_triggerdef(t.oid, true)) = '35e7d6a7f7d488556be1df754c26124f' AND t.tgenabled = 'O' AND NOT t.tgisinternal
     AND t.tgfoid = 'public.fn_gate_depunere()'::regprocedure;
  PERFORM set_config('search_path', v_sp, true);
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'J02b post: trg_gate_depunere diferă de amprenta live'; END IF;
  IF has_function_privilege('authenticated', 'public.fn_gate_depunere()', 'EXECUTE') THEN
    RAISE EXCEPTION 'J02b post: authenticated are EXECUTE pe fn_gate_depunere';
  END IF;
  -- tabelul de confirmări: authenticated + service_role DOAR SELECT; anon nimic; PUBLIC nimic în ACL brut; 0 ACL pe coloane
  FOR r IN SELECT rol, pr FROM unnest(ARRAY['authenticated','service_role','anon']) rol,
                  unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr LOOP
    IF has_table_privilege(r.rol, 'public.ofertare_cerinte_na_confirmari', r.pr) THEN
      RAISE EXCEPTION 'J02b post: % are % pe ofertare_cerinte_na_confirmari', r.rol, r.pr;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.ofertare_cerinte_na_confirmari', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.ofertare_cerinte_na_confirmari', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ofertare_cerinte_na_confirmari', 'SELECT')
     OR has_table_privilege('anon', 'public.v_ofertare_cerinte_na_stare', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x
                 WHERE c.oid IN ('public.ofertare_cerinte_na_confirmari'::regclass, 'public.v_ofertare_cerinte_na_stare'::regclass,
                                 'public.ofertare_j02b_rollback_def'::regclass, 'public.ofertare_cerinte_na_confirmari_id_seq'::regclass)
                   AND x.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.ofertare_cerinte_na_confirmari'::regclass,
                  'public.v_ofertare_cerinte_na_stare'::regclass, 'public.ofertare_j02b_rollback_def'::regclass) AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'J02b post: ACL pe ofertare_cerinte_na_confirmari / view / copia de revenire incorect (SELECT, PUBLIC sau ACL pe coloane)';
  END IF;
  IF (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text, x.privilege_type)
        FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.ofertare_cerinte_na_confirmari'::regclass AND x.grantee <> c.relowner)
     IS DISTINCT FROM 'authenticated:SELECT,service_role:SELECT' THEN
    RAISE EXCEPTION 'J02b post: ACL brut pe ofertare_cerinte_na_confirmari ≠ {authenticated:SELECT, service_role:SELECT}';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.ofertare_j02b_rollback_def'::regclass AND x.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'J02b post: copia de revenire e accesibilă altcuiva decât proprietarului';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = 'public.ofertare_na_conf_activa_uq'::regclass AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'J02b post: indexul unic parțial pe confirmările active lipsește';
  END IF;
  IF (SELECT md5 FROM public.ofertare_j02b_rollback_def WHERE obiect = 'v_ofertare_pt_stare') IS DISTINCT FROM 'c77c49b87642c5c2f584d2ed008c7bf3' THEN
    RAISE EXCEPTION 'J02b post: copia pentru revenire a view-ului lipsește/diferă';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.ofertare_cerinte_na_confirmari;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'J02b post: tabelul de confirmări trebuie să fie gol la livrare'; END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: 20261004a_ofertare_j02b_na_confirmare_umana — garda de livrare (final, după postcondiții) — doar prin scripts/livrare_migrare.sh' USING ERRCODE = '42501';
  END IF;
END $livrare_final$;
