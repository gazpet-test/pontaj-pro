// Proba LOCALĂ a migrării 20261223a (clarificări automate pe tichetele din butonul de raportare, maximum 2 runde; r2: evidența în tabelul
// protejat tichete_clarificari) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261223a_tichete_clarificari_schelet.sql (POLITICILE REALE din producție: tichete_update_auth fără
//   WITH CHECK, INSERT liber pe coloanele comentariilor, INSERT de notificări pentru orice cont logat) + funcția REALĂ
//   fn_tichete_notif_on_status_change extrasă exact din 20261103d. Celelalte triggere sunt înlocuitori (vezi scheletul); efectul
//   triggerelor reale de pe producție îl măsoară proba de pe clonă (scripts/tichete_clarificari_concurenta.mjs, scenariul T).
// 1. BASELINE-ul L15 calculat pe schema falsă cu scriptul coordonatorului (secțiunea 1, tranzacție READ ONLY) și pus în blocul marcat (în
//    locul celui din producție), migrarea aplicată ca runnerul (--plafon-tranzactie-ms 2000).
// 2. VERIFICĂRI (valorile așteptate scrise de mână din cerere, L25), conturile din aplicație lucrând ca authenticated (SET LOCAL ROLE):
//    runda 1 (comentariu fără autor cu textul exact, notificarea exactă, rândul de evidență, tichetul NEATINS), deduplicarea (și cu
//    versiunea veche a contextului), runda 2 doar după răspunsul AUTORULUI, context_schimbat (trimite / incheie), încheierile (neclar /
//    tăcere / clarificat) deduplicate, răspuns târziu semnalat, eligibilitatea, filtrul întrebărilor (cazurile recenzentului: domeniu fără
//    schemă, telefon cu paranteze), rolurile API (funcții și scrieri în tabelul protejat = refuz), zilele lucrătoare, comentariul automat
//    șters de owner / un comentariu automat nelistat / autorul schimbat = „incoerent”, PATCH pe metadata (orice conținut, de orice cont)
//    = nicio influență, comentariu postdatat înaintea rundei / antedatat după ea / cu id ales = clasificat prin instantaneu, lista rutinei.
// 3. REFUZURILE migrării și L15 (închiderea, cu mutanții ei); revenirea (cu date, fără plafon, funcție schimbată, trigger adăugat pe
//    tabel, aplicare -> revenire -> re-aplicare).
// 4. MUTANȚI (migrare / revenire stricate intenționat): fiecare TREBUIE să pice. Lock-ul (FOR NO KEY UPDATE) nu se poate proba pe PGlite (o
//    singură conexiune): îl probează scripts/tichete_clarificari_concurenta.mjs pe clonă (--mutant fara_lock) + testul static.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_tichete_clarificari_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const SCHELET = citeste('supabase/tests/20261223a_tichete_clarificari_schelet.sql')
const NOTIF = citeste('supabase/migrations/20261103d_tichete_notif_creator.sql')
const MIG = citeste('supabase/migrations/20261223a_tichete_clarificari.sql')
const REV = citeste('supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql')
const SCRIPT = citeste('scripts/tichete_clarificari_amprente.sql')
const BL_A = '  SELECT v.eticheta, v.amprenta FROM (VALUES\n', BL_B = '\n  ) v(eticheta, amprenta)'
const PLACEHOLDER = (() => { const i0 = MIG.indexOf('-- >>> BASELINE 20261223a'), i = MIG.indexOf(BL_A, i0) + BL_A.length; return MIG.slice(i, MIG.indexOf(BL_B, i)) })()
if (!PLACEHOLDER.trim()) { console.error('blocul BASELINE 20261223a nu se găsește'); process.exit(1) }
const MIG_NECOMPLETAT = MIG.split(PLACEHOLDER).join("    ('DE_COMPLETAT', 'DE_COMPLETAT')")

