-- P0c review — confirmări Copilot (24.09.2026):
--   (1) DEFER intră în „decise" ⇒ separăm explicit: revizuit = toate au o decizie; rezolvat = toate au decizie finală și DEFER = 0.
--   (3) decizia curentă e aleasă determinist: creat_la DESC, id DESC (id = tie-break stabil).
CREATE OR REPLACE VIEW public.v_ofertare_source_pack_decizie_curenta WITH (security_invoker = on) AS
SELECT DISTINCT ON (d.pack_id, d.sursa_ref) d.id, d.pack_id, d.sursa_ref, d.decizie, d.actor, d.motiv, d.cerinta_existenta_id, d.creat_la
FROM public.ofertare_source_pack_decizii d
ORDER BY d.pack_id, d.sursa_ref, d.creat_la DESC, d.id DESC;
COMMENT ON VIEW public.v_ofertare_source_pack_decizie_curenta IS 'Decizia curentă per (pack_id, sursa_ref) = ultima cronologic: ORDER BY creat_la DESC, id DESC (id = tie-break determinist).';

CREATE OR REPLACE VIEW public.v_ofertare_source_pack_revizie WITH (security_invoker = on) AS
SELECT sp.id AS pack_id, sp.licitatie_id, sp.stare, sp.nr_cerinte,
       count(dz.sursa_ref) AS decise,
       count(*) FILTER (WHERE dz.decizie = 'IMPORT')     AS decise_import,
       count(*) FILTER (WHERE dz.decizie = 'DUPLICATE')  AS decise_duplicate,
       count(*) FILTER (WHERE dz.decizie = 'REJECT')     AS decise_reject,
       count(*) FILTER (WHERE dz.decizie = 'SUPERSEDED') AS decise_superseded,
       count(*) FILTER (WHERE dz.decizie = 'DEFER')      AS decise_defer,
       (SELECT count(*) FROM public.ofertare_cerinte oc WHERE oc.sursa_pack_id = sp.id) AS importate,
       (sp.nr_cerinte IS NOT NULL AND sp.nr_cerinte > 0 AND count(dz.sursa_ref) >= sp.nr_cerinte) AS revizuit,
       (sp.nr_cerinte IS NOT NULL AND sp.nr_cerinte > 0 AND count(dz.sursa_ref) >= sp.nr_cerinte
        AND count(*) FILTER (WHERE dz.decizie = 'DEFER') = 0) AS rezolvat
FROM public.ofertare_source_pack sp
LEFT JOIN public.v_ofertare_source_pack_decizie_curenta dz ON dz.pack_id = sp.id
GROUP BY sp.id;
COMMENT ON VIEW public.v_ofertare_source_pack_revizie IS 'revizuit = toate cerințele au o decizie umană curentă (DEFER inclus — pack-ul NU e închis). rezolvat = revizuit și DEFER = 0 (decizii finale). Niciunul nu înseamnă importat și nu înseamnă registru complet (PACK_REVIEWED ≠ PACK_RESOLVED ≠ PACK_IMPORTED ≠ TENDER_COMPLETE).';
REVOKE ALL ON public.v_ofertare_source_pack_decizie_curenta FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_source_pack_decizie_curenta TO authenticated, service_role;
REVOKE ALL ON public.v_ofertare_source_pack_revizie FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_source_pack_revizie TO authenticated, service_role;
