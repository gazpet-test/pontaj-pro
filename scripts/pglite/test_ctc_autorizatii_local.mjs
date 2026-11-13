// Proba LOCALĂ a migrării 20261222b (autorizațiile sudorilor citite din CTC, fără acces HR) pe PGlite (Postgres în WASM, în memorie) —
// NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261222b_ctc_autorizatii_schelet.sql (coloanele live ale hr_autorizatii + câmpuri personale în employees /
//   hr_personal_extern, ca să se vadă că NU ies).
// 1. BASELINE-ul L15 calculat cu scriptul coordonatorului (scripts/ctc_autorizatii_amprente.sql, READ ONLY) și pus în blocul marcat; migrarea
//    aplicată ca runnerul (--plafon-tranzactie-ms 2000).
// 2. VERIFICĂRI (valorile așteptate scrise de mână din cerere, L25), ca rolul authenticated cu JWT-ul fiecărui cont: cont CTC (ctc / ctc.*)
//    vede DOAR autorizațiile de sudor neșterse, valabile și expirate, DOAR câmpurile permise; HR singur / alt modul / 'ctcx' / fără JWT /
//    anon NU; fișierul: doar al unei autorizații de sudor neșterse, același refuz pentru alt tip / șters / fără scan / inexistent; dreptul
//    retras = refuz imediat; starea după ziua din România (expiră azi = încă valabilă).
// 3. REFUZURI (marcaj, plafon, baseline necompletat, auth.uid() schimbat, reaplicare) + revenirea (refuzuri, aplicare -> revenire -> re-aplicare).
// 4. MUTANȚI: fiecare TREBUIE să pice.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ctc_autorizatii_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261222b_ctc_autorizatii_schelet.sql')
const MIG = citeste('supabase/migrations/20261222b_ctc_autorizatii_citire.sql')
const REV = citeste('supabase/revenire/20261222b_ctc_autorizatii_citire_ROLLBACK.sql')
const SCRIPT = citeste('scripts/ctc_autorizatii_amprente.sql')
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => { const i0 = MIG.indexOf('-- >>> BASELINE 20261222b'), i = MIG.indexOf(BL_A, i0) + BL_A.length; return MIG.slice(i, MIG.indexOf(BL_B, i)) })()
if (!PLACEHOLDER.trim()) { console.error('blocul BASELINE 20261222b nu se găsește'); process.exit(1) }
const MIG_NECOMPLETAT = MIG.split(PLACEHOLDER).join("    ('DE_COMPLETAT', 'DE_COMPLETAT')")

const sectiune = (t) => { const i = t.indexOf('WITH RECURSIVE'); return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length) }
async function baseline(db) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try { return (await db.query(sectiune(SCRIPT))).rows } finally { await db.exec('ROLLBACK') }
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}\n${text}\nCOMMIT;`, { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text, o) => caRunner(db, '20261222b_ctc_autorizatii_citire', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261222b_ctc_autorizatii_citire_ROLLBACK', text, o)

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000c1', CTC: '00000000-0000-0000-0000-0000000000c2', CTC_SUB: '00000000-0000-0000-0000-0000000000c3',
  HR: '00000000-0000-0000-0000-0000000000c4', CTCX: '00000000-0000-0000-0000-0000000000c5', STRAIN: '00000000-0000-0000-0000-0000000000c6',
  DOAR_FLAG: '00000000-0000-0000-0000-0000000000c7',
}
const ziBuc = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ms))
const AZI = ziBuc(Date.now())
const zi = (n) => { const [y, m, d] = AZI.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const DATE = `
INSERT INTO public.profiles (id, name, is_owner, can_access_ctc) VALUES
  ('${U.OWNER}', 'OWNER', true, false), ('${U.CTC}', 'CTC', false, false), ('${U.CTC_SUB}', 'CTC SUB', false, false),
  ('${U.HR}', 'HR', false, false), ('${U.CTCX}', 'CTCX', false, false), ('${U.STRAIN}', 'STRAIN', false, false), ('${U.DOAR_FLAG}', 'FLAG', false, true);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.CTC}', 'ctc', 'viewer'), ('${U.CTC_SUB}', 'ctc.carti', 'editor'), ('${U.HR}', 'hr', 'admin'), ('${U.HR}', 'hr.autorizatii', 'admin'),
  ('${U.CTCX}', 'ctcx', 'admin'), ('${U.STRAIN}', 'executie', 'admin');
