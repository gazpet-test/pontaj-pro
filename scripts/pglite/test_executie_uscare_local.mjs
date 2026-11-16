// Proba LOCALĂ a migrării 20261225a (Execuție → raportul de uscare a conductei) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261225a_executie_uscare_schelet.sql + funcțiile de drept extrase EXACT din migrările lor (20261209a pentru
//   corpul cu restricția pe proiect, 20261201a / 20261203a pentru drepturile lor); amprentele lor = constantele din migrare (verificat).
// 1. Aplicarea ca runnerul (marcaj + plafon 2000), apoi VERIFICĂRILE de comportament (valorile așteptate scrise de mână, L25), ca rolul
//    authenticated cu JWT-ul fiecărui cont: manager de proiect (cont restrâns, editor pe P1), manager al altui proiect (P2), administrator
//    Execuție, owner, editor / viewer nerestrâns, cont fără drept, anonim; stările (închis = nemodificabil, redeschidere doar admin),
//    idempotența, CAS-ul, validările, pozele (Storage + RPC), jurnalul.
// 2. Refuzurile migrării (marcaj, plafon, lanțul de drept schimbat, reaplicare) + revenirea (refuz cu date, aplicare -> revenire -> re-aplicare,
//    amprentele revenirii = corpurile migrării).
// 3. MUTANȚI ai migrării: fiecare TREBUIE să pice (la aplicare sau la verificări).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_uscare_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { amprente, amprenteRevenire, corpFunctie, md5 } from '../executie_uscare_amprente.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261225a_executie_uscare_schelet.sql')
const MIG = citeste('supabase/migrations/20261225a_executie_uscare.sql')
const REV = citeste('supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql')
const M09 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')

// ── funcțiile de drept, EXACT ca în migrările lor (corpul din 20261209a; ACL-urile din migrarea care le-a creat) ──
function functie(text, cap, nume) {
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
  const f = functie(M09, cap, nume)
  const corp = f.slice(f.indexOf('$f$') + 3, f.lastIndexOf('$f$'))
  ok(md5(corp) === amp && MIG.includes(`'${amp}'`), `${nume}: ${md5(corp)}`)
  SQL_LANT += f + '\n' + (aclText === M09 ? acl(M09, nume) : acl(aclText, nume)) + '\n'
}

