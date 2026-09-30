-- 20260930h — Salvare atomică a plăților de diurnă (PR2 r4, NEAPLICATĂ — cere GO Copilot + „da” Răzvan)
-- Context: Copilot NO-GO #546 (blocant 4): două sesiuni pot insera amândouă; „insert plată + insert detalii + delete la eroare”
-- e compensare, nu tranzacție. Aici: o singură funcție tranzacțională, lock advisory, idempotență, refuz suprapuneri per angajat,
-- amprentă a datelor aprobate (P0002 la schimbare), defalcarea ÎNREGISTRATĂ la salvare (zile diurnă / zile salariu / sumă salariu / defalcare pe luni) pentru reconciliere fără recalcul.
-- Se aplică DUPĂ închiderea plăților din septembrie 2026 (decizie Răzvan 30.09).

BEGIN;

-- 1. Coloane noi (nullable: istoricul rămâne NEDETERMINAT, nu se recalculează)
ALTER TABLE public.diurna_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS baza_calcul jsonb;                      -- {amprenta, tarif, month_start, month_end, employee_ids_count, versiune_formula, verificat_server_la}
CREATE UNIQUE INDEX IF NOT EXISTS diurna_payments_idempotency_key_uidx
  ON public.diurna_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.diurna_payment_details
  ADD COLUMN IF NOT EXISTS zile_diurna integer,
  ADD COLUMN IF NOT EXISTS zile_salariu integer,
  ADD COLUMN IF NOT EXISTS suma_salariu numeric,
  ADD COLUMN IF NOT EXISTS defalcare_luni jsonb;                   -- [{luna:'2026-09', zile_diurna, suma_diurna, zile_salariu, suma_salariu}]

-- 2. Suprapunere per angajat: o zi a unui angajat nu poate fi în două plăți (defense in depth, sub orice cale de scriere)
CREATE OR REPLACE FUNCTION public.diurna_detalii_fara_suprapunere()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_from date; v_to date; v_conflict integer;
BEGIN
  SELECT period_from, period_to INTO v_from, v_to FROM public.diurna_payments WHERE id = NEW.payment_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'diurna: plata % nu există', NEW.payment_id; END IF;
  SELECT d.payment_id INTO v_conflict
    FROM public.diurna_payment_details d JOIN public.diurna_payments p ON p.id = d.payment_id
   WHERE d.employee_id = NEW.employee_id AND d.payment_id <> NEW.payment_id
     AND daterange(p.period_from, p.period_to, '[]') && daterange(v_from, v_to, '[]')
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'diurna: angajatul % are deja o plată (id %) care se suprapune cu %–%', NEW.employee_id, v_conflict, v_from, v_to
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.diurna_detalii_fara_suprapunere() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_diurna_detalii_fara_suprapunere ON public.diurna_payment_details;
CREATE TRIGGER trg_diurna_detalii_fara_suprapunere
  BEFORE INSERT OR UPDATE OF employee_id, payment_id ON public.diurna_payment_details
  FOR EACH ROW EXECUTE FUNCTION public.diurna_detalii_fara_suprapunere();

-- 3. Amprenta canonică a datelor APROBATE (aceeași formă ca amprentaHash din src/diurneAlocare.js):
--    rânduri pontaj_records pentru angajații din scop, pe lunile ÎNTREGI ale snapshotului, ordonate (employee_id, date, id),
--    fiecare linie `employee_id|YYYY-MM-DD|1/0|norma`, unite cu LF, apoi `\n#tarif=<text>\n#legal=<zile legale asc, virgulă>\n#emps=<id-uri numeric asc, virgulă>`.
--    Hash = sha256 hex peste UTF-8. Clientul o calculează la previzualizare; serverul o recalculează la salvare — orice
--    schimbare de pontaj/CO/tarif/calendar/listă de angajați între cele două momente ⇒ P0002, nimic salvat.
CREATE OR REPLACE FUNCTION public.diurna_amprenta_canonica(
  p_employee_ids integer[], p_month_start date, p_month_end date, p_tarif_text text
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
           SELECT string_agg(
                    r.employee_id::text || '|' || to_char(r.date, 'YYYY-MM-DD') || '|' || CASE WHEN r.diurna IS TRUE THEN '1' ELSE '0' END || '|' || COALESCE(r.norma::text, ''),
                    E'\n' ORDER BY r.employee_id ASC, r.date ASC, r.id ASC)
             FROM public.pontaj_records r
            WHERE r.employee_id = ANY(p_employee_ids) AND r.date BETWEEN p_month_start AND p_month_end), '')
      || E'\n#tarif=' || COALESCE(p_tarif_text, '')
      || E'\n#legal=' || COALESCE((SELECT string_agg(DISTINCT to_char(c.date, 'YYYY-MM-DD'), ',' ORDER BY to_char(c.date, 'YYYY-MM-DD'))
                                     FROM public.calendar_days c WHERE c.type = 'legal' AND c.date BETWEEN p_month_start AND p_month_end), '')
      || E'\n#emps=' || COALESCE((SELECT string_agg(i::text, ',' ORDER BY i) FROM unnest(p_employee_ids) AS i), '')
