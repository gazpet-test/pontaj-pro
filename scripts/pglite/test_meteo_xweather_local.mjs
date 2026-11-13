// Proba LOCALĂ a migrării 20261221a (vremea zilei din Vaisala Xweather, nemodificabilă, citită pe șantier) pe PGlite (Postgres în WASM, în
// memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261221a_meteo_xweather_schelet.sql + funcțiile de drept REALE extrase exact din 20261209a
//   (fn_raport_santier_drept, fn_executie_proiect_permis și callee-urile lor), cu drepturile lor din 20261209a.
// 1. BASELINE-ul L15 calculat pe schema falsă cu scriptul coordonatorului (scripts/meteo_xweather_amprente.sql, secțiunea lui, tranzacție
//    READ ONLY) și pus în blocul marcat, ca după review; migrarea aplicată ca runnerul (--plafon-tranzactie-ms 2000).
// 2. VERIFICĂRI (valorile așteptate scrise de mână din cerere, L25): drepturile pe roluri (anon nimic; authenticated doar citire filtrată;
//    service_role SELECT + INSERT; nimeni UPDATE / DELETE / TRUNCATE, nici proprietarul), versiunile (doar ultima + 1, nicio versiune
//    identică), ziua încheiată, momentul preluării pus de server, CHECK-urile (credențiale în cerere, stația), vederea (ultima versiune),
//    matricea de citire pe conturi (owner, alocat, alocat expirat, străin, Execuție nerestrâns / restrâns / fără nivel, contabilitate
//    nerestrânsă / restrânsă, fără JWT, anon).
// 3. REFUZURI: fără marcaj, fără plafon, baseline necompletat, dependență schimbată înainte, reaplicare; revenirea: cu rânduri, fără plafon,
//    funcție schimbată, apoi aplicare -> revenire -> re-aplicare.
// 4. MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice (la aplicare sau la verificări), altfel testul nu dovedește nimic.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_meteo_xweather_local.mjs
// Limită: PGlite nu are timere și nici concurență reală (lock_timeout / plafonul / NOWAIT ocupat se probează pe clonă, cu runnerul).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261221a_meteo_xweather_schelet.sql')
const ACCES = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const MIG = citeste('supabase/migrations/20261221a_meteo_xweather_zilnic.sql')
const REV = citeste('supabase/revenire/20261221a_meteo_xweather_zilnic_ROLLBACK.sql')
const SCRIPT = citeste('scripts/meteo_xweather_amprente.sql')
// conținutul blocului BASELINE, oricare ar fi (DE_COMPLETAT sau valorile de producție lipite): se înlocuiește cu baseline-ul schemei false
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => { const i0 = MIG.indexOf('-- >>> BASELINE 20261221a'), i = MIG.indexOf(BL_A, i0) + BL_A.length; return MIG.slice(i, MIG.indexOf(BL_B, i)) })()
if (!PLACEHOLDER.trim()) { console.error('blocul BASELINE 20261221a nu se găsește'); process.exit(1) }
// „baseline necompletat” se probează pe forma de livrare inițială (rândul DE_COMPLETAT)
const MIG_NECOMPLETAT = MIG.split(PLACEHOLDER).join("    ('DE_COMPLETAT', 'DE_COMPLETAT')")

