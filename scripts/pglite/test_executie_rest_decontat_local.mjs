// Proba LOCALĂ a migrărilor 20270105a (Rest de decontat: schema, drept, calcul, confirmare) și 20270105b (poarta proiectului în configurare) pe
// PGlite — NU atinge nicio bază reală. Baza: schema falsă supabase/tests/20270105a_executie_rest_decontat_schelet.sql (roluri Supabase, auth.uid(),
// tabelele existente cu RLS-ul general al Execuției, STUB-urile porților Izometrie cu ștampilele verzi, un proiect „moștenit” cu articole).
// Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați: manifestul cu ROLLBACK, apoi livrarea aprobată + garda finală).
// 0. Validatorul runnerului (plafonul 5000 la migrări / 2000 la reveniri), detectorul porților Izometrie pe depozit, paritatea UM cu 20261208a,
//    paritatea textuală a funcțiilor 20261209a copiate în schelet, reverificarea dreptului DUPĂ lock în cele 3 RPC-uri (verificare STATICĂ pe text;
//    cursa reală cu două sesiuni: supabase/tests/20270105a_executie_rest_decontat_concurenta.sh, pe clonă).
// 1. Refuzurile migrării A (fără marcaj, fără pasul L15 „înainte”, plafon greșit, porți roșii, porți lipsă, 20261209a lipsă / alt corp, reaplicare,
//    coloană cu alt tip); nimic schimbat.
// 2. Livrarea A: manifestul generat = lista revizuită; rândurile moștenite neatinse (în afara cheii), cheia cu nr doar pe codul repetat în document;
//    ștampilele porților recalculate și verzi; blocul AMPRENTA identic în migrare și revenire, aceeași constantă.
// 3. Dry-run-ul A (supabase/tests/20270105a_…_dryrun.sql, toate blocurile, ROLLBACK la final): toate NOTICE-urile „ok”, nimic rămas. Dry-run-ul începe
//    cu garda în SESIUNE PROASPĂTĂ (marcajul RPC NULL), de aceea rulează pe o bază pe care niciun RPC n-a scris încă.
// 4. MUTANȚI ai migrării A: un mutant contează „prins” DOAR dacă s-a APLICAT cu succes (fără postcondiții) și dry-run-ul l-a picat; cu postcondițiile
//    întregi trebuie refuzat la aplicare. r2 (review #1158): marcajul NULL acceptat de gărzi (articole / situații), restricția pe proiect scoasă din
//    drept, un singur grup de coduri repetate, poziția lipsă neverificată, lista completă pe obiect_cod brut, nota neaprobată acceptată (RPC / calcul),
//    ordinea „ultimul act” după momentul încărcării (listă completă / preț) + cei 10 din r1. r3 (review #1158, clasa R1-6): rândul NR / NCS / AA
//    scris direct — garda fără refuzul pe sursă / doar la INSERT, predicatul unic fără NR / NCS / AA, CHECK-ul fără predicat, calculul care numără
//    rândul neconfirmat, lipsurile fără „rand_neautorizat”. r4 (review #1158, P1 r3: reimportul vechi dubla baza confirmată — stările ofertei):
//    garda primește oferta veche pe un proiect confirmat (INSERT / UPDATE / reparentare), doar la INSERT, lasă ștergerea, nu ia lock-ul proiectului;
//    RPC-ul cumulează (rândurile vechi nu se retrag) / acceptă a doua ofertă; calculul numără rândurile neconfirmate pe proiectul confirmat;
//    lipsurile nu declară; predicatul stării cere rândul confirmat ACTIV. r5 (review #1158, 2 × P1 r4: regula pe proiect retrăgea obiectele neimportate
//    și lăsa rândurile retrase vizibile consumatorilor vechi): RPC-ul retrage toate obiectele proiectului, nu doar cele importate; RPC-ul refuză (23505)
//    orice proiect cu un obiect confirmat (confirmarea târzie a unui obiect vechi); re-importul unui obiect confirmat fără „înlocuiește” acceptat;
//    rândurile înlocuite rămân în proiect_articole cu activ = false (cititorii vechi le văd: 568 în loc de 284); garda / calculul / lipsurile pe
//    proiect în loc de obiect; predicatul stării ignoră istoricul (obiectul scos de server se redeschide); lipsurile nu declară obiectele vechi.
//    r6 (review #1158, 2 × P1 + P2 r5): UM-ul validat față de baza RĂMASĂ (fără obiectele care se înlocuiesc, ca r5); cheia decontată acceptă alt UM;
//    schimbarea UM fără accept_schimbare_um acceptată; obiect_cod / UM scrise brut (nu în reprezentarea existentă); cantitatea / prețul neconvertite;
//    unitatea din proiect_unitati ignorată; cantitatea nereprezentabilă rotunjită tăcut; amprenta necăutată în istoric (A → B → A). r7 (review #1158,
//    2 × P1 pe r6): obiect_cod / deviz_cod / cod / nr / UM necopiate din rândul cu aceeași cheie (scrise cum vin, normalizate); ambiguitatea formelor
//    brute neverificată; cheia nouă scrisă brut (nenormalizată). r9 (review #1158, 2 × P1 pe r8: cheia referită): garda fără refuzul cheie_referita /
//    cu ocolire pentru server / învelișul fără DEFINER; RPC-ul fără păstrarea #n, fără refuzul codului decontat despărțit în poziții, fără cheia referită unică
//    la linia fără poziție, fără refuzul ambiguității; lipsurile fără decontat_fara_articol; rezultatul fără decontat_fara_baza. r10 (review #1158, P1 + P2 pe
//    r9: UM-ul la reatașarea unei chei fără bază, poziția liniei fără nr pe o cheie #n din istoric): RPC-ul validează UM-ul față de decontat doar la ofertă;
//    garda fără validarea UM / doar la INSERT / ocolită de server; funcția unică fără DEFINER / pe UM brut / cu situațiile inactive; poziția nereconstruită;
//    lipsurile fără decontat_um_diferit; calculul fără um_incert pe UM decontat diferit.
//    Mutanții STATICI (reverificarea dreptului scoasă după lock; garda fără advisory / cu advisory blocant) sunt prinși de verificările pe text din 0.
// 5. Migrarea B peste A: dry-run B; mutanți B (MP fără ofertă acceptat, owner fără motiv acceptat, fără garda pe coloane, marcaj NULL acceptat,
//    garda doar pe UPDATE — INSERT „configurat” acceptat); revenirea B. Postcondițiile B = secțiunea „4.” (r2: markerul greșit din r1 ascundea
//    mutanții B neaplicați).
// 6. Revenirile: refuzuri (fără marcaj, cu date, amprentă schimbată, B aplicată peste A), aplicare → revenire → reaplicare, starea de dinainte.
// 7. Trecerea (a) -> (b) pe un proiect ca proiectul 4 de pe producție: 284 rânduri contract_initial SINTETICE (4 obiecte × 3 devize) scrise pe calea
//    veche înaintea migrării (coduri repetate în același deviz → nr în cheie), baza = cele 284; calea veche încă merge; CITITORII VECHI ai tabelului
//    (ActivitatiProiectPanel / verificariProiect, CatalogDevizPanel, 20261208a cu predicatul luat din textul migrării, DevizVsExecutatTab, 20270105b,
//    fn_rest_decontat_are_oferta) înregistrați ÎNAINTE; import PARȚIAL (doar obiectul 0001, 71 linii) → 71 inserate / 71 mutate în istoric, obiectele
//    0002–0004 neatinse (baza cu valoarea veche, declarate 'oferta_neconfirmata'), cititorii vechi identici pe ele; confirmarea restului (213 linii, fără
//    „înlocuiește”) → 284 confirmate, 0 rânduri retrase în tabel, baza IDENTICĂ (284 chei, aceeași valoare, nu dublă), TOȚI cititorii vechi EXACT ca
//    înainte (284 → 284); re-importul lui 0001 fără „înlocuiește” = 23505, cu „înlocuiește” (aceleași linii) = cititorii identici; reimportul vechi refuzat
//    (DELETE / INSERT / UPDATE → 42501, mesajul „Rest de decontat”); mutantul comportamental „rândurile retrase rămân cu activ = false” (textul RPC-ului
//    r4) face cititorii să vadă 568; revenirea refuză (date confirmate). r6: codurile obiectelor au litere mici și spații ('Ob 1'), UM-urile au factori
//    ('100 MC', 'HM'), iar liniile RPC vin în ALTĂ reprezentare echivalentă (' ob 1 ', 'MC' × 100, 'T' / 1000, 'ML', 'buc'): rândurile scrise sunt
//    OCTET CU OCTET în reprezentarea existentă (md5 pe obiect / UM / cantitate / preț identic înainte / după), cititorul 20261208a verifică CANTITATEA
//    convertită; UM-ul la înlocuire (cheie decontată = refuz și cu accept; fără decontat = refuz fără accept, trece cu accept); fișierul înlocuit = 23505.
// 8. r7 (review #1158, 2 × P1 pe r6 — regula PE CHEIE, PE FIECARE CÂMP): TESTUL DE PROPRIETATE al clasei. Pe un set GENERAT de transformări echivalente
//    (litere mari / mici pe obiect / deviz / cod, spații la început / sfârșit și duble pe obiect / deviz / cod / nr, UM-uri echivalente M / ML / HM / KM /
//    „100 M”, MC / M3 / „100 MC”, BUC / „100 BUC”, KG / T / „100 KG”, obiecte cu una sau două forme brute, unități legate la una din forme sau la niciuna, 1 sau 2
//    obiecte) o funcție calculează ieșirile TUTUROR cititorilor existenți (ActivitatiProiectPanel / verificariProiect: logica de prefix din cod, în JS;
//    20261208a / v_executie_tinte: predicatul JOIN luat din textul migrării, pe proiect_unitati real; DevizVsExecutatTab: lista obiectelor; CatalogDevizPanel:
//    toate rândurile ordonate + grupele pe obiect; MaterialeProiectPanel; 20270105b; fn_rest_decontat_are_oferta) ÎNAINTE și DUPĂ confirmarea prin RPC a
//    liniilor transformate: orice diferență (sau un refuz) = test picat. Apoi MUTANȚII care scot copierea unui câmp (obiect_cod, deviz_cod, cod, nr, um,
//    cantitatea) trebuie să pice testul (diferență sau refuzul „legatura_unitate” acolo unde o unitate e legată).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_rest_decontat_local.mjs
//   (--scrie-obiecte rescrie listele revizuite L15 din manifestele generate; --amprente tipărește constantele AMPRENTA calculate)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ordineCatalog } from '../../src/lib/citireCompleta.js'   // ordinea catalogului în client (CatalogDevizPanel, r8) — aceeași funcție ca în ecran

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'restdec_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const A = '20270105a_executie_rest_decontat', B = '20270105b_executie_proiect_configurare'
const F = n => ({ mig: `supabase/migrations/${n}.sql`, rev: `supabase/revenire/${n}_ROLLBACK.sql`, dry: `supabase/tests/${n}_dryrun.sql`, ob: `supabase/tests/${n}.l15.obiecte.tsv` })
const SCHELET = citeste(`supabase/tests/${A}_schelet.sql`)
const MIG_A = citeste(F(A).mig), REV_A = existsSync(join(ROOT, F(A).rev)) ? citeste(F(A).rev) : '', DRY_A = citeste(F(A).dry)
const AREB = existsSync(join(ROOT, F(B).mig))
const MIG_B = AREB ? citeste(F(B).mig) : '', REV_B = AREB && existsSync(join(ROOT, F(B).rev)) ? citeste(F(B).rev) : '', DRY_B = AREB && existsSync(join(ROOT, F(B).dry)) ? citeste(F(B).dry) : ''
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const DOAR = process.argv.find(a => a.startsWith('--doar='))?.slice(7)

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