INSERT INTO public.employees (id, name, cnp, telefon, email, iban) VALUES
  (1, 'POPESCU ION', '1800101000000', '0700000001', 'ion@exemplu.ro', 'RO00TEST'), (2, 'IONESCU VASILE', '1800101000001', '0700000002', NULL, NULL),
  (3, 'GEORGESCU DAN', NULL, NULL, NULL, NULL);
INSERT INTO public.hr_personal_extern (id, nume, firma, cui_firma, telefon, email) VALUES (1, 'EXTERN MIHAI', 'FIRMA SUDURA SRL', 'RO123', '0700000009', 'm@f.ro');
INSERT INTO public.hr_autorizatii_tipuri (id, cod, denumire, categorie) VALUES
  (1, 'SUDOR_PEHD', 'Sudor PEHD', 'sudura'), (2, 'SUDOR_OTEL', 'Sudor oțel', 'sudura'), (3, 'ANRE', 'Autorizare ANRE', 'anre'), (4, 'RSVTI', 'RSVTI', 'iscir');
INSERT INTO public.hr_autorizatii (id, employee_id, extern_id, tip_id, numar_autorizatie, emitent, data_emitere, data_expirare, fara_expirare,
    procedeu_sudura, diametru_teava_mm, calitate_material, subcategorie, fisier_path, observatii, deleted_at, inlocuita_de_id) VALUES
  (10, 1, NULL, 1, 'S-10', 'ISCIR', DATE '2024-01-10', DATE '${zi(30)}', false, 'electrofuziune', 315, 'PE100', 'cat. 1', '1/a.pdf', 'nota interna', NULL, NULL),
  (11, 1, NULL, 2, 'S-11', 'ISCIR', DATE '2022-01-10', DATE '${zi(-1)}', false, '111', 508, 'L360', NULL, '1/b.pdf', NULL, NULL, NULL),
  (12, 2, NULL, 1, 'S-12', 'ISCIR', NULL, NULL, true, 'cap la cap', 110, 'PE80', NULL, NULL, NULL, NULL, NULL),
  (13, 2, NULL, 1, 'S-13', NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, '   ', NULL, NULL, NULL),
  (14, 1, NULL, 3, 'A-14', 'ANRE', NULL, DATE '${zi(100)}', false, NULL, NULL, NULL, NULL, '1/anre.pdf', NULL, NULL, NULL),
  (15, 2, NULL, 1, 'S-15', 'ISCIR', NULL, DATE '${zi(100)}', false, NULL, NULL, NULL, NULL, '2/sters.pdf', NULL, now(), NULL),
  (16, NULL, 1, 2, 'S-16', 'ISCIR', NULL, DATE '${zi(10)}', false, '141', 219, 'L245', NULL, 'extern-1/c.pdf', NULL, NULL, NULL),
  (17, 1, NULL, 1, 'S-17', 'ISCIR', NULL, DATE '${AZI}', false, NULL, NULL, NULL, NULL, '1/azi.pdf', NULL, NULL, NULL),
  (18, 3, NULL, 1, 'S-18', 'ISCIR', NULL, DATE '${zi(-200)}', false, NULL, NULL, NULL, NULL, '3/vechi.pdf', NULL, NULL, 10),
  (19, 3, NULL, 4, 'R-19', 'ISCIR', NULL, NULL, true, NULL, NULL, NULL, NULL, '3/rsvti.pdf', NULL, NULL, NULL);`
// așteptat, scris de mână: id → [titular, extern, firma, stare, inlocuita, are_scan]
const ASTEPTAT = {
  10: ['POPESCU ION', false, null, 'valabila', false, true],
  11: ['POPESCU ION', false, null, 'expirata', false, true],
  12: ['IONESCU VASILE', false, null, 'valabila', false, false],
  13: ['IONESCU VASILE', false, null, 'fara_data', false, false],
  16: ['EXTERN MIHAI', true, 'FIRMA SUDURA SRL', 'valabila', false, true],
  17: ['POPESCU ION', false, null, 'valabila', false, true],
  18: ['GEORGESCU DAN', false, null, 'expirata', true, true],
}
const CAMPURI = ['are_scan', 'calitate_material', 'data_emitere', 'data_expirare', 'diametru_teava_mm', 'emitent', 'extern', 'fara_expirare', 'firma', 'id',
  'inlocuita', 'numar_autorizatie', 'procedeu_sudura', 'stare', 'subcategorie', 'tip', 'titular']

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(DATE)
  return db
}
const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0)
await BAZA0.close()
if (JSON.stringify(B0.map(r => r.eticheta)) !== JSON.stringify(['functie auth.uid()'])) {
  console.error('baseline: închiderea nu e lanțul așteptat: ' + B0.map(r => r.eticheta).join(', ')); process.exit(1)
}
console.log(`baseline L15 20261222b (schema falsă): ${B0.map(r => r.eticheta + (r.atentie ? ' [' + r.atentie + ']' : '')).join('; ')}`)
const linii = (rows) => rows.map((r, i) => (i === 0 ? '    ' : '  , ') + r.linie_baseline.replace(/^\s*,?\s*/, ''))
const cuBaseline = (text, rows) => aplica(text, [[PLACEHOLDER, linii(rows).join('\n')]])
const MIG_B = cuBaseline(MIG, B0)

async function ca(db, rol, uid, sql) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('ROLLBACK'); return { rows: r.rows, fields: r.fields.map(f => f.name) } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}

async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  // lista: conturile CTC (ctc, ctc.*) și owner-ul văd EXACT autorizațiile de sudor neșterse, doar câmpurile permise
  for (const cont of ['CTC', 'CTC_SUB', 'OWNER']) {
    const r = await ca(db, 'authenticated', U[cont], `SELECT * FROM public.fn_ctc_autorizatii_sudori() ORDER BY id`)
    if (r.code) { ab.push(`L ${cont}: ${r.code} ${r.message}`); continue }
    if (JSON.stringify([...r.fields].sort()) !== JSON.stringify(CAMPURI)) ab.push(`L ${cont}: câmpuri ${r.fields.join(',')} (aștepta ${CAMPURI.join(',')})`)
    const ids = r.rows.map(x => Number(x.id))
    if (JSON.stringify(ids) !== JSON.stringify(Object.keys(ASTEPTAT).map(Number))) ab.push(`L ${cont}: id-uri ${JSON.stringify(ids)}`)
    for (const x of r.rows) {
      const a = ASTEPTAT[Number(x.id)]
      if (!a) continue
      const am = [x.titular, x.extern, x.firma, x.stare, x.inlocuita, x.are_scan]
      if (JSON.stringify(am) !== JSON.stringify(a)) ab.push(`L ${cont} id ${x.id}: ${JSON.stringify(am)} (aștepta ${JSON.stringify(a)})`)
    }
    const s10 = r.rows.find(x => Number(x.id) === 10)
    if (s10 && (s10.procedeu_sudura !== 'electrofuziune' || Number(s10.diametru_teava_mm) !== 315 || s10.calitate_material !== 'PE100' || s10.tip !== 'Sudor PEHD'))
      ab.push('L câmpurile profesionale ale autorizației 10: ' + JSON.stringify(s10))
    const tot = JSON.stringify(r.rows)
    for (const interzis of ['1800101000000', '0700000001', 'ion@exemplu.ro', 'RO00TEST', 'nota interna', '1/a.pdf', 'RO123', 'm@f.ro'])
      if (tot.includes(interzis)) ab.push(`L ${cont}: a ieșit un câmp nepermis (${interzis})`)
  }
  // fără CTC: eroare 42501 (nu listă goală, L18)
  for (const cont of ['HR', 'CTCX', 'STRAIN', 'DOAR_FLAG']) asteptCod(await ca(db, 'authenticated', U[cont], `SELECT * FROM public.fn_ctc_autorizatii_sudori()`), '42501', `L ${cont}`)
  asteptCod(await ca(db, 'authenticated', null, `SELECT * FROM public.fn_ctc_autorizatii_sudori()`), '42501', 'L fără JWT')
  asteptCod(await ca(db, 'anon', null, `SELECT * FROM public.fn_ctc_autorizatii_sudori()`), '42501', 'L anon')
  asteptCod(await ca(db, 'anon', U.CTC, `SELECT * FROM public.fn_ctc_autorizatii_sudori()`), '42501', 'L anon cu JWT-ul CTC')
  // fișierul: doar autorizație de sudor neștearsă, cu scan
  const f = await ca(db, 'authenticated', U.CTC, `SELECT public.fn_ctc_autorizatie_fisier(10) AS c`)
  if (f.code || f.rows[0].c !== '1/a.pdf') ab.push('F CTC autorizația 10: ' + JSON.stringify(f))
  const fe = await ca(db, 'authenticated', U.CTC_SUB, `SELECT public.fn_ctc_autorizatie_fisier(16) AS c`)
  if (fe.code || fe.rows[0].c !== 'extern-1/c.pdf') ab.push('F CTC_SUB autorizația 16 (extern): ' + JSON.stringify(fe))
  const mesaje = new Set()
  for (const [id, ce] of [[14, 'alt tip (ANRE)'], [19, 'alt tip (RSVTI)'], [15, 'ștearsă'], [12, 'fără scan'], [13, 'scan gol'], [999, 'inexistentă']]) {
    const r = await ca(db, 'authenticated', U.CTC, `SELECT public.fn_ctc_autorizatie_fisier(${id}) AS c`)
    asteptCod(r, 'P0002', `F ${ce}`)
    if (r.message) mesaje.add(r.message)
  }
  if (mesaje.size !== 1) ab.push('F refuzurile nu au același mesaj (oracol): ' + [...mesaje].join(' | '))
  for (const cont of ['HR', 'CTCX', 'STRAIN']) asteptCod(await ca(db, 'authenticated', U[cont], `SELECT public.fn_ctc_autorizatie_fisier(10)`), '42501', `F ${cont}`)
  asteptCod(await ca(db, 'anon', null, `SELECT public.fn_ctc_autorizatie_fisier(10)`), '42501', 'F anon')
  // predicatul intern nu e chemabil de clienți
  asteptCod(await ca(db, 'authenticated', U.CTC, `SELECT public.fn_ctc_autorizatii_drept()`), '42501', 'D authenticated cheamă predicatul intern')
  // dreptul retras = refuz imediat
  await db.exec(`DELETE FROM public.user_module_access WHERE profile_id = '${U.CTC}' AND module = 'ctc'`)
  asteptCod(await ca(db, 'authenticated', U.CTC, `SELECT * FROM public.fn_ctc_autorizatii_sudori()`), '42501', 'R CTC după retragere')
  await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.CTC}', 'ctc', 'viewer')`)
  return ab
}

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

