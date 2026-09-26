-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 — condiția 1 a lui Copilot (26.09.2026) — MIGRARE PROPUSĂ, NEAPLICATĂ. Nu e în supabase/migrations/ tocmai ca să nu fie
-- luată drept aplicată. Se aplică DOAR cu GO Razvan, prin apply_migration (nume propus: r5_cantitati_aprobare_istoric).
--
-- „Invalidarea nu privește numai cifra: schimbarea relevantă a unității, diametrului, materialului, SDR-ului, tronsonului/etapei
--  sau sursei aplicabile poate face aprobarea anterioară nevalabilă chiar dacă lungimea e identică. Păstrează valoarea și
--  aprobarea veche în istoric."
--
-- Conține:
--   1) TABEL NOU public.ofertare_cantitati_istoric — valoarea + aprobarea veche a unui rând VALIDAT, la fiecare scriere care îl
--      atinge (invalidare, redeschidere, modificare sub prag, ștergere). Doar-adăugare: clienții au SELECT; scrie doar trigger-ul.
--   2) public.ofertare_cantitati_atribute(text) — Dn / material / SDR din denumire + specificații (doar pentru a NUMI schimbarea în
--      notă; aceleași expresii ca `atributeTehnice` din src/ofertareCantitatiInvalidare.js).
--   3) public.ofertare_fmt_ro(numeric) — număr ro-RO fără ambiguitate („2.210”, „35.620,59”), independent de lc_numeric.
--   4) public.fn_trg_ofertare_cantitati_aprobare() + trigger-ele trg_zz_ofertare_cantitati_aprobare (BEFORE UPDATE) și
--      trg_zz_ofertare_cantitati_aprobare_del (AFTER DELETE). Numele „zz” = se execută DUPĂ trg_categorie_cantitate (trigger-ele
--      BEFORE pe același eveniment rulează în ordine alfabetică), deci vede și categoria recalculată din denumire.
--
-- REGULA (identică cu aplicaRegulaAprobare din src/ofertareCantitatiInvalidare.js — aplicația o aplică și ea, ca protecția să nu
-- depindă doar de trigger):
--   OLD.status = 'validat' și UPDATE-ul schimbă RELEVANT unul din: licitatie_id, um, cantitate, cantitate_plansa, denumire (Dn,
--   material, SDR, tronson stau în text), specificatii, obiect (tronson / etapă), categorie, tip_sursa, sursa, cod_articol:
--     - cifrele: |Δ| ≥ 1 pe unitățile de lungime (m / ml / fără unitate), orice Δ pe celelalte; apariția / dispariția cifrei
--       contează; cifra din planșă se compară EFECTIV (coalesce(cantitate_plansa, cantitate)), ca `cifraSchimbata` din transfer;
--     - textele: orice schimbare după normalizare (spații comasate, trim, lower);
--   ⇒ dacă UPDATE-ul lasă status = 'validat' (nu l-a atins sau l-a retrimis): status := 'diferenta' („de reverificat”), nota începe
--     cu „Rândul era VALIDAT — aprobarea veche (…) nu mai e valabilă: s-a schimbat …”; istoric motiv 'invalidat';
--   ⇒ dacă UPDATE-ul a pus el însuși alt status (transferul / CAD / UI au aplicat deja regula): doar istoric 'invalidat'.
--   Fără schimbare relevantă: status → altceva = istoric 'redeschis' (↩, SQL-ul lic. 3, coliziunea R5 varianta B); schimbări doar
--   sub prag = istoric 'modificat_sub_prag' (validarea rămâne); DELETE pe un rând validat = istoric 'sters'.
--   VALIDAREA EXPLICITĂ rămâne posibilă: un UPDATE pe un rând nevalidat (ex. ✓ = doar status) nu e atins de trigger. Nicio cale
--   din aplicație nu salvează atribute + status='validat' în același UPDATE pe un rând deja validat (inventarul din
--   docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §8), deci nu e nevoie de un „marcaj de validare”.
--
-- Ce NU face: nu schimbă niciun rând la aplicare (doar DDL); nu atinge RPC-ul ofertare_transfer_plansa_cantitati (patch-ul lui
-- poartă deja status 'diferenta' când cifra se schimbă — trigger-ul doar scrie istoricul); nu dă drepturi noi pe ofertare_cantitati.
-- Identitate: funcția trigger-ului e SECURITY DEFINER (proprietar postgres) ca să poată scrie în istoric, pe care clienții îl pot
-- doar citi; nu citește conținut extern și nu trimite nimic.
--
-- Rollback: docs/R5_MIGRARE_PROPUSA_aprobare_istoric_ROLLBACK.sql (păstrează implicit istoricul).
-- Testat local pe PGlite 0.5.8 (Postgres 18.3 compilat WASM, în proces, de unică folosință — producția e PostgreSQL 17.6), cu
-- rândurile REALE ale lic. 3 (inclusiv cele 4 validate: 2, 3, 4, 9) și lic. 95 copiate prin SELECT (26.09.2026):
-- scratchpad pglite/test_aprobare_istoric.mjs, 48/48 — aplicare fără nicio schimbare de date; invalidare pe fiecare atribut (nota
-- SQL = nota JS, octet cu octet); istoric; validare explicită; ↩; sub prag; editorul; transferul; CAD; SQL-ul lic. 3 + rollback-ul
-- lui; DELETE; RLS (authenticated citește, nu scrie; anon nimic); rollback R1 / R2; reaplicare. Control negativ (trigger-ul
-- dezactivat după aplicare): 17 verificări pică.
--
-- PREVIEW (doar SELECT, înainte): rândurile validate azi — toate vor fi „păzite” de trigger, niciunul nu se schimbă la aplicare.
--   SELECT id, licitatie_id, um, cantitate, cantitate_plansa, left(denumire, 60) FROM public.ofertare_cantitati
--    WHERE status = 'validat' ORDER BY id;
--   (26.09.2026: 2, 3, 4, 9 — toate lic. 3)
-- SANITY (după):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati'::regclass AND NOT tgisinternal ORDER BY 1;
--   SELECT count(*) FROM public.ofertare_cantitati_istoric;   -- 0 imediat după aplicare
--   SELECT status, count(*) FROM public.ofertare_cantitati GROUP BY 1;   -- identic cu înainte
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 1) ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertare_cantitati_istoric (
  id               bigserial PRIMARY KEY,
  cantitate_id     bigint NOT NULL,            -- fără FK: istoricul supraviețuiește ștergerii rândului (motiv 'sters')
  licitatie_id     bigint,
  motiv            text NOT NULL CHECK (motiv IN ('invalidat', 'redeschis', 'modificat_sub_prag', 'sters')),
  status_vechi     text,
  status_cerut     text,                       -- ce a cerut UPDATE-ul (NEW.status înainte de regulă)
  status_nou       text,                       -- ce a rămas (după regulă); NULL la ștergere
  campuri          text[] NOT NULL DEFAULT '{}',   -- schimbările RELEVANTE
  campuri_sub_prag text[] NOT NULL DEFAULT '{}',
  valori_vechi     jsonb NOT NULL,             -- rândul întreg, cum era (valoarea aprobată)
  valori_noi       jsonb,                      -- doar câmpurile schimbate, cu valoarea nouă
  aprobare_veche   jsonb NOT NULL,             -- {status, ultima_scriere, cantitate, cantitate_plansa, um, nota}
  nota             text,                       -- textul pus în diferenta_nota (sau NULL)
  autor            uuid,                       -- auth.uid() al scrierii (NULL = service_role / SQL)
  rol              text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ofertare_cantitati_istoric_cant_idx ON public.ofertare_cantitati_istoric (cantitate_id, created_at);
CREATE INDEX IF NOT EXISTS ofertare_cantitati_istoric_lic_idx  ON public.ofertare_cantitati_istoric (licitatie_id, created_at);
ALTER TABLE public.ofertare_cantitati_istoric ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_cantitati_istoric FROM PUBLIC, anon;
GRANT SELECT ON public.ofertare_cantitati_istoric TO authenticated;
GRANT ALL ON public.ofertare_cantitati_istoric TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_cantitati_istoric_id_seq TO service_role;
DROP POLICY IF EXISTS istoric_cant_citeste ON public.ofertare_cantitati_istoric;
CREATE POLICY istoric_cant_citeste ON public.ofertare_cantitati_istoric FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
-- (nicio politică de scriere pentru authenticated: istoricul se scrie doar din trigger — SECURITY DEFINER)
COMMENT ON TABLE public.ofertare_cantitati_istoric IS 'R5 (Copilot 26.09.2026, condiția 1): valoarea și aprobarea veche a rândurilor VALIDATE din ofertare_cantitati, la invalidare (schimbare relevantă de unitate / Dn / material / SDR / tronson / sursă / cifră), redeschidere, modificare sub prag sau ștergere. Scris doar de fn_trg_ofertare_cantitati_aprobare.';

-- 2) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- toate valorile găsite, unice, în ordinea apariției (ca atributeTehnice din JS)
CREATE OR REPLACE FUNCTION public.ofertare_cantitati_atribute(p_text text)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT jsonb_build_object(
    'dn', (SELECT string_agg(v, '/' ORDER BY o) FROM (SELECT m[1] v, min(o) o FROM regexp_matches(coalesce(p_text, ''), '(?:\mdn|\mde|ø|φ)\s*(\d{2,4})(?!\d)', 'gi') WITH ORDINALITY x(m, o) GROUP BY 1) a),
    'sdr', (SELECT string_agg(v, '/' ORDER BY o) FROM (SELECT replace(m[1], ',', '.') v, min(o) o FROM regexp_matches(coalesce(p_text, ''), '\msdr\s*(\d+(?:[.,]\d+)?)', 'gi') WITH ORDINALITY x(m, o) GROUP BY 1) a),
    'material', (SELECT string_agg(v, '/' ORDER BY o) FROM (VALUES
        (1, CASE WHEN p_text ~* '\mpe\s*-?\s*100(?!\d)' THEN 'PE100' END),
        (2, CASE WHEN p_text ~* '\mpe\s*-?\s*80(?!\d)' THEN 'PE80' END),
        (3, CASE WHEN p_text !~* '\mpe\s*-?\s*(100|80)(?!\d)' AND p_text ~* '\m(pehd|pe)\M' THEN 'PE' END),
        (4, CASE WHEN p_text ~* '\mol\M|o[țţt]el' THEN 'OL' END)) t(o, v) WHERE v IS NOT NULL));
