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
  IF EXISTS (SELECT 1 FROM public.red_convocari WHERE canal='posta' AND (data_expediere IS NOT NULL OR nr_tracking IS NOT NULL OR data_confirmare_primire IS NOT NULL
             OR retur IS NOT NULL OR retur_data IS NOT NULL)) THEN   -- Jakarinos r1 P2-05: toate campurile postale protejate
    RAISE EXCEPTION '20261129i: exista convocari postale cu evidenta directa — se trateaza intai';
  END IF;
END $pre$;

CREATE TABLE public.red_loturi_plicuire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  nr_lot text NOT NULL UNIQUE CHECK (nr_lot ~ '^PP-[0-9]{4}$'),
  data_plicuire date NOT NULL,
  -- juridic#021 pct. 4: semnatarii se aleg din utilizatorii cu drept pe Redari, 2 persoane diferite (cine plicuieste / cine verifica)
  semnatar1_id uuid REFERENCES public.profiles(id),
  semnatar2_id uuid REFERENCES public.profiles(id),
  pv_path text CHECK (pv_path IS NULL OR length(pv_path) <= 500),
  observatii text CHECK (observatii IS NULL OR length(observatii) <= 4000),
  versiune integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_loturi_semnatari_diferiti CHECK (semnatar1_id IS NULL OR semnatar2_id IS NULL OR semnatar1_id <> semnatar2_id)
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
  ar_primit_de text CHECK (ar_primit_de IS NULL OR ar_primit_de IN ('destinatar', 'alta_persoana')),   -- juridic#021 pct. 5
  ar_mentiune text CHECK (ar_mentiune IS NULL OR length(ar_mentiune) <= 500),
  opis_path text,                                                                                       -- juridic#021 pct. 3: exemplarul de la dosar
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
  CONSTRAINT red_plicuri_ar_scan CHECK ((data_ar IS NULL) = (ar_scan_path IS NULL) AND (data_ar IS NULL) = (ar_primit_de IS NULL)),
  CONSTRAINT red_plicuri_ar_mentiune CHECK ((ar_primit_de IS DISTINCT FROM 'alta_persoana' AND ar_mentiune IS NULL)
                                            OR (ar_primit_de = 'alta_persoana' AND length(btrim(coalesce(ar_mentiune, ''))) > 0)),
  CONSTRAINT red_plicuri_retur_complet CHECK ((retur IS NULL AND retur_data IS NULL AND retur_scan_path IS NULL AND retur_detaliu IS NULL)
                                              OR (retur IS NOT NULL AND retur_data IS NOT NULL AND retur_scan_path IS NOT NULL)),
  CONSTRAINT red_plicuri_retur_altul CHECK (retur IS DISTINCT FROM 'altul' OR length(btrim(coalesce(retur_detaliu, ''))) > 0),
  CONSTRAINT red_plicuri_ar_sau_retur CHECK (NOT (data_ar IS NOT NULL AND retur IS NOT NULL)),
  CONSTRAINT red_plicuri_dupa_expediere CHECK ((data_ar IS NULL AND retur IS NULL) OR data_expediere IS NOT NULL),
  CONSTRAINT red_plicuri_cronologie CHECK ((data_ar IS NULL OR data_ar >= data_expediere) AND (retur_data IS NULL OR retur_data >= data_expediere)),
  CONSTRAINT red_plicuri_anulare CHECK ((stare = 'anulat' AND length(btrim(coalesce(motiv_anulare, ''))) > 0 AND data_expediere IS NULL)
                                        OR (stare = 'activ' AND motiv_anulare IS NULL))
);
CREATE UNIQUE INDEX red_plicuri_awb_uq ON public.red_plicuri (awb) WHERE awb IS NOT NULL AND stare = 'activ';
CREATE INDEX idx_red_plicuri_proiect ON public.red_plicuri (proiect_id, uat_id);
-- Gemini/Jakarinos r1 P1: un singur plic activ neexpediat pe persoana si UAT (plicuirea completa e verificata si in RPC)
CREATE UNIQUE INDEX red_plicuri_persoana_uq ON public.red_plicuri (proiect_id, uat_id, cheie_persoana) WHERE stare = 'activ' AND data_expediere IS NULL;
CREATE INDEX idx_red_plicuri_lot ON public.red_plicuri (lot_id);
COMMENT ON TABLE public.red_plicuri IS 'Redări: plicul comun (un deținător + un UAT). Expediere / AR / retur doar aici, propagate pe convocări; AR și retur cer scan în Storage.';

