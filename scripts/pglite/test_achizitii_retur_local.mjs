// Proba LOCALĂ a migrării 20270110a (Achiziții: retur la furnizor, PR1 = baza de date) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270110a_achizitii_retur_furnizor_schelet.sql (forma de pe producție a tabelelor atinse, funcțiile de care
// depinde migrarea cu corpul exact, rolurile Supabase, privilegiile implicite, auth.uid()). Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii
// L15 v2 generați: manifestul cu ROLLBACK, apoi livrarea aprobată + garda finală reală). Datele: sintetice (CMD_T_*, MAT_A / MAT_B, P1 / P2).
// Secțiuni (--sectiune t0,t1,…; implicit toate):
//   t0  validatorul runnerului, refuzurile migrării, livrarea L15 v2 (manifestul = lista revizuită), blocul AMPRENTA identic în migrare și revenire
//   t1  tabelele noi: RLS, drepturi, CHECK-urile (tip / sens / intrata <= primita), reaplicarea
//   t2  lock-ul pe stoc (ieșiri, ștergeri), istoricul protejat, ștergerea poziției, clientul vechi, identitatea, mutarea liniei (r2), cheia exactă,
//       ordinea cheilor de stoc la predare / transport direct (r2)
//   t3  recepția incrementală (CAS), soldul inițial, dovada pe NULL, predarea atomică, transportul direct, moștenirea nereconciliată
//   t4  returul, anularea, închiderea, compensarea cronologică, zecimalele, comenzile invalide, dreptul (non-owner, retras; r2: retras la ultima
//       operație care poate aștepta), idempotența,
//       cererile interne neschimbate, test de proprietate (200 de secvențe)
//   t5  porțile care au blocat livrări pe clonă: GATE 0e (scripts/control_0e.sql, verbatim) și poarta Izometrie E2 (blocul din 20261230a)
//   t6  revenirea: refuzuri (marcaj, istoric nou, amprentă), aplicare → revenire → reaplicare, starea de dinainte
//   t7  MUTANȚI ai migrării (fiecare TREBUIE prins de comportament; cu postcondițiile întregi, refuzat la aplicare)
// Concurența reală (două sesiuni + barieră) nu se poate în PGlite (o conexiune): supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_achizitii_retur_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat; --secvente N schimbă numărul de secvențe al testului de proprietate)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'retur_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const NUME = '20270110a_achizitii_retur_furnizor'
const F_MIG = `supabase/migrations/${NUME}.sql`
const F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`
const F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste(`supabase/tests/${NUME}_schelet.sql`)
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const SECTIUNI = (arg('--sectiune') || 't0,t1,t2,t3,t4,t5,t6,t7,t8,t9').split(',')
const ruleaza = s => SECTIUNI.includes(s)
const NR_SECVENTE = Number(arg('--secvente') || 200)
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })

// ── identitățile și datele de bază (sintetice) ──
const U = {
  OWN: '00000000-0000-4000-8000-000000000001',   // owner
  ACH: '00000000-0000-4000-8000-000000000002',   // achiziții (can_process_achizitii + modulul achizitii)
  FARA: '00000000-0000-4000-8000-000000000003',  // cont logat fără drept
  MP: '00000000-0000-4000-8000-000000000004',    // can_create_comenzi, FĂRĂ modulul achizitii → fără drept
  SUB: '00000000-0000-4000-8000-000000000005',   // can_create_comenzi + sub-modul 'achizitii.comenzi'
}
const P1 = 1, P2 = 2
const DATE = `
INSERT INTO public.profiles (id, is_owner, can_create_comenzi, can_process_achizitii, role) VALUES
  ('${U.OWN}', true, false, false, 'admin'), ('${U.ACH}', false, false, true, 'achizitii'), ('${U.FARA}', false, false, false, 'teren'),
  ('${U.MP}', false, true, false, 'manager'), ('${U.SUB}', false, true, false, 'manager');
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ACH}', 'achizitii', 'editor'), ('${U.FARA}', 'magazie', 'editor'),
  ('${U.MP}', 'executie', 'editor'), ('${U.SUB}', 'achizitii.comenzi', 'viewer');
