// Proba LOCALĂ a migrării 20270115b (Izometrie NDT: citirile AI pe server + amprenta pachetului) pe PGlite — NU atinge nicio bază reală.
// Baza = „producția de după 20270114a”: scheletul 20270114a + scheletul 20270115b (coloanele pachetului, executie_tevi), seed-ul sintetic, apoi
//   migrarea 20270114a livrată ca runnerul (plafonul extins, marcajele, pasul L15 v2 real). 20270115b se livrează la fel; revenirea cu 2000.
// 0. validatorul runnerului (15000 + --plafon-extins / 2000), fișiere LF fără BOM, detectorul porților, amprentele md5 din migrare și revenire
//    calculate din texte, corpul 20270114a din revenire = textul 20270114a (verbatim).
// 1. refuzurile migrării (marcaj, plafon, L15, porți roșii, 20270114a lipsă / schimbată, coloană lipsă, reaplicare) — nimic schimbat.
// 2. livrarea L15 v2: manifestul generat = lista revizuită supabase/tests/20270115b_izometrie_ndt_citiri.l15.obiecte.tsv (--scrie-obiecte o rescrie);
//    GLOBAL greșit / manifest incomplet = refuz; livrarea aprobată + garda finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic.
// 3. COMPORTAMENT = dry-run-ul (valorile așteptate scrise de mână acolo) + verificările de aici (cereri ca authenticated, cu JWT-ul fiecărui cont).
// 4. paritatea formei citirii: supabase/tests/20270115b_citiri_cazuri.json (aceleași cazuri ca handler_test.ts) + cazurile de limită generate.
// 5. revenirea: aplicare → revenire → reaplicare; revenirea cu date / corp schimbat / obiect lipsă sau în plus = refuz, nimic schimbat.
// 6. MUTANȚI: comportamentali (postcondițiile scoase: dry-run-ul / paritatea / verificările îi prind), structurali (postcondițiile), pe gărzi.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izometrie_ndt_citiri_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'ndtc_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270115b_izometrie_ndt_citiri', NUME_REV = NUME + '_ROLLBACK', NUME14 = '20270114a_izometrie_buletine_ndt'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const F_SCHELET = `supabase/tests/${NUME}_schelet.sql`, F_CAZURI = 'supabase/tests/20270115b_citiri_cazuri.json'
const F_MIG14 = `supabase/migrations/${NUME14}.sql`, F_SCHELET14 = `supabase/tests/${NUME14}_schelet.sql`
const F_FIXTURI = 'scripts/pglite/fixturi/executie_constrangeri_productie.sql'
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? readFileSync(process.argv[i + 1], 'utf8').replace(/\r/g, '') : null }
const MIG = arg('--mig') ?? citeste(F_MIG), REV = arg('--rev') ?? citeste(F_REV), DRY = citeste(F_DRY), SCHELET = citeste(F_SCHELET)
const MIG14 = citeste(F_MIG14), SCHELET14 = citeste(F_SCHELET14), FIXTURI = citeste(F_FIXTURI), CAZURI = JSON.parse(citeste(F_CAZURI))

let esec = 0, nrOk = 0
const ok = (cond, msg) => { if (cond) { nrOk++; console.log('  OK  ' + msg) } else { esec++; console.log('  NU  ' + msg) } }
const aplica = (text, lista) => {
  let t = text
  for (const [din, in_] of lista) {
    const n = t.split(din).length - 1
    if (n !== 1) throw new Error(`mutantul găsește textul de ${n} ori (cerut 1): ` + din.slice(0, 100))
    t = t.split(din).join(in_)
  }
  return t
}

// ── uneltele runnerului (aceleași funcții ca livrare_migrare.sh) ──
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_EXTINS_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

// ── conturile (sintetice) și datele: aceleași ca proba 20270114a + rândurile unui pachet ──
const U = {
  OWNER: '00000000-0000-4000-8000-0000000000d1', MPA: '00000000-0000-4000-8000-0000000000d2', MPB: '00000000-0000-4000-8000-0000000000d3',
  EXE: '00000000-0000-4000-8000-0000000000d4', CTC: '00000000-0000-4000-8000-0000000000d5', NOMOD: '00000000-0000-4000-8000-0000000000d6',
}
const PA = 101, PB = 102, TA12 = 1201, TB12 = 2201, KA = 5001, KB = 5002
const SEED = `
INSERT INTO public.employees (id, name) VALUES (9001, 'MP UNU'), (9002, 'MP DOI');
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES ('${U.OWNER}', 'OWNER', true, NULL), ('${U.MPA}', 'MPA', false, 9001),
  ('${U.MPB}', 'MPB', false, 9002), ('${U.EXE}', 'EXE', false, NULL), ('${U.CTC}', 'CTC', false, NULL), ('${U.NOMOD}', 'NOMOD', false, NULL);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.EXE}', 'executie', 'editor'), ('${U.CTC}', 'ctc', 'editor'),
  ('${U.NOMOD}', 'logistica', 'admin');
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (${PA}, 'TEST-A', 'Proiect A', 9001), (${PB}, 'TEST-B', 'Proiect B', 9002);
INSERT INTO public.executie_tronsoane (id, proiect_id, cod) VALUES (${TA12}, ${PA}, 'TR12'), (${TB12}, ${PB}, 'TR12');
INSERT INTO public.executie_pachete_lansare (id, proiect_id, tronson_id, cod, km_start_m, revizie, cod_document_full, updated_at)
  VALUES (${KA}, ${PA}, ${TA12}, 'PL-A', 1200.5, 1, 'DOC-A', '2026-11-20 10:00:00+02'), (${KB}, ${PB}, ${TB12}, 'PL-B', 0, 0, 'DOC-B', '2026-11-20 10:00:00+02');
INSERT INTO public.executie_tevi (id, pachet_id, poz_in_pachet, tip_rand, serie_unica, sudura_cod, lungime_m, tip, sarja)
  VALUES (71, ${KA}, 1, 'teava', 'S-1', 'T12S1', 12.5, 'T', 'SJ1'), (72, ${KA}, 2, 'teava', 'S-2', 'T12S2', 11.75, 'T', 'SJ1');`
async function livreaza(db, text, { nume = NUME, plafon = PLAFON_LIVRARE, marcajPlafon = plafon, ag = true, marcaj = true, aprobat = '-', manifest = null, final = 'COMMIT' } = {}) {
  await db.exec(plafon === null ? 'RESET transaction_timeout' : `SET transaction_timeout = ${plafon}`)
  const T = randomBytes(8).toString('hex')
  const prolog = [marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : '',
    marcajPlafon === null ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '${marcajPlafon}:' || txid_current(), true);`].join('\n')
  const ina = ag ? gen('inainte', T, aprobat) : ''
  const dupa = ag && manifest !== null ? gen('dupa', T, aprobat, manifest) : ''
  const note = []
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${prolog}`)
    await db.exec(`${ina}\n${text}\n;\n${dupa}`, { onNotice: n => note.push(n.message) })
    await db.exec(final, { onNotice: n => note.push(n.message) })
    return { ok: true, note }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* închisă */ }
    return { ok: false, eroare: String(e.message), note }
  } finally { await db.exec('RESET transaction_timeout') }
}
const revino = (db, text = REV, o = {}) => livreaza(db, text, { nume: NUME_REV, plafon: PLAFON_REVENIRE, ag: false, ...o })
// baza „de după 20270114a” (fără 20270115b)
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET14)
  await db.exec(SCHELET)
  await db.exec(SEED)
  const a = await livreaza(db, MIG14, { nume: NUME14 })
  if (!a.ok) throw new Error('20270114a nu se aplică pe baza probei: ' + a.eroare)
  return db
}

