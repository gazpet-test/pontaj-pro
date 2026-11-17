-- 20261212a_redari_fan_awb.sql — FAN Courier: AWB-urile plicurilor Redări, cu aprobarea owner-ului înainte de orice cost.
-- STARE: NEAPLICATĂ și NETESTATĂ pe BD reală (scrisă de redari@ 06.11.2026, extinsă 17.11.2026 pentru transportul complet, fără acces la BD).
-- Probată local pe PGlite (scripts/pglite/test_redari_fan_awb_local.mjs: aplicare → comportament → mutanți → revenire → re-aplicare).
-- Înainte de apply: DRY pe clona schemei, review Jakarinos + Fable, „da”-ul lui Răzvan, aplicare de către chat.
-- Revenire: supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql. Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§6.
--
-- De ce tabel separat: red_plicuri.awb + data_expediere sunt legate prin CHECK și marchează „expediat” pe convocări (termenul de
-- 10 zile). Un AWB generat dar neridicat de curier nu e expediere → stă aici până la evenimentul FAN C0, confirmat de om.
-- Minimizare: tabelele NU păstrează numele / telefonul / adresa trimise la FAN și nici răspunsurile FAN brute (confirmarea poate conține
-- numele primitorului), doar hash-ul datelor (sha256 pe JSON canonic, supabase/functions/_shared/redariFan.mjs::hashPlicFan) și stări.
--
-- Ordinea lock-urilor pe toate căile (L06): red_loturi_plicuire FOR UPDATE → red_plicuri ORDER BY id FOR UPDATE → red_fan_awb ORDER BY id FOR UPDATE.
-- Căile care iau doar o parte din lanț îl iau în aceeași ordine (ex. rezultatele: doar red_fan_awb). red_fan_setari / red_fan_loturi se citesc
-- sub lock-ul lotului (marcajul nu se mai schimbă după aprobare; plafonul e per lot).
-- Identitatea = auth.uid() (L08); niciun parametru de utilizator. Scrierile DOAR prin RPC-urile de mai jos (fără GRANT INSERT/UPDATE/DELETE).
-- Lotul pilot: red_fan_setari.limita_lot (implicit 20 = LIMITA_LOT_PILOT_IMPLICITA din redariFan.mjs, test de paritate) — plafonul de plicuri
-- aprobate pe un lot, ridicat de owner când primele loturi au mers. Marcajul de TEST: red_fan_loturi.test, decis de owner ÎNAINTE de aprobare;
-- un lot de test NU scrie expedierea pe plic (fără efect în registru, export și PV), doar în evidența FAN.

BEGIN;

DO $pre$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NOT NULL OR to_regclass('public.red_fan_loturi') IS NOT NULL OR to_regclass('public.red_fan_setari') IS NOT NULL THEN
    RAISE EXCEPTION '20261212a: tabelele FAN există deja'; END IF;
  IF to_regclass('public.red_plicuri') IS NULL OR to_regclass('public.red_loturi_plicuire') IS NULL THEN RAISE EXCEPTION '20261212a: lipsesc tabelele plicurilor (20261129i)'; END IF;
  IF to_regprocedure('public.fn_red_nivel()') IS NULL THEN RAISE EXCEPTION '20261212a: lipsește fn_red_nivel()'; END IF;
END $pre$;

-- ─── setările FAN (un singur rând) ───
CREATE TABLE public.red_fan_setari (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  limita_lot integer NOT NULL DEFAULT 20 CHECK (limita_lot BETWEEN 1 AND 2000),
  actualizat_de uuid REFERENCES public.profiles(id),
  actualizat_la timestamptz,
  CONSTRAINT red_fan_setari_autor CHECK ((actualizat_de IS NULL) = (actualizat_la IS NULL))
);
INSERT INTO public.red_fan_setari (id) VALUES (true);
COMMENT ON TABLE public.red_fan_setari IS 'Redări FAN Courier: setări (plafonul lotului pilot). Un rând; scris doar prin fn_red_fan_setari_seteaza (owner).';

