// Proba LOCALĂ a migrării 20261131h (Redări e-mail F2b: trimiterea — gărzile BD, state-ul OAuth, Vault-ul prin RPC, categoria proiectului) pe PGlite
// (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261131h_redari_mail_f2b_schelet.sql + funcțiile extrase EXACT din migrările lor (20261126a, 27a, 30k, 30m,
//   31a — inclusiv RPC-urile REALE de trimitere fn_red_mail_rezerva / apel_incepe / rezultat și triggerul de imuabilitate fn_red_mail_f2_garda);
//   amprentele celor verificate de gărzi = constantele din 20261131h (verificat la pasul 0).
// Aplicarea: ca runnerul — marcaj + plafon 5000 (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: întâi generarea
//   manifestului (GLOBAL aprobat „-”, ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și garda
//   finală REALĂ a runnerului (lm_fin) + COMMIT. Lista obiectelor = supabase/tests/20261131h_redari_mail_f2b_trimitere.l15.obiecte.tsv (--scrie-obiecte o rescrie).
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul real al fiecărei căi (owner / admin / editor cu JWT, service_role, postgres):
//    state-ul OAuth, Vault prin RPC, pornirea doar cu căsuța conectată, extern refuzat, fn_red_mail_f2_poate (doar proiecte TEST-, inclusiv „test-mic”),
//    TRIMITEREA prin RPC-urile reale (rezervă → apel_incepe → rezultat, CAS pe lease, idempotență), CATEGORIA proiectului (runda 2, Jakarinos #1134 P1):
//    redenumirea TEST- ↔ real refuzată cât lotul e în lucru (rezervat / în apel / neîncheiat) sau cât există AWB-uri FAN în lucru, doar de owner în
//    contextul aplicației, permisă în aceeași categorie și după încheiere; revocarea.
// 2. L14: pe o bază FOLOSITĂ revenirea refuză la fiecare pas (pornită / conectată / ISTORIC_NOU) și nu șterge nimic; pe o bază NEFOLOSITĂ: aplicare →
//    revenire → reaplicare → revenire. 3. Refuzurile migrării și ale revenirii. 4. MUTANȚI (migrare + revenire): fiecare TREBUIE să pice.
// Ce NU probează PGlite (o singură conexiune): CONCURENȚA reală — lock-ul FOR SHARE al proiectului din rezerva / apel_incepe față de UPDATE-ul
//   redenumirii; aici se verifică doar static (prosrc) și prin trigger; proba cu DOUĂ sesiuni psql pe PostgreSQL real:
//   supabase/tests/20261131h_redari_mail_f2b_concurenta.sh. Vault-ul real (criptarea), Google: pe clonă, coordonatorul.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_mail_f2b_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'mailf2b_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20261131h_redari_mail_f2b_trimitere'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`, F_OB = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste('supabase/tests/20261131h_redari_mail_f2b_schelet.sql')
const MIG = citeste(F_MIG), REV = citeste(F_REV)
let OBIECTE = ''; try { OBIECTE = citeste(F_OB) } catch { /* se scrie cu --scrie-obiecte */ }
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const SECRET = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN'

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── funcțiile, EXACT ca în migrările lor ──
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = text.indexOf(';', text.indexOf(a[1], startCorp) + a[1].length) + 1
  return text.slice(i, sfarsit).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
}
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}
const M = n => citeste('supabase/migrations/' + n)
const M26 = M('20261126a_redari_teren.sql'), M27 = M('20261127a_redari_uat_setari.sql'), M30K = M('20261130k_redari_mail_f1_reguli.sql')
const M30M = M('20261130m_redari_autorizare_tgz.sql'), M31A = M('20261131a_redari_mail_f2_loturi.sql')
// [text, cap, amprenta așteptată (= constanta din 20261131h / revenire, când garda o verifică)]
const FUNCTII = [
  [M26, 'CREATE FUNCTION public.fn_red_nivel()'], [M26, 'CREATE FUNCTION public.fn_red_jurnal_imuabil()'],
  [M27, 'CREATE FUNCTION public.fn_red_versiune_creste()'], [M30M, 'CREATE FUNCTION public.fn_red_informare_publicata('],
  [M30K, 'CREATE FUNCTION public.fn_red_mail_setari_reguli()'], [M30K, 'CREATE FUNCTION public.fn_red_mail_oauth_state_reguli()'],
  [M30K, 'CREATE FUNCTION public.fn_red_mail_evenimente_reguli()'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_canonic('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_hash('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_email('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_text('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_mesaj_hash('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_lot_hash(', '405820f220f0bd56b901f22b3ef35155'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_owner()', '220cfdf1f3e97fde8cd597a5b24537ed'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_audit(', '22f7267f17b19a625fc849ae217fc160'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_poate(', 'd239c6cc7bcb13691d798f99d4f1aa58'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_setari(', '88b2a3f13a95d346b1fec56736aa89e3'],
  // RPC-urile reale de trimitere + triggerul de imuabilitate (31a); rezerva / apel_incepe sunt verificate / înlocuite de 31h
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_retentie_poate('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_garda()'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_rezerva(', 'a5bf83c98b41d8665cce7e536eea4343'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_apel_incepe(', 'b3834ab1c09d2671c0778621f3271255'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_rezultat('],
]
const INLOCUITE = /fn_red_mail_(f2_poate|f2_setari|rezerva|apel_incepe)\(/
console.log('0. funcțiile extrase din migrările lor (amprentele 20261131a = constantele din 20261131h / revenire)')
let SQL_FUNCTII = ''
for (const [text, cap, amp] of FUNCTII) {
  if (amp) { const m = md5(corp(text, cap)); ok(m === amp && MIG.includes(`'${amp}'`) && (REV.includes(`'${amp}'`) || !INLOCUITE.test(cap)), `${cap.replace(/^CREATE FUNCTION /, '')}: ${m}`) }
  SQL_FUNCTII += functie(text, cap) + '\n'
}
const [SCH_A, SCH_B] = SCHELET.split('-- @@FUNCTII@@')
ok(SCH_B !== undefined, 'scheletul are marcajul funcțiilor')
ok(md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(')) === 'd239c6cc7bcb13691d798f99d4f1aa58'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_setari(')) === '88b2a3f13a95d346b1fec56736aa89e3'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(')) === 'a5bf83c98b41d8665cce7e536eea4343'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(')) === 'b3834ab1c09d2671c0778621f3271255', 'revenirea repune corpurile EXACTE din 20261131a (poate, setari, rezerva, apel_incepe)')
const CAP_NOI = [['public.fn_red_mail_f2_poate(public.red_mail_loturi)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate('],
  ['public.fn_red_mail_f2_setari(boolean,boolean,integer)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_setari('],
  ['public.fn_red_mail_rezerva(uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva('],
  ['public.fn_red_mail_apel_incepe(uuid,uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe('],
  ['public.fn_red_proiect_e_test(text)', 'CREATE FUNCTION public.fn_red_proiect_e_test('],
  ['public.fn_red_proiect_cod_test_garda()', 'CREATE FUNCTION public.fn_red_proiect_cod_test_garda('],
  ['public.fn_red_mail_oauth_start(text,text)', 'CREATE FUNCTION public.fn_red_mail_oauth_start('],
  ['public.fn_red_mail_oauth_consuma(text)', 'CREATE FUNCTION public.fn_red_mail_oauth_consuma('],
  ['public.fn_red_mail_oauth_eveniment(text,text)', 'CREATE FUNCTION public.fn_red_mail_oauth_eveniment('],
  ['public.fn_red_mail_secret_seteaza(text,text,uuid,text)', 'CREATE FUNCTION public.fn_red_mail_secret_seteaza('],
  ['public.fn_red_mail_secret_citeste(text,uuid,text)', 'CREATE FUNCTION public.fn_red_mail_secret_citeste(']]
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261131h'), t.indexOf('-- <<< AMPRENTE-NOI 20261131h'))
for (const [sem, cap] of CAP_NOI) {
  const m = md5(corp(MIG, cap))
  ok(blocNoi(MIG).includes(`('${sem}', '${m}'`) && blocNoi(REV).includes(`('${sem}', '${m}'`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
ok(!/AMPRENTA_[A-Z_]+/.test(blocNoi(MIG)) && !/AMPRENTA_[A-Z_]+/.test(blocNoi(REV)), 'fără marcaje AMPRENTA_* rămase')
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261131h'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261131h')
  const bloc = CAP_NOI.reduce((x, [sem, cap]) => x.replace(new RegExp(`(\\('${sem.replace(/[().,\[\]]/g, '\\$&')}', ')[0-9a-f]{32}`), `$1${md5(corp(t, cap))}`), t.slice(a, b))
  return t.slice(0, a) + bloc + t.slice(b)
}

// ── 0b. validatorul REAL al runnerului ──
const validator = (fisier, ...opt) => {
  try { return { ok: true, out: execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } }
  catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
console.log('0b. validatorul runnerului')
{
  ok(PLAFON_LIVRARE === 5000, `AG_PLAFON_MS = ${PLAFON_LIVRARE}`)
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE)); ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000'); ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon'); ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE)); ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE)); ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

// ── conturile și datele (fictive) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000000a1', OWNER2: '00000000-0000-0000-0000-0000000000a6', ADMIN: '00000000-0000-0000-0000-0000000000a2', EDITOR: '00000000-0000-0000-0000-0000000000a3', FARA: '00000000-0000-0000-0000-0000000000a5' }
const P = { TEST: '00000000-0000-0000-0000-00000000b001', REAL: '00000000-0000-0000-0000-00000000b002', MIC: '00000000-0000-0000-0000-00000000b003', FAN: '00000000-0000-0000-0000-00000000b004' }
const OB = { TEST: '00000000-0000-0000-0000-0000000f0001', REAL: '00000000-0000-0000-0000-0000000f0002' }
const UAT = '00000000-0000-0000-0000-00000000c001'
const LOT = { TEST: '00000000-0000-0000-0000-0000000a0001', REAL: '00000000-0000-0000-0000-0000000a0002', MIC: '00000000-0000-0000-0000-0000000a0003' }
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.OWNER2}', 'OWNER DOI', true), ('${U.ADMIN}', 'ADMIN REDARI', false), ('${U.EDITOR}', 'EDITOR', false), ('${U.FARA}', 'FARA', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ADMIN}', 'redari', 'admin'), ('${U.EDITOR}', 'redari', 'editor'), ('${U.FARA}', 'hr', 'admin');
INSERT INTO storage.objects (id, bucket_id, name, metadata) VALUES ('${OB.TEST}', 'redari', 'TEST-MAIL/autorizare.pdf', '{"eTag": "\\"t1\\""}'), ('${OB.REAL}', 'redari', 'LOT1-REAL/autorizare.pdf', '{"eTag": "\\"r1\\""}');
INSERT INTO public.red_proiecte (id, cod, denumire, autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_obiect, autorizare_tgz_etag) VALUES
  ('${P.TEST}', 'TEST-MAIL', 'Proiect de TEST', '1', current_date, 'TEST-MAIL/autorizare.pdf', '${OB.TEST}', '"t1"'),
  ('${P.REAL}', 'LOT1-REAL', 'Proiect real (fictiv)', '2', current_date, 'LOT1-REAL/autorizare.pdf', '${OB.REAL}', '"r1"');
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('${P.MIC}', 'test-mic', 'cod cu minuscule = proiect real'), ('${P.FAN}', 'LOT2-FAN', 'Proiect real cu AWB-uri FAN (fictiv)');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3) VALUES ('${UAT}', '${P.TEST}', 'Testeni', 'TST');`
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCH_A); await db.exec(SQL_FUNCTII); await db.exec(SCH_B); await db.exec(DATE)
  return db
}
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
const lit = s => `'${String(s).replace(/'/g, "''")}'`
// o instrucțiune ca rolul dat, cu JWT-ul contului (COMMIT la succes, ca un apel PostgREST)
async function ca(db, rol, uid, sql) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);${uid ? ` SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
// ca postgres (mentenanță, fără JWT): { rows } sau { code, message }
const caPostgres = async (db, sql) => { try { const r = await db.query(sql); return { rows: r.rows } } catch (e) { return { code: e.code, message: e.message } } }
const setari = async db => (await db.query(`SELECT trimitere_oprita, extern_permis, doar_proiecte_test, trimitere_conectata_la, trimitere_conectata_de, trimitere_casuta, versiune FROM public.red_mail_setari WHERE id = 1`)).rows[0]
const versiune = async db => (await db.query(`SELECT versiune FROM public.red_mail_setari WHERE id = 1`)).rows[0].versiune
// funcțiile NOI ale migrării (fără funcțiile F1 cu prefix asemănător, ex. fn_red_mail_oauth_state_reguli)
const NOI = `('fn_red_mail_oauth_start', 'fn_red_mail_oauth_consuma', 'fn_red_mail_oauth_eveniment', 'fn_red_mail_secret_seteaza', 'fn_red_mail_secret_citeste', 'fn_red_proiect_e_test', 'fn_red_proiect_cod_test_garda')`
const NR_NOI = 7
const nrNoi = async db => (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ${NOI}`)).rows[0].n
const areTrigger = async db => (await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND tgname = 'trg_red_proiect_cod_test'`)).rows[0].n === 1
const amprentaFn = async (db, nume) => (await db.query(`SELECT md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`, [nume])).rows[0]?.m ?? null
const vault = async db => (await db.query(`SELECT secret FROM vault.secrets WHERE name = $1`, [SECRET])).rows[0]?.secret ?? null
const evenimente = async (db, tip) => (await db.query(`SELECT cod, autor, casuta FROM public.red_mail_evenimente WHERE tip = $1 ORDER BY id`, [tip])).rows
const nrEvenimente = async db => (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_evenimente`)).rows[0].n
const seteaza = (db, valoare, apelant, casuta) => ca(db, 'service_role', null, `SELECT public.fn_red_mail_secret_seteaza(${lit(SECRET)}, ${lit(valoare)}, ${apelant ? lit(apelant) + '::uuid' : 'NULL'}, ${casuta == null ? 'NULL' : lit(casuta)}) AS r`)
const citesteSecret = (db, apelant, motiv, nume = SECRET) => ca(db, 'service_role', null, `SELECT public.fn_red_mail_secret_citeste(${lit(nume)}, ${lit(apelant)}::uuid, ${lit(motiv)}) AS r`)
const f2setari = (db, uid, oprit, extern, versiune) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_f2_setari(${oprit}, ${extern}, ${versiune == null ? 'NULL' : versiune}) AS r`)
const poate = async (db, lot) => (await db.query(`SELECT public.fn_red_mail_f2_poate(l) AS r FROM public.red_mail_loturi l WHERE l.id = $1`, [lot])).rows[0].r
const rezerva = (db, uid, lot) => ca(db, 'authenticated', uid, `SELECT id, stare, lease_token FROM public.fn_red_mail_rezerva('${lot}')`)
const apelIncepe = (db, uid, mesaj, token) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_apel_incepe('${mesaj}', '${token}') AS r`)
const rezultat = (db, uid, mesaj, token, stare, gm, th) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_rezultat('${mesaj}', '${token}', ${lit(stare)}, ${gm == null ? 'NULL' : lit(gm)}, ${th == null ? 'NULL' : lit(th)}) AS r`)
const mesaj = async (db, id) => (await db.query(`SELECT stare, gmail_id, thread_id, eroare_cod FROM public.red_mail_mesaje WHERE id = $1`, [id])).rows[0]
const lotStare = async (db, id) => (await db.query(`SELECT stare FROM public.red_mail_loturi WHERE id = $1`, [id])).rows[0].stare
const codProiect = async (db, id) => (await db.query(`SELECT cod FROM public.red_proiecte WHERE id = $1`, [id])).rows[0].cod
// redenumirea: ca un cont (JWT, politica red_proiecte_upd) sau ca postgres (mentenanță)
async function redenumeste(db, cine, id, cod) {
  const sql = `UPDATE public.red_proiecte SET cod = ${lit(cod)} WHERE id = '${id}' RETURNING cod`
  const r = cine === 'postgres' ? await caPostgres(db, sql) : await ca(db, 'authenticated', cine, sql)
  if (!r.code && (!r.rows || r.rows.length !== 1)) return { code: 'ZERO', message: 'niciun rând (RLS)' }
  return r
}
// loturile: TEST (cu 2 mesaje, aprobat pe hash-ul real), REAL (aprobat, fără mesaje), MIC (pe „test-mic”, aprobat)
const SQL_LOTURI = [[LOT.TEST, P.TEST], [LOT.REAL, P.REAL], [LOT.MIC, P.MIC]].map(([id, pr]) =>
  `INSERT INTO public.red_mail_loturi (id, proiect_id, uat_id, cerere_sha256, stare, lot_sha256, creat_de) VALUES ('${id}', '${pr}', '${UAT}', repeat('a', 64), 'ciorna', repeat('b', 64), '${U.OWNER}');`).join('\n') + '\n'
  + [[1, '00000000-0000-0000-0000-0000000d0001'], [2, '00000000-0000-0000-0000-0000000d0002']].map(([k, det]) =>
  `INSERT INTO public.red_mail_mesaje (id, lot_id, detinator_id, nr_document, catre, subiect_final, corp_text_final, message_id, mesaj_sha256) VALUES ('00000000-0000-0000-0000-0000000e000${k}', '${LOT.TEST}', '${det}', 'M-00000${k}', 'coleg.fictiv${k}@gazpet.ro', 'Subiect fictiv', 'Text fictiv', '<00000000-0000-0000-0000-0000000e000${k}@gazpet.ro>', repeat('${k}', 64));`).join('\n') + '\n'
  + `UPDATE public.red_mail_loturi SET stare = 'aprobat', lot_sha256 = public.fn_red_mail_f2_lot_hash(id), aprobat_lot_sha256 = public.fn_red_mail_f2_lot_hash(id), aprobat_versiune = 1, aprobat_de = '${U.OWNER}', aprobat_la = now() WHERE id IN ('${LOT.TEST}', '${LOT.REAL}', '${LOT.MIC}');\n`
const loturi = db => db.exec(SQL_LOTURI)
// --scrie-fixture <fisier.sql>: toată baza falsă (schelet + funcțiile reale + datele + loturile) ca SQL, pentru proba cu două sesiuni pe PostgreSQL real
// (supabase/tests/20261131h_redari_mail_f2b_concurenta.sh); nu se comite, se generează la rulare
{
  const i = process.argv.indexOf('--scrie-fixture')
  if (i > 0 && process.argv[i + 1]) {
    writeFileSync(process.argv[i + 1], `-- Fixture generat de scripts/pglite/test_redari_mail_f2b_local.mjs --scrie-fixture (NU pentru producție; bază de unică folosință)\n${SCH_A}\n${SQL_FUNCTII}\n${SCH_B}\n${DATE}\n${SQL_LOTURI}`)
    console.log('fixture scris: ' + process.argv[i + 1])
  }
}

// ── VERIFICĂRILE după migrare; întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce, re) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod}${re ? ' ' + re : ''})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return undefined } return r.rows[0] && 'r' in r.rows[0] ? r.rows[0].r : r.rows }
  const s0 = await setari(db)
  // E1. pornirea înaintea conectării: refuzată de RPC (și de CHECK, F)
  asteptCod(await f2setari(db, U.OWNER, false, false, s0.versiune), 'P0001', 'E1 ON înaintea conectării', /casuta_neconectata/)
  // A. state-ul OAuth: owner → uuid; editor → 42501; scop străin / sha invalid → 22023
  const st1 = 'a'.repeat(64), st2 = 'b'.repeat(64), st3 = 'c'.repeat(64)
  const a1 = asteptOk(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_start('trimitere', '${st1}') AS r`), 'A start owner')
  if (a1 && !/^[0-9a-f-]{36}$/.test(a1)) ab.push('A start nu întoarce uuid: ' + a1)
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `SELECT public.fn_red_mail_oauth_start('trimitere', '${st2}') AS r`), '42501', 'A start editor')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_start('citire', '${st2}') AS r`), '22023', 'A start scop citire (F1, nu aici)', /scop_nepermis/)
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_start('trimitere', 'xyz') AS r`), '22023', 'A start sha invalid', /state_invalid/)
  asteptCod(await ca(db, 'anon', null, `SELECT public.fn_red_mail_oauth_start('trimitere', '${st2}') AS r`), '42501', 'A start anon')
  const rnd = (await db.query(`SELECT owner_id::text AS o, scop, consumat_la FROM public.red_mail_oauth_state WHERE state_sha256 = '${st1}'`)).rows[0]
  if (!rnd || rnd.o !== U.OWNER || rnd.scop !== 'trimitere' || rnd.consumat_la !== null) ab.push('A rândul de state: ' + JSON.stringify(rnd))
  // B. consumul: al altui owner → refuz (rândul rămâne neconsumat); owner → scopul; a doua oară → refuz; expirat → refuz
  asteptCod(await ca(db, 'authenticated', U.OWNER2, `SELECT public.fn_red_mail_oauth_consuma('${st1}') AS r`), '22023', 'B consum de alt owner', /state_invalid/)
  if ((await db.query(`SELECT consumat_la FROM public.red_mail_oauth_state WHERE state_sha256 = '${st1}'`)).rows[0].consumat_la !== null) ab.push('B state-ul a fost consumat de alt owner')
  const b1 = asteptOk(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_consuma('${st1}') AS r`), 'B consum owner')
  if (b1 !== 'trimitere') ab.push('B consumul nu întoarce scopul: ' + b1)
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_consuma('${st1}') AS r`), '22023', 'B al doilea consum', /state_invalid/)
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_consuma('${st2}') AS r`), '22023', 'B state inexistent', /state_invalid/)
  await db.exec(`INSERT INTO public.red_mail_oauth_state (state_sha256, scop, owner_id, expira_la) VALUES ('${st3}', 'trimitere', '${U.OWNER}', now() + interval '20 milliseconds'); SELECT pg_sleep(0.06);`)
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_consuma('${st3}') AS r`), '22023', 'B state expirat', /state_invalid/)
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_mail_oauth_state SET consumat_la = now() WHERE state_sha256 = '${st3}'`), '42501', 'B PATCH direct pe state (editor)')
  // I. evenimentele OAuth: owner, listă închisă
  asteptOk(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_eveniment('oauth_respins', 'casuta_gresita') AS r`), 'I eveniment owner')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_eveniment('oauth_conectat', 'trimitere') AS r`), '22023', 'I tip în afara listei', /eveniment_invalid/)
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_eveniment('oauth_respins', 'altceva') AS r`), '22023', 'I cod în afara listei', /eveniment_invalid/)
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `SELECT public.fn_red_mail_oauth_eveniment('oauth_respins', 'casuta_gresita') AS r`), '42501', 'I eveniment editor')
  const ev = await evenimente(db, 'oauth_respins')
  if (ev.length !== 1 || ev[0].cod !== 'casuta_gresita' || ev[0].autor !== U.OWNER || ev[0].casuta !== 'redari@gazpet.ro') ab.push('I evenimentul: ' + JSON.stringify(ev))
  // C. Vault prin RPC: doar service_role, p_apelant owner, doar numele din mapare, căsuța exactă
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_secret_seteaza(${lit(SECRET)}, 'rt-1', '${U.OWNER}', 'redari@gazpet.ro') AS r`), '42501', 'C seteaza ca authenticated owner (fără EXECUTE)')
  asteptCod(await seteaza(db, 'rt-1', U.EDITOR, 'redari@gazpet.ro'), '42501', 'C seteaza cu p_apelant editor', /non_owner/)
  asteptCod(await seteaza(db, 'rt-1', null, 'redari@gazpet.ro'), '42501', 'C seteaza cu p_apelant NULL', /non_owner/)
  asteptCod(await ca(db, 'service_role', null, `SELECT public.fn_red_mail_secret_seteaza('GMAIL_REFRESH_TOKEN', 'rt-1', '${U.OWNER}', 'redari@gazpet.ro') AS r`), '22023', 'C alt nume de secret', /secret_nepermis/)
  asteptCod(await seteaza(db, 'rt-1', U.OWNER, 'redari-test@gazpet.ro'), '22023', 'C altă căsuță', /casuta_gresita/)
  asteptCod(await seteaza(db, 'rt cu spatiu', U.OWNER, 'redari@gazpet.ro'), '22023', 'C valoare cu spațiu', /valoare_invalida/)
  if (await vault(db) !== null || (await setari(db)).trimitere_conectata_la !== null) ab.push('C un refuz a lăsat urme (Vault / setări)')
  const c1 = asteptOk(await seteaza(db, 'rt-1', U.OWNER, 'redari@gazpet.ro'), 'C conectarea')
  const s1 = await setari(db)
  if (c1 !== true || await vault(db) !== 'rt-1' || !s1.trimitere_conectata_la || s1.trimitere_conectata_de !== U.OWNER || s1.trimitere_casuta !== 'redari@gazpet.ro' || s1.trimitere_oprita !== true || s1.versiune !== s0.versiune + 1)
    ab.push('C după conectare: ' + JSON.stringify({ c1, vault: await vault(db) !== null, s1 }))
  const evc = await evenimente(db, 'oauth_conectat')
  if (evc.length !== 1 || evc[0].cod !== 'trimitere' || evc[0].autor !== U.OWNER) ab.push('C evenimentul oauth_conectat: ' + JSON.stringify(evc))
  // reconectarea (token nou): update, nu rând nou
  asteptOk(await seteaza(db, 'rt-2', U.OWNER, 'redari@gazpet.ro'), 'C reconectarea')
  if (await vault(db) !== 'rt-2' || (await db.query(`SELECT count(*)::int AS n FROM vault.secrets WHERE name = $1`, [SECRET])).rows[0].n !== 1) ab.push('C reconectarea nu a actualizat secretul unic')
  // D. citirea: doar service_role; pentru trimitere doar cu comutatorul pornit; revocarea citește și cu OFF
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_secret_citeste(${lit(SECRET)}, '${U.OWNER}', 'trimitere') AS r`), '42501', 'D citeste ca authenticated owner')
  asteptCod(await citesteSecret(db, U.EDITOR, 'trimitere'), '42501', 'D citeste cu p_apelant editor', /non_owner/)
  asteptCod(await citesteSecret(db, U.OWNER, 'trimitere'), '22023', 'D citeste pentru trimitere cu comutatorul OFF', /trimitere_oprita/)
  asteptCod(await citesteSecret(db, U.OWNER, 'altceva'), '22023', 'D motiv în afara listei', /motiv_invalid/)
  asteptCod(await citesteSecret(db, U.OWNER, 'trimitere', 'GMAIL_REFRESH_TOKEN'), '22023', 'D alt nume', /secret_nepermis/)
  if (asteptOk(await citesteSecret(db, U.OWNER, 'revocare'), 'D citeste pentru revocare (OFF)') !== 'rt-2') ab.push('D revocarea nu primește valoarea')
  // E2. pornirea: versiune veche → refuz; versiunea curentă → ON; extern → refuz; OFF fără versiune
  asteptCod(await f2setari(db, U.OWNER, false, false, s0.versiune), 'P0001', 'E2 ON cu versiune veche', /versiune_veche/)
  asteptCod(await f2setari(db, U.OWNER, false, true, (await setari(db)).versiune), 'P0001', 'E2 extern = true', /extern_amanat/)
  asteptCod(await f2setari(db, U.EDITOR, false, false, (await setari(db)).versiune), '42501', 'E2 ON de editor')
  asteptOk(await f2setari(db, U.OWNER, false, false, (await setari(db)).versiune), 'E2 ON owner')
  if ((await setari(db)).trimitere_oprita !== false) ab.push('E2 trimiterea nu e pornită')
  if (asteptOk(await citesteSecret(db, U.OWNER, 'trimitere'), 'D2 citeste pentru trimitere (ON)') !== 'rt-2') ab.push('D2 citirea pentru trimitere nu primește valoarea')
  // pauza de după un rezultat necunoscut blochează citirea pentru trimitere
  await db.exec(`UPDATE public.red_mail_setari SET pauza_pana = now() + interval '10 minutes' WHERE id = 1`)
  asteptCod(await citesteSecret(db, U.OWNER, 'trimitere'), '22023', 'D3 citeste în pauză', /trimitere_oprita/)
  await db.exec(`UPDATE public.red_mail_setari SET pauza_pana = NULL WHERE id = 1`)
  // G. fn_red_mail_f2_poate: lotul de TEST trece; lotul proiectului real e refuzat (doar_proiecte_test); „test-mic” (minuscule) = real; OFF → trimitere_oprita
  await loturi(db)
  const g1 = await poate(db, LOT.TEST), g2 = await poate(db, LOT.REAL), g3 = await poate(db, LOT.MIC)
  if (g1 !== null) ab.push('G lotul de TEST refuzat: ' + g1)
  if (g2 !== 'doar_proiecte_test') ab.push('G lotul proiectului real: ' + g2 + ' (aștepta doar_proiecte_test)')
  if (g3 !== 'doar_proiecte_test') ab.push('G lotul proiectului „test-mic” (minuscule): ' + g3 + ' (aștepta doar_proiecte_test — convenția e sensibilă la caz)')
  const e1 = (await db.query(`SELECT public.fn_red_proiect_e_test('TEST-X') AS a, public.fn_red_proiect_e_test('test-x') AS b, public.fn_red_proiect_e_test(' TEST-X') AS c, public.fn_red_proiect_e_test('TEST') AS d, public.fn_red_proiect_e_test(NULL) AS e`)).rows[0]
  if (e1.a !== true || e1.b !== false || e1.c !== false || e1.d !== false || e1.e !== null) ab.push('G fn_red_proiect_e_test: ' + JSON.stringify(e1))
  asteptOk(await f2setari(db, U.OWNER, true, false, null), 'G OFF fără versiune')
  if (await poate(db, LOT.TEST) !== 'trimitere_oprita') ab.push('G OFF nu oprește f2_poate')
  asteptOk(await f2setari(db, U.OWNER, false, false, (await setari(db)).versiune), 'G ON din nou')
  // J. TRIMITEREA prin RPC-urile REALE + CATEGORIA proiectului (runda 2, P1)
  // J0. static: lock-ul proiectului în ambele RPC-uri; funcția triggerului e DEFINER; triggerul există
  for (const f of ['fn_red_mail_rezerva', 'fn_red_mail_apel_incepe']) {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1`, [f])).rows[0]?.prosrc || ''
    if (!/FROM public\.red_proiecte WHERE id=l\.proiect_id FOR SHARE;/.test(src)) ab.push(`J0 ${f} nu ia proiectul FOR SHARE (concurența reală: supabase/tests/20261131h_redari_mail_f2b_concurenta.sh)`)
    // ordinea: setări FOR UPDATE → lot FOR UPDATE → proiect FOR SHARE → primul FOR UPDATE pe mesaje
    const i0 = src.indexOf('FROM public.red_mail_setari WHERE id=1 FOR UPDATE'), i1 = src.indexOf('FROM public.red_mail_loturi WHERE id='), iLot = src.indexOf('FOR UPDATE', i1)
    const i2 = src.indexOf('red_proiecte WHERE id=l.proiect_id FOR SHARE'), i3 = src.indexOf('FOR UPDATE', iLot + 1)
    if (!(i0 > 0 && i1 > i0 && iLot > i1 && i2 > iLot && i3 > i2)) ab.push(`J0 ${f}: ordinea lock-urilor nu e setări → lot → proiect → mesaje`)
  }
  if ((await db.query(`SELECT prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_proiect_cod_test_garda'`)).rows[0]?.prosecdef !== true) ab.push('J0 fn_red_proiect_cod_test_garda nu e SECURITY DEFINER (RLS ar ascunde loturile la redenumirea de admin)')
  if (!await areTrigger(db)) ab.push('J0 triggerul trg_red_proiect_cod_test lipsește')
  // J1. editorul nu poate rezerva; owner-ul rezervă primul mesaj: rezervat + lease; lotul → in_trimitere; jurnalul F2
  asteptCod(await rezerva(db, U.EDITOR, LOT.TEST), '42501', 'J1 rezerva ca editor')
  const r1 = asteptOk(await rezerva(db, U.OWNER, LOT.TEST), 'J1 rezerva owner')
  const m1 = r1 && r1[0]
  if (!m1 || m1.stare !== 'rezervat' || !m1.lease_token) ab.push('J1 rezervarea: ' + JSON.stringify(r1))
  if (await lotStare(db, LOT.TEST) !== 'in_trimitere') ab.push('J1 lotul nu e in_trimitere')
  if ((await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2 WHERE lot_id = $1 AND cod = 'rezervat'`, [LOT.TEST])).rows[0].n !== 1) ab.push('J1 jurnalul F2 fără „rezervat”')
  // J2. redenumirea CATEGORIEI cât lotul e rezervat: admin (JWT) → 42501 doar owner; owner → refuz P0001; postgres (mentenanță) → refuz P0001; codul neschimbat
  asteptCod(await redenumeste(db, U.ADMIN, P.TEST, 'LOT-MAIL'), '42501', 'J2 admin: TEST- → real cât lotul e rezervat', /doar owner-ul/)
  asteptCod(await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL'), 'P0001', 'J2 owner: TEST- → real cât lotul e rezervat', /loturi de e-mail neincheiate sau mesaje rezervate/)
  asteptCod(await redenumeste(db, 'postgres', P.TEST, 'LOT-MAIL'), 'P0001', 'J2 mentenanță: TEST- → real cât lotul e rezervat', /neincheiate/)
  if (await codProiect(db, P.TEST) !== 'TEST-MAIL') ab.push('J2 codul s-a schimbat totuși: ' + await codProiect(db, P.TEST))
  // J3. redenumirea în ACEEAȘI categorie trece (owner și admin), ca azi; alte coloane trec; lotul tot poate trimite
  if (asteptOk(await redenumeste(db, U.OWNER, P.TEST, 'TEST-MAIL-2'), 'J3 owner: TEST-MAIL → TEST-MAIL-2')?.[0]?.cod !== 'TEST-MAIL-2') ab.push('J3 redenumirea în categorie n-a trecut')
  if (asteptOk(await redenumeste(db, U.ADMIN, P.TEST, 'TEST-MAIL'), 'J3 admin: înapoi la TEST-MAIL')?.[0]?.cod !== 'TEST-MAIL') ab.push('J3 admin nu poate redenumi în aceeași categorie')
  asteptOk(await ca(db, 'authenticated', U.ADMIN, `UPDATE public.red_proiecte SET denumire = 'Proiect de TEST (redenumit)' WHERE id = '${P.TEST}' RETURNING id`), 'J3 admin: denumirea se schimbă în timpul trimiterii')
  if (await poate(db, LOT.TEST) !== null) ab.push('J3 lotul nu mai poate trimite după redenumirea în categorie: ' + await poate(db, LOT.TEST))
  // J4. apel_incepe: token greșit → false; tokenul bun → true, mesajul in_apel; a doua autorizare → false; categoria tot blocată (in_apel)
  if (asteptOk(await apelIncepe(db, U.OWNER, m1.id, '00000000-0000-0000-0000-000000000bad'), 'J4 apel_incepe cu token străin') !== false) ab.push('J4 tokenul străin a autorizat apelul')
  if (asteptOk(await apelIncepe(db, U.OWNER, m1.id, m1.lease_token), 'J4 apel_incepe owner') !== true) ab.push('J4 apel_incepe nu a întors true')
  if ((await mesaj(db, m1.id)).stare !== 'in_apel') ab.push('J4 mesajul nu e in_apel')
  if (asteptOk(await apelIncepe(db, U.OWNER, m1.id, m1.lease_token), 'J4 a doua autorizare') !== false) ab.push('J4 a doua autorizare a trecut (două send-uri posibile)')
  asteptCod(await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL'), 'P0001', 'J4 owner: TEST- → real cât mesajul e in_apel (intervalul HTTP)', /mesaje rezervate \/ in apel|neincheiate/)
  // J5. rezultatul: token străin → false (NECONFIRMAT, nimic scris); tokenul bun → true + trimis; repetarea identică → true; alt rezultat → conflict
  if (asteptOk(await rezultat(db, U.OWNER, m1.id, '00000000-0000-0000-0000-000000000bad', 'trimis', 'gm1', 'th1'), 'J5 rezultat cu token străin') !== false) ab.push('J5 tokenul străin a scris rezultatul')
  if ((await mesaj(db, m1.id)).stare !== 'in_apel') ab.push('J5 rezultatul cu token străin a schimbat starea')
  if (asteptOk(await rezultat(db, U.OWNER, m1.id, m1.lease_token, 'trimis', 'gm1', 'th1'), 'J5 rezultat trimis') !== true) ab.push('J5 rezultatul nu a întors true')
  const mt = await mesaj(db, m1.id)
  if (mt.stare !== 'trimis' || mt.gmail_id !== 'gm1' || mt.thread_id !== 'th1') ab.push('J5 mesajul după rezultat: ' + JSON.stringify(mt))
  if (asteptOk(await rezultat(db, U.OWNER, m1.id, m1.lease_token, 'trimis', 'gm1', 'th1'), 'J5 rezultat repetat identic') !== true) ab.push('J5 repetarea identică nu e idempotentă')
  asteptCod(await rezultat(db, U.OWNER, m1.id, m1.lease_token, 'esuat_sigur', null, null), '22023', 'J5 alt rezultat pe mesaj terminal', /rezultat_conflict/)
  // J6. lotul rămâne in_trimitere (al doilea mesaj în coadă) → categoria tot blocată; al doilea mesaj rezervat + in_apel, lotul ÎNCHEIAT între timp →
  //     tot blocată (mesaj în zbor pe lot încheiat); după rezultatul lui (fără mesaje în zbor) owner-ul poate schimba categoria, iar lotul (acum pe
  //     proiect real) e refuzat de f2_poate; înapoi la TEST-
  asteptCod(await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL'), 'P0001', 'J6 owner: TEST- → real cu lotul in_trimitere', /neincheiate/)
  await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`)   // pauza de 2 s dintre apeluri, fără așteptare
  const r2 = asteptOk(await rezerva(db, U.OWNER, LOT.TEST), 'J6 rezerva al doilea mesaj')
  const m2 = r2 && r2[0]
  if (!m2 || m2.stare !== 'rezervat' || m2.id === m1.id) ab.push('J6 a doua rezervare: ' + JSON.stringify(r2))
  if (m2 && asteptOk(await apelIncepe(db, U.OWNER, m2.id, m2.lease_token), 'J6 apel_incepe al doilea mesaj') !== true) ab.push('J6 al doilea apel_incepe nu a întors true')
  await db.exec(`UPDATE public.red_mail_loturi SET stare = 'incheiat', incheiat_la = now() WHERE id = '${LOT.TEST}'`)
  asteptCod(await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL'), 'P0001', 'J6 owner: TEST- → real cu lotul încheiat dar un mesaj in_apel', /mesaje rezervate \/ in apel/)
  if (m2 && asteptOk(await rezultat(db, U.OWNER, m2.id, m2.lease_token, 'trimis', 'gm2', 'th2'), 'J6 rezultat al doilea mesaj') !== true) ab.push('J6 rezultatul al doilea nu a întors true')
  if (asteptOk(await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL'), 'J6 owner: TEST- → real după încheierea lotului și fără mesaje în zbor')?.[0]?.cod !== 'LOT-MAIL') ab.push('J6 schimbarea categoriei după încheiere n-a trecut')
  if (await poate(db, LOT.TEST) !== 'doar_proiecte_test') ab.push('J6 lotul pe proiectul devenit real: ' + await poate(db, LOT.TEST))
  asteptCod(await redenumeste(db, U.ADMIN, P.TEST, 'TEST-MAIL'), '42501', 'J6 admin: real → TEST- (categoria o schimbă doar owner-ul)')
  if (asteptOk(await redenumeste(db, U.OWNER, P.TEST, 'TEST-MAIL'), 'J6 owner: înapoi la TEST-MAIL')?.[0]?.cod !== 'TEST-MAIL') ab.push('J6 întoarcerea la TEST- n-a trecut')
  // J7. un proiect REAL cu lot aprobat (neîncheiat) nu devine TEST-: owner refuzat P0001, admin 42501; „test-mic” → „TEST-MIC” = schimbare de categorie, refuzată
  asteptCod(await redenumeste(db, U.OWNER, P.REAL, 'TEST-REAL'), 'P0001', 'J7 owner: real → TEST- cu lot aprobat', /neincheiate/)
  asteptCod(await redenumeste(db, U.ADMIN, P.REAL, 'TEST-REAL'), '42501', 'J7 admin: real → TEST-')
  asteptCod(await redenumeste(db, U.OWNER, P.MIC, 'TEST-MIC'), 'P0001', 'J7 owner: test-mic → TEST-MIC cu lot aprobat', /neincheiate/)
  if (asteptOk(await redenumeste(db, U.OWNER, P.REAL, 'LOT1-REAL-B'), 'J7 owner: real → real (aceeași categorie)')?.[0]?.cod !== 'LOT1-REAL-B') ab.push('J7 redenumirea în categoria „real” n-a trecut')
  asteptOk(await redenumeste(db, U.OWNER, P.REAL, 'LOT1-REAL'), 'J7 înapoi la LOT1-REAL')
  // J8. lanțul FAN: AWB-uri propuse / aprobate / în curs / necunoscute blochează categoria; generat / ridicat / anulat / eroare nu
  const awb = s => db.exec(`UPDATE public.red_fan_awb SET stare = '${s}' WHERE proiect_id = '${P.FAN}'`)
  await db.exec(`INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, stare, hash_date) VALUES ('${P.FAN}', gen_random_uuid(), gen_random_uuid(), 'PL-TST-0001', 'aprobat', repeat('f', 64))`)
  for (const s of ['propus', 'aprobat', 'in_curs', 'necunoscut']) { await awb(s); asteptCod(await redenumeste(db, U.OWNER, P.FAN, 'TEST-FAN'), 'P0001', `J8 owner: real → TEST- cu AWB FAN ${s}`, /AWB-uri FAN/) }
  for (const s of ['generat', 'ridicat', 'anulat', 'eroare']) {
    await awb(s)
    if (asteptOk(await redenumeste(db, U.OWNER, P.FAN, 'TEST-FAN'), `J8 owner: real → TEST- cu AWB FAN ${s}`)?.[0]?.cod !== 'TEST-FAN') ab.push(`J8 cu AWB ${s} schimbarea n-a trecut`)
    asteptOk(await redenumeste(db, U.OWNER, P.FAN, 'LOT2-FAN'), 'J8 înapoi')
  }
  // F. scrierile directe (postgres, fără RPC) sunt oprite de CHECK-uri: extern, doar_test, căsuța străină; pornirea fără conectare (după revocare, H)
  for (const [set, ce] of [['extern_permis = true', 'extern'], ['doar_proiecte_test = false', 'doar_test'], [`trimitere_casuta = 'alt@gazpet.ro'`, 'căsuța străină'], ['trimitere_conectata_de = NULL', 'conectarea pe jumătate']]) {
    try { await db.query(`UPDATE public.red_mail_setari SET ${set} WHERE id = 1`); ab.push(`F UPDATE direct ${ce}: a trecut`) } catch (e) { if (e.code !== '23514') ab.push(`F UPDATE direct ${ce}: ${e.code} ${e.message}`) }
  }
  asteptCod(await ca(db, 'authenticated', U.OWNER, `UPDATE public.red_mail_setari SET trimitere_oprita = true WHERE id = 1`), '42501', 'F UPDATE direct de owner (fără drept)')
  // H. revocarea: valoarea golită, OFF, starea conectării ștearsă, eveniment; apoi pornirea refuzată (RPC + CHECK), f2_poate oprit
  if (asteptOk(await seteaza(db, '', U.OWNER, null), 'H revocarea') !== true) ab.push('H revocarea nu întoarce true')
  const sh = await setari(db)
  if (await vault(db) !== '' || sh.trimitere_oprita !== true || sh.trimitere_conectata_la !== null || sh.trimitere_conectata_de !== null || sh.trimitere_casuta !== null) ab.push('H după revocare: ' + JSON.stringify(sh))
  const evr = await evenimente(db, 'oauth_revocat')
  if (evr.length !== 1 || evr[0].cod !== 'trimitere' || evr[0].autor !== U.OWNER) ab.push('H evenimentul oauth_revocat: ' + JSON.stringify(evr))
  if (asteptOk(await citesteSecret(db, U.OWNER, 'revocare'), 'H citeste după revocare') !== null) ab.push('H citirea după revocare nu e NULL')
  asteptCod(await f2setari(db, U.OWNER, false, false, sh.versiune), 'P0001', 'H ON după revocare', /casuta_neconectata/)
  try { await db.query(`UPDATE public.red_mail_setari SET trimitere_oprita = false WHERE id = 1`); ab.push('F UPDATE direct ON fără conectare: a trecut') } catch (e) { if (e.code !== '23514') ab.push('F UPDATE direct ON fără conectare: ' + e.code) }
  if (await poate(db, LOT.REAL) !== 'trimitere_oprita') ab.push('H f2_poate după revocare: ' + await poate(db, LOT.REAL))
  return ab
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. înainte de migrare: pornirea e imposibilă (activare_amanata), RPC-urile / triggerul noi lipsesc, rezerva / apel_incepe = 20261131a')
{
  const db = await bazaNoua()
  const r = await f2setari(db, U.OWNER, false, false, 1)
  ok(r.code === 'P0001' && /activare_amanata/.test(r.message), 'înainte: fn_red_mail_f2_setari refuză pornirea: ' + (r.message || 'a trecut'))
  ok(await nrNoi(db) === 0 && !await areTrigger(db), 'înainte: fără RPC-urile noi, fără trigger')
  ok(await amprentaFn(db, 'fn_red_mail_rezerva') === 'a5bf83c98b41d8665cce7e536eea4343' && await amprentaFn(db, 'fn_red_mail_apel_incepe') === 'b3834ab1c09d2671c0778621f3271255', 'înainte: rezerva / apel_incepe au corpurile 20261131a')
  // redenumirea TEST- ↔ real e liberă înainte de migrare (gaura din runda 1), ca proba triggerului să fie discriminatorie
  await loturi(db)
  ok(!(await redenumeste(db, U.ADMIN, P.TEST, 'LOT-MAIL')).code && await codProiect(db, P.TEST) === 'LOT-MAIL', 'înainte: adminul poate redenumi TEST- → real cu lot aprobat (ce închide migrarea)')
  await db.close()
}

console.log('2. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OB),
    `# ${NUME.slice(0, 9)}: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length >= 10 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  ok((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'fn_red_mail_oauth_start'`)).rows[0].n === 0, 'generarea manifestului (ROLLBACK) nu a schimbat nimic')
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)), 'livrarea aprobată: diferența = manifestul')
  ok(j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: lock-urile puternice ale migrarii tinute \\d+ ms`).test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT + lock-ul la prima încercare')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  await db.close()
}

console.log('3. L14: bază FOLOSITĂ → revenirea refuză la fiecare pas, nimic șters; bază NEFOLOSITĂ → aplicare → revenire → reaplicare → revenire')
{
  // 3a. folosită: conectare + pornire → refuz (pornită) → OFF → refuz (conectată) → revocare → refuz ISTORIC_NOU; nimic șters
  const db = await bazaNoua()
  await aplicaMig(db)
  await seteaza(db, 'rt-x', U.OWNER, 'redari@gazpet.ro')
  await f2setari(db, U.OWNER, false, false, (await setari(db)).versiune)
  let m = await eroare(revino(db))
  ok(m && /trimiterea e pornita \/ casuta conectata/.test(m), 'revenirea cu trimiterea pornită: refuz: ' + (m || 'A TRECUT'))
  await f2setari(db, U.OWNER, true, false, null)
  m = await eroare(revino(db))
  ok(m && /casuta conectata/.test(m), 'revenirea cu trimiterea oprită dar căsuța conectată: refuz')
  await seteaza(db, '', U.OWNER, null)
  const ev0 = await nrEvenimente(db)
  m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m), 'revenirea după revocare (evenimente oauth + rândul Vault golit = istoric): refuz ISTORIC_NOU: ' + (m || 'A TRECUT'))
  ok(await nrEvenimente(db) === ev0 && await vault(db) === '' && await nrNoi(db) === NR_NOI && await areTrigger(db), 'nimic șters / schimbat de refuz (evenimente, rândul Vault, funcții, trigger)')
  await db.close()
}
{
  // 3b. doar un state (activ, apoi consumat) = istoric → refuz
  const db = await bazaNoua()
  await aplicaMig(db)
  await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_start('trimitere', '${'d'.repeat(64)}') AS r`)
  let m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m), 'revenirea cu un state trimitere activ: refuz ISTORIC_NOU')
  await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_consuma('${'d'.repeat(64)}') AS r`)
  m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m) && (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_oauth_state WHERE scop = 'trimitere'`)).rows[0].n === 1, 'revenirea cu state-ul consumat: refuz ISTORIC_NOU, state-ul rămâne (nu se șterge istoric)')
  await db.close()
}
{
  // 3c. folosită complet (verifica: trimitere reală prin RPC-uri, apoi revocare) → refuz ISTORIC_NOU
  const db = await bazaNoua()
  await aplicaMig(db)
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  const m = await eroare(revino(db))
  ok(ab.length === 0 && m && /ISTORIC_NOU/.test(m), 'după o zi de folosire (mesaj trimis prin RPC-uri, revocare): revenirea refuză ISTORIC_NOU')
  await db.close()
}
{
  // 3d. nefolosită: aplicare → revenire → reaplicare → revenire → reaplicare; abia apoi folosire
  const db = await bazaNoua()
  await aplicaMig(db)
  ok(await nrNoi(db) === NR_NOI && await areTrigger(db), 'aplicarea: funcțiile noi + triggerul')
  let j = await revino(db)
  ok(j.some(x => /20261131h revenire: sfarsit la \d+ ms/.test(x)), 'revenirea pe baza nefolosită: trece')
  const fp = (await db.query(`SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname IN ('fn_red_mail_f2_poate', 'fn_red_mail_f2_setari', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe') OR p.proname IN ${NOI}) ORDER BY 1`)).rows
  ok(fp.length === 4 && fp.map(x => x.proname + ':' + x.m).join(' ') === 'fn_red_mail_apel_incepe:b3834ab1c09d2671c0778621f3271255 fn_red_mail_f2_poate:d239c6cc7bcb13691d798f99d4f1aa58 fn_red_mail_f2_setari:88b2a3f13a95d346b1fec56736aa89e3 fn_red_mail_rezerva:a5bf83c98b41d8665cce7e536eea4343',
    'revenirea: corpurile 20261131a (poate, setari, rezerva, apel_incepe), funcțiile noi scoase: ' + JSON.stringify(fp))
  const col = (await db.query(`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.red_mail_setari'::regclass AND NOT attisdropped AND attname IN ('doar_proiecte_test', 'trimitere_conectata_la', 'trimitere_conectata_de', 'trimitere_casuta')`)).rows[0].n
  const ck = (await db.query(`SELECT string_agg(conname, ',' ORDER BY conname) AS s FROM pg_constraint WHERE conrelid = 'public.red_mail_setari'::regclass AND conname LIKE 'red_mail_f2%'`)).rows[0].s
  ok(col === 0 && ck === 'red_mail_f2_inert_ck' && !await areTrigger(db), `revenirea: coloanele scoase, CHECK-ul inert repus (${ck}), triggerul scos`)
  ok(await vault(db) === null, 'revenirea pe baza nefolosită: fără rând în Vault')
  const r = await f2setari(db, U.OWNER, false, false, await versiune(db))
  ok(r.code === 'P0001' && /activare_amanata/.test(r.message), 'revenirea: regula veche înapoi (pornirea imposibilă)')
  await loturi(db)
  ok(!(await redenumeste(db, U.ADMIN, P.TEST, 'LOT-MAIL')).code, 'revenirea: redenumirea TEST- → real e din nou liberă (starea veche)')
  await redenumeste(db, U.ADMIN, P.TEST, 'TEST-MAIL')
  await aplicaMig(db)
  ok(await nrNoi(db) === NR_NOI && await areTrigger(db), 'reaplicarea după revenire: trece')
  j = await revino(db)
  ok(j.some(x => /20261131h revenire: sfarsit/.test(x)) && await nrNoi(db) === 0, 'a doua revenire (tot nefolosită): trece')
  await aplicaMig(db)
  // folosire țintită după reaplicare: conectarea, pornirea, lotul TEST trece, triggerul refuză categoria; apoi revenirea refuză ISTORIC_NOU
  const c2 = await seteaza(db, 'rt-y', U.OWNER, 'redari@gazpet.ro')
  const p2 = await f2setari(db, U.OWNER, false, false, await versiune(db))
  ok(!c2.code && !p2.code && await poate(db, LOT.TEST) === null && await poate(db, LOT.REAL) === 'doar_proiecte_test', 'după reaplicare: conectarea, pornirea, lotul TEST trece, lotul real e refuzat')
  ok((await redenumeste(db, U.ADMIN, P.TEST, 'LOT-MAIL')).code === '42501' && (await redenumeste(db, U.OWNER, P.TEST, 'LOT-MAIL')).code === 'P0001', 'după reaplicare: triggerul refuză schimbarea categoriei (admin 42501, owner P0001)')
  await f2setari(db, U.OWNER, true, false, null)
  await seteaza(db, '', U.OWNER, null)
  const m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m), 'după folosire: revenirea refuză ISTORIC_NOU')
  await db.close()
}

