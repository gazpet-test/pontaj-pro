// Proba LOCALĂ a migrării 20261226a (Redări: declarația „predare” + opțiunea retrasă nu_particip_cu_obiectii) pe PGlite (Postgres în WASM, în
// memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261226a_redari_predare_schelet.sql + funcțiile extrase EXACT din migrările lor (20261126a, 27a, 29g, 30j,
//   30k, 30m, 31c); amprentele celor folosite de gărzi = constantele din 20261226a (verificat la pasul 0).
// Aplicarea: ca runnerul — marcaj + plafon 5000 (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: întâi generarea
//   manifestului (GLOBAL aprobat „-”, ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și garda
//   finală REALĂ a runnerului (lm_fin) + COMMIT. Lista obiectelor = supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv.
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul real al fiecărei căi (anon prin RPC-ul public, authenticated cu JWT —
//    operatorul prin API —, service_role, postgres): codul retras refuzat la INSERT pe fiecare cale și la UPDATE către el; UPDATE pe alt câmp
//    al unui rând vechi cu codul — permis; celelalte trei opțiuni neschimbate (regresia regulilor existente); RPC-ul: același refuz
//    'optiune_invalida' ca pentru o opțiune necunoscută (aceleași contoare, nimic scris); declarația: DEFAULT, rândurile cu EXACT VECHI,
//    proiectul cu text personalizat neatins, evidența din red_jurnal.
// 2. Aplicare -> revenire -> reaplicare -> revenire: revenirea NU atinge proiectele editate între timp sau create după migrare.
// 3. Refuzurile migrării și ale revenirii. 4. MUTANȚI: fiecare TREBUIE să pice.
// Ce NU probează PGlite (o singură conexiune): concurența reală (lock-ul pe red_proiecte ținut de altă sesiune) — pe clonă, coordonatorul.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_predare_declaratie_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'predare_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20261226a_redari_predare_declaratie.sql'
const F_REV = 'supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql'
const SCHELET = citeste('supabase/tests/20261226a_redari_predare_schelet.sql')
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const OBIECTE = citeste('supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv')
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const VECHI = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
const NOU = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
const MESAJ_OP = /optiunea nu_particip_cu_obiectii nu se mai accepta pentru raspunsuri noi; cine are obiectii vine la sesiune sau cere constatare pe teren/

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
const M26 = M('20261126a_redari_teren.sql'), M27 = M('20261127a_redari_uat_setari.sql'), M29G = M('20261129g_redari_tronson_optional.sql')
const M30J = M('20261130j_redari_mail_f1_schema.sql'), M30K = M('20261130k_redari_mail_f1_reguli.sql'), M30M = M('20261130m_redari_autorizare_tgz.sql')
const M31C = M('20261131c_redari_poarta_utilizatori.sql')
const FUNCTII = [
  [M26, 'CREATE FUNCTION public.fn_red_nivel()'], [M26, 'CREATE FUNCTION public.fn_red_jurnal_imuabil()'],
  [M26, 'CREATE FUNCTION public.fn_red_raspunsuri_valideaza()', '3528222d7d8379dbbe8f3d2e64c60b94'],
  [M26, 'CREATE FUNCTION public.fn_red_ip_client()'], [M26, 'CREATE FUNCTION public.fn_red_rate_limit_atinge('],
  [M26, 'CREATE FUNCTION public.fn_red_rate_limit_curata('],
  [M26, 'CREATE FUNCTION public.fn_red_raspuns_public(', '230aa93e36c8d9b5f9ac5f3afc0066ad'],
  [M27, 'CREATE FUNCTION public.fn_red_versiune_creste()', 'e7ab9318de671f0a94c678ee382250db'],
  [M29G, 'CREATE OR REPLACE FUNCTION public.fn_red_legaturi()'],
  [M30J, 'CREATE OR REPLACE FUNCTION public.fn_red_jurnal()', '41ab451b7fcb499a2284c9c82367069e'],
  [M30K, 'CREATE FUNCTION public.fn_red_mail_proiect_retentie()'], [M30M, 'CREATE FUNCTION public.fn_red_autorizare_tgz_garda()'],
  [M31C, 'CREATE FUNCTION public.fn_red_proiect_utilizatori_garda()'],
]
console.log('0. funcțiile extrase din migrările lor (amprentele = constantele din 20261226a / revenire)')
let SQL_FUNCTII = ''
for (const [text, cap, amp] of FUNCTII) {
  if (amp) {
    const m = md5(corp(text, cap))
    ok(m === amp && MIG.includes(`'${amp}'`), `${cap.replace(/^CREATE (OR REPLACE )?FUNCTION /, '')}: ${m} (în migrare: ${MIG.includes(`'${amp}'`)})`)
  }
  SQL_FUNCTII += functie(text, cap) + '\n'
}
// ACL-urile de pe live (20261126a §7, 20261127a, 20261130j/k/m, 20261131c): doar proprietarul, în afară de cele expuse
SQL_FUNCTII += `REVOKE ALL ON FUNCTION public.fn_red_nivel(), public.fn_red_jurnal_imuabil(), public.fn_red_raspunsuri_valideaza(), public.fn_red_ip_client(),
  public.fn_red_rate_limit_atinge(text, integer), public.fn_red_rate_limit_curata(boolean), public.fn_red_raspuns_public(text, text, date, text, boolean, text),
  public.fn_red_versiune_creste(), public.fn_red_legaturi(), public.fn_red_jurnal(), public.fn_red_mail_proiect_retentie(), public.fn_red_autorizare_tgz_garda(),
  public.fn_red_proiect_utilizatori_garda(), public.fn_sms_e_owner() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text) TO anon, authenticated, service_role;\n`
const [SCH_A, SCH_B] = SCHELET.split('-- @@FUNCTII@@')
ok(SCH_B !== undefined, 'scheletul are marcajul funcțiilor')
ok(md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza()')) === '3528222d7d8379dbbe8f3d2e64c60b94'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_raspuns_public(')) === '230aa93e36c8d9b5f9ac5f3afc0066ad',
  'revenirea repune corpurile EXACTE din 20261126a (aceleași amprente)')
