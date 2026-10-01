-- ============================================================================
-- Teste SEC RSVTI P1b + jurnal A — 20261005a_sec_rsvti_p1b_jurnal_insert.sql.
-- Rulează doar prin scripts/test_sec_rsvti_p1b.sh (PG17 local, schelet sec_rsvti_schelet.sql + 20261003c + fixture).
-- Totul într-o tranzacție anulată la final.
--   -v gaura=true  → starea de după 20261003c (live 01.10): atacurile P1b/jurnal TREBUIE să reușească;
--   -v gaura=false → după 20261005a: atacurile refuzate (42501), traseele legitime trec (implicit).
-- ============================================================================
\set ON_ERROR_STOP on
\if :{?gaura}
\else
  \set gaura false
\endif
\set u_owner 00000000-0000-4000-8000-000000000121
\set u_hr    00000000-0000-4000-8000-00000000a003
\set u_ex    00000000-0000-4000-8000-00000000b001

BEGIN;
SELECT teste.assert(current_database() ~ '_test$', 'P0 baza este una locală *_test');
SELECT teste.ca_admin();
INSERT INTO auth.users (id, email) VALUES (:'u_owner', 'owner@test'), (:'u_hr', 'hr@test'), (:'u_ex', 'ex@test');
INSERT INTO public.profiles (id, email, name, role, department, is_owner, can_modify_employees) VALUES
  (:'u_owner', 'owner@test', 'OWNER',            'manager_santier', NULL,       true,  false),
  (:'u_hr',    'hr@test',    'DEPT HR',          'manager_santier', 'HR',       false, false),
  (:'u_ex',    'ex@test',    'EXECUTIE (RSVTI)', 'manager_santier', 'Execuție', false, false);
INSERT INTO public.employees (name) VALUES ('P1B SUDOR 1') RETURNING id AS emp1 \gset
INSERT INTO public.hr_autorizatii_tipuri (cod, denumire, necesita_confirmare_rsvti, interval_confirmare_rsvti_luni)
  VALUES ('P1B_SUDOR', 'Sudor (viză 6 luni)', true, 6) RETURNING id AS t6 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp1, :t6, 'A1', '2025-01-01') RETURNING id AS a1 \gset
INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, data_emitere)
  VALUES (:emp1, :t6, 'A2', '2025-01-01') RETURNING id AS a2 \gset
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii WHERE id IN (:a1, :a2)) = 2, 'P0 pregătire: 2 autorizații fără viză (INSERT admin fără rsvti_* trece)');

-- ---------------------------------------------------------------- traseul legitim: HR prin RPC
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.reuseste(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L, %L)', :a1, '2026-09-15', 'viza P1b'), 'P1 HR prin RPC: confirmare OK');
SELECT teste.ca_admin();
SELECT teste.assert((SELECT rsvti_ultima_confirmare = '2026-09-15' AND rsvti_urmatoarea_confirmare = '2027-03-15'
                            AND rsvti_confirmat_de = :'u_hr' AND rsvti_observatii = 'viza P1b'
                       FROM public.hr_autorizatii WHERE id = :a1), 'P1 fișa actualizată de RPC (data, scadența +6 luni, atribuire, observație)');
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari WHERE autorizatie_id = :a1 AND confirmat_de = :'u_hr') = 1, 'P1 jurnalul scris de RPC');
SELECT teste.assert(current_setting('gazpet.rsvti_rpc', true) IS NULL OR current_setting('gazpet.rsvti_rpc', true) = '', 'P1 marcajul e golit după RPC');

-- ---------------------------------------------------------------- HR: alte coloane = OK
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.assert(teste.reuseste(format('UPDATE public.hr_autorizatii SET numar_autorizatie = %L, observatii = %L, modificat_la = now() WHERE id = %s', 'A1-bis', 'obs', :a1),
                    'P2 HR UPDATE pe alte coloane') = 1, 'P2 exact 1 rând');
SELECT teste.assert(teste.reuseste(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = rsvti_urmatoarea_confirmare, emitent = %L WHERE id = %s', 'ISCIR', :a1),
                    'P2 HR UPDATE cu rsvti_* NESCHIMBATE (PATCH cu aceeași valoare)') = 1, 'P2 exact 1 rând');
SELECT teste.reuseste(format('INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie) VALUES (%s, %s, %L)', :emp1, :t6, 'A3'), 'P2 HR INSERT fără rsvti_* (Adaugă / Reînnoiește)');
SELECT teste.reuseste(format('UPDATE public.hr_autorizatii SET deleted_at = now() WHERE numar_autorizatie = %L', 'A3'), 'P2 HR ștergere logică');