// funcțiile de drept, EXACT din 20261209a (corpul până la $f$;), apoi drepturile lor ca acolo
const functie = (marcaj) => {
  const i = ACCES.indexOf(marcaj)
  if (i < 0) throw new Error('lipsește în 20261209a: ' + marcaj)
  return ACCES.slice(i, ACCES.indexOf('$f$;', i) + 4).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION')
}
const DREPTURI_ACCES = [
  'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(',
  'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'CREATE FUNCTION public.fn_executie_acces_lista(',
  'CREATE FUNCTION public.fn_executie_proiect_permis(', 'CREATE OR REPLACE FUNCTION public.fn_raport_santier_drept(',
].map(functie).join('\n') + `
REVOKE ALL ON FUNCTION public.fn_executie_acces_nerestrans_cont(uuid), public.fn_executie_acces_lista_cont(uuid, boolean),
  public.fn_executie_acces_nerestrans(), public.fn_executie_acces_lista(boolean), public.fn_executie_proiect_permis(bigint, boolean),
  public.fn_raport_santier_drept(bigint) FROM PUBLIC, anon, authenticated, service_role;
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
// aplicarea ca runnerul cu --plafon-tranzactie-ms 2000: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție
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
const aplicaMig = (db, text, o) => caRunner(db, '20261221a_meteo_xweather_zilnic', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261221a_meteo_xweather_zilnic_ROLLBACK', text, o)

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000a1', MGR: '00000000-0000-0000-0000-0000000000a2', MGR_EXP: '00000000-0000-0000-0000-0000000000a3',
  STRAIN: '00000000-0000-0000-0000-0000000000a4', EXEC: '00000000-0000-0000-0000-0000000000a5', EXEC_R: '00000000-0000-0000-0000-0000000000a6',
  EXEC_FARA: '00000000-0000-0000-0000-0000000000a7', CONTA: '00000000-0000-0000-0000-0000000000a8', CONTA_R: '00000000-0000-0000-0000-0000000000a9',
}
// cine vede ce șantier (10 = proiectul 1, 20 = proiectul 2, 30 = fără proiect) — din cerere: cine vede șantierul / lucrarea
const ASTEPTAT = {
  OWNER: [10, 20, 30], MGR: [10], MGR_EXP: [], STRAIN: [], EXEC: [10, 20, 30], EXEC_R: [10, 30], EXEC_FARA: [], CONTA: [10, 20, 30], CONTA_R: [20, 30],
}
const ziBuc = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ms))
const AZI = ziBuc(Date.now())
const zi = (n) => { const [y, m, d] = AZI.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const D1 = zi(-1), D2 = zi(-2)
const DATE = `
INSERT INTO public.profiles (id, name, role, is_owner) VALUES
  ('${U.OWNER}', 'OWNER', 'admin', true), ('${U.MGR}', 'MANAGER', 'manager_santier', false), ('${U.MGR_EXP}', 'EXPIRAT', 'manager_santier', false),
  ('${U.STRAIN}', 'STRAIN', 'angajat', false), ('${U.EXEC}', 'EXEC', 'inginer', false), ('${U.EXEC_R}', 'EXEC R', 'inginer', false),
  ('${U.EXEC_FARA}', 'EXEC FARA NIVEL', 'inginer', false), ('${U.CONTA}', 'CONTA', 'contabilitate', false), ('${U.CONTA_R}', 'CONTA R', 'contabilitate', false);
INSERT INTO public.executie_proiecte (id, nume, data_start) VALUES (1, 'Proiect A', '2026-01-10'), (2, 'Proiect B', '2026-03-01');
INSERT INTO public.sites (id, name, lat, lng, proiect_id) VALUES (10, 'Santier A', 44.94, 26.02, 1), (20, 'Santier B', 45.1, 25.9, 2), (30, 'Sediu', 44.95, 26.03, NULL);
INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES ('${U.MGR}', 10, NULL), ('${U.MGR_EXP}', 10, DATE '${zi(-3)}');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.EXEC}', 'executie', 'viewer'), ('${U.EXEC_R}', 'executie', 'editor'), ('${U.EXEC_FARA}', 'executie', 'fara');
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.EXEC_R}', 1, 'viewer'), ('${U.CONTA_R}', 2, 'viewer');`

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
for (const e of ['functie fn_raport_santier_drept(bigint)', 'functie fn_executie_proiect_permis(bigint,boolean)', 'functie auth.uid()',
                 'functie fn_executie_acces_nerestrans()', 'functie fn_executie_acces_lista(boolean)']) {
  if (!B0.some(r => r.eticheta === e)) { console.error('baseline: lipsește ' + e + ' (am: ' + B0.map(r => r.eticheta).join(', ') + ')'); process.exit(1) }
}
console.log(`baseline L15 20261221a (schema falsă): ${B0.length} etichete — ${B0.map(r => r.eticheta + (r.atentie ? ' [' + r.atentie + ']' : '')).join('; ')}`)
const CU_BASELINE = [PLACEHOLDER, B0.map(r => r.linie_baseline).join('\n')]
const MIG_B = aplica(MIG, [CU_BASELINE])

