-- JX-MX · Teste adăugate după verificarea prin MUTAȚII a suitei (29.09): fiecare ucide un mutant care trecea de
-- suita de 68 de teste (catalogul: scripts/pg/fixtures/j04xj07_mutanti.mjs; tabelul: docs/AUDIT_OFERTARE_V2/
-- J04xJ07_INTEGRARE_TESTE.md). Regula dovedită aici (PLAN §2 J07): „o eroare internă = BLOCK”, pe TOATE căile — cele 5
-- funcții SQL cu handler de excepție propriu (M16b), căile „date indisponibile” (M16c) și evaluatorul text (M16f);
-- plus independența celor două straturi ale garanției (M09s) și „doar un rând PASS e dovadă J04” (X01c).
-- (Append-only pe superuser — M19b / X19e — e acoperit în JX-08b.) Fiecare: BEGIN … ROLLBACK + jx.baza_intacta.

-- JX-MX-16a ────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-MX-16a', 'eroare internă REALĂ într-un control SQL (grafic scris de om / AI cu „es” nenumeric) → grafic_relatii undetermined, nu ok → REFUZ; celelalte 11 ok, J04 PASS');
:editor
INSERT INTO grafic_versiuni(licitatie_id, versiune, activitati) VALUES (1, 2,
  '[{"id":"A","durata_zile":5,"es":"x","ef":5,"predecesori":[]},{"id":"B","durata_zile":3,"es":6,"ef":8,"predecesori":[{"id":"A","relatie":"FS"}]}]');
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS (nu J04 refuză)');
SELECT jx.egal(jx.control(1, 'grafic_relatii')->'stare', '"undetermined"', 'eroarea de conversie devine undetermined, nu ok');
SELECT jx.ok(jx.control(1, 'grafic_relatii')->>'detalii' LIKE '%invalid input syntax%', 'motivul e eroarea SQL reală');
SELECT jx.egal(jx.blocaje(1), '["grafic_relatii"]', 'doar controlul cu eroare internă blochează');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["grafic_relatii"]');
SELECT jx.trecut('JX-MX-16a');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-16a');

-- JX-MX-16b ────────────────────────────────────────────────────────────────────────────────────────────
-- Tehnica din JX-02c / JX-06a: obiectul de BD e înlocuit în tranzacția testului (dispare la ROLLBACK). Aici sursa comună
-- a controalelor (v_ofertare_pt_stare) aruncă la citire (22012): fiecare control trebuie să-și prindă eroarea ca BLOCK.
BEGIN;
SELECT jx.start('JX-MX-16b', 'eroare internă în sursa comună (v_ofertare_pt_stare aruncă la citire) → TOATE cele 12 controale undetermined (fail-closed pe fiecare handler de excepție) → REFUZ');
-- @edge j04 1
-- @edge j07 1
:admin
SELECT jx.egal(jx.blocaje(1), '[]', 'pornim de la J04 + J07 OK');
DO $v$ BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS SELECT * FROM ('
    || rtrim(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass, true), E';\n ')
    || ') x WHERE 1 / (SELECT count(*) FROM public.ofertare_pt_pachet WHERE false)::int = 1';
END $v$;
SELECT jx.refuza($$SELECT count(*) FROM public.v_ofertare_pt_stare$$, '22012', 'division by zero');
SELECT jx.egal(jx.blocaje(1), '["cuprins","neverificate","capcane","goale","nescrise","cantitati_f3_grafic","garantie","anexe","numere","pachet","grafic_relatii","grafic_sursa"]',
  'fiecare control prinde eroarea și dă undetermined (fail-closed)');
SELECT jx.ok((SELECT bool_and(c->>'stare' = 'undetermined') FROM jsonb_array_elements(ofertare_poarta_server(1)->'controale') c), 'toate undetermined, niciunul ok');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.trecut('JX-MX-16b');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-16b');

