// Proba LOCALĂ a migrării 20261225a (Execuție → raportul de uscare a conductei) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261225a_executie_uscare_schelet.sql + funcțiile de drept extrase EXACT din migrările lor (20261209a pentru
//   corpul cu restricția pe proiect, 20261201a / 20261203a pentru drepturile lor); amprentele lor = constantele din migrare (verificat).
// Aplicarea: ca runnerul — marcaj + plafon 2000 + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh (aceleași funcții ca runnerul):
//   întâi generarea manifestului (GLOBAL aprobat „-”, ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact
//   manifestul) și COMMIT. Lista obiectelor din manifest = supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv (revizuită; PG18 adaugă
//   constrângerile NOT NULL, ignorate aici: producția e PG17).
// 1. VERIFICĂRILE de comportament (valorile așteptate scrise de mână, L25), ca rolul authenticated cu JWT-ul fiecărui cont: manager de
//    proiect (cont restrâns, editor pe P1), manager al altui proiect, administrator Execuție, owner, editor / viewer nerestrâns, cont fără
//    drept, anonim; criteriul de acceptare (ultimul piston + fotografia lui, punctul de rouă opțional), cântăririle pe bureții declarați,
//    fotografiile cerute (justificarea), rezervările de încărcare, meteo construit de server, poziția, stările, idempotența, CAS-ul, jurnalul.
// 2. Refuzurile migrării (marcaj, plafon, fără amprenta globală, lanțul de drept schimbat, o politică Storage generică — sonda politicilor
//    EFECTIVE) + revenirea (refuz cu date, definiții schimbate, aplicare -> revenire -> re-aplicare).
// 3. MUTANȚI ai migrării: fiecare TREBUIE să pice (la aplicare sau la verificări).
// 4. Paritatea regulilor de închidere JS (src/uscareLogica.js) = SQL, pe aceleași cazuri (L19).
// Ce NU probează PGlite (o singură conexiune): concurența reală — supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh, pe clonă.
// Rulare (din rădăcina repo-ului; cere bash în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_uscare_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { amprente, amprenteRevenire, md5 } from '../executie_uscare_amprente.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'uscare_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261225a_executie_uscare_schelet.sql')
const MIG = citeste('supabase/migrations/20261225a_executie_uscare.sql')
const REV = citeste('supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql')
const M09 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
const OBIECTE = citeste('supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv')
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── funcțiile de drept, EXACT ca în migrările lor (corpul din 20261209a; ACL-urile din migrarea care le-a creat) ──
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = text.indexOf(';', text.indexOf(a[1], startCorp) + a[1].length) + 1
  return text.slice(i, sfarsit).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
}
const acl = (text, nume) => text.split('\n').filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
const LANT = [
  ['fn_executie_acces_nerestrans_cont', 'CREATE FUNCTION public.fn_executie_acces_nerestrans_cont(', M09, '9a07e0089139e54ba5c6a0cfaaf093cc'],
  ['fn_executie_acces_lista_cont', 'CREATE FUNCTION public.fn_executie_acces_lista_cont(', M09, 'e7cf9b852002a1c1cbe781772c33bf0c'],
  ['fn_executie_acces_nerestrans', 'CREATE FUNCTION public.fn_executie_acces_nerestrans()', M09, 'b863c5324684dbf4eb9af81474fbc4e1'],
  ['fn_executie_acces_lista', 'CREATE FUNCTION public.fn_executie_acces_lista(', M09, 'd9e123a46b83530a7203d4a24da5cf9b'],
  ['fn_executie_proiect_permis', 'CREATE FUNCTION public.fn_executie_proiect_permis(', M09, 'bd4320f76e9f36f492c7186c0a982155'],
  ['fn_executie_nod_drept', 'CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(', citeste('supabase/migrations/20261201a_executie_noduri_suduri.sql'), '1f0faa030d0459412aafb6e1a024beff'],
  ['fn_executie_contract_drept', 'CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(', citeste('supabase/migrations/20261203a_executie_contract_repere.sql'), 'f3c3dc6add32d563682494e804864e99'],
]
let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
let SQL_LANT = ''
console.log('0. lanțul de drept extras din migrările lui (amprentele = constantele din 20261225a)')
for (const [nume, cap, aclText, amp] of LANT) {
  const f = functie(M09, cap)
  const corp = f.slice(f.indexOf('$f$') + 3, f.lastIndexOf('$f$'))
  ok(md5(corp) === amp && MIG.includes(`'${amp}'`), `${nume}: ${md5(corp)}`)
  SQL_LANT += f + '\n' + acl(aclText, nume) + '\n'
}

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000a1', ADMIN: '00000000-0000-0000-0000-0000000000a2', EDITOR: '00000000-0000-0000-0000-0000000000a3',
  VIEWER: '00000000-0000-0000-0000-0000000000a4', MAN_P1: '00000000-0000-0000-0000-0000000000a5', MAN_P2: '00000000-0000-0000-0000-0000000000a6',
  CIT_P1: '00000000-0000-0000-0000-0000000000a7', FARA: '00000000-0000-0000-0000-0000000000a8', ADMIN_P2: '00000000-0000-0000-0000-0000000000a9',
}
const ACUM = Date.now()
const iso = oreInUrma => new Date(ACUM - oreInUrma * 3600e3).toISOString()
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('${U.OWNER}', 'OWNER', true), ('${U.ADMIN}', 'ADMIN', false), ('${U.EDITOR}', 'EDITOR', false), ('${U.VIEWER}', 'VIEWER', false),
  ('${U.MAN_P1}', 'MAN P1', false), ('${U.MAN_P2}', 'MAN P2', false), ('${U.CIT_P1}', 'CIT P1', false), ('${U.FARA}', 'FARA', false),
  ('${U.ADMIN_P2}', 'ADMIN P2', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('${U.ADMIN}', 'executie', 'admin'), ('${U.EDITOR}', 'executie', 'editor'), ('${U.VIEWER}', 'executie', 'viewer'),
  ('${U.MAN_P1}', 'executie', 'editor'), ('${U.MAN_P2}', 'executie', 'editor'), ('${U.CIT_P1}', 'executie', 'editor'),
  ('${U.ADMIN_P2}', 'executie', 'admin'), ('${U.FARA}', 'hr', 'admin');
INSERT INTO public.executie_proiecte (id, nume) VALUES (1, 'P1'), (2, 'P2');
INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES
  ('${U.MAN_P1}', 1, 'editor'), ('${U.MAN_P2}', 2, 'editor'), ('${U.CIT_P1}', 1, 'viewer'), ('${U.ADMIN_P2}', 2, 'editor');
INSERT INTO public.executie_probe_tronsoane (id, proiect_id, cod, km_de_la_m, km_pana_la_m, stare) VALUES
  (10, 1, 'P2', 3200, 3900, 'activ'), (11, 1, 'P5', 20000, 21000, 'anulat'), (20, 2, 'P1', 0, 5000, 'activ');
INSERT INTO public.sites (id, name, proiect_id, lat, lng) VALUES (100, 'Santier P1', 1, 44.9412345, 22.5000001), (200, 'Santier P2', 2, 45.1, 23.2),
  (101, 'Santier P1 vechi', 1, 44.95, 22.51);
INSERT INTO public.meteo_cache (site_id, curent, actualizat_la, sursa) VALUES
  (100, '{"temp": 7.46, "vreme": "Senin", "la": "${iso(4.5)}"}', '${iso(4)}', 'xweather'),
  (200, '{"temp": 3, "vreme": "Ceață", "la": "${iso(4.5)}"}', '${iso(4)}', 'xweather'),
  (101, '{"temp": 1.2, "vreme": "Ninsoare", "la": "${iso(40)}"}', '${iso(39)}', 'xweather');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(SQL_LANT)
  await db.exec(DATE)
  return db
}
// ca runnerul: plafon + marcaje + (opțional) pașii L15 v2 generați. l15: 'livrare' (inainte aprobat + dupa cu manifest), 'inainte' (doar pasul
// „înainte”, GLOBAL „-”: suficient pentru gardă, fără manifest), 'nimic'.
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
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
    await db.exec(final)
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261225a_executie_uscare', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261225a_executie_uscare_ROLLBACK', text, { l15: 'nimic', ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}

