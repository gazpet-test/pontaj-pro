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
//    r4) face cititorii să vadă 568; revenirea refuză (date confirmate).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_rest_decontat_local.mjs
//   (--scrie-obiecte rescrie listele revizuite L15 din manifestele generate; --amprente tipărește constantele AMPRENTA calculate)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  't_oferta_confirmata (6/7) ok', 't_oferta_confirmata (7/7) ok', 't_rand_orfan ok']
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
      [`  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_rest_decontat_confirma_baza';`, `  v_rpc boolean := current_setting('gazpet.rest_decontat_scriitor', true) = 'fn_rest_decontat_confirma_baza';`],
      [`    IF OLD.confirmat_la IS NOT NULL AND (v_rpc OR v_server) IS NOT TRUE THEN`, `    IF OLD.confirmat_la IS NOT NULL AND NOT (v_rpc OR v_server) THEN`],
      [`  IF (v_rpc OR v_server) IS NOT TRUE THEN\n    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`, `  IF NOT (v_rpc OR v_server) THEN\n    IF TG_OP = 'UPDATE' AND OLD.confirmat_la IS NOT NULL THEN`]]],
    // (garda situațiilor cu marcaj NULL e corectată la fel, dar NU e observabilă de client: authenticated n-are INSERT / UPDATE / DELETE pe
    //  executie_sl_detaliu* — refuzul de privilegiu vine înaintea trigger-ului; un mutant acolo ar fi echivalent pentru dry-run)
    ['restricția pe proiect (20261209a) scoasă din drept', [[`    AND public.fn_executie_proiect_permis(p_proiect, p_nivel <> 'citire') IS TRUE\n`, '']]],
    ['un singur grup de coduri repetate (SELECT INTO pe agregare cu GROUP BY)', [[
      `  SELECT coalesce(array_agg(z.k ORDER BY z.k), ARRAY[]::text[]) INTO STRICT v_dub\n    FROM (SELECT k FROM unnest(v_chei) AS k GROUP BY k HAVING count(*) > 1) z;`,
      `  SELECT array_agg(DISTINCT k) INTO v_dub FROM (SELECT unnest(v_chei) AS k) z GROUP BY k HAVING count(*) > 1;\n  v_dub := coalesce(v_dub, ARRAY[]::text[]);`]]],
    ['poziția lipsă pe un cod repetat neverificată', [[`    IF public.fn_rest_decontat_cheie(e->>'obiect_cod', e->>'deviz_cod', e->>'cod', NULL) = ANY (v_dub) AND coalesce(e->>'nr', '') !~ '[^[:space:]]' THEN`, `    IF false THEN`]]],
    ['cheia finală duplicată neverificată (același cod, aceeași poziție)', [
      [`    IF v_k = ANY (v_finale) THEN`, `    IF false THEN`],
      [`  IF cardinality(v_finale) <> jsonb_array_length(p_linii) OR (SELECT count(DISTINCT f) FROM unnest(v_finale) f) <> jsonb_array_length(p_linii) THEN`, `  IF false THEN`]]],
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
    ['lipsurile nu declară obiectele încă vechi (oferta_neconfirmata)', [[`   WHERE NOT public.fn_rest_decontat_obiect_confirmat(pr.id, a.obiect_cod::text)\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n$f$;`, `   WHERE false\n   GROUP BY pr.id, public.fn_rest_decontat_cheie(a.obiect_cod::text, NULL, NULL, NULL)\n$f$;`]]],
    ['predicatul stării ignoră istoricul (obiectul scos de server se redeschide pe calea veche)', [[`         OR EXISTS (SELECT 1 FROM public.proiect_articole_istoric h\n                  WHERE h.proiect_id = p_proiect AND h.sursa = 'contract_initial' AND h.confirmat_la IS NOT NULL\n                    AND h.obiect_k = public.fn_rest_decontat_cheie(p_obiect, NULL, NULL, NULL)))`, `         )`]]],
    ['istoricul se scrie fără motivul / amprenta fișierului nou (inlocuire_oferta nedeosebit de confirmare_oferta)', [[`             CASE WHEN m.confirmat_la IS NULL THEN 'confirmare_oferta' ELSE 'inlocuire_oferta' END, p_amprenta`, `             'confirmare_oferta', p_amprenta`]]],
    // (garda istoricului cu marcaj NULL NU e observabilă de client: authenticated n-are INSERT / UPDATE / DELETE pe proiect_articole_istoric —
    //  refuzul de privilegiu vine înaintea trigger-ului; dry-run-ul verifică privilegiile prin postcondiții, nu printr-un mutant al gărzii)
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