// ── conturile și datele (scrise de mână) ──
const U = {
  OWNER: '00000000-0000-0000-0000-0000000000a1', ADMIN: '00000000-0000-0000-0000-0000000000a2', EDITOR: '00000000-0000-0000-0000-0000000000a3',
  VIEWER: '00000000-0000-0000-0000-0000000000a4', MAN_P1: '00000000-0000-0000-0000-0000000000a5', MAN_P2: '00000000-0000-0000-0000-0000000000a6',
  CIT_P1: '00000000-0000-0000-0000-0000000000a7', FARA: '00000000-0000-0000-0000-0000000000a8', ADMIN_P2: '00000000-0000-0000-0000-0000000000a9',
}
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
  (10, 1, 'P2', 3200, 3900, 'activ'), (11, 1, 'P5', 20000, 21000, 'anulat'), (20, 2, 'P1', 0, 5000, 'activ');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(SQL_LANT)
  await db.exec(DATE)
  return db
}
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const jurnal = []
  try {
    await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}\n${text}\nCOMMIT;`, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261225a_executie_uscare', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261225a_executie_uscare_ROLLBACK', text, o)
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
const ACUM = Date.now()
const iso = oreInUrma => new Date(ACUM - oreInUrma * 3600e3).toISOString()
// formularul complet (toate cele 31 de chei), valori scrise de mână
const COMPLET = () => ({
  proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, inceput_planificat: iso(30), notificare_la: iso(60),
  notificare_ref: 'adresa nr. 1', data_operatie: ziBuc(ACUM), ora_inceput: iso(5), ora_final: iso(1), temperatura_c: 8.5, temperatura_sursa: 'manual',
  meteo_la: null, vreme: 'Senin', constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }, { denumire: 'Uscător aer', buc: 2 }],
  pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 3,
  cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45 }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2 }, { nr: 3, intrare_kg: 2.0, iesire_kg: 2.01 }],
  punct_roua_c: -20.5, punct_roua_loc: 'capăt aval', presiune_bar: 1.5, timp_deplasare_min: 35, observatii: 'fără', concluzie: 'conform',
  semn_constructor_nume: null, semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null,
})
const GOL = () => Object.fromEntries(Object.entries(COMPLET()).map(([k]) => [k, ['utilaje', 'cantariri'].includes(k) ? [] : null]))
const PLAN = () => ({ ...GOL(), proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900 })
const salveaza = (db, uid, proiect, id, versiune, date, cheie = randomUUID(), rol = 'authenticated') =>
  ca(db, rol, uid, `SELECT public.fn_executie_uscare_salveaza(${proiect}, ${id ?? 'NULL'}, ${versiune ?? 'NULL'}, ${lit(JSON.stringify(date))}::jsonb, ${lit(cheie)}::uuid) AS r`)
const stare = (db, uid, id, versiune, actiune, motiv = null, cheie = randomUUID()) =>
  ca(db, 'authenticated', uid, `SELECT public.fn_executie_uscare_stare(${id}, ${versiune}, ${lit(actiune)}, ${motiv == null ? 'NULL' : lit(motiv)}, ${lit(cheie)}::uuid) AS r`)
const poza = (db, uid, uscare, actiune, { poza: pz = null, cale = null, categorie = null, burete = null, legenda = null, cheie = randomUUID() } = {}) =>
  ca(db, 'authenticated', uid, `SELECT public.fn_executie_uscare_poza(${uscare}, ${lit(actiune)}, ${pz ?? 'NULL'}, ${cale == null ? 'NULL' : lit(cale)}, ${categorie == null ? 'NULL' : lit(categorie)}, ${burete ?? 'NULL'}, ${legenda == null ? 'NULL' : lit(legenda)}, ${lit(cheie)}::uuid) AS r`)
const urca = (db, uid, cale, bucket = 'executie-uscare') =>
  ca(db, 'authenticated', uid, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES (${lit(bucket)}, ${lit(cale)}, ${lit(uid)}::uuid) RETURNING name`)
const cale = (proiect, uscare) => `${proiect}/${uscare}/${randomUUID()}.jpg`

