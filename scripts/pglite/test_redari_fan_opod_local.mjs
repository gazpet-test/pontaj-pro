// Proba LOCALĂ a migrării 20261227a (Redări FAN: oPOD ca alegere a owner-ului pe lot, implicit oprită) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() EXACT din 20261126a + migrarea 20261212a aplicată ca
//   runnerul (tiparul test_redari_fan_awb_local.mjs), apoi 20261227a în forma livrării L15 v2 (manifestul generat cu ROLLBACK → livrarea aprobată
//   cu garda finală reală). Lista obiectelor din manifest = supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv (`--scrie-obiecte` o regenerează).
// 0. Amprentele (corpul vechi al gărzii din 20261212a, corpul nou, RPC-ul nou) = constantele din migrare / revenire; revenirea repune corpul EXACT;
//    validatorul real al runnerului (5000 acceptat, 2000 / fără plafon refuzate; revenirea cu 2000).
// 1. Comportamentul, ca rolul authenticated cu JWT-ul fiecărui cont (valorile așteptate scrise de mână, L25): coloana implicit false pe rândurile
//    existente; doar owner-ul alege (editor / viewer / anonim refuzați); doar pe lot marcat; NULL refuzat; repetarea = no-op fără jurnal; fiecare
//    schimbare = un rând în red_jurnal (vechi → nou, autorul, momentul); după PRIMA aprobare refuz prin RPC (și după re-propunere) ȘI prin trigger pe
//    calea directă (proprietarul tabelului); UPDATE direct ca authenticated refuzat; marcajul TEST / real păzit la fel ca înainte.
// 2. Refuzurile migrării (marcaj, plafon, amprenta globală lipsă, baza fără 20261212a, garda schimbată înainte, reaplicare, istoric existent,
//    funcție în plus, lock ocupat) — nimic schimbat.
// 3. Revenirea: refuz fără migrare / cu oPOD cerut / cu istoric în jurnal / funcție în plus / fără marcaj / plafon greșit; aplicare → revenire →
//    re-aplicare pe o bază NEFOLOSITĂ (pe una folosită, refuz la fiecare pas).
// 4. MUTANȚI ai migrării (cu amprentele proprii recalculate, ca autoverificarea să nu-i prindă singură): fiecare TREBUIE să pice în verificări.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_fan_opod_local.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(join(resolve(process.env.PGLITE_DIR), 'dist', 'index.js')).href
  : existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const TMP = mkdtempSync(join(tmpdir(), 'fan_opod_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20261227a_redari_fan_opod.sql', F_REV = 'supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql'
const F_OBIECTE = 'supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv'
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const M12 = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const OBIECTE = existsSync(join(ROOT, F_OBIECTE)) ? citeste(F_OBIECTE) : ''
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  if (i < 0 || j < 5) throw new Error('nu găsesc fn_red_nivel în 20261126a')
  return M26.slice(i, j) + '\nREVOKE EXECUTE ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;\n'
    + 'GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n'
})()
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
const validator = (fisier, ...opt) => {
  try {
    return { ok: true, out: execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) } }
}
/** corpul (prosrc) unei funcții din textul unei migrări: ce e între $tag$ … $tag$ după `cap` */
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}

let esec = 0
const ok = (c, m) => { if (c) console.log('  OK  ' + m); else { esec++; console.log('  NU  ' + m) } }