// oferta SINTETICĂ „ca proiectul 4” (284 rânduri, calea veche): 4 obiecte × 3 devize; în fiecare deviz codurile se repetă (nr intră în cheie), UM-uri cu
// factor 1 (factorul UM e probat separat); valorile așteptate se calculează AICI, din aceste date, nu din codul testat (L25)
function ofertaSintetica() {
  const obiecte = [['0001', 'TRONSON 1'], ['0002', 'TRONSON 2'], ['0003', 'STATIE ROBINETE'], ['0004', 'ORGANIZARE DE SANTIER']]
  const devize = [['D01', 'Terasamente'], ['D02', 'Montaj conducta'], ['D03', 'Protectii si probe']]
  const coduri = ['TSA01A1', 'TSA02B1', 'TSC17B1', 'TSD01C1', 'GC 01', 'GC 02 A', 'IZ 05', 'RPCT 11', 'M1L05', 'SUD 300', 'TF 01', 'CZ 01']
  const umuri = ['M', 'MC', 'BUC', 'KG', 'MP']
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
const cheieAsteptata = (l, repetat) => `${l.obiect_cod}|${l.deviz_cod}|${l.cod.toUpperCase()}` + (repetat ? `|#${l.nr}` : '')
const asteptatBaza = L => {
  const grup = new Map()
  for (const l of L) { const k = `${l.obiect_cod}|${l.deviz_cod}|${l.cod}`; grup.set(k, (grup.get(k) || 0) + 1) }
  return L.map(l => ({ cheie: cheieAsteptata(l, grup.get(`${l.obiect_cod}|${l.deviz_cod}|${l.cod}`) > 1), c: String(l.cantitate), v: String(l.valoare), randuri: 1 }))
    .sort((a, b) => (a.cheie < b.cheie ? -1 : a.cheie > b.cheie ? 1 : 0))
}
const suma = xs => String(Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100)
// CITITORII VECHI ai proiect_articole (r5, review #1158 P1 r4), cu filtrele EXACTE din cod, pe proiectul 904, grupate pe obiect (ca să se vadă și
// obiectele neimportate): ActivitatiProiectPanel.jsx:53 / lib/verificariProiect.js:67 (sursa <> 'extras_materiale'; cod, cantitate), CatalogDevizPanel.jsx:37
// (select('*') pe proiect, apoi activ !== false în JS), 20261208a fn_executie_tinte_calcul (predicatul JOIN luat VERBATIM din textul migrării, cu v_p = 904,
// obiectele u și prefixele a ca în calcul), DevizVsExecutatTab.jsx:222 (id, obiect_cod, obiect_nume cu obiect_cod nenul → obiectele distincte),
// MaterialeProiectPanel.jsx:29 (sursa = 'extras_materiale'), 20270105b (contract_initial AND activ), fn_rest_decontat_are_oferta.
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
  tinte: predicatTinte && `WITH u(obiect_cod) AS (VALUES ('0001'), ('0002'), ('0003'), ('0004')),
       a(baza_deviz, prefixe) AS (VALUES ('initiala', ARRAY[${PREFIXE.map(p => `'${p}'`).join(', ')}]), ('revizuita', ARRAY['TSA', 'GC']))
     SELECT u.obiect_cod || '/' || a.baza_deviz AS k, count(*)::int AS n, coalesce(sum(art.cantitate), 0)::float8::text AS s
       FROM u JOIN a ON true JOIN public.proiect_articole art ON ${predicatTinte} GROUP BY 1 ORDER BY 1`,
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
    tinte: ob.flatMap(o => [['initiala', PREFIXE], ['revizuita', ['TSA', 'GC']]].map(([b, px]) => `${o}/${b}=${cuPrefix(o, px).length}/${suma(cuPrefix(o, px).map(l => l.cantitate))}`)).join('; '),
    obiecte: `toate=${ob.length}/${ob.join(',')}`,
    materiale: `extras=${extras.length}/${suma(extras.map(e => e.cantitate))}`,
    configurare: `contract_initial activ=${L.length}/-`,
    are_oferta: 'are_oferta=1/-',
  }
}
const liniiRpc = L => L.map(({ obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare }) => ({ obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod, denumire, um, cantitate, pret_unitar, valoare }))
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
  console.log('7. trecerea (a) -> (b) pe un proiect ca proiectul 4 (284 rânduri contract_initial pe calea veche, 4 obiecte): import parțial, obiectele neimportate neatinse, cititorii vechi neschimbați, fără dublare')
  const db = await bazaNoua()
  const L = ofertaSintetica()
  const ast = asteptatBaza(L)
  const cuNr = ast.filter(x => x.cheie.includes('|#')).length
  const total = Math.round(L.reduce((s, l) => s + l.valoare, 0) * 100) / 100
  const L1 = L.filter(l => l.obiect_cod === '0001'), LREST = L.filter(l => l.obiect_cod !== '0001')
  ok(L.length === 284 && new Set(ast.map(x => x.cheie)).size === 284 && L1.length === 71 && LREST.length === 213, `oferta sintetică: 284 rânduri, 284 chei distincte (${cuNr} cu nr în cheie), valoare ${total}; obiectul 0001 = 71 linii, restul 213`)
  ok(!!predicatTinte && /art\.sursa = 'contract_initial'/.test(predicatTinte), `predicatul cititorului 20261208a luat din textul migrării: ${(predicatTinte || 'NEGASIT').slice(0, 120)}…`)
  await proiectSintetic(db, L)
  const j = await aplicaLivrare(db, A, MIG_A, F(A).ob)
  ok(j.some(m => new RegExp(`^20270105a: randuri proiect_articole cu cheie = 292, din care cu nr in cheie = ${cuNr + 2}$`).test(m)), `NOTICE: 292 rânduri cu cheie (5 moștenite + 284 + 3 extras), ${cuNr + 2} cu nr în cheie`)
  const OWNER = 'f0000000-0000-4000-8000-00000000009a'
  await db.exec(`INSERT INTO public.profiles (id, is_owner) VALUES ('${OWNER}', true)`)
  const SQL_BAZA = `SELECT cheie, cantitate::text AS c, valoare::text AS v, randuri FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 904 ORDER BY cheie COLLATE "C"`
  const SQL_SUMA = `SELECT coalesce(sum(valoare), 0)::float8::text AS s, count(*)::int AS n FROM public.v_executie_rest_decontat_baza WHERE proiect_id = 904`
  const numar = async () => q1(db, `SELECT count(*) FILTER (WHERE activ AND confirmat_la IS NULL)::int AS vechi_active, count(*) FILTER (WHERE NOT activ)::int AS retrase,
    count(*) FILTER (WHERE activ AND confirmat_la IS NOT NULL)::int AS confirmate, (SELECT count(*) FROM public.proiect_articole_istoric WHERE proiect_id = 904)::int AS istoric
    FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  const lipsuriOferta = async () => (await caRol(db, 'authenticated', OWNER, `SELECT tip || '=' || referinta AS x FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = 904 AND tip IN ('fara_oferta', 'oferta_neconfirmata', 'oferta_veche_neconfirmata') ORDER BY 1`)).rows.map(r => r.x).join('; ')
  const b0 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b0.err && JSON.stringify(b0.rows) === JSON.stringify(ast), 'baza înainte (toate obiectele vechi) = cele 284 rânduri, cheia cu nr pe codurile repetate: ' + (b0.msg || `${b0.rows.length} chei`))
  const s0 = await caRol(db, 'authenticated', OWNER, SQL_SUMA)
  ok(!s0.err && Number(s0.rows[0].s) === total && s0.rows[0].n === 284, `valoarea bazei înainte = ${total} (284 chei): ${JSON.stringify(s0.rows?.[0] || s0.msg)}`)
  ok((await lipsuriOferta()) === ['0001', '0002', '0003', '0004'].map(o => `oferta_neconfirmata=obiect ${o}: contract_initial 71`).join('; '), 'lipsuri înainte: cele 4 obiecte vechi declarate oferta_neconfirmata (71 rânduri fiecare): ' + (await lipsuriOferta()))
  // cititorii vechi ÎNAINTE: fiecare = valorile așteptate calculate din L (L25)
  const AST_CIT = asteptatCititori(L, EXTRAS)
  const c0 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c0[k] === AST_CIT[k], `cititorul vechi „${k}” înainte = așteptat din date: ${c0[k].slice(0, 150)}${c0[k] === AST_CIT[k] ? '' : ' ≠ ' + AST_CIT[k].slice(0, 150)}`)
  // calea veche încă merge (toate obiectele vechi): un rând în plus, apoi șters
  const i1 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '0001', 'D01', '99', 'PROBA', 'rand vechi in plus', 'M', 1, 10, 'contract_initial') RETURNING id`)
  const d1 = i1.err ? i1 : await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND cod = 'PROBA'`)
  ok(!i1.err && !d1.err && JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 284, retrase: 0, confirmate: 0, istoric: 0 }), 'calea veche merge încă pe obiectele vechi: INSERT + DELETE direct, 284 rânduri vechi active: ' + (i1.msg || d1.msg || 'ok'))
  // IMPORT PARȚIAL: doar obiectul 0001 (71 linii, aceleași ca cele vechi), ca fișierul F3 al unui singur obiect
  const c = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb) AS v`, [JSON.stringify(liniiRpc(L1))])
  const v1 = c.rows?.[0]?.v || {}
  ok(!c.err && v1.inserate === 71 && v1.inlocuite === 71 && v1.inlocuite_confirmate === 0 && JSON.stringify(v1.obiecte) === '["0001||"]', 'import parțial 0001 prin RPC: inserate 71, inlocuite 71 (mutate în istoric), 0 confirmate înlocuite, obiecte ["0001||"]: ' + (c.msg || JSON.stringify({ inserate: v1.inserate, inlocuite: v1.inlocuite, inlocuite_confirmate: v1.inlocuite_confirmate, obiecte: v1.obiecte })))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 213, retrase: 0, confirmate: 71, istoric: 71 }), 'după importul parțial: 71 confirmate + 213 vechi active (0002–0004 NEATINSE), 0 retrase în tabel, 71 în istoric: ' + JSON.stringify(await numar()))
  const b1 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b1.err && JSON.stringify(b1.rows) === JSON.stringify(ast), 'baza după importul parțial IDENTICĂ (0001 confirmat + 0002–0004 cu valoarea veche): ' + (b1.msg || `${b1.rows.length} chei`))
  ok((await lipsuriOferta()) === ['0002', '0003', '0004'].map(o => `oferta_neconfirmata=obiect ${o}: contract_initial 71`).join('; '), 'lipsuri după importul parțial: obiectele 0002–0004 încă vechi declarate, 0001 nu: ' + (await lipsuriOferta()))
  const c1 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c1[k] === c0[k], `cititorul vechi „${k}” după importul parțial = înainte (0001: exact rândurile confirmate; 0002–0004: neatinse): ${c1[k].slice(0, 150)}${c1[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  // calea veche pe un obiect NEIMPORTAT merge încă; pe 0001 e închisă
  const i2 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '0002', 'D01', '99', 'PROBA2', 'rand vechi pe obiect vechi', 'M', 1, 10, 'contract_initial') RETURNING id`)
  const d2 = i2.err ? i2 : await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND cod = 'PROBA2'`)
  ok(!i2.err && !d2.err, 'calea veche merge pe obiectul neimportat 0002 după confirmarea lui 0001 (INSERT + DELETE): ' + (i2.msg || d2.msg || 'ok'))
  const i3 = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '0001', 'D01', '1', 'TSA01A1', 'Articol sintetic 1', 'M', 1, 5, 'contract_initial')`)
  ok(i3.err === '42501' && /obiectul 0001 al proiectului 904 are oferta confirmata.*Rest de decontat/.test(i3.msg || ''), 'calea veche pe obiectul confirmat 0001: refuz 42501 cu mesajul „Rest de decontat”: ' + (i3.msg || 'TRECE'))
  // confirmarea restului (0002–0004, 213 linii) FĂRĂ „înlocuiește”: trece (nu 23505)
  const c2 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_rest.xlsx', repeat('45', 32), $1::jsonb) AS v`, [JSON.stringify(liniiRpc(LREST))])
  const v2 = c2.rows?.[0]?.v || {}
  ok(!c2.err && v2.inserate === 213 && v2.inlocuite === 213 && v2.inlocuite_confirmate === 0 && JSON.stringify(v2.obiecte) === '["0002||","0003||","0004||"]', 'confirmarea târzie a obiectelor 0002–0004 (fără inlocuieste): inserate 213, inlocuite 213: ' + (c2.msg || JSON.stringify({ inserate: v2.inserate, inlocuite: v2.inlocuite, obiecte: v2.obiecte })))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 284 }), '284 rânduri confirmate active, 0 vechi, 0 retrase în tabel, 284 în istoric: ' + JSON.stringify(await numar()))
  const b2 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b2.err && JSON.stringify(b2.rows) === JSON.stringify(ast), 'baza după confirmarea completă IDENTICĂ cu cea dinainte (284 chei, câte 1 rând, aceleași cantități): fără dublare: ' + (b2.msg || `${b2.rows.length} chei`))
  const s2 = await caRol(db, 'authenticated', OWNER, SQL_SUMA)
  ok(!s2.err && Number(s2.rows[0].s) === total && s2.rows[0].n === 284, `valoarea bazei după confirmare = ${total} (nu ${total * 2}): ${JSON.stringify(s2.rows?.[0] || s2.msg)}`)
  ok((await lipsuriOferta()) === '', 'fără lipsuri de ofertă după confirmarea completă: ' + ((await lipsuriOferta()) || 'niciuna'))
  const c2c = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c2c[k] === c0[k], `cititorul vechi „${k}” după confirmarea completă = înainte (284 → 284, aceleași valori): ${c2c[k].slice(0, 150)}${c2c[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  // re-importul lui 0001: fără „înlocuiește” = 23505; cu „înlocuiește” (aceleași linii, alt fișier) = 71 confirmate înlocuite, cititorii tot identici
  const r1 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1_v2.xlsx', repeat('46', 32), $1::jsonb) AS v`, [JSON.stringify(liniiRpc(L1))])
  ok(r1.err === '23505' && /obiectele 0001\|\|.*inlocuieste/.test(r1.msg || ''), 're-importul obiectului confirmat 0001 fără inlocuieste: refuz 23505: ' + (r1.msg || 'TRECE'))
  const r2 = await caRol(db, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1_v2.xlsx', repeat('46', 32), $1::jsonb, true) AS v`, [JSON.stringify(liniiRpc(L1))])
  const v3 = r2.rows?.[0]?.v || {}
  ok(!r2.err && v3.inserate === 71 && v3.inlocuite === 71 && v3.inlocuite_confirmate === 71, 're-importul lui 0001 cu inlocuieste: inserate 71, inlocuite 71, toate confirmate înlocuite: ' + (r2.msg || JSON.stringify(v3)))
  ok(JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 355 }), 'după înlocuire: 284 confirmate, 0 retrase în tabel, 355 în istoric (284 vechi + 71 confirmate înlocuite): ' + JSON.stringify(await numar()))
  const h = await q1(db, `SELECT count(*) FILTER (WHERE motiv = 'inlocuire_oferta' AND confirmat_la IS NOT NULL AND obiect_k = '0001||' AND inlocuit_cu_amprenta = repeat('46', 32))::int AS inl, count(*) FILTER (WHERE motiv = 'confirmare_oferta' AND confirmat_la IS NULL)::int AS conf, count(DISTINCT obiect_k)::int AS ob FROM public.proiect_articole_istoric WHERE proiect_id = 904`)
  ok(h.inl === 71 && h.conf === 284 && h.ob === 4, `istoricul: 71 rânduri confirmate înlocuite (motiv inlocuire_oferta, amprenta fișierului nou) + 284 vechi (confirmare_oferta), 4 obiecte: ${JSON.stringify(h)}`)
  const c3 = await cititori(db, OWNER)
  for (const k of Object.keys(CITITORI)) ok(c3[k] === c0[k], `cititorul vechi „${k}” după înlocuire = înainte: ${c3[k].slice(0, 150)}${c3[k] === c0[k] ? '' : ' ≠ ' + c0[k].slice(0, 150)}`)
  const b3 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b3.err && JSON.stringify(b3.rows) === JSON.stringify(ast), 'baza după înlocuire IDENTICĂ: ' + (b3.msg || `${b3.rows.length} chei`))
  // reimportul vechi (ca CatalogDevizPanel: DELETE pe toată oferta, apoi INSERT) = refuz cu mesajul clar; baza și rândurile neschimbate
  const rd = await caRol(db, 'authenticated', OWNER, `DELETE FROM public.proiect_articole WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  ok(rd.err === '42501', 'reimportul vechi după confirmare, pasul DELETE: refuz 42501: ' + (rd.msg || 'TRECE'))
  const ri = await caRol(db, 'authenticated', OWNER, `INSERT INTO public.proiect_articole (proiect_id, obiect_cod, deviz_cod, nr, cod, denumire, um, cantitate, valoare, sursa) VALUES (904, '0003', 'D01', '1', 'TSA01A1', 'Articol sintetic', 'M', 1, 5, 'contract_initial')`)
  ok(ri.err === '42501' && /obiectul 0003 al proiectului 904 are oferta confirmata.*Rest de decontat/.test(ri.msg || ''), 'reimportul vechi după confirmare, pasul INSERT (obiect confirmat târziu): refuz 42501 cu mesajul „Rest de decontat”: ' + (ri.msg || 'TRECE'))
  const ru = await caRol(db, 'authenticated', OWNER, `UPDATE public.proiect_articole SET cantitate = cantitate + 1 WHERE proiect_id = 904 AND sursa = 'contract_initial'`)
  ok(ru.err === '42501', 'modificarea directă a rândurilor confirmate: refuz 42501: ' + (ru.msg || 'TRECE'))
  const b4 = await caRol(db, 'authenticated', OWNER, SQL_BAZA)
  ok(!b4.err && JSON.stringify(b4.rows) === JSON.stringify(ast) && JSON.stringify(await numar()) === JSON.stringify({ vechi_active: 0, retrase: 0, confirmate: 284, istoric: 355 }), 'după refuzuri: baza și rândurile neschimbate')
  ok(/randuri confirmate|date scrise|istoricul ofertei/.test(await eroare(revinoA(db)) || ''), 'revenirea A pe proiectul confirmat = refuz (date scrise de calea nouă)')
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
      const cm = eA ? { err: eA } : await caRol(dbm, 'authenticated', OWNER, `SELECT public.fn_rest_decontat_confirma_baza(904, 'contract_initial', NULL, NULL, NULL, 'F3_proiect4_ob1.xlsx', repeat('44', 32), $1::jsonb) AS v`, [JSON.stringify(liniiRpc(L1))])
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
}

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
