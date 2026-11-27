// Proba LOCALĂ a migrării 20270114a (Ofertare: punctele unei clarificări doar pentru owner / responsabilii licitației) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql (roluri, auth.uid(), profiles, user_module_access, ofertare_licitatii,
//   ofertare_clarificari, fn_are_acces_ofertare 20260912, fn_ofertare_poate_cheltui 20261124a — corpuri EXACTE) + supabase/tests/20270114a_…_schelet.sql
//   (ofertare_clarificari_puncte EXACT ca în 20260928l, politicile de azi, triggerul, drepturile ca pe producție). Migrarea rulează ca runnerul: plafonul
//   5000 (sesiune) + marcajele prologului + PAȘII REALI L15 v2 (scripts/livrare_amprenta_gen.sh) + garda finală reală (lm_fin din scripts/livrare_mesaj.sh);
//   revenirea cu plafonul 2000, fără amprenta globală.
// 0. Validatorul runnerului (5000 / 2000 / fără plafon), fișiere LF fără BOM, lock-urile înaintea verificărilor de stare (L14), inventarul instrucțiunilor
//    (migrarea: 3 CREATE FUNCTION + 3 REVOKE + 2 GRANT + 3 COMMENT + 1 CREATE TRIGGER + 2 ALTER POLICY; revenirea: 2 ALTER POLICY + DROP TRIGGER + 3 DROP
//    FUNCTION), amprentele dependențelor din migrare = textele 20260912 / 20261124a = scheletul, amprentele funcțiilor noi = corpurile din migrare, blocurile
//    POLITICI / FUNCTII identice între migrare și revenire.
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul authenticated cu JWT-ul fiecărui cont: înainte orice cont logat vede punctele și
//    oricine cu Ofertare scrie; după: owner vede / scrie tot; responsabilul 1 (regula A) și 2 (numit de owner) văd și scriu DOAR punctele licitației lor;
//    editorul / adminul Ofertare fără rol, autonumitul, responsabilul fără modul, sub-modulul, alt modul, fără modul: 0 rânduri, INSERT 42501, UPDATE /
//    DELETE 0 rânduri; RPC-ul fn_ofertare_clar_puncte_poarta dă aceleași răspunsuri; anon nimic; triggerul de semnare neschimbat; garda părintelui:
//    o clarificare CU puncte nu se mută (nimeni dintre clienți) și se șterge doar de cine trece poarta; cele fără puncte ca azi; un punct nu se mută pe o
//    clarificare fără poartă (WITH CHECK).
// 2. Livrarea L15 v2: manifestul generat (ROLLBACK) = lista revizuită; GLOBAL greșit / manifest incomplet = refuzul RUNNERULUI; livrarea aprobată + garda
//    finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic; fără migrare pică. 2b. ambele ordini față de 20270113a (APLICATĂ pe producție).
// 3. Refuzurile migrării (nimic schimbat). 4. Revenirea: ciclu + refuzuri după derivă (politică, funcție, drepturi, trigger, obiect dependent, apelant
//    textual). 5. MUTANȚI: comportamentali, structurali, pe gărzile de stare ale migrării și pe revenire.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'cp_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20270114a_ofertare_clarificari_puncte_citire', NUME_REV = NUME + '_ROLLBACK'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`, F_SCHELET_P = `supabase/tests/${NUME}_schelet.sql`
const F_SCHELET = 'supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql'
const NUME_0113 = '20270113a_ofertare_clarificari_citire', F_MIG_0113 = `supabase/migrations/${NUME_0113}.sql`
const MIG = citeste(F_MIG), REV = citeste(F_REV), DRY = citeste(F_DRY), SCHELET = citeste(F_SCHELET), SCHELET_P = citeste(F_SCHELET_P), MIG_0113 = citeste(F_MIG_0113)

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
  OWNER: '00000000-0000-4000-8000-0000000000f1', OF: '00000000-0000-4000-8000-0000000000f2', ADM: '00000000-0000-4000-8000-0000000000f3',
  RESP: '00000000-0000-4000-8000-0000000000f4', RESP2: '00000000-0000-4000-8000-0000000000f5', AUTO: '00000000-0000-4000-8000-0000000000f6',
  RFM: '00000000-0000-4000-8000-0000000000f7', SUB: '00000000-0000-4000-8000-0000000000f8', STRAIN: '00000000-0000-4000-8000-0000000000f9',
  NOMOD: '00000000-0000-4000-8000-0000000000fa',
}
const LIC = 900101, LIC2 = 900102, LIC3 = 900103
const C1 = 9001, C2 = 9002, C3 = 9003, C4 = 9004, C5 = 9005   // C1, C4 pe LIC (RESP + RESP2); C2 pe LIC2 (RFM, fără modul); C3 pe LIC3 (AUTO); C5 pe LIC, FĂRĂ puncte
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  await db.exec(SCHELET_P)
  const toti = Object.values(U)
  await db.exec(`
INSERT INTO auth.users (id) VALUES ${toti.map(u => `('${u}')`).join(', ')};
INSERT INTO public.profiles (id, name, is_owner) VALUES ${toti.map(u => `('${u}', '${Object.keys(U).find(k => U[k] === u)}', ${u === U.OWNER})`).join(', ')};
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.OF}', 'ofertare', 'editor'), ('${U.ADM}', 'ofertare', 'admin'),
  ('${U.RESP}', 'ofertare', 'editor'), ('${U.RESP2}', 'ofertare', 'editor'), ('${U.AUTO}', 'ofertare', 'editor'),
  ('${U.SUB}', 'ofertare_cantitati', 'editor'), ('${U.STRAIN}', 'logistica', 'admin');
-- LIC: responsabil 1 = RESP (numire veche, regula A: fără „numit de”, fără dovadă), responsabil 2 = RESP2 numit de owner (dovada 2A);
-- LIC2: RFM numit de owner, dar FĂRĂ modulul Ofertare; LIC3: AUTO numit de el însuși (dovada false)
INSERT INTO public.ofertare_licitatii (id, nr_anunt, autoritate, obiect, stare_loturi, responsabil_id, responsabil_setat_de, responsabil_numitor_autorizat,
                                       responsabil2_id, responsabil2_setat_de, responsabil2_numitor_autorizat) VALUES
  (${LIC}, 'T-1', 'AUTORITATE TEST', 'licitatie de test', 'fara_loturi', '${U.RESP}', NULL, NULL, '${U.RESP2}', '${U.OWNER}', true),
  (${LIC2}, 'T-2', 'AUTORITATE TEST', 'licitatie fara modul', 'fara_loturi', '${U.RFM}', '${U.OWNER}', true, NULL, NULL, NULL),
  (${LIC3}, 'T-3', 'AUTORITATE TEST', 'licitatie autonumit', 'fara_loturi', '${U.AUTO}', '${U.AUTO}', false, NULL, NULL, NULL);
INSERT INTO public.ofertare_clarificari (id, licitatie_id, nr, intrebare, status) VALUES (${C1}, ${LIC}, 1, 'intrebare unu', 'propunere'),
  (${C2}, ${LIC2}, 1, 'intrebare L2', 'propunere'), (${C3}, ${LIC3}, 1, 'intrebare L3', 'propunere'), (${C4}, ${LIC}, 2, 'intrebare doi', 'propunere'),
  (${C5}, ${LIC}, 3, 'intrebare fara puncte', 'propunere');
INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 1, 'punct 1'), (${C1}, 2, 'punct 2'), (${C2}, 1, 'punct L2'),
  (${C3}, 1, 'punct L3'), (${C4}, 1, 'punct C4');`)
  return db
}

// Livrarea migrării ca runnerul (tiparul 20270111a / 20270112a / 20270113a): plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, pasul „înainte” REAL
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
const livreaza0113 = db => livreaza(db, MIG_0113, { nume: NUME_0113 })

