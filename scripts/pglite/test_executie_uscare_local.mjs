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
// 2. Refuzurile migrării (marcaj, plafon, fără amprenta globală — și o tabelă „înainte” veche citită acum —, bugetul lock-ului fără coliziune,
//    lanțul de drept schimbat, politici Storage generice — sonda politicilor EFECTIVE pe 7 identități, cu owner_id și metadate —, drepturi pe
//    coloane) + căile fără refuz fals (politică fără dreptul de tabel, privilegiile implicite ale altui rol) + revenirea (refuz cu date,
//    definiții / structură / ACL schimbate, aplicare -> revenire -> re-aplicare). Secțiunea K: retragerea cheii („Renunț”, runda 3).
// 3. MUTANȚI ai migrării: fiecare TREBUIE să pice (la aplicare, la verificări sau prin detectorul lui).
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

// ── 0b. VALIDATORUL REAL al runnerului (scripts/livrare_validator.py, cu plafon, ca în scripts/livrare_migrare.sh), pe fișierele EXACTE din
// repo (octeții lor, nu copia fără CR), migrarea ȘI revenirea — runda 4: proba PGlite nu trecea prin validator, deci un artefact refuzat de
// runner înainte de orice conexiune putea trece aici. Plus formele vechi (refuzate): literalul obișnuit cu backslash și numele parametrului
// de plafon în comentariu.
const validator = fisier => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', '--plafon-tranzactie'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
console.log('0b. validatorul runnerului (cu plafon) pe migrare și pe revenire')
{
  const vm = validator(join(ROOT, 'supabase/migrations/20261225a_executie_uscare.sql'))
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul: ' + vm.out)
  const vr = validator(join(ROOT, 'supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql'))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul: ' + vr.out)
  const brut = readFileSync(join(ROOT, 'supabase/migrations/20261225a_executie_uscare.sql'), 'utf8')
  const fVechi1 = join(TMP, 'vechi_literal.sql'), fVechi2 = join(TMP, 'vechi_comentariu.sql')
  writeFileSync(fVechi1, aplica(brut, [["cale ~ E'^[0-9]{1,18}/", "cale ~ '^[0-9]{1,18}/"], ["\\\\.jpg$'),", "\\.jpg$'),"]]))
  writeFileSync(fVechi2, '-- plafon: transaction' + '_timeout = 2000\n' + brut)
  const v1 = validator(fVechi1), v2 = validator(fVechi2)
  ok(!v1.ok && /backslash/.test(v1.out), 'forma veche a CHECK-ului (backslash în literal obișnuit) e refuzată: ' + v1.out.slice(0, 120))
  ok(!v2.ok && /apare de/.test(v2.out), 'numele parametrului de plafon într-un comentariu e refuzat: ' + v2.out.slice(0, 120))
  // scriptul cu două sesiuni (rulat doar pe clonă): sintaxa întregului script (bash -n) și linia \echo a SQLSTATE-ului (runda 4: variabila
  // psql între ghilimele simple nu se înlocuia -> P2 / R2 nu puteau dovedi 22023); linia generată = exact cea probată pe clonă
  const S2 = join(ROOT, 'supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh')
  let sn = null; try { execFileSync('bash', ['-n', S2], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { sn = String(e.stderr || e.message) }
  ok(sn === null, 'scriptul cu două sesiuni: bash -n ' + (sn || 'OK'))
  const s2 = citeste('supabase/tests/20261225a_executie_uscare_doua_sesiuni.sh')
  const linie = execFileSync('bash', ['-c', s2.split('\n').find(l => l.startsWith('ECHO_SQLSTATE=')) + '; printf "%s" "$ECHO_SQLSTATE"'], { encoding: 'utf8' })
  const folosiri = (s2.match(/"\$ECHO_SQLSTATE"/g) || []).length
  ok(linie === '\\echo R=:LAST_ERROR_SQLSTATE' && folosiri === 2 && !/LAST_ERROR_SQLSTATE'/.test(s2.replace(/^ECHO_SQLSTATE=.*$/m, '')),
    `linia SQLSTATE din P2 / R2 = „${linie}” (${folosiri} folosiri), fără variabila între ghilimele simple`)
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
  // 0. runda 4: CHECK-ul căii scris E'…\\.jpg$' = ACEEAȘI expresie în catalog (un singur backslash: punctul e literal), pe ambele tabele
  const ck = (await db.query(`SELECT conname, (regexp_match(pg_get_constraintdef(oid), $$~ '(.*)'::text$$))[1] AS re FROM pg_constraint
    WHERE conrelid IN ('public.executie_uscare_incarcari'::regclass, 'public.executie_uscare_poze'::regclass) AND conname LIKE '%\\_cale\\_check' ORDER BY conname`)).rows
  const reAsteptat = '^[0-9]{1,18}/[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$'
  if (ck.length !== 2 || ck.some(c => c.re !== reAsteptat)) ab.push('0 CHECK-ul căii în catalog: ' + JSON.stringify(ck))
  for (const c of ck) {
    const t = (await db.query(`SELECT $1 ~ $3 AS bun, $2 ~ $3 AS rau`, ['1/2/0f0e0d0c-0000-4000-8000-000000000001.jpg', '1/2/0f0e0d0c-0000-4000-8000-000000000001xjpg', c.re])).rows[0]
    if (!t.bun || t.rau) ab.push(`0 ${c.conname}: calea bună ${t.bun}, „xjpg” ${t.rau} (punctul trebuie să fie literal)`)
  }
  // A. crearea: managerul P1 pe P1 (cu tronsonul de probă 10); admin / owner / editor nerestrâns; refuzurile
  const kA = randomUUID()
  const a1 = asteptOk(await salveaza(db, U.MAN_P1, 1, null, null, PLAN(), kA), 'A manager P1 creează pe P1')
  const id1 = a1?.uscare?.id
  if (a1 && (a1.ok !== true || a1.uscare.versiune !== 1 || a1.uscare.stare !== 'deschisa' || a1.uscare.creat_de !== U.MAN_P1)) ab.push('A rezultatul creării: ' + JSON.stringify(a1))
  // reîncercarea creării cu ACEEAȘI cheie (după un timeout) = același raport, nu altul
  const a1b = asteptOk(await salveaza(db, U.MAN_P1, 1, null, null, PLAN(), kA), 'A reîncercarea creării cu aceeași cheie')
  if (a1b && (a1b.duplicat !== true || a1b.uscare?.id !== id1)) ab.push('A reîncercarea a creat alt raport: ' + JSON.stringify(a1b))
  asteptCod(await salveaza(db, U.MAN_P1, 2, null, null, { ...PLAN(), proba_id: null }, kA), '22023', 'A aceeași cheie (același autor) pe alt proiect')
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
  // K. retragerea unei cereri nelămurite („Renunț”, runda 3): întâi serverul spune dacă s-a aplicat; doar dacă nu, cheia e retrasă DEFINITIV
  const retrage = (uid, proiect, cheie, rol = 'authenticated') => ca(db, rol, uid, `SELECT public.fn_executie_uscare_retrage(${proiect}, ${lit(cheie)}::uuid) AS r`)
  const nrJurnal = async () => (await db.query('SELECT count(*)::int AS n FROM public.executie_uscare_jurnal')).rows[0].n
  const nj0 = await nrJurnal()
  const k1r = asteptOk(await retrage(U.MAN_P1, 1, kA), 'K retragerea unei chei APLICATE (crearea din A)')
  if (k1r && (k1r.aplicat !== true || k1r.retrasa !== false || Number(k1r.uscare_id) !== Number(id1) || k1r.actiune !== 'creare')) ab.push('K cheia aplicată: ' + JSON.stringify(k1r))
  if (await nrJurnal() !== nj0) ab.push('K întrebarea pe o cheie aplicată a scris în jurnal')
  const kLost = randomUUID()
  const k2r = asteptOk(await retrage(U.MAN_P1, 1, kLost), 'K retragerea unei chei neaplicate (cererea pierdută)')
  if (k2r && (k2r.aplicat !== false || k2r.retrasa !== true || k2r.duplicat !== false)) ab.push('K cheia neaplicată: ' + JSON.stringify(k2r))
  const k3r = asteptOk(await retrage(U.MAN_P1, 1, kLost), 'K reluarea retragerii')
  if (k3r && (k3r.retrasa !== true || k3r.duplicat !== true)) ab.push('K reluarea retragerii: ' + JSON.stringify(k3r))
  // cererea pierdută ajunge DUPĂ retragere: refuzată (nicio dublură), pe toate cele trei RPC-uri
  asteptMesaj(await salveaza(db, U.MAN_P1, 1, null, null, PLAN(), kLost), /retrasă/, 'K crearea cu o cheie retrasă')
  const nU = (await db.query('SELECT count(*)::int AS n FROM public.executie_uscari')).rows[0].n
  const kS = randomUUID(); asteptOk(await retrage(U.MAN_P1, 1, kS), 'K retragerea cheii unei închideri')
  asteptMesaj(await stare(db, U.MAN_P1, n1?.uscare?.id ?? id1, 99, 'anuleaza', 'x', kS), /retrasă/, 'K starea cu o cheie retrasă')
  const kP = randomUUID(); asteptOk(await retrage(U.MAN_P1, 1, kP), 'K retragerea cheii unei poze')
  asteptMesaj(await poza(db, U.MAN_P1, id1, 'rezerva', { cale: cale(1, id1), categorie: 'altele', cheie: kP }), /retrasă/, 'K poza cu o cheie retrasă')
  if ((await db.query('SELECT count(*)::int AS n FROM public.executie_uscari')).rows[0].n !== nU) ab.push('K o cerere retrasă a creat totuși un raport')
  // drepturile retragerii
  asteptCod(await retrage(U.MAN_P2, 1, kA), '42501', 'K managerul P2 întreabă de o cheie din P1')
  asteptCod(await retrage(U.MAN_P1, 2, kA), '22023', 'K cheia P1 întrebată pe alt proiect')
  asteptCod(await retrage(U.CIT_P1, 1, randomUUID()), '42501', 'K cititorul P1 retrage (cere drept de scriere)')
  asteptCod(await retrage(U.FARA, 1, randomUUID()), '42501', 'K cont fără drept retrage')
  asteptCod(await retrage(null, 1, randomUUID()), '42501', 'K fără JWT')
  asteptCod(await retrage(null, 1, randomUUID(), 'anon'), '42501', 'K anon')
  const jr2 = await ca(db, 'authenticated', U.CIT_P1, `SELECT uscare_id, actiune, valori, creat_de FROM public.executie_uscare_jurnal WHERE cheie = ${lit(kLost)}`)
  if (jr2.code || jr2.rows.length !== 1 || jr2.rows[0].uscare_id !== null || jr2.rows[0].actiune !== 'cheie_retrasa' || jr2.rows[0].creat_de !== U.MAN_P1) ab.push('K retragerea în jurnal (vizibilă pe proiect, legată de autor): ' + JSON.stringify(jr2))
  // K4 (runda 4, verdict P2-4): cheia e a AUTORULUI. Scenariul din verdict: A (MAN_P2) are o cerere întârziată pe P2 cu cheia K, încă absentă;
  // B (MAN_P1, doar P1) „retrage” K pe P1 -> retragerea e a LUI B; cererea lui A ajunge apoi și SE APLICĂ (pe codul vechi: refuz 22023)
  const kAlt = randomUUID()
  const k4b = asteptOk(await retrage(U.MAN_P1, 1, kAlt), 'K4 B retrage pe P1 cheia (necunoscută lui) a lui A')
  if (k4b && (k4b.retrasa !== true || k4b.duplicat !== false)) ab.push('K4 retragerea lui B: ' + JSON.stringify(k4b))
  const k4a = asteptOk(await salveaza(db, U.MAN_P2, 2, null, null, { ...PLAN(), proba_id: null, tronson: 'K4 A' }, kAlt), 'K4 cererea întârziată a lui A pe P2 se aplică (nu e blocată de retragerea lui B)')
  if (k4a && (k4a.ok !== true || k4a.duplicat !== false || Number(k4a.uscare?.proiect_id) !== 2)) ab.push('K4 cererea lui A: ' + JSON.stringify(k4a))
  const k4c = asteptOk(await retrage(U.MAN_P2, 2, kAlt), 'K4 A întreabă de cheia lui: aplicată')
  if (k4c && (k4c.aplicat !== true || Number(k4c.uscare_id) !== Number(k4a?.uscare?.id))) ab.push('K4 A întreabă: ' + JSON.stringify(k4c))
  const k4d = asteptOk(await retrage(U.MAN_P1, 1, kAlt), 'K4 B reia retragerea LUI (tot retrasă, nu „aplicată” a lui A)')
  if (k4d && (k4d.retrasa !== true || k4d.duplicat !== true || k4d.aplicat !== false)) ab.push('K4 B reia: ' + JSON.stringify(k4d))
  // același UUID folosit ÎNTÂI de alt cont într-o operație (nu retragere) nu ocupă cheia lui A
  const kOc = randomUUID()
  asteptOk(await salveaza(db, U.EDITOR, 2, null, null, { ...PLAN(), proba_id: null, tronson: 'K4 B ocupă' }, kOc), 'K4 B creează pe P2 cu UUID-ul lui A')
  const k4e = asteptOk(await salveaza(db, U.ADMIN, 2, null, null, { ...PLAN(), proba_id: null, tronson: 'K4 A după B' }, kOc), 'K4 A creează cu propria cheie (aceeași valoare)')
  if (k4e && (k4e.duplicat !== false || k4e.uscare?.tronson !== 'K4 A după B')) ab.push('K4 cheia ocupată de alt cont: ' + JSON.stringify(k4e))
  // L. limita evidenței retragerilor (runda 4): pe AUTOR, 20 / 24 h și 200 / 365 zile; peste ea refuz DISTINCT 54000, nimic scris; întrebarea pe o
  // cheie aplicată / deja retrasă nu e limitată; alt autor nu e afectat
  const nRetr = async uid => (await db.query(`SELECT count(*)::int AS n FROM public.executie_uscare_jurnal WHERE actiune = 'cheie_retrasa' AND creat_de = ${lit(uid)}::uuid`)).rows[0].n
  const deja = await nRetr(U.MAN_P1)
  for (let i = deja; i < 20; i++) asteptOk(await retrage(U.MAN_P1, 1, randomUUID()), `L retragerea ${i + 1} din 20`)
  if (await nRetr(U.MAN_P1) !== 20) ab.push(`L retrageri MAN_P1: ${await nRetr(U.MAN_P1)} (aștepta 20)`)
  const nj1 = await nrJurnal()
  asteptCod(await retrage(U.MAN_P1, 1, randomUUID()), '54000', 'L a 21-a retragere în 24 h (limita)')
  asteptMesaj(await retrage(U.MAN_P1, 1, randomUUID()), /LIMITA_RETRAGERI/, 'L mesajul limitei')
  if (await nrJurnal() !== nj1) ab.push('L retragerea peste limită a scris în jurnal')
  const l1 = asteptOk(await retrage(U.MAN_P1, 1, kLost), 'L peste limită: reluarea unei retrageri existente tot răspunde')
  if (l1 && (l1.retrasa !== true || l1.duplicat !== true)) ab.push('L reluarea peste limită: ' + JSON.stringify(l1))
  const l2 = asteptOk(await retrage(U.MAN_P1, 1, kA), 'L peste limită: întrebarea pe o cheie aplicată tot răspunde')
  if (l2 && l2.aplicat !== true) ab.push('L cheia aplicată peste limită: ' + JSON.stringify(l2))
  asteptOk(await retrage(U.OWNER, 1, randomUUID()), 'L alt autor nu e afectat de limita lui MAN_P1')
  // fereastra anuală: 200 în 365 de zile (rânduri vechi scrise ca proprietar, cu gărzile oprite DOAR pentru această inserare)
  await db.exec(`BEGIN; ALTER TABLE public.executie_uscare_jurnal DISABLE TRIGGER trg_executie_uscare_jurnal_garda;
    INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta, creat_de, creat_la)
      SELECT NULL, 1, 'cheie_retrasa', '{}'::jsonb, gen_random_uuid(), md5(g::text), ${lit(U.ADMIN)}::uuid, now() - (g || ' days')::interval
        FROM generate_series(2, 400, 2) g;
    ALTER TABLE public.executie_uscare_jurnal ENABLE TRIGGER trg_executie_uscare_jurnal_garda; COMMIT;`)
  // 200 rânduri vechi, din care 182 în ultimele 365 de zile (zilele 2, 4, …, 364): mai sunt 18 retrageri până la 200
  for (let i = 0; i < 18; i++) asteptOk(await retrage(U.ADMIN, 1, randomUUID()), `L an: retragerea ${183 + i} din 200`)
  asteptMesaj(await retrage(U.ADMIN, 1, randomUUID()), /LIMITA_RETRAGERI/, 'L a 201-a retragere în 365 de zile (limita anuală)')
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
  ['o tabelă „înainte” rămasă din altă tranzacție, citită (deci blocată) în tranzacția curentă', async db => {
    await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
    return aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + MIG, { l15: 'nimic' })
  }, /AMPRENTA_GLOBALA_LIPSA/],
  // bugetul lock-urilor (1 s de la BEGIN) se aplică și FĂRĂ coliziune (runda 3): o tranzacție care ajunge la lock după prima secundă = refuz
  ['lock-ul fără coliziune, dar după prima secundă de la BEGIN', db => aplicaMig(db, 'SELECT pg_sleep(1.05);\n' + MIG), /BUGET_LOCK/],
  // sonda politicilor EFECTIVE: politici permisive generice (care nu numesc bucket-ul) deschid fișierele -> refuz
  ['politică generică de citire pe „proprietarul” fișierului', async db => {
    await db.exec(`CREATE POLICY proprii ON storage.objects FOR SELECT TO authenticated USING (owner = auth.uid())`); return aplicaMig(db)
  }, /politicile EFECTIVE .*cont fara drept vede 2/],
  ['politică generică de ștergere pentru orice cont logat', async db => {
    await db.exec(`CREATE POLICY sterge_tot ON storage.objects FOR DELETE TO authenticated USING (true)`); return aplicaMig(db)
  }, /politicile EFECTIVE .*cont fara drept sterge/],
  ['politică generică de încărcare pentru PUBLIC', async db => {
    await db.exec(`CREATE POLICY urca_tot ON storage.objects FOR INSERT WITH CHECK (bucket_id <> 'altul')`); return aplicaMig(db)
  }, /politicile EFECTIVE .*anonim incarca/],
  // contraexemplul review-ului r2 (P1-2): încărcarea generică pe owner_id = apelantul (sonda veche nu completa owner_id -> fals negativ)
  ['CONTRAEXEMPLU: încărcare generică pe owner_id = auth.uid()', async db => {
    await db.exec(`CREATE POLICY urca_proprii ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)`); return aplicaMig(db)
  }, /politicile EFECTIVE .*cont fara drept incarca \(proiect inexistent, proprietar\)/],
  // o politică generică pe DREPTUL PE PROIECT (cale <proiect>/…): doar conturile cu drept o declanșează -> sonda trebuie să le probeze
  ['citire generică pentru cine are drept pe proiectul din cale', async db => {
    await db.exec(`CREATE POLICY citire_proiect ON storage.objects FOR SELECT TO authenticated
      USING ((storage.foldername(name))[1] ~ '^[0-9]{1,18}$' AND public.fn_executie_nod_drept((storage.foldername(name))[1]::bigint, false))`); return aplicaMig(db)
  }, /politicile EFECTIVE .*owner vede \d+.*cont restrans pe proiect vede \d+/],
  ['încărcare generică pentru cine are drept de SCRIERE pe proiectul din cale (conturile fără drept nu o declanșează)', async db => {
    await db.exec(`CREATE POLICY urca_proiect ON storage.objects FOR INSERT TO authenticated
      WITH CHECK ((storage.foldername(name))[1] ~ '^[0-9]{1,18}$' AND public.fn_executie_nod_drept((storage.foldername(name))[1]::bigint, true))`); return aplicaMig(db)
  }, /politicile EFECTIVE .*owner incarca \(proiect vazut, proprietar\)/],
  ['încărcare generică pe metadatele unei fotografii (sonda veche nu le completa)', async db => {
    await db.exec(`CREATE POLICY urca_jpeg ON storage.objects FOR INSERT TO authenticated WITH CHECK (metadata ->> 'mimetype' = 'image/jpeg')`); return aplicaMig(db)
  }, /politicile EFECTIVE .*cont fara drept incarca \(proiect inexistent, proprietar\)/],
  ['drept de modificare DOAR pe coloane pentru anon (sonda nu-l reproduce: refuz explicit)', async db => {
    await db.exec(`REVOKE UPDATE ON storage.objects FROM anon; GRANT UPDATE (metadata) ON storage.objects TO anon;`); return aplicaMig(db)
  }, /SONDA_CONDITII.*anon are drept UPDATE doar pe coloane/],
  // runda 4, CONTRAEXEMPLUL P1-2 din verdictul r3: privilegiile implicite GLOBALE ale lui postgres nu dau EXECUTE lui PUBLIC + încărcarea
  // generică pe owner_id. Sonda r3 nu putea chema ajutătorul ca authenticated, înghițea refuzul ca „încărcare refuzată” și trecea.
  ['CONTRAEXEMPLU r3: fără EXECUTE implicit pentru PUBLIC + încărcare generică pe owner_id', async db => {
    await db.exec(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      CREATE POLICY urca_proprii ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)`); return aplicaMig(db)
  }, /politicile EFECTIVE .*cont fara drept incarca \(proiect inexistent, proprietar\)/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const gol = (await db.query(`SELECT to_regclass('public.executie_uscari') IS NULL AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare') AS g`)).rows[0].g
  ok(re.test(m || '') && gol, `${nume}: ${m}`)
  await db.close()
}
{
  // sonda nu lasă nimic în urmă: după o aplicare reușită bucket-ul e gol și rolul curent e postgres; a probat toate cele 7 identități
  const db = await bazaNoua()
  const j = await aplicaMig(db)
  const r = (await db.query(`SELECT current_user AS u, (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'executie-uscare') AS n,
    to_regprocedure('pg_temp.sonda_rand_20261225a(text[], text, uuid, boolean)') IS NULL AS f`)).rows[0]
  const pr = (j.find(m => /sonda storage: identitati probate/.test(m)) || '').split(': ').slice(-1)[0]
  ok(r.u === 'postgres' && r.n === 0 && r.f && pr.split('; ').filter(Boolean).length === 7, `sonda Storage anulată integral (rol ${r.u}, ${r.n} fișiere); identități: ${pr}`)
  await db.close()
}
{
  // FĂRĂ REFUZ FALS din drepturile copiei (runda 3): o politică de încărcare pentru anon, dar anon NU are INSERT pe storage.objects -> pe
  // tabelul real anon nu poate încărca nimic, deci migrarea trebuie să se aplice (sonda veche dădea drept INSERT copiei și refuza)
  const db = await bazaNoua()
  await db.exec(`REVOKE INSERT ON storage.objects FROM anon; CREATE POLICY anon_urca ON storage.objects FOR INSERT TO anon WITH CHECK (true);`)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  const urc = await ca(db, 'anon', null, `INSERT INTO storage.objects (bucket_id, name) VALUES ('executie-uscare', '1/1/${randomUUID()}.jpg')`)
  ok(m === null && urc.code === '42501', `politică fără dreptul de tabel nu produce refuz fals (${m || 'aplicată'}; anon pe tabelul real: ${urc.code || 'a încărcat!'})`)
  await db.close()
}
{
  // privilegiile implicite ale platformei pentru un ALT rol (ex. un rol de citire): migrarea le retrage pe obiectele ei și se aplică; ACL exact
  const db = await bazaNoua()
  await db.exec(`CREATE ROLE zz_platforma NOLOGIN; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO zz_platforma;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO zz_platforma;`)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  const r = (await db.query(`SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e
    WHERE c.relname LIKE 'executie\\_uscar%' AND e.grantee = 'zz_platforma'::regrole`)).rows[0].n
  ok(m === null && r === 0, `drepturile implicite ale altui rol retrase la aplicare (${m || 'aplicată'}; rămase: ${r})`)
  await db.close()
}

{
  // runda 4 (verdict P2-5): privilegiile implicite GLOBALE dau SELECT pe orice tabel nou lui authenticated, dar authenticated NU are SELECT pe
  // storage.objects; o politică SELECT generică. Pe tabelul real nimeni nu citește -> migrarea trebuie să se aplice (copia sondei r3 primea
  // SELECT automat, vedea rânduri și refuza fals). ACL-ul copiei e normalizat și verificat.
  const db = await bazaNoua()
  await db.exec(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO authenticated; REVOKE SELECT ON storage.objects FROM authenticated;
    CREATE POLICY citeste_tot ON storage.objects FOR SELECT TO authenticated USING (true);`)
  let m = null; try { await aplicaMig(db) } catch (e) { m = e.message }
  const cit = await ca(db, 'authenticated', U.FARA, `SELECT count(*) FROM storage.objects`)
  ok(m === null && cit.code === '42501', `privilegiile implicite globale pe copia sondei nu produc refuz fals (${m || 'aplicată'}; authenticated pe tabelul real: ${cit.code || 'citește!'})`)
  await db.close()
}
{
  // runda 4 (verdict P1-2): o condiție de funcționare a sondei lipsă e raportată DISTINCT (SONDA_CONDITII), nu ca „încărcare refuzată” și nu ca
  // refuz pe politici — probat pe migrarea FĂRĂ GRANT-ul explicit al ajutătorului, în mediul contraexemplului
  const db = await bazaNoua()
  await db.exec(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    CREATE POLICY urca_proprii ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)`)
  let m = null
  try { await aplicaMig(db, aplica(MIG, [['    GRANT EXECUTE ON FUNCTION pg_temp.sonda_rand_20261225a(text[], text, uuid, boolean) TO anon, authenticated;\n', '']])) } catch (e) { m = e.message }
  ok(/SONDA_CONDITII/.test(m || '') && /apelul ajutatorului sondei refuzat/.test(m || '') && !/politicile EFECTIVE/.test(m || ''),
    `fără EXECUTE pe ajutător: refuz DISTINCT de condiție, nu „încărcare refuzată”: ${(m || 'aplicată!').slice(0, 220)}`)
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
    // runda 3 (verdict P2-8): starea EXACTĂ și pentru constrângeri, valori implicite, indecși, NOT NULL, secvențe, roluri suplimentare
    ['CONTRAEXEMPLU: un CHECK în plus pe tabelul gol', `ALTER TABLE public.executie_uscari ADD CONSTRAINT zz_ck CHECK (versiune < 100000)`, `ALTER TABLE public.executie_uscari DROP CONSTRAINT zz_ck`, /structura: executie_uscari \(gasit/],
    ['altă valoare implicită', `ALTER TABLE public.executie_uscare_jurnal ALTER COLUMN valori SET DEFAULT '{"x": 1}'::jsonb`, `ALTER TABLE public.executie_uscare_jurnal ALTER COLUMN valori SET DEFAULT '{}'::jsonb`, /structura: executie_uscare_jurnal/],
    ['un index în plus', `CREATE INDEX zz_idx ON public.executie_uscare_poze (legenda)`, `DROP INDEX public.zz_idx`, /structura: executie_uscare_poze/],
    ['NOT NULL scos', `ALTER TABLE public.executie_uscare_incarcari ALTER COLUMN creat_la DROP NOT NULL`, `ALTER TABLE public.executie_uscare_incarcari ALTER COLUMN creat_la SET NOT NULL`, /structura: executie_uscare_incarcari/],
    ['parametrii secvenței de identitate', `ALTER TABLE public.executie_uscari ALTER COLUMN id SET CACHE 5`, `ALTER TABLE public.executie_uscari ALTER COLUMN id SET CACHE 1`, /structura: executie_uscari/],
    ['drept pe secvență', `GRANT USAGE ON SEQUENCE public.executie_uscare_jurnal_id_seq TO authenticated`, `REVOKE USAGE ON SEQUENCE public.executie_uscare_jurnal_id_seq FROM authenticated`, /drepturi ACL: executie_uscare_jurnal_id_seq\/authenticated\/USAGE/],
    ['un rol suplimentar cu drept pe tabel', `CREATE ROLE zz_rol NOLOGIN; GRANT SELECT ON public.executie_uscare_poze TO zz_rol`, `REVOKE SELECT ON public.executie_uscare_poze FROM zz_rol; DROP ROLE zz_rol`, /drepturi ACL: executie_uscare_poze\/zz_rol\/SELECT/],
    ['SELECT cu GRANT OPTION', `GRANT SELECT ON public.executie_uscari TO service_role WITH GRANT OPTION`, `REVOKE GRANT OPTION FOR SELECT ON public.executie_uscari FROM service_role`, /drepturi ACL: executie_uscari\/service_role\/SELECT/],
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
  // runda 3 — fiecare are detectorul lui (ce ar fi lăsat să treacă)
  ['M26 sonda nu completează owner_id (CONTRAEXEMPLUL r2 trece)', [["      IF 'owner_id' = ANY (p_cols) THEN", "      IF false AND 'owner_id' = ANY (p_cols) THEN"]],
    `CREATE POLICY urca_proprii ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)`,
    { aplicaIntai: true, detector: async db => { const r = await ca(db, 'authenticated', U.FARA, `INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('executie-uscare', '1/1/${randomUUID()}.jpg', '${U.FARA}', '${U.FARA}')`); return r.code ? null : 'un cont fără drept a încărcat un fișier nerezervat' } }],
  ['M27 sonda doar cu anonim + contul fără drept (politica pe dreptul de proiect trece)', [["      IF x.uid IS NOT NULL THEN\n        v_ids := v_ids || jsonb_build_array(", "      IF false AND x.uid IS NOT NULL THEN\n        v_ids := v_ids || jsonb_build_array("]],
    `CREATE POLICY citire_proiect ON storage.objects FOR SELECT TO authenticated USING ((storage.foldername(name))[1] ~ '^[0-9]{1,18}$' AND public.fn_executie_nod_drept((storage.foldername(name))[1]::bigint, false))`,
    { aplicaIntai: true, detector: async db => {
      const c = `1/999999/${randomUUID()}.jpg`
      await db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('executie-uscare', '${c}')`)
      const r = await ca(db, 'authenticated', U.CIT_P1, `SELECT count(*)::int AS n FROM storage.objects WHERE name = '${c}'`)
      return !r.code && r.rows[0].n > 0 ? 'cititorul P1 vede un fișier al unui raport inexistent' : null } }],
  ['M28 copia sondei primește toate drepturile (refuz fals)', [["              WHERE has_table_privilege(r.rol, 'storage.objects', d.drept) LOOP\n      EXECUTE format('GRANT %s ON pg_temp.sonda_obiecte_20261225a TO %I', x.drept, x.rol);",
    "              WHERE true LOOP\n      EXECUTE format('GRANT %s ON pg_temp.sonda_obiecte_20261225a TO %I', x.drept, x.rol);"]],
    `REVOKE INSERT ON storage.objects FROM anon; CREATE POLICY anon_urca ON storage.objects FOR INSERT TO anon WITH CHECK (true);`],
  ['M29 retragerea nu scrie cheia (cererea pierdută se aplică după „Renunț”)', [["  INSERT INTO public.executie_uscare_jurnal (uscare_id, proiect_id, actiune, valori, cheie, amprenta)\n  VALUES (NULL, p_proiect, 'cheie_retrasa'", "  PERFORM 1 FROM public.executie_uscare_jurnal WHERE false AND (NULL, p_proiect, 'cheie_retrasa'"]]],
  ['M30 retragerea nu întreabă jurnalul (cheia aplicată = „neaplicată”)', [["  SELECT uscare_id, proiect_id, actiune INTO j FROM public.executie_uscare_jurnal WHERE creat_de = v_uid AND cheie = p_cheie;\n  IF FOUND THEN\n    IF NOT public.fn_executie_nod_drept(j.proiect_id, false) THEN",
    "  SELECT uscare_id, proiect_id, actiune INTO j FROM public.executie_uscare_jurnal WHERE creat_de = v_uid AND cheie = p_cheie AND false;\n  IF FOUND THEN\n    IF NOT public.fn_executie_nod_drept(j.proiect_id, false) THEN"]]],
  ['M31 bugetul lock-ului doar la coliziune (ca în r2)', [["  LOOP\n    IF clock_timestamp() >= now() + interval '1 second' THEN\n      RAISE EXCEPTION '20261225a: BUGET_LOCK: % incercari", "  LOOP\n    IF false THEN\n      RAISE EXCEPTION '20261225a: BUGET_LOCK: % incercari"],
    ["  IF clock_timestamp() >= now() + interval '1 second' THEN\n    RAISE EXCEPTION '20261225a: BUGET_LOCK: lock-urile obtinute", "  IF false THEN\n    RAISE EXCEPTION '20261225a: BUGET_LOCK: lock-urile obtinute"]],
    null, { detector: async (db, text) => { try { await aplicaMig(db, 'SELECT pg_sleep(1.05);\n' + text); return 'lock luat după prima secundă' } catch { return null } } }],
  ['M32 garda tabelei „înainte” fără xmin (o tabelă veche, citită acum, trece)', [["                    AND c.xmin::text = (txid_current() % 4294967296)::text\n", '']],
    null, { detector: async (db, text) => {
      await db.exec(`BEGIN; CREATE TEMP TABLE ag_ina_0123456789abcdef (x int); COMMIT;`)
      try { await aplicaMig(db, 'SELECT count(*) FROM pg_temp.ag_ina_0123456789abcdef;\n' + text, { l15: 'nimic' }); return 'aplicată fără pasul „înainte”' } catch { return null } } }],
  ['M33 fără retragerea drepturilor altor roluri (privilegiile implicite ale platformei)', [["              AND NOT (c.relkind = 'r' AND e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid)) LOOP", "              AND false LOOP"]],
    `CREATE ROLE zz_platforma NOLOGIN; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO zz_platforma;`],
  // runda 4 — fiecare cu scenariul verdictului r3
  ['M34 sonda r3: ajutătorul fără EXECUTE explicit, apelul refuzat înghițit ca „încărcare refuzată” (CONTRAEXEMPLUL P1-2 trece)',
    [['    GRANT EXECUTE ON FUNCTION pg_temp.sonda_rand_20261225a(text[], text, uuid, boolean) TO anon, authenticated;\n', ''],
     ["      v_cond := v_cond || 'ajutatorul sondei nu are EXECUTE pentru anon / authenticated sau nu e SECURITY INVOKER; ';", '      NULL;'],
     ["            v_cond := v_cond || x.e || ': apelul ajutatorului sondei refuzat (' || SQLERRM || '); ';", '            NULL;']],
    `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
     CREATE POLICY urca_proprii ON storage.objects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()::text)`,
    { aplicaIntai: true, detector: async db => { const r = await ca(db, 'authenticated', U.FARA, `INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('executie-uscare', '1/1/${randomUUID()}.jpg', '${U.FARA}', '${U.FARA}')`); return r.code ? null : 'un cont fără drept a încărcat un fișier nerezervat' } }],
  ['M35 copia sondei fără ACL normalizat (privilegiile implicite globale -> refuz fals)',
    [["      EXECUTE format('REVOKE ALL ON pg_temp.sonda_obiecte_20261225a FROM %s',", "      CONTINUE; EXECUTE format('REVOKE ALL ON pg_temp.sonda_obiecte_20261225a FROM %s',"]],
    `ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO authenticated; REVOKE SELECT ON storage.objects FROM authenticated;
     CREATE POLICY citeste_tot ON storage.objects FOR SELECT TO authenticated USING (true);`],
  ['M36 retragerea fără limita pe autor', [["  IF v_zi >= 20 OR v_an >= 200 THEN", '  IF false THEN']]],
  ['M37 cheia globală, nelegată de autor (ca în r3: alt cont blochează cererea lui A)',
    [['WHERE creat_de = v_uid AND cheie = p_cheie', 'WHERE cheie = p_cheie'], ['CONSTRAINT executie_uscare_jurnal_cheie_uq UNIQUE (creat_de, cheie)', 'CONSTRAINT executie_uscare_jurnal_cheie_uq UNIQUE (cheie)']]],
]
for (const [nume, inl, preg, opt] of MUTANTI) {
  // runda 4: un mutant al cărui text nu mai există în migrare NU „pică” — e un test stricat (înainte trecea ca „aplicare: …”)
  try { aplica(MIG, inl) } catch (e) { ok(false, `${nume}: ${e.message.slice(0, 120)}`); continue }
  const db = await bazaNoua()
  if (preg) await db.exec(preg)
  let picat = null
  if (opt?.detector) {
    // aplicaIntai: mutantul se aplică (sonda lui nu vede gaura), apoi detectorul arată gaura; altfel detectorul aplică singur, în scenariul lui.
    // Fără mutant, același scenariu e refuzat de migrarea reală (secțiunea 2).
    try {
      if (opt.aplicaIntai) await aplicaMig(db, aplica(MIG, inl))
      picat = await opt.detector(db, aplica(MIG, inl))
    } catch (e) { picat = null; console.log('     ' + nume + ': ' + e.message.slice(0, 160)) }
    ok(picat != null, `${nume} pică (${picat || 'NU a picat'})`)
    await db.close()
    continue
  }
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
