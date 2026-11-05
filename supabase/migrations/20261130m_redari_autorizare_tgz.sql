-- Version 20261130150000. Runner supplies one transaction.
-- 20261130m_redari_autorizare_tgz — Redări: autorizarea scrisă Transgaz (art. 28 alin. (2) GDPR) pe proiect; deblochează informarea GDPR (#939).
-- Decizia lui Răzvan, 05.11.2026: informarea completă (pagina /redari/informare + versoul convocatorului) se deblochează AUTOMAT când owner-ul
-- încarcă autorizarea Transgaz în ⚙️ Setări proiect (nr. + dată + PDF). Fără document nu există deblocare manuală.
-- Ce face:
--   • red_proiecte: autorizare_tgz_nr (text), autorizare_tgz_data (date), autorizare_tgz_fisier (calea PDF-ului în bucket-ul `redari`),
--     autorizare_tgz_de (uuid) + autorizare_tgz_la (timestamptz) = cine și când a schimbat-o (scrise doar de server).
--   • CHECK de formă pe cale: `<cod proiect>/autorizare_tgz/<nume>.pdf` (fără „..”, fără subfoldere).
--   • trg_red_autorizare_tgz (BEFORE INSERT OR UPDATE): cele trei câmpuri le schimbă DOAR owner-ul (profiles.is_owner, fn_sms_e_owner);
--     calea trebuie să existe în storage.objects (bucket redari) și să înceapă cu codul proiectului; _de / _la se pun de server.
--     Mentenanța (sesiune SQL directă ca postgres, fără claims JWT) trece, ca la 20261130h.
--   • fn_red_informare_publicata(cod) → boolean: proiect activ + nr + dată + PDF existent. Singura informație expusă public (anon): da / nu.
--     Pagina publică /redari/informare o folosește pentru banda „PROIECT” + noindex; nu întoarce niciun câmp al autorizării.
-- Politicile, privilegiile (authenticated are drepturi la nivel de tabel pe red_proiecte, deci și pe coloanele noi; RLS = fn_red_nivel() = 'admin'
-- la UPDATE) și jurnalul (fn_red_jurnal) NU se ating.
-- Revenire: supabase/revenire/20261130m_redari_autorizare_tgz_ROLLBACK.sql. DRY: supabase/tests/20261130m_redari_autorizare_tgz_dryrun.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130m_redari_autorizare_tgz:' || txid_current() THEN
    RAISE EXCEPTION '20261130m: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_proiecte') IS NULL OR to_regprocedure('public.fn_sms_e_owner()') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL THEN
    RAISE EXCEPTION '20261130m: lipseste schema Redari / SMS (red_proiecte / fn_sms_e_owner / fn_red_nivel)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%') THEN
    RAISE EXCEPTION '20261130m: coloanele autorizare_tgz_* exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_autorizare_tgz_garda()') IS NOT NULL OR to_regprocedure('public.fn_red_informare_publicata(text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261130m: functiile exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari') THEN RAISE EXCEPTION '20261130m: lipseste bucket-ul redari'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.red_proiecte', 'UPDATE') OR has_table_privilege('anon', 'public.red_proiecte', 'SELECT') THEN
    RAISE EXCEPTION '20261130m: privilegiile pe red_proiecte nu mai sunt cele din 20261126a';
  END IF;
END $pre$;

ALTER TABLE public.red_proiecte
  ADD COLUMN autorizare_tgz_nr text NULL CONSTRAINT red_proiecte_autorizare_tgz_nr_forma CHECK (autorizare_tgz_nr IS NULL OR length(btrim(autorizare_tgz_nr)) BETWEEN 1 AND 100),
  ADD COLUMN autorizare_tgz_data date NULL,
  ADD COLUMN autorizare_tgz_fisier text NULL CONSTRAINT red_proiecte_autorizare_tgz_fisier_forma
    CHECK (autorizare_tgz_fisier IS NULL OR (length(autorizare_tgz_fisier) <= 300 AND autorizare_tgz_fisier ~ '^[A-Za-z0-9_-]+/autorizare_tgz/[A-Za-z0-9_.-]+[.]pdf$' AND position('..' IN autorizare_tgz_fisier) = 0)),
  ADD COLUMN autorizare_tgz_de uuid NULL,
  ADD COLUMN autorizare_tgz_la timestamptz NULL;
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_nr IS 'Nr. autorizării scrise Transgaz (art. 28 alin. (2) GDPR, sub-împuterniciți). Doar owner-ul (trg_red_autorizare_tgz). 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_data IS 'Data autorizării Transgaz (art. 28). Doar owner-ul. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_fisier IS 'Calea PDF-ului autorizării în bucket-ul redari: <cod>/autorizare_tgz/<nume>.pdf; trebuie să existe în storage. Doar owner-ul. Nr + dată + PDF = informarea GDPR publicată (fn_red_informare_publicata). 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_de IS 'Cine a schimbat ultima dată autorizarea Transgaz (auth.uid()); scris doar de trg_red_autorizare_tgz. 20261130m.';
COMMENT ON COLUMN public.red_proiecte.autorizare_tgz_la IS 'Când s-a schimbat ultima dată autorizarea Transgaz; scris doar de trg_red_autorizare_tgz. 20261130m.';

