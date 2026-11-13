// Proba LOCALĂ a migrării 20261223a (clarificări automate pe tichetele din butonul de raportare, maximum 2 runde) pe PGlite (Postgres în
// WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261223a_tichete_clarificari_schelet.sql + funcția REALĂ fn_tichete_notif_on_status_change extrasă
//   exact din 20261103d (trigger-ul trg_tichete_notif_status). Celelalte triggere sunt înlocuitori (vezi scheletul); efectul triggerelor
//   reale de pe producție îl măsoară proba de pe clonă (scripts/tichete_clarificari_concurenta.mjs, scenariul T).
// 1. BASELINE-ul L15 calculat pe schema falsă cu scriptul coordonatorului (secțiunea 1, tranzacție READ ONLY) și pus în blocul marcat, ca
//    după review; migrarea aplicată ca runnerul (--plafon-tranzactie-ms 2000).
// 2. VERIFICĂRI (valorile așteptate scrise de mână din cerere, L25): runda 1 (comentariu fără autor cu textul exact, notificarea exactă,
//    metadatele: restul neatins), același apel repetat = fără dublură, runda 2 fără răspunsul autorului = refuz, răspunsul altui cont nu
//    contează, runda 3 = refuz, încheierea (neclar / tăcere / clarificat) deduplicată, răspuns târziu semnalat fără runda 3, alt
//    departament / altă subcategorie / altă sursă / status final = refuz, textul (URL / lungime / 4 întrebări / cifre / control /
//    e-mail) = refuz cu motiv, apel ca authenticated / anon / service_role = refuz, zile lucrătoare peste weekend / miezul nopții / ora de
//    iarnă, lista rutinei (ordine stabilă, acțiuni), evidența ștearsă / falsificată = „incoerent”, trigger-ul real de status nu
//    notifică la schimbarea metadatelor (și notifică la o schimbare reală de status).
// 3. REFUZURILE migrării (fără marcaj / plafon, baseline necompletat, dependență schimbată, trigger nou apărut între citire și aplicare,
//    EXECUTE pe lanț, reaplicare) și L15 (închiderea, cu mutanții ei); revenirea (cu date, fără plafon, funcție schimbată, aplicare ->
//    revenire -> re-aplicare).
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
// id-urile (identity de la 1, în ordinea inserării); T9 și T10 au aceeași dată de creare (ordinea = id)
const T = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, T6: 6, T7: 7, T8: 8, T9: 9, T10: 10 }
const DATE = `
INSERT INTO auth.users (id) VALUES ('${U.OWNER}'), ('${U.AUTOR}'), ('${U.ALT}'), ('${U.AUTOR2}');
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'SINTETIC OWNER', true), ('${U.AUTOR}', 'SINTETIC AUTOR', false),
  ('${U.ALT}', 'SINTETIC ALT', false), ('${U.AUTOR2}', 'SINTETIC AUTOR DOI', false);
INSERT INTO public.tichete (departament, subcategorie, titlu, status, deschis_de, metadata, created_at) VALUES
  ('it', 'eroare_erp', 'Bug inventat 1', 'atribuit', '${U.AUTOR}', ${META('bug_report')}, '2026-11-01 10:00+02'),
  ('it', 'cerere_functie', 'Cerere inventata 2', 'deschis', '${U.AUTOR2}', ${META('feature_request')}, '2026-11-02 10:00+02'),
  ('logistica', 'eroare_erp', 'Alt departament 3', 'deschis', '${U.AUTOR}', ${META('bug_report')}, '2026-11-03 10:00+02'),
  ('it', 'acces_cont', 'Alta subcategorie 4', 'deschis', '${U.AUTOR}', ${META('bug_report')}, '2026-11-04 10:00+02'),
  ('it', 'eroare_erp', 'Status final 5', 'rezolvat', '${U.AUTOR}', ${META('bug_report')}, '2026-11-05 10:00+02'),
  ('it', 'eroare_erp', 'Fara sursa 6', 'deschis', '${U.AUTOR}', '{"modul": "magazie"}'::jsonb, '2026-11-06 10:00+02'),
  ('it', 'eroare_erp', 'Tacere 7', 'in_lucru', '${U.AUTOR}', ${META('bug_report')}, '2026-11-07 10:00+02'),
  ('it', 'cerere_functie', 'Clar de la inceput 8', 'deschis', '${U.AUTOR2}', ${META('feature_request')}, '2026-11-08 10:00+02'),
  ('it', 'eroare_erp', 'Evidenta stearsa 9', 'in_analiza', '${U.AUTOR}', ${META('bug_report')}, '2026-11-09 10:00+02'),
  ('it', 'eroare_erp', 'Evidenta falsificata 10', 'deschis', '${U.AUTOR}', ${META('bug_report')}, '2026-11-09 10:00+02');`

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
// REAL + istoric) și de INSERT pe notifications, callee-ul istoricului, auth.uid() (chemat de ambele), trigger-ul tabelului tichete_istoric
// (scris de istoric) ; AMPRENTAT = numerotarea și notificarea la INSERT (cu EXECUTE), funcția politicilor
const TAB = ['notifications', 'tichete', 'tichete_comentarii'].flatMap(t => ['acl', 'acl coloane', 'politici', 'rls', 'secvente', 'triggere'].map(k => `tabel ${t} | ${k}`))
const LANT = ['functie auth.uid()', 'functie fn_notifications_normalizeaza()', 'functie fn_tichete_istoric_actiune(text,text)', 'functie fn_tichete_istoric_eticheta(text)',
  'functie fn_tichete_istoric_marcheaza()', 'functie fn_tichete_istoric_upd()', 'functie fn_tichete_notif_on_status_change()']
