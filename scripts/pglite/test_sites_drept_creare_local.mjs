// Proba LOCALĂ a migrării 20261222a (dreptul de a crea un șantier, pe cont) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261222a_sites_drept_creare_schelet.sql (politicile de azi pe sites: citire pentru conturile logate,
//   INSERT / UPDATE / DELETE doar owner) + funcțiile de drept Execuție REALE extrase exact din 20261209a (fn_executie_proiect_permis și
//   callee-urile lor), cu drepturile lor de acolo.
// 1. BASELINE-ul L15 calculat pe schema falsă cu scriptul coordonatorului (scripts/sites_drept_creare_amprente.sql, tranzacție READ ONLY) și
//    pus în blocul marcat, ca după review; migrarea aplicată ca runnerul (--plafon-tranzactie-ms 2000).
// 2. VERIFICĂRI (valorile așteptate scrise de mână din cerere, L25), ca rolul authenticated cu JWT-ul fiecărui cont: owner DA; contul cu
//    dreptul (editor / admin) DA, și legat de un proiect pe care poate scrie; cont cu can_manage_contracts FĂRĂ drept NU; nivel viewer NU;
//    'administrativ.locatii' NU (alt sens); cont restrâns pe proiect: proiectul lui DA, altul NU; fără JWT NU; anon NU; UPDATE / DELETE
//    rămân ale owner-ului; dreptul retras = refuz imediat.
// 3. REFUZURI: fără marcaj, fără plafon, baseline necompletat, politică / drept schimbat înainte, RESTRICTIVE pe INSERT, reaplicare; L15:
//    schimbare între „înainte” și „după”; revenirea: drept acordat, fără plafon / marcaj, funcție schimbată, aplicare -> revenire -> re-aplicare.
// 4. MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice. La mutanții pe corpul funcției, amprenta corpului din
//    migrare se recalculează, ca să pice COMPORTAMENTUL (nu doar amprenta).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sites_drept_creare_local.mjs
// Limită: PGlite nu are timere și nici concurență reală (lock_timeout / plafonul / NOWAIT ocupat se probează pe clonă, cu runnerul).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261222a_sites_drept_creare_schelet.sql')
const ACCES = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const MIG = citeste('supabase/migrations/20261222a_sites_drept_creare.sql')
const REV = citeste('supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql')
const SCRIPT = citeste('scripts/sites_drept_creare_amprente.sql')
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => { const i0 = MIG.indexOf('-- >>> BASELINE 20261222a'), i = MIG.indexOf(BL_A, i0) + BL_A.length; return MIG.slice(i, MIG.indexOf(BL_B, i)) })()
if (!PLACEHOLDER.trim()) { console.error('blocul BASELINE 20261222a nu se găsește'); process.exit(1) }
const MIG_NECOMPLETAT = MIG.split(PLACEHOLDER).join("    ('DE_COMPLETAT', 'DE_COMPLETAT')")
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')

