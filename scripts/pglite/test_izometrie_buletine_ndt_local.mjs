// Proba LOCALĂ a migrării 20270114a (Izometrie: buletine NDT pe suduri, PR1a) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270114a_izometrie_buletine_ndt_schelet.sql (rolurile Supabase, auth.uid(), storage cu RLS + politicile
//   restrictive 20261209a, tabelele citite cu tipurile din producție, lanțul de drept 20261209a VERBATIM, fn_executie_pachete_acces din 20261029a,
//   stub-ul porților Izometrie). Migrarea rulează ca runnerul: plafonul 5000 (sesiune) + marcajele prologului + PAȘII REALI L15 v2
//   (scripts/livrare_amprenta_gen.sh) + garda finală reală (lm_fin din scripts/livrare_mesaj.sh); revenirea cu plafonul 2000, fără amprenta globală.
// 0. validatorul runnerului (5000 / 2000), fișiere LF fără BOM, paritatea textuală a scheletului (20261209a, 20261029a) și amprentele din migrare.
// 1. refuzurile migrării (marcaj, plafon, pasul L15, porți roșii, reaplicare, coloană cu alt tip, lanțul de drept schimbat) — nimic schimbat.
// 2. livrarea L15 v2: manifestul generat = lista revizuită supabase/tests/20270114a_izometrie_buletine_ndt.l15.obiecte.tsv (--scrie-obiecte o rescrie);
//    GLOBAL greșit / manifest incomplet = refuzul runnerului; livrarea aprobată + garda finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic.
// 3. COMPORTAMENT (valorile așteptate scrise de mână din spec §21–§22, L25), ca rolul authenticated cu JWT-ul fiecărui cont sintetic.
// 4. paritatea normalizatorului: src/lib/izoSudura.cazuri.json (mod legacy) + cazurile spec, SQL vs normalizeazaSudura, diferențele de formă explicite.
// 5. revenirea: aplicare → revenire → reaplicare; revenirea cu date / obiect în bucket / obiect lipsă sau în plus = refuz, nimic schimbat.
// 6. MUTANȚI: comportamentali (postcondițiile scoase: verificările de la 3 trebuie să-i prindă), structurali (postcondițiile îi prind), pe gărzi.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_izometrie_buletine_ndt_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'ndt_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270114a_izometrie_buletine_ndt', NUME_REV = NUME + '_ROLLBACK'
const POLITICI = ['sud_ndt_citire', 'sud_ndt_incarcare', 'sud_ndt_sterge_orfan', 'sud_ndt_r_sel', 'sud_ndt_r_ins', 'sud_ndt_r_upd', 'sud_ndt_r_del', 'sud_ndt_r_anon']
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const F_SCHELET = `supabase/tests/${NUME}_schelet.sql`
const F_FIXTURI = 'scripts/pglite/fixturi/executie_constrangeri_productie.sql'
// --mig <fișier> / --rev <fișier>: rulează proba pe alt text (ex. versiunea dinaintea reparațiilor, ca dovadă că testele o prind)
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? readFileSync(process.argv[i + 1], 'utf8').replace(/\r/g, '') : null }
const MIG = arg('--mig') ?? citeste(F_MIG), REV = arg('--rev') ?? citeste(F_REV), DRY = citeste(F_DRY), SCHELET = citeste(F_SCHELET), FIXTURI = citeste(F_FIXTURI)
const { normalizeazaSudura, tronsonNr } = await import(pathToFileURL(join(ROOT, 'src/lib/izoSudura.js')).href)
const CAZURI = JSON.parse(citeste('src/lib/izoSudura.cazuri.json')).cazuri

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
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

// ── conturile (sintetice) și datele ──
const U = {
  OWNER: '00000000-0000-4000-8000-0000000000d1', MPA: '00000000-0000-4000-8000-0000000000d2', MPB: '00000000-0000-4000-8000-0000000000d3',
  EXE: '00000000-0000-4000-8000-0000000000d4', CTC: '00000000-0000-4000-8000-0000000000d5', NOMOD: '00000000-0000-4000-8000-0000000000d6',
  RSTR: '00000000-0000-4000-8000-0000000000d7', RSTRE: '00000000-0000-4000-8000-0000000000d8', MPC: '00000000-0000-4000-8000-0000000000d9',
}
// proiectele: A (MP = MPA), B (MP = MPB), C (MP = MPC, dar MPC e RESTRÂNS prin executie_acces_proiect doar la B, ca viewer)
const PA = 101, PB = 102, PC = 103
const TA12 = 1201, TA13 = 1301, TA17 = 1701, TB12 = 2201, TC1 = 3101
const KA = 5001, KB = 5002
const SEED = `
INSERT INTO public.employees (id, name) VALUES (9001, 'MP UNU'), (9002, 'MP DOI'), (9003, 'MP TREI'), (9004, 'FARA CONT');
INSERT INTO public.profiles (id, name, is_owner, employee_id) VALUES ('${U.OWNER}', 'OWNER', true, NULL), ('${U.MPA}', 'MPA', false, 9001),
  ('${U.MPB}', 'MPB', false, 9002), ('${U.EXE}', 'EXE', false, NULL), ('${U.CTC}', 'CTC', false, NULL), ('${U.NOMOD}', 'NOMOD', false, NULL),
  ('${U.RSTR}', 'RSTR', false, NULL), ('${U.RSTRE}', 'RSTRE', false, NULL), ('${U.MPC}', 'MPC', false, 9003);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.EXE}', 'executie', 'editor'), ('${U.CTC}', 'ctc', 'editor'),
  ('${U.RSTR}', 'executie', 'editor'), ('${U.RSTRE}', 'executie', 'editor'), ('${U.NOMOD}', 'logistica', 'admin');
INSERT INTO public.executie_proiecte (id, cod_intern, nume, mp_employee_id) VALUES (${PA}, 'TEST-A', 'Proiect A', 9001), (${PB}, 'TEST-B', 'Proiect B', 9002),
  (${PC}, 'TEST-C', 'Proiect C', 9003), (104, 'TEST-D', 'Proiect fara MP', NULL);
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.RSTR}', ${PB}, 'viewer'), ('${U.RSTRE}', ${PB}, 'editor'), ('${U.MPC}', ${PB}, 'viewer');
INSERT INTO public.executie_tronsoane (id, proiect_id, cod) VALUES (${TA12}, ${PA}, 'TR12'), (${TA13}, ${PA}, 'T13'), (${TA17}, ${PA}, 'T17'),
  (${TB12}, ${PB}, 'TR12'), (${TC1}, ${PC}, 'TR 1 FOD');
INSERT INTO public.executie_pachete_lansare (id, proiect_id, tronson_id, cod) VALUES (${KA}, ${PA}, ${TA12}, 'PL-A'), (${KB}, ${PB}, ${TB12}, 'PL-B');`
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  await db.exec(SEED)
  return db
}

// Livrarea migrării ca runnerul (tiparul 20270113a): plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, pasul „înainte” REAL
// (aprobat sau „-”), opțional pasul „după” (manifest „-” = generatorul de manifest) și instrucțiunea finală.
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

