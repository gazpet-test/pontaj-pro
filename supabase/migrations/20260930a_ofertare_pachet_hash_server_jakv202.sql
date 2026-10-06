-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20260930a — JAK-V2-02 / V2-J04: verificarea SHA-256 pe server a fișierelor pachetului PT (dovezi append-only) + C1–C3
-- (JILAVA_DECIZII A.2, 06.10.2026: cursa INSERT în manifest, ultima verificare decide, manifest imuabil pentru toate rolurile).
-- Fără modificări de date. Reaplicabilă (precondiția acceptă și starea deja-J04).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT, ÎNAINTE de J07.
-- Revenire: 20260930a_ofertare_pachet_hash_server_jakv202_ROLLBACK.sql (dovezile rămân; doar cu pachetele propus/aprobat
--   fără depunere în fereastră — vezi JILAVA_DECIZII L6).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930a_ofertare_pachet_hash_server_jakv202:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

-- Precondiții pinuite pe starea LIVE citită read-only pe 06.10.2026 (pg_proc: md5(prosrc) / SECDEF / search_path / ACL).
DO $pre$
DECLARE d record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.ofertare_pt_pachet') IS NULL OR to_regclass('public.ofertare_pt_pachet_fisiere') IS NULL
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_pt_pachet_fisiere'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'Precondiție 0b: ofertare_pt_pachet / ofertare_pt_pachet_fisiere lipsesc sau manifestul e fără RLS';
  END IF;
  SELECT md5(p.prosrc) AS h, p.prosrc, p.prosecdef, array_to_string(p.proconfig, ',') AS cfg INTO d
    FROM pg_proc p WHERE p.oid = 'public.fn_pt_pachet_depus_verifica()'::regprocedure;
  -- R11 (20260928k) exact cum e live, SAU deja J04 (reaplicare)
  IF NOT (d.h = '2fdd91f228fd49410aa4c7f971037f1f' OR position('ofertare_pt_pachet_verificari' in d.prosrc) > 0)
     OR d.prosecdef IS NOT TRUE OR d.cfg IS DISTINCT FROM 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_pt_pachet_depus_verifica diferă de R11 live (md5 %) — cineva a schimbat-o; recitește înainte de livrare', d.h;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pt_pachet_depus_verifica' AND tgrelid = 'public.ofertare_pt_pachet'::regclass) THEN
    RAISE EXCEPTION 'Precondiție 0d: triggerul trg_pt_pachet_depus_verifica lipsește';
  END IF;
  IF to_regprocedure('public.fn_are_acces_ofertare()') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0e: fn_are_acces_ofertare lipsește (policy-ul de citire a verificărilor depinde de ea)';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.ofertare_pt_pachet_verificari (
  id bigserial PRIMARY KEY,
  pachet_fisier_id bigint NOT NULL REFERENCES public.ofertare_pt_pachet_fisiere(id) ON DELETE RESTRICT,
  bucket text NOT NULL,
  fisier_path text NOT NULL,
  obj_id uuid NOT NULL,
  obj_updated_at timestamptz NOT NULL,
  obj_etag text,
  obj_size bigint NOT NULL,
  sha256_calculat text NOT NULL CHECK (sha256_calculat ~ '^[0-9a-f]{64}$'),
  sha256_declarat text NOT NULL,
  rezultat text NOT NULL CHECK (rezultat IN ('PASS','REFUZ')),
  motiv text,
  verificat_de uuid,
  verificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_pt_verificari_pass_chk CHECK (rezultat <> 'PASS' OR (
    bucket = 'ofertare' AND btrim(fisier_path) <> '' AND obj_size > 0
    AND obj_id <> '00000000-0000-0000-0000-000000000000'::uuid
    AND sha256_calculat = sha256_declarat))
);
CREATE INDEX IF NOT EXISTS ofertare_pt_verificari_fisier_idx
  ON public.ofertare_pt_pachet_verificari(pachet_fisier_id) WHERE rezultat = 'PASS';