console.log('0. amprentele + validatorul runnerului pe fișierele exacte')
const GARDA_VECHE = md5(corp(M12, 'CREATE FUNCTION public.fn_red_fan_loturi_garda()'))
const GARDA_NOUA = md5(corp(MIG, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()'))
const OPOD_RPC = md5(corp(MIG, 'CREATE FUNCTION public.fn_red_fan_lot_opod('))
const blocGarda = t => t.slice(t.indexOf('-- >>> GARDA 20261227a'), t.indexOf('-- <<< GARDA 20261227a'))
ok(GARDA_VECHE === '1931e70c3b15a07a6ee485537f27ce93' && blocGarda(MIG).includes(`'${GARDA_VECHE}'`) && REV.includes(`'${GARDA_VECHE}'`), `garda din 20261212a: ${GARDA_VECHE} (în migrare, „inainte”, și în postcondiția revenirii)`)
ok(blocGarda(MIG).includes(`'${GARDA_NOUA}'`) && blocGarda(REV).includes(`'${GARDA_NOUA}'`), `garda nouă: ${GARDA_NOUA} (migrare „dupa” + revenire)`)
ok(REV.includes(`'${OPOD_RPC}'`), `fn_red_fan_lot_opod: ${OPOD_RPC} (revenirea cere exact corpul livrat)`)
ok(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()') === corp(M12, 'CREATE FUNCTION public.fn_red_fan_loturi_garda()'), 'revenirea repune corpul EXACT al gărzii din 20261212a')
for (const dep of [['fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69'], ['fn_red_fan_lot_marcheaza(', '7ea87499188a0c7d6a7189b017fa4805'], ['fn_red_fan_aproba(', 'e584116e292d5a307041225b2ff27fbc'],
  ['fn_red_fan_claim_lot(', '2e10d8103f144fee46ceae430eff8f6f'], ['fn_red_fan_propune(', 'fa0e624dfc9d6a354914ce1da1784b64']]) {
  const m = md5(corp(M12, 'CREATE FUNCTION public.' + dep[0]))
  ok(m === dep[1] && MIG.includes(`'${m}'`), `dependența ${dep[0]} din 20261212a: ${m} = constanta din migrare`)
}
{
  const fm = join(ROOT, F_MIG), fr = join(ROOT, F_REV)
  ok(PLAFON_LIVRARE === 5000 && MIG.includes(`IS DISTINCT FROM '${PLAFON_LIVRARE}/session'`), `migrarea cere exact plafonul runnerului L15 v2 (${PLAFON_LIVRARE})`)
  const a = validator(fm, '--plafon-tranzactie-ms', '5000'), b = validator(fm, '--plafon-tranzactie-ms', '2000'), c = validator(fm, '--fara-plafon')
  ok(a.ok && /^OK \d+ /.test(a.out), 'migrarea trece validatorul cu 5000: ' + a.out)
  ok(!b.ok && /PLAFON_DIFERIT: fișierul cere 5000 ms/.test(b.out), 'migrarea cu runnerul la 2000 = refuz: ' + b.out.slice(0, 110))
  ok(!c.ok && /PLAFON_LIPSA/.test(c.out), 'migrarea fără plafon = refuz local: ' + c.out.slice(0, 110))
  const d = validator(fr, '--plafon-tranzactie-ms', '2000'), e = validator(fr, '--plafon-tranzactie-ms', '5000')
  ok(d.ok && /^OK \d+ /.test(d.out), 'revenirea trece validatorul cu plafonul ei (2000): ' + d.out)
  ok(!e.ok && /PLAFON_DIFERIT: fișierul cere 2000 ms/.test(e.out), 'revenirea cu 5000 = refuz: ' + e.out.slice(0, 110))
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002',
  viewer: '00000000-0000-4000-8000-000000000003', strain: '00000000-0000-4000-8000-000000000004', admin: '00000000-0000-4000-8000-000000000005',
  proiect: '10000000-0000-4000-8000-000000000001', lot1: '20000000-0000-4000-8000-000000000001', lot2: '20000000-0000-4000-8000-000000000002',
  lot3: '20000000-0000-4000-8000-000000000003',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const H = c => c.repeat(64)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false),
    ('${ID.admin}', 'A', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer'), ('${ID.admin}', 'redari', 'admin');
  INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT');
  INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.lot1}', '${ID.proiect}', 'PP-0001'), ('${ID.lot2}', '${ID.proiect}', 'PP-0002'), ('${ID.lot3}', '${ID.proiect}', 'PP-0003');
  INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
    ('${plicId(1)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0001', 'PERSOANA UNU', 'activ'), ('${plicId(2)}', '${ID.proiect}', '${ID.lot1}', 'PL-TST-0002', 'PERSOANA DOI', 'activ'),
    ('${plicId(4)}', '${ID.proiect}', '${ID.lot2}', 'PL-TST-0004', 'PERSOANA PATRU', 'activ');
  INSERT INTO public.red_detinatori (id, nume) VALUES ('${detId(1)}', 'D1'), ('${detId(2)}', 'D2'), ('${detId(4)}', 'D4');
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal) VALUES
    ('${detId(1)}', '0700000001', 'Str. Fictivă nr. 1', 'Sat', 'Comuna', 'Prahova', '100000'), ('${detId(2)}', '0700000002', 'Str. Doi', NULL, 'Comuna Doi', 'Prahova', NULL),
    ('${detId(4)}', '0700000004', 'Str. Patru', 'Sat Patru', NULL, 'Dâmbovița', '');
  INSERT INTO public.red_convocari (detinator_id, plic_id, stare, sters_la) VALUES ('${detId(1)}', '${plicId(1)}', 'activ', NULL), ('${detId(2)}', '${plicId(2)}', 'activ', NULL), ('${detId(4)}', '${plicId(4)}', 'activ', NULL);`

// ca runnerul: plafon + marcaje + (opțional) pașii L15 v2 generați. l15: 'livrare' (înainte + după cu manifest), 'inainte', 'nimic'.
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const T = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', T, aprobat)
  const dupa = l15 === 'livrare' ? gen('dupa', T, aprobat, manifest) : ''
  const jurnal = []
  try {
    await db.exec(pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n' + dupa, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplica12 = db => caRunner(db, '20261212a_redari_fan_awb', M12)
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261227a_redari_fan_opod', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261227a_redari_fan_opod_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
// amprenta proprie a gărzii din migrare recalculată pe textul (mutat) — ca un mutant al gărzii să nu fie prins doar de autoverificarea „dupa”
const recalculeaza = t => {
  const m = md5(corp(t, 'CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda()'))
  const a = t.indexOf('-- >>> GARDA 20261227a'), b = t.indexOf('-- <<< GARDA 20261227a')
  return t.slice(0, a) + t.slice(a, b).replace(GARDA_NOUA, m) + t.slice(b)
}
// baza: schelet + fn_red_nivel + date + 20261212a aplicată; lotul 2 marcat TEST ÎNAINTE de 20261227a (rând existent → opod implicit false)
async function bazaNoua({ cu12 = true, marcaj = true } = {}) {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(NIVEL)
  await db.exec(DATE)
  if (cu12) await aplica12(db)
  if (cu12 && marcaj) await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot2}', true); SELECT public.fn_red_fan_lot_marcheaza('${ID.lot1}', false);`)
  return db
}
// apel ca rolul authenticated cu JWT-ul contului (uid null = anonim → rolul anon)
async function ca(db, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);`)
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}
const cod = async p => { try { await p; return 'OK' } catch (e) { return e.code || String(e.message).slice(0, 60) } }
const val = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const jurnalOpod = async db => (await db.query(`SELECT inregistrare_id, date_vechi, date_noi, user_id, actiune FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' = 'opod_schimbat' ORDER BY id`)).rows