console.log('1. aplicarea migrării (baseline pe schema falsă) + verificările')
{
  const db = await bazaNoua()
  const j = await aplicaMig(db, MIG_B)
  ok(j.some(m => /sfarsit la \d+ ms/.test(m)), 'NOTICE-ul de timp')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  let m = null; try { await aplicaMig(db, MIG_B) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  const b2 = await baseline(db)
  ok(JSON.stringify(b2) === JSON.stringify(B0), 'după aplicare, amprenta L15 = baseline-ul (nimic existent schimbat)')
  await db.close()
}

console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', (db) => aplicaMig(db, MIG_B, { marcaj: false }), /garda start invalida/],
  ['fără plafon', (db) => aplicaMig(db, MIG_B, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['baseline necompletat', (db) => aplicaMig(db, MIG_NECOMPLETAT), /baseline L15 necompletat/],
  ['auth.uid() schimbat după baseline', async (db) => {
    await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${U.CTC}'::uuid $$;`)
    return aplicaMig(db, MIG_B)
  }, /starea de acces \(inainte\) difera de baseline-ul L15 revizuit: functie auth\.uid\(\)/],
  ['auth.uid() schimbat între „înainte” și „după”', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── cine vede autorizațiile pentru cartea tehnică',
    `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${U.CTC}'::uuid $$;\n-- ── cine vede autorizațiile pentru cartea tehnică`]])),
    /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: functie auth\.uid\(\)/],
  ['coloană lipsă în sursă', async (db) => { await db.exec('ALTER TABLE public.hr_autorizatii DROP COLUMN inlocuita_de_id;'); return aplicaMig(db, cuBaseline(MIG, await baseline(db))) },
    /coloana hr_autorizatii\.inlocuita_de_id lipseste/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const ramas = (await db.query(`SELECT to_regprocedure('public.fn_ctc_autorizatii_sudori()') IS NULL AS gol`)).rows[0].gol
  ok(re.test(m || '') && ramas, `${nume}: ${m}`)
  await db.close()
}

