// Proba LOCALĂ a migrării 20261228a (Redări FAN, F1: operatorii numiți + butonul unic) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() EXACT din 20261126a + migrările 20261212a și 20261227a (oPOD)
//   aplicate ca runnerul (runda 2: re-bazare după îmbinarea #1135), apoi 20261228a aplicată ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați de scripts/livrare_amprenta_gen.sh; manifestul generat se compară
//   cu lista revizuită supabase/tests/20261228a_redari_fan_operator.l15.obiecte.tsv; `--scrie-obiecte` o regenerează).
// 1. Comportamentul, ca rolul authenticated cu JWT-ul fiecărui cont (owner, operator numit, editor nenumit, al doilea operator, viewer, cont fără
//    drept) și ca service_role (clasa B); așteptările sunt scrise de mână din spec (L25): operatorii (§7.1), plafonul zilei P1–P14 fără P5 (§7.2),
//    intențiile I1–I14 fără I5 (§8.3), P429 (§8.8), anularea în doi pași cu trigger-ul activ (§8.4.1), lotul tipărit (Q5 A), RD031 / RD032,
//    retragerea, clasele A / B / C (§7.3), E22 variantele 6–7 pe o sesiune (A.2). Două sesiuni (P5, I5, E15, E22 a–c): supabase/tests/20261228a_…_doua_sesiuni.sh (clonă).
// 2. Refuzurile migrării (marcaj, plafon, amprenta globală lipsă, 20261212a neaplicată, funcție în plus). 3. Revenirea: refuz la fiecare urmă; aplicare →
//    revenire → re-aplicare pe bază curată (amprentele vechi verificate de revenire). 4. Mutanți (P6, P13, I14, trigger-ul anulării, P429): fiecare PICĂ.
// 5. Paritatea gărzii „doar TEST”: fn_red_fan_lot_permis_valori (SQL) = transportPermis / esteProiectTest (JS) pe același tabel de cazuri (L19).
// 1c + 6 (runda 4, proba pe clonă): marcajul gărzii scris cu SET LOCAL (nume exact, golit după UPDATE), primul eveniment oPOD pe lot nemarcat,
//    autorul clasei B; GATE 0e (scripts/control_0e.sql verbatim) și poarta Izometrie E2 (blocul din 20261230a, extras din fișier) neschimbate
//    de migrare, iar mutantul „forma c75cc2ad” le pică exact ca pe clonă (FAN_MIG_VECHE=<fișier> rulează și head-ul vechi întreg).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_fan_operator_local.mjs
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
const H = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariFanHandler.mjs')).href)
const TMP = mkdtempSync(join(tmpdir(), 'fan_op_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const MIG12 = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
// runda 2 pe #1136: baza = 20261212a + 20261227a (oPOD, #1135 îmbinat în main), aplicate ca runnerul în această ordine
const MIG27 = citeste('supabase/migrations/20261227a_redari_fan_opod.sql')
const MIG = citeste('supabase/migrations/20261228a_redari_fan_operator.sql')
const REV = citeste('supabase/revenire/20261228a_redari_fan_operator_ROLLBACK.sql')
const OBIECTE_CALE = 'supabase/tests/20261228a_redari_fan_operator.l15.obiecte.tsv'
const OBIECTE = existsSync(join(ROOT, OBIECTE_CALE)) ? citeste(OBIECTE_CALE) : ''
const M26 = citeste('supabase/migrations/20261126a_redari_teren.sql')
const NIVEL = (() => {
  const i = M26.indexOf('CREATE FUNCTION public.fn_red_nivel() RETURNS text')
  const j = M26.indexOf('$fn$;', M26.indexOf('$fn$', i) + 4) + 5
  if (i < 0 || j < 5) throw new Error('nu găsesc fn_red_nivel în 20261126a')
  return M26.slice(i, j) + '\nREVOKE EXECUTE ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n'
})()
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const PLAFON_LIVRARE = 5000, PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
const validator = (fisier, ...opt) => {
  try { return { ok: true, out: execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } }
  catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) } }
}
let esec = 0
const ok = (c, m) => { if (c) console.log('  OK  ' + m); else { esec++; console.log('  NU  ' + m) } }

