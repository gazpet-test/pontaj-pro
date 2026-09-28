-- Audit Ofertare R04 (28.09.2026), aplicat ca `ofertare_raspuns_set_r04_cumulat`:
-- fn_ofertare_raspuns_set_aplica marchează setul „aplicat" doar când TOATE operațiile propuse au fost
-- aplicate, cumulat peste aplicările succesive (rezultat.aplicate_cumulat / operatii_ramase); altfel
-- „aplicat_partial". Rezultatele anterioare se păstrează în rezultat.istoric.
-- Aplicat prin înlocuire pe pg_get_functiondef (vezi corpul în transcriptul migrării); test cu rollback:
-- set cu 2 operații → după prima: aplicat_partial (1 rămasă), după a doua: aplicat (istoric 1).
DO $mig$
DECLARE d text := pg_get_functiondef('public.fn_ofertare_raspuns_set_aplica(bigint,text[],uuid,boolean,text,text)'::regprocedure); o text;
BEGIN
  o := d;
  d := replace(d,
$x$  UPDATE public.ofertare_raspuns_set
     SET stare = CASE WHEN jsonb_array_length(v_conflicte) > 0 THEN 'aplicat_partial' ELSE 'aplicat' END,$x$,
$x$  DECLARE v_prev jsonb; v_cumulat jsonb; v_total int; v_rest int;
  BEGIN
    SELECT rezultat INTO v_prev FROM public.ofertare_raspuns_set WHERE id = p_set_id;
    SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO v_cumulat FROM (
      SELECT jsonb_array_elements_text(coalesce(v_prev -> 'aplicate_cumulat', '[]'::jsonb)) x
      UNION SELECT e ->> 'op_id' FROM jsonb_array_elements(v_aplicate) e) q;
    SELECT count(*) INTO v_total FROM jsonb_array_elements(v_prop -> 'operatii');
    SELECT count(*) INTO v_rest FROM jsonb_array_elements(v_prop -> 'operatii') op
     WHERE NOT (v_cumulat ? (op ->> 'op_id'));
    v_rezultat := v_rezultat || jsonb_build_object(
      'aplicate_cumulat', v_cumulat, 'operatii_total', v_total, 'operatii_ramase', v_rest,
      'istoric', coalesce(v_prev -> 'istoric', '[]'::jsonb)
                 || CASE WHEN v_prev IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_prev - 'istoric') END);
  END;
  UPDATE public.ofertare_raspuns_set
     SET stare = CASE WHEN jsonb_array_length(v_conflicte) > 0 OR (v_rezultat ->> 'operatii_ramase')::int > 0
                      THEN 'aplicat_partial' ELSE 'aplicat' END,$x$);
  IF d = o THEN RAISE EXCEPTION 'R04: forma funcției s-a schimbat — nimic aplicat'; END IF;
  EXECUTE d;
END $mig$;