// starea obiectelor (pentru „nimic schimbat” / „starea veche”): politicile deparsate, drepturile, triggerele (ambele tabele), funcțiile, RLS, rândurile
const T = 'public.ofertare_clarificari_puncte', TP = 'public.ofertare_clarificari'
const POLITICI_SQL = `SELECT string_agg(p.polname::text || '=' || p.polcmd::text || '|' || p.polpermissive::text || '|' || coalesce((SELECT string_agg(ro::regrole::text, ',' ORDER BY ro::regrole::text) FROM unnest(p.polroles) ro), '')
    || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '; ' ORDER BY p.polname::text)
  FROM pg_policy p WHERE p.polrelid = '${T}'::regclass`
const FN = f => `coalesce((SELECT md5(replace(prosrc, chr(13), '')) || '|' || coalesce(proacl::text, '-') || '|' || prosecdef::text || '|' || provolatile::text || '|' || coalesce(array_to_string(proconfig, ';'), '-') FROM pg_proc WHERE oid = to_regprocedure('${f}')), 'LIPSA')`
const TRG = t => `coalesce((SELECT string_agg(tgname::text || ':' || tgenabled::text || ':' || tgtype::text || ':' || tgattr::text || ':' || (tgqual IS NULL)::text || ':' || tgnargs::text || ':' || tgfoid::regprocedure::text, ',' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = '${t}'::regclass AND NOT tgisinternal), '-')`
const stare = async db => (await db.query(`SELECT (${POLITICI_SQL}) AS politici,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${T}'::regclass) AS acl_tabel,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${TP}'::regclass) AS acl_parinte,
    ${TRG(T)} AS triggere, ${TRG(TP)} AS triggere_parinte,
    ${FN('public.fn_ofertare_clar_puncte_poarta(bigint)')} AS functie_noua,
    ${FN('public.fn_ofertare_clar_are_puncte(bigint)')} AS functie_are,
    ${FN('public.fn_ofertare_clar_parinte_puncte_garda()')} AS functie_garda,
    ${FN('public.fn_are_acces_ofertare()')} AS functie_acces,
    ${FN('public.fn_ofertare_poate_cheltui(bigint, uuid)')} AS functie_cheltuiala,
    ${FN('public.fn_clar_punct_semneaza()')} AS functie_trigger,
    (SELECT string_agg(polname::text, ',' ORDER BY polname::text) FROM pg_policy WHERE polrelid = '${TP}'::regclass) AS politici_parinte,
    (SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = '${T}'::regclass) AS rls,
    (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS puncte`)).rows[0]
const SUBQ = '( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)', POARTA = 'fn_ofertare_clar_puncte_poarta(clarificare_id)'
const POLITICI_VECHI = `clar_puncte_rw=*|true|authenticated|${SUBQ}|${SUBQ}; clar_puncte_sel=r|true|authenticated|(auth.uid() IS NOT NULL)|-`
const POLITICI_NOI = `clar_puncte_rw=*|true|authenticated|${POARTA}|${POARTA}; clar_puncte_sel=r|true|authenticated|${POARTA}|-`
const TRG_NOU = 'trg_ofertare_clar_parinte_puncte:O:27:2:true:0:fn_ofertare_clar_parinte_puncte_garda()'   // tgattr = attnum(licitatie_id) = 2 în schelet (id, licitatie_id, …)
let STARE_VECHE = null
const neschimbate = s => s.acl_tabel === STARE_VECHE.acl_tabel && s.acl_parinte === STARE_VECHE.acl_parinte && s.triggere === STARE_VECHE.triggere && s.functie_acces === STARE_VECHE.functie_acces
  && s.functie_cheltuiala === STARE_VECHE.functie_cheltuiala && s.functie_trigger === STARE_VECHE.functie_trigger && s.rls === STARE_VECHE.rls && s.politici_parinte === STARE_VECHE.politici_parinte
const eVeche = s => s.politici === POLITICI_VECHI && s.functie_noua === 'LIPSA' && s.functie_are === 'LIPSA' && s.functie_garda === 'LIPSA' && s.triggere_parinte === STARE_VECHE.triggere_parinte && neschimbate(s)
const corp = (t, sig) => { const i = t.indexOf(sig); if (i < 0) throw new Error('lipsă ' + sig); const a = t.indexOf('AS $fn$', i) + 7; return t.slice(a, t.indexOf('$fn$;', a)) }
const SIG_ARE = 'CREATE FUNCTION public.fn_ofertare_clar_are_puncte(p_clarificare_id bigint)', SIG_POARTA = 'CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint)', SIG_GARDA = 'CREATE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()'
const MD5_NOU = md5(corp(MIG, SIG_POARTA)), MD5_ARE = md5(corp(MIG, SIG_ARE)), MD5_GARDA = md5(corp(MIG, SIG_GARDA))
const fnDefiner = (s, m) => s.startsWith(m + '|') && /\|true\|s\|search_path=public, pg_temp$/.test(s) && /authenticated=X\/postgres/.test(s) && /service_role=X\/postgres/.test(s) && !/(^|[{,])=X/.test(s) && !/anon=/.test(s)
const eNoua = s => s.politici === POLITICI_NOI && fnDefiner(s.functie_noua, MD5_NOU) && fnDefiner(s.functie_are, MD5_ARE)
  && s.functie_garda.startsWith(MD5_GARDA + '|{postgres=X/postgres}|false|v|search_path=public, pg_temp')
  && s.triggere_parinte.split(',').includes(TRG_NOU) && s.triggere_parinte.split(',').filter(x => x !== TRG_NOU).join(',') === STARE_VECHE.triggere_parinte && neschimbate(s)

// ── rularea ca un cont (ROLLBACK la final): JWT-ul ca PostgREST, AMBELE surse ──
const jwt = (uid, rol) => uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true); SELECT set_config('request.jwt.claims', '{"sub": "${uid}", "role": "${rol}"}', true);`
  : `SELECT set_config('request.jwt.claim.sub', '', true); SELECT set_config('request.jwt.claims', '{"role": "${rol}"}', true);`
async function ca(db, cont, sql, params = [], { rol = 'authenticated', apoi = null } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${jwt(uid, rol)}`)
  try {
    const id = (await db.query(`SELECT current_user AS u, auth.uid()::text AS uid, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`)).rows[0]
    if (id.u !== rol || (uid ? id.uid !== uid : id.uid !== null) || id.bypass !== (rol === 'service_role')) throw new Error('identitate greșită: ' + JSON.stringify(id))
    const r = await db.query(sql, params)
    const r2 = apoi ? (await db.query(apoi)).rows : null   // o a doua citire, în aceeași tranzacție, ca același cont (vede ce a scris prima)
    await db.exec('ROLLBACK'); return { rows: r.rows, afectate: r.affectedRows ?? null, apoi: r2 }
  } catch (e) { await db.exec('ROLLBACK'); return { code: e.code ?? 'JS', message: e.message } }
}
// aceeași operație ca service_role (BYPASSRLS; triggerul părintelui trebuie să NU intervină)
const caService = (db, sql, apoi = null) => ca(db, null, sql, [], { rol: 'service_role', apoi })