-- JX-MX-16c ────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-MX-16c', 'date indisponibile fără excepție (licitația lipsește din v_ofertare_pt_stare: st NULL, contor NULL) → TOATE cele 12 controale undetermined → REFUZ');
-- @edge j04 1
-- @edge j07 1
:admin
DO $v$ BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS SELECT * FROM ('
    || rtrim(pg_get_viewdef('public.v_ofertare_pt_stare'::regclass, true), E';\n ') || ') x WHERE false';
END $v$;
SELECT jx.egal(jx.blocaje(1), '["cuprins","neverificate","capcane","goale","nescrise","cantitati_f3_grafic","garantie","anexe","numere","pachet","grafic_relatii","grafic_sursa"]',
  'lipsa datelor nu e verde pe niciun control');
SELECT jx.ok((SELECT bool_and(c->>'stare' = 'undetermined') FROM jsonb_array_elements(ofertare_poarta_server(1)->'controale') c), 'toate undetermined, niciunul ok');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.trecut('JX-MX-16c');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-16c');

-- JX-MX-16f ────────────────────────────────────────────────────────────────────────────────────────────
-- Contract rupt între sursa SQL și edge (ex. o migrare ulterioară redenumește o coloană a view-ului, edge-ul rămâne
-- același): sursa J07 se citește (200), dar îi lipsește un câmp cerut de evaluator → evaluatorul REAL aruncă pe acel
-- control → rezultatul persistat trebuie să fie undetermined, nu ok.
BEGIN;
SELECT jx.start('JX-MX-16f', 'contract rupt sursă SQL ↔ evaluator (coloana fraze_anexe redenumită în v_ofertare_pt_stare): evaluatorul REAL aruncă pe anexe → undetermined persistat (nu ok) → REFUZ [anexe]');
:admin
ALTER VIEW public.v_ofertare_pt_stare RENAME COLUMN fraze_anexe TO fraze_anexe_redenumita;
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'true', 'J04 PASS (nu J04 refuză)');
SELECT jx.egal((SELECT jsonb_object_agg(x->>'control_code', x->>'stare') FROM jsonb_array_elements(jx.ultim('j07')->'rezultate') x),
  '{"anexe":"undetermined","garantie":"ok","numere":"ok","pachet":"ok"}', 'evaluatorul: excepția pe anexe devine undetermined; celelalte 3 ok');
SELECT jx.egal((SELECT x->'detalii'->'eroare' FROM jsonb_array_elements(jx.ultim('j07')->'rezultate') x WHERE x->>'control_code' = 'anexe'),
  '"Câmpuri lipsă în sursa curentă"', 'motivul excepției e persistat în detalii');
SELECT jx.egal(jx.blocaje(1), '["anexe"]', 'doar controlul cu eroare de evaluare blochează');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["anexe"]');
SELECT jx.trecut('JX-MX-16f');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-16f');

-- JX-MX-09s ────────────────────────────────────────────────────────────────────────────────────────────
-- Garanția are două straturi: ramura SQL structurată (live, în trigger) și rezultatul text al evaluatorului. Aici textul e
-- forțat „ok” (un evaluator vechi / defect, cu cheia de serviciu, pe hash-ul curent): ramura SQL trebuie să blocheze singură.
BEGIN;
SELECT jx.start('JX-MX-09s', 'garanția STRUCTURATĂ (24 < 36) blochează independent de text: și cu un rezultat text „ok” pe hash-ul curent → REFUZ [garantie], detaliul din SQL');
:editor
UPDATE ofertare_pt_garantie SET oferit_luni = 24 WHERE licitatie_id = 1;
-- @edge j04 1
-- @edge j07 1
:service
INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
VALUES ('garantie', 1, :'parser_edge', public.ofertare_poarta_text_sursa(1)->>'sursa_hash', 'ok', '{"simulat":"evaluator text vechi/defect"}');
:admin
SELECT jx.egal(jx.control(1, 'garantie')->'detalii', to_jsonb('Garanția oferită lipsește sau diferă de minimul / momentul cerut'::text),
  'blocajul vine din partea structurată (SQL, live), nu din rezultatul text');
SELECT jx.egal(jx.blocaje(1), '["garantie"]', 'blocaje = [garantie]');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante: ["garantie"]');
SELECT jx.trecut('JX-MX-09s');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-09s');

-- JX-MX-01c ────────────────────────────────────────────────────────────────────────────────────────────
-- Edge-ul J04 persistă și REFUZ-uri cu SHA-ul calculat egal cu manifestul și cu identitatea obiectului curent (aici:
-- metadatele spun 999 de octeți, bytes-ii sunt 8). Un astfel de rând NU e dovadă: J04 cere rezultat = PASS.
BEGIN;
SELECT jx.start('JX-MX-01c', 'REFUZ al edge-ului cu SHA = manifest și identitatea curentă (dimensiune din metadate ≠ bytes) nu ține loc de PASS → REFUZ J04 (J07 permisivă)');
:admin
UPDATE storage.objects SET updated_at = updated_at + interval '1 second', metadata = jsonb_set(metadata, '{size}', '999')
WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf';
-- @edge j04 1
-- @edge j07 1
SELECT jx.egal(jx.ultim('j04')->'ok', 'false', 'edge-ul J04 nu confirmă pachetul');
SELECT jx.ok((SELECT rezultat = 'REFUZ' AND motiv = 'dimensiunea descărcată diferă de snapshot' AND sha256_calculat = sha256_declarat
    AND obj_size = 999 AND obj_id = (SELECT id FROM storage.objects WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf')
  FROM ofertare_pt_pachet_verificari WHERE fisier_path = 'pt/1/v1/depus/depus_final_Final.pdf' ORDER BY id DESC LIMIT 1),
  'REFUZ persistat cu SHA egal cu manifestul și identitatea obiectului curent');
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 permisivă');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'Final.pdf: verificare PASS lipsă');
SELECT jx.trecut('JX-MX-01c');
ROLLBACK;
SELECT jx.baza_intacta('JX-MX-01c');