$f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_cantitati_atribute(text) FROM PUBLIC, anon;

-- 3) ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ofertare_fmt_ro(p numeric)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p IS NULL THEN '—'
    WHEN round(p, 2) = trunc(round(p, 2)) THEN translate(to_char(trunc(round(p, 2)), 'FM999,999,999,990'), ',', '.')
    ELSE translate(to_char(round(p, 2), 'FM999,999,999,990.99'), ',.', '.,') END;
$f$;
REVOKE EXECUTE ON FUNCTION public.ofertare_fmt_ro(numeric) FROM PUBLIC, anon;

-- 4) ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_aprobare()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c_campuri constant text[] := ARRAY['licitatie_id','um','cantitate','cantitate_plansa','denumire','specificatii','obiect','categorie','tip_sursa','sursa','cod_articol'];
  c_etichete constant jsonb := '{"licitatie_id":"licitația","um":"unitatea de măsură","cantitate":"cantitatea","cantitate_plansa":"cifra din planșă","denumire":"denumirea","specificatii":"specificațiile","obiect":"obiectul (tronson / etapă)","categorie":"categoria","tip_sursa":"tipul sursei","sursa":"sursa","cod_articol":"codul articolului (poziția din listă)"}';
  c_prefix constant text := 'Rândul era VALIDAT — aprobarea veche';
  c_final constant text := 'validarea se reface. ';
  v_old jsonb; v_new jsonb; k text; a text; b text; v_tol numeric; v_distinct boolean; v_rel boolean;
  na numeric; nb numeric; v_rel_c text[] := '{}'; v_sub_c text[] := '{}'; v_desc text[] := '{}'; v_der text[] := '{}';
  ta jsonb; tb jsonb; d text; v_motiv text; v_nota text; v_status_cerut text; v_aprob jsonb; v_nou jsonb := '{}';
  v_rol text;