// o instrucțiune ca rolul dat, cu JWT-ul contului (COMMIT la succes, ca un apel PostgREST)
async function ca(db, rol, uid, sql) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const ziBuc = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ms))
// formularul complet (toate cele 40 de chei), valori scrise de mână; punctul de rouă lipsește (opțional)
const COMPLET = () => ({
  proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, inceput_planificat: iso(30), notificare_la: iso(60),
  notificare_ref: 'adresa nr. 1', data_operatie: ziBuc(ACUM), ora_inceput: iso(5), ora_final: iso(1),
  poz_lat: 44.941234, poz_lng: 22.500001, poz_sursa: 'gps', poz_precizie_m: 4.5, poz_la: iso(5), poz_km_m: null, poz_traseu_versiune: null,
  temperatura_c: 8.5, temperatura_sursa: 'manual', meteo: null, vreme: 'Senin', constructor: 'Constructor SRL',
  utilaje: [{ denumire: 'Compresor', buc: 1 }, { denumire: 'Uscător aer', buc: 2 }], pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 3,
  cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45, motiv: null }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2, motiv: null }, { nr: 3, intrare_kg: null, iesire_kg: null, motiv: 'pierdut în conductă' }],
  punct_roua_c: null, punct_roua_loc: null, presiune_bar: 1.5, timp_deplasare_min: 35, piston_final_rezultat: 'uscat', poze_justificare: null,
  observatii: 'fără', concluzie: 'conform',
  semn_constructor_nume: null, semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null,
})
const GOL = () => Object.fromEntries(Object.entries(COMPLET()).map(([k]) => [k, ['utilaje', 'cantariri'].includes(k) ? [] : null]))
const PLAN = () => ({ ...GOL(), proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, constructor: 'Constructor SRL' })
const salveaza = (db, uid, proiect, id, versiune, date, cheie = randomUUID(), rol = 'authenticated') =>
  ca(db, rol, uid, `SELECT public.fn_executie_uscare_salveaza(${proiect}, ${id ?? 'NULL'}, ${versiune ?? 'NULL'}, ${lit(JSON.stringify(date))}::jsonb, ${lit(cheie)}::uuid) AS r`)
const stare = (db, uid, id, versiune, actiune, motiv = null, cheie = randomUUID()) =>
  ca(db, 'authenticated', uid, `SELECT public.fn_executie_uscare_stare(${id}, ${versiune}, ${lit(actiune)}, ${motiv == null ? 'NULL' : lit(motiv)}, ${lit(cheie)}::uuid) AS r`)
const poza = (db, uid, uscare, actiune, { poza: pz = null, cale = null, categorie = null, burete = null, legenda = null, cheie = randomUUID() } = {}) =>
  ca(db, 'authenticated', uid, `SELECT public.fn_executie_uscare_poza(${uscare}, ${lit(actiune)}, ${pz ?? 'NULL'}, ${cale == null ? 'NULL' : lit(cale)}, ${categorie == null ? 'NULL' : lit(categorie)}, ${burete ?? 'NULL'}, ${legenda == null ? 'NULL' : lit(legenda)}, ${lit(cheie)}::uuid) AS r`)
