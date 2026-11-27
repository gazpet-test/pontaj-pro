// Proba LOCALĂ a migrării 20270113a (Ofertare: citirea clarificărilor doar cu acces Ofertare) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql (tabelele reale, politicile EXACTE de pe producție citite
//   26.11.2026, vederea v_ofertare_clarificari_baza security_invoker, fn_are_acces_ofertare cu corpul EXACT din 20260912). Migrarea rulează ca
//   runnerul: plafonul 5000 (sesiune) + marcajele prologului + PAȘII REALI L15 v2 (scripts/livrare_amprenta_gen.sh) + garda finală reală
//   (lm_fin din scripts/livrare_mesaj.sh); revenirea cu plafonul 2000, fără amprenta globală.
// 0. Validatorul runnerului (5000 / 2000 / fără plafon), fișiere LF fără BOM, lock-ul înaintea verificărilor de stare (L14), amprenta
//    fn_are_acces_ofertare din migrare = textul 20260912 = scheletul, blocurile POLITICI identice între migrare și revenire (încrucișat).
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul authenticated cu JWT-ul fiecărui cont: înainte orice cont logat vede;
//    după: owner / 'ofertare' editor / 'ofertare' admin văd TOT, contul cu alt modul / doar sub-modul ofertare_* / fără modul văd 0 (tabel și
//    vedere); anon nimic; scrierile neschimbate (cu Ofertare scrie, fără = 42501, UPDATE fără Ofertare atinge 0 rânduri); RPC-ul de export
//    își păstrează poarta.
// 2. Livrarea L15 v2: manifestul generat (ROLLBACK) = lista revizuită (EXACT un rând: politica schimbată); GLOBAL greșit / manifest incomplet =
//    refuzul RUNNERULUI; livrarea aprobată + garda finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic; fără migrare pică.
//    2b. ambele ordini față de 20270112a (NEAPLICATĂ): 0112 → 0113 și 0113 → 0112, cu aceleași rezultate (+ dry-run-ul după 0112 → 0113).
// 3. Refuzurile migrării (nimic schimbat): marcaj / plafon / pasul L15; reaplicare; politica SELECT altfel / lipsă / în plus; funcția schimbată
//    (corp, drepturi); vederea fără security_invoker; RLS oprit / forțat.
// 4. Revenirea: apply → revenire → re-apply; revenirea cu plafon / marcaj greșit, pe starea veche, după derivă (politică, funcție) = refuz.
// 5. MUTANȚI: comportamentali (postcondițiile scoase: verificările de la 1 trebuie să-i prindă), structurali (postcondițiile îi prind), pe gărzile
//    de stare ale migrării și pe revenire (același scenariu dă alt rezultat).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ofertare_clarificari_citire_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'cc_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270113a_ofertare_clarificari_citire', NUME_REV = NUME + '_ROLLBACK'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const F_SCHELET = 'supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql'
const NUME_0112 = '20270112a_ofertare_cantitati_masuratori', F_MIG_0112 = `supabase/migrations/${NUME_0112}.sql`
const MIG = citeste(F_MIG), REV = citeste(F_REV), DRY = citeste(F_DRY), SCHELET = citeste(F_SCHELET), MIG_0112 = citeste(F_MIG_0112)

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
const aplica = (text, lista) => {
  let t = text
  for (const [din, in_] of lista) { if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 100)); t = t.split(din).join(in_) }
  return t
}

// ── uneltele runnerului (aceleași funcții ca livrare_migrare.sh) ──
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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

// ── conturile (sintetice) și datele ──
const U = {
  OWNER: '00000000-0000-4000-8000-0000000000e1', OF: '00000000-0000-4000-8000-0000000000e2', ADM: '00000000-0000-4000-8000-0000000000e3',
  STRAIN: '00000000-0000-4000-8000-0000000000e4', SUB: '00000000-0000-4000-8000-0000000000e5', NOMOD: '00000000-0000-4000-8000-0000000000e6',
}
const LIC = 900001, LIC2 = 900002
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  await db.exec(`
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.OF}', 'OF', false), ('${U.ADM}', 'ADM', false),
  ('${U.STRAIN}', 'STRAIN', false), ('${U.SUB}', 'SUB', false), ('${U.NOMOD}', 'NOMOD', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.OF}', 'ofertare', 'editor'), ('${U.ADM}', 'ofertare', 'admin'),
  ('${U.STRAIN}', 'logistica', 'admin'), ('${U.SUB}', 'ofertare_cantitati', 'editor');
INSERT INTO public.ofertare_licitatii (id, nr_anunt, autoritate, obiect, responsabil_id, stare_loturi) VALUES
  (${LIC}, 'T-1', 'AUTORITATE TEST', 'licitatie de test', NULL, 'fara_loturi'), (${LIC2}, 'T-2', 'AUTORITATE TEST', 'alta licitatie', NULL, 'fara_loturi');
INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 1, 'intrebare unu', 'propunere'), (${LIC}, 2, 'intrebare doi', 'propunere'),
  (${LIC2}, 1, 'alta licitatie', 'propunere');
INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare) VALUES
  (${LIC}, 3, 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe' || chr(10) || chr(10) || 'text proba', 'planse_auto:',
   'propunere', 'automat', 'auto_planse_1', jsonb_build_object('evaluare', 'r9b', 'amprenta', 'proba', 'la', now(), 'sursa_generare', 'proba', 'text_hash', md5('text proba')));`)
  return db
}