BEGIN
  BEGIN v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
  EXCEPTION WHEN others THEN v_rol := session_user::text; END;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validat' THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, valori_vechi, aprobare_veche, autor, rol)
      VALUES (OLD.id, OLD.licitatie_id, 'sters', OLD.status, to_jsonb(OLD),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM 'validat' THEN RETURN NEW; END IF;   -- validarea explicită (✓) și orice rând nevalidat: neatins

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  v_tol := CASE WHEN NEW.um IS NULL OR lower(btrim(NEW.um)) IN ('', 'm', 'ml') THEN 1 ELSE 0 END;
  FOREACH k IN ARRAY c_campuri LOOP
    a := v_old ->> k; b := v_new ->> k;
    IF k IN ('cantitate', 'cantitate_plansa', 'licitatie_id') THEN
      na := (v_old ->> k)::numeric; nb := (v_new ->> k)::numeric;
      v_distinct := na IS DISTINCT FROM nb;
      IF NOT v_distinct THEN CONTINUE; END IF;
      IF k = 'licitatie_id' THEN v_rel := true;
      ELSE
        IF k = 'cantitate_plansa' THEN   -- cifra din planșă EFECTIVĂ (ca referintaCitire / cifraSchimbata)
          na := coalesce(OLD.cantitate_plansa, OLD.cantitate); nb := coalesce(NEW.cantitate_plansa, NEW.cantitate);
        END IF;
        v_rel := (na IS NULL) <> (nb IS NULL)
                 OR (na IS NOT NULL AND CASE WHEN v_tol > 0 THEN abs(na - nb) >= v_tol ELSE na <> nb END);
      END IF;
    ELSE
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := lower(btrim(regexp_replace(coalesce(a, ''), '\s+', ' ', 'g'))) <> lower(btrim(regexp_replace(coalesce(b, ''), '\s+', ' ', 'g')));
    END IF;
    v_nou := v_nou || jsonb_build_object(k, v_new -> k);
    IF v_rel THEN
      v_rel_c := v_rel_c || k;
      v_desc := v_desc || format('%s (%s → %s)', c_etichete ->> k,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN public.ofertare_fmt_ro((v_old ->> k)::numeric) || CASE WHEN v_old ->> k IS NULL THEN '' ELSE ' m' END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(a, '—')
             ELSE '„' || CASE WHEN length(coalesce(a, '—')) > 60 THEN left(coalesce(a, '—'), 59) || '…' ELSE coalesce(a, '—') END || '”' END,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN public.ofertare_fmt_ro((v_new ->> k)::numeric) || CASE WHEN v_new ->> k IS NULL THEN '' ELSE ' m' END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(b, '—')
             ELSE '„' || CASE WHEN length(coalesce(b, '—')) > 60 THEN left(coalesce(b, '—'), 59) || '…' ELSE coalesce(b, '—') END || '”' END);
    ELSE
      v_sub_c := v_sub_c || k;
    END IF;
  END LOOP;

  IF 'denumire' = ANY (v_rel_c) OR 'specificatii' = ANY (v_rel_c) THEN
    ta := public.ofertare_cantitati_atribute(coalesce(OLD.denumire, '') || ' ' || coalesce(OLD.specificatii, ''));
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
      IF v_nota LIKE c_prefix || ' (%' AND strpos(v_nota, c_final) > 0 THEN   -- fără prefixe adunate la cicluri repetate
        v_nota := ltrim(substr(v_nota, strpos(v_nota, c_final) + length(c_final)));
      END IF;
      v_nota := format('%s (cantitate %s%s%s%s) nu mai e valabilă: s-a schimbat %s. Valoarea și aprobarea veche rămân în istoric; %s',
                  c_prefix, public.ofertare_fmt_ro(OLD.cantitate), CASE WHEN OLD.cantitate IS NULL THEN '' ELSE ' ' || coalesce(nullif(OLD.um, ''), 'm') END,
                  CASE WHEN OLD.cantitate_plansa IS NULL THEN '' ELSE ', cifra din planșă ' || public.ofertare_fmt_ro(OLD.cantitate_plansa) || ' m' END,
                  CASE WHEN OLD.updated_at IS NULL THEN '' ELSE ', ultima scriere ' || to_char(OLD.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END,
                  array_to_string(v_der || v_desc, '; '), c_final) || v_nota;
      NEW.status := 'diferenta';
      NEW.diferenta_nota := v_nota;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'validat' THEN
    v_motiv := 'redeschis';
  ELSIF array_length(v_sub_c, 1) > 0 THEN
    v_motiv := 'modificat_sub_prag';
  ELSE
    RETURN NEW;   -- nimic din aprobare atins (doar notă, ordine, updated_at, extras_de_ai)
  END IF;

  v_aprob := jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota);
  INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                 campuri_sub_prag, valori_vechi, valori_noi, aprobare_veche, nota, autor, rol)
  VALUES (OLD.id, OLD.licitatie_id, v_motiv, OLD.status, v_status_cerut, NEW.status, v_rel_c, v_sub_c, v_old, v_nou, v_aprob,
          CASE WHEN v_motiv = 'invalidat' AND v_status_cerut = 'validat' THEN v_nota END, auth.uid(), v_rol);
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_ofertare_cantitati_aprobare ON public.ofertare_cantitati;
CREATE TRIGGER trg_zz_ofertare_cantitati_aprobare BEFORE UPDATE ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_cantitati_aprobare();
DROP TRIGGER IF EXISTS trg_zz_ofertare_cantitati_aprobare_del ON public.ofertare_cantitati;
CREATE TRIGGER trg_zz_ofertare_cantitati_aprobare_del AFTER DELETE ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_cantitati_aprobare();
COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() IS 'R5 (Copilot 26.09.2026, condiția 1): rând VALIDAT + schimbare relevantă (um, cifre, denumire/Dn/material/SDR, specificații, obiect/tronson, categorie, sursă, cod articol) => status diferenta + nota „aprobarea veche nu mai e valabilă”; valoarea și aprobarea veche în ofertare_cantitati_istoric. Pereche cu aplicaRegulaAprobare (src/ofertareCantitatiInvalidare.js).';