// ── un rând valid (ca edge-ul) ──
const RAW = `'{"success": true, "error": null, "response": [{"periods": [{"summary": {"temp": {"minC": 2}}}]}]}'::jsonb`
const rand = (site, data, versiune, { tmin = 2, tmax = 9.5, precip = 0, stare = "'ok'", statie = "'LRBS'", nume = "'Bucuresti Baneasa'", dist = 12.4,
  cerere = `'conditions/summary/44.94,26.02?from=1&to=2'`, preluat = "DEFAULT" } = {}) => `INSERT INTO public.meteo_zilnic_xweather
  (site_id, data, versiune, tmin_c, tmax_c, tmed_c, precipitatii_mm, zapada_cm, vant_max_kmh, rafala_max_kmh, vant_dir, umiditate_med, descriere,
   lat, lng, cerere_conditii, cerere_observatii, observatii_stare, statie_id, statie_nume, statie_distanta_km, raspuns_conditii, raspuns_observatii, preluat_la)
  VALUES (${site}, DATE '${data}', ${versiune}, ${tmin}, ${tmax}, NULL, ${precip}, NULL, 30, 51.5, 'NW', 80, 'Mostly Cloudy',
   44.94, 26.02, ${cerere}, 'observations/summary/closest?p=44.94,26.02', ${stare}, ${statie}, ${nume}, ${dist}, ${RAW}, ${RAW}, ${preluat})`

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

