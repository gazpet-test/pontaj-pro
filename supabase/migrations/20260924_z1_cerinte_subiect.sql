-- Z1 (24.09.2026) — gruparea cerințelor pe SUBIECT (tichetele Silviu TKT-2026-0231/0240/0275/0276).
--
-- Ce rezolvă: aceeași temă (EDSB, grafic, manager de proiect…) apare împrăștiată în registru la
-- poziții îndepărtate (#16, #37, #131, #420…) și omul nu poate pregăti un răspuns complet.
--
-- Ce NU face (acord cu Copilot, 24.09):
--   * subiectul NU e dublură: 8 rânduri EDSB = un subiect cu 8 obligații, nu 1 cerință + 7 copii;
--   * NU schimbă textul, tipul, proveniența, E2 (confirmata_de), starea, acoperirea sau versiunea —
--     de aceea stă în tabel SEPARAT, nu pe ofertare_cerinte (acolo triggerul de proveniență rămâne neatins);
--   * NU e capitol PT și NU e regulă de acoperire.
--
-- Regula e deterministă și versionată (ofertare_subiecte_regula.versiune). Prima cheie potrivită în
-- ordinea `ordine` câștigă; celelalte potriviri se păstrează în `alternative` și UI-ul le arată ca
-- „de verificat" (20–35% din rânduri au ≥2 potriviri — dacă le-am trimite pe toate în „neclasificat"
-- acoperirea ar cădea la ~50%). Fără nicio potrivire → 'neclasificat'.
-- Mutarea manuală (sursa='om') supraviețuiește reclasificării și se moștenește pe versiunea nouă a
-- cerinței (inlocuita_de).

-- ── 1. Regulile (dicționarul v2) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertare_subiecte_regula (
  versiune  int  NOT NULL,
  ordine    int  NOT NULL,
  cheie     text NOT NULL CHECK (cheie ~ '^[a-z_]+$' AND cheie <> 'neclasificat'),
  eticheta  text NOT NULL,
  regex     text NOT NULL,
  PRIMARY KEY (versiune, cheie),
  UNIQUE (versiune, ordine)
);
ALTER TABLE public.ofertare_subiecte_regula ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_subiecte_regula_select ON public.ofertare_subiecte_regula;
CREATE POLICY ofertare_subiecte_regula_select ON public.ofertare_subiecte_regula
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.ofertare_subiecte_regula FROM anon, authenticated;
GRANT SELECT ON public.ofertare_subiecte_regula TO authenticated;
GRANT ALL ON public.ofertare_subiecte_regula TO service_role;