ALTER TABLE public.ofertare_pt_pachet_verificari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_pt_pachet_verificari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_pt_pachet_verificari TO authenticated;
GRANT SELECT, INSERT ON public.ofertare_pt_pachet_verificari TO service_role;
REVOKE ALL ON SEQUENCE public.ofertare_pt_pachet_verificari_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.ofertare_pt_pachet_verificari_id_seq TO service_role;
DROP POLICY IF EXISTS ofertare_pt_verificari_select ON public.ofertare_pt_pachet_verificari;
CREATE POLICY ofertare_pt_verificari_select ON public.ofertare_pt_pachet_verificari
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));

CREATE OR REPLACE FUNCTION public.fn_pt_verificari_imuabile()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  RAISE EXCEPTION 'Verificările pachetului sunt append-only: % interzis.', TG_OP USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_pt_verificari_imuabile() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_pt_verificari_imuabile ON public.ofertare_pt_pachet_verificari;
CREATE TRIGGER trg_pt_verificari_imuabile BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.ofertare_pt_pachet_verificari FOR EACH STATEMENT EXECUTE FUNCTION public.fn_pt_verificari_imuabile();

-- Lista extrasă din aprobaPachet / inregistreazaDepunere (OfertarePropunere.jsx).
CREATE OR REPLACE FUNCTION public.fn_pt_fisier_cere_verificare(p_rol text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $f$
  SELECT p_rol IN ('propunere_docx','borderou_docx','depus_final','dovada_seap')
$f$;
REVOKE ALL ON FUNCTION public.fn_pt_fisier_cere_verificare(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pt_fisier_path_obligatoriu()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN
  IF public.fn_pt_fisier_cere_verificare(NEW.rol) AND nullif(btrim(NEW.fisier_path), '') IS NULL THEN
    RAISE EXCEPTION 'Fișierul %: fisier_path obligatoriu pentru rolul %.', NEW.nume, NEW.rol USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_pt_fisier_path_obligatoriu() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_pt_fisier_path_obligatoriu ON public.ofertare_pt_pachet_fisiere;
CREATE TRIGGER trg_pt_fisier_path_obligatoriu BEFORE INSERT ON public.ofertare_pt_pachet_fisiere
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_fisier_path_obligatoriu();

-- Identitatea de administrare (ca la garda J05, 20261001a): conexiune directă fără claims JWT, ca postgres / supabase_admin
-- (migrări, SQL editor). Doar ea poate repara manifestul; service_role (edge-uri, scripturi cu cheia de serviciu) NU.
CREATE OR REPLACE FUNCTION public.fn_pt_manifest_administrare()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_claims jsonb;
BEGIN
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  RETURN coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role') IS NULL
     AND coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub') IS NULL
     AND session_user IN ('postgres', 'supabase_admin');
END $f$;
REVOKE ALL ON FUNCTION public.fn_pt_manifest_administrare() FROM PUBLIC, anon, authenticated, service_role;

-- C1 (JILAVA_DECIZII A.2, constatarea JX-C1): un INSERT în manifest concurent cu tranziția aprobat→depus trecea de RLS-ul R11
-- (snapshot-ul vedea încă „aprobat”, FK-ul ia doar FOR KEY SHARE). Acum fiecare INSERT blochează pachetul FOR SHARE — intră în
-- conflict cu UPDATE-ul tranziției, deci așteaptă COMMIT-ul ei — și recitește starea COMISĂ: același contract ca R11
-- (propus: orice rol, aprobat: doar depus_final / dovada_seap), dar pentru TOATE rolurile, inclusiv service_role.
CREATE OR REPLACE FUNCTION public.fn_pt_fisier_insert_stare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_stare text;
BEGIN
  SELECT p.stare INTO v_stare FROM public.ofertare_pt_pachet p WHERE p.id = NEW.pachet_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF;                     -- FK-ul refuză oricum
  IF v_stare = 'propus' OR (v_stare = 'aprobat' AND NEW.rol IN ('depus_final', 'dovada_seap')) THEN RETURN NEW; END IF;
  IF public.fn_pt_manifest_administrare() THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Manifestul pachetului % e închis (stare %): fișierul % cu rolul % nu mai poate fi adăugat.', NEW.pachet_id, v_stare, NEW.nume, NEW.rol
    USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_pt_fisier_insert_stare() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_pt_fisier_insert_stare ON public.ofertare_pt_pachet_fisiere;
CREATE TRIGGER trg_pt_fisier_insert_stare BEFORE INSERT ON public.ofertare_pt_pachet_fisiere
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_fisier_insert_stare();

-- C3 (JILAVA_DECIZII A.2, constatarea JX-C3): manifestul era append-only doar prin GRANT pentru authenticated; service_role
-- (GRANT ALL) putea rescrie sha256 A→B și obține PASS pe alți bytes fără pachet nou. Acum UPDATE e refuzat pentru toți,
-- iar DELETE doar cât pachetul e „propus” (sau în cascadă, când pachetul însuși dispare — aplicația șterge pachetul propus
-- la o aprobare eșuată). Excepție: identitatea de administrare de mai sus (reparații documentate).
CREATE OR REPLACE FUNCTION public.fn_pt_fisier_imuabil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_stare text;
BEGIN
  IF public.fn_pt_manifest_administrare() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT p.stare INTO v_stare FROM public.ofertare_pt_pachet p WHERE p.id = OLD.pachet_id;
    IF NOT FOUND OR v_stare = 'propus' THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Manifestul pachetului % e append-only: % pe fișierul % interzis (un manifest nou = pachet nou).', OLD.pachet_id, TG_OP, OLD.nume
    USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_pt_fisier_imuabil() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_pt_fisier_imuabil ON public.ofertare_pt_pachet_fisiere;
CREATE TRIGGER trg_pt_fisier_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_pt_pachet_fisiere
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_fisier_imuabil();

-- storage nu este schemă PostgREST publică. Snapshot read-only, fără bucket/cale arbitrare.
CREATE OR REPLACE FUNCTION public.ofertare_pt_fisier_snapshot(p_fisier_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
  SELECT jsonb_build_object('id', o.id, 'bucket_id', o.bucket_id, 'name', o.name,
    'updated_at', o.updated_at, 'metadata', o.metadata)
  FROM public.ofertare_pt_pachet_fisiere f
  JOIN storage.objects o ON o.bucket_id = 'ofertare' AND o.name = f.fisier_path
  WHERE f.id = p_fisier_id AND public.fn_pt_fisier_cere_verificare(f.rol)
$f$;
REVOKE ALL ON FUNCTION public.ofertare_pt_fisier_snapshot(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_pt_fisier_snapshot(bigint) TO service_role;

-- Versiunea 20260928k, cu verificarea identității/bytes adăugată; R12/R5/matricea rămân intacte.
CREATE OR REPLACE FUNCTION public.fn_pt_pachet_depus_verifica()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_f record; o record; v_size numeric; v_motiv text;
BEGIN
  IF NEW.stare = 'depus' AND OLD.stare IS DISTINCT FROM 'depus' THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'depus_final') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără fișierele efectiv depuse în SEAP (rol depus_final, cu SHA-256).' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'dovada_seap') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără dovada depunerii din SEAP (rol dovada_seap).' USING ERRCODE = 'P0001';
    END IF;
    FOR v_f IN SELECT pf.* FROM public.ofertare_pt_pachet_fisiere pf
      WHERE pf.pachet_id = NEW.id AND public.fn_pt_fisier_cere_verificare(pf.rol) ORDER BY pf.id
    LOOP
      v_motiv := NULL;
      IF nullif(btrim(v_f.fisier_path), '') IS NULL THEN
        v_motiv := 'fisier_path lipsă';
      ELSE
        -- Împiedică UPDATE/DELETE concurent al metadatelor până la commit-ul tranziției.
        SELECT * INTO o FROM storage.objects WHERE bucket_id = 'ofertare' AND name = v_f.fisier_path FOR SHARE;
        IF NOT FOUND THEN
          v_motiv := 'obiect inexistent în bucket-ul ofertare';
        ELSE
          v_size := CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::numeric ELSE NULL END;
          IF v_size IS NULL OR v_size <= 0 THEN
            v_motiv := 'obiect gol sau dimensiune necunoscută';
          -- C2 (JILAVA_DECIZII A.2, 06.10): decide ULTIMA verificare a fișierului, nu „orice PASS” — un REFUZ ulterior
          -- (ex. bytes schimbați sub aceleași metadate) anulează un PASS mai vechi, ca la J07 (ultimul rezultat pe hash).
          ELSIF NOT EXISTS (SELECT 1 FROM (SELECT u.* FROM public.ofertare_pt_pachet_verificari u
              WHERE u.pachet_fisier_id = v_f.id ORDER BY u.id DESC LIMIT 1) v
            WHERE v.pachet_fisier_id = v_f.id AND v.rezultat = 'PASS'
              AND v.bucket = 'ofertare' AND v.fisier_path = v_f.fisier_path
              AND v.sha256_calculat = v_f.sha256 AND v.sha256_declarat = v_f.sha256
              AND v.obj_id = o.id AND v.obj_updated_at = o.updated_at
              AND v.obj_etag IS NOT DISTINCT FROM (o.metadata->>'eTag')
              AND v.obj_size > 0 AND v.obj_size = v_size) THEN
            v_motiv := 'verificare PASS lipsă, SHA diferit sau verificare veche (obiect schimbat)';
          END IF;
        END IF;
      END IF;
      IF v_motiv IS NOT NULL THEN
        RAISE EXCEPTION 'Fișierul %: %.', v_f.nume, v_motiv USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    NEW.depus_la := now();
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_pt_pachet_depus_verifica() FROM PUBLIC, anon, authenticated;   -- live: deja doar postgres + service_role

-- Postcondiții: structura instalată exact (triggere, SECDEF + search_path fix, ACL închis), C1–C3 prezente.
DO $post$
DECLARE f text; t text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fn_pt_pachet_depus_verifica()', 'fn_pt_fisier_insert_stare()', 'fn_pt_fisier_imuabil()',
                           'fn_pt_manifest_administrare()', 'fn_pt_fisier_path_obligatoriu()', 'ofertare_pt_fisier_snapshot(bigint)'] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = ('public.' || f)::regprocedure) IS NOT TRUE
       OR (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = ('public.' || f)::regprocedure) IS DISTINCT FROM 'search_path=public, pg_temp'
       OR has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE')
       OR has_function_privilege('anon', ('public.' || f)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'Postcondiție 1: % nu e SECDEF / search_path fix / închisă pentru anon + authenticated', f;
    END IF;
  END LOOP;
  IF position('ORDER BY u.id DESC LIMIT 1' in (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_pt_pachet_depus_verifica()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Postcondiție 2: C2 (ultima verificare decide) lipsește din fn_pt_pachet_depus_verifica';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'CREATE TRIGGER trg_pt_fisier_insert_stare BEFORE INSERT ON public.ofertare_pt_pachet_fisiere FOR EACH ROW EXECUTE FUNCTION fn_pt_fisier_insert_stare()',
    'CREATE TRIGGER trg_pt_fisier_imuabil BEFORE DELETE OR UPDATE ON public.ofertare_pt_pachet_fisiere FOR EACH ROW EXECUTE FUNCTION fn_pt_fisier_imuabil()',
    'CREATE TRIGGER trg_pt_fisier_path_obligatoriu BEFORE INSERT ON public.ofertare_pt_pachet_fisiere FOR EACH ROW EXECUTE FUNCTION fn_pt_fisier_path_obligatoriu()',
    'CREATE TRIGGER trg_pt_verificari_imuabile BEFORE DELETE OR UPDATE OR TRUNCATE ON public.ofertare_pt_pachet_verificari FOR EACH STATEMENT EXECUTE FUNCTION fn_pt_verificari_imuabile()'] LOOP
    -- pg_get_triggerdef califică funcția cu schema doar dacă „public” nu e în search_path-ul sesiunii: comparăm fără prefix
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                     AND replace(pg_get_triggerdef(oid), 'EXECUTE FUNCTION public.', 'EXECUTE FUNCTION ') = t) THEN
      RAISE EXCEPTION 'Postcondiție 3: trigger lipsă sau diferit: %', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.ofertare_pt_pachet_verificari', 'INSERT')
     OR has_table_privilege('anon', 'public.ofertare_pt_pachet_verificari', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ofertare_pt_pachet_verificari', 'INSERT')
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_pt_pachet_verificari'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'Postcondiție 4: ACL / RLS pe ofertare_pt_pachet_verificari diferite de cele așteptate';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930a_ofertare_pachet_hash_server_jakv202:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260930a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
