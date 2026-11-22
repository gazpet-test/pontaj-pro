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
//    Runda 2 (verdictul Jakarinos pe PR #1164): confirmarea explicită a responsabilului (același angajat / „fără responsabil” = decizia omului),
//    amprenta CANONICĂ (ordinea / spațiile / majusculele surselor, spațiile din fragment nu redeschid), contractul dovezii (constatat = sursă +
//    dată + fragment; negăsit = surse + obligația; camp_lipsa fără sursă nu trece prin UNKNOWN; termen confirmat cu bază; rezolvat cu dovadă /
//    acțiune), cele 13 semnale ale pilotului scrise real, revenirea verificată pe DEFINIȚII (blocul DEFINITII, `--scrie-definitii`).
//    Runda 3 (verdictul Jakarinos r2, P2): spațiul alb din amprentă — reproducerea lui (creare → respingere → retrimitere cu \n / \t / NBSP la
//    capete și în mijloc = `neschimbat_inchis`, stare `respins`), pe fragment, surse și referință, pe respins / rezolvat / deschis; textele stocate
//    normalizate; mutanții M46–M50 (ordinea veche btrim → regexp în funcție, clasa fără NBSP, referința brută, stocarea cu btrim, forma exactă din
//    83b9258c — pe ea reproducerea r2 pică direct).
//    Runda 4 (verdictul Jakarinos r3, P2): cheia de deduplicare `obiect` prin ACEEAȘI funcție (RPC + CHECK în tabel) — reproducerea lui (creare
//    `polita:GBE` → respingere de om → retrimitere cu NBSP / U+202F / U+200B la capete și în mijloc = același id, `neschimbat_inchis`, un rând);
//    cheie cu spațiu interior (NBSP / tab / spații duble / U+200B între două spații = același rând, deschis și respins); caracterele fără lățime
//    (U+200B–U+200D, U+2060, BOM, U+00AD, marcajele bidi) ELIMINATE, nu spațiu; forma necanonică refuzată de CHECK pe calea directă (și doar
//    spațiu alb, fără UNKNOWN); versiunea CREȘTE la neschimbat_inchis (scriere pe ultima_verificare), jurnalul nu; mutanții M51–M59.
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
// spațiul alb „exotic”, scris cu coduri (nu cu secvențe de scăpare în sursă): NBSP, spațiul îngust fără rupere (spații → un spațiu); BOM, spațiul
// fără lățime, ZWJ, word joiner (U+2060), marcajul stânga-dreapta (U+200E), cratima moale (U+00AD) = caractere de format fără lățime (eliminate)
const NBSP = String.fromCharCode(160), NNBSP = String.fromCharCode(8239), BOM = String.fromCharCode(65279), ZWSP = String.fromCharCode(8203)
const ZWJ = String.fromCharCode(8205), WJ = String.fromCharCode(8288), LRM = String.fromCharCode(8206), SHY = String.fromCharCode(173)
// semnalul agentului (toate cheile), valori scrise de mână
const SEMNAL = (proiect = 1, extra = {}) => ({
  proiect_id: proiect, flux: 'lipsuri', tip: 'termen_apropiat', obiect: 'contract:termen', gravitate: 'atentie', titlu: 'Termenul contractului se apropie',
  detalii: 'Mai sunt 20 de zile până la termenul din contract.', constatare: 'constatat', surse_consultate: ['ERP: executie_proiecte.data_termen'],
  dovada_sursa: 'camp_erp', dovada_data: '2026-11-21', dovada_fragment: 'data_termen = 2026-12-11', dovada_ref: 'executie_proiecte.data_termen',
  termen: '2026-12-11', termen_baza: 'câmpul data_termen', termen_confirmat: true, incertitudine: null, propunere: 'Verificați dacă e nevoie de act adițional.',
  responsabil_employee_id: null, regula_versiune: 'lipsuri-v1', ...extra,
})
// negăsit în surse: sursele consultate + OBLIGAȚIA care cere documentul (contractul: sursa, data, fragmentul clauzei)
const NEGASIT = (proiect = 2, extra = {}) => SEMNAL(proiect, {
  tip: 'document_negasit', obiect: 'polita:GBE', titlu: 'Polița GBE nu a fost găsită', constatare: 'negasit_in_surse',
  surse_consultate: ['NAS: Z:/.../garantii', 'mail: subiect „GBE”'], dovada_sursa: 'document', dovada_data: '2026-09-18',
  dovada_fragment: 'art. 8: GBE 10% în max. 15 zile de la încheierea contractului', dovada_ref: 'NAS: Z:/.../contract.pdf',
  termen: null, termen_baza: null, termen_confirmat: null, incertitudine: 'Polița poate fi la responsabilul contracte, nescanată.', responsabil_employee_id: 11, ...extra,
})
// cele 13 semnale ale pilotului (sintetizate), pe proiectul dat
const { PILOT } = await import('./executie_semnale_pilot.mjs')
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
  // CONTRACTUL DOVEZII: fiecare lipsă e refuzată de CHECK (23514), inclusiv cele care înainte treceau prin rezultatul UNKNOWN
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_x', constatare: 'negasit_in_surse', surse_consultate: [] })), '23514', 'A negăsit fără surse')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_x2', constatare: 'negasit_in_surse', surse_consultate: ['NAS'], dovada_fragment: null })), '23514', 'A negăsit fără fragmentul obligației')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_x3', constatare: 'negasit_in_surse', surse_consultate: ['NAS'], dovada_sursa: null, dovada_data: null, dovada_fragment: null, dovada_ref: null })), '23514', 'A negăsit fără obligație (doar sursele)')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_x4', constatare: 'negasit_in_surse', surse_consultate: ['NAS'], dovada_data: null })), '23514', 'A negăsit fără data obligației')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_y', constatare: 'camp_lipsa', dovada_sursa: 'mail' })), '23514', 'A câmp lipsă cu altă sursă decât camp_erp')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_y2', constatare: 'camp_lipsa', dovada_sursa: null })), '23514', 'A câmp lipsă FĂRĂ sursă (NULL nu trece ca UNKNOWN)')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_y3', constatare: 'camp_lipsa', dovada_ref: null })), '23514', 'A câmp lipsă fără câmpul (dovada_ref)')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_z', constatare: 'constatat', dovada_sursa: null })), '23514', 'A constatat fără sursă')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_z2', constatare: 'constatat', dovada_data: null })), '23514', 'A constatat fără data sursei')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_z3', constatare: 'constatat', dovada_fragment: null })), '23514', 'A constatat doar cu calea, fără fragment')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_t', termen: '2026-12-01', termen_confirmat: null })), '23514', 'A termen fără „confirmat”')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_t2', termen: '2026-12-01', termen_confirmat: true, termen_baza: null })), '23514', 'A termen CONFIRMAT fără baza calculului')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_t3', termen: null, termen_confirmat: null, termen_baza: 'x' })), '23514', 'A bază fără termen')
  // căile legitime ale contractului (L20), pe P3 (fără MP): termen neconfirmat fără bază; câmp lipsă doar cu câmpul; constatat fără cale
  const leg1 = asteptOk(await scrie(db, SEMNAL(3, { tip: 'doc_ok1', obiect: 'o1', termen: '2026-12-01', termen_confirmat: false, termen_baza: null, incertitudine: 'termen dedus' })), 'A termen neconfirmat fără bază (legitim)')
  if (leg1 && leg1.actiune !== 'creat') ab.push('A termen neconfirmat fără bază: ' + JSON.stringify(leg1))
  const leg2 = asteptOk(await scrie(db, SEMNAL(3, { tip: 'doc_ok2', obiect: 'o2', constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_ref: 'executie_proiecte.x', dovada_data: null, dovada_fragment: null, termen: null, termen_confirmat: null, termen_baza: null })), 'A câmp lipsă doar cu câmpul (legitim)')
  if (leg2 && leg2.actiune !== 'creat') ab.push('A câmp lipsă doar cu câmpul: ' + JSON.stringify(leg2))
  const leg3 = asteptOk(await scrie(db, SEMNAL(3, { tip: 'doc_ok3', obiect: 'o3', dovada_ref: null })), 'A constatat fără cale (legitim)')
  if (leg3 && leg3.actiune !== 'creat') ab.push('A constatat fără cale: ' + JSON.stringify(leg3))
  asteptCod(await scrie(db, SEMNAL(1, { titlu: 'ab' })), '23514', 'A titlu prea scurt')
  asteptCod(await scrie(db, SEMNAL(1, { obiect: 'x' + String.fromCharCode(7) })), '23514', 'A caracter de control în obiect')
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_o', obiect: NBSP + ZWSP + '\n' + NNBSP })), '22023', 'A obiect doar din spațiu alb / caractere fără lățime', /nu doar spațiu alb/)
  asteptCod(await scrie(db, SEMNAL(1, { regula_versiune: 'v 1' })), '23514', 'A versiunea regulii cu spațiu')
  asteptCod(await scrie(db, SEMNAL(999)), '22023', 'A proiect inexistent', /proiectul nu există/)
  asteptCod(await scrie(db, SEMNAL(1, { responsabil_employee_id: 15 })), '22023', 'A responsabil inactiv', /angajat activ/)
  asteptCod(await scrie(db, SEMNAL(1, { responsabil_employee_id: 999 })), '22023', 'A responsabil inexistent', /angajat activ/)
  asteptCod(await scrie(db, SEMNAL(1, { dovada_data: '21.11.2026' })), '22023', 'A zi în alt format', /AAAA-LL-ZZ/)
  asteptCod(await scrie(db, SEMNAL(1, { surse_consultate: ['', 'x'] })), '22023', 'A sursă goală în listă')
  // (pe o cheie proprie, ca un mutant care le-ar lăsa să treacă să nu modifice semnalul id1 folosit de verificările E)
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_v', obiect: 'v', surse_consultate: [NBSP + '\n' + NBSP, 'x'] })), '22023', 'A sursă doar din spațiu alb Unicode (NBSP / newline)', /nu doar spațiu alb/)
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_v2', obiect: 'v2', surse_consultate: ['x' + String.fromCharCode(7) + 'y'] })), '22023', 'A sursă cu caracter de control (BEL)', /caractere de control/)
  asteptCod(await scrie(db, SEMNAL(1, { tip: 'doc_w', obiect: 'w', dovada_fragment: NBSP + '\t' + NBSP })), '23514', 'A constatat cu fragmentul doar din spațiu alb Unicode (normalizat = NULL)')
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
  // P3 (fără MP, cele 3 semnale legitime) îl vede doar owner-ul
  for (const [cont, asteptat] of [['OWNER', '["1:2","2:1","3:3"]'], ['MP_P1', '["1:2"]'], ['MP_P2', '["2:1"]'], ['RESP', '["2:1"]'], ['MP_P1_RESTRANS', '[]'],
                                  ['SEF', '[]'], ['ADMIN', '[]'], ['VIEWER', '["1:1"]'], ['FARA', '[]']]) {
    for (const [nume, q] of [['tabel', Q], ['vedere', QV]]) { const v = await nr(U[cont], q); if (v !== asteptat) ab.push(`B ${nume} ${cont}: ${v} (aștepta ${asteptat})`) }
  }
  for (const [cont, asteptat] of [['OWNER', '["1:4","2:1","3:3"]'], ['MP_P1', '["1:4"]'], ['RESP', '["2:1"]'], ['SEF', '[]'], ['ADMIN', '[]'], ['MP_P1_RESTRANS', '[]']]) {
    const v = await nr(U[cont], QJ); if (v !== asteptat) ab.push(`B jurnal ${cont}: ${v} (aștepta ${asteptat})`)
  }
  if (await nr(null, Q) !== '[]') ab.push('B fără JWT vede semnale')
  asteptCod(await ca(db, 'anon', null, Q), '42501', 'B anon citește tabelul')
  asteptCod(await ca(db, 'anon', null, QV), '42501', 'B anon citește vederea')
  const vs = await ca(db, 'service_role', null, Q); if (vs.code || vs.rows.length !== 3) ab.push('B service_role (agentul) nu citește tot: ' + JSON.stringify(vs))
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
  // contractul stării și pe calea directă (CHECK, L07): rezolvat fără dovadă / acțiune, chiar cu motiv
  asteptCod(await ca(db, 'postgres', U.OWNER, `UPDATE public.executie_semnale SET stare = 'rezolvat', stare_motiv = 'gata' WHERE id = ${id3}`), '23514', 'C rezolvat direct fără dovadă / acțiune', /executie_semnale_stare_ck/)
  // cheia de deduplicare pe calea directă (agentul = postgres fără JWT poate insera): forma canonică trece, orice formă necanonică a obiectului e
  // refuzată de CHECK (NBSP la capete, caracter fără lățime în mijloc, spații duble, newline), iar „doar spațiu alb” NU trece prin UNKNOWN
  const insDirect = ob => ca(db, 'postgres', null, `INSERT INTO public.executie_semnale (proiect_id, flux, tip, obiect, gravitate, titlu, constatare, dovada_sursa, dovada_ref, dovada_amprenta, regula_versiune)
    VALUES (3, 'lipsuri', 'doc_direct', $1, 'info', 'Titlu direct', 'camp_lipsa', 'camp_erp', 'executie_proiecte.x', repeat('0', 32), 'v1')`.replace('$1', lit(ob)))
  const cd = await insDirect('direct:ok')
  if (cd.code) ab.push('C INSERT direct (agent) cu obiect canonic: ' + cd.code + ' ' + cd.message)
  for (const [ce, ob] of [['NBSP la capete', NBSP + 'direct:x' + NBSP], ['U+200B în mijloc', 'direct:' + ZWSP + 'x'], ['BOM la început', BOM + 'direct:x'], ['spații duble', 'direct  x'],
                          ['newline la capăt', 'direct:x\n'], ['doar NBSP (forma canonică NULL)', NBSP + NBSP], ['doar U+200B', ZWSP]]) {
    asteptCod(await insDirect(ob), '23514', `C INSERT direct cu obiect necanonic (${ce})`, /executie_semnale_obiect_ck/)
  }
  // D. starea omului: MP-ul pe P1; CAS; motivul; tranzițiile; dreptul; responsabilul
  let v = (await rand(db, id1)).versiune
  const d1 = asteptOk(await stare(db, U.MP_P1, id1, v, 'in_lucru'), 'D MP ia în lucru')
  if (d1 && (d1.ok !== true || d1.semnal.stare !== 'in_lucru' || d1.semnal.stare_de !== U.MP_P1 || d1.semnal.stare_la == null || d1.semnal.versiune !== v + 1)) ab.push('D in_lucru: ' + JSON.stringify(d1))
  const d2 = asteptOk(await stare(db, U.MP_P1, id1, v, 'respins', { motiv: 'x' }), 'D versiune veche')
  if (d2 && (d2.ok !== false || d2.motiv !== 'conflict' || d2.semnal.stare !== 'in_lucru')) ab.push('D CAS nu dă conflict: ' + JSON.stringify(d2))
  v += 1
  asteptCod(await stare(db, U.MP_P1, id1, v, 'respins'), '22023', 'D respins fără motiv', /cere un motiv/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'rezolvat', { motiv: '   ' }), '22023', 'D rezolvat cu motiv gol', /cere un motiv/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'rezolvat', { motiv: 'gata' }), '22023', 'D rezolvat doar cu motiv, fără dovadă / acțiune', /cere dovada rezolvării sau acțiunea/)
  asteptCod(await stare(db, U.MP_P1, id1, v, 'rezolvat', { motiv: 'gata', dovada: '  ' }), '22023', 'D rezolvat cu dovadă goală', /cere dovada rezolvării sau acțiunea/)
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
  // „fără responsabil” ales de om = tot decizie a omului (sursa om, id NULL): agentul nu mai propune peste ea
  const e3 = asteptOk(await stare(db, U.OWNER, id2, 3, null, { resp: null, schimba: true }), 'D owner-ul scoate responsabilul')
  if (e3 && (e3.ok !== true || e3.semnal.responsabil_employee_id !== null || e3.semnal.responsabil_sursa !== 'om')) ab.push('D „fără responsabil” nu e decizia omului: ' + JSON.stringify(e3))
  asteptCod(await stare(db, U.OWNER, id2, 4, null, { resp: null, schimba: true }), '22023', 'D „fără responsabil” ales a doua oară', /nimic de schimbat/)
  const e3b = asteptOk(await scrie(db, NEGASIT(2, { responsabil_employee_id: 14 })), 'D agentul propune peste „fără responsabil”')
  const rr0 = await rand(db, id2)
  if (e3b && (e3b.actiune !== 'neschimbat' || rr0.responsabil_employee_id !== null || rr0.responsabil_sursa !== 'om')) ab.push('D agentul a trecut peste „fără responsabil”: ' + JSON.stringify([e3b, rr0.responsabil_employee_id, rr0.responsabil_sursa]))
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET responsabil_employee_id = 14 WHERE id = ${id2}`), '42501', 'D calea directă a agentului peste „fără responsabil”', /stabilit de om/)
  const e4 = asteptOk(await stare(db, U.OWNER, id2, 5, null, { resp: 11, schimba: true }), 'D owner-ul pune înapoi responsabilul 11')
  if (e4 && e4.semnal.responsabil_sursa !== 'om') ab.push('D sursa responsabilului pus de om: ' + JSON.stringify(e4))
  const jd = await jurnal(db, id1, "AND actor = 'om'")
  if (jd.length !== 3 || jd.some(x => x.actiune !== 'stare' || x.actor_profile !== U.MP_P1) || jd[2].motiv !== 'Termenul e deja prelungit prin AA 2.' || jd[2].stare_veche !== 'in_lucru' || jd[2].stare_noua !== 'respins')
    ab.push('D jurnalul omului pe P1: ' + JSON.stringify(jd.map(x => [x.actiune, x.stare_veche, x.stare_noua, x.motiv])))
  const je = await jurnal(db, id2, "AND actiune = 'responsabil'")
  if (je.length !== 3 || JSON.stringify(je[0].valori.responsabil_employee_id) !== '[11,10]' || JSON.stringify(je[0].valori.responsabil_sursa) !== '["agent","om"]'
      || JSON.stringify(je[1].valori) !== '{"responsabil_employee_id":[10,null]}' || JSON.stringify(je[2].valori) !== '{"responsabil_employee_id":[null,11]}') ab.push('D jurnalul responsabilului: ' + JSON.stringify(je.map(x => x.valori)))
  // E. respins nu reapare cu aceeași dovadă; cu dovadă nouă se redeschide; rezolvat la fel; agentul nu schimbă responsabilul omului
  const f1 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14 })), 'E aceeași dovadă pe un respins')
  let rr = await rand(db, id1)
  if (f1 && (f1.actiune !== 'neschimbat_inchis' || rr.stare !== 'respins' || rr.stare_motiv == null || rr.versiune !== f1.versiune)) ab.push('E respinsul a reapărut: ' + JSON.stringify([f1, rr.stare]))
  if ((await jurnal(db, id1)).length !== 6) ab.push('E jurnalul s-a umplut la „neschimbat_inchis”: ' + (await jurnal(db, id1)).length)
  // REPRODUCEREA Jakarinos r2 (P2): creare → respingere de om → retrimitere cu \n / \t / \r / NBSP la capete ȘI în mijloc (fragment, surse,
  // referință) = `neschimbat_inchis`, starea rămâne `respins`, jurnalul nu crește, rândul nu se schimbă (nici versiunea)
  const SP = { gravitate: 'critic', responsabil_employee_id: 14 }
  const rrR = await rand(db, id1)
  for (const [ce, extra] of [
    ['fragmentul cu \\n la capete (reproducerea exactă)', { dovada_fragment: '\n' + SEMNAL(1).dovada_fragment + '\n' }],
    ['fragmentul cu \\n / \\t / \\r / NBSP la capete și în mijloc', { dovada_fragment: '\n\t' + NBSP + 'data_termen' + NBSP + '=\t\r\n  2026-12-11' + NNBSP + '\n' }],
    ['fragmentul cu BOM / spațiu fără lățime la capete', { dovada_fragment: BOM + 'data_termen = 2026-12-11' + ZWSP }],
    ['sursele cu \\n / \\t / NBSP la capete și în mijloc', { surse_consultate: ['\nERP:\t' + NBSP + 'executie_proiecte.data_termen' + NBSP + '\n'] }],
    ['referința cu \\n / tab / NBSP la capete', { dovada_ref: '\n\t' + NBSP + 'executie_proiecte.data_termen' + NBSP + '\t\n' }],
    ['referința cu spațiul interior dat ca NBSP + tab (același text normalizat)', { dovada_ref: 'executie_proiecte.data_termen', dovada_fragment: 'data_termen' + NBSP + '\t= 2026-12-11' }],
    ['toate trei deodată', { dovada_fragment: '\ndata_termen\t=\n2026-12-11 ', surse_consultate: ['  erp: EXECUTIE_PROIECTE.data_termen\n'], dovada_ref: ' executie_proiecte.data_termen\n' }],
  ]) {
    const g = asteptOk(await scrie(db, SEMNAL(1, { ...SP, ...extra })), `E (respins) ${ce}`)
    const rx = await rand(db, id1)
    if (g && (g.actiune !== 'neschimbat_inchis' || rx.stare !== 'respins' || rx.stare_motiv == null)) ab.push(`E (respins) ${ce} a redeschis semnalul (dovadă „nouă” din spațiu alb): ` + JSON.stringify([g.actiune, rx.stare]))
    if (rx.dovada_fragment !== rrR.dovada_fragment || rx.dovada_ref !== rrR.dovada_ref || JSON.stringify(rx.surse_consultate) !== JSON.stringify(rrR.surse_consultate) || rx.dovada_amprenta !== rrR.dovada_amprenta)
      ab.push(`E (respins) ${ce} a schimbat textele / amprenta rândului închis: ` + JSON.stringify([rx.dovada_fragment, rx.dovada_ref, rx.surse_consultate]))
  }
  if ((await jurnal(db, id1)).length !== 6) ab.push('E jurnal nou la retrimiterile cu spațiu alb pe respins: ' + (await jurnal(db, id1)).length)
  const f2 = asteptOk(await scrie(db, SEMNAL(1, { gravitate: 'critic', responsabil_employee_id: 14, dovada_fragment: 'data_termen = 2026-12-05 (AA 3)', dovada_data: '2026-11-22' })), 'E dovadă nouă pe un respins')
  rr = await rand(db, id1)
  if (f2 && (f2.actiune !== 'redeschis' || rr.stare !== 'nou' || rr.stare_motiv !== null || rr.stare_de !== null || rr.actiune_ref !== null)) ab.push('E dovada nouă nu redeschide curat: ' + JSON.stringify([f2, rr.stare, rr.stare_motiv]))
  const jr = await jurnal(db, id1, "AND actiune = 'redeschis'")
  if (jr.length !== 1 || jr[0].stare_veche !== 'respins' || jr[0].stare_noua !== 'nou' || jr[0].actor !== 'agent' || !/dovadă nouă/.test(jr[0].motiv || '')) ab.push('E jurnalul redeschiderii: ' + JSON.stringify(jr))
  v = rr.versiune
  const g1 = asteptOk(await stare(db, U.OWNER, id1, v, 'rezolvat', { motiv: 'prelungit prin AA 3', dovada: 'AA nr. 3 / 2026' }), 'E owner-ul rezolvă (motiv + dovadă)')
  if (g1 && (g1.ok !== true || g1.semnal.stare_dovada !== 'AA nr. 3 / 2026')) ab.push('E rezolvarea: ' + JSON.stringify(g1))
  const DOV3 = { gravitate: 'critic', responsabil_employee_id: 14, dovada_fragment: 'data_termen = 2026-12-05 (AA 3)', dovada_data: '2026-11-22' }
  const g2 = asteptOk(await scrie(db, SEMNAL(1, DOV3)), 'E aceeași dovadă pe un rezolvat')
  rr = await rand(db, id1)
  if (g2 && (g2.actiune !== 'neschimbat_inchis' || rr.stare !== 'rezolvat')) ab.push('E rezolvatul a reapărut: ' + JSON.stringify([g2, rr.stare]))
  // AMPRENTA E CANONICĂ: diferențele nesemantice ale dovezii NU sunt dovadă nouă (semnalul închis NU reapare, jurnalul nu crește)
  const nj1 = (await jurnal(db, id1)).length
  const SURSE2 = ['ERP: executie_proiecte.data_termen', 'mail: AA 3']
  const g3 = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, surse_consultate: SURSE2 })), 'E o sursă consultată în plus pe un rezolvat (dovadă nouă)')
  rr = await rand(db, id1)
  if (g3 && (g3.actiune !== 'redeschis' || rr.stare !== 'nou' || JSON.stringify(rr.surse_consultate) !== JSON.stringify(SURSE2))) ab.push('E sursa nouă nu redeschide / sursele nu sunt stocate canonic: ' + JSON.stringify([g3, rr.stare, rr.surse_consultate]))
  const g4 = asteptOk(await stare(db, U.OWNER, id1, rr.versiune, 'rezolvat', { motiv: 'prelungit prin AA 3', ref: 'TKT-2026-9998' }), 'E owner-ul rezolvă din nou (motiv + acțiune)')
  if (g4 && g4.ok !== true) ab.push('E rezolvarea a doua: ' + JSON.stringify(g4))
  const nj2 = (await jurnal(db, id1)).length
  for (const [ce, extra] of [
    ['sursele în altă ordine', { surse_consultate: [SURSE2[1], SURSE2[0]] }],
    ['sursele cu majuscule / spații / dublură', { surse_consultate: ['  MAIL:   aa 3 ', 'erp: EXECUTIE_PROIECTE.data_termen', 'Mail: AA 3'] }],
    ['fragmentul cu spații în plus', { surse_consultate: SURSE2, dovada_fragment: '  data_termen =   2026-12-05 (AA 3) ' }],
    ['calea cu spații la capete', { surse_consultate: SURSE2, dovada_ref: ' executie_proiecte.data_termen ' }],
    // runda 3: TOT spațiul alb (newline, tab, CR, NBSP, spațiul îngust fără rupere), la capete și în mijloc, pe fiecare text al amprentei
    ['fragmentul cu \\n / \\t / NBSP la capete și în mijloc', { surse_consultate: SURSE2, dovada_fragment: '\n' + NBSP + 'data_termen\t=' + NBSP + '2026-12-05\r\n(AA' + NNBSP + '3)\n\t' }],
    ['sursele cu \\n / \\t / NBSP la capete și în mijloc', { surse_consultate: ['\tmail:' + NBSP + 'AA 3\n', NBSP + 'ERP:\nexecutie_proiecte.data_termen' + NBSP] }],
    ['calea cu \\n / NBSP la capete', { surse_consultate: SURSE2, dovada_ref: '\n' + NBSP + 'executie_proiecte.data_termen' + NBSP + '\n' }],
  ]) {
    const g = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, ...extra })), `E ${ce} pe un rezolvat`)
    rr = await rand(db, id1)
    if (g && (g.actiune !== 'neschimbat_inchis' || rr.stare !== 'rezolvat')) ab.push(`E ${ce} a redeschis semnalul (dovadă „nouă” nesemantică): ` + JSON.stringify([g.actiune, rr.stare]))
  }
  if ((await jurnal(db, id1)).length !== nj2) ab.push('E jurnal nou la diferențe nesemantice')
  // dovadă REALĂ nouă (altă dată a sursei) → redeschis
  const g5 = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, surse_consultate: SURSE2, dovada_data: '2026-11-23' })), 'E altă dată a sursei pe un rezolvat')
  rr = await rand(db, id1)
  if (g5 && (g5.actiune !== 'redeschis' || rr.stare !== 'nou')) ab.push('E data nouă nu redeschide: ' + JSON.stringify([g5, rr.stare]))
  if ((await jurnal(db, id1, "AND actiune = 'redeschis'")).length !== 3) ab.push('E numărul redeschiderilor: ' + (await jurnal(db, id1, "AND actiune = 'redeschis'")).length)
  // pe un semnal DESCHIS aceeași listă în altă ordine = „neschimbat” (nu „actualizat” cu diferență falsă); stocarea rămâne canonică
  const g6 = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, dovada_data: '2026-11-23', surse_consultate: [SURSE2[1], SURSE2[0]] })), 'E ordinea surselor pe un semnal deschis')
  rr = await rand(db, id1)
  if (g6 && (g6.actiune !== 'neschimbat' || JSON.stringify(rr.surse_consultate) !== JSON.stringify(SURSE2))) ab.push('E ordinea surselor a dat „actualizat” / stocare necanonică: ' + JSON.stringify([g6.actiune, rr.surse_consultate]))
  // pe un semnal DESCHIS spațiul alb din fragment / surse / referință = „neschimbat” (textele STOCATE sunt normalizate, nu doar amprenta), fără jurnal
  const nj6 = (await jurnal(db, id1)).length
  const g6b = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, dovada_data: '2026-11-23', surse_consultate: ['\n' + SURSE2[1] + '\t', NBSP + SURSE2[0] + '\n'],
    dovada_fragment: '\n\tdata_termen' + NBSP + '= 2026-12-05\r\n(AA 3)\n', dovada_ref: '\nexecutie_proiecte.data_termen\t' })), 'E spațiul alb pe un semnal deschis')
  rr = await rand(db, id1)
  if (g6b && (g6b.actiune !== 'neschimbat' || rr.dovada_fragment !== DOV3.dovada_fragment || rr.dovada_ref !== 'executie_proiecte.data_termen' || JSON.stringify(rr.surse_consultate) !== JSON.stringify(SURSE2)))
    ab.push('E spațiul alb pe un semnal deschis a dat „actualizat” / textele stocate nenormalizate: ' + JSON.stringify([g6b.actiune, rr.dovada_fragment, rr.dovada_ref, rr.surse_consultate]))
  if ((await jurnal(db, id1)).length !== nj6) ab.push('E jurnal nou la spațiu alb pe un semnal deschis')
  // textele stocate la CREARE sunt normalizate la fel (fragment / referință / surse cu \n, tab, NBSP)
  const g6c = asteptOk(await scrie(db, SEMNAL(3, { tip: 'doc_sp', obiect: 'sp', dovada_fragment: '\n\tdata_termen' + NBSP + '=\n2026-12-11 ', dovada_ref: ' executie_proiecte.' + NBSP + 'data_termen\n',
    surse_consultate: ['\nERP:\t' + NBSP + 'executie_proiecte.data_termen' + NBSP + '\n', 'erp: EXECUTIE_PROIECTE.DATA_TERMEN'] })), 'E crearea cu spațiu alb în textele dovezii')
  const rsp = g6c ? await rand(db, g6c.id) : null
  if (rsp && (rsp.dovada_fragment !== 'data_termen = 2026-12-11' || rsp.dovada_ref !== 'executie_proiecte. data_termen' || JSON.stringify(rsp.surse_consultate) !== JSON.stringify(['ERP: executie_proiecte.data_termen'])))
    ab.push('E textele stocate la creare nu sunt normalizate: ' + JSON.stringify([rsp.dovada_fragment, rsp.dovada_ref, rsp.surse_consultate]))
  const g7 = asteptOk(await stare(db, U.OWNER, id1, rr.versiune, 'rezolvat', { motiv: 'prelungit prin AA 3', ref: 'TKT-2026-9998' }), 'E owner-ul rezolvă a treia dată')
  if (g7 && g7.ok !== true) ab.push('E rezolvarea a treia: ' + JSON.stringify(g7))
  rr = await rand(db, id1)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET stare = 'nou' WHERE id = ${id1}`), '42501', 'E redeschidere directă fără dovadă nouă', /dovadă nouă/)
  // CONFIRMAREA EXPLICITĂ a responsabilului propus de agent (același angajat 14): sursa devine om, jurnal 'responsabil'; agentul nu-l mai schimbă,
  // nici la redeschidere, nici pe calea directă; omul nu poate pune înapoi „agent”
  if (rr.responsabil_employee_id !== 14 || rr.responsabil_sursa !== 'agent') ab.push('E precondiție: responsabilul propus de agent: ' + JSON.stringify([rr.responsabil_employee_id, rr.responsabil_sursa]))
  const njc = (await jurnal(db, id1)).length
  const k1 = asteptOk(await stare(db, U.MP_P1, id1, rr.versiune, null, { resp: 14, schimba: true }), 'E MP-ul confirmă responsabilul propus (același angajat)')
  rr = await rand(db, id1)
  if (k1 && (k1.ok !== true || rr.responsabil_employee_id !== 14 || rr.responsabil_sursa !== 'om' || rr.stare !== 'rezolvat')) ab.push('E confirmarea nu a dat sursa om: ' + JSON.stringify([k1, rr.responsabil_employee_id, rr.responsabil_sursa]))
  const jk = await jurnal(db, id1, "AND actiune = 'responsabil'")
  if (jk.length !== 1 || (await jurnal(db, id1)).length !== njc + 1 || JSON.stringify(jk[0].valori) !== '{"responsabil_sursa":["agent","om"]}' || jk[0].actor_profile !== U.MP_P1) ab.push('E jurnalul confirmării: ' + JSON.stringify(jk.map(x => x.valori)))
  asteptCod(await stare(db, U.MP_P1, id1, rr.versiune, null, { resp: 14, schimba: true }), '22023', 'E confirmarea a doua oară (deja al omului)', /nimic de schimbat/)
  const k2 = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, dovada_data: '2026-11-23', surse_consultate: SURSE2, responsabil_employee_id: 10 })), 'E agentul propune alt responsabil pe cel confirmat (aceeași dovadă)')
  rr = await rand(db, id1)
  if (k2 && (k2.actiune !== 'neschimbat_inchis' || rr.responsabil_employee_id !== 14 || rr.responsabil_sursa !== 'om')) ab.push('E agentul a schimbat responsabilul confirmat: ' + JSON.stringify([k2, rr.responsabil_employee_id, rr.responsabil_sursa]))
  const k3 = asteptOk(await scrie(db, SEMNAL(1, { ...DOV3, dovada_data: '2026-11-24', surse_consultate: SURSE2, responsabil_employee_id: 10 })), 'E agentul redeschide cu dovadă nouă și alt responsabil')
  rr = await rand(db, id1)
  if (k3 && (k3.actiune !== 'redeschis' || rr.stare !== 'nou' || rr.responsabil_employee_id !== 14 || rr.responsabil_sursa !== 'om')) ab.push('E redeschiderea a schimbat responsabilul confirmat: ' + JSON.stringify([k3, rr.responsabil_employee_id, rr.responsabil_sursa]))
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET responsabil_employee_id = 10 WHERE id = ${id1}`), '42501', 'E calea directă a agentului pe responsabilul confirmat', /stabilit de om/)
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET responsabil_employee_id = NULL WHERE id = ${id1}`), '42501', 'E agentul scoate responsabilul confirmat (direct)', /stabilit de om/)
  const k4 = await ca(db, 'postgres', U.OWNER, `UPDATE public.executie_semnale SET responsabil_sursa = 'agent' WHERE id = ${id1}`)
  rr = await rand(db, id1)
  if (k4.code || rr.responsabil_sursa !== 'om') ab.push('E omul a pus înapoi sursa „agent” (direct): ' + JSON.stringify([k4.code, rr.responsabil_sursa]))
  const k5 = await ca(db, 'postgres', U.OWNER, `UPDATE public.executie_semnale SET responsabil_sursa = NULL WHERE id = ${id1}`)
  rr = await rand(db, id1)
  if (k5.code || rr.responsabil_sursa !== 'om') ab.push('E omul a șters confirmarea (direct): ' + JSON.stringify([k5.code, rr.responsabil_sursa]))
  // același angajat propus de agent, apoi omul alege „fără responsabil” pe un semnal nou (id3): sursa om cu id NULL; agentul nu mai propune
  const k6 = asteptOk(await scrie(db, SEMNAL(1, { tip: 'polita_expira', obiect: 'polita:CAR', titlu: 'Polița CAR expiră', gravitate: 'critic', termen: '2026-11-30', responsabil_employee_id: 14 })), 'E agentul propune responsabil pe al treilea semnal')
  rr = await rand(db, id3)
  if (k6 && (k6.actiune !== 'actualizat' || rr.responsabil_sursa !== 'agent')) ab.push('E propunerea pe id3: ' + JSON.stringify([k6, rr.responsabil_sursa]))
  const k7 = asteptOk(await stare(db, U.MP_P1, id3, rr.versiune, null, { resp: null, schimba: true }), 'E MP-ul alege „fără responsabil” peste propunere')
  rr = await rand(db, id3)
  if (k7 && (k7.ok !== true || rr.responsabil_employee_id !== null || rr.responsabil_sursa !== 'om' || rr.stare !== 'nou')) ab.push('E „fără responsabil” pe id3: ' + JSON.stringify([k7, rr.responsabil_employee_id, rr.responsabil_sursa]))
  const k8 = asteptOk(await scrie(db, SEMNAL(1, { tip: 'polita_expira', obiect: 'polita:CAR', titlu: 'Polița CAR expiră', gravitate: 'critic', termen: '2026-11-30', responsabil_employee_id: 14 })), 'E agentul propune din nou pe id3')
  rr = await rand(db, id3)
  if (k8 && (k8.actiune !== 'neschimbat' || rr.responsabil_employee_id !== null || rr.responsabil_sursa !== 'om')) ab.push('E agentul a trecut peste „fără responsabil” pe id3: ' + JSON.stringify([k8, rr.responsabil_employee_id, rr.responsabil_sursa]))
  // angajatul 14 (VIEWER) nu mai vede id3 (nu e responsabil), dar îl vede pe id1 (confirmat)
  if (await nr(U.VIEWER, Q) !== '["1:1"]') ab.push('E vizibilitatea după confirmări: ' + await nr(U.VIEWER, Q))
  // agentul propune alt responsabil pe id2 (sursa om = 11): rămâne 11, fără jurnal nou
  const nj = (await jurnal(db, id2)).length
  const h1 = asteptOk(await scrie(db, NEGASIT(2, { responsabil_employee_id: 14 })), 'E agentul propune alt responsabil pe semnalul cu responsabil pus de om')
  rr = await rand(db, id2)
  if (h1 && (h1.actiune !== 'neschimbat' || rr.responsabil_employee_id !== 11 || rr.responsabil_sursa !== 'om')) ab.push('E agentul a schimbat responsabilul omului: ' + JSON.stringify([h1, rr.responsabil_employee_id, rr.responsabil_sursa]))
  if ((await jurnal(db, id2)).length !== nj) ab.push('E jurnal nou la „neschimbat”')
  asteptCod(await ca(db, 'postgres', null, `UPDATE public.executie_semnale SET responsabil_employee_id = 14 WHERE id = ${id2}`), '42501', 'E calea directă schimbă responsabilul omului', /stabilit de om/)
  // REPRODUCEREA Jakarinos r3 (P2): `polita:GBE` (id2) → respingere de om → retrimitere cu NBSP / U+202F / U+200B la capete și în mijloc, cu
  // U+2060 / ZWJ / BOM, cu tab + newline = ACELAȘI id, `neschimbat_inchis`, stare respins, obiectul stocat neschimbat, UN rând pe cheie; versiunea
  // crește cu 1 la fiecare (ultima_verificare e o scriere, garda o numără), jurnalul NU crește
  rr = await rand(db, id2)
  const rj1 = asteptOk(await stare(db, U.OWNER, id2, rr.versiune, 'respins', { motiv: 'Polița GBE e la responsabilul contracte, nescanată.' }), 'E (Jak r3) owner-ul respinge polita:GBE')
  rr = await rand(db, id2)
  if (rj1 && (rj1.ok !== true || rr.stare !== 'respins' || rr.obiect !== 'polita:GBE')) ab.push('E (Jak r3) precondiție: ' + JSON.stringify([rj1, rr.stare, rr.obiect]))
  const njJ = (await jurnal(db, id2)).length
  const nrGBE = async () => (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE proiect_id = 2 AND tip = 'document_negasit'`)).rows[0].n
  for (const [ce, ob] of [
    ['NBSP la capete (reproducerea exactă)', NBSP + 'polita:GBE' + NBSP],
    ['U+202F la capete', NNBSP + 'polita:GBE' + NNBSP],
    ['U+200B la capete', ZWSP + 'polita:GBE' + ZWSP],
    ['U+200B în mijloc', 'polita:' + ZWSP + 'GBE'],
    ['U+2060 și ZWJ în mijloc, BOM la capăt', BOM + 'polita' + WJ + ':' + ZWJ + 'GBE'],
    ['U+00AD și U+200E în mijloc', 'po' + SHY + 'lita:' + LRM + 'GBE'],
    ['tab + newline la capete', '\tpolita:GBE\n'],
  ]) {
    const vIn = (await rand(db, id2)).versiune
    const g = asteptOk(await scrie(db, NEGASIT(2, { obiect: ob })), `E (Jak r3, respins) obiect cu ${ce}`)
    const rx = await rand(db, id2)
    if (g && (g.id !== id2 || g.actiune !== 'neschimbat_inchis' || rx.stare !== 'respins' || rx.obiect !== 'polita:GBE'))
      ab.push(`E (Jak r3, respins) obiect cu ${ce} a creat alt rând / a redeschis: ` + JSON.stringify([g.id, id2, g.actiune, rx.stare, rx.obiect]))
    if (g && (g.versiune !== vIn + 1 || rx.versiune !== vIn + 1)) ab.push(`E (Jak r3, respins) obiect cu ${ce}: versiunea nu crește cu 1 la neschimbat_inchis: ` + JSON.stringify([vIn, g.versiune, rx.versiune]))
    const nG = await nrGBE(); if (nG !== 1) ab.push(`E (Jak r3, respins) obiect cu ${ce}: ${nG} rânduri pentru polita:GBE`)
  }
  if ((await jurnal(db, id2)).length !== njJ) ab.push('E (Jak r3) jurnal nou la retrimiterile cu spațiu alb / fără lățime pe cheie: ' + (await jurnal(db, id2)).length)
  // o cheie REAL diferită rămâne alt semnal (L20): litere / cifre în plus
  const gD = asteptOk(await scrie(db, NEGASIT(2, { obiect: 'polita:GBE-2026', titlu: 'Polița GBE 2026 nu a fost găsită' })), 'E (Jak r3) altă cheie (polita:GBE-2026)')
  if (gD && (gD.actiune !== 'creat' || gD.id === id2)) ab.push('E (Jak r3) cheia diferită nu e semnal nou: ' + JSON.stringify(gD))
  if (await nrGBE() !== 2) ab.push('E (Jak r3) după cheia diferită: ' + await nrGBE() + ' rânduri')
  // cheie cu spațiu INTERIOR (P3): NBSP / U+202F / tab în loc de spații, spații duble + capete, U+200B între două spații (eliminarea ÎNAINTEA
  // strângerii), U+00AD / U+200E în cuvânt = același rând: pe deschis „neschimbat” (fără jurnal), pe respins „neschimbat_inchis”
  const AA = SEMNAL(3, { tip: 'act_aditional_lipsa', obiect: 'act aditional: AA 2', titlu: 'Actul adițional 2 nu e în ERP' })
  const aa1 = asteptOk(await scrie(db, AA), 'E (Jak r3) crearea cheii cu spațiu interior')
  const idAA = aa1?.id
  if (idAA && (await rand(db, idAA)).obiect !== 'act aditional: AA 2') ab.push('E (Jak r3) cheia stocată: ' + (await rand(db, idAA)).obiect)
  const FORME_AA = [['NBSP / U+202F / tab în loc de spații', 'act' + NBSP + 'aditional:' + NNBSP + 'AA\t2'], ['spații duble + capete', '  act  aditional:  AA  2 '],
    ['U+200B între două spații', 'act ' + ZWSP + ' aditional: AA 2'], ['U+00AD și U+200E în cuvânt', 'act adi' + SHY + 'tional: ' + LRM + 'AA 2'], ['BOM + newline la capete', BOM + 'act aditional: AA 2\n']]
  if (idAA) {
    const njA = (await jurnal(db, idAA)).length
    for (const [ce, ob] of FORME_AA) {
      const g = asteptOk(await scrie(db, { ...AA, obiect: ob }), `E (Jak r3, deschis) obiect cu ${ce}`)
      if (g && (g.id !== idAA || g.actiune !== 'neschimbat')) ab.push(`E (Jak r3, deschis) obiect cu ${ce} a creat alt rând / „actualizat”: ` + JSON.stringify([g.id, idAA, g.actiune]))
    }
    if ((await jurnal(db, idAA)).length !== njA) ab.push('E (Jak r3, deschis) jurnal nou la formele cheii')
    const rA = await rand(db, idAA)
    const rj2 = asteptOk(await stare(db, U.OWNER, idAA, rA.versiune, 'respins', { motiv: 'AA 2 nu există: contractul nu a fost modificat.' }), 'E (Jak r3) owner-ul respinge cheia cu spațiu interior')
    if (rj2 && rj2.ok !== true) ab.push('E (Jak r3) respingerea cheii cu spațiu interior: ' + JSON.stringify(rj2))
    for (const [ce, ob] of FORME_AA) {
      const g = asteptOk(await scrie(db, { ...AA, obiect: ob }), `E (Jak r3, respins) obiect cu ${ce}`)
      const rx = await rand(db, idAA)
      if (g && (g.id !== idAA || g.actiune !== 'neschimbat_inchis' || rx.stare !== 'respins' || rx.obiect !== 'act aditional: AA 2'))
        ab.push(`E (Jak r3, respins) obiect cu ${ce} a creat alt rând / a redeschis: ` + JSON.stringify([g.id, idAA, g.actiune, rx.stare, rx.obiect]))
    }
    const nAA = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE proiect_id = 3 AND tip = 'act_aditional_lipsa'`)).rows[0].n
    if (nAA !== 1) ab.push(`E (Jak r3) ${nAA} rânduri pentru cheia cu spațiu interior`)
  }
  // F. cheile din jurnalul creat: toate câmpurile de la creare în „valori” (nou = [null, valoare]); versiunea regulii
  const jc = (await jurnal(db, id3, "AND actiune = 'creat'"))[0]
  if (!jc || jc.regula_versiune !== 'lipsuri-v1' || JSON.stringify(jc.valori.titlu) !== '[null,"Polița CAR expiră"]' || JSON.stringify(jc.valori.stare) !== '[null,"nou"]') ab.push('F jurnalul creării: ' + JSON.stringify(jc?.valori))
  // funcțiile interne nu se cheamă din API
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_semnal_tranzitie('nou', 'in_lucru', 'om')`), '42501', 'F funcție internă din API')
  asteptCod(await ca(db, 'service_role', null, `SELECT public.fn_executie_semnal_stare(${id1}, 1, 'in_lucru', NULL, NULL, NULL, NULL, false)`), '42501', 'F RPC-ul omului din service_role')
  const dr = await ca(db, 'authenticated', U.MP_P1, 'SELECT public.fn_executie_semnal_drept(1, NULL) AS a, public.fn_executie_semnal_drept(2, NULL) AS b, public.fn_executie_semnal_drept(2, 10) AS c, public.fn_executie_semnal_drept(999, 10) AS d')
  if (dr.code || JSON.stringify(dr.rows[0]) !== '{"a":true,"b":false,"c":true,"d":false}') ab.push('F dreptul (MP P1): ' + JSON.stringify(dr))
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_semnal_canonic(' A  b ')`), '42501', 'F forma canonică din API')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_semnal_spatii(' A  b ')`), '42501', 'F normalizarea spațiului alb din API')
  const can = await db.query(`SELECT public.fn_executie_semnal_canonic($1) AS c, public.fn_executie_semnal_canonic('   ') AS g, public.fn_executie_semnal_canonic(NULL) AS n`, ['  NAS:  Z:/x   Y\t z '])
  if (JSON.stringify(can.rows[0]) !== '{"c":"nas: z:/x y z","g":null,"n":null}') ab.push('F forma canonică: ' + JSON.stringify(can.rows[0]))
  // spațiul alb: ÎNTÂI strâns (orice spațiu alb, inclusiv \n / \t / \r / \v / \f / NEL / NBSP / U+2007 / U+202F / U+3000 / BOM / U+200B), APOI tăiat
  // la capete; literele rămân (canonic le face mici); doar spațiu alb = NULL
  const sp = await db.query(`SELECT public.fn_executie_semnal_spatii($1) AS a, public.fn_executie_semnal_spatii($2) AS b, public.fn_executie_semnal_spatii($3) AS g,
      public.fn_executie_semnal_spatii(NULL) AS n, public.fn_executie_semnal_canonic($1) AS c, public.fn_executie_semnal_spatii('x') AS x`,
    ['\n\t' + NBSP + 'Art.' + NBSP + '8:\r\n GBE' + String.fromCharCode(8199) + 'obligatorie' + NNBSP + String.fromCharCode(11) + '\f' + String.fromCharCode(133) + String.fromCharCode(12288) + '\n',
     BOM + 'a' + ZWSP + 'b' + String.fromCharCode(5760) + 'c' + String.fromCharCode(8287) + 'd' + String.fromCharCode(8232) + 'e' + BOM,
     '\n' + NBSP + '\t' + NNBSP + BOM + ' '])
  // (BOM și U+200B se ELIMINĂ: „a” + U+200B + „b” = „ab”; U+1680 / U+205F / U+2028 sunt spații)
  if (JSON.stringify(sp.rows[0]) !== '{"a":"Art. 8: GBE obligatorie","b":"ab c d e","g":null,"n":null,"c":"art. 8: gbe obligatorie","x":"x"}') ab.push('F spațiul alb normalizat: ' + JSON.stringify(sp.rows[0]))
  // caracterele fără lățime (U+200B–U+200D, U+200E, U+2060, BOM, U+00AD, marcajele bidi U+202A–U+202E / U+2066–U+2069) se ELIMINĂ, înaintea
  // strângerii (U+200B între două spații = un spațiu); NBSP / U+2007 / U+202F devin spațiu; doar caractere fără lățime = NULL
  const zw = await db.query(`SELECT public.fn_executie_semnal_spatii($1) AS a, public.fn_executie_semnal_spatii($2) AS b, public.fn_executie_semnal_spatii($3) AS c,
      public.fn_executie_semnal_spatii($4) AS d, public.fn_executie_semnal_spatii($5) AS e, public.fn_executie_semnal_spatii($6) AS f`,
    ['polita:' + ZWSP + 'GBE', 'a ' + ZWSP + ' b', 'x' + ZWJ + 'y' + WJ + 'z' + LRM + 'w' + SHY + 'v' + String.fromCharCode(8234) + 'u' + String.fromCharCode(8294) + 't' + String.fromCharCode(8204) + 's',
     'a' + NBSP + 'b' + String.fromCharCode(8199) + 'c' + NNBSP + 'd', ZWSP + BOM + WJ + SHY, NBSP + ZWSP + NBSP + 'q' + ZWSP + NBSP])
  if (JSON.stringify(zw.rows[0]) !== '{"a":"polita:GBE","b":"a b","c":"xyzwvuts","d":"a b c d","e":null,"f":"q"}') ab.push('F caracterele fără lățime / spațiile Unicode: ' + JSON.stringify(zw.rows[0]))
  // amprenta: aceeași pentru dovezi egale până la spațiu alb (fragment / surse / referință), diferită la o literă în plus
  const am = await db.query(`SELECT public.fn_executie_semnal_amprenta('constatat', ARRAY['NAS: x', 'mail: y'], 'document', '2026-09-18', 'art. 8: GBE obligatorie', 'Z:/a b.pdf') AS a,
      public.fn_executie_semnal_amprenta('constatat', ARRAY[$1, $2], 'document', '2026-09-18', $3, $4) AS b,
      public.fn_executie_semnal_amprenta('constatat', ARRAY['NAS: x', 'mail: y'], 'document', '2026-09-18', 'art. 8: GBE obligatorie!', 'Z:/a b.pdf') AS c`,
    ['\nmail:' + NBSP + 'Y\t', ' nas: X ', '\n' + NBSP + 'art.' + NBSP + '8:\t\r\nGBE' + String.fromCharCode(11) + 'obligatorie' + NNBSP + '\n', '\tZ:/a' + NBSP + 'b.pdf\n'])
  if (am.rows[0].a !== am.rows[0].b || am.rows[0].a === am.rows[0].c) ab.push('F amprenta nu e canonică pe spațiu alb / nu deosebește o literă: ' + JSON.stringify(am.rows[0]))
  // G. PILOTUL: cele 13 semnale ale testului „pe hârtie” (sintetizate) se reprezintă EXACT în contract, pe P3; fiecare constatare e acoperită,
  //    iar fiecare „negăsit” poartă obligația (sursă + dată + fragment). Scoaterea unei piese a contractului din fiecare = refuz 23514.
  const pilot = PILOT(3, { mp: 10, contracte: 11 })
  if (pilot.length !== 13) ab.push('G pilotul nu are 13 semnale: ' + pilot.length)
  const nP3 = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE proiect_id = 3`)).rows[0].n
  for (const [i, s] of pilot.entries()) {
    const r = asteptOk(await scrie(db, s), `G pilot #${i + 1} (${s.constatare}): ${s.titlu}`)
    if (r && r.actiune !== 'creat') ab.push(`G pilot #${i + 1} nu e „creat”: ` + JSON.stringify(r))
  }
  const pil = (await db.query(`SELECT constatare, count(*)::int AS n, bool_and(dovada_sursa IS NOT NULL AND dovada_data IS NOT NULL AND dovada_fragment IS NOT NULL) AS obligatie,
                                       bool_and(termen IS NULL OR termen_confirmat IS NOT TRUE OR termen_baza IS NOT NULL) AS baza
                                  FROM public.executie_semnale WHERE proiect_id = 3 AND regula_versiune = 'pilot-2026-11-22' GROUP BY 1 ORDER BY 1`)).rows
  if (JSON.stringify(pil) !== JSON.stringify([{ constatare: 'camp_lipsa', n: 6, obligatie: true, baza: true }, { constatare: 'constatat', n: 2, obligatie: true, baza: true }, { constatare: 'negasit_in_surse', n: 5, obligatie: true, baza: true }]))
    ab.push('G pilotul pe constatări: ' + JSON.stringify(pil))
  const nP3b = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE proiect_id = 3`)).rows[0].n
  if (nP3b !== nP3 + 13) ab.push(`G ${nP3b - nP3} rânduri noi pe P3 (așteptate 13)`)
  for (const [i, s] of pilot.entries()) {
    const rupt = s.constatare === 'camp_lipsa' ? { dovada_sursa: null } : s.constatare === 'negasit_in_surse' ? { dovada_fragment: null } : { dovada_data: null }
    asteptCod(await scrie(db, { ...s, obiect: s.obiect + ':rupt', ...rupt }), '23514', `G pilot #${i + 1} fără ${Object.keys(rupt)[0]}`)
    if (s.termen_confirmat === true) asteptCod(await scrie(db, { ...s, obiect: s.obiect + ':rupt2', termen_baza: null }), '23514', `G pilot #${i + 1} termen confirmat fără bază`)
  }
  // a doua rulare a agentului, cu aceleași semnale = 13 × neschimbat (niciun rând nou, niciun jurnal nou)
  const nj3 = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale_jurnal WHERE proiect_id = 3`)).rows[0].n
  for (const s of pilot) { const r = asteptOk(await scrie(db, s), 'G a doua rulare'); if (r && r.actiune !== 'neschimbat') ab.push('G a doua rulare nu e „neschimbat”: ' + JSON.stringify(r)) }
  if ((await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale WHERE proiect_id = 3`)).rows[0].n !== nP3b
      || (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale_jurnal WHERE proiect_id = 3`)).rows[0].n !== nj3) ab.push('G a doua rulare a scris rânduri / jurnal')
  return ab
}

// ── definițiile efective pe care le verifică revenirea: expresia DEF-ACTUAL citită din fișierul revenirii, rulată pe cele 7 chei ──
const CHEI_DEF = ['coloane:executie_semnale', 'coloane:executie_semnale_jurnal', 'constrangeri:executie_semnale', 'constrangeri:executie_semnale_jurnal',
  'indexuri:executie_semnale', 'indexuri:executie_semnale_jurnal', 'vedere:v_executie_semnale']
const DEF_ACTUAL = (() => { const i = REV.indexOf('-- DEF-ACTUAL-START'), j = REV.indexOf('-- DEF-ACTUAL-END'); if (i < 0 || j < 0) throw new Error('DEF-ACTUAL lipsește din revenire'); return REV.slice(i + '-- DEF-ACTUAL-START'.length, j) })()
async function definitii(db) {
  const r = await db.query(`SELECT a.cheie, (${DEF_ACTUAL}) AS real FROM (VALUES ${CHEI_DEF.map(c => `(${lit(c)})`).join(', ')}) a(cheie)`)
  return Object.fromEntries(r.rows.map(x => [x.cheie, x.real]))
}
/** blocul DEFINITII din revenire: { cheie: text } */
function definitiiRevenire(text) {
  const bloc = text.slice(text.indexOf('-- DEFINITII-START'), text.indexOf('-- DEFINITII-END'))
  return Object.fromEntries([...bloc.matchAll(/\('([a-z_:]+)', '((?:[^']|'')*)'\)/g)].filter(m => m[1]).map(m => [m[1], m[2].replace(/''/g, "'")]))
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
  // definițiile efective (coloane / constrângeri / indexuri / vedere) de pe baza cu migrarea aplicată = blocul DEFINITII al revenirii,
  // citite cu EXPRESIA din revenire (DEF-ACTUAL), nu cu una copiată
  const defs = await definitii(db)
  const dinRev = definitiiRevenire(REV)
  if (process.argv.includes('--scrie-definitii')) {
    const t = readFileSync(join(ROOT, 'supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql'), 'utf8')
    const nl = t.includes('\r\n') ? '\r\n' : '\n'
    const i = t.indexOf('-- DEFINITII-START'), j = t.indexOf('        -- DEFINITII-END')
    writeFileSync(join(ROOT, 'supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql'),
      t.slice(0, t.indexOf('\n', i) + 1) + CHEI_DEF.map(c => `        (${lit(c)}, ${lit(defs[c])}),`).join(nl) + nl + t.slice(j))
    console.log('     blocul DEFINITII al revenirii rescris (rulează din nou proba fără --scrie-definitii)')
  }
  const difDef = CHEI_DEF.filter(c => defs[c] == null || dinRev[c] !== defs[c])
  ok(Object.keys(dinRev).length === 7 && difDef.length === 0, `blocul DEFINITII al revenirii = definițiile reale (${CHEI_DEF.length} obiecte)${difDef.length ? ': diferă ' + difDef.join(', ') : ''}`)
  ok(/executie_semnale_constatare_ck CHECK \(\(.*dovada_sursa IS DISTINCT FROM 'camp_erp'::text.*dovada_ref IS NOT NULL/.test(defs['constrangeri:executie_semnale'] || '')
    && /executie_semnale_proiect_stare_idx ON public\.executie_semnale USING btree \(proiect_id, stare, gravitate\)/.test(defs['indexuri:executie_semnale'] || '')
    && /^stare:text:nn:'nou'::text:/m.test((defs['coloane:executie_semnale'] || '').split(',').join('\n'))
    && /e\.nume AS proiect_nume FROM \(executie_semnale s JOIN executie_proiecte e ON \(\(e\.id = s\.proiect_id\)\)\)/.test(defs['vedere:v_executie_semnale'] || ''),
    'definițiile reale conțin textul constrângerilor, al indexurilor, implicitul coloanelor și textul vederii (nu doar nume)')
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
    ['coloană adăugată pe tabel', `ALTER TABLE public.executie_semnale ADD COLUMN zz int`, `ALTER TABLE public.executie_semnale DROP COLUMN zz`, /definitii: coloane:executie_semnale\)/],
    ['un CHECK în plus pe tabelul gol', `ALTER TABLE public.executie_semnale ADD CONSTRAINT zz_ck CHECK (versiune < 100000)`, `ALTER TABLE public.executie_semnale DROP CONSTRAINT zz_ck`, /definitii: constrangeri:executie_semnale\)/],
    ['un index în plus', `CREATE INDEX zz_idx ON public.executie_semnale_jurnal (motiv)`, `DROP INDEX public.zz_idx`, /definitii: indexuri:executie_semnale_jurnal\)/],
    // ACELAȘI NUME, altă definiție (numele singure nu le-ar prinde)
    ['un CHECK înlocuit sub același nume', `ALTER TABLE public.executie_semnale DROP CONSTRAINT executie_semnale_flux_ck; ALTER TABLE public.executie_semnale ADD CONSTRAINT executie_semnale_flux_ck CHECK (flux IS NOT NULL)`,
      `ALTER TABLE public.executie_semnale DROP CONSTRAINT executie_semnale_flux_ck; ALTER TABLE public.executie_semnale ADD CONSTRAINT executie_semnale_flux_ck CHECK (flux IN ('lipsuri', 'tichete', 'corespondenta'))`, /definitii: constrangeri:executie_semnale\)/],
    ['un CHECK NOT VALID sub același nume', `ALTER TABLE public.executie_semnale_jurnal DROP CONSTRAINT executie_semnale_jurnal_valori_ck; ALTER TABLE public.executie_semnale_jurnal ADD CONSTRAINT executie_semnale_jurnal_valori_ck CHECK (jsonb_typeof(valori) = 'object') NOT VALID`,
      `ALTER TABLE public.executie_semnale_jurnal VALIDATE CONSTRAINT executie_semnale_jurnal_valori_ck`, /definitii: constrangeri:executie_semnale_jurnal\)/],
    ['un index recreat sub același nume, pe alte coloane', `DROP INDEX public.executie_semnale_proiect_stare_idx; CREATE INDEX executie_semnale_proiect_stare_idx ON public.executie_semnale (proiect_id)`,
      `DROP INDEX public.executie_semnale_proiect_stare_idx; CREATE INDEX executie_semnale_proiect_stare_idx ON public.executie_semnale (proiect_id, stare, gravitate)`, /definitii: indexuri:executie_semnale\)/],
    ['indexul parțial fără condiția lui', `DROP INDEX public.executie_semnale_responsabil_idx; CREATE INDEX executie_semnale_responsabil_idx ON public.executie_semnale (responsabil_employee_id)`,
      `DROP INDEX public.executie_semnale_responsabil_idx; CREATE INDEX executie_semnale_responsabil_idx ON public.executie_semnale (responsabil_employee_id) WHERE responsabil_employee_id IS NOT NULL`, /definitii: indexuri:executie_semnale\)/],
    ['implicitul unei coloane schimbat', `ALTER TABLE public.executie_semnale ALTER COLUMN stare SET DEFAULT 'in_lucru'`, `ALTER TABLE public.executie_semnale ALTER COLUMN stare SET DEFAULT 'nou'`, /definitii: coloane:executie_semnale\)/],
    ['NOT NULL scos de pe o coloană', `ALTER TABLE public.executie_semnale_jurnal ALTER COLUMN actor DROP NOT NULL`, `ALTER TABLE public.executie_semnale_jurnal ALTER COLUMN actor SET NOT NULL`, /definitii: coloane:executie_semnale_jurnal\)/],
    ['tipul unei coloane schimbat', `ALTER TABLE public.executie_semnale_jurnal ALTER COLUMN motiv TYPE varchar(4000)`, `ALTER TABLE public.executie_semnale_jurnal ALTER COLUMN motiv TYPE text`, /definitii: coloane:executie_semnale_jurnal\)/],
    ['drept pe secvență', `GRANT USAGE ON SEQUENCE public.executie_semnale_jurnal_id_seq TO authenticated`, `REVOKE USAGE ON SEQUENCE public.executie_semnale_jurnal_id_seq FROM authenticated`, /drepturi ACL: executie_semnale_jurnal_id_seq\/authenticated\/USAGE/],
    ['un rol suplimentar cu drept pe tabel', `CREATE ROLE zz_rol NOLOGIN; GRANT SELECT ON public.executie_semnale TO zz_rol`, `REVOKE SELECT ON public.executie_semnale FROM zz_rol; DROP ROLE zz_rol`, /drepturi ACL: executie_semnale\/zz_rol\/SELECT/],
    ['SELECT cu GRANT OPTION', `GRANT SELECT ON public.executie_semnale TO service_role WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR SELECT ON public.executie_semnale FROM service_role`, /drepturi ACL: executie_semnale\/service_role\/SELECT/],
    ['vederea fără security_invoker', `ALTER VIEW public.v_executie_semnale SET (security_invoker = off)`, `ALTER VIEW public.v_executie_semnale SET (security_invoker = on)`, /tabele \/ vedere/],
    // ultima (fără revenire la forma veche: o coloană a vederii nu se poate scoate cu CREATE OR REPLACE)
    ['vederea rescrisă sub același nume (coloană în plus)', `CREATE OR REPLACE VIEW public.v_executie_semnale WITH (security_invoker = on) AS
       SELECT s.*, e.cod_intern AS proiect_cod, e.nume AS proiect_nume, e.activ AS proiect_activ FROM public.executie_semnale s JOIN public.executie_proiecte e ON e.id = s.proiect_id`, null, /definitii: vedere:v_executie_semnale\)/],
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
// corpul EXACT al funcției de spațiu alb (mutanții M46 / M47 / M51–M53 îl rescriu; dacă textul nu mai există, mutantul pică la „nu găsește textul”):
// nullif(btrim(regexp_replace(regexp_replace(p_text, ZW, '', 'g'), CLASA, ' ', 'g'), ' '), '') — ZW = clasa caracterelor fără lățime (eliminate),
// CLASA = [[:space:]] + spațiile Unicode (un spațiu)
const SPATII_CORP = (() => { const i = MIG.indexOf('CREATE FUNCTION public.fn_executie_semnal_spatii('); const j = MIG.indexOf('\n  SELECT ', i) + 1; return MIG.slice(j, MIG.indexOf('\n', j)) })()
const CLASA_RE = /'\[\[:space:\]' \|\| \(SELECT string_agg\(chr\(c\), ''\) FROM unnest\(ARRAY\[[0-9, ]+\]\) c\) \|\| '\]\+'/
const ZW_RE = /'\[' \|\| \(SELECT string_agg\(chr\(c\), ''\) FROM unnest\(ARRAY\[[0-9, ]+\]\) c\) \|\| '\]'/
const ZW_PAS_RE = /regexp_replace\(p_text, '\[' \|\| \(SELECT string_agg\(chr\(c\), ''\) FROM unnest\(ARRAY\[[0-9, ]+\]\) c\) \|\| '\]', '', 'g'\)/
if (!/^  SELECT nullif\(btrim\(regexp_replace\(regexp_replace\(p_text, .*, '', 'g'\), .*, ' ', 'g'\), ' '\), ''\)$/.test(SPATII_CORP) || !CLASA_RE.test(SPATII_CORP) || !ZW_PAS_RE.test(SPATII_CORP)
    || !SPATII_CORP.includes(", '', 'g'), '[[:space:]'") || !SPATII_CORP.endsWith(", ' ', 'g'), ' '), '')")) { ok(false, 'corpul fn_executie_semnal_spatii nu are forma așteptată de mutanți: ' + SPATII_CORP) }
const ZW_CLASA = (SPATII_CORP.match(ZW_RE) || [''])[0], SP_CLASA = (SPATII_CORP.match(CLASA_RE) || [''])[0]
// postcondiția migrării pe definiția CHECK-ului cheii (textul EXACT; M55–M57 o scot, ca testele de comportament să fie cele care prind mutantul)
const POST_OBIECT = "\n     -- cheia obiect e păzită de forma canonică (aceeași funcție ca RPC-ul și amprenta), validată\n     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = v_s AND contype = 'c' AND conname = 'executie_semnale_obiect_ck' AND convalidated\n        AND pg_get_constraintdef(oid) LIKE '%(NOT (obiect IS DISTINCT FROM %fn_executie_semnal_spatii(obiect)))%') <> 1 THEN"
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
  // runda 2 (verdictul Jakarinos): confirmarea responsabilului, amprenta canonică, contractul dovezii
  ['M32 confirmarea aceluiași responsabil nu devine a omului (RPC)', [["         responsabil_sursa = CASE WHEN p_schimba_responsabil IS TRUE THEN 'om' ELSE s.responsabil_sursa END", '         responsabil_sursa = CASE WHEN p_schimba_responsabil IS TRUE THEN s.responsabil_sursa ELSE s.responsabil_sursa END']]],
  ['M33 garda omului pune „om” doar la alt angajat (fără confirmare / „fără responsabil”)', [["  IF NEW.responsabil_employee_id IS DISTINCT FROM OLD.responsabil_employee_id OR NEW.responsabil_sursa IS DISTINCT FROM OLD.responsabil_sursa THEN\n    NEW.responsabil_sursa := 'om';",
    "  IF NEW.responsabil_employee_id IS DISTINCT FROM OLD.responsabil_employee_id THEN\n    NEW.responsabil_sursa := CASE WHEN NEW.responsabil_employee_id IS NULL THEN NULL ELSE 'om' END;"]]],
  ['M34 confirmarea aceluiași responsabil = „nimic de schimbat”', [["     AND NOT (p_schimba_responsabil IS TRUE AND (p_responsabil IS DISTINCT FROM r.responsabil_employee_id OR r.responsabil_sursa IS DISTINCT FROM 'om')) THEN", '     AND NOT (p_schimba_responsabil IS TRUE AND p_responsabil IS DISTINCT FROM r.responsabil_employee_id) THEN']]],
  ['M35 agentul poate schimba responsabilul omului (garda)', [["      IF OLD.responsabil_sursa IS NOT DISTINCT FROM 'om' THEN\n        RAISE EXCEPTION 'semnale: responsabilul stabilit de om nu se schimbă de agent' USING ERRCODE = '42501';\n      END IF;\n", '']]],
  ['M36 amprenta cu sursele necanonice (textul brut, în ordinea dată)', [["                                'surse', coalesce((SELECT jsonb_agg(DISTINCT c ORDER BY c) FROM unnest(coalesce(p_surse, '{}'::text[])) s, public.fn_executie_semnal_canonic(s) c WHERE c IS NOT NULL), '[]'::jsonb),",
    "                                'surse', to_jsonb(coalesce(p_surse, '{}'::text[])),"]]],
  ['M37 sursele stocate în ordinea dată (nu canonică)', [['    SELECT coalesce(array_agg(x.s ORDER BY x.c, x.ord), \'{}\'::text[]) INTO v_surse', '    SELECT coalesce(array_agg(x.s ORDER BY x.ord), \'{}\'::text[]) INTO v_surse']]],
  ['M38 forma canonică fără litere mici', [['  SELECT lower(public.fn_executie_semnal_spatii(p_text))', '  SELECT public.fn_executie_semnal_spatii(p_text)']]],
  ['M39 fragmentul intră brut în amprentă', [["                                'fragment', public.fn_executie_semnal_spatii(p_fragment),", "                                'fragment', p_fragment,"]]],
  ['M40 camp_lipsa fără sursă trece prin UNKNOWN (CHECK cu =)', [["    AND (constatare IS DISTINCT FROM 'camp_lipsa' OR (dovada_sursa IS NOT DISTINCT FROM 'camp_erp' AND dovada_ref IS NOT NULL))),", "    AND (constatare IS DISTINCT FROM 'camp_lipsa' OR (dovada_sursa = 'camp_erp' AND dovada_ref IS NOT NULL))),"]]],
  ['M41 constatat doar cu calea (fără dată / fragment)', [["    AND (constatare IS DISTINCT FROM 'constatat' OR (dovada_sursa IS NOT NULL AND dovada_data IS NOT NULL AND dovada_fragment IS NOT NULL))", "    AND (constatare IS DISTINCT FROM 'constatat' OR (dovada_sursa IS NOT NULL AND (dovada_fragment IS NOT NULL OR dovada_ref IS NOT NULL)))"]]],
  ['M42 negăsit fără obligația care cere documentul', [["         OR (cardinality(surse_consultate) >= 1 AND dovada_sursa IS NOT NULL AND dovada_data IS NOT NULL AND dovada_fragment IS NOT NULL))", '         OR cardinality(surse_consultate) >= 1)']]],
  ['M43 termen confirmat fără baza calculului', [['         AND (termen_confirmat IS NOT TRUE OR termen_baza IS NOT NULL)))', '))']]],
  ['M44 rezolvarea doar cu motiv (RPC)', [["  IF v_stare = 'rezolvat' AND v_dovada IS NULL AND v_ref IS NULL THEN\n    RAISE EXCEPTION 'semnale: rezolvarea cere dovada rezolvării sau acțiunea rezultată' USING ERRCODE = '22023';\n  END IF;\n", '']]],
  ['M45 rezolvarea doar cu motiv (CHECK, calea directă)', [["\n             AND (stare IS DISTINCT FROM 'rezolvat' OR stare_dovada IS NOT NULL OR actiune_ref IS NOT NULL)))),", '))),']]],
  // runda 3 (verdictul Jakarinos r2, P2): spațiul alb din amprentă
  ['M46 ordinea veche: btrim ÎNAINTE de strângerea spațiului alb (un \\n de la capete rămâne spațiu)', [[SPATII_CORP,
    SPATII_CORP.replace('nullif(btrim(regexp_replace(regexp_replace(p_text, ', 'nullif(regexp_replace(btrim(regexp_replace(p_text, ')
      .replace(", '', 'g'), '[[:space:]'", ", '', 'g')), '[[:space:]'").replace(", ' ', 'g'), ' '), '')", ", ' ', 'g'), '')")]]],
  ['M47 clasa de spațiu alb fără spațiile Unicode (doar [[:space:]]: NBSP rămâne)', [[SPATII_CORP, SPATII_CORP.replace(CLASA_RE, "'[[:space:]]+'")]]],
  ['M48 referința intră în amprentă doar cu btrim (ca înainte)', [["                                'ref', public.fn_executie_semnal_spatii(p_ref))::text)", "                                'ref', nullif(btrim(coalesce(p_ref, '')), ''))::text)"]]],
  // starea EXACTĂ din 83b9258c (reprodusă de review): fragmentul stocat / trimis la amprentă doar cu btrim, iar amprenta îl strânge DUPĂ btrim →
  // un \n de la capete rămâne spațiu → respinsul se redeschide (reproducerea r2 trebuie să pice DIRECT pe acest mutant)
  ['M50 forma din r2: btrim la stocare + btrim înaintea strângerii în amprentă (fragmentul)', [
    ["                                'fragment', public.fn_executie_semnal_spatii(p_fragment),", "                                'fragment', nullif(regexp_replace(btrim(coalesce(p_fragment, '')), '[[:space:]]+', ' ', 'g'), ''),"],
    ["                                               public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_fragment'), public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'));", "                                               nullif(btrim(p_semnal ->> 'dovada_fragment'), ''), public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'));"],
    ["            p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data, public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_fragment'),", "            p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data, nullif(btrim(p_semnal ->> 'dovada_fragment'), ''),"],
    ["         dovada_fragment = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_fragment'), dovada_ref = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'),", "         dovada_fragment = nullif(btrim(p_semnal ->> 'dovada_fragment'), ''), dovada_ref = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'),"]]],
  ['M49 RPC-ul stochează fragmentul doar cu btrim (semnal deschis: „actualizat” fals, text nenormalizat)', [
    ["            p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data, public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_fragment'),", "            p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data, nullif(btrim(p_semnal ->> 'dovada_fragment'), ''),"],
    ["         dovada_fragment = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_fragment'), dovada_ref = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'),", "         dovada_fragment = nullif(btrim(p_semnal ->> 'dovada_fragment'), ''), dovada_ref = public.fn_executie_semnal_spatii(p_semnal ->> 'dovada_ref'),"]]],
  // runda 4 (verdictul Jakarinos r3, P2): cheia de deduplicare `obiect` și caracterele fără lățime
  ['M51 caracterele fără lățime NU se elimină (pasul lipsă: U+200B rămâne în cheie / amprentă)', [[SPATII_CORP, SPATII_CORP.replace(ZW_PAS_RE, 'p_text')]]],
  ['M52 caracterele fără lățime tratate ca SPAȚIU (forma din 96bbd496: U+200B / BOM în clasa de spațiu alb)', [[SPATII_CORP,
    SPATII_CORP.replace(ZW_PAS_RE, 'p_text').replace('ARRAY[133, 160, ', 'ARRAY[133, 160, 8203, 65279, ')]]],
  ['M53 ordinea inversă: strângerea ÎNAINTEA eliminării caracterelor fără lățime („a <U+200B> b” rămâne cu două spații)', [[SPATII_CORP,
    `  SELECT nullif(btrim(regexp_replace(regexp_replace(p_text, ${SP_CLASA}, ' ', 'g'), ${ZW_CLASA}, '', 'g'), ' '), '')`]]],
  ['M54 RPC-ul normalizează obiectul doar cu btrim (CHECK-ul rămâne: scrierea e refuzată, nu dedublată)', [[
    "v_obiect := public.fn_executie_semnal_spatii(p_semnal ->> 'obiect');", "v_obiect := btrim(p_semnal ->> 'obiect');"]]],
  // (M55–M57 scot ȘI postcondiția migrării pe definiția CHECK-ului — altfel migrarea s-ar refuza singură la aplicare și testele de comportament
  //  n-ar mai ajunge să-i prindă; M59 arată că postcondiția singură îi prinde la aplicare)
  ['M55 CHECK-ul fără forma canonică a obiectului (RPC-ul rămâne: calea directă poate scrie o cheie necanonică)', [
    ["    AND obiect IS NOT DISTINCT FROM public.fn_executie_semnal_spatii(obiect)),", "    AND obiect ~ '[^[:space:]]'),"], [POST_OBIECT, ' THEN']]],
  ['M56 forma EXACTĂ din 96bbd496: obiect doar cu btrim în RPC + CHECK fără forma canonică (reproducerea Jak r3 pică direct: id nou)', [
    ["v_obiect := public.fn_executie_semnal_spatii(p_semnal ->> 'obiect');", "v_obiect := btrim(p_semnal ->> 'obiect');"],
    ["    AND obiect IS NOT DISTINCT FROM public.fn_executie_semnal_spatii(obiect)),", "    AND obiect ~ '[^[:space:]]'),"], [POST_OBIECT, ' THEN']]],
  ['M57 CHECK-ul cu „=” în loc de IS NOT DISTINCT FROM (obiect doar din NBSP trece prin UNKNOWN pe calea directă)', [
    ["    AND obiect IS NOT DISTINCT FROM public.fn_executie_semnal_spatii(obiect)),", "    AND obiect = public.fn_executie_semnal_spatii(obiect)),"], [POST_OBIECT, ' THEN']]],
  ['M59 CHECK-ul fără forma canonică, cu postcondiția migrării lăsată: migrarea se refuză singură la aplicare', [
    ["    AND obiect IS NOT DISTINCT FROM public.fn_executie_semnal_spatii(obiect)),", "    AND obiect ~ '[^[:space:]]'),"]],
    null, { detector: async (db, text) => { try { await aplicaMig(db, text); return null } catch (e) { return /post: cheile .*forma canonica/.test(e.message) ? 'aplicare: ' + e.message.slice(0, 100) : null } } }],
  ['M58 RPC-ul fără refuzul explicit al obiectului doar din spațiu alb (ar pica pe NOT NULL, 23502, nu 22023)', [[
    "  IF v_obiect IS NULL THEN\n    RAISE EXCEPTION 'semnale: obiect = text (1–200 de caractere, nu doar spațiu alb / caractere fără lățime)' USING ERRCODE = '22023';\n  END IF;\n", '']]],
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
    else {
      const ab = await verifica(db)
      // prima abatere + reproducerile Jakarinos, dacă pică și ele: r2 = creare → respins → retrimitere cu spațiu alb în dovadă = redeschis;
      // r3 = creare → respins → retrimitere cu spațiu alb / caractere fără lățime în cheia `obiect` = alt rând
      const repro2 = ab.find(x => x.startsWith('E (respins)')), repro3 = ab.find(x => x.startsWith('E (Jak r3'))
      if (ab.length) picat = `verificări (${ab.length} abateri): ${ab[0]}` + (repro2 && repro2 !== ab[0] ? ` | repro Jak r2: ${repro2}` : '') + (repro3 && repro3 !== ab[0] ? ` | repro Jak r3: ${repro3}` : '')
    }
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
  ok(m === null && okuri.length === 7, `dry-run-ul: ${okuri.length} pași OK (D0–D6) (${okuri.map(x => x.slice(0, 2)).join(', ')})${m ? '; eroare: ' + m.slice(0, 200) : ''}`)
  if (m) note.slice(-8).forEach(x => console.log('     ' + x))
  const ramase = (await db.query(`SELECT count(*)::int AS n FROM public.executie_semnale`)).rows[0].n
  ok(ramase === 0, 'dry-run-ul nu lasă nimic în urmă (ROLLBACK)')
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
