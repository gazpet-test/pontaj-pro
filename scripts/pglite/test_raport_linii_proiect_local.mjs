// Proba LOCALĂ a migrării 20261217a (liniile raportului zilnic pe proiectul șantierului citit sub lock) pe PGlite (Postgres în WASM, în memorie) —
// NU atinge nicio bază reală. Tiparul: scripts/pglite/test_raport_rezumat_local.mjs.
// Baza: schema falsă supabase/tests/20261208a_executie_devize_tinte_schelet.sql + 20261027a, 20261201a, 20261208a întregi + 20261216a (cu
//   baseline-ul ei calculat pe schema falsă de scriptul coordonatorului ei și cu plafonul runnerului) = starea producției.
// 1. Harness-ul REAL scripts/test_executie_raport_linii_proiect.sql (cel de pe clonă) printr-un mini-psql (\ir, \set, :ERROR / :SQLSTATE /
//    :'LAST_ERROR_MESSAGE', ON_ERROR_STOP); BASELINE-ul 20261217a calculat pe schema falsă cu scripts/raport_linii_proiect_amprente.sql
//    (tranzacție READ ONLY) și pus în blocul marcat, ca după review.
// 2. MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice la testul lui (L25).
// 3. SCENARII: refuzurile migrării (baseline, plafon, stare de acces schimbată înainte / strecurată după, trigger BEFORE după garda noastră),
//    aplicare -> revenire -> re-aplicare, refuzurile revenirii (+ dovada că verificarea respectivă refuză), lock-ul pe rândul șantierului
//    (xmax) pe calea directă + mutantul fără el, scriptul de date (DOAR citire) pe cazuri plantate.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_raport_linii_proiect_local.mjs
// Limită: PGlite nu are timere și nici concurență reală — așteptările / SKIP LOCKED (refuzul „ocupat” 55P03) / deadlock-ul / 40001 le probează
//   scripts/raport_linii_proiect_concurenta.sh pe clonă (L3, L5–L8 + mutanții cu_asteptare / distributie_fara_lock).
// r4: + garda distribuției (T4d, M12–M15, M17, S19d/e), etichetele noi ale amprentei (S1p/S1q, S6b, S8b, S10b, S11b), costul (S21, S22).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = 'supabase/tests/20261208a_executie_devize_tinte_schelet.sql'
const DEP = ['20261027a_raport_distributie_gaze', '20261201a_executie_noduri_suduri', '20261208a_executie_devize_tinte']
const MIG_REZ = 'supabase/migrations/20261216a_executie_raport_rezumat.sql'
const MIG = 'supabase/migrations/20261217a_executie_raport_linii_proiect.sql'
const REV = 'supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql'
const HARNESS = 'scripts/test_executie_raport_linii_proiect.sql'
const DATE_SCRIPT = 'scripts/raport_linii_proiect_verifica_date.sql'
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const continutBaseline = (t, marcaj) => { const i0 = t.indexOf(marcaj), i = t.indexOf(BL_A, i0) + BL_A.length; return t.slice(i, t.indexOf(BL_B, i)) }
const PLACEHOLDER = continutBaseline(citeste(MIG), '-- >>> BASELINE 20261217a')
const PLACEHOLDER_REZ = continutBaseline(citeste(MIG_REZ), '-- >>> BASELINE 20261216a')
const sectiune = (rel) => {
  const t = citeste(rel), i = t.indexOf('WITH RECURSIVE')
  return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length)
}

// mini-psql: blocurile SQL dintre meta-comenzi merg întregi la server (db.exec); \ir citește fișierul (cu înlocuirile mutantului)
async function ruleazaPsql(db, text, fisier, inlocuiri, jurnal) {
  const v = { ON_ERROR_STOP: '1', ERROR: 'false', SQLSTATE: '00000', LAST_ERROR_MESSAGE: '' }
  const subst = (sql) => sql.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (m, n) => (n in v ? `'${String(v[n]).replace(/'/g, "''")}'` : m))
  const exec = async (sql) => {
    if (!sql.trim()) return
    try {
      await db.exec(subst(sql), { onNotice: (n) => jurnal.push(n.message) })
      v.ERROR = 'false'; v.SQLSTATE = '00000'
    } catch (e) {
      v.ERROR = 'true'; v.SQLSTATE = e.code || 'XX000'; v.LAST_ERROR_MESSAGE = e.message
      if (v.ON_ERROR_STOP === '1') { const er = new Error(`${fisier}: ${e.message}`); er.code = e.code; throw er }
    }
  }
  let buf = ''
  for (const linie of text.split('\n')) {
    const m = /^\\(\S+)\s*(.*)$/.exec(linie)
    if (!m) { buf += linie + '\n'; continue }
    await exec(buf); buf = ''
    const [, cmd, rest] = m
    if (cmd === 'set') {
      const [nume, val] = rest.split(/\s+/, 2)
      v[nume] = val === ':ERROR' ? v.ERROR : val === ':SQLSTATE' ? v.SQLSTATE : val
    } else if (cmd === 'ir') {
      const cale = join(dirname(join(ROOT, fisier)), rest.trim())
      const rel = cale.slice(ROOT.length + 1).replace(/\\/g, '/')
      await exec(aplica(readFileSync(cale, 'utf8').replace(/\r/g, ''), inlocuiri[rel]))
    } else throw new Error('meta-comandă necunoscută: \\' + cmd)
  }
  await exec(buf)
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 80))
    t = t.split(din).join(in_)
  }
  return t
}
async function baseline(db, rel) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try { return (await db.query(sectiune(rel))).rows } finally { await db.exec('ROLLBACK') }
}
// aplicarea ca runnerul cu --plafon-tranzactie-ms 2000: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true); ${mp}\n${text}\nCOMMIT;`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text, o) => caRunner(db, '20261217a_executie_raport_linii_proiect', text, o)
const revino = (db, text, o) => caRunner(db, '20261217a_executie_raport_linii_proiect_ROLLBACK', text, o)

