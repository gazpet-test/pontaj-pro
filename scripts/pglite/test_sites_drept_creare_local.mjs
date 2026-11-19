// Proba LOCALĂ a migrării 20261222a, runda 2 (dreptul de a crea un șantier, pe cont, prin RPC-ul fn_sites_creeaza) pe PGlite (Postgres în
// WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261222a_sites_drept_creare_schelet.sql — coloanele reale ale lui sites, triggerul REAL de proiect automat
//   (corpurile din producție; md5-ul lor e verificat mai jos față de valorile citite din producție pe 13.11.2026), RLS-ul REAL pe
//   executie_proiecte (politica permisivă + cele RESTRICTIVE și garda din 20261209a) — + funcțiile de drept Execuție REALE extrase exact din
//   20261209a.
// Secțiuni (valorile așteptate scrise de mână din cerere și din citirea de producție, L25; apelurile ca rolul authenticated cu JWT-ul contului):
//   0. fidelitatea schemei (md5 corpuri producție, baseline-ul L15 cu etichetele așteptate);
//   1. matricea RPC-ului (cine / pe ce proiect), ce scrie (doar nume / beneficiar / proiect; restul = valorile implicite), legătura în ambele
//      sensuri FĂRĂ proiect automat, idempotența, refuzurile de reguli, căile directe (INSERT / UPDATE / DELETE) neschimbate, dreptul retras,
//      postcondiția RPC-ului la un trigger schimbat;
//   2. fluxul COMPLET al wizard-ului prin codul JS real (src/lib/santiereDrept.js, creeazaSantier + mesajSantier) peste un adaptor tip
//      PostgREST: cont cu drept / owner / fără drept / restrâns, răspuns pierdut după COMMIT (reconciliere), rețea picată înainte (reîncercare
//      idempotentă), migrarea neaplicată (UI nouă), interfața VECHE cu migrarea aplicată și dreptul acordat (fără fals succes);
//   3. paritatea regulii de cont UI ↔ BD (L19);
//   4. refuzurile migrării, L15 între „înainte” și „după” + mutanții porții;
//      runda 3 (P2-1): W13–W17 — primul apel ambiguu, apoi o schimbare COMISĂ între apeluri (dreptul retras / funcția scoasă): eșecul
//      reîncercării nu înlocuiește incertitudinea; decide reconcilierea finală (necunoscut dacă nu se poate citi) + mutanții J8–J10;
//   5. revenirea (refuzuri, aplicare → revenire → reaplicare, amprenta = baseline, șantierele create rămân) + mutanții ei; runda 3 (P2-2):
//      deriva după aplicare (drepturi pe orice rol, proprietăți, rândul cheii) = refuz, nimic schimbat + mutanții R2–R5;
//   6. mutanții migrării (comportament) și ai codului JS — fiecare TREBUIE să pice.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sites_drept_creare_local.mjs
// Limită: PGlite are o singură conexiune, fără timere: concurența (două apeluri pe același proiect, lock-ul NOWAIT al migrării / revenirii)
//   și triggerele reale ale lui executie_proiecte se probează pe clona PG17: supabase/tests/20261222a_sites_drept_creare_clona.sh.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261222a_sites_drept_creare_schelet.sql')
const ACCES = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const MIG = citeste('supabase/migrations/20261222a_sites_drept_creare.sql')
const REV = citeste('supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql')
const SCRIPT = citeste('scripts/sites_drept_creare_amprente.sql')
const JS_SURSA = citeste('src/lib/santiereDrept.js')
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => { const i0 = MIG.indexOf('-- >>> BASELINE 20261222a'), i = MIG.indexOf(BL_A, i0) + BL_A.length; return MIG.slice(i, MIG.indexOf(BL_B, i)) })()
if (!PLACEHOLDER.trim()) { console.error('blocul BASELINE 20261222a nu se găsește'); process.exit(1) }
const MIG_NECOMPLETAT = MIG.split(PLACEHOLDER).join("    ('DE_COMPLETAT', 'DE_COMPLETAT')")
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')
// valorile CITITE din producție de coordonator (13.11.2026, brief/prod_sites_trigger_si_coloane_20261113.txt): sursă independentă de schelet
const MD5_PRODUCTIE = { 'fn_auto_create_executie_proiect()': '22f95c1e3f15cde32a1d2c11e3259089', 'fn_site_name_to_cod_intern(text)': 'b2df9daee02b13aea993b18a721ecba9' }

// funcțiile de drept Execuție + garda, EXACT din 20261209a (corpul până la $f$;), apoi drepturile lor ca acolo
const functie = (marcaj) => {
  const i = ACCES.indexOf(marcaj)
  if (i < 0) throw new Error('lipsește în 20261209a: ' + marcaj)
  return ACCES.slice(i, ACCES.indexOf('$f$;', i) + 4).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION')
}
const DREPTURI_ACCES = [
  'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(',
  'CREATE FUNCTION public.fn_executie_acces_nerestrans()', 'CREATE FUNCTION public.fn_executie_acces_lista(',
  'CREATE FUNCTION public.fn_executie_proiect_permis(', 'CREATE FUNCTION public.fn_executie_acces_garda()',
].map(functie).join('\n') + `
REVOKE ALL ON FUNCTION public.fn_executie_acces_nerestrans_cont(uuid), public.fn_executie_acces_lista_cont(uuid, boolean),
  public.fn_executie_acces_nerestrans(), public.fn_executie_acces_lista(boolean), public.fn_executie_proiect_permis(bigint, boolean),
  public.fn_executie_acces_garda() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_nerestrans(), public.fn_executie_proiect_permis(bigint, boolean) TO authenticated;`
const PARTE2 = '-- >>> DUPA_FUNCTII_EXECUTIE'
if (!SCHELET.includes(PARTE2)) { console.error('scheletul nu are marcajul ' + PARTE2); process.exit(1) }
const [SCHELET_1, SCHELET_2] = [SCHELET.slice(0, SCHELET.indexOf(PARTE2)), SCHELET.slice(SCHELET.indexOf(PARTE2))]

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
// corpul RPC-ului din textul migrării + amprenta lui (la mutanții pe corp, amprenta „după” se pune pe corpul mutat)
const corpFn = (t) => { const i = t.indexOf('CREATE FUNCTION public.fn_sites_creeaza('), a = t.indexOf('AS $f$', i) + 6; return t.slice(a, t.indexOf('$f$;', a)) }
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
  TIT_R: '00000000-0000-0000-0000-0000000000b7', STRAIN: '00000000-0000-0000-0000-0000000000b8', TIT_FARA_EX: '00000000-0000-0000-0000-0000000000b9',
  TIT_EX_VIEW: '00000000-0000-0000-0000-0000000000ba',
}
// proiectele: 1 / 2 / 3 fără șantier (3 = absent din lista contului restrâns), 4 = legat de un șantier existent al ALTUI proiect (refuz)
const DATE = `
INSERT INTO public.profiles (id, name, role, is_owner, can_manage_contracts) VALUES
  ('${U.OWNER}', 'OWNER', 'admin', true, true), ('${U.TIT}', 'TITULAR', 'manager_santier', false, true),
  ('${U.TIT_ADM}', 'TITULAR ADMIN', 'manager_santier', false, false), ('${U.TIT_VIEW}', 'TITULAR VIEWER', 'manager_santier', false, false),
  ('${U.CONTR}', 'CONTRACTE FARA DREPT', 'manager_santier', false, true), ('${U.LOC}', 'LOCATII', 'administrativ', false, false),
  ('${U.TIT_R}', 'TITULAR RESTRANS', 'inginer', false, false), ('${U.STRAIN}', 'STRAIN', 'angajat', false, false),
  ('${U.TIT_FARA_EX}', 'TITULAR FARA EXECUTIE', 'inginer', false, false), ('${U.TIT_EX_VIEW}', 'TITULAR EXECUTIE VIEWER', 'inginer', false, false);
INSERT INTO public.executie_proiecte (id, nume, cod_intern) VALUES (1, 'Proiect A', 'PA'), (2, 'Proiect B', 'PB'), (3, 'Proiect C', 'PC'), (4, 'Proiect D', 'PD');
INSERT INTO public.sites (name, active, proiect_id) VALUES ('Sediu central', true, NULL), ('Sediu vechi', true, NULL);
UPDATE public.executie_proiecte SET site_id = (SELECT id FROM public.sites WHERE name = 'Sediu vechi') WHERE id = 4;
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${U.TIT_R}', 1, 'editor'), ('${U.TIT_R}', 2, 'viewer');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.LOC}', 'administrativ.locatii', 'editor'), ('${U.LOC}', 'executie', 'editor'), ('${U.CONTR}', 'executie', 'editor'), ('${U.TIT}', 'executie', 'editor'),
  ('${U.TIT_ADM}', 'executie', 'admin'), ('${U.TIT_VIEW}', 'executie', 'editor'), ('${U.TIT_R}', 'executie', 'editor'),
  ('${U.TIT_EX_VIEW}', 'executie', 'viewer');`