// ── așteptările (scrise de mână din decizie: 5 puncte în total, 2 pe C1; LIC are 3 puncte = C1 + C4) ──
// [total vizibil, pe C1, poarta(C1), poarta(C2), poarta(inexistentă)]
const ASTEPTAT_DUPA = {
  OWNER: [5, 2, true, true, false], RESP: [3, 2, true, false, false], RESP2: [3, 2, true, false, false],
  OF: [0, 0, false, false, false], ADM: [0, 0, false, false, false], AUTO: [0, 0, false, false, false], RFM: [0, 0, false, false, false],
  SUB: [0, 0, false, false, false], STRAIN: [0, 0, false, false, false], NOMOD: [0, 0, false, false, false],
}
async function numara(db, cont) {
  const r = await ca(db, cont, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS tot, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS c1,
    public.fn_ofertare_clar_puncte_poarta(${C1}) AS p1, public.fn_ofertare_clar_puncte_poarta(${C2}) AS p2, public.fn_ofertare_clar_puncte_poarta(999999999) AS p0`)
  return r.code ? r : [r.rows[0].tot, r.rows[0].c1, r.rows[0].p1, r.rows[0].p2, r.rows[0].p0]
}
const numaraVechi = async (db, cont) => {
  const r = await ca(db, cont, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS tot, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS c1`)
  return r.code ? r : [r.rows[0].tot, r.rows[0].c1]
}
const INTACT = `SELECT (SELECT licitatie_id FROM public.ofertare_clarificari WHERE id = ${C1})::int AS lic, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS n`
// verificările comportamentului DUPĂ migrare: lista abaterilor (goală = bine)
async function verifica(db) {
  const ab = []
  for (const [cont, astept] of Object.entries(ASTEPTAT_DUPA)) {
    const n = await numara(db, cont)
    if (n.code) ab.push(`${cont}: eroare ${n.code} ${n.message}`)
    else if (JSON.stringify(n) !== JSON.stringify(astept)) ab.push(`${cont}: [total, C1, poarta C1, poarta C2, poarta inexistentă] = ${JSON.stringify(n)}, aștepta ${JSON.stringify(astept)}`)
  }
  // anon: nimic (0 rânduri sau fără drept); funcția nu poate fi chemată
  const an = await ca(db, null, `SELECT count(*)::int AS tot FROM public.ofertare_clarificari_puncte`, [], { rol: 'anon' })
  if (!(an.code === '42501' || (an.rows && an.rows[0].tot === 0))) ab.push('anon citire: ' + JSON.stringify(an))
  const anf = await ca(db, null, `SELECT public.fn_ofertare_clar_puncte_poarta(${C1})`, [], { rol: 'anon' })
  if (anf.code !== '42501') ab.push('anon functie: ' + JSON.stringify(anf))
  // scrierile: responsabilul scrie pe licitația lui și vede ce a scris; pe altă licitație = 42501; rezoluția e semnată de el (triggerul neschimbat)
  const w1 = await ca(db, 'RESP', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 7, 'scris de RESP')`,
    [], { apoi: `SELECT count(*)::int AS n FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}` })
  if (w1.code || w1.afectate !== 1 || w1.apoi[0].n !== 3) ab.push('RESP scrie C1: ' + JSON.stringify(w1))
  const w2 = await ca(db, 'RESP', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C2}, 7, 'scris de RESP pe alta licitatie')`)
  if (w2.code !== '42501') ab.push('RESP scrie C2: ' + JSON.stringify(w2))
  const w3 = await ca(db, 'RESP', `UPDATE public.ofertare_clarificari_puncte SET rezolutie = 'rezolvat' WHERE clarificare_id = ${C1} AND nr = 1`,
    [], { apoi: `SELECT rezolvat_de::text AS de, (rezolvat_la IS NOT NULL) AS la FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1} AND nr = 1` })
  if (w3.code || w3.afectate !== 1 || w3.apoi[0].de !== U.RESP || w3.apoi[0].la !== true) ab.push('RESP rezolutie: ' + JSON.stringify(w3))
  const w4 = await ca(db, 'RESP2', `DELETE FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C4}`)
  if (w4.code || w4.afectate !== 1) ab.push('RESP2 sterge C4: ' + JSON.stringify(w4))
  // un punct nu se mută pe o clarificare fără poartă (WITH CHECK pe noul părinte)
  const w6 = await ca(db, 'RESP', `UPDATE public.ofertare_clarificari_puncte SET clarificare_id = ${C2} WHERE clarificare_id = ${C1} AND nr = 1`)
  if (w6.code !== '42501') ab.push('RESP muta punct pe C2: ' + JSON.stringify(w6))
  // editorul / adminul Ofertare fără rol și autonumitul: INSERT 42501, UPDATE / DELETE 0 rânduri
  for (const c of ['OF', 'ADM', 'AUTO']) {
    const i = await ca(db, c, `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${c === 'AUTO' ? C3 : C1}, 8, 'scris de ${c}')`)
    if (i.code !== '42501') ab.push(`${c} scrie: ` + JSON.stringify(i))
    const u = await ca(db, c, `UPDATE public.ofertare_clarificari_puncte SET text = text || '!'`)
    if (u.code || u.afectate !== 0) ab.push(`${c} UPDATE: ` + JSON.stringify(u))
    const d = await ca(db, c, `DELETE FROM public.ofertare_clarificari_puncte`)
    if (d.code || d.afectate !== 0) ab.push(`${c} DELETE: ` + JSON.stringify(d))
  }
  // ownerul scrie oriunde
  const w5 = await ca(db, 'OWNER', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C3}, 2, 'scris de owner pe L3')`)
  if (w5.code || w5.afectate !== 1) ab.push('OWNER scrie C3: ' + JSON.stringify(w5))
  // garda părintelui (review r1 P1 #1 / #2): editorul fără poartă nu mută / nu șterge C1 (are puncte) — C1 și punctele rămân; cele fără puncte ca azi
  const p1 = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C1}`, [], { apoi: INTACT })
  if (p1.code !== '42501') ab.push('OF muta C1: ' + JSON.stringify(p1))
  const p2 = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`)
  if (p2.code !== '42501') ab.push('OF sterge C1: ' + JSON.stringify(p2))
  const p3 = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C5}`, [], { apoi: `SELECT licitatie_id::int AS lic FROM public.ofertare_clarificari WHERE id = ${C5}` })
  if (p3.code || p3.afectate !== 1 || p3.apoi[0].lic !== LIC2) ab.push('OF muta C5 (fara puncte): ' + JSON.stringify(p3))
  const p4 = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C5}`)
  if (p4.code || p4.afectate !== 1) ab.push('OF sterge C5 (fara puncte): ' + JSON.stringify(p4))
  // responsabilul: nu mută C1 (mutarea unei clarificări cu puncte nu e flux de client), dar o șterge (cascada = punctele licitației lui); AUTO nu șterge C3
  const p5 = await ca(db, 'RESP', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C1}`)
  if (p5.code !== '42501') ab.push('RESP muta C1: ' + JSON.stringify(p5))
  const p6 = await ca(db, 'RESP', `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`, [], { apoi: `SELECT count(*)::int AS n FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}` })
  if (p6.code || p6.afectate !== 1 || p6.apoi[0].n !== 0) ab.push('RESP sterge C1: ' + JSON.stringify(p6))
  const p7 = await ca(db, 'AUTO', `DELETE FROM public.ofertare_clarificari WHERE id = ${C3}`)
  if (p7.code !== '42501') ab.push('AUTO sterge C3: ' + JSON.stringify(p7))
  // service_role (serverul): garda nu intervine — mută și șterge (porțile lui sunt în edge / RPC)
  const s1 = await caService(db, `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2} WHERE id = ${C1}`, INTACT)
  if (s1.code || s1.afectate !== 1 || s1.apoi[0].lic !== LIC2) ab.push('service muta C1: ' + JSON.stringify(s1))
  const s2 = await caService(db, `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`)
  if (s2.code || s2.afectate !== 1) ab.push('service sterge C1: ' + JSON.stringify(s2))
  // după toate (fiecare în ROLLBACK): C1 e pe LIC cu 2 puncte
  const i0 = (await db.query(INTACT)).rows[0]
  if (i0.lic !== LIC || i0.n !== 2) ab.push('starea finală C1: ' + JSON.stringify(i0))
  return ab
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('0. validatorul runnerului, forma fișierelor, inventarul instrucțiunilor, amprentele, blocurile POLITICI / FUNCTII')
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
  for (const f of [F_MIG, F_REV, F_DRY, F_SCHELET_P]) {
    const brut = readFileSync(join(ROOT, f), 'utf8')
    ok(!/^﻿/.test(brut) && !/\r/.test(brut), `${f}: fără BOM, LF`)
  }
  ok(/^-- Version 20270114120000\. NEAPLICAT\./.test(MIG) && REV.includes('--versiune 20270114120001'), 'versiunile: migrarea 20270114120000, revenirea 20270114120001')
  const L = `LOCK TABLE ${T} IN ACCESS EXCLUSIVE MODE NOWAIT;`, LP = `LOCK TABLE ${TP} IN SHARE ROW EXCLUSIVE MODE NOWAIT;`
  const faraComentarii = t => t.replace(/--[^\n]*/g, '')
  const MIGc = faraComentarii(MIG), REVc = faraComentarii(REV)
  ok(MIGc.split(L).length === 2 && MIGc.split(LP).length === 2 && MIGc.indexOf(L) < MIGc.indexOf(LP) && MIGc.indexOf('DO $lock$') > MIGc.indexOf('END $pre$;') && MIGc.indexOf('END $lock$;') < MIGc.indexOf('DO $stare$')
    && MIGc.indexOf('DO $stare$') < MIGc.indexOf('\nCREATE FUNCTION public.fn_ofertare_clar_are_puncte') && MIGc.indexOf('\nALTER POLICY clar_puncte_rw') < MIGc.indexOf('DO $post$')
    && REVc.split(L).length === 2 && REVc.split(LP).length === 2 && REVc.indexOf(L) < REVc.indexOf(LP) && REVc.indexOf(LP) < REVc.indexOf('DO $stare$')
    && REVc.indexOf('DO $stare$') < REVc.indexOf('\nALTER POLICY clar_puncte_sel') && REVc.indexOf('\nALTER POLICY clar_puncte_rw') < REVc.indexOf('\nDROP TRIGGER')
    && REVc.indexOf('\nDROP TRIGGER') < REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_parinte_puncte_garda') && REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_puncte_poarta') < REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_are_puncte') && REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_are_puncte') < REVc.indexOf('DO $post$'),
  'lock-urile (puncte ACCESS EXCLUSIVE, apoi părintele SHARE ROW EXCLUSIVE, NOWAIT) vin ÎNAINTEA verificărilor de stare, schimbările după ele și înaintea postcondițiilor; în revenire politicile → trigger → funcții în ordinea dependențelor (L14)')
  const nr = (t, re) => (t.match(re) || []).length
  ok(nr(MIGc, /\nCREATE FUNCTION /g) === 3 && nr(MIGc, /\nREVOKE /g) === 3 && nr(MIGc, /\nGRANT /g) === 2 && nr(MIGc, /\nCOMMENT ON FUNCTION /g) === 3 && nr(MIGc, /\nCREATE TRIGGER /g) === 1 && nr(MIGc, /\nALTER POLICY /g) === 2
    && !/\n(DROP |ALTER TABLE|ALTER VIEW|ALTER FUNCTION|INSERT |UPDATE |DELETE |TRUNCATE |CREATE POLICY|CREATE TABLE(?! cp_foto)|CREATE OR REPLACE)/.test(MIGc.replace(/CREATE TEMP TABLE cp_foto ON COMMIT DROP/g, '')),
  'migrarea schimbă EXACT: 3 CREATE FUNCTION + 3 REVOKE + 2 GRANT + 3 COMMENT + 1 CREATE TRIGGER + 2 ALTER POLICY (nimic șters, niciun tabel / drept pe tabel atins)')
  ok(nr(REVc, /\nALTER POLICY /g) === 2 && nr(REVc, /\nDROP TRIGGER /g) === 1 && nr(REVc, /\nDROP FUNCTION /g) === 3 && !/CASCADE/.test(REVc)
    && !/\n(CREATE FUNCTION|ALTER TABLE|GRANT |REVOKE |INSERT |UPDATE |DELETE |TRUNCATE |CREATE POLICY)/.test(REVc.replace(/CREATE TEMP TABLE cp_foto ON COMMIT DROP/g, '')),
  'revenirea schimbă EXACT: 2 ALTER POLICY + 1 DROP TRIGGER + 3 DROP FUNCTION (fără CASCADE), nimic altceva')
  // amprentele dependențelor: md5 din migrare și revenire = corpurile din 20260912 / 20261124a = scheletul
  const corpAcces = t => { const i = t.indexOf('FUNCTION public.fn_are_acces_ofertare()'); const a = t.indexOf('AS $fn$', i) + 7; return t.slice(a, t.indexOf('$fn$;', a)) }
  const corpChelt = t => { const i = t.indexOf('CREATE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid)'); const a = t.indexOf('AS $function$', i) + 13; return t.slice(a, t.indexOf('$function$;', a)) }
  const mA = md5(corpAcces(citeste('supabase/migrations/20260912_ofertare_acces_fara_parametru.sql'))), mC = md5(corpChelt(citeste('supabase/migrations/20261124a_ofertare_poarta_cheltuiala.sql')))
  ok(mA === md5(corpAcces(SCHELET)) && MIGc.split(mA).length === 3 && REVc.split(mA).length === 3, `amprenta fn_are_acces_ofertare (${mA}) = 20260912 = scheletul; în migrare și revenire (condiție + mesaj)`)
  ok(mC === md5(corpChelt(SCHELET)) && MIGc.split(mC).length === 3 && REVc.split(mC).length === 3, `amprenta fn_ofertare_poate_cheltui (${mC}) = 20261124a = scheletul; în migrare și revenire (condiție + mesaj)`)
  for (const [nume, m] of [['poarta', MD5_NOU], ['are_puncte', MD5_ARE], ['garda', MD5_GARDA]]) {
    ok(/^[0-9a-f]{32}$/.test(m) && MIGc.split(m).length === 3 && REVc.split(m).length === 3, `amprenta funcției noi ${nume} (${m}) = corpul din migrare; în postcondiția migrării și în starea cerută de revenire (condiție + mesaj)`)
  }
  ok(!/MD5_(POARTA_PUNCTE|ARE_PUNCTE|GARDA)/.test(MIG + REV), 'fără marcaje de md5 rămase')
  const CP = corp(MIG, SIG_POARTA), CG = corp(MIG, SIG_GARDA)
  ok(/auth\.uid\(\)/.test(CP) && !/p_uid/.test(CP) && /public\.fn_are_acces_ofertare\(\)/.test(CP) && /public\.fn_ofertare_poate_cheltui\(c\.licitatie_id, auth\.uid\(\)\)/.test(CP),
    'corpul porții: identitatea DOAR din auth.uid() (fără parametru de utilizator, L08), modulul + poarta pe licitația clarificării, nume calificate')
  ok(/current_user NOT IN \('authenticated', 'anon'\)/.test(CG) && /public\.fn_ofertare_clar_are_puncte\(OLD\.id\)/.test(CG) && /public\.fn_ofertare_clar_puncte_poarta\(OLD\.id\)/.test(CG) && !/auth\.uid|request\.jwt|set_config/.test(CG)
    && /SECURITY INVOKER|\nSET search_path = public, pg_temp\nAS \$fn\$\nBEGIN/.test(MIG.slice(MIG.indexOf(SIG_GARDA), MIG.indexOf('$fn$;', MIG.indexOf(SIG_GARDA)))) && !/SECURITY DEFINER/.test(MIG.slice(MIG.indexOf(SIG_GARDA), MIG.indexOf('$fn$;', MIG.indexOf(SIG_GARDA)))),
    'corpul gărzii: INVOKER (fără SECURITY DEFINER), apelantul deosebit prin current_user, existența punctelor și poarta prin funcțiile DEFINER pe OLD.id, fără identitate din GUC')
  // scheletul punctelor = textul 20260928l (tabel, politici, trigger) + REVOKE TRUNCATE (20260930i)
  const t0928 = citeste('supabase/migrations/20260928l_ofertare_clarificari_puncte_r05.sql')
  const corpTbl = t => t.slice(t.indexOf('CREATE TABLE public.ofertare_clarificari_puncte ('), t.indexOf('FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza();') + 'FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza();'.length)
  ok(corpTbl(SCHELET_P) === corpTbl(t0928) && /REVOKE TRUNCATE ON public\.ofertare_clarificari_puncte FROM anon, authenticated;/.test(SCHELET_P), 'scheletul punctelor = textul EXACT din 20260928l + REVOKE TRUNCATE (20260930i)')
  // blocurile POLITICI / FUNCTII: identice între migrare și revenire (încrucișat / același text)
  const bloc = (t, et) => t.slice(t.indexOf(`-- >>> ${et}`), t.indexOf(`-- <<< ${et}`))
  // condițiile (IF … THEN), fără liniile RAISE EXCEPTION (mesajele diferă prin prefix)
  const blocFn = t => bloc(t, 'FUNCTII 20270114a').split('\n').filter(l => !/RAISE EXCEPTION/.test(l)).join('\n')
  ok(bloc(MIG, 'POLITICI PUNCTE 27.11.2026') === bloc(REV, 'POLITICI PUNCTE 27.11.2026') && bloc(MIG, 'POLITICI PUNCTE 20270114a') === bloc(REV, 'POLITICI PUNCTE 20270114a')
    && bloc(MIG, 'POLITICI PUNCTE 27.11.2026').includes(`'clar_puncte_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'`) && bloc(MIG, 'POLITICI PUNCTE 20270114a').includes(`'clar_puncte_rw', '*|permisiva|{authenticated}|${POARTA}|${POARTA}'`)
    && MIG.indexOf('-- >>> POLITICI PUNCTE 27.11.2026') < MIG.indexOf('-- >>> POLITICI PUNCTE 20270114a') && REV.indexOf('-- >>> POLITICI PUNCTE 20270114a') < REV.indexOf('-- >>> POLITICI PUNCTE 27.11.2026'),
  'blocurile POLITICI (azi / 20270114a) sunt identice în migrare și revenire și apar în ordinea bună')
  ok(blocFn(MIG).length > 1000 && blocFn(MIG) === blocFn(REV), 'blocul FUNCTII 20270114a (cele 3 funcții: md5, formă, drepturi) e identic în migrare și revenire (în afara prefixelor mesajelor)')
}

