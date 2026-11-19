// Proba LOCALĂ a migrării 20261131j (Redări: verificarea AI a importului — dreptul pe proiect, jurnalul apelurilor plătite, rezervarea /
// închiderea) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261131j_redari_import_ai_schelet.sql + funcțiile extrase EXACT din migrările lor (fn_red_nivel și
//   fn_red_jurnal_imuabil din 20261126a, fn_red_jurnal din 20261130j); amprentele celor verificate de garda migrării = constantele din 20261131j
//   (verificat la pasul 0, inclusiv auth.uid() din schelet).
// Aplicarea: ca runnerul — marcaj + plafon 5000 (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: întâi generarea
//   manifestului (GLOBAL aprobat „-”, ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și garda
//   finală REALĂ a runnerului (lm_fin) + COMMIT. Lista obiectelor = supabase/tests/20261131j_redari_import_verificare_ai.l15.obiecte.tsv.
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul real al fiecărei căi (authenticated cu JWT — sub în request.jwt.claim.sub
//    ȘI în claims —, anon, service_role, postgres): dreptul, rezervarea (cheia de intenție, plafoanele, costul), închiderea (CAS), RLS, jurnalul.
// 2. Aplicare -> revenire -> reaplicare -> revenire pe bază nefolosită; refuzurile revenirii (ISTORIC_NOU) și ale migrării. 3. Lock-urile.
// 4. MUTANȚI: fiecare TREBUIE să pice o probă de comportament (amprentele recalculate, ca postcondiția să nu-i prindă ea).
// Ce NU probează PGlite (o singură conexiune): concurența reală (două rezervări simultane pe același proiect — lock-ul consultativ) — pe clonă.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_import_ai_local.mjs
//   [--scrie-obiecte = rescrie lista L15 din manifestul generat]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'importai_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20261131j_redari_import_verificare_ai.sql'
const F_REV = 'supabase/revenire/20261131j_redari_import_verificare_ai_ROLLBACK.sql'
const F_OBIECTE = 'supabase/tests/20261131j_redari_import_verificare_ai.l15.obiecte.tsv'
const SCHELET = citeste('supabase/tests/20261131j_redari_import_ai_schelet.sql')
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
let OBIECTE = ''
try { OBIECTE = citeste(F_OBIECTE) } catch { /* se generează cu --scrie-obiecte */ }
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── funcțiile, EXACT ca în migrările lor (instrucțiunea întreagă: antet + corp) ──
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
const M26 = M('20261126a_redari_teren.sql'), M30J = M('20261130j_redari_mail_f1_schema.sql')
const FUNCTII = [
  [M26, 'CREATE FUNCTION public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae'],
  [M26, 'CREATE FUNCTION public.fn_red_jurnal_imuabil()'],
  // r2: fn_red_jurnal nu mai e chemată de migrare (drepturile au istoricul lor); rămâne în schelet pentru triggerul de pe red_proiecte
  [M30J, 'CREATE OR REPLACE FUNCTION public.fn_red_jurnal()'],
]
console.log('0. funcțiile extrase din migrările lor (amprentele = constantele din 20261131j)')
let SQL_FUNCTII = ''
for (const [text, cap, amp] of FUNCTII) {
  if (amp) {
    const m = md5(corp(text, cap))
    ok(m === amp && MIG.includes(`'${amp}'`), `${cap.replace(/^CREATE (OR REPLACE )?FUNCTION /, '')}: ${m} (în migrare: ${MIG.includes(`'${amp}'`)})`)
  }
  SQL_FUNCTII += functie(text, cap) + '\n'
}
ok(MIG.includes("'cdef18c69c4f4cbbced2eaf81e628b49'"), 'garda migrării cere amprenta live a lui auth.uid() (verificată pe baza scheletului la pasul 1)')
// ACL-urile de pe live (20261126a §7, 20261130j): fn_red_nivel pentru authenticated / service_role, restul doar proprietarul
SQL_FUNCTII += `REVOKE ALL ON FUNCTION public.fn_red_nivel(), public.fn_red_jurnal_imuabil(), public.fn_red_jurnal() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;\n`
const [SCH_A, SCH_B] = SCHELET.split('-- @@FUNCTII@@')
ok(SCH_B !== undefined, 'scheletul are marcajul funcțiilor')
// amprentele corpurilor noi (blocul AMPRENTE-NOI 20261131j: aceleași în migrare și în revenire)
const CAP_NOI = [['public.fn_red_import_ai_poate(uuid)', 'CREATE FUNCTION public.fn_red_import_ai_poate('],
  ['public.fn_red_import_ai_rezerva(uuid,uuid,text,text,integer,integer,integer,integer,integer)', 'CREATE FUNCTION public.fn_red_import_ai_rezerva('],
  ['public.fn_red_import_ai_inchide(uuid,uuid,text,integer,integer,integer,integer,text)', 'CREATE FUNCTION public.fn_red_import_ai_inchide('],
  ['public.fn_red_proiect_drepturi_istoric()', 'CREATE FUNCTION public.fn_red_proiect_drepturi_istoric(']]
ok(!MIG.includes("'41ab451b7fcb499a2284c9c82367069e'") && !/EXECUTE FUNCTION public\.fn_red_jurnal\(\)/.test(MIG), 'r2: migrarea nu mai atașează fn_red_jurnal (nicio copie a drepturilor în red_jurnal)')
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261131j'), t.indexOf('-- <<< AMPRENTE-NOI 20261131j'))
for (const [sem, cap] of CAP_NOI) {
  // o funcție lipsă (ex. proba rulată pe un head vechi) = verificare picată, nu cădere a probei
  let m = null
  try { m = md5(corp(MIG, cap)) } catch (e) { ok(false, `amprenta nouă ${sem}: ${e.message}`); continue }
  ok(blocNoi(MIG).includes(`('${sem}', '${m}'`) && blocNoi(REV).includes(`('${sem}', '${m}'`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
// pe un mutant: amprentele recalculate din corpurile mutate (ca să pice comportamentul, nu postcondiția de amprentă), DOAR în blocul AMPRENTE-NOI
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261131j'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261131j')
  const bloc = CAP_NOI.reduce((x, [sem, cap]) => x.replace(new RegExp(`(\\('${sem.replace(/[().,]/g, '\\$&')}', ')[0-9a-f]{32}`), `$1${md5(corp(t, cap))}`), t.slice(a, b))
  return t.slice(0, a) + bloc + t.slice(b)
}

// ── 0b. VALIDATORUL REAL al runnerului (scripts/livrare_validator.py), pe fișierele EXACTE din repo ──
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
console.log('0b. validatorul runnerului: migrarea (5000), revenirea (2000), fără plafon')
{
  ok(PLAFON_LIVRARE === 5000, `AG_PLAFON_MS = ${PLAFON_LIVRARE}`)
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.slice(0, 120))
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.slice(0, 120))
}

// ── conturile și datele (fictive, scrise de mână) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000000a1', ADMIN: '00000000-0000-0000-0000-0000000000a2', EDITOR: '00000000-0000-0000-0000-0000000000a3',
  VIEWER: '00000000-0000-0000-0000-0000000000a4', FARA: '00000000-0000-0000-0000-0000000000a5', EDITOR2: '00000000-0000-0000-0000-0000000000a6',
  EDITOR_P2: '00000000-0000-0000-0000-0000000000a7' }
const P = { P1: '00000000-0000-0000-0000-00000000b001', P2: '00000000-0000-0000-0000-00000000b002', P3: '00000000-0000-0000-0000-00000000b003',
  P4: '00000000-0000-0000-0000-00000000b004', P5: '00000000-0000-0000-0000-00000000b005', P6: '00000000-0000-0000-0000-00000000b006' }
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.ADMIN}', 'ADMIN', false), ('${U.EDITOR}', 'EDITOR', false),
  ('${U.VIEWER}', 'VIEWER', false), ('${U.FARA}', 'FARA', false), ('${U.EDITOR2}', 'EDITOR2', false), ('${U.EDITOR_P2}', 'EDITOR_P2', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ADMIN}', 'redari', 'admin'), ('${U.EDITOR}', 'redari', 'editor'),
  ('${U.VIEWER}', 'redari', 'viewer'), ('${U.FARA}', 'hr', 'admin'), ('${U.EDITOR2}', 'redari', 'editor'), ('${U.EDITOR_P2}', 'redari', 'editor');
