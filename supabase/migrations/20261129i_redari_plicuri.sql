-- Version 20261129120800. Runner supplies one transaction.
-- 20261129i_redari_plicuri — Redări felia 10: plicul comun (decizia lui Răzvan, juridic#018, 03.11.2026).
-- Un plic = un deținător (aceeași persoană: nume normalizat + aceeași adresă de corespondență) + un UAT, cu toate convocările lui poștale.
-- Un AWB pe plic; expedierea, AR-ul și returul se înregistrează PE PLIC și se propagă pe toate convocările din plic.
-- AR și retur cer scanul (cartonașul AR față-verso / plicul cu mențiunea poștei), verificat în Storage (bucket `redari`, sub plicuri/<id>/).
-- Plicurile se grupează în loturi de plicuire (PV de plicuire, 2 semnături); un plic se expediază doar dacă e într-un lot.
-- Motive de retur noi: `decedat` (marchează deținătorii din plic ca decedați — semnal pentru cererea către TGZ; nu trimite nimic) și `altul` (text obligatoriu).
-- Pe canalul `posta`, câmpurile poștale ale convocării NU se mai scriu direct din aplicație (doar prin plic); celelalte canale rămân neschimbate.
-- Revenire: supabase/revenire/20261129i_redari_plicuri_ROLLBACK.sql (NU șterge: mută tabelele în arhivă). DRY: supabase/tests/20261129i_redari_plicuri_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261129i_redari_plicuri:' || txid_current() THEN
    RAISE EXCEPTION '20261129i: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_plicuri') IS NOT NULL OR to_regclass('public.red_loturi_plicuire') IS NOT NULL THEN RAISE EXCEPTION '20261129i: tabelele exista deja'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='red_convocari' AND column_name IN ('plic_id','retur_detaliu')) THEN
    RAISE EXCEPTION '20261129i: coloanele noi exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_jurnal()') IS NULL OR to_regprocedure('public.fn_red_versiune_creste()') IS NULL THEN
    RAISE EXCEPTION '20261129i: lipseste schema Redari';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.red_convocari'::regclass AND conname='red_convocari_retur_check') THEN
    RAISE EXCEPTION '20261129i: constrangerea retur lipseste (schema diferita)';
  END IF;
  LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  -- regula „poștă doar prin plic” e sigură doar cât nu există convocări poștale cu evidență scrisă direct
  IF EXISTS (SELECT 1 FROM public.red_convocari WHERE canal='posta' AND (data_expediere IS NOT NULL OR data_confirmare_primire IS NOT NULL OR retur IS NOT NULL)) THEN
    RAISE EXCEPTION '20261129i: exista convocari postale cu evidenta directa — se trateaza intai';
  END IF;
END $pre$;

CREATE TABLE public.red_loturi_plicuire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  nr_lot text NOT NULL UNIQUE CHECK (nr_lot ~ '^PP-[0-9]{4}$'),
  data_plicuire date NOT NULL,
  semnatar1 text CHECK (semnatar1 IS NULL OR length(semnatar1) <= 200),
  semnatar2 text CHECK (semnatar2 IS NULL OR length(semnatar2) <= 200),
  pv_path text CHECK (pv_path IS NULL OR length(pv_path) <= 500),
  observatii text CHECK (observatii IS NULL OR length(observatii) <= 4000),
  versiune integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.red_loturi_plicuire IS 'Redări: lot de plicuire (PV de plicuire PP-nnnn, 2 semnături). Se creează doar prin fn_red_lot_plicuire_creeaza.';

