-- Schema FALSĂ, minimă, tip Supabase, pentru proba locală a migrării 20270112a (scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs).
-- NU e pentru producție. Roluri ca în Supabase (service_role BYPASSRLS; authenticator NOINHERIT), auth.uid() din request.jwt.claim.sub apoi
-- request.jwt.claims, drepturile implicite ALL pentru rolurile API pe obiectele noi din public (deci migrarea TREBUIE să le retragă).
-- Conține: tabelele pe care migrarea le citește / le modifică, cu coloanele reale (ofertare_licitatii cu stare_loturi (20261024b);
-- ofertare_documente_atribuire cu tip, revizie, text_extras, pagini_necitite, seap_meta, lot_stare; ofertare_document_loturi;
-- ofertare_cantitati cu lot_nr integer[] + lot_domeniu (20261024b) și surse_document_ids (20261025a); ofertare_clarificari cu cheie, origine,
-- sursa, baza_generare, surse_*, nr, UNIQUE (licitatie_id, cheie), FĂRĂ UNIQUE pe nr (migrarea îl adaugă); ofertare_cant_obs /
-- _extrageri / _felii / _doc_decizii / doc_texte / ai_* EXACT din 20261031a) și funcțiile EXISTENTE pe care migrarea le cheamă sau le
-- rescrie, cu corpurile EXACTE (copiate din fișierele sursă, nu retastate; proba t5.1 compară amprentele md5 cu textul acelor fișiere):
--   * fn_are_acces_ofertare (20260912), fn_ofertare_source_pack_poate_decide (20260923), fn_ofertare_poate_cheltui (20261124a);
--   * 20261031a: fn_ofertare_cb_lot_canonic, fn_ofertare_cb_imuabil, fn_ofertare_cb_tranzitie, fn_ofertare_cb_poate, fn_ofertare_cb_felie_reia,
--     fn_ofertare_cb_trg_clarificari (triggerul de jurnal; fn_ofertare_cb_ingheata e stub);
--   * 20261026a: fn_ofertare_surse_valideaza + triggerul a02_ofertare_clarificari_surse (20261025a);
--   * circuitul R9b în ULTIMA formă cunoscută în repo (docs/R5_MIGRARE_3_review_copilot.sql): fn_trg_ofertare_clarificari_baza,
--     ofertare_clarificare_baza_stare, ofertare_clarificare_reconfirma, ofertare_clarificari_export, ofertare_clarificare_exceptie_identitate;
--     ofertare_clarificari_notifica din 20261121a; view-ul v_ofertare_clarificari_baza din docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql;
--     drepturile lor ca în docs/R5_MIGRARE_PROPUSA (baza_stare / reconfirma / notifica / export: authenticated + service_role; excepția: authenticated).
--   * ofertare_f3_baza = STUB determinist (amprenta din rândurile F3; identitate fără contradicții) — baza F3 a ciornelor auto_planse_* nu e
--     testată aici, doar că circuitul lor dă aceleași rezultate ca înainte; v_ofertare_transfer_conflicte nu e necesar stub-ului.
-- Amprentele LIVE din $pre$ al migrării se calculează pe ACESTE corpuri; pe clonă coordonatorul le confirmă (sau dă textul pg_get_functiondef).
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- ca pe producție (pgvector în schema extensions, proba pe clona 176, 26.11.2026): agregate `sum` în afara pg_catalog, cu același nume ca built-in-ul
-- folosit (necalificat) de funcțiile noi; postcondiția lanțului de apel NU trebuie să le confunde cu un apel
CREATE SCHEMA extensions;
CREATE AGGREGATE extensions.sum(text) (SFUNC = textcat, STYPE = text);
CREATE AGGREGATE extensions.sum(bytea) (SFUNC = byteacat, STYPE = bytea);
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL, access_level text NOT NULL,
  PRIMARY KEY (profile_id, module));
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, profile_id uuid, type text, modul text, title text, message text, link_to text,
  created_at timestamptz DEFAULT now());
REVOKE ALL ON public.profiles, public.user_module_access, public.notifications FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;