ALTER TABLE public.red_convocari ADD COLUMN plic_id uuid REFERENCES public.red_plicuri(id);
ALTER TABLE public.red_convocari ADD COLUMN retur_detaliu text CHECK (retur_detaliu IS NULL OR length(retur_detaliu) <= 1000);
ALTER TABLE public.red_convocari DROP CONSTRAINT red_convocari_retur_check;
ALTER TABLE public.red_convocari ADD CONSTRAINT red_convocari_retur_check
  CHECK (retur IS NULL OR retur IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta', 'decedat', 'altul'));
CREATE INDEX idx_red_convocari_plic ON public.red_convocari (plic_id);

-- Jakarinos r2 P2-03: cheia persoanei e un hash CU SARE secretă (tabel fără niciun drept pentru aplicație), ca cine vede plicurile / jurnalul
-- să nu poată verifica adrese candidate. Sarea se generează la instalare.
CREATE TABLE public.red_plic_sare (id boolean PRIMARY KEY DEFAULT true CHECK (id), sare text NOT NULL);
ALTER TABLE public.red_plic_sare ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_plic_sare FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.red_plic_sare (sare) VALUES (encode(gen_random_bytes(32), 'hex'));

-- Cheia persoanei: numele normalizat + adresa de corespondență normalizată, cu sare. Fără nume sau fără adresă cunoscută = NULL (fără plic).
-- fn_red_cheie_calc lucrează pe valori explicite (garda de identitate o cheamă cu valorile NOI ale rândului modificat).
CREATE FUNCTION public.fn_red_cheie_calc(p_nume text, p_strada text, p_sat text, p_comuna text, p_judet text, p_cod text, p_cunoscuta boolean) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN p_cunoscuta IS TRUE AND length(btrim(coalesce(p_nume, ''))) > 0
              AND length(btrim(coalesce(p_strada, '') || coalesce(p_sat, '') || coalesce(p_comuna, ''))) > 0
    THEN md5((SELECT s.sare FROM public.red_plic_sare s) || '|' || lower(btrim(p_nume)) || '|' || lower(regexp_replace(btrim(coalesce(p_strada, '')) || '|' || btrim(coalesce(p_sat, '')) || '|'
             || btrim(coalesce(p_comuna, '')) || '|' || btrim(coalesce(p_judet, '')) || '|' || btrim(coalesce(p_cod, '')), '\s+', ' ', 'g')))
    ELSE NULL END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_cheie_calc(text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.fn_red_cheie_persoana(p_detinator uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.fn_red_cheie_calc(d.nume_normalizat, c.adresa_strada, c.adresa_sat, c.adresa_comuna, c.adresa_judet, c.cod_postal, c.adresa_cunoscuta)
  FROM public.red_detinatori d LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  WHERE d.id = p_detinator AND d.sters_la IS NULL;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_cheie_persoana(uuid) FROM PUBLIC, anon, authenticated;

-- Jakarinos r6 (P1 + P2) — PROTOCOLUL DE CONCURENȚĂ, simplificat: UN SINGUR lock de serializare pe UAT ('red_plic_uat:<uat>').
--  * plicuirea (fn_red_plic_creeaza, RPC: nicio blocare de rând înainte) îl ia ÎNTÂI, cu așteptare (lock_timeout 5s), înainte de rânduri;
--  * expedierea (fn_red_plic_reguli, trigger: rândul plicului e deja blocat de UPDATE) îl ÎNCEARCĂ fără așteptare (Jakarinos r7 P2-01);
--  * toate gărzile care pot schimba apartenența la plic (convocare poștală nouă / reactivată, nume, adresă, ștergere / mutare de deținător,
--    ștergere / reactivare de parcelă) îl ÎNCEARCĂ fără așteptare, indiferent de starea rândului (și pentru deținători șterși), și abia apoi
--    citesc identitatea; dacă e ținut, eroare reîncercabilă 55P03. Gărzile nu mai așteaptă niciun lock de rând -> fără cicluri de așteptare.
--  Două gărzi pe același UAT se serializează între ele; plicuirea / expedierea văd starea comisă a oricărei gărzi (sau gărzile le văd pe ele).
--  Tranzacțiile din aplicație sunt scurte (o cerere = o tranzacție), deci coliziunile sunt rare; eroarea cere doar reîncercarea.
CREATE FUNCTION public.fn_red_plic_incearca_lock(p_uat uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_uat IS NULL THEN RETURN; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('red_plic_uat:' || p_uat::text, 0)) THEN
    RAISE EXCEPTION 'redari: o plicuire / expediere sau o modificare de deținători e în curs în acest UAT; reîncercați peste câteva secunde' USING ERRCODE = '55P03';
  END IF;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_incearca_lock(uuid) FROM PUBLIC, anon, authenticated;

-- UAT-ul curent al unui deținător (și când e șters logic); NULL dacă nu există
CREATE FUNCTION public.fn_red_plic_uat_detinator(p_detinator uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p.uat_id FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE d.id = p_detinator;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_uat_detinator(uuid) FROM PUBLIC, anon, authenticated;

-- lock pe UAT-ul deținătorului (try), apoi verificare că deținătorul nu s-a mutat între citire și lock
CREATE FUNCTION public.fn_red_plic_incearca_lock_detinator(p_detinator uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uat uuid;
BEGIN
  v_uat := public.fn_red_plic_uat_detinator(p_detinator);
  PERFORM public.fn_red_plic_incearca_lock(v_uat);
  IF public.fn_red_plic_uat_detinator(p_detinator) IS DISTINCT FROM v_uat THEN
    RAISE EXCEPTION 'redari: deținătorul a fost mutat între timp; reîncercați' USING ERRCODE = '55P03';
  END IF;
  RETURN v_uat;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_incearca_lock_detinator(uuid) FROM PUBLIC, anon, authenticated;

-- Jakarinos r2 P1: o convocare poștală care devine eligibilă (inserare / reactivare) pentru o persoană cu plic activ neexpediat e refuzată,
-- sub același advisory lock ca plicuirea (serializare); plicul se anulează și se reface complet. Apelată din garda convocărilor (INVOKER),
-- deci are EXECUTE pentru authenticated; nu întoarce date (doar refuză).
CREATE FUNCTION public.fn_red_plic_garda_persoana(p_detinator uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cheie text; v_uat uuid; v_nr text;
BEGIN
  -- Jakarinos r6: lock-ul UAT-ului ÎNAINTE de citirea identității, și când deținătorul e șters / fără adresă (cheia NULL)
  v_uat := public.fn_red_plic_incearca_lock_detinator(p_detinator);
  v_cheie := public.fn_red_cheie_persoana(p_detinator);
  IF v_cheie IS NULL OR v_uat IS NULL THEN RETURN; END IF;
  SELECT nr_plic INTO v_nr FROM public.red_plicuri WHERE uat_id = v_uat AND cheie_persoana = v_cheie AND stare = 'activ' AND data_expediere IS NULL LIMIT 1;
  IF v_nr IS NOT NULL THEN
    RAISE EXCEPTION 'redari: persoana are plicul neexpediat %; anuleaza-l si refa-l cu toate convocarile', v_nr USING ERRCODE = '23514';
  END IF;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_garda_persoana(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_plic_garda_persoana(uuid) TO authenticated;

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
    IF NEW.canal = 'posta' AND NEW.stare = 'activ' AND NEW.sters_la IS NULL THEN PERFORM public.fn_red_plic_garda_persoana(NEW.detinator_id); END IF;
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
  IF ((NEW.stare = 'anulat' AND OLD.stare <> 'anulat') OR (NEW.sters_la IS NOT NULL AND OLD.sters_la IS NULL)) AND OLD.plic_id IS NOT NULL   -- r1: si stergerea logica
     AND EXISTS (SELECT 1 FROM public.red_plicuri p WHERE p.id = OLD.plic_id AND p.stare = 'activ') THEN
    RAISE EXCEPTION 'redari: convocarea e intr-un plic activ; anuleaza intai plicul' USING ERRCODE = '23514';
  END IF;
  -- r2 P1: convocarea redevine eligibila pentru plic (reactivare / scoasa din stergere) -> aceeasi garda pe persoana
  IF NEW.canal = 'posta' AND NEW.stare = 'activ' AND NEW.sters_la IS NULL AND NEW.plic_id IS NULL
     AND NOT (OLD.canal = 'posta' AND OLD.stare = 'activ' AND OLD.sters_la IS NULL) THEN
    PERFORM public.fn_red_plic_garda_persoana(NEW.detinator_id);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_convocari_posta_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_convocari_posta_garda BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_posta_garda();

-- Scanul există în Storage, în folderul plicului (nu orice cale).
CREATE FUNCTION public.fn_red_plic_scan_exista(p_plic uuid, p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p_path IS NOT NULL AND p_path ~ ('^plicuri/' || p_plic::text || '/[A-Za-z0-9._-]+\.(pdf|PDF|jpg|JPG|jpeg|JPEG|png|PNG)$')   -- r1: cale stricta
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
    -- juridic#021: fara imputernicire nu pleaca nimic (pasul 4 din planul de verificare, cap. 6); opisul de la dosar e atasat
    -- Jakarinos r3 P2: proiectul citit si blocat FOR SHARE (retragerea concurenta a imputernicirii asteapta sau e vazuta)
    IF NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = NEW.proiect_id AND length(btrim(coalesce(pr.imputernicire_nr, ''))) > 0 AND pr.imputernicire_data IS NOT NULL FOR SHARE) THEN
      RAISE EXCEPTION 'redari: proiectul nu are inca imputernicirea Beneficiarului (nr. + data); plicurile nu pleaca' USING ERRCODE = '23514';
    END IF;
    IF NEW.opis_path IS NULL THEN RAISE EXCEPTION 'redari: atasati intai opisul plicului (exemplarul de la dosar)' USING ERRCODE = '23514'; END IF;
    -- Jakarinos r1 P1-02 / Gemini r1: lotul trebuie finalizat (PV semnat atasat, ambii semnatari) si datat inainte de expediere; blocat FOR SHARE
    IF NOT EXISTS (SELECT 1 FROM public.red_loturi_plicuire l WHERE l.id = NEW.lot_id AND l.pv_path IS NOT NULL
                     AND l.semnatar1_id IS NOT NULL AND l.semnatar2_id IS NOT NULL AND l.data_plicuire <= NEW.data_expediere FOR SHARE) THEN
      RAISE EXCEPTION 'redari: PV-ul de plicuire nu e finalizat (PV semnat atasat, 2 semnatari) sau expedierea e inaintea plicuirii' USING ERRCODE = '23514';
    END IF;
    -- Jakarinos r2 P1/P2: la expediere se reverifica, sub acelasi advisory lock, ca plicul e complet si identitatea postala neschimbata
    -- Jakarinos r7 P2-01: executorul a blocat deja randul plicului inaintea triggerului, deci aici lock-ul UAT se INCEARCA (nu se asteapta):
    -- doua expedieri / o expediere si o plicuire in acelasi UAT nu pot forma ciclu; cea care pierde primeste 55P03 si reincearca
    PERFORM public.fn_red_plic_incearca_lock(NEW.uat_id);
    PERFORM 1 FROM public.red_detinatori d WHERE d.id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.plic_id = NEW.id) ORDER BY d.id FOR SHARE;
    PERFORM 1 FROM public.red_detinatori_contact k WHERE k.detinator_id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.plic_id = NEW.id) ORDER BY k.detinator_id FOR SHARE;
    PERFORM 1 FROM public.red_parcele p WHERE p.id IN (SELECT d.parcela_id FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.plic_id = NEW.id) ORDER BY p.id FOR SHARE;
    -- Jakarinos r3 P2: fiecare membru reverificat pe TOT criteriul de eligibilitate (parcela nestearsa, acelasi proiect si UAT), blocat FOR SHARE
    IF EXISTS (SELECT 1 FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
                WHERE c.plic_id = NEW.id
                  AND (c.stare <> 'activ' OR c.sters_la IS NOT NULL OR d.sters_la IS NOT NULL OR p.sters_la IS NOT NULL
                       OR p.proiect_id <> NEW.proiect_id OR p.uat_id <> NEW.uat_id OR public.fn_red_cheie_persoana(c.detinator_id) IS DISTINCT FROM NEW.cheie_persoana)) THEN
      RAISE EXCEPTION 'redari: plicul % nu mai corespunde (nume / adresa schimbate sau convocare anulata); anuleaza-l si refa-l', NEW.nr_plic USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
                WHERE p.proiect_id = NEW.proiect_id AND p.uat_id = NEW.uat_id AND p.sters_la IS NULL AND d.sters_la IS NULL
                  AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
                  AND public.fn_red_cheie_persoana(c.detinator_id) = NEW.cheie_persoana) THEN
      RAISE EXCEPTION 'redari: persoana are convocari noi care nu sunt in plicul %; anuleaza-l si refa-l complet', NEW.nr_plic USING ERRCODE = '23514';
    END IF;
    NEW.awb := upper(regexp_replace(NEW.awb, '\s', '', 'g'));
  END IF;
  IF OLD.opis_path IS NOT NULL AND NEW.opis_path IS DISTINCT FROM OLD.opis_path THEN
    RAISE EXCEPTION 'redari: opisul plicului e deja atasat' USING ERRCODE = '23514';
  END IF;
  IF NEW.opis_path IS NOT NULL AND OLD.opis_path IS NULL AND NOT (NEW.opis_path ~ ('^plicuri/' || NEW.id::text || '/[A-Za-z0-9._-]+\.(docx|DOCX|pdf|PDF)$')
     AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.opis_path)) THEN
    RAISE EXCEPTION 'redari: opisul lipseste din Storage (plicuri/<id>/...)' USING ERRCODE = '23514';
  END IF;
  IF (OLD.data_ar IS NOT NULL AND (NEW.data_ar, NEW.ar_scan_path, NEW.ar_primit_de, NEW.ar_mentiune) IS DISTINCT FROM (OLD.data_ar, OLD.ar_scan_path, OLD.ar_primit_de, OLD.ar_mentiune))
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
  IF OLD.pv_path IS NOT NULL AND (NEW.pv_path, NEW.semnatar1_id, NEW.semnatar2_id) IS DISTINCT FROM (OLD.pv_path, OLD.semnatar1_id, OLD.semnatar2_id) THEN
    RAISE EXCEPTION 'redari: PV-ul de plicuire e deja atasat; semnatarii nu se mai schimba' USING ERRCODE = '23514';
  END IF;
  IF NEW.pv_path IS NOT NULL AND OLD.pv_path IS NULL AND (NEW.semnatar1_id IS NULL OR NEW.semnatar2_id IS NULL) THEN
    RAISE EXCEPTION 'redari: PV-ul de plicuire cere ambii semnatari' USING ERRCODE = '23514';
  END IF;
  -- juridic#021: semnatarii sunt utilizatori cu drept pe Redari (owner sau acces explicit la modulul redari)
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.semnatar1_id, NEW.semnatar2_id]) x(uid) WHERE x.uid IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = x.uid AND pr.is_owner)
               AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = x.uid AND a.module = 'redari')) THEN
    RAISE EXCEPTION 'redari: semnatarul PV-ului de plicuire trebuie sa aiba drept pe Redari' USING ERRCODE = '23514';
  END IF;
  IF NEW.pv_path IS NOT NULL AND OLD.pv_path IS NULL AND NOT (NEW.pv_path ~ ('^plicuire/' || NEW.id::text || '/[A-Za-z0-9._-]+\.(pdf|PDF|jpg|JPG|jpeg|JPEG|png|PNG)$')
     AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.pv_path)) THEN
    RAISE EXCEPTION 'redari: PV-ul de plicuire lipseste din Storage (plicuire/<id>/...)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_lot_reguli() FROM PUBLIC, anon, authenticated;