CREATE TABLE public.red_plicuri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  nr_plic text NOT NULL UNIQUE CHECK (nr_plic ~ '^PL-[A-Z]{3}-[0-9]{4}$'),
  cheie_persoana text NOT NULL,
  destinatar_nume text NOT NULL,
  lot_id uuid REFERENCES public.red_loturi_plicuire(id),
  awb text CHECK (awb IS NULL OR awb ~ '^[A-Z0-9]{4,40}$'),
  data_expediere date,
  data_ar date,
  ar_scan_path text,
  retur text CHECK (retur IS NULL OR retur IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta', 'decedat', 'altul')),
  retur_detaliu text CHECK (retur_detaliu IS NULL OR length(retur_detaliu) <= 1000),
  retur_data date,
  retur_scan_path text,
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  motiv_anulare text,
  versiune integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_plicuri_expediere CHECK ((awb IS NULL) = (data_expediere IS NULL)),
  CONSTRAINT red_plicuri_ar_scan CHECK (data_ar IS NULL OR ar_scan_path IS NOT NULL),
  CONSTRAINT red_plicuri_retur_complet CHECK ((retur IS NULL AND retur_data IS NULL AND retur_scan_path IS NULL AND retur_detaliu IS NULL)
                                              OR (retur IS NOT NULL AND retur_data IS NOT NULL AND retur_scan_path IS NOT NULL)),
  CONSTRAINT red_plicuri_retur_altul CHECK (retur IS DISTINCT FROM 'altul' OR length(btrim(coalesce(retur_detaliu, ''))) > 0),
  CONSTRAINT red_plicuri_ar_sau_retur CHECK (NOT (data_ar IS NOT NULL AND retur IS NOT NULL)),
  CONSTRAINT red_plicuri_dupa_expediere CHECK ((data_ar IS NULL AND retur IS NULL) OR data_expediere IS NOT NULL),
  CONSTRAINT red_plicuri_cronologie CHECK ((data_ar IS NULL OR data_ar >= data_expediere) AND (retur_data IS NULL OR retur_data >= data_expediere)),
  CONSTRAINT red_plicuri_anulare CHECK (stare <> 'anulat' OR (length(btrim(coalesce(motiv_anulare, ''))) > 0 AND data_expediere IS NULL))
);
CREATE UNIQUE INDEX red_plicuri_awb_uq ON public.red_plicuri (awb) WHERE awb IS NOT NULL AND stare = 'activ';
CREATE INDEX idx_red_plicuri_proiect ON public.red_plicuri (proiect_id, uat_id);
CREATE INDEX idx_red_plicuri_lot ON public.red_plicuri (lot_id);
COMMENT ON TABLE public.red_plicuri IS 'Redări: plicul comun (un deținător + un UAT). Expediere / AR / retur doar aici, propagate pe convocări; AR și retur cer scan în Storage.';

ALTER TABLE public.red_convocari ADD COLUMN plic_id uuid REFERENCES public.red_plicuri(id);
ALTER TABLE public.red_convocari ADD COLUMN retur_detaliu text CHECK (retur_detaliu IS NULL OR length(retur_detaliu) <= 1000);
ALTER TABLE public.red_convocari DROP CONSTRAINT red_convocari_retur_check;
ALTER TABLE public.red_convocari ADD CONSTRAINT red_convocari_retur_check
  CHECK (retur IS NULL OR retur IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta', 'decedat', 'altul'));
CREATE INDEX idx_red_convocari_plic ON public.red_convocari (plic_id);

-- Garda pe convocări (SECURITY INVOKER intenționat: current_user = apelantul; în RPC-urile / triggerele SECURITY DEFINER e `postgres`).
-- Din aplicație: plic_id nu se scrie direct; pe canalul `posta`, câmpurile poștale nu se scriu direct (doar prin plic).
CREATE FUNCTION public.fn_red_convocari_posta_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_user = 'postgres' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.plic_id IS NOT NULL OR (NEW.canal = 'posta' AND (NEW.data_expediere IS NOT NULL OR NEW.nr_tracking IS NOT NULL OR NEW.data_confirmare_primire IS NOT NULL
        OR NEW.retur IS NOT NULL OR NEW.retur_data IS NOT NULL OR NEW.retur_detaliu IS NOT NULL)) THEN
      RAISE EXCEPTION 'redari: evidenta postala se tine pe plic (Redari -> Posta)' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.plic_id IS DISTINCT FROM OLD.plic_id THEN
    RAISE EXCEPTION 'redari: plicul unei convocari se schimba doar prin plic' USING ERRCODE = '23514';
  END IF;
  IF (OLD.canal = 'posta' OR NEW.canal = 'posta') AND (NEW.canal, NEW.data_expediere, NEW.nr_tracking, NEW.data_confirmare_primire, NEW.retur, NEW.retur_data, NEW.retur_detaliu)
       IS DISTINCT FROM (OLD.canal, OLD.data_expediere, OLD.nr_tracking, OLD.data_confirmare_primire, OLD.retur, OLD.retur_data, OLD.retur_detaliu) THEN
    RAISE EXCEPTION 'redari: evidenta postala se tine pe plic (Redari -> Posta)' USING ERRCODE = '23514';
  END IF;
  -- o convocare dintr-un plic activ nu se anuleaza direct (plicul ar ramane cu o convocare anulata inauntru)
  IF NEW.stare = 'anulat' AND OLD.stare <> 'anulat' AND OLD.plic_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.red_plicuri p WHERE p.id = OLD.plic_id AND p.stare = 'activ') THEN
    RAISE EXCEPTION 'redari: convocarea e intr-un plic activ; anuleaza intai plicul' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_convocari_posta_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_convocari_posta_garda BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_posta_garda();