INSERT INTO public.red_proiecte (id, cod, denumire, activ) VALUES ('${P.P1}', 'TEST-AI-1', 'Proiect de test 1', true), ('${P.P2}', 'TEST-AI-2', 'Proiect de test 2', true),
  ('${P.P3}', 'TEST-AI-3', 'Proiect inactiv', false), ('${P.P4}', 'TEST-AI-4', 'Plafon necunoscut', true), ('${P.P5}', 'TEST-AI-5', 'Plafon cost final', true),
  ('${P.P6}', 'TEST-AI-6', 'Fara drepturi', true);`
// drepturile acordate DUPĂ aplicare (ca postgres = coordonatorul, cu „da”-ul lui Răzvan)
const DREPTURI = `INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES
  ('${P.P1}', '${U.EDITOR}', 'import_verificare_ai'), ('${P.P3}', '${U.EDITOR}', 'import_verificare_ai'), ('${P.P4}', '${U.EDITOR}', 'import_verificare_ai'),
  ('${P.P5}', '${U.EDITOR}', 'import_verificare_ai'), ('${P.P1}', '${U.VIEWER}', 'import_verificare_ai'), ('${P.P1}', '${U.FARA}', 'import_verificare_ai'),
  ('${P.P2}', '${U.EDITOR_P2}', 'import_verificare_ai');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCH_A)
  await db.exec(SQL_FUNCTII)
  await db.exec(SCH_B)
  await db.exec(DATE)
  return db
}
// ca runnerul: plafon + marcaje + (opțional) pașii L15 v2 generați. l15: 'livrare' | 'inainte' | 'nimic'
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
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261131j_redari_import_verificare_ai', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261131j_redari_import_verificare_ai_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
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

