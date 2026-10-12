-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261025b — normative-scan-lunar v10: scan în bucăți (decizia Răzvan B, 12.10.2026) — r3 după Copilot NO-GO r1/r2
-- r3: lease-urile (lot și final) au token de proprietar (uuid); salvarea/eliberarea/confirmarea cer tokenul curent.
-- Problema: v9 rula toate loturile într-o singură invocare și era omorâtă la limita EdgeRuntime.waitUntil (~400s).
-- Obiecte NOI (nu atinge date existente):
--   * tabelul public.normative_scan_rulari — progresul unei rulări (lot curent, verdicte acumulate, erori, consum,
--     note_la / mail_la = pași TERMINAȚI). RLS pornit, fără politici; anon/authenticated fără drepturi;
--     service_role DOAR SELECT (scrierile trec numai prin funcțiile de mai jos, ca owner).
--   * 8 funcții fn_norm_scan_* (SECURITY DEFINER, EXECUTE doar service_role) — folosite DOAR de edge-ul normative-scan-lunar
--     și (fn_norm_scan_blocata) de jobul-plasă. Idempotență:
--       - o rulare deschisă per mod (index unic parțial);
--       - lotul se ia cu lease; salvarea cere lot_curent neschimbat (fără dublu-append); un eșec trecător al AI
--         eliberează lease-ul fără să avanseze (reîncercare, max. 3 — Copilot P1-3);
--       - finalul (note + mail) se ia cu lease separat (final_lease_pana); note_la se pune DOAR după ce notele sunt
--         scrise, mailul se poate trimite DOAR după note_la, mail_la DOAR după ce Resend a acceptat; un eșec eliberează
--         lease-ul pentru reîncercare (max. 3, apoi stare mail_esuat) — Copilot P1-1;
--   * jobul pg_cron normative_scan_continua (*/10) — plasă de siguranță: apelează edge-ul cu {"continua":true}
--     DOAR dacă fn_norm_scan_blocata() găsește o rulare blocată; edge-ul continuă EXACT acea rulare, după
--     aceleași criterii (Copilot P1-2). Altfel nu face niciun apel HTTP.
--     Secretul x-norm-secret se citește din Vault (norm_scan_secret) la rulare, nu e în textul jobului.
-- Jobul 39 (normative_scan_lunar, 1 ale lunii 05:00 UTC) NU se schimbă: rămâne punctul de start.
-- Revenire: supabase/revenire/20261025b_normative_scan_rulari_ROLLBACK.sql (șterge jobul, funcțiile, tabelul).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261025b_normative_scan_rulari:' || txid_current() THEN
    RAISE EXCEPTION '20261025b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261025b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.normative_scan_rulari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_continua') THEN
    RAISE EXCEPTION '20261025b: obiectele exista deja';
  END IF;
  IF to_regclass('public.ofertare_normative') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_normative' AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION '20261025b: ofertare_normative.id (bigint) lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'normative_scan_lunar') THEN
    RAISE EXCEPTION '20261025b: jobul normative_scan_lunar lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'norm_scan_secret') THEN
    RAISE EXCEPTION '20261025b: secretul norm_scan_secret lipseste din Vault';
  END IF;
END $pre$;