// Livrarea migrării ca runnerul (tiparul 20270111a / 20270112a): plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, pasul „înainte” REAL
// (aprobat sau „-”), opțional pasul „după” (manifest „-” = generatorul de manifest) și instrucțiunea finală.
async function livreaza(db, text, { nume = NUME, plafon = PLAFON_LIVRARE, marcajPlafon = plafon, ag = true, marcaj = true, aprobat = '-', manifest = null, final = 'COMMIT' } = {}) {
  await db.exec(plafon === null ? 'RESET transaction_timeout' : `SET transaction_timeout = ${plafon}`)
  const T = randomBytes(8).toString('hex')
  const prolog = [marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : '',
    marcajPlafon === null ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '${marcajPlafon}:' || txid_current(), true);`].join('\n')
  const ina = ag ? gen('inainte', T, aprobat) : ''
  const dupa = ag && manifest !== null ? gen('dupa', T, aprobat, manifest) : ''
  const note = []
  try {
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${prolog}`)
    await db.exec(`${ina}\n${text}\n;\n${dupa}`, { onNotice: n => note.push(n.message) })
    await db.exec(final, { onNotice: n => note.push(n.message) })
    return { ok: true, note }
  } catch (e) {
    try { await db.exec('ROLLBACK') } catch { /* închisă */ }
    return { ok: false, eroare: String(e.message), note }
  } finally { await db.exec('RESET transaction_timeout') }
}
const revino = (db, text = REV, o = {}) => livreaza(db, text, { nume: NUME_REV, plafon: PLAFON_REVENIRE, ag: false, ...o })
const livreaza0112 = db => livreaza(db, MIG_0112, { nume: NUME_0112 })

// starea obiectelor (pentru „nimic schimbat” / „starea veche”): politicile deparsate, drepturile, vederea, triggerele, funcția, RLS, rândurile
const POLITICI_SQL = `SELECT string_agg(p.polname::text || '=' || p.polcmd::text || '|' || p.polpermissive::text || '|' || coalesce((SELECT string_agg(ro::regrole::text, ',' ORDER BY ro::regrole::text) FROM unnest(p.polroles) ro), '')
    || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '; ' ORDER BY p.polname::text)
  FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass`
const stare = async db => (await db.query(`SELECT (${POLITICI_SQL}) AS politici,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = 'public.ofertare_clarificari'::regclass) AS acl_tabel,
    coalesce((SELECT coalesce(relacl::text, '-') || '|' || coalesce(array_to_string(reloptions, ','), '-') || '|' || md5(pg_get_viewdef(oid)) FROM pg_class WHERE oid = to_regclass('public.v_ofertare_clarificari_baza')), 'LIPSA') AS vedere,
    (SELECT string_agg(tgname::text || ':' || tgenabled::text, ',' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal) AS triggere,
    (SELECT md5(replace(prosrc, chr(13), '')) || '|' || coalesce(proacl::text, '-') FROM pg_proc WHERE oid = to_regprocedure('public.fn_are_acces_ofertare()')) AS functie,
    (SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = 'public.ofertare_clarificari'::regclass) AS rls,
    (SELECT count(*)::int FROM public.ofertare_clarificari) AS clarificari`)).rows[0]
const QUAL_VECHI = '(auth.uid() IS NOT NULL)', QUAL_NOU = '((auth.uid() IS NOT NULL) AND ( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare))'
const SUBQ = '( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)'
const politiciCu = sel => `clar_all_del=d|true|authenticated|${SUBQ}|-; clar_all_ins=a|true|authenticated|-|${SUBQ}; clar_all_sel=r|true|authenticated|${sel}|-; clar_all_upd=w|true|authenticated|${SUBQ}|${SUBQ}`
let STARE_VECHE = null
const eVeche = s => s.politici === politiciCu(QUAL_VECHI) && s.acl_tabel === STARE_VECHE.acl_tabel && s.vedere === STARE_VECHE.vedere && s.triggere === STARE_VECHE.triggere && s.functie === STARE_VECHE.functie && s.rls === STARE_VECHE.rls
const eNoua = s => s.politici === politiciCu(QUAL_NOU) && s.acl_tabel === STARE_VECHE.acl_tabel && s.vedere === STARE_VECHE.vedere && s.triggere === STARE_VECHE.triggere && s.functie === STARE_VECHE.functie && s.rls === STARE_VECHE.rls

// ── rularea ca un cont (ROLLBACK la final): JWT-ul ca PostgREST, AMBELE surse ──
const jwt = (uid, rol) => uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true); SELECT set_config('request.jwt.claims', '{"sub": "${uid}", "role": "${rol}"}', true);`
  : `SELECT set_config('request.jwt.claim.sub', '', true); SELECT set_config('request.jwt.claims', '{"role": "${rol}"}', true);`
async function ca(db, cont, sql, params = [], { rol = 'authenticated', apoi = null } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${jwt(uid, rol)}`)
  try {
    const id = (await db.query(`SELECT current_user AS u, auth.uid()::text AS uid, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`)).rows[0]
    if (id.u !== rol || (uid ? id.uid !== uid : id.uid !== null) || id.bypass) throw new Error('identitate greșită: ' + JSON.stringify(id))
    const r = await db.query(sql, params)
    const r2 = apoi ? (await db.query(apoi)).rows : null   // o a doua citire, în aceeași tranzacție, ca același cont (vede ce a scris prima)
    await db.exec('ROLLBACK'); return { rows: r.rows, afectate: r.affectedRows ?? null, apoi: r2 }
  } catch (e) { await db.exec('ROLLBACK'); return { code: e.code ?? 'JS', message: e.message } }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows

// ── așteptările (scrise de mână din decizie: 4 clarificări în total, 3 pe LIC, 1 în vedere) ──
const ASTEPTAT_DUPA = { OWNER: [4, 3, 1], OF: [4, 3, 1], ADM: [4, 3, 1], STRAIN: [0, 0, 0], SUB: [0, 0, 0], NOMOD: [0, 0, 0] }
async function numara(db, cont) {
  const r = await ca(db, cont, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari) AS tot, (SELECT count(*)::int FROM public.ofertare_clarificari WHERE licitatie_id = ${LIC}) AS lic,
    (SELECT count(*)::int FROM public.v_ofertare_clarificari_baza) AS ved`)
  return r.code ? r : [r.rows[0].tot, r.rows[0].lic, r.rows[0].ved]
}
// verificările comportamentului DUPĂ migrare: lista abaterilor (goală = bine)
async function verifica(db) {
  const ab = []
  for (const [cont, astept] of Object.entries(ASTEPTAT_DUPA)) {
    const n = await numara(db, cont)
    if (n.code) ab.push(`${cont}: eroare ${n.code} ${n.message}`)
    else if (JSON.stringify(n) !== JSON.stringify(astept)) ab.push(`${cont}: vede [tabel, licitație, vedere] = ${JSON.stringify(n)}, aștepta ${JSON.stringify(astept)}`)
  }
  // anon: nimic (0 rânduri sau fără drept)
  const an = await ca(db, null, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari) AS tot, (SELECT count(*)::int FROM public.v_ofertare_clarificari_baza) AS ved`, [], { rol: 'anon' })
  if (!(an.code === '42501' || (an.rows && an.rows[0].tot === 0 && an.rows[0].ved === 0))) ab.push('anon: ' + JSON.stringify(an))
  // scrierile, neschimbate: cu Ofertare scrie și vede ce a scris; fără Ofertare = 42501; UPDATE fără Ofertare atinge 0 rânduri
  const w1 = await ca(db, 'OF', `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 7, 'scrisa de OF', 'propunere')`,
    [], { apoi: `SELECT count(*)::int AS n FROM public.ofertare_clarificari WHERE licitatie_id = ${LIC}` })
  if (w1.code || w1.afectate !== 1 || w1.apoi[0].n !== 4) ab.push('OF scrie: ' + JSON.stringify(w1))
  const w2 = await ca(db, 'STRAIN', `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 8, 'scrisa de STRAIN', 'propunere')`)
  if (w2.code !== '42501') ab.push('STRAIN scrie: ' + JSON.stringify(w2))
  const w3 = await ca(db, 'STRAIN', `UPDATE public.ofertare_clarificari SET intrebare = intrebare || '!' WHERE licitatie_id = ${LIC}`)
  if (w3.code || w3.afectate !== 0) ab.push('STRAIN UPDATE: ' + JSON.stringify(w3))
  const w4 = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET intrebare = intrebare || '!' WHERE licitatie_id = ${LIC} AND nr = 1`)
  if (w4.code || w4.afectate !== 1) ab.push('OF UPDATE: ' + JSON.stringify(w4))
  // RPC-ul de export (INVOKER, poarta proprie): fără Ofertare = 'fără acces'; admin Ofertare = listă (goală: nimic de_trimis)
  const e1 = await ca(db, 'STRAIN', `SELECT public.ofertare_clarificari_export(${LIC}) AS e`)
  if (!(e1.code && /fără acces/.test(e1.message))) ab.push('STRAIN export: ' + JSON.stringify(e1))
  const e2 = await ca(db, 'ADM', `SELECT jsonb_array_length(public.ofertare_clarificari_export(${LIC})) AS n`)
  if (e2.code || e2.rows[0].n !== 0) ab.push('ADM export: ' + JSON.stringify(e2))
  return ab
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('0. validatorul runnerului, forma fișierelor, amprenta dependenței, blocurile POLITICI')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(PLAFON_LIVRARE === 5000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE}: ${vm.out}`)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.split('\n')[0].slice(0, 120))
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
  for (const f of [F_MIG, F_REV, F_DRY]) {
    const brut = readFileSync(join(ROOT, f), 'utf8')
    ok(!/^﻿/.test(brut) && !/\r/.test(brut), `${f}: fără BOM, LF`)
  }
  ok(/^-- Version 20270113120000\. NEAPLICAT\./.test(MIG) && REV.includes('--versiune 20270113120001'), 'versiunile: migrarea 20270113120000, revenirea 20270113120001')
  const L = 'LOCK TABLE public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;'
  const faraComentarii = t => t.replace(/--[^\n]*/g, '')   // instrucțiunile reale (antetul și comentariile inline citează ALTER POLICY)
  const MIGc = faraComentarii(MIG), REVc = faraComentarii(REV)
  ok(MIGc.split(L).length === 2 && MIGc.indexOf('DO $lock$') > MIGc.indexOf('END $pre$;') && MIGc.indexOf('END $lock$;') < MIGc.indexOf('DO $stare$')
    && MIGc.indexOf('DO $stare$') < MIGc.indexOf('\nALTER POLICY clar_all_sel') && MIGc.indexOf('\nALTER POLICY clar_all_sel') < MIGc.indexOf('DO $post$')
    && REVc.split(L).length === 2 && REVc.indexOf(L) < REVc.indexOf('DO $stare$') && REVc.indexOf('DO $stare$') < REVc.indexOf('\nALTER POLICY clar_all_sel') && REVc.indexOf('\nALTER POLICY clar_all_sel') < REVc.indexOf('DO $post$'),
  'lock-ul (NOWAIT) vine ÎNAINTEA verificărilor de stare, iar ALTER POLICY după ele și înaintea postcondițiilor, în migrare și în revenire (L14)')
  const altceva = /CREATE |DROP |GRANT |REVOKE |ALTER TABLE|ALTER VIEW|ALTER FUNCTION|INSERT |UPDATE |DELETE |TRUNCATE /
  ok(MIGc.split('ALTER POLICY ').length === 2 && REVc.split('ALTER POLICY ').length === 2
    && !altceva.test(MIGc.replace(/CREATE TEMP TABLE cc_foto ON COMMIT DROP/g, '')) && !altceva.test(REVc.replace(/CREATE TEMP TABLE cc_foto ON COMMIT DROP/g, '')),
  'migrarea și revenirea au o singură instrucțiune care schimbă ceva (ALTER POLICY); nimic creat, șters, acordat, retras (în afara fotografiei temporare)')
  // amprenta dependenței: md5 din migrare și revenire = corpul din 20260912 = corpul din schelet
  const corp = t => { const i = t.indexOf('FUNCTION public.fn_are_acces_ofertare()'); const a = t.indexOf('AS $fn$', i) + 7; return t.slice(a, t.indexOf('$fn$;', a)) }
  const m0912 = md5(corp(citeste('supabase/migrations/20260912_ofertare_acces_fara_parametru.sql'))), mSch = md5(corp(SCHELET))
  ok(m0912 === mSch && MIGc.split(m0912).length === 3 && REVc.split(m0912).length === 3, `amprenta fn_are_acces_ofertare (${m0912}) = textul 20260912 = scheletul; în migrare și în revenire (condiție + mesaj)`)
  // r1 Jakarinos P2: revenirea verifică dependențele cu ACELEAȘI condiții ca aplicarea (textual: drepturile exacte ale funcției, dependența vederii)
  const ACL_FN = "= 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')", DEP_VEDERE = "AND d.refobjid = 'public.ofertare_clarificari'::regclass) THEN"
  ok(MIGc.includes(ACL_FN) && REVc.includes(ACL_FN) && MIGc.split(DEP_VEDERE).length === 2 && REVc.split(DEP_VEDERE).length === 2,
    'revenirea cere aceleași drepturi exacte ale funcției și aceeași dependență a vederii de tabel ca migrarea')
  // blocurile POLITICI: migrarea pornește de la cele de azi și ajunge la cele noi; revenirea invers (textual identic, încrucișat)
  const bloc = (t, et) => t.slice(t.indexOf(`-- >>> ${et}`), t.indexOf(`-- <<< ${et}`))
  ok(bloc(MIG, 'POLITICI 26.11.2026') === bloc(REV, 'POLITICI 26.11.2026') && bloc(MIG, 'POLITICI 20270113a') === bloc(REV, 'POLITICI 20270113a')
    && bloc(MIG, 'POLITICI 26.11.2026').includes(`'clar_all_sel', 'r|permisiva|{authenticated}|${QUAL_VECHI}|-'`) && bloc(MIG, 'POLITICI 20270113a').includes(`'clar_all_sel', 'r|permisiva|{authenticated}|${QUAL_NOU}|-'`)
    && MIG.indexOf('-- >>> POLITICI 26.11.2026') < MIG.indexOf('-- >>> POLITICI 20270113a') && REV.indexOf('-- >>> POLITICI 20270113a') < REV.indexOf('-- >>> POLITICI 26.11.2026'),
  'blocurile POLITICI (azi / 20270113a) sunt identice în migrare și revenire și apar în ordinea bună')
}