-- Jakarinos r3 P1: numele / adresa / stergerea logica a unui detinator (sau a parcelei lui) dintr-un plic activ neexpediat nu se schimba
-- din aplicatie: plicul se anuleaza intai (si se reface). Mentenanta postgres fara JWT ramane permisa (expedierea reverifica oricum).
CREATE FUNCTION public.fn_red_plic_identitate_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Jakarinos r3 P1 / r4 P1 / r6: protocol comun pentru identitate. Lock-ul UAT-ului (vechi + nou, ordonat, fara asteptare) se ia ÎNTÂI,
-- apoi se citesc / calculeaza cheile VECHE si NOUA, apoi refuz daca: (a) detinatorul e intr-un plic activ neexpediat si identitatea / stergerea
-- se schimba; (b) detinatorul are o convocare postala eligibila si intra (cheie noua sau reactivare) intr-o identitate care are deja plic neexpediat.
DECLARE v_det uuid; v_uat uuid; v_veche text; v_noua text; v_nr text; v_k text; v_reactivat boolean := false;
        v_nume text; v_sters timestamptz; v_c public.red_detinatori_contact; v_mutat boolean := false; v_u uuid;
BEGIN
  IF session_user = 'postgres' AND coalesce(current_setting('request.jwt.claims', true), '') = '' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'red_parcele' THEN
    IF NEW.sters_la IS NOT DISTINCT FROM OLD.sters_la THEN RETURN NEW; END IF;
    v_reactivat := NEW.sters_la IS NULL;
    -- r6: lock-ul UAT-ului înaintea citirii deținătorilor (fără blocări de rând în gardă)
    FOREACH v_u IN ARRAY (SELECT coalesce(array_agg(DISTINCT u ORDER BY u), ARRAY[]::uuid[]) FROM unnest(ARRAY[OLD.uat_id, NEW.uat_id]) u WHERE u IS NOT NULL) LOOP
      PERFORM public.fn_red_plic_incearca_lock(v_u);
    END LOOP;
    FOR v_det IN SELECT d.id FROM public.red_detinatori d WHERE d.parcela_id = OLD.id AND d.sters_la IS NULL ORDER BY d.id LOOP
      v_k := public.fn_red_cheie_persoana(v_det);
      SELECT pl.nr_plic INTO v_nr FROM public.red_convocari c JOIN public.red_plicuri pl ON pl.id = c.plic_id
       WHERE c.detinator_id = v_det AND pl.stare = 'activ' AND pl.data_expediere IS NULL LIMIT 1;
      IF v_nr IS NULL AND v_reactivat AND v_k IS NOT NULL THEN
        SELECT nr_plic INTO v_nr FROM public.red_plicuri WHERE uat_id = OLD.uat_id AND cheie_persoana = v_k AND stare = 'activ' AND data_expediere IS NULL LIMIT 1;
      END IF;
      IF v_nr IS NOT NULL THEN
        RAISE EXCEPTION 'redari: parcela atinge plicul neexpediat %; anuleaza intai plicul', v_nr USING ERRCODE = '23514';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'red_detinatori' THEN
    IF (NEW.nume_normalizat, NEW.sters_la, NEW.parcela_id) IS NOT DISTINCT FROM (OLD.nume_normalizat, OLD.sters_la, OLD.parcela_id) THEN RETURN NEW; END IF;
    v_det := OLD.id;   -- randul e blocat de UPDATE-ul curent; r6: lock-ul UAT-ului vechi + nou (ordonat), apoi contactul se citeste
    FOREACH v_u IN ARRAY (SELECT coalesce(array_agg(DISTINCT p.uat_id ORDER BY p.uat_id), ARRAY[]::uuid[]) FROM public.red_parcele p WHERE p.id IN (OLD.parcela_id, NEW.parcela_id)) LOOP
      PERFORM public.fn_red_plic_incearca_lock(v_u);
    END LOOP;
    SELECT p.uat_id INTO v_uat FROM public.red_parcele p WHERE p.id = NEW.parcela_id;
    SELECT * INTO v_c FROM public.red_detinatori_contact WHERE detinator_id = v_det;
    v_veche := CASE WHEN OLD.sters_la IS NULL THEN public.fn_red_cheie_calc(OLD.nume_normalizat, v_c.adresa_strada, v_c.adresa_sat, v_c.adresa_comuna, v_c.adresa_judet, v_c.cod_postal, v_c.adresa_cunoscuta) END;
    v_noua := CASE WHEN NEW.sters_la IS NULL THEN public.fn_red_cheie_calc(NEW.nume_normalizat, v_c.adresa_strada, v_c.adresa_sat, v_c.adresa_comuna, v_c.adresa_judet, v_c.cod_postal, v_c.adresa_cunoscuta) END;
    v_reactivat := OLD.sters_la IS NOT NULL AND NEW.sters_la IS NULL;
    v_mutat := NEW.parcela_id IS DISTINCT FROM OLD.parcela_id;
  ELSE   -- red_detinatori_contact (INSERT / UPDATE)
    IF TG_OP = 'UPDATE' AND NEW.detinator_id IS DISTINCT FROM OLD.detinator_id THEN
      RAISE EXCEPTION 'redari: contactul nu se muta pe alt detinator' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.adresa_strada, NEW.adresa_sat, NEW.adresa_comuna, NEW.adresa_judet, NEW.cod_postal, NEW.adresa_cunoscuta)
       IS NOT DISTINCT FROM (OLD.adresa_strada, OLD.adresa_sat, OLD.adresa_comuna, OLD.adresa_judet, OLD.cod_postal, OLD.adresa_cunoscuta) THEN RETURN NEW; END IF;
    v_det := NEW.detinator_id;
    -- Jakarinos r6 P1: lock-ul UAT-ului ÎNAINTE de citirea numelui, și pentru deținătorii șterși logic (reactivarea concurentă ia același lock)
    v_uat := public.fn_red_plic_incearca_lock_detinator(v_det);
    SELECT d.nume_normalizat, d.sters_la INTO v_nume, v_sters FROM public.red_detinatori d WHERE d.id = v_det;
    IF v_sters IS NOT NULL THEN v_nume := NULL; END IF;   -- deținător șters: fără identitate poștală (reactivarea trece prin garda deținătorului)
    v_veche := CASE WHEN TG_OP = 'UPDATE' THEN public.fn_red_cheie_calc(v_nume, OLD.adresa_strada, OLD.adresa_sat, OLD.adresa_comuna, OLD.adresa_judet, OLD.cod_postal, OLD.adresa_cunoscuta) END;
    v_noua := public.fn_red_cheie_calc(v_nume, NEW.adresa_strada, NEW.adresa_sat, NEW.adresa_comuna, NEW.adresa_judet, NEW.cod_postal, NEW.adresa_cunoscuta);
  END IF;
  -- (a) membru al unui plic neexpediat: identitatea / stergerea nu se schimba
  IF v_veche IS DISTINCT FROM v_noua OR v_mutat THEN
    SELECT pl.nr_plic INTO v_nr FROM public.red_convocari c JOIN public.red_plicuri pl ON pl.id = c.plic_id
     WHERE c.detinator_id = v_det AND pl.stare = 'activ' AND pl.data_expediere IS NULL LIMIT 1;
    IF v_nr IS NOT NULL THEN
      RAISE EXCEPTION 'redari: detinatorul e in plicul neexpediat %; anuleaza intai plicul (numele / adresa / stergerea schimba plicuirea)', v_nr USING ERRCODE = '23514';
    END IF;
  END IF;
  -- (b) intrarea intr-o identitate care are deja plic neexpediat (cheie noua diferita sau reactivare), cu convocare postala eligibila
  IF v_noua IS NOT NULL AND v_uat IS NOT NULL AND (v_noua IS DISTINCT FROM v_veche OR v_reactivat)
     AND EXISTS (SELECT 1 FROM public.red_convocari c WHERE c.detinator_id = v_det AND c.canal = 'posta' AND c.stare = 'activ'
                   AND c.sters_la IS NULL AND c.plic_id IS NULL AND c.data_expediere IS NULL) THEN
    SELECT nr_plic INTO v_nr FROM public.red_plicuri WHERE uat_id = v_uat AND cheie_persoana = v_noua AND stare = 'activ' AND data_expediere IS NULL LIMIT 1;
    IF v_nr IS NOT NULL THEN
      RAISE EXCEPTION 'redari: noua identitate (nume + adresa) are deja plicul neexpediat %; anuleaza-l si refa-l cu toate convocarile', v_nr USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_plic_identitate_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_plic_identitate BEFORE UPDATE ON public.red_detinatori FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_identitate_garda();