// amprentele corpurilor noi (blocul AMPRENTE-NOI 20261226a: aceleași în migrare și în revenire)
const CAP_NOI = [['public.fn_red_optiune_retrasa(text)', 'CREATE FUNCTION public.fn_red_optiune_retrasa('],
  ['public.fn_red_raspunsuri_valideaza()', 'CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza()'],
  ['public.fn_red_raspuns_public(text,text,date,text,boolean,text)', 'CREATE OR REPLACE FUNCTION public.fn_red_raspuns_public(']]
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261226a'), t.indexOf('-- <<< AMPRENTE-NOI 20261226a'))
for (const [sem, cap] of CAP_NOI) {
  const m = md5(corp(MIG, cap))
  ok(blocNoi(MIG).includes(`('${sem}', '${m}'`) && blocNoi(REV).includes(`('${sem}', '${m}'`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
// pe un mutant: amprentele recalculate din corpurile mutate (ca să pice testul de comportament, nu postcondiția de amprentă)
// DOAR în blocul AMPRENTE-NOI (garda de start păstrează amprentele 20261126a)
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261226a'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261226a')
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
console.log('0b. validatorul runnerului: migrarea (5000), revenirea (2000), acordul plafonului, fără plafon')
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
const U = { OWNER: '00000000-0000-0000-0000-0000000000a1', EDITOR: '00000000-0000-0000-0000-0000000000a3', VIEWER: '00000000-0000-0000-0000-0000000000a4',
  FARA: '00000000-0000-0000-0000-0000000000a5' }
const P = { P1: '00000000-0000-0000-0000-00000000b001', P2: '00000000-0000-0000-0000-00000000b002', P3: '00000000-0000-0000-0000-00000000b003' }
const D = n => `00000000-0000-0000-0000-0000000d${String(n).padStart(4, '0')}`
const TOK = Array.from({ length: 12 }, (_, i) => createHash('sha256').update('token-' + i).digest('base64url').slice(0, 43))
const R_OLD = '00000000-0000-0000-0000-0000000e0001', R_P = '00000000-0000-0000-0000-0000000e0002'
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.EDITOR}', 'EDITOR', false), ('${U.VIEWER}', 'VIEWER', false), ('${U.FARA}', 'FARA', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.EDITOR}', 'redari', 'editor'), ('${U.VIEWER}', 'redari', 'viewer'), ('${U.FARA}', 'hr', 'admin');
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('${P.P1}', 'TEST-PROIECT-1', 'Proiect de test 1'), ('${P.P2}', 'TEST-PROIECT-2', 'Proiect de test 2');
INSERT INTO public.red_proiecte (id, cod, denumire, text_declaratie) VALUES ('${P.P3}', 'TEST-PROIECT-3', 'Proiect cu text propriu', 'Text personalizat al proiectului (test).');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, sesiune_zi2) VALUES ('00000000-0000-0000-0000-00000000c001', '${P.P1}', 'Testeni', 'TST', current_date + 10, current_date + 11);
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela, tronson) VALUES ('00000000-0000-0000-0000-00000000d001', '${P.P1}', '00000000-0000-0000-0000-00000000c001', 'TST-0001', 1);
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate)
  SELECT ('00000000-0000-0000-0000-0000000d' || lpad(g::text, 4, '0'))::uuid, '00000000-0000-0000-0000-00000000d001', 'Persoana ' || g, 'PERSOANA ' || g, 'proprietar' FROM generate_series(1, 12) g;
INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la) VALUES
${TOK.map((t, i) => `  ('${D(i + 1)}', '${t}', now() + interval '30 days')`).join(',\n')};
-- răspunsurile vechi (înainte de migrare, pe regula veche): unul cu opțiunea retrasă (telefon), unul „particip”
INSERT INTO public.red_raspunsuri (id, detinator_id, canal, optiune, obiectii_text) VALUES ('${R_OLD}', '${D(1)}', 'telefon', 'nu_particip_cu_obiectii', 'Teren nivelat gresit (test)');
INSERT INTO public.red_raspunsuri (id, detinator_id, canal, optiune, zi_sesiune_aleasa) VALUES ('${R_P}', '${D(2)}', 'telefon', 'particip', current_date + 10);`

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
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261226a_redari_predare_declaratie', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261226a_redari_predare_declaratie_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
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

// o instrucțiune ca rolul dat, cu JWT-ul contului (COMMIT la succes, ca un apel PostgREST)
async function ca(db, rol, uid, sql) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);${uid ? ` SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const rpc = (db, tok, optiune, { zi = 'NULL', obiectii = null, decl = 'NULL' } = {}) =>
  ca(db, 'anon', null, `SELECT public.fn_red_raspuns_public(${lit(tok)}, ${optiune == null ? 'NULL' : lit(optiune)}, ${zi}, ${obiectii == null ? 'NULL' : lit(obiectii)}, ${decl}, 'test') AS r`)
