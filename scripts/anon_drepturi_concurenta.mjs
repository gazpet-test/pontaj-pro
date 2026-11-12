// Proba de CONCURENȚĂ pentru 20261218a / b (drepturile rolului anon) — DOAR pe CLONĂ PostgreSQL 17, cu DOUĂ sesiuni psql reale (L25).
// Nu atinge producția: garda țintei = system_identifier (pg_control_system()) EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere.
// Rulare (din rădăcina repo-ului, Git Bash / PowerShell; parola din pgpass, niciodată pe linia de comandă):
//   PSQL=<calea psql> node scripts/anon_drepturi_concurenta.mjs --sistem <system_identifier al clonei> [--mutant fara_recitire|fara_coloane]
//        -- -h <host clonă> -p <port> -U postgres -d postgres
// Ce face: citește clona cu scripts/anon_drepturi_citire.sql, pune rândurile BASELINE ale CLONEI în copii temporare ale migrărilor (oid-urile
//   diferă între baze), apoi rulează scenariile. Sesiunea A = migrarea, încadrată ca runnerul cu plafon (SET transaction_timeout = 2000 înainte
//   de BEGIN, READ COMMITTED, marcajele de livrare + plafon în tranzacție). În copia lui A se adaugă DOAR un pg_sleep(1.2) în punctul de
//   fereastră (instrumentare de probă; fișierul din repo nu se schimbă). Sesiunea B = „cealaltă sesiune”, în paralel. Sincronizare pe stări
//   OBSERVATE (pg_stat_activity: A în PgSleep; B blocată de pid-ul lui A în pg_blocking_pids), nu pe timp.
// Scenarii (fiecare: OK / CONTRAR / PROBA_NEFUNCTIONALA = fereastra n-a fost prinsă, rezultatul nu se judecă):
//   R1 a, B COMITE un drept nou (opțiune de acordare) pe o secvență din T1 ÎNTRE calculul listei și blocare -> A refuză „schimbare concurenta”,
//      dreptul lui B rămâne (apoi e scos de probă);
//   R2 a, B încearcă același GRANT DUPĂ blocare -> B stă blocată de A; A comite; B pică („tuple concurrently updated”) SAU (dacă PG17 ar
//      reaplica peste rândul nou) dreptul lui B există după COMMIT-ul lui A. În ambele cazuri: jurnalul = EXACT drepturile lui anon de dinainte;
//   R3 a, B ține deja rândul (GRANT necomis) când pornește A -> A refuză prin lock_timeout (100 ms), nimic schimbat;
//   R4 b, B dă un drept pe o COLOANĂ fără drepturi (rând neblocat) între recitire și REVOKE -> A refuză „drepturi pe coloane schimbate
//      concurent” (sau, dacă B a fost blocată, B pică după COMMIT-ul lui A);
//   R5 b fără concurență -> comite; reveniri b -> a -> TOATE drepturile exact ca la început. Duratele (NOTICE „sfarsit la … ms”) se raportează:
//      peste 1500 ms = ABANDON (nu se aplică pe producție, se împarte).
// Mutanți (--mutant): fara_recitire = recitirea din a dezactivată (R1 trebuie să arate DEFECTUL: A comite, jurnalul nu are dreptul lui B);
//   fara_coloane = verificarea coloanelor din b dezactivată (R4 trebuie să arate DEFECTUL). Ieșire 0 = mutantul PRINS.
// Ieșire: 0 = toate OK (cu --mutant: prins); 1 = CONTRAR; 26 = PROBA NEFUNCȚIONALĂ (prioritar); 22 = altă țintă / altă versiune;
//   23 = jurnalul există deja (starea de plecare nu e „neaplicat”); 2 = argumente; 25 = starea finală diferă de cea de la început (vezi ieșirea).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const PSQL = process.env.PSQL || 'psql'
const argv = process.argv.slice(2), sep = argv.indexOf('--')
if (sep < 0) { console.error('lipsește „--” urmat de conexiune'); process.exit(2) }
const opt = argv.slice(0, sep), CONN = argv.slice(sep + 1)
const val = (n) => { const i = opt.indexOf(n); return i >= 0 ? opt[i + 1] : null }
const SISTEM = val('--sistem'), MUTANT = val('--mutant')
if (!/^\d+$/.test(SISTEM || '') || (MUTANT && !['fara_recitire', 'fara_coloane'].includes(MUTANT))) { console.error('argumente: --sistem <număr> [--mutant fara_recitire|fara_coloane]'); process.exit(2) }