console.log('0. validatorul runnerului pe fișierele exacte; scripturile de clonă (bash -n)')
{
  const fm = join(ROOT, 'supabase/migrations/20261228a_redari_fan_operator.sql'), fr = join(ROOT, 'supabase/revenire/20261228a_redari_fan_operator_ROLLBACK.sql')
  ok(MIG.startsWith('-- Version 20261228120000.') && MIG.includes("IS DISTINCT FROM '5000/session'") && MIG.includes("IS DISTINCT FROM '5000:' || txid_current()"), 'migrarea cere exact plafonul runnerului L15 v2 (5000)')
  const a = validator(fm, '--plafon-tranzactie-ms', '5000'), b = validator(fm, '--plafon-tranzactie-ms', '2000'), c = validator(fm, '--fara-plafon')
  ok(a.ok && /^OK \d+ /.test(a.out), 'migrarea trece validatorul cu 5000: ' + a.out)
  ok(!b.ok && /PLAFON_DIFERIT/.test(b.out), 'migrarea cu runnerul la 2000 = refuz: ' + b.out.slice(0, 110))
  ok(!c.ok && /PLAFON_LIPSA/.test(c.out), 'migrarea fără plafon = refuz local: ' + c.out.slice(0, 110))
  const d = validator(fr, '--plafon-tranzactie-ms', '2000'), e = validator(fr, '--plafon-tranzactie-ms', '5000')
  ok(d.ok && /^OK \d+ /.test(d.out), 'revenirea trece validatorul cu plafonul ei (2000): ' + d.out)
  ok(!e.ok && /PLAFON_DIFERIT/.test(e.out), 'revenirea cu 5000 = refuz: ' + e.out.slice(0, 110))
  const S2 = join(ROOT, 'supabase/tests/20261228a_redari_fan_operator_doua_sesiuni.sh')
  let sn = null; try { execFileSync('bash', ['-n', S2], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (x) { sn = String(x.stderr || x.message) }
  const s2 = citeste('supabase/tests/20261228a_redari_fan_operator_doua_sesiuni.sh')
  ok(sn === null && ['P5', 'I5', 'E15', 'E22a', 'E22b', 'E22c'].every(k => s2.includes(`rez ok "${k} `)) && s2.includes('fn_red_fan_comanda('), `scriptul cu două sesiuni: bash -n ${sn || 'OK'}; scenariile P5 I5 E15 E22a E22b E22c prezente`)
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002', viewer: '00000000-0000-4000-8000-000000000003',
  strain: '00000000-0000-4000-8000-000000000004', admin: '00000000-0000-4000-8000-000000000005', editor2: '00000000-0000-4000-8000-000000000006', op2: '00000000-0000-4000-8000-000000000007',
  proiect: '10000000-0000-4000-8000-000000000001', real: '10000000-0000-4000-8000-000000000002',
  L1: '20000000-0000-4000-8000-000000000001', L2: '20000000-0000-4000-8000-000000000002', L3: '20000000-0000-4000-8000-000000000003', LR: '20000000-0000-4000-8000-000000000004',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const detId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const K = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`   // cheile intențiilor
const HX = c => c.repeat(64)
const nrPlic = n => `PL-TST-${String(n).padStart(4, '0')}`
const PLICURI = Array.from({ length: 17 }, (_, i) => i + 1)
const lotPlic = n => (n <= 12 ? ID.L1 : n <= 15 ? ID.L2 : n === 16 ? ID.L3 : ID.LR)
const proiectPlic = n => (n === 17 ? ID.real : ID.proiect)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false),
    ('${ID.admin}', 'A', false), ('${ID.editor2}', 'E2', false), ('${ID.op2}', 'OP2', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer'), ('${ID.admin}', 'redari', 'admin'),
    ('${ID.editor2}', 'redari', 'editor'), ('${ID.op2}', 'redari', 'editor');
  INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT'), ('${ID.real}', 'LOT1-REAL');
  INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.L1}', '${ID.proiect}', 'PP-0001'), ('${ID.L2}', '${ID.proiect}', 'PP-0002'), ('${ID.L3}', '${ID.proiect}', 'PP-0003'), ('${ID.LR}', '${ID.real}', 'PP-0004');
  INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
    ${PLICURI.map(n => `('${plicId(n)}', '${proiectPlic(n)}', '${lotPlic(n)}', '${nrPlic(n)}', 'PERSOANA ${n}', 'activ')`).join(',\n    ')};
  INSERT INTO public.red_detinatori (id, nume) VALUES ${PLICURI.map(n => `('${detId(n)}', 'D${n}')`).join(', ')};
  INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal) VALUES
    ${PLICURI.map(n => `('${detId(n)}', '07000000${String(n).padStart(2, '0')}', 'Str. Fictiva ${n}', 'Sat', 'Comuna', 'Prahova', '100000')`).join(',\n    ')};
  INSERT INTO public.red_convocari (detinator_id, plic_id, stare, sters_la) VALUES ${PLICURI.map(n => `('${detId(n)}', '${plicId(n)}', 'activ', NULL)`).join(', ')};`

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
async function bazaVeche({ cuOpod = true } = {}) {   // schelet + nivel + date + 20261212a + 20261227a (ca runnerul)
  const db = new PGlite()
  await db.exec(SCHELET); await db.exec(NIVEL); await db.exec(DATE)
  await caRunner(db, '20261212a_redari_fan_awb', MIG12)
  if (cuOpod) await caRunner(db, '20261227a_redari_fan_opod', MIG27)
  return db
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261228a_redari_fan_operator', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261228a_redari_fan_operator_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
async function bazaNoua() { const db = await bazaVeche(); await aplicaMig(db); return db }
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (t.split(din).length !== 2) throw new Error('mutantul nu se aplică exact o dată: ' + din.slice(0, 90))
    t = t.replace(din, in_)
  }
  return t
}
// apel ca rolul authenticated cu JWT-ul contului (uid null = anonim → rolul anon); srv = service_role FĂRĂ JWT (auth.uid() NULL), cu sub opțional
async function ca(db, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false);`)
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE') }
}
async function srv(db, sql, params = [], sub = '') {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${sub}', false); SET ROLE service_role`)
  try { return await db.query(sql, params) } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`) }
}
const cod = async p => { try { await p; return 'OK' } catch (e) { return e.code || String(e.message).slice(0, 60) } }
const val = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const sha = async (db, t) => (await val(db, `SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') AS s FROM public.${t} x`)).s

// ─── comportamentul (fail = lista verificărilor picate; mutanții o primesc din afară) ───
async function verificari(db, log, fail = []) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const rand = async n => val(db, `SELECT * FROM public.red_fan_awb WHERE plic_id = $1 AND stare NOT IN ('eroare', 'anulat', 'retras')`, [plicId(n)])
  const toate = async n => (await db.query(`SELECT * FROM public.red_fan_awb WHERE plic_id = $1 ORDER BY created_at`, [plicId(n)])).rows
  // p_opod = alegerea cu care s-au „calculat” hash-urile (loturile acestei probe nu cer oPOD → false; RD038 are proba lui: verificariOpod)
  const comanda = (uid, lot, k, plicuri, hash = HX('c'), opod = false) => ca(db, uid, 'SELECT public.fn_red_fan_comanda($1, $2, $3::jsonb, $4, $5) AS r', [lot, k, JSON.stringify(plicuri), hash, opod])
  const cmd = async (...a) => (await comanda(...a)).rows[0].r
  const pl = (ns, h = HX('a')) => ns.map(n => ({ plic_id: plicId(n), hash: h }))
  const zi = async () => (await db.query('SELECT zi_ro::text, aprobate FROM public.red_fan_zi')).rows
  const consum = async () => (await val(db, 'SELECT count(*)::int AS n FROM public.red_fan_zi_consum')).n
  const intent = async k => val(db, 'SELECT * FROM public.red_fan_intentii WHERE cheie = $1', [k])
  const cereri = async lot => (await db.query('SELECT * FROM public.red_fan_cereri_aprobare WHERE lot_id = $1 ORDER BY cerut_la', [lot])).rows
  const setare = (uid, fn, ...p) => ca(db, uid, `SELECT public.${fn}(${p.map((_, i) => '$' + (i + 1)).join(', ')})`, p)
  const surse = async n => (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(n)])).s
  const claimSrv = (actor, k, lot, ns, h = HX('a'), sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_claim($1, $2, $3, $4, $5, $6) AS r',
    [actor, k, lot, ns.map(n => null), ns.map(() => h), ns.map(() => null)], sub)   // id-urile se completează de apelant (vezi claimPe)
  const claimPe = async (actor, k, lot, ns, h = HX('a'), sub = '') => {
    const ids = [], hs = [], ss = []
    for (const n of ns) { const r = await rand(n); ids.push(r?.id); hs.push(r?.hash_date ?? h); ss.push(await surse(n)) }
    return srv(db, 'SELECT public.fn_red_fan_srv_claim($1, $2, $3, $4, $5, $6) AS r', [actor, k, lot, ids, hs, ss], sub)
  }
  const rezSrv = (actor, k, cerere, arr, http = 200, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_rezultate($1, $2, $3, $4::jsonb, $5) AS n', [actor, k, cerere, JSON.stringify(arr), http], sub)
  const incheie = (actor, k, rez = {}, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_intentie_incheie($1, $2, $3::jsonb) AS r', [actor, k, JSON.stringify(rez)], sub)
  const jurnal = async ev => (await val(db, `SELECT count(*)::int AS n FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = $1`, [ev])).n
  const inTx = async (uid, pas) => {   // o tranzacție ca rolul authenticated (pentru proba trigger-ului cu marcaj)
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`)
    await db.exec('BEGIN;')
    try { const r = await pas(); await db.exec('COMMIT'); return r } catch (e) { try { await db.exec('ROLLBACK') } catch { /* anulată */ } throw e } finally { await db.exec('RESET ROLE') }
  }

  // ── A. operatorii numiți (§7.1): lista owner-only, nivelul = precondiție, istoric, o singură definiție ──
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.editor])) === '42501', 'operator_seteaza: editorul nu se numește singur (42501)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.viewer])) === 'P0001', 'owner: viewer-ul nu poate fi operator (nivelul e precondiție)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.strain])) === 'P0001', 'owner: contul fără drept Redări nu poate fi operator')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', ['00000000-0000-4000-8000-0000000000ff'])) === 'P0002', 'owner: profil inexistent → P0002')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, $2)', [ID.editor, 'curier Lot 1'])) === 'OK' && await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.op2])) === 'OK', 'owner: editorul și op2 numiți operatori')
  const eOp = async uid => (await ca(db, uid, 'SELECT public.fn_red_fan_e_operator() AS e')).rows[0].e
  ok(await eOp(ID.editor) === true && await eOp(ID.op2) === true && await eOp(ID.owner) === true && await eOp(ID.editor2) === false && await eOp(ID.viewer) === false && await eOp(ID.strain) === false,
    'fn_red_fan_e_operator: operatorii numiți și owner-ul = true; editorul nenumit, viewer-ul, contul străin = false')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, false, NULL)', [ID.op2])) === 'OK' && await eOp(ID.op2) === false && (await val(db, 'SELECT retras_de FROM public.red_fan_operatori WHERE profile_id = $1', [ID.op2])).retras_de === ID.owner, 'retragerea nu șterge rândul (retras_de = owner); e_operator = false')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.op2])) === 'OK' && await eOp(ID.op2) === true, 're-numirea golește retras_*')
  ok(await jurnal('operator_numit') === 3 && await jurnal('operator_retras') === 1, 'jurnal: 3 numiri, 1 retragere')
  ok(await cod(ca(db, ID.owner, `INSERT INTO public.red_fan_operatori (profile_id, numit_de) VALUES ('${ID.editor2}', '${ID.owner}')`)) === '42501', 'scrierea directă în lista operatorilor refuzată (42501), și pentru owner')
  ok((await ca(db, ID.viewer, 'SELECT count(*)::int AS n FROM public.red_fan_operatori')).rows[0].n === 0 && (await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.red_fan_operatori')).rows[0].n === 2, 'RLS: viewer-ul nu vede lista, editorul da')

  // ── B. setările noi (owner); P1 (zi absentă, limita 0) ──
  ok(await cod(setare(ID.editor, 'fn_red_fan_setari_limita_zi', 0)) === '42501' && await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 5001)) === '22023' && await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 0)) === 'OK', 'plafonul zilei: doar owner, 0..5000; pus pe 0')
  ok(await cod(comanda(ID.editor2, ID.L1, K(1), pl([1]))) === '42501', 'comanda: editorul nenumit → 42501 (nimic scris)')
  ok(await cod(comanda(ID.editor, ID.L1, K(1), [{ plic_id: plicId(1), hash: 'x' }])) === '22023' && await cod(comanda(ID.editor, ID.L1, K(1), pl([1]), 'y')) === '22023', 'comanda: payload invalid → 22023')
  const c1 = await cmd(ID.editor, ID.L1, K(1), pl([1]))
  const r1 = await rand(1)
  ok(c1.replay === false && c1.mod === 'noua' && c1.incheiata === true && JSON.stringify(c1.aprobate) === '[]' && c1.numarate === 0 && c1.de_aprobat === 1 && c1.de_trimis.length === 0 && c1.cerere_id
    && r1.stare === 'de_aprobat' && r1.cerere_aprobare_id === c1.cerere_id && r1.intentie_cheie === K(1) && r1.aprobat_de === null && (await zi()).length === 0 && await consum() === 0,
    `P1 (zi absentă, limita 0, 1 plic): 0 aprobate, 1 de_aprobat, cerere deschisă, zi fără rând, consum gol; răspunsul = EFECTIV (aprobate [], numarate 0): ${JSON.stringify({ a: c1.aprobate, n: c1.numarate, d: c1.de_aprobat })}`)
  const i1 = await intent(K(1)), fl1 = await val(db, 'SELECT * FROM public.red_fan_loturi WHERE lot_id = $1', [ID.L1])
  ok(i1.stare === 'incheiata' && i1.incheiata_de === 'comanda' && i1.rezultat.de_aprobat === 1 && i1.rezultat.generate === 0 && i1.operator === ID.editor, 'I8: intenția durabilă pe ramura de_aprobat, incheiata de RPC (comanda), rezultat.de_aprobat = 1')
  ok(fl1 && fl1.test === true && fl1.marcat_de === ID.editor && fl1.prima_aprobare_la === null, 'marcajul AUTOMAT la prima trimitere: red_fan_loturi (test = proiectul e TEST-, marcat_de = operatorul); fără prima aprobare (nu e o aprobare)')
  ok(await jurnal('marcaj_automat') === 1 && await jurnal('comanda') === 1 && await jurnal('cerere_deschisa') === 1, 'jurnal: marcaj_automat, comanda, cerere_deschisa')
  // I8 replay: aceeași cheie → nimic scris
  const s0 = [await sha(db, 'red_fan_awb'), await sha(db, 'red_fan_cereri_aprobare'), await sha(db, 'red_fan_zi'), await sha(db, 'red_jurnal'), await sha(db, 'red_fan_intentii')]
  const c1r = await cmd(ID.editor, ID.L1, K(1), pl([1]))
  const s1 = [await sha(db, 'red_fan_awb'), await sha(db, 'red_fan_cereri_aprobare'), await sha(db, 'red_fan_zi'), await sha(db, 'red_jurnal'), await sha(db, 'red_fan_intentii')]
  ok(c1r.replay === true && c1r.rezultat.de_aprobat === 1 && JSON.stringify(s0) === JSON.stringify(s1) && (await cereri(ID.L1)).length === 1, 'I8 / E2: replay-ul aceleiași chei → nimic scris (sha identice pe rânduri, cereri, zi, jurnal, intenții), o singură cerere pe lot')
  // I9: cheie nouă peste cererea deschisă
  ok(await cod(comanda(ID.editor, ID.L1, K(2), pl([2]))) === 'RD037', 'I9b: cheie nouă cu un plic nou peste plafon (0) cât cererea e deschisă → RD037, nimic scris')
  ok((await intent(K(2))) === undefined && (await rand(2)) === undefined, 'după RD037: nici intenție, nici rând')
  const c2 = await cmd(ID.editor, ID.L1, K(2), pl([1]))
  ok(c2.incheiata === true && c2.de_trimis.length === 0 && c2.excluse.length === 1 && c2.excluse[0].motiv_cod === 'in_asteptare_aprobare' && (await cereri(ID.L1)).length === 1, 'I9a: cheie nouă cu plicul cererii → exclus in_asteptare_aprobare, încheiată de RPC, fără a doua cerere (fără 23505)')
  // retragerea cererii: doar cel care a cerut sau owner-ul
  const cer1 = (await cereri(ID.L1))[0]
  ok(await cod(ca(db, ID.op2, 'SELECT public.fn_red_fan_cerere_retrage($1)', [cer1.id])) === '42501', 'cerere_retrage: alt operator → 42501')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_cerere_retrage($1)', [cer1.id])) === 'OK' && (await rand(1)).stare === 'propus' && (await cereri(ID.L1))[0].stare === 'retrasa', 'cerere_retrage de cel care a cerut: cererea retrasă, rândul → propus')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_cerere_retrage($1)', [cer1.id])) === 'P0001', 'cerere_retrage repetată → P0001 (CAS)')

  // ── C. P2, P8 (limita 5, 6 plicuri; decizia owner-ului fără consum) ──
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 5)) === 'OK', 'plafonul zilei = 5')
  const c3 = await cmd(ID.editor, ID.L1, K(3), pl([1, 2, 3, 4, 5, 6]))
  ok(c3.de_aprobat === 6 && c3.aprobate.length === 0 && c3.numarate === 0 && (await zi()).length === 0 && (await db.query(`SELECT count(*)::int AS n FROM public.red_fan_awb WHERE lot_id = $1 AND stare = 'de_aprobat'`, [ID.L1])).rows[0].n === 6,
    'P2: zi absentă, limita 5, 6 plicuri → 0 aprobate, 6 de_aprobat; zi fără rând (rândul 1 refolosit din propus)')
  const cer3 = (await cereri(ID.L1)).find(c => c.stare === 'deschisa')
  ok(cer3 && cer3.n === 6 && cer3.intentie === K(3) && cer3.cerut_de === ID.editor, 'cererea: n = 6, intenția K3, cerută de operator')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_cerere_decide($1, true, NULL)', [cer3.id])) === '42501', 'cerere_decide: operatorul → 42501')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, false, NULL)', [cer3.id])) === '22023', 'respingerea fără motiv → 22023')
  const dec = (await ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, true, NULL) AS r', [cer3.id])).rows[0].r
  const r1b = await rand(1)
  ok(dec.aprobate === 6 && r1b.stare === 'aprobat' && r1b.aprobat_de === ID.owner && r1b.aprobare_owner_la && r1b.intentie_cheie === K(3) && (await zi()).length === 0 && await consum() === 0,
    'P8: aprobarea owner-ului → 6 aprobat cu aprobare_owner_la, intentie_cheie rămâne K3, ZERO consum de plafon')
  const fl1b = await val(db, 'SELECT prima_aprobare_la, prima_aprobare_de FROM public.red_fan_loturi WHERE lot_id = $1', [ID.L1])
  ok(fl1b.prima_aprobare_la && fl1b.prima_aprobare_de === ID.owner, 'prima aprobare a lotului pusă de decizia owner-ului (poziția 4 în lanț)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, false)', [ID.L1])) === 'P0001', 'marcajul imuabil după prima aprobare')

  // ── D. P14 + condițiile recenzentului: peste plafon cu rânduri aprobat preluabile → nimic nu pleacă; cheie nouă înaintea deciziei → zero de_trimis ──
  const c4 = await cmd(ID.editor, ID.L1, K(4), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
  const cer4 = (await cereri(ID.L1)).find(c => c.stare === 'deschisa')
  ok(c4.de_aprobat === 6 && c4.aprobate.length === 0 && c4.numarate === 0 && c4.de_trimis.length === 0 && c4.preluate === 0 && c4.incheiata === true && c4.cerere_id === cer4.id
    && (await rand(1)).stare === 'aprobat' && (await rand(1)).intentie_cheie === K(4) && (await rand(7)).stare === 'de_aprobat' && (await zi()).length === 0 && (await intent(K(4))).rezultat.generate === 0,
    'P14 (P2-1): 6 aprobat preluabile + 6 noi peste plafon → 6 de_aprobat, cele aprobat rămân aprobat (legate de K4), de_trimis gol, aprobate [] / numarate 0, intenția încheiată cu generate 0')
  const c5 = await cmd(ID.editor, ID.L1, K(5), pl([1, 2, 3, 4, 5, 6]))
  ok(c5.de_trimis.length === 0 && c5.incheiata === true && c5.excluse.length === 6 && c5.excluse.every(x => x.motiv_cod === 'in_asteptare_aprobare') && (await rand(1)).stare === 'aprobat' && (await rand(1)).intentie_cheie === K(4),
    'P14 extins (P2-2): cheie nouă înaintea deciziei, doar cu partea aprobată → TOATE excluse in_asteptare_aprobare, de_trimis gol (zero POST), rândurile neatinse')
  const c6 = await cmd(ID.editor, ID.L1, K(6), pl([7, 8]))
  ok(c6.incheiata === true && c6.de_trimis.length === 0 && c6.excluse.length === 2 && c6.excluse.every(x => x.motiv_cod === 'in_asteptare_aprobare') && c6.cerere_id === null
    && (await cereri(ID.L1)).filter(c => c.stare === 'deschisa').length === 1 && (await rand(7)).stare === 'de_aprobat' && (await rand(7)).cerere_aprobare_id === cer4.id,
    'I9a pe cererea K4: cheie nouă DOAR cu plicurile cererii (de_aprobat) → excluse in_asteptare_aprobare, fără RD037 (nimic nou peste plafon), fără a doua cerere, rândurile neatinse')
  const dec4 = (await ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, true, $2) AS r', [cer4.id, 'ok'])).rows[0].r
  ok(dec4.aprobate === 6 && (await rand(7)).stare === 'aprobat' && (await rand(7)).aprobare_owner_la && await consum() === 0, 'decizia: 6 → aprobat fără consum')
  const c7 = await cmd(ID.editor, ID.L1, K(7), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
  ok(c7.mod === 'noua' && c7.incheiata === false && c7.de_trimis.length === 12 && c7.preluate === 12 && c7.aprobate.length === 0 && c7.numarate === 0 && (await zi()).length === 0 && (await rand(1)).intentie_cheie === K(7),
    'după decizie, „Trimite” din nou: 12 preluate (deja aprobat), nenumărate, de_trimis 12, intenția K7 in_curs')
  // I2 / I3 / E16
  ok(await cod(comanda(ID.editor, ID.L1, K(7), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))) === 'RD030', 'I2: aceeași cheie înainte de expirarea arendei → RD030')
  ok(await cod(comanda(ID.editor, ID.L1, K(7), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), HX('d'))) === '22023', 'I3: aceeași cheie, alt hash al cererii → 22023')
  ok(await cod(comanda(ID.op2, ID.L1, K(7), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))) === '22023', 'I3: aceeași cheie, alt operator ne-owner → 22023')
  ok(await cod(comanda(ID.editor, ID.L2, K(7), pl([13]))) === '22023', 'cheia pe alt lot → 22023')
  ok(await cod(comanda(ID.op2, ID.L1, K(8), pl([1]))) === 'RD030', 'E3b: cheie nouă pe lotul cu intenție in_curs vie → RD030')

  // ── E. clasa B: rezervarea (service_role, p_actor), rezultatele, încheierea; drepturile exacte ──
  const r1c = await rand(1)
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_srv_claim($1, $2, $3, $4, $5, $6)', [ID.editor, K(7), ID.L1, [r1c.id], [HX('a')], [await surse(1)]])) === '42501', 'clasa B ca authenticated (operator) → 42501')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_srv_claim($1, $2, $3, $4, $5, $6)', [ID.owner, K(7), ID.L1, [r1c.id], [HX('a')], [await surse(1)]])) === '42501', 'clasa B ca owner (JWT) → 42501')
  ok(await cod(claimPe(ID.editor, K(7), ID.L1, [1], HX('a'), ID.editor)) === '42501', 'clasa B ca service_role cu auth.uid() nenul → 42501')
  ok(await cod(claimPe(ID.editor2, K(7), ID.L1, [1])) === '42501', 'clasa B cu p_actor fără rând de operator → 42501')
  ok(await cod(claimPe(ID.op2, K(7), ID.L1, [1])) === '22023', 'rezervarea de un operator care nu e al intenției → 22023')
  const cl1 = (await claimPe(ID.editor, K(7), ID.L1, [1, 2, 3, 4, 5, 6])).rows[0].r
  ok(/^[0-9a-f-]{36}$/.test(cl1.cerere_id) && cl1.rezervate === 6 && (await rand(1)).stare === 'in_curs' && (await rand(1)).cerere_id === cl1.cerere_id, 'srv_claim: 6 rânduri in_curs, o cheie de solicitare')
  const i7 = await intent(K(7))
  ok(i7.stare === 'in_curs' && new Date(i7.lucru_pana_la) > new Date(i7.inceput_la), 'arenda intenției reînnoită de claim')
  ok(await cod(claimPe(ID.editor, K(7), ID.L1, [1])) === 'P0001', 'al doilea claim pe același rând → P0001 (nu mai e aprobat)')
  const idsL1 = async ns => { const o = []; for (const n of ns) o.push((await rand(n)).id); return o }
  const ids6 = await idsL1([1, 2, 3, 4, 5, 6])
  const rez6 = ids6.map((id, i) => ({ id, stare: i === 5 ? 'eroare' : 'generat', awb: i === 5 ? null : String(2000000001 + i), tarif: i === 5 ? null : 10, tva: null, motiv: i === 5 ? 'FAN a respins expedierea; câmpuri semnalate: phone' : null }))
  ok(await cod(rezSrv(ID.editor2, K(7), cl1.cerere_id, rez6)) === '42501', 'srv_rezultate cu p_actor care nu e operatorul intenției → 42501')
  ok(await cod(rezSrv(ID.editor, K(7), cl1.cerere_id, rez6, null)) === '22023', 'srv_rezultate fără codul HTTP → 22023')
  ok(await cod(rezSrv(ID.editor, K(7), cl1.cerere_id, rez6.map(x => ({ ...x, stare: 'neincercat', awb: null })), 200)) === '22023', 'neincercat cu HTTP 200 → 22023')
  ok(await cod(rezSrv(ID.editor, K(7), cl1.cerere_id, rez6.map((x, i) => (i === 0 ? { ...x, stare: 'neincercat', awb: null } : x)), 429)) === '22023', 'neincercat amestecat cu alte stări → 22023')
  ok((await rezSrv(ID.editor, K(7), cl1.cerere_id, rez6)).rows[0].n === 6 && (await rand(1)).stare === 'generat' && (await rand(1)).awb === '2000000001' && (await toate(6)).at(-1).stare === 'eroare', 'srv_rezultate: 5 generat + 1 eroare, toate odată')
  ok(await cod(incheie(ID.editor2, K(7))) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_srv_intentie_incheie($1, $2, $3::jsonb)', [ID.editor, K(7), '{}'])) === '42501', 'I7: încheierea ca authenticated / cu alt actor → 42501')
  ok(await cod(incheie(ID.editor, K(7), { tiraj: 'x' })) === '22023' && await cod(incheie(ID.editor, K(7), { motiv_oprire: 'alt' })) === '22023', 'încheierea cu chei străine în p_rezultat → 22023')
  // RD031 ÎNAINTEA încheierii: 6 aprobat (7..12) țin lotul deschis
  const tiraj = (uid, lot, k) => ca(db, uid, 'SELECT public.fn_red_fan_tiraj($1, $2, NULL) AS t', [lot, k])
  ok(await cod(tiraj(ID.editor, ID.L1, HX('1'))) === 'RD031', 'RD031: tirajul pe lotul cu rânduri aprobat netrimise → refuz (D15)')
  const inc7 = (await incheie(ID.editor, K(7), { oprit: false })).rows[0].r
  ok(inc7.incheiata === true && inc7.rezultat.generate === 5 && inc7.rezultat.respinse === 1 && inc7.rezultat.ramase === 6 && Number(inc7.rezultat.tarif_total) === 50 && (await intent(K(7))).incheiata_de === 'edge',
    'srv_intentie_incheie: sumarul DERIVAT din rânduri (generate 5, respinse 1, ramase 6, tarif 50), incheiata_de = edge')
  ok((await incheie(ID.editor, K(7), {})).rows[0].r.deja === true, 'încheierea repetată → deja (nimic scris)')
  ok((await cmd(ID.editor, ID.L1, K(7), pl([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).replay === true, 'I4: replay după rezultate (cu un respins) → replay, zero rânduri noi')
  ok((await db.query(`SELECT count(*)::int AS n FROM public.red_fan_awb WHERE lot_id = $1`, [ID.L1])).rows[0].n === 12, 'lotul 1 are exact 12 rânduri (niciun rând nou la replay)')

  // ── F. P429 (§8.8): neincercat → aprobat cât presupunerea e necontrazisă; apoi necunoscut + RD033 + reconciliere ──
  const c8 = await cmd(ID.editor, ID.L1, K(8), pl([7, 8, 9, 10, 11, 12]))
  ok(c8.mod === 'noua' && c8.de_trimis.length === 6 && c8.preluate === 6 && c8.numarate === 0, 'K8 preia cele 6 aprobat rămase (K7 încheiată, nimic de închis)')
  const cl8 = (await claimPe(ID.editor, K(8), ID.L1, [7, 8, 9, 10, 11, 12])).rows[0].r
  const ids8 = await idsL1([7, 8, 9, 10, 11, 12])
  const consumInainte = await consum(), ziInainte = JSON.stringify(await zi())
  ok((await rezSrv(ID.editor, K(8), cl8.cerere_id, ids8.map(id => ({ id, stare: 'neincercat', awb: null })), 429)).rows[0].n === 6 && (await rand(7)).stare === 'aprobat' && (await rand(7)).cerere_id === null
    && await consum() === consumInainte && JSON.stringify(await zi()) === ziInainte && await jurnal('rezultate_neincercat') === 1,
    'P429 necontrazisă: 429 fără AWB → rândurile revin aprobat, cerere_id NULL, consumul neschimbat, jurnal rezultate_neincercat')
  const inc8 = (await incheie(ID.editor, K(8), { oprit: true, motiv_oprire: '429' })).rows[0].r
  ok(inc8.incheiata === true && inc8.rezultat.ramase === 6 && inc8.rezultat.oprit === true && inc8.rezultat.motiv_oprire === '429', 'încheierea după 429: incheiata, ramase 6, oprit 429')
  ok(await cod(setare(ID.editor, 'fn_red_fan_setari_presupunere_429', false, 'motiv')) === '42501' && await cod(setare(ID.owner, 'fn_red_fan_setari_presupunere_429', false, ' ')) === '22023'
    && await cod(setare(ID.owner, 'fn_red_fan_setari_presupunere_429', false, 'raspunsul scris al curierului')) === 'OK', 'presupunere_429: operatorul → 42501; owner fără motiv → 22023; owner cu motiv → false')
  const c9 = await cmd(ID.editor, ID.L1, K(9), pl([7, 8, 9, 10, 11, 12]))
  const cl9 = (await claimPe(ID.editor, K(9), ID.L1, [7, 8, 9, 10, 11, 12])).rows[0].r
  ok(c9.de_trimis.length === 6 && (await rezSrv(ID.editor, K(9), cl9.cerere_id, ids8.map(id => ({ id, stare: 'neincercat', awb: null })), 429)).rows[0].n === 6
    && (await rand(7)).stare === 'necunoscut' && (await rand(7)).cerere_id === cl9.cerere_id, 'P429 contrazisă: același neincercat → necunoscut cu cerere_id păstrat (niciodată eroare)')
  const inc9 = (await incheie(ID.editor, K(9), {})).rows[0].r
  ok(inc9.incheiata === false && inc9.necunoscute === 6 && (await intent(K(9))).stare === 'in_curs', 'I10: încheierea refuzată cât sunt rânduri necunoscute → {incheiata:false, necunoscute:6}, nimic scris')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(9)])
  ok(await cod(comanda(ID.editor, ID.L1, K(9), pl([7, 8, 9, 10, 11, 12]))) === 'RD033' && await cod(comanda(ID.editor, ID.L1, K(10), pl([7]))) === 'RD033', 'I6 / I13: reluare / cheie nouă peste rânduri necunoscute → RD033, nimic scris')
  ok(await cod(tiraj(ID.editor, ID.L1, HX('1'))) === 'RD031', 'RD031: rândurile necunoscute țin lotul deschis')
  const recSrv = (actor, n, awb, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_reconciliaza($1, $2, $3, NULL, NULL) AS s', [actor, null, awb], sub)
  for (let n = 7; n <= 12; n++) {
    const r = await rand(n)
    const s = await cod(srv(db, 'SELECT public.fn_red_fan_srv_reconciliaza($1, $2, $3, 12.5, NULL)', [ID.editor, r.id, String(2000000000 + n)]))
    if (s !== 'OK') ok(false, `srv_reconciliaza găsit pe plicul ${n}: ${s}`)
  }
  ok(await cod(srv(db, 'SELECT public.fn_red_fan_srv_reconciliaza($1, $2, NULL, NULL, NULL)', [ID.editor, ids8[0]])) === '22023', 'srv_reconciliaza fără AWB (absența) → 22023: doar owner-ul confirmă absența')
  ok((await rand(7)).stare === 'generat' && (await intent(K(9))).stare === 'incheiata' && (await intent(K(9))).incheiata_de === 'reconciliere' && (await intent(K(9))).rezultat.generate === 6,
    'I10: reconcilierea „găsit” pe fiecare rând → generat; ultimul închide intenția (reconciliere) cu sumarul derivat')
  // I11 / I12: lotul încheiat prin rânduri → tirajul începe; replay fără rânduri noi
  const t1 = (await tiraj(ID.editor, ID.L1, HX('1'))).rows[0].t
  ok(t1.stare === 'inceput' && t1.nr === 1 && (await tiraj(ID.editor, ID.L1, HX('1'))).rows[0].t.stare === 'acelasi', 'I11 / I12: lot încheiat (11 generat + 1 eroare) → tirajul începe (operator); același tiraj la a doua cerere')
  ok(await cod(tiraj(ID.editor2, ID.L1, HX('1'))) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_tiraj($1, $2, $3)', [ID.L1, HX('2'), HX('1')])) === '42501', 'tiraj: editorul nenumit → 42501; înlocuirea de operator → 42501 (doar owner)')
  ok((await cmd(ID.editor, ID.L1, K(9), pl([7, 8, 9, 10, 11, 12]))).replay === true && (await db.query(`SELECT count(*)::int AS n FROM public.red_fan_awb WHERE lot_id = $1`, [ID.L1])).rows[0].n === 12, 'replay după tiraj: zero rânduri noi')
  // lotul tipărit (Q5 A)
  const c11 = await cmd(ID.editor, ID.L1, K(11), pl([6], HX('e')))
  ok(c11.incheiata === true && c11.excluse[0].motiv_cod === 'lot_tiparit' && (await rand(6)) === undefined && (await db.query(`SELECT count(*)::int AS n FROM public.red_fan_awb WHERE lot_id = $1`, [ID.L1])).rows[0].n === 12, 'Q5 A: plicul respins pe lotul tipărit → exclus lot_tiparit, niciun rând nou')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_propune($1, $2, NULL)', [plicId(6), HX('e')])) === 'RD036', 'calea veche: propunerea pe lotul tipărit → RD036')
  ok(await cod(ca(db, ID.editor2, 'SELECT public.fn_red_fan_propune($1, $2, NULL)', [plicId(13), HX('a')])) === '42501', 'propunerea: editorul nenumit → 42501 (operator sau owner)')

  // ── G. plafonul pe lotul 2: P7 / P11 / P12 / P9 / P10, reluarea I1, preluarea E4d, RD033 ──
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_presupunere_429', true, 'curierul a confirmat')) === 'OK' && await jurnal('presupunere_429_schimbata') === 2, 'presupunerea repusă de owner, cu motiv (jurnal 2)')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 5)) === 'OK', 'limita 5')
  const c12 = await cmd(ID.editor, ID.L2, K(12), pl([13]))
  ok(c12.aprobate.length === 1 && c12.numarate === 1 && (await zi())[0].aprobate === 1 && await consum() === 1 && (await rand(13)).stare === 'aprobat' && (await rand(13)).aprobat_de === ID.editor, 'P3 (zi absentă, 1 plic sub plafon): aprobat, rândul zilei (azi, 1), un consum')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(12)])
  // re-propunere în aceeași zi (datele schimbate): cheie nouă cu hash nou → A \ N (P7); + un plic nou cu limita = acum + 1 (P11)
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 2)) === 'OK', 'limita = aprobate azi + 1')
  const c13 = await cmd(ID.editor, ID.L2, K(13), [{ plic_id: plicId(13), hash: HX('b') }, { plic_id: plicId(14), hash: HX('a') }])
  ok(c13.mod === 'preluare' && (await intent(K(12))).stare === 'neincheiata' && (await intent(K(12))).incheiata_de === 'comanda_noua', 'E4d: cheie nouă după expirarea arendei → intenția veche neincheiata (comanda_noua)')
  ok(c13.aprobate.length === 2 && c13.numarate === 1 && c13.de_trimis.length === 2 && (await rand(13)).stare === 'aprobat' && (await rand(13)).hash_date === HX('b') && (await rand(13)).aprobat_la !== null
    && (await rand(14)).stare === 'aprobat' && (await zi())[0].aprobate === 2 && await consum() === 2,
    'P7 / P11: rândul numărat azi re-aprobat cu hash nou (A \\ N) + un plic nou → AMBELE aprobat și în de_trimis; aprobate + 1, un singur consum nou; paritate 2 = 2')
  ok((await val(db, `SELECT (SELECT aprobate FROM public.red_fan_zi) = (SELECT count(*) FROM public.red_fan_zi_consum) AS p`)).p === true, 'paritatea aprobate = count(consum)')
  // P12: v_n = 0 cu limita coborâtă la 0 → aprobat preluat, fără cerere
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(13)])
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 0)) === 'OK', 'limita coborâtă la 0 sub aprobatele zilei')
  const c14 = await cmd(ID.editor, ID.L2, K(14), [{ plic_id: plicId(13), hash: HX('b') }])
  ok(c14.mod === 'preluare' && c14.preluate === 1 && c14.de_trimis.length === 1 && c14.de_aprobat === 0 && !c14.cerere_id && (await cereri(ID.L2)).length === 0 && (await zi())[0].aprobate === 2,
    'P12: v_n = 0 cu limita 0 → preluat, aprobat, nicio cerere, ziua neatinsă')
  // P9: plic nou cu limita 0 < aprobate → de_aprobat; P10: scrierea directă în zi; trigger-ul gărzii
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(14)])
  const c15 = await cmd(ID.editor, ID.L2, K(15), pl([15]))
  ok(c15.de_aprobat === 1 && c15.cerere_id && (await rand(15)).stare === 'de_aprobat' && (await zi())[0].aprobate === 2, 'P9: plic nou cu limita sub aprobatele zilei → de_aprobat (nu eroare), ziua neatinsă')
  ok(await cod(ca(db, ID.owner, 'UPDATE public.red_fan_zi SET aprobate = 0')) === '42501' && await cod(ca(db, ID.owner, `INSERT INTO public.red_fan_zi VALUES ('2030-01-01', 1)`)) === '42501', 'P10: scrierea directă în red_fan_zi ca owner → 42501 (înaintea trigger-ului)')
  ok(await cod(db.query('UPDATE public.red_fan_zi SET aprobate = 10')) === 'P0001' && await cod(db.query('UPDATE public.red_fan_zi SET aprobate = 1')) === 'P0001', 'fn_red_fan_zi_garda: peste limită / scădere → P0001 chiar pentru proprietar')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 20)) === 'OK', 'limita înapoi la 20')
  // K14 a devenit neincheiata prin K15 (comanda_noua): reluarea ei → RD034 (I17 / E17), nimic scris
  ok(await cod(comanda(ID.editor, ID.L2, K(14), [{ plic_id: plicId(13), hash: HX('b') }])) === 'RD034' && (await intent(K(14))).stare === 'neincheiata', 'E17: „Reia” pe o intenție preluată de alta → RD034, nimic scris')
  // I1: K16 preia cele două aprobat (13, 14); apoi rândul 14 revine propus (owner, date schimbate); reluarea K16 după expirare: zero aprobări noi, 14 exclus date_schimbate
  const c16 = await cmd(ID.editor, ID.L2, K(16), [{ plic_id: plicId(13), hash: HX('b') }, { plic_id: plicId(14), hash: HX('a') }])
  ok(c16.mod === 'noua' && c16.de_trimis.length === 2 && c16.numarate === 0 && (await intent(K(16))).stare === 'in_curs', 'K16: cele două aprobat preluate (deja aprobat), nenumărate, in_curs')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_propune($1, $2, NULL)', [plicId(14), HX('f')])) === 'OK' && (await rand(14)).stare === 'propus', 'owner re-propune plicul 14 (date schimbate) → propus, hash nou')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(16)])
  const c16r = await cmd(ID.editor, ID.L2, K(16), [{ plic_id: plicId(13), hash: HX('b') }, { plic_id: plicId(14), hash: HX('a') }])
  ok(c16r.mod === 'reluare' && c16r.aprobate.length === 0 && c16r.numarate === 0 && c16r.de_trimis.length === 1 && c16r.excluse.length === 1 && c16r.excluse[0].motiv_cod === 'date_schimbate'
    && (await rand(14)).stare === 'propus' && (await zi())[0].aprobate === 2 && await consum() === 2, 'I1: reluarea K16 → zero aprobări noi, de_trimis = rândul aprobat (13), 14 exclus date_schimbate (rămâne propus), zi / consum neschimbate')
  const c16x = await cod(comanda(ID.editor, ID.L2, K(16), [{ plic_id: plicId(13), hash: HX('b') }, { plic_id: plicId(14), hash: HX('a') }]))
  ok(c16x === 'RD030', 'I2: reluarea a reînnoit arenda → aceeași cheie imediat → RD030')
  const c18x = await cmd(ID.editor, ID.L2, K(18), [{ plic_id: plicId(14), hash: HX('f') }, { plic_id: plicId(15), hash: HX('a') }]).catch(e => e.code)
  ok(c18x === 'RD030', 'cheie nouă cât K16 e vie (arenda reînnoită de reluare) → RD030 (serializarea pe lot)')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(16)])
  const cl16 = (await claimPe(ID.editor, K(16), ID.L2, [13], HX('b'))).rows[0].r
  ok(cl16.rezervate === 1 && (await rand(13)).stare === 'in_curs', 'claim-ul pe rândul K16 (arenda expirată, dar intenția in_curs) → in_curs')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(16)])
  ok(await cod(comanda(ID.editor, ID.L2, K(16), [{ plic_id: plicId(13), hash: HX('b') }, { plic_id: plicId(14), hash: HX('a') }])) === 'RD033' && await cod(comanda(ID.editor, ID.L2, K(18), pl([14], HX('f')))) === 'RD033', 'I6 / I13: rând in_curs al intenției → RD033 la reluare și la preluare')
  ok((await rezSrv(ID.editor, K(16), cl16.cerere_id, [{ id: (await rand(13)).id, stare: 'generat', awb: '2000000013' }])).rows[0].n === 1, 'rezultatul plicului 13 → generat')
  // cererea deschisă (15) + comanda nouă cu plicul 14 (propus, re-propus de owner → A, consum pe azi? 14 are consum azi → A \ N); K16 (arenda reînnoită de claim) expirată
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(16)])
  const c17 = await cmd(ID.editor, ID.L2, K(17), pl([14], HX('f')))
  ok(c17.mod === 'preluare' && c17.aprobate.length === 1 && c17.numarate === 0 && (await rand(14)).stare === 'aprobat' && await consum() === 2 && (await cereri(ID.L2)).find(c => c.stare === 'deschisa'),
    'I9c + A \\ N: plicul re-propus (consum azi) cu cererea deschisă neatinsă → aprobat, nenumărat, cererea rămâne')
  // retragerea din trimitere (E13): plafonul nu se restituie
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_retrage($1, $2)', [(await rand(14)).id, 'owner'])) === '22023', 'retrage: operatorul cu motivul owner → 22023')
  ok(await cod(ca(db, ID.editor2, 'SELECT public.fn_red_fan_retrage($1, $2)', [(await rand(14)).id, 'operator'])) === '42501', 'retrage: editorul nenumit → 42501')
  const r14 = await rand(14)
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_retrage($1, $2)', [r14.id, 'operator'])) === 'OK' && (await toate(14)).at(-1).stare === 'retras' && (await toate(14)).at(-1).motiv_retragere === 'operator'
    && (await toate(14)).at(-1).retras_de === ID.editor && (await zi())[0].aprobate === 2 && await consum() === 2, 'E13: retragerea unui aprobat → retras (operator); plafonul consumat nu se restituie')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_retrage($1, $2)', [r14.id, 'operator'])) === 'P0001', 'retragerea repetată → P0001')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET motiv_retragere = 'owner' WHERE id = $1`, [r14.id])) === '42501', 'retras_* imuabile (trigger, chiar pentru proprietar)')
  const inc16 = (await incheie(ID.editor, K(16), {})).rows[0].r
  ok(inc16.deja === true && inc16.stare === 'neincheiata' && inc16.incheiata === false, 'încheierea unei intenții preluate (K16 neincheiata prin K17) → deja, nimic scris')
  const inc17 = (await incheie(ID.editor, K(17), {})).rows[0].r
  ok(inc17.incheiata === true && inc17.rezultat.retrase === 1 && inc17.rezultat.generate === 0, 'K17 încheiată: retrase 1 (14), generate 0')
  // cererea 15: respingere → propus; apoi decizie pe cerere inexistentă
  const cer15 = (await cereri(ID.L2)).find(c => c.stare === 'deschisa')
  ok((await ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, false, $2) AS r', [cer15.id, 'nu acum'])).rows[0].r.propuse === 1 && (await rand(15)).stare === 'propus' && (await rand(15)).cerere_aprobare_id === cer15.id,
    'respingerea: rândul → propus, cerere_aprobare_id rămâne ca istoric')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, true, NULL)', [cer15.id])) === 'P0001', 'decizia pe o cerere decisă → P0001')

  // ── H. garda „doar TEST” în BD (RD032) pe toate căile ──
  ok(await cod(comanda(ID.editor, ID.LR, K(18), pl([17]))) === 'RD032' && (await val(db, 'SELECT count(*)::int AS n FROM public.red_fan_loturi WHERE lot_id = $1', [ID.LR])).n === 0 && (await intent(K(18))) === undefined,
    'E10: comanda pe un lot al unui proiect ne-TEST → RD032, fără marcaj, fără intenție')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, false)', [ID.L3])) === 'OK' && await cod(comanda(ID.editor, ID.L3, K(19), pl([16]))) === 'RD032'
    && (await val(db, 'SELECT test FROM public.red_fan_loturi WHERE lot_id = $1', [ID.L3])).test === false, 'E11: lot marcat REAL de owner pe proiect TEST → RD032 din BD, marcajul owner-ului nerescris')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, true)', [ID.L3])) === 'OK', 'owner: L3 înapoi pe TEST')
  ok(await cod(setare(ID.editor, 'fn_red_fan_setari_doar_test', false)) === '42501' && await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', false)) === 'OK', 'garda doar TEST: doar owner-ul o oprește (F4)')
  const c18 = await cmd(ID.editor, ID.LR, K(18), pl([17]))
  ok(c18.aprobate.length === 1 && (await val(db, 'SELECT test FROM public.red_fan_loturi WHERE lot_id = $1', [ID.LR])).test === false, 'cu garda oprită: comanda pe lotul real trece, marcaj automat test = false')
  const cl18 = (await claimPe(ID.editor, K(18), ID.LR, [17])).rows[0].r
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', true)) === 'OK', 'garda repornită')
  const id17 = (await rand(17)).id
  ok(await cod(rezSrv(ID.editor, K(18), cl18.cerere_id, [{ id: id17, stare: 'generat', awb: '2000000017' }])) === 'RD032', 'E21: srv_rezultate pe lotul real cu garda pornită → RD032 (rândul rămâne in_curs: reconciliere după repunere)')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', false)) === 'OK' && (await rezSrv(ID.editor, K(18), cl18.cerere_id, [{ id: id17, stare: 'generat', awb: '2000000017' }])).rows[0].n === 1, 'cu garda oprită rezultatul se scrie')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', true)) === 'OK')
  const azi = (await val(db, `SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date::text AS d`)).d
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [id17, azi])) === 'RD032', 'fn_red_fan_ridicat (owner) pe lot real cu garda pornită → RD032')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_ridicat($1, $2)', [id17, azi])) === '42501', 'clasa C ca operator: ridicat → 42501')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', false)) === 'OK' && await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_ridicat($1, $2)', [id17, azi])) === 'OK'
    && (await val(db, 'SELECT awb FROM public.red_plicuri WHERE id = $1', [plicId(17)])).awb === '2000000017', 'cu garda oprită: ridicarea pe lot real scrie expedierea pe plic')
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_doar_test', true)) === 'OK' && await jurnal('setari_doar_test') === 6, 'garda la loc; 6 schimbări în jurnal')

  // ── I. anularea în doi pași (§8.4.1) cu trigger-ul activ ──
  const idA = async n => (await rand(n)).id
  const cere = (uid, n, awb, motiv, nota = null) => ca(db, uid, 'SELECT public.fn_red_fan_anulare_cere($1, $2, $3, $4)', [null, awb, motiv, nota]).catch(e => e)   // placeholder (vezi cereP)
  const cereP = async (uid, n, motiv, nota = null) => { const r = await rand(n); return cod(ca(db, uid, 'SELECT public.fn_red_fan_anulare_cere($1, $2, $3, $4)', [r.id, r.awb, motiv, nota])) }
  ok(await cereP(ID.editor2, 1, 'date_gresite') === '42501' && await cereP(ID.editor, 1, 'altceva') === '22023' && await cereP(ID.editor, 1, 'alt_motiv') === '22023', 'anulare_cere: editorul nenumit 42501; motiv în afara listei / alt_motiv fără notă → 22023')
  ok(await cereP(ID.editor, 1, 'neridicat_3_zile') === 'OK', 'anulare_cere (operator) pe un AWB generat → trece de trigger')
  const a1 = await rand(1)
  ok(a1.stare === 'generat' && a1.anulare_ceruta_de === ID.editor && a1.anulare_ceruta_motiv === 'neridicat_3_zile' && a1.anulat_la === null, 'cererea: stare rămâne generat, coloanele cererii scrise, confirmarea NULL')
  ok(await cereP(ID.editor, 1, 'date_gresite') === 'RD035', 'a doua cerere pe același rând → RD035')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET anulare_ceruta_motiv = 'date_gresite' WHERE id = $1`, [a1.id])) === '42501', 'schimbarea neautorizată a motivului cerut → 42501 (trigger, fără marcaj)')
  const mutAnul = await cod(db.exec(`BEGIN; SET LOCAL redari_fan.garda = 'fn_red_fan_anulare_cere'; UPDATE public.red_fan_awb SET stare = 'anulat', anulat_de = '${ID.editor}', anulat_la = now(), motiv_anulare = 'date_gresite' WHERE id = '${a1.id}'; COMMIT;`))
  await db.exec('ROLLBACK').catch(() => {})
  ok(mutAnul === '42501' && (await rand(1)).stare === 'generat', 'mutantul „fn_red_fan_anulare_cere pune stare = anulat” (marcajul ei + UPDATE ca proprietar) → 42501 din trigger (nu e pe lista confirmării)')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_srv_anuleaza($1, $2, $3, $4)', [ID.editor, a1.id, a1.awb, 'sters'])) === '42501', 'srv_anuleaza ca authenticated → 42501')
  ok(await cod(srv(db, 'SELECT public.fn_red_fan_srv_anuleaza($1, $2, $3, $4)', [ID.editor, a1.id, a1.awb, 'altceva'])) === '22023', 'srv_anuleaza cu rezultat în afara listei → 22023')
  ok((await srv(db, 'SELECT public.fn_red_fan_srv_anuleaza($1, $2, $3, $4) AS r', [ID.editor, a1.id, a1.awb, 'ambiguu'])).rows[0].r === 'ambiguu' && (await rand(1)).stare === 'generat', 'ambiguu → nimic schimbat, cererea rămâne deschisă')
  ok((await srv(db, 'SELECT public.fn_red_fan_srv_anuleaza($1, $2, $3, $4) AS r', [ID.editor, a1.id, a1.awb, 'sters'])).rows[0].r === 'sters', 'sters → înscris')
  const a1d = (await toate(1)).at(-1)
  ok(a1d.stare === 'anulat' && a1d.anulat_de === ID.editor && a1d.motiv_anulare === 'neridicat_3_zile' && a1d.anulare_ceruta_la !== null && await jurnal('anulat') === 1, 'anulat: confirmarea copiată din cerere (motiv, cine), cererea păstrată ca istoric')
  ok(await cod(db.query(`UPDATE public.red_fan_awb SET anulat_de = $2 WHERE id = $1`, [a1.id, ID.owner])) === '42501', 'confirmarea imuabilă după scriere')
  ok(await cereP(ID.editor, 2, 'netiparit_3_zile') === 'OK' && (await srv(db, 'SELECT public.fn_red_fan_srv_anuleaza($1, $2, $3, $4) AS r', [ID.editor, await idA(2), (await rand(2)).awb, 'refuzat_ridicat'])).rows[0].r === 'refuzat_ridicat'
    && (await rand(2)).stare === 'generat' && (await rand(2)).anulare_ceruta_la === null && (await rand(2)).anulare_ceruta_motiv === null && await jurnal('anulare_golita') === 1, 'refuzat_ridicat: cele patru coloane ale cererii → NULL împreună, rândul generat')
  ok(await cereP(ID.editor, 3, 'alt_motiv', 'plic rupt') === 'OK' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [await idA(3), (await rand(3)).awb, 'verificat'])) === '42501', 'fn_red_fan_anulat (clasa C) ca operator → 42501')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [await idA(3), (await rand(3)).awb, 'verificat in selfAWB'])) === 'OK' && (await toate(3)).at(-1).motiv_anulare === 'alt_motiv' && (await toate(3)).at(-1).anulare_nota === 'plic rupt' && (await toate(3)).at(-1).anulat_de === ID.owner,
    'D18: fn_red_fan_anulat (owner) pe un rând cu cerere deschisă → anulat cu motivul și nota cerute')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_anulat($1, $2, $3)', [await idA(4), (await rand(4)).awb, 'sters in selfAWB, verificat'])) === 'OK' && (await toate(4)).at(-1).motiv_anulare === 'alt_motiv' && (await toate(4)).at(-1).anulare_nota === 'sters in selfAWB, verificat',
    'fn_red_fan_anulat fără cerere → alt_motiv + nota = textul vechi')
  ok((await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.v_red_fan_anulari')).rows[0].n === 3 && (await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.v_red_fan_anulari WHERE foaie_tiparita IS NULL')).rows[0].n === 3, 'v_red_fan_anulari: 3 anulări, „avea foaia tipărită” = NULL (necunoscut până la F1b)')

  // ── J. E22 variantele 6 / 7 (o sesiune): plic mutat cu rând de_aprobat pe lotul vechi; plic mutat cu rând propus pe lotul vechi ──
  const c20 = await cmd(ID.editor, ID.L3, K(20), pl([16]))
  ok(c20.aprobate.length === 1, 'L3: plicul 16 aprobat (K20)')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(20)])
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 0)) === 'OK', 'limita 0')
  // plicul 15 (propus pe L2) → de_aprobat pe L2 prin K21 (peste plafon), apoi mutat în L3
  const c21 = await cmd(ID.editor, ID.L2, K(21), pl([15]))
  ok(c21.de_aprobat === 1, 'K21: plicul 15 de_aprobat pe L2 (cerere deschisă)')
  await db.query(`UPDATE public.red_plicuri SET lot_id = $2 WHERE id = $1`, [plicId(15), ID.L3])
  const c22 = await cmd(ID.editor, ID.L3, K(22), pl([15, 16]))
  ok(c22.excluse.some(x => x.motiv_cod === 'in_asteptare_aprobare') && c22.preluate === 1 && (await rand(15)).lot_id === ID.L2 && (await rand(15)).stare === 'de_aprobat' && (await cereri(ID.L2)).find(c => c.stare === 'deschisa'),
    'E22 v7: plicul mutat cu rând de_aprobat pe lotul vechi → exclus in_asteptare_aprobare; cererea lotului vechi neatinsă; 16 preluat')
  const cer21 = (await cereri(ID.L2)).find(c => c.stare === 'deschisa')
  const dec21 = (await ca(db, ID.owner, 'SELECT public.fn_red_fan_cerere_decide($1, true, NULL) AS r', [cer21.id])).rows[0].r
  ok(dec21.retrase === 1 && dec21.aprobate === 0 && (await toate(15)).at(-1).stare === 'retras' && (await toate(15)).at(-1).motiv_retragere === 'plic_mutat', 'decizia pe lotul vechi: rândul plicului mutat → retras (plic_mutat)')
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(22)])
  ok(await cod(setare(ID.owner, 'fn_red_fan_setari_limita_zi', 20)) === 'OK', 'limita 20')
  const c23 = await cmd(ID.editor, ID.L3, K(23), pl([15, 16]))
  ok(c23.aprobate.length === 1 && c23.numarate === 1 && (await rand(15)).lot_id === ID.L3 && (await rand(15)).stare === 'aprobat', 'după retragere: plicul 15 primește rând nou pe L3 (numărat), un singur rând viu pe plic')
  // v6/v5: rând propus pe lotul vechi (propune de owner pe L3 pentru 16? 16 e aprobat) → folosim plicul 13? e generat. Plicul 2 (generat). Plicul 5: generat. Plicul 6: eroare pe L1 tipărit → nou rând pe L2 (mutat)
  await db.query(`UPDATE public.red_plicuri SET lot_id = $2 WHERE id = $1`, [plicId(6), ID.L2])
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_propune($1, $2, NULL)', [plicId(6), HX('e')])) === 'OK' && (await rand(6)).lot_id === ID.L2, 'plicul 6 mutat în L2 și propus acolo (rând propus pe L2)')
  await db.query(`UPDATE public.red_plicuri SET lot_id = $2 WHERE id = $1`, [plicId(6), ID.L3])
  await db.query(`UPDATE public.red_fan_intentii SET lucru_pana_la = clock_timestamp() - interval '1 minute' WHERE cheie = $1`, [K(23)])
  const c24 = await cmd(ID.editor, ID.L3, K(24), pl([6], HX('e')))
  ok(c24.aprobate.length === 1 && (await rand(6)).lot_id === ID.L3 && (await rand(6)).stare === 'aprobat' && (await db.query(`SELECT count(*)::int AS n FROM public.red_fan_awb WHERE plic_id = $1 AND stare NOT IN ('eroare','anulat','retras')`, [plicId(6)])).rows[0].n === 1,
    'E22 v5: rândul propus rămas pe lotul vechi al unui plic mutat e REFOLOSIT și realiniat (lot_id = lotul nou), un singur rând viu')
  ok((await ca(db, ID.editor, 'SELECT limita_zi, aprobate, incap FROM public.v_red_fan_plafon_azi')).rows[0].incap === 20 - (await zi())[0].aprobate, 'v_red_fan_plafon_azi (editor, RLS): „cât mai încape” = limita − aprobate azi')
  ok((await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.v_red_fan_intentii WHERE stare = $1 AND lot_id = $2', ['in_curs', ID.L3])).rows[0].n === 1
    && (await ca(db, ID.editor, 'SELECT count(*)::int AS n FROM public.v_red_fan_intentii WHERE stare = $1', ['in_curs'])).rows[0].n === 2
    && (await ca(db, ID.viewer, 'SELECT count(*)::int AS n FROM public.v_red_fan_intentii')).rows[0].n === 0, 'v_red_fan_intentii: o intenție in_curs pe L3 (K24), două în total (K18 pe lotul real, neîncheiată); viewer-ul nu vede nimic')

  // ── K. clasa C ca operator; scrieri directe; anonim ──
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_aproba($1, $2, $3)', [ID.L3, [(await rand(6)).id], [HX('e')]])) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_lot_marcheaza($1, true)', [ID.L3])) === '42501'
    && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_reconciliaza($1, NULL, NULL, NULL, $2)', [(await rand(6)).id, 'x'])) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_setari_seteaza(3)')) === '42501',
    'clasa C / owner ca operator ne-owner: aproba, lot_marcheaza, reconciliaza, setari_seteaza → 42501')
  ok(await cod(ca(db, ID.editor, `UPDATE public.red_fan_awb SET motiv = 'x' WHERE id = $1`, [(await rand(6)).id])) === '42501' && await cod(ca(db, ID.editor, `UPDATE public.red_fan_intentii SET stare = 'incheiata'`)) === '42501'
    && await cod(ca(db, ID.editor, `INSERT INTO public.red_fan_cereri_aprobare (id, lot_id, proiect_id, cerut_de, cerut_la, intentie, n, zi_ro) VALUES (gen_random_uuid(), '${ID.L3}', '${ID.proiect}', '${ID.editor}', now(), gen_random_uuid(), 1, current_date)`)) === '42501',
    'PATCH / INSERT direct pe tabelele FAN ca operator → 42501')
  ok(await cod(ca(db, null, 'SELECT public.fn_red_fan_comanda($1, $2, $3::jsonb, $4, $5)', [ID.L3, K(30), '[]', HX('c'), false])) === '42501' && await cod(ca(db, null, 'SELECT public.fn_red_fan_e_operator()')) === '42501', 'anonim: comanda / e_operator → 42501 (fără EXECUTE)')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_lot_permis($1)', [ID.L3])) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_lot_incheiat($1)', [ID.L3])) === '42501' && await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_claim_intern($1,$2,$3,$4,$5,$6,$7)', [ID.L3, [], [], [], null, null, false])) === '42501',
    'funcțiile interne nu sunt apelabile din API')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, false, NULL)', [ID.editor])) === 'OK' && await cod(comanda(ID.editor, ID.L3, K(31), pl([6], HX('e')))) === '42501', 'E18: operatorul retras → comanda nouă 42501')
  ok(await cod(srv(db, 'SELECT public.fn_red_fan_srv_intentie_incheie($1, $2, $3::jsonb)', [ID.editor, K(24), '{}'])) === 'OK' && (await val(db, `SELECT count(*)::int AS n FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = 'intentie_incheiata' AND (date_noi ->> 'operator_retras')::boolean`)).n === 1,
    'E18: încheierea intenției operatorului retras trece (banii cheltuiți), cu jurnal „operator retras”')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.editor])) === 'OK', 'operatorul re-numit')
  return fail
}

// ─── runda 2 pe #1136 (re-bazarea pe 20261227a): alegerea oPOD în comandă (RD038), pe un lot nou, fără alte urme; rulează după verificari (și pe mutanți) ───
// Așteptările din regula scrisă (spec + migrarea 20261227a), nu din cod: hash-urile se calculează cu alegerea lotului; altă alegere = nimic scris.
async function verificariOpod(db, log, fail = []) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const L5 = '20000000-0000-4000-8000-000000000005'
  await db.exec(`RESET ROLE; INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${L5}', '${ID.proiect}', 'PP-0005');
    INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES ('${plicId(18)}', '${ID.proiect}', '${L5}', '${nrPlic(18)}', 'PERSOANA 18', 'activ');`)
  if ((await ca(db, ID.editor, 'SELECT public.fn_red_fan_e_operator() AS e')).rows[0].e !== true) await ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.editor])
  const cmd = (k, opod) => ca(db, ID.editor, 'SELECT public.fn_red_fan_comanda($1, $2, $3::jsonb, $4, $5) AS r', [L5, k, JSON.stringify([{ plic_id: plicId(18), hash: HX('b') }]), HX('d'), opod])
  const stare = async () => [await sha(db, 'red_fan_awb'), await sha(db, 'red_fan_loturi'), await sha(db, 'red_fan_intentii'), await sha(db, 'red_jurnal'), await sha(db, 'red_fan_zi'), await sha(db, 'red_fan_cereri_aprobare')].join()
  const s0 = await stare()
  ok(await cod(cmd(K(90), true)) === 'RD038' && await stare() === s0, 'RD038: lot NEMARCAT (marcajul automat = fără oPOD) + hash-uri calculate CU oPOD → refuz, nimic scris (rânduri, marcaj, intenție, jurnal, zi, cereri)')
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_marcheaza($1, true)', [L5])) === 'OK' && await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_opod($1, true)', [L5])) === 'OK',
    'owner: lotul marcat TEST, apoi oPOD cerut (fn_red_fan_lot_opod din 20261227a, înainte de prima aprobare)')
  const s1 = await stare()
  ok(await cod(cmd(K(91), false)) === 'RD038' && await stare() === s1, 'RD038: lotul cere oPOD, hash-urile calculate FĂRĂ oPOD → refuz, nimic scris')
  let r = null; try { r = (await cmd(K(92), true)).rows[0].r } catch (e) { r = { eroare: e.code || e.message } }
  const rd = await val(db, `SELECT stare, intentie_cheie FROM public.red_fan_awb WHERE plic_id = $1 AND stare NOT IN ('eroare', 'anulat', 'retras')`, [plicId(18)])
  ok(r?.replay === false && ['aprobat', 'de_aprobat'].includes(rd?.stare) && rd.intentie_cheie === K(92), `aceeași alegere (lotul cu oPOD, p_opod = true) → comanda trece: ${JSON.stringify({ mod: r?.mod, eroare: r?.eroare, stare: rd?.stare })}`)
  ok(await cod(ca(db, ID.owner, 'SELECT public.fn_red_fan_lot_opod($1, false)', [L5])) === 'P0001', 'după comandă (rândul aprobat / de_aprobat) alegerea oPOD nu se mai schimbă (fn_red_fan_lot_opod din 20261227a, neschimbată)')
  const ev = await val(db, `SELECT count(*)::int AS n FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND date_noi ->> 'eveniment' IN ('opod_aprobare', 'opod_folosire')
    AND date_noi ->> 'lot_id' = $1 AND (date_noi ->> 'opod')::boolean`, [L5])
  ok(ev.n >= 1, `trigger-ul de jurnal al 20261227a rulează și în scrierile comenzii F1 (${ev.n} evenimente cu opod = true pe lot)`)
  return fail
}

// ─── runda 4 pe #1136 (proba pe clonă): marcajul gărzii scris cu SET LOCAL (numele exact al funcției, golit după UPDATE), primul eveniment oPOD
// al unui lot nemarcat, autorul evenimentelor clasei B. Rulează după verificariOpod (și pe mutanți). Așteptările: raportul probei pe clonă + regula
// scrisă în migrare (listele trigger-ului), nu codul testat.
async function verificariR4(db, log, fail = []) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const L6 = '20000000-0000-4000-8000-000000000006'
  await db.exec(`RESET ROLE; INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${L6}', '${ID.proiect}', 'PP-0006');
    INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
      ${[19, 20, 21].map(n => `('${plicId(n)}', '${ID.proiect}', '${L6}', '${nrPlic(n)}', 'PERSOANA ${n}', 'activ')`).join(', ')};
    INSERT INTO public.red_detinatori (id, nume) VALUES ${[19, 20, 21].map(n => `('${detId(n)}', 'D${n}')`).join(', ')};
    INSERT INTO public.red_detinatori_contact (detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal) VALUES
      ${[19, 20, 21].map(n => `('${detId(n)}', '07000000${n}', 'Str. Fictiva ${n}', 'Sat', 'Comuna', 'Prahova', '100000')`).join(', ')};
    INSERT INTO public.red_convocari (detinator_id, plic_id, stare, sters_la) VALUES ${[19, 20, 21].map(n => `('${detId(n)}', '${plicId(n)}', 'activ', NULL)`).join(', ')};`)
  if ((await ca(db, ID.editor, 'SELECT public.fn_red_fan_e_operator() AS e')).rows[0].e !== true) await ca(db, ID.owner, 'SELECT public.fn_red_fan_operator_seteaza($1, true, NULL)', [ID.editor])
  await ca(db, ID.owner, 'SELECT public.fn_red_fan_setari_limita_zi(500)')
  const viu = async n => val(db, `SELECT * FROM public.red_fan_awb WHERE plic_id = $1 AND stare NOT IN ('eroare', 'anulat', 'retras')`, [plicId(n)])
  const evRand = async id => (await db.query(`SELECT date_noi, user_id FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND inregistrare_id = $1
                                               AND date_noi ->> 'eveniment' IN ('opod_aprobare', 'opod_folosire') ORDER BY id`, [id])).rows
  // (observația 1) comanda pe un lot NEMARCAT: marcajul automat înaintea rândului → primul eveniment are opod = false, nu NULL
  ok(!(await val(db, 'SELECT 1 AS x FROM public.red_fan_loturi WHERE lot_id = $1', [L6])), 'R4: lotul L6 nu e marcat înainte de comandă')
  let c = null; try { c = (await ca(db, ID.editor, 'SELECT public.fn_red_fan_comanda($1, $2, $3::jsonb, $4, $5) AS r', [L6, K(95), JSON.stringify([{ plic_id: plicId(19), hash: HX('f') }]), HX('e'), false])).rows[0].r } catch (e) { c = { eroare: e.code || e.message } }
  const r19 = await viu(19)
  ok(c?.marcaj_automat === true && r19?.stare === 'aprobat', `R4: comanda pe lotul nemarcat: marcaj automat + rândul aprobat (${JSON.stringify({ m: c?.marcaj_automat, e: c?.eroare, s: r19?.stare })})`)
  const ev19 = r19 ? await evRand(r19.id) : []
  ok(ev19.length >= 1 && ev19[0].date_noi.opod === false && ev19.every(e => e.date_noi.opod === false) && ev19[0].user_id === ID.editor,
    `R4 (observația 1): primul eveniment oPOD al rândului are opod = false (nu NULL), autorul = operatorul: ${JSON.stringify(ev19.map(e => [e.date_noi.eveniment, e.date_noi.opod, e.user_id === ID.editor]))}`)
  // (observația 2, justificată) clasa B: autorul evenimentului oPOD = auth.uid() (NULL sub service_role, L08); persoana = p_actor în evenimentul claim
  const s19 = (await val(db, 'SELECT public.fn_red_fan_surse($1) AS s', [plicId(19)])).s
  let cl = null; try { cl = (await srv(db, 'SELECT public.fn_red_fan_srv_claim($1, $2, $3, $4, $5, $6) AS r', [ID.editor, K(95), L6, [r19?.id], [HX('f')], [s19]])).rows[0].r } catch (e) { cl = { eroare: e.code || e.message } }
  const ev19b = r19 ? (await evRand(r19.id)).filter(e => e.date_noi.in === 'in_curs') : []
  const evCl = await val(db, `SELECT date_noi, user_id FROM public.red_jurnal WHERE tabela = 'red_fan_intentii' AND inregistrare_id = $1 AND date_noi ->> 'eveniment' = 'claim' ORDER BY id DESC LIMIT 1`, [K(95)])
  ok(!cl?.eroare && ev19b.length === 1 && ev19b[0].user_id === null && ev19b[0].date_noi.opod === false && evCl?.date_noi?.actor === ID.editor,
    `R4 (observația 2): clasa B: evenimentul oPOD al rezervării are autorul NULL (service_role, fără om în sesiune), iar operatorul verificat e „actor” în evenimentul claim: ${JSON.stringify({ e: cl?.eroare, n: ev19b.length, u: ev19b[0]?.user_id, a: evCl?.date_noi?.actor === ID.editor })}`)
  // marcajul gărzii: numele EXACT al funcției, golit după UPDATE (SET LOCAL static)
  for (const n of [20, 21]) await ca(db, ID.owner, 'SELECT public.fn_red_fan_propune($1, $2, NULL)', [plicId(n), HX('9')])
  const id20 = (await viu(20))?.id, id21 = (await viu(21))?.id
  const retrDirect = id => `UPDATE public.red_fan_awb SET stare = 'retras', retras_de = '${ID.editor}', retras_la = now(), motiv_retragere = 'operator', updated_at = now() WHERE id = '${id}';`
  const tx = async sql => { try { await db.exec(sql); return 'OK' } catch (e) { await db.exec('ROLLBACK').catch(() => {}); return e.code || String(e.message).slice(0, 60) } finally { await db.exec('RESET ROLE').catch(() => {}) } }
  ok(id20 && id21 && (await viu(20)).stare === 'propus' && (await viu(21)).stare === 'propus', 'R4: plicurile 20 și 21 propuse pe L6 (owner, calea veche)')
  ok(await tx(`BEGIN; SET LOCAL redari_fan.garda = 'fn_red_fan_anulare_cere'; ${retrDirect(id21)} COMMIT;`) === '42501' && (await viu(21)).stare === 'propus',
    'R4: marcajul ALTEI funcții (anulare_cere) nu deschide lista retragerii → 42501 (trigger), nimic scris')
  ok(await tx(`BEGIN; SET LOCAL redari_fan.garda = 'fn_red_fan_retrage:${id21}'; ${retrDirect(id21)} COMMIT;`) === '42501' && (await viu(21)).stare === 'propus',
    'R4: forma veche a marcajului („funcție:id”) nu mai e recunoscută → 42501 (comparația e pe numele exact)')
  ok(await tx(`BEGIN; SET LOCAL redari_fan.garda = 'fn_red_fan_retrage'; ${retrDirect(id21)} ROLLBACK;`) === 'OK' && (await viu(21)).stare === 'propus',
    'R4: martor: numele exact al unei funcții de pe lista (c) trece de trigger (tranzacția anulată, nimic scris)')
  ok(await tx(`BEGIN; SELECT set_config('request.jwt.claim.sub', '${ID.editor}', true); SET LOCAL ROLE authenticated; SELECT public.fn_red_fan_retrage('${id20}', 'operator'); RESET ROLE; ${retrDirect(id21)} COMMIT;`) === '42501'
     && (await viu(20))?.stare === 'propus' && (await viu(21)).stare === 'propus',
    'R4: după fn_red_fan_retrage, în ACEEAȘI tranzacție, marcajul e golit: un UPDATE direct pe alt rând → 42501 (toată tranzacția anulată)')
  ok(await cod(ca(db, ID.editor, 'SELECT public.fn_red_fan_retrage($1, $2)', [id20, 'operator'])) === 'OK' && (await val(db, 'SELECT stare FROM public.red_fan_awb WHERE id = $1', [id20])).stare === 'retras'
     && (await val(db, `SELECT coalesce(current_setting('redari_fan.garda', true), '') AS m`)).m === '', 'R4: calea legitimă (operatorul retrage plicul 20) trece; după ea marcajul sesiunii e gol')
  return fail
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) peste 20261212a + 20261227a + comportamentul')
{
  const db = await bazaVeche()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G0 = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, OBIECTE_CALE),
    '# 20261228a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase); baza = 20261212a + 20261227a aplicate\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G0 && gener.length > 100 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.slice(0, 5).join(' | ')}] în plus [${plus.slice(0, 5).join(' | ')}]`)
  const FMANIFEST = join(TMP, '20261228a_redari_fan_operator.l15.tsv')
  writeFileSync(FMANIFEST, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G0, manifest: FMANIFEST, final: garda('20261228a_redari_fan_operator', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /^PLAFON_TIMP 20261228a_redari_fan_operator: garda trecuta/.test(m)) && j.some(m => /^LOCK_TINUT /.test(m)),
    'livrarea aprobată: diferența = manifestul; garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT): ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  const f = []
  try { await verificari(db, true, f) } catch (e) { ok(false, `excepție în verificări: ${e.code || ''} ${String(e.message).slice(0, 200)}`) }
  console.log('1b. alegerea oPOD în comandă (RD038; baza 20261227a)')
  try { await verificariOpod(db, true, f) } catch (e) { ok(false, `excepție în verificările oPOD: ${e.code || ''} ${String(e.message).slice(0, 200)}`) }
  console.log('1c. runda 4: marcajul gărzii (SET LOCAL), primul eveniment oPOD pe lot nemarcat, autorul clasei B')
  try { await verificariR4(db, true, f) } catch (e) { ok(false, `excepție în verificările rundei 4: ${e.code || ''} ${String(e.message).slice(0, 200)}`) }
  esec += f.length
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista operatori numiti/.test(m || ''), 'revenirea refuză cu date (operatori): ' + m)
  await db.close()
}

