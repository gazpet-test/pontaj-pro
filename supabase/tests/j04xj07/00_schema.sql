-- JX-00 · Schema instalată: ordinea J04 → J07, reaplicare idempotentă, ambele porți active pe aprobat→depus.
BEGIN;
SELECT jx.start('JX-00', 'schema: J04→J07 aplicate și reaplicate fără diferențe; 3 triggere BEFORE active (matrice → J07 → J04); R5/R11/J05/matrice/politici neatinse');
:admin
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM jx.dupa_prima_aplicare a JOIN pg_proc p ON p.proname = a.proname
  AND p.pronamespace = 'public'::regnamespace WHERE pg_get_functiondef(p.oid) <> a.def), 'Reaplicarea J04→J07 este idempotentă');
-- Triggerele de UPDATE (tranziția) — ordinea de execuție matrice → documentație/J07 → depus/J04; separat, garda de DELETE (C3, 06.10).
SELECT jx.egal((SELECT jsonb_agg(tgname::text ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'ofertare_pt_pachet'::regclass AND NOT tgisinternal AND tgenabled = 'O'
    AND (tgtype & 16) <> 0),
  '["trg_ofertare_pt_pachet_matrice","trg_ofertare_pt_pachet_poarta_documentatie","trg_pt_pachet_depus_verifica"]',
  'Pachet: exact 3 triggere de UPDATE active, în ordinea de execuție matrice → documentație/J07 → depus/J04');
SELECT jx.egal((SELECT jsonb_agg(tgname::text ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'ofertare_pt_pachet'::regclass AND NOT tgisinternal AND tgenabled = 'O'
    AND (tgtype & 8) <> 0),
  '["trg_pt_pachet_delete_garda"]', 'Pachet: garda de DELETE (C3) activă — doar pachetul propus se retrage');
SELECT jx.ok(position('-- J07 BEGIN' IN pg_get_functiondef('fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure)) > 0
  AND position('ofertare_r5_blocaj_sursa' IN pg_get_functiondef('fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure)) > 0, 'J07 + R5 în triggerul de documentație');
SELECT jx.ok(position('ofertare_pt_pachet_verificari' IN pg_get_functiondef('fn_pt_pachet_depus_verifica()'::regprocedure)) > 0
  AND position('dovada_seap' IN pg_get_functiondef('fn_pt_pachet_depus_verifica()'::regprocedure)) > 0, 'J04 + R11 în triggerul depus');
SELECT jx.ok(position('-- J07 BEGIN' IN pg_get_functiondef('fn_gate_depunere()'::regprocedure)) > 0
  AND position('ofertare_derogari_audit' IN pg_get_functiondef('fn_gate_depunere()'::regprocedure)) > 0, 'Licitație depusă: J07 + J05 în gate');
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM jx.functii_inainte b JOIN pg_proc p USING (oid) WHERE p.proname NOT IN
  ('fn_gate_depunere', 'fn_ofertare_pt_pachet_poarta_documentatie', 'fn_pt_pachet_depus_verifica') AND pg_get_functiondef(p.oid) <> b.def),
  'Matrice / R5 / J05 nemodificate de J04+J07');
SELECT jx.ok(NOT EXISTS (SELECT 1 FROM jx.politici_inainte b LEFT JOIN pg_policy p USING (oid) WHERE p.oid IS NULL OR to_jsonb(p) <> b.def),
  'Politicile existente (inclusiv Storage R12) nemodificate');
SELECT jx.trecut('JX-00');
ROLLBACK;
SELECT jx.baza_intacta('JX-00');