// o instrucțiune ca rolul dat, cu JWT-ul contului (sub în request.jwt.claim.sub ȘI în claims, ca PostgREST); COMMIT la succes
async function ca(db, rol, uid, sql) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);${uid ? ` SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
const H = c => c.repeat(64)
// apelul RPC-ului de rezervare ca editorul / owner-ul; implicit: fișierul „a…”, conținutul „b…”, bucata 1 / 3, 50 rânduri, 10.000 octeți, 8.000 ieșire
const rezerva = (db, uid, o = {}) => {
  const x = { cheie: randomUUID(), proiect: P.P1, fisier: H('a'), continut: H('b'), bucata: 1, bucati: 3, randuri: 50, octeti: 10000, iesire: 8000, rol: 'authenticated', ...o }
  const v = k => x[k] === null ? 'NULL' : (typeof x[k] === 'number' ? String(x[k]) : lit(x[k]))
  return ca(db, x.rol, uid, `SELECT public.fn_red_import_ai_rezerva(${v('cheie')}, ${v('proiect')}, ${v('fisier')}, ${v('continut')}, ${v('bucata')}, ${v('bucati')}, ${v('randuri')}, ${v('octeti')}, ${v('iesire')}) AS r`)
}
const inchide = (db, rol, id, token, stare, { semnale = 'NULL', respinse = 'NULL', tin = 'NULL', tout = 'NULL', cod = 'NULL' } = {}) =>
  ca(db, rol, null, `SELECT public.fn_red_import_ai_inchide(${id ? lit(id) : 'NULL'}, ${token ? lit(token) : 'NULL'}, ${stare ? lit(stare) : 'NULL'}, ${semnale}, ${respinse}, ${tin}, ${tout}, ${cod === 'NULL' ? 'NULL' : lit(cod)}) AS r`)
const poate = (db, uid, proiect, rol = 'authenticated') => ca(db, rol, uid, `SELECT public.fn_red_import_ai_poate(${lit(proiect)}) AS r`)
const nrJurnal = async (db, unde = 'true') => (await db.query(`SELECT count(*)::int AS n FROM public.red_import_ai_jurnal WHERE ${unde}`)).rows[0].n
const rand = async (db, id) => (await db.query(`SELECT stare, user_id::text, ziua::text, cost_rezervat_usd::text AS rez, cost_usd::text AS cost, tokeni_in, tokeni_out, semnale, respinse, eroare_cod,
  inchis_la IS NOT NULL AS inchis, lease_token::text AS token, model, randuri, octeti_intrare, max_iesire FROM public.red_import_ai_jurnal WHERE id = $1`, [id])).rows[0]
// ziua de azi în Europe/Bucharest, calculată independent (JS, Intl), nu de codul testat (L17, L25)
const ZI_RO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
// umplerea jurnalului ca postgres (rânduri valide, pe CHECK-urile reale)
const umple = (db, proiect, n, { stare = 'rezervat', rez = '0.000010', cost = null, zi = 'azi', fisier = H('c') } = {}) => db.exec(`
  INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model,
    cost_rezervat_usd, lease_token, stare, inchis_la, semnale, respinse, tokeni_in, tokeni_out, cost_usd, eroare_cod)
  SELECT gen_random_uuid(), '${proiect}', '${U.OWNER}', (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date ${zi === 'ieri' ? "- 1" : ''}, '${fisier}', '${H('d')}', g, 100, 1, 1, 1,
    'claude-sonnet-5-5', ${rez}, gen_random_uuid(), '${stare}',
    ${stare === 'rezervat' ? 'NULL' : 'clock_timestamp()'}, ${stare === 'ok' ? '0' : 'NULL'}, ${stare === 'ok' ? '0' : 'NULL'}, ${stare === 'ok' ? '1' : 'NULL'}, ${stare === 'ok' ? '1' : 'NULL'},
    ${cost === null ? 'NULL' : cost}, ${stare === 'rezervat' || stare === 'ok' ? 'NULL' : "'test'"}
  FROM generate_series(1, ${n}) g;`)

// ── VERIFICĂRILE după migrare (și după acordarea drepturilor); întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  const val = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return undefined } return r.rows[0]?.r }
  // egalitate structurală (cheile obiectelor jsonb vin în ordinea Postgres, nu în cea scrisă aici)
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
  const egal = (x, y, ce) => { if (JSON.stringify(canon(x)) !== JSON.stringify(canon(y))) ab.push(`${ce}: ${JSON.stringify(x)} (aștepta ${JSON.stringify(y)})`) }
  await db.exec(DREPTURI)
  // A. dreptul (o singură definiție)
  for (const [uid, pr, astept, ce] of [[U.OWNER, P.P1, true, 'owner'], [U.OWNER, P.P6, true, 'owner, proiect fără drepturi'], [U.EDITOR, P.P1, true, 'editor cu drept'],
    [U.EDITOR2, P.P1, false, 'editor fără drept'], [U.VIEWER, P.P1, false, 'viewer cu drept'], [U.FARA, P.P1, false, 'fără nivel Redări, cu drept'],
    [U.ADMIN, P.P1, false, 'admin Redări fără drept'], [U.EDITOR_P2, P.P1, false, 'dreptul pe ALT proiect'], [U.EDITOR, P.P3, false, 'proiect inactiv'],
    [U.OWNER, P.P3, false, 'owner pe proiect inactiv'], [U.EDITOR, '00000000-0000-0000-0000-00000000bfff', false, 'proiect inexistent'], [null, P.P1, false, 'fără JWT (sub)']])
    egal(val(await poate(db, uid, pr), 'A ' + ce), astept, 'A ' + ce)
  asteptCod(await poate(db, null, P.P1, 'anon'), '42501', 'A anon cheamă fn_red_import_ai_poate')
  // B. rezervarea
  const n0 = await nrJurnal(db)
  egal(val(await rezerva(db, U.EDITOR2), 'B fără drept'), { ok: false, cod: 'fara_drept' }, 'B fără drept')
  egal(val(await rezerva(db, U.VIEWER), 'B viewer cu drept'), { ok: false, cod: 'fara_drept' }, 'B viewer cu drept')
  egal(val(await rezerva(db, U.EDITOR, { proiect: P.P3 }), 'B proiect inactiv'), { ok: false, cod: 'fara_drept' }, 'B proiect inactiv')
  egal(val(await rezerva(db, null), 'B fără JWT'), { ok: false, cod: 'neautentificat' }, 'B fără JWT')
  for (const [o, ce] of [[{ bucata: 0 }, 'bucata 0'], [{ bucata: 4 }, 'bucata > bucăți'], [{ bucati: 101 }, 'bucăți 101'], [{ randuri: 301 }, 'rânduri 301'], [{ randuri: 0 }, 'rânduri 0'],
    [{ octeti: 120001 }, 'octeți peste plafon'], [{ iesire: 16001 }, 'ieșire peste plafon'], [{ fisier: 'xyz' }, 'sha256 fișier invalid'], [{ continut: H('B') }, 'sha256 cu majuscule'],
    [{ cheie: null }, 'cheie lipsă'], [{ proiect: null }, 'proiect lipsă']])
    egal(val(await rezerva(db, U.EDITOR, o), 'B cerere invalidă: ' + ce), { ok: false, cod: 'cerere_invalida' }, 'B cerere invalidă: ' + ce)
  if (await nrJurnal(db) !== n0) ab.push('B refuzurile au scris în jurnal')
  asteptCod(await rezerva(db, null, { rol: 'service_role' }), '42501', 'B service_role cheamă rezerva')
  asteptCod(await rezerva(db, null, { rol: 'anon' }), '42501', 'B anon cheamă rezerva')
  const K1 = randomUUID()
  const r1 = val(await rezerva(db, U.EDITOR, { cheie: K1 }), 'B rezervarea editorului')
  if (!r1 || r1.ok !== true || r1.nou !== true || !r1.id || !r1.lease_token || r1.model !== 'claude-sonnet-5-5' || r1.cost_rezervat_usd !== 0.104 || r1.ziua !== ZI_RO)
    ab.push('B rezervarea: ' + JSON.stringify(r1) + ' (aștepta ok, nou, model, cost 0.104 = ((10000 + 2000) × 2 + 8000 × 10) / 1e6, ziua ' + ZI_RO + ')')
  const x1 = r1?.id ? await rand(db, r1.id) : null
  egal(x1 && [x1.stare, x1.user_id, x1.ziua, x1.rez, x1.cost, x1.inchis, x1.randuri, x1.octeti_intrare, x1.max_iesire, x1.token === r1.lease_token],
    ['rezervat', U.EDITOR, ZI_RO, '0.104000', null, false, 50, 10000, 8000, true], 'B rândul rezervat (user_id = sub-ul din JWT)')
  // L04: aceeași cheie + același conținut = rândul existent, nou = false, fără al doilea rând; alt conținut / alt cont = refuz
  const n1 = await nrJurnal(db)
  egal(val(await rezerva(db, U.EDITOR, { cheie: K1 }), 'B reluarea cu aceeași cheie'), { ok: true, nou: false, id: r1?.id, stare: 'rezervat' }, 'B reluarea cu aceeași cheie')
  egal(val(await rezerva(db, U.EDITOR, { cheie: K1, continut: H('e') }), 'B aceeași cheie, alt conținut'), { ok: false, cod: 'cheie_refolosita' }, 'B aceeași cheie, alt conținut')
  egal(val(await rezerva(db, U.OWNER, { cheie: K1 }), 'B aceeași cheie, alt cont'), { ok: false, cod: 'cheie_refolosita' }, 'B aceeași cheie, alt cont')
  egal(val(await rezerva(db, U.EDITOR, { cheie: K1, bucata: 2 }), 'B aceeași cheie, altă bucată'), { ok: false, cod: 'cheie_refolosita' }, 'B aceeași cheie, altă bucată')
  if (await nrJurnal(db) !== n1) ab.push('B reluarea / cheia refolosită a scris în jurnal')
  // plafonul pe CONȚINUT (r2, #1141): 2 / zi pe același continut_sha256 (amprenta funcției edge), ORICARE ar fi fișierul / bucata / cheia declarate
  // de client (reproducerea din verdict: același conținut cu bucata 1, 2, 3 și chei noi → al treilea refuzat); alt conținut pe aceeași bucată = permis
  egal(val(await rezerva(db, U.EDITOR, { bucata: 2, fisier: H('f') }), 'B același conținut, bucata 2, alt fișier, cheie nouă')?.nou, true, 'B a doua rezervare pe același conținut (bucata 2, alt fișier)')
  egal(val(await rezerva(db, U.EDITOR, { bucata: 3 }), 'B același conținut, bucata 3, cheie nouă'), { ok: false, cod: 'plafon_bucata_zi', limita: 2 }, 'B a treia rezervare pe același conținut (bucata 3, cheie nouă) = refuz')
  egal(val(await rezerva(db, U.EDITOR, { bucata: 1, bucati: 100, fisier: H('0') }), 'B același conținut, alt număr de bucăți / fișier'), { ok: false, cod: 'plafon_bucata_zi', limita: 2 }, 'B același conținut sub alt fișier / alt număr de bucăți = refuz')
  egal(val(await rezerva(db, U.EDITOR, { continut: H('e') }), 'B alt conținut, aceeași bucată 1 a aceluiași fișier')?.nou, true, 'B alt conținut pe aceeași bucată a aceluiași fișier = permis')
  egal(val(await rezerva(db, U.EDITOR, { continut: H('e'), bucata: 2 }), 'B al doilea pe conținutul e')?.nou, true, 'B al doilea apel pe conținutul e')
  egal(val(await rezerva(db, U.OWNER, { proiect: P.P6 }), 'B owner pe proiect fără drepturi')?.nou, true, 'B owner pe proiect fără drepturi (același conținut, alt proiect)')
  // plafonul de apeluri: 60 / zi / proiect (59 existente → al 60-lea trece, al 61-lea nu); rândurile de IERI nu contează
  await umple(db, P.P2, 59)
  await umple(db, P.P2, 30, { zi: 'ieri' })
  egal(val(await rezerva(db, U.EDITOR_P2, { proiect: P.P2 }), 'B al 60-lea apel')?.nou, true, 'B al 60-lea apel al zilei')
  egal(val(await rezerva(db, U.EDITOR_P2, { proiect: P.P2, bucata: 2 }), 'B al 61-lea apel'), { ok: false, cod: 'plafon_apeluri_zi', limita: 60 }, 'B al 61-lea apel al zilei')
  // plafonul de cost: 10 USD / zi / proiect; 'necunoscut' contează cu costul REZERVAT, 'ok' cu costul FINAL, ieri nu contează
  await umple(db, P.P4, 1, { stare: 'necunoscut', rez: '9.950000' })
  egal(val(await rezerva(db, U.EDITOR, { proiect: P.P4 }), 'B cost: necunoscut 9,95 + 0,104'), { ok: false, cod: 'plafon_cost_zi', limita_usd: 10 }, 'B cost: un apel necunoscut contează cu costul rezervat (9,95 + 0,104 > 10)')
  await umple(db, P.P5, 1, { stare: 'ok', rez: '9.950000', cost: '1.000000' })
  await umple(db, P.P5, 1, { stare: 'ok', rez: '9.990000', cost: '9.990000', zi: 'ieri' })
  egal(val(await rezerva(db, U.EDITOR, { proiect: P.P5 }), 'B cost: ok cu final 1')?.nou, true, 'B cost: un apel ok contează cu costul final (1 + 0,104 ≤ 10; rezervatul 9,95 și ziua de ieri nu)')
  await umple(db, P.P5, 1, { stare: 'eroare', rez: '0.500000', cost: '8.800000' })
  egal(val(await rezerva(db, U.EDITOR, { proiect: P.P5, bucata: 2 }), 'B cost: peste 10'), { ok: false, cod: 'plafon_cost_zi', limita_usd: 10 }, 'B cost: 1 + 0,104 + 8,8 + 0,104 > 10')
  // scrierea directă: niciun drept pentru rolurile aplicației
  for (const [sql, ce] of [[`INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model, cost_rezervat_usd, lease_token)
      VALUES (gen_random_uuid(), '${P.P1}', '${U.EDITOR}', current_date, '${H('a')}', '${H('b')}', 1, 1, 1, 1, 1, 'claude-sonnet-5-5', 1, gen_random_uuid())`, 'INSERT în jurnal'],
    [`UPDATE public.red_import_ai_jurnal SET stare = 'ok' WHERE id = '${r1?.id}'`, 'UPDATE pe jurnal'], [`DELETE FROM public.red_import_ai_jurnal`, 'DELETE din jurnal'],
    [`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P6}', '${U.EDITOR2}', 'import_verificare_ai')`, 'INSERT drept (auto-acordare)'],
    [`UPDATE public.red_proiect_drepturi SET proiect_id = '${P.P6}'`, 'UPDATE drept'], [`DELETE FROM public.red_proiect_drepturi`, 'DELETE drept']])
    for (const uid of [U.OWNER, U.EDITOR]) asteptCod(await ca(db, 'authenticated', uid, sql), '42501', `B ${ce} (${uid === U.OWNER ? 'owner' : 'editor'})`)
  asteptCod(await ca(db, 'service_role', null, `DELETE FROM public.red_import_ai_jurnal`), '42501', 'B DELETE din jurnal (service_role)')
  asteptCod(await ca(db, 'service_role', null, `INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P6}', '${U.EDITOR2}', 'import_verificare_ai')`), '42501', 'B INSERT drept (service_role)')
  // C. închiderea: doar service_role, CAS pe id + token + 'rezervat'
  asteptCod(await inchide(db, 'authenticated', r1?.id, r1?.lease_token, 'ok', { semnale: 1, respinse: 0, tin: 1, tout: 1 }), '42501', 'C authenticated cheamă inchide')
  asteptCod(await inchide(db, 'anon', r1?.id, r1?.lease_token, 'ok', { semnale: 1, respinse: 0, tin: 1, tout: 1 }), '42501', 'C anon cheamă inchide')
  egal(val(await inchide(db, 'service_role', r1?.id, randomUUID(), 'ok', { semnale: 1, respinse: 0, tin: 1, tout: 1 }), 'C token greșit'), false, 'C token greșit')
  for (const [stare, o, ce] of [['ok', { respinse: 0, tin: 1, tout: 1 }, 'ok fără semnale'], ['ok', { semnale: 1, respinse: 0, tin: 1 }, 'ok fără tokeni de ieșire'],
    ['ok', { semnale: 1, respinse: 0, tin: 1, tout: 1, cod: 'x' }, 'ok cu cod de eroare'], ['eroare', {}, 'eroare fără cod'], ['necunoscut', {}, 'necunoscut fără cod'],
    ['eroare', { cod: 'Cod Cu Spatii' }, 'cod invalid'], ['altceva', { cod: 'x' }, 'stare necunoscută'], ['rezervat', { cod: 'x' }, 'stare rezervat'],
    ['ok', { semnale: -1, respinse: 0, tin: 1, tout: 1 }, 'semnale negative'], ['eroare', { cod: 'x', tin: 1 }, 'doar tokenii de intrare']])
    egal(val(await inchide(db, 'service_role', r1?.id, r1?.lease_token, stare, o), 'C ' + ce), false, 'C parametri invalizi: ' + ce)
  // r3 (#1141 P2): „ok” = FĂRĂ respingeri; „incomplet” = cu respingeri (≥ 1) — combinațiile încrucișate sunt refuzate (false, nimic schimbat)
  for (const [stare, o, ce] of [['ok', { semnale: 3, respinse: 1, tin: 1, tout: 1 }, 'ok cu respinse 1'], ['incomplet', { semnale: 0, respinse: 0, tin: 1, tout: 1 }, 'incomplet cu respinse 0'],
    ['incomplet', { semnale: 0, tin: 1, tout: 1 }, 'incomplet fără respinse'], ['incomplet', { semnale: 0, respinse: 2 }, 'incomplet fără tokeni'],
    ['incomplet', { semnale: 0, respinse: 2, tin: 1, tout: 1, cod: 'x' }, 'incomplet cu cod de eroare'], ['incomplet', { respinse: 2, tin: 1, tout: 1 }, 'incomplet fără semnale']])
    egal(val(await inchide(db, 'service_role', r1?.id, r1?.lease_token, stare, o), 'C r3 ' + ce), false, 'C r3 parametri invalizi: ' + ce)
  egal(r1?.id && (await rand(db, r1.id)).stare, 'rezervat', 'C parametrii invalizi n-au schimbat rândul')
  egal(val(await inchide(db, 'service_role', r1?.id, r1?.lease_token, 'incomplet', { semnale: 3, respinse: 1, tin: 5000, tout: 300 }), 'C închiderea incomplet'), true, 'C r3 închiderea incomplet (respinse 1)')
  const x2 = r1?.id ? await rand(db, r1.id) : null
  egal(x2 && [x2.stare, x2.semnale, x2.respinse, x2.tokeni_in, x2.tokeni_out, x2.cost, x2.rez, x2.inchis, x2.eroare_cod],
    ['incomplet', 3, 1, 5000, 300, '0.013000', '0.104000', true, null], 'C r3 rândul închis incomplet: cost final cunoscut = 5000 × 2 + 300 × 10 USD / MTok = 0,013')
  egal(val(await inchide(db, 'service_role', r1?.id, r1?.lease_token, 'eroare', { cod: 'a_doua' }), 'C a doua închidere'), false, 'C a doua închidere (deja incomplet)')
  const r1b = val(await rezerva(db, U.EDITOR, { bucata: 2, continut: H('6') }), 'C rezervarea pentru ok')
  egal(val(await inchide(db, 'service_role', r1b?.id, r1b?.lease_token, 'ok', { semnale: 0, respinse: 0, tin: 4000, tout: 100 }), 'C închiderea ok'), true, 'C închiderea ok (gol valid, respinse 0)')
  const x2b = r1b?.id ? await rand(db, r1b.id) : null
  egal(x2b && [x2b.stare, x2b.semnale, x2b.respinse, x2b.cost, x2b.eroare_cod], ['ok', 0, 0, '0.009000', null], 'C rândul închis ok: respinse 0, cost 4000 × 2 + 100 × 10 = 0,009')
  // CHECK-ul tabelei, independent de funcție (postgres scrie direct): ok cu respinse > 0 și incomplet cu respinse 0 = refuzate
  for (const [stare, resp, ce] of [['ok', 1, 'ok cu respinse 1'], ['incomplet', 0, 'incomplet cu respinse 0']]) {
    const e = await eroare(db.exec(`INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare, max_iesire, model,
      cost_rezervat_usd, lease_token, stare, inchis_la, semnale, respinse, tokeni_in, tokeni_out, cost_usd) VALUES (gen_random_uuid(), '${P.P6}', '${U.OWNER}', current_date, '${H('a')}', '${H('b')}',
      1, 1, 1, 1, 1, 'claude-sonnet-5-5', 1, gen_random_uuid(), '${stare}', clock_timestamp(), 0, ${resp}, 1, 1, 0.00001)`))
    egal(/red_import_ai_jurnal_inchidere_ck/.test(e || ''), true, `C r3 CHECK refuză ${ce} (${(e || 'A TRECUT').slice(0, 80)})`)
  }
  const r2 = val(await rezerva(db, U.EDITOR, { bucata: 3, continut: H('7') }), 'C rezervarea pentru necunoscut')
  egal(val(await inchide(db, 'service_role', r2?.id, r2?.lease_token, 'necunoscut', { cod: 'ai_timeout', tin: 10, tout: 10 }), 'C necunoscut'), true, 'C închiderea necunoscut')
  const x3 = r2?.id ? await rand(db, r2.id) : null
  egal(x3 && [x3.stare, x3.cost, x3.tokeni_in, x3.tokeni_out, x3.eroare_cod, x3.rez], ['necunoscut', null, null, null, 'ai_timeout', '0.104000'], 'C necunoscut: costul rămâne cel rezervat (cost_usd NULL)')
  const r3 = val(await rezerva(db, U.EDITOR, { bucata: 3, fisier: H('9'), continut: H('8') }), 'C rezervarea pentru eroare 4xx')
  egal(val(await inchide(db, 'service_role', r3?.id, r3?.lease_token, 'eroare', { cod: 'ai_http_4xx', tin: 0, tout: 0 }), 'C eroare 4xx'), true, 'C închiderea eroare (4xx, tokeni 0)')
  const x4 = r3?.id ? await rand(db, r3.id) : null
  egal(x4 && [x4.stare, x4.cost, x4.eroare_cod], ['eroare', '0.000000', 'ai_http_4xx'], 'C eroare cu tokeni cunoscuți: cost final 0')
  // D. RLS la citire: jurnalul — doar cine are dreptul pe proiect; drepturile — rândurile proprii + adminii Redări
  const vede = async (uid, sql) => { const r = await ca(db, 'authenticated', uid, sql); return r.code ? 'EROARE ' + r.code : r.rows.map(x => x.k).join(',') }
  const jP1 = `SELECT count(*)::text AS k FROM public.red_import_ai_jurnal WHERE proiect_id = '${P.P1}'`
  const totP1 = String(await nrJurnal(db, `proiect_id = '${P.P1}'`))
  egal([await vede(U.EDITOR, jP1), await vede(U.OWNER, jP1), await vede(U.EDITOR2, jP1), await vede(U.VIEWER, jP1), await vede(U.ADMIN, jP1), await vede(U.EDITOR_P2, jP1), await vede(null, jP1)],
    [totP1, totP1, '0', '0', '0', '0', '0'], 'D jurnalul P1: editorul cu drept / owner-ul îl văd; restul nu (nici fără JWT)')
  egal(await vede(U.EDITOR_P2, `SELECT count(*)::text AS k FROM public.red_import_ai_jurnal`), String(await nrJurnal(db, `proiect_id = '${P.P2}'`)), 'D editorul P2 vede doar jurnalul P2')
  const dr = `SELECT p.name AS k FROM public.red_proiect_drepturi d JOIN public.profiles p ON p.id = d.profile_id ORDER BY d.proiect_id, p.name`
  // profiles are RLS fără politică în schelet → join-ul nu vede nume; numărăm pe profile_id
  const drN = `SELECT d.profile_id::text || '@' || right(d.proiect_id::text, 1) AS k FROM public.red_proiect_drepturi d ORDER BY d.proiect_id, d.profile_id`
  void dr
  egal(await vede(U.EDITOR, drN), [`${U.EDITOR}@1`, `${U.EDITOR}@3`, `${U.EDITOR}@4`, `${U.EDITOR}@5`].join(','), 'D drepturile: editorul își vede doar rândurile lui')
  egal((await vede(U.ADMIN, drN)).split(',').length, 7, 'D drepturile: adminul Redări le vede pe toate (7)')
  egal(await vede(U.EDITOR2, drN), '', 'D drepturile: editorul fără drept nu vede nimic')
  egal(await vede(U.VIEWER, drN), `${U.VIEWER}@1`, 'D drepturile: viewerul își vede rândul')
  asteptCod(await ca(db, 'anon', null, drN), '42501', 'D anon citește drepturile')
  asteptCod(await ca(db, 'anon', null, jP1), '42501', 'D anon citește jurnalul')
  try { await verificaE(db, ab, { egal, asteptCod, vede }) } catch (e) { ab.push('E a căzut (obiect lipsă?): ' + e.message) }
  return ab
}
async function verificaE(db, ab, { egal, asteptCod, vede }) {
  // E. acordarea / retragerea (postgres) intră în ISTORICUL PROPRIU (r2, #1141), NU în red_jurnal (pe care îl citește orice nivel Redări, și viewer)
  // întâi reproducerea din verdict: după cele 7 acordări, viewerul / alt editor citesc red_jurnal → nicio urmă a drepturilor
  const jrD0 = `SELECT count(*)::text AS k FROM public.red_jurnal WHERE tabela = 'red_proiect_drepturi'`
  egal([await vede(U.VIEWER, jrD0), await vede(U.EDITOR2, jrD0)], ['0', '0'], 'E red_jurnal după acordări: viewerul și alt editor nu văd drepturile altora')
  const ist = async () => (await db.query(`SELECT actiune, count(*)::int AS n, count(autor_id)::int AS cu_autor FROM public.red_proiect_drepturi_istoric GROUP BY 1 ORDER BY 1`)).rows
  egal(await ist(), [{ actiune: 'acordat', n: 7, cu_autor: 0 }], 'E cele 7 acordări sunt în istoricul drepturilor (autor NULL = coordonatorul, postgres)')
  await db.exec(`DELETE FROM public.red_proiect_drepturi WHERE proiect_id = '${P.P1}' AND profile_id = '${U.FARA}'`)
  const jd = (await db.query(`SELECT count(*)::int AS n FROM public.red_proiect_drepturi_istoric WHERE actiune = 'retras' AND profile_id = '${U.FARA}' AND proiect_id = '${P.P1}' AND drept = 'import_verificare_ai'`)).rows[0].n
  egal(jd, 1, 'E retragerea e în istoricul drepturilor (rândul vechi: proiect, cont, drept)')
  egal((await db.query(`SELECT count(*)::int AS n FROM public.red_jurnal WHERE tabela = 'red_proiect_drepturi'`)).rows[0].n, 0, 'E NIMIC din drepturi în red_jurnal (nici acordările, nici retragerea)')
  // citirea ca alt editor / viewer (reproducerea din verdict): jurnalul general nu are nimic despre drepturi; istoricul = aceeași regulă ca dreptul
  const jrD = `SELECT count(*)::text AS k FROM public.red_jurnal WHERE tabela = 'red_proiect_drepturi'`
  egal([await vede(U.VIEWER, jrD), await vede(U.EDITOR2, jrD), await vede(U.EDITOR, jrD), await vede(U.ADMIN, jrD)], ['0', '0', '0', '0'], 'E red_jurnal: viewer / alt editor / editor / admin nu văd nicio urmă a drepturilor')
  const istN = `SELECT d.profile_id::text || '@' || right(d.proiect_id::text, 1) || ':' || d.actiune AS k FROM public.red_proiect_drepturi_istoric d ORDER BY d.proiect_id, d.profile_id, d.actiune`
  egal(await vede(U.EDITOR2, istN), '', 'E istoricul: alt editor (fără drept) nu vede nimic')
  egal(await vede(U.VIEWER, istN), `${U.VIEWER}@1:acordat`, 'E istoricul: viewerul își vede doar rândul lui')
  egal(await vede(U.EDITOR, istN), [`${U.EDITOR}@1:acordat`, `${U.EDITOR}@3:acordat`, `${U.EDITOR}@4:acordat`, `${U.EDITOR}@5:acordat`].join(','), 'E istoricul: editorul își vede doar rândurile lui (nu pe ale viewerului / altor conturi)')
  egal(await vede(U.EDITOR_P2, istN), `${U.EDITOR_P2}@2:acordat`, 'E istoricul: editorul P2 își vede doar rândul lui')
  egal((await vede(U.ADMIN, istN)).split(',').length, 8, 'E istoricul: adminul Redări le vede pe toate (7 acordări + 1 retragere)')
  egal((await vede(U.OWNER, istN)).split(',').length, 8, 'E istoricul: owner-ul (nivel admin) le vede pe toate')
  asteptCod(await ca(db, 'anon', null, istN), '42501', 'E anon citește istoricul')
  egal(await vede(null, istN), '', 'E istoricul fără JWT: nimic')
  // scrierea în istoric: niciun drept pentru rolurile aplicației; append-only și pentru postgres; drepturile: UPDATE / TRUNCATE refuzate
  asteptCod(await ca(db, 'authenticated', U.ADMIN, `INSERT INTO public.red_proiect_drepturi_istoric (drept_id, proiect_id, profile_id, drept, actiune) VALUES (gen_random_uuid(), '${P.P1}', '${U.EDITOR2}', 'import_verificare_ai', 'acordat')`), '42501', 'E INSERT în istoric (admin Redări)')
  asteptCod(await ca(db, 'service_role', null, `DELETE FROM public.red_proiect_drepturi_istoric`), '42501', 'E DELETE din istoric (service_role)')
  for (const [sql, ce] of [[`UPDATE public.red_proiect_drepturi_istoric SET actiune = 'acordat'`, 'UPDATE istoric'], [`DELETE FROM public.red_proiect_drepturi_istoric`, 'DELETE istoric'],
    [`TRUNCATE public.red_proiect_drepturi_istoric`, 'TRUNCATE istoric'], [`UPDATE public.red_proiect_drepturi SET nota = 'x'`, 'UPDATE drept (postgres)'],
    [`TRUNCATE public.red_proiect_drepturi`, 'TRUNCATE drepturi (postgres)']])
    egal(/refuzat/.test(await eroare(db.exec(sql)) || ''), true, `E ${ce}: refuzat`)
  egal((await ist()).map(x => [x.actiune, x.n]), [['acordat', 7], ['retras', 1]], 'E istoricul neschimbat după încercări (7 acordări + 1 retragere)')
  egal((await db.query(`SELECT count(*)::int AS n FROM public.red_proiect_drepturi`)).rows[0].n, 6, 'E drepturile neschimbate după UPDATE / TRUNCATE refuzate (6)')
  // unicitatea (proiect, cont, drept) și CHECK-ul dreptului
  egal(await eroare(db.exec(`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P1}', '${U.EDITOR}', 'import_verificare_ai')`)) !== null, true, 'E dreptul dublu refuzat (UNIQUE)')
  egal(await eroare(db.exec(`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P1}', '${U.EDITOR2}', 'alt_drept')`)) !== null, true, 'E drept necunoscut refuzat (CHECK)')
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)
const exista = async db => (await db.query(`SELECT (to_regclass('public.red_proiect_drepturi') IS NOT NULL)::int + (to_regclass('public.red_import_ai_jurnal') IS NOT NULL)::int
  + (to_regclass('public.red_proiect_drepturi_istoric') IS NOT NULL)::int
  + (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'fn_red_import_ai_%' OR proname = 'fn_red_proiect_drepturi_istoric') AS n`)).rows[0].n

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările de comportament')
{
  const db = await bazaNoua()
  const au = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m, (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(proacl::text[]) x)::text AS acl
    FROM pg_proc WHERE oid = 'auth.uid()'::regprocedure`)).rows[0]
  ok(au.m === 'cdef18c69c4f4cbbced2eaf81e628b49' && au.acl === '{=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin}',
    `auth.uid() din schelet = corpul + ACL-ul live: ${au.m} ${au.acl}`)
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18)
  if (process.argv.includes('--scrie-obiecte')) {
    writeFileSync(join(ROOT, F_OBIECTE), '# 20261131j: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
    OBIECTE = citeste(F_OBIECTE)
  }
  const revizuit = listaObiecte(OBIECTE)
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length >= 10 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  ok(await exista(db) === 0, 'generarea manifestului (ROLLBACK) nu a lăsat nimic')
  const fManifest = join(TMP, '20261131j_redari_import_verificare_ai.l15.tsv')
  writeFileSync(fManifest, manifest)
  let j = []
  try {
    j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda('20261131j_redari_import_verificare_ai', PLAFON_LIVRARE, 'COMMIT') })
  } catch (e) { console.log('     ' + e.message); (e.jurnal || []).slice(-5).forEach(m => console.log('     | ' + m.slice(0, 300))) }
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)), 'livrarea aprobată: diferența = manifestul')
  ok(j.some(m => /^PLAFON_TIMP 20261131j_redari_import_verificare_ai: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m))
    && j.some(m => /^LOCK_TINUT 20261131j_redari_import_verificare_ai: lock-urile puternice ale migrarii tinute \d+ ms/.test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT + lock-ul la prima încercare')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  await db.close()
}

console.log('2. aplicare -> revenire -> reaplicare -> revenire (bază nefolosită) + lock-urile ținute')
const LOCKS = `DO $l$ BEGIN RAISE NOTICE 'LOCKS %', (SELECT string_agg(c.relname || '=' || l.mode, ',' ORDER BY c.relname, l.mode) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
  WHERE l.pid = pg_backend_pid() AND l.granted AND c.relname IN ('red_proiecte', 'profiles')); END $l$;\nCOMMIT`
{
  const db = await bazaNoua()
  let j = await aplicaMig(db, MIG, { final: LOCKS })
  const lm = (j.find(m => m.startsWith('LOCKS ')) || '').slice(6)
  console.log('     lock-urile migrării pe red_proiecte / profiles: ' + lm)
  // AccessShare = citirile din gărzi / funcții; cel mai tare = SHARE ROW EXCLUSIVE (cerut de FK-urile noi), citirile din profiles / red_proiecte NU sunt oprite
  ok(lm === 'profiles=AccessShareLock,profiles=ShareRowExclusiveLock,red_proiecte=AccessShareLock,red_proiecte=ShareRowExclusiveLock',
    'migrarea: cel mai tare lock pe red_proiecte / profiles = SHARE ROW EXCLUSIVE (FK-urile), nu ACCESS EXCLUSIVE')
  ok(await exista(db) === 7, 'aplicată: 3 tabele + 4 funcții')
  j = await revino(db, REV, { final: LOCKS })
  const lr = (j.find(m => m.startsWith('LOCKS ')) || '').slice(6)
  console.log('     lock-urile revenirii pe red_proiecte / profiles (după DROP, înainte de COMMIT): ' + lr)
  // scoaterea FK-urilor cere ACCESS EXCLUSIVE pe tabelele referite: revenirea îl ia EXPLICIT, NOWAIT, în buget (nu îl așteaptă implicit în DROP)
  ok(/^profiles=AccessExclusiveLock(,profiles=[A-Za-z]+Lock)*,red_proiecte=AccessExclusiveLock(,red_proiecte=[A-Za-z]+Lock)*$/.test(lr || ''),
    'revenirea: ACCESS EXCLUSIVE pe red_proiecte / profiles (cerut de DROP-ul FK-urilor): ' + lr)
  ok(/LOCK TABLE public\.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n\s+LOCK TABLE public\.profiles IN ACCESS EXCLUSIVE MODE NOWAIT;/.test(REV),
    'revenirea ia ACCESS EXCLUSIVE pe red_proiecte / profiles în bucla cu buget (NOWAIT), înaintea DROP-urilor')
  ok(await exista(db) === 0, 'revenirea: nimic rămas')
  const fk = (await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE confrelid IN ('public.red_proiecte'::regclass, 'public.profiles'::regclass) AND conrelid NOT IN ('public.user_module_access'::regclass)`)).rows[0].n
  ok(fk === 0, 'revenirea: niciun FK rămas spre red_proiecte / profiles')
  await aplicaMig(db)
  ok(await exista(db) === 7, 'reaplicarea pe baza nefolosită')
  const r = await rezerva(db, U.OWNER)
  ok(!r.code && r.rows[0].r.nou === true, 'reaplicarea: owner-ul rezervă (dreptul merge)')
  await db.exec(`DELETE FROM public.red_import_ai_jurnal`)   // postgres (curățenie de test): baza redevine nefolosită
  await revino(db)
  ok(await exista(db) === 0, 'a doua revenire')
  await db.close()
}

