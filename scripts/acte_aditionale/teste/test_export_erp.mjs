// Test export_erp.sql + regula expirarii efective, pe PGlite (fara BD reala): schema falsa minima + fn_polite_scadente copiata
// DIN migrarea 20261205a (functia reala a ERP-ului, nu o copie scrisa de mana). Nu e in vitest: PGlite nu e dependenta a repo-ului.
// Rulare: npm install --no-save --prefix <folder> @electric-sql/pglite ; apoi
//         ACTE_PGLITE=<folder> node scripts/acte_aditionale/teste/test_export_erp.mjs
// Verifica (Jakarinos #1162 r1 P2): expirarea efectiva = maximul datelor de expirare din actele politei, chiar daca un act o SCURTEAZA,
// cu revenire la data politei doar daca niciun act nu are data; exemplele din TEMA_ACTE.md dau exact rezultatul functiei ERP.
// --mutant-greatest = regula veche din TEMA (cea mai tarzie dintre polita si acte) pusa in functie: testul trebuie sa pice.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AICI = path.dirname(fileURLToPath(import.meta.url))
const RADACINA = path.resolve(AICI, '..', '..', '..')
const dirPg = process.env.ACTE_PGLITE
if (!dirPg) { console.log('LIPSESTE ACTE_PGLITE (folderul cu node_modules/@electric-sql/pglite)'); process.exit(2) }
const { PGlite } = await import(pathToFileURL(path.join(dirPg, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href)
const mutant = process.argv.includes('--mutant-greatest')

const fara = s => s.replace(/\r/g, '')
const mig = fara(fs.readFileSync(path.join(RADACINA, 'supabase', 'migrations', '20261205a_polite_alerte.sql'), 'utf8'))
const i0 = mig.indexOf('CREATE FUNCTION public.fn_polite_scadente(')
const i1 = mig.indexOf('$fn$;', i0) + 5
if (i0 < 0 || i1 < 5) { console.log('nu gasesc fn_polite_scadente in migrare'); process.exit(1) }
let fn = mig.slice(i0, i1)
const regulaErp = 'coalesce((SELECT max(a.data_expirare_noua) FROM public.contracte_polite_acte a WHERE a.polita_id = cp.id), cp.data_expirare) AS data_expirare'
if (fn.split(regulaErp).length !== 2) { console.log('regula de expirare din fn_polite_scadente s-a schimbat: testul si TEMA_ACTE.md trebuie revazute'); process.exit(1) }
if (mutant) fn = fn.replace(regulaErp, regulaErp.replace('coalesce(', 'greatest('))
const exp = fara(fs.readFileSync(path.join(RADACINA, 'scripts', 'acte_aditionale', 'export_erp.sql'), 'utf8'))
const tema = fara(fs.readFileSync(path.join(RADACINA, 'scripts', 'acte_aditionale', 'TEMA_ACTE.md'), 'utf8'))

let esec = 0
const ok = (c, m) => { console.log((c ? '  OK   ' : '  ESEC ') + m); if (!c) esec++ }

const db = new PGlite()
await db.exec(`
CREATE TABLE beneficiari (id int PRIMARY KEY, nume text);
CREATE TABLE contracte_terti (id bigint PRIMARY KEY, numar_contract text, denumire text, beneficiar_id int REFERENCES beneficiari(id));
CREATE TABLE executie_proiecte (id int PRIMARY KEY, cod_intern text, nume text, contract_id int, valoare_lei numeric, garantie_buna_exec_pct numeric, activ boolean, nas_folder_path text);
CREATE TABLE contracte_polite (id serial PRIMARY KEY, contract_id int NOT NULL, tip text NOT NULL, asigurator text, nr_polita text, valoare_lei numeric(14,2),
  data_emitere date, data_expirare date, status text NOT NULL DEFAULT 'activa', moneda text NOT NULL DEFAULT 'RON', garantie_pana_la date);
CREATE TABLE contracte_polite_acte (id serial PRIMARY KEY, polita_id int NOT NULL REFERENCES contracte_polite(id), nr_act int NOT NULL, valoare_noua_lei numeric(14,2), data_emitere date, data_expirare_noua date);
CREATE TABLE gbe_polite (id serial PRIMARY KEY, contract_id bigint, numar_polita text, emitent text, valoare_lei numeric, data_emitere date, data_expirare date, activ boolean);
CREATE TABLE garantii (id bigserial PRIMARY KEY, forma text, tip text, emitent text, numar_document text, valoare numeric(14,2), moneda text, data_emitere date, data_expirare date,
  stare text, beneficiar text, contract_terti_id bigint, contract_polita_id bigint, iban text);
CREATE TABLE contracte_acte_aditionale (id serial PRIMARY KEY, contract_id int, numar_act text, data_semnare date, tip text, valoare_noua_lei numeric, data_termen_noua date);
CREATE TABLE executie_acte_aditionale (id serial PRIMARY KEY, proiect_id int, numar_act text, data_semnare date, modificare_valoare_lei numeric, activ boolean);
CREATE TABLE v_contract_efecte_acte (contract_id int, valoare_initiala numeric, valoare_actuala_calc numeric);
CREATE TABLE executie_situatii_plata (id serial PRIMARY KEY, proiect_id int, valoare_ajustare_lei numeric);
`)
await db.exec(fn)

// ── A. Exemplele din TEMA_ACTE.md, pe functia ERP, la data de referinta fixa 2026-11-21 ──────────────────────────────────────
await db.exec(`
INSERT INTO contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_emitere, data_expirare) VALUES
  (901, 90, 'GBE', 'T', 'SCURTARE', 1, '2025-01-01', '2027-12-31'),
  (902, 90, 'CAR', 'T', 'PRELUNGIRE', 1, '2025-01-01', '2026-11-01'),
  (903, 90, 'GBE', 'T', 'FARA-DATA-IN-ACTE', 1, '2025-01-01', '2027-01-15'),
  (904, 90, 'GBE', 'T', 'MIXT', 1, '2025-01-01', '2027-12-31');
INSERT INTO contracte_polite_acte (polita_id, nr_act, valoare_noua_lei, data_emitere, data_expirare_noua) VALUES
  (901, 1, NULL, '2026-06-01', '2026-11-01'),
  (902, 1, NULL, '2026-06-01', '2027-03-31'),
  (903, 1, 5.00, '2026-06-01', NULL),
  (904, 1, NULL, '2026-02-01', '2026-10-01'), (904, 2, 7.00, '2026-03-01', NULL), (904, 3, NULL, '2026-04-01', '2026-12-10');
`)
const fix = Object.fromEntries((await db.query(`SELECT ref_id::int id, data_expirare::text exp, zile FROM fn_polite_scadente('2026-11-21') WHERE sursa = 'contract' AND ref_id > 900`)).rows.map(r => [r.id, r]))
ok(fix[901]?.exp === '2026-11-01' && fix[901]?.zile === -20, `SCURTARE: polita 2027-12-31, act 2026-11-01 -> efectiv 2026-11-01, zile -20 (am ${fix[901]?.exp} / ${fix[901]?.zile})`)
ok(fix[902]?.exp === '2027-03-31' && fix[902]?.zile === 130, `PRELUNGIRE: polita 2026-11-01, act 2027-03-31 -> efectiv 2027-03-31 (am ${fix[902]?.exp} / ${fix[902]?.zile})`)
ok(fix[903]?.exp === '2027-01-15', `actele fara data de expirare -> revenire la data politei (am ${fix[903]?.exp})`)
ok(fix[904]?.exp === '2026-12-10', `mai multe acte, unul fara data: maximul datelor din ACTE (2026-12-10), nu data politei 2027-12-31 (am ${fix[904]?.exp})`)
// TEMA spune exact aceleasi exemple si aceeasi regula, cu trimitere la functia ERP
ok(tema.includes('fn_polite_scadente') && tema.includes('20261205a') && /regula ERP-ului/.test(tema), 'TEMA: regula e declarata ca fiind a ERP-ului (fn_polite_scadente, 20261205a)')
ok(tema.includes('poliță până la 2027-12-31, act cu expirare 2026-11-01 → efectiv 2026-11-01') && tema.includes('`EXPIRATA`, deși polița scrie 2027'), 'TEMA: exemplul de scurtare (= rezultatul functiei la 901)')
ok(tema.includes('poliță până la 2026-11-01, act până la 2027-03-31 → efectiv 2027-03-31'), 'TEMA: exemplul de prelungire (= rezultatul functiei la 902)')
ok(tema.includes('doar dacă niciun act nu are dată de expirare') && tema.includes('data efectivă = data din poliță'), 'TEMA: revenirea la data politei doar fara date in acte (= 903)')
ok(!/cea mai târzie dintre poliță și actele ei/.test(tema), 'TEMA: regula veche (cea mai tarzie dintre polita si acte) a disparut')
await db.exec(`DELETE FROM contracte_polite_acte WHERE polita_id > 900; DELETE FROM contracte_polite WHERE id > 900;`)

// ── B. Exportul (data de referinta = azi, Europe/Bucharest) ────────────────────────────────────────────────────────────────
const azi = (await db.query(`SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date::text d`)).rows[0].d
await db.exec(`
INSERT INTO beneficiari VALUES (1, 'BENEFICIAR TEST');
INSERT INTO contracte_terti VALUES (10, 'C-10/2025', 'Lucrare zece', 1), (20, 'C-20/2025', 'Lucrare douazeci', NULL), (30, 'C-30/2025', 'Lucrare treizeci', 1);
INSERT INTO executie_proiecte VALUES (1, 'P-UNU', 'unu', 10, 1000, 10, true, 'x'), (2, 'P-DOI', 'doi', 20, 500, 5, true, 'y'), (3, 'P-TREI', 'trei', 10, 1, 1, true, 'z'),
  (4, 'P-PATRU', 'patru', 30, 1, 1, true, 'w'), (24, 'EXCLUS', 'e', 10, 1, 1, true, '');
INSERT INTO contracte_polite (id, contract_id, tip, asigurator, nr_polita, valoare_lei, data_emitere, data_expirare, status, moneda, garantie_pana_la) VALUES
  (1, 10, 'GBE', 'ASIG A', 'H35416', 100.00, '2025-01-10', DATE '${azi}' + 5, 'activa', 'RON', '2028-01-01'),
  (2, 10, 'CAR', 'ASIG B', 'CAR-77', 2000.00, '2025-01-11', DATE '${azi}' - 3, 'expirata', 'EUR', NULL),
  (3, 30, 'GBE', 'ASIG S', 'SC-1', 300.00, '2025-01-12', DATE '${azi}' + 400, 'activa', 'RON', NULL),
  (4, 30, 'CAR', 'ASIG P', 'PR-1', 400.00, '2025-01-13', DATE '${azi}' - 10, 'activa', 'RON', NULL),
  (5, 30, 'GBE', 'ASIG N', 'ND-1', 500.00, '2025-01-14', DATE '${azi}' + 7, 'activa', 'RON', NULL);
INSERT INTO contracte_polite_acte (polita_id, nr_act, valoare_noua_lei, data_emitere, data_expirare_noua) VALUES
  (1, 1, 150.00, '2025-06-01', DATE '${azi}' + 40),
  (3, 1, NULL, '2025-07-01', DATE '${azi}' - 20),
  (4, 1, 450.00, '2025-07-02', NULL), (4, 2, NULL, '2025-08-02', DATE '${azi}' + 90),
  (5, 1, 550.00, '2025-07-03', NULL);
INSERT INTO gbe_polite (contract_id, numar_polita, emitent, valoare_lei, data_emitere, data_expirare, activ) VALUES (20, 'AX168650', 'ASIG C', 25, '2025-02-02', DATE '${azi}' + 10, true);
INSERT INTO garantii (forma, tip, emitent, numar_document, valoare, moneda, data_emitere, data_expirare, stare, beneficiar, contract_terti_id, contract_polita_id, iban) VALUES
  ('polita_asigurare', 'buna_executie', 'ASIG D', 'R-1', 50, 'RON', '2025-03-03', DATE '${azi}' + 20, 'activa', 'BEN R', 20, NULL, 'RO00IBANSECRET'),
  ('scrisoare_bancara', 'car', 'BANCA E', 'R-2', 60, 'RON', '2025-03-04', DATE '${azi}' - 1, 'activa', 'BEN R', 20, NULL, 'RO00IBANSECRET'),
  ('polita_asigurare', 'buna_executie', 'ASIG A', 'H35416', 100, 'RON', NULL, NULL, 'activa', 'BEN', 10, 1, NULL),
  ('polita_asigurare', 'participare', 'ASIG F', 'GP-1', 9, 'RON', NULL, NULL, 'activa', 'BEN', 20, NULL, NULL);
`)
const zi = n => (db.query(`SELECT (DATE '${azi}' + ${n})::text d`)).then(r => r.rows[0].d)
const r = await db.query(exp)
const erp = r.rows[0].erp
console.log(erp)
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
ok(r.rows.length === 1, 'un singur rand')
ok(erp.startsWith(`# ERP la ${azi} (data de referinta, Europe/Bucharest`), 'antet cu data din Europe/Bucharest')
ok(!/EXCLUS/.test(erp) && /## P1 P-UNU/.test(erp) && /## P2 P-DOI/.test(erp) && /## P4 P-PATRU/.test(erp), 'proiectul 24 exclus, P1/P2/P4 prezente')
ok(/contract nr=C-10\/2025 \| beneficiar=BENEFICIAR TEST/.test(erp), 'numar contract + beneficiar')
ok(/\[POLITA id=1 tip=GBE asigurator=ASIG A nr=H35416 moneda=RON valoare=100\.00 emisa=2025-01-10 exp=\S+ garantie_pana_la=2028-01-01 status=activa \| efectiv cu actele: valoare=150\.00 exp=\S+ zile=40 \| acte: AA 1 emis=2025-06-01 val_noua=150\.00 exp_noua=\S+\]/.test(erp), 'PRELUNGIRE: polita GBE activa, efectiv din act (zile=40, din fn_polite_scadente)')
ok(new RegExp(esc(`[POLITA id=3 tip=GBE asigurator=ASIG S nr=SC-1 moneda=RON valoare=300.00 emisa=2025-01-12 exp=${await zi(400)} `) + '.*' + esc(`| efectiv cu actele: valoare=300.00 exp=${await zi(-20)} zile=-20 |`)).test(erp), 'SCURTARE: polita valabila 400 de zile, act cu expirare acum 20 de zile -> efectiv zile=-20 (expirata)')
ok(new RegExp(esc(`[POLITA id=4 `) + '.*' + esc(`| efectiv cu actele: valoare=450.00 exp=${await zi(90)} zile=90 |`)).test(erp), 'PRELUNGIRE cu un act fara data: maximul datelor din acte (zile=90), valoarea din ultimul act cu valoare')
ok(new RegExp(esc(`[POLITA id=5 `) + '.*' + esc(`| efectiv cu actele: valoare=550.00 exp=${await zi(7)} zile=7 |`)).test(erp), 'acte fara data de expirare -> data politei (zile=7)')
ok(/\[POLITA id=2 tip=CAR asigurator=ASIG B nr=CAR-77 moneda=EUR valoare=2000\.00 emisa=2025-01-11 exp=\S+ garantie_pana_la= status=expirata \| efectiv cu actele: valoare=- exp=- zile=- \| acte: -\]/.test(erp), 'polita CAR neactiva: moneda EUR, fara efectiv')
ok(/\[GBE_POLITA id=1 nr=AX168650 emitent=ASIG C valoare=25 emisa=2025-02-02 exp=\S+ zile=10 activ=t\]/.test(erp), 'gbe_polite cu data emiterii si zile')
ok(/\[REGISTRU id=1 tip=buna_executie forma=polita_asigurare emitent=ASIG D nr=R-1 moneda=RON valoare=50\.00 emisa=2025-03-03 exp=\S+ zile=20 stare=activa beneficiar=BEN R\]/.test(erp), 'registru GBE nelegat')
ok(/\[REGISTRU id=2 tip=car forma=scrisoare_bancara .* zile=-1 /.test(erp), 'registru CAR (alta forma): zile calculate, negative = expirata')
ok(!/REGISTRU id=3/.test(erp), 'registru legat de polita de pe contract: nu se dubleaza')
ok(!/GP-1/.test(erp), 'garantia de participare nu apare')
ok(!/IBAN/i.test(erp.replace('fara IBAN', '')), 'fara IBAN in export')
ok((erp.match(/\[POLITA id=1 /g) || []).length === 2, 'P1 si P3 (acelasi contract) au fiecare polita o data (DISTINCT ON in sc)')
console.log(esec ? `ESECURI: ${esec}` : 'TOATE VERIFICARILE TREC')
process.exit(esec ? 1 : 0)