// starea obiectelor (pentru „nimic schimbat”): relațiile public + storage, funcțiile (corp, ACL, DEFINER, volatilitate), politicile, rândurile sud_
const TABELE = ['sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi', 'sud_citiri']
const stare = async db => {
  const s = (await db.query(`SELECT
    (SELECT string_agg(c.relname::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '-') || ':' || c.relrowsecurity::text, ',' ORDER BY c.relname)
       FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace, 'storage'::regnamespace)) AS rel,
    (SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || p.prosecdef::text || ':' || p.provolatile::text, ',' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) AS fn,
    (SELECT string_agg(p.polrelid::regclass::text || '.' || p.polname::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
       ',' ORDER BY p.polrelid::regclass::text, p.polname) FROM pg_policy p) AS pol,
    (SELECT string_agg(p.oid::regprocedure::text || '=' || coalesce(obj_description(p.oid, 'pg_proc'), '-'), ',' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_izo\\_porti%') AS stampile`)).rows[0]
  for (const t of TABELE) {
    const e = (await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`)).rows[0].e
    s[t] = e ? (await db.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n : 'LIPSA'
  }
  return s
}
const sudOk = async db => (await db.query(`SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'sud\\_%' AND relkind = 'r')::int AS t,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_sud\\_%')::int AS f`)).rows[0]

// ── rularea ca un cont: JWT-ul ca PostgREST, AMBELE surse; implicit ROLLBACK, cu { commit: true } rămâne ──
const jwt = (uid, rol) => uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true); SELECT set_config('request.jwt.claims', '{"sub": "${uid}", "role": "${rol}"}', true);`
  : `SELECT set_config('request.jwt.claim.sub', '', true); SELECT set_config('request.jwt.claims', '{"role": "${rol}"}', true);`
async function ca(db, cont, sql, params = [], { rol = 'authenticated', commit = false } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${jwt(uid, rol)}`)
  try {
    const id = (await db.query(`SELECT current_user AS u, auth.uid()::text AS uid, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`)).rows[0]
    if (id.u !== rol || (uid ? id.uid !== uid : id.uid !== null) || id.bypass) throw new Error('identitate greșită: ' + JSON.stringify(id))
    const r = await db.query(sql, params)
    await db.exec(commit ? 'COMMIT' : 'ROLLBACK'); return { rows: r.rows, afectate: r.affectedRows ?? null }
  } catch (e) { await db.exec('ROLLBACK'); return { code: e.code ?? 'JS', message: e.message } }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows
const sha = s => createHash('sha256').update(s).digest('hex')
const urca = (db, cont, cale) => ca(db, cont, `INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-ndt', $1, auth.uid(), auth.uid()::text)`, [cale], { commit: true })
const incarca = (db, cont, numar, cale, amprenta) => ca(db, cont, `SELECT public.fn_sud_buletin_incarca($1::bigint, 'PA-UT', $2, DATE '2026-11-20', 'LAB', $3, 'b.pdf', $4, NULL, NULL) AS id`,
  [TA12, numar, cale, amprenta], { commit: true })
const rezerva = (db, cont, bul, tip, model, cheie) => ca(db, cont, `SELECT public.fn_sud_citire_rezerva($1::bigint, $2, $3, $4::uuid) AS r`, [bul, tip, model, cheie], { commit: true })
const salveaza = (db, cont, cheie, citire, cost, cunoscut, eroare) => ca(db, cont, `SELECT public.fn_sud_citire_salveaza($1::uuid, $2::jsonb, $3::numeric, $4::boolean, $5) AS id`,
  [cheie, citire === null ? null : JSON.stringify(citire), cost, cunoscut, eroare], { commit: true })
const amprenta = (db, cont, pachet) => ca(db, cont, `SELECT public.fn_sud_amprenta_pachet($1::bigint) AS a`, [pachet])
const K = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const MINIM = CAZURI.valide[0].salvat

