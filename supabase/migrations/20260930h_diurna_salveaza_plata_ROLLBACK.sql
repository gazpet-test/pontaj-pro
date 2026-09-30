-- ROLLBACK 20260930h — nu șterge coloanele (datele înregistrate rămân; sunt nullable). Doar funcțiile/trigger-ul/indexul.
BEGIN;
DROP TRIGGER IF EXISTS trg_diurna_detalii_fara_suprapunere ON public.diurna_payment_details;
DROP FUNCTION IF EXISTS public.diurna_detalii_fara_suprapunere();
DROP FUNCTION IF EXISTS public.diurna_salveaza_plata(date, date, text, jsonb, uuid, text, integer[], date, date, text, jsonb, date);
DROP FUNCTION IF EXISTS public.diurna_salveaza_plata(date, date, text, jsonb, uuid, jsonb);
DROP FUNCTION IF EXISTS public.diurna_amprenta_hash(integer[], date, date, text);
DROP FUNCTION IF EXISTS public.diurna_amprenta_canonica(integer[], date, date, text);
DROP INDEX IF EXISTS public.diurna_payments_idempotency_key_uidx;
COMMIT;