INSERT INTO public.comenzi (numar_comanda, deschis_de, status, proiect_id) VALUES ('CI_T_001', '${U.MP}', 'in_lucru', ${P1});
INSERT INTO public.comanda_linii (comanda_id, denumire, um, cantitate) VALUES (1, 'MAT_C', 'buc', 10);`
async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(DATE)
  return db
}
const blocAmprenta = t => { const i = t.indexOf('AMPRENTA_20270110a_INCEPUT'), j = t.indexOf('-- AMPRENTA_20270110a_SFARSIT'); return i < 0 || j < 0 ? null : t.slice(t.indexOf('\n', i) + 1, j) }
const constanteAmprenta = t => [...t.matchAll(/IS DISTINCT FROM '([0-9a-f]{32})' THEN\n    RAISE NOTICE 'AMPRENTA_20270110a_TEXT/g)].map(x => x[1])
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const T = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', T, aprobat)
  const dupa = l15 === 'livrare' ? gen('dupa', T, aprobat, manifest) : ''
  const jurnal = []
  try {
    await db.exec('RESET ROLE; ' + pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n' + dupa, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
async function aplicaLivrare(db, text = MIG, { verificaLista = true } = {}) {
  let jg = []
  try { jg = await caRunner(db, NUME, text, { l15: 'livrare', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270110a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n`
    + fara18.join('\n') + '\n')
  if (verificaLista) {
    const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
    const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
    ok(G && fara18.length > 0 && !lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte, fără NOT NULL PG18) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  }
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await caRunner(db, NUME, text, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  if (verificaLista) ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)), 'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat')
  return j
}
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const q1 = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const val = async (db, sql, p) => { const r = await q1(db, sql, p); return r ? Object.values(r)[0] : undefined }
// o instrucțiune ca un rol al aplicației (L25: SET LOCAL ROLE + claim-ul sub, ca PostgREST); întoarce rândurile sau codul erorii
async function caRol(db, rol, uid, sql, params) {
  await db.exec(`RESET ROLE; BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', true);`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { rows: r.rows, n: r.affectedRows ?? r.rows.length } }
  catch (e) { await db.exec('ROLLBACK'); return { err: e.code || 'X', msg: e.message, cod: (e.message.match(/^(CF_[A-Z_]+):/) || [])[1] || e.code } }
}
// apelul unui RPC ca PostgREST (authenticated + JWT), cu argumente pe nume; r = jsonb-ul întors
let nrCheie = 0
const cheie = () => { nrCheie++; return `00000000-0000-4000-8000-${String(nrCheie).padStart(12, '0')}` }
async function rpc(db, uid, fn, args) {
  const nume = Object.keys(args)
  const sql = `SELECT public.${fn}(${nume.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`
  const r = await caRol(db, 'authenticated', uid, sql, nume.map(k => args[k]))
  return r.err ? r : { r: r.rows[0].r }
}
// ca postgres, cu marcajul RPC-urilor (doar pentru fixturi: liniile „vechi”, cu cantități scrise înainte de migrare)
async function caServer(db, sql, p) { await db.exec("RESET ROLE; BEGIN; SET LOCAL app.cf_cantitati = '1';"); try { const r = await db.query(sql, p); await db.exec('COMMIT'); return r } catch (e) { await db.exec('ROLLBACK'); throw e } }
let nrCmd = 0
async function comanda(db, { status = 'emisa', livrare_tip = 'sediu', proiect_id = P1, este_servicii = false, receptie_mp_la = null } = {}) {
  nrCmd++
  return Number(await val(db, `INSERT INTO public.comenzi_furnizor (numar_comanda, proiect_id, livrare_tip, status, este_servicii, receptie_mp_la)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [`CMD_T_${String(nrCmd).padStart(3, '0')}`, proiect_id, livrare_tip, status, este_servicii, receptie_mp_la]))
}
// o linie de test; cu cantități date = „linie veche” (scrisă înaintea migrării); rec = marcajul moștenirii (implicit reconciliată)
async function linie(db, cf, { denumire = 'MAT_A', um = 'buc', cantitate = 100, primita = null, intrata = 0, pret = null, comanda_linie_id = null, rec = true } = {}) {
  const r = await caServer(db, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate, cantitate_primita, cantitate_intrata_stoc, pret_unitar, comanda_linie_id, intrare_reconciliata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [cf, denumire, um, cantitate, primita, intrata, pret, comanda_linie_id, rec])
  return Number(r.rows[0].id)
}
const L = async (db, id) => q1(db, `SELECT cantitate_primita::text AS primita, cantitate_intrata_stoc::text AS intrata, intrare_reconciliata AS rec, denumire FROM public.comenzi_furnizor_linii WHERE id = $1`, [id])
const stoc = async (db, tip, id, den) => {
  const r = await q1(db, `SELECT coalesce(sum(cantitate), 0)::text AS c FROM public.stocuri WHERE locatie_tip = $1 AND locatie_id IS NOT DISTINCT FROM $2::bigint AND material_denumire = $3`, [tip, id, den])
  return Number(r.c)
}
// intrare în stoc „de pe altă cale” (ajustare manuală), ca să existe marfă pe o poziție
const ajustare = (db, uid, tip, id, den, delta) => caRol(db, 'authenticated', uid, `SELECT public.fn_stoc_ajustare($1, $2::bigint, $3, 'buc', $4::numeric, 'proba ajustare') AS r`, [tip, id, den, delta])
const R = (db, uid, a) => rpc(db, uid, 'fn_cf_receptie_adauga', { p_cheie: a.cheie || cheie(), p_linie_id: a.linie, p_cantitate: a.n, p_primita_citita: a.citita ?? null })
const INTRA = (db, uid, a) => rpc(db, uid, 'fn_cf_intra_stoc', { p_cheie: a.cheie || cheie(), p_linie_id: a.linie, p_cantitate: a.n, p_transfer_proiect: a.transfer || false })
const RET = (db, uid, a) => rpc(db, uid, 'fn_cf_retur_inregistreaza', { p_cheie: a.cheie || cheie(), p_linie_id: a.linie, p_cantitate: a.n, p_din_stoc: a.din ?? null,
  p_locatie_tip: a.loc || 'sediu', p_locatie_id: a.locId ?? null, p_motiv: a.motiv || 'reper neconform', p_pv_path: a.pv ?? null, p_asteapta_inlocuire: a.asteapta ?? true })
const ANUL = (db, uid, a) => rpc(db, uid, 'fn_cf_retur_anuleaza', { p_cheie: a.cheie || cheie(), p_retur_id: a.retur, p_motiv: a.motiv || 'retur gresit' })
const INCH = (db, uid, a) => rpc(db, uid, 'fn_cf_retur_inchide_fara_inlocuire', { p_cheie: a.cheie || cheie(), p_retur_id: a.retur, p_motiv: a.motiv || 'furnizorul nu mai livreaza' })
const RECON = (db, uid, a) => rpc(db, uid, 'fn_cf_reconciliaza_linie', { p_cheie: a.cheie || cheie(), p_linie_id: a.linie, p_intrata_stoc: a.n, p_motiv: a.motiv || 'reconciliere manuala' })
const primitaCitita = async (db, id) => { const r = await L(db, id); return r.primita == null ? null : Number(r.primita) }
// starea completă a unei linii (pentru „nimic schimbat după refuz”)
const stareLinie = async (db, id) => JSON.stringify(await q1(db, `SELECT
  (SELECT row_to_json(l) FROM public.comenzi_furnizor_linii l WHERE l.id = $1) AS l,
  (SELECT json_agg(t ORDER BY t.id) FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = $1) AS t,
  (SELECT json_agg(r ORDER BY r.id) FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = $1) AS r,
  (SELECT json_agg(a ORDER BY a.id) FROM public.comenzi_furnizor_retur_alocari a JOIN public.comenzi_furnizor_receptii r ON r.id = a.receptie_id WHERE r.linie_id = $1) AS a,
  (SELECT json_agg(s ORDER BY s.id) FROM public.stocuri s) AS s, (SELECT count(*) FROM public.stocuri_miscari) AS m, (SELECT count(*) FROM public.comenzi_furnizor_intentii) AS i`, [id]))
// suma mișcărilor de stoc legate de linie (intrări pe linie + retururi / anulări ale liniei) — sursa independentă a invariantului 1
const miscariLinie = async (db, id) => Number(await val(db, `SELECT coalesce(sum(m.delta), 0)::text FROM public.stocuri_miscari m
  WHERE (m.ref_tip = 'comanda_furnizor_linie' AND m.ref_id = $1)
     OR (m.ref_tip = 'comanda_furnizor_retur' AND m.ref_id IN (SELECT t.id FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = $1))`, [id]))
const jurnal = async (db, id) => Number(await val(db, `SELECT coalesce(sum(CASE WHEN tip = 'corectura' THEN -cantitate ELSE cantitate END), 0)::text FROM public.comenzi_furnizor_receptii WHERE linie_id = $1`, [id]))
const returNet = async (db, id) => Number(await val(db, `SELECT coalesce(sum(t.cantitate), 0)::text FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = $1 AND t.tip = 'retur'
  AND NOT EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi a WHERE a.retur_id = t.id)`, [id]))
const deInlocuit = async (db, id) => Number(await val(db, `SELECT coalesce(sum(cantitate - cantitate_inlocuita - cantitate_renuntata), 0)::text FROM public.comenzi_furnizor_retururi
  WHERE linie_id = $1 AND tip = 'retur' AND asteapta_inlocuire AND inchis_fel IS NULL`, [id]))
const retur = async (db, id) => q1(db, `SELECT cantitate::text AS q, din_stoc::text AS din, cantitate_inlocuita::text AS inl, cantitate_renuntata::text AS ren, asteapta_inlocuire AS ast,
  inchis_fel AS fel, stoc_miscare_id AS mid, locatie_tip AS loc, locatie_id AS loc_id, denumire FROM public.comenzi_furnizor_retururi WHERE id = $1`, [id])

// ── verificările de comportament (aceleași pentru aplicarea corectă și pentru mutanți); întoarce abaterile ──
async function verifica(db, { doar = null } = {}) {
  const ab = []
  const tine = (cond, msg) => { if (!cond) ab.push(msg) }
  const are = n => !doar || doar.includes(n)
  if (are('client_vechi')) {
    // t_client_vechi: ca authenticated = drept pe coloană (42501); ca postgres fără marcaj = CF_CLIENT_VECHI; inserarea cu cantități = refuz; mișcarea veche de intrare = refuz
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf)
    const a = await caRol(db, 'authenticated', U.ACH, 'UPDATE public.comenzi_furnizor_linii SET cantitate_primita = 100 WHERE id = $1', [l])
    const b = await eroare(db.query('UPDATE public.comenzi_furnizor_linii SET cantitate_primita = 100 WHERE id = $1', [l]))
    const c = await eroare(db.query('UPDATE public.comenzi_furnizor_linii SET cantitate_intrata_stoc = 1 WHERE id = $1', [l]))
    const d = await caRol(db, 'service_role', null, 'UPDATE public.comenzi_furnizor_linii SET intrare_reconciliata = NOT intrare_reconciliata WHERE id = $1', [l])
    const e = await caRol(db, 'authenticated', U.ACH, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate, cantitate_primita) VALUES ($1, 'MAT_A', 'buc', 5, 5)`, [cf])
    const f = await caRol(db, 'authenticated', U.ACH, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, um, delta, tip, ref_tip, ref_id) VALUES ('sediu', 'MAT_A', 'buc', 5, 'intrare_achizitie', 'comanda_furnizor', $1)`, [cf])
    const g = await caRol(db, 'authenticated', U.ACH, 'UPDATE public.comenzi_furnizor_linii SET termen_livrare = current_date, observatii = $2 WHERE id = $1', [l, 'obs'])
    tine(a.err === '42501' && /CF_CLIENT_VECHI/.test(b || '') && /CF_CLIENT_VECHI/.test(c || '') && d.cod === 'CF_CLIENT_VECHI' && e.cod === 'CF_CLIENT_VECHI'
      && f.cod === 'CF_CLIENT_VECHI' && !g.err && g.n === 1 && (await L(db, l)).primita == null,
      `t_client_vechi: authenticated 42501 / postgres + service_role CF_CLIENT_VECHI / inserare cu cantități / mișcare veche refuzate; termenul se editează (${[a.err, b, c, d.cod, e.cod, f.cod, g.err || g.n].map(x => String(x).slice(0, 40)).join(' / ')})`)
  }
  if (are('identitate')) {
    // t2_identitate: comandă recepționată cu primita NULL → redenumirea refuzată; comandă emisă fără recepție → merge; după recepție → refuzată
    const cf = await comanda(db, { status: 'receptionata' }); const l = await linie(db, cf, { denumire: 'MAT_A' })
    const a = await caRol(db, 'authenticated', U.ACH, `UPDATE public.comenzi_furnizor_linii SET denumire = 'MAT_B' WHERE id = $1`, [l])
    const a2 = await caRol(db, 'authenticated', U.ACH, `UPDATE public.comenzi_furnizor_linii SET cantitate = 7 WHERE id = $1`, [l])
    const cf2 = await comanda(db, { status: 'emisa' }); const l2 = await linie(db, cf2, { denumire: 'MAT_A' })
    const b = await caRol(db, 'authenticated', U.ACH, `UPDATE public.comenzi_furnizor_linii SET denumire = 'MAT_B', cantitate = 50 WHERE id = $1`, [l2])
    const r = await R(db, U.ACH, { linie: l2, n: 10, citita: null })
    const c = await caRol(db, 'authenticated', U.ACH, `UPDATE public.comenzi_furnizor_linii SET um = 'kg' WHERE id = $1`, [l2])
    const cf3 = await comanda(db, { status: 'ajunsa', receptie_mp_la: '2026-11-20T10:00:00Z' }); const l3 = await linie(db, cf3, { denumire: 'MAT_A' })
    const d = await caRol(db, 'authenticated', U.ACH, `UPDATE public.comenzi_furnizor_linii SET denumire = 'MAT_X' WHERE id = $1`, [l3])
    tine(a.cod === 'CF_MATERIAL_RECEPTIONAT' && a2.cod === 'CF_MATERIAL_RECEPTIONAT' && !b.err && b.n === 1 && !r.err && c.cod === 'CF_MATERIAL_RECEPTIONAT' && d.cod === 'CF_MATERIAL_RECEPTIONAT',
      `t2_identitate: NULL recepționat (denumire / cantitate) refuzat, emisă fără recepție merge, după recepție um refuzat, receptie_mp_la = dovadă (${[a.cod, a2.cod, b.err || b.n, r.cod || 'ok', c.cod, d.cod].join(' / ')})`)
    // identitatea folosită: predarea și returul pe linia NULL recepționată ating doar stocul lui MAT_A, nu MAT_B din aceeași locație
    await ajustare(db, U.OWN, 'sediu', null, 'MAT_B', 30)
    const sB = await stoc(db, 'sediu', null, 'MAT_B'), sA = await stoc(db, 'sediu', null, 'MAT_A')
    const i1 = await INTRA(db, U.ACH, { linie: l, n: 100 }), t1 = await RET(db, U.ACH, { linie: l, n: 20 })
    tine(!i1.err && !t1.err && await stoc(db, 'sediu', null, 'MAT_B') === sB && await stoc(db, 'sediu', null, 'MAT_A') === sA + 80,
      `identitatea: predarea + returul ating doar MAT_A (${i1.cod || 'ok'} / ${t1.cod || 'ok'} / A ${sA} → ${await stoc(db, 'sediu', null, 'MAT_A')} / B ${sB} → ${await stoc(db, 'sediu', null, 'MAT_B')})`)
    if (!t1.err) {
      const an = await ANUL(db, U.ACH, { retur: t1.r.retur_id })
      tine(!an.err && await stoc(db, 'sediu', null, 'MAT_B') === sB && await stoc(db, 'sediu', null, 'MAT_A') === sA + 100, `anularea pune la loc doar în MAT_A (${an.cod || 'ok'})`)
    }
  }
  if (are('cheie_exacta')) {
    // t_cheie_exacta: „MAT_A” și „mat_a ” în aceeași locație sunt chei diferite; returul pe MAT_A nu atinge „mat_a ”
    await ajustare(db, U.OWN, 'sediu', null, 'mat_a ', 40)
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_A', cantitate: 10 })
    await R(db, U.ACH, { linie: l, n: 10, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 10 })
    const s0 = await stoc(db, 'sediu', null, 'mat_a '), a0 = await stoc(db, 'sediu', null, 'MAT_A')
    const t = await RET(db, U.ACH, { linie: l, n: 10 })
    tine(!t.err && await stoc(db, 'sediu', null, 'mat_a ') === s0 && await stoc(db, 'sediu', null, 'MAT_A') === a0 - 10, `t_cheie_exacta: returul pe MAT_A nu atinge „mat_a ” (${t.cod || 'ok'})`)
  }
  if (are('stergere')) {
    // t2_stergere_protejata + fn_stoc_sterge_pozitie
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_DEL', cantitate: 5 })
    await R(db, U.ACH, { linie: l, n: 5, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 5 })
    const mid = await val(db, `SELECT id FROM public.stocuri_miscari WHERE ref_tip = 'comanda_furnizor_linie' AND ref_id = $1`, [l])
    const sid = await val(db, `SELECT id FROM public.stocuri WHERE material_denumire = 'MAT_DEL'`)
    const a = await caRol(db, 'authenticated', U.OWN, 'DELETE FROM public.stocuri_miscari WHERE id = $1', [mid])
    const a2 = await caRol(db, 'authenticated', U.OWN, `UPDATE public.stocuri_miscari SET delta = 50 WHERE id = $1`, [mid])
    const b = await rpc(db, U.OWN, 'fn_stoc_sterge_pozitie', { p_stoc_id: sid })
    const b2 = await caRol(db, 'authenticated', U.OWN, 'DELETE FROM public.stocuri WHERE id = $1', [sid])
    await ajustare(db, U.OWN, 'sediu', null, 'MAT_LIBER', 7)
    const sid2 = await val(db, `SELECT id FROM public.stocuri WHERE material_denumire = 'MAT_LIBER'`)
    const c = await rpc(db, U.ACH, 'fn_stoc_sterge_pozitie', { p_stoc_id: sid2 })
    const d = await rpc(db, U.OWN, 'fn_stoc_sterge_pozitie', { p_stoc_id: sid2 })
    const ramase = Number(await val(db, `SELECT count(*)::int FROM public.stocuri_miscari WHERE material_denumire = 'MAT_LIBER'`)) + Number(await val(db, `SELECT count(*)::int FROM public.stocuri WHERE material_denumire = 'MAT_LIBER'`))
    tine(a.cod === 'CF_ISTORIC_PROTEJAT' && a2.cod === 'CF_ISTORIC_PROTEJAT' && b.cod === 'CF_ISTORIC_PROTEJAT' && b2.cod === 'CF_ISTORIC_PROTEJAT' && c.err === '42501'
      && !d.err && d.r.miscari_sterse === 1 && ramase === 0,
      `t2_stergere_protejata: DELETE / UPDATE pe intrare / poziție protejată refuzate; ștergerea unei poziții fără istoric: non-owner 42501, owner șterge tot (${[a.cod, a2.cod, b.cod, b2.cod, c.err, d.cod || JSON.stringify(d.r), ramase].join(' / ')})`)
  }
  if (are('lock')) {
    // t2_ajustare_ia_lock: ieșirea manuală (ajustare minus) ține lock-ul consultativ pe cheia stocului până la COMMIT (PGlite secvențial: pg_locks)
    await ajustare(db, U.OWN, 'sediu', null, 'MAT_LOCK', 10)
    await db.exec("RESET ROLE; BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '" + U.OWN + "', true); SELECT public.fn_stoc_ajustare('sediu', NULL, 'MAT_LOCK', 'buc', -3, 'proba lock');")
    const n = Number((await db.query(`WITH k AS (SELECT hashtextextended('stoc|sediu|0|MAT_LOCK', 0) AS v)
      SELECT count(*)::int AS n FROM pg_locks, k WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND objsubid = 1
        AND classid::text::bigint = ((k.v >> 32) & 4294967295) AND objid::text::bigint = (k.v & 4294967295)`)).rows[0].n)
    await db.exec('ROLLBACK')
    const n2 = Number((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)).rows[0].n)
    tine(n === 1 && n2 === 0, `t2_ajustare_ia_lock: lock-ul cheii ținut în tranzacția ieșirii (${n}), eliberat după (${n2})`)
    // returul ia lock-ul cheii ÎNAINTE să citească stocul (apel la nivelul RPC-ului, nu doar trigger-ul mișcării)
    await db.exec(`RESET ROLE; CREATE TABLE IF NOT EXISTS public.t_jurnal_lock (id serial, adancime int, cheie text);
      ALTER FUNCTION public.fn_stoc_cheie_lock(text, bigint, text) RENAME TO fn_stoc_cheie_lock_orig;
      CREATE FUNCTION public.fn_stoc_cheie_lock(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN INSERT INTO public.t_jurnal_lock (adancime, cheie) VALUES (pg_trigger_depth(), p_locatie_tip || '|' || coalesce(p_locatie_id, 0) || '|' || p_denumire);
        PERFORM public.fn_stoc_cheie_lock_orig(p_locatie_tip, p_locatie_id, p_denumire); END $f$;`)
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_LOCK2', cantitate: 10 })
    await R(db, U.ACH, { linie: l, n: 10, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 10 })
    await db.exec('TRUNCATE public.t_jurnal_lock')
    const t = await RET(db, U.ACH, { linie: l, n: 4 })
    const jr = (await db.query(`SELECT adancime, cheie FROM public.t_jurnal_lock ORDER BY id`)).rows
    await db.exec(`DROP FUNCTION public.fn_stoc_cheie_lock(text, bigint, text); ALTER FUNCTION public.fn_stoc_cheie_lock_orig(text, bigint, text) RENAME TO fn_stoc_cheie_lock; DROP TABLE public.t_jurnal_lock;`)
    tine(!t.err && jr.length >= 1 && jr[0].adancime === 0 && jr[0].cheie === 'sediu|0|MAT_LOCK2', `returul: primul lock pe cheie e al RPC-ului (înaintea citirii stocului): ${JSON.stringify(jr)}`)
  }
  if (are('ordine_chei')) {
    // c_ordine_chei (r2, L06): predarea și transportul direct iau lock-urile consultative pe TOATE cheile atinse (sediul ȘI proiectul), la nivelul
    // RPC-ului, sortate după fn_stoc_cheie, ÎNAINTEA primei mișcări / scrieri în stocuri; după prima mișcare nu se mai cere nicio cheie nouă
    // (r1: intrarea ținea rândul sediului, iar transferul cerea abia apoi cheia lui = deadlock cu un retur care ține cheia și așteaptă rândul)
    await db.exec(`RESET ROLE; CREATE TABLE public.t_jurnal_ord (id serial, ev text, adancime int, cheie text);
      ALTER FUNCTION public.fn_stoc_cheie_lock(text, bigint, text) RENAME TO fn_stoc_cheie_lock_orig;
      CREATE FUNCTION public.fn_stoc_cheie_lock(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN INSERT INTO public.t_jurnal_ord (ev, adancime, cheie) VALUES ('lock', pg_trigger_depth(), p_locatie_tip || '|' || coalesce(p_locatie_id, 0) || '|' || p_denumire);
        PERFORM public.fn_stoc_cheie_lock_orig(p_locatie_tip, p_locatie_id, p_denumire); END $f$;
      CREATE FUNCTION public.t_ord_scriere() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN INSERT INTO public.t_jurnal_ord (ev, adancime, cheie) VALUES (TG_TABLE_NAME, pg_trigger_depth(), NEW.locatie_tip || '|' || coalesce(NEW.locatie_id, 0) || '|' || NEW.material_denumire); RETURN NEW; END $f$;
      CREATE TRIGGER t_ord_miscari BEFORE INSERT ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.t_ord_scriere();
      CREATE TRIGGER t_ord_stocuri BEFORE INSERT OR UPDATE ON public.stocuri FOR EACH ROW EXECUTE FUNCTION public.t_ord_scriere();`)
    const cf = await comanda(db, { status: 'ajunsa', livrare_tip: 'santier', proiect_id: P2 }); const l = await linie(db, cf, { denumire: 'MAT_ORD', cantitate: 6 })
    await R(db, U.ACH, { linie: l, n: 6, citita: null })
    const jurnalOrd = async () => (await db.query('SELECT ev, adancime, cheie FROM public.t_jurnal_ord ORDER BY id')).rows
    await db.exec('TRUNCATE public.t_jurnal_ord')
    const a = await INTRA(db, U.ACH, { linie: l, n: 4, transfer: true }); const ja = await jurnalOrd()
    await db.exec('TRUNCATE public.t_jurnal_ord')
    const b = await INTRA(db, U.ACH, { linie: l, n: 2 }); const jb = await jurnalOrd()
    const sortat = (await db.query(`SELECT v.t || '|' || coalesce(v.i, 0) || '|MAT_ORD' AS k FROM (VALUES ('sediu'::text, NULL::bigint), ('proiect', $1::bigint)) v(t, i)
      ORDER BY public.fn_stoc_cheie(v.t, v.i, 'MAT_ORD')`, [P2])).rows.map(r => r.k)
    const sp = await stoc(db, 'proiect', P2, 'MAT_ORD'), ss = await stoc(db, 'sediu', null, 'MAT_ORD')
    await db.exec(`RESET ROLE; DROP TRIGGER t_ord_miscari ON public.stocuri_miscari; DROP TRIGGER t_ord_stocuri ON public.stocuri; DROP FUNCTION public.t_ord_scriere();
      DROP FUNCTION public.fn_stoc_cheie_lock(text, bigint, text); ALTER FUNCTION public.fn_stoc_cheie_lock_orig(text, bigint, text) RENAME TO fn_stoc_cheie_lock; DROP TABLE public.t_jurnal_ord;`)
    const ordonat = (j, chei) => {
      const prima = j.findIndex(e => e.ev !== 'lock')
      const inainte = [...new Set(j.slice(0, prima < 0 ? j.length : prima).filter(e => e.adancime === 0).map(e => e.cheie))]
      return prima > 0 && JSON.stringify(inainte) === JSON.stringify(chei) && j.slice(prima).every(e => chei.includes(e.cheie))
    }
    tine(!a.err && !b.err && ordonat(ja, sortat) && ordonat(jb, [`proiect|${P2}|MAT_ORD`]) && sp === 6 && ss === 0,
      `c_ordine_chei: transportul direct ${a.cod || 'ok'} [${ja.map(e => `${e.ev}@${e.adancime}:${e.cheie}`).join(' ')}] (sortat: ${sortat.join(' < ')}); predarea pe proiect ${b.cod || 'ok'} [${jb.map(e => `${e.ev}@${e.adancime}:${e.cheie}`).join(' ')}]; stoc proiect ${sp}, sediu ${ss}`)
  }
  if (are('mutare')) {
    // t2_mutare (r2, §3.3b / L07): mutarea liniei în altă comandă (comanda_furnizor_id schimbat) e refuzată dacă linia sau oricare dintre comenzi are
    // urme de recepție / jurnal / intrări vechi; altfel e permisă, iar marcajul moștenirii se recalculează pentru destinație
    const veche = (cf, den) => caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, um, delta, tip, motiv, ref_tip, ref_id) VALUES ('sediu', $1, 'buc', 10, 'intrare_achizitie', 'vechi', 'comanda_furnizor', $2)`, [den, cf])
    const nou = async cf => Number((await caRol(db, 'authenticated', U.ACH, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate) VALUES ($1, 'MAT_MUT', 'buc', 10) RETURNING id`, [cf])).rows?.[0]?.id)
    const muta = (l, cf) => caRol(db, 'authenticated', U.ACH, 'UPDATE public.comenzi_furnizor_linii SET comanda_furnizor_id = $2 WHERE id = $1', [l, cf])
    const unde = async l => JSON.stringify(await q1(db, 'SELECT comanda_furnizor_id::text AS cf, intrare_reconciliata AS rec, cantitate_primita::text AS p FROM public.comenzi_furnizor_linii WHERE id = $1', [l]))
    const cfA = await comanda(db, { status: 'emisa' }); const lA = await nou(cfA); const uA = await unde(lA)
    // (a) scenariul review-ului: linie nouă (reconciliată) mutată într-o comandă recepționată cu intrări vechi ambigue (+ o linie veche nereconciliată)
    const cfB = await comanda(db, { status: 'receptionata' }); await veche(cfB, 'MAT_MUT'); await linie(db, cfB, { denumire: 'MAT_MUT', cantitate: 10, primita: 10, rec: false })
    const a = await muta(lA, cfB)
    // (b) destinația recepționată fără intrări vechi; (c) destinația emisă, cu o altă linie recepționată (jurnal); (d) destinația emisă cu intrări vechi
    const cfC = await comanda(db, { status: 'receptionata' })
    const cfD = await comanda(db, { status: 'emisa' }); const lD = await linie(db, cfD, { denumire: 'MAT_MUT_D', cantitate: 5 }); await R(db, U.ACH, { linie: lD, n: 5, citita: null })
    const cfE = await comanda(db, { status: 'emisa' }); await veche(cfE, 'MAT_MUT_E')
    const b = await muta(lA, cfC), c = await muta(lA, cfD), d = await muta(lA, cfE)
    // (e) linia sursă are recepție → refuz (martor: refuzat și înainte de r2)
    const cfF = await comanda(db, { status: 'emisa' }); const lF = await linie(db, cfF, { denumire: 'MAT_MUT_F', cantitate: 5 }); await R(db, U.ACH, { linie: lF, n: 2, citita: null })
    const e = await muta(lF, await comanda(db, { status: 'emisa' }))
    tine([a, b, c, d, e].every(x => x.cod === 'CF_MUTARE_REFUZATA') && await unde(lA) === uA && JSON.parse(uA).rec === true,
      `t2_mutare refuzată: (a) recepționată + intrări vechi ${a.cod || 'TRECE'}, (b) recepționată ${b.cod || 'TRECE'}, (c) jurnal pe altă linie ${c.cod || 'TRECE'}, (d) intrări vechi ${d.cod || 'TRECE'}, (e) linie recepționată ${e.cod || 'TRECE'}; linia neschimbată ${await unde(lA)}`)
    // (f) mutare permisă: linie veche nereconciliată, fără nicio urmă, între două comenzi curate → marcajul recalculat (true); predarea cere recepție
    const cfH = await comanda(db, { status: 'draft' }); const lH = await linie(db, cfH, { denumire: 'MAT_MUT_H', cantitate: 5, rec: false })
    const cfI = await comanda(db, { status: 'emisa' })
    const f = await muta(lH, cfI); const uH = JSON.parse(await unde(lH))
    const f2 = await INTRA(db, U.ACH, { linie: lH, n: 1 })
    tine(!f.err && f.n === 1 && uH.cf === String(cfI) && uH.rec === true && f2.cod === 'CF_FARA_RECEPTIE',
      `t2_mutare permisă între comenzi curate: ${f.cod || f.n} ${JSON.stringify(uH)}; predarea fără recepție ${f2.cod}`)
  }
  if (are('receptie')) {
    // t3_receptie_incrementala + CAS
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf)
    const a = await R(db, U.ACH, { linie: l, n: 40, citita: null }), b = await R(db, U.ACH, { linie: l, n: 60, citita: 40 })
    const st = await stareLinie(db, l)
    const c = await R(db, U.ACH, { linie: l, n: 10, citita: 40 })
    tine(!a.err && !b.err && Number(b.r.primita) === 100 && c.cod === 'CF_VALOARE_SCHIMBATA' && await stareLinie(db, l) === st,
      `t3_receptie_incrementala: 40 + 60 = 100; a doua cerere cu primita_citita 40 = CF_VALOARE_SCHIMBATA, nimic scris (${a.cod || 'ok'} / ${b.cod || b.r.primita} / ${c.cod})`)
    const z = await R(db, U.ACH, { linie: l, n: 0, citita: 100 }), z2 = await R(db, U.ACH, { linie: l, n: 1.0005, citita: 100 })
    tine(z.cod === 'CF_CANTITATE_INVALIDA' && z2.cod === 'CF_CANTITATE_INVALIDA', `recepția 0 / cu 4 zecimale refuzată (${z.cod} / ${z2.cod})`)
  }
  if (are('sold')) {
    // t3_sold_initial (proba 14): linie veche cu primita 40, fără jurnal; corectura -10 → 30 (din sold); recepție +20, apoi -30 → 20 din recepție + 10 din sold
    const cf = await comanda(db, { status: 'receptionata' }); const l = await linie(db, cf, { primita: 40 })
    await caServer(db, 'UPDATE public.comenzi_furnizor_linii SET intrare_reconciliata = true WHERE id = $1', [l])
    const a = await R(db, U.ACH, { linie: l, n: -10, citita: 40 })
    const s1 = (await db.query(`SELECT tip, cantitate::text AS q, receptie_id FROM public.comenzi_furnizor_receptii WHERE linie_id = $1 ORDER BY id`, [l])).rows
    const b = await R(db, U.ACH, { linie: l, n: 20, citita: 30 }), c = await R(db, U.ACH, { linie: l, n: -30, citita: 50 })
    const s2 = (await db.query(`SELECT c.cantitate::text AS q, r.tip FROM public.comenzi_furnizor_receptii c JOIN public.comenzi_furnizor_receptii r ON r.id = c.receptie_id
      WHERE c.linie_id = $1 AND c.tip = 'corectura' ORDER BY c.id`, [l])).rows
    tine(!a.err && Number(a.r.primita) === 30 && s1.length === 2 && s1[0].tip === 'sold_initial' && s1[0].q === '40' && s1[1].tip === 'corectura' && s1[1].q === '10'
      && !b.err && !c.err && Number(c.r.primita) === 20 && JSON.stringify(s2) === JSON.stringify([{ q: '10', tip: 'sold_initial' }, { q: '20', tip: 'receptie' }, { q: '10', tip: 'sold_initial' }]),
      `t3_sold_initial: ${JSON.stringify(s1)} / ${JSON.stringify(s2)} (${a.cod || a.r.primita} / ${c.cod || c.r.primita})`)
    // linie NULL recepționată: se transformă și primește sold
    const cf2 = await comanda(db, { status: 'in_stoc' }); const l2 = await linie(db, cf2, { cantitate: 12 })
    const d = await R(db, U.ACH, { linie: l2, n: 3, citita: null })
    const s3 = (await db.query(`SELECT tip, cantitate::text AS q FROM public.comenzi_furnizor_receptii WHERE linie_id = $1 ORDER BY id`, [l2])).rows
    tine(!d.err && Number(d.r.primita) === 15 && JSON.stringify(s3) === JSON.stringify([{ tip: 'sold_initial', q: '12' }, { tip: 'receptie', q: '3' }]), `linie NULL în stoc: sold 12 + recepție 3 (${d.cod || d.r.primita} ${JSON.stringify(s3)})`)
  }
  if (are('null_dovada')) {
    // t3_null_dovada: comandă emisă cu NULL → predarea și returul refuză CF_FARA_RECEPTIE; aceeași comandă recepționată → NULL devine cantitate
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { cantitate: 30 })
    const a = await INTRA(db, U.ACH, { linie: l, n: 5 }), a2 = await RET(db, U.ACH, { linie: l, n: 5 })
    await db.query(`UPDATE public.comenzi_furnizor SET status = 'receptionata' WHERE id = $1`, [cf])
    const b = await INTRA(db, U.ACH, { linie: l, n: 30 })
    tine(a.cod === 'CF_FARA_RECEPTIE' && a2.cod === 'CF_FARA_RECEPTIE' && !b.err && (await L(db, l)).primita === '30' && (await L(db, l)).intrata === '30',
      `t3_null_dovada: emisă = CF_FARA_RECEPTIE (${a.cod} / ${a2.cod}); recepționată: NULL → 30, predarea 30 (${b.cod || 'ok'})`)
  }
  if (are('predare')) {
    // t3_predare_atomica: mișcarea eșuează (trigger de probă) → intrata_stoc neschimbat, nicio mișcare, nicio intenție
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_ESEC', cantitate: 10 })
    await R(db, U.ACH, { linie: l, n: 10, citita: null })
    await db.exec(`RESET ROLE; CREATE FUNCTION public.t_esec() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.material_denumire = 'MAT_ESEC' THEN RAISE EXCEPTION 'esec fortat'; END IF; RETURN NEW; END $f$;
      CREATE TRIGGER t_esec AFTER INSERT ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.t_esec();`)
    const st = await stareLinie(db, l)
    const a = await INTRA(db, U.ACH, { linie: l, n: 10 })
    const dupa = await stareLinie(db, l)
    await db.exec('RESET ROLE; DROP TRIGGER t_esec ON public.stocuri_miscari; DROP FUNCTION public.t_esec();')
    tine(a.err && /esec fortat/.test(a.msg) && dupa === st, `t3_predare_atomica: mișcarea eșuată → nimic scris (${a.msg?.slice(0, 40)})`)
    const b = await INTRA(db, U.ACH, { linie: l, n: 6 }), b2 = await INTRA(db, U.ACH, { linie: l, n: 5 })
    tine(!b.err && Number(b.r.intrata_stoc) === 6 && b2.cod === 'CF_PESTE_PRIMIT' && await miscariLinie(db, l) === 6, `predarea parțială 6, apoi 5 peste primit = CF_PESTE_PRIMIT (${b.cod || b.r.intrata_stoc} / ${b2.cod})`)
  }
  if (are('transport')) {
    // t3_transport_direct: intrare la sediu + transfer pe proiect, intrata_stoc crește; denumirea cu spații refuzată
    const cf = await comanda(db, { status: 'ajunsa', livrare_tip: 'santier', proiect_id: P2 }); const l = await linie(db, cf, { denumire: 'MAT_TD', cantitate: 8 })
    await R(db, U.ACH, { linie: l, n: 8, citita: null })
    const s0 = await stoc(db, 'sediu', null, 'MAT_TD'), p0 = await stoc(db, 'proiect', P2, 'MAT_TD')
    const a = await INTRA(db, U.ACH, { linie: l, n: 8, transfer: true })
    const tr = Number(await val(db, `SELECT count(*)::int FROM public.transferuri_interne WHERE de_la_locatie_tip = 'sediu' AND la_locatie_tip = 'proiect' AND la_locatie_id = $1`, [P2]))
    tine(!a.err && a.r.transfer_id != null && (await L(db, l)).intrata === '8' && await stoc(db, 'sediu', null, 'MAT_TD') === s0 && await stoc(db, 'proiect', P2, 'MAT_TD') === p0 + 8 && tr >= 1,
      `t3_transport_direct: sediu ${s0} → ${await stoc(db, 'sediu', null, 'MAT_TD')}, proiect ${p0} → ${await stoc(db, 'proiect', P2, 'MAT_TD')}, intrata ${(await L(db, l)).intrata} (${a.cod || 'ok'})`)
    // returul din proiect (locația comenzii) merge; din alt proiect = CF_LOCATIE_INVALIDA
    const t = await RET(db, U.ACH, { linie: l, n: 3, loc: 'proiect', locId: P2 }), t2 = await RET(db, U.ACH, { linie: l, n: 1, loc: 'proiect', locId: P1 })
    tine(!t.err && t2.cod === 'CF_LOCATIE_INVALIDA' && await stoc(db, 'proiect', P2, 'MAT_TD') === p0 + 5, `returul din proiectul comenzii (${t.cod || 'ok'}); alt proiect = ${t2.cod}`)
    const cf2 = await comanda(db, { status: 'ajunsa', livrare_tip: 'santier', proiect_id: P2 }); const l2 = await linie(db, cf2, { denumire: 'MAT_TD ', cantitate: 2 })
    await R(db, U.ACH, { linie: l2, n: 2, citita: null })
    const b = await INTRA(db, U.ACH, { linie: l2, n: 2, transfer: true })
    tine(b.cod === 'CF_DENUMIRE_NECANONICA', `transportul direct cu denumirea cu spații = ${b.cod}`)
  }
  if (are('nereconciliata')) {
    // t3_nereconciliata + proba 11: linie ambiguă (30 + 70, mișcări vechi 100, contori 0) → predarea, transportul, corectura și returul refuzate,
    // stocul rămâne 100 (nu 200); recepția pozitivă merge; după reconcilierea manuală (owner), toate merg; un al doilea retur după primul merge
    const cf = await comanda(db, { status: 'ajunsa', livrare_tip: 'sediu', proiect_id: P1 })
    await caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, um, delta, tip, motiv, ref_tip, ref_id) VALUES ('sediu', 'MAT_VECHI', 'buc', 100, 'intrare_achizitie', 'vechi', 'comanda_furnizor', $1)`, [cf])
    const la = await linie(db, cf, { denumire: 'MAT_VECHI', cantitate: 30, primita: 30, rec: false }), lb = await linie(db, cf, { denumire: 'MAT_VECHI', cantitate: 70, primita: 70, rec: false })
    // o linie adăugată DUPĂ migrare, de ecran, pe aceeași comandă: serverul n-o marchează reconciliată (comanda are intrări vechi)
    const ic = await caRol(db, 'authenticated', U.ACH, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, um, cantitate, intrare_reconciliata) VALUES ($1, 'MAT_NOU', 'buc', 5, true) RETURNING id`, [cf])
    const lc = Number(ic.rows?.[0]?.id)
    const rec = await L(db, la), recC = lc ? await L(db, lc) : { rec: 'eroare ' + ic.cod }
    const a = await INTRA(db, U.ACH, { linie: la, n: 30 }), b = await INTRA(db, U.ACH, { linie: lb, n: 70, transfer: true }), c = await R(db, U.ACH, { linie: la, n: -5, citita: 30 })
    const d = await RET(db, U.ACH, { linie: la, n: 10 }), e = await R(db, U.ACH, { linie: lb, n: 5, citita: 70 })
    tine(rec.rec === false && recC.rec === false && a.cod === 'CF_NERECONCILIATA' && b.cod === 'CF_NERECONCILIATA' && c.cod === 'CF_NERECONCILIATA' && d.cod === 'CF_NERECONCILIATA'
      && !e.err && await stoc(db, 'sediu', null, 'MAT_VECHI') === 100,
      `t3_nereconciliata: liniile noi ale unei comenzi cu intrări vechi nu sunt reconciliate; predare / transport / corectură / retur refuzate (${[a.cod, b.cod, c.cod, d.cod].join(' / ')}); recepția pozitivă merge (${e.cod || 'ok'}); stocul 100`)
    const f = await RECON(db, U.ACH, { linie: la, n: 30 }), g = await RECON(db, U.OWN, { linie: la, n: 30 }), g2 = await RECON(db, U.OWN, { linie: lb, n: 70 }), g3 = await RECON(db, U.OWN, { linie: la, n: 0 })
    const h = await RET(db, U.ACH, { linie: la, n: 10 }), h2 = await RET(db, U.ACH, { linie: la, n: 10 }), i = await INTRA(db, U.ACH, { linie: lb, n: 5 })
    tine(f.err === '42501' && !g.err && !g2.err && g3.cod === 'CF_DEJA_RECONCILIATA' && !h.err && !h2.err && !i.err && await stoc(db, 'sediu', null, 'MAT_VECHI') === 85,
      `după reconcilierea manuală (non-owner 42501, a doua oară refuz): două retururi și predarea restului merg, stocul 100 - 20 + 5 = ${await stoc(db, 'sediu', null, 'MAT_VECHI')} (${[f.err, g.cod || 'ok', g3.cod, h.cod || 'ok', h2.cod || 'ok', i.cod || 'ok'].join(' / ')})`)
  }
  if (are('retur')) {
    // t4_retur_stoc (spec §3.0): 100 primite, 40 intrate; două retururi de 20 → intrata 40 → 20 → 0, stocul scade cu 40
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_R1', cantitate: 100 })
    await R(db, U.ACH, { linie: l, n: 100, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 40 })
    const s0 = await stoc(db, 'sediu', null, 'MAT_R1')
    const a = await RET(db, U.ACH, { linie: l, n: 20, din: 20 }), i1 = (await L(db, l)).intrata
    const b = await RET(db, U.ACH, { linie: l, n: 20, din: 20 }), i2 = (await L(db, l)).intrata
    tine(!a.err && !b.err && i1 === '20' && i2 === '0' && (await L(db, l)).primita === '60' && await stoc(db, 'sediu', null, 'MAT_R1') === s0 - 40 && await miscariLinie(db, l) === 0,
      `t4_retur_stoc: intrata 40 → ${i1} → ${i2}, primita 60, stocul -40 (${a.cod || 'ok'} / ${b.cod || 'ok'})`)
    // limitele părții din stoc: din_stoc sub minim / peste maxim refuzate; implicit = maximul
    const c = await RET(db, U.ACH, { linie: l, n: 10, din: 5 })
    tine(c.cod === 'CF_DIN_STOC_INVALID', `partea din stoc în afara limitelor = ${c.cod}`)
    // t4_retur_fara_stoc: 20 primite, 0 intrate; retur 10 → nicio mișcare, stoc_miscare_id NULL
    const cf2 = await comanda(db, { status: 'emisa' }); const l2 = await linie(db, cf2, { denumire: 'MAT_R2', cantitate: 20 })
    await R(db, U.ACH, { linie: l2, n: 20, citita: null })
    const m0 = Number(await val(db, 'SELECT count(*)::int FROM public.stocuri_miscari'))
    const d = await RET(db, U.ACH, { linie: l2, n: 10 })
    tine(!d.err && Number(d.r.din_stoc) === 0 && (await retur(db, d.r.retur_id)).mid == null && Number(await val(db, 'SELECT count(*)::int FROM public.stocuri_miscari')) === m0,
      `t4_retur_fara_stoc: nicio mișcare (${d.cod || JSON.stringify(d.r)})`)
    // t4_stoc_insuficient: stocul consumat după intrare → CF_STOC_INSUFICIENT, nimic scris
    const cf3 = await comanda(db, { status: 'emisa' }); const l3 = await linie(db, cf3, { denumire: 'MAT_R3', cantitate: 50 })
    await R(db, U.ACH, { linie: l3, n: 50, citita: null }); await INTRA(db, U.ACH, { linie: l3, n: 50 })
    await ajustare(db, U.OWN, 'sediu', null, 'MAT_R3', -45)
    const st = await stareLinie(db, l3)
    const e = await RET(db, U.ACH, { linie: l3, n: 20 })
    tine(e.cod === 'CF_STOC_INSUFICIENT' && /in stoc sunt doar 5/.test(e.msg) && await stareLinie(db, l3) === st, `t4_stoc_insuficient: ${e.msg?.slice(0, 60)}`)
    // peste primit / motiv scurt / PV al altei comenzi
    const f = await RET(db, U.ACH, { linie: l3, n: 51 }), g = await RET(db, U.ACH, { linie: l3, n: 1, motiv: 'rau' }), g2 = await RET(db, U.ACH, { linie: l3, n: 1, pv: `${cf}/pv.pdf` })
    tine(f.cod === 'CF_PESTE_PRIMIT' && g.cod === 'CF_MOTIV' && g2.cod === 'CF_PV_INVALID', `peste primit / motiv / PV străin refuzate (${f.cod} / ${g.cod} / ${g2.cod})`)
  }
  if (are('anulare')) {
    // t4_anulare: o singură dată; pune la loc exact din_stoc, în locația salvată; refuzată după înlocuire
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_AN', cantitate: 30 })
    await R(db, U.ACH, { linie: l, n: 30, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 20 })
    const s0 = await stoc(db, 'sediu', null, 'MAT_AN')
    const t = await RET(db, U.ACH, { linie: l, n: 15, din: 10 })
    const a = await ANUL(db, U.ACH, { retur: t.r.retur_id }), b = await ANUL(db, U.ACH, { retur: t.r.retur_id })
    const ll = await L(db, l)
    tine(!t.err && !a.err && Number(a.r.pus_inapoi_in_stoc) === 10 && b.cod === 'CF_DEJA_ANULAT' && await stoc(db, 'sediu', null, 'MAT_AN') === s0 && ll.primita === '30' && ll.intrata === '20'
      && (await retur(db, t.r.retur_id)).fel === 'anulat', `t4_anulare: o dată, pune la loc 10, a doua = ${b.cod}; primita ${ll.primita}, intrata ${ll.intrata}`)
    const t2 = await RET(db, U.ACH, { linie: l, n: 5, din: 0 })
    await R(db, U.ACH, { linie: l, n: 2, citita: await primitaCitita(db, l) })
    const c = await ANUL(db, U.ACH, { retur: t2.r.retur_id })
    tine(c.cod === 'CF_RETUR_INLOCUIT', `anularea după înlocuire = ${c.cod}`)
    // UNIQUE (retur_id): a doua anulare scrisă direct (ca serverul) = 23505
    const dup = await eroare(caServer(db, `INSERT INTO public.comenzi_furnizor_retururi (comanda_furnizor_id, linie_id, tip, retur_id, cantitate, din_stoc, motiv, denumire, um, locatie_tip, cheie, payload_hash, creat_de)
      SELECT comanda_furnizor_id, linie_id, 'anulare', retur_id, cantitate, 0, 'proba dublura', denumire, um, locatie_tip, gen_random_uuid(), md5('x'), creat_de
        FROM public.comenzi_furnizor_retururi WHERE tip = 'anulare' AND retur_id = $1`, [t.r.retur_id]))
    tine(/duplicate key|unique/.test(dup || ''), `t4_anulare_unica_bd: a doua anulare a aceluiași retur = 23505 (${(dup || 'TRECE').slice(0, 60)})`)
  }
  if (are('renuntare')) {
    // t4_renuntare (proba 12): retur 40, înlocuire 10, renunțare la 30, corectura recepției de 10 la 0 → de înlocuit = 10, nu 40
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_RN', cantitate: 40 })
    await R(db, U.ACH, { linie: l, n: 40, citita: null })
    const t = await RET(db, U.ACH, { linie: l, n: 40 })
    const a = await R(db, U.ACH, { linie: l, n: 10, citita: 0 })
    const b = await INCH(db, U.ACH, { retur: t.r.retur_id }), b2 = await INCH(db, U.ACH, { retur: t.r.retur_id })
    const r1 = await retur(db, t.r.retur_id)
    const c = await R(db, U.ACH, { linie: l, n: -10, citita: 10 })
    const r2 = await retur(db, t.r.retur_id)
    tine(!a.err && !b.err && Number(b.r.renuntat) === 30 && b2.cod === 'CF_RETUR_INCHIS' && r1.fel === 'renuntat' && !c.err && await deInlocuit(db, l) === 10 && r2.ren === '30' && r2.inl === '0'
      && r2.ast === true && JSON.stringify(c.r.retururi_redeschise) === JSON.stringify([t.r.retur_id]),
      `t4_renuntare: de înlocuit ${await deInlocuit(db, l)} (inl ${r2.inl}, ren ${r2.ren}); a doua închidere ${b2.cod}`)
  }
  if (are('cronologic')) {
    // t4_cronologic (proba 13): recepție 40, retur 20, înlocuire 20, recepție greșită 60, corectura -60 → returul rămâne acoperit; -70 → îl redeschide pentru 10
    for (const [corr, asteptat, fel] of [[-60, 0, 'acoperit'], [-70, 10, null]]) {
      const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_CR', cantitate: 40 })
      await R(db, U.ACH, { linie: l, n: 40, citita: null })
      const t = await RET(db, U.ACH, { linie: l, n: 20 })
      await R(db, U.ACH, { linie: l, n: 20, citita: 20 }); await R(db, U.ACH, { linie: l, n: 60, citita: 40 })
      const c = await R(db, U.ACH, { linie: l, n: corr, citita: 100 })
      const rr = await retur(db, t.r.retur_id)
      tine(!c.err && await deInlocuit(db, l) === asteptat && rr.fel === fel && Number(c.r.primita) === 100 + corr,
        `t4_cronologic ${corr}: de înlocuit ${await deInlocuit(db, l)} (așteptat ${asteptat}), returul ${rr.fel} (${c.cod || c.r.primita})`)
    }
  }
  if (are('zecimale')) {
    // t_zecimale: 12,5 m, retur 2,25 → valori exacte; 3 zecimale da, 4 nu
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'TEAVA_T', um: 'm', cantitate: 12.5 })
    await R(db, U.ACH, { linie: l, n: 12.5, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 12.5 })
    const a = await RET(db, U.ACH, { linie: l, n: 2.25 }), b = await RET(db, U.ACH, { linie: l, n: 0.125 }), c = await RET(db, U.ACH, { linie: l, n: 0.0001 })
    const ll = await L(db, l)
    tine(!a.err && !b.err && c.cod === 'CF_CANTITATE_INVALIDA' && ll.primita === '10.125' && ll.intrata === '10.125' && await stoc(db, 'sediu', null, 'TEAVA_T') === 10.125,
      `t_zecimale: primita ${ll.primita}, intrata ${ll.intrata}, stoc ${await stoc(db, 'sediu', null, 'TEAVA_T')}; 4 zecimale = ${c.cod}`)
  }
  if (are('comanda_invalida')) {
    // t_comanda_invalida: comandă anulată (după recepție) / de servicii / draft → CF_COMANDA_INVALIDA pe toate RPC-urile
    const rez = []
    for (const o of [{ status: 'anulata', receptie_mp_la: '2026-11-01T08:00:00Z' }, { status: 'receptionata', este_servicii: true }, { status: 'draft' }, { status: 'respinsa' }]) {
      const cf = await comanda(db, o); const l = await linie(db, cf, { primita: 10 })
      rez.push((await R(db, U.ACH, { linie: l, n: 1, citita: 10 })).cod, (await INTRA(db, U.ACH, { linie: l, n: 1 })).cod, (await RET(db, U.ACH, { linie: l, n: 1 })).cod,
        (await RECON(db, U.OWN, { linie: l, n: 0 })).cod)
    }
    tine(rez.every(x => x === 'CF_COMANDA_INVALIDA'), `t_comanda_invalida: ${rez.join(',')}`)
  }
  if (are('drept')) {
    // t4_drept: fără drept → 42501 pe fiecare RPC; reluarea unei chei comise de autor după retragerea dreptului → rezultatul comis; cheie nouă → 42501
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_DR', cantitate: 20 })
    await R(db, U.ACH, { linie: l, n: 20, citita: null })
    const ref = []
    for (const uid of [U.FARA, U.MP]) {
      ref.push((await R(db, uid, { linie: l, n: 1, citita: 20 })).err, (await INTRA(db, uid, { linie: l, n: 1 })).err, (await RET(db, uid, { linie: l, n: 1 })).err,
        (await RECON(db, uid, { linie: l, n: 0 })).err)
    }
    ref.push((await RECON(db, U.ACH, { linie: l, n: 0 })).err)
    const anon = await caRol(db, 'anon', null, `SELECT public.fn_cf_receptie_adauga('${cheie()}', ${l}, 1, 20)`)
    const fara = await rpc(db, null, 'fn_cf_receptie_adauga', { p_cheie: cheie(), p_linie_id: l, p_cantitate: 1, p_primita_citita: 20 })
    const sub = await R(db, U.SUB, { linie: l, n: 5, citita: 20 })
    const k = cheie()
    const a = await R(db, U.ACH, { cheie: k, linie: l, n: 10, citita: 25 })
    await db.query(`UPDATE public.profiles SET can_process_achizitii = false WHERE id = $1`, [U.ACH])
    const b = await R(db, U.ACH, { cheie: k, linie: l, n: 10, citita: 25 }), c = await R(db, U.ACH, { linie: l, n: 1, citita: 35 })
    await db.query(`UPDATE public.profiles SET can_process_achizitii = true WHERE id = $1`, [U.ACH])
    tine(ref.every(x => x === '42501') && anon.err === '42501' && fara.err === '42501' && !sub.err && !a.err && !b.err && b.r.reluat === true && Number(b.r.primita) === 35 && c.err === '42501'
      && (await L(db, l)).primita === '35', `t4_drept: fără drept ${ref.join(',')}; anon ${anon.err}; fără JWT ${fara.err}; sub-modul ${sub.cod || 'ok'}; reluarea după retragere ${b.cod || 'reluat'}; cheie nouă ${c.err}`)
    // c_drept_retras: dreptul retras ÎNTRE lock-uri și scriere (injecție în pregătirea liniei, după lock-urile 1–2): refuz 42501 pe fiecare RPC, nimic scris
    await INTRA(db, U.OWN, { linie: l, n: 5 })
    const tr = await RET(db, U.OWN, { linie: l, n: 2 })
    await db.exec(`RESET ROLE; ALTER FUNCTION public.fn_cf_linie_pregateste_intern(bigint, boolean) RENAME TO fn_cf_linie_pregateste_intern_orig;
      CREATE FUNCTION public.fn_cf_linie_pregateste_intern(p_linie_id bigint, p_cere_dovada boolean, OUT linie public.comenzi_furnizor_linii, OUT primita_bruta numeric)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ DECLARE x record;
      BEGIN SELECT * INTO x FROM public.fn_cf_linie_pregateste_intern_orig(p_linie_id, p_cere_dovada); linie := x.linie; primita_bruta := x.primita_bruta;
        UPDATE public.profiles SET can_process_achizitii = false WHERE id = '${U.ACH}'; END $f$;`)
    const st = await stareLinie(db, l)
    const inj = [await R(db, U.ACH, { linie: l, n: 1, citita: 33 }), await INTRA(db, U.ACH, { linie: l, n: 1 }), await RET(db, U.ACH, { linie: l, n: 1 }),
      await ANUL(db, U.ACH, { retur: tr.r?.retur_id }), await INCH(db, U.ACH, { retur: tr.r?.retur_id })]
    const st2 = await stareLinie(db, l)
    await db.exec(`RESET ROLE; DROP FUNCTION public.fn_cf_linie_pregateste_intern(bigint, boolean);
      ALTER FUNCTION public.fn_cf_linie_pregateste_intern_orig(bigint, boolean) RENAME TO fn_cf_linie_pregateste_intern; UPDATE public.profiles SET can_process_achizitii = true WHERE id = '${U.ACH}';`)
    tine(!tr.err && inj.every(x => x.err === '42501') && st2 === st, `c_drept_retras (injecție după lock-uri): ${inj.map(x => x.err || x.cod || 'TRECE').join(',')}; nimic scris ${st2 === st}`)
  }
  if (are('drept_final')) {
    // c_drept_dupa_ultima_asteptare (r2, L01): dreptul retras EXACT la operațiile care pot aștepta DUPĂ verificarea de după lock-uri (injecție prin
    // trigger-e de probă pe rândul din stocuri, jurnalul recepțiilor, linie, retururi, ștergerea mișcărilor; PGlite are o sesiune: retragerea
    // „comisă cât RPC-ul așteaptă” se simulează în aceeași tranzacție, exact în acel punct) → 42501 pe fiecare RPC de scriere, nimic scris.
    // Proba cu două sesiuni reale (barieră pe rândul din stocuri / pe recepție): supabase/tests/…_concurenta.sh C8 / C9.
    const cf = await comanda(db, { status: 'ajunsa', livrare_tip: 'santier', proiect_id: P2 }); const l = await linie(db, cf, { denumire: 'MAT_DF', cantitate: 30 })
    await R(db, U.ACH, { linie: l, n: 30, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 10 })
    const tr = await RET(db, U.ACH, { linie: l, n: 2, din: 0 })
    const lr = await linie(db, cf, { denumire: 'MAT_DF2', cantitate: 5, primita: 5, rec: false }); await R(db, U.ACH, { linie: lr, n: 1, citita: 5 })
    await ajustare(db, U.OWN, 'sediu', null, 'MAT_DF_DEL', 3)
    const sid = await val(db, `SELECT id FROM public.stocuri WHERE material_denumire = 'MAT_DF_DEL'`)
    await db.exec(`RESET ROLE; CREATE TABLE public.t_revoca_activ (x int);
      CREATE FUNCTION public.t_revoca() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN IF EXISTS (SELECT 1 FROM public.t_revoca_activ) THEN
        UPDATE public.profiles SET can_process_achizitii = false, can_create_comenzi = false, is_owner = false WHERE id = auth.uid(); END IF; RETURN NULL; END $f$;
      CREATE TRIGGER t_revoca_stocuri AFTER INSERT OR UPDATE ON public.stocuri FOR EACH ROW EXECUTE FUNCTION public.t_revoca();
      CREATE TRIGGER t_revoca_receptii AFTER INSERT ON public.comenzi_furnizor_receptii FOR EACH ROW EXECUTE FUNCTION public.t_revoca();
      CREATE TRIGGER t_revoca_linii AFTER UPDATE ON public.comenzi_furnizor_linii FOR EACH ROW EXECUTE FUNCTION public.t_revoca();
      CREATE TRIGGER t_revoca_retururi AFTER INSERT OR UPDATE ON public.comenzi_furnizor_retururi FOR EACH ROW EXECUTE FUNCTION public.t_revoca();
      CREATE TRIGGER t_revoca_miscari AFTER DELETE ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.t_revoca();
      INSERT INTO public.t_revoca_activ VALUES (1);`)
    const st = await stareLinie(db, l), stR = await stareLinie(db, lr)
    const ops = []
    ops.push(['receptie', await R(db, U.ACH, { linie: l, n: 1, citita: 28 })])
    ops.push(['corectura', await R(db, U.ACH, { linie: l, n: -1, citita: 28 })])
    ops.push(['predare', await INTRA(db, U.ACH, { linie: l, n: 1 })])
    ops.push(['transport', await INTRA(db, U.ACH, { linie: l, n: 1, transfer: true })])
    ops.push(['retur', await RET(db, U.ACH, { linie: l, n: 1, din: 1, loc: 'proiect', locId: P2 })])
    ops.push(['anulare', await ANUL(db, U.ACH, { retur: tr.r?.retur_id })])
    ops.push(['inchidere', await INCH(db, U.ACH, { retur: tr.r?.retur_id })])
    ops.push(['reconciliere', await RECON(db, U.OWN, { linie: lr, n: 0 })])
    ops.push(['stergere', await rpc(db, U.OWN, 'fn_stoc_sterge_pozitie', { p_stoc_id: sid })])
    await db.exec('RESET ROLE; TRUNCATE public.t_revoca_activ')
    const nimic = await stareLinie(db, l) === st && await stareLinie(db, lr) === stR && Number(await val(db, 'SELECT count(*)::int FROM public.stocuri WHERE id = $1', [sid])) === 1
    await db.exec(`RESET ROLE; UPDATE public.profiles SET can_process_achizitii = true WHERE id = '${U.ACH}'; UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWN}';
      DROP TRIGGER t_revoca_stocuri ON public.stocuri; DROP TRIGGER t_revoca_receptii ON public.comenzi_furnizor_receptii; DROP TRIGGER t_revoca_linii ON public.comenzi_furnizor_linii;
      DROP TRIGGER t_revoca_retururi ON public.comenzi_furnizor_retururi; DROP TRIGGER t_revoca_miscari ON public.stocuri_miscari; DROP FUNCTION public.t_revoca(); DROP TABLE public.t_revoca_activ;`)
    tine(!tr.err && ops.every(([, r]) => r.err === '42501') && nimic,
      `c_drept_dupa_ultima_asteptare: ${ops.map(([n, r]) => n + ' ' + (r.err || 'TRECE')).join(', ')}; nimic scris ${nimic}`)
  }
  if (are('idempotenta')) {
    // c_reluare_cheie / proba 4: aceeași cheie + același payload = rezultatul comis, fără efect dublu; alt payload / alt autor = refuz
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { denumire: 'MAT_ID', cantitate: 50 })
    await R(db, U.ACH, { linie: l, n: 50, citita: null }); await INTRA(db, U.ACH, { linie: l, n: 30 })
    const k = cheie(), s0 = await stoc(db, 'sediu', null, 'MAT_ID')
    const a = await RET(db, U.ACH, { cheie: k, linie: l, n: 10, din: 10 }), b = await RET(db, U.ACH, { cheie: k, linie: l, n: 10, din: 10 })
    const c = await RET(db, U.ACH, { cheie: k, linie: l, n: 11, din: 10 }), d = await RET(db, U.OWN, { cheie: k, linie: l, n: 10, din: 10 })
    const e = await R(db, U.ACH, { cheie: k, linie: l, n: 10, citita: 40 })
    const k2 = cheie(), f = await INTRA(db, U.ACH, { cheie: k2, linie: l, n: 5 }), g = await INTRA(db, U.ACH, { cheie: k2, linie: l, n: 5 })
    const k3 = cheie(), h = await R(db, U.ACH, { cheie: k3, linie: l, n: 2.5, citita: 40 }), h2 = await R(db, U.ACH, { cheie: k3, linie: l, n: '2.50', citita: '40.0' })
    tine(!a.err && !b.err && b.r.reluat === true && b.r.retur_id === a.r.retur_id && c.cod === 'CF_CHEIE_ALTI_PARAMETRI' && d.cod === 'CF_CHEIE_ALT_AUTOR' && e.cod === 'CF_CHEIE_ALTI_PARAMETRI'
      && await stoc(db, 'sediu', null, 'MAT_ID') === s0 - 10 + 5 && !f.err && g.r?.reluat === true && Number(await val(db, `SELECT count(*)::int FROM public.comenzi_furnizor_retururi WHERE linie_id = $1`, [l])) === 1
      && !h.err && h2.r?.reluat === true,
      `idempotența: reluarea ${b.r?.reluat}; alt payload ${c.cod}; alt autor ${d.cod}; alt RPC ${e.cod}; predarea reluată ${g.r?.reluat}; 2.5 = 2.50 ${h2.r?.reluat}; stocul ${await stoc(db, 'sediu', null, 'MAT_ID')}`)
  }
  if (are('cereri')) {
    // t4_cereri_neschimbate (proba 7): statusul cererii interne legate e identic înainte și după fiecare RPC
    const cf = await comanda(db, { status: 'emisa', proiect_id: P1 }); const l = await linie(db, cf, { denumire: 'MAT_C', cantitate: 10, comanda_linie_id: 1 })
    const s = async () => val(db, `SELECT status || '|' || coalesce(finalizata_la::text, '-') FROM public.comenzi WHERE id = 1`)
    const n0 = Number(await val(db, 'SELECT count(*)::int FROM public.notifications'))
    const s0 = await s(), pas = []
    pas.push((await R(db, U.ACH, { linie: l, n: 10, citita: null })).cod || await s())
    pas.push((await INTRA(db, U.ACH, { linie: l, n: 6 })).cod || await s())
    const t = await RET(db, U.ACH, { linie: l, n: 4, asteapta: false }); pas.push(t.cod || await s())
    const t2 = await RET(db, U.ACH, { linie: l, n: 2 }); pas.push(t2.cod || await s())
    pas.push((await R(db, U.ACH, { linie: l, n: 1, citita: 4 })).cod || await s())
    pas.push((await INCH(db, U.ACH, { retur: t2.r.retur_id })).cod || await s())
    pas.push((await ANUL(db, U.ACH, { retur: t.r.retur_id })).cod || await s())
    pas.push((await R(db, U.ACH, { linie: l, n: -1, citita: 9 })).cod || await s())
    tine(pas.every(x => x === s0) && Number(await val(db, 'SELECT count(*)::int FROM public.notifications')) === n0, `t4_cereri_neschimbate: ${s0} → ${pas.join(' / ')}`)
  }
  if (are('tabele')) {
    // t1_tabele_rls: RLS activ, nicio politică de scriere, authenticated doar SELECT (intentii: nimic), anon nimic
    const r = (await db.query(`SELECT c.relname, c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd <> 'r') AS scriere,
      has_table_privilege('authenticated', c.oid, 'SELECT') AS sel, has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE') AS scr, has_table_privilege('anon', c.oid, 'SELECT') AS anon
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii') ORDER BY 1`)).rows
    tine(r.length === 4 && r.every(x => x.rls && x.scriere === 0 && !x.scr && !x.anon && x.sel === (x.relname !== 'comenzi_furnizor_intentii')), `t1_tabele_rls: ${JSON.stringify(r)}`)
    // citirea ca authenticated (cine vede comanda): retururile se văd; intențiile nu (date proprii: o recepție + un retur care așteaptă înlocuire + o alocare)
    { const cf0 = await comanda(db, { status: 'emisa' }); const l0 = await linie(db, cf0, { denumire: 'MAT_T1', cantitate: 5 })
      await R(db, U.ACH, { linie: l0, n: 5, citita: null }); await RET(db, U.ACH, { linie: l0, n: 2 }); await R(db, U.ACH, { linie: l0, n: 1, citita: 3 }) }
    const v = await caRol(db, 'authenticated', U.FARA, 'SELECT count(*)::int AS n FROM public.comenzi_furnizor_retururi')
    const vi = await caRol(db, 'authenticated', U.ACH, 'SELECT count(*) FROM public.comenzi_furnizor_intentii')
    const w = await caRol(db, 'authenticated', U.OWN, `UPDATE public.comenzi_furnizor_retururi SET cantitate_inlocuita = 0`)
    const w2 = await eroare(db.query(`UPDATE public.comenzi_furnizor_retururi SET motiv = 'altceva altceva'`))
    const w3 = await eroare(db.query(`DELETE FROM public.comenzi_furnizor_receptii`)), w4 = await eroare(db.query(`TRUNCATE public.comenzi_furnizor_retur_alocari`))
    tine(!v.err && v.rows[0].n >= 0 && vi.err === '42501' && w.err === '42501' && /CF_ISTORIC_PROTEJAT/.test(w2 || '') && /CF_ISTORIC_PROTEJAT|truncate/.test(w3 || '') && /CF_ISTORIC_PROTEJAT|truncate/.test(w4 || ''),
      `citire / scriere directă: ${[v.err || v.rows[0].n, vi.err, w.err, (w2 || 'TRECE').slice(0, 30), (w3 || 'TRECE').slice(0, 30), (w4 || 'TRECE').slice(0, 30)].join(' / ')}`)
    // t1_check_tip / t1_check_intrata
    const c1 = await eroare(caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, delta, tip, ref_tip, ref_id) VALUES ('sediu', 'MAT_A', 5, 'retur_furnizor', 'comanda_furnizor_retur', 1)`))
    const c2 = await eroare(caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, delta, tip, ref_tip, ref_id) VALUES ('sediu', 'MAT_A', -5, 'retur_furnizor_anulare', 'comanda_furnizor_retur', 1)`))
    const c3 = await eroare(caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, delta, tip, ref_tip) VALUES ('sediu', 'MAT_A', -5, 'retur_furnizor', NULL)`))
    const c4 = await eroare(caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, delta, tip) VALUES ('sediu', 'MAT_A', -5, 'altceva')`))
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf, { cantitate: 10, primita: 10 })
    const c5 = await eroare(caServer(db, `UPDATE public.comenzi_furnizor_linii SET cantitate_intrata_stoc = 11 WHERE id = $1`, [l]))
    tine(/retur_furnizor_check/.test(c1 || '') && /retur_furnizor_check/.test(c2 || '') && /retur_furnizor_check/.test(c3 || '') && /tip_check/.test(c4 || '') && /intrata_sub_primita/.test(c5 || ''),
      `t1_check_tip / sens / ref / t1_check_intrata: ${[c1, c2, c3, c4, c5].map(x => (x || 'TRECE').slice(0, 50)).join(' | ')}`)
  }
  return ab
}

