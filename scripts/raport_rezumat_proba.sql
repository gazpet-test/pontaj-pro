-- Proba rezumatului raportului zilnic (20261216a) pe rapoarte REALE, ÎNAINTE de orice aplicare. DOAR CITIRE.
-- Scoate ultimele 20 de rapoarte zilnice în forma de intrare a lui rezumatRaport() (src/raportRezumat.js), ca JSON pe un singur rând.
-- Nu creează nimic, nu scrie nimic: tranzacție READ ONLY, anulată la final. Nu scoate numele șefului de șantier (sef_santier) sau autorul.
-- Textele libere (lucrări, subcontractori, probleme, mașini, aprovizionare, plan pentru mâine) pot conține nume de persoane: ieșirea rămâne la coordonator (NU în repo, NU în PR).
-- Rulare (coordonatorul, pe producție, cu psql):
--   psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/raport_rezumat_proba.sql -o <folder de lucru>/intrari_rezumat.json
--   node scripts/raport_rezumat_proba.mjs <folder de lucru>/intrari_rezumat.json > <folder de lucru>/rezumate_proba.txt
-- Blocul INTRARE e copiat IDENTIC din fn_raport_rezumat_intrare (migrarea 20261216a); testul src/raportRezumat.test.js verifică.
\set ON_ERROR_STOP 1
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'site_id', r.site_id, 'data', r.data, 'intrare', r.intrare) ORDER BY r.data DESC, r.id DESC), '[]'::jsonb)::text
  FROM (
    SELECT z.id, z.site_id, z.data,
    -- INTRARE-START
    jsonb_build_object(
      'santier', (SELECT s.name FROM public.sites s WHERE s.id = z.site_id),
      'proiect', (SELECT p.nume FROM public.sites s JOIN public.executie_proiecte p ON p.id = s.proiect_id WHERE s.id = z.site_id),
      'data', to_char(z.data, 'YYYY-MM-DD'),
      'meteo', z.meteo,
      'personal', z.personal_snapshot,
      'utilaje', z.utilaje_snapshot,
      'linii', (SELECT coalesce(jsonb_agg(jsonb_build_object('obiect_cod', pu.cod, 'obiect_nume', pu.nume, 'activitate', pa.nume, 'um', pa.um,
                                                             'cantitate', rl.cantitate, 'bifa', coalesce(pa.tip_raportare, 'cantitate') = 'bifa')
                                          ORDER BY (rl.unitate_id IS NOT NULL), pu.ordine, pu.id, pa.ordine, pa.id, rl.id), '[]'::jsonb)
                  FROM public.raport_lucrari rl
                  JOIN public.sites sp ON sp.id = z.site_id
                  LEFT JOIN public.proiect_activitati pa ON pa.id = rl.activitate_id
                  LEFT JOIN public.proiect_unitati pu ON pu.id = rl.unitate_id
                 WHERE rl.raport_id = z.id
                   AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)
                   AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)
                   AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)),
      'distributie', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                  ELSE jsonb_build_object('conducte', count(*) FILTER (WHERE d.tabel = 'conducta'),
                                                          'bransamente', count(*) FILTER (WHERE d.tabel = 'bransament')) END
                        FROM public.raport_distributie_linii d WHERE d.raport_id = z.id),
      'lucrari', z.lucrari_efectuate,
      'probleme', z.probleme,
      'masini', z.masini,
      'subcontractori', z.subcontractori,
      'aprovizionare', z.aprovizionare,
      'plan_maine', z.plan_maine,
      'poze', cardinality(z.poze))
    -- INTRARE-END
      AS intrare
      FROM public.rapoarte_zilnice z
     ORDER BY z.data DESC, z.id DESC
     LIMIT 20
  ) r;
ROLLBACK;
