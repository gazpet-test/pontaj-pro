-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261025a — normative-scan-lunar v10: scan în bucăți (decizia Răzvan B, 12.10.2026)
-- Problema: v9 rula toate loturile într-o singură invocare și era omorâtă la limita EdgeRuntime.waitUntil (~400s).
-- Obiecte NOI (nu atinge date existente):
--   * tabelul public.normative_scan_rulari — progresul unei rulări (lot curent, verdicte acumulate, erori, consum,
--     note_la / mail_la). RLS pornit, fără politici; anon/authenticated fără drepturi; service_role DOAR SELECT
--     (scrierile trec numai prin funcțiile de mai jos, ca owner).
--   * funcțiile fn_norm_scan_porneste / fn_norm_scan_ia_lot / fn_norm_scan_salveaza_lot / fn_norm_scan_ia_final
--     (SECURITY DEFINER, EXECUTE doar service_role) — folosite DOAR de edge-ul normative-scan-lunar.
--     Idempotență: o rulare deschisă per mod (index unic parțial); lotul se ia cu lease; salvarea cere lot_curent
--     neschimbat (fără dublu-append); notele și mailul se iau o singură dată (note_la / mail_la).
--   * jobul pg_cron normative_scan_continua (*/10) — plasă de siguranță: apelează edge-ul cu {"continua":true}
--     DOAR dacă există o rulare deschisă blocată (fără progres de 8 minute). Altfel nu face niciun apel HTTP.
--     Secretul x-norm-secret se citește din Vault (norm_scan_secret) la rulare, nu e în textul jobului.
-- Jobul 39 (normative_scan_lunar, 1 ale lunii 05:00 UTC) NU se schimbă: rămâne punctul de start.
-- Revenire: supabase/revenire/20261025a_normative_scan_rulari_ROLLBACK.sql (șterge jobul, funcțiile, tabelul).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261025a_normative_scan_rulari:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261025a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.normative_scan_rulari') IS NOT NULL
     OR to_regprocedure('public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer)') IS NOT NULL
     OR to_regprocedure('public.fn_norm_scan_ia_lot(bigint,integer)') IS NOT NULL
     OR to_regprocedure('public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_norm_scan_ia_final(bigint,text,integer)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua') THEN
    RAISE EXCEPTION '20261025a: obiectele exista deja';
  END IF;
  IF to_regclass('public.ofertare_normative') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_normative' AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION '20261025a: ofertare_normative.id (bigint) lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_lunar') THEN
    RAISE EXCEPTION '20261025a: jobul normative_scan_lunar lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'norm_scan_secret') THEN
    RAISE EXCEPTION '20261025a: secretul norm_scan_secret lipseste din Vault';
  END IF;
END $pre$;

CREATE TABLE public.normative_scan_rulari (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test           boolean NOT NULL,
  stare          text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'finalizat', 'abandonat')),
  azi            date NOT NULL,
  ref_scan       date,
  acte_ids       bigint[] NOT NULL,
  marime_lot     integer NOT NULL CHECK (marime_lot BETWEEN 1 AND 20),
  nr_loturi      integer NOT NULL CHECK (nr_loturi BETWEEN 0 AND 100),
  lot_curent     integer NOT NULL DEFAULT 0,
  incercari_lot  integer NOT NULL DEFAULT 0,
  lease_pana     timestamptz,
  verdicte       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(verdicte) = 'array'),
  erori          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(erori) = 'array'),
  cautari        integer NOT NULL DEFAULT 0,
  tok_in         bigint NOT NULL DEFAULT 0,
  tok_out        bigint NOT NULL DEFAULT 0,
  note_la        timestamptz,
  note_scrise    integer,
  mail_la        timestamptz,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),
  CHECK (lot_curent BETWEEN 0 AND nr_loturi),
  CHECK (nr_loturi = ceil(cardinality(acte_ids)::numeric / marime_lot))
);
COMMENT ON TABLE public.normative_scan_rulari IS 'Progresul rularilor normative-scan-lunar v10 (12.10.2026): un lot per invocare. Doar service_role (SELECT); scrieri prin fn_norm_scan_*.';
CREATE UNIQUE INDEX normative_scan_rulari_o_deschisa ON public.normative_scan_rulari (test) WHERE stare = 'in_curs';
ALTER TABLE public.normative_scan_rulari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.normative_scan_rulari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.normative_scan_rulari TO service_role;
DO $seq$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', pg_get_serial_sequence('public.normative_scan_rulari', 'id'));
END $seq$;