console.log('1. comportamentul: înainte orice cont logat vede; după, doar accesul Ofertare (tabel și vedere); scrierile și RPC-ul neschimbate')
{
  const db = await bazaNoua()
  STARE_VECHE = await stare(db)
  ok(eVeche(STARE_VECHE) && STARE_VECHE.clarificari === 4, 'scheletul: politicile de azi (26.11.2026), 4 clarificări: ' + STARE_VECHE.politici.slice(0, 120))
  const inainte = {}
  for (const c of Object.keys(ASTEPTAT_DUPA)) inainte[c] = await numara(db, c)
  ok(Object.values(inainte).every(n => JSON.stringify(n) === '[4,3,1]'), 'ÎNAINTE: orice cont logat vede tot (4 / 3 / 1), inclusiv STRAIN, SUB, NOMOD: ' + JSON.stringify(inainte.STRAIN))
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270113a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n))
    && a.note.some(n => /^20270113a: stare verificata \(4 politici, RLS activ\); clarificari existente \(neatinse\): 4$/.test(n)),
  'migrarea se aplică (pasul „înainte” real; lock din prima; 4 clarificări neatinse)' + (a.ok ? '' : ': ' + a.eroare))
  const s1 = await stare(db)
  ok(eNoua(s1) && s1.clarificari === 4, 'DUPĂ: doar politica SELECT s-a schimbat (USING-ul nou, deparsat exact); drepturi / vedere / triggere / funcție / RLS identice')
  const ab = await verifica(db)
  ok(ab.length === 0, `DUPĂ: owner / editor / admin Ofertare văd 4 / 3 / 1; alt modul / sub-modul / fără modul 0; anon nimic; scrierile și exportul ca înainte (${ab.length} abateri${ab.length ? ': ' + ab.join(' | ') : ''})`)
  ok(!a.note.some(n => /vederi peste ofertare_clarificari fara security_invoker/.test(n)), 'pe schelet nicio vedere fără security_invoker peste tabel (NOTICE-ul informativ nu apare)')
  await db.close()
}

