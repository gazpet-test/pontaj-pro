// Proba LOCALĂ a migrării 20270111a (CTC: autorizațiile firmelor de control nedistructiv, TKT-2026-0389) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261222b_ctc_autorizatii_schelet.sql + supabase/tests/20270111a_ctc_autorizatii_ndt_schelet.sql, apoi
//   migrările REALE 20260924_ofertare_parteneri_documente.sql și 20261222b_ctc_autorizatii_citire.sql (cu baseline-ul ei L15 v1 calculat aici).
//   Migrarea 20270111a rulează ca runnerul: plafonul 5000 (sesiune) + marcajele prologului + PAȘII REALI L15 v2 (scripts/livrare_amprenta_gen.sh)
//   + garda finală reală (lm_fin din scripts/livrare_mesaj.sh); revenirea cu plafonul 2000, fără amprenta globală.
// 0. Validatorul runnerului (scripts/livrare_validator.py): migrarea cu 5000, revenirea cu 2000; altfel refuz.
// 1. Amprentele scrise în migrare / revenire = calculate (corpurile, CHECK-urile deparsate, predicatul CTC din 20261222b).
// 2. Comportamentul (valorile așteptate scrise de mână din specificație, L25), ca rolul authenticated cu JWT-ul fiecărui cont:
//    lista doar NDT, doar câmpurile permise, starea după ziua din România (și sub alte fusuri ale sesiunii); fără CTC = 42501; CTC fără Ofertare
//    vede lista, deschide doar căile NDT valide și NU citește tabelul direct; garda pe tabelul COMUN de cazuri
//    (supabase/tests/20270111a_ctc_autorizatii_ndt_cazuri_cale.json: aceleași cazuri ca vitest, L19) + rândurile scrise ocolind trigger-ul;
//    editările (categoria schimbată cu / fără cale nouă, altă firmă, unicitatea, cale de licitație pe un rând NDT).
//    r2: ceasul bazei e INJECTAT (PGlite citește Date.now(), aici fixat de probă): expirarea la 23:59:59 / 23:59:59.999 / 00:00:00 la
//    București, pe o zi obișnuită și pe ambele zile cu schimbare de oră din 2027, sub 4 fusuri ale sesiunii (X, în verifica).
// 2b. (r2) regula căii: clasele explicite din BD = lista edge-ului pe tot BMP-ul; căi aleatoare prin trigger, RPC și codul REAL al edge-ului
//    (.ts) și al ecranului, cu același rezultat; cazurile din verdict (spații, 201 / 1000+ caractere, diacritice).
// 3. Livrarea L15 v2: manifestul generat (ROLLBACK) = lista revizuită supabase/tests/<NUME>.l15.obiecte.tsv; livrarea aprobată trece; GLOBAL
//    greșit / manifest incomplet = refuzul RUNNERULUI; dry-run-ul de pe clonă rulează aici și nu lasă nimic; fără migrare pică.
// 4. Refuzurile migrării (nimic schimbat) și ale revenirii; apply → revenire → re-apply; după revenire Parteneri și sudorii merg ca înainte.
// 5. MUTANȚI: comportamentali (postcondițiile scoase: verificările de la 2 trebuie să-i prindă), structurali (postcondițiile îi prind),
//    pe gărzile de stare ale migrării și pe revenire (același scenariu dă alt rezultat).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ctc_autorizatii_ndt_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'ndt_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270111a_ctc_autorizatii_ndt', NUME_REV = NUME + '_ROLLBACK'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const MIG = citeste(F_MIG), REV = citeste(F_REV), DRY = citeste(F_DRY)
const TABEL = JSON.parse(citeste(`supabase/tests/${NUME}_cazuri_cale.json`))
// marcajele din tabel ({BS}, {C1}, {LUNG} …) → caracterele lor, din coduri (aceeași decodare ca vitest)
const decodeaza = s => Object.entries(TABEL._marcaje).reduce((t, [k, [cod, ori]]) => t.split(k).join(String.fromCharCode(cod).repeat(ori)), s)
const CAZURI = TABEL.cazuri.map(c => ({ ...c, cale: decodeaza(c.cale) }))
// clasele explicite din migrare (r2), aceleași în garda și în RPC-ul de deschidere (textul exact, pentru mutanți și proba 2b)
const CONTROL = "('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')", GOL = "('[^' || chr(9) || '-' || chr(13) || chr(32) || ']')"
if (!MIG.includes('OR NEW.fisier_path ~ ' + CONTROL) || !MIG.includes('AND d.fisier_path !~ ' + CONTROL) || !MIG.includes('IF NEW.fisier_path !~ ' + GOL)) throw new Error('clasele explicite nu sunt în migrare')
// codul REAL al edge-ului și al ecranului (Node >= 22.18 citește .ts fără tipuri), pentru căile aleatoare din secțiunea 2b
const EDGE = await import(new URL('../../supabase/functions/_shared/ctcAutorizatieFisier.ts', import.meta.url).href)
const ECRAN = await import(new URL('../../src/ofertareParteneriCale.js', import.meta.url).href)

// ── ceasul (r2, Jakarinos P2: proba de expirare deterministă). PGlite ia ora din Date.now() al procesului (Emscripten), deci data de
//    referință se INJECTEAZĂ aici, nu se citește din ceasul real: de la pornire ceasul bazei curge de la REF (bugetele de lock / plafonul
//    văd timp care trece), iar în proba de expirare (X) se fixează exact pe moment, doar pe durata unei tranzacții fără pg_sleep. ──
const ACUM_REAL = Date.now.bind(Date), PORNIRE = ACUM_REAL()
const REF = Date.parse('2026-11-25T10:00:00.000Z') // 25.11.2026, 12:00 la București
let ceasFix = null
Date.now = () => (ceasFix ?? REF + (ACUM_REAL() - PORNIRE))
const SCHELET_22B = citeste('supabase/tests/20261222b_ctc_autorizatii_schelet.sql')
const SCHELET = citeste(`supabase/tests/${NUME}_schelet.sql`)
const M0924 = citeste('supabase/migrations/20260924_ofertare_parteneri_documente.sql')
const M22B = citeste('supabase/migrations/20261222b_ctc_autorizatii_citire.sql')
const REV22B = citeste('supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql')
const SCRIPT22B = citeste('scripts/ctc_autorizatii_amprente.sql')

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
const corp = (text, fn) => { const i = text.indexOf(`CREATE FUNCTION public.${fn}(`); if (i < 0) throw new Error('nu găsesc ' + fn); const a = text.indexOf('AS $f$', i) + 6; return text.slice(a, text.indexOf('$f$;', a)) }
const aplica = (text, lista) => {
  let t = text
  for (const [din, in_] of lista) { if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 100)); t = t.split(din).join(in_) }
  return t
}

// ── uneltele runnerului (aceleași funcții ca livrare_migrare.sh) ──
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

// ── baza: schema falsă + 20260924 + 20261222b (baseline-ul ei L15 v1 calculat cu scriptul coordonatorului, ca în proba ei) ──
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PH22B = (() => { const i0 = M22B.indexOf('-- >>> BASELINE 20261222b'), i = M22B.indexOf(BL_A, i0) + BL_A.length; return M22B.slice(i, M22B.indexOf(BL_B, i)) })()
const sectiune = t => { const i = t.indexOf('WITH RECURSIVE'); return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length) }
let M22B_B = null
async function livreazaSimplu(db, nume, text, plafon) {
  await db.exec(`SET transaction_timeout = ${plafon}`)
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);
      SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);\n${text}\nCOMMIT;`)
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* închisă */ } throw e } finally { await db.exec('RESET transaction_timeout') }
}
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000d1', CTC: '00000000-0000-0000-0000-0000000000d2', CTC_SUB: '00000000-0000-0000-0000-0000000000d3',
  OF: '00000000-0000-0000-0000-0000000000d4', CTCX: '00000000-0000-0000-0000-0000000000d5', STRAIN: '00000000-0000-0000-0000-0000000000d6',
}
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.CTC}', 'CTC', false), ('${U.CTC_SUB}', 'CTC SUB', false),
  ('${U.OF}', 'OFERTARE', false), ('${U.CTCX}', 'CTCX', false), ('${U.STRAIN}', 'STRAIN', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.CTC}', 'ctc', 'viewer'), ('${U.CTC_SUB}', 'ctc.carti', 'editor'),
  ('${U.OF}', 'ofertare', 'admin'), ('${U.CTCX}', 'ctcx', 'admin'), ('${U.STRAIN}', 'executie', 'admin');
INSERT INTO public.ofertare_parteneri (id, nume, cui, contact, tip_relatie, observatii) VALUES
  (1, 'NDT CONTROL SRL', 'RO111', '0700 111 111', 'furnizor_servicii', 'nota partener'), (2, 'LABORATOR UT SRL', 'RO222', NULL, 'laborator', NULL);
SELECT setval(pg_get_serial_sequence('public.ofertare_parteneri', 'id'), 100);`
async function bazaNoua({ date = true } = {}) {
  const db = await PGlite.create()
  await db.exec(SCHELET_22B)
  await db.exec(SCHELET)
  await db.exec(`BEGIN;\n${M0924}\nCOMMIT;`)
  if (!M22B_B) {
    await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
    let rows
    try { rows = (await db.query(sectiune(SCRIPT22B))).rows } finally { await db.exec('ROLLBACK') }
    M22B_B = M22B.split(PH22B).join(rows.map((r, i) => (i === 0 ? '    ' : '  , ') + r.linie_baseline.replace(/^\s*,?\s*/, '')).join('\n'))
  }
  await livreazaSimplu(db, '20261222b_ctc_autorizatii_citire', M22B_B, 2000)
  if (date) await db.exec(DATE)
  return db
}