// ── verificările de comportament: întoarce lista abaterilor (gol = totul ca în cerere) ──
async function verifica(db) {
  const ab = []
  const asteptEroare = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  const asteptOk = (r, ce) => { if (r.code) ab.push(`${ce}: ${r.code} ${r.message}`) }
  // scrierile (service_role = edge fn)
  asteptOk(await ca(db, 'service_role', null, rand(10, D1, 1, { preluat: "TIMESTAMPTZ '2000-01-01 00:00Z'" }), { pastreaza: true }), 'S1 v1 site 10')
  const pl = await ca(db, 'postgres', null, `SELECT preluat_la > now() - interval '1 hour' AS ok FROM public.meteo_zilnic_xweather WHERE site_id = 10 AND versiune = 1`)
  if (pl.rows?.[0]?.ok !== true) ab.push('S2 preluat_la nu e pus de server')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D1, 1, { tmax: 11 })), '23505', 'S3 v1 dublat')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D1, 3, { tmax: 11 })), '23505', 'S4 versiune sărită')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D1, 2)), '23505', 'S5 versiune identică')
  asteptOk(await ca(db, 'service_role', null, rand(10, D1, 2, { tmax: 11, precip: 4.6 }), { pastreaza: true }), 'S6 v2 corecție')
  asteptOk(await ca(db, 'service_role', null, rand(20, D1, 1, { stare: "'fara_statie'", statie: 'NULL', nume: 'NULL', dist: 'NULL' }), { pastreaza: true }), 'S7 fără stație')
  asteptOk(await ca(db, 'service_role', null, rand(30, D2, 1, { precip: 'NULL' }), { pastreaza: true }), 'S8 site 30')
  asteptEroare(await ca(db, 'service_role', null, rand(10, AZI, 1)), '22023', 'S9 ziua de azi')
  asteptEroare(await ca(db, 'service_role', null, rand(10, zi(1), 1)), '22023', 'S10 ziua de mâine')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D2, 1, { cerere: "'conditions/summary/1,2?client_secret=x'" })), '23514', 'S11 credențiale în cerere')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D2, 1, { statie: 'NULL' })), '23514', 'S12 stare ok fără stație')
  asteptEroare(await ca(db, 'service_role', null, rand(10, D2, 1, { tmin: 12, tmax: 3 })), '23514', 'S13 Tmin > Tmax')
  // nimeni nu modifică / șterge / golește
  for (const [rol, cod] of [['service_role', '42501'], ['postgres', '42501']]) {
    asteptEroare(await ca(db, rol, null, `UPDATE public.meteo_zilnic_xweather SET tmax_c = 1 WHERE site_id = 10`), cod, `N1 UPDATE ca ${rol}`)
    asteptEroare(await ca(db, rol, null, `DELETE FROM public.meteo_zilnic_xweather WHERE site_id = 10`), cod, `N2 DELETE ca ${rol}`)
    asteptEroare(await ca(db, rol, null, `TRUNCATE public.meteo_zilnic_xweather`), cod, `N3 TRUNCATE ca ${rol}`)
  }
  asteptEroare(await ca(db, 'authenticated', U.OWNER, rand(10, D2, 1)), '42501', 'N4 INSERT ca owner logat')
  asteptEroare(await ca(db, 'authenticated', U.OWNER, `UPDATE public.meteo_zilnic_xweather SET tmax_c = 1`), '42501', 'N5 UPDATE ca owner logat')
  asteptEroare(await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.meteo_zilnic_xweather`), '42501', 'N6 DELETE ca owner logat')
  // vederea: ultima versiune + numărul de versiuni
  const v = await ca(db, 'service_role', null, `SELECT versiune, versiuni, tmax_c::text AS tmax, precipitatii_mm::text AS p, sursa FROM public.v_meteo_zilnic_xweather WHERE site_id = 10 AND data = DATE '${D1}'`)
  if (v.code || v.rows.length !== 1 || v.rows[0].versiune !== 2 || Number(v.rows[0].versiuni) !== 2 || v.rows[0].tmax !== '11.00' || v.rows[0].p !== '4.60' || v.rows[0].sursa !== 'Vaisala Xweather') {
    ab.push('V1 vederea nu dă ultima versiune: ' + JSON.stringify(v))
  }
  // citirea pe conturi (tabel și vedere)
  for (const [cont, astept] of Object.entries(ASTEPTAT)) {
    for (const ob of ['meteo_zilnic_xweather', 'v_meteo_zilnic_xweather']) {
      const r = await ca(db, 'authenticated', U[cont], `SELECT DISTINCT site_id FROM public.${ob} ORDER BY site_id`)
      const am = r.code ? 'EROARE ' + r.code : JSON.stringify(r.rows.map(x => Number(x.site_id)))
      if (am !== JSON.stringify(astept)) ab.push(`R ${cont} pe ${ob}: ${am} (aștepta ${JSON.stringify(astept)})`)
    }
  }
  const fara = await ca(db, 'authenticated', null, `SELECT count(*)::int AS n FROM public.v_meteo_zilnic_xweather`)
  if (fara.code || fara.rows[0].n !== 0) ab.push('R fără JWT: ' + JSON.stringify(fara))
  asteptEroare(await ca(db, 'anon', null, `SELECT 1 FROM public.meteo_zilnic_xweather`), '42501', 'R anon pe tabel')
  asteptEroare(await ca(db, 'anon', null, `SELECT 1 FROM public.v_meteo_zilnic_xweather`), '42501', 'R anon pe vedere')
  asteptEroare(await ca(db, 'anon', null, `SELECT public.fn_meteo_vede_site(10)`), '42501', 'R anon pe predicat')
  asteptEroare(await ca(db, 'anon', U.OWNER, rand(10, D2, 1)), '42501', 'R anon scrie')
  // răspunsul brut: tot pe șantier (contul străin nu-l vede)
  const brut = await ca(db, 'authenticated', U.STRAIN, `SELECT raspuns_conditii FROM public.meteo_zilnic_xweather`)
  if (brut.code || brut.rows.length !== 0) ab.push('R brut vizibil străinului')
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
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  // reaplicare = refuz
  let m = null; try { await aplicaMig(db, MIG_B) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  // revenirea refuză cu rânduri (vremea preluată e dovadă)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/tabelul are randuri/.test(m || ''), 'revenirea refuză cu rânduri: ' + m)
  await db.close()
}

// ── 2. refuzurile migrării ──
console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', (db) => aplicaMig(db, MIG_B, { marcaj: false }), /garda start invalida/],
  ['fără plafon', (db) => aplicaMig(db, MIG_B, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcaj', (db) => aplicaMig(db, MIG_B, { marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['baseline necompletat', (db) => aplicaMig(db, MIG_NECOMPLETAT), /baseline L15 necompletat/],
  ['dependență schimbată înainte', async (db) => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_raport_santier_drept(p_site bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15/],
  ['drept nou pe o dependență', async (db) => {
    await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_raport_santier_drept(bigint) TO anon;`)
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const ramas = (await db.query(`SELECT to_regclass('public.meteo_zilnic_xweather') IS NULL AS gol`)).rows[0].gol
  ok(re.test(m || '') && ramas, `${nume}: ${m}`)
  await db.close()
}

// ── 3. revenirea: refuzuri + aplicare -> revenire -> re-aplicare ──
console.log('3. revenirea')
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  await revino(db)
  const r = (await db.query(`SELECT to_regclass('public.meteo_zilnic_xweather') IS NULL AND to_regclass('public.v_meteo_zilnic_xweather') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('fn_meteo_vede_site', 'fn_meteo_xw_inserare', 'fn_meteo_xw_nemodificabil')) AS gol`)).rows[0].gol
  ok(r, 'revenirea scoate tot')
  await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db.close()
}
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_meteo_xw_nemodificabil() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/starea nu e cea din 20261221a/.test(m || ''), 'revenirea refuză o funcție schimbată: ' + m)
  await db.close()
}

