-- ROLLBACK conservator pentru coada de planșe — NEAPLICAT, numai după GO Răzvan.
-- Oprește înscrierile, claim-urile și rezervările noi. Nu șterge coada sau registrul și nu eliberează costuri.
-- Opriți și workerul înaintea retragerii. Apelurile deja trimise pot regulariza în continuare rezervarea lor.
-- Revenire: restaurați cele trei definiții de mai jos din migrarea propusă; nu recreați tabelele/politicile.
BEGIN;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_inscrie(p_doc_id bigint, p_mod text DEFAULT 'citeste')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object('eroare', 'coada de planșe este dezactivată');
END;
$$;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_ia(p_worker text, p_lease_min int DEFAULT 10)
RETURNS SETOF public.ofertare_plansa_coada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_rezerva(
  p_job_id bigint, p_claim_token uuid, p_suma numeric, p_plafon_zi numeric)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object('ok', false, 'motiv', 'coada dezactivată');
END;
$$;

-- CREATE OR REPLACE păstrează ACL-urile; explicităm în continuare aceleași restricții.
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_coada_inscrie(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_coada_ia(text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_rezerva(bigint, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
COMMIT;