-- Textul pe care rulează regex-urile: lower(unaccent(text_cerinta || ' ' || sursa_sectiune)).
INSERT INTO public.ofertare_subiecte_regula (versiune, ordine, cheie, eticheta, regex) VALUES
  (2, 10, 'personal_manager_proiect', '👤 Manager de proiect', 'manager(ul)? de proiect|coordonator (de )?(contract|proiect)'),
  (2, 20, 'personal_sef_santier', '👤 Șef de șantier', 'sef(ul)? de santier|sefului de santier'),
  (2, 30, 'personal_rte', '👤 RTE', 'responsabil\w* tehnic|\mr\.?t\.?e\.?\M'),
  (2, 40, 'personal_altii', '👥 Alți experți / personal', 'expert|personal(ul)? (cheie|propus|de specialitate)|nominaliz|diriginte'),
  (2, 50, 'autorizare_anre', '⚡ Autorizări ANRE (EDSB/PDSB/EGD)', 'edsb|pdsb|egd|autoriza\w* anre|\manre\M'),
  (2, 60, 'grafic_valoric', '💶 Grafic valoric / cash-flow', 'grafic(ul)? valoric|cash.?flow'),
  (2, 70, 'grafic_executie', '📅 Grafic de execuție / durată', 'grafic|program(ul)? (rezumativ|de executie|de lucru)|drum critic|jalo|durata (de executie|contractului|autorizata)|\m36 (de )?luni'),
  (2, 80, 'garantie_participare', '🛡️ Garanția de participare', 'garanti\w* de participare'),
  (2, 90, 'garantie_buna_executie', '🛡️ Garanția de bună execuție', 'garanti\w* de buna executie'),
  (2, 100, 'garantie_lucrari', '🛡️ Perioada de garanție a lucrărilor', 'perioad\w* de garantie|termen(ul)? de garantie|garantia lucrarilor|garantie a lucrarilor'),
  (2, 110, 'experienta_similara', '🏗️ Experiență similară', 'experienta similara|lucrari similare|contracte similare'),
  (2, 120, 'utilaje_dotari', '🚜 Utilaje și dotări', 'utilaj|echipamente tehnologice|aparat\w* de sud|excavator|buldo|autobasculant|dotari'),
  (2, 130, 'calitate_iso', '✅ Calitate / ISO / plan calitate', 'iso ?9001|iso ?14001|iso ?45001|sistem(ul)? de management|plan(ul)? (de management al )?calitatii|control(ul)? calitatii'),
  (2, 140, 'laborator', '🧪 Laborator', 'laborator'),
  (2, 150, 'mediu_patrimoniu', '🌿 Mediu / deșeuri / patrimoniu', 'mediu|deseu|zgomot|praf|emisii|arheolog|vestigii'),
  (2, 160, 'ssm', '⛑️ SSM', 'securitat\w* si sanatat|ssm|protectia muncii|conditiile specifice de munca|\msu\M'),
  (2, 170, 'topo', '📐 Topografie / trasare', 'topograf|trasar|coordonate'),
  (2, 180, 'probe_presiune', '🔧 Probe de presiune / etanșeitate', 'proba de (presiune|etanseitate|rezistenta)|etanseitat'),
  (2, 190, 'sudura', '🔥 Sudură', 'sudur|electrofuziune|sudor'),
  (2, 200, 'bransamente', '🔌 Branșamente / racorduri', 'bransament|racord|contoare'),
  (2, 210, 'subtraversari', '🕳️ Subtraversări / foraj', 'subtravers|foraj|forare'),
  (2, 220, 'solutie_tehnica', '⚙️ Soluție tehnică (conducte, SRM, vane)', 'srm|statie de reglare|vane|robinet|camine|conduct\w* (pehd|pe|otel)|pehd|dn ?\d'),
  (2, 230, 'materiale_agremente', '📦 Materiale / agremente / avize', 'agrement|aviz sanitar|certificat de conformitate|declarat\w* de performanta|fise tehnice|materiale|furnizor'),
  (2, 240, 'metodologie', '📘 Metodologie / tehnologie de execuție', 'metodologi|procedur\w* (tehnice )?de executie|copierea|abordare|descrierea lucrarilor|tehnologi\w* de executie|norme|stas'),
  (2, 250, 'riscuri', '⚠️ Riscuri', 'risc'),
  (2, 260, 'management_contract', '🗂️ Management contract / ședințe / rapoarte', 'sedint|intalnir|monitoriz|raport\w* (lunar|de progres)|situati\w* de lucrari|notific|faze determinante|predare.?primire|amplasament|demarare|ordin\w* de incepere'),
  (2, 270, 'asigurari', '📄 Asigurări', 'asigurar|polita'),
  (2, 280, 'penalitati', '⚖️ Penalități', 'penalit|daune'),
  (2, 290, 'financiar', '💰 Financiar / plăți / prețuri', 'propunere(a)? financiar|centralizator|devize|liste\w* (de )?(consum|cantitati)|valoare(a)? estimata|plat(a|i)|factur|avans|ajustare|pret(ul)?|utilitati'),
  (2, 300, 'participanti', '🤝 Asociați / subcontractanți / terți', 'subcontract|asociat|tert\w* sustinator|angajament ferm|sustinere'),
  (2, 310, 'excludere_duae', '🚫 Excludere / DUAE', 'duae|art\.? ?1[6-7]\d|excludere|conflict de interese|insolvent|cazier'),
  (2, 320, 'forma_depunere', '📨 Forma ofertei / depunere', 'valabilitate(a)? ofertei|valabila minimum|semnatur|seap|formular|depunere|limba romana|vizita amplasament|clarificar'),
  (2, 330, 'receptie_finalizare', '🏁 Recepție / organizare / finalizare', 'receptie|carte(a)? tehnica|as.?built|placut|constructii provizorii|organizare de santier'),
  (2, 340, 'santier_refaceri', '🚧 Șantier: trafic / refaceri', 'semnalizare|trafic|refacere|readuce|carosabil|asfalt|spatii verzi|stare(a)? initiala')