const urca = (db, uid, cale, bucket = 'executie-uscare') =>
  ca(db, 'authenticated', uid, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES (${lit(bucket)}, ${lit(cale)}, ${lit(uid)}::uuid) RETURNING name`)
const cale = (proiect, uscare) => `${proiect}/${uscare}/${randomUUID()}.jpg`
const versiuneDe = async (db, id) => (await db.query(`SELECT versiune FROM public.executie_uscari WHERE id = ${id}`)).rows[0].versiune

// ── VERIFICĂRILE (pe o bază cu migrarea aplicată); întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return null } return r.rows[0]?.r ?? r.rows }
  const asteptMesaj = (r, re, ce) => { if (!r.code || !re.test(r.message)) ab.push(`${ce}: ${r.code || 'a trecut'} ${r.message || ''} (aștepta ${re})`) }
  // A. crearea: managerul P1 pe P1 (cu tronsonul de probă 10); admin / owner / editor nerestrâns; refuzurile
  const kA = randomUUID()
  const a1 = asteptOk(await salveaza(db, U.MAN_P1, 1, null, null, PLAN(), kA), 'A manager P1 creează pe P1')
  const id1 = a1?.uscare?.id
  if (a1 && (a1.ok !== true || a1.uscare.versiune !== 1 || a1.uscare.stare !== 'deschisa' || a1.uscare.creat_de !== U.MAN_P1)) ab.push('A rezultatul creării: ' + JSON.stringify(a1))
  // reîncercarea creării cu ACEEAȘI cheie (după un timeout) = același raport, nu altul
  const a1b = asteptOk(await salveaza(db, U.MAN_P1, 1, null, null, PLAN(), kA), 'A reîncercarea creării cu aceeași cheie')
  if (a1b && (a1b.duplicat !== true || a1b.uscare?.id !== id1)) ab.push('A reîncercarea a creat alt raport: ' + JSON.stringify(a1b))
  asteptCod(await salveaza(db, U.MAN_P2, 2, null, null, { ...PLAN(), proba_id: null }, kA), '22023', 'A aceeași cheie pe alt proiect')
  asteptMesaj(await salveaza(db, U.MAN_P1, 1, null, null, { ...PLAN(), constructor: null }), /constructorul se confirmă la creare/, 'A crearea fără constructor')
  const a2 = asteptOk(await salveaza(db, U.ADMIN, 2, null, null, { ...PLAN(), proba_id: 20, km_de_la_m: 0, km_pana_la_m: 5000 }), 'A admin creează pe P2')
  const id2 = a2?.uscare?.id
  asteptOk(await salveaza(db, U.OWNER, 1, null, null, { ...PLAN(), proba_id: null, tronson: 'tot traseul', km_de_la_m: 0, km_pana_la_m: 45000 }), 'A owner creează pe P1 (fără tronson de probă)')
  asteptOk(await salveaza(db, U.EDITOR, 2, null, null, { ...PLAN(), proba_id: null }), 'A editor nerestrâns creează pe P2')
  asteptCod(await salveaza(db, U.MAN_P2, 1, null, null, PLAN()), '42501', 'A manager P2 pe P1')
  asteptCod(await salveaza(db, U.CIT_P1, 1, null, null, PLAN()), '42501', 'A cititor P1 (viewer pe proiect) creează')
  asteptCod(await salveaza(db, U.VIEWER, 1, null, null, PLAN()), '42501', 'A viewer pe modul creează')
  asteptCod(await salveaza(db, U.FARA, 1, null, null, PLAN()), '42501', 'A cont fără drept')
  asteptCod(await salveaza(db, null, 1, null, null, PLAN()), '42501', 'A fără JWT')
  asteptCod(await salveaza(db, null, 1, null, null, PLAN(), randomUUID(), 'anon'), '42501', 'A anon')
  asteptCod(await salveaza(db, U.ADMIN_P2, 1, null, null, PLAN()), '42501', 'A admin restrâns pe P2, pe P1')
  // reluarea unei chei de pe P1 de un cont care nu (mai) vede P1: nu întoarce rândul
  asteptCod(await salveaza(db, U.MAN_P2, 1, null, null, PLAN(), kA), '42501', 'A reluarea cheii P1 de managerul P2 (fără drept de citire)')
  // B. citirea, prin RLS
  const nr = async (uid, rol = 'authenticated') => { const r = await ca(db, rol, uid, 'SELECT proiect_id, count(*)::int AS n FROM public.executie_uscari GROUP BY 1 ORDER BY 1'); return r.code ? r.code : JSON.stringify(r.rows.map(x => [Number(x.proiect_id), x.n])) }
  for (const [cont, asteptat] of [['MAN_P1', '[[1,2]]'], ['CIT_P1', '[[1,2]]'], ['MAN_P2', '[[2,2]]'], ['ADMIN_P2', '[[2,2]]'], ['VIEWER', '[[1,2],[2,2]]'],
                                  ['ADMIN', '[[1,2],[2,2]]'], ['OWNER', '[[1,2],[2,2]]'], ['FARA', '[]']]) {
    const v = await nr(U[cont]); if (v !== asteptat) ab.push(`B citire ${cont}: ${v} (aștepta ${asteptat})`)
  }
  asteptCod(await ca(db, 'anon', null, 'SELECT count(*) FROM public.executie_uscari'), '42501', 'B anon citește')
  for (const t of ['executie_uscare_jurnal', 'executie_uscare_incarcari', 'executie_uscare_poze']) {
    const jFara = await ca(db, 'authenticated', U.FARA, `SELECT count(*)::int AS n FROM public.${t}`)
    if (jFara.code || jFara.rows[0].n !== 0) ab.push(`B ${t} vizibil fără drept: ` + JSON.stringify(jFara))
  }
  const jP2 = await ca(db, 'authenticated', U.MAN_P2, `SELECT count(*)::int AS n FROM public.executie_uscare_jurnal WHERE proiect_id = 1`)
  if (jP2.code || jP2.rows[0].n !== 0) ab.push('B jurnalul P1 vizibil managerului P2: ' + JSON.stringify(jP2))
  // C. scrierile directe (PostgREST) refuzate
  asteptCod(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.executie_uscari (proiect_id, tronson, km_de_la_m, km_pana_la_m) VALUES (1, 'x', 0, 10)`), '42501', 'C INSERT direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `UPDATE public.executie_uscari SET tronson = 'y' WHERE id = ${id1}`), '42501', 'C UPDATE direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `DELETE FROM public.executie_uscari WHERE id = ${id1}`), '42501', 'C DELETE direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `INSERT INTO public.executie_uscare_incarcari (uscare_id, proiect_id, cale, categorie) VALUES (${id1}, 1, '1/${id1}/${randomUUID()}.jpg', 'altele')`), '42501', 'C INSERT direct în rezervări')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, cheie, amprenta) VALUES (${id1}, 1, 'salvare', '${randomUUID()}', '${'0'.repeat(32)}')`), '42501', 'C INSERT direct în jurnal')
  // D. salvarea: CAS, idempotență
  const k1 = randomUUID()
  const d1 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 700, temperatura_c: 8.5, temperatura_sursa: 'manual' }, k1), 'D salvarea v1')
  if (d1 && (d1.uscare?.versiune !== 2 || Number(d1.uscare?.lungime_m) !== 700 || d1.duplicat !== false)) ab.push('D salvarea v1: ' + JSON.stringify(d1))
  const d2 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 700, temperatura_c: 8.5, temperatura_sursa: 'manual' }, k1), 'D reluarea aceleiași apăsări')
  if (d2 && (d2.duplicat !== true || d2.uscare?.versiune !== 2)) ab.push('D reluarea nu e „duplicat”: ' + JSON.stringify(d2))
  asteptCod(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 701 }, k1), '22023', 'D aceeași cheie, alt conținut')
  const d3 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 702 }), 'D versiune veche')
  if (d3 && (d3.ok !== false || d3.motiv !== 'conflict' || d3.uscare?.versiune !== 2)) ab.push('D versiunea veche nu dă conflict cu rândul curent: ' + JSON.stringify(d3))
  const jd = await ca(db, 'authenticated', U.MAN_P1, `SELECT valori FROM public.executie_uscare_jurnal WHERE cheie = '${k1}'`)
  if (jd.code || JSON.stringify(jd.rows[0]?.valori?.lungime_m) !== '[null,700]') ab.push('D jurnalul salvării (diferența lungimii): ' + JSON.stringify(jd.rows?.[0]?.valori))
  // E. validările (nimic ignorat sau rotunjit pe tăcute)
  const v2 = 2
  for (const [ce, date] of [
    ['cheie necunoscută', { ...PLAN(), strain: 1 }], ['cheie lipsă', (() => { const x = PLAN(); delete x.vreme; return x })()],
    ['temperatura cu 2 zecimale', { ...PLAN(), temperatura_c: 8.55, temperatura_sursa: 'manual' }], ['temperatura fără sursă', { ...PLAN(), temperatura_c: 8.5 }],
    ['sursa meteo fără instantaneu', { ...PLAN(), temperatura_c: 8.5, temperatura_sursa: 'meteo' }],
    ['instantaneu meteo scris de client', { ...PLAN(), temperatura_c: 7.5, temperatura_sursa: 'meteo', ora_inceput: iso(4), meteo: { tip: 'santier', furnizor: 'x', site_id: 100, santier: null, lat: 1, lng: 1, ora_ceruta: iso(4), ora_observatiei: iso(4), preluat_la: iso(4), temperatura_c: 7.5, vreme: null } }],
    ['cerere meteo fără ora începerii', { ...PLAN(), meteo: { cerere: 'santier', site_id: 100 } }],
    ['cerere meteo pe șantierul altui proiect', { ...PLAN(), ora_inceput: iso(4), meteo: { cerere: 'santier', site_id: 200 } }],
    ['cerere meteo cu observația la peste 3 h (operațiune trecută)', { ...PLAN(), ora_inceput: iso(10), meteo: { cerere: 'santier', site_id: 100 } }],
    ['cerere meteo veche (40 h)', { ...PLAN(), ora_inceput: iso(4), meteo: { cerere: 'santier', site_id: 101 } }],
    ['cerere meteo cu cheie în plus', { ...PLAN(), ora_inceput: iso(4), meteo: { cerere: 'santier', site_id: 100, temperatura_c: 30 } }],
    ['meteo: temperatura diferită de propunere', { ...PLAN(), ora_inceput: iso(4), temperatura_c: 9, temperatura_sursa: 'meteo', meteo: { cerere: 'santier', site_id: 100 } }],
    ['poziție fără sursă', { ...PLAN(), poz_lat: 44.9, poz_lng: 22.5, poz_la: iso(1) }],
    ['poziție GPS fără precizie', { ...PLAN(), poz_lat: 44.9, poz_lng: 22.5, poz_sursa: 'gps', poz_la: iso(1) }],
    ['precizie la poziția manuală', { ...PLAN(), poz_lat: 44.9, poz_lng: 22.5, poz_sursa: 'manual', poz_precizie_m: 5, poz_la: iso(1) }],
    ['traseu fără versiune', { ...PLAN(), poz_lat: 44.9, poz_lng: 22.5, poz_sursa: 'traseu', poz_km_m: 3500, poz_la: iso(1) }],
    ['km de traseu la GPS', { ...PLAN(), poz_lat: 44.9, poz_lng: 22.5, poz_sursa: 'gps', poz_precizie_m: 5, poz_km_m: 3500, poz_traseu_versiune: 'a'.repeat(64), poz_la: iso(1) }],
    ['latitudine cu 7 zecimale', { ...PLAN(), poz_lat: 44.9123456, poz_lng: 22.5, poz_sursa: 'manual', poz_la: iso(1) }],
    ['kg cu 4 zecimale', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 2.1234, iesire_kg: null, motiv: null }] }],
    ['burete dublu', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 1, iesire_kg: null, motiv: null }, { nr: 1, intrare_kg: 1, iesire_kg: null, motiv: null }] }],
    ['cântărire fără cheia motiv', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 1, iesire_kg: null }] }],
    ['„nu se aplică” cu kg', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 1, iesire_kg: null, motiv: 'x' }] }],
    ['cântărire peste bureții declarați', { ...PLAN(), bureti_buc: 1, cantariri: [{ nr: 2, intrare_kg: 1, iesire_kg: 1, motiv: null }] }],
    ['21 de bureți', { ...PLAN(), bureti_buc: 21 }],
    ['rezultat piston necunoscut', { ...PLAN(), piston_final_rezultat: 'aproape' }],
    ['utilaj cu cheie în plus', { ...PLAN(), utilaje: [{ denumire: 'x', buc: 1, alt: 1 }] }], ['utilaj 0 buc', { ...PLAN(), utilaje: [{ denumire: 'x', buc: 0 }] }],
    ['număr ca text', { ...PLAN(), lungime_m: '700' }], ['moment fără fus orar', { ...PLAN(), ora_inceput: '2026-12-08T08:30:00' }],
    ['final înaintea începutului', { ...PLAN(), ora_inceput: iso(2), ora_final: iso(3) }], ['interval de km inversat', { ...PLAN(), km_de_la_m: 3900, km_pana_la_m: 3200 }],
    ['tronson de probă al altui proiect', { ...PLAN(), proba_id: 20 }], ['tronson de probă anulat', { ...PLAN(), proba_id: 11 }],
    ['concluzie necunoscută', { ...PLAN(), concluzie: 'admis' }], ['zi peste 60 de zile', { ...PLAN(), data_operatie: ziBuc(ACUM + 90 * 864e5) }],
    ['caracter de control în tronson', { ...PLAN(), tronson: 'Tr.' + String.fromCharCode(7) + '4' }],
  ]) {
    const r = await salveaza(db, U.MAN_P1, 1, id1, v2, date)
    if (!r.code) ab.push(`E ${ce}: a trecut`)
    else if (!['22023', '23503'].includes(r.code)) ab.push(`E ${ce}: ${r.code} ${r.message}`)
  }
  // M. meteo construit de SERVER: cererea pentru șantierul proiectului, la ora începerii (observația la 0,5 h de ea)
  const m1 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v2, { ...PLAN(), ora_inceput: iso(4), temperatura_c: 7.5, temperatura_sursa: 'meteo', meteo: { cerere: 'santier', site_id: 100 } }), 'M cererea meteo acceptată')
  const sn = m1?.uscare?.meteo
  if (m1 && (!sn || sn.tip !== 'santier' || sn.furnizor !== 'xweather' || Number(sn.temperatura_c) !== 7.5 || sn.santier !== 'Santier P1' || Number(sn.lat) !== 44.941235
             || Date.parse(sn.ora_ceruta) !== Date.parse(iso(4)) || Date.parse(sn.ora_observatiei) !== Date.parse(iso(4.5)) || Date.parse(sn.preluat_la) !== Date.parse(iso(4))))
    ab.push('M instantaneul construit de server: ' + JSON.stringify(sn))
  // omul corectează valoarea: rămâne și instantaneul (valoarea automată), sursa devine manual
  const m2 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 3, { ...PLAN(), ora_inceput: iso(4), temperatura_c: 6, temperatura_sursa: 'manual', meteo: sn }), 'M temperatura măsurată, instantaneul păstrat')
  if (m2 && (Number(m2.uscare?.temperatura_c) !== 6 || Number(m2.uscare?.meteo?.temperatura_c) !== 7.5)) ab.push('M valoarea măsurată + automată: ' + JSON.stringify(m2?.uscare))
  // ora începerii schimbată: „din meteo” nu mai e valabil
  asteptMesaj(await salveaza(db, U.MAN_P1, 1, id1, 4, { ...PLAN(), ora_inceput: iso(3), temperatura_c: 7.5, temperatura_sursa: 'meteo', meteo: sn }), /ora începerii de acum/, 'M ora schimbată invalidează „din meteo”')
  asteptMesaj(await salveaza(db, U.MAN_P1, 1, id1, 4, { ...PLAN(), ora_inceput: iso(4), meteo: { ...sn, temperatura_c: 9 } }), /instantaneul îl scrie doar serverul/, 'M instantaneul modificat de client')
  // F. închiderea: incompletă = refuz; regulile criteriului; completă = ok; apoi nimic nu se mai schimbă
  let v = await versiuneDe(db, id1)
  asteptCod(await stare(db, U.MAN_P1, id1, v, 'inchide'), '22023', 'F închiderea incompletă')
  asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v, { ...COMPLET(), concluzie: null }), 'F salvarea fără concluzie'); v++
  asteptMesaj(await stare(db, U.MAN_P1, id1, v, 'inchide'), /concluzie/, 'F închiderea doar fără concluzie')
  asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v, { ...COMPLET(), piston_final_rezultat: 'umed' }), 'F CONFORM cu piston umed (salvare)'); v++
  asteptMesaj(await stare(db, U.MAN_P1, id1, v, 'inchide'), /dovada_conform/, 'F CONFORM cu ultimul piston umed')
  asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v, COMPLET()), 'F salvarea completă (fără poze)'); v++
  const fm = await stare(db, U.MAN_P1, id1, v, 'inchide')
  if (!fm.code || !/dovada_conform/.test(fm.message) || !/poze_justificare/.test(fm.message) || /punct_roua/.test(fm.message)) ab.push('F CONFORM fără fotografia ultimului piston / fără justificare (punctul de rouă nu e cerut): ' + (fm.message || 'a trecut'))
  // H. fotografiile: rezervare -> urcare -> înregistrare
  const pozaCompleta = async (cat, burete = null, legenda = null) => {
    const c = cale(1, id1)
    if (asteptOk(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: c, categorie: cat, burete, legenda }), `H rezervarea ${cat}${burete || ''}`) == null) return null
    if (asteptOk(await urca(db, U.MAN_P1, c), `H urcarea ${cat}${burete || ''}`) == null) return null
    return { c, r: asteptOk(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c }), `H înregistrarea ${cat}${burete || ''}`) }
  }
  asteptCod(await urca(db, U.MAN_P1, cale(1, id1)), '42501', 'H urcarea fără rezervare')
  const pm = await pozaCompleta('manometru', null, 'manometru 1,5 bar')
  if (pm && (pm.r?.poza?.categorie !== 'manometru' || pm.r?.poza?.legenda !== 'manometru 1,5 bar')) ab.push('H poza vine cu datele din rezervare: ' + JSON.stringify(pm.r))
  asteptCod(await urca(db, U.MAN_P1, pm?.c || 'x'), '42501', 'H a doua urcare pe o cale deja înregistrată')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: pm?.c }), '22023', 'H aceeași poză de două ori')
  asteptCod(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cale(1, id1), categorie: 'cantar_intrare' }), '22023', 'H cântar fără burete')
  asteptCod(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cale(1, id1), categorie: 'manometru', burete: 2 }), '22023', 'H burete la manometru')
  asteptCod(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cale(2, id1), categorie: 'manometru' }), '22023', 'H cale cu alt proiect')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: cale(1, id1) }), '22023', 'H înregistrare fără rezervare')
  // rezervare fără fișier: nu se înregistrează; blochează închiderea până la renunțarea consemnată
  const cr = cale(1, id1)
  asteptOk(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cr, categorie: 'piston_final' }), 'H rezervarea ultimului piston (urcarea va eșua)')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: cr }), '22023', 'H înregistrarea fără fișier')
  asteptCod(await poza(db, U.MAN_P2, id1, 'rezerva', { cale: cale(1, id1), categorie: 'manometru' }), '42501', 'H managerul P2 rezervă pe raportul P1')
  asteptCod(await urca(db, U.MAN_P2, cr), '42501', 'H managerul P2 urcă în P1 (pe o cale rezervată)')
  asteptCod(await urca(db, U.CIT_P1, cr), '42501', 'H cititorul P1 urcă')
  asteptCod(await urca(db, U.FARA, cr), '42501', 'H cont fără drept urcă')
  asteptCod(await urca(db, U.MAN_P1, `1/${id1}/poza.png`), '42501', 'H cale de altă formă')
  asteptCod(await urca(db, U.MAN_P1, cale(1, 999999)), '42501', 'H uscare inexistentă')
  for (const [cat, b] of [['temperatura'], ['pistoane'], ['cantar_intrare', 1], ['cantar_iesire', 1], ['cantar_intrare', 2]]) await pozaCompleta(cat, b ?? null)
  const pf = await pozaCompleta('piston_final', null, 'buretele final uscat')
  const fn = await stare(db, U.MAN_P1, id1, v, 'inchide')
  if (!fn.code || !/incarcari_nelamurite/.test(fn.message) || !/poze_justificare/.test(fn.message) || /dovada_conform/.test(fn.message)) ab.push('F închiderea cu o rezervare nelămurită + cântarul de ieșire al buretelui 2 lipsă: ' + (fn.message || 'a trecut'))
  asteptCod(await poza(db, U.MAN_P1, id1, 'renunta', { cale: cr }), '22023', 'H renunțarea fără motiv')
  asteptOk(await poza(db, U.MAN_P1, id1, 'renunta', { cale: cr, legenda: 'urcarea a eșuat, poza refăcută' }), 'H renunțarea consemnată')
  asteptCod(await urca(db, U.MAN_P1, cr), '42501', 'H urcarea pe o rezervare renunțată')
  asteptCod(await poza(db, U.MAN_P1, id1, 'renunta', { cale: pf?.c, legenda: 'x' }), '22023', 'H renunțarea la o poză înregistrată')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `UPDATE public.executie_uscare_incarcari SET renuntat_motiv = 'x'`), '42501', 'H UPDATE direct pe rezervări')
  const vede = async uid => { const r = await ca(db, 'authenticated', uid, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'executie-uscare' AND name LIKE '1/%'`); return r.code || r.rows[0].n }
  for (const [cont, n] of [['MAN_P1', 7], ['CIT_P1', 7], ['OWNER', 7], ['MAN_P2', 0], ['FARA', 0]]) { const x = await vede(U[cont]); if (x !== n) ab.push(`H ${cont} vede ${x} fișiere P1 (aștepta ${n})`) }
  const sterge = await ca(db, 'authenticated', U.MAN_P1, `DELETE FROM storage.objects WHERE bucket_id = 'executie-uscare' RETURNING name`)
  if (sterge.code || sterge.rows.length !== 0) ab.push('H clientul a șters un fișier: ' + JSON.stringify(sterge))
  const sch = await ca(db, 'authenticated', U.MAN_P1, `UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'executie-uscare' RETURNING name`)
  if (sch.code || sch.rows.length !== 0) ab.push('H clientul a modificat un fișier: ' + JSON.stringify(sch))
  // scoaterea unei poze (rândul iese, fișierul și rezervarea rămân); apoi justificarea pentru cântarul lipsă
  asteptOk(await poza(db, U.MAN_P1, id1, 'scoate', { poza: pm?.r?.poza?.id }), 'H scoaterea pozei manometrului')
  const ramas = (await db.query(`SELECT count(*)::int AS n FROM storage.objects WHERE name = ${lit(pm?.c || 'x')}`)).rows[0].n
  if (ramas !== 1) ab.push('H fișierul pozei scoase a dispărut')
  const fj = await stare(db, U.MAN_P1, id1, v, 'inchide')
  if (!fj.code || !/poze_justificare/.test(fj.message)) ab.push('F fără manometru și cântar ieșire 2, fără justificare: ' + (fj.message || 'a trecut'))
  asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v, { ...COMPLET(), poze_justificare: 'manometrul nu s-a putut fotografia (ceață)' }), 'F justificarea lipsei consemnată'); v++
  // închiderea completă
  const fi = asteptOk(await stare(db, U.MAN_P1, id1, v, 'inchide'), 'F închiderea completă (CONFORM, ultimul piston uscat + fotografia lui, fără punct de rouă)')
  if (fi && (fi.uscare?.stare !== 'inchisa' || fi.uscare?.versiune !== v + 1 || fi.uscare?.inchis_de !== U.MAN_P1)) ab.push('F rezultatul închiderii: ' + JSON.stringify(fi))
  v++
  asteptCod(await salveaza(db, U.MAN_P1, 1, id1, v, COMPLET()), '22023', 'F salvarea pe raport închis')
  asteptCod(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cale(1, id1), categorie: 'altele' }), '22023', 'F rezervare pe raport închis')
  asteptCod(await stare(db, U.MAN_P1, id1, v, 'anuleaza', 'gresit'), '22023', 'F anularea unui raport închis')
  // pe ORICE cale: nici proprietarul tabelului (postgres) nu modifică un raport închis / o poză / jurnalul / o rezervare
  for (const [ce, sql] of [['UPDATE raport închis', `UPDATE public.executie_uscari SET observatii = 'x', versiune = versiune + 1 WHERE id = ${id1}`],
                           ['DELETE raport', `DELETE FROM public.executie_uscari WHERE id = ${id1}`],
                           ['INSERT rezervare pe raport închis', `INSERT INTO public.executie_uscare_incarcari (uscare_id, proiect_id, categorie, cale) VALUES (${id1}, 1, 'altele', ${lit(cale(1, id1))})`],
                           ['DELETE rezervare', `DELETE FROM public.executie_uscare_incarcari WHERE uscare_id = ${id1}`],
                           ['UPDATE jurnal', `UPDATE public.executie_uscare_jurnal SET motiv = 'x' WHERE uscare_id = ${id1}`],
                           ['TRUNCATE jurnal', `TRUNCATE public.executie_uscare_jurnal`]]) {
    let m = null; try { await db.exec(sql) } catch (e) { m = e.code }
    if (m !== '42501') ab.push(`F ${ce} ca proprietar: ${m || 'a trecut'}`)
  }
  // NECONFORM: rezultatul negativ se consemnă și raportul se închide (fără fotografia ultimului piston)
  const n1 = asteptOk(await salveaza(db, U.OWNER, 1, null, null, { ...COMPLET(), bureti_buc: 0, cantariri: [], piston_final_rezultat: 'umed', concluzie: 'neconform', poze_justificare: 'fără poze: model' }), 'N raport NECONFORM')
  if (n1) asteptOk(await stare(db, U.OWNER, n1.uscare.id, 1, 'inchide'), 'N închiderea cu ultimul piston umed, NECONFORM (fără bureți: nimic de cântărit)')
  // G. redeschiderea: doar admin Execuție / owner, cu motiv; conținutul închis rămâne în jurnal
  asteptCod(await stare(db, U.MAN_P1, id1, v, 'redeschide', 'corectură'), '42501', 'G managerul (editor) redeschide')
  asteptCod(await stare(db, U.ADMIN_P2, id1, v, 'redeschide', 'corectură'), '42501', 'G admin restrâns pe P2 redeschide P1')
  asteptCod(await stare(db, U.ADMIN, id1, v, 'redeschide', null), '22023', 'G redeschiderea fără motiv')
  const g1 = asteptOk(await stare(db, U.ADMIN, id1, v, 'redeschide', 'corectură temperatură'), 'G admin redeschide')
  if (g1 && (g1.uscare?.stare !== 'deschisa' || g1.uscare?.revizie !== 1 || g1.uscare?.inchis_la !== null)) ab.push('G rezultatul redeschiderii: ' + JSON.stringify(g1))
  v++
  const jr = await ca(db, 'authenticated', U.VIEWER, `SELECT actiune, motiv, valori FROM public.executie_uscare_jurnal WHERE uscare_id = ${id1} AND actiune IN ('inchidere', 'redeschidere') ORDER BY id`)
  if (jr.code || jr.rows.length !== 2 || jr.rows[1].motiv !== 'corectură temperatură' || jr.rows[1].valori?.raport?.stare !== 'inchisa'
      || jr.rows[1].valori?.raport?.piston_final_rezultat !== 'uscat' || jr.rows[0].valori?.poze?.length !== 6) ab.push('G jurnalul închidere / redeschidere: ' + JSON.stringify(jr.rows || jr).slice(0, 300))
  asteptOk(await stare(db, U.OWNER, id1, v, 'inchide'), 'G owner închide din nou (revizia 1)')
  // I. anularea: motiv obligatoriu, finală; o rezervare deschisă a raportului anulat nu mai primește fișier
  const cI = cale(2, id2)
  asteptOk(await poza(db, U.ADMIN, id2, 'rezerva', { cale: cI, categorie: 'altele' }), 'I rezervare înainte de anulare')
  asteptCod(await stare(db, U.ADMIN, id2, 1, 'anuleaza', null), '22023', 'I anularea fără motiv')
  asteptOk(await stare(db, U.ADMIN, id2, 1, 'anuleaza', 'dublură'), 'I anularea')
  asteptCod(await urca(db, U.ADMIN, cI), '42501', 'I urcarea pe rezervarea unui raport anulat')
  asteptCod(await salveaza(db, U.ADMIN, 2, id2, 2, PLAN()), '22023', 'I salvarea unui raport anulat')
  asteptCod(await stare(db, U.ADMIN, id2, 2, 'redeschide', 'x'), '22023', 'I redeschiderea unui raport anulat')
  asteptCod(await stare(db, U.ADMIN, id2, 2, 'inchide'), '22023', 'I închiderea unui raport anulat')
  // funcțiile interne nu se cheamă din API
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_uscare_tranzitie('deschisa', 'inchide')`), '42501', 'D funcție internă din API')
  return ab
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) din fișierul revizuit = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, 'supabase/tests/20261225a_executie_uscare.l15.obiecte.tsv'),
    '# 20261225a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length > 50 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, '20261225a_executie_uscare.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /sfarsit la \d+ ms/.test(m)), 'livrarea aprobată: diferența = manifestul; ' + j.filter(m => /ms de la BEGIN/.test(m)).map(m => m.slice(0, 90)).join(' | '))
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista rapoarte/.test(m || ''), 'revenirea refuză cu date: ' + m)
  await db.close()
}

