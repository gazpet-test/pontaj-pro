// Proba LOCALĂ a migrării 20270102a (Redări FAN: urmărirea automată) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261212a_redari_fan_awb_schelet.sql + fn_red_nivel() EXACT din 20261126a + 20261212a, 20261227a și 20261228a
//   aplicate ca runnerul, apoi 20270102a aplicată ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați de scripts/livrare_amprenta_gen.sh;
//   manifestul generat se compară cu lista revizuită supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv; `--scrie-obiecte` o regenerează).
// 1. Comportamentul (așteptări scrise de mână din docs/redari/FAN_URMARIRE_AUTOMATA.md, L25), ca rolurile reale: authenticated cu JWT (owner,
//    operator, viewer), anon, service_role FĂRĂ JWT (clasa B) și service_role CU JWT de om (refuz în corp): revendicarea, suprapunerea, slotul,
//    plafonul manual, expirarea, plafonul de apeluri, selecția (ce se urmărește și ce nu), scrierea cu p_rulare (aceeași ca butonul, fără
//    ridicare confirmată, fără plic), garda „doar TEST”, închiderea idempotentă, calea butonului neschimbată, confirmările neschimbate.
// 2. Refuzurile migrării. 3. Revenirea: refuz la fiecare urmă; aplicare → revenire → re-aplicare. 4. Mutanți: fiecare PICĂ.
// 5. Paritatea plafonului JS ↔ SQL. 6. Porțile 0e / Izometrie E2 neschimbate de migrare.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_fan_urmarire_auto_local.mjs
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCAL_PGLITE = join(ROOT, '.tmp', 'pglite', 'node_modules', '@electric-sql', 'pglite')
const { PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(join(resolve(process.env.PGLITE_DIR), 'dist', 'index.js')).href
  : existsSync(LOCAL_PGLITE) ? pathToFileURL(join(LOCAL_PGLITE, 'dist', 'index.js')).href : '@electric-sql/pglite')