CREATE TABLE public.ofertare_licitatii (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, nr_anunt text NOT NULL, autoritate text NOT NULL, obiect text NOT NULL, status text NOT NULL DEFAULT 'in_lucru',   -- NOT NULL ca pe producție
  termen_depunere timestamptz, responsabil_id uuid, responsabil2_id uuid, responsabil_setat_de uuid, responsabil_numitor_autorizat boolean,
  responsabil2_setat_de uuid, responsabil2_numitor_autorizat boolean, created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  stare_loturi text NOT NULL DEFAULT 'neinitializat'
    CONSTRAINT ofertare_licitatii_stare_loturi_check CHECK (stare_loturi IN ('neinitializat', 'fara_loturi', 'are_loturi')),
  stare_loturi_setat_de uuid, stare_loturi_setat_la timestamptz
);
ALTER TABLE public.ofertare_licitatii ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_licitatii_select ON public.ofertare_licitatii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.ofertare_licitatii FROM anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_licitatii TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ofertare_source_pack_poate_decide(p_licitatie_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id AND l.responsabil_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare' AND uma.access_level = 'admin')
  );
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) TO authenticated, service_role;
CREATE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_uid IS NOT NULL AND p_licitatie_id IS NOT NULL AND (
    COALESCE((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = p_uid), false)
    OR EXISTS (
      SELECT 1
        FROM public.ofertare_licitatii l
        CROSS JOIN LATERAL (VALUES (l.responsabil_id, l.responsabil_setat_de, l.responsabil_numitor_autorizat),
                                   (l.responsabil2_id, l.responsabil2_setat_de, l.responsabil2_numitor_autorizat)) AS r(resp, numit_de, dovada)
       WHERE l.id = p_licitatie_id
         AND r.resp = p_uid
         AND (
           -- 2A: dovada fixată de trigger la numire (numitorul era owner / admin Ofertare ATUNCI, altcineva decât responsabilul);
           -- rolul curent al numitorului nu mai contează
           (r.dovada IS TRUE AND r.numit_de IS DISTINCT FROM p_uid)
           -- A (Răzvan 01.11): numirile vechi, fără „numit de” și fără dovadă, își păstrează dreptul
           OR (r.dovada IS NULL AND r.numit_de IS NULL)
         )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO service_role;

CREATE TABLE public.ofertare_documente_atribuire (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  nume_original text NOT NULL, tip text NOT NULL DEFAULT 'alta', revizie text, text_extras text, pagini_necitite integer[] NOT NULL DEFAULT '{}',
  -- nume_original și fisier_path: NOT NULL fără default ca pe producție (proba pe clona 176)
  seap_meta jsonb, analiza jsonb, eroare text, fisier_path text NOT NULL, size_bytes bigint, status_procesare text NOT NULL DEFAULT 'neprocesat',
  created_at timestamptz NOT NULL DEFAULT now(),
  lot_stare text NOT NULL DEFAULT 'necunoscut' CONSTRAINT ofertare_documente_lot_stare_check CHECK (lot_stare IN ('necunoscut', 'comun', 'alocat')),
  lot_sursa text, lot_setat_de uuid, lot_setat_la timestamptz, lot_nota text
);
ALTER TABLE public.ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_documente_select ON public.ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_documente_update ON public.ofertare_documente_atribuire FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_insert ON public.ofertare_documente_atribuire FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_delete ON public.ofertare_documente_atribuire FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

CREATE TABLE public.ofertare_licitatie_loturi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  nr integer NOT NULL CHECK (nr BETWEEN 1 AND 999), denumire text, valoare numeric, participam boolean NOT NULL DEFAULT false,
  setat_de uuid, setat_la timestamptz NOT NULL DEFAULT now(), CONSTRAINT ofertare_licitatie_loturi_nr_uq UNIQUE (licitatie_id, nr)
);
CREATE TABLE public.ofertare_document_loturi (
  document_id bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE, licitatie_id bigint NOT NULL, lot_nr integer NOT NULL,
  PRIMARY KEY (document_id, lot_nr),
  CONSTRAINT ofertare_document_loturi_lot_fk FOREIGN KEY (licitatie_id, lot_nr) REFERENCES public.ofertare_licitatie_loturi(licitatie_id, nr) ON DELETE RESTRICT
);
ALTER TABLE public.ofertare_licitatie_loturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_document_loturi ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_licitatie_loturi_select ON public.ofertare_licitatie_loturi FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_document_loturi_select ON public.ofertare_document_loturi FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
REVOKE ALL ON public.ofertare_licitatie_loturi, public.ofertare_document_loturi FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_licitatie_loturi, public.ofertare_document_loturi TO authenticated, service_role;

CREATE TABLE public.ofertare_cantitati (
  id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id), obiect text, categorie text, denumire text NOT NULL,
  um text, cantitate numeric, specificatii text, sursa text, cantitate_plansa numeric, diferenta_nota text, status text NOT NULL DEFAULT 'extras',
  extras_de_ai boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), tip_sursa text, cod_articol text, ordine int,
  lot_nr integer[], lot_domeniu text CONSTRAINT ofertare_cantitati_lot_domeniu_check CHECK (lot_domeniu IS NULL OR lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_sursa text, lot_brut text, surse_document_ids bigint[],
  CONSTRAINT ofertare_cantitati_status_check CHECK (status = ANY (ARRAY['extras', 'validat', 'diferenta', 'revizuit_clarificare'])),
  CONSTRAINT ofertare_cantitati_tip_sursa_check CHECK (tip_sursa = ANY (ARRAY['lista_f3', 'lista_c6', 'lista_alt', 'memoriu', 'plansa', 'caiet', 'alt'])),
  CONSTRAINT ofertare_cantitati_lot_nr_coerent CHECK (CASE WHEN lot_domeniu IS NULL THEN lot_nr IS NULL
    WHEN lot_domeniu = 'lista' THEN coalesce(cardinality(lot_nr), 0) > 0 ELSE lot_nr IS NULL END)
);
ALTER TABLE public.ofertare_cantitati ENABLE ROW LEVEL SECURITY;
CREATE POLICY cant_all ON public.ofertare_cantitati TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
-- ── aprobarea cantităților (ca pe producție, proba pe clona 176, 26.11.2026): un rând VALIDAT a cărui cantitate se schimbă trece pe
--    „diferenta” (triggerul trg_zz_ofertare_cantitati_aprobare); revenirea cifrei NU reface validarea — o reface omul. Corpurile de mai
--    jos sunt textul EXACT de pe producție (pg_get_functiondef, citit 26.11.2026), ca proba PGlite să vadă același comportament.
CREATE TABLE public.ofertare_cantitati_istoric (
  id bigserial PRIMARY KEY, cantitate_id bigint NOT NULL, licitatie_id bigint, motiv text NOT NULL, status_vechi text, status_cerut text, status_nou text,
  campuri text[] NOT NULL DEFAULT '{}'::text[], campuri_sub_prag text[] NOT NULL DEFAULT '{}'::text[], valori_vechi jsonb NOT NULL, valori_noi jsonb,
  aprobare_veche jsonb NOT NULL, nota text, autor uuid, rol text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.ofertare_norm_text(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT lower(btrim(regexp_replace(
    translate(coalesce(p, ''), chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) ||
      chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279), repeat(' ', 19)),
    '[ ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || ']+', ' ', 'g'), ' '));
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_clasa_unitate(p_um text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN u IN ('m','m.','metri','metru','ml','ml.','m.l.','m.l','metri liniari','metru liniar') THEN jsonb_build_object('tip','lungime','factor',1)
    WHEN u = 'km' THEN jsonb_build_object('tip','lungime','factor',1000)
    WHEN u = 'hm' THEN jsonb_build_object('tip','lungime','factor',100)
    WHEN u IN ('mc','m cub','m3','m³','mp','m2','m²','ha','l','litri','buc','bucata','bucati','bucăți','buc.','bc','kg','t','to','h','ore','set','cpl') THEN jsonb_build_object('tip','alta')
    ELSE jsonb_build_object('tip','de_verificat') END
  FROM (SELECT public.ofertare_norm_text(p_um) u) n
$function$
;

CREATE OR REPLACE FUNCTION public.ofertare_cantitati_atribute(p_text text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'dn', (SELECT string_agg(v, '/' ORDER BY o) FROM (SELECT m[1] v, min(o) o FROM regexp_matches(coalesce(p_text, ''), '(?:\mdn|\mde|ø|φ)\s*(\d{2,4})(?!\d)', 'gi') WITH ORDINALITY x(m, o) GROUP BY 1) a),
    'sdr', (SELECT string_agg(v, '/' ORDER BY o) FROM (SELECT replace(m[1], ',', '.') v, min(o) o FROM regexp_matches(coalesce(p_text, ''), '\msdr\s*(\d+(?:[.,]\d+)?)', 'gi') WITH ORDINALITY x(m, o) GROUP BY 1) a),
    'material', (SELECT string_agg(v, '/' ORDER BY o) FROM (VALUES
        (1, CASE WHEN p_text ~* '\mpe\s*-?\s*100(?!\d)' THEN 'PE100' END),
        (2, CASE WHEN p_text ~* '\mpe\s*-?\s*80(?!\d)' THEN 'PE80' END),
        (3, CASE WHEN p_text !~* '\mpe\s*-?\s*(100|80)(?!\d)' AND p_text ~* '\m(pehd|pe)\M' THEN 'PE' END),
        (4, CASE WHEN p_text ~* '\mol\M|o[țţt]el' THEN 'OL' END)) t(o, v) WHERE v IS NOT NULL));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_aprobare()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_campuri constant text[] := ARRAY['licitatie_id','um','cantitate','cantitate_plansa','denumire','specificatii','obiect','categorie','tip_sursa','sursa','cod_articol'];
  c_etichete constant jsonb := '{"licitatie_id":"licitația","um":"unitatea de măsură","cantitate":"cantitatea","cantitate_plansa":"cifra din planșă","denumire":"denumirea","specificatii":"specificațiile","obiect":"obiectul (tronson / etapă)","categorie":"categoria","tip_sursa":"tipul sursei","sursa":"sursa","cod_articol":"codul articolului (poziția din listă)"}';
  c_prefix constant text := 'Rândul era VALIDAT — aprobarea veche';
  c_final constant text := 'validarea se reface.';
  v_old jsonb; v_new jsonb; v_ref jsonb; v_sursa_ref text; k text; a text; b text; r text; v_distinct boolean; v_rel boolean;
  na numeric; nb numeric; nr numeric; ea numeric; eb numeric; v_rel_c text[] := '{}'; v_sub_c text[] := '{}'; v_desc text[] := '{}'; v_der text[] := '{}';
  ta jsonb; tb jsonb; d text; v_motiv text; v_nota text; v_status_cerut text; v_aprob jsonb; v_nou jsonb := '{}';
  v_rol text; v_ref_cant numeric; v_ref_cp numeric; v_ref_um text; v_ref_upd timestamptz;
  -- 1b: severitatea din notă (pereche cu descrieDiferenta din JS) și unitățile afișate
  v_sev text; v_u_vechi text; v_u_nou text; v_dmu numeric; v_amu numeric; v_pct numeric; v_lung boolean; v_semn text;
BEGIN
  BEGIN v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
  EXCEPTION WHEN others THEN v_rol := session_user::text; END;

  IF TG_OP = 'DELETE' THEN
    -- F06: ultima validare identificabilă rămâne referință și după invalidare.
    SELECT jsonb_build_object('istoric_id',h.id,'status','validat','ultima_scriere',h.created_at,
      'cantitate',h.valori_noi->'cantitate','cantitate_plansa',h.valori_noi->'cantitate_plansa',
      'um',h.valori_noi->'um','nota',h.valori_noi->'diferenta_nota')
      INTO v_aprob FROM public.ofertare_cantitati_istoric h
      WHERE h.cantitate_id=OLD.id AND h.motiv='validat' ORDER BY h.id DESC LIMIT 1;
    IF v_aprob IS NULL THEN
      -- Rânduri aprobate înaintea istoricului: invalidarea/redeschiderea păstrează dovada.
      -- Un eveniment unitate_schimbata nu dovedește o aprobare anterioară.
      SELECT coalesce(h.aprobare_veche,'{}'::jsonb) || jsonb_build_object(
        'istoric_id',h.id,'status','validat',
        'ultima_scriere',coalesce(h.aprobare_veche->>'ultima_scriere',h.valori_vechi->>'updated_at'),
        'cantitate',coalesce(h.aprobare_veche->'cantitate',h.valori_vechi->'cantitate'),
        'cantitate_plansa',coalesce(h.aprobare_veche->'cantitate_plansa',h.valori_vechi->'cantitate_plansa'),
        'um',coalesce(h.aprobare_veche->'um',h.valori_vechi->'um'),
        'nota',coalesce(h.aprobare_veche->'nota',h.valori_vechi->'diferenta_nota'))
        INTO v_aprob FROM public.ofertare_cantitati_istoric h
        WHERE h.cantitate_id=OLD.id AND h.motiv IN ('invalidat','redeschis')
          AND (h.aprobare_veche->>'status'='validat' OR h.status_vechi='validat')
        ORDER BY h.id DESC LIMIT 1;
    END IF;
    IF OLD.status = 'validat' OR v_aprob IS NOT NULL THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, valori_vechi, aprobare_veche, autor, rol)
      VALUES (OLD.id, OLD.licitatie_id, 'sters', OLD.status, to_jsonb(OLD),
              coalesce(v_aprob,jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota)),
              auth.uid(), v_rol);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM 'validat' THEN
    -- validarea explicită (✓) și orice rând nevalidat: NEATINSE (ca înainte). VALIDAREA se înregistrează — rândul aprobat
    -- (valori_noi = rândul întreg) e referința cu care se compară scrierile următoare; schimbarea de unitate din / în „m”
    -- (normalizat) pe un rând nevalidat = 'unitate_schimbata' (semnal, fără modificare).
    IF NEW.status IS DISTINCT FROM 'validat'
       AND public.ofertare_norm_text(OLD.um) <> public.ofertare_norm_text(NEW.um)
       AND 'm' IN (public.ofertare_norm_text(OLD.um), public.ofertare_norm_text(NEW.um)) THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'unitate_schimbata', OLD.status, NEW.status, NEW.status, ARRAY['um'], to_jsonb(OLD),
              jsonb_build_object('um', NEW.um),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    IF NEW.status = 'validat' THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'validat', OLD.status, NEW.status, NEW.status, to_jsonb(OLD), to_jsonb(NEW),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  -- valoarea APROBATĂ (aceeași regulă ca referinteDinIstoric din JS)
  SELECT h.valori_noi INTO v_ref FROM public.ofertare_cantitati_istoric h
   WHERE h.cantitate_id = OLD.id AND h.motiv = 'validat' AND h.valori_noi IS NOT NULL ORDER BY h.id DESC LIMIT 1;
  v_sursa_ref := 'validare';
  IF v_ref IS NULL THEN
    SELECT h.valori_vechi INTO v_ref FROM public.ofertare_cantitati_istoric h
     WHERE h.cantitate_id = OLD.id AND h.motiv NOT IN ('validat', 'unitate_schimbata') ORDER BY h.id LIMIT 1;
    v_sursa_ref := 'prima_scriere_inregistrata';
  END IF;
  IF v_ref IS NULL THEN v_ref := v_old; v_sursa_ref := 'randul_curent'; END IF;
  v_ref_cant := (v_ref ->> 'cantitate')::numeric; v_ref_cp := (v_ref ->> 'cantitate_plansa')::numeric;
  v_ref_um := v_ref ->> 'um'; v_ref_upd := (v_ref ->> 'updated_at')::timestamptz;

  -- 1b: fără v_tol (toleranța de 1 m) — cifrele se compară EXACT, pe valoarea canonică round(x, 6)
  FOREACH k IN ARRAY c_campuri LOOP
    a := v_old ->> k; b := v_new ->> k; r := v_ref ->> k; v_sev := NULL;
    IF k IN ('cantitate', 'cantitate_plansa', 'licitatie_id') THEN
      na := a::numeric; nb := b::numeric; nr := r::numeric;
      v_distinct := na IS DISTINCT FROM nb;   -- numeric: 100 = 100.000 (doar forma) => nicio scriere distinctă
      IF NOT v_distinct THEN CONTINUE; END IF;
      IF k = 'licitatie_id' THEN v_rel := nr IS DISTINCT FROM nb;
      ELSE
        IF k = 'cantitate' THEN ea := nr; eb := nb;
        ELSE   -- cifra din planșă EFECTIVĂ (ca referintaCitire / cifraSchimbata), față de cea aprobată
          -- Observația e în metri; doar fallback-ul poartă unitatea rândului.
          ea := coalesce(v_ref_cp, v_ref_cant * coalesce((public.ofertare_clasa_unitate(v_ref_um)->>'factor')::numeric,1));
          eb := coalesce(NEW.cantitate_plansa, NEW.cantitate * coalesce((public.ofertare_clasa_unitate(NEW.um)->>'factor')::numeric,1));
        END IF;
        v_rel := round(ea, 6) IS DISTINCT FROM round(eb, 6);   -- 1b: exact (apariția / dispariția cifrei = schimbare)
        IF k = 'cantitate_plansa' THEN v_rel := v_rel AND round(nr, 6) IS DISTINCT FROM round(nb, 6); END IF;
        -- unitățile afișate: cantitatea în unitatea rândului (aprobată / nouă); cifra din planșă e o lungime
        v_u_vechi := CASE WHEN k = 'cantitate' THEN coalesce(nullif(v_ref_um, ''), 'm') ELSE 'm' END;
        v_u_nou := CASE WHEN k = 'cantitate' THEN coalesce(nullif(NEW.um, ''), 'm') ELSE 'm' END;
        -- severitatea (doar text): pe cifrele efective, ambele prezente, aceeași unitate normalizată
        IF v_rel AND ea IS NOT NULL AND eb IS NOT NULL
           AND (k = 'cantitate_plansa' OR public.ofertare_norm_text(v_ref_um) = public.ofertare_norm_text(NEW.um)) THEN
          v_lung := k = 'cantitate_plansa' OR public.ofertare_norm_text(NEW.um) IN ('', 'm', 'ml');
          v_dmu := (round(eb, 6) - round(ea, 6)) * 1000000;   -- Δ în milionimi (întreg exact)
          v_amu := abs(round(ea, 6)) * 1000000;
          v_semn := CASE WHEN v_dmu > 0 THEN '+' ELSE '-' END;
          -- reparația rundei 1: procentul AFIȘAT e TRUNCHIAT (div pe pozitive = floor), pragul se compară pe valoarea exactă (mai jos)
          v_pct := CASE WHEN v_amu = 0 THEN NULL ELSE div(abs(v_dmu) * 10000, v_amu) END;   -- sutimi de procent, trunchiat
          -- |Δ| exact, cu toate zecimalele semnificative (max. 6): „+0,8”, „+0,001”, „-1.110” (ca fmtMilionimi din JS)
          v_sev := 'diferență ' || CASE WHEN v_amu > 0 AND abs(v_dmu) * 100 < v_amu AND (NOT v_lung OR abs(v_dmu) < 1000000) THEN 'mică' ELSE 'mare' END || ': ' || v_semn ||
                   rtrim(rtrim(translate(to_char(abs(v_dmu) / 1000000, 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ',') || ' ' || v_u_nou ||
                   CASE WHEN v_pct IS NULL THEN '' WHEN v_pct = 0 THEN ', sub 0,01 %' ELSE ', ' || v_semn || rtrim(rtrim(translate(to_char(round(v_pct, 2) / 100, 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.00'), ',.', '.,'), '0'), ',') || ' %' END ||
                   CASE WHEN k = 'cantitate_plansa' AND (nr IS NULL OR nb IS NULL)
                        THEN ', efectiv ' || coalesce(rtrim(rtrim(translate(to_char(round(ea, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m → ' || coalesce(rtrim(rtrim(translate(to_char(round(eb, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' ELSE '' END;
        END IF;
      END IF;
    ELSIF k = 'um' THEN   -- unitatea NORMALIZATĂ (ca normUm din JS și filtrele de rețea ale view-ului / v6)
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    ELSE
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    END IF;
    v_nou := v_nou || jsonb_build_object(k, v_new -> k);
    IF v_rel THEN
      v_rel_c := v_rel_c || k;
      v_desc := v_desc || format('%s (%s → %s%s)', c_etichete ->> k,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(r::numeric, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN r IS NULL THEN '' ELSE ' ' || v_u_vechi END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(r, '—')
             ELSE '„' || CASE WHEN length(coalesce(r, '—')) > 60 THEN left(coalesce(r, '—'), 59) || '…' ELSE coalesce(r, '—') END || '”' END,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(b::numeric, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN b IS NULL THEN '' ELSE ' ' || v_u_nou END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(b, '—')
             ELSE '„' || CASE WHEN length(coalesce(b, '—')) > 60 THEN left(coalesce(b, '—'), 59) || '…' ELSE coalesce(b, '—') END || '”' END,
        CASE WHEN v_sev IS NULL THEN '' ELSE '; ' || v_sev END);
    ELSE
      v_sub_c := v_sub_c || k;
    END IF;
  END LOOP;

  IF 'denumire' = ANY (v_rel_c) OR 'specificatii' = ANY (v_rel_c) THEN
    ta := public.ofertare_cantitati_atribute(coalesce(v_ref ->> 'denumire', '') || ' ' || coalesce(v_ref ->> 'specificatii', ''));
    tb := public.ofertare_cantitati_atribute(coalesce(NEW.denumire, '') || ' ' || coalesce(NEW.specificatii, ''));
    FOREACH d IN ARRAY ARRAY['dn', 'material', 'sdr'] LOOP
      IF (ta ->> d) IS DISTINCT FROM (tb ->> d) THEN
        v_der := v_der || format('%s %s → %s', CASE d WHEN 'dn' THEN 'Dn' WHEN 'material' THEN 'materialul' ELSE 'SDR' END,
                                 coalesce(ta ->> d, '—'), coalesce(tb ->> d, '—'));
      END IF;
    END LOOP;
  END IF;

  v_status_cerut := NEW.status;
  IF array_length(v_rel_c, 1) > 0 THEN
    v_motiv := 'invalidat';
    IF NEW.status = 'validat' THEN
      v_nota := coalesce(NEW.diferenta_nota, '');
      -- orice prefix de invalidare anterior (al regulii sau „Rândul era VALIDAT cu … —” al transferului) se taie: fără prefixe adunate
      IF v_nota LIKE 'Rândul era VALIDAT%' AND strpos(v_nota, c_final) > 0 THEN
        v_nota := ltrim(substr(v_nota, strpos(v_nota, c_final) + length(c_final)));
      END IF;
      -- reparația rundei 1: cifrele aprobate EXACT (max. 6 zecimale); SINGURA schimbare relevantă = cifra din planșă (observația unei
      -- citiri) => „e de reverificat … o citire nouă a planșei nu infirmă aprobarea” (pereche cu notaInvalidare / doarObservatiePlansa)
      v_nota := format(CASE WHEN v_rel_c = ARRAY['cantitate_plansa'] AND cardinality(v_der) = 0
                  THEN '%s (cantitate %s%s%s%s) e de reverificat: s-a schimbat %s — o citire nouă a planșei nu infirmă aprobarea. Valoarea și aprobarea veche rămân în rând și în istoric; %s '
                  ELSE '%s (cantitate %s%s%s%s) nu mai e valabilă: s-a schimbat %s. Valoarea și aprobarea veche rămân în istoric; %s ' END,
                  c_prefix, coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cant, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—'), CASE WHEN v_ref_cant IS NULL THEN '' ELSE ' ' || coalesce(nullif(v_ref_um, ''), 'm') END,
                  CASE WHEN v_ref_cp IS NULL THEN '' ELSE ', cifra din planșă ' || coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cp, 6), 'FM999,999,999,999,999,999,999,999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' END,
                  CASE WHEN v_ref_upd IS NULL THEN '' ELSE ', ultima scriere ' || to_char(v_ref_upd AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END,
                  array_to_string(v_der || v_desc, '; '), c_final) || v_nota;
      NEW.status := 'diferenta';
      NEW.diferenta_nota := v_nota;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'validat' THEN
    v_motiv := 'redeschis';
  ELSIF array_length(v_sub_c, 1) > 0 THEN
    v_motiv := 'modificat_sub_prag';   -- 1b: doar formă (texte, „m” → „M”, cifre egale canonic) — validarea rămâne
  ELSE
    RETURN NEW;   -- nimic din aprobare atins (doar notă, ordine, updated_at, extras_de_ai)
  END IF;

  v_aprob := jsonb_build_object('status', OLD.status, 'ultima_scriere', v_ref -> 'updated_at', 'cantitate', v_ref -> 'cantitate',
                                'cantitate_plansa', v_ref -> 'cantitate_plansa', 'um', v_ref -> 'um', 'nota', v_ref -> 'diferenta_nota',
                                'referinta', v_sursa_ref, 'valori_aprobate', CASE WHEN v_sursa_ref = 'randul_curent' THEN NULL ELSE v_ref END);
  INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                 campuri_sub_prag, valori_vechi, valori_noi, aprobare_veche, nota, autor, rol)
  VALUES (OLD.id, OLD.licitatie_id, v_motiv, OLD.status, v_status_cerut, NEW.status, v_rel_c, v_sub_c, v_old, v_nou, v_aprob,
          CASE WHEN v_motiv = 'invalidat' AND v_status_cerut = 'validat' THEN v_nota END, auth.uid(), v_rol);
  RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_zz_ofertare_cantitati_aprobare BEFORE UPDATE ON public.ofertare_cantitati FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_cantitati_aprobare();
CREATE TRIGGER trg_zz_ofertare_cantitati_aprobare_del AFTER DELETE ON public.ofertare_cantitati FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_cantitati_aprobare();

CREATE TABLE public.ofertare_clarificari (
  id bigserial PRIMARY KEY, licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id), nr integer, intrebare text NOT NULL, sursa text,   -- intrebare NOT NULL ca pe producție
  cantitate_id bigint, status text NOT NULL DEFAULT 'propunere'
    CONSTRAINT ofertare_clarificari_status_check CHECK (status = ANY (ARRAY['propunere', 'de_trimis', 'trimisa', 'raspunsa', 'retrasa'])),
  raspuns text, raspuns_la timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), origine text, cheie text,
  baza_generare jsonb, fisier_path text, creat_de uuid, citita_la timestamptz, citita_rezumat text, raspuns_document_id bigint,
  surse_document_ids bigint[], surse_cerinte_ids bigint[], surse_cantitati_ids bigint[]
);
-- unicitatea (licitatie_id, cheie) ca pe producție și pe clona 176: INDEX unic, nu constrângere (proba pe clonă 26.11.2026)
CREATE UNIQUE INDEX ofertare_clarificari_cheie_uq ON public.ofertare_clarificari USING btree (licitatie_id, cheie);
ALTER TABLE public.ofertare_clarificari ENABLE ROW LEVEL SECURITY;
CREATE POLICY clar_acces ON public.ofertare_clarificari FOR ALL TO authenticated USING (public.fn_are_acces_ofertare()) WITH CHECK (public.fn_are_acces_ofertare());

-- ── 20261031a: textele, cheltuiala, deciziile, extragerile, feliile, observațiile, jurnalele ──
CREATE FUNCTION public.fn_ofertare_cb_lot_canonic(p integer[])
RETURNS integer[] LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp
AS $f$ SELECT coalesce(array_agg(DISTINCT x ORDER BY x) FILTER (WHERE x IS NOT NULL), '{}') FROM unnest(p) x $f$;
CREATE TABLE public.ofertare_doc_texte (
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  text         text NOT NULL CHECK (length(text) <= 5000000),
  creat_la     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licitatie_id, sha256),
  CHECK (encode(sha256(convert_to(text, 'UTF8')), 'hex') = sha256)
);
CREATE TABLE public.ofertare_doc_texte_prov (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id    bigint NOT NULL,
  document_id     bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  sha256          text NOT NULL,
  origine         text NOT NULL CHECK (origine IN ('transcriere', 'sinteza_ai')),
  producator      text NOT NULL CHECK (producator ~ '^[a-z0-9-]{1,60}$'),
  completitudine  text NOT NULL CHECK (completitudine IN ('integral', 'partial')),
  pagini_necitite integer[] NOT NULL DEFAULT '{}',
  constatat_la    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (licitatie_id, sha256) REFERENCES public.ofertare_doc_texte(licitatie_id, sha256)
);
CREATE TABLE public.ofertare_ai_buget (
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  scop         text NOT NULL CHECK (scop IN ('cant_extragere', 'audit_raspunsuri')),
  plafon_usd   numeric(8,2) NOT NULL CHECK (plafon_usd > 0 AND plafon_usd <= 100),
  blocat       boolean NOT NULL DEFAULT false,
  blocat_motiv text CHECK (blocat_motiv IS NULL OR length(blocat_motiv) <= 300),
  setat_de     uuid,
  setat_la     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licitatie_id, scop),
  CHECK (blocat = (blocat_motiv IS NOT NULL))
);
CREATE TABLE public.ofertare_ai_cereri (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  lot_domeniu  text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr       integer[] NOT NULL DEFAULT '{}',
  scop         text NOT NULL CHECK (scop IN ('cant_extragere', 'audit_raspunsuri')),
  aprobat_de   uuid NOT NULL,
  aprobat_la   timestamptz NOT NULL DEFAULT now(),
  valabil_pana timestamptz NOT NULL,
  stare        text NOT NULL DEFAULT 'activa' CHECK (stare IN ('activa', 'consumata', 'anulata')),
  stare_la     timestamptz,
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK (valabil_pana > aprobat_la AND valabil_pana <= aprobat_la + interval '30 days'),
  CHECK ((stare = 'activa') = (stare_la IS NULL)),
  FOREIGN KEY (licitatie_id, scop) REFERENCES public.ofertare_ai_buget(licitatie_id, scop)
);
CREATE TABLE public.ofertare_ai_rezervari (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerere_id      bigint NOT NULL REFERENCES public.ofertare_ai_cereri(id),
  licitatie_id   bigint NOT NULL,
  scop           text NOT NULL,
  munca_id       text NOT NULL CHECK (length(munca_id) BETWEEN 10 AND 400),
  incercare      integer NOT NULL DEFAULT 1 CHECK (incercare BETWEEN 1 AND 20),
  suma_rezervata numeric(10,4) NOT NULL CHECK (suma_rezervata >= 0.0001 AND suma_rezervata <= 2),
  stare          text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa', 'decontata', 'necunoscuta', 'abandonata')),
  cost_real      numeric(10,4) CHECK (cost_real IS NULL OR cost_real >= 0),
  tokeni_in      integer CHECK (tokeni_in IS NULL OR tokeni_in >= 0),
  tokeni_out     integer CHECK (tokeni_out IS NULL OR tokeni_out >= 0),
  model          text CHECK (model IS NULL OR length(model) <= 100),
  creat_la       timestamptz NOT NULL DEFAULT now(),
  inchisa_la     timestamptz,
  UNIQUE (munca_id, incercare),
  CHECK ((stare = 'deschisa') = (inchisa_la IS NULL)),
  CHECK ((stare = 'decontata') = (cost_real IS NOT NULL)),
  FOREIGN KEY (licitatie_id, scop) REFERENCES public.ofertare_ai_buget(licitatie_id, scop)
);
CREATE TABLE public.ofertare_cant_doc_decizii (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL,
  document_id  bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256   text NOT NULL CHECK (doc_sha256 ~ '^[0-9a-f]{64}$'),
  rol          text CHECK (rol IS NULL OR rol IN ('f3', 'c6', 'lista_alt', 'atr', 'cs', 'fisa_date', 'memoriu', 'plansa', 'raspuns', 'alt')),
  sectiune     text CHECK (sectiune IS NULL OR sectiune ~ '^([*]|[0-9]{1,5}-[0-9]{1,5})$'),
  decizie      text NOT NULL CHECK (decizie IN ('nu_e_sursa_cantitativa', 'rol_confirmat', 'verificat_fara_lungimi',
                                                'sursa_partiala_acceptata', 'text_confirmat', 'revocare')),
  revoca_id    bigint REFERENCES public.ofertare_cant_doc_decizii(id),
  motiv        text NOT NULL CHECK (length(motiv) BETWEEN 3 AND 500),
  decis_de     uuid NOT NULL,
  decis_la     timestamptz NOT NULL DEFAULT now(),
  CHECK ((decizie = 'text_confirmat') <= (rol IS NULL AND sectiune IS NULL)),
  CHECK (decizie IN ('text_confirmat', 'revocare') OR (rol IS NOT NULL AND sectiune IS NOT NULL)),
  CHECK ((decizie = 'revocare') = (revoca_id IS NOT NULL))
);
CREATE INDEX ofertare_cant_doc_decizii_doc ON public.ofertare_cant_doc_decizii (document_id, doc_sha256);
CREATE TABLE public.ofertare_cant_extrageri (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  document_id    bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  doc_sha256     text NOT NULL,
  prov_id        bigint REFERENCES public.ofertare_doc_texte_prov(id),
  dovada_decizie_id bigint REFERENCES public.ofertare_cant_doc_decizii(id),
  familie_id     text NOT NULL CHECK (length(familie_id) BETWEEN 1 AND 200),
  extractor_id   text NOT NULL CHECK (extractor_id ~ '^[A-Za-z0-9._:@/-]{3,200}$'),
  felii_total    integer NOT NULL CHECK (felii_total BETWEEN 1 AND 500),
  stare          text NOT NULL DEFAULT 'in_lucru' CHECK (stare IN ('in_lucru', 'gata', 'partial', 'esuat')),
  obs_relevante  integer CHECK (obs_relevante IS NULL OR obs_relevante >= 0),
  cerere_id      bigint NOT NULL REFERENCES public.ofertare_ai_cereri(id),
  reluari        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reluari) = 'array'),
  pornit_de      uuid,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  terminat_la    timestamptz,
  CHECK ((stare = 'in_lucru') = (terminat_la IS NULL)),
  CHECK ((stare = 'gata') = (obs_relevante IS NOT NULL)),
  CHECK (num_nonnulls(prov_id, dovada_decizie_id) = 1),
  FOREIGN KEY (licitatie_id, doc_sha256) REFERENCES public.ofertare_doc_texte(licitatie_id, sha256)
);
CREATE UNIQUE INDEX ofertare_cant_extrageri_cache ON public.ofertare_cant_extrageri (document_id, doc_sha256, extractor_id) WHERE stare = 'gata';
CREATE UNIQUE INDEX ofertare_cant_extrageri_o_activa ON public.ofertare_cant_extrageri (document_id, doc_sha256, extractor_id) WHERE stare = 'in_lucru';
CREATE TABLE public.ofertare_cant_felii (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  munca_id      text NOT NULL CHECK (length(munca_id) BETWEEN 10 AND 400),
  incercare     integer NOT NULL DEFAULT 1 CHECK (incercare BETWEEN 1 AND 20),
  extragere_id  bigint NOT NULL REFERENCES public.ofertare_cant_extrageri(id),
  felie_nr      integer NOT NULL CHECK (felie_nr BETWEEN 0 AND 499),
  de_la         integer NOT NULL CHECK (de_la >= 0),
  pana_la       integer NOT NULL,
  sha_felie     text NOT NULL CHECK (sha_felie ~ '^[0-9a-f]{64}$'),
  stare         text NOT NULL DEFAULT 'in_zbor' CHECK (stare IN ('in_zbor', 'gata', 'esuat', 'necunoscut')),
  rezervare_id  bigint REFERENCES public.ofertare_ai_rezervari(id),
  motiv_reluare text CHECK (motiv_reluare IS NULL OR length(motiv_reluare) <= 300),
  creat_la      timestamptz NOT NULL DEFAULT now(),
  inchisa_la    timestamptz,
  UNIQUE (munca_id, incercare),
  CHECK (pana_la > de_la),
  CHECK ((stare = 'in_zbor') = (inchisa_la IS NULL)),
  CHECK ((incercare = 1) = (motiv_reluare IS NULL))
);
CREATE TABLE public.ofertare_cant_obs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id      bigint NOT NULL,
  document_id       bigint NOT NULL,
  doc_sha256        text NOT NULL,
  familie_id        text NOT NULL,
  extragere_id      bigint NOT NULL REFERENCES public.ofertare_cant_extrageri(id),
  felie_nr          integer NOT NULL,
  lot_domeniu       text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')),
  lot_nr            integer[] NOT NULL DEFAULT '{}',
  rol_sursa         text NOT NULL CHECK (rol_sursa IN ('f3', 'c6', 'lista_alt', 'atr', 'cs', 'fisa_date', 'memoriu', 'plansa', 'raspuns', 'alt')),
  rol_decis_de      text NOT NULL CHECK (rol_decis_de IN ('antet', 'marcaj', 'titlu', 'model', 'om')),
  pagina            integer CHECK (pagina IS NULL OR pagina BETWEEN 1 AND 99999),
  cod_articol       text CHECK (cod_articol IS NULL OR length(cod_articol) <= 100),
  denumire          text NOT NULL CHECK (length(denumire) BETWEEN 1 AND 1000),
  rand_interval     int4range,
  citat_interval    int4range,
  cantitate_offset  integer CHECK (cantitate_offset IS NULL OR cantitate_offset >= 0),
  pozitie_dovedita  boolean NOT NULL,
  valoare_ambigua   boolean NOT NULL DEFAULT false,
  tip_lucrare       text NOT NULL CHECK (tip_lucrare IN ('conducta', 'bransament', 'protectie', 'alt')),
  masura            text NOT NULL CHECK (masura IN ('lungime', 'montaj', 'proba', 'material', 'alt')),
  obiect_brut       text CHECK (obiect_brut IS NULL OR length(obiect_brut) <= 300),
  obiect_cheie      text CHECK (obiect_cheie IS NULL OR length(obiect_cheie) <= 300),
  material          text CHECK (material IS NULL OR material ~ '^[A-Z0-9]{2,12}$'),
  dn_mm             numeric[] NOT NULL DEFAULT '{}',
  dn_model          numeric,
  dn_ambiguu        boolean NOT NULL DEFAULT false,
  sdr               numeric,
  um_norm           text CHECK (um_norm IS NULL OR um_norm ~ '^[a-z0-9.%/]{1,10}$'),
  cantitate         numeric,
  e_total           boolean NOT NULL DEFAULT false,
  e_subtotal        boolean NOT NULL DEFAULT false,
  citat             text NOT NULL CHECK (length(citat) BETWEEN 1 AND 300),
  extractor_id      text NOT NULL,
  hash_rand         text NOT NULL CHECK (hash_rand ~ '^[0-9a-f]{64}$'),
  creat_la          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extragere_id, felie_nr, hash_rand),
  CHECK ((lot_domeniu = 'lista') = (cardinality(lot_nr) > 0)),
  CHECK (lot_nr = public.fn_ofertare_cb_lot_canonic(lot_nr)),
  CHECK (NOT pozitie_dovedita OR (cantitate_offset IS NOT NULL AND citat_interval IS NOT NULL AND rand_interval IS NOT NULL)),
  CHECK (NOT (pozitie_dovedita AND valoare_ambigua))
);
CREATE INDEX ofertare_cant_obs_lic ON public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256);
CREATE TABLE public.ofertare_analiza_versiuni (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL,
  lot_domeniu text NOT NULL CHECK (lot_domeniu IN ('toate', 'lista', 'necunoscut')), lot_nr integer[] NOT NULL DEFAULT '{}',
  tip text NOT NULL CHECK (tip IN ('initiala', 'recalcul')), declansator text NOT NULL, inghetata_la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ofertare_clarificari_jurnal (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clarificare_id bigint NOT NULL,
  licitatie_id   bigint NOT NULL,
  eveniment      text NOT NULL CHECK (eveniment IN ('trimisa', 'raspunsa', 'retrasa')),
  text           text NOT NULL,
  text_sha256    text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  la             timestamptz NOT NULL DEFAULT now(),
  CHECK (encode(sha256(convert_to(text, 'UTF8')), 'hex') = text_sha256)
);
CREATE TABLE public.ofertare_analiza_erori (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint, clarificare_id bigint, snapshot_id bigint,
  faza text NOT NULL CHECK (faza IN ('jurnal', 'ingheata', 'completare')), eroare text NOT NULL CHECK (length(eroare) <= 1000),
  la timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ofertare_loturi_observatii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL, la timestamptz NOT NULL, n bigint NOT NULL CHECK (n >= 0),
  sursa text NOT NULL CHECK (sursa IN ('trimitere', 'rutina_termen'))
);
CREATE TABLE public.ofertare_loturi_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, licitatie_id bigint NOT NULL, document_id bigint, actiune text NOT NULL, vechi jsonb, nou jsonb,
  de uuid, la timestamptz NOT NULL DEFAULT now()
);
-- RLS ca în 20261031a (citire = acces Ofertare; scrieri doar prin RPC-urile DEFINER)
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_doc_texte', 'ofertare_doc_texte_prov', 'ofertare_ai_buget', 'ofertare_ai_cereri', 'ofertare_ai_rezervari',
      'ofertare_cant_doc_decizii', 'ofertare_cant_extrageri', 'ofertare_cant_felii', 'ofertare_cant_obs', 'ofertare_analiza_versiuni',
      'ofertare_clarificari_jurnal', 'ofertare_analiza_erori', 'ofertare_loturi_observatii', 'ofertare_loturi_jurnal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))', t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $rls$;
CREATE FUNCTION public.fn_ofertare_cb_imuabil()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
DECLARE v_vechi jsonb; v_nou jsonb; c text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '%: rândurile nu se șterg (imuabil)', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  v_vechi := to_jsonb(OLD); v_nou := to_jsonb(NEW);
  FOREACH c IN ARRAY coalesce(TG_ARGV, ARRAY[]::text[]) LOOP v_vechi := v_vechi - c; v_nou := v_nou - c; END LOOP;
  IF v_vechi IS DISTINCT FROM v_nou THEN RAISE EXCEPTION '%: coloane imuabile modificate', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_obs FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil();
CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_clarificari_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil();
CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_doc_decizii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil();
CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_extrageri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil('stare', 'obs_relevante', 'terminat_la', 'cerere_id', 'reluari');
CREATE TRIGGER a01_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cant_felii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil('stare', 'rezervare_id', 'inchisa_la');
CREATE FUNCTION public.fn_ofertare_cb_tranzitie()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $f$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.stare IS NOT DISTINCT FROM NEW.stare THEN RETURN NEW; END IF;
  IF (TG_TABLE_NAME = 'ofertare_ai_cereri' AND OLD.stare = 'activa' AND NEW.stare IN ('consumata', 'anulata'))
     OR (TG_TABLE_NAME = 'ofertare_ai_rezervari' AND OLD.stare = 'deschisa' AND NEW.stare IN ('decontata', 'necunoscuta', 'abandonata'))
     OR (TG_TABLE_NAME = 'ofertare_ai_rezervari' AND OLD.stare = 'necunoscuta' AND NEW.stare = 'abandonata')
     OR (TG_TABLE_NAME = 'ofertare_cant_extrageri' AND OLD.stare = 'in_lucru' AND NEW.stare IN ('gata', 'partial', 'esuat'))
     -- redeschiderea (doar fn_ofertare_cb_extragere_redeschide: om, cu motiv și cerere activă) — calea de reluare (review r2)
     OR (TG_TABLE_NAME = 'ofertare_cant_extrageri' AND OLD.stare IN ('partial', 'esuat') AND NEW.stare = 'in_lucru')
     OR (TG_TABLE_NAME = 'ofertare_cant_felii' AND OLD.stare = 'in_zbor' AND NEW.stare IN ('gata', 'esuat', 'necunoscut')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: tranziție de stare nepermisă % → %', TG_TABLE_NAME, OLD.stare, NEW.stare USING ERRCODE = '42501';
END $f$;
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_cant_extrageri FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
CREATE TRIGGER a02_tranzitie BEFORE UPDATE ON public.ofertare_cant_felii FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_tranzitie();
CREATE FUNCTION public.fn_ofertare_cb_poate(p_licitatie_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT auth.uid() IS NOT NULL AND coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) $f$;
CREATE FUNCTION public.fn_ofertare_cb_felie_reia(p_felie_id bigint, p_motiv text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE f record; x record; v_id bigint; v_max integer;
BEGIN
  SELECT * INTO f FROM public.ofertare_cant_felii WHERE id = p_felie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Felie inexistentă' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.ofertare_cant_extrageri WHERE id = f.extragere_id FOR SHARE;
  IF NOT public.fn_ofertare_cb_poate(x.licitatie_id) THEN RAISE EXCEPTION 'Fără drept' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'Motiv obligatoriu' USING ERRCODE = '22023'; END IF;
  IF x.stare <> 'in_lucru' THEN RAISE EXCEPTION 'Extragerea nu e în lucru (se redeschide întâi)' USING ERRCODE = '55000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_cb_felie:' || f.munca_id));
  SELECT max(incercare) INTO v_max FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id;
  IF EXISTS (SELECT 1 FROM public.ofertare_cant_felii WHERE munca_id = f.munca_id AND incercare = v_max AND stare NOT IN ('esuat', 'necunoscut')) THEN
    RAISE EXCEPTION 'Ultima încercare nu e eșuată / necunoscută' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, motiv_reluare)
  VALUES (f.munca_id, v_max + 1, f.extragere_id, f.felie_nr, f.de_la, f.pana_la, f.sha_felie, btrim(p_motiv)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'felie_id', v_id, 'incercare', v_max + 1);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cb_felie_reia(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cb_felie_reia(bigint, text) TO authenticated, service_role;
-- înghețarea (stub): triggerul de jurnal o cheamă doar la „trimisa” fără snapshot inițial; aici întoarce „amânat” (nu înghețăm nimic în probă)
CREATE FUNCTION public.fn_ofertare_cb_ingheata(p_licitatie_id bigint, p_lot_domeniu text, p_lot_nr integer[], p_declansator text,
                                              p_clarificare_id bigint, p_de uuid, p_fara_asteptare boolean, p_jurnal_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $stub$ SELECT jsonb_build_object('amanat', true, 'stub', true) $stub$;
CREATE FUNCTION public.fn_ofertare_cb_trg_clarificari()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '200ms'
AS $f$
DECLARE v_r jsonb; v_lock boolean := false; v_ingheata boolean; v_j bigint;
BEGIN
  IF NEW.status IN ('trimisa', 'raspunsa', 'retrasa') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_ingheata := NEW.status = 'trimisa' AND NOT EXISTS (SELECT 1 FROM public.ofertare_analiza_versiuni v WHERE v.licitatie_id = NEW.licitatie_id
                                                          AND v.tip = 'initiala' AND v.lot_domeniu = 'toate');
    -- lock-ul licitației ÎNAINTEA jurnalului (NOWAIT): evenimentul scris sub lock = momentul exact al înghețării (review r4)
    IF v_ingheata THEN
      BEGIN
        PERFORM 1 FROM public.ofertare_licitatii WHERE id = NEW.licitatie_id FOR NO KEY UPDATE NOWAIT;
        v_lock := true;
      EXCEPTION WHEN lock_not_available THEN v_lock := false;
      END;
    END IF;
    -- observația loturilor ÎNAINTEA evenimentului, DOAR sub lock-ul licitației (la = clock_timestamp() după lock, numărare după la);
    -- best-effort — lipsa ei face doar înghețarea tardivă incertă
    IF v_ingheata AND v_lock THEN
      DECLARE v_la timestamptz; v_n bigint;
      BEGIN
        v_la := clock_timestamp();
        SELECT count(*) INTO v_n FROM public.ofertare_loturi_jurnal j WHERE j.licitatie_id = NEW.licitatie_id;
        INSERT INTO public.ofertare_loturi_observatii (licitatie_id, la, n, sursa) VALUES (NEW.licitatie_id, v_la, v_n, 'trimitere');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    BEGIN
      INSERT INTO public.ofertare_clarificari_jurnal (clarificare_id, licitatie_id, eveniment, text, text_sha256, la)
      VALUES (NEW.id, NEW.licitatie_id, NEW.status, coalesce(NEW.intrebare, ''), encode(sha256(convert_to(coalesce(NEW.intrebare, ''), 'UTF8')), 'hex'),
              clock_timestamp())
      RETURNING id INTO v_j;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'jurnal', left(SQLERRM, 1000));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      RETURN NULL;
    END;
    IF v_ingheata THEN
      BEGIN
        IF v_lock THEN
          v_r := public.fn_ofertare_cb_ingheata(NEW.licitatie_id, 'toate', '{}', 'clarificare_trimisa', NEW.id, auth.uid(), true, v_j);
        ELSE
          v_r := jsonb_build_object('amanat', true);
        END IF;
        IF coalesce((v_r->>'amanat')::boolean, false) THEN
          INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'ingheata', 'amânat (lock ocupat)');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.ofertare_analiza_erori (licitatie_id, clarificare_id, faza, eroare) VALUES (NEW.licitatie_id, NEW.id, 'ingheata', left(SQLERRM, 1000));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END IF;
  END IF;
  RETURN NULL;
END $f$;
CREATE TRIGGER trg_ofertare_cb_clarificari_jurnal AFTER INSERT OR UPDATE OF status ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_trg_clarificari();

-- ── 20261025a / 20261026a: proveniența ──
CREATE OR REPLACE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_utilizator boolean;
  -- 20261026a: pe ofertare_cerinte se validează surse_document_ids (blocul comun de la final), ca pe cantități.
  -- sursele derivate de server (clarificarea automată): un ID DISPĂRUT (inexistent global) se păstrează — codul îl tratează ca
  -- neverificabil = exclus; un ID existent în ALTĂ licitație se refuză ca la orice scriere (review Copilot r1 P1 #1)
  v_derivat boolean := false;
  v_max constant int := 20000;   -- fără trunchiere: baza F3 a clarificării automate poate avea sute de rânduri (Jakarinos r6 P2)
BEGIN
  v_utilizator := v_rol IN ('authenticated', 'anon');
  IF v_utilizator THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.surse_document_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        -- originile rezervate serverului (automat, platforma) nu se inserează de utilizator (review Copilot r3 P1)
        IF NEW.surse_cerinte_ids IS NOT NULL OR NEW.surse_cantitati_ids IS NOT NULL OR NEW.origine IN ('automat', 'platforma') THEN
          RAISE EXCEPTION 'Sursele (surse_*) și clarificările generate (automat / platforma) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSE
      IF NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        IF NEW.surse_cerinte_ids IS DISTINCT FROM OLD.surse_cerinte_ids OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids THEN
          RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
        -- originea e atribut de proveniență: imuabilă pentru utilizator după INSERT (fără spălare platforma -> manual, Copilot r3 P1)
        IF NEW.origine IS DISTINCT FROM OLD.origine THEN
          RAISE EXCEPTION 'Originea clarificării nu se schimbă după creare' USING ERRCODE = '42501';
        END IF;
        IF OLD.origine = 'automat' AND (NEW.sursa, NEW.baza_generare) IS DISTINCT FROM (OLD.sursa, OLD.baza_generare) THEN
          RAISE EXCEPTION 'Proveniența clarificării automate (origine / sursa / baza_generare) o scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
    -- Clarificarea AUTOMATĂ din planșe (ofertare_clarificare_planse_auto, scrisă doar de server): sursele se derivă din
    -- ce a folosit funcția — planșele din `sursa` („planse_auto:475,474,…”), documentele și rândurile de cantități din
    -- baza_generare. Fără să rescriem RPC-ul de 12k. La UPDATE sursele NU scad (reuniune cu cele vechi, Jakarinos r6 P1 #6):
    -- o ciornă protejată își poate păstra textul despre o planșă scoasă din `sursa` — planșa rămâne în proveniență.
    IF NEW.origine = 'automat' AND (TG_OP = 'INSERT' OR NEW.sursa IS DISTINCT FROM OLD.sursa
                                    OR NEW.baza_generare IS DISTINCT FROM OLD.baza_generare OR NEW.origine IS DISTINCT FROM OLD.origine
                                    OR NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids
                                    OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids) THEN
      NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT t::bigint AS x FROM unnest(string_to_array(replace(coalesce(NEW.sursa, ''), 'planse_auto:', ''), ',')) t
           WHERE coalesce(NEW.sursa, '') LIKE 'planse_auto:%' AND t ~ '^[0-9]{1,18}$'
          UNION
          SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'documente') = 'array'
                                                                   THEN NEW.baza_generare->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_document_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: sursele scrise EXPLICIT de server odată cu textul (ofertare_clarificare_planse_auto)
          SELECT y FROM unnest(NEW.surse_document_ids) y WHERE y IS NOT NULL) s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT (e->>'id')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                           THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_cantitati_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: idem, cantitățile scrise explicit
          SELECT y FROM unnest(NEW.surse_cantitati_ids) y WHERE y IS NOT NULL) s);
      v_derivat := true;
    END IF;
    IF NEW.surse_cerinte_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cerinte_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cerinte_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cerinte_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cerinte_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cerinte_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cerinte_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = x AND c.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cerinte_ids: cerința % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.surse_cantitati_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cantitati_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cantitati_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cantitati_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cantitati_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cantitati_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x AND q.licitatie_id = NEW.licitatie_id)
         AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x)) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cantitati_ids: cantitatea % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  -- surse_document_ids: pe ambele tabele
  IF NEW.surse_document_ids IS NOT NULL THEN
    IF array_position(NEW.surse_document_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_document_ids) > v_max THEN
      RAISE EXCEPTION 'surse_document_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
    END IF;
    NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_document_ids) x);
    SELECT x INTO v_lipsa FROM unnest(NEW.surse_document_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = NEW.licitatie_id)
       AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x)) LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'surse_document_ids: documentul % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_surse_valideaza() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER a02_ofertare_clarificari_surse
  BEFORE INSERT OR UPDATE OF surse_cerinte_ids, surse_cantitati_ids, surse_document_ids, licitatie_id, origine, sursa, baza_generare
  ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();