async function bazaNoua() { const db = new PGlite(); await db.exec(SCHELET); return db }
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = `SET transaction_timeout = ${plafon};`
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
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
// aplicarea ca la livrare (L15 v2): generatorul de manifest (ROLLBACK) comparat cu lista revizuită, apoi livrarea aprobată
async function aplicaLivrare(db, nume, text, fObiecte) {
  let jg = []
  try { jg = await caRunner(db, nume, text, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message); (e.jurnal || []).filter(m => /AMPRENTA_2027/.test(m)).forEach(m => console.log('     ' + m)) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, fObiecte),
    `# ${nume.slice(0, 9)}: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, fObiecte)) ? listaObiecte(citeste(fObiecte)) : []
  const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
  ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `${nume.slice(0, 9)}: manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  if (!G || !fara18.length) { ok(false, `${nume.slice(0, 9)}: livrarea nu se poate încerca (generarea manifestului a picat)`); return jg }
  const fManifest = join(TMP, `${nume}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, nume, text, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(nume, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${nume}: garda trecuta`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${nume}: `).test(m) && !/nedeclarat/.test(m)), `${nume.slice(0, 9)}: livrarea aprobată: diferența = manifestul; PLAFON_TIMP; LOCK_TINUT declarat`)
  return j
}
const aplicaA = (db, text = MIG_A, o) => caRunner(db, A, text, o)
const revinoA = (db, text = REV_A, o) => caRunner(db, A + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const aplicaB = (db, text = MIG_B, o) => caRunner(db, B, text, o)
const revinoB = (db, text = REV_B, o) => caRunner(db, B + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function mutant(text, lista) {
  let t = text
  for (const [din, in_] of lista) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const blocAmprenta = (t, n) => { const i = t.indexOf(`AMPRENTA_${n}_INCEPUT`), j = t.indexOf(`-- AMPRENTA_${n}_SFARSIT`); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constanteAmprenta = (t, n) => [...t.matchAll(new RegExp(`'([0-9a-f]{32})' THEN\\n    RAISE NOTICE 'AMPRENTA_${n}_TEXT`, 'g'))].map(x => x[1])
// starea catalogului pentru obiectele atinse (comparată înainte de migrare și după revenire)
const stare = async db => (await q1(db, `SELECT jsonb_build_object(
  'tab', (SELECT string_agg(c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity || ':' || coalesce(c.relacl::text, '-'), ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'S', 'i')),
  'col', (SELECT string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY c.relname, a.attnum)
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped),
  'con', (SELECT string_agg(k.conrelid::regclass::text || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conrelid::regclass::text, k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace AND k.contype <> 'n'),
  'trg', (SELECT string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' ORDER BY 1) FROM pg_trigger t WHERE NOT t.tgisinternal),
  'pol', (SELECT string_agg(p.polrelid::regclass::text || '.' || p.polname || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), ',' ORDER BY 1) FROM pg_policy p),
  'fn', (SELECT string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-'), ',' ORDER BY p.proname, p.oid) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
  'com', (SELECT string_agg(d.description, ',' ORDER BY d.description) FROM pg_description d JOIN pg_proc p ON p.oid = d.objoid AND d.classoid = 'pg_proc'::regclass WHERE p.proname LIKE 'fn_izo_porti%')) AS s`)).s
const randuriMostenite = async db => (await q1(db, `SELECT md5(string_agg(concat_ws('|', id, proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, sursa, act_nr, pret_unitar, created_at), chr(10) ORDER BY id)) AS h, count(*)::int AS n FROM public.proiect_articole WHERE proiect_id = 900`))
// dry-run-ul: o singură tranzacție (BEGIN … ROLLBACK în fișier); întoarce NOTICE-urile
async function dryrun(db, text) {
  const jurnal = []
  try { await db.exec(text, { onNotice: n => jurnal.push(n.message) }) }
  catch (e) { try { await db.exec('ROLLBACK') } catch { /* anulată */ } e.jurnal = jurnal; throw e }
  return jurnal
}
const BLOCURI_A = ['t_garda_proaspata ok', 't_fara_baza ok', 'oferta ok', 't_negative_peste_oferta ok', 't_um ok', 't_dublare_situatie ok', 't_aa_leaga_note ok',
  't_surse_autorizate (1/2) ok', 't_surse_autorizate (2/2) ok', 't_coduri_repetate ok', 't_ultimul_act ok', 't_drept_restrans (1/2) ok', 't_drept_restrans (2/2) ok',
  't_drept_sef_santier (1/3) ok', 't_drept_sef_santier (2/3) ok', 't_drept_sef_santier (3/3) ok',
  't_oferta_confirmata (1/7) ok', 't_oferta_confirmata (2/7) ok', 't_oferta_confirmata (3/7) ok', 't_oferta_confirmata (4/7) ok', 't_oferta_confirmata (5/7) ok',
  't_oferta_confirmata (6/7) ok', 't_oferta_confirmata (7/7) ok', 't_rand_orfan ok', 't_um_inlocuire (1/2) ok', 't_um_inlocuire (2/2) ok',
  't_reprezentare_cheie (1/3) ok', 't_reprezentare_cheie (2/3) ok', 't_reprezentare_cheie (3/3) ok', 't_import_vechi_repetat ok', 't_pozitie (1/2) ok', 't_pozitie (2/2) ok',
  't_cheie_referita (1/4) ok', 't_cheie_referita (2/4) ok', 't_cheie_referita (3/4) ok', 't_cheie_referita (4/4) ok',
  't_um_decontat (1/3) ok', 't_um_decontat (2/3) ok', 't_um_decontat (3/3) ok']
const BLOCURI_B = ['t_poarta_garda_proaspata ok', 't_poarta_mp ok', 't_poarta_owner ok', 't_poarta_cu_oferta ok', 't_poarta_direct ok']
async function verificaDry(db, text, blocuri) {
  try {
    const j = await dryrun(db, text)
    const lipsa = blocuri.filter(b => !j.some(m => m.startsWith(b)))
    return lipsa.length ? ['blocuri fără ok: ' + lipsa.join(', ')] : []
  } catch (e) { return ['dry-run picat: ' + e.message] }
}
// un mutant e „prins” DOAR dacă: (1) textul mutant s-a găsit o singură dată, (2) migrarea mutantă FĂRĂ postcondiții s-a APLICAT cu succes (altfel
// eroarea de aplicare nu dovedește nimic despre dry-run), (3) dry-run-ul a picat; apoi, cu postcondițiile întregi, aplicarea e refuzată (amprenta)
async function ruleazaMutant({ eticheta, nume, lista, textBaza, marcajPost, pregateste, aplica, dry, blocuri }) {
  let text
  try { text = mutant(textBaza, lista) } catch (e) { ok(false, `${eticheta} „${nume}”: ${e.message}`); return }
  const iPost = text.indexOf(marcajPost)
  if (iPost < 0) { ok(false, `${eticheta} „${nume}”: markerul postcondițiilor „${marcajPost}” nu există în migrare`); return }
  const db = await bazaNoua()
  await pregateste(db)
  const eAplic = await eroare(aplica(db, text.slice(0, iPost)))
  if (eAplic) { ok(false, `${eticheta} „${nume}”: mutantul NU s-a aplicat (nu se poate dovedi că dry-run-ul îl prinde): ${eAplic.slice(0, 160)}`); return }
  const ab = await verificaDry(db, dry, blocuri)
  ok(ab.length > 0, `${eticheta} „${nume}” aplicat și prins de dry-run (${ab.length}): ${(ab.join(' | ') || 'NIMIC').slice(0, 220)}`)
  const db2 = await bazaNoua()
  await pregateste(db2)
  const s0 = await stare(db2)
  const err = await eroare(aplica(db2, text))
  const post = marcajPost.includes('20270105b') || /^-- ─── 4\./.test(marcajPost) ? /20270105b post:/ : /20270105a post:/
  ok(post.test(err || '') && JSON.stringify(await stare(db2)) === JSON.stringify(s0), `${eticheta} „${nume}” refuzat la aplicare (postcondiții), nimic schimbat (${(err || 'TRECE').slice(0, 90)})`)
}
// verificare STATICĂ (L01): în fiecare RPC, între lock-ul pe proiect și marcajul de scriere există o reverificare a dreptului
function recheckDupaLock(text, fn, lockText, nivel) {
  const i = text.indexOf(`CREATE FUNCTION public.${fn}(`)
  if (i < 0) return `funcția ${fn} lipsește`
  const corp = text.slice(i, text.indexOf('$f$;', i))
  const l = corp.indexOf(lockText)
  if (l < 0) return `${fn}: lock-ul pe proiect lipsește`
  const w = corp.indexOf('SET LOCAL gazpet.rest_decontat_scriitor', l)
  if (w < 0) return `${fn}: marcajul de scriere lipsește`
  return corp.slice(l, w).includes(`public.fn_rest_decontat_drept(p_proiect, ${nivel})`) ? '' : `${fn}: dreptul NU e reverificat după lock`
}
const RECHECK = [
  [MIG_A, 'fn_rest_decontat_confirma_baza', 'WHERE x.id = p_proiect FOR SHARE;', 'v_nivel'],
  [MIG_A, 'fn_rest_decontat_confirma_situatie', 'WHERE x.id = p_proiect FOR SHARE;', "'confirmare'"],
  ...(AREB ? [[MIG_B, 'fn_executie_proiect_configurare_completa', 'WHERE e.id = p_proiect FOR UPDATE;', "'confirmare'"]] : []),
]
const verificaRecheck = (txtA, txtB) => RECHECK.map(([t, fn, lk, nv]) => recheckDupaLock(t === MIG_A ? txtA : txtB, fn, lk, nv)).filter(Boolean)
// verificare STATICĂ (L01 / L06, r4): garda proiect_articole ia advisory-ul proiectului — ACEEAȘI cheie ca RPC-ul — ÎNAINTE de verificarea stării ofertei,
// și doar cu try (o așteptare în BEFORE UPDATE / DELETE, cu rândul deja blocat, ar fi deadlock cu RPC-ul care ține advisory-ul și apoi ia rândurile vechi)
const CHEIA_GARDA = `pg_try_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || v_p::text, 0))`
const CHEIA_RPC = `pg_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || p_proiect::text, 0))`
function lockGarda(text) {
  const i = text.indexOf('CREATE FUNCTION public.fn_rest_decontat_articole_garda(')
  if (i < 0) return 'garda lipsește'
  const corp = text.slice(i, text.indexOf('$f$;', i))
  const l = corp.indexOf(CHEIA_GARDA), c = corp.indexOf('public.fn_rest_decontat_obiect_confirmat(NEW.proiect_id::bigint, NEW.obiect_cod::text)')
  if (c < 0) return 'garda nu verifică starea ofertei (pe obiect)'
  if (l < 0) return 'garda nu ia advisory-ul proiectului înaintea verificării stării (cursa cu RPC-ul)'
  if (c < l) return 'garda verifică starea ofertei ÎNAINTEA lock-ului'
  if (/[^_]pg_advisory_xact_lock\(/.test(corp)) return 'garda AȘTEAPTĂ advisory-ul (deadlock cu RPC-ul)'
  if (!text.includes(CHEIA_RPC)) return 'RPC-ul nu folosește aceeași cheie de advisory'
  return ''
}

if (!DOAR || DOAR === '0') {
  console.log('0. validatorul runnerului, detectorul porților, paritatea UM')
  for (const [f, pl, nume] of [[F(A).mig, PLAFON_LIVRARE, 'migrarea A'], [F(A).rev, PLAFON_REVENIRE, 'revenirea A'], ...(AREB ? [[F(B).mig, PLAFON_LIVRARE, 'migrarea B'], [F(B).rev, PLAFON_REVENIRE, 'revenirea B']] : [])]) {
    if (!existsSync(join(ROOT, f))) { ok(false, `${nume}: fișierul lipsește (${f})`); continue }
    const v = validator(join(ROOT, f), '--plafon-tranzactie-ms', String(pl))
    ok(v.ok && /^OK \d+ /.test(v.out), `${nume} trece validatorul cu ${pl}: ${v.out.slice(0, 120)}`)
    const v2 = validator(join(ROOT, f), '--plafon-tranzactie-ms', String(pl === 5000 ? 2000 : 5000))
    ok(!v2.ok && /PLAFON_DIFERIT/.test(v2.out), `${nume} cu alt plafon = refuz`)
    const vf = validator(join(ROOT, f), '--fara-plafon')
    ok(!vf.ok && /PLAFON_LIPSA/.test(vf.out), `${nume} fără plafon = refuz local`)
  }
  try { const o = execFileSync('node', [join(ROOT, 'scripts/izometrie/porti_regula.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); ok(true, 'detectorul porților Izometrie pe tot depozitul: ' + o.trim().split('\n').pop()) }
  catch (e) { ok(false, 'detectorul porților Izometrie: ' + String(e.stdout || '') + String(e.stderr || '')) }
  const um = t => { const i = t.indexOf('-- UM-START'), j = t.indexOf('-- UM-END'); return t.slice(i, j).replace(/\s+/g, ' ') }
  ok(um(MIG_A) === um(citeste('supabase/migrations/20261208a_executie_devize_tinte.sql')), 'lista UM (UM-START / UM-END) identică cu fn_executie_tinte_conversie din 20261208a (L19)')
  // funcțiile 20261209a din schelet = copii VERBATIM ale celor din migrarea 20261209a (altfel md5-urile din preflight n-ar însemna nimic)
  const m1209 = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
  const blocP = SCHELET.slice(SCHELET.indexOf('-- PARITATE_20261209A_INCEPUT'), SCHELET.indexOf('-- PARITATE_20261209A_SFARSIT'))
  const fnP = [...blocP.matchAll(/CREATE FUNCTION public\.(fn_[a-z_]+)\(/g)].map(m => m[1])
  const difP = fnP.filter(fn => { const a = blocP.indexOf(`CREATE FUNCTION public.${fn}(`), b = m1209.indexOf(`CREATE FUNCTION public.${fn}(`); if (b < 0) return true
    return blocP.slice(a, blocP.indexOf('$f$;', a) + 4) !== m1209.slice(b, m1209.indexOf('$f$;', b) + 4) })
  ok(fnP.length === 5 && fnP.includes('fn_executie_proiect_permis') && difP.length === 0, `scheletul: ${fnP.length} funcții 20261209a identice textual cu migrarea (diferite: ${difP.join(', ') || 'niciuna'})`)
  const rc = verificaRecheck(MIG_A, MIG_B)
  ok(rc.length === 0, 'L01: dreptul e reverificat DUPĂ lock-ul pe proiect în cele 3 RPC-uri (static)' + (rc.length ? ': ' + rc.join('; ') : ''))
  // mutanții statici: reverificarea scoasă din fiecare RPC trebuie văzută de verificarea de mai sus
  const RECHECK_A = `  -- L01: dreptul se REVERIFICĂ după lock (instrucțiune nouă = snapshot nou: MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, v_nivel) THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi acest document' USING ERRCODE = '42501';
  END IF;
`
  const RECHECK_S = `  -- L01: dreptul se REVERIFICĂ după lock (MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' USING ERRCODE = '42501';
  END IF;
`
  const RECHECK_B = `  -- L01: dreptul se REVERIFICĂ după lock (MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'configurare: proiectul nu exista sau nu ai drept sa-i declari configurarea' USING ERRCODE = '42501';
  END IF;
`
  for (const [nume, fisier, din] of [['confirma_baza fără reverificare', 'A', RECHECK_A], ['confirma_situatie fără reverificare', 'A', RECHECK_S], ...(AREB ? [['configurare_completa fără reverificare', 'B', RECHECK_B]] : [])]) {
    let t; try { t = mutant(fisier === 'A' ? MIG_A : MIG_B, [[din, '']]) } catch (e) { ok(false, `mutantul static „${nume}”: ${e.message}`); continue }
    const r = fisier === 'A' ? verificaRecheck(t, MIG_B) : verificaRecheck(MIG_A, t)
    ok(r.length === 1, `mutantul static „${nume}” e prins de verificarea pe text: ${r.join('; ') || 'NIMIC'}`)
  }
  ok(existsSync(join(ROOT, 'supabase/tests/20270105a_executie_rest_decontat_concurenta.sh')), 'proba cu două sesiuni (cursa MP schimbat cât RPC-ul așteaptă lock-ul) există pentru clonă: supabase/tests/20270105a_executie_rest_decontat_concurenta.sh')
  // r4: lock-ul gărzii înaintea verificării stării ofertei (static) + mutanții statici (fără lock / cu lock blocant)
  const lg = lockGarda(MIG_A)
  ok(lg === '', 'L01/L06: garda proiect_articole ia advisory-ul proiectului (try, aceeași cheie ca RPC-ul) ÎNAINTE de verificarea stării ofertei (static)' + (lg ? ': ' + lg : ''))
  const LOCK_G = `        IF NOT ${CHEIA_GARDA} THEN\n          RAISE EXCEPTION 'rest_decontat: oferta proiectului % se confirma chiar acum (Rest de decontat); reincearca' , v_p USING ERRCODE = '55P03';\n        END IF;\n`
  for (const [nume, lista] of [['garda fără advisory înaintea verificării stării', [[LOCK_G, '']]], ['garda cu advisory BLOCANT (pg_advisory_xact_lock)', [[`IF NOT ${CHEIA_GARDA} THEN`, `IF NOT pg_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || v_p::text, 0)) IS NULL THEN`]]]]) {
    let t; try { t = mutant(MIG_A, lista) } catch (e) { ok(false, `mutantul static „${nume}”: ${e.message}`); continue }
    const r = lockGarda(t)
    ok(r !== '', `mutantul static „${nume}” e prins de verificarea pe text: ${r || 'NIMIC'}`)
  }
  const sc = citeste('supabase/tests/20270105a_executie_rest_decontat_concurenta.sh')
  ok(/^echo "C5\./m.test(sc) && /^echo "C6\./m.test(sc) && sc.includes('REST_MUTANT=lock_garda'), 'proba cu două sesiuni are scenariile C5 / C6 (import vechi vs RPC: advisory ținut de import → RPC așteaptă și retrage; RPC în curs → import 55P03, apoi 42501) + mutantul lock_garda')
}

if (!DOAR || DOAR === '1') {
  console.log('1. refuzurile migrării A (nimic schimbat)')
  const db = await bazaNoua()
  const s0 = await stare(db), m0 = await randuriMostenite(db)
  ok(/garda start invalida/.test(await eroare(aplicaA(db, MIG_A, { marcaj: false }))), 'fără marcajul runnerului = refuz')
  ok(/AMPRENTA_GLOBALA_LIPSA/.test(await eroare(aplicaA(db, MIG_A, { l15: 'nimic' }))), 'fără pasul L15 „înainte” = refuz')
  ok(/PLAFON_TRANZACTIE lipsa/.test(await eroare(aplicaA(db, MIG_A, { plafon: 2000 }))), 'plafonul 2000 în loc de 5000 = refuz')
  await db.exec(`COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS 'porti_e4b=00000000000000000000000000000000'`)
  ok(/portile Izometrie nu sunt verzi inainte/.test(await eroare(aplicaA(db))), 'porți roșii înainte = refuz (PRE)')
  await db.exec(`DO $x$ BEGIN EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii()); END $x$`)
  await db.exec('ALTER FUNCTION public.fn_izo_porti_lipsa() RENAME TO fn_izo_porti_lipsa_x')
  ok(/portile Izometrie \(20261230a/.test(await eroare(aplicaA(db))), 'porțile lipsă (20261230a neaplicată) = refuz')
  await db.exec('ALTER FUNCTION public.fn_izo_porti_lipsa_x() RENAME TO fn_izo_porti_lipsa')
  await db.exec(`CREATE FUNCTION public.fn_rest_decontat_proba() RETURNS integer LANGUAGE sql AS 'SELECT 1'`)
  ok(/obiectele exista deja/.test(await eroare(aplicaA(db))), 'o funcție fn_rest_decontat_* există deja (reaplicare / altă formă) = refuz')
  await db.exec('DROP FUNCTION public.fn_rest_decontat_proba()')
  await db.exec('ALTER TABLE public.proiect_articole ADD COLUMN tip_rand text')
  ok(/obiectele exista deja/.test(await eroare(aplicaA(db))), 'o coloană nouă există deja pe proiect_articole = refuz')
  await db.exec('ALTER TABLE public.proiect_articole DROP COLUMN tip_rand')
  await db.exec('ALTER TABLE public.proiect_articole ALTER COLUMN cantitate TYPE text')
  ok(/coloana proiect_articole.cantitate lipseste sau are alt tip/.test(await eroare(aplicaA(db))), 'o coloană folosită cu alt tip = refuz')
  await db.exec('ALTER TABLE public.proiect_articole ALTER COLUMN cantitate TYPE numeric USING cantitate::numeric')
  // 20261209a lipsă / cu alt corp = refuz (dreptul depinde de fn_executie_proiect_permis)
  await db.exec('ALTER FUNCTION public.fn_executie_proiect_permis(bigint, boolean) RENAME TO fn_executie_proiect_permis_x')
  ok(/20261209a/.test(await eroare(aplicaA(db))), '20261209a lipsă (fn_executie_proiect_permis) = refuz')
  await db.exec('ALTER FUNCTION public.fn_executie_proiect_permis_x(bigint, boolean) RENAME TO fn_executie_proiect_permis')
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`)
  ok(/20261209a/.test(await eroare(aplicaA(db))), 'fn_executie_proiect_permis cu alt corp decât cel revizuit = refuz')
  await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_scriere IS NOT NULL
    AND (public.fn_executie_acces_nerestrans()
         OR (p_proiect IS NOT NULL AND p_proiect = ANY (public.fn_executie_acces_lista(p_scriere))))
$f$`)
  // r3: rânduri AA / NR / NCS încărcate pe calea veche (fără legătură) = refuz L14 înaintea CHECK-ului (decizie separată), nimic schimbat
  for (const [sursa, actNr] of [['act_aditional', 'AA1'], ['nota_comanda_suplimentara', null], ['nota_renuntare', null]]) {
    await db.query(`INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa, act_nr) VALUES (900, '0001', 'D02', '3', 'GC 01', 'calea veche', 'M', 100, 8000, $1, $2)`, [sursa, actNr])
    ok(/incarcate pe calea veche/.test(await eroare(aplicaA(db))), `un rând ${sursa} moștenit pe calea veche (fără legătură / confirmare) = refuz al migrării (decizie separată)`)
    await db.query(`DELETE FROM public.proiect_articole WHERE proiect_id = 900 AND sursa = $1`, [sursa])
  }
  ok(JSON.stringify(await stare(db)) === JSON.stringify(s0) && JSON.stringify(await randuriMostenite(db)) === JSON.stringify(m0), 'după refuzuri: catalogul și rândurile moștenite identice')
}

let DB = null
if (!DOAR || ['2', '3', '6'].includes(DOAR)) {
  console.log('2. livrarea A (L15 v2) și starea după')
  DB = await bazaNoua()
  const t1 = blocAmprenta(MIG_A, '20270105a'), t2 = REV_A ? blocAmprenta(REV_A, '20270105a') : null
  ok(t1 && t1 === t2, `blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length} caractere)`)
  const k1 = constanteAmprenta(MIG_A, '20270105a'), k2 = REV_A ? constanteAmprenta(REV_A, '20270105a') : []
  ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `aceeași constantă AMPRENTA în ambele fișiere (${k1} / ${k2})`)
  const m0 = await randuriMostenite(DB)
  const j = await aplicaLivrare(DB, A, MIG_A, F(A).ob)
  const amp = j.find(m => /^AMPRENTA_20270105a_TEXT/.test(m))
  if (process.argv.includes('--amprente') || amp) console.log('     amprenta A calculată: ' + (await q1(DB, `SELECT md5($1) AS m`, [amp ? amp.slice('AMPRENTA_20270105a_TEXT '.length) : ''])).m)
  ok(j.some(m => /^20270105a: randuri proiect_articole cu cheie = 5, din care cu nr in cheie = 2/.test(m)), 'NOTICE: 5 rânduri moștenite au cheie, 2 cu nr (codul repetat în același deviz al ofertei)')
  const ch = (await DB.query(`SELECT cod, nr, cheie, activ, confirmat_la FROM public.proiect_articole WHERE proiect_id = 900 ORDER BY id`)).rows
  ok(ch.map(r => r.cheie).join(';') === '0001|D01|TSA01A1|#1;0001|D01|TSA01A1|#2;0001|D02|GC 01;0002|D02|GC 01;||TEAVA-DN300' && ch.every(r => r.activ && r.confirmat_la === null),
    'cheile moștenite: nr doar pe codul repetat în același document; toate activ, neconfirmate: ' + ch.map(r => r.cheie).join(';'))
  ok(JSON.stringify(await randuriMostenite(DB)) === JSON.stringify(m0), `rândurile moștenite identice (în afara cheii): ${m0.n} rânduri`)
  const gata = await q1(DB, `SELECT public.fn_izo_porti_lipsa() AS v`)
  ok(JSON.stringify(gata.v) === '[]', 'porțile Izometrie verzi după (ștampilele recalculate): ' + JSON.stringify(gata.v))
  ok(/obiectele exista deja/.test(await eroare(aplicaA(DB))), 'a doua aplicare = refuz')
  // baza proiectului moștenit (ca owner sintetic): oferta moștenită (calea veche) intră; extras_materiale nu intră
  await DB.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const b = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT cheie, cantitate::text AS c, um, randuri FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 900 ORDER BY cheie`)
  ok(!b.err && JSON.stringify(b.rows) === JSON.stringify([{ cheie: '0001|D01|TSA01A1|#1', c: '120', um: 'MC', randuri: 1 }, { cheie: '0001|D01|TSA01A1|#2', c: '30', um: 'MC', randuri: 1 },
    { cheie: '0001|D02|GC 01', c: '1000', um: 'M', randuri: 1 }, { cheie: '0002|D02|GC 01', c: '500', um: 'M', randuri: 1 }]), 'baza moștenită: oferta de pe calea veche (1000 m), fără extras_materiale: ' + JSON.stringify(b.rows || b.msg))
  await DB.exec(`DELETE FROM public.profiles WHERE id = 'f0000000-0000-4000-8000-00000000009a'`)
}
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message } }
}

if (!DOAR || DOAR === '3') {
  console.log('3. dry-run-ul A (toate blocurile, ROLLBACK la final)')
  if (!DB) { DB = await bazaNoua(); await aplicaLivrare(DB, A, MIG_A, F(A).ob) }
  const ab = await verificaDry(DB, DRY_A, BLOCURI_A)
  ok(ab.length === 0, 'dry-run A: toate blocurile ok' + (ab.length ? ': ' + ab.join(' | ') : ''))
  const r = await q1(DB, `SELECT (SELECT count(*) FROM public.executie_sl_detaliu) + (SELECT count(*) FROM public.executie_note_modificare) + (SELECT count(*) FROM public.proiect_articole WHERE confirmat_la IS NOT NULL) AS n`)
  ok(Number(r.n) === 0, 'după ROLLBACK-ul dry-run-ului nimic nu a rămas')
}

if (!DOAR || DOAR === '4') {
  console.log('4. MUTANȚI ai migrării A (aplicați cu succes fără postcondiții → dry-run-ul trebuie să-i prindă; cu postcondițiile întregi, refuz la aplicare)')
  const POST_A = '-- ─── 12. Postcondiții'
  const MUTANTI_A = [
    // r2 (review #1158)
    ['garda proiect_articole acceptă marcajul LIPSĂ (NULL într-o sesiune nouă)', [
      // (același marcaj îl citește și garda istoricului, r5: textul mutantului include linia următoare, proprie gărzii proiect_articole)
      [`  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_rest_decontat_confirma_baza';\n  v_server boolean := public.fn_rest_decontat_server() IS TRUE;\n  v_fara text;`, `  v_rpc boolean := current_setting('gazpet.rest_decontat_scriitor', true) = 'fn_rest_decontat_confirma_baza';\n  v_server boolean := public.fn_rest_decontat_server() IS TRUE;\n  v_fara text;`],
      [`    IF OLD.confirmat_la IS NOT NULL AND (v_rpc OR v_server) IS NOT TRUE THEN`, `    IF OLD.confirmat_la IS NOT NULL AND NOT (v_rpc OR v_server) THEN`],
      [`  IF (v_rpc OR v_server) IS NOT TRUE THEN\n    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`, `  IF NOT (v_rpc OR v_server) THEN\n    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`]]],
    // (garda situațiilor cu marcaj NULL e corectată la fel, dar NU e observabilă de client: authenticated n-are INSERT / UPDATE / DELETE pe
    //  executie_sl_detaliu* — refuzul de privilegiu vine înaintea trigger-ului; un mutant acolo ar fi echivalent pentru dry-run)
    ['restricția pe proiect (20261209a) scoasă din drept', [[`    AND public.fn_executie_proiect_permis(p_proiect, p_nivel <> 'citire') IS TRUE\n`, '']]],
    ['un singur grup de coduri repetate (SELECT INTO pe agregare cu GROUP BY)', [[
      `  SELECT coalesce(array_agg(z.k ORDER BY z.k), ARRAY[]::text[]) INTO STRICT v_dub\n    FROM (SELECT k FROM unnest(v_chei) AS k GROUP BY k HAVING count(*) > 1) z;`,
      `  SELECT array_agg(DISTINCT k) INTO v_dub FROM (SELECT unnest(v_chei) AS k) z GROUP BY k HAVING count(*) > 1;\n  v_dub := coalesce(v_dub, ARRAY[]::text[]);`]]],
    ['poziția lipsă pe un cod repetat neverificată', [[`    IF v_repetat AND coalesce(e->>'nr', '') !~ '[^[:space:]]' THEN`, `    IF false THEN`]]],
    ['cheia finală duplicată neverificată (același cod, aceeași poziție)', [
      [`    IF v_k = ANY (v_finale) THEN`, `    IF false THEN`],
      [`  IF cardinality(v_finale) <> jsonb_array_length(v_linii) OR (SELECT count(DISTINCT f) FROM unnest(v_finale) f) <> jsonb_array_length(v_linii) THEN`, `  IF false THEN`]]],
    ['lista completă pe obiect_cod brut (nu pe identitatea canonică)', [[`           public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) AS obiect_k,`, `           a.obiect_cod::text AS obiect_k,`]]],
    ['devizul unei note NEAPROBATE acceptat de RPC', [[`    IF v_data_nota IS NULL THEN`, `    IF false THEN`]]],
    ['nota neaprobată numărată în bază (calcul)', [[`AND coalesce(nt.activ, false) AND nt.data_aprobare IS NOT NULL\n`, `AND coalesce(nt.activ, false)\n`]]],
    // r3 (review #1158, clasa R1-6: rândul NR / NCS / AA scris direct)
    ['garda nu refuză sursa cu flux (INSERT direct NR / NCS / AA trece de gardă; CHECK-ul dă 23514, nu 42501)', [[`    IF NOT public.fn_rest_decontat_sursa_autorizata(NEW.sursa::text, NULL, NULL, NULL) THEN`, `    IF false THEN`]]],
    ['garda refuză sursa cu flux doar la INSERT (schimbarea sursei unui rând neconfirmat trece)', [[`    IF NOT public.fn_rest_decontat_sursa_autorizata(NEW.sursa::text, NULL, NULL, NULL) THEN`, `    IF TG_OP = 'INSERT' AND NOT public.fn_rest_decontat_sursa_autorizata(NEW.sursa::text, NULL, NULL, NULL) THEN`]]],
    ['predicatul unic lasă AA fără act / confirmare (INSERT direct AA acceptat de gardă, CHECK și calcul)', [[`    WHEN p_sursa = 'act_aditional' THEN p_act_aditional_id IS NOT NULL AND p_confirmat_la IS NOT NULL`, `    WHEN p_sursa = 'act_aditional' THEN true`]]],
    ['predicatul unic lasă NR fără notă / confirmare (INSERT direct NR acceptat)', [[`    WHEN p_sursa IN ('nota_renuntare', 'nota_comanda_suplimentara') THEN p_nota_id IS NOT NULL AND p_confirmat_la IS NOT NULL`, `    WHEN p_sursa = 'nota_comanda_suplimentara' THEN p_nota_id IS NOT NULL AND p_confirmat_la IS NOT NULL`]]],
    ['predicatul unic lasă NCS fără notă / confirmare (INSERT direct NCS acceptat)', [[`    WHEN p_sursa IN ('nota_renuntare', 'nota_comanda_suplimentara') THEN p_nota_id IS NOT NULL AND p_confirmat_la IS NOT NULL`, `    WHEN p_sursa = 'nota_renuntare' THEN p_nota_id IS NOT NULL AND p_confirmat_la IS NOT NULL`]]],
    ['CHECK-ul fără predicatul sursei (serverul scrie rândul orfan / neconfirmat)', [[`    AND (act_aditional_id IS NULL OR sursa = 'act_aditional') AND (nota_id IS NULL OR act_aditional_id IS NULL)\n    AND public.fn_rest_decontat_sursa_autorizata(sursa, nota_id, act_aditional_id, confirmat_la));`, `    AND (act_aditional_id IS NULL OR sursa = 'act_aditional') AND (nota_id IS NULL OR act_aditional_id IS NULL));`]]],
    ['calculul numără rândul AA / NR / NCS neconfirmat sau orfan', [[`       AND public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)\n`, '']]],
    ['lipsurile nu declară rândurile neautorizate', [[`   WHERE NOT public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)`, `   WHERE false`]]],
    // r4 (review #1158, P1 r3: reimportul vechi dubla baza confirmată — stările ofertei), rescriși pe obiect în r5
    ['garda primește oferta veche pe un obiect cu oferta confirmată (INSERT / reparentare direct)', [[`      IF NEW.sursa = 'contract_initial' AND public.fn_rest_decontat_obiect_confirmat(NEW.proiect_id::bigint, NEW.obiect_cod::text) THEN`, `      IF false THEN`]]],
    ['garda refuză oferta veche pe obiectul confirmat doar la INSERT (UPDATE-ul rândului vechi al obiectului trece)', [[`      IF TG_OP = 'UPDATE' AND OLD.sursa = 'contract_initial' AND public.fn_rest_decontat_obiect_confirmat(OLD.proiect_id::bigint, OLD.obiect_cod::text) THEN`, `      IF false THEN`]]],
    ['garda lasă ștergerea directă a rândurilor ofertei pe un obiect confirmat', [[`    IF OLD.sursa = 'contract_initial' AND (v_rpc OR v_server) IS NOT TRUE AND public.fn_rest_decontat_obiect_confirmat(OLD.proiect_id::bigint, OLD.obiect_cod::text) THEN`, `    IF false THEN`]]],
    ['garda nu ia advisory-ul proiectului înaintea verificării stării (cursa import vechi vs RPC; prins și static)', [[`        IF NOT pg_try_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || v_p::text, 0)) THEN\n          RAISE EXCEPTION 'rest_decontat: oferta proiectului % se confirma chiar acum (Rest de decontat); reincearca' , v_p USING ERRCODE = '55P03';\n        END IF;\n`, '']]],
    ['RPC-ul cumulează: rândurile vechi ale obiectelor importate nu se retrag la confirmarea ofertei', [[`       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`, `       WHERE false\n       RETURNING a.*),`]]],
    ['calculul numără rândurile contract_initial neconfirmate pe un obiect cu oferta confirmată', [[`\n       AND (a.sursa <> 'contract_initial' OR a.confirmat_la IS NOT NULL OR NOT public.fn_rest_decontat_obiect_confirmat(p_proiect, a.obiect_cod::text))),`, `\n       ),`]]],
    ['lipsurile nu declară oferta veche neconfirmată pe un obiect confirmat', [[`   WHERE public.fn_rest_decontat_obiect_confirmat(pr.id, a.obiect_cod::text)\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n  UNION ALL`, `   WHERE false\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n  UNION ALL`]]],
    ['predicatul stării cere rândul confirmat ACTIV (oferta confirmată retrasă = calea veche redeschisă)', [[`                  WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.confirmat_la IS NOT NULL\n                    AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)`, `                  WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.confirmat_la IS NOT NULL AND a.activ\n                    AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)`]]],
    // r5 (review #1158, 2 × P1 r4: starea pe OBIECT, obiectele neimportate neatinse, rândurile înlocuite în istoric — nu în tabel)
    ['RPC-ul retrage TOATE obiectele proiectului, nu doar cele importate (P1 r4: O2 dispare la importul lui O1)', [[`       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`, `       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n       RETURNING a.*),`]]],
    ['RPC-ul refuză (23505) orice obiect al unui proiect cu un obiect confirmat (regula pe proiect din r4: 0002 nu se mai poate confirma târziu)', [[
      `           coalesce(array_agg(z.k ORDER BY z.k) FILTER (WHERE public.fn_rest_decontat_obiect_confirmat(p_proiect, z.o)), ARRAY[]::text[])`,
      `           CASE WHEN EXISTS (SELECT 1 FROM public.proiect_articole q WHERE q.proiect_id::bigint = p_proiect AND q.sursa = 'contract_initial' AND q.confirmat_la IS NOT NULL) THEN coalesce(array_agg(z.k ORDER BY z.k), ARRAY[]::text[]) ELSE ARRAY[]::text[] END`]]],
    ['re-importul unui obiect confirmat acceptat FĂRĂ „inlocuieste”', [[`    IF cardinality(v_conf) > 0 AND NOT p_inlocuieste THEN`, `    IF false THEN`]]],
    ['„inlocuieste” acceptat fără niciun obiect confirmat în document', [[`    IF p_inlocuieste AND cardinality(v_conf) = 0 THEN`, `    IF false THEN`]]],
    ['„inlocuieste” acceptat pe devizul unui act / al unei note', [[`  ELSIF p_inlocuieste THEN\n    RAISE EXCEPTION 'rest_decontat: „inlocuieste” e doar pentru oferta (contract_initial); devizul unui act / al unei note se inlocuieste printr-o decizie separata' USING ERRCODE = '22023';\n`, '']]],
    ['rândurile înlocuite rămân în proiect_articole cu activ = false (textul RPC-ului r4): cititorii vechi văd și rândurile retrase', [[
      `    WITH mut AS (\n      DELETE FROM public.proiect_articole a\n       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`,
      `    WITH mut AS (\n      UPDATE public.proiect_articole a SET activ = false\n       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.activ\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`],
      [`    IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n                 AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)) THEN`, `    IF false THEN`]]],
    ['garda verifică starea pe PROIECT, nu pe obiect (un obiect nou / vechi al unui proiect cu alt obiect confirmat e refuzat)', [[
      `      IF NEW.sursa = 'contract_initial' AND public.fn_rest_decontat_obiect_confirmat(NEW.proiect_id::bigint, NEW.obiect_cod::text) THEN`,
      `      IF NEW.sursa = 'contract_initial' AND EXISTS (SELECT 1 FROM public.proiect_articole q WHERE q.proiect_id::bigint = NEW.proiect_id::bigint AND q.sursa = 'contract_initial' AND q.confirmat_la IS NOT NULL) THEN`]]],
    ['calculul ignoră rândurile vechi ale unui obiect NEIMPORTAT când alt obiect al proiectului e confirmat (regula pe proiect)', [[
      `OR NOT public.fn_rest_decontat_obiect_confirmat(p_proiect, a.obiect_cod::text))),`,
      `OR NOT EXISTS (SELECT 1 FROM public.proiect_articole q WHERE q.proiect_id::bigint = p_proiect AND q.sursa = 'contract_initial' AND q.confirmat_la IS NOT NULL))),`]]],
    ['lipsurile nu declară obiectele încă vechi (oferta_neconfirmata)', [[`   WHERE NOT public.fn_rest_decontat_obiect_confirmat(pr.id, a.obiect_cod::text)\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n  UNION ALL`, `   WHERE false\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n  UNION ALL`]]],
    ['predicatul stării ignoră istoricul (obiectul scos de server se redeschide pe calea veche)', [[`         OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric h\n                  WHERE h.proiect_id = p_proiect AND h.sursa = 'contract_initial' AND h.confirmat_la IS NOT NULL\n                    AND h.obiect_k = public.fn_rest_decontat_cheie(p_obiect, NULL, NULL, NULL)))`, `         )`]]],
    ['istoricul se scrie fără motivul / amprenta fișierului nou (inlocuire_oferta nedeosebit de confirmare_oferta)', [[`             CASE WHEN m.confirmat_la IS NULL THEN 'confirmare_oferta' ELSE 'inlocuire_oferta' END, p_amprenta`, `             'confirmare_oferta', p_amprenta`]]],
    // (garda istoricului cu marcaj NULL NU e observabilă de client: authenticated n-are INSERT / UPDATE / DELETE pe proiect_articole_istoric —
    //  refuzul de privilegiu vine înaintea trigger-ului; dry-run-ul verifică privilegiile prin postcondiții, nu printr-un mutant al gărzii)
    // r6 (review #1158, 2 × P1 + P2 r5: UM-ul la înlocuire, reprezentarea existentă, amprenta din istoric)
    // (r7: UM-ul existent are două surse — baza anterioară și formele cheii —, deci mutantul scoate ambele; altfel e echivalent)
    ['UM-ul validat față de baza RĂMASĂ, fără obiectele care se înlocuiesc, și fără UM-ul formelor cheii (ca r5: cheia înlocuită nu mai are UM vechi)', [[
      `    FROM public.fn_rest_decontat_baza_proiect(p_proiect) b;\n`,
      `    FROM public.fn_rest_decontat_baza_proiect(p_proiect) b WHERE NOT (public.fn_rest_decontat_cheie(b.obiect_cod, NULL, NULL, NULL) = ANY (v_obiecte));\n`],
      [`    v_um := coalesce(v_baza->v_k->>'um', (SELECT x.um FROM jsonb_array_elements(v_forme) f CROSS JOIN LATERAL public.fn_rest_decontat_um(f->>'um') x\n`,
       `    v_um := coalesce(v_baza->v_k->>'um', (SELECT NULL::text FROM jsonb_array_elements(v_forme) f CROSS JOIN LATERAL public.fn_rest_decontat_um(f->>'um') x\n`]]],
    ['cheia DECONTATĂ acceptă alt UM normalizat (100 M → situație 80 M → înlocuire 100 MC trece)', [[
      `    IF cardinality(v_um_dec) > 0 OR (v_k = ANY (v_ref) AND v_um IS NOT NULL AND v_um IS DISTINCT FROM v_um_n) THEN`, `    IF false THEN`]]],
    // r10 (review #1158, P1 + P2 pe r9): validarea UM față de decontat pe TOATE căile (o singură funcție) + poziția reconstruită din cheia referită
    ['RPC: validarea UM față de decontat doar la ofertă (r9) — devizul AA / NR / NCS reface baza unei chei fără bază în alt UM (reproducerea P1 r9)', [[
      `    IF cardinality(v_um_dec) > 0 OR (v_k = ANY (v_ref) AND v_um IS NOT NULL AND v_um IS DISTINCT FROM v_um_n) THEN`,
      `    IF p_sursa = 'contract_initial' AND (cardinality(v_um_dec) > 0 OR (v_k = ANY (v_ref) AND v_um IS NOT NULL AND v_um IS DISTINCT FROM v_um_n)) THEN`]]],
    ['garda: UM-ul rândului bazei neverificat față de decontat (calea veche rescrie articolul șters în MC peste 80 M)', [[
      `    v_um_dif := public.fn_rest_decontat_um_decontat_diferit(NEW.proiect_id::bigint, NEW.cheie, NEW.um::text);\n    IF cardinality(v_um_dif) > 0 THEN`,
      `    v_um_dif := public.fn_rest_decontat_um_decontat_diferit(NEW.proiect_id::bigint, NEW.cheie, NEW.um::text);\n    IF false THEN`]]],
    ['garda verifică UM-ul doar la INSERT (UPDATE-ul UM-ului unui rând al bazei referit trece)', [[
      `     AND (TG_OP = 'INSERT' OR (NEW.cheie, NEW.um::text, NEW.activ, NEW.sursa::text, NEW.proiect_id::bigint)\n                              IS DISTINCT FROM (OLD.cheie, OLD.um::text, OLD.activ, OLD.sursa::text, OLD.proiect_id::bigint)) THEN`,
      `     AND TG_OP = 'INSERT' THEN`]]],
    ['serverul ocolește validarea UM a gărzii', [[
      `  IF NEW.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') AND NEW.activ\n     AND (TG_OP = 'INSERT' OR`,
      `  IF NOT v_server AND NEW.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') AND NEW.activ\n     AND (TG_OP = 'INSERT' OR`]]],
    ['funcția unică de validare UM fără SECURITY DEFINER (garda rulează ca apelantul: accesul general nu vede situațiile → compatibil)', [[
      `CREATE FUNCTION public.fn_rest_decontat_um_decontat_diferit(p_proiect bigint, p_cheie text, p_um text) RETURNS text[]\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$`,
      `CREATE FUNCTION public.fn_rest_decontat_um_decontat_diferit(p_proiect bigint, p_cheie text, p_um text) RETURNS text[]\nLANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$`]]],
    ['funcția unică compară UM-urile brute, nu normalizate (ML / HM refuzate pe o cheie decontată în M)', [[
      `                                AND x.um IS DISTINCT FROM (SELECT y.um FROM public.fn_rest_decontat_um(p_um) y)), ARRAY[]::text[]) END`,
      `                                AND l.um IS DISTINCT FROM p_um), ARRAY[]::text[]) END`]]],
    ['funcția unică numără și situațiile INACTIVE (versiunea înlocuită ține cheia prizonieră în UM-ul vechi)', [[
      `                              WHERE d.proiect_id = p_proiect AND d.activ AND l.cheie = p_cheie\n                                AND x.um IS DISTINCT FROM`,
      `                              WHERE d.proiect_id = p_proiect AND l.cheie = p_cheie\n                                AND x.um IS DISTINCT FROM`]]],
    ['RPC: poziția nereconstruită din cheia referită (linia fără nr pe o cheie #n ajunsă în istoric scrisă cu nr NULL — reproducerea P2 r9)', [[
      `                 WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)\n`, '']]],
    ['lipsurile nu declară UM-ul bazei diferit de cel decontat (decontat_um_diferit)', [[`   WHERE cardinality(d.u) > 0\n$f$;`, `   WHERE false\n$f$;`]]],
    ['calculul nu marchează um_incert când UM-ul decontat diferă de cel al bazei', [[
      `           (coalesce(b.um_incert, false) OR (b.cheie IS NOT NULL AND cardinality(public.fn_rest_decontat_um_decontat_diferit(b.proiect_id, b.cheie, b.um)) > 0)) AS um_incert, b.pret_unitar,`,
      `           coalesce(b.um_incert, false) AS um_incert, b.pret_unitar,`]]],
    ['schimbarea UM-ului pe o cheie fără decontat acceptată FĂRĂ accept_schimbare_um', [[`        IF NOT v_accept_um THEN`, `        IF false THEN`]]],
    // r7 (review #1158, 2 × P1 pe r6: regula PE CHEIE, PE FIECARE CÂMP): fiecare câmp necopiat din rândul cheii (scris cum vine, normalizat) e văzut de un cititor
    ['obiect_cod necopiat din rândul cheii (scris cum vine, normalizat: " o1 " → "o1" în loc de "O1")', [[
      `      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := btrim(regexp_replace(e->>'obiect_cod', '[[:space:]]+', ' ', 'g')); v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`]]],
    ['deviz_cod necopiat din rândul cheii (" d1 " → "d1" în loc de "D1": catalogul ordonează pe deviz)', [[
      `      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := v_f->>'obiect_cod'; v_dz := btrim(regexp_replace(e->>'deviz_cod', '[[:space:]]+', ' ', 'g')); v_cod := v_f->>'cod';`]]],
    ['cod necopiat din rândul cheii (" tsa01 " → "tsa01" în loc de "TSA01")', [[
      `      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := btrim(regexp_replace(e->>'cod', '[[:space:]]+', ' ', 'g'));`]]],
    ['nr necopiat din rândul cheii la aceeași poziție ("2A" în loc de "2a")', [[
      `    v_nr := CASE WHEN cardinality(v_nr_forme) = 1 THEN v_nr_forme[1]\n                 WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)\n                 ELSE btrim(regexp_replace(e->>'nr', '[[:space:]]+', ' ', 'g')) END;`,
      `    v_nr := CASE WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)\n                 ELSE btrim(regexp_replace(e->>'nr', '[[:space:]]+', ' ', 'g')) END;`]]],
    ['UM-ul scris brut, cum vine (cantitatea convertită, UM-ul nu: 2 „MC” în loc de 2 „100 MC”)', [[
      `      'um', coalesce(v_um_rep, btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g'))), 'cantitate', v_c,`, `      'um', btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g')), 'cantitate', v_c,`]]],
    ['cantitatea neconvertită în UM-ul existent (200 „100 MC” în loc de 2)', [[`      v_c := v_c * v_factor / v_factor_rep; v_p := v_p * v_factor_rep / v_factor;`, `      v_p := v_p * v_factor_rep / v_factor;`]]],
    ['prețul unitar neconvertit în UM-ul existent (10 pe „100 MC” în loc de 1000)', [[`      v_c := v_c * v_factor / v_factor_rep; v_p := v_p * v_factor_rep / v_factor;`, `      v_c := v_c * v_factor / v_factor_rep;`]]],
    ['ambiguitatea formelor brute ale cheii neverificată (documentul alege una din forme)', [[`    IF jsonb_array_length(v_f_id) > 1 OR cardinality(v_nr_forme) > 1 OR cardinality(v_um_forme) > 1 THEN`, `    IF false THEN`]]],
    ['cheia nouă scrisă brut, nenormalizată (" z  z ", " d1 ")', [[
      `      v_dz := btrim(regexp_replace(e->>'deviz_cod', '[[:space:]]+', ' ', 'g')); v_cod := btrim(regexp_replace(e->>'cod', '[[:space:]]+', ' ', 'g'));`,
      `      v_dz := e->>'deviz_cod'; v_cod := e->>'cod';`]]],
    ['unitatea din proiect_unitati ignorată la reprezentarea unui obiect nou (20261208a nu-l mai găsește)', [[
      `      LEFT JOIN LATERAL (SELECT pu.obiect_cod::text AS ob FROM public.proiect_unitati pu WHERE pu.proiect_id::bigint = p_proiect AND pu.obiect_cod IS NOT NULL\n                            AND public.fn_rest_decontat_cheie(pu.obiect_cod::text, NULL, NULL, NULL) = d.k\n                          ORDER BY pu.id LIMIT 1) u ON true) z`,
      `      LEFT JOIN LATERAL (SELECT NULL::text AS ob) u ON true) z`]]],
    ['cantitatea nereprezentabilă exact în UM-ul existent se rotunjește tăcit', [[`      IF v_c <> round(v_c, 6) OR (v_p IS NOT NULL AND v_p <> round(v_p, 6)) THEN`, `      IF false THEN`]]],
    // r8 (review #1158, 2 × P1 + P2 pe r7): importul vechi după migrare (regula documentului în gardă) și poziția (copiere exactă, forme multiple, nr_schimbat)
    ['calea veche: trigger-ul atribuie mereu cheia fără poziție (r7 — codul repetat prin catalog după migrare se comasează)', [[
      `    IF TG_OP = 'INSERT' AND public.fn_rest_decontat_cheie_document(NEW.proiect_id::bigint, NEW.sursa::text, NEW.act_nr::text, v_fara) THEN\n      NEW.cheie := v_cu;\n    ELSE\n      NEW.cheie := v_fara;\n    END IF;`,
      `    NEW.cheie := v_fara;`]]],
    ['calea veche: rândurile deja scrise ale grupului nu se re-cheiază (doar rândul nou primește poziția; grupul tăiat de lot rămâne amestecat)', [[
      `   WHERE a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')\n     AND a.confirmat_la IS NULL\n     AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k\n     AND a.cheie IS DISTINCT FROM`,
      `   WHERE false AND a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')\n     AND a.confirmat_la IS NULL\n     AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k\n     AND a.cheie IS DISTINCT FROM`]]],
    ['re-cheierea apelabilă direct (fără garda pg_trigger_depth)', [[`  IF pg_trigger_depth() = 0 THEN`, `  IF false THEN`]]],
    ['poziția: formele nr doar de la rândurile cu aceeași poziție canonică (r7) — pozițiile diferite stocate sub aceeași cheie nu sunt forme multiple', [[
      `    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f;`,
      `    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f\n     WHERE public.fn_rest_decontat_cheie(f->>'nr', NULL, NULL, NULL) = public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL);`]]],
    ['poziția diferită a unei chei existente acceptată (nr_schimbat neverificat)', [[
      `    IF cardinality(v_nr_forme) = 1 AND coalesce(e->>'nr', '') ~ '[^[:space:]]'\n       AND public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL) IS DISTINCT FROM public.fn_rest_decontat_cheie(v_nr_forme[1], NULL, NULL, NULL) THEN`,
      `    IF false THEN`]]],
    ['poziția diferită acceptată ȘI scrisă (r7 întreg: formele pe poziția liniei + fără refuz + poziția nouă scrisă)', [[
      `    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f;`,
      `    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f\n     WHERE public.fn_rest_decontat_cheie(f->>'nr', NULL, NULL, NULL) = public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL);`],
      [`    IF cardinality(v_nr_forme) = 1 AND coalesce(e->>'nr', '') ~ '[^[:space:]]'\n       AND public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL) IS DISTINCT FROM public.fn_rest_decontat_cheie(v_nr_forme[1], NULL, NULL, NULL) THEN`,
       `    IF false THEN`]]],
    // r9 (review #1158, 2 × P1 pe r8): o cheie REFERITĂ de o situație confirmată e înghețată; decontatul fără articol e declarat
    ['cheia referită se re-cheiază / își schimbă codul pe calea veche (garda fără refuzul cheie_referita — reproducerea 1: decontatul desprins de articol)', [[
      `  IF TG_OP = 'UPDATE' AND NEW.cheie IS DISTINCT FROM OLD.cheie AND OLD.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') THEN\n    v_sit := public.fn_rest_decontat_cheie_situatii(OLD.proiect_id::bigint, OLD.cheie);`,
      `  IF false THEN\n    v_sit := public.fn_rest_decontat_cheie_situatii(OLD.proiect_id::bigint, OLD.cheie);`]]],
    ['serverul ocolește înghețarea cheii referite (garda sare peste refuz când v_server)', [[
      `  IF TG_OP = 'UPDATE' AND NEW.cheie IS DISTINCT FROM OLD.cheie AND OLD.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') THEN\n    v_sit := public.fn_rest_decontat_cheie_situatii(OLD.proiect_id::bigint, OLD.cheie);`,
      `  IF TG_OP = 'UPDATE' AND NOT v_server AND NEW.cheie IS DISTINCT FROM OLD.cheie AND OLD.sursa IN ('contract_initial', 'act_aditional', 'nota_renuntare', 'nota_comanda_suplimentara') THEN\n    v_sit := public.fn_rest_decontat_cheie_situatii(OLD.proiect_id::bigint, OLD.cheie);`]]],
    ['învelișul cheii referite fără SECURITY DEFINER (politicile apelantului: accesul general Execuție nu vede situațiile → re-cheierea trece sau pică altfel)', [[
      `CREATE FUNCTION public.fn_rest_decontat_cheie_situatii(p_proiect bigint, p_cheie text) RETURNS text[]\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$`,
      `CREATE FUNCTION public.fn_rest_decontat_cheie_situatii(p_proiect bigint, p_cheie text) RETURNS text[]\nLANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$`]]],
    ['RPC: poziția #n a unei chei referite nu e păstrată când codul nu se mai repetă (reproducerea 2: „#1” → fără poziție)', [[
      `      ELSIF v_kn IS NOT NULL AND v_kn = ANY (v_ref_id) THEN\n        v_k := v_kn;`, `      ELSIF false THEN\n        v_k := v_kn;`]]],
    ['RPC: codul decontat (cheia fără poziție referită) se desparte în poziții fără refuz (reproducerea 1 pe RPC)', [[
      `      IF v_repetat AND v_kb = ANY (v_ref_id) THEN\n        RAISE EXCEPTION 'rest_decontat: cheia % e referita de situatiile confirmate (%) si codul % se repeta acum in document`,
      `      IF false THEN\n        RAISE EXCEPTION 'rest_decontat: cheia % e referita de situatiile confirmate (%) si codul % se repeta acum in document`]]],
    ['RPC: linia fără poziție nu ia unica cheie referită a identității ei (devizul AA listă completă rupe legătura cu decontatul)', [[
      `      ELSIF v_kn IS NULL AND cardinality(v_ref_id) = 1 THEN\n        v_k := v_ref_id[1];`, `      ELSIF false THEN\n        v_k := v_ref_id[1];`]]],
    ['RPC: linia fără poziție cu mai multe chei referite acceptată (ambiguitatea nerefuzată, decontatul celor două poziții desprins)', [[
      `      ELSIF v_kn IS NULL THEN\n        RAISE EXCEPTION 'rest_decontat: linia % fara pozitie (nr) e ambigua`, `      ELSIF false THEN\n        RAISE EXCEPTION 'rest_decontat: linia % fara pozitie (nr) e ambigua`]]],
    ['lipsurile nu declară decontatul fără articol (decontat_fara_articol)', [[`   WHERE NOT (r.cheie = ANY (bz.chei))\n  UNION ALL`, `   WHERE false\n  UNION ALL`]]],
    ['RPC-ul nu întoarce cheile referite rămase fără bază (decontat_fara_baza mereu gol)', [[`   WHERE NOT (r.cheie = ANY (coalesce(bz.chei, ARRAY[]::text[])));`, `   WHERE false;`]]],
    ['amprenta fișierului necăutată în istoric (A → B → A acceptat)', [[
      `\n     OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric h WHERE h.proiect_id = p_proiect AND h.rand->>'fisier_amprenta' = p_amprenta) THEN\n    RAISE EXCEPTION 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect'`,
      ` THEN\n    RAISE EXCEPTION 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect'`]]],
    ['„înainte” la lista completă = momentul încărcării, nu data documentului', [[`AND (r1.data_doc, r1.moment, r1.id) < (lc.data_doc, lc.moment, lc.id))),`, `AND (r1.moment, r1.id) < (lc.moment, lc.id))),`]]],
    ['prețul = ultimul document încărcat, nu ultimul act (după dată)', [[`(array_agg(u.pret_unitar ORDER BY u.data_doc DESC, u.moment DESC, u.id DESC) FILTER (WHERE u.pret_unitar IS NOT NULL))[1],`, `(array_agg(u.pret_unitar ORDER BY u.moment DESC, u.id DESC) FILTER (WHERE u.pret_unitar IS NOT NULL))[1],`]]],
    // r1
    ['aceeași amprentă acceptată (dublarea situației)', [[`  IF EXISTS (SELECT 1 FROM public.executie_sl_detaliu d WHERE d.proiect_id = p_proiect AND d.amprenta = p_amprenta) THEN`, `  IF false THEN`]]],
    ['nr. existent fără „înlocuiește” acceptat', [[`    IF NOT p_inlocuieste THEN`, `    IF false THEN`]]],
    ['notele legate de un AA activ cu deviz se adună încă o dată', [[`\n            AND NOT (coalesce(aan.activ, false) AND coalesce(aan.are_deviz, false)))),`, `)),`]]],
    ['AA inactiv încă numărat', [[`        OR (r0.sursa = 'act_aditional' AND coalesce(aa.activ, false))`, `        OR (r0.sursa = 'act_aditional')`]]],
    ['restul tăiat la zero', [[`art.nr, art.cod, art.denumire, art.um, art.um_incert, art.pret_unitar, art.bc, art.bv, art.dc, art.dv, art.bc - art.dc, art.bv - art.dv,`, `art.nr, art.cod, art.denumire, art.um, art.um_incert, art.pret_unitar, art.bc, art.bv, art.dc, art.dv, greatest(art.bc - art.dc, 0), greatest(art.bv - art.dv, 0),`]]],
    ['accesul general Execuție dă citire', [[`                     WHERE u.profile_id = auth.uid() AND u.module = 'executie_rest_decontat'`, `                     WHERE u.profile_id = auth.uid() AND u.module IN ('executie_rest_decontat', 'executie')`]]],
    ['UM-ul liniei neverificat', [[`      IF v_incert OR v_um IS DISTINCT FROM (SELECT x.um FROM public.fn_rest_decontat_um(e->>'um') x) THEN`, `      IF false THEN`]]],
    ['lipsa ofertei neverificată', [[`    RAISE EXCEPTION 'rest_decontat: proiectul nu are oferta financiara confirmata (fara_baza)' USING ERRCODE = 'P0001';`, `    NULL;`]]],
    ['factorul UM ignorat în bază (100 MC = 1 MC)', [[`         coalesce(sum(u.cantitate * u.factor), 0), coalesce(sum(u.valoare), 0), count(*)::integer,`, `         coalesce(sum(u.cantitate), 0), coalesce(sum(u.valoare), 0), count(*)::integer,`]]],
    ['rândurile confirmate se pot modifica direct', [[`    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`, `    IF false THEN`]]],
  ]
  for (const [nume, lista] of MUTANTI_A) {
    await ruleazaMutant({ eticheta: 'mutantul A', nume, lista, textBaza: MIG_A, marcajPost: POST_A, pregateste: async () => {}, aplica: (db, t) => aplicaA(db, t), dry: DRY_A, blocuri: BLOCURI_A })
  }
  ok(MIG_A.indexOf(POST_A) > 0 && MIG_A.slice(MIG_A.indexOf(POST_A)).includes('AMPRENTA_20270105a_INCEPUT'), 'postcondițiile A conțin amprenta (mutanții o ating)')
}

if (AREB && (!DOAR || DOAR === '5')) {
  console.log('5. migrarea B (poarta proiectului) peste A: dry-run, mutanți, revenire')
  const db = await bazaNoua()
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(/20270105a/.test(await eroare(aplicaB(db, MIG_B, { marcaj: false }))) || /garda start invalida/.test(await eroare(aplicaB(db, MIG_B, { marcaj: false }))), 'B fără marcaj = refuz')
  const t1 = blocAmprenta(MIG_B, '20270105b'), t2 = REV_B ? blocAmprenta(REV_B, '20270105b') : null
  ok(t1 && t1 === t2, `B: blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length})`)
  const k1 = constanteAmprenta(MIG_B, '20270105b'), k2 = REV_B ? constanteAmprenta(REV_B, '20270105b') : []
  ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `B: aceeași constantă AMPRENTA (${k1} / ${k2})`)
  const j = await aplicaLivrare(db, B, MIG_B, F(B).ob)
  const amp = j.find(m => /^AMPRENTA_20270105b_TEXT/.test(m))
  if (process.argv.includes('--amprente') || amp) console.log('     amprenta B calculată: ' + (await q1(db, `SELECT md5($1) AS m`, [amp ? amp.slice('AMPRENTA_20270105b_TEXT '.length) : ''])).m)
  ok(JSON.stringify((await q1(db, `SELECT public.fn_izo_porti_lipsa() AS v`)).v) === '[]', 'B: porțile verzi după')
  const ab = await verificaDry(db, DRY_B, BLOCURI_B)
  ok(ab.length === 0, 'dry-run B: toate blocurile ok' + (ab.length ? ': ' + ab.join(' | ') : ''))
  ok(/20270105b/.test(await eroare(revinoA(db))), 'revenirea A cu B aplicată = refuz (întâi revenirea B)')
  const POST_B = '-- ─── 4. Postcondiții'
  ok(MIG_B.indexOf(POST_B) > 0 && MIG_B.slice(MIG_B.indexOf(POST_B)).includes('AMPRENTA_20270105b_INCEPUT'), 'postcondițiile B (secțiunea 4) conțin amprenta (mutanții o ating)')
  const MUTANTI_B = [
    ['MP-ul fără ofertă declară configurarea completă', [[`  IF NOT v_oferta AND NOT (v_owner AND v_motiv IS NOT NULL) THEN`, `  IF false THEN`]]],
    ['owner-ul fără motiv acceptat', [[`  v_motiv := nullif(btrim(regexp_replace(coalesce(p_motiv, ''), '[[:space:]]+', ' ', 'g')), '');`, `  v_motiv := coalesce(nullif(btrim(regexp_replace(coalesce(p_motiv, ''), '[[:space:]]+', ' ', 'g')), ''), 'x');`]]],
    ['fără garda pe coloanele de configurare', [[`CREATE TRIGGER trg_rest_decontat_configurare_garda BEFORE INSERT OR UPDATE OF configurare_completa_la, configurare_exceptie_motiv ON public.executie_proiecte\n  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proiect_configurare_garda();`, '']]],
    // r2 (review #1158)
    ['garda poartei acceptă marcajul LIPSĂ (NULL într-o sesiune nouă)', [
      [`  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_executie_proiect_configurare_completa';`, `  v_rpc boolean := current_setting('gazpet.rest_decontat_scriitor', true) = 'fn_executie_proiect_configurare_completa';`],
      [`     AND (v_rpc OR v_server) IS NOT TRUE THEN\n    RAISE EXCEPTION 'configurare: starea`, `     AND NOT (v_rpc OR v_server) THEN\n    RAISE EXCEPTION 'configurare: starea`]]],
    ['garda doar pe UPDATE: un proiect nou se poate crea direct „configurat”', [[`CREATE TRIGGER trg_rest_decontat_configurare_garda BEFORE INSERT OR UPDATE OF`, `CREATE TRIGGER trg_rest_decontat_configurare_garda BEFORE UPDATE OF`]]],
  ]
  for (const [nume, lista] of MUTANTI_B) {
    await ruleazaMutant({ eticheta: 'mutantul B', nume, lista, textBaza: MIG_B, marcajPost: POST_B, pregateste: dbm => aplicaLivrare(dbm, A, MIG_A, F(A).ob), aplica: (dbm, t) => aplicaB(dbm, t), dry: DRY_B, blocuri: BLOCURI_B })
  }
  // revenirea B: refuz cu date (proiect configurat), apoi pe curat; reaplicare
  const sA = await stare(db)
  await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const c = await caRol(db, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_executie_proiect_configurare_completa(900, 'proba de revenire: exceptie owner') AS v`)
  ok(!c.err && c.rows[0].v.ok === true && c.rows[0].v.exceptie === false && c.rows[0].v.motiv === null, 'B: owner-ul declară configurarea completă pe proiectul moștenit (are ofertă → fără excepție, motivul ignorat): ' + JSON.stringify(c.rows?.[0]?.v || c.msg))
  ok(/proiecte configurate|jurnal/.test(await eroare(revinoB(db)) || ''), 'revenirea B cu proiecte configurate / jurnal = refuz')
  await db.exec(`DELETE FROM public.profiles WHERE id = 'f0000000-0000-4000-8000-00000000009a'`)
  const db3 = await bazaNoua()
  await aplicaLivrare(db3, A, MIG_A, F(A).ob)
  const sA3 = await stare(db3)
  await aplicaLivrare(db3, B, MIG_B, F(B).ob)
  ok(/garda invalida/.test(await eroare(revinoB(db3, REV_B, { marcaj: false }))), 'revenirea B fără marcaj = refuz')
  const jr = await revinoB(db3)
  ok(jr !== null && JSON.stringify(await stare(db3)) === JSON.stringify(sA3), 'revenirea B: catalogul identic cu starea de după A')
  await aplicaLivrare(db3, B, MIG_B, F(B).ob)
  ok((await verificaDry(db3, DRY_B, BLOCURI_B)).length === 0, 'reaplicarea B după revenire: dry-run B ok')
  void sA
}

if (!DOAR || DOAR === '6') {
  console.log('6. revenirea A')
  if (!DB) { DB = await bazaNoua(); await aplicaLivrare(DB, A, MIG_A, F(A).ob) }
  ok(/garda invalida/.test(await eroare(revinoA(DB, REV_A, { marcaj: false }))), 'revenirea A fără marcaj = refuz')
  // cu date confirmate: refuz, nimic schimbat
  await DB.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('f0000000-0000-4000-8000-00000000009a', true)`)
  const c = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_rest_decontat_confirma_baza(900, 'act_aditional', (SELECT id FROM public.executie_acte_aditionale WHERE proiect_id = 900 LIMIT 1), NULL, 'diferente', 'x', repeat('ab', 32), '[{"obiect_cod":"0001","deviz_cod":"D02","cod":"GC 01","denumire":"x","um":"M","cantitate":1,"valoare":80}]'::jsonb) AS v`)
  // r5: istoricul ofertei cu rânduri = refuz al revenirii (date scrise de calea nouă); proba pe o bază separată, cu istoricul scris de server
  {
    const dbh = await bazaNoua()
    await aplicaLivrare(dbh, A, MIG_A, F(A).ob)
    await dbh.exec(`INSERT INTO public.proiect_articole_istoric (rand_id, proiect_id, obiect_k, sursa, confirmat_la, rand, retras_de, motiv) VALUES (1, 900, '0001||', 'contract_initial', NULL, '{"id":1}'::jsonb, 'f0000000-0000-4000-8000-00000000009a', 'confirmare_oferta')`)
    const eh = await eroare(revinoA(dbh))
    ok(/istoricul ofertei|date scrise/.test(eh || ''), `revenirea A cu rânduri în istoricul ofertei = refuz: ${(eh || 'TRECE').slice(0, 120)}`)
    ok(Number((await q1(dbh, 'SELECT count(*)::int AS n FROM public.proiect_articole_istoric')).n) === 1 && (await q1(dbh, `SELECT to_regclass('public.fn_rest_decontat_drept') IS NOT NULL OR to_regprocedure('public.fn_rest_decontat_drept(bigint, text)') IS NOT NULL AS v`)).v === true, 'după refuz: istoricul și funcțiile au rămas')
  }
  if (c.err) {
    await DB.exec(`INSERT INTO public.executie_acte_aditionale (proiect_id, numar_act) VALUES (900, 'AA-R')`)
  }
  const c2 = await caRol(DB, 'authenticated', 'f0000000-0000-4000-8000-00000000009a', `SELECT public.fn_rest_decontat_confirma_baza(900, 'act_aditional', (SELECT id FROM public.executie_acte_aditionale WHERE proiect_id = 900 ORDER BY id LIMIT 1), NULL, 'diferente', 'x', repeat('ab', 32), '[{"obiect_cod":"0001","deviz_cod":"D02","cod":"GC 01","denumire":"x","um":"M","cantitate":1,"valoare":80}]'::jsonb) AS v`)
  ok(!c2.err && c2.rows[0].v.inserate === 1, 'un deviz AA confirmat pe proiectul moștenit (date noi): ' + (c2.msg || 'ok'))
  const e1 = await eroare(revinoA(DB))
  ok(/randuri confirmate|date scrise/.test(e1 || ''), `revenirea A cu rânduri confirmate = refuz: ${(e1 || 'TRECE').slice(0, 120)}`)
  ok(Number((await q1(DB, 'SELECT count(*)::int AS n FROM public.proiect_articole WHERE confirmat_la IS NOT NULL')).n) === 1, 'după refuz: rândul confirmat a rămas')
  // bază curată: aplicare → revenire → reaplicare
  const db = await bazaNoua()
  const s0 = await stare(db), m0 = await randuriMostenite(db)
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(/starea nu e cea din 20270105a/.test(await eroare(revinoA(await bazaNoua()))), 'revenirea pe o bază fără migrare = refuz al gărzii (nu eroare de cast)')
  await db.exec('CREATE INDEX x_rd ON public.executie_sl_detaliu (nr_situatie)')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revinoA(db)) || ''), 'un index în plus pe un tabel nou = refuz al revenirii')
  await db.exec('DROP INDEX public.x_rd')
  await db.exec('CREATE INDEX x_rdh ON public.proiect_articole_istoric (retras_la)')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revinoA(db)) || ''), 'un index în plus pe istoricul ofertei = refuz al revenirii (istoricul e în amprentă)')
  await db.exec('DROP INDEX public.x_rdh')
  await db.exec('GRANT EXECUTE ON FUNCTION public.fn_rest_decontat_drept(bigint, text) TO anon')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revinoA(db)) || ''), 'drepturile unei funcții schimbate = refuz al revenirii')
  await db.exec('REVOKE EXECUTE ON FUNCTION public.fn_rest_decontat_drept(bigint, text) FROM anon')
  const jr = await revinoA(db)
  ok(jr !== null && JSON.stringify(await stare(db)) === JSON.stringify(s0), 'revenirea A: catalogul identic cu starea de dinainte (tabele, coloane, constrângeri, triggere, politici, funcții, ștampile)')
  ok(JSON.stringify(await randuriMostenite(db)) === JSON.stringify(m0), 'revenirea A: rândurile moștenite neatinse')
  ok(JSON.stringify((await q1(db, `SELECT public.fn_izo_porti_lipsa() AS v`)).v) === '[]', 'revenirea A: porțile verzi (ștampilele recalculate)')
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok((await verificaDry(db, DRY_A, BLOCURI_A)).length === 0, 'reaplicarea A după revenire: dry-run A ok')
}

// oferta SINTETICĂ „ca proiectul 4” (284 rânduri, calea veche): 4 obiecte × 3 devize; în fiecare deviz codurile se repetă (nr intră în cheie). r6: codurile
// obiectelor au litere mici și spații ('Ob 1'), UM-urile includ factori ('100 MC' = 100 × MC, 'HM' = 100 × M); valorile așteptate se calculează AICI, din
// aceste date, nu din codul testat (L25)
const OB = ['Ob 1', 'Ob 2', 'Ob 3', 'Ob 4']
const OBK = OB.map(o => o.toUpperCase() + '||')   // identitatea canonică a obiectului (fn_rest_decontat_cheie(obiect, NULL, NULL, NULL))
const FACTOR = { M: 1, '100 MC': 100, BUC: 1, KG: 1, HM: 100 }
const rotund = x => Math.round(x * 1e6) / 1e6
function ofertaSintetica() {
  const obiecte = [[OB[0], 'TRONSON 1'], [OB[1], 'TRONSON 2'], [OB[2], 'STATIE ROBINETE'], [OB[3], 'ORGANIZARE DE SANTIER']]
  const devize = [['D01', 'Terasamente'], ['D02', 'Montaj conducta'], ['D03', 'Protectii si probe']]
  const coduri = ['TSA01A1', 'TSA02B1', 'TSC17B1', 'TSD01C1', 'GC 01', 'GC 02 A', 'IZ 05', 'RPCT 11', 'M1L05', 'SUD 300', 'TF 01', 'CZ 01']
  const umuri = ['M', '100 MC', 'BUC', 'KG', 'HM']
  const L = []
  let i = 0
  for (let c = 0; c < 12; c++) {
    const [ob, obn] = obiecte[c % 4], [dz, dzn] = devize[Math.floor(c / 4)]
    const n = c < 8 ? 24 : 23   // 8 × 24 + 4 × 23 = 284
    for (let j = 0; j < n; j++, i++) {
      const cant = (i % 97) + 1 + (i % 3) * 0.5, pret = (i % 13) * 10 + 5
      L.push({ obiect_cod: ob, obiect_nume: obn, deviz_cod: dz, deviz_nume: dzn, nr: String(j + 1), cod: coduri[j % 12], denumire: `Articol sintetic ${i + 1}`,
        um: umuri[i % 5], cantitate: cant, pret_unitar: pret, valoare: Math.round(cant * pret * 100) / 100 })
    }
  }
  return L
}
const cheieAsteptata = (l, repetat) => `${l.obiect_cod.toUpperCase()}|${l.deviz_cod}|${l.cod.toUpperCase()}` + (repetat ? `|#${l.nr}` : '')
const repetatIn = L => { const grup = new Map(); for (const l of L) { const k = `${l.obiect_cod}|${l.deviz_cod}|${l.cod}`; grup.set(k, (grup.get(k) || 0) + 1) }; return l => grup.get(`${l.obiect_cod}|${l.deviz_cod}|${l.cod}`) > 1 }
// baza așteptată: cantitatea în UM-ul NORMALIZAT (raw × factor), valoarea neschimbată
const asteptatBaza = L => {
  const rep = repetatIn(L)
  return L.map(l => ({ cheie: cheieAsteptata(l, rep(l)), c: String(rotund(l.cantitate * FACTOR[l.um])), v: String(l.valoare), randuri: 1 }))
    .sort((a, b) => (a.cheie < b.cheie ? -1 : a.cheie > b.cheie ? 1 : 0))
}
const suma = xs => String(Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100)
// CITITORII VECHI ai proiect_articole (r5, review #1158 P1 r4), cu filtrele EXACTE din cod, pe proiectul 904, grupate pe obiect (ca să se vadă și
// obiectele neimportate): ActivitatiProiectPanel.jsx:53 / lib/verificariProiect.js:67 (sursa <> 'extras_materiale'; cod, cantitate), CatalogDevizPanel.jsx:37
// (select('*') pe proiect, apoi activ !== false în JS), 20261208a fn_executie_tinte_calcul (predicatul JOIN luat VERBATIM din textul migrării, cu v_p = 904,
// unitățile u cu obiect_cod BRUT ca în proiect_unitati și prefixele a ca în calcul; r6: cantitatea CONVERTITĂ în UM-ul activității — în 20261208a
// fn_executie_tinte_conversie(art.um, a.um), aici factorul spre unitatea de bază din fn_rest_decontat_um, lista UM fiind identică (§0) —, nu cea brută),
// DevizVsExecutatTab.jsx:222 (id, obiect_cod, obiect_nume cu obiect_cod nenul → obiectele distincte), MaterialeProiectPanel.jsx:29 (sursa = 'extras_materiale'),
// 20270105b (contract_initial AND activ), fn_rest_decontat_are_oferta.
// Rezultatul fiecăruia e un text; textele se compară înainte / după confirmare și cu valorile așteptate calculate din L (L25).
const M1208 = citeste('supabase/migrations/20261208a_executie_devize_tinte.sql')
const predicatTinte = (() => {
  const i = M1208.indexOf('JOIN public.proiect_articole art ON ')
  const j = M1208.indexOf('CROSS JOIN LATERAL', i)
  if (i < 0 || j < 0) return null
  return M1208.slice(i + 'JOIN public.proiect_articole art ON '.length, j).replace(/\s+/g, ' ').trim().split('v_p').join('904')
})()
const PREFIXE = ['TSA', 'TSC', 'TSD', 'GC', 'IZ', 'RPCT', 'M1L05', 'SUD', 'TF', 'CZ']
const CITITORI = {
  activitati: `SELECT obiect_cod AS k, count(*)::int AS n, coalesce(sum(cantitate), 0)::float8::text AS s FROM (SELECT cod, um, cantitate, sursa, obiect_cod FROM public.proiect_articole WHERE proiect_id = 904 AND sursa <> 'extras_materiale') x GROUP BY 1 ORDER BY 1`,
  catalog: `SELECT obiect_cod AS k, count(*)::int AS n, coalesce(sum(valoare), 0)::float8::text AS s FROM (SELECT * FROM public.proiect_articole WHERE proiect_id = 904 ORDER BY obiect_cod, deviz_cod, nr) x WHERE x.activ IS DISTINCT FROM false GROUP BY 1 ORDER BY 1`,
  tinte: predicatTinte && `WITH u(obiect_cod) AS (VALUES ${OB.map(o => `('${o}')`).join(', ')}),
       a(baza_deviz, prefixe) AS (VALUES ('initiala', ARRAY[${PREFIXE.map(p => `'${p}'`).join(', ')}]), ('revizuita', ARRAY['TSA', 'GC']))
     SELECT u.obiect_cod || '/' || a.baza_deviz AS k, count(*)::int AS n, coalesce(sum(art.cantitate::numeric * cv.f), 0)::float8::text AS s
       FROM u JOIN a ON true JOIN public.proiect_articole art ON ${predicatTinte}
       CROSS JOIN LATERAL (SELECT x.factor AS f FROM public.fn_rest_decontat_um(art.um) x) cv GROUP BY 1 ORDER BY 1`,
  obiecte: `SELECT 'toate' AS k, count(DISTINCT obiect_cod)::int AS n, string_agg(DISTINCT obiect_cod, ',') AS s FROM (SELECT id, obiect_cod, obiect_nume FROM public.proiect_articole WHERE proiect_id = 904 AND obiect_cod IS NOT NULL ORDER BY id) x`,
  materiale: `SELECT 'extras' AS k, count(*)::int AS n, coalesce(sum(cantitate), 0)::float8::text AS s FROM (SELECT * FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'extras_materiale' ORDER BY nr) x`,
  configurare: `SELECT 'contract_initial activ' AS k, count(*)::int AS n, '-' AS s FROM public.proiect_articole a WHERE a.proiect_id::bigint = 904 AND a.sursa = 'contract_initial' AND a.activ`,
  are_oferta: `SELECT 'are_oferta' AS k, CASE WHEN public.fn_rest_decontat_are_oferta(904) THEN 1 ELSE 0 END AS n, '-' AS s`,
}
async function cititori(db, uid) {
  const r = {}
  for (const [nume, sql] of Object.entries(CITITORI)) {
    if (!sql) { r[nume] = 'PREDICAT 20261208a NEGASIT'; continue }
    const x = await caRol(db, 'authenticated', uid, sql)
    r[nume] = x.err ? `EROARE ${x.err} ${x.msg}` : x.rows.map(y => `${y.k}=${y.n}/${y.s}`).join('; ')
  }
  return r
}
const asteptatCititori = (L, extras) => {
  const ob = [...new Set(L.map(l => l.obiect_cod))].sort()
  const pe = f => ob.map(o => `${o}=${L.filter(l => l.obiect_cod === o).length}/${suma(L.filter(l => l.obiect_cod === o).map(f))}`).join('; ')
  const cuPrefix = (o, px) => L.filter(l => l.obiect_cod === o && px.some(p => l.cod.toUpperCase().startsWith(p)))
  return {
    activitati: pe(l => l.cantitate),
    catalog: pe(l => l.valoare) + `; null=${extras.length}/0`,   // rândurile extras_materiale (obiect_cod NULL) sunt și ele în catalogul vechi
    tinte: ob.flatMap(o => [['initiala', PREFIXE], ['revizuita', ['TSA', 'GC']]].map(([b, px]) => `${o}/${b}=${cuPrefix(o, px).length}/${suma(cuPrefix(o, px).map(l => l.cantitate * FACTOR[l.um]))}`)).join('; '),
    obiecte: `toate=${ob.length}/${ob.join(',')}`,
    materiale: `extras=${extras.length}/${suma(extras.map(e => e.cantitate))}`,
    configurare: `contract_initial activ=${L.length}/-`,
    are_oferta: 'are_oferta=1/-',
  }
}
const liniiRpc = L => L.map(({ obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare }) => ({ obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare }))
// r6: aceleași linii în ALTĂ reprezentare, ECHIVALENTĂ (identitatea canonică a obiectului și UM-ul normalizat identice): obiectul cu spații și litere mici,
// UM-ul cu alt factor (cantitatea × f, prețul / f, valoarea aceeași) — fișierul F3 „real” poate veni oricum; RPC-ul trebuie să scrie reprezentarea existentă
const ECHIV = { M: ['ML', 1], '100 MC': ['MC', 100], BUC: ['buc', 1], KG: ['T', 1 / 1000], HM: ['M', 100] }
const liniiEchivalente = L => liniiRpc(L).map(l => { const [um, f] = ECHIV[l.um]; return { ...l, obiect_cod: ' ' + l.obiect_cod.toLowerCase() + ' ', um, cantitate: rotund(l.cantitate * f), pret_unitar: rotund(l.pret_unitar / f) } })
const EXTRAS = [{ nr: '1', cod: 'TEAVA-DN300', denumire: 'Teava DN300', um: 'M', cantitate: 1100 }, { nr: '2', cod: 'ROBINET-DN300', denumire: 'Robinet DN300', um: 'BUC', cantitate: 4 }, { nr: '3', cod: 'FLANSA-DN300', denumire: 'Flansa DN300', um: 'BUC', cantitate: 8 }]
async function proiectSintetic(db, L) {
  await db.exec(`INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES (904, 'CLONA-P4', 'Proiect ca proiectul 4 (284 randuri contract_initial pe calea veche)')`)
  await db.query(`INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, pret_unitar, sursa)
    SELECT 904, x.obiect_cod, x.obiect_nume, x.deviz_cod, x.deviz_nume, x.nr, x.cod, x.denumire, x.um, x.cantitate, x.valoare, x.pret_unitar, 'contract_initial'
      FROM jsonb_to_recordset($1::jsonb) AS x(obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text, cantitate numeric, valoare numeric, pret_unitar numeric)`, [JSON.stringify(L)])
  await db.query(`INSERT INTO public.proiect_articole (proiect_id, nr, cod, denumire, um, cantitate, valoare, sursa)
    SELECT 904, x.nr, x.cod, x.denumire, x.um, x.cantitate, 0, 'extras_materiale' FROM jsonb_to_recordset($1::jsonb) AS x(nr text, cod text, denumire text, um text, cantitate numeric)`, [JSON.stringify(EXTRAS)])
}
if (!DOAR || DOAR === '7') {
  console.log('7. trecerea (a) -> (b) pe un proiect ca proiectul 4 (284 rânduri contract_initial pe calea veche, 4 obiecte): import parțial, obiectele neimportate neatinse, cititorii vechi neschimbați, fără dublare; r6: reprezentarea existentă, UM-ul la înlocuire, fișierul înlocuit')
  const db = await bazaNoua()
  const L = ofertaSintetica()
  const ast = asteptatBaza(L)
  const cuNr = ast.filter(x => x.cheie.includes('|#')).length
  const total = Math.round(L.reduce((s, l) => s + l.valoare, 0) * 100) / 100
  const L1 = L.filter(l => l.obiect_cod === OB[0]), LREST = L.filter(l => l.obiect_cod !== OB[0])
  const cuFactor = L.filter(l => FACTOR[l.um] !== 1).length
  ok(L.length === 284 && new Set(ast.map(x => x.cheie)).size === 284 && L1.length === 71 && LREST.length === 213 && cuFactor > 100, `oferta sintetică: 284 rânduri, 284 chei distincte (${cuNr} cu nr în cheie), valoare ${total}, ${cuFactor} rânduri cu UM cu factor (100 MC / HM), obiecte cu litere mici și spații; obiectul ${OB[0]} = 71 linii, restul 213`)
  ok(!!predicatTinte && /art\.sursa = 'contract_initial'/.test(predicatTinte) && /art\.obiect_cod = u\.obiect_cod/.test(predicatTinte), `predicatul cititorului 20261208a luat din textul migrării (JOIN pe obiect_cod brut): ${(predicatTinte || 'NEGASIT').slice(0, 120)}…`)
  await proiectSintetic(db, L)
  const j = await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(j.some(m => new RegExp(`^20270105a: randuri proiect_articole cu cheie = 292, din care cu nr in cheie = ${cuNr + 2}$`).test(m)), `NOTICE: 292 rânduri cu cheie (5 moștenite + 284 + 3 extras), ${cuNr + 2} cu nr în cheie`)
  const OWNER = 'f0000000-0000-4000-8000-00000000009a'
  await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER}', true)`)
  const SQL_BAZA = `SELECT cheie, cantitate::float8::text AS c, valoare::float8::text AS v, randuri FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 904 ORDER BY cheie COLLATE "C"`
  const SQL_SUMA = `SELECT coalesce(sum(valoare), 0)::float8::text AS s, count(*)::int AS n FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 904`
  // r6: REPREZENTAREA rândurilor ofertei (obiect_cod, UM brut, cantitate, preț, valoare — exact ce văd cititorii vechi), ca amprentă; trebuie identică
  // înainte / după confirmări cu linii echivalente, deși liniile RPC vin cu ' ob 1 ', 'MC' × 100, 'T' / 1000, 'ML', 'buc'
  const SQL_REP = `SELECT md5(string_agg(concat_ws('|', obiect_cod, deviz_cod, nr, cod, um, cantitate::float8::text, pret_unitar::float8::text, valoare::float8::text), ';' ORDER BY obiect_cod, deviz_cod, nr::int, cod)) AS h,
    count(*) FILTER (WHERE obiect_cod NOT IN (${OB.map(o => `'${o}'`).join(', ')}) OR um NOT IN ('M', '100 MC', 'BUC', 'KG', 'HM'))::int AS straine
    FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'contract_initial'`
  const rep = async () => q1(db, SQL_REP)
  const numar = async () => q1(db, `SELECT count(*) FILTER (WHERE activ AND confirmat_la IS NULL)::int AS vechi_active, count(*) FILTER (WHERE NOT activ)::int AS retrase,
    count(*) FILTER (WHERE activ AND confirmat_la IS NOT NULL)::int AS confirmate, (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = 904)::int AS istoric
    FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  const lipsuriOferta = async () => (await caRol(db, 'authenticated', OWNER, `SELECT tip || '=' || referinta AS x FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = 904 AND tip IN ('fara_oferta', 'oferta_neconfirmata', 'oferta_veche_neconfirmata') ORDER BY 1`)).rows.map(r => r.x).join('; ')
  const b0 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b0.err && JSON.stringify(b0.rows) === JSON.stringify(ast), 'baza înainte (toate obiectele vechi) = cele 284 rânduri, cantitatea în UM-ul normalizat (× factor), cheia cu nr pe codurile repetate: ' + (b0.msg || `${b0.rows.length} chei`))
  const s0 = await caRol(db, 'authenticated', OWNER, SQL_SUMA)
  ok(!s0.err && Number(s0.rows[0].s) === total && s0.rows[0].n === 284, `valoarea bazei înainte = ${total} (284 chei): ${JSON.stringify(s0.rows?.[0] || s0.msg)}`)
  ok((await lipsuriOferta()) === OB.map(o => `oferta_neconfirmata=obiect ${o}: contract_initial 71`).join('; '), 'lipsuri înainte: cele 4 obiecte vechi declarate oferta_neconfirmata (71 rânduri fiecare, obiectul brut): ' + (await lipsuriOferta()))
  // cititorii vechi ÎNAINTE: fiecare = valorile așteptate calculate din L (L25)
  const AST_CIT = asteptatCititori(L, EXTRAS)
  const c0 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c0[k] === AST_CIT[k], `cititorul vechi „${k}” înainte = așteptat din date: ${c0[k].slice(0, 150)}${c0[k] === AST_CIT[k] ? '' : ' ≠ ' + AST_CIT[k].slice(0, 150)}`)
  const rep0 = await rep()
  ok(rep0.straine === 0 && /^[0-9a-f]{32}$/.test(rep0.h || ''), `reprezentarea rândurilor înainte înregistrată (md5 ${rep0.h}), 0 rânduri cu obiect / UM străin`)
  // calea veche încă merge (toate obiectele vechi): un rând în plus, apoi șters
  const i1 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '${OB[0]}', 'D01', '99', 'PROBA', 'rand vechi in plus', 'M', 1, 10, 'contract_initial') RETURNING id`)
  const d1 = i1.err ? i1 : await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND cod = 'PROBA'`)
  ok(!i1.err && !d1.err && JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 284, retrase: 0, confirmate: 0, istoric: 0 }), 'calea veche merge încă pe obiectele vechi: INSERT + DELETE direct, 284 rânduri vechi active: ' + (i1.msg || d1.msg || 'ok'))
  // IMPORT PARȚIAL: doar obiectul Ob 1 (71 linii, ECHIVALENTE cu cele vechi, în altă reprezentare), ca fișierul F3 al unui singur obiect
  const c = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(L1))])
  const v1 = c.rows?.[0]?.v || {}
  ok(!c.err && v1.inserate === 71 && v1.inlocuite === 71 && v1.inlocuite_confirmate === 0 && JSON.stringify(v1.obiecte) === JSON.stringify([OBK[0]]) && JSON.stringify(v1.um_schimbate) === '[]', `import parțial ${OB[0]} prin RPC (linii echivalente): inserate 71, inlocuite 71 (mutate în istoric), 0 confirmate înlocuite, obiecte ["${OBK[0]}"], um_schimbate []: ` + (c.msg || JSON.stringify({ inserate: v1.inserate, inlocuite: v1.inlocuite, inlocuite_confirmate: v1.inlocuite_confirmate, obiecte: v1.obiecte, um_schimbate: v1.um_schimbate })))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 213, retrase: 0, confirmate: 71, istoric: 71 }), 'după importul parțial: 71 confirmate + 213 vechi active (Ob 2–Ob 4 NEATINSE), 0 retrase în tabel, 71 în istoric: ' + JSON.stringify(await numar()))
  const b1 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b1.err && JSON.stringify(b1.rows) === JSON.stringify(ast), `baza după importul parțial IDENTICĂ (${OB[0]} confirmat + restul cu valoarea veche): ` + (b1.msg || `${b1.rows.length} chei`))
  ok((await lipsuriOferta()) === OB.slice(1).map(o => `oferta_neconfirmata=obiect ${o}: contract_initial 71`).join('; '), `lipsuri după importul parțial: obiectele ${OB.slice(1).join(', ')} încă vechi declarate, ${OB[0]} nu: ` + (await lipsuriOferta()))
  const c1 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c1[k] === c0[k], `cititorul vechi „${k}” după importul parțial = înainte (${OB[0]}: rândurile confirmate în reprezentarea existentă; restul: neatinse): ${c1[k].slice(0, 150)}${c1[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  const rep1 = await rep()
  ok(rep1.h === rep0.h && rep1.straine === 0, `reprezentarea rândurilor după importul parțial IDENTICĂ octet cu octet (obiect_cod '${OB[0]}', UM-urile brute, cantitățile și prețurile convertite înapoi): ${rep1.h}, străine ${rep1.straine}`)
  // calea veche pe un obiect NEIMPORTAT merge încă; pe Ob 1 e închisă
  const i2 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '${OB[1]}', 'D01', '99', 'PROBA2', 'rand vechi pe obiect vechi', 'M', 1, 10, 'contract_initial') RETURNING id`)
  const d2 = i2.err ? i2 : await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND cod = 'PROBA2'`)
  ok(!i2.err && !d2.err, `calea veche merge pe obiectul neimportat ${OB[1]} după confirmarea lui ${OB[0]} (INSERT + DELETE): ` + (i2.msg || d2.msg || 'ok'))
  const i3 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, ' ob 1', 'D01', '1', 'TSA01A1', 'Articol sintetic 1', 'M', 1, 5, 'contract_initial')`)
  ok(i3.err === '42501' && /obiectul  ob 1 al proiectului 904 are oferta confirmata.*Rest de decontat/.test(i3.msg || ''), `calea veche pe obiectul confirmat ${OB[0]} (scris ' ob 1', identitate canonică): refuz 42501 cu mesajul „Rest de decontat”: ` + (i3.msg || 'TRECE'))
  // confirmarea restului (Ob 2–Ob 4, 213 linii echivalente) FĂRĂ „înlocuiește”: trece (nu 23505)
  const c2 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_rest.xlsx', repeat('45', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(LREST))])
  const v2 = c2.rows?.[0]?.v || {}
  ok(!c2.err && v2.inserate === 213 && v2.inlocuite === 213 && v2.inlocuite_confirmate === 0 && JSON.stringify(v2.obiecte) === JSON.stringify(OBK.slice(1)), `confirmarea târzie a obiectelor ${OB.slice(1).join(', ')} (fără inlocuieste): inserate 213, inlocuite 213: ` + (c2.msg || JSON.stringify({ inserate: v2.inserate, inlocuite: v2.inlocuite, obiecte: v2.obiecte })))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 284 }), '284 rânduri confirmate active, 0 vechi, 0 retrase în tabel, 284 în istoric: ' + JSON.stringify(await numar()))
  const b2 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b2.err && JSON.stringify(b2.rows) === JSON.stringify(ast), 'baza după confirmarea completă IDENTICĂ cu cea dinainte (284 chei, câte 1 rând, aceleași cantități normalizate): fără dublare: ' + (b2.msg || `${b2.rows.length} chei`))
  const s2 = await caRol(db, 'authenticated', OWNER, SQL_SUMA)
  ok(!s2.err && Number(s2.rows[0].s) === total && s2.rows[0].n === 284, `valoarea bazei după confirmare = ${total} (nu ${total * 2}): ${JSON.stringify(s2.rows?.[0] || s2.msg)}`)
  ok((await lipsuriOferta()) === '', 'fără lipsuri de ofertă după confirmarea completă: ' + ((await lipsuriOferta()) || 'niciuna'))
  const c2c = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c2c[k] === c0[k], `cititorul vechi „${k}” după confirmarea completă = înainte (284 → 284, aceleași valori): ${c2c[k].slice(0, 150)}${c2c[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  const rep2 = await rep()
  ok(rep2.h === rep0.h && rep2.straine === 0, `reprezentarea rândurilor după confirmarea completă IDENTICĂ octet cu octet: ${rep2.h}`)
  // re-importul lui Ob 1: fără „înlocuiește” = 23505; cu „înlocuiește” (aceleași linii echivalente, alt fișier) = 71 confirmate înlocuite, cititorii tot identici
  const r1 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1_v2.xlsx', repeat('46', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(L1))])
  ok(r1.err === '23505' && new RegExp(`obiectele ${OBK[0].replace(/\|/g, '\\|')}.*inlocuieste`).test(r1.msg || ''), `re-importul obiectului confirmat ${OB[0]} fără inlocuieste: refuz 23505: ` + (r1.msg || 'TRECE'))
  const r2 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1_v2.xlsx', repeat('46', 32), $1::jsonb, true) AS v`, [JSON.stringify(liniiEchivalente(L1))])
  const v3 = r2.rows?.[0]?.v || {}
  ok(!r2.err && v3.inserate === 71 && v3.inlocuite === 71 && v3.inlocuite_confirmate === 71, `re-importul lui ${OB[0]} cu inlocuieste: inserate 71, inlocuite 71, toate confirmate înlocuite: ` + (r2.msg || JSON.stringify(v3)))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 355 }), 'după înlocuire: 284 confirmate, 0 retrase în tabel, 355 în istoric (284 vechi + 71 confirmate înlocuite): ' + JSON.stringify(await numar()))
  const h = await q1(db, `SELECT count(*) FILTER (WHERE motiv = 'inlocuire_oferta' AND confirmat_la IS NOT NULL AND obiect_k = $1 AND inlocuit_cu_amprenta = repeat('46', 32))::int AS inl, count(*) FILTER (WHERE motiv = 'confirmare_oferta' AND confirmat_la IS NULL)::int AS conf, count(DISTINCT obiect_k)::int AS ob FROM public.proiect_articole_istoric WHERE proiect_id = 904`, [OBK[0]])
  ok(h.inl === 71 && h.conf === 284 && h.ob === 4, `istoricul: 71 rânduri confirmate înlocuite (motiv inlocuire_oferta, amprenta fișierului nou) + 284 vechi (confirmare_oferta), 4 obiecte: ${JSON.stringify(h)}`)
  const c3 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c3[k] === c0[k], `cititorul vechi „${k}” după înlocuire = înainte: ${c3[k].slice(0, 150)}${c3[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  const b3 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b3.err && JSON.stringify(b3.rows) === JSON.stringify(ast), 'baza după înlocuire IDENTICĂ: ' + (b3.msg || `${b3.rows.length} chei`))
  const rep3 = await rep()
  ok(rep3.h === rep0.h && rep3.straine === 0, `reprezentarea rândurilor după înlocuire IDENTICĂ octet cu octet: ${rep3.h}`)
  // r6 (P2): fișierul 44 (prima confirmare a lui Ob 1) a fost înlocuit de 46 — rândurile lui sunt doar în istoric —, dar rămâne „deja confirmat”: A → B → A = 23505
  const r44 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb, true) AS v`, [JSON.stringify(liniiEchivalente(L1))])
  ok(r44.err === '23505' && /acelasi fisier/.test(r44.msg || '') && JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 355 }), 'fișierul înlocuit (44, rămas doar în istoric) reconfirmat cu inlocuieste: refuz 23505 „acelasi fisier”, nimic scris (A → B → A): ' + (r44.msg || 'TRECE'))
  // r6 (P1 r5): UM-ul la înlocuire. O situație decontează K1 (Ob 1, în M) 0.5 M; apoi: Ob 1 cu K1 în „100 MC” = 22023 um_decontat (și cu accept_schimbare_um);
  // K2 (Ob 1, „100 MC”, fără decontat) în BUC fără accept = 22023 um_schimbat; cu accept trece, um_schimbate = [K2], baza K2 = 2.5 BUC (cum vine)
  const repL1 = repetatIn(L1), K1 = cheieAsteptata(L1[0], repL1(L1[0])), K2 = cheieAsteptata(L1[1], repL1(L1[1]))
  ok(L1[0].um === 'M' && L1[1].um === '100 MC' && L1[1].cantitate === 2.5, `cheile probei UM: K1 ${K1} în M (${L1[0].cantitate}), K2 ${K2} în „100 MC” (${L1[1].cantitate})`)
  const sl = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_situatie(904, '1', NULL, 'sl1.xlsx', repeat('47', 32), $1::jsonb, false) AS v`,
    [JSON.stringify([{ cheie: K1, tip_rand: 'articol', potrivire: 'exact', um: 'M', cantitate_perioada: 0.5, valoare: 2.5 }])])
  ok(!sl.err && sl.rows[0].v.inserate === 1, `situația 1 decontează K1 cu 0.5 M: ` + (sl.msg || 'ok'))
  const lMC = liniiRpc(L1).map((l, i) => i === 0 ? { ...l, um: '100 MC' } : l), lBUC = liniiRpc(L1).map((l, i) => i === 1 ? { ...l, um: 'BUC' } : l)
  const u1 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_ob1_mc.xlsx', repeat('48', 32), $1::jsonb, true) AS v`, [JSON.stringify(lMC)])
  ok(u1.err === '22023' && new RegExp(`${K1.replace(/[|#]/g, '\\$&')}.*decontate in UM M.*UM nou MC.*um_decontat`).test(u1.msg || ''), `înlocuirea lui ${OB[0]} cu K1 în „100 MC” după decontare în M: refuz 22023 um_decontat (cheia, UM vechi, UM nou): ` + (u1.msg || 'TRECE'))
  const u1b = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_ob1_mc.xlsx', repeat('48', 32), $1::jsonb, true) AS v`, [JSON.stringify({ accept_schimbare_um: true, linii: lMC })])
  ok(u1b.err === '22023' && /um_decontat/.test(u1b.msg || ''), 'la fel cu accept_schimbare_um (acceptarea nu trece peste decontat): ' + (u1b.msg || 'TRECE'))
  const u2 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_ob1_buc.xlsx', repeat('49', 32), $1::jsonb, true) AS v`, [JSON.stringify(lBUC)])
  ok(u2.err === '22023' && new RegExp(`${K2.replace(/[|#]/g, '\\$&')}.*UM MC.*UM BUC.*um_schimbat`).test(u2.msg || ''), `K2 („100 MC”, fără decontat) în BUC fără accept_schimbare_um: refuz 22023 um_schimbat: ` + (u2.msg || 'TRECE'))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 355 }) && (await rep()).h === rep0.h, 'refuzurile UM n-au scris nimic (rânduri, istoric, reprezentare identice)')
  const u3 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_ob1_buc.xlsx', repeat('49', 32), $1::jsonb, true) AS v`, [JSON.stringify({ accept_schimbare_um: true, linii: lBUC })])
  const v4 = u3.rows?.[0]?.v || {}
  ok(!u3.err && v4.inserate === 71 && v4.inlocuite_confirmate === 71 && JSON.stringify(v4.um_schimbate) === JSON.stringify([K2]), `K2 în BUC cu accept_schimbare_um: trece, um_schimbate = [K2]: ` + (u3.msg || JSON.stringify({ inserate: v4.inserate, um_schimbate: v4.um_schimbate })))
  const bk2 = await caRol(db, 'authenticated', OWNER, `SELECT cantitate::float8::text AS c, um FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 904 AND cheie = $1`, [K2])
  ok(!bk2.err && JSON.stringify(bk2.rows) === JSON.stringify([{ c: '2.5', um: 'BUC' }]), 'baza K2 după schimbarea acceptată = 2.5 BUC (scrisă cum vine, nu în UM-ul vechi): ' + JSON.stringify(bk2.rows || bk2.msg))
  const astBuc = ast.map(x => x.cheie === K2 ? { ...x, c: String(L1[1].cantitate) } : x)
  const bK = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!bK.err && JSON.stringify(bK.rows) === JSON.stringify(astBuc), 'baza după schimbarea acceptată: doar K2 diferă (2.5 BUC în loc de 250 MC), restul identic')
  // reimportul vechi (ca CatalogDevizPanel: DELETE pe toată oferta, apoi INSERT) = refuz cu mesajul clar; baza și rândurile neschimbate
  const rd = await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  ok(rd.err === '42501', 'reimportul vechi după confirmare, pasul DELETE: refuz 42501: ' + (rd.msg || 'TRECE'))
  const ri = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '${OB[2]}', 'D01', '1', 'TSA01A1', 'Articol sintetic', 'M', 1, 5, 'contract_initial')`)
  ok(ri.err === '42501' && new RegExp(`obiectul ${OB[2]} al proiectului 904 are oferta confirmata.*Rest de decontat`).test(ri.msg || ''), 'reimportul vechi după confirmare, pasul INSERT (obiect confirmat târziu): refuz 42501 cu mesajul „Rest de decontat”: ' + (ri.msg || 'TRECE'))
  const ru = await caRol(db, 'authenticated', OWNER, `UPDATE public.proiect_articole SET cantitate = cantitate + 1 WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  ok(ru.err === '42501', 'modificarea directă a rândurilor confirmate: refuz 42501: ' + (ru.msg || 'TRECE'))
  const b4 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b4.err && JSON.stringify(b4.rows) === JSON.stringify(astBuc) && JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 426 }), 'după refuzuri: baza și rândurile neschimbate (284 confirmate, 426 în istoric)')
  const eRev = await eroare(revinoA(db))
  ok(/randuri confirmate|date scrise|istoricul ofertei|situatii detaliate confirmate/.test(eRev || ''), 'revenirea A pe proiectul confirmat = refuz (date scrise de calea nouă: situația, rândurile confirmate, istoricul): ' + (eRev || 'TRECE').slice(0, 120))
  // MUTANTUL COMPORTAMENTAL (reproducerea P1 r4): rândurile înlocuite rămân în proiect_articole cu activ = false (textul RPC-ului r4) → cititorii vechi
  // văd 355 (284 + 71) după importul parțial; migrarea mutantă se aplică fără postcondiții (amprenta ar refuza-o) pe o bază nouă cu aceleași 284 rânduri
  {
    const POST_A = '-- ─── 12. Postcondiții'
    let tm = null
    try {
      tm = mutant(MIG_A, [[`    WITH mut AS (\n      DELETE FROM public.proiect_articole a\n       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`,
        `    WITH mut AS (\n      UPDATE public.proiect_articole a SET activ = false\n       WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.activ\n         AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)\n       RETURNING a.*),`],
        [`    IF EXISTS (SELECT 1 FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial'\n                 AND public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL) = ANY (v_obiecte)) THEN`, `    IF false THEN`]])
    } catch (e) { ok(false, 'mutantul comportamental „rândurile retrase rămân în tabel”: ' + e.message) }
    if (tm) {
      const dbm = await bazaNoua()
      await proiectSintetic(dbm, L)
      const eA = await eroare(aplicaA(dbm, tm.slice(0, tm.indexOf(POST_A))))
      await dbm.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER}', true)`)
      const cm0 = eA ? null : await cititori(dbm, OWNER)
      const cm = eA ? { err: eA } : await caRol(dbm, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(L1))])
      const cm1 = eA || cm.err ? null : await cititori(dbm, OWNER)
      const difera = cm1 ? Object.keys(CITITORI).filter(k => cm1[k] !== cm0[k]) : []
      ok(!eA && !cm.err && difera.includes('activitati') && difera.includes('tinte') && !difera.includes('catalog') && !difera.includes('configurare'),
        `mutantul comportamental aplicat (fără postcondiții) și PRINS de cititorii vechi după importul parțial (diferă: ${difera.join(', ') || 'NIMIC'}; catalogul și 20270105b filtrează activ și nu văd diferența — de aceea P1 r4 a scăpat testelor r4): ${eA || cm.msg || cm1?.activitati?.slice(0, 120) || ''}`)
      const dbm2 = await bazaNoua()
      await proiectSintetic(dbm2, L)
      const eA2 = await eroare(aplicaA(dbm2, tm))
      ok(/20270105a post:/.test(eA2 || ''), `mutantul comportamental refuzat la aplicare cu postcondițiile întregi: ${(eA2 || 'TRECE').slice(0, 90)}`)
    }
  }
  // r6 MUTANTUL COMPORTAMENTAL al reprezentării (reproducerea P1-2 r5): rândurile scrise brut, cum vin (obiect ' ob 1 ', 'MC' × 100, 'T' / 1000) → cititorii
  // vechi (ActivitatiProiectPanel: suma brută; 20261208a: JOIN pe obiect_cod brut = u.obiect_cod; DevizVsExecutatTab: lista obiectelor) se schimbă
  {
    const POST_A = '-- ─── 12. Postcondiții'
    let tm = null
    try {
      tm = mutant(MIG_A, [[`      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := e->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`],
        [`      'um', coalesce(v_um_rep, btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g'))), 'cantitate', v_c,`, `      'um', btrim(e->>'um'), 'cantitate', (e->>'cantitate')::numeric,`]])
    } catch (e) { ok(false, 'mutantul comportamental „reprezentarea brută”: ' + e.message) }
    if (tm) {
      const dbm = await bazaNoua()
      await proiectSintetic(dbm, L)
      const eA = await eroare(aplicaA(dbm, tm.slice(0, tm.indexOf(POST_A))))
      await dbm.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER}', true)`)
      const cm0 = eA ? null : await cititori(dbm, OWNER)
      const cm = eA ? { err: eA } : await caRol(dbm, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(L1))])
      const cm1 = eA || cm.err ? null : await cititori(dbm, OWNER)
      const difera = cm1 ? Object.keys(CITITORI).filter(k => cm1[k] !== cm0[k]) : []
      ok(!eA && !cm.err && difera.includes('activitati') && difera.includes('tinte') && difera.includes('obiecte'),
        `mutantul comportamental „reprezentarea brută” aplicat (fără postcondiții) și PRINS de cititorii vechi (diferă: ${difera.join(', ') || 'NIMIC'}): ${eA || cm.msg || cm1?.obiecte?.slice(0, 120) || ''}`)
    }
  }
}

