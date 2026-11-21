// Proba LOCALĂ a migrării 20270106a (Execuție → „🔔 Semnale”, faza 1 a agentului verificator) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală.
// Baza: schema falsă supabase/tests/20270106a_executie_semnale_schelet.sql + lanțul de drept pe proiect extras EXACT din 20261209a (amprentele =
//   constantele din migrare, verificat).
// Aplicarea: ca runnerul — marcaj + plafon 5000 + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh (aceleași funcții ca runnerul): întâi
//   generarea manifestului (GLOBAL aprobat „-”, ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și
//   garda finală REALĂ a runnerului + COMMIT. Lista obiectelor din manifest = supabase/tests/20270106a_executie_semnale.l15.obiecte.tsv
//   (`--scrie-obiecte` o regenerează; PG18 adaugă constrângerile NOT NULL, ignorate: producția e PG17).
// 1. VERIFICĂRILE de comportament (valorile așteptate scrise de mână, L25), ca rolul fiecărui cont: owner, managerul de proiect (MP) al P1, MP al P1
//    RESTRÂNS pe P2 (20261209a), responsabilul unui semnal, șeful de șantier (profile_sites), acces general admin / viewer pe modul, cont fără drept,
//    MP al P2, fără JWT, anonim; agentul = service_role fără JWT. Creare / dedup / actualizare / validare; citirea (tabel, vedere, jurnal); scrierile
//    directe; starea omului (CAS, motiv, tranziții, responsabil); respins / rezolvat nu reapare cu aceeași dovadă, se redeschide cu dovadă nouă;
//    agentul nu atinge starea / motivul / responsabilul omului; omul nu rescrie constatarea (și pe calea directă, ca postgres).
// 2. Refuzurile migrării (marcaj, plafon, fără amprenta globală, tabela „înainte” veche, lanțul de drept schimbat, coloane lipsă, bugetul lock-ului).
// 3. Revenirea (refuz cu date, definiții / structură / ACL schimbate, aplicare -> revenire -> re-aplicare).
// 4. MUTANȚI ai migrării: fiecare TREBUIE să pice (la aplicare, la verificări sau prin detectorul lui).
// 5. Paritatea tranzițiilor: blocul TRANZITII din migrare = TRANZITII din src/executieSemnaleLogica.js + aceleași răspunsuri pe toate combinațiile (L19).
// 6. Dry-run-ul pentru clonă (supabase/tests/20270106a_executie_semnale_dryrun.sql) rulat aici întreg, pe baza cu migrarea aplicată.
// Ce NU probează PGlite (o singură conexiune): concurența reală (două sesiuni) — pe clonă, de coordonator.
// Rulare (din rădăcina repo-ului; cere bash în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_semnale_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { amprente, amprenteRevenire, md5 } from '../executie_semnale_amprente.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'semnale_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20270106a_executie_semnale'
const SCHELET = citeste('supabase/tests/20270106a_executie_semnale_schelet.sql')
const MIG = citeste('supabase/migrations/20270106a_executie_semnale.sql')
const REV = citeste('supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql')
const M09 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const DRY = citeste('supabase/tests/20270106a_executie_semnale_dryrun.sql')
const OBIECTE_CALE = 'supabase/tests/20270106a_executie_semnale.l15.obiecte.tsv'
const OBIECTE = existsSync(join(ROOT, OBIECTE_CALE)) ? citeste(OBIECTE_CALE) : ''
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── 0. lanțul de drept, EXACT ca în 20261209a (corpul + ACL-urile); amprentele = constantele din migrare ──
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = text.indexOf(';', text.indexOf(a[1], startCorp) + a[1].length) + 1
  return text.slice(i, sfarsit).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
}
const acl = (text, nume) => text.split('\n').filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
const LANT = [
  ['fn_executie_acces_nerestrans_cont', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '9a07e0089139e54ba5c6a0cfaaf093cc'],
  ['fn_executie_acces_lista_cont', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', 'e7cf9b852002a1c1cbe781772c33bf0c'],
  ['fn_executie_acces_nerestrans', 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'],
  ['fn_executie_acces_lista', 'CREATE FUNCTION public.fn_executie_acces_lista(', 'd9e123a46b83530a7203d4a24da5cf9b'],
  ['fn_executie_proiect_permis', 'CREATE FUNCTION public.fn_executie_proiect_permis(', 'bd4320f76e9f36f492c7186c0a982155'],
]
let SQL_LANT = ''
console.log('0. lanțul de drept extras din 20261209a (amprentele = constantele din 20270106a)')
for (const [nume, cap, amp] of LANT) {
  const f = functie(M09, cap)
  const corp = f.slice(f.indexOf('$f$') + 3, f.lastIndexOf('$f$'))
  ok(md5(corp) === amp && MIG.includes(`'${amp}'`), `${nume}: ${md5(corp)}`)
  SQL_LANT += f + '\n' + acl(M09, nume) + '\n'
}
// restricția pe proiect din 20261209a pe executie_proiecte (politica RESTRICTIVĂ pe rând), ca vederea security_invoker s-o moștenească
SQL_LANT += `CREATE POLICY executie_acces_proiect_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(id::bigint, false));\n`

// ── 0b. validatorul REAL al runnerului pe fișierele exacte din repo (octeții lor) ──
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const validator = (fisier, plafon) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', '--plafon-tranzactie-ms', String(plafon)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
console.log('0b. validatorul runnerului (cu plafon) pe migrare și pe revenire')
{
  ok(PLAFON_LIVRARE === 5000 && MIG.includes(`IS DISTINCT FROM '${PLAFON_LIVRARE}/session'`), `migrarea cere exact plafonul runnerului L15 v2 (AG_PLAFON_MS = ${PLAFON_LIVRARE})`)
  const vm = validator(join(ROOT, 'supabase/migrations/20270106a_executie_semnale.sql'), PLAFON_LIVRARE)
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu plafonul runnerului: ' + vm.out)
  const vr = validator(join(ROOT, 'supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql'), PLAFON_REVENIRE)
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu plafonul ei: ' + vr.out)
  const vm2 = validator(join(ROOT, 'supabase/migrations/20270106a_executie_semnale.sql'), 2000)
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea (cere 5000) cu runnerul la 2000 = refuz: ' + vm2.out.slice(0, 120))
  const vr2 = validator(join(ROOT, 'supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql'), PLAFON_LIVRARE)
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea (cere 2000) cu runnerul la 5000 = refuz: ' + vr2.out.slice(0, 120))
}

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000a1', MP_P1: '00000000-0000-0000-0000-0000000000a2', MP_P1_RESTRANS: '00000000-0000-0000-0000-0000000000a3',
  RESP: '00000000-0000-0000-0000-0000000000a4', SEF: '00000000-0000-0000-0000-0000000000a5', ADMIN: '00000000-0000-0000-0000-0000000000a6',
  VIEWER: '00000000-0000-0000-0000-0000000000a7', FARA: '00000000-0000-0000-0000-0000000000a8', MP_P2: '00000000-0000-0000-0000-0000000000a9',
}
// angajații: 10 = MP P1, 11 = responsabilul, 12 = șeful de șantier, 13 = MP P2, 14 = alt angajat activ, 15 = inactiv
const DATE = `
INSERT INTO public.employees (id, name, active) VALUES (10, 'MP P1', true), (11, 'RESPONSABIL', true), (12, 'SEF SANTIER', true), (13, 'MP P2', true),
  (14, 'ALTUL', true), (15, 'PLECAT', false);
SELECT setval(pg_get_serial_sequence('public.employees', 'id'), 100);
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES
  ('${U.OWNER}', 'OWNER', true, NULL), ('${U.MP_P1}', 'MP P1', false, 10), ('${U.MP_P1_RESTRANS}', 'MP P1 restrans pe P2', false, 10),
  ('${U.RESP}', 'RESP', false, 11), ('${U.SEF}', 'SEF', false, 12), ('${U.ADMIN}', 'ADMIN', false, NULL),
  ('${U.VIEWER}', 'VIEWER', false, 14), ('${U.FARA}', 'FARA', false, NULL), ('${U.MP_P2}', 'MP P2', false, 13);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.MP_P1}', 'executie', 'editor'), ('${U.MP_P1_RESTRANS}', 'executie', 'editor'), ('${U.RESP}', 'executie', 'viewer'), ('${U.SEF}', 'executie', 'viewer'),
  ('${U.ADMIN}', 'executie', 'admin'), ('${U.VIEWER}', 'executie', 'viewer'), ('${U.FARA}', 'hr', 'admin'), ('${U.MP_P2}', 'executie', 'editor');
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (1, 'P1', 'Proiect unu', 10), (2, 'P2', 'Proiect doi', 13), (3, 'P3', 'Proiect trei', NULL);
SELECT setval(pg_get_serial_sequence('public.executie_proiecte', 'id'), 100);
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.MP_P1_RESTRANS}', 2, 'editor');
INSERT INTO public.sites (id, name, proiect_id) VALUES (100, 'Santier P1', 1);
INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES ('${U.SEF}', 100, NULL);`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(SQL_LANT)
  await db.exec(DATE)
  return db
}
// ca runnerul: plafon + marcaje + (opțional) pașii L15 v2 generați. l15: 'livrare' (înainte aprobat + după cu manifest), 'inainte', 'nimic'.
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
    t = t.split(din).join(in_)
  }
  return t
}
// bugetul lock-ului: textele EXACTE ale încercării (mutanții / injecțiile pică dacă textul nu mai există)
const LOCK_1 = '      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n'
const LOCK_2_EXIT = '      LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
const LOCK_PAUZA = '    EXCEPTION WHEN lock_not_available THEN\n      PERFORM pg_sleep(0.05);\n'
const BUGET_INAINTE = "  LOOP\n    IF clock_timestamp() >= v_t0 + v_buget THEN\n      RAISE EXCEPTION '20270106a: BUGET_LOCK: % incercari"
const BUGET_DUPA = "  IF clock_timestamp() >= v_t0 + v_buget THEN\n    RAISE EXCEPTION '20270106a: BUGET_LOCK: lock-urile obtinute"
const lockLent = t => aplica(t, [[LOCK_2_EXIT, '      LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])
const coliziune = (t, n) => aplica(t, [[LOCK_2_EXIT, `      IF v_incercari <= ${n} THEN RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03'; END IF;\n` + LOCK_2_EXIT],
  [LOCK_PAUZA, "    EXCEPTION WHEN lock_not_available THEN\n      RAISE NOTICE 'TEST_LOCK_PARTIAL %', (SELECT count(*) FROM pg_locks l WHERE l.pid = pg_backend_pid() AND l.granted AND l.mode = 'ShareRowExclusiveLock'\n        AND l.relation = 'public.executie_proiecte'::regclass);\n      PERFORM pg_sleep(0.05);\n"]])

// o instrucțiune ca rolul dat, cu JWT-ul contului (COMMIT la succes, ca un apel PostgREST)
async function ca(db, rol, uid, sql) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
const lit = s => `'${String(s).replace(/'/g, "''")}'`
// semnalul agentului (toate cheile), valori scrise de mână
const SEMNAL = (proiect = 1, extra = {}) => ({
  proiect_id: proiect, flux: 'lipsuri', tip: 'termen_apropiat', obiect: 'contract:termen', gravitate: 'atentie', titlu: 'Termenul contractului se apropie',
  detalii: 'Mai sunt 20 de zile până la termenul din contract.', constatare: 'constatat', surse_consultate: ['ERP: executie_proiecte.data_termen'],
  dovada_sursa: 'camp_erp', dovada_data: '2026-11-21', dovada_fragment: 'data_termen = 2026-12-11', dovada_ref: 'executie_proiecte.data_termen',
  termen: '2026-12-11', termen_baza: 'câmpul data_termen', termen_confirmat: true, incertitudine: null, propunere: 'Verificați dacă e nevoie de act adițional.',
  responsabil_employee_id: null, regula_versiune: 'lipsuri-v1', ...extra,
})
const NEGASIT = (proiect = 2, extra = {}) => SEMNAL(proiect, {
  tip: 'document_negasit', obiect: 'polita:GBE', titlu: 'Polița GBE nu a fost găsită', constatare: 'negasit_in_surse',
  surse_consultate: ['NAS: Z:/.../garantii', 'mail: subiect „GBE”'], dovada_sursa: null, dovada_data: null, dovada_fragment: null, dovada_ref: null,
  termen: null, termen_baza: null, termen_confirmat: null, incertitudine: 'Polița poate fi la Kostas, nescanată.', responsabil_employee_id: 11, ...extra,
})
const scrie = (db, s, { rol = 'service_role', uid = null } = {}) => ca(db, rol, uid, `SELECT public.fn_executie_semnal_scrie(${lit(JSON.stringify(s))}::jsonb) AS r`)
const stare = (db, uid, id, versiune, st, { motiv = null, dovada = null, ref = null, resp = null, schimba = false, rol = 'authenticated' } = {}) =>
  ca(db, rol, uid, `SELECT public.fn_executie_semnal_stare(${id}, ${versiune}, ${st == null ? 'NULL' : lit(st)}, ${motiv == null ? 'NULL' : lit(motiv)}, ${dovada == null ? 'NULL' : lit(dovada)}, ${ref == null ? 'NULL' : lit(ref)}, ${resp == null ? 'NULL' : resp}, ${schimba}) AS r`)
const rand = async (db, id) => (await db.query(`SELECT * FROM public.executie_semnale WHERE id = ${id}`)).rows[0]
const jurnal = async (db, id, filtru = '') => (await db.query(`SELECT * FROM public.executie_semnale_jurnal WHERE semnal_id = ${id} ${filtru} ORDER BY id`)).rows

// ── VERIFICĂRILE (pe o bază cu migrarea aplicată); întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce, re = null) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod} ${re || ''})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return null } return r.rows[0]?.r ?? r.rows }
  // A. agentul creează; același semnal = neschimbat (un singur rând); o schimbare = actualizat cu diferențele în jurnal
  const a1 = asteptOk(await scrie(db, SEMNAL(1)), 'A crearea semnalului pe P1')
  const id1 = a1?.id
  if (a1 && (a1.actiune !== 'creat' || a1.stare !== 'nou' || a1.versiune !== 1)) ab.push('A rezultatul creării: ' + JSON.stringify(a1))
  const r1 = id1 ? await rand(db, id1) : null
  if (r1 && (r1.dovada_amprenta.length !== 32 || r1.responsabil_sursa !== null || r1.stare_de !== null || r1.detectat_la == null)) ab.push('A rândul creat: ' + JSON.stringify(r1))
  const a2 = asteptOk(await scrie(db, SEMNAL(1)), 'A același semnal din nou')
  if (a2 && (a2.actiune !== 'neschimbat' || a2.id !== id1 || a2.versiune !== 2)) ab.push('A același semnal nu e „neschimbat” pe același rând: ' + JSON.stringify(a2))
  const a3 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic' })), 'A gravitatea schimbată')
  if (a3 && (a3.actiune !== 'actualizat' || a3.id !== id1)) ab.push('A schimbarea gravității nu e „actualizat”: ' + JSON.stringify(a3))
  const n1 = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE tip = 'termen_apropiat' AND proiect_id = 1`)).rows[0].n
  if (n1 !== 1) ab.push(`A ${n1} rânduri pentru aceeași cheie`)
  const j1 = id1 ? await jurnal(db, id1) : []
  if (j1.length !== 2 || j1[0].actiune !== 'creat' || j1[0].actor !== 'agent' || j1[0].actor_profile !== null || j1[1].actiune !== 'actualizat'
      || JSON.stringify(j1[1].valori.gravitate) !== '["atentie","critic"]' || Object.keys(j1[1].valori).length !== 1) ab.push('A jurnalul (creat + actualizat cu diferența): ' + JSON.stringify(j1.map(x => [x.actiune, x.actor, x.valori])))
  // responsabilul propus de agent: sursa 'agent'; agentul îl poate schimba cât e al lui
  const a4 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14 })), 'A responsabil propus de agent')
  const r4 = id1 ? await rand(db, id1) : null
  if (a4 && r4 && (r4.responsabil_employee_id !== 14 || r4.responsabil_sursa !== 'agent')) ab.push('A responsabilul agentului: ' + JSON.stringify([r4.responsabil_employee_id, r4.responsabil_sursa]))
  // al doilea semnal: P2, negăsit în surse, responsabil 11
  const b1 = asteptOk(await scrie(db, NEGASIT(2)), 'A crearea semnalului negăsit pe P2')
  const id2 = b1?.id
  // un al treilea, pe P1, cu termen mai apropiat (sortarea în ecran)
  const c1 = asteptOk(await scrie(db, SEMNAL(1, { tip: 'polita_expira', obiect: 'polita:CAR', titlu: 'Polița CAR expiră', gravitate: 'critic', termen: '2026-11-30', flux: 'lipsuri' })), 'A al treilea semnal pe P1')
  const id3 = c1?.id
  // validarea: chei necunoscute / lipsă / tipuri / enumerări / constatarea fără surse / proiect / angajat / zi / flux schimbat
  asteptCod(await scrie(db, { ...SEMNAL(1), strain: 1 }), '22023', 'A cheie necunoscută', /câmpuri necunoscute/)
  asteptCod(await scrie(db, (() => { const x = SEMNAL(1); delete x.titlu; return x })()), '22023', 'A titlu lipsă', /obligatoriu/)
  asteptCod(await scrie(db, SEMNAL(1, { gravitate: 3 })), '22023', 'A tip greșit', /trebuie să fie string/)
  asteptCod(await scrie(db, SEMNAL(1, { gravitate: 'urgent' })), '23514', 'A gravitate necunoscută')
  asteptCod(await scrie(db, SEMNAL(1, { flux: 'altul', tip: 'x_y' })), '23514', 'A flux necunoscut')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'Termen' })), '23514', 'A tip cu majuscule')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_x', constatare: 'negasit_in_surse', surse_consultate: [] })), '23514', 'A negăsit fără surse')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_y', constatare: 'camp_lipsa', dovada_sursa: 'mail' })), '23514', 'A câmp lipsă cu altă sursă decât camp_erp')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_z', constatare: 'constatat', dovada_sursa: null })), '23514', 'A constatat fără sursă')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_t', termen: '2026-12-01', termen_confirmat: null })), '23514', 'A termen fără „confirmat”')
  asteptCod(await scrie(db, SEMNAL(1, { titlu: 'ab' })), '23514', 'A titlu prea scurt')
  asteptCod(await scrie(db, SEMNAL(1, { obiect: 'x' + String.fromCharCode(7) })), '23514', 'A caracter de control în obiect')
  asteptCod(await scrie(db, SEMNAL(1, { regula_versiune: 'v 1' })), '23514', 'A versiunea regulii cu spațiu')
  asteptCod(await scrie(db, SEMNAL(999)), '22023', 'A proiect inexistent', /proiectul nu există/)
  asteptCod(await scrie(db, SEMNAL(1, { responsabil_employee_id: 15 })), '22023', 'A responsabil inactiv', /angajat activ/)
  asteptCod(await scrie(db, SEMNAL(1, { responsabil_employee_id: 999 })), '22023', 'A responsabil inexistent', /angajat activ/)
  asteptCod(await scrie(db, SEMNAL(1, { dovada_data: '21.11.2026' })), '22023', 'A zi în alt format', /AAAA-LL-ZZ/)
  asteptCod(await scrie(db, SEMNAL(1, { surse_consultate: ['', 'x'] })), '22023', 'A sursă goală în listă')
  asteptCod(await scrie(db, SEMNAL(1, { surse_consultate: 'nas' })), '22023', 'A sursele ca text, nu listă', /trebuie să fie array/)
  asteptCod(await scrie(db, SEMNAL(1, { flux: 'tichete' })), '22023', 'A același tip pe alt flux', /înregistrat pe fluxul/)
  asteptCod(await scrie(db, 'null'), '22023', 'A payload null')
  // calea agentului: nu din contul unui utilizator (fără EXECUTE pentru authenticated / anon; service_role cu JWT = refuz explicit)
  asteptCod(await scrie(db, SEMNAL(1), { rol: 'authenticated', uid: U.OWNER }), '42501', 'A owner-ul autentificat cheamă RPC-ul agentului')
  asteptCod(await scrie(db, SEMNAL(1), { rol: 'anon' }), '42501', 'A anon cheamă RPC-ul agentului')
  asteptCod(await scrie(db, SEMNAL(1), { rol: 'service_role', uid: U.OWNER }), '42501', 'A service_role cu JWT de utilizator', /calea agentului/)
  // B. citirea prin RLS: tabel, vedere, jurnal
  const nr = async (uid, sql, rol = 'authenticated') => { const r = await ca(db, rol, uid, sql); return r.code ? r.code : JSON.stringify(r.rows.map(x => Number(x.proiect_id) + ':' + x.n)) }
  const Q = 'SELECT proiect_id, count(*)::int AS n FROM public.executie_semnale GROUP BY 1 ORDER BY 1'
  const QV = 'SELECT proiect_id, count(*)::int AS n FROM public.v_executie_semnale GROUP BY 1 ORDER BY 1'
  const QJ = 'SELECT proiect_id, count(*)::int AS n FROM public.executie_semnale_jurnal GROUP BY 1 ORDER BY 1'
  // VIEWER = angajatul 14, responsabilul PROPUS de agent pe primul semnal: îl vede pe acela (dreptul urmează responsabilul, oricare i-ar fi sursa)
  for (const [cont, asteptat] of [['OWNER', '["1:2","2:1"]'], ['MP_P1', '["1:2"]'], ['MP_P2', '["2:1"]'], ['RESP', '["2:1"]'], ['MP_P1_RESTRANS', '[]'],
                                  ['SEF', '[]'], ['ADMIN', '[]'], ['VIEWER', '["1:1"]'], ['FARA', '[]']]) {
    for (const [nume, q] of [['tabel', Q], ['vedere', QV]]) { const v = await nr(U[cont], q); if (v !== asteptat) ab.push(`B ${nume} ${cont}: ${v} (aștepta ${asteptat})`) }
  }
  for (const [cont, asteptat] of [['OWNER', '["1:4","2:1"]'], ['MP_P1', '["1:4"]'], ['RESP', '["2:1"]'], ['SEF', '[]'], ['ADMIN', '[]'], ['MP_P1_RESTRANS', '[]']]) {
    const v = await nr(U[cont], QJ); if (v !== asteptat) ab.push(`B jurnal ${cont}: ${v} (aștepta ${asteptat})`)
  }
  if (await nr(null, Q) !== '[]') ab.push('B fără JWT vede semnale')
  asteptCod(await ca(db, 'anon', null, Q), '42501', 'B anon citește tabelul')
  asteptCod(await ca(db, 'anon', null, QV), '42501', 'B anon citește vederea')
  const vs = await ca(db, 'service_role', null, Q); if (vs.code || vs.rows.length !== 2) ab.push('B service_role (agentul) nu citește tot: ' + JSON.stringify(vs))
  const vv = await ca(db, 'authenticated', U.OWNER, `SELECT proiect_cod, proiect_nume FROM public.v_executie_semnale WHERE id = ${id1}`)
  if (vv.code || vv.rows[0]?.proiect_cod !== 'P1' || vv.rows[0]?.proiect_nume !== 'Proiect unu') ab.push('B vederea nu aduce codul / numele proiectului: ' + JSON.stringify(vv))
  // C. scrierile directe refuzate (PostgREST: authenticated / service_role); postgres: fără ștergere / golire; jurnalul doar adăugare
  asteptCod(await ca(db, 'authenticated', U.OWNER, `UPDATE public.executie_semnale SET titlu = 'x' WHERE id = ${id1}`), '42501', 'C UPDATE direct (owner)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.executie_semnale WHERE id = ${id1}`), '42501', 'C DELETE direct (owner)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.executie_semnale (proiect_id, flux, tip, obiect, gravitate, titlu, constatare, dovada_amprenta, regula_versiune) VALUES (1, 'lipsuri', 'x_y', 'o', 'info', 'Titlu', 'camp_lipsa', repeat('0', 32), 'v1')`), '42501', 'C INSERT direct (owner)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, actor) VALUES (${id1}, 1, 'creat', 'om')`), '42501', 'C INSERT direct în jurnal (owner)')
  asteptCod(await ca(db, 'service_role', null, `UPDATE public.executie_semnale SET stare = 'in_lucru' WHERE id = ${id1}`), '42501', 'C UPDATE direct (service_role)')
  asteptCod(await ca(db, 'service_role', null, `INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, actor) VALUES (${id1}, 1, 'creat', 'agent')`), '42501', 'C INSERT direct în jurnal (service_role)')
  asteptCod(await ca(db, 'service_role', null, `DELETE FROM public.executie_semnale_jurnal WHERE semnal_id = ${id1}`), '42501', 'C DELETE jurnal (service_role)')
  asteptCod(await ca(db, 'postgres', null, `DELETE FROM public.executie_semnale WHERE id = ${id1}`), '42501', 'C DELETE ca postgres', /nu se șterg/)
  // TRUNCATE pe semnale singure e oprit întâi de cheia străină a jurnalului (0A000); golirea ambelor tabele deodată ajunge la gardă
  asteptCod(await ca(db, 'postgres', null, 'TRUNCATE public.executie_semnale, public.executie_semnale_jurnal'), '42501', 'C TRUNCATE ca postgres', /nu se golește/)
  asteptCod(await ca(db, 'postgres', null, 'TRUNCATE public.executie_semnale_jurnal'), '42501', 'C TRUNCATE jurnal ca postgres', /nu se golește/)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale_jurnal SET motiv = 'x' WHERE semnal_id = ${id1}`), '42501', 'C UPDATE jurnal ca postgres', /doar adăugare/)
  asteptCod(await ca(db, 'postgres', null, `DELETE FROM public.executie_semnale_jurnal WHERE semnal_id = ${id1}`), '42501', 'C DELETE jurnal ca postgres', /doar adăugare/)
  // agentul (postgres fără JWT) pe calea directă: starea / motivul omului, identitatea
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET stare = 'in_lucru' WHERE id = ${id1}`), '42501', 'C agentul schimbă starea direct', /agentul nu schimbă starea/)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET stare_motiv = 'x' WHERE id = ${id1}`), '42501', 'C agentul scrie motivul direct', /agentul nu atinge motivul/)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET tip = 'alt_tip' WHERE id = ${id1}`), '23514', 'C identitatea schimbată', /identitatea/)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET proiect_id = 2 WHERE id = ${id1}`), '23514', 'C proiectul schimbat', /identitatea/)
  // omul (postgres cu JWT) pe calea directă nu rescrie constatarea
  asteptCod(await ca(db, 'postgres', U.OWNER, `UPDATE public.executie_semnale SET titlu = 'alt titlu' WHERE id = ${id1}`), '42501', 'C omul rescrie titlul direct', /constatarea agentului/)
  asteptCod(await ca(db, 'postgres', U.OWNER, `UPDATE public.executie_semnale SET ultima_verificare = now() WHERE id = ${id1}`), '42501', 'C omul mută ultima verificare', /constatarea agentului/)
  asteptCod(await ca(db, 'postgres', U.OWNER, `INSERT INTO public.executie_semnale (proiect_id, flux, tip, obiect, gravitate, titlu, constatare, dovada_amprenta, regula_versiune) VALUES (1, 'lipsuri', 'x_y', 'o', 'info', 'Titlu', 'camp_lipsa', repeat('0', 32), 'v1')`), '42501', 'C omul creează un semnal direct', /doar agentul/)
  // D. starea omului: MP-ul pe P1; CAS; motivul; tranzițiile; dreptul; responsabilul
  let v = (await rand(db, id1)).versiune
  const d1 = asteptOk(await stare(db, U.MP_P1, id1, v, 'in_lucru'), 'D MP ia în lucru')
  if (d1 && (d1.ok !== true || d1.semnal.stare !== 'in_lucru' || d1.semnal.stare_de !== U.MP_P1 || d1.semnal.stare_la == null || d1.semnal.versiune !== v + 1)) ab.push('D in_lucru: ' + JSON.stringify(d1))
  const d2 = asteptOk(await stare(db, U.MP_P1, id1, v, 'respins', { motiv: 'x' }), 'D versiune veche')
  if (d2 && (d2.ok !== false || d2.motiv !== 'conflict' || d2.semnal.stare !== 'in_lucru')) ab.push('D CAS nu dă conflict: ' + JSON.stringify(d2))
  v += 1
  asteptCod(await stare(db, U.MP_P1, id1, v, 'respins'), '22023', 'D respins fără motiv', /cere un motiv/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'rezolvat', { motiv: '   ' }), '22023', 'D rezolvat cu motiv gol', /cere un motiv/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'nou'), '22023', 'D omul pune „nou”', /nepermisă omului/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'alta'), '22023', 'D stare necunoscută', /nepermisă omului/)
  asteptCod(await stare(db, U.MP_P1, id1, v, null), '22023', 'D nimic de schimbat', /nimic de schimbat/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'in_lucru'), '22023', 'D aceeași stare, nimic altceva', /nimic de schimbat/)
  asteptCod(await stare(db, U.MP_P1, id2, 1, 'in_lucru'), '42501', 'D MP-ul P1 pe semnalul P2', /nu ai drept/)
  asteptCod(await stare(db, U.MP_P1, 999999, 1, 'in_lucru'), '42501', 'D semnal inexistent', /nu ai drept/)
  asteptCod(await stare(db, U.MP_P1_RESTRANS, id1, v, 'in_lucru'), '42501', 'D MP-ul restrâns pe alt proiect', /nu ai drept/)
  asteptCod(await stare(db, U.ADMIN, id1, v, 'in_lucru'), '42501', 'D accesul general admin', /nu ai drept/)
  asteptCod(await stare(db, U.SEF, id1, v, 'in_lucru'), '42501', 'D șeful de șantier', /nu ai drept/)
  asteptCod(await stare(db, U.FARA, id1, v, 'in_lucru'), '42501', 'D cont fără drept', /nu ai drept/)
  asteptCod(await stare(db, null, id1, v, 'in_lucru'), '42501', 'D fără JWT', /autentificare/)
  asteptCod(await stare(db, null, id1, v, 'in_lucru', { rol: 'anon' }), '42501', 'D anon')
  asteptCod(await stare(db, U.MP_P1, id1, v, null, { resp: 15, schimba: true }), '22023', 'D responsabil inactiv', /angajat activ/)
  // motivul pe aceeași stare = schimbare (stare_de / stare_la se reîmprospătează), jurnal 'stare'
  const d3 = asteptOk(await stare(db, U.MP_P1, id1, v, 'in_lucru', { motiv: 'am sunat la beneficiar' }), 'D motiv adăugat pe aceeași stare')
  if (d3 && (d3.ok !== true || d3.semnal.stare_motiv !== 'am sunat la beneficiar' || d3.semnal.versiune !== v + 1)) ab.push('D motivul pe aceeași stare: ' + JSON.stringify(d3))
  v += 1
  const d4 = asteptOk(await stare(db, U.MP_P1, id1, v, 'respins', { motiv: 'Termenul e deja prelungit prin AA 2.', dovada: 'AA nr. 2 / 2026', ref: 'TKT-2026-9999' }), 'D respins cu motiv')
  if (d4 && (d4.ok !== true || d4.semnal.stare !== 'respins' || d4.semnal.actiune_ref !== 'TKT-2026-9999' || d4.semnal.stare_dovada !== 'AA nr. 2 / 2026')) ab.push('D respins: ' + JSON.stringify(d4))
  v += 1
  asteptCod(await stare(db, U.MP_P1, id1, v, 'asteapta_informatii', { motiv: 'x' }), '22023', 'D respins -> așteaptă (nepermis)', /tranziție nepermisă/)
  asteptCod(await stare(db, U.OWNER, id1, v, 'in_lucru'), '22023', 'D redeschidere fără motiv', /redeschiderea cere un motiv/)
  // responsabilul semnalului P2 își ia semnalul în lucru; nu atinge P1; owner-ul schimbă responsabilul (sursa devine „om”)
  const e1 = asteptOk(await stare(db, U.RESP, id2, 1, 'in_lucru'), 'D responsabilul ia în lucru')
  if (e1 && e1.ok !== true) ab.push('D responsabilul: ' + JSON.stringify(e1))
  asteptCod(await stare(db, U.RESP, id1, v, 'in_lucru', { motiv: 'x' }), '42501', 'D responsabilul lui P2 pe P1', /nu ai drept/)
  const e2 = asteptOk(await stare(db, U.OWNER, id2, 2, null, { resp: 10, schimba: true }), 'D owner-ul schimbă responsabilul')
  if (e2 && (e2.ok !== true || e2.semnal.responsabil_employee_id !== 10 || e2.semnal.responsabil_sursa !== 'om' || e2.semnal.stare !== 'in_lucru')) ab.push('D responsabilul omului: ' + JSON.stringify(e2))
  // fostul responsabil nu mai vede semnalul (dreptul urmează responsabilul curent); MP-ul P1 (angajatul 10) acum îl vede
  if (await nr(U.RESP, Q) !== '[]') ab.push('D fostul responsabil mai vede semnalul')
  if (await nr(U.MP_P1, Q) !== '["1:2","2:1"]') ab.push('D noul responsabil (MP P1) nu vede semnalul P2: ' + await nr(U.MP_P1, Q))
  const e3 = asteptOk(await stare(db, U.OWNER, id2, 3, null, { resp: null, schimba: true }), 'D owner-ul scoate responsabilul')
  if (e3 && (e3.ok !== true || e3.semnal.responsabil_employee_id !== null || e3.semnal.responsabil_sursa !== null)) ab.push('D responsabil scos: ' + JSON.stringify(e3))
  const e4 = asteptOk(await stare(db, U.OWNER, id2, 4, null, { resp: 11, schimba: true }), 'D owner-ul pune înapoi responsabilul 11')
  if (e4 && e4.semnal.responsabil_sursa !== 'om') ab.push('D sursa responsabilului pus de om: ' + JSON.stringify(e4))
  const jd = await jurnal(db, id1, "AND actor = 'om'")
  if (jd.length !== 3 || jd.some(x => x.actiune !== 'stare' || x.actor_profile !== U.MP_P1) || jd[2].motiv !== 'Termenul e deja prelungit prin AA 2.' || jd[2].stare_veche !== 'in_lucru' || jd[2].stare_noua !== 'respins')
    ab.push('D jurnalul omului pe P1: ' + JSON.stringify(jd.map(x => [x.actiune, x.stare_veche, x.stare_noua, x.motiv])))
  const je = await jurnal(db, id2, "AND actiune = 'responsabil'")
  if (je.length !== 3 || JSON.stringify(je[0].valori.responsabil_employee_id) !== '[11,10]' || JSON.stringify(je[0].valori.responsabil_sursa) !== '["agent","om"]') ab.push('D jurnalul responsabilului: ' + JSON.stringify(je.map(x => x.valori)))
  // E. respins nu reapare cu aceeași dovadă; cu dovadă nouă se redeschide; rezolvat la fel; agentul nu schimbă responsabilul omului
  const f1 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14 })), 'E aceeași dovadă pe un respins')
  let rr = await rand(db, id1)
  if (f1 && (f1.actiune !== 'neschimbat_inchis' || rr.stare !== 'respins' || rr.stare_motiv == null || rr.versiune !== f1.versiune)) ab.push('E respinsul a reapărut: ' + JSON.stringify([f1, rr.stare]))
  if ((await jurnal(db, id1)).length !== 6) ab.push('E jurnalul s-a umplut la „neschimbat_inchis”: ' + (await jurnal(db, id1)).length)
  const f2 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14, dovada_fragment: 'data_termen = 2026-12-05 (AA 3)', dovada_data: '2026-11-22' })), 'E dovadă nouă pe un respins')
  rr = await rand(db, id1)
  if (f2 && (f2.actiune !== 'redeschis' || rr.stare !== 'nou' || rr.stare_motiv !== null || rr.stare_de !== null || rr.actiune_ref !== null)) ab.push('E dovada nouă nu redeschide curat: ' + JSON.stringify([f2, rr.stare, rr.stare_motiv]))
  const jr = await jurnal(db, id1, "AND actiune = 'redeschis'")
  if (jr.length !== 1 || jr[0].stare_veche !== 'respins' || jr[0].stare_noua !== 'nou' || jr[0].actor !== 'agent' || !/dovadă nouă/.test(jr[0].motiv || '')) ab.push('E jurnalul redeschiderii: ' + JSON.stringify(jr))
  // ordinea surselor contează în amprentă? aceeași listă în altă ordine = altă dovadă (canonic, fără ghicit): se notează ca actualizare, nu ca „neschimbat”
  v = rr.versiune
  const g1 = asteptOk(await stare(db, U.OWNER, id1, v, 'rezolvat', { motiv: 'prelungit prin AA 3' }), 'E owner-ul rezolvă')
  if (g1 && g1.ok !== true) ab.push('E rezolvarea: ' + JSON.stringify(g1))
  const g2 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14, dovada_fragment: 'data_termen = 2026-12-05 (AA 3)', dovada_data: '2026-11-22' })), 'E aceeași dovadă pe un rezolvat')
  rr = await rand(db, id1)
  if (g2 && (g2.actiune !== 'neschimbat_inchis' || rr.stare !== 'rezolvat')) ab.push('E rezolvatul a reapărut: ' + JSON.stringify([g2, rr.stare]))
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET stare = 'nou' WHERE id = ${id1}`), '42501', 'E redeschidere directă fără dovadă nouă', /dovadă nouă/)
  // agentul propune alt responsabil pe id2 (sursa om = 11): rămâne 11, fără jurnal nou
  const nj = (await jurnal(db, id2)).length
  const h1 = asteptOk(await scrie(db, NEGASIT(2, { responsabil_employee_id: 14 })), 'E agentul propune alt responsabil pe semnalul cu responsabil pus de om')
  rr = await rand(db, id2)
  if (h1 && (h1.actiune !== 'neschimbat' || rr.responsabil_employee_id !== 11 || rr.responsabil_sursa !== 'om')) ab.push('E agentul a schimbat responsabilul omului: ' + JSON.stringify([h1, rr.responsabil_employee_id, rr.responsabil_sursa]))
  if ((await jurnal(db, id2)).length !== nj) ab.push('E jurnal nou la „neschimbat”')
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET responsabil_employee_id = 14 WHERE id = ${id2}`), '42501', 'E calea directă schimbă responsabilul omului', /stabilit de om/)
  // F. cheile din jurnalul creat: toate câmpurile de la creare în „valori” (nou = [null, valoare]); versiunea regulii
  const jc = (await jurnal(db, id3, "AND actiune = 'creat'"))[0]
  if (!jc || jc.regula_versiune !== 'lipsuri-v1' || JSON.stringify(jc.valori.titlu) !== '[null,"Polița CAR expiră"]' || JSON.stringify(jc.valori.stare) !== '[null,"nou"]') ab.push('F jurnalul creării: ' + JSON.stringify(jc?.valori))
  // funcțiile interne nu se cheamă din API
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_semnal_tranzitie('nou', 'in_lucru', 'om')`), '42501', 'F funcție internă din API')
  asteptCod(await ca(db, 'service_role', null, `SELECT public.fn_executie_semnal_stare(${id1}, 1, 'in_lucru', NULL, NULL, NULL, NULL, false)`), '42501', 'F RPC-ul omului din service_role')
  const dr = await ca(db, 'authenticated', U.MP_P1, 'SELECT public.fn_executie_semnal_drept(1, NULL) AS a, public.fn_executie_semnal_drept(2, NULL) AS b, public.fn_executie_semnal_drept(2, 10) AS c, public.fn_executie_semnal_drept(999, 10) AS d')
  if (dr.code || JSON.stringify(dr.rows[0]) !== '{"a":true,"b":false,"c":true,"d":false}') ab.push('F dreptul (MP P1): ' + JSON.stringify(dr))
  return ab
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) din fișierul revizuit = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, OBIECTE_CALE),
    '# 20270106a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length > 50 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, NUME + '.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /sfarsit la \d+ ms de la BEGIN; lock-uri puternice tinute de \d+ ms/.test(m)),
    'livrarea aprobată: diferența = manifestul; ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  ok(j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m)) && j.some(m => /^LOCK_TINUT /.test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista semnale/.test(m || ''), 'revenirea refuză cu date: ' + m)
  await db.close()
}

console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session marcaj 2000:\d+ \(cerut 5000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['pasul „înainte” dintr-o tranzacție anterioară', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  ['lanțul de drept schimbat', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
    return aplicaMig(db)
  }, /lantul de drept \(inainte\) difera de amprenta revizuita: public\.fn_executie_proiect_permis/],
  ['o funcție din lanț cu EXECUTE pentru anon', async db => { await db.exec('GRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO anon'); return aplicaMig(db) },
    /lantul de drept \(inainte\) difera.*fn_executie_acces_lista/],
  ['managerul de proiect lipsă din executie_proiecte', async db => { await db.exec('ALTER TABLE public.executie_proiecte DROP COLUMN mp_employee_id'); return aplicaMig(db) }, /executie_proiecte\.mp_employee_id lipseste/],
  ['legătura cont -> fișă lipsă din profiles', async db => { await db.exec('ALTER TABLE public.profiles DROP COLUMN employee_id'); return aplicaMig(db) }, /profiles\.employee_id lipseste/],
  ['employees.active de alt tip', async db => { await db.exec('ALTER TABLE public.employees ALTER COLUMN active TYPE text'); return aplicaMig(db) }, /employees\.active lipseste sau are alt tip/],
  ['authenticated fără SELECT pe executie_proiecte (vederea ar da 42501)', async db => { await db.exec('REVOKE SELECT ON public.executie_proiecte FROM authenticated'); return aplicaMig(db) }, /SELECT pentru authenticated pe id/],
  ['setul de lock-uri obținut după termen, fără coliziune', db => aplicaMig(db, lockLent(MIG)), /BUGET_LOCK: lock-urile obtinute abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, coliziune(MIG, 1000)), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const exista = (await db.query(`SELECT to_regclass('public.executie_semnale') IS NOT NULL AS e`)).rows[0].e
  ok(re.test(m || '') && !exista, `${nume}: ${(m || 'a trecut').slice(0, 160)}`)
  await db.close()
}
// bugetul lock-ului: (a) un pas „înainte” lung nu consumă bugetul; (b) eșecul după primul lock eliberează lock-ul parțial, a doua încercare reușește
async function probaInainteLung(db, text = MIG) {
  const j = await aplicaMig(db, 'SELECT pg_sleep(1.05);\n' + text)
  const m = (j.find(x => /lock la \d+ ms de la BEGIN/.test(x)) || '').match(/lock la (\d+) ms de la BEGIN \((\d+) incercari, (\d+) ms de la prima incercare\)/)
  return m && Number(m[1]) >= 1050 && Number(m[3]) < 1000 ? `lock la ${m[1]} ms de la BEGIN, ${m[3]} ms de la prima încercare` : null
}
async function probaPartial(db, text = MIG) {
  const j = await aplicaMig(db, coliziune(text, 1))
  const p = j.filter(x => /^TEST_LOCK_PARTIAL /.test(x)).map(x => Number(x.split(' ')[1]))
  return { p, ok: p.length === 1 && p[0] === 0 && j.some(x => /lock la \d+ ms de la BEGIN \(2 incercari/.test(x)) }
}
{
  const db = await bazaNoua()
  let r = null, m = null; try { r = await probaInainteLung(db) } catch (e) { m = e.message }
  ok(r != null, `pasul „înainte” lung (1,05 s) nu consumă bugetul lock-ului: ${r || m}`)
  await db.close()
  const db2 = await bazaNoua()
  let q = null; m = null; try { q = await probaPartial(db2) } catch (e) { m = e.message }
  ok(q?.ok === true, `eșec după primul lock: lock-ul parțial eliberat (${JSON.stringify(q?.p)} ținute după eșec), a doua încercare reușește${m ? ': ' + m : ''}`)
  await db2.close()
}

console.log('3. revenirea')
{
  const a = amprente(), b = amprenteRevenire()
  ok(JSON.stringify(a) === JSON.stringify(b), 'amprentele din revenire = corpurile migrării' + (JSON.stringify(a) === JSON.stringify(b) ? '' : ': ' + JSON.stringify(Object.keys(a).filter(k => a[k] !== b[k]))))
  const db = await bazaNoua()
  await aplicaMig(db)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { plafon: PLAFON_LIVRARE }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa: 5000\/session/.test(m || ''), 'revenirea cu plafonul livrărilor (5000, nu al ei) refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  for (const [ce, sql, undo, re] of [
    ['altă funcție folosește tabelele', `CREATE FUNCTION public.zz_foloseste() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT count(*) FROM public.executie_semnale $f$;`, 'DROP FUNCTION public.zz_foloseste()', /alte obiecte depind/],
    ['altă vedere peste vederea migrării', `CREATE VIEW public.zz_v AS SELECT id FROM public.v_executie_semnale`, 'DROP VIEW public.zz_v', /alte obiecte depind/],
    ['corpul unei funcții', `CREATE OR REPLACE FUNCTION public.fn_executie_semnal_tranzitie(p_veche text, p_noua text, p_actor text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$;`, null, /functii: public\.fn_executie_semnal_tranzitie/],
    ['expresia unei politici (același nume, același număr)', `ALTER POLICY executie_semnale_citire ON public.executie_semnale USING (true)`, `ALTER POLICY executie_semnale_citire ON public.executie_semnale USING (public.fn_executie_semnal_drept(proiect_id, responsabil_employee_id))`, /politici/],
    ['rolurile unei politici', `ALTER POLICY executie_semnale_jurnal_citire ON public.executie_semnale_jurnal TO authenticated, anon`, `ALTER POLICY executie_semnale_jurnal_citire ON public.executie_semnale_jurnal TO authenticated`, /politici/],
    ['trigger dezactivat (același număr)', `ALTER TABLE public.executie_semnale DISABLE TRIGGER trg_executie_semnal_garda`, `ALTER TABLE public.executie_semnale ENABLE TRIGGER trg_executie_semnal_garda`, /trigger/],
    ['drept INSERT dat pe tabel', `GRANT INSERT ON public.executie_semnale TO authenticated`, `REVOKE INSERT ON public.executie_semnale FROM authenticated`, /drepturi/],
    ['drept UPDATE pe vedere', `GRANT UPDATE ON public.v_executie_semnale TO service_role`, `REVOKE UPDATE ON public.v_executie_semnale FROM service_role`, /drepturi/],
    ['coloană adăugată pe tabel', `ALTER TABLE public.executie_semnale ADD COLUMN zz int`, `ALTER TABLE public.executie_semnale DROP COLUMN zz`, /coloane/],
    ['un CHECK în plus pe tabelul gol', `ALTER TABLE public.executie_semnale ADD CONSTRAINT zz_ck CHECK (versiune < 100000)`, `ALTER TABLE public.executie_semnale DROP CONSTRAINT zz_ck`, /constrangeri/],
    ['un index în plus', `CREATE INDEX zz_idx ON public.executie_semnale_jurnal (motiv)`, `DROP INDEX public.zz_idx`, /indexuri/],
    ['drept pe secvență', `GRANT USAGE ON SEQUENCE public.executie_semnale_jurnal_id_seq TO authenticated`, `REVOKE USAGE ON SEQUENCE public.executie_semnale_jurnal_id_seq FROM authenticated`, /drepturi ACL: executie_semnale_jurnal_id_seq\/authenticated\/USAGE/],
    ['un rol suplimentar cu drept pe tabel', `CREATE ROLE zz_rol NOLOGIN; GRANT SELECT ON public.executie_semnale TO zz_rol`, `REVOKE SELECT ON public.executie_semnale FROM zz_rol; DROP ROLE zz_rol`, /drepturi ACL: executie_semnale\/zz_rol\/SELECT/],
    ['SELECT cu GRANT OPTION', `GRANT SELECT ON public.executie_semnale TO service_role WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR SELECT ON public.executie_semnale FROM service_role`, /drepturi ACL: executie_semnale\/service_role\/SELECT/],
    ['vederea fără security_invoker', `ALTER VIEW public.v_executie_semnale SET (security_invoker = off)`, `ALTER VIEW public.v_executie_semnale SET (security_invoker = on)`, /tabele \/ vedere/],
  ]) {
    await db.exec(sql)
    m = null; try { await revino(db) } catch (e) { m = e.message }
    const inca = (await db.query(`SELECT to_regclass('public.executie_semnale') IS NOT NULL AS e`)).rows[0].e
    ok(re.test(m || '') && inca, `revenirea refuză (${ce}): ${(m || 'a trecut').slice(0, 140)}`)
    if (undo) await db.exec(undo)
  }
  await db.close()
  const db2 = await bazaNoua()
  await aplicaMig(db2)
  await revino(db2)
  const g = (await db2.query(`SELECT to_regclass('public.executie_semnale') IS NULL AND to_regclass('public.executie_semnale_jurnal') IS NULL AND to_regclass('public.v_executie_semnale') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_executie\\_semnal\\_%') AS gol`)).rows[0].gol
  ok(g, 'revenirea scoate tot (tabele, vedere, funcții)')
  await aplicaMig(db2)
  const ab = await verifica(db2)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db2.close()
}