$$;
REVOKE EXECUTE ON FUNCTION public.diurna_amprenta_canonica(integer[], date, date, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.diurna_amprenta_hash(
  p_employee_ids integer[], p_month_start date, p_month_end date, p_tarif_text text
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(public.diurna_amprenta_canonica(p_employee_ids, p_month_start, p_month_end, p_tarif_text), 'UTF8')), 'hex')
$$;
REVOKE EXECUTE ON FUNCTION public.diurna_amprenta_hash(integer[], date, date, text) FROM PUBLIC;

-- 4. RPC tranzacțional (UI-callable): plată + detalii într-o singură tranzacție, serializat, idempotent, legat de versiunea datelor
DROP FUNCTION IF EXISTS public.diurna_salveaza_plata(date, date, text, jsonb, uuid, jsonb);   -- semnătura schiței anterioare (neaplicată)
CREATE OR REPLACE FUNCTION public.diurna_salveaza_plata(
  p_period_from date, p_period_to date, p_notes text, p_detalii jsonb, p_idempotency_key uuid,
  p_amprenta text, p_employee_ids integer[], p_month_start date, p_month_end date, p_tarif_text text,
  p_baza_calcul jsonb DEFAULT NULL, p_payment_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ok boolean; v_existing integer; v_id integer; v_n integer; v_days integer; v_amount numeric;
        v_amprenta_server text; v_baza jsonb;
BEGIN
  -- poartă de rol (verify_jwt nu ajunge): owner sau salarii
  SELECT (is_owner OR can_access_salarii) INTO v_ok FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'diurna: fără drept de salvare' USING ERRCODE = '42501'; END IF;
  IF p_period_from IS NULL OR p_period_to IS NULL OR p_period_to < p_period_from THEN RAISE EXCEPTION 'diurna: interval invalid'; END IF;
  IF p_month_start IS NULL OR p_month_end IS NULL OR p_month_end < p_month_start THEN RAISE EXCEPTION 'diurna: lunile snapshotului lipsesc sau sunt inversate'; END IF;
  IF p_period_from < p_month_start OR p_period_to > p_month_end THEN
    RAISE EXCEPTION 'diurna: perioada %–% iese din lunile snapshotului %–%', p_period_from, p_period_to, p_month_start, p_month_end;
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'diurna: cheie de idempotență lipsă'; END IF;
  IF p_amprenta IS NULL OR p_amprenta !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'diurna: amprenta datelor lipsă sau invalidă'; END IF;
  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN RAISE EXCEPTION 'diurna: lista de angajați din scop lipsește'; END IF;
  IF p_tarif_text IS NULL OR p_tarif_text !~ '^[0-9]+(\.[0-9]+)?$' OR p_tarif_text::numeric <= 0 THEN RAISE EXCEPTION 'diurna: tarif invalid („%")', p_tarif_text; END IF;
  IF jsonb_typeof(p_detalii) <> 'array' OR jsonb_array_length(p_detalii) = 0 THEN RAISE EXCEPTION 'diurna: fără detalii'; END IF;

  -- un singur scriitor pe diurne o dată (tranzacțional; se eliberează la COMMIT/ROLLBACK)
  PERFORM pg_advisory_xact_lock(hashtext('diurna_payments'));

  -- idempotență: aceeași cheie ⇒ aceeași plată, fără dublare (verificată SUB lock)
  SELECT id INTO v_existing FROM public.diurna_payments WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('payment_id', v_existing, 'inserted', false);
  END IF;

  -- legarea de versiunea APROBATĂ a datelor: amprenta recalculată acum, sub lock, trebuie să fie cea din previzualizare
  v_amprenta_server := public.diurna_amprenta_hash(p_employee_ids, p_month_start, p_month_end, p_tarif_text);
  IF v_amprenta_server <> p_amprenta THEN
    RAISE EXCEPTION 'diurna: datele s-au schimbat de la previzualizare (pontaj/CO/tarif/calendar) — reîncarcă și confirmă din nou'
      USING ERRCODE = 'P0002';
  END IF;

  -- validare detalii: numerice, ≥ 0, angajați unici, din scop, fără text în loc de sumă
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_detalii) e
             WHERE NOT (e ? 'employee_id') OR jsonb_typeof(e->'employee_id') <> 'number'
                OR jsonb_typeof(e->'amount') <> 'number' OR (e->>'amount')::numeric < 0
                OR jsonb_typeof(e->'days') <> 'number' OR (e->>'days')::integer < 0) THEN
    RAISE EXCEPTION 'diurna: detaliu invalid (employee_id/days/amount)';
  END IF;
  IF (SELECT count(*) - count(DISTINCT e->>'employee_id') FROM jsonb_array_elements(p_detalii) e) > 0 THEN
    RAISE EXCEPTION 'diurna: angajat duplicat în detalii';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_detalii) e WHERE NOT ((e->>'employee_id')::integer = ANY(p_employee_ids))) THEN
    RAISE EXCEPTION 'diurna: detaliu pentru un angajat din afara scopului amprentat';
  END IF;

  SELECT count(*), COALESCE(sum((e->>'days')::integer),0), COALESCE(sum((e->>'amount')::numeric),0)
    INTO v_n, v_days, v_amount FROM jsonb_array_elements(p_detalii) e;

  -- baza de calcul înregistrată: ce a trimis clientul + ce a verificat serverul (amprenta, tarif, scop, formula)
  v_baza := COALESCE(p_baza_calcul, '{}'::jsonb) || jsonb_build_object(
    'amprenta', p_amprenta, 'tarif', p_tarif_text, 'month_start', p_month_start, 'month_end', p_month_end,
    'employee_ids_count', cardinality(p_employee_ids), 'versiune_formula', COALESCE(p_baza_calcul->>'versiune_formula', 'r5'),
    'verificat_server_la', now());

  INSERT INTO public.diurna_payments (period_from, period_to, payment_date, total_employees, total_days, total_amount, notes, created_by, idempotency_key, baza_calcul)
  VALUES (p_period_from, p_period_to, COALESCE(p_payment_date, CURRENT_DATE), v_n, v_days, v_amount, p_notes, v_uid, p_idempotency_key, v_baza)
  RETURNING id INTO v_id;

  INSERT INTO public.diurna_payment_details (payment_id, employee_id, employee_name, days, amount, zile_diurna, zile_salariu, suma_salariu, defalcare_luni)
  SELECT v_id, (e->>'employee_id')::integer, COALESCE(e->>'employee_name', em.name), (e->>'days')::integer, (e->>'amount')::numeric,
         (e->>'zile_diurna')::integer, (e->>'zile_salariu')::integer, (e->>'suma_salariu')::numeric, e->'defalcare_luni'
    FROM jsonb_array_elements(p_detalii) e LEFT JOIN public.employees em ON em.id = (e->>'employee_id')::integer;
  -- trigger-ul de suprapunere rulează pe fiecare rând; orice eroare ⇒ ROLLBACK complet (nu rămâne plată fără detalii)

  RETURN jsonb_build_object('payment_id', v_id, 'inserted', true, 'total_employees', v_n, 'total_days', v_days, 'total_amount', v_amount);
