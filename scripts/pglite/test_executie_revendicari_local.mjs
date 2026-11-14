// Proba LOCALĂ a migrării 20261224a (dosarul de revendicare în Execuție) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261224a_executie_revendicari_schelet.sql + funcțiile restricției pe proiect EXTRASE EXACT din 20261209a
//   (amprentele lor = cele cerute de migrare) + 20261203a întreagă (fișa contractului) + fn_executie_contract_drept din 20261209a.
// 1. SUITA (S*): roluri reale — owner, administrator Execuție, administrator restrâns pe proiect, MP-ul proiectului, MP-ul ALTUI proiect,
//    MP restrâns, editor Execuție (nu MP), cont fără modul, MP fără modul, anonim — pe acces direct la tabele și prin RPC; cazurile de calcul
//    din docs/executie/REVENDICARI_SPEC.md §4 (valori LITERALE, scrise de mână acolo); idempotența (aceeași cheie, alt conținut, alt cont);
//    CAS; referințele pe proiect; jurnalul; lock-urile ținute de RPC (xmax + advisory); „decăzut” niciodată automat.
//    Runda 2 (verdictul NO-GO pe PR #1106): S15 lanțul termenelor + ciclurile, S16 aprobarea legată de surse, S17 îndeplinirea (compatibilitate,
//    anulări), S18 dosarul final pe TOATE RPC-urile, S19 declanșatorii prin comunicări reale, S20 rolurile pe fiecare RPC, S21 retenția +
//    regresia modulului Documente; S12u corectat (aștepta greșit „indeplinit” după schimbarea sursei). `--doar-suita <migrare>` rulează doar
//    suita pe altă migrare (dovada că testele noi pică pe runda 1).
// 2. MUTANȚI: migrarea stricată intenționat; fiecare TREBUIE să pice la verificarea lui (L25), altfel suita nu dovedește nimic. Fiecare
//    mutant e re-amprentat (0b), ca să-l prindă verificarea lui, nu amprenta corpurilor; mutanții de livrare P6–P11 = definițiile exacte (§9).
// 3. SCENARII: refuzurile migrării (plafon, reaplicare, restricția 20261209a schimbată), aplicare -> revenire -> reaplicare, revenirea refuză
//    cu date.
// Limită: PGlite are o singură conexiune — concurența REALĂ (două sesiuni psql pe același dosar, aceeași cheie) o rulează pe clonă
//   scripts/executie_revendicari_concurenta.sh; aici se dovedește că RPC-ul ține lock-urile (rândul dosarului + lock-ul consultativ al cheii)
//   până la COMMIT și că a doua scriere cu versiunea veche primește „conflict”.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_revendicari_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')
// `--doar-suita <fișierul migrării>`: doar suita, pe ALTĂ migrare (ex. cea din runda 1), cu lista verificărilor picate — dovada că testele
// noi pică pe codul vechi (fără verificările de amprentă, mutanți și scenarii)
const iDS = process.argv.indexOf('--doar-suita')
const DOAR_SUITA = iDS > 0
const MIG_CALE = DOAR_SUITA ? process.argv[iDS + 1] : 'supabase/migrations/20261224a_executie_revendicari.sql'
if (DOAR_SUITA && !MIG_CALE) { console.error('utilizare: --doar-suita <fișierul migrării>'); process.exit(2) }
const MIG = citeste(MIG_CALE)
const REV = citeste('supabase/revenire/20261224a_executie_revendicari_ROLLBACK.sql')
const SCHELET = citeste('supabase/tests/20261224a_executie_revendicari_schelet.sql')
const M09 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const M03 = citeste('supabase/migrations/20261203a_executie_contract_repere.sql')

// funcția care începe cu `cap` (text exact din migrare) + corpul ei dintre $f$ … $f$ (fără CR, ca md5(replace(prosrc, chr(13), '')))
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0 || text.indexOf(cap, i + 1) >= 0) throw new Error('funcția nu apare exact o dată: ' + cap)
  const a = text.indexOf('$f$', i), b = text.indexOf('$f$', a + 3)
  return { sql: text.slice(i, text.indexOf(';', b) + 1), corp: text.slice(a + 3, b) }
}
const RESTRICTIE = [
  ['MD5_NERESTRANS_CONT', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont('],
  ['MD5_LISTA_CONT', 'CREATE FUNCTION public.fn_executie_acces_lista_cont('],
  ['MD5_NERESTRANS', 'CREATE FUNCTION public.fn_executie_acces_nerestrans('],
  ['MD5_LISTA', 'CREATE FUNCTION public.fn_executie_acces_lista('],
  ['MD5_PROIECT_PERMIS', 'CREATE FUNCTION public.fn_executie_proiect_permis('],
].map(([et, cap]) => ({ et, ...functie(M09, cap) }))
const CONTRACT_DREPT = functie(M09, 'CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(').sql

// 0. amprentele din preflight-ul migrării = corpurile din 20261209a
{
  let rau = false
  for (const f of RESTRICTIE) {
    const inMig = new RegExp(`\\('public\\.${f.sql.slice(f.sql.indexOf('public.') + 7, f.sql.indexOf('('))}\\([^)]*\\)', '([0-9a-zA-Z_]+)'`).exec(MIG)
    const real = md5(f.corp)
    console.log(`amprenta ${f.et}: ${real} (migrarea: ${inMig && inMig[1]})`)
    if (!inMig || inMig[1] !== real) rau = true
  }
  if (rau) { console.error('preflight-ul migrării are alte amprente decât corpurile din 20261209a'); process.exit(1) }
}

// 0b. (runda 2, L15) amprentele corpurilor din postcondițiile §9 = corpurile din TEXTUL migrării (sursă independentă de BD). Mutanții sunt
//     re-amprentați (ca și cum ar fi fost revizuiți), ca fiecare să fie prins de verificarea LUI, nu de amprentă; mutanții de livrare care
//     schimbă un corp DUPĂ creare (CREATE OR REPLACE) rămân cu amprenta originalului și trebuie prinși de §9.
function amprenteCorpuri(text) {
  const m = new Map(), re = /CREATE FUNCTION public\.(fn_executie_revendicare_[a-z_]+)\(/g
  let x
  while ((x = re.exec(text))) {
    if (m.has(x[1])) throw new Error('funcție creată de două ori: ' + x[1])
    const a = text.indexOf('$f$', x.index), b = text.indexOf('$f$', a + 3)
    m.set(x[1], md5(text.slice(a + 3, b)))
  }
  return m
}
const RE_POST_FN = /\('(fn_executie_revendicare_[a-z_]+)\([^']*\)', '[^']*', '[a-z]+', '[siv]', '(?:definer|client|intern)', '([0-9a-f]{32})'\)/g
const reamprenteaza = (text) => { const m = amprenteCorpuri(text); return text.replace(RE_POST_FN, (s, nume, v) => (m.has(nume) ? s.replace(v, m.get(nume)) : s)) }
if (!DOAR_SUITA) {
  const m = amprenteCorpuri(MIG)
  let rau = false, n = 0
  for (const x of MIG.matchAll(RE_POST_FN)) {
    n++
    if (m.get(x[1]) !== x[2]) { rau = true; console.error(`amprenta ${x[1]}: postcondiția ${x[2]}, corpul din text ${m.get(x[1])}`) }
  }
  if (n !== m.size) { rau = true; console.error(`postcondiția are ${n} funcții, textul ${m.size}`) }
  if (rau) process.exit(1)
  console.log(`amprentele corpurilor din §9: ${n} funcții, identice cu textul migrării`)
}

function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 100))
    t = t.split(din).join(in_)
  }
  return t
}
// aplicarea ca runnerul (--plafon-tranzactie-ms 2000): SET de sesiune înainte de BEGIN, marcajele livrării + plafonului în tranzacție
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true); ${mp}\n${text}\nCOMMIT;`)
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261224a_executie_revendicari', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261224a_executie_revendicari_ROLLBACK', text, o)

// identități sintetice
const U = {
  owner: '00000000-0000-4000-8000-000000000001', admin: '00000000-0000-4000-8000-000000000002',
  adminR: '00000000-0000-4000-8000-000000000003', mp1: '00000000-0000-4000-8000-000000000004',
  mp2: '00000000-0000-4000-8000-000000000005', editor: '00000000-0000-4000-8000-000000000006',
  fara: '00000000-0000-4000-8000-000000000007', mp3: '00000000-0000-4000-8000-000000000008',
  mpR: '00000000-0000-4000-8000-000000000009',
}
const SHA1 = 'a'.repeat(64), SHA2 = 'b'.repeat(64)
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  for (const f of RESTRICTIE) await db.exec(f.sql)
  await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261203a_executie_contract_repere:' || txid_current(), true);\n${M03}\nCOMMIT;`)
  await db.exec(CONTRACT_DREPT)
  // date: P1 (MP = angajatul 1), P2 (MP = 2), P3 (MP = 4), P4 (MP = 5, restrâns în afara lui); conturile din U
  await db.exec(`
    INSERT INTO public.employees (name) VALUES ('ANGAJAT UNU'), ('ANGAJAT DOI'), ('ANGAJAT TREI'), ('ANGAJAT PATRU'), ('ANGAJAT CINCI');
    INSERT INTO public.executie_proiecte (nume, mp_employee_id) VALUES ('PROIECT-1', 1), ('PROIECT-2', 2), ('PROIECT-3', 4), ('PROIECT-4', 5);
    INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES
      ('${U.owner}', 'owner', true, NULL), ('${U.admin}', 'admin', false, NULL), ('${U.adminR}', 'admin restrans', false, NULL),
      ('${U.mp1}', 'mp1', false, 1), ('${U.mp2}', 'mp2', false, 2), ('${U.editor}', 'editor', false, 3), ('${U.fara}', 'fara', false, NULL),
      ('${U.mp3}', 'mp3 fara modul', false, 4), ('${U.mpR}', 'mp restrans', false, 5);
    INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
      ('${U.admin}', 'executie', 'admin'), ('${U.adminR}', 'executie', 'admin'), ('${U.mp1}', 'executie', 'viewer'),
      ('${U.mp2}', 'executie', 'editor'), ('${U.editor}', 'executie', 'editor'), ('${U.fara}', 'hr', 'admin'), ('${U.mpR}', 'executie', 'editor');
    INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.adminR}', 1, 'editor'), ('${U.mpR}', 1, 'editor');
    INSERT INTO public.sites (name, proiect_id) VALUES ('S1', 1), ('S2', 2);
    INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (1, DATE '2026-03-10', 'R1'), (2, DATE '2026-03-10', 'R2');
    INSERT INTO public.documente_proiect (proiect_id, nume_fisier, storage_path, hash_sha256) VALUES
      (1, 'semnat.pdf', 'p1/semnat.pdf', '${SHA1}'), (1, 'fara_hash.pdf', 'p1/fara.pdf', NULL), (2, 'strain.pdf', 'p2/strain.pdf', '${SHA2}');
    INSERT INTO public.executie_ordine_sistare (proiect_id, data_sistare) VALUES (1, DATE '2026-03-12'), (2, DATE '2026-03-12');
    INSERT INTO public.executie_contract_repere (proiect_id, sectiune, cod, titlu, citat) VALUES
      (1, 'clauza', 'C1', 'Clauza de notificare', 'text generic al clauzei'), (2, 'clauza', 'C1', 'Clauza de notificare', 'text generic');`)
  return db
}