// starea obiectelor (pentru „nimic schimbat”): relațiile public + storage, funcțiile (corp, ACL, DEFINER), bucket-urile, politicile, obiectele, rândurile sud_
const stare = async db => {
  const s = (await db.query(`SELECT
    (SELECT string_agg(c.relname::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '-') || ':' || c.relrowsecurity::text, ',' ORDER BY c.relname)
       FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace, 'storage'::regnamespace)) AS rel,
    (SELECT string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-') || ':' || p.prosecdef::text, ',' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) AS fn,
    (SELECT string_agg(b.id || ':' || b.public::text, ',' ORDER BY b.id) FROM storage.buckets b) AS buckets,
    (SELECT string_agg(p.polrelid::regclass::text || '.' || p.polname::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
       ',' ORDER BY p.polrelid::regclass::text, p.polname) FROM pg_policy p) AS pol,
    (SELECT count(*)::int FROM storage.objects) AS obiecte`)).rows[0]
  for (const t of ['sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi']) {
    const e = (await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`)).rows[0].e
    s[t] = e ? (await db.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n : 'LIPSA'
  }
  return s
}
const sudOk = async db => (await db.query(`SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'sud\\_%' AND relkind = 'r')::int AS t,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_sud\\_%')::int AS f,
  (SELECT count(*) FROM storage.buckets WHERE id = 'izo-ndt')::int AS b,
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\\_ndt\\_%')::int AS p`)).rows[0]

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
// încărcarea ca Storage API: owner și owner_id = utilizatorul din JWT (ownerId = proveniență falsificată, pentru refuz)
const urca = (db, cont, cale, { ownerId = null, rol } = {}) => ca(db, cont,
  `INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('izo-ndt', $1, auth.uid(), coalesce($2, auth.uid()::text))`, [cale, ownerId], { commit: true, rol })
// ștergerea ca Storage API remove(): deschide local garda protect_objects_delete, apoi RLS-ul decide; întoarce rândurile șterse
const DESCHIDE_STERGEREA = "SELECT set_config('storage.allow_delete_query', 'true', true);"
const sterge = (db, cont, unde, { rol, api = true } = {}) => ca(db, cont, `DELETE FROM storage.objects WHERE ${unde}`, [], { commit: true, rol, pre: api ? DESCHIDE_STERGEREA : '' })
const incarca = (db, cont, { tronson, metoda = 'PA-UT', numar, data = '2026-11-20', firma = 'LAB SRL', cale, nume = 'b.pdf', amprenta, citiri = null, forteaza = null }) =>
  ca(db, cont, `SELECT public.fn_sud_buletin_incarca($1::bigint, $2, $3, $4::date, $5, $6, $7, $8, $9::jsonb, $10) AS id`,
    [tronson, metoda, numar, data, firma, cale, nume, amprenta, citiri === null ? null : JSON.stringify(citiri), forteaza], { commit: true })
const confirma = (db, cont, id, versiune, randuri) => ca(db, cont, `SELECT public.fn_sud_buletin_confirma($1::bigint, $2::int, $3::jsonb) AS n`,
  [id, versiune, randuri === undefined ? null : (typeof randuri === 'string' ? randuri : JSON.stringify(randuri))], { commit: true })
const anuleaza = (db, cont, id, motiv) => ca(db, cont, `SELECT public.fn_sud_buletin_anuleaza($1::bigint, $2) AS x`, [id, motiv], { commit: true })
const e23505 = (r, re) => r.code === '23505' && re.test(r.message)

// ── COMPORTAMENTUL (după migrare): lista abaterilor (goală = bine). Valorile așteptate vin din spec §21–§22 / decizii, scrise de mână (L25). ──
async function verifica(db) {
  const ab = []
  try { await verificaPasi(db, ab) } catch (e) { ab.push('excepție în verificări: ' + String(e.message).slice(0, 200)) }
  return ab
}
async function verificaPasi(db, ab) {
  const asteapta = (cond, msg, r) => { if (!cond) ab.push(msg + (r === undefined ? '' : ': ' + JSON.stringify(r).slice(0, 220))) }
  // (0) dreptul pe niveluri (R9): [citire, export, scriere] pe proiectele A | B | C, scris de mână din regulă:
  //   citire = owner sau acces la pachete (executie / ctc) + proiect permis; scriere = owner sau MP + proiect permis la scriere;
  //   export = scriere sau acces de scriere la pachete (executie) + proiect permis la scriere. MP fără modul NU citește.
  const DREPT = { OWNER: '111|111|111', MPA: '011|000|000', MPB: '000|011|000', EXE: '110|110|110', CTC: '100|100|100', NOMOD: '000|000|000',
    RSTR: '000|100|000', RSTRE: '000|110|000', MPC: '000|000|000' }
  let r
  for (const [c, ast] of Object.entries(DREPT)) {
    r = await ca(db, c, `SELECT string_agg(concat(public.fn_sud_drept(p, 'citire')::int, public.fn_sud_drept(p, 'export')::int, public.fn_sud_drept(p, 'scriere')::int), '|' ORDER BY p) AS s
                           FROM unnest(ARRAY[${PA}, ${PB}, ${PC}]::bigint[]) p`)
    asteapta(r.rows?.[0]?.s === ast, `${c}: dreptul [citire, export, scriere] pe A | B | C = ${ast}`, r)
  }
  r = await ca(db, 'OWNER', `SELECT public.fn_sud_drept(${PA}, 'altceva') AS a, public.fn_sud_drept(${PA}, NULL) AS b, public.fn_sud_drept(NULL, 'citire') AS c, public.fn_sud_drept(${PA}, 'CITIRE') AS d`)
  asteapta(r.rows?.[0] && ['a', 'b', 'c', 'd'].every(k => r.rows[0][k] === false), 'nivel necunoscut / NULL / proiect NULL = false (nu NULL), chiar și pentru owner', r)
  r = await ca(db, null, `SELECT public.fn_sud_drept(${PA}, 'citire') AS x`, [], { rol: 'anon' }); asteapta(r.code === '42501', 'anon: fără EXECUTE pe fn_sud_drept', r)
  // (a) metodele obligatorii: scriu doar owner / MP pe proiectul lui (și nerestrâns pe el); valori pe lista albă (D10, §22 „ALTA nu poate fi obligatorie”)
  const met = (cont, p, m) => ca(db, cont, `SELECT public.fn_sud_metode_seteaza($1::bigint, $2::text[]) AS x`, [p, m], { commit: true })
  r = await met('MPA', PA, ['PA-UT', 'PM', 'PM']); asteapta(!r.code, 'MPA setează metodele pe A', r)
  r = await met('OWNER', PB, ['UT']); asteapta(!r.code, 'OWNER setează metodele pe B', r)
  for (const [c, p] of [['MPB', PA], ['EXE', PA], ['CTC', PA], ['NOMOD', PA], ['RSTRE', PB], ['MPC', PC], ['MPA', 104]]) {
    r = await met(c, p, ['PM']); asteapta(r.code === '42501', `${c} pe proiectul ${p}: metode = 42501`, r)
  }
  r = await met('MPA', PA, ['RT']); asteapta(r.code === '22023', 'metoda RT nu poate fi obligatorie (22023)', r)
  r = await met('MPA', 999, ['PM']); asteapta(r.code === '22023', 'proiect inexistent (22023)', r)
  r = await ca(db, null, `SELECT public.fn_sud_metode_seteaza(${PA}, ARRAY['PM']) AS x`, [], { rol: 'anon' }); asteapta(r.code === '42501', 'anon: fără EXECUTE', r)
  r = await ca(db, 'OWNER', `SELECT metode, actualizat_de::text AS de FROM public.sud_metode_proiect WHERE proiect_id = ${PA}`)
  asteapta(r.rows?.length === 1 && JSON.stringify(r.rows[0].metode) === '["PA-UT","PM"]' && r.rows[0].de === U.MPA, 'metodele A: deduplicate, ordonate, autorul = serverul', r)
  r = await ca(db, 'MPA', `SELECT count(*)::int AS n FROM public.sud_metode_proiect`); asteapta(r.rows?.[0]?.n === 0, 'MPA (fără acces la pachete) nu citește metodele, deși le scrie (R9)', r)

  // (b) Storage: încărcarea (INSERT ca Storage API, owner = auth.uid()) doar owner / MP, pe <proiect>/<tronson al proiectului>/<nume>
  for (const [c, cale] of [['MPA', `${PA}/${TA12}/b1.pdf`], ['MPA', `${PA}/${TA12}/b2.pdf`], ['MPA', `${PA}/${TA12}/b3.pdf`], ['MPA', `${PA}/${TA17}/t17.pdf`],
    ['OWNER', `${PA}/${TA12}/o1.pdf`], ['MPB', `${PB}/${TB12}/x1.pdf`], ['MPA', `${PA}/${TA13}/t13.pdf`]]) {
    r = await urca(db, c, cale); asteapta(!r.code, `${c} încarcă ${cale}`, r)
  }
  for (const [c, cale, de] of [['MPA', `${PB}/${TB12}/z.pdf`, 'proiectul altuia'], ['MPA', `${PA}/${TB12}/z.pdf`, 'tronsonul B sub proiectul A'],
    ['MPA', `${PA}/z.pdf`, 'fără tronson'], ['MPA', `abc/${TA12}/z.pdf`, 'cale nenumerică'], ['MPA', `${PA}/${TA12}/d/z.pdf`, 'sub-folder'],
    ['EXE', `${PA}/${TA12}/z.pdf`, 'editor executie'], ['CTC', `${PA}/${TA12}/z.pdf`, 'ctc'], ['NOMOD', `${PA}/${TA12}/z.pdf`, 'fără modul'],
    ['MPC', `${PC}/${TC1}/z.pdf`, 'MP restrâns pe alt proiect'], ['RSTRE', `${PB}/${TB12}/z.pdf`, 'editor restrâns pe B']]) {
    r = await urca(db, c, cale); asteapta(r.code === '42501', `${c} încarcă ${cale} (${de}) = refuz RLS`, r)
  }
  r = await urca(db, 'MPA', `${PA}/${TA12}/fals.pdf`, { ownerId: U.OWNER }); asteapta(r.code === '42501', 'MPA încarcă cu owner_id-ul altuia (proveniență falsă) = refuz RLS', r)
  r = await urca(db, 'MPA', `${PA}/${TA12}/fals2.pdf`, { ownerId: '' }); asteapta(r.code === '42501', 'MPA încarcă cu owner_id gol = refuz RLS', r)
  r = await ca(db, null, `INSERT INTO storage.objects (bucket_id, name) VALUES ('izo-ndt', '${PA}/${TA12}/anon.pdf')`, [], { rol: 'anon' })
  asteapta(r.code === '42501', 'anon încarcă = refuz', r)
  r = await ca(db, null, `SELECT count(*)::int AS n FROM storage.objects`, [], { rol: 'anon' })
  asteapta(!r.code && r.rows?.[0]?.n === 0, 'anon citește storage.objects fără eroare (politicile cu funcții nu i se aplică; nicio politică permisivă a lui)', r)
  // citirea obiectelor: cine vede ce în izo-ndt (7 obiecte: 6 pe A, 1 pe B) = dreptul de CITIRE (MP fără modul nu vede, R9);
  // citirea celorlalte bucket-uri nu pică pe cast (obiectul nenumeric)
  const OBI = { OWNER: [6, 1], MPA: [0, 0], MPB: [0, 0], EXE: [6, 1], CTC: [6, 1], NOMOD: [0, 0], RSTR: [0, 1], RSTRE: [0, 1], MPC: [0, 0] }
  for (const [c, [a, b]] of Object.entries(OBI)) {
    r = await ca(db, c, `SELECT count(*) FILTER (WHERE name LIKE '${PA}/%')::int AS a, count(*) FILTER (WHERE name LIKE '${PB}/%')::int AS b FROM storage.objects WHERE bucket_id = 'izo-ndt'`)
    asteapta(r.rows && r.rows[0].a === a && r.rows[0].b === b, `${c} vede în izo-ndt [A, B] = [${a}, ${b}]`, r)
    r = await ca(db, c, `SELECT count(*)::int AS n FROM storage.objects`)
    asteapta(r.rows && !r.code, `${c} citește tot storage.objects fără eroare (obiectul nenumeric din alt bucket)`, r)
  }
  for (const c of ['MPA', 'OWNER']) {
    r = await ca(db, c, `UPDATE storage.objects SET name = '${PA}/${TA12}/mutat.pdf' WHERE bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/b3.pdf'`, [], { commit: true })
    asteapta(!r.code && r.afectate === 0, `${c}: UPDATE pe obiect = 0 rânduri (UPDATE interzis pe izo-ndt)`, r)
  }
  // ștergerea: DELETE direct (fără Storage API) = garda protect_objects_delete; prin API doar orfanul propriu, cu drept de citire
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/o1.pdf'`, { api: false }); asteapta(r.code === '42501', 'DELETE direct fără Storage API = 42501 (protect_objects_delete)', r)
  r = await sterge(db, 'EXE', `bucket_id = 'izo-ndt'`); asteapta(!r.code && r.afectate === 0, 'EXE (citire, fără fișiere proprii) șterge din izo-ndt = 0 rânduri', r)
  r = await sterge(db, 'MPA', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA13}/t13.pdf'`)
  asteapta(!r.code && r.afectate === 0, 'MPA (fără drept de citire) nu-și șterge orfanul = 0 rânduri (verificarea „neînregistrat” cere citire)', r)
  // DELETE fără condiție pe coloane: Postgres NU mai aplică politicile de SELECT (doar pe cele de DELETE) → aici contează citirea cerută de ele
  r = await sterge(db, 'MPA', 'true'); asteapta(!r.code && r.afectate === 0, 'MPA: DELETE fără condiție pe coloane = 0 rânduri (nici înregistratele, nici orfanii)', r)
  r = await sterge(db, null, `bucket_id = 'izo-ndt'`, { rol: 'anon' }); asteapta(!r.code && r.afectate === 0, 'anon șterge din izo-ndt = 0 rânduri', r)

  // (c) încărcarea buletinului
  const H1 = sha('pdf-1'), H2 = sha('pdf-2'), H3 = sha('pdf-3')
  const b1 = await incarca(db, 'MPA', { tronson: TA12, numar: ' 12/ab ', cale: `${PA}/${TA12}/b1.pdf`, nume: 'b1.pdf', amprenta: H1, citiri: { haiku: { randuri: 3 } } })
  asteapta(Number.isInteger(Number(b1.rows?.[0]?.id)), 'MPA încarcă buletinul 1', b1)
  const id1 = Number(b1.rows?.[0]?.id)
  r = await q(db, `SELECT proiect_id::int AS p, numar, numar_cheie, stare, versiune, incarcat_de::text AS de, fortat_motiv, firma_citita FROM public.sud_buletine WHERE id = $1`, [id1])
  asteapta(r.length === 1 && r[0].p === PA && r[0].numar === '12/ab' && r[0].numar_cheie === '12/AB' && r[0].stare === 'ciorna' && r[0].versiune === 1 && r[0].de === U.MPA
    && r[0].fortat_motiv === null && r[0].firma_citita === 'LAB SRL', 'buletinul 1: proiectul din tronson, cheia numărului (trim, majuscule), ciornă v1, autorul = serverul', r)
  for (const [de, o, cod] of [
    ['fișier inexistent', { cale: `${PA}/${TA12}/nu-exista.pdf` }, '22023'],
    ['obiectul încărcat de alt utilizator (OWNER)', { cale: `${PA}/${TA12}/o1.pdf` }, '22023'],
    ['calea altui tronson al proiectului', { tronson: TA13, cale: `${PA}/${TA12}/b2.pdf` }, '22023'],
    ['calea altui proiect', { cale: `${PB}/${TB12}/x1.pdf` }, '22023'],
    ['amprentă invalidă', { amprenta: 'ABC' }, '22023'],
    ['amprentă cu majuscule', { amprenta: H2.toUpperCase() }, '22023'],
    ['metodă necunoscută', { metoda: 'XX' }, '22023'],
    ['metodă lipsă', { metoda: null }, '22023'],
    ['număr gol', { numar: '   ' }, '22023'],
    ['număr peste 60', { numar: 'N'.repeat(61) }, '22023'],
    ['firmă peste 200', { firma: 'F'.repeat(201) }, '22023'],
    ['data în viitor', { data: '2099-01-01' }, '22023'],
    ['citirile nu sunt obiect', { citiri: [1, 2] }, '22023'],
  ]) {
    r = await incarca(db, 'MPA', { tronson: TA12, numar: 'N-' + de.length + '-' + de.charCodeAt(0), cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2, ...o })
    asteapta(r.code === cod, `încărcare: ${de} = ${cod}`, r)
  }
  for (const c of ['EXE', 'CTC', 'MPB', 'NOMOD', 'RSTRE']) {
    r = await incarca(db, c, { tronson: TA12, numar: 'X1', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2 }); asteapta(r.code === '42501', `${c} încarcă pe A = 42501`, r)
  }
  r = await incarca(db, 'MPA', { tronson: 999999, numar: 'X1', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2 }); asteapta(r.code === '22023', 'tronson inexistent = 22023', r)
  r = await incarca(db, 'MPA', { tronson: TA12, numar: 'ALT-NR', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H1 })
  asteapta(e23505(r, new RegExp(`fisier_deja_incarcat:${id1}$`)), 'aceeași amprentă (alt număr, alt fișier) = 23505 cu id-ul existent', r)
  r = await incarca(db, 'MPA', { tronson: TA12, numar: '12 / AB', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2, firma: 'LAB S.R.L.' })
  asteapta(e23505(r, new RegExp(`buletin_deja_incarcat:${id1}$`)), 'aceeași cheie (număr scris altfel, altă firmă) = 23505 cu id-ul existent (R1: firma nu intră în cheie)', r)
  r = await incarca(db, 'MPA', { tronson: TA12, numar: '12/AB', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2, forteaza: '  ' })
  asteapta(e23505(r, /buletin_deja_incarcat/), 'forțarea cu motiv gol = tot 23505', r)
  const b2 = await incarca(db, 'MPA', { tronson: TA12, numar: '12/AB', cale: `${PA}/${TA12}/b2.pdf`, amprenta: H2, forteaza: 'alt laborator, acelasi numar' })
  asteapta(Number.isInteger(Number(b2.rows?.[0]?.id)), 'aceeași cheie FORȚATĂ cu motiv = permisă', b2)
  r = await incarca(db, 'MPA', { tronson: TA12, numar: '12/AB', metoda: 'PM', cale: `${PA}/${TA12}/b3.pdf`, amprenta: H3 })
  asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'aceeași cheie cu ALTĂ metodă = alt buletin', r)
  const id3 = Number(r.rows?.[0]?.id)
  // scrieri directe = refuz pe toate tabelele, pentru oricine (și owner)
  for (const c of ['OWNER', 'MPA']) {
    for (const [t, ins] of [['sud_buletine', `(proiect_id, tronson_id, metoda, numar, numar_cheie, data_buletin, fisier_path, fisier_sha256, incarcat_de) VALUES (${PA}, ${TA12}, 'PM', 'D', 'D', '2026-11-01', 'x', '${H1}', auth.uid())`],
      ['sud_buletin_randuri', `(buletin_id, ordine, cod_raw, stare_cod, rezultat) VALUES (${id1}, 99, 'x', 'nepotrivit', 'acceptat')`],
      ['sud_metode_proiect', `(proiect_id, metode, actualizat_de) VALUES (${PC}, '{PM}', auth.uid())`],
      ['sud_suduri_eliminate', `(proiect_id, tronson_id, cheie, motiv, creat_de) VALUES (${PA}, ${TA12}, 'T12S1', 'xxx', auth.uid())`],
      ['sud_export_deblocari', `(proiect_id, pachet_id, tip, motiv, lipsuri, creat_de) VALUES (${PA}, ${KA}, 'izo', 'xxxxx', '[1]', auth.uid())`],
      ['sud_exporturi', `(proiect_id, pachet_id, tip, fotografie, incomplet, creat_de) VALUES (${PA}, ${KA}, 'izo', '{}', false, auth.uid())`]]) {
      const col = { sud_buletine: 'numar', sud_buletin_randuri: 'cod_raw', sud_metode_proiect: 'metode', sud_suduri_eliminate: 'motiv', sud_export_deblocari: 'motiv', sud_exporturi: 'tip' }[t]
      r = await ca(db, c, `INSERT INTO public.${t} ${ins}`); asteapta(r.code === '42501', `${c}: INSERT direct în ${t} = 42501`, r)
      r = await ca(db, c, `UPDATE public.${t} SET ${col} = ${col}`); asteapta(r.code === '42501', `${c}: UPDATE direct pe ${t} = 42501`, r)
      r = await ca(db, c, `DELETE FROM public.${t}`); asteapta(r.code === '42501', `${c}: DELETE direct pe ${t} = 42501`, r)
    }
    r = await ca(db, c, `SELECT nextval('public.sud_buletine_id_seq') AS n`); asteapta(r.code === '42501', `${c}: nextval pe secvența sud_buletine = 42501`, r)
  }

  // (d) confirmarea (CAS pe versiune, rânduri validate, cheia sudurii calculată de server, §22)
  const RANDURI = [
    { cod_raw: 'GAZPET TR12 S126R', rezultat: 'Acceptat', data_inspectie: '2026-11-18', start_mm: 10, end_mm: 20 },
    { cod_raw: 'GAZPET TR12 S126', rezultat: 'respins', data_inspectie: '2026-11-10', lungime_mm: 4.5, observatii: 'pori' },
    { cod_raw: 'T12S88?1', rezultat: 'admis' },
    { cod_raw: 'GAZPET TR13 S5', rezultat: 'accepted' },
    { cod_raw: 'S127', rezultat: 'rejected' },
    { cod_raw: 'T12S50A', rezultat: 'acceptat' },
  ]
  r = await confirma(db, 'MPA', id1, 2, RANDURI); asteapta(r.code === '40001', 'confirmarea cu versiunea veche / greșită (2 în loc de 1) = 40001', r)
  r = await confirma(db, 'MPA', id1, null, RANDURI); asteapta(r.code === '40001', 'confirmarea fără versiune = 40001', r)
  r = await confirma(db, 'MPA', id1, 1, []); asteapta(r.code === '22023', 'rânduri goale = 22023', r)
  r = await confirma(db, 'MPA', id1, 1, '{"a": 1}'); asteapta(r.code === '22023', 'rândurile nu sunt listă = 22023', r)
  r = await confirma(db, 'MPA', id1, 1); asteapta(r.code === '22023', 'rânduri lipsă = 22023', r)
  r = await confirma(db, 'MPA', id1, 1, Array.from({ length: 2001 }, (_, i) => ({ cod_raw: 'S' + (i + 1), rezultat: 'acceptat' })))
  asteapta(r.code === '22023', 'peste 2000 de rânduri = 22023', r)
  r = await confirma(db, 'MPA', id1, 1, [...RANDURI, { cod_raw: 'S9', rezultat: 'poate' }]); asteapta(r.code === '22023' && /randul 7 are rezultat necunoscut/.test(r.message), 'rezultat necunoscut = 22023 (rândul numit)', r)
  r = await confirma(db, 'MPA', id1, 1, [{ cod_raw: 'S9' }]); asteapta(r.code === '22023', 'rezultat lipsă = 22023', r)
  r = await confirma(db, 'MPA', id1, 1, ['S9']); asteapta(r.code === '22023', 'rând care nu e obiect = 22023', r)
  r = await confirma(db, 'MPA', id1, 1, [{ cod_raw: 'S1', rezultat: 'acceptat' }, { cod_raw: 'T12S' + '1'.repeat(77), rezultat: 'acceptat' }])
  asteapta(r.code === '22023' && /randul 2 are campuri/.test(r.message), 'cod peste 80 de caractere = refuz 22023 (nu tăiere tăcută, L21)', r)
  r = await confirma(db, 'MPA', id1, 1, [{ cod_raw: 'S1', rezultat: 'acceptat', observatii: 'o'.repeat(501) }])
  asteapta(r.code === '22023' && /randul 1 are campuri/.test(r.message), 'observații peste 500 de caractere = refuz 22023 (nu tăiere tăcută, L21)', r)
  // tipurile câmpurilor JSON (conținut extern): nicio coerciție tăcută
  for (const [de, rand] of [
    ['data inspecției în alt format („mâine”)', { data_inspectie: 'mâine' }], ['data inspecției ZZ.LL.AAAA', { data_inspectie: '18.11.2026' }],
    ['data inspecției număr', { data_inspectie: 20261118 }], ['indicație text („12,5”)', { start_mm: '12,5' }], ['indicație text cu punct („12.5”)', { end_mm: '12.5' }],
    ['indicație obiect', { adancime_mm: { v: 1 } }], ['observații număr', { observatii: 5 }], ['observații listă', { observatii: ['a'] }],
    ['cod număr', { cod_raw: 127 }], ['cod lipsă', { cod_raw: undefined }], ['cod obiect', { cod_raw: { t: 12 } }], ['rezultat boolean', { rezultat: true }],
  ]) {
    r = await confirma(db, 'MPA', id1, 1, [{ cod_raw: 'S1', rezultat: 'acceptat', ...rand }])
    asteapta(r.code === '22023' && /randul 1 are campuri de alt tip/.test(r.message), `rând cu ${de} = refuz 22023 (rândul numit)`, r)
  }
  r = await confirma(db, 'MPA', id1, 1, [{ cod_raw: 'S1', rezultat: 'acceptat', data_inspectie: '2026-13-45' }])
  asteapta(r.code === '22008', 'data inspecției în formă corectă dar inexistentă = eroare de dată (nimic scris)', r)
  for (const c of ['EXE', 'MPB', 'CTC', 'NOMOD']) {
    r = await confirma(db, c, id1, 1, RANDURI); asteapta(r.code === '42501', `${c} confirmă buletinul lui A = 42501`, r)
  }
  r = await q(db, `SELECT stare, versiune, (SELECT count(*)::int FROM public.sud_buletin_randuri WHERE buletin_id = $1) AS n FROM public.sud_buletine WHERE id = $1`, [id1])
  asteapta(r[0]?.stare === 'ciorna' && r[0]?.versiune === 1 && r[0]?.n === 0, 'după refuzuri: ciornă v1, niciun rând scris', r)
  r = await confirma(db, 'MPA', id1, 1, RANDURI); asteapta(r.rows?.[0]?.n === 6, 'MPA confirmă cu versiunea citită: 6 rânduri', r)
  r = await q(db, `SELECT ordine, cod_raw, stare_cod, motiv_cod, tronson_nr, nr, sufix, refacuta, cheie, rezultat, data_inspectie::text AS di, ind_start::text AS st, ind_lungime::text AS lg, observatii
                     FROM public.sud_buletin_randuri WHERE buletin_id = $1 ORDER BY ordine`, [id1])
  const ASTEPTAT = [
    [1, 'ok', null, 12, 126, '', true, 'T12S126', 'acceptat'], [2, 'ok', null, 12, 126, '', false, 'T12S126', 'respins'],
    [3, 'nepotrivit', 'format', null, null, '', false, null, 'acceptat'], [4, 'nepotrivit', 'alt_tronson', null, null, '', false, null, 'acceptat'],
    [5, 'ok', null, 12, 127, '', false, 'T12S127', 'respins'], [6, 'ok', null, 12, 50, 'A', false, 'T12S50A', 'acceptat']]
  asteapta(r.length === 6 && r.every((x, i) => JSON.stringify([x.ordine, x.stare_cod, x.motiv_cod, x.tronson_nr, x.nr, x.sufix, x.refacuta, x.cheie, x.rezultat]) === JSON.stringify(ASTEPTAT[i]))
    && r[0].di === '2026-11-18' && r[0].st === '10' && r[1].lg === '4.5' && r[1].observatii === 'pori' && r[2].cod_raw === 'T12S88?1',
  'rândurile: TR12 S126R → T12S126 refăcută, S126 → aceeași cheie (D18), T12S88?1 nepotrivit, TR13 pe T12 = alt_tronson, S127 din context, T12S50A sufix A; rezultatele normalizate',
  r.map(x => [x.ordine, x.stare_cod, x.motiv_cod, x.cheie, x.refacuta, x.rezultat]))
  r = await q(db, `SELECT stare, versiune, confirmat_de::text AS de FROM public.sud_buletine WHERE id = $1`, [id1])
  asteapta(r[0]?.stare === 'confirmat' && r[0]?.versiune === 2 && r[0]?.de === U.MPA, 'buletinul 1: confirmat v2, confirmat_de = serverul', r)
  r = await confirma(db, 'MPA', id1, 2, RANDURI); asteapta(r.code === '55000', 'a doua confirmare (confirmat) = 55000', r)
  // T17S50A pe tronsonul T17 (sufix = sudură distinctă, §14) — prin owner
  const b17 = await incarca(db, 'OWNER', { tronson: TA17, metoda: 'UT', numar: 'U-17', cale: `${PA}/${TA17}/t17.pdf`, amprenta: sha('pdf-17') })
  asteapta(b17.code === '22023', 'OWNER nu poate înregistra fișierul urcat de MPA (proprietarul obiectului) = 22023', b17)
  r = await urca(db, 'OWNER', `${PA}/${TA17}/o17.pdf`); asteapta(!r.code, 'OWNER urcă pe T17', r)
  const b17b = await incarca(db, 'OWNER', { tronson: TA17, metoda: 'UT', numar: 'U-17', cale: `${PA}/${TA17}/o17.pdf`, amprenta: sha('pdf-17') })
  const id17 = Number(b17b.rows?.[0]?.id)
  r = await confirma(db, 'OWNER', id17, 1, [{ cod_raw: 'T17S50A', rezultat: 'acceptat' }, { cod_raw: 'T17S50H', rezultat: 'acceptat' }, { cod_raw: 'tr 17 s 50 ar', rezultat: 'respins' }])
  asteapta(r.rows?.[0]?.n === 3, 'OWNER confirmă pe T17', r)
  r = await q(db, `SELECT string_agg(cheie || ':' || refacuta, ',' ORDER BY ordine) AS k FROM public.sud_buletin_randuri WHERE buletin_id = $1`, [id17])
  asteapta(r[0]?.k === 'T17S50A:false,T17S50H:false,T17S50A:true', 'T17S50A / T17S50H suduri distincte; „tr 17 s 50 ar” = T17S50A refăcută', r)
  // orfanul: proprietarul (cu citire) își șterge fișierul NEÎNREGISTRAT; cel înregistrat rămâne; fișierul altuia rămâne
  // fereastra de timp (Jak r2 P1): orfanul PROASPĂT (< 2 h) nu se șterge; apoi toate obiectele sunt îmbătrânite (3 h), ca verificările de mai jos
  // să testeze regula „neînregistrat” / „al altuia”, nu fereastra
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/o1.pdf'`); asteapta(!r.code && r.afectate === 0, 'OWNER: orfanul PROASPĂT (< 2 h) nu se șterge = 0 rânduri (fereastra)', r)
  await q(db, `UPDATE storage.objects SET created_at = now() - interval '3 hours' WHERE bucket_id = 'izo-ndt'`)
  r = await incarca(db, 'OWNER', { tronson: TA12, numar: 'O-VECHI', cale: `${PA}/${TA12}/o1.pdf`, amprenta: sha('pdf-o1-vechi') }); asteapta(r.code === '22023', 'fișierul încărcat acum > 1 h nu se mai înregistrează (22023, fereastra)', r)
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA17}/o17.pdf'`); asteapta(!r.code && r.afectate === 0, 'OWNER: fișierul propriu ÎNREGISTRAT (buletinul T17) nu se șterge = 0 rânduri', r)
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA17}/t17.pdf'`); asteapta(!r.code && r.afectate === 0, 'OWNER: orfanul ALTUIA (MPA) nu se șterge = 0 rânduri', r)
  r = await sterge(db, 'EXE', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/b2.pdf'`); asteapta(!r.code && r.afectate === 0, 'EXE: fișierul altuia nu se șterge = 0 rânduri', r)
  r = await sterge(db, 'MPA', `bucket_id = 'izo-ndt' AND name IN ('${PA}/${TA12}/b1.pdf', '${PA}/${TA12}/b2.pdf')`)
  asteapta(!r.code && r.afectate === 0, 'MPA: propriile fișiere ÎNREGISTRATE (pe care nu le poate citi) nu se șterg = 0 rânduri', r)
  r = await sterge(db, 'MPA', 'true'); asteapta(!r.code && r.afectate === 0, 'MPA: DELETE fără condiție pe coloane după înregistrări = 0 rânduri', r)
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/o1.pdf'`); asteapta(!r.code && r.afectate === 1, 'OWNER își șterge orfanul neînregistrat o1.pdf după 2 h = 1 rând', r)
  r = await q(db, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'izo-ndt' AND name IN ('${PA}/${TA12}/o1.pdf', '${PA}/${TA17}/o17.pdf', '${PA}/${TA17}/t17.pdf')`)
  asteapta(r[0]?.n === 2, 'după ștergeri: o1 șters, o17 (înregistrat) și t17 (al altuia) rămân', r)
  r = await incarca(db, 'OWNER', { tronson: TA12, numar: 'O-1', cale: `${PA}/${TA12}/o1.pdf`, amprenta: sha('pdf-o1') }); asteapta(r.code === '22023', 'orfanul șters nu se mai poate înregistra (22023)', r)

  // (e) citirea tabelelor: cine vede ce (A are buletinele 1, 2, 3 + T17; B nimic încă)
  const VEDE = { OWNER: [4, 9], MPA: [0, 0], EXE: [4, 9], CTC: [4, 9], MPB: [0, 0], NOMOD: [0, 0], RSTR: [0, 0], RSTRE: [0, 0], MPC: [0, 0] }
  for (const [c, [nb, nr]] of Object.entries(VEDE)) {
    r = await ca(db, c, `SELECT (SELECT count(*)::int FROM public.sud_buletine) AS b, (SELECT count(*)::int FROM public.sud_buletin_randuri) AS r, (SELECT count(*)::int FROM public.sud_metode_proiect) AS m`)
    const m = { OWNER: 2, MPA: 0, EXE: 2, CTC: 2, MPB: 0, NOMOD: 0, RSTR: 1, RSTRE: 1, MPC: 0 }[c]
    asteapta(r.rows?.[0]?.b === nb && r.rows[0].r === nr && r.rows[0].m === m, `${c} vede [buletine, rânduri, metode] = [${nb}, ${nr}, ${m}]`, r)
  }
  r = await ca(db, null, `SELECT count(*)::int AS n FROM public.sud_buletine`, [], { rol: 'anon' }); asteapta(r.code === '42501', 'anon: fără SELECT pe sud_buletine', r)

  // (f) anularea: confirmat → anulat; anulat → nimic; reîncărcarea aceluiași fișier și aceleiași chei după anulare
  r = await anuleaza(db, 'EXE', id1, 'gresit tronson'); asteapta(r.code === '42501', 'EXE anulează = 42501', r)
  r = await anuleaza(db, 'MPA', id1, 'x'); asteapta(r.code === '22023', 'anulare cu motiv prea scurt = 22023', r)
  r = await anuleaza(db, 'MPA', id1, 'gresit tronson'); asteapta(!r.code, 'MPA anulează buletinul confirmat (R5)', r)
  r = await q(db, `SELECT stare, versiune, anulat_de::text AS de, anulat_motiv FROM public.sud_buletine WHERE id = $1`, [id1])
  asteapta(r[0]?.stare === 'anulat' && r[0]?.versiune === 3 && r[0]?.de === U.MPA && r[0]?.anulat_motiv === 'gresit tronson', 'buletinul 1: anulat v3, autorul = serverul', r)
  r = await anuleaza(db, 'MPA', id1, 'din nou anulat'); asteapta(r.code === '55000', 'anulat → anulat = 55000', r)
  r = await confirma(db, 'MPA', id1, 3, RANDURI); asteapta(r.code === '55000', 'anulat → confirmat = 55000', r)
  r = await anuleaza(db, 'MPA', id3, 'ciorna gresita'); asteapta(!r.code, 'ciornă → anulat', r)
  r = await urca(db, 'MPA', `${PA}/${TA12}/b1-bis.pdf`); asteapta(!r.code, 'MPA urcă din nou fișierul', r)
  const b1bis = await incarca(db, 'MPA', { tronson: TA12, numar: '12/AB', cale: `${PA}/${TA12}/b1-bis.pdf`, amprenta: H1 })
  asteapta(Number.isInteger(Number(b1bis.rows?.[0]?.id)), 'după anulare: același fișier (amprentă) și aceeași cheie se reîncarcă fără forțare (R1, §22)', b1bis)
  r = await incarca(db, 'MPA', { tronson: TA12, numar: '12/AB', cale: `${PA}/${TA12}/b1-bis.pdf`, amprenta: sha('pdf-alt') })
  asteapta(e23505(r, new RegExp(`buletin_deja_incarcat:${Number(b1bis.rows?.[0]?.id)}$`)), 'cheia e ocupată din nou de buletinul reîncărcat', r)
  // fișierul unui buletin ANULAT rămâne (istoric): proprietarul nu-l mai poate șterge
  r = await urca(db, 'OWNER', `${PA}/${TA12}/oan.pdf`); asteapta(!r.code, 'OWNER urcă oan.pdf', r)
  const ban = await incarca(db, 'OWNER', { tronson: TA12, metoda: 'VT', numar: 'OAN', cale: `${PA}/${TA12}/oan.pdf`, amprenta: sha('pdf-oan') })
  r = await anuleaza(db, 'OWNER', Number(ban.rows?.[0]?.id), 'incarcat din greseala'); asteapta(!ban.code && !r.code, 'OWNER încarcă și anulează buletinul VT', [ban, r])
  r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/oan.pdf'`); asteapta(!r.code && r.afectate === 0, 'OWNER: fișierul unui buletin ANULAT nu se șterge = 0 rânduri', r)

  // (g) sudurile eliminate (R4): cheia fără refacere, înlocuitoarele normalizate, dublură, retragere, re-marcare
  const elim = (c, tr, cod, motiv, inl) => ca(db, c, `SELECT public.fn_sud_sudura_elimina($1::bigint, $2, $3, $4::text[]) AS id`, [tr, cod, motiv, inl], { commit: true })
  r = await elim('MPA', TA12, 'gazpet tr12 s126', 'cupon dupa 3 reparatii', ['S200', 'T12S201']); asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'MPA marchează T12S126 eliminată', r)
  const e1 = Number(r.rows?.[0]?.id)
  r = await q(db, `SELECT cheie, inlocuita_de, activ, creat_de::text AS de, proiect_id::int AS p FROM public.sud_suduri_eliminate WHERE id = $1`, [e1])
  asteapta(r[0]?.cheie === 'T12S126' && JSON.stringify(r[0]?.inlocuita_de) === '["T12S200","T12S201"]' && r[0]?.activ === true && r[0]?.de === U.MPA && r[0]?.p === PA,
    'marcajul: cheia T12S126, înlocuitoarele T12S200 / T12S201, autorul și proiectul = serverul', r)
  r = await elim('MPA', TA12, 'T12S126', 'a doua oara', []); asteapta(e23505(r, /deja marcata/), 'aceeași sudură activă = 23505', r)
  r = await elim('MPA', TA12, 'T12S126R', 'refacerea nu e sudura', []); asteapta(r.code === '22023', 'cod refăcut (R) = 22023 (refacerea nu e o sudură, §22)', r)
  r = await elim('MPA', TA12, 'T13S5', 'alt tronson', []); asteapta(r.code === '22023', 'cod de pe alt tronson = 22023', r)
  r = await elim('MPA', TA12, 'T12S7', 'inlocuitor gresit', ['T12S88?1']); asteapta(r.code === '22023', 'înlocuitor nevalid = 22023', r)
  r = await elim('MPA', TA12, 'T12S7', 'xx', []); asteapta(r.code === '22023', 'motiv prea scurt = 22023', r)
  r = await elim('EXE', TA12, 'T12S7', 'editor executie', []); asteapta(r.code === '42501', 'EXE elimină = 42501', r)
  r = await elim('MPB', TA12, 'T12S7', 'alt MP', []); asteapta(r.code === '42501', 'MPB elimină pe A = 42501', r)
  const retrage = (c, id, m) => ca(db, c, `SELECT public.fn_sud_sudura_eliminare_retrage($1::bigint, $2) AS x`, [id, m], { commit: true })
  r = await retrage('EXE', e1, 'nu am voie'); asteapta(r.code === '42501', 'EXE retrage = 42501', r)
  r = await retrage('MPA', e1, 'marcaj gresit'); asteapta(!r.code, 'MPA retrage marcajul cu motiv', r)
  r = await retrage('MPA', e1, 'a doua oara'); asteapta(r.code === '22023', 'a doua retragere = 22023', r)
  r = await elim('MPA', TA12, 'T12S126', 'cupon, marcat din nou', []); asteapta(!r.code, 'după retragere, sudura se poate marca din nou', r)
  r = await ca(db, 'RSTR', `SELECT count(*)::int AS n FROM public.sud_suduri_eliminate`); asteapta(r.rows?.[0]?.n === 0, 'RSTR (restrâns la B) nu vede marcajele lui A', r)
  r = await ca(db, 'EXE', `SELECT count(*)::int AS n FROM public.sud_suduri_eliminate WHERE activ`); asteapta(r.rows?.[0]?.n === 1, 'EXE vede marcajul activ al lui A', r)

  // (h) deblocarea exportului (D11) + exporturile (R6)
  const debl = (c, k, tip, motiv, lips) => ca(db, c, `SELECT public.fn_sud_export_deblocheaza($1::bigint, $2, $3, $4::jsonb) AS id`, [k, tip, motiv, lips === null ? null : JSON.stringify(lips)], { commit: true })
  const exp = (c, k, tip, foto, d) => ca(db, c, `SELECT public.fn_sud_export_inregistreaza($1::bigint, $2, $3::jsonb, $4::bigint, NULL) AS id`, [k, tip, JSON.stringify(foto), d], { commit: true })
  const LIPS = [{ sudura: 'T12S127', lipsa: 'PM' }]
  for (const [c, k] of [['MPB', KA], ['EXE', KA], ['CTC', KA], ['MPA', KB]]) { r = await debl(c, k, 'izo', 'export cu documente lipsa', LIPS); asteapta(r.code === '42501', `${c} deblochează pachetul ${k} = 42501`, r) }
  r = await debl('MPA', KA, 'izo', 'scurt', LIPS); asteapta(!r.code, 'motivul de 5 caractere trece', r)
  r = await debl('MPA', KA, 'izo', 'abc', LIPS); asteapta(r.code === '22023', 'motiv prea scurt = 22023', r)
  r = await debl('MPA', KA, 'izo', 'export cu documente lipsa', []); asteapta(r.code === '22023', 'lista lipsurilor goală = 22023', r)
  r = await debl('MPA', KA, 'pdf', 'export cu documente lipsa', LIPS); asteapta(r.code === '22023', 'tip necunoscut = 22023', r)
  r = await debl('MPA', 99999, 'izo', 'export cu documente lipsa', LIPS); asteapta(r.code === '22023', 'pachet inexistent = 22023', r)
  const d1 = Number((await debl('MPA', KA, 'izo', 'export cu documente lipsa', LIPS)).rows?.[0]?.id)
  const d2 = Number((await debl('MPA', KA, 'izo', 'pentru alt utilizator', LIPS)).rows?.[0]?.id)
  const d3 = Number((await debl('MPA', KA, 'izo', 'va expira curand', LIPS)).rows?.[0]?.id)
  const d4 = Number((await debl('MPA', KA, 'inventar', 'pentru inventar', LIPS)).rows?.[0]?.id)
  asteapta([d1, d2, d3, d4].every(Number.isInteger), 'MPA creează 4 deblocări', [d1, d2, d3, d4])
  await db.exec(`UPDATE public.sud_export_deblocari SET creat_la = now() - interval '61 minutes' WHERE id = ${d3}`)
  // fotografia CURENTĂ, scrisă de mână din pașii de mai sus: pe tronsonul pachetului A (TA12) singurul buletin confirmat e b1-bis
  // (confirmat aici → v2); id1 și id3 anulate, b2 forțat rămas ciornă, id17 e pe T17; eliminată activă T12S126; metodele A {PA-UT, PM}.
  // Pe B (TB12): niciun buletin, nicio eliminare, metodele {UT}.
  const idB = Number(b1bis.rows?.[0]?.id), idF = Number(b2.rows?.[0]?.id)
  r = await confirma(db, 'MPA', idB, 1, [{ cod_raw: 'T12S127', rezultat: 'acceptat' }]); asteapta(r.rows?.[0]?.n === 1, 'MPA confirmă b1-bis (v2) înaintea exporturilor', r)
  const FOTO_A = { buletine: [{ id: idB, versiune: 2 }], eliminate: ['T12S126'], metode: ['PA-UT', 'PM'], lipsuri_blocante: LIPS, avertismente: [{ sudura: 'T12S50A', ce: 'capat' }] }
  const FOTO_A0 = { ...FOTO_A, lipsuri_blocante: [] }
  const FOTO_B = { buletine: [], eliminate: [], metode: ['UT'], lipsuri_blocante: [] }
  const nrExp = async () => (await q(db, `SELECT count(*)::int AS n FROM public.sud_exporturi`))[0].n
  const folosita = async d => (await q(db, `SELECT folosit_la IS NOT NULL AS f FROM public.sud_export_deblocari WHERE id = $1`, [d]))[0]?.f
  // fotografie veche / străină = 40001, nimic scris, deblocarea NEconsumată
  r = await exp('MPA', KA, 'izo', { ...FOTO_A, metode: ['PM'] }, d1)
  asteapta(r.code === '40001' && /metode/.test(r.message) && await folosita(d1) === false && await nrExp() === 0, 'fotografie veche cu deblocare = 40001, deblocarea rămâne nefolosită', r)
  for (const [de, f] of [
    ['versiunea veche a buletinului', { buletine: [{ id: idB, versiune: 1 }] }],
    ['un buletin ANULAT în plus', { buletine: [{ id: idB, versiune: 2 }, { id: id1, versiune: 3 }] }],
    ['un buletin al altui tronson (T17)', { buletine: [{ id: idB, versiune: 2 }, { id: id17, versiune: 2 }] }],
    ['un buletin CIORNĂ în plus (forțatul)', { buletine: [{ id: idB, versiune: 2 }, { id: idF, versiune: 1 }] }],
    ['un buletin inexistent', { buletine: [{ id: idB, versiune: 2 }, { id: 999999, versiune: 1 }] }],
    ['buletinul confirmat LIPSĂ', { buletine: [] }],
    ['buletinul de două ori', { buletine: [{ id: idB, versiune: 2 }, { id: idB, versiune: 2 }] }],
    ['eliminatele goale', { eliminate: [] }], ['o eliminată în plus', { eliminate: ['T12S126', 'T12S7'] }],
    ['metodele altui proiect', { metode: ['UT'] }], ['metodele goale', { metode: [] }],
  ]) {
    r = await exp('MPA', KA, 'izo', { ...FOTO_A0, ...f }, null)
    asteapta(r.code === '40001' && /sursele s-au schimbat/.test(r.message), `fotografie cu ${de} = 40001 (reîncarcă)`, r)
  }
  r = await exp('EXE', KA, 'izo', FOTO_B, null); asteapta(r.code === '40001', 'fotografia pachetului B la exportul pachetului A = 40001', r)
  for (const [de, f] of [['fotografia care nu e obiect', [1]], ['fotografia goală {}', {}], ['fără lipsuri_blocante', { buletine: [], eliminate: [], metode: [] }],
    ['buletine ca obiect', { ...FOTO_A0, buletine: { id: idB } }], ['id text', { ...FOTO_A0, buletine: [{ id: String(idB), versiune: 2 }] }],
    ['id zecimal', { ...FOTO_A0, buletine: [{ id: idB + 0.5, versiune: 2 }] }], ['fără versiune', { ...FOTO_A0, buletine: [{ id: idB }] }],
    ['eliminată număr', { ...FOTO_A0, eliminate: [126] }], ['avertismente obiect', { ...FOTO_A0, avertismente: {} }]]) {
    r = await exp('MPA', KA, 'izo', f, null); asteapta(r.code === '22023', `${de} = 22023`, r)
  }
  r = await exp('MPA', KA, 'izo', FOTO_A, null); asteapta(r.code === '42501' && /lipsuri blocante/.test(r.message), 'export COMPLET cu lipsuri blocante, fără deblocare = 42501', r)
  r = await exp('MPA', KA, 'izo', { ...FOTO_A, lipsuri_blocante: [{ sudura: 'T12S999', lipsa: 'PM' }] }, d2)
  asteapta(r.code === '42501' && await folosita(d2) === false, 'deblocarea pentru ALTE lipsuri decât cele din fotografie = 42501', r)
  r = await exp('MPA', KA, 'izo', FOTO_A0, d2); asteapta(r.code === '42501', 'deblocare cu fotografia fără lipsuri = 42501 (nu e export incomplet)', r)
  asteapta(await nrExp() === 0, 'după refuzuri: niciun export scris')
  r = await exp('MPA', KA, 'izo', FOTO_A, d1); asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), 'MPA înregistrează exportul INCOMPLET cu deblocarea lui și fotografia curentă', r)
  const ex1 = Number(r.rows?.[0]?.id)
  r = await q(db, `SELECT incomplet, deblocare_id::int AS d, creat_de::text AS de, proiect_id::int AS p, fotografie FROM public.sud_exporturi WHERE id = $1`, [ex1])
  asteapta(r[0]?.incomplet === true && r[0]?.d === d1 && r[0]?.de === U.MPA && r[0]?.p === PA && JSON.stringify(r[0]?.fotografie) === JSON.stringify((await q(db, `SELECT $1::jsonb AS j`, [JSON.stringify(FOTO_A)]))[0].j),
    'exportul incomplet: legat de deblocare, autorul și proiectul = serverul, fotografia păstrată exact', r)
  asteapta(await folosita(d1) === true, 'deblocarea 1 marcată folosită')
  r = await exp('MPA', KA, 'izo', FOTO_A, d1); asteapta(r.code === '42501', 'deblocarea folosită a doua oară = 42501', r)
  r = await exp('OWNER', KA, 'izo', FOTO_A, d2); asteapta(r.code === '42501', 'deblocarea ALTUIA (owner cu deblocarea MP-ului) = 42501', r)
  r = await exp('MPA', KA, 'izo', FOTO_A, d3); asteapta(r.code === '42501', 'deblocarea expirată (> 1 h) = 42501', r)
  r = await exp('MPA', KA, 'izo', FOTO_A, d4); asteapta(r.code === '42501', 'deblocarea pentru alt tip (inventar) = 42501', r)
  r = await exp('MPA', KB, 'inventar', { ...FOTO_B, lipsuri_blocante: LIPS }, d4); asteapta(r.code === '42501', 'deblocarea pe alt pachet = 42501', r)
  r = await exp('MPA', KA, 'izo', FOTO_A, 987654); asteapta(r.code === '42501', 'deblocare inexistentă = 42501', r)
  r = await exp('EXE', KA, 'izo', FOTO_A, d2); asteapta(r.code === '42501', 'EXE (fără scriere) cu o deblocare = 42501', r)
  r = await q(db, `SELECT count(*)::int AS n FROM public.sud_exporturi`); asteapta(r[0]?.n === 1, 'după refuzuri: un singur export', r)
  // exportul complet (fotografia curentă, fără lipsuri): dreptul de export = MP / owner sau scriere pe pachetele proiectului (ca azi)
  const FOTO_K = { [KA]: FOTO_A0, [KB]: FOTO_B }
  for (const [c, k] of [['MPA', KA], ['EXE', KA], ['OWNER', KB], ['RSTRE', KB], ['MPB', KB]]) {
    r = await exp(c, k, 'izo', FOTO_K[k], null); asteapta(Number.isInteger(Number(r.rows?.[0]?.id)), `${c} înregistrează exportul complet pe ${k}`, r)
  }
  for (const [c, k] of [['CTC', KA], ['NOMOD', KA], ['RSTR', KB], ['RSTRE', KA], ['MPB', KA], ['MPC', KB]]) {
    r = await exp(c, k, 'izo', FOTO_K[k], null); asteapta(r.code === '42501', `${c} exportul complet pe ${k} = 42501`, r)
  }
  r = await q(db, `SELECT count(*) FILTER (WHERE NOT incomplet)::int AS c, count(*) FILTER (WHERE incomplet)::int AS i FROM public.sud_exporturi`)
  asteapta(r[0]?.c === 5 && r[0]?.i === 1, 'exporturile: 5 complete + 1 incomplet', r)
  // după o anulare, fotografia de dinainte e veche
  r = await anuleaza(db, 'MPA', idB, 'anulat dupa export'); asteapta(!r.code, 'MPA anulează b1-bis după export', r)
  r = await exp('MPA', KA, 'izo', FOTO_A0, null); asteapta(r.code === '40001', 'fotografia de dinaintea anulării = 40001', r)
  r = await exp('MPA', KA, 'izo', { ...FOTO_A0, buletine: [] }, null); asteapta(!r.code, 'fotografia recitită (fără b1-bis) trece', r)
  const VEX = { OWNER: [7, 5], MPA: [0, 0], MPB: [0, 0], EXE: [7, 5], CTC: [7, 5], NOMOD: [0, 0], RSTR: [3, 0], RSTRE: [3, 0], MPC: [0, 0] }
  for (const [c, [ne, nd]] of Object.entries(VEX)) {
    r = await ca(db, c, `SELECT (SELECT count(*)::int FROM public.sud_exporturi) AS e, (SELECT count(*)::int FROM public.sud_export_deblocari) AS d`)
    asteapta(r.rows?.[0]?.e === ne && r.rows[0].d === nd, `${c} vede [exporturi, deblocări] = [${ne}, ${nd}]`, r)
  }
  return ab
}