// fail: lista verificărilor picate (dată din afară, ca un mutant oprit de o excepție să-și păstreze verificările picate dinaintea ei)
async function verificari(db, log, fail = []) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const opod = (uid, lot, v) => ca(db, uid, 'SELECT public.fn_red_fan_lot_opod($1, $2) AS o', [lot, v])
  const rand = async lot => val(db, 'SELECT opod, test, prima_aprobare_la FROM public.red_fan_loturi WHERE lot_id = $1', [lot])
  // ── coloana: implicit false pe rândurile existente (marcate înainte de migrare) ──
  ok((await rand(ID.lot2)).opod === false && (await rand(ID.lot1)).opod === false, 'rândurile marcate ÎNAINTE de migrare au opod = false (fără oPOD = decizia din 09.11)')
  ok((await val(db, 'SELECT count(*)::int AS n FROM public.red_fan_loturi WHERE opod IS DISTINCT FROM false')).n === 0, 'niciun lot cu oPOD cerut după aplicare')
  // ── poarta de rol + parametri ──
  ok(await cod(opod(ID.editor, ID.lot2, true)) === '42501', 'editor: alegerea oPOD refuzată (doar owner)')
  ok(await cod(opod(ID.admin, ID.lot2, true)) === '42501', 'admin Redări (ne-owner): refuzat')
  ok(await cod(opod(ID.viewer, ID.lot2, true)) === '42501' && await cod(opod(ID.strain, ID.lot2, true)) === '42501', 'viewer / cont fără drept: refuzați')
  // anonimul e refuzat ÎNAINTE de corp (fără EXECUTE: „permission denied for function”), nu de poarta owner din corp (discriminatorul mutantului cu GRANT anon)
  const anon = await eroare(opod(null, ID.lot2, true))
  ok(/permission denied for function fn_red_fan_lot_opod/.test(anon || ''), 'anonim: refuzat fără EXECUTE (înaintea corpului): ' + (anon || 'A TRECUT'))
  ok(await cod(opod(ID.owner, ID.lot2, null)) === '22023' && await cod(opod(ID.owner, null, true)) === '22023', 'NULL → 22023 (nu „fără oPOD”)')
  ok(await cod(opod(ID.owner, '20000000-0000-4000-8000-000000000099', true)) === 'P0002', 'lot inexistent → P0002')
  ok(await cod(opod(ID.owner, ID.lot3, true)) === 'P0001', 'lot NEmarcat (fără rând FAN) → P0001: marcajul TEST / real vine întâi')
  ok((await jurnalOpod(db)).length === 0 && (await rand(ID.lot2)).opod === false, 'după refuzuri: nimic schimbat, nimic în jurnal')
  // ── calea legitimă (owner, înainte de aprobare): true, no-op, false, true; jurnalul ──
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true && (await rand(ID.lot2)).opod === true, 'owner: oPOD cerut pe lotul 2 (TEST, neaprobat)')
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true && (await jurnalOpod(db)).length === 1, 'repetarea aceleiași valori = no-op, fără rând nou în jurnal')
  ok((await opod(ID.owner, ID.lot2, false)).rows[0].o === false && (await rand(ID.lot2)).opod === false, 'owner: renunțare la oPOD')
  ok((await opod(ID.owner, ID.lot2, true)).rows[0].o === true, 'owner: oPOD cerut din nou')
  const j = await jurnalOpod(db)
  ok(j.length === 3 && j.every(x => x.inregistrare_id === ID.lot2 && x.user_id === ID.owner && x.actiune === 'update' && typeof x.date_noi.la === 'string')
    && JSON.stringify(j.map(x => [x.date_vechi.opod, x.date_noi.opod])) === '[[false,true],[true,false],[false,true]]',
    'red_jurnal: fiecare schimbare (vechi → nou), lotul, autorul = auth.uid(), momentul; no-op-urile și refuzurile fără rânduri: ' + JSON.stringify(j.map(x => [x.date_vechi.opod, x.date_noi.opod])))
  ok((await rand(ID.lot2)).test === true && (await rand(ID.lot2)).prima_aprobare_la === null, 'marcajul și prima aprobare neatinse de alegerea oPOD')
  // ── calea directă: fără drept pentru authenticated; marcajul TEST / real păzit ca înainte ──
  ok(await cod(ca(db, ID.owner, `UPDATE public.red_fan_loturi SET opod = false WHERE lot_id = '${ID.lot2}'`)) === '42501', 'owner, UPDATE direct ca authenticated: refuzat (doar prin RPC)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, $2)', [ID.lot2, false])) === 'OK' && await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, $2)', [ID.lot2, true])) === 'OK',
    'marcajul TEST / real se schimbă încă (înainte de aprobare), independent de oPOD')
  // ── după PRIMA aprobare: imuabil prin RPC și prin trigger (orice cale), și după re-propunere ──
  const propune = (uid, n, h) => ca(db, uid, 'SELECT public.fn_red_fan_propune($1, $2, NULL) AS id', [plicId(n), h])
  const r4 = (await propune(ID.editor, 4, H('a'))).rows[0].id
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'OK' && (await rand(ID.lot2)).opod === false, 'cu un plic DOAR propus (neaprobat) alegerea încă se schimbă (false)')
  ok(await cod(opod(ID.owner, ID.lot2, true)) === 'OK', '… și înapoi (true) — hash-urile propuse cu altă alegere se re-propun în ecran')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_aproba($1, $2, $3)', [ID.lot2, [r4], [H('a')]])) === 'OK' && (await rand(ID.lot2)).prima_aprobare_la !== null, 'owner: lotul 2 aprobat (prima aprobare consemnată)')
  const nJ = (await jurnalOpod(db)).length
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'P0001' && (await rand(ID.lot2)).opod === true, 'DUPĂ prima aprobare: schimbarea oPOD refuzată prin RPC (P0001), valoarea rămâne cea aprobată')
  ok(await cod(opod(ID.owner, ID.lot2, true)) === 'OK' && (await jurnalOpod(db)).length === nJ, 'aceeași valoare după aprobare = no-op (nimic în jurnal)')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET opod = false WHERE lot_id = $1`, [ID.lot2])) === '42501', 'calea directă (proprietarul tabelului): trigger-ul refuză schimbarea oPOD după prima aprobare')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET test = false WHERE lot_id = $1`, [ID.lot2])) === '42501', 'trigger-ul păzește încă marcajul TEST / real')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET marcat_la = now() WHERE lot_id = $1`, [ID.lot1])) === 'OK', 'lotul 1 (neaprobat): rândul se mai poate scrie (calea legitimă a gărzii, L20)')
  ok(await cod(db.query(`DELETE FROM public.red_fan_loturi WHERE lot_id = $1`, [ID.lot2])) === '42501', 'marcajul nu se șterge (trigger, neschimbat)')
  // re-propunerea readuce rândul la „propus”, dar prima aprobare e istorică → tot refuz
  ok(await cod(propune(ID.editor, 4, H('a'))) === 'OK' && (await val(db, 'SELECT stare FROM public.red_fan_awb WHERE id = $1', [r4])).stare === 'propus', 're-propunere: rândul redevine propus')
  ok(await cod(opod(ID.owner, ID.lot2, false)) === 'P0001', 'după re-propunere: alegerea oPOD rămâne blocată (prima aprobare e istorică)')
  // lotul 1 (REAL, neaprobat): oPOD se poate cere și pe un lot real
  ok(await cod(opod(ID.owner, ID.lot1, true)) === 'OK' && (await rand(ID.lot1)).opod === true, 'lot real neaprobat: oPOD cerut (alegerea e a owner-ului, nu a marcajului)')
  ok(await cod(opod(ID.owner, ID.lot1, false)) === 'OK', 'lot real: renunțare (înapoi la implicit)')
  // tirajul și restul coloanelor nu sunt în gardă (ca înainte): un UPDATE pe tiraj_* după aprobare trece prin CHECK-urile lui, nu prin gardă
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET tiraj_cheie = $2, tiraj_nr = 1, tiraj_la = now(), tiraj_de = $3 WHERE lot_id = $1`, [ID.lot2, H('1'), ID.owner])) === 'OK', 'tirajul nu e acoperit de gardă (neschimbat față de 20261212a)')
  return fail
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) din fișierul revizuit = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (peste 20261212a; L15 v2: manifest generat, apoi livrarea aprobată) + comportamentul')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G0 = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    '# 20261227a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G0 && gener.length >= 3 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  console.log('     obiecte: ' + gener.map(x => x.split('\t').slice(1).join(' ')).join(' | '))
  const fManifest = join(TMP, '20261227a_redari_fan_opod.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G0, manifest: fManifest, final: garda('20261227a_redari_fan_opod', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /sfarsit la \d+ ms de la BEGIN; lock-uri puternice tinute de \d+ ms/.test(m)),
    'livrarea aprobată: diferența = manifestul; ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  ok(j.some(m => /^PLAFON_TIMP 20261227a_redari_fan_opod: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m)) && j.some(m => /^LOCK_TINUT 20261227a_redari_fan_opod: /.test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT')
  esec += (await verificari(db, true)).length
  let m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = await eroare(revino(db))
  ok(/loturi cu oPOD cerut|istoric opod_schimbat/.test(m || ''), 'revenirea refuză pe baza folosită (oPOD cerut pe un lot aprobat / istoric în jurnal): ' + m)
  ok((await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e === true, 'după refuz, funcția există încă (tranzacția s-a anulat)')
  // revenirea lui 20261212a e blocată cât 20261227a e aplicată (20 de funcții, nu 19)
  const REV12 = citeste('supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql')
  m = await eroare(caRunner(db, '20261212a_redari_fan_awb_ROLLBACK', REV12, { l15: 'nimic', plafon: 2000 }))
  ok(/functii: .*fn_red_fan_lot_opod/.test(m || ''), 'revenirea lui 20261212a refuză cât 20261227a e aplicată (funcția în plus): ' + (m || '').slice(0, 120))
  await db.close()
}