// apel ca un cont (rolul authenticated + JWT-ul în sursa citită ÎNTÂI de auth.uid()); 'anon' = rolul anon fără JWT
async function ca(db, cine, sql, params = []) {
  await db.exec(cine === 'anon' ? `SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);`
    : `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${U[cine]}', false);`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`) }
}
const SEMN = {
  salveaza_dosar: ['bigint', 'bigint', 'integer', 'jsonb', 'uuid'], etapa: ['bigint', 'integer', 'text', 'text', 'uuid'],
  risc: ['bigint', 'integer', 'text', 'text', 'uuid'], reper: ['bigint', 'text', 'bigint', 'integer', 'jsonb', 'uuid'],
  act: ['bigint', 'bigint', 'integer', 'jsonb', 'uuid'], act_stare: ['bigint', 'integer', 'text', 'jsonb', 'uuid'],
  comunicare: ['bigint', 'bigint', 'integer', 'jsonb', 'uuid'], termen: ['bigint', 'bigint', 'integer', 'jsonb', 'uuid'],
  termen_confirma: ['bigint', 'integer', 'text', 'jsonb', 'uuid'], dovada: ['bigint', 'bigint', 'integer', 'jsonb', 'uuid'],
}
async function rpc(db, cine, nume, ...args) {
  const t = SEMN[nume]
  const p = args.map((a, i) => (a !== null && t[i] === 'jsonb' ? JSON.stringify(a) : a))
  const r = await ca(db, cine, `SELECT public.fn_executie_revendicare_${nume}(${t.map((x, i) => `$${i + 1}::${x}`).join(', ')}) AS r`, p)
  return r[0].r
}
async function eroare(fn) {
  try { await fn(); return null } catch (e) { return { code: e.code, message: e.message } }
}
const K = () => randomUUID()

// ── 1. SUITA: întoarce lista verificărilor picate (id + detaliu) ─────────────────────────────────────────────────────────────────────────
async function suita(db, picate) {
  const ok = (id, cond, detaliu = '') => { if (!cond) picate.push(`${id}: ${detaliu}`) }
  const refuz = async (id, cod, fn, mesaj) => {
    const e = await eroare(fn)
    ok(id, e && e.code === cod && (!mesaj || mesaj.test(e.message)), `așteptat ${cod}${mesaj ? ' ' + mesaj : ''}, primit ${e ? e.code + ' ' + e.message : 'succes'}`)
    return e
  }
  const pg = async (sql, p) => (await db.query(sql, p)).rows

  // S1 acces direct: anonim nimic; authenticated fără scrieri directe; cheile invizibile tuturor
  await refuz('S1a anon SELECT dosare', '42501', () => ca(db, 'anon', 'SELECT * FROM public.executie_revendicari'))
  await refuz('S1b anon RPC', '42501', () => rpc(db, 'anon', 'salveaza_dosar', 1, null, null, { titlu: 'x' }, K()))
  for (const [t, sql] of [['dosare', `INSERT INTO public.executie_revendicari (proiect_id, titlu) VALUES (1, 'direct')`],
                          ['acte', `UPDATE public.executie_revendicare_acte SET titlu = 'x'`],
                          ['termene', `DELETE FROM public.executie_revendicare_termene`],
                          ['jurnal', `INSERT INTO public.executie_revendicare_jurnal (dosar_id, proiect_id, tabel, rand_id, operatie, tranzactie) VALUES (1, 1, 'x', 1, 'INSERT', 1)`],
                          ['vedere', `DELETE FROM public.v_executie_revendicare_acte`]]) {
    await refuz(`S1c owner scriere directă ${t}`, '42501', () => ca(db, 'owner', sql))
  }
  await refuz('S1d owner SELECT chei', '42501', () => ca(db, 'owner', 'SELECT * FROM public.executie_revendicare_chei'))

  // S2 crearea dosarului, pe roluri
  const dosar = async (cine, proiect, titlu, extra = {}) => rpc(db, cine, 'salveaza_dosar', proiect, null, null, { titlu, ...extra }, K())
  const r1 = await dosar('mp1', 1, 'Problema pe santier P1', { data_eveniment: '2026-03-10', caracter: 'continuu', solicita_timp: 'da' })
  ok('S2a MP al proiectului creează', r1.ok === true && r1.rand.proiect_id === 1 && r1.rand.etapa === 'eveniment' && r1.rand.risc_juridic === 'neevaluat'
     && r1.rand.creat_de === U.mp1 && r1.rand.versiune === 1 && r1.rand.solicita_bani === 'de_stabilit', JSON.stringify(r1))
  const D1 = r1.rand.id
  for (const [cine, p, id] of [['mp1', 2, 'S2b MP al ALTUI proiect'], ['editor', 1, 'S2c editor Execuție (nu MP)'], ['fara', 1, 'S2d cont fără modul'],
                               ['mp3', 3, 'S2e MP fără modulul Execuție'], ['adminR', 2, 'S2f admin restrâns, proiect în afara listei'],
                               ['mpR', 4, 'S2g MP restrâns, proiectul lui în afara listei'], ['mp1', 999, 'S2h proiect inexistent']]) {
    await refuz(id, '42501', () => dosar(cine, p, 'x'), /dosarul nu exista sau nu ai drept/)
  }
  const r2 = await dosar('owner', 2, 'Problema P2')
  const r3 = await dosar('admin', 1, 'Problema P1 admin')
  const r4 = await dosar('adminR', 1, 'Problema P1 admin restrans')
  ok('S2i owner / admin / admin restrâns pe proiectul permis', r2.ok && r3.ok && r4.ok)
  const D2 = r2.rand.id
  await refuz('S2j titlu gol', '22023', () => dosar('mp1', 1, '   '), /titlul e obligatoriu/)
  await refuz('S2k câmp necunoscut', '22023', () => rpc(db, 'mp1', 'salveaza_dosar', 1, null, null, { titlu: 'x', etapa: 'acord' }, K()), /camp necunoscut: etapa/)
  await refuz('S2l dată imposibilă', '22008', () => dosar('mp1', 1, 'x', { data_eveniment: '2026-02-30' }))

  // S3 citirea (RLS): numărătorile construite mai sus — P1: D1, r3, r4 (3); P2: D2 (1)
  const n = async (cine, t = 'executie_revendicari') => (await ca(db, cine, `SELECT count(*)::int AS n FROM public.${t}`))[0].n
  for (const [cine, astept] of [['owner', 4], ['admin', 4], ['adminR', 3], ['mp1', 3], ['mp2', 1], ['mpR', 0], ['editor', 0], ['fara', 0], ['mp3', 0]]) {
    const v = await n(cine)
    ok(`S3 ${cine} vede ${astept} dosare`, v === astept, `vede ${v}`)
  }
  const jurnalMp2 = await n('mp2', 'executie_revendicare_jurnal')
  ok('S3j jurnalul urmează dreptul (mp2: doar dosarul P2 = 1 rând)', jurnalMp2 === 1, `vede ${jurnalMp2}`)

  // S4 idempotența + CAS
  const cheie = K()
  const a1 = await rpc(db, 'mp1', 'salveaza_dosar', 1, D1, 1, { titlu: 'Problema pe santier P1', descriere: 'detalii', data_eveniment: '2026-03-10', caracter: 'continuu', solicita_timp: 'da' }, cheie)
  const a2 = await rpc(db, 'mp1', 'salveaza_dosar', 1, D1, 1, { titlu: 'Problema pe santier P1', descriere: 'detalii', data_eveniment: '2026-03-10', caracter: 'continuu', solicita_timp: 'da' }, cheie)
  ok('S4a reluarea cu aceeași cheie = rezultatul de data trecută', a1.ok && a1.duplicat === false && a2.ok && a2.duplicat === true && a2.rand.versiune === 2,
     JSON.stringify([a1.rand && a1.rand.versiune, a2]))
  await refuz('S4b aceeași cheie, alt conținut', '22023', () => rpc(db, 'mp1', 'salveaza_dosar', 1, D1, 1, { titlu: 'alt titlu' }, cheie), /cheia intentiei/)
  await refuz('S4c aceeași cheie, alt cont', '22023', () => rpc(db, 'admin', 'salveaza_dosar', 1, D1, 1,
    { titlu: 'Problema pe santier P1', descriere: 'detalii', data_eveniment: '2026-03-10', caracter: 'continuu', solicita_timp: 'da' }, cheie), /cheia intentiei/)
  const cheieC = K()
  const c1 = await rpc(db, 'admin', 'salveaza_dosar', 1, D1, 1, { titlu: 'versiune veche' }, cheieC)
  ok('S4d versiunea veche = conflict, nimic scris', c1.ok === false && c1.motiv === 'conflict' && c1.rand.versiune === 2 && c1.rand.titlu === 'Problema pe santier P1', JSON.stringify(c1))
  const kc = (await pg(`SELECT count(*)::int AS n FROM public.executie_revendicare_chei WHERE cheie = $1`, [cheieC]))[0].n
  ok('S4e conflictul nu consumă cheia', kc === 0, `chei ${kc}`)
  const dup = (await pg(`SELECT count(*)::int AS n FROM public.executie_revendicari`))[0].n
  ok('S4f numărul de dosare neschimbat de reluări', dup === 4, `dosare ${dup}`)
  const kCreare = K()
  const cr1 = await rpc(db, 'mp1', 'salveaza_dosar', 1, null, null, { titlu: 'creare reluata' }, kCreare)
  const cr2 = await rpc(db, 'mp1', 'salveaza_dosar', 1, null, null, { titlu: 'creare reluata' }, kCreare)
  ok('S4g crearea reluată nu face al doilea dosar', cr2.duplicat === true && cr2.rand.id === cr1.rand.id
     && (await pg(`SELECT count(*)::int AS n FROM public.executie_revendicari WHERE titlu = 'creare reluata'`))[0].n === 1)

  // S5 lock-urile ținute de RPC până la COMMIT (L06): rândul dosarului FOR UPDATE și reperul (alt modul) FOR SHARE (xmax = tranzacția), plus
  //    lock-ul consultativ al cheii. RPC-ul ales (legarea unui reper) nu modifică dosarul, deci xmax-ul rândului e chiar lock-ul.
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${U.mp1}', false); BEGIN;`)
  try {
    const rp = (await db.query(`SELECT id::int AS id FROM public.executie_contract_repere WHERE proiect_id = 1`)).rows[0].id
    await db.query(`SELECT public.fn_executie_revendicare_reper($1::bigint, 'leaga', NULL, NULL, $2::jsonb, $3::uuid)`, [D1, JSON.stringify({ reper_id: rp, rol: 'sursa' }), K()])
    const l = (await db.query(`SELECT (SELECT xmax::text FROM public.executie_revendicari WHERE id = $1) AS xm,
                                      (SELECT xmax::text FROM public.executie_contract_repere WHERE id = $2) AS xr, (txid_current() % 4294967296)::text AS tx,
                                      (SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted) AS adv`, [D1, rp])).rows[0]
    ok('S5 RPC-ul ține dosarul, reperul și cheia până la COMMIT', l.adv >= 1 && l.xm === l.tx && l.xr === l.tx, JSON.stringify(l))
  } finally { await db.exec(`ROLLBACK; RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`) }

  // S6 referințele: reperul, dovezile (document / ordin / raport) — ale proiectului dosarului; inexistent = străin (același refuz)
  const vD1 = async () => (await pg(`SELECT versiune FROM public.executie_revendicari WHERE id = $1`, [D1]))[0].versiune
  const reperP1 = (await pg(`SELECT id::int AS id FROM public.executie_contract_repere WHERE proiect_id = 1`))[0].id
  const reperP2 = (await pg(`SELECT id::int AS id FROM public.executie_contract_repere WHERE proiect_id = 2`))[0].id
  const eStr = await refuz('S6a reperul altui proiect', '42501', () => rpc(db, 'mp1', 'reper', D1, 'leaga', null, null, { reper_id: reperP2, rol: 'temei' }, K()))
  const eInx = await refuz('S6b reper inexistent', '42501', () => rpc(db, 'mp1', 'reper', D1, 'leaga', null, null, { reper_id: 99999, rol: 'temei' }, K()))
  ok('S6c străin și inexistent = același mesaj', eStr && eInx && eStr.message === eInx.message, `${eStr && eStr.message} / ${eInx && eInx.message}`)
  const L = await rpc(db, 'mp1', 'reper', D1, 'leaga', null, null, { reper_id: reperP1, rol: 'temei' }, K())
  ok('S6d reperul proiectului se leagă, cu copia textului și versiunea', L.ok && L.rand.reper_versiune_legata === 1 && L.rand.citat_copie === 'text generic al clauzei'
     && L.rand.confirmat_la === null, JSON.stringify(L))
  const L1 = L.rand.id
  await refuz('S6e legătura dublă', '23505', () => rpc(db, 'mp1', 'reper', D1, 'leaga', null, null, { reper_id: reperP1, rol: 'temei' }, K()))
  const [doc1, docFaraHash, doc2] = (await pg(`SELECT id::int AS id FROM public.documente_proiect ORDER BY id`)).map((r) => r.id)
  const [ord1, ord2] = (await pg(`SELECT id::int AS id FROM public.executie_ordine_sistare ORDER BY id`)).map((r) => r.id)
  const [rap1, rap2] = (await pg(`SELECT id::int AS id FROM public.rapoarte_zilnice ORDER BY id`)).map((r) => r.id)
  for (const [tip, id, et] of [['document', doc2, 'documentul altui proiect'], ['ordin', ord2, 'ordinul altui proiect'], ['raport', rap2, 'raportul unui șantier al altui proiect'],
                               ['document', 99999, 'document inexistent']]) {
    await refuz(`S6f ${et}`, '42501', () => rpc(db, 'mp1', 'dovada', D1, null, null, { tip, tinta_id: id, rol: 'fapt' }, K()), /tinta nu exista sau nu e in proiectul dosarului/)
  }
  let dovOk = true
  for (const [tip, id] of [['document', doc1], ['ordin', ord1], ['raport', rap1]]) {
    const r = await rpc(db, 'mp1', 'dovada', D1, null, null, { tip, tinta_id: id, rol: 'fapt' }, K())
    dovOk = dovOk && r.ok && /^[0-9a-f]{32}$/.test(r.rand.tinta_amprenta)
  }
  ok('S6g dovezile proiectului se leagă', dovOk)
  await refuz('S6h dovada dublă', '23505', () => rpc(db, 'mp1', 'dovada', D1, null, null, { tip: 'raport', tinta_id: rap1, rol: 'cauza' }, K()))
  await refuz('S6i exact o țintă (CHECK, și pe calea server)', '23514', () => pg(
    `INSERT INTO public.executie_revendicare_dovezi (dosar_id, proiect_id, document_id, ordin_id, rol, tinta_amprenta) VALUES ($1, 1, $2, $3, 'fapt', '${'0'.repeat(32)}')`, [D1, doc1, ord1]))
  await refuz('S6j documentul legat nu se mai șterge din modulul lui (FK)', '23503', () => pg(`DELETE FROM public.documente_proiect WHERE id = $1`, [doc1]))

  // S7 termenul C1 prin RPC: eveniment 2026-03-10 + 30 = 2026-04-09; confirmările pe niveluri; C17
  const conf = await rpc(db, 'mp1', 'reper', D1, 'confirma', L1, 1, { reper_versiune: 1 }, K()).catch((e) => e)
  ok('S7a MP-ul nu confirmă sursa', conf && conf.code === '42501', conf && (conf.code + ' ' + conf.message))
  const confA = await rpc(db, 'admin', 'reper', D1, 'confirma', L1, 1, { reper_versiune: 1 }, K())
  ok('S7b administrarea confirmă sursa pe versiune', confA.ok && confA.rand.reper_versiune_confirmata === 1 && confA.rand.confirmat_de === U.admin, JSON.stringify(confA))
  const t1 = await rpc(db, 'mp1', 'termen', D1, null, null, { tip_obligatie: 'notificare', mod: 'regula', declansator_tip: 'data_eveniment',
                                                               declansator_data: '2026-03-10', nr_zile: 30, reper_legatura_id: L1 }, K())
  ok('S7c termen nou: neconfirmat, fără dată propusă', t1.ok && t1.rand.data_propusa === null && t1.rand.stare === 'deschis' && t1.rand.regula_confirmata_la === null, JSON.stringify(t1))
  const T1 = t1.rand.id
  const vT = async (id) => (await pg(`SELECT versiune FROM public.executie_revendicare_termene WHERE id = $1`, [id]))[0].versiune
  await refuz('S7d MP-ul nu confirmă regula', '42501', async () => rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'regula', {}, K()))
  const tr = await rpc(db, 'admin', 'termen_confirma', T1, await vT(T1), 'regula', {}, K())
  ok('S7e C9: regulă confirmată, declanșator neconfirmat = fără dată propusă (C8)', tr.ok && tr.rand.data_propusa === null && tr.rand.regula_confirmata_de === U.admin, JSON.stringify(tr))
  const td = await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'declansator', {}, K())
  ok('S7f C1: 2026-03-10 + 30 = 2026-04-09', td.ok && td.rand.data_propusa === '2026-04-09' && td.rand.declansator_confirmat_de === U.mp1, JSON.stringify(td.rand && td.rand.data_propusa))
  await refuz('S7g C17: altă dată decât cea propusă', '22023', async () => rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-10' }, K()), /difera de cea propusa \(2026-04-09\)/)
  const tc = await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  ok('S7h confirmarea datei propuse', tc.ok && tc.rand.data_confirmata === '2026-04-09' && tc.rand.confirmat_de === U.mp1)
  const vt = async (id, cine = 'mp1') => (await ca(db, cine, `SELECT stare_calcul, intrari_valide, data_propusa::text AS dp, data_confirmata::text AS dc, mod, azi::text AS azi,
                                                                     indeplinit_la::text AS il FROM public.v_executie_revendicare_termene WHERE id = $1`, [id]))[0]
  const azi = (await pg(`SELECT public.fn_executie_revendicare_azi()::text AS a`))[0].a
  const s1 = await vt(T1)
  ok('S7i depășit = „risc de decădere”, nu „decăzut”', s1 && s1.stare_calcul === (azi > '2026-04-09' ? 'depasit_risc_decadere' : azi === '2026-04-09' ? 'scadent_azi' : 'in_termen'), JSON.stringify(s1))
  const rj = (await pg(`SELECT risc_juridic FROM public.executie_revendicari WHERE id = $1`, [D1]))[0].risc_juridic
  ok('S7j riscul dosarului rămâne evaluarea omului', rj === 'neevaluat', rj)
  // declanșatorul s-a schimbat la sursă (data evenimentului editată) -> sursa de reverificat; înapoi -> valid
  const ed = async (data) => rpc(db, 'mp1', 'salveaza_dosar', 1, D1, await vD1(), { titlu: 'Problema pe santier P1', data_eveniment: data, caracter: 'continuu' }, K())
  await ed('2026-03-11')
  ok('S7k sursa declanșatorului schimbată = sursa de reverificat', (await vt(T1)).stare_calcul === 'sursa_de_reverificat')
  await refuz('S7l confirmarea datei cere sursa valabilă', '22023', async () => {
    await pg(`UPDATE public.executie_revendicare_termene SET data_confirmata = NULL WHERE id = $1`, [T1])
    return rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  }, /reverificata/)
  await ed('2026-03-10')
  await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  ok('S7m sursa refăcută = valid din nou', (await vt(T1)).intrari_valide === true && (await vt(T1)).dc === '2026-04-09')
  // schimbarea intrărilor regulii (zilele) invalidează regula și data (trigger, orice cale)
  const tz = await rpc(db, 'mp1', 'termen', D1, T1, await vT(T1), { tip_obligatie: 'notificare', mod: 'regula', declansator_tip: 'data_eveniment',
                                                                    declansator_data: '2026-03-10', nr_zile: 31, reper_legatura_id: L1 }, K())
  ok('S7n zile schimbate = regula și data confirmată cad, declanșatorul rămâne', tz.rand.regula_confirmata_la === null && tz.rand.data_propusa === null
     && tz.rand.data_confirmata === null && tz.rand.declansator_confirmat_la !== null, JSON.stringify(tz.rand))
  ok('S7o C7: zile necunoscute -> stare „necunoscut”', (await pg(`SELECT public.fn_executie_revendicare_termen_stare('deschis', 'regula', true, NULL, NULL, NULL, DATE '2026-04-10') AS s`))[0].s === 'necunoscut')
  await rpc(db, 'mp1', 'termen', D1, T1, await vT(T1), { tip_obligatie: 'notificare', mod: 'regula', declansator_tip: 'data_eveniment',
                                                         declansator_data: '2026-03-10', nr_zile: 30, reper_legatura_id: L1 }, K())
  await rpc(db, 'admin', 'termen_confirma', T1, await vT(T1), 'regula', {}, K())
  await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  // C16: reperul din fișă modificat după confirmare -> sursa de reverificat (și aprobarea cade, S9)
  await pg(`UPDATE public.executie_contract_repere SET citat = 'text generic modificat' WHERE id = $1`, [reperP1])
  ok('S7p C16: reperul schimbat = sursa de reverificat', (await vt(T1)).stare_calcul === 'sursa_de_reverificat')
  const vL = async () => (await pg(`SELECT versiune FROM public.executie_revendicare_repere WHERE id = $1`, [L1]))[0].versiune
  const rs = await rpc(db, 'admin', 'reper', D1, 'confirma', L1, await vL(), { reper_versiune: 1 }, K())
  ok('S7q confirmarea pe versiunea veche a reperului = „reper schimbat”, nimic scris', rs.ok === false && rs.motiv === 'reper_schimbat' && rs.reper_versiune === 2
     && rs.rand.reper_versiune_confirmata === 1, JSON.stringify(rs))
  await rpc(db, 'admin', 'reper', D1, 'confirma', L1, (await pg(`SELECT versiune FROM public.executie_revendicare_repere WHERE id = $1`, [L1]))[0].versiune, { reper_versiune: 2 }, K())
  ok('S7r reconfirmarea legăturii nu reînvie regula veche (versiunea regulii)', (await vt(T1)).stare_calcul === 'sursa_de_reverificat')
  await rpc(db, 'admin', 'termen_confirma', T1, await vT(T1), 'regula', {}, K())
  await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  ok('S7s regula reconfirmată pe noua versiune = valid', (await vt(T1)).intrari_valide === true)

  // S8 cazurile de calcul C2–C6 pe trigger (calea server, aceeași definiție) — declanșator „alt”
  for (const [id, decl, zile, astept] of [['C2', '2026-01-31', 30, '2026-03-02'], ['C3', '2028-01-31', 30, '2028-03-01'], ['C4', '2026-12-15', 30, '2027-01-14'],
                                           ['C5', '2026-11-27', 5, '2026-12-02'], ['C6', '2026-12-02', 10, '2026-12-12']]) {
    const t = (await pg(`INSERT INTO public.executie_revendicare_termene (dosar_id, proiect_id, tip_obligatie, mod, declansator_tip, declansator_data, nr_zile)
                         VALUES ($1, 1, 'alt', 'regula', 'alt', $2::date, $3) RETURNING id::int AS id, data_propusa`, [D1, decl, zile]))[0]
    const r = (await pg(`UPDATE public.executie_revendicare_termene SET regula_confirmata_la = now(), declansator_confirmat_la = now()
                          WHERE id = $1 RETURNING data_propusa::text AS dp`, [t.id]))[0]
    ok(`S8 ${id}: ${decl} + ${zile} = ${astept}`, t.data_propusa === null && r.dp === astept, r.dp)
  }
  const t8 = (await pg(`INSERT INTO public.executie_revendicare_termene (dosar_id, proiect_id, tip_obligatie, mod, declansator_tip, declansator_data, nr_zile)
                        VALUES ($1, 1, 'alt', 'regula', 'alt', DATE '2026-01-31', 30) RETURNING id::int AS id`, [D1]))[0]
  const c8 = (await pg(`UPDATE public.executie_revendicare_termene SET regula_confirmata_la = now() WHERE id = $1 RETURNING data_propusa AS dp`, [t8.id]))[0]
  ok('S8 C8: declanșator neconfirmat = fără dată propusă', c8 && c8.dp === null, JSON.stringify(c8))
  const r8 = (await pg(`INSERT INTO public.executie_revendicare_termene (dosar_id, proiect_id, tip_obligatie, mod, declansator_tip, declansator_data, nr_zile,
                          regula_confirmata_la, declansator_confirmat_la, data_confirmata)
                        VALUES ($1, 1, 'alt', 'regula', 'alt', DATE '2026-01-31', 30, now(), now(), DATE '2026-03-02')
                        RETURNING data_propusa, data_confirmata, regula_confirmata_la, declansator_confirmat_la`, [D1]))[0]
  ok('S8b un INSERT nu vine confirmat (calea server)', r8.data_propusa === null && r8.data_confirmata === null && r8.regula_confirmata_la === null
     && r8.declansator_confirmat_la === null, JSON.stringify(r8))

  // S9 C10–C12: ziua din România (ora de vară / iarnă), nu UTC
  for (const [id, moment, astept] of [['C10a', '2026-10-31 21:30:00+00', '2026-10-31'], ['C10b', '2026-10-31 22:30:00+00', '2026-11-01'],
                                       ['C11a', '2026-07-31 20:59:59+00', '2026-07-31'], ['C11b', '2026-07-31 21:00:00+00', '2026-08-01'],
                                       ['C12a', '2026-03-28 22:00:00+00', '2026-03-29'], ['C12b', '2026-03-29 20:59:59+00', '2026-03-29'],
                                       ['C12c', '2026-03-29 21:00:00+00', '2026-03-30']]) {
    const z = (await pg(`SELECT public.fn_executie_revendicare_zi($1::timestamptz)::text AS z`, [moment]))[0].z
    ok(`S9 ${id}: ${moment} -> ${astept}`, z === astept, z)
  }
  const st = async (...a) => (await pg(`SELECT public.fn_executie_revendicare_termen_stare($1, $2, $3, $4::date, $5::date, $6::date, $7::date) AS s`, a))[0].s
  for (const [id, args, astept] of [
    ['C10 scadent azi', ['deschis', 'regula', true, null, '2026-10-31', null, '2026-10-31'], 'scadent_azi'],
    ['C10 a doua zi', ['deschis', 'regula', true, null, '2026-10-31', null, '2026-11-01'], 'depasit_risc_decadere'],
    ['C13 tardiv', ['indeplinit', 'regula', true, '2026-04-09', '2026-04-09', '2026-04-10', '2026-05-01'], 'indeplinit_tardiv'],
    ['C13 la timp', ['indeplinit', 'regula', true, '2026-04-09', '2026-04-09', '2026-04-09', '2026-05-01'], 'indeplinit'],
    ['C14 neconfirmat depășit', ['deschis', 'regula', true, '2026-04-09', null, null, '2026-04-10'], 'neconfirmat_depasit'],
    ['C14 neconfirmat', ['deschis', 'regula', true, '2026-04-09', null, null, '2026-04-09'], 'neconfirmat'],
    ['C15 manual scadent', ['deschis', 'manual', true, null, '2026-05-05', null, '2026-05-05'], 'scadent_azi'],
    ['C16 sursa schimbată', ['deschis', 'regula', false, '2026-04-09', '2026-04-09', null, '2026-04-01'], 'sursa_de_reverificat'],
    ['în termen', ['deschis', 'regula', true, '2026-04-09', '2026-04-09', null, '2026-04-08'], 'in_termen'],
    ['îndeplinit fără termen', ['indeplinit', 'manual', true, null, null, '2026-04-09', '2026-05-01'], 'indeplinit_termen_necunoscut'],
    ['îndeplinit, comunicarea anulată', ['indeplinit', 'regula', true, '2026-04-09', '2026-04-09', null, '2026-05-01'], 'indeplinit_de_verificat'],
    ['îndeplinit, sursa schimbată (runda 2: sursa înaintea îndeplinirii)', ['indeplinit', 'regula', false, '2026-04-09', '2026-04-09', '2026-04-01', '2026-05-01'], 'sursa_de_reverificat'],
    ['anulat', ['anulat', 'regula', true, null, null, null, '2026-05-01'], 'anulat']]) {
    const s = await st(...args)
    ok(`S9 ${id}`, s === astept, s)
  }
  await refuz('S9 ziua lipsă = eroare, nu „azi”', '22023', () => st('deschis', 'regula', true, null, '2026-04-09', null, null))

  // S10 termenul manual: doar administrarea, cu justificare, rămâne etichetat manual
  const tm = await rpc(db, 'mp1', 'termen', D1, null, null, { tip_obligatie: 'dezacord', mod: 'manual', declansator_tip: 'alt' }, K())
  const TM = tm.rand.id
  await refuz('S10a MP-ul nu confirmă un termen manual', '42501', async () => rpc(db, 'mp1', 'termen_confirma', TM, await vT(TM), 'data', { data: '2026-05-05', justificare: 'x' }, K()))
  await refuz('S10b fără justificare', '22023', async () => rpc(db, 'admin', 'termen_confirma', TM, await vT(TM), 'data', { data: '2026-05-05' }, K()), /justificare/)
  const tmc = await rpc(db, 'admin', 'termen_confirma', TM, await vT(TM), 'data', { data: '2026-05-05', justificare: 'stabilit cu avocatul' }, K())
  ok('S10c C15: manual confirmat, cu autor, etichetat manual', tmc.ok && tmc.rand.mod === 'manual' && tmc.rand.data_confirmata === '2026-05-05' && tmc.rand.confirmat_de === U.admin)

  // S11 riscul: „decădere constatată” doar administrare + motiv
  await refuz('S11a MP-ul nu constată decăderea', '42501', async () => rpc(db, 'mp1', 'risc', D1, await vD1(), 'decadere_constatata', 'motiv', K()))
  await refuz('S11b fără motiv', '22023', async () => rpc(db, 'admin', 'risc', D1, await vD1(), 'decadere_constatata', '  ', K()), /cere motiv/)
  const rk = await rpc(db, 'mp1', 'risc', D1, await vD1(), 'ridicat', null, K())
  ok('S11c MP-ul evaluează riscul obișnuit', rk.ok && rk.rand.risc_juridic === 'ridicat')

  // S12 actele: aprobarea (owner), semnarea (exemplar al proiectului, cu SHA-256), transmiterea DOAR prin comunicare
  const act = await rpc(db, 'mp1', 'act', D1, null, null, { tip: 'notificare', sens: 'iesire', titlu: 'Notificare de revendicare', nr_iesire: 'NR 1/2026', zile_solicitate: null, suma_a: 1250.5, moneda: 'RON' }, K())
  ok('S12a ciorna actului', act.ok && act.rand.stare === 'ciorna' && act.rand.suma_a === 1250.5 && act.rand.zile_solicitate === null, JSON.stringify(act))
  const A1 = act.rand.id
  const vA = async (id) => (await pg(`SELECT versiune FROM public.executie_revendicare_acte WHERE id = $1`, [id]))[0].versiune
  await refuz('S12b suma cu 3 zecimale (ar fi rotunjită)', '22023', () => rpc(db, 'mp1', 'act', D1, null, null, { tip: 'notificare', sens: 'iesire', titlu: 'x', suma_a: 1.005, moneda: 'RON' }, K()), /cel mult 2 zecimale/)
  await refuz('S12c numărul de ieșire dublat (forma canonică)', '23505', () => rpc(db, 'mp1', 'act', D1, null, null, { tip: 'dezacord', sens: 'iesire', titlu: 'x', nr_iesire: 'nr1/2026' }, K()), /numarul de iesire/)
  await refuz('S12d sens greșit pentru tip (CHECK)', '23514', () => rpc(db, 'mp1', 'act', D1, null, null, { tip: 'notificare', sens: 'intrare', titlu: 'x' }, K()))
  await rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'de_aprobat', {}, K())
  await refuz('S12e administratorul nu aprobă', '42501', async () => rpc(db, 'admin', 'act_stare', A1, await vA(A1), 'aprobat', {}, K()), /aprobare/)
  await refuz('S12f MP-ul nu aprobă', '42501', async () => rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'aprobat', {}, K()))
  // temeiul invalidat (reperul schimbat iar) blochează aprobarea
  await pg(`UPDATE public.executie_contract_repere SET citat = 'iar modificat' WHERE id = $1`, [reperP1])
  await refuz('S12g fără temei confirmat și valabil nu se aprobă', '22023', async () => rpc(db, 'owner', 'act_stare', A1, await vA(A1), 'aprobat', {}, K()), /temeiurile dosarului nu sunt toate confirmate/)
  await rpc(db, 'admin', 'reper', D1, 'confirma', L1, (await pg(`SELECT versiune FROM public.executie_revendicare_repere WHERE id = $1`, [L1]))[0].versiune, { reper_versiune: 3 }, K())
  const ap = await rpc(db, 'owner', 'act_stare', A1, await vA(A1), 'aprobat', {}, K())
  ok('S12h owner-ul aprobă (revizia și amprenta fixate)', ap.ok && ap.rand.stare === 'aprobat' && ap.rand.aprobat_de === U.owner && ap.rand.aprobat_revizie === 1)
  await refuz('S12i aprobarea nu înseamnă transmitere', '22023', async () => rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'transmis', {}, K()), /tranzitie nepermisa/)
  await refuz('S12j semnarea cu exemplarul altui proiect', '42501', async () => rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'semnat', { fisier_semnat_doc_id: doc2 }, K()))
  await refuz('S12k exemplar fără SHA-256', '22023', async () => rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'semnat', { fisier_semnat_doc_id: docFaraHash }, K()), /SHA-256/)
  await refuz('S12l comunicare pe un act nesemnat', '22023', async () => rpc(db, 'mp1', 'comunicare', A1, null, await vA(A1), { destinatar: 'Beneficiar', canal: 'registratura', data_transmitere: '2026-03-20' }, K()))
  const sm = await rpc(db, 'mp1', 'act_stare', A1, await vA(A1), 'semnat', { fisier_semnat_doc_id: doc1 }, K())
  ok('S12m semnat, cu SHA-256 copiat', sm.ok && sm.rand.stare === 'semnat' && sm.rand.fisier_semnat_sha256 === SHA1)
  await refuz('S12n etapa „notificat” fără notificare transmisă', '22023', async () => rpc(db, 'mp1', 'etapa', D1, await vD1(), 'notificat', null, K()), /transmis/)
  await refuz('S12o comunicare cu data în viitor', '22023', async () => rpc(db, 'mp1', 'comunicare', A1, null, await vA(A1), { destinatar: 'Beneficiar', canal: 'registratura', data_transmitere: '2099-01-01' }, K()), /viitor/)
  const cm = await rpc(db, 'mp1', 'comunicare', A1, null, await vA(A1), { destinatar: 'Beneficiar', canal: 'registratura', data_transmitere: '2026-03-20' }, K())
  const sa = (await pg(`SELECT stare, transmis_la::text AS t FROM public.v_executie_revendicare_acte WHERE id = $1`, [A1]))[0]
  ok('S12p comunicarea înregistrată = act transmis (data transmiterii)', cm.ok && sa.stare === 'transmis' && sa.t === '2026-03-20', JSON.stringify(sa))
  const et = await rpc(db, 'mp1', 'etapa', D1, await vD1(), 'notificat', null, K())
  ok('S12q etapa „notificat” după transmitere', et.ok && et.rand.etapa === 'notificat')
  await refuz('S12r tranziție inexistentă', '22023', async () => rpc(db, 'mp1', 'etapa', D1, await vD1(), 'acord', null, K()), /tranzitie nepermisa/)
  await refuz('S12s completarea unui câmp deja completat', '22023', async () => rpc(db, 'mp1', 'comunicare', A1, cm.rand.id, cm.rand.versiune, { data_primire: '2026-03-21' }, K()).then(async () =>
    rpc(db, 'mp1', 'comunicare', A1, cm.rand.id, cm.rand.versiune + 1, { data_primire: '2026-03-22' }, K())), /deja completat/)
  await refuz('S12t MP-ul nu anulează o comunicare', '42501', async () => rpc(db, 'mp1', 'comunicare', A1, cm.rand.id,
    (await pg(`SELECT versiune FROM public.executie_revendicare_comunicari WHERE id = $1`, [cm.rand.id]))[0].versiune, { anulat: true, motiv: 'gresit' }, K()))
  // termenul C1 îndeplinit cu actul transmis la 2026-03-20 (înainte de 04-09). Runda 2 (verdict P1-3): reperul s-a schimbat la S12g și
  // legătura a fost reconfirmată pe versiunea 3, dar regula termenului e încă pe versiunea 2 -> sursa termenului e de reverificat, deci
  // „îndeplinit” NU se poate afișa (runda 1 aștepta greșit „indeplinit” aici).
  const ti = await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'indeplinit', { act_id: A1 }, K())
  ok('S12u termen îndeplinit, dar sursa lui schimbată = „sursa_de_reverificat”, nu „indeplinit”', ti.ok && (await vt(T1)).stare_calcul === 'sursa_de_reverificat',
     JSON.stringify(await vt(T1)))
  // redeschis (administrare), regula reconfirmată pe versiunea 3, data reconfirmată, îndeplinit din nou -> „indeplinit”
  await rpc(db, 'admin', 'termen_confirma', T1, await vT(T1), 'redeschide', { motiv: 'sursa reconfirmata' }, K())
  await rpc(db, 'admin', 'termen_confirma', T1, await vT(T1), 'regula', {}, K())
  await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'data', { data: '2026-04-09' }, K())
  const ti2 = await rpc(db, 'mp1', 'termen_confirma', T1, await vT(T1), 'indeplinit', { act_id: A1 }, K())
  ok('S12u2 sursa reconfirmată + îndeplinit cu actul transmis 2026-03-20 = „indeplinit”', ti2.ok && (await vt(T1)).stare_calcul === 'indeplinit',
     JSON.stringify(await vt(T1)))
  // anularea comunicării (administrare): actul revine la semnat, termenul îndeplinit devine „de verificat”
  const an = await rpc(db, 'admin', 'comunicare', A1, cm.rand.id, (await pg(`SELECT versiune FROM public.executie_revendicare_comunicari WHERE id = $1`, [cm.rand.id]))[0].versiune,
                       { anulat: true, motiv: 'inregistrata gresit' }, K())
  ok('S12v comunicarea anulată: actul înapoi la semnat, termenul de verificat', an.ok && (await pg(`SELECT stare FROM public.executie_revendicare_acte WHERE id = $1`, [A1]))[0].stare === 'semnat'
     && (await vt(T1)).stare_calcul === 'indeplinit_de_verificat')

  // S13 jurnalul: complet și nemodificabil
  const nj = (await pg(`SELECT count(*)::int AS n FROM public.executie_revendicare_jurnal WHERE dosar_id = $1 AND tabel = 'executie_revendicare_acte' AND rand_id = $2`, [D1, A1]))[0].n
  // creare, de aprobat, aprobat, semnat, transmis (comunicarea), semnat (anularea comunicării) = 6; încercările refuzate nu lasă nimic
  ok('S13a fiecare scriere a actului e în jurnal', nj === 6, `rânduri ${nj}`)
  const aut = (await pg(`SELECT autor FROM public.executie_revendicare_jurnal WHERE tabel = 'executie_revendicare_acte' AND rand_id = $1 AND (dupa->>'stare') = 'aprobat' LIMIT 1`, [A1]))[0]
  ok('S13b autorul din auth.uid()', aut && aut.autor === U.owner)
  await refuz('S13c UPDATE pe jurnal (și ca postgres)', '42501', () => pg(`UPDATE public.executie_revendicare_jurnal SET autor = NULL`))
  await refuz('S13d DELETE pe jurnal', '42501', () => pg(`DELETE FROM public.executie_revendicare_jurnal`))
  await refuz('S13e TRUNCATE pe jurnal', '42501', () => pg(`TRUNCATE public.executie_revendicare_jurnal`))
  await refuz('S13f proveniența nu se falsifică pe calea server', '23514', () => pg(`UPDATE public.executie_revendicari SET proiect_id = 2 WHERE id = $1`, [D1]))
  const pv = (await pg(`WITH u AS (UPDATE public.executie_revendicari SET versiune = 1, modificat_de = $2::uuid WHERE id = $1 RETURNING versiune, modificat_de)
                        SELECT versiune > 1 AS v, modificat_de IS NULL AS m FROM u`, [D1, U.owner]))[0]
  ok('S13g versiunea și autorul le pune trigger-ul', pv.v === true && pv.m === true, JSON.stringify(pv))

  // S14 vizibilitatea copiilor urmează proiectul (dosarul final: S18)
  ok('S14a MP-ul altui proiect nu vede actele / termenele / dovezile P1', (await n('mp2', 'executie_revendicare_acte')) === 0
     && (await n('mp2', 'v_executie_revendicare_termene')) === 0 && (await n('mp2', 'executie_revendicare_dovezi')) === 0)
  ok('S14b editorul Execuție (nu MP) nu vede nimic', (await n('editor', 'v_executie_revendicare_acte')) === 0 && (await n('editor', 'executie_revendicare_repere')) === 0)

  // ── runda 2: fiecare secțiune își prinde excepțiile (pe codul din runda 1 un pas refuzat nu oprește restul listei) ──────────────────────
  const sectiune = async (nume, fn) => { try { await fn() } catch (e) { picate.push(`${nume}: EXCEPTIE ${e.code || ''} ${e.message}`) } }
  const vD = async (id) => (await pg(`SELECT versiune FROM public.executie_revendicari WHERE id = $1`, [id]))[0].versiune
  const vRep = async (id) => (await pg(`SELECT versiune FROM public.executie_contract_repere WHERE id = $1`, [id]))[0].versiune
  const vLeg = async (id) => (await pg(`SELECT versiune FROM public.executie_revendicare_repere WHERE id = $1`, [id]))[0].versiune
  const confirmaLeg = async (D, l, rp) => rpc(db, 'admin', 'reper', D, 'confirma', l, await vLeg(l), { reper_versiune: await vRep(rp) }, K())
  const apv = async (id) => (await ca(db, 'mp1', `SELECT aprobare_valida FROM public.v_executie_revendicare_acte WHERE id = $1`, [id]))[0].aprobare_valida
  const reperB = (await pg(`INSERT INTO public.executie_contract_repere (proiect_id, sectiune, cod, titlu, citat)
                            VALUES (1, 'clauza', 'C2', 'Clauza de detaliere', 'text generic 2') RETURNING id::int AS id`))[0].id
  // act de ieșire dus până la „transmis” prin RPC-urile reale (aprobare owner, exemplar semnat, comunicare)
  const transmite = async (D, tip, nr, data) => {
    const id = (await rpc(db, 'mp1', 'act', D, null, null, { tip, sens: 'iesire', titlu: 'Act ' + tip, nr_iesire: nr }, K())).rand.id
    await rpc(db, 'mp1', 'act_stare', id, await vA(id), 'de_aprobat', {}, K())
    await rpc(db, 'owner', 'act_stare', id, await vA(id), 'aprobat', {}, K())
    await rpc(db, 'mp1', 'act_stare', id, await vA(id), 'semnat', { fisier_semnat_doc_id: doc1 }, K())
    const c = await rpc(db, 'mp1', 'comunicare', id, null, await vA(id), { destinatar: 'Beneficiar', canal: 'registratura', data_transmitere: data }, K())
    return { id, com: c.rand.id }
  }

  // S15 (verdict P1-1) lanțul termenelor, prin RPC, pe secvența din verdict. Valori: eveniment 2026-03-10 + 30 = 2026-04-09 (T0);
  //     expirarea lui T0 2026-04-09 + 10 = 2026-04-19 (TB)
  let D3, T0, TB, TC, L3
  await sectiune('S15', async () => {
    D3 = (await dosar('mp1', 1, 'Lant termene', { data_eveniment: '2026-03-10' })).rand.id
    L3 = (await rpc(db, 'mp1', 'reper', D3, 'leaga', null, null, { reper_id: reperP1, rol: 'termen' }, K())).rand.id
    await confirmaLeg(D3, L3, reperP1)
    T0 = (await rpc(db, 'mp1', 'termen', D3, null, null, { tip_obligatie: 'alt', mod: 'regula', declansator_tip: 'data_eveniment',
                                                           declansator_data: '2026-03-10', nr_zile: 30, reper_legatura_id: L3 }, K())).rand.id
    await rpc(db, 'admin', 'termen_confirma', T0, await vT(T0), 'regula', {}, K())
    await rpc(db, 'mp1', 'termen_confirma', T0, await vT(T0), 'declansator', {}, K())
    await rpc(db, 'mp1', 'termen_confirma', T0, await vT(T0), 'data', { data: '2026-04-09' }, K())
    TB = (await rpc(db, 'mp1', 'termen', D3, null, null, { tip_obligatie: 'dezacord', mod: 'regula', declansator_tip: 'expirare_termen', declansator_termen_id: T0,
                                                           declansator_data: '2026-04-09', nr_zile: 10, reper_legatura_id: L3 }, K())).rand.id
    await rpc(db, 'admin', 'termen_confirma', TB, await vT(TB), 'regula', {}, K())
    await rpc(db, 'mp1', 'termen_confirma', TB, await vT(TB), 'declansator', {}, K())
    const tbd = await rpc(db, 'mp1', 'termen_confirma', TB, await vT(TB), 'data', { data: '2026-04-19' }, K())
    ok('S15a expirarea lui T0 (2026-04-09) + 10 = 2026-04-19, confirmat cât T0 e valabil', tbd.ok && tbd.rand.data_confirmata === '2026-04-19'
       && (await vt(TB)).intrari_valide === true, JSON.stringify(await vt(TB)))
    // data evenimentului schimbată: T0 își păstrează data confirmată, dar e de reverificat
    await rpc(db, 'mp1', 'salveaza_dosar', 1, D3, await vD(D3), { titlu: 'Lant termene', data_eveniment: '2026-03-12' }, K())
    const s0 = await vt(T0), sB = await vt(TB)
    ok('S15b T0 cu sursa schimbată: data 2026-04-09 păstrată, „sursa_de_reverificat”', s0.stare_calcul === 'sursa_de_reverificat' && s0.dc === '2026-04-09', JSON.stringify(s0))
    ok('S15c termenul alimentat de T0 = „sursa_de_reverificat” (runda 1: rămânea valabil)', sB.stare_calcul === 'sursa_de_reverificat' && sB.intrari_valide === false, JSON.stringify(sB))
    // secvența exactă din verdict: termen NOU pe data veche a lui T0 -> declanșatorul nu se mai confirmă
    TC = (await rpc(db, 'mp1', 'termen', D3, null, null, { tip_obligatie: 'dezacord', mod: 'regula', declansator_tip: 'expirare_termen', declansator_termen_id: T0,
                                                           declansator_data: '2026-04-09', nr_zile: 10, reper_legatura_id: L3 }, K())).rand.id
    await rpc(db, 'admin', 'termen_confirma', TC, await vT(TC), 'regula', {}, K())
    await refuz('S15d declanșatorul pe data unui termen cu sursa invalidă = refuz', '22023',
      async () => rpc(db, 'mp1', 'termen_confirma', TC, await vT(TC), 'declansator', {}, K()), /termenul precedent e anulat sau sursa lui trebuie reverificata/)
    // data lui TB nu se mai reconfirmă cât lanțul e invalid (data confirmată scoasă pe calea server, ca în S7l)
    await pg(`UPDATE public.executie_revendicare_termene SET data_confirmata = NULL WHERE id = $1`, [TB])
    await refuz('S15e confirmarea datei cere tot lanțul valabil', '22023', async () => rpc(db, 'mp1', 'termen_confirma', TB, await vT(TB), 'data', { data: '2026-04-19' }, K()), /reverificata/)
    // sursa lui T0 refăcută -> lanțul valabil din nou
    await rpc(db, 'mp1', 'salveaza_dosar', 1, D3, await vD(D3), { titlu: 'Lant termene', data_eveniment: '2026-03-10' }, K())
    await rpc(db, 'mp1', 'termen_confirma', TB, await vT(TB), 'data', { data: '2026-04-19' }, K())
    const sB2 = await vt(TB)
    ok('S15f sursa refăcută: TB valabil, 2026-04-19', sB2.intrari_valide === true && sB2.dc === '2026-04-19', JSON.stringify(sB2))
    // anularea precedentului -> dependentul de reverificat
    await rpc(db, 'admin', 'termen_confirma', TC, await vT(TC), 'anulat', { motiv: 'dublura' }, K())
    // ciclurile: T0 -> TB (TB depinde de T0) refuzat prin RPC și pe calea server
    await refuz('S15g ciclu prin RPC = refuz', '23514', async () => rpc(db, 'mp1', 'termen', D3, T0, await vT(T0), { tip_obligatie: 'alt', mod: 'regula',
      declansator_tip: 'expirare_termen', declansator_termen_id: TB, declansator_data: '2026-04-19', nr_zile: 30, reper_legatura_id: L3 }, K()), /ciclu/)
    await refuz('S15h ciclu pe calea server = refuz', '23514', () => pg(`UPDATE public.executie_revendicare_termene SET declansator_tip = 'expirare_termen',
      declansator_termen_id = $2, declansator_data = NULL WHERE id = $1`, [T0, TB]), /ciclu/)
    await refuz('S15i precedentul din alt dosar (calea server) = refuz', '23514', () => pg(`UPDATE public.executie_revendicare_termene SET declansator_tip = 'expirare_termen',
      declansator_termen_id = $2, declansator_data = NULL WHERE id = $1`, [TB, T1]), /nu e in dosar/)
    // un ciclu deja existent (trigger-ul ocolit de administratorul bazei): parcurgerea se termină, lanțul = invalid
    await pg(`ALTER TABLE public.executie_revendicare_termene DISABLE TRIGGER trg_b_executie_revendicare_termen_calc`)
    try {
      await pg(`UPDATE public.executie_revendicare_termene SET declansator_tip = 'expirare_termen', declansator_termen_id = $2 WHERE id = $1`, [T0, TB])
    } finally { await pg(`ALTER TABLE public.executie_revendicare_termene ENABLE TRIGGER trg_b_executie_revendicare_termen_calc`) }
    const sc = await vt(TB)
    ok('S15j ciclu existent = invalid, fără buclă infinită', sc.intrari_valide === false && sc.stare_calcul === 'sursa_de_reverificat', JSON.stringify(sc))
  })

  // S16 (verdict P1-2) aprobarea leagă setul concret de surse: două temeiuri, A = reperul P1, B = reperul nou
  await sectiune('S16', async () => {
    const D4 = (await dosar('mp1', 1, 'Aprobare pe surse')).rand.id
    const la = (await rpc(db, 'mp1', 'reper', D4, 'leaga', null, null, { reper_id: reperP1, rol: 'temei' }, K())).rand.id
    const lb = (await rpc(db, 'mp1', 'reper', D4, 'leaga', null, null, { reper_id: reperB, rol: 'temei' }, K())).rand.id
    await confirmaLeg(D4, la, reperP1)
    await confirmaLeg(D4, lb, reperB)
    const a4 = (await rpc(db, 'mp1', 'act', D4, null, null, { tip: 'notificare', sens: 'iesire', titlu: 'Notificare D4', nr_iesire: 'NR 4/2026' }, K())).rand.id
    await rpc(db, 'mp1', 'act_stare', a4, await vA(a4), 'de_aprobat', {}, K())
    // un temei schimbat, celălalt valabil: runda 1 aproba („măcar un temei”). Pe un act separat, ca restul secțiunii să ruleze oricum.
    const a4x = (await rpc(db, 'mp1', 'act', D4, null, null, { tip: 'dezacord', sens: 'iesire', titlu: 'Dezacord D4' }, K())).rand.id
    await rpc(db, 'mp1', 'act_stare', a4x, await vA(a4x), 'de_aprobat', {}, K())
    await pg(`UPDATE public.executie_contract_repere SET citat = 'text generic 2 modificat' WHERE id = $1`, [reperB])
    await refuz('S16a un temei schimbat (celălalt valabil) = aprobarea refuzată', '22023',
      async () => rpc(db, 'owner', 'act_stare', a4x, await vA(a4x), 'aprobat', {}, K()), /temeiurile dosarului nu sunt toate confirmate/)
    await confirmaLeg(D4, lb, reperB)
    const ap4 = await rpc(db, 'owner', 'act_stare', a4, await vA(a4), 'aprobat', {}, K())
    ok('S16b ambele temeiuri valabile: aprobat, cu amprenta surselor', ap4.ok && /^[0-9a-f]{32}$/.test(ap4.rand.aprobat_surse_amprenta || ''), JSON.stringify(ap4.rand))
    ok('S16c vederea: aprobare valabilă', (await apv(a4)) === true)
    // după aprobare: reperul A schimbat, apoi reconfirmat de administrare
    await pg(`UPDATE public.executie_contract_repere SET citat = 'text generic schimbat dupa aprobare' WHERE id = $1`, [reperP1])
    ok('S16d reperul schimbat: aprobarea nevalabilă', (await apv(a4)) === false)
    await confirmaLeg(D4, la, reperP1)
    ok('S16e reperul reconfirmat după aprobare: aprobarea TOT nevalabilă (runda 1: redevenea valabilă)', (await apv(a4)) === false)
    await refuz('S16f semnarea pe surse schimbate (chiar reconfirmate) = refuz', '22023',
      async () => rpc(db, 'mp1', 'act_stare', a4, await vA(a4), 'semnat', { fisier_semnat_doc_id: doc1 }, K()), /aprobarea nu mai corespunde/)
    // reaprobarea: ciornă (revizia crește) -> de aprobat -> aprobat -> semnat
    await rpc(db, 'mp1', 'act_stare', a4, await vA(a4), 'ciorna', {}, K())
    await rpc(db, 'mp1', 'act_stare', a4, await vA(a4), 'de_aprobat', {}, K())
    await rpc(db, 'owner', 'act_stare', a4, await vA(a4), 'aprobat', {}, K())
    const sm4 = await rpc(db, 'mp1', 'act_stare', a4, await vA(a4), 'semnat', { fisier_semnat_doc_id: doc1 }, K())
    ok('S16g reaprobat pe sursele noi: revizia 2, semnat, aprobare valabilă', sm4.ok && sm4.rand.stare === 'semnat' && sm4.rand.revizie === 2
       && (await apv(a4)) === true, JSON.stringify(sm4.rand))
    // un temei scos după semnare: setul s-a schimbat
    await rpc(db, 'mp1', 'reper', D4, 'scoate', lb, await vLeg(lb), { motiv: 'nu se mai aplica' }, K())
    ok('S16h temei scos după semnare: aprobarea nevalabilă', (await apv(a4)) === false)
  })

  // S17 (verdict P1-3) îndeplinirea: compatibilitatea obligație – act și valabilitatea după anulări (termene manuale: sursa nu intervine)
  let D5, N5
  await sectiune('S17', async () => {
    D5 = (await dosar('mp1', 1, 'Indeplinire')).rand.id
    const l5 = (await rpc(db, 'mp1', 'reper', D5, 'leaga', null, null, { reper_id: reperB, rol: 'temei' }, K())).rand.id
    await confirmaLeg(D5, l5, reperB)
    N5 = await transmite(D5, 'notificare', 'NR 5/2026', '2026-03-20')
    const manual = async (oblig, data) => {
      const id = (await rpc(db, 'mp1', 'termen', D5, null, null, { tip_obligatie: oblig, mod: 'manual', declansator_tip: 'alt' }, K())).rand.id
      await rpc(db, 'admin', 'termen_confirma', id, await vT(id), 'data', { data, justificare: 'stabilit manual' }, K())
      return id
    }
    const tf = await manual('detaliere_finala', '2026-04-30')
    await refuz('S17a o notificare nu închide termenul detalierii finale', '22023',
      async () => rpc(db, 'mp1', 'termen_confirma', tf, await vT(tf), 'indeplinit', { act_id: N5.id }, K()), /actul compatibil/)
    const tn = await manual('notificare', '2026-04-09')
    await rpc(db, 'mp1', 'termen_confirma', tn, await vT(tn), 'indeplinit', { act_id: N5.id }, K())
    const s1 = await vt(tn)
    ok('S17b notificarea transmisă 2026-03-20 îndeplinește termenul notificării (2026-04-09)', s1.stare_calcul === 'indeplinit' && s1.il === '2026-03-20', JSON.stringify(s1))
    // actul anulat (administrare) după îndeplinire; comunicarea lui rămâne neanulată
    await rpc(db, 'admin', 'act_stare', N5.id, await vA(N5.id), 'anulat', { motiv: 'retras' }, K())
    const s2 = await vt(tn)
    ok('S17c actul anulat: termenul „indeplinit_de_verificat” (runda 1: rămânea „indeplinit”)', s2.stare_calcul === 'indeplinit_de_verificat' && s2.il === null, JSON.stringify(s2))
    const tv = (await ca(db, 'mp1', `SELECT transmis_la::text AS t FROM public.v_executie_revendicare_acte WHERE id = $1`, [N5.id]))[0]
    ok('S17d actul anulat nu mai are dată de transmitere', tv.t === null, JSON.stringify(tv))
    const tn2 = await manual('notificare', '2026-04-09')
    await refuz('S17e un act anulat nu mai îndeplinește nimic', '22023',
      async () => rpc(db, 'mp1', 'termen_confirma', tn2, await vT(tn2), 'indeplinit', { act_id: N5.id }, K()), /actul compatibil/)
    // termenul beneficiarului: îndeplinit de actul LUI, primit (2026-03-25 > 2026-03-24 = tardiv)
    const rb = (await rpc(db, 'mp1', 'act', D5, null, null, { tip: 'raspuns_beneficiar', sens: 'intrare', titlu: 'Raspuns', nr_beneficiar: 'B 1' }, K())).rand.id
    await rpc(db, 'mp1', 'comunicare', rb, null, await vA(rb), { destinatar: 'Societatea', canal: 'registratura', data_primire: '2026-03-25' }, K())
    const trp = await manual('raspuns_principiu', '2026-03-24')
    const N6 = await transmite(D5, 'notificare', 'NR 6/2026', '2026-03-22')
    await refuz('S17f notificarea noastră (transmisă, neanulată) nu închide termenul de răspuns al beneficiarului', '22023',
      async () => rpc(db, 'mp1', 'termen_confirma', trp, await vT(trp), 'indeplinit', { act_id: N6.id }, K()), /actul compatibil/)
    await rpc(db, 'mp1', 'termen_confirma', trp, await vT(trp), 'indeplinit', { act_id: rb }, K())
    const s3 = await vt(trp)
    ok('S17g răspunsul primit 2026-03-25 îndeplinește termenul din 2026-03-24, tardiv', s3.stare_calcul === 'indeplinit_tardiv' && s3.il === '2026-03-25', JSON.stringify(s3))
  })

  // S18 (verdict P3) dosarul final (retras) nu se mai modifică prin NICIUN RPC, inclusiv riscul
  await sectiune('S18', async () => {
    const D6 = (await dosar('mp1', 1, 'Dosar retras')).rand.id
    const a6 = (await rpc(db, 'mp1', 'act', D6, null, null, { tip: 'notificare', sens: 'iesire', titlu: 'Act D6' }, K())).rand.id
    const t6 = (await rpc(db, 'mp1', 'termen', D6, null, null, { tip_obligatie: 'alt', mod: 'manual', declansator_tip: 'alt' }, K())).rand.id
    const l6 = (await rpc(db, 'mp1', 'reper', D6, 'leaga', null, null, { reper_id: reperB, rol: 'sursa' }, K())).rand.id
    const v6 = (await rpc(db, 'mp1', 'dovada', D6, null, null, { tip: 'ordin', tinta_id: ord1, rol: 'fapt' }, K())).rand.id
    const et6 = await rpc(db, 'mp1', 'etapa', D6, await vD(D6), 'retras', 'deschis din greseala', K())
    ok('S18a dosarul retras', et6.ok && et6.rand.etapa === 'retras')
    const inchis = /dosarul e inchis/
    for (const [nume, fn] of [
      ['riscul (runda 1: trecea)', async () => rpc(db, 'mp1', 'risc', D6, await vD(D6), 'ridicat', null, K())],
      ['decăderea, de administrare', async () => rpc(db, 'admin', 'risc', D6, await vD(D6), 'decadere_constatata', 'motiv', K())],
      ['salvarea dosarului', async () => rpc(db, 'mp1', 'salveaza_dosar', 1, D6, await vD(D6), { titlu: 'Dosar retras' }, K())],
      ['legarea unui reper', async () => rpc(db, 'mp1', 'reper', D6, 'leaga', null, null, { reper_id: reperP1, rol: 'temei' }, K())],
      ['confirmarea legăturii', async () => confirmaLeg(D6, l6, reperB)],
      ['act nou', async () => rpc(db, 'mp1', 'act', D6, null, null, { tip: 'dezacord', sens: 'iesire', titlu: 'x' }, K())],
      ['starea actului', async () => rpc(db, 'mp1', 'act_stare', a6, await vA(a6), 'de_aprobat', {}, K())],
      ['comunicarea', async () => rpc(db, 'mp1', 'comunicare', a6, null, await vA(a6), { destinatar: 'Beneficiar', canal: 'posta', data_transmitere: '2026-03-20' }, K())],
      ['termen nou', async () => rpc(db, 'mp1', 'termen', D6, null, null, { tip_obligatie: 'alt', mod: 'manual', declansator_tip: 'alt' }, K())],
      ['confirmarea termenului', async () => rpc(db, 'admin', 'termen_confirma', t6, await vT(t6), 'data', { data: '2026-05-05', justificare: 'x' }, K())],
      ['dovadă nouă', async () => rpc(db, 'mp1', 'dovada', D6, null, null, { tip: 'raport', tinta_id: rap1, rol: 'fapt' }, K())],
      ['scoaterea dovezii', async () => rpc(db, 'mp1', 'dovada', D6, v6, (await pg(`SELECT versiune FROM public.executie_revendicare_dovezi WHERE id = $1`, [v6]))[0].versiune, { motiv: 'x' }, K())],
    ]) await refuz(`S18b dosar retras, ${nume}`, '22023', fn, inchis)
    await refuz('S18c dosar retras, etapa (nicio tranziție din „retras”)', '22023', async () => rpc(db, 'mp1', 'etapa', D6, await vD(D6), 'notificat', null, K()), /tranzitie nepermisa/)
    const rr = (await pg(`SELECT risc_juridic FROM public.executie_revendicari WHERE id = $1`, [D6]))[0].risc_juridic
    ok('S18d riscul dosarului retras neschimbat', rr === 'neevaluat', rr)
  })

  // S19 (verdict, teste) fluxurile REALE ale declanșatorilor: transmiterea și primirea înregistrate prin comunicare, nu prin UPDATE
  await sectiune('S19', async () => {
    const l7 = (await pg(`SELECT id::int AS id FROM public.executie_revendicare_repere WHERE dosar_id = $1 AND rol = 'temei' AND activ`, [D5]))[0].id
    const N7 = await transmite(D5, 'notificare', 'NR 7/2026', '2026-03-20')
    const regula = async (oblig, decl, extra, data, zile) => {
      const id = (await rpc(db, 'mp1', 'termen', D5, null, null, { tip_obligatie: oblig, mod: 'regula', declansator_tip: decl, declansator_data: data,
                                                                   nr_zile: zile, reper_legatura_id: l7, ...extra }, K())).rand.id
      await rpc(db, 'admin', 'termen_confirma', id, await vT(id), 'regula', {}, K())
      return (await rpc(db, 'mp1', 'termen_confirma', id, await vT(id), 'declansator', {}, K())).rand
    }
    const tt = await regula('detaliere_initiala', 'transmitere_act', { declansator_act_id: N7.id }, '2026-03-20', 30)
    ok('S19a transmiterea notificării 2026-03-20 + 30 = 2026-04-19 (prin comunicare)', tt.data_propusa === '2026-04-19', JSON.stringify(tt))
    await refuz('S19b declanșatorul cu altă dată decât transmiterea reală = refuz', '22023', async () => {
      const id = (await rpc(db, 'mp1', 'termen', D5, null, null, { tip_obligatie: 'detaliere_initiala', mod: 'regula', declansator_tip: 'transmitere_act',
                                                                   declansator_act_id: N7.id, declansator_data: '2026-03-21', nr_zile: 30, reper_legatura_id: l7 }, K())).rand.id
      return rpc(db, 'mp1', 'termen_confirma', id, await vT(id), 'declansator', {}, K())
    }, /difera de sursa ei \(2026-03-20\)/)
    const rb = (await pg(`SELECT id::int AS id FROM public.executie_revendicare_acte WHERE dosar_id = $1 AND tip = 'raspuns_beneficiar'`, [D5]))[0].id
    const tp = await regula('dezacord', 'primire_act', { declansator_act_id: rb }, '2026-03-25', 10)
    ok('S19c primirea răspunsului 2026-03-25 + 10 = 2026-04-04 (prin comunicare)', tp.data_propusa === '2026-04-04', JSON.stringify(tp))
    // anularea comunicării notificării (administrare): actul revine la semnat, termenul alimentat de transmitere e de reverificat
    await rpc(db, 'admin', 'comunicare', N7.id, N7.com, (await pg(`SELECT versiune FROM public.executie_revendicare_comunicari WHERE id = $1`, [N7.com]))[0].versiune,
              { anulat: true, motiv: 'inregistrata gresit' }, K())
    const s = await vt(tt.id)
    ok('S19d transmiterea anulată: termenul „sursa_de_reverificat”', s.stare_calcul === 'sursa_de_reverificat', JSON.stringify(s))
  })

  // S20 (verdict, teste) rolurile pe FIECARE RPC: editorul Execuție care nu e MP, MP-ul altui proiect, MP-ul restrâns = același refuz 42501
  await sectiune('S20', async () => {
    const comA1 = (await pg(`SELECT id::int AS id, versiune FROM public.executie_revendicare_comunicari WHERE act_id = $1 ORDER BY id LIMIT 1`, [A1]))[0]
    for (const cine of ['editor', 'mp2', 'mpR']) {
      for (const [nume, fn] of [
        ['salveaza_dosar', async () => rpc(db, cine, 'salveaza_dosar', 1, D1, await vD1(), { titlu: 'x' }, K())],
        ['etapa', async () => rpc(db, cine, 'etapa', D1, await vD1(), 'retras', 'x', K())],
        ['risc', async () => rpc(db, cine, 'risc', D1, await vD1(), 'scazut', null, K())],
        ['reper', async () => rpc(db, cine, 'reper', D1, 'leaga', null, null, { reper_id: reperB, rol: 'sursa' }, K())],
        ['act', async () => rpc(db, cine, 'act', D1, null, null, { tip: 'dezacord', sens: 'iesire', titlu: 'x' }, K())],
        ['act_stare', async () => rpc(db, cine, 'act_stare', A1, await vA(A1), 'anulat', { motiv: 'x' }, K())],
        ['comunicare', async () => rpc(db, cine, 'comunicare', A1, comA1.id, comA1.versiune, { anulat: true, motiv: 'x' }, K())],
        ['termen', async () => rpc(db, cine, 'termen', D1, null, null, { tip_obligatie: 'alt', mod: 'manual', declansator_tip: 'alt' }, K())],
        ['termen_confirma', async () => rpc(db, cine, 'termen_confirma', T1, await vT(T1), 'anulat', { motiv: 'x' }, K())],
        ['dovada', async () => rpc(db, cine, 'dovada', D1, null, null, { tip: 'document', tinta_id: docFaraHash, rol: 'fapt' }, K())],
      ]) await refuz(`S20 ${cine} pe ${nume}`, '42501', fn, /dosarul nu exista sau nu ai drept/)
    }
  })

  // S21 (verdict P2-5) regresia modulului Documente și retenția: un document nelegat se șterge ca înainte; o dovadă SCOASĂ tot blochează
  //     ștergerea țintei (alegerea de arhivare, spec §5)
  await sectiune('S21', async () => {
    const docNou = (await pg(`INSERT INTO public.documente_proiect (proiect_id, nume_fisier, storage_path, hash_sha256) VALUES (1, 'nelegat.pdf', 'p1/nelegat.pdf', NULL)
                              RETURNING id::int AS id`))[0].id
    const del = await eroare(() => pg(`DELETE FROM public.documente_proiect WHERE id = $1`, [docNou]))
    ok('S21a un document nelegat se șterge ca înainte', del === null, JSON.stringify(del))
    const vr = (await pg(`SELECT id::int AS id, versiune FROM public.executie_revendicare_dovezi WHERE dosar_id = $1 AND raport_id = $2 AND activ`, [D1, rap1]))[0]
    await rpc(db, 'mp1', 'dovada', D1, vr.id, vr.versiune, { motiv: 'nu e relevant' }, K())
    await refuz('S21b dovada scoasă blochează în continuare ștergerea raportului (retenție permanentă)', '23503', () => pg(`DELETE FROM public.rapoarte_zilnice WHERE id = $1`, [rap1]))
  })
}