// funcția REALĂ de notificare la schimbarea statusului, EXACT din 20261103d (corpul până la $function$;), cu trigger-ul ei
const REAL_NOTIF = (() => {
  const a = NOTIF.indexOf('CREATE OR REPLACE FUNCTION public.fn_tichete_notif_on_status_change()')
  if (a < 0) throw new Error('lipsește funcția reală din 20261103d')
  return NOTIF.slice(a, NOTIF.indexOf('$function$;', NOTIF.indexOf('AS $function$', a) + 5) + '$function$;'.length).replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE FUNCTION')
    + '\nCREATE TRIGGER trg_tichete_notif_status AFTER UPDATE ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_tichete_notif_on_status_change();'
})()

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
const aplicaMig = (db, text, o) => caRunner(db, '20261223a_tichete_clarificari', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261223a_tichete_clarificari_ROLLBACK', text, o)

// ── conturile și datele (inventate, scrise de mână) ──
const U = { OWNER: '00000000-0000-4000-8000-0000000000a1', AUTOR: '00000000-0000-4000-8000-0000000000a2', ALT: '00000000-0000-4000-8000-0000000000a3',
  AUTOR2: '00000000-0000-4000-8000-0000000000a4' }
const META = (sursa) => `'{"sursa": "${sursa}", "tip": "${sursa === 'bug_report' ? 'bug' : 'feature'}", "pagina": "/test", "viewport": "1280x720", "raportat_la": "2026-11-01T08:00:00Z"}'::jsonb`
// Tichetele: (a) 15 tichete create ÎNAINTE de migrare (de postgres, id-urile 1..15: P.T1..P.T15) — r3: fără ancoră, deci în afara
// protocolului; (b) după migrare, ACELEAȘI 15 + 10 noi create CA DIN APLICAȚIE (authenticated, JWT-ul autorului, politica reală de INSERT):
// id-urile 16..40 = T.T1..T.T25 (identity în ordinea inserării); T9 și T10 au aceeași dată de creare (ordinea = id)
const P = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`T${i + 1}`, i + 1]))
const T = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`T${i + 1}`, i + 16]))
const DEF_TICHETE = [
  ['it', 'eroare_erp', 'Bug inventat 1', 'Descriere inventata 1', 'atribuit', U.AUTOR, META('bug_report'), '2026-11-01 10:00+02'],
  ['it', 'cerere_functie', 'Cerere inventata 2', null, 'deschis', U.AUTOR2, META('feature_request'), '2026-11-02 10:00+02'],
  ['logistica', 'eroare_erp', 'Alt departament 3', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-03 10:00+02'],
  ['it', 'acces_cont', 'Alta subcategorie 4', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-04 10:00+02'],
  ['it', 'eroare_erp', 'Status final 5', null, 'rezolvat', U.AUTOR, META('bug_report'), '2026-11-05 10:00+02'],
  ['it', 'eroare_erp', 'Fara sursa 6', null, 'deschis', U.AUTOR, `'{"modul": "magazie"}'::jsonb`, '2026-11-06 10:00+02'],
  ['it', 'eroare_erp', 'Tacere 7', null, 'in_lucru', U.AUTOR, META('bug_report'), '2026-11-07 10:00+02'],
  ['it', 'cerere_functie', 'Clar de la inceput 8', null, 'deschis', U.AUTOR2, META('feature_request'), '2026-11-08 10:00+02'],
  ['it', 'eroare_erp', 'Comentariu automat sters 9', null, 'in_analiza', U.AUTOR, META('bug_report'), '2026-11-09 10:00+02'],
  ['it', 'eroare_erp', 'Metadata falsificata 10', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-09 10:00+02'],
  ['it', 'eroare_erp', 'Date alese 11', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-10 10:00+02'],
  ['it', 'eroare_erp', 'Id-uri alese 12', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-11 10:00+02'],
  ['it', 'eroare_erp', 'Autor schimbat 13', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-12 10:00+02'],
  ['it', 'cerere_functie', 'Context schimbat 14', null, 'deschis', U.AUTOR, META('feature_request'), '2026-11-13 10:00+02'],
  ['it', 'eroare_erp', 'Comentariu automat nelistat 15', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-13 11:00+02'],
  // r3 (P1 / P2 din verdictul r2)
  ['it', 'eroare_erp', 'Substituire autor 16', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 10:00+02'],
  ['it', 'eroare_erp', 'Redeschis 17', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 11:00+02'],
  ['it', 'eroare_erp', 'Redeschis in protocol 18', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 12:00+02'],
  ['it', 'eroare_erp', 'Id refolosit 19', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 13:00+02'],
  ['it', 'eroare_erp', 'Id refolosit cu evidenta 20', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 14:00+02'],
  ['it', 'eroare_erp', 'Id mutat 21', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-14 15:00+02'],
  ['it', 'eroare_erp', 'Tichetul lui ALT 22', null, 'deschis', U.ALT, META('bug_report'), '2026-11-14 16:00+02'],
  ['it', 'eroare_erp', 'Fereastra runda 23', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-15 10:00+02'],
  ['it', 'eroare_erp', 'Fereastra tacere 24', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-15 11:00+02'],
  ['it', 'eroare_erp', 'Trigger oprit 25', null, 'deschis', U.AUTOR, META('bug_report'), '2026-11-15 12:00+02'],
]
const valoriTichet = ([dep, sub, titlu, desc, st, autor, meta, la]) =>
  `('${dep}', '${sub}', '${titlu}', ${desc === null ? 'NULL' : `'${desc}'`}, '${st}', '${autor}', ${meta}, '${la}')`
const DATE = `
INSERT INTO auth.users (id) VALUES ('${U.OWNER}'), ('${U.AUTOR}'), ('${U.ALT}'), ('${U.AUTOR2}');
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'SINTETIC OWNER', true), ('${U.AUTOR}', 'SINTETIC AUTOR', false),
  ('${U.ALT}', 'SINTETIC ALT', false), ('${U.AUTOR2}', 'SINTETIC AUTOR DOI', false);
INSERT INTO public.tichete (departament, subcategorie, titlu, descriere, status, deschis_de, metadata, created_at) VALUES
  ${DEF_TICHETE.slice(0, 15).map(valoriTichet).join(',\n  ')};`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(REAL_NOTIF)
  await db.exec(DATE)
  return db
}
const BAZA0 = await bazaNoua()
const B0 = await baseline(BAZA0)
await BAZA0.close()
// amprenta așteptată pe schema falsă, scrisă de mână din schelet: 3 tabele x 6 etichete; LANȚUL = triggerele de UPDATE pe tichete (status
// REAL + istoric; păstrate conservator în pornire) și de INSERT pe notifications, callee-ul istoricului, auth.uid() (chemat de ambele),
// trigger-ul tabelului tichete_istoric (scris de istoric); AMPRENTAT = numerotarea și notificarea la INSERT (cu EXECUTE), funcția politicilor
const TAB = ['notifications', 'tichete', 'tichete_comentarii'].flatMap(t => ['acl', 'acl coloane', 'politici', 'rls', 'secvente', 'triggere'].map(k => `tabel ${t} | ${k}`))
const LANT = ['functie auth.uid()', 'functie fn_notifications_normalizeaza()', 'functie fn_tichete_istoric_actiune(text,text)', 'functie fn_tichete_istoric_eticheta(text)',
  'functie fn_tichete_istoric_marcheaza()', 'functie fn_tichete_istoric_upd()', 'functie fn_tichete_notif_on_status_change()']
const AMPRENTAT = ['functie fn_is_app_owner(uuid)', 'functie fn_tichete_notif_on_insert()', 'functie fn_tichete_numar()']
const sortC = (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
if (JSON.stringify(sortC(B0.map(r => r.eticheta))) !== JSON.stringify(sortC([...TAB, ...LANT, ...AMPRENTAT]))) {
  console.error('baseline: etichetele nu sunt cele așteptate:\n  ' + sortC(B0.map(r => r.eticheta)).join('\n  ')); process.exit(1)
}
const SURSE = Object.fromEntries(B0.map(r => [r.eticheta, r.sursa]))
if (!LANT.every(e => SURSE[e] === 'lant') || !AMPRENTAT.every(e => SURSE[e] === 'amprentat') || !TAB.every(e => SURSE[e] === 'tabel')) {
  console.error('baseline: sursele (lant / amprentat / tabel) greșite: ' + JSON.stringify(SURSE)); process.exit(1)
}
const ATENTIE = Object.fromEntries(B0.map(r => [r.eticheta, r.atentie]))
if (!/EXECUTE in corp \(in afara lantului/.test(ATENTIE['functie fn_tichete_notif_on_insert()'] || '') || B0.some(r => r.sursa === 'lant' && !r.definitie_lant)) {
  console.error('baseline: atenția / definițiile lanțului lipsesc'); process.exit(1)
}
// baseline-ul de producție din migrare: 30 de etichete (12 funcții + 3 tabele x 6), toate cu md5
{
  const lin = PLACEHOLDER.split('\n')
  if (lin.length !== 30 || !lin.every((l, i) => new RegExp(`^${i ? '  , ' : '    '}\\('(functie [^']+|tabel [^']+)', '[0-9a-f]{32}'\\)$`).test(l))) {
    console.error('baseline-ul de producție din migrare nu are forma așteptată (30 de rânduri)'); process.exit(1)
  }
}
console.log(`baseline L15 20261223a (schema falsă): ${B0.length} etichete; lanț: ${LANT.length}; amprentat: ${AMPRENTAT.length}`)
const linii = (rows) => rows.map((r, i) => (i === 0 ? '    ' : '  , ') + r.linie_baseline.replace(/^\s*,?\s*/, ''))
const cuBaseline = (text, rows) => aplica(text, [[PLACEHOLDER, linii(rows).join('\n')]])
const MIG_B = cuBaseline(MIG, B0)

// ── apeluri ──
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
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const sqlArr = (a) => a === null ? 'NULL::text[]' : `ARRAY[${a.map(x => x === null ? 'NULL' : q(x)).join(', ')}]::text[]`
const ctx = async (db, t) => (await db.query(`SELECT public.fn_tichet_clarificare_context(${t}) AS v`)).rows[0].v
// v = versiunea contextului; implicit cea de acum (rutina tocmai a citit starea)
const trimite = async (db, t, runda, intr, v) => {
  const vc = v === undefined ? await ctx(db, t) : v
  return (await db.query(`SELECT public.fn_tichet_clarificare_trimite(${t}, ${runda}, ${sqlArr(intr)}, ${vc === null ? 'NULL' : q(vc)}) AS r`)).rows[0].r
}
const incheie = async (db, t, motiv, v) => {
  const vc = v === undefined ? await ctx(db, t) : v
  return (await db.query(`SELECT public.fn_tichet_clarificare_incheie(${t}, ${q(motiv)}, ${vc === null ? 'NULL' : q(vc)}) AS r`)).rows[0].r
}
const stare = async (db, t) => (await db.query(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) AS s`)).rows[0].s
const lista = async (db) => (await db.query(`SELECT * FROM public.fn_tichet_clarificare_stare()`)).rows
const comentarii = async (db, t) => (await db.query(`SELECT id, autor, text, created_at FROM public.tichete_comentarii WHERE tichet_id = ${t} ORDER BY id`)).rows
const evid = async (db, t) => (await db.query(`SELECT * FROM public.tichete_clarificari WHERE tichet_id = ${t} ORDER BY fel, runda`)).rows
const nrEvid = async (db) => Number((await db.query(`SELECT count(*) AS n FROM public.tichete_clarificari`)).rows[0].n)
const nrNotif = async (db) => Number((await db.query(`SELECT count(*) AS n FROM public.notifications`)).rows[0].n)
const notifNoi = async (db, dupa) => (await db.query(`SELECT profile_id, type, modul, title, message, link_to FROM public.notifications WHERE id > ${dupa} ORDER BY id`)).rows
const maxNotif = async (db) => Number((await db.query(`SELECT coalesce(max(id), 0) AS m FROM public.notifications`)).rows[0].m)
const randTichet = async (db, t) => JSON.stringify((await db.query(`SELECT to_jsonb(x) AS j FROM public.tichete x WHERE id = ${t}`)).rows[0].j)
// un cont din aplicație scrie un comentariu, ca prin API (authenticated + JWT), cu id / dată alese opțional (politica permite)
async function comenteaza(db, t, uid, text, { id, la } = {}) {
  const col = ['tichet_id', 'autor', 'text'], val = [t, q(uid), q(text)]
  if (id !== undefined) { col.push('id'); val.push(id) }
  if (la !== undefined) { col.push('created_at'); val.push(`${q(la)}::timestamptz`) }
  const r = await ca(db, 'authenticated', uid, `INSERT INTO public.tichete_comentarii (${col.join(', ')}) VALUES (${val.join(', ')}) RETURNING id`, { pastreaza: true })
  if (r.code) throw new Error('comentariul nu s-a scris: ' + r.message)
  return Number(r.rows[0].id)
}
// un cont din aplicație modifică tichetul, ca printr-un PATCH PostgREST (politica tichete_update_auth)
const patch = (db, uid, t, set) => ca(db, 'authenticated', uid, `UPDATE public.tichete SET ${set} WHERE id = ${t}`, { pastreaza: true })
// r3: tichetele create DUPĂ migrare, ca din aplicație (butonul de raportare): authenticated cu JWT-ul autorului; id-urile trebuie să fie
// exact T.T1..T.T25 (16..40)
async function tichetePostMig(db) {
  for (let i = 0; i < DEF_TICHETE.length; i++) {
    const d = DEF_TICHETE[i]
    const r = await ca(db, 'authenticated', d[5], `INSERT INTO public.tichete (departament, subcategorie, titlu, descriere, status, deschis_de, metadata, created_at)
      VALUES ${valoriTichet(d)} RETURNING id`, { pastreaza: true })
    if (r.code || Number(r.rows[0].id) !== T[`T${i + 1}`]) throw new Error(`tichetul T${i + 1} nu s-a creat ca în aplicație: ${r.message || JSON.stringify(r.rows)}`)
  }
}
const ancora = async (db, t) => (await db.query(`SELECT * FROM public.tichete_clarificari_ancore WHERE tichet_id = ${t}`)).rows[0] || null
// P2 (r3): injecția în FEREASTRA dintre verificare și scriere — funcția zilelor lucrătoare (chemată din starea tichetului, după citirea
// răspunsurilor) e înlocuită pe baza de probă cu una care, o singură dată, scrie un comentariu al autorului (ca o altă sesiune care confirmă
// exact atunci); apoi originalul e pus la loc, octet cu octet, din migrare
const ZILE_ORIGINAL = (() => {
  const i = MIG.indexOf('CREATE FUNCTION public.fn_tichet_clarificare_zile_lucratoare(')
  return MIG.slice(i, MIG.indexOf('$f$;', MIG.indexOf('AS $f$', i) + 6) + 4).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
})()
const ZILE_INJECTIE = (t, uid, text) => `CREATE OR REPLACE FUNCTION public.fn_tichet_clarificare_zile_lucratoare(p_de timestamptz, p_la timestamptz) RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $inj$
BEGIN
  IF current_setting('proba.injecteaza', true) = '${t}' THEN
    PERFORM set_config('proba.injecteaza', '', false);
    INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${t}, '${uid}', '${text}');
  END IF;
  RETURN (SELECT count(*)::integer FROM generate_series(((p_de AT TIME ZONE 'Europe/Bucharest')::date + 1)::timestamp,
          ((p_la AT TIME ZONE 'Europe/Bucharest')::date)::timestamp, interval '1 day') AS zile(zi) WHERE extract(isodow FROM zile.zi) < 6);
END $inj$;
SELECT set_config('proba.injecteaza', '${t}', false);`
async function cuInjectie(db, t, uid, text, fn) {
  await db.exec(ZILE_INJECTIE(t, uid, text))
  try { return await fn() } finally {
    await db.exec(`SELECT set_config('proba.injecteaza', '', false);\n${ZILE_ORIGINAL}`)
  }
}

// textele așteptate, scrise de mână din cerere (NU din codul migrării)
const ANTET = 'Mesaj automat pentru clarificare. Nu reprezintă o aprobare de acces, modificare sau termen de realizare.'
const SUBSOL = 'Răspunde aici, pe tichet, fără parole sau date personale.\nEchipa ERP'
const textRunda = (n, intr) => [`Clarificare ${n}/2`, ANTET, '', ...intr.map((x, i) => `${i + 1}. ${x}`), '', SUBSOL].join('\n')
const TEXT_INCHEIERE = 'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. Acest mesaj nu confirmă implementarea sau un termen.\nEchipa ERP'
const NOTIF_RUNDA = (nr, id) => ({ profile_id: null, type: 'info', modul: 'Tichete', title: `❓ Întrebări de clarificare la tichetul ${nr}`,
  message: 'Echipa ERP are nevoie de câteva detalii ca să poată continua. Răspunde direct pe tichet.', link_to: `/tichete?id=${id}` })
const NOTIF_INCHEIERE = (nr, id) => ({ profile_id: null, type: 'info', modul: 'Tichete', title: `ℹ️ Clarificări încheiate la tichetul ${nr}`,
  message: 'Tichetul rămâne deschis și ajunge la conducere împreună cu discuția.', link_to: `/tichete?id=${id}` })
const nrT = (id) => 'TKT-' + String(id).padStart(4, '0')
const Q1 = ['În ce ecran apare problema?', 'Ce ai apăsat înainte să apară?']
const Q2 = ['Ce mesaj apare exact pe ecran?']
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const MD5 = /^[0-9a-f]{32}$/
const ids = (a) => (a || []).map(Number)
// evidența falsificată din r1 (cazul recenzentului): faza „clarificat” fără nicio rundă
const META_FALS = `jsonb_build_object('clarificari_erp', jsonb_build_object('v', 1, 'runda', 0, 'faza', 'clarificat', 'comentarii', '[]'::jsonb,
  'incheiere', jsonb_build_object('motiv', 'clarificat', 'la', '2026-11-13T10:00:00Z')))`

// ── verificările de comportament: întoarce lista abaterilor (gol = totul ca în cerere) ──
async function verifica(db) {
  const ab = []
  const astept = (r, rezultat, motiv, ce, detaliu) => {
    if (!r || r.rezultat !== rezultat || (motiv !== undefined && r.motiv !== motiv) || (detaliu !== undefined && r.detaliu !== detaliu)) {
      ab.push(`${ce}: ${JSON.stringify(r)} (aștepta ${rezultat}${motiv ? ' / ' + motiv : ''}${detaliu ? ' / ' + detaliu : ''})`)
    }
  }
  const pas = async (ce, fn) => { try { await fn() } catch (e) { ab.push(`${ce}: EXCEPȚIE ${e.code || ''} ${e.message}`) } }
  // r3: tichetele protocolului se creează DUPĂ migrare, ca din aplicație; cele de dinainte (P.*) nu au ancoră
  try { await tichetePostMig(db) } catch (e) { ab.push('V0 crearea tichetelor ca din aplicație: ' + e.message); return ab }
  await pas('V0', async () => {
    const fara = [3, 4, 5, 6].map(i => T[`T${i}`])   // neeligibile la creare (departament / subcategorie / status / sursă) => fără ancoră
    for (let i = 1; i <= 25; i++) {
      const a = await ancora(db, T[`T${i}`])
      const asteptat = !fara.includes(T[`T${i}`])
      if (!!a !== asteptat || (a && (a.autor !== DEF_TICHETE[i - 1][5] || a.iesit_la !== null || a.iesit_motiv !== null))) ab.push(`V0 ancora lui T${i}: ${JSON.stringify(a)} (așteptat ${asteptat ? 'ancorat, autorul de la creare' : 'fără ancoră'})`)
    }
    if (Number((await db.query(`SELECT count(*) AS n FROM public.tichete_clarificari_ancore WHERE tichet_id <= 15`)).rows[0].n) !== 0) ab.push('V0 tichetele de dinainte de aplicare au ancoră')
    const s = await stare(db, P.T1)
    if (s.eligibil !== false || s.motiv !== 'fara_ancora') ab.push('V0 tichetul de dinainte de aplicare: ' + JSON.stringify(s))
    astept(await trimite(db, P.T1, 1, Q1), 'refuz', 'neeligibil', 'V0 runda 1 pe un tichet de dinainte de aplicare', 'fara_ancora')
    if ((await comentarii(db, P.T1)).length !== 0) ab.push('V0 s-a scris pe un tichet de dinainte de aplicare')
  })

  // V1–V5: runda 1 pe T1: comentariul, notificarea, rândul de evidență; tichetul (inclusiv metadata) NEATINS
  let com1 = null
  await pas('V1', async () => {
    const rand0 = await randTichet(db, T.T1), n0 = await maxNotif(db), nTot0 = await nrNotif(db)
    const v = await ctx(db, T.T1)
    if (!MD5.test(v || '')) ab.push('V1 versiunea contextului nu e md5: ' + v)
    if ((await stare(db, T.T1)).versiune_context !== v) ab.push('V1 starea dă altă versiune a contextului decât funcția de context')
    const r = await trimite(db, T.T1, 1, Q1, v)
    astept(r, 'trimis', undefined, 'V1 runda 1')
    if (r?.intrebari_trimise !== true) ab.push('V1 trimis fără intrebari_trimise = true: ' + JSON.stringify(r))
    const c = await comentarii(db, T.T1)
    if (c.length !== 1 || c[0].autor !== null || c[0].text !== textRunda(1, Q1) || Number(c[0].id) !== Number(r?.comentariu_id)) ab.push('V2 comentariul rundei 1: ' + JSON.stringify(c))
    com1 = c[0] && Number(c[0].id)
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || await nrNotif(db) !== nTot0 + 1 || !egal({ ...nn[0], profile_id: null }, NOTIF_RUNDA(nrT(T.T1), T.T1)) || nn[0].profile_id !== U.AUTOR) {
      ab.push('V3 notificarea rundei 1 (exact una, către autor, fără întrebări): ' + JSON.stringify(nn))
    }
    const e = await evid(db, T.T1)
    if (e.length !== 1 || e[0].fel !== 'runda' || e[0].runda !== 1 || Number(e[0].comentariu_id) !== com1 || Number(e[0].notificare_id) !== Number(r?.notificare_id)
        || e[0].nr_intrebari !== 2 || e[0].autor_tichet !== U.AUTOR || !egal(ids(e[0].instantaneu_autor), []) || e[0].versiune_context !== v
        || e[0].versiune_protocol !== 1 || !e[0].creat_la || e[0].motiv !== null) {
      ab.push('V4 rândul de evidență: ' + JSON.stringify(e))
    }
    if (await randTichet(db, T.T1) !== rand0) ab.push('V5 tichetul (rândul întreg, inclusiv metadata / updated_at) s-a schimbat')
  })
  // V6–V7: același apel repetat (cu alte întrebări și cu versiunea VECHE a contextului: reluarea după timeout) = deja_trimis, nimic în plus
  await pas('V6', async () => {
    const n0 = await nrNotif(db), e0 = await nrEvid(db)
    const vVeche = (await evid(db, T.T1))[0]?.versiune_context
    const r = await trimite(db, T.T1, 1, Q1, vVeche)
    astept(r, 'deja_trimis', undefined, 'V6 runda 1 repetată (contextul de dinaintea mesajului)')
    if (Number(r?.comentariu_id) !== com1) ab.push('V6 deja_trimis fără id-ul comentariului: ' + JSON.stringify(r))
    // deja_trimis confirmă mesajul EXISTENT, nu întrebările apelului de acum (rutina nu le raportează drept trimise)
    if (r?.intrebari_trimise !== false) ab.push('V6 deja_trimis fără intrebari_trimise = false: ' + JSON.stringify(r))
    astept(await trimite(db, T.T1, 1, ['Altă întrebare?']), 'deja_trimis', undefined, 'V7 runda 1 cu alte întrebări')
    if ((await comentarii(db, T.T1)).length !== 1 || await nrNotif(db) !== n0 || await nrEvid(db) !== e0) ab.push('V6 dublură: comentariu / notificare / evidență în plus')
    astept(await trimite(db, T.T1, 2, Q2, null), 'refuz', 'versiune_context_lipsa', 'V7 fără versiunea contextului')
    astept(await trimite(db, T.T1, 2, Q2, 'nu-i md5'), 'refuz', 'versiune_context_lipsa', 'V7 versiune invalidă')
  })
  // V8–V9: runda 2 fără răspunsul AUTORULUI (răspunsul altui cont nu contează)
  await pas('V8', async () => {
    astept(await trimite(db, T.T1, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V8 runda 2 fără răspuns')
    await comenteaza(db, T.T1, U.ALT, 'Si eu am vazut asta.')
    astept(await trimite(db, T.T1, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V9 runda 2 după comentariul altui cont')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'asteapta_autor' || s.raspuns_autor !== false || s.zile_lucratoare !== 0 || s.prag_tacere !== 3) ab.push('V9 starea după comentariul altui cont: ' + JSON.stringify(s))
  })
  // V10–V12: răspunsul autorului -> runda 2: cu contextul de DINAINTEA răspunsului = context_schimbat (nimic scris); cu cel nou = trimis
  await pas('V10', async () => {
    const vInainte = await ctx(db, T.T1)
    const idRasp = await comenteaza(db, T.T1, U.AUTOR, 'Apare in ecranul de pontaj.')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'de_evaluat_raspuns' || s.raspuns_autor !== true || s.versiune_context === vInainte) ab.push('V10 starea după răspunsul autorului: ' + JSON.stringify(s))
    const n0 = await maxNotif(db), nc0 = (await comentarii(db, T.T1)).length, e0 = await nrEvid(db)
    astept(await trimite(db, T.T1, 2, Q2, vInainte), 'refuz', 'context_schimbat', 'V10 runda 2 cu contextul vechi')
    if ((await comentarii(db, T.T1)).length !== nc0 || await maxNotif(db) !== n0 || await nrEvid(db) !== e0) ab.push('V10 context_schimbat a scris ceva')
    const r = await trimite(db, T.T1, 2, Q2, s.versiune_context)
    astept(r, 'trimis', undefined, 'V10 runda 2')
    const c = await comentarii(db, T.T1), ult = c[c.length - 1]
    if (ult?.autor !== null || ult?.text !== textRunda(2, Q2)) ab.push('V10 comentariul rundei 2: ' + JSON.stringify(ult))
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || nn[0].profile_id !== U.AUTOR) ab.push('V10 notificarea rundei 2: ' + JSON.stringify(nn))
    const e2 = (await evid(db, T.T1)).find(x => x.fel === 'runda' && x.runda === 2)
    if (!e2 || !egal(ids(e2.instantaneu_autor), [idRasp]) || e2.nr_intrebari !== 1) ab.push('V10 evidența rundei 2 (instantaneul = răspunsul autorului): ' + JSON.stringify(e2))
    astept(await trimite(db, T.T1, 2, Q2), 'deja_trimis', undefined, 'V11 runda 2 repetată')
    astept(await trimite(db, T.T1, 3, Q2), 'refuz', 'runda_invalida', 'V11 runda 3')
    astept(await trimite(db, T.T1, 0, Q2), 'refuz', 'runda_invalida', 'V11 runda 0')
    astept(await incheie(db, T.T1, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V12 tăcere înainte de prag')
    astept(await incheie(db, T.T1, 'neclar'), 'refuz', 'neclar_nepermis', 'V12 neclar fără răspuns la runda 2')
  })
  // V13–V15: răspuns neclar la runda 2 -> încheiere (context vechi = refuz); deduplicată; răspuns târziu semnalat, fără runda 3
  await pas('V13', async () => {
    const vInainte = await ctx(db, T.T1)
    await comenteaza(db, T.T1, U.AUTOR, 'Nu stiu exact.')
    astept(await incheie(db, T.T1, 'neclar', vInainte), 'refuz', 'context_schimbat', 'V13 neclar cu contextul vechi')
    const n0 = await maxNotif(db), rand0 = await randTichet(db, T.T1)
    const r = await incheie(db, T.T1, 'neclar')
    astept(r, 'incheiat', undefined, 'V13 încheiere (neclar)')
    const c = await comentarii(db, T.T1), ult = c[c.length - 1]
    if (ult?.autor !== null || ult?.text !== TEXT_INCHEIERE) ab.push('V13 mesajul de încheiere: ' + JSON.stringify(ult))
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || !egal({ ...nn[0], profile_id: null }, NOTIF_INCHEIERE(nrT(T.T1), T.T1)) || nn[0].profile_id !== U.AUTOR) ab.push('V13 notificarea încheierii: ' + JSON.stringify(nn))
    const ef = (await evid(db, T.T1)).find(x => x.fel === 'incheiere')
    if (!ef || ef.motiv !== 'neclar' || ef.runda !== 2 || Number(ef.comentariu_id) !== Number(ult?.id)) ab.push('V13 evidența încheierii: ' + JSON.stringify(ef))
    if (await randTichet(db, T.T1) !== rand0) ab.push('V13 tichetul s-a schimbat la încheiere')
    const nc = c.length, nt = await nrNotif(db)
    const r2 = await incheie(db, T.T1, 'neclar')
    astept(r2, 'deja_incheiat', undefined, 'V14 încheiere repetată')
    if (r2?.motiv_incheiere !== 'neclar' || r2?.motiv_cerut !== 'neclar' || r2?.acelasi_motiv !== true) ab.push('V14 deja_incheiat fără motivul primului: ' + JSON.stringify(r2))
    const r3 = await incheie(db, T.T1, 'tacere', vInainte)
    astept(r3, 'deja_incheiat', undefined, 'V14 încheiere cu alt motiv și contextul vechi')
    // motivul SALVAT rămâne cel întors; motivul cerut acum e raportat separat (acelasi_motiv = false: intenția nouă NU s-a executat)
    if (r3?.motiv_incheiere !== 'neclar' || r3?.motiv_cerut !== 'tacere' || r3?.acelasi_motiv !== false) ab.push('V14 deja_incheiat cu alt motiv: ' + JSON.stringify(r3))
    if ((await comentarii(db, T.T1)).length !== nc || await nrNotif(db) !== nt) ab.push('V14 dublură la încheiere')
    await comenteaza(db, T.T1, U.AUTOR, 'Am mai gasit ceva.')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'incheiat' || s.raspuns_dupa_incheiere !== true) ab.push('V15 răspunsul târziu nesemnalat: ' + JSON.stringify(s))
    astept(await trimite(db, T.T1, 2, Q2), 'deja_trimis', undefined, 'V15 runda 2 după încheiere')
    astept(await trimite(db, T.T1, 3, Q2), 'refuz', 'runda_invalida', 'V15 runda 3 după încheiere')
    if ((await comentarii(db, T.T1)).length !== nc + 1) ab.push('V15 mesaj automat nou după încheiere')
  })
  // V16: tăcere după runda 1 -> escaladare (nu consumă runda 2); zilele se numără de la momentul SERVERULUI din evidență, nu de la data
  // comentariului (pe care un INSERT o poate alege)
  await pas('V16', async () => {
    astept(await trimite(db, T.T7, 1, ['Ce pași ai făcut?']), 'trimis', undefined, 'V16 runda 1 pe T7')
    let s = await stare(db, T.T7)
    if (s.actiune !== 'asteapta_autor' || s.zile_lucratoare !== 0) ab.push('V16 starea imediat după runda 1: ' + JSON.stringify(s))
    astept(await incheie(db, T.T7, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V16 tăcere sub prag')
    await db.query(`UPDATE public.tichete_comentarii SET created_at = now() - interval '10 days' WHERE tichet_id = ${T.T7}`)
    s = await stare(db, T.T7)
    if (s.actiune !== 'asteapta_autor' || s.zile_lucratoare !== 0) ab.push('V16 data comentariului automat a schimbat tăcerea: ' + JSON.stringify(s))
    await db.query(`UPDATE public.tichete_clarificari SET creat_la = now() - interval '10 days' WHERE tichet_id = ${T.T7}`)
    s = await stare(db, T.T7)
    if (s.actiune !== 'de_escaladat_tacere' || !(s.zile_lucratoare >= 6)) ab.push('V16 starea după 10 zile (momentul serverului): ' + JSON.stringify(s))
    astept(await trimite(db, T.T7, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V16 tăcerea nu consumă runda 2')
    const n0 = await maxNotif(db)
    astept(await incheie(db, T.T7, 'tacere'), 'incheiat', undefined, 'V16 încheiere (tăcere)')
    const c = await comentarii(db, T.T7)
    if (c.length !== 2 || c[1].text !== TEXT_INCHEIERE) ab.push('V16 mesajul de încheiere: ' + JSON.stringify(c))
    if ((await notifNoi(db, n0)).length !== 1) ab.push('V16 notificarea încheierii')
    const ef = (await evid(db, T.T7)).find(x => x.fel === 'incheiere')
    if (ef?.motiv !== 'tacere' || ef?.runda !== 1) ab.push('V16 evidența: ' + JSON.stringify(ef))
    astept(await incheie(db, T.T7, 'tacere'), 'deja_incheiat', undefined, 'V16 încheiere repetată')
    if ((await comentarii(db, T.T7)).length !== 2) ab.push('V16 dublură la încheiere')
  })
  // V17: clar de la început -> doar rândul „clarificat” (fără mesaj); după el nicio rundă; un comentariu ulterior al autorului e semnalat
  await pas('V17', async () => {
    const n0 = await nrNotif(db)
    const r = await incheie(db, T.T8, 'clarificat')
    astept(r, 'incheiat', undefined, 'V17 clarificat la runda 0')
    if ((await comentarii(db, T.T8)).length !== 0 || await nrNotif(db) !== n0) ab.push('V17 „clarificat” a scris mesaj / notificare')
    const e = await evid(db, T.T8)
    if (e.length !== 1 || e[0].fel !== 'clarificat' || e[0].runda !== 0 || e[0].comentariu_id !== null || e[0].autor_tichet !== U.AUTOR2) ab.push('V17 evidența: ' + JSON.stringify(e))
    astept(await trimite(db, T.T8, 1, Q1), 'refuz', 'clarificari_incheiate', 'V17 runda 1 după „clarificat”')
    const r2 = await incheie(db, T.T8, 'clarificat')
    astept(r2, 'deja_incheiat', undefined, 'V17 clarificat repetat')
    if (r2?.motiv_incheiere !== 'clarificat') ab.push('V17 deja_incheiat fără motiv: ' + JSON.stringify(r2))
    let s = await stare(db, T.T8)
    if (s.actiune !== 'incheiat' || s.faza !== 'clarificat' || s.raspuns_dupa_incheiere !== false) ab.push('V17 starea: ' + JSON.stringify(s))
    await comenteaza(db, T.T8, U.AUTOR2, 'Inca un detaliu.', { la: '2001-01-01 10:00+02' })
    s = await stare(db, T.T8)
    if (s.raspuns_dupa_incheiere !== true) ab.push('V17 comentariul de după marcaj (antedatat) nesemnalat: ' + JSON.stringify(s))
  })
  // V18: eligibilitatea (alt departament / altă subcategorie / status final / fără sursă), nimic scris
  await pas('V18', async () => {
    for (const [t, det] of [[T.T3, 'departament'], [T.T4, 'subcategorie'], [T.T5, 'status'], [T.T6, 'sursa']]) {
      astept(await trimite(db, t, 1, Q1), 'refuz', 'neeligibil', `V18 trimite pe T${t}`, det)
      astept(await incheie(db, t, 'clarificat'), 'refuz', 'neeligibil', `V18 incheie pe T${t}`, det)
      if ((await comentarii(db, t)).length !== 0 || (await evid(db, t)).length !== 0) ab.push(`V18 s-a scris pe T${t}`)
    }
    astept(await trimite(db, 999, 1, Q1, 'a'.repeat(32)), 'refuz', 'tichet_inexistent', 'V18 tichet inexistent')
    astept(await incheie(db, T.T2, 'altceva'), 'refuz', 'motiv_invalid', 'V18 motiv invalid')
    astept(await incheie(db, T.T2, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V18 tăcere la runda 0')
    astept(await incheie(db, T.T2, 'clarificat', null), 'refuz', 'versiune_context_lipsa', 'V18 încheiere fără versiunea contextului')
  })
  // V19: textul întrebărilor (T2, runda 0): refuz cu motiv, nimic scris; apoi întrebările legitime trec
  await pas('V19', async () => {
    const ZW = String.fromCharCode(8203), LAT = (s) => [...s].map(ch => /[0-9]/.test(ch) ? String.fromCharCode(65296 + Number(ch)) : ch).join('')
    for (const [intr, motiv] of [
      [[], 'numar_intrebari'], [['a?', 'b?', 'c?', 'd?'], 'numar_intrebari'], [null, 'numar_intrebari'],
      [['Ok?', '   '], 'intrebare_goala'], [[null], 'intrebare_goala'],
      [['x'.repeat(301)], 'intrebare_prea_lunga'],
      [['linia 1\nlinia 2'], 'caractere_control'], [['cu\ttab?'], 'caractere_control'], [['zero' + ZW + 'width?'], 'caractere_control'],
      [['Vezi http://exemplu.ro?'], 'url'], [['Pe www.exemplu.ro?'], 'url'], [['HTTPS : ceva?'], 'url'],
      // cazurile recenzentului + variante: domeniu fără schemă (cu / fără cale), terminație nelistată cu cale, majuscule
      [['Intri pe exemplu.ro/login?'], 'url'], [['Ai deschis exemplu.ro?'], 'url'], [['Pagina ceva.xyzw/pagina?'], 'url'], [['Pe EXEMPLU.COM?'], 'url'],
      [['Numarul 0722123456?'], 'sir_cifre'], [['Telefon 0722 123 456?'], 'sir_cifre'], [['Cod 1.234.567.890?'], 'sir_cifre'],
      [['Suni la 072(123)4567?'], 'sir_cifre'], [['Suni la +40 (722) 123-456?'], 'sir_cifre'], [['IP 192.168.100.10?'], 'sir_cifre'],
      [['Cifre late ' + LAT('0722123456') + '?'], 'sir_cifre'],
      [['Scrie la ion@exemplu.ro?'], 'adresa_email'], [['Contul ion' + String.fromCharCode(65312) + 'exemplu?'], 'adresa_email'], [['Ce e @?'], 'adresa_email'],
      // tabelul recenzentului r2 (refuzate): data + ora lipite, cod cu 9 cifre, „nr.” + 9 cifre
      [['Ce s-a întâmplat pe 13.11.2026 10:30?'], 'sir_cifre'], [['Codul AB-123456789?'], 'sir_cifre'], [['Ai nr. 123456789?'], 'sir_cifre'],
    ]) {
      astept(await trimite(db, T.T2, 1, intr), 'refuz', 'intrebari_invalide', `V19 ${JSON.stringify(intr)?.slice(0, 40)}`, motiv)
    }
    if ((await comentarii(db, T.T2)).length !== 0 || (await evid(db, T.T2)).length !== 0) ab.push('V19 s-a scris ceva la o întrebare refuzată')
    // comportamentul ALES la refuz (r3, aliniat cu promptul, pasul 14): refuzul nu schimbă nimic, tichetul rămâne de evaluat; rutina NU
    // reîncearcă în aceeași rulare cu alt text, trece refuzul în recap (owner-ul decide)
    const sRefuz = await stare(db, T.T2)
    if (sRefuz.actiune !== 'de_evaluat_initial' || sRefuz.runda !== 0) ab.push('V19 starea după refuzuri: ' + JSON.stringify(sRefuz))
    // tabelul recenzentului r2 (acceptate) + reformularea sigură: validatorul întoarce NULL (verificat direct, fără să consume runda)
    for (const bun of ['Tichetul TKT-2026-0360 e cel corect?', 'Apare la ora 10:30?', 'Suma era 1.234,56 lei?', 'Ce dată și ce oră?']) {
      const m = (await db.query(`SELECT public.fn_tichet_clarificare_intrebari_motiv(ARRAY[${q(bun)}]) AS m`)).rows[0].m
      if (m !== null) ab.push(`V19 întrebarea acceptabilă „${bun}” refuzată: ${m}`)
    }
    const lung = 'D'.repeat(299) + '?'
    const bune = [lung, 'Ce s-a întâmplat pe 13.11.2026, apoi pe 14.11.2026?', 'Apare în versiunea 2.5 a raportului.xlsx?']
    const r = await trimite(db, T.T2, 1, bune)
    astept(r, 'trimis', undefined, 'V19 limita de 300 de caractere + date (8 cifre, despărțite de virgulă) + un nume de fișier')
    const c = await comentarii(db, T.T2)
    if (c.length !== 1 || !c[0].text.includes('\n1. ' + lung + '\n2. ' + bune[1] + '\n3. ' + bune[2] + '\n')) ab.push('V19 textul acceptat: ' + JSON.stringify(c))
  })
  // V20: rolurile din API nu pot chema nimic (lipsa GRANT = 42501) și nu pot scrie în tabelul protejat (nici owner-ul aplicației);
  //      authenticated îl poate citi, anon / service_role nu
  await pas('V20', async () => {
    const nc = Number((await db.query(`SELECT count(*) AS n FROM public.tichete_comentarii`)).rows[0].n), ne = await nrEvid(db)
    const V = q('a'.repeat(32))
    for (const [rol, uid] of [['authenticated', U.OWNER], ['authenticated', U.AUTOR2], ['anon', null], ['service_role', null]]) {
      for (const sql of [`SELECT public.fn_tichet_clarificare_trimite(${T.T9}, 1, ARRAY['Ce?'], ${V})`, `SELECT public.fn_tichet_clarificare_incheie(${T.T9}, 'clarificat', ${V})`,
        'SELECT * FROM public.fn_tichet_clarificare_stare()', `SELECT public.fn_tichet_clarificare_stare_tichet(${T.T9})`, `SELECT public.fn_tichet_clarificare_context(${T.T9})`,
        "SELECT public.fn_tichet_clarificare_zile_lucratoare(now(), now())", "SELECT public.fn_tichet_clarificare_intrebari_motiv(ARRAY['x'])",
        'SELECT public.fn_tichet_clarificare_apelant_ok()',
        `INSERT INTO public.tichete_clarificari (tichet_id, fel, runda, autor_tichet, instantaneu_autor, versiune_context) VALUES (${T.T10}, 'clarificat', 0, '${U.AUTOR}', '{}', ${V})`,
        `UPDATE public.tichete_clarificari SET creat_la = now() - interval '30 days'`, 'DELETE FROM public.tichete_clarificari', 'TRUNCATE public.tichete_clarificari',
        // r3: ancorele — nimic pentru niciun rol din API (nici citire), funcția eligibilității nechemabilă
        'SELECT * FROM public.tichete_clarificari_ancore', `INSERT INTO public.tichete_clarificari_ancore (tichet_id, autor) VALUES (${P.T2}, '${U.AUTOR}')`,
        `UPDATE public.tichete_clarificari_ancore SET iesit_la = NULL, iesit_motiv = NULL`, 'DELETE FROM public.tichete_clarificari_ancore',
        'TRUNCATE public.tichete_clarificari_ancore', `SELECT public.fn_tichet_clarificare_eligibil_motiv('it', 'eroare_erp', '{}'::jsonb, 'deschis')`]) {
        const r = await ca(db, rol, uid, sql, { pastreaza: true })
        if (r.code !== '42501') ab.push(`V20 ${rol}${uid ? ' (' + uid.slice(-2) + ')' : ''}: ${sql.slice(0, 70)} -> ${r.code || 'A TRECUT'} ${r.message || ''}`)
      }
    }
    const citit = await ca(db, 'authenticated', U.AUTOR2, 'SELECT count(*)::int AS n FROM public.tichete_clarificari')
    if (citit.code || !(citit.rows[0].n > 0)) ab.push('V20 authenticated nu poate citi evidența: ' + JSON.stringify(citit))
    for (const rol of ['anon', 'service_role']) {
      const r = await ca(db, rol, null, 'SELECT count(*) FROM public.tichete_clarificari')
      if (r.code !== '42501') ab.push(`V20 ${rol} citește evidența: ${r.code || 'A TRECUT'}`)
    }
    // un om nu poate scrie un comentariu fără autor (politica INSERT: autor = auth.uid())
    const r = await ca(db, 'authenticated', U.AUTOR, `INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${T.T9}, NULL, 'Clarificare 1/2\nfals')`, { pastreaza: true })
    if (r.code !== '42501') ab.push('V20 un cont a scris un comentariu fără autor: ' + (r.code || 'A TRECUT'))
    if (Number((await db.query(`SELECT count(*) AS n FROM public.tichete_comentarii`)).rows[0].n) !== nc || await nrEvid(db) !== ne) ab.push('V20 s-a scris ceva')
  })
  // V21: zilele lucrătoare (Europe/Bucharest, fără weekend): valori scrise de mână din calendar
  await pas('V21', async () => {
    for (const [de, la, n] of [
      ['2026-11-13 09:00+02', '2026-11-16 09:00+02', 1], ['2026-11-13 09:00+02', '2026-11-18 09:00+02', 3], ['2026-11-13 09:00+02', '2026-11-13 18:00+02', 0],
      ['2026-11-14 10:00+02', '2026-11-16 10:00+02', 1], ['2026-11-13 23:30+02', '2026-11-14 00:30+02', 0],
      ['2026-11-12 23:30+02', '2026-11-13 00:30+02', 1],   // în UTC ambele cad pe 12.11 (ar da 0): ziua se ia la București
      ['2026-10-23 12:00+03', '2026-10-26 12:00+02', 1],   // peste trecerea la ora de iarnă (25.10.2026)
      ['2026-11-16 09:00+02', '2026-11-13 09:00+02', 0],
    ]) {
      const v = (await db.query(`SELECT public.fn_tichet_clarificare_zile_lucratoare('${de}'::timestamptz, '${la}'::timestamptz) AS z`)).rows[0].z
      if (v !== n) ab.push(`V21 zile ${de} -> ${la}: ${v} (aștepta ${n})`)
    }
    if ((await db.query(`SELECT public.fn_tichet_clarificare_zile_lucratoare(NULL, now()) AS z`)).rows[0].z !== null) ab.push('V21 NULL -> nu e NULL')
  })
  // V22: comentariul automat ȘTERS de owner (politica de ștergere a comentariilor) => „incoerent”, nimic retrimis
  await pas('V22', async () => {
    const r1 = await trimite(db, T.T9, 1, Q1)
    astept(r1, 'trimis', undefined, 'V22 runda 1 pe T9')
    const d = await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.tichete_comentarii WHERE id = ${Number(r1?.comentariu_id)} RETURNING id`, { pastreaza: true })
    if (d.code || d.rows.length !== 1) ab.push('V22 pregătirea (ștergerea de către owner) a eșuat: ' + JSON.stringify(d))
    const s = await stare(db, T.T9)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'comentariu_automat_lipsa') ab.push('V22 starea după ștergerea comentariului automat: ' + JSON.stringify(s))
    astept(await trimite(db, T.T9, 1, Q1), 'refuz', 'stare_incoerenta', 'V22 runda 1 după ștergere')
    astept(await trimite(db, T.T9, 2, Q2), 'refuz', 'stare_incoerenta', 'V22 runda 2 după ștergere')
    astept(await incheie(db, T.T9, 'clarificat'), 'refuz', 'stare_incoerenta', 'V22 încheiere după ștergere')
    if ((await comentarii(db, T.T9)).length !== 0 || (await evid(db, T.T9)).length !== 1) ab.push('V22 s-a scris ceva după ștergere')
  })
  // V23: PATCH pe metadata (orice conținut, de orice cont logat: politica reală o permite) = NICIO influență asupra stării
  await pas('V23', async () => {
    let r = await patch(db, U.ALT, T.T10, `metadata = metadata || ${META_FALS}`)
    if (r.code) ab.push('V23 PATCH-ul pe metadata (politica reală îl permite) a eșuat: ' + r.message)
    let s = await stare(db, T.T10)
    if (s.actiune !== 'de_evaluat_initial' || s.faza !== null || s.runda !== 0) ab.push('V23 metadata falsificată înaintea primei runde a schimbat starea: ' + JSON.stringify(s))
    if (!(await lista(db)).some(x => Number(x.tichet_id) === T.T10 && x.actiune === 'de_evaluat_initial')) ab.push('V23 lista rutinei a luat în seamă metadata falsificată')
    astept(await trimite(db, T.T10, 1, Q1), 'trimis', undefined, 'V23 runda 1 după metadata falsificată')
    r = await patch(db, U.ALT, T.T10, `metadata = jsonb_set(metadata || ${META_FALS}, '{clarificari_erp,runda}', '1')`)
    s = await stare(db, T.T10)
    if (r.code || s.actiune !== 'asteapta_autor' || s.faza !== 'asteapta_autor' || s.runda !== 1) ab.push('V23 metadata falsificată după runda 1 a schimbat starea: ' + JSON.stringify(s))
    await patch(db, U.AUTOR, T.T10, `metadata = metadata - 'clarificari_erp'`)
    await patch(db, U.AUTOR, T.T10, `metadata = '{}'::jsonb || ${META('bug_report')}`)
    s = await stare(db, T.T10)
    if (s.actiune !== 'asteapta_autor' || s.runda !== 1) ab.push('V23 metadata ștearsă / rescrisă a schimbat starea: ' + JSON.stringify(s))
    astept(await incheie(db, T.T10, 'clarificat'), 'refuz', 'fara_raspuns_autor', 'V23 „clarificat” după runda 1 fără răspuns (metadata nu ajută)')
    // și pe T1 (încheiat): PATCH = aceeași stare
    const s1 = await stare(db, T.T1)
    await patch(db, U.ALT, T.T1, `metadata = metadata || ${META_FALS}`)
    if (!egal(await stare(db, T.T1), s1)) ab.push('V23 PATCH pe metadata a schimbat starea lui T1')
  })
  // V24: autorul tichetului schimbat (PATCH pe deschis_de, permis de politica reală) după o rundă => ancora iese => „incoerent”
  await pas('V24', async () => {
    astept(await trimite(db, T.T13, 1, Q1), 'trimis', undefined, 'V24 runda 1 pe T13')
    const r = await patch(db, U.ALT, T.T13, `deschis_de = '${U.AUTOR2}'`)
    if (r.code) ab.push('V24 pregătirea (PATCH deschis_de) a eșuat: ' + r.message)
    await comenteaza(db, T.T13, U.AUTOR2, 'Raspund eu.')
    const s = await stare(db, T.T13)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'iesit_din_protocol:autor_schimbat') ab.push('V24 starea după schimbarea autorului: ' + JSON.stringify(s))
    astept(await trimite(db, T.T13, 2, Q2), 'refuz', 'stare_incoerenta', 'V24 runda 2 după schimbarea autorului')
    // înapoi la autorul inițial: ieșirea e DEFINITIVĂ
    await patch(db, U.ALT, T.T13, `deschis_de = '${U.AUTOR}'`)
    const s2 = await stare(db, T.T13)
    if (s2.actiune !== 'incoerent' || s2.detaliu !== 'iesit_din_protocol:autor_schimbat') ab.push('V24 autorul pus la loc a readus tichetul în protocol: ' + JSON.stringify(s2))
  })
  // V24b: plasa din starea tichetului: cu trigger-ul ancorei OPRIT de un administrator (doar postgres poate), autorul schimbat după o rundă
  //       tot dă „incoerent” (ancora are alt autor decât tichetul), nimic trimis
  await pas('V24b', async () => {
    astept(await trimite(db, T.T25, 1, Q1), 'trimis', undefined, 'V24b runda 1 pe T25')
    await db.exec('ALTER TABLE public.tichete DISABLE TRIGGER trg_tichet_clarificare_ancora')
    try { await patch(db, U.ALT, T.T25, `deschis_de = '${U.ALT}'`) } finally { await db.exec('ALTER TABLE public.tichete ENABLE TRIGGER trg_tichet_clarificare_ancora') }
    if ((await ancora(db, T.T25))?.iesit_la !== null) ab.push('V24b pregătirea: ancora a ieșit deși trigger-ul era oprit')
    await comenteaza(db, T.T25, U.ALT, 'Raspund eu, noul autor.')
    const s = await stare(db, T.T25)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'autor_schimbat') ab.push('V24b starea cu trigger-ul oprit: ' + JSON.stringify(s))
    const n0 = await maxNotif(db)
    astept(await trimite(db, T.T25, 2, Q2), 'refuz', 'stare_incoerenta', 'V24b runda 2 cu trigger-ul oprit')
    if ((await notifNoi(db, n0)).length) ab.push('V24b notificare trimisă')
  })
  // V25: un comentariu automat NELISTAT (fără rând de evidență) => „incoerent”
  await pas('V25', async () => {
    await db.query(`INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${T.T15}, NULL, ${q('Clarificare 1/2\nfals')})`)
    const s = await stare(db, T.T15)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'comentariu_automat_neinregistrat') ab.push('V25 comentariul automat nelistat: ' + JSON.stringify(s))
    astept(await trimite(db, T.T15, 1, Q1), 'refuz', 'stare_incoerenta', 'V25 runda 1 cu un comentariu automat nelistat')
  })
  // V26: INSTANTANEUL decide răspunsul, nu datele / id-urile alese la INSERT
  await pas('V26', async () => {
    // T11: comentariu al autorului ÎNAINTEA rundei 1, postdatat cu 10 ani (cazul recenzentului) => NU e răspuns
    await comenteaza(db, T.T11, U.AUTOR, 'Scris inainte, datat in viitor.', { la: '2036-11-13 10:00+02' })
    astept(await trimite(db, T.T11, 1, Q1), 'trimis', undefined, 'V26 runda 1 pe T11')
    let s = await stare(db, T.T11)
    if (s.actiune !== 'asteapta_autor' || s.raspuns_autor !== false) ab.push('V26 comentariul postdatat de dinaintea rundei a fost luat drept răspuns: ' + JSON.stringify(s))
    astept(await trimite(db, T.T11, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V26 runda 2 pe baza comentariului postdatat')
    // după runda 1, un comentariu ANTEDATAT cu 25 de ani => e răspuns
    await comenteaza(db, T.T11, U.AUTOR, 'Scris dupa, datat in trecut.', { la: '2001-01-01 10:00+02' })
    s = await stare(db, T.T11)
    if (s.actiune !== 'de_evaluat_raspuns' || s.raspuns_autor !== true) ab.push('V26 răspunsul antedatat nu e văzut: ' + JSON.stringify(s))
    astept(await trimite(db, T.T11, 2, Q2), 'trimis', undefined, 'V26 runda 2 după răspunsul antedatat')
    // T12: id-uri ALESE: înaintea rundei un id uriaș (în instantaneu => nu e răspuns), după ea un id negativ (în afara lui => e răspuns)
    await comenteaza(db, T.T12, U.AUTOR, 'Id mare, scris inainte.', { id: 900000000, la: '2036-11-13 10:00+02' })
    astept(await trimite(db, T.T12, 1, Q1), 'trimis', undefined, 'V26 runda 1 pe T12')
    s = await stare(db, T.T12)
    if (s.actiune !== 'asteapta_autor' || s.raspuns_autor !== false) ab.push('V26 id-ul mare de dinaintea rundei a fost luat drept răspuns: ' + JSON.stringify(s))
    await comenteaza(db, T.T12, U.AUTOR, 'Id ales mic, scris dupa.', { id: -5, la: '2001-01-01 10:00+02' })
    s = await stare(db, T.T12)
    if (s.actiune !== 'de_evaluat_raspuns' || s.raspuns_autor !== true) ab.push('V26 răspunsul cu id ales mic nu e văzut: ' + JSON.stringify(s))
    const e = (await evid(db, T.T12))[0]
    if (!egal(ids(e?.instantaneu_autor), [900000000])) ab.push('V26 instantaneul rundei 1 pe T12: ' + JSON.stringify(e?.instantaneu_autor))
  })
  // V27: context_schimbat și la marcajul „clarificat” (T14, runda 0): un comentariu nou după citire = refuz, nimic scris
  await pas('V27', async () => {
    const v0 = (await lista(db)).find(x => Number(x.tichet_id) === T.T14)?.versiune_context
    if (!MD5.test(v0 || '')) ab.push('V27 lista rutinei fără versiune_context: ' + v0)
    await comenteaza(db, T.T14, U.AUTOR, 'Mai adaug un detaliu.')
    astept(await incheie(db, T.T14, 'clarificat', v0), 'refuz', 'context_schimbat', 'V27 clarificat cu contextul vechi')
    if ((await evid(db, T.T14)).length !== 0) ab.push('V27 context_schimbat a scris evidența')
    const v1 = (await lista(db)).find(x => Number(x.tichet_id) === T.T14)?.versiune_context
    if (v1 === v0) ab.push('V27 versiunea contextului nu s-a schimbat după un comentariu nou')
    astept(await incheie(db, T.T14, 'clarificat', v1), 'incheiat', undefined, 'V27 clarificat cu contextul nou')
    // titlul / descrierea intră în context; metadata nu
    const v2 = await ctx(db, T.T14)
    await patch(db, U.ALT, T.T14, `metadata = metadata || '{"x": 1}'::jsonb`)
    if (await ctx(db, T.T14) !== v2) ab.push('V27 metadata a schimbat versiunea contextului')
    await patch(db, U.AUTOR, T.T14, `descriere = 'Descriere noua'`)
    if (await ctx(db, T.T14) === v2) ab.push('V27 descrierea nu intră în versiunea contextului')
  })
  // V28: trigger-ul REAL de status: nimic din partea noastră (V3: exact o notificare), dar notifică la o schimbare reală de status;
  // tichetul trecut în status final iese din listă și nu mai primește nimic
  await pas('V28', async () => {
    const n0 = await maxNotif(db)
    const r = await ca(db, 'authenticated', U.OWNER, `UPDATE public.tichete SET status = 'rezolvat', descriere_interventie = 'Rezolvat in test' WHERE id = ${T.T2}`, { pastreaza: true })
    if (r.code) ab.push('V28 schimbarea de status: ' + r.message)
    const nn = await notifNoi(db, n0)
    if (!nn.some(n => n.profile_id === U.AUTOR2 && n.title === `🎫 Tichetul tău ${nrT(T.T2)} — rezolvat`)) ab.push('V28 trigger-ul real de status nu a notificat creatorul (proba e nefuncțională): ' + JSON.stringify(nn))
    astept(await trimite(db, T.T2, 2, Q2), 'refuz', 'neeligibil', 'V28 runda 2 pe tichet rezolvat', 'status')
  })
  // ── r3, P1: proveniența ancorată la creare (contraexemplele recenzentului) ──
  // V30: contul ALT își pune deschis_de pe tichetul lui AUTOR ÎNAINTEA primei runde: nici versiunea veche, nici cea nouă nu trimit nimic
  //      (nicio notificare către ALT), comentariul lui ALT nu e „răspunsul autorului”; înapoi la AUTOR = tot în afară (definitiv)
  await pas('V30', async () => {
    const vVeche = await ctx(db, T.T16)
    const r = await patch(db, U.ALT, T.T16, `deschis_de = '${U.ALT}'`)
    if (r.code) ab.push('V30 pregătirea (PATCH deschis_de, permis de politica reală) a eșuat: ' + r.message)
    const a = await ancora(db, T.T16)
    if (a?.iesit_motiv !== 'autor_schimbat' || !a?.iesit_la || a?.autor !== U.AUTOR) ab.push('V30 ancora după PATCH: ' + JSON.stringify(a))
    let s = await stare(db, T.T16)
    if (s.eligibil !== false || s.motiv !== 'iesit_din_protocol:autor_schimbat') ab.push('V30 starea după substituirea autorului: ' + JSON.stringify(s))
    if (vVeche === await ctx(db, T.T16)) ab.push('V30 autorul nu intră în versiunea contextului')
    const n0 = await maxNotif(db)
    for (const v of [vVeche, await ctx(db, T.T16)]) {
      astept(await trimite(db, T.T16, 1, Q1, v), 'refuz', 'neeligibil', 'V30 runda 1 după substituire', 'iesit_din_protocol:autor_schimbat')
      astept(await incheie(db, T.T16, 'clarificat', v), 'refuz', 'neeligibil', 'V30 încheiere după substituire', 'iesit_din_protocol:autor_schimbat')
    }
    await comenteaza(db, T.T16, U.ALT, 'Raspund eu ca autor.')
    if ((await notifNoi(db, n0)).length || (await evid(db, T.T16)).length || (await comentarii(db, T.T16)).some(c => c.autor === null)) ab.push('V30 s-a scris ceva după substituire')
    if ((await lista(db)).some(x => Number(x.tichet_id) === T.T16)) ab.push('V30 tichetul cu autorul substituit e în lista rutinei')
    await patch(db, U.ALT, T.T16, `deschis_de = '${U.AUTOR}'`)
    s = await stare(db, T.T16)
    if (s.eligibil !== false || s.motiv !== 'iesit_din_protocol:autor_schimbat') ab.push('V30 autorul pus la loc a readus tichetul: ' + JSON.stringify(s))
  })
  // V31: promovarea prin metadata.sursa: tichet creat FĂRĂ sursa butonului (T6), ALT pune sursa = bug_report => tot în afară (fără ancoră)
  await pas('V31', async () => {
    const r = await patch(db, U.ALT, T.T6, `metadata = metadata || '{"sursa": "bug_report"}'::jsonb`)
    if (r.code) ab.push('V31 pregătirea (PATCH metadata) a eșuat: ' + r.message)
    const s = await stare(db, T.T6)
    if (s.eligibil !== false || s.motiv !== 'fara_ancora') ab.push('V31 tichetul promovat prin metadata: ' + JSON.stringify(s))
    astept(await trimite(db, T.T6, 1, Q1), 'refuz', 'neeligibil', 'V31 runda 1 pe tichetul promovat', 'fara_ancora')
    // la fel subcategoria: T4 (acces_cont) mutat pe eroare_erp
    await patch(db, U.ALT, T.T4, `subcategorie = 'eroare_erp'`)
    astept(await trimite(db, T.T4, 1, Q1), 'refuz', 'neeligibil', 'V31 runda 1 pe tichetul mutat pe subcategoria butonului', 'fara_ancora')
    if ((await comentarii(db, T.T6)).length || (await comentarii(db, T.T4)).length) ab.push('V31 s-a scris ceva')
  })
  // V32: redeschiderea: închis de owner, redeschis de ALT => în afară definitiv (fără runde: neeligibil; cu runde: incoerent, la owner)
  await pas('V32', async () => {
    await patch(db, U.OWNER, T.T17, `status = 'inchis'`)
    await patch(db, U.ALT, T.T17, `status = 'deschis'`)
    let s = await stare(db, T.T17)
    if (s.eligibil !== false || s.motiv !== 'iesit_din_protocol:status') ab.push('V32 tichetul redeschis (fără runde): ' + JSON.stringify(s))
    astept(await trimite(db, T.T17, 1, Q1), 'refuz', 'neeligibil', 'V32 runda 1 pe tichetul redeschis', 'iesit_din_protocol:status')
    astept(await trimite(db, T.T18, 1, Q1), 'trimis', undefined, 'V32 runda 1 pe T18')
    await patch(db, U.OWNER, T.T18, `status = 'rezolvat'`)
    await patch(db, U.ALT, T.T18, `status = 'in_lucru'`)
    await comenteaza(db, T.T18, U.AUTOR, 'Raspuns dupa redeschidere.')
    s = await stare(db, T.T18)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'iesit_din_protocol:status') ab.push('V32 tichetul redeschis în protocol: ' + JSON.stringify(s))
    astept(await trimite(db, T.T18, 2, Q2), 'refuz', 'stare_incoerenta', 'V32 runda 2 pe tichetul redeschis')
    if ((await comentarii(db, T.T17)).length !== 0 || (await evid(db, T.T18)).length !== 1) ab.push('V32 s-a scris ceva după redeschidere')
  })
  // V33: un tichet creat FĂRĂ JWT-ul autorului (service_role, ca o cale de server) cu deschis_de = AUTOR => fără ancoră; un cont nu poate
  //      crea un tichet pe numele altuia (politica reală de INSERT)
  await pas('V33', async () => {
    const r = await ca(db, 'service_role', null, `INSERT INTO public.tichete (departament, subcategorie, titlu, status, deschis_de, metadata, created_at)
      VALUES ('it', 'eroare_erp', 'Creat de server 33', 'deschis', '${U.AUTOR}', ${META('bug_report')}, '2026-11-16 10:00+02') RETURNING id`, { pastreaza: true })
    if (r.code) { ab.push('V33 pregătirea (INSERT service_role) a eșuat: ' + r.message); return }
    const id = Number(r.rows[0].id)
    const s = await stare(db, id)
    if (s.eligibil !== false || s.motiv !== 'fara_ancora' || await ancora(db, id)) ab.push('V33 tichetul creat fără JWT-ul autorului: ' + JSON.stringify(s))
    astept(await trimite(db, id, 1, Q1), 'refuz', 'neeligibil', 'V33 runda 1 pe tichetul creat de server', 'fara_ancora')
    const r2 = await ca(db, 'authenticated', U.ALT, `INSERT INTO public.tichete (departament, subcategorie, titlu, status, deschis_de, metadata)
      VALUES ('it', 'eroare_erp', 'Pe numele altuia 33', 'deschis', '${U.AUTOR}', ${META('bug_report')}) RETURNING id`, { pastreaza: true })
    if (r2.code !== '42501') ab.push('V33 un cont a creat un tichet pe numele altuia: ' + (r2.code || 'A TRECUT'))
    if ((await comentarii(db, id)).length) ab.push('V33 s-a scris ceva')
  })
  // V34: id refolosit: owner-ul șterge T19 (ancorat); un INSERT de server cu ACELAȘI id și deschis_de = AUTOR => ancora veche iese, tichetul
  //      nou NU intră; T20 (cu o rundă): șters, recreat de ALT cu același id => incoerent (evidența veche rămâne), nimic trimis
  await pas('V34', async () => {
    let r = await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.tichete WHERE id = ${T.T19} RETURNING id`, { pastreaza: true })
    if (r.code || r.rows.length !== 1) ab.push('V34 pregătirea (ștergerea de către owner): ' + JSON.stringify(r))
    r = await ca(db, 'service_role', null, `INSERT INTO public.tichete (id, departament, subcategorie, titlu, status, deschis_de, metadata, created_at)
      VALUES (${T.T19}, 'it', 'eroare_erp', 'Recreat cu id-ul vechi 19', 'deschis', '${U.AUTOR}', ${META('bug_report')}, '2026-11-20 09:00+02') RETURNING id`, { pastreaza: true })
    if (r.code) ab.push('V34 pregătirea (recrearea) a eșuat: ' + r.message)
    const a = await ancora(db, T.T19)
    if (a?.iesit_motiv !== 'id_refolosit') ab.push('V34 ancora id-ului refolosit: ' + JSON.stringify(a))
    let s = await stare(db, T.T19)
    if (s.eligibil !== false || s.motiv !== 'iesit_din_protocol:id_refolosit') ab.push('V34 tichetul recreat cu id-ul vechi: ' + JSON.stringify(s))
    astept(await trimite(db, T.T19, 1, Q1), 'refuz', 'neeligibil', 'V34 runda 1 pe tichetul recreat', 'iesit_din_protocol:id_refolosit')
    astept(await trimite(db, T.T20, 1, Q1), 'trimis', undefined, 'V34 runda 1 pe T20')
    r = await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.tichete WHERE id = ${T.T20} RETURNING id`, { pastreaza: true })
    r = await ca(db, 'authenticated', U.ALT, `INSERT INTO public.tichete (id, departament, subcategorie, titlu, status, deschis_de, metadata, created_at)
      VALUES (${T.T20}, 'it', 'eroare_erp', 'Recreat de ALT 20', 'deschis', '${U.ALT}', ${META('bug_report')}, '2026-11-20 10:00+02') RETURNING id`, { pastreaza: true })
    if (r.code) ab.push('V34 pregătirea (recrearea de către ALT) a eșuat: ' + r.message)
    s = await stare(db, T.T20)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'iesit_din_protocol:id_refolosit') ab.push('V34 tichetul recreat peste o evidență veche: ' + JSON.stringify(s))
    const n0 = await maxNotif(db)
    astept(await trimite(db, T.T20, 2, Q2), 'refuz', 'stare_incoerenta', 'V34 runda 2 pe tichetul recreat')
    astept(await incheie(db, T.T20, 'clarificat'), 'refuz', 'stare_incoerenta', 'V34 încheiere pe tichetul recreat')
    if ((await notifNoi(db, n0)).length) ab.push('V34 notificare către ALT')
  })
  // V35: id mutat: owner-ul șterge T21 (ancorat, AUTOR); ALT își mută propriul tichet (T22) pe id-ul lui T21 și pune deschis_de = AUTOR
  //      (politica reală de UPDATE o permite) => ancora veche iese (id_schimbat), nimic trimis
  await pas('V35', async () => {
    await ca(db, 'authenticated', U.OWNER, `DELETE FROM public.tichete WHERE id = ${T.T21}`, { pastreaza: true })
    const r = await patch(db, U.ALT, T.T22, `id = ${T.T21}, deschis_de = '${U.AUTOR}'`)
    if (r.code) ab.push('V35 pregătirea (UPDATE id) a eșuat: ' + r.message)
    const a = await ancora(db, T.T21)
    if (a?.iesit_motiv !== 'id_schimbat' || (await ancora(db, T.T22))?.iesit_motiv !== 'id_schimbat') ab.push('V35 ancorele după mutarea id-ului: ' + JSON.stringify([a, await ancora(db, T.T22)]))
    const s = await stare(db, T.T21)
    if (s.eligibil !== false || s.motiv !== 'iesit_din_protocol:id_schimbat') ab.push('V35 tichetul mutat pe id-ul vechi: ' + JSON.stringify(s))
    astept(await trimite(db, T.T21, 1, Q1), 'refuz', 'neeligibil', 'V35 runda 1 pe tichetul mutat', 'iesit_din_protocol:id_schimbat')
  })
  // V36: versiunea contextului conține autorul și statusul (r3): o schimbare între citire și apel = context_schimbat
  await pas('V36', async () => {
    const v0 = await ctx(db, T.T24)
    await patch(db, U.OWNER, T.T24, `status = 'atribuit'`)
    const v1 = await ctx(db, T.T24)
    if (v1 === v0) ab.push('V36 statusul nu intră în versiunea contextului')
    astept(await trimite(db, T.T24, 1, Q1, v0), 'refuz', 'context_schimbat', 'V36 runda 1 cu contextul de dinaintea schimbării de status')
    if ((await comentarii(db, T.T24)).length || (await evid(db, T.T24)).length) ab.push('V36 context_schimbat a scris ceva')
  })
  // ── r3, P2: FOTOGRAFIA unică (verificare + context + instantaneu); un comentariu confirmat exact în fereastră rămâne detectabil ──
  // V37: runda 2 pe T23 (după răspunsul R1); în fereastra de după verificarea răspunsurilor, autorul confirmă X => runda 2 pleacă (contextul
  //      citit de rutină nu-l conținea), instantaneul rundei 2 = [R1] (FĂRĂ X), iar după ea X e „răspuns” (de_evaluat_raspuns)
  await pas('V37', async () => {
    astept(await trimite(db, T.T23, 1, Q1), 'trimis', undefined, 'V37 runda 1 pe T23')
    const r1 = await comenteaza(db, T.T23, U.AUTOR, 'Raspunsul la runda 1.')
    const v = await ctx(db, T.T23)
    const r = await cuInjectie(db, T.T23, U.AUTOR, 'Scris in fereastra rundei 2', () => trimite(db, T.T23, 2, Q2, v))
    astept(r, 'trimis', undefined, 'V37 runda 2 cu un comentariu scris în fereastră')
    const x = (await comentarii(db, T.T23)).find(c => c.text === 'Scris in fereastra rundei 2')
    if (!x) { ab.push('V37 PROBA NEFUNCȚIONALĂ: injecția nu a scris comentariul'); return }
    const e2 = (await evid(db, T.T23)).find(e => e.fel === 'runda' && e.runda === 2)
    if (!egal(ids(e2?.instantaneu_autor), [r1])) ab.push(`V37 instantaneul rundei 2 (aștepta [${r1}], fără comentariul din fereastră ${x.id}): ${JSON.stringify(e2?.instantaneu_autor)}`)
    const s = await stare(db, T.T23)
    if (s.actiune !== 'de_evaluat_raspuns' || s.raspuns_autor !== true) ab.push('V37 comentariul din fereastră a fost „consumat” (nu mai e răspuns): ' + JSON.stringify(s))
  })
  // V38: tăcerea pe T24: în fereastra încheierii, autorul confirmă X => încheierea pleacă, dar X rămâne semnalat (raspuns_dupa_incheiere)
  await pas('V38', async () => {
    astept(await trimite(db, T.T24, 1, Q1), 'trimis', undefined, 'V38 runda 1 pe T24')
    await db.query(`UPDATE public.tichete_clarificari SET creat_la = now() - interval '10 days' WHERE tichet_id = ${T.T24}`)
    if ((await stare(db, T.T24)).actiune !== 'de_escaladat_tacere') { ab.push('V38 PROBA NEFUNCȚIONALĂ: pregătirea tăcerii'); return }
    const v = await ctx(db, T.T24)
    const r = await cuInjectie(db, T.T24, U.AUTOR, 'Scris in fereastra incheierii', () => incheie(db, T.T24, 'tacere', v))
    astept(r, 'incheiat', undefined, 'V38 încheierea (tăcere) cu un comentariu scris în fereastră')
    const x = (await comentarii(db, T.T24)).find(c => c.text === 'Scris in fereastra incheierii')
    if (!x) { ab.push('V38 PROBA NEFUNCȚIONALĂ: injecția nu a scris comentariul'); return }
    const ef = (await evid(db, T.T24)).find(e => e.fel === 'incheiere')
    if (ids(ef?.instantaneu_autor).includes(Number(x.id))) ab.push('V38 instantaneul încheierii conține comentariul din fereastră: ' + JSON.stringify(ef?.instantaneu_autor))
    const s = await stare(db, T.T24)
    if (s.actiune !== 'incheiat' || s.raspuns_dupa_incheiere !== true) ab.push('V38 comentariul din fereastră a dispărut din semnale: ' + JSON.stringify(s))
  })
  // V29: lista rutinei: DOAR tichetele eligibile, ordine (created_at, id), acțiunile (scrise de mână din pașii de mai sus), versiunea contextului
  await pas('V29', async () => {
    const l = await lista(db)
    const am = l.map(x => [Number(x.tichet_id), x.actiune, x.raspuns_dupa_incheiere])
    // r3: tichetele de dinainte de aplicare (P.*) nu apar; T16 / T17 / T19 (refolosit, fără evidență) / T21 (mutat) / T22 ies tăcut; T18,
    // T20 (cu evidență) și T25 = incoerent; id-ul refolosit al lui T20 are data de creare a tichetului nou
    const astepta = [[T.T1, 'incheiat', true], [T.T7, 'incheiat', false], [T.T8, 'incheiat', true], [T.T9, 'incoerent', false], [T.T10, 'asteapta_autor', false],
      [T.T11, 'asteapta_autor', false], [T.T12, 'de_evaluat_raspuns', false], [T.T13, 'incoerent', false], [T.T14, 'incheiat', false], [T.T15, 'incoerent', false],
      [T.T18, 'incoerent', false], [T.T23, 'de_evaluat_raspuns', false], [T.T24, 'incheiat', true], [T.T25, 'incoerent', false], [T.T20, 'incoerent', false]]
    if (!egal(am, astepta)) ab.push('V29 lista rutinei: ' + JSON.stringify(am) + ' (aștepta ' + JSON.stringify(astepta) + ')')
    for (const x of l) if (x.versiune_context !== await ctx(db, Number(x.tichet_id))) ab.push(`V29 versiune_context pentru T${x.tichet_id}`)
  })
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
  let m = null; try { await aplicaMig(db, MIG_B) } catch (e) { m = e.message }
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista clarificari trimise/.test(m || ''), 'revenirea refuză după folosire: ' + m)
  await db.close()
}

// ── 1b. verificarea apelantului ÎN COD (nu doar prin GRANT): cu un GRANT greșit către authenticated (postcondiția scoasă), apelul din API
//        tot e refuzat; la fel prin altă funcție DEFINER expusă ──
console.log('1b. verificarea apelantului în cod')
const FARA_POST_DREPT = [["      IF has_function_privilege(v_rol, to_regprocedure(r.fn), 'EXECUTE') THEN", '      IF false THEN'],
  ["                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) = 'postgres:EXECUTE') THEN", "                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) IS NOT NULL) THEN"]]
const GRANT_GRESIT = [['-- ── postcondiții ──', 'GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text), public.fn_tichet_clarificare_stare(), public.fn_tichet_clarificare_incheie(bigint, text, text) TO authenticated, service_role;\n-- ── postcondiții ──']]
const VC = "'" + 'a'.repeat(32) + "'"
async function probaCod(mutanti = []) {
  const db = await bazaNoua()
  try {
    await aplicaMig(db, aplica(MIG_B, [...FARA_POST_DREPT, ...GRANT_GRESIT, ...mutanti]))
    await tichetePostMig(db)
    await db.exec(`CREATE FUNCTION public.fn_expus_test(p bigint, v text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      SELECT public.fn_tichet_clarificare_trimite(p, 1, ARRAY['Ce?'], v) $f$; GRANT EXECUTE ON FUNCTION public.fn_expus_test(bigint, text) TO authenticated;`)
    const v = await ctx(db, T.T1)
    const r1 = await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_tichet_clarificare_trimite(${T.T1}, 1, ARRAY['Ce?'], '${v}') AS r`, { pastreaza: true })
    const r2 = await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_expus_test(${T.T1}, '${v}') AS r`, { pastreaza: true })
    const r3 = await ca(db, 'authenticated', U.OWNER, 'SELECT * FROM public.fn_tichet_clarificare_stare()', { pastreaza: true })
    const r4 = await ca(db, 'service_role', null, `SELECT public.fn_tichet_clarificare_incheie(${T.T1}, 'clarificat', '${v}') AS r`, { pastreaza: true })
    const scris = (await comentarii(db, T.T1)).length + (await evid(db, T.T1)).length
    return { r1: r1.rows?.[0]?.r?.motiv || r1.code, r2: r2.rows?.[0]?.r?.motiv || r2.code, r3: r3.code || 'lista', r4: r4.code || r4.rows?.[0]?.r?.motiv, scris }
  } finally { await db.close() }
}
{
  const p = await probaCod()
  ok(p.r1 === 'apelant_nepermis' && p.r2 === 'apelant_nepermis' && p.r3 === '42501' && p.r4 === 'apelant_nepermis' && p.scris === 0,
    `GRANT greșit: direct = ${p.r1}, prin DEFINER expus = ${p.r2}, lista = ${p.r3}, service_role = ${p.r4}, scris = ${p.scris}`)
  const pm = await probaCod([["  IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'apelant_nepermis', 'tichet_id', p_tichet_id);\n  END IF;\n  IF p_runda IS NULL", '  IF p_runda IS NULL']])
  ok(pm.scris > 0, `mutantul „fără verificarea în cod” (cu GRANT greșit) scrie (${pm.scris}) = verificarea e necesară`)
  const pa = await probaCod([["  SELECT session_user = 'postgres' AND current_setting('role') = 'none'", "  SELECT session_user = 'postgres'"]])
  ok(pa.scris > 0, `mutantul „fără verificarea rolului setat” (session_user e postgres și în PGlite) scrie (${pa.scris}) = verificarea rolului e necesară`)
}

// ── 2. refuzurile migrării ──
console.log('2. refuzurile migrării')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', (db) => aplicaMig(db, MIG_B, { marcaj: false }), /garda start invalida/],
  ['fără plafon', (db) => aplicaMig(db, MIG_B, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcaj', (db) => aplicaMig(db, MIG_B, { marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['baseline necompletat', (db) => aplicaMig(db, MIG_NECOMPLETAT), /baseline L15 necompletat/],
  ['baseline-ul de producție pe schema falsă (altă stare)', (db) => aplicaMig(db, MIG), /difera de baseline-ul L15 revizuit/],
  ['un tabel tichete_clarificari existent', async (db) => {
    await db.exec(`CREATE TABLE public.tichete_clarificari (x int);`)
    return aplicaMig(db, MIG_B)
  }, /reaplicare/],
  ['trigger nou pe tichete apărut după citire', async (db) => {
    await db.exec(`CREATE FUNCTION public.fn_nou_test() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;
      CREATE TRIGGER trg_nou_test AFTER UPDATE ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_nou_test();`)
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15 revizuit: .*tabel tichete \| triggere/],
  ['funcția reală de status schimbată', async (db) => {
    await db.exec(aplica(REAL_NOTIF.split('\nCREATE TRIGGER')[0].replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION'),
      [["IF OLD.status = NEW.status THEN RETURN NEW; END IF;", 'NULL;']]))
    return aplicaMig(db, MIG_B)
  }, /difera de baseline-ul L15 revizuit: functie fn_tichete_notif_on_status_change\(\)/],
  ['politică nouă pe comentarii', async (db) => {
    await db.exec(`CREATE POLICY comentarii_upd ON public.tichete_comentarii FOR UPDATE TO authenticated USING (true);`)
    return aplicaMig(db, MIG_B)
  }, /tabel tichete_comentarii \| politici/],
  ['drept nou pentru anon pe notifications', async (db) => {
    await db.exec(`REVOKE ALL ON public.notifications FROM anon; GRANT SELECT ON public.notifications TO anon;`)
    return aplicaMig(db, MIG_B)
  }, /tabel notifications \| acl/],
  ['FORCE RLS pe comentarii', async (db) => {
    await db.exec(`CREATE ROLE proprietar_test NOLOGIN; ALTER TABLE public.tichete_comentarii OWNER TO proprietar_test;`)
    return aplicaMig(db, MIG_B)
  }, /RLS s-ar aplica proprietarului|difera de baseline/],
  ['autor NOT NULL pe comentarii', async (db) => {
    await db.exec(`ALTER TABLE public.tichete_comentarii ALTER COLUMN autor SET NOT NULL;`)
    return aplicaMig(db, MIG_B)
  }, /autor e NOT NULL/],
  ['un drept de scriere pe tabelul nou (GRANT greșit în migrare)', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── postcondiții ──', 'GRANT INSERT ON public.tichete_clarificari TO authenticated;\n-- ── postcondiții ──']])),
    /drept INSERT pe tichete_clarificari pentru authenticated/],
  ['o politică de scriere pe tabelul nou', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── postcondiții ──', 'CREATE POLICY tc_scriere ON public.tichete_clarificari FOR INSERT TO authenticated WITH CHECK (true);\n-- ── postcondiții ──']])),
    /tabelul tichete_clarificari \(proprietar/],
  ['EXECUTE rămas pentru PUBLIC pe o funcție internă', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── postcondiții ──', 'GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_context(bigint) TO PUBLIC;\n-- ── postcondiții ──']])),
    /functia public\.fn_tichet_clarificare_context\(bigint\)/],
  // r3: obiectele noi (ancora)
  ['un tabel tichete_clarificari_ancore existent', async (db) => {
    await db.exec(`CREATE TABLE public.tichete_clarificari_ancore (x int);`)
    return aplicaMig(db, MIG_B)
  }, /reaplicare/],
  ['un drept de citire pe tabelul ancorelor', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── postcondiții ──', 'GRANT SELECT ON public.tichete_clarificari_ancore TO authenticated;\n-- ── postcondiții ──']])),
    /drept SELECT pe tichete_clarificari_ancore pentru authenticated/],
  ['o politică pe tabelul ancorelor', (db) => aplicaMig(db, aplica(MIG_B, [['-- ── postcondiții ──', 'CREATE POLICY ta_citire ON public.tichete_clarificari_ancore FOR SELECT TO authenticated USING (true);\n-- ── postcondiții ──']])),
    /tabelul tichete_clarificari_ancore \(proprietar/],
  ['trigger-ul ancorei cu WHEN', (db) => aplicaMig(db, aplica(MIG_B, [['FOR EACH ROW EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();', "FOR EACH ROW WHEN (NEW.status <> 'inchis') EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();"]])),
    /trigger-ul ancorei pe tichete/],
  ['trigger-ul ancorei doar la INSERT', (db) => aplicaMig(db, aplica(MIG_B, [['AFTER INSERT OR UPDATE ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();', 'AFTER INSERT ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();']])),
    /trigger-ul ancorei pe tichete|L15 dupa/],
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const ramas = (await db.query(`SELECT to_regprocedure('public.fn_tichet_clarificare_trimite(bigint,integer,text[],text)') IS NULL AS gol`)).rows[0].gol
  ok(re.test(m || '') && ramas, `${nume}: ${(m || 'NU a refuzat').slice(0, 200)}`)
  await db.close()
}

// ── 2b. L15: închiderea tranzitivă, EXECUTE pe lanț / în afara lui, schimbarea între verificări, funcțiile noi ──
console.log('2b. L15: închiderea tranzitivă și ce nu se poate amprenta')
const ACTIUNE_SCHIMBATA = `CREATE OR REPLACE FUNCTION public.fn_tichete_istoric_actiune(p_vechi text, p_nou text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT jsonb_build_object('from', p_nou, 'to', p_vechi) $f$;`
const MARCHEAZA_SCHIMBAT = `CREATE OR REPLACE FUNCTION public.fn_tichete_istoric_marcheaza() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN NEW.created_at := now() - interval '1 year'; RETURN NEW; END $f$;`
const ETICHETA_SCHIMBATA = `CREATE OR REPLACE FUNCTION public.fn_tichete_istoric_eticheta(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT 'fals' $f$;`
const ACTIUNE_EXECUTE =`CREATE OR REPLACE FUNCTION public.fn_tichete_istoric_actiune(p_vechi text, p_nou text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE r jsonb; BEGIN EXECUTE 'SELECT jsonb_build_object(''from'', $1, ''to'', $2)' INTO r USING p_vechi, p_nou; RETURN r; END $f$;`
const ACTIUNE_FARA_PATH = `CREATE OR REPLACE FUNCTION public.fn_tichete_istoric_actiune(p_vechi text, p_nou text) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER AS $f$
  SELECT jsonb_build_object('from', p_vechi, 'to', p_nou) $f$;`
const INTRE_VERIFICARI = (sql) => [['-- ── punctul UNIC de blocare (L06)', sql + '\n-- ── punctul UNIC de blocare (L06)']]
const MIG_APEL_STRAIN = [["  SELECT session_user = 'postgres' AND current_setting('role') = 'none'\n$f$;", "  SELECT session_user = 'postgres' AND current_setting('role') = 'none' AND auth.uid() IS NULL\n$f$;"]]
const SCEN = {
  // baseline-ul pe care l-ar da o închidere FĂRĂ triggerele tabelelor scrise de lanț (tichete_istoric), cu trigger-ul acelui tabel schimbat
  lantPrinTabel: { dupa: MARCHEAZA_SCHIMBAT, rows: (b) => b.filter(r => r.eticheta !== 'functie fn_tichete_istoric_marcheaza()') },
  // baseline-ul unei închideri de UN nivel (fără callee-ul de la adâncimea 2), cu acel callee schimbat
  lantAdanc: { dupa: ETICHETA_SCHIMBATA, rows: (b) => b.filter(r => r.eticheta !== 'functie fn_tichete_istoric_eticheta(text)') },
  calleeSchimbat: { dupa: ACTIUNE_SCHIMBATA },
  executeLant: { inainte: ACTIUNE_EXECUTE },
  definerFaraPath: { inainte: ACTIUNE_FARA_PATH },
  intreVerificari: { mig: INTRE_VERIFICARI(ACTIUNE_SCHIMBATA) },
  apelStrain: { mig: MIG_APEL_STRAIN },
  // r3: un trigger în plus pe tichete, apărut între „înainte” și blocare, cu o funcție DEJA din baseline (singura diferență = liniile
  // triggerelor lui tichete, eticheta exceptată din comparația „după”)
  triggerInPlus: { mig: INTRE_VERIFICARI('CREATE TRIGGER trg_dublura_test AFTER UPDATE ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_tichete_istoric_upd();') },
}
async function ruleazaScen(s, migMutanti = []) {
  const db = await bazaNoua()
  try {
    if (s.inainte) await db.exec(s.inainte)
    const rows = (s.rows || ((b) => b))(await baseline(db))
    if (s.dupa) await db.exec(s.dupa)
    const text = aplica(cuBaseline(MIG, rows), [...(s.mig || []), ...migMutanti])
    try { await aplicaMig(db, text); return null } catch (e) { return e.message }
  } finally { await db.close() }
}
for (const [nume, sc, re] of [
  ['trigger-ul tabelului scris de lanț (istoric) lipsă din baseline + schimbat', SCEN.lantPrinTabel,
    /difera de baseline-ul L15 revizuit: functie fn_tichete_istoric_marcheaza\(\) = [0-9a-f]{32} \(baseline NU ARE\)/],
  ['callee de la adâncimea 2 lipsă din baseline + schimbat', SCEN.lantAdanc, /functie fn_tichete_istoric_eticheta\(text\) = [0-9a-f]{32} \(baseline NU ARE\)/],
  ['callee adânc schimbat (în baseline)', SCEN.calleeSchimbat, /difera de baseline-ul L15 revizuit: functie fn_tichete_istoric_actiune/],
  ['EXECUTE dinamic pe lanț (baseline recalculat = identic): REFUZ', SCEN.executeLant, /EXECUTE dinamic \/ limbaj neanalizabil .*fn_tichete_istoric_actiune\(text,text\) \(plpgsql\)/],
  ['DEFINER fără search_path pe lanț: REFUZ', SCEN.definerFaraPath, /SECURITY DEFINER din lantul scrierilor nu are search_path/],
  ['funcție din lanț schimbată după „înainte”, înainte de blocare', SCEN.intreVerificari, /starea tabelelor \/ triggerelor \(dupa\) difera/],
  ['o funcție nouă cheamă ceva din afara ei', SCEN.apelStrain, /functiile noi cheama in afara lor: auth\.uid\(\)/],
  ['un trigger în plus pe tichete între „înainte” și blocare (funcție din baseline)', SCEN.triggerInPlus, /L15 dupa: triggerele lui tichete nu sunt cele de dinainte \+ trigger-ul ancorei \(noi: .*trg_dublura_test/],
]) {
  const m = await ruleazaScen(sc)
  ok(re.test(m || ''), `${nume}: ${(m || 'NU a refuzat').slice(0, 200)}`)
}
{
  const m = await ruleazaScen({})
  ok(m == null, `EXECUTE în trigger-ul de INSERT pe tichete (în afara lanțului, doar amprentat) nu blochează: ${m || 'aplicată'}`)
}
console.log('   mutanții porții L15 (originalul refuză, mutantul trece = verificarea e necesară)')
for (const [nume, sc, mut] of [
  ['L1 fără cascada prin tabelele scrise de lanț', SCEN.lantPrinTabel, [["    UNION\n    SELECT tg.tgfoid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql')\n      CROSS JOIN LATERAL regexp_matches(p.prosrc,\n", "    UNION\n    SELECT tg.tgfoid FROM pg_proc p JOIN pg_language lg ON lg.oid = p.prolang AND lg.lanname IN ('sql', 'plpgsql') AND false\n      CROSS JOIN LATERAL regexp_matches(p.prosrc,\n"]]],
  ['L2 închiderea doar pe un nivel', SCEN.lantAdanc, [['  SELECT x.oid FROM amp_lant l CROSS JOIN LATERAL (', '  SELECT x.oid FROM amp_pornire l CROSS JOIN LATERAL (']]],
  ['L3 EXECUTE doar semnalat', SCEN.executeLant, [['  IF v_exec IS NOT NULL THEN', '  IF false THEN']]],
  ['L4 fără verificarea „după”', SCEN.intreVerificari, [["  PERFORM pg_temp.amp_verifica_20261223a('dupa');\n", '']]],
  ['L5 fără postcondiția apelurilor', SCEN.apelStrain, [['  IF v_alt IS NOT NULL\n', '  IF false AND v_alt IS NOT NULL\n']]],
  ['L6 DEFINER fără search_path doar semnalat', SCEN.definerFaraPath, [["              WHERE c.in_lant AND c.detaliu LIKE '%definer=true%'", "              WHERE false AND c.detaliu LIKE '%definer=true%'"]]],
  ['L7 „după” fără verificarea liniilor triggerelor lui tichete', SCEN.triggerInPlus, [["      RAISE EXCEPTION '20261223a: L15 dupa: triggerele lui tichete nu sunt", "      RAISE NOTICE '20261223a: L15 dupa: triggerele lui tichete nu sunt"]]],
]) {
  const mOrig = await ruleazaScen(sc)
  const mMut = await ruleazaScen(sc, mut)
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
  const r = (await db.query(`SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_tichet\\_clarificare\\_%') AND to_regclass('public.tichete_clarificari') IS NULL AS gol`)).rows[0].gol
  ok(r, 'revenirea scoate tot (funcțiile și tabelul)')
  await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db.close()
}
// r3: ancorele SINGURE (tichete create după aplicare, nicio clarificare) nu blochează revenirea; după ea tichetele se creează și se modifică
// la fel ca înainte (trigger-ul a plecat), iar la re-aplicare tichetele de dinainte rămân fără ancoră
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await tichetePostMig(db)
  const nAnc = Number((await db.query('SELECT count(*) AS n FROM public.tichete_clarificari_ancore')).rows[0].n)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  const gol = (await db.query(`SELECT to_regclass('public.tichete_clarificari_ancore') IS NULL AND to_regclass('public.tichete_clarificari') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tichet_clarificare_ancora') AS g`)).rows[0].g
  const ins = await ca(db, 'authenticated', U.AUTOR, `INSERT INTO public.tichete (departament, subcategorie, titlu, status, deschis_de, metadata)
    VALUES ('it', 'eroare_erp', 'Dupa revenire', 'deschis', '${U.AUTOR}', ${META('bug_report')}) RETURNING id`, { pastreaza: true })
  const upd = ins.code ? ins : await patch(db, U.OWNER, Number(ins.rows[0].id), `status = 'rezolvat'`)
  ok(nAnc === 21 && m == null && gol && !ins.code && !upd.code, `revenirea cu ${nAnc} ancore (21 așteptate) și fără clarificări: ${m || 'trecută'}; tichetele merg după ea: ${ins.code || upd.code || 'da'}`)
  await aplicaMig(db, MIG_B)
  ok(Number((await db.query('SELECT count(*) AS n FROM public.tichete_clarificari_ancore')).rows[0].n) === 0, 're-aplicarea nu ancorează tichetele existente')
  await db.close()
}
for (const [nume, pregatire, re] of [
  ['o funcție schimbată', (db) => db.exec(`CREATE OR REPLACE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$;`),
    /starea nu e cea din 20261223a \(pasul 1, fn_tichet_clarificare_apelant_ok/],
  ['un drept acordat în plus pe o funcție', (db) => db.exec(`GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_context(bigint) TO authenticated;`),
    /starea nu e cea din 20261223a \(pasul 1, fn_tichet_clarificare_context/],
  ['volatilitatea schimbată', (db) => db.exec(`ALTER FUNCTION public.fn_tichet_clarificare_stare() VOLATILE;`), /starea nu e cea din 20261223a \(pasul 1, fn_tichet_clarificare_stare:/],
  ['un trigger adăugat pe tabelul de evidență', (db) => db.exec(`CREATE FUNCTION public.fn_t_test() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;
    CREATE TRIGGER trg_t_test BEFORE INSERT ON public.tichete_clarificari FOR EACH ROW EXECUTE FUNCTION public.fn_t_test();`), /tabelul tichete_clarificari/],
  // un comentariu automat rămas fără evidență blochează și el revenirea
  ['un comentariu automat fără evidență', (db) => db.query(`INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${P.T9}, NULL, ${q('Clarificare 1/2\nx')})`),
    /exista comentarii automate de clarificare/],
  // r3: trigger-ul ancorei schimbat (alt WHEN) / un trigger pus pe tabelul ancorelor => refuz
  ['trigger-ul ancorei schimbat', (db) => db.exec(`DROP TRIGGER trg_tichet_clarificare_ancora ON public.tichete;
    CREATE TRIGGER trg_tichet_clarificare_ancora AFTER INSERT OR UPDATE ON public.tichete FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();`),
    /trigger-ul trg_tichet_clarificare_ancora/],
  ['un al doilea trigger pe funcția ancorei', (db) => db.exec(`CREATE TRIGGER trg_dublura_test AFTER DELETE ON public.tichete FOR EACH ROW EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();`),
    /alte obiecte depind de functia fn_tichet_clarificare_ancora|trigger-ul trg_tichet_clarificare_ancora/],
  ['un trigger adăugat pe tabelul ancorelor', (db) => db.exec(`CREATE FUNCTION public.fn_t_test() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;
    CREATE TRIGGER trg_t_test BEFORE INSERT ON public.tichete_clarificari_ancore FOR EACH ROW EXECUTE FUNCTION public.fn_t_test();`), /tabelul tichete_clarificari_ancore/],
]) {
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await pregatire(db)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  const intact = (await db.query(`SELECT to_regclass('public.tichete_clarificari') IS NOT NULL AS t`)).rows[0].t
  ok(re.test(m || '') && intact, `revenirea refuză ${nume}: ${m}`)
  await db.close()
}

// ── 4. mutanții migrării: fiecare TREBUIE să pice (la aplicare sau la verificări) ──
console.log('4. mutanții migrării')
const CTX_TRIMITE = "  IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'context_schimbat', 'tichet_id', p_tichet_id);\n  END IF;\n  v_motiv :="
const CTX_INCHEIE = "  IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'context_schimbat', 'tichet_id', p_tichet_id);\n  END IF;\n  -- instantaneul din FOTOGRAFIA"
const RASP = "WHERE c.tichet_id = t.id AND c.autor = v_autor AND NOT (c.id = ANY (ru.instantaneu_autor));"
const INST_FOTO = "  v_inst := ARRAY(SELECT j.v::bigint FROM jsonb_array_elements_text(s -> 'instantaneu_autor') WITH ORDINALITY AS j(v, n) ORDER BY j.n);\n"
const INST_SEPARAT = "  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_inst FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de;\n"
const MUTANTI = [
  ['M1 fără deduplicare', [["  IF p_runda <= (s ->> 'runda')::integer THEN", '  IF false THEN']]],
  ['M2 limita de runde 3', [['IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN', 'IF p_runda IS NULL OR p_runda NOT IN (1, 2, 3) THEN']]],
  ['M3 runda 2 fără răspuns (tăcerea consumă runda 2)', [["  IF p_runda = 2 AND (s ->> 'raspuns_autor')::boolean IS NOT TRUE THEN", '  IF false THEN']]],
  ['M4 răspunsul oricui contează', [[RASP, 'WHERE c.tichet_id = t.id AND c.autor IS NOT NULL AND NOT (c.id = ANY (ru.instantaneu_autor));']]],
  ['M5 răspunsul după DATA comentariului (fără instantaneu)', [[RASP, 'WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND c.created_at > ru.creat_la;']]],
  ['M5b răspunsul după ORDINEA id-urilor', [[RASP, 'WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND c.id > ru.comentariu_id;']]],
  ['M5c instantaneu gol la trimitere', [["VALUES (t.id, 'runda', p_runda, v_com, v_not, cardinality(p_intrebari), v_autor, v_inst, p_versiune_context);", "VALUES (t.id, 'runda', p_runda, v_com, v_not, cardinality(p_intrebari), v_autor, '{}', p_versiune_context);"]]],
  ['M6 fără verificarea URL (schemă / www)', [["                  WHERE q.t ~* '(https?|ftps?|file)[[:space:]]*:|www[[:space:]]*\\.'\n                     OR", "                  WHERE false\n                     OR"]]],
  ['M6b fără terminațiile de domeniu', [["                     OR q.t ~* '[[:alnum:]_-]\\.(ro|com|", "                     OR false AND q.t ~* '[[:alnum:]_-]\\.(ro|com|"]]],
  ['M6c fără regula „litere.litere/”', [["                     OR q.t ~ '[[:alpha:]]\\.[[:alpha:]]+/') THEN 'url'", "                     OR false) THEN 'url'"]]],
  ['M7 cifrele ca în r1 (fără paranteze / plus / bară)', [["WHERE regexp_replace(q.t, '[' || chr(65296) || '-' || chr(65305) || ']', '0', 'g') ~ '[0-9]([^[:alnum:],;:]{0,2}[0-9]){8,}') THEN 'sir_cifre'", "WHERE regexp_replace(q.t, '[[:space:].-]', '', 'g') ~ '[0-9]{9,}') THEN 'sir_cifre'"]]],
  ['M7b fără echivalarea cifrelor late', [["regexp_replace(q.t, '[' || chr(65296) || '-' || chr(65305) || ']', '0', 'g') ~ '[0-9]([^", "q.t ~ '[0-9]([^"]]],
  ['M7c fără „@”', [["                  WHERE strpos(q.t, '@') > 0 OR strpos(q.t, chr(65312)) > 0 OR strpos(q.t, chr(65131)) > 0) THEN 'adresa_email'", "                  WHERE false) THEN 'adresa_email'"]]],
  ['M8 fără limita de lungime', [["    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE char_length(q.t) > 300) THEN 'intrebare_prea_lunga'\n", '']]],
  ['M9 4 întrebări permise', [['cardinality(p_intrebari) NOT BETWEEN 1 AND 3', 'cardinality(p_intrebari) NOT BETWEEN 1 AND 4']]],
  ['M10 fără verificarea comentariilor automate nelistate', [["  ELSIF EXISTS (SELECT 1 FROM public.tichete_comentarii c\n                 WHERE c.tichet_id = t.id AND c.autor IS NULL\n", "  ELSIF false AND EXISTS (SELECT 1 FROM public.tichete_comentarii c\n                 WHERE c.tichet_id = t.id AND c.autor IS NULL\n"]]],
  ['M10b fără verificarea comentariului automat șters', [["    v_inc := 'comentariu_automat_lipsa';", '    NULL;']]],
  ['M10c fără plasa „autorul ancorat = autorul tichetului”', [['  IF NOT FOUND OR an.iesit_la IS NOT NULL OR an.autor IS DISTINCT FROM t.deschis_de THEN', '  IF NOT FOUND OR an.iesit_la IS NOT NULL THEN']]],
  ['M11 încheiere nededuplicată', [["  IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN\n    SELECT x.* INTO e FROM public.tichete_clarificari x WHERE x.tichet_id = t.id AND x.fel IN ('incheiere', 'clarificat');", "  IF false THEN\n    SELECT x.* INTO e FROM public.tichete_clarificari x WHERE x.tichet_id = t.id AND x.fel IN ('incheiere', 'clarificat');"]]],
  ['M12 pragul de tăcere 0', [['c_prag_tacere constant integer := 3;', 'c_prag_tacere constant integer := 0;']]],
  ['M12b tăcerea de la data comentariului automat', [['    v_zile := public.fn_tichet_clarificare_zile_lucratoare(ru.creat_la, now());', '    v_zile := public.fn_tichet_clarificare_zile_lucratoare((SELECT c.created_at FROM public.tichete_comentarii c WHERE c.id = ru.comentariu_id), now());']]],
  ['M13 status final eligibil', [["    WHEN (p_status IN ('deschis', 'atribuit', 'in_analiza', 'in_lucru')) IS NOT TRUE THEN 'status'\n", '']]],
  ['M14 zilele în UTC', [["generate_series(((p_de AT TIME ZONE 'Europe/Bucharest')::date + 1)::timestamp, ((p_la AT TIME ZONE 'Europe/Bucharest')::date)::timestamp,", "generate_series(((p_de AT TIME ZONE 'UTC')::date + 1)::timestamp, ((p_la AT TIME ZONE 'UTC')::date)::timestamp,"]]],
  ['M15 notificarea cu întrebările', [["'Echipa ERP are nevoie de câteva detalii ca să poată continua. Răspunde direct pe tichet.'", "'Echipa ERP are nevoie de câteva detalii: ' || array_to_string(p_intrebari, ' ')"]]],
  ['M16 EXECUTE pentru anon', [['-- ── postcondiții ──', 'GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[], text) TO anon;\n-- ── postcondiții ──']]],
  ['M17 comentariul cu autor (contul owner-ului)', [["INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt) RETURNING id INTO v_com;\n  -- notificarea", "INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, (SELECT p.id FROM public.profiles p WHERE p.is_owner LIMIT 1), v_txt) RETURNING id INTO v_com;\n  -- notificarea"]]],
  ['M18 fără verificarea eligibilității la încheiere', [["  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);\n  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);\n  END IF;\n  IF s ->> 'actiune' = 'incoerent' THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);\n  END IF;\n  -- deduplicarea, înaintea", "  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);\n  -- deduplicarea, înaintea"]]],
  ['M19 fără versiunea contextului la trimitere', [[CTX_TRIMITE, '  v_motiv :=']]],
  ['M19b fără versiunea contextului la încheiere', [[CTX_INCHEIE, '  -- instantaneul din FOTOGRAFIA']]],
  ['M19c contextul comparat ÎNAINTEA deduplicării', [[CTX_TRIMITE, '  v_motiv :='], ["  -- deduplicarea: runda cerută e deja trimisă", "  IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'context_schimbat', 'tichet_id', p_tichet_id);\n  END IF;\n  -- deduplicarea: runda cerută e deja trimisă"]]],
  ['M19d contextul fără comentarii', [["           'comentarii', coalesce((SELECT jsonb_agg(jsonb_build_array(c.id, c.autor, c.text) ORDER BY c.id)\n                                     FROM public.tichete_comentarii c WHERE c.tichet_id = x.id), '[]'::jsonb))::text)", "           'comentarii', '[]'::jsonb)::text)"]]],
  ['M20 drept de scriere în tabelul protejat (postcondiția scoasă)', [["      IF has_table_privilege(v_rol, 'public.tichete_clarificari'::regclass, v_drept) IS DISTINCT FROM", "      IF false AND has_table_privilege(v_rol, 'public.tichete_clarificari'::regclass, v_drept) IS DISTINCT FROM"],
    ['-- ── postcondiții ──', 'GRANT INSERT, UPDATE, DELETE ON public.tichete_clarificari TO authenticated;\nCREATE POLICY tc_scriere ON public.tichete_clarificari FOR ALL TO authenticated USING (true) WITH CHECK (true);\n-- ── postcondiții ──'],
    ["     OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = 'public.tichete_clarificari'::regclass) <> 1\n", '']]],
  ['M21 fără RLS pe tabelul protejat (postcondiția scoasă) + SELECT pentru anon', [['ALTER TABLE public.tichete_clarificari ENABLE ROW LEVEL SECURITY;\n', 'GRANT SELECT ON public.tichete_clarificari TO anon;\n'],
    ["  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.tichete_clarificari'::regclass AND c.relkind = 'r'\n                   AND pg_get_userbyid(c.relowner) = 'postgres' AND c.relrowsecurity AND NOT c.relforcerowsecurity)",
     "  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.tichete_clarificari'::regclass AND c.relkind = 'r'\n                   AND pg_get_userbyid(c.relowner) = 'postgres')"],
    ["IS DISTINCT FROM (v_rol = 'authenticated' AND v_drept = 'SELECT') THEN", "IS DISTINCT FROM (v_rol IN ('authenticated', 'anon') AND v_drept = 'SELECT') THEN"]]],
  // r3, P2: fotografia unică
  ['M22 instantaneul rundei citit SEPARAT (r2: altă fotografie decât verificarea)', [[INST_FOTO + '  -- textul: DOAR', INST_SEPARAT + '  -- textul: DOAR']]],
  ['M22b instantaneul încheierii citit SEPARAT', [[INST_FOTO + "  IF p_motiv = 'clarificat' THEN", INST_SEPARAT + "  IF p_motiv = 'clarificat' THEN"]]],
  // r3, P1: ancora (trigger-ul) și starea
  ['M23 ancora fără verificarea creatorului (auth.uid() = deschis_de)', [['    IF v_uid IS NOT NULL AND NEW.deschis_de IS NOT DISTINCT FROM v_uid\n', '    IF true\n']]],
  ['M24 ancora fără eligibilitatea la creare', [['       AND public.fn_tichet_clarificare_eligibil_motiv(NEW.departament, NEW.subcategorie, NEW.metadata, NEW.status) IS NULL THEN\n      INSERT', '       AND true THEN\n      INSERT']]],
  ['M25 fără ieșire la autorul schimbat', [['AND (a.autor IS DISTINCT FROM NEW.deschis_de OR v_motiv IS NOT NULL);', 'AND (v_motiv IS NOT NULL);']]],
  ['M26 fără ieșire la status / sursă / subcategorie', [['  v_motiv := public.fn_tichet_clarificare_eligibil_motiv(NEW.departament, NEW.subcategorie, NEW.metadata, NEW.status);\n  UPDATE', '  v_motiv := NULL;\n  UPDATE']]],
  ['M27 fără ieșire la id refolosit', [["    UPDATE public.tichete_clarificari_ancore a SET iesit_la = now(), iesit_motiv = 'id_refolosit'\n     WHERE a.tichet_id = NEW.id AND a.iesit_la IS NULL;\n", '']]],
  ['M28 fără ieșire la id mutat', [['     WHERE a.tichet_id IN (OLD.id, NEW.id) AND a.iesit_la IS NULL;', '     WHERE false;']]],
  ['M29 starea fără ancoră', [['  IF NOT FOUND OR an.iesit_la IS NOT NULL OR an.autor IS DISTINCT FROM t.deschis_de THEN\n    v_inc := CASE', '  IF false THEN\n    v_inc := CASE']]],
  ['M30 contextul fără autor', [["'autor', x.deschis_de, ", '']]],
  ['M31 contextul fără status', [[" END, 'status', x.status,", ' END,']]],
  ['M32 starea ignoră ieșirea din protocol', [['  IF NOT FOUND OR an.iesit_la IS NOT NULL OR an.autor IS DISTINCT FROM t.deschis_de THEN', '  IF NOT FOUND OR an.autor IS DISTINCT FROM t.deschis_de THEN']]],
  ['M33 deja_trimis raportat ca trimis', [["'rezultat', 'deja_trimis', 'tichet_id', p_tichet_id, 'runda', p_runda, 'intrebari_trimise', false,", "'rezultat', 'deja_trimis', 'tichet_id', p_tichet_id, 'runda', p_runda, 'intrebari_trimise', true,"]]],
  ['M34 deja_incheiat fără motivul cerut', [["'acelasi_motiv', v_salvat IS NOT DISTINCT FROM p_motiv,", "'acelasi_motiv', true,"]]],
]
for (const [nume, inl] of MUTANTI) {
  const text = aplica(MIG_B, inl)   // în afara try: un mutant care nu-și găsește textul = eroare a probei, nu „pică”
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, text)
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${(picat || 'NU a picat').slice(0, 170)})`)
  await db.close()
}
console.log('   mutanții revenirii')
for (const [nume, inl, pregatire, re] of [
  ['R1 fără verificarea „nefolosit” (tabelul cu rânduri)', [["  IF EXISTS (SELECT 1 FROM public.tichete_clarificari) THEN\n    RAISE EXCEPTION '20261223a revenire: exista clarificari trimise", "  IF false THEN\n    RAISE EXCEPTION '20261223a revenire: exista clarificari trimise"]],
    async (db) => { await tichetePostMig(db); await incheie(db, T.T8, 'clarificat') }, /exista clarificari trimise/],
  ['R4 fără verificarea trigger-ului ancorei', [["    IF (SELECT count(*) FROM pg_trigger tg WHERE tg.tgfoid = to_regprocedure('public.fn_tichet_clarificare_ancora()')) <> 1\n       OR NOT EXISTS", "    IF false AND NOT EXISTS"]],
    async (db) => { await db.exec(`DROP TRIGGER trg_tichet_clarificare_ancora ON public.tichete;
      CREATE TRIGGER trg_tichet_clarificare_ancora AFTER INSERT OR UPDATE ON public.tichete FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.fn_tichet_clarificare_ancora();`) },
    /trigger-ul trg_tichet_clarificare_ancora/],
  ['R2 fără detaliul funcțiilor', [['      IF v_det IS DISTINCT FROM r.det\n', '      IF false\n']],
    async (db) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$;`) }, /starea nu e cea din 20261223a/],
  ['R3 fără verificarea triggerelor tabelului', [["       OR EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.tichete_clarificari') AND NOT tg.tgisinternal) THEN", '       OR false THEN']],
    async (db) => { await db.exec(`CREATE FUNCTION public.fn_t_test() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;
      CREATE TRIGGER trg_t_test BEFORE INSERT ON public.tichete_clarificari FOR EACH ROW EXECUTE FUNCTION public.fn_t_test();`) }, /tabelul tichete_clarificari/],
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