console.log('2. refuzurile migrării (nimic schimbat)')
const LOCK_EXIT = '      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
for (const [nume, fn, re, baza] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000)', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session marcaj 2000:\d+ \(cerut 5000\/session/],
  ['fără amprenta globală L15 v2', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['baza fără 20261212a', db => aplicaMig(db), /tabelele din 20261212a/, { cu12: false }],
  ['garda schimbată înainte (alt corp)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_fan_loturi_garda\(\)/],
  ['aprobarea schimbată înainte (dependență)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 0; END $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_fan_aproba/],
  ['poarta de drept schimbată (fn_red_nivel)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 'admin'::text $f$;`)
    return aplicaMig(db)
  }, /difera de amprentele revizuite: public\.fn_red_nivel\(\)/],
  ['o funcție fn_red_fan_* în plus (baza nu e 20261212a)', async db => { await db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`); return aplicaMig(db) }, /difera de 19/],
  ['istoric opod_schimbat deja în jurnal', async db => {
    await db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_loturi', '${ID.lot2}', 'update', '{"eveniment":"opod_schimbat","opod":true}');`)
    return aplicaMig(db)
  }, /are deja evenimente opod_schimbat/],
  ['coloana prima_aprobare_la lipsă', async db => { await db.exec('ALTER TABLE public.red_fan_loturi DROP COLUMN prima_aprobare_la'); return aplicaMig(db) }, /red_fan_loturi\.prima_aprobare_la lipseste/],
  ['lock ocupat permanent', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n" + LOCK_EXIT]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
  ['lock obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [[LOCK_EXIT, '      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])),
    /BUGET_LOCK: lock-ul obtinut abia la \d+ ms de la prima incercare \(1 incercari/],
]) {
  const db = await bazaNoua(baza || {})
  const m = await eroare(fn(db))
  const gol = (await val(db, `SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'red_fan_loturi' AND column_name = 'opod')
    AND to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NULL AS g`)).g
  ok(m && re.test(m) && gol, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('3. revenirea (prin runner, plafonul 2000, fără amprentă globală)')
const aplicatCurat = async () => { const db = await bazaNoua(); await aplicaMig(db); return db }
const cere = (db, lot, v) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_lot_opod('${lot}', ${v});`)
for (const [nume, pregateste, re, baza] of [
  ['migrarea neaplicată', async () => {}, /starea nu e cea din 20261227a \(pasul 1, coloana opod\)/, { marcaj: true, fara27: true }],
  ['un lot cu oPOD cerut', db => cere(db, ID.lot2, true), /loturi cu oPOD cerut/],
  ['istoric în jurnal (cerut, apoi renunțat)', async db => { await cere(db, ID.lot2, true); await cere(db, ID.lot2, false) }, /istoric opod_schimbat/],
  ['o funcție fn_red_fan_* în plus', db => db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`), /numarul functiilor fn_red_fan_\* difera de 20/],
  ['garda schimbată după aplicare', db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`),
    /starea nu e cea din 20261227a \(pasul 1, functii: public\.fn_red_fan_loturi_garda\(\)\)/],
  ['o vedere peste coloana opod', db => db.exec(`CREATE VIEW public.v_fan_opod AS SELECT lot_id, opod FROM public.red_fan_loturi;`), /alte obiecte depind/],
]) {
  const db = baza?.fara27 ? await bazaNoua() : await aplicatCurat()
  await pregateste(db)
  const m = await eroare(revino(db))
  const neschimbat = baza?.fara27 ? (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NULL AS e`)).e
    : (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e
  ok(m && re.test(m) && neschimbat, `revenirea refuză: ${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}
for (const [nume, o, re] of [['fără marcajul runnerului', { marcaj: false }, /garda invalida/], ['plafonul livrărilor (5000)', { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000/]]) {
  const db = await aplicatCurat()
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && (await val(db, `SELECT to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL AS e`)).e, `revenirea refuză (runner): ${nume}: ${m}`)
  await db.close()
}
{
  const db = await aplicatCurat()
  const j = await revino(db)
  ok(j.some(m => /revenire: sfarsit la \d+ ms/.test(m)), 'revenirea pe aplicarea curată (nefolosită) trece')
  const dupa = await val(db, `SELECT (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'fn_red_fan_%') AS n,
    (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_fan_loturi_garda()')) AS g,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'red_fan_loturi' AND column_name = 'opod') AS col`)
  ok(dupa.n === 19 && dupa.g === GARDA_VECHE && dupa.col === false, 'după revenire: 19 funcții, garda cu corpul 20261212a, coloana scoasă')
  ok(await cod(db.query(`UPDATE public.red_fan_loturi SET test = false WHERE lot_id = $1`, [ID.lot2])) === 'OK' && await cod(db.query(`UPDATE public.red_fan_loturi SET test = true WHERE lot_id = $1`, [ID.lot2])) === 'OK',
    'după revenire, lotul neaprobat se poate marca din nou pe calea directă a proprietarului (garda veche; readus la TEST)')
  const m = await eroare(aplicaMig(db))
  ok(m === null, 're-aplicarea după revenire trece' + (m ? ': ' + m : ''))
  const f = await verificari(db, false)
  ok(f.length === 0, `comportamentul identic după re-aplicare (${f.length} abateri${f[0] ? ': ' + f[0] : ''})`)
  await db.close()
}

console.log('4. mutanți (amprentele proprii recalculate; fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['garda nu păzește oPOD după aprobare', 'OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test OR NEW.opod IS DISTINCT FROM OLD.opod\n', 'OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test\n'],
  ['RPC-ul nu verifică prima aprobare', "  IF v_fl.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN\n    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; alegerea oPOD", "  IF false THEN\n    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; alegerea oPOD"],
  ['RPC-ul verifică doar stările curente (nu istoricul)', '  IF v_fl.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id', '  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id'],
  ['RPC-ul deschis oricui autentificat', "IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul alege oPOD'", "IF auth.uid() IS NULL THEN RAISE EXCEPTION 'redari fan: doar owner-ul alege oPOD'"],
  ['RPC-ul fără jurnal', "  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)\n  VALUES ('red_fan_loturi', p_lot_id, 'update', jsonb_build_object('opod', v_fl.opod),", "  PERFORM * FROM (\n  VALUES ('red_fan_loturi', p_lot_id, 'update', jsonb_build_object('opod', v_fl.opod),",
    "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid());", "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid())) x;"],
  ['jurnalul fără autor', "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid());", "jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), NULL);"],
  ['repetarea scrie în jurnal (fără no-op)', '  IF v_fl.opod = p_opod THEN RETURN p_opod; END IF;', '  IF false THEN RETURN p_opod; END IF;'],
  ['RPC-ul nu cere lotul marcat', "  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real (lot FAN nemarcat)' USING ERRCODE = 'P0001'; END IF;", '  IF v_fl.lot_id IS NULL THEN RETURN p_opod; END IF;'],
  ['EXECUTE și pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) TO authenticated, anon;'],
  ['UPDATE direct permis', 'COMMENT ON COLUMN public.red_fan_loturi.opod IS', 'GRANT UPDATE (opod) ON public.red_fan_loturi TO authenticated;\nCOMMENT ON COLUMN public.red_fan_loturi.opod IS'],
  ['implicit PORNIT (oPOD pe toate loturile)', 'ALTER TABLE public.red_fan_loturi ADD COLUMN opod boolean NOT NULL DEFAULT false;', 'ALTER TABLE public.red_fan_loturi ADD COLUMN opod boolean NOT NULL DEFAULT true;'],
]
// mutanții trebuie prinși de VERIFICĂRI (comportament), nu doar de postcondițiile proprii ale migrării: postcondițiile se scot din textul mutat
const faraPost = t => { const a = t.indexOf('-- ── postcondiții ──'), b = t.indexOf('END $post$;') + 'END $post$;'.length; if (a < 0 || b < a) throw new Error('postcondițiile lipsesc'); return t.slice(0, a) + t.slice(b) }
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = faraPost(recalculeaza(aplica(MIG, lista))) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată: ${e.message}`); continue }
  const f = []
  let db = null, laAplicare = null
  try { db = await bazaNoua(); await aplicaMig(db, m); await verificari(db, false, f) } catch (e) { laAplicare = e.code || e.message }
  finally { if (db) await db.close() }
  ok(f.length > 0, `mutant „${nume}” prins de verificări (${f.length} picate${f[0] ? ': ' + f[0] : ''})${laAplicare ? '; excepție: ' + String(laAplicare).slice(0, 90) : ''}`)
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