console.log('2. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['fără amprenta globală L15 v2', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['o funcție fn_red_fan_* străină (22 în loc de 21)', async db => { await db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`); return aplicaMig(db) }, /numarul functiilor fn_red_fan_\* nu e 21/],
  ['garda loturilor în forma VECHE (20261212a, fără opod)', async db => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`); return aplicaMig(db) }, /lantul \(inainte\) difera.*fn_red_fan_loturi_garda/],
  ['trigger-ul de jurnal 20261227a scos de pe red_fan_awb', async db => { await db.exec(`DROP TRIGGER trg_red_fan_awb_opod_jurnal ON public.red_fan_awb;`); return aplicaMig(db) }, /nu are exact trigger-ul de jurnal din 20261227a/],
  ['o funcție veche cu alt corp (lanțul înainte)', async db => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_e_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`); return aplicaMig(db) }, /lantul \(inainte\) difera.*fn_red_fan_e_owner/],
  ['un trigger străin pe red_fan_awb', async db => { await db.exec(`CREATE TRIGGER t_x BEFORE UPDATE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_loturi_garda();`); return aplicaMig(db) }, /nu are exact trigger-ul de jurnal din 20261227a/],
]) {
  const db = await bazaVeche()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const gol = (await val(db, `SELECT to_regclass('public.red_fan_operatori') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_red_fan_comanda') AS g`)).g
  ok(re.test(m || '') && gol, `${nume}: ${m}`)
  await db.close()
}
{
  const db = new PGlite(); await db.exec(SCHELET); await db.exec(NIVEL)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/20261212a nu e aplicata/.test(m || ''), 'fără 20261212a: ' + m)
  await db.close()
}
{
  const db = await bazaVeche({ cuOpod: false })
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  const gol = (await val(db, `SELECT to_regclass('public.red_fan_operatori') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_red_fan_comanda') AS g`)).g
  ok(/20261227a \(oPOD\) nu e aplicata/.test(m || '') && gol, 'fără 20261227a (doar 20261212a): ' + m)
  await db.close()
}