// ── VERIFICĂRILE (pe o bază cu migrarea aplicată); întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  const asteptCod = (r, cod, ce) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return null } return r.rows[0]?.r ?? r.rows }
  // A. crearea: managerul P1 pe P1 (cu tronsonul de probă 10); admin / owner / editor nerestrâns; refuzurile
  const a1 = asteptOk(await salveaza(db, U.MAN_P1, 1, null, null, PLAN()), 'A manager P1 creează pe P1')
  const id1 = a1?.uscare?.id
  if (a1 && (a1.ok !== true || a1.uscare.versiune !== 1 || a1.uscare.stare !== 'deschisa' || a1.uscare.creat_de !== U.MAN_P1)) ab.push('A rezultatul creării: ' + JSON.stringify(a1))
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
  // B. citirea, prin RLS
  const nr = async (uid, rol = 'authenticated') => { const r = await ca(db, rol, uid, 'SELECT proiect_id, count(*)::int AS n FROM public.executie_uscari GROUP BY 1 ORDER BY 1'); return r.code ? r.code : JSON.stringify(r.rows.map(x => [Number(x.proiect_id), x.n])) }
  for (const [cont, asteptat] of [['MAN_P1', '[[1,2]]'], ['CIT_P1', '[[1,2]]'], ['MAN_P2', '[[2,2]]'], ['ADMIN_P2', '[[2,2]]'], ['VIEWER', '[[1,2],[2,2]]'],
                                  ['ADMIN', '[[1,2],[2,2]]'], ['OWNER', '[[1,2],[2,2]]'], ['FARA', '[]']]) {
    const v = await nr(U[cont]); if (v !== asteptat) ab.push(`B citire ${cont}: ${v} (aștepta ${asteptat})`)
  }
  asteptCod(await ca(db, 'anon', null, 'SELECT count(*) FROM public.executie_uscari'), '42501', 'B anon citește')
  const jFara = await ca(db, 'authenticated', U.FARA, 'SELECT count(*)::int AS n FROM public.executie_uscare_jurnal')
  if (jFara.code || jFara.rows[0].n !== 0) ab.push('B jurnalul vizibil fără drept: ' + JSON.stringify(jFara))
  const jP2 = await ca(db, 'authenticated', U.MAN_P2, `SELECT count(*)::int AS n FROM public.executie_uscare_jurnal WHERE proiect_id = 1`)
  if (jP2.code || jP2.rows[0].n !== 0) ab.push('B jurnalul P1 vizibil managerului P2: ' + JSON.stringify(jP2))
  // C. scrierile directe (PostgREST) refuzate
  asteptCod(await ca(db, 'authenticated', U.OWNER, `INSERT INTO public.executie_uscari (proiect_id, tronson, km_de_la_m, km_pana_la_m) VALUES (1, 'x', 0, 10)`), '42501', 'C INSERT direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `UPDATE public.executie_uscari SET tronson = 'y' WHERE id = ${id1}`), '42501', 'C UPDATE direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `DELETE FROM public.executie_uscari WHERE id = ${id1}`), '42501', 'C DELETE direct')
  asteptCod(await ca(db, 'authenticated', U.MAN_P1, `INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, cheie, amprenta) VALUES (${id1}, 1, 'salvare', '${randomUUID()}', '${'0'.repeat(32)}')`), '42501', 'C INSERT direct în jurnal')
  // D. salvarea: CAS, idempotență
  const k1 = randomUUID()
  const d1 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 700, temperatura_c: 8.5, temperatura_sursa: 'manual' }, k1), 'D salvarea v1')
  if (d1 && (d1.uscare?.versiune !== 2 || Number(d1.uscare?.lungime_m) !== 700 || d1.duplicat !== false)) ab.push('D salvarea v1: ' + JSON.stringify(d1))
  const d2 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 700, temperatura_c: 8.5, temperatura_sursa: 'manual' }, k1), 'D reluarea aceleiași apăsări')
  if (d2 && (d2.duplicat !== true || d2.uscare?.versiune !== 2)) ab.push('D reluarea nu e „duplicat”: ' + JSON.stringify(d2))
  asteptCod(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 701 }, k1), '22023', 'D aceeași cheie, alt conținut')
  const d3 = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 1, { ...PLAN(), lungime_m: 702 }), 'D versiune veche')
  if (d3 && (d3.ok !== false || d3.motiv !== 'conflict')) ab.push('D versiunea veche nu dă conflict: ' + JSON.stringify(d3))
  const jd = await ca(db, 'authenticated', U.MAN_P1, `SELECT valori FROM public.executie_uscare_jurnal WHERE cheie = '${k1}'`)
  if (jd.code || JSON.stringify(jd.rows[0]?.valori?.lungime_m) !== '[null,700]') ab.push('D jurnalul salvării (diferența lungimii): ' + JSON.stringify(jd.rows?.[0]?.valori))
  // E. validările (nimic ignorat sau rotunjit pe tăcute)
  const v2 = 2
  for (const [ce, date] of [
    ['cheie necunoscută', { ...PLAN(), strain: 1 }], ['cheie lipsă', (() => { const x = PLAN(); delete x.vreme; return x })()],
    ['temperatura cu 2 zecimale', { ...PLAN(), temperatura_c: 8.55, temperatura_sursa: 'manual' }], ['temperatura fără sursă', { ...PLAN(), temperatura_c: 8.5 }],
    ['meteo fără ora datelor', { ...PLAN(), temperatura_c: 8.5, temperatura_sursa: 'meteo' }], ['ora meteo la sursa manuală', { ...PLAN(), temperatura_c: 8.5, temperatura_sursa: 'manual', meteo_la: iso(1) }],
    ['kg cu 4 zecimale', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 2.1234, iesire_kg: null }] }], ['burete dublu', { ...PLAN(), cantariri: [{ nr: 1, intrare_kg: 1, iesire_kg: null }, { nr: 1, intrare_kg: 1, iesire_kg: null }] }],
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
  // F. închiderea: incompletă = refuz (inclusiv DOAR fără concluzie); completă = ok; apoi nimic nu se mai schimbă
  asteptCod(await stare(db, U.MAN_P1, id1, v2, 'inchide'), '22023', 'F închiderea incompletă')
  const fc = asteptOk(await salveaza(db, U.MAN_P1, 1, id1, v2, { ...COMPLET(), concluzie: null }), 'F salvarea fără concluzie')
  asteptCod(await stare(db, U.MAN_P1, id1, 3, 'inchide'), '22023', 'F închiderea doar fără concluzie')
  if (fc) asteptOk(await salveaza(db, U.MAN_P1, 1, id1, 3, COMPLET()), 'F salvarea completă')
  // pozele cât e deschis
  const c1 = cale(1, id1)
  asteptOk(await urca(db, U.MAN_P1, c1), 'H managerul P1 urcă fișierul')
  const p1 = asteptOk(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c1, categorie: 'manometru', legenda: 'manometru 1,5 bar' }), 'H înregistrarea pozei')
  const c2 = cale(1, id1)
  asteptOk(await urca(db, U.MAN_P1, c2), 'H al doilea fișier')
  asteptOk(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c2, categorie: 'cantar_intrare', burete: 1 }), 'H poza cântarului (burete 1)')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c2, categorie: 'cantar_intrare', burete: 1 }), '22023', 'H aceeași poză de două ori')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: cale(1, id1), categorie: 'manometru' }), '22023', 'H poză fără fișier încărcat')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c1.replace(/^1\//, '2/'), categorie: 'manometru' }), '22023', 'H cale cu alt proiect')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c2, categorie: 'manometru', burete: 2 }), '22023', 'H burete la manometru')
  asteptCod(await poza(db, U.MAN_P2, id1, 'adauga', { cale: c2, categorie: 'manometru' }), '42501', 'H managerul P2 pe raportul P1')
  asteptCod(await urca(db, U.MAN_P2, cale(1, id1)), '42501', 'H managerul P2 urcă în P1')
  asteptCod(await urca(db, U.CIT_P1, cale(1, id1)), '42501', 'H cititorul P1 urcă')
  asteptCod(await urca(db, U.FARA, cale(1, id1)), '42501', 'H cont fără drept urcă')
  asteptCod(await urca(db, U.MAN_P1, `1/${id1}/poza.png`), '42501', 'H cale de altă formă')
  asteptCod(await urca(db, U.MAN_P1, cale(1, 999999)), '42501', 'H uscare inexistentă')
  asteptCod(await urca(db, U.MAN_P1, cale(2, id1)), '42501', 'H uscare P1 sub proiectul P2')
  const vede = async uid => { const r = await ca(db, 'authenticated', uid, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'executie-uscare' AND name LIKE '1/%'`); return r.code || r.rows[0].n }
  for (const [cont, n] of [['MAN_P1', 2], ['CIT_P1', 2], ['OWNER', 2], ['MAN_P2', 0], ['FARA', 0]]) { const v = await vede(U[cont]); if (v !== n) ab.push(`H ${cont} vede ${v} fișiere P1 (aștepta ${n})`) }
  const sterge = await ca(db, 'authenticated', U.MAN_P1, `DELETE FROM storage.objects WHERE bucket_id = 'executie-uscare' RETURNING name`)
  if (sterge.code || sterge.rows.length !== 0) ab.push('H clientul a șters un fișier: ' + JSON.stringify(sterge))
  const sch = await ca(db, 'authenticated', U.MAN_P1, `UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'executie-uscare' RETURNING name`)
  if (sch.code || sch.rows.length !== 0) ab.push('H clientul a modificat un fișier: ' + JSON.stringify(sch))
  // scoaterea unei poze (rândul iese, fișierul rămâne)
  const pz = p1?.poza?.id
  asteptOk(await poza(db, U.MAN_P1, id1, 'scoate', { poza: pz }), 'H scoaterea pozei')
  const ramas = (await db.query(`SELECT count(*)::int AS n FROM storage.objects WHERE name = ${lit(c1)}`)).rows[0].n
  if (ramas !== 1) ab.push('H fișierul pozei scoase a dispărut')
  // închiderea completă
  const fi = asteptOk(await stare(db, U.MAN_P1, id1, 4, 'inchide'), 'F închiderea completă')
  if (fi && (fi.uscare?.stare !== 'inchisa' || fi.uscare?.versiune !== 5 || fi.uscare?.inchis_de !== U.MAN_P1)) ab.push('F rezultatul închiderii: ' + JSON.stringify(fi))
  asteptCod(await salveaza(db, U.MAN_P1, 1, id1, 5, COMPLET()), '22023', 'F salvarea pe raport închis')
  asteptCod(await urca(db, U.MAN_P1, cale(1, id1)), '42501', 'F urcare pe raport închis')
  asteptCod(await poza(db, U.MAN_P1, id1, 'adauga', { cale: c1, categorie: 'manometru' }), '22023', 'F poză pe raport închis')
  asteptCod(await stare(db, U.MAN_P1, id1, 5, 'anuleaza', 'gresit'), '22023', 'F anularea unui raport închis')
  // pe ORICE cale: nici proprietarul tabelului (postgres) nu modifică un raport închis / o poză / jurnalul
  for (const [ce, sql] of [['UPDATE raport închis', `UPDATE public.executie_uscari SET observatii = 'x', versiune = versiune + 1 WHERE id = ${id1}`],
                           ['DELETE raport', `DELETE FROM public.executie_uscari WHERE id = ${id1}`],
                           ['INSERT poză pe raport închis', `INSERT INTO public.executie_uscare_poze (uscare_id, proiect_id, categorie, cale) VALUES (${id1}, 1, 'altele', ${lit(c1.replace(/[0-9a-f]{8}-/, '00000000-'))})`],
                           ['UPDATE jurnal', `UPDATE public.executie_uscare_jurnal SET motiv = 'x' WHERE uscare_id = ${id1}`],
                           ['TRUNCATE jurnal', `TRUNCATE public.executie_uscare_jurnal`]]) {
    let m = null; try { await db.exec(sql) } catch (e) { m = e.code }
    if (m !== '42501') ab.push(`F ${ce} ca proprietar: ${m || 'a trecut'}`)
  }
  // G. redeschiderea: doar admin Execuție / owner, cu motiv; conținutul închis rămâne în jurnal
  asteptCod(await stare(db, U.MAN_P1, id1, 5, 'redeschide', 'corectură'), '42501', 'G managerul (editor) redeschide')
  asteptCod(await stare(db, U.ADMIN_P2, id1, 5, 'redeschide', 'corectură'), '42501', 'G admin restrâns pe P2 redeschide P1')
  asteptCod(await stare(db, U.ADMIN, id1, 5, 'redeschide', null), '22023', 'G redeschiderea fără motiv')
  const g1 = asteptOk(await stare(db, U.ADMIN, id1, 5, 'redeschide', 'corectură temperatură'), 'G admin redeschide')
  if (g1 && (g1.uscare?.stare !== 'deschisa' || g1.uscare?.revizie !== 1 || g1.uscare?.inchis_la !== null)) ab.push('G rezultatul redeschiderii: ' + JSON.stringify(g1))
  const jr = await ca(db, 'authenticated', U.VIEWER, `SELECT actiune, motiv, valori FROM public.executie_uscare_jurnal WHERE uscare_id = ${id1} AND actiune IN ('inchidere', 'redeschidere') ORDER BY id`)
  if (jr.code || jr.rows.length !== 2 || jr.rows[1].motiv !== 'corectură temperatură' || jr.rows[1].valori?.raport?.stare !== 'inchisa'
      || jr.rows[1].valori?.raport?.concluzie !== 'conform' || jr.rows[0].valori?.poze?.length !== 1) ab.push('G jurnalul închidere / redeschidere: ' + JSON.stringify(jr.rows || jr))
  asteptOk(await stare(db, U.OWNER, id1, 6, 'inchide'), 'G owner închide din nou (revizia 1)')
  // I. anularea: motiv obligatoriu, finală
  asteptCod(await stare(db, U.ADMIN, id2, 1, 'anuleaza', null), '22023', 'I anularea fără motiv')
  asteptOk(await stare(db, U.ADMIN, id2, 1, 'anuleaza', 'dublură'), 'I anularea')
  asteptCod(await salveaza(db, U.ADMIN, 2, id2, 2, PLAN()), '22023', 'I salvarea unui raport anulat')
  asteptCod(await stare(db, U.ADMIN, id2, 2, 'redeschide', 'x'), '22023', 'I redeschiderea unui raport anulat')
  asteptCod(await stare(db, U.ADMIN, id2, 2, 'inchide'), '22023', 'I închiderea unui raport anulat')
  // funcțiile interne nu se cheamă din API
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_executie_uscare_tranzitie('deschisa', 'inchide')`), '42501', 'D funcție internă din API')
  return ab
}

