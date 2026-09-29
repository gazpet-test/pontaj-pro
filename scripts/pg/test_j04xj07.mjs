// Suita EXTINSĂ J04×J07 (COPILOT_REVIEW_PLAN_A_2026-09-29 §2) — teste SQL cu ASSERT pe PostgreSQL 16 LOCAL.
//
//   PGURI_ADMIN=postgres://postgres@127.0.0.1:5440/postgres node scripts/pg/test_j04xj07.mjs [regex-fișiere]
//   (sau, cu clusterul local gestionat automat: bash scripts/test_j04xj07.sh)
//
// Ce face runner-ul:
//   1. (re)creează baza de unică folosință jakv0407_test_jx (doar localhost, doar postgres, doar numele ăsta);
//   2. încarcă schema: fixture-ul R5 + lanțul real de migrări, apoi J04 → J07 de două ori (idempotență),
//      helper-ele supabase/tests/j04xj07/_jx.sql și starea de bază _date.sql — COMMIT în baza de test;
//   3. rulează supabase/tests/j04xj07/NN_*.sql, FIECARE TEST (bloc „-- JX-… ─”) într-o sesiune psql proprie:
//      „BEGIN; … ROLLBACK;” + jx.baza_intacta(ID) (baza e identică după rollback); un test picat nu le oprește pe
//      celelalte. Fișierele marcate „-- @clona” au nevoie de COMMIT-uri reale între două sesiuni: rulează pe o CLONĂ
//      a bazei (CREATE DATABASE … TEMPLATE), ștearsă imediat după;
//   4. pașii „-- @edge j04 <pachet>” / „-- @edge j07 <licitație>” rulează MODULELE REALE ale edge-urilor
//      (verificare.mjs / evalueaza.mjs) ca service_role, exact pașii din index.ts / handler.ts de după poarta de
//      rol (poarta de rol are testele ei Deno), în sesiunea și tranzacția curentă. Bytes-ii din Storage stau în
//      jx.bucket, metadatele în storage.objects (ca în Supabase).
// Nicio conexiune în afara 127.0.0.1; nicio cheie Supabase. Bazele de test se șterg la final (JX_PASTREAZA_BAZA=1
// o păstrează pe cea de bază, pentru depanare); rămân doar rolurile de test la nivel de cluster (anon, authenticated,
// service_role, jx_actor), ca la celelalte harness-uri PG. JX_MUTANT=<nume> = mod mutant (vezi fixtures/j04xj07_mutanti.mjs).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { verificaFisier, ROLURI_DOVEDIT } from '../../supabase/functions/ofertare-pachet-verifica/verificare.mjs'
import { evalueazaTexte, PARSER_VERSION } from '../../supabase/functions/ofertare-poarta-text/evalueaza.mjs'
import { schemaJ04J07, OWNER, EDITOR, DENIED, FUNCTII } from './fixtures/j04xj07_schema.mjs'
import { MUTANTI } from './fixtures/j04xj07_mutanti.mjs'

const DIR = new URL('../../supabase/tests/j04xj07/', import.meta.url)
const citeste = n => readFileSync(new URL(n, DIR), 'utf8').replaceAll('\r\n', '\n')
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const ACTOR = 'jx_actor'
const BAZA = process.env.JX_BAZA || 'jakv0407_test_jx'
const CLONA = BAZA + '_clona'
const FILTRU = process.argv[2] || ''
// Mod mutant: o implementare stricată intenționat, aplicată după starea de bază; suita TREBUIE să pice.
const MUTANT = process.env.JX_MUTANT || ''
assert.ok(!MUTANT || MUTANTI[MUTANT], 'Mutant necunoscut: ' + MUTANT + ' (există: ' + Object.keys(MUTANTI).join(', ') + ')')

// ── roluri: aceleași șiruri ca macro-urile psql din fișierele de test ─────────────────────────────────
const ADMIN = `RESET ROLE; RESET SESSION AUTHORIZATION; SET request.jwt.claims = '{}';`
const ca = (rol, sub) => `${ADMIN} SET SESSION AUTHORIZATION ${ACTOR}; SET ROLE ${rol}; SET request.jwt.claims = ${q(JSON.stringify(sub ? { sub, role: rol } : { role: rol }))};`
const SERVICE = ca('service_role')
const MACRO = {
  admin: ADMIN, editor: ca('authenticated', EDITOR), owner: ca('authenticated', OWNER),
  fara_acces: ca('authenticated', DENIED), anon: ca('anon'), service: SERVICE,
  uid_editor: EDITOR, uid_owner: OWNER, uid_fara_acces: DENIED, parser_edge: PARSER_VERSION,
}
const PREAMBUL = Object.entries(MACRO).map(([k, v]) => `\\set ${k} ${q(v)}`).join('\n') + '\n'