const AMPRENTAT = ['functie fn_schelet_e_owner()', 'functie fn_tichete_notif_on_insert()', 'functie fn_tichete_numar()']
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
const sqlArr = (a) => a === null ? 'NULL::text[]' : `ARRAY[${a.map(x => x === null ? 'NULL' : `'${x.replace(/'/g, "''")}'`).join(', ')}]::text[]`
const trimite = async (db, t, runda, intr) => (await db.query(`SELECT public.fn_tichet_clarificare_trimite(${t}, ${runda}, ${sqlArr(intr)}) AS r`)).rows[0].r
const incheie = async (db, t, motiv) => (await db.query(`SELECT public.fn_tichet_clarificare_incheie(${t}, '${motiv}') AS r`)).rows[0].r
const stare = async (db, t) => (await db.query(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) AS s`)).rows[0].s
const lista = async (db) => (await db.query(`SELECT * FROM public.fn_tichet_clarificare_stare()`)).rows
const comentarii = async (db, t) => (await db.query(`SELECT id, autor, text, created_at FROM public.tichete_comentarii WHERE tichet_id = ${t} ORDER BY created_at, id`)).rows
const nrNotif = async (db) => Number((await db.query(`SELECT count(*) AS n FROM public.notifications`)).rows[0].n)
const notifNoi = async (db, dupa) => (await db.query(`SELECT profile_id, type, modul, title, message, link_to FROM public.notifications WHERE id > ${dupa} ORDER BY id`)).rows
const maxNotif = async (db) => Number((await db.query(`SELECT coalesce(max(id), 0) AS m FROM public.notifications`)).rows[0].m)
const meta = async (db, t) => (await db.query(`SELECT metadata FROM public.tichete WHERE id = ${t}`)).rows[0].metadata
const comenteaza = (db, t, uid, text) => db.query(`INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${t}, '${uid}', '${text}')`)

// textele așteptate, scrise de mână din cerere (NU din codul migrării)
const ANTET = 'Mesaj automat pentru clarificare. Nu reprezintă o aprobare de acces, modificare sau termen de realizare.'
const SUBSOL = 'Răspunde aici, pe tichet, fără parole sau date personale.\nEchipa ERP'
const textRunda = (n, intr) => [`Clarificare ${n}/2`, ANTET, '', ...intr.map((q, i) => `${i + 1}. ${q}`), '', SUBSOL].join('\n')
const TEXT_INCHEIERE = 'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. Acest mesaj nu confirmă implementarea sau un termen.\nEchipa ERP'
const NOTIF_RUNDA = (nr, id) => ({ profile_id: null, type: 'info', modul: 'Tichete', title: `❓ Întrebări de clarificare la tichetul ${nr}`,
  message: 'Echipa ERP are nevoie de câteva detalii ca să poată continua. Răspunde direct pe tichet.', link_to: `/tichete?id=${id}` })
const NOTIF_INCHEIERE = (nr, id) => ({ profile_id: null, type: 'info', modul: 'Tichete', title: `ℹ️ Clarificări încheiate la tichetul ${nr}`,
  message: 'Tichetul rămâne deschis și ajunge la conducere împreună cu discuția.', link_to: `/tichete?id=${id}` })
const nrT = (id) => 'TKT-' + String(id).padStart(4, '0')
const Q1 = ['În ce ecran apare problema?', 'Ce ai apăsat înainte să apară?']
const Q2 = ['Ce mesaj apare exact pe ecran?']
const fara = (o, k) => { const c = { ...o }; delete c[k]; return c }
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── verificările de comportament: întoarce lista abaterilor (gol = totul ca în cerere) ──
async function verifica(db) {
  const ab = []
  const astept = (r, rezultat, motiv, ce, detaliu) => {
    if (!r || r.rezultat !== rezultat || (motiv !== undefined && r.motiv !== motiv) || (detaliu !== undefined && r.detaliu !== detaliu)) {
      ab.push(`${ce}: ${JSON.stringify(r)} (aștepta ${rezultat}${motiv ? ' / ' + motiv : ''}${detaliu ? ' / ' + detaliu : ''})`)
    }
  }
  const pas = async (ce, fn) => { try { await fn() } catch (e) { ab.push(`${ce}: EXCEPȚIE ${e.code || ''} ${e.message}`) } }

  // V1–V5: runda 1 pe T1
  let com1 = null
  await pas('V1', async () => {
    const meta0 = await meta(db, T.T1), n0 = await maxNotif(db), nTot0 = await nrNotif(db)
    const ist0 = Number((await db.query(`SELECT count(*) AS n FROM public.tichete_istoric WHERE tichet_id = ${T.T1}`)).rows[0].n)
    const r = await trimite(db, T.T1, 1, Q1)
    astept(r, 'trimis', undefined, 'V1 runda 1')
    const c = await comentarii(db, T.T1)
    if (c.length !== 1 || c[0].autor !== null || c[0].text !== textRunda(1, Q1) || Number(c[0].id) !== Number(r?.comentariu_id)) ab.push('V2 comentariul rundei 1: ' + JSON.stringify(c))
    com1 = c[0] && Number(c[0].id)
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || await nrNotif(db) !== nTot0 + 1 || !egal({ ...nn[0], profile_id: null }, NOTIF_RUNDA(nrT(T.T1), T.T1)) || nn[0].profile_id !== U.AUTOR) {
      ab.push('V3 notificarea rundei 1 (exact una, către autor, fără întrebări): ' + JSON.stringify(nn))
    }
    const m = await meta(db, T.T1), ce = m.clarificari_erp || {}
    if (!egal(fara(m, 'clarificari_erp'), meta0) || ce.v !== 1 || ce.runda !== 1 || ce.faza !== 'asteapta_autor' || !egal(ce.comentarii, [com1])
        || Number(ce.runde?.['1']?.comentariu_id) !== com1 || Number(ce.runde?.['1']?.notificare_id) !== Number(r?.notificare_id) || !ce.runde?.['1']?.trimis_la) {
      ab.push('V4 metadatele (restul neatins + evidența): ' + JSON.stringify(m))
    }
    const ist1 = Number((await db.query(`SELECT count(*) AS n FROM public.tichete_istoric WHERE tichet_id = ${T.T1}`)).rows[0].n)
    if (ist1 !== ist0) ab.push(`V5 istoricul tichetului s-a schimbat la o scriere doar pe metadata (${ist0} -> ${ist1})`)
  })
  // V6–V7: același apel repetat (și cu alte întrebări) = deja_trimis, nimic în plus
  await pas('V6', async () => {
    const n0 = await nrNotif(db), m0 = await meta(db, T.T1)
    const r = await trimite(db, T.T1, 1, Q1)
    astept(r, 'deja_trimis', undefined, 'V6 runda 1 repetată')
    if (Number(r?.comentariu_id) !== com1) ab.push('V6 deja_trimis fără id-ul comentariului: ' + JSON.stringify(r))
    astept(await trimite(db, T.T1, 1, ['Altă întrebare?']), 'deja_trimis', undefined, 'V7 runda 1 cu alte întrebări')
    if ((await comentarii(db, T.T1)).length !== 1 || await nrNotif(db) !== n0 || !egal(await meta(db, T.T1), m0)) ab.push('V6 dublură: comentariu / notificare / evidență în plus')
  })
  // V8–V9: runda 2 fără răspunsul AUTORULUI (răspunsul altui cont nu contează)
  await pas('V8', async () => {
    astept(await trimite(db, T.T1, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V8 runda 2 fără răspuns')
    await comenteaza(db, T.T1, U.ALT, 'Si eu am vazut asta.')
    astept(await trimite(db, T.T1, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V9 runda 2 după comentariul altui cont')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'asteapta_autor' || s.raspuns_autor !== false || s.zile_lucratoare !== 0 || s.prag_tacere !== 3) ab.push('V9 starea după comentariul altui cont: ' + JSON.stringify(s))
  })
  // V10–V12: răspunsul autorului -> runda 2; repetare / runda 3 / runda 0; tăcerea neîndeplinită
  await pas('V10', async () => {
    await comenteaza(db, T.T1, U.AUTOR, 'Apare in ecranul de pontaj.')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'de_evaluat_raspuns' || s.raspuns_autor !== true) ab.push('V10 starea după răspunsul autorului: ' + JSON.stringify(s))
    const n0 = await maxNotif(db)
    const r = await trimite(db, T.T1, 2, Q2)
    astept(r, 'trimis', undefined, 'V10 runda 2')
    const c = await comentarii(db, T.T1), ult = c[c.length - 1]
    if (ult?.autor !== null || ult?.text !== textRunda(2, Q2)) ab.push('V10 comentariul rundei 2: ' + JSON.stringify(ult))
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || nn[0].profile_id !== U.AUTOR) ab.push('V10 notificarea rundei 2: ' + JSON.stringify(nn))
    astept(await trimite(db, T.T1, 2, Q2), 'deja_trimis', undefined, 'V11 runda 2 repetată')
    astept(await trimite(db, T.T1, 3, Q2), 'refuz', 'runda_invalida', 'V11 runda 3')
    astept(await trimite(db, T.T1, 0, Q2), 'refuz', 'runda_invalida', 'V11 runda 0')
    astept(await incheie(db, T.T1, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V12 tăcere înainte de prag')
    astept(await incheie(db, T.T1, 'neclar'), 'refuz', 'neclar_nepermis', 'V12 neclar fără răspuns la runda 2')
    const m = (await meta(db, T.T1)).clarificari_erp
    if (m.runda !== 2 || m.comentarii.length !== 2 || m.faza !== 'asteapta_autor') ab.push('V10 evidența după runda 2: ' + JSON.stringify(m))
  })
  // V13–V15: răspuns neclar la runda 2 -> încheiere; deduplicată; răspuns târziu semnalat, fără runda 3
  await pas('V13', async () => {
    await comenteaza(db, T.T1, U.AUTOR, 'Nu stiu exact.')
    const n0 = await maxNotif(db), meta0 = fara(await meta(db, T.T1), 'clarificari_erp')
    const r = await incheie(db, T.T1, 'neclar')
    astept(r, 'incheiat', undefined, 'V13 încheiere (neclar)')
    const c = await comentarii(db, T.T1), ult = c[c.length - 1]
    if (ult?.autor !== null || ult?.text !== TEXT_INCHEIERE) ab.push('V13 mesajul de încheiere: ' + JSON.stringify(ult))
    const nn = await notifNoi(db, n0)
    if (nn.length !== 1 || !egal({ ...nn[0], profile_id: null }, NOTIF_INCHEIERE(nrT(T.T1), T.T1)) || nn[0].profile_id !== U.AUTOR) ab.push('V13 notificarea încheierii: ' + JSON.stringify(nn))
    const m = await meta(db, T.T1)
    if (!egal(fara(m, 'clarificari_erp'), meta0) || m.clarificari_erp.faza !== 'incheiat' || m.clarificari_erp.comentarii.length !== 3
        || m.clarificari_erp.incheiere?.motiv !== 'neclar') ab.push('V13 evidența încheierii: ' + JSON.stringify(m))
    const st = (await db.query(`SELECT status FROM public.tichete WHERE id = ${T.T1}`)).rows[0].status
    if (st !== 'atribuit') ab.push('V13 statusul tichetului s-a schimbat: ' + st)
    const nc = c.length, nt = await nrNotif(db)
    const r2 = await incheie(db, T.T1, 'neclar')
    astept(r2, 'deja_incheiat', undefined, 'V14 încheiere repetată')
    if (r2?.motiv_incheiere !== 'neclar') ab.push('V14 deja_incheiat fără motivul primului: ' + JSON.stringify(r2))
    astept(await incheie(db, T.T1, 'tacere'), 'deja_incheiat', undefined, 'V14 încheiere cu alt motiv')
    if ((await comentarii(db, T.T1)).length !== nc || await nrNotif(db) !== nt) ab.push('V14 dublură la încheiere')
    await comenteaza(db, T.T1, U.AUTOR, 'Am mai gasit ceva.')
    const s = await stare(db, T.T1)
    if (s.actiune !== 'incheiat' || s.raspuns_dupa_incheiere !== true) ab.push('V15 răspunsul târziu nesemnalat: ' + JSON.stringify(s))
    astept(await trimite(db, T.T1, 2, Q2), 'deja_trimis', undefined, 'V15 runda 2 după încheiere')
    astept(await trimite(db, T.T1, 3, Q2), 'refuz', 'runda_invalida', 'V15 runda 3 după încheiere')
    if ((await comentarii(db, T.T1)).length !== nc + 1) ab.push('V15 mesaj automat nou după încheiere')
  })
  // V16: tăcere după runda 1 -> escaladare (nu consumă runda 2), pragul = 3 zile lucrătoare
  await pas('V16', async () => {
    astept(await trimite(db, T.T7, 1, ['Ce pași ai făcut?']), 'trimis', undefined, 'V16 runda 1 pe T7')
    let s = await stare(db, T.T7)
    if (s.actiune !== 'asteapta_autor' || s.zile_lucratoare !== 0) ab.push('V16 starea imediat după runda 1: ' + JSON.stringify(s))
    astept(await incheie(db, T.T7, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V16 tăcere sub prag')
    // mesajul automat mutat cu 2 zile lucrătoare în urmă (sub prag), apoi cu 10 zile (peste prag)
    await db.query(`UPDATE public.tichete_comentarii SET created_at = now() - interval '10 days' WHERE tichet_id = ${T.T7}`)
    s = await stare(db, T.T7)
    if (s.actiune !== 'de_escaladat_tacere' || !(s.zile_lucratoare >= 6)) ab.push('V16 starea după 10 zile: ' + JSON.stringify(s))
    astept(await trimite(db, T.T7, 2, Q2), 'refuz', 'fara_raspuns_autor', 'V16 tăcerea nu consumă runda 2')
    const n0 = await maxNotif(db)
    astept(await incheie(db, T.T7, 'tacere'), 'incheiat', undefined, 'V16 încheiere (tăcere)')
    const c = await comentarii(db, T.T7)
    if (c.length !== 2 || c[1].text !== TEXT_INCHEIERE) ab.push('V16 mesajul de încheiere: ' + JSON.stringify(c))
    if ((await notifNoi(db, n0)).length !== 1) ab.push('V16 notificarea încheierii')
    astept(await incheie(db, T.T7, 'tacere'), 'deja_incheiat', undefined, 'V16 încheiere repetată')
    if ((await comentarii(db, T.T7)).length !== 2) ab.push('V16 dublură la încheiere')
  })
  // V17: clar de la început -> marcaj fără mesaj; după el nicio rundă; „clarificat” cere răspunsul autorului după o rundă
  await pas('V17', async () => {
    const n0 = await nrNotif(db)
    const r = await incheie(db, T.T8, 'clarificat')
    astept(r, 'incheiat', undefined, 'V17 clarificat la runda 0')
    if ((await comentarii(db, T.T8)).length !== 0 || await nrNotif(db) !== n0) ab.push('V17 „clarificat” a scris mesaj / notificare')
    const m = (await meta(db, T.T8)).clarificari_erp
    if (m?.faza !== 'clarificat' || m?.runda !== 0 || m?.incheiere?.motiv !== 'clarificat') ab.push('V17 evidența: ' + JSON.stringify(m))
    astept(await trimite(db, T.T8, 1, Q1), 'refuz', 'clarificari_incheiate', 'V17 runda 1 după „clarificat”')
    astept(await incheie(db, T.T8, 'clarificat'), 'deja_incheiat', undefined, 'V17 clarificat repetat')
    let s = await stare(db, T.T8)
    if (s.actiune !== 'incheiat' || s.raspuns_dupa_incheiere !== false) ab.push('V17 starea: ' + JSON.stringify(s))
    await comenteaza(db, T.T8, U.AUTOR2, 'Inca un detaliu.')
    s = await stare(db, T.T8)
    if (s.raspuns_dupa_incheiere !== true) ab.push('V17 comentariul de după marcaj nesemnalat: ' + JSON.stringify(s))
  })
  // V18: eligibilitatea (alt departament / altă subcategorie / status final / fără sursă)
  await pas('V18', async () => {
    for (const [t, det] of [[T.T3, 'departament'], [T.T4, 'subcategorie'], [T.T5, 'status'], [T.T6, 'sursa']]) {
      astept(await trimite(db, t, 1, Q1), 'refuz', 'neeligibil', `V18 trimite pe T${t}`, det)
      astept(await incheie(db, t, 'clarificat'), 'refuz', 'neeligibil', `V18 incheie pe T${t}`, det)
      if ((await comentarii(db, t)).length !== 0 || (await meta(db, t)).clarificari_erp !== undefined) ab.push(`V18 s-a scris pe T${t}`)
    }
    astept(await trimite(db, 999, 1, Q1), 'refuz', 'tichet_inexistent', 'V18 tichet inexistent')
    astept(await incheie(db, T.T2, 'altceva'), 'refuz', 'motiv_invalid', 'V18 motiv invalid')
    astept(await incheie(db, T.T2, 'tacere'), 'refuz', 'tacere_neindeplinita', 'V18 tăcere la runda 0')
  })
  // V19: textul întrebărilor (T2, runda 0): refuz cu motiv, nimic scris; apoi limita exactă trece
  await pas('V19', async () => {
    const ZW = String.fromCharCode(8203)
    for (const [intr, motiv] of [
      [[], 'numar_intrebari'], [['a?', 'b?', 'c?', 'd?'], 'numar_intrebari'], [null, 'numar_intrebari'],
      [['Ok?', '   '], 'intrebare_goala'], [[null], 'intrebare_goala'],
      [['x'.repeat(301)], 'intrebare_prea_lunga'],
      [['linia 1\nlinia 2'], 'caractere_control'], [['cu\ttab?'], 'caractere_control'], [['zero' + ZW + 'width?'], 'caractere_control'],
      [['Vezi http://exemplu.ro?'], 'url'], [['Pe www.exemplu.ro?'], 'url'], [['HTTPS : ceva?'], 'url'],
      [['Numarul 0722123456?'], 'sir_cifre'], [['Telefon 0722 123 456?'], 'sir_cifre'], [['Cod 1.234.567.890?'], 'sir_cifre'],
      [['Scrie la ion@exemplu.ro?'], 'adresa_email'],
    ]) {
      astept(await trimite(db, T.T2, 1, intr), 'refuz', 'intrebari_invalide', `V19 ${JSON.stringify(intr)?.slice(0, 40)}`, motiv)
    }
    if ((await comentarii(db, T.T2)).length !== 0) ab.push('V19 s-a scris un comentariu la o întrebare refuzată')
    const lung = 'D'.repeat(299) + '?'
    const r = await trimite(db, T.T2, 1, [lung, 'Ce s-a întâmplat pe 13.11.2026?'])
    astept(r, 'trimis', undefined, 'V19 limita de 300 de caractere + o dată (8 cifre)')
    const c = await comentarii(db, T.T2)
    if (c.length !== 1 || !c[0].text.includes('\n1. ' + lung + '\n2. Ce s-a întâmplat pe 13.11.2026?\n')) ab.push('V19 textul acceptat: ' + JSON.stringify(c))
  })
  // V20: rolurile din API nu pot chema nimic (lipsa GRANT = 42501), nimic scris
  await pas('V20', async () => {
    const nc = Number((await db.query(`SELECT count(*) AS n FROM public.tichete_comentarii`)).rows[0].n)
    for (const [rol, uid] of [['authenticated', U.OWNER], ['authenticated', U.AUTOR2], ['anon', null], ['service_role', null]]) {
      for (const sql of [`SELECT public.fn_tichet_clarificare_trimite(${T.T9}, 1, ARRAY['Ce?'])`, `SELECT public.fn_tichet_clarificare_incheie(${T.T9}, 'clarificat')`,
        'SELECT * FROM public.fn_tichet_clarificare_stare()', `SELECT public.fn_tichet_clarificare_stare_tichet(${T.T9})`,
        "SELECT public.fn_tichet_clarificare_zile_lucratoare(now(), now())", "SELECT public.fn_tichet_clarificare_intrebari_motiv(ARRAY['x'])",
        'SELECT public.fn_tichet_clarificare_apelant_ok()']) {
        const r = await ca(db, rol, uid, sql, { pastreaza: true })
        if (r.code !== '42501') ab.push(`V20 ${rol}${uid ? ' (' + uid.slice(-2) + ')' : ''}: ${sql.slice(0, 60)} -> ${r.code || 'A TRECUT'} ${r.message || ''}`)
      }
    }
    // un om nu poate scrie un comentariu fără autor (politica INSERT: autor = auth.uid())
    const r = await ca(db, 'authenticated', U.AUTOR, `INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${T.T9}, NULL, 'Clarificare 1/2\nfals')`, { pastreaza: true })
    if (r.code !== '42501') ab.push('V20 un cont a scris un comentariu fără autor: ' + (r.code || 'A TRECUT'))
    if (Number((await db.query(`SELECT count(*) AS n FROM public.tichete_comentarii`)).rows[0].n) !== nc) ab.push('V20 s-a scris ceva')
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
  // V22–V23: evidența ștearsă de un om (PATCH pe metadata) / un id falsificat => „incoerent”, nimic retrimis
  await pas('V22', async () => {
    astept(await trimite(db, T.T9, 1, Q1), 'trimis', undefined, 'V22 runda 1 pe T9')
    const r = await ca(db, 'authenticated', U.AUTOR, `UPDATE public.tichete SET metadata = metadata - 'clarificari_erp' WHERE id = ${T.T9}`, { pastreaza: true })
    if (r.code) ab.push('V22 pregătirea (PATCH autor) a eșuat: ' + r.message)
    const s = await stare(db, T.T9)
    if (s.actiune !== 'incoerent' || s.detaliu !== 'comentariu_automat_neinregistrat') ab.push('V22 starea după ștergerea evidenței: ' + JSON.stringify(s))
    astept(await trimite(db, T.T9, 1, Q1), 'refuz', 'stare_incoerenta', 'V22 runda 1 după ștergerea evidenței')
    astept(await incheie(db, T.T9, 'clarificat'), 'refuz', 'stare_incoerenta', 'V22 încheiere după ștergerea evidenței')
    if ((await comentarii(db, T.T9)).length !== 1) ab.push('V22 runda 1 retrimisă')
    astept(await trimite(db, T.T10, 1, Q1), 'trimis', undefined, 'V23 runda 1 pe T10')
    await comenteaza(db, T.T10, U.AUTOR, 'Comentariul meu.')
    const idOm = Number((await comentarii(db, T.T10)).find(c => c.autor === U.AUTOR).id)
    await ca(db, 'authenticated', U.AUTOR, `UPDATE public.tichete SET metadata = jsonb_set(metadata, '{clarificari_erp,comentarii}', (metadata #> '{clarificari_erp,comentarii}') || '${idOm}'::jsonb) WHERE id = ${T.T10}`, { pastreaza: true })
    const s2 = await stare(db, T.T10)
    if (s2.actiune !== 'incoerent') ab.push('V23 id falsificat în evidență: ' + JSON.stringify(s2))
    astept(await trimite(db, T.T10, 2, Q2), 'refuz', 'stare_incoerenta', 'V23 runda 2 cu evidența falsificată')
  })
  // V24: trigger-ul REAL de status: nimic la schimbarea metadatelor (V3: exact o notificare), dar notifică la o schimbare reală de status;
  // tichetul trecut în status final iese din listă și nu mai primește nimic
  await pas('V24', async () => {
    const n0 = await maxNotif(db)
    const r = await ca(db, 'authenticated', U.OWNER, `UPDATE public.tichete SET status = 'rezolvat', descriere_interventie = 'Rezolvat in test' WHERE id = ${T.T2}`, { pastreaza: true })
    if (r.code) ab.push('V24 schimbarea de status: ' + r.message)
    const nn = await notifNoi(db, n0)
    if (!nn.some(n => n.profile_id === U.AUTOR2 && n.title === `🎫 Tichetul tău ${nrT(T.T2)} — rezolvat`)) ab.push('V24 trigger-ul real de status nu a notificat creatorul (proba e nefuncțională): ' + JSON.stringify(nn))
    astept(await trimite(db, T.T2, 2, Q2), 'refuz', 'neeligibil', 'V24 runda 2 pe tichet rezolvat', 'status')
  })
  // V25: lista rutinei: DOAR tichetele eligibile, ordine (created_at, id), acțiunile (scrise de mână din pașii de mai sus)
  await pas('V25', async () => {
    const l = await lista(db)
    const am = l.map(x => [Number(x.tichet_id), x.actiune, x.raspuns_dupa_incheiere])
    const astepta = [[T.T1, 'incheiat', true], [T.T7, 'incheiat', false], [T.T8, 'incheiat', true], [T.T9, 'incoerent', false], [T.T10, 'incoerent', false]]
    if (!egal(am, astepta)) ab.push('V25 lista rutinei: ' + JSON.stringify(am) + ' (aștepta ' + JSON.stringify(astepta) + ')')
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
  ok(/exista tichete cu clarificari/.test(m || ''), 'revenirea refuză după folosire: ' + m)
  await db.close()
}

// ── 1b. verificarea apelantului ÎN COD (nu doar prin GRANT): cu un GRANT greșit către authenticated (postcondiția scoasă), apelul din API
//        tot e refuzat; la fel prin altă funcție DEFINER expusă ──
console.log('1b. verificarea apelantului în cod')
const FARA_POST_DREPT = [["      IF has_function_privilege(v_rol, to_regprocedure(r.fn), 'EXECUTE') THEN", '      IF false THEN']]
const GRANT_GRESIT = [['-- ── postcondiții ──', 'GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[]), public.fn_tichet_clarificare_stare(), public.fn_tichet_clarificare_incheie(bigint, text) TO authenticated;\n-- ── postcondiții ──']]
async function probaCod(mutanti = []) {
  const db = await bazaNoua()
  try {
    await aplicaMig(db, aplica(MIG_B, [...FARA_POST_DREPT, ...GRANT_GRESIT, ...mutanti]))
    await db.exec(`CREATE FUNCTION public.fn_expus_test(p bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      SELECT public.fn_tichet_clarificare_trimite(p, 1, ARRAY['Ce?']) $f$; GRANT EXECUTE ON FUNCTION public.fn_expus_test(bigint) TO authenticated;`)
    const r1 = await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_tichet_clarificare_trimite(${T.T1}, 1, ARRAY['Ce?']) AS r`, { pastreaza: true })
    const r2 = await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_expus_test(${T.T1}) AS r`, { pastreaza: true })
    const r3 = await ca(db, 'authenticated', U.OWNER, 'SELECT * FROM public.fn_tichet_clarificare_stare()', { pastreaza: true })
    const r4 = await ca(db, 'service_role', null, `SELECT public.fn_tichet_clarificare_incheie(${T.T1}, 'clarificat') AS r`, { pastreaza: true })
    const scris = (await comentarii(db, T.T1)).length + ((await meta(db, T.T1)).clarificari_erp ? 1 : 0)
    return { r1: r1.rows?.[0]?.r?.motiv || r1.code, r2: r2.rows?.[0]?.r?.motiv || r2.code, r3: r3.code || 'lista', r4: r4.code || r4.rows?.[0]?.r?.motiv, scris }
  } finally { await db.close() }
}
{
  const p = await probaCod()
  ok(p.r1 === 'apelant_nepermis' && p.r2 === 'apelant_nepermis' && p.r3 === '42501' && p.scris === 0,
    `GRANT greșit: direct = ${p.r1}, prin DEFINER expus = ${p.r2}, lista = ${p.r3}, scris = ${p.scris}`)
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
]) {
  const db = await bazaNoua()
  let m = null
  try { await fn(db) } catch (e) { m = e.message }
  const ramas = (await db.query(`SELECT to_regprocedure('public.fn_tichet_clarificare_trimite(bigint,integer,text[])') IS NULL AS gol`)).rows[0].gol
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
  const r = (await db.query(`SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\\_tichet\\_clarificare\\_%') AS gol`)).rows[0].gol
  ok(r, 'revenirea scoate tot')
  await aplicaMig(db, MIG_B)
  const ab = await verifica(db)
  ok(ab.length === 0, `re-aplicarea după revenire + verificările (${ab.length} abateri)`)
  await db.close()
}
{
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/starea nu e cea din 20261223a/.test(m || ''), 'revenirea refuză o funcție schimbată: ' + m)
  await db.close()
}
{
  // un comentariu automat rămas fără evidență (evidența ștearsă) blochează și el revenirea
  const db = await bazaNoua()
  await aplicaMig(db, MIG_B)
  await trimite(db, T.T9, 1, Q1)
  await db.query(`UPDATE public.tichete SET metadata = metadata - 'clarificari_erp' WHERE id = ${T.T9}`)
  let m = null; try { await revino(db) } catch (e) { m = e.message }
  ok(/exista comentarii automate de clarificare/.test(m || ''), 'revenirea refuză cu un comentariu automat fără evidență: ' + m)
  await db.close()
}

