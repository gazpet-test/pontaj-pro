-- Audit Ofertare R06 la depunere (NO-GO Copilot 28.09): aceeași definiție a dovezii ca în PT.
-- fn_gate_depunere: o cerință e acoperită la depunere doar cu acoperire 'nu_se_aplica' SAU favorabilă
-- verificată pe scan și fără reverificare cerută. Propunerea AI nevalidată nu mai trece.
-- Impact la aplicare: 93 Jilava 123, 3 → 278, 5 → 31, 15 → 62 cerințe cu dovadă doar propusă (derogare = owner).
-- Aplicat ca `gate_depunere_r06_dovada_verificata` prin replace() pe pg_get_functiondef.
DO $mig$
DECLARE d text := pg_get_functiondef('public.fn_gate_depunere()'::regprocedure); o text;
BEGIN
  o := d;
  d := replace(d,
    $x$AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener','nu_se_aplica'));$x$,
    $x$AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id
            AND (a.status = 'nu_se_aplica'
                 OR (a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))));$x$);
  d := replace(d, $x$%s cerințe fără acoperire,$x$, $x$%s cerințe fără acoperire VERIFICATĂ de om (propunerea AI nu e dovadă),$x$);
  IF d = o OR position('a.verificat_pe_scan AND NOT COALESCE' in d) = 0 THEN RAISE EXCEPTION 'R06 gate: forma funcției s-a schimbat — nimic aplicat'; END IF;
  EXECUTE d;
END $mig$;
