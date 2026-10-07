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
//   4. pașii „-- @edge j04 <pachet>” / „-- @edge j07 <licitație>” rulează HANDLER-ELE REALE ale edge-urilor:
//      creeazaHandler() din ofertare-pachet-verifica/index.ts și handle() din ofertare-poarta-text/handler.ts, cu poarta
//      de rol reală (_shared/poartaOfertare.ts), cu verificare.mjs / evalueaza.mjs reale — deci și codul de legătură
//      (404/409, lista de fișiere, „lipsă”, persistarea) e sub test. Singurele lucruri simulate: clientul Supabase
//      (un „PostgREST” minimal peste sesiunea psql a testului, prin jx.rest: service_role pentru edge, authenticated +
//      JWT pentru poarta de rol, în tranzacția curentă) și download-ul din Storage (bytes-ii stau în jx.bucket,
//      metadatele în storage.objects, ca în Supabase). Statusul HTTP e verificat: implicit 200, altfel „status=NNN”.
//      „parser=<v>” = același cod, „deployat” cu PARSER_VERSION = <v> (copie temporară a edge-urilor).
// Nicio conexiune în afara 127.0.0.1; nicio cheie Supabase. Bazele de test se șterg la final (JX_PASTREAZA_BAZA=1
// o păstrează pe cea de bază, pentru depanare); rămân doar rolurile de test la nivel de cluster (anon, authenticated,
// service_role, jx_actor), ca la celelalte harness-uri PG. JX_MUTANT=<nume> = mod mutant (vezi fixtures/j04xj07_mutanti.mjs):
// un mutant SQL se aplică în baza de test după starea de bază; un mutant edge înlocuiește edge-urile cu o copie stricată.
// Handler-ele sunt TypeScript: e nevoie de Node ≥ 22.18 (type stripping implicit).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { schemaJ04J07, OWNER, EDITOR, DENIED, FUNCTII } from './fixtures/j04xj07_schema.mjs'
import { MUTANTI, MUTANTI_EDGE } from './fixtures/j04xj07_mutanti.mjs'

assert.ok(process.features?.typescript, 'Node ≥ 22.18 necesar (type stripping): runner-ul importă handler-ele .ts reale ale edge-urilor')
const DIR = new URL('../../supabase/tests/j04xj07/', import.meta.url)
const citeste = n => readFileSync(new URL(n, DIR), 'utf8').replaceAll('\r\n', '\n')
const q = s => "'" + String(s).replaceAll("'", "''") + "'"
const ACTOR = 'jx_actor'
const BAZA = process.env.JX_BAZA || 'jakv0407_test_jx'
const CLONA = BAZA + '_clona'
const FILTRU = process.argv[2] || ''
// Mod mutant: o implementare stricată intenționat, aplicată după starea de bază; suita TREBUIE să pice.
const MUTANT = process.env.JX_MUTANT || ''
assert.ok(!MUTANT || MUTANTI[MUTANT] || MUTANTI_EDGE[MUTANT],
  'Mutant necunoscut: ' + MUTANT + ' (există: ' + [...Object.keys(MUTANTI), ...Object.keys(MUTANTI_EDGE)].join(', ') + ')')

// ── edge-urile REALE (sau o copie temporară: mutant edge / altă versiune de parser) ─────────────────────────────────
const FUNCTII_DIR = fileURLToPath(new URL('../../supabase/functions/', import.meta.url))
const FISIERE_EDGE = ['_shared/poartaOfertare.ts', '_shared/ofertarePoartaText.mjs', 'ofertare-poarta-text/handler.ts',
  'ofertare-poarta-text/evalueaza.mjs', 'ofertare-pachet-verifica/index.ts', 'ofertare-pachet-verifica/verificare.mjs']