console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['pasul „înainte” dintr-o tranzacție anterioară', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  ['lanțul de drept schimbat', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
    return aplicaMig(db)
  }, /lantul de drept \(inainte\) difera de amprenta revizuita: public\.fn_executie_proiect_permis/],
  ['tronsoanele de probă lipsă', async db => { await db.exec('DROP TABLE public.executie_probe_tronsoane'); return aplicaMig(db) }, /executie_probe_tronsoane\.id lipseste/],
  ['meteo_cache fără ora preluării', async db => { await db.exec('ALTER TABLE public.meteo_cache DROP COLUMN actualizat_la'); return aplicaMig(db) }, /meteo_cache\.actualizat_la lipseste/],
  // sonda politicilor EFECTIVE: politici permisive generice (care nu numesc bucket-ul) deschid fișierele -> refuz
  ['politică generică de citire pe „proprietarul” fișierului', async db => {
    await db.exec(`CREATE POLICY proprii ON storage.objects FOR SELECT TO authenticated USING (owner = auth.uid())`); return aplicaMig(db)
  }, /politicile EFECTIVE .*authenticated vede 1/],
  ['politică generică de ștergere pentru orice cont logat', async db => {
    await db.exec(`CREATE POLICY sterge_tot ON storage.objects FOR DELETE TO authenticated USING (true)`); return aplicaMig(db)
  }, /politicile EFECTIVE .*authenticated sterge/],
  ['politică generică de încărcare pentru PUBLIC', async db => {
    await db.exec(`CREATE POLICY urca_tot ON storage.objects FOR INSERT WITH CHECK (bucket_id <> 'altul')`); return aplicaMig(db)
  }, /politicile EFECTIVE .*anon incarca/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const gol = (await db.query(`SELECT to_regclass('public.executie_uscari') IS NULL AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare') AS g`)).rows[0].g
  ok(re.test(m || '') && gol, `${nume}: ${m}`)
  await db.close()
}
{
  // sonda nu lasă nimic în urmă: după o aplicare reușită bucket-ul e gol și rolul curent e postgres
  const db = await bazaNoua()
  await aplicaMig(db)
  const r = (await db.query(`SELECT current_user AS u, (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'executie-uscare') AS n`)).rows[0]
  ok(r.u === 'postgres' && r.n === 0, `sonda Storage anulată integral (rol ${r.u}, ${r.n} fișiere)`)
  await db.close()
}