console.log('4. mutanții migrării (fiecare TREBUIE să pice)')
const MUTANTI = [
  ['M1 citirea deschisă tuturor (USING true)', [['CREATE POLICY executie_semnale_citire ON public.executie_semnale FOR SELECT TO authenticated\n  USING (public.fn_executie_semnal_drept(proiect_id, responsabil_employee_id));',
    'CREATE POLICY executie_semnale_citire ON public.executie_semnale FOR SELECT TO authenticated\n  USING (true);']]],
  ['M2 RPC-ul agentului primește un cont de utilizator (service_role cu JWT)', [["  IF auth.uid() IS NOT NULL THEN\n    RAISE EXCEPTION 'semnale: calea agentului nu se cheamă cu un cont de utilizator' USING ERRCODE = '42501';\n  END IF;\n  IF p_semnal IS NULL", '  IF p_semnal IS NULL']]],
  ['M3 agentul poate schimba starea (garda)', [["      IF NOT public.fn_executie_semnal_tranzitie(OLD.stare, NEW.stare, 'agent') THEN\n        RAISE EXCEPTION 'semnale: agentul nu schimbă starea dată de om (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '42501';\n      END IF;\n", '']]],
  ['M4 redeschiderea fără dovadă nouă', [["      IF NEW.dovada_amprenta = OLD.dovada_amprenta THEN\n        RAISE EXCEPTION 'semnale: un semnal % se redeschide doar cu o dovadă nouă', OLD.stare USING ERRCODE = '42501';\n      END IF;\n", '']]],
  ['M5 RPC-ul omului fără dreptul pe semnal', [['  IF NOT FOUND OR NOT public.fn_executie_semnal_drept(r.proiect_id, r.responsabil_employee_id) THEN', '  IF NOT FOUND THEN']]],
  ['M6 CAS ignorat la schimbarea stării', [["  IF r.versiune <> p_versiune THEN\n    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'semnal', to_jsonb(r));\n  END IF;\n", ''], ['   WHERE s.id = r.id AND s.versiune = p_versiune\n   RETURNING * INTO r2;', '   WHERE s.id = r.id\n   RETURNING * INTO r2;']]],
  ['M7 respingerea fără motiv', [["  IF v_stare IN ('rezolvat', 'respins') AND v_motiv IS NULL THEN\n    RAISE EXCEPTION 'semnale: rezolvarea / respingerea cere un motiv' USING ERRCODE = '22023';\n  END IF;\n", '']]],
  ['M8 INSERT direct pentru authenticated', [['GRANT SELECT ON public.executie_semnale, public.executie_semnale_jurnal TO authenticated, service_role;', 'GRANT SELECT ON public.executie_semnale, public.executie_semnale_jurnal TO authenticated, service_role;\nGRANT INSERT ON public.executie_semnale TO authenticated;']]],
  ['M9 respinsul reapare (ramura „aceeași dovadă” scoasă)', [["  IF r.stare IN ('rezolvat', 'respins') AND r.dovada_amprenta = v_amp THEN", '  IF false THEN']]],
  ['M10 omul rescrie constatarea (garda)', [["    RAISE EXCEPTION 'semnale: constatarea agentului nu se rescrie de om' USING ERRCODE = '42501';", '    NULL;']]],
  ['M11 jurnalul nu mai e doar adăugare', [["  IF TG_OP IN ('UPDATE', 'DELETE') THEN\n    RAISE EXCEPTION 'semnale: jurnalul e doar adăugare' USING ERRCODE = '42501';\n  END IF;\n", '']]],
  ['M12 dreptul fără restricția pe proiect (20261209a)', [['    AND public.fn_executie_proiect_permis(p_proiect, false)\n    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)', '    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)']]],
  ['M13 dreptul fără managerul de proiect', [['                       AND (p.employee_id = e.mp_employee_id OR p.employee_id = p_responsabil)))', '                       AND p.employee_id = p_responsabil))']]],
  ['M14 identitatea semnalului modificabilă', [["    RAISE EXCEPTION 'semnale: identitatea semnalului (proiect, flux, tip, obiect, detectat_la) nu se schimbă' USING ERRCODE = '23514';", '    NULL;']]],
  ['M15 agentul suprascrie responsabilul pus de om (RPC)', [["         responsabil_employee_id = CASE WHEN s.responsabil_sursa = 'om' THEN s.responsabil_employee_id ELSE v_resp END,", '         responsabil_employee_id = v_resp,']]],
  ['M16 chei necunoscute acceptate', [["  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'semnale: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;", '']]],
  ['M17 „neschimbat” scrie și în jurnal', [["  IF v_act = 'actualizat' AND v_dif = '{}'::jsonb THEN", "  IF false AND v_act = 'actualizat' AND v_dif = '{}'::jsonb THEN"]]],
  ['M18 același tip pe alt flux acceptat în tăcere', [["  IF r.flux IS DISTINCT FROM v_flux THEN\n    RAISE EXCEPTION 'semnale: tipul % e înregistrat pe fluxul %, nu %', v_tip, r.flux, v_flux USING ERRCODE = '22023';\n  END IF;\n", '']]],
  ['M19 garda tranzițiilor omului scoasă (respins -> așteaptă)', [["  IF v_stare <> r.stare AND NOT public.fn_executie_semnal_tranzitie(r.stare, v_stare, 'om') THEN\n    RAISE EXCEPTION 'semnale: tranziție nepermisă (% -> %)', r.stare, v_stare USING ERRCODE = '22023';\n  END IF;\n", ''],
    ["  IF NEW.stare IS DISTINCT FROM OLD.stare AND NOT public.fn_executie_semnal_tranzitie(OLD.stare, NEW.stare, 'om') THEN\n    RAISE EXCEPTION 'semnale: tranziție nepermisă (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '23514';\n  END IF;\n", '']]],
  ['M20 garda lanțului de drept dezactivată (cu lanțul schimbat în bază)', [["  IF v_rau IS NOT NULL THEN\n    RAISE EXCEPTION '20270106a: lantul de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;", "  IF false THEN\n    RAISE EXCEPTION '20270106a: lantul de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;"]],
    `CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`],
  ['M21 fără garda amprentei globale', [["  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema()", "  IF false AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema()"]], null, { l15: 'nimic' }],
  ['M22 RPC-ul agentului cu EXECUTE și pentru authenticated', [['GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_scrie(jsonb) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_scrie(jsonb) TO service_role, authenticated;']]],
  ['M23 omul poate pune „nou”', [["  IF p_stare IS NOT NULL AND p_stare NOT IN ('in_lucru', 'asteapta_informatii', 'rezolvat', 'respins') THEN", "  IF p_stare IS NOT NULL AND p_stare NOT IN ('nou', 'in_lucru', 'asteapta_informatii', 'rezolvat', 'respins') THEN"]]],
  ['M24 secvențele rămân cu drepturile implicite', [['REVOKE ALL ON SEQUENCE public.executie_semnale_id_seq, public.executie_semnale_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;\n', '']]],
  ['M25 vederea fără security_invoker', [['CREATE VIEW public.v_executie_semnale WITH (security_invoker = on) AS', 'CREATE VIEW public.v_executie_semnale AS']]],
  // bugetul de lock (fiecare mutant cu scenariul lui; fără mutant scenariul e refuzat corect, secțiunea 2)
  ['M26 fără niciun termen al bugetului de lock', [[BUGET_INAINTE, BUGET_INAINTE.replace('IF clock_timestamp() >= v_t0 + v_buget THEN', 'IF false THEN')],
    [BUGET_DUPA, BUGET_DUPA.replace('IF clock_timestamp() >= v_t0 + v_buget THEN', 'IF false THEN')]],
    null, { detector: async (db, text) => { try { await aplicaMig(db, lockLent(text)); return 'set obținut după termen, acceptat' } catch { return null } } }],
  ['M27 termenul NU se verifică după obținerea setului', [[BUGET_DUPA, BUGET_DUPA.replace('IF clock_timestamp() >= v_t0 + v_buget THEN', 'IF false THEN')]],
    null, { detector: async (db, text) => { try { await aplicaMig(db, lockLent(text)); return 'set obținut după termen, fără coliziune, acceptat' } catch { return null } } }],
  ['M28 termenul NU se verifică înaintea încercărilor', [[BUGET_INAINTE, BUGET_INAINTE.replace('IF clock_timestamp() >= v_t0 + v_buget THEN', 'IF false THEN')]],
    null, { detector: async (db, text) => {
      let m = null; try { await aplicaMig(db, coliziune(text, 25)) } catch (e) { m = e.message }
      return /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/.test(m || '') ? null : 'reîncercat după termen (' + (m || 'aplicată').slice(0, 80) + ')' } }],
  ['M29 ceasul bugetului pornit la BEGIN', [['v_t0 timestamptz := clock_timestamp();', 'v_t0 timestamptz := now();']],
    null, { detector: async (db, text) => { try { return (await probaInainteLung(db, text)) ? null : 'NOTICE-ul lock-ului greșit' } catch (e) { return 'refuz fals după un pas „înainte” lung: ' + e.message.slice(0, 70) } } }],
  ['M30 primul lock în afara subtranzacției încercării', [['    BEGIN\n' + LOCK_1, LOCK_1.slice(2) + '    BEGIN\n']],
    null, { detector: async (db, text) => { const q = await probaPartial(db, text); return q.ok ? null : `lock parțial ținut după eșec: ${JSON.stringify(q.p)}` } }],
  ['M31 garda tabelei „înainte” fără xmin', [["                    AND c.xmin::text = (txid_current() % 4294967296)::text\n", '']],
    null, { detector: async (db, text) => {
      await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
      try { await aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + text, { l15: 'nimic' }); return 'aplicată fără pasul „înainte”' } catch { return null } } }],
]
for (const [nume, inl, preg, opt] of MUTANTI) {
  try { aplica(MIG, inl) } catch (e) { ok(false, `${nume}: ${e.message.slice(0, 120)}`); continue }
  const db = await bazaNoua()
  if (preg) await db.exec(preg)
  let picat = null
  if (opt?.detector) {
    try { picat = await opt.detector(db, aplica(MIG, inl)) } catch (e) { picat = null; console.log('     ' + nume + ': ' + e.message.slice(0, 160)) }
    ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
    await db.close()
    continue
  }
  try {
    await aplicaMig(db, aplica(MIG, inl), opt)
    if (opt?.l15 === 'nimic') picat = null
    else { const ab = await verifica(db); if (ab.length) picat = 'verificări: ' + ab[0] }
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  if (opt?.l15 === 'nimic') ok(picat === null, `${nume}: fără gardă se aplică fără L15 (garda reală o refuză, secțiunea 2)`)
  else ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}

console.log('5. paritatea tranzițiilor: blocul TRANZITII din migrare = src/executieSemnaleLogica.js (L19)')
{
  const { TRANZITII, tranzitiePermisa, STARI } = await import('../../src/executieSemnaleLogica.js')
  const bloc = MIG.slice(MIG.indexOf('-- TRANZITII-START'), MIG.indexOf('-- TRANZITII-END'))
  const dinSql = [...bloc.matchAll(/\('(om|agent)', '([a-z_]+)', '([a-z_]+)'\)/g)].map(m => [m[1], m[2], m[3]])
  ok(JSON.stringify(dinSql) === JSON.stringify(TRANZITII), `blocul din migrare (${dinSql.length} tranziții) = TRANZITII din JS (${TRANZITII.length})`)
  const db = await bazaNoua()
  await aplicaMig(db)
  let dif = 0, n = 0
  for (const actor of ['om', 'agent']) for (const a of STARI) for (const b of STARI) {
    n++
    const sql = (await db.query(`SELECT public.fn_executie_semnal_tranzitie($1, $2, $3) AS t`, [a, b, actor])).rows[0].t
    if (sql !== tranzitiePermisa(a, b, actor)) { dif++; console.log(`     ${actor} ${a} -> ${b}: SQL ${sql} / JS ${tranzitiePermisa(a, b, actor)}`) }
  }
  ok(dif === 0, `${n} combinații, ${dif} diferențe`)
  await db.close()
}

console.log('6. dry-run-ul pentru clonă (supabase/tests/20270106a_executie_semnale_dryrun.sql) pe PGlite, după aplicare')
{
  const db = await bazaNoua()
  await aplicaMig(db)
  const text = DRY.split('\n').filter(l => !l.startsWith('\\')).join('\n')
  const note = []
  let m = null
  try { await db.exec(text, { onNotice: n => note.push(n.message) }) } catch (e) { m = e.message; try { await db.exec('ROLLBACK') } catch { /* deja */ } }
  const okuri = note.filter(x => /^D[0-9] OK/.test(x))
  ok(m === null && okuri.length === 6, `dry-run-ul: ${okuri.length} pași OK (D0–D5) (${okuri.map(x => x.slice(0, 2)).join(', ')})${m ? '; eroare: ' + m.slice(0, 200) : ''}`)
  if (m) note.slice(-8).forEach(x => console.log('     ' + x))
  const ramase = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale`)).rows[0].n
  ok(ramase === 0, 'dry-run-ul nu lasă nimic în urmă (ROLLBACK)')
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