// ── testul de proprietate (proba 1): secvențe aleatoare, invarianții verificați după FIECARE operație (sursa independentă: mișcările / jurnalul) ──
function prng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const STAT = {}
async function proprietate(db, nr) {
  const ab = []; let ops = 0, refuzuri = 0, reusite = 0
  for (let s = 0; s < nr; s++) {
    const rnd = prng(1000 + s), alege = a => a[Math.floor(rnd() * a.length)], cant = max => Math.max(0.5, Math.round(rnd() * max * 2) / 2)
    const den = `PROP_${s % 7}`
    const cf = await comanda(db, { status: alege(['emisa', 'ajunsa', 'receptionata']), livrare_tip: 'sediu' })
    const linii = [await linie(db, cf, { denumire: den, cantitate: 40 }), await linie(db, cf, { denumire: den, cantitate: 25 })]
    const retururi = []
    for (let k = 0; k < 10; k++) {
      const l = alege(linii), st = await stareLinie(db, l), op = alege(['rec', 'rec', 'corr', 'intra', 'intra', 'retur', 'retur', 'anul', 'inch', 'consum'])
      let r
      const ll = await L(db, l), primita = ll.primita == null ? null : Number(ll.primita), intrata = Number(ll.intrata)
      if (op === 'rec') r = await R(db, U.ACH, { linie: l, n: cant(20), citita: primita })
      else if (op === 'corr') r = await R(db, U.ACH, { linie: l, n: -cant(15), citita: primita })
      else if (op === 'intra') r = await INTRA(db, U.ACH, { linie: l, n: cant(Math.max(1, (primita || 0) - intrata)) })
      else if (op === 'retur') r = await RET(db, U.ACH, { linie: l, n: cant(Math.max(1, primita || 1)), din: rnd() < 0.5 ? null : cant(intrata || 1), asteapta: rnd() < 0.7 })
      else if (op === 'anul') r = retururi.length ? await ANUL(db, U.ACH, { retur: alege(retururi) }) : { err: 'X', cod: 'NIMIC' }
      else if (op === 'inch') r = retururi.length ? await INCH(db, U.ACH, { retur: alege(retururi) }) : { err: 'X', cod: 'NIMIC' }
      else r = await ajustare(db, U.OWN, 'sediu', null, den, -cant(10))
      ops++
      STAT[op] = STAT[op] || { ok: 0, refuz: 0 }; STAT[op][r.err ? 'refuz' : 'ok']++
      if (r.err) {
        refuzuri++
        if (op !== 'consum' && await stareLinie(db, l) !== st) ab.push(`s${s} k${k} ${op}: refuzat (${r.cod}) dar starea s-a schimbat`)
        if (r.err !== 'P0001' && r.cod !== 'NIMIC') ab.push(`s${s} k${k} ${op}: eroare neașteptată ${r.err} ${r.msg?.slice(0, 80)}`)
      } else {
        reusite++
        if (op === 'retur') retururi.push(r.r.retur_id)
      }
      for (const x of linii) {
        const lx = await L(db, x), pr = lx.primita == null ? 0 : Number(lx.primita), it = Number(lx.intrata)
        if (await miscariLinie(db, x) !== it && lx.rec) ab.push(`s${s} k${k} ${op}: mișcările liniei ${x} (${await miscariLinie(db, x)}) ≠ intrata ${it}`)
        const nj = Number(await val(db, 'SELECT count(*)::int FROM public.comenzi_furnizor_receptii WHERE linie_id = $1', [x]))
        if (nj > 0 && await jurnal(db, x) !== pr + await returNet(db, x)) ab.push(`s${s} k${k} ${op}: jurnalul liniei ${x} (${await jurnal(db, x)}) ≠ primita ${pr} + retururi ${await returNet(db, x)}`)
        if (!(it >= 0 && it <= pr + 1e-9 || (lx.primita == null && it === 0))) ab.push(`s${s} k${k} ${op}: intrata ${it} / primita ${pr}`)
      }
      const inl = await val(db, `SELECT count(*)::int FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = ANY ($1::bigint[]) AND t.tip = 'retur' AND t.cantitate_inlocuita <>
        (SELECT coalesce(sum(a.cantitate), 0) FROM public.comenzi_furnizor_retur_alocari a WHERE a.retur_id = t.id AND a.inversata_de_receptie_id IS NULL)`, [linii])
      if (Number(inl) !== 0) ab.push(`s${s} k${k} ${op}: înlocuirea ≠ alocările active`)
      const sc = Number(await val(db, `SELECT coalesce((SELECT sum(cantitate) FROM public.stocuri WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = $1), 0)::text`, [den]))
      const sm = Number(await val(db, `SELECT coalesce(sum(delta), 0)::text FROM public.stocuri_miscari WHERE locatie_tip = 'sediu' AND locatie_id IS NULL AND material_denumire = $1`, [den]))
      if (Math.abs(sc - sm) > 1e-9) ab.push(`s${s} k${k} ${op}: stocul ${sc} ≠ suma mișcărilor ${sm}`)
      if (ab.length > 5) return { ab, ops, refuzuri, reusite }
    }
  }
  return { ab, ops, refuzuri, reusite }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (ruleaza('t0')) {
  console.log('t0. validatorul runnerului, refuzurile migrării, livrarea L15 v2')
  {
    const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
    ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
    const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
    ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
    const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
    ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  }
  // paritatea scheletului cu PRODUCȚIA: rândurile AG_CATALOG v2 (blocul livrat, scripts/amprenta_globala_v2.sql) calculate pe schelet = amprentele
  // aceloraşi obiecte din citirea amprentei globale de pe producție (24.11.2026) — sursa independentă a corpurilor / drepturilor dependențelor
  {
    const PROD = {
      'functie public.fn_cerere_rollup_status(bigint)': 'c87123cb1dbc854d35802ff3b9a2f9fb', 'functie public.fn_cfl_automatch()': '11cf8b05c240a62a464ae5c4ff7c0645',
      'functie public.fn_cfl_sync_cereri()': '1f4661b9d6e8aa79dea7082b8a9fa74b', 'functie public.fn_stoc_ajustare(text,bigint,text,text,numeric,text)': '848dfc3d6c7fb2e2c9fd1528f1eb8e90',
      'functie public.fn_stocuri_aplica_miscare()': '0139d6905cba6ef1436090661096227a', 'functie public.fn_transfer_executa(text,bigint,text,bigint,text,jsonb)': '4b629693b9e51ea646dc5a31563b74db',
      'relatie public.comenzi_furnizor': 'a1559a3d77c2323e1f6f9902fbd6889a', 'relatie public.comenzi_furnizor_linii': 'a1559a3d77c2323e1f6f9902fbd6889a',
      'relatie public.stocuri': 'a1559a3d77c2323e1f6f9902fbd6889a', 'relatie public.stocuri_miscari': 'a1559a3d77c2323e1f6f9902fbd6889a',
      'constrangere tabel public.stocuri_miscari.stocuri_miscari_tip_check': '75fa3809e63d7d56161eb7afa79def61',
      'constrangere tabel public.comenzi_furnizor_linii.comenzi_furnizor_linii_cantitate_intrata_stoc_check': '7641f370fad5b7e079ec42ae92546085',
      'constrangere tabel public.comenzi_furnizor.comenzi_furnizor_status_check': '80d91603e44ba802503ff49089c8b82c',
      'politica public.comenzi_furnizor.cf_select': 'ff10e7cfb07b12fa799193c960141e13', 'politica public.comenzi_furnizor_linii.cfl_select': 'ff10e7cfb07b12fa799193c960141e13',
      'trigger public.stocuri_miscari.trg_stocuri_aplica_miscare': '10533886a240177dcb7617cac87e16f3',
      'trigger public.comenzi_furnizor_linii.trg_cfl_automatch': '077feba68ded8a050d1855c4198bf787', 'trigger public.comenzi_furnizor_linii.trg_cfl_sync_cereri': 'd5b676e2861214f7daee06185a06584c',
      'coloana public.comenzi_furnizor_linii.cantitate_primita': '207a4822063e795fad00b2672a255bfb', 'coloana public.comenzi_furnizor_linii.cantitate_intrata_stoc': 'c2a889e88dc8c7ded6fda4c073b79567',
      'coloana public.stocuri.cantitate': '6caaac7878bdfadaf8e1ab8abb5e5047',
    }
    const dbp = await bazaNoua()
    await dbp.exec('BEGIN; ' + gen('guc_local'))
    const r = (await dbp.query(`SELECT r.eticheta, md5(r.detaliu) AS a FROM (${gen('bloc', 'AG_CATALOG v2')}) r WHERE r.eticheta = ANY ($1::text[])`, [Object.keys(PROD)])).rows
    await dbp.exec('ROLLBACK'); await dbp.close()
    const dif = Object.keys(PROD).filter(k => (r.find(x => x.eticheta === k) || {}).a !== PROD[k])
    ok(!dif.length && r.length === Object.keys(PROD).length, `scheletul = producția (citirea din 24.11.2026) pe ${r.length} obiecte (dependențe, relații, CHECK-uri, politici, trigger-e, coloane)${dif.length ? ': ' + dif.join(' | ') : ''}`)
  }
  const db = await bazaNoua()
  ok(/garda start invalida/.test(await eroare(aplicaMig(db, MIG, { marcaj: false }))), 'fără marcajul runnerului = refuz')
  ok(/AMPRENTA_GLOBALA_LIPSA/.test(await eroare(aplicaMig(db, MIG, { l15: 'nimic' }))), 'fără pasul L15 „înainte” al runnerului = refuz')
  ok(/PLAFON_TRANZACTIE lipsa/.test(await eroare(aplicaMig(db, MIG, { plafon: 2000 }))), 'plafonul 2000 în loc de 5000 = refuz')
  // preflight: o linie cu intrata peste primita = refuz cu numărul
  await caServer(db, `INSERT INTO public.comenzi_furnizor (numar_comanda, status) VALUES ('CMD_T_PRE', 'in_stoc')`)
  await caServer(db, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, cantitate, cantitate_primita, cantitate_intrata_stoc)
    SELECT id, 'MAT_A', 10, 5, 6 FROM public.comenzi_furnizor WHERE numar_comanda = 'CMD_T_PRE'`)
  ok(/1 linii au cantitate_intrata_stoc peste/.test(await eroare(aplicaMig(db)) || ''), 'preflight: 1 linie cu intrata > primita = refuz')
  await db.query(`DELETE FROM public.comenzi_furnizor WHERE numar_comanda = 'CMD_T_PRE'`)
  // o dependență schimbată = refuz
  await db.exec(`ALTER FUNCTION public.fn_stoc_ajustare(text, bigint, text, text, numeric, text) SECURITY INVOKER`)
  ok(/dependenta public.fn_stoc_ajustare/.test(await eroare(aplicaMig(db)) || ''), 'dependența fn_stoc_ajustare schimbată (INVOKER) = refuz')
  await db.exec(`ALTER FUNCTION public.fn_stoc_ajustare(text, bigint, text, text, numeric, text) SECURITY DEFINER`)
  // un trigger în plus pe o tabelă atinsă = refuz; un drept pe coloană = refuz
  await db.exec(`CREATE TRIGGER t_strain BEFORE UPDATE ON public.stocuri FOR EACH ROW EXECUTE FUNCTION public.fn_comercial_touch_updated_at()`)
  ok(/trigger-ele tabelelor atinse difera/.test(await eroare(aplicaMig(db)) || ''), 'un trigger în plus pe stocuri = refuz')
  await db.exec(`DROP TRIGGER t_strain ON public.stocuri; GRANT SELECT (denumire) ON public.comenzi_furnizor_linii TO anon`)
  ok(/drepturile pe comenzi_furnizor_linii/.test(await eroare(aplicaMig(db)) || ''), 'un drept pe coloană pe linii = refuz')
  await db.exec(`REVOKE SELECT (denumire) ON public.comenzi_furnizor_linii FROM anon`)
  ok(Number(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'fn\\_cf\\_%' AND proname NOT IN ('fn_cf_sync_cereri', 'fn_cf_touch_updated')`)) === 0, 'după refuzuri: nimic creat')
}

