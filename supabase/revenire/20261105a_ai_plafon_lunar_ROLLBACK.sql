-- REVENIRE 20261105a, doar la cererea lui Răzvan. Întâi retrageți ramura edge E3.
-- Conservă integral registrul și costurile: închide intrările, fără DROP/DELETE de date.
-- Armare în aceeași tranzacție:
-- BEGIN;
-- SELECT set_config('gazpet.revenire_20261105a', 'AI_PLAFON_OPRIT:' || txid_current(), true);
-- apoi acest fișier și COMMIT.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261105a', true) IS DISTINCT FROM 'AI_PLAFON_OPRIT:' || txid_current() THEN
    RAISE EXCEPTION '20261105a: necesita postgres si armare per tranzactie';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') LIKE '%gazpet.revenire_20261105a%') THEN
    RAISE EXCEPTION '20261105a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
END $pre$;
CREATE OR REPLACE FUNCTION public.fn_ai_plafon_rezerva(p_cheie text, p_suma numeric, p_plafon_implicit numeric, p_user uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'plafon_retras' USING ERRCODE = '55000';
END $f$;
REVOKE EXECUTE ON FUNCTION public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid) FROM PUBLIC, anon, authenticated, service_role;
-- Decontarea rămâne disponibilă pentru apelurile deja rezervate/în zbor. Tabelele/RLS/ACL rămân pentru audit.