// ── verificările de comportament de aici (în plus față de dry-run): lista abaterilor (goală = bine); așteptatul scris de mână (L25) ──
async function verifica(db) {
  const ab = []
  const asteapta = (cond, msg, r) => { if (!cond) ab.push(msg + (r === undefined ? '' : ': ' + JSON.stringify(r).slice(0, 220))) }
  try {
    let r = await urca(db, 'MPA', `${PA}/${TA12}/c1.pdf`); asteapta(!r.code, 'MPA urcă c1', r)
    r = await incarca(db, 'MPA', 'C-1', `${PA}/${TA12}/c1.pdf`, sha('c1')); asteapta(!r.code, 'MPA încarcă buletinul C-1', r)
    const b1 = Number(r.rows?.[0]?.id)
    // rezervarea: nou → aceeași cheie = in_curs; MPB / EXE / CTC / NOMOD = 42501 (scriere = owner / MP pe proiectul lui, R9)
    r = await rezerva(db, 'MPA', b1, 'principal', 'claude-sonnet-5-5', K(1)); asteapta(r.rows?.[0]?.r?.rezultat === 'nou', 'MPA: prima rezervare = nou', r)
    r = await rezerva(db, 'MPA', b1, 'principal', 'claude-sonnet-5-5', K(1)); asteapta(r.rows?.[0]?.r?.rezultat === 'in_curs', 'MPA: aceeași cheie = in_curs', r)
    for (const c of ['MPB', 'EXE', 'CTC', 'NOMOD']) { r = await rezerva(db, c, b1, 'principal', 'claude-sonnet-5-5', K(2)); asteapta(r.code === '42501', `${c}: rezervarea = 42501`, r) }
    r = await rezerva(db, 'OWNER', b1, 'principal', 'claude-sonnet-5-5', K(1)); asteapta(r.code === '22023' && /cheie_alta_cerere/.test(r.message), 'OWNER reia cheia lui MPA = 22023 cheie_alta_cerere', r)
    r = await rezerva(db, 'OWNER', b1, 'principal', 'claude-sonnet-5-5', K(2)); asteapta(r.code === '55006', 'OWNER, altă cheie cât MPA citește = 55006', r)
    r = await ca(db, null, `SELECT public.fn_sud_citire_rezerva(${b1}, 'principal', 'claude-sonnet-5-5', '${K(3)}'::uuid) AS r`, [], { rol: 'anon' }); asteapta(r.code === '42501', 'anon: fără EXECUTE', r)
    // salvarea: doar autorul; forma validată; repetarea identică = același id
    r = await salveaza(db, 'OWNER', K(1), MINIM, 0.37, true, null); asteapta(r.code === '42501', 'OWNER închide cererea lui MPA = 42501', r)
    r = await salveaza(db, 'MPA', K(1), { ...MINIM, model: 'x' }, 0.37, true, null); asteapta(r.code === '22023', 'citire cu cheie în plus = 22023', r)
    r = await salveaza(db, 'MPA', K(1), MINIM, 0.37, true, null); asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'MPA salvează citirea', r)
    const c1 = Number(r.rows?.[0]?.id)
    r = await salveaza(db, 'MPA', K(1), MINIM, 0.37, true, null); asteapta(Number(r.rows?.[0]?.id) === c1, 'repetarea identică = același id', r)
    r = await rezerva(db, 'MPA', b1, 'principal', 'claude-sonnet-5-5', K(1))
    asteapta(r.rows?.[0]?.r?.rezultat === 'gata' && JSON.stringify(r.rows[0].r.citire) === JSON.stringify(await q(db, `SELECT $1::jsonb AS j`, [JSON.stringify(MINIM)]).then(x => x[0].j)),
      'cheia reluată după salvare = gata, cu citirea salvată (fără cerere nouă)', r)
    r = await q(db, `SELECT count(*)::int AS n, min(stare) AS s, min(creat_de::text) AS de FROM public.sud_citiri WHERE buletin_id = $1`, [b1])
    asteapta(r[0].n === 1 && r[0].s === 'gata' && r[0].de === U.MPA, 'un singur rând pentru cheia K1 (gata, autorul = serverul)', r)
    // citirea (RLS, R9): OWNER / EXE / CTC văd cererea; MPA (fără modul) / MPB / NOMOD nu
    for (const [c, n] of [['OWNER', 1], ['EXE', 1], ['CTC', 1], ['MPA', 0], ['MPB', 0], ['NOMOD', 0]]) {
      r = await ca(db, c, `SELECT count(*)::int AS n FROM public.sud_citiri`); asteapta(r.rows?.[0]?.n === n, `${c} vede ${n} cereri`, r)
    }
    // amprenta pachetului: drept 'export'; determinism; schimbarea fiecărui câmp al pachetului / rândului (scris de mână: lista din izoExportIzo.js)
    const a0 = (await amprenta(db, 'OWNER', KA)).rows?.[0]?.a
    asteapta(/^[0-9a-f]{32}$/.test(a0 || ''), 'OWNER: amprenta = md5', a0)
    for (const c of ['MPA', 'EXE']) { r = await amprenta(db, c, KA); asteapta(r.rows?.[0]?.a === a0, `${c}: aceeași amprentă (drept export)`, r) }
    for (const c of ['MPB', 'CTC', 'NOMOD']) { r = await amprenta(db, c, KA); asteapta(r.code === '42501', `${c}: amprenta = 42501`, r) }
    r = await amprenta(db, 'OWNER', 99999); asteapta(r.code === '22023', 'pachet inexistent = 22023', r)
    asteapta((await amprenta(db, 'OWNER', KB)).rows?.[0]?.a !== a0, 'alt pachet = altă amprentă')
    const SCHIMBARI = [['executie_pachete_lansare', KA, 'km_start_m', '1200.6'], ['executie_pachete_lansare', KA, 'revizie', '2'],
      ['executie_pachete_lansare', KA, 'cod_document_full', "'DOC-A2'"], ['executie_pachete_lansare', KA, 'updated_at', "'2026-11-20 10:00:01+02'"],
      ['executie_tevi', 71, 'poz_in_pachet', '9'], ['executie_tevi', 71, 'tip_rand', "'curba'"], ['executie_tevi', 71, 'serie_unica', "'S-1b'"],
      ['executie_tevi', 71, 'sudura_cod', "'T12S9'"], ['executie_tevi', 71, 'sudura_refacuta', 'true'], ['executie_tevi', 71, 'lungime_m', '12.51'],
      ['executie_tevi', 71, 'tip', "'C'"], ['executie_tevi', 71, 'dimensiune', "'DN300'"], ['executie_tevi', 71, 'sarja', "'SJ2'"],
      ['executie_tevi', 71, 'unghi_curba', '15'], ['executie_tevi', 71, 'lot', "'L2'"], ['executie_tevi', 71, 'observatii', "'obs'"],
      ['executie_tevi', 71, 'pm_cod', "'PM-1'"], ['executie_tevi', 71, 'pa_ut_cod', "'PA-1'"], ['executie_tevi', 71, 'ut_cod', "'UT-1'"]]
    // schimbarea (ca postgres) + amprenta ca owner, în aceeași tranzacție anulată la final
    const ampDupa = async pre => {
      await db.exec(`BEGIN; ${pre}; SELECT set_config('request.jwt.claim.sub', '${U.OWNER}', true);`)
      try { return (await db.query(`SELECT public.fn_sud_amprenta_pachet(${KA}) AS a`)).rows?.[0]?.a } finally { await db.exec('ROLLBACK') }
    }
    for (const [t, id, col, v] of SCHIMBARI) {
      const a1 = await ampDupa(`UPDATE public.${t} SET ${col} = ${v} WHERE id = ${id}`)
      asteapta(a1 && a1 !== a0, `${t}.${col} schimbat → amprenta se schimbă`, a1)
    }
    const a2 = await ampDupa(`INSERT INTO public.executie_tevi (id, pachet_id, serie_unica) VALUES (73, ${KA}, 'S-3')`)
    asteapta(a2 && a2 !== a0, 'rând nou în pachet → amprenta se schimbă', a2)
    const a3 = await ampDupa(`UPDATE public.executie_tevi SET pachet_id = ${KB} WHERE id = 72`)
    asteapta(a3 && a3 !== a0, 'rând mutat în alt pachet → amprenta se schimbă', a3)
    const a5 = await ampDupa('SELECT 1')
    asteapta(a5 === a0, 'nicio schimbare → aceeași amprentă (determinism)', a5)
    // fusul orar al sesiunii nu schimbă amprenta (updated_at ca epoch)
    const a4 = await ampDupa("SET LOCAL TimeZone = 'America/New_York'")
    asteapta(a4 === a0, 'alt fus orar al sesiunii → aceeași amprentă', a4)
    // exportul: fără amprentă = 22023; amprentă veche = 40001 (pachet); cea curentă = înregistrat
    const foto = amp => ({ buletine: [], eliminate: [], metode: [], lipsuri_blocante: [], ...(amp === undefined ? {} : { amprenta_pachet: amp }) })
    const exp = (c, f) => ca(db, c, `SELECT public.fn_sud_export_inregistreaza(${KA}, 'izo', $1::jsonb, NULL, NULL) AS id`, [JSON.stringify(f)], { commit: true })
    r = await exp('EXE', foto()); asteapta(r.code === '22023' && /amprenta pachetului/.test(r.message), 'export fără amprentă = 22023', r)
    r = await exp('EXE', foto('0'.repeat(32))); asteapta(r.code === '40001' && /\(pachet\)/.test(r.message), 'export cu amprenta altui pachet = 40001 (pachet)', r)
    r = await exp('EXE', foto(a0)); asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'export cu amprenta curentă = înregistrat', r)
    await db.exec(`UPDATE public.executie_tevi SET sarja = 'SJ9' WHERE id = 71`)
    r = await exp('EXE', foto(a0)); asteapta(r.code === '40001' && /\(pachet\)/.test(r.message), 'export după schimbarea unui rând = 40001 (pachet)', r)
    await db.exec(`UPDATE public.executie_tevi SET sarja = 'SJ1' WHERE id = 71`)
  } catch (e) { ab.push('excepție în verificări: ' + String(e.message).slice(0, 200)) }
  return ab
}