// dreptul îl acordă coordonatorul DUPĂ migrare (cheia există doar după ea) — aici, ca postgres
const ACORDA = `INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.TIT}', 'santiere_creare', 'editor'), ('${U.TIT_ADM}', 'santiere_creare', 'admin'), ('${U.TIT_VIEW}', 'santiere_creare', 'viewer'),
  ('${U.TIT_R}', 'santiere_creare', 'editor'), ('${U.TIT_FARA_EX}', 'santiere_creare', 'editor'), ('${U.TIT_EX_VIEW}', 'santiere_creare', 'editor');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET_1)
  await db.exec(DREPTURI_ACCES)
  await db.exec(SCHELET_2)
  await db.exec(DATE)
  return db
}

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── 0. fidelitatea schemei ──
console.log('0. fidelitatea schemei: corpurile din producție, baseline-ul L15')
const BAZA0 = await bazaNoua()
for (const [fn, h] of Object.entries(MD5_PRODUCTIE)) {
  const r = (await BAZA0.query(`SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.${fn}')`)).rows[0]
  ok(r?.h === h, `${fn}: corpul din schelet = cel din producție (md5 ${r?.h})`)
}
const B0 = await baseline(BAZA0)
await BAZA0.close()
// închiderea + tabelul, pe schema falsă = EXACT ce e scris de mână (sites + pornirea + lanțul din 20261209a + funcțiile triggerelor lui sites)
const ETICHETE = ['functie auth.uid()', 'functie fn_auto_create_executie_proiect()', 'functie fn_executie_acces_lista(boolean)',
  'functie fn_executie_acces_lista_cont(uuid,boolean)', 'functie fn_executie_acces_nerestrans()', 'functie fn_executie_acces_nerestrans_cont(uuid)',
  'functie fn_executie_proiect_permis(bigint,boolean)', 'functie fn_schelet_sites_mutat()', 'functie fn_site_name_to_cod_intern(text)',
  'tabel sites | acl', 'tabel sites | acl coloane', 'tabel sites | politici', 'tabel sites | rls', 'tabel sites | secvente', 'tabel sites | triggere']
ok(JSON.stringify(B0.map(r => r.eticheta)) === JSON.stringify(ETICHETE), 'baseline: etichetele așteptate — ' + B0.map(r => r.eticheta).join('; '))
const linii = (rows) => rows.map((r, i) => (i === 0 ? '    ' : '  , ') + r.linie_baseline.replace(/^\s*,?\s*/, ''))
const cuBaseline = (text, rows) => aplica(text, [[PLACEHOLDER, linii(rows).join('\n')]])
const MIG_B = cuBaseline(MIG, B0)

// ── tranzacții ca un rol, cu JWT-ul contului (ambele surse ale lui auth.uid()) ──
async function tx(db, { rol = null, uid = null, commit = false } = {}, fn) {
  await db.exec('BEGIN')
  try {
    if (rol) await db.exec(`SET LOCAL ROLE ${rol}`)
    if (uid) {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid])
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: rol || 'authenticated' })])
    }
    const out = await fn({ q: (s, p) => db.query(s, p), sudo: () => db.exec('RESET ROLE') })
    await db.exec(commit ? 'COMMIT' : 'ROLLBACK')
    return out
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e }
}
// rulează ca un rol; întoarce { rows } sau { code, message }
async function ca(db, rol, uid, sql, params) {
  try { return { rows: await tx(db, { rol, uid }, ({ q }) => q(sql, params).then(r => r.rows)) } }
  catch (e) { return { code: e.code, message: e.message } }
}
const RPC = `SELECT public.fn_sites_creeaza($1, $2, $3) AS r`
const numara = async (q) => (await q(`SELECT (SELECT count(*)::int FROM public.sites) AS s, (SELECT count(*)::int FROM public.executie_proiecte) AS p`)).rows[0]
const randSite = async (q, id) => (await q(`SELECT * FROM public.sites WHERE id = $1`, [id])).rows[0]
const proiecteSite = async (q, id) => (await q(`SELECT id, beneficiar FROM public.executie_proiecte WHERE site_id = $1 ORDER BY id`, [id])).rows.map(r => ({ id: Number(r.id), beneficiar: r.beneficiar }))
// valorile implicite ale coloanelor administrative (citite din producție: tip / implicit) — ce TREBUIE să rămână după RPC
const IMPLICITE = { contract_id: null, aliases: [], denumire_qr: null, raport_zilnic_necesar: true, tip_locatie: 'santier', adresa: null,
  este_inchiriat: false, lat: null, lng: null, localitate_meteo: null, meteo_activ: true, active: true }

// un apel RPC ca un cont, cu verificările de stare în ACEEAȘI tranzacție (ca postgres, după RESET ROLE); întoarce lista abaterilor
async function cazRpc(db, cont, proiect, astept, { nume = 'Gazpet - Santier nou', benef = 'Beneficiar SA', rol = 'authenticated' } = {}) {
  const ce = `${cont ?? 'fără JWT'} (${rol}) proiect ${proiect}`
  const ab = []
  try {
    await tx(db, { rol, uid: cont ? U[cont] : null }, async ({ q, sudo }) => {
      const r = (await q(RPC, [nume, proiect, benef])).rows[0].r
      await sudo()
      if (astept !== 'ok') { ab.push(`${ce}: a trecut ${JSON.stringify(r)} (aștepta ${astept})`); return }
      const n0 = await numara(q)
      if (!(Number.isSafeInteger(r?.site_id) && r.site_id > 0 && r.creat === true)) ab.push(`${ce}: răspuns ${JSON.stringify(r)}`)
      const s = await randSite(q, r.site_id)
      if (!s || s.name !== nume.trim() || s.beneficiar_principal !== benef) ab.push(`${ce}: rândul ${JSON.stringify(s)}`)
      for (const [k, v] of Object.entries(IMPLICITE)) if (JSON.stringify(s?.[k]) !== JSON.stringify(v)) ab.push(`${ce}: ${k} = ${JSON.stringify(s?.[k])} (aștepta ${JSON.stringify(v)})`)
      const leg = await proiecteSite(q, r.site_id)
      if (proiect != null) {
        if (Number(s?.proiect_id) !== proiect) ab.push(`${ce}: sites.proiect_id = ${s?.proiect_id}`)
        if (leg.length !== 1 || leg[0].id !== proiect) ab.push(`${ce}: proiectele pe șantier ${JSON.stringify(leg)} (aștepta exact [${proiect}], fără proiect automat)`)
        if (n0.p !== 4) ab.push(`${ce}: ${n0.p} proiecte (aștepta 4: niciun proiect automat)`)
      } else {
        // fără proiect = ca INSERT-ul owner-ului de azi: triggerul real creează proiectul automat (beneficiar NULL)
        if (s?.proiect_id != null || leg.length !== 1 || leg[0].beneficiar !== null || n0.p !== 5) ab.push(`${ce}: proiectul automat ${JSON.stringify({ leg, p: n0.p, proiect_id: s?.proiect_id })}`)
      }
    })
  } catch (e) {
    if (astept === 'ok') ab.push(`${ce}: ${e.code} ${e.message}`)
    else if (e.code !== astept) ab.push(`${ce}: ${e.code} ${e.message} (aștepta ${astept})`)
  }
  return ab
}