// funcțiile de drept Execuție, EXACT din 20261209a (corpul până la $f$;), apoi drepturile lor ca acolo
const functie = (marcaj) => {
  const i = ACCES.indexOf(marcaj)
  if (i < 0) throw new Error('lipsește în 20261209a: ' + marcaj)
  return ACCES.slice(i, ACCES.indexOf('$f$;', i) + 4).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION')
}
const DREPTURI_ACCES = [
  'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(',
  'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'CREATE FUNCTION public.fn_executie_acces_lista(',
  'CREATE FUNCTION public.fn_executie_proiect_permis(',
].map(functie).join('\n') + `
REVOKE ALL ON FUNCTION public.fn_executie_acces_nerestrans_cont(uuid), public.fn_executie_acces_lista_cont(uuid, boolean),
  public.fn_executie_acces_nerestrans(), public.fn_executie_acces_lista(boolean), public.fn_executie_proiect_permis(bigint, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_nerestrans(), public.fn_executie_proiect_permis(bigint, boolean) TO authenticated;`

const sectiune = (t) => { const i = t.indexOf('WITH RECURSIVE'); return t.slice(i, t.indexOf('ORDER BY c.eticheta COLLATE "C";', i) + 'ORDER BY c.eticheta COLLATE "C"'.length) }
async function baseline(db) {
  await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;')
  try { return (await db.query(sectiune(SCRIPT))).rows } finally { await db.exec('ROLLBACK') }
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
// corpul funcției noi din textul migrării + amprenta lui (la mutanții pe corp, amprenta „după” se pune pe corpul mutat)
const corpFn = (t) => { const i = t.indexOf('CREATE FUNCTION public.fn_sites_drept_creare('), a = t.indexOf('AS $f$', i) + 6; return t.slice(a, t.indexOf('$f$;', a)) }
const AMP_CORP = md5(corpFn(MIG))
const cuAmprentaCorp = (t) => t.split(AMP_CORP).join(md5(corpFn(t)))
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}\n${text}\nCOMMIT;`, { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text, o) => caRunner(db, '20261222a_sites_drept_creare', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261222a_sites_drept_creare_ROLLBACK', text, o)

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000b1', TIT: '00000000-0000-0000-0000-0000000000b2', TIT_ADM: '00000000-0000-0000-0000-0000000000b3',
  TIT_VIEW: '00000000-0000-0000-0000-0000000000b4', CONTR: '00000000-0000-0000-0000-0000000000b5', LOC: '00000000-0000-0000-0000-0000000000b6',
  TIT_R: '00000000-0000-0000-0000-0000000000b7', STRAIN: '00000000-0000-0000-0000-0000000000b8',
}
const DATE = `
INSERT INTO public.profiles (id, name, role, is_owner, can_manage_contracts) VALUES
  ('${U.OWNER}', 'OWNER', 'admin', true, true), ('${U.TIT}', 'TITULAR', 'manager_santier', false, true),
  ('${U.TIT_ADM}', 'TITULAR ADMIN', 'manager_santier', false, false), ('${U.TIT_VIEW}', 'TITULAR VIEWER', 'manager_santier', false, false),
  ('${U.CONTR}', 'CONTRACTE FARA DREPT', 'manager_santier', false, true), ('${U.LOC}', 'LOCATII', 'administrativ', false, false),
  ('${U.TIT_R}', 'TITULAR RESTRANS', 'inginer', false, false), ('${U.STRAIN}', 'STRAIN', 'angajat', false, false);
INSERT INTO public.executie_proiecte (id, nume) VALUES (1, 'Proiect A'), (2, 'Proiect B');
INSERT INTO public.sites (name, active, proiect_id) VALUES ('Sediu', true, NULL);
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.TIT_R}', 1, 'editor'), ('${U.TIT_R}', 2, 'viewer');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.LOC}', 'administrativ.locatii', 'editor'), ('${U.CONTR}', 'executie', 'editor');`
// dreptul îl acordă coordonatorul DUPĂ migrare (cheia există doar după ea) — aici, ca postgres
const ACORDA = `INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.TIT}', 'santiere_creare', 'editor'), ('${U.TIT_ADM}', 'santiere_creare', 'admin'),
  ('${U.TIT_VIEW}', 'santiere_creare', 'viewer'), ('${U.TIT_R}', 'santiere_creare', 'editor');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(DREPTURI_ACCES)
  await db.exec(DATE)
  return db
}
const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0)
await BAZA0.close()
// închiderea + tabelul, pe schema falsă = EXACT ce e scris de mână (sites + pornirea + lanțul din 20261209a + funcția trigger-ului)
const ETICHETE = ['functie auth.uid()', 'functie fn_executie_acces_lista(boolean)', 'functie fn_executie_acces_lista_cont(uuid,boolean)',
  'functie fn_executie_acces_nerestrans()', 'functie fn_executie_acces_nerestrans_cont(uuid)', 'functie fn_executie_proiect_permis(bigint,boolean)',
  'functie fn_schelet_sites_mutat()', 'tabel sites | acl', 'tabel sites | acl coloane', 'tabel sites | politici', 'tabel sites | rls',
  'tabel sites | secvente', 'tabel sites | triggere']
