// Proba LOCALĂ a migrării 20270116a (Izometrie PR1b: coordonate, clase de locație, pachete de la subcontractor, fotografia inventarului) pe PGlite —
// NU atinge nicio bază reală. Toate datele sunt inventate.
// Baza = „producția de după 20270115b”: scheletele 20270114a + 20270115b + 20270116a, seed-ul sintetic, apoi migrările 20270114a și 20270115b
//   livrate ca runnerul (plafonul extins, marcajele, pasul L15 v2 real). 20270116a se livrează la fel; revenirea cu 2000.
// 0. validatorul runnerului (15000 + --plafon-extins / 2000), fișiere LF fără BOM, detectorul porților, amprentele md5 din migrare și revenire
//    calculate din texte, corpul 20270115b din revenire = textul 20270115b (verbatim), corpul nou = 20270115b + DOAR adaosurile inventarului.
// 1. refuzurile migrării (marcaj, plafon, L15, porți roșii, 20270115b lipsă / schimbată, tip de coloană, reaplicare) — nimic schimbat.
// 2. livrarea L15 v2: manifestul generat = lista revizuită supabase/tests/20270116a_izometrie_coordonate_clase_subcontr.l15.obiecte.tsv (--scrie-obiecte
//    o rescrie); GLOBAL greșit / manifest incomplet = refuz; livrarea aprobată + garda finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic.
// 3. COMPORTAMENT = dry-run-ul (valorile așteptate scrise de mână acolo) + verificările de aici (Storage: fereastra de o oră, orfanii, UPDATE, anon;
//    limitele de mărime), ca authenticated cu JWT-ul fiecărui cont.
// 4. paritatea cu src/lib/izoCoordonate.js: rândurile „ok” din parseazaCoordonate trec și primesc cheia JS; nesigure / nepotrivite / dubluri = refuz.
// 5. revenirea: aplicare → revenire → reaplicare; revenirea cu date / fișiere / corp schimbat / obiect lipsă sau în plus = refuz, nimic schimbat.
// 6. MUTANȚI: comportamentali (postcondițiile scoase: dry-run-ul / verificările / paritatea îi prind), structurali (postcondițiile), pe gărzi.
// Limită: PGlite are o singură sesiune — concurența (două confirmări pe același tronson) e serializată de lock-ul pe tronson, dovedită doar textual
//   (ordinea lock-urilor); proba cu două sesiuni reale rămâne pentru clonă.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izometrie_coordonate_clase_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'ndtk_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270116a_izometrie_coordonate_clase_subcontr', NUME_REV = NUME + '_ROLLBACK'
const NUME14 = '20270114a_izometrie_buletine_ndt', NUME15 = '20270115b_izometrie_ndt_citiri'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`, F_SCHELET = `supabase/tests/${NUME}_schelet.sql`
const F_TEST = 'scripts/pglite/test_izometrie_coordonate_clase_local.mjs'
const F_FIXTURI = 'scripts/pglite/fixturi/executie_constrangeri_productie.sql'
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? readFileSync(process.argv[i + 1], 'utf8').replace(/\r/g, '') : null }
const MIG = arg('--mig') ?? citeste(F_MIG), REV = arg('--rev') ?? citeste(F_REV), DRY = citeste(F_DRY), SCHELET = citeste(F_SCHELET)
const MIG14 = citeste(`supabase/migrations/${NUME14}.sql`), MIG15 = citeste(`supabase/migrations/${NUME15}.sql`)
const SCHELET14 = citeste(`supabase/tests/${NUME14}_schelet.sql`), SCHELET15 = citeste(`supabase/tests/${NUME15}_schelet.sql`), FIXTURI = citeste(F_FIXTURI)
const { parseazaCoordonate } = await import(pathToFileURL(join(ROOT, 'src/lib/izoCoordonate.js')).href)

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

// ── conturile (sintetice) și datele ──
const U = {
  OWNER: '00000000-0000-4000-8000-0000000000e1', MPA: '00000000-0000-4000-8000-0000000000e2', MPB: '00000000-0000-4000-8000-0000000000e3',
  EXE: '00000000-0000-4000-8000-0000000000e4', CTC: '00000000-0000-4000-8000-0000000000e5', NOMOD: '00000000-0000-4000-8000-0000000000e6',
}
const PA = 101, PB = 102, TA12 = 1201, TA13 = 1301, TB12 = 2201, KA = 5001, KA2 = 5003, KB = 5002
const SEED = `
INSERT INTO public.employees (id, name) VALUES (9001, 'MP UNU'), (9002, 'MP DOI');
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES ('${U.OWNER}', 'OWNER', true, NULL), ('${U.MPA}', 'MPA', false, 9001),
  ('${U.MPB}', 'MPB', false, 9002), ('${U.EXE}', 'EXE', false, NULL), ('${U.CTC}', 'CTC', false, NULL), ('${U.NOMOD}', 'NOMOD', false, NULL);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.EXE}', 'executie', 'editor'), ('${U.CTC}', 'ctc', 'editor'),
  ('${U.NOMOD}', 'logistica', 'admin');
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (${PA}, 'TEST-A', 'Proiect A', 9001), (${PB}, 'TEST-B', 'Proiect B', 9002);
INSERT INTO public.executie_tronsoane (id, proiect_id, cod) VALUES (${TA12}, ${PA}, 'TR12'), (${TA13}, ${PA}, 'T13'), (${TB12}, ${PB}, 'TR12');
INSERT INTO public.executie_pachete_lansare (id, proiect_id, tronson_id, cod, km_start_m, revizie, cod_document_full, updated_at)
  VALUES (${KA}, ${PA}, ${TA12}, 'PL-A', 0, 1, 'DOC-A', '2026-11-20 10:00:00+02'), (${KA2}, ${PA}, ${TA12}, 'PL-A2', 500, 0, 'DOC-A2', '2026-11-20 10:00:00+02'),
         (${KB}, ${PB}, ${TB12}, 'PL-B', 0, 0, 'DOC-B', '2026-11-20 10:00:00+02');
INSERT INTO public.executie_tevi (id, pachet_id, poz_in_pachet, tip_rand, serie_unica, sudura_cod, lungime_m, tip, sarja)
  VALUES (71, ${KA}, 1, 'teava', 'S-1', 'T12S1', 12.5, 'T', 'SJ1'), (72, ${KA2}, 1, 'teava', 'S-2', 'T12S2', 11.75, 'T', 'SJ1');`
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
// baza „de după 20270115b” (fără 20270116a)
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET14)
  await db.exec(SCHELET15)
  await db.exec(SCHELET)
  await db.exec(SEED)
  for (const [t, n] of [[MIG14, NUME14], [MIG15, NUME15]]) {
    const a = await livreaza(db, t, { nume: n })
    if (!a.ok) throw new Error(`${n} nu se aplică pe baza probei: ` + a.eroare)
  }
  return db
}

// starea obiectelor (pentru „nimic schimbat”): relațiile public + storage, funcțiile (corp, ACL, DEFINER, volatilitate), politicile, constrângerile,
// bucket-urile, ștampilele porților, rândurile sud_ și fișierele
const TABELE = ['sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi', 'sud_citiri',
  'sud_coordonate_incarcari', 'sud_coordonate', 'sud_clase_surse', 'sud_clase_interval', 'sud_pachete_subcontractor']
const stare = async db => {
  const s = (await db.query(`SELECT
    (SELECT string_agg(c.relname::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '-') || ':' || c.relrowsecurity::text, ',' ORDER BY c.relname)
       FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace, 'storage'::regnamespace)) AS rel,
    (SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || p.prosecdef::text || ':' || p.provolatile::text, ',' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) AS fn,
    (SELECT string_agg(p.polrelid::regclass::text || '.' || p.polname::text || ':' || p.polpermissive::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
       ',' ORDER BY p.polrelid::regclass::text, p.polname) FROM pg_policy p) AS pol,
    (SELECT string_agg(c.conrelid::regclass::text || '.' || c.conname::text || ':' || c.contype::text, ',' ORDER BY c.conrelid::regclass::text, c.conname)
       FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relnamespace = 'public'::regnamespace) AS con,
    (SELECT string_agg(b.id || ':' || b.public::text || ':' || coalesce(b.allowed_mime_types::text, '-'), ',' ORDER BY b.id) FROM storage.buckets b) AS buckets,
    (SELECT string_agg(p.oid::regprocedure::text || '=' || coalesce(obj_description(p.oid, 'pg_proc'), '-'), ',' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_izo\\_porti%') AS stampile,
    (SELECT count(*)::int FROM storage.objects) AS obiecte`)).rows[0]
  for (const t of TABELE) {
    const e = (await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`)).rows[0].e
    s[t] = e ? (await db.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n : 'LIPSA'
  }
  return s
}
const sudOk = async db => (await db.query(`SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'sud\\_%' AND relkind = 'r')::int AS t,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_sud\\_%')::int AS f,
  (SELECT count(*) FROM storage.buckets WHERE id = 'izo-sud-doc')::int AS b,
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\\_doc\\_%')::int AS p`)).rows[0]

