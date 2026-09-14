-- TKT-2026-0121 (Nica): alertă dublare echipă/persoană pe mai multe șantiere în paralel
-- (ex. sudori care lucrează simultan la LOT1 și LOT3). Se bazează pe executie_alocari_personal,
-- care are deja employee_id + proiect_id + interval [data_start, data_end] structurat — nu text liber.
CREATE OR REPLACE VIEW public.v_executie_alocari_conflicte WITH (security_invoker = on) AS
SELECT
  a1.id             AS alocare_id,
  a1.employee_id,
  e.name            AS employee_name,
  a1.proiect_id,
  p1.nume           AS proiect_nume,
  a1.data_start, a1.data_end,
  a2.id             AS conflict_alocare_id,
  a2.proiect_id     AS conflict_proiect_id,
  p2.nume           AS conflict_proiect_nume,
  a2.data_start     AS conflict_data_start,
  a2.data_end       AS conflict_data_end
FROM public.executie_alocari_personal a1
JOIN public.executie_alocari_personal a2
  ON a2.employee_id = a1.employee_id
 AND a2.proiect_id <> a1.proiect_id
 AND a1.data_start <= a2.data_end AND a1.data_end >= a2.data_start
JOIN public.employees e ON e.id = a1.employee_id
JOIN public.executie_proiecte p1 ON p1.id = a1.proiect_id
JOIN public.executie_proiecte p2 ON p2.id = a2.proiect_id;

GRANT SELECT ON public.v_executie_alocari_conflicte TO authenticated, service_role;