if (JSON.stringify(B0.map(r => r.eticheta)) !== JSON.stringify(ETICHETE)) {
  console.error('baseline: etichetele nu sunt cele așteptate: ' + B0.map(r => r.eticheta).join(', ')); process.exit(1)
}
console.log(`baseline L15 20261222a (schema falsă): ${B0.length} etichete — ${B0.map(r => r.eticheta + (r.atentie ? ' [' + r.atentie + ']' : '')).join('; ')}`)
const linii = (rows) => rows.map((r, i) => (i === 0 ? '    ' : '  , ') + r.linie_baseline.replace(/^\s*,?\s*/, ''))
const cuBaseline = (text, rows) => aplica(text, [[PLACEHOLDER, linii(rows).join('\n')]])
const MIG_B = cuBaseline(MIG, B0)

// rulează ca un rol (cu JWT-ul contului, dacă e dat); întoarce { rows } sau { code, message }
async function ca(db, rol, uid, sql, { pastreaza = false } = {}) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try {
    const r = await db.query(sql)
    await db.exec(pastreaza ? 'COMMIT' : 'ROLLBACK')
    return { rows: r.rows }
  } catch (e) {
    await db.exec('ROLLBACK')
    return { code: e.code, message: e.message }
  }
}
// INSERT ca din interfață (cu RETURNING: interfața cere id-ul înapoi)
const ins = (proiect) => `INSERT INTO public.sites (name, active, beneficiar_principal, proiect_id) VALUES ('Santier nou', true, 'Beneficiar', ${proiect}) RETURNING id`

// ── verificările de comportament: întoarce lista abaterilor (gol = totul ca în cerere) ──
async function verifica(db) {
  const ab = []
  const asteptRefuz = (r, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta refuz 42501)`); else if (r.code !== '42501') ab.push(`${ce}: ${r.code} ${r.message} (aștepta 42501)`) }
  const asteptRand = (r, ce) => { if (r.code) ab.push(`${ce}: ${r.code} ${r.message}`); else if (r.rows.length !== 1) ab.push(`${ce}: ${r.rows.length} rânduri (aștepta 1)`) }
  // migrarea nu acordă nimic: înainte de acordare, nimeni în afară de owner nu creează
  asteptRefuz(await ca(db, 'authenticated', U.TIT, ins('NULL')), 'A0 titularul ÎNAINTE de acordare')
  await db.exec(ACORDA)
  // matricea INSERT (din cerere)
  for (const [cont, proiect, astept] of [
    ['OWNER', 'NULL', true], ['OWNER', '2', true],
    ['TIT', 'NULL', true], ['TIT', '1', true], ['TIT', '2', true], ['TIT_ADM', 'NULL', true],
    ['TIT_VIEW', 'NULL', false], ['CONTR', 'NULL', false], ['CONTR', '1', false], ['LOC', 'NULL', false], ['STRAIN', 'NULL', false],
    ['TIT_R', 'NULL', true], ['TIT_R', '1', true], ['TIT_R', '2', false],
  ]) {
    const r = await ca(db, 'authenticated', U[cont], ins(proiect))
    if (astept) asteptRand(r, `I ${cont} proiect ${proiect}`); else asteptRefuz(r, `I ${cont} proiect ${proiect}`)
  }
  asteptRefuz(await ca(db, 'authenticated', null, ins('NULL')), 'I fără JWT')
  asteptRefuz(await ca(db, 'anon', null, ins('NULL')), 'I anon')
  asteptRefuz(await ca(db, 'anon', U.TIT, ins('NULL')), 'I anon cu JWT-ul titularului')
  // UPDATE / DELETE rămân ale owner-ului (contul cu drept: 0 rânduri, nimic schimbat)
  for (const [ce, sql] of [['U redenumire', `UPDATE public.sites SET name = 'Alt nume' WHERE name = 'Sediu' RETURNING id`],
                           ['U legare de proiect', `UPDATE public.sites SET proiect_id = 2 WHERE name = 'Sediu' RETURNING id`],
                           ['U dezactivare', `UPDATE public.sites SET active = false WHERE name = 'Sediu' RETURNING id`],
                           ['D ștergere', `DELETE FROM public.sites WHERE name = 'Sediu' RETURNING id`]]) {
    const r = await ca(db, 'authenticated', U.TIT, sql)
    if (r.code || r.rows.length !== 0) ab.push(`${ce} ca titular: ${JSON.stringify(r)} (aștepta 0 rânduri)`)
    const o = await ca(db, 'authenticated', U.OWNER, sql)
    if (o.code || o.rows.length !== 1) ab.push(`${ce} ca owner: ${JSON.stringify(o)} (aștepta 1 rând)`)
  }
  // predicatul: doar adevărat / fals despre apelant; anon nu-l poate chema
  const p1 = await ca(db, 'authenticated', U.TIT, `SELECT public.fn_sites_drept_creare(NULL) AS d`)
  const p2 = await ca(db, 'authenticated', U.CONTR, `SELECT public.fn_sites_drept_creare(NULL) AS d`)
  if (p1.rows?.[0]?.d !== true || p2.rows?.[0]?.d !== false) ab.push(`P predicatul: titular ${JSON.stringify(p1)}, fără drept ${JSON.stringify(p2)}`)
  asteptRefuz(await ca(db, 'anon', null, `SELECT public.fn_sites_drept_creare(NULL)`), 'P anon cheamă predicatul')
  // dreptul retras = refuz imediat (nimic ținut minte)
  await db.exec(`DELETE FROM public.user_module_access WHERE profile_id = '${U.TIT}' AND module = 'santiere_creare'`)
  asteptRefuz(await ca(db, 'authenticated', U.TIT, ins('NULL')), 'R titularul după retragerea dreptului')
  await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.TIT}', 'santiere_creare', 'editor')`)
  return ab
}

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── 1. aplicarea + verificările ──
console.log('1. aplicarea migrării (baseline pe schema falsă) + verificările')
{
  const db = await bazaNoua()
  const j = await aplicaMig(db, MIG_B)
  ok(j.some(m => /lock la \d+ ms/.test(m)) && j.some(m => /sfarsit la \d+ ms/.test(m)), 'NOTICE-urile de timp (lock / sfârșit)')
  const ak = (await db.query(`SELECT count(*)::int AS n FROM public.user_module_access WHERE module = 'santiere_creare'`)).rows[0].n
  ok(ak === 0, 'migrarea nu acordă dreptul nimănui')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  let m = null; try { await aplicaMig(db, MIG_B) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/dreptul santiere_creare e acordat/.test(m || ''), 'revenirea refuză cu dreptul acordat: ' + m)
  await db.close()
}