// baza principală (aplicată ca la livrare)
const DB = await bazaNoua()
const STARE_INAINTE = async db => (await q1(db, `SELECT jsonb_build_object(
  'col', (SELECT string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY c.relname, a.attnum)
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname IN ('comenzi_furnizor_linii', 'stocuri', 'stocuri_miscari', 'comenzi_furnizor') AND c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped),
  'con', (SELECT string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE c.relnamespace = 'public'::regnamespace AND k.contype <> 'n'),
  'trg', (SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE NOT t.tgisinternal),
  'pol', (SELECT string_agg(p.polname, ',' ORDER BY p.polname) FROM pg_policy p),
  'acl', (SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, '-'), ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace),
  'fn', (SELECT string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '-'), ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
  'rel', (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace)) AS s`)).s
const S_INAINTE = await STARE_INAINTE(DB)
{
  const t1 = blocAmprenta(MIG), t2 = blocAmprenta(REV)
  if (ruleaza('t0')) {
    ok(t1 && t1 === t2, `blocul AMPRENTA identic în migrare și revenire (${t1?.length} / ${t2?.length} caractere)`)
    const k1 = constanteAmprenta(MIG), k2 = constanteAmprenta(REV)
    ok(k1.length === 1 && k2.length === 1 && k1[0] === k2[0], `aceeași constantă în ambele fișiere (${k1} / ${k2})`)
  }
  let j = []
  try { j = ruleaza('t0') ? await aplicaLivrare(DB) : await aplicaMig(DB) } catch (e) { console.log('     ' + e.message); (e.jurnal || []).filter(m => /AMPRENTA_20270110a_TEXT/.test(m)).forEach(m => console.log('     ' + m)) }
  if (ruleaza('t0') || ruleaza('t1')) {
    ok(j.some(m => /linii existente \(intrare_reconciliata = false pana la reconciliere\) = 0/.test(m)), 'NOTICE: liniile existente (0 în schelet)')
    ok(/CF_DEJA_APLICATA/.test(await eroare(aplicaMig(DB)) || ''), 't1_reaplicare: a doua aplicare = CF_DEJA_APLICATA')
  }
}

