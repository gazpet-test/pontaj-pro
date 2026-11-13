// Proba LOCALĂ a migrării 20261220a (SMS: numere de serviciu) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Tiparul: scripts/pglite/test_raport_linii_proiect_local.mjs.
// Baza: scheletele supabase/tests/20261130a_sms_mvp_schelet.sql + 20261130b_sms_acces_modul_schelet.sql (roluri Supabase, drepturile implicite
//   periculoase ALL / EXECUTE pentru anon, profiles, user_module_access, employees fictivi 0700…) + 20261130a + 20261130b întregi, prin
//   „runner” (marcajul de livrare). Limită: 20261130c / 30d / 30i nu se aplică aici (cer schema Redări completă); ele NU ating funcțiile
//   înlocuite de 20261220a (crearea lotului intern, lista fixată), iar trimiterea (fn_sms_rezerva) nu se uită la destinatar_tip.
// 1. BASELINE-ul 20261220a calculat pe schema falsă cu scripts/sms_numere_serviciu_amprente.sql (tranzacție READ ONLY), pus în blocul marcat.
// 2. SUITA funcțională T1–T19 pe migrarea reală (owner / utilizator / test / fără nivel / anon / service_role; SET LOCAL ROLE + JWT, ca PostgREST).
// 3. MUTANȚI (migrare stricată intenționat): fiecare TREBUIE să pice la testul lui (L25); amprentele corpurilor se recalculează pe mutant,
//    ca să pice testul de comportament, nu poarta de amprentă.
// 4. SCENARII: refuzurile migrării (baseline, plafon, stare schimbată înainte / strecurată după, reaplicare), aplicare -> revenire ->
//    reaplicare, refuzurile revenirii (mesaje / numere salvate / stare schimbată / fără plafon).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sms_numere_serviciu_local.mjs
// Limită: PGlite nu are concurență reală (FOR SHARE la creare vs dezactivare: verificat doar că se ia, prin xmax), e PG 18 (producția: 17).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const MIG = 'supabase/migrations/20261220a_sms_numere_serviciu.sql'
const REV = 'supabase/revenire/20261220a_sms_numere_serviciu_ROLLBACK.sql'
const SCRIPT = 'scripts/sms_numere_serviciu_amprente.sql'
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const continutBaseline = (t, marcaj) => { const i0 = t.indexOf(marcaj), i = t.indexOf(BL_A, i0) + BL_A.length; return t.slice(i, t.indexOf(BL_B, i)) }
const PLACEHOLDER = continutBaseline(citeste(MIG), '-- >>> BASELINE 20261220a')
const sectiune = (rel) => {
  const t = citeste(rel), i = t.indexOf('WITH RECURSIVE')
  return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length)
}
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 100))
    t = t.split(din).join(in_)
  }
  return t
}
// amprentele corpurilor noi (md5 pe textul dintre AS $fn$ ... $fn$;) — aceleași reguli ca postcondiția migrării și ca revenirea
const corp = (t, start) => { const i = t.indexOf(start); const a = t.indexOf('AS $fn$', i) + 'AS $fn$'.length; return t.slice(a, t.indexOf('$fn$;', a)) }
const AMP_A = (t) => md5(corp(t, 'CREATE FUNCTION public.fn_sms_lot_intern_creeaza('))
const AMP_B = (t) => md5(corp(t, 'CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari('))
const puneAmprente = (t, a, b) => t.replace(/(-- AMPRENTA-START crearea lotului\n\s*)'[^']*'/, `$1'${a}'`).replace(/(-- AMPRENTA-START lista fixata\n\s*)'[^']*'/, `$1'${b}'`)
// r2: cele cinci funcții noi au amprenta completă în blocul „AMPRENTE-NOI 20261220a” (postcondiția migrării = verificarea revenirii)
const NOI = ['fn_sms_numar_serviciu_dezactiveaza', 'fn_sms_numar_serviciu_salveaza', 'fn_sms_numere_serviciu_admin', 'fn_sms_numere_serviciu_lista', 'fn_sms_numere_serviciu_reguli']
const reNou = (n) => new RegExp(`(\\('public\\.${n}\\([^\\n]*?corp_md5=)([0-9a-f]{32})`)
const AMP_NOU = (t, n) => md5(corp(t, `CREATE FUNCTION public.${n}(`))
// pe mutant: amprentele recalculate din corpul mutat, în migrare (sursa) și în revenirea dată (ca să pice testul de comportament, nu poarta)
const recalculeaza = (t) => NOI.reduce((x, n) => x.replace(reNou(n), `$1${AMP_NOU(t, n)}`), puneAmprente(t, AMP_A(t), AMP_B(t)))

async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true); ${mp}\n${text}\nCOMMIT;`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text, o) => caRunner(db, '20261220a_sms_numere_serviciu', text, o)
const revino = (db, text, o) => caRunner(db, '20261220a_sms_numere_serviciu_ROLLBACK', text, o)

const OWNER = '00000000-0000-0000-0000-0000000000a1', UTIL = '00000000-0000-0000-0000-0000000000a2', REDV = '00000000-0000-0000-0000-0000000000a3'
const TEST = '00000000-0000-0000-0000-0000000000a4', FARA = '00000000-0000-0000-0000-0000000000a5'
async function bazaNoua() {
  const db = new PGlite()
  const run = (n, t) => db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${n}:' || txid_current(), true);\n${t}\nCOMMIT;`)
  await db.exec(citeste('supabase/tests/20261130a_sms_mvp_schelet.sql'))
  await run('20261130a_sms_mvp', citeste('supabase/migrations/20261130a_sms_mvp.sql'))
  await db.exec(citeste('supabase/tests/20261130b_sms_acces_modul_schelet.sql'))
  await run('20261130b_sms_acces_modul', citeste('supabase/migrations/20261130b_sms_acces_modul.sql'))
  // nivelurile SMS (date fictive): a2 = utilizator, a4 = test; a3 / a5 fără SMS
  await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${UTIL}', 'sms', 'editor'), ('${TEST}', 'sms', 'viewer');`)
  return db
}
async function baseline(db) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try { return (await db.query(sectiune(SCRIPT))).rows } finally { await db.exec('ROLLBACK') }
}