// ── o politică PERMISIVĂ LARGĂ pe storage.objects (FOR ALL TO PUBLIC, true) pusă în schelet ÎNAINTEA migrării: izo-ndt rămâne închis
//    (politicile RESTRICTIVE sud_ndt_r_*); celelalte bucket-uri se deschid (dovada că politica largă chiar lucrează). Bază proprie. ──
const LARG = 'CREATE POLICY larg_toate ON storage.objects FOR ALL TO PUBLIC USING (true) WITH CHECK (true);'
// (cuNotice: NOTICE-ul informativ e în blocul $post$, scos la mutanții comportamentali → se verifică doar pe migrarea întreagă)
async function verificaLarg(text, { cuNotice = false } = {}) {
  const ab = []
  const asteapta = (cond, msg, r) => { if (!cond) ab.push('larg: ' + msg + (r === undefined ? '' : ': ' + JSON.stringify(r).slice(0, 200))) }
  const db = await bazaNoua()
  try {
    await db.exec(LARG)
    const a = await livreaza(db, text)
    if (!a.ok) return ['larg: aplicare: ' + a.eroare.slice(0, 160)]
    if (cuNotice) asteapta(a.note.some(n => /^20270114a: politici permisive storage fara bucket fix \(acoperite de sud_ndt_r_\*\): larg_toate$/.test(n)), 'migrarea anunță politica permisivă fără bucket fix', a.note.filter(n => /^20270114a/.test(n)))
    let r = await urca(db, 'MPA', `${PA}/${TA12}/l1.pdf`); asteapta(!r.code, 'MPA urcă l1', r)
    r = await incarca(db, 'MPA', { tronson: TA12, numar: 'L1', cale: `${PA}/${TA12}/l1.pdf`, amprenta: sha('l1') }); asteapta(!r.code, 'MPA înregistrează l1', r)
    r = await urca(db, 'OWNER', `${PA}/${TA12}/lo.pdf`); asteapta(!r.code, 'OWNER urcă orfanul lo', r)
    const vede = (c, rol) => ca(db, c, `SELECT count(*) FILTER (WHERE bucket_id = 'izo-ndt')::int AS n, count(*) FILTER (WHERE bucket_id <> 'izo-ndt')::int AS alt FROM storage.objects`, [], { rol })
    for (const [c, rol, n] of [[null, 'anon', 0], ['NOMOD', undefined, 0], ['MPA', undefined, 0], ['MPB', undefined, 0], ['EXE', undefined, 2], ['OWNER', undefined, 2]]) {
      r = await vede(c, rol); asteapta(r.rows?.[0]?.n === n && r.rows[0].alt === 1, `${c || 'anon'} vede ${n} obiecte izo-ndt (și obiectul celuilalt bucket, prin politica largă)`, r)
    }
    for (const [c, rol, cale] of [[null, 'anon', `${PA}/${TA12}/an.pdf`], ['NOMOD', undefined, `${PA}/${TA12}/nm.pdf`], ['EXE', undefined, `${PA}/${TA12}/ex.pdf`],
      ['MPA', undefined, `${PB}/${TB12}/alt.pdf`], ['MPA', undefined, `${PA}/${TB12}/alt.pdf`]]) {
      r = await urca(db, c, cale, { rol }); asteapta(r.code === '42501', `${c || 'anon'} încarcă ${cale} = refuz (restrictive)`, r)
    }
    r = await urca(db, 'MPA', `${PA}/${TA12}/fals.pdf`, { ownerId: U.OWNER }); asteapta(r.code === '42501', 'MPA încarcă cu owner_id-ul altuia = refuz', r)
    for (const [c, rol] of [[null, 'anon'], ['NOMOD', undefined], ['MPA', undefined], ['OWNER', undefined]]) {
      r = await ca(db, c, `UPDATE storage.objects SET name = name || '.x' WHERE bucket_id = 'izo-ndt'`, [], { rol, commit: true })
      asteapta(!r.code && r.afectate === 0, `${c || 'anon'}: UPDATE pe izo-ndt = 0 rânduri`, r)
      r = await ca(db, c, `UPDATE storage.objects SET bucket_id = 'izo-ndt', name = '${PA}/${TA12}/mutat.pdf' WHERE bucket_id = 'executie-pachete-pdf'`, [], { rol, commit: true })
      asteapta(r.code === '42501', `${c || 'anon'}: mutarea unui obiect din alt bucket în izo-ndt = refuz`, r)
    }
    for (const [c, rol, unde, de] of [[null, 'anon', `bucket_id = 'izo-ndt'`, 'anon tot bucket-ul'], ['NOMOD', undefined, `bucket_id = 'izo-ndt'`, 'fără drept tot bucket-ul'],
      ['MPA', undefined, `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/l1.pdf'`, 'MPA propriul fișier înregistrat'],
      ['OWNER', undefined, `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/l1.pdf'`, 'OWNER fișierul înregistrat al altuia']]) {
      r = await sterge(db, c, unde, { rol }); asteapta(!r.code && r.afectate === 0, `ștergere (${de}) = 0 rânduri`, r)
    }
    await q(db, `UPDATE storage.objects SET created_at = now() - interval '3 hours' WHERE bucket_id = 'izo-ndt'`)
    r = await sterge(db, 'OWNER', `bucket_id = 'izo-ndt' AND name = '${PA}/${TA12}/lo.pdf'`); asteapta(!r.code && r.afectate === 1, 'OWNER își șterge orfanul (după 2 h) = 1 rând', r)
    r = await q(db, `SELECT string_agg(name, ',' ORDER BY name) AS n FROM storage.objects WHERE bucket_id = 'izo-ndt'`)
    asteapta(r[0]?.n === `${PA}/${TA12}/l1.pdf`, 'la final în izo-ndt: doar l1 (înregistrat), neatins', r)
  } catch (e) { ab.push('larg: excepție: ' + String(e.message).slice(0, 200)) } finally { await db.close() }
  return ab
}