if (ruleaza('t1') || ruleaza('t2') || ruleaza('t3') || ruleaza('t4')) {
  console.log('t1–t4. comportamentul după migrare (ca authenticated / service_role / postgres)')
  const pe = { t1: ['tabele'], t2: ['client_vechi', 'identitate', 'mutare', 'cheie_exacta', 'stergere', 'lock', 'ordine_chei'], t3: ['receptie', 'sold', 'null_dovada', 'predare', 'transport', 'nereconciliata'],
    t4: ['retur', 'anulare', 'renuntare', 'cronologic', 'zecimale', 'comanda_invalida', 'drept', 'drept_final', 'idempotenta', 'cereri'] }
  const doar = Object.entries(pe).filter(([s]) => ruleaza(s)).flatMap(([, v]) => v)
  const ab = await verifica(DB, { doar })
  ok(ab.length === 0, `toate verificările de comportament (${doar.length} grupuri)` + (ab.length ? ':\n       - ' + ab.join('\n       - ') : ''))
  if (ruleaza('t4')) {
    const t0 = Date.now()
    const p = await proprietate(DB, NR_SECVENTE)
    const acoperire = Object.entries(STAT).map(([k, v]) => `${k} ${v.ok}/${v.refuz}`).join(', ')
    ok(p.ab.length === 0 && p.reusite > NR_SECVENTE * 3 && p.refuzuri > 0 && Object.values(STAT).every(v => v.ok > 0),
      `t4_proprietate: ${NR_SECVENTE} secvențe, ${p.ops} operații (${p.reusite} reușite, ${p.refuzuri} refuzate; reușite/refuzate pe operație: ${acoperire}), ${Math.round((Date.now() - t0) / 1000)} s`
      + (p.ab.length ? ':\n       - ' + p.ab.join('\n       - ') : ''))
  }
}

