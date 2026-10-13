-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261027a — „Raport lucrări executate" pentru distribuție gaze în raportul zilnic mobil (cerere Răzvan 13.10.2026) — r2 după Copilot
-- r2: salvarea rândurilor prin fn_raport_distributie_salveaza (DELETE + INSERT în aceeași tranzacție, SECURITY INVOKER);
--     trigger care refuză un tronson (proiect_unitati) din alt proiect decât al raportului.
-- Obiecte:
--   * executie_proiecte.raport_distributie boolean NOT NULL DEFAULT false — marchează proiectele de distribuție gaze;
--     doar pe ele apare secțiunea în raportul zilnic (/m). Toate proiectele existente rămân false (nimic nu se schimbă).
--   * rapoarte_zilnice.distributie_antet text — linia de sub titlu (localitate/stradă), editabilă.
--   * tabel NOU public.raport_distributie_linii — rândurile celor două tabele (conducte / branșamente), legate de
--     rapoarte_zilnice (deci de site, proiect și dată). ON DELETE CASCADE cu raportul.
--     RLS: aceleași reguli ca raport_lucrari (utilizator autentificat), conform CLAUDE.md pct. 4; anon fără drepturi.
-- Nu atinge date existente (doar ADD COLUMN cu default + tabel nou gol).
-- Revenire: supabase/revenire/20261027a_raport_distributie_gaze_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261027a_raport_distributie_gaze:' || txid_current() THEN
    RAISE EXCEPTION '20261027a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261027a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.raport_distributie_linii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'raport_distributie')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice' AND column_name = 'distributie_antet') THEN
    RAISE EXCEPTION '20261027a: obiectele exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice' AND column_name = 'id' AND data_type = 'bigint')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proiect_unitati' AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION '20261027a: rapoarte_zilnice.id / proiect_unitati.id (bigint) lipsesc';
  END IF;
END $pre$;

ALTER TABLE public.executie_proiecte ADD COLUMN raport_distributie boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.executie_proiecte.raport_distributie IS 'Proiect de distribuție gaze: raportul zilnic (/m) arată secțiunea „Raport lucrări executate” (conducte + branșamente).';

ALTER TABLE public.rapoarte_zilnice ADD COLUMN distributie_antet text CHECK (distributie_antet IS NULL OR length(distributie_antet) <= 200);
COMMENT ON COLUMN public.rapoarte_zilnice.distributie_antet IS 'Linia de sub titlul „Raport lucrări executate”: localitate / stradă (distribuție gaze).';

CREATE TABLE public.raport_distributie_linii (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raport_id    bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE,
  tabel        text NOT NULL CHECK (tabel IN ('conducta', 'bransament')),
  nr_crt       integer NOT NULL CHECK (nr_crt BETWEEN 1 AND 500),
  tronson      text CHECK (tronson IS NULL OR length(tronson) <= 120),
  unitate_id   bigint REFERENCES public.proiect_unitati(id) ON DELETE SET NULL,
  descriere    text CHECK (descriere IS NULL OR length(descriere) <= 120),
  diametru_mm  integer CHECK (diametru_mm IS NULL OR diametru_mm IN (20, 25, 32, 40, 50, 63, 90, 110, 125, 160, 200, 225, 250, 315)),
  lungime_m    numeric(10,2) CHECK (lungime_m IS NULL OR (lungime_m > 0 AND lungime_m <= 100000)),
  suduri_nr    integer CHECK (suduri_nr IS NULL OR suduri_nr >= 0),
  sudura_tip   text CHECK (sudura_tip IS NULL OR sudura_tip IN ('electrofuziune', 'cap_la_cap', 'altul')),
  se1          text CHECK (se1 IS NULL OR length(se1) <= 40),
  se2          text CHECK (se2 IS NULL OR length(se2) <= 40),
  se3          text CHECK (se3 IS NULL OR length(se3) <= 40),
  observatii   text CHECK (observatii IS NULL OR length(observatii) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raport_id, tabel, nr_crt),
  -- sudurile pe 3 coloane sunt doar la branșamente; numărul + tipul de sudură doar la conducte
  CHECK (tabel = 'bransament' OR (se1 IS NULL AND se2 IS NULL AND se3 IS NULL)),
  CHECK (tabel = 'conducta' OR (suduri_nr IS NULL AND sudura_tip IS NULL))
);
COMMENT ON TABLE public.raport_distributie_linii IS 'Raport lucrări executate — distribuție gaze (13.10.2026): rânduri conducte / branșamente pe raportul zilnic.';
CREATE INDEX raport_distributie_linii_raport_idx ON public.raport_distributie_linii (raport_id);
ALTER TABLE public.raport_distributie_linii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raport_distributie_linii FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raport_distributie_linii TO authenticated, service_role;
CREATE POLICY raport_distributie_linii_sel ON public.raport_distributie_linii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY raport_distributie_linii_ins ON public.raport_distributie_linii FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY raport_distributie_linii_upd ON public.raport_distributie_linii FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY raport_distributie_linii_del ON public.raport_distributie_linii FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
DO $seq$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon', pg_get_serial_sequence('public.raport_distributie_linii', 'id'));
END $seq$;