// ─── 8. TESTUL DE PROPRIETATE al reprezentării pe cheie (r7, review #1158: 2 × P1 pe r6) ──────────────────────────────────────────────────────────
// Proprietatea: pentru ORICE ofertă existentă (scrisă pe calea veche, în orice forme brute) și ORICE document echivalent (aceleași chei canonice, aceleași
// cantități în UM-ul normalizat, alte forme brute), confirmarea prin RPC lasă NESCHIMBATĂ ieșirea fiecărui cititor existent al proiect_articole.
// Cititorii, cu logica EXACTĂ din cod: ActivitatiProiectPanel.jsx:53,69 și lib/verificariProiect.js:67,76 (în JS, expresiile componentelor), 20261208a
// fn_executie_tinte_calcul (predicatul JOIN luat din textul migrării, pe proiect_unitati REAL, cantitatea convertită), DevizVsExecutatTab.jsx:222-228 (obiectele
// distincte, prima denumire după id, sortate localeCompare), CatalogDevizPanel.jsx:38,100-111 (toate rândurile ordonate pe obiect / deviz / nr, grupele pe
// obiect_nume || obiect_cod, actele), MaterialeProiectPanel.jsx:29, 20270105b (contract_initial activ), fn_rest_decontat_are_oferta.
const CODURI8 = ['TSA01A1', 'TSC17B1', 'TSD01C1', 'GC 01', 'IZ 05', 'RPCT 11', 'M1L05', 'SUD 300']
const PREFIXE8 = ['TSA', 'TSC', 'TSD', 'GC', 'IZ', 'RPCT', 'M1L05', 'SUD']
const ACTIVITATI8 = [...PREFIXE8, 'TSA,TSC', 'tsa', 'gc', 'TSD, IZ']   // coduri_deviz ale activităților (ca în proiect_activitati; litere mici și spații ca în date reale)
const UM8 = [['M', 100], ['100 MC', 2], ['BUC', 10], ['KG', 500], ['HM', 3], ['MC', 250]]   // (UM brut, cantitate) — toate conversiile de mai jos exact reprezentabile
// UM-uri echivalente (același UM normalizat, alt factor): [UM nou, factorul cantității noi față de cea veche]
const ECHIV8 = { M: [['ML', 1], ['HM', 1 / 100], ['KM', 1 / 1000], ['100 M', 1 / 100]], '100 MC': [['MC', 100], ['M3', 100], ['1000 MC', 1 / 10]], BUC: [['100 BUC', 1 / 100], ['buc', 1]],
  KG: [['T', 1 / 1000], ['100 KG', 1 / 100], ['TO', 1 / 1000]], HM: [['M', 100], ['KM', 1 / 10], ['100 M', 1]], MC: [['M3', 1], ['100 MC', 1 / 100]] }
