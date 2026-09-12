-- ofertare_propunere_tehnica_v1
--
-- Matricea de conformitate a propunerii tehnice: fiecare cerinta de tip 'propunere' sau 'forma'
-- trebuie sa iasa undeva — ori primeste un capitol, ori are deja dovada in registru, ori e
-- exceptata cu motiv scris. Semaforul sta rosu pana atunci.
--
-- DOUA REGULI care au omorat prima variantia a acestui modul si de care depinde tot:
--
-- 1. NU se scrie NICIODATA in ofertare_cerinte. Campul `stare='nu_se_aplica'` de acolo e verdictul
--    omului pe ACOPERIRE — e citit de AcoperireSection (OfertareLicitatii.jsx:1993) si de
--    v_ofertare_dashboard. Daca modulul de propunere ar folosi acelasi bit, o actiune in bloc
--    ar stinge acoperiri deja probate (235 doar la licitatia 3). De aceea exceptia PT are randul
--    ei, in ofertare_pt_legaturi.fel='exceptat'.
--
-- 2. Semaforul nu poate da verde din lipsa de date. 68 din 73 de licitatii n-au nicio cerinta;
--    un view cu GROUP BY pe cerinte n-ar intoarce niciun rand pentru ele, iar
--    `poarta.some(r => r.stare==='block')` pe array gol e false — adica VERDE pe un dosar necitit.
--    De aceea view-ul pleaca de la ofertare_licitatii cu LEFT JOIN: un rand per licitatie, mereu.
--
-- Legatura cerinta->capitol sta in tabel propriu, nu in ofertare_acoperire: acolo exista
-- ofertare_acoperire_cerinta_unic_nevalidat ON (cerinta_id) WHERE verificat_pe_scan=false, iar
-- edge fn 'ofertare-acoperire' sterge si rescrie randurile nevalidate la fiecare "Propune".
-- Orice legatura pusa acolo s-ar pierde tacut la prima apasare.

-- ── 1. Capitolele propunerii, per licitatie ───────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertare_pt_capitole (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint   NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  nr             smallint NOT NULL CHECK (nr BETWEEN 1 AND 40),
  titlu          text     NOT NULL CHECK (btrim(titlu) <> ''),
  obligatoriu    boolean  NOT NULL DEFAULT true,
  formular       text,
  continut       text,
  fisier_path    text,
  stare          text     NOT NULL DEFAULT 'gol'
                 CHECK (stare IN ('gol','in_lucru','scris','verificat','nu_se_aplica')),
  stare_motiv    text,
  responsabil_id uuid REFERENCES public.profiles(id),
  nota           text,
  creat_de       uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_capitole_motiv_chk
    CHECK (stare <> 'nu_se_aplica' OR btrim(coalesce(stare_motiv,'')) <> ''),
  CONSTRAINT ofertare_pt_capitole_unic UNIQUE (licitatie_id, nr)
);

-- ── 2. Legatura cerinta -> capitol, SI exceptia PT ────────────────────
CREATE TABLE IF NOT EXISTS public.ofertare_pt_legaturi (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id   bigint NOT NULL REFERENCES public.ofertare_cerinte(id)     ON DELETE CASCADE,
  capitol_id   bigint          REFERENCES public.ofertare_pt_capitole(id) ON DELETE CASCADE,
  fel          text   NOT NULL DEFAULT 'capitol' CHECK (fel IN ('capitol','exceptat')),
  motiv        text,
  sursa        text   NOT NULL DEFAULT 'om' CHECK (sursa IN ('om','ai')),
  confirmat_de uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  confirmat_la timestamptz NOT NULL DEFAULT now(),
  nota         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- 'exceptat' = "nu se aplica LA PROPUNEREA TEHNICA". NU atinge ofertare_cerinte.stare,
  -- care inseamna "nu se aplica LA ACOPERIRE" si e citit de AcoperireSection + dashboard.
  CONSTRAINT ofertare_pt_legaturi_fel_chk CHECK (
       (fel = 'capitol'  AND capitol_id IS NOT NULL)
    OR (fel = 'exceptat' AND capitol_id IS NULL AND btrim(coalesce(motiv,'')) <> '')),
  CONSTRAINT ofertare_pt_legaturi_unic UNIQUE (cerinta_id, capitol_id)
);

