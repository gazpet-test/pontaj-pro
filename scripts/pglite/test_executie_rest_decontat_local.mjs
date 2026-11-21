// Proba LOCALĂ a migrărilor 20270105a (Rest de decontat: schema, drept, calcul, confirmare) și 20270105b (poarta proiectului în configurare) pe
// PGlite — NU atinge nicio bază reală. Baza: schema falsă supabase/tests/20270105a_executie_rest_decontat_schelet.sql (roluri Supabase, auth.uid(),
// tabelele existente cu RLS-ul general al Execuției, STUB-urile porților Izometrie cu ștampilele verzi, un proiect „moștenit” cu articole).
// Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați: manifestul cu ROLLBACK, apoi livrarea aprobată + garda finală).
// 0. Validatorul runnerului (plafonul 5000 la migrări / 2000 la reveniri), detectorul porților Izometrie pe depozit, paritatea UM cu 20261208a.
// 1. Refuzurile migrării A (fără marcaj, fără pasul L15 „înainte”, plafon greșit, porți roșii, porți lipsă, reaplicare, coloană cu alt tip); nimic schimbat.
// 2. Livrarea A: manifestul generat = lista revizuită; rândurile moștenite neatinse (în afara cheii), cheia cu nr doar pe codul repetat în document;
//    ștampilele porților recalculate și verzi; blocul AMPRENTA identic în migrare și revenire, aceeași constantă.
// 3. Dry-run-ul A (supabase/tests/20270105a_…_dryrun.sql, toate blocurile, ROLLBACK la final): toate NOTICE-urile „ok”, nimic rămas.
// 4. MUTANȚI ai migrării A (fiecare TREBUIE prins de dry-run; cu postcondițiile întregi, refuzat la aplicare): dublarea situației, lipsa „înlocuiește”,
//    notele legate adunate încă o dată, restul tăiat la zero, dreptul dat accesului general Execuție, UM-ul neverificat, lipsa ofertei neverificată,
//    factorul UM ignorat.
// 5. Migrarea B peste A: dry-run B; mutanți B (MP fără ofertă acceptat, owner fără motiv acceptat, fără garda pe coloane); revenirea B.
// 6. Revenirile: refuzuri (fără marcaj, cu date, amprentă schimbată, B aplicată peste A), aplicare → revenire → reaplicare, starea de dinainte.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_rest_decontat_local.mjs
//   (--scrie-obiecte rescrie listele revizuite L15 din manifestele generate; --amprente tipărește constantele AMPRENTA calculate)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'restdec_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const A = '20270105a_executie_rest_decontat', B = '20270105b_executie_proiect_configurare'
const F = n => ({ mig: `supabase/migrations/${n}.sql`, rev: `supabase/revenire/${n}_ROLLBACK.sql`, dry: `supabase/tests/${n}_dryrun.sql`, ob: `supabase/tests/${n}.l15.obiecte.tsv` })
const SCHELET = citeste(`supabase/tests/${A}_schelet.sql`)
const MIG_A = citeste(F(A).mig), REV_A = existsSync(join(ROOT, F(A).rev)) ? citeste(F(A).rev) : '', DRY_A = citeste(F(A).dry)
const AREB = existsSync(join(ROOT, F(B).mig))
const MIG_B = AREB ? citeste(F(B).mig) : '', REV_B = AREB && existsSync(join(ROOT, F(B).rev)) ? citeste(F(B).rev) : '', DRY_B = AREB && existsSync(join(ROOT, F(B).dry)) ? citeste(F(B).dry) : ''
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const DOAR = process.argv.find(a => a.startsWith('--doar='))?.slice(7)

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