// ── 1. verificările pe BD după migrare: întoarce lista abaterilor (gol = totul ca în cerere) ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce, re) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  // migrarea nu acordă nimic: înainte de acordare titularul e refuzat; owner-ul poate deja
  ab.push(...await cazRpc(db, 'TIT', 1, '42501'))
  ab.push(...await cazRpc(db, 'OWNER', 1, 'ok'))
  await db.exec(ACORDA)
  for (const [cont, proiect, astept] of [
    ['OWNER', null, 'ok'], ['OWNER', 2, 'ok'],
    ['TIT', null, 'ok'], ['TIT', 1, 'ok'], ['TIT', 2, 'ok'], ['TIT', 3, 'ok'], ['TIT_ADM', 3, 'ok'],
    ['TIT_VIEW', null, '42501'], ['TIT_VIEW', 1, '42501'], ['CONTR', null, '42501'], ['CONTR', 1, '42501'], ['LOC', null, '42501'],
    ['STRAIN', 1, '42501'], ['TIT_FARA_EX', 1, '42501'], ['TIT_FARA_EX', null, '42501'], ['TIT_EX_VIEW', 1, '42501'],
    // contul restrâns: proiectul din lista lui de scriere da; cel doar de citire nu; cel ABSENT din listă nu; fără proiect nu (doar nerestrânsul)
    ['TIT_R', 1, 'ok'], ['TIT_R', 2, '42501'], ['TIT_R', 3, '42501'], ['TIT_R', null, '42501'],
    // refuzuri de reguli (contul are dreptul): proiect inexistent, proiect legat de ALT șantier
    ['TIT', 999999, 'P0002'], ['TIT', 4, 'P0001'],
  ]) ab.push(...await cazRpc(db, cont, proiect, astept))
  ab.push(...await cazRpc(db, 'TIT', 1, '22023', { nume: '   ' }))
  ab.push(...await cazRpc(db, null, 1, '42501'))
  ab.push(...await cazRpc(db, null, null, '42501'))
  ab.push(...await cazRpc(db, 'TIT', 1, '42501', { rol: 'anon' }))
  ab.push(...await cazRpc(db, null, 1, '42501', { rol: 'service_role' }))
  asteptCod(await ca(db, 'anon', U.TIT, RPC, ['x', 1, null]), '42501', 'anon cheamă RPC-ul', /permission denied for function/)
  // ce scrie: semnătura are DOAR nume / proiect / beneficiar — un parametru administrativ în plus nu există (42883)
  asteptCod(await ca(db, 'authenticated', U.TIT, `SELECT public.fn_sites_creeaza(p_nume => 'x', p_proiect => 1, p_beneficiar => NULL, p_meteo_activ => true)`), '42883', 'RPC cu parametru meteo în plus')
  // căile directe: contul cu drept NU are INSERT direct (cu sau fără coloane administrative); UPDATE / DELETE rămân ale owner-ului
  asteptCod(await ca(db, 'authenticated', U.TIT, `INSERT INTO public.sites (name, active, proiect_id, meteo_activ, lat, lng, contract_id, tip_locatie)
    VALUES ('Direct', true, 1, true, 44.9, 26.0, NULL, 'depozit') RETURNING id`), '42501', 'INSERT direct cu coloane administrative (titular)', /row-level security/)
  asteptCod(await ca(db, 'authenticated', U.TIT, `INSERT INTO public.sites (name, active) VALUES ('Direct', true) RETURNING id`), '42501', 'INSERT direct doar cu nume (titular)', /row-level security/)
  const o = await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.sites (name, active) VALUES ('Sediu nou owner', true) RETURNING id`)
  if (o.code || o.rows.length !== 1) ab.push(`INSERT direct owner: ${JSON.stringify(o)}`)
  for (const [ce, sql] of [['U redenumire', `UPDATE public.sites SET name = 'Sediu alt nume' WHERE name = 'Sediu central' RETURNING id`],
                           ['U legare de proiect', `UPDATE public.sites SET proiect_id = 2 WHERE name = 'Sediu central' RETURNING id`],
                           ['U meteo', `UPDATE public.sites SET meteo_activ = false WHERE name = 'Sediu central' RETURNING id`],
                           ['D ștergere', `DELETE FROM public.sites WHERE name = 'Sediu central' RETURNING id`]]) {
    const r = await ca(db, 'authenticated', U.TIT, sql)
    if (r.code || r.rows.length !== 0) ab.push(`${ce} ca titular: ${JSON.stringify(r)} (aștepta 0 rânduri)`)
    const w = await ca(db, 'authenticated', U.OWNER, sql)
    if (w.code || w.rows.length !== 1) ab.push(`${ce} ca owner: ${JSON.stringify(w)} (aștepta 1 rând)`)
  }
  // idempotent pe proiect: al doilea apel întoarce ACELAȘI șantier, creat = false, fără rând nou
  try {
    await tx(db, { rol: 'authenticated', uid: U.TIT }, async ({ q, sudo }) => {
      const r1 = (await q(RPC, ['Gazpet - Idem', 1, null])).rows[0].r
      const r2 = (await q(RPC, ['Gazpet - Idem', 1, null])).rows[0].r
      await sudo()
      const n = await numara(q)
      if (r1.creat !== true || r2.creat !== false || r2.site_id !== r1.site_id || n.s !== 3 || n.p !== 4) ab.push(`idempotență: ${JSON.stringify({ r1, r2, n })}`)
    })
  } catch (e) { ab.push('idempotență: ' + e.message) }
  // dreptul retras = refuz imediat (nimic ținut minte)
  await db.exec(`DELETE FROM public.user_module_access WHERE profile_id = '${U.TIT}' AND module = 'santiere_creare'`)
  ab.push(...await cazRpc(db, 'TIT', 1, '42501'))
  await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.TIT}', 'santiere_creare', 'editor')`)
  // postcondiția RPC-ului: un trigger de proiect automat SCHIMBAT (fără „nu dubla”) nu poate dubla în tăcere — refuz, nimic scris
  try {
    await tx(db, {}, async ({ q }) => {
      await q(`CREATE OR REPLACE FUNCTION public.fn_auto_create_executie_proiect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
        BEGIN INSERT INTO executie_proiecte (cod_intern, nume, beneficiar, site_id, activ) VALUES ('AUTO_' || NEW.id, upper(NEW.name), NULL, NEW.id, true); RETURN NEW; END $f$`)
      await q('SAVEPOINT s')
      await q(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [U.TIT])
      await q('SET LOCAL ROLE authenticated')
      let cod = null
      try { await q(RPC, ['Gazpet - Trigger schimbat', 1, null]) } catch (e) { cod = e.code + ' ' + e.message }
      await q('ROLLBACK TO SAVEPOINT s')
      if (!/^P0001 .*nu e unică/.test(cod || '')) ab.push(`postcondiția RPC la trigger schimbat: ${cod || 'a trecut'}`)
    })
  } catch (e) { ab.push('postcondiția RPC: ' + e.message) }
  return ab
}