const AUTO = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariFanUrmarireAuto.mjs')).href)
// runda 2: payload-urile scenariilor K se construiesc cu interpretarea REALĂ a răspunsului FAN (aceeași funcție ca butonul și rularea, L19)
const FAN = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariFan.mjs')).href)
const TMP = mkdtempSync(join(tmpdir(), 'fan_auto_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261212a_redari_fan_awb_schelet.sql')
const MIG12 = citeste('supabase/migrations/20261212a_redari_fan_awb.sql')
const MIG27 = citeste('supabase/migrations/20261227a_redari_fan_opod.sql')
const MIG28 = citeste('supabase/migrations/20261228a_redari_fan_operator.sql')
const MIG = citeste('supabase/migrations/20270102a_redari_fan_urmarire_auto.sql')
const REV = citeste('supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql')
const NUME = '20270102a_redari_fan_urmarire_auto'
const OBIECTE_CALE = 'supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv'
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

console.log('0. validatorul runnerului pe fișierele exacte; scriptul de clonă (bash -n)')
{
  const fm = join(ROOT, 'supabase/migrations/20270102a_redari_fan_urmarire_auto.sql'), fr = join(ROOT, 'supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql')
  ok(MIG.startsWith('-- Version 20270102120000.') && MIG.includes("IS DISTINCT FROM '5000/session'") && MIG.includes("IS DISTINCT FROM '5000:' || txid_current()"), 'migrarea cere exact plafonul runnerului L15 v2 (5000)')
  const a = validator(fm, '--plafon-tranzactie-ms', '5000'), b = validator(fm, '--plafon-tranzactie-ms', '2000'), c = validator(fm, '--fara-plafon')
  ok(a.ok && /^OK \d+ /.test(a.out), 'migrarea trece validatorul cu 5000: ' + a.out)
  ok(!b.ok && /PLAFON_DIFERIT/.test(b.out), 'migrarea cu runnerul la 2000 = refuz: ' + b.out.slice(0, 110))
  ok(!c.ok && /PLAFON_LIPSA/.test(c.out), 'migrarea fără plafon = refuz local: ' + c.out.slice(0, 110))
  const d = validator(fr, '--plafon-tranzactie-ms', '2000'), e = validator(fr, '--plafon-tranzactie-ms', '5000')
  ok(d.ok && /^OK \d+ /.test(d.out), 'revenirea trece validatorul cu plafonul ei (2000): ' + d.out)
  ok(!e.ok && /PLAFON_DIFERIT/.test(e.out), 'revenirea cu 5000 = refuz: ' + e.out.slice(0, 110))
  const S2 = join(ROOT, 'supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh')
  let sn = null; try { execFileSync('bash', ['-n', S2], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (x) { sn = String(x.stderr || x.message) }
  const s2 = existsSync(S2) ? citeste('supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh') : ''
  ok(sn === null && ['S1', 'S2', 'S3'].every(k => s2.includes(`rez ok "${k} `)) && s2.includes('fn_red_fan_srv_rulare_incepe('), `scriptul cu două sesiuni: bash -n ${sn || 'OK'}; scenariile S1 S2 S3 prezente`)
}

const ID = {
  owner: '00000000-0000-4000-8000-000000000001', editor: '00000000-0000-4000-8000-000000000002', viewer: '00000000-0000-4000-8000-000000000003',
  strain: '00000000-0000-4000-8000-000000000004', admin: '00000000-0000-4000-8000-000000000005',
  proiect: '10000000-0000-4000-8000-000000000001', real: '10000000-0000-4000-8000-000000000002',
  L1: '20000000-0000-4000-8000-000000000001', L2: '20000000-0000-4000-8000-000000000002', L3: '20000000-0000-4000-8000-000000000003', LR: '20000000-0000-4000-8000-000000000004',
}
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const awbId = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CERERE = '60000000-0000-4000-8000-000000000001'
const HX = c => c.repeat(64)
const nrPlic = n => `PL-TST-${String(n).padStart(4, '0')}`
const PLICURI = Array.from({ length: 17 }, (_, i) => i + 1)
const lotPlic = n => (n <= 12 ? ID.L1 : n <= 15 ? ID.L2 : n === 16 ? ID.L3 : ID.LR)
const proiectPlic = n => (n === 17 ? ID.real : ID.proiect)
const DATE = `
  INSERT INTO public.profiles (id, name, is_owner) VALUES ('${ID.owner}', 'O', true), ('${ID.editor}', 'E', false), ('${ID.viewer}', 'V', false), ('${ID.strain}', 'X', false), ('${ID.admin}', 'A', false);
  INSERT INTO public.user_module_access VALUES ('${ID.editor}', 'redari', 'editor'), ('${ID.viewer}', 'redari', 'viewer'), ('${ID.admin}', 'redari', 'admin');
  INSERT INTO public.red_proiecte (id, cod) VALUES ('${ID.proiect}', 'TEST-PROIECT'), ('${ID.real}', 'LOT1-REAL');
  INSERT INTO public.red_loturi_plicuire (id, proiect_id, nr_lot) VALUES ('${ID.L1}', '${ID.proiect}', 'PP-0001'), ('${ID.L2}', '${ID.proiect}', 'PP-0002'), ('${ID.L3}', '${ID.proiect}', 'PP-0003'), ('${ID.LR}', '${ID.real}', 'PP-0004');
  INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
    ${PLICURI.map(n => `('${plicId(n)}', '${proiectPlic(n)}', '${lotPlic(n)}', '${nrPlic(n)}', 'PERSOANA ${n}', 'activ')`).join(',\n    ')};`
// rândurile FAN ale probei (scrise ca postgres cu trigger-ele oprite DOAR pentru fixtură; CHECK-urile rămân active). Așteptarea selecției (scrisă de mână,
// FAN_URMARIRE_AUTOMATA.md §3): se urmăresc DOAR 1 (generat, neurmărit), 2 (ridicat, urmărit acum 1 h) și 10 (generat, „de verificat”, fără livrare,
// urmărit acum 3 h: ordinea după ultima urmărire, 1 → 10 → 2, diferă de ordinea după id);
// NU: 3 livrat, 4 retur, 5 anulat, 6 generat acum 61 de zile, 7 propus fără AWB, 13 lot TEST nemarcat, 17 lot real.
const RAND = (n, stare, { awb = String(7000000000 + n), gen = "now() - interval '1 day'", urm = 'NULL', extra = {} } = {}) => ({ n, stare, awb, gen, urm, extra })
const RANDURI = [
  RAND(1, 'generat'), RAND(2, 'ridicat', { urm: "now() - interval '1 hour'", extra: { ridicat_la: "now() - interval '3 hours'" } }),
  RAND(3, 'generat', { urm: "now() - interval '5 hours'", extra: { urmarire_stare: "'livrat'", livrat_la: "now() - interval '6 hours'" } }),
  RAND(4, 'generat', { urm: "now() - interval '5 hours'", extra: { urmarire_stare: "'retur'", retur_cunoscut: 'true', retur_propus: "'refuz'" } }),
  RAND(5, 'anulat', { extra: { anulat_la: 'now()', anulat_de: `'${ID.owner}'`, motiv_anulare: "'alt_motiv'", anulare_nota: "'proba'" } }),
  RAND(6, 'generat', { gen: "now() - interval '61 days'" }),
  RAND(7, 'propus', { awb: null, gen: 'NULL' }),
  // runda 2: „de verificat” = ultimul eveniment neclar (S99), FĂRĂ contradicție veche (*_contrazis): migrarea refuză contradicțiile vechi nesoluționate
  RAND(10, 'generat', { urm: "now() - interval '3 hours'", extra: { urmarire_stare: "'de_verificat'", ultim_eveniment: "'S99'", ultim_eveniment_la: "now() - interval '4 hours'" } }),
  RAND(13, 'generat'), RAND(17, 'generat'),
]
const sqlRand = r => {
  const col = ['id', 'proiect_id', 'lot_id', 'plic_id', 'nr_plic', 'stare', 'hash_date', 'awb', 'generat_la', 'urmarit_la', 'propus_de', 'aprobat_de', 'aprobat_la', 'cerere_id', ...Object.keys(r.extra)]
  const aprobat = r.stare !== 'propus'
  const v = [`'${awbId(r.n)}'`, `'${proiectPlic(r.n)}'`, `'${lotPlic(r.n)}'`, `'${plicId(r.n)}'`, `'${nrPlic(r.n)}'`, `'${r.stare}'`, `'${HX('a')}'`, r.awb ? `'${r.awb}'` : 'NULL', r.gen, r.urm,
    `'${ID.owner}'`, aprobat ? `'${ID.owner}'` : 'NULL', aprobat ? 'now()' : 'NULL', aprobat ? `'${CERERE}'` : 'NULL', ...Object.values(r.extra)]
  return `INSERT INTO public.red_fan_awb (${col.join(', ')}) VALUES (${v.join(', ')});`
}
const FIXTURA_FAN = `SET session_replication_role = replica;
  INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES ('${ID.L1}', '${ID.proiect}', true, '${ID.owner}'), ('${ID.LR}', '${ID.real}', false, '${ID.owner}');
  ${RANDURI.map(sqlRand).join('\n  ')}
  SET session_replication_role = origin;`

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
async function bazaVeche({ cu28 = true } = {}) {   // schelet + nivel + date + 20261212a + 20261227a + 20261228a (ca runnerul) + rândurile FAN ale probei
  const db = new PGlite()
  await db.exec(SCHELET); await db.exec(NIVEL); await db.exec(DATE)
  await caRunner(db, '20261212a_redari_fan_awb', MIG12)
  await caRunner(db, '20261227a_redari_fan_opod', MIG27)
  if (cu28) { await caRunner(db, '20261228a_redari_fan_operator', MIG28); await db.exec(FIXTURA_FAN) }
  return db
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
async function bazaNoua() { const db = await bazaVeche(); await aplicaMig(db); return db }
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (t.split(din).length !== 2) throw new Error('mutantul nu se aplică exact o dată: ' + din.slice(0, 90))
    t = t.replace(din, in_)
  }
  return t
}
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

// ─── comportamentul (fail = lista verificărilor picate; mutanții o primesc din afară) ───
async function verificari(db, log, fail = []) {
  const ok = (c, m) => { if (!c) fail.push(m); if (log) console.log((c ? '  OK  ' : '  NU  ') + m) }
  const incepe = (sursa, actor, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_rulare_incepe($1, $2) AS r', [sursa, actor], sub)
  const r0 = async (...a) => (await incepe(...a)).rows[0].r
  const apel = (rul, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_rulare_apel($1) AS n', [rul], sub)
  const deUrm = (rul, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_de_urmarit($1) AS r', [rul], sub)
  const incheie = (rul, stare, cod_, lot = 0, sar = 0, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_rulare_incheie($1, $2, $3, $4, $5) AS r', [rul, stare, cod_, lot, sar], sub)
  const scrie = (actor, rul, lot, arr, sub = '') => srv(db, 'SELECT public.fn_red_fan_srv_urmarire($1, $2, $3, $4::jsonb) AS r', [actor, rul, lot, JSON.stringify(arr)], sub)
  const rulare = async id => val(db, 'SELECT * FROM public.red_fan_rulari WHERE id = $1', [id])
  const awb = async n => val(db, 'SELECT * FROM public.red_fan_awb WHERE id = $1', [awbId(n)])
  const jurnal = async () => (await val(db, `SELECT count(*)::int AS n FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = 'urmarire_auto'`)).n
  // ziua generării rândurilor fixturii (now() - 1 zi) în ora României: ridicarea C0 în acea zi e o dată posibilă (≥ generare, ≤ azi)
  const ZG = (await val(db, `SELECT to_char((now() - interval '1 day') AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS z`)).z
  const p1 = async (n, z = {}) => { const a = await awb(n); return { id: a.id, awb: a.awb, versiune: a.versiune_urmarire, urmarire_stare: 'ridicat', ultim_eveniment: 'C0',
    ultim_eveniment_la: `${ZG} 23:59:00`, ridicat_propus: ZG, livrat_la: null, retur_propus: null, ...z } }
  const rolSlot = (await val(db, `SELECT CASE WHEN extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/Bucharest') < 13 THEN 'dimineata' ELSE 'seara' END AS s`)).s

  // ── A. clasa B: niciun om (authenticated / anon), service_role cu JWT de om = refuz în corp ──
  const FN = [['fn_red_fan_srv_rulare_incepe($1, $2)', ['cron', null]], ['fn_red_fan_srv_rulare_apel($1)', [ID.L1]], ['fn_red_fan_srv_de_urmarit($1)', [ID.L1]],
    ['fn_red_fan_srv_rulare_incheie($1, $2, $3, $4, $5)', [ID.L1, 'incheiata', null, 0, 0]], ['fn_red_fan_srv_urmarire($1, $2, $3, $4::jsonb)', [null, ID.L1, ID.L1, '[]']]]
  for (const [f, p] of FN) {
    const a = await cod(ca(db, ID.owner, `SELECT public.${f}`, p)), b = await cod(ca(db, null, `SELECT public.${f}`, p)), c = await cod(srv(db, `SELECT public.${f}`, p, ID.owner))
    ok(a === '42501' && b === '42501' && c === '42501', `${f.split('(')[0]}: owner autentificat ${a}, anon ${b}, service_role cu JWT de om ${c} (toate 42501)`)
  }
  ok(await cod(incepe('cron', ID.owner)) === '22023' && await cod(incepe('owner', null)) === '22023' && await cod(incepe('altceva', null)) === '22023', 'incepe: cron cu actor / owner fără actor / sursă necunoscută → 22023')
  ok(await cod(incepe('owner', ID.editor)) === '42501', 'incepe: rularea manuală cu un ne-owner → 42501')
  ok(await cod(ca(db, ID.owner, `INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, plafon_apeluri) VALUES (current_date, 'seara', 'cron', 20)`)) === '42501'
     && await cod(srv(db, `INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, plafon_apeluri) VALUES (current_date, 'seara', 'cron', 20)`)) === '42501',
    'scrierea directă în red_fan_rulari: owner autentificat și service_role → 42501 (doar prin RPC)')

  // ── B. revendicarea și suprapunerea ──
  const s1 = await r0('cron', null)
  ok(/^[0-9a-f-]{36}$/.test(s1.rulare_id) && s1.slot === rolSlot && s1.plafon_apeluri === AUTO.PLAFON_APELURI_RULARE, `cron: rularea pornită pe slotul ${s1.slot} (ora României), plafon ${s1.plafon_apeluri}`)
  const R = s1.rulare_id
  const s2 = await r0('cron', null), s3 = await r0('owner', ID.owner)
  ok(s2.ocupat === true && s2.motiv === 'rulare_in_curs' && s3.ocupat === true && (await val(db, `SELECT count(*)::int AS n FROM public.red_fan_rulari`)).n === 1,
    'a doua pornire (cron sau owner) cât una e în curs → ocupat, nimic scris')
  // plasa din BD pentru două porniri concurente (proba reală cu două sesiuni: supabase/tests/…_doua_sesiuni.sh S1): indexul unic „una în curs”
  ok(await cod(db.query(`INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, plafon_apeluri) VALUES ('2000-01-01', 'dimineata', 'cron', 20)`)) === '23505',
    'indexul unic: a doua rulare în curs (scrisă direct, ca postgres, pe altă zi) → 23505')

  // ── C. selecția: o singură definiție în BD ──
  const sel = (await deUrm(R)).rows[0].r
  const ids = sel.loturi.flatMap(l => l.randuri.map(x => x.id))
  ok(sel.loturi.length === 1 && sel.loturi[0].lot_id === ID.L1 && sel.loturi[0].proiect_cod === 'TEST-PROIECT' && sel.loturi[0].test === true && sel.randuri === 3,
    `selecția: un lot (L1, TEST-PROIECT, marcat TEST), 3 rânduri (${sel.randuri})`)
  ok(JSON.stringify(ids) === JSON.stringify([awbId(1), awbId(10), awbId(2)]), 'ordinea: neurmărit întâi, apoi cel mai vechi urmărit (1; 10 acum 3 h; 2 acum 1 h)')
  ok(![3, 4, 5, 6, 7, 13, 17].some(n => ids.includes(awbId(n))), 'excluse: livrat, retur, anulat, > 60 de zile, fără AWB, lot TEST nemarcat, lot real')
  ok(sel.loturi[0].randuri[0].versiune_urmarire === 0 && sel.loturi[0].randuri[0].awb === '7000000001' && sel.loturi[0].randuri[0].stare === 'generat', 'rândul selectat poartă id, AWB, starea și versiunea (CAS)')

  // ── D. plafonul de apeluri (pasul durabil înaintea fiecărui GET) ──
  ok((await apel(R)).rows[0].n === 1, 'apel 1 rezervat')
  // ── E. scrierea cu p_rulare = același corp ca butonul. Runda 2 (decizia owner-ului): pe lotul de TEST ridicarea C0 se ÎNREGISTREAZĂ automat
  // (generat → ridicat, ridicat_la = ziua C0 la 00:00 ora României, un eveniment ridicare_auto în jurnal); plicul nu se atinge ──
  const w1 = (await scrie(null, R, ID.L1, [await p1(1)])).rows[0].r
  const a1 = await awb(1)
  ok(w1.scrise === 1 && w1.pastrate === 0 && w1.depasite === 0 && w1.ridicari === 1 && w1.contradictii === 0, 'scrierea cu p_rulare: 1 scris, 1 ridicare înregistrată, 0 contradicții')
  const zRid = (await val(db, `SELECT to_char(ridicat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS') AS z FROM public.red_fan_awb WHERE id = $1`, [awbId(1)])).z
  ok(a1.urmarire_stare === 'ridicat' && a1.stare === 'ridicat' && zRid === `${ZG} 00:00:00` && a1.versiune_urmarire === 1,
    `C0 pe lot de TEST: ridicarea ÎNREGISTRATĂ automat (stare ridicat, ridicat_la ${zRid}), versiunea +1`)
  const jr = await val(db, `SELECT count(*)::int AS n, max(date_noi ->> 'rulare_id') AS rul, max(date_noi ->> 'sursa') AS s, max(date_noi ->> 'cod') AS c, bool_and(user_id IS NULL) AS fara_om
    FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = 'ridicare_auto' AND inregistrare_id = $1`, [awbId(1)])
  ok(jr.n === 1 && jr.rul === R && jr.s === 'rulare_automata' && jr.c === 'C0' && jr.fara_om === true, 'jurnalul: un eveniment ridicare_auto (C0, rularea, fără om)')
  ok((await val(db, `SELECT awb, data_expediere FROM public.red_plicuri WHERE id = $1`, [plicId(1)])).awb === null, 'plicul nu se atinge (fără AWB / expediere pe plic)')
  const rr = await rulare(R)
  ok(rr.randuri === 1 && rr.scrise === 1 && rr.apeluri === 1 && rr.ridicari === 1 && rr.contradictii === 0,
    `numerele rulării le adună BD-ul (rânduri ${rr.randuri}, scrise ${rr.scrise}, apeluri ${rr.apeluri}, ridicări ${rr.ridicari})`)
  ok(await cod(scrie(null, R, ID.L1, [await p1(1, { versiune: 0 })])) === 'OK' && (await rulare(R)).depasite === 1, 'versiunea veche → „depășit” (CAS), numărat în rulare')
  ok(await cod(scrie(ID.owner, R, ID.L1, [await p1(2)])) === '22023', 'p_actor ȘI p_rulare → 22023')
  const inainte17 = JSON.stringify(await awb(17)), inainteR = JSON.stringify(await rulare(R))
  ok(await cod(scrie(null, R, ID.LR, [await p1(17)])) === 'RD032' && JSON.stringify(await awb(17)) === inainte17 && JSON.stringify(await rulare(R)) === inainteR,
    'lot real (garda doar TEST) → RD032; nici rândul, nici numerele rulării nu se schimbă')
  ok(await cod(scrie(null, R, ID.L1, [await p1(17)])) === 'P0001', 'rând al altui lot sub lotul L1 → P0001')
  const conf0 = (await awb(1)).confirmare_stare
  ok(await cod(srv(db, 'SELECT public.fn_red_fan_srv_confirmari($1, $2, $3, $4::jsonb)', [null, R, ID.L1, JSON.stringify([{ id: awbId(1), awb: '7000000001', versiune: 2, confirmare_stare: 'lipsa' }])])) === '42501'
     && (await awb(1)).confirmare_stare === conf0 && conf0 === 'nesolicitata',
    'confirmările rămân la buton: fn_red_fan_srv_confirmari (neschimbată) fără actor, cu p_rulare → 42501, nimic scris')
  for (let i = 2; i <= AUTO.PLAFON_APELURI_RULARE; i++) await apel(R)
  ok((await rulare(R)).apeluri === 20 && await cod(apel(R)) === 'RD040' && (await rulare(R)).apeluri === 20, 'plafonul: al 21-lea apel → RD040, contorul rămâne 20')

  // ── F. închiderea: o dată, cu jurnal; după ea, nimic nu mai merge pe rularea închisă ──
  ok(await cod(incheie(R, 'incheiata', 'x')) === '22023' && await cod(incheie(R, 'oprita_eroare', null)) === '22023' && await cod(incheie(R, 'oprita_eroare', 'RD040')) === '22023'
     && await cod(incheie(R, 'expirata', 'x')) === '22023' && await cod(incheie(R, 'incheiata', null, -1)) === '22023', 'închidere invalidă (stare / cod / număr) → 22023')
  const i1 = (await incheie(R, 'oprita_plafon', 'rd040', 1, 0)).rows[0].r
  ok(i1.stare === 'oprita_plafon' && i1.deja_inchisa === false && i1.scrise === 1 && i1.depasite === 1 && await jurnal() === 1, 'închiderea: stare + numere din BD + un eveniment urmarire_auto în jurnal')
  const i2 = (await incheie(R, 'incheiata', null, 9, 9)).rows[0].r
  ok(i2.deja_inchisa === true && i2.stare === 'oprita_plafon' && await jurnal() === 1 && (await rulare(R)).loturi === 1, 'a doua închidere: starea existentă, nimic rescris, niciun eveniment nou')
  ok(await cod(apel(R)) === 'RD041' && await cod(deUrm(R)) === 'RD041' && await cod(scrie(null, R, ID.L1, [await p1(2)])) === 'RD041', 'rularea închisă: apel / selecție / scriere → RD041')
  const s4 = await r0('cron', null)
  ok(s4.ocupat === true && s4.motiv === 'slot_rulat', 'cronul din nou pe același slot al zilei → ocupat (slot_rulat): o rulare de cron pe slot')
  ok(await cod(db.query(`INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, plafon_apeluri, stare, incheiata_la) SELECT zi_ro, slot, 'cron', 20, 'incheiata', now() FROM public.red_fan_rulari WHERE id = $1`, [R])) === '23505',
    'indexul unic: a doua rulare de cron pe aceeași (zi, slot), scrisă direct → 23505')

  // ── G. rularea manuală a owner-ului: cel mult 4 pe zi; expirarea după 15 minute ──
  const m1 = await r0('owner', ID.owner)
  ok(m1.slot === 'manual' && (await rulare(m1.rulare_id)).pornita_de === ID.owner, 'owner: rulare manuală, cu autorul păstrat')
  await db.exec(`UPDATE public.red_fan_rulari SET pornita_la = clock_timestamp() - interval '16 minutes' WHERE id = '${m1.rulare_id}'`)
  ok(await cod(apel(m1.rulare_id)) === 'RD041' && await cod(scrie(null, m1.rulare_id, ID.L1, [await p1(2)])) === 'RD041', 'rularea în curs de peste 15 minute: apel / scriere → RD041 (expirată)')
  const m2 = await r0('owner', ID.owner)
  const e1 = await rulare(m1.rulare_id)
  ok(e1.stare === 'expirata' && e1.eroare_cod === 'lease_expirat' && e1.incheiata_la !== null && /^[0-9a-f-]{36}$/.test(m2.rulare_id), 'pornirea următoare închide rularea expirată („expirata”) și pornește alta')
  await incheie(m2.rulare_id, 'incheiata', null)
  for (let i = 0; i < 2; i++) { const m = await r0('owner', ID.owner); await incheie(m.rulare_id, 'incheiata', null) }
  const m5 = await r0('owner', ID.owner)
  ok(m5.ocupat === true && m5.motiv === 'plafon_manual_zi', 'a 5-a rulare manuală a zilei → ocupat (plafon_manual_zi)')

  // ── H. citirea: admin / editor Redări văd rulările; viewer-ul și contul fără drept nu ──
  const nVede = async uid => (await ca(db, uid, 'SELECT count(*)::int AS n FROM public.red_fan_rulari')).rows[0].n
  ok(await nVede(ID.editor) > 0 && await nVede(ID.admin) > 0 && await nVede(ID.viewer) === 0 && await nVede(ID.strain) === 0, 'RLS: editorul / adminul văd rulările; viewer-ul și contul străin nu')

  // ── I. calea butonului (F1) neschimbată: operatorul cu p_actor; fără actor = 42501 ──
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SELECT public.fn_red_fan_operator_seteaza('${ID.editor}', true, NULL); SELECT set_config('request.jwt.claim.sub', '', false);`)
  ok((await scrie(ID.editor, null, ID.L1, [await p1(2, { urmarire_stare: 'in_tranzit', ultim_eveniment: 'H3', ridicat_propus: null })])).rows[0].r.scrise === 1, 'butonul: operatorul numit scrie cu p_actor (F1)')
  ok(await cod(scrie(null, null, ID.L1, [await p1(2)])) === '42501' && await cod(scrie(ID.viewer, null, ID.L1, [await p1(2)])) === '42501', 'butonul: fără actor / actor ne-operator → 42501')

  // ── J. limita selecției (plafon × 100 = 2.000 de rânduri): taie rândurile urmărite CEL MAI RECENT, nu pe cele cu id mare. 2.000 de rânduri în plus pe
  // L1, urmărite acum 10 minute, cu id-uri MAI MICI decât ale probei; 1 și 2 tocmai au fost scrise (acum), 10 a fost urmărit acum 3 h → selecția =
  // 10 + 1.999 dintre cele noi; 1 și 2 rămân pe rularea următoare. (Ordinea după id ar alege cele 2.000 noi și l-ar lăsa pe 10 pe dinafară.)
  await db.exec(`SET session_replication_role = replica;
    INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare)
      SELECT ('3e000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, '${ID.proiect}', '${ID.L1}', 'PL-XTR-' || lpad(i::text, 4, '0'), 'PERSOANA X', 'activ' FROM generate_series(1, 2000) i;
    INSERT INTO public.red_fan_awb (id, proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, awb, generat_la, urmarit_la, propus_de, aprobat_de, aprobat_la, cerere_id)
      SELECT ('3f000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, '${ID.proiect}', '${ID.L1}', ('3e000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
             'PL-XTR-' || lpad(i::text, 4, '0'), 'generat', '${HX('b')}', (8000000000 + i)::text, now() - interval '1 day', now() - interval '10 minutes',
             '${ID.owner}', '${ID.owner}', now(), '${CERERE}' FROM generate_series(1, 2000) i;
    SET session_replication_role = origin;
    INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, plafon_apeluri) VALUES ('2000-01-02', 'dimineata', 'cron', 20);`)
  const RL = (await val(db, `SELECT id FROM public.red_fan_rulari WHERE stare = 'in_curs'`)).id
  const selL = (await deUrm(RL)).rows[0].r
  const idsL = new Set(selL.loturi.flatMap(l => l.randuri.map(x => x.id)))
  ok(selL.randuri === 2000 && selL.limita === 2000 && idsL.size === 2000 && idsL.has(awbId(10)) && !idsL.has(awbId(1)) && !idsL.has(awbId(2)),
    `limita: 2.000 de rânduri, cel urmărit acum 3 h inclus, cele urmărite acum excluse (rânduri ${selL.randuri}, are 10: ${idsL.has(awbId(10))}, are 1 / 2: ${idsL.has(awbId(1))} / ${idsL.has(awbId(2))})`)

  // ── K. runda 2 (decizia owner-ului 21.11.2026 + Jakarinos #1155 r1 P1 / P2): faptele se înregistrează AUTOMAT după regula fan-contradictii-v1,
  // contradicțiile NU blochează și rămân DURABIL în red_fan_contradictii. Așteptările sunt scrise de mână din FAN_URMARIRE_AUTOMATA.md §3b (L25);
  // payload-urile = interpretarea REALĂ a răspunsului FAN (rezumatUrmarireFan), ca la buton și la rulare. Rânduri noi pe lotul de TEST L1, generate
  // acum 3 zile (D0 = ziua generării, ora României). Rularea automată = RL (în curs, din J); butonul = operatorul numit (p_actor, din I).
  const D0 = (await val(db, `SELECT to_char((now() - interval '3 days') AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD') AS z`)).z
  const zi = k => new Date(Date.parse(D0 + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10)
  const D1 = zi(1), D2 = zi(2)
  const K = [50, 51, 52, 53, 54, 55, 56, 57]
  await db.exec(`SET session_replication_role = replica;
    INSERT INTO public.red_plicuri (id, proiect_id, lot_id, nr_plic, destinatar_nume, stare) VALUES
      ${K.map(n => `('${plicId(n)}', '${ID.proiect}', '${ID.L1}', '${nrPlic(n)}', 'PERSOANA ${n}', 'activ')`).join(', ')};
    INSERT INTO public.red_fan_awb (id, proiect_id, lot_id, plic_id, nr_plic, stare, hash_date, awb, generat_la, propus_de, aprobat_de, aprobat_la, cerere_id) VALUES
      ${K.map(n => `('${awbId(n)}', '${ID.proiect}', '${ID.L1}', '${plicId(n)}', '${nrPlic(n)}', 'generat', '${HX('c')}', '${7000000000 + n}', now() - interval '3 days', '${ID.owner}', '${ID.owner}', now(), '${CERERE}')`).join(', ')};
    SET session_replication_role = origin;`)
  const pl = async (n, ev, extra = {}) => { const a = await awb(n)
    const z = FAN.rezumatUrmarireFan({ awbNumber: a.awb, events: ev.map(([id, date]) => ({ id, date })), ...extra })
    return { id: a.id, awb: a.awb, versiune: a.versiune_urmarire, urmarire_stare: z.urmarire_stare, ultim_eveniment: z.ultim_eveniment, ultim_eveniment_la: z.ultim_eveniment_la,
      ridicat_propus: z.ridicat_propus, livrat_la: z.livrat_la, retur_propus: z.retur_propus, retur_la: z.retur_la, contradictii: z.contradictii } }
  const contr = async n => (await db.query(`SELECT sursa, tip, valori, ales, regula, rulare_id, actor, observari FROM public.red_fan_contradictii WHERE fan_awb_id = $1 ORDER BY sursa, tip`, [awbId(n)])).rows
  const ora = async (n, col) => (await val(db, `SELECT to_char(${col} AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS') AS z FROM public.red_fan_awb WHERE id = $1`, [awbId(n)])).z
  const buton = async (n, ev, extra) => (await scrie(ID.editor, null, ID.L1, [await pl(n, ev, extra)])).rows[0].r
  const automat = async (n, ev, extra) => (await scrie(null, RL, ID.L1, [await pl(n, ev, extra)])).rows[0].r

  // K1 — reproducerea Jakarinos P1: două C0 (zile diferite), două S2 (ore diferite) și S16, în ACELAȘI răspuns, pe rularea automată
  const k1 = await automat(50, [['C0', `${D0} 10:00:00`], ['C0', `${D1} 09:00:00`], ['S2', `${D1} 10:40:00`], ['S2', `${D1} 12:00:00`], ['S16', `${D2} 10:00:00`]])
  const a50 = await awb(50), c50 = await contr(50)
  ok(k1.scrise === 1 && k1.ridicari === 1 && k1.contradictii === 3, `K1: un rând scris, o ridicare înregistrată, 3 contradicții (${k1.scrise}/${k1.ridicari}/${k1.contradictii})`)
  ok(a50.stare === 'ridicat' && a50.urmarire_stare === 'retur' && a50.retur_cunoscut === true && a50.livrat_la === null && await ora(50, 'ridicat_la') === `${D0} 00:00:00`,
    `K1: faptele după regulă — ridicarea = PRIMA zi C0 (${await ora(50, 'ridicat_la')}), finalul = returul ulterior livrării (fără livrare păstrată), NU „de verificat”`)
  ok(c50.length === 3 && c50.every(c => c.sursa === 'acelasi_raspuns' && c.rulare_id === RL && c.actor === null && c.observari === 1)
     && JSON.stringify(c50.map(c => [c.tip, c.ales, c.regula])) === JSON.stringify([['livrare_ore', `${D1} 12:00:00`, 'ultima_livrare'], ['livrare_retur', 'retur', 'final_ulterior'], ['ridicare_zile', D0, 'prima_ridicare']])
     && JSON.stringify(c50.find(c => c.tip === 'ridicare_zile').valori) === JSON.stringify([D0, D1]),
    'K1: cele 3 contradicții păstrate durabil, fiecare cu valorile, alesul, regula și rularea: ' + JSON.stringify(c50.map(c => c.tip)))
  ok((await rulare(RL)).contradictii === 3 && (await rulare(RL)).ridicari === 1, 'K1: rularea numără contradicțiile și ridicările (din BD)')

  // K2 — Jakarinos P2: două rulări succesive; a doua cu UN singur C0 nu șterge urma și nu cere omul
  await automat(51, [['C0', `${D0} 10:00:00`], ['C0', `${D1} 09:00:00`]])
  const k2b = await buton(51, [['C0', `${D1} 09:00:00`]])
  const a51 = await awb(51), c51 = await contr(51)
  ok(a51.urmarire_stare === 'ridicat' && a51.stare === 'ridicat' && String(a51.ridicat_propus) !== '' && await ora(51, 'ridicat_la') === `${D0} 00:00:00` && k2b.scrise === 1,
    'K2: după a doua rulare (un singur C0, altă zi) faptul înregistrat RĂMÂNE (prima zi), rândul NU e „de verificat”')
  ok(c51.length === 2 && c51[0].sursa === 'acelasi_raspuns' && c51[0].tip === 'ridicare_zile' && c51[1].sursa === 'intre_raspunsuri' && c51[1].tip === 'ridicare_zile'
     && c51[1].ales === D0 && JSON.stringify(c51[1].valori) === JSON.stringify([D0, D1]) && c51[1].actor === ID.editor && c51[1].rulare_id === null,
    'K2: urma primei contradicții rămâne + contradicția dintre răspunsuri, cu omul de la buton: ' + JSON.stringify(c51.map(c => [c.sursa, c.tip, c.ales])))
  await automat(51, [['C0', `${D0} 10:00:00`], ['H3', `${D1} 10:00:00`]])
  ok((await contr(51)).length === 2 && (await awb(51)).urmarire_stare === 'ridicat', 'K2: a treia rulare (aceeași zi C0, fără contradicție) nu adaugă nimic și nu șterge nimic')
  await automat(51, [['C0', `${D0} 10:00:00`], ['C0', `${D1} 09:00:00`], ['H3', `${D1} 11:00:00`]])
  const c51b = await contr(51)
  ok(c51b.length === 2 && c51b[0].observari === 2, 'K2: aceeași contradicție revăzută = același rând, observări 2 (nu rând nou)')

  // K3 — între răspunsuri: livrare cunoscută, apoi un răspuns cu retur ULTERIOR (curierul nu mai arată S2) → retur
  await buton(52, [['C0', `${D0} 10:00:00`], ['S2', `${D1} 10:00:00`]])
  const l52 = await awb(52)
  await buton(52, [['C0', `${D0} 10:00:00`], ['S16', `${D1} 15:00:00`]])
  const a52 = await awb(52), c52 = await contr(52)
  ok(l52.urmarire_stare === 'livrat' && a52.urmarire_stare === 'retur' && a52.retur_cunoscut && a52.livrat_la === null
     && c52.length === 1 && c52[0].tip === 'livrare_retur' && c52[0].sursa === 'intre_raspunsuri' && c52[0].ales === 'retur'
     && JSON.stringify(c52[0].valori) === JSON.stringify([`S2 ${D1} 10:00:00`, `retur ${D1} 15:00:00`]),
    'K3: retur după livrare = retur; livrarea veche rămâne în semnal: ' + JSON.stringify(c52.map(c => [c.tip, c.ales, c.valori])))

  // K4 — retur cunoscut, apoi livrare: rămâne retur dacă S2 nu e DUPĂ ultimul eveniment cunoscut; devine livrat dacă e după
  await buton(53, [['C0', `${D0} 10:00:00`], ['S16', `${D1} 10:00:00`]])
  await buton(53, [['C0', `${D0} 10:00:00`], ['S2', `${D1} 09:00:00`], ['H3', `${D1} 11:00:00`]])
  const r53 = await awb(53)
  await buton(53, [['C0', `${D0} 10:00:00`], ['S2', `${D2} 10:00:00`]])
  const a53 = await awb(53), c53 = await contr(53)
  ok(r53.urmarire_stare === 'retur' && r53.livrat_la === null && a53.urmarire_stare === 'livrat' && !a53.retur_cunoscut && await ora(53, 'livrat_la') === `${D2} 10:00:00`
     && c53.length === 2 && c53.every(c => c.tip === 'livrare_retur') && JSON.stringify(c53.map(c => c.ales).sort()) === JSON.stringify(['livrat', 'retur']),
    'K4: livrarea anterioară returului nu-l înlocuiește (retur); livrarea ulterioară câștigă (livrat); ambele semnale păstrate')

  // K5 — două livrări între răspunsuri → ULTIMA oră
  await buton(54, [['C0', `${D0} 10:00:00`], ['S2', `${D1} 10:00:00`]])
  await buton(54, [['C0', `${D0} 10:00:00`], ['S2', `${D1} 12:00:00`]])
  const c54 = await contr(54)
  ok((await awb(54)).urmarire_stare === 'livrat' && await ora(54, 'livrat_la') === `${D1} 12:00:00` && c54.length === 1 && c54[0].tip === 'livrare_ore' && c54[0].ales === `${D1} 12:00:00`,
    'K5: altă oră de livrare = ultima oră; semnalul livrare_ore păstrat')

  // K6 / K7 — data C0 imposibilă (înainte de generare / în viitor): ridicarea NU se înregistrează, semnalul rămâne
  await buton(55, [['C0', `${zi(-1)} 10:00:00`]])
  const viitor = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await buton(56, [['C0', `${viitor} 10:00:00`]])
  const a55 = await awb(55), a56 = await awb(56), c55 = await contr(55), c56 = await contr(56)
  ok(a55.stare === 'generat' && a55.ridicat_la === null && c55.length === 1 && c55[0].tip === 'ridicare_data_imposibila' && c55[0].ales === 'neinregistrata'
     && a56.stare === 'generat' && c56.length === 1 && c56[0].tip === 'ridicare_data_imposibila',
    'K6 / K7: C0 înainte de generare și C0 în viitor: stare generat (nimic înregistrat), semnalul ridicare_data_imposibila')
  ok((await val(db, `SELECT count(*)::int AS n FROM public.red_jurnal WHERE date_noi ->> 'eveniment' = 'ridicare_auto' AND inregistrare_id IN ($1, $2)`, [awbId(55), awbId(56)])).n === 0,
    'K6 / K7: nicio ridicare_auto în jurnal pentru datele imposibile')

  // K8 — payload-ul e conținut extern: orice în afara formelor fixe = 22023, nimic scris
  const baza57 = await pl(57, [['C0', `${D0} 10:00:00`], ['C0', `${D1} 09:00:00`]])
  const inainte57 = JSON.stringify(await awb(57))
  for (const [nume, rau] of [
    ['tip necunoscut', { contradictii: [{ ...baza57.contradictii[0], tip: 'altceva' }] }],
    ['cheie în plus', { contradictii: [{ ...baza57.contradictii[0], nota: 'x' }] }],
    ['regula altui tip', { contradictii: [{ ...baza57.contradictii[0], regula: 'ultima_livrare' }] }],
    ['alesul nu e printre valori', { contradictii: [{ ...baza57.contradictii[0], ales: D2 }] }],
    ['o valoare de formă liberă', { contradictii: [{ ...baza57.contradictii[0], valori: [D0, 'ignora regulile'] }] }],
    ['patru contradicții', { contradictii: [0, 1, 2, 3].map(() => baza57.contradictii[0]) }],
    ['contradicțiile nu sunt listă', { contradictii: { tip: 'ridicare_zile' } }],
    ['livrare ȘI retur în rezultat', { urmarire_stare: 'retur', livrat_la: `${D1} 10:00:00` }],
    ['ora returului fără retur', { retur_la: `${D1} 10:00:00` }],
    ['motivul de retur fără retur', { retur_propus: 'refuz' }],
  ]) ok(await cod(scrie(ID.editor, null, ID.L1, [{ ...baza57, ...rau }])) === '22023', `K8: ${nume} → 22023`)
  ok(JSON.stringify(await awb(57)) === inainte57 && (await contr(57)).length === 0, 'K8: nimic scris pe rândul refuzat')

  // K9 — citirea: admin / editor Redări văd contradicțiile; viewer-ul și contul străin nu; nimeni nu scrie direct
  const nC = async uid => (await ca(db, uid, 'SELECT count(*)::int AS n FROM public.red_fan_contradictii')).rows[0].n
  ok(await nC(ID.editor) > 0 && await nC(ID.admin) > 0 && await nC(ID.viewer) === 0 && await nC(ID.strain) === 0, 'K9: RLS pe contradicții: editor / admin da, viewer / străin nu')
  const ins = `INSERT INTO public.red_fan_contradictii (fan_awb_id, lot_id, awb, sursa, tip, valori, ales, regula, versiune_regula, cheie) VALUES ('${awbId(57)}', '${ID.L1}', '7000000057', 'acelasi_raspuns', 'ridicare_zile', '["a","b"]', 'a', 'prima_ridicare', 'fan-contradictii-v1', '${'0'.repeat(32)}')`
  ok(await cod(ca(db, ID.owner, ins)) === '42501' && await cod(srv(db, ins)) === '42501' && await cod(ca(db, ID.owner, `DELETE FROM public.red_fan_contradictii`)) === '42501',
    'K9: scriere / ștergere directă în red_fan_contradictii (owner autentificat, service_role) → 42501')
  // K10 — coloanele vechi *_contrazis nu se mai scriu; nicio stare „livrat ȘI retur”
  ok((await val(db, `SELECT count(*)::int AS n FROM public.red_fan_awb WHERE ridicat_contrazis IS NOT NULL OR livrat_contrazis IS NOT NULL OR retur_contrazis IS NOT NULL OR (livrat_la IS NOT NULL AND retur_cunoscut)`)).n === 0,
    'K10: niciun rând cu *_contrazis sau cu livrare ȘI retur deodată')
  // K11 — lot REAL (garda „doar TEST” oprită DOAR în fixtură, ca la F4): ridicarea rămâne fapt în evidență (ridicat_propus), dar rândul NU trece în
  // „ridicat” și plicul nu se atinge — expedierea pe plic a unui lot real rămâne butonul owner-ului / D4 (F4, cu „da”-ul juridic)
  await db.exec(`SET session_replication_role = replica; UPDATE public.red_fan_setari SET doar_proiecte_test = false; SET session_replication_role = origin;`)
  const w17 = (await scrie(ID.editor, null, ID.LR, [await p1(17)])).rows[0].r
  const a17 = await awb(17), pl17 = await val(db, `SELECT awb, data_expediere FROM public.red_plicuri WHERE id = $1`, [plicId(17)])
  await db.exec(`SET session_replication_role = replica; UPDATE public.red_fan_setari SET doar_proiecte_test = true; SET session_replication_role = origin;`)
  ok(w17.scrise === 1 && w17.ridicari === 0 && a17.stare === 'generat' && a17.ridicat_la === null && a17.urmarire_stare === 'ridicat' && pl17.awb === null && pl17.data_expediere === null,
    'K11: lot real: faptul C0 înregistrat în evidență, rândul rămâne generat, plicul neatins, nicio ridicare automată')
  const rp = async n => (await val(db, `SELECT to_char(ridicat_propus, 'YYYY-MM-DD') AS z FROM public.red_fan_awb WHERE id = $1`, [awbId(n)])).z
  ok(await rp(51) === D0 && await rp(50) === D0, `K2 / K1: ziua ridicării înregistrate = prima zi (${await rp(51)}), nu ziua răspunsului mai nou`)
  return fail
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) peste 20261212a + 20261227a + 20261228a + comportamentul')
{
  const db = await bazaVeche()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G0 = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, OBIECTE_CALE),
    '# 20270102a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase); baza = 20261212a + 20261227a + 20261228a aplicate\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G0 && gener.length > 10 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.slice(0, 5).join(' | ')}] în plus [${plus.slice(0, 5).join(' | ')}]`)
  const FMANIFEST = join(TMP, NUME + '.l15.tsv')
  writeFileSync(FMANIFEST, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G0, manifest: FMANIFEST, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta`).test(m)),
    'livrarea aprobată: diferența = manifestul; garda finală a runnerului (PLAFON_TIMP)')
  const f = []
  try { await verificari(db, true, f) } catch (e) { ok(false, `excepție în verificări: ${e.code || ''} ${String(e.message).slice(0, 200)}`) }
  esec += f.length
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista rulari automate/.test(m || ''), 'revenirea refuză cu istoric de rulări: ' + m)
  await db.close()
}

console.log('2. refuzurile migrării (nimic schimbat)')
const gol = async db => (await val(db, `SELECT to_regclass('public.red_fan_rulari') IS NULL AND to_regclass('public.red_fan_contradictii') IS NULL
  AND to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NULL AND to_regprocedure('public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid)') IS NULL
  AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_fan_srv_urmarire(uuid, uuid, uuid, jsonb)')) = '63ffdb70ebefb68fc1e944e0cd7305c7'
  AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_fan_urmarire_intern(uuid, jsonb)')) = '40109588fdeb59c56784ab4b7ff616be'
  AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_red_fan_urmarire(uuid, jsonb)')) = '966a88fd8c20655714cf7a72dc25e748' AS g`)).g
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['fără amprenta globală L15 v2', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['o funcție fn_red_fan_* străină (53 în loc de 52)', async db => { await db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`); return aplicaMig(db) }, /numarul functiilor fn_red_fan_\* nu e 52/],
  // (runda 2: funcția modificată e garda doar TEST, nu corpul comun — corpul comun e chiar ce verifică `gol`, ca vechi, după refuz)
  ['garda „doar TEST” folosită de corpul nou schimbată (lanțul înainte)', async db => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_lot_permis(p_lot_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ SELECT true $fn$;`); return aplicaMig(db) }, /lantul \(inainte\) difera.*fn_red_fan_lot_permis\(uuid\)/],
  ['EXECUTE pe clasa B dat și omului (lanțul înainte)', async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_fan_srv_urmarire(uuid, uuid, uuid, jsonb) TO authenticated;`); return aplicaMig(db) }, /lantul \(inainte\) difera.*fn_red_fan_srv_urmarire/],
  ['un trigger străin pe red_fan_awb', async db => { await db.exec(`CREATE TRIGGER t_x BEFORE UPDATE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_loturi_garda();`); return aplicaMig(db) }, /nu are exact trigger-ele din 20261228a/],
  // runda 2 (L14, preflight pe date live): o contradicție veche nesoluționată (*_contrazis) sau livrare + retur deodată = refuz, nimic schimbat
  ['o contradicție veche nesoluționată (ridicat_contrazis)', async db => { await db.exec(`SET session_replication_role = replica; UPDATE public.red_fan_awb SET urmarire_stare = 'de_verificat', ridicat_propus = current_date - 2, ridicat_contrazis = current_date - 1 WHERE id = '${awbId(1)}'; SET session_replication_role = origin;`); return aplicaMig(db) }, /contradictii vechi nesolutionate/],
  ['livrare ȘI retur vechi pe același rând', async db => { await db.exec(`SET session_replication_role = replica; UPDATE public.red_fan_awb SET urmarire_stare = 'de_verificat', livrat_la = now() - interval '2 hours', retur_cunoscut = true WHERE id = '${awbId(1)}'; SET session_replication_role = origin;`); return aplicaMig(db) }, /contradictii vechi nesolutionate/],
]) {
  const db = await bazaVeche()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  ok(re.test(m || '') && await gol(db), `${nume}: ${m}`)
  await db.close()
}
{
  const db = await bazaVeche({ cu28: false })
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/20261228a nu e aplicata/.test(m || ''), 'fără 20261228a (doar 20261212a + 20261227a): ' + m)
  await db.close()
}

console.log('3. revenirea (prin runner, plafonul 2000): refuz la fiecare urmă; aplicare → revenire → re-aplicare')
for (const [nume, pregateste, re] of [
  ['o rulare (chiar închisă)', async db => { await db.exec(`SET ROLE service_role; SELECT public.fn_red_fan_srv_rulare_incepe('cron', NULL); RESET ROLE;`) }, /exista rulari automate/],
  ['un eveniment urmarire_auto în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_awb', NULL, 'update', '{"eveniment":"urmarire_auto"}');`), /evenimente ale rularilor . ridicarilor automate/],
  ['un rând red_fan_rulari în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_rulari', NULL, 'update', '{}');`), /evenimente ale rularilor . ridicarilor automate/],
  ['o funcție fn_red_fan_* în plus', db => db.exec(`CREATE FUNCTION public.fn_red_fan_alta() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`), /starea nu e cea din 20270102a/],
  ['corpul nou al fn_red_fan_srv_urmarire schimbat', db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_fan_srv_urmarire(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`), /starea nu e cea din 20270102a/],
  ['o vedere străină peste red_fan_rulari', db => db.exec(`CREATE VIEW public.v_alta AS SELECT id FROM public.red_fan_rulari;`), /alte obiecte depind de red_fan_rulari/],
  // runda 2: urmele noi în date (semnalele de audit și ridicările automate) nu se pierd la revenire
  ['o contradicție FAN înregistrată (buton)', async db => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${ID.owner}', false); SET ROLE authenticated;
      SELECT public.fn_red_fan_urmarire('${ID.L1}', jsonb_build_array(jsonb_build_object('id', '${awbId(10)}', 'awb', '7000000010', 'versiune', 0, 'urmarire_stare', 'de_verificat',
        'ultim_eveniment', 'S99', 'ultim_eveniment_la', to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'), 'ridicat_propus', to_char((now() - interval '1 day') AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'),
        'contradictii', jsonb_build_array(jsonb_build_object('tip', 'ridicare_zile', 'regula', 'prima_ridicare', 'ales', to_char((now() - interval '1 day') AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'),
          'valori', jsonb_build_array(to_char((now() - interval '1 day') AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD')))))));
      RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`)
    // același apel înregistrează și ridicarea (lot TEST): revenirea verifică întâi contradicțiile, deci motivul refuzului e al lor
    if ((await val(db, 'SELECT count(*)::int AS n FROM public.red_fan_contradictii')).n !== 1) throw new Error('fixtura: contradicția nu s-a scris')
  }, /exista contradictii FAN inregistrate/],
  ['o ridicare automată în red_jurnal', db => db.exec(`INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi) VALUES ('red_fan_awb', NULL, 'update', '{"eveniment":"ridicare_auto"}');`), /evenimente ale rularilor \/ ridicarilor automate/],
]) {
  const db = await bazaNoua()
  await pregateste(db)
  let m = null
  try { await revino(db) } catch (e) { m = e.message }
  ok(re.test(m || '') && (await val(db, `SELECT to_regclass('public.red_fan_rulari') IS NOT NULL AS e`)).e, `revenirea refuză: ${nume}: ${m}`)
  await db.close()
}
{
  const db = await bazaNoua()
  let m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcajul runnerului: ' + m)
  m = null; try { await revino(db, REV, { plafon: 5000 }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa: 5000/.test(m || ''), 'revenirea cu plafonul livrărilor: ' + m)
  const db2 = await bazaVeche(); let m2 = null; try { await revino(db2) } catch (e) { m2 = e.message }
  ok(/starea nu e cea din 20270102a/.test(m2 || ''), 'revenirea pe o bază fără 20270102a: refuzul gărzii (to_regclass / to_regprocedure), nu eroare de cast: ' + m2)
  await db2.close()
  const j = await revino(db)
  ok(j.some(x => /revenire: sfarsit la \d+ ms/.test(x)), 'revenirea pe aplicarea curată trece (cele 52 de amprente ale bazei verificate în postcondiție)')
  ok(await gol(db) && (await val(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn_red_fan_%'`)).n === 52
     && await cod(srv(db, 'SELECT public.fn_red_fan_srv_urmarire($1, $2, $3, $4::jsonb)', [ID.owner, ID.L1, ID.L1, '[]'])) === '22023',
    'după revenire: 52 de funcții, corpul vechi (p_rulare nenul = 22023), fără tabelul rulărilor')
  m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(m === null, 're-aplicarea după revenire trece' + (m ? ': ' + m : ''))
  const f2 = []
  try { await verificari(db, false, f2) } catch (e) { f2.push('excepție: ' + (e.code || e.message)) }
  ok(f2.length === 0, 'comportamentul identic după re-aplicare' + (f2[0] ? ': ' + f2[0].slice(0, 120) : ''))
  await db.close()
}

console.log('4. mutanți (fiecare trebuie să pice cel puțin o verificare)')
const MUTANTI = [
  ['incepe: deschisă omului (fără auth.uid() IS NOT NULL)', "BEGIN\n  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;\n  IF p_sursa IS NULL", "BEGIN\n  IF p_sursa IS NULL"],
  ['incepe: fără „una singură în curs”', "  IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE stare = 'in_curs') THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'rulare_in_curs'); END IF;\n", ''],
  ['incepe: fără slotul zilei', "    IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE zi_ro = v_zi AND slot = v_slot) THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'slot_rulat'); END IF;\n", ''],
  ['incepe: fără expirare', "  UPDATE public.red_fan_rulari SET stare = 'expirata', incheiata_la = v_now, eroare_cod = 'lease_expirat'\n   WHERE stare = 'in_curs' AND pornita_la < v_now - interval '15 minutes';\n", ''],
  ['incepe: owner-ul neverificat', "  IF p_sursa = 'owner' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE) THEN", "  IF false THEN"],
  ['apel: fără plafon', ' AND apeluri < plafon_apeluri\n  RETURNING apeluri INTO v_n;', '\n  RETURNING apeluri INTO v_n;'],
  ['apel: rularea expirată acceptată', "   WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes' AND apeluri < plafon_apeluri", "   WHERE id = p_rulare AND stare = 'in_curs' AND apeluri < plafon_apeluri"],
  ['selecția: fără garda doar TEST', '       AND public.fn_red_fan_lot_permis(a.lot_id)\n', ''],
  ['selecția: și livratele', "       AND a.livrat_la IS NULL AND NOT a.retur_cunoscut AND a.urmarire_stare <> 'livrat'\n", "       AND NOT a.retur_cunoscut\n"],
  ['selecția: fără plafonul de vechime', "       AND a.generat_la >= clock_timestamp() - interval '60 days'\n", ''],
  ['selecția: ordinea după id (nu după ultima urmărire)', '     ORDER BY a.urmarit_la ASC NULLS FIRST, a.id\n     LIMIT v_lim', '     ORDER BY a.id\n     LIMIT v_lim'],
  ['scrierea: rularea neverificată', "  IF NOT EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes') THEN\n    RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041'; END IF;\n  v_r := ", '  v_r := '],
  ['scrierea: p_actor + p_rulare acceptate', "  IF p_actor IS NOT NULL THEN RAISE EXCEPTION 'redari fan: exact unul dintre actor si rulare' USING ERRCODE = '22023'; END IF;\n", ''],
  ['scrierea: numerele neadunate', "  UPDATE public.red_fan_rulari SET randuri = randuri + jsonb_array_length(p_randuri), scrise = scrise + (v_r ->> 'scrise')::integer,", "  UPDATE public.red_fan_rulari SET randuri = randuri + 0, scrise = scrise + 0 * (v_r ->> 'scrise')::integer,"],
  ['închiderea: rescrie o rulare închisă', "  IF v_r.stare <> 'in_curs' THEN\n    v_deja := true;\n  ELSE", "  IF false THEN\n    v_deja := true;\n  ELSE"],
  ['tabelul: fără „una în curs” (indexul unic)', "CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari (stare) WHERE stare = 'in_curs';\n", ''],
  ['tabelul: fără indexul unic pe (zi, slot) (îl prinde și postcondiția migrării)', "CREATE UNIQUE INDEX red_fan_rulari_slot_uq ON public.red_fan_rulari (zi_ro, slot) WHERE slot <> 'manual';\n", ''],
  // runda 2: regula faptelor, durabilitatea contradicțiilor, ridicarea automată, validarea conținutului extern
  ['scrierea: contradicțiile din același răspuns ignorate', 'FROM jsonb_array_elements(m.n_contr) e', "FROM jsonb_array_elements('[]'::jsonb) e"],
  ['scrierea: contradicția dintre răspunsuri (ridicare) neînregistrată', '          WHERE m.k_rid IS NOT NULL AND m.n_rid IS NOT NULL AND m.n_rid <> m.k_rid', '          WHERE false'],
  ['scrierea: ziua ridicării înregistrate se mută pe răspunsul nou', 'coalesce(n.k_rid, n.n_rid) AS rid', 'coalesce(n.n_rid, n.k_rid) AS rid'],
  ['scrierea: livrarea = prima oră, nu ultima', 'THEN greatest(g.k_liv, g.n_liv)', 'THEN least(g.k_liv, g.n_liv)'],
  ['scrierea: returul nou nu înlocuiește livrarea cunoscută', "WHEN f.k_fin = 'livrat' THEN CASE WHEN f.n_ret_la IS NULL OR f.n_ret_la >= f.k_liv THEN 'retur' ELSE 'livrat' END", "WHEN f.k_fin = 'livrat' THEN 'livrat'"],
  ['scrierea: livrarea nouă înlocuiește mereu returul cunoscut', "ELSE CASE WHEN f.k_la IS NOT NULL AND f.n_liv > f.k_la THEN 'livrat' ELSE 'retur' END END AS fin", "ELSE 'livrat' END AS fin"],
  ['scrierea: aceeași contradicție nu mai e numărată (observări)', 'DO UPDATE SET observari = t.observari + 1,', 'DO UPDATE SET observari = t.observari,'],
  ['scrierea: lista de contradicții nevalidată (conținut extern)', '           AND c.ok), count(DISTINCT u.id)', '           ), count(DISTINCT u.id)'],
  ['scrierea: livrare ȘI retur acceptate în rezultat', "           AND (u.livrat_la IS NULL OR u.urmarire_stare <> 'retur') AND", '           AND'],
  ['scrierea: ridicarea automată fără limita de jos a datei', 'AND g.rid >= g.k_gen AND g.rid <= v_azi) AS auto_rid', 'AND g.rid <= v_azi) AS auto_rid'],
  ['scrierea: ridicarea automată și pe lotul real', '(v_test IS TRUE AND g.k_stare', "(true AND g.k_stare"],
  ['scrierea: fără jurnalul ridicărilor automate', '   WHERE x.auto_rid;', '   WHERE false;'],
  ['scrierea: numerele noi ale rulării neadunate', "         contradictii = contradictii + (v_r ->> 'contradictii')::integer,", '         contradictii = contradictii,'],
]
// postcondiția amprentelor NOI și cea a indexului cad pe textul mutat: se scot DOAR comparația de corp din AMPRENTE-NOI și verificarea indexului
const POST_MD5 = "      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta\n"
const faraPost = t => {
  const i = t.indexOf('-- <<< AMPRENTE-NOI 20270102a'), j = t.indexOf(POST_MD5, i)
  if (i < 0 || j < 0 || t.indexOf(POST_MD5, j + 1) >= 0) throw new Error('comparația de corp din postcondiție nu e unică')
  let u = t.slice(0, j) + t.slice(j + POST_MD5.length)
  const k0 = "     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_rulari_in_curs_uq')\n        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari USING btree (stare) WHERE (stare = ''in_curs''::text)'\n"
  if (u.split(k0).length !== 2) throw new Error('verificarea indexului din postcondiție nu e unică')
  return u.replace(k0, '')
}
for (const [nume, ...perechi] of MUTANTI) {
  const lista = []
  for (let i = 0; i < perechi.length; i += 2) lista.push([perechi[i], perechi[i + 1]])
  let m
  try { m = faraPost(aplica(MIG, lista)) } catch (e) { ok(false, `mutantul „${nume}” nu se aplică exact o dată: ${e.message}`); continue }
  const f = []
  let db = null
  try { db = await bazaVeche(); await aplicaMig(db, m); await verificari(db, false, f) } catch (e) { f.push('excepție la aplicare / verificare: ' + (e.code || e.message)) }
  finally { if (db) await db.close() }
  ok(f.length > 0, `mutant „${nume}” prins (${f.length} verificări picate${f[0] ? ': ' + f[0].slice(0, 110) : ''})`)
}
{
  // sensibilitatea neutralizării: migrarea NEMUTATĂ cu postcondiția scoasă trece toate verificările (altfel „prins” ar veni din faraPost)
  const f = []; let db = null
  try { db = await bazaVeche(); await aplicaMig(db, faraPost(MIG)); await verificari(db, false, f) } catch (e) { f.push('excepție: ' + (e.code || e.message)) } finally { if (db) await db.close() }
  ok(f.length === 0, 'martorul: migrarea nemutată, cu aceeași neutralizare a postcondiției, trece toate verificările' + (f[0] ? ': ' + f[0].slice(0, 110) : ''))
}

console.log('5. paritatea plafonului: JS (PLAFON_APELURI_RULARE) = SQL (fn_red_fan_srv_rulare_incepe + CHECK-ul tabelului)')
{
  const inc = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_red_fan_srv_rulare_incepe('), MIG.indexOf('CREATE FUNCTION public.fn_red_fan_srv_rulare_apel('))
  const valori = [...inc.matchAll(/'plafon_apeluri', (\d+)\)|v_now, (\d+)\) RETURNING/g)].map(x => Number(x[1] || x[2]))
  ok(valori.length === 2 && valori.every(v => v === AUTO.PLAFON_APELURI_RULARE) && MIG.includes(`CHECK (plafon_apeluri BETWEEN 1 AND ${AUTO.PLAFON_APELURI_RULARE})`),
    `plafonul ${AUTO.PLAFON_APELURI_RULARE} în JS = valorile din BD (${valori.join(', ')}) și limita CHECK-ului`)
}

console.log('6. porțile care au blocat livrarea pe clonă la 20261228a — GATE 0e (scripts/control_0e.sql, verbatim) și poarta Izometrie E2 (blocul din 20261230a) — neschimbate de migrare')
{
  const C0E = citeste('scripts/control_0e.sql')
  const M30 = citeste('supabase/migrations/20261230a_izometrie_porti_reconciliere.sql')
  const A0 = "    DECLARE\n      c_rel oid[]; c_fn oid[] := '{}';", i0 = M30.indexOf(A0), j0 = M30.indexOf('\n    END;\n', i0)
  const BLOC = i0 >= 0 && j0 > i0 ? M30.slice(i0, j0 + '\n    END;\n'.length) : ''
  ok(BLOC && M30.indexOf(A0, i0 + 1) < 0, `blocul E2 extras din 20261230a (${BLOC.length} caractere, unic)`)
  const FN_E2 = `CREATE SCHEMA IF NOT EXISTS proba_porti_auto;
CREATE OR REPLACE FUNCTION proba_porti_auto.bloc_e2_20261230a_proba() RETURNS text[] LANGUAGE plpgsql AS $proba_auto$
DECLARE v text[] := '{}'; r record;
BEGIN
${BLOC}
  RETURN v;
END $proba_auto$;`
  const porti = async db => {
    await db.exec('RESET ROLE; ' + FN_E2)
    const e2 = (await val(db, 'SELECT proba_porti_auto.bloc_e2_20261230a_proba() AS v')).v || []
    const g0e = (await db.query(C0E)).rows.map(x => `${x.functie} | ${x.motive}`)
    return { e2, g0e }
  }
  const dbB = await bazaVeche(); const inainte = await porti(dbB); await dbB.close()
  const dbN = await bazaNoua(); const dupa = await porti(dbN); await dbN.close()
  ok(JSON.stringify(dupa.e2) === JSON.stringify(inainte.e2), `poarta E2 neschimbată de migrare (${inainte.e2.length} → ${dupa.e2.length} elemente): ${dupa.e2.filter(x => !inainte.e2.includes(x)).join(' | ').slice(0, 200)}`)
  ok(JSON.stringify(dupa.g0e) === JSON.stringify(inainte.g0e) && !dupa.g0e.some(x => /fn_red_fan_/.test(x)),
    `GATE 0e: nicio funcție fn_red_fan_* expusă găsită (${inainte.g0e.length} → ${dupa.g0e.length} rânduri): ${dupa.g0e.filter(x => /fn_red_fan_/.test(x)).join(' | ').slice(0, 200)}`)
}

console.log(esec ? `\nREZULTAT: ${esec} verificări picate` : '\nREZULTAT: toate verificările au trecut')
process.exit(esec ? 1 : 0)