console.log('4. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['CHECK-ul inert lipsește (altă stare a lui 20261131a)', async db => { await db.exec(`ALTER TABLE public.red_mail_setari DROP CONSTRAINT red_mail_f2_inert_ck`); return aplicaMig(db) }, /red_mail_f2_inert_ck nu e cel din 20261131a/],
  ['CHECK-ul scopului OAuth diferit', async db => { await db.exec(`ALTER TABLE public.red_mail_oauth_state DROP CONSTRAINT red_mail_oauth_state_scop_ck; ALTER TABLE public.red_mail_oauth_state ADD CONSTRAINT red_mail_oauth_state_scop_ck CHECK (scop IN ('citire'))`); return aplicaMig(db) }, /red_mail_oauth_state_scop_ck nu e cel din 20261130j/],
  ['fn_red_mail_f2_setari schimbată înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_setari(p_oprit boolean,p_extern boolean,p_versiune integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN true; END $f$;`)
    return aplicaMig(db)
  }, /functiile F2 nu sunt cele din 20261131a: public\.fn_red_mail_f2_setari/],
  ['fn_red_mail_rezerva schimbată înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN; END $f$;`)
    return aplicaMig(db)
  }, /functiile F2 nu sunt cele din 20261131a: public\.fn_red_mail_rezerva/],
  ['fn_red_mail_f2_poate cu SECURITY DEFINER (proprietate diferită)', async db => { await db.exec(`ALTER FUNCTION public.fn_red_mail_f2_poate(public.red_mail_loturi) SECURITY DEFINER`); return aplicaMig(db) }, /nu sunt cele din 20261131a: public\.fn_red_mail_f2_poate/],
  ['triggerul de pe oauth_state oprit', async db => { await db.exec(`ALTER TABLE public.red_mail_oauth_state DISABLE TRIGGER trg_red_mail_oauth_state_reguli`); return aplicaMig(db) }, /triggerele 20261130k/],
  ['triggerul de imuabilitate F2 (loturi) oprit', async db => { await db.exec(`ALTER TABLE public.red_mail_loturi DISABLE TRIGGER trg_red_mail_f2_lot`); return aplicaMig(db) }, /triggerele 20261130k \/ 20261131a/],
  ['un trigger cu numele trg_red_proiect_cod_test deja prezent', async db => { await db.exec(`CREATE TRIGGER trg_red_proiect_cod_test BEFORE UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste()`); return aplicaMig(db) }, /obiectele exista deja/],
  ['red_fan_awb fără starea in_curs în CHECK', async db => {
    await db.exec(`ALTER TABLE public.red_fan_awb DROP CONSTRAINT red_fan_awb_stare_check; ALTER TABLE public.red_fan_awb ADD CONSTRAINT red_fan_awb_stare_check CHECK (stare IN ('propus', 'aprobat', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat'))`)
    return aplicaMig(db)
  }, /red_fan_awb\.stare nu are starile asteptate/],
  ['istoric de trimitere deja existent (mesaj cu rezervat_la)', async db => { await loturi(db); await db.exec(`UPDATE public.red_mail_mesaje SET rezervat_la = now() WHERE id = '00000000-0000-0000-0000-0000000e0001'`); return aplicaMig(db) }, /exista deja istoric de trimitere/],
  ['un secret cu valoare deja în Vault', async db => { await db.exec(`SELECT vault.create_secret('vechi', '${SECRET}')`); return aplicaMig(db) }, /exista deja un secret/],
  ['setul de lock-uri obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_mail_oauth_state IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    '      LOCK TABLE public.red_mail_oauth_state IN ACCESS EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])), /BUGET_LOCK: lock-urile obtinute abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_mail_oauth_state IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n      EXIT;\n"]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  const m = await eroare(fn(db))
  const neschimbat = await nrNoi(db) === 0
    && (await db.query(`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.red_mail_setari'::regclass AND attname = 'doar_proiecte_test' AND NOT attisdropped`)).rows[0].n === 0
    && await amprentaFn(db, 'fn_red_mail_apel_incepe') === 'b3834ab1c09d2671c0778621f3271255'
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}${neschimbat ? '' : ' (STAREA S-A SCHIMBAT)'}`)
  await db.close()
}

console.log('5. refuzurile revenirii')
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261131h \(pasul 1, functii/],
  ['fără plafon', async db => aplicaMig(db), { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['secretul Vault primit de authenticated', async db => { await aplicaMig(db); await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text) TO authenticated`) }, {}, /starea nu e cea din 20261131h \(pasul 1, functii: drepturi/],
  ['fn_red_mail_f2_poate schimbată după aplicare', async db => { await aplicaMig(db); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(l public.red_mail_loturi) RETURNS text LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`) }, {}, /starea nu e cea din 20261131h \(pasul 1, functii: public\.fn_red_mail_f2_poate/],
  ['fn_red_mail_rezerva schimbată după aplicare', async db => { await aplicaMig(db); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN; END $f$;`) }, {}, /starea nu e cea din 20261131h \(pasul 1, functii: public\.fn_red_mail_rezerva/],
  ['triggerul scos după aplicare', async db => { await aplicaMig(db); await db.exec(`DROP TRIGGER trg_red_proiect_cod_test ON public.red_proiecte`) }, {}, /trigger trg_red_proiect_cod_test/],
  ['triggerul oprit după aplicare', async db => { await aplicaMig(db); await db.exec(`ALTER TABLE public.red_proiecte DISABLE TRIGGER trg_red_proiect_cod_test`) }, {}, /trigger trg_red_proiect_cod_test/],
  ['secret cu valoare în Vault (conectare făcută direct)', async db => { await aplicaMig(db); await db.exec(`SELECT vault.create_secret('rt', '${SECRET}')`) }, {}, /ISTORIC_NOU/],
  ['istoric: un eveniment oauth_respins', async db => { await aplicaMig(db); await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_oauth_eveniment('oauth_respins', 'scope_diferit') AS r`) }, {}, /ISTORIC_NOU/],
  ['istoric: jurnal F2 cu „rezervat”', async db => { await aplicaMig(db); await db.exec(`INSERT INTO public.red_mail_jurnal_f2 (cod) VALUES ('rezervat')`) }, {}, /ISTORIC_NOU/],
]) {
  const db = await bazaNoua()
  await pregatire(db)
  const inainte = await nrNoi(db)
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && await nrNoi(db) === inainte, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('6. MUTANȚI pe migrare (fiecare TREBUIE să pice: la aplicare, la postcondiții sau la verificări)')
const MUTANTI = [
  ['f2_poate fără garda „doar TEST”', [[" IF EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND doar_proiecte_test IS TRUE)\n    AND NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_proiect_e_test(cod) IS TRUE) THEN RETURN 'doar_proiecte_test'; END IF;\n", '']]],
  // convenția nesensibilă la caz: „test-mic” ar trece de gardă (f2_poate ≠ doar_proiecte_test) → prins de verificarea G (lotul MIC), nu de o ramură specială
  ['convenția „TEST-” nesensibilă la caz (fn_red_proiect_e_test)', [[" SELECT left(p_cod,5)='TEST-'\n", " SELECT upper(left(p_cod,5))='TEST-'\n"]]],
  ['consumul fără „o singură dată” (consumat_la IS NULL scos)', [['WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND expira_la>now() AND owner_id=auth.uid()', 'WHERE state_sha256=p_state_sha256 AND expira_la>now() AND owner_id=auth.uid()']]],
  ['consumul fără legătura cu owner-ul curent', [['WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND expira_la>now() AND owner_id=auth.uid()', 'WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND expira_la>now()']]],
  ['consumul fără expirare', [['WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND expira_la>now() AND owner_id=auth.uid()', 'WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND owner_id=auth.uid()']]],
  ['seteaza fără verificarea owner-ului pe p_apelant', [[" IF p_apelant IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=p_apelant AND pr.is_owner IS TRUE) THEN RAISE EXCEPTION 'non_owner' USING ERRCODE='42501'; END IF;\n IF p_valoare IS NULL", " IF p_valoare IS NULL"]]],
  ['seteaza fără verificarea căsuței', [["  IF p_casuta IS DISTINCT FROM 'redari@gazpet.ro' THEN RAISE EXCEPTION 'casuta_gresita' USING ERRCODE='22023'; END IF;\n", '']]],
  ['citeste fără condiția comutatorului', [[" IF p_motiv='trimitere' AND (s.trimitere_oprita IS NOT FALSE OR (s.pauza_pana IS NOT NULL AND s.pauza_pana>now())) THEN RAISE EXCEPTION 'trimitere_oprita' USING ERRCODE='22023'; END IF;\n", '']]],
  ['f2_setari pornită fără căsuța conectată', [[" IF NOT p_oprit AND s.trimitere_conectata_la IS NULL THEN RAISE EXCEPTION 'casuta_neconectata'; END IF;\n", '']]],
  ['f2_setari cu extern permis', [[" IF p_extern THEN RAISE EXCEPTION 'extern_amanat'; END IF;\n", ''], ['UPDATE public.red_mail_setari SET trimitere_oprita=p_oprit,extern_permis=false WHERE id=1;', 'UPDATE public.red_mail_setari SET trimitere_oprita=p_oprit,extern_permis=p_extern WHERE id=1;']]],
  ['CHECK-ul pornirii scos', [[",\n  ADD CONSTRAINT red_mail_f2b_pornire_ck CHECK (trimitere_oprita IS TRUE OR trimitere_conectata_la IS NOT NULL);", ';']]],
  ['secretul Vault acordat și rolurilor aplicației', [['GRANT EXECUTE ON FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text), public.fn_red_mail_secret_citeste(text,uuid,text) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text), public.fn_red_mail_secret_citeste(text,uuid,text) TO service_role, authenticated;']]],
  ['eveniment fără listă închisă', [["p_cod NOT IN ('schimb_esuat'", "p_cod NOT IN ('schimb_esuat','altceva'"]]],
  // runda 2: categoria proiectului
  ['triggerul fără garda loturilor de e-mail', [[" IF EXISTS(SELECT 1 FROM public.red_mail_loturi l WHERE l.proiect_id=NEW.id\n           AND (l.stare<>'incheiat' OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m WHERE m.lot_id=l.id AND m.stare IN ('rezervat','in_apel')))) THEN\n  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) nu se schimba cat proiectul are loturi de e-mail neincheiate sau mesaje rezervate / in apel' USING ERRCODE='P0001';\n END IF;\n", '']]],
  ['triggerul doar pe loturi neîncheiate (fără mesajele în zbor)', [["(l.stare<>'incheiat' OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m WHERE m.lot_id=l.id AND m.stare IN ('rezervat','in_apel')))", "l.stare<>'incheiat'"]]],
  ['triggerul fără condiția „doar owner-ul”', [[" IF (auth.uid() IS NOT NULL OR coalesce(auth.role(),'') IN ('anon','authenticated')) AND public.fn_sms_e_owner() IS NOT TRUE THEN\n  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) o schimba doar owner-ul' USING ERRCODE='42501';\n END IF;\n", '']]],
  ['triggerul fără SECURITY DEFINER și fără condiția owner (RLS ascunde loturile adminului)', [
    [" IF (auth.uid() IS NOT NULL OR coalesce(auth.role(),'') IN ('anon','authenticated')) AND public.fn_sms_e_owner() IS NOT TRUE THEN\n  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) o schimba doar owner-ul' USING ERRCODE='42501';\n END IF;\n", ''],
    ['CREATE FUNCTION public.fn_red_proiect_cod_test_garda() RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$', 'CREATE FUNCTION public.fn_red_proiect_cod_test_garda() RETURNS trigger\nLANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$'],
    [", 'plpgsql', true, 'v', 'trigger')", ", 'plpgsql', false, 'v', 'trigger')"]]],
  ['triggerul fără garda AWB-urilor FAN', [[" IF EXISTS(SELECT 1 FROM public.red_fan_awb a WHERE a.proiect_id=NEW.id AND a.stare IN ('propus','aprobat','in_curs','necunoscut')) THEN\n  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) nu se schimba cat proiectul are AWB-uri FAN propuse / aprobate / in curs / necunoscute' USING ERRCODE='P0001';\n END IF;\n", '']]],
  ['triggerul care refuză ORICE redenumire (și în aceeași categorie)', [[" IF NEW.cod IS NOT DISTINCT FROM OLD.cod OR public.fn_red_proiect_e_test(NEW.cod) IS NOT DISTINCT FROM public.fn_red_proiect_e_test(OLD.cod) THEN RETURN NEW; END IF;\n", " IF NEW.cod IS NOT DISTINCT FROM OLD.cod THEN RETURN NEW; END IF;\n"]]],
  ['triggerul nepus (CREATE TRIGGER scos)', [['CREATE TRIGGER trg_red_proiect_cod_test BEFORE UPDATE OF cod ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_proiect_cod_test_garda();\n', '']]],
  ['rezerva fără lock-ul FOR SHARE pe proiect', [[" PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;\n -- Reconcilierea", " -- Reconcilierea"]]],
  ['apel_incepe fără lock-ul FOR SHARE pe proiect', [[" PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;\n SELECT * INTO m", " SELECT * INTO m"]]],
]
for (const [nume, lista] of MUTANTI) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = !!m, cum = m ? 'la aplicare: ' + m.slice(0, 110) : ''
  if (!m) { const ab = await verifica(db); prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 130)})` }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}