const swapCase = s => [...s].map((c, i) => i % 2 ? c.toLowerCase() : c.toUpperCase()).join('')
const cuSpatii = (s, i) => [` ${s}`, `${s}  `, ` ${s} `, s.includes(' ') ? s.replace(/ /g, '  ') : `  ${s}`][i % 4]
// combinațiile generate (deterministe): nr. de obiecte × formele brute ale obiectului (una / două, alternate pe rânduri) × unitatea legată (niciuna / forma A / forma B)
// × transformarea liniilor (litere, spații, UM, toate)
function combinatii8() {
  const L = []
  for (const obiecte of [1, 2]) for (const forme of ['unic', 'mixt']) for (const unitate of forme === 'unic' ? ['fara', 'A'] : ['fara', 'A', 'B'])
    for (const trans of ['litere', 'spatii', 'um', 'toate']) L.push({ obiecte, forme, unitate, trans })
  return L
}
// oferta veche a unei combinații: rândurile (forme brute) + unitățile; liniile RPC = aceleași rânduri transformate echivalent
function fixtura8(c, i0) {
  const baze = ['OB1', 'TR-2'].slice(0, c.obiecte)
  const randuri = [], unitati = []
  baze.forEach((baza, o) => {
    const formeOb = c.forme === 'unic' ? [baza] : [baza, baza.toLowerCase()]
    if (c.unitate !== 'fara') unitati.push({ nume: `Unitate ${baza}`, obiect_cod: c.unitate === 'A' ? formeOb[0] : formeOb[1] })
    for (let j = 0; j < 6; j++) {
      const cod = CODURI8[(j + o) % CODURI8.length], [um, cant] = UM8[(j + o) % UM8.length]
      randuri.push({ obiect_cod: formeOb[j % formeOb.length], obiect_nume: `Obiect ${baza}`, deviz_cod: j < 3 ? 'D01' : 'D02', deviz_nume: j < 3 ? 'Terasamente' : 'Montaj',
        nr: String(j + 1) + (j % 2 ? 'a' : ''), cod, denumire: `Articol ${cod}`, um, cantitate: cant, pret_unitar: 10, valoare: cant * 10 })
    }
  })
  const linii = randuri.map((r, j) => {
    const l = { ...r }
    const litere = c.trans === 'litere' || c.trans === 'toate', spatii = c.trans === 'spatii' || c.trans === 'toate', umT = c.trans === 'um' || c.trans === 'toate'
    if (litere) { l.obiect_cod = swapCase(l.obiect_cod); l.deviz_cod = l.deviz_cod.toLowerCase(); l.cod = j % 2 ? l.cod.toLowerCase() : swapCase(l.cod); l.nr = l.nr.toUpperCase() }
    if (spatii) { l.obiect_cod = cuSpatii(l.obiect_cod, j); l.deviz_cod = cuSpatii(l.deviz_cod, j + 1); l.cod = cuSpatii(l.cod, j + 2); l.nr = cuSpatii(l.nr, j + 3) }
    if (umT) { const alt = ECHIV8[r.um]; const [um, f] = alt[(j + i0) % alt.length]; l.um = um; l.cantitate = rotund(r.cantitate * f); l.pret_unitar = rotund(r.pret_unitar / f) }
    return l
  })
  return { randuri, unitati, linii }
}
const M1208_PRED = predicatTinte   // predicatul JOIN al cititorului 20261208a (textul migrării, cu v_p → 904), re-parametrizat pe proiect mai jos
// PLAFONUL API (r8, review #1158 P1 pe r7): PostgREST dă cel mult 1000 de rânduri pe cerere (max-rows). Cititorii din ecran citesc acum pe chei (citesteToate:
// ORDER BY id, LIMIT pas, id > ultimul, până la pagina goală) — emulat aici cu LIMIT = plafonul; cititorul VECHI (o singură cerere, fără ordine) e emulat cu
// `LIMIT plafon` fără ORDER BY (subsetul depinde de ordinea fizică), doar ca să se arate că scenariul reproduce condiția (§9)
const PLAFON_API = 1000
async function citestePagini(sel, sqlFaraOrdine, plafon = PLAFON_API) {
  const tot = []
  for (let ultim = null; ;) {
    const rows = await sel(`${sqlFaraOrdine}${ultim == null ? '' : ` AND id > ${ultim}`} ORDER BY id LIMIT ${plafon}`)
    if (!rows.length) return tot
    for (const x of rows) tot.push(x)
    const u = Number(rows[rows.length - 1].id)
    if (!(ultim == null || u > ultim)) throw new Error('paginare: id neordonat')
    ultim = u
  }
}
const cititorVechi = (sel, sqlFaraOrdine, plafon = PLAFON_API) => sel(`${sqlFaraOrdine} LIMIT ${plafon}`)
async function cititori8(db, uid, pid, plafon = PLAFON_API) {
  const r = {}
  const sel = async sql => { const x = await caRol(db, 'authenticated', uid, sql); if (x.err) throw new Error(`cititor: ${x.err} ${x.msg}`); return x.rows }
  // ActivitatiProiectPanel.jsx (load + contractPt) și verificariProiect.js (stadiuFizic): expresiile din componente, pe rândurile citite ca ele — pe chei (r8)
  const articole = await citestePagini(sel, `SELECT id, cod, um, cantitate, sursa FROM public.proiect_articole WHERE proiect_id = ${pid} AND sursa <> 'extras_materiale'`, plafon)
  r.activitati = ACTIVITATI8.map(coduri => {
    const prefixe = (coduri || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const sel2 = articole.filter(x => prefixe.some(p => (x.cod || '').toUpperCase().startsWith(p)))
    return `${coduri}=${sel2.reduce((s, x) => s + (Number(x.cantitate) || 0), 0)}/${sel2.length}`
  }).join('; ')
  const art = await citestePagini(sel, `SELECT id, cod, cantitate, sursa FROM public.proiect_articole WHERE proiect_id = ${pid} AND sursa <> 'extras_materiale'`, plafon)
  r.verificari = ACTIVITATI8.map(coduri => {
    const prefixe = (coduri || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    const q = (art || []).filter(x => prefixe.some(p => (x.cod || '').toUpperCase().startsWith(p))).reduce((s, x) => s + (Number(x.cantitate) || 0), 0)
    return `${coduri}=${q}`
  }).join('; ')
  // 20261208a fn_executie_tinte_calcul: unitățile REALE ale proiectului, prefixele ca în calcul, predicatul JOIN din textul migrării, cantitatea convertită
  r.tinte = (await sel(`WITH u AS (SELECT pu.id, pu.obiect_cod FROM public.proiect_unitati pu WHERE pu.proiect_id = ${pid}),
       a(baza_deviz, prefixe) AS (VALUES ('initiala', ARRAY[${PREFIXE8.map(p => `'${p}'`).join(', ')}]), ('revizuita', ARRAY['TSA', 'GC']))
     SELECT u.id::text || '/' || u.obiect_cod || '/' || a.baza_deviz AS k, count(*)::int AS n, (count(*) FILTER (WHERE art.cantitate IS NULL OR cv.f IS NULL))::int AS fara,
            coalesce(sum(art.cantitate::numeric * cv.f), 0)::float8::text AS s
       FROM u JOIN a ON cardinality(a.prefixe) > 0 JOIN public.proiect_articole art ON ${M1208_PRED.split('904').join(String(pid))}
       CROSS JOIN LATERAL (SELECT x.factor AS f FROM public.fn_rest_decontat_um(art.um) x) cv
      WHERE u.obiect_cod IS NOT NULL GROUP BY 1 ORDER BY 1`)).map(y => `${y.k}=${y.n}/${y.fara}/${y.s}`).join('; ')
  // CatalogDevizPanel.jsx (load: select('*') pe chei, activ !== false, apoi ordineCatalog în client — r8) → toate rândurile vizibile + grupele + actele
  const cat = (await citestePagini(sel, `SELECT id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate::float8::text AS cantitate, pret_unitar::float8::text AS pret_unitar,
      valoare::float8::text AS valoare, sursa, act_nr, activ FROM public.proiect_articole WHERE proiect_id = ${pid}`, plafon)).filter(a => a.activ !== false).sort(ordineCatalog)
  const grupe = new Map()
  for (const a of cat) { const k = a.obiect_nume || a.obiect_cod || '—'; if (!grupe.has(k)) grupe.set(k, { nume: k, cod: a.obiect_cod, n: 0, val: 0 }); const g = grupe.get(k); g.n++; g.val += (Number(a.valoare) || 0) }
  r.catalog_grupe = [...grupe.values()].map(g => `${g.nume}|${g.cod}=${g.n}/${g.val}`).join('; ')
  r.catalog_randuri = cat.map(a => [a.obiect_cod, a.obiect_nume, a.deviz_cod, a.deviz_nume, a.nr, a.cod, a.denumire, a.um, a.cantitate, a.pret_unitar, a.valoare, a.sursa, a.act_nr].map(v => v == null ? '∅' : String(v)).join('|')).join('\n')
  r.catalog_acte = [...new Set(cat.filter(a => a.sursa === 'act_aditional' && a.act_nr).map(a => a.act_nr))].sort().join(',')
  // DevizVsExecutatTab.jsx:222-228: obiectele distincte (prima denumire după id), sortate localeCompare
  const ob = new Map()
  for (const a of await sel(`SELECT id, obiect_cod, obiect_nume FROM public.proiect_articole WHERE proiect_id = ${pid} AND obiect_cod IS NOT NULL ORDER BY id`)) if (a.obiect_cod && !ob.has(a.obiect_cod)) ob.set(a.obiect_cod, a.obiect_nume || '')
  r.obiecte = [...ob.entries()].map(([obiect_cod, obiect_nume]) => ({ obiect_cod, obiect_nume })).sort((a, b) => a.obiect_cod.localeCompare(b.obiect_cod)).map(o => `${o.obiect_cod}=${o.obiect_nume}`).join('; ')
  r.materiale = (await sel(`SELECT nr, cod, cantitate::float8::text AS c FROM public.proiect_articole WHERE proiect_id = ${pid} AND sursa = 'extras_materiale' ORDER BY nr`)).map(m => `${m.nr}/${m.cod}/${m.c}`).join('; ')
  r.configurare = String((await sel(`SELECT count(*)::int AS n FROM public.proiect_articole a WHERE a.proiect_id::bigint = ${pid} AND a.sursa = 'contract_initial' AND a.activ`))[0].n)
  r.are_oferta = String((await sel(`SELECT public.fn_rest_decontat_are_oferta(${pid}) AS v`))[0].v)
  return r
}
const OWNER8 = 'f0000000-0000-4000-8000-00000000009a'
// rulează toate combinațiile pe o bază cu migrarea (sau un mutant) aplicată: pentru fiecare, proiect nou → oferta veche (server, calea veche) → cititorii →
// RPC cu liniile echivalente → cititorii; apoi (r8, P2: poziția NU participă la identitate, dar se copiază exact) pe aceeași bază confirmată, cu „înlocuiește”:
// (c1) aceleași linii FĂRĂ nr → trece, cititorii identici (poziția copiată din rândul cheii); (c2) aceleași linii cu ALTĂ poziție (nr + '9') → refuz
// 22023 nr_schimbat, nimic scris, cititorii identici. Întoarce [{c, err, difera, pozitii: {c1, c2}}]
async function ruleazaCombinatii8(db, lista) {
  const rez = []
  await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER8}', true) ON CONFLICT (id) DO NOTHING`)
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i], pid = 9500 + i
    const { randuri, unitati, linii } = fixtura8(c, i)
    await db.query(`INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES ($1, $2, 'Proprietate r7')`, [pid, `PROP-${i}`])
    for (const u of unitati) await db.query(`INSERT INTO public.proiect_unitati (proiect_id, tip, nume, obiect_cod) VALUES ($1, 'obiect', $2, $3)`, [pid, u.nume, u.obiect_cod])
    await db.query(`INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, pret_unitar, sursa)
      SELECT $1, x.obiect_cod, x.obiect_nume, x.deviz_cod, x.deviz_nume, x.nr, x.cod, x.denumire, x.um, x.cantitate, x.valoare, x.pret_unitar, 'contract_initial'
        FROM jsonb_to_recordset($2::jsonb) AS x(obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text, cantitate numeric, valoare numeric, pret_unitar numeric)`, [pid, JSON.stringify(randuri)])
    await db.query(`INSERT INTO public.proiect_articole (proiect_id, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES ($1, '1', 'TEAVA-DN300', 'Teava', 'M', 1100, 0, 'extras_materiale')`, [pid])
    const amprenta = (n) => (i + 1).toString(16).padStart(2, '0').repeat(31) + n.toString(16).padStart(2, '0')
    const c0 = await cititori8(db, OWNER8, pid)
    const x = await caRol(db, 'authenticated', OWNER8, `SELECT public.fn_rest_decontat_confirma_baza($1, 'contract_initial', NULL, NULL, NULL, 'prop.xlsx', $2, $3::jsonb) AS v`,
      [pid, amprenta(0), JSON.stringify(linii)])
    const c1 = x.err ? null : await cititori8(db, OWNER8, pid)
    const difera = c1 ? Object.keys(c0).filter(k => c0[k] !== c1[k]) : []
    const pozitii = {}
    if (c1) {
      // (c1) fără nr: poziția se copiază din rândul cheii → cititorii identici
      const faraNr = linii.map(({ nr, ...rest }) => rest)   // eslint-disable-line no-unused-vars
      const y1 = await caRol(db, 'authenticated', OWNER8, `SELECT public.fn_rest_decontat_confirma_baza($1, 'contract_initial', NULL, NULL, NULL, 'prop_fara_nr.xlsx', $2, $3::jsonb, true) AS v`, [pid, amprenta(1), JSON.stringify(faraNr)])
      const cy1 = y1.err ? null : await cititori8(db, OWNER8, pid)
      pozitii.c1 = { err: y1.err ? `${y1.err} ${y1.msg}` : null, difera: cy1 ? Object.keys(c0).filter(k => c0[k] !== cy1[k]) : [] }
      // (c2) altă poziție pe aceleași chei: refuz nr_schimbat, nimic scris
      const altNr = linii.map(l => ({ ...l, nr: (l.nr ?? '') + '9' }))
      const n0 = (await q1(db, `SELECT count(*)::int AS n, (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = $1)::int AS h FROM public.proiect_articole WHERE proiect_id = $1`, [pid]))
      const y2 = await caRol(db, 'authenticated', OWNER8, `SELECT public.fn_rest_decontat_confirma_baza($1, 'contract_initial', NULL, NULL, NULL, 'prop_alt_nr.xlsx', $2, $3::jsonb, true) AS v`, [pid, amprenta(2), JSON.stringify(altNr)])
      const n1 = (await q1(db, `SELECT count(*)::int AS n, (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = $1)::int AS h FROM public.proiect_articole WHERE proiect_id = $1`, [pid]))
      const cy2 = await cititori8(db, OWNER8, pid)
      pozitii.c2 = { err: y2.err ? `${y2.err} ${y2.msg}` : null, refuzat: y2.err === '22023' && /nr_schimbat/.test(y2.msg || ''), scris: JSON.stringify(n0) !== JSON.stringify(n1),
        difera: Object.keys(c0).filter(k => c0[k] !== cy2[k]) }
    }
    rez.push({ c, i, err: x.err ? `${x.err} ${x.msg}` : null, difera, inserate: x.rows?.[0]?.v?.inserate, c0, c1, pozitii })
  }
  return rez
}
// poziția (r8): (c1) acceptat + cititorii identici; (c2) refuzat nr_schimbat + nimic scris + cititorii identici
const pozitiiOk = r => r.pozitii?.c1 && !r.pozitii.c1.err && r.pozitii.c1.difera.length === 0 && r.pozitii.c2 && r.pozitii.c2.refuzat && !r.pozitii.c2.scris && r.pozitii.c2.difera.length === 0
const pozitiiText = r => !r.pozitii?.c1 ? '-' : `c1 ${r.pozitii.c1.err ? 'REFUZ ' + r.pozitii.c1.err.slice(0, 100) : r.pozitii.c1.difera.length ? 'DIFERĂ ' + r.pozitii.c1.difera.join(',') : 'ok'}; c2 ${r.pozitii.c2.refuzat ? 'refuzat nr_schimbat' : 'ACCEPTAT ' + (r.pozitii.c2.err || '').slice(0, 100)}${r.pozitii.c2.scris ? ' SCRIS' : ''}${r.pozitii.c2.difera.length ? ' DIFERĂ ' + r.pozitii.c2.difera.join(',') : ''}`
const eticheta8 = c => `${c.obiecte} obiect(e), forme ${c.forme}, unitate ${c.unitate}, transformare ${c.trans}`
if (!DOAR || DOAR === '8') {
  console.log('8. PROPRIETATEA reprezentării pe cheie (r7): cititorii existenți identici înainte / după confirmarea unor linii echivalente, pe combinații generate; mutanții pe fiecare câmp pică testul')
  const LISTA = combinatii8()
  ok(LISTA.length === 40 && !!predicatTinte, `${LISTA.length} combinații generate (1–2 obiecte × forme unice / amestecate × unitate legată la niciuna / forma A / forma B × transformare litere / spații / UM / toate); predicatul 20261208a din textul migrării`)
  // transformările sunt ECHIVALENTE prin construcție: aceleași chei canonice și aceleași cantități normalizate (verificare pe date, independentă de RPC)
  const canon = s => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  const normUm = u => { const n = canon(u).replace(/[ .]/g, ''); const t = { M: ['M', 1], ML: ['M', 1], HM: ['M', 100], KM: ['M', 1000], '100M': ['M', 100], MC: ['MC', 1], M3: ['MC', 1], '100MC': ['MC', 100], '1000MC': ['MC', 1000], BUC: ['BUC', 1], '100BUC': ['BUC', 100], KG: ['KG', 1], T: ['KG', 1000], TO: ['KG', 1000], '100KG': ['KG', 100] }; return t[n] || [n, 1] }
  let echiv = 0, neechiv = []
  for (let i = 0; i < LISTA.length; i++) {
    const { randuri, linii } = fixtura8(LISTA[i], i)
    const k = r => `${canon(r.obiect_cod)}|${canon(r.deviz_cod)}|${canon(r.cod)}|${canon(r.nr)}`
    const q = r => { const [b, f] = normUm(r.um); return `${b}:${rotund(r.cantitate * f)}:${rotund(r.pret_unitar / f)}:${r.valoare}` }
    const a = randuri.map(r => k(r) + '=' + q(r)).sort().join('\n'), b = linii.map(r => k(r) + '=' + q(r)).sort().join('\n')
    const difForma = randuri.some((r, j) => ['obiect_cod', 'deviz_cod', 'cod', 'nr', 'um'].some(f => r[f] !== linii[j][f]))
    if (a === b && difForma) echiv++; else neechiv.push(i)
  }
  ok(echiv === LISTA.length, `toate combinațiile au linii ECHIVALENTE (aceleași chei canonice, cantități / prețuri în UM normalizat, valori) și DIFERITE ca formă brută (${echiv}/${LISTA.length}; neechivalente: ${neechiv.join(',') || 'niciuna'})`)
  const db = await bazaNoua()
  await aplicaLivrare(db, A, MIG_A, F(A).ob)
  const rez = await ruleazaCombinatii8(db, LISTA)
  let verzi = 0
  for (const r of rez) {
    const bun = !r.err && r.difera.length === 0 && r.inserate === r.c.obiecte * 6 && pozitiiOk(r)
    if (bun) verzi++
    ok(bun, `combinația ${r.i + 1}/${rez.length} (${eticheta8(r.c)}): ${r.err ? 'REFUZ ' + r.err.slice(0, 160) : r.difera.length ? 'DIFERĂ ' + r.difera.join(', ') + ' — ' + r.difera.map(k => `${k}: ${String(r.c1[k]).slice(0, 80)} ≠ ${String(r.c0[k]).slice(0, 80)}`).join(' | ') : `toți cititorii identici, ${r.inserate} rânduri confirmate`}; poziția: ${pozitiiText(r)}`)
  }
  ok(verzi === rez.length, `PROPRIETATEA: ${verzi}/${rez.length} combinații verzi (cititorii: ${Object.keys(rez[0]?.c0 || {}).join(', ')}; r8: + poziția copiată fără nr / refuzată nr_schimbat)`)
  // MUTANȚII proprietății: fără copierea unui câmp din rândul cheii (sau fără conversia cantității) testul trebuie să PICE (diferență sau refuz); la obiect_cod,
  // acolo unde o unitate e legată, refuzul vine de la garda „legatura_unitate” (apărarea în adâncime), nu de la cititori. r8: mutantul r7 al poziției (formele nr
  // doar pe poziția liniei, fără refuz) trebuie să pice prin (c2): poziția nouă e acceptată și scrisă (catalogul diferă)
  const POST_A = '-- ─── 12. Postcondiții'
  const MUTANTI8 = [
    ['poziția (r7): formele nr doar pe poziția liniei, fără refuzul nr_schimbat', [
      [`    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f;`,
       `    SELECT coalesce(array_agg(DISTINCT f->>'nr'), ARRAY[]::text[]) INTO v_nr_forme FROM jsonb_array_elements(v_forme) f\n     WHERE public.fn_rest_decontat_cheie(f->>'nr', NULL, NULL, NULL) = public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL);`],
      [`    IF cardinality(v_nr_forme) = 1 AND coalesce(e->>'nr', '') ~ '[^[:space:]]'\n       AND public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL) IS DISTINCT FROM public.fn_rest_decontat_cheie(v_nr_forme[1], NULL, NULL, NULL) THEN`,
       `    IF false THEN`]], null, 'pozitii'],
    ['poziția: refuzul nr_schimbat scos (poziția nouă e acceptată, dar se copiază cea veche)', [
      [`    IF cardinality(v_nr_forme) = 1 AND coalesce(e->>'nr', '') ~ '[^[:space:]]'\n       AND public.fn_rest_decontat_cheie(e->>'nr', NULL, NULL, NULL) IS DISTINCT FROM public.fn_rest_decontat_cheie(v_nr_forme[1], NULL, NULL, NULL) THEN`,
       `    IF false THEN`]], null, 'pozitii'],
    ['obiect_cod necopiat', [[`      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := btrim(regexp_replace(e->>'obiect_cod', '[[:space:]]+', ' ', 'g')); v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`]], /legatura_unitate/],
    ['deviz_cod necopiat', [[`      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := v_f->>'obiect_cod'; v_dz := btrim(regexp_replace(e->>'deviz_cod', '[[:space:]]+', ' ', 'g')); v_cod := v_f->>'cod';`]], null],
    ['cod necopiat', [[`      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := v_f->>'cod';`, `      v_ob := v_f->>'obiect_cod'; v_dz := v_f->>'deviz_cod'; v_cod := btrim(regexp_replace(e->>'cod', '[[:space:]]+', ' ', 'g'));`]], null],
    ['nr necopiat', [[`    v_nr := CASE WHEN cardinality(v_nr_forme) = 1 THEN v_nr_forme[1]\n                 WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)\n                 ELSE btrim(regexp_replace(e->>'nr', '[[:space:]]+', ' ', 'g')) END;`, `    v_nr := CASE WHEN v_kn IS NULL AND v_k <> v_kb THEN substr(v_k, length(v_kb) + 3)\n                 ELSE btrim(regexp_replace(e->>'nr', '[[:space:]]+', ' ', 'g')) END;`]], null],
    ['um necopiat (cantitatea convertită)', [[`      'um', coalesce(v_um_rep, btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g'))), 'cantitate', v_c,`, `      'um', btrim(regexp_replace(e->>'um', '[[:space:]]+', ' ', 'g')), 'cantitate', v_c,`]], null],
    ['cantitatea neconvertită', [[`      v_c := v_c * v_factor / v_factor_rep; v_p := v_p * v_factor_rep / v_factor;`, `      v_p := v_p * v_factor_rep / v_factor;`]], null],
  ]
  for (const [nume, lista, refuzAsteptat, unde] of MUTANTI8) {
    let tm = null
    try { tm = mutant(MIG_A, lista) } catch (e) { ok(false, `mutantul proprietății „${nume}”: ${e.message}`); continue }
    const dbm = await bazaNoua()
    const eA = await eroare(aplicaA(dbm, tm.slice(0, tm.indexOf(POST_A))))
    if (eA) { ok(false, `mutantul proprietății „${nume}” nu s-a aplicat: ${eA.slice(0, 160)}`); continue }
    const rm = await ruleazaCombinatii8(dbm, LISTA)
    if (unde === 'pozitii') {
      // mutantul poziției trebuie să pice DOAR partea (c1 / c2); confirmarea de bază rămâne verde (altfel ar fi alt mutant)
      const baza = rm.filter(r => r.err || r.difera.length), picate = rm.filter(r => !pozitiiOk(r))
      const acceptate = picate.filter(r => r.pozitii?.c2 && !r.pozitii.c2.refuzat), scrise = picate.filter(r => r.pozitii?.c2?.scris || r.pozitii?.c2?.difera?.length)
      ok(baza.length === 0 && picate.length === rm.length && acceptate.length === rm.length && scrise.length > 0,
        `mutantul proprietății „${nume}” PICĂ testul prin poziție: ${picate.length}/${rm.length} combinații (poziția nouă acceptată la ${acceptate.length}, scrisă / cititori diferiți la ${scrise.length}; confirmarea de bază verde la ${rm.length - baza.length}): ${pozitiiText(picate[0] || {})}`)
      continue
    }
    const picate = rm.filter(r => r.err || r.difera.length), refuzuri = rm.filter(r => r.err), cuRefuzAsteptat = refuzAsteptat ? refuzuri.filter(r => refuzAsteptat.test(r.err)) : []
    const campuri = [...new Set(picate.flatMap(r => r.difera))]
    ok(picate.length > 0 && (!refuzAsteptat || cuRefuzAsteptat.length > 0),
      `mutantul proprietății „${nume}” PICĂ testul: ${picate.length}/${rm.length} combinații (${refuzuri.length} refuzuri${refuzAsteptat ? `, din care ${cuRefuzAsteptat.length} „legatura_unitate”` : ''}; cititorii diferiți: ${campuri.join(', ') || '-'})`)
  }
}