console.log('3. revenirea')
{
  const a = amprente(), b = amprenteRevenire()
  ok(JSON.stringify(a) === JSON.stringify(b), 'amprentele din revenire = corpurile migrării' + (JSON.stringify(a) === JSON.stringify(b) ? '' : ': ' + JSON.stringify(Object.keys(a).filter(k => a[k] !== b[k]))))
  const db = await bazaNoua()
  await aplicaMig(db)
  let m = null; try { await revino(db, REV, { plafon: 0, marcajPlafon: false }) } catch (e) { m = e.message }
  ok(/PLAFON_TRANZACTIE lipsa/.test(m || ''), 'revenirea fără plafon refuzată')
  m = null; try { await revino(db, REV, { marcaj: false }) } catch (e) { m = e.message }
  ok(/garda invalida/.test(m || ''), 'revenirea fără marcaj refuzată')
  // definițiile schimbate (nu doar numerele): fiecare = refuz, nimic schimbat
  for (const [ce, sql, undo, re] of [
    ['altă funcție folosește tabelele', `CREATE FUNCTION public.zz_foloseste() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT count(*) FROM public.executie_uscari $f$;`, 'DROP FUNCTION public.zz_foloseste()', /alte obiecte depind/],
    ['corpul unei funcții', `CREATE OR REPLACE FUNCTION public.fn_executie_uscare_tranzitie(p_veche text, p_actiune text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT 'inchisa'::text $f$;`, null, /functii: public\.fn_executie_uscare_tranzitie/],
    ['expresia unei politici (același nume, același număr)', `ALTER POLICY executie_uscari_citire ON public.executie_uscari USING (true)`, `ALTER POLICY executie_uscari_citire ON public.executie_uscari USING (public.fn_executie_nod_drept(proiect_id, false))`, /politici/],
    ['rolurile unei politici Storage', `ALTER POLICY executie_uscare_citire ON storage.objects TO authenticated, anon`, `ALTER POLICY executie_uscare_citire ON storage.objects TO authenticated`, /politici/],
    ['trigger dezactivat (același număr)', `ALTER TABLE public.executie_uscari DISABLE TRIGGER trg_executie_uscare_garda`, `ALTER TABLE public.executie_uscari ENABLE TRIGGER trg_executie_uscare_garda`, /trigger/],
    ['bucket făcut public', `UPDATE storage.buckets SET public = true WHERE id = 'executie-uscare'`, `UPDATE storage.buckets SET public = false WHERE id = 'executie-uscare'`, /bucket/],
    ['drept INSERT dat pe tabel', `GRANT INSERT ON public.executie_uscari TO authenticated`, `REVOKE INSERT ON public.executie_uscari FROM authenticated`, /drepturi/],
    ['coloană adăugată pe tabel', `ALTER TABLE public.executie_uscari ADD COLUMN zz int`, `ALTER TABLE public.executie_uscari DROP COLUMN zz`, /coloane/],
  ]) {
    await db.exec(sql)
    m = null; try { await revino(db) } catch (e) { m = e.message }
    const inca = (await db.query(`SELECT to_regclass('public.executie_uscari') IS NOT NULL AS e`)).rows[0].e
    ok(re.test(m || '') && inca, `revenirea refuză (${ce}): ${m}`)
    if (undo) await db.exec(undo)
  }
  await db.close()
  const db2 = await bazaNoua()
  await aplicaMig(db2)
  await revino(db2)
  const g = (await db2.query(`SELECT to_regclass('public.executie_uscari') IS NULL AND to_regclass('public.executie_uscare_incarcari') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_executie\\_uscare\\_%')
    AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare') AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'executie\\_uscare\\_%') AS gol`)).rows[0].gol
  ok(g, 'revenirea scoate tot (tabele, funcții, bucket, politici)')
  await aplicaMig(db2)
  const ab = await verifica(db2)
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db2.close()
}