ON CONFLICT (versiune, cheie) DO NOTHING;

-- ── 2. Subiectul fiecărei cerințe (tabel separat — ofertare_cerinte rămâne neatins) ──────────
CREATE TABLE IF NOT EXISTS public.ofertare_cerinte_subiect (
  cerinta_id   bigint PRIMARY KEY REFERENCES public.ofertare_cerinte(id) ON DELETE CASCADE,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  subiect      text   NOT NULL CHECK (subiect ~ '^[a-z_]+$'),
  sursa        text   NOT NULL CHECK (sursa IN ('auto','om')),
  versiune     int,                                   -- versiunea regulii (doar la 'auto')
  alternative  text[] NOT NULL DEFAULT '{}',          -- celelalte subiecte potrivite → „de verificat"
  setat_de     uuid,
  setat_la     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_cerinte_subiect_sursa_ck CHECK (
    (sursa = 'auto' AND versiune IS NOT NULL) OR (sursa = 'om' AND setat_de IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ofertare_cerinte_subiect_lic_idx ON public.ofertare_cerinte_subiect (licitatie_id);
ALTER TABLE public.ofertare_cerinte_subiect ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_cerinte_subiect_select ON public.ofertare_cerinte_subiect;
CREATE POLICY ofertare_cerinte_subiect_select ON public.ofertare_cerinte_subiect
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
-- Fără politici de scriere: se scrie DOAR prin fn_ofertare_subiecte_aplica / fn_ofertare_subiect_muta.
REVOKE ALL ON public.ofertare_cerinte_subiect FROM anon, authenticated;
GRANT SELECT ON public.ofertare_cerinte_subiect TO authenticated;
GRANT ALL ON public.ofertare_cerinte_subiect TO service_role;

-- ── 3. Clasificarea unui text (determinist) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ofertare_subiect_clasifica(p_text text, p_sectiune text, p_versiune int)
RETURNS TABLE (subiect text, alternative text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  WITH t AS (SELECT lower(extensions.unaccent(coalesce(p_text, '') || ' ' || coalesce(p_sectiune, ''))) s),
  m AS (SELECT r.cheie, r.ordine FROM public.ofertare_subiecte_regula r, t
        WHERE r.versiune = p_versiune AND t.s ~ r.regex)
  SELECT coalesce((SELECT m.cheie FROM m ORDER BY m.ordine LIMIT 1), 'neclasificat'),
         coalesce((SELECT array_agg(m.cheie ORDER BY m.ordine) FROM m
                   WHERE m.ordine > (SELECT min(m2.ordine) FROM m m2)), '{}'::text[]);
$$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_subiect_clasifica(text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_subiect_clasifica(text, text, int) TO authenticated, service_role;

-- Calculul pe o licitație (intern): ce ar face „aplică" pe fiecare rând curent.
--   actiune: nou | schimbat | neschimbat | pastrat_om | mostenit
CREATE OR REPLACE FUNCTION public._fn_ofertare_subiecte_calc(p_licitatie_id bigint, p_versiune int)
RETURNS TABLE (cerinta_id bigint, nr_ordine int, actiune text, vechi text, subiect text,
               sursa text, alternative text[], setat_de uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT c.id, c.nr_ordine,
    CASE WHEN e.sursa = 'om' THEN 'pastrat_om'
         WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN 'mostenit'
         WHEN e.cerinta_id IS NULL THEN 'nou'
         WHEN e.subiect = k.subiect AND e.alternative = k.alternative AND e.versiune = p_versiune THEN 'neschimbat'
         ELSE 'schimbat' END,
    e.subiect,
    CASE WHEN e.sursa = 'om' THEN e.subiect WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN p.subiect ELSE k.subiect END,
    CASE WHEN e.sursa = 'om' OR (e.cerinta_id IS NULL AND p.subiect IS NOT NULL) THEN 'om' ELSE 'auto' END,
    CASE WHEN e.sursa = 'om' THEN e.alternative WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN '{}'::text[] ELSE k.alternative END,
    CASE WHEN e.sursa = 'om' THEN e.setat_de WHEN e.cerinta_id IS NULL AND p.subiect IS NOT NULL THEN p.setat_de END
  FROM public.ofertare_cerinte c
  LEFT JOIN public.ofertare_cerinte_subiect e ON e.cerinta_id = c.id
  CROSS JOIN LATERAL public.fn_ofertare_subiect_clasifica(c.text_cerinta, c.sursa_sectiune, p_versiune) k
  -- mutarea manuală de pe versiunea veche a aceleiași cerințe (clarificare → inlocuita_de)
  LEFT JOIN LATERAL (SELECT s.subiect, s.setat_de FROM public.ofertare_cerinte o
                     JOIN public.ofertare_cerinte_subiect s ON s.cerinta_id = o.id AND s.sursa = 'om'
                     WHERE o.inlocuita_de = c.id ORDER BY o.id DESC LIMIT 1) p ON true
  WHERE c.licitatie_id = p_licitatie_id AND c.inlocuita_de IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public._fn_ofertare_subiecte_calc(bigint, int) FROM PUBLIC, anon, authenticated;

-- ── 4. RPC: preview / aplică gruparea automată pe o licitație ─────────────────────────────
-- p_aplica = false → doar raport (nimic scris). true → scrie DOAR rândurile noi / auto schimbate /
-- moștenite; rândurile mutate de om (sursa='om') nu se ating niciodată.
CREATE OR REPLACE FUNCTION public.fn_ofertare_subiecte_aplica(p_licitatie_id bigint, p_aplica boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_ver int;
  v_rez jsonb;
  v_scrise int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT max(versiune) INTO v_ver FROM public.ofertare_subiecte_regula;
  IF v_ver IS NULL THEN RAISE EXCEPTION 'Nu există reguli de subiect'; END IF;

  WITH x AS (SELECT * FROM public._fn_ofertare_subiecte_calc(p_licitatie_id, v_ver))
  SELECT jsonb_build_object(
    'licitatie_id', p_licitatie_id, 'versiune', v_ver, 'aplicat', p_aplica,
    'total', (SELECT count(*) FROM x),
    'actiuni', coalesce((SELECT jsonb_object_agg(a, n) FROM (SELECT actiune a, count(*) n FROM x GROUP BY 1) q), '{}'::jsonb),
    'neclasificate', (SELECT count(*) FROM x WHERE subiect = 'neclasificat'),
    'de_verificat', (SELECT count(*) FROM x WHERE sursa = 'auto' AND cardinality(alternative) > 0),
    'pe_subiect', coalesce((SELECT jsonb_object_agg(s, n) FROM (SELECT subiect s, count(*) n FROM x GROUP BY 1) q), '{}'::jsonb),
    'schimbari', coalesce((SELECT jsonb_agg(jsonb_build_object('cerinta_id', q.cerinta_id, 'nr_ordine', q.nr_ordine, 'din', q.vechi, 'in', q.subiect) ORDER BY q.nr_ordine)
                           FROM (SELECT * FROM x WHERE actiune = 'schimbat' ORDER BY nr_ordine LIMIT 100) q), '[]'::jsonb))
  INTO v_rez;

  IF p_aplica THEN
    INSERT INTO public.ofertare_cerinte_subiect AS t (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la)
    SELECT x.cerinta_id, p_licitatie_id, x.subiect, x.sursa,
           CASE WHEN x.sursa = 'auto' THEN v_ver END, x.alternative,
           CASE WHEN x.sursa = 'auto' THEN auth.uid() ELSE x.setat_de END, now()
    FROM public._fn_ofertare_subiecte_calc(p_licitatie_id, v_ver) x
    WHERE x.actiune IN ('nou', 'schimbat', 'mostenit')
    ON CONFLICT (cerinta_id) DO UPDATE
      SET subiect = EXCLUDED.subiect, sursa = EXCLUDED.sursa, versiune = EXCLUDED.versiune,
          alternative = EXCLUDED.alternative, setat_de = EXCLUDED.setat_de, setat_la = now()
      WHERE t.sursa = 'auto';                        -- plasă: mutarea omului nu se suprascrie
    GET DIAGNOSTICS v_scrise = ROW_COUNT;
  END IF;
  RETURN v_rez || jsonb_build_object('scrise', v_scrise);
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_subiecte_aplica(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_subiecte_aplica(bigint, boolean) TO authenticated, service_role;

-- ── 5. RPC: omul mută o cerință în alt subiect (sau o dă înapoi regulii cu p_subiect = NULL) ──
CREATE OR REPLACE FUNCTION public.fn_ofertare_subiect_muta(p_cerinta_id bigint, p_subiect text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_ver int;
  c record;
  k record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT id, licitatie_id, text_cerinta, sursa_sectiune, inlocuita_de INTO c
  FROM public.ofertare_cerinte WHERE id = p_cerinta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cerința % nu există', p_cerinta_id; END IF;
  IF c.inlocuita_de IS NOT NULL THEN
    RAISE EXCEPTION 'Cerința % a fost înlocuită de #% — mută versiunea curentă', p_cerinta_id, c.inlocuita_de;
  END IF;
  SELECT max(versiune) INTO v_ver FROM public.ofertare_subiecte_regula;

  IF p_subiect IS NULL THEN            -- înapoi la regulă
    SELECT * INTO k FROM public.fn_ofertare_subiect_clasifica(c.text_cerinta, c.sursa_sectiune, v_ver);
    INSERT INTO public.ofertare_cerinte_subiect (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la)
    VALUES (c.id, c.licitatie_id, k.subiect, 'auto', v_ver, k.alternative, auth.uid(), now())
    ON CONFLICT (cerinta_id) DO UPDATE SET subiect = EXCLUDED.subiect, sursa = 'auto', versiune = EXCLUDED.versiune,
      alternative = EXCLUDED.alternative, setat_de = EXCLUDED.setat_de, setat_la = now();
    RETURN jsonb_build_object('cerinta_id', c.id, 'subiect', k.subiect, 'sursa', 'auto');
  END IF;

  IF p_subiect <> 'neclasificat' AND NOT EXISTS (
       SELECT 1 FROM public.ofertare_subiecte_regula WHERE versiune = v_ver AND cheie = p_subiect) THEN
    RAISE EXCEPTION 'Subiect necunoscut: %', p_subiect;
  END IF;
  INSERT INTO public.ofertare_cerinte_subiect (cerinta_id, licitatie_id, subiect, sursa, versiune, alternative, setat_de, setat_la)
  VALUES (c.id, c.licitatie_id, p_subiect, 'om', NULL, '{}', auth.uid(), now())
  ON CONFLICT (cerinta_id) DO UPDATE SET subiect = EXCLUDED.subiect, sursa = 'om', versiune = NULL,
    alternative = '{}', setat_de = EXCLUDED.setat_de, setat_la = now();
  RETURN jsonb_build_object('cerinta_id', c.id, 'subiect', p_subiect, 'sursa', 'om');
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_subiect_muta(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_subiect_muta(bigint, text) TO authenticated, service_role;