console.log('2. livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const ASTEPTATE = ['politica\tpolitica public.ofertare_clarificari.clar_all_sel\tschimbat']
async function dryRun(db, eticheta) {
  const nr = async () => (await db.query(`SELECT (SELECT count(*) FROM public.ofertare_licitatii)::int AS l, (SELECT count(*) FROM public.profiles)::int AS u,
    (SELECT count(*) FROM public.user_module_access)::int AS m, (SELECT count(*) FROM public.ofertare_clarificari)::int AS c`)).rows[0]
  const nr0 = await nr(); const s0 = await stare(db)
  const note = []; let eroare = null
  try { await db.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e.message; try { await db.exec('ROLLBACK') } catch { /* închisă */ } }
  const asteptate = ['t_politica OK', 't_fara_acces OK', 't_cu_acces OK', 't_anon OK', 'TOTUL OK']
  ok(!eroare && asteptate.every(t => note.some(n => n.startsWith('DRY 20270113a ' + t))) && note.some(n => /^DRY 20270113a t_cu_acces OK \(licitatia: 2 clarificari, 1 in vedere; total: 6 \/ 2\)$/.test(n)),
    `${eticheta}dry-run: ${asteptate.length} blocuri OK; numărătorile din NOTICE (2 / 1; 6 / 2)` + (eroare ? ': ' + eroare.slice(0, 200) : ''))
  ok(JSON.stringify(await nr()) === JSON.stringify(nr0) && JSON.stringify(await stare(db)) === JSON.stringify(s0), `${eticheta}dry-run: ROLLBACK, nimic rămas (licitații, conturi, drepturi, clarificări; starea obiectelor)`)
}
{
  const b = await bazaNoua()
  const s0 = await stare(b)
  const g = await livreaza(b, MIG, { manifest: '-', final: 'ROLLBACK' })
  const G = (g.note.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = g.note.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const total = Number((g.note.map(m => m.match(/^L15_DIF_TOTAL (\d+) /)).find(Boolean) || [])[1])
  const fara18 = listaObiecte(manifest).filter(x => !/_not_null\t/.test(x))
  ok(g.ok && G && total === listaObiecte(manifest).length && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    `generatorul de manifest: GLOBAL ${G}, ${total} diferențe anunțate = rândurile tipărite; ROLLBACK, starea neschimbată` + (g.ok ? '' : ': ' + g.eroare))
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OBIECTE),
    `# 20270113a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}: ${fara18.join(' | ')}`)
  // L25: lista așteptată scrisă aici, independent de fișier și de generator
  ok(JSON.stringify(revizuit) === JSON.stringify(ASTEPTATE), 'lista revizuită = EXACT politica clar_all_sel schimbată, nimic creat / șters / altceva schimbat')
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  writeFileSync(fIncomplet, manifest.split('\n').filter(l => !l.startsWith('politica\t')).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && /NEDECLARAT/.test(gi.eroare + gi.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul politicii = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.ok && j.note.some(m => /^AMPRENTA_GLOBALA dupa: 1 diferente = manifestul/.test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.note.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
  'livrarea aprobată: diferența (1) = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat' + (j.ok ? '' : ': ' + j.eroare))
  ok(eNoua(await stare(b)) && (await verifica(b)).length === 0, 'după livrarea aprobată: politica nouă, comportamentul așteptat')
  await dryRun(b, '')
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_politica FAIL: migrarea 20270113a nu e aplicata/.test(ef || ''), 'dry-run pe baza fără 20270113a = eșec (t_politica): ' + (ef || 'TRECE').slice(0, 100))
  await fara.close(); await b.close()
}
console.log('2b. ambele ordini față de 20270112a (NEAPLICATĂ): 0112 → 0113 și 0113 → 0112')
{
  const a = await bazaNoua()
  const r1 = await livreaza0112(a); const r2 = await livreaza(a, MIG)
  const s = await stare(a)
  ok(r1.ok && r2.ok && s.politici === politiciCu(QUAL_NOU), '0112 → 0113: ambele se aplică; politica nouă' + (r1.ok ? '' : ': 0112 ' + r1.eroare) + (r2.ok ? '' : ': 0113 ' + r2.eroare))
  const ab = await verifica(a)
  ok(ab.length === 0, `0112 → 0113: comportamentul așteptat și prin vederea recreată de 20270112a (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
  await dryRun(a, '0112 → 0113: ')
  await a.close()
  const b = await bazaNoua()
  const r3 = await livreaza(b, MIG); const r4 = await livreaza0112(b)
  const s2 = await stare(b)
  ok(r3.ok && r4.ok && s2.politici === politiciCu(QUAL_NOU), '0113 → 0112: ambele se aplică; politica nouă rămâne' + (r3.ok ? '' : ': 0113 ' + r3.eroare) + (r4.ok ? '' : ': 0112 ' + r4.eroare))
  const ab2 = await verifica(b)
  ok(ab2.length === 0, `0113 → 0112: comportamentul așteptat (${ab2.length} abateri${ab2.length ? ': ' + ab2[0] : ''})`)
  await b.close()
}

console.log('3. refuzurile migrării (pe bază nouă, nimic schimbat)')
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['politica SELECT cu alt USING', {}, /politicile ofertare_clarificari difera de cele de azi .*clar_all_sel: r\|permisiva\|\{authenticated\}\|true\|-/, 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (true)'],
  ['politica SELECT lipsă', {}, /politicile ofertare_clarificari difera de cele de azi .*: clar_all_sel$/, 'DROP POLICY clar_all_sel ON public.ofertare_clarificari'],
  ['o politică în plus', {}, /politicile ofertare_clarificari difera de cele de azi .*\+zz_sel: r\|permisiva\|\{anon\}\|true\|-/, 'CREATE POLICY zz_sel ON public.ofertare_clarificari FOR SELECT TO anon USING (true)'],
  ['politica de scriere cu alt WITH CHECK', {}, /difera de cele de azi .*clar_all_ins: a\|permisiva\|\{authenticated\}\|-\|true/, 'ALTER POLICY clar_all_ins ON public.ofertare_clarificari WITH CHECK (true)'],
  ['politica SELECT pentru PUBLIC', {}, /difera de cele de azi .*clar_all_sel: r\|permisiva\|\{PUBLIC\}/, 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari TO PUBLIC'],
  ['funcția cu alt corp', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`],
  ['funcția cu EXECUTE pentru anon', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, 'GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO anon'],
  ['funcția fără EXECUTE pentru authenticated (politica n-ar putea-o chema)', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, 'REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM authenticated'],
  ['funcția SECURITY INVOKER', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, 'ALTER FUNCTION public.fn_are_acces_ofertare() SECURITY INVOKER'],
  ['vederea fără security_invoker', {}, /v_ofertare_clarificari_baza lipseste, nu e vedere security_invoker/, 'ALTER VIEW public.v_ofertare_clarificari_baza RESET (security_invoker)'],
  ['vederea lipsă', {}, /v_ofertare_clarificari_baza lipseste/, 'DROP VIEW public.v_ofertare_clarificari_baza'],
  ['RLS oprit', {}, /RLS pe ofertare_clarificari nu e activ/, 'ALTER TABLE public.ofertare_clarificari DISABLE ROW LEVEL SECURITY'],
  ['RLS forțat', {}, /RLS pe ofertare_clarificari nu e activ \(sau e fortat\)/, 'ALTER TABLE public.ofertare_clarificari FORCE ROW LEVEL SECURITY'],
]) {
  const b = await bazaNoua()
  if (pregatire) await b.exec(pregatire)
  const inainte = await stare(b)
  const r = await livreaza(b, MIG, opt)
  ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(await stare(b)), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 130)})`)
  await b.close()
}
{
  const b = await bazaNoua()
  ok((await livreaza(b, MIG)).ok, 'aplicare pentru reaplicare')
  const s = await stare(b)
  const r = await livreaza(b, MIG)
  ok(!r.ok && /politica clar_all_sel e deja restransa la accesul Ofertare \(reaplicare\)/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'reaplicarea = refuz, nimic schimbat: ' + (r.eroare || '').slice(0, 100))
  await b.close()
}
{
  // o vedere FĂRĂ security_invoker peste tabel: migrarea trece (în afara perimetrului), dar o numește în NOTICE
  const b = await bazaNoua()
  await b.exec('CREATE VIEW public.zz_clarificari_definer AS SELECT id, licitatie_id FROM public.ofertare_clarificari')
  const r = await livreaza(b, MIG)
  ok(r.ok && r.note.some(n => /ATENTIE, vederi peste ofertare_clarificari fara security_invoker .*: zz_clarificari_definer$/.test(n)),
    'o vedere fără security_invoker peste tabel e numită în NOTICE (informativ, nu refuz)' + (r.ok ? ': ' + (r.note.find(n => /ATENTIE/.test(n)) || 'NOTICE lipsă') : ': ' + r.eroare))
  await b.close()
}

console.log('4. revenirea: apply → revenire → re-apply; refuzurile revenirii')
{
  const db = await bazaNoua()
  ok((await livreaza(db, MIG)).ok, 'aplicare pentru revenire')
  const s1 = await stare(db)
  ok(!(await revino(db, REV, { plafon: 5000 })).ok && JSON.stringify(await stare(db)) === JSON.stringify(s1), 'revenirea cu plafonul 5000 = refuz (cere 2000)')
  ok(!(await revino(db, REV, { nume: NUME })).ok, 'revenirea cu marcajul migrării = refuz')
  ok(!(await revino(db, REV, { marcaj: false })).ok, 'revenirea fără marcaj = refuz')
  const v = await revino(db)
  const s2 = await stare(db)
  ok(v.ok && eVeche(s2) && JSON.stringify(await numara(db, 'STRAIN')) === '[4,3,1]', 'revenirea: USING-ul de azi EXACT, nimic altceva atins; orice cont logat vede iar' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea din 20270113a \(politicile ofertare_clarificari\): clar_all_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 140))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && eNoua(await stare(db)) && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
// deriva după livrare: revenirea refuză cu câmpul numit, nimic schimbat
for (const [nume, pregatire, re] of [
  ['politica SELECT schimbată altfel', 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (true)', /\(politicile ofertare_clarificari\): clar_all_sel: r\|permisiva\|\{authenticated\}\|true\|-/],
  ['o politică în plus', 'CREATE POLICY zz_sel ON public.ofertare_clarificari FOR SELECT TO anon USING (true)', /\(politicile ofertare_clarificari\): \+zz_sel/],
  ['funcția schimbată', `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`, /fn_are_acces_ofertare\(\) nu e cea din 20260912/],
  // r1 Jakarinos P2: revenirea verifică ACELEAȘI câmpuri ca aplicarea (drepturile exacte ale funcției, dependența vederii de tabel)
  ['funcția cu EXECUTE pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO anon', /fn_are_acces_ofertare\(\) nu e cea din 20260912 .*drepturi exacte/],
  ['funcția fără EXECUTE pentru authenticated', 'REVOKE EXECUTE ON FUNCTION public.fn_are_acces_ofertare() FROM authenticated', /fn_are_acces_ofertare\(\) nu e cea din 20260912 .*drepturi exacte/],
  ['vederea fără security_invoker', 'ALTER VIEW public.v_ofertare_clarificari_baza RESET (security_invoker)', /v_ofertare_clarificari_baza lipseste, nu e vedere security_invoker/],
  ['vederea ștearsă', 'DROP VIEW public.v_ofertare_clarificari_baza', /v_ofertare_clarificari_baza lipseste/],
  ['RLS oprit', 'ALTER TABLE public.ofertare_clarificari DISABLE ROW LEVEL SECURITY', /RLS pe ofertare_clarificari nu e activ/],
]) {
  const db = await bazaNoua()
  await livreaza(db, MIG)
  await db.exec(pregatire)
  const s = await stare(db)
  const v = await revino(db)
  ok(!v.ok && re.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `revenirea refuză (${nume}), nimic schimbat: ${(v.eroare || 'APLICAT').slice(0, 140)}`)
  await db.close()
}

console.log('5. mutanți')
const FARA_POST = t => { const a = t.indexOf('DO $post$'), b = t.indexOf('END $post$;') + 'END $post$;'.length; return t.slice(0, a) + "DO $post$ BEGIN RAISE NOTICE 'postconditii scoase (mutant)'; END $post$;" + t.slice(b) }
ok(MIG.indexOf('DO $post$') > 0 && MIG.indexOf('END $post$;') > MIG.indexOf('DO $post$'), 'blocul $post$ se găsește')
const comport = async text => {
  const db = await bazaNoua()
  try {
    const a = await livreaza(db, text)
    if (!a.ok) return ['aplicare: ' + a.eroare.slice(0, 120)]
    return await verifica(db)
  } finally { await db.close() }
}
{
  const ab = await comport(FARA_POST(MIG))
  ok(ab.length === 0, `martor: originalul fără postcondiții trece toate verificările (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
}
const ALTER = 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));'
const MUTANTI = [
  ['M1 fără ALTER POLICY (politica rămâne cea de azi)', [[ALTER, '']]],
  ['M2 OR în loc de AND', [[ALTER, 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL OR (SELECT public.fn_are_acces_ofertare()));']]],
  ['M3 ALTER pe altă politică (DELETE), SELECT neatins', [[ALTER, 'ALTER POLICY clar_all_del ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (SELECT public.fn_are_acces_ofertare()));']]],
  ['M4 cheia modulului ca prefix (sub-modulele dau acces, L09)', [[ALTER, `ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module LIKE 'ofertare%'));`]]],
  ['M5 dreptul de decizie în loc de accesul la modul (editorul Ofertare nu mai vede)', [[ALTER, 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (SELECT public.fn_ofertare_source_pack_poate_decide(licitatie_id)));']]],
  ['M6 doar owner-ul vede', [[ALTER, 'ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner));']]],
  ['M7 politica restrânsă doar pe o licitație (restul rămân deschise)', [[ALTER, `ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (auth.uid() IS NOT NULL AND (licitatie_id <> ${LIC} OR (SELECT public.fn_are_acces_ofertare())));`]]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: /.test(ab[0]), `${nume} pică comportamental (${ab[0] || 'NU a picat'})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără ALTER POLICY', MUTANTI[0][1], /postconditie: politicile ofertare_clarificari: clar_all_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/],
  ['S2 OR în loc de AND', MUTANTI[1][1], /postconditie: politicile ofertare_clarificari: clar_all_sel: .*\) OR \( SELECT/],
  ['S3 ALTER pe DELETE', MUTANTI[2][1], /postconditie: politicile ofertare_clarificari: clar_all_del: .*; clar_all_sel: /],
  ['S4 cheia modulului ca prefix', MUTANTI[3][1], /postconditie: politicile ofertare_clarificari: clar_all_sel: /],
  ['S5 REVOKE în plus pe tabel', [[ALTER, ALTER + '\nREVOKE SELECT ON public.ofertare_clarificari FROM anon;']], /s-a schimbat altceva decat politica SELECT: acl_tabel \(era .*, acum /],
  ['S6 vederea fără security_invoker', [[ALTER, ALTER + '\nALTER VIEW public.v_ofertare_clarificari_baza RESET (security_invoker);']], /s-a schimbat altceva decat politica SELECT: vedere \(era /],
  ['S7 trigger dezactivat', [[ALTER, ALTER + '\nALTER TABLE public.ofertare_clarificari DISABLE TRIGGER trg_ofertare_clarificari_baza;']], /s-a schimbat altceva decat politica SELECT: triggere \(era /],
  ['S8 GRANT în plus pe funcție', [[ALTER, ALTER + '\nGRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO anon;']], /s-a schimbat altceva decat politica SELECT: functie \(era /],
  ['S9 o politică în plus', [[ALTER, ALTER + '\nCREATE POLICY zz_sel ON public.ofertare_clarificari FOR SELECT TO anon USING (true);']], /postconditie: politicile ofertare_clarificari: \+zz_sel: r\|permisiva\|\{anon\}\|true\|-/],
  ['S10 RLS oprit după ALTER', [[ALTER, ALTER + '\nALTER TABLE public.ofertare_clarificari DISABLE ROW LEVEL SECURITY;']], /s-a schimbat altceva decat politica SELECT: rls \(era true\|false, acum false\|false\)/],
]) {
  const db = await bazaNoua()
  const s = await stare(db)
  let r
  try { r = await livreaza(db, aplica(MIG, inl)) } catch (e) { r = { ok: false, eroare: 'mutant inaplicabil: ' + e.message } }
  ok(!r.ok && re.test(r.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `${nume}: refuzat de postcondiții (${(r.eroare || 'APLICAT').slice(0, 130)})`)
  await db.close()
}
console.log('   pe gărzile de stare ale migrării și pe revenire (același scenariu, alt rezultat)')
const rezultat = async (scenariu, text) => {
  const db = await bazaNoua()
  try { const r = await scenariu(db, text); return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(await stare(db))}` } finally { await db.close() }
}
const FN_TRUE = `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const SCEN = {
  selAltfel: async (db, t) => { await db.exec('ALTER POLICY clar_all_sel ON public.ofertare_clarificari USING (true)'); return livreaza(db, t) },
  fnDeriva: async (db, t) => { await db.exec(FN_TRUE); return livreaza(db, t) },
  vedereFara: async (db, t) => { await db.exec('ALTER VIEW public.v_ofertare_clarificari_baza RESET (security_invoker)'); return livreaza(db, t) },
  rlsOprit: async (db, t) => { await db.exec('ALTER TABLE public.ofertare_clarificari DISABLE ROW LEVEL SECURITY'); return livreaza(db, t) },
  revVeche: async (db, t) => revino(db, t),
  revFnDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_TRUE); return revino(db, t) },
  revVedereFara: async (db, t) => { await livreaza(db, MIG); await db.exec('ALTER VIEW public.v_ofertare_clarificari_baza RESET (security_invoker)'); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără verificarea exactă a politicilor', 'mig', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a: politicile ofertare_clarificari difera de cele de azi (26.11.2026): %', v_rau; END IF;\n", '']], 'selAltfel'],
  ['P2 migrare: fără verificarea funcției', 'mig', [["    RAISE EXCEPTION '20270113a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'fnDeriva'],
  ['P3 migrare: fără verificarea vederii', 'mig', [["    RAISE EXCEPTION '20270113a: v_ofertare_clarificari_baza lipseste, nu e vedere security_invoker = on sau nu citeste ofertare_clarificari';\n", '    NULL;\n']], 'vedereFara'],
  ['P4 migrare: fără verificarea RLS', 'mig', [["    RAISE EXCEPTION '20270113a: RLS pe ofertare_clarificari nu e activ (sau e fortat)';\n", '    NULL;\n']], 'rlsOprit'],
  ['R1 revenire: fără verificarea exactă a politicilor', 'rev', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270113a revenire: starea nu e cea din 20270113a (politicile ofertare_clarificari): %', v_rau; END IF;\n", '']], 'revVeche'],
  ['R2 revenire: fără verificarea funcției', 'rev', [["    RAISE EXCEPTION '20270113a revenire: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revFnDeriva'],
  ['R3 revenire: fără verificarea vederii', 'rev', [["    RAISE EXCEPTION '20270113a revenire: v_ofertare_clarificari_baza lipseste, nu e vedere security_invoker = on sau nu citeste ofertare_clarificari';\n", '    NULL;\n']], 'revVedereFara'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 80)}» / mutant «${rm.slice(0, 80)}»`)
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