console.log('1. comportamentul: înainte orice cont logat vede și oricine cu Ofertare scrie / mută / șterge; după, doar owner / responsabilii licitației')
{
  const db = await bazaNoua()
  STARE_VECHE = await stare(db)
  ok(eVeche(STARE_VECHE) && STARE_VECHE.puncte === 5, 'scheletul: politicile de azi, funcțiile noi lipsă, triggerul părintelui lipsă, 5 puncte: ' + STARE_VECHE.politici.slice(0, 120))
  const inainte = {}
  for (const c of Object.keys(ASTEPTAT_DUPA)) inainte[c] = await numaraVechi(db, c)
  ok(Object.values(inainte).every(n => JSON.stringify(n) === '[5,2]'), 'ÎNAINTE: orice cont logat vede toate punctele (5 / 2), inclusiv OF, ADM, AUTO, RFM, SUB, STRAIN, NOMOD: ' + JSON.stringify(inainte.NOMOD))
  const wOf = await ca(db, 'OF', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 7, 'scris de OF inainte')`)
  const wStrain = await ca(db, 'STRAIN', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 7, 'scris de STRAIN inainte')`)
  const mOf = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C1}`)
  const dOf = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`)
  ok(!wOf.code && wOf.afectate === 1 && wStrain.code === '42501' && !mOf.code && mOf.afectate === 1 && !dOf.code && dOf.afectate === 1,
    'ÎNAINTE: editorul Ofertare fără rol scrie puncte, mută și șterge clarificarea cu puncte (ușile din review-ul r1); alt modul = 42501')
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270114a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n))
    && a.note.some(n => /^20270114a: stare verificata \(2 politici pe puncte, RLS activ, parintele fotografiat\)$/.test(n)),
  'migrarea se aplică (pasul „înainte” real; lock din prima; fără numărători sub lock)' + (a.ok ? '' : ': ' + a.eroare))
  const s1 = await stare(db)
  ok(eNoua(s1) && s1.puncte === 5, 'DUPĂ: cele 2 politici pe poartă, cele 3 funcții (corp, DEFINER / INVOKER, STABLE / VOLATILE, cale, drepturi exacte), triggerul părintelui exact, restul identic: ' + s1.triggere_parinte)
  const ab = await verifica(db)
  ok(ab.length === 0, `DUPĂ: owner 5 / responsabilii 3 pe licitația lor / restul 0; RPC-ul la fel; scrierile doar pentru owner / responsabili; garda părintelui; service_role liber; anon nimic (${ab.length} abateri${ab.length ? ': ' + ab.join(' | ') : ''})`)
  ok(!a.note.some(n => /vederi peste ofertare_clarificari_puncte fara security_invoker/.test(n)), 'pe schelet nicio vedere fără security_invoker peste tabel (NOTICE-ul informativ nu apare)')
  await db.close()
}

