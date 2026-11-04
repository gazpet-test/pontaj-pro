-- Schelet LOCAL suplimentar pentru 20261130i_redari_sms_stare (PG17 de unica folosinta). Se ruleaza DUPA 20261130a_sms_mvp_schelet.sql
-- si dupa aplicarea migrarii 20261130a. Reproduce ce citeste 20261130i in plus:
--   * fn_red_nivel() — textul live (citit read-only 04.11.2026);
--   * proiectul TEST-RAZVAN cu un UAT, 3 parcele si 3 detinatori, + un alt proiect cu o parcela si un detinator;
--   * „lotul real” al lui Razvan imitat: un lot redari coada_golita pe TEST-RAZVAN cu 1 mesaj livrat catre primul detinator
--     (inserat cu triggerele SMS oprite, apoi repornite);
--   * profilul a5 fara niciun modul (contul „fara acces” din DRY).
-- NU se ruleaza pe productie.
CREATE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN 'admin'
    ELSE (SELECT uma.access_level FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'redari')
  END;
$f$;
INSERT INTO public.profiles (id, email, name, is_owner) VALUES ('00000000-0000-0000-0000-0000000000a5', 'test5.test@exemplu.local', 'PROFIL TEST CINCI', false);
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES
  ('00000000-0000-0000-0000-00000000b001', 'TEST-RAZVAN', 'Proiect test'), ('00000000-0000-0000-0000-00000000b002', 'ALT-TEST', 'Alt proiect');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'Test', 'TST'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000b002', 'Alt', 'ALT');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-0001'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-0002'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-0003'),
  ('00000000-0000-0000-0000-00000000d009', '00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000c002', 'ALT-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', 'TEST UNU', 'TEST UNU', 'proprietar'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000d002', 'TEST DOI', 'TEST DOI', 'proprietar'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000d003', 'TEST TREI', 'TEST TREI', 'proprietar'),
  ('00000000-0000-0000-0000-00000000e009', '00000000-0000-0000-0000-00000000d009', 'ALT UNU', 'ALT UNU', 'proprietar');
ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje DISABLE TRIGGER trg_sms_mesaje_reguli;
INSERT INTO public.sms_loturi (id, categorie, text, stare, proiect_id, uat_id, nr_destinatari, cost_estimat_eur, aprobat_de, aprobat_la, aprobat_autorizare_nr, aprobat_autorizare_data)
  VALUES ('00000000-0000-0000-0000-00000000f001', 'redari', 'Lot test Razvan', 'coada_golita', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001',
          1, 0.05, '00000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', 'TEST', current_date);
INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id, stare, furnizor, furnizor_id, rezervat_la, trimis_la, livrat_la)
  VALUES ('00000000-0000-0000-0000-00000000f001', '+40700000801', 'detinator', '00000000-0000-0000-0000-00000000e001', 'livrat', 'simulator', 'test-razvan-1',
          now() - interval '50 minutes', now() - interval '50 minutes', now() - interval '49 minutes');
ALTER TABLE public.sms_loturi ENABLE TRIGGER trg_sms_loturi_reguli;
ALTER TABLE public.sms_mesaje ENABLE TRIGGER trg_sms_mesaje_reguli;