// ── gărzi: doar PG local, doar postgres, doar bazele noastre ───────────────────────────────────────────
assert.ok(process.env.PGURI_ADMIN, 'Setează PGURI_ADMIN=postgres://postgres@127.0.0.1:<port>/postgres (PG16 local)')
let ADMIN_URI
try { ADMIN_URI = new URL(process.env.PGURI_ADMIN) } catch { throw new Error('PGURI_ADMIN invalid (valoarea nu se afișează)') }
assert.ok(['postgres:', 'postgresql:'].includes(ADMIN_URI.protocol))
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(ADMIN_URI.hostname), 'Doar localhost')
assert.equal(ADMIN_URI.search, ''); assert.equal(ADMIN_URI.hash, '')
assert.equal(decodeURIComponent(ADMIN_URI.username), 'postgres')
assert.match(BAZA, /^jakv0407_test_[a-z0-9_]+$/)
const uri = db => { const u = new URL(ADMIN_URI.href); u.pathname = '/' + db; return u.href }
const ENV = { ...process.env, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'test_j04xj07' }
for (const k of ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE', 'PGOPTIONS']) delete ENV[k]

function psqlAdmin(sql) {   // comenzi scurte pe baza „postgres” (CREATE/DROP DATABASE)
  const r = spawnSync('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', ADMIN_URI.href, '-c', sql],
    { env: ENV, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('psql admin: ' + (r.stderr || r.error?.message))
  return r.stdout.trim()
}

// ── sesiune psql ca proces-pereche: SQL-ul și edge-urile simulate rulează în ACEEAȘI tranzacție ───────────
function sesiune(db, eticheta) {
  const p = spawn('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', uri(db)],
    { env: ENV, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = '', iesit = null, asteapta = null, n = 0
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
  p.stdout.on('data', d => { out += d; asteapta?.() })
  p.stderr.on('data', d => { err += d })
  p.on('exit', cod => { iesit = cod; asteapta?.() })
  p.stdin.on('error', () => {})
  const s = {
    eticheta,
    get stderr() { return err },
    sql(text) {
      const tag = `__JX_${++n}__`
      if (iesit === null) p.stdin.write(text + `\n\\echo ${tag}\n`)
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error(`timeout psql (${eticheta})`)), 120000)
        asteapta = () => {
          const i = out.indexOf(tag + '\n')
          if (i >= 0) { clearTimeout(t); asteapta = null; const r = out.slice(0, i); out = out.slice(i + tag.length + 1); res(r.split('\n').filter(Boolean)) }
          else if (iesit !== null) {
            clearTimeout(t); asteapta = null
            // stderr poate sosi după exit; îl lăsăm să se golească.
            setTimeout(() => rej(new Error(err.split('\n').filter(l => /ERROR|FAIL|DETAIL|CONTEXT|HINT/.test(l)).join('\n') || `psql a ieșit (${iesit})`)), 50)
          }
        }
        asteapta()
      })
    },
    async val(text) { return (await s.sql(text))[0] },
    async inchide() { p.stdin.end(); if (iesit === null) await new Promise(r => p.on('exit', r)); await new Promise(r => setTimeout(r, 20)); return iesit },
  }
  return s
}