// a doua gardă, înainte de orice conexiune: o gazdă Supabase (producția) = refuz, oricare ar fi --sistem
if (CONN.some(x => /supabase\.(co|com)\b/i.test(x)) || /supabase\.(co|com)\b/i.test(process.env.PGHOST || '')) { console.error('refuz: gazda e Supabase (producția); proba rulează doar pe clonă'); process.exit(22) }
const delay = (ms) => new Promise(r => setTimeout(r, ms))
function psql(args, input, app) {
  return new Promise((res) => {
    const p = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', ...CONN, ...args],
      { env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: app }, windowsHide: true })
    let out = '', err = ''
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', e => res({ code: -1, out, err: err + String(e) }))
    p.on('close', code => res({ code, out, err }))
    p.stdin.end(input ?? '')
  })
}
const q = async (sql, app = 'anon_conc_obs') => {
  const r = await psql(['-t', '-A', '-F', '\t', '-f', '-'], sql, app)
  if (r.code !== 0) throw new Error('interogare picată: ' + r.err.trim())
  return r.out.replace(/\r/g, '').split('\n').filter(Boolean)
}
const caRunner = (nume, text, app) => psql(['-f', '-'], `SET transaction_timeout = 2000;\nBEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);
SELECT set_config('gazpet.plafon_tranzactie', '2000:' || txid_current(), true);
${text}
COMMIT;\n`, app)
async function asteapta(cond, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await delay(40) } return false }
const inSomn = (app) => async () => (await q(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${app}' AND wait_event = 'PgSleep'`))[0] === '1'
const blocataDe = (b, a) => async () => (await q(`SELECT count(*) FROM pg_stat_activity x, pg_stat_activity y
  WHERE x.application_name = '${b}' AND y.application_name = '${a}' AND y.pid = ANY (pg_blocking_pids(x.pid))`))[0] === '1'
const aplica = (t, lista) => { for (const [din, in_] of lista) { if (!t.includes(din)) throw new Error('textul lipsește: ' + din.slice(0, 80)); t = t.split(din).join(in_) } return t }
const INSTANTANEU = `SELECT 'rel ' || c.oid::regclass::text || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(c.relacl) x WHERE n.nspname = 'public'
  UNION ALL SELECT 'col ' || c.oid::regclass::text || '.' || a.attname || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid, unnest(a.attacl) x WHERE n.nspname = 'public'
  UNION ALL SELECT 'def ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-') || ' ' || d.defaclobjtype::text || ' ' || x::text
    FROM pg_default_acl d, unnest(d.defaclacl) x ORDER BY 1;`
const instantaneu = async () => (await q(INSTANTANEU)).join('\n')

const NUME = { a: '20261218a_securitate_anon_drepturi', b: '20261218b_securitate_anon_drepturi_tabele' }
const MIG = { a: citeste('supabase/migrations/20261218a_securitate_anon_drepturi.sql'), b: citeste('supabase/migrations/20261218b_securitate_anon_drepturi_tabele.sql') }
const REV = { a: citeste('supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql'), b: citeste('supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql') }
const SOMN_SQL = 'SELECT pg_sleep(1.2);'
const INJ_A = '-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──'
const REV_A_IN = "  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';"
const REV_B_IN = "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';"
const M_RECITIRE = ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta", "  IF false THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta"]
const M_COLOANE = ['  IF v_col_dupa IS DISTINCT FROM v_col THEN', '  IF false THEN']

const stari = []
const nota = (sc, stare, text) => { stari.push(stare); console.log(`${sc}: ${stare} — ${text}`) }
let curatenie = []   // instrucțiuni de scos drepturile date de B (rulate și la eroare)
let S0G = null       // drepturile de la început (anon + toate celelalte roluri), comparate la final

async function main() {
  const [sis, ver] = (await q(`SELECT (SELECT system_identifier::text FROM pg_control_system()), current_setting('server_version_num')`))[0].split('\t')
  if (sis !== SISTEM) { console.error(`ȚINTĂ GREȘITĂ: system_identifier ${sis} ≠ --sistem`); process.exit(22) }
  if (Number(ver) < 170000 || Number(ver) >= 180000) { console.error(`cere PostgreSQL 17 (clona are ${ver})`); process.exit(22) }
  if ((await q(`SELECT to_regnamespace('securitate_intern') IS NOT NULL`))[0] === 't') { console.error('jurnalul există deja: starea de plecare nu e „neaplicat”'); process.exit(23) }
  // citirea clonei -> BASELINE-ul CLONEI în copii
  const cit = await psql(['-t', '-A', '-F', '\t', '-f', '-'], citeste('scripts/anon_drepturi_citire.sql'), 'anon_conc_citire')
  if (cit.code !== 0) throw new Error('citirea a picat: ' + cit.err.trim())
  const linii = cit.out.replace(/\r/g, '').split('\n').map(l => l.split('\t'))
  const bl = (t) => linii.find(f => f[0] === 'BASELINE' && f[1] === t)?.[4]
  const M = {
    a: aplica(MIG.a, [["    ('T1', NULL::integer, 'DE_COMPLETAT')", bl('T1')]]),
    b: aplica(MIG.b, [["    ('T2', NULL::integer, 'DE_COMPLETAT')", bl('T2')]]),
  }
  if (MUTANT === 'fara_recitire') M.a = aplica(M.a, [M_RECITIRE])
  if (MUTANT === 'fara_coloane') M.b = aplica(M.b, [M_COLOANE])
  const t1 = linii.filter(f => f[0] === 'OBIECT' && f[1] === 'T1' && !/anon=[^;]*\*/.test(f[4]))
  const t2 = linii.filter(f => f[0] === 'OBIECT' && f[1] === 'T2' && f[2].startsWith('tabel '))
  if (!t1.length || !t2.length) { console.error('PROBA_NEFUNCTIONALA: clona n-are secvențe T1 fără opțiune de acordare sau tabele T2'); process.exit(26) }
  const SEQ = t1[0][2].slice('secventa '.length)
  const oids = t2.map(f => /; oid=(\d+);/.exec(f[4])[1]).join(',')
  const [TAB, COL] = (await q(`SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname), quote_ident(a.attname) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NULL
   WHERE c.oid IN (${oids}) AND c.relkind = 'r' ORDER BY c.oid, a.attnum LIMIT 1`))[0].split('\t')
  const GRANT_SEQ = `GRANT SELECT ON SEQUENCE ${SEQ} TO anon WITH GRANT OPTION;`
  const SCOATE_SEQ = `REVOKE GRANT OPTION FOR SELECT ON SEQUENCE ${SEQ} FROM anon;`
  console.log(`clona PG ${ver}; ținte: secvența T1 #1, tabelul T2 cu o coloană fără drepturi (numele rămân în ieșirea de pe server)`)
  const S0 = await instantaneu(); S0G = S0
  const jurnalSeq = async () => (await q(`SELECT array_to_string(drepturi, ',') FROM securitate_intern.anon_revocari WHERE migrare = '20261218a' AND eticheta = 'secventa ${SEQ}'`))[0]
  const anonInainte = (S, obj) => S.split('\n').filter(l => l.startsWith(`rel ${obj} anon=`)).map(l => l.split(' ')[2]).sort().join(',')

  // ── R1: B comite între calcul și blocare ──
  if (MUTANT !== 'fara_coloane') {
    const A = caRunner(NUME.a, aplica(M.a, [[INJ_A, SOMN_SQL + '\n' + INJ_A]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R1', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
    else {
      curatenie.push(SCOATE_SEQ)
      const b = await psql(['-c', GRANT_SEQ], null, 'anon_conc_B')
      const inca = await inSomn('anon_conc_A')()
      const a = await A
      if (b.code !== 0 || !inca) nota('R1', 'PROBA_NEFUNCTIONALA', `B ${b.code === 0 ? 'a terminat după fereastră' : 'a picat: ' + b.err.trim()}`)
      else if (MUTANT === 'fara_recitire') {
        const j = a.code === 0 ? await jurnalSeq() : null
        nota('R1', a.code === 0 && j && !j.includes('*') ? 'OK' : 'CONTRAR', a.code === 0 ? `mutant: A a comis, jurnalul secvenței = ${j} (fără dreptul lui B) — DEFECT reprodus, mutant prins` : 'mutant: A a refuzat (' + a.err.trim().slice(0, 160) + ')')
        if (a.code === 0) { const r = await caRunner(NUME.a + '_ROLLBACK', REV.a, 'anon_conc_rev'); if (r.code !== 0) throw new Error('revenirea a după mutant: ' + r.err.trim()) }
      } else nota('R1', a.code !== 0 && /schimbare concurenta/.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? 'A refuză: ' + a.err.trim().split('\n').find(l => /ERROR/.test(l)) : 'A A COMIS (fereastra deschisă)')
      await q(SCOATE_SEQ); curatenie = curatenie.filter(x => x !== SCOATE_SEQ)
    }
    if (await instantaneu() !== S0) throw new Error('după R1 drepturile nu sunt cele de la început')
  }
  if (MUTANT === 'fara_recitire') return
  // ── R3: B ține deja rândul (necomis) ──
  if (!MUTANT) {
    const B = psql(['-f', '-'], `BEGIN; ${GRANT_SEQ} SELECT pg_sleep(4); ROLLBACK;`, 'anon_conc_B')
    if (!await asteapta(inSomn('anon_conc_B'))) nota('R3', 'PROBA_NEFUNCTIONALA', 'B nu ține rândul')
    else {
      const t0 = Date.now(); const a = await caRunner(NUME.a, M.a, 'anon_conc_A'); const dt = Date.now() - t0
      nota('R3', a.code !== 0 && /lock timeout|lock_timeout|concurrently/i.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? `A refuză în ${dt} ms: ${a.err.trim().split('\n').find(l => /ERROR/.test(l))}` : 'A A COMIS peste un GRANT în zbor')
    }
    await B
    if (await instantaneu() !== S0) throw new Error('după R3 drepturile nu sunt cele de la început')
  }
  // ── R2: B încearcă după blocare (doar fără mutant) / altfel a normal ──
  let Sa
  if (!MUTANT) {
    const A = caRunner(NUME.a, aplica(M.a, [[REV_A_IN, '  PERFORM pg_sleep(1.2);\n' + REV_A_IN]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R2', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
    else {
      curatenie.push(SCOATE_SEQ)
      const B = psql(['-c', `SET lock_timeout = '10s'; ${GRANT_SEQ}`], null, 'anon_conc_B')
      const blocata = await asteapta(blocataDe('anon_conc_B', 'anon_conc_A'), 1000)
      const inca = await inSomn('anon_conc_A')()
      const a = await A, b = await B
      const j = a.code === 0 ? await jurnalSeq() : null
      const corect = j === anonInainte(S0, SEQ)
      const dupa = (await q(`SELECT has_sequence_privilege('anon', '${SEQ}', 'SELECT WITH GRANT OPTION')`))[0] === 't'
      if (!blocata || !inca) nota('R2', 'PROBA_NEFUNCTIONALA', `B ${blocata ? '' : 'NU '}a fost văzută blocată de A cât A era în fereastră`)
      else if (a.code === 0 && corect && ((b.code !== 0 && /concurrently/.test(b.err)) || (b.code === 0 && dupa)))
        nota('R2', 'OK', `B blocată de A; A comite cu jurnalul exact; B ${b.code !== 0 ? 'pică: ' + b.err.trim().split('\n').find(l => /ERROR/.test(l)) : 'trece DUPĂ COMMIT, peste starea nouă (nimic pierdut)'}`)
      else nota('R2', 'CONTRAR', `A cod ${a.code}, jurnal exact ${corect}, B cod ${b.code} (${b.err.trim().slice(0, 160)}), drept B după ${dupa}`)
      if (dupa) await q(SCOATE_SEQ)
      curatenie = curatenie.filter(x => x !== SCOATE_SEQ)
      if (a.code !== 0) { const r = await caRunner(NUME.a, M.a, 'anon_conc_A'); if (r.code !== 0) throw new Error('a normal: ' + r.err.trim()) }
    }
  } else {
    const r = await caRunner(NUME.a, M.a, 'anon_conc_A'); if (r.code !== 0) throw new Error('a normal: ' + r.err.trim())
  }
  Sa = await instantaneu()
  // ── R4: coloana neblocată ──
  {
    const A = caRunner(NUME.b, aplica(M.b, [[REV_B_IN, '  PERFORM pg_sleep(1.2);\n' + REV_B_IN]]), 'anon_conc_A')
    if (!await asteapta(inSomn('anon_conc_A'))) { nota('R4', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
    else {
      const SCOATE_COL = `REVOKE SELECT (${COL}) ON ${TAB} FROM anon;`
      curatenie.push(SCOATE_COL)
      const B = psql(['-c', `SET lock_timeout = '10s'; GRANT SELECT (${COL}) ON ${TAB} TO anon;`], null, 'anon_conc_B')
      const blocata = await asteapta(blocataDe('anon_conc_B', 'anon_conc_A'), 600)
      const a = await A, b = await B
      const jc = a.code === 0 ? (await q(`SELECT count(*) FROM securitate_intern.anon_revocari j, unnest(j.coloane) c WHERE j.migrare = '20261218b' AND c LIKE '% ${COL.replace(/'/g, "''")} anon=%' AND j.obiect_oid = '${TAB}'::regclass`))[0] : null
      if (MUTANT === 'fara_coloane') {
        nota('R4', a.code === 0 && b.code === 0 && jc === '0' ? 'OK' : 'CONTRAR', a.code === 0 ? `mutant: A a comis, dreptul lui B pe coloană e retras fără jurnal (${jc} rânduri) — DEFECT reprodus, mutant prins` : 'mutant: A a refuzat (' + a.err.trim().slice(0, 160) + ')')
      } else if (b.code === 0 && !blocata) nota('R4', a.code !== 0 && /coloane schimbate concurent/.test(a.err) ? 'OK' : 'CONTRAR', a.code !== 0 ? 'B neblocată (rând de coloană neblocat, ca în PGlite); A refuză: ' + a.err.trim().split('\n').find(l => /ERROR/.test(l)) : 'A A COMIS cu dreptul lui B scos fără jurnal')
      else if (blocata) nota('R4', a.code === 0 && b.code !== 0 ? 'OK' : 'CONTRAR', `B a fost BLOCATĂ (pe PG17 rândul era blocat); A cod ${a.code}, B cod ${b.code}: ${b.err.trim().slice(0, 120)}`)
      else nota('R4', 'PROBA_NEFUNCTIONALA', 'B a picat: ' + b.err.trim().slice(0, 160))
      if (a.code === 0) { const r = await caRunner(NUME.b + '_ROLLBACK', REV.b, 'anon_conc_rev'); if (r.code !== 0) throw new Error('revenirea b după R4: ' + r.err.trim()) }
      await q(SCOATE_COL); curatenie = curatenie.filter(x => x !== SCOATE_COL)
    }
    if (await instantaneu() !== Sa) throw new Error('după R4 drepturile nu sunt cele de după a')
  }
  if (MUTANT) return
  // ── R5: b fără concurență, apoi revenirile, cu duratele ──
  const ms = (r) => (/sfarsit la (\d+) ms/.exec(r.err) || [])[1]
  const b5 = await caRunner(NUME.b, M.b, 'anon_conc_A')
  const rb = b5.code === 0 ? await caRunner(NUME.b + '_ROLLBACK', REV.b, 'anon_conc_rev') : null
  const okRev = rb?.code === 0 && await instantaneu() === Sa
  const durate = { b: ms(b5), rev_b: rb && ms(rb) }
  nota('R5', b5.code === 0 && okRev ? 'OK' : 'CONTRAR', `b ${b5.code === 0 ? 'comis' : 'PICAT: ' + b5.err.trim().slice(0, 160)}, revenirea b ${okRev ? 'exactă' : 'NU e exactă'}; durate (ms de la BEGIN): ${JSON.stringify(durate)}`)
  for (const [k, v] of Object.entries(durate)) if (Number(v) >= 1500) nota('R5', 'CONTRAR', `ABANDON: ${k} a durat ${v} ms (≥ 1500): nu se aplică, se împarte`)
}

let iesire = 0
try { await main() } catch (e) { console.error('EROARE: ' + e.message); iesire = 26 }
finally {
  for (const s of curatenie) { try { await q(s) } catch { /* deja scos */ } }
  try {   // la final: nimic aplicat (reveniri b -> a dacă au rămas rânduri în jurnal)
    if ((await q(`SELECT to_regnamespace('securitate_intern') IS NOT NULL`))[0] === 't') {
      const m = await q(`SELECT DISTINCT migrare FROM securitate_intern.anon_revocari ORDER BY 1 DESC`)
      for (const x of m) { const k = x.slice(-1); const r = await caRunner(NUME[k] + '_ROLLBACK', REV[k], 'anon_conc_rev'); if (r.code !== 0) { console.error(`revenirea ${k} la final a picat: ${r.err.trim()}`); iesire = 25 } }
    }
    if (S0G !== null && await instantaneu() !== S0G) { console.error('STAREA FINALĂ diferă de cea de la început (drepturi rămase de la probă)'); iesire = 25 }
  } catch (e) { console.error('curățenia finală: ' + e.message); iesire = 25 }
}
if (!iesire) iesire = stari.includes('PROBA_NEFUNCTIONALA') ? 26 : stari.includes('CONTRAR') ? 1 : 0
console.log(`rezultat: ${iesire === 0 ? (MUTANT ? 'mutant PRINS' : 'toate OK') : 'cod ' + iesire} (${stari.join(', ')})`)
process.exit(iesire)
