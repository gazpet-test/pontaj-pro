-- JAK-V2-02 / V2-J04. Aplicare numai după Jilava 02.10. Fără modificări de date.
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
          ELSIF NOT EXISTS (SELECT 1 FROM public.ofertare_pt_pachet_verificari v
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
REVOKE EXECUTE ON FUNCTION public.fn_pt_pachet_depus_verifica() FROM PUBLIC;