const COPII = []
function copieEdge(sursa, schimbari) {
  const d = mkdtempSync(join(tmpdir(), 'jx_edge_'))
  COPII.push(d)
  writeFileSync(join(d, 'package.json'), '{"type":"module"}\n')
  for (const f of FISIERE_EDGE) { mkdirSync(dirname(join(d, f)), { recursive: true }); copyFileSync(join(sursa, f), join(d, f)) }
  for (const { fisier, din, in_ } of schimbari) {
    assert.ok(FISIERE_EDGE.includes(fisier), 'Fișier edge necunoscut: ' + fisier)
    const p = join(d, fisier), vechi = readFileSync(p, 'utf8'), nou = vechi.replace(din, in_)
    assert.notEqual(nou, vechi, `edge: ancora lipsește în ${fisier}: ${String(din).slice(0, 80)}`)
    writeFileSync(p, nou)
  }
  return d
}
async function incarcaEdge(radacina) {
  const u = f => pathToFileURL(join(radacina, f)).href
  return {
    radacina,
    poartaOfertare: (await import(u('_shared/poartaOfertare.ts'))).poartaOfertare,
    handle: (await import(u('ofertare-poarta-text/handler.ts'))).handle,
    creeazaHandler: (await import(u('ofertare-pachet-verifica/index.ts'))).creeazaHandler,
    PARSER_VERSION: (await import(u('ofertare-poarta-text/evalueaza.mjs'))).PARSER_VERSION,
  }
}
let EDGE = await incarcaEdge(FUNCTII_DIR)          // după starea de bază, un mutant edge îl înlocuiește
const PARSER_VERSION = EDGE.PARSER_VERSION
const VARIANTE = new Map()
async function edgeCuParser(parser) {                // același cod, „deployat” cu altă versiune de parser
  if (!parser || parser === EDGE.PARSER_VERSION) return EDGE
  const cheie = EDGE.radacina + '|' + parser
  if (!VARIANTE.has(cheie)) VARIANTE.set(cheie, await incarcaEdge(copieEdge(EDGE.radacina, [{ fisier: 'ofertare-poarta-text/evalueaza.mjs',
    din: /export const PARSER_VERSION = '[^']*'/, in_: `export const PARSER_VERSION = '${parser}'` }])))
  return VARIANTE.get(cheie)
}

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

// ── „PostgREST” simulat peste sesiunea psql a testului: fiecare apel = O instrucțiune, cu rolul dat (service_role pentru
//    edge; authenticated + JWT pentru poarta de rol), prin jx.rest (subtranzacție: o eroare SQL devine { error }, ca la
//    PostgREST, fără să rupă tranzacția testului). Doar ce folosesc handler-ele J04/J07: rpc, from().select().eq().in()
//    .order().range() / .maybeSingle(), from().insert(). Identificatorii sunt validați, valorile trec ca literali.
const ident = n => { assert.match(String(n), /^[a-z_][a-z0-9_]*$/, 'identificator nepermis în clientul simulat: ' + n); return n }
const lit = v => v === null || v === undefined ? 'NULL' : q(typeof v === 'object' ? JSON.stringify(v) : String(v))
function clientRest(s, rol, dupaRpc = async () => undefined) {
  const exec = async sql => JSON.parse(await s.val(`${rol} SELECT jx.rest(${q(sql)})::text;`))
  const rpc = async (nume, args = {}) => {
    const r = await exec(`SELECT to_jsonb(public.${ident(nume)}(${Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ')}))`)
    return (await dupaRpc(nume, args, r)) ?? r
  }
  const from = tabel => {
    ident(tabel)
    const st = { col: '*', filtre: [], ordine: '', dela: 0, panala: null }
    const citeste = () => exec(`SELECT coalesce(jsonb_agg(to_jsonb(t) - 'jx_n' ORDER BY t.jx_n), '[]'::jsonb) FROM (SELECT ${st.col},
      row_number() OVER (${st.ordine && 'ORDER BY ' + st.ordine}) AS jx_n FROM public.${tabel} WHERE ${st.filtre.join(' AND ') || 'true'}) t
      WHERE t.jx_n > ${st.dela}${st.panala === null ? '' : ' AND t.jx_n <= ' + (st.panala + 1)}`)
    const b = {
      select(c) { st.col = String(c).split(',').map(x => ident(x.trim())).join(', '); return b },
      eq(c, v) { st.filtre.push(`${ident(c)} = ${lit(v)}`); return b },
      in(c, v) { st.filtre.push(`${ident(c)} IN (${v.map(lit).join(', ')})`); return b },
      order(c) { st.ordine = ident(c); return b },
      range(a, z) { assert.ok(Number.isSafeInteger(a) && Number.isSafeInteger(z)); st.dela = a; st.panala = z; return b },
      async maybeSingle() {
        const r = await citeste()
        if (r.error) return r
        return r.data.length > 1 ? { data: null, error: { message: 'mai multe rânduri' } } : { data: r.data[0] ?? null, error: null }
      },
      then(ok, err) { return citeste().then(ok, err) },   // await pe interogare = SELECT-ul
      insert(randuri) {
        const lista = Array.isArray(randuri) ? randuri : [randuri]
        const col = Object.keys(lista[0] ?? {}).map(ident).join(', ')
        return exec(`WITH jx_ins AS (INSERT INTO public.${tabel}(${col}) SELECT ${col}
          FROM jsonb_populate_recordset(NULL::public.${tabel}, ${lit(lista)}::jsonb) RETURNING 1) SELECT NULL::jsonb FROM (SELECT count(*) FROM jx_ins) n`)
      },
    }
    return b
  }
  return { rpc, from }
}
// Poarta de rol REALĂ (poartaOfertare.ts): identitatea din JWT + fn_are_acces_ofertare rulată ca authenticated cu
// claims-urile utilizatorului (aceeași funcție ca în RLS).
const depPoarta = (s, uid) => ({
  env: n => ({ SUPABASE_URL: 'http://jx.local', SUPABASE_ANON_KEY: 'jx-anon' })[n],
  createClient: () => ({
    // ca=anon: JWT fără utilizator (cheia anonimă / token invalid) → poarta trebuie să dea 401 (JX-07k)
    auth: { getUser: async () => (uid === 'anon' ? { data: { user: null }, error: { message: 'invalid JWT' } } : { data: { user: { id: uid } }, error: null }) },
    rpc: nume => clientRest(s, ca('authenticated', uid)).rpc(nume),
  }),
})
const cerere = body => new Request('http://jx.local/functions/v1/edge', { method: 'POST',
  headers: { Authorization: 'Bearer jx-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function raspunsEdge(r) {
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = { corp: t } }
  return { status: r.status, ...j }
}

// ── edge J04: creeazaHandler() real (index.ts). „snapshot=indisponibil”: RPC-ul de snapshot dă eroare;
//    „schimba_in_timpul=<cale>”: alt proces rescrie obiectul între primul și al doilea snapshot al fișierului.
async function edgeJ04(s, pachet, opt) {
  const deja = new Set()
  const dupaRpc = async (nume, args, r) => {
    if (nume !== 'ofertare_pt_fisier_snapshot') return
    if (opt.snapshot === 'indisponibil') return { data: null, error: { message: 'Snapshot indisponibil (simulat)' } }
    if (opt.schimba_in_timpul && r.data?.name === opt.schimba_in_timpul && !deja.has(args.p_fisier_id)) {
      deja.add(args.p_fisier_id)
      await s.sql(`${ADMIN} SELECT jx.inlocuieste(${q(opt.schimba_in_timpul)}, 'rescris in timpul verificarii');`)
    }
  }
  const download = async path => {
    const b64 = await s.val(`${ADMIN} SELECT coalesce((SELECT 'b64:' || translate(encode(continut, 'base64'), E'\\n', '') FROM jx.bucket WHERE name = ${q(path)}), '∅');`)
    return b64 === '∅' ? new Response(null, { status: 404 }) : new Response(Buffer.from(b64.slice(4), 'base64'))
  }
  const h = EDGE.creeazaHandler({ poarta: depPoarta(s, opt.ca || EDITOR), service: async () => clientRest(s, SERVICE, dupaRpc), download })
  return raspunsEdge(await h(cerere({ pachet_id: pachet })))
}

// ── edge J07: handle() real (handler.ts): sursa + hash DOAR din BD, evaluatorul real, rezultatele inserate.
async function edgeJ07(s, lic, opt) {
  const m = await edgeCuParser(opt.parser)
  return raspunsEdge(await m.handle(cerere({ licitatie_id: lic }),
    { gate: req => m.poartaOfertare(req, depPoarta(s, opt.ca || EDITOR)), client: async () => clientRest(s, SERVICE) }))
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
    // Un status neașteptat (ex. 409/5xx în loc de 200) oprește testul: un edge căzut nu are voie să treacă drept „refuz”.
    const asteptat = Number(opt.status || 200)
    assert.equal(r.status, asteptat, `@edge ${b.arg}: HTTP ${r.status}, așteptat ${asteptat} — ${JSON.stringify(r).slice(0, 300)}`)
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
  if (MUTANTI[MUTANT]) { await s.sql(`${ADMIN} BEGIN; ${MUTANTI[MUTANT]} COMMIT;`); console.log(`MUTANT aplicat: ${MUTANT}`) }
  // Mutant edge: starea de bază s-a construit cu edge-urile reale; de aici încolo, copia stricată (importul trebuie să reușească).
  if (MUTANTI_EDGE[MUTANT]) { EDGE = await incarcaEdge(copieEdge(FUNCTII_DIR, MUTANTI_EDGE[MUTANT])); console.log(`MUTANT aplicat: ${MUTANT} (edge)`) }
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
  for (const d of COPII) { try { rmSync(d, { recursive: true, force: true }) } catch { /* idem */ } }
}
if (MUTANT) {
  // Ucis = cel puțin un test funcțional (nu doar JX-00, care compară definițiile) a picat.
  const ucigasi = rezultate.filter(r => !r.ok && r.id !== 'JX-00').map(r => r.id)
  console.log(ucigasi.length ? `MUTANT ${MUTANT}: UCIS de ${ucigasi.join(', ')}` : `MUTANT ${MUTANT}: SUPRAVIEȚUIEȘTE — suita nu îl prinde`)
  process.exit(ucigasi.length ? 0 : 1)
}
// JX-C1…C3 au devenit cerințe după remediere (06.10.2026, JILAVA_DECIZII A.2); rămâne fixată doar constatarea acceptată C4.
const CONSTATARI_FIXATE = new Set(['JX-C4'])
const cerinte = rezultate.filter(r => !CONSTATARI_FIXATE.has(r.id))
console.log(`\n${esecuri ? 'FAIL' : 'PASS'} J04×J07 extins: ${rezultate.filter(r => r.ok).length}/${rezultate.length} teste` +
  ` (${cerinte.filter(r => r.ok).length} cerințe + ${rezultate.length - cerinte.length} constatări fixate), ${constatari.length} constatări raportate.` +
  ` Funcții urmărite: ${FUNCTII.length}; parser edge: ${PARSER_VERSION}.`)
process.exitCode = esecuri ? 1 : 0