-- r2 (Copilot P1-2): tronsonul ales din listă trebuie să fie al proiectului raportului (raport → site → proiect).
-- Funcție de trigger SECURITY DEFINER doar ca să citească legătura indiferent de RLS; nu e apelabilă direct.
CREATE FUNCTION public.fn_raport_distributie_unitate_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF NEW.unitate_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.rapoarte_zilnice r
         JOIN public.sites s ON s.id = r.site_id
         JOIN public.proiect_unitati u ON u.proiect_id = s.proiect_id
        WHERE r.id = NEW.raport_id AND u.id = NEW.unitate_id) THEN
    RAISE EXCEPTION 'raport_distributie_linii: unitatea % nu aparține proiectului raportului', NEW.unitate_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_distributie_unitate_check() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER raport_distributie_linii_unitate_check
  BEFORE INSERT OR UPDATE OF raport_id, unitate_id ON public.raport_distributie_linii
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_distributie_unitate_check();

-- r2 (Copilot P1-1): înlocuirea rândurilor unui raport într-o SINGURĂ tranzacție (DELETE + INSERT atomice).
-- SECURITY INVOKER: rulează cu drepturile și RLS-ul utilizatorului (nu ocolește nimic); doar authenticated.
CREATE FUNCTION public.fn_raport_distributie_salveaza(p_raport_id bigint, p_linii jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $f$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'fn_raport_distributie_salveaza: neautentificat'; END IF;
  IF p_raport_id IS NULL OR jsonb_typeof(p_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linii) > 500 THEN
    RAISE EXCEPTION 'fn_raport_distributie_salveaza: argumente invalide';
  END IF;
  -- Copilot P2-1: blocăm rândul raportului → două salvări simultane se serializează (ultima câștigă, fără conflict UNIQUE)
  PERFORM 1 FROM public.rapoarte_zilnice WHERE id = p_raport_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_raport_distributie_salveaza: raportul % nu există', p_raport_id;
  END IF;
  DELETE FROM public.raport_distributie_linii WHERE raport_id = p_raport_id;
  INSERT INTO public.raport_distributie_linii
    (raport_id, tabel, nr_crt, tronson, unitate_id, descriere, diametru_mm, lungime_m, suduri_nr, sudura_tip, se1, se2, se3, observatii)
  SELECT p_raport_id, x.tabel, x.nr_crt, x.tronson, x.unitate_id, x.descriere, x.diametru_mm, x.lungime_m,
         x.suduri_nr, x.sudura_tip, x.se1, x.se2, x.se3, x.observatii
    FROM jsonb_to_recordset(p_linii) AS x(tabel text, nr_crt integer, tronson text, unitate_id bigint, descriere text,
         diametru_mm integer, lungime_m numeric, suduri_nr integer, sudura_tip text, se1 text, se2 text, se3 text, observatii text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_distributie_salveaza(bigint, jsonb) FROM PUBLIC, anon;
-- doar authenticated: funcția cere auth.uid(), deci service_role fără claims n-ar avea ce face (Copilot P2-2)
GRANT EXECUTE ON FUNCTION public.fn_raport_distributie_salveaza(bigint, jsonb) TO authenticated;

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.raport_distributie_linii'::regclass)
     OR has_table_privilege('anon', 'public.raport_distributie_linii', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.raport_distributie_linii', 'INSERT')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raport_distributie_linii') <> 4
     OR has_function_privilege('anon', 'public.fn_raport_distributie_salveaza(bigint,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_raport_distributie_salveaza(bigint,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_raport_distributie_unitate_check()', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'raport_distributie_linii_unitate_check')
     OR EXISTS (SELECT 1 FROM public.executie_proiecte WHERE raport_distributie)
     OR EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE distributie_antet IS NOT NULL) THEN
    RAISE EXCEPTION '20261027a: postconditie';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261027a_raport_distributie_gaze:' || txid_current() THEN
    RAISE EXCEPTION '20261027a: garda final invalida';
  END IF;
END $post$;