const nrRasp = async (db, d) => Number((await db.query(`SELECT count(*) AS n FROM public.red_raspunsuri WHERE detinator_id = '${d}'`)).rows[0].n)
const contor = async (db, tok) => (await db.query(`SELECT numar FROM public.red_rate_limit WHERE cheie = 't:' || encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [tok])).rows[0]?.numar ?? 0
const proiect = async (db, id) => (await db.query(`SELECT text_declaratie, versiune FROM public.red_proiecte WHERE id = '${id}'`)).rows[0]
const implicit = async db => (await db.query(`SELECT pg_get_expr(d.adbin, d.adrelid) AS e FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie'`)).rows[0].e
const lit2 = s => `'${s.replace(/'/g, "''")}'::text`

// ── VERIFICĂRILE după migrare; întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce, re) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod}${re ? ' ' + re : ''})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return null } return r.rows[0]?.r ?? r.rows }
  // A. declarația: rândurile cu EXACT VECHI -> NOU (versiunea +1, jurnalul fără utilizator), textul personalizat neatins, DEFAULT-ul NOU
  for (const [id, text, v] of [[P.P1, NOU, 2], [P.P2, NOU, 2], [P.P3, 'Text personalizat al proiectului (test).', 1]]) {
    const p = await proiect(db, id)
    if (p.text_declaratie !== text || p.versiune !== v) ab.push(`A proiectul ${id}: ${JSON.stringify(p)} (aștepta versiunea ${v})`)
  }
  if (await implicit(db) !== lit2(NOU)) ab.push('A DEFAULT-ul: ' + await implicit(db))
  const vechi = (await db.query(`SELECT count(*)::int AS n FROM public.red_proiecte WHERE text_declaratie = $1`, [VECHI])).rows[0].n
  if (vechi !== 0) ab.push(`A ${vechi} proiecte cu VECHI`)
  const jr = (await db.query(`SELECT inregistrare_id::text AS id, user_id, date_vechi->>'text_declaratie' AS v, date_noi->>'text_declaratie' AS n FROM public.red_jurnal
    WHERE tabela = 'red_proiecte' AND actiune = 'update' ORDER BY id`)).rows
  if (jr.length !== 2 || jr.some(j => j.user_id !== null || j.v !== VECHI || j.n !== NOU) || !jr.some(j => j.id === P.P1) || !jr.some(j => j.id === P.P2))
    ab.push('A jurnalul: ' + JSON.stringify(jr))
  const p4 = asteptOk(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.red_proiecte (cod, denumire) VALUES ('TEST-PROIECT-4', 'nou') RETURNING text_declaratie AS r`), 'A proiect nou (owner)')
  if (p4 !== null && p4 !== NOU) ab.push('A proiectul nou are: ' + p4)
  // B. RPC-ul public (anon): codul retras = EXACT refuzul unei opțiuni necunoscute; nimic scris; aceleași contoare
  const nB = await nrRasp(db, D(3))
  const rRetras = asteptOk(await rpc(db, TOK[2], 'nu_particip_cu_obiectii', { obiectii: 'am obiectii' }), 'B RPC cu codul retras')
  const rNecunoscut = asteptOk(await rpc(db, TOK[3], 'xyz', { obiectii: 'am obiectii' }), 'B RPC cu o opțiune necunoscută')
  if (JSON.stringify(rRetras) !== '{"ok":false,"motiv":"optiune_invalida"}') ab.push('B refuzul codului retras: ' + JSON.stringify(rRetras))
  if (JSON.stringify(rNecunoscut) !== JSON.stringify(rRetras)) ab.push('B refuz diferit de cel al unei opțiuni necunoscute (oracol): ' + JSON.stringify([rRetras, rNecunoscut]))
  if (await nrRasp(db, D(3)) !== nB) ab.push('B RPC-ul a scris un răspuns cu codul retras')
  if (await contor(db, TOK[2]) !== 1 || await contor(db, TOK[3]) !== 1) ab.push(`B contoarele tokenurilor: ${await contor(db, TOK[2])} / ${await contor(db, TOK[3])} (aștepta 1 / 1)`)
  // celelalte trei opțiuni: neschimbate (succes + refuzurile lor)
  const zi = `(current_date + 10)`
  const b1 = asteptOk(await rpc(db, TOK[4], 'particip', { zi }), 'B particip cu zi validă')
  if (b1 && (b1.ok !== true || b1.optiune !== 'particip')) ab.push('B particip: ' + JSON.stringify(b1))
  const b2 = asteptOk(await rpc(db, TOK[5], 'particip', { zi: '(current_date + 40)' }), 'B particip cu zi străină')
  if (b2 && b2.motiv !== 'zi_invalida') ab.push('B zi_invalida: ' + JSON.stringify(b2))
  const b3 = asteptOk(await rpc(db, TOK[6], 'nu_particip_fara_obiectii', { decl: 'true' }), 'B fără obiecții cu declarația')
  if (b3 && b3.ok !== true) ab.push('B fără obiecții: ' + JSON.stringify(b3))
  const b4 = asteptOk(await rpc(db, TOK[7], 'nu_particip_fara_obiectii', { decl: 'false' }), 'B fără obiecții fără declarație')
  if (b4 && b4.motiv !== 'declaratie_neconfirmata') ab.push('B declaratie_neconfirmata: ' + JSON.stringify(b4))
  const b5 = asteptOk(await rpc(db, TOK[8], 'constatare_teren', { obiectii: 'cer constatare' }), 'B constatare pe teren')
  if (b5 && b5.ok !== true) ab.push('B constatare: ' + JSON.stringify(b5))
  const b6 = asteptOk(await rpc(db, TOK[9], 'constatare_teren', { obiectii: '   ' }), 'B constatare fără text')
  if (b6 && b6.motiv !== 'obiectii_lipsa') ab.push('B obiectii_lipsa: ' + JSON.stringify(b6))
  // C. INSERT cu codul retras pe fiecare cale: operatorul prin API (fiecare canal), owner, service_role, postgres (alți producători)
  for (const canal of ['telefon', 'scris', 'sesiune', 'email', 'sms', 'online']) {
    asteptCod(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', '${canal}', 'nu_particip_cu_obiectii', 'x') RETURNING id`),
      '23514', `C operatorul (editor), canal ${canal}`, MESAJ_OP)
  }
  asteptCod(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', 'telefon', 'nu_particip_cu_obiectii', 'x')`), '23514', 'C owner', MESAJ_OP)
  asteptCod(await ca(db, 'service_role', null, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', 'email', 'nu_particip_cu_obiectii', 'x')`), '23514', 'C service_role', MESAJ_OP)
  try { await db.query(`INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', 'scris', 'nu_particip_cu_obiectii', 'x')`); ab.push('C postgres: a trecut') }
  catch (e) { if (e.code !== '23514' || !MESAJ_OP.test(e.message)) ab.push('C postgres: ' + e.code + ' ' + e.message) }
  if (await nrRasp(db, D(10)) !== 0) ab.push('C s-a scris un răspuns cu codul retras')
  asteptCod(await ca(db, 'authenticated', U.VIEWER, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', 'telefon', 'constatare_teren', 'x')`), '42501', 'C viewer (RLS, neschimbat)')
  // celelalte trei opțiuni, pe calea operatorului: neschimbate (succes + regulile existente)
  asteptOk(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(11)}', 'telefon', 'constatare_teren', 'cer constatare') RETURNING id`), 'C constatare (operator)')
  asteptOk(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa) VALUES ('${D(11)}', 'telefon', 'particip', current_date + 11) RETURNING id`), 'C particip (operator)')
  asteptOk(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('${D(11)}', 'scris', 'nu_particip_fara_obiectii') RETURNING id`), 'C fără obiecții (operator, scris)')
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('${D(11)}', 'telefon', 'particip')`), '23514', 'C particip fără zi', /particip cere zi_sesiune_aleasa/)
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(11)}', 'scris', 'constatare_teren', ' ')`), '23514', 'C constatare fără text', /constatare_teren cere obiectii_text nevid/)
  asteptCod(await ca(db, 'service_role', null, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune) VALUES ('${D(11)}', 'online', 'nu_particip_fara_obiectii')`), '23514', 'C online fără declarație', /cere declaratie_confirmata/)
  // D. UPDATE: CĂTRE codul retras = refuz; pe un rând vechi care îl are deja: alt câmp = permis; plecarea de la el = permisă
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_raspunsuri SET optiune = 'nu_particip_cu_obiectii', obiectii_text = 'x' WHERE id = '${R_P}' RETURNING id`), '23514', 'D editor: particip -> codul retras', MESAJ_OP)
  asteptCod(await ca(db, 'service_role', null, `UPDATE public.red_raspunsuri SET optiune = 'nu_particip_cu_obiectii', obiectii_text = 'x' WHERE id = '${R_P}' RETURNING id`), '23514', 'D service_role: particip -> codul retras', MESAJ_OP)
  for (const [set, ce] of [[`obiectii_text = 'Corectat de operator (test)'`, 'obiecțiile'], [`data = now() - interval '1 day'`, 'data'], [`canal = 'scris'`, 'canalul'],
                           [`semnatura_electronica_ref = 'ref-1'`, 'referința semnăturii']]) {
    const r = asteptOk(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_raspunsuri SET ${set} WHERE id = '${R_OLD}' RETURNING optiune AS r`), `D rândul vechi: corectarea (${ce})`)
    if (r !== null && r !== 'nu_particip_cu_obiectii') ab.push(`D rândul vechi după corectarea (${ce}): ${r}`)
  }
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_raspunsuri SET obiectii_text = '' WHERE id = '${R_OLD}'`), '23514', 'D rândul vechi: obiecțiile golite (regula veche rămâne)', /cere obiectii_text nevid/)
  const dPleaca = asteptOk(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_raspunsuri SET optiune = 'constatare_teren' WHERE id = '${R_OLD}' RETURNING optiune AS r`), 'D rândul vechi -> constatare')
  if (dPleaca !== null && dPleaca !== 'constatare_teren') ab.push('D plecarea de la codul retras: ' + dPleaca)
  asteptCod(await ca(db, 'authenticated', U.EDITOR, `UPDATE public.red_raspunsuri SET optiune = 'nu_particip_cu_obiectii' WHERE id = '${R_OLD}'`), '23514', 'D întoarcerea la codul retras (acum e „către”)', MESAJ_OP)
  // E. funcția nouă: internă (fără drept de apel pentru rolurile aplicației)
  for (const rol of ['anon', 'authenticated', 'service_role'])
    asteptCod(await ca(db, rol, rol === 'authenticated' ? U.OWNER : null, `SELECT public.fn_red_optiune_retrasa('particip') AS r`), '42501', `E ${rol} cheamă fn_red_optiune_retrasa`)
  return ab
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. înainte de migrare: regula veche (codul retras e încă primit de RPC) — reperul probei')
{
  const db = await bazaNoua()
  const r = await rpc(db, TOK[11], 'nu_particip_cu_obiectii', { obiectii: 'obiectie veche' })
  ok(!r.code && r.rows[0].r.ok === true, 'înainte: RPC-ul acceptă codul retras: ' + JSON.stringify(r.rows?.[0]?.r || r))
  await db.close()
}

console.log('2. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările')
let G0 = null
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  G0 = G
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, 'supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv'),
    '# 20261226a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length >= 4 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  ok((await proiect(db, P.P1)).text_declaratie === VECHI && await implicit(db) === lit2(VECHI), 'generarea manifestului (ROLLBACK) nu a schimbat nimic')
  const fManifest = join(TMP, '20261226a_redari_predare_declaratie.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda('20261226a_redari_predare_declaratie', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)), 'livrarea aprobată: diferența = manifestul')
  ok(j.some(m => /^PLAFON_TIMP 20261226a_redari_predare_declaratie: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m))
    && j.some(m => /^LOCK_TINUT 20261226a_redari_predare_declaratie: lock-urile puternice ale migrarii tinute \d+ ms/.test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT + lock-ul la prima încercare')
  const nd = j.find(m => /declaratia: /.test(m)) || ''
  ok(/declaratia: 2 proiecte schimbate \(id cod versiune: [^)]*TEST-PROIECT-1 v2; [^)]*TEST-PROIECT-2 v2\), 1 cu text personalizat neatinse/.test(nd), 'NOTICE-ul evidenței: ' + nd)
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  await db.close()
}

console.log('3. aplicare -> revenire -> reaplicare -> revenire (revenirea nu atinge proiectele editate sau create după migrare)')
{
  const db = await bazaNoua()
  await aplicaMig(db)
  // după migrare: un om editează P2 (altă coloană; versiunea crește), iar un proiect nou primește DEFAULT-ul nou
  const e = await ca(db, 'authenticated', U.OWNER, `UPDATE public.red_proiecte SET denumire = 'Redenumit de om' WHERE id = '${P.P2}' RETURNING versiune AS r`)
  ok(!e.code && e.rows[0].r === 3, 'P2 editat de owner după migrare (versiunea 3): ' + JSON.stringify(e.rows || e))
  await db.exec(`INSERT INTO public.red_proiecte (cod, denumire) VALUES ('TEST-PROIECT-5', 'dupa migrare')`)
  let j = await revino(db)
  const nr = j.find(m => /revenire: \d+ proiecte readuse/.test(m)) || ''
  ok(/revenire: 1 proiecte readuse la declaratia veche \(id cod versiune: [^)]*TEST-PROIECT-1 v3\); 2 proiecte raman cu textul nou/.test(nr), 'NOTICE-ul revenirii: ' + nr)
  ok((await proiect(db, P.P1)).text_declaratie === VECHI && (await proiect(db, P.P2)).text_declaratie === NOU
    && (await proiect(db, P.P3)).text_declaratie === 'Text personalizat al proiectului (test).'
    && (await db.query(`SELECT text_declaratie FROM public.red_proiecte WHERE cod = 'TEST-PROIECT-5'`)).rows[0].text_declaratie === NOU,
    'revenirea: P1 înapoi la VECHI; P2 (editat de om) și proiectul nou rămân cu NOU; P3 neatins')
  ok(await implicit(db) === lit2(VECHI), 'revenirea: DEFAULT-ul = VECHI')
  const fp = (await db.query(`SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS m, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_raspunsuri_valideaza', 'fn_red_raspuns_public', 'fn_red_optiune_retrasa') ORDER BY 1`)).rows
  ok(fp.length === 2 && fp[0].m === '230aa93e36c8d9b5f9ac5f3afc0066ad' && fp[1].m === '3528222d7d8379dbbe8f3d2e64c60b94'
    && fp[0].acl === '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}' && fp[1].acl === '{postgres=X/postgres}',
    'revenirea: corpurile 20261126a, ACL-urile de dinainte, fn_red_optiune_retrasa scoasă: ' + JSON.stringify(fp))
  const rv = await rpc(db, TOK[11], 'nu_particip_cu_obiectii', { obiectii: 'dupa revenire' })
  ok(!rv.code && rv.rows[0].r.ok === true, 'revenirea: regula veche înapoi (RPC-ul acceptă iar codul retras)')
  j = await aplicaMig(db)
  ok(j.some(m => /declaratia: 1 proiecte schimbate \(id cod versiune: [^)]*TEST-PROIECT-1 v4\), 1 cu text personalizat/.test(m)) && (await proiect(db, P.P1)).text_declaratie === NOU,
    'reaplicarea: P1 iar NOU (doar el avea VECHI)')
  const ri = await ca(db, 'authenticated', U.EDITOR, `INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('${D(10)}', 'telefon', 'nu_particip_cu_obiectii', 'x')`)
  ok(ri.code === '23514', 'reaplicarea: codul retras iar refuzat')
  j = await revino(db)
  ok(j.some(m => /revenire: 1 proiecte readuse la declaratia veche \(id cod versiune: [^)]*TEST-PROIECT-1 v5\)/.test(m)) && (await proiect(db, P.P1)).text_declaratie === VECHI,
    'a doua revenire: P1 înapoi (ultimul rând de jurnal al migrării)')
  await db.close()
}