-- ─── loturile trimise prin FAN: marcajul de TEST ───
CREATE TABLE public.red_fan_loturi (
  lot_id uuid PRIMARY KEY REFERENCES public.red_loturi_plicuire(id),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  test boolean NOT NULL,
  marcat_de uuid NOT NULL REFERENCES public.profiles(id),
  marcat_la timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.red_fan_loturi IS 'Redări FAN Courier: decizia owner-ului „lot de TEST / lot real”, înainte de aprobare; imuabilă după prima aprobare.';

CREATE TABLE public.red_fan_awb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  lot_id uuid NOT NULL REFERENCES public.red_loturi_plicuire(id),
  plic_id uuid NOT NULL REFERENCES public.red_plicuri(id),
  nr_plic text NOT NULL CHECK (nr_plic ~ '^PL-[A-Z]{3}-[0-9]{4}$'),
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat')),
  hash_date text NOT NULL CHECK (hash_date ~ '^[0-9a-f]{64}$'),
  tarif_estimat numeric(12,4) CHECK (tarif_estimat IS NULL OR tarif_estimat >= 0),
  awb text CHECK (awb IS NULL OR awb ~ '^[0-9]{6,20}$'),
  tarif numeric(12,4) CHECK (tarif IS NULL OR tarif >= 0),
  tva numeric(12,4) CHECK (tva IS NULL OR tva >= 0),
  -- o cheie per SOLICITARE către FAN (≤ 100 de rânduri împart aceeași cheie): pusă la claim, înainte de apelul plătit (L04/L22)
  cerere_id uuid,
  motiv text CHECK (motiv IS NULL OR length(motiv) <= 500),
  -- urmărirea (propuneri din răspunsurile FAN; ridicarea / AR-ul / returul le confirmă omul)
  urmarire_stare text NOT NULL DEFAULT 'neurmarit' CHECK (urmarire_stare IN ('neurmarit', 'fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')),
  ultim_eveniment text CHECK (ultim_eveniment IS NULL OR ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$'),
  ultim_eveniment_la timestamptz,
  ridicat_propus date,
  livrat_la timestamptz,
  -- motivul de retur PROPUS (aceleași coduri ca red_plicuri.retur, fără „decedat” / „altul”, care cer judecată umană)
  retur_propus text CHECK (retur_propus IS NULL OR retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta')),
  confirmare_stare text NOT NULL DEFAULT 'nesolicitata' CHECK (confirmare_stare IN ('nesolicitata', 'lipsa', 'primita_de_verificat', 'forma_necunoscuta')),
  urmarit_la timestamptz,
  propus_de uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  aprobat_de uuid REFERENCES public.profiles(id),
  aprobat_la timestamptz,
  generat_la timestamptz,
  ridicat_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_fan_awb_aprobare CHECK (stare IN ('propus', 'eroare', 'anulat') OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)),
  -- Jakarinos r1 P2 (L20): AWB doar în generat / ridicat (sau anulat după ștergerea din FAN); fără AWB în celelalte stări
  CONSTRAINT red_fan_awb_generat CHECK (
    (stare IN ('generat', 'ridicat') AND awb IS NOT NULL AND generat_la IS NOT NULL)
    OR (stare IN ('propus', 'aprobat', 'in_curs', 'eroare', 'necunoscut') AND awb IS NULL)
    OR stare = 'anulat'),
  CONSTRAINT red_fan_awb_ridicat CHECK ((stare = 'ridicat') = (ridicat_la IS NOT NULL) OR stare = 'anulat'),
  CONSTRAINT red_fan_awb_in_curs CHECK (stare NOT IN ('in_curs', 'necunoscut', 'generat', 'ridicat') OR cerere_id IS NOT NULL),
  CONSTRAINT red_fan_awb_urmarire CHECK (awb IS NOT NULL OR (urmarire_stare = 'neurmarit' AND confirmare_stare = 'nesolicitata'
    AND ultim_eveniment IS NULL AND ultim_eveniment_la IS NULL AND ridicat_propus IS NULL AND livrat_la IS NULL AND retur_propus IS NULL AND urmarit_la IS NULL))
);
-- un singur AWB „viu” pe plic (L16); AWB-ul FAN e unic
CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb (plic_id) WHERE stare NOT IN ('eroare', 'anulat');
CREATE UNIQUE INDEX red_fan_awb_awb_uq ON public.red_fan_awb (awb) WHERE awb IS NOT NULL;
CREATE INDEX red_fan_awb_lot_ix ON public.red_fan_awb (lot_id, id);
CREATE INDEX red_fan_awb_cerere_ix ON public.red_fan_awb (cerere_id) WHERE cerere_id IS NOT NULL;
COMMENT ON TABLE public.red_fan_awb IS 'Redări FAN Courier: AWB-uri pe plic, aprobate de owner înainte de cost; fără PII (doar hash-ul datelor trimise). Scrieri doar prin fn_red_fan_*.';

ALTER TABLE public.red_fan_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_loturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_awb ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb TO authenticated;
GRANT ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb TO service_role;
CREATE POLICY red_fan_setari_citire ON public.red_fan_setari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_loturi_citire ON public.red_fan_loturi FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_awb_citire ON public.red_fan_awb FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

CREATE FUNCTION public.fn_red_fan_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE);
$fn$;

