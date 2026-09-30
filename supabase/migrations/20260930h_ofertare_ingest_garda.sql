-- Garda citirii automate Ofertare (docs/INGEST_GARDA.md) — condițiile de reluare după incidentul de egress 24–25.09.2026.
-- Contor PERSISTENT pe document: încercări eșuate (backoff exponențial, blocare la plafon), descărcări complete
-- (plafon anti-egress), amprenta ultimei citiri încheiate (sha256 / mărime / etag) pentru scurtcircuit.
-- Blocarea se scoate DOAR de om (owner), cu ofertare_ingest_garda_reactiveaza.
-- ADITIVĂ. NEAPLICATĂ pe live. Rollback: 20260930h_ofertare_ingest_garda_ROLLBACK.sql
-- Constantele oglindesc GARDA din supabase/functions/_shared/gardaIngestLogica.ts (5 eșecuri, 60 s × 2^n ≤ 6 h, 80 descărcări).
BEGIN;

CREATE TABLE IF NOT EXISTS public.ofertare_ingest_garda (
  doc_id            bigint PRIMARY KEY REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  incercari_esuate  int    NOT NULL DEFAULT 0 CHECK (incercari_esuate >= 0),
  descarcari        int    NOT NULL DEFAULT 0 CHECK (descarcari >= 0),
  blocat            boolean NOT NULL DEFAULT false,
  blocat_motiv      text,
  blocat_la         timestamptz,
  urmatoarea_dupa   timestamptz,
  ultima_incercare_la timestamptz,
  ultima_sursa      text,
  ultima_eroare     text,
  ingerat_hash      text,
  ingerat_size      bigint,
  ingerat_etag      text,
  ingerat_la        timestamptz,
  reactivat_de      uuid REFERENCES auth.users(id),
  reactivat_la      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ofertare_ingest_garda_blocat_idx ON public.ofertare_ingest_garda (blocat) WHERE blocat;

ALTER TABLE public.ofertare_ingest_garda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_ingest_garda FROM PUBLIC, anon;
GRANT SELECT ON public.ofertare_ingest_garda TO authenticated;
GRANT ALL ON public.ofertare_ingest_garda TO service_role;
DROP POLICY IF EXISTS ofertare_ingest_garda_select ON public.ofertare_ingest_garda;
CREATE POLICY ofertare_ingest_garda_select ON public.ofertare_ingest_garda FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
-- fără policy de scriere: scrierea doar prin funcțiile de mai jos

-- Notificare owner-i (fără dependență de monitorul de egress, care poate să nu fie aplicat)
CREATE OR REPLACE FUNCTION public.ofertare_ingest_garda_notifica(p_doc_id bigint, p_motiv text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE n int;
BEGIN
  INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
  SELECT p.id, 'ingest_blocat', 'Ofertare', 'Ofertare: citirea automată a unui document a fost BLOCATĂ',
         format('Documentul #%s: %s. Reactivare doar manuală, după verificare.', p_doc_id, left(coalesce(p_motiv, '?'), 300)), '/ofertare'
  FROM profiles p WHERE p.is_owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_ingest_garda_notifica(bigint, text) FROM PUBLIC, anon, authenticated;

-- RPC 1 — ÎNAINTE de descărcare. Atomic (FOR UPDATE). Dacă decizia e 'continua', numără descărcarea.
-- Întoarce {actiune: blocat|asteapta|deja_ingerat|continua, motiv, pana_la, descarcari, incercari_esuate}.
CREATE OR REPLACE FUNCTION public.ofertare_ingest_garda_incearca(p_doc_id bigint, p_size bigint, p_etag text, p_sursa text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE g ofertare_ingest_garda; v_st text; MAX_INC constant int := 5; MAX_DL constant int := 80; v_motiv text;
BEGIN
  INSERT INTO ofertare_ingest_garda (doc_id) VALUES (p_doc_id) ON CONFLICT (doc_id) DO NOTHING;
  SELECT * INTO g FROM ofertare_ingest_garda WHERE doc_id = p_doc_id FOR UPDATE;
  SELECT status_procesare INTO v_st FROM ofertare_documente_atribuire WHERE id = p_doc_id;
  IF g.blocat THEN RETURN jsonb_build_object('actiune','blocat','motiv',coalesce(g.blocat_motiv,'blocat')); END IF;
  IF g.descarcari >= MAX_DL OR g.incercari_esuate >= MAX_INC THEN
    v_motiv := CASE WHEN g.descarcari >= MAX_DL THEN format('plafon de descărcări atins (%s/%s)', g.descarcari, MAX_DL)
                    ELSE format('plafon de încercări eșuate atins (%s/%s)', g.incercari_esuate, MAX_INC) END;
    UPDATE ofertare_ingest_garda SET blocat = true, blocat_motiv = v_motiv, blocat_la = now(), updated_at = now() WHERE doc_id = p_doc_id;
    PERFORM ofertare_ingest_garda_notifica(p_doc_id, v_motiv);
    RETURN jsonb_build_object('actiune','blocat','motiv',v_motiv);
  END IF;
  IF g.urmatoarea_dupa IS NOT NULL AND g.urmatoarea_dupa > now() THEN
    RETURN jsonb_build_object('actiune','asteapta','motiv','backoff după eșec','pana_la',g.urmatoarea_dupa);
  END IF;
  IF v_st IN ('procesat','partial') AND p_size IS NOT NULL AND g.ingerat_size = p_size
     AND p_etag IS NOT NULL AND g.ingerat_etag IS NOT NULL
     AND replace(replace(p_etag,'W/',''),'"','') = replace(replace(g.ingerat_etag,'W/',''),'"','') THEN
    RETURN jsonb_build_object('actiune','deja_ingerat','motiv','același fișier (mărime + etag) a fost deja citit');
  END IF;
  UPDATE ofertare_ingest_garda SET descarcari = descarcari + 1, ultima_incercare_la = now(), ultima_sursa = left(p_sursa, 100), updated_at = now()
   WHERE doc_id = p_doc_id RETURNING * INTO g;
  RETURN jsonb_build_object('actiune','continua','descarcari',g.descarcari,'incercari_esuate',g.incercari_esuate,'ingerat_hash',g.ingerat_hash);
END $f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_incearca(bigint, bigint, text, text) TO service_role;

-- RPC 2 — DUPĂ încercare. ok=true: resetează eșecurile; p_incheiat=true: memorează amprenta citirii.
-- ok=false: eșec +1, backoff 60 s × 2^(n-1) ≤ 6 h, blocare + notificare owner la plafon.
CREATE OR REPLACE FUNCTION public.ofertare_ingest_garda_rezultat(p_doc_id bigint, p_ok boolean, p_incheiat boolean,
  p_hash text, p_size bigint, p_etag text, p_eroare text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE g ofertare_ingest_garda; MAX_INC constant int := 5; MAX_DL constant int := 80; v_motiv text;
BEGIN
  INSERT INTO ofertare_ingest_garda (doc_id) VALUES (p_doc_id) ON CONFLICT (doc_id) DO NOTHING;
  SELECT * INTO g FROM ofertare_ingest_garda WHERE doc_id = p_doc_id FOR UPDATE;
  IF p_ok THEN
    UPDATE ofertare_ingest_garda SET incercari_esuate = 0, urmatoarea_dupa = NULL, ultima_eroare = NULL, updated_at = now(),
      ingerat_hash = CASE WHEN p_incheiat THEN coalesce(p_hash, ingerat_hash) ELSE ingerat_hash END,
      ingerat_size = CASE WHEN p_incheiat THEN coalesce(p_size, ingerat_size) ELSE ingerat_size END,
      ingerat_etag = CASE WHEN p_incheiat THEN coalesce(p_etag, ingerat_etag) ELSE ingerat_etag END,
      ingerat_la   = CASE WHEN p_incheiat THEN now() ELSE ingerat_la END
    WHERE doc_id = p_doc_id RETURNING * INTO g;
  ELSE
    UPDATE ofertare_ingest_garda SET incercari_esuate = incercari_esuate + 1, ultima_eroare = left(p_eroare, 500), updated_at = now(),
      urmatoarea_dupa = now() + make_interval(secs => least(21600, 60 * power(2, incercari_esuate)))
    WHERE doc_id = p_doc_id RETURNING * INTO g;
  END IF;
  IF NOT g.blocat AND (g.incercari_esuate >= MAX_INC OR g.descarcari >= MAX_DL) THEN
    v_motiv := CASE WHEN g.incercari_esuate >= MAX_INC THEN format('%s încercări eșuate consecutive; ultima: %s', g.incercari_esuate, left(coalesce(p_eroare,'?'), 200))
                    ELSE format('plafon de descărcări atins (%s/%s)', g.descarcari, MAX_DL) END;
    UPDATE ofertare_ingest_garda SET blocat = true, blocat_motiv = v_motiv, blocat_la = now() WHERE doc_id = p_doc_id;
    PERFORM ofertare_ingest_garda_notifica(p_doc_id, v_motiv);
    RETURN jsonb_build_object('blocat', true, 'motiv', v_motiv);
  END IF;
  RETURN jsonb_build_object('blocat', g.blocat, 'incercari_esuate', g.incercari_esuate, 'urmatoarea_dupa', g.urmatoarea_dupa);
END $f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_ingest_garda_rezultat(bigint, boolean, boolean, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_rezultat(bigint, boolean, boolean, text, bigint, text, text) TO service_role;

-- RPC 3 — reactivare UMANĂ, doar owner. Resetează contoarele (nu și amprenta citirii).
CREATE OR REPLACE FUNCTION public.ofertare_ingest_garda_reactiveaza(p_doc_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_owner) THEN
    RAISE EXCEPTION 'doar ownerul reactivează citirea automată a unui document blocat';
  END IF;
  UPDATE ofertare_ingest_garda SET blocat = false, blocat_motiv = NULL, incercari_esuate = 0, descarcari = 0,
    urmatoarea_dupa = NULL, reactivat_de = auth.uid(), reactivat_la = now(), updated_at = now()
  WHERE doc_id = p_doc_id;
  RETURN FOUND;
END $f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_ingest_garda_reactiveaza(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_ingest_garda_reactiveaza(bigint) TO authenticated;

COMMIT;