console.log('3. revenirea')
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  await revino(db)
  const g = (await db.query(`SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fn_ctc_autorizatii_drept', 'fn_ctc_autorizatii_sudori', 'fn_ctc_autorizatie_fisier')) AS gol`)).rows[0].gol
  ok(g, 'revenirea scoate cele trei funcții')
  await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db.close()
}
for (const [nume, pregatire, re] of [
  ['funcție schimbată', `CREATE OR REPLACE FUNCTION public.fn_ctc_autorizatie_fisier(p_id bigint) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 'x'; END $f$;`, /starea nu e cea din 20261222b \(fn_ctc_autorizatie_fisier\)/],
  ['alt obiect depinde de funcție', `CREATE FUNCTION public.zz_foloseste() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT public.fn_ctc_autorizatie_fisier(10) $f$;`, /alte obiecte depind de functia fn_ctc_autorizatie_fisier/],
]) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(pregatire)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(re.test(m || ''), `revenirea refuză (${nume}): ${m}`)
  await db.close()
}

console.log('4. mutanții migrării')
const MUTANTI = [
  ['M1 lista cu toate categoriile', [["   WHERE a.deleted_at IS NULL AND t.categorie = 'sudura';\nEND $f$;", '   WHERE a.deleted_at IS NULL;\nEND $f$;']]],
  ['M2 fișierul fără verificarea tipului', [["   WHERE a.id = p_id AND a.deleted_at IS NULL AND t.categorie = 'sudura';", '   WHERE a.id = p_id AND a.deleted_at IS NULL;']]],
  ['M3 fișierul și pentru autorizații șterse', [["   WHERE a.id = p_id AND a.deleted_at IS NULL AND t.categorie = 'sudura';", "   WHERE a.id = p_id AND t.categorie = 'sudura';"]]],
  ['M4 dreptul și pentru HR', [["(u.module = 'ctc' OR u.module LIKE 'ctc.%')", "(u.module IN ('ctc', 'hr') OR u.module LIKE 'ctc.%')"]]],
  ['M5 prefix fără punct (ctcx)', [["u.module LIKE 'ctc.%'", "u.module LIKE 'ctc%'"]]],
  ['M6 EXECUTE pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_sudori() TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_sudori() TO authenticated, anon;']]],
  ['M7 lista întoarce și calea fișierului', [['calitate_material text, stare text, inlocuita boolean, are_scan boolean)', 'calitate_material text, stare text, inlocuita boolean, are_scan boolean, fisier_path text)'],
    ["(a.inlocuita_de_id IS NOT NULL), (a.fisier_path IS NOT NULL AND a.fisier_path ~ '[^[:space:]]')", "(a.inlocuita_de_id IS NOT NULL), (a.fisier_path IS NOT NULL AND a.fisier_path ~ '[^[:space:]]'), a.fisier_path::text"]]],
  ['M8 fără CTC = listă goală (fail-open)', [["  IF NOT public.fn_ctc_autorizatii_drept() THEN\n    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';\n  END IF;\n  RETURN QUERY",
    '  IF NOT public.fn_ctc_autorizatii_drept() THEN\n    RETURN;\n  END IF;\n  RETURN QUERY']]],
  ['M9 expiră azi = expirată (granița zilei)', [['WHEN a.data_expirare >= v_azi THEN', 'WHEN a.data_expirare > v_azi THEN']]],
  ['M10 predicatul intern chemabil de clienți', [["REVOKE ALL ON FUNCTION public.fn_ctc_autorizatii_drept() FROM PUBLIC, anon, authenticated, service_role;",
    "REVOKE ALL ON FUNCTION public.fn_ctc_autorizatii_drept() FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_drept() TO authenticated;"]]],
  ['M11 lista include autorizațiile șterse', [["   WHERE a.deleted_at IS NULL AND t.categorie = 'sudura';\nEND $f$;", "   WHERE t.categorie = 'sudura';\nEND $f$;"]]],
]
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, aplica(MIG_B, inl))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}
console.log('   mutantul revenirii')
{
  const pregatire = `CREATE OR REPLACE FUNCTION public.fn_ctc_autorizatie_fisier(p_id bigint) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 'x'; END $f$;`
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(pregatire)
  let mOrig = null; try { await revino(db, REV) } catch (e) { mOrig = e.message }
  let mMut = null; try { await revino(db, aplica(REV, [["                      AND md5(replace(p.prosrc, chr(13), '')) = r.amp\n", '']])) } catch (e) { mMut = e.message }
  ok(/starea nu e cea din 20261222b/.test(mOrig || '') && mMut == null, `R1 fără amprenta corpului: originalul refuză (${mOrig}), mutantul trece = verificarea e necesară`)
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
