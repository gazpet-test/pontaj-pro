-- R3 — PREVIEW corecturi stări citire planșe (25.09.2026). NIMIC APLICAT.
-- Ordinea: rulezi SELECT-urile → Razvan confirmă → decomentezi UPDATE-ul respectiv (execute_sql) → sanity SELECT.
-- Fiecare UPDATE: RETURNING + backup (analiza/status/eroare vechi) + gardă md5(analiza) = hash-ul din preview
-- (dacă rândul s-a schimbat între preview și apply, UPDATE-ul nu atinge nimic → se refac preview-ul).

-- ═══ 1. PREVIEW (RULAT prin MCP, 25.09.2026) ═════════════════════════════════════════════════════
SELECT id, licitatie_id, status_procesare, eroare,
       analiza->'plansa'->>'rezultat' rezultat, analiza->'plansa'->>'vectorial' vect,
       analiza->'plansa'->>'latime' l, analiza->'plansa'->>'inaltime' h,
       jsonb_array_length(coalesce(analiza->'citire_ai'->'felii','[]')) felii,
       jsonb_array_length(coalesce(analiza->'plansa'->'zone_asteptate','[]')) zone_asteptate,
       analiza->'citire_ai'->'sumar'->>'erori' erori, analiza->'citire_ai'->'sumar'->'zone_lipsa' zone_lipsa,
       analiza->'citire_ai'->'sumar'->>'tronsoane_gasite' tronsoane,
       analiza->'plansa' ? 'sursa_sigla_dovedita' are_dovada, md5(analiza::text) hash
FROM ofertare_documente_atribuire WHERE id IN (130,470,471,472,473,474,475,1035) ORDER BY id;
-- Rezultat (total docuri cu `plansa`: 8):
-- id  | lic | status     | eroare                          | rez  | vect | L×H        | felii | zone_ast | erori | tr  | dovadă | hash
-- 130 | 3   | partial    | 1 pagină necitită: 1            | null | –    | 9957×14145 | 35    | 0        | 0     | 24  | nu     | ff3efcd9636733ae06553afc2471a272
-- 470 | 95  | procesat   | 1 zone necitite (se pot relua)  | null | true | 9362×6623  | 35    | 35       | 1     | 131 | nu     | 032b9a44a342670f7bc75fed63c12905
-- 471 | 95  | procesat   | citită fără rezultat            | null | true | 7017×9934  | 40    | 40       | 0     | 0   | nu     | 20babbd9cbdd757d32d7c24cb0235c55
-- 472 | 95  | procesat   | –                               | null | –    | 900×450    | 1     | 0        | 0     | 0   | nu     | 8612a1be486c82b4712a7f44d0bb6391
-- 473 | 95  | procesat   | –                               | null | –    | 900×450    | 1     | 0        | 0     | 0   | nu     | ac56ae8cd2983f5e8fa5c2adf3d4bb66
-- 474 | 95  | procesat   | –                               | null | –    | 900×450    | 1     | 0        | 0     | 0   | nu     | a196b4d171744a7b22dac19fec95da96
-- 475 | 95  | procesat   | citită fără rezultat            | null | true | 7017×4963  | 20    | 20       | 0     | 0   | nu     | 03e2cebb66f28bc944b54db3a8ce99c3
-- 1035| 102 | neprocesat | –                               | null | –    | –          | 0     | 0        | –     | –   | nu     | c619e98a384a006cc25239ce842dc4f9
-- Felii cu text recunoscut (cartuș/mențiuni/noduri): 471 = 40/40, 475 = 20/20 ⇒ lectură COMPLETĂ, fără date cantitative.
-- Breakdown propus: partial 2 (130 rămâne, 470 reclasificat) · citita_fara_date_cantitative 2 (471, 475)
--                   · de_randat 3 (472–474: FĂRĂ dovadă de siglă ⇒ NU sursa_gresita_sigla) · 1035 randare întâi, fără UPDATE.