// apel ca PostgREST: tranzacție, JWT (claim.sub + claims), SET LOCAL ROLE; cine = uid | 'anon' | 'service_role'
async function ca(db, cine, q, params = []) {
  const rol = cine === 'anon' || cine === 'service_role' ? cine : 'authenticated'
  const uid = rol === 'authenticated' ? cine : ''
  await db.exec('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [uid, JSON.stringify({ sub: uid || null, role: rol })])
    await db.exec(`SET LOCAL ROLE ${rol}`)
    const r = await db.query(q, params)
    await db.exec('COMMIT')
    return r.rows
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* */ } throw e }
}
const unu = async (db, cine, q, p) => (await ca(db, cine, q, p))[0]
async function refuz(p, cod, fragment) {
  try { await p } catch (e) {
    if (cod && e.code !== cod) throw new Error(`cod ${e.code} în loc de ${cod}: ${e.message}`)
    if (fragment && !e.message.includes(fragment)) throw new Error(`mesaj fără „${fragment}”: ${e.message}`)
    return e
  }
  throw new Error(`nu a refuzat (așteptat ${cod}${fragment ? ' „' + fragment + '”' : ''})`)
}
const egal = (a, b, ce) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${ce}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`) }
const salveaza = (db, cine, id, den, tel, resp, nota, ver) =>
  unu(db, cine, 'SELECT public.fn_sms_numar_serviciu_salveaza($1, $2, $3, $4, $5, $6) AS r', [id, den, tel, resp, nota, ver]).then(x => x.r)
const dezactiveaza = (db, cine, id, ver) => unu(db, cine, 'SELECT public.fn_sms_numar_serviciu_dezactiveaza($1, $2) AS r', [id, ver]).then(x => x.r)
const lot = (db, cine, { text = 'Test serviciu', dep = null, ang = null, ns = null, preview = true } = {}) =>
  unu(db, cine, `SELECT public.fn_sms_lot_intern_creeaza(p_text => $1, p_departamente => $2::text[], p_angajati => $3::integer[], p_doar_preview => $4,
                 p_numere_serviciu => $5::integer[]) AS r`, [text, dep, ang, preview, ns]).then(x => x.r)
const mesaje = async (db, lotId) => (await db.query(`SELECT telefon, destinatar_tip, destinatar_id FROM public.sms_mesaje WHERE lot_id = $1 ORDER BY telefon`, [lotId])).rows
// r2 (L23): lista pentru „Compune” = UN obiect {total, numere}; verifică aici și coerența (numere.length = total)
const listaNumere = async (db, cine) => {
  const r = (await unu(db, cine, 'SELECT public.fn_sms_numere_serviciu_lista() AS r')).r
  if (!r || !Array.isArray(r.numere) || r.total !== r.numere.length) throw new Error('lista fără forma {total, numere} coerentă: ' + JSON.stringify(r))
  return r.numere
}

// ── suita funcțională: fiecare test aruncă „Tn FAIL: …” la prima abatere ──
async function suita(db) {
  const T = async (id, fn) => { try { await fn() } catch (e) { throw new Error(`${id} FAIL: ${e.message}`) } }
  let s1, s2, s3, lotT5
  await T('T1', async () => {
    const r = await salveaza(db, OWNER, null, '  Gazpet   Redări ', '0700 000 201', 8, ' depozit ', null)
    egal([r.denumire, r.telefon_mascat, r.versiune, r.activ, r.nota, r.responsabil_employee_id], ['Gazpet Redări', '07** *** 201', 1, true, 'depozit', 8], 'creat')
    s1 = r.id
    const x = (await db.query(`SELECT telefon, creat_de::text AS cd, modificat_de, versiune FROM public.sms_numere_serviciu WHERE id = $1`, [s1])).rows[0]
    egal([x.telefon, x.cd, x.modificat_de, x.versiune], ['+40700000201', OWNER, null, 1], 'rândul din BD (telefon normalizat, auditul serverului)')
    await refuz(salveaza(db, OWNER, null, 'Fix', '0210000000', null, null, null), '22023', 'mobil RO valid')
    await refuz(salveaza(db, OWNER, null, 'X', '0700000202', null, null, null), '22023', 'intre 2 si 60')
    await refuz(salveaza(db, OWNER, null, 'Inactiv', '0700000202', 7, null, null), '22023', 'angajat activ')
    await refuz(salveaza(db, OWNER, null, 'Inexistent', '0700000202', 9999, null, null), '22023', 'angajat activ')
    const admin = (await unu(db, OWNER, 'SELECT public.fn_sms_numere_serviciu_admin() AS r')).r
    egal(admin.map(a => [a.denumire, a.telefon_mascat, a.responsabil_nume, a.activ]), [['Gazpet Redări', '07** *** 201', 'TEST ANGAJAT OPT', true]], 'lista owner-ului')
    if (JSON.stringify(admin).includes('+407')) throw new Error('lista owner-ului are telefonul complet')
  })
  await T('T2', async () => {
    for (const cine of [UTIL, TEST, FARA, REDV]) {
      await refuz(salveaza(db, cine, null, 'Alt numar', '0700000203', null, null, null), '42501', 'doar owner')
      await refuz(dezactiveaza(db, cine, s1, 1), '42501', 'doar owner')
      await refuz(unu(db, cine, 'SELECT public.fn_sms_numere_serviciu_admin() AS r'), '42501', 'doar owner')
    }
    egal((await db.query(`SELECT count(*)::int AS n, bool_and(activ) AS a FROM public.sms_numere_serviciu`)).rows[0], { n: 1, a: true }, 'nimic scris de non-owner')
  })
  await T('T3', async () => {
    for (const cine of [OWNER, UTIL, TEST]) {
      const l = await listaNumere(db, cine)
      egal(l, [{ id: s1, optout: false, denumire: 'Gazpet Redări', telefon_mascat: '07** *** 201' }], 'lista pentru ' + cine)
    }
    await refuz(listaNumere(db, FARA), '42501', 'nu ai acces la modulul SMS')
    await refuz(listaNumere(db, REDV), '42501', 'nu ai acces la modulul SMS')
    await refuz(listaNumere(db, 'anon'), '42501')
    // fn_sms_angajati_lista: neschimbată (aceleași coloane, fără numerele de serviciu)
    const a = await ca(db, UTIL, 'SELECT * FROM public.fn_sms_angajati_lista()')
    if (a.some(x => x.nume === 'Gazpet Redări') || Object.keys(a[0]).join() !== 'id,nume,departament,telefon_mascat,optout') throw new Error('fn_sms_angajati_lista s-a schimbat')
  })
  await T('T4', async () => {
    for (const cine of [OWNER, UTIL, TEST, 'anon', 'service_role']) {
      await refuz(ca(db, cine, 'SELECT * FROM public.sms_numere_serviciu'), '42501')
      await refuz(ca(db, cine, `INSERT INTO public.sms_numere_serviciu (denumire, telefon) VALUES ('Direct', '+40700000204')`), '42501')
      await refuz(ca(db, cine, `UPDATE public.sms_numere_serviciu SET activ = false`), '42501')
    }
    await refuz(ca(db, 'anon', `SELECT public.fn_sms_numar_serviciu_salveaza(NULL, 'Anon', '0700000205', NULL, NULL, NULL)`), '42501')
  })
  await T('T5', async () => {
    const p = await lot(db, UTIL, { ang: [1], ns: [s1] })
    egal([p.nr_destinatari, p.numere_serviciu, p.candidati, p.candidati_serviciu, p.excluse_duplicat, p.lot_id], [2, 1, 2, 1, 0, null], 'previzualizarea')
    const c = await lot(db, UTIL, { ang: [1], ns: [s1], preview: false })
    lotT5 = c.lot_id
    egal(await mesaje(db, lotT5), [{ telefon: '+40700000101', destinatar_tip: 'angajat', destinatar_id: '1' },
      { telefon: '+40700000201', destinatar_tip: 'serviciu', destinatar_id: String(s1) }], 'lista fixată în sms_mesaje')
    const f = (await db.query(`SELECT filtru FROM public.sms_loturi WHERE id = $1`, [lotT5])).rows[0].filtru
    egal([f.angajati_selectati, f.numere_serviciu_selectate], [1, 1], 'filtrul lotului')
    const d = (await unu(db, UTIL, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [lotT5])).r
    egal(d.destinatari.map(x => [x.nume, x.destinatar_tip, x.telefon_mascat]).sort(), [['Gazpet Redări', 'serviciu', '07** *** 201'], ['TEST ANGAJAT UNU', 'angajat', '07** *** 101']], 'lista de aprobat')
    if (JSON.stringify(d).includes('TEST ANGAJAT OPT')) throw new Error('lista arată responsabilul în loc de denumire')
    const a = (await unu(db, UTIL, 'SELECT public.fn_sms_lot_aproba($1, $2) AS r', [lotT5, d.versiune])).r
    egal(a.stare, 'aprobat', 'aprobarea')
  })
  await T('T6', async () => {
    s2 = (await salveaza(db, OWNER, null, 'Telefon dublat', '0700000101', null, null, null)).id   // = telefonul angajatului 1
    const p = await lot(db, UTIL, { ang: [1, 2], ns: [s2] })
    egal([p.nr_destinatari, p.candidati, p.excluse_duplicat, p.numere_serviciu], [2, 3, 1, 0], 'deduplicarea (previzualizare)')
    const c = await lot(db, UTIL, { ang: [1, 2], ns: [s2], preview: false })
    egal(await mesaje(db, c.lot_id), [{ telefon: '+40700000101', destinatar_tip: 'angajat', destinatar_id: '1' },
      { telefon: '+40700000102', destinatar_tip: 'angajat', destinatar_id: '2' }], 'un SMS pe telefon, angajatul are prioritate')
    // doar numărul de serviciu (niciun angajat bifat: UI-ul trimite [-1]) — același telefon ca angajatul, dar angajatul nu e în selecție
    const q = await lot(db, UTIL, { ang: [-1], ns: [s2], preview: false })
    egal(await mesaje(db, q.lot_id), [{ telefon: '+40700000101', destinatar_tip: 'serviciu', destinatar_id: String(s2) }], 'doar numărul de serviciu')
  })
  await T('T7', async () => {
    await unu(db, OWNER, `SELECT public.fn_sms_optout_seteaza('0700 000 201', true, 'test') AS r`)
    egal((await listaNumere(db, UTIL)).find(x => x.id === s1).optout, true, 'opt-out în listă')
    const p = await lot(db, UTIL, { ang: [2], ns: [s1] })
    egal([p.nr_destinatari, p.excluse_optout, p.numere_serviciu], [1, 1, 0], 'opt-out exclus')
    await refuz(lot(db, UTIL, { ang: [-1], ns: [s1] }), '22023', 'niciun destinatar cu mobil RO valid')
    await unu(db, OWNER, `SELECT public.fn_sms_optout_seteaza('0700000201', false, NULL) AS r`)
  })
  await T('T8', async () => {
    await refuz(lot(db, TEST, { ang: [1, 2, 3, 4, 8], ns: [s1] }), '42501', 'maximum 5 destinatari')
    await refuz(lot(db, TEST, { ang: [1, 2, 3, 4, 8], ns: [s1], preview: false }), '42501', 'maximum 5 destinatari')
    const p = await lot(db, TEST, { ang: [1, 2, 3, 4], ns: [s1] })
    egal([p.nr_destinatari, p.numere_serviciu], [5, 1], 'testul: 4 angajați + 1 număr = 5')
    const c = await lot(db, TEST, { ang: [2, 3], ns: [s1], preview: false })
    const d = (await unu(db, TEST, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [c.lot_id])).r
    if (!d.destinatari.some(x => x.nume === 'Gazpet Redări' && x.destinatar_tip === 'serviciu')) throw new Error('lotul contului de test fără denumirea numărului')
  })
  await T('T9', async () => {
    await refuz(lot(db, UTIL, { ang: null, ns: [s1] }), '22023', 'selectia manuala')
    await refuz(lot(db, UTIL, { ang: [], ns: [s1] }), '22023', 'selectia manuala')
    await refuz(lot(db, UTIL, { dep: ['TESA'], ang: [3], ns: [s1] }), '22023', 'selectia manuala')
    await refuz(lot(db, UTIL, { dep: ['TESA'], ns: [s1], preview: false }), '22023', 'selectia manuala')
    // „toți” / „pe departament” fără numere: neschimbat (niciun mesaj 'serviciu')
    const t = await lot(db, UTIL, {})
    egal(t.numere_serviciu, 0, 'toți angajații')
    const d = await lot(db, UTIL, { dep: ['TESA'], ns: [] })
    egal(d.numere_serviciu, 0, 'pe departament (listă goală de numere)')
  })
  await T('T10', async () => {
    await refuz(lot(db, UTIL, { ang: [1], ns: [9999] }), '22023', 'nu mai exista sau a fost dezactivat')
    await refuz(unu(db, UTIL, `SELECT public.fn_sms_lot_intern_creeaza(p_text => 'x', p_angajati => ARRAY[1], p_numere_serviciu => ARRAY[NULL]::integer[]) AS r`), '22023', 'nu mai exista')
    s3 = (await salveaza(db, OWNER, null, 'De dezactivat', '0700000203', null, null, null)).id
    const c = await lot(db, UTIL, { ang: [-1], ns: [s3], preview: false })
    const r = await dezactiveaza(db, OWNER, s3, 1)
    egal([r.activ, r.versiune, r.loturi_active], [false, 2, 1], 'dezactivarea (loturile active care îl mai au)')
    await refuz(lot(db, UTIL, { ang: [1], ns: [s3] }), '22023', 'a fost dezactivat')
    egal((await listaNumere(db, UTIL)).map(x => x.id).includes(s3), false, 'dezactivatul nu mai e în listă')
    egal((await mesaje(db, c.lot_id)).length, 1, 'lotul deja creat rămâne neatins')
  })
  await T('T11', async () => {
    const r = await salveaza(db, OWNER, s1, 'Gazpet Redări', '', null, 'nota noua', 1)
    egal([r.versiune, r.telefon_mascat, r.nota, r.responsabil_employee_id], [2, '07** *** 201', 'nota noua', null], 'modificarea (telefonul gol = rămâne)')
    const x = (await db.query(`SELECT modificat_de::text AS md, telefon FROM public.sms_numere_serviciu WHERE id = $1`, [s1])).rows[0]
    egal([x.md, x.telefon], [OWNER, '+40700000201'], 'auditul modificării')
    await refuz(salveaza(db, OWNER, s1, 'Gazpet Redări', '', null, null, 1), '40001', 's-a schimbat')
    await refuz(dezactiveaza(db, OWNER, s1, 1), '40001', 's-a schimbat')
    await refuz(salveaza(db, OWNER, s3, 'De dezactivat', '', null, null, 2), '23514', 'dezactivat')
    await refuz(dezactiveaza(db, OWNER, s3, 2), '23514', 'deja dezactivat')
    await refuz(salveaza(db, OWNER, 9999, 'Nu exista', '0700000206', null, null, 1), 'P0002')
  })
  await T('T12', async () => {
    await refuz(salveaza(db, OWNER, null, 'GAZPET   redări', '0700000207', null, null, null), '23505', 'exista deja')
    await refuz(salveaza(db, OWNER, null, 'Alt nume', '+40 700 000 201', null, null, null), '23505', 'exista deja')
    const r = await salveaza(db, OWNER, null, 'De dezactivat', '0700000203', null, null, null)   // același nume / telefon ca s3 (dezactivat)
    egal(r.activ, true, 'readăugarea după dezactivare')
  })
  await T('T13', async () => {
    await refuz(db.query(`DELETE FROM public.sms_numere_serviciu WHERE id = $1`, [s3]), '42501', 'nu se sterg')
    await refuz(db.query(`UPDATE public.sms_numere_serviciu SET nota = 'x' WHERE id = $1`, [s3]), '23514', 'dezactivat nu se mai modifica')
    await refuz(db.query(`INSERT INTO public.sms_numere_serviciu (denumire, telefon) VALUES ('Direct', '0700000208')`), '23514')
    await refuz(db.query(`UPDATE public.sms_numere_serviciu SET creat_de = NULL WHERE id = $1`, [s1]), '23514', 'nu se schimba')
    await refuz(db.query(`UPDATE public.sms_numere_serviciu SET responsabil_employee_id = 9999 WHERE id = $1`, [s1]), '23503', 'responsabilul')
    const x = (await db.query(`INSERT INTO public.sms_numere_serviciu (denumire, telefon, activ, versiune, creat_de) VALUES ('Direct postgres', '+40700000209', false, 7, '${UTIL}') RETURNING activ, versiune, creat_de`)).rows[0]
    egal([x.activ, x.versiune, x.creat_de], [true, 1, null], 'insertul direct: auditul și versiunea le scrie triggerul')
    await refuz(db.query(`INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id) VALUES ($1, '+40700000210', 'alt_tip', '1')`, [lotT5]), '23514')
  })
  await T('T14', async () => {
    // clientul deja publicat: 4 nume (fără p_numere_serviciu) -> varianta nouă (DEFAULT NULL), un singur candidat
    const r = (await unu(db, UTIL, `SELECT public.fn_sms_lot_intern_creeaza(p_text => 'Vechi', p_departamente => NULL, p_angajati => ARRAY[1, 2], p_doar_preview => true) AS r`)).r
    egal([r.nr_destinatari, r.numere_serviciu], [2, 0], 'apelul vechi cu nume')
    const q = (await unu(db, UTIL, `SELECT public.fn_sms_lot_intern_creeaza('Vechi', NULL, ARRAY[1], true) AS r`)).r
    egal(q.nr_destinatari, 1, 'apelul vechi pozițional')
    egal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'fn_sms_lot_intern_creeaza'`)).rows[0].n, 1, 'o singură variantă')
  })
  await T('T15', async () => {
    const v = (await db.query(`SELECT versiune FROM public.sms_setari`)).rows[0].versiune
    await unu(db, OWNER, 'SELECT public.fn_sms_setari_salveaza(false, 200, 1500, $1) AS r', [v])
    const r = (await unu(db, 'service_role', 'SELECT public.fn_sms_rezerva($1, 10, $2, $3) AS r', [lotT5, 'simulator', UTIL])).r
    egal([r.motiv, r.mesaje.map(m => m.telefon).sort()], ['ok', ['+40700000101', '+40700000201']], 'rezervarea lotului cu număr de serviciu')
    egal((await db.query(`SELECT stare FROM public.sms_mesaje WHERE lot_id = $1 AND destinatar_tip = 'serviciu'`, [lotT5])).rows[0].stare, 'necunoscut', 'mesajul numărului de serviciu rezervat')
  })
  await T('T16', async () => {
    // crearea efectivă ține rândul numărului (FOR SHARE) până la COMMIT: xmax = tranzacția creării
    await db.exec('BEGIN')
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [UTIL])
      await db.exec('SET LOCAL ROLE authenticated')
      await db.query(`SELECT public.fn_sms_lot_intern_creeaza(p_text => 'Lock', p_angajati => ARRAY[3], p_numere_serviciu => ARRAY[${s1}], p_doar_preview => false)`)
      await db.exec('RESET ROLE')
      const r = (await db.query(`SELECT (SELECT xmax::text FROM public.sms_numere_serviciu WHERE id = ${s1}) AS xm, (txid_current() % 4294967296)::text AS tx`)).rows[0]
      if (r.xm !== r.tx) throw new Error(`rândul numărului nu e ținut de creare (xmax ${r.xm}, tranzacția ${r.tx})`)
    } finally { await db.exec('ROLLBACK') }
    // previzualizarea NU ține nimic
    await db.exec('BEGIN')
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [UTIL])
      await db.exec('SET LOCAL ROLE authenticated')
      await db.query(`SELECT public.fn_sms_lot_intern_creeaza(p_text => 'Lock', p_angajati => ARRAY[3], p_numere_serviciu => ARRAY[${s1}], p_doar_preview => true)`)
      await db.exec('RESET ROLE')
      const r = (await db.query(`SELECT (SELECT xmax::text FROM public.sms_numere_serviciu WHERE id = ${s1}) AS xm, (txid_current() % 4294967296)::text AS tx`)).rows[0]
      if (r.xm === r.tx) throw new Error('previzualizarea ține rândul numărului')
    } finally { await db.exec('ROLLBACK') }
  })
  await T('T17', async () => {
    // „Mesajele lotului” după trimitere: tot denumirea (aceeași funcție), și pentru owner
    const d = (await unu(db, OWNER, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [lotT5])).r
    const s = d.destinatari.find(x => x.destinatar_tip === 'serviciu')
    egal([s && s.nume, s && s.stare], ['Gazpet Redări', 'necunoscut'], 'mesajele lotului')
    await refuz(unu(db, FARA, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [lotT5]), '42501')
  })
  await T('T18', async () => {
    // r2 (L03): denumirea e cea FIXATĂ la crearea lotului (filtrul lotului); o redenumire ulterioară nu schimbă istoricul
    const f = (await db.query(`SELECT filtru FROM public.sms_loturi WHERE id = $1`, [lotT5])).rows[0].filtru
    egal(f.numere_serviciu_denumiri, { [String(s1)]: 'Gazpet Redări' }, 'denumirile fixate în filtrul lotului')
    const v = (await db.query(`SELECT versiune FROM public.sms_numere_serviciu WHERE id = $1`, [s1])).rows[0].versiune
    egal((await salveaza(db, OWNER, s1, 'Telefon Redenumit', '', null, null, v)).denumire, 'Telefon Redenumit', 'redenumirea')
    for (const cine of [OWNER, UTIL]) {
      const d = (await unu(db, cine, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [lotT5])).r
      egal(d.destinatari.filter(x => x.destinatar_tip === 'serviciu').map(x => x.nume), ['Gazpet Redări'], 'istoricul după redenumire (' + cine + ')')
    }
    const c = await lot(db, UTIL, { ang: [-1], ns: [s1], preview: false })
    const d = (await unu(db, UTIL, 'SELECT public.fn_sms_lot_destinatari($1) AS r', [c.lot_id])).r
    egal(d.destinatari.map(x => x.nume), ['Telefon Redenumit'], 'un lot nou poartă denumirea de azi')
    // filtrul e imuabil după creare (triggerul 20261130c): denumirea fixată nu se poate rescrie nici direct
    await refuz(db.query(`UPDATE public.sms_loturi SET filtru = filtru || '{"numere_serviciu_denumiri": {}}'::jsonb WHERE id = $1`, [lotT5]))
  })
  await T('T19', async () => {
    // r2 (L23): maximum 100 de numere ACTIVE; lista întreagă vine într-un obiect cu total (fără plafonul de rânduri al PostgREST)
    const activ = (await db.query(`SELECT count(*)::int AS n FROM public.sms_numere_serviciu WHERE activ`)).rows[0].n
    for (let i = activ; i < 100; i++) await salveaza(db, OWNER, null, `Numar test ${i}`, `07000004${String(i).padStart(2, '0')}`, null, null, null)
    const l = await listaNumere(db, UTIL)
    egal(l.length, 100, 'lista: toate cele 100 active, cu total')
    await refuz(salveaza(db, OWNER, null, 'Al 101-lea', '0700000500', null, null, null), '22023', 'maximum 100')
    const ultim = l.find(x => x.denumire === 'Numar test 99')
    await dezactiveaza(db, OWNER, ultim.id, 1)
    egal((await salveaza(db, OWNER, null, 'Dupa dezactivare', '0700000500', null, null, null)).activ, true, 'după o dezactivare se poate adăuga din nou')
  })
}