console.log('6b. MUTANȚI pe revenire (fiecare TREBUIE să pice: revenirea mutantă trece unde cea reală refuză)')
for (const [nume, lista, pregatire] of [
  ['revenirea fără refuzul L14 la istoric nou', [["      RAISE EXCEPTION '20261131h revenire: ISTORIC_NOU", "      RAISE NOTICE '20261131h revenire: ISTORIC_NOU"]],
    async db => { await seteaza(db, 'rt', U.OWNER, 'redari@gazpet.ro'); await seteaza(db, '', U.OWNER, null) }],
  ['revenirea fără refuzul la trimiterea pornită / căsuța conectată', [["      RAISE EXCEPTION '20261131h revenire: trimiterea e pornita", "      RAISE NOTICE '20261131h revenire: trimiterea e pornita"],
    ["      RAISE EXCEPTION '20261131h revenire: ISTORIC_NOU", "      RAISE NOTICE '20261131h revenire: ISTORIC_NOU"]],
    async db => { await seteaza(db, 'rt', U.OWNER, 'redari@gazpet.ro') }],
  ['revenirea fără verificarea triggerului', [["      RAISE EXCEPTION '20261131h revenire: starea nu e cea din 20261131h (pasul %, trigger trg_red_proiect_cod_test)', v_pas;", "      NULL;"]],
    async db => { await db.exec(`DROP TRIGGER trg_red_proiect_cod_test ON public.red_proiecte`) }],
]) {
  const db = await bazaNoua()
  await aplicaMig(db)
  await pregatire(db)
  const real = await eroare(revino(db))
  let t
  try { t = aplica(REV, lista) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const mutant = await eroare(revino(db, t))
  // prins = revenirea reală refuză, iar mutantul fie trece, fie pică din alt motiv decât cel așteptat (comportament diferit, vizibil)
  ok(real !== null && mutant !== real, `MUTANT ${nume} — real: ${real ? real.slice(0, 70) : 'A TRECUT'} | mutant: ${mutant ? mutant.slice(0, 70) : 'A TRECUT'}`)
  await db.close()
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