SELECT id, status, origine, cheie, sursa, left(intrebare, 90) inceput, md5(intrebare) hash_text, updated_at
FROM ofertare_clarificari WHERE id = 63;
-- Rezultat: propunere · automat · auto_planse_1 · planse_auto:475,471 · hash_text 6bd72fc31cd31ce8a32801d800cf65e3
-- Început: „Solicitare de clarificare — listele de cantități și lungimea rețelei de distribuție…”
--   ⇒ NU începe cu antetul standard v3 ⇒ tratat ca text EDITAT DE OM ⇒ v3/v4 nu-l suprascriu.
-- Coloane ofertare_clarificari (information_schema): id, licitatie_id, nr, intrebare, sursa, cantitate_id, status
--   (CHECK: propunere/de_trimis/trimisa/raspunsa/retrasa), raspuns, raspuns_la, created_at, updated_at, fisier_path,
--   origine, creat_de, citita_la, citita_rezumat, raspuns_document_id, cheie.
--   ⇒ NU există câmp note/meta/json potrivit pt „necesită revizie”. PROPUNERE (necreată) — vezi secțiunea 4.

-- ═══ 2. 470 → partial (reclasificare retroactivă a rezultatului EXISTENT, nu o versiune nouă de extractor) ══
-- WITH v AS (SELECT id, analiza, status_procesare, eroare FROM ofertare_documente_atribuire
--            WHERE id = 470 AND md5(analiza::text) = '032b9a44a342670f7bc75fed63c12905'),
-- u AS (UPDATE ofertare_documente_atribuire d SET analiza = jsonb_set(d.analiza, '{plansa}', d.analiza->'plansa' || jsonb_build_object(
--         'rezultat','partial', 'rezultat_motiv','lectură incompletă (1 zonă căzută)',
--         'rezultat_sursa','reclasificare_retroactiva_r3', 'rezultat_la', now()))
--       FROM v WHERE d.id = v.id RETURNING d.id)
-- SELECT array_agg(u.id) ids, jsonb_agg(jsonb_build_object('id',v.id,'analiza',v.analiza,'status',v.status_procesare,'eroare',v.eroare)) backup
-- FROM u JOIN v USING (id);
-- (status_procesare 'procesat' NU se schimbă aici — la „🔁 reia zonele căzute” edge-ul îl pune corect.)

-- ═══ 3. 471, 475 → citita_fara_date_cantitative (lectură completă verificată: 40/40 și 20/20, 0 erori, 0 lipsă) ══
-- WITH v AS (SELECT id, analiza, status_procesare, eroare FROM ofertare_documente_atribuire
--            WHERE (id, md5(analiza::text)) IN ((471,'20babbd9cbdd757d32d7c24cb0235c55'),(475,'03e2cebb66f28bc944b54db3a8ce99c3'))),
-- u AS (UPDATE ofertare_documente_atribuire d SET eroare = 'citită fără date cantitative',
--         analiza = jsonb_set(d.analiza, '{plansa}', d.analiza->'plansa' || jsonb_build_object(
--           'rezultat','citita_fara_date_cantitative',
--           'rezultat_motiv','nu au fost identificate date cantitative în lectura efectuată',
--           'rezultat_sursa','reclasificare_retroactiva_r3', 'rezultat_la', now())))
--       FROM v WHERE d.id = v.id RETURNING d.id)
-- SELECT array_agg(u.id) ids, jsonb_agg(jsonb_build_object('id',v.id,'analiza',v.analiza,'status',v.status_procesare,'eroare',v.eroare)) backup
-- FROM u JOIN v USING (id);

-- ═══ 4. 472–474 → NU sursa_gresita_sigla (nu există dovadă: semnale_sigla/bbox nu au fost calculate la citirea
--        veche). Stare: „de randat” = partial + motiv; dovada apare la retăiere (/api/plansa-felii, cost AI la citire,
--        poarta owner/responsabil). Opțional (confirmare): ──────────────────────────────────────────
-- WITH v AS (SELECT id, analiza, status_procesare, eroare FROM ofertare_documente_atribuire
--            WHERE (id, md5(analiza::text)) IN ((472,'8612a1be486c82b4712a7f44d0bb6391'),(473,'ac56ae8cd2983f5e8fa5c2adf3d4bb66'),(474,'a196b4d171744a7b22dac19fec95da96'))),
-- u AS (UPDATE ofertare_documente_atribuire d SET eroare = 'Sursă 900x450 fără dovadă de conținut — de randat pagina completă (retaie planșa)',
--         analiza = jsonb_set(d.analiza, '{plansa}', d.analiza->'plansa' || jsonb_build_object(
--           'rezultat','partial', 'rezultat_motiv','de_randat: sursă sub 2000px, siglă nedovedită',
--           'rezultat_sursa','reclasificare_retroactiva_r3', 'rezultat_la', now())))
--       FROM v WHERE d.id = v.id RETURNING d.id)
-- SELECT array_agg(u.id) ids, jsonb_agg(jsonb_build_object('id',v.id,'analiza',v.analiza,'status',v.status_procesare,'eroare',v.eroare)) backup
-- FROM u JOIN v USING (id);

