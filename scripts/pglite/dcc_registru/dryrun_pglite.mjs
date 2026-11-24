// Validarea LOCALĂ (PGlite) a celor două fișiere pentru clona coordonatorului (planul, Task 8, comenzile 5 și 7). NU atinge nicio bază reală.
//   1. supabase/tests/20270108a_executie_dcc_registru_dryrun.sql: bază nouă + constrângerile producției pe tabelele comune + migrarea aplicată ca
//      runnerul (caRunner, plafonul extins, pasul „înainte” L15 v2); variabila psql sis înlocuită textual cu system_identifier-ul PGlite;
//      numărul NOTICE-urilor „t_… ok” = BLOCURI din antet, în ordinea din NUME; după ROLLBACK nicio tabelă dcc_* nu are rânduri și nimic sintetic
//      nu a rămas. Mutanții dry-run-ului (o așteptare schimbată, ținta greșită) și un mutant al migrării (fn_dcc_server fără session_user, aplicat
//      FĂRĂ secțiunea 7) trebuie să OPREASCĂ rularea la blocul care îi prinde.
//   2. supabase/tests/20270108a_executie_dcc_registru_clona_istoric.sql: gărzile (variabile, sistem greșit, obiecte rămase, rânduri <> 2) refuză
//      fără să șteargă nimic; cazul bun șterge EXACT cele două rânduri.
// Rulare (din rădăcina worktree-ului): node scripts/pglite/dcc_registru/dryrun_pglite.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bazaGoala, dinInstantaneu, caRunner, pentruPglite, citeste, NUME, CALE_MIG, ROOT } from './baza.mjs'

const CALE_DRY = `supabase/tests/${NUME}_dryrun.sql`
const CALE_IST = `supabase/tests/${NUME}_clona_istoric.sql`
const VERS = '20270108120000'
const VREV = '20270108120001'
let abateri = 0
const ok = (cond, ce) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${ce}`); if (!cond) abateri++ }
const lit = s => `'${String(s).replace(/'/g, "''")}'`