// ── paritatea normalizatorului (SQL vs src/lib/izoSudura.js, mod legacy) ──
const EXTRA = [
  ['GAZPET TR12 S126R', 12], ['GAZPET TR12 S127', 12], ['T17S50A', 17], ['T17S50H', 17], ['T12S88?1', 12], ['GAZPET TR13 S5', 12], ['S127', 12], ['127', 12],
  ['  t 12 - s - 7 b ', 12], ['GAZPET INSTAL TR12 S5/AR', 12], ['T12S5/R', 12], ['T1000S1', null], ['T12S123456', null], ['T12S5ABC', 12], [null, 12],
  ['TR12S0045', null], ['tr12s45r', null], ['S45', null], ['GAZPET', 12], ['T12S5 A1', 12], ['T12S5/A1R', 12], ['T12-S-5', 12], ['T12S5R', 13],
]
async function paritate(db) {
  const ab = []
  const sql = async (raw, t) => (await db.query(`SELECT public.fn_sud_cod_normalizeaza($1, $2::int) AS n`, [raw, t])).rows[0].n
  const cazuri = [
    ...CAZURI.map(c => ({ raw: c.in, t: tronsonNr(c.opt?.tronson), asteptat: c.opt?.mod === 'legacy' ? c.asteptat : null, sursa: 'cazuri.json' })),
    ...EXTRA.map(([raw, t]) => ({ raw, t, asteptat: null, sursa: 'extra' })),
  ]
  let n = 0, nAst = 0, nAlt = 0
  for (const c of cazuri) {
    const js = normalizeazaSudura(c.raw, { mod: 'legacy', tronson: c.t ?? undefined })
    const s = await sql(c.raw, c.t)
    let astSql
    if (js.stare === 'ok' && !js.altTronson) {
      astSql = { stare: 'ok', motiv: null, tronson: js.tronson, nr: js.nr, sufix: js.sufix, refacuta: js.refacuta, cheie: `T${js.tronson}S${js.nr}${js.sufix}` }
      // diferența de formă 1 (explicită): JS dă canon „TR…”, serverul cheia ERP „T…” (D1); aceeași identitate
      if (js.canon !== `TR${js.tronson}S${js.nr}${js.sufix}` || 'T' + js.canon.slice(2) !== astSql.cheie) ab.push(`canon/cheie ${c.raw}: ${js.canon} vs ${astSql.cheie}`)
    } else if (js.stare === 'ok' && js.altTronson) {
      // diferența de formă 2 (explicită): JS = ok + altTronson; serverul = nepotrivit / alt_tronson cu identitatea citită (§5: rămâne „nepotrivit”)
      astSql = { stare: 'nepotrivit', motiv: 'alt_tronson', tronson: js.tronson, nr: js.nr, sufix: js.sufix, refacuta: js.refacuta }
      nAlt++
    } else {
      // diferența de formă 3 (explicită): JS „cod_ilizibil” = server „nepotrivit”, același motiv
      astSql = { stare: 'nepotrivit', motiv: js.motiv }
    }
    const egal = JSON.stringify(Object.keys(astSql).sort().map(k => [k, astSql[k]])) === JSON.stringify(Object.keys(s).sort().map(k => [k, s[k]]))
    if (!egal) ab.push(`${JSON.stringify(c.raw)} (tronson ${c.t}): JS ${JSON.stringify(astSql)} / SQL ${JSON.stringify(s)}`)
    // așteptatul INDEPENDENT din cazuri.json (mod legacy): câmpurile declarate acolo, pe forma serverului
    if (c.asteptat) {
      nAst++
      const a = c.asteptat
      const st = a.stare === 'ok' && !a.altTronson ? 'ok' : 'nepotrivit'
      const rau = []
      if (s.stare !== st) rau.push('stare')
      if (a.motiv !== undefined && st !== 'ok' && s.motiv !== a.motiv) rau.push('motiv')
      if (a.altTronson && s.motiv !== 'alt_tronson') rau.push('altTronson')
      for (const k of ['tronson', 'nr', 'sufix', 'refacuta']) if (a[k] !== undefined && s[k] !== a[k]) rau.push(k)
      if (a.lot1 !== undefined && s.cheie !== a.lot1) rau.push('lot1/cheie')
      if (a.canon !== undefined && st === 'ok' && s.cheie !== 'T' + a.canon.slice(2)) rau.push('canon/cheie')
      if (rau.length) ab.push(`așteptat cazuri.json ${JSON.stringify(c.raw)}: ${rau.join(',')} (SQL ${JSON.stringify(s)})`)
    }
    n++
  }
  return { ab, n, nAst, nAlt }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const faraComentarii = t => t.replace(/--[^\n]*/g, '')
console.log('0. validatorul runnerului, forma fișierelor, paritatea scheletului, amprentele din migrare')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(PLAFON_LIVRARE === 5000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE}: ${vm.out}`)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.split('\n')[0].slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
  for (const f of [F_MIG, F_REV, F_DRY, F_SCHELET, F_OBIECTE, 'scripts/pglite/test_izometrie_buletine_ndt_local.mjs']) {
    const brut = readFileSync(join(ROOT, f), 'utf8')
    ok(brut.charCodeAt(0) !== 0xFEFF && !/\r/.test(brut), `${f}: fără BOM, LF`)
  }
  ok(/^-- Version 20270114120000\. NEAPLICAT\./.test(MIG), 'versiunea migrării: 20270114120000')
  // paritatea textuală: blocul 20261209a = scheletul 20270105a; fn_executie_pachete_acces = corpul din 20261029a; md5-urile din migrare = textele
  const bloc = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b) + b.length)
  const S0105 = citeste('supabase/tests/20270105a_executie_rest_decontat_schelet.sql')
  ok(bloc(SCHELET, '-- PARITATE_20261209A_INCEPUT', '-- PARITATE_20261209A_SFARSIT') === bloc(S0105, '-- PARITATE_20261209A_INCEPUT', '-- PARITATE_20261209A_SFARSIT'),
    'blocul 20261209a din schelet = scheletul 20270105a (verbatim)')
  const porti = t => t.slice(t.indexOf('CREATE FUNCTION public.fn_izo_porti_definitii()'), t.indexOf('END $f$;', t.indexOf('CREATE FUNCTION public.fn_izo_porti_lipsa()')) + 8)
  ok(porti(SCHELET).length > 500 && porti(SCHELET) === porti(S0105), 'stub-urile porților Izometrie din schelet = scheletul 20270105a (verbatim)')
  // regula porților (docs/izometrie/PORTI_REGULA.md, CI izometrie-porti-regula): migrarea și revenirea trec detectorul
  let det
  try { det = { cod: 0, out: execFileSync('node', [join(ROOT, 'scripts/izometrie/porti_regula.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { det = { cod: e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
  const linieDet = f => (det.out.split('\n').find(l => l.includes(f)) || 'LIPSA').trim()
  ok(det.cod === 0 && /^OK /.test(linieDet(`migrations/${NUME}.sql`)) && /^OK /.test(linieDet(`revenire/${NUME_REV}.sql`)),
    `detectorul porților: cod ${det.cod}; ${linieDet(`migrations/${NUME}.sql`).slice(0, 110)}; ${linieDet(`revenire/${NUME_REV}.sql`).slice(0, 110)}`)
  const M1029 = citeste('supabase/migrations/20261029a_executie_pachete_rls_strans.sql')
  const fn1029 = M1029.slice(M1029.indexOf('CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces'), M1029.indexOf('$$;') + 3)
  ok(bloc(SCHELET, 'CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces', '$$;') === fn1029, 'fn_executie_pachete_acces din schelet = textul 20261029a (verbatim)')
  const corp = (t, cap, delim) => { const i = t.indexOf(cap); const a = t.indexOf(`AS ${delim}`, i) + 3 + delim.length; return t.slice(a, t.indexOf(delim, a)) }
  const amp = {
    'fn_executie_proiect_permis': md5(corp(SCHELET, 'CREATE FUNCTION public.fn_executie_proiect_permis(', '$f$')),
    'fn_executie_acces_nerestrans()': md5(corp(SCHELET, 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', '$f$')),
    'fn_executie_acces_nerestrans_cont': md5(corp(SCHELET, 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', '$f$')),
    'fn_executie_acces_lista(': md5(corp(SCHELET, 'CREATE FUNCTION public.fn_executie_acces_lista(', '$f$')),
    'fn_executie_acces_lista_cont': md5(corp(SCHELET, 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', '$f$')),
    'fn_executie_pachete_acces': md5(corp(fn1029, 'CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces', '$$')),
  }
  const MIGc = faraComentarii(MIG)
  ok(amp.fn_executie_proiect_permis === 'bd4320f76e9f36f492c7186c0a982155' && Object.values(amp).every(h => MIGc.split(h).length === 2),
    'amprentele lanțului de drept (6 funcții) calculate din texte apar EXACT o dată în migrare: ' + Object.entries(amp).map(([k, v]) => k + '=' + v.slice(0, 8)).join(' '))
  // corpul citit de chat pe producție (27.11.2026, o linie) = corpul 20261029a cu spațiile strânse
  const PROD = "SELECT auth.uid() IS NOT NULL AND ( EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true) OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = ANY (CASE WHEN p_scriere THEN ARRAY['executie'] ELSE ARRAY['executie', 'ctc'] END)) )"
  ok(corp(fn1029, 'CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces', '$$').replace(/\s+/g, ' ').trim() === PROD, 'corpul fn_executie_pachete_acces citit pe producție (o linie) = 20261029a cu spațiile strânse')
  // L14 în revenire, ordinea (L06): lock-ul tabelelor → politicile de încărcare scoase (ACCESS EXCLUSIVE pe storage.objects) → rândul
  // bucket-ului ÎNAINTEA numărării datelor, după verificarea obiectelor; toate în blocul $pre$
  const REVc = faraComentarii(REV)
  const iL = REVc.indexOf('LOCK TABLE public.sud_metode_proiect'), iB = REVc.indexOf("PERFORM 1 FROM storage.buckets WHERE id = 'izo-ndt' FOR UPDATE NOWAIT;"), iN = REVc.indexOf('SELECT (SELECT count(*) FROM public.sud_metode_proiect)')
  const iDi = REVc.indexOf('DROP POLICY sud_ndt_incarcare ON storage.objects;'), iDr = REVc.indexOf('DROP POLICY sud_ndt_r_ins ON storage.objects;'), iPre = REVc.indexOf('END $pre$;')
  ok(iL > REVc.indexOf('starea nu e cea pusa de migrare') && iL < iDi && iL < iDr && iDi < iB && iDr < iB && iB < iN && iN < iPre
    && REVc.split('DROP POLICY sud_ndt_incarcare ').length === 2 && REVc.split('DROP POLICY sud_ndt_r_ins ').length === 2 && /IN ACCESS EXCLUSIVE MODE NOWAIT;/.test(REVc.slice(iL, iDi)),
    'revenirea: LOCK pe cele 6 tabele (NOWAIT) → politicile de încărcare scoase → rândul bucket-ului FOR UPDATE NOWAIT, toate înaintea verificării „fără date” (L14)')
  const iA = REVc.indexOf("PERFORM set_config('storage.allow_delete_query', 'true', true);"), iDel = REVc.indexOf("DELETE FROM storage.buckets WHERE id = 'izo-ndt'"),
    iZ = REVc.indexOf("PERFORM set_config('storage.allow_delete_query', 'false', true);")
  ok(iA > iPre && iA < iDel && iDel < iZ && REVc.split('allow_delete_query').length === 3, 'revenirea: garda protect_delete deschisă doar în jurul ștergerii bucket-ului (după $pre$), apoi închisă')
  const lockTab = REVc.slice(iL, REVc.indexOf(';', iL))
  ok(['sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi'].every(t => lockTab.includes('public.' + t)), 'LOCK-ul cuprinde toate cele 6 tabele')
}

console.log('1. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['marcajul altei migrări', { nume: '20270113a_ofertare_clarificari_citire' }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['porțile Izometrie roșii', {}, /portile Izometrie nu sunt verzi inainte: \{e4b\}/, `CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`],
  ['porțile Izometrie lipsă', {}, /fn_izo_porti_lipsa\) lipsesc/, 'DROP FUNCTION public.fn_izo_porti_lipsa()'],
  ['executie_tronsoane.cod varchar', {}, /coloanele citite nu au tipurile asteptate/, 'ALTER TABLE public.executie_tronsoane ALTER COLUMN cod TYPE varchar(40)'],
  ['executie_proiecte.mp_employee_id bigint', {}, /coloanele citite nu au tipurile asteptate/, 'ALTER TABLE public.executie_proiecte DROP CONSTRAINT executie_proiecte_mp_employee_id_fkey; ALTER TABLE public.executie_proiecte ALTER COLUMN mp_employee_id TYPE bigint'],
  ['profiles.employee_id lipsă', {}, /coloanele citite nu au tipurile asteptate/, 'ALTER TABLE public.profiles DROP COLUMN employee_id'],
  ['executie_pachete_lansare lipsă', {}, /dependente lipsa/, 'DROP TABLE public.executie_pachete_lansare'],
  ['fn_executie_proiect_permis cu alt corp', {}, /lantul de drept .* nu e cel revizuit/, `CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`],
  ['fn_executie_acces_lista_cont (callee) cu alt corp', {}, /lantul de drept .* nu e cel revizuit/, `CREATE OR REPLACE FUNCTION public.fn_executie_acces_lista_cont(p_profile uuid, p_scriere boolean) RETURNS bigint[] LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT ARRAY[${PA}::bigint] $f$`],
  ['fn_executie_pachete_acces cu alt corp (scriere pentru ctc)', {}, /lantul de drept .* nu e cel revizuit/, `CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$`],
  ['fn_executie_pachete_acces SECURITY INVOKER', {}, /lantul de drept .* nu e cel revizuit/, 'ALTER FUNCTION public.fn_executie_pachete_acces(boolean) SECURITY INVOKER'],
  ['fn_executie_proiect_permis cu EXECUTE pentru anon', {}, /lantul de drept .* nu e cel revizuit/, 'GRANT EXECUTE ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) TO anon'],
  ['fn_executie_acces_nerestrans fără EXECUTE pentru authenticated', {}, /lantul de drept .* nu e cel revizuit/, 'REVOKE EXECUTE ON FUNCTION public.fn_executie_acces_nerestrans() FROM authenticated'],
  ['fn_executie_acces_nerestrans_cont devenită DEFINER', {}, /lantul de drept .* nu e cel revizuit/, 'ALTER FUNCTION public.fn_executie_acces_nerestrans_cont(uuid) SECURITY DEFINER'],
  ['fn_executie_proiect_permis fără search_path', {}, /lantul de drept .* nu e cel revizuit/, 'ALTER FUNCTION public.fn_executie_proiect_permis(bigint, boolean) RESET search_path'],
  ['bucket izo-ndt existent', {}, /exista deja \(reaplicare\)/, `INSERT INTO storage.buckets (id, name) VALUES ('izo-ndt', 'izo-ndt')`],
  ['o funcție fn_sud_ existentă', {}, /exista deja \(reaplicare\)/, `CREATE FUNCTION public.fn_sud_x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$`],
  ['o politică sud_ndt_ existentă', {}, /exista deja \(reaplicare\)/, `CREATE POLICY sud_ndt_vechi ON storage.objects FOR SELECT TO authenticated USING (false)`],
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
  const b = await bazaNoua()
  const a = await livreaza(b, MIG)
  ok(a.ok, 'aplicare pentru reaplicare' + (a.ok ? '' : ': ' + a.eroare))
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /exista deja \(reaplicare\)/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'reaplicarea = refuz, nimic schimbat: ' + (r.eroare || '').slice(0, 100))
  await b.close()
}

console.log('2. livrarea L15 v2 completă: manifestul = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
async function dryRun(db, eticheta) {
  const s0 = await stare(db)
  const note = []; let eroare = null
  // fixturile cu constrângerile producției (employees.department, profiles.role, app_modules) DOAR în tranzacția dry-run-ului, ca pe clonă
  const text = DRY.replace('\nBEGIN;\n', '\nBEGIN;\n' + FIXTURI + '\n')
  if (text === DRY) throw new Error('dry-run: BEGIN negăsit')
  try { await db.exec(text, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e.message; try { await db.exec('ROLLBACK') } catch { /* închisă */ } }
  const blocuri = note.filter(n => /^DRY 20270114a \S+ ok/.test(n))
  ok(!eroare && note.some(n => n === 'DRY 20270114a TOTUL OK') && blocuri.length >= 10, `${eticheta}dry-run: ${blocuri.length} blocuri ok + TOTUL OK` + (eroare ? ': ' + eroare.slice(0, 300) : ''))
  ok(JSON.stringify(await stare(db)) === JSON.stringify(s0), `${eticheta}dry-run: ROLLBACK, nimic rămas (obiecte, drepturi, politici, bucket-uri, fișiere, rânduri sud_)`)
  return note
}
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
    `# 20270114a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}`)
  // L25: ce TREBUIE să apară, scris aici independent de generator: tabelele, funcțiile, politicile noi; nimic „schimbat” / „sters” în afara storage.objects
  const etichete = revizuit.map(l => l.split('\t'))
  const creat = etichete.filter(x => x[2] === 'creat').map(x => x[1]).join('\n')
  ok(['sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi'].every(t => creat.includes(t))
    && ['fn_sud_drept', 'fn_sud_cod_normalizeaza', 'fn_sud_tronson_nr', 'fn_sud_metode_seteaza', 'fn_sud_buletin_incarca', 'fn_sud_buletin_confirma', 'fn_sud_buletin_anuleaza',
      'fn_sud_sudura_elimina', 'fn_sud_sudura_eliminare_retrage', 'fn_sud_export_deblocheaza', 'fn_sud_export_inregistreaza'].every(f => creat.includes(f))
    && POLITICI.every(p => creat.includes(p)),
  `lista revizuită conține cele 6 tabele, cele 11 funcții și cele ${POLITICI.length} politici storage ca „creat”`)
  const altfel = etichete.filter(x => x[2] !== 'creat')
  ok(altfel.every(x => /storage\.objects/.test(x[1])) && !etichete.some(x => /executie_|profiles|fn_executie|fn_izo|user_module_access/.test(x[1])),
    `nimic schimbat / șters în afara obiectelor noi (doar storage.objects, prin politicile noi): ${altfel.map(x => x.join(' ')).join(' | ') || 'nimic'}`)
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  const linii = manifest.split('\n'), iPol = linii.findIndex(l => /sud_ndt_incarcare/.test(l))
  writeFileSync(fIncomplet, linii.filter((_, i) => i !== iPol).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(iPol >= 0 && !gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul politicii de încărcare = refuz AMPRENTA_GLOBALA_DUPA, nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.ok && j.note.some(m => new RegExp(`^AMPRENTA_GLOBALA dupa: ${total} diferente = manifestul`).test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m)),
  `livrarea aprobată: diferențele (${total}) = manifestul; PLAFON_TIMP (5000)` + (j.ok ? '' : ': ' + j.eroare))
  const so = await sudOk(b)
  ok(JSON.stringify(so) === '{"t":6,"f":11,"b":1,"p":8}', 'după livrarea aprobată: 6 tabele, 11 funcții, bucket-ul, 8 politici: ' + JSON.stringify(so))
  await dryRun(b, '')
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY.replace('\nBEGIN;\n', '\nBEGIN;\n' + FIXTURI + '\n')) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_migrare FAIL/.test(ef || ''), 'dry-run pe baza fără 20270114a = eșec (t_migrare): ' + (ef || 'TRECE').slice(0, 100))
  await fara.close(); await b.close()
}