-- Scanul există în Storage, în folderul plicului (nu orice cale).
CREATE FUNCTION public.fn_red_plic_scan_exista(p_plic uuid, p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p_path IS NOT NULL AND p_path LIKE 'plicuri/' || p_plic::text || '/%' AND p_path NOT LIKE '%..%'
     AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = p_path);
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_scan_exista(uuid, text) FROM PUBLIC, anon, authenticated;

-- Regulile plicului (BEFORE). Din aplicație (RLS: UPDATE admin/editor) se pot pune, O SINGURĂ DATĂ: AWB + data expedierii (doar cu lot),
-- AR (data + scan) sau retur (motiv + data + scan [+ detaliu]); anularea doar înainte de expediere. Restul e imuabil.
CREATE FUNCTION public.fn_red_plic_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- lot_id se schimbă doar din fn_red_lot_plicuire_creeaza: RPC-ul pune o marcă în tranzacție (GUC local), pe care aplicația nu o poate seta
-- (PostgREST nu expune set_config). Mentenanța (sesiune postgres fără JWT) e și ea permisă.
-- coalesce: GUC-ul nesetat intoarce NULL, iar NOT NULL nu ar declansa refuzul (prins de DRY TEST2)
DECLARE v_din_rpc boolean := coalesce(current_setting('gazpet.red_lot_rpc', true), '') = txid_current()::text
                            OR (session_user = 'postgres' AND coalesce(current_setting('request.jwt.claims', true), '') = '');
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1; RETURN NEW; END IF;
  NEW.updated_at := now();
  IF (NEW.proiect_id, NEW.uat_id, NEW.nr_plic, NEW.cheie_persoana, NEW.destinatar_nume, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.proiect_id, OLD.uat_id, OLD.nr_plic, OLD.cheie_persoana, OLD.destinatar_nume, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'redari: identitatea plicului nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF OLD.stare = 'anulat' AND (to_jsonb(NEW) - 'updated_at' - 'versiune') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'versiune') THEN
    RAISE EXCEPTION 'redari: plicul anulat nu se mai modifica' USING ERRCODE = '23514';
  END IF;
  IF NOT v_din_rpc AND NEW.lot_id IS DISTINCT FROM OLD.lot_id THEN
    RAISE EXCEPTION 'redari: lotul de plicuire se atribuie doar prin fn_red_lot_plicuire_creeaza' USING ERRCODE = '23514';
  END IF;
  IF (OLD.awb IS NOT NULL AND NEW.awb IS DISTINCT FROM OLD.awb) OR (OLD.data_expediere IS NOT NULL AND NEW.data_expediere IS DISTINCT FROM OLD.data_expediere) THEN
    RAISE EXCEPTION 'redari: expedierea plicului e deja inregistrata' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_expediere IS NOT NULL AND OLD.data_expediere IS NULL THEN
    IF NEW.lot_id IS NULL THEN RAISE EXCEPTION 'redari: plicul se expediaza doar dupa PV-ul de plicuire (lot)' USING ERRCODE = '23514'; END IF;
    NEW.awb := upper(regexp_replace(NEW.awb, '\s', '', 'g'));
  END IF;
  IF (OLD.data_ar IS NOT NULL AND (NEW.data_ar, NEW.ar_scan_path) IS DISTINCT FROM (OLD.data_ar, OLD.ar_scan_path))
     OR (OLD.retur IS NOT NULL AND (NEW.retur, NEW.retur_data, NEW.retur_scan_path, NEW.retur_detaliu) IS DISTINCT FROM (OLD.retur, OLD.retur_data, OLD.retur_scan_path, OLD.retur_detaliu)) THEN
    RAISE EXCEPTION 'redari: AR-ul / returul plicului e deja inregistrat' USING ERRCODE = '23514';
  END IF;
  IF NEW.data_ar IS NOT NULL AND OLD.data_ar IS NULL AND NOT public.fn_red_plic_scan_exista(NEW.id, NEW.ar_scan_path) THEN
    RAISE EXCEPTION 'redari: scanul AR lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF NEW.retur IS NOT NULL AND OLD.retur IS NULL AND NOT public.fn_red_plic_scan_exista(NEW.id, NEW.retur_scan_path) THEN
    RAISE EXCEPTION 'redari: scanul plicului returnat lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF NEW.stare = 'anulat' AND OLD.stare = 'activ' AND NEW.lot_id IS DISTINCT FROM OLD.lot_id THEN
    RAISE EXCEPTION 'redari: anularea nu schimba lotul' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_reguli() FROM PUBLIC, anon, authenticated;

-- Propagarea pe convocări (AFTER). Ca `postgres` (SECURITY DEFINER), deci trece de garda convocărilor; jurnalul convocărilor înregistrează schimbarea.
CREATE FUNCTION public.fn_red_plic_propaga() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.data_expediere IS NOT NULL AND OLD.data_expediere IS NULL THEN
    UPDATE public.red_convocari SET data_expediere = NEW.data_expediere, nr_tracking = NEW.awb WHERE plic_id = NEW.id;
  END IF;
  IF NEW.data_ar IS NOT NULL AND OLD.data_ar IS NULL THEN
    UPDATE public.red_convocari SET data_confirmare_primire = NEW.data_ar WHERE plic_id = NEW.id;
  END IF;
  IF NEW.retur IS NOT NULL AND OLD.retur IS NULL THEN
    UPDATE public.red_convocari SET retur = NEW.retur, retur_data = NEW.retur_data, retur_detaliu = NEW.retur_detaliu WHERE plic_id = NEW.id;
    IF NEW.retur = 'decedat' THEN
      UPDATE public.red_detinatori d SET decedat = true
        WHERE d.id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.plic_id = NEW.id) AND d.decedat IS NOT TRUE;
    END IF;
  END IF;
  IF NEW.stare = 'anulat' AND OLD.stare = 'activ' THEN
    UPDATE public.red_convocari SET plic_id = NULL WHERE plic_id = NEW.id;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_propaga() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_red_lot_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); NEW.updated_at := now(); NEW.versiune := 1; RETURN NEW; END IF;
  NEW.updated_at := now();
  IF (NEW.proiect_id, NEW.nr_lot, NEW.data_plicuire, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.proiect_id, OLD.nr_lot, OLD.data_plicuire, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'redari: identitatea lotului de plicuire nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF OLD.pv_path IS NOT NULL AND NEW.pv_path IS DISTINCT FROM OLD.pv_path THEN
    RAISE EXCEPTION 'redari: PV-ul de plicuire e deja atasat' USING ERRCODE = '23514';
  END IF;
  IF NEW.pv_path IS NOT NULL AND OLD.pv_path IS NULL AND NOT (NEW.pv_path LIKE 'plicuire/' || NEW.id::text || '/%' AND NEW.pv_path NOT LIKE '%..%'
     AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.pv_path)) THEN
    RAISE EXCEPTION 'redari: PV-ul de plicuire lipseste din Storage (plicuire/<id>/...)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_lot_reguli() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_red_plic_reguli BEFORE INSERT OR UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_reguli();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_plic_propaga AFTER UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_propaga();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_lot_reguli BEFORE INSERT OR UPDATE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_lot_reguli();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- Cheia persoanei: numele normalizat + adresa de corespondență normalizată (fără spații multiple, litere mici). Fără adresă cunoscută = fără plic.
