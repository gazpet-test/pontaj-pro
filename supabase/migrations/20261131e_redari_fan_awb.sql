-- 20261131e_redari_fan_awb.sql — FAN Courier: AWB-urile plicurilor Redări, cu aprobarea owner-ului înainte de orice cost.
-- STARE: NEAPLICATĂ și NETESTATĂ pe BD (scrisă de redari@ 06.11.2026, fără acces la BD). Înainte de apply: DRY pe clona schemei,
-- review Jakarinos + Fable, „da”-ul lui Răzvan, aplicare de către chat. Revenire: supabase/revenire/20261131e_redari_fan_awb_ROLLBACK.sql.
-- Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3–§5.
--
-- De ce tabel separat: red_plicuri.awb + data_expediere sunt legate prin CHECK și marchează „expediat” pe convocări (termenul de
-- 10 zile). Un AWB generat dar neridicat de curier nu e expediere → stă aici până la evenimentul FAN C0.
-- Minimizare: tabelul NU păstrează numele / telefonul / adresa trimise la FAN, doar hash-ul lor (sha256 pe JSON canonic,
-- supabase/functions/_shared/redariFan.mjs::hashPlicFan); funcția edge recalculează datele și compară hash-ul aprobat.
--
-- Ordinea lock-urilor pe toate căile (L06): red_loturi_plicuire FOR UPDATE → red_plicuri FOR UPDATE → red_fan_awb ORDER BY id FOR UPDATE.
-- Identitatea = auth.uid() (L08); niciun parametru de utilizator. Scrierile DOAR prin RPC-urile de mai jos (fără GRANT INSERT/UPDATE/DELETE).

BEGIN;

DO $pre$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NOT NULL THEN RAISE EXCEPTION '20261131e: red_fan_awb există deja'; END IF;
  IF to_regclass('public.red_plicuri') IS NULL OR to_regclass('public.red_loturi_plicuire') IS NULL THEN RAISE EXCEPTION '20261131e: lipsesc tabelele plicurilor (20261129i)'; END IF;
  IF to_regprocedure('public.fn_red_nivel()') IS NULL THEN RAISE EXCEPTION '20261131e: lipsește fn_red_nivel()'; END IF;
END $pre$;

CREATE TABLE public.red_fan_awb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  lot_id uuid NOT NULL REFERENCES public.red_loturi_plicuire(id),
  plic_id uuid NOT NULL REFERENCES public.red_plicuri(id),
  nr_plic text NOT NULL CHECK (nr_plic ~ '^PL-[A-Z]{3}-[0-9]{4}$'),
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat')),
  hash_date text NOT NULL CHECK (hash_date ~ '^[0-9a-f]{64}$'),
  tarif_estimat numeric(10,2) CHECK (tarif_estimat IS NULL OR tarif_estimat >= 0),
  awb text CHECK (awb IS NULL OR awb ~ '^[0-9]{6,20}$'),
  tarif numeric(10,2) CHECK (tarif IS NULL OR tarif >= 0),
  tva numeric(10,2) CHECK (tva IS NULL OR tva >= 0),
  cheie_idempotenta uuid UNIQUE,
  eticheta_path text CHECK (eticheta_path IS NULL OR length(eticheta_path) <= 500),
  motiv text CHECK (motiv IS NULL OR length(motiv) <= 500),
  propus_de uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  aprobat_de uuid REFERENCES public.profiles(id),
  aprobat_la timestamptz,
  generat_la timestamptz,
  ridicat_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_fan_awb_aprobare CHECK ((stare IN ('propus')) OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL) OR stare IN ('eroare', 'anulat')),
  CONSTRAINT red_fan_awb_generat CHECK ((stare IN ('generat', 'ridicat')) = (awb IS NOT NULL AND generat_la IS NOT NULL) OR stare = 'anulat'),
  CONSTRAINT red_fan_awb_in_curs CHECK (stare <> 'in_curs' OR cheie_idempotenta IS NOT NULL)
);
-- un singur AWB „viu” pe plic (L16); AWB-ul FAN e unic
CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb (plic_id) WHERE stare NOT IN ('eroare', 'anulat');
CREATE UNIQUE INDEX red_fan_awb_awb_uq ON public.red_fan_awb (awb) WHERE awb IS NOT NULL;
CREATE INDEX red_fan_awb_lot_ix ON public.red_fan_awb (lot_id, id);
COMMENT ON TABLE public.red_fan_awb IS 'Redări FAN Courier: AWB-uri pe plic, aprobate de owner înainte de cost; fără PII (doar hash-ul datelor trimise). Scrieri doar prin fn_red_fan_*.';

ALTER TABLE public.red_fan_awb ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_awb FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.red_fan_awb TO authenticated;
GRANT ALL ON public.red_fan_awb TO service_role;
CREATE POLICY red_fan_awb_citire ON public.red_fan_awb FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

CREATE FUNCTION public.fn_red_fan_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE);
$fn$;

