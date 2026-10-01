-- TKT-2026-0308 (rând tichete #332, 30.09.2026, varianta A aprobată de Răzvan):
-- autorizațiile introduse în fișa HR apar AUTOMAT în „Formare profesională (2 ani)", fără dublă introducere.
-- Sursă unică de adevăr: `hr_autorizatii` rămâne singurul loc unde se introduce o autorizație;
-- registrul `hr_formare_profesionala` ține doar cursurile care NU sunt autorizații (introduse manual).
-- View-ul le unește — nimic nu se copiază, deci nu există sincronizare care să se desincronizeze:
-- o autorizație modificată / ștearsă (soft delete) în HR se vede imediat și în Formare.
--
-- Ce NU e curs de formare (aceeași regulă ca în UI, TKT-2026-0303): categoriile `medical`
-- (fișa de aptitudini, avizul psihologic — cazul semnalat în tichet) și `altele`, plus permisele,
-- cardul tahograf și declarațiile.
-- Anti-dublură: dacă o autorizație a fost deja confirmată manual în registru (butonul vechi „↳ adaugă":
-- același angajat + același tip + aceeași dată), apare o singură dată — rândul din registru.
-- Drepturi: security_invoker → se aplică RLS-ul tabelelor de bază (nimic nou acordat).

CREATE OR REPLACE FUNCTION public.hr_autorizatie_e_curs(p_categorie text, p_denumire text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT NOT (coalesce(p_categorie, '') IN ('medical', 'altele')
              OR btrim(coalesce(p_denumire, '')) ~* '^(permis|card tahograf|declara)');
$$;
COMMENT ON FUNCTION public.hr_autorizatie_e_curs(text, text) IS
  'TKT-2026-0308: true dacă un tip de autorizație provine dintr-un curs de formare (nu fișă medicală / permis / declarație).';
-- funcție pură, fără acces la date: rămâne apelabilă de authenticated (o folosește view-ul cu security_invoker)
REVOKE ALL ON FUNCTION public.hr_autorizatie_e_curs(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_autorizatie_e_curs(text, text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_hr_formare_cursuri WITH (security_invoker = on) AS
SELECT
  'registru'::text            AS sursa,
  f.id                         AS id,
  f.id                         AS registru_id,
  NULL::bigint                 AS autorizatie_id,
  f.employee_id,
  f.data_curs,
  f.tema,
  f.tip_autorizatie_id,
  f.furnizor,
  f.numar_certificat,
  f.durata_ore,
  f.observatii,
  NULL::text                   AS fisier_nume,
  f.created_at
FROM public.hr_formare_profesionala f
UNION ALL
SELECT
  'autorizatie'::text,
  -a.id,                                          -- id negativ: unic în view, nu se ciocnește cu registrul
  NULL::bigint,
  a.id,
  a.employee_id::integer,
  a.data_emitere,
  t.denumire,
  a.tip_id,
  a.emitent,
  a.numar_autorizatie,
  NULL::numeric,
  a.observatii,
  a.fisier_nume,
  a.uploadat_la
FROM public.hr_autorizatii a
JOIN public.hr_autorizatii_tipuri t ON t.id = a.tip_id
WHERE a.deleted_at IS NULL
  AND a.data_emitere IS NOT NULL
  AND a.data_emitere <= current_date
  AND public.hr_autorizatie_e_curs(t.categorie, t.denumire)
  AND NOT EXISTS (SELECT 1 FROM public.hr_formare_profesionala f
                  WHERE f.employee_id = a.employee_id
                    AND f.tip_autorizatie_id = a.tip_id
                    AND f.data_curs = a.data_emitere);

COMMENT ON VIEW public.v_hr_formare_cursuri IS
  'TKT-2026-0308: cursurile de formare = registrul manual + autorizațiile din HR (fără medicale/permise). Sursa „autorizatie" se editează doar în fișa HR.';

GRANT SELECT ON public.v_hr_formare_cursuri TO authenticated, service_role;
REVOKE ALL ON public.v_hr_formare_cursuri FROM anon;