// ── edge J04 (index.ts după poarta de rol): pachet aprobat → manifest pe ROLURI_DOVEDIT (ordonat după id) →
//    verificaFisier REAL (snapshot prin RPC-ul service_role, download din Storage) → INSERT PASS/REFUZ per fișier.
async function edgeJ04(s, pachet, opt) {
  const st = await s.val(`${SERVICE} SELECT coalesce((SELECT stare FROM ofertare_pt_pachet WHERE id = ${pachet}), '∅');`)
  if (st === '∅') return { status: 404, error: 'Pachet inexistent.' }
  if (st !== 'aprobat') return { status: 409, error: 'Verificarea depunerii cere un pachet aprobat.' }
  const fisiere = (await s.sql(`${SERVICE} SELECT to_jsonb(f)::text FROM (SELECT id, rol, nume, fisier_path, sha256
    FROM ofertare_pt_pachet_fisiere WHERE pachet_id = ${pachet} AND rol = ANY(${q('{' + ROLURI_DOVEDIT.join(',') + '}')}::text[]) ORDER BY id) f;`)).map(JSON.parse)
  const deja = new Set()
  const snapshot = async id => {
    if (opt.snapshot === 'indisponibil') throw new Error('Snapshot indisponibil')
    const r = JSON.parse(await s.val(`${SERVICE} SELECT coalesce(ofertare_pt_fisier_snapshot(${id})::text, 'null');`))
    // „schimba_in_timpul=<cale>”: alt proces rescrie obiectul între primul și al doilea snapshot al fișierului.
    if (opt.schimba_in_timpul && r?.name === opt.schimba_in_timpul && !deja.has(id)) {
      deja.add(id)
      await s.sql(`${ADMIN} SELECT jx.inlocuieste(${q(opt.schimba_in_timpul)}, 'rescris in timpul verificarii');`)
    }
    return r
  }
  const download = async path => {
    const b64 = await s.val(`${ADMIN} SELECT coalesce((SELECT 'b64:' || translate(encode(continut, 'base64'), E'\\n', '') FROM jx.bucket WHERE name = ${q(path)}), '∅');`)
    return b64 === '∅' ? new Response(null, { status: 404 }) : new Response(Buffer.from(b64.slice(4), 'base64'))
  }
  const verificari = []
  for (const f of fisiere) {
    const row = await verificaFisier(f, opt.ca || EDITOR, { snapshot, download })
    await s.sql(`${SERVICE} INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at,
      obj_etag, obj_size, sha256_calculat, sha256_declarat, rezultat, motiv, verificat_de)
      SELECT pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_etag, obj_size, sha256_calculat, sha256_declarat, rezultat, motiv, verificat_de
      FROM jsonb_populate_record(NULL::ofertare_pt_pachet_verificari, ${q(JSON.stringify(row))}::jsonb);`)
    verificari.push({ pachet_fisier_id: f.id, nume: f.nume, rezultat: row.rezultat, motiv: row.motiv })
  }
  const lipsa = ['depus_final', 'dovada_seap'].filter(rol => !fisiere.some(f => f.rol === rol))
  return { status: 200, ok: lipsa.length === 0 && verificari.every(v => v.rezultat === 'PASS'), verificari,
    ...(lipsa.length ? { error: `Lipsesc fișierele cu rol: ${lipsa.join(', ')}.` } : {}) }
}

// ── edge J07 (handler.ts după poarta de rol): sursa + hash DOAR din BD, evaluatorul REAL, 4 rânduri inserate.
//    „parser=<v>” simulează un edge deployat cu altă versiune de parser decât cea din BD.
async function edgeJ07(s, lic, opt) {
  const parser = opt.parser || PARSER_VERSION
  const sursa = JSON.parse(await s.val(`${SERVICE} SELECT coalesce(jx.sursa_text(${lic})::text, 'null');`))
  if (!sursa || !/^[0-9a-f]{64}$/.test(sursa.sursa_hash || '')) return { status: 409, error: 'Sursa indisponibilă; poarta rămâne blocată' }
  if (sursa.parser_version !== parser) return { status: 409, error: 'Versiunea parserului diferă de server; poarta rămâne blocată' }
  const rezultate = evalueazaTexte(sursa.date).map(r => ({ ...r, licitatie_id: lic, parser_version: parser, sursa_hash: sursa.sursa_hash }))
  await s.sql(`${SERVICE} INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
    SELECT x->>'control_code', (x->>'licitatie_id')::bigint, x->>'parser_version', x->>'sursa_hash', x->>'stare', x->'detalii'
    FROM jsonb_array_elements(${q(JSON.stringify(rezultate))}::jsonb) x;`)
  return { status: 200, rezultate }
}

