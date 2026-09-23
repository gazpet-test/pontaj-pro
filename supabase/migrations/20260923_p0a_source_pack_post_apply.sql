-- P0a POST-APPLY (23.09.2026, aplicate în producție imediat după 20260923_p0a_source_pack.sql, ca 3 migrări separate:
-- p0a_source_pack_grants_strict, p0a_source_pack_cand_search_path, p0a_source_pack_indexuri_fk). Fișierul le ține împreună în repo.

-- 1. Grant-urile implicite Supabase (anon = ALL, service_role = ALL) strânse la exact v2.
--    anon: nimic. service_role: fără DELETE/TRUNCATE (TRUNCATE ocolește triggerul de imutabilitate).
REVOKE ALL ON public.ofertare_source_pack FROM anon;
REVOKE ALL ON public.ofertare_source_pack_importuri FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ofertare_source_pack FROM service_role;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, UPDATE ON public.ofertare_source_pack_importuri FROM service_role;
REVOKE REFERENCES, TRIGGER ON public.ofertare_source_pack FROM authenticated;
REVOKE REFERENCES, TRIGGER ON public.ofertare_source_pack_importuri FROM authenticated;

-- 2. Advisor "function_search_path_mutable" pe fn_ofertare_source_pack_cand (SQL IMMUTABLE, fără acces la tabele).
ALTER FUNCTION public.fn_ofertare_source_pack_cand(text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_cand(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_cand(text) TO authenticated, service_role;

-- 3. Advisor "unindexed_foreign_keys" (INFO) pe obiectele noi.
CREATE INDEX IF NOT EXISTS ofertare_source_pack_licitatie_idx ON public.ofertare_source_pack (licitatie_id);
CREATE INDEX IF NOT EXISTS ofertare_source_pack_importuri_pack_idx ON public.ofertare_source_pack_importuri (pack_id);
CREATE INDEX IF NOT EXISTS ofertare_source_pack_importuri_actor_idx ON public.ofertare_source_pack_importuri (actor);
CREATE INDEX IF NOT EXISTS ofertare_cerinte_text_editat_de_idx ON public.ofertare_cerinte (text_editat_de) WHERE text_editat_de IS NOT NULL;
