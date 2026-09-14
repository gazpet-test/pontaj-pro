-- PR 1 Laza (14.09.2026): poarta trebuie sa vada graficul ASA CUM A FOST DECLARAT (es/ef/predecesori
-- din ultima versiune inghetata), ca sa poata verifica daca relatiile declarate si datele declarate
-- pot fi amandoua adevarate. La Laza 16 din 66 relatii „FS" aveau ES(succesor) < EF(predecesor);
-- nimeni n-a vazut, pentru ca graficul era in Word, nu in grafic_versiuni.
--
-- Coloane noi, LA COADA (CREATE OR REPLACE VIEW nu insereaza la mijloc si nu schimba tipuri):
--   grafic_activitati_declarate jsonb — activitati din ultima grafic_versiuni.activitati
--   grafic_versiune_mod text          — 'oferta' | 'intern' | 'import' (de unde vine versiunea)
-- Pattern: se citeste definitia curenta si se insereaza inainte de „FROM ofertare_licitatii l",
-- ca sa nu rescriem de mana un view de 300 de linii. Aplicata prin MCP (apply_migration
-- ofertare_pt_stare_grafic_declarat, 14.09.2026).
DO $$
DECLARE
  def text;
  ancora text := E'\n   FROM ofertare_licitatii l\n';
  noi text := E',\n    ( SELECT g.activitati FROM grafic_versiuni g WHERE g.licitatie_id = l.id ORDER BY g.versiune DESC LIMIT 1) AS grafic_activitati_declarate,\n    ( SELECT g.mod FROM grafic_versiuni g WHERE g.licitatie_id = l.id ORDER BY g.versiune DESC LIMIT 1) AS grafic_versiune_mod';
BEGIN
  def := pg_get_viewdef('public.v_ofertare_pt_stare'::regclass, true);
  IF position('grafic_activitati_declarate' in def) > 0 THEN
    RAISE NOTICE 'coloanele exista deja';
    RETURN;
  END IF;
  IF position(ancora in def) = 0 THEN
    RAISE EXCEPTION 'ancora FROM ofertare_licitatii l negasita — view-ul s-a schimbat, verifica manual';
  END IF;
  def := replace(def, ancora, noi || ancora);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS ' || def;
END $$;