-- Pornire: abandonează rularea deschisă mai veche de 24h (blocată), apoi reia rularea deschisă a modului sau creează una.
CREATE FUNCTION public.fn_norm_scan_porneste(p_test boolean, p_azi date, p_ref_scan date, p_acte bigint[], p_marime integer, p_nr_loturi integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_test IS NULL OR p_azi IS NULL OR p_acte IS NULL OR cardinality(p_acte) > 100 OR p_marime IS NULL OR p_nr_loturi IS NULL THEN
    RAISE EXCEPTION 'fn_norm_scan_porneste: argumente invalide';
  END IF;
  UPDATE public.normative_scan_rulari SET stare = 'abandonat', lease_pana = NULL, actualizat_la = now()
   WHERE test = p_test AND stare = 'in_curs' AND creat_la < now() - interval '24 hours';
  SELECT to_jsonb(r) || jsonb_build_object('nou', false) INTO v FROM public.normative_scan_rulari r WHERE r.test = p_test AND r.stare = 'in_curs';
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.normative_scan_rulari AS r (test, azi, ref_scan, acte_ids, marime_lot, nr_loturi)
  VALUES (p_test, p_azi, p_ref_scan, p_acte, p_marime, p_nr_loturi)
  ON CONFLICT (test) WHERE stare = 'in_curs' DO NOTHING
  RETURNING to_jsonb(r) || jsonb_build_object('nou', true) INTO v;
  IF v IS NULL THEN  -- cursă cu altă pornire: o reluăm pe a ei
    SELECT to_jsonb(r) || jsonb_build_object('nou', false) INTO v FROM public.normative_scan_rulari r WHERE r.test = p_test AND r.stare = 'in_curs';
  END IF;
  RETURN v;
END
$f$;

-- Ia lotul curent cu lease (doar dacă nu e luat sau lease-ul a expirat). NULL = nimic de luat.
CREATE FUNCTION public.fn_norm_scan_ia_lot(p_run bigint, p_lease_sec integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_lease_sec IS NULL OR p_lease_sec NOT BETWEEN 60 AND 900 THEN RAISE EXCEPTION 'fn_norm_scan_ia_lot: lease invalid'; END IF;
  UPDATE public.normative_scan_rulari r
     SET lease_pana = now() + make_interval(secs => p_lease_sec), incercari_lot = incercari_lot + 1, actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent < r.nr_loturi
     AND (r.lease_pana IS NULL OR r.lease_pana < now())
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Salvează lotul p_lot și avansează. Reușește O SINGURĂ DATĂ per lot (lot_curent = p_lot). NULL = deja salvat de altcineva.
CREATE FUNCTION public.fn_norm_scan_salveaza_lot(p_run bigint, p_lot integer, p_verdicte jsonb, p_erori jsonb,
                                                 p_cautari integer, p_tok_in bigint, p_tok_out bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF jsonb_typeof(p_verdicte) IS DISTINCT FROM 'array' OR jsonb_typeof(p_erori) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_verdicte) > 20 OR jsonb_array_length(p_erori) > 5
     OR octet_length(p_verdicte::text) > 32768 OR octet_length(p_erori::text) > 4096 THEN
    RAISE EXCEPTION 'fn_norm_scan_salveaza_lot: argumente invalide';
  END IF;
  UPDATE public.normative_scan_rulari r
     SET verdicte = r.verdicte || p_verdicte, erori = r.erori || p_erori,
         cautari = r.cautari + GREATEST(COALESCE(p_cautari, 0), 0),
         tok_in = r.tok_in + GREATEST(COALESCE(p_tok_in, 0), 0), tok_out = r.tok_out + GREATEST(COALESCE(p_tok_out, 0), 0),
         lot_curent = r.lot_curent + 1, incercari_lot = 0, lease_pana = NULL, actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = p_lot AND r.lot_curent < r.nr_loturi
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Pașii finali, fiecare luat O SINGURĂ DATĂ, doar după ultimul lot:
--   'note' — doar rularea reală; marchează note_la;
--   'mail' — după note (sau direct, la test); marchează mail_la + note_scrise și închide rularea (finalizat).
CREATE FUNCTION public.fn_norm_scan_ia_final(p_run bigint, p_pas text, p_note_scrise integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_pas = 'note' THEN
    UPDATE public.normative_scan_rulari r SET note_la = now(), actualizat_la = now()
     WHERE r.id = p_run AND r.stare = 'in_curs' AND NOT r.test AND r.lot_curent = r.nr_loturi AND r.note_la IS NULL
    RETURNING to_jsonb(r) INTO v;
  ELSIF p_pas = 'mail' THEN
    UPDATE public.normative_scan_rulari r
       SET mail_la = now(), note_scrise = COALESCE(p_note_scrise, r.note_scrise), stare = 'finalizat', actualizat_la = now()
     WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = r.nr_loturi AND r.mail_la IS NULL
       AND (r.test OR r.note_la IS NOT NULL)
    RETURNING to_jsonb(r) INTO v;
  ELSE
    RAISE EXCEPTION 'fn_norm_scan_ia_final: pas invalid';
  END IF;
  RETURN v;
END
$f$;

REVOKE ALL ON FUNCTION public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_norm_scan_ia_lot(bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_norm_scan_ia_final(bigint,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_norm_scan_ia_lot(bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_norm_scan_ia_final(bigint,text,integer) TO service_role;

-- Plasa de siguranță: la 10 minute, DOAR dacă o rulare deschisă stă fără progres de 8 minute (lanț rupt sau
-- invocare omorâtă). Fără rulare blocată, SELECT-ul nu întoarce rânduri și nu se face niciun apel HTTP.
SELECT cron.schedule('normative_scan_continua', '*/10 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/normative-scan-lunar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-norm-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'norm_scan_secret')
    ),
    body := '{"continua":true}'::jsonb,
    timeout_milliseconds := 30000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.normative_scan_rulari
     WHERE stare = 'in_curs' AND actualizat_la < now() - interval '8 minutes'
       AND (lease_pana IS NULL OR lease_pana < now())
  );
$cmd$);

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.normative_scan_rulari'::regclass)
     OR has_table_privilege('anon', 'public.normative_scan_rulari', 'SELECT')
     OR has_table_privilege('authenticated', 'public.normative_scan_rulari', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.normative_scan_rulari', 'SELECT')
     OR has_table_privilege('service_role', 'public.normative_scan_rulari', 'INSERT')
     OR has_table_privilege('service_role', 'public.normative_scan_rulari', 'UPDATE')
     OR has_table_privilege('service_role', 'public.normative_scan_rulari', 'DELETE')
     OR has_table_privilege('service_role', 'public.normative_scan_rulari', 'TRUNCATE')
     OR has_any_column_privilege('service_role', 'public.normative_scan_rulari', 'UPDATE')
     OR has_function_privilege('anon', 'public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_norm_scan_porneste(boolean,date,date,bigint[],integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_norm_scan_ia_lot(bigint,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_norm_scan_ia_lot(bigint,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_norm_scan_ia_lot(bigint,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_norm_scan_salveaza_lot(bigint,integer,jsonb,jsonb,integer,bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_norm_scan_ia_final(bigint,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_norm_scan_ia_final(bigint,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_norm_scan_ia_final(bigint,text,integer)', 'EXECUTE')
     OR has_sequence_privilege('anon', pg_get_serial_sequence('public.normative_scan_rulari', 'id'), 'USAGE')
     OR has_sequence_privilege('authenticated', pg_get_serial_sequence('public.normative_scan_rulari', 'id'), 'USAGE') THEN
    RAISE EXCEPTION '20261025a: postconditie drepturi';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'normative_scan_continua' AND schedule = '*/10 * * * *'
        AND command ILIKE '%decrypted_secrets%' AND command ILIKE '%normative_scan_rulari%') <> 1 THEN
    RAISE EXCEPTION '20261025a: postconditie cron';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261025a_normative_scan_rulari:' || txid_current() THEN
    RAISE EXCEPTION '20261025a: garda final invalida';
  END IF;
END $post$;