CREATE FUNCTION public.fn_red_autorizare_tgz_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_jwt boolean := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}') <> '{}';
  v_schimbat boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_schimbat := NEW.autorizare_tgz_nr IS NOT NULL OR NEW.autorizare_tgz_data IS NOT NULL OR NEW.autorizare_tgz_fisier IS NOT NULL;
  ELSE
    v_schimbat := NEW.autorizare_tgz_nr IS DISTINCT FROM OLD.autorizare_tgz_nr OR NEW.autorizare_tgz_data IS DISTINCT FROM OLD.autorizare_tgz_data
               OR NEW.autorizare_tgz_fisier IS DISTINCT FROM OLD.autorizare_tgz_fisier;
  END IF;
  -- mentenanta (sesiune SQL directa ca postgres, fara claims): trece neschimbat, inclusiv _de / _la.
  -- session_user, nu current_user: in SECURITY DEFINER current_user e mereu proprietarul functiei.
  IF NOT v_jwt AND session_user = 'postgres' THEN RETURN NEW; END IF;
  IF NOT v_schimbat THEN
    -- _de / _la nu se scriu de mana
    IF TG_OP = 'INSERT' THEN NEW.autorizare_tgz_de := NULL; NEW.autorizare_tgz_la := NULL;
    ELSE NEW.autorizare_tgz_de := OLD.autorizare_tgz_de; NEW.autorizare_tgz_la := OLD.autorizare_tgz_la; END IF;
    RETURN NEW;
  END IF;
  IF NOT public.fn_sms_e_owner() THEN
    RAISE EXCEPTION 'red_proiecte: autorizarea Transgaz (art. 28) o schimba doar owner-ul' USING ERRCODE = '42501';
  END IF;
  IF NEW.autorizare_tgz_fisier IS NOT NULL THEN
    IF split_part(NEW.autorizare_tgz_fisier, '/', 1) IS DISTINCT FROM NEW.cod THEN
      RAISE EXCEPTION 'red_proiecte: PDF-ul autorizarii trebuie sa stea sub codul proiectului (%/autorizare_tgz/...)', NEW.cod USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = NEW.autorizare_tgz_fisier) THEN
      RAISE EXCEPTION 'red_proiecte: PDF-ul autorizarii nu exista in storage (bucket redari)' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.autorizare_tgz_de := auth.uid();
  NEW.autorizare_tgz_la := now();
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_autorizare_tgz_garda() IS 'Redări: trigger pe red_proiecte — autorizarea Transgaz (art. 28) o schimbă doar owner-ul; PDF-ul trebuie să existe în storage sub codul proiectului; _de / _la puse de server. 20261130m.';
REVOKE ALL ON FUNCTION public.fn_red_autorizare_tgz_garda() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_autorizare_tgz BEFORE INSERT OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_autorizare_tgz_garda();

CREATE FUNCTION public.fn_red_informare_publicata(p_cod text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce((
    SELECT p.activ IS TRUE AND nullif(btrim(p.autorizare_tgz_nr), '') IS NOT NULL AND p.autorizare_tgz_data IS NOT NULL AND p.autorizare_tgz_fisier IS NOT NULL
       AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'redari' AND o.name = p.autorizare_tgz_fisier)
    FROM public.red_proiecte p WHERE p.cod = p_cod), false)
$fn$;
COMMENT ON FUNCTION public.fn_red_informare_publicata(text) IS 'Redări: informarea GDPR a proiectului e publicată = proiect activ + autorizarea Transgaz (art. 28) completă (nr + dată + PDF existent). Public (anon): întoarce DOAR true / false. 20261130m.';
REVOKE ALL ON FUNCTION public.fn_red_informare_publicata(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_red_informare_publicata(text) TO anon, authenticated, service_role;

DO $post$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name LIKE 'autorizare_tgz%') <> 5 THEN
    RAISE EXCEPTION '20261130m: coloane';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_autorizare_tgz' AND NOT t.tgisinternal
                 AND t.tgfoid = 'public.fn_red_autorizare_tgz_garda()'::regprocedure) THEN
    RAISE EXCEPTION '20261130m: trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_autorizare_tgz_garda()'::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR has_function_privilege('authenticated', 'public.fn_red_autorizare_tgz_garda()', 'EXECUTE') OR has_function_privilege('anon', 'public.fn_red_autorizare_tgz_garda()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130m: functia garda are setari gresite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_informare_publicata(text)'::regprocedure AND prosecdef AND provolatile = 's' AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR NOT has_function_privilege('anon', 'public.fn_red_informare_publicata(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130m: fn_red_informare_publicata are setari gresite';
  END IF;
  -- la aplicare niciun proiect nu are autorizare: informarea ramane nepublicata peste tot
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE public.fn_red_informare_publicata(cod)) THEN RAISE EXCEPTION '20261130m: informare publicata la aplicare'; END IF;
END $post$;