if (ruleaza('t5')) {
  console.log('t5. porțile care au blocat livrări pe clonă — GATE 0e (scripts/control_0e.sql, verbatim) și poarta Izometrie E2 (blocul din 20261230a) — neschimbate de migrare')
  const C0E = citeste('scripts/control_0e.sql')
  const M30 = citeste('supabase/migrations/20261230a_izometrie_porti_reconciliere.sql')
  const A0 = "    DECLARE\n      c_rel oid[]; c_fn oid[] := '{}';", i0 = M30.indexOf(A0), j0 = M30.indexOf('\n    END;\n', i0)
  const BLOC = i0 >= 0 && j0 > i0 ? M30.slice(i0, j0 + '\n    END;\n'.length) : ''
  ok(BLOC && M30.indexOf(A0, i0 + 1) < 0, `blocul E2 extras din 20261230a (${BLOC.length} caractere, unic)`)
  const FN_E2 = `CREATE SCHEMA IF NOT EXISTS proba_porti_retur;
CREATE OR REPLACE FUNCTION proba_porti_retur.bloc_e2_20261230a_proba() RETURNS text[] LANGUAGE plpgsql AS $proba_retur$
DECLARE v text[] := '{}'; r record;
BEGIN
${BLOC}
  RETURN v;
END $proba_retur$;`
  const porti = async db => {
    await db.exec('RESET ROLE; ' + FN_E2)
    const e2 = (await q1(db, 'SELECT proba_porti_retur.bloc_e2_20261230a_proba() AS v')).v || []
    const g0e = (await db.query(C0E)).rows.map(x => `${x.functie} | ${x.motive}`)
    return { e2, g0e }
  }
  const dbB = await bazaNoua(); const inainte = await porti(dbB); await dbB.close()
  const dupa = await porti(DB)
  ok(JSON.stringify(dupa.e2) === JSON.stringify(inainte.e2), `poarta E2 neschimbată de migrare (${inainte.e2.length} → ${dupa.e2.length} elemente): ${dupa.e2.filter(x => !inainte.e2.includes(x)).join(' | ').slice(0, 200)}`)
  ok(JSON.stringify(dupa.g0e) === JSON.stringify(inainte.g0e) && !dupa.g0e.some(x => /fn_cf_|fn_stoc_/.test(x)),
    `GATE 0e: nicio funcție nouă expusă găsită (${inainte.g0e.length} → ${dupa.g0e.length} rânduri): ${dupa.g0e.filter(x => /fn_cf_|fn_stoc_/.test(x)).join(' | ').slice(0, 200)}`)
  await DB.exec('DROP SCHEMA proba_porti_retur CASCADE')
}