console.log('4. mutanții migrării (fiecare TREBUIE să pice)')
const MUTANTI = [
  ['M1 citirea deschisă tuturor (USING true)', [["CREATE POLICY executie_uscari_citire ON public.executie_uscari FOR SELECT TO authenticated\n  USING (public.fn_executie_nod_drept(proiect_id, false));",
    'CREATE POLICY executie_uscari_citire ON public.executie_uscari FOR SELECT TO authenticated\n  USING (true);']]],
  ['M2 salvarea fără dreptul pe proiect', [["  IF NOT public.fn_executie_nod_drept(p_proiect, true) THEN\n    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';\n  END IF;\n  IF p_id IS NOT NULL THEN\n    IF r.versiune",
    "  IF p_id IS NOT NULL THEN\n    IF r.versiune"]]],
  ['M3 garda lasă raportul închis modificabil', [["    IF OLD.stare = 'anulata' OR (OLD.stare = 'inchisa' AND NEW.stare = 'inchisa') THEN", "    IF OLD.stare = 'anulata' THEN"]]],
  ['M4 redeschiderea fără nivelul admin', [["  IF p_actiune = 'redeschide' AND NOT public.fn_executie_contract_drept(r.proiect_id, true) THEN", "  IF false THEN"]]],
  ['M5 încărcarea în Storage și pe raport închis', [["AND (p_scriere IS FALSE OR u.stare = 'deschisa'))", 'AND true)']]],
  ['M6 INSERT direct pentru authenticated', [['  TO authenticated, service_role;\nREVOKE ALL ON SEQUENCE', '  TO authenticated, service_role;\nGRANT INSERT ON public.executie_uscari TO authenticated;\nREVOKE ALL ON SEQUENCE']]],
  ['M7 închiderea fără concluzie', [["    (13, 'concluzie', u.concluzie IS NULL),", "    (13, 'concluzie', false),"]]],
  ['M8 aceeași cheie cu alt conținut = duplicat', [["    IF j.amprenta IS DISTINCT FROM v_amprenta OR j.proiect_id IS DISTINCT FROM p_proiect THEN", '    IF false THEN']]],
  ['M9 kg cu orice zecimale', [["OR (e.x ->> 'intrare_kg')::numeric <> round((e.x ->> 'intrare_kg')::numeric, 3)))", '))']]],
  ['M10 poza fără verificarea fișierului', [["    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'executie-uscare' AND o.name = p_cale) THEN", '    IF false THEN']]],
  ['M11 CAS ignorat la salvare', [["    IF r.versiune IS DISTINCT FROM p_versiune THEN\n      RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'uscare', to_jsonb(r));\n    END IF;\n    IF r.stare <> 'deschisa' THEN",
    "    IF r.stare <> 'deschisa' THEN"]]],
  ['M12 cheie necunoscută ignorată', [["  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;", '']]],
  ['M13 pozele pe raport închis (garda pozei)', [["  IF v_stare IS DISTINCT FROM 'deschisa' THEN\n    RAISE EXCEPTION 'uscare: pozele se adaugă / scot doar cât raportul e deschis'", "  IF false THEN\n    RAISE EXCEPTION 'uscare: pozele se adaugă / scot doar cât raportul e deschis'"],
    ["  IF u.stare <> 'deschisa' THEN RAISE EXCEPTION 'uscare: raportul e % și pozele nu se mai schimbă', u.stare USING ERRCODE = '22023'; END IF;", ''],
    ["  IF v_stare IS DISTINCT FROM 'deschisa' THEN\n    RAISE EXCEPTION 'uscare: încărcările", "  IF false THEN\n    RAISE EXCEPTION 'uscare: încărcările"]]],
  ['M14 citirea fișierelor fără dreptul pe proiect', [['      public.fn_executie_nod_drept(split_part(p_name, \'/\', 1)::bigint, p_scriere)\n      AND EXISTS', '      true\n      AND EXISTS']]],
  ['M15 CONFORM fără dovada ultimului piston', [["    (14, 'dovada_conform', u.concluzie = 'conform'", "    (14, 'dovada_conform', false AND u.concluzie = 'conform'"]]],
  ['M16 punctul de rouă obligatoriu din nou', [["    (16, 'incarcari_nelamurite', coalesce(p_deschise, 0) > 0)", "    (16, 'incarcari_nelamurite', coalesce(p_deschise, 0) > 0),\n    (17, 'punct_roua_c', u.punct_roua_c IS NULL)"]]],
  ['M17 cântăririle nu urmăresc bureții declarați', [["    (9, 'cantariri', u.bureti_buc IS NULL OR jsonb_array_length(u.cantariri) <> u.bureti_buc", "    (9, 'cantariri', u.bureti_buc IS NULL OR jsonb_array_length(u.cantariri) = 0"]]],
  ['M18 fără justificarea pozelor lipsă', [["    (15, 'poze_justificare', u.poze_justificare IS NULL AND", "    (15, 'poze_justificare', false AND"]]],
  ['M19 încărcarea fără rezervare', [["      AND (p_scriere IS FALSE\n           OR EXISTS (SELECT 1 FROM public.executie_uscare_incarcari i", "      AND (true\n           OR EXISTS (SELECT 1 FROM public.executie_uscare_incarcari i"]]],
  ['M20 rezervările nelămurite nu blochează închiderea', [["    (16, 'incarcari_nelamurite', coalesce(p_deschise, 0) > 0)", "    (16, 'incarcari_nelamurite', false)"]]],
  ['M21 instantaneul meteo acceptat de la client', [["    IF p_id IS NULL OR r.meteo IS NULL OR v_meteo IS DISTINCT FROM r.meteo THEN", '    IF false THEN']]],
  ['M22 vremea curentă pentru o operațiune trecută', [["(v_norm ->> 'ora_inceput')::timestamptz)) > 3 * 3600 THEN", "(v_norm ->> 'ora_inceput')::timestamptz)) > 300 * 3600 THEN"]]],
  ['M23 creare fără revendicarea cheii (cheia citită fără proiect)', [["    IF j.amprenta IS DISTINCT FROM v_amprenta OR j.proiect_id IS DISTINCT FROM p_proiect THEN", "    IF j.amprenta IS DISTINCT FROM v_amprenta AND false THEN"]]],
  ['M24 sonda Storage dezactivată (politica generică trece)', [["  IF v_rau <> '' THEN\n    RAISE EXCEPTION '20261225a post: politicile EFECTIVE", "  IF false THEN\n    RAISE EXCEPTION '20261225a post: politicile EFECTIVE"]], `CREATE POLICY proprii ON storage.objects FOR SELECT TO authenticated USING (owner = auth.uid())`],
  ['M25 fără garda amprentei globale', [["  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema()", "  IF false AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema()"]], null, { l15: 'nimic' }],
]
for (const [nume, inl, preg, opt] of MUTANTI) {
  const db = await bazaNoua()
  if (preg) await db.exec(preg)
  let picat = null
  try {
    await aplicaMig(db, aplica(MIG, inl), opt)
    if (opt?.l15 === 'nimic') picat = null
    else {
      const ab = await verifica(db)
      if (ab.length) picat = 'verificări: ' + ab[0]
      if (preg) {
        await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('executie-uscare', '1/1/${randomUUID()}.jpg', '${U.FARA}')`)
        const v = await ca(db, 'authenticated', U.FARA, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'executie-uscare'`)
        if (!v.code && v.rows[0].n > 0) picat = (picat || '') + ` / un cont fără drept vede ${v.rows[0].n} fișiere`
      }
    }
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  // M25: migrarea fără gardă se aplică fără amprenta globală — proba e chiar faptul că TRECE (deci garda reală e cea care refuză, la secțiunea 2)
  if (opt?.l15 === 'nimic') ok(picat === null, `${nume}: fără gardă se aplică fără L15 (garda reală o refuză, secțiunea 2)`)
  else ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}