CREATE FUNCTION public.fn_red_cheie_persoana(p_detinator uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN c.adresa_cunoscuta IS TRUE AND length(btrim(coalesce(c.adresa_strada, '') || coalesce(c.adresa_sat, '') || coalesce(c.adresa_comuna, ''))) > 0
    THEN md5(lower(btrim(d.nume_normalizat)) || '|' || lower(regexp_replace(btrim(coalesce(c.adresa_strada, '')) || '|' || btrim(coalesce(c.adresa_sat, '')) || '|'
             || btrim(coalesce(c.adresa_comuna, '')) || '|' || btrim(coalesce(c.adresa_judet, '')) || '|' || btrim(coalesce(c.cod_postal, '')), '\s+', ' ', 'g')))
    ELSE NULL END
  FROM public.red_detinatori d LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  WHERE d.id = p_detinator AND d.sters_la IS NULL;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_cheie_persoana(uuid) FROM PUBLIC, anon, authenticated;

-- Creează un plic din convocări (toate: active, poștale, fără plic, neexpediate, același proiect, același UAT, aceeași persoană).
CREATE FUNCTION public.fn_red_plic_creeaza(p_proiect_id uuid, p_convocari uuid[]) RETURNS public.red_plicuri
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_n integer; v_uat uuid; v_uat3 text; v_chei text[]; v_nr integer; v_plic public.red_plicuri; v_nume text; v_gasite integer;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: fara drept de plicuire' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL OR p_convocari IS NULL OR cardinality(p_convocari) = 0 OR cardinality(p_convocari) > 200 THEN
    RAISE EXCEPTION 'redari: lista de convocari invalida (1..200)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_convocari) x) <> cardinality(p_convocari) THEN RAISE EXCEPTION 'redari: convocari duplicate in lista' USING ERRCODE = '22023'; END IF;
  -- blocare în ordine fixă (id), ca două plicuiri concurente să nu se blocheze reciproc
  PERFORM 1 FROM public.red_convocari WHERE id = ANY(p_convocari) ORDER BY id FOR UPDATE;
  SELECT count(*), min(p.uat_id::text)::uuid, count(DISTINCT p.uat_id), array_agg(DISTINCT coalesce(public.fn_red_cheie_persoana(c.detinator_id), '<fara>'))
    INTO v_gasite, v_uat, v_n, v_chei
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = ANY(p_convocari) AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
     AND p.proiect_id = p_proiect_id AND p.sters_la IS NULL AND d.sters_la IS NULL;
  IF v_gasite <> cardinality(p_convocari) THEN
    RAISE EXCEPTION 'redari: % din % convocari nu se pot pune in plic (inactive, alt canal, deja in plic, expediate sau din alt proiect)', cardinality(p_convocari) - v_gasite, cardinality(p_convocari) USING ERRCODE = 'P0001';
  END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'redari: convocarile sunt din UAT-uri diferite' USING ERRCODE = 'P0001'; END IF;
  IF cardinality(v_chei) <> 1 OR v_chei[1] = '<fara>' THEN
    RAISE EXCEPTION 'redari: convocarile nu sunt ale aceleiasi persoane cu adresa cunoscuta (nume + adresa)' USING ERRCODE = 'P0001';
  END IF;
  SELECT u.uat3 INTO v_uat3 FROM public.red_uat u WHERE u.id = v_uat AND u.proiect_id = p_proiect_id FOR SHARE;
  IF v_uat3 IS NULL THEN RAISE EXCEPTION 'redari: UAT inexistent in proiect' USING ERRCODE = '23503'; END IF;
  SELECT d.nume INTO v_nume FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.id = p_convocari[1];
  INSERT INTO public.red_numere (cheie, ultimul) VALUES ('PL-' || v_uat3, 1)
    ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1 RETURNING ultimul INTO v_nr;
  IF v_nr > 9999 THEN RAISE EXCEPTION 'redari: numerotarea plicurilor pe % depaseste 9999', v_uat3; END IF;
  INSERT INTO public.red_plicuri (proiect_id, uat_id, nr_plic, cheie_persoana, destinatar_nume, created_by)
    VALUES (p_proiect_id, v_uat, 'PL-' || v_uat3 || '-' || lpad(v_nr::text, 4, '0'), v_chei[1], v_nume, auth.uid()) RETURNING * INTO v_plic;
  UPDATE public.red_convocari SET plic_id = v_plic.id WHERE id = ANY(p_convocari);
  RETURN v_plic;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_creeaza(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_plic_creeaza(uuid, uuid[]) TO authenticated;

-- Creează un lot de plicuire (PV PP-nnnn) din plicuri active, fără lot, neexpediate, din același proiect.
CREATE FUNCTION public.fn_red_lot_plicuire_creeaza(p_proiect_id uuid, p_plicuri uuid[], p_data date) RETURNS public.red_loturi_plicuire
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_gasite integer; v_nr integer; v_lot public.red_loturi_plicuire;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: fara drept de plicuire' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL OR p_data IS NULL OR p_plicuri IS NULL OR cardinality(p_plicuri) = 0 OR cardinality(p_plicuri) > 2000 THEN
    RAISE EXCEPTION 'redari: lot invalid (1..2000 plicuri, data obligatorie)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_plicuri) x) <> cardinality(p_plicuri) THEN RAISE EXCEPTION 'redari: plicuri duplicate in lista' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = ANY(p_plicuri) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_gasite FROM public.red_plicuri
   WHERE id = ANY(p_plicuri) AND proiect_id = p_proiect_id AND stare = 'activ' AND lot_id IS NULL AND data_expediere IS NULL;
  IF v_gasite <> cardinality(p_plicuri) THEN
    RAISE EXCEPTION 'redari: % din % plicuri nu se pot pune in lot (anulate, deja in lot, expediate sau din alt proiect)', cardinality(p_plicuri) - v_gasite, cardinality(p_plicuri) USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES ('PP', 1) ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1 RETURNING ultimul INTO v_nr;
  IF v_nr > 9999 THEN RAISE EXCEPTION 'redari: numerotarea loturilor de plicuire depaseste 9999'; END IF;
  INSERT INTO public.red_loturi_plicuire (proiect_id, nr_lot, data_plicuire, created_by) VALUES (p_proiect_id, 'PP-' || lpad(v_nr::text, 4, '0'), p_data, auth.uid()) RETURNING * INTO v_lot;
  PERFORM set_config('gazpet.red_lot_rpc', txid_current()::text, true);
  UPDATE public.red_plicuri SET lot_id = v_lot.id WHERE id = ANY(p_plicuri);
  PERFORM set_config('gazpet.red_lot_rpc', '', true);
  RETURN v_lot;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_lot_plicuire_creeaza(uuid, uuid[], date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_lot_plicuire_creeaza(uuid, uuid[], date) TO authenticated;

ALTER TABLE public.red_plicuri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_loturi_plicuire ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_plicuri, public.red_loturi_plicuire FROM PUBLIC, anon, authenticated;   -- privilegiile implicite Supabase dau ALL
GRANT SELECT, UPDATE ON public.red_plicuri, public.red_loturi_plicuire TO authenticated;          -- INSERT doar prin RPC; fără DELETE
GRANT ALL ON public.red_plicuri, public.red_loturi_plicuire TO service_role;
CREATE POLICY red_plicuri_sel ON public.red_plicuri FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_plicuri_upd ON public.red_plicuri FOR UPDATE TO authenticated
  USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_loturi_plicuire_sel ON public.red_loturi_plicuire FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_loturi_plicuire_upd ON public.red_loturi_plicuire FOR UPDATE TO authenticated
  USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_plicuri', 'red_loturi_plicuire')) <> 4 THEN RAISE EXCEPTION '20261129i: politici'; END IF;
  IF has_table_privilege('anon', 'public.red_plicuri', 'SELECT') OR has_table_privilege('authenticated', 'public.red_plicuri', 'INSERT')
     OR has_table_privilege('authenticated', 'public.red_plicuri', 'DELETE') OR has_table_privilege('authenticated', 'public.red_loturi_plicuire', 'INSERT') THEN
    RAISE EXCEPTION '20261129i: drepturi prea largi';
  END IF;
  IF has_function_privilege('anon', 'public.fn_red_plic_creeaza(uuid,uuid[])', 'EXECUTE') OR has_function_privilege('authenticated', 'public.fn_red_cheie_persoana(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_red_plic_scan_exista(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261129i: drepturi pe functii';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_retur_check' AND pg_get_constraintdef(oid) LIKE '%decedat%') THEN
    RAISE EXCEPTION '20261129i: retur check';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_convocari_posta_garda()'::regprocedure) THEN RAISE EXCEPTION '20261129i: garda trebuie SECURITY INVOKER'; END IF;
END $post$;
