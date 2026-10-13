-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261027a — „Raport lucrări executate" pentru distribuție gaze în raportul zilnic mobil (cerere Răzvan 13.10.2026)
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

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.raport_distributie_linii'::regclass)
     OR has_table_privilege('anon', 'public.raport_distributie_linii', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.raport_distributie_linii', 'INSERT')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raport_distributie_linii') <> 4
     OR EXISTS (SELECT 1 FROM public.executie_proiecte WHERE raport_distributie)
     OR EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE distributie_antet IS NOT NULL) THEN
    RAISE EXCEPTION '20261027a: postconditie';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261027a_raport_distributie_gaze:' || txid_current() THEN
    RAISE EXCEPTION '20261027a: garda final invalida';
  END IF;
END $post$;