CREATE TABLE public.normative_scan_rulari (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test             boolean NOT NULL,
  stare            text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'finalizat', 'mail_esuat', 'abandonat')),
  azi              date NOT NULL,
  ref_scan         date,
  acte_ids         bigint[] NOT NULL,
  marime_lot       integer NOT NULL CHECK (marime_lot BETWEEN 1 AND 20),
  nr_loturi        integer NOT NULL CHECK (nr_loturi BETWEEN 0 AND 100),
  lot_curent       integer NOT NULL DEFAULT 0,
  incercari_lot    integer NOT NULL DEFAULT 0,
  lease_pana       timestamptz,
  lease_token      uuid,                  -- proprietarul lease-ului de lot (Copilot P2-2)
  verdicte         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(verdicte) = 'array'),
  erori            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(erori) = 'array'),
  cautari          integer NOT NULL DEFAULT 0,
  tok_in           bigint NOT NULL DEFAULT 0,
  tok_out          bigint NOT NULL DEFAULT 0,
  final_lease_pana timestamptz,
  final_token      uuid,                  -- proprietarul lease-ului final (Copilot P2-1)
  final_incercari  integer NOT NULL DEFAULT 0,
  note_la          timestamptz,           -- notele SCRISE (pas terminat)
  note_scrise      integer,
  mail_la          timestamptz,           -- mailul ACCEPTAT de Resend (pas terminat)
  creat_la         timestamptz NOT NULL DEFAULT now(),
  actualizat_la    timestamptz NOT NULL DEFAULT now(),
  CHECK (lot_curent BETWEEN 0 AND nr_loturi),
  CHECK (nr_loturi = ceil(cardinality(acte_ids)::numeric / marime_lot)),
  CHECK (mail_la IS NULL OR test OR note_la IS NOT NULL),
  CHECK (stare <> 'finalizat' OR mail_la IS NOT NULL)
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
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_test IS NULL OR p_azi IS NULL OR p_acte IS NULL OR cardinality(p_acte) > 100 OR p_marime IS NULL OR p_nr_loturi IS NULL THEN
    RAISE EXCEPTION 'fn_norm_scan_porneste: argumente invalide';
  END IF;
  UPDATE public.normative_scan_rulari SET stare = 'abandonat', lease_pana = NULL, lease_token = NULL, final_lease_pana = NULL, final_token = NULL, actualizat_la = now()
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
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_lease_sec IS NULL OR p_lease_sec NOT BETWEEN 60 AND 900 THEN RAISE EXCEPTION 'fn_norm_scan_ia_lot: lease invalid'; END IF;
  UPDATE public.normative_scan_rulari r
     SET lease_pana = now() + make_interval(secs => p_lease_sec), lease_token = gen_random_uuid(), incercari_lot = incercari_lot + 1, actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent < r.nr_loturi
     AND (r.lease_pana IS NULL OR r.lease_pana < now())
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Salvează lotul p_lot și avansează. Reușește O SINGURĂ DATĂ per lot (lot_curent = p_lot) și DOAR pentru proprietarul
-- lease-ului curent (token). Un lease expirat dar nepreluat de altcineva are încă tokenul valid — salvarea e corectă;
-- odată preluat de altă invocare, tokenul vechi nu mai trece. NULL = nu ești proprietarul / deja salvat.
CREATE FUNCTION public.fn_norm_scan_salveaza_lot(p_run bigint, p_lot integer, p_token uuid, p_verdicte jsonb, p_erori jsonb,
                                                 p_cautari integer, p_tok_in bigint, p_tok_out bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
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
         lot_curent = r.lot_curent + 1, incercari_lot = 0, lease_pana = NULL, lease_token = NULL, actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = p_lot AND r.lot_curent < r.nr_loturi
     AND p_token IS NOT NULL AND r.lease_token = p_token
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Eșec trecător al AI (timeout / 5xx / 429 / rețea): eliberează lease-ul lotului FĂRĂ să avanseze — reîncercare.
-- Consumul încercării ratate se adună totuși (costul a existat).
CREATE FUNCTION public.fn_norm_scan_elibereaza_lot(p_run bigint, p_lot integer, p_token uuid, p_cautari integer, p_tok_in bigint, p_tok_out bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  UPDATE public.normative_scan_rulari r
     SET lease_pana = NULL, lease_token = NULL, actualizat_la = now(),
         cautari = r.cautari + GREATEST(COALESCE(p_cautari, 0), 0),
         tok_in = r.tok_in + GREATEST(COALESCE(p_tok_in, 0), 0), tok_out = r.tok_out + GREATEST(COALESCE(p_tok_out, 0), 0)
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = p_lot AND p_token IS NOT NULL AND r.lease_token = p_token
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Ia finalul (note + mail) cu lease separat, doar după ultimul lot și doar cât mailul nu e trimis. NULL = nimic de luat.
CREATE FUNCTION public.fn_norm_scan_ia_final(p_run bigint, p_lease_sec integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_lease_sec IS NULL OR p_lease_sec NOT BETWEEN 60 AND 900 THEN RAISE EXCEPTION 'fn_norm_scan_ia_final: lease invalid'; END IF;
  UPDATE public.normative_scan_rulari r
     SET final_lease_pana = now() + make_interval(secs => p_lease_sec), final_token = gen_random_uuid(), final_incercari = final_incercari + 1, actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = r.nr_loturi AND r.mail_la IS NULL
     AND (r.final_lease_pana IS NULL OR r.final_lease_pana < now())
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Notele au fost SCRISE de PROPRIETARUL lease-ului final (token). Doar rularea reală, o singură dată.
CREATE FUNCTION public.fn_norm_scan_note_gata(p_run bigint, p_token uuid, p_note_scrise integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  UPDATE public.normative_scan_rulari r SET note_la = now(), note_scrise = GREATEST(COALESCE(p_note_scrise, 0), 0), actualizat_la = now()
   WHERE r.id = p_run AND r.stare = 'in_curs' AND NOT r.test AND r.lot_curent = r.nr_loturi AND r.note_la IS NULL
     AND p_token IS NOT NULL AND r.final_token = p_token
  RETURNING to_jsonb(r) INTO v;
  RETURN v;
END
$f$;

-- Rezultatul trimiterii mailului, DOAR de la proprietarul lease-ului final (token; o invocare care și-a pierdut lease-ul
-- nu poate nici confirma, nici elibera lease-ul alteia — Copilot P2-1): ok → mail_la + finalizat; eșec → eliberează lease-ul final (reîncercare) sau,
-- după p_max încercări, stare mail_esuat (rularea nu stă deschisă la nesfârșit).
CREATE FUNCTION public.fn_norm_scan_mail_rezultat(p_run bigint, p_token uuid, p_ok boolean, p_max integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_token IS NULL OR p_ok IS NULL OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'fn_norm_scan_mail_rezultat: argumente invalide'; END IF;
  IF p_ok THEN
    UPDATE public.normative_scan_rulari r SET mail_la = now(), stare = 'finalizat', final_lease_pana = NULL, final_token = NULL, actualizat_la = now()
     WHERE r.id = p_run AND r.stare = 'in_curs' AND r.lot_curent = r.nr_loturi AND r.mail_la IS NULL
       AND r.final_token = p_token AND (r.test OR r.note_la IS NOT NULL)
    RETURNING to_jsonb(r) INTO v;
  ELSE
    UPDATE public.normative_scan_rulari r
       SET final_lease_pana = NULL, final_token = NULL, actualizat_la = now(),
           stare = CASE WHEN r.final_incercari >= p_max THEN 'mail_esuat' ELSE r.stare END
     WHERE r.id = p_run AND r.stare = 'in_curs' AND r.mail_la IS NULL AND r.final_token = p_token
    RETURNING to_jsonb(r) INTO v;
  END IF;
  RETURN v;
END
$f$;

-- Rularea blocată pe care o reia plasa: deschisă, sub 24h, fără progres de 8 minute, fără lease activ (lot sau final).
-- Aceeași funcție decide și dacă jobul face apelul HTTP, și ce rulare continuă edge-ul (Copilot P1-2).
CREATE FUNCTION public.fn_norm_scan_blocata()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT r.id FROM public.normative_scan_rulari r
   WHERE r.stare = 'in_curs' AND r.creat_la > now() - interval '24 hours'
     AND r.actualizat_la < now() - interval '8 minutes'
     AND (r.lease_pana IS NULL OR r.lease_pana < now())
     AND (r.final_lease_pana IS NULL OR r.final_lease_pana < now())
   ORDER BY r.actualizat_la, r.id
   LIMIT 1
$f$;

DO $drepturi$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $drepturi$;

-- Plasa de siguranță: la 10 minute, DOAR dacă fn_norm_scan_blocata() găsește o rulare blocată (lanț rupt, invocare
-- omorâtă, mail eșuat). Fără rulare blocată, SELECT-ul nu întoarce rânduri și nu se face niciun apel HTTP.
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
  WHERE public.fn_norm_scan_blocata() IS NOT NULL;
$cmd$);

DO $post$
DECLARE f regprocedure; n integer := 0;
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
     OR has_sequence_privilege('anon', pg_get_serial_sequence('public.normative_scan_rulari', 'id'), 'USAGE')
     OR has_sequence_privilege('authenticated', pg_get_serial_sequence('public.normative_scan_rulari', 'id'), 'USAGE') THEN
    RAISE EXCEPTION '20261025b: postconditie drepturi tabel';
  END IF;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname LIKE 'fn\_norm\_scan\_%' LOOP
    n := n + 1;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE')
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = f)
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION '20261025b: postconditie functie %', f;
    END IF;
  END LOOP;
  IF n <> 8 THEN RAISE EXCEPTION '20261025b: asteptat 8 functii fn_norm_scan_*, sunt %', n; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'normative_scan_continua' AND schedule = '*/10 * * * *'
        AND command ILIKE '%decrypted_secrets%' AND command ILIKE '%fn_norm_scan_blocata()%') <> 1 THEN
    RAISE EXCEPTION '20261025b: postconditie cron';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261025b_normative_scan_rulari:' || txid_current() THEN
    RAISE EXCEPTION '20261025b: garda final invalida';
  END IF;
END $post$;
