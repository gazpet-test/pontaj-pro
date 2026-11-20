// Proba LOCALĂ a migrării 20270101a (Administrativ → UPA: contribuția pentru fondul de handicap calculată după răspunsul expertului contabil)
// pe PGlite — NU atinge nicio bază reală. Baza: scheletul 20261229a + supabase/tests/20270101a_administrativ_upa_calcul_schelet.sql
// (employees, pontaj_records, hr_decizii_semnatari), apoi 20261229a / b / c ca pe producție, apoi 20270101a ca la livrare (L15 v2).
// Valorile așteptate sunt calculate DE MÂNĂ în comentarii (L25: nu din codul testat). Cazurile expertului: sub jumătate / peste jumătate /
// reportare / angajat intrat la mijloc de lună / normă parțială / suspendat / CFS / administrator (+ încetat, inactiv fără dată, sub 50).
// Apoi: stările (previziune -> închis), blocajele, alerta (zilnică + închiderea + calcul blocat), edge-ul cu Resend simulat, drepturile ca
// non-owner, refuzurile migrării și ale revenirii, aplicare -> revenire -> reaplicare (+ revenirile c -> b -> a după), MUTANȚI.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_upa_calcul_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'upacalcul_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20270101a_administrativ_upa_calcul'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const MIG = citeste(F_MIG), REV = citeste(F_REV)
const NA = '20261229a_administrativ_upa_alerta', NB = '20261229b_administrativ_upa_numar_factura', NC = '20261229c_administrativ_upa_bucket'
const MIG_A = citeste(`supabase/migrations/${NA}.sql`), MIG_B = citeste(`supabase/migrations/${NB}.sql`), MIG_C = citeste(`supabase/migrations/${NC}.sql`)
const REV_A = citeste(`supabase/revenire/${NA}_ROLLBACK.sql`), REV_B = citeste(`supabase/revenire/${NB}_ROLLBACK.sql`), REV_C = citeste(`supabase/revenire/${NC}_ROLLBACK.sql`)
const SCHELET = citeste(`supabase/tests/${NA}_schelet.sql`) + '\n' + citeste(`supabase/tests/${NUME}_schelet.sql`)
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const MOD_EDGE = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/upaAlerta.mjs')).href)

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
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out.slice(0, 200))
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out.slice(0, 200))
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