// ── 2. fluxul COMPLET al wizard-ului prin codul JS real, peste un adaptor tip PostgREST (fiecare cerere = tranzacția ei, COMISĂ) ──
async function importJs(sursa) {
  const d = mkdtempSync(join(tmpdir(), 'santiere-js-'))
  const f = join(d, 'santiereDrept.mjs')
  writeFileSync(f, sursa, 'utf8')
  try { return await import(pathToFileURL(f).href + '?v=' + md5(sursa)) } finally { rmSync(d, { recursive: true, force: true }) }
}
function client(db, uid, { defect = {} } = {}) {
  const nr = { rpc: 0, citire: 0 }
  const run = async (sql, params) => {
    try { return { rows: await tx(db, { rol: 'authenticated', uid, commit: true }, ({ q }) => q(sql, params).then(r => r.rows)) } }
    // PostgREST: funcția lipsă din cache = PGRST202; restul = SQLSTATE-ul din bază
    catch (e) { return { error: { code: e.code === '42883' ? 'PGRST202' : e.code, message: e.message } } }
  }
  const retea = { data: null, error: { message: 'TypeError: Failed to fetch' } }
  return {
    rpc: async (fn, args) => {
      nr.rpc++
      // o schimbare COMISĂ (ca postgres) între apeluri: dreptul retras, funcția scoasă (revenirea) — runda 3, P2-1
      if (defect.intre?.[nr.rpc]) await db.exec(defect.intre[nr.rpc])
      if (defect.inainte?.includes(nr.rpc)) return retea
      const r = await run(`SELECT public.${fn}(p_nume => $1, p_proiect => $2, p_beneficiar => $3) AS r`, [args.p_nume, args.p_proiect, args.p_beneficiar])
      if (defect.dupa?.includes(nr.rpc)) return retea
      if (defect.gol?.includes(nr.rpc)) return { data: null, error: null }
      return r.error ? { data: null, error: r.error } : { data: r.rows[0].r, error: null }
    },
    from: (t) => ({
      insert: (obj) => ({ select: (cols) => ({ single: async () => {
        const k = Object.keys(obj)
        const r = await run(`INSERT INTO public.${t} (${k.join(', ')}) VALUES (${k.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING ${cols}`, k.map(x => obj[x]))
        if (r.error) return { data: null, error: r.error }
        return r.rows.length === 1 ? { data: r.rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: r.rows.length + ' rânduri' } }
      } }) }),
      select: (cols) => ({ eq: (c, v) => ({ maybeSingle: async () => {
        nr.citire++
        if (defect.citire?.includes(nr.citire)) return retea
        const r = await run(`SELECT ${cols} FROM public.${t} WHERE ${c} = $1`, [v])
        return r.error ? { data: null, error: r.error } : { data: r.rows[0] ?? null, error: null }
      } }) }),
    }),
  }
}
// pașii wizard-ului (src/ProiectNouWizard.jsx, creeaza): 1. INSERT proiect … select('id').single(); 2. creeazaSantier(proiect.id) → mesajSantier
async function wizard(js, db, uid, { defect, numeProiect = 'Proiect Wizard' } = {}) {
  const c = client(db, uid, { defect })
  const { data: proiect, error } = await c.from('executie_proiecte').insert({ nume: numeProiect, cod_intern: 'PW', beneficiar: 'Beneficiar SA', site_id: null, activ: true }).select('id').single()
  if (error) return { eroareProiect: error }
  const r = await js.creeazaSantier(c, { nume: 'Gazpet - ' + numeProiect, proiectId: Number(proiect.id), beneficiar: 'Beneficiar SA' })
  return { proiect: Number(proiect.id), r, m: js.mesajSantier(r, { cuProiect: true }) }
}
async function stareWizard(db, proiect) {
  return tx(db, {}, async ({ q }) => {
    const p = (await q(`SELECT site_id FROM public.executie_proiecte WHERE id = $1`, [proiect])).rows[0]
    const s = (await q(`SELECT id, proiect_id FROM public.sites WHERE name = 'Gazpet - Proiect Wizard'`)).rows
    const n = await numara(q)
    return { site_id: p?.site_id == null ? null : Number(p.site_id), santiere: s.map(x => ({ id: Number(x.id), proiect_id: x.proiect_id == null ? null : Number(x.proiect_id) })), ...n }
  })
}
// schimbările dintre cele două apeluri (comise, ca postgres): dreptul titularului retras; funcția scoasă (ca după o revenire)
const RETRAGE_TIT = `DELETE FROM public.user_module_access WHERE profile_id = '${U.TIT}' AND module = 'santiere_creare';`
const SCOATE_RPC = 'DROP FUNCTION public.fn_sites_creeaza(text, bigint, text);'
// scenariile: [nume, cont, migrare aplicată?, drept acordat?, defect, așteptarea]; „bun” = un șantier, legat în ambele sensuri, 5 proiecte (fără automat)
// faraSantier: true = mesajul TREBUIE să spună „Proiectul s-a creat fără șantier”; false = NU are voie să o spună (starea nu e dovedită)
const SCEN_W = [
  ['W1 cont cu drept', 'TIT', true, true, {}, { tip: 'ok', creat: true, legat: true }],
  ['W2 owner', 'OWNER', true, false, {}, { tip: 'ok', creat: true, legat: true }],
  ['W3 răspuns pierdut DUPĂ commit → reconciliere din BD', 'TIT', true, true, { dupa: [1] }, { tip: 'ok', verificat: true, legat: true }],
  ['W4 rețea picată ÎNAINTE → reîncercare', 'TIT', true, true, { inainte: [1] }, { tip: 'ok', creat: true, legat: true }],
  ['W5 răspuns pierdut + citirea picată → reîncercare idempotentă', 'TIT', true, true, { dupa: [1], citire: [1] }, { tip: 'ok', creat: false, legat: true }],
  ['W6 migrarea NEAPLICATĂ (UI nouă), owner', 'OWNER', false, false, {}, { tip: 'indisponibil', legat: false }],
  ['W7 cont fără drept (opțiunea ascunsă, cererea forțată)', 'CONTR', true, true, {}, { tip: 'refuz', legat: false }],
  ['W8 răspuns pierdut de două ori, fără citire → necunoscut, nu succes', 'TIT', true, true, { inainte: [1, 2], citire: [1, 2] }, { tip: 'necunoscut', legat: false }],
  ['W12 răspuns gol (fără id) de două ori, fără citire → necunoscut, nu succes', 'TIT', true, true, { gol: [1, 2], citire: [1, 2] }, { tip: 'necunoscut', legat: true }],
  // runda 3 (Jakarinos r2, P2-1): eșecul determinat al reîncercării după un prim apel ambiguu; decide reconcilierea finală din BD
  ['W13 scenariul Jak: COMMIT + răspuns pierdut, recitirea picată, dreptul retras → 42501, recitirea finală picată → necunoscut', 'TIT', true, true,
    { dupa: [1], citire: [1, 2], intre: { 2: RETRAGE_TIT } }, { tip: 'necunoscut', legat: true, faraSantier: false }],
  ['W14 ca W13, recitirea finală merge → ok verificat (șantierul primului apel)', 'TIT', true, true,
    { dupa: [1], citire: [1], intre: { 2: RETRAGE_TIT } }, { tip: 'ok', verificat: true, legat: true }],
  ['W15 COMMIT + răspuns pierdut, funcția scoasă între apeluri → PGRST202, recitirea finală picată → necunoscut', 'TIT', true, true,
    { dupa: [1], citire: [1, 2], intre: { 2: SCOATE_RPC } }, { tip: 'necunoscut', legat: true, faraSantier: false }],
  ['W16 rețea picată ÎNAINTE (nimic scris), recitirea picată, dreptul retras → 42501, recitirea finală: nelegat → refuz verificat', 'TIT', true, true,
    { inainte: [1], citire: [1], intre: { 2: RETRAGE_TIT } }, { tip: 'refuz', verificat: true, legat: false, faraSantier: true }],
  ['W17 rețea picată ÎNAINTE, funcția scoasă între apeluri, recitirea finală: nelegat → indisponibil verificat', 'TIT', true, true,
    { inainte: [1], citire: [1], intre: { 2: SCOATE_RPC } }, { tip: 'indisponibil', verificat: true, legat: false, faraSantier: true }],
]
async function ruleazaWizard(js, [nume, cont, migrare, drept, defect, a]) {
  const db = await bazaNoua()
  try {
    if (migrare) await aplicaMig(db, MIG_B)
    if (drept) await db.exec(ACORDA)
    const w = await wizard(js, db, U[cont], { defect })
    if (w.eroareProiect) return `${nume}: proiectul n-a putut fi creat: ${w.eroareProiect.code} ${w.eroareProiect.message}`
    const st = await stareWizard(db, w.proiect)
    const ab = []
    if (w.r.tip !== a.tip) ab.push(`tip ${w.r.tip} (aștepta ${a.tip}; ${w.r.motiv || w.r.mesaj || ''})`)
    if ('creat' in a && w.r.creat !== a.creat) ab.push(`creat ${w.r.creat}`)
    if ('verificat' in a && w.r.verificat !== a.verificat) ab.push(`verificat ${w.r.verificat}`)
    if (w.m.ok !== (a.tip === 'ok')) ab.push(`mesaj ok=${w.m.ok}: ${w.m.text}`)
    if ('faraSantier' in a && /Proiectul s-a creat fără șantier/.test(w.m.text) !== a.faraSantier) ab.push(`mesaj „fără șantier” ${!a.faraSantier ? 'NEDOVEDIT' : 'lipsă'}: ${w.m.text}`)
    if (a.legat) {
      if (st.santiere.length !== 1 || st.site_id !== st.santiere[0].id || st.santiere[0].proiect_id !== w.proiect || st.p !== 5) ab.push('stare ' + JSON.stringify(st))
    } else if (st.santiere.length !== 0 || st.site_id !== null || st.p !== 5) ab.push('stare (aștepta proiect fără șantier) ' + JSON.stringify(st))
    return ab.length ? `${nume}: ${ab.join('; ')}` : null
  } finally { await db.close() }
}
// UI VECHE (origin/main, src/ProiectNouWizard.jsx înainte de PR): 1. INSERT sites (name, active, beneficiar_principal) → id; 2. INSERT proiect cu
// site_id; 3. UPDATE sites SET proiect_id. Mesajele vechi: eroare la 1 = „⚠️ șantierul NU s-a creat”; 3 fără eroare = „🏗️ șantier nou creat”.
async function uiVeche(db, uid) {
  const c = client(db, uid)
  const s = await c.from('sites').insert({ name: 'Gazpet - Proiect Vechi', active: true, beneficiar_principal: 'Beneficiar SA' }).select('id').single()
  const p = await c.from('executie_proiecte').insert({ nume: 'Proiect Vechi', cod_intern: 'PV', site_id: s.data ? Number(s.data.id) : null, activ: true }).select('id').single()
  return { pasSantier: s.error ? `⚠️ șantierul NU s-a creat (${s.error.message})` : 'continuă cu UPDATE sites', santier: s, proiect: p }
}