// Livrarea migrării ca runnerul (tiparul 20270109a): plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, pasul „înainte” REAL
// (aprobat sau „-”), opțional pasul „după” (manifest „-” = generatorul de manifest) și instrucțiunea finală.
async function livreaza(db, text, { nume = NUME, plafon = PLAFON_LIVRARE, marcajPlafon = plafon, ag = true, marcaj = true, aprobat = '-', manifest = null, final = 'COMMIT' } = {}) {
  await db.exec(plafon === null ? 'RESET transaction_timeout' : `SET transaction_timeout = ${plafon}`)
  const T = randomBytes(8).toString('hex')
  const prolog = [marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : '',
    marcajPlafon === null ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '${marcajPlafon}:' || txid_current(), true);`].join('\n')
  const ina = ag ? gen('inainte', T, aprobat) : ''
  const dupa = ag && manifest !== null ? gen('dupa', T, aprobat, manifest) : ''
  const note = []
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${prolog}`)
    await db.exec(`${ina}\n${text}\n;\n${dupa}`, { onNotice: n => note.push(n.message) })
    await db.exec(final, { onNotice: n => note.push(n.message) })
    return { ok: true, note }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* închisă */ }
    return { ok: false, eroare: String(e.message), note }
  } finally { await db.exec('RESET transaction_timeout') }
}
const revino = (db, text = REV, o = {}) => livreaza(db, text, { nume: NUME_REV, plafon: PLAFON_REVENIRE, ag: false, ...o })

// starea obiectelor (pentru „nimic schimbat”)
const stare = async db => (await db.query(`SELECT
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ofertare_parteneri_documente_categorie_check') AS check_def,
    (SELECT string_agg(tgname::text, ',' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_parteneri_documente'::regclass AND NOT tgisinternal) AS triggere,
    (SELECT string_agg(proname::text, ',' ORDER BY proname::text) FROM pg_proc WHERE proname IN ('fn_ofertare_doc_cale_garda', 'fn_ctc_autorizatii_ndt', 'fn_ctc_autorizatie_ndt_fisier')) AS functii,
    to_regclass('public.ofertare_parteneri_documente_fisier_path_uq') IS NOT NULL AS index_uq,
    (SELECT count(*)::int FROM public.ofertare_parteneri_documente) AS documente`)).rows[0]
const STARE_VECHE = { check_def: "CHECK ((categorie = ANY (ARRAY['autorizatie_isc'::text, 'iso'::text, 'certificat_legal'::text, 'atestat'::text, 'etalonare'::text, 'alta'::text])))",
  triggere: 'trg_ofertare_parteneri_documente_touch', functii: null, index_uq: false }
const eVeche = s => s.check_def === STARE_VECHE.check_def && s.triggere === STARE_VECHE.triggere && s.functii === null && s.index_uq === false