// baza = starea producției: dependențele + 20261216a (baseline-ul ei pe schema falsă, calculat o dată)
let MIG_REZ_B = null
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(citeste(SCHELET))
  for (const n of DEP) {
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '${n}:' || txid_current(), true);\n${citeste('supabase/migrations/' + n + '.sql')}\nCOMMIT;`)
  }
  if (!MIG_REZ_B) {
    const b = await baseline(db, 'scripts/raport_rezumat_amprente.sql')
    MIG_REZ_B = aplica(citeste(MIG_REZ), [[PLACEHOLDER_REZ, b.map(r => r.linie_baseline).join('\n')]])
  }
  await caRunner(db, '20261216a_executie_raport_rezumat', MIG_REZ_B)
  return db
}

const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0, 'scripts/raport_linii_proiect_amprente.sql')
await BAZA0.close()
for (const e of ['functie fn_raport_zilnic_salveaza(bigint,date,jsonb,jsonb,jsonb,integer,uuid)', 'functie fn_raport_rezumat_garda()',
                 'functie fn_raport_rezumat_santier_mutat()', 'tabel raport_lucrari | triggere', 'tabel sites | triggere',
                 'tabel raport_distributie_linii | triggere', 'functie fn_raport_distributie_unitate_check()']) {
  if (!B0.some(r => r.eticheta === e)) { console.error('baseline: lipsește ' + e + ' (am: ' + B0.map(r => r.eticheta).join(', ') + ')'); process.exit(1) }
}
console.log(`baseline L15 20261217a (schema falsă): ${B0.length} etichete — ${B0.map(r => r.eticheta + (r.atentie ? ' [' + r.atentie + ']' : '')).join('; ')}`)
const cuBaseline = (randuri) => [PLACEHOLDER, randuri.map(r => r.linie_baseline).join('\n')]
const MIG_B = aplica(citeste(MIG), [cuBaseline(B0)])

async function ruleaza(inlocuiri = {}) {
  const db = await bazaNoua()
  const jurnal = []
  const inl = { ...inlocuiri, [MIG]: [cuBaseline(B0), ...(inlocuiri[MIG] || [])] }
  try {
    await ruleazaPsql(db, aplica(citeste(HARNESS), inl[HARNESS]), HARNESS, inl, jurnal)
    return { ok: true, jurnal }
  } catch (e) {
    return { ok: false, eroare: e.message, jurnal }
  } finally { await db.close() }
}

// ── 0. amprenta corpului fiecărei funcții (cea din revenire trebuie să fie exact aceasta) ──
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  for (const [fn, eticheta] of [['fn_raport_lucrari_proiect_garda', 'garda liniilor'], ['fn_raport_distributie_proiect_garda', 'garda distributiei']]) {
    const amp = (await db.query(`SELECT md5(replace(prosrc, chr(13), '')) AS m FROM pg_proc WHERE oid = 'public.${fn}()'::regprocedure`)).rows[0].m
    const din = new RegExp(`-- AMPRENTA-START ${eticheta}\\n\\s*'([0-9a-f]{32})',\\n\\s*-- AMPRENTA-END ${eticheta}\\n`).exec(citeste(REV))
    console.log(`amprenta corpului ${fn}: ${amp} (revenirea: ${din && din[1]})`)
    if (!din || din[1] !== amp) { console.error('revenirea are altă amprentă a corpului decât migrarea: ' + fn); process.exit(1) }
  }
  await db.close()
}

// ── 1. harness-ul pe migrarea reală: toate testele trebuie să treacă ──
const real = await ruleaza()
const oke = real.jurnal.filter((m) => / OK|refuz confirmat|20261217a: (lock-uri|sfarsit)|20261217a revenire: (exclusiv|sfarsit)/.test(m))
console.log(oke.map((m) => '  ' + m).join('\n'))
if (!real.ok) { console.error('HARNESS PICAT: ' + real.eroare + '\n' + real.jurnal.slice(-25).join('\n')); process.exit(1) }
for (const t of ['T0', 'T1', 'TB', 'T2', 'T3', 'T4', 'T4d', 'T5', 'T6a', 'T6b', 'T6']) {
  if (!oke.some((m) => m.startsWith(t + ' OK') || m.startsWith(t + ' refuz confirmat'))) { console.error('lipsește ' + t + ' OK'); process.exit(1) }
}
console.log('harness: OK pe migrarea reală')

// ── 2. mutanții: fiecare trebuie să pice exact la testul lui ──
const M = MIG, R = REV
// r3: al patrulea element (opțional) = ce trebuie să spună eroarea (pică pe REZULTAT, nu doar pe motiv)
const FARA_COMP = ['  IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN\n', '  IF false THEN\n']
// r4: verificările activității / obiectului liniei (textul RAISE le face unice: garda distribuției are aceeași formă pe tronson)
const FARA_ACT = ["  IF v_are_act AND v_act IS DISTINCT FROM v_proiect THEN\n    RAISE EXCEPTION 'raport: activitatea", "  IF false THEN\n    RAISE EXCEPTION 'raport: activitatea"]
const FARA_OB = ["  IF v_are_ob AND v_ob IS DISTINCT FROM v_proiect THEN\n    RAISE EXCEPTION 'raport: obiectul", "  IF false THEN\n    RAISE EXCEPTION 'raport: obiectul"]
// T2 relaxat: acceptă ORICE refuz 22023 al gărzii (ca M1b să arate unde pică pe rezultat, nu pe textul mesajului)
const T2_ORICE_REFUZ = ["  frag text := 'șantierul raportului e acum în alt proiect';\nBEGIN\n  v := pg_temp.t_cu_mutare(",
                        "  frag text := 'raport: ';\nBEGIN\n  v := pg_temp.t_cu_mutare("]
const mutanti = [
  // pe calea RPC fereastra rămâne ÎNCHISĂ (verificarea activității refuză): T2 pică DOAR pe motiv (alt mesaj)
  ['M1 fără comparația proiectului (RPC: refuzul vine din verificarea activității)', 'T2', { [M]: [FARA_COMP] }, /T2 FAIL: raport nou: eroare\|22023\|raport: activitatea/],
  // același mutant, cu T2 acceptând orice refuz: pică pe REZULTAT la cazurile pe care le vede doar comparația (proiect NULL / schimbat)
  ['M1b fără comparația proiectului, T2 relaxat (dovada pe rezultat)', 'T4', { [M]: [FARA_COMP], [HARNESS]: [T2_ORICE_REFUZ] }, /T4 FAIL: doar comparatia/],
  // fără comparație ȘI fără verificarea activității / obiectului: defectul revine pe RPC (liniile pe p1, șantierul în p2)
  ['M11 fără comparație și fără verificarea activității / obiectului (defectul revine)', 'T2', { [M]: [FARA_COMP, FARA_ACT, FARA_OB] }, /T2 FAIL: raport nou: ok\|/],
  ['M2 proiectul luat de pe linie, nu de pe șantier', 'T2', { [M]: [['  SELECT s.proiect_id, pa.id IS NOT NULL, pa.proiect_id,', '  SELECT NEW.proiect_id, pa.id IS NOT NULL, pa.proiect_id,']] }],
  ['M3 fără verificarea activității', 'T4', { [M]: [FARA_ACT] }, /T4 FAIL: doar verificarea activitatii/],
  ['M4 fără verificarea obiectului', 'T4', { [M]: [FARA_OB] }, /T4 FAIL: doar verificarea activitatii/],
  // r4: garda distribuției (T4d o probează SINGURĂ, cu trigger-ul vechi al tronsonului oprit în savepoint)
  ['M12 distribuția fără verificarea tronsonului', 'T4d', { [M]: [["  IF v_are_ob AND v_ob IS DISTINCT FROM v_proiect THEN\n    RAISE EXCEPTION 'raport: tronsonul", "  IF false THEN\n    RAISE EXCEPTION 'raport: tronsonul"]] }, /T4d FAIL: garda distributiei singura/],
  ['M13 distribuția: proiectul luat de pe tronson, nu de pe șantier', 'T4d', { [M]: [['  SELECT s.proiect_id, pu.id IS NOT NULL, pu.proiect_id\n', '  SELECT pu.proiect_id, pu.id IS NOT NULL, pu.proiect_id\n']] }, /T4d FAIL: garda distributiei singura/],
  ['M14 distribuția: trigger-ul doar la INSERT (mutarea rândului pe alt tronson scapă)', 'post', { [M]: [['BEFORE INSERT OR UPDATE OF raport_id, unitate_id ON public.raport_distributie_linii\n', 'BEFORE INSERT ON public.raport_distributie_linii\n']] }],
  ['M15 distribuția: EXECUTE lăsat clienților', 'post', { [M]: [['REVOKE ALL ON FUNCTION public.fn_raport_distributie_proiect_garda() FROM PUBLIC, anon, authenticated, service_role;',
                                                                 'REVOKE ALL ON FUNCTION public.fn_raport_distributie_proiect_garda() FROM anon, service_role;']] }],  ['M5 trigger-ul doar la INSERT (mutarea liniei pe alt proiect scapă)', 'post', { [M]: [['BEFORE INSERT OR UPDATE OF raport_id, proiect_id ON public.raport_lucrari\n', 'BEFORE INSERT ON public.raport_lucrari\n']] }],
  ['M6 UPDATE verificat mereu (liniile istorice nu mai sunt editabile)', 'T3', { [M]: [[
    "  IF TG_OP = 'UPDATE' AND NEW.raport_id IS NOT DISTINCT FROM OLD.raport_id AND NEW.proiect_id IS NOT DISTINCT FROM OLD.proiect_id THEN\n    RETURN NEW;\n  END IF;\n", '']] }],
  ['M7 NULL tratat ca „orice proiect”', 'T4', { [M]: [['  IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN\n', '  IF NEW.proiect_id <> v_proiect THEN\n']] }, /T4 FAIL: doar comparatia/],
  ['M8 EXECUTE lăsat clienților', 'post', { [M]: [['REVOKE ALL ON FUNCTION public.fn_raport_lucrari_proiect_garda() FROM PUBLIC, anon, authenticated, service_role;',
                                                   'REVOKE ALL ON FUNCTION public.fn_raport_lucrari_proiect_garda() FROM anon, service_role;']] }],
  ['M9 revenirea nu verifică drepturile funcției', 'T6b', { [R]: [["                        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')\n", '']] }],
  ['M10 revenirea nu scoate trigger-ul (postcondiția ei)', 'revenire-post', { [R]: [['  DROP TRIGGER trg_raport_lucrari_zz_proiect ON public.raport_lucrari;\n  DROP FUNCTION public.fn_raport_lucrari_proiect_garda();\n', '']] }],
  ['M17 revenirea nu scoate garda distribuției (postcondiția ei)', 'revenire-post', { [R]: [['  DROP TRIGGER trg_raport_distributie_zz_proiect ON public.raport_distributie_linii;\n  DROP FUNCTION public.fn_raport_distributie_proiect_garda();\n', '']] }],
]
let rau = 0
for (const [nume, test, inl, motiv] of mutanti) {
  const r = await ruleaza(inl)
  const picatLa = r.ok ? null : /20261217a post/.test(r.eroare) ? 'post' : /20261217a revenire post/.test(r.eroare) ? 'revenire-post'
    : (/(T[0-9]+[a-z]?|TB) FAIL/.exec(r.eroare) || [])[1] || 'altundeva'
  const bine = !r.ok && picatLa === test && (!motiv || motiv.test(r.eroare))
  if (!bine) rau++
  console.log(`${bine ? 'prins ' : 'SCĂPAT'} ${nume}: ${r.ok ? 'harness-ul a trecut' : 'pică la ' + picatLa}${bine ? '' : ' (așteptat ' + test + ')' + (r.ok ? '' : ' — ' + r.eroare.slice(0, 260))}`)
}

// ── 3. scenarii: fiecare pe o bază nouă; refuzul TREBUIE să vină cu motivul lui ──
async function scenariu(nume, motiv, fn) {
  const db = await bazaNoua()
  let eroare = null
  try { await fn(db) } catch (e) { eroare = e.message }
  finally { await db.close() }
  const bine = motiv === null ? eroare === null : (eroare !== null && motiv.test(eroare))
  if (!bine) rau++
  console.log(`${bine ? 'OK    ' : 'GREȘIT'} ${nume}: ${eroare === null ? 'trecut' : 'refuz: ' + eroare.slice(0, 220)}`)
}
const migCu = (lista) => aplica(MIG_B, lista)
// r2: blocul are de la 4dcb8a8d valorile de PRODUCȚIE lipite (47 de etichete), deci „necompletat” = toate amprentele scoase, ca înainte de
//   lipire (tiparul din test_raport_rezumat_local.mjs), iar blocul din repo pe schema falsă = altă bază = refuz pe diferență
await scenariu('S1 baseline necompletat = refuz', /20261217a: baseline L15 necompletat/, async (db) => {
  if (!/'[0-9a-f]{32}'\)/.test(PLACEHOLDER)) throw new Error('blocul BASELINE din repo nu are amprente de inlocuit')
  await aplicaMig(db, aplica(citeste(MIG), [[PLACEHOLDER, PLACEHOLDER.replace(/'[0-9a-f]{32}'\)/g, "'DE_COMPLETAT')")]]))
})
// r4: blocul din repo are cele 47 de valori de producție + etichetele noi ale distribuției DE_COMPLETAT => refuz „necompletat”; cu ele
//   completate (oricum) pe altă bază => refuz pe diferență
await scenariu('S1p blocul din repo (47 din producție + DE_COMPLETAT) = refuz necompletat', /20261217a: baseline L15 necompletat/, async (db) => { await aplicaMig(db, citeste(MIG)) })
await scenariu('S1q … cu etichetele noi completate, pe altă bază = refuz pe diferență', /starea de acces \(inainte\) difera de baseline/, async (db) => {
  if (!PLACEHOLDER.includes("'DE_COMPLETAT')")) throw new Error('blocul BASELINE din repo nu are etichete DE_COMPLETAT')
  await aplicaMig(db, aplica(citeste(MIG), [[PLACEHOLDER, PLACEHOLDER.split("'DE_COMPLETAT')").join("'00000000000000000000000000000000')")]]))
})
await scenariu('S2 baseline cu o etichetă dublă = refuz', /20261217a: baseline L15 cu etichete duble/, async (db) => {
  await aplicaMig(db, aplica(citeste(MIG), [[PLACEHOLDER, B0.map(r => r.linie_baseline).join('\n') + '\n  , ' + B0[0].linie_baseline.trim()]]))
})
await scenariu('S3 fără plafon (fără marcajul runnerului) = refuz', /PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db, MIG_B, { marcajPlafon: false }) })
await scenariu('S4 alt plafon (3000) = refuz', /PLAFON_TRANZACTIE lipsa: 3000\/session/, async (db) => { await aplicaMig(db, MIG_B, { plafon: 3000 }) })
await scenariu('S5 aplicare corectă: NOTICE-urile de timp, nimic pg_temp rămas', null, async (db) => {
  const j = await aplicaMig(db, MIG_B)
  if (!j.some(m => /^20261217a: lock-uri la \d+ ms/.test(m)) || !j.some(m => /^20261217a: sfarsit la \d+ ms/.test(m))) throw new Error('lipsesc NOTICE-urile de timp: ' + j.join(' | '))
  const tmp = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'amp\\_%'`)).rows[0].n
  if (tmp !== 0) throw new Error('funcțiile pg_temp ale amprentei au rămas: ' + tmp)
  console.log('       ' + j.filter(m => /^20261217a: (lock-uri|sfarsit)/.test(m)).join(' · '))
})
for (const [nume, strica, motiv] of [
  ['S6 o politică în plus pe raport_lucrari', `CREATE POLICY zz_toti ON public.raport_lucrari FOR SELECT TO anon USING (true);`, /\(inainte\) difera.*tabel raport_lucrari \| politici/],
  ['S7 corpul RPC-ului de salvare schimbat', `CREATE OR REPLACE FUNCTION public.fn_raport_lucrari_json(p_raport_id bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT '[]'::jsonb $f$;`, /\(inainte\) difera.*functie fn_raport_lucrari_json\(bigint\)/],
  ['S8 garda rezumatului oprită (ordinea lock-urilor)', `ALTER TABLE public.rapoarte_zilnice DISABLE TRIGGER trg_raport_zilnic_zz_rezumat;`, /\(inainte\) difera.*tabel rapoarte_zilnice \| triggere/],
  ['S9 un trigger în plus pe sites', `CREATE FUNCTION public.zz_s() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$ BEGIN RETURN NULL; END $f$;
     CREATE TRIGGER zz_s AFTER UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.zz_s();`, /\(inainte\) difera.*tabel sites \| triggere/],
  ['S10 drept pe o coloană a liniilor pentru anon', `GRANT SELECT (cantitate) ON public.raport_lucrari TO anon;`, /\(inainte\) difera.*tabel raport_lucrari \| acl coloane/],
  ['S11 un trigger BEFORE ROW după garda noastră (ordinea numelui)', `CREATE FUNCTION public.zz_b() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$ BEGIN RETURN NEW; END $f$;
     CREATE TRIGGER trg_zzz_dupa BEFORE INSERT ON public.raport_lucrari FOR EACH ROW EXECUTE FUNCTION public.zz_b();`, /trigger-e BEFORE ROW necunoscute dupa garda: raport_lucrari\.trg_zzz_dupa/],
  ['S11b un trigger BEFORE ROW după garda distribuției', `CREATE FUNCTION public.zz_b() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$ BEGIN RETURN NEW; END $f$;
     CREATE TRIGGER trg_zzz_dupa BEFORE UPDATE ON public.raport_distributie_linii FOR EACH ROW EXECUTE FUNCTION public.zz_b();`, /trigger-e BEFORE ROW necunoscute dupa garda: raport_distributie_linii\.trg_zzz_dupa/],
  ['S6b o politică în plus pe distribuție (tabel nou în amprentă)', `CREATE POLICY zz_toti ON public.raport_distributie_linii FOR SELECT TO anon USING (true);`, /\(inainte\) difera.*tabel raport_distributie_linii \| politici/],
  ['S10b drept pe o coloană a distribuției pentru anon', `GRANT SELECT (observatii) ON public.raport_distributie_linii TO anon;`, /\(inainte\) difera.*tabel raport_distributie_linii \| acl coloane/],
  ['S8b trigger-ul vechi al tronsonului oprit', `ALTER TABLE public.raport_distributie_linii DISABLE TRIGGER raport_distributie_linii_unitate_check;`, /\(inainte\) difera.*tabel raport_distributie_linii \| triggere/],
  ['S12 RPC-ul de salvare cu alt corp decât cel analizat', `CREATE OR REPLACE FUNCTION public.fn_raport_zilnic_salveaza(p_site bigint, p_data date, p_antet jsonb, p_linii jsonb, p_distributie jsonb, p_versiune integer, p_cheie uuid)
     RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`, /RPC-ul de salvare difera de corpul analizat/],
]) await scenariu(`${nume} = refuz înainte`, motiv, async (db) => { await db.exec(strica); await aplicaMig(db, MIG_B) })
await scenariu('S13 o politică strecurată DUPĂ schimbare = refuz la „după”', /\(dupa\) difera.*tabel raport_lucrari \| politici/, async (db) => {
  await aplicaMig(db, migCu([['-- L15: aceeași amprentă DUPĂ', 'CREATE POLICY zz_toti ON public.raport_lucrari FOR SELECT TO anon USING (true);\n-- L15: aceeași amprentă DUPĂ']]))
})
await scenariu('S14 un al doilea trigger nou pe raport_lucrari = refuz la „după”', /\(dupa\) difera.*tabel raport_lucrari \| triggere|20261217a post: trigger-ul/, async (db) => {
  await aplicaMig(db, migCu([['-- ── postcondiții ──', 'CREATE TRIGGER trg_raport_lucrari_zz_proiect2 BEFORE INSERT ON public.raport_lucrari FOR EACH ROW EXECUTE FUNCTION public.fn_raport_lucrari_proiect_garda();\n-- ── postcondiții ──']]))
})
await scenariu('S15 aplicare → revenire → reaplicare (același baseline)', null, async (db) => {
  await aplicaMig(db, MIG_B)
  const j = await revino(db, citeste(REV))
  if (!j.some(m => /^20261217a revenire: exclusiv la \d+ ms/.test(m)) || !j.some(m => /^20261217a revenire: sfarsit la \d+ ms/.test(m))) throw new Error('revenirea fără NOTICE-urile de timp')
  await aplicaMig(db, MIG_B)
})
await scenariu('S16 revenirea fără plafon = refuz', /revenire: PLAFON_TRANZACTIE lipsa/, async (db) => { await aplicaMig(db, MIG_B); await revino(db, citeste(REV), { marcajPlafon: false }) })
for (const [nume, strica, scoate] of [
  ['corpul funcției schimbat', `CREATE OR REPLACE FUNCTION public.fn_raport_lucrari_proiect_garda() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`,
    ["                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp\n", "                        AND true OR md5(replace(p.prosrc, chr(13), '')) = r.amp\n"]],
  ['corpul gărzii distribuției schimbat', `CREATE OR REPLACE FUNCTION public.fn_raport_distributie_proiect_garda() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;`,
    ["                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp\n", "                        AND true OR md5(replace(p.prosrc, chr(13), '')) = r.amp\n"]],
  ['trigger oprit', 'ALTER TABLE public.raport_lucrari DISABLE TRIGGER trg_raport_lucrari_zz_proiect;',
    ["                         AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgenabled = 'O'\n", "                         AND tg.tgqual IS NULL AND tg.tgnargs = 0\n"]],
  ['trigger-ul distribuției oprit', 'ALTER TABLE public.raport_distributie_linii DISABLE TRIGGER trg_raport_distributie_zz_proiect;',
    ["                         AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgenabled = 'O'\n", "                         AND tg.tgqual IS NULL AND tg.tgnargs = 0\n"]],
  ['configurația funcției (search_path)', 'ALTER FUNCTION public.fn_raport_lucrari_proiect_garda() SET search_path = public;',
    ["AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']\n                        AND NOT has_function_privilege('anon'", "AND true\n                        AND NOT has_function_privilege('anon'"]],
]) {
  await scenariu(`S17 revenire refuză: ${nume}`, /20261217a revenire: starea nu e cea din 20261217a/, async (db) => { await aplicaMig(db, MIG_B); await db.exec(strica); await revino(db, citeste(REV)) })
  await scenariu(`S18 … cu verificarea scoasă, aceeași stare trece (${nume})`, null, async (db) => { await aplicaMig(db, MIG_B); await db.exec(strica); await revino(db, aplica(citeste(REV), [scoate])) })
}
// lock-ul pe rândul ȘANTIERULUI pe calea directă: după INSERT-ul unei linii (cheile străine ale liniei NU ating sites), xmax-ul rândului
// șantierului = tranzacția care scrie linia. (Așteptarea reală + refuzul după mutarea comisă: L3 în scripts/raport_linii_proiect_concurenta.sh.)
const tineSantierul = async (db) => {
  await db.exec(`INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine) VALUES (1, 'Lock test', 'm', 'cantitate', 1);
                 INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (1, DATE '2026-11-10', 'Lock test');`)
  await db.exec('BEGIN;')
  try {
    await db.exec(`INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate)
                   SELECT z.id, 1, (SELECT max(id) FROM public.proiect_activitati), 1 FROM public.rapoarte_zilnice z WHERE z.site_id = 1 AND z.data = DATE '2026-11-10';`)
    const r = (await db.query(`SELECT (SELECT xmax::text FROM public.sites WHERE id = 1) AS xm, (txid_current() % 4294967296)::text AS tx`)).rows[0]
    if (r.xm !== r.tx) throw new Error(`rândul șantierului nu e blocat de scrierea liniei (xmax ${r.xm}, tranzacția ${r.tx})`)
  } finally { await db.exec('ROLLBACK;') }
}
await scenariu('S19 calea directă ține rândul șantierului (FOR SHARE) până la COMMIT', null, async (db) => { await aplicaMig(db, MIG_B); await tineSantierul(db) })
await scenariu('S19b … mutantul fără FOR SHARE pe șantier e prins', /rândul șantierului nu e blocat/, async (db) => {
  await aplicaMig(db, migCu([['     FOR SHARE OF r, s SKIP LOCKED;\n', '     FOR SHARE OF r SKIP LOCKED;\n']]))
  await tineSantierul(db)
})
await scenariu('S19c … și fără migrare (azi) rândul șantierului NU e ținut de calea directă', /rândul șantierului nu e blocat/, async (db) => { await tineSantierul(db) })
// r4: aceeași probă pe distribuție (rândul cu tronson ține șantierul; fără migrare, trigger-ul vechi al tronsonului nu-l ține)
const tineSantierulDistributie = async (db) => {
  await db.exec(`INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine) VALUES (1, 'tronson', 'TLK', 'Lock test', 1);
                 INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (1, DATE '2026-11-11', 'Lock test');`)
  await db.exec('BEGIN;')
  try {
    await db.exec(`INSERT INTO public.raport_distributie_linii (raport_id, tabel, nr_crt, unitate_id)
                   SELECT z.id, 'conducta', 1, (SELECT id FROM public.proiect_unitati WHERE cod = 'TLK') FROM public.rapoarte_zilnice z WHERE z.site_id = 1 AND z.data = DATE '2026-11-11';`)
    const r = (await db.query(`SELECT (SELECT xmax::text FROM public.sites WHERE id = 1) AS xm, (txid_current() % 4294967296)::text AS tx`)).rows[0]
    if (r.xm !== r.tx) throw new Error(`rândul șantierului nu e blocat de scrierea distribuției (xmax ${r.xm}, tranzacția ${r.tx})`)
  } finally { await db.exec('ROLLBACK;') }
}
await scenariu('S19d distribuția cu tronson ține rândul șantierului (FOR SHARE) până la COMMIT', null, async (db) => { await aplicaMig(db, MIG_B); await tineSantierulDistributie(db) })
await scenariu('S19e … și fără migrare (azi) NU îl ține', /rândul șantierului nu e blocat/, async (db) => { await tineSantierulDistributie(db) })