// ─── 9. r8 (review #1158, 2 × P1 pe r7) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) PLAFONUL API: un proiect cu 1.200 de rânduri contract_initial (2 obiecte × 600, coduri repetate în deviz → nr în cheie), scris pe calea veche ÎNAINTE de
//     migrare; cititorii emulați ca în cod DUPĂ corecție (pe chei, LIMIT = plafonul de 1000) înainte / după confirmarea prin RPC a primului obiect (linii
//     echivalente) → identici; cititorul VECHI (o cerere, fără ordine, LIMIT 1000) se schimbă (rândurile confirmate sunt scrise la sfârșitul tabelului) —
//     dovada că scenariul reproduce condiția din review. Mutanții cititorilor din ecran: C:\Users\Gazpet-Ai\claude-tasks\…\r8_ui_mutanti.cjs (vitest).
// (b) IMPORTUL VECHI DUPĂ MIGRARE: aceleași 284 de rânduri sintetice (coduri repetate în deviz) importate (1) înaintea migrării + backfill și (2) după migrare,
//     ca CatalogDevizPanel (DELETE, apoi INSERT în loturi de 200 — lotul taie grupuri), ca owner autentificat → cheile IDENTICE pe fiecare rând, baza și
//     cititorii identici; mutanții trigger-ului (cheia mereu fără poziție; rândurile vechi ale grupului nere-cheiate) dau chei diferite.
function oferta1200() {
  const L = []
  let i = 0
  for (const [ob, obn] of [['OB A', 'TRONSON A'], ['OB B', 'TRONSON B']]) for (const dz of ['D01', 'D02', 'D03']) for (let j = 0; j < 200; j++, i++) {
    const cant = (i % 97) + 1, pret = (i % 13) * 10 + 5
    L.push({ obiect_cod: ob, obiect_nume: obn, deviz_cod: dz, deviz_nume: 'Deviz ' + dz, nr: String(j + 1), cod: CODURI8[j % CODURI8.length], denumire: `Articol ${i + 1}`,
      um: ['M', '100 MC', 'BUC', 'KG', 'HM'][i % 5], cantitate: cant, pret_unitar: pret, valoare: Math.round(cant * pret * 100) / 100 })
  }
  return L
}
async function proiectVechi(db, pid, L, nume = 'Proiect vechi') {
  await db.query(`INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES ($1, $2, $3)`, [pid, `PV-${pid}`, nume])
  await db.query(`INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, pret_unitar, sursa)
    SELECT $1, x.obiect_cod, x.obiect_nume, x.deviz_cod, x.deviz_nume, x.nr, x.cod, x.denumire, x.um, x.cantitate, x.valoare, x.pret_unitar, 'contract_initial'
      FROM jsonb_to_recordset($2::jsonb) AS x(obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text, cantitate numeric, valoare numeric, pret_unitar numeric)`, [pid, JSON.stringify(L)])
}
const SQL_CHEI = pid => `SELECT obiect_cod, deviz_cod, nr, cod, cheie FROM public.proiect_articole WHERE proiect_id = ${pid} AND sursa = 'contract_initial' ORDER BY obiect_cod, deviz_cod, nr::int, cod`
const cheiText = rows => rows.map(r => `${r.obiect_cod}/${r.deviz_cod}/${r.nr}/${r.cod}=${r.cheie}`).join('\n')
// importul ca CatalogDevizPanel (insertRows: loturi de 200, cereri separate), ca owner autentificat
async function importVechiInLoturi(db, uid, pid, L) {
  const d = await caRol(db, 'authenticated', uid, `DELETE FROM public.proiect_articole WHERE proiect_id = $1 AND sursa = 'contract_initial'`, [pid])
  if (d.err) throw new Error('DELETE: ' + d.msg)
  let loturi = 0
  for (let i = 0; i < L.length; i += 200) {
    const r = await caRol(db, 'authenticated', uid, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, valoare, pret_unitar, sursa, act_nr)
      SELECT $1, x.obiect_cod, x.obiect_nume, x.deviz_cod, x.deviz_nume, x.nr, x.cod, x.denumire, x.um, x.cantitate, x.valoare, x.pret_unitar, 'contract_initial', NULL
        FROM jsonb_to_recordset($2::jsonb) AS x(obiect_cod text, obiect_nume text, deviz_cod text, deviz_nume text, nr text, cod text, denumire text, um text, cantitate numeric, valoare numeric, pret_unitar numeric)`, [pid, JSON.stringify(L.slice(i, i + 200))])
    if (r.err) throw new Error(`INSERT lotul ${loturi + 1}: ${r.err} ${r.msg}`)
    loturi++
  }
  return loturi
}
if (!DOAR || DOAR === '9') {
  console.log('9. r8: (a) cititorii cu plafonul API (1000 de rânduri pe cerere) pe 1.200 de rânduri, înainte / după confirmare; (b) importul vechi după migrare, în loturi de 200, cu coduri repetate = importul de dinainte + backfill')
  // (a)
  {
    const L = oferta1200(), LA = L.filter(l => l.obiect_cod === 'OB A')
    const db = await bazaNoua()
    await proiectVechi(db, 9700, L, 'Plafon API: 1.200 randuri')
    await aplicaLivrare(db, A, MIG_A, F(A).ob)
    await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER8}', true) ON CONFLICT (id) DO NOTHING`)
    const sel = async sql => { const x = await caRol(db, 'authenticated', OWNER8, sql); if (x.err) throw new Error(`cititor: ${x.err} ${x.msg}`); return x.rows }
    const SQL_ART = `SELECT id, cod, um, cantitate, sursa FROM public.proiect_articole WHERE proiect_id = 9700 AND sursa <> 'extras_materiale'`
    const sumaTsa = rows => ACTIVITATI8.map(coduri => { const p = coduri.split(',').map(s => s.trim().toUpperCase()).filter(Boolean); const s = rows.filter(x => p.some(q => (x.cod || '').toUpperCase().startsWith(q))); return `${coduri}=${s.reduce((a, x) => a + Number(x.cantitate), 0)}/${s.length}` }).join('; ')
    const asteptat = sumaTsa(L)   // din date (L25): toate cele 1.200 de rânduri
    const n0 = await q1(db, `SELECT count(*)::int AS n FROM public.proiect_articole WHERE proiect_id = 9700`)
    ok(L.length === 1200 && n0.n === 1200 && new Set(asteptatBaza(L).map(x => x.cheie)).size === 1200, `proiectul 9700: 1.200 rânduri pe calea veche înaintea migrării (2 obiecte × 3 devize × 200; codurile se repetă în deviz → ${asteptatBaza(L).filter(x => x.cheie.includes('|#')).length} chei cu nr)`)
    const pag0 = await citestePagini(sel, SQL_ART), vechi0 = await cititorVechi(sel, SQL_ART)
    ok(pag0.length === 1200 && vechi0.length === PLAFON_API, `citirea pe chei aduce toate cele ${pag0.length} rânduri (pagini de ${PLAFON_API}); cititorul vechi primește exact ${vechi0.length} (plafonul)`)
    ok(sumaTsa(pag0) === asteptat, `cititorul pe chei înainte = așteptatul din date: ${asteptat.slice(0, 120)}`)
    const c0 = await cititori8(db, OWNER8, 9700)
    // confirmarea obiectului A prin RPC, cu liniile echivalente (' ob a ', UM-uri cu factor): rândurile lui sunt scrise la sfârșitul tabelului
    const x = await caRol(db, 'authenticated', OWNER8, `SELECT public.fn_rest_decontat_confirma_baza(9700, 'contract_initial', NULL, NULL, NULL, 'F3_A.xlsx', repeat('97', 32), $1::jsonb) AS v`, [JSON.stringify(liniiEchivalente(LA))])
    ok(!x.err && x.rows[0].v.inserate === 600 && x.rows[0].v.inlocuite === 600, `confirmarea obiectului OB A (600 linii echivalente): inserate 600, înlocuite 600: ` + (x.msg || 'ok'))
    const pag1 = await citestePagini(sel, SQL_ART), vechi1 = await cititorVechi(sel, SQL_ART)
    ok(pag1.length === 1200 && sumaTsa(pag1) === asteptat, `cititorul pe chei DUPĂ confirmare = același (toate cele ${pag1.length} rânduri): ${sumaTsa(pag1) === asteptat ? 'identic' : sumaTsa(pag1).slice(0, 120)}`)
    ok(vechi1.length === PLAFON_API && sumaTsa(vechi1) !== sumaTsa(vechi0), `condiția din review REPRODUSĂ: cititorul vechi (fără ordine, LIMIT ${PLAFON_API}) dă alt rezultat după confirmare — înainte ${sumaTsa(vechi0).slice(0, 60)}… după ${sumaTsa(vechi1).slice(0, 60)}…`)
    const c1 = await cititori8(db, OWNER8, 9700)
    const difera = Object.keys(c0).filter(k => c0[k] !== c1[k])
    ok(difera.length === 0, `toți cititorii emulați (pe chei, plafon ${PLAFON_API}) identici înainte / după pe 1.200 de rânduri: ${difera.length ? 'DIFERĂ ' + difera.join(', ') : Object.keys(c0).join(', ')}`)
    ok(c1.configurare === '1200' && /^1200$/.test(c1.configurare), `20270105b vede 1.200 rânduri contract_initial active după confirmare (nu 1.800): ${c1.configurare}`)
  }
  // (b)
  {
    const L = ofertaSintetica()
    const dbX = await bazaNoua()
    await proiectVechi(dbX, 9701, L, 'Import inaintea migrarii + backfill')
    await aplicaLivrare(dbX, A, MIG_A, F(A).ob)
    const cheiX = cheiText((await dbX.query(SQL_CHEI(9701))).rows)
    const cuNrX = (cheiX.match(/\|#/g) || []).length
    ok(cheiX.split('\n').length === 284 && cuNrX > 0, `(b) referința: 284 rânduri importate ÎNAINTEA migrării, backfill-ul a pus nr în cheie pe ${cuNrX} rânduri (coduri repetate în deviz)`)
    const dbY = await bazaNoua()
    await aplicaLivrare(dbY, A, MIG_A, F(A).ob)
    await dbY.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER8}', true) ON CONFLICT (id) DO NOTHING`)
    await dbY.query(`INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES (9701, 'PV-9701', 'Import DUPA migrare, in loturi')`)
    let loturi = 0, eImp = null
    try { loturi = await importVechiInLoturi(dbY, OWNER8, 9701, L) } catch (e) { eImp = e.message }
    ok(!eImp && loturi === 2, `(b) importul vechi DUPĂ migrare ca owner autentificat, în ${loturi} loturi de 200 (primul lot taie grupurile de coduri repetate): ${eImp || 'ok'}`)
    const cheiY = cheiText((await dbY.query(SQL_CHEI(9701))).rows)
    ok(cheiY === cheiX, `(b) cheile rândurilor importate DUPĂ migrare = cheile backfill-ului, pe fiecare rând (${cheiY.split('\n').length} rânduri, ${(cheiY.match(/\|#/g) || []).length} cu nr)` + (cheiY === cheiX ? '' : ': DIFERĂ — ' + cheiY.split('\n').filter((l, i) => l !== cheiX.split('\n')[i]).slice(0, 3).join(' | ')))
    const bY = await caRol(dbY, 'authenticated', OWNER8, `SELECT cheie, cantitate::float8::text AS c, valoare::float8::text AS v, randuri FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 9701 ORDER BY cheie COLLATE "C"`)
    ok(!bY.err && JSON.stringify(bY.rows) === JSON.stringify(asteptatBaza(L)), `(b) baza după importul vechi în loturi = cele 284 de chei așteptate din date (pozițiile repetate separate, nu comasate): ` + (bY.msg || `${bY.rows.length} chei`))
    await dbX.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER8}', true) ON CONFLICT (id) DO NOTHING`)
    const cX = await cititori8(dbX, OWNER8, 9701), cY = await cititori8(dbY, OWNER8, 9701)
    const dif = Object.keys(cX).filter(k => cX[k] !== cY[k])
    ok(dif.length === 0, `(b) cititorii vechi identici între importul de dinainte și cel de după migrare: ${dif.length ? 'DIFERĂ ' + dif.join(', ') : Object.keys(cX).join(', ')}`)
    // mutanții trigger-ului (aplicați fără postcondiții): cheile importului de după migrare trebuie să DIFERE de backfill
    const POST_A = '-- ─── 12. Postcondiții'
    for (const [nume, lista] of [
      ['trigger-ul atribuie mereu cheia fără poziție (r7)', [[`    IF TG_OP = 'INSERT' AND public.fn_rest_decontat_cheie_document(NEW.proiect_id::bigint, NEW.sursa::text, NEW.act_nr::text, v_fara) THEN\n      NEW.cheie := v_cu;\n    ELSE\n      NEW.cheie := v_fara;\n    END IF;`, `    NEW.cheie := v_fara;`]]],
      ['rândurile deja scrise ale grupului nu se re-cheiază', [[`   WHERE a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')\n     AND a.confirmat_la IS NULL\n     AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k\n     AND a.cheie IS DISTINCT FROM`, `   WHERE false AND a.proiect_id::bigint = p_proiect AND a.sursa IS NOT DISTINCT FROM p_sursa AND coalesce(a.act_nr::text, '') = coalesce(p_act_nr, '')\n     AND a.confirmat_la IS NULL\n     AND public.fn_rest_decontat_cheie(a.obiect_cod::text, a.deviz_cod::text, a.cod::text, NULL) = p_k\n     AND a.cheie IS DISTINCT FROM`]]],
    ]) {
      let tm = null
      try { tm = mutant(MIG_A, lista) } catch (e) { ok(false, `(b) mutantul „${nume}”: ${e.message}`); continue }
      const dbm = await bazaNoua()
      const eA = await eroare(aplicaA(dbm, tm.slice(0, tm.indexOf(POST_A))))
      if (eA) { ok(false, `(b) mutantul „${nume}” nu s-a aplicat: ${eA.slice(0, 160)}`); continue }
      await dbm.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER8}', true) ON CONFLICT (id) DO NOTHING`)
      await dbm.query(`INSERT INTO public.executie_proiecte (id, cod_intern, nume) VALUES (9701, 'PV-9701', 'mutant')`)
      let eM = null
      try { await importVechiInLoturi(dbm, OWNER8, 9701, L) } catch (e) { eM = e.message }
      const cheiM = cheiText((await dbm.query(SQL_CHEI(9701))).rows)
      const bM = await caRol(dbm, 'authenticated', OWNER8, `SELECT count(*)::int AS n FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 9701`)
      ok(!eM && cheiM !== cheiX, `(b) mutantul „${nume}” aplicat și PRINS: cheile importului de după migrare diferă de backfill (${(cheiM.match(/\|#/g) || []).length} cu nr față de ${cuNrX}; baza are ${bM.rows?.[0]?.n} chei în loc de 284)${eM ? ' — importul a picat: ' + eM.slice(0, 120) : ''}`)
    }
  }
}

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
