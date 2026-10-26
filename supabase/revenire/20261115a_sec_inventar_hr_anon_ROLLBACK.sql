-- Revenire 20261115a: politicile și granturile EXACT ca înainte (citite pe prod 26.10.2026).
-- Atenție: redeschide expunerile. Se rulează doar cu „da”, într-o singură tranzacție.

DROP POLICY mia_select ON public.magazie_inventar_angajat;
DROP POLICY mia_insert ON public.magazie_inventar_angajat;
DROP POLICY mia_update ON public.magazie_inventar_angajat;
DROP POLICY mia_delete ON public.magazie_inventar_angajat;

CREATE POLICY mia_select ON public.magazie_inventar_angajat FOR SELECT TO authenticated USING (true);
CREATE POLICY mia_insert ON public.magazie_inventar_angajat FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY mia_update ON public.magazie_inventar_angajat FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY mia_delete ON public.magazie_inventar_angajat FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON public.hr_aprobatori, public.hr_cereri_concediu, public.hr_concediu_rute, public.magazie_inventar_angajat
  TO anon;