console.log('2. livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
// L25: lista așteptată scrisă aici, independent de fișier și de generator: 3 funcții create, triggerul creat (pe părinte), 2 politici schimbate
const ASTEPTATE = [
  'functie\tfunctie public.fn_ofertare_clar_are_puncte(bigint)\tcreat',
  'functie\tfunctie public.fn_ofertare_clar_parinte_puncte_garda()\tcreat',
  'functie\tfunctie public.fn_ofertare_clar_puncte_poarta(bigint)\tcreat',
  'politica\tpolitica public.ofertare_clarificari_puncte.clar_puncte_rw\tschimbat',
  'politica\tpolitica public.ofertare_clarificari_puncte.clar_puncte_sel\tschimbat',
  'trigger\ttrigger public.ofertare_clarificari.trg_ofertare_clar_parinte_puncte\tcreat',
]
async function dryRun(db, eticheta) {
  const nr = async () => (await db.query(`SELECT (SELECT count(*) FROM public.ofertare_licitatii)::int AS l, (SELECT count(*) FROM public.profiles)::int AS u,
    (SELECT count(*) FROM public.user_module_access)::int AS m, (SELECT count(*) FROM public.ofertare_clarificari)::int AS c, (SELECT count(*) FROM public.ofertare_clarificari_puncte)::int AS p`)).rows[0]
  const nr0 = await nr(); const s0 = await stare(db)
  const note = []; let eroare = null
  try { await db.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e.message; try { await db.exec('ROLLBACK') } catch { /* închisă */ } }
  const asteptate = ['t_politica OK', 't_fara_drept OK', 't_cu_drept OK', 't_parinte OK', 't_anon OK', 'TOTUL OK']
  ok(!eroare && asteptate.every(t => note.some(n => n.startsWith('DRY 20270114a ' + t))) && note.some(n => /^DRY 20270114a t_cu_drept OK \(total puncte ca postgres: 11\)$/.test(n)),
    `${eticheta}dry-run: ${asteptate.length} blocuri OK; totalul din NOTICE (5 ale scheletului + 4 fixturi + 2 scrise = 11)` + (eroare ? ': ' + eroare.slice(0, 300) : ''))
  ok(JSON.stringify(await nr()) === JSON.stringify(nr0) && JSON.stringify(await stare(db)) === JSON.stringify(s0), `${eticheta}dry-run: ROLLBACK, nimic rămas (licitații, conturi, drepturi, clarificări, puncte; starea obiectelor)`)
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
    `# 20270114a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}: ${fara18.join(' | ')}`)
  ok(JSON.stringify(revizuit) === JSON.stringify(ASTEPTATE), 'lista revizuită = EXACT cele 3 funcții create + triggerul creat + cele 2 politici schimbate, nimic altceva (niciun drept pe tabel)')
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
  const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fIncomplet), { recursive: true })
  writeFileSync(fIncomplet, manifest.split('\n').filter(l => !l.startsWith('trigger\t')).join('\n'))
  const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && /NEDECLARAT/.test(gi.eroare + gi.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul triggerului = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat')
  const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.ok && j.note.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m))
    && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.note.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
  'livrarea aprobată: diferențele = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat' + (j.ok ? '' : ': ' + j.eroare))
  ok(eNoua(await stare(b)) && (await verifica(b)).length === 0, 'după livrarea aprobată: politicile noi, comportamentul așteptat')
  await dryRun(b, '')
  const fara = await bazaNoua()
  let ef = null
  try { await fara.exec(DRY) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
  ok(/t_politica FAIL: migrarea 20270114a nu e aplicata/.test(ef || ''), 'dry-run pe baza fără 20270114a = eșec (t_politica): ' + (ef || 'TRECE').slice(0, 100))
  await fara.close(); await b.close()
}
console.log('2b. ambele ordini față de 20270113a (APLICATĂ pe producție 27.11.2026): 0113 → 0114 și 0114 → 0113')
{
  const a = await bazaNoua()
  const r1 = await livreaza0113(a); const r2 = await livreaza(a, MIG)
  ok(r1.ok && r2.ok && eNoua(await stare(a)), '0113 → 0114: ambele se aplică; politicile noi' + (r1.ok ? '' : ': 0113 ' + r1.eroare) + (r2.ok ? '' : ': 0114 ' + r2.eroare))
  const ab = await verifica(a)
  ok(ab.length === 0, `0113 → 0114: comportamentul așteptat și cu citirea clarificărilor restrânsă la modul (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
  await dryRun(a, '0113 → 0114: ')
  await a.close()
  const b = await bazaNoua()
  const r3 = await livreaza(b, MIG); const r4 = await livreaza0113(b)
  ok(r3.ok && r4.ok && eNoua(await stare(b)), '0114 → 0113: ambele se aplică; politicile noi rămân' + (r3.ok ? '' : ': 0114 ' + r3.eroare) + (r4.ok ? '' : ': 0113 ' + r4.eroare))
  const ab2 = await verifica(b)
  ok(ab2.length === 0, `0114 → 0113: comportamentul așteptat (${ab2.length} abateri${ab2.length ? ': ' + ab2[0] : ''})`)
  await b.close()
}

console.log('3. refuzurile migrării (pe bază nouă, nimic schimbat)')
const FN_ACCES_TRUE = `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const FN_CHELT_TRUE = `CREATE OR REPLACE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
for (const [eticheta, opt, motiv, pregatire] of [
  ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
  ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
  ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
  ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
  ['politica SELECT cu alt USING', {}, /politicile ofertare_clarificari_puncte difera de cele de azi .*clar_puncte_sel: r\|permisiva\|\{authenticated\}\|true\|-/, `ALTER POLICY clar_puncte_sel ON ${T} USING (true)`],
  ['politica SELECT lipsă', {}, /politicile ofertare_clarificari_puncte difera de cele de azi .*: clar_puncte_sel$/, `DROP POLICY clar_puncte_sel ON ${T}`],
  ['o politică în plus', {}, /politicile ofertare_clarificari_puncte difera de cele de azi .*\+zz_sel: r\|permisiva\|\{anon\}\|true\|-/, `CREATE POLICY zz_sel ON ${T} FOR SELECT TO anon USING (true)`],
  ['politica ALL cu alt WITH CHECK', {}, /difera de cele de azi .*clar_puncte_rw: \*\|permisiva\|\{authenticated\}\|.*\|true/, `ALTER POLICY clar_puncte_rw ON ${T} WITH CHECK (true)`],
  ['politica SELECT pentru PUBLIC', {}, /difera de cele de azi .*clar_puncte_sel: r\|permisiva\|\{PUBLIC\}/, `ALTER POLICY clar_puncte_sel ON ${T} TO PUBLIC`],
  ['fn_are_acces_ofertare cu alt corp', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, FN_ACCES_TRUE],
  ['fn_are_acces_ofertare cu EXECUTE pentru anon', {}, /fn_are_acces_ofertare\(\) nu e cea din 20260912/, 'GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO anon'],
  ['fn_ofertare_poate_cheltui cu alt corp', {}, /fn_ofertare_poate_cheltui\(bigint, uuid\) nu e cea din 20261124a/, FN_CHELT_TRUE],
  ['fn_ofertare_poate_cheltui cu EXECUTE pentru authenticated (poarta ar fi apelabilă direct)', {}, /fn_ofertare_poate_cheltui\(bigint, uuid\) nu e cea din 20261124a/, 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO authenticated'],
  ['fn_ofertare_poate_cheltui SECURITY INVOKER', {}, /fn_ofertare_poate_cheltui\(bigint, uuid\) nu e cea din 20261124a/, 'ALTER FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) SECURITY INVOKER'],
  ['o funcție cu același nume (altă semnătură) există deja', {}, /exista deja \(reaplicare sau coliziune de nume\)/, 'CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$'],
  ['garda există deja (alt corp)', {}, /exista deja \(reaplicare sau coliziune de nume\)/, 'CREATE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$'],
  ['triggerul există deja (alt corp)', {}, /triggerul trg_ofertare_clar_parinte_puncte exista deja/, `CREATE TRIGGER trg_ofertare_clar_parinte_puncte BEFORE DELETE ON ${TP} FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza()`],
  ['FK-ul clarificare_id lipsă', {}, /lipseste FK-ul ofertare_clarificari_puncte\.clarificare_id/, `ALTER TABLE ${T} DROP CONSTRAINT ofertare_clarificari_puncte_clarificare_id_fkey`],
  ['RLS oprit', {}, /RLS pe ofertare_clarificari_puncte nu e activ/, `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`],
  ['RLS forțat', {}, /RLS pe ofertare_clarificari_puncte nu e activ \(sau e fortat\)/, `ALTER TABLE ${T} FORCE ROW LEVEL SECURITY`],
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
  ok(!r.ok && /exista deja \(reaplicare sau coliziune de nume\)/.test(r.eroare) && JSON.stringify(s) === JSON.stringify(await stare(b)), 'reaplicarea = refuz, nimic schimbat: ' + (r.eroare || '').slice(0, 100))
  await b.close()
}
{
  const b = await bazaNoua()
  await b.exec(`CREATE VIEW public.zz_puncte_definer AS SELECT id, clarificare_id FROM ${T}`)
  const r = await livreaza(b, MIG)
  ok(r.ok && r.note.some(n => /ATENTIE, vederi peste ofertare_clarificari_puncte fara security_invoker .*: zz_puncte_definer$/.test(n)),
    'o vedere fără security_invoker peste tabel e numită în NOTICE (informativ, nu refuz)' + (r.ok ? '' : ': ' + r.eroare))
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
  const dOf = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`)
  ok(v.ok && eVeche(s2) && JSON.stringify(await numaraVechi(db, 'NOMOD')) === '[5,2]' && !dOf.code && dOf.afectate === 1,
    'revenirea: politicile de azi EXACT, funcțiile și triggerul șterse, nimic altceva atins; orice cont logat vede iar, editorul șterge iar clarificarea cu puncte' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea din 20270114a \(politicile ofertare_clarificari_puncte\): clar_puncte_rw: .*; clar_puncte_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 160))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && eNoua(await stare(db)) && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