-- Sumă de bani din răspunsul FAN: se păstrează exact sau deloc (L18: necunoscut, nu rotunjit în tăcere).
CREATE FUNCTION public.fn_red_fan_suma(p numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN p IS NOT NULL AND p >= 0 AND p < 100000000 AND p = round(p, 4) THEN p END;
$fn$;

-- (0a) Plafonul lotului pilot (DOAR owner).
CREATE FUNCTION public.fn_red_fan_setari_seteaza(p_limita integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul schimba setarile' USING ERRCODE = '42501'; END IF;
  IF p_limita IS NULL OR p_limita < 1 OR p_limita > 2000 THEN RAISE EXCEPTION 'redari fan: plafon invalid (1..2000)' USING ERRCODE = '22023'; END IF;
  UPDATE public.red_fan_setari SET limita_lot = p_limita, actualizat_de = auth.uid(), actualizat_la = now() WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: randul de setari lipseste' USING ERRCODE = 'P0002'; END IF;
  RETURN p_limita;
END $fn$;

-- (0b) Marcajul lotului: TEST sau real (DOAR owner), înainte de prima aprobare; după aceea e imuabil. Lock: lot FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_lot_marcheaza(p_lot_id uuid, p_test boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_lot record; v_vechi record;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul marcheaza lotul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_test IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT id, proiect_id INTO v_lot FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, test INTO v_vechi FROM public.red_fan_loturi WHERE lot_id = p_lot_id;
  IF v_vechi.lot_id IS NOT NULL AND v_vechi.test = p_test THEN RETURN p_test; END IF;   -- repetare = no-op
  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN
    RAISE EXCEPTION 'redari fan: lotul are deja randuri aprobate; marcajul de test nu se mai schimba' USING ERRCODE = 'P0001'; END IF;
  IF v_vechi.lot_id IS NULL THEN
    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, p_test, auth.uid());
  ELSE
    UPDATE public.red_fan_loturi SET test = p_test, marcat_de = auth.uid(), marcat_la = now() WHERE lot_id = p_lot_id;
  END IF;
  RETURN p_test;
END $fn$;

-- (1) Propunere (admin/editor): un rând „propus” pe plic, cu hash-ul datelor și tariful estimat (opțional).
-- Re-propunerea unui rând „aprobat” (datele s-au schimbat după aprobare) îl readuce la „propus” și șterge aprobarea.
-- Lock: lot FOR UPDATE → plic FOR UPDATE → rândul viu al plicului FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_propune(p_plic_id uuid, p_hash text, p_tarif_estimat numeric) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic record; v_rand record; v_id uuid; v_lot uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari fan: fara drept' USING ERRCODE = '42501'; END IF;
  IF p_plic_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR (p_tarif_estimat IS NOT NULL AND public.fn_red_fan_suma(p_tarif_estimat) IS NULL) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  -- Jakarinos r2 P2 (L06): lotul se blochează ÎNAINTE de plic (ca în fn_red_fan_aproba); INSERT-ul ar lua altfel lock FK pe lot după plic
  SELECT lot_id INTO v_lot FROM public.red_plicuri WHERE id = p_plic_id;
  IF v_lot IS NOT NULL THEN PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_lot FOR UPDATE; END IF;
  SELECT id, proiect_id, lot_id, nr_plic, stare, data_expediere, awb INTO v_plic FROM public.red_plicuri WHERE id = p_plic_id FOR UPDATE;
  IF v_plic.id IS NULL THEN RAISE EXCEPTION 'redari fan: plic inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_plic.lot_id IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'redari fan: plicul s-a mutat intre loturi chiar acum; reincercati' USING ERRCODE = '55P03'; END IF;
  IF v_plic.stare <> 'activ' OR v_plic.data_expediere IS NOT NULL OR v_plic.awb IS NOT NULL OR v_plic.lot_id IS NULL THEN
    RAISE EXCEPTION 'redari fan: plicul nu e activ, neexpediat si intr-un lot' USING ERRCODE = 'P0001'; END IF;
  SELECT id, stare INTO v_rand FROM public.red_fan_awb WHERE plic_id = p_plic_id AND stare NOT IN ('eroare', 'anulat') FOR UPDATE;
  IF v_rand.id IS NOT NULL THEN
    IF v_rand.stare NOT IN ('propus', 'aprobat') THEN RAISE EXCEPTION 'redari fan: plicul are deja un AWB % (nu se re-propune)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_fan_awb SET stare = 'propus', hash_date = p_hash, tarif_estimat = p_tarif_estimat, propus_de = auth.uid(),
           aprobat_de = NULL, aprobat_la = NULL, updated_at = now() WHERE id = v_rand.id;
    RETURN v_rand.id;
  END IF;
  INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, tarif_estimat)
    VALUES (v_plic.proiect_id, v_plic.lot_id, p_plic_id, v_plic.nr_plic, p_hash, p_tarif_estimat) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- (2) Aprobare (DOAR owner): lista exactă de rânduri + hash-uri văzute în ecran; orice diferență = refuz (L01/CAS).
-- Cere marcajul lotului (test / real) și respectă plafonul lotului pilot. Lock: lot FOR UPDATE → plicuri ORDER BY id → rânduri ORDER BY id.
CREATE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_deja integer; v_limita integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: lista invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN
    RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul trebuie să fie ÎNCĂ activ, neexpediat și în același lot (hash-ul datelor nu dovedește starea plicului)
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'propus' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'redari fan: % din % randuri s-au schimbat de la previzualizare; reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- lotul pilot: plicurile deja aprobate / trimise din lot + cele de acum ≤ plafon
  SELECT count(*) INTO v_deja FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat');
  SELECT limita_lot INTO v_limita FROM public.red_fan_setari WHERE id;
  IF v_limita IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF v_deja + v_n > v_limita THEN
    RAISE EXCEPTION 'redari fan: lotul ar avea % plicuri aprobate, peste plafonul lotului pilot (%)', v_deja + v_n, v_limita USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = now(), updated_at = now() WHERE id = ANY(p_ids);
  RETURN v_n;
END $fn$;

-- (3) Claim înainte de UN apel plătit (DOAR owner, din funcția edge cu JWT-ul lui): ≤ 100 de rânduri aprobate → in_curs, O cheie nouă
-- pe solicitare (L04/L22). p_hashuri = hash-urile recalculate din datele CURENTE; diferite de cele aprobate → refuz total.
-- Un plic cu AWB (aici sau pe plic) nu ajunge aici: doar „aprobat” se rezervă, iar un singur rând viu pe plic (index unic).
-- Lock: lot FOR UPDATE → plicuri ORDER BY id FOR UPDATE → rânduri ORDER BY id FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cerere uuid := gen_random_uuid(); v_n integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul genereaza' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 100 OR cardinality(p_ids) <> cardinality(p_hashuri)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: solicitare invalida (1..100 randuri distincte, cu hash)' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul anulat / expediat manual / mutat din lot după aprobare → nu se mai plătește un AWB
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: % din % randuri nu mai sunt aprobate cu aceleasi date (plic schimbat, anulat sau deja trimis)', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'in_curs', cerere_id = v_cerere, motiv = NULL, updated_at = now() WHERE id = ANY(p_ids);
  RETURN v_cerere;
END $fn$;

-- (4) Rezultatele UNEI solicitări (DOAR owner), toate odată (L02): exact rândurile „in_curs” ale cheii, fiecare generat / eroare / necunoscut.
-- CAS pe cheie + stare: un rezultat vechi sau străin = refuz, nimic scris. 'necunoscut' NU se reîncearcă automat (L05): reconciliere.
-- Lock: rânduri ORDER BY id FOR UPDATE (subșir al ordinii L06).
CREATE FUNCTION public.fn_red_fan_rezultate(p_cerere uuid, p_rezultate jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Fără tabele temporare: într-o funcție DEFINER un tabel pg_temp cu același nume, creat dinainte de apelant, ar fi folosit în locul lui.
DECLARE v_asteptate integer; v_n integer; v_bune integer; v_dist integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_cerere IS NULL OR p_rezultate IS NULL OR jsonb_typeof(p_rezultate) <> 'array' OR jsonb_array_length(p_rezultate) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: rezultate invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_id = p_cerere ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_asteptate FROM public.red_fan_awb WHERE cerere_id = p_cerere AND stare = 'in_curs';
  SELECT count(*), count(*) FILTER (WHERE r.id IS NOT NULL AND r.stare IN ('generat', 'eroare', 'necunoscut')
           AND ((r.stare = 'generat' AND r.awb ~ '^[0-9]{6,20}$') OR (r.stare <> 'generat' AND r.awb IS NULL))
           AND (r.tarif IS NULL OR r.tarif >= 0) AND (r.tva IS NULL OR r.tva >= 0)), count(DISTINCT r.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: rezultat invalid' USING ERRCODE = '22023'; END IF;
  IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rezultate) AS r(id uuid)
       LEFT JOIN public.red_fan_awb a ON a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs' WHERE a.id IS NULL) THEN
    RAISE EXCEPTION 'redari fan: rezultat vechi, partial sau cheie straina (CAS)' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET stare = r.stare, awb = r.awb, tarif = public.fn_red_fan_suma(r.tarif), tva = public.fn_red_fan_suma(r.tva), motiv = left(r.motiv, 500),
         generat_la = CASE WHEN r.stare = 'generat' THEN now() END, updated_at = now()
    FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text)
   WHERE a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)' USING ERRCODE = 'P0001'; END IF;
  RETURN v_n;