-- UNIQUE de mai sus nu prinde NULL-urile (NULLs distinct) — exceptia se unicizeaza partial:
CREATE UNIQUE INDEX IF NOT EXISTS ofertare_pt_legaturi_exceptat_unic
  ON public.ofertare_pt_legaturi (cerinta_id) WHERE fel = 'exceptat';
CREATE INDEX IF NOT EXISTS ofertare_pt_legaturi_capitol_idx
  ON public.ofertare_pt_legaturi (capitol_id);
CREATE INDEX IF NOT EXISTS ofertare_pt_legaturi_cerinta_idx
  ON public.ofertare_pt_legaturi (cerinta_id);

-- Garda: cerinta si capitolul pe ACEEASI licitatie (un CHECK nu poate trece intre tabele).
CREATE OR REPLACE FUNCTION public.fn_pt_legatura_coerenta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l_cer bigint; l_cap bigint;
BEGIN
  IF NEW.capitol_id IS NULL THEN RETURN NEW; END IF;
  SELECT licitatie_id INTO l_cer FROM public.ofertare_cerinte     WHERE id = NEW.cerinta_id;
  SELECT licitatie_id INTO l_cap FROM public.ofertare_pt_capitole WHERE id = NEW.capitol_id;
  IF l_cer IS NULL OR l_cap IS NULL OR l_cer <> l_cap THEN
    RAISE EXCEPTION 'Legatura PT: cerinta % si capitolul % nu sunt pe aceeasi licitatie',
      NEW.cerinta_id, NEW.capitol_id;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_pt_legatura_coerenta() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_pt_legaturi_coerenta ON public.ofertare_pt_legaturi;
CREATE TRIGGER trg_pt_legaturi_coerenta
  BEFORE INSERT OR UPDATE ON public.ofertare_pt_legaturi
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_legatura_coerenta();

-- ── 3. Verdictul portii, inghetat (tiparul grafic_versiuni) ───────────
CREATE TABLE IF NOT EXISTS public.ofertare_pt_poarta (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint  NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  versiune     integer NOT NULL,
  verdict      text    NOT NULL CHECK (verdict IN ('rosu','galben','verde')),
  poarta       jsonb   NOT NULL DEFAULT '[]'::jsonb,
  snapshot     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  nota         text,
  semnat_de    uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  semnat_la    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_poarta_unic UNIQUE (licitatie_id, versiune)
);

DROP TRIGGER IF EXISTS trg_pt_capitole_upd ON public.ofertare_pt_capitole;
CREATE TRIGGER trg_pt_capitole_upd BEFORE UPDATE ON public.ofertare_pt_capitole
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. RLS + GRANT + policies ────────────────────────────────────────
-- Privilegiile implicite Supabase dau anon+authenticated DML pe tabele noi, iar GRANT nu le
-- sterge. De aceea: intai REVOKE tot, apoi GRANT explicit.
ALTER TABLE public.ofertare_pt_capitole ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_pt_legaturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_pt_poarta   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ofertare_pt_capitole, public.ofertare_pt_legaturi, public.ofertare_pt_poarta
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.ofertare_pt_capitole, public.ofertare_pt_legaturi, public.ofertare_pt_poarta
  TO authenticated;
GRANT ALL ON public.ofertare_pt_capitole, public.ofertare_pt_legaturi, public.ofertare_pt_poarta
  TO service_role;

DO $pol$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_pt_capitole','ofertare_pt_legaturi','ofertare_pt_poarta'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()))', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()))', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))', t||'_del', t);
  END LOOP;
END $pol$;