console.log('0b. blocul AMPRENTA identic migrare / revenire; funcțiile refăcute = sursa din 20261229a; constantele md5 din preflight')
const blocAmprenta = t => { const i = t.indexOf('AMPRENTA_20270101a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20270101a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constante = t => [...t.matchAll(/'([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT/g)].map(x => x[1])
const sursaFn = (t, sig) => { const i = t.indexOf(sig); if (i < 0) return null; const a0 = t.indexOf('$f$', i) + 3; return t.slice(a0, t.indexOf('$f$;', a0)) }
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
{
  const bm = blocAmprenta(MIG), br = blocAmprenta(REV)
  ok(bm && bm.length > 3000 && bm === br, `blocul de calcul e identic (${bm?.length} / ${br?.length} caractere)`)
  const cm = constante(MIG), cr = constante(REV)
  ok(cm.length === 1 && cr.length === 1 && cm[0] === cr[0] && cm[0] !== '0'.repeat(32), `aceeași constantă în ambele fișiere (${cm} / ${cr})`)
  for (const [sig, fn] of [['CREATE FUNCTION public.fn_upa_campuri_intentie()', 'fn_upa_campuri_intentie()'], ['CREATE FUNCTION public.fn_upa_achizitie_adauga(', 'fn_upa_achizitie_adauga(uuid,jsonb)'],
    ['CREATE FUNCTION public.fn_upa_alerta_inscrie(', 'fn_upa_alerta_inscrie('], ['CREATE FUNCTION public.fn_upa_alerta_rezerva_la(', 'fn_upa_alerta_rezerva_la(date)'],
    ['CREATE FUNCTION public.fn_upa_alerta_proba()', 'fn_upa_alerta_proba()'], ['CREATE FUNCTION public.fn_upa_luna_inchisa_nemodificabil()', 'fn_upa_luna_inchisa_nemodificabil()'],
    ['CREATE FUNCTION public.fn_upa_poate_scrie()', 'fn_upa_poate_scrie()'], ['CREATE FUNCTION public.fn_upa_hash_intentie(', 'fn_upa_hash_intentie(jsonb)'],
    ['CREATE FUNCTION public.fn_upa_destinatari(', 'fn_upa_destinatari(text)'], ['CREATE FUNCTION public.fn_upa_lei(', 'fn_upa_lei(numeric)'],
    ['CREATE FUNCTION public.fn_upa_luna_text(', 'fn_upa_luna_text(date)'], ['CREATE FUNCTION public.fn_upa_zile_text(', 'fn_upa_zile_text(integer)']]) {
    const h = md5(sursaFn(MIG_A, sig))
    ok(MIG.includes(`('public.${fn}`) && new RegExp(`\\('public\\.${fn.replace(/[()]/g, '\\$&')}[^']*', '${h}'`).test(MIG), `preflight: ${fn} = md5 sursei din 20261229a (${h})`)
    if (/campuri|adauga|inscrie|rezerva_la|proba/.test(fn)) {
      const s = sursaFn(REV, sig.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
      ok(s !== null && md5(s) === h && new RegExp(`'${h}'`).test(REV), `revenirea reface ${fn} cu sursa EXACTĂ din 20261229a`)
    }
  }
}

// ── datele (fictive) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000a0001', ED: '00000000-0000-0000-0000-0000000a0002', VW: '00000000-0000-0000-0000-0000000a0003',
  AD: '00000000-0000-0000-0000-0000000a0004', NO: '00000000-0000-0000-0000-0000000a0005' }
const BAZA = `
INSERT INTO public.profiles (id, email, name, is_owner) VALUES ('${U.OWNER}', 'owner@gazpet.ro', 'OWNER TEST', true), ('${U.ED}', 'ed@gazpet.ro', 'EDITOR UPA', false),
  ('${U.VW}', 'vw@gazpet.ro', 'VIEWER UPA', false), ('${U.AD}', 'ad@gazpet.ro', 'ADMIN ADMINISTRATIV', false), ('${U.NO}', 'no@gazpet.ro', 'FARA DREPT', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ED}', 'administrativ.upa', 'editor'), ('${U.VW}', 'administrativ.upa', 'viewer'),
  ('${U.AD}', 'administrativ', 'admin'), ('${U.NO}', 'logistica', 'admin');
INSERT INTO public.logistica_setari (key, value) VALUES ('upa_plafon_lunar', '7000'), ('upa_alerta_activa', 'true'),
  ('upa_alerta_emails', ' Ana@gazpet.ro, ion@gazpet.ro, x@altundeva.ro '), ('upa_alerta_zi', '25');
INSERT INTO public.logistica_furnizori (id, nume, este_upa, activ, upa_valabil_pana) VALUES (1, 'UPA Unu SRL', true, true, '2040-01-01');`
// 60 de angajați întregi toată luna (ids 1..60) + cazurile expertului (ids 61..69). Octombrie 2026 = 31 de zile, noiembrie = 30.
const angajati = (n = 60) => `INSERT INTO public.employees (id, name, active, hire_date, procent_ocupare) SELECT g, 'ANGAJAT ' || g, true, DATE '2020-01-01', 100 FROM generate_series(1, ${n}) g;`
const SPECIALI = `
INSERT INTO public.employees (id, name, active, hire_date, termination_date, procent_ocupare) VALUES
  (61, 'INTRAT LA MIJLOC', true, '2026-10-16', NULL, 100),      -- oct: 16 zile (16..31); nov: 30
  (62, 'NORMA PARTIALA', true, '2020-01-01', NULL, 50),         -- oct: 31 x 0,5 = 15,5; nov: 15
  (63, 'INCETAT', false, '2020-01-01', '2026-10-10', 100),      -- oct: 10 zile (1..10, ziua încetării inclusă); nov: nu intră
  (64, 'CU CFS', true, '2020-01-01', NULL, 100),                -- oct: 31 - 5 CFS = 26; nov: 30
  (65, 'SUSPENDAT', true, '2020-01-01', NULL, 100),             -- oct: 31 - 3 SUSP = 28; nov: 30
  (66, 'ADMINISTRATOR', true, '2020-01-01', NULL, 100),         -- scos (hr_decizii_semnatari, Administrator)
  (67, 'INACTIV FARA DATA', false, '2020-01-01', NULL, 100),    -- scos (perioadă necunoscută) + avertisment (are pontaj în oct)
  (68, 'IMPUTERNICIT', true, '2020-01-01', NULL, 100),          -- intră (semnatar, dar nu administrator): 31 / 30
  (69, 'ANGAJAT IN DECEMBRIE', true, '2026-12-01', NULL, 100);  -- nu intră în oct / nov
INSERT INTO public.hr_decizii_semnatari (employee_id, calitate, este_reprezentant_legal) VALUES (66, 'Administrator', true), (68, 'Imputernicit', false);
INSERT INTO public.pontaj_records (employee_id, date, norma) SELECT 64, d::date, 'CFP' FROM generate_series(DATE '2026-10-05', DATE '2026-10-09', interval '1 day') d;
INSERT INTO public.pontaj_records (employee_id, date, norma) SELECT 65, d::date, 'SUSP' FROM generate_series(DATE '2026-10-20', DATE '2026-10-22', interval '1 day') d;
INSERT INTO public.pontaj_records (employee_id, date, norma) VALUES (1, '2026-10-02', 'CO'), (2, '2026-10-02', 'CM'), (3, '2026-10-02', 'N'), (67, '2026-10-01', NULL);`
// NMA octombrie (de mână): întregi 1..60 + 68 = 61 x 31 = 1891; 61: 16; 62: 15,5; 63: 10; 64: 26; 65: 28 -> 1986,5 / 31 = 64,0806 -> 64,08
//   (CO / CM / N nu scad: doar CFS și suspendarea). 4% x 64,08 = 2,5632 -> 2 locuri; D = 2 x 4.325 / 2 = 4.325,00; jumătate 2.162,50.
// NMA noiembrie: 61 x 30 = 1830; 61: 30; 62: 15; 64: 30; 65: 30 -> 1935 / 30 = 64,50 -> 2 locuri; D = 4.325,00.
const NMA_OCT = '64.08', NMA_NOV = '64.50', NR_OCT = 66, NR_NOV = 65

const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
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
const aplica = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
async function aplicaLivrare(db) {
  let jg = []
  try { jg = await caRunner(db, NUME, MIG, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message.slice(0, 300)) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270101a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, NUME, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)), `livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat`)
  return j
}
// baza ca pe producție: scheletul, datele, 20261229a / b / c aplicate
async function bazaProd({ date = BAZA + angajati() + SPECIALI } = {}) {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(date)
  await caRunner(db, NA, MIG_A)
  await caRunner(db, NB, MIG_B)
  await caRunner(db, NC, MIG_C)
  return db
}
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}
const calcul = async (db, luna, azi) => (await q1(db, 'SELECT public.fn_upa_calcul_la($1::date, $2::date) AS c', [luna, azi])).c
const rezerva = async (db, azi) => (await q1(db, 'SELECT public.fn_upa_alerta_rezerva_la($1::date) AS r', [azi])).r
const seteaza = (db, uid, cheie, deLa, val, vechi) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_parametru_seteaza($1, $2::date, $3::numeric, $4::numeric) AS r', [cheie, deLa, val, vechi])
const achizitie = (db, nr, luna, valoare, faraTva, plata) => db.query(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, data_factura, luna, valoare, valoare_fara_tva, data_plata)
  VALUES (1, $1, $2::date, $2::date, $3, $4, $5::date)`, [nr, luna, valoare, faraTva, plata])
const n = v => v === null || v === undefined ? null : Number(v)
const lista = v => Array.isArray(v) ? v : []

// ── scenariul A: peste jumătate în octombrie, reportul consumat în noiembrie; stările, blocajele, alerta. Întoarce abaterile. ──
async function scenariuA(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  // octombrie: 3.000 fără TVA plătită la timp (peste jumătate) + 500 plătită după termen (nu se deduce)
  await achizitie(db, 'F-A1', '2026-10-01', 3570, 3000, '2026-10-28')
  await achizitie(db, 'F-A2', '2026-10-01', 595, 500, '2026-11-03')
  // fără numărul angajaților cu handicap: blocat (nu se inventează 0)
  let c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(c.stare === 'previziune' && lista(c.blocaje).includes('fara_nr_handicap') && c.poate_inchide === false && c.suma_datorata === null,
    `fără nr. handicap: blocat, suma necunoscută (${JSON.stringify(c.blocaje)} ${c.suma_datorata})`)
  let r = await rezerva(db, '2026-11-13')
  tine(lista(r.erori_config).includes('fara_nr_handicap') && lista(r.erori_config).includes('calcul_neinchis') && lista(r.inchise).length === 0,
    `rezervarea fără nr. handicap: erori_config ${JSON.stringify(r.erori_config)}, nimic închis`)
  tine(Number((await q1(db, `SELECT count(*)::int AS n FROM public.upa_calcul_lunar`)).n) === 0, 'nimic închis fără nr. handicap')
  const s0 = await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  tine(!s0.err, `owner-ul pune nr. handicap 0 de la 01.10.2026 (${s0.err || 'ok'} ${s0.msg || ''})`)
  // ziua 12: previziune (pontajul încă deschis); valorile se calculează deja
  c = await calcul(db, '2026-10-01', '2026-11-12')
  tine(c.stare === 'previziune' && c.pontaj_inchis === false && c.poate_inchide === false && lista(c.avertismente).includes('pontaj_neinchis'),
    `12.11: previziune, pontajul deschis (${c.stare} ${c.pontaj_inchis} ${c.poate_inchide})`)
  tine(String(c.nma) === NMA_OCT || n(c.nma) === Number(NMA_OCT), `NMA octombrie = ${NMA_OCT} (primit ${c.nma})`)
  tine(c.nr_angajati === NR_OCT, `angajați în calcul oct = ${NR_OCT} (primit ${c.nr_angajati}; administratorul, inactivul fără dată și cel din dec. scoși)`)
  tine(c.locuri === 2 && n(c.suma_datorata) === 4325 && n(c.jumatate) === 2162.5, `locuri 2, D 4.325, jumătate 2.162,50 (${c.locuri} ${c.suma_datorata} ${c.jumatate})`)
  tine(n(c.achizitii_fara_tva) === 3000 && n(c.deducere) === 2162.5 && n(c.de_plata) === 2162.5 && n(c.report_iesit) === 837.5 && n(c.report_intrat) === 0,
    `peste jumătate: A 3.000 (fără cea plătită târziu), deducere 2.162,50, de plată 2.162,50, report 837,50 (${c.achizitii_fara_tva} ${c.deducere} ${c.de_plata} ${c.report_iesit})`)
  tine(lista(c.avertismente).includes('achizitii_platite_dupa_termen:1') && lista(c.avertismente).includes('inactivi_fara_data_incetarii_cu_pontaj:1'),
    `avertismente: plătită după termen, inactiv fără dată (${JSON.stringify(c.avertismente)})`)
  tine(c.termen_stat === '2026-11-25' && c.termen_upa === '2026-10-31', `termenele: stat 25.11, UPA 31.10 (${c.termen_stat} ${c.termen_upa})`)
  // noiembrie pe 12.11: reportul din previziunea lui octombrie (837,50), blocaj luna anterioară
  c = await calcul(db, '2026-11-01', '2026-11-12')
  tine(n(c.report_intrat) === 837.5 && lista(c.avertismente).includes('report_din_previziune') && lista(c.blocaje).includes('luna_anterioara_neinchisa'),
    `nov pe 12.11: report din previziune 837,50 (${c.report_intrat} ${JSON.stringify(c.blocaje)})`)
  // o factură fără valoarea fără TVA în octombrie: după lună = blocaj; luna nu se închide; notificare calcul_neinchis
  await db.query(`INSERT INTO public.upa_achizitii (furnizor_id, numar_factura, luna, valoare) VALUES (1, 'F-A3', '2026-10-01', 119)`)
  c = await calcul(db, '2026-10-01', '2026-11-13')
  tine(c.pontaj_inchis === true && c.poate_inchide === false && lista(c.blocaje).includes('achizitii_fara_tva:1') && lista(c.blocaje).includes('achizitii_fara_data_platii:1'),
    `13.11 cu o factură necompletată: blocat (${JSON.stringify(c.blocaje)})`)
  const notifInainte = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n)
  r = await rezerva(db, '2026-11-14')
  const nNeinchis = Number((await q1(db, `SELECT count(*)::int AS n FROM public.notifications`)).n) - notifInainte
  tine(r.luna_blocata === '2026-10-01' && lista(r.erori_config).includes('calcul_neinchis') && lista(r.inchise).length === 0 && nNeinchis === 4,
    `14.11: luna blocată oct, calcul_neinchis notificat owner + 3 Administrativ/UPA (${r.luna_blocata} +${nNeinchis} notificări)`)
  // completarea (ca editorul, prin RLS): valoarea fără TVA, apoi data plății
  const u1 = await caRol(db, 'authenticated', U.ED, `UPDATE public.upa_achizitii SET valoare_fara_tva = 100, data_plata = DATE '2026-10-30' WHERE numar_factura = 'F-A3' AND valoare_fara_tva IS NULL RETURNING id`)
  tine(u1.rows && u1.rows.length === 1, `editorul completează F-A3 (${u1.err || u1.rows.length})`)
  // 12.11 nu se închide (pontajul deschis): închiderea pornește din 13
  r = await rezerva(db, '2026-11-12')
  tine(lista(r.inchise).length === 0, '12.11: nimic închis (pontajul se închide din 13)')
  r = await rezerva(db, '2026-11-15')
  const inc = await q1(db, `SELECT * FROM public.upa_calcul_lunar WHERE luna = '2026-10-01'`)
  // cu F-A3: A = 3.000 + 100 = 3.100 -> deducere 2.162,50, de plată 2.162,50, report 937,50
  tine(inc && Number(inc.nma) === 64.08 && inc.nr_angajati === NR_OCT && Number(inc.suma_datorata) === 4325 && Number(inc.achizitii_fara_tva) === 3100
    && Number(inc.deducere) === 2162.5 && Number(inc.de_plata) === 2162.5 && Number(inc.report_iesit) === 937.5,
    `15.11: octombrie închis (${inc ? [inc.nma, inc.nr_angajati, inc.suma_datorata, inc.achizitii_fara_tva, inc.deducere, inc.de_plata, inc.report_iesit].join(' ') : 'lipsă'})`)
  tine(lista(r.inchise).length === 1 && r.inchis?.luna === '2026-10-01', `rezervarea raportează luna închisă (${JSON.stringify(r.inchise)})`)
  const det = (await db.query(`SELECT employee_id, zile_calcul, zile_cfs, zile_suspendare, norma::text AS norma FROM public.upa_calcul_angajat WHERE luna = '2026-10-01' ORDER BY employee_id`)).rows
  const d = id => det.find(x => x.employee_id === id)
  tine(det.length === NR_OCT && d(61)?.zile_calcul === 16 && d(62)?.norma === '0.5000' && d(63)?.zile_calcul === 10 && d(64)?.zile_cfs === 5
    && d(65)?.zile_suspendare === 3 && !d(66) && !d(67) && !d(69) && d(68)?.zile_calcul === 31 && d(1)?.zile_cfs === 0,
    `detaliul pe angajat (${det.length} rânduri; 61 ${d(61)?.zile_calcul}, 62 ${d(62)?.norma}, 63 ${d(63)?.zile_calcul}, 64 ${d(64)?.zile_cfs}, 65 ${d(65)?.zile_suspendare})`)
  const jr = await q1(db, `SELECT * FROM public.upa_alerta_jurnal WHERE cheie = 'inchidere:2026-10'`)
  tine(jr && Number(jr.plafon) === 4325 && Number(jr.consumat) === 3100 && Number(jr.ramas) === 2162.5 && jr.stare === 'rezervat' && jr.nr_destinatari === 2 && jr.nr_dest_ignorati === 1,
    `jurnalul închiderii: D / A / de plată, rezervat, 2 interni + 1 ignorat (${jr ? [jr.plafon, jr.consumat, jr.ramas, jr.stare, jr.nr_destinatari, jr.nr_dest_ignorati].join(' ') : 'lipsă'})`)
  const rr = lista(r.randuri).find(x => x.fel === 'inchidere')
  tine(rr && rr.calcul?.stare === 'definitiv' && n(rr.calcul?.de_plata) === 2162.5, `rândul de trimis are calculul definitiv (${rr?.calcul?.stare})`)
  r = await rezerva(db, '2026-11-15')
  tine(lista(r.inchise).length === 0 && lista(r.randuri).length === 0, 'a doua rulare în aceeași zi: nimic nou')
  // nemodificabil pe orice cale
  tine(/nu se modifica/.test(await eroare(db.query(`UPDATE public.upa_calcul_lunar SET de_plata = 0 WHERE luna = '2026-10-01'`)) || ''), 'luna închisă nu se modifică (UPDATE)')
  tine(/nu se modifica/.test(await eroare(db.query(`DELETE FROM public.upa_calcul_angajat WHERE luna = '2026-10-01'`)) || ''), 'detaliul nu se șterge')
  // diferența de după închidere se vede (achizitii_acum), instantaneul rămâne
  await achizitie(db, 'F-A4', '2026-10-01', 119, 100, '2026-10-30')
  c = await calcul(db, '2026-10-01', '2026-11-16')
  tine(c.stare === 'definitiv' && n(c.achizitii_fara_tva) === 3100 && n(c.achizitii_acum) === 3700, `după închidere: instantaneul 3.100, acum 3.700 (${c.achizitii_fara_tva} / ${c.achizitii_acum})`)
  // parametrii: o lună închisă nu se recalculează (UPA03), CAS (40001), dreptul (42501)
  let s = await seteaza(db, U.OWNER, 'salariu_minim', '2026-10-01', 5000, null)
  tine(s.err === 'UPA03', `salariul minim pe o lună închisă: UPA03 (${s.err || 'trecut'})`)
  s = await seteaza(db, U.OWNER, 'salariu_minim', '2026-07-01', 4400, 4325)
  tine(s.err === 'UPA03', `salariul minim din iulie (oct. îl folosește): UPA03 (${s.err || 'trecut'})`)
  s = await seteaza(db, U.ED, 'salariu_minim', '2027-01-01', 4600, null)
  tine(!s.err, `editorul pune salariul minim din 2027 (${s.err || 'ok'} ${s.msg || ''})`)
  s = await seteaza(db, U.ED, 'salariu_minim', '2027-01-01', 4700, null)
  tine(s.err === '40001', `CAS: valoarea văzută veche -> 40001 (${s.err || 'trecut'})`)
  for (const [cine, uid] of [['viewer', U.VW], ['fără drept', U.NO]]) {
    s = await seteaza(db, uid, 'angajati_handicap', '2027-01-01', 1, null)
    tine(s.err === '42501', `${cine}: parametrul refuzat 42501 (${s.err || 'trecut'})`)
  }
  s = await seteaza(db, U.OWNER, 'report_initial', '2026-10-01', 100, 0)
  tine(s.err === 'UPA03', `reportul inițial după prima lună închisă: UPA03 (${s.err || 'trecut'})`)
  // noiembrie: reportul definitiv 937,50 + 500 plătită -> 1.437,50 < 2.162,50: se deduce tot, de plată 2.887,50, report 0 (sub jumătate + reportare)
  // o factură încă neplătită în luna curentă: intră în previziune (plata se presupune la termen), cu avertisment
  await achizitie(db, 'F-N1', '2026-11-01', 595, 500, null)
  c = await calcul(db, '2026-11-01', '2026-11-24')
  tine(n(c.achizitii_fara_tva) === 500 && n(c.achizitii_neplatite) === 500 && lista(c.avertismente).includes('achizitii_neplatite:1'),
    `nov: factura neplătită încă intră în previziune (${c.achizitii_fara_tva} ${JSON.stringify(c.avertismente)})`)
  await db.query(`UPDATE public.upa_achizitii SET data_plata = '2026-11-20' WHERE numar_factura = 'F-N1'`)
  c = await calcul(db, '2026-11-01', '2026-11-24')
  tine(String(c.nma) === NMA_NOV || n(c.nma) === Number(NMA_NOV), `NMA noiembrie = ${NMA_NOV} (primit ${c.nma})`)
  tine(c.nr_angajati === NR_NOV && n(c.report_intrat) === 937.5 && n(c.deducere) === 1437.5 && n(c.de_plata) === 2887.5 && n(c.report_iesit) === 0
    && n(c.ramas_de_cumparat) === 725 && !lista(c.blocaje).length,
    `nov: report 937,50 + 500 -> deducere 1.437,50, de plată 2.887,50, report 0, mai sunt 725 de cumpărat (${[c.nr_angajati, c.report_intrat, c.deducere, c.de_plata, c.report_iesit, c.ramas_de_cumparat].join(' ')})`)
  // alerta zilei: înainte de prag (24) nimic; din 25: previziunea
  r = await rezerva(db, '2026-11-24')
  tine(lista(r.randuri).length === 0, '24.11 (înainte de prag): nicio alertă')
  r = await rezerva(db, '2026-11-25')
  const z = lista(r.randuri).find(x => x.fel === 'zilnic')
  tine(z && n(z.ramas) === 725 && n(z.plafon) === 1225 && n(z.consumat) === 500 && z.zile_ramase === 6 && z.calcul?.stare === 'previziune',
    `25.11: alerta previziunii (rămas 725, deducerea rămasă 1.225, cumpărat 500, 6 zile) (${z ? [z.ramas, z.plafon, z.consumat, z.zile_ramase].join(' ') : 'lipsă'})`)
  const nt = await q1(db, `SELECT title, message, type FROM public.notifications WHERE title LIKE 'Fond handicap noiembrie 2026 (previziune)%' LIMIT 1`)
  tine(nt && /mai sunt 725,00 lei de cumpărat/.test(nt.title) && /Previziune/.test(nt.message) && nt.type === 'warning', `notificarea zilei: ${nt?.title}`)
  r = await rezerva(db, '2026-11-25')
  tine(lista(r.randuri).length === 0, 'a doua rulare din 25.11: nicio alertă nouă')
  // cumpărat cât trebuie: nicio alertă (ramas 0)
  await achizitie(db, 'F-N2', '2026-11-01', 1000, 725, '2026-11-26')
  const sit = (await q1(db, `SELECT public.fn_upa_situatie('2026-11-26'::date, 3) AS s`)).s
  tine(sit.in_alerta === false && n(sit.luni[0].ramas_de_cumparat) === 0, `după 725 în plus: in_alerta false (${sit.in_alerta} ${sit.luni[0].ramas_de_cumparat})`)
  // noiembrie nu se închide înainte de 13.12; pe 13.12 da
  c = await calcul(db, '2026-11-01', '2026-12-12')
  tine(c.poate_inchide === false, '12.12: noiembrie încă previziune')
  r = await rezerva(db, '2026-12-13')
  const nov = await q1(db, `SELECT * FROM public.upa_calcul_lunar WHERE luna = '2026-11-01'`)
  // nov: A = 500 + 725 = 1.225; disponibil = 1.225 + 937,50 = 2.162,50 = jumătatea -> deducere 2.162,50, de plată 2.162,50, report 0
  tine(nov && Number(nov.deducere) === 2162.5 && Number(nov.de_plata) === 2162.5 && Number(nov.report_iesit) === 0 && Number(nov.report_intrat) === 937.5,
    `13.12: noiembrie închis (${nov ? [nov.report_intrat, nov.deducere, nov.de_plata, nov.report_iesit].join(' ') : 'lipsă'})`)
  return ab
}

// ── drepturile ca non-owner (L25) și salvarea din formular cu câmpurile noi ──
async function drepturi(db) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  const sit = await caRol(db, 'authenticated', U.VW, `SELECT public.fn_upa_situatie('2026-11-20'::date, 2) AS s`)
  tine(sit.rows && sit.rows[0].s.luni.length === 2, `viewer: situația (agregate) se citește (${sit.err || 'ok'})`)
  const an = await caRol(db, 'anon', null, `SELECT public.fn_upa_situatie('2026-11-20'::date, 2) AS s`)
  tine(an.err === '42501', `anon: situația refuzată (${an.err || 'trecut'})`)
  const emp = await caRol(db, 'authenticated', U.ED, `SELECT count(*) FROM public.employees`)
  tine(emp.err === '42501', `editorul nu citește employees direct (calculul trece prin DEFINER) (${emp.err || 'trecut'})`)
  const dto = await caRol(db, 'authenticated', U.OWNER, `SELECT public.fn_upa_calcul_detaliu('2026-10-01'::date) AS d`)
  tine(dto.rows && dto.rows[0].d.angajati.length > 0, `owner: detaliul pe angajat (${dto.err || dto.rows[0].d.angajati.length})`)
  for (const [cine, uid] of [['editor', U.ED], ['admin administrativ', U.AD], ['viewer', U.VW]]) {
    const de = await caRol(db, 'authenticated', uid, `SELECT public.fn_upa_calcul_detaliu('2026-10-01'::date) AS d`)
    tine(de.err === '42501', `${cine}: detaliul pe angajat refuzat (${de.err || 'trecut'})`)
  }
  const ins = await caRol(db, 'authenticated', U.OWNER, `INSERT INTO public.upa_parametri (cheie, de_la, valoare, sursa) VALUES ('salariu_minim', '2030-01-01', 1, 'migrare')`)
  tine(ins.err === '42501', `nimeni nu scrie direct în upa_parametri (${ins.err || 'trecut'})`)
  const inc = await caRol(db, 'authenticated', U.ED, `SELECT public.fn_upa_calcul_inchide('2026-10-01'::date) AS r`)
  tine(!inc.err, `editorul poate cere închiderea (${inc.err || JSON.stringify(inc.rows[0].r).slice(0, 80)})`)
  const inv = await caRol(db, 'authenticated', U.VW, `SELECT public.fn_upa_calcul_inchide('2026-10-01'::date) AS r`)
  tine(inv.err === '42501', `viewer: închiderea refuzată (${inv.err || 'trecut'})`)
  // salvarea din formular: valoarea fără TVA + data plății intră în intenție
  const K = '11111111-2222-4333-8444-555555555555'
  const rand = { furnizor_id: 1, numar_factura: 'R-1', data_factura: '2026-11-03', luna: '2026-11-01', valoare: 119, valoare_fara_tva: 100, data_plata: '2026-11-04' }
  const rpc = (uid, cheie, r) => caRol(db, 'authenticated', uid, 'SELECT public.fn_upa_achizitie_adauga($1::uuid, $2::jsonb) AS r', [cheie, JSON.stringify(r)])
  let x = await rpc(U.ED, K, rand)
  tine(x.rows && x.rows[0].r.stare === 'nou', `RPC: nou (${x.err || x.rows[0].r.stare} ${x.msg || ''})`)
  x = await rpc(U.ED, K, rand)
  tine(x.rows && x.rows[0].r.stare === 'existent', `RPC: reluarea = existent (${x.err || x.rows[0].r.stare})`)
  x = await rpc(U.ED, K, { ...rand, data_plata: '2026-11-05' })
  tine(x.err === 'UPA02', `RPC: aceeași cheie + altă dată a plății = UPA02 (${x.err || 'trecut'})`)
  x = await rpc(U.ED, K, { ...rand, valoare_fara_tva: 101 })
  tine(x.err === 'UPA02', `RPC: aceeași cheie + altă valoare fără TVA = UPA02 (${x.err || 'trecut'})`)
  const v = await q1(db, `SELECT valoare_fara_tva::text AS f, data_plata::text AS p FROM public.upa_achizitii WHERE numar_factura = 'R-1'`)
  tine(v && v.f === '100.00' && v.p === '2026-11-04', `rândul are valoarea fără TVA și data plății (${JSON.stringify(v)})`)
  x = await rpc(U.ED, '11111111-2222-4333-8444-555555555556', { ...rand, numar_factura: 'R-2', valoare_fara_tva: 120 })
  tine(x.err === '23514', `valoarea fără TVA > valoarea cu TVA: refuz 23514 (${x.err || 'trecut'})`)
  return ab
}

// ── sub 50 de angajați (bază separată, 40 de angajați): nicio obligație, achiziția se reportează, luna se închide fără mail ──
async function sub50(text = MIG) {
  const ab = []
  const tine = (c, m) => { if (!c) ab.push(m) }
  const db = await bazaProd({ date: BAZA + angajati(40) })
  try {
    await aplica(db, text)
    await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
    await achizitie(db, 'F-C1', '2026-10-01', 119, 100, '2026-10-15')
    const c = await calcul(db, '2026-10-01', '2026-11-20')
    tine(n(c.nma) === 40 && c.locuri === 0 && n(c.suma_datorata) === 0 && n(c.de_plata) === 0 && n(c.report_iesit) === 100 && lista(c.avertismente).includes('sub_50_angajati'),
      `sub 50 de angajați: nicio obligație, achiziția se reportează (${c.nma} ${c.locuri} ${c.suma_datorata} ${c.report_iesit})`)
    const r = await rezerva(db, '2026-11-20')
    tine(lista(r.inchise).length === 1 && lista(r.randuri).length === 0, 'sub 50: luna se închide, fără mail de plată (suma 0)')
  } catch (e) { ab.push('excepție sub 50: ' + e.message) }
  await db.close()
  return ab
}

console.log('1. aplicarea ca la livrare (L15 v2) după 20261229a / b / c; reaplicarea refuzată')
{
  const db = await bazaProd()
  const j = await aplicaLivrare(db)
  ok(j.some(m => /^20270101a: lock la \d+ ms de la BEGIN \(1 incercari/.test(m)), 'blocul de lock: o încercare')
  ok(/reaplicare/.test(await eroare(aplica(db)) || ''), 'reaplicarea refuzată')
  const p = (await db.query(`SELECT cheie, de_la::text AS d, valoare::text AS v, sursa FROM public.upa_parametri ORDER BY cheie`)).rows
  ok(p.length === 2 && p[0].cheie === 'report_initial' && p[0].d === '2026-10-01' && p[0].v === '0.00' && p[1].cheie === 'salariu_minim' && p[1].d === '2026-07-01' && p[1].v === '4325.00',
    `parametrii de start: ${JSON.stringify(p)}`)
  await db.close()
}

console.log('2. cazurile expertului, stările, blocajele, alerta (scenariul A: peste jumătate -> reportare -> sub jumătate)')
{
  const db = await bazaProd()
  await aplica(db)
  const ab = await scenariuA(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `scenariul A (${ab.length} abateri)`)
  const ad = await drepturi(db)
  ad.forEach(a => console.log('     ' + a))
  ok(ad.length === 0, `drepturile și salvarea din formular (${ad.length} abateri)`)
  await db.close()
}

console.log('3. sub jumătate; un angajat cu handicap; sub 50 de angajați')
{
  const db = await bazaProd()
  await aplica(db)
  await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  await achizitie(db, 'F-B1', '2026-10-01', 1190, 1000, '2026-10-15')
  let c = await calcul(db, '2026-10-01', '2026-11-20')
  // A 1.000 < 2.162,50: se plătește diferența întreagă 4.325 - 1.000 = 3.325, report 0
  ok(n(c.deducere) === 1000 && n(c.de_plata) === 3325 && n(c.report_iesit) === 0 && c.poate_inchide === true, `sub jumătate: deducere 1.000, de plată 3.325,00, report 0 (${c.deducere} ${c.de_plata} ${c.report_iesit})`)
  await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 1, 0)
  c = await calcul(db, '2026-10-01', '2026-11-20')
  // 2 locuri - 1 angajat cu handicap = 1 loc: D = 2.162,50, jumătate 1.081,25; A 1.000 -> deducere 1.000, de plată 1.162,50
  ok(c.locuri === 1 && n(c.suma_datorata) === 2162.5 && n(c.jumatate) === 1081.25 && n(c.de_plata) === 1162.5, `1 angajat cu handicap: 1 loc, D 2.162,50, de plată 1.162,50 (${c.locuri} ${c.suma_datorata} ${c.de_plata})`)
  await db.close()
  const ab = await sub50()
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `sub 50 de angajați (${ab.length} abateri)`)
}

console.log('4. edge-ul (ruleazaAlertaUpa) pe BD-ul migrării, cu Resend simulat: închiderea și alerta zilei')
{
  const db = await bazaProd()
  await aplica(db)
  await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null)
  await achizitie(db, 'F-E1', '2026-10-01', 3570, 3000, '2026-10-28')
  let azi = '2026-11-14'
  const sb = { rpc: async (nume, a) => {
    try {
      if (nume === 'fn_upa_alerta_rezerva') return { data: await rezerva(db, azi), error: null }
      if (nume === 'fn_upa_alerta_marcheaza') return { data: (await q1(db, 'SELECT public.fn_upa_alerta_marcheaza($1, $2, $3, $4) AS n', [a.p_id, a.p_stare, a.p_resend_id, a.p_eroare])).n, error: null }
      return { data: null, error: { code: 'PGRST202' } }
    } catch (e) { return { data: null, error: { code: e.code, message: e.message } } }
  } }
  const trimise = []
  const fetchFn = async (url, o) => { trimise.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 're_' + trimise.length }) } }
  let x = await MOD_EDGE.ruleazaAlertaUpa({ sb, fetchFn, resendKey: 'k' })
  ok(x.status === 200 && x.body.ok === true && x.body.trimis === 1 && trimise.length === 1, `14.11: un mail trimis (${JSON.stringify(x.body).slice(0, 160)})`)
  ok(/^Fond handicap octombrie 2026: de plată la bugetul de stat 2\.162,50 lei până pe 25\.11\.2026$/.test(trimise[0]?.subject || ''), `subiectul închiderii: ${trimise[0]?.subject}`)
  ok(/Număr mediu de angajați/.test(trimise[0]?.html) && /64\.08/.test(trimise[0]?.html) && /837,50/.test(trimise[0]?.html) && JSON.stringify(trimise[0]?.to) === '["ana@gazpet.ro","ion@gazpet.ro"]',
    'corpul închiderii: NMA, reportul, doar destinatarii interni')
  ok((await q1(db, `SELECT stare FROM public.upa_alerta_jurnal WHERE cheie = 'inchidere:2026-10'`)).stare === 'trimis', 'jurnalul: trimis')
  azi = '2026-11-25'
  x = await MOD_EDGE.ruleazaAlertaUpa({ sb, fetchFn, resendKey: 'k' })
  // nov: jumătate 2.162,50 - report 837,50 - 0 cumpărat = 1.325 de cumpărat
  ok(x.body.trimis === 1 && /^Fond handicap noiembrie 2026 \(previziune\): mai sunt 1\.325,00 lei de cumpărat de la unități protejate, mai sunt 6 zile$/.test(trimise[1]?.subject || ''),
    `25.11: alerta previziunii: ${trimise[1]?.subject}`)
  ok(/30\.11\.2026/.test(trimise[1]?.html) && /25\.12\.2026/.test(trimise[1]?.html), 'corpul previziunii: termenul UPA (30.11) și termenul la stat (25.12)')
  await db.close()
}

console.log('5. refuzurile migrării (nimic schimbat)')
for (const [nume, pregatire, o, re] of [
  ['fără marcajul runnerului', null, { marcaj: false }, /garda start invalida/],
  ['fără plafon', null, { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['fără amprenta globală L15 v2', null, { l15: 'nimic' }, /AMPRENTA_GLOBALA_LIPSA/],
  ['fn_upa_alerta_proba schimbată față de 20261229a', `CREATE OR REPLACE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{}'::jsonb $f$;`, {}, /fn_upa_alerta_proba\(\) nu e exact cea din 20261229a/],
  ['drept în plus pe fn_upa_alerta_rezerva_la', `GRANT EXECUTE ON FUNCTION public.fn_upa_alerta_rezerva_la(date) TO authenticated;`, {}, /fn_upa_alerta_rezerva_la\(date\) nu e exact/],
  ['employees.procent_ocupare lipsă', `ALTER TABLE public.employees DROP COLUMN procent_ocupare;`, {}, /coloana employees\.procent_ocupare lipseste/],
  ['pontaj_records.norma cu alt tip', `ALTER TABLE public.pontaj_records ALTER COLUMN norma TYPE integer USING NULL;`, {}, /coloana pontaj_records\.norma lipseste sau are alt tip/],
  ['hr_decizii_semnatari lipsă', `DROP TABLE public.hr_decizii_semnatari;`, {}, /coloana hr_decizii_semnatari\.employee_id lipseste/],
  ['coloana valoare_fara_tva există deja', `ALTER TABLE public.upa_achizitii ADD COLUMN valoare_fara_tva numeric;`, {}, /reaplicare/],
  ['upa_achizitii ocupat (lock)', 'LOCK', {}, /BUGET_LOCK: upa_achizitii ocupat/],
]) {
  const db = await bazaProd()
  if (pregatire && pregatire !== 'LOCK') await db.exec(pregatire)
  const text = pregatire === 'LOCK' ? MIG.replace('      LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;\n', "      RAISE EXCEPTION 'ocupat' USING ERRCODE = '55P03';\n") : MIG
  const m = await eroare(aplica(db, text, o))
  const neschimbat = (await q1(db, `SELECT to_regclass('public.upa_parametri') IS NULL AS a`)).a
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('6. revenirea: aplicare -> revenire -> reaplicare; apoi revenirile c -> b -> a; refuzuri')
{
  const db = await bazaProd()
  await aplica(db)
  let m = await eroare(revino(db))
  ok(m === null, 'revenirea pe o bază fără date noi: ' + (m || 'ok'))
  const st = await q1(db, `SELECT to_regclass('public.upa_parametri') IS NULL AS a, (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.upa_achizitii'::regclass AND attname IN ('valoare_fara_tva', 'data_plata') AND NOT attisdropped) AS c,
    md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_upa_alerta_rezerva_la(date)'::regprocedure), chr(13), '')) AS h`)
  ok(st.a && st.c === 0 && st.h === md5(sursaFn(MIG_A, 'CREATE FUNCTION public.fn_upa_alerta_rezerva_la(')), `obiectele scoase, rezervarea veche refăcută (${JSON.stringify(st)})`)
  m = await eroare(aplica(db))
  ok(m === null, 'reaplicarea după revenire: ' + (m || 'ok'))
  m = await eroare(revino(db))
  ok(m === null, 'a doua revenire: ' + (m || 'ok'))
  m = (await eroare(caRunner(db, NC + '_ROLLBACK', REV_C, { l15: 'nimic', plafon: PLAFON_REVENIRE }))) || (await eroare(caRunner(db, NB + '_ROLLBACK', REV_B, { l15: 'nimic', plafon: PLAFON_REVENIRE })))
    || (await eroare(caRunner(db, NA + '_ROLLBACK', REV_A, { l15: 'nimic', plafon: PLAFON_REVENIRE })))
  ok(m === null, 'după revenirea 20270101a, revenirile 20261229c -> b -> a trec (amprentele lor sunt neatinse): ' + (m || 'ok'))
  await db.close()
  // alerta veche merge din nou după revenire (forma din 20261229a), pe o bază separată
  const db2 = await bazaProd()
  await aplica(db2)
  await revino(db2)
  const rv = (await q1(db2, `SELECT public.fn_upa_alerta_rezerva_la('2031-01-26'::date) AS r`)).r
  ok(rv && rv.activ === true && Array.isArray(rv.randuri) && !('inchise' in rv), 'rezervarea din 20261229a rulează după revenire (forma veche)')
  await db2.close()
}
for (const [nume, pregatire, re] of [
  ['un parametru din ecran', async db => { await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null) }, /parametrii au fost schimbati/],
  ['calculul închis', async db => { await seteaza(db, U.OWNER, 'angajati_handicap', '2026-10-01', 0, null); await rezerva(db, '2026-11-20') }, /exista luni cu calculul inchis/],
  ['o achiziție cu valoarea fără TVA', async db => { await achizitie(db, 'X-1', '2026-10-01', 119, 100, null) }, /valoarea fara TVA sau data platii/],
  ['un index nou pe upa_parametri (amprenta)', async db => { await db.exec(`CREATE INDEX upa_parametri_x ON public.upa_parametri (valoare)`) }, /AMPRENTA obiectelor/],
  ['un drept în plus pe fn_upa_situatie (amprenta)', async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_upa_situatie(date, integer) TO anon`) }, /AMPRENTA obiectelor/],
  ['un index pe coloana nouă (dependența)', async db => { await db.exec(`CREATE INDEX upa_ach_x ON public.upa_achizitii (data_plata)`) }, /AMPRENTA obiectelor/],
  ['fără marcajul runnerului', null, /garda invalida/],
]) {
  const db = await bazaProd()
  await aplica(db)
  if (pregatire) await pregatire(db)
  const m = await eroare(revino(db, REV, nume === 'fără marcajul runnerului' ? { marcaj: false } : {}))
  const ramas = (await q1(db, `SELECT to_regclass('public.upa_parametri') IS NOT NULL AS a`)).a
  ok(m && re.test(m) && ramas, `revenirea refuzată: ${nume}: ${m ? m.slice(0, 140) : 'A TRECUT'}`)
  await db.close()
}

console.log('7. MUTANȚI (amprenta oprită, ca să se vadă că probele de comportament îi prind; fiecare TREBUIE să pice)')
const FARA_AMPRENTA = t => t.replace(/IF md5\(coalesce\(v_amp, ''\)\) IS DISTINCT FROM '[0-9a-f]{32}' THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT/, "IF false THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT")
const unic = (t, din, in_) => { if (t.split(din).length !== 2) throw new Error('textul mutantului nu e unic: ' + din.slice(0, 80)); return t.split(din).join(in_) }
{
  // mutantul fără schimbare: amprenta oprită trebuie să treacă toate probele (altfel mutanții nu dovedesc nimic)
  const db = await bazaProd()
  await aplica(db, FARA_AMPRENTA(MIG))
  const ab = [...await scenariuA(db), ...await drepturi(db), ...await sub50(FARA_AMPRENTA(MIG))]
  ok(ab.length === 0, `martorul (doar amprenta oprită): ${ab.length} abateri ${ab[0] || ''}`)
  await db.close()
}
for (const [nume, din, in_] of [
  ['administratorul nu se scoate', "AND lower(btrim(s.calitate)) = 'administrator'))", 'AND false))'],
  ['CFS citit pe alt cod', "upper(btrim(p.norma)) = 'CFP')::integer", "upper(btrim(p.norma)) = 'CFS')::integer"],
  ['suspendarea ignorată', "FILTER (WHERE upper(btrim(p.norma)) = 'SUSP')::integer", 'FILTER (WHERE false)::integer'],
  ['ziua încetării exclusă', '(e.d1 - e.d0 + 1), c.cfs, c.susp', '(e.d1 - e.d0), c.cfs, c.susp'],
  ['data angajării ignorată', 'greatest(coalesce(em.hire_date, z.l0), z.l0) AS d0', 'z.l0 AS d0'],
  ['norma ignorată', '(coalesce(em.procent_ocupare, 100) / 100.0)::numeric(6,4) AS norma', '(1.0)::numeric(6,4) AS norma'],
  ['rotunjire în sus a locurilor', 'floor(v_nma * 0.04)::integer', 'ceil(v_nma * 0.04)::integer'],
  ['pragul de 50 scos', 'CASE WHEN v_nma < 50 THEN 0 ELSE', 'CASE WHEN false THEN 0 ELSE'],
  ['deducerea fără plafonul de jumătate', 'v_ded := least(v_a + v_rin, v_jum);', 'v_ded := least(v_a + v_rin, v_d);'],
  ['reportul definitiv ignorat', 'SELECT c.report_iesit INTO v_rin FROM public.upa_calcul_lunar c', 'SELECT 0 INTO v_rin FROM public.upa_calcul_lunar c'],
  ['plata după termen numărată', 'FILTER (WHERE a.data_plata <= v_l1), 0)', 'FILTER (WHERE a.data_plata IS NOT NULL), 0)'],
  ['neplătitele nu intră în previziune', 'v_a := v_a + v_neplatit;', 'v_a := v_a;'],
  ['fără TVA lipsă nu blochează', "IF v_final THEN v_bl := v_bl || ('achizitii_fara_tva:'", "IF false THEN v_bl := v_bl || ('achizitii_fara_tva:'"],
  ['data plății lipsă nu blochează', "IF v_fplata > 0 THEN v_bl := v_bl || ('achizitii_fara_data_platii:'", "IF false THEN v_bl := v_bl || ('achizitii_fara_data_platii:'"],
  ['pontajul închis o zi mai devreme', "interval '1 month' + interval '11 days')::date", "interval '1 month' + interval '10 days')::date"],
  ['prima lună fără reportul inițial', "v_rin := public.fn_upa_parametru_la('report_initial', v_l);", 'v_rin := 100;'],
  ['pragul zilei ignorat', 'extract(day FROM v_azi)::integer >= v_prag AND', 'true AND'],
  ['luna închisă recalculabilă', 'IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna >= p_de_la', 'IF false AND EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna >= p_de_la'],
  ['CAS-ul parametrilor scos', "  IF v_acum IS DISTINCT FROM p_vechi THEN\n    RAISE EXCEPTION 'upa: parametrul s-a schimbat", "  IF false THEN\n    RAISE EXCEPTION 'upa: parametrul s-a schimbat"],
  ['detaliul pe angajat pentru oricine', "IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN\n    RAISE EXCEPTION 'upa: detaliul", "IF auth.uid() IS NULL THEN\n    RAISE EXCEPTION 'upa: detaliul"],
  ['închiderea fără drept', "  IF NOT public.fn_upa_poate_scrie() THEN\n    RAISE EXCEPTION 'upa: inchiderea calculului", "  IF false THEN\n    RAISE EXCEPTION 'upa: inchiderea calculului"],
  ['termenul la stat pe 26', "'termen_stat', (v_l + interval '1 month')::date + 24,\n    'blocaje', to_jsonb(v_bl)", "'termen_stat', (v_l + interval '1 month')::date + 25,\n    'blocaje', to_jsonb(v_bl)"],
  ['calcul_neinchis doar owner-ului', "WHERE (p_fel <> 'eroare' OR p_cod = 'calcul_neinchis')", "WHERE (p_fel <> 'eroare')"],
  ['intenția fără data plății', "'valoare_fara_tva', 'data_plata']::text[]", "'valoare_fara_tva']::text[]"],
]) {
  let t
  try { t = unic(FARA_AMPRENTA(MIG), din, in_) } catch (e) { ok(false, `MUTANT ${nume}: nu se aplică (${e.message})`); continue }
  const db = await bazaProd()
  let prins = false, cum = ''
  const m = await eroare(aplica(db, t))
  if (m) { prins = true; cum = 'la aplicare: ' + m.slice(0, 90) }
  else {
    let ab = []
    try { ab = [...await scenariuA(db), ...await drepturi(db)] } catch (e) { ab = ['excepție: ' + e.message] }
    if (!ab.length) ab = await sub50(t)
    prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 100)})`
  }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}

console.log(esec ? `\nPICAT: ${esec} verificări` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