-- ---------------------------------------------------------------- HR: rsvti_* direct
\if :gaura
SELECT teste.reuseste(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L, rsvti_confirmat_de = %L WHERE id = %s', '2099-01-01', :'u_owner', :a1), 'G1 GAURA: HR scrie direct scadența 2099 + atribuire falsă');
SELECT teste.reuseste(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de, created_at) VALUES (%s, %s, %L, %L, %L, %L)', :a1, :emp1, '2099-01-01', '2099-07-01', :'u_hr', '2099-01-01'), 'G2 GAURA: HR inserează direct în jurnal (dată + created_at 2099)');
\else
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P3 HR UPDATE rsvti_urmatoarea_confirmare → refuz', '42501', 'Confirmă viza');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_ultima_confirmare = %L WHERE id = %s', '2026-09-30', :a1), 'P3 HR UPDATE rsvti_ultima_confirmare → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_confirmat_de = %L WHERE id = %s', :'u_owner', :a1), 'P3 HR UPDATE rsvti_confirmat_de (atribuire falsă) → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_confirmat_la = now() - interval %L WHERE id = %s', '1 year', :a1), 'P3 HR UPDATE rsvti_confirmat_la → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_observatii = %L WHERE id = %s', 'x', :a1), 'P3 HR UPDATE rsvti_observatii → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_observatii = NULL WHERE id = %s', :a1), 'P3 HR golește rsvti_observatii (→ NULL) → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_ultima_confirmare = %L WHERE id = %s', '2026-01-01', :a2), 'P3 HR pune viză pe o autorizație fără viză (NULL → dată) → refuz', '42501');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, rsvti_urmatoarea_confirmare) VALUES (%s, %s, %L, %L)', :emp1, :t6, 'A4', '2099-01-01'), 'P3 HR INSERT cu rsvti_* → refuz', '42501');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii (employee_id, tip_id, numar_autorizatie, rsvti_observatii) VALUES (%s, %s, %L, %L)', :emp1, :t6, 'A5', 'x'), 'P3 HR INSERT doar cu rsvti_observatii → refuz', '42501');
-- marcaj falsificat de HR în propria tranzacție (SQL direct; prin REST nu e posibil): current_user = authenticated ⇒ refuz
SELECT set_config('gazpet.rsvti_rpc', txid_current()::text || ':' || :a1, true);
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P4 HR cu marcaj FALSIFICAT (txid:id corect) → refuz (current_user ≠ proprietarul RPC)', '42501');
SELECT set_config('gazpet.rsvti_rpc', '', true);
SELECT teste.asteapta_eroare(format('SELECT public.fn_hr_autorizatii_rsvti_marcaj(%s)', :a1), 'P4 HR nu poate apela helperul de marcaj', '42501');
-- jurnal: INSERT direct (varianta A)
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)', :a1, :emp1, '2026-09-20', '2027-03-20', :'u_hr'), 'P5 HR INSERT direct în jurnal (în nume propriu) → refuz', '42501');
SELECT teste.ca_utilizator(:'u_owner');
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, data_confirmare, urmatoarea_confirmare, confirmat_de) VALUES (%s, %s, %L, %L, %L)', :a1, :emp1, '2026-09-20', '2027-03-20', :'u_owner'), 'P5 owner INSERT direct în jurnal → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P5 owner UPDATE direct rsvti_* → refuz (doar prin RPC)', '42501');
SELECT teste.reuseste(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L)', :a2, '2026-09-20'), 'P5 owner prin RPC: OK');
SELECT teste.ca_utilizator(:'u_ex');
SELECT teste.asteapta_eroare(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L)', :a1, '2026-09-20'), 'P5 Execuție prin RPC → refuz (poarta 20261003c neschimbată)', '42501');
SELECT teste.ca_anon();
SELECT teste.asteapta_eroare(format('INSERT INTO public.hr_autorizatii_rsvti_confirmari (autorizatie_id, employee_id, urmatoarea_confirmare) VALUES (%s, %s, %L)', :a1, :emp1, '2027-01-01'), 'P5 anon INSERT în jurnal → refuz', '42501');
-- service_role (BYPASSRLS) și login-ul postgres fără marcaj: refuz
SELECT teste.ca_service_role();
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P6 service_role UPDATE direct rsvti_* → refuz', '42501');
SELECT teste.reuseste(format('UPDATE public.hr_autorizatii SET observatii = %L WHERE id = %s', 'sr', :a1), 'P6 service_role alte coloane: OK');
SELECT teste.ca_admin();
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P6 postgres fără marcaj → refuz', '42501');
-- marcajul e legat de id: marcaj pentru a1, UPDATE pe a2 ⇒ refuz
SELECT set_config('gazpet.rsvti_rpc', txid_current()::text || ':' || :a1, true);
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a2), 'P7 marcaj pentru ALT rând → refuz', '42501');
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id IN (%s, %s)', '2099-01-01', :a1, :a2), 'P7 UPDATE multi-rând cu marcaj pentru unul → refuz (tot statement-ul)', '42501');
-- marcajul e legat de txid: valoare dintr-o tranzacție anterioară ⇒ refuz
SELECT set_config('gazpet.rsvti_rpc', (txid_current() - 1)::text || ':' || :a1, true);
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P7 marcaj cu alt txid → refuz', '42501');
SELECT set_config('gazpet.rsvti_rpc', '', true);
-- după RPC (aceeași tranzacție) marcajul e golit ⇒ un UPDATE ulterior al proprietarului e refuzat
SELECT teste.ca_utilizator(:'u_hr');
SELECT teste.reuseste(format('SELECT public.confirm_hr_autorizatie_rsvti(%s, %L)', :a1, '2026-09-25'), 'P8 HR prin RPC (a doua confirmare)');
SELECT teste.ca_admin();
SELECT teste.asteapta_eroare(format('UPDATE public.hr_autorizatii SET rsvti_urmatoarea_confirmare = %L WHERE id = %s', '2099-01-01', :a1), 'P8 după RPC, în aceeași tranzacție, postgres fără marcaj → refuz (marcaj golit)', '42501');
SELECT teste.assert((SELECT rsvti_urmatoarea_confirmare FROM public.hr_autorizatii WHERE id = :a1) = '2027-03-25', 'P8 fișa = ultima confirmare prin RPC, nimic din atacuri');
SELECT teste.assert((SELECT count(*) FROM public.hr_autorizatii_rsvti_confirmari) = 3, 'P8 jurnalul = exact cele 3 confirmări prin RPC');
\endif

ROLLBACK;
\echo 'SUITA P1b TRECUTĂ'