console.log('5. paritatea regulilor de închidere: src/uscareLogica.js (lipsaDinRand, pozeLipsa) = fn_executie_uscare_lipsa / _poze_lipsa, pe aceleași cazuri (L19)')
{
  const { lipsaDinRand, pozeLipsa } = await import('../../src/uscareLogica.js')
  const db = await bazaNoua()
  await aplicaMig(db)
  const baza = { ...COMPLET(), id: 1, proiect_id: 1, stare: 'deschisa', revizie: 0, versiune: 1 }
  const P = (...l) => l.map(x => { const [categorie, b] = x.split(':'); return { categorie, burete_nr: b ? Number(b) : null } })
  const TOATE = P('manometru', 'temperatura', 'pistoane', 'cantar_intrare:1', 'cantar_iesire:1', 'cantar_intrare:2', 'cantar_iesire:2', 'piston_final')
  const cazuri = [
    ['complet', {}, TOATE, 0], ['fără concluzie', { concluzie: null }, TOATE, 0], ['fără nimic', GOL(), [], 0], ['piston 0', { piston_pu_buc: 0 }, TOATE, 0],
    ['piston lipsă', { piston_pu_buc: null }, TOATE, 0], ['fără utilaje', { utilaje: [] }, TOATE, 0], ['fără cântăriri', { cantariri: [] }, TOATE, 0],
    ['cântărire pe jumătate', { cantariri: [{ nr: 1, intrare_kg: 2, iesire_kg: null, motiv: null }, ...COMPLET().cantariri.slice(1)] }, TOATE, 0],
    ['mai puține cântăriri decât bureți', { cantariri: COMPLET().cantariri.slice(0, 2) }, TOATE, 0],
    ['bureți lipsă', { bureti_buc: null }, TOATE, 0], ['0 bureți, fără cântăriri', { bureti_buc: 0, cantariri: [] }, P('manometru', 'temperatura', 'pistoane', 'piston_final'), 0],
    ['fără ore', { ora_inceput: null, ora_final: null }, TOATE, 0], ['punct de rouă lipsă (opțional)', { punct_roua_c: null, punct_roua_loc: null }, TOATE, 0],
    ['fără observații și semnatari', { observatii: null, semn_beneficiar_nume: null }, TOATE, 0],
    ['fără temperatură', { temperatura_c: null, temperatura_sursa: null }, TOATE, 0], ['fără lungime / constructor', { lungime_m: null, constructor: null }, TOATE, 0],
    ['CONFORM, piston umed', { piston_final_rezultat: 'umed' }, TOATE, 0], ['CONFORM, fără poza pistonului', {}, TOATE.filter(p => p.categorie !== 'piston_final'), 0],
    ['NECONFORM, piston umed, fără poza pistonului', { concluzie: 'neconform', piston_final_rezultat: 'umed' }, TOATE.filter(p => p.categorie !== 'piston_final'), 0],
    ['fără rezultatul pistonului', { piston_final_rezultat: null }, TOATE, 0],
    ['poze lipsă fără justificare', {}, P('piston_final', 'cantar_intrare:2'), 0], ['poze lipsă cu justificare', { poze_justificare: 'ceață' }, P('piston_final'), 0],
    ['cântar al buretelui „nu se aplică” nu e cerut', {}, TOATE, 0], ['o încărcare nelămurită', {}, TOATE, 1], ['două încărcări nelămurite, nimic altceva', {}, TOATE, 2],
  ]
  let dif = 0
  for (const [nume, schimb, poze, deschise] of cazuri) {
    const rand = { ...baza, ...schimb }
    const pj = JSON.stringify(poze)
    const sql = (await db.query(`SELECT public.fn_executie_uscare_lipsa(jsonb_populate_record(NULL::public.executie_uscari, $1::jsonb), $2::jsonb, $3) AS l,
                                        public.fn_executie_uscare_poze_lipsa(jsonb_populate_record(NULL::public.executie_uscari, $1::jsonb), $2::jsonb) AS p`,
      [JSON.stringify(rand), pj, deschise])).rows[0]
    const js = lipsaDinRand(rand, poze, deschise), jsP = pozeLipsa(rand, poze)
    if (JSON.stringify(sql.l) !== JSON.stringify(js) || JSON.stringify(sql.p) !== JSON.stringify(jsP)) { dif++; console.log(`     ${nume}: SQL ${JSON.stringify(sql)} / JS ${JSON.stringify({ l: js, p: jsP })}`) }
  }
  ok(dif === 0, `${cazuri.length} cazuri, ${dif} diferențe`)
  // așteptările scrise de mână pe câteva cazuri (nu doar paritatea)
  const asteptat = [
    ['complet', [], []], ['CONFORM, piston umed', ['dovada_conform'], []], ['poze lipsă fără justificare', ['poze_justificare'], ['manometru', 'temperatura', 'pistoane', 'cantar_intrare:1', 'cantar_iesire:1', 'cantar_iesire:2']],
    ['mai puține cântăriri decât bureți', ['cantariri'], []], ['NECONFORM, piston umed, fără poza pistonului', [], []], ['o încărcare nelămurită', ['incarcari_nelamurite'], []],
  ]
  let gresite = 0
  for (const [nume, l, p] of asteptat) {
    const [, schimb, poze, deschise] = cazuri.find(c => c[0] === nume)
    const rand = { ...baza, ...schimb }
    if (JSON.stringify(lipsaDinRand(rand, poze, deschise)) !== JSON.stringify(l) || JSON.stringify(pozeLipsa(rand, poze)) !== JSON.stringify(p)) { gresite++; console.log(`     ${nume}: ${JSON.stringify(lipsaDinRand(rand, poze, deschise))} ${JSON.stringify(pozeLipsa(rand, poze))}`) }
  }
  ok(gresite === 0, `${asteptat.length} cazuri cu așteptarea scrisă de mână`)
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