CREATE TRIGGER a02_ofertare_cantitati_surse
  BEFORE INSERT OR UPDATE OF surse_document_ids, licitatie_id ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_surse_valideaza();

-- ── R9b: circuitul ciornelor automate (ULTIMA formă cunoscută în repo) ──
-- baza F3 = STUB determinist (schimbă amprenta la orice schimbare a rândurilor F3; identitate fără contradicții; fără planșe)
CREATE FUNCTION public.ofertare_f3_baza(p_licitatie_id bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $stub$
  WITH r AS (SELECT jsonb_build_object('id', q.id, 'c', round(q.cantitate, 6), 'um', lower(coalesce(q.um, '')), 's', q.status, 'o', coalesce(q.obiect, ''),
                      'd', coalesce(q.denumire, ''), 'cod_articol', coalesce(q.cod_articol, '')) AS x
               FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id),
       rr AS (SELECT coalesce(jsonb_agg(x || jsonb_build_object('h', md5(x::text)) ORDER BY (x ->> 'id')::bigint), '[]'::jsonb) AS randuri FROM r)
  SELECT jsonb_build_object('v', 2, 'evaluare', 'r9b', 'mod', 'corespondenta', 'amprenta', md5(jsonb_build_array('stub_f3', rr.randuri)::text),
                            'randuri', rr.randuri, 'identitate_contradictorie', false, 'identitate_incompleta', false, 'documente', '[]'::jsonb,
                            'text', 'stub f3_baza') FROM rr
$stub$;
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_baza_stare(p_licitatie_id bigint,p_intrebare text,p_sursa text,p_baza jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cur jsonb; v_st text; v_token text; v_hash text := md5(coalesce(p_intrebare,'')); v_old jsonb; v_dif jsonb; v_avertisment text; v_exceptie boolean;
BEGIN
  v_cur := public.ofertare_f3_baza(p_licitatie_id);
  IF nullif(v_cur->>'amprenta','') IS NULL THEN RAISE EXCEPTION 'bază indisponibilă'; END IF;
  v_token := md5((v_cur->>'amprenta') || '|' || v_hash);
  v_st := CASE WHEN p_baza->>'evaluare' IS DISTINCT FROM 'r9b' THEN 'indisponibila'
    WHEN p_baza->>'amprenta' IS DISTINCT FROM v_cur->>'amprenta' THEN 'schimbata'
    WHEN p_baza->'reconfirmare'->>'token' IS DISTINCT FROM v_token THEN 'necesita_review'
    ELSE 'ok' END;
  -- Luarea la cunoștință este informativă, NICIODATĂ aprobare pentru export sau de_trimis.
  IF v_st <> 'ok' AND p_baza->'luat_act'->>'token' = v_token THEN v_st := 'luat_act'; END IF;
  -- Contradicția are prioritate față de review, luat_act și orice excepție, inclusiv în lot mixt.
  IF coalesce((v_cur->>'identitate_contradictorie')::boolean,false) THEN
    v_st := 'identitate_contradictorie';
    v_exceptie := false;
    SELECT 'Identitate contradictorie: hash-uri diferite pentru același document (documente: ' ||
      string_agg(format('#%s %s',x->>'id',x->>'nume'),', ' ORDER BY (x->>'id')::bigint) ||
      ') — de rezolvat, nu se poate accepta prin excepție.'
      INTO v_avertisment FROM jsonb_array_elements(v_cur->'documente') x WHERE x->>'identitate'='contradictorie';
  -- Identitatea limitată are prioritate inclusiv față de luat_act. Excepția NU ține loc de review.
  ELSIF coalesce((v_cur->>'identitate_incompleta')::boolean,false) THEN
    SELECT 'Identitate limitată: nu putem detecta înlocuirea fișierului cu alt conținut la aceeași cale și aceeași mărime (documente: ' ||
      string_agg(format('#%s %s',x->>'id',x->>'nume'),', ' ORDER BY (x->>'id')::bigint) || ').'
      INTO v_avertisment FROM jsonb_array_elements(v_cur->'documente') x WHERE x->>'identitate'='limitata';
    v_exceptie := coalesce(p_baza->'exceptie_identitate'->>'token'=v_token
      AND p_baza->'exceptie_identitate'->>'de' IS NOT NULL
      AND p_baza->'exceptie_identitate'->>'la' IS NOT NULL
      AND length(btrim(p_baza->'exceptie_identitate'->>'motiv')) >= 10,false);
    v_st := CASE WHEN v_st='ok' AND v_exceptie THEN 'ok_identitate_limitata' ELSE 'identitate_limitata' END;
  END IF;
  v_old := CASE WHEN jsonb_typeof(p_baza->'randuri') = 'array' THEN p_baza->'randuri' ELSE '[]'::jsonb END;
  SELECT jsonb_build_object(
    'adaugate',coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(v_cur->'randuri') n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_old) o WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'scoase',coalesce((SELECT jsonb_agg(o) FROM jsonb_array_elements(v_old) o WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_cur->'randuri') n WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'modificate',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o->'id','inainte',o,'acum',n)) FROM jsonb_array_elements(v_old) o JOIN jsonb_array_elements(v_cur->'randuri') n ON o->>'id'=n->>'id' WHERE o->>'h' IS DISTINCT FROM n->>'h'),'[]'::jsonb)) INTO v_dif;
  RETURN jsonb_build_object('stare',v_st,'evaluare','r9b','amprenta_curenta',v_token,'amprenta_baza',v_cur->>'amprenta',
    'avertisment_identitate',v_avertisment,'exceptie_identitate_valida',coalesce(v_exceptie,false),
    'text_hash',v_hash,'curent',v_cur-'randuri','diferente',v_dif,'mod_ciorna','corespondenta',
    'marcaj_planse','revizie_planse_auto'=ANY(string_to_array(coalesce(p_sursa,''),',')),
    'text',CASE v_st WHEN 'ok' THEN 'Text aprobat de om pe baza curentă. Cantitățile din text nu sunt validate automat.'
      WHEN 'identitate_contradictorie' THEN v_avertisment
      WHEN 'identitate_limitata' THEN v_avertisment || CASE WHEN v_exceptie THEN ' Excepție înregistrată; reconfirmă textul pe baza curentă.' ELSE '' END
      WHEN 'ok_identitate_limitata' THEN v_avertisment || ' Excepție acceptată și text reconfirmat pe baza curentă.'
      WHEN 'schimbata' THEN 'baza s-a schimbat — de reverificat'
      WHEN 'luat_act' THEN 'baza s-a schimbat după transmitere — luat act; textul transmis rămâne neschimbat'
      WHEN 'indisponibila' THEN 'necesită review — baza ciornei vechi nu este demonstrabilă'
      ELSE 'necesită review — aprobă textul exact pe baza curentă' END);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('stare','indisponibila','text','nu putem verifica baza: ' || SQLERRM);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_baza_stare(bigint, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_baza_stare(bigint, text, text, jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_clarificari_baza()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb; v_auto boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF coalesce(OLD.cheie,'') LIKE 'auto_planse_%' THEN RAISE EXCEPTION 'Proveniența și deciziile se păstrează; retrage ciorna în loc de ștergere'; END IF;
    IF OLD.origine IN ('platforma','automat') AND OLD.status IN ('trimisa','raspunsa') THEN
      RAISE EXCEPTION 'Documentul transmis este imuabil';
    END IF;
    RETURN OLD;
  END IF;
  v_auto := coalesce(NEW.cheie,'') LIKE 'auto_planse_%' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') LIKE 'auto_planse_%');
  -- F02/F03: proveniența veche contează și când clientul încearcă s-o schimbe.
  IF NEW.origine IN ('platforma','automat') OR (TG_OP='UPDATE' AND OLD.origine IN ('platforma','automat')) OR v_auto THEN
    IF TG_OP='UPDATE' AND (NEW.origine,NEW.licitatie_id) IS DISTINCT FROM (OLD.origine,OLD.licitatie_id) THEN
      RAISE EXCEPTION 'Proveniența clarificării de platformă este imuabilă';
    END IF;
    IF NEW.status='raspunsa' AND (TG_OP='INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('trimisa','raspunsa')) THEN
      RAISE EXCEPTION 'Clarificare blocată: răspunsul cere o clarificare trimisă';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('trimisa','raspunsa') AND ((NEW.intrebare,NEW.fisier_path) IS DISTINCT FROM (OLD.intrebare,OLD.fisier_path)
        OR NEW.status IS NULL OR NEW.status NOT IN ('trimisa','raspunsa')) THEN RAISE EXCEPTION 'Documentul transmis este imuabil'; END IF;
      -- O editare nu moștenește aprobarea textului anterior, indiferent de writer.
      IF NEW.intrebare IS DISTINCT FROM OLD.intrebare
         AND (OLD.status='de_trimis' OR NEW.status='de_trimis') THEN NEW.status := 'propunere'; END IF;
    END IF;
    IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
       AND current_user IN ('authenticated','anon')
       AND NOT coalesce(public.fn_ofertare_source_pack_poate_decide(NEW.licitatie_id),false) THEN
      RAISE EXCEPTION 'Clarificare blocată: aprobarea cere drept de decizie pe licitație';
    END IF;
  END IF;
  -- Amprenta R9b rămâne exclusiv pe auto_planse_%. 
  IF NOT v_auto THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.cheie,NEW.licitatie_id,NEW.origine) IS DISTINCT FROM (OLD.cheie,OLD.licitatie_id,OLD.origine) THEN
      RAISE EXCEPTION 'Proveniența clarificării automate este imuabilă';
    END IF;
  END IF;
  IF current_user IN ('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Ciorna automată se creează doar prin generatorul controlat'; END IF;
    IF NEW.baza_generare IS DISTINCT FROM OLD.baza_generare THEN RAISE EXCEPTION 'Baza și aprobarea se scriu doar prin reconfirmare'; END IF;
    NEW.sursa := OLD.sursa;
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare AND current_user IN ('authenticated','anon','service_role') THEN
    -- Textul se salvează, aprobarea nu se transferă. Istoricul deciziilor se păstrează.
    NEW.baza_generare := (coalesce(NEW.baza_generare,'{}'::jsonb)-'reconfirmare') ||
      CASE WHEN OLD.baza_generare ? 'reconfirmare' AND NOT (OLD.baza_generare ? 'istoric_decizii')
        THEN jsonb_build_object('istoric_decizii',jsonb_build_array(OLD.baza_generare->'reconfirmare')) ELSE '{}'::jsonb END ||
      jsonb_build_object('text_editat_de',auth.uid(),'text_editat_la',now());
    IF NEW.status='de_trimis' THEN NEW.status := 'propunere'; END IF;
  END IF;
  -- F04: o editare nu poate reactiva excepția nici după revenirea la textul anterior.
  -- Generatorul poate rescrie baza unei propuneri încă nereconfirmate: nu pierde auditul excepției.
  IF TG_OP='UPDATE' AND OLD.baza_generare ? 'istoric_decizii'
     AND NOT (coalesce(NEW.baza_generare,'{}'::jsonb) ? 'istoric_decizii') THEN
    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) ||
      jsonb_build_object('istoric_decizii',OLD.baza_generare->'istoric_decizii');
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare THEN
    NEW.baza_generare := NEW.baza_generare - 'exceptie_identitate';
  END IF;
  IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_st := public.ofertare_clarificare_baza_stare(NEW.licitatie_id,NEW.intrebare,NEW.sursa,NEW.baza_generare);
    IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') OR coalesce((v_st->>'marcaj_planse')::boolean,true) THEN
      RAISE EXCEPTION 'Clarificare blocată: %. Reconfirmă textul pe baza curentă.',v_st->>'text';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_clarificari_baza() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_ofertare_clarificari_baza BEFORE INSERT OR UPDATE OR DELETE ON public.ofertare_clarificari
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_clarificari_baza();
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_reconfirma(p_id bigint,p_amprenta text,p_decizie text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_cur jsonb; v_decizie jsonb; v_sursa text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces la Ofertare'); END IF;
  IF coalesce(p_decizie,'') NOT IN ('revizuit','luat_act') THEN RETURN jsonb_build_object('error','alege revizuit sau, după transmitere, luat_act'); END IF;
  IF length(btrim(coalesce(p_nota,''))) < (CASE WHEN p_decizie='luat_act' THEN 10 ELSE 5 END) THEN RETURN jsonb_build_object('error','nota de review este prea scurtă'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  -- R9b (Copilot): reconfirmarea cere DREPT DE DECIZIE pe licitație (owner / responsabil / admin Ofertare), nu doar acces la modul.
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN RETURN jsonb_build_object('error','fără drept de decizie pe licitație'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','textul sau baza s-au schimbat — reîncarcă și verifică'); END IF;
  v_decizie := jsonb_build_object('token',p_amprenta,'text_hash',md5(coalesce(c.intrebare,'')),
    'amprenta',v_st->>'amprenta_baza','text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
  IF c.status IN ('trimisa','raspunsa') THEN
    IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
    UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie,
      'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
  ELSE
    IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
    v_cur := public.ofertare_f3_baza(c.licitatie_id);
    IF md5((v_cur->>'amprenta') || '|' || md5(coalesce(c.intrebare,''))) IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
    SELECT string_agg(t,',' ORDER BY o) INTO v_sursa FROM unnest(string_to_array(coalesce(c.sursa,''),',')) WITH ORDINALITY x(t,o) WHERE t <> 'revizie_planse_auto';
    UPDATE public.ofertare_clarificari SET sursa=v_sursa, updated_at=now(),
      baza_generare=v_cur||
        CASE WHEN c.baza_generare->'exceptie_identitate'->>'token'=p_amprenta
          THEN jsonb_build_object('exceptie_identitate',c.baza_generare->'exceptie_identitate') ELSE '{}'::jsonb END ||
        jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_reconfirma(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_reconfirma(bigint, text, text, text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') LIKE 'auto_planse_%' THEN
      v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificari_export(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_exceptie_identitate(p_id bigint,p_amprenta text,p_motiv text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_decizie jsonb; v_documente jsonb; v_metadate jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','autentificare necesară'); END IF;
  IF length(btrim(coalesce(p_motiv,''))) < 10 THEN RETURN jsonb_build_object('error','motivul trebuie să aibă minimum 10 caractere'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN
    RETURN jsonb_build_object('error','fără drept de decizie pe licitație');
  END IF;
  IF c.status IS NULL OR c.status NOT IN ('propunere','de_trimis') THEN RETURN jsonb_build_object('error','excepția se acceptă doar pentru o ciornă netransmisă'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN
    RETURN jsonb_build_object('error','baza s-a schimbat — reîncarcă și verifică textul și documentele');
  END IF;
  IF coalesce(v_st->>'stare','') NOT IN ('identitate_limitata','ok_identitate_limitata') THEN
    RETURN jsonb_build_object('error',CASE WHEN v_st->>'stare'='identitate_contradictorie' THEN v_st->>'text'
      ELSE 'baza curentă nu cere excepție de identitate' END);
  END IF;
  SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint),
    jsonb_object_agg(x->>'id',jsonb_build_object('fisier_path',x->'fisier_path','marime',x->'marime'))
    INTO v_documente,v_metadate FROM jsonb_array_elements(v_st->'curent'->'documente') x WHERE x->>'identitate'='limitata';
  v_decizie := jsonb_build_object('token',p_amprenta,'de',auth.uid(),'la',now(),'motiv',btrim(p_motiv),
    'documente',v_documente,'metadate',v_metadate,'decizie','exceptie_identitate');
  UPDATE public.ofertare_clarificari SET updated_at=now(),
    baza_generare=coalesce(c.baza_generare,'{}'::jsonb)||jsonb_build_object('exceptie_identitate',v_decizie,
      'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
        CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii')
          THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
    WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'id',p_id);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_exceptie_identitate(bigint, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_exceptie_identitate(bigint, text, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_notifica(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_resp uuid[]; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;
  -- 20261121a: ambii responsabili (fără NULL, fără dubluri)
  SELECT array(SELECT DISTINCT x FROM unnest(ARRAY[responsabil_id, responsabil2_id]) x WHERE x IS NOT NULL) INTO v_resp FROM public.ofertare_licitatii WHERE id=p_licitatie_id;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND cheie LIKE 'auto_planse_%' AND status <> 'retrasa' ORDER BY id FOR UPDATE LOOP
    v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
    IF v_st->>'stare' IN ('schimbata','indisponibila') AND v_st->>'amprenta_curenta' IS NOT NULL AND cardinality(v_resp) > 0 AND c.baza_generare->>'notificat_neactual' IS DISTINCT FROM v_st->>'amprenta_curenta' THEN
      INSERT INTO public.notifications(profile_id,type,modul,title,message,link_to)
        SELECT r,'info','Ofertare','Clarificare de reverificat','Licitația #'||p_licitatie_id||': baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.','/ofertare'
        FROM unnest(v_resp) r;
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('notificat_neactual',v_st->>'amprenta_curenta') WHERE id=c.id;
      v_n:=v_n+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'notificari',v_n);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('error',SQLERRM);
END $function$
;
REVOKE ALL ON FUNCTION public.ofertare_clarificari_notifica(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_notifica(bigint) TO authenticated, service_role;
CREATE VIEW public.v_ofertare_clarificari_baza WITH (security_invoker = on) AS
SELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> 'stare' AS stare, s.x ->> 'mod_ciorna' AS mod_ciorna, s.x -> 'curent' ->> 'mod' AS mod_curent,
       s.x ->> 'amprenta_curenta' AS amprenta_curenta, coalesce((s.x ->> 'marcaj_planse')::boolean, false) AS marcaj_planse, s.x ->> 'text' AS text, s.x AS detalii
  FROM public.ofertare_clarificari c
 CROSS JOIN LATERAL (SELECT public.ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare) AS x) s
 WHERE coalesce(c.cheie, '') LIKE 'auto_planse_%' AND c.status <> 'retrasa';
REVOKE ALL ON public.v_ofertare_clarificari_baza FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_clarificari_baza TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_clarificari_baza IS 'R9b: starea review-ului textului exact pe baza curentă, cu diferențe și valori pentru panoul intern. Necesita_review și luat_act nu sunt aprobări de export. security_invoker.';