-- ═══ 5. 1035 → întâi randare (retăiere din UI, ruta vectorială), NU clarificare, NU UPDATE manual. ═══════

-- ═══ 6. Clarificarea #63 — marcaj „necesită revizie — motiv de ilizibilitate infirmat” ═══════════════
-- Nu există câmp note/meta ⇒ fără schimbare de schemă, singurul loc existent e `sursa` (câmp mașină, parsat de
-- funcție cu filtrul x ~ '^\d+$' ⇒ un token nenumeric e ignorat). PROPUNERE — cere decizia lui Razvan (A/B):
--  A) marcaj în sursa (text uman neatins, istoric: vechiul `sursa` în backup):
-- WITH v AS (SELECT id, sursa, status, md5(intrebare) h FROM ofertare_clarificari
--            WHERE id = 63 AND status = 'propunere' AND md5(intrebare) = '6bd72fc31cd31ce8a32801d800cf65e3'),
-- u AS (UPDATE ofertare_clarificari c SET sursa = c.sursa || ',revizie_motiv_ilizibil_infirmat', updated_at = now()
--       FROM v WHERE c.id = v.id RETURNING c.id)
-- SELECT array_agg(u.id), jsonb_agg(to_jsonb(v)) backup FROM u JOIN v USING (id);
--     + adresa de clarificări (UI) trebuie să excludă `sursa LIKE '%revizie_%'` — schimbare de cod separată.
--  B) coloană nouă `meta jsonb` (schimbare de schemă — NU creată, doar propusă).
-- ATENȚIE: după v4 + UPDATE-urile 3, RPC-ul pe lic. 95 ar găsi ciorna ne-standard ⇒ păstrează textul, actualizează
-- doar sursa (planse_auto:471,475) ⇒ marcajul A s-ar pierde la acel apel. Ordinea sigură: v4 → rulează RPC → marcaj A.

-- ═══ 7. SANITY după apply ═══════════════════════════════════════════════════════════════════════════
-- SELECT analiza->'plansa'->>'rezultat' rezultat, count(*), array_agg(id ORDER BY id)
-- FROM ofertare_documente_atribuire WHERE analiza ? 'plansa' GROUP BY 1 ORDER BY 1;

-- ═══ APLICAT 25.09.2026 ~15:40 UTC (GO Razvan + acord Copilot) ═══════════════════════════════════
-- 470: status_procesare procesat → partial; plansa.rezultat='partial' (reclasificare_retroactiva_r3).
--   Gardă md5 032b9a44a342670f7bc75fed63c12905 → 1 rând (ids [470]).
--   Backup: status='procesat', eroare='1 zone necitite (se pot relua)', plansa fără cheile rezultat*.
--   Rollback: UPDATE ofertare_documente_atribuire SET status_procesare='procesat',
--     analiza = jsonb_set(analiza,'{plansa}', (analiza->'plansa') - 'rezultat' - 'rezultat_motiv' - 'rezultat_sursa' - 'rezultat_la')
--     WHERE id=470;

-- ═══ APLICAT 25.09.2026 ~15:50 UTC ═══════════════════════════════════════════════════════════════
-- 471–475 → status 'partial', plansa.rezultat='partial' (de_retaiat), gardă md5 per rând → 5 rânduri.
--   Backup: 471/475 procesat + eroare 'citită fără rezultat'; 472–474 procesat + eroare NULL.
--   Rollback: SET status_procesare='procesat', eroare=<backup>, analiza=jsonb_set(analiza,'{plansa}',(analiza->'plansa')-'rezultat'-'rezultat_motiv'-'rezultat_sursa'-'rezultat_la')
-- Migrarea v4 aplicată (apply_migration ofertare_clarificare_planse_auto_v4).
-- #63: sursa 'planse_auto:475,471' → 'planse_auto:475,471,revizie_motiv_ilizibil_infirmat' (md5 text neschimbat 6bd72fc3…).
-- Test RPC(95) după v4: {"actiune":"nimic"}; #63 rămâne propunere, text + marcaj intacte (v4 nu mai retrage ciorne editate de om).
