-- 20260930h — Salvare atomică a plăților de diurnă (PR2 r4, NEAPLICATĂ — cere GO Copilot + „da” Răzvan)
-- Context: Copilot NO-GO #546 (blocant 4): două sesiuni pot insera amândouă; „insert plată + insert detalii + delete la eroare”
-- e compensare, nu tranzacție. Aici: o singură funcție tranzacțională, lock advisory, idempotență, refuz suprapuneri per angajat,
-- defalcarea ÎNREGISTRATĂ la salvare (zile diurnă / zile salariu / sumă salariu / defalcare pe luni) pentru reconciliere fără recalcul.
-- Se aplică DUPĂ închiderea plăților din septembrie 2026 (decizie Răzvan 30.09).

BEGIN;

-- 1. Coloane noi (nullable: istoricul rămâne NEDETERMINAT, nu se recalculează)
ALTER TABLE public.diurna_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS baza_calcul jsonb;                      -- {tarif, legal, generat_la, versiune_formula}
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

-- 3. RPC tranzacțional (UI-callable): plată + detalii într-o singură tranzacție, serializat, idempotent
CREATE OR REPLACE FUNCTION public.diurna_salveaza_plata(
  p_period_from date, p_period_to date, p_notes text, p_detalii jsonb, p_idempotency_key uuid, p_baza_calcul jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ok boolean; v_existing integer; v_id integer; v_n integer; v_days integer; v_amount numeric; r jsonb;
BEGIN
  -- poartă de rol (verify_jwt nu ajunge): owner sau salarii
  SELECT (is_owner OR can_access_salarii) INTO v_ok FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'diurna: fără drept de salvare' USING ERRCODE = '42501'; END IF;
  IF p_period_from IS NULL OR p_period_to IS NULL OR p_period_to < p_period_from THEN RAISE EXCEPTION 'diurna: interval invalid'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'diurna: cheie de idempotență lipsă'; END IF;
  IF jsonb_typeof(p_detalii) <> 'array' OR jsonb_array_length(p_detalii) = 0 THEN RAISE EXCEPTION 'diurna: fără detalii'; END IF;

  -- un singur scriitor pe diurne o dată (tranzacțional; se eliberează la COMMIT/ROLLBACK)
  PERFORM pg_advisory_xact_lock(hashtext('diurna_payments'));

  -- idempotență: aceeași cheie ⇒ aceeași plată, fără dublare
  SELECT id INTO v_existing FROM public.diurna_payments WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('payment_id', v_existing, 'inserted', false);
  END IF;

  -- validare detalii: numerice, ≥ 0, angajați unici, fără text în loc de sumă
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_detalii) e
             WHERE NOT (e ? 'employee_id') OR jsonb_typeof(e->'amount') <> 'number' OR (e->>'amount')::numeric < 0
                OR jsonb_typeof(e->'days') <> 'number' OR (e->>'days')::integer < 0) THEN
    RAISE EXCEPTION 'diurna: detaliu invalid (employee_id/days/amount)';
  END IF;
  IF (SELECT count(*) - count(DISTINCT e->>'employee_id') FROM jsonb_array_elements(p_detalii) e) > 0 THEN
    RAISE EXCEPTION 'diurna: angajat duplicat în detalii';
  END IF;

  SELECT count(*), COALESCE(sum((e->>'days')::integer),0), COALESCE(sum((e->>'amount')::numeric),0)
    INTO v_n, v_days, v_amount FROM jsonb_array_elements(p_detalii) e;

  INSERT INTO public.diurna_payments (period_from, period_to, payment_date, total_employees, total_days, total_amount, notes, created_by, idempotency_key, baza_calcul)
  VALUES (p_period_from, p_period_to, CURRENT_DATE, v_n, v_days, v_amount, p_notes, v_uid, p_idempotency_key, p_baza_calcul)
  RETURNING id INTO v_id;

  INSERT INTO public.diurna_payment_details (payment_id, employee_id, employee_name, days, amount, zile_diurna, zile_salariu, suma_salariu, defalcare_luni)
  SELECT v_id, (e->>'employee_id')::integer, COALESCE(e->>'employee_name', em.name), (e->>'days')::integer, (e->>'amount')::numeric,
         (e->>'zile_diurna')::integer, (e->>'zile_salariu')::integer, (e->>'suma_salariu')::numeric, e->'defalcare_luni'
    FROM jsonb_array_elements(p_detalii) e LEFT JOIN public.employees em ON em.id = (e->>'employee_id')::integer;
  -- trigger-ul de suprapunere rulează pe fiecare rând; orice eroare ⇒ ROLLBACK complet (nu rămâne plată fără detalii)

  RETURN jsonb_build_object('payment_id', v_id, 'inserted', true, 'total_employees', v_n, 'total_days', v_days, 'total_amount', v_amount);
END $$;
REVOKE EXECUTE ON FUNCTION public.diurna_salveaza_plata(date, date, text, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diurna_salveaza_plata(date, date, text, jsonb, uuid, jsonb) TO authenticated;

-- 4. Postcondiții
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_diurna_detalii_fara_suprapunere') THEN RAISE EXCEPTION 'postcondiție: trigger lipsă'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'diurna_salveaza_plata') THEN RAISE EXCEPTION 'postcondiție: RPC lipsă'; END IF;
END $$;

COMMIT;
