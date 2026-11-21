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
//    rândul neconfirmat, lipsurile fără „rand_neautorizat”. Mutanții STATICI (reverificarea dreptului scoasă după lock) sunt prinși de
//    verificarea pe text din 0.
// 5. Migrarea B peste A: dry-run B; mutanți B (MP fără ofertă acceptat, owner fără motiv acceptat, fără garda pe coloane, marcaj NULL acceptat,
//    garda doar pe UPDATE — INSERT „configurat” acceptat); revenirea B. Postcondițiile B = secțiunea „4.” (r2: markerul greșit din r1 ascundea
//    mutanții B neaplicați).
// 6. Revenirile: refuzuri (fără marcaj, cu date, amprentă schimbată, B aplicată peste A), aplicare → revenire → reaplicare, starea de dinainte.
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
  't_drept_sef_santier (1/3) ok', 't_drept_sef_santier (2/3) ok', 't_drept_sef_santier (3/3) ok', 't_rand_orfan ok']
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
    ['calculul numără rândul AA / NR / NCS neconfirmat sau orfan', [[`       AND public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)),`, `),`]]],
    ['lipsurile nu declară rândurile neautorizate', [[`   WHERE NOT public.fn_rest_decontat_sursa_autorizata(a.sursa::text, a.nota_id, a.act_aditional_id, a.confirmat_la)`, `   WHERE false`]]],
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

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
