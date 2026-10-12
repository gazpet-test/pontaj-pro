-- REVENIRE 20261024b — scoate loturile MVP (stări, legături, poarta, coloanele de lot canonic), dar PĂSTREAZĂ trierea:
-- înainte de orice drop, starea licitațiilor, loturile, clasificarea documentelor, legăturile, jurnalul și lotul canonic
-- de pe cerințe/cantități se copiază ca jsonb în ofertare_loturi_arhiva_revenire (RLS activ, fără politici, fără drepturi API).
-- Codul care cheamă fn_ofertare_eligibilitate / fn_ofertare_document_eligibil trebuie scos ÎNAINTE (altfel pică la runtime).
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261024b', 'OFERTARE_LOTURI_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE
  v_arhiva bigint;
BEGIN
  IF current_setting('gazpet.revenire_20261024b', true) IS DISTINCT FROM 'OFERTARE_LOTURI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261024b=%') THEN
    RAISE EXCEPTION '20261024b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261024b: necesita postgres'; END IF;
  IF to_regclass('public.ofertare_licitatie_loturi') IS NULL THEN RAISE EXCEPTION '20261024b: migrarea nu e aplicata'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── arhiva (se păstrează și după revenire; o a doua revenire adaugă un rând nou) ─────────────────────────
  CREATE TABLE IF NOT EXISTS public.ofertare_loturi_arhiva_revenire (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    la timestamptz NOT NULL DEFAULT now(),
    continut jsonb NOT NULL
  );
  ALTER TABLE public.ofertare_loturi_arhiva_revenire ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.ofertare_loturi_arhiva_revenire FROM PUBLIC, anon, authenticated, service_role;

  INSERT INTO public.ofertare_loturi_arhiva_revenire (continut)
  SELECT jsonb_build_object(
    'licitatii', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'stare_loturi', stare_loturi,
                    'setat_de', stare_loturi_setat_de, 'setat_la', stare_loturi_setat_la) ORDER BY id), '[]'::jsonb)
                    FROM public.ofertare_licitatii WHERE stare_loturi <> 'neinitializat'),
    'loturi', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.licitatie_id, x.nr), '[]'::jsonb) FROM public.ofertare_licitatie_loturi x),
    'documente', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'lot_stare', lot_stare, 'lot_sursa', lot_sursa,
                    'lot_setat_de', lot_setat_de, 'lot_setat_la', lot_setat_la, 'lot_nota', lot_nota) ORDER BY id), '[]'::jsonb)
                    FROM public.ofertare_documente_atribuire WHERE lot_stare <> 'necunoscut' OR lot_nota IS NOT NULL),
    'document_loturi', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.document_id, x.lot_nr), '[]'::jsonb) FROM public.ofertare_document_loturi x),
    'jurnal', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) FROM public.ofertare_loturi_jurnal x),
    'cerinte_lot', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'lot_nr', lot_nr, 'lot_domeniu', lot_domeniu,
                    'lot_sursa', lot_sursa, 'lot_brut', lot_brut) ORDER BY id), '[]'::jsonb)
                    FROM public.ofertare_cerinte WHERE lot_domeniu IS NOT NULL OR lot_nr IS NOT NULL OR lot_sursa IS NOT NULL OR lot_brut IS NOT NULL),
    'cantitati_lot', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'lot_nr', lot_nr, 'lot_domeniu', lot_domeniu,
                    'lot_sursa', lot_sursa, 'lot_brut', lot_brut) ORDER BY id), '[]'::jsonb)
                    FROM public.ofertare_cantitati WHERE lot_domeniu IS NOT NULL OR lot_nr IS NOT NULL OR lot_sursa IS NOT NULL OR lot_brut IS NOT NULL))
  RETURNING id INTO v_arhiva;

  -- ── obiectele noi ─────────────────────────────────────────────────────────────────────────────────────
  DROP VIEW public.v_ofertare_loturi_triere;
  DROP FUNCTION public.fn_ofertare_parse_lot(text);
  DROP FUNCTION public.fn_ofertare_documente_lot_seteaza(bigint[], text, integer[], text);
  DROP FUNCTION public.fn_ofertare_licitatie_loturi_seteaza(bigint, text, jsonb);
  DROP FUNCTION public.fn_ofertare_document_eligibil(bigint);
  DROP FUNCTION public.fn_ofertare_eligibilitate(bigint, bigint);
  DROP TRIGGER trg_ofertare_document_loturi_coerent ON public.ofertare_document_loturi;
  DROP TRIGGER a01_ofertare_cerinte_lot_canonic ON public.ofertare_cerinte;
  DROP TRIGGER a01_ofertare_cantitati_lot_canonic ON public.ofertare_cantitati;
  DROP FUNCTION public.fn_trg_ofertare_lot_canonic();
  DROP FUNCTION public.fn_trg_ofertare_document_loturi_coerent();
  DROP TRIGGER a01_ofertare_doc_lot_garda ON public.ofertare_documente_atribuire;
  DROP TRIGGER a01_ofertare_licitatii_loturi_garda ON public.ofertare_licitatii;
  DROP FUNCTION public.fn_trg_ofertare_loturi_garda();
  DROP FUNCTION public.fn_ofertare_loturi_rpc_marcaj(boolean);
  DROP TABLE public.ofertare_loturi_jurnal;
  DROP TABLE public.ofertare_document_loturi;
  DROP TABLE public.ofertare_licitatie_loturi;

  ALTER TABLE public.ofertare_cantitati
    DROP CONSTRAINT ofertare_cantitati_lot_nr_coerent,
    DROP COLUMN lot_nr, DROP COLUMN lot_domeniu, DROP COLUMN lot_sursa, DROP COLUMN lot_brut;
  ALTER TABLE public.ofertare_cerinte
    DROP CONSTRAINT ofertare_cerinte_lot_nr_coerent,
    DROP COLUMN lot_nr, DROP COLUMN lot_domeniu, DROP COLUMN lot_sursa, DROP COLUMN lot_brut;
  ALTER TABLE public.ofertare_documente_atribuire
    DROP COLUMN lot_stare, DROP COLUMN lot_sursa, DROP COLUMN lot_setat_de, DROP COLUMN lot_setat_la, DROP COLUMN lot_nota;
  ALTER TABLE public.ofertare_licitatii
    DROP COLUMN stare_loturi, DROP COLUMN stare_loturi_setat_de, DROP COLUMN stare_loturi_setat_la;

  RAISE NOTICE '20261024b revenire: arhiva id %', v_arhiva;
  IF current_setting('gazpet.revenire_20261024b', true) IS DISTINCT FROM 'OFERTARE_LOTURI_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261024b', '', true);
END $revenire$;