if (ruleaza('t6')) {
  console.log('t6. revenirea')
  ok(/garda invalida/.test(await eroare(revino(DB, REV, { marcaj: false }))), 'revenirea fără marcaj = refuz')
  if (ruleaza('t4') || ruleaza('t3')) {
    const e = await eroare(revino(DB))
    ok(/ISTORIC_NOU: .*retururi \/ anulari.*jurnalul receptiilor.*intentii.*miscari de stoc ale caii noi/.test(e || ''), `istoric nou = refuz, nimic schimbat: ${(e || 'TRECE').slice(0, 160)}`)
  }
  ok(/starea nu e cea din 20270110a \(obiectele migrarii lipsesc\)/.test(await eroare(revino(await bazaNoua())) || ''), 'revenirea pe o bază fără migrare = refuz al gărzii')
  // proba 14 (revenire): după o singură recepție normală (fără retur) = refuz
  {
    const db = await bazaNoua(); await aplicaMig(db)
    const cf = await comanda(db, { status: 'emisa' }); const l = await linie(db, cf)
    await R(db, U.ACH, { linie: l, n: 5, citita: null })
    const e = await eroare(revino(db))
    ok(/ISTORIC_NOU: 1 randuri in jurnalul receptiilor, 1 intentii/.test(e || ''), `o singură recepție (fără retur) = refuz: ${(e || 'TRECE').slice(0, 120)}`)
  }
  // amprenta schimbată → refuz; aplicare → revenire → reaplicare pe bază curată
  const db = await bazaNoua()
  const s0 = await STARE_INAINTE(db)
  await aplicaMig(db)
  await db.exec('CREATE INDEX x_strain ON public.comenzi_furnizor_retururi (creat_la)')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revino(db)) || ''), 'un index în plus pe un tabel nou = refuz al revenirii')
  await db.exec('DROP INDEX public.x_strain; GRANT EXECUTE ON FUNCTION public.fn_stoc_blocheaza(text, bigint, text) TO authenticated')
  ok(/AMPRENTA obiectelor migrarii/.test(await eroare(revino(db)) || ''), 'drepturile unei funcții schimbate = refuz al revenirii')
  await db.exec('REVOKE EXECUTE ON FUNCTION public.fn_stoc_blocheaza(text, bigint, text) FROM authenticated')
  // o linie nouă (reconciliată de server) nu oprește revenirea
  const cf = await comanda(db, { status: 'draft' }); await caRol(db, 'authenticated', U.ACH, `INSERT INTO public.comenzi_furnizor_linii (comanda_furnizor_id, denumire, cantitate) VALUES ($1, 'MAT_A', 3)`, [cf])
  const jr = await revino(db)
  const s1 = await STARE_INAINTE(db)
  ok(jr.some(m => /linii cu intrare_reconciliata = true \(marcajul se pierde\) = 1/.test(m)) && JSON.stringify(s1) === JSON.stringify(s0),
    'revenirea: schema identică cu starea de dinainte (coloane, drepturi pe coloane, constrângeri, trigger-e, politici, ACL, funcții, relații)')
  await aplicaMig(db)
  const ab = await verifica(db, { doar: ['client_vechi', 'retur', 'anulare', 'renuntare'] })
  ok(ab.length === 0, 'reaplicarea după revenire: comportamentul' + (ab.length ? ': ' + ab.join(' | ') : ''))
  ok(JSON.stringify(S_INAINTE) === JSON.stringify(s0), 'starea de dinainte e aceeași pe două baze noi (determinism)')
}