// ── executorul de fișiere: bucăți SQL + directive „-- @…” ──────────────────────────────────────────────
function bucati(text) {
  const out = []; let buf = []
  for (const linie of text.split('\n')) {
    const m = linie.match(/^-- @(edge|sesiune|clona)\b\s*(.*)$/)
    if (!m) { buf.push(linie); continue }
    if (buf.join('').trim()) out.push({ sql: buf.join('\n') })
    buf = []
    out.push({ directiva: m[1], arg: m[2].trim() })
  }
  if (buf.join('').trim()) out.push({ sql: buf.join('\n') })
  return out
}
const optiuni = arg => {
  const [edge, id, ...rest] = arg.split(/\s+/)
  return { edge, id: Number(id), opt: Object.fromEntries(rest.map(x => x.split('='))) }
}
async function executa(sesiuni, text, curenta = 'A') {
  for (const b of bucati(text)) {
    if (b.sql !== undefined) { await sesiuni[curenta].sql(b.sql); continue }
    if (b.directiva === 'clona') continue
    if (b.directiva === 'sesiune') { assert.ok(sesiuni[b.arg], 'Sesiune necunoscută: ' + b.arg); curenta = b.arg; continue }
    const { edge, id, opt } = optiuni(b.arg)
    assert.ok(Number.isSafeInteger(id) && id > 0, 'Directivă @edge invalidă: ' + b.arg)
    const s = sesiuni[curenta]
    const r = edge === 'j04' ? await edgeJ04(s, id, opt) : edge === 'j07' ? await edgeJ07(s, id, opt) : assert.fail('edge necunoscut ' + edge)
    await s.sql(`${ADMIN} SELECT jx.raspuns(${q(edge)}, ${q(JSON.stringify(r))}::jsonb);`)
  }
}
function marcaje(stderr) {
  const m = []
  for (const l of stderr.split('\n')) {
    const x = l.match(/NOTICE:\s+JX_(START|PASS|BAZA|CONSTATARE)\|([^|]*)\|?(.*)$/)
    if (x) m.push({ tip: x[1], id: x[2], text: x[3] })
  }
  return m
}