END $fn$;

-- (5) Reconciliere (DOAR owner) — Jakarinos r1 P1 (L05): un claim al cărui rezultat nu s-a confirmat (in_curs rămas după pierderea
-- răspunsului, sau „necunoscut”) se închide DOAR după ce omul a verificat borderoul zilei în FAN (GET /reports/awb, după nr_plic):
-- p_awb găsit → generat; p_awb NULL + motivul verificării = „confirmat că nu există în FAN” → eroare (se poate re-propune).
-- Fără retry automat al generării. in_curs se reconciliază doar după 10 minute (să nu concureze cu o generare în desfășurare).
CREATE FUNCTION public.fn_red_fan_reconciliaza(p_id uuid, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rand record; v_stare text;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR (p_awb IS NOT NULL AND p_awb !~ '^[0-9]{6,20}$') OR (p_awb IS NULL AND coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'redari fan: reconciliere invalida (AWB valid sau motivul verificarii)' USING ERRCODE = '22023'; END IF;
  SELECT id, stare, updated_at INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF v_rand.id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT (v_rand.stare = 'necunoscut' OR (v_rand.stare = 'in_curs' AND v_rand.updated_at < now() - interval '10 minutes')) THEN
    RAISE EXCEPTION 'redari fan: doar randurile necunoscute (sau in curs de peste 10 minute) se reconciliaza' USING ERRCODE = 'P0001'; END IF;
  v_stare := CASE WHEN p_awb IS NOT NULL THEN 'generat' ELSE 'eroare' END;
  UPDATE public.red_fan_awb SET stare = v_stare, awb = p_awb, tarif = public.fn_red_fan_suma(p_tarif), tva = public.fn_red_fan_suma(p_tva), motiv = left(p_motiv, 500),
         generat_la = CASE WHEN p_awb IS NOT NULL THEN now() END, updated_at = now()
   WHERE id = p_id;
  RETURN v_stare;
END $fn$;

-- (6) Ridicarea de către curier (eveniment FAN C0, CONFIRMAT de om), DOAR owner, atomic (L02): rândul FAN → ridicat ȘI, pentru un lot
-- REAL, plicul → awb + data_expediere (trigger-ele existente ale plicului propagă expedierea pe convocări). Un lot de TEST nu scrie pe plic.
-- p_data = data C0 în București, nu înainte de generare. Repetarea pe același AWB = no-op. Ordinea L06: plic FOR UPDATE → rând FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_ridicat(p_id uuid, p_data date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_pl record; v_rand record; v_test boolean;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_data IS NULL OR p_data > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: data ridicarii invalida' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT id, stare, awb, data_expediere INTO v_pl FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, ridicat_la, generat_la, lot_id INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  SELECT test INTO v_test FROM public.red_fan_loturi WHERE lot_id = v_rand.lot_id;
  IF v_test IS NULL THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF v_rand.stare = 'ridicat' AND (v_test OR v_pl.awb IS NOT DISTINCT FROM v_rand.awb) THEN RETURN; END IF;   -- C0 repetat
  IF v_rand.stare <> 'generat' THEN RAISE EXCEPTION 'redari fan: doar un AWB generat poate fi ridicat (stare %)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
  IF p_data < (v_rand.generat_la AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: ridicarea nu poate fi inainte de generarea AWB-ului' USING ERRCODE = '22023'; END IF;
  IF NOT v_test THEN
    IF v_pl.stare <> 'activ' OR v_pl.data_expediere IS NOT NULL OR v_pl.awb IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: plicul e anulat sau are deja o expediere inregistrata; verificare manuala' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_plicuri SET awb = v_rand.awb, data_expediere = p_data WHERE id = v_plic_id;
  END IF;
  UPDATE public.red_fan_awb SET stare = 'ridicat', ridicat_la = (p_data::timestamp AT TIME ZONE 'Europe/Bucharest'), updated_at = now() WHERE id = p_id;
END $fn$;

-- (7) Urmărirea (DOAR owner, din funcția edge): ≤ 100 de rânduri ale lotului, fiecare cu AWB-ul lui; scrie DOAR câmpurile de urmărire
-- (propuneri). Orice rând străin / AWB diferit / valoare în afara listei = refuz total. Datele locale vin ca text „AAAA-LL-ZZ HH:MM:SS”
-- (ora României, L17) și se convertesc aici. Lock: rânduri ORDER BY id FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE u.id IS NOT NULL AND u.awb ~ '^[0-9]{6,20}$'
           AND u.urmarire_stare IN ('fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')
           AND (u.ultim_eveniment IS NULL OR u.ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$')
           AND (u.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.livrat_la IS NULL OR u.livrat_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.ridicat_propus IS NULL OR u.ridicat_propus ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           AND (u.retur_propus IS NULL OR u.retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta'))), count(DISTINCT u.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT u.id FROM jsonb_to_recordset(p_randuri) AS u(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = u.id AND a.lot_id = p_lot_id AND a.awb = u.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET urmarire_stare = u.urmarire_stare, ultim_eveniment = u.ultim_eveniment,
         ultim_eveniment_la = (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest'), ridicat_propus = u.ridicat_propus::date,
         livrat_la = (u.livrat_la::timestamp AT TIME ZONE 'Europe/Bucharest'), retur_propus = u.retur_propus, urmarit_la = now(), updated_at = now()
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text)
   WHERE a.id = u.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

-- (8) Confirmările de livrare (DOAR owner): doar starea (lipsă / primită — de verificat de om / formă necunoscută); răspunsul FAN nu se păstrează.
CREATE FUNCTION public.fn_red_fan_confirmari(p_lot_id uuid, p_randuri jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE c.id IS NOT NULL AND c.awb ~ '^[0-9]{6,20}$' AND c.confirmare_stare IN ('lipsa', 'primita_de_verificat', 'forma_necunoscuta')), count(DISTINCT c.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, confirmare_stare text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT c.id FROM jsonb_to_recordset(p_randuri) AS c(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = c.id AND a.lot_id = p_lot_id AND a.awb = c.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET confirmare_stare = c.confirmare_stare, urmarit_la = now(), updated_at = now()
    FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, confirmare_stare text) WHERE a.id = c.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

-- (9) Anularea unui AWB neridicat (DOAR owner): după DELETE /awb confirmat de FAN sau verificarea omului în selfAWB. Lock: plic → rând.
CREATE FUNCTION public.fn_red_fan_anulat(p_id uuid, p_awb text, p_motiv text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$' OR coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'redari fan: anulare invalida (AWB + motiv)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  UPDATE public.red_fan_awb SET stare = 'anulat', motiv = left(p_motiv, 500), updated_at = now() WHERE id = p_id AND stare = 'generat' AND awb = p_awb;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: doar un AWB generat, neridicat, se anuleaza (CAS)' USING ERRCODE = 'P0001'; END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_red_fan_e_owner(), public.fn_red_fan_suma(numeric), public.fn_red_fan_setari_seteaza(integer), public.fn_red_fan_lot_marcheaza(uuid, boolean),
  public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]), public.fn_red_fan_claim_lot(uuid, uuid[], text[]),
  public.fn_red_fan_rezultate(uuid, jsonb), public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text), public.fn_red_fan_ridicat(uuid, date),
  public.fn_red_fan_urmarire(uuid, jsonb), public.fn_red_fan_confirmari(uuid, jsonb), public.fn_red_fan_anulat(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_setari_seteaza(integer), public.fn_red_fan_lot_marcheaza(uuid, boolean),
  public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]), public.fn_red_fan_claim_lot(uuid, uuid[], text[]),
  public.fn_red_fan_rezultate(uuid, jsonb), public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text), public.fn_red_fan_ridicat(uuid, date),
  public.fn_red_fan_urmarire(uuid, jsonb), public.fn_red_fan_confirmari(uuid, jsonb), public.fn_red_fan_anulat(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_red_fan_e_owner(), public.fn_red_fan_suma(numeric) FROM authenticated;

-- postcondiții
DO $post$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['public.red_fan_awb', 'public.red_fan_loturi', 'public.red_fan_setari'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN RAISE EXCEPTION '20261212a: RLS inactiv pe %', t; END IF;
    IF has_table_privilege('authenticated', t, 'INSERT') OR has_table_privilege('authenticated', t, 'UPDATE')
       OR has_table_privilege('authenticated', t, 'DELETE') OR has_table_privilege('authenticated', t, 'TRUNCATE') THEN RAISE EXCEPTION '20261212a: authenticated are drept de scriere directă pe %', t; END IF;
    IF has_table_privilege('anon', t, 'SELECT') THEN RAISE EXCEPTION '20261212a: anon citește %', t; END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.fn_red_fan_aproba(uuid, uuid[], text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_fan_claim_lot(uuid, uuid[], text[])', 'EXECUTE') THEN RAISE EXCEPTION '20261212a: anon poate aproba / genera'; END IF;
  IF (SELECT count(*) FROM public.red_fan_setari) <> 1 OR (SELECT limita_lot FROM public.red_fan_setari) <> 20 THEN RAISE EXCEPTION '20261212a: setarile implicite lipsesc'; END IF;
END $post$;

COMMIT;
