-- P0c — poarta propunerii tehnice vede cerințele ATRIBUITE unui capitol dar NECONFIRMATE în registru (E2) (24.09.2026).
--
-- ⚠️ NEAPLICATĂ în producție. Se aplică DOAR cu GO explicit de la Răzvan (apply_migration, nume: p0c_pt_stare_neconfirmate).
--
-- De ce: generatorul v2.3 poate scrie (cu confirmare explicită) un capitol pe cerințe neconfirmate. Copilot (24.09): „salvat
--   ulterior ca text uman → NU elimină singur blocajul de verificare”. Rândul `capitole_nescrise_de_om` se stinge când un om
--   salvează capitolul (sursa='om'); `cerinte_neverificate` se stinge când bifează legătura „verificată”. Niciunul nu se uită
--   la confirmata_de. Rândul de poartă nou (ofertarePoarta.js, k='neconfirmate') citește coloana de aici și blochează până la
--   confirmarea (✓) sau excepția cerinței în registru — independent de sursa capitolului.
-- De ce view separat și nu o coloană în v_ofertare_pt_stare: view-ul mare are ~9.000 de caractere cu regex-uri; o coloană nouă
--   la coadă ar fi cerut re-emiterea integrală a definiției, risc mare de derivă pentru un singur COUNT. UI-ul îl citește separat și
--   îl îmbină în `st` (OfertarePropunere.jsx). Aceleași filtre ca în CTE-ul `cer` din v_ofertare_pt_stare.

CREATE OR REPLACE VIEW public.v_ofertare_pt_cerinte_neconfirmate WITH (security_invoker = on) AS
SELECT l.id AS licitatie_id,
       count(c.id) AS cerinte_neconfirmate_cu_capitol,
       COALESCE(array_agg(c.id ORDER BY c.nr_ordine) FILTER (WHERE c.id IS NOT NULL), '{}'::bigint[]) AS cerinte_neconfirmate_ids
FROM public.ofertare_licitatii l
LEFT JOIN public.ofertare_cerinte c
  ON c.licitatie_id = l.id AND c.tip IN ('propunere','forma') AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
 AND c.confirmata_de IS NULL
 AND EXISTS (SELECT 1 FROM public.ofertare_pt_legaturi lg WHERE lg.cerinta_id = c.id AND lg.fel = 'capitol')
GROUP BY l.id;
REVOKE ALL ON public.v_ofertare_pt_cerinte_neconfirmate FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_pt_cerinte_neconfirmate TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_pt_cerinte_neconfirmate IS 'Per licitație: câte cerințe (propunere/forma, curente) au capitol atribuit dar NU sunt confirmate de om în registru (confirmata_de NULL) + id-urile lor. Rând de poartă „neconfirmate” în ofertarePoarta.js. security_invoker.';