// ── rularea ──
const JS = await importJs(JS_SURSA)
console.log('1. migrarea aplicată (baseline pe schema falsă) + verificările pe BD')
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

console.log('2. fluxul complet al wizard-ului (cod JS real + adaptor PostgREST) și combinațiile de livrare')
for (const s of SCEN_W) { const r = await ruleazaWizard(JS, s); ok(r == null, r || s[0]) }
{
  // cont restrâns: RLS-ul REAL pe executie_proiecte refuză proiectul nou (nu e în lista lui) → wizard-ul se oprește la proiect, nimic creat
  const db = await bazaNoua(); await aplicaMig(db, MIG_B); await db.exec(ACORDA)
  const w = await wizard(JS, db, U.TIT_R)
  const n = await tx(db, {}, ({ q }) => numara(q))
  ok(w.eroareProiect?.code === '42501' && n.s === 2 && n.p === 4, `W9 cont restrâns: proiectul nou refuzat de RLS (${w.eroareProiect?.code}), nimic creat`)
  // UI VECHE + migrarea aplicată + dreptul acordat: INSERT-ul direct e refuzat la pasul 1 → mesajul vechi de eșec, NU un fals succes;
  // UPDATE-ul vechi (pasul 3, care ar fi întors 0 rânduri fără eroare) nu mai e atins
  const v = await uiVeche(db, U.TIT)
  const n2 = await tx(db, {}, ({ q }) => numara(q))
  ok(v.santier.error?.code === '42501' && /NU s-a creat/.test(v.pasSantier) && n2.s === 2, `W10 UI veche + migrare + drept: șantierul refuzat la INSERT (${v.santier.error?.code}), mesaj de eșec, niciun șantier`)
  await db.close()
}
{
  // owner, UI VECHE: comportamentul de azi (dublarea veche: proiectul automat + proiectul wizard-ului) e ACELAȘI înainte și după migrare —
  // migrarea nu schimbă calea veche; dublarea dispare doar cu UI nouă (de aceea: merge = UI nouă înainte de acordarea dreptului)
  const rez = []
  for (const migrare of [false, true]) {
    const db = await bazaNoua(); if (migrare) await aplicaMig(db, MIG_B)
    const v = await uiVeche(db, U.OWNER)
    const leg = await tx(db, {}, ({ q }) => proiecteSite(q, Number(v.santier.data?.id)))
    rez.push(leg.length); await db.close()
  }
  ok(rez[0] === 2 && rez[1] === 2, `W11 owner + UI veche: ${rez[0]} proiecte pe șantier fără migrare, ${rez[1]} cu migrare (aceeași cale veche, neschimbată)`)
}

console.log('3. paritatea regulii de cont: interfața (poateCreaSantier) = BD-ul (RPC pe un proiect nerestrâns)')
{
  const db = await bazaNoua(); await aplicaMig(db, MIG_B); await db.exec(ACORDA)
  const dif = []
  for (const cont of Object.keys(U)) {
    const prof = await tx(db, {}, async ({ q }) => {
      const p = (await q(`SELECT is_owner FROM public.profiles WHERE id = $1`, [U[cont]])).rows[0]
      const ma = (await q(`SELECT module, access_level FROM public.user_module_access WHERE profile_id = $1`, [U[cont]])).rows
      return { is_owner: p.is_owner, module_access_levels: Object.fromEntries(ma.map(x => [x.module, x.access_level])) }   // ca App.jsx (profilul)
    })
    const ui = JS.poateCreaSantier(prof)
    const bd = (await ca(db, 'authenticated', U[cont], RPC, ['Gazpet - Paritate', 1, null])).rows != null
    if (ui !== bd) dif.push(`${cont}: UI ${ui}, BD ${bd}`)
  }
  ok(dif.length === 0, `paritate pe ${Object.keys(U).length} conturi ${dif.join('; ')}`)
  await db.close()
}