// ── forma fișierelor: LF, fără BOM, fără backslash, fără literale Unicode escapate ──
for (const rel of [CALE_DRY, CALE_IST, 'scripts/pglite/dcc_registru/dryrun_pglite.mjs']) {
  const b = readFileSync(join(ROOT, rel))
  const t = b.toString('utf8')
  ok(!(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) && !t.includes('\r'), `${rel}: fără BOM, LF`)
  if (rel.endsWith('.sql')) ok(!t.includes('\\') && !/U&'/i.test(t), `${rel}: fără backslash și fără U&''`)
}
ok(!readFileSync(join(ROOT, 'scripts/pglite/dcc_registru/dryrun_pglite.mjs'), 'utf8').startsWith('#!'), 'validatorul fără shebang')

// constrângerile producției pe tabelele comune (ca scripts/pglite/fixturi/executie_constrangeri_productie.sql, adaptat schemei false DCC):
// profiles.role cu valoarea implicită care NU trece CHECK-ul, o fișă = un cont, user_module_access.module -> app_modules(key)
const CONSTRANGERI_PROD = `
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'manager';
UPDATE public.profiles SET role = 'teren';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_chk CHECK (role = ANY (ARRAY['superadmin', 'admin_logistica', 'manager_santier', 'sef_echipa',
  'contabilitate', 'hr', 'gestionar', 'magazioner', 'teren', 'in_asteptare']::text[]));
CREATE UNIQUE INDEX uniq_profiles_employee_id ON public.profiles (employee_id);
INSERT INTO public.app_modules (key, name) SELECT DISTINCT module, module FROM public.user_module_access ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.user_module_access ADD CONSTRAINT user_module_access_module_fkey FOREIGN KEY (module) REFERENCES public.app_modules(key);`

const TABELE = ['dcc_casute', 'dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii', 'dcc_documente',
  'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi']
const sistem = async db => (await db.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s
// după rulare: tranzacția închisă, sesiunea înapoi la postgres, nimic rămas (rânduri dcc_*, identități / proiecte sintetice)
async function curat(db) {
  try { await db.exec('ROLLBACK') } catch { /* nicio tranzacție deschisă */ }
  await db.exec('RESET ROLE; SET SESSION AUTHORIZATION postgres;')
  let randuri = 0
  for (const t of TABELE) randuri += Number((await db.query(`SELECT count(*) AS n FROM public.${t}`)).rows[0].n)
  const sint = Number((await db.query(`SELECT (SELECT count(*) FROM public.profiles WHERE id::text BETWEEN '00000000-0000-4000-8000-0000000000d1'
    AND '00000000-0000-4000-8000-0000000000da') + (SELECT count(*) FROM public.executie_proiecte WHERE id BETWEEN 990001 AND 990008) AS n`)).rows[0].n)
  return { randuri, sint }
}
async function ruleaza(db, text) {
  const note = []
  let eroare = null
  try { await db.exec(text, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e }
  const oks = note.filter(m => /^t_.* ok$/.test(m))
  return { note, oks, eroare, stare: await curat(db) }
}

// ── 1. dry-run-ul ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DRY = citeste(CALE_DRY)
const N = Number((/^-- BLOCURI: (\d+)$/m.exec(DRY) || [])[1])
const NUME_BLOCURI = ((/^-- NUME: (.+)$/m.exec(DRY) || [])[1] || '').trim().split(/\s+/)
ok(N > 0 && NUME_BLOCURI.length === N, `antetul: BLOCURI ${N}, NUME ${NUME_BLOCURI.length}`)
const blocuriInText = [...DRY.matchAll(/RAISE NOTICE '(t_[a-z0-9_]+)[^']* ok';/g)].map(m => m[1])
ok(JSON.stringify([...new Set(blocuriInText)]) === JSON.stringify(NUME_BLOCURI), `blocurile din text = NUME din antet (${[...new Set(blocuriInText)].join(' ')})`)
const vars = [...DRY.matchAll(/:'([a-z]+)'/g)].map(m => m[1])
ok(JSON.stringify(vars) === '["sis"]', `variabilele psql din dry-run: ${vars.join(', ')} (aștepta doar sis, o dată)`)
const iBegin = DRY.indexOf('\nBEGIN ISOLATION LEVEL READ COMMITTED;\n')
const dupaBegin = DRY.slice(iBegin).split('\n').slice(2, 4)
ok(iBegin > 0 && /^SELECT set_config\('dcc\.sis', :'sis', true\);$/.test(dupaBegin[0]) && /^DO \$garda\$$/.test(dupaBegin[1]),
  'prima instrucțiune după BEGIN = set_config(sis) + blocul DO al gărzii')
ok(/\nROLLBACK;\n$/.test(DRY), 'ROLLBACK la final')
const cuSis = (text, sis) => text.replace(":'sis'", lit(sis))

const MIG = citeste(CALE_MIG)
const t0 = Date.now()
const db0 = await bazaGoala()
await db0.exec(CONSTRANGERI_PROD)
try { await caRunner(db0, NUME, pentruPglite(MIG).text) } catch (e) { console.log('APLICAREA MIGRARII A ESUAT: ' + e.message + '\n' + (e.jurnal || []).join('\n')); process.exit(1) }
const B0 = await db0.dumpDataDir('none')
await db0.close()
console.log(`migrarea aplicată (cu constrângerile producției) în ${Date.now() - t0} ms`)

{
  const db = await dinInstantaneu(B0)
  const sis = await sistem(db)
  const t = Date.now()
  const r = await ruleaza(db, cuSis(DRY, sis))
  console.log(`dry-run complet în ${Date.now() - t} ms; NOTICE-uri: ${r.note.filter(m => /^(t_|garda|fixturi|dry-run)/.test(m)).length}`)
  for (const m of r.note.filter(m => /^(t_|garda|fixturi|dry-run)/.test(m))) console.log('        NOTICE:  ' + m)
  ok(!r.eroare, `dry-run fără eroare${r.eroare ? ': ' + r.eroare.message : ''}`)
  ok(r.oks.length === N, `numărul de „t_… ok” = ${r.oks.length} (antet ${N})`)
  ok(JSON.stringify(r.oks.map(m => m.split(' ')[0])) === JSON.stringify(NUME_BLOCURI), 'blocurile în ordinea din antet')
  ok(r.stare.randuri === 0 && r.stare.sint === 0, `după ROLLBACK: ${r.stare.randuri} rânduri dcc_*, ${r.stare.sint} identități / proiecte sintetice rămase`)
  ok(r.note.some(m => /^t_regresie_rest_decontat \(n\/a: fn_rest_decontat_drept lipseste/.test(m)), 't_regresie_rest_decontat scrie n/a explicit (20270105a lipsește pe PGlite)')
  await db.close()
}

// ── mutanții dry-run-ului: fiecare trebuie să oprească rularea EXACT la blocul care îl prinde, fără nimic rămas ──
const MUTANTI = [
  { nume: 'sis_gresit', aplica: t => cuSis(t, '1'), bloc: '(garda)', re: /DRYRUN_REFUZ: system_identifier/ },
  { nume: 'asteptare_secventa_p1', din: `'[45, 46, "30-AAA-TM1-COR-00045.Rev0.RO", "30-AAA-TM1-COR-00046.Rev0.RO"]'`,
    in: `'[45, 47, "30-AAA-TM1-COR-00045.Rev0.RO", "30-AAA-TM1-COR-00046.Rev0.RO"]'`, bloc: 't_p1_serie_b1', re: /FAIL secvente si coduri/ },
  { nume: 'asteptare_numarare_p7b', din: '"dcc_revizii": 5,', in: '"dcc_revizii": 6,', bloc: 't_p7b_acelasi_contract', re: /FAIL L7 dcc_revizii/ },
  { nume: 'asteptare_sqlstate_d5', din: `pg_temp.q_contract('BEN', '62', 'automat'), '42501', 'DCC_NEAUTENTIFICAT'`,
    in: `pg_temp.q_contract('BEN', '62', 'automat'), '42501', 'DCC_FARA_DREPT'`, bloc: 't_d5_identitati', re: /FAIL authenticated fara sub: contract/ },
  { nume: 'constrangere_ck12', din: `ARRAY[format(ins_s, v)], true, '23514', NULL, 'dcc_serii_interval_ck'`,
    in: `ARRAY[format(ins_s, v)], true, '23514', NULL, 'dcc_serii_limite_ck'`, bloc: 't_p1_serie_b4', re: /FAIL dcc_serii interval/ },
]
for (const m of MUTANTI) {
  let text = cuSis(DRY, '?')
  if (m.din) {
    const n = DRY.split(m.din).length - 1
    ok(n === 1, `mutantul ${m.nume}: textul înlocuit apare exact o dată (${n})`)
    text = DRY.replace(m.din, m.in)
  }
  const db = await dinInstantaneu(B0)
  const sis = await sistem(db)
  text = m.aplica ? m.aplica(DRY) : cuSis(text, sis)
  const r = await ruleaza(db, text)
  const iBloc = NUME_BLOCURI.indexOf(m.bloc)
  const asteptOk = iBloc < 0 ? 0 : iBloc
  ok(r.eroare && m.re.test(r.eroare.message) && r.oks.length === asteptOk && r.stare.randuri === 0 && r.stare.sint === 0,
    `mutantul ${m.nume}: PRINS la ${m.bloc} (${r.oks.length} „ok” înainte, aștepta ${asteptOk}; ${r.eroare ? r.eroare.message.slice(0, 140) : 'FĂRĂ EROARE'}; rămas ${r.stare.randuri}/${r.stare.sint})`)
  await db.close()
}

// ── mutantul migrării: fn_dcc_server fără session_user (CE7), aplicat FĂRĂ secțiunea 7 ($post$ ar refuza amprenta) ──
{
  const din = "RETURN auth.uid() IS NULL AND session_user = 'postgres' AND current_user = 'postgres';"
  const n = MIG.split(din).length - 1
  const marcaj = '-- ─── 7.'
  ok(n === 1 && MIG.split(marcaj).length - 1 === 1, `mutantul migrării server_fara_session_user: înlocuirea (${n}) și markerul secțiunii 7 apar o dată`)
  const mut = MIG.replace(din, "RETURN auth.uid() IS NULL AND current_user = 'postgres';")
  const fara7 = mut.slice(0, mut.indexOf(marcaj))
  const db = await bazaGoala()
  await db.exec(CONSTRANGERI_PROD)
  let aplicat = true
  try { await caRunner(db, NUME, pentruPglite(fara7).text) } catch (e) { aplicat = false; ok(false, 'aplicarea mutantului: ' + e.message) }
  if (aplicat) {
    const r = await ruleaza(db, cuSis(DRY, await sistem(db)))
    const iBloc = NUME_BLOCURI.indexOf('t_d5_identitati')
    ok(r.eroare && /FAIL authenticated fara sub: contract: a trecut/.test(r.eroare.message) && r.oks.length === iBloc && r.stare.randuri === 0,
      `mutantul migrării server_fara_session_user: PRINS la t_d5_identitati (${r.oks.length} „ok” înainte, aștepta ${iBloc}; ${r.eroare ? r.eroare.message.slice(0, 140) : 'FĂRĂ EROARE'})`)
  }
  await db.close()
}

// ── 2. ștergerea istoricului pe clonă: gărzile ────────────────────────────────────────────────────────────────────────────────────
const IST = citeste(CALE_IST)
const varsIst = [...IST.matchAll(/:'([a-z]+)'/g)].map(m => m[1])
ok(JSON.stringify(varsIst) === '["sis","vers","vrev","mig"]', `variabilele psql din clona_istoric: ${varsIst.join(', ')}`)
ok(/\nCOMMIT;\n$/.test(IST), 'clona_istoric: COMMIT la final')
const cuVars = (v) => IST.replace(":'sis'", lit(v.sis)).replace(":'vers'", lit(v.vers)).replace(":'vrev'", lit(v.vrev)).replace(":'mig'", lit(v.mig))
const RAND_ALT = ['20270101000000', '20270101a_alta_migrare']
async function bazaIstoric({ randuri = [[VERS, NUME], [VREV, NUME + '_ROLLBACK']], pregatire = '', dinMigrare = false } = {}) {
  const db = dinMigrare ? await dinInstantaneu(B0) : await bazaGoala()
  for (const [v, n] of [...randuri, RAND_ALT]) await db.query('INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)', [v, n])
  if (pregatire) await db.exec(pregatire)
  return db
}
const randuriIst = async db => (await db.query('SELECT version || \':\' || coalesce(name, \'NULL\') AS r FROM supabase_migrations.schema_migrations ORDER BY 1')).rows.map(x => x.r)
async function cazIstoric(ce, { vars = {}, baza = {}, refuz = null }) {
  const db = await bazaIstoric(baza)
  const inainte = await randuriIst(db)
  const v = { sis: await sistem(db), vers: VERS, vrev: VREV, mig: NUME, ...vars }
  const note = []
  let eroare = null
  try { await db.exec(cuVars(v), { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e; try { await db.exec('ROLLBACK') } catch { /* deja închisă */ } }
  const dupa = await randuriIst(db)
  if (refuz) {
    ok(eroare && refuz.test(eroare.message) && JSON.stringify(dupa) === JSON.stringify(inainte),
      `clona_istoric ${ce}: refuz, nimic șters (${eroare ? eroare.message.slice(0, 150) : 'FĂRĂ EROARE'}; ${inainte.length} -> ${dupa.length} rânduri)`)
  } else {
    ok(!eroare && JSON.stringify(dupa) === JSON.stringify([RAND_ALT.join(':')]) && note.some(m => /^clona_istoric: sterse 2 randuri/.test(m)),
      `clona_istoric ${ce}: șterse exact cele 2 rânduri, celelalte neatinse (${eroare ? eroare.message : dupa.join(', ')})`)
  }
  await db.close()
}
await cazIstoric('sistem greșit', { vars: { sis: '1' }, refuz: /CLONA_ISTORIC_REFUZ: system_identifier/ })
await cazIstoric('sis lipsă', { vars: { sis: '' }, refuz: /CLONA_ISTORIC_REFUZ: variabile lipsa/ })
await cazIstoric('vers invalid', { vars: { vers: '2027' }, refuz: /CLONA_ISTORIC_REFUZ: variabile lipsa/ })
await cazIstoric('vers = vrev', { vars: { vrev: VERS }, refuz: /CLONA_ISTORIC_REFUZ: variabile lipsa/ })
await cazIstoric('alt nume de migrare', { vars: { mig: '20270101a_alta_migrare' }, refuz: /CLONA_ISTORIC_REFUZ: variabile lipsa/ })
await cazIstoric('migrarea încă aplicată (revenirea n-a rulat)', { baza: { dinMigrare: true }, refuz: /CLONA_ISTORIC_REFUZ: obiectele migrarii exista inca/ })
await cazIstoric('un tabel dcc_ rămas', { baza: { pregatire: 'CREATE TABLE public.dcc_ramas (x int);' }, refuz: /obiectele migrarii exista inca \(revenirea n-a rulat\): rel dcc_ramas;/ })
await cazIstoric('o funcție fn_dcc_ rămasă', { baza: { pregatire: 'CREATE FUNCTION public.fn_dcc_ramasa() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;' },
  refuz: /obiectele migrarii exista inca \(revenirea n-a rulat\): fn fn_dcc_ramasa;/ })
await cazIstoric('un trigger trg_dcc_ rămas', { baza: { pregatire: `CREATE FUNCTION public.f_ramas() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
  CREATE TRIGGER trg_dcc_ramas BEFORE INSERT ON public.app_modules FOR EACH ROW EXECUTE FUNCTION public.f_ramas();` }, refuz: /obiectele migrarii exista inca \(revenirea n-a rulat\): trg trg_dcc_ramas;/ })
await cazIstoric('un singur rând (lipsește revenirea)', { baza: { randuri: [[VERS, NUME]] }, refuz: /CLONA_ISTORIC_REFUZ: istoricul nu e exact .*: 1 rand/ })
await cazIstoric('niciun rând', { baza: { randuri: [] }, refuz: /CLONA_ISTORIC_REFUZ: istoricul nu e exact .*: 0 rand/ })
await cazIstoric('revenirea cu alt nume', { baza: { randuri: [[VERS, NUME], [VREV, NUME]] }, refuz: /CLONA_ISTORIC_REFUZ: istoricul nu e exact/ })
await cazIstoric('un al treilea rând cu numele migrării', { baza: { randuri: [[VERS, NUME], [VREV, NUME + '_ROLLBACK'], ['20270108120002', NUME]] },
  refuz: /CLONA_ISTORIC_REFUZ: istoricul nu e exact .*: 3 rand/ })
await cazIstoric('cazul bun', {})

console.log(abateri === 0 ? 'DRYRUN_PGLITE_OK' : `DRYRUN_PGLITE_FAIL ${abateri} abateri`)
process.exit(abateri === 0 ? 0 : 1)