// ── rularea ca un cont: JWT-ul ca PostgREST, AMBELE surse; implicit ROLLBACK, cu { commit: true } rămâne ──
const jwt = (uid, rol) => uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true); SELECT set_config('request.jwt.claims', '{"sub": "${uid}", "role": "${rol}"}', true);`
  : `SELECT set_config('request.jwt.claim.sub', '', true); SELECT set_config('request.jwt.claims', '{"role": "${rol}"}', true);`
async function ca(db, cont, sql, params = [], { rol = 'authenticated', commit = false, pre = '' } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${jwt(uid, rol)} ${pre}`)
  try {
    const id = (await db.query(`SELECT current_user AS u, auth.uid()::text AS uid, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`)).rows[0]
    if (id.u !== rol || (uid ? id.uid !== uid : id.uid !== null) || id.bypass) throw new Error('identitate greșită: ' + JSON.stringify(id))
    const r = await db.query(sql, params)
    await db.exec(commit ? 'COMMIT' : 'ROLLBACK'); return { rows: r.rows, afectate: r.affectedRows ?? null }
  } catch (e) { await db.exec('ROLLBACK'); return { code: e.code ?? 'JS', message: e.message } }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows
const sha = s => createHash('sha256').update(s).digest('hex')
const urca = (db, cont, cale, { rol } = {}) => ca(db, cont, `INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-sud-doc', $1, auth.uid(), auth.uid()::text)`, [cale], { commit: true, rol })
const DESCHIDE_STERGEREA = "SELECT set_config('storage.allow_delete_query', 'true', true);"
const sterge = (db, cont, unde, { rol, api = true } = {}) => ca(db, cont, `DELETE FROM storage.objects WHERE ${unde}`, [], { commit: true, rol, pre: api ? DESCHIDE_STERGEREA : '' })
const coordIncarca = (db, cont, tronson, cale, amprenta, randuri) => ca(db, cont, `SELECT public.fn_sud_coord_incarca($1::bigint, $2, 'c.txt', $3, $4::jsonb, NULL) AS id`,
  [tronson, cale, amprenta, typeof randuri === 'string' ? randuri : JSON.stringify(randuri)], { commit: true })
const rand = (linie, cod, x = 584100 + linie, y = 412300, z = 120, raw = cod) => ({ linie, cod_raw: raw, cod, x, y, z })

// ── verificările de comportament de aici (în plus față de dry-run): lista abaterilor (goală = bine); așteptatul scris de mână (L25) ──
async function verifica(db) {
  const ab = []
  const asteapta = (cond, msg, r) => { if (!cond) ab.push(msg + (r === undefined ? '' : ': ' + JSON.stringify(r).slice(0, 220))) }
  try {
    // (a) încărcarea în izo-sud-doc: owner / MP pe proiectul lui (R9); EXE / CTC / NOMOD / MPB / anon = refuz RLS
    for (const n of ['c1.txt', 'c2.txt', 'vechi.txt', 's1.pdf']) { const r = await urca(db, 'MPA', `${PA}/${TA12}/${n}`); asteapta(!r.code, `MPA urcă ${n}`, r) }
    for (const c of ['EXE', 'CTC', 'NOMOD', 'MPB']) { const r = await urca(db, c, `${PA}/${TA12}/x_${c}.txt`); asteapta(r.code === '42501', `${c} urcă pe A = 42501`, r) }
    let r = await ca(db, null, `INSERT INTO storage.objects (bucket_id, name) VALUES ('izo-sud-doc', '${PA}/${TA12}/anon.txt')`, [], { rol: 'anon' })
    asteapta(r.code === '42501', 'anon urcă = refuz', r)
    // (b) fereastra de o oră (fișierul înregistrat doar în prima oră de la încărcare)
    await q(db, `UPDATE storage.objects SET created_at = now() - interval '61 minutes' WHERE bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/vechi.txt'`)
    r = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/vechi.txt`, sha('vechi'), [rand(1, 'T12S1')]); asteapta(r.code === '22023', 'fișierul urcat acum 61 de minute nu se mai înregistrează (22023)', r)
    // (c) limitele de mărime (peste limită = refuz, nu tăiere, L21)
    r = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/c1.txt`, sha('c1'), Array.from({ length: 20001 }, (_, i) => rand(i + 1, 'T12S' + (i + 1))))
    asteapta(r.code === '22023' && /peste 20000/.test(r.message), '20001 de rânduri = 22023', r)
    r = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/c1.txt`, sha('c1'), [rand(1, 'T12S1', 584100.5, 412300.25, 99999.5)])
    asteapta(r.code === '22023' && /z: in afara domeniului/.test(r.message), 'z peste 10.000 m = 22023 (rândul numit)', r)
    r = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/c1.txt`, sha('c1'), [rand(1, 'T12S1', 10000000)])
    asteapta(r.code === '22023' && /x: in afara domeniului/.test(r.message), 'x de 10.000 km = 22023', r)
    r = await ca(db, 'MPA', `SELECT public.fn_sud_clase_incarca(${TA12}, '${PA}/${TA12}/s1.pdf', 's1.pdf', '${sha('s1')}', $1::jsonb) AS id`,
      [JSON.stringify({ text: 'ă'.repeat(1000001) })], { commit: true })
    asteapta(r.code === '22023' && /citirea AI/.test(r.message), 'citirea AI peste 2 MB = 22023', r)
    r = await q(db, `SELECT (SELECT count(*) FROM public.sud_coordonate_incarcari)::int AS i, (SELECT count(*) FROM public.sud_clase_surse)::int AS s`)
    asteapta(r[0].i === 0 && r[0].s === 0, 'după refuzuri: nimic scris', r)
    // (d) încărcarea bună (500 de rânduri; plafonul inclusiv de 20000 e probat o dată, la secțiunea 3) + confirmarea
    r = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/c1.txt`, sha('c1'), Array.from({ length: 500 }, (_, i) => rand(i + 1, 'T12S' + (i + 1))))
    asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), '500 de rânduri = acceptat', r)
    const u1 = Number(r.rows?.[0]?.id)
    r = await ca(db, 'MPA', `SELECT public.fn_sud_coord_confirma($1::bigint, 1, '{}') AS r`, [u1], { commit: true })
    asteapta(r.rows?.[0]?.r?.active === 500, 'confirmarea celor 500 de poziții', r)
    // (e) orfanii: ștergerea propriului fișier NEÎNREGISTRAT, după 2 h, cu dreptul de citire (ca izo-ndt)
    r = await urca(db, 'OWNER', `${PA}/${TA12}/o1.txt`); asteapta(!r.code, 'OWNER urcă o1', r)
    r = await sterge(db, 'OWNER', `bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/o1.txt'`); asteapta(!r.code && r.afectate === 0, 'OWNER: orfanul proaspăt (< 2 h) = 0 rânduri', r)
    r = await urca(db, 'OWNER', `${PA}/${TA12}/o2.pdf`); asteapta(!r.code, 'OWNER urcă o2', r)
    r = await ca(db, 'OWNER', `SELECT public.fn_sud_clase_incarca(${TA12}, '${PA}/${TA12}/o2.pdf', 'o2.pdf', '${sha('o2')}', NULL) AS id`, [], { commit: true })
    asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'OWNER înregistrează o2 ca schemă de montaj', r)
    await q(db, `UPDATE storage.objects SET created_at = now() - interval '3 hours' WHERE bucket_id = 'izo-sud-doc'`)
    r = await sterge(db, 'OWNER', `bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/o1.txt'`, { api: false }); asteapta(r.code === '42501', 'DELETE direct fără Storage API = 42501', r)
    r = await sterge(db, 'OWNER', `bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/o2.pdf'`); asteapta(!r.code && r.afectate === 0, 'OWNER: fișierul ÎNREGISTRAT (sursa claselor) = 0 rânduri', r)
    r = await sterge(db, 'MPA', `bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/c1.txt'`); asteapta(!r.code && r.afectate === 0, 'MPA: fișierul ÎNREGISTRAT (coordonatele) = 0 rânduri', r)
    r = await sterge(db, 'MPA', `bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/c2.txt'`); asteapta(!r.code && r.afectate === 0, 'MPA (fără drept de citire) nu-și șterge orfanul = 0 rânduri', r)
    r = await sterge(db, 'EXE', `bucket_id = 'izo-sud-doc'`); asteapta(!r.code && r.afectate === 0, 'EXE (citire, fără fișiere proprii) = 0 rânduri', r)
    r = await sterge(db, 'OWNER', 'true'); asteapta(!r.code && r.afectate === 1, 'OWNER: DELETE fără condiție = doar orfanul lui o1 (1 rând)', r)
    r = await q(db, `SELECT string_agg(name, ',' ORDER BY name) AS n FROM storage.objects WHERE bucket_id = 'izo-sud-doc'`)
    asteapta(r[0].n === [`${PA}/${TA12}/c1.txt`, `${PA}/${TA12}/c2.txt`, `${PA}/${TA12}/o2.pdf`, `${PA}/${TA12}/s1.pdf`, `${PA}/${TA12}/vechi.txt`].sort().join(','), 'după ștergeri: doar o1 a dispărut', r)
    // (f) UPDATE pe obiect = 0 rânduri (interzis pe izo-sud-doc), anon nu vede nimic
    for (const c of ['MPA', 'OWNER']) {
      r = await ca(db, c, `UPDATE storage.objects SET name = '${PA}/${TA12}/mutat.txt' WHERE bucket_id = 'izo-sud-doc' AND name = '${PA}/${TA12}/c2.txt'`, [], { commit: true })
      asteapta(!r.code && r.afectate === 0, `${c}: UPDATE pe obiect = 0 rânduri`, r)
    }
    r = await ca(db, null, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'izo-sud-doc'`, [], { rol: 'anon' }); asteapta(!r.code && r.rows?.[0]?.n === 0, 'anon vede 0 fișiere', r)
    for (const [c, n] of [['OWNER', 5], ['EXE', 5], ['CTC', 5], ['MPA', 0], ['MPB', 0], ['NOMOD', 0]]) {
      r = await ca(db, c, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'izo-sud-doc'`); asteapta(r.rows?.[0]?.n === n, `${c} vede ${n} fișiere în izo-sud-doc`, r)
      r = await ca(db, c, `SELECT count(*)::int AS n FROM storage.objects`); asteapta(!r.code, `${c} citește tot storage.objects fără eroare (obiectul nenumeric din alt bucket)`, r)
    }
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
  const blocuri = note.filter(n => /^DRY 20270116a \S+ ok/.test(n))
  const ramas = JSON.stringify(await stare(db)) !== JSON.stringify(s0)
  return { ok: !eroare && note.includes('DRY 20270116a TOTUL OK') && blocuri.length >= 14 && !ramas, eroare, blocuri: blocuri.length, ramas }
}

