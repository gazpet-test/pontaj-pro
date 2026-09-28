-- Audit Ofertare R06 + R09 (28.09.2026), aplicat ca `ofertare_pt_stare_r06_r09`.
-- R06: „dovedita" = acoperire favorabilă VERIFICATĂ pe scan de om și fără reverificare cerută.
--      Propunerea AI nevalidată = „propusa": nu închide cerința, apare în coloana nouă
--      `dovada_de_verificat` (poarta: avertisment). `fara_capitol` rămâne același număr — nu apar blocaje noi.
-- R09: `verificata` cere și ca nicio legătură a cerinței să nu fie `blocata`.
-- Aplicat prin înlocuiri pe pg_get_viewdef (view-ul live e mai nou decât fișierele din repo);
-- migrarea refuză dacă forma nu e cea așteptată.
DO $mig$
DECLARE d text := pg_get_viewdef('public.v_ofertare_pt_stare'::regclass, true); o text;
BEGIN
  o := d;
  d := replace(d,
    $x$WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])))) AS dovedita$x$,
    $x$WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])) AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false))) AS dovedita,
            (EXISTS ( SELECT 1
                   FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])))) AS propusa$x$);
  d := replace(d,
    $x$AND l_1.verificat_la_versiunea = k.versiune)) AS verificata$x$,
    $x$AND l_1.verificat_la_versiunea = k.versiune)) AND NOT (EXISTS ( SELECT 1
                   FROM ofertare_pt_legaturi l_2
                  WHERE l_2.cerinta_id = c.id AND l_2.stare = 'blocata'::text)) AS verificata$x$);
  d := replace(d,
    $x$count(*) FILTER (WHERE NOT cer.are_capitol AND NOT cer.exceptata AND NOT cer.dovedita) AS fara_capitol$x$,
    $x$count(*) FILTER (WHERE NOT cer.are_capitol AND NOT cer.exceptata AND NOT cer.dovedita AND NOT cer.propusa) AS fara_capitol$x$);
  IF d = o OR position('AS propusa' in d) = 0 OR position('l_2.stare' in d) = 0 OR position('NOT cer.propusa) AS fara_capitol' in d) = 0 THEN
    RAISE EXCEPTION 'R06/R09: definiția view-ului nu mai are forma așteptată — nimic aplicat';
  END IF;
  d := regexp_replace(d, '\s+FROM ofertare_licitatii l\s+LEFT JOIN cer ON cer.licitatie_id = l.id\s+GROUP BY l.id;?\s*$',
    E',\n    count(*) FILTER (WHERE cer.propusa AND NOT cer.dovedita AND NOT cer.are_capitol AND NOT cer.exceptata) AS dovada_de_verificat\n   FROM ofertare_licitatii l\n     LEFT JOIN cer ON cer.licitatie_id = l.id\n  GROUP BY l.id');
  IF position('AS dovada_de_verificat' in d) = 0 THEN RAISE EXCEPTION 'R06: coloana nouă nu s-a putut adăuga'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS ' || d;
END $mig$;
