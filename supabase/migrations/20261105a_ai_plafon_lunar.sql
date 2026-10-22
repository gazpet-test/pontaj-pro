-- Registru generic de cost AI. Luna contabilă = UTC; rezervarea se face înaintea apelului plătit.
-- Fără modificări ale datelor existente. Funcțiile sunt exclusiv pentru edge/service_role.
BEGIN;
CREATE TABLE public.ai_plafon_lunar (
  cheie text NOT NULL CHECK (length(btrim(cheie)) BETWEEN 1 AND 200),
  luna date NOT NULL CHECK (extract(day FROM luna) = 1),
  plafon_usd numeric(10,4) NOT NULL DEFAULT 10 CHECK (plafon_usd >= 0 AND plafon_usd < 'Infinity'::numeric),
  rezervat_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (rezervat_usd >= 0 AND rezervat_usd < 'Infinity'::numeric),
  consumat_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (consumat_usd >= 0 AND consumat_usd < 'Infinity'::numeric),
  PRIMARY KEY (cheie, luna)
);
CREATE TABLE public.ai_plafon_rezervari (
  id bigserial PRIMARY KEY,
  cheie text NOT NULL,
  luna date NOT NULL,
  suma_rezervata numeric(12,6) NOT NULL CHECK (suma_rezervata > 0 AND suma_rezervata < 'Infinity'::numeric),
  cost_real numeric(12,6) CHECK (cost_real >= 0 AND cost_real < 'Infinity'::numeric),
  stare text NOT NULL DEFAULT 'rezervat' CHECK (stare IN ('rezervat','decontat','pastrat')),
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  decontat_la timestamptz,
  FOREIGN KEY (cheie, luna) REFERENCES public.ai_plafon_lunar(cheie, luna),
  CHECK ((stare = 'rezervat') = (decontat_la IS NULL)),
  CHECK ((stare = 'decontat') = (cost_real IS NOT NULL))
);
ALTER TABLE public.ai_plafon_lunar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_plafon_rezervari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_plafon_lunar, public.ai_plafon_rezervari FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ai_plafon_rezervari_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_plafon_lunar, public.ai_plafon_rezervari TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_plafon_rezervari_id_seq TO service_role;
-- Helper owner existent, fără dependență nouă pe RLS profiles. Dacă lipsește, UI nu primește SELECT.
DO $politici$
BEGIN
  IF to_regprocedure('public.egress_este_owner()') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY ai_plafon_lunar_owner ON public.ai_plafon_lunar FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.egress_este_owner())';
    EXECUTE 'CREATE POLICY ai_plafon_rezervari_owner ON public.ai_plafon_rezervari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.egress_este_owner())';
    GRANT SELECT ON public.ai_plafon_lunar, public.ai_plafon_rezervari TO authenticated;
  END IF;
END $politici$;

CREATE OR REPLACE FUNCTION public.fn_ai_plafon_rezerva(p_cheie text, p_suma numeric, p_plafon_implicit numeric, p_user uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_luna date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v public.ai_plafon_lunar%ROWTYPE;
  v_suma numeric;
  v_id bigint;
BEGIN
  IF p_cheie IS NULL OR length(btrim(p_cheie)) NOT BETWEEN 1 AND 200 OR p_user IS NULL
     OR p_suma IS NULL OR NOT (p_suma > 0 AND p_suma < 'Infinity'::numeric)
     OR p_plafon_implicit IS NULL OR NOT (p_plafon_implicit >= 0 AND p_plafon_implicit < 'Infinity'::numeric) THEN
    RAISE EXCEPTION 'plafon_argument_invalid' USING ERRCODE = '22023';
  END IF;
  v_suma := ceil(p_suma * 1000000) / 1000000; -- niciodată rotunjire în jos la rezervare
  INSERT INTO public.ai_plafon_lunar(cheie, luna, plafon_usd)
    VALUES (p_cheie, v_luna, p_plafon_implicit) ON CONFLICT (cheie, luna) DO NOTHING;
  SELECT * INTO STRICT v FROM public.ai_plafon_lunar WHERE cheie = p_cheie AND luna = v_luna FOR UPDATE;
  IF v.consumat_usd + v.rezervat_usd + v_suma > v.plafon_usd THEN
    RAISE EXCEPTION 'plafon_depasit' USING ERRCODE = 'P0001',
      DETAIL = row_to_json(v)::text; -- soldul/luna exactă de sub lock, inclusiv la schimbarea lunii
  END IF;
  UPDATE public.ai_plafon_lunar SET rezervat_usd = rezervat_usd + v_suma WHERE cheie = p_cheie AND luna = v_luna;
  INSERT INTO public.ai_plafon_rezervari(cheie, luna, suma_rezervata, creat_de)
    VALUES (p_cheie, v_luna, v_suma, p_user) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE OR REPLACE FUNCTION public.fn_ai_plafon_deconteaza(p_id bigint, p_cost_real numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  r public.ai_plafon_rezervari%ROWTYPE;
  v_cost numeric;
BEGIN
  SELECT * INTO r FROM public.ai_plafon_rezervari WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rezervare_inexistenta' USING ERRCODE = '22023'; END IF;
  IF r.stare <> 'rezervat' THEN RETURN; END IF; -- inclusiv două decontări concurente
  IF p_cost_real IS NOT NULL AND NOT (p_cost_real >= 0 AND p_cost_real < 'Infinity'::numeric) THEN
    RAISE EXCEPTION 'cost_real_invalid' USING ERRCODE = '22023';
  END IF;
  v_cost := CASE WHEN p_cost_real IS NULL THEN r.suma_rezervata ELSE ceil(p_cost_real * 1000000) / 1000000 END;
  -- Luna rezervării, nu luna decontării: corect și la trecerea dintre luni.
  PERFORM 1 FROM public.ai_plafon_lunar WHERE cheie = r.cheie AND luna = r.luna FOR UPDATE;
  UPDATE public.ai_plafon_lunar SET rezervat_usd = rezervat_usd - r.suma_rezervata, consumat_usd = consumat_usd + v_cost
    WHERE cheie = r.cheie AND luna = r.luna;
  UPDATE public.ai_plafon_rezervari SET cost_real = CASE WHEN p_cost_real IS NULL THEN NULL ELSE v_cost END,
    stare = CASE WHEN p_cost_real IS NULL THEN 'pastrat' ELSE 'decontat' END, decontat_la = now() WHERE id = p_id;
END $f$;
REVOKE EXECUTE ON FUNCTION public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid), public.fn_ai_plafon_deconteaza(bigint,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid), public.fn_ai_plafon_deconteaza(bigint,numeric) TO service_role;
COMMIT;