// ── 4. mutanții: fiecare TREBUIE să pice ──
console.log('4. mutanții migrării')
const MUTANTI = [
  ['M1 politica USING true', [['USING (public.fn_meteo_vede_site(site_id));', 'USING (true);']]],
  ['M2 UPDATE pentru service_role', [['GRANT SELECT, INSERT ON public.meteo_zilnic_xweather TO service_role;', 'GRANT SELECT, INSERT, UPDATE ON public.meteo_zilnic_xweather TO service_role;']]],
  ['M3 anon nerevocat', [['REVOKE ALL ON public.meteo_zilnic_xweather FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON public.meteo_zilnic_xweather FROM PUBLIC, authenticated, service_role;']]],
  ['M4 fără trigger-ul de nemodificare', [['CREATE TRIGGER trg_meteo_xw_nemodificabil BEFORE UPDATE OR DELETE ON public.meteo_zilnic_xweather\n  FOR EACH ROW EXECUTE FUNCTION public.fn_meteo_xw_nemodificabil();\n', '']]],
  ['M5 fără verificarea versiunii', [['IF NEW.versiune IS DISTINCT FROM (CASE WHEN v_are THEN v_ant.versiune + 1 ELSE 1 END) THEN', 'IF false THEN']]],
  ['M6 versiune identică permisă', [['IF v_are AND (NEW.tmin_c,', 'IF false AND (NEW.tmin_c,']]],
  ['M7 preluat_la de la client', [['  NEW.preluat_la := now();\n', '']]],
  ['M8 predicat fără restricția pe proiect', [['\n            AND EXISTS (SELECT 1 FROM public.sites s\n                         WHERE s.id = p_site AND (s.proiect_id IS NULL OR public.fn_executie_proiect_permis(s.proiect_id::bigint, false))))', ')']]],
  ['M9 vederea fără security_invoker', [['CREATE VIEW public.v_meteo_zilnic_xweather WITH (security_invoker = on) AS', 'CREATE VIEW public.v_meteo_zilnic_xweather AS']]],
  ['M10 ziua în curs permisă', [["IF NEW.data >= (now() AT TIME ZONE 'Europe/Bucharest')::date THEN", 'IF false THEN']]],
  ['M11 orice nivel pe Execuție', [["u.access_level IN ('viewer', 'editor', 'admin')", 'true']]],
  ['M12 trigger-ul de golire lipsă', [['CREATE TRIGGER trg_meteo_xw_nemodificabil_golire BEFORE TRUNCATE ON public.meteo_zilnic_xweather\n  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_meteo_xw_nemodificabil();\n', '']]],
  ['M13 contabilitatea fără restricția pe proiect', [["OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'contabilitate'))\n            AND EXISTS", "OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'contabilitate'))\n            OR EXISTS"]]],
  ['M14 CHECK-ul credențialelor lipsă', [["AND cerere_conditii !~* 'client_(id|secret)'", '']]],
]
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, aplica(MIG_B, inl))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}
console.log('   mutanții revenirii')
for (const [nume, inl, pregatire, re] of [
  ['R1 fără verificarea „tabel gol”', [["  IF EXISTS (SELECT 1 FROM public.meteo_zilnic_xweather) THEN\n    RAISE EXCEPTION '20261221a revenire: tabelul are randuri (vremea preluata e dovada si nu se sterge de aici)';\n  END IF;\n", '']],
    async (db) => { await db.exec(rand(10, D1, 1)) }, /tabelul are randuri/],
  ['R2 fără amprenta corpului', [["                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp\n", '']],
    async (db) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_meteo_xw_nemodificabil() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`) }, /starea nu e cea din 20261221a/],
]) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await pregatire(db)
  let mOrig = null; try { await revino(db, REV) } catch (e) { mOrig = e.message }
  let mMut = null; try { await revino(db, aplica(REV, inl)) } catch (e) { mMut = e.message }
  // originalul refuză; mutantul trece (adică testul de mai sus ar fi prins lipsa verificării)
  ok(re.test(mOrig || '') && mMut == null, `${nume}: originalul refuză (${mOrig}), mutantul trece = verificarea e necesară`)
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