// ── paritatea cu src/lib/izoCoordonate.js (L19): ce JS-ul dă „ok” trece și primește aceeași cheie; ce JS-ul nu dă „ok” e refuzat ca atare ──
const FISIER = [
  'T12S1 584100.000 412300.000 120.000', 'TR12S2 584112 412300 120.1', 'T12S3R 584124,500 412300 120.2', 'T12S50A 584130 412300 120.3',
  'GAZPET TR12 S9 1 2 3', 'T12S88?1 584140 412300 120.4', '143 584150 412300 120.5', 'T13S5 584160 412300 120.6', 'T12S7 1 2',
  'T12S1 584100.000 412300.000 120.000', 'T12S11 1 2 3', 'T12S11 1 2 4', 'T12S12/B 584170 412300 120.7', ''].join('\r\n')
async function paritate(db) {
  const ab = []
  try {
    const rs = parseazaCoordonate(FISIER, 'TR12')
    const peStare = s => rs.filter(r => r.stare === s)
    const lipsa = ['ok', 'repetata', 'dublura', 'nesigur', 'nepotrivit', 'ilizibil'].filter(s => !peStare(s).length)
    if (lipsa.length) ab.push('fișierul de paritate nu acoperă stările: ' + lipsa.join(', '))
    let r = await urca(db, 'MPA', `${PA}/${TA12}/par.txt`)
    if (r.code) ab.push('urcarea fișierului de paritate: ' + r.message)
    const trimis = r => ({ linie: r.linie, cod_raw: r.codRaw, cod: r.codRaw, x: r.x, y: r.y, z: r.z })
    // fiecare rând nesigur / nepotrivit / repetat, trimis netrecut prin om împreună cu rândurile ok, e refuzat de server; o dublură (aceeași
    // sudură, alte coordonate) e refuzată când se trimit toate rândurile ei (dacă omul alege unul, rândul ales e legitim)
    const grupuri = [...rs.filter(x => ['nesigur', 'nepotrivit', 'repetata'].includes(x.stare)).map(x => [x]), peStare('dublura')]
    for (const g of grupuri) {
      const v = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/par.txt`, sha('par'), [...peStare('ok').map(trimis), ...g.map(trimis)])
      if (v.code !== '22023') ab.push(`rândurile ${g.map(x => `${x.linie} (${x.stare} „${x.codRaw}”)`).join(', ')} cu rândurile ok: ${v.code || 'ACCEPTAT'} (aștepta 22023)`)
      if (!v.code) return ab
    }
    const v = await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/par.txt`, sha('par'), peStare('ok').map(trimis))
    if (v.code) { ab.push('rândurile ok refuzate: ' + v.message); return ab }
    const srv = await q(db, `SELECT linie, cheie, cod_corectat FROM public.sud_coordonate WHERE incarcare_id = $1 ORDER BY linie`, [Number(v.rows[0].id)])
    // cheia JS „12|126|A” = cheia serverului „T12S126A” (sufixul din cheie, fără refacere, §22)
    const asteptat = peStare('ok').map(r => { const [t, nr, suf] = r.cheie.split('|'); return `${r.linie}:T${t}S${nr}${suf}:false` })
    const obtinut = srv.map(s => `${s.linie}:${s.cheie}:${s.cod_corectat}`)
    if (JSON.stringify(asteptat) !== JSON.stringify(obtinut)) ab.push(`cheile: JS ${asteptat.join(' ')} / server ${obtinut.join(' ')}`)
    if (!peStare('ok').some(r => r.refacuta) || !peStare('ok').some(r => /,/.test(FISIER.split('\r\n')[r.linie - 1]))) ab.push('fișierul nu acoperă refacerea / virgula zecimală')
  } catch (e) { ab.push('excepție în paritate: ' + String(e.message).slice(0, 200)) }
  return ab
}