// ── 0. baseline + amprentele corpurilor (migrarea și revenirea poartă exact md5-ul corpurilor din migrare) ──
const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0)
await BAZA0.close()
for (const e of ['functie fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'functie fn_sms_lot_destinatari(uuid)', 'functie fn_sms_angajati_lista()',
                 'functie fn_sms_mesaje_reguli()', 'functie fn_sms_loturi_reguli()', 'tabel sms_mesaje | triggere', 'tabel sms_loturi | politici',
                 // r2 (P1): poarta owner a administrării și lanțul ei (fn_sms_e_owner -> auth.uid), poarta de nivel și lanțul ei
                 'functie fn_sms_cere_owner()', 'functie fn_sms_e_owner()', 'functie auth.uid()', 'functie fn_sms_cere_nivel()', 'functie fn_sms_nivel_cont(uuid)']) {
  if (!B0.some(r => r.eticheta === e)) { console.error('baseline: lipsește ' + e + ' (am: ' + B0.map(r => r.eticheta).join(', ') + ')'); process.exit(1) }
}
// r2: amprentele complete ale celor cinci funcții noi, în migrare și în revenire = md5 al corpurilor din migrare
for (const n of NOI) {
  const m = AMP_NOU(citeste(MIG), n), dinM = (reNou(n).exec(citeste(MIG)) || [])[2], dinR = (reNou(n).exec(citeste(REV)) || [])[2]
  if (dinM !== m || dinR !== m) { console.error(`amprenta funcției noi ${n}: corp ${m}, migrare ${dinM}, revenire ${dinR}`); process.exit(1) }
}
console.log(`baseline L15 20261220a (schema falsă): ${B0.length} etichete${B0.some(r => r.atentie) ? ' — atenție: ' + B0.filter(r => r.atentie).map(r => r.eticheta + ' [' + r.atentie + ']').join('; ') : ''}`)
const cuBaseline = (randuri) => [PLACEHOLDER, randuri.map(r => r.linie_baseline).join('\n')]
const MIG_T = citeste(MIG), REV_T = citeste(REV)
for (const [et, f] of [['crearea lotului', AMP_A], ['lista fixata', AMP_B]]) {
  const din = (t) => (new RegExp(`-- AMPRENTA-START ${et}\\n\\s*'([0-9a-f]{32})'`).exec(t) || [])[1]
  console.log(`amprenta corpului (${et}): ${f(MIG_T)} (migrarea: ${din(MIG_T)}, revenirea: ${din(REV_T)})`)
  if (din(MIG_T) !== f(MIG_T) || din(REV_T) !== f(MIG_T)) { console.error('amprentele din migrare / revenire nu sunt ale corpurilor din migrare: ' + et); process.exit(1) }
}
const MIG_B = aplica(MIG_T, [cuBaseline(B0)])