// ── dry-run-ul (clona) pe baza curentă: blocurile ok + TOTUL OK, nimic rămas ──
async function dryRun(db) {
  const s0 = await stare(db)
  const note = []; let eroare = null
  const text = DRY.replace('\nBEGIN;\n', '\nBEGIN;\n' + FIXTURI + '\n')
  if (text === DRY) throw new Error('dry-run: BEGIN negăsit')
  try { await db.exec(text, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e.message; try { await db.exec('ROLLBACK') } catch { /* închisă */ } }
  const blocuri = note.filter(n => /^DRY 20270115b \S+ ok/.test(n))
  const ramas = JSON.stringify(await stare(db)) !== JSON.stringify(s0)
  return { ok: !eroare && note.includes('DRY 20270115b TOTUL OK') && blocuri.length >= 12 && !ramas, eroare, blocuri: blocuri.length, ramas }
}

// ── paritatea formei citirii (fn_sud_citire_valida vs cazurile comune cu handler_test.ts) ──
const RAND = cod => ({ cod_raw: cod, rezultat: null, data_inspectie: null, start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, observatii: null })
const LIMITE = [
  ['2000 de rânduri', { ...MINIM, randuri: Array.from({ length: 2000 }, (_, i) => RAND('T12S' + (i + 1))) }, null],
  ['2001 de rânduri', { ...MINIM, randuri: Array.from({ length: 2001 }, (_, i) => RAND('T12S' + (i + 1))) }, 'randuri: lipsa sau peste 2000'],
  ['cod de 80 de caractere', { ...MINIM, randuri: [RAND('X'.repeat(80))] }, null],
  ['cod de 81 de caractere', { ...MINIM, randuri: [RAND('X'.repeat(81))] }, 'randul 1: cod_raw'],
  ['observații de 501 caractere', { ...MINIM, randuri: [{ ...RAND('T12S1'), observatii: 'o'.repeat(501) }] }, 'randul 1: observatii'],
  ['firma de 201 caractere', { ...MINIM, antet: { ...MINIM.antet, firma: 'F'.repeat(201) } }, 'antet: text de alt tip sau prea lung'],
  ['incert de 501 caractere', { ...MINIM, incerte: ['i'.repeat(501)] }, 'incerte'],
  // 2000 × (500 × 2 octeți + ghilimele + separator) ≈ 2.008.000 octeți > 2.000.000 (aceleași 2000 de incerte, în limita de număr)
  ['peste 2 MB', { ...MINIM, incerte: Array.from({ length: 2000 }, () => 'ă'.repeat(500)) }, 'citirea are peste 2 MB'],
  ['sub 2 MB (1900 de incerte)', { ...MINIM, incerte: Array.from({ length: 1900 }, () => 'ă'.repeat(500)) }, null],
  ['nu e obiect', [], 'citirea nu e obiect'],
]
async function paritate(db) {
  const ab = []
  for (const c of CAZURI.valide) {
    const v = (await q(db, `SELECT public.fn_sud_citire_valida($1::jsonb) AS m`, [JSON.stringify(c.salvat)]))[0].m
    if (v !== null) ab.push(`valid „${c.nume}”: refuzat (${v})`)
  }
  for (const c of CAZURI.invalide) {
    const v = (await q(db, `SELECT public.fn_sud_citire_valida($1::jsonb) AS m`, [JSON.stringify(c.salvat)]))[0].m
    if (v === null || !v.startsWith(c.motiv)) ab.push(`invalid „${c.nume}”: ${v === null ? 'acceptat' : v} (aștepta ${c.motiv})`)
  }
  for (const [nume, cit, motiv] of LIMITE) {
    const v = (await q(db, `SELECT public.fn_sud_citire_valida($1::jsonb) AS m`, [JSON.stringify(cit)]))[0].m
    if (motiv === null ? v !== null : (v === null || !v.startsWith(motiv))) ab.push(`limită „${nume}”: ${v ?? 'acceptat'} (aștepta ${motiv ?? 'acceptat'})`)
  }
  return ab
}

const faraComentarii = t => t.replace(/--[^\n]*/g, '')
const corp = (t, cap) => { const i = t.indexOf(cap); if (i < 0 || t.indexOf(cap, i + 1) >= 0) return null; const a = t.indexOf('AS $f$', i) + 6; return t.slice(a, t.indexOf('$f$', a)) }
console.log('0. validatorul runnerului, forma fișierelor, detectorul porților, amprentele md5 calculate din texte')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE), '--plafon-extins')
  ok(PLAFON_LIVRARE === 15000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE} + --plafon-extins: ${vm.out}`)
  const vx = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vx.ok && /PLAFON_EXTINS_DIFERIT/.test(vx.out), 'migrarea fără --plafon-extins = refuz PLAFON_EXTINS_DIFERIT: ' + vx.out.split('\n')[0].slice(0, 120))
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 15000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
  for (const f of [F_MIG, F_REV, F_DRY, F_SCHELET, F_OBIECTE, F_CAZURI, 'scripts/pglite/test_izometrie_ndt_citiri_local.mjs']) {
    const brut = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '\r'
    ok(brut.charCodeAt(0) !== 0xFEFF && !/\r/.test(brut), `${f}: există, fără BOM, LF`)
  }
  ok(/^-- Version 20270115130000\. NEAPLICAT\./.test(MIG), 'versiunea migrării: 20270115130000 (20270115a e luat pe alt branch)')
  let det
  try { det = { cod: 0, out: execFileSync('node', [join(ROOT, 'scripts/izometrie/porti_regula.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { det = { cod: e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
  const linieDet = f => (det.out.split('\n').find(l => l.includes(f)) || 'LIPSA').trim()
  ok(det.cod === 0 && /^OK /.test(linieDet(`migrations/${NUME}.sql`)) && /^OK /.test(linieDet(`revenire/${NUME_REV}.sql`)),
    `detectorul porților: cod ${det.cod}; ${linieDet(`migrations/${NUME}.sql`).slice(0, 110)}; ${linieDet(`revenire/${NUME_REV}.sql`).slice(0, 110)}`)
  // amprentele din migrare = corpurile din 20270114a (calculate aici din text, nu copiate)
  const MIGc = faraComentarii(MIG), REVc = faraComentarii(REV)
  const aDrept = md5(corp(MIG14, 'CREATE FUNCTION public.fn_sud_drept(')), aExp14 = md5(corp(MIG14, 'CREATE FUNCTION public.fn_sud_export_inregistreaza('))
  const aExp15 = md5(corp(MIG, 'CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza('))
  ok(MIGc.split(aDrept).length === 2 && MIGc.split(aExp14).length === 2, `amprentele 20270114a (fn_sud_drept ${aDrept.slice(0, 8)}, export ${aExp14.slice(0, 8)}) apar EXACT o dată în migrare`)
  ok(REVc.split(aExp15).length === 2 && REVc.split(aExp14).length === 2, `revenirea: md5 corpului 20270115b (${aExp15.slice(0, 8)}) înainte și al celui 20270114a (${aExp14.slice(0, 8)}) după, câte o dată`)
  const M14 = MIG14.slice(MIG14.indexOf('CREATE FUNCTION public.fn_sud_export_inregistreaza('), MIG14.indexOf('END $f$;', MIG14.indexOf('CREATE FUNCTION public.fn_sud_export_inregistreaza(')) + 8)
  const blocRev = REV.slice(REV.indexOf('-- CORP_20270114A_INCEPUT\n') + '-- CORP_20270114A_INCEPUT\n'.length, REV.indexOf('\n-- CORP_20270114A_SFARSIT'))
  ok(blocRev === M14.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'), 'corpul fn_sud_export_inregistreaza din revenire = textul 20270114a (verbatim)')
  // corpul nou = corpul 20270114a + EXACT cele două adăugiri (formatul amprentei, rândul „pachet” din surse)
  const nou = corp(MIG, 'CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(')
  const ADAOS1 = "  IF jsonb_typeof(p_fotografie->'amprenta_pachet') IS DISTINCT FROM 'string' OR p_fotografie->>'amprenta_pachet' !~ '^[0-9a-f]{32}$' THEN\n    RAISE EXCEPTION 'sud: fotografia nu are amprenta pachetului de pe server (reincarca pagina si redeschide fereastra)' USING ERRCODE = '22023';\n  END IF;\n"
  const ADAOS2 = "    UNION ALL\n    SELECT 'pachet' WHERE public.fn_sud_amprenta_pachet(p_pachet) IS DISTINCT FROM p_fotografie->>'amprenta_pachet'\n"
  const vechi = corp(MIG14, 'CREATE FUNCTION public.fn_sud_export_inregistreaza(')
  ok(nou.split(ADAOS1).length === 2 && nou.split(ADAOS2).length === 2
    && nou.replace(ADAOS1, '').replace(ADAOS2, '').replace('  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate) + pachetul și rândurile lui (amprenta serverului)\n',
      '  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate)\n') === vechi,
  'corpul nou al înregistrării = corpul 20270114a + doar formatul amprentei și rândul „pachet” (nicio altă schimbare)')
  // L14 în revenire: LOCK pe sud_citiri ÎNAINTEA numărării
  const iL = REVc.indexOf('LOCK TABLE public.sud_citiri IN ACCESS EXCLUSIVE MODE NOWAIT;'), iN = REVc.indexOf('SELECT count(*) FROM public.sud_citiri INTO v_n;')
  ok(iL > REVc.indexOf('starea nu e cea pusa de migrare') && iL < iN && iN < REVc.indexOf('END $pre$;'), 'revenirea: verificarea stării → LOCK NOWAIT → numărarea, toate în $pre$ (L14)')
  // câmpurile amprentei = CAMPURI_RAND_AMPRENTA din src/lib/izoExportIzo.js (aceeași listă, aceeași ordine)
  const lib = citeste('src/lib/izoExportIzo.js')
  const campuri = JSON.parse(lib.slice(lib.indexOf('export const CAMPURI_RAND_AMPRENTA = ') + 'export const CAMPURI_RAND_AMPRENTA = '.length, lib.indexOf(']', lib.indexOf('export const CAMPURI_RAND_AMPRENTA')) + 1).replace(/'/g, '"'))
  const sqlCampuri = (MIG.match(/jsonb_agg\(jsonb_build_array\(([^)]*)\) ORDER BY t\.id\)/) || [])[1]?.split(',').map(s => s.trim().replace(/^t\./, '')) || []
  ok(campuri.length === 16 && JSON.stringify(sqlCampuri) === JSON.stringify(campuri), `rândurile din amprenta serverului = CAMPURI_RAND_AMPRENTA (${sqlCampuri.length} câmpuri, aceeași ordine)`)
}

console.log('1. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['marcajul altei migrări', { nume: NUME14 }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 5000', { plafon: 5000, marcajPlafon: 5000 }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['porțile Izometrie roșii', {}, /portile Izometrie nu sunt verzi inainte: \{e4b\}/, `CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`],
  ['fn_sud_drept cu alt corp', {}, /nu sunt cele din 20270114a/, `CREATE OR REPLACE FUNCTION public.fn_sud_drept(p_proiect bigint, p_nivel text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`],
  ['fn_sud_export_inregistreaza SECURITY INVOKER', {}, /nu sunt cele din 20270114a/, 'ALTER FUNCTION public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) SECURITY INVOKER'],
  ['fn_sud_export_inregistreaza cu EXECUTE pentru anon', {}, /nu sunt cele din 20270114a/, 'GRANT EXECUTE ON FUNCTION public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) TO anon'],
  ['fn_executie_pachete_acces cu alt corp', {}, /lantul de drept .* nu e cel revizuit/, `CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$`],
  ['executie_tevi fără coloana sarja', {}, /coloanele citite de amprenta pachetului lipsesc/, 'ALTER TABLE public.executie_tevi DROP COLUMN sarja'],
  ['updated_at text', {}, /coloanele citite de amprenta pachetului lipsesc/, 'ALTER TABLE public.executie_pachete_lansare ALTER COLUMN updated_at TYPE text'],
  ['executie_tevi lipsă', {}, /dependente lipsa/, 'DROP TABLE public.executie_tevi'],
  ['un tabel sud_ în plus', {}, /starea 20270114a lipseste sau are obiecte sud_ in plus/, 'CREATE TABLE public.sud_zz (id int)'],
  ['sud_citiri existent (reaplicare parțială)', {}, /starea 20270114a lipseste sau are obiecte sud_ in plus/, 'CREATE TABLE public.sud_citiri (id int)'],
  ['o funcție fn_sud_ în plus', {}, /starea 20270114a lipseste/, `CREATE FUNCTION public.fn_sud_x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$`],
  ['armare persistentă a marcajului', {}, /armare persistenta refuzata/, `ALTER ROLE postgres SET gazpet.livrare_migrare = 'x'`],
]) {
  const b = await bazaNoua()
  if (pregatire) await b.exec(pregatire)
  const inainte = await stare(b)
  const r = await livreaza(b, MIG, opt)
  ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(await stare(b)), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 130)})`)
  await b.close()
}
{
  const b = await PGlite.create()
  await b.exec(SCHELET14); await b.exec(SCHELET); await b.exec(SEED)
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /starea 20270114a lipseste/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'fără 20270114a = refuz, nimic schimbat: ' + (r.eroare || 'APLICAT').slice(0, 100))
  await b.close()
}
{
  const b = await bazaNoua()
  const a = await livreaza(b, MIG)
  ok(a.ok, 'aplicare pentru reaplicare' + (a.ok ? '' : ': ' + a.eroare))
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /starea 20270114a lipseste sau are obiecte sud_ in plus/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'reaplicarea = refuz, nimic schimbat: ' + (r.eroare || '').slice(0, 100))
  await b.close()
}