console.log('4. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['pasul „înainte” dintr-o tranzacție anterioară', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  ['triggerul de validare schimbat înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`)
    return aplicaMig(db)
  }, /nu sunt cele din 20261126a/],
  ['RPC-ul public schimbat înainte (alt corp)', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata boolean, p_user_agent text) RETURNS jsonb
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;`)
    return aplicaMig(db)
  }, /nu sunt cele din 20261126a/],
  ['RPC-ul public fără SECURITY DEFINER', async db => { await db.exec(`ALTER FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text) SECURITY INVOKER`); return aplicaMig(db) }, /nu sunt cele din 20261126a/],
  ['triggerul de validare dezactivat', async db => { await db.exec(`ALTER TABLE public.red_raspunsuri DISABLE TRIGGER trg_red_raspunsuri_valideaza`); return aplicaMig(db) }, /trg_red_raspunsuri_valideaza nu e cel/],
  ['triggerul de validare doar pe INSERT', async db => {
    await db.exec(`DROP TRIGGER trg_red_raspunsuri_valideaza ON public.red_raspunsuri; CREATE TRIGGER trg_red_raspunsuri_valideaza BEFORE INSERT ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_raspunsuri_valideaza();`)
    return aplicaMig(db)
  }, /trg_red_raspunsuri_valideaza nu e cel/],
  ['CHECK-ul opțiunii schimbat', async db => { await db.exec(`ALTER TABLE public.red_raspunsuri ADD CONSTRAINT x_optiune_ck CHECK (optiune <> 'particip') NOT VALID`); return aplicaMig(db) }, /CHECK-ul pe red_raspunsuri.optiune/],
  ['DEFAULT-ul declarației deja altul', async db => { await db.exec(`ALTER TABLE public.red_proiecte ALTER COLUMN text_declaratie SET DEFAULT 'alt text'`); return aplicaMig(db) }, /text_declaratie \(DEFAULT 'alt text'::text\)/],
  ['jurnalul de pe red_proiecte dezactivat (evidența revenirii)', async db => { await db.exec(`ALTER TABLE public.red_proiecte DISABLE TRIGGER trg_red_jurnal`); return aplicaMig(db) }, /evidenta revenirii/],
  ['setul de lock-uri obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    '      LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])), /BUGET_LOCK: lock-urile obtinute abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n      EXIT;\n"]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  const m = await eroare(fn(db))
  const neschimbat = (await proiect(db, P.P1)).text_declaratie === VECHI
    && (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'fn_red_optiune_retrasa'`)).rows[0].n === 0
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}${neschimbat ? '' : ' (STAREA S-A SCHIMBAT)'}`)
  await db.close()
}