// ── rulare: suita pe migrarea reală ────────────────────────────────────────────────────────────────────────────────────────────────────────
let rau = 0
// o excepție neprinsă în suită (pas de pregătire picat) intră în listă cu verificările picate până atunci
async function ruleazaSuita(text) {
  const db = await bazaNoua()
  const picate = []
  try { await aplicaMig(db, text); await suita(db, picate) } catch (e) { picate.push('EXCEPTIE: ' + (e.code || '') + ' ' + e.message) } finally { await db.close() }
  return picate
}
const real = await ruleazaSuita(MIG)
if (DOAR_SUITA) {
  console.log(`DOAR SUITA pe ${MIG_CALE}: ${real.length} verificări picate`)
  for (const p of real) console.log('  PICAT ' + p)
  process.exit(0)
}
if (real.length) { console.error('SUITA PICATĂ pe migrarea reală:\n  ' + real.join('\n  ')); process.exit(1) }
console.log('suita: OK pe migrarea reală (toate verificările S1–S21)')

// ── 2. mutanții: fiecare trebuie prins de verificarea lui ─────────────────────────────────────────────────────────────────────────────────
const mutanti = [
  ['M1 dreptul fără restricția pe proiect', /^S2f /, [["             AND public.fn_executie_proiect_permis(p_proiect, p_nivel <> 'citire')\n", '']]],
  ['M2 MP = orice cont cu modulul (fără desemnare)', /^S2c /, [['                                     AND p.employee_id = e.mp_employee_id)))))', '                                     OR true)))))']]],
  ['M3 MP fără cererea modulului Execuție', /^S2e /, [["                                   WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin'))\n                      AND EXISTS",
                                                       "                                   WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin'))\n                      OR EXISTS"]]],
  ['M4 ținta documentului fără verificarea proiectului', /^S6f /, [["    IF v_p IS DISTINCT FROM p_proiect THEN RAISE EXCEPTION 'revendicari: tinta nu exista sau nu e in proiectul dosarului' USING ERRCODE = '42501'; END IF;\n    SELECT md5(to_jsonb(t)::text), t.hash_sha256 INTO v_amp, v_sha FROM public.documente_proiect t WHERE t.id = p_id AND t.proiect_id = p_proiect FOR SHARE NOWAIT;",
                                                                    "    SELECT md5(to_jsonb(t)::text), t.hash_sha256 INTO v_amp, v_sha FROM public.documente_proiect t WHERE t.id = p_id FOR SHARE NOWAIT;"]]],
  ['M5 zilele schimbate nu invalidează regula', /^S7n /, [['      NEW.regula_confirmata_la := NULL;\n    END IF;\n    IF (NEW.declansator_tip', '      NULL;\n    END IF;\n    IF (NEW.declansator_tip']]],
  ['M6 ziua în UTC, nu în România', /^S9 C1[01]/, [["  SELECT (p_moment AT TIME ZONE 'Europe/Bucharest')::date", "  SELECT (p_moment AT TIME ZONE 'UTC')::date"]]],
  ['M7 ziua scadentă tratată ca depășită', /^S9 C1[05] /, [["WHEN p_azi = p_data_confirmata THEN 'scadent_azi'", "WHEN p_azi = p_data_confirmata THEN 'depasit_risc_decadere'"]]],
  ['M8 cheia fără amprenta conținutului', /^S4b /, [['  IF c.operatie = p_operatie AND c.amprenta = p_amprenta AND c.creat_de = auth.uid() THEN', '  IF c.operatie = p_operatie AND c.creat_de = auth.uid() THEN']]],
  ['M9 cheia fără contul care a creat-o', /^S4c /, [['  IF c.operatie = p_operatie AND c.amprenta = p_amprenta AND c.creat_de = auth.uid() THEN', '  IF c.operatie = p_operatie AND c.amprenta = p_amprenta THEN']]],
  ['M10 data confirmată diferită acceptată', /^S7g /, [['        IF v_data IS DISTINCT FROM v_t.data_propusa THEN', '        IF false THEN'], ["  IF NEW.data_confirmata IS NOT NULL AND NEW.mod = 'regula' AND NEW.data_confirmata IS DISTINCT FROM NEW.data_propusa THEN", '  IF false THEN']]],
  ['M11 aprobarea la nivel administrare', /^S12e /, [["    ('iesire', 'de_aprobat', 'aprobat', 'aprobare', false),", "    ('iesire', 'de_aprobat', 'aprobat', 'administrare', false),"]]],
  ['M12 aprobarea fără temei confirmat', /^S12g /, [['    IF public.fn_executie_revendicare_surse_valide(v_d.id) IS NOT TRUE THEN', '    IF false THEN']]],
  ['M13 etapa fără actul cerut', /^S12n /, [["  IF v_t.cere_tip IS NOT NULL AND NOT EXISTS (", "  IF false AND NOT EXISTS ("]]],
  ['M14 legătura fără verificarea versiunii reperului', /^S7p /, [['                    AND r.versiune = l.reper_versiune_confirmata\n                    AND public.fn_executie_revendicare_reper_amprenta(r.id) = l.reper_amprenta_confirmata)', '                    )']]],
  ['M15 decăderea constatată de MP', /^S11a /, [["    IF NOT public.fn_executie_revendicare_drept(v_d.proiect_id, 'administrare') THEN\n      RAISE EXCEPTION 'revendicari: constatarea decaderii", "    IF false THEN\n      RAISE EXCEPTION 'revendicari: constatarea decaderii"]]],
  ['M17 comunicarea viitoare acceptată', /^S12o /, [['  IF v_dt > v_azi OR v_dp > v_azi THEN', '  IF false THEN']]],
  // runda 2
  ['M18 validitatea fără lanțul precedentelor', /^S15c /, [['  SELECT public.fn_executie_revendicare_termen_intrari_locale(p_termen) AND public.fn_executie_revendicare_termen_lant_valid(p_termen)',
                                                          '  SELECT public.fn_executie_revendicare_termen_intrari_locale(p_termen)']]],
  ['M19 declanșatorul confirmat fără lanțul valabil', /^S15d /, [['      IF public.fn_executie_revendicare_termen_lant_valid(v_t.id) IS NOT TRUE THEN', '      IF false THEN']]],
  ['M20 ciclul permis', /^S15g /, [['               SELECT 1 FROM lant WHERE lant.id = NEW.id) THEN', '               SELECT 1 FROM lant WHERE false) THEN']]],
  ['M21 aprobarea cu „măcar un temei”', /^S16a /, [["     AND NOT EXISTS (SELECT 1 FROM public.executie_revendicare_repere l WHERE l.dosar_id = p_dosar AND l.rol = 'temei' AND l.activ\n                      AND NOT public.fn_executie_revendicare_legatura_valida(l.id))",
                                                   "     AND EXISTS (SELECT 1 FROM public.executie_revendicare_repere l WHERE l.dosar_id = p_dosar AND l.rol = 'temei' AND l.activ\n                      AND public.fn_executie_revendicare_legatura_valida(l.id))"]]],
  ['M22 aprobarea fără sursele fixate', /^S16[ef] /, [['     AND a.aprobat_surse_amprenta IS NOT DISTINCT FROM public.fn_executie_revendicare_surse_amprenta(a.dosar_id)\n', '']]],
  ['M23 îndeplinirea cu orice act', /^S17a /, [['                  WHERE o.tip_obligatie = p_tip_obligatie AND o.tip_act = a.tip AND o.sens = a.sens)', '                  WHERE true)']]],
  ['M24 actul anulat contează', /^S17c /, [["AND NOT c.anulat AND a.stare <> 'anulat'", 'AND NOT c.anulat'],
                                         ["     AND a.stare = CASE a.sens WHEN 'iesire' THEN 'transmis' ELSE 'primit' END\n", '']]],
  ['M25 „îndeplinit” înaintea sursei', /^S12u |^S9 îndeplinit, sursa/, [["  IF p_intrari_valide IS NOT TRUE THEN RETURN 'sursa_de_reverificat'; END IF;\n  IF p_stare = 'indeplinit' THEN",
                                                                         "  IF p_stare = 'deschis' AND p_intrari_valide IS NOT TRUE THEN RETURN 'sursa_de_reverificat'; END IF;\n  IF p_stare = 'indeplinit' THEN"]]],
  ['M26 riscul pe dosarul final', /^S18b dosar retras, riscul/, [["  IF v_d.etapa IN ('inchis', 'retras') THEN RAISE EXCEPTION 'revendicari: dosarul e inchis' USING ERRCODE = '22023'; END IF;\n  IF v_d.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_d)); END IF;\n  IF p_risc",
                                                                  "  IF v_d.versiune IS DISTINCT FROM p_versiune THEN RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(v_d)); END IF;\n  IF p_risc"]]],
  ['M27 îndeplinirea ignoră actul de intrare (termenul beneficiarului închis de actul nostru)', /^S17f /, [["    ('raspuns_principiu', 'raspuns_beneficiar', 'intrare'),", "    ('raspuns_principiu', 'notificare', 'iesire'),\n    ('raspuns_principiu', 'raspuns_beneficiar', 'intrare'),"]]],
]
// NU se poate prinde în PGlite (o singură conexiune): reverificarea dreptului DUPĂ lock (P2-4). Proba: K4 din
// scripts/executie_revendicari_concurenta.sh, pe clonă.
for (const [nume, test, inl] of mutanti) {
  let picate
  try { picate = await ruleazaSuita(reamprenteaza(aplica(MIG, inl))) } catch (e) { picate = ['APLICARE: ' + e.message] }
  const prins = picate.some((p) => test.test(p))
  if (!prins) rau++
  console.log(`${prins ? 'prins ' : 'SCĂPAT'} ${nume}${prins ? '' : ' — picate: ' + (picate.slice(0, 4).join(' | ') || 'nimic')}`)
}
// mutanții prinși de POSTCONDIȚIILE migrării (aplicarea refuză)
for (const [nume, motiv, inl] of [
  ['P1 politica USING (true)', /post: politicile \(definitia exacta\): .*executie_revendicari\.executie_revendicari_citire/, [["      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_executie_revendicare_drept(proiect_id, ''citire''))', t || '_citire', t);",
                                                                              "      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_citire', t);"]]],
  // runda 2 (verdict P2-6): definițiile exacte
  ['P6 politica „predicat OR true” (păstrează fragmentul căutat în runda 1)', /post: politicile \(definitia exacta\): .*executie_revendicare_acte\.executie_revendicare_acte_citire/,
   [["      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_executie_revendicare_drept(proiect_id, ''citire''))', t || '_citire', t);",
     "      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_executie_revendicare_drept(proiect_id, ''citire'') OR true)', t || '_citire', t);"]]],
  ['P7 trigger-ul calculului doar la INSERT (același număr de trigger-e)', /post: trigger-e \(definitia exacta\): executie_revendicare_termene\.trg_b_executie_revendicare_termen_calc/,
   [['CREATE TRIGGER trg_b_executie_revendicare_termen_calc BEFORE INSERT OR UPDATE ON public.executie_revendicare_termene',
     'CREATE TRIGGER trg_b_executie_revendicare_termen_calc BEFORE INSERT ON public.executie_revendicare_termene']]],
  ['P8 trigger-ul jurnalului cu condiție WHEN (false)', /post: trigger-e \(definitia exacta\): executie_revendicare_jurnal\.trg_executie_revendicare_jurnal_imuabil/,
   [['CREATE TRIGGER trg_executie_revendicare_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.executie_revendicare_jurnal\n  FOR EACH ROW EXECUTE',
     'CREATE TRIGGER trg_executie_revendicare_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.executie_revendicare_jurnal\n  FOR EACH ROW WHEN (false) EXECUTE']]],
  ['P9 corpul dreptului înlocuit după creare (aceleași atribute, alt corp)', /post: functii \(definitia exacta \/ drepturi\): fn_executie_revendicare_drept\(bigint,text\)$/,
   [['-- ── 9. postcondiții', "CREATE OR REPLACE FUNCTION public.fn_executie_revendicare_drept(p_proiect bigint, p_nivel text) RETURNS boolean\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;\n-- ── 9. postcondiții"]]],
  // fostul M16: din runda 2 îl prinde întâi postcondiția exactă a trigger-elor (comportamentul: S13c pe migrarea reală)
  ['P11 (fost M16) jurnalul modificabil: trigger-ul imuabilității doar la DELETE', /post: trigger-e \(definitia exacta\): executie_revendicare_jurnal\.trg_executie_revendicare_jurnal_imuabil$/,
   [['CREATE TRIGGER trg_executie_revendicare_jurnal_imuabil BEFORE UPDATE OR DELETE', 'CREATE TRIGGER trg_executie_revendicare_jurnal_imuabil BEFORE DELETE']]],
  ['P10 cheia străină spre documente fără index', /post: chei straine fara index: executie_revendicare_dovezi\.document_id$/,
   [['CREATE INDEX executie_revendicare_dovezi_document_idx ON public.executie_revendicare_dovezi (document_id);\n', '']]],
  ['P2 EXECUTE lăsat la anon (implicit Supabase)', /post: functii/, [["    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sem);", "    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sem);"]]],
  ['P3 INSERT direct lăsat (implicit Supabase)', /post: privilegii pe executie_revendicari/, [["    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);", "    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);"]]],
  ['P4 altă funcție scrie decăderea', /post: alta functie scrie decaderea/, [["  IF p_stare = 'anulat' THEN RETURN 'anulat'; END IF;", "  IF p_stare = 'anulat' THEN RETURN 'anulat'; END IF;\n  IF p_stare = 'x' THEN RETURN 'decadere_constatata'; END IF;"]]],
  ['P5 vedere fără security_invoker', /post: vederile/, [['CREATE VIEW public.v_executie_revendicare_acte WITH (security_invoker = on) AS', 'CREATE VIEW public.v_executie_revendicare_acte AS']]],
]) {
  const db = await bazaNoua()
  const e = await eroare(() => aplicaMig(db, reamprenteaza(aplica(MIG, inl))))
  await db.close()
  const bine = e && motiv.test(e.message)
  if (!bine) rau++
  console.log(`${bine ? 'prins ' : 'SCĂPAT'} ${nume}${bine ? '' : ' — ' + (e ? e.message : 'aplicarea a trecut')}`)
}