console.log('2. livrarea L15 v2 completă: manifestul = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
{
  const b = await bazaNoua()
  const s0 = await stare(b)
  const g = await livreaza(b, MIG, { manifest: '-', final: 'ROLLBACK' })
  const G = (g.note.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = g.note.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const total = Number((g.note.map(m => m.match(/^L15_DIF_TOTAL (\d+) /)).find(Boolean) || [])[1])
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  ok(g.ok && G && total === listaObiecte(manifest).length && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    `generatorul de manifest: GLOBAL ${G}, ${total} diferențe anunțate = rândurile tipărite; ROLLBACK, starea neschimbată` + (g.ok ? '' : ': ' + g.eroare))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270115b: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}`)
  // L25: ce TREBUIE să apară, scris aici independent de generator: tabelul, funcțiile noi „creat”, înregistrarea „schimbat”; nimic altceva
  const etichete = revizuit.map(l => l.split('\t'))
  const creat = etichete.filter(x => x[2] === 'creat').map(x => x[1]).join('\n')
  ok(creat.includes('sud_citiri') && ['fn_sud_citire_valida', 'fn_sud_citire_rezerva', 'fn_sud_citire_salveaza', 'fn_sud_amprenta_pachet', 'sud_citiri_citire'].every(f => creat.includes(f)),
    'lista revizuită conține tabelul sud_citiri, politica lui și cele 4 funcții noi ca „creat”')
  const altfel = etichete.filter(x => x[2] !== 'creat')
  ok(altfel.length > 0 && altfel.every(x => /fn_sud_export_inregistreaza|fn_izo_porti/.test(x[1])) && !etichete.some(x => /executie_|profiles|fn_executie|user_module_access|storage\./.test(x[1])),
    `schimbat doar fn_sud_export_inregistreaza (+ eventual ștampilele porților), nimic pe executie_ / storage: ${altfel.map(x => x.join(' ')).join(' | ') || 'nimic'}`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  const linii = manifest.split('\n'), iPol = linii.findIndex(l => /sud_citiri_citire/.test(l))
  writeFileSync(fIncomplet, linii.filter((_, i) => i !== iPol).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(iPol >= 0 && !gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul politicii sud_citiri_citire = refuz AMPRENTA_GLOBALA_DUPA, nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  const ms = Number((j.note.map(m => m.match(/^20270115b: sfarsit la (\d+) ms de la BEGIN$/)).find(Boolean) || [])[1])
  ok(j.ok && j.note.some(m => new RegExp(`^AMPRENTA_GLOBALA dupa: ${total} diferente = manifestul`).test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon ${PLAFON_LIVRARE} ms\\)`).test(m)),
  `livrarea aprobată: diferențele (${total}) = manifestul; PLAFON_TIMP (${PLAFON_LIVRARE}); migrarea pe PGlite: ${ms} ms` + (j.ok ? '' : ': ' + j.eroare))
  const so = await sudOk(b)
  ok(JSON.stringify(so) === '{"t":7,"f":15}', 'după livrarea aprobată: 7 tabele sud_, 15 funcții fn_sud_: ' + JSON.stringify(so))
  const d = await dryRun(b)
  ok(d.ok, `dry-run: ${d.blocuri} blocuri ok + TOTUL OK, ROLLBACK (nimic rămas: ${!d.ramas})` + (d.eroare ? ': ' + d.eroare.slice(0, 300) : ''))
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY.replace('\nBEGIN;\n', '\nBEGIN;\n' + FIXTURI + '\n')) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_migrare FAIL/.test(ef || ''), 'dry-run pe baza fără 20270115b = eșec (t_migrare): ' + (ef || 'TRECE').slice(0, 100))
  await fara.close(); await b.close()
}