const faraComentarii = t => t.replace(/--[^\n]*/g, '')
const corp = (t, cap) => { const i = t.indexOf(cap); if (i < 0 || t.indexOf(cap, i + 1) >= 0) return null; const a = t.indexOf('AS $f$', i) + 6; return t.slice(a, t.indexOf('$f$', a)) }
const CAP_EXP = 'CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza('
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
  for (const f of [F_MIG, F_REV, F_DRY, F_SCHELET, F_OBIECTE, F_TEST]) {
    const brut = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '\r'
    ok(brut.charCodeAt(0) !== 0xFEFF && !/\r/.test(brut), `${f}: există, fără BOM, LF`)
  }
  ok(/^-- Version 20270116120000\. NEAPLICAT\./.test(MIG), 'versiunea migrării: 20270116120000')
  let det
  try { det = { cod: 0, out: execFileSync('node', [join(ROOT, 'scripts/izometrie/porti_regula.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { det = { cod: e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
  const linieDet = f => (det.out.split('\n').find(l => l.includes(f)) || 'LIPSA').trim()
  ok(det.cod === 0 && /^OK /.test(linieDet(`migrations/${NUME}.sql`)) && /^OK /.test(linieDet(`revenire/${NUME_REV}.sql`)),
    `detectorul porților: cod ${det.cod}; ${linieDet(`migrations/${NUME}.sql`).slice(0, 110)}; ${linieDet(`revenire/${NUME_REV}.sql`).slice(0, 110)}`)
  // amprentele din migrare = corpurile din 20270114a / 20270115b (calculate aici din text, nu copiate)
  const MIGc = faraComentarii(MIG), REVc = faraComentarii(REV)
  const a = {
    drept: md5(corp(MIG14, 'CREATE FUNCTION public.fn_sud_drept(')), norm: md5(corp(MIG14, 'CREATE FUNCTION public.fn_sud_cod_normalizeaza(')),
    tnr: md5(corp(MIG14, 'CREATE FUNCTION public.fn_sud_tronson_nr(')), amp: md5(corp(MIG15, 'CREATE FUNCTION public.fn_sud_amprenta_pachet(')),
    exp15: md5(corp(MIG15, CAP_EXP)),
  }
  ok(Object.values(a).every(h => MIGc.split(h).length === 2), `amprentele 20270114a / 20270115b (drept ${a.drept.slice(0, 8)}, normalizator ${a.norm.slice(0, 8)}, tronson ${a.tnr.slice(0, 8)}, amprenta pachetului ${a.amp.slice(0, 8)}, export ${a.exp15.slice(0, 8)}) apar EXACT o dată în migrare`)
  const aExp16 = md5(corp(MIG, CAP_EXP))
  ok(REVc.split(aExp16).length === 2 && REVc.split(a.exp15).length === 2, `revenirea: md5 corpului 20270116a (${aExp16.slice(0, 8)}) înainte și al celui 20270115b (${a.exp15.slice(0, 8)}) după, câte o dată`)
  const M15 = MIG15.slice(MIG15.indexOf(CAP_EXP), MIG15.indexOf('END $f$;', MIG15.indexOf(CAP_EXP)) + 8)
  const blocRev = REV.slice(REV.indexOf('-- CORP_20270115B_INCEPUT\n') + '-- CORP_20270115B_INCEPUT\n'.length, REV.indexOf('\n-- CORP_20270115B_SFARSIT'))
  ok(blocRev === M15, 'corpul fn_sud_export_inregistreaza din revenire = textul 20270115b (verbatim)')
  // corpul nou = corpul 20270115b + EXACT cele două adaosuri ale inventarului (validarea formei, cele trei surse), fiecare sub p_tip = 'inventar'
  const nou = corp(MIG, CAP_EXP), vechi = corp(MIG15, CAP_EXP)
  const i3 = nou.indexOf("  IF p_tip = 'inventar' AND ("), j3 = nou.indexOf('  END IF;\n', i3) + '  END IF;\n'.length
  const i4 = nou.indexOf('    -- inventarul:'), j4 = nou.indexOf('  ) z;', i4)
  const ad3 = nou.slice(i3, j3), ad4 = nou.slice(i4, j4)
  ok(i3 > 0 && i4 > 0 && nou.replace(ad3, '').replace(ad4, '') === vechi && (ad4.match(/UNION ALL/g) || []).length === 3
    && (ad4.match(/WHERE p_tip = 'inventar'/g) || []).length === 3 && /RAISE EXCEPTION .* USING ERRCODE = '22023';/.test(ad3),
  'corpul nou al înregistrării = corpul 20270115b + doar validarea formei inventarului și cele 3 surse (coordonate, clase, pachete), toate sub p_tip = \'inventar\'')
  // L14 în revenire: verificarea stării → LOCK NOWAIT pe tabelele noi → politicile de încărcare scoase → bucket FOR UPDATE NOWAIT → numărarea, toate în $pre$
  const iS = REVc.indexOf('starea nu e cea pusa de migrare'), iL = REVc.indexOf('IN ACCESS EXCLUSIVE MODE NOWAIT;'), iP = REVc.indexOf('DROP POLICY sud_doc_incarcare ON storage.objects;')
  const iB = REVc.indexOf("PERFORM 1 FROM storage.buckets WHERE id = 'izo-sud-doc' FOR UPDATE NOWAIT;"), iN = REVc.indexOf('SELECT (SELECT count(*) FROM public.sud_coordonate_incarcari)')
  ok(iS > 0 && iS < iL && iL < iP && iP < iB && iB < iN && iN < REVc.indexOf('END $pre$;'), 'revenirea: verificarea stării → LOCK NOWAIT → politicile de încărcare scoase → bucket FOR UPDATE NOWAIT → numărarea (L14)')
  // L06: fiecare funcție nouă care blochează mai multe rânduri scrie ordinea lock-urilor; confirmarea / anularea iau tronsonul ÎNAINTEA încărcării / sursei
  for (const f of ['fn_sud_coord_confirma', 'fn_sud_coord_anuleaza', 'fn_sud_clase_confirma', 'fn_sud_clase_anuleaza']) {
    const c = corp(MIG, `CREATE FUNCTION public.${f}(`)
    const iT = c.indexOf('FROM public.executie_tronsoane WHERE id = v_tronson FOR UPDATE'), iI = c.search(/FROM public\.sud_(coordonate_incarcari|clase_surse) WHERE id = p_\w+ FOR UPDATE/)
    ok(iT > 0 && iI > iT, `${f}: tronsonul FOR UPDATE înaintea încărcării / sursei (L06)`)
  }
  ok((MIG.match(/Ordinea lock-urilor \(L06\)/g) || []).length >= 8, 'ordinea lock-urilor scrisă în comentariile funcțiilor de scriere (L06)')
}

console.log('1. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['marcajul altei migrări', { nume: NUME15 }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 5000', { plafon: 5000, marcajPlafon: 5000 }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['porțile Izometrie roșii', {}, /portile Izometrie nu sunt verzi inainte: \{e4b\}/, `CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`],
  ['fn_sud_drept cu alt corp', {}, /nu sunt cele din 20270114a \/ 20270115b/, `CREATE OR REPLACE FUNCTION public.fn_sud_drept(p_proiect bigint, p_nivel text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`],
  ['normalizatorul cu alt corp', {}, /nu sunt cele din 20270114a \/ 20270115b/, `CREATE OR REPLACE FUNCTION public.fn_sud_cod_normalizeaza(p_raw text, p_tronson integer) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT '{"stare": "ok"}'::jsonb $f$`],
  ['amprenta pachetului SECURITY INVOKER', {}, /nu sunt cele din 20270114a \/ 20270115b/, 'ALTER FUNCTION public.fn_sud_amprenta_pachet(bigint) SECURITY INVOKER'],
  ['fn_sud_export_inregistreaza = corpul 20270114a (20270115b neaplicată)', {}, /nu sunt cele din 20270114a \/ 20270115b/,
    MIG14.slice(MIG14.indexOf('CREATE FUNCTION public.fn_sud_export_inregistreaza('), MIG14.indexOf('END $f$;', MIG14.indexOf('CREATE FUNCTION public.fn_sud_export_inregistreaza(')) + 8).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')],
  ['fn_sud_export_inregistreaza cu EXECUTE pentru anon', {}, /nu sunt cele din 20270114a \/ 20270115b/, 'GRANT EXECUTE ON FUNCTION public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) TO anon'],
  ['fn_executie_pachete_acces cu alt corp', {}, /lantul de drept .* nu e cel revizuit/, `CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$`],
  ['revizia pachetului ca text', {}, /coloanele citite nu au tipurile asteptate/, 'ALTER TABLE public.executie_pachete_lansare ALTER COLUMN revizie TYPE text'],
  ['executie_tronsoane.cod lipsă', {}, /coloanele citite nu au tipurile asteptate/, 'ALTER TABLE public.executie_tronsoane RENAME COLUMN cod TO cod_vechi'],
  ['un tabel sud_ în plus', {}, /starea 20270115b lipseste sau are obiecte sud_ in plus/, 'CREATE TABLE public.sud_zz (id int)'],
  ['sud_coordonate existent (reaplicare parțială)', {}, /starea 20270115b lipseste sau are obiecte sud_ in plus/, 'CREATE TABLE public.sud_coordonate (id int)'],
  ['o funcție fn_sud_ în plus', {}, /starea 20270115b lipseste/, `CREATE FUNCTION public.fn_sud_x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$`],
  ['bucket-ul izo-sud-doc existent', {}, /bucket-ul izo-sud-doc .* exista deja/, `INSERT INTO storage.buckets (id, name, public) VALUES ('izo-sud-doc', 'izo-sud-doc', false)`],
  ['o politică sud_doc_ existentă', {}, /bucket-ul izo-sud-doc .* exista deja/, `CREATE POLICY sud_doc_x ON storage.objects FOR SELECT TO authenticated USING (false)`],
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
  await b.exec(SCHELET14); await b.exec(SCHELET15); await b.exec(SCHELET); await b.exec(SEED)
  await livreaza(b, MIG14, { nume: NUME14 })
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /starea 20270115b lipseste/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'fără 20270115b (doar 20270114a) = refuz, nimic schimbat: ' + (r.eroare || 'APLICAT').slice(0, 100))
  await b.close()
}
{
  const b = await bazaNoua()
  const a = await livreaza(b, MIG)
  ok(a.ok, 'aplicare pentru reaplicare' + (a.ok ? '' : ': ' + a.eroare))
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /starea 20270115b lipseste sau are obiecte sud_ in plus/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'reaplicarea = refuz, nimic schimbat: ' + (r.eroare || '').slice(0, 100))
  await b.close()
}

console.log('2. livrarea L15 v2 completă: manifestul = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
let MS_MIGRARE = null
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
    `# 20270116a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}`)
  // L25: ce TREBUIE să apară, scris aici independent de generator: cele 5 tabele, politicile lor, cele 11 funcții noi „creat”, înregistrarea „schimbat”
  const etichete = revizuit.map(l => l.split('\t'))
  const creat = etichete.filter(x => x[2] === 'creat').map(x => x[1]).join('\n')
  const NOI = ['sud_coordonate_incarcari', 'sud_coordonate', 'sud_clase_surse', 'sud_clase_interval', 'sud_pachete_subcontractor']
  const FN_NOI = ['fn_sud_doc_fisier_ok', 'fn_sud_coord_rand_valid', 'fn_sud_clasa_interval_valid', 'fn_sud_coord_incarca', 'fn_sud_coord_confirma', 'fn_sud_coord_anuleaza',
    'fn_sud_clase_incarca', 'fn_sud_clase_confirma', 'fn_sud_clase_anuleaza', 'fn_sud_subcontr_marcheaza', 'fn_sud_subcontr_retrage']
  ok(NOI.every(t => creat.includes(`relatie public.${t}\n`) || creat.endsWith(`relatie public.${t}`)) && NOI.every(t => creat.includes(`${t}_citire`))
    && FN_NOI.every(f => creat.includes(`functie public.${f}(`)) && creat.includes('sud_clase_interval_fara_suprapuneri'),
  'lista revizuită conține cele 5 tabele, politicile lor, cele 11 funcții noi și constrângerea de excludere ca „creat”')
  const altfel = etichete.filter(x => x[2] !== 'creat')
  ok(altfel.length > 0 && altfel.every(x => /fn_sud_export_inregistreaza|fn_izo_porti/.test(x[1])) && !etichete.some(x => /executie_|profiles|fn_executie|user_module_access/.test(x[1])),
    `schimbat doar fn_sud_export_inregistreaza (+ eventual ștampilele porților), nimic pe executie_: ${altfel.map(x => x.join(' ')).join(' | ') || 'nimic'}`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  const linii = manifest.split('\n'), iPol = linii.findIndex(l => /sud_coordonate_citire/.test(l))
  writeFileSync(fIncomplet, linii.filter((_, i) => i !== iPol).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(iPol >= 0 && !gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul politicii sud_coordonate_citire = refuz AMPRENTA_GLOBALA_DUPA, nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  MS_MIGRARE = Number((j.note.map(m => m.match(/^20270116a: sfarsit la (\d+) ms de la BEGIN$/)).find(Boolean) || [])[1])
  ok(j.ok && j.note.some(m => new RegExp(`^AMPRENTA_GLOBALA dupa: ${total} diferente = manifestul`).test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon ${PLAFON_LIVRARE} ms\\)`).test(m)),
  `livrarea aprobată: diferențele (${total}) = manifestul; PLAFON_TIMP (${PLAFON_LIVRARE}); migrarea pe PGlite: ${MS_MIGRARE} ms` + (j.ok ? '' : ': ' + j.eroare))
  const so = await sudOk(b)
  ok(JSON.stringify(so) === '{"t":12,"f":26,"b":1,"p":8}', 'după livrarea aprobată: 12 tabele sud_, 26 funcții fn_sud_, bucket-ul, 8 politici sud_doc_: ' + JSON.stringify(so))
  const d = await dryRun(b)
  ok(d.ok, `dry-run: ${d.blocuri} blocuri ok + TOTUL OK, ROLLBACK (nimic rămas: ${!d.ramas})` + (d.eroare ? ': ' + d.eroare.slice(0, 300) : ''))
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY.replace('\nBEGIN;\n', '\nBEGIN;\n' + FIXTURI + '\n')) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_migrare FAIL/.test(ef || ''), 'dry-run pe baza fără 20270116a = eșec (t_migrare): ' + (ef || 'TRECE').slice(0, 100))
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
{
  // plafonul de 20000 de rânduri e inclusiv (un tronson mare), cu timpul încărcării + confirmării pe PGlite
  const db = await bazaNoua()
  await livreaza(db, MIG)
  await urca(db, 'MPA', `${PA}/${TA13}/mare.txt`)
  const t0 = Date.now()
  const r = await coordIncarca(db, 'MPA', TA13, `${PA}/${TA13}/mare.txt`, sha('mare'), Array.from({ length: 20000 }, (_, i) => rand(i + 1, 'T13S' + (i + 1))))
  const c = r.code ? r : await ca(db, 'MPA', `SELECT public.fn_sud_coord_confirma($1::bigint, 1, '{}') AS r`, [Number(r.rows[0].id)], { commit: true })
  ok(!c.code && c.rows?.[0]?.r?.active === 20000, `20000 de rânduri pe T13: încărcate și confirmate în ${Date.now() - t0} ms` + (c.code ? ': ' + c.message : ''))
  await db.close()
}

console.log('4. paritatea cu src/lib/izoCoordonate.js (parseazaCoordonate)')
{
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const ab = await paritate(db)
  ok(ab.length === 0, `rândurile ok primesc cheia JS, celelalte sunt refuzate; ${ab.length} diferențe` + (ab.length ? ':\n      ' + ab.join('\n      ') : ''))
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
  ok(v.ok && JSON.stringify(await stare(db)) === JSON.stringify(s0), 'revenirea: starea EXACTĂ de după 20270115b (obiecte, corpuri, drepturi, politici, constrângeri, bucket-uri, ștampile)' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea pusa de migrare/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 100))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările de comportament' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
{
  // exporturile de inventar înregistrate după migrare rămân și nu opresc revenirea; corpul 20270115b le acceptă din nou fără cheile inventarului
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const amp = async k => (await ca(db, 'OWNER', `SELECT public.fn_sud_amprenta_pachet(${k}) AS a`)).rows[0].a
  const f = { buletine: [], eliminate: [], metode: [], lipsuri_blocante: [], amprenta_pachet: await amp(KA), coordonate: [], clase: null,
    pachete: [{ id: KA, amprenta: await amp(KA) }, { id: KA2, amprenta: await amp(KA2) }] }
  const e = await ca(db, 'EXE', `SELECT public.fn_sud_export_inregistreaza(${KA}, 'inventar', $1::jsonb, NULL, NULL) AS id`, [JSON.stringify(f)], { commit: true })
  const v = await revino(db)
  const e2 = await ca(db, 'EXE', `SELECT public.fn_sud_export_inregistreaza(${KA}, 'inventar', $1::jsonb, NULL, NULL) AS id`,
    [JSON.stringify({ buletine: [], eliminate: [], metode: [], lipsuri_blocante: [], amprenta_pachet: f.amprenta_pachet })], { commit: true })
  ok(!e.code && v.ok && !e2.code && (await q(db, 'SELECT count(*)::int AS n FROM public.sud_exporturi'))[0].n === 2,
    `revenirea cu un export de inventar înregistrat: trece, exportul rămâne, corpul 20270115b acceptă iar fotografia fără cheile inventarului (${e.message || ''} ${v.eroare || ''} ${e2.message || ''})`)
  await db.close()
}
const cuFisier = async (db, n) => { const r = await urca(db, 'MPA', `${PA}/${TA12}/${n}`); if (r.code) throw new Error('urcare: ' + r.message) }
for (const [nume, pregatire, re] of [
  ['o încărcare de coordonate (încărcarea + rândul + fișierul)', async db => { await cuFisier(db, 'r.txt'); await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/r.txt`, sha('r'), [rand(1, 'T12S1')]) }, /exista 3 randuri \/ fisiere/],
  ['o sursă de clase', async db => { await cuFisier(db, 'r.pdf'); await ca(db, 'MPA', `SELECT public.fn_sud_clase_incarca(${TA12}, '${PA}/${TA12}/r.pdf', 'r.pdf', '${sha('r')}', NULL)`, [], { commit: true }) }, /exista 2 randuri \/ fisiere/],
  ['un marcaj de subcontractor', async db => { await cuFisier(db, 'm.pdf')
    await ca(db, 'MPA', `SELECT public.fn_sud_subcontr_marcheaza(${KA}, 'DOC-A', 1, NULL, '${PA}/${TA12}/m.pdf', 'm.pdf', '${sha('m')}', NULL, NULL, NULL, 'fara excel la proba')`, [], { commit: true }) }, /exista 2 randuri \/ fisiere/],
  ['doar un fișier în bucket', async db => cuFisier(db, 'singur.txt'), /exista 1 randuri \/ fisiere/],
  ['corpul înregistrării schimbat după migrare', async db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 1; END $f$`), /starea nu e cea pusa de migrare/],
  ['o funcție a migrării lipsă', async db => db.exec('DROP FUNCTION public.fn_sud_subcontr_retrage(bigint, integer, text)'), /starea nu e cea pusa de migrare/],
  ['un tabel sud_ în plus', async db => db.exec('CREATE TABLE public.sud_zz (id int)'), /starea nu e cea pusa de migrare/],
  ['o funcție fn_sud_ în plus', async db => db.exec('CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$'), /starea nu e cea pusa de migrare/],
  ['o politică în plus pe sud_coordonate', async db => db.exec('CREATE POLICY sud_coordonate_zz ON public.sud_coordonate FOR SELECT TO authenticated USING (false)'), /starea nu e cea pusa de migrare/],
  ['o politică sud_doc_ în plus', async db => db.exec('CREATE POLICY sud_doc_zz ON storage.objects FOR SELECT TO authenticated USING (false)'), /starea nu e cea pusa de migrare/],
  ['porțile Izometrie roșii', async db => db.exec(`CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`), /portile Izometrie nu sunt verzi inainte/],
]) {
  const db = await bazaNoua()
  await livreaza(db, MIG)
  let s, v
  try { await pregatire(db); s = await stare(db); v = await revino(db) } catch (e) { v = { ok: true, eroare: 'pregătire: ' + e.message } }
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
const DREPT_INCARCA = "  SELECT proiect_id, public.fn_sud_tronson_nr(cod) INTO v_proiect, v_tnr FROM public.executie_tronsoane WHERE id = p_tronson FOR UPDATE;\n  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: tronson inexistent' USING ERRCODE = '22023'; END IF;\n  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;\n"
const MUTANTI = [
  ['M1 încărcarea coordonatelor fără dreptul de scriere', [[DREPT_INCARCA, DREPT_INCARCA.split('\n').slice(0, 2).join('\n') + '\n']]],
  ['M2 încărcarea coordonatelor fără verificarea fișierului', [["  IF public.fn_sud_doc_fisier_ok(v_proiect, p_tronson, p_fisier_path) IS NOT TRUE THEN\n    RAISE EXCEPTION 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' USING ERRCODE = '22023';\n  END IF;\n  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR length(p_fisier_nume) > 300 THEN\n    RAISE EXCEPTION 'sud: amprenta / numele fisierului invalide' USING ERRCODE = '22023';\n  END IF;\n  IF p_rezumat",
    "  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR length(p_fisier_nume) > 300 THEN\n    RAISE EXCEPTION 'sud: amprenta / numele fisierului invalide' USING ERRCODE = '22023';\n  END IF;\n  IF p_rezumat"]]],
  ['M3 fișierul fără proprietarul lui (owner_id)', [[" AND o.owner_id = auth.uid()::text\n                  AND o.created_at > now() - interval '1 hour'), false)", "\n                  AND o.created_at > now() - interval '1 hour'), false)"]]],
  ['M4 fișierul fără fereastra de o oră', [["\n                  AND o.created_at > now() - interval '1 hour'), false)", '), false)']]],
  ['M5 coordonatele cu oricâte zecimale', [["    IF v <> round(v, 3) THEN RETURN k || ': peste 3 zecimale'; END IF;\n    -- limita în variabilă", '    -- limita în variabilă'], ['x = round(x, 3) AND y = round(y, 3) AND z = round(z, 3)\n    AND ', '']]],
  ['M6 cheia sudurii din codul brut, nu din codul ales de om', [["         public.fn_sud_cod_normalizeaza(e.r->>'cod', v_tnr)->>'cheie',\n         (public", "         public.fn_sud_cod_normalizeaza(e.r->>'cod_raw', v_tnr)->>'cheie',\n         (public"]]],
  ['M7 rândul fără verificarea cheilor în plus', [["     OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) j WHERE j NOT IN ('linie', 'cod_raw', 'cod', 'x', 'y', 'z')) THEN", '     THEN']]],
  ['M8 confirmarea coordonatelor fără CAS pe versiune', [["  IF i.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: incarcarea nu e ciorna (%)', i.stare USING ERRCODE = '55000'; END IF;\n  IF p_versiune IS DISTINCT FROM i.versiune THEN RAISE EXCEPTION 'sud: incarcarea s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;\n  -- pozițiile",
    "  IF i.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: incarcarea nu e ciorna (%)', i.stare USING ERRCODE = '55000'; END IF;\n  -- pozițiile"]]],
  ['M9 confirmarea fără confirmarea înlocuirilor', [['  IF v_cer IS DISTINCT FROM v_dif THEN', '  IF false THEN']]],
  ['M10 înlocuirile cerute și pentru valorile identice', [["  SELECT coalesce(array_agg(n.cheie ORDER BY n.cheie) FILTER (WHERE (a.x, a.y, a.z) IS DISTINCT FROM (n.x, n.y, n.z)), '{}'),", "  SELECT coalesce(array_agg(n.cheie ORDER BY n.cheie), '{}'),"]]],
  ['M11 confirmarea fără dreptul de scriere', [["  SELECT * INTO i FROM public.sud_coordonate_incarcari WHERE id = p_incarcare FOR UPDATE;\n  IF public.fn_sud_drept(i.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;\n  IF i.stare <> 'ciorna'",
    "  SELECT * INTO i FROM public.sud_coordonate_incarcari WHERE id = p_incarcare FOR UPDATE;\n  IF i.stare <> 'ciorna'"]]],
  ['M12 anularea coordonatelor fără CAS', [["  IF i.stare = 'anulat' THEN RAISE EXCEPTION 'sud: incarcarea e deja anulata' USING ERRCODE = '55000'; END IF;\n  IF p_versiune IS DISTINCT FROM i.versiune THEN RAISE EXCEPTION 'sud: incarcarea s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;\n",
    "  IF i.stare = 'anulat' THEN RAISE EXCEPTION 'sud: incarcarea e deja anulata' USING ERRCODE = '55000'; END IF;\n"]]],
  ['M13 anularea lasă pozițiile active', [["  UPDATE public.sud_coordonate SET stare = 'anulat' WHERE incarcare_id = i.id AND stare IN ('propus', 'activ');", "  UPDATE public.sud_coordonate SET stare = 'anulat' WHERE incarcare_id = i.id AND stare IN ('propus');"]]],
  ['M14 confirmarea claselor fără verificarea suprapunerilor (doar constrângerea)', [["  IF v_i IS NOT NULL THEN RAISE EXCEPTION 'sud: intervalele % si % se suprapun', v_i, v_j USING ERRCODE = '22023'; END IF;\n", '']]],
  ['M15 constrângerea de excludere și pe intervalele anulate', [['    WHERE (NOT anulat)\n);', '\n);']]],
  ['M16 intervale închise (capetele comune refuzate)', [["numrange(km_de, km_pana, '[)') WITH &&)", "numrange(km_de, km_pana, '[]') WITH &&)"], ["   WHERE a.i < b.i AND numrange((a.r->>'km_de')::numeric, (a.r->>'km_pana')::numeric, '[)') && numrange((b.r->>'km_de')::numeric, (b.r->>'km_pana')::numeric, '[)')",
    "   WHERE a.i < b.i AND numrange((a.r->>'km_de')::numeric, (a.r->>'km_pana')::numeric, '[]') && numrange((b.r->>'km_de')::numeric, (b.r->>'km_pana')::numeric, '[]')"]]],
  ['M17 clasa în afara listei 1–4', [["  IF jsonb_typeof(r->'clasa') <> 'string' OR r->>'clasa' NOT IN ('1', '2', '3', '4') THEN RETURN 'clasa'; END IF;", "  IF jsonb_typeof(r->'clasa') <> 'string' THEN RETURN 'clasa'; END IF;"],
    ["  clasa text NOT NULL CHECK (clasa IN ('1', '2', '3', '4')),", '  clasa text NOT NULL,']]],
  ['M18 mai multe surse de clase vii pe tronson', [["  SELECT id INTO v_id FROM public.sud_clase_surse WHERE tronson_id = p_tronson AND stare <> 'anulat' LIMIT 1;\n  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: clase_deja_incarcate:%', v_id USING ERRCODE = '23505'; END IF;\n", ''],
    ["CREATE UNIQUE INDEX sud_clase_surse_tronson_uq ON public.sud_clase_surse (tronson_id) WHERE stare <> 'anulat';\n", '']]],
  ['M19 confirmarea claselor fără CAS', [["  IF p_versiune IS DISTINCT FROM s.versiune THEN RAISE EXCEPTION 'sud: sursa claselor s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;\n  IF p_intervale IS NULL", '  IF p_intervale IS NULL']]],
  ['M20 marcajul fără codul pachetului', [["  IF v_cheie IS DISTINCT FROM upper(regexp_replace(btrim(coalesce(v_cod, '')), '\\s+', '', 'g')) OR p_revizie IS DISTINCT FROM v_rev THEN", '  IF p_revizie IS DISTINCT FROM v_rev THEN']]],
  ['M21 marcajul fără revizia pachetului', [["  IF v_cheie IS DISTINCT FROM upper(regexp_replace(btrim(coalesce(v_cod, '')), '\\s+', '', 'g')) OR p_revizie IS DISTINCT FROM v_rev THEN", "  IF v_cheie IS DISTINCT FROM upper(regexp_replace(btrim(coalesce(v_cod, '')), '\\s+', '', 'g')) THEN"]]],
  ['M22 Excel-ul opțional fără motiv (D19)', [["  ELSIF length(btrim(coalesce(p_excel_lipsa_motiv, ''))) < 5 THEN", '  ELSIF false THEN'],
    ["    OR (sursa_randuri = 'ai_pdf' AND excel_path IS NULL AND excel_nume IS NULL AND excel_sha256 IS NULL AND length(btrim(excel_lipsa_motiv)) >= 5)),", "    OR (sursa_randuri = 'ai_pdf' AND excel_path IS NULL AND excel_nume IS NULL AND excel_sha256 IS NULL)),"]]],
  ['M23 retragerea marcajului fără CAS', [["  IF p_versiune IS DISTINCT FROM m.versiune THEN RAISE EXCEPTION 'sud: marcajul s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;\n", '']]],
  ['M24 inventarul fără compararea coordonatelor', [["    SELECT 'coordonate' WHERE p_tip = 'inventar'\n      AND", "    SELECT 'coordonate' WHERE false\n      AND"]]],
  ['M25 inventarul fără compararea claselor', [["    SELECT 'clase' WHERE p_tip = 'inventar'\n      AND", "    SELECT 'clase' WHERE false\n      AND"]]],
  ['M26 inventarul fără pachetele vecine (doar pachetul propriu)', [["    SELECT 'pachete' WHERE p_tip = 'inventar'\n      AND", "    SELECT 'pachete' WHERE false\n      AND"]]],
  ['M27 inventarul fără validarea formei', [["  IF p_tip = 'inventar' AND (jsonb_typeof(p_fotografie->'coordonate') IS DISTINCT FROM 'array'", "  IF false AND (jsonb_typeof(p_fotografie->'coordonate') IS DISTINCT FROM 'array'"]]],
  ['M28 coordonatele citibile de oricine autentificat', [["CREATE POLICY sud_coordonate_citire ON public.sud_coordonate FOR SELECT TO authenticated\n  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));", "CREATE POLICY sud_coordonate_citire ON public.sud_coordonate FOR SELECT TO authenticated\n  USING (auth.uid() IS NOT NULL);"]]],
  ['M29 scrieri directe pe sud_coordonate', [['-- secvențele de identitate primesc ALL din privilegiile implicite: clienții nu le folosesc (scrierile sunt ale funcțiilor DEFINER)\nREVOKE ALL ON SEQUENCE public.sud_coordonate_incarcari_id_seq',
    "GRANT INSERT, UPDATE, DELETE ON public.sud_coordonate TO authenticated;\n-- secvențele de identitate primesc ALL din privilegiile implicite: clienții nu le folosesc (scrierile sunt ale funcțiilor DEFINER)\nREVOKE ALL ON SEQUENCE public.sud_coordonate_incarcari_id_seq"]]],
  ['M30 orfanul înregistrat se poate șterge', [["         AND NOT EXISTS (SELECT 1 FROM public.sud_clase_surse s WHERE s.fisier_path = objects.name)\n         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name));\nCREATE POLICY sud_doc_r_sel",
    "         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name));\nCREATE POLICY sud_doc_r_sel"],
    ["         AND NOT EXISTS (SELECT 1 FROM public.sud_clase_surse s WHERE s.fisier_path = objects.name)\n         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name)));",
     "         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name)));"]]],
  ['M31 încărcarea în bucket fără dreptul de scriere', [["              AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')));\n-- ștergerea propriului fișier", "              );\n-- ștergerea propriului fișier"],
    ["              AND owner_id = auth.uid()::text AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')\n              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint\n                            AND t.proiect_id = split_part(name, '/', 1)::bigint)));\nCREATE POLICY sud_doc_r_upd",
     "              AND owner_id = auth.uid()::text\n              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint\n                            AND t.proiect_id = split_part(name, '/', 1)::bigint)));\nCREATE POLICY sud_doc_r_upd"]]],
  ['M32 cheia de linie duplicată acceptată (refuzul lăsat pe constrângere)', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: linia % apare de mai multe ori', v_rau USING ERRCODE = '22023'; END IF;\n", '']]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: |^excepție: /.test(ab[0]), `${nume} pică comportamental (${(ab[0] || 'NU a picat').slice(0, 160)})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără REVOKE pe secvențe', [['REVOKE ALL ON SEQUENCE public.sud_coordonate_incarcari_id_seq, public.sud_coordonate_id_seq, public.sud_clase_surse_id_seq, public.sud_clase_interval_id_seq,\n  public.sud_pachete_subcontractor_id_seq FROM PUBLIC, anon, authenticated, service_role;', '']], /secventele sud_ \(numar sau drepturi\): sud_c/],
  ['S2 fără REVOKE pe tabele', [['REVOKE ALL ON public.sud_coordonate_incarcari, public.sud_coordonate, public.sud_clase_surse, public.sud_clase_interval, public.sud_pachete_subcontractor\n  FROM PUBLIC, anon, authenticated, service_role;', '']], /drepturile tabelelor sud_: sud_c/],
  ['S3 RLS oprit pe sud_coordonate', [['ALTER TABLE public.sud_coordonate ENABLE ROW LEVEL SECURITY;', '']], /drepturile tabelelor sud_: sud_coordonate:/],
  ['S4 RLS forțat', [['ALTER TABLE public.sud_clase_interval ENABLE ROW LEVEL SECURITY;', 'ALTER TABLE public.sud_clase_interval ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.sud_clase_interval FORCE ROW LEVEL SECURITY;']], /drepturile tabelelor sud_: sud_clase_interval/],
  ['S5 EXECUTE rămas pentru anon', [['  public.fn_sud_subcontr_marcheaza(bigint, text, integer, text, text, text, text, text, text, text, text), public.fn_sud_subcontr_retrage(bigint, integer, text)\n  FROM PUBLIC, anon, service_role;', '  public.fn_sud_subcontr_marcheaza(bigint, text, integer, text, text, text, text, text, text, text, text), public.fn_sud_subcontr_retrage(bigint, integer, text)\n  FROM PUBLIC, service_role;']], /functiile fn_sud_: /],
  ['S6 ajutătorul fișierului executabil de clienți', [['-- ─────────── Storage: bucket privat izo-sud-doc', 'GRANT EXECUTE ON FUNCTION public.fn_sud_doc_fisier_ok(bigint, bigint, text) TO authenticated;\n-- ─────────── Storage: bucket privat izo-sud-doc']], /functiile fn_sud_: fn_sud_doc_fisier_ok/],
  ['S7 validarea rândului DEFINER', [['CREATE FUNCTION public.fn_sud_coord_rand_valid(r jsonb) RETURNS text\nLANGUAGE plpgsql IMMUTABLE SET search_path', 'CREATE FUNCTION public.fn_sud_coord_rand_valid(r jsonb) RETURNS text\nLANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path']], /functiile fn_sud_: fn_sud_coord_rand_valid/],
  ['S8 a doua politică pe sud_clase_surse', [['-- ─────────── postcondiții ───────────', "CREATE POLICY sud_clase_surse_x ON public.sud_clase_surse FOR SELECT TO authenticated USING (true);\n-- ─────────── postcondiții ───────────"]], /politicile tabelelor noi: sud_clase_surse/],
  ['S9 fără constrângerea de excludere', [["  UNIQUE (sursa_id, ordine),\n  -- fără suprapuneri pe tronson (R11): [km_de, km_pana) pe intervalele neanulate; ambele chei sunt intervale (int8range pe tronson), deci nu cere btree_gist\n  CONSTRAINT sud_clase_interval_fara_suprapuneri EXCLUDE USING gist (int8range(tronson_id, tronson_id, '[]') WITH &&, numrange(km_de, km_pana, '[)') WITH &&)\n    WHERE (NOT anulat)\n);", '  UNIQUE (sursa_id, ordine)\n);']], /constrangerea de excludere/],
  ['S10 o funcție fn_sud_ în plus', [['-- ─────────── postcondiții ───────────', 'CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT 1 $f$;\nREVOKE ALL ON FUNCTION public.fn_sud_zz() FROM PUBLIC, anon, service_role;\nGRANT EXECUTE ON FUNCTION public.fn_sud_zz() TO authenticated;\n-- ─────────── postcondiții ───────────']], /numarul functiilor fn_sud_/],
  ['S11 bucket public', [["VALUES ('izo-sud-doc', 'izo-sud-doc', false, 52428800,", "VALUES ('izo-sud-doc', 'izo-sud-doc', true, 52428800,"]], /bucket izo-sud-doc \/ politicile lui: bucket/],
  ['S12 politica de UPDATE permisivă', [['CREATE POLICY sud_doc_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC', 'CREATE POLICY sud_doc_r_upd ON storage.objects FOR UPDATE TO PUBLIC']], /politicile lui: sud_doc_r_upd/],
  ['S13 validarea rândului acceptă textul (cazul de bază din post)', [["    IF jsonb_typeof(r->k) <> 'number' THEN RETURN k; END IF;\n    v := (r->>k)::numeric;\n    IF v <> round(v, 3) THEN RETURN k || ': peste 3 zecimale'; END IF;\n    -- limita în variabilă",
    "    IF jsonb_typeof(r->k) NOT IN ('number', 'string') THEN RETURN k; END IF;\n    v := (r->>k)::numeric;\n    IF v <> round(v, 3) THEN RETURN k || ': peste 3 zecimale'; END IF;\n    -- limita în variabilă"]], /validarile nu dau rezultatele asteptate/],
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
  normDeriva: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_cod_normalizeaza(p_raw text, p_tronson integer) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{"stare": "ok"}'::jsonb; END $f$`); return livreaza(db, t) },
  revizieText: async (db, t) => { await db.exec('ALTER TABLE public.executie_pachete_lansare ALTER COLUMN revizie TYPE text'); return livreaza(db, t) },
  // date în tabele, fișierul scos din Storage (altfel FK-ul storage.objects → buckets oprește oricum ștergerea bucket-ului și ascunde garda)
  revCuDate: async (db, t) => {
    await livreaza(db, MIG); await cuFisier(db, 'r.txt'); await coordIncarca(db, 'MPA', TA12, `${PA}/${TA12}/r.txt`, sha('r'), [rand(1, 'T12S1')])
    await db.exec(`BEGIN; SELECT set_config('storage.allow_delete_query', 'true', true); DELETE FROM storage.objects WHERE bucket_id = 'izo-sud-doc'; COMMIT`)
    return revino(db, t) },
  revCorpSchimbat: async (db, t) => { await livreaza(db, MIG); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN 1; END $f$`); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără amprenta fn_sud_drept', 'mig', [["          ('public.fn_sud_drept(bigint, text)', 'b95f48de906c9d0047579ca69e961349', true, 'boolean'),\n", '']], 'dreptDeriva'],
  ['P2 migrare: fără amprenta normalizatorului', 'mig', [["          ('public.fn_sud_cod_normalizeaza(text, integer)', '32a362818c35312d99338496073003bb', false, 'jsonb'),\n", '']], 'normDeriva'],
  ['P3 migrare: fără verificarea tipurilor coloanelor', 'mig', [["    RAISE EXCEPTION '20270116a: coloanele citite nu au tipurile asteptate (executie_tronsoane / executie_pachete_lansare)';\n", '    NULL;\n']], 'revizieText'],
  ['R1 revenire: fără verificarea „fără date”', 'rev', [["  IF v_n > 0 THEN RAISE EXCEPTION '20270116a revenire: exista % randuri / fisiere (coordonate, clase, subcontractor); revenirea nu sterge date (decizie separata)', v_n; END IF;\n", '']], 'revCuDate'],
  // (fără mutantul „fișierele nenumărate”: e echivalent — FK-ul storage.objects → buckets refuză oricum ștergerea bucket-ului cu fișiere; refuzul
  //  cu fișier e probat la secțiunea 5, „doar un fișier în bucket”)
  ['R3 revenire: fără amprenta corpului 20270116a', 'rev', [["          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS DISTINCT FROM '027413e5b45bd549c4e626e1839a01ca'\n", "          WHERE p.oid = to_regprocedure('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)')) IS NULL\n"]], 'revCorpSchimbat'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 90)}» / mutant «${rm.slice(0, 90)}»`)
}

console.log(`\n${nrOk} verificări OK, ${esec} NU (migrarea pe PGlite: ${MS_MIGRARE} ms)`)
console.log(esec ? `EȘEC: ${esec} verificări picate` : 'TOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
