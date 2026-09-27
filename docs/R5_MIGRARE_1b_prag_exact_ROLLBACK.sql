-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK pentru docs/R5_MIGRARE_1b_prag_exact.sql — NEAPLICAT, doar cu GO Razvan (apply_migration, nume propus: r5_1b_prag_exact_rollback).
-- Reface EXACT definiția de azi (26.09.2026) a public.fn_trg_ofertare_cantitati_aprobare(), cea aplicată prin migrarea
-- r5_aprobare_istoric: corpul de mai jos e textul din producție octet cu octet (md5(prosrc) = df25b1ba4f392f10789f6f4e18e8eaaf —
-- aceeași logică cu docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql, fără comentarii și rânduri goale, cum a fost aplicată) și fără
-- comentariu pe funcție (în producție obj_description = NULL; 1b pune unul — rollback-ul îl scoate).
-- Efect: toleranța de 1 m pe cifre (m / ml / fără unitate) revine — o cifră schimbată cu < 1 m lasă rândul „validat” (istoric
-- 'modificat_sub_prag'); nota revine la „ m” fix, fără severitate. Rândurile deja invalidate de 1b RĂMÂN „diferenta” (revalidarea e
-- decizia omului — nu se „dezinvalidează” automat); istoricul scris de 1b rămâne. Trigger-ele, tabelul și drepturile nu se ating.
-- Rollback-ul de cod (JS: aplicaRegulaAprobare / descrieDiferenta) e separat — cu 1b retras și codul rămas, aplicația ar fi mai
-- strictă decât BD (tot sigur: codul pune singur „diferenta”).
-- SANITY (după): SELECT md5(prosrc) = 'df25b1ba4f392f10789f6f4e18e8eaaf', obj_description(oid, 'pg_proc') IS NULL
--                  FROM pg_proc WHERE oid = 'public.fn_trg_ofertare_cantitati_aprobare()'::regprocedure;   -- true, true
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_aprobare()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c_campuri constant text[] := ARRAY['licitatie_id','um','cantitate','cantitate_plansa','denumire','specificatii','obiect','categorie','tip_sursa','sursa','cod_articol'];
  c_etichete constant jsonb := '{"licitatie_id":"licitația","um":"unitatea de măsură","cantitate":"cantitatea","cantitate_plansa":"cifra din planșă","denumire":"denumirea","specificatii":"specificațiile","obiect":"obiectul (tronson / etapă)","categorie":"categoria","tip_sursa":"tipul sursei","sursa":"sursa","cod_articol":"codul articolului (poziția din listă)"}';
  c_prefix constant text := 'Rândul era VALIDAT — aprobarea veche';
  c_final constant text := 'validarea se reface.';
  v_old jsonb; v_new jsonb; v_ref jsonb; v_sursa_ref text; k text; a text; b text; r text; v_tol numeric; v_distinct boolean; v_rel boolean;
  na numeric; nb numeric; nr numeric; ea numeric; eb numeric; v_rel_c text[] := '{}'; v_sub_c text[] := '{}'; v_desc text[] := '{}'; v_der text[] := '{}';
  ta jsonb; tb jsonb; d text; v_motiv text; v_nota text; v_status_cerut text; v_aprob jsonb; v_nou jsonb := '{}';
  v_rol text; v_ref_cant numeric; v_ref_cp numeric; v_ref_um text; v_ref_upd timestamptz;
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
  IF OLD.status IS DISTINCT FROM 'validat' THEN
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
  v_tol := CASE WHEN public.ofertare_norm_text(NEW.um) IN ('', 'm', 'ml') THEN 1 ELSE 0 END;
  FOREACH k IN ARRAY c_campuri LOOP
    a := v_old ->> k; b := v_new ->> k; r := v_ref ->> k;
    IF k IN ('cantitate', 'cantitate_plansa', 'licitatie_id') THEN
      na := a::numeric; nb := b::numeric; nr := r::numeric;
      v_distinct := na IS DISTINCT FROM nb;
      IF NOT v_distinct THEN CONTINUE; END IF;
      IF k = 'licitatie_id' THEN v_rel := nr IS DISTINCT FROM nb;
      ELSE
        IF k = 'cantitate' THEN ea := nr; eb := nb;
        ELSE
          ea := coalesce(v_ref_cp, v_ref_cant); eb := coalesce(NEW.cantitate_plansa, NEW.cantitate);
        END IF;
        v_rel := (ea IS NULL) <> (eb IS NULL)
                 OR (ea IS NOT NULL AND CASE WHEN v_tol > 0 THEN abs(ea - eb) >= v_tol ELSE ea <> eb END);
        IF k = 'cantitate_plansa' THEN v_rel := v_rel AND nr IS DISTINCT FROM nb; END IF;
      END IF;
    ELSIF k = 'um' THEN
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
      v_desc := v_desc || format('%s (%s → %s)', c_etichete ->> k,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN public.ofertare_fmt_ro(r::numeric) || CASE WHEN r IS NULL THEN '' ELSE ' m' END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(r, '—')
             ELSE '„' || CASE WHEN length(coalesce(r, '—')) > 60 THEN left(coalesce(r, '—'), 59) || '…' ELSE coalesce(r, '—') END || '”' END,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN public.ofertare_fmt_ro(b::numeric) || CASE WHEN b IS NULL THEN '' ELSE ' m' END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(b, '—')
             ELSE '„' || CASE WHEN length(coalesce(b, '—')) > 60 THEN left(coalesce(b, '—'), 59) || '…' ELSE coalesce(b, '—') END || '”' END);
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
      IF v_nota LIKE 'Rândul era VALIDAT%' AND strpos(v_nota, c_final) > 0 THEN
        v_nota := ltrim(substr(v_nota, strpos(v_nota, c_final) + length(c_final)));
      END IF;
      v_nota := format('%s (cantitate %s%s%s%s) nu mai e valabilă: s-a schimbat %s. Valoarea și aprobarea veche rămân în istoric; %s ',
                  c_prefix, public.ofertare_fmt_ro(v_ref_cant), CASE WHEN v_ref_cant IS NULL THEN '' ELSE ' ' || coalesce(nullif(v_ref_um, ''), 'm') END,
                  CASE WHEN v_ref_cp IS NULL THEN '' ELSE ', cifra din planșă ' || public.ofertare_fmt_ro(v_ref_cp) || ' m' END,
                  CASE WHEN v_ref_upd IS NULL THEN '' ELSE ', ultima scriere ' || to_char(v_ref_upd AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END,
                  array_to_string(v_der || v_desc, '; '), c_final) || v_nota;
      NEW.status := 'diferenta';
      NEW.diferenta_nota := v_nota;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'validat' THEN
    v_motiv := 'redeschis';
  ELSIF array_length(v_sub_c, 1) > 0 THEN
    v_motiv := 'modificat_sub_prag';
  ELSE
    RETURN NEW;
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
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() IS NULL;