-- ── 5. Semaforul: UN RAND PER LICITATIE, inclusiv cele 68 fara cerinte ─
CREATE OR REPLACE VIEW public.v_ofertare_pt_stare
WITH (security_invoker = on) AS
WITH cer AS (
  SELECT c.id, c.licitatie_id, c.tip,
    (c.text_cerinta ~* '(respins|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept)') AS capcana,
    EXISTS (SELECT 1 FROM public.ofertare_acoperire a
             WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener'))       AS dovedita,
    EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi l
             WHERE l.cerinta_id = c.id AND l.fel = 'capitol')                                  AS are_capitol,
    EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi l
             WHERE l.cerinta_id = c.id AND l.fel = 'exceptat')                                 AS exceptata
  FROM public.ofertare_cerinte c
  WHERE c.tip IN ('propunere','forma')
    AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
)
SELECT l.id AS licitatie_id,
  count(cer.id)                                                                        AS de_raspuns,
  count(*) FILTER (WHERE cer.tip = 'forma')                                            AS de_forma,
  count(*) FILTER (WHERE cer.are_capitol)                                              AS cu_capitol,
  count(*) FILTER (WHERE cer.exceptata AND NOT cer.are_capitol)                        AS exceptate,
  -- cerinte deja probate cu document/autorizatie/experienta in registru: NU cer capitol,
  -- dar se arata separat, nu se sting si nu se ascund
  count(*) FILTER (WHERE cer.dovedita AND NOT cer.are_capitol AND NOT cer.exceptata)   AS inchise_cu_dovada,
  count(*) FILTER (WHERE NOT cer.are_capitol AND NOT cer.exceptata AND NOT cer.dovedita) AS fara_capitol,
  count(*) FILTER (WHERE cer.capcana)                                                  AS capcane,
  count(*) FILTER (WHERE cer.capcana AND NOT cer.are_capitol AND NOT cer.exceptata)    AS capcane_descoperite,
  (SELECT count(*) FROM public.ofertare_pt_capitole k WHERE k.licitatie_id = l.id)     AS capitole,
  (SELECT count(*) FROM public.ofertare_pt_capitole k WHERE k.licitatie_id = l.id
     AND k.obligatoriu AND k.stare <> 'nu_se_aplica'
     AND coalesce(btrim(k.continut),'') = '' AND coalesce(btrim(k.fisier_path),'') = '') AS capitole_goale,
  -- clauza Finta, verbatim: "nu se va accepta mentiuni precum «nu este cazul»"
  (SELECT count(*) FROM public.ofertare_pt_capitole k WHERE k.licitatie_id = l.id
     AND k.continut ~* 'nu (este|e) cazul')                                            AS capitole_nu_e_cazul,
  (SELECT count(*) FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = l.id) AS documente,
  (SELECT count(*) FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = l.id
     AND (d.eroare IS NOT NULL OR d.status_procesare IN ('neprocesat','partial')))     AS documente_necitite,
  (SELECT max(p.versiune) FROM public.ofertare_pt_poarta p WHERE p.licitatie_id = l.id) AS pt_versiune,
  (SELECT p.verdict FROM public.ofertare_pt_poarta p WHERE p.licitatie_id = l.id
     ORDER BY p.versiune DESC LIMIT 1)                                                 AS pt_verdict,
  (SELECT max(g.versiune) FROM public.grafic_versiuni g WHERE g.licitatie_id = l.id)   AS grafic_versiune
FROM public.ofertare_licitatii l
LEFT JOIN cer ON cer.licitatie_id = l.id
GROUP BY l.id;

GRANT SELECT ON public.v_ofertare_pt_stare TO authenticated, service_role;

COMMENT ON TABLE public.ofertare_pt_legaturi IS
  'Legatura cerinta->capitol de propunere tehnica. fel=''exceptat'' inseamna "nu se aplica LA PROPUNERE" si este DISTINCT de ofertare_cerinte.stare=''nu_se_aplica'', care inseamna "nu se aplica LA ACOPERIRE". Nu le unifica.';