console.log('3. comportamentul, ca authenticated cu JWT-ul fiecărui cont sintetic')
{
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  ok(a.ok, 'migrarea se aplică' + (a.ok ? '' : ': ' + a.eroare))
  const ab = await verifica(db)
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri${ab.length ? ':\n      ' + ab.join('\n      ') : ''})`)
  await db.close()
}

console.log('4. paritatea formei citirii (fn_sud_citire_valida vs supabase/tests/20270115b_citiri_cazuri.json + limitele)')
{
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const ab = await paritate(db)
  ok(ab.length === 0 && CAZURI.valide.length >= 3 && CAZURI.invalide.length >= 15,
    `${CAZURI.valide.length} valide, ${CAZURI.invalide.length} invalide, ${LIMITE.length} limite; ${ab.length} diferențe` + (ab.length ? ':\n      ' + ab.join('\n      ') : ''))
  await db.close()
}

console.log('5. revenirea: aplicare → revenire → reaplicare; refuzurile revenirii (nimic schimbat)')
{
  const db = await bazaNoua()
  const s0 = await stare(db)
  ok((await livreaza(db, MIG)).ok, 'aplicare pentru revenire')
  const s1 = await stare(db)
  for (const [n, o] of [['cu plafonul 15000', { plafon: 15000 }], ['cu marcajul migrării', { nume: NUME }], ['fără marcaj', { marcaj: false }], ['fără plafon', { plafon: null, marcajPlafon: null }]]) {
    const v = await revino(db, REV, o)
    ok(!v.ok && JSON.stringify(await stare(db)) === JSON.stringify(s1), `revenirea ${n} = refuz, nimic schimbat (${(v.eroare || 'APLICAT').slice(0, 90)})`)
  }
  const v = await revino(db)
  ok(v.ok && JSON.stringify(await stare(db)) === JSON.stringify(s0), 'revenirea: starea EXACTĂ de după 20270114a (obiecte, corpuri, drepturi, politici, ștampile)' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea pusa de migrare/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 100))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările de comportament' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
{
  // exporturile înregistrate după migrare (fotografia cu amprenta_pachet) rămân și nu opresc revenirea; corpul vechi le acceptă din nou
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const a0 = (await amprenta(db, 'OWNER', KA)).rows[0].a
  const f = JSON.stringify({ buletine: [], eliminate: [], metode: [], lipsuri_blocante: [], amprenta_pachet: a0 })
  const e = await ca(db, 'EXE', `SELECT public.fn_sud_export_inregistreaza(${KA}, 'izo', $1::jsonb, NULL, NULL) AS id`, [f], { commit: true })
  const v = await revino(db)
  const e2 = await ca(db, 'EXE', `SELECT public.fn_sud_export_inregistreaza(${KA}, 'izo', $1::jsonb, NULL, NULL) AS id`, [JSON.stringify({ buletine: [], eliminate: [], metode: [], lipsuri_blocante: [] })], { commit: true })
  ok(!e.code && v.ok && !e2.code && (await q(db, 'SELECT count(*)::int AS n FROM public.sud_exporturi'))[0].n === 2,
    'revenirea cu exporturi înregistrate: trece, exporturile rămân, corpul 20270114a acceptă iar fotografia fără amprentă' + (v.ok ? '' : ': ' + v.eroare))
  await db.close()
}
for (const [nume, pregatire, re] of [
  ['o cerere de citire în sud_citiri', async db => {
    await urca(db, 'MPA', `${PA}/${TA12}/r.pdf`); const r = await incarca(db, 'MPA', 'R1', `${PA}/${TA12}/r.pdf`, sha('r'))
    await rezerva(db, 'MPA', Number(r.rows[0].id), 'principal', 'claude-sonnet-5-5', K(90)) }, /exista 1 cereri de citire/],
  ['corpul înregistrării schimbat după migrare', async db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 1; END $f$`), /starea nu e cea pusa de migrare/],
  ['o funcție a migrării lipsă', async db => db.exec('DROP FUNCTION public.fn_sud_amprenta_pachet(bigint)'), /starea nu e cea pusa de migrare/],
  ['un tabel sud_ în plus', async db => db.exec('CREATE TABLE public.sud_zz (id int)'), /starea nu e cea pusa de migrare/],
  ['o funcție fn_sud_ în plus', async db => db.exec('CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$'), /starea nu e cea pusa de migrare/],
  ['o politică în plus pe sud_citiri', async db => db.exec('CREATE POLICY sud_citiri_zz ON public.sud_citiri FOR SELECT TO authenticated USING (false)'), /starea nu e cea pusa de migrare/],
  ['porțile Izometrie roșii', async db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`), /portile Izometrie nu sunt verzi inainte/],
]) {
  const db = await bazaNoua()
  await livreaza(db, MIG)
  await pregatire(db)
  const s = await stare(db)
  const v = await revino(db)
  ok(!v.ok && re.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `revenirea refuză (${nume}), nimic schimbat: ${(v.eroare || 'APLICAT').slice(0, 110)}`)
  await db.close()
}

console.log('6. mutanți')
const FARA_POST = t => { const a = t.indexOf('DO $post$'), b = t.indexOf('END $post$;') + 'END $post$;'.length; return t.slice(0, a) + "DO $post$ BEGIN RAISE NOTICE 'postconditii scoase (mutant)'; END $post$;" + t.slice(b) }
ok(MIG.split('DO $post$').length === 2 && MIG.indexOf('END $post$;') > MIG.indexOf('DO $post$'), 'blocul $post$ se găsește o singură dată')
const comport = async text => {
  const db = await bazaNoua()
  try {
    const a = await livreaza(db, text)
    if (!a.ok) return ['aplicare: ' + a.eroare.slice(0, 160)]
    const d = await dryRun(db)
    const ab = await verifica(db)
    const p = await paritate(db)
    return [...(d.ok ? [] : ['dry-run: ' + (d.eroare || `blocuri ${d.blocuri}, rămas ${d.ramas}`).slice(0, 160)]), ...ab, ...p.map(x => 'paritate: ' + x)]
  } finally { await db.close() }
}
{
  const ab = await comport(FARA_POST(MIG))
  ok(ab.length === 0, `martor: originalul fără postcondiții trece dry-run-ul, verificările și paritatea (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
}
const MUTANTI = [
  ['M1 rezervarea fără dreptul de scriere', [["  IF public.fn_sud_drept(b.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;\n  IF p_cheie IS NULL", '  IF p_cheie IS NULL']]],
  ['M2 cheia refolosită pe altă cerere întoarce starea altuia (fără verificarea intenției)', [['    IF c.buletin_id <> p_buletin OR c.tip <> p_tip OR c.model <> p_model OR c.creat_de <> auth.uid() THEN', '    IF false THEN']]],
  ['M3 cheia reluată de alt utilizator (fără creat_de în intenție)', [[' OR c.model <> p_model OR c.creat_de <> auth.uid() THEN', ' OR c.model <> p_model THEN']]],
  ['M4 fără „o singură cerere în lucru pe buletin”', [["  IF EXISTS (SELECT 1 FROM public.sud_citiri WHERE buletin_id = p_buletin AND stare = 'in_curs' AND creat_la >= now() - interval '5 minutes') THEN", '  IF false THEN']]],
  ['M5 fără limita de cereri pe buletin', [["        AND NOT (stare = 'esuat' AND cost_cunoscut IS TRUE AND cost_usd = 0)) >= 5 THEN", "        AND NOT (stare = 'esuat' AND cost_cunoscut IS TRUE AND cost_usd = 0)) >= 500 THEN"]]],
  ['M6 limita numără și cererile închise fără cost', [["        AND NOT (stare = 'esuat' AND cost_cunoscut IS TRUE AND cost_usd = 0)) >= 5 THEN", ') >= 5 THEN']]],
  ['M7 cererea in_curs nu expiră (niciodată „necunoscut”)', [["                                               WHEN c.creat_la < now() - interval '5 minutes' THEN 'necunoscut' ELSE 'in_curs' END,", "                                               ELSE 'in_curs' END,"]]],
  ['M8 rezervarea pe buletin confirmat', [["  IF b.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: buletinul nu e ciorna (%)', b.stare USING ERRCODE = '55000'; END IF;\n  -- o singură cerere", '  -- o singură cerere']]],
  ['M9 salvarea de altcineva decât autorul cererii', [['  IF c.creat_de <> auth.uid() OR public.fn_sud_drept(b.proiect_id', '  IF public.fn_sud_drept(b.proiect_id']]],
  ['M10 salvarea fără validarea formei', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: citirea are alta forma (%)', v_rau USING ERRCODE = '22023'; END IF;\n", '']]],
  ['M11 salvarea suprascrie o cerere încheiată', [["  IF c.stare <> 'in_curs' THEN\n    IF (c.stare = 'gata'", "  IF false THEN\n    IF (c.stare = 'gata'"]]],
  ['M12 salvarea citirii pe buletin confirmat', [["  IF b.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: buletinul nu e ciorna (%)', b.stare USING ERRCODE = '55000'; END IF;\n  v_rau :=", '  v_rau :=']]],
  ['M13 amprenta fără dreptul de export', [["  IF public.fn_sud_drept(v_proiect, 'export') IS NOT TRUE THEN RAISE EXCEPTION 'sud: fara drept de export pe proiect' USING ERRCODE = '42501'; END IF;\n  SELECT coalesce", '  SELECT coalesce']]],
  ['M14 amprenta fără sarja', [['t.dimensiune, t.sarja, t.unghi_curba', 't.dimensiune, t.unghi_curba']]],
  ['M15 amprenta fără revizia pachetului', [['extract(epoch FROM p.updated_at), p.km_start_m, p.revizie, p.cod_document_full)', 'extract(epoch FROM p.updated_at), p.km_start_m, p.cod_document_full)']]],
  ['M16 amprenta cu updated_at ca text (depinde de fusul orar)', [['extract(epoch FROM p.updated_at)', 'p.updated_at::text']]],
  ['M17 înregistrarea fără compararea amprentei', [["    UNION ALL\n    SELECT 'pachet' WHERE public.fn_sud_amprenta_pachet(p_pachet) IS DISTINCT FROM p_fotografie->>'amprenta_pachet'\n", '']]],
  ['M18 înregistrarea acceptă fotografia fără amprentă', [["  IF jsonb_typeof(p_fotografie->'amprenta_pachet') IS DISTINCT FROM 'string' OR p_fotografie->>'amprenta_pachet' !~ '^[0-9a-f]{32}$' THEN", '  IF false THEN']]],
  ['M19 cererile citibile de oricine autentificat', [["  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));", '  USING (auth.uid() IS NOT NULL);']]],
  ['M20 INSERT direct pe sud_citiri', [['-- secvența de identitate primește', 'GRANT INSERT, UPDATE, DELETE ON public.sud_citiri TO authenticated;\n-- secvența de identitate primește']]],
  ['M21 validarea acceptă orice rezultat text', [["(jsonb_typeof(r->'rezultat') <> 'string' OR r->>'rezultat' NOT IN ('acceptat', 'respins'))", "(jsonb_typeof(r->'rezultat') <> 'string')"]]],
  ['M22 validarea nu compară partial sus / antet', [[" OR (p_citire->'partial') IS DISTINCT FROM (a->'partial') THEN RETURN 'partial'", " THEN RETURN 'partial'"]]],
  ['M23 validarea fără limita de 80 la cod', [["IF jsonb_typeof(r->'cod_raw') <> 'string' OR length(r->>'cod_raw') > 80 OR", "IF jsonb_typeof(r->'cod_raw') <> 'string' OR"]]],
  ['M24 validarea acceptă chei în plus pe rând', [["       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('cod_raw', 'rezultat', 'data_inspectie', 'start_mm', 'end_mm', 'lungime_mm',\n                                                                       'inaltime_mm', 'adancime_mm', 'observatii')) THEN",
    '       OR false THEN']]],
  ['M25 validarea fără data inexistentă (doar formatul)', [["      IF v_m[3]::int > extract(day FROM make_date(v_m[1]::int, v_m[2]::int, 1) + interval '1 month - 1 day') THEN\n        RETURN format('randul %s: data_inspectie', v_i);\n      END IF;\n", '']]],
  ['M26 validarea fără plafonul de 2000 de rânduri', [["OR jsonb_array_length(p_citire->'randuri') > 2000 THEN", ' THEN']]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: |^excepție: /.test(ab[0]), `${nume} pică comportamental (${(ab[0] || 'NU a picat').slice(0, 160)})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără REVOKE pe secvență', [['REVOKE ALL ON SEQUENCE public.sud_citiri_id_seq FROM PUBLIC, anon, authenticated, service_role;', '']], /secventele sud_ \(numar sau drepturi\): sud_citiri_id_seq/],
  ['S2 fără REVOKE pe tabel', [['REVOKE ALL ON public.sud_citiri FROM PUBLIC, anon, authenticated, service_role;', '']], /drepturile tabelelor sud_: sud_citiri/],
  ['S3 RLS oprit', [['ALTER TABLE public.sud_citiri ENABLE ROW LEVEL SECURITY;', '']], /drepturile tabelelor sud_: sud_citiri/],
  ['S4 RLS forțat', [['ALTER TABLE public.sud_citiri ENABLE ROW LEVEL SECURITY;', 'ALTER TABLE public.sud_citiri ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.sud_citiri FORCE ROW LEVEL SECURITY;']], /drepturile tabelelor sud_: sud_citiri/],
  ['S5 EXECUTE rămas pentru anon', [['  public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text), public.fn_sud_amprenta_pachet(bigint) FROM PUBLIC, anon, service_role;', '  public.fn_sud_citire_salveaza(uuid, jsonb, numeric, boolean, text), public.fn_sud_amprenta_pachet(bigint) FROM PUBLIC, service_role;']], /functiile fn_sud_: /],
  ['S6 validarea DEFINER', [['LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$\nDECLARE a jsonb;', 'LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$\nDECLARE a jsonb;']], /functiile fn_sud_: fn_sud_citire_valida/],
  ['S7 a doua politică pe sud_citiri', [['-- ─────────── postcondiții ───────────', "CREATE POLICY sud_citiri_x ON public.sud_citiri FOR SELECT TO authenticated USING (true);\n-- ─────────── postcondiții ───────────"]], /politicile sud_citiri/],
  ['S8 amprenta VOLATILE', [['LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$\nDECLARE v_proiect bigint; v_cap text;', 'LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$\nDECLARE v_proiect bigint; v_cap text;']], /volatilitatea functiilor noi/],
  ['S9 o funcție fn_sud_ în plus', [['-- ─────────── postcondiții ───────────', 'CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 1 $f$;\nREVOKE ALL ON FUNCTION public.fn_sud_zz() FROM PUBLIC, anon, service_role;\nGRANT EXECUTE ON FUNCTION public.fn_sud_zz() TO authenticated;\n-- ─────────── postcondiții ───────────']], /numarul functiilor fn_sud_/],
  ['S10 validarea acceptă citirea goală (cazul de bază din post)', [["IF jsonb_typeof(p_citire->'randuri') <> 'array' OR jsonb_array_length(p_citire->'randuri') = 0 OR", "IF jsonb_typeof(p_citire->'randuri') <> 'array' OR"]], /validarea citirii nu da rezultatele asteptate/],
]) {
  const db = await bazaNoua()
  const s = await stare(db)
  let r
  try { r = await livreaza(db, aplica(MIG, inl)) } catch (e) { r = { ok: false, eroare: 'mutant inaplicabil: ' + e.message } }
  ok(!r.ok && re.test(r.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `${nume}: refuzat de postcondiții (${(r.eroare || 'APLICAT').slice(0, 130)})`)
  await db.close()
}
console.log('   pe gărzile migrării și ale revenirii (același scenariu, alt rezultat)')
const rezultat = async (scenariu, text) => {
  const db = await bazaNoua()
  try { const r = await scenariu(db, text); return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(await stare(db))}` } finally { await db.close() }
}
const SCEN = {
  dreptDeriva: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_drept(p_proiect bigint, p_nivel text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$`); return livreaza(db, t) },
  exportDeriva: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 1; END $f$`); return livreaza(db, t) },
  colLipsa: async (db, t) => { await db.exec('ALTER TABLE public.executie_tevi DROP COLUMN lot'); return livreaza(db, t) },
  revCuDate: async (db, t) => {
    await livreaza(db, MIG); await urca(db, 'MPA', `${PA}/${TA12}/r.pdf`); const r = await incarca(db, 'MPA', 'R1', `${PA}/${TA12}/r.pdf`, sha('r'))
    await rezerva(db, 'MPA', Number(r.rows[0].id), 'principal', 'claude-sonnet-5-5', K(91)); return revino(db, t) },
  revCorpSchimbat: async (db, t) => { await livreaza(db, MIG); await SCEN.exportDeriva(db, '-- nimic'); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără amprenta fn_sud_drept', 'mig', [["          ('public.fn_sud_drept(bigint, text)', 'b95f48de906c9d0047579ca69e961349'),\n", '']], 'dreptDeriva'],
  ['P2 migrare: fără amprenta înregistrării exportului', 'mig', [["        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta\n           OR p.prosecdef IS NOT TRUE", "        WHERE p.oid IS NULL OR (a.semnatura NOT LIKE '%export%' AND md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta)\n           OR p.prosecdef IS NOT TRUE"]], 'exportDeriva'],
  ['P3 migrare: fără verificarea coloanelor amprentei', 'mig', [["    RAISE EXCEPTION '20270115b: coloanele citite de amprenta pachetului lipsesc (executie_pachete_lansare / executie_tevi)';\n", '    NULL;\n']], 'colLipsa'],
  ['R1 revenire: fără verificarea „fără date”', 'rev', [["  IF v_n > 0 THEN RAISE EXCEPTION '20270115b revenire: exista % cereri de citire in sud_citiri; revenirea nu sterge date (decizie separata)', v_n; END IF;\n", '']], 'revCuDate'],
  ['R2 revenire: fără amprenta corpului 20270115b', 'rev', [["          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS DISTINCT FROM '2881656bdc951dd5d53318ccab93feba'\n", "          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS NULL\n"]], 'revCorpSchimbat'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 90)}» / mutant «${rm.slice(0, 90)}»`)
}

console.log(`\n${nrOk} verificări OK, ${esec} NU`)
console.log(esec ? `EȘEC: ${esec} verificări picate` : 'TOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