// ── 3. scenarii de livrare ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function scenariu(nume, motiv, fn) {
  const db = await bazaNoua()
  let e = null
  try { await fn(db) } catch (x) { e = x.message } finally { await db.close() }
  const bine = motiv === null ? e === null : (e !== null && motiv.test(e))
  if (!bine) rau++
  console.log(`${bine ? 'OK    ' : 'GREȘIT'} ${nume}: ${e === null ? 'trecut' : 'refuz: ' + e.slice(0, 200)}`)
}
await scenariu('L1 fără marcajul plafonului = refuz', /PLAFON_TRANZACTIE lipsa/, (db) => aplicaMig(db, MIG, { marcajPlafon: false }))
await scenariu('L2 alt plafon (3000) = refuz', /PLAFON_TRANZACTIE lipsa: 3000\/session/, (db) => aplicaMig(db, MIG, { plafon: 3000 }))
await scenariu('L3 fără marcajul livrării = refuz', /garda start invalida/, (db) => db.exec(`SET transaction_timeout = 2000; BEGIN; ${MIG} COMMIT;`).finally(() => db.exec('ROLLBACK; SET transaction_timeout = 0;').catch(() => {})))
await scenariu('L4 restricția pe proiect schimbată = refuz', /restrictia pe proiect \(20261209a\) difera/, async (db) => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
                 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
  await aplicaMig(db)
})
await scenariu('L5 dependență cu alt tip = refuz', /dependenta lipsa \/ alt tip: documente_proiect.hash_sha256/, async (db) => {
  await db.exec('ALTER TABLE public.documente_proiect ALTER COLUMN hash_sha256 TYPE bytea USING hash_sha256::bytea')
  await aplicaMig(db)
})
await scenariu('L6 reaplicare = refuz', /obiectele exista deja/, async (db) => { await aplicaMig(db); await aplicaMig(db) })
await scenariu('L7 aplicare -> revenire -> reaplicare', null, async (db) => {
  await aplicaMig(db)
  await revino(db)
  const r = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'fn\\_executie\\_revendicare\\_%'`)).rows[0].n
  if (r !== 0) throw new Error('au rămas funcții: ' + r)
  await aplicaMig(db)
})
await scenariu('L8 revenirea refuză cu date', /tabelul executie_revendicari are randuri/, async (db) => {
  await aplicaMig(db)
  await rpc(db, 'mp1', 'salveaza_dosar', 1, null, null, { titlu: 'un dosar' }, K())
  await revino(db)
})
await scenariu('L8m … mutantul fără verificarea „gol” ar șterge dosarul (dovada că verificarea refuză)', null, async (db) => {
  await aplicaMig(db)
  await rpc(db, 'mp1', 'salveaza_dosar', 1, null, null, { titlu: 'un dosar' }, K())
  await revino(db, aplica(REV, [['    IF (r.exists) THEN RAISE EXCEPTION', '    IF false THEN RAISE EXCEPTION']]))
})
await scenariu('L9 revenirea fără plafon = refuz', /revenire: PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db); await revino(db, REV, { marcajPlafon: false }) })
await scenariu('L10 revenirea pe o stare străină (o funcție în plus) = refuz', /starea nu e cea din 20261224a/, async (db) => {
  await aplicaMig(db)
  await db.exec(`CREATE FUNCTION public.fn_executie_revendicare_zz() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;`)
  await revino(db)
})
await scenariu('L11 revenirea cu o vedere străină peste tabele = refuz', /alte obiecte depind/, async (db) => {
  await aplicaMig(db)
  await db.exec(`CREATE VIEW public.zz_v AS SELECT id FROM public.executie_revendicari;`)
  await revino(db)
})
if (rau) { console.error(`${rau} mutanți / scenarii greșite`); process.exit(1) }
console.log('mutanți: toți prinși; scenariile de livrare: toate cu motivul lor')