// ── 4. refuzurile migrării ──
console.log('4. refuzurile migrării')
const gol = async (db) => (await db.query(`SELECT to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') AS gol`)).rows[0].gol
const AUTO_SCHIMBAT = `CREATE OR REPLACE FUNCTION public.fn_auto_create_executie_proiect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$ BEGIN RETURN NEW; END $function$;`
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', (db) => aplicaMig(db, MIG_B, { marcaj: false }), /garda start invalida/],
  ['fără plafon', (db) => aplicaMig(db, MIG_B, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcaj', (db) => aplicaMig(db, MIG_B, { marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['baseline necompletat', (db) => aplicaMig(db, MIG_NECOMPLETAT), /baseline L15 necompletat/],
  ['politică nouă pe sites după baseline', async (db) => { await db.exec(`CREATE POLICY zz_insert_toti ON public.sites FOR INSERT TO authenticated WITH CHECK (true);`); return aplicaMig(db, MIG_B) },
    /starea de acces \(inainte\) difera de baseline-ul L15 revizuit: tabel sites \| politici/],
  ['drept nou pe sites după baseline', async (db) => { await db.exec(`GRANT SELECT ON public.sites TO PUBLIC;`); return aplicaMig(db, MIG_B) }, /difera de baseline-ul L15 revizuit: tabel sites \| acl/],
  ['dependență schimbată după baseline', async (db) => {
    await db.exec(functie('CREATE FUNCTION public.fn_executie_proiect_permis(').replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION').replace('SELECT p_scriere IS NOT NULL', 'SELECT true OR p_scriere IS NOT NULL'))
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15 revizuit: functie fn_executie_proiect_permis/],
  ['corpul triggerului de proiect automat schimbat după baseline', async (db) => { await db.exec(AUTO_SCHIMBAT); return aplicaMig(db, MIG_B) },
    /difera de baseline-ul L15 revizuit: functie fn_auto_create_executie_proiect/],
  ['triggerul de proiect automat dezactivat', async (db) => { await db.exec(`ALTER TABLE public.sites DISABLE TRIGGER tr_auto_create_executie_proiect;`); return aplicaMig(db, MIG_B) },
    /triggerul tr_auto_create_executie_proiect nu e cel asteptat/],
  ['triggerul de proiect automat cu WHEN', async (db) => {
    await db.exec(`DROP TRIGGER tr_auto_create_executie_proiect ON public.sites; CREATE TRIGGER tr_auto_create_executie_proiect AFTER INSERT ON public.sites FOR EACH ROW WHEN (NEW.active) EXECUTE FUNCTION public.fn_auto_create_executie_proiect();`)
    return aplicaMig(db, MIG_B)
  }, /triggerul tr_auto_create_executie_proiect nu e cel asteptat/],
  ['cheie străină pe executie_proiecte.site_id (ordinea din RPC n-ar mai merge)', async (db) => {
    await db.exec(`ALTER TABLE public.executie_proiecte ADD CONSTRAINT zz_fk_site FOREIGN KEY (site_id) REFERENCES public.sites(id);`)
    return aplicaMig(db, MIG_B)
  }, /executie_proiecte.site_id are cheie straina/],
  ['cheia există deja (reaplicare parțială)', async (db) => { await db.exec(`INSERT INTO public.app_modules (key, name) VALUES ('santiere_creare', 'x');`); return aplicaMig(db, MIG_B) }, /reaplicare/],
  ['o supraîncărcare a RPC-ului există deja', async (db) => { await db.exec(`CREATE FUNCTION public.fn_sites_creeaza(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;`); return aplicaMig(db, MIG_B) }, /reaplicare/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  // nimic schimbat de migrare: RPC-ul (semnătura nouă) lipsește, iar cheia de modul e cum a lăsat-o pregătirea (lipsă, sau rândul pus de test)
  const g = (await db.query(`SELECT to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NULL
     AND (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare' AND name = 'Creare șantiere') = 0 AS g`)).rows[0].g
  ok(re.test(m || '') && g, `${nume}: ${m}`)
  await db.close()
}
console.log('4b. L15: schimbarea între „înainte” și „după”')
const INTRE = (sql) => [['-- ── punctul UNIC de blocare (L06)', sql + '\n-- ── punctul UNIC de blocare (L06)']]
const PERMIS_LARG = functie('CREATE FUNCTION public.fn_executie_proiect_permis(').replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION')
  .replace('SELECT p_scriere IS NOT NULL', 'SELECT true OR p_scriere IS NOT NULL')
const SCEN_L15 = [
  ['funcție din lanț schimbată între verificări', INTRE(PERMIS_LARG), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: functie fn_executie_proiect_permis/],
  ['altă politică adăugată între verificări', INTRE('CREATE POLICY zz_upd ON public.sites FOR UPDATE TO authenticated USING (true);'), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: tabel sites \| politici/],
  ['drept pe tabel schimbat între verificări', INTRE('REVOKE TRUNCATE ON public.sites FROM anon;'), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: tabel sites \| acl/],
  ['trigger nou între verificări', INTRE('CREATE TRIGGER zz_t AFTER INSERT ON public.sites FOR EACH ROW EXECUTE FUNCTION public.fn_schelet_sites_mutat();'), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: tabel sites \| triggere/],
  ['triggerul de proiect automat schimbat între verificări', INTRE(AUTO_SCHIMBAT), /starea de acces \(dupa\) difera de baseline-ul L15 revizuit: functie fn_auto_create_executie_proiect/],
]
for (const [nume, mut, re] of SCEN_L15) {
  const db = await bazaNoua()
  let m = null; try { await aplicaMig(db, aplica(MIG_B, mut)) } catch (e) { m = e.message }
  ok(re.test(m || '') && await gol(db), `${nume}: ${m || 'NU a refuzat'}`)
  await db.close()
}
console.log('   mutanții porții L15 (originalul refuză, mutantul trece = verificarea e necesară)')
for (const [nume, scen, mutPoarta] of [
  ['L1 fără verificarea „după”', SCEN_L15[1][1], [["  PERFORM pg_temp.amp_verifica_20261222a('dupa');\n", '']]],
  ['L2 restul „după” necomparat', SCEN_L15[2][1], [['  IF v_dif IS NOT NULL THEN', '  IF p_moment = \'inainte\' AND v_dif IS NOT NULL THEN']]],
  ['L3 detaliul funcției noi necomparat', [[`COMMENT ON FUNCTION public.fn_sites_creeaza(text, bigint, text) IS`,
    `ALTER FUNCTION public.fn_sites_creeaza(text, bigint, text) STRICT;\nCOMMENT ON FUNCTION public.fn_sites_creeaza(text, bigint, text) IS`]],
    [["    IF v_fn IS DISTINCT FROM 'tip=f", "    IF false AND v_fn IS DISTINCT FROM 'tip=f"]]],
]) {
  const rul = async (extra) => { const db = await bazaNoua(); try { await aplicaMig(db, aplica(MIG_B, [...scen, ...extra])); return null } catch (e) { return e.message } finally { await db.close() } }
  const mOrig = await rul([]), mMut = await rul(mutPoarta)
  ok(mOrig != null && mMut == null, `${nume}: originalul refuză (${(mOrig || 'NU').slice(0, 90)}), mutantul ${mMut == null ? 'trece' : 'refuză și el: ' + mMut.slice(0, 90)}`)
}

// ── 5. revenirea ──
console.log('5. revenirea')
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  // un șantier creat prin RPC (owner) înainte de revenire RĂMÂNE după ea, legat de proiectul lui
  const r = await ca(db, 'authenticated', U.OWNER, RPC, ['Gazpet - Inainte de revenire', 2, null])
  await tx(db, { rol: 'authenticated', uid: U.OWNER, commit: true }, ({ q }) => q(RPC, ['Gazpet - Inainte de revenire', 2, null]))
  await revino(db)
  const g = await gol(db)
  const pol = (await db.query(`SELECT count(*)::int AS n FROM pg_policy WHERE polrelid = 'public.sites'::regclass`)).rows[0].n
  ok(r.rows && g && pol === 4, 'revenirea scoate exact funcția și cheia (cele 4 politici de azi rămân)')
  const ram = (await db.query(`SELECT s.id FROM public.sites s JOIN public.executie_proiecte e ON e.site_id = s.id AND e.id = s.proiect_id WHERE s.name = 'Gazpet - Inainte de revenire'`)).rows
  ok(ram.length === 1, 'șantierul creat prin RPC înainte de revenire rămâne, legat de proiect')
  const b2 = await baseline(db)
  ok(JSON.stringify(b2.map(x => [x.eticheta, x.amprenta])) === JSON.stringify(B0.map(x => [x.eticheta, x.amprenta])), 'după revenire amprenta L15 = baseline-ul de dinainte')
  // re-aplicarea pe aceeași bază (proiectul 2 are acum șantier: verificările îl folosesc doar pe owner fără proiect / cu 2 → se mută pe o bază nouă)
  await aplicaMig(db, MIG_B)
  ok(!(await gol(db)), 're-aplicarea după revenire trece')
  await db.close()
  const db2 = await bazaNoua(); await aplicaMig(db2, MIG_B); await db2.exec(ACORDA)
  await db2.exec(`DELETE FROM public.user_module_access WHERE module = 'santiere_creare'`)
  await revino(db2); await aplicaMig(db2, MIG_B)
  const ab = await verifica(db2)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `aplicare → acordare → retragere → revenire → re-aplicare + verificările (${ab.length} abateri)`)
  await db2.close()
}
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sites_creeaza(p_nume text, p_proiect bigint, p_beneficiar text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/starea nu e cea din 20261222a \(pasul 1, functia\)/.test(m || '') && !(await gol(db)), 'revenirea refuză o funcție schimbată: ' + m)
  await db.close()
}
// runda 3 (Jakarinos r2, P2-2): deriva DUPĂ aplicare — orice drept nou pe funcție (pe ORICE rol, inclusiv PUBLIC / anon / service_role / GRANT
// OPTION), orice proprietate schimbată, rândul cheii schimbat = revenirea refuză, nimic schimbat (funcția și cheia rămân)
const FN_SIG = 'public.fn_sites_creeaza(text, bigint, text)'
const DERIVA = [
  ['GRANT EXECUTE către service_role (demonstrația Jak)', `GRANT EXECUTE ON FUNCTION ${FN_SIG} TO service_role;`, /\(pasul 1, functia\): .*acl=authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE/],
  ['GRANT EXECUTE către PUBLIC', `GRANT EXECUTE ON FUNCTION ${FN_SIG} TO PUBLIC;`, /\(pasul 1, functia\): .*acl=PUBLIC:EXECUTE, authenticated/],
  ['GRANT EXECUTE către anon', `GRANT EXECUTE ON FUNCTION ${FN_SIG} TO anon;`, /\(pasul 1, functia\): .*acl=anon:EXECUTE, authenticated/],
  ['authenticated cu GRANT OPTION', `GRANT EXECUTE ON FUNCTION ${FN_SIG} TO authenticated WITH GRANT OPTION;`, /\(pasul 1, functia\): .*acl=authenticated:EXECUTE\*, /],
  ['EXECUTE retras de la authenticated', `REVOKE EXECUTE ON FUNCTION ${FN_SIG} FROM authenticated;`, /\(pasul 1, functia\): .*acl=postgres:EXECUTE, corp_md5/],
  ['STRICT', `ALTER FUNCTION ${FN_SIG} STRICT;`, /\(pasul 1, functia\): .*strict=true/],
  ['STABLE', `ALTER FUNCTION ${FN_SIG} STABLE;`, /\(pasul 1, functia\): .*volatil=s/],
  ['LEAKPROOF', `ALTER FUNCTION ${FN_SIG} LEAKPROOF;`, /\(pasul 1, functia\): .*leakproof=true/],
  ['SECURITY INVOKER', `ALTER FUNCTION ${FN_SIG} SECURITY INVOKER;`, /\(pasul 1, functia\): .*definer=false/],
  ['search_path schimbat', `ALTER FUNCTION ${FN_SIG} SET search_path = public;`, /\(pasul 1, functia\): .*config=search_path=public, intoarce/],
  ['alt parametru de configurare', `ALTER FUNCTION ${FN_SIG} SET work_mem = '64MB';`, /\(pasul 1, functia\): .*config=search_path=public, pg_temp; work_mem=64MB/],
  ['alt proprietar', `ALTER FUNCTION ${FN_SIG} OWNER TO service_role;`, /\(pasul 1, functia\): .*proprietar=service_role/],
  ['corpul schimbat', `CREATE OR REPLACE FUNCTION ${FN_SIG.replace('(text, bigint, text)', '(p_nume text, p_proiect bigint, p_beneficiar text)')} RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`, new RegExp('\\(pasul 1, functia\\): .*corp_md5=(?!' + AMP_CORP + ')[0-9a-f]{32}')],
  ['rândul cheii: pe pagina de start', `UPDATE public.app_modules SET show_on_homepage = true WHERE key = 'santiere_creare';`, /\(pasul 1, cheia de modul\)/],
  ['rândul cheii: altă descriere', `UPDATE public.app_modules SET description = description || ' x' WHERE key = 'santiere_creare';`, /\(pasul 1, cheia de modul\)/],
  ['rândul cheii: sub alt părinte', `UPDATE public.app_modules SET parent_key = 'executie' WHERE key = 'santiere_creare';`, /\(pasul 1, cheia de modul\)/],
]
const intact = async (db) => (await db.query(`SELECT to_regprocedure('${FN_SIG}') IS NOT NULL AND EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare') AS i`)).rows[0].i
console.log('   deriva după aplicare (runda 3): revenirea refuză, nimic schimbat')
for (const [nume, sql, re] of DERIVA) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(sql)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(re.test(m || '') && /starea nu e cea din 20261222a/.test(m || '') && await intact(db), `${nume}: ${m ? m.slice(0, 200) : 'NU a refuzat'}`)
  await db.close()
}
{
  // controlul pozitiv: GRANT → REVOKE înapoi = aceeași stare → revenirea trece (proba nu refuză orice)
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`GRANT EXECUTE ON FUNCTION ${FN_SIG} TO service_role; REVOKE EXECUTE ON FUNCTION ${FN_SIG} FROM service_role;`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(m == null && await gol(db), `GRANT apoi REVOKE (starea de după migrare refăcută): revenirea trece ${m || ''}`)
  await db.close()
}
console.log('   mutanții revenirii')
for (const [nume, inl, pregatire, re] of [
  ['R1 fără verificarea „niciun drept acordat”', [["  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN\n    RAISE EXCEPTION '20261222a revenire: dreptul santiere_creare e acordat (user_module_access); retragerea lui e un pas separat, cu acordul owner-ului';\n  END IF;\n", '']],
    async (db) => { await db.exec(ACORDA) }, /dreptul santiere_creare e acordat/],
  ['R2 fără compararea detaliului funcției', [['    IF v_det IS DISTINCT FROM\n', '    IF false AND v_det IS DISTINCT FROM\n']],
    async (db) => { await db.exec(DERIVA.find(d => d[0] === 'corpul schimbat')[1]) }, /starea nu e cea din 20261222a/],
  // r2: drepturile verificate doar pentru o listă de roluri (anon / PUBLIC) — un GRANT către service_role trecea (demonstrația Jak)
  ['R3 ACL-ul comparat doar pe o listă de roluri (ca în r2)', [["                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '(niciun drept)')\n           || ', corp_md5='",
    "                  FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0 OR pg_get_userbyid(e.grantee) IN ('anon', 'authenticated', 'postgres')) a), '(niciun drept)')\n           || ', corp_md5='"]],
    async (db) => { await db.exec(`GRANT EXECUTE ON FUNCTION ${FN_SIG} TO service_role;`) }, /starea nu e cea din 20261222a/],
  ['R4 o proprietate necomparată (strict)', [["|| ', strict=' || p.proisstrict::text ||", "|| ', strict=false' ||"]],
    async (db) => { await db.exec(`ALTER FUNCTION ${FN_SIG} STRICT;`) }, /starea nu e cea din 20261222a/],
  ['R5 rândul cheii necomparat (doar numărul)', [["    IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') <> 1\n       OR NOT EXISTS", "    IF (SELECT count(*) FROM public.app_modules WHERE key = 'santiere_creare') <> 1\n       OR false AND NOT EXISTS"]],
    async (db) => { await db.exec(`UPDATE public.app_modules SET show_on_homepage = true WHERE key = 'santiere_creare';`) }, /starea nu e cea din 20261222a \(pasul 1, cheia de modul\)/],
]) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await pregatire(db)
  let mOrig = null; try { await revino(db, REV) } catch (e) { mOrig = e.message }
  let mMut = null; try { await revino(db, aplica(REV, inl)) } catch (e) { mMut = e.message }
  ok(re.test(mOrig || '') && mMut == null, `${nume}: originalul refuză (${mOrig}), mutantul trece = verificarea e necesară`)
  await db.close()
}