// ── rulare ─────────────────────────────────────────────────────────────────────────────────────────────
const rezultate = [], constatari = []
let esecuri = 0
// Un test = un bloc „-- JX-… ─” (BEGIN … ROLLBACK + jx.baza_intacta), rulat într-o sesiune psql PROPRIE: un test
// picat nu le oprește pe celelalte. Fișierele „-- @clona” (două sesiuni cu COMMIT-uri) rulează întregi, pe o clonă.
async function ruleazaBloc(nume, text, clona) {
  const db = clona ? CLONA : BAZA
  if (clona) psqlAdmin(`DROP DATABASE IF EXISTS ${CLONA} WITH (FORCE)`), psqlAdmin(`CREATE DATABASE ${CLONA} TEMPLATE ${BAZA}`)
  const sesiuni = { A: sesiune(db, nume + '/A') }
  if (clona) sesiuni.B = sesiune(db, nume + '/B')
  let eroare = null
  try {
    for (const s of Object.values(sesiuni)) await s.sql(PREAMBUL + 'SET client_min_messages = notice;')
    await executa(sesiuni, text)
  } catch (e) { eroare = e }
  for (const s of Object.values(sesiuni)) { const cod = await s.inchide(); if (!eroare && cod !== 0) eroare = new Error(`psql ${s.eticheta} a ieșit cu ${cod}`) }
  if (clona) psqlAdmin(`DROP DATABASE IF EXISTS ${CLONA} WITH (FORCE)`)
  const m = Object.values(sesiuni).flatMap(s => marcaje(s.stderr))
  const pornite = m.filter(x => x.tip === 'START')
  let picate = 0
  for (const t of pornite) {
    const trecut = m.some(x => x.tip === 'PASS' && x.id === t.id)
    const izolat = clona || m.some(x => x.tip === 'BAZA' && x.id === t.id)
    const ok = trecut && izolat
    rezultate.push({ id: t.id, descriere: t.text, ok, fisier: nume, clona })
    if (!ok) picate++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${t.id} — ${t.text}${ok ? '' : (trecut ? ' (izolarea ROLLBACK neconfirmată)' : '')}`)
  }
  for (const c of m.filter(x => x.tip === 'CONSTATARE')) { constatari.push(c); console.log(`CONSTATARE ${c.id} — ${c.text}`) }
  // O eroare fără test picat (ex. în afara unui bloc START…PASS) contează separat: nimic nu trece tăcut.
  if (eroare) console.log(`  ↳ ${nume}: ${String(eroare.message || eroare).replaceAll(ADMIN_URI.href, '[PGURI]')}`)
  esecuri += picate + (eroare && !picate ? 1 : 0)
}
async function ruleazaFisier(nume) {
  const text = citeste(nume)
  const clona = /^-- @clona\b/m.test(text)
  const nStart = (text.match(/jx\.start\(/g) || []).length
  const blocuri = clona ? [text] : text.split(/^(?=-- JX-[\w-]+ ─)/m).filter(b => b.includes('jx.start('))
  // Niciun test nu se pierde la împărțire: fiecare bloc are exact un jx.start, iar totalul se păstrează.
  assert.ok(clona || blocuri.every(b => (b.match(/jx\.start\(/g) || []).length === 1), `${nume}: un bloc de test are mai multe jx.start`)
  assert.equal(clona ? nStart : blocuri.length, nStart, `${nume}: teste pierdute la împărțirea pe blocuri`)
  for (const b of blocuri) await ruleazaBloc(nume, b, clona)
}

try {
  const ver = psqlAdmin('SHOW server_version_num')
  assert.equal(ver.slice(0, 2), '16', 'Se cere PostgreSQL 16 (server_version_num=' + ver + ')')
  psqlAdmin(`DROP DATABASE IF EXISTS ${CLONA} WITH (FORCE)`)
  psqlAdmin(`DROP DATABASE IF EXISTS ${BAZA} WITH (FORCE)`)
  psqlAdmin(`CREATE DATABASE ${BAZA} TEMPLATE template0 ENCODING 'UTF8'`)
  psqlAdmin(`DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ACTOR}') THEN
    CREATE ROLE ${ACTOR} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT; END IF; END $r$`)

  // Schema + helper-e + bază: o singură tranzacție; la orice eroare, nimic.
  const { inainte, migrari } = schemaJ04J07()
  const s = sesiune(BAZA, 'setup')
  await s.sql(PREAMBUL + `SET client_min_messages = warning;
BEGIN;
SET LOCAL statement_timeout = '60s';
DO $g$ BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 16 OR session_user <> 'postgres' OR current_database() <> ${q(BAZA)}
  THEN RAISE EXCEPTION 'Doar PG16 local, baza ${BAZA}, login postgres'; END IF;
  IF current_setting('plpgsql.check_asserts', true) = 'off' THEN RAISE EXCEPTION 'plpgsql.check_asserts trebuie să fie on'; END IF;
END $g$;
CREATE SCHEMA jx;
${inainte}
DO $r$ BEGIN
  IF NOT pg_has_role('${ACTOR}', 'authenticated', 'MEMBER') THEN GRANT authenticated, anon, service_role TO ${ACTOR}; END IF;
END $r$;
${migrari}
${citeste('_jx.sql')}
COMMIT;`)
  await s.sql('SET client_min_messages = notice;')
  await executa({ A: s }, citeste('_date.sql'))
  assert.equal(await s.val(`${ADMIN} SELECT count(*) FROM jx.config WHERE cheie = 'foto_baza';`), '1', 'Starea de bază nu s-a salvat')
  if (MUTANT) { await s.sql(`${ADMIN} BEGIN; ${MUTANTI[MUTANT]} COMMIT;`); console.log(`MUTANT aplicat: ${MUTANT}`) }
  assert.equal(await s.inchide(), 0)
  console.log(`Bază ${BAZA}: schemă + migrări J04→J07 (×2) + helper-e jx + stare de bază (pachet v1 aprobat) — gata.`)

  const fisiere = readdirSync(DIR).filter(f => /^\d\d[a-z]?_.*\.sql$/.test(f) && new RegExp(FILTRU).test(f)).sort()
  assert.ok(fisiere.length, 'Niciun fișier de test (filtru: ' + FILTRU + ')')
  for (const f of fisiere) await ruleazaFisier(f)
} catch (e) {
  esecuri++
  console.error('FAIL setup: ' + String(e?.message || e).replaceAll(ADMIN_URI.href, '[PGURI]'))
} finally {
  try { psqlAdmin(`DROP DATABASE IF EXISTS ${CLONA} WITH (FORCE)`) } catch { /* curățenie best-effort */ }
  if (!process.env.JX_PASTREAZA_BAZA) { try { psqlAdmin(`DROP DATABASE IF EXISTS ${BAZA} WITH (FORCE)`) } catch { /* idem */ } }
}
if (MUTANT) {
  // Ucis = cel puțin un test funcțional (nu doar JX-00, care compară definițiile) a picat.
  const ucigasi = rezultate.filter(r => !r.ok && r.id !== 'JX-00').map(r => r.id)
  console.log(ucigasi.length ? `MUTANT ${MUTANT}: UCIS de ${ucigasi.join(', ')}` : `MUTANT ${MUTANT}: SUPRAVIEȚUIEȘTE — suita nu îl prinde`)
  process.exit(ucigasi.length ? 0 : 1)
}
const cerinte = rezultate.filter(r => !r.id.startsWith('JX-C'))
console.log(`\n${esecuri ? 'FAIL' : 'PASS'} J04×J07 extins: ${rezultate.filter(r => r.ok).length}/${rezultate.length} teste` +
  ` (${cerinte.filter(r => r.ok).length} cerințe + ${rezultate.length - cerinte.length} constatări fixate), ${constatari.length} constatări raportate.` +
  ` Funcții urmărite: ${FUNCTII.length}; parser edge: ${PARSER_VERSION}.`)
process.exitCode = esecuri ? 1 : 0