console.log('5. refuzurile revenirii')
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261226a \(pasul 1, functii/],
  ['fără plafon', async db => aplicaMig(db), { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['triggerul de validare schimbat după aplicare', async db => {
    await aplicaMig(db)
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`)
  }, {}, /starea nu e cea din 20261226a \(pasul 1, functii: public\.fn_red_raspunsuri_valideaza\(\)\)/],
  ['fn_red_optiune_retrasa primită de authenticated', async db => { await aplicaMig(db); await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_optiune_retrasa(text) TO authenticated`) }, {}, /starea nu e cea din 20261226a \(pasul 1, functii: drepturi/],
  ['DEFAULT-ul schimbat după aplicare', async db => { await aplicaMig(db); await db.exec(`ALTER TABLE public.red_proiecte ALTER COLUMN text_declaratie SET DEFAULT 'alt text'`) }, {}, /starea nu e cea din 20261226a \(pasul 1, DEFAULT/],
]) {
  const db = await bazaNoua()
  await pregatire(db)
  const inainte = (await proiect(db, P.P1)).text_declaratie
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && (await proiect(db, P.P1)).text_declaratie === inainte, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('6. MUTANȚI (fiecare TREBUIE să pice: la aplicare, la verificări sau la scenariul revenirii)')
const TRIG = "  IF public.fn_red_optiune_retrasa(NEW.optiune) IS TRUE AND (TG_OP = 'INSERT' OR NEW.optiune IS DISTINCT FROM OLD.optiune) THEN\n"
const RPC_IF = "  IF p_optiune IS NULL OR p_optiune NOT IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren')\n     OR public.fn_red_optiune_retrasa(p_optiune) IS TRUE THEN\n"
const UPD = "   WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'\n  RETURNING pr.id, pr.cod, pr.versiune)"
const POST_VECHI = "  IF EXISTS (SELECT 1 FROM public.red_proiecte pr\n              WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.') THEN\n    RAISE EXCEPTION '20261226a: postconditie: a ramas un proiect cu declaratia veche';\n  END IF;\n"
const MUTANTI = [
  ['refuzul doar în RPC, nu și în trigger', [[TRIG, '  IF false THEN\n']]],
  ['UPDATE-ul uitat (doar INSERT refuzat)', [[TRIG, "  IF public.fn_red_optiune_retrasa(NEW.optiune) IS TRUE AND TG_OP = 'INSERT' THEN\n"]]],
  ['refuzul și pe UPDATE-ul rândurilor vechi (fără condiția „către”)', [[TRIG, '  IF public.fn_red_optiune_retrasa(NEW.optiune) IS TRUE THEN\n']]],
  ['RPC-ul fără refuzul codului retras (doar triggerul: eroare brută, nu jsonb)', [[RPC_IF, "  IF p_optiune IS NULL OR p_optiune NOT IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren') THEN\n"]]],
  ['RPC-ul cu motiv NOU (oracol / formă nouă)', [[RPC_IF, RPC_IF + "    RETURN jsonb_build_object('ok', false, 'motiv', 'optiune_retrasa');\n  END IF;\n  IF false THEN\n"]]],
  ['DEFAULT schimbat fără rânduri (UPDATE-ul scos)', [[UPD, "   WHERE false\n  RETURNING pr.id, pr.cod, pr.versiune)"]]],
  ['DEFAULT schimbat fără rânduri + postcondiția scoasă', [[UPD, "   WHERE false\n  RETURNING pr.id, pr.cod, pr.versiune)"], [POST_VECHI, '']]],
  ['rândurile cu orice text (și cel personalizat) suprascrise', [[UPD, "   WHERE pr.text_declaratie IS DISTINCT FROM 'x'\n  RETURNING pr.id, pr.cod, pr.versiune)"]]],
]
for (const [nume, lista] of MUTANTI) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = !!m, cum = m ? 'la aplicare: ' + m.slice(0, 100) : ''
  if (!m) { const ab = await verifica(db); prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 100)})` }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}
// mutantul revenirii: readuce TOATE proiectele cu NOU (fără evidența din jurnal) -> P2 editat de om ar fi suprascris
{
  const db = await bazaNoua()
  await aplicaMig(db)
  await ca(db, 'authenticated', U.OWNER, `UPDATE public.red_proiecte SET denumire = 'Redenumit de om' WHERE id = '${P.P2}'`)
  const revMut = aplica(REV, [["                    AND j.date_noi = to_jsonb(pr))\n", "                    OR true)\n"]])
  let m = await eroare(revino(db, revMut))
  const p2 = await proiect(db, P.P2)
  ok(!m && p2.text_declaratie === VECHI, `mutantul revenirii (fără evidența rândului) chiar suprascrie P2 editat de om (aici ${p2.text_declaratie === VECHI ? 'suprascris' : 'neatins'}) — testul 3 îl prinde`)
  await db.close()
  const db2 = await bazaNoua()
  await aplicaMig(db2)
  await ca(db2, 'authenticated', U.OWNER, `UPDATE public.red_proiecte SET denumire = 'Redenumit de om' WHERE id = '${P.P2}'`)
  m = await eroare(revino(db2))
  ok(!m && (await proiect(db2, P.P2)).text_declaratie === NOU, 'revenirea reală pe aceeași stare: P2 neatins')
  await db2.close()
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