// ── conturile, documentele, așteptările (scrise de mână din specificație) ──
const ziBuc = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ms))
const AZI = '2026-11-25' // ziua lui REF la București, scrisă de mână (verificată în secțiunea 2 față de baza cu ceasul injectat)
const zi = n => { const [y, m, d] = AZI.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const DOC = `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, numar_document, emitent, data_emitere, data_valabilitate,
    fara_expirare, domeniu, fisier_path, observatii) VALUES
  (1, 'autorizatie_ndt', 'Autorizatie RT interna', 'RT-1', 'ISCIR', DATE '2025-01-10', DATE '${zi(30)}', false, 'RT', 'parteneri/1/ndt/1700000000100_rt.pdf', 'nota interna NDT'),
  (1, 'autorizatie_ndt', 'Autorizatie UT', 'UT-2', 'ISCIR', NULL, DATE '${zi(-1)}', false, 'UT', 'parteneri/1/ndt/1700000000101_certificat..pdf', NULL),
  (1, 'autorizatie_ndt', 'Autorizatie PT', 'PT-3', 'ISCIR', NULL, NULL, true, 'PT', NULL, NULL),
  (2, 'autorizatie_ndt', 'Autorizatie MT', 'MT-4', 'ASRO', NULL, DATE '${AZI}', false, 'MT', 'parteneri/2/ndt/1700000000102_mt.pdf', NULL),
  (2, 'autorizatie_ndt', 'Autorizatie VT', 'VT-5', NULL, NULL, NULL, false, 'VT', NULL, NULL),
  (1, 'certificat_legal', 'Certificat constatator', 'CL-6', 'ONRC', NULL, NULL, true, NULL, 'parteneri/1/1700000000103_certificat..pdf', NULL),
  (1, 'iso', 'ISO 9001', 'ISO-7', 'TUV', NULL, DATE '${zi(100)}', false, NULL, 'parteneri/1/1700000000104_iso.pdf', 'secret iso')`
// rânduri scrise OCOLIND trigger-ul (ca un rând vechi / o scriere directă a proprietarului)
const OCOLIT = `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, numar_document, fisier_path) VALUES
  (1, 'autorizatie_ndt', 'ocolit 8', 'BY-8', 'licitatii/103/caiet_ocolit.pdf'),
  (1, 'autorizatie_ndt', 'ocolit 9', 'BY-9', 'parteneri/2/ndt/1700000000105_strain.pdf'),
  (1, 'certificat_legal', 'ocolit 10', 'BY-10', 'parteneri/1/ndt/1700000000106_x.pdf'),
  (1, 'autorizatie_ndt', 'ocolit 11', 'BY-11', 'parteneri/1/ndt/../1700000000107_x.pdf'),
  (1, 'autorizatie_ndt', 'ocolit 12', 'BY-12', '  ')`
const F1 = ['NDT CONTROL SRL', 'RO111'], F2 = ['LABORATOR UT SRL', 'RO222']
// numar → [firma, cui, metoda, stare, are_fisier, fara_expirare, calea pe care o dă RPC-ul de deschidere]
const ASTEPTAT = {
  'RT-1': [...F1, 'RT', 'valabil', true, false, 'parteneri/1/ndt/1700000000100_rt.pdf'],
  'UT-2': [...F1, 'UT', 'expirat', true, false, 'parteneri/1/ndt/1700000000101_certificat..pdf'],
  'PT-3': [...F1, 'PT', 'valabil', false, true, null],
  'MT-4': [...F2, 'MT', 'valabil', true, false, 'parteneri/2/ndt/1700000000102_mt.pdf'],
  'VT-5': [...F2, 'VT', 'necunoscut', false, false, null],
  'BY-8': [...F1, null, 'necunoscut', true, false, null],
  'BY-9': [...F1, null, 'necunoscut', true, false, null],
  'BY-11': [...F1, null, 'necunoscut', true, false, null],
  'BY-12': [...F1, null, 'necunoscut', false, false, null],
}
const TOATE_NR = ['RT-1', 'UT-2', 'PT-3', 'MT-4', 'VT-5', 'CL-6', 'ISO-7', 'BY-8', 'BY-9', 'BY-10', 'BY-11', 'BY-12']
const CAMPURI = ['are_fisier', 'cui', 'data_emitere', 'data_valabilitate', 'emitent', 'fara_expirare', 'firma', 'id', 'metoda', 'numar_document', 'stare']
const INTERZISE = ['1700000000100_rt.pdf', '1700000000102_mt.pdf', 'caiet_ocolit', 'nota interna NDT', 'Autorizatie RT interna', '0700 111 111', 'nota partener',
  'secret iso', 'CL-6', 'ISO-7', 'BY-10']

async function ca(db, cont, sql, params = [], { rol = 'authenticated', tz = null } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; ${tz ? `SET LOCAL TimeZone = '${tz}';` : ''} SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql, params); await db.exec('ROLLBACK'); return { rows: r.rows, fields: r.fields.map(f => f.name) } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
async function scrieCa(db, cont, sql) {
  await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${U[cont]}', true);`)
  try { await db.exec(sql); await db.exec('COMMIT') } catch (e) { await db.exec('ROLLBACK'); throw e }
}
async function documente(db) {
  await scrieCa(db, 'OF', DOC)
  await db.exec(`SET session_replication_role = replica; ${OCOLIT}; SET session_replication_role = origin;`)
  return Object.fromEntries((await db.query(`SELECT numar_document AS n, id FROM public.ofertare_parteneri_documente`)).rows.map(r => [r.n, Number(r.id)]))
}
// o tranzacție închisă cu ROLLBACK: pași ca un cont (devino) sau ca postgres (pg); încercările într-un savepoint
async function inTx(db, fn) { await db.exec('BEGIN'); try { return await fn() } finally { try { await db.exec('ROLLBACK') } catch { /* închisă */ } } }
const devino = (db, cont) => db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${U[cont]}', true);`)
async function incearca(db, sql, params = []) {
  await db.exec('SAVEPOINT s')
  try { const r = await db.query(sql, params); await db.exec('RELEASE SAVEPOINT s'); return { ok: true, rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK TO SAVEPOINT s'); return { ok: false, code: e.code, message: e.message } }
}

// ── X: expirarea la momente FIXE în jurul miezului nopții la București (specificația §3.6 / §5.4), cu ceasul injectat. Scrise de mână:
//    momentele UTC, ziua din România și stările. Schimbarea orei în UE: ultima duminică din martie / octombrie, la 01:00 UTC (2027: 28.03
//    EET→EEST, 31.10 EEST→EET), deci miezul nopții e la 22:00 UTC iarna și la 21:00 UTC vara — o zi cu schimbare de oră are cele două
//    capete la ore UTC DIFERITE. Pe fiecare muchie: ultima secundă a zilei Z (23:59:59 și 23:59:59.999) și prima a zilei Z+1 (00:00:00). ──
const MUCHII = [
  // [eticheta, 23:59:59 în Z (UTC), 23:59:59.999 în Z (UTC), 00:00:00 în Z+1 (UTC), Z, Z+1, Z-1]
  ['iarnă (EET): 24 → 25.11.2026', '2026-11-24T21:59:59.000Z', '2026-11-24T21:59:59.999Z', '2026-11-24T22:00:00.000Z', '2026-11-24', '2026-11-25', '2026-11-23'],
  ['ziua schimbării de primăvară, capătul de început (EET): 27 → 28.03.2027', '2027-03-27T21:59:59.000Z', '2027-03-27T21:59:59.999Z', '2027-03-27T22:00:00.000Z', '2027-03-27', '2027-03-28', '2027-03-26'],
  ['ziua schimbării de primăvară, capătul de sfârșit (EEST): 28 → 29.03.2027', '2027-03-28T20:59:59.000Z', '2027-03-28T20:59:59.999Z', '2027-03-28T21:00:00.000Z', '2027-03-28', '2027-03-29', '2027-03-27'],
  ['ziua schimbării de toamnă, capătul de început (EEST): 30 → 31.10.2027', '2027-10-30T20:59:59.000Z', '2027-10-30T20:59:59.999Z', '2027-10-30T21:00:00.000Z', '2027-10-30', '2027-10-31', '2027-10-29'],
  ['ziua schimbării de toamnă, capătul de sfârșit (EET): 31.10 → 01.11.2027', '2027-10-31T21:59:59.000Z', '2027-10-31T21:59:59.999Z', '2027-10-31T22:00:00.000Z', '2027-10-31', '2027-11-01', '2027-10-30'],
]
// documentele unei muchii: valabil până în Z (cel care TRECE din valabil în expirat), până în Z+1, până în Z-1, fără expirare, fără dată
const docMuchie = ([, , , , z, z1, zm1]) => [['X-Z', z, false], ['X-Z1', z1, false], ['X-ZM1', zm1, false], ['X-FARA', zm1, true], ['X-NULL', null, false]]
const STARI_INAINTE = ['valabil', 'valabil', 'expirat', 'valabil', 'necunoscut'] // la 23:59:59(.999) în Z: ziua de azi = valabil
const STARI_DUPA = ['expirat', 'valabil', 'expirat', 'valabil', 'necunoscut'] // la 00:00:00 în Z+1
const FUSURI_X = [null, 'Pacific/Kiritimati', 'Etc/GMT+12', 'UTC']
// lista ca un cont CTC, cu ceasul bazei fixat EXACT pe moment (now() = începutul tranzacției); documentele se scriu ca Ofertare în aceeași
// tranzacție (ROLLBACK la final); întoarce momentul văzut de bază (ms) și starea fiecărui document
async function stariLa(db, moment, tz, docs) {
  ceasFix = Date.parse(moment)
  try {
    await db.exec(`BEGIN; ${tz ? `SET LOCAL TimeZone = '${tz}';` : ''}`)
    try {
      const ms = (await db.query(`SELECT (extract(epoch FROM now()) * 1000)::bigint::text AS ms`)).rows[0].ms
      await devino(db, 'OF')
      const id = []
      for (const [nr, data, fara] of docs) {
        id.push(Number((await db.query(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, numar_document, data_valabilitate, fara_expirare)
          VALUES (1, 'autorizatie_ndt', 'X', $1, $2::date, $3) RETURNING id`, [nr, data, fara])).rows[0].id))
      }
      await devino(db, 'CTC')
      const r = (await db.query(`SELECT id, stare FROM public.fn_ctc_autorizatii_ndt()`)).rows
      return { ms: Number(ms), stari: id.map(i => r.find(x => Number(x.id) === i)?.stare ?? 'LIPSA') }
    } finally { await db.exec('ROLLBACK') }
  } finally { ceasFix = null }
}

async function verifica(db, ids) {
  const ab = []
  const asteptCod = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  const nrDupaId = Object.fromEntries(Object.entries(ids).map(([n, id]) => [id, n]))
  // L: lista, pentru conturile CTC (ctc, ctc.*) și owner, și sub alte fusuri orare ale sesiunii (ziua rămâne cea din România)
  for (const [cont, tz] of [['CTC', null], ['CTC_SUB', null], ['OWNER', null], ['CTC', 'Pacific/Kiritimati'], ['CTC', 'Etc/GMT+12']]) {
    const et = `L ${cont}${tz ? ' (' + tz + ')' : ''}`
    const r = await ca(db, cont, `SELECT * FROM public.fn_ctc_autorizatii_ndt() ORDER BY id`, [], { tz })
    if (r.code) { ab.push(`${et}: ${r.code} ${r.message}`); continue }
    if (JSON.stringify([...r.fields].sort()) !== JSON.stringify(CAMPURI)) ab.push(`${et}: câmpuri ${r.fields.join(',')}`)
    const nrs = r.rows.map(x => nrDupaId[Number(x.id)] || '?' + x.id).sort()
    if (JSON.stringify(nrs) !== JSON.stringify(Object.keys(ASTEPTAT).sort())) ab.push(`${et}: documente ${nrs.join(',')}`)
    for (const x of r.rows) {
      const n = nrDupaId[Number(x.id)], a = ASTEPTAT[n]
      if (!a) continue
      const am = [x.firma, x.cui, x.metoda, x.stare, x.are_fisier, x.fara_expirare]
      if (JSON.stringify(am) !== JSON.stringify(a.slice(0, 6))) ab.push(`${et} ${n}: ${JSON.stringify(am)} (aștepta ${JSON.stringify(a.slice(0, 6))})`)
      if (x.numar_document !== n) ab.push(`${et} ${n}: numar_document ${x.numar_document}`)
    }
    const rt = r.rows.find(x => x.numar_document === 'RT-1')
    if (rt && (rt.emitent !== 'ISCIR' || String(rt.data_valabilitate?.toISOString?.().slice(0, 10) ?? rt.data_valabilitate) !== zi(30))) ab.push(`${et} RT-1 emitent / valabilitate: ${JSON.stringify(rt)}`)
    const tot = JSON.stringify(r.rows)
    for (const interzis of INTERZISE) if (tot.includes(interzis)) ab.push(`${et}: a ieșit un câmp nepermis (${interzis})`)
  }
  // X: expirarea la momentele fixe (ceasul injectat), sub mai multe fusuri ale sesiunii
  for (const m of MUCHII) {
    for (const [moment, astept] of [[m[1], STARI_INAINTE], [m[2], STARI_INAINTE], [m[3], STARI_DUPA]]) {
      for (const tz of FUSURI_X) {
        const et = `X ${m[0]} @ ${moment}${tz ? ' (' + tz + ')' : ''}`
        let r
        try { r = await stariLa(db, moment, tz, docMuchie(m)) } catch (e) { ab.push(`${et}: ${e.message}`); continue }
        if (r.ms !== Date.parse(moment)) ab.push(`${et}: baza a văzut alt moment (${new Date(r.ms).toISOString()}), ceasul nu e cel injectat`)
        if (JSON.stringify(r.stari) !== JSON.stringify(astept)) ab.push(`${et}: ${JSON.stringify(r.stari)} (aștepta ${JSON.stringify(astept)})`)
      }
    }
  }
  // fără CTC: 42501 (nu listă goală, L18)
  for (const cont of ['OF', 'CTCX', 'STRAIN']) asteptCod(await ca(db, cont, `SELECT * FROM public.fn_ctc_autorizatii_ndt()`), '42501', `L ${cont}`)
  asteptCod(await ca(db, null, `SELECT * FROM public.fn_ctc_autorizatii_ndt()`), '42501', 'L fără JWT')
  asteptCod(await ca(db, null, `SELECT * FROM public.fn_ctc_autorizatii_ndt()`, [], { rol: 'anon' }), '42501', 'L anon')
  asteptCod(await ca(db, 'CTC', `SELECT * FROM public.fn_ctc_autorizatii_ndt()`, [], { rol: 'anon' }), '42501', 'L anon cu JWT-ul CTC')
  // F: deschiderea — doar NDT cu cale validă; același NULL pentru restul (fără oracol)
  for (const n of [...TOATE_NR, 'INEXISTENT']) {
    const id = ids[n] ?? 999999
    const r = await ca(db, 'CTC', `SELECT public.fn_ctc_autorizatie_ndt_fisier($1) AS c`, [id])
    const astept = ASTEPTAT[n]?.[6] ?? null
    if (r.code) ab.push(`F ${n}: ${r.code} ${r.message}`)
    else if (r.rows[0].c !== astept) ab.push(`F ${n}: ${JSON.stringify(r.rows[0].c)} (aștepta ${JSON.stringify(astept)})`)
  }
  const fs = await ca(db, 'CTC_SUB', `SELECT public.fn_ctc_autorizatie_ndt_fisier($1) AS c`, [ids['MT-4']])
  if (fs.code || fs.rows[0].c !== ASTEPTAT['MT-4'][6]) ab.push('F CTC_SUB MT-4: ' + JSON.stringify(fs))
  for (const cont of ['OF', 'CTCX', 'STRAIN']) asteptCod(await ca(db, cont, `SELECT public.fn_ctc_autorizatie_ndt_fisier($1)`, [ids['RT-1']]), '42501', `F ${cont}`)
  asteptCod(await ca(db, null, `SELECT public.fn_ctc_autorizatie_ndt_fisier($1)`, [ids['RT-1']], { rol: 'anon' }), '42501', 'F anon')
  // CTC fără Ofertare NU citește tabelul direct; Ofertare îl citește ca înainte (politicile neschimbate)
  const dir = await ca(db, 'CTC', `SELECT count(*)::int AS n FROM public.ofertare_parteneri_documente`)
  if (dir.code || dir.rows[0].n !== 0) ab.push('D CTC citește direct: ' + JSON.stringify(dir))
  const dirOf = await ca(db, 'OF', `SELECT count(*)::int AS n FROM public.ofertare_parteneri_documente`)
  if (dirOf.code || dirOf.rows[0].n !== TOATE_NR.length) ab.push('D Ofertare citește: ' + JSON.stringify(dirOf))
  // G: garda + deschiderea pe tabelul COMUN de cazuri (paritatea cu ecranul / edge-ul e în vitest, pe aceleași cazuri)
  for (const c of CAZURI) {
    const et = `${c.categorie} ${JSON.stringify(c.cale)} (firma ${c.partener})`
    const g = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES ($1, $2, 'caz', $3) RETURNING id`, [c.partener, c.categorie, c.cale]) })
    if (g.ok !== c.garda || (!g.ok && g.code !== '23514')) ab.push(`G ${et}: ${g.ok ? 'acceptat' : g.code + ' ' + g.message} (aștepta ${c.garda ? 'acceptat' : '23514'})`)
    let d
    try {
      d = await inTx(db, async () => {
        await db.exec('SET LOCAL session_replication_role = replica')
        const r = await db.query(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES ($1, $2, 'caz ocolit', $3) RETURNING id`, [c.partener, c.categorie, c.cale])
        await db.exec('SET LOCAL session_replication_role = origin')
        await devino(db, 'CTC')
        return (await db.query(`SELECT public.fn_ctc_autorizatie_ndt_fisier($1) AS c`, [r.rows[0].id])).rows[0].c
      })
    } catch (e) { d = 'EROARE ' + e.message }
    const astept = c.deschide ? c.cale : null
    if (d !== astept) ab.push(`R ${et}: ${JSON.stringify(d)} (aștepta ${JSON.stringify(astept)})`)
  }
  // E: editările prin API (contul Ofertare), fiecare în tranzacția ei
  const E = [
    ['PATCH cu cale de licitație pe un rând NDT', `UPDATE public.ofertare_parteneri_documente SET fisier_path = 'licitatii/103/caiet_de_sarcini.pdf' WHERE numar_document = 'RT-1' RETURNING id`, '23514'],
    ['NDT care arată fișierul unui certificat_legal al aceleiași firme', `UPDATE public.ofertare_parteneri_documente SET fisier_path = 'parteneri/1/1700000000103_certificat..pdf' WHERE numar_document = 'PT-3' RETURNING id`, '23514'],
    ['NDT care arată fișierul altui NDT (unicitatea)', `UPDATE public.ofertare_parteneri_documente SET fisier_path = 'parteneri/1/ndt/1700000000100_rt.pdf' WHERE numar_document = 'UT-2' RETURNING id`, '23505'],
    ['iso → NDT fără fișier nou', `UPDATE public.ofertare_parteneri_documente SET categorie = 'autorizatie_ndt' WHERE numar_document = 'ISO-7' RETURNING id`, '23514'],
    ['iso → NDT cu fișier nou în ndt/', `UPDATE public.ofertare_parteneri_documente SET categorie = 'autorizatie_ndt', fisier_path = 'parteneri/1/ndt/1700000000200_iso.pdf' WHERE numar_document = 'ISO-7' RETURNING id`, 'ok'],
    ['NDT → alta cu calea din ndt/', `UPDATE public.ofertare_parteneri_documente SET categorie = 'alta' WHERE numar_document = 'RT-1' RETURNING id`, '23514'],
    ['NDT → alta cu fișier nou în afara ndt/', `UPDATE public.ofertare_parteneri_documente SET categorie = 'alta', fisier_path = 'parteneri/1/1700000000201_rt.pdf' WHERE numar_document = 'RT-1' RETURNING id`, 'ok'],
    ['document NDT fără fișier → alta (liber)', `UPDATE public.ofertare_parteneri_documente SET categorie = 'alta' WHERE numar_document = 'PT-3' RETURNING id`, 'ok'],
    ['NDT mutat la altă firmă (partener_id)', `UPDATE public.ofertare_parteneri_documente SET partener_id = 2 WHERE numar_document = 'RT-1' RETURNING id`, '23514'],
    ['NDT nou cu certificat..pdf', `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'autorizatie_ndt', 'x', 'parteneri/1/ndt/1700000000202_certificat..pdf') RETURNING id`, 'ok'],
    ['certificat_legal nou cu certificat..pdf', `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'certificat_legal', 'x', 'parteneri/1/1700000000203_certificat..pdf') RETURNING id`, 'ok'],
    ['certificat_legal nou sub ndt/', `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'certificat_legal', 'x', 'parteneri/1/ndt/1700000000204_x.pdf') RETURNING id`, '23514'],
    ['altă coloană pe un rând NDT valid (denumire)', `UPDATE public.ofertare_parteneri_documente SET denumire = 'redenumit' WHERE numar_document = 'RT-1' RETURNING id`, 'ok'],
  ]
  for (const [ce, sql, astept] of E) {
    const r = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, sql) })
    const are = r.ok ? (r.rows.length === 1 ? 'ok' : `${r.rows.length} rânduri`) : r.code
    if (are !== astept) ab.push(`E ${ce}: ${are}${r.message ? ' ' + r.message : ''} (aștepta ${astept})`)
  }
  return ab
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('0. validatorul runnerului')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(PLAFON_LIVRARE === 5000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE}: ${vm.out}`)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.split('\n')[0].slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
}

console.log('1. amprentele scrise în migrare / revenire = calculate')
{
  const db = await bazaNoua()
  const dr = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m, coalesce(proacl, acldefault('f', proowner))::text AS acl
      FROM pg_proc WHERE oid = to_regprocedure('public.fn_ctc_autorizatii_drept()')`)).rows[0]
  ok(dr.m === md5(corp(M22B, 'fn_ctc_autorizatii_drept')) && dr.acl === '{postgres=X/postgres}', `predicatul CTC din 20261222b: text = baza (${dr.m}, ${dr.acl})`)
  const det22 = REV22B.slice(REV22B.indexOf('-- DETALIU-START dreptul'), REV22B.indexOf('-- DETALIU-END dreptul'))
  ok(det22.includes(`'corp_md5', '${dr.m}'`), 'aceeași amprentă e cea livrată de 20261222b (detaliul din revenirea ei)')
  ok((MIG.match(new RegExp(`'${dr.m}'`, 'g')) || []).length === 2 && MIG.includes("coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres}'"),
    'migrarea verifică predicatul (corp + ACL) înainte și după')
  const chk = (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c'`)).rows.map(r => r.d)
  const bloc = (t, et) => [...t.slice(t.indexOf(`-- >>> CHECK-URI ${et}`), t.indexOf(`-- <<< CHECK-URI ${et}`)).matchAll(/\('([a-z_]+)', '((?:[^']|'')*)'\)/g)].map(m => [m[1], m[2].replace(/''/g, "'")])
  ok(JSON.stringify(chk) === JSON.stringify([STARE_VECHE.check_def]) && JSON.stringify(bloc(MIG, '20260924')) === JSON.stringify([['ofertare_parteneri_documente_categorie_check', STARE_VECHE.check_def]])
    && JSON.stringify(bloc(REV, '20260924')) === JSON.stringify(bloc(MIG, '20260924')), 'CHECK-ul de dinainte (deparsat după 20260924) = blocurile din migrare și revenire')
  const a = await livreaza(db, MIG)
  ok(a.ok, 'aplicarea (pentru amprentele de după)' + (a.ok ? '' : ': ' + a.eroare))
  const chk2 = (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c'`)).rows.map(r => r.d)
  ok(JSON.stringify(bloc(MIG, '20270111a')) === JSON.stringify([['ofertare_parteneri_documente_categorie_check', chk2[0]]]) && JSON.stringify(bloc(REV, '20270111a')) === JSON.stringify(bloc(MIG, '20270111a'))
    && chk2[0].includes("'autorizatie_ndt'::text"), 'CHECK-ul de după (deparsat) = blocurile din postcondiție și din revenire')
  for (const [et, fn] of [['garda', 'fn_ofertare_doc_cale_garda'], ['lista', 'fn_ctc_autorizatii_ndt'], ['fisierul', 'fn_ctc_autorizatie_ndt_fisier']]) {
    const bloc2 = REV.slice(REV.indexOf(`-- DETALIU-START ${et}`), REV.indexOf(`-- DETALIU-END ${et}`))
    const m = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m FROM pg_proc WHERE proname = $1`, [fn])).rows[0].m
    ok(m === md5(corp(MIG, fn)) && bloc2.includes(`'corp_md5', '${m}'`), `revenirea: corp_md5 ${et} = textul migrării = baza (${m})`)
  }
  const L = 'LOCK TABLE public.ofertare_parteneri_documente IN ACCESS EXCLUSIVE MODE NOWAIT;'
  ok(MIG.split(L).length === 2 && MIG.indexOf('DO $lock$') > MIG.indexOf('END $pre$;') && MIG.indexOf('END $lock$;') < MIG.indexOf('DO $stare$')
    && MIG.indexOf('DO $stare$') < MIG.indexOf('ALTER TABLE public.ofertare_parteneri_documente DROP CONSTRAINT')
    && REV.split(L).length === 2 && REV.indexOf(L) < REV.indexOf('DO $stare$'), 'lock-ul (NOWAIT, buget) vine ÎNAINTEA verificărilor de stare, în migrare și în revenire (L14)')
  await db.close()
}

console.log('2. comportamentul după aplicare (matricea de conturi, cazurile comune, editările)')
{
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270111a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n))
    && a.note.some(n => /documente cu fisier existente .*: 0$/.test(n)), 'migrarea se aplică (pasul „înainte” real; lock din prima; 0 documente existente)' + (a.ok ? '' : ': ' + a.eroare))
  const ids = await documente(db)
  const ab = await verifica(db, ids)
  ab.forEach(x => console.log('     ' + x))
  ok(ab.length === 0, `verificările de comportament (${CAZURI.length} cazuri de cale, ${MUCHII.length * 3 * FUSURI_X.length} momente fixe de expirare, ${ab.length} abateri)`)
  // ceasul injectat: ziua bazei = AZI (scrisă de mână), oricând rulează proba; fixtura muchiilor = calendarul din Node (tzdata), independent de bază
  const zb = (await db.query(`SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date::text AS d`)).rows[0].d
  ok(zb === AZI && ziBuc(Date.now()) === AZI, `ceasul bazei e cel injectat: ziua de azi la București = ${zb} (REF ${new Date(REF).toISOString()}), nu ziua reală`)
  const fix = MUCHII.filter(m => !(ziBuc(Date.parse(m[1])) === m[4] && ziBuc(Date.parse(m[2])) === m[4] && ziBuc(Date.parse(m[3])) === m[5]
    && ziBuc(Date.parse(m[3]) - 1) === m[4] && Date.parse(m[3]) - Date.parse(m[1]) === 1000))
  const ore = MUCHII.map(m => new Date(m[3]).getUTCHours())
  ok(fix.length === 0 && JSON.stringify(ore) === JSON.stringify([22, 22, 21, 21, 22]),
    `fixtura muchiilor (scrisă de mână) = calendarul București din Node: miezul nopții la ${ore.join('/')} UTC (zilele cu schimbare de oră au capete diferite)${fix.length ? '; greșite: ' + fix.map(m => m[0]).join(', ') : ''}`)
  const re = await livreaza(db, MIG)
  ok(!re.ok && /reaplicare/.test(re.eroare), 'reaplicarea = refuz: ' + (re.eroare || 'APLICAT').slice(0, 100))
  // dreptul retras = refuz imediat
  await db.exec(`DELETE FROM public.user_module_access WHERE profile_id = '${U.CTC}' AND module = 'ctc'`)
  const rr = await ca(db, 'CTC', `SELECT * FROM public.fn_ctc_autorizatii_ndt()`)
  ok(rr.code === '42501', 'dreptul CTC retras = 42501 imediat')
  // revenirea refuză cât timp există documente NDT (L14), nimic schimbat
  const s0 = await stare(db)
  const v = await revino(db)
  ok(!v.ok && /exista date NDT \(9 documente autorizatie_ndt, 6 cai in dosare ndt/.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s0),
    'revenirea cu documente NDT = refuz cu numărătoarea, nimic schimbat: ' + (v.eroare || 'APLICAT').slice(0, 120))
  await db.close()
}

console.log('2b. aceeași regulă a căii în BD, edge și ecran, pe căi aleatoare (trigger + RPC reale, codul real al edge-ului și al ecranului)')
{
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  ok(a.ok, 'migrarea se aplică' + (a.ok ? '' : ': ' + a.eroare))
  let s = 20271125
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const alege = l => l[Math.floor(rnd() * l.length)]
  // clasele explicite din migrare, evaluate DE BAZĂ pe tot BMP-ul (fără surogate) = lista edge-ului (eControlBd) și a ecranului (gol = 9–13, 32);
  //   pentru comparație, ce prind aici [[:cntrl:]] / [[:space:]] (depind de colaționarea bazei; de aceea migrarea nu le mai folosește)
  const cl = (await db.query(`SELECT array_agg(c ORDER BY c) FILTER (WHERE chr(c) ~ ${CONTROL}) AS ctrl, array_agg(c ORDER BY c) FILTER (WHERE chr(c) !~ ${GOL}) AS gol,
      array_agg(c ORDER BY c) FILTER (WHERE chr(c) ~ '[[:cntrl:]]') AS posix_ctrl, array_agg(c ORDER BY c) FILTER (WHERE chr(c) ~ '[[:space:]]') AS posix_space
      FROM generate_series(1, 65535) c WHERE c NOT BETWEEN 55296 AND 57343`)).rows[0]
  const jsCtrl = [...Array(65536).keys()].filter(c => c > 0 && !(c >= 55296 && c <= 57343) && EDGE.eControlBd(c))
  ok(JSON.stringify(cl.ctrl) === JSON.stringify(jsCtrl) && JSON.stringify(cl.gol) === JSON.stringify([9, 10, 11, 12, 13, 32]),
    `clasele explicite în BD = edge / ecran pe tot BMP-ul: control ${cl.ctrl.length} coduri (1–31, 127–159), gol = 9–13, 32`)
  console.log(`     (informativ, colaționarea PGlite: [[:cntrl:]] ${JSON.stringify(cl.posix_ctrl) === JSON.stringify(cl.ctrl) ? '= lista explicită' : '≠ lista explicită'}; [[:space:]] = ${JSON.stringify(cl.posix_space)})`)
  // bucățile: mai ales sigure (ca să se deschidă destule căi), plus tot ce atinge regula (control C0 / DEL / C1 și vecinii lor, spații Unicode,
  //   %, \, ., .., /); fără U+0000 (nu există în Postgres)
  const sigure = ['a', 'Z', '0', '.', '...', ' ', 'ș', 'ț', 'Ă', 'ndt', '😀', '-', '_', 'n'.repeat(201), ...[126, 160, 0x103, 0x2028, 0x2029, 0x3000, 0xfeff].map(c => String.fromCharCode(c))]
  const rele = ['..', '/', 'ndt/', '%', '%2e', String.fromCharCode(92), ...[1, 9, 10, 13, 31, 127, 128, 133, 159].map(c => String.fromCharCode(c))]
  const bucati = [...sigure, ...sigure, ...sigure, ...sigure, ...rele]
  const categorii = ['autorizatie_ndt', 'autorizatie_ndt', 'autorizatie_ndt', 'iso', 'alta', 'certificat_legal']
  const N = 3000
  const dif = []
  let nNdt = 0, nDeschise = 0, nRefuz = 0
  for (let i = 0; i < N; i++) {
    const pid = alege([1, 2]), cat = alege(categorii)
    const prefix = alege([`parteneri/${pid}/ndt/`, `parteneri/${pid}/ndt/`, `parteneri/${pid}/ndt/`, `parteneri/${3 - pid}/ndt/`, `parteneri/${pid}/`, `parteneri/0${pid}/ndt/`, ''])
    const cale = prefix + Array.from({ length: Math.floor(rnd() * 6) }, () => alege(bucati)).join('')
    const g = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES ($1, $2, 'aleator', $3) RETURNING id`, [pid, cat, cale]) })
    if (!g.ok && g.code !== '23514') { dif.push(`${JSON.stringify(cale)}: garda ${g.code} ${g.message}`); continue }
    const d = await inTx(db, async () => {
      await db.exec('SET LOCAL session_replication_role = replica')
      const r = await db.query(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES ($1, $2, 'aleator ocolit', $3) RETURNING id`, [pid, cat, cale])
      await db.exec('SET LOCAL session_replication_role = origin')
      await devino(db, 'CTC')
      return (await db.query(`SELECT public.fn_ctc_autorizatie_ndt_fisier($1) AS c`, [r.rows[0].id])).rows[0].c
    })
    const ecran = ECRAN.caleValida(cale, pid, cat), e = EDGE.caleNdtSigura(cale)
    // garda = ecranul (toate categoriile); deschiderea = NDT cu garda trecută; edge = deschiderea pe calea întoarsă (nimic deschis și refuzat)
    if (g.ok !== ecran) dif.push(`${cat} ${JSON.stringify(cale)}: garda ${g.ok} ≠ ecran ${ecran}`)
    if ((d !== null) !== (cat === 'autorizatie_ndt' && g.ok)) dif.push(`${cat} ${JSON.stringify(cale)}: deschiderea ${JSON.stringify(d)} ≠ garda NDT ${g.ok}`)
    if (d !== null && (d !== cale || e !== cale)) dif.push(`${cat} ${JSON.stringify(cale)}: BD deschide, edge ${JSON.stringify(e)}`)
    // pe firma rândului, edge (fără firmă) refuză exact ce refuză BD-ul
    if (cat === 'autorizatie_ndt' && cale.startsWith(`parteneri/${pid}/ndt/`) && (e !== null) !== g.ok) dif.push(`${JSON.stringify(cale)}: edge ${e !== null} ≠ garda ${g.ok}`)
    if (cat === 'autorizatie_ndt') nNdt++
    if (d !== null) nDeschise++
    if (!g.ok) nRefuz++
  }
  dif.slice(0, 10).forEach(x => console.log('     ' + x))
  ok(dif.length === 0 && nDeschise > 300 && nRefuz > 300 && nNdt > 1000,
    `${N} căi aleatoare: garda = ecranul, deschiderea = garda NDT, edge semnează tot ce deschide BD-ul (${nNdt} NDT, ${nDeschise} deschise, ${nRefuz} refuzate de gardă; ${dif.length} abateri)`)
  // cazurile din verdict, explicit: spații, nume de 201 / 1000+ caractere, diacritice — trigger, RPC și edge cu același rezultat
  for (const cale of ['parteneri/1/ndt/scan cu spatii.pdf', 'parteneri/1/ndt/' + 'n'.repeat(201), 'parteneri/1/ndt/' + 'x'.repeat(1000) + '.pdf', 'parteneri/1/ndt/Autorizație ștampilată RT – Brașov.pdf']) {
    const g = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'autorizatie_ndt', 'v', $1) RETURNING id`, [cale]) })
    const d = await inTx(db, async () => {
      await devino(db, 'OF')
      const r = await db.query(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'autorizatie_ndt', 'v', $1) RETURNING id`, [cale])
      await devino(db, 'CTC')
      return (await db.query(`SELECT public.fn_ctc_autorizatie_ndt_fisier($1) AS c`, [r.rows[0].id])).rows[0].c
    }).catch(e => 'EROARE ' + e.message)
    ok(g.ok && d === cale && EDGE.caleNdtSigura(cale) === cale && ECRAN.caleValida(cale, 1, 'autorizatie_ndt'),
      `verdict ${JSON.stringify(cale.slice(0, 50))}${cale.length > 50 ? '… (' + cale.length + ' caractere)' : ''}: trigger acceptă, RPC întoarce calea, edge o semnează, ecranul o acceptă`)
  }
  await db.close()
}

console.log('3. livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
{
  const b = await bazaNoua()
  const s0 = await stare(b)
  const g = await livreaza(b, MIG, { manifest: '-', final: 'ROLLBACK' })
  const G = (g.note.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = g.note.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const total = Number((g.note.map(m => m.match(/^L15_DIF_TOTAL (\d+) /)).find(Boolean) || [])[1])
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  ok(g.ok && G && total === listaObiecte(manifest).length && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    `generatorul de manifest: GLOBAL ${G}, ${total} diferențe anunțate = rândurile tipărite; ROLLBACK, starea neschimbată` + (g.ok ? '' : ': ' + g.eroare))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270111a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(!lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  // L25: lista așteptată scrisă aici, independent de fișier și de generator
  const ASTEPTATE = [
    'constrangere\tconstrangere tabel public.ofertare_parteneri_documente.ofertare_parteneri_documente_categorie_check\tschimbat',
    'functie\tfunctie public.fn_ctc_autorizatie_ndt_fisier(bigint)\tcreat',
    'functie\tfunctie public.fn_ctc_autorizatii_ndt()\tcreat',
    'functie\tfunctie public.fn_ofertare_doc_cale_garda()\tcreat',
    'relatie\trelatie public.ofertare_parteneri_documente_fisier_path_uq\tcreat',
    'trigger\ttrigger public.ofertare_parteneri_documente.trg_ofertare_doc_cale_garda\tcreat',
  ].sort()
  ok(JSON.stringify(revizuit) === JSON.stringify(ASTEPTATE), 'lista revizuită = CHECK-ul (schimbat) + 3 funcții + indexul + trigger-ul (create), nimic altceva: ' + revizuit.join(' | '))
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  writeFileSync(fIncomplet, manifest.split('\n').filter(l => !l.startsWith('trigger\t')).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && /NEDECLARAT/.test(gi.eroare + gi.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul trigger-ului = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.ok && j.note.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.note.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
  'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat' + (j.ok ? '' : ': ' + j.eroare))
  const s1 = await stare(b)
  ok(!eVeche(s1) && s1.functii === 'fn_ctc_autorizatie_ndt_fisier,fn_ctc_autorizatii_ndt,fn_ofertare_doc_cale_garda' && s1.index_uq, 'după livrarea aprobată: obiectele noi există')
  const nr0 = (await b.query(`SELECT (SELECT count(*) FROM public.ofertare_parteneri)::int AS p, (SELECT count(*) FROM public.profiles)::int AS u,
      (SELECT count(*) FROM public.user_module_access)::int AS m`)).rows[0]
  const note = []
  let eroareDry = null
  try { await b.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroareDry = e.message; try { await b.exec('ROLLBACK') } catch { /* închisă */ } }
  const asteptate = ['t_categorie OK', 't_garda OK', 't_unic OK', 't_lista OK', 't_fisier OK', 'TOTUL OK']
  ok(!eroareDry && asteptate.every(t => note.some(n => n.startsWith('DRY 20270111a ' + t))), `dry-run: ${asteptate.length} blocuri OK` + (eroareDry ? ': ' + eroareDry : ''))
  const nr1 = (await b.query(`SELECT (SELECT count(*) FROM public.ofertare_parteneri)::int AS p, (SELECT count(*) FROM public.profiles)::int AS u,
      (SELECT count(*) FROM public.user_module_access)::int AS m`)).rows[0]
  ok(JSON.stringify(nr1) === JSON.stringify(nr0) && JSON.stringify(await stare(b)) === JSON.stringify(s1)
    && (await b.query(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_ofertare_doc_cale_garda'`)).rows[0].tgenabled === 'O',
  'dry-run: ROLLBACK, nimic rămas (firme, conturi, drepturi, documente; trigger-ul activ)')
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_categorie FAIL/.test(ef || ''), 'dry-run pe baza fără 20270111a = eșec (t_categorie): ' + (ef || 'TRECE').slice(0, 90))
  await fara.close(); await b.close()
}

console.log('4. refuzurile migrării (pe bază nouă, nimic schimbat) și revenirea')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['un CHECK în plus pe tabel', {}, /CHECK-urile ofertare_parteneri_documente difera de 20260924: \+ofertare_doc_alt/,
    `ALTER TABLE public.ofertare_parteneri_documente ADD CONSTRAINT ofertare_doc_alt CHECK (denumire <> '')`],
  ['CHECK-ul de categorie schimbat', {}, /difera de 20260924: ofertare_parteneri_documente_categorie_check/,
    `ALTER TABLE public.ofertare_parteneri_documente DROP CONSTRAINT ofertare_parteneri_documente_categorie_check, ADD CONSTRAINT ofertare_parteneri_documente_categorie_check CHECK (categorie <> '')`],
  ['alt trigger pe tabel', {}, /triggerele ofertare_parteneri_documente difera de 20260924/,
    `CREATE TRIGGER trg_a_alt BEFORE INSERT ON public.ofertare_parteneri_documente FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_parteneri_documente_touch()`],
  ['predicatul CTC cu drept în plus', {}, /fn_ctc_autorizatii_drept nu e cea din 20261222b/, 'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_drept() TO authenticated'],
  ['predicatul CTC schimbat (corp)', {}, /fn_ctc_autorizatii_drept nu e cea din 20261222b/,
    `CREATE OR REPLACE FUNCTION public.fn_ctc_autorizatii_drept() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`],
  ['coloană lipsă', {}, /coloana ofertare_parteneri\.cui lipseste/, 'ALTER TABLE public.ofertare_parteneri DROP COLUMN cui'],
  ['date: un document non-NDT existent sub ndt/', {}, /date existente de lamurit inainte de garda: 1 cai in alta forma/,
    `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/ndt/1700000000300_x.pdf')`],
  ['date: o cale existentă în altă formă decât a ecranului', {}, /1 cai in alta forma decat a ecranului, 0 cai/,
    `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'altundeva/x.pdf')`],
  ['date: aceeași cale pe două rânduri', {}, /0 cai in alta forma decat a ecranului, 1 cai folosite de mai multe randuri/,
    `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/1700000000301_x.pdf'), (1, 'iso', 'y', 'parteneri/1/1700000000301_x.pdf')`],
]) {
  const b = await bazaNoua()
  if (pregatire) await b.exec(pregatire)
  const inainte = await stare(b)
  const r = await livreaza(b, MIG, opt)
  ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(await stare(b)), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 120)})`)
  await b.close()
}
{
  // datele existente în forma ecranului de azi trec (garda nu lovește rândurile vechi)
  const b = await bazaNoua()
  await b.exec(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'iso', 'vechi', 'parteneri/1/1700000000302_iso_vechi.pdf'), (2, 'alta', 'fara', NULL)`)
  const r = await livreaza(b, MIG)
  ok(r.ok && r.note.some(n => /documente cu fisier existente .*: 1$/.test(n)), 'un document vechi în forma ecranului de azi: aplicarea trece (NOTICE: 1)' + (r.ok ? '' : ': ' + r.eroare))
  await b.close()
}
{
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  ok(a.ok, 'aplicare pentru revenire')
  const s1 = await stare(db)
  ok(!(await revino(db, REV, { plafon: 5000 })).ok && JSON.stringify(await stare(db)) === JSON.stringify(s1), 'revenirea cu plafonul 5000 = refuz (cere 2000)')
  ok(!(await revino(db, REV, { nume: NUME })).ok, 'revenirea cu marcajul migrării = refuz')
  ok(!(await revino(db, REV, { marcaj: false })).ok, 'revenirea fără marcaj = refuz')
  const v = await revino(db)
  const s2 = await stare(db)
  ok(v.ok && eVeche(s2), 'revenirea: CHECK-ul vechi, fără trigger / funcții / index' + (v.ok ? '' : ': ' + v.eroare))
  // după revenire: Parteneri și sudorii din CTC merg ca înainte
  const p1 = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'iso', 'x', 'parteneri/1/1700000000400_iso.pdf') RETURNING id`) })
  const p2 = await inTx(db, async () => { await devino(db, 'OF'); return incearca(db, `INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire) VALUES (1, 'autorizatie_ndt', 'x') RETURNING id`) })
  const sud = await ca(db, 'CTC', `SELECT count(*)::int AS n FROM public.fn_ctc_autorizatii_sudori()`)
  ok(p1.ok && !p2.ok && p2.code === '23514' && !sud.code, 'după revenire: Parteneri scrie categoriile vechi, refuză NDT prin CHECK; sudorii din CTC se citesc')
  const v2 = await revino(db)
  ok(!v2.ok && /CHECK-urile ofertare_parteneri_documente difera de 20270111a/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 100))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok, 're-aplicarea după revenire' + (a2.ok ? '' : ': ' + a2.eroare))
  const ab = await verifica(db, await documente(db))
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
  await db.close()
}
// deriva după livrare: revenirea refuză cu câmpul numit, nimic șters
for (const [nume, pregatire, re] of [
  ['funcție schimbată', `CREATE OR REPLACE FUNCTION public.fn_ctc_autorizatie_ndt_fisier(p_document_id bigint) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 'x'; END $f$;`,
    /\(fn_ctc_autorizatie_ndt_fisier\): corp_md5: are [0-9a-f]{32}, livrat [0-9a-f]{32}$/],
  ['GRANT în plus către service_role', 'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_ndt() TO service_role;', /\(fn_ctc_autorizatii_ndt\): acl: are authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE/],
  ['garda cu EXECUTE pentru authenticated', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_doc_cale_garda() TO authenticated;', /\(fn_ofertare_doc_cale_garda\): acl: are authenticated:EXECUTE, postgres:EXECUTE, livrat postgres:EXECUTE$/],
  ['trigger-ul dezactivat', 'ALTER TABLE public.ofertare_parteneri_documente DISABLE TRIGGER trg_ofertare_doc_cale_garda;', /trigger-ul de cale nu e cel din 20270111a/],
  ['alt obiect depinde de RPC', `CREATE FUNCTION public.zz_foloseste() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT public.fn_ctc_autorizatie_ndt_fisier(1) $f$;`, /alte obiecte depind de functia fn_ctc_autorizatie_ndt_fisier/],
  ['un document alta sub ndt/ scris ocolind trigger-ul', `SET session_replication_role = replica; INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/ndt/1700000000500_x.pdf'); SET session_replication_role = origin;`,
    /exista date NDT \(0 documente autorizatie_ndt, 1 cai in dosare ndt/],
]) {
  const db = await bazaNoua()
  await livreaza(db, MIG)
  await db.exec(pregatire)
  const s = await stare(db)
  const v = await revino(db)
  ok(!v.ok && re.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `revenirea refuză (${nume}), nimic șters: ${(v.eroare || 'APLICAT').slice(0, 140)}`)
  await db.close()
}
// revenirea 20261222b refuză cât timp există funcțiile de aici (ele cheamă predicatul): ordinea e 20270111a întâi
{
  const db = await bazaNoua()
  await livreaza(db, MIG)
  let m = null
  try { await livreazaSimplu(db, '20261222b_ctc_autorizatii_citire_ROLLBACK', REV22B, 2000) } catch (e) { m = e.message }
  ok(/alte obiecte depind de functia fn_ctc_autorizatii_drept/.test(m || ''), 'revenirea 20261222b refuză cu 20270111a aplicată: ' + (m || 'APLICAT').slice(0, 100))
  await db.close()
}