// ── 6. mutanții migrării (comportament) și ai codului JS: fiecare TREBUIE să pice ──
console.log('6. mutanții migrării')
const MUTANTI = [
  ['M1 nivel viewer acceptat (santiere_creare)', [["u.module = 'santiere_creare' AND u.access_level IN ('editor', 'admin')", "u.module = 'santiere_creare' AND u.access_level IN ('viewer', 'editor', 'admin')"]]],
  ['M2 fără verificarea proiectului (L09)', [['\n     OR public.fn_executie_proiect_permis(p_proiect, true) IS NOT TRUE THEN', ' THEN']]],
  ['M3 cheia administrativ.locatii acceptată', [["u.module = 'santiere_creare'", "u.module IN ('santiere_creare', 'administrativ.locatii')"]]],
  ['M4 lărgit la can_manage_contracts', [['WHERE p.id = v_uid AND p.is_owner IS TRUE)', 'WHERE p.id = v_uid AND (p.is_owner IS TRUE OR p.can_manage_contracts))']]],
  ['M5 proiectul verificat doar pentru citire', [['public.fn_executie_proiect_permis(p_proiect, true)', 'public.fn_executie_proiect_permis(p_proiect, false)']]],
  ['M6 fără modulul executie (verdict P2-3)', [["u.module = 'executie' AND u.access_level IN ('editor', 'admin')", "u.module = 'executie' AND u.access_level IN ('editor', 'admin') OR true"]]],
  ['M7 EXECUTE pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_sites_creeaza(text, bigint, text) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_sites_creeaza(text, bigint, text) TO authenticated, anon;']]],
  ['M8 migrarea acordă dreptul cuiva', [['-- ── postcondiții ──', `INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.CONTR}', 'santiere_creare', 'editor');\n-- ── postcondiții ──`]]],
  ['M9 identitatea nu din auth.uid() (orice rând de drept)', [["WHERE u.profile_id = v_uid AND u.module = 'santiere_creare'", "WHERE u.module = 'santiere_creare'"]]],
  ['M10 ordinea r1 (șantierul înaintea legăturii), cu postcondiția', [["  UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;\n  INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);",
    "  INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);\n  UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;"]]],
  ['M11 ordinea r1 fără postcondiție (dublarea tăcută)', [["  UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;\n  INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);",
    "  INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);\n  UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;"],
    ['  IF v_n IS DISTINCT FROM 1 OR NOT EXISTS', '  IF false AND v_n IS DISTINCT FROM 1 OR false AND NOT EXISTS']]],
  ['M12 fără idempotență (proiect legat = șantier nou, relegat)', [['  IF v_leg IS NOT NULL THEN\n    IF EXISTS', '  IF false THEN\n    IF EXISTS']]],
  ['M13 fără proiect permis și contului restrâns', [['\n     OR public.fn_executie_proiect_permis(p_proiect, true) IS NOT TRUE THEN', '\n     OR (p_proiect IS NOT NULL AND public.fn_executie_proiect_permis(p_proiect, true) IS NOT TRUE) THEN']]],
  ['M14 fără ocolirea owner-ului', [['NOT (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE)\n             OR', 'NOT (false\n             OR']]],
  ['M15 coloane administrative în INSERT (meteo / coordonate)', [['INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id) VALUES (v_site, v_nume, true, v_benef, p_proiect);',
    'INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id, lat, lng) VALUES (v_site, v_nume, true, v_benef, p_proiect, 44.9, 26.0);']]],
  ['M16 denumirea goală acceptată', [['  IF v_nume IS NULL THEN\n', '  IF false THEN\n']]],
]
// Garda de scriere a lui executie_proiecte (trg_executie_acces_garda, 20261209a) refuză și ea contul restrâns la UPDATE-ul site_id / la
// proiectul automat — dar NU e în amprenta L15 a migrării, deci RPC-ul nu se poate sprijini pe ea. Mutanții pe verificarea proiectului
// (M2 / M5 / M13) rulează pe o bază FĂRĂ garda aceea; întâi: originalul trece toate verificările și fără ea (verificarea din RPC ajunge singură).
const FARA_GARDA = 'DROP TRIGGER trg_executie_acces_garda ON public.executie_proiecte;'
const PE_PROIECT = new Set(['M2', 'M5', 'M13'])
{
  const db = await bazaNoua(); await db.exec(FARA_GARDA); await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `originalul, fără garda lui executie_proiecte: verificările trec (${ab.length} abateri)`)
  await db.close()
}
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  if (PE_PROIECT.has(nume.split(' ')[0])) await db.exec(FARA_GARDA)
  let picat = null
  try {
    await aplicaMig(db, cuAmprentaCorp(aplica(MIG_B, inl)))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}
