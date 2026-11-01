-- 20261123a — Normative: verificare automată pe sursa oficială (decizie Răzvan 01.11.2026, varianta A).
-- normative-scan-lunar v11 citește direct fișa actului de pe legislatie.just.ro („istoric consolidări”) în loc să
-- caute pe web: ultima consolidare > forma confirmată de noi → semnal; egală → „neschimbat”, confirmat automat.
-- Coloane NOI pe public.ofertare_normative (nu atinge date existente; valorile se completează separat, cu preview + „da”):
--   legislatie_doc_id  — N din https://legislatie.just.ro/Public/DetaliiDocument/N (actul de bază)
--   forma_oficiala_la  — data consolidării pe care am confirmat-o noi (baza de comparație)
--   verificat_auto_la  — ultima verificare automată reușită pe sursa oficială
--   verificare_auto    — ce a văzut ultima verificare (consolidarea curentă, numărul de consolidări, sursa)
-- Drepturi: tabelul are deja RLS + politicile lui; coloanele noi le moștenesc. Le scrie doar edge-ul (service_role)
-- și omul care confirmă din UI/SQL.
-- Revenire: supabase/revenire/20261123a_normative_sursa_oficiala_ROLLBACK.sql. Runner: livrare_migrare.sh (fără BEGIN/COMMIT).
DO $migrare$
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
 IS DISTINCT FROM '20261123a_normative_sursa_oficiala:'||txid_current() THEN RAISE EXCEPTION 'NSO numai runner postgres'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.ofertare_normative'::regclass
            AND attname IN ('legislatie_doc_id','forma_oficiala_la','verificat_auto_la','verificare_auto') AND NOT attisdropped)
 THEN RAISE EXCEPTION 'NSO coloanele exista deja'; END IF;
END $migrare$;

ALTER TABLE public.ofertare_normative
  ADD COLUMN legislatie_doc_id bigint CONSTRAINT ofertare_normative_legislatie_doc_id_chk CHECK (legislatie_doc_id > 0),
  ADD COLUMN forma_oficiala_la date,
  ADD COLUMN verificat_auto_la timestamptz,
  ADD COLUMN verificare_auto jsonb;

COMMENT ON COLUMN public.ofertare_normative.legislatie_doc_id IS '20261123a: id DetaliiDocument pe legislatie.just.ro (actul de baza); scanul lunar citeste istoricul consolidarilor de acolo';
COMMENT ON COLUMN public.ofertare_normative.forma_oficiala_la IS '20261123a: data consolidarii confirmate de noi; o consolidare mai noua = semnal de schimbare';
COMMENT ON COLUMN public.ofertare_normative.verificat_auto_la IS '20261123a: ultima verificare automata reusita pe sursa oficiala';
COMMENT ON COLUMN public.ofertare_normative.verificare_auto IS '20261123a: ce a vazut ultima verificare automata (consolidare curenta, nr. consolidari, url)';

-- r2 (Jakarinos P2-7): urma verificării automate o scrie DOAR jobul (service_role) sau un administrator de bază.
-- Un utilizator Ofertare cu drept de UPDATE pe rând nu o poate fabrica (PATCH direct prin API).
-- Funcția e SECURITY INVOKER: current_user = rolul cererii (authenticated / service_role / postgres).
CREATE FUNCTION public.fn_normative_urma_auto_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.verificat_auto_la IS NOT NULL OR NEW.verificare_auto IS NOT NULL THEN
      RAISE EXCEPTION 'verificat_auto_la / verificare_auto se scriu doar de verificarea automată' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.verificat_auto_la IS DISTINCT FROM OLD.verificat_auto_la OR NEW.verificare_auto IS DISTINCT FROM OLD.verificare_auto THEN
    RAISE EXCEPTION 'verificat_auto_la / verificare_auto se scriu doar de verificarea automată' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_normative_urma_auto_garda() FROM PUBLIC;
COMMENT ON FUNCTION public.fn_normative_urma_auto_garda() IS '20261123a r2: urma verificarii automate doar din service_role/postgres';

CREATE TRIGGER trg_normative_urma_auto BEFORE INSERT OR UPDATE ON public.ofertare_normative
FOR EACH ROW EXECUTE FUNCTION public.fn_normative_urma_auto_garda();

-- Postcondiții
DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.ofertare_normative'::regclass
      AND attname IN ('legislatie_doc_id','forma_oficiala_la','verificat_auto_la','verificare_auto') AND NOT attisdropped) <> 4
  THEN RAISE EXCEPTION 'NSO post: coloane lipsa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.ofertare_normative'::regclass AND tgname='trg_normative_urma_auto' AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'NSO post: trigger lipsa'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_normative WHERE legislatie_doc_id IS NOT NULL OR forma_oficiala_la IS NOT NULL
             OR verificat_auto_la IS NOT NULL OR verificare_auto IS NOT NULL)
  THEN RAISE EXCEPTION 'NSO post: date neasteptate in coloanele noi'; END IF;
END $post$;