console.log('1. aplicarea migrării + verificările')
{
  const db = await bazaNoua()
  const j = await aplicaMig(db)
  ok(j.some(m => /sfarsit la \d+ ms/.test(m)), 'NOTICE-ul de timp: ' + j.filter(m => /ms de la BEGIN/.test(m)).join(' | '))
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
  ['lanțul de drept schimbat', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
    return aplicaMig(db)
  }, /lantul de drept \(inainte\) difera de amprenta revizuita: public\.fn_executie_proiect_permis/],
  ['tronsoanele de probă lipsă', async db => { await db.exec('DROP TABLE public.executie_probe_tronsoane'); return aplicaMig(db) }, /executie_probe_tronsoane\.id lipseste/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const gol = (await db.query(`SELECT to_regclass('public.executie_uscari') IS NULL AS g`)).rows[0].g
  ok(re.test(m || '') && gol, `${nume}: ${m}`)
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
  await db.exec(`CREATE FUNCTION public.zz_foloseste() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT count(*) FROM public.executie_uscari $f$;`)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/alte obiecte depind/.test(m || ''), 'revenirea refuză când altă funcție folosește tabelele: ' + m)
  await db.exec('DROP FUNCTION public.zz_foloseste()')
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_uscare_tranzitie(p_veche text, p_actiune text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT 'inchisa'::text $f$;`)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/starea nu e cea din 20261225a \(pasul 1, functii: public\.fn_executie_uscare_tranzitie/.test(m || ''), 'revenirea refuză o funcție schimbată: ' + m)
  await db.close()
  const db2 = await bazaNoua()
  await aplicaMig(db2)
  await revino(db2)
  const g = (await db2.query(`SELECT to_regclass('public.executie_uscari') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_executie\\_uscare\\_%')
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
  ['M2 salvarea fără dreptul pe proiect', [["  IF NOT public.fn_executie_nod_drept(p_proiect, true) THEN\n    RAISE EXCEPTION 'uscare: raportul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';\n  END IF;\n  v_amprenta := md5(jsonb_build_object('op', 'salveaza'",
    "  v_amprenta := md5(jsonb_build_object('op', 'salveaza'"]]],
  ['M3 garda lasă raportul închis modificabil', [["    IF OLD.stare = 'anulata' OR (OLD.stare = 'inchisa' AND NEW.stare = 'inchisa') THEN", "    IF OLD.stare = 'anulata' THEN"]]],
  ['M4 redeschiderea fără nivelul admin', [["  IF p_actiune = 'redeschide' AND NOT public.fn_executie_contract_drept(r.proiect_id, true) THEN", "  IF false THEN"]]],
  ['M5 încărcarea în Storage și pe raport închis', [["AND (p_scriere IS FALSE OR u.stare = 'deschisa'))", 'AND true)']]],
  ['M6 INSERT direct pentru authenticated', [['GRANT SELECT ON public.executie_uscari, public.executie_uscare_poze, public.executie_uscare_jurnal TO authenticated, service_role;',
    'GRANT SELECT ON public.executie_uscari, public.executie_uscare_poze, public.executie_uscare_jurnal TO authenticated, service_role;\nGRANT INSERT ON public.executie_uscari TO authenticated;']]],
  ['M7 închiderea fără concluzie', [["    (14, 'concluzie', u.concluzie IS NULL)", "    (14, 'concluzie', false)"]]],
  ['M8 aceeași cheie cu alt conținut = duplicat', [["    IF j.amprenta = v_amprenta THEN\n      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', (SELECT",
    "    IF true THEN\n      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'uscare', (SELECT"]]],
  ['M9 kg cu orice zecimale', [["OR (e.x ->> 'intrare_kg')::numeric <> round((e.x ->> 'intrare_kg')::numeric, 3)))", '))']]],
  ['M10 poza fără verificarea fișierului', [["    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'executie-uscare' AND o.name = p_cale) THEN", '    IF false THEN']]],
  ['M11 CAS ignorat la salvare', [["    IF r.versiune IS DISTINCT FROM p_versiune THEN\n      RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'uscare', to_jsonb(r));\n    END IF;\n    IF r.stare <> 'deschisa' THEN",
    "    IF r.stare <> 'deschisa' THEN"]]],
  ['M12 cheie necunoscută ignorată', [["  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'uscare: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;", '']]],
  ['M13 pozele pe raport închis (garda pozei)', [["  IF v_stare IS DISTINCT FROM 'deschisa' THEN\n    RAISE EXCEPTION 'uscare: pozele se adaugă / scot doar cât raportul e deschis'", "  IF false THEN\n    RAISE EXCEPTION 'uscare: pozele se adaugă / scot doar cât raportul e deschis'"],
    ["  IF u.stare <> 'deschisa' THEN RAISE EXCEPTION 'uscare: raportul e % și pozele nu se mai schimbă', u.stare USING ERRCODE = '22023'; END IF;", '']]],
  ['M14 citirea fișierelor fără dreptul pe proiect', [['      public.fn_executie_nod_drept(split_part(p_name, \'/\', 1)::bigint, p_scriere)\n      AND EXISTS', '      true\n      AND EXISTS']]],
]
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, aplica(MIG, inl))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
  await db.close()
}