// deriva după livrare: revenirea refuză cu câmpul numit, nimic schimbat
const FN_NOU_TRUE = `CREATE OR REPLACE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
for (const [nume, pregatire, re] of [
  ['politica SELECT schimbată altfel', `ALTER POLICY clar_puncte_sel ON ${T} USING (true)`, /\(politicile ofertare_clarificari_puncte\): clar_puncte_sel: r\|permisiva\|\{authenticated\}\|true\|-/],
  ['o politică în plus (dependentă de funcție)', `CREATE POLICY zz_sel ON ${T} FOR SELECT TO anon USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id))`, /\(politicile ofertare_clarificari_puncte\): \+zz_sel/],
  ['funcția nouă cu alt corp', FN_NOU_TRUE, /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270114a/],
  ['funcția nouă cu EXECUTE pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO anon', /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270114a .*drepturi exacte/],
  ['funcția nouă fără EXECUTE pentru authenticated', 'REVOKE EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM authenticated', /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270114a .*drepturi exacte/],
  ['garda cu EXECUTE pentru authenticated', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() TO authenticated', /fn_ofertare_clar_parinte_puncte_garda\(\) nu e cea din 20270114a/],
  ['garda SECURITY DEFINER', 'ALTER FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() SECURITY DEFINER', /fn_ofertare_clar_parinte_puncte_garda\(\) nu e cea din 20270114a/],
  ['triggerul dezactivat', `ALTER TABLE ${TP} DISABLE TRIGGER trg_ofertare_clar_parinte_puncte`, /triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270114a/],
  ['triggerul lipsă', `DROP TRIGGER trg_ofertare_clar_parinte_puncte ON ${TP}`, /triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270114a/],
  ['alt obiect construit pe funcție (politică pe alt tabel)', `CREATE POLICY zz_alt ON ${TP} FOR SELECT TO authenticated USING (public.fn_ofertare_clar_puncte_poarta(id))`, /depind si alte obiecte \(nu doar cele 2 politici si triggerul\): pg_policy:\d+/],
  ['alt trigger pe garda', `CREATE TRIGGER zz_trg BEFORE DELETE ON ${T} FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()`, /depind si alte obiecte .*: pg_trigger:\d+/],
  ['un apelant cu corp text (nu e în pg_depend) care cheamă poarta', `CREATE FUNCTION public.zz_apelant(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_clar_puncte_poarta(p) $f$`, /alte functii numesc in corp functiile 20270114a .*: zz_apelant\(bigint\)/],
  ['un apelant plpgsql care cheamă are_puncte', `CREATE FUNCTION public.zz_apelant2() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.fn_ofertare_clar_are_puncte(1); END $f$`, /alte functii numesc in corp functiile 20270114a .*: zz_apelant2\(\)/],
  ['fn_are_acces_ofertare schimbată', FN_ACCES_TRUE, /fn_are_acces_ofertare\(\) nu e cea din 20260912/],
  ['fn_ofertare_poate_cheltui schimbată', FN_CHELT_TRUE, /fn_ofertare_poate_cheltui\(bigint, uuid\) nu e cea din 20261124a/],
  ['RLS oprit', `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`, /RLS pe ofertare_clarificari_puncte nu e activ/],
]) {
  const db = await bazaNoua()
  await livreaza(db, MIG)
  await db.exec(pregatire)
  const s = await stare(db)
  const v = await revino(db)
  ok(!v.ok && re.test(v.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `revenirea refuză (${nume}), nimic schimbat: ${(v.eroare || 'APLICAT').slice(0, 150)}`)
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
const ALTER_SEL = `ALTER POLICY clar_puncte_sel ON ${T} USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));`
const ALTER_RW = `ALTER POLICY clar_puncte_rw ON ${T} USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id)) WITH CHECK (public.fn_ofertare_clar_puncte_poarta(clarificare_id));`
const CREATE_TRG = `CREATE TRIGGER trg_ofertare_clar_parinte_puncte BEFORE UPDATE OF licitatie_id OR DELETE ON ${TP}\n  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda();`
const CORP = corp(MIG, SIG_POARTA), CORP_G = corp(MIG, SIG_GARDA)
const MUTANTI = [
  ['M1 fără ALTER POLICY pe SELECT (orice cont logat citește în continuare)', [[ALTER_SEL, '']]],
  ['M2 fără ALTER POLICY pe ALL (editorul Ofertare citește și scrie în continuare, prin OR)', [[ALTER_RW, '']]],
  ['M3 funcția fără verificarea modulului (responsabilul fără modul vede)', [[CORP, CORP.replace('AND public.fn_are_acces_ofertare()\n', '')]]],
  ['M4 OR în loc de AND (modulul singur ajunge)', [[CORP, CORP.replace('AND coalesce((SELECT public.fn_ofertare_poate_cheltui', 'OR coalesce((SELECT public.fn_ofertare_poate_cheltui')]]],
  ['M5 doar owner-ul (responsabilii nu mai văd)', [[CORP, '\n  SELECT auth.uid() IS NOT NULL AND coalesce((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = auth.uid()), false);\n']]],
  ['M6 dreptul de decizie în loc de poarta pe cheltuială (adminul Ofertare vede)', [[CORP, '\n  SELECT auth.uid() IS NOT NULL AND coalesce((SELECT public.fn_ofertare_source_pack_poate_decide(c.licitatie_id) FROM public.ofertare_clarificari c WHERE c.id = p_clarificare_id), false);\n']]],
  ['M7 clarificare inexistentă = true (fallback-ul fail-open)', [[CORP, CORP.replace('), false);', '), true);')]]],
  ['M8 ALL doar cu USING (WITH CHECK rămâne pe modul: editorul scrie)', [[ALTER_RW, `ALTER POLICY clar_puncte_rw ON ${T} USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));`]]],
  ['M9 fără triggerul părintelui (editorul mută / șterge clarificarea cu puncte)', [[CREATE_TRG, '']]],
  ['M10 garda doar pe DELETE (mutarea rămâne liberă)', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE OF licitatie_id OR DELETE', 'BEFORE DELETE')]]],
  ['M11 garda doar pe UPDATE (ștergerea rămâne liberă)', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE OF licitatie_id OR DELETE', 'BEFORE UPDATE OF licitatie_id')]]],
  ['M12 garda fără poartă la ștergere (orice client cu modul șterge clarificarea cu puncte)', [[CORP_G, CORP_G.replace("  IF NOT coalesce(public.fn_ofertare_clar_puncte_poarta(OLD.id), false) THEN\n    RAISE EXCEPTION 'Clarificarea are puncte: o sterge doar ownerul sau un responsabil al licitatiei (stergerea ar sterge si punctele).' USING ERRCODE = '42501';\n  END IF;\n", '')]]],
  ['M13 garda și pentru service_role (serverul blocat)', [[CORP_G, CORP_G.replace("IF current_user NOT IN ('authenticated', 'anon') THEN", "IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN")]]],
  ['M14 garda pe toate clarificările, nu doar pe cele cu puncte (editorul nu mai șterge clarificarea fără puncte)', [[CORP_G, CORP_G.replace('IF NOT public.fn_ofertare_clar_are_puncte(OLD.id) THEN', 'IF false THEN')]]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: /.test(ab[0]), `${nume} pică comportamental (${ab[0] || 'NU a picat'})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