async function bazaNoua() { const db = new PGlite(); await db.exec(SCHELET); return db }
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = `SET transaction_timeout = ${plafon};`
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
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
// aplicarea ca la livrare (L15 v2): generatorul de manifest (ROLLBACK) comparat cu lista revizuită, apoi livrarea aprobată
async function aplicaLivrare(db, nume, text, fObiecte) {
  let jg = []
  try { jg = await caRunner(db, nume, text, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message); (e.jurnal || []).filter(m => /AMPRENTA_2027/.test(m)).forEach(m => console.log('     ' + m)) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, fObiecte),
    `# ${nume.slice(0, 9)}: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, fObiecte)) ? listaObiecte(citeste(fObiecte)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `${nume.slice(0, 9)}: manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  if (!G || !fara18.length) { ok(false, `${nume.slice(0, 9)}: livrarea nu se poate încerca (generarea manifestului a picat)`); return jg }
  const fManifest = join(TMP, `${nume}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, nume, text, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(nume, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${nume}: garda trecuta`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${nume}: `).test(m) && !/nedeclarat/.test(m)), `${nume.slice(0, 9)}: livrarea aprobată: diferența = manifestul; PLAFON_TIMP; LOCK_TINUT declarat`)
  return j
}
const aplicaA = (db, text = MIG_A, o) => caRunner(db, A, text, o)
const revinoA = (db, text = REV_A, o) => caRunner(db, A + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const aplicaB = (db, text = MIG_B, o) => caRunner(db, B, text, o)
const revinoB = (db, text = REV_B, o) => caRunner(db, B + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function mutant(text, lista) {
  let t = text
  for (const [din, in_] of lista) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const blocAmprenta = (t, n) => { const i = t.indexOf(`AMPRENTA_${n}_INCEPUT`), j = t.indexOf(`-- AMPRENTA_${n}_SFARSIT`); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constanteAmprenta = (t, n) => [...t.matchAll(new RegExp(`'([0-9a-f]{32})' THEN\\n    RAISE NOTICE 'AMPRENTA_${n}_TEXT`, 'g'))].map(x => x[1])
// starea catalogului pentru obiectele atinse (comparată înainte de migrare și după revenire)
const stare = async db => (await q1(db, `SELECT jsonb_build_object(
  'tab', (SELECT string_agg(c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity || ':' || coalesce(c.relacl::text, '-'), ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'S', 'i')),
  'col', (SELECT string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY c.relname, a.attnum)
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped),
  'con', (SELECT string_agg(k.conrelid::regclass::text || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conrelid::regclass::text, k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace AND k.contype <> 'n'),
  'trg', (SELECT string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' ORDER BY 1) FROM pg_trigger t WHERE NOT t.tgisinternal),
  'pol', (SELECT string_agg(p.polrelid::regclass::text || '.' || p.polname || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), ',' ORDER BY 1) FROM pg_policy p),
  'fn', (SELECT string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-'), ',' ORDER BY p.proname, p.oid) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
  'com', (SELECT string_agg(d.description, ',' ORDER BY d.description) FROM pg_description d JOIN pg_proc p ON p.oid = d.objoid AND d.classoid = 'pg_proc'::regclass WHERE p.proname LIKE 'fn_izo_porti%')) AS s`)).s
const randuriMostenite = async db => (await q1(db, `SELECT md5(string_agg(concat_ws('|', id, proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, sursa, act_nr, pret_unitar, created_at), chr(10) ORDER BY id)) AS h, count(*)::int AS n FROM public.proiect_articole WHERE proiect_id = 900`))
// dry-run-ul: o singură tranzacție (BEGIN … ROLLBACK în fișier); întoarce NOTICE-urile
async function dryrun(db, text) {
  const jurnal = []
  try { await db.exec(text, { onNotice: n => jurnal.push(n.message) }) }
  catch (e) { try { await db.exec('ROLLBACK') } catch { /* anulată */ } e.jurnal = jurnal; throw e }
  return jurnal
}
const BLOCURI_A = ['t_fara_baza ok', 'oferta ok', 't_negative_peste_oferta ok', 't_um ok', 't_dublare_situatie ok', 't_aa_leaga_note ok', 't_drept_sef_santier (1/3) ok', 't_drept_sef_santier (2/3) ok', 't_drept_sef_santier (3/3) ok']
async function verificaDry(db, text, blocuri) {
  try {
    const j = await dryrun(db, text)
    const lipsa = blocuri.filter(b => !j.some(m => m.startsWith(b)))
    return lipsa.length ? ['blocuri fără ok: ' + lipsa.join(', ')] : []
  } catch (e) { return ['dry-run picat: ' + e.message] }
}

if (!DOAR || DOAR === '0') {
  console.log('0. validatorul runnerului, detectorul porților, paritatea UM')
  for (const [f, pl, nume] of [[F(A).mig, PLAFON_LIVRARE, 'migrarea A'], [F(A).rev, PLAFON_REVENIRE, 'revenirea A'], ...(AREB ? [[F(B).mig, PLAFON_LIVRARE, 'migrarea B'], [F(B).rev, PLAFON_REVENIRE, 'revenirea B']] : [])]) {
    if (!existsSync(join(ROOT, f))) { ok(false, `${nume}: fișierul lipsește (${f})`); continue }
    const v = validator(join(ROOT, f), '--plafon-tranzactie-ms', String(pl))
    ok(v.ok && /^OK \d+ /.test(v.out), `${nume} trece validatorul cu ${pl}: ${v.out.slice(0, 120)}`)
    const v2 = validator(join(ROOT, f), '--plafon-tranzactie-ms', String(pl === 5000 ? 2000 : 5000))
    ok(!v2.ok && /PLAFON_DIFERIT/.test(v2.out), `${nume} cu alt plafon = refuz`)
    const vf = validator(join(ROOT, f), '--fara-plafon')
    ok(!vf.ok && /PLAFON_LIPSA/.test(vf.out), `${nume} fără plafon = refuz local`)
  }
  try { const o = execFileSync('node', [join(ROOT, 'scripts/izometrie/porti_regula.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); ok(true, 'detectorul porților Izometrie pe tot depozitul: ' + o.trim().split('\n').pop()) }
  catch (e) { ok(false, 'detectorul porților Izometrie: ' + String(e.stdout || '') + String(e.stderr || '')) }
  const um = t => { const i = t.indexOf('-- UM-START'), j = t.indexOf('-- UM-END'); return t.slice(i, j).replace(/\s+/g, ' ') }
  ok(um(MIG_A) === um(citeste('supabase/migrations/20261208a_executie_devize_tinte.sql')), 'lista UM (UM-START / UM-END) identică cu fn_executie_tinte_conversie din 20261208a (L19)')
}

if (!DOAR || DOAR === '1') {
  console.log('1. refuzurile migrării A (nimic schimbat)')
  const db = await bazaNoua()
  const s0 = await stare(db), m0 = await randuriMostenite(db)
  ok(/garda start invalida/.test(await eroare(aplicaA(db, MIG_A, { marcaj: false }))), 'fără marcajul runnerului = refuz')
  ok(/AMPRENTA_GLOBALA_LIPSA/.test(await eroare(aplicaA(db, MIG_A, { l15: 'nimic' }))), 'fără pasul L15 „înainte” = refuz')
  ok(/PLAFON_TRANZACTIE lipsa/.test(await eroare(aplicaA(db, MIG_A, { plafon: 2000 }))), 'plafonul 2000 în loc de 5000 = refuz')
  await db.exec(`COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS 'porti_e4b=00000000000000000000000000000000'`)
  ok(/portile Izometrie nu sunt verzi inainte/.test(await eroare(aplicaA(db))), 'porți roșii înainte = refuz (PRE)')
  await db.exec(`DO $x$ BEGIN EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii()); END $x$`)
  await db.exec('ALTER FUNCTION public.fn_izo_porti_lipsa() RENAME TO fn_izo_porti_lipsa_x')
  ok(/portile Izometrie \(20261230a/.test(await eroare(aplicaA(db))), 'porțile lipsă (20261230a neaplicată) = refuz')
  await db.exec('ALTER FUNCTION public.fn_izo_porti_lipsa_x() RENAME TO fn_izo_porti_lipsa')
  await db.exec(`CREATE FUNCTION public.fn_rest_decontat_proba() RETURNS integer LANGUAGE sql AS 'SELECT 1'`)
  ok(/obiectele exista deja/.test(await eroare(aplicaA(db))), 'o funcție fn_rest_decontat_* există deja (reaplicare / altă formă) = refuz')
  await db.exec('DROP FUNCTION public.fn_rest_decontat_proba()')
  await db.exec('ALTER TABLE public.proiect_articole ADD COLUMN tip_rand text')
  ok(/obiectele exista deja/.test(await eroare(aplicaA(db))), 'o coloană nouă există deja pe proiect_articole = refuz')
  await db.exec('ALTER TABLE public.proiect_articole DROP COLUMN tip_rand')
  await db.exec('ALTER TABLE public.proiect_articole ALTER COLUMN cantitate TYPE text')
  ok(/coloana proiect_articole.cantitate lipseste sau are alt tip/.test(await eroare(aplicaA(db))), 'o coloană folosită cu alt tip = refuz')
  await db.exec('ALTER TABLE public.proiect_articole ALTER COLUMN cantitate TYPE numeric USING cantitate::numeric')
  ok(JSON.stringify(await stare(db)) === JSON.stringify(s0) && JSON.stringify(await randuriMostenite(db)) === JSON.stringify(m0), 'după refuzuri: catalogul și rândurile moștenite identice')
}

let DB = null
if (!DOAR || ['2', '3', '6'].includes(DOAR)) {
  console.log('2. livrarea A (L15 v2) și starea după')
  DB = await bazaNoua()
  const t1 = blocAmprenta(MIG_A, '20270105a'), t2 = REV_A ? blocAmprenta(REV_A, '20270105a') : null
  ok(t1 && t1 === t2, `blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length} caractere)`)
  const k1 = constanteAmprenta(MIG_A, '20270105a'), k2 = REV_A ? constanteAmprenta(REV_A, '20270105a') : []
  ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `aceeași constantă AMPRENTA în ambele fișiere (${k1} / ${k2})`)
  const m0 = await randuriMostenite(DB)
  const j = await aplicaLivrare(DB, A, MIG_A, F(A).ob)
  const amp = j.find(m => /^AMPRENTA_20270105a_TEXT/.test(m))
  if (process.argv.includes('--amprente') || amp) console.log('     amprenta A calculată: ' + (await q1(DB, `SELECT md5($1) AS m`, [amp ? amp.slice('AMPRENTA_20270105a_TEXT '.length) : ''])).m)
  ok(j.some(m => /^20270105a: randuri proiect_articole cu cheie = 6, din care cu nr in cheie = 2/.test(m)), 'NOTICE: 6 rânduri moștenite au cheie, 2 cu nr (codul repetat în același deviz al ofertei)')
  const ch = (await DB.query(`SELECT cod, nr, cheie, activ, confirmat_la FROM public.proiect_articole WHERE proiect_id = 900 ORDER BY id`)).rows
  ok(ch.map(r => r.cheie).join(';') === '0001|D01|TSA01A1|#1;0001|D01|TSA01A1|#2;0001|D02|GC 01;0002|D02|GC 01;0001|D02|GC 01;||TEAVA-DN300' && ch.every(r => r.activ && r.confirmat_la === null),
    'cheile moștenite: nr doar pe codul repetat în același document; AA-ul vechi (alt document) fără nr; toate activ, neconfirmate: ' + ch.map(r => r.cheie).join(';'))
  ok(JSON.stringify(await randuriMostenite(DB)) === JSON.stringify(m0), `rândurile moștenite identice (în afara cheii): ${m0.n} rânduri`)
  const gata = await q1(DB, `SELECT public.fn_izo_porti_lipsa() AS v`)
  ok(JSON.stringify(gata.v) === '[]', 'porțile Izometrie verzi după (ștampilele recalculate): ' + JSON.stringify(gata.v))
  ok(/obiectele exista deja/.test(await eroare(aplicaA(DB))), 'a doua aplicare = refuz')
  // baza proiectului moștenit (ca owner sintetic): AA-ul vechi fără id de act se adună; extras_materiale nu intră
  await DB.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const b = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT cheie, cantitate::text AS c, um, randuri FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 900 ORDER BY cheie`)
  ok(!b.err && JSON.stringify(b.rows) === JSON.stringify([{ cheie: '0001|D01|TSA01A1|#1', c: '120', um: 'MC', randuri: 1 }, { cheie: '0001|D01|TSA01A1|#2', c: '30', um: 'MC', randuri: 1 },
    { cheie: '0001|D02|GC 01', c: '1100', um: 'M', randuri: 2 }, { cheie: '0002|D02|GC 01', c: '500', um: 'M', randuri: 1 }]), 'baza moștenită: contract + AA vechi (1000 + 100 m), fără extras_materiale: ' + JSON.stringify(b.rows || b.msg))
  await DB.exec(`DELETE FROM public.profiles WHERE id = 'f0000000-0000-4000-8000-00000000009a'`)
}
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}

if (!DOAR || DOAR === '3') {
  console.log('3. dry-run-ul A (toate blocurile, ROLLBACK la final)')
  if (!DB) { DB = await bazaNoua(); await aplicaLivrare(DB, A, MIG_A, F(A).ob) }
  const ab = await verificaDry(DB, DRY_A, BLOCURI_A)
  ok(ab.length === 0, 'dry-run A: toate blocurile ok' + (ab.length ? ': ' + ab.join(' | ') : ''))
  const r = await q1(DB, `SELECT (SELECT count(*) FROM public.executie_sl_detaliu) + (SELECT count(*) FROM public.executie_note_modificare) + (SELECT count(*) FROM public.proiect_articole WHERE confirmat_la IS NOT NULL) AS n`)
  ok(Number(r.n) === 0, 'după ROLLBACK-ul dry-run-ului nimic nu a rămas')
}

if (!DOAR || DOAR === '4') {
  console.log('4. MUTANȚI ai migrării A (dry-run-ul trebuie să-i prindă; cu postcondițiile întregi, refuz la aplicare)')
  const POST_A = '-- ─── 12. Postcondiții'
  const MUTANTI_A = [
    ['aceeași amprentă acceptată (dublarea situației)', [[`  IF EXISTS (SELECT 1 FROM public.executie_sl_detaliu d WHERE d.proiect_id = p_proiect AND d.amprenta = p_amprenta) THEN`, `  IF false THEN`]]],
    ['nr. existent fără „înlocuiește” acceptat', [[`    IF NOT p_inlocuieste THEN`, `    IF false THEN`]]],
    ['notele legate de un AA activ cu deviz se adună încă o dată', [[`AND (r0.nota_id IS NULL OR (coalesce(nt.activ, false) AND NOT (coalesce(aan.activ, false) AND coalesce(aan.are_deviz, false))))),`, `AND (r0.nota_id IS NULL OR coalesce(nt.activ, false))),`]]],
    ['AA inactiv încă numărat', [[`     WHERE (r0.act_aditional_id IS NULL OR coalesce(aa.activ, false))`, `     WHERE true`]]],
    ['restul tăiat la zero', [[`art.nr, art.cod, art.denumire, art.um, art.um_incert, art.pret_unitar, art.bc, art.bv, art.dc, art.dv, art.bc - art.dc, art.bv - art.dv,`, `art.nr, art.cod, art.denumire, art.um, art.um_incert, art.pret_unitar, art.bc, art.bv, art.dc, art.dv, greatest(art.bc - art.dc, 0), greatest(art.bv - art.dv, 0),`]]],
    ['accesul general Execuție dă citire', [[`                     WHERE u.profile_id = auth.uid() AND u.module = 'executie_rest_decontat'`, `                     WHERE u.profile_id = auth.uid() AND u.module IN ('executie_rest_decontat', 'executie')`]]],
    ['UM-ul liniei neverificat', [[`      IF v_incert OR v_um IS DISTINCT FROM (SELECT x.um FROM public.fn_rest_decontat_um(e->>'um') x) THEN`, `      IF false THEN`]]],
    ['lipsa ofertei neverificată', [[`    RAISE EXCEPTION 'rest_decontat: proiectul nu are oferta financiara confirmata (fara_baza)' USING ERRCODE = 'P0001';`, `    NULL;`]]],
    ['factorul UM ignorat în bază (100 MC = 1 MC)', [[`         coalesce(sum(u.cantitate * u.factor), 0), coalesce(sum(u.valoare), 0), count(*)::integer,`, `         coalesce(sum(u.cantitate), 0), coalesce(sum(u.valoare), 0), count(*)::integer,`]]],
    ['rândurile confirmate se pot modifica direct', [[`    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`, `    IF false THEN`]]],
  ]
  for (const [nume, lista] of MUTANTI_A) {
    let text
    try { text = mutant(MIG_A, lista) } catch (e) { ok(false, `mutantul „${nume}”: ${e.message}`); continue }
    const db = await bazaNoua()
    let ab
    try { await aplicaA(db, text.slice(0, text.indexOf(POST_A))); ab = await verificaDry(db, DRY_A, BLOCURI_A) } catch (e) { ab = ['aplicarea a picat: ' + e.message] }
    ok(ab.length > 0, `mutantul „${nume}” e prins de dry-run (${ab.length}): ${(ab.join(' | ') || 'NIMIC').slice(0, 200)}`)
    const db2 = await bazaNoua()
    const s0 = await stare(db2)
    const err = await eroare(aplicaA(db2, text))
    ok(/20270105a post:/.test(err || '') && JSON.stringify(await stare(db2)) === JSON.stringify(s0), `mutantul „${nume}” e refuzat la aplicare (postcondiții), nimic schimbat (${(err || 'TRECE').slice(0, 90)})`)
  }
  ok(MIG_A.indexOf(POST_A) > 0 && MIG_A.slice(MIG_A.indexOf(POST_A)).includes('AMPRENTA_20270105a_INCEPUT'), 'postcondițiile conțin amprenta (mutanții o ating)')
}

if (AREB && (!DOAR || DOAR === '5')) {
  console.log('5. migrarea B (poarta proiectului) peste A: dry-run, mutanți, revenire')
  const db = await bazaNoua()
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(/20270105a/.test(await eroare(aplicaB(db, MIG_B, { marcaj: false }))) || /garda start invalida/.test(await eroare(aplicaB(db, MIG_B, { marcaj: false }))), 'B fără marcaj = refuz')
  const t1 = blocAmprenta(MIG_B, '20270105b'), t2 = REV_B ? blocAmprenta(REV_B, '20270105b') : null
  ok(t1 && t1 === t2, `B: blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length})`)
  const k1 = constanteAmprenta(MIG_B, '20270105b'), k2 = REV_B ? constanteAmprenta(REV_B, '20270105b') : []
  ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `B: aceeași constantă AMPRENTA (${k1} / ${k2})`)
  const j = await aplicaLivrare(db, B, MIG_B, F(B).ob)
  const amp = j.find(m => /^AMPRENTA_20270105b_TEXT/.test(m))
  if (process.argv.includes('--amprente') || amp) console.log('     amprenta B calculată: ' + (await q1(db, `SELECT md5($1) AS m`, [amp ? amp.slice('AMPRENTA_20270105b_TEXT '.length) : ''])).m)
  ok(JSON.stringify((await q1(db, `SELECT public.fn_izo_porti_lipsa() AS v`)).v) === '[]', 'B: porțile verzi după')
  const BLOCURI_B = ['t_poarta_mp ok', 't_poarta_owner ok', 't_poarta_cu_oferta ok', 't_poarta_direct ok']
  const ab = await verificaDry(db, DRY_B, BLOCURI_B)
  ok(ab.length === 0, 'dry-run B: toate blocurile ok' + (ab.length ? ': ' + ab.join(' | ') : ''))
  ok(/20270105b/.test(await eroare(revinoA(db))), 'revenirea A cu B aplicată = refuz (întâi revenirea B)')
  const POST_B = '-- ─── 3. Postcondiții'
  const MUTANTI_B = [
    ['MP-ul fără ofertă declară configurarea completă', [[`  IF NOT v_oferta AND NOT (v_owner AND v_motiv IS NOT NULL) THEN`, `  IF false THEN`]]],
    ['owner-ul fără motiv acceptat', [[`  v_motiv := nullif(btrim(regexp_replace(coalesce(p_motiv, ''), '[[:space:]]+', ' ', 'g')), '');`, `  v_motiv := coalesce(nullif(btrim(regexp_replace(coalesce(p_motiv, ''), '[[:space:]]+', ' ', 'g')), ''), 'x');`]]],
    ['fără garda pe coloanele de configurare', [[`CREATE TRIGGER trg_rest_decontat_configurare_garda BEFORE UPDATE OF configurare_completa_la, configurare_exceptie_motiv ON public.executie_proiecte\n  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proiect_configurare_garda();`, '']]],
  ]
  for (const [nume, lista] of MUTANTI_B) {
    let text
    try { text = mutant(MIG_B, lista) } catch (e) { ok(false, `mutantul B „${nume}”: ${e.message}`); continue }
    const dbm = await bazaNoua()
    await aplicaLivrare(dbm, A, MIG_A, F(A).ob)
    let abm
    try { await aplicaB(dbm, text.slice(0, text.indexOf(POST_B))); abm = await verificaDry(dbm, DRY_B, BLOCURI_B) } catch (e) { abm = ['aplicarea a picat: ' + e.message] }
    ok(abm.length > 0, `mutantul B „${nume}” e prins de dry-run (${abm.length}): ${(abm.join(' | ') || 'NIMIC').slice(0, 200)}`)
    const dbm2 = await bazaNoua()
    await aplicaLivrare(dbm2, A, MIG_A, F(A).ob)
    const s0 = await stare(dbm2)
    const err = await eroare(aplicaB(dbm2, text))
    ok(/20270105b post:/.test(err || '') && JSON.stringify(await stare(dbm2)) === JSON.stringify(s0), `mutantul B „${nume}” e refuzat la aplicare, nimic schimbat (${(err || 'TRECE').slice(0, 90)})`)
  }
  // revenirea B: refuz cu date (proiect configurat), apoi pe curat; reaplicare
  const sA = await stare(db)
  await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const c = await caRol(db, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_executie_proiect_configurare_completa(900, 'proba de revenire: exceptie owner') AS v`)
  ok(!c.err && c.rows[0].v.ok === true && c.rows[0].v.exceptie === false && c.rows[0].v.motiv === null, 'B: owner-ul declară configurarea completă pe proiectul moștenit (are ofertă → fără excepție, motivul ignorat): ' + JSON.stringify(c.rows?.[0]?.v || c.msg))
  ok(/proiecte configurate|jurnal/.test(await eroare(revinoB(db)) || ''), 'revenirea B cu proiecte configurate / jurnal = refuz')
  await db.exec(`DELETE FROM public.profiles WHERE id = 'f0000000-0000-4000-8000-00000000009a'`)
  const db3 = await bazaNoua()
  await aplicaLivrare(db3, A, MIG_A, F(A).ob)
  const sA3 = await stare(db3)
  await aplicaLivrare(db3, B, MIG_B, F(B).ob)
  ok(/garda invalida/.test(await eroare(revinoB(db3, REV_B, { marcaj: false }))), 'revenirea B fără marcaj = refuz')
  const jr = await revinoB(db3)
  ok(jr !== null && JSON.stringify(await stare(db3)) === JSON.stringify(sA3), 'revenirea B: catalogul identic cu starea de după A')
  await aplicaLivrare(db3, B, MIG_B, F(B).ob)
  ok((await verificaDry(db3, DRY_B, BLOCURI_B)).length === 0, 'reaplicarea B după revenire: dry-run B ok')
  void sA
}

if (!DOAR || DOAR === '6') {
  console.log('6. revenirea A')
  if (!DB) { DB = await bazaNoua(); await aplicaLivrare(DB, A, MIG_A, F(A).ob) }
  ok(/garda invalida/.test(await eroare(revinoA(DB, REV_A, { marcaj: false }))), 'revenirea A fără marcaj = refuz')
  // cu date confirmate: refuz, nimic schimbat
  await DB.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const c = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_rest_decontat_confirma_baza(900, 'act_aditional', (SELECT id FROM public.executie_acte_aditionale WHERE proiect_id = 900 LIMIT 1), NULL, 'diferente', 'x', repeat('ab', 32), '[{"obiect_cod":"0001","deviz_cod":"D02","cod":"GC 01","denumire":"x","um":"M","cantitate":1,"valoare":80}]'::jsonb) AS v`)
  if (c.err) {
    await DB.exec(`INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act) VALUES (900, 'AA-R')`)
  }
  const c2 = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_rest_decontat_confirma_baza(900, 'act_aditional', (SELECT id FROM public.executie_acte_aditionale WHERE proiect_id = 900 ORDER BY id LIMIT 1), NULL, 'diferente', 'x', repeat('ab', 32), '[{"obiect_cod":"0001","deviz_cod":"D02","cod":"GC 01","denumire":"x","um":"M","cantitate":1,"valoare":80}]'::jsonb) AS v`)
  ok(!c2.err && c2.rows[0].v.inserate === 1, 'un deviz AA confirmat pe proiectul moștenit (date noi): ' + (c2.msg || 'ok'))
  const e1 = await eroare(revinoA(DB))
  ok(/randuri confirmate|date scrise/.test(e1 || ''), `revenirea A cu rânduri confirmate = refuz: ${(e1 || 'TRECE').slice(0, 120)}`)
  ok(Number((await q1(DB, 'SELECT count(*)::int AS n FROM public.proiect_articole WHERE confirmat_la IS NOT NULL')).n) === 1, 'după refuz: rândul confirmat a rămas')
  // bază curată: aplicare → revenire → reaplicare
  const db = await bazaNoua()
  const s0 = await stare(db), m0 = await randuriMostenite(db)
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(/starea nu e cea din 20270105a/.test(await eroare(revinoA(await bazaNoua()))), 'revenirea pe o bază fără migrare = refuz al gărzii (nu eroare de cast)')
  await db.exec('CREATE INDEX x_rd ON public.executie_sl_detaliu (nr_situatie)')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revinoA(db)) || ''), 'un index în plus pe un tabel nou = refuz al revenirii')
  await db.exec('DROP INDEX public.x_rd')
  await db.exec('GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_drept(bigint, text) TO anon')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revinoA(db)) || ''), 'drepturile unei funcții schimbate = refuz al revenirii')
  await db.exec('REVOKE EXECUTE ON FUNCTION public.fn_rest_decontat_drept(bigint, text) FROM anon')
  const jr = await revinoA(db)
  ok(jr !== null && JSON.stringify(await stare(db)) === JSON.stringify(s0), 'revenirea A: catalogul identic cu starea de dinainte (tabele, coloane, constrângeri, triggere, politici, funcții, ștampile)')
  ok(JSON.stringify(await randuriMostenite(db)) === JSON.stringify(m0), 'revenirea A: rândurile moștenite neatinse')
  ok(JSON.stringify((await q1(db, `SELECT public.fn_izo_porti_lipsa() AS v`)).v) === '[]', 'revenirea A: porțile verzi (ștampilele recalculate)')
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok((await verificaDry(db, DRY_A, BLOCURI_A)).length === 0, 'reaplicarea A după revenire: dry-run A ok')
}

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