console.log('3. revenirea (prin runner, plafonul 2000): refuz la fiecare urmă; aplicare → revenire → re-aplicare')
const K1 = '70000000-0000-4000-8000-000000000001'
const pregLim = async (db, n) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_setari_limita_zi(${n});`)
for (const [nume, pregateste, re] of [
  ['operator numit', db => db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_operator_seteaza('${ID.editor}', true, NULL);`), /exista operatori numiti/],
  ['limita zilei schimbată', db => pregLim(db, 7), /setarile noi au fost schimbate/],
  ['presupunerea P429 oprită', db => db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_setari_presupunere_429(false, 'x');`), /setarile noi au fost schimbate/],
  ['un rând de_aprobat (comandă peste plafon)', async db => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_operator_seteaza('${ID.editor}', true, NULL); SELECT public.fn_red_fan_setari_limita_zi(0);`)
    await ca(db, ID.editor, 'SELECT public.fn_red_fan_comanda($1, $2, $3::jsonb, $4, $5)', [ID.L1, K1, JSON.stringify([{ plic_id: plicId(1), hash: HX('a') }]), HX('c'), false])
    await db.exec(`DELETE FROM public.red_fan_operatori; UPDATE public.red_fan_setari SET limita_zi = 20;`)   // rămân: rândul, cererea, intenția, jurnalul
  }, /exista cereri de aprobare|red_fan_awb are randuri scrise|exista intentii|evenimente ale fluxului nou/],
  ['un eveniment nou în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_intentii', '${K1}', 'insert', '{"eveniment":"comanda"}');`), /evenimente ale fluxului nou/],
  ['o funcție fn_red_fan_* în plus', db => db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`), /functii: (public\.)?fn_red_fan_alta\(\)/],
]) {
  const db = await bazaNoua()
  await pregateste(db)
  let m = null
  try { await revino(db) } catch (e) { m = e.message }
  ok(re.test(m || '') && (await val(db, `SELECT to_regclass('public.red_fan_operatori') IS NOT NULL AS e`)).e, `revenirea refuză: ${nume}: ${m}`)
  await db.close()
}
{
  const db = await bazaNoua()
  let m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcajul runnerului: ' + m)
  m = null; try { await revino(db, REV, { plafon: 5000 }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa: 5000/.test(m || ''), 'revenirea cu plafonul livrărilor: ' + m)
  const db2 = await bazaVeche(); let m2 = null; try { await revino(db2) } catch (e) { m2 = e.message }
  ok(/starea nu e cea din 20261228a/.test(m2 || ''), 'revenirea pe o bază fără 20261228a: refuzul gărzii (to_regclass / to_regprocedure), nu eroare de cast: ' + m2)
  await db2.close()
  const j = await revino(db)
  ok(j.some(x => /revenire: sfarsit la \d+ ms/.test(x)), 'revenirea pe aplicarea curată trece (amprentele vechi verificate în postcondiție)')
  ok((await val(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn_red_fan_%'`)).n === 21 && (await val(db, `SELECT to_regclass('public.red_fan_intentii') IS NULL AS e`)).e
    && (await val(db, `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'red_fan_awb' AND column_name LIKE 'anul%'`)).n === 0
    && (await val(db, `SELECT array_agg(tgname::text ORDER BY tgname) AS t FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal`)).t.join() === 'trg_red_fan_awb_opod_jurnal',
    'după revenire: 21 de funcții (baza 20261212a + 20261227a), fără tabele / coloane noi; pe red_fan_awb rămâne doar jurnalul oPOD')
  m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(m === null, 're-aplicarea după revenire trece' + (m ? ': ' + m : ''))
  let f2 = []
  try { await verificari(db, false, f2); await verificariOpod(db, false, f2); await verificariR4(db, false, f2) } catch (e) { f2.push('excepție: ' + (e.code || e.message)) }
  ok(f2.length === 0, 'comportamentul identic după re-aplicare' + (f2[0] ? ': ' + f2[0].slice(0, 120) : ''))
  await db.close()
}

console.log('4. mutanți (fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['P6: decizia plafonului sare ramura „zi absentă”', 'v_peste := v_n_cnt > 0 AND v_acum + v_n_cnt > v_set.limita_zi;', 'v_peste := v_n_cnt > 0 AND v_acum > 0 AND v_acum + v_n_cnt > v_set.limita_zi;'],
  ['P13: aprobarea restrânsă la N (rândurile din A \\ N rămân propus)', "   WHERE a.id = x.rand_id AND a.id = ANY (v_a);", "   WHERE a.id = x.rand_id AND a.id = ANY (v_n);"],
  ['I14: replay-ul verificat după scrieri (fără RETURN în faza V)', "    IF v_int.stare = 'incheiata' THEN\n      RETURN jsonb_build_object('intentie', p_intentie, 'replay', true,", "    IF false THEN\n      RETURN jsonb_build_object('intentie', p_intentie, 'replay', true,"],
  ['P2-1: răspunsul raportează mulțimea candidată, nu efectivul', "'aprobate', CASE WHEN v_peste THEN '[]'::jsonb ELSE to_jsonb(v_a) END, 'numarate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_n) END,", "'aprobate', to_jsonb(v_a), 'numarate', cardinality(v_n),"],
  ['P2-2: partea aprobată pleacă înaintea deciziei (fără excluderea in_asteptare_aprobare)', "    ELSIF r.rand_stare = 'aprobat' AND v_cer.id IS NOT NULL AND r.rand_intentie IS NOT DISTINCT FROM v_cer.intentie THEN", "    ELSIF false THEN"],
  ['Q2 A: peste plafon rândurile aprobat pleacă totuși', '  IF NOT v_peste THEN v_trimis := v_a || v_deja; END IF;', '  v_trimis := v_a || v_deja;'],
  ['consumul scris și pe ramura peste plafon', '  IF NOT v_peste AND cardinality(v_n) > 0 THEN\n    INSERT INTO public.red_fan_zi', '  IF cardinality(v_n) > 0 THEN\n    INSERT INTO public.red_fan_zi'],
  ['P429: starea nu citește presupunerea (mereu aprobat)', "v_stare_429 := CASE WHEN v_p429 IS TRUE THEN 'aprobat' ELSE 'necunoscut' END;", "v_stare_429 := 'aprobat';"],
  ['trigger: fn_red_fan_anulare_cere pe lista confirmării', "IF v_fn NOT IN ('fn_red_fan_srv_anuleaza', 'fn_red_fan_anulat') OR NEW.stare <> 'anulat'", "IF v_fn NOT IN ('fn_red_fan_srv_anuleaza', 'fn_red_fan_anulat', 'fn_red_fan_anulare_cere') OR NEW.stare <> 'anulat'"],
  ['trigger: motivul cerut se poate schimba cât cererea e deschisă', "      RAISE EXCEPTION 'redari fan: schimbarea neautorizata a cererii de anulare e refuzata' USING ERRCODE = '42501';", "      NULL;"],
  ['clasa B deschisă omului (auth.uid() neverificat)', "  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: inscrierea rezultatelor externe nu e apelabila de un om' USING ERRCODE = '42501'; END IF;", ''],
  ['garda doar TEST pe valori ignorată de comandă', "  IF NOT public.fn_red_fan_lot_permis_valori(v_test, v_cod, v_set.doar_proiecte_test) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;\n  v_tiparit", '  v_tiparit'],
  ['RD038 scos (comanda aprobă hash-uri calculate cu altă alegere oPOD decât a lotului)', "  IF coalesce(v_fl.opod, false) IS DISTINCT FROM p_opod THEN", '  IF false THEN'],
  ['RD038 cu lotul nemarcat socotit „cu oPOD”', "  IF coalesce(v_fl.opod, false) IS DISTINCT FROM p_opod THEN", '  IF coalesce(v_fl.opod, true) IS DISTINCT FROM p_opod THEN'],
  ['RD031 scos din tiraj',"      IF NOT public.fn_red_fan_lot_incheiat(p_lot_id) THEN", '      IF false THEN'],
  ['RD033 scos (reluarea peste rânduri nelămurite)', "  IF v_cheie_veche IS NOT NULL AND EXISTS (SELECT 1 FROM public.red_fan_awb WHERE intentie_cheie = v_cheie_veche AND stare IN ('in_curs', 'necunoscut')) THEN", '  IF false THEN'],
  ['e_operator fără rândul din listă (orice editor trimite)', "          AND EXISTS (SELECT 1 FROM public.red_fan_operatori o WHERE o.profile_id = auth.uid() AND o.retras_la IS NULL));", ');'],
  ['decizia owner-ului consumă plafonul? (aprobarea cererii scrie în zi)', "    UPDATE public.red_fan_loturi SET prima_aprobare_la = v_now, prima_aprobare_de = auth.uid() WHERE lot_id = v_c.lot_id AND prima_aprobare_la IS NULL;\n  END IF;\n  UPDATE public.red_fan_cereri_aprobare",
    "    UPDATE public.red_fan_loturi SET prima_aprobare_la = v_now, prima_aprobare_de = auth.uid() WHERE lot_id = v_c.lot_id AND prima_aprobare_la IS NULL;\n  END IF;\n  INSERT INTO public.red_fan_zi (zi_ro, aprobate) VALUES ((clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date, v_aprobate) ON CONFLICT (zi_ro) DO UPDATE SET aprobate = red_fan_zi.aprobate + v_aprobate;\n  UPDATE public.red_fan_cereri_aprobare"],
  ['retragerea restituie plafonul', "  IF TG_OP = 'UPDATE' AND (NEW.aprobate < OLD.aprobate OR NEW.zi_ro IS DISTINCT FROM OLD.zi_ro) THEN", "  IF TG_OP = 'UPDATE' AND (false OR NEW.zi_ro IS DISTINCT FROM OLD.zi_ro) THEN",
    "  UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, motiv_retragere = p_motiv_cod, updated_at = v_now WHERE id = p_id;\n  SET LOCAL redari_fan.garda = '';",
    "  UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, motiv_retragere = p_motiv_cod, updated_at = v_now WHERE id = p_id;\n  SET LOCAL redari_fan.garda = '';\n  UPDATE public.red_fan_zi SET aprobate = aprobate - 1 WHERE aprobate > 0;"],
  // runda 4: marcajul automat mutat înapoi DUPĂ scrierile pe rânduri (forma c75cc2ad) → primul eveniment oPOD are opod NULL
  ['R4: marcajul automat după scrierile pe rânduri (opod NULL în primul eveniment)',
    "  IF v_fl.lot_id IS NULL THEN\n    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, v_test, v_uid);\n    v_marcaj := true;\n  END IF;\n  -- (3) retragerile", '  -- (3) retragerile',
    '  -- (4) prima aprobare (marcajul automat e la începutul fazei M)\n', "  IF v_fl.lot_id IS NULL THEN\n    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, v_test, v_uid);\n    v_marcaj := true;\n  END IF;\n"],
  // runda 4: trigger-ul primește marcajul altei funcții (lista (c) lărgită) — garda nu mai e pe numele exact
  ['R4: fn_red_fan_retrage nu mai golește marcajul după UPDATE',
    "  UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, motiv_retragere = p_motiv_cod, updated_at = v_now WHERE id = p_id;\n  SET LOCAL redari_fan.garda = '';",
    "  UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, motiv_retragere = p_motiv_cod, updated_at = v_now WHERE id = p_id;"],
  ['R4: o a 8-a funcție scrie marcajul (cerere_retrage se dă drept fn_red_fan_retrage)',
    "  v_now := clock_timestamp();\n  UPDATE public.red_fan_awb SET stare = 'propus', aprobat_de = NULL, aprobat_la = NULL, updated_at = v_now WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat';",
    "  v_now := clock_timestamp();\n  SET LOCAL redari_fan.garda = 'fn_red_fan_retrage';\n  UPDATE public.red_fan_awb SET stare = 'propus', aprobat_de = NULL, aprobat_la = NULL, updated_at = v_now WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat';"],
  ['R4: trigger-ul acceptă orice marcaj nevid pe lista retragerii', "    IF v_fn NOT IN ('fn_red_fan_comanda', 'fn_red_fan_retrage', 'fn_red_fan_cerere_decide', 'fn_red_fan_srv_claim') OR NEW.stare <> 'retras'",
    "    IF v_fn = '' OR NEW.stare <> 'retras'"],
]
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = aplica(MIG, lista) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată: ${e.message}`); continue }
  // postcondiția amprentelor NOI cade pe textul mutat: se scoate din postcondiție DOAR comparația de corp (restul rămâne)
  m = m.replace("      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta\n      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)\n      OR p.prosecdef IS DISTINCT FROM a.definer\n      OR p.provolatile IS DISTINCT FROM a.volatil\n      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid\n      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']\n      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'\n      OR has_function_privilege('anon', p.oid, 'EXECUTE')\n      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth",
    "      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)\n      OR p.prosecdef IS DISTINCT FROM a.definer\n      OR p.provolatile IS DISTINCT FROM a.volatil\n      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid\n      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']\n      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'\n      OR has_function_privilege('anon', p.oid, 'EXECUTE')\n      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth")
  const f = []
  let db = null
  try { db = await bazaVeche(); await aplicaMig(db, m); await verificari(db, false, f); await verificariOpod(db, false, f); await verificariR4(db, false, f) } catch (e) { f.push('excepție la aplicare / verificare: ' + (e.code || e.message)) }
  finally { if (db) await db.close() }
  ok(f.length > 0, `mutant „${nume}” prins (${f.length} verificări picate${f[0] ? ': ' + f[0].slice(0, 110) : ''})`)
}

console.log('5. paritatea gărzii „doar TEST”: SQL (fn_red_fan_lot_permis_valori) = JS (transportPermis / esteProiectTest) pe același tabel de cazuri (L19)')
{
  const db = await bazaNoua()
  const CAZURI = [['TEST-RAZVAN', true], ['TEST-RAZVAN', false], ['test-razvan', true], [' TEST-X', true], ['TESTARE', true], ['LOT1-X', true], ['', true], [null, true], ['TEST-', true]]
  let egale = 0
  for (const [cod, test] of CAZURI) {
    const sql = (await val(db, 'SELECT public.fn_red_fan_lot_permis_valori($1, $2, true) AS p', [test, cod])).p
    const js = H.transportPermis({ proiectCod: cod, fanLot: { test }, cereMarcaj: true }).ok
    if (sql === js) egale++; else console.log(`     ${JSON.stringify([cod, test])}: SQL ${sql} ≠ JS ${js}`)
  }
  ok(egale === CAZURI.length, `aceeași decizie pe ${egale} din ${CAZURI.length} cazuri (cu garda pornită); cu garda oprită SQL = true pe orice proiect`)
  ok((await val(db, `SELECT public.fn_red_fan_lot_permis_valori(false, 'LOT1-X', false) AS p`)).p === true && H.transportPermis({ proiectCod: 'LOT1-X', fanLot: { test: false }, doarTest: false }).ok === true, 'garda oprită (F4): ambele permit lotul real')
  await db.close()
}

console.log('6. runda 4: porțile care au blocat livrarea pe clonă — GATE 0e (scripts/control_0e.sql, verbatim) și poarta Izometrie E2 (blocul închiderii / mutatorilor din 20261230a, citit din fișier)')
{
  const C0E = citeste('scripts/control_0e.sql')
  const M30 = citeste('supabase/migrations/20261230a_izometrie_porti_reconciliere.sql')
  // blocul E2 al porții de pe producție (20261230a): de la DECLARE-ul închiderii până la END-ul lui, nemodificat; se rulează într-o funcție de probă
  // care întoarce lista v (aceleași mesaje ca fn_izo_porti_lipsa pentru partea citirilor). Numele funcției de probă e unic (nu se potrivește în alte corpuri).
  const A0 = "    DECLARE\n      c_rel oid[]; c_fn oid[] := '{}';", i0 = M30.indexOf(A0), j0 = M30.indexOf('\n    END;\n', i0)
  const BLOC = i0 >= 0 && j0 > i0 ? M30.slice(i0, j0 + '\n    END;\n'.length) : ''
  ok(BLOC && M30.indexOf(A0, i0 + 1) < 0 && BLOC.includes("WHERE k.corp ~* '(set_config|search_path)'") && BLOC.includes("ELSE ' (obiect din catalog care cheamă un mutator de cale)' END) d")
    && BLOC.includes('c_implicite_revizuite constant text[]'), `blocul E2 extras din 20261230a (${BLOC.length} caractere, unic, cu sămânța mutatorilor și invocările implicite)`)
  const FN_E2 = `CREATE SCHEMA IF NOT EXISTS proba_porti_r4;
CREATE OR REPLACE FUNCTION proba_porti_r4.bloc_e2_20261230a_proba() RETURNS text[] LANGUAGE plpgsql AS $proba_r4$
DECLARE v text[] := '{}'; r record;
BEGIN
${BLOC}
  RETURN v;
END $proba_r4$;`
  const porti = async db => {
    await db.exec('RESET ROLE; ' + FN_E2)
    const e2 = (await val(db, 'SELECT proba_porti_r4.bloc_e2_20261230a_proba() AS v')).v || []
    const g0e = (await db.query(C0E)).rows.map(x => `${x.functie} | ${x.motive}`)
    return { e2, g0e }
  }
  const MSG_E2 = 'invocare implicită neanalizată: trigger trg_red_fan_awb_garda on table red_fan_awb → fn_red_fan_awb_garda() (obiect din catalog care cheamă un mutator de cale) (citire nerevizuită)'
  const CINCI = ['fn_red_fan_anulare_cere(uuid,text,text,text)', 'fn_red_fan_anulat(uuid,text,text)', 'fn_red_fan_cerere_decide(uuid,boolean,text)',
                 'fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', 'fn_red_fan_retrage(uuid,text)']   // lista din raportul probei pe clonă (GATE 0e, cod 30)
  const dbB = await bazaVeche(); const inainte = await porti(dbB); await dbB.close()
  const dbN = await bazaNoua(); const dupa = await porti(dbN); await dbN.close()
  ok(JSON.stringify(dupa.e2) === JSON.stringify(inainte.e2) && !dupa.e2.some(x => /red_fan/.test(x)),
    `poarta E2 neschimbată de migrare (${inainte.e2.length} → ${dupa.e2.length} elemente pe PGlite, niciunul FAN): ${dupa.e2.filter(x => !inainte.e2.includes(x)).join(' | ').slice(0, 200)}`)
  ok(JSON.stringify(dupa.g0e) === JSON.stringify(inainte.g0e) && !dupa.g0e.some(x => /fn_red_fan_/.test(x)),
    `GATE 0e: nicio funcție fn_red_fan_* expusă găsită (${inainte.g0e.length} → ${dupa.g0e.length} rânduri pe PGlite): ${dupa.g0e.filter(x => /fn_red_fan_/.test(x)).join(' | ').slice(0, 200)}`)
  // mutantul „forma c75cc2ad”: marcajul scris iar cu funcția de configurare (aceleași valori). (a) migrarea îl refuză în postcondiție; (b) cu
  // postcondiția rundei 4 neutralizată, ambele porți îl găsesc exact ca pe clonă (sensibilitatea probei, fără să depindem de git)
  const nSet = (MIG.match(/SET LOCAL redari_fan\.garda = '[a-z_]*';/g) || []).length
  const vechi = MIG.replace(/SET LOCAL redari_fan\.garda = '([a-z_]*)';/g, "PERFORM set_config('redari_fan.garda', '$1', true);")
  ok(nSet === 14, `marcajul: 14 instrucțiuni SET LOCAL (7 puneri + 7 goliri) în migrare (${nSet})`)
  // comparația de corp a postcondiției (AMPRENTE-NOI) cade oricum pe textul mutat: se scoate DOAR ea (cea din lanțul „înainte” rămâne)
  const faraMd5Post = t => { const s = "      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta\n", i = t.indexOf('-- <<< AMPRENTE-NOI 20261228a'), j = t.indexOf(s, i)
    if (i < 0 || j < 0 || t.indexOf(s, j + 1) >= 0) throw new Error('comparația de corp din postcondiție nu e unică'); return t.slice(0, j) + t.slice(j + s.length) }
  const SAPTE = ['fn_red_fan_anulare_cere', 'fn_red_fan_anulat', 'fn_red_fan_cerere_decide', 'fn_red_fan_claim_intern', 'fn_red_fan_comanda', 'fn_red_fan_retrage', 'fn_red_fan_srv_anuleaza']
  { const db = await bazaVeche(); let m = null; try { await aplicaMig(db, faraMd5Post(vechi)) } catch (e) { m = e.message }
    ok(/corpuri fn_red_fan_\* prinse de portile 0e \/ Izometrie E2/.test(m || '') && SAPTE.every(x => (m || '').includes(x)), 'mutantul „marcaj cu funcția de configurare”: postcondiția rundei 4 refuză, cu cele 7 corpuri numite: ' + String(m).slice(0, 220)); await db.close() }
  const vechiNeutru = faraMd5Post(vechi)
    .replace("RAISE EXCEPTION '20261228a post: marcajul redari_fan.garda", "RAISE NOTICE '20261228a post: marcajul redari_fan.garda")
    .replace("RAISE EXCEPTION '20261228a post: corpuri fn_red_fan_*", "RAISE NOTICE '20261228a post: corpuri fn_red_fan_*")
  { const db = await bazaVeche(); let m = null, p = null; try { await aplicaMig(db, vechiNeutru); p = await porti(db) } catch (e) { m = e.message } await db.close()
    const plus0e = (p?.g0e || []).filter(x => !inainte.g0e.includes(x)), plusE2 = (p?.e2 || []).filter(x => !inainte.e2.includes(x))
    ok(!m && JSON.stringify(plus0e.map(x => x.split(' | ')[0])) === JSON.stringify(CINCI) && plus0e.every(x => / \| set_config$/.test(x)),
      `cu postcondiția neutralizată, GATE 0e găsește EXACT cele 5 funcții din raportul clonei (motiv set_config): ${m || plus0e.join(' ; ')}`)
    ok(!m && plusE2.length === 1 && plusE2[0] === MSG_E2, `cu postcondiția neutralizată, poarta E2 dă EXACT elementul din raportul clonei: ${m || plusE2.join(' | ')}`) }
  // opțional: head-ul vechi, fișierul întreg (FAN_MIG_VECHE=<cale>, ex. git show c75cc2ad:supabase/migrations/20261228a_redari_fan_operator.sql)
  if (process.env.FAN_MIG_VECHE) {
    const db = await bazaVeche(); let m = null, p = null
    try { await aplicaMig(db, readFileSync(process.env.FAN_MIG_VECHE, 'utf8').replace(/\r/g, '')); p = await porti(db) } catch (e) { m = e.message } await db.close()
    const plus0e = (p?.g0e || []).filter(x => !inainte.g0e.includes(x)).map(x => x.split(' | ')[0]), plusE2 = (p?.e2 || []).filter(x => !inainte.e2.includes(x))
    ok(!m && JSON.stringify(plus0e) === JSON.stringify(CINCI) && plusE2.length === 1 && plusE2[0] === MSG_E2, `head-ul vechi (${process.env.FAN_MIG_VECHE}): GATE 0e = cele 5, E2 = elementul clonei: ${m || plus0e.join(', ') + ' / ' + plusE2.join(' | ')}`)
  }
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