-- (1) Propunere (admin/editor): un rând „propus” pe plic, cu hash-ul datelor și tariful estimat (GET internal-tariff, gratuit).
-- Lock: plic FOR UPDATE → rândul viu al plicului FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_propune(p_plic_id uuid, p_hash text, p_tarif_estimat numeric) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic record; v_rand record; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari fan: fara drept' USING ERRCODE = '42501'; END IF;
  IF p_plic_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR (p_tarif_estimat IS NOT NULL AND p_tarif_estimat < 0) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT id, proiect_id, lot_id, nr_plic, stare, data_expediere INTO v_plic FROM public.red_plicuri WHERE id = p_plic_id FOR UPDATE;
  IF v_plic.id IS NULL THEN RAISE EXCEPTION 'redari fan: plic inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_plic.stare <> 'activ' OR v_plic.data_expediere IS NOT NULL OR v_plic.lot_id IS NULL THEN
    RAISE EXCEPTION 'redari fan: plicul nu e activ, neexpediat si intr-un lot' USING ERRCODE = 'P0001'; END IF;
  SELECT id, stare INTO v_rand FROM public.red_fan_awb WHERE plic_id = p_plic_id AND stare NOT IN ('eroare', 'anulat') FOR UPDATE;
  IF v_rand.id IS NOT NULL THEN
    IF v_rand.stare <> 'propus' THEN RAISE EXCEPTION 'redari fan: plicul are deja un AWB % (nu se re-propune)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_fan_awb SET hash_date = p_hash, tarif_estimat = p_tarif_estimat, propus_de = auth.uid(), updated_at = now() WHERE id = v_rand.id;
    RETURN v_rand.id;
  END IF;
  INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, tarif_estimat)
    VALUES (v_plic.proiect_id, v_plic.lot_id, p_plic_id, v_plic.nr_plic, p_hash, p_tarif_estimat) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- (2) Aprobare (DOAR owner): lista exactă de rânduri + hash-uri văzute în ecran; orice diferență = refuz (L01/CAS).
-- Lock: lot FOR UPDATE → rândurile ORDER BY id FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) > 500
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: lista invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
   WHERE a.lot_id = p_lot_id AND a.stare = 'propus' AND a.hash_date = t.h;
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'redari fan: % din % randuri s-au schimbat de la previzualizare; reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = now(), updated_at = now() WHERE id = ANY(p_ids);
  RETURN v_n;
END $fn$;

-- (3) Claim înainte de apelul plătit (DOAR owner, din funcția edge cu JWT-ul lui): aprobat → in_curs + cheie nouă (L04/L22).
-- p_hash = hash-ul recalculat din datele CURENTE; diferit de cel aprobat → refuz (datele s-au schimbat după aprobare).
CREATE FUNCTION public.fn_red_fan_claim(p_id uuid, p_hash text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cheie uuid := gen_random_uuid(); v_rand record;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul genereaza' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_hash IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT a.id, a.stare, a.hash_date, a.plic_id INTO v_rand FROM public.red_fan_awb a WHERE a.id = p_id FOR UPDATE;
  IF v_rand.id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_rand.stare <> 'aprobat' THEN RAISE EXCEPTION 'redari fan: randul nu e aprobat (stare %)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
  IF v_rand.hash_date <> p_hash THEN RAISE EXCEPTION 'redari fan: datele plicului s-au schimbat dupa aprobare' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'in_curs', cheie_idempotenta = v_cheie, updated_at = now() WHERE id = p_id;
  RETURN v_cheie;
END $fn$;

-- (4) Rezultatul apelului FAN (DOAR owner, CAS pe cheie). 'necunoscut' NU se reîncearcă automat (L05): reconciliere manuală.
CREATE FUNCTION public.fn_red_fan_rezultat(p_id uuid, p_cheie uuid, p_stare text, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_cheie IS NULL OR p_stare IS NULL OR p_stare NOT IN ('generat', 'eroare', 'necunoscut')
     OR (p_stare = 'generat' AND (p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$')) OR (p_stare <> 'generat' AND p_awb IS NOT NULL) THEN
    RAISE EXCEPTION 'redari fan: rezultat invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.red_fan_awb SET stare = p_stare, awb = p_awb, tarif = p_tarif, tva = p_tva, motiv = left(p_motiv, 500),
         generat_la = CASE WHEN p_stare = 'generat' THEN now() END, updated_at = now()
   WHERE id = p_id AND stare = 'in_curs' AND cheie_idempotenta = p_cheie;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: rezultat vechi sau cheie straina (CAS)' USING ERRCODE = 'P0001'; END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_red_fan_e_owner(), public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]),
  public.fn_red_fan_claim(uuid, text), public.fn_red_fan_rezultat(uuid, uuid, text, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]),
  public.fn_red_fan_claim(uuid, text), public.fn_red_fan_rezultat(uuid, uuid, text, text, numeric, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_red_fan_e_owner() FROM authenticated;

-- postcondiții
DO $post$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_fan_awb'::regclass) THEN RAISE EXCEPTION '20261131e: RLS inactiv'; END IF;
  IF has_table_privilege('authenticated', 'public.red_fan_awb', 'INSERT') OR has_table_privilege('authenticated', 'public.red_fan_awb', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.red_fan_awb', 'DELETE') THEN RAISE EXCEPTION '20261131e: authenticated are drept de scriere directă'; END IF;
  IF has_function_privilege('anon', 'public.fn_red_fan_aproba(uuid, uuid[], text[])', 'EXECUTE') THEN RAISE EXCEPTION '20261131e: anon poate aproba'; END IF;
END $post$;

COMMIT;