console.log('5. mutanți')
// postcondițiile scoase: doar verificările de comportament (secțiunea 2) pot prinde mutantul
const POST_A = MIG.indexOf('DO $post$'), POST_B = MIG.indexOf('END $post$;') + 'END $post$;'.length
const FARA_POST = t => { const a = t.indexOf('DO $post$'), b = t.indexOf('END $post$;') + 'END $post$;'.length; return t.slice(0, a) + "DO $post$ BEGIN RAISE NOTICE 'postconditii scoase (mutant)'; END $post$;" + t.slice(b) }
ok(POST_A > 0 && POST_B > POST_A, 'blocul $post$ se găsește')
const comport = async text => {
  const db = await bazaNoua()
  try {
    const a = await livreaza(db, text)
    if (!a.ok) return ['aplicare: ' + a.eroare.slice(0, 120)]
    return await verifica(db, await documente(db))
  } finally { await db.close() }
}
{
  const ab = await comport(FARA_POST(MIG))
  ok(ab.length === 0, `martor: originalul fără postcondiții trece toate verificările (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
}
const DREPT = "  IF NOT public.fn_ctc_autorizatii_drept() THEN\n    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';\n  END IF;\n"
const MUTANTI = [
  ['M1 fără trigger', [["CREATE TRIGGER trg_ofertare_doc_cale_garda BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie ON public.ofertare_parteneri_documente\n  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_doc_cale_garda();\n", '']]],
  ['M2 RPC-ul de deschidere fără reverificarea căii', [["   WHERE d.id = p_document_id AND d.categorie = 'autorizatie_ndt'\n     AND d.fisier_path ~ ('^parteneri/' || d.partener_id::text || '/ndt/[^/]+$')\n     AND strpos(d.fisier_path, chr(92)) = 0 AND strpos(d.fisier_path, '%') = 0 AND d.fisier_path !~ " + CONTROL + "\n     AND NOT ('.' = ANY (string_to_array(d.fisier_path, '/')) OR '..' = ANY (string_to_array(d.fisier_path, '/')));",
    "   WHERE d.id = p_document_id AND d.categorie = 'autorizatie_ndt';"]]],
  ['M3 lista fără filtrul categoriei', [["    JOIN public.ofertare_parteneri p ON p.id = d.partener_id\n   WHERE d.categorie = 'autorizatie_ndt';", '    JOIN public.ofertare_parteneri p ON p.id = d.partener_id;']]],
  ['M4 lista întoarce și calea', [['fara_expirare boolean, stare text, are_fisier boolean)', 'fara_expirare boolean, stare text, are_fisier boolean, cale text)'],
    ['(d.fisier_path IS NOT NULL AND d.fisier_path ~ ' + GOL + ')\n    FROM', '(d.fisier_path IS NOT NULL AND d.fisier_path ~ ' + GOL + '), d.fisier_path::text\n    FROM']]],
  ['M5 garda fără regula „non-NDT nu stă sub ndt/”', [["  ELSIF strpos('/' || NEW.fisier_path, '/ndt/') > 0 THEN\n    RAISE EXCEPTION 'ofertare: dosarul NDT e doar pentru autorizațiile de control nedistructiv'\n      USING ERRCODE = '23514';\n", '']]],
  ['M6 garda fără segmentele . / ..', [["\n     OR '.' = ANY (string_to_array(NEW.fisier_path, '/')) OR '..' = ANY (string_to_array(NEW.fisier_path, '/')) THEN", ' THEN']]],
  ['M7 fără indexul unic', [['CREATE UNIQUE INDEX ofertare_parteneri_documente_fisier_path_uq ON public.ofertare_parteneri_documente (fisier_path) WHERE fisier_path IS NOT NULL;\n', '']]],
  ['M8 expiră azi = expirat', [["WHEN d.data_valabilitate < v_azi THEN 'expirat'", "WHEN d.data_valabilitate <= v_azi THEN 'expirat'"]]],
  ['M9 ziua după fusul sesiunii (nu România)', [["DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;", 'DECLARE v_azi date := current_date;']]],
  ['M10 lista fără drept = listă goală (fail-open)', [[DREPT + '  RETURN QUERY', "  IF NOT public.fn_ctc_autorizatii_drept() THEN\n    RETURN;\n  END IF;\n  RETURN QUERY"]]],
  ['M11 deschiderea fără verificarea dreptului', [[DREPT + '  SELECT d.fisier_path INTO v_cale', '  SELECT d.fisier_path INTO v_cale']]],
  ['M13 trigger-ul fără partener_id în UPDATE OF', [['BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie ON', 'BEFORE INSERT OR UPDATE OF fisier_path, categorie ON']]],
  ['M14 deschiderea fără filtrul categoriei', [["   WHERE d.id = p_document_id AND d.categorie = 'autorizatie_ndt'\n", '   WHERE d.id = p_document_id\n']]],
  ['M15a garda NDT fără ancora ^', [["NEW.fisier_path !~ ('^parteneri/' || NEW.partener_id::text", "NEW.fisier_path !~ ('parteneri/' || NEW.partener_id::text"]]],
  ['M15b deschiderea fără ancora ^', [["d.fisier_path ~ ('^parteneri/' || d.partener_id::text", "d.fisier_path ~ ('parteneri/' || d.partener_id::text"]]],
  ['M16 garda fără „%”', [["OR strpos(NEW.fisier_path, chr(92)) > 0 OR strpos(NEW.fisier_path, '%') > 0\n", 'OR strpos(NEW.fisier_path, chr(92)) > 0\n']]],
  ['M17 garda fără backslash', [[' OR strpos(NEW.fisier_path, chr(92)) > 0', '']]],
  ['M18 garda fără caracterele de control', [['\n     OR NEW.fisier_path ~ ' + CONTROL, '']]],
  ['M19 garda fără „cale goală”', [['IF NEW.fisier_path !~ ' + GOL + ' OR strpos', 'IF strpos']]],
  ['M20 fără dată = valabil', [["WHEN d.data_valabilitate IS NULL THEN 'necunoscut'", "WHEN d.data_valabilitate IS NULL THEN 'valabil'"]]],
  ['M21 fara_expirare ignorat', [["(CASE WHEN d.fara_expirare IS TRUE THEN 'valabil'", "(CASE WHEN false THEN 'valabil'"]]],
  ['M22 deschiderea fără segmentele . / ..', [["\n     AND NOT ('.' = ANY (string_to_array(d.fisier_path, '/')) OR '..' = ANY (string_to_array(d.fisier_path, '/')));", ';']]],
  ['M23 deschiderea fără backslash / % / control', [["\n     AND strpos(d.fisier_path, chr(92)) = 0 AND strpos(d.fisier_path, '%') = 0 AND d.fisier_path !~ " + CONTROL, '']]],
  ['M24 trigger-ul doar la INSERT', [['BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie ON', 'BEFORE INSERT ON']]],
  ['M25 are_fisier și pentru o cale goală', [['(d.fisier_path IS NOT NULL AND d.fisier_path ~ ' + GOL + ')\n    FROM', '(d.fisier_path IS NOT NULL)\n    FROM']]],
  // r2: expirarea la momente fixe (X) — ziua calculată greșit doar în jurul miezului nopții / al schimbării de oră
  ['M26 ziua după UTC (nu România)', [["DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;", "DECLARE v_azi date := (now() AT TIME ZONE 'UTC')::date;"]]],
  ['M27 ora fixă UTC+2 (fără ora de vară)', [["DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;", "DECLARE v_azi date := ((now() AT TIME ZONE 'UTC') + interval '2 hours')::date;"]]],
  ['M28 ora fixă UTC+3 (mereu ora de vară)', [["DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;", "DECLARE v_azi date := ((now() AT TIME ZONE 'UTC') + interval '3 hours')::date;"]]],
  ['M29 ziua de mâine e deja „azi” (expiră cu o zi mai devreme)', [["DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;", "DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date + 1;"]]],
  // r2: clasele explicite (aceleași în BD, edge și ecran). [[:cntrl:]] coincide în PGlite (C.UTF-8) cu lista explicită (proba 2b) — mutant
  // echivalent aici, deci NU e în listă; în schimb control fără C1 (ca [[:cntrl:]] sub colaționarea C) și „gol” = [[:space:]] diferă și pică
  ['M30 garda: control doar C0 + DEL (fără C1)', [['\n     OR NEW.fisier_path ~ ' + CONTROL, "\n     OR NEW.fisier_path ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']')"]]],
  ['M31 deschiderea: control doar C0 + DEL (fără C1)', [['AND d.fisier_path !~ ' + CONTROL, "AND d.fisier_path !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']')"]]],
  ['M36 garda: „gol” înapoi la [[:space:]] (r1, depinde de colaționare)', [['IF NEW.fisier_path !~ ' + GOL + ' OR strpos', "IF NEW.fisier_path !~ '[^[:space:]]' OR strpos"]]],
  ['M32 garda cu U+2028 drept control', [['\n     OR NEW.fisier_path ~ ' + CONTROL, "\n     OR NEW.fisier_path ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || chr(8232) || ']')"]]],
  ['M33 deschiderea refuză și NBSP (control până la U+00A0)', [['AND d.fisier_path !~ ' + CONTROL, "AND d.fisier_path !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(160) || ']')"]]],
  ['M34 garda cu limita de 200 pe numele NDT', [["NEW.fisier_path !~ ('^parteneri/' || NEW.partener_id::text || '/ndt/[^/]+$')", "NEW.fisier_path !~ ('^parteneri/' || NEW.partener_id::text || '/ndt/[^/]{1,200}$')"]]],
  ['M35 deschiderea doar ASCII (ca edge-ul r1)', [["d.fisier_path ~ ('^parteneri/' || d.partener_id::text || '/ndt/[^/]+$')", "d.fisier_path ~ ('^parteneri/' || d.partener_id::text || '/ndt/[A-Za-z0-9._-]+$')"]]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0, `${nume} pică comportamental (${ab[0] || 'NU a picat'})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără trigger', MUTANTI[0][1], /postconditie: trigger-ul de cale/],
  ['S2 fără indexul unic', MUTANTI[6][1], /postconditie: indexul unic/],
  ['S3 lista cu EXECUTE pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_ndt() TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_ndt() TO authenticated, anon;']], /postconditie: functia public\.fn_ctc_autorizatii_ndt\(\)/],
  ['S4 garda cu EXECUTE pentru authenticated', [['COMMENT ON FUNCTION public.fn_ofertare_doc_cale_garda()', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_doc_cale_garda() TO authenticated;\nCOMMENT ON FUNCTION public.fn_ofertare_doc_cale_garda()']], /postconditie: functia public\.fn_ofertare_doc_cale_garda\(\)/],
  ['S5 trigger-ul fără partener_id', MUTANTI[11][1], /postconditie: trigger-ul de cale/],
  ['S6 lista SECURITY INVOKER', [["LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$\nDECLARE v_azi", "LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$\nDECLARE v_azi"]], /postconditie: functia public\.fn_ctc_autorizatii_ndt\(\)/],
  ['S7 o funcție nouă cheamă altceva', [["  IF NOT public.fn_ctc_autorizatii_drept() THEN\n    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';\n  END IF;\n  RETURN QUERY",
    "  IF NOT public.fn_ctc_autorizatii_drept() OR NOT public.fn_are_acces_ofertare() IS NOT NULL THEN\n    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';\n  END IF;\n  RETURN QUERY"]], /cheama in afara predicatului CTC: (public\.)?fn_are_acces_ofertare\(\)/],
]) {
  const db = await bazaNoua()
  const s = await stare(db)
  const r = await livreaza(db, aplica(MIG, inl))
  ok(!r.ok && re.test(r.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `${nume}: refuzat de postcondiții (${(r.eroare || 'APLICAT').slice(0, 110)})`)
  await db.close()
}
console.log('   pe gărzile de stare ale migrării și pe revenire (același scenariu, alt rezultat)')
const rezultat = async (scenariu, text) => {
  const db = await bazaNoua()
  try { const r = await scenariu(db, text); return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(await stare(db))}` } finally { await db.close() }
}
const SCEN = {
  faraL15: (db, t) => livreaza(db, t, { ag: false }),
  subNdt: async (db, t) => { await db.exec(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/ndt/1700000000600_x.pdf')`); return livreaza(db, t) },
  dublu: async (db, t) => { await db.exec(`INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/1700000000601_x.pdf'), (1, 'iso', 'y', 'parteneri/1/1700000000601_x.pdf')`); return livreaza(db, t) },
  predicat: async (db, t) => { await db.exec('GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_drept() TO authenticated'); return livreaza(db, t) },
  checkStrain: async (db, t) => { await db.exec(`ALTER TABLE public.ofertare_parteneri_documente ADD CONSTRAINT ofertare_doc_alt CHECK (denumire <> '')`); return livreaza(db, t) },
  revSubNdt: async (db, t) => { await livreaza(db, MIG); await db.exec(`SET session_replication_role = replica; INSERT INTO public.ofertare_parteneri_documente (partener_id, categorie, denumire, fisier_path) VALUES (1, 'alta', 'x', 'parteneri/1/ndt/1700000000602_x.pdf'); SET session_replication_role = origin;`); return revino(db, t) },
  revCorp: async (db, t) => { await livreaza(db, MIG); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_ctc_autorizatie_ndt_fisier(p_document_id bigint) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 'x'; END $f$;`); return revino(db, t) },
  revTrigger: async (db, t) => { await livreaza(db, MIG); await db.exec('ALTER TABLE public.ofertare_parteneri_documente DISABLE TRIGGER trg_ofertare_doc_cale_garda'); return revino(db, t) },
  revDep: async (db, t) => { await livreaza(db, MIG); await db.exec(`CREATE FUNCTION public.zz_foloseste() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT public.fn_ctc_autorizatie_ndt_fisier(1) $f$;`); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără garda AMPRENTA_GLOBALA', 'mig', [["    RAISE EXCEPTION '20270111a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';\n", '']], 'faraL15'],
  ['P2 migrare: fără verificarea căilor existente', 'mig', [['  IF v_strain > 0 OR v_dublu > 0 THEN', '  IF v_dublu > 0 THEN']], 'subNdt'],
  ['P3 migrare: fără verificarea dublurilor', 'mig', [['  IF v_strain > 0 OR v_dublu > 0 THEN', '  IF v_strain > 0 THEN']], 'dublu'],
  ['P4 migrare: fără verificarea predicatului CTC', 'mig', [["                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres}') THEN\n    RAISE EXCEPTION '20270111a: fn_ctc_autorizatii_drept nu e cea din 20261222b",
    ") THEN\n    RAISE EXCEPTION '20270111a: fn_ctc_autorizatii_drept nu e cea din 20261222b"]], 'predicat'],
  ['P5 migrare: fără verificarea CHECK-urilor de dinainte', 'mig', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270111a: CHECK-urile ofertare_parteneri_documente difera de 20260924: %', v_rau; END IF;\n", '']], 'checkStrain'],
  ['R1 revenire: fără refuzul pe căile din ndt/', 'rev', [['  IF v_ndt > 0 OR v_sub > 0 THEN', '  IF v_ndt > 0 THEN']], 'revSubNdt'],
  ['R2 revenire: fără corp_md5', 'rev', [['     WHERE (v_are ->> k) IS DISTINCT FROM (r.livrat ->> k);', "     WHERE k <> 'corp_md5' AND (v_are ->> k) IS DISTINCT FROM (r.livrat ->> k);"]], 'revCorp'],
  ['R3 revenire: fără starea trigger-ului', 'rev', [["                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0\n", '                   AND tg.tgqual IS NULL AND tg.tgnargs = 0\n']], 'revTrigger'],
  ['R4 revenire: fără verificarea dependențelor textuale', 'rev', [["                     AND p.prosrc ~ ('[[:<:]]' || r.nume || '[[:>:]]')) THEN", "                     AND false) THEN"]], 'revDep'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro), `${nume} prins: original «${ro.slice(0, 80)}» ≠ mutant «${rm.slice(0, 80)}»`)
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