// ── r4 (review P2): costul salvărilor mari, cu scriptul coordonatorului (variantele lui), pe schema falsă — doar tipărit (PGlite e WASM:
//    cifrele arată proporția, nu timpul de pe clonă). Fiecare rulare: o tranzacție anulată, nimic rămas.
const COST = 'scripts/raport_linii_proiect_cost.sql'
const ruleazaCost = async (db, varianta) => {
  const sistem = (await db.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s
  const st = []
  const sql = citeste(COST).split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(":'sistem'", `'${sistem}'`).replace(":'varianta'", `'${varianta}'`)
  await db.exec(sql, { onNotice: (n) => st.push(n.message) })
  const n = (await db.query(`SELECT count(*)::int AS n FROM public.proiect_activitati WHERE nume LIKE 'Activitate cost linii %'`)).rows[0].n
  if (n !== 0) throw new Error('scriptul de cost a lăsat activități: ' + n)
  return st.filter((m) => m.startsWith('COST '))
}
await scenariu('S21 costul salvărilor mari: fără migrare / garda r4 / corpul r3 / garda oprită (50, 200, 500 de linii)', null, async (db) => {
  const inainte = await ruleazaCost(db, 'curenta')
  await aplicaMig(db, MIG_B)
  const r4 = await ruleazaCost(db, 'curenta'), r3 = await ruleazaCost(db, 'r3'), fara = await ruleazaCost(db, 'fara_garda')
  for (const [et, l] of [['fara migrare', inainte], ['r4', r4], ['r3', r3], ['garda oprita', fara]]) {
    if (l.length !== 4) throw new Error(`cost ${et}: ${l.join(' | ')}`)
    console.log(`       [${et}] ` + l.slice(1).map((m) => m.replace(/ \(5 salvari;.*$/, '')).join(' · '))
  }
  if (!/r3 \(in tranzactia anulata\)/.test(r3[0])) throw new Error('varianta r3 nu a pus corpul r3: ' + r3[0])
})
await scenariu('S22 scriptul de cost pe altă țintă = refuz, nimic scris', /REFUZ: system_identifier/, async (db) => {
  await db.exec(citeste(COST).split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(":'sistem'", "'123'").replace(":'varianta'", "'curenta'"))
})

// ── 4. scriptul de date (DOAR citire): cazuri plantate, numărate independent (cazurile sunt construite aici, nu din script) ──
await scenariu('S20 scriptul de date: categoriile pe cazuri plantate', null, async (db) => {
  // șantierul 1 în proiectul 1, șantierul 2 în proiectul 2. Cazurile (scrise ca postgres, înainte de migrare, ca datele vechi):
  //   R1 (s1, 01.11) linii pe p1: corect                          R2 (s1, 02.11) linii pe p2: DIFERĂ de șantier (p1)
  //   R3 (s2, 01.11) linii pe p2, salvat la 10:00                R4 (s2, 02.11) linii pe p1, salvat la 11:00 => după R3 (pe p2): PROBABIL DEFECT
  //   R5 (s2, 03.11) linii pe p1, salvat la 09:00 (înainte de R3): istoric (șantierul mutat după)
  //   R6 (s1, 03.11) linii amestecate (p1 + p2)                  R7 (s1, 04.11) linie pe p1 cu activitatea lui p2
  //   R8 (s1, 05.11) rezumat_proiect_id = 2 ≠ liniile (p1)       D1 distribuție pe R2 cu tronsonul lui p2 (șantierul în p1)
  await db.exec(`
    INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine) VALUES (1, 'A p1', 'm', 'cantitate', 1), (2, 'A p2', 'm', 'cantitate', 1);
    INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine) VALUES (2, 'tronson', 'T2', 'Tronson p2', 1);
    SET session_replication_role = replica;
    INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, updated_at) VALUES
      (1, DATE '2026-11-01', 'R1', '2026-11-01 08:00+00'), (1, DATE '2026-11-02', 'R2', '2026-11-02 08:00+00'),
      (2, DATE '2026-11-01', 'R3', '2026-11-01 10:00+00'), (2, DATE '2026-11-02', 'R4', '2026-11-01 11:00+00'),
      (2, DATE '2026-11-03', 'R5', '2026-11-01 09:00+00'), (1, DATE '2026-11-03', 'R6', '2026-11-03 08:00+00'),
      (1, DATE '2026-11-04', 'R7', '2026-11-04 08:00+00'), (1, DATE '2026-11-05', 'R8', '2026-11-05 08:00+00');
    UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat', rezumat_text = 'x', rezumat_la = now(), rezumat_proiect_id = 2 WHERE probleme = 'R8';
    INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, cantitate)
    SELECT z.id, v.p, (SELECT a.id FROM public.proiect_activitati a WHERE a.nume = v.a), 1
      FROM (VALUES ('R1', 1, 'A p1'), ('R2', 2, 'A p2'), ('R3', 2, 'A p2'), ('R4', 1, 'A p1'), ('R5', 1, 'A p1'),
                   ('R6', 1, 'A p1'), ('R6', 2, 'A p2'), ('R7', 1, 'A p2'), ('R8', 1, 'A p1')) v(r, p, a)
      JOIN public.rapoarte_zilnice z ON z.probleme = v.r;
    INSERT INTO public.raport_distributie_linii (raport_id, tabel, nr_crt, unitate_id)
    SELECT z.id, 'conducta', 1, (SELECT id FROM public.proiect_unitati WHERE cod = 'T2') FROM public.rapoarte_zilnice z WHERE z.probleme = 'R2';
    SET session_replication_role = origin;`)
  const sistem = (await db.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s
  const st = []
  await db.exec(citeste(DATE_SCRIPT).split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(":'sistem'", `'${sistem}'`), { onNotice: (n) => st.push(n.message) })
  const rez = st.find((m) => m.startsWith('LINII_PROIECT '))
  // așteptat (din cazurile de mai sus): liniile cu alt proiect decât șantierul azi = R2 (1) + R4 (1) + R5 (1) + R6 (linia p2: 1) = 4 linii, 4 rapoarte,
  // pe 2 șantiere; probabil defect = salvat DUPĂ un alt raport al aceluiași șantier cu liniile pe proiectul de azi: R2 (după R1), R4 (după R3),
  // R6 (după R1) = 3 — R5 nu (salvat înaintea lui R3: istoric, șantierul mutat după); amestecate = R6; activitate străină = R7;
  // rezumat pe alt proiect decât liniile = R8; distribuție cu tronson străin = 1 (pe R2)
  const ast = 'LINII_PROIECT linii_alt_proiect=4 rapoarte_alt_proiect=4 santiere=2 probabil_defect=3 amestecate=1 activitate_straina=1 rezumat_alt_proiect=1 distributie_tronson_strain=1'
  if (rez !== ast) throw new Error(`scriptul de date: ${rez} ≠ ${ast} | ${st.join(' | ')}`)
  console.log('       ' + rez)
  // a altă țintă = refuz, nimic citit
  let refuz = null
  try { await db.exec(citeste(DATE_SCRIPT).split('\n').filter((l) => !l.startsWith('\\')).join('\n').replace(":'sistem'", "'123'")) } catch (e) { refuz = e.message; try { await db.exec('ROLLBACK') } catch { /* anulată */ } }
  if (!refuz || !/REFUZ: system_identifier/.test(refuz)) throw new Error('scriptul de date pe altă țintă nu a refuzat: ' + refuz)
})
if (rau) { console.error(`${rau} mutanți / scenarii greșite`); process.exit(1) }
console.log('mutanți: toți prinși la testul lor; scenariile: toate cu motivul lor')
