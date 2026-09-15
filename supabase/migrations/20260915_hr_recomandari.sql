-- 15.09.2026 (task #73, mail Silviu): rubrica „Recomandări" — documente de experiență PER PERSOANĂ
-- (manager de contract, șef de șantier, RTE, ingineri), citite cu AI și oferite motorului de acoperire
-- ca a cincea sursă de catalog (id-uri cu prefix R). Cerințele de „experiență în proiect similar" ale
-- persoanelor nominalizate ieșeau mereu „gol" fiindcă recomandările stăteau doar pe NAS.
CREATE TABLE IF NOT EXISTS public.hr_recomandari (
  id              bigserial PRIMARY KEY,
  employee_id     integer REFERENCES public.employees(id) ON DELETE SET NULL,
  extern_id       integer REFERENCES public.hr_personal_extern(id) ON DELETE SET NULL,
  -- ce spune documentul (completat de AI, corectat de om)
  beneficiar      text,
  obiect_lucrare  text,
  rol             text,               -- rolul persoanei în lucrare: manager de contract / șef de șantier / RTE / inginer execuție ...
  perioada_start  date,
  perioada_end    date,
  valoare_lei     numeric(14,2),
  domenii         text[],             -- ex. {apa-canal, gaze, drumuri}
  nr_document     text,
  data_document   date,
  semnatar        text,               -- cine a semnat recomandarea (funcție + firmă)
  calificativ     text,
  -- urma AI
  text_extras     text,
  ai_json         jsonb,
  ai_confidenta   integer,
  ai_citit_la     timestamptz,
  ai_avertisment  text,               -- ex. numele de pe document nu se potrivește cu persoana
  -- verificarea omului
  verificat       boolean NOT NULL DEFAULT false,
  verificat_de    uuid REFERENCES public.profiles(id),
  verificat_la    timestamptz,
  -- fișierul (bucket documente-personal, cale recomandari/<emp|ext>-<id>/...)
  fisier_path     text,
  fisier_nume     text,
  fisier_mime     text,
  observatii      text,
  activ           boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_recomandari_persoana CHECK (employee_id IS NOT NULL OR extern_id IS NOT NULL)
);
ALTER TABLE public.hr_recomandari ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_recomandari TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_recomandari_id_seq TO authenticated, service_role;
DROP POLICY IF EXISTS hr_recomandari_sel ON public.hr_recomandari;
DROP POLICY IF EXISTS hr_recomandari_mod ON public.hr_recomandari;
CREATE POLICY hr_recomandari_sel ON public.hr_recomandari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY hr_recomandari_mod ON public.hr_recomandari FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_hr_recomandari_emp ON public.hr_recomandari(employee_id) WHERE activ;
CREATE INDEX IF NOT EXISTS idx_hr_recomandari_ext ON public.hr_recomandari(extern_id) WHERE activ;

-- acoperirea poate trimite la o recomandare (a cincea sursă)
ALTER TABLE public.ofertare_acoperire ADD COLUMN IF NOT EXISTS recomandare_id bigint REFERENCES public.hr_recomandari(id) ON DELETE SET NULL;

-- funcția de rescriere atomică învață coloana nouă (restul neschimbat)
CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_rescrie(p_randuri jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[];
  v_id bigint;
  v_conflicte bigint[] := '{}';
  v_scrise bigint[] := '{}';
  r record;
BEGIN
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' THEN
    RAISE EXCEPTION 'p_randuri trebuie sa fie un array JSON';
  END IF;

  SELECT array_agg(DISTINCT (x->>'cerinta_id')::bigint ORDER BY (x->>'cerinta_id')::bigint)
    INTO v_ids
    FROM jsonb_array_elements(p_randuri) x
   WHERE x->>'cerinta_id' IS NOT NULL;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('scrise', '[]'::jsonb, 'conflicte', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.ofertare_cerinte WHERE id = v_id FOR UPDATE;
  END LOOP;

  FOR r IN
    SELECT DISTINCT ON ((x->>'cerinta_id')::bigint)
           (x->>'cerinta_id')::bigint                  AS cerinta_id,
           x->>'mod'                                   AS mod,
           NULLIF(x->>'autorizatie_id','')::bigint     AS autorizatie_id,
           NULLIF(x->>'doc_firma_id','')::bigint       AS doc_firma_id,
           NULLIF(x->>'partener_id','')::bigint        AS partener_id,
           NULLIF(x->>'experienta_id','')::bigint      AS experienta_id,
           NULLIF(x->>'recomandare_id','')::bigint     AS recomandare_id,
           x->>'referinta_text'                        AS referinta_text,
           x->>'status'                                AS status,
           NULLIF(x->>'valabil_la_depunere','')::boolean AS valabil_la_depunere,
           NULLIF(x->>'domeniu_rte','')                AS domeniu_rte
      FROM jsonb_array_elements(p_randuri) x
     WHERE x->>'cerinta_id' IS NOT NULL
     ORDER BY (x->>'cerinta_id')::bigint
  LOOP
    IF EXISTS (SELECT 1 FROM public.ofertare_acoperire
                WHERE cerinta_id = r.cerinta_id AND verificat_pe_scan) THEN
      v_conflicte := v_conflicte || r.cerinta_id;
      CONTINUE;
    END IF;

    UPDATE public.ofertare_acoperire
       SET mod = r.mod, autorizatie_id = r.autorizatie_id, doc_firma_id = r.doc_firma_id,
           partener_id = r.partener_id, experienta_id = r.experienta_id, recomandare_id = r.recomandare_id,
           referinta_text = r.referinta_text, status = r.status,
           valabil_la_depunere = r.valabil_la_depunere, domeniu_rte = r.domeniu_rte, updated_at = now()
     WHERE cerinta_id = r.cerinta_id AND NOT verificat_pe_scan;

    IF NOT FOUND THEN
      INSERT INTO public.ofertare_acoperire
        (cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id, experienta_id, recomandare_id,
         referinta_text, status, valabil_la_depunere, verificat_pe_scan, domeniu_rte)
      VALUES
        (r.cerinta_id, r.mod, r.autorizatie_id, r.doc_firma_id, r.partener_id, r.experienta_id, r.recomandare_id,
         r.referinta_text, r.status, r.valabil_la_depunere, false, r.domeniu_rte);
    END IF;

    v_scrise := v_scrise || r.cerinta_id;
  END LOOP;

  RETURN jsonb_build_object('scrise', to_jsonb(v_scrise), 'conflicte', to_jsonb(v_conflicte));
END;
$function$;