console.log('3. comportamentul, ca authenticated cu JWT-ul fiecărui cont sintetic')
{
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^20270114a: sfarsit la \d+ ms de la BEGIN$/.test(n)), 'migrarea se aplică' + (a.ok ? '' : ': ' + a.eroare))
  const ab = await verifica(db)
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri${ab.length ? ':\n      ' + ab.join('\n      ') : ''})`)
  await db.close()
  const al = await verificaLarg(MIG, { cuNotice: true })
  ok(al.length === 0, `o politică permisivă largă (FOR ALL TO PUBLIC) în schelet nu deschide izo-ndt (${al.length} abateri${al.length ? ':\n      ' + al.join('\n      ') : ''})`)
}

console.log('4. paritatea normalizatorului (SQL fn_sud_cod_normalizeaza vs src/lib/izoSudura.js, mod legacy) + fn_sud_tronson_nr')
{
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const p = await paritate(db)
  ok(p.ab.length === 0 && p.n === CAZURI.length + EXTRA.length && p.nAst >= 15 && p.nAlt >= 2,
    `${p.n} cazuri (${CAZURI.length} din cazuri.json + ${EXTRA.length} extra), ${p.nAst} cu așteptatul independent, ${p.nAlt} alt_tronson; ${p.ab.length} diferențe` + (p.ab.length ? ':\n      ' + p.ab.join('\n      ') : ''))
  const TR = [['TR12', 12], ['T13', 13], ['TR 1 FOD', 1], ['tr1 FOD', 1], ['  T 7', 7], ['T12A', null], ['TRONSON 5', null], ['', null], [null, null], ['T1234', null], ['TR-3', null]]
  const rt = []
  for (const [c, e] of TR) { const v = (await q(db, `SELECT public.fn_sud_tronson_nr($1) AS n`, [c]))[0].n; if (v !== e) rt.push(`${JSON.stringify(c)}: ${v} (aștepta ${e})`) }
  ok(rt.length === 0, `fn_sud_tronson_nr pe ${TR.length} coduri de tronson (TR12 / T13 / TR 1 FOD / tr1 FOD; T12A / TRONSON 5 / gol = NULL)` + (rt.length ? ': ' + rt.join(' | ') : ''))
  await db.close()
}

console.log('5. revenirea: aplicare → revenire → reaplicare; refuzurile revenirii (nimic schimbat)')
{
  const db = await bazaNoua()
  const s0 = await stare(db)
  ok((await livreaza(db, MIG)).ok, 'aplicare pentru revenire')
  const s1 = await stare(db)
  for (const [n, o] of [['cu plafonul 5000', { plafon: 5000 }], ['cu marcajul migrării', { nume: NUME }], ['fără marcaj', { marcaj: false }], ['fără plafon', { plafon: null, marcajPlafon: null }]]) {
    const v = await revino(db, REV, o)
    ok(!v.ok && JSON.stringify(await stare(db)) === JSON.stringify(s1), `revenirea ${n} = refuz, nimic schimbat (${(v.eroare || 'APLICAT').slice(0, 90)})`)
  }
  const v = await revino(db)
  ok(v.ok && JSON.stringify(await stare(db)) === JSON.stringify(s0), 'revenirea: starea EXACTĂ dinaintea migrării (obiecte, drepturi, politici, bucket-uri)' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea pusa de migrare/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 100))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările de comportament' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
{
  // garda protect_delete (ca pe producție): revenirea fără deschiderea ei = refuz la ștergerea bucket-ului, nimic schimbat
  const db = await bazaNoua()
  await livreaza(db, MIG)
  const s = await stare(db)
  const fara = aplica(REV, [["  PERFORM set_config('storage.allow_delete_query', 'true', true);\n", '']])
  const v = await revino(db, fara)
  ok(!v.ok && /Direct deletion from storage tables is not allowed/.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s),
    'revenirea fără storage.allow_delete_query = refuz (protect_buckets_delete), nimic schimbat: ' + (v.eroare || 'APLICAT').slice(0, 90))
  const v2 = await revino(db)
  ok(v2.ok, 'revenirea originală pe aceeași bază trece' + (v2.ok ? '' : ': ' + v2.eroare))
  await db.close()
}
for (const [nume, pregatire, re] of [
  ['un rând în sud_metode_proiect', async db => ca(db, 'MPA', `SELECT public.fn_sud_metode_seteaza(${PA}, ARRAY['PM'])`, [], { commit: true }), /exista 1 randuri \/ fisiere in arhiva NDT/],
  ['un obiect în bucket', async db => urca(db, 'MPA', `${PA}/${TA12}/r.pdf`), /exista 1 randuri \/ fisiere in arhiva NDT/],
  ['un buletin anulat (istoric)', async db => { await urca(db, 'MPA', `${PA}/${TA12}/r.pdf`); const r = await incarca(db, 'MPA', { tronson: TA12, numar: 'R1', cale: `${PA}/${TA12}/r.pdf`, amprenta: sha('r') }); await anuleaza(db, 'MPA', Number(r.rows[0].id), 'anulat inainte de revenire') }, /exista 2 randuri \/ fisiere/],
  ['o funcție a migrării lipsă', async db => db.exec('DROP FUNCTION public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)'), /starea nu e cea pusa de migrare/],
  ['un tabel sud_ în plus', async db => db.exec('CREATE TABLE public.sud_zz (id int)'), /starea nu e cea pusa de migrare/],
  ['o funcție fn_sud_ în plus', async db => db.exec('CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$'), /starea nu e cea pusa de migrare/],
  ['politica de încărcare lipsă', async db => db.exec('DROP POLICY sud_ndt_incarcare ON storage.objects'), /starea nu e cea pusa de migrare/],
  ['bucket-ul lipsă', async db => db.exec(`BEGIN; SELECT set_config('storage.allow_delete_query', 'true', true); DELETE FROM storage.buckets WHERE id = 'izo-ndt'; COMMIT;`), /starea nu e cea pusa de migrare/],
  ['o politică restrictivă lipsă', async db => db.exec('DROP POLICY sud_ndt_r_anon ON storage.objects'), /starea nu e cea pusa de migrare/],
  ['o politică sud_ndt_ în plus', async db => db.exec('CREATE POLICY sud_ndt_zz ON storage.objects FOR SELECT TO authenticated USING (false)'), /starea nu e cea pusa de migrare/],
  ['un buletin înregistrat după golirea storage-ului', async db => {
    await urca(db, 'MPA', `${PA}/${TA12}/r.pdf`); await incarca(db, 'MPA', { tronson: TA12, numar: 'R2', cale: `${PA}/${TA12}/r.pdf`, amprenta: sha('r2') })
    await db.exec(`BEGIN; SELECT set_config('storage.allow_delete_query', 'true', true); DELETE FROM storage.objects WHERE bucket_id = 'izo-ndt'; COMMIT;`) }, /exista 1 randuri \/ fisiere/],
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
    const ab = await verifica(db)
    const p = await paritate(db)
    return [...ab, ...p.ab.map(x => 'paritate: ' + x), ...await verificaLarg(text)]
  } finally { await db.close() }
}
{
  const ab = await comport(FARA_POST(MIG))
  ok(ab.length === 0, `martor: originalul fără postcondiții trece toate verificările (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
}
const MUTANTI = [
  ['M1 dreptul fără restricția pe proiect (fn_executie_proiect_permis scos din ramura MP)',
    [['                       AND p.employee_id::bigint = e.mp_employee_id::bigint)\n        AND public.fn_executie_proiect_permis(p_proiect, true))', '                       AND p.employee_id::bigint = e.mp_employee_id::bigint))']]],
  ['M2 dreptul dă scriere oricui are \'executie\' (ramura de export extinsă la scriere)',
    [["    OR (p_nivel = 'export' AND public.fn_executie_pachete_acces(true)", "    OR (p_nivel IN ('export', 'scriere') AND public.fn_executie_pachete_acces(true)"]]],
  ['M3 confirmarea fără CAS pe versiune',
    [["  IF p_versiune IS DISTINCT FROM b.versiune THEN RAISE EXCEPTION 'sud: buletinul s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;\n", '']]],
  ['M4 încărcarea fără verificarea owner-ului obiectului', [[' AND o.name = p_fisier_path AND o.owner_id = auth.uid()::text\n', ' AND o.name = p_fisier_path\n']]],
  ['M5 indexul unic pe cheie fără stare <> \'anulat\'',
    [["CREATE UNIQUE INDEX sud_buletine_cheie_uq ON public.sud_buletine (tronson_id, metoda, numar_cheie, data_buletin)\n  WHERE stare <> 'anulat' AND fortat_motiv IS NULL;",
      "CREATE UNIQUE INDEX sud_buletine_cheie_uq ON public.sud_buletine (tronson_id, metoda, numar_cheie, data_buletin)\n  WHERE fortat_motiv IS NULL;"]]],
  ['M6 politicile storage de încărcare (permisivă + restrictivă) fără verificarea tronson ∈ proiect',
    [["              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint\n                            AND t.proiect_id = split_part(name, '/', 1)::bigint)\n", ''],
     ["\n              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint\n                            AND t.proiect_id = split_part(name, '/', 1)::bigint)));", '));']]],
  ['M7 normalizatorul cu R păstrat în cheie',
    [["'cheie', 'T' || v_t || 'S' || v_nr || v_suf);", "'cheie', 'T' || v_t || 'S' || v_nr || v_suf || CASE WHEN v_ref THEN 'R' ELSE '' END);"]]],
  // în plus față de lista brief-ului: celelalte gărzi de drept / identitate
  ['M8 citirea fără restricția pe proiect (editorul restrâns vede tot)',
    [["    OR (p_nivel = 'citire' AND public.fn_executie_pachete_acces(false) AND public.fn_executie_proiect_permis(p_proiect, false))", "    OR (p_nivel = 'citire' AND public.fn_executie_pachete_acces(false))"]]],
  ['M9 deblocarea altuia acceptată (fără d.creat_de = auth.uid())', [[' OR d.creat_de <> auth.uid() OR d.folosit_la IS NOT NULL', ' OR d.folosit_la IS NOT NULL']]],
  ['M10 deblocarea fără expirare', [[" OR d.folosit_la IS NOT NULL\n       OR d.creat_la < now() - interval '1 hour' OR d.lipsuri", ' OR d.folosit_la IS NOT NULL\n       OR d.lipsuri']]],
  ['M11 deblocarea refolosibilă (fără folosit_la)', [[' OR d.folosit_la IS NOT NULL\n', '\n']]],
  ['M12 încărcarea fără verificarea căii (orice obiect al utilizatorului)', [["  IF p_fisier_path IS NULL OR p_fisier_path !~ ('^' || v_proiect || '/' || p_tronson || '/[^/]+$')\n     OR NOT EXISTS", '  IF p_fisier_path IS NULL\n     OR NOT EXISTS']]],
  ['M13 sudura eliminată acceptă codul refăcut', [["IF v_n->>'stare' <> 'ok' OR (v_n->>'refacuta')::boolean THEN", "IF v_n->>'stare' <> 'ok' THEN"]]],
  ['M14 normalizatorul fără verificarea tronsonului (alt_tronson devine ok)', [['  IF p_tronson IS NOT NULL AND v_t <> p_tronson THEN', '  IF false THEN']]],
  ['M15 rândurile citibile de oricine (politica fără legătura la buletin)', [['  USING (EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.id = buletin_id));', '  USING (auth.uid() IS NOT NULL);']]],
  ['M16 GRANT UPDATE direct pe sud_buletine', [['-- secvențele de identitate', 'GRANT UPDATE ON public.sud_buletine TO authenticated;\n-- secvențele de identitate']]],
  ['M17 verificarea cheii nu exclude buletinele forțate (regula indexului, §22)', [["AND data_buletin = p_data AND stare <> 'anulat' AND fortat_motiv IS NULL LIMIT 1;", "AND data_buletin = p_data AND stare <> 'anulat' LIMIT 1;"]]],
  ['M18 tăiere tăcută a codului', [[" OR length(r->>'cod_raw') > 80\n", '\n'], ["VALUES (b.id, v_i, r->>'cod_raw', v_n->>'stare'", "VALUES (b.id, v_i, left(r->>'cod_raw', 80), v_n->>'stare'"]]],
  // runda 3 (integrarea reparațiilor chat-ului + brief-ul r3)
  ['M19 exportul fără verificarea fotografiei (sursele nu se compară)',
    [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sursele s-au schimbat intre verificare si export (%); reincarca fereastra', v_rau USING ERRCODE = '40001'; END IF;\n", '']]],
  ['M20 citirea acordată MP-ului fără acces la pachete', [["    OR (p_nivel IN ('scriere', 'export')\n", "    OR (p_nivel IN ('scriere', 'export', 'citire')\n"]]],
  ['M21 politica RESTRICTIVĂ de citire scoasă (sud_ndt_r_sel)',
    [["CREATE POLICY sud_ndt_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated\n  USING (bucket_id IS DISTINCT FROM 'izo-ndt' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'\n         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')));\n", '']]],
  ['M22 politica RESTRICTIVĂ de încărcare scoasă (sud_ndt_r_ins)', [['CREATE POLICY sud_ndt_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated', 'CREATE POLICY sud_ndt_r_ins ON storage.objects FOR INSERT TO authenticated']]],
  ['M23 politica RESTRICTIVĂ de UPDATE scoasă (sud_ndt_r_upd)',
    [["CREATE POLICY sud_ndt_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC\n  USING (bucket_id IS DISTINCT FROM 'izo-ndt') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt');\n", '']]],
  ['M24 politica RESTRICTIVĂ de ștergere scoasă (sud_ndt_r_del)', [['CREATE POLICY sud_ndt_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated', 'CREATE POLICY sud_ndt_r_del ON storage.objects FOR DELETE TO authenticated']]],
  ['M25 politica RESTRICTIVĂ pentru anon scoasă (sud_ndt_r_anon)',
    [["CREATE POLICY sud_ndt_r_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon\n  USING (bucket_id IS DISTINCT FROM 'izo-ndt') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt');", '']]],
  ['M26 exportul complet acceptat cu lipsuri blocante', [["    IF jsonb_array_length(p_fotografie->'lipsuri_blocante') > 0 THEN\n", '    IF false THEN\n']]],
  ['M27 deblocarea valabilă pentru alte lipsuri', [[" OR d.lipsuri IS DISTINCT FROM p_fotografie->'lipsuri_blocante' THEN", ' THEN']]],
  ['M28 fără validarea tipurilor câmpurilor din rânduri',
    [["    IF jsonb_typeof(r->'cod_raw') IS DISTINCT FROM 'string' OR length(r->>'cod_raw') > 80\n", "    IF false AND (jsonb_typeof(r->'cod_raw') IS DISTINCT FROM 'string' OR length(r->>'cod_raw') > 80\n"],
     ["WHERE coalesce(jsonb_typeof(r->k), 'null') NOT IN ('number', 'null')) THEN", "WHERE coalesce(jsonb_typeof(r->k), 'null') NOT IN ('number', 'null'))) THEN"]]],
  ['M29 orfanul șters fără verificarea „neînregistrat” (permisivă + restrictivă)',
    [["\n         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name));", ');'],
     ["\n         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name)));", '));']]],
  ['M30 fotografia acceptă orice element al tronsonului (fără buletinele lipsă: regula „fiecare element”)',
    [["           IS DISTINCT FROM\n           (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT b.id::text || ':' || b.versiune::text AS k FROM public.sud_buletine b\n                                                                   WHERE b.tronson_id = v_tronson AND b.proiect_id = v_proiect AND b.stare = 'confirmat') sb)",
      "           IS DISTINCT FROM\n           (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT b.id::text || ':' || b.versiune::text AS k FROM public.sud_buletine b\n                                                                   WHERE b.tronson_id = v_tronson AND b.proiect_id = v_proiect AND b.stare = 'confirmat'\n                                                                     AND b.id::text || ':' || b.versiune::text IN (SELECT (e->>'id') || ':' || (e->>'versiune') FROM jsonb_array_elements(p_fotografie->'buletine') e)) sb)"]]],
  ['M31 ștergerea orfanului fără dreptul de citire (RLS-ul lui sud_buletine ascunde înregistrarea)',
    [["         AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire'))\n         AND NOT EXISTS", '         AND NOT EXISTS'],
     ["         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')\n         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name)));", "         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name)));"]]],
  ['M32 încărcarea fără fereastra de o oră (cursa cu ștergerea orfanului)', [["\n                      AND o.created_at > now() - interval '1 hour') THEN", ') THEN']]],
  ['M33 ștergerea orfanului fără fereastra de 2 ore (permisivă + restrictivă)',
    [["\n         AND created_at < now() - interval '2 hours'\n         AND (SELECT public.fn_sud_drept", "\n         AND (SELECT public.fn_sud_drept"],
     [" AND created_at < now() - interval '2 hours'\n         AND public.fn_sud_drept", "\n         AND public.fn_sud_drept"]]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: |^excepție: /.test(ab[0]), `${nume} pică comportamental (${(ab[0] || 'NU a picat').slice(0, 160)})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără REVOKE pe secvențe', [['REVOKE ALL ON SEQUENCE public.sud_buletine_id_seq, public.sud_buletin_randuri_id_seq, public.sud_suduri_eliminate_id_seq,\n              public.sud_export_deblocari_id_seq, public.sud_exporturi_id_seq FROM PUBLIC, anon, authenticated, service_role;', '']], /secventele sud_ \(numar sau drepturi\): sud_\w+_id_seq/],
  ['S2 fără REVOKE pe tabele (ALL implicit rămâne)', [['REVOKE ALL ON public.sud_metode_proiect, public.sud_buletine, public.sud_buletin_randuri, public.sud_suduri_eliminate,\n              public.sud_export_deblocari, public.sud_exporturi FROM PUBLIC, anon, authenticated, service_role;', '']], /drepturile tabelelor sud_/],
  ['S3 RLS oprit pe un tabel', [['ALTER TABLE public.sud_exporturi ENABLE ROW LEVEL SECURITY;', '']], /drepturile tabelelor sud_: sud_exporturi/],
  ['S4 RLS forțat pe un tabel', [['ALTER TABLE public.sud_exporturi ENABLE ROW LEVEL SECURITY;', 'ALTER TABLE public.sud_exporturi ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.sud_exporturi FORCE ROW LEVEL SECURITY;']], /drepturile tabelelor sud_: sud_exporturi/],
  ['S5 EXECUTE rămas pentru anon pe o funcție', [['  public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) FROM PUBLIC, anon, service_role;', '  public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) FROM PUBLIC, service_role;']], /functiile fn_sud_: /],
  ['S6 normalizatorul DEFINER', [['LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$\nDECLARE v_s text;', 'LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$\nDECLARE v_s text;']], /functiile fn_sud_: fn_sud_cod_normalizeaza/],
  ['S7 bucket public', [["VALUES ('izo-ndt', 'izo-ndt', false, 52428800, ARRAY['application/pdf']);", "VALUES ('izo-ndt', 'izo-ndt', true, 52428800, ARRAY['application/pdf']);"]], /bucket izo-ndt \/ politicile lui/],
  ['S8 normalizatorul cu R în cheie (cazul de bază din post)', MUTANTI[6][1], /normalizatorul nu da rezultatele asteptate/],
  ['S9 o politică storage în plus', [['-- ─────────── postcondiții ───────────', "CREATE POLICY sud_ndt_sterge ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'izo-ndt');\n-- ─────────── postcondiții ───────────"]], /bucket izo-ndt \/ politicile lui: sud_ndt_sterge$/],
  ['S10 politica de UPDATE devenită permisivă', [['CREATE POLICY sud_ndt_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC', 'CREATE POLICY sud_ndt_r_upd ON storage.objects FOR UPDATE TO PUBLIC']], /politicile lui: sud_ndt_r_upd$/],
  ['S11 politica restrictivă de citire pe PUBLIC (ar rupe citirea anonimă din storage)', [['CREATE POLICY sud_ndt_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated', 'CREATE POLICY sud_ndt_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC']], /politicile lui: sud_ndt_r_sel$/],
  ['S12 politica pentru anon lipsă', [["CREATE POLICY sud_ndt_r_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon\n  USING (bucket_id IS DISTINCT FROM 'izo-ndt') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt');", '']], /politicile lui: sud_ndt_r_anon$/],
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
  pacheteDeriva: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_pachete_acces(p_scriere boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.uid() IS NOT NULL $f$`); return livreaza(db, t) },
  calleeDeriva: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_acces_nerestrans_cont(p_profile uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$`); return livreaza(db, t) },
  // (pe executie_tronsoane schimbarea ar înroși și poarta E4b — apărare dublă; aici un tabel din afara amprentei porților)
  tipAltul: async (db, t) => { await db.exec('ALTER TABLE public.executie_pachete_lansare ALTER COLUMN tronson_id TYPE integer'); return livreaza(db, t) },
  portiRosii: async (db, t) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT '{e4b}'::text[] $f$`); return livreaza(db, t) },
  revCuDate: async (db, t) => { await livreaza(db, MIG); await ca(db, 'MPA', `SELECT public.fn_sud_metode_seteaza(${PA}, ARRAY['PM'])`, [], { commit: true }); return revino(db, t) },
  revCuObiect: async (db, t) => { await livreaza(db, MIG); await urca(db, 'MPA', `${PA}/${TA12}/r.pdf`); return revino(db, t) },
  revInPlus: async (db, t) => { await livreaza(db, MIG); await db.exec('CREATE FUNCTION public.fn_sud_zz() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$'); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără amprenta fn_executie_pachete_acces', 'mig', [["          ('public.fn_executie_pachete_acces(boolean)', 'c7ea33f39d888cb40d065ff4d02dd7b1', true, true, 'boolean')) a(", "          ('public.fn_executie_pachete_acces(boolean)', NULL, true, true, 'boolean')) a("], ['WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), \'\')) IS DISTINCT FROM a.amprenta', 'WHERE p.oid IS NULL OR (a.amprenta IS NOT NULL AND md5(replace(p.prosrc, chr(13), \'\')) IS DISTINCT FROM a.amprenta)']], 'pacheteDeriva'],
  ['P2 migrare: fără callee-urile lui fn_executie_proiect_permis', 'mig', [["          ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false, 'boolean'),\n", '']], 'calleeDeriva'],
  ['P3 migrare: fără verificarea tipurilor coloanelor', 'mig', [["    RAISE EXCEPTION '20270114a: coloanele citite nu au tipurile asteptate';\n", '    NULL;\n']], 'tipAltul'],
  // (porțile „înainte” și obiectele din bucket la revenire sunt dublate de postcondiție / FK-ul storage.objects → buckets: mutanții lor sunt
  //  echivalenți pe PGlite și nu se numără aici; refuzurile lor sunt la secțiunile 1 și 5)
  ['R1 revenire: fără verificarea „fără date”', 'rev', [["  IF v_n > 0 THEN RAISE EXCEPTION '20270114a revenire: exista % randuri / fisiere in arhiva NDT; revenirea nu sterge date (decizie separata)', v_n; END IF;\n", '']], 'revCuDate'],
  ['R3 revenire: fără numărul de funcții (în plus)', 'rev', [["     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_sud\\_%') <> 11\n", ''],
    ["     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_sud\\_%')\n", '']], 'revInPlus'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 90)}» / mutant «${rm.slice(0, 90)}»`)
}

console.log(`\n${nrOk} verificări OK, ${esec} NU`)
console.log(esec ? `EȘEC: ${esec} verificări picate` : 'TOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