console.log('3. refuzurile revenirii (ISTORIC_NOU și starea; nimic schimbat)')
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261131j \(pasul 1/],
  ['un drept acordat', async db => { await aplicaMig(db); await db.exec(`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P1}', '${U.EDITOR}', 'import_verificare_ai')`) }, {}, /ISTORIC_NOU/],
  ['un apel în jurnalul AI (owner)', async db => { await aplicaMig(db); const r = await rezerva(db, U.OWNER); if (r.code || r.rows[0].r.nou !== true) throw new Error('rezervarea n-a mers') }, {}, /ISTORIC_NOU/],
  ['un drept acordat și retras (urma din istoricul drepturilor)', async db => {
    await aplicaMig(db)
    await db.exec(`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P1}', '${U.EDITOR}', 'import_verificare_ai'); DELETE FROM public.red_proiect_drepturi;`)
  }, {}, /ISTORIC_NOU/],
  ['fără plafon', async db => aplicaMig(db), { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['fără marcajul runnerului', async db => aplicaMig(db), { marcaj: false }, /garda invalida/],
  ['rezerva schimbată după aplicare', async db => {
    await aplicaMig(db)
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_import_ai_rezerva(p_cheie uuid, p_proiect uuid, p_fisier_sha256 text, p_continut_sha256 text, p_bucata integer, p_bucati integer,
      p_randuri integer, p_octeti integer, p_max_iesire integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;`)
  }, {}, /starea nu e cea din 20261131j \(pasul 1, functii: public\.fn_red_import_ai_rezerva/],
  ['inchide primită de authenticated', async db => { await aplicaMig(db); await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_import_ai_inchide(uuid, uuid, text, integer, integer, integer, integer, text) TO authenticated`) }, {},
    /starea nu e cea din 20261131j \(pasul 1, functii: drepturi/],
  ['o politică în plus pe jurnal', async db => { await aplicaMig(db); await db.exec(`CREATE POLICY x_ins ON public.red_import_ai_jurnal FOR INSERT TO authenticated WITH CHECK (true)`) }, {}, /starea nu e cea din 20261131j/],
  ['triggerul istoricului dezactivat', async db => { await aplicaMig(db); await db.exec(`ALTER TABLE public.red_proiect_drepturi DISABLE TRIGGER trg_red_proiect_drepturi_istoric`) }, {}, /starea nu e cea din 20261131j/],
  ['un trigger în plus spre red_jurnal pe drepturi', async db => { await aplicaMig(db); await db.exec(`CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiect_drepturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal()`) }, {}, /starea nu e cea din 20261131j/],
]) {
  const db = await bazaNoua()
  let mp = null
  try { await pregatire(db) } catch (e) { mp = e.message }
  const inainte = await exista(db)
  const m = await eroare(revino(db, REV, o))
  ok(!mp && m && re.test(m) && await exista(db) === inainte, `${nume}: ${mp ? 'PREGĂTIREA A PICAT ' + mp : m ? m.slice(0, 160) : 'A TRECUT'}`)
  await db.close()
}

console.log('3b. MUTANTUL revenirii: fără verificarea istoricului drepturilor, un drept acordat și retras NU mai e refuzat (deci verificarea e necesară)')
{
  const db = await bazaNoua()
  await aplicaMig(db)
  await db.exec(`INSERT INTO public.red_proiect_drepturi (proiect_id, profile_id, drept) VALUES ('${P.P1}', '${U.EDITOR}', 'import_verificare_ai'); DELETE FROM public.red_proiect_drepturi;`)
  let t = null
  try { t = aplica(REV, [['       OR EXISTS (SELECT 1 FROM public.red_proiect_drepturi_istoric)\n', '']]) } catch (e) { ok(false, 'mutantul revenirii nu se aplică: ' + e.message) }
  if (t) { const m = await eroare(revino(db, t)); ok(!m && await exista(db) === 0, 'MUTANT revenire fără istoric: trece (și ar șterge istoricul) — ' + (m ? m.slice(0, 120) : 'deci proba de la 3 e prinsă de verificarea istoricului')) }
  await db.close()
}

console.log('4. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul revenirii (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['pasul „înainte” dintr-o tranzacție anterioară', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  ['sesiunea de livrare cu JWT', db => aplicaMig(db, `SELECT set_config('request.jwt.claims', '{"sub":"${U.OWNER}","role":"authenticated"}', true);\n` + MIG), /sesiunea de livrare are JWT/],
  ['fn_red_nivel cu altă amprentă (corp străin)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ SELECT 'admin'::text $fn$;`)
    return aplicaMig(db)
  }, /functiile chemate nu au amprenta revizuita: public\.fn_red_nivel\(\)/],
  ['fn_red_nivel primită de anon', async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO anon`); return aplicaMig(db) }, /functiile chemate nu au amprenta revizuita: public\.fn_red_nivel\(\)/],
  ['o funcție cu numele nou existentă (altă semnătură)', async db => { await db.exec(`CREATE FUNCTION public.fn_red_import_ai_poate(text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;`); return aplicaMig(db) }, /reaplicare/],
  ['o funcție cu numele triggerului istoricului existentă', async db => { await db.exec(`CREATE FUNCTION public.fn_red_proiect_drepturi_istoric(int) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`); return aplicaMig(db) }, /reaplicare/],
  ['red_proiecte.activ lipsă', async db => { await db.exec(`ALTER TABLE public.red_proiecte DROP COLUMN activ`); return aplicaMig(db) }, /coloane lipsa \/ alt tip: red_proiecte\.activ/],
  ['setul de lock-uri obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    '      LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])), /BUGET_LOCK: lock-urile obtinute abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n      EXIT;\n"]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  const m = await eroare(fn(db))
  const noi = (await db.query(`SELECT (to_regclass('public.red_proiect_drepturi') IS NOT NULL)::int + (to_regclass('public.red_import_ai_jurnal') IS NOT NULL)::int
    + (to_regclass('public.red_proiect_drepturi_istoric') IS NOT NULL)::int AS n`)).rows[0].n
  ok(m && re.test(m) && noi === 0, `${nume}: ${m ? m.slice(0, 160) : 'A TRECUT'}${noi === 0 ? '' : ' (STAREA S-A SCHIMBAT)'}`)
  await db.close()
}

// ── 4b. r3 (#1141): proba pe CLONĂ (supabase/tests/20261131j_redari_import_ai_clona.sql) rulată aici, ca să-i verificăm logica înainte de clonă:
//    meta-comenzile psql (\set / \if / :'var') expandate de mână, schema completată cu ce are clona în plus (auth.users, profiles.role) ──
const F_CLONA = 'supabase/tests/20261131j_redari_import_ai_clona.sql'
function clonaPeSql(text, clona = 'da') {
  const vars = { clona }, out = []
  let sari = 0
  for (const l of text.split('\n')) {
    if (/^\\if /.test(l)) { sari = 1; continue }
    if (sari) { if (/^\\endif/.test(l)) sari = 0; continue }
    if (/^\\set ON_ERROR_STOP/.test(l)) continue
    const m = /^\\set (\w+) (.*)$/.exec(l)
    if (m) { const v = m[2].trim(); vars[m[1]] = v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v; continue }
    out.push(l.replace(/:'(\w+)'/g, (x, n) => { if (!(n in vars)) throw new Error('variabila psql nedefinita: ' + n); return lit(vars[n]) }))
  }
  return out.join('\n')
}
const POL_IST_CAP_4B = 'CREATE POLICY red_proiect_drepturi_istoric_sel ON public.red_proiect_drepturi_istoric FOR SELECT TO authenticated\n'
const POL_DREPT_USING_4B = "  USING ((SELECT auth.uid()) IS NOT NULL AND (profile_id = (SELECT auth.uid()) OR (SELECT public.fn_red_nivel()) = 'admin'));"
const POST_POL_OFF_4B = ["  IF v_rau IS DISTINCT FROM\n       'red_import_ai_jurnal.red_import_ai_jurnal_sel", "  IF v_rau IS NULL AND v_rau IS DISTINCT FROM\n       'red_import_ai_jurnal.red_import_ai_jurnal_sel"]
const SHIM_CLONA = `CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;`
async function ruleazaClona(db, text, clona) {
  const note = []
  let m = null
  try { await db.exec(clonaPeSql(text, clona), { onNotice: n => note.push(n.message) }) } catch (e) { m = e.message; try { await db.exec('ROLLBACK') } catch { /* deja */ } }
  return { note, m, verdict: (note.map(x => x.match(/^CLONA 20261131j: verificari=(\d+) esec=(\d+) verdict=(\w+)/)).find(Boolean) || []) }
}
console.log('4b. proba pe clonă (fișierul din supabase/tests), rulată pe PGlite: verdict OK pe migrarea reală, ESEC pe un mutant, refuz fără clona=da')
{
  let TEXT_CLONA = null
  try { TEXT_CLONA = citeste(F_CLONA) } catch (e) { ok(false, 'proba pe clonă lipsește: ' + e.message) }
  if (TEXT_CLONA) {
    const db = await bazaNoua()
    await db.exec(SHIM_CLONA)
    await aplicaMig(db)
    const inainte = (await db.query(`SELECT (SELECT count(*) FROM public.red_import_ai_jurnal) + (SELECT count(*) FROM public.red_proiect_drepturi_istoric) + (SELECT count(*) FROM public.red_proiecte) AS n`)).rows[0].n
    const r = await ruleazaClona(db, TEXT_CLONA)
    r.note.filter(x => /^NU /.test(x)).forEach(x => console.log('     ' + x))
    ok(!r.m && r.verdict[3] === 'OK' && Number(r.verdict[1]) >= 80 && r.verdict[2] === '0' && !r.note.some(x => /^NU /.test(x)),
      `proba pe clonă pe migrarea reală: ${r.m ? 'A CĂZUT ' + r.m.slice(0, 160) : `verificari=${r.verdict[1]} esec=${r.verdict[2]} verdict=${r.verdict[3]}`}`)
    const dupa = (await db.query(`SELECT (SELECT count(*) FROM public.red_import_ai_jurnal) + (SELECT count(*) FROM public.red_proiect_drepturi_istoric) + (SELECT count(*) FROM public.red_proiecte) AS n`)).rows[0].n
    ok(dupa === inainte, `proba pe clonă: ROLLBACK — nimic rămas (${inainte} → ${dupa})`)
    const r2 = await ruleazaClona(db, TEXT_CLONA, 'nu')
    ok(/doar pe clona/.test(r2.m || ''), 'proba pe clonă fără -v clona=da: refuz (' + (r2.m || 'A TRECUT').slice(0, 80) + ')')
    await db.close()
    // mutantul „ok acceptă respinse > 0” (funcția + CHECK) → proba pe clonă trebuie să dea ESEC
    const db2 = await bazaNoua()
    await db2.exec(SHIM_CLONA)
    await aplicaMig(db2, recalculeaza(aplica(MIG, [["     OR (p_stare = 'ok' AND p_respinse IS DISTINCT FROM 0)\n", ''], ['semnale IS NOT NULL AND respinse = 0 AND', 'semnale IS NOT NULL AND respinse IS NOT NULL AND']])))
    const r3 = await ruleazaClona(db2, TEXT_CLONA)
    ok(!r3.m && r3.verdict[3] === 'ESEC' && r3.note.some(x => /^NU {2}C r3 ok cu respinse 1/.test(x)), `proba pe clonă pe MUTANTUL „ok cu respinse”: ${r3.m ? 'A CĂZUT ' + r3.m.slice(0, 120) : 'verdict=' + r3.verdict[3]}`)
    await db2.close()
    // mutantul „politica istoricului = cea a jurnalului general” → viewerul / alt editor ar vedea istoricul altuia
    const db3 = await bazaNoua()
    await db3.exec(SHIM_CLONA)
    await aplicaMig(db3, recalculeaza(aplica(MIG, [[POL_IST_CAP_4B + POL_DREPT_USING_4B, POL_IST_CAP_4B + '  USING ((SELECT public.fn_red_nivel()) IS NOT NULL);'], POST_POL_OFF_4B])))
    const r4 = await ruleazaClona(db3, TEXT_CLONA)
    ok(!r4.m && r4.verdict[3] === 'ESEC' && r4.note.some(x => /^NU {2}D istoricul: (alt editor|viewerul)/.test(x)), `proba pe clonă pe MUTANTUL „istoricul citibil de orice nivel Redări”: ${r4.m ? 'A CĂZUT ' + r4.m.slice(0, 120) : 'verdict=' + r4.verdict[3]}`)
    await db3.close()
  }
}

console.log('5. MUTANȚI (fiecare TREBUIE să pice: la verificările de comportament; amprentele recalculate)')
const POL_JURNAL = 'USING ((SELECT auth.uid()) IS NOT NULL AND public.fn_red_import_ai_poate(proiect_id));'
const POST_POL_JURNAL = "'red_import_ai_jurnal.red_import_ai_jurnal_sel|r|true|authenticated|((( SELECT auth.uid() AS uid) IS NOT NULL) AND fn_red_import_ai_poate(proiect_id))|;'"
// r2: textele unice ale politicilor / triggerelor noi și „oprirea” postcondițiilor (un mutant care schimbă intenționat o politică / un trigger trebuie
// să pice la COMPORTAMENT, nu la postcondiție)
const POL_DREPT_CAP = 'CREATE POLICY red_proiect_drepturi_sel ON public.red_proiect_drepturi FOR SELECT TO authenticated\n'
const POL_IST_CAP = 'CREATE POLICY red_proiect_drepturi_istoric_sel ON public.red_proiect_drepturi_istoric FOR SELECT TO authenticated\n'
const POL_DREPT_USING = "  USING ((SELECT auth.uid()) IS NOT NULL AND (profile_id = (SELECT auth.uid()) OR (SELECT public.fn_red_nivel()) = 'admin'));"
const TRG_ISTORIC = 'CREATE TRIGGER trg_red_proiect_drepturi_istoric AFTER INSERT OR DELETE ON public.red_proiect_drepturi\n'
const POST_POL_OFF = ["  IF v_rau IS DISTINCT FROM\n       'red_import_ai_jurnal.red_import_ai_jurnal_sel", "  IF v_rau IS NULL AND v_rau IS DISTINCT FROM\n       'red_import_ai_jurnal.red_import_ai_jurnal_sel"]
const POST_TRG_OFF = ["  IF v_rau IS DISTINCT FROM 'red_proiect_drepturi.trg_red_proiect_drepturi_fara_update", "  IF v_rau IS NULL AND v_rau IS DISTINCT FROM 'red_proiect_drepturi.trg_red_proiect_drepturi_fara_update"]
const POST_TAB_OFF = ["  IF v_rau IS DISTINCT FROM 'red_import_ai_jurnal|true|false|postgres|", "  IF v_rau IS NULL AND v_rau IS DISTINCT FROM 'red_import_ai_jurnal|true|false|postgres|"]
const MUTANTI = [
  ['rezerva fără verificarea dreptului', [["  IF public.fn_red_import_ai_poate(p_proiect) IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'cod', 'fara_drept'); END IF;\n", '']]],
  ['plafonul bucății 2 → 3', [["  IF v_n >= 2 THEN RETURN jsonb_build_object('ok', false, 'cod', 'plafon_bucata_zi', 'limita', 2); END IF;", "  IF v_n >= 3 THEN RETURN jsonb_build_object('ok', false, 'cod', 'plafon_bucata_zi', 'limita', 2); END IF;"]]],
  ['plafonul apelurilor 60 → 61', [["  IF v_n >= 60 THEN", "  IF v_n >= 61 THEN"]]],
  ['plafonul de cost fără costul rezervat al necunoscutelor', [['coalesce(sum(coalesce(j.cost_usd, j.cost_rezervat_usd)), 0)', 'coalesce(sum(coalesce(j.cost_usd, 0)), 0)']]],
  ['plafonul de cost pe costul rezervat (nu pe cel final)', [['coalesce(sum(coalesce(j.cost_usd, j.cost_rezervat_usd)), 0)', 'coalesce(sum(j.cost_rezervat_usd), 0)']]],
  ['ziua în UTC / fără fus', [["  v_zi := (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;", "  v_zi := (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date + 2;"]]],
  ['comparația cheii fără continut_sha256', [['       OR v_r.continut_sha256 IS DISTINCT FROM p_continut_sha256 OR v_r.bucata IS DISTINCT FROM p_bucata', '       OR v_r.bucata IS DISTINCT FROM p_bucata']]],
  ['comparația cheii fără utilizator', [['    IF v_r.user_id IS DISTINCT FROM v_uid OR v_r.proiect_id IS DISTINCT FROM p_proiect OR v_r.fisier_sha256', '    IF v_r.proiect_id IS DISTINCT FROM p_proiect OR v_r.fisier_sha256']]],
  ['costul rezervat fără ieșire', [['  v_cost := round(((p_octeti + 2000) * 2.0 + p_max_iesire * 10.0) / 1000000.0, 6);', '  v_cost := round(((p_octeti + 2000) * 2.0) / 1000000.0, 6);']]],
  ['inchide fără condiția stare = rezervat', [["   WHERE j.id = p_id AND j.lease_token = p_token AND j.stare = 'rezervat';", '   WHERE j.id = p_id AND j.lease_token = p_token;']]],
  ['inchide fără lease_token', [["   WHERE j.id = p_id AND j.lease_token = p_token AND j.stare = 'rezervat';", "   WHERE j.id = p_id AND j.stare = 'rezervat';"]]],
  ['inchide: costul final fără ieșire', [['round((p_tokeni_in * 2.0 + p_tokeni_out * 10.0) / 1000000.0, 6)', 'round((p_tokeni_in * 2.0) / 1000000.0, 6)']]],
  ['inchide: necunoscut cu cost 0', [["cost_usd = CASE WHEN p_stare <> 'necunoscut' AND p_tokeni_in IS NOT NULL THEN", 'cost_usd = CASE WHEN p_tokeni_in IS NOT NULL THEN']]],
  ['poate fără condiția nivel admin/editor', [["coalesce(public.fn_red_nivel() IN ('admin', 'editor'), false)\n              AND ", '']]],
  ['poate fără coalesce (NULL în loc de false pentru un cont fără nivel Redări)', [["coalesce(public.fn_red_nivel() IN ('admin', 'editor'), false)", "public.fn_red_nivel() IN ('admin', 'editor')"]]],
  ['poate fără activ', [[' AND pr.activ IS TRUE)', ')']]],
  ['poate fără proiectul dreptului', [['WHERE d.proiect_id = p_proiect AND d.profile_id = auth.uid()', 'WHERE d.profile_id = auth.uid()']]],
  ['politica jurnalului USING (true) (postcondiția ajustată)', [[POL_JURNAL, 'USING (true);'], [POST_POL_JURNAL, "'red_import_ai_jurnal.red_import_ai_jurnal_sel|r|true|authenticated|true|;'"]]],
  ['politica drepturilor: toți văd tot (postcondiția ajustată)', [[POL_DREPT_CAP + POL_DREPT_USING, POL_DREPT_CAP + '  USING (true);'], POST_POL_OFF]],
  // r2 (#1141): plafonul pe conținut, istoricul drepturilor cu RLS-ul dreptului, fără copie în red_jurnal
  ['plafonul bucății pe fișier + bucată declarate de client (r1)', [['   WHERE j.proiect_id = p_proiect AND j.continut_sha256 = p_continut_sha256 AND j.ziua = v_zi;',
    '   WHERE j.proiect_id = p_proiect AND j.fisier_sha256 = p_fisier_sha256 AND j.bucata = p_bucata AND j.ziua = v_zi;']]],
  ['drepturile copiate și în red_jurnal (r1; postcondiția ajustată)', [[TRG_ISTORIC, 'CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiect_drepturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();\n' + TRG_ISTORIC], POST_TRG_OFF]],
  ['politica istoricului USING (true) (postcondiția ajustată)', [[POL_IST_CAP + POL_DREPT_USING, POL_IST_CAP + '  USING (true);'], POST_POL_OFF]],
  ['politica istoricului = cea a jurnalului general (orice nivel Redări; postcondiția ajustată)', [[POL_IST_CAP + POL_DREPT_USING, POL_IST_CAP + '  USING ((SELECT public.fn_red_nivel()) IS NOT NULL);'], POST_POL_OFF]],
  ['istoricul fără retragere', [["    VALUES (OLD.id, OLD.proiect_id, OLD.profile_id, OLD.drept, OLD.nota, 'retras', auth.uid());", "    NULL;"],
    ["    INSERT INTO public.red_proiect_drepturi_istoric (drept_id, proiect_id, profile_id, drept, nota, actiune, autor_id)\n    NULL;", '    NULL;']]],
  ['drepturile: UPDATE permis (fără triggerul de refuz; postcondiția ajustată)', [["CREATE TRIGGER trg_red_proiect_drepturi_fara_update BEFORE UPDATE OR TRUNCATE ON public.red_proiect_drepturi\n  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_proiect_drepturi_istoric();\n", ''], POST_TRG_OFF]],
  ['istoricul fără imuabilitate (postcondiția ajustată)', [["CREATE TRIGGER trg_red_proiect_drepturi_istoric_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE ON public.red_proiect_drepturi_istoric\n  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_proiect_drepturi_istoric();\n", ''], POST_TRG_OFF]],
  // (un INSERT acordat lui authenticated NU e mutant util: RLS-ul fără politică de INSERT îl refuză oricum cu 42501 — dublă protecție)
  ['istoricul citibil de anon (postcondiția ajustată)', [['GRANT SELECT ON public.red_proiect_drepturi_istoric TO authenticated, service_role;', 'GRANT SELECT ON public.red_proiect_drepturi_istoric TO anon, authenticated, service_role;'], POST_TAB_OFF]],
  // r3 (#1141 P2): „ok” doar fără respingeri, „incomplet” doar cu respingeri (funcția ȘI CHECK-ul mutate împreună, ca mutantul să ajungă la comportament)
  ['ok acceptă respinse > 0 (r2: o respingere închisă ca ok)', [["     OR (p_stare = 'ok' AND p_respinse IS DISTINCT FROM 0)\n", ''], ['semnale IS NOT NULL AND respinse = 0 AND', 'semnale IS NOT NULL AND respinse IS NOT NULL AND']]],
  ['incomplet acceptă respinse 0', [["     OR (p_stare = 'incomplet' AND p_respinse < 1)\n", ''], ['semnale IS NOT NULL AND respinse >= 1 AND', 'semnale IS NOT NULL AND respinse IS NOT NULL AND']]],
  ['închiderea fără starea incomplet', [["p_stare NOT IN ('ok', 'incomplet', 'eroare', 'necunoscut')", "p_stare NOT IN ('ok', 'eroare', 'necunoscut')"]]],
]
for (const [nume, lista] of MUTANTI) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = false, cum
  if (m) cum = 'NU A AJUNS LA COMPORTAMENT (aplicarea a picat): ' + m.slice(0, 120)
  else { const ab = await verifica(db); prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 110)})` }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}
console.log('     (omis: rezerva fără lock consultativ — PGlite are o singură conexiune, efectul cere două sesiuni concurente; de probat pe clonă)')

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