let rau = 0
// ── 1. suita pe migrarea reală ──
{
  const db = await bazaNoua()
  const j = await aplicaMig(db, MIG_B)
  const corpuri = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m FROM pg_proc WHERE oid IN ('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])'::regprocedure, 'public.fn_sms_lot_destinatari(uuid)'::regprocedure) ORDER BY proname DESC`)).rows.map(r => r.m)
  egal(corpuri.sort(), [AMP_A(MIG_T), AMP_B(MIG_T)].sort(), 'md5 corpurilor aplicate = amprentele din fișier')
  try { await suita(db); console.log('suita: T1–T19 OK pe migrarea reală · ' + j.filter(m => /^20261220a: (lock-uri|sfarsit)/.test(m)).join(' · ')) }
  catch (e) { console.error('SUITA PICATĂ: ' + e.message); process.exit(1) }
  finally { await db.close() }
}

// ── 2. mutanții: fiecare trebuie să pice la testul lui (sau la postcondiție) ──
const CERE_OWNER_SALV = ["DECLARE r public.sms_numere_serviciu; v_den text; v_tel text; v_nota text;\nBEGIN\n  PERFORM public.fn_sms_cere_owner();",
                         "DECLARE r public.sms_numere_serviciu; v_den text; v_tel text; v_nota text;\nBEGIN\n  PERFORM public.fn_sms_cere_nivel();"]
const mutanti = [
  ['M1 salvarea fără poarta owner (orice nivel SMS)', 'T2', [CERE_OWNER_SALV]],
  ['M2 dezactivarea fără poarta owner', 'T2', [["DECLARE r public.sms_numere_serviciu; v_loturi integer;\nBEGIN\n  PERFORM public.fn_sms_cere_owner();", "DECLARE r public.sms_numere_serviciu; v_loturi integer;\nBEGIN\n  PERFORM public.fn_sms_cere_nivel();"]]],
  ['M3 lista fără poarta de nivel', 'T3', [["DECLARE v jsonb;\nBEGIN\n  PERFORM public.fn_sms_cere_nivel();\n", "DECLARE v jsonb;\nBEGIN\n"]]],
  ['M4 deduplicarea pe (telefon, tip) în loc de telefon', 'T6', [['SELECT DISTINCT ON (b.tel) b.tel, b.tip, b.id', 'SELECT DISTINCT ON (b.tel, b.tip) b.tel, b.tip, b.id'], ['ORDER BY b.tel, (b.tip = \'serviciu\'), b.id', 'ORDER BY b.tel, b.tip, b.id']]],
  ['M5 numărul de serviciu are prioritate la același telefon', 'T6', [["ORDER BY b.tel, (b.tip = 'serviciu'), b.id", "ORDER BY b.tel, (b.tip = 'angajat'), b.id"]]],
  ['M6 opt-out-ul ignorat la numerele de serviciu', 'T7', [["SELECT c.tip, c.id, c.tel, c.den, (c.tel IS NOT NULL AND EXISTS", "SELECT c.tip, c.id, c.tel, c.den, (c.tel IS NOT NULL AND c.tip = 'angajat' AND EXISTS"]]],
  ['M7 limita contului de test numără doar angajații', 'T8', [["  IF v_niv = 'test' AND v_nr > 5 THEN", "  IF v_niv = 'test' AND v_nr - (SELECT count(*) FROM unnest(coalesce(v_tip, '{}'::text[])) k WHERE k = 'serviciu') > 5 THEN"]]],
  ['M8 numerele acceptate și la „toți” / „pe departament”', 'T9', [["    IF coalesce(cardinality(p_angajati), 0) = 0 OR coalesce(cardinality(p_departamente), 0) > 0 THEN\n      RAISE EXCEPTION 'sms: numerele de serviciu se aleg",
                                                                  "    IF false THEN\n      RAISE EXCEPTION 'sms: numerele de serviciu se aleg"]]],
  ['M9 un număr inexistent / dezactivat sărit tacit', 'T10', [['AND s.activ) IS DISTINCT FROM cardinality(v_ns)::bigint THEN', 'AND s.activ) IS NULL THEN']]],
  ['M10 lista fixată fără denumirea numărului', 'T5', [["WHEN 'serviciu' THEN l.filtru -> 'numere_serviciu_denumiri' ->> m.destinatar_id", "WHEN 'serviciu' THEN NULL"]]],
  ['M11 modificarea fără verificarea versiunii (CAS)', 'T11', [["    IF p_versiune IS DISTINCT FROM r.versiune THEN\n      RAISE EXCEPTION 'sms: numarul de serviciu s-a schimbat intre timp; reincarca lista' USING ERRCODE = '40001';\n    END IF;\n  END IF;\n  IF p_id IS NOT NULL AND",
                                                               "  END IF;\n  IF p_id IS NOT NULL AND"]]],
  ['M12 creare fără FOR SHARE pe numerele alese', 'T16', [['      PERFORM 1 FROM public.sms_numere_serviciu s WHERE s.id = ANY (v_ns) ORDER BY s.id FOR SHARE;\n', '']]],
  ['M13 triggerul nu mai scrie auditul (creat_de rămâne NULL / ce trimite clientul)', 'T1', [['    NEW.activ := true; NEW.creat_de := auth.uid(); NEW.creat_la := now();', '    NEW.creat_la := now();']]],
  ['M14 tabelul cu SELECT pentru authenticated', 'post', [['REVOKE ALL ON SEQUENCE public.sms_numere_serviciu_id_seq', 'GRANT SELECT ON public.sms_numere_serviciu TO authenticated;\nREVOKE ALL ON SEQUENCE public.sms_numere_serviciu_id_seq']]],
  ['M15 secvența identității lăsată cu drepturile implicite', 'post', [['REVOKE ALL ON SEQUENCE public.sms_numere_serviciu_id_seq FROM PUBLIC, anon, authenticated, service_role;\n', '']]],
  ['M16 EXECUTE lăsat lui anon pe lista nouă', 'post', [['REVOKE ALL ON FUNCTION public.fn_sms_numere_serviciu_reguli(), public.fn_sms_numere_serviciu_lista(), ', 'REVOKE ALL ON FUNCTION public.fn_sms_numere_serviciu_reguli(), ']]],
  ['M17 varianta veche păstrată (supraîncărcare)', 'post', [['DROP FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean);\n', '']]],
  ['M18 o politică pentru authenticated pe tabelul nou', 'post', [['ALTER TABLE public.sms_numere_serviciu ENABLE ROW LEVEL SECURITY;\n', "ALTER TABLE public.sms_numere_serviciu ENABLE ROW LEVEL SECURITY;\nCREATE POLICY zz ON public.sms_numere_serviciu FOR SELECT TO authenticated USING (true);\n"]]],
  ['M19 lista fixată cu drepturi schimbate', 'post', [['  TO authenticated;\n\n-- ── postcondiții ──', '  TO authenticated;\nGRANT EXECUTE ON FUNCTION public.fn_sms_lot_destinatari(uuid) TO service_role;\n\n-- ── postcondiții ──']]],
  // r2
  ['M20 lista fixată citește denumirea de AZI din tabel (L03)', 'T18', [["l.filtru -> 'numere_serviciu_denumiri' ->> m.destinatar_id", '(SELECT s.denumire FROM public.sms_numere_serviciu s WHERE s.id::text = m.destinatar_id)']]],
  ['M21 crearea nu fixează denumirile în lot', 'T5', [["'numere_serviciu_denumiri', coalesce(v_den, '{}'::jsonb)", "'numere_serviciu_denumiri', '{}'::jsonb"]]],
  ['M22 fără limita de 100 de numere active', 'T19', [['WHERE s.activ) >= 100 THEN', 'WHERE s.activ) >= 100000 THEN']]],
  ['M23 lista cu total greșit (trunchiere nedeclarată)', 'T3', [["SELECT jsonb_build_object('total', count(*),", "SELECT jsonb_build_object('total', count(*) + 1,"]]],
  ['M24 o funcție nouă cu drept în plus (service_role pe administrare)', 'post', [['  TO authenticated;\n\n-- ── postcondiții ──', '  TO authenticated;\nGRANT EXECUTE ON FUNCTION public.fn_sms_numere_serviciu_admin() TO service_role;\n\n-- ── postcondiții ──']]],
  ['M25 o funcție nouă fără STABLE (amprenta completă: volatilitatea)', 'post', [['CREATE FUNCTION public.fn_sms_numere_serviciu_admin() RETURNS jsonb\nLANGUAGE plpgsql STABLE SECURITY DEFINER', 'CREATE FUNCTION public.fn_sms_numere_serviciu_admin() RETURNS jsonb\nLANGUAGE plpgsql VOLATILE SECURITY DEFINER']]],
]
for (const [nume, test, inl] of mutanti) {
  const db = await bazaNoua()
  let picatLa = null, eroare = ''
  try {
    await aplicaMig(db, recalculeaza(aplica(MIG_B, inl)))
    await suita(db)
  } catch (e) {
    eroare = e.message
    picatLa = /20261220a post/.test(e.message) ? 'post' : (/^(T[0-9]+) FAIL/.exec(e.message) || [])[1] || 'altundeva'
  } finally { await db.close() }
  const bine = picatLa === test
  if (!bine) rau++
  console.log(`${bine ? 'prins ' : 'SCĂPAT'} ${nume}: ${picatLa ? 'pică la ' + picatLa : 'suita a trecut'}${bine ? '' : ' (așteptat ' + test + ') — ' + eroare.slice(0, 240)}`)
}

// ── 3. scenarii: fiecare pe o bază nouă; refuzul TREBUIE să vină cu motivul lui ──
async function scenariu(nume, motiv, fn) {
  const db = await bazaNoua()
  let eroare = null
  try { await fn(db) } catch (e) { eroare = e.message; if (motiv === null) console.log(e.stack) } finally { await db.close() }
  const bine = motiv === null ? eroare === null : (eroare !== null && motiv.test(eroare))
  if (!bine) rau++
  console.log(`${bine ? 'OK    ' : 'GREȘIT'} ${nume}: ${eroare === null ? 'trecut' : 'refuz: ' + eroare.slice(0, 220)}`)
}
await scenariu('S1 blocul BASELINE din repo (DE_COMPLETAT) = refuz', /20261220a: baseline L15 necompletat/, async (db) => { await aplicaMig(db, MIG_T) })
await scenariu('S2 baseline fără funcțiile schimbate = refuz', /baseline L15 fara functiile schimbate/, async (db) => {
  await aplicaMig(db, aplica(MIG_T, [cuBaseline(B0.filter(r => r.eticheta !== 'functie fn_sms_lot_destinatari(uuid)'))]))
})
await scenariu('S3 baseline cu o etichetă dublă = refuz', /baseline L15 cu etichete duble/, async (db) => {
  await aplicaMig(db, aplica(MIG_T, [[PLACEHOLDER, B0.map(r => r.linie_baseline).join('\n') + '\n  , ' + B0[0].linie_baseline.trim()]]))
})
await scenariu('S4 fără plafon = refuz', /PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db, MIG_B, { marcajPlafon: false }) })
await scenariu('S5 alt plafon (3000) = refuz', /PLAFON_TRANZACTIE lipsa: 3000\/session/, async (db) => { await aplicaMig(db, MIG_B, { plafon: 3000 }) })
await scenariu('S6 aplicare corectă: NOTICE-urile de timp, nimic pg_temp rămas, reaplicarea refuzată', /obiectele exista deja \(reaplicare\)/, async (db) => {
  const j = await aplicaMig(db, MIG_B)
  if (!j.some(m => /^20261220a: lock-uri la \d+ ms/.test(m)) || !j.some(m => /^20261220a: sfarsit la \d+ ms/.test(m))) throw new Error('lipsesc NOTICE-urile de timp: ' + j.join(' | '))
  const tmp = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'amp\\_%' OR proname LIKE 'sms\\_acl\\_%'`)).rows[0].n
  if (tmp !== 0) throw new Error('funcțiile pg_temp au rămas: ' + tmp)
  await aplicaMig(db, MIG_B)
})
for (const [nume, strica, motiv] of [
  ['S7 o politică în plus pe sms_mesaje', `CREATE POLICY zz_toti ON public.sms_mesaje FOR SELECT TO anon USING (true);`, /\(inainte\) difera.*tabel sms_mesaje \| politici/],
  ['S8 un callee schimbat (normalizarea textului)', `CREATE OR REPLACE FUNCTION public.fn_sms_text_valid(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN p; END $f$;`, /\(inainte\) difera.*functie fn_sms_text_valid\(text\)/],
  ['S9 triggerul de pe sms_loturi oprit', `ALTER TABLE public.sms_loturi DISABLE TRIGGER trg_sms_loturi_reguli;`, /\(inainte\) difera.*tabel sms_loturi \| triggere/],
  ['S10 drept pentru anon pe sms_mesaje', `GRANT SELECT ON public.sms_mesaje TO anon;`, /\(inainte\) difera.*tabel sms_mesaje \| acl/],
  ['S11 lista fixată cu alt corp decât 20261130b', `CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`, /fn_sms_lot_destinatari nu e cea din 20261130b/],
  ['S12 o a doua variantă a creării', `CREATE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT NULL::jsonb $f$;`, /fn_sms_lot_intern_creeaza nu e cea din 20261130b/],
  ['S13 CHECK-ul destinatar_tip deja schimbat', `ALTER TABLE public.sms_mesaje DROP CONSTRAINT sms_mesaje_destinatar_tip_check, ADD CONSTRAINT sms_mesaje_destinatar_tip_check CHECK (destinatar_tip IN ('angajat', 'detinator', 'altceva'));`, /CHECK-ul pe sms_mesaje.destinatar_tip nu e cel din 20261130a/],
]) await scenariu(`${nume} = refuz înainte`, motiv, async (db) => { await db.exec(strica); await aplicaMig(db, MIG_B) })
await scenariu('S14 o politică strecurată DUPĂ schimbare = refuz la „după”', /\(dupa\) difera.*tabel sms_loturi \| politici/, async (db) => {
  await aplicaMig(db, aplica(MIG_B, [['-- L15: aceeași amprentă DUPĂ', 'CREATE POLICY zz_toti ON public.sms_loturi FOR SELECT TO anon USING (true);\n-- L15: aceeași amprentă DUPĂ']]))
})
await scenariu('S15 drepturile implicite deja retrase (ca producția după 20261218c): aplicarea trece, postcondițiile la fel', null, async (db) => {
  await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;`)
  await aplicaMig(db, MIG_B)
})
// revenirea
await scenariu('S16 aplicare → revenire → reaplicare (același baseline); după revenire: corpurile 20261130b, apelul vechi merge', null, async (db) => {
  const pas = async (et, p) => { try { return await p } catch (e) { throw new Error(`[${et}] ${e.message}`) } }
  await pas('aplicare', aplicaMig(db, MIG_B))
  const j = await pas('revenire', revino(db, REV_T))
  if (!j.some(m => /^20261220a revenire: lock-uri la \d+ ms/.test(m)) || !j.some(m => /^20261220a revenire: sfarsit la \d+ ms/.test(m))) throw new Error('revenirea fără NOTICE-urile de timp')
  const r = (await pas('apel vechi', unu(db, UTIL, `SELECT public.fn_sms_lot_intern_creeaza(p_text => 'Dupa revenire', p_departamente => NULL, p_angajati => ARRAY[1], p_doar_preview => true) AS r`))).r
  egal(r.nr_destinatari, 1, 'crearea după revenire')
  const b = await pas('baseline', baseline(db))
  egal(b.map(x => x.linie_baseline), B0.map(x => x.linie_baseline), 'amprenta după revenire = cea dinainte de migrare')
  await pas('reaplicare', aplicaMig(db, MIG_B))
})
await scenariu('S17 revenirea cu numere salvate (fără mesaje) = refuz', /REFUZ: 1 numere de serviciu salvate/, async (db) => {
  await aplicaMig(db, MIG_B)
  await salveaza(db, OWNER, null, 'Gazpet Redări', '0700000201', null, null, null)
  await revino(db, REV_T)
})
await scenariu('S18 revenirea cu mesaje către numere de serviciu = refuz (chiar dacă numărul e dezactivat)', /REFUZ: 1 mesaje catre numere de serviciu/, async (db) => {
  await aplicaMig(db, MIG_B)
  const s = await salveaza(db, OWNER, null, 'Gazpet Redări', '0700000201', null, null, null)
  await lot(db, UTIL, { ang: [-1], ns: [s.id], preview: false })
  await dezactiveaza(db, OWNER, s.id, 1)
  await revino(db, REV_T)
})
await scenariu('S19 revenirea fără plafon = refuz', /revenire: PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db, MIG_B); await revino(db, REV_T, { marcajPlafon: false }) })
await scenariu('S20 revenirea pe o stare schimbată (corpul creării) = refuz', /revenire: starea nu e cea din 20261220a \(pasul 1\)/, async (db) => {
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL, p_doar_preview boolean DEFAULT true, p_numere_serviciu integer[] DEFAULT NULL)
    RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`)
  await revino(db, REV_T)
})
await scenariu('S21 revenirea pe o stare schimbată (EXECUTE dat lui anon) = refuz', /revenire: starea nu e cea din 20261220a/, async (db) => {
  await aplicaMig(db, MIG_B)
  await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_sms_lot_intern_creeaza(text, text[], integer[], boolean, integer[]) TO anon;`)
  await revino(db, REV_T)
})
await scenariu('S22 revenirea fără verificarea mesajelor (mutant) = tot refuz, dar de la CHECK, nu cu motivul ei (dovada că verificarea contează)', /violated by some row|check constraint/, async (db) => {
  await aplicaMig(db, MIG_B)
  const s = await salveaza(db, OWNER, null, 'Gazpet Redări', '0700000201', null, null, null)
  await lot(db, UTIL, { ang: [-1], ns: [s.id], preview: false })
  await revino(db, aplica(REV_T, [["      IF v_n > 0 THEN\n        RAISE EXCEPTION '20261220a revenire: REFUZ: % mesaje", "      IF false THEN\n        RAISE EXCEPTION '20261220a revenire: REFUZ: % mesaje"],
                                  ["      IF v_n > 0 THEN\n        RAISE EXCEPTION '20261220a revenire: REFUZ: % numere", "      IF false THEN\n        RAISE EXCEPTION '20261220a revenire: REFUZ: % numere"]]))
})
await scenariu('S23 revenirea cu un obiect străin care cheamă lista nouă = refuz', /alte obiecte depind/, async (db) => {
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE FUNCTION public.zz_cheama() RETURNS void LANGUAGE plpgsql SET search_path = public AS $f$ BEGIN PERFORM 1 FROM public.fn_sms_numere_serviciu_lista(); END $f$;`)
  await revino(db, REV_T)
})
// ── r2 (P1): poarta owner a administrării și lanțul ei în amprentă (reproducerea din review: baseline -> poartă permisivă -> migrarea trecea) ──
await scenariu('S24 poarta owner (fn_sms_cere_owner) înlocuită cu un corp permisiv DUPĂ baseline = refuz înainte', /\(inainte\) difera.*functie fn_sms_cere_owner\(\)/, async (db) => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_cere_owner() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN; END $f$;`)
  await aplicaMig(db, MIG_B)
})
await scenariu('S25 nivelul 2 al porții owner (fn_sms_e_owner) permisiv DUPĂ baseline = refuz înainte', /\(inainte\) difera.*functie fn_sms_e_owner\(\)/, async (db) => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_e_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
  await aplicaMig(db, MIG_B)
})
await scenariu('S26 baseline din scriptul r1 (fără poarta owner) = refuz: lipsesc funcțiile folosite de corpurile noi', /baseline L15 fara functiile folosite de corpurile noi: functie fn_sms_cere_owner\(\) \(/, async (db) => {
  await aplicaMig(db, aplica(MIG_T, [cuBaseline(B0.filter(r => r.eticheta !== 'functie fn_sms_cere_owner()'))]))
})
await scenariu('S27 baseline fără o verigă a lanțului (fn_sms_nivel_cont, sub poarta de nivel) = refuz: închiderea incompletă', /baseline L15 incomplet.*fn_sms_nivel_cont\(uuid\) \(din fn_sms_cere_nivel\(\)\)/, async (db) => {
  await aplicaMig(db, aplica(MIG_T, [cuBaseline(B0.filter(r => r.eticheta !== 'functie fn_sms_nivel_cont(uuid)'))]))
})
await scenariu('S28 același baseline incomplet + veriga schimbată (permisivă) = tot refuz (nu scapă prin lipsă)', /baseline L15 incomplet.*fn_sms_nivel_cont/, async (db) => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_nivel_cont(p_uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 'owner'::text $f$;`)
  await aplicaMig(db, aplica(MIG_T, [cuBaseline(B0.filter(r => r.eticheta !== 'functie fn_sms_nivel_cont(uuid)'))]))
})
// ── r2 (P2): revenirea cere amprenta completă de la aplicare a celor cinci funcții noi ──
for (const [nume, strica, ce] of [
  ['S29 corpul administrării schimbat (poarta owner scoasă)', `CREATE OR REPLACE FUNCTION public.fn_sms_numere_serviciu_admin() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '[]'::jsonb; END $f$;`, 'fn_sms_numere_serviciu_admin'],
  ['S30 lista cu EXECUTE în plus pentru service_role', `GRANT EXECUTE ON FUNCTION public.fn_sms_numere_serviciu_lista() TO service_role;`, 'fn_sms_numere_serviciu_lista'],
  ['S31 salvarea trecută pe SECURITY INVOKER', `ALTER FUNCTION public.fn_sms_numar_serviciu_salveaza(integer, text, text, integer, text, integer) SECURITY INVOKER;`, 'fn_sms_numar_serviciu_salveaza'],
  ['S32 o a doua variantă a dezactivării', `CREATE FUNCTION public.fn_sms_numar_serviciu_dezactiveaza(p_id integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT NULL::jsonb $f$;`, 'fn_sms_numar_serviciu_dezactiveaza'],
  ['S33 triggerul numerelor cu search_path schimbat', `ALTER FUNCTION public.fn_sms_numere_serviciu_reguli() SET search_path = public;`, 'fn_sms_numere_serviciu_reguli'],
]) await scenariu(`${nume} = revenire refuzată, nimic schimbat`, new RegExp(`functiile noi difera de amprenta de la aplicare \\(pasul 1\\): public\\.${ce}\\(`), async (db) => {
  await aplicaMig(db, MIG_B)
  await db.exec(strica)
  try { await revino(db, REV_T) } finally {
    // nimic schimbat: tabelul și varianta cu 5 parametri sunt încă acolo
    const r = (await db.query(`SELECT to_regclass('public.sms_numere_serviciu') IS NOT NULL AS t, to_regprocedure('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean,integer[])') IS NOT NULL AS f`)).rows[0]
    if (!r.t || !r.f) throw new Error('revenirea refuzată a schimbat ceva')
  }
})
await scenariu('S34 revenirea FĂRĂ blocul de amprente (mutant) pe corpul schimbat = ar fi trecut (dovada că blocul contează)', null, async (db) => {
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_numere_serviciu_admin() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '[]'::jsonb; END $f$;`)
  await revino(db, aplica(REV_T, [["    IF v_dif IS NOT NULL THEN\n      RAISE EXCEPTION '20261220a revenire: functiile noi", "    IF false THEN\n      RAISE EXCEPTION '20261220a revenire: functiile noi"]]))
})
if (rau) { console.error(`${rau} mutanți / scenarii greșite`); process.exit(1) }
console.log('mutanți: toți prinși la testul lor; scenariile: toate cu motivul lor')