// ── 2. refuzurile migrării ──
console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', (db) => aplicaMig(db, MIG_B, { marcaj: false }), /garda start invalida/],
  ['fără plafon', (db) => aplicaMig(db, MIG_B, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcaj', (db) => aplicaMig(db, MIG_B, { marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['baseline necompletat', (db) => aplicaMig(db, MIG_NECOMPLETAT), /baseline L15 necompletat/],
  ['politică nouă pe sites după baseline', async (db) => {
    await db.exec(`CREATE POLICY zz_insert_toti ON public.sites FOR INSERT TO authenticated WITH CHECK (true);`)
    return aplicaMig(db, MIG_B)
  }, /starea de acces \(inainte\) difera de baseline-ul L15 revizuit: tabel sites \| politici/],
  ['drept nou pe sites după baseline', async (db) => {
    await db.exec(`GRANT SELECT ON public.sites TO PUBLIC;`)
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15 revizuit: tabel sites \| acl/],
  ['dependență schimbată după baseline', async (db) => {
    await db.exec(functie('CREATE FUNCTION public.fn_executie_proiect_permis(').replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
      .replace('SELECT p_scriere IS NOT NULL', 'SELECT true OR p_scriere IS NOT NULL'))
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15 revizuit: functie fn_executie_proiect_permis/],
  ['RESTRICTIVE pe INSERT (dreptul nou n-ar avea efect)', async (db) => {
    await db.exec(`CREATE POLICY zz_restr ON public.sites AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);`)
    return aplicaMig(db, cuBaseline(MIG, await baseline(db)))
  }, /politica RESTRICTIVE pe INSERT/],
  ['authenticated fără INSERT pe sites', async (db) => {
    await db.exec(`REVOKE INSERT ON public.sites FROM authenticated;`)
    return aplicaMig(db, cuBaseline(MIG, await baseline(db)))
  }, /authenticated nu are INSERT pe sites/],
  ['cheia există deja (reaplicare parțială)', async (db) => {
    await db.exec(`INSERT INTO public.app_modules (key, name) VALUES ('santiere_creare', 'x');`)
    return aplicaMig(db, MIG_B)
  }, /reaplicare/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const ramas = (await db.query(`SELECT NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'sites_insert_drept_creare')
     AND to_regprocedure('public.fn_sites_drept_creare(bigint)') IS NULL AS gol`)).rows[0].gol
  ok(re.test(m || '') && ramas, `${nume}: ${m}`)
  await db.close()
}

// ── 2b. L15 „după”: schimbare între cele două verificări + mutanții porții ──
console.log('2b. L15: schimbarea între „înainte” și „după”')
const INTRE = (sql) => [['-- ── punctul UNIC de blocare (L06)', sql + '\n-- ── punctul UNIC de blocare (L06)']]
const PERMIS_LARG = functie('CREATE FUNCTION public.fn_executie_proiect_permis(').replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
  .replace('SELECT p_scriere IS NOT NULL', 'SELECT true OR p_scriere IS NOT NULL')
const SCEN_L15 = [
  ['funcție din lanț schimbată între verificări', INTRE(PERMIS_LARG), /starea de acces \(dupa\) difera de baseline-ul L15: functie fn_executie_proiect_permis|starea de acces \(dupa\) difera de baseline-ul L15 revizuit: functie fn_executie_proiect_permis/],
  ['altă politică adăugată între verificări', INTRE('CREATE POLICY zz_upd ON public.sites FOR UPDATE TO authenticated USING (true);'), /politicile lui sites \(dupa\) nu sunt cele de dinainte \+ politica noua/],
  ['drept pe tabel adăugat între verificări', INTRE('REVOKE TRUNCATE ON public.sites FROM anon;'), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: tabel sites \| acl/],
  ['trigger nou între verificări', INTRE('CREATE TRIGGER zz_t AFTER INSERT ON public.sites FOR EACH ROW EXECUTE FUNCTION public.fn_schelet_sites_mutat();'), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: tabel sites \| triggere/],
]
for (const [nume, mut, re] of SCEN_L15) {
  const db = await bazaNoua()
  let m = null; try { await aplicaMig(db, aplica(MIG_B, mut)) } catch (e) { m = e.message }
  ok(re.test(m || ''), `${nume}: ${m || 'NU a refuzat'}`)
  await db.close()
}
console.log('   mutanții porții L15 (originalul refuză, mutantul trece = verificarea e necesară)')
for (const [nume, scen, mutPoarta] of [
  ['L1 fără verificarea „după”', SCEN_L15[1][1], [["  PERFORM pg_temp.amp_verifica_20261222a('dupa');\n", '']]],
  ['L2 politicile „după” necomparate', SCEN_L15[1][1], [['       OR md5(coalesce(nullif(array_to_string(v_rest', '       OR false AND md5(coalesce(nullif(array_to_string(v_rest']]],
  ['L3 restul „după” necomparat', SCEN_L15[2][1], [['  IF v_dif IS NOT NULL THEN', '  IF p_moment = \'inainte\' AND v_dif IS NOT NULL THEN']]],
]) {
  const rul = async (extra) => { const db = await bazaNoua(); try { await aplicaMig(db, aplica(MIG_B, [...scen, ...extra])); return null } catch (e) { return e.message } finally { await db.close() } }
  const mOrig = await rul([]), mMut = await rul(mutPoarta)
  ok(mOrig != null && mMut == null, `${nume}: originalul refuză (${(mOrig || 'NU').slice(0, 90)}), mutantul ${mMut == null ? 'trece' : 'refuză și el: ' + mMut.slice(0, 90)}`)
}

// ── 3. revenirea ──
console.log('3. revenirea')
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  await revino(db)
  const r = (await db.query(`SELECT NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'sites_insert_drept_creare')
     AND to_regprocedure('public.fn_sites_drept_creare(bigint)') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare')
     AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.sites'::regclass) = 4 AS gol`)).rows[0].gol
  ok(r, 'revenirea scoate exact ce a creat migrarea (cele 4 politici de azi rămân)')
  const b2 = await baseline(db)
  ok(JSON.stringify(b2.map(x => [x.eticheta, x.amprenta])) === JSON.stringify(B0.map(x => [x.eticheta, x.amprenta])), 'după revenire amprenta L15 = baseline-ul de dinainte')
  await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db.close()
}
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sites_drept_creare(p_proiect bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/starea nu e cea din 20261222a \(pasul 1, functia\)/.test(m || ''), 'revenirea refuză o funcție schimbată: ' + m)
  await db.close()
}

// ── 4. mutanții migrării: fiecare TREBUIE să pice ──
console.log('4. mutanții migrării')
const MUTANTI = [
  ['M1 nivel viewer acceptat', [["u.access_level IN ('editor', 'admin')", "u.access_level IN ('viewer', 'editor', 'admin')"]]],
  ['M2 fără verificarea proiectului legat (L09)', [['\n    AND (p_proiect IS NULL OR public.fn_executie_proiect_permis(p_proiect, true))', '']]],
  ['M3 cheia administrativ.locatii în loc de cheia nouă', [["u.module = 'santiere_creare'", "u.module IN ('santiere_creare', 'administrativ.locatii')"]]],
  ['M4 lărgit la can_manage_contracts', [["u.access_level IN ('editor', 'admin'))", "u.access_level IN ('editor', 'admin'))\n    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.can_manage_contracts)"]]],
  ['M5 proiect citit doar pentru citire', [['public.fn_executie_proiect_permis(p_proiect, true)', 'public.fn_executie_proiect_permis(p_proiect, false)']]],
  ['M6 politica pe ALL (și UPDATE / DELETE)', [['AS PERMISSIVE FOR INSERT TO authenticated\n  WITH CHECK (public.fn_sites_drept_creare(proiect_id::bigint));',
    'AS PERMISSIVE FOR ALL TO authenticated\n  USING (public.fn_sites_drept_creare(proiect_id::bigint)) WITH CHECK (public.fn_sites_drept_creare(proiect_id::bigint));']]],
  ['M7 EXECUTE pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_sites_drept_creare(bigint) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_sites_drept_creare(bigint) TO authenticated, anon;']]],
  ['M8 migrarea acordă dreptul cuiva', [['CREATE POLICY sites_insert_drept_creare', `INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.CONTR}', 'santiere_creare', 'editor');\nCREATE POLICY sites_insert_drept_creare`]]],
  ['M9 politica fără predicat', [['  WITH CHECK (public.fn_sites_drept_creare(proiect_id::bigint));', '  WITH CHECK (true);']]],
  ['M10 identitatea din altă sursă decât auth.uid()', [["WHERE u.profile_id = auth.uid() AND u.module = 'santiere_creare'", "WHERE u.module = 'santiere_creare'"]]],
]
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, cuAmprentaCorp(aplica(MIG_B, inl)))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}
console.log('   mutanții revenirii')
for (const [nume, inl, pregatire, re] of [
  ['R1 fără verificarea „niciun drept acordat”', [["  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN\n    RAISE EXCEPTION '20261222a revenire: dreptul santiere_creare e acordat (user_module_access); retragerea lui e un pas separat, cu acordul owner-ului';\n  END IF;\n", '']],
    async (db) => { await db.exec(ACORDA) }, /dreptul santiere_creare e acordat/],
  ['R2 fără amprenta corpului', [["                      AND md5(replace(p.prosrc, chr(13), '')) =\n                          -- AMPRENTA-START predicatul\n                          '" + AMP_CORP + "'\n                          -- AMPRENTA-END predicatul\n", '']],
    async (db) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sites_drept_creare(p_proiect bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`) }, /starea nu e cea din 20261222a/],
]) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await pregatire(db)
  let mOrig = null; try { await revino(db, REV) } catch (e) { mOrig = e.message }
  let mMut = null; try { await revino(db, aplica(REV, inl)) } catch (e) { mMut = e.message }
  ok(re.test(mOrig || '') && mMut == null, `${nume}: originalul refuză (${mOrig}), mutantul trece = verificarea e necesară`)
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
