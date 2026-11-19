// Proba LOCALĂ a migrării 20261229a (Administrativ → UPA: plafonul pe lună, luna închisă, alerta fondului de handicap) pe PGlite — NU atinge nicio
// bază reală. Baza: schema falsă supabase/tests/20261229a_administrativ_upa_alerta_schelet.sql (roluri Supabase, privilegii implicite, auth.uid()).
// Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați: manifestul cu ROLLBACK, apoi livrarea aprobată + garda finală reală).
// 1. RLS / drepturi ca non-owner (L25): un cont logat FĂRĂ drept (și unul doar „viewer”) NU poate adăuga / modifica / șterge în upa_achizitii,
//    dar le citește; editor / admin Administrativ(.upa) și owner-ul pot; nimeni nu scrie direct în tabelele noi; RPC-urile alertei doar service_role.
// 2. Plafonul versionat: fiecare lună are plafonul ei; schimbarea din ecran scrie luna curentă (CAS), trecutul rămâne.
// 3. Alerta (zi < prag -> nimic; zi >= prag și sub plafon -> 1 rând; a doua rulare în aceeași zi -> nimic; 1 ale lunii -> închidere idempotentă +
//    mail; destinatari invalizi; setare invalidă; comutator oprit; reconcilierea), notificările în aplicație, marcarea (CAS).
// 4. Edge-ul (supabase/functions/_shared/upaAlerta.mjs, ruleazaAlertaUpa) pe BD-ul migrării cu Resend simulat: mailurile, cheia de idempotență,
//    5xx / rețea = necunoscut, 4xx = eroare, fără cheie = nimic rezervat. Paritatea textelor JS <-> SQL (lei / luna / zile).
// 5. Refuzurile migrării și ale revenirii; aplicare -> revenire -> reaplicare (cele 4 forme ale politicii vechi); MUTANȚI.
// Runda 2: codurile de configurare la fiecare rulare (erori_config), cheia de intenție (UNIQUE), proba notificărilor din preflight, amprenta
//   COMPLETĂ a obiectelor (blocul identic migrare / revenire; refuzurile revenirii pe fiecare familie de abatere).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_upa_alerta_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'upaalerta_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20261229a_administrativ_upa_alerta'
const F_MIG = `supabase/migrations/${NUME}.sql`
const F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`
const F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste(`supabase/tests/${NUME}_schelet.sql`)
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const OBIECTE = citeste(F_OBIECTE)
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const F_EDGE = 'supabase/functions/_shared/upaAlerta.mjs'
const MOD_EDGE = await import(pathToFileURL(join(ROOT, F_EDGE)).href)
const { lei, lunaText, zileText, cheieIdempotenta } = MOD_EDGE
// un mutant al codului edge: textul modificat scris în folderul temporar, cu importul helper-ului comun legat la fișierul real
const EDGE_TEXT = citeste(F_EDGE)
let nrMutantEdge = 0
async function importMutantEdge(text) {
  const f = join(TMP, `upaAlerta_mutant_${++nrMutantEdge}.mjs`)
  writeFileSync(f, text.replace("from './polite.mjs'", `from '${pathToFileURL(join(ROOT, 'supabase/functions/_shared/polite.mjs')).href}'`))
  return import(pathToFileURL(f).href)
}

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

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
console.log('0. validatorul runnerului')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

// ── datele (fictive) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000a0001', ED: '00000000-0000-0000-0000-0000000a0002', VW: '00000000-0000-0000-0000-0000000a0003',
  AD: '00000000-0000-0000-0000-0000000a0004', NO: '00000000-0000-0000-0000-0000000a0005', ADM_VW: '00000000-0000-0000-0000-0000000a0006' }
const DATE = `
INSERT INTO public.profiles (id, email, name, is_owner) VALUES ('${U.OWNER}', 'owner@gazpet.ro', 'OWNER TEST', true), ('${U.ED}', 'ed@gazpet.ro', 'EDITOR UPA', false),
  ('${U.VW}', 'vw@gazpet.ro', 'VIEWER UPA', false), ('${U.AD}', 'ad@gazpet.ro', 'ADMIN ADMINISTRATIV', false), ('${U.NO}', 'no@gazpet.ro', 'FARA DREPT', false),
  ('${U.ADM_VW}', 'av@gazpet.ro', 'VIEWER ADMINISTRATIV', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ED}', 'administrativ.upa', 'editor'), ('${U.VW}', 'administrativ.upa', 'viewer'),
  ('${U.AD}', 'administrativ', 'admin'), ('${U.ADM_VW}', 'administrativ', 'viewer'), ('${U.NO}', 'logistica', 'admin');
INSERT INTO public.logistica_setari (key, value) VALUES ('upa_plafon_lunar', '7000'), ('upa_alerta_activa', 'true'),
  ('upa_alerta_emails', ' Ana@gazpet.ro, ion@gazpet.ro '), ('upa_alerta_zi', '25');
INSERT INTO public.logistica_furnizori (id, nume, este_upa, activ, upa_valabil_pana) VALUES (1, 'UPA Unu SRL', true, true, '2040-01-01'), (2, 'UPA Expirat SRL', true, true, '2020-01-01'),
  (3, 'Furnizor Obisnuit SRL', false, true, NULL), (4, 'UPA Doi SRL', true, true, NULL);
INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, data_factura, luna, valoare) VALUES (1, 'F-1', '2030-12-10', '2030-12-01', 2000),
  (1, 'F-2', '2031-01-05', '2031-01-01', 1000), (4, 'F-3', '2031-01-07', '2031-01-01', 500);`
// plafonul istoric pe luni de probă (scris ca la migrare; în producție lunile vechi nu au plafon înregistrat)
const ISTORIC = `INSERT INTO public.upa_plafon_lunar (luna, plafon, setat_de, sursa) VALUES ('2030-12-01', 6000, NULL, 'migrare'), ('2031-01-01', 7000, NULL, 'migrare');`

// politica veche: cele 2 x 2 forme acceptate (rolul public / authenticated; fără WITH CHECK / WITH CHECK (auth.uid() IS NOT NULL))
const LINIE_POLITICA = 'CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);'
async function bazaNoua({ politicaPublic = false, checkUid = false, schelet = SCHELET, date = DATE } = {}) {
  const db = new PGlite()
  if (schelet.split(LINIE_POLITICA).length !== 2) throw new Error('scheletul nu mai are politica veche pe o linie')
  const pol = `CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO ${politicaPublic ? 'public' : 'authenticated'} USING (auth.uid() IS NOT NULL)`
    + (checkUid ? ' WITH CHECK (auth.uid() IS NOT NULL);' : ';')
  await db.exec(schelet.replace(LINIE_POLITICA, pol))
  await db.exec(date)
  return db
}
// forma exactă a politicilor pe upa_achizitii (nume | comandă | P/R | roluri | USING | CHECK)
const politiciAchizitii = async db => (await db.query(`SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END
  || ' | ' || (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',') FROM unnest(p.polroles) ro) || ' | '
  || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), chr(10) ORDER BY p.polname) AS t
  FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass`)).rows[0].t
// blocul AMPRENTA dintr-un fișier (între liniile marcaj)
const blocAmprenta = t => { const i = t.indexOf('AMPRENTA_20261229a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20261229a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constanteAmprenta = t => [...t.matchAll(/'([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20261229a_TEXT/g)].map(x => x[1])
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
const aplicaMig = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
// o instrucțiune ca un rol al aplicației (L25: SET LOCAL ROLE + claim-ul sub, ca PostgREST); întoarce rândurile sau codul erorii
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const nrNotif = async db => Number((await q1(db, 'SELECT count(*)::int AS n FROM public.notifications')).n)
const rezervaLa = async (db, zi) => (await q1(db, 'SELECT public.fn_upa_alerta_rezerva_la($1::date) AS r', [zi])).r
const setare = (db, k, v) => db.query('UPDATE public.logistica_setari SET value = $2 WHERE key = $1', [k, v])

// ── verificările de comportament după migrare (aceleași pentru aplicarea corectă și pentru mutanți) ──
async function verifica(db) {
  const ab = []
  const tine = (cond, msg) => { if (!cond) ab.push(msg) }
  // rândul de start
  const st = await q1(db, `SELECT count(*)::int AS n, min(plafon)::text AS p, min(luna)::text AS l, bool_and(sursa = 'migrare') AS s FROM public.upa_plafon_lunar`)
  const lunaAzi = (await q1(db, `SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Bucharest')::date::text AS l`)).l
  tine(st.n === 1 && st.p === '7000.00' && st.l === lunaAzi && st.s, `rândul de start: ${JSON.stringify(st)} (luna ${lunaAzi})`)
  await db.exec(ISTORIC)

  // 1. RLS pe upa_achizitii
  const ins = uid => caRol(db, 'authenticated', uid, `INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'P-' || substr(md5(random()::text), 1, 6), '2031-05-01', 10) RETURNING id`)
  const del = (uid, id) => caRol(db, 'authenticated', uid, 'DELETE FROM public.upa_achizitii WHERE id = $1', [id])
  const upd = (uid, id) => caRol(db, 'authenticated', uid, 'UPDATE public.upa_achizitii SET valoare = 11 WHERE id = $1', [id])
  const tinta = Number((await q1(db, `SELECT id FROM public.upa_achizitii WHERE numar_factura = 'F-1'`)).id)
  for (const [cine, uid] of [['fără drept', U.NO], ['viewer administrativ.upa', U.VW], ['viewer administrativ', U.ADM_VW]]) {
    const i = await ins(uid)
    tine(i.err === '42501', `${cine}: INSERT refuzat (42501), primit ${i.err || 'trecut'}`)
    const d = await del(uid, tinta), u = await upd(uid, tinta)
    tine(!d.err && d.n === 0 && !u.err && u.n === 0, `${cine}: DELETE / UPDATE nu ating nimic (${d.err || d.n} / ${u.err || u.n})`)
    const s = await caRol(db, 'authenticated', uid, 'SELECT count(*)::int AS n FROM public.upa_achizitii')
    tine(s.rows && s.rows[0].n >= 3, `${cine}: citește achizițiile (${s.err || s.rows[0].n})`)
  }
  tine((await q1(db, 'SELECT valoare::text AS v FROM public.upa_achizitii WHERE id = $1', [tinta]))?.v === '2000.00', 'rândul țintă neatins (nici șters, nici modificat) de conturile fără drept')
  for (const [cine, uid] of [['editor administrativ.upa', U.ED], ['admin administrativ', U.AD], ['owner', U.OWNER]]) {
    const i = await ins(uid)
    tine(!i.err && i.rows.length === 1, `${cine}: INSERT permis (${i.err || 'ok'} ${i.msg || ''})`)
    if (i.rows) {
      const u = await upd(uid, i.rows[0].id), d = await del(uid, i.rows[0].id)
      tine(u.n === 1 && d.n === 1, `${cine}: UPDATE / DELETE permise (${u.err || u.n} / ${d.err || d.n})`)
    }
  }
  const an = await caRol(db, 'anon', null, 'SELECT count(*)::int AS n FROM public.upa_achizitii')
  tine(an.err === '42501' || (an.rows && an.rows[0].n === 0), `anon nu vede achizițiile (${an.err || an.rows[0].n})`)
  const logatFaraUid = await caRol(db, 'authenticated', null, `INSERT INTO public.upa_achizitii (luna, valoare, numar_factura) VALUES ('2031-05-01', 1, 'X')`)
  tine(logatFaraUid.err === '42501', `authenticated fără sub: INSERT refuzat (${logatFaraUid.err || 'trecut'})`)
  for (const [uid, astept] of [[U.OWNER, true], [U.ED, true], [U.AD, true], [U.VW, false], [U.ADM_VW, false], [U.NO, false], [null, false]]) {
    const r = await caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_poate_scrie() AS v')
    tine(r.rows && r.rows[0].v === astept, `fn_upa_poate_scrie(${uid || 'fără sub'}) = ${astept} (${r.err || r.rows[0].v})`)
  }
  // cheia de intenție (L04 / L16): aceeași cheie a doua oară = 23505 pe constrângerea cheii, un singur rând; fără cheie = mai multe rânduri permise
  const K = '11111111-2222-4333-8444-555555555555'
  const insK = () => caRol(db, 'authenticated', U.ED, `INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare, cheie_intentie) VALUES (1, 'K-1', '2031-05-01', 10, $1) RETURNING id`, [K])
  const k1 = await insK(), k2 = await insK()
  const nk = await q1(db, 'SELECT count(*)::int AS n FROM public.upa_achizitii WHERE cheie_intentie = $1', [K])
  tine(!k1.err && k2.err === '23505' && /upa_achizitii_cheie_intentie_uidx/.test(k2.msg || '') && nk.n === 1,
    `cheia de intenție: a doua salvare = 23505 pe cheie, un rând (${k1.err || 'ok'} / ${k2.err} ${k2.msg || ''} / ${nk.n})`)
  const vk = await caRol(db, 'authenticated', U.NO, 'SELECT id FROM public.upa_achizitii WHERE cheie_intentie = $1', [K])
  tine(vk.rows?.length === 1, `rândul se regăsește după cheie de orice cont logat (reconcilierea ecranului) (${vk.err || vk.rows.length})`)
  await db.query('DELETE FROM public.upa_achizitii WHERE cheie_intentie = $1', [K])
  const f1 = await caRol(db, 'authenticated', U.ED, `INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'N-1', '2031-05-01', 1), (1, 'N-2', '2031-05-01', 1) RETURNING id`)
  tine(!f1.err && f1.rows.length === 2, `fără cheie (Citește Orice, rândurile vechi): mai multe rânduri cu NULL permise (${f1.err || f1.rows.length})`)
  await db.query(`DELETE FROM public.upa_achizitii WHERE numar_factura IN ('N-1', 'N-2')`)
  // 2. tabelele noi: nicio scriere directă; jurnalul doar pentru owner
  for (const rol of ['authenticated', 'service_role', 'anon']) {
    for (const sql of [`INSERT INTO public.upa_plafon_lunar (luna, plafon, sursa) VALUES ('2032-01-01', 1, 'migrare')`,
      `INSERT INTO public.upa_luna_inchisa (luna, plafon, consumat, ramas_necheltuit, nr_achizitii) VALUES ('2032-01-01', 1, 0, 1, 0)`,
      `UPDATE public.upa_plafon_lunar SET plafon = 1`, `DELETE FROM public.upa_alerta_jurnal`]) {
      const r = await caRol(db, rol, U.OWNER, sql)
      tine(r.err === '42501', `${rol}: ${sql.slice(0, 40)}… refuzat (${r.err || 'trecut'})`)
    }
  }
  for (const [rol, fn] of [['authenticated', 'public.fn_upa_alerta_rezerva()'], ['authenticated', "public.fn_upa_alerta_rezerva_la('2031-01-25')"],
    ['service_role', "public.fn_upa_alerta_rezerva_la('2031-01-25')"], ['authenticated', 'public.fn_upa_alerta_proba()'],
    ['authenticated', "public.fn_upa_alerta_marcheaza(1, 'trimis', NULL, NULL)"], ['anon', 'public.fn_upa_luni(NULL, 12)'], ['anon', 'public.fn_upa_poate_scrie()'],
    ['authenticated', "public.fn_upa_destinatari('a@gazpet.ro')"], ['authenticated', "public.fn_upa_alerta_inscrie('eroare', '2031-01-01', '2031-01-01', NULL, NULL, NULL, NULL, NULL, 'x')"]]) {
    const r = await caRol(db, rol, U.OWNER, `SELECT ${fn}`)
    tine(r.err === '42501', `${rol} nu poate chema ${fn.slice(7, 40)} (${r.err || 'trecut'})`)
  }

  // 3. plafonul versionat: schimbarea din ecran = luna curentă, CAS; trecutul rămâne
  const set = (uid, p, v) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_plafon_seteaza($1, $2) AS r', [p, v])
  tine((await set(U.NO, 8000, 7000)).err === '42501', 'plafonul: cont fără drept = 42501')
  tine((await set(U.VW, 8000, 7000)).err === '42501', 'plafonul: viewer = 42501')
  tine((await set(U.ED, 8000.555, 7000)).err === '22023', 'plafonul: 3 zecimale = 22023')
  tine((await set(U.ED, 0, 7000)).err === '22023', 'plafonul: zero = 22023')
  tine((await set(U.ED, 8000, 6500)).err === '40001', 'plafonul: valoarea văzută veche = 40001 (CAS)')
  const s1 = await set(U.ED, 7500.5, 7000)
  tine(!s1.err && s1.rows[0].r.plafon === 7500.5, `plafonul: editorul îl schimbă (${s1.err || JSON.stringify(s1.rows[0].r)})`)
  const pl = await q1(db, `SELECT setat_de::text AS d, sursa, (SELECT count(*)::int FROM public.upa_plafon_lunar) AS n FROM public.upa_plafon_lunar WHERE luna = $1::date`, [lunaAzi])
  tine(pl.d === U.ED && pl.sursa === 'ecran' && pl.n === 3, `plafonul: rândul lunii curente (autor = auth.uid(), ${JSON.stringify(pl)})`)
  tine((await set(U.ED, 7600, 7000)).err === '40001', 'plafonul: a doua schimbare cu valoarea veche = 40001')
  const luni = await caRol(db, 'authenticated', U.NO, `SELECT luna::text, plafon::text, consumat::text, e_curenta, zile_ramase, zi_prag, in_alerta FROM public.fn_upa_luni('2031-01-15', 3)`)
  const lm = Object.fromEntries((luni.rows || []).map(r => [r.luna, r]))
  tine(lm['2031-01-01']?.plafon === '7000.00' && lm['2030-12-01']?.plafon === '6000.00' && (luni.rows || []).length === 3,
    `istoricul: plafonul FIECĂREI luni, nu cel de azi (${JSON.stringify(luni.rows || luni.err)})`)
  const curent = await caRol(db, 'authenticated', U.NO, 'SELECT plafon::text AS p FROM public.fn_upa_luni(NULL, 1)')
  tine(curent.rows?.[0].p === '7500.50', `luna curentă: plafonul nou (${JSON.stringify(curent.rows || curent.err)})`)
  tine(Number(lm['2031-01-01']?.consumat) === 1500 && lm['2031-01-01']?.in_alerta === false && lm['2031-01-01']?.zile_ramase === 17 && lm['2031-01-01']?.zi_prag === 25,
    `luna curentă la 15.01: cheltuit 1500, 17 zile, prag 25, fără alertă (${JSON.stringify(lm['2031-01-01'])})`)
  tine((await caRol(db, 'authenticated', U.NO, 'SELECT * FROM public.fn_upa_luni(NULL, 37)')).err === '22023', 'fn_upa_luni: 37 de luni = 22023')

  // 4. alerta, pas cu pas
  let n0 = await nrNotif(db)
  let r = await rezervaLa(db, '2031-01-24')
  const inch = await q1(db, `SELECT plafon::text, consumat::text, ramas_necheltuit::text AS ramas, nr_achizitii FROM public.upa_luna_inchisa WHERE luna = '2030-12-01'`)
  tine(r.inchis?.luna === '2030-12-01' && inch?.plafon === '6000.00' && inch?.consumat === '2000.00' && inch?.ramas === '4000.00' && inch?.nr_achizitii === 1,
    `24.01 (sub prag): decembrie se închide cu plafonul LUI (6000 / 2000 / 4000) (${JSON.stringify(inch)})`)
  tine(r.n === 1 && r.randuri[0].fel === 'inchidere' && r.randuri[0].ramas === 4000 && r.randuri[0].stare === 'rezervat'
    && JSON.stringify(r.randuri[0].destinatari) === '["ana@gazpet.ro","ion@gazpet.ro"]',
    `24.01: un singur rând (închiderea), fără alerta zilei (${JSON.stringify(r.randuri)})`)
  tine(Array.isArray(r.erori_config) && r.erori_config.length === 0, `24.01: configurarea în regulă = erori_config [] (${JSON.stringify(r.erori_config)})`)
  let nn = await nrNotif(db)
  const tn = await q1(db, `SELECT title, type, modul, link_to FROM public.notifications ORDER BY id DESC LIMIT 1`)
  tine(nn - n0 === 5 && tn.title === 'Fond handicap decembrie 2030: necheltuit 4.000,00 lei' && tn.type === 'error' && tn.modul === 'Administrativ'
    && tn.link_to === '/administrativ?tab=upa', `notificările închiderii: 5 (owner + 4 cu Administrativ), ${JSON.stringify(tn)}`)
  // destinatarii notificărilor: owner + oricine are administrativ / administrativ.upa (orice nivel); NU contul doar cu logistica
  const dest = (await db.query(`SELECT profile_id::text AS p FROM public.notifications ORDER BY id DESC LIMIT 5`)).rows.map(x => x.p).sort()
  const destAstept = [U.OWNER, U.ED, U.VW, U.AD, U.ADM_VW].sort()
  tine(nn - n0 === 5 && JSON.stringify(dest) === JSON.stringify(destAstept), `notificările închiderii merg exact la ${destAstept.length} conturi, nu la cel fără Administrativ (${dest.join(',')})`)
  n0 = nn
  r = await rezervaLa(db, '2031-01-24')
  tine(r.n === 0 && (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_luna_inchisa')).n === 1 && await nrNotif(db) === n0, 'a doua rulare 24.01: nimic (închiderea idempotentă)')
  r = await rezervaLa(db, '2031-01-25')
  tine(r.n === 1 && r.randuri[0].fel === 'zilnic' && r.randuri[0].consumat === 1500 && r.randuri[0].ramas === 5500 && r.randuri[0].plafon === 7000
    && r.randuri[0].zile_ramase === 7 && r.randuri[0].cheie === 'zilnic:2031-01-25', `25.01 (prag): o alertă (${JSON.stringify(r.randuri)})`)
  tine(JSON.stringify(r.furnizori_upa) === '["UPA Doi SRL","UPA Unu SRL"]', `furnizorii UPA valabili (fără cel expirat / obișnuit): ${JSON.stringify(r.furnizori_upa)}`)
  nn = await nrNotif(db)
  const tz = await q1(db, `SELECT title, message, type FROM public.notifications ORDER BY id DESC LIMIT 1`)
  tine(nn - n0 === 5 && tz.type === 'warning' && tz.title === 'Fond handicap ianuarie 2031: rămân 5.500,00 lei de cheltuit'
    && tz.message === 'Cheltuit 1.500,00 din 7.000,00 lei la unități protejate; mai sunt 7 zile din lună. Ce nu se cheltuie până la final se plătește la bugetul de stat.',
    `notificarea zilei: ${JSON.stringify(tz)}`)
  n0 = nn
  r = await rezervaLa(db, '2031-01-25')
  tine(r.n === 0 && await nrNotif(db) === n0, 'a doua rulare 25.01: nimic (cel mult o alertă pe zi)')
  r = await rezervaLa(db, '2031-01-29')
  tine(r.n === 1 && r.randuri[0].zile_ramase === 3 && (await q1(db, `SELECT type FROM public.notifications ORDER BY id DESC LIMIT 1`)).type === 'error',
    '29.01 (3 zile rămase): alerta e roșie (error)')
  await db.exec(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'F-4', '2031-01-01', 5500)`)
  r = await rezervaLa(db, '2031-01-30')
  tine(r.n === 0, '30.01 după ce s-a cheltuit tot plafonul: nimic')
  r = await rezervaLa(db, '2031-02-01')
  const ian = await q1(db, `SELECT consumat::text, ramas_necheltuit::text AS r FROM public.upa_luna_inchisa WHERE luna = '2031-01-01'`)
  tine(r.inchis?.luna === '2031-01-01' && Number(ian?.consumat) === 7000 && ian?.r !== undefined && Number(ian.r) === 0 && r.n === 0, `01.02: ianuarie se închide, fără mail (necheltuit 0) (${JSON.stringify(ian)})`)
  await db.exec(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'F-5', '2031-01-01', 100)`)
  const dupa = (await caRol(db, 'authenticated', U.NO, `SELECT consumat::text AS c, consumat_inchis::text AS ci, inchisa FROM public.fn_upa_luni('2031-02-10', 2) WHERE luna = '2031-01-01'`)).rows?.[0]
  tine(dupa?.c === '7100.00' && dupa?.ci === '7000.00' && dupa?.inchisa === true, `o factură adăugată după închidere se vede ca diferență, instantaneul rămâne (${JSON.stringify(dupa)})`)
  const imut = await eroare(db.query(`UPDATE public.upa_luna_inchisa SET consumat = 0 WHERE luna = '2031-01-01'`))
  const imut2 = await eroare(db.query(`DELETE FROM public.upa_luna_inchisa`))
  tine(/nu se modifica/.test(imut || '') && /nu se modifica/.test(imut2 || ''), 'luna închisă: UPDATE / DELETE refuzate și pentru postgres')
  // destinatari invalizi: alerta se înscrie fără mail, notificările pleacă
  await setare(db, 'upa_alerta_emails', 'ana@gazpet.ro, cineva@yahoo.com')
  n0 = await nrNotif(db)
  r = await rezervaLa(db, '2031-02-25')
  tine(r.n === 1 && r.randuri[0].stare === 'fara_mail' && r.randuri[0].eroare === 'destinatari_invalizi' && JSON.stringify(r.randuri[0].destinatari) === '[]'
    && await nrNotif(db) - n0 === 5, `destinatari invalizi: fără mail, cu notificări (${JSON.stringify(r.randuri)})`)
  await setare(db, 'upa_alerta_emails', '')
  r = await rezervaLa(db, '2031-02-26')
  tine(r.n === 1 && r.randuri[0].stare === 'fara_mail' && r.randuri[0].eroare === 'fara_destinatari', 'fără destinatari: fara_mail / fara_destinatari')
  await setare(db, 'upa_alerta_emails', 'ana@gazpet.ro')
  // setare invalidă: eroare o dată pe zi, doar owner-ul
  await setare(db, 'upa_alerta_zi', 'abc')
  n0 = await nrNotif(db)
  r = await rezervaLa(db, '2031-02-27')
  const er = await q1(db, `SELECT stare, eroare, nr_notificari FROM public.upa_alerta_jurnal WHERE cheie = 'eroare:2031-02-27:setare_zi_invalida'`)
  tine(r.n === 0 && er?.stare === 'eroare' && er?.nr_notificari === 1 && await nrNotif(db) - n0 === 1, `setare invalidă: eroare în BD + notificare doar owner-ului (${JSON.stringify(er)})`)
  tine(JSON.stringify(r.erori_config) === '["setare_zi_invalida"]', `setare invalidă: codul întors explicit (${JSON.stringify(r.erori_config)})`)
  r = await rezervaLa(db, '2031-02-27')
  tine(await nrNotif(db) - n0 === 1, 'setare invalidă: a doua rulare în aceeași zi nu dublează eroarea')
  tine(r.n === 0 && JSON.stringify(r.erori_config) === '["setare_zi_invalida"]', `setare invalidă: a doua rulare întoarce TOT codul (nu „nimic”) (${JSON.stringify(r.erori_config)})`)
  // pragul 31 într-o lună de 30 de zile = ultima zi
  await setare(db, 'upa_alerta_zi', '31')
  r = await rezervaLa(db, '2031-04-29')
  const z29 = r.randuri.filter(x => x.fel === 'zilnic').length
  r = await rezervaLa(db, '2031-04-30')
  tine(z29 === 0 && r.randuri.filter(x => x.fel === 'zilnic').length === 1, 'pragul 31 în aprilie = 30 (29: nimic, 30: alerta)')
  await setare(db, 'upa_alerta_zi', '25')
  // comutatorul oprit: luna se închide totuși, fără mail / notificări
  await setare(db, 'upa_alerta_activa', 'false')
  n0 = await nrNotif(db)
  r = await rezervaLa(db, '2031-06-01')
  tine(r.activ === false && r.n === 0 && r.inchis?.luna === '2031-05-01' && await nrNotif(db) === n0
    && !(await q1(db, `SELECT 1 AS x FROM public.upa_alerta_jurnal WHERE cheie = 'inchidere:2031-05'`)), 'alerta oprită: mai se închide luna, nimic trimis')
  r = await rezervaLa(db, '2031-06-26')
  tine(r.activ === false && r.n === 0, 'alerta oprită: nicio alertă zilnică')
  await setare(db, 'upa_alerta_activa', 'true')
  // fără plafon înregistrat: erorile de configurare
  r = await rezervaLa(db, '2020-05-25')
  const fp = (await db.query(`SELECT cheie FROM public.upa_alerta_jurnal WHERE zi = '2020-05-25' ORDER BY cheie`)).rows.map(x => x.cheie)
  tine(r.n === 0 && JSON.stringify(fp) === '["eroare:2020-05-25:fara_plafon"]' && !r.inchis && JSON.stringify(r.erori_config) === '["fara_plafon"]',
    `fără plafon: o eroare (luna curentă), codul întors; luna anterioară dinaintea primului plafon nu se închide și nu e eroare (${fp} ${JSON.stringify(r.erori_config)})`)
  r = await rezervaLa(db, '2020-05-25')
  tine(r.n === 0 && JSON.stringify(r.erori_config) === '["fara_plafon"]', `fără plafon, a doua rulare: codul întors din nou (${JSON.stringify(r.erori_config)})`)
  // ambele defecte deodată: ambele coduri (jurnal + răspuns)
  await setare(db, 'upa_alerta_zi', '')
  r = await rezervaLa(db, '2020-06-25')
  const amb = (await db.query(`SELECT cheie FROM public.upa_alerta_jurnal WHERE zi = '2020-06-25' ORDER BY cheie`)).rows.map(x => x.cheie)
  tine(JSON.stringify(r.erori_config) === '["setare_zi_invalida","fara_plafon"]' && amb.length === 2, `ambele defecte: ambele coduri (${JSON.stringify(r.erori_config)} ${amb})`)
  await setare(db, 'upa_alerta_zi', '25')
  // reconcilierea: o rezervare rămasă > 1 h devine „necunoscut” (fără retrimitere)
  const rv = await q1(db, `SELECT id FROM public.upa_alerta_jurnal WHERE stare = 'rezervat' ORDER BY id LIMIT 1`)
  await db.query(`UPDATE public.upa_alerta_jurnal SET creat_la = now() - interval '2 hours' WHERE id = $1`, [rv.id])
  r = await rezervaLa(db, '2031-06-02')
  const rv2 = await q1(db, 'SELECT stare, eroare FROM public.upa_alerta_jurnal WHERE id = $1', [rv.id])
  tine(r.reconciliate >= 1 && rv2.stare === 'necunoscut' && rv2.eroare === 'rezervare_veche', `reconcilierea: ${JSON.stringify(rv2)}`)
  // marcarea (service_role, CAS din „rezervat”)
  const rz = await q1(db, `SELECT id FROM public.upa_alerta_jurnal WHERE stare = 'rezervat' ORDER BY id LIMIT 1`)
  const m1 = await caRol(db, 'service_role', null, `SELECT public.fn_upa_alerta_marcheaza($1, 'trimis', 're_1', NULL) AS n`, [rz.id])
  const m2 = await caRol(db, 'service_role', null, `SELECT public.fn_upa_alerta_marcheaza($1, 'eroare', NULL, 'resend_4xx') AS n`, [rz.id])
  const m3 = await caRol(db, 'service_role', null, `SELECT public.fn_upa_alerta_marcheaza($1, 'trimis', NULL, 'x') AS n`, [rz.id])
  tine(m1.rows?.[0].n === 1 && m2.rows?.[0].n === 0 && m3.err === '22023', `marcarea: o dată, apoi 0; argumente invalide = 22023 (${m1.rows?.[0].n} ${m2.rows?.[0].n} ${m3.err})`)
  // jurnalul: doar owner-ul îl vede
  const jo = await caRol(db, 'authenticated', U.OWNER, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')
  const jn = await caRol(db, 'authenticated', U.AD, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')
  tine(jo.rows?.[0].n > 0 && jn.rows?.[0].n === 0, `jurnalul: owner ${jo.rows?.[0].n}, admin Administrativ ${jn.rows?.[0].n}`)
  // funcția reală a cronului (ziua din România), ca service_role; proba nu scrie nimic
  const nj = (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')).n
  const pr = await caRol(db, 'service_role', null, 'SELECT public.fn_upa_alerta_proba() AS r')
  tine(pr.rows?.[0].r?.zi === (await q1(db, `SELECT (now() AT TIME ZONE 'Europe/Bucharest')::date::text AS z`)).z
    && (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')).n === nj && Array.isArray(pr.rows?.[0].r?.erori_config),
    `proba (service_role): ziua din România, erori_config, nimic scris (${pr.err || JSON.stringify(pr.rows?.[0].r?.erori_config)})`)
  const rr = await caRol(db, 'service_role', null, 'SELECT public.fn_upa_alerta_rezerva() AS r')
  tine(rr.rows?.[0].r?.activ === true && rr.rows[0].r.zi === pr.rows?.[0].r?.zi, `fn_upa_alerta_rezerva() ca service_role (${rr.err || rr.rows[0].r.zi})`)
  return ab
}

// ── edge-ul pe BD-ul migrării: ruleazaAlertaUpa cu Resend simulat (rpc -> funcțiile reale; rezervarea pe ziua dată, ca service_role în rest) ──
function sbPeBaza(db, stare) {
  return {
    rpc: async (nume, args) => {
      try {
        if (nume === 'fn_upa_alerta_rezerva') return { data: await rezervaLa(db, stare.zi), error: null }
        if (nume === 'fn_upa_alerta_marcheaza') {
          const r = await caRol(db, 'service_role', null, 'SELECT public.fn_upa_alerta_marcheaza($1, $2, $3, $4) AS n', [args.p_id, args.p_stare, args.p_resend_id, args.p_eroare])
          return r.err ? { data: null, error: { code: r.err } } : { data: r.rows[0].n, error: null }
        }
        if (nume === 'fn_upa_alerta_proba') {
          const r = await caRol(db, 'service_role', null, 'SELECT public.fn_upa_alerta_proba() AS r')
          return r.err ? { data: null, error: { code: r.err } } : { data: r.rows[0].r, error: null }
        }
        return { data: null, error: { code: 'PGRST202' } }
      } catch (e) { return { data: null, error: { code: e.code || 'X' } } }
    },
  }
}
function resendFals(raspunsuri) {
  const apeluri = []
  const f = async (url, o) => {
    apeluri.push({ url, headers: o.headers, body: JSON.parse(o.body) })
    const x = raspunsuri.length ? raspunsuri.shift() : { status: 200, id: 're_' + apeluri.length }
    if (x.arunca) throw new Error('retea')
    return { ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => (x.id ? { id: x.id } : {}) }
  }
  return { f, apeluri }
}
async function verificaEdge(db, ruleazaAlertaUpa = MOD_EDGE.ruleazaAlertaUpa) {
  const ab = []
  const tine = (cond, msg) => { if (!cond) ab.push(msg) }
  await db.exec(ISTORIC)
  const stare = { zi: '2031-01-02' }
  const sb = sbPeBaza(db, stare)
  const ruleaza = async (raspunsuri = [], cheie = 're_cheie') => { const rf = resendFals(raspunsuri); const r = await ruleazaAlertaUpa({ sb, fetchFn: rf.f, resendKey: cheie }); return { ...r, apeluri: rf.apeluri } }
  // fără cheie Resend: nimic rezervat
  let r = await ruleazaAlertaUpa({ sb, fetchFn: async () => { throw new Error('nu') }, resendKey: '' })
  tine(r.status === 500 && r.body.error === 'resend_neconfigurat' && (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_luna_inchisa')).n === 0, 'fără RESEND_API_KEY: 500, nimic închis / rezervat')
  // 02.01: închiderea lui decembrie -> un mail
  r = await ruleaza()
  const a0 = r.apeluri[0]
  tine(r.status === 200 && r.body.trimis === 1 && r.apeluri.length === 1 && a0?.body.subject === 'Fond handicap decembrie 2030: necheltuit 4.000,00 lei - se plătește la bugetul de stat'
    && JSON.stringify(a0.body.to) === '["ana@gazpet.ro","ion@gazpet.ro"]' && a0.body.from === 'PontajPRO <rapoarte@gazpet.ro>'
    && a0.headers['Idempotency-Key'] === await cheieIdempotenta('inchidere:2030-12'), `02.01: mailul închiderii (${JSON.stringify(r.body)} ${a0?.body.subject})`)
  tine(!/@/.test(JSON.stringify(r.body)), 'răspunsul edge-ului nu conține adrese')
  const j1 = await q1(db, `SELECT stare, resend_id FROM public.upa_alerta_jurnal WHERE cheie = 'inchidere:2030-12'`)
  tine(j1?.stare === 'trimis' && j1?.resend_id === 're_1', `jurnalul: trimis + id-ul Resend (${JSON.stringify(j1)})`)
  // 20.01: sub prag -> nimic
  stare.zi = '2031-01-20'; r = await ruleaza()
  tine(r.apeluri.length === 0 && r.body.rezervate === 0, `20.01 (zi < prag): niciun mail (${r.apeluri.length})`)
  // 25.01: prag + sub plafon -> 1 mail; a doua rulare -> nimic
  stare.zi = '2031-01-25'; r = await ruleaza()
  const s25 = r.apeluri[0]?.body.subject
  tine(r.apeluri.length === 1 && s25 === 'Fond handicap ianuarie 2031: cheltuit 1.500,00 din 7.000,00 lei, rămân 5.500,00 lei, mai sunt 7 zile'
    && /UPA Unu SRL/.test(r.apeluri[0].body.html) && !/UPA Expirat/.test(r.apeluri[0].body.html), `25.01: un mail (${s25})`)
  r = await ruleaza()
  tine(r.apeluri.length === 0 && r.body.ok, '25.01 a doua rulare: niciun mail')
  // 5xx / rețea = necunoscut, 4xx = eroare (fără retrimitere: a doua rulare în aceeași zi nu mai trimite)
  stare.zi = '2031-01-26'; r = await ruleaza([{ status: 503 }])
  tine(r.body.necunoscut === 1 && (await q1(db, `SELECT stare, eroare FROM public.upa_alerta_jurnal WHERE cheie = 'zilnic:2031-01-26'`)).eroare === 'resend_5xx', '503 = necunoscut (resend_5xx)')
  r = await ruleaza()
  tine(r.apeluri.length === 0, '26.01 după 503: nicio retrimitere automată')
  stare.zi = '2031-01-27'; r = await ruleaza([{ arunca: true }])
  tine(r.body.necunoscut === 1 && (await q1(db, `SELECT eroare FROM public.upa_alerta_jurnal WHERE cheie = 'zilnic:2031-01-27'`)).eroare === 'retea_sau_timeout', 'rețea = necunoscut')
  stare.zi = '2031-01-28'; r = await ruleaza([{ status: 422 }])
  tine(r.body.eroare === 1 && (await q1(db, `SELECT stare FROM public.upa_alerta_jurnal WHERE cheie = 'zilnic:2031-01-28'`)).stare === 'eroare', '422 = eroare')
  // 01.02: închiderea lui ianuarie (sub plafon) -> mail; a doua rulare -> nimic
  stare.zi = '2031-02-01'; r = await ruleaza()
  tine(r.apeluri.length === 1 && r.apeluri[0].body.subject === 'Fond handicap ianuarie 2031: necheltuit 5.500,00 lei - se plătește la bugetul de stat'
    && r.body.luna_inchisa === '2031-01-01', `01.02: închiderea + mailul (${r.apeluri[0]?.body.subject})`)
  r = await ruleaza()
  tine(r.apeluri.length === 0 && r.body.luna_inchisa === null, '01.02 a doua rulare: nimic (idempotent)')
  // configurare defectă (L18): ok:false + error configurare_invalida + codul, la FIECARE rulare (și a doua, când jurnalul nu mai scrie nimic)
  await setare(db, 'upa_alerta_zi', 'abc')
  stare.zi = '2031-02-26'; r = await ruleaza()
  const rc2 = await ruleaza()
  tine(r.status === 200 && r.body.ok === false && r.body.error === 'configurare_invalida' && JSON.stringify(r.body.erori_config) === '["setare_zi_invalida"]'
    && rc2.body.ok === false && rc2.body.error === 'configurare_invalida' && JSON.stringify(rc2.body.erori_config) === '["setare_zi_invalida"]'
    && r.apeluri.length === 0 && rc2.apeluri.length === 0, `configurare defectă: răspuns explicit la ambele rulări (${JSON.stringify(r.body)} / ${JSON.stringify(rc2.body)})`)
  await setare(db, 'upa_alerta_zi', '25')
  stare.zi = '2031-02-20'; r = await ruleaza()
  tine(r.body.ok === true && !r.body.error && JSON.stringify(r.body.erori_config) === '[]', `configurare în regulă, zi sub prag: ok:true, erori_config [] (${JSON.stringify(r.body)})`)
  // alerta oprită
  await setare(db, 'upa_alerta_activa', 'false')
  stare.zi = '2031-02-25'; r = await ruleaza()
  tine(r.apeluri.length === 0 && r.body.skip === 'alerta_oprita', 'alerta oprită: skip, niciun mail')
  await setare(db, 'upa_alerta_activa', 'true')
  // proba (?dry=1): nimic scris
  const nj = (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')).n
  r = await ruleazaAlertaUpa({ sb, fetchFn: async () => { throw new Error('nu') }, resendKey: 'x', dry: true })
  tine(r.status === 200 && r.body.dry === true && typeof r.body.in_alerta !== 'undefined' && (await q1(db, 'SELECT count(*)::int AS n FROM public.upa_alerta_jurnal')).n === nj, 'proba: nimic scris')
  return ab
}

console.log('0b. blocul AMPRENTA: identic în migrare și în revenire, aceeași constantă revizuită')
{
  const bm = blocAmprenta(MIG), br = blocAmprenta(REV), cm = constanteAmprenta(MIG), cr = constanteAmprenta(REV)
  ok(bm && bm.length > 2000 && bm === br, `blocul de calcul e identic (${bm?.length} / ${br?.length} caractere)`)
  ok(cm.length === 1 && cr.length === 1 && cm[0] === cr[0], `aceeași constantă în ambele fișiere (${cm} / ${cr})`)
}

console.log('1. aplicarea ca la livrare (L15 v2): manifestul = lista revizuită; PLAFON_TIMP; LOCK_TINUT')
let G_MANIFEST = null
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    '# 20261229a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n'
    + gener.filter(x => !/_not_null\t/.test(x)).join('\n') + '\n')
  const fara18 = gener.filter(x => !/_not_null\t/.test(x))
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  G_MANIFEST = { G, fManifest }
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m)),
    'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000)')
  ok(j.some(m => /^20261229a: lock la \d+ ms de la BEGIN \(1 incercari/.test(m)) && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
    'blocul de lock: o încercare; LOCK_TINUT declarat: ' + (j.find(m => /^LOCK_TINUT/.test(m)) || '').slice(0, 120))
  ok(await nrNotif(db) === 0, 'proba notificărilor din preflight nu a lăsat niciun rând (subtranzacție anulată)')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `comportamentul după migrare (${ab.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  await db.close()
}

console.log('2. edge-ul (ruleazaAlertaUpa) pe BD-ul migrării, cu Resend simulat')
{
  const db = await bazaNoua()
  await aplicaMig(db)
  const ab = await verificaEdge(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `edge-ul: mailurile, idempotența, stările (${ab.length} abateri)`)
  console.log('   paritatea textelor JS <-> SQL')
  const valori = [0, 0.5, 1, 7000, 4000, 5500, 1234567.5, 999.995, 12.3, 100000]
  const pl = []
  for (const v of valori) { const s = (await q1(db, 'SELECT public.fn_upa_lei($1::numeric) AS t', [String(v)])).t; if (s !== lei(v)) pl.push(`lei(${v}) SQL ${s} JS ${lei(v)}`) }
  for (let n = 1; n <= 31; n++) { const s = (await q1(db, 'SELECT public.fn_upa_zile_text($1) AS t', [n])).t; if (s !== zileText(n)) pl.push(`zile(${n}) SQL ${s} JS ${zileText(n)}`) }
  for (let l = 1; l <= 12; l++) { const iso = `2031-${String(l).padStart(2, '0')}-01`; const s = (await q1(db, 'SELECT public.fn_upa_luna_text($1::date) AS t', [iso])).t; if (s !== lunaText(iso)) pl.push(`luna(${iso}) SQL ${s} JS ${lunaText(iso)}`) }
  pl.forEach(a => console.log('     ' + a))
  ok(pl.length === 0 && lei(7000) === '7.000,00' && zileText(21) === 'mai sunt 21 de zile' && lunaText('2026-11-01') === 'noiembrie 2026', `paritatea lei / zile / luna (${pl.length} abateri)`)
  await db.close()
}

console.log('3. refuzurile migrării (nimic schimbat)')
for (const [nume, pregatire, o, re] of [
  ['fără marcajul runnerului', null, { marcaj: false }, /garda start invalida/],
  ['fără plafon', null, { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000)', null, { plafon: 2000 }, /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2', null, { l15: 'nimic' }, /AMPRENTA_GLOBALA_LIPSA/],
  ['o politică în plus pe upa_achizitii', `CREATE POLICY upa_extra ON public.upa_achizitii FOR SELECT TO anon USING (true);`, {}, /nu sunt exact upa_achizitii_all/],
  ['politica veche schimbată', `ALTER POLICY upa_achizitii_all ON public.upa_achizitii USING (true);`, {}, /nu sunt exact upa_achizitii_all/],
  ['RLS oprit pe upa_achizitii', `ALTER TABLE public.upa_achizitii DISABLE ROW LEVEL SECURITY;`, {}, /nu are RLS pornit/],
  ['plafonul din setări invalid', `UPDATE public.logistica_setari SET value = '7.000' WHERE key = 'upa_plafon_lunar';`, {}, /upa_plafon_lunar lipseste, e dublat sau nu e un numar pozitiv/],
  ['plafonul din setări lipsă', `DELETE FROM public.logistica_setari WHERE key = 'upa_plafon_lunar';`, {}, /upa_plafon_lunar lipseste/],
  ['coloana luna cu alt tip', `ALTER TABLE public.upa_achizitii ALTER COLUMN luna TYPE text;`, {}, /coloana upa_achizitii.luna lipseste sau are alt tip/],
  ['notificările fără modulul Administrativ', `ALTER TABLE public.notifications DROP CONSTRAINT notifications_modul_check; ALTER TABLE public.notifications ADD CONSTRAINT notifications_modul_check CHECK (modul = ANY (ARRAY['general'::text]));`, {}, /notificarile alertei nu trec regulile tabelului notifications \(23514/],
  ['o regulă pe notifications.type fără warning', `ALTER TABLE public.notifications ADD CONSTRAINT notifications_tip_check CHECK (type = ANY (ARRAY['info'::text, 'error'::text]));`, {}, /nu trec regulile tabelului notifications \(23514/],
  // runda 2 (L15): literalii sunt prezenți, dar regula exclude totuși 'error' — căutarea de text o lăsa să treacă
  ['o regulă cu warning și error care exclude totuși error', `ALTER TABLE public.notifications ADD CONSTRAINT notifications_tip_check CHECK (type = ANY (ARRAY['warning'::text, 'error'::text]) AND type <> 'error');`, {}, /nu trec regulile tabelului notifications \(23514/],
  ['o regulă pe lungimea titlului (sub 200)', `ALTER TABLE public.notifications ADD CONSTRAINT notifications_titlu_check CHECK (length(title) <= 150);`, {}, /nu trec regulile tabelului notifications \(23514/],
  ['un trigger care refuză notificările', `CREATE FUNCTION public.t_refuz() RETURNS trigger LANGUAGE plpgsql AS $t$BEGIN RAISE EXCEPTION 'refuz' USING ERRCODE = '42501'; END$t$; CREATE TRIGGER t_refuz BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_refuz();`, {}, /nu trec regulile tabelului notifications \(42501/],
  ['un trigger care anulează tăcut notificările', `CREATE FUNCTION public.t_nul() RETURNS trigger LANGUAGE plpgsql AS $t$BEGIN RETURN NULL; END$t$; CREATE TRIGGER t_nul BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_nul();`, {}, /nu se inscriu intregi in notifications \(proba_notificari:0\)/],
  ['niciun owner în profiles', `UPDATE public.profiles SET is_owner = false;`, {}, /niciun owner in profiles/],
  ['coloana cheie_intentie există deja', `ALTER TABLE public.upa_achizitii ADD COLUMN cheie_intentie uuid;`, {}, /reaplicare/],
  ['upa_achizitii ocupat (lock)', 'LOCK', {}, /BUGET_LOCK: upa_achizitii ocupat/],
]) {
  const db = await bazaNoua()
  if (pregatire && pregatire !== 'LOCK') await db.exec(pregatire)
  let m
  if (pregatire === 'LOCK') {
    // PGlite are o singură sesiune: lock-ul altei sesiuni se simulează cu un mutant care face LOCK-ul să pice (lock_not_available) la fiecare încercare
    const t = aplica(MIG, [['      LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;\n', "      RAISE EXCEPTION 'ocupat' USING ERRCODE = '55P03';\n"]])
    m = await eroare(aplicaMig(db, t, o))
  } else m = await eroare(aplicaMig(db, MIG, o))
  const neschimbat = (await q1(db, `SELECT to_regclass('public.upa_plafon_lunar') IS NULL AS a, (SELECT count(*)::int FROM pg_policy WHERE polname = 'upa_achizitii_citire') AS b`))
  ok(m && re.test(m) && neschimbat.a && neschimbat.b === 0, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('3b. MUTANT preflight: proba notificărilor doar cu „warning” -> regula care exclude „error” nu mai e refuzată (refuzul de mai sus e discriminant)')
{
  const db = await bazaNoua()
  await db.exec(`ALTER TABLE public.notifications ADD CONSTRAINT notifications_tip_check CHECK (type = ANY (ARRAY['warning'::text, 'error'::text]) AND type <> 'error');`)
  let m
  try { m = await eroare(aplicaMig(db, aplica(MIG, [["(v_owner, 'error', 'Administrativ', repeat('x', 200)", "(v_owner, 'warning', 'Administrativ', repeat('x', 200)"]]))) }
  catch (e) { m = 'mutantul nu se aplică: ' + e.message }
  ok(m === null, `fără proba pe „error”, migrarea trece pe o bază unde alerta de 3 zile ar pica (${m ? m.slice(0, 110) : 'a trecut, cum era de așteptat'})`)
  await db.close()
}

console.log('4. revenirea: aplicare -> revenire -> reaplicare; refuzuri')
const areCheie = async db => (await q1(db, `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.upa_achizitii'::regclass AND attname = 'cheie_intentie' AND NOT attisdropped`)).n === 1
for (const [politicaPublic, checkUid] of [[false, false], [true, false], [false, true], [true, true]]) {
  const forma = `${politicaPublic ? 'public' : 'authenticated'} / ${checkUid ? 'WITH CHECK uid' : 'fără WITH CHECK'}`
  const db = await bazaNoua({ politicaPublic, checkUid })
  // forma veche așteptată, scrisă de mână (nu citită din codul testat)
  const astept = `upa_achizitii_all | * | P | ${politicaPublic ? 'PUBLIC' : 'authenticated'} | (auth.uid() IS NOT NULL) | ${checkUid ? '(auth.uid() IS NOT NULL)' : '-'}`
  const inainte = await politiciAchizitii(db)
  await aplicaMig(db)
  const coment = (await q1(db, `SELECT obj_description(oid, 'pg_policy') AS c FROM pg_policy WHERE polname = 'upa_achizitii_citire'`)).c
  ok(coment.endsWith(` roluri_vechi=${politicaPublic ? 'public' : 'authenticated'} check_vechi=${checkUid ? 'uid' : 'gol'}`), `forma veche păstrată în comentariu (${forma}): ${coment}`)
  await revino(db)
  const dupa = await politiciAchizitii(db)
  const ramase = (await q1(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn\\_upa\\_%'`)).n
  ok(inainte === astept && dupa === astept && ramase === 0 && (await q1(db, `SELECT to_regclass('public.upa_luna_inchisa') IS NULL AS x`)).x && !(await areCheie(db)),
    `revenirea (${forma}): politica veche IDENTICĂ în catalog, obiectele + coloana cheie scoase (${dupa}, ${ramase} funcții)`)
  const nu = await caRol(db, 'authenticated', U.NO, `INSERT INTO public.upa_achizitii (luna, valoare, numar_factura) VALUES ('2031-05-01', 1, 'R') RETURNING id`)
  ok(!nu.err, 'după revenire: comportamentul vechi (orice cont logat scrie) — revenirea redeschide exact starea de dinainte')
  await db.exec(`DELETE FROM public.upa_achizitii WHERE numar_factura = 'R'`)
  await aplicaMig(db)
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `reaplicarea după revenire: același comportament (${ab.length} abateri)`)
  await db.close()
}
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261229a/],
  ['fără marcaj', async db => aplicaMig(db), { marcaj: false }, /garda invalida/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['o lună închisă (istoric nou)', async db => { await aplicaMig(db); await db.exec(ISTORIC); await rezervaLa(db, '2031-01-02') }, {}, /exista luni inchise/],
  ['jurnalul are rânduri', async db => { await aplicaMig(db); await setare(db, 'upa_alerta_zi', 'x'); await rezervaLa(db, '2020-01-02') }, {}, /jurnalul alertei are randuri/],
  ['plafonul schimbat din ecran', async db => { await aplicaMig(db); await caRol(db, 'authenticated', U.ED, 'SELECT public.fn_upa_plafon_seteaza(8000, 7000)') }, {}, /plafonul a fost schimbat din ecran/],
  // runda 2 (L14 / L15): orice abatere de la amprenta COMPLETĂ a obiectelor migrării = refuz, nimic scos
  ...[
    ['o politică schimbată după aplicare', `ALTER POLICY upa_achizitii_adaugare ON public.upa_achizitii WITH CHECK (true)`],
    ['politica de citire refăcută restrictivă (același nume, același comentariu)', `DROP POLICY upa_achizitii_citire ON public.upa_achizitii;
      CREATE POLICY upa_achizitii_citire ON public.upa_achizitii AS RESTRICTIVE FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
      COMMENT ON POLICY upa_achizitii_citire ON public.upa_achizitii IS 'x roluri_vechi=authenticated check_vechi=gol'`],
    ['o funcție rescrisă (același nume, alt corp)', `CREATE OR REPLACE FUNCTION public.fn_upa_lei(p numeric) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT 'x' $f$`],
    ['un drept nou pe o funcție', `GRANT EXECUTE ON FUNCTION public.fn_upa_luni(date, integer) TO anon`],
    ['proprietarul unei funcții schimbat', `CREATE ROLE altcineva_upa NOLOGIN; ALTER FUNCTION public.fn_upa_poate_scrie() OWNER TO altcineva_upa`],
    ['o funcție făcută SECURITY DEFINER', `ALTER FUNCTION public.fn_upa_luni(date, integer) SECURITY DEFINER`],
    ['un drept nou pe un tabel nou', `GRANT INSERT ON public.upa_plafon_lunar TO authenticated`],
    ['RLS oprit pe un tabel nou', `ALTER TABLE public.upa_alerta_jurnal DISABLE ROW LEVEL SECURITY`],
    ['RLS forțat pe upa_achizitii', `ALTER TABLE public.upa_achizitii FORCE ROW LEVEL SECURITY`],
    ['triggerul de nemodificare dezactivat', `ALTER TABLE public.upa_luna_inchisa DISABLE TRIGGER trg_upa_luna_inchisa_nemodificabil`],
    ['o coloană nouă pe un tabel al migrării', `ALTER TABLE public.upa_alerta_jurnal ADD COLUMN x integer`],
    ['o constrângere scoasă', `ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_resend`],
    ['un index nou pe un tabel al migrării', `CREATE INDEX upa_x_idx ON public.upa_plafon_lunar (setat_la)`],
    ['secvența jurnalului schimbată', `ALTER SEQUENCE public.upa_alerta_jurnal_id_seq INCREMENT BY 2`],
    ['cheia de intenție cu valoare implicită', `ALTER TABLE public.upa_achizitii ALTER COLUMN cheie_intentie SET DEFAULT gen_random_uuid()`],
  ].map(([n, sql]) => [n, async db => { await aplicaMig(db); await db.exec(sql) }, {}, /AMPRENTA obiectelor migrarii [0-9a-f]{32} \(asteptat [0-9a-f]{32}\)/]),
  ['UNIQUE-ul cheii scos', async db => { await aplicaMig(db); await db.exec(`ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_cheie_intentie_uidx`) }, {}, /starea nu e cea din 20261229a/],
  ['comentariul formei vechi șters', async db => { await aplicaMig(db); await db.exec(`COMMENT ON POLICY upa_achizitii_citire ON public.upa_achizitii IS NULL`) }, {}, /roluri_vechi \/ check_vechi\) lipseste/],
  ['comentariul fără check_vechi (forma din runda 1)', async db => { await aplicaMig(db); await db.exec(`COMMENT ON POLICY upa_achizitii_citire ON public.upa_achizitii IS 'UPA (20261229a): citire. roluri_vechi=authenticated'`) }, {}, /roluri_vechi \/ check_vechi\) lipseste/],
]) {
  const db = await bazaNoua()
  await pregatire(db)
  const stare = async () => JSON.stringify([await q1(db, `SELECT to_regclass('public.upa_plafon_lunar')::text AS t, (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.upa_achizitii'::regclass) AS n,
    (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'fn\\_upa\\_%') AS f`), await areCheie(db), await politiciAchizitii(db)])
  const inainte = await stare()
  const m = await eroare(revino(db, REV, o))
  const dupa = await stare()
  ok(m && re.test(m) && inainte === dupa, `revenire ${nume}: ${m ? m.slice(0, 140) : 'A TRECUT'}`)
  await db.close()
}

console.log('5. MUTANȚI (fiecare TREBUIE să pice: la aplicare sau la comportament)')
const POST_START = MIG.indexOf('DO $post$'), POST_SF = MIG.indexOf('END $post$;') + 'END $post$;'.length
const FARA_POST = [MIG.slice(POST_START, POST_SF), 'SELECT 1;']
const M_POLITICA = ['FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_upa_poate_scrie()));', 'FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);']
const M_VIEWER = ["AND u.access_level IN ('admin', 'editor')))\n$f$;", "AND u.access_level IN ('admin', 'editor', 'viewer')))\n$f$;"]
const M_PRAG = ['ELSE extract(day FROM v_azi)::integer >= v_prag AND', 'ELSE extract(day FROM v_azi)::integer > v_prag AND']
// cheia pe lună (o singură alertă pe lună în loc de una pe zi); constrângerea de formă e relaxată odată cu ea, ca mutantul să ajungă la comportament
const M_CHEIE = ["CASE p_fel WHEN 'zilnic' THEN 'zilnic:' || to_char(p_zi, 'YYYY-MM-DD')", "CASE p_fel WHEN 'zilnic' THEN 'zilnic:' || to_char(p_zi, 'YYYY-MM') || '-01'"]
const M_CHEIE_CHECK = ["(fel = 'zilnic' AND cheie = 'zilnic:' || to_char(zi, 'YYYY-MM-DD') AND", "(fel = 'zilnic' AND"]
// instantaneul lunii închise rescris la a doua rulare / fără trigger de nemodificare
const M_RESCRIE = ['IF NOT v_a.inchisa AND v_a.plafon IS NOT NULL THEN\n    INSERT', 'IF v_a.plafon IS NOT NULL THEN\n    INSERT']
const M_RESCRIE2 = ['    ON CONFLICT (luna) DO NOTHING\n    RETURNING i.luna INTO v_l;', '    ON CONFLICT (luna) DO UPDATE SET consumat = EXCLUDED.consumat, ramas_necheltuit = EXCLUDED.ramas_necheltuit\n    RETURNING i.luna INTO v_l;']
const M_FARA_TRIGGER = ['CREATE TRIGGER trg_upa_luna_inchisa_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_luna_inchisa\n  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();', '']
const M_PLAFON = ['WHERE p.luna <= date_trunc(\'month\', p_luna::timestamp)::date ORDER BY p.luna DESC LIMIT 1', 'ORDER BY p.luna DESC LIMIT 1']
const M_EROARE = ["           WHERE p_fel <> 'eroare' AND u.module IN ('administrativ', 'administrativ.upa')) d", "           WHERE u.module IN ('administrativ', 'administrativ.upa')) d"]
const M_DEST = ["IF v_e !~ '^[a-z0-9._%+-]{1,64}@gazpet[.]ro$' THEN RETURN NULL; END IF;", "IF v_e !~ '^[a-z0-9._%+-]{1,64}@[a-z.]+$' THEN RETURN NULL; END IF;"]
const M_SUB_PLAFON = ['AND coalesce(a.s, 0) < pl.plafon END', 'AND coalesce(a.s, 0) <= pl.plafon END']
const M_RAMAS = ["VALUES (v_a.luna, v_a.plafon, v_a.consumat, greatest(v_a.plafon - v_a.consumat, 0), v_a.nr_achizitii)", "VALUES (v_a.luna, public.fn_upa_plafon_la(p_azi), v_a.consumat, greatest(public.fn_upa_plafon_la(p_azi) - v_a.consumat, 0), v_a.nr_achizitii)"]
const M_CAS = ['  IF v_acum IS DISTINCT FROM p_vechi THEN', '  IF false THEN']
const M_DREPT_SET = ['  IF NOT public.fn_upa_poate_scrie() THEN\n    RAISE EXCEPTION \'upa: schimbarea plafonului', '  IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION \'upa: schimbarea plafonului']
const M_ACTIV = ['  IF NOT v_activ THEN\n    RETURN', '  IF false THEN\n    RETURN']
// runda 2: codurile de configurare scoase din răspuns / doar primul cod
const M_CFG_RASPUNS = ["'erori_config', to_jsonb(v_cfg), 'n', jsonb_array_length(v_rez)", "'erori_config', '[]'::jsonb, 'n', jsonb_array_length(v_rez)"]
const M_CFG_UNUL = ["CASE WHEN p_plafon IS NULL THEN 'fara_plafon' END", "CASE WHEN p_plafon IS NULL AND p_zi_prag IS NOT NULL THEN 'fara_plafon' END"]
// amprenta oprită: fără ea, ORICE schimbare a unui corp de funcție ar fi prinsă deja la aplicare — mutanții de comportament rulează fără ea
//   (iar un mutant separat arată că, păstrată, amprenta prinde la aplicare schimbarea unui corp)
const FARA_AMPRENTA = ["IF md5(coalesce(v_amp, '')) IS DISTINCT FROM", "IF false AND md5(coalesce(v_amp, '')) IS DISTINCT FROM"]
{
  const db = await bazaNoua()
  const m = await eroare(aplicaMig(db, aplica(MIG, [M_PRAG])))
  ok(/AMPRENTA obiectelor [0-9a-f]{32}/.test(m || ''), `MUTANT pragul exclusiv CU amprenta: prins la aplicare de amprentă (${(m || 'A TRECUT').slice(0, 110)})`)
  await db.close()
}
for (const [nume, lista0] of [
  ['codurile de configurare scoase din răspuns', [M_CFG_RASPUNS]],
  ['doar primul cod de configurare', [M_CFG_UNUL, FARA_POST]],
  ['politica de adăugare = orice cont logat', [M_POLITICA]],
  ['politica de adăugare = orice cont logat + fără postcondiții', [M_POLITICA, FARA_POST]],
  ['viewer-ul poate scrie', [M_VIEWER]],
  ['viewer-ul poate scrie + fără postcondiții', [M_VIEWER, FARA_POST]],
  ['pragul exclusiv (> în loc de >=)', [M_PRAG]],
  ['cheia zilnică pe lună', [M_CHEIE, M_CHEIE_CHECK, FARA_POST]],
  ['plafonul de azi retroactiv (fără luna <=)', [M_PLAFON, FARA_POST]],
  ['erorile notificate tuturor', [M_EROARE, FARA_POST]],
  ['destinatari din orice domeniu', [M_DEST]],
  ['destinatari din orice domeniu + fără postcondiții', [M_DEST, FARA_POST]],
  ['închiderea rescrie instantaneul la fiecare rulare', [M_RESCRIE, M_RESCRIE2, FARA_POST]],
  ['luna închisă fără trigger de nemodificare', [M_FARA_TRIGGER]],
  ['luna închisă fără trigger de nemodificare + fără postcondiții', [M_FARA_TRIGGER, FARA_POST]],
  ['alerta și la plafon atins (<=)', [M_SUB_PLAFON, FARA_POST]],
  ['închiderea cu plafonul lunii curente', [M_RAMAS, FARA_POST]],
  ['plafonul fără CAS', [M_CAS, FARA_POST]],
  ['plafonul fără dreptul de scriere', [M_DREPT_SET, FARA_POST]],
  ['comutatorul ignorat', [M_ACTIV, FARA_POST]],
]) {
  const lista = lista0.includes(FARA_POST) ? lista0 : [...lista0, FARA_AMPRENTA]
  const db = await bazaNoua()
  let t
  try { t = aplica(MIG, lista) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = !!m, cum = m ? 'la aplicare: ' + m.slice(0, 100) : ''
  if (!m) {
    let ab
    try { ab = [...await verifica(db)] } catch (e) { ab = ['excepție: ' + e.message] }
    prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 110)})`
  }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}

console.log('6. MUTANȚI pe codul edge-ului (fiecare TREBUIE prins de verificările edge-ului pe BD-ul migrării)')
for (const [nume, lista] of [
  ['5xx tratat ca eroare definitivă', [['rezultat = stareDupaTrimitere({ ok: res.ok, status: res.status })', "rezultat = res.ok ? { stare: 'trimis', eroare: null } : { stare: 'eroare', eroare: 'resend_4xx' }"]]],
  ['fără cheia de idempotență', [["'Idempotency-Key': await cheieIdempotenta(r.cheie) ", '']]],
  ['adresele în răspuns', [['rezervate: rez.n, ...contor, ...baza', 'rezervate: rez.n, ...contor, ...baza, dest: rez.randuri.map(x => x.destinatari)']]],
  ['trimite și fără cheia Resend', [["  if (!resendKey) return raspuns(500, { ok: false, error: 'resend_neconfigurat' })\n", '']]],
  ['subiectul fără zilele rămase', [[', ${zileText(Number(r.zile_ramase))}`\n  const html', '`\n  const html']]],
  ['ok:true și cu configurarea defectă', [['ok: contor.nemarcat === 0 && !cfg,', 'ok: contor.nemarcat === 0,']]],
]) {
  let mod
  try { mod = await importMutantEdge(aplica(EDGE_TEXT, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); continue }
  const db = await bazaNoua()
  await aplicaMig(db)
  let ab
  try { ab = await verificaEdge(db, mod.ruleazaAlertaUpa) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0, `MUTANT edge ${nume} — prins ${ab.length} abateri (${(ab[0] || '').slice(0, 110)})`)
  await db.close()
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