console.log('   mutanții codului JS (src/lib/santiereDrept.js)')
for (const [nume, inl, scen] of [
  ['J1 funcția lipsă tratată ca eroare oarecare', [["if (cod === 'PGRST202' || cod === '42883') return { tip: 'indisponibil' }", '']], 'W6'],
  ['J2 fără reconciliere la rezultat necunoscut', [["  if (r.tip !== 'necunoscut' || proiectId == null) return r", '  return r']], 'W3'],
  ['J3 rețeaua tratată ca eșec determinat', [["  if (SQLSTATE.test(cod) || /^PGRST\\d{3}$/.test(cod)) return", '  if (true) return']], 'W3'],
  ['J4 răspuns fără id = succes', [["    return { tip: 'necunoscut', motiv: 'răspuns fără id de șantier' }", "    return { tip: 'ok', siteId: id, creat: true }"]], 'W12'],
  ['J5 necunoscut raportat ca reușită', [["    default:\n      return { ok: false,", "    default:\n      return { ok: true,"]], 'W8'],
  ['J6 fără reîncercare după citire', [['  const r2 = clasificaRaspuns(await apel(client, args))\n  if (r2.tip', "  const r2 = { tip: 'necunoscut', motiv: 'fără reîncercare' }\n  if (r2.tip"]], 'W4'],
  // runda 3 (P2-1): comportamentul din r2 — rezultatul determinat al reîncercării înlocuiește incertitudinea primului apel
  ['J8 eșecul reîncercării întors direct (r2), fără reconcilierea finală', [["  if (r2.tip === 'ok') return r2\n", "  if (r2.tip !== 'necunoscut') return r2\n"]], 'W13'],
  ['J8b la fel, cu funcția dispărută între apeluri', [["  if (r2.tip === 'ok') return r2\n", "  if (r2.tip !== 'necunoscut') return r2\n"]], 'W15'],
  ['J9 recitirea finală picată tratată ca „nelegat”', [["  if (fin.tip === 'nelegat' && r2.tip !== 'necunoscut')", "  if (fin.tip !== 'ok' && r2.tip !== 'necunoscut')"]], 'W13'],
  ['J10 fără reconcilierea finală (eșecul confirmat nu mai e verificat)', [["  const fin = await stareProiect(client, proiectId)\n", "  const fin = { tip: 'nelegat' }\n"]], 'W14'],
]) {
  let picat = null
  try {
    const js = await importJs(aplica(JS_SURSA, inl))
    const r = await ruleazaWizard(js, SCEN_W.find(s => s[0].startsWith(scen + ' ')))
    if (r) picat = r
  } catch (e) { picat = 'eroare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică pe ${scen} (${(picat || 'NU a picat').slice(0, 160)})`)
}
{
  // J7: regula de cont din UI fără Execuție — paritatea UI ↔ BD trebuie să pice
  const js = await importJs(aplica(JS_SURSA, [['return SCRIERE.includes(n[CHEIE_SANTIERE_CREARE]) && SCRIERE.includes(n.executie)', 'return SCRIERE.includes(n[CHEIE_SANTIERE_CREARE])']]))
  ok(js.poateCreaSantier({ module_access_levels: { santiere_creare: 'editor' } }) === true && JS.poateCreaSantier({ module_access_levels: { santiere_creare: 'editor' } }) === false,
    'J7 UI fără verificarea Execuției: mutantul dă „da” unde BD-ul refuză (TIT_FARA_EX), originalul „nu”')
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