for (const [nume, inl, re] of [
  ['S1 fără ALTER POLICY pe SELECT', MUTANTI[0][1], /postconditie: politicile ofertare_clarificari_puncte: clar_puncte_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/],
  ['S2 fără ALTER POLICY pe ALL', MUTANTI[1][1], /postconditie: politicile ofertare_clarificari_puncte: clar_puncte_rw: \*\|permisiva/],
  ['S3 poarta cu alt corp', MUTANTI[2][1], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S4 poarta SECURITY INVOKER', [['STABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$\n  SELECT auth.uid()', 'STABLE\nSET search_path = public, pg_temp\nAS $fn$\n  SELECT auth.uid()']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S5 poarta fără REVOKE de la PUBLIC / anon', [['REVOKE ALL ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM PUBLIC, anon;\n', '']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S6 poarta cu GRANT și pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role, anon;']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S7 garda SECURITY DEFINER', [['LANGUAGE plpgsql\nSET search_path = public, pg_temp\nAS $fn$\nBEGIN', 'LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$\nBEGIN']], /postconditie: fn_ofertare_clar_parinte_puncte_garda\(\) nu are forma asteptata/],
  ['S8 garda executabilă de authenticated', [['REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, service_role;']], /postconditie: fn_ofertare_clar_parinte_puncte_garda\(\) nu are forma asteptata/],
  ['S9 fără trigger', MUTANTI[8][1], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S10 trigger doar pe DELETE', MUTANTI[9][1], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S11 trigger AFTER', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE', 'AFTER UPDATE')]], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S12 REVOKE în plus pe tabelul de puncte', [[ALTER_RW, ALTER_RW + `\nREVOKE DELETE ON ${T} FROM authenticated;`]], /s-a schimbat altceva decat .*: acl_tabel \(era .*, acum /],
  ['S13 REVOKE în plus pe părinte', [[ALTER_RW, ALTER_RW + `\nREVOKE DELETE ON ${TP} FROM authenticated;`]], /s-a schimbat altceva decat .*: acl_parinte \(era .*, acum /],
  ['S14 triggerul de semnare dezactivat', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${T} DISABLE TRIGGER trg_clar_punct_semneaza;`]], /s-a schimbat altceva decat .*: triggere \(era /],
  ['S15 un trigger existent al părintelui dezactivat', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${TP} DISABLE TRIGGER USER;\nALTER TABLE ${TP} ENABLE TRIGGER trg_ofertare_clar_parinte_puncte;`]], /s-a schimbat altceva decat .*: triggere_parinte \(era /],
  ['S16 politica părintelui schimbată', [[ALTER_RW, ALTER_RW + `\nALTER POLICY clar_all_sel ON ${TP} USING (true);`]], /s-a schimbat altceva decat .*: politici_parinte \(era /],
  ['S17 GRANT în plus pe fn_ofertare_poate_cheltui', [[ALTER_RW, ALTER_RW + '\nGRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO authenticated;']], /s-a schimbat altceva decat .*: functie_cheltuiala \(era /],
  ['S18 o politică în plus pe puncte', [[ALTER_RW, ALTER_RW + `\nCREATE POLICY zz_sel ON ${T} FOR SELECT TO anon USING (true);`]], /postconditie: politicile ofertare_clarificari_puncte: \+zz_sel: r\|permisiva\|\{anon\}\|true\|-/],
  ['S19 RLS oprit după ALTER', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${T} DISABLE ROW LEVEL SECURITY;`]], /s-a schimbat altceva decat .*: rls \(era true\|false\|true\|false, acum false\|false\|true\|false\)/],
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
const SCEN = {
  selAltfel: async (db, t) => { await db.exec(`ALTER POLICY clar_puncte_sel ON ${T} USING (true)`); return livreaza(db, t) },
  accesDeriva: async (db, t) => { await db.exec(FN_ACCES_TRUE); return livreaza(db, t) },
  cheltDeriva: async (db, t) => { await db.exec(FN_CHELT_TRUE); return livreaza(db, t) },
  rlsOprit: async (db, t) => { await db.exec(`ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`); return livreaza(db, t) },
  fkLipsa: async (db, t) => { await db.exec(`ALTER TABLE ${T} DROP CONSTRAINT ofertare_clarificari_puncte_clarificare_id_fkey`); return livreaza(db, t) },
  // (garda „numele e liber” din $pre$ nu are scenariu propriu: fără ea, o supraîncărcare preexistentă e prinsă oricum de postcondiția „unică” — vezi
  //  refuzul din secțiunea 3; garda din $pre$ dă doar mesajul clar înaintea oricărei scrieri)
  revSelAltfel: async (db, t) => { await livreaza(db, MIG); await db.exec(`ALTER POLICY clar_puncte_sel ON ${T} USING (true)`); return revino(db, t) },
  revFnDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_NOU_TRUE); return revino(db, t) },
  revGardaDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec('ALTER FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() SECURITY DEFINER'); return revino(db, t) },
  revTrgDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(`ALTER TABLE ${TP} DISABLE TRIGGER trg_ofertare_clar_parinte_puncte`); return revino(db, t) },
  revApelant: async (db, t) => { await livreaza(db, MIG); await db.exec('CREATE FUNCTION public.zz_apelant(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_clar_puncte_poarta(p) $f$'); return revino(db, t) },
  revAccesDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_ACCES_TRUE); return revino(db, t) },
  revCheltDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_CHELT_TRUE); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără verificarea exactă a politicilor', 'mig', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a: politicile ofertare_clarificari_puncte difera de cele de azi (27.11.2026): %', v_rau; END IF;\n", '']], 'selAltfel'],
  ['P2 migrare: fără verificarea fn_are_acces_ofertare', 'mig', [["    RAISE EXCEPTION '20270114a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'accesDeriva'],
  ['P3 migrare: fără verificarea fn_ofertare_poate_cheltui', 'mig', [["    RAISE EXCEPTION '20270114a: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'cheltDeriva'],
  ['P4 migrare: fără verificarea RLS', 'mig', [["    RAISE EXCEPTION '20270114a: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';\n", '    NULL;\n']], 'rlsOprit'],
  ['P5 migrare: fără verificarea FK-ului', 'mig', [["    RAISE EXCEPTION '20270114a: lipseste FK-ul ofertare_clarificari_puncte.clarificare_id -> ofertare_clarificari(id)';\n", '    NULL;\n']], 'fkLipsa'],
  ['R1 revenire: fără verificarea exactă a politicilor (după migrare, politica SELECT schimbată altfel)', 'rev', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a revenire: starea nu e cea din 20270114a (politicile ofertare_clarificari_puncte): %', v_rau; END IF;\n", '']], 'revSelAltfel'],
  ['R2 revenire: fără verificarea porții', 'rev', [["    RAISE EXCEPTION '20270114a revenire: fn_ofertare_clar_puncte_poarta(bigint) nu e cea din 20270114a (corp md5 " + MD5_NOU + ", sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revFnDeriva'],
  ['R3 revenire: fără verificarea gărzii', 'rev', [["    RAISE EXCEPTION '20270114a revenire: fn_ofertare_clar_parinte_puncte_garda() nu e cea din 20270114a (corp md5 " + MD5_GARDA + ", plpgsql VOLATILE INVOKER, cale, proprietar, doar proprietarul executa, unica)';\n", '    NULL;\n']], 'revGardaDeriva'],
  ['R4 revenire: fără verificarea triggerului', 'rev', [["    RAISE EXCEPTION '20270114a revenire: triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270114a (BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW, garda, fara WHEN / argumente, activ)';\n", '    NULL;\n']], 'revTrgDeriva'],
  ['R5 revenire: fără scanarea apelanților din corpuri', 'rev', [["  IF v_dep IS NOT NULL THEN RAISE EXCEPTION '20270114a revenire: alte functii numesc in corp functiile 20270114a (apelanti neinregistrati in pg_depend): %', v_dep; END IF;\n", '']], 'revApelant'],
  ['R6 revenire: fără verificarea fn_are_acces_ofertare', 'rev', [["    RAISE EXCEPTION '20270114a revenire: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revAccesDeriva'],
  ['R7 revenire: fără verificarea fn_ofertare_poate_cheltui', 'rev', [["    RAISE EXCEPTION '20270114a revenire: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revCheltDeriva'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 80)}» / mutant «${rm.slice(0, 80)}»`)
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