CREATE TRIGGER trg_red_plic_identitate BEFORE INSERT OR UPDATE ON public.red_detinatori_contact FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_identitate_garda();
CREATE TRIGGER trg_red_plic_identitate BEFORE UPDATE ON public.red_parcele FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_identitate_garda();

CREATE TRIGGER trg_red_plic_reguli BEFORE INSERT OR UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_reguli();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_plic_propaga AFTER UPDATE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_plic_propaga();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_plicuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_lot_reguli BEFORE INSERT OR UPDATE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_lot_reguli();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_loturi_plicuire FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();



-- Creează un plic din convocări (toate: active, poștale, fără plic, neexpediate, același proiect, același UAT, aceeași persoană).
CREATE FUNCTION public.fn_red_plic_creeaza(p_proiect_id uuid, p_convocari uuid[]) RETURNS public.red_plicuri
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_n integer; v_uat uuid; v_uat3 text; v_chei text[]; v_nr integer; v_plic public.red_plicuri; v_nume text; v_gasite integer;
        v_cheie0 text; v_uat0 uuid; v_lipsa integer; v_exista text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari: fara drept de plicuire' USING ERRCODE = '42501'; END IF;
  IF p_proiect_id IS NULL OR p_convocari IS NULL OR cardinality(p_convocari) = 0 OR cardinality(p_convocari) > 200 THEN
    RAISE EXCEPTION 'redari: lista de convocari invalida (1..200)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_convocari) x) <> cardinality(p_convocari) THEN RAISE EXCEPTION 'redari: convocari duplicate in lista' USING ERRCODE = '22023'; END IF;
  -- r1 P1 / r6: serializare pe UAT (advisory lock), inainte de blocarea randurilor; doua plicuiri in acelasi UAT se asteapta
  SELECT public.fn_red_cheie_persoana(c.detinator_id), p.uat_id INTO v_cheie0, v_uat0
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = p_convocari[1];
  IF v_cheie0 IS NULL OR v_uat0 IS NULL THEN
    RAISE EXCEPTION 'redari: convocarea nu are o persoana cu adresa cunoscuta (nume + adresa)' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('red_plic_uat:' || v_uat0::text, 0));   -- r6: lock-ul UAT-ului (vezi protocolul)
  -- după lock, cheia și UAT-ul primei convocări se recitesc (o gardă comisă între timp e acum vizibilă)
  SELECT public.fn_red_cheie_persoana(c.detinator_id), p.uat_id INTO v_cheie0, v_uat0
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE c.id = p_convocari[1];
  -- blocare în ordine fixă (id), ca două plicuiri concurente să nu se blocheze reciproc
  PERFORM 1 FROM public.red_convocari WHERE id = ANY(p_convocari) ORDER BY id FOR UPDATE;
  -- Jakarinos r3 P1: identitatea (nume + adresa) se stabilizeaza: detinatorii si contactele lor blocate FOR SHARE pana la commit
  -- (o schimbare de nume/adresa asteapta, apoi e refuzata de garda de identitate fiindca persoana are plic)
  PERFORM 1 FROM public.red_detinatori d WHERE d.id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.id = ANY(p_convocari)) ORDER BY d.id FOR SHARE;
  PERFORM 1 FROM public.red_detinatori_contact k WHERE k.detinator_id IN (SELECT c.detinator_id FROM public.red_convocari c WHERE c.id = ANY(p_convocari)) ORDER BY k.detinator_id FOR SHARE;
  -- Jakarinos r4 P2: si parcelele, inainte de validarea eligibilitatii (o stergere logica concurenta asteapta si apoi e refuzata de garda)
  PERFORM 1 FROM public.red_parcele p WHERE p.id IN (SELECT d.parcela_id FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id WHERE c.id = ANY(p_convocari)) ORDER BY p.id FOR SHARE;
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
  IF v_chei[1] IS DISTINCT FROM v_cheie0 OR v_uat IS DISTINCT FROM v_uat0 THEN
    RAISE EXCEPTION 'redari: numele / adresa s-au schimbat in timpul plicuirii; reincercati' USING ERRCODE = 'P0001';
  END IF;
  -- r1 P1: plicul cuprinde TOATE convocarile eligibile ale persoanei din UAT (nu se fac plicuri partiale)
  SELECT count(*) INTO v_lipsa
    FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE p.proiect_id = p_proiect_id AND p.uat_id = v_uat AND p.sters_la IS NULL AND d.sters_la IS NULL
     AND c.stare = 'activ' AND c.sters_la IS NULL AND c.canal = 'posta' AND c.plic_id IS NULL AND c.data_expediere IS NULL
     AND NOT (c.id = ANY(p_convocari)) AND public.fn_red_cheie_persoana(c.detinator_id) = v_chei[1];
  IF v_lipsa > 0 THEN
    RAISE EXCEPTION 'redari: plicul trebuie sa cuprinda toate convocarile persoanei din UAT (lipsesc %)', v_lipsa USING ERRCODE = 'P0001';
  END IF;
  SELECT nr_plic INTO v_exista FROM public.red_plicuri WHERE proiect_id = p_proiect_id AND uat_id = v_uat AND cheie_persoana = v_chei[1] AND stare = 'activ' AND data_expediere IS NULL;
  IF v_exista IS NOT NULL THEN
    RAISE EXCEPTION 'redari: persoana are deja plicul neexpediat %; anuleaza-l si refa-l cu toate convocarile', v_exista USING ERRCODE = 'P0001';
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
REVOKE ALL ON public.red_plicuri, public.red_loturi_plicuire FROM PUBLIC, anon, authenticated, service_role;   -- privilegiile implicite Supabase dau ALL
-- INSERT doar prin RPC; fără DELETE / TRUNCATE nici pentru service_role (Jakarinos r1 P1-03: BYPASSRLS ar ocoli RPC-ul și regulile de INSERT)
GRANT SELECT, UPDATE ON public.red_plicuri, public.red_loturi_plicuire TO authenticated, service_role;
CREATE POLICY red_plicuri_sel ON public.red_plicuri FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_plicuri_upd ON public.red_plicuri FOR UPDATE TO authenticated
  USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_loturi_plicuire_sel ON public.red_loturi_plicuire FOR SELECT TO authenticated USING (public.fn_red_nivel() IS NOT NULL);
CREATE POLICY red_loturi_plicuire_upd ON public.red_loturi_plicuire FOR UPDATE TO authenticated
  USING (public.fn_red_nivel() IN ('admin', 'editor')) WITH CHECK (public.fn_red_nivel() IN ('admin', 'editor'));

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_plicuri', 'red_loturi_plicuire')) <> 4 THEN RAISE EXCEPTION '20261129i: politici'; END IF;
  -- Jakarinos r2 P3: toate cele trei privilegii, pe ambele tabele, pentru ambele roluri; sarea fara niciun drept
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['authenticated', 'service_role']) r, unnest(ARRAY['public.red_plicuri', 'public.red_loturi_plicuire']) t,
               unnest(ARRAY['INSERT', 'DELETE', 'TRUNCATE']) pr WHERE has_table_privilege(r, t, pr))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r WHERE has_table_privilege(r, 'public.red_plic_sare', 'SELECT')) THEN
    RAISE EXCEPTION '20261129i: drepturi prea largi (INSERT/DELETE/TRUNCATE sau sare)';
  END IF;
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