END $$;
REVOKE EXECUTE ON FUNCTION public.diurna_salveaza_plata(date, date, text, jsonb, uuid, text, integer[], date, date, text, jsonb, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diurna_salveaza_plata(date, date, text, jsonb, uuid, text, integer[], date, date, text, jsonb, date) TO authenticated;

-- 5. Postcondiții
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_diurna_detalii_fara_suprapunere') THEN RAISE EXCEPTION 'postcondiție: trigger lipsă'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'diurna_salveaza_plata' AND pronamespace = 'public'::regnamespace) <> 1 THEN RAISE EXCEPTION 'postcondiție: RPC lipsă sau semnături multiple'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'diurna_amprenta_hash') THEN RAISE EXCEPTION 'postcondiție: funcția de amprentă lipsă'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'diurna_payment_details' AND column_name = 'defalcare_luni') THEN RAISE EXCEPTION 'postcondiție: coloana defalcare_luni lipsă'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'diurna_payments' AND column_name = 'baza_calcul') THEN RAISE EXCEPTION 'postcondiție: coloana baza_calcul lipsă'; END IF;
  -- amprenta pe scop gol e deterministă (sanity: funcția rulează)
  IF public.diurna_amprenta_hash(ARRAY[]::integer[], DATE '2000-01-01', DATE '2000-01-31', '50') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'postcondiție: amprenta nu produce hex sha256'; END IF;
END $$;

COMMIT;