console.log('5. paritatea „ce lipsește la închidere”: src/uscareLogica.js (lipsaDinRand) = fn_executie_uscare_lipsa, pe aceleași cazuri (L19)')
{
  const { lipsaDinRand } = await import('../../src/uscareLogica.js')
  const db = await bazaNoua()
  await aplicaMig(db)
  const baza = { ...COMPLET(), id: 1, proiect_id: 1, stare: 'deschisa', revizie: 0, versiune: 1 }
  const cazuri = [
    ['complet', {}], ['fără concluzie', { concluzie: null }], ['fără nimic', GOL()], ['piston 0', { piston_pu_buc: 0 }], ['piston lipsă', { piston_pu_buc: null }],
    ['fără utilaje', { utilaje: [] }], ['fără cântăriri', { cantariri: [] }], ['cântărire pe jumătate', { cantariri: [{ nr: 1, intrare_kg: 2, iesire_kg: null }] }],
    ['o cântărire completă', { cantariri: [{ nr: 1, intrare_kg: 2, iesire_kg: 2.1 }] }], ['fără ore', { ora_inceput: null, ora_final: null }],
    ['fără punct de rouă (loc)', { punct_roua_loc: null }], ['fără observații și semnatari', { observatii: null, semn_beneficiar_nume: null }],
    ['fără temperatură', { temperatura_c: null, temperatura_sursa: null }], ['fără lungime / constructor', { lungime_m: null, constructor: null }],
  ]
  let dif = 0
  for (const [nume, schimb] of cazuri) {
    const rand = { ...baza, ...schimb }
    const sql = (await db.query(`SELECT public.fn_executie_uscare_lipsa(jsonb_populate_record(NULL::public.executie_uscari, $1::jsonb)) AS l`, [JSON.stringify(rand)])).rows[0].l
    const js = lipsaDinRand(rand)
    if (JSON.stringify(sql) !== JSON.stringify(js)) { dif++; console.log(`     ${nume}: SQL ${JSON.stringify(sql)} / JS ${JSON.stringify(js)}`) }
  }
  ok(dif === 0, `${cazuri.length} cazuri, ${dif} diferențe`)
  await db.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