if (ruleaza('t7')) {
  console.log('t7. MUTANȚI ai migrării (comportament: postcondițiile scoase, ca mutantul să ajungă la verificări; apoi refuzul postcondițiilor)')
  const POST = '-- ─── 7. Postcondiții'
  const MUTANTI = [
    ['fără lock de stoc la retur (citire simplă a stocului)', [['    v_stoc := public.fn_stoc_blocheaza(p_locatie_tip, p_locatie_id, v_l.denumire);',
      '    SELECT coalesce(sum(s.cantitate), 0) INTO v_stoc FROM public.stocuri s WHERE s.locatie_tip = p_locatie_tip AND s.locatie_id IS NOT DISTINCT FROM p_locatie_id AND s.material_denumire = v_l.denumire;']], ['lock']],
    // (r2) cu reverificarea finală prezentă, dreptul citit înaintea lock-urilor e prins tot de ea: mutantul le scoate pe amândouă (starea dinainte de r1)
    ['dreptul verificat înaintea lock-urilor, fără reverificarea finală', [
      ["  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, false);\n  v_l := v_p.linie;\n  PERFORM 1 FROM public.comenzi_furnizor_retururi t0 WHERE t0.linie_id = p_linie_id AND t0.tip = 'retur' ORDER BY t0.id FOR UPDATE;\n  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;",
       "  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;\n  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, false);\n  v_l := v_p.linie;\n  PERFORM 1 FROM public.comenzi_furnizor_retururi t0 WHERE t0.linie_id = p_linie_id AND t0.tip = 'retur' ORDER BY t0.id FOR UPDATE;"],
      ["  IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;\n", '']], ['drept']],
    ['fără reverificarea finală a dreptului (la închiderea intenției)', [["  IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;\n", '']], ['drept_final']],
    ['fără reverificarea finală la ștergerea poziției', [["  IF NOT public.fn_cf_este_owner_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;\n  RETURN jsonb_build_object('stoc_id'",
      "  RETURN jsonb_build_object('stoc_id'"]], ['drept_final']],
    ['cheile de stoc luate după prima mișcare (r1: predarea / transportul direct)', [['  IF v_loc_err IS NULL THEN\n    FOR k IN', '  IF false THEN\n    FOR k IN']], ['ordine_chei']],
    ['mutarea liniei: doar comanda sursă verificată (r1: destinația ignorată)', [['WHERE c.id IN (OLD.comanda_furnizor_id, NEW.comanda_furnizor_id)\n                     AND (coalesce',
      'WHERE c.id IN (OLD.comanda_furnizor_id)\n                     AND (coalesce']], ['mutare']],
    ['mutarea liniei: marcajul moștenirii nerecalculat', [["    NEW.intrare_reconciliata := NOT EXISTS (SELECT 1 FROM public.stocuri_miscari m\n                                             WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor' AND m.ref_id = NEW.comanda_furnizor_id);\n  ELSIF",
      '  ELSIF']], ['mutare']],
    ['fără CAS pe p_primita_citita', [['  IF v_p.primita_bruta IS DISTINCT FROM p_primita_citita THEN', '  IF false THEN']], ['receptie']],
    ['fără garda de reconciliere la fn_cf_intra_stoc', [["  IF NOT v_l.intrare_reconciliata THEN\n    RAISE EXCEPTION 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' USING ERRCODE = 'P0001';\n  END IF;\n  IF NOT public.fn_cf_cantitate_valida_intern(p_cantitate) OR p_cantitate <= 0 THEN\n    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: cantitatea predata",
      "  IF NOT public.fn_cf_cantitate_valida_intern(p_cantitate) OR p_cantitate <= 0 THEN\n    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: cantitatea predata"]], ['nereconciliata']],
    ['fără marcajul app.cf_cantitati (protecția liniei dezactivată)', [["  IF NOT v_rpc AND (NEW.cantitate_primita IS DISTINCT FROM OLD.cantitate_primita", "  IF false AND (NEW.cantitate_primita IS DISTINCT FROM OLD.cantitate_primita"]], ['client_vechi']],
    ['fără REVOKE UPDATE pe tabel (doar trigger-ul)', [['REVOKE UPDATE ON TABLE public.comenzi_furnizor_linii FROM authenticated;\n', '']], ['client_vechi']],
    ['fără înghețarea identității pe NULL (dovada doar din cantități)', [["               OR p_cf.receptie_mp_la IS NOT NULL OR p_cf.receptie_achizitii_la IS NOT NULL\n               OR p_cf.status IN ('receptionata', 'in_stoc')\n", '']], ['identitate']],
    ['compensare FIFO în loc de LIFO', [["WHERE r1.linie_id = p_linie_id AND r1.tip <> 'corectura' ORDER BY r1.id DESC LOOP", "WHERE r1.linie_id = p_linie_id AND r1.tip <> 'corectura' ORDER BY r1.id LOOP"]], ['cronologic', 'sold']],
    ['fără refuzul renunțării la corectură (renunțarea ștearsă la redeschidere)', [['           SET cantitate_inlocuita = t4.cantitate_inlocuita - v_x, asteapta_inlocuire = true, inchis_fel = NULL, inchis_la = NULL\n',
      '           SET cantitate_inlocuita = t4.cantitate_inlocuita - v_x, cantitate_renuntata = 0, asteapta_inlocuire = true, inchis_fel = NULL, inchis_la = NULL\n']], ['renuntare']],
    ['fără UNIQUE (retur_id) pe anulare', [['  CONSTRAINT comenzi_furnizor_retururi_retur_id_key UNIQUE (retur_id),\n', '']], ['anulare']],
    ['fără verificarea hash-ului payload-ului', [['  IF r.rpc IS DISTINCT FROM p_rpc OR r.payload_hash IS DISTINCT FROM md5(p_payload::text) THEN', '  IF r.rpc IS DISTINCT FROM p_rpc THEN']], ['idempotenta']],
    ['fără trigger-ul de lock pe ieșiri', [['CREATE TRIGGER trg_stoc_miscari_lock_iesire BEFORE INSERT ON public.stocuri_miscari FOR EACH ROW WHEN (NEW.delta < 0)\n  EXECUTE FUNCTION public.fn_stoc_miscari_lock_iesire();\n', '']], ['lock']],
    ['fără protecția istoricului la ștergere', [['    IF public.fn_stoc_miscare_protejata(OLD.tip, OLD.ref_tip) THEN\n      RAISE EXCEPTION \'CF_ISTORIC_PROTEJAT: pozitie cu istoric de achizitie / retur; corectati prin ajustare\' USING ERRCODE = \'P0001\';\n    END IF;\n    RETURN OLD;',
      '    RETURN OLD;']], ['stergere']],
    ['fără verificarea stocului la retur', [["  IF v_din > v_stoc THEN\n    RAISE EXCEPTION 'CF_STOC_INSUFICIENT", "  IF false THEN\n    RAISE EXCEPTION 'CF_STOC_INSUFICIENT"]], ['retur']],
    ['fără provenienta mișcărilor (clientul vechi scrie intrări)', [["CREATE TRIGGER trg_stoc_miscari_provenienta BEFORE INSERT ON public.stocuri_miscari FOR EACH ROW\n  WHEN (NEW.tip IN ('retur_furnizor', 'retur_furnizor_anulare') OR NEW.ref_tip IN ('comanda_furnizor', 'comanda_furnizor_linie', 'comanda_furnizor_retur'))\n  EXECUTE FUNCTION public.fn_stoc_miscari_provenienta();\n", '']], ['client_vechi']],
    ['anularea fără mișcarea de stoc', [["  IF v_t.din_stoc > 0 THEN\n    INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip, ref_id, created_by)\n    VALUES (v_t.locatie_tip",
      "  IF false THEN\n    INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip, ref_id, created_by)\n    VALUES (v_t.locatie_tip"]], ['anulare']],
  ]
  for (const [nume, lista, grupuri] of MUTANTI) {
    let text
    try { text = aplica(MIG, lista) } catch (e) { ok(false, `mutantul „${nume}”: ${e.message}`); continue }
    const db = await bazaNoua()
    let ab
    try {
      await aplicaMig(db, text.slice(0, text.indexOf(POST)))
      ab = await verifica(db, { doar: grupuri })
    } catch (e) { ab = ['aplicarea a picat: ' + e.message] }
    ok(ab.length > 0, `mutantul „${nume}” e prins de comportament (${ab.length}): ${ab.join(' | ').slice(0, 220) || 'NIMIC'}`)
    await db.close()
    const db2 = await bazaNoua()
    const err = await eroare(aplicaMig(db2, text))
    ok(/20270110a post:/.test(err || ''), `mutantul „${nume}” e refuzat la aplicare de postcondiții (${(err || 'TRECE').slice(0, 100)})`)
    await db2.close()
  }
}

if (ruleaza('t8')) {
  console.log('t8. dry-run-ul clonei (supabase/tests/20270110a_achizitii_retur_furnizor_dryrun.sql) pe PGlite, după aplicare (fără meta-comenzile psql)')
  const db = await bazaNoua()
  await aplicaMig(db)
  // pe producție user_module_access.module are FK spre app_modules(key); scheletul nu le are: tabela minimă, ca fixtura să le poată crea
  await db.exec('CREATE TABLE public.app_modules (key text PRIMARY KEY, parent_key text, name text, is_active boolean, show_on_homepage boolean)')
  const DRY = citeste(`supabase/tests/${NUME}_dryrun.sql`).split('\n').filter(l => !l.startsWith('\\')).join('\n')
  const jr = []
  const e = await eroare(db.exec(DRY, { onNotice: n => jr.push(n.message) }))
  const okuri = jr.filter(m => /^D\d OK/.test(m)).map(m => m.slice(0, 2))
  ok(!e && JSON.stringify(okuri) === JSON.stringify(['D0', 'D1', 'D2', 'D3', 'D4', 'D5']), `dry-run: ${okuri.join(' ')} ${e ? '— ' + e.slice(0, 200) : ''}`)
  ok(Number(await val(db, `SELECT count(*)::int FROM public.comenzi_furnizor WHERE numar_comanda LIKE 'CMD_T_DRY%'`)) === 0, 'dry-run: nimic rămas după ROLLBACK')
}

if (ruleaza('t9')) {
  console.log('t9. scriptul de moștenire (scripts/achizitii_retur_reconciliere_mostenire.sql): clasificarea (vederea) și aplicarea, pe date sintetice')
  const S = citeste('scripts/achizitii_retur_reconciliere_mostenire.sql')
  const VEDERE = S.slice(S.indexOf('CREATE TEMP VIEW v_mostenire AS'), S.indexOf("\\echo '== liniile nereconciliate"))
  const APLICA = S.slice(S.indexOf("SET LOCAL app.cf_cantitati = '1';"), S.indexOf("\\echo '== control dupa")).split('\n').filter(l => !l.startsWith('\\')).join('\n')
  ok(VEDERE.length > 500 && /UPDATE public\.comenzi_furnizor_linii/.test(APLICA), `blocurile extrase din script (vederea ${VEDERE.length}, aplicarea ${APLICA.length} caractere)`)
  const db = await bazaNoua()
  await aplicaMig(db)
  const veche = async (cf, den, um, delta) => caServer(db, `INSERT INTO public.stocuri_miscari (locatie_tip, material_denumire, um, delta, tip, motiv, ref_tip, ref_id) VALUES ('sediu', $1, $2, $3, 'intrare_achizitie', 'vechi', 'comanda_furnizor', $4)`, [den, um, delta, cf])
  const c1 = await comanda(db, { status: 'in_stoc' })
  const x = await linie(db, c1, { denumire: 'Mat_X ', um: 'BUC', cantitate: 10, rec: false }), y = await linie(db, c1, { denumire: 'MAT_Y', cantitate: 5, primita: 5, intrata: 5, rec: false })
  await veche(c1, 'MAT_X', 'buc', 6); await veche(c1, 'mat_x', 'buc', 4); await veche(c1, 'MAT_Y', 'buc', 5)
  const c2 = await comanda(db, { status: 'in_stoc' })
  const z1 = await linie(db, c2, { denumire: 'MAT_Z', cantitate: 30, primita: 30, rec: false }), z2 = await linie(db, c2, { denumire: 'MAT_Z', cantitate: 70, primita: 70, rec: false })
  await veche(c2, 'MAT_Z', 'buc', 100)
  const c3 = await comanda(db, { status: 'receptionata' })
  const w = await linie(db, c3, { denumire: 'MAT_W', cantitate: 10, primita: 10, rec: false }); await veche(c3, 'MAT_W', 'buc', 10); await veche(c3, 'MAT_Q', 'buc', 4)
  const c4 = await comanda(db, { status: 'emisa' })
  const f1 = await linie(db, c4, { denumire: 'MAT_F', cantitate: 10, rec: false }), f2 = await linie(db, c4, { denumire: 'MAT_G', cantitate: 10, primita: 10, intrata: 3, rec: false })
  const c5 = await comanda(db, { status: 'receptionata' })
  const p = await linie(db, c5, { denumire: 'MAT_P', cantitate: 10, primita: 10, rec: false }); await veche(c5, 'MAT_P', 'buc', 20)
  const c6 = await comanda(db, { status: 'in_stoc' })
  const rr = await linie(db, c6, { denumire: 'MAT_R', cantitate: 8, primita: 8, rec: false }), ss = await linie(db, c6, { denumire: 'MAT_S', cantitate: 2, primita: 2, rec: false })
  await veche(c6, 'MAT_R', 'buc', 8)
  const asteptat = { [x]: 'atribuibila', [y]: 'atribuibila', [z1]: 'ambigua_linii_gemene', [z2]: 'ambigua_linii_gemene', [w]: 'ambigua_miscari_fara_linie',
    [f1]: 'fara_miscari', [f2]: 'ambigua_contor_fara_miscari', [p]: 'ambigua_peste_primit', [rr]: 'atribuibila', [ss]: 'fara_miscari_pe_reper' }
  await db.exec('RESET ROLE; BEGIN; ' + VEDERE)
  const cl = Object.fromEntries((await db.query(`SELECT linie_id, clasa, suma::text AS suma FROM v_mostenire`)).rows.map(r => [r.linie_id, r]))
  const difc = Object.entries(asteptat).filter(([id, c]) => cl[id]?.clasa !== c).map(([id, c]) => `${id}: ${cl[id]?.clasa} ≠ ${c}`)
  ok(!difc.length, `clasificarea moștenirii (10 linii, 6 comenzi; denumire / UM normalizate doar aici): ${difc.join(' | ') || 'toate clasele așteptate'}`)
  await db.exec(APLICA + '\nDROP VIEW v_mostenire; COMMIT;')
  const st = Object.fromEntries((await db.query(`SELECT id, cantitate_intrata_stoc::text AS i, intrare_reconciliata AS r FROM public.comenzi_furnizor_linii WHERE id = ANY ($1::bigint[])`, [Object.keys(asteptat)])).rows.map(r => [r.id, r]))
  const asteptatDupa = { [x]: ['10', true], [y]: ['5', true], [z1]: ['0', false], [z2]: ['0', false], [w]: ['0', false], [f1]: ['0', true], [f2]: ['3', false], [p]: ['0', false], [rr]: ['8', true], [ss]: ['0', true] }
  const difa = Object.entries(asteptatDupa).filter(([id, [i, r]]) => st[id]?.i !== i || st[id]?.r !== r).map(([id, a]) => `${id}: ${JSON.stringify(st[id])} ≠ ${a}`)
  ok(!difa.length, `aplicarea: atribuibilele primesc suma + marcajul, „fără mișcări” doar marcajul, ambiguele rămân neatinse: ${difa.join(' | ') || 'ok'}`)
  // după aplicare: pe linia atribuită returul din stoc merge (ecranul vechi scria mișcarea cu denumirea EXACTĂ a liniei); pe linia cu altă scriere în
  // stoc („Mat_X ” față de „MAT_X” / „mat_x”) cheia exactă nu găsește marfa: refuz (CF_STOC_INSUFICIENT), nu o ieșire din altă poziție; pe cea ambiguă,
  // refuz până la reconcilierea manuală
  const a1 = await RET(db, U.ACH, { linie: y, n: 2, din: 2 }), a3 = await RET(db, U.ACH, { linie: x, n: 2, din: 2 }), a2 = await INTRA(db, U.ACH, { linie: z1, n: 1 })
  ok(!a1.err && a3.cod === 'CF_STOC_INSUFICIENT' && a2.cod === 'CF_NERECONCILIATA' && await stoc(db, 'sediu', null, 'MAT_Y') === 3,
    `după moștenire: returul pe linia atribuită (${a1.cod || 'ok'}), pe cea cu altă scriere în stoc ${a3.cod}, predarea pe cea ambiguă ${a2.cod}`)
}

console.log(esec ? `\nESEC: ${esec} verificari picate` : '\nTOTUL OK')
process.exit(esec ? 1 : 0)