// ── 4. mutanții migrării: fiecare TREBUIE să pice (la aplicare sau la verificări) ──
console.log('4. mutanții migrării')
const MUTANTI = [
  ['M1 fără deduplicare', [["  IF p_runda <= (s ->> 'runda')::integer THEN", '  IF false THEN']]],
  ['M2 limita de runde 3', [['IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN', 'IF p_runda IS NULL OR p_runda NOT IN (1, 2, 3) THEN']]],
  ['M3 runda 2 fără răspuns (tăcerea consumă runda 2)', [["  IF p_runda = 2 AND (s ->> 'raspuns_autor')::boolean IS NOT TRUE THEN", '  IF false THEN']]],
  ['M4 răspunsul oricui contează', [['WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND (c.created_at, c.id) > (v_ult_la, v_ult_id);', 'WHERE c.tichet_id = t.id AND c.autor IS NOT NULL AND (c.created_at, c.id) > (v_ult_la, v_ult_id);']]],
  ['M5 metadata suprascrisă', [["SET metadata = coalesce(x.metadata, '{}'::jsonb) || jsonb_build_object('clarificari_erp', m)", "SET metadata = jsonb_build_object('clarificari_erp', m)"]]],
  ['M6 fără verificarea URL', [["    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE q.t ~* '(https?|ftps?|file)[[:space:]]*:|www[[:space:]]*\\.') THEN 'url'\n", '']]],
  ['M7 fără verificarea cifrelor', [["    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE regexp_replace(q.t, '[[:space:].-]', '', 'g') ~ '[0-9]{9,}') THEN 'sir_cifre'\n", '']]],
  ['M8 fără limita de lungime', [["    WHEN EXISTS (SELECT 1 FROM unnest(p_intrebari) AS q(t) WHERE char_length(q.t) > 300) THEN 'intrebare_prea_lunga'\n", '']]],
  ['M9 4 întrebări permise', [['cardinality(p_intrebari) NOT BETWEEN 1 AND 3', 'cardinality(p_intrebari) NOT BETWEEN 1 AND 4']]],
  ['M10 fără verificarea comentariilor automate nelistate', [["    ELSIF EXISTS (SELECT 1 FROM public.tichete_comentarii c\n                   WHERE c.tichet_id = t.id AND c.autor IS NULL AND NOT (c.id = ANY (v_ids))", "    ELSIF false AND EXISTS (SELECT 1 FROM public.tichete_comentarii c\n                   WHERE c.tichet_id = t.id AND c.autor IS NULL AND NOT (c.id = ANY (v_ids))"]]],
  ['M11 încheiere nededuplicată', [["  IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN\n    RETURN jsonb_build_object('rezultat', 'deja_incheiat'", "  IF false THEN\n    RETURN jsonb_build_object('rezultat', 'deja_incheiat'"]]],
  ['M12 pragul de tăcere 0', [['c_prag_tacere constant integer := 3;', 'c_prag_tacere constant integer := 0;']]],
  ['M13 status final eligibil', [["    WHEN (t.status IN ('deschis', 'atribuit', 'in_analiza', 'in_lucru')) IS NOT TRUE THEN 'status'\n", '']]],
  ['M14 zilele în UTC', [["generate_series(((p_de AT TIME ZONE 'Europe/Bucharest')::date + 1)::timestamp, ((p_la AT TIME ZONE 'Europe/Bucharest')::date)::timestamp,", "generate_series(((p_de AT TIME ZONE 'UTC')::date + 1)::timestamp, ((p_la AT TIME ZONE 'UTC')::date)::timestamp,"]]],
  ['M15 notificarea cu întrebările', [["'Echipa ERP are nevoie de câteva detalii ca să poată continua. Răspunde direct pe tichet.'", "'Echipa ERP are nevoie de câteva detalii: ' || array_to_string(p_intrebari, ' ')"]]],
  ['M16 EXECUTE pentru anon', [['-- ── postcondiții ──', 'GRANT EXECUTE ON FUNCTION public.fn_tichet_clarificare_trimite(bigint, integer, text[]) TO anon;\n-- ── postcondiții ──']]],
  ['M17 comentariul cu autor (contul owner-ului)', [["INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt) RETURNING id INTO v_com;\n  -- notificarea", "INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, (SELECT p.id FROM public.profiles p WHERE p.is_owner LIMIT 1), v_txt) RETURNING id INTO v_com;\n  -- notificarea"]]],
  ['M18 fără verificarea eligibilității la încheiere', [["  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);\n  IF (s ->> 'eligibil')::boolean IS NOT TRUE THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'neeligibil', 'detaliu', s ->> 'motiv', 'tichet_id', p_tichet_id);\n  END IF;\n  IF s ->> 'actiune' = 'incoerent' THEN\n    RETURN jsonb_build_object('rezultat', 'refuz', 'motiv', 'stare_incoerenta', 'detaliu', s ->> 'detaliu', 'tichet_id', p_tichet_id);\n  END IF;\n  m := t.metadata", "  s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);\n  m := t.metadata"]]],
]
for (const [nume, inl] of MUTANTI) {
  const db = await bazaNoua()
  let picat = null
  try {
    await aplicaMig(db, aplica(MIG_B, inl))
    const ab = await verifica(db)
    if (ab.length) picat = 'verificări: ' + ab[0]
  } catch (e) { picat = 'aplicare: ' + e.message.slice(0, 140) }
  ok(picat != null, `${nume} pică (${(picat || 'NU a picat').slice(0, 170)})`)
  await db.close()
}
console.log('   mutanții revenirii')
for (const [nume, inl, pregatire, re] of [
  ['R1 fără verificarea „nefolosit”', [["  IF EXISTS (SELECT 1 FROM public.tichete x WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) THEN\n    RAISE EXCEPTION '20261223a revenire: exista tichete cu clarificari", "  IF false THEN\n    RAISE EXCEPTION '20261223a revenire: exista tichete cu clarificari"]],
    async (db) => { await db.query(`SELECT public.fn_tichet_clarificare_incheie(${T.T8}, 'clarificat')`) }, /exista tichete cu clarificari/],
  ['R2 fără amprenta corpului', [["                        AND md5(replace(p.prosrc, chr(13), '')) = r.amp\n", '']],
    async (db) => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_tichet_clarificare_apelant_ok() RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$ SELECT true $f$;`) }, /starea nu e cea din 20261223a/],
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
