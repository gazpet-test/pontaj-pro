// Proba LOCALĂ a migrării 20270115a (Ofertare: punctele unei clarificări doar pentru owner / responsabilii licitației; exportul adresei cu aceeași
//   poartă și cu temeiurile de pe puncte în răspuns — varianta B) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql (roluri, auth.uid(), profiles, user_module_access, ofertare_licitatii,
//   ofertare_clarificari, fn_are_acces_ofertare 20260912, fn_ofertare_poate_cheltui 20261124a, fn_ofertare_source_pack_poate_decide 20260923 — corpuri EXACTE)
//   + supabase/tests/20270115a_…_schelet.sql (ofertare_clarificari_puncte EXACT ca în 20260928l, politicile de azi, triggerul, drepturile ca pe producție;
//   temeiurile 20261014b și registrele CNSC minime; exportul cu TEXTUL EXACT din producție, 20270112a 9e, md5 328b25f3…; stub pentru dispecerul ciornelor).
//   Migrarea rulează ca runnerul: plafonul 5000 (sesiune) + marcajele prologului + PAȘII REALI L15 v2 (scripts/livrare_amprenta_gen.sh) + garda finală reală
//   (lm_fin din scripts/livrare_mesaj.sh); revenirea cu plafonul 2000, fără amprenta globală.
// 0. Validatorul runnerului (5000 / 2000 / fără plafon), fișiere LF fără BOM, lock-urile înaintea verificărilor de stare (L14), inventarul instrucțiunilor
//    (migrarea: 4 CREATE FUNCTION + 1 CREATE OR REPLACE FUNCTION (exportul) + 4 REVOKE + 3 GRANT + 4 COMMENT + 1 CREATE TRIGGER + 2 ALTER POLICY; revenirea:
//    2 ALTER POLICY + 1 CREATE OR REPLACE FUNCTION (exportul de azi) + DROP TRIGGER + 4 DROP FUNCTION), amprentele dependențelor din migrare = textele
//    20260912 / 20261124a = scheletul, amprenta exportului de azi = textul 20270112a = scheletul = revenirea, amprentele funcțiilor noi = corpurile din
//    migrare, blocurile POLITICI / FUNCTII / FOTOGRAFIE identice între migrare și revenire.
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul authenticated cu JWT-ul fiecărui cont: înainte orice cont logat vede punctele,
//    oricine cu Ofertare scrie, exportul întoarce un TABLOU și îl poate chema adminul Ofertare; după: owner vede / scrie tot; responsabilul 1 (regula A)
//    și 2 (numit de owner) văd și scriu DOAR punctele licitației lor; editorul / adminul Ofertare fără rol, autonumitul, responsabilul fără modul,
//    sub-modulul, alt modul, fără modul: 0 rânduri, INSERT 42501, UPDATE / DELETE 0 rânduri; RPC-urile fn_ofertare_clar_puncte_poarta /
//    fn_ofertare_lic_puncte_poarta dau aceleași răspunsuri; anon nimic; triggerul de semnare neschimbat; garda părintelui: o clarificare CU puncte nu se
//    mută (nimeni dintre clienți) și se șterge doar de cine trece poarta; cele fără puncte ca azi; un punct nu se mută pe o clarificare fără poartă
//    (WITH CHECK); EXPORTUL: owner / responsabilul 1 primesc {clarificari, temeiuri} cu temeiurile de pe întrebări ȘI de pe puncte (doar bifate +
//    confirmate, doar de pe întrebările „de_trimis”), adminul Ofertare / autonumitul (drept de decizie, fără poartă) = 42501 cu mesajul exact, restul ca
//    azi (decizie / acces), anon 42501; UI-ul vechi (Array.isArray) refuză răspunsul nou.
// 2. Livrarea L15 v2: manifestul generat (ROLLBACK) = lista revizuită; GLOBAL greșit / manifest incomplet = refuzul RUNNERULUI; livrarea aprobată + garda
//    finală; dry-run-ul de pe clonă rulează aici și nu lasă nimic; fără migrare pică. 2b. ambele ordini față de 20270113a (APLICATĂ pe producție).
// 3. Refuzurile migrării (nimic schimbat). 4. Revenirea: ciclu + refuzurile după derivă (politică, funcție, drepturi, trigger, export, obiect dependent,
//    apelant textual). 5. MUTANȚI: comportamentali, structurali, pe gărzile de stare ale migrării și pe revenire.
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
const NUME = '20270115a_ofertare_clarificari_puncte_citire', NUME_REV = NUME + '_ROLLBACK'
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
// C1 („de_trimis”), C4 („propunere”) pe LIC (RESP + RESP2); C2 pe LIC2 (RFM, fără modul); C3 pe LIC3 (AUTO; „propunere” — LIC3 n-are nimic de exportat, deci
// poarta exportului trebuie verificată pe LICITAȚIE, nu pe întrebările exportate: mutantul M18); C5 pe LIC, FĂRĂ puncte, „de_trimis”
const C1 = 9001, C2 = 9002, C3 = 9003, C4 = 9004, C5 = 9005
// decizia CNSC D1 (verificată, link, un citat) și D2 (neverificată); temeiurile: T1 pe întrebarea C1, T2 pe punctul 1 al C1 (ambele bifate), T3 pe punctul C4
// (C4 nu e „de_trimis” → nu iese), T4 pe punctul 2 al C1 NEbifat (nu iese), T5 pe C2 (altă licitație), T6 pe C5 cu decizia NEverificată (iese în răspuns —
// UI-ul blochează exportul prin motivNeexportabil, serverul nu filtrează pe tip / verificare)
const D1 = 'CNSC-TEST-1', D2 = 'CNSC-TEST-NEV'
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
INSERT INTO public.ofertare_clarificari (id, licitatie_id, nr, intrebare, status) VALUES (${C1}, ${LIC}, 1, 'intrebare unu', 'de_trimis'),
  (${C2}, ${LIC2}, 1, 'intrebare L2', 'de_trimis'), (${C3}, ${LIC3}, 1, 'intrebare L3', 'propunere'), (${C4}, ${LIC}, 2, 'intrebare doi', 'propunere'),
  (${C5}, ${LIC}, 3, 'intrebare fara puncte', 'de_trimis');
INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 1, 'punct 1'), (${C1}, 2, 'punct 2'), (${C2}, 1, 'punct L2'),
  (${C3}, 1, 'punct L3'), (${C4}, 1, 'punct C4');
INSERT INTO public.cnsc_decizii (id, nr_decizie, buletin_oficial, data, regula, link_sursa, citate_cheie, control_judiciar, verificat, versiune_import) VALUES
  ('${D1}', '1/C1/1', NULL, DATE '2026-01-15', 'regula test', 'https://portal.cnsc.ro/test', '[{"loc": "p. 3", "text": "citat unu"}, {"loc": "p. 4", "text": "citat doi"}]'::jsonb, '{"rezultat": "mentinuta"}'::jsonb, true, 'test'),
  ('${D2}', '2/C2/2', NULL, DATE '2026-02-15', 'regula test', 'https://portal.cnsc.ro/test2', '[{"loc": "p. 1", "text": "citat nev"}]'::jsonb, NULL, false, 'test');
INSERT INTO public.ofertare_clarificari_temeiuri (id, clarificare_id, punct_id, cnsc_decizie_id, citat_idx, citat_text, include_in_adresa, confirmat) VALUES
  (701, ${C1}, NULL, '${D1}', 0, 'citat unu', true, true),
  (702, NULL, (SELECT id FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1} AND nr = 1), '${D1}', 1, 'citat doi', true, true),
  (703, NULL, (SELECT id FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C4} AND nr = 1), '${D1}', 0, 'citat unu', true, true),
  (704, NULL, (SELECT id FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1} AND nr = 2), '${D1}', 0, 'citat unu', false, true),
  (705, ${C2}, NULL, '${D1}', 0, 'citat unu', true, true),
  (706, ${C5}, NULL, '${D2}', 0, 'citat nev', true, true);`)
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
const T = 'public.ofertare_clarificari_puncte', TP = 'public.ofertare_clarificari', TT = 'public.ofertare_clarificari_temeiuri', TD = 'public.cnsc_decizii'
const POLITICI_SQL = t => `SELECT string_agg(p.polname::text || '=' || p.polcmd::text || '|' || p.polpermissive::text || '|' || coalesce((SELECT string_agg(ro::regrole::text, ',' ORDER BY ro::regrole::text) FROM unnest(p.polroles) ro), '')
    || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '; ' ORDER BY p.polname::text)
  FROM pg_policy p WHERE p.polrelid = '${t}'::regclass`
const FN = f => `coalesce((SELECT md5(replace(prosrc, chr(13), '')) || '|' || coalesce(proacl::text, '-') || '|' || prosecdef::text || '|' || provolatile::text || '|' || coalesce(array_to_string(proconfig, ';'), '-') FROM pg_proc WHERE oid = to_regprocedure('${f}')), 'LIPSA')`
const TRG = t => `coalesce((SELECT string_agg(tgname::text || ':' || tgenabled::text || ':' || tgtype::text || ':' || tgattr::text || ':' || (tgqual IS NULL)::text || ':' || tgnargs::text || ':' || tgfoid::regprocedure::text, ',' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = '${t}'::regclass AND NOT tgisinternal), '-')`
const stare = async db => (await db.query(`SELECT (${POLITICI_SQL(T)}) AS politici,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${T}'::regclass) AS acl_tabel,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${TP}'::regclass) AS acl_parinte,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${TT}'::regclass) AS acl_temeiuri,
    (SELECT coalesce(relacl::text, '-') FROM pg_class WHERE oid = '${TD}'::regclass) AS acl_cnsc,
    ${TRG(T)} AS triggere, ${TRG(TP)} AS triggere_parinte,
    ${FN('public.fn_ofertare_clar_puncte_poarta(bigint)')} AS functie_noua,
    ${FN('public.fn_ofertare_lic_puncte_poarta(bigint)')} AS functie_lic,
    ${FN('public.fn_ofertare_clar_are_puncte(bigint)')} AS functie_are,
    ${FN('public.fn_ofertare_clar_parinte_puncte_garda()')} AS functie_garda,
    ${FN('public.ofertare_clarificari_export(bigint)')} AS functie_export,
    ${FN('public.fn_are_acces_ofertare()')} AS functie_acces,
    ${FN('public.fn_ofertare_poate_cheltui(bigint, uuid)')} AS functie_cheltuiala,
    ${FN('public.fn_ofertare_source_pack_poate_decide(bigint)')} AS functie_decide,
    ${FN('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)')} AS functie_auto_stare,
    ${FN('public.fn_clar_punct_semneaza()')} AS functie_trigger,
    (SELECT string_agg(polname::text, ',' ORDER BY polname::text) FROM pg_policy WHERE polrelid = '${TP}'::regclass) AS politici_parinte,
    (${POLITICI_SQL(TT)}) AS politici_temeiuri, (${POLITICI_SQL(TD)}) AS politici_cnsc,
    (SELECT relrowsecurity::text || relforcerowsecurity::text FROM pg_class WHERE oid = '${T}'::regclass) AS rls,
    (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS puncte,
    (SELECT count(*)::int FROM public.ofertare_clarificari_temeiuri) AS temeiuri`)).rows[0]
const SUBQ = '( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)', POARTA = 'fn_ofertare_clar_puncte_poarta(clarificare_id)'
const POLITICI_VECHI = `clar_puncte_rw=*|true|authenticated|${SUBQ}|${SUBQ}; clar_puncte_sel=r|true|authenticated|(auth.uid() IS NOT NULL)|-`
const POLITICI_NOI = `clar_puncte_rw=*|true|authenticated|${POARTA}|${POARTA}; clar_puncte_sel=r|true|authenticated|${POARTA}|-`
const TRG_NOU = 'trg_ofertare_clar_parinte_puncte:O:27:2:true:0:fn_ofertare_clar_parinte_puncte_garda()'   // tgattr = attnum(licitatie_id) = 2 în schelet (id, licitatie_id, …)
const MD5_EXPORT_VECHI = '328b25f3431c5fc51a016d5ef359e453'   // corpul exportului din producție (20270112a 9e), citit 27.11.2026 — cerut în $pre$, readus de revenire
let STARE_VECHE = null
const neschimbate = s => s.acl_tabel === STARE_VECHE.acl_tabel && s.acl_parinte === STARE_VECHE.acl_parinte && s.acl_temeiuri === STARE_VECHE.acl_temeiuri && s.acl_cnsc === STARE_VECHE.acl_cnsc
  && s.triggere === STARE_VECHE.triggere && s.functie_acces === STARE_VECHE.functie_acces && s.functie_cheltuiala === STARE_VECHE.functie_cheltuiala
  && s.functie_decide === STARE_VECHE.functie_decide && s.functie_auto_stare === STARE_VECHE.functie_auto_stare && s.functie_trigger === STARE_VECHE.functie_trigger
  && s.rls === STARE_VECHE.rls && s.politici_parinte === STARE_VECHE.politici_parinte && s.politici_temeiuri === STARE_VECHE.politici_temeiuri && s.politici_cnsc === STARE_VECHE.politici_cnsc
// exportul: [md5, acl, secdef, volatil, config]; „de azi” = corpul producției, INVOKER; „nou” = corpul din migrare, DEFINER, ACELAȘI acl
const exportVechi = s => { const p = s.functie_export.split('|'); return p[0] === MD5_EXPORT_VECHI && p[2] === 'false' && p[3] === 'v' && p[4] === 'search_path=public, pg_temp' && /authenticated=X\/postgres/.test(p[1]) && /service_role=X\/postgres/.test(p[1]) && !/anon=|(^|[{,])=X/.test(p[1]) }
const eVeche = s => s.politici === POLITICI_VECHI && s.functie_noua === 'LIPSA' && s.functie_lic === 'LIPSA' && s.functie_are === 'LIPSA' && s.functie_garda === 'LIPSA'
  && s.triggere_parinte === STARE_VECHE.triggere_parinte && exportVechi(s) && neschimbate(s)
const corp = (t, sig, tag = '$fn$') => { const i = t.indexOf(sig); if (i < 0) throw new Error('lipsă ' + sig); const a = t.indexOf(`AS ${tag}`, i) + `AS ${tag}`.length; return t.slice(a, t.indexOf(`${tag};`, a)) }
const SIG_ARE = 'CREATE FUNCTION public.fn_ofertare_clar_are_puncte(p_clarificare_id bigint)', SIG_LIC = 'CREATE FUNCTION public.fn_ofertare_lic_puncte_poarta(p_licitatie_id bigint)'
const SIG_POARTA = 'CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint)', SIG_GARDA = 'CREATE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()'
const SIG_EXPORT = 'CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)'
const MD5_NOU = md5(corp(MIG, SIG_POARTA)), MD5_LIC = md5(corp(MIG, SIG_LIC)), MD5_ARE = md5(corp(MIG, SIG_ARE)), MD5_GARDA = md5(corp(MIG, SIG_GARDA)), MD5_EXPORT_NOU = md5(corp(MIG, SIG_EXPORT, '$function$'))
const fnDefiner = (s, m, vol = 's') => s.startsWith(m + '|') && new RegExp(`\\|true\\|${vol}\\|search_path=public, pg_temp$`).test(s) && /authenticated=X\/postgres/.test(s) && /service_role=X\/postgres/.test(s) && !/(^|[{,])=X/.test(s) && !/anon=/.test(s)
const exportNou = s => { const p = s.functie_export.split('|'), v = STARE_VECHE.functie_export.split('|'); return p[0] === MD5_EXPORT_NOU && p[1] === v[1] && p[2] === 'true' && p[3] === 'v' && p[4] === 'search_path=public, pg_temp' }
const eNoua = s => s.politici === POLITICI_NOI && fnDefiner(s.functie_noua, MD5_NOU) && fnDefiner(s.functie_lic, MD5_LIC) && fnDefiner(s.functie_are, MD5_ARE, 'v')
  && s.functie_garda.startsWith(MD5_GARDA + '|{postgres=X/postgres}|false|v|search_path=public, pg_temp') && exportNou(s)
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
// [total vizibil, pe C1, poarta(C1), poarta(C2), poarta(inexistentă), poarta pe licitația LIC, poarta pe LIC2]
const ASTEPTAT_DUPA = {
  OWNER: [5, 2, true, true, false, true, true], RESP: [3, 2, true, false, false, true, false], RESP2: [3, 2, true, false, false, true, false],
  OF: [0, 0, false, false, false, false, false], ADM: [0, 0, false, false, false, false, false], AUTO: [0, 0, false, false, false, false, false],
  RFM: [0, 0, false, false, false, false, false], SUB: [0, 0, false, false, false, false, false], STRAIN: [0, 0, false, false, false, false, false],
  NOMOD: [0, 0, false, false, false, false, false],
}
async function numara(db, cont) {
  const r = await ca(db, cont, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS tot, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS c1,
    public.fn_ofertare_clar_puncte_poarta(${C1}) AS p1, public.fn_ofertare_clar_puncte_poarta(${C2}) AS p2, public.fn_ofertare_clar_puncte_poarta(999999999) AS p0,
    public.fn_ofertare_lic_puncte_poarta(${LIC}) AS l1, public.fn_ofertare_lic_puncte_poarta(${LIC2}) AS l2`)
  return r.code ? r : [r.rows[0].tot, r.rows[0].c1, r.rows[0].p1, r.rows[0].p2, r.rows[0].p0, r.rows[0].l1, r.rows[0].l2]
}
const numaraVechi = async (db, cont) => {
  const r = await ca(db, cont, `SELECT (SELECT count(*)::int FROM public.ofertare_clarificari_puncte) AS tot, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS c1`)
  return r.code ? r : [r.rows[0].tot, r.rows[0].c1]
}
const INTACT = `SELECT (SELECT licitatie_id FROM public.ofertare_clarificari WHERE id = ${C1})::int AS lic, (SELECT count(*)::int FROM public.ofertare_clarificari_puncte WHERE clarificare_id = ${C1}) AS n`
// exportul ca un cont: { data } (jsonb) sau { code, message }
const exporta = async (db, cont, lic = LIC, rol = 'authenticated') => { const r = await ca(db, cont, `SELECT public.ofertare_clarificari_export(${lic}) AS d`, [], { rol }); return r.code ? r : { data: r.rows[0].d } }
const MSG_POARTA_EXPORT = 'Export blocat: adresa o genereaza doar ownerul sau un responsabil al licitatiei (temeiurile de pe punctele intrebarilor sunt vizibile doar lor)'
// temeiurile așteptate pe LIC după migrare (scrise de mână): T1 (întrebarea C1), T2 (punctul 1 al C1), T6 (C5, decizia neverificată — iese, UI-ul blochează)
const TEMEIURI_ASTEPTATE = [
  { id: 701, nr: 1, tinta: 'intrebare', punct_nr: null, citat_idx: 0, citat_text: 'citat unu', citat_loc: 'p. 3', decizie: D1, verificat: true },
  { id: 702, nr: 1, tinta: 'punct', punct_nr: 1, citat_idx: 1, citat_text: 'citat doi', citat_loc: 'p. 4', decizie: D1, verificat: true },
  { id: 706, nr: 3, tinta: 'intrebare', punct_nr: null, citat_idx: 0, citat_text: 'citat nev', citat_loc: 'p. 1', decizie: D2, verificat: false },
]
const rezumaTemeiuri = t => t.map(x => ({ id: x.id, nr: x.nr, tinta: x.tinta, punct_nr: x.punct_nr, citat_idx: x.citat_idx, citat_text: x.citat_text, citat_loc: x.citat_loc, decizie: x.decizie?.id ?? null, verificat: x.decizie?.verificat ?? null }))
// verificările exportului DUPĂ migrare: lista abaterilor (goală = bine)
async function verificaExport(db) {
  const ab = []
  for (const cont of ['OWNER', 'RESP']) {
    const e = await exporta(db, cont)
    if (e.code) { ab.push(`export ${cont}: eroare ${e.code} ${e.message}`); continue }
    const d = e.data
    if (Array.isArray(d) || typeof d !== 'object' || !Array.isArray(d.clarificari) || !Array.isArray(d.temeiuri)) { ab.push(`export ${cont}: nu e {clarificari, temeiuri}: ${JSON.stringify(d).slice(0, 200)}`); continue }
    if (JSON.stringify(d.clarificari.map(c => [c.id, c.nr, c.status])) !== JSON.stringify([[C1, 1, 'de_trimis'], [C5, 3, 'de_trimis']])) ab.push(`export ${cont}: clarificările ${JSON.stringify(d.clarificari.map(c => [c.id, c.nr, c.status]))}, așteptam C1 și C5 „de_trimis” în ordinea nr`)
    if (JSON.stringify(rezumaTemeiuri(d.temeiuri)) !== JSON.stringify(TEMEIURI_ASTEPTATE)) ab.push(`export ${cont}: temeiurile ${JSON.stringify(rezumaTemeiuri(d.temeiuri))}, așteptam ${JSON.stringify(TEMEIURI_ASTEPTATE)}`)
    if (!d.temeiuri.every(t => t.decizie && typeof t.decizie.link_sursa === 'string' && 'control_judiciar' in t.decizie && 'nr_decizie' in t.decizie && 'buletin_oficial' in t.decizie && 'data' in t.decizie)) ab.push(`export ${cont}: decizia fără câmpurile citării (link_sursa, control_judiciar, nr_decizie, buletin_oficial, data)`)
  }
  // drept de decizie, dar fără poarta punctelor: adminul Ofertare pe LIC, autonumitul pe LIC3 (care n-are nimic „de_trimis”: poarta e pe licitație,
  // nu pe întrebările exportate) → 42501 cu mesajul exact
  for (const [cont, lic] of [['ADM', LIC], ['AUTO', LIC3]]) {
    const e = await exporta(db, cont, lic)
    if (e.code !== '42501' || e.message !== MSG_POARTA_EXPORT) ab.push(`export ${cont} pe ${lic}: ${JSON.stringify(e).slice(0, 300)} (așteptam 42501 cu mesajul porții)`)
  }
  // ca azi (înaintea porții): fără drept de decizie (OF, RESP2 = responsabil 2, AUTO pe LIC) = P0001 „drept de decizie”; fără modul = P0001 „fără acces”
  for (const cont of ['OF', 'RESP2', 'AUTO']) {
    const e = await exporta(db, cont)
    if (e.code !== 'P0001' || !/drept de decizie/.test(e.message)) ab.push(`export ${cont}: ${JSON.stringify(e).slice(0, 200)} (așteptam P0001 drept de decizie)`)
  }
  for (const cont of ['RFM', 'SUB', 'STRAIN', 'NOMOD']) {
    const e = await exporta(db, cont, cont === 'RFM' ? LIC2 : LIC)
    if (e.code !== 'P0001' || !/acces/.test(e.message)) ab.push(`export ${cont}: ${JSON.stringify(e).slice(0, 200)} (așteptam P0001 fără acces)`)
  }
  const an = await exporta(db, null, LIC, 'anon')
  if (an.code !== '42501') ab.push('export anon: ' + JSON.stringify(an).slice(0, 200))
  // UI-ul vechi verifica Array.isArray(data) → răspunsul nou îl face să refuze (fila veche deschisă peste momentul migrării: review r3 P1 #1)
  const o = await exporta(db, 'OWNER')
  if (o.code || Array.isArray(o.data)) ab.push('export: răspunsul nou e tablou (UI-ul vechi l-ar accepta)')
  return ab
}
// verificările comportamentului DUPĂ migrare: lista abaterilor (goală = bine)
async function verifica(db) {
  const ab = []
  for (const [cont, astept] of Object.entries(ASTEPTAT_DUPA)) {
    const n = await numara(db, cont)
    if (n.code) ab.push(`${cont}: eroare ${n.code} ${n.message}`)
    else if (JSON.stringify(n) !== JSON.stringify(astept)) ab.push(`${cont}: [total, C1, poarta C1, poarta C2, poarta inexistentă, poarta LIC, poarta LIC2] = ${JSON.stringify(n)}, aștepta ${JSON.stringify(astept)}`)
  }
  // anon: nimic (0 rânduri sau fără drept); funcțiile nu pot fi chemate
  const an = await ca(db, null, `SELECT count(*)::int AS tot FROM public.ofertare_clarificari_puncte`, [], { rol: 'anon' })
  if (!(an.code === '42501' || (an.rows && an.rows[0].tot === 0))) ab.push('anon citire: ' + JSON.stringify(an))
  const anf = await ca(db, null, `SELECT public.fn_ofertare_clar_puncte_poarta(${C1})`, [], { rol: 'anon' })
  if (anf.code !== '42501') ab.push('anon functie: ' + JSON.stringify(anf))
  const anl = await ca(db, null, `SELECT public.fn_ofertare_lic_puncte_poarta(${LIC})`, [], { rol: 'anon' })
  if (anl.code !== '42501') ab.push('anon functie lic: ' + JSON.stringify(anl))
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
  // mutarea pe altă licitație e refuzată din aplicație și FĂRĂ puncte (r2 P1: cursa cu primul punct inserat concurent), pentru oricine (OF, RESP, OWNER)
  const p3 = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C5}`)
  if (p3.code !== '42501') ab.push('OF muta C5 (fara puncte): ' + JSON.stringify(p3))
  const p3b = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (editata)' WHERE id = ${C5}`)
  if (p3b.code || p3b.afectate !== 1) ab.push('OF editeaza C5 (fara puncte): ' + JSON.stringify(p3b))
  const p4 = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C5}`)
  if (p4.code || p4.afectate !== 1) ab.push('OF sterge C5 (fara puncte): ' + JSON.stringify(p4))
  const p3c = await ca(db, 'OWNER', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C5}`)
  if (p3c.code !== '42501') ab.push('OWNER muta C5: ' + JSON.stringify(p3c))
  // responsabilul: nu mută C1, dar o șterge (cascada = punctele licitației lui); AUTO nu șterge C3
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
  // exportul adresei (varianta B)
  ab.push(...await verificaExport(db))
  // după toate (fiecare în ROLLBACK): C1 e pe LIC cu 2 puncte, temeiurile intacte
  const i0 = (await db.query(INTACT + `, (SELECT count(*)::int FROM public.ofertare_clarificari_temeiuri) AS t`)).rows[0]
  if (i0.lic !== LIC || i0.n !== 2 || i0.t !== 6) ab.push('starea finală C1 / temeiuri: ' + JSON.stringify(i0))
  return ab
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('0. validatorul runnerului, forma fișierelor, inventarul instrucțiunilor, amprentele, blocurile POLITICI / FUNCTII / FOTOGRAFIE')
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
  ok(/^-- Version 20270115120000\. NEAPLICAT\./.test(MIG) && REV.includes('--versiune 20270115120001') && !/20270114a_ofertare/.test(MIG + REV + DRY + SCHELET_P), 'versiunile: migrarea 20270115120000, revenirea 20270115120001; nicio urmă a numărului vechi 20270114a')
  const L = `LOCK TABLE ${T} IN ACCESS EXCLUSIVE MODE NOWAIT;`, LP = `LOCK TABLE ${TP} IN SHARE ROW EXCLUSIVE MODE NOWAIT;`
  const faraComentarii = t => t.replace(/--[^\n]*/g, '')
  const MIGc = faraComentarii(MIG), REVc = faraComentarii(REV)
  const EXP = '\nCREATE OR REPLACE FUNCTION public.ofertare_clarificari_export'
  ok(MIGc.split(L).length === 2 && MIGc.split(LP).length === 2 && MIGc.indexOf(L) < MIGc.indexOf(LP) && MIGc.indexOf('DO $lock$') > MIGc.indexOf('END $pre$;') && MIGc.indexOf('END $lock$;') < MIGc.indexOf('DO $stare$')
    && MIGc.indexOf('DO $stare$') < MIGc.indexOf('\nCREATE FUNCTION public.fn_ofertare_clar_are_puncte') && MIGc.indexOf('\nCREATE FUNCTION public.fn_ofertare_lic_puncte_poarta') < MIGc.indexOf('\nCREATE FUNCTION public.fn_ofertare_clar_puncte_poarta')
    && MIGc.indexOf('\nCREATE TRIGGER ') < MIGc.indexOf(EXP) && MIGc.indexOf(EXP) < MIGc.indexOf('\nALTER POLICY clar_puncte_sel') && MIGc.indexOf('\nALTER POLICY clar_puncte_rw') < MIGc.indexOf('DO $post$')
    && REVc.split(L).length === 2 && REVc.split(LP).length === 2 && REVc.indexOf(L) < REVc.indexOf(LP) && REVc.indexOf(LP) < REVc.indexOf('DO $stare$')
    && REVc.indexOf('DO $stare$') < REVc.indexOf('\nALTER POLICY clar_puncte_sel') && REVc.indexOf('\nALTER POLICY clar_puncte_rw') < REVc.indexOf(EXP) && REVc.indexOf(EXP) < REVc.indexOf('\nDROP TRIGGER')
    && REVc.indexOf('\nDROP TRIGGER') < REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_parinte_puncte_garda') && REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_puncte_poarta') < REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_are_puncte')
    && REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_clar_are_puncte') < REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_lic_puncte_poarta') && REVc.indexOf('\nDROP FUNCTION public.fn_ofertare_lic_puncte_poarta') < REVc.indexOf('DO $post$'),
  'lock-urile (puncte ACCESS EXCLUSIVE, apoi părintele SHARE ROW EXCLUSIVE, NOWAIT) vin ÎNAINTEA verificărilor de stare, schimbările după ele și înaintea postcondițiilor (poarta pe licitație înaintea celei pe clarificare, exportul după trigger); în revenire politicile → exportul de azi → trigger → funcții în ordinea dependențelor (L14)')
  const nr = (t, re) => (t.match(re) || []).length
  ok(nr(MIGc, /\nCREATE FUNCTION /g) === 4 && nr(MIGc, /\nCREATE OR REPLACE FUNCTION /g) === 1 && nr(MIGc, new RegExp(EXP, 'g')) === 1 && nr(MIGc, /\nREVOKE /g) === 4 && nr(MIGc, /\nGRANT /g) === 3 && nr(MIGc, /\nCOMMENT ON FUNCTION /g) === 4 && nr(MIGc, /\nCREATE TRIGGER /g) === 1 && nr(MIGc, /\nALTER POLICY /g) === 2
    && !/\n(DROP |ALTER TABLE|ALTER VIEW|ALTER FUNCTION|INSERT |UPDATE |DELETE |TRUNCATE |CREATE POLICY|CREATE TABLE(?! cp_foto)|CREATE OR REPLACE (?!FUNCTION public\.ofertare_clarificari_export))/.test(MIGc.replace(/CREATE TEMP TABLE cp_foto ON COMMIT DROP/g, '')),
  'migrarea schimbă EXACT: 4 CREATE FUNCTION + 1 CREATE OR REPLACE FUNCTION (doar exportul) + 4 REVOKE + 3 GRANT + 4 COMMENT + 1 CREATE TRIGGER + 2 ALTER POLICY (nimic șters, niciun tabel / drept pe tabel atins, exportul fără GRANT / REVOKE / COMMENT)')
  ok(nr(REVc, /\nALTER POLICY /g) === 2 && nr(REVc, /\nCREATE OR REPLACE FUNCTION /g) === 1 && nr(REVc, new RegExp(EXP, 'g')) === 1 && nr(REVc, /\nDROP TRIGGER /g) === 1 && nr(REVc, /\nDROP FUNCTION /g) === 4 && !/CASCADE/.test(REVc)
    && !/\n(CREATE FUNCTION|ALTER TABLE|ALTER FUNCTION|GRANT |REVOKE |INSERT |UPDATE |DELETE |TRUNCATE |CREATE POLICY|COMMENT )/.test(REVc.replace(/CREATE TEMP TABLE cp_foto ON COMMIT DROP/g, '')),
  'revenirea schimbă EXACT: 2 ALTER POLICY + 1 CREATE OR REPLACE FUNCTION (exportul de azi) + 1 DROP TRIGGER + 4 DROP FUNCTION (fără CASCADE, fără GRANT / REVOKE / ALTER FUNCTION), nimic altceva')
  // amprentele dependențelor: md5 din migrare și revenire = corpurile din 20260912 / 20261124a = scheletul
  const corpAcces = t => { const i = t.indexOf('FUNCTION public.fn_are_acces_ofertare()'); const a = t.indexOf('AS $fn$', i) + 7; return t.slice(a, t.indexOf('$fn$;', a)) }
  const corpChelt = t => { const i = t.indexOf('CREATE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid)'); const a = t.indexOf('AS $function$', i) + 13; return t.slice(a, t.indexOf('$function$;', a)) }
  const mA = md5(corpAcces(citeste('supabase/migrations/20260912_ofertare_acces_fara_parametru.sql'))), mC = md5(corpChelt(citeste('supabase/migrations/20261124a_ofertare_poarta_cheltuiala.sql')))
  ok(mA === md5(corpAcces(SCHELET)) && MIGc.split(mA).length === 3 && REVc.split(mA).length === 3, `amprenta fn_are_acces_ofertare (${mA}) = 20260912 = scheletul; în migrare și revenire (condiție + mesaj)`)
  ok(mC === md5(corpChelt(SCHELET)) && MIGc.split(mC).length === 3 && REVc.split(mC).length === 3, `amprenta fn_ofertare_poate_cheltui (${mC}) = 20261124a = scheletul; în migrare și revenire (condiție + mesaj)`)
  // exportul de azi: textul din 20270112a (9e, aplicată 26.11.2026) = scheletul = cel readus de revenire; amprenta cerută în $pre$ și verificată după revenire
  const bloc = (t, et) => t.slice(t.indexOf(`-- >>> ${et}`), t.indexOf(`-- <<< ${et}`))
  const corpExportAzi = t => corp(t, SIG_EXPORT, '$function$')
  const MIG_0112 = citeste('supabase/migrations/20270112a_ofertare_cantitati_masuratori.sql')
  const m0112 = md5(corpExportAzi(MIG_0112.slice(MIG_0112.indexOf('-- 9e. exportul'))))
  ok(m0112 === MD5_EXPORT_VECHI && md5(corpExportAzi(bloc(SCHELET_P, 'EXPORT DE AZI'))) === MD5_EXPORT_VECHI && md5(corpExportAzi(bloc(REV, 'EXPORT DE AZI'))) === MD5_EXPORT_VECHI
    && MIGc.split(MD5_EXPORT_VECHI).length === 3 && REVc.split(MD5_EXPORT_VECHI).length === 3 && !bloc(REV, 'EXPORT DE AZI').includes('SECURITY DEFINER'),
  `amprenta exportului de azi (${MD5_EXPORT_VECHI}) = 20270112a 9e = scheletul = textul readus de revenire (SECURITY INVOKER); în $pre$-ul migrării și în postcondiția revenirii (condiție + mesaj)`)
  for (const [nume, m] of [['poarta pe clarificare', MD5_NOU], ['poarta pe licitație', MD5_LIC], ['are_puncte', MD5_ARE], ['garda', MD5_GARDA], ['exportul nou', MD5_EXPORT_NOU]]) {
    ok(/^[0-9a-f]{32}$/.test(m) && MIGc.split(m).length === 3 && REVc.split(m).length === 3, `amprenta funcției ${nume} (${m}) = corpul din migrare; în postcondiția migrării și în starea cerută de revenire (condiție + mesaj)`)
  }
  ok(!/@@MD5_|MD5_(POARTA_PUNCTE|ARE_PUNCTE|GARDA|LIC|EXPORT)@@/.test(MIG + REV), 'fără marcaje de md5 rămase')
  const CP = corp(MIG, SIG_POARTA), CL = corp(MIG, SIG_LIC), CG = corp(MIG, SIG_GARDA), CE = corp(MIG, SIG_EXPORT, '$function$')
  ok(/auth\.uid\(\)/.test(CL) && !/p_uid/.test(CL) && /public\.fn_are_acces_ofertare\(\)/.test(CL) && /public\.fn_ofertare_poate_cheltui\(p_licitatie_id, auth\.uid\(\)\)/.test(CL)
    && /public\.fn_ofertare_lic_puncte_poarta\(c\.licitatie_id\)/.test(CP) && !/auth\.uid|fn_are_acces|poate_cheltui/.test(CP) && /, false\);/.test(CP),
    'poarta pe licitație: identitatea DOAR din auth.uid() (fără parametru de utilizator, L08), modulul + poarta pe cheltuială, nume calificate; poarta pe clarificare = aceeași funcție pe licitația clarificării (un singur predicat, L19), inexistentă = false')
  ok(/current_user NOT IN \('authenticated', 'anon'\)/.test(CG) && /IF NOT public\.fn_ofertare_clar_are_puncte\(OLD\.id\) THEN RETURN OLD; END IF;/.test(CG) && /public\.fn_ofertare_clar_puncte_poarta\(OLD\.id\)/.test(CG) && !/auth\.uid|request\.jwt|set_config/.test(CG)
    && CG.indexOf("IF TG_OP = 'UPDATE' THEN") < CG.indexOf('fn_ofertare_clar_are_puncte') && /\nVOLATILE\nSECURITY DEFINER/.test(MIG.slice(MIG.indexOf(SIG_ARE), MIG.indexOf('$fn$;', MIG.indexOf(SIG_ARE))))
    && /SECURITY INVOKER|\nSET search_path = public, pg_temp\nAS \$fn\$\nBEGIN/.test(MIG.slice(MIG.indexOf(SIG_GARDA), MIG.indexOf('$fn$;', MIG.indexOf(SIG_GARDA)))) && !/SECURITY DEFINER/.test(MIG.slice(MIG.indexOf(SIG_GARDA), MIG.indexOf('$fn$;', MIG.indexOf(SIG_GARDA)))),
    'corpul gărzii: INVOKER (fără SECURITY DEFINER), apelantul deosebit prin current_user, mutarea refuzată ÎNAINTEA oricărei verificări de puncte (fără puncte = tot refuz), existența punctelor (VOLATILE) și poarta prin funcțiile DEFINER pe OLD.id, fără identitate din GUC')
  // exportul: textul de azi păstrat (gărzile vechi, bucla FOR SHARE, dispecerul), poarta înaintea buclei cu 42501, temeiurile într-un singur SELECT, DEFINER cu cale sigură, fără current_user / GUC
  const antetExport = MIG.slice(MIG.indexOf(SIG_EXPORT), MIG.indexOf('AS $function$', MIG.indexOf(SIG_EXPORT)))
  const vechi = corpExportAzi(bloc(SCHELET_P, 'EXPORT DE AZI'))
  const liniiVechi = vechi.split('\n').filter(l => l.trim())
  ok(/\nSECURITY DEFINER\n/.test(antetExport) && /\nSET search_path = public, pg_temp\n/.test(antetExport) && /\nLANGUAGE plpgsql\n/.test(antetExport)
    && liniiVechi.filter(l => !/^DECLARE|^END|^  RETURN v_out;/.test(l)).every(l => CE.includes(l)) && CE.includes('DECLARE c public.ofertare_clarificari; v_st jsonb; v_out jsonb := \'[]\'::jsonb; v_tem jsonb;') && CE.indexOf('fn_ofertare_lic_puncte_poarta(p_licitatie_id)') < CE.indexOf('FOR c IN SELECT') && CE.indexOf('fn_ofertare_source_pack_poate_decide') < CE.indexOf('fn_ofertare_lic_puncte_poarta')
    && /USING ERRCODE = '42501'/.test(CE) && CE.includes(`'${MSG_POARTA_EXPORT}'`) && (CE.match(/\n\s*SELECT coalesce\(jsonb_agg/g) || []).length === 1 && /t\.include_in_adresa AND t\.confirmat/.test(CE) && /q\.status = 'de_trimis'/.test(CE)
    && /LEFT JOIN public\.ofertare_clarificari_puncte p ON p\.id = t\.punct_id/.test(CE) && /coalesce\(t\.clarificare_id, p\.clarificare_id\)/.test(CE) && /LEFT JOIN public\.cnsc_decizii d ON d\.id = t\.cnsc_decizie_id/.test(CE)
    && /RETURN jsonb_build_object\('clarificari', v_out, 'temeiuri', v_tem\);/.test(CE) && !/current_user|request\.jwt|set_config|current_setting/.test(CE) && !/[^.\w]ofertare_clarificari(_puncte|_temeiuri)?\b(?!\.)/.test(CE.replace(/public\.\w+/g, '').replace(/'[^']*'/g, '')),
    'exportul: DEFINER cu cale sigură, toate liniile de azi păstrate (gărzile modul + decizie, bucla FOR SHARE, dispecerul, revizie), poarta pe licitație între decizie și buclă cu 42501 și mesajul exact, temeiurile într-un singur SELECT (bifate + confirmate, întrebările „de_trimis”, de pe întrebări și puncte, decizia prin LEFT JOIN), răspunsul {clarificari, temeiuri}, fără identitate din GUC / current_user, numele calificate')
  // scheletul punctelor = textul 20260928l (tabel, politici, trigger) + REVOKE TRUNCATE (20260930i); temeiurile = textul 20261014b (tabel + trigger)
  const t0928 = citeste('supabase/migrations/20260928l_ofertare_clarificari_puncte_r05.sql')
  const corpTbl = t => t.slice(t.indexOf('CREATE TABLE public.ofertare_clarificari_puncte ('), t.indexOf('FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza();') + 'FOR EACH ROW EXECUTE FUNCTION public.fn_clar_punct_semneaza();'.length)
  ok(corpTbl(SCHELET_P) === corpTbl(t0928) && /REVOKE TRUNCATE ON public\.ofertare_clarificari_puncte FROM anon, authenticated;/.test(SCHELET_P), 'scheletul punctelor = textul EXACT din 20260928l + REVOKE TRUNCATE (20260930i)')
  const t1014 = citeste('supabase/migrations/20261014b_ofertare_clarificari_temeiuri.sql')
  const corpTem = t => t.slice(t.indexOf('CREATE TABLE public.ofertare_clarificari_temeiuri ('), t.indexOf('CREATE UNIQUE INDEX ofertare_clarificari_temeiuri_unic'))
  const corpTrgTem = t => t.slice(t.indexOf('  v_adauga := CASE WHEN TG_OP'), t.indexOf('REVOKE EXECUTE ON FUNCTION public.fn_temei_citat_verifica()'))
  const politiciTem = t => t.slice(t.indexOf('ALTER TABLE public.ofertare_clarificari_temeiuri ENABLE ROW LEVEL SECURITY;'), t.indexOf('GRANT USAGE, SELECT ON SEQUENCE public.ofertare_clarificari_temeiuri_id_seq TO authenticated, service_role;'))
  ok(corpTem(SCHELET_P) === corpTem(t1014) && corpTrgTem(SCHELET_P).replace(/\n\s*--[^\n]*/g, '') === corpTrgTem(t1014).replace(/\n\s*--[^\n]*/g, '') && politiciTem(SCHELET_P).replace(/\n--[^\n]*/g, '') === politiciTem(t1014).replace(/\n--[^\n]*/g, ''),
    'scheletul temeiurilor = textul EXACT din 20261014b (tabelul cu CHECK-urile, corpul triggerului fn_temei_citat_verifica, RLS + politicile + drepturile)')
  // blocurile POLITICI / FUNCTII / FOTOGRAFIE: identice între migrare și revenire (încrucișat / același text)
  const blocFn = t => bloc(t, 'FUNCTII 20270115a').split('\n').filter(l => !/RAISE EXCEPTION/.test(l)).join('\n')
  ok(bloc(MIG, 'POLITICI PUNCTE 27.11.2026') === bloc(REV, 'POLITICI PUNCTE 27.11.2026') && bloc(MIG, 'POLITICI PUNCTE 20270115a') === bloc(REV, 'POLITICI PUNCTE 20270115a')
    && bloc(MIG, 'POLITICI PUNCTE 27.11.2026').includes(`'clar_puncte_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'`) && bloc(MIG, 'POLITICI PUNCTE 20270115a').includes(`'clar_puncte_rw', '*|permisiva|{authenticated}|${POARTA}|${POARTA}'`)
    && MIG.indexOf('-- >>> POLITICI PUNCTE 27.11.2026') < MIG.indexOf('-- >>> POLITICI PUNCTE 20270115a') && REV.indexOf('-- >>> POLITICI PUNCTE 20270115a') < REV.indexOf('-- >>> POLITICI PUNCTE 27.11.2026'),
  'blocurile POLITICI (azi / 20270115a) sunt identice în migrare și revenire și apar în ordinea bună')
  ok(blocFn(MIG).length > 1000 && blocFn(MIG) === blocFn(REV), 'blocul FUNCTII 20270115a (cele 4 funcții noi + exportul: md5, formă, drepturi) e identic în migrare și revenire (în afara prefixelor mesajelor)')
  const blocuriFoto = t => { const out = []; let i = 0; while ((i = t.indexOf('-- >>> FOTOGRAFIE 20270115a', i)) >= 0) { const j = t.indexOf('-- <<< FOTOGRAFIE 20270115a', i); out.push(t.slice(i, j).replace(/ AS ce| AS val/g, '').replace(/;\s*$/, '').trim()); i = j + 1 } return out }
  const fm = blocuriFoto(MIG), fr = blocuriFoto(REV)
  ok(fm.length === 2 && fr.length === 2 && new Set([...fm, ...fr]).size === 1 && (fm[0].match(/\n\s*SELECT '/g) || []).length === 16 && (fm[0].match(/UNION ALL/g) || []).length === 15,
    'blocul FOTOGRAFIE 20270115a (16 rânduri: drepturi pe 4 tabele, triggere, politici pe 4 tabele, 5 funcții neatinse, RLS, numărul politicilor) e identic în cele 4 locuri (stare / post, migrare / revenire)')
}

console.log('1. comportamentul: înainte orice cont logat vede și oricine cu Ofertare scrie / mută / șterge, exportul = tablou; după, doar owner / responsabilii licitației, exportul = {clarificari, temeiuri} cu poartă')
{
  const db = await bazaNoua()
  STARE_VECHE = await stare(db)
  ok(eVeche(STARE_VECHE) && STARE_VECHE.puncte === 5 && STARE_VECHE.temeiuri === 6, 'scheletul: politicile de azi, funcțiile noi lipsă, triggerul părintelui lipsă, exportul de azi (INVOKER, md5 producție), 5 puncte, 6 temeiuri: ' + STARE_VECHE.functie_export.slice(0, 60))
  const inainte = {}
  for (const c of Object.keys(ASTEPTAT_DUPA)) inainte[c] = await numaraVechi(db, c)
  ok(Object.values(inainte).every(n => JSON.stringify(n) === '[5,2]'), 'ÎNAINTE: orice cont logat vede toate punctele (5 / 2), inclusiv OF, ADM, AUTO, RFM, SUB, STRAIN, NOMOD: ' + JSON.stringify(inainte.NOMOD))
  const wOf = await ca(db, 'OF', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 7, 'scris de OF inainte')`)
  const wStrain = await ca(db, 'STRAIN', `INSERT INTO public.ofertare_clarificari_puncte (clarificare_id, nr, text) VALUES (${C1}, 7, 'scris de STRAIN inainte')`)
  const mOf = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C1}`)
  const mOf5 = await ca(db, 'OF', `UPDATE public.ofertare_clarificari SET licitatie_id = ${LIC2}, nr = 97 WHERE id = ${C5}`)
  const dOf = await ca(db, 'OF', `DELETE FROM public.ofertare_clarificari WHERE id = ${C1}`)
  ok(!wOf.code && wOf.afectate === 1 && wStrain.code === '42501' && !mOf.code && mOf.afectate === 1 && !mOf5.code && mOf5.afectate === 1 && !dOf.code && dOf.afectate === 1,
    'ÎNAINTE: editorul Ofertare fără rol scrie puncte, mută (cu și fără puncte) și șterge clarificarea cu puncte (ușile din review-urile r1 / r2); alt modul = 42501')
  const eOw = await exporta(db, 'OWNER'), eAdm = await exporta(db, 'ADM'), eOf = await exporta(db, 'OF')
  ok(!eOw.code && Array.isArray(eOw.data) && eOw.data.length === 2 && !eAdm.code && Array.isArray(eAdm.data) && eAdm.data.length === 2 && eOf.code === 'P0001',
    'ÎNAINTE: exportul întoarce un TABLOU cu cele 2 întrebări „de_trimis” (fără temeiuri) și îl poate chema adminul Ofertare fără rol pe licitație (ușa din review-ul r3); editorul fără decizie nu')
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270115a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n))
    && a.note.some(n => /^20270115a: stare verificata \(2 politici pe puncte, RLS activ, exportul de azi, parintele \/ temeiurile \/ deciziile fotografiate\)$/.test(n)),
  'migrarea se aplică (pasul „înainte” real; lock din prima; fără numărători sub lock)' + (a.ok ? '' : ': ' + a.eroare))
  const s1 = await stare(db)
  ok(eNoua(s1) && s1.puncte === 5 && s1.temeiuri === 6, 'DUPĂ: cele 2 politici pe poartă, cele 4 funcții noi (corp, DEFINER / INVOKER, STABLE / VOLATILE, cale, drepturi exacte), exportul (corp nou, DEFINER, aceleași drepturi), triggerul părintelui exact, restul identic: ' + s1.triggere_parinte)
  const ab = await verifica(db)
  ok(ab.length === 0, `DUPĂ: owner 5 / responsabilii 3 pe licitația lor / restul 0; RPC-urile la fel; scrierile doar pentru owner / responsabili; garda părintelui; service_role liber; anon nimic; exportul cu poartă și temeiuri (${ab.length} abateri${ab.length ? ': ' + ab.join(' | ') : ''})`)
  ok(!a.note.some(n => /vederi peste ofertare_clarificari_puncte fara security_invoker/.test(n)), 'pe schelet nicio vedere fără security_invoker peste tabel (NOTICE-ul informativ nu apare)')
  // ciorna automată cu baza schimbată (stub-ul dispecerului): exportul refuză ca azi (textul vechi păstrat)
  await db.exec(`INSERT INTO public.ofertare_clarificari (id, licitatie_id, nr, intrebare, status, cheie) VALUES (9009, ${LIC}, 9, 'ciorna auto', 'de_trimis', 'auto_surse_blocata_x')`)
  const eAuto = await exporta(db, 'OWNER')
  await db.exec(`UPDATE public.ofertare_clarificari SET cheie = 'auto_surse_x' WHERE id = 9009`)
  const eAuto2 = await exporta(db, 'OWNER')
  await db.exec(`DELETE FROM public.ofertare_clarificari WHERE id = 9009`)
  ok(eAuto.code === 'P0001' && /Export blocat: STUB/.test(eAuto.message) && !eAuto2.code && eAuto2.data.clarificari.length === 3,
    'exportul păstrează regula ciornelor automate (dispecerul în mod tranzitie: baza schimbată = refuz, ok = intră în răspuns)')
  await db.close()
}

console.log('2. livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
// L25: lista așteptată scrisă aici, independent de fișier și de generator: 4 funcții create, exportul schimbat, triggerul creat (pe părinte), 2 politici schimbate
const ASTEPTATE = [
  'functie\tfunctie public.fn_ofertare_clar_are_puncte(bigint)\tcreat',
  'functie\tfunctie public.fn_ofertare_clar_parinte_puncte_garda()\tcreat',
  'functie\tfunctie public.fn_ofertare_clar_puncte_poarta(bigint)\tcreat',
  'functie\tfunctie public.fn_ofertare_lic_puncte_poarta(bigint)\tcreat',
  'functie\tfunctie public.ofertare_clarificari_export(bigint)\tschimbat',
  'politica\tpolitica public.ofertare_clarificari_puncte.clar_puncte_rw\tschimbat',
  'politica\tpolitica public.ofertare_clarificari_puncte.clar_puncte_sel\tschimbat',
  'trigger\ttrigger public.ofertare_clarificari.trg_ofertare_clar_parinte_puncte\tcreat',
]
async function dryRun(db, eticheta) {
  const nr = async () => (await db.query(`SELECT (SELECT count(*) FROM public.ofertare_licitatii)::int AS l, (SELECT count(*) FROM public.profiles)::int AS u,
    (SELECT count(*) FROM public.user_module_access)::int AS m, (SELECT count(*) FROM public.ofertare_clarificari)::int AS c, (SELECT count(*) FROM public.ofertare_clarificari_puncte)::int AS p,
    (SELECT count(*) FROM public.ofertare_clarificari_temeiuri)::int AS t, (SELECT count(*) FROM public.cnsc_decizii)::int AS d`)).rows[0]
  const nr0 = await nr(); const s0 = await stare(db)
  const note = []; let eroare = null
  try { await db.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroare = e.message; try { await db.exec('ROLLBACK') } catch { /* închisă */ } }
  const asteptate = ['t_politica OK', 't_fara_drept OK', 't_cu_drept OK', 't_export OK', 't_parinte OK', 't_anon OK', 'TOTUL OK']
  ok(!eroare && asteptate.every(t => note.some(n => n.startsWith('DRY 20270115a ' + t))) && note.some(n => /^DRY 20270115a t_cu_drept OK \(total puncte ca postgres: 11\)$/.test(n))
    && note.findIndex(n => n.startsWith('DRY 20270115a t_export OK')) < note.findIndex(n => n.startsWith('DRY 20270115a t_parinte OK')),
    `${eticheta}dry-run: ${asteptate.length} blocuri OK (exportul înaintea gărzii părintelui, care șterge C1); totalul din NOTICE (5 ale scheletului + 4 fixturi + 2 scrise = 11)` + (eroare ? ': ' + eroare.slice(0, 300) : ''))
  ok(JSON.stringify(await nr()) === JSON.stringify(nr0) && JSON.stringify(await stare(db)) === JSON.stringify(s0), `${eticheta}dry-run: ROLLBACK, nimic rămas (licitații, conturi, drepturi, clarificări, puncte, temeiuri, decizii; starea obiectelor)`)
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
    `# 20270115a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
  const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
  ok(JSON.stringify(fara18) === JSON.stringify(revizuit), `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}: ${fara18.join(' | ')}`)
  ok(JSON.stringify(revizuit) === JSON.stringify(ASTEPTATE), 'lista revizuită = EXACT cele 4 funcții create + exportul schimbat + triggerul creat + cele 2 politici schimbate, nimic altceva (niciun drept pe tabel)')
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
  const fFaraExport = join(TMP, 'fara_export', `${NUME}.l15.tsv`)
  mkdirSync(dirname(fFaraExport), { recursive: true })
  writeFileSync(fFaraExport, manifest.split('\n').filter(l => !/ofertare_clarificari_export/.test(l)).join('\n'))
  const ge = await livreaza(b, MIG, { aprobat: G, manifest: fFaraExport, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(!ge.ok && /AMPRENTA_GLOBALA_DUPA/.test(ge.eroare) && /NEDECLARAT/.test(ge.eroare + ge.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
    'manifest fără rândul exportului schimbat = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat')
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
  ok(/t_politica FAIL: migrarea 20270115a nu e aplicata/.test(ef || ''), 'dry-run pe baza fără 20270115a = eșec (t_politica): ' + (ef || 'TRECE').slice(0, 100))
  await fara.close(); await b.close()
}
console.log('2b. ambele ordini față de 20270113a (APLICATĂ pe producție 27.11.2026): 0113 → 0115 și 0115 → 0113')
{
  const a = await bazaNoua()
  const r1 = await livreaza0113(a); const r2 = await livreaza(a, MIG)
  ok(r1.ok && r2.ok && eNoua(await stare(a)), '0113 → 0115: ambele se aplică; politicile noi' + (r1.ok ? '' : ': 0113 ' + r1.eroare) + (r2.ok ? '' : ': 0115 ' + r2.eroare))
  const ab = await verifica(a)
  ok(ab.length === 0, `0113 → 0115: comportamentul așteptat și cu citirea clarificărilor restrânsă la modul (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
  await dryRun(a, '0113 → 0115: ')
  await a.close()
  const b = await bazaNoua()
  const r3 = await livreaza(b, MIG); const r4 = await livreaza0113(b)
  ok(r3.ok && r4.ok && eNoua(await stare(b)), '0115 → 0113: ambele se aplică; politicile noi rămân' + (r3.ok ? '' : ': 0115 ' + r3.eroare) + (r4.ok ? '' : ': 0113 ' + r4.eroare))
  const ab2 = await verifica(b)
  ok(ab2.length === 0, `0115 → 0113: comportamentul așteptat (${ab2.length} abateri${ab2.length ? ': ' + ab2[0] : ''})`)
  await b.close()
}

console.log('3. refuzurile migrării (pe bază nouă, nimic schimbat)')
const FN_ACCES_TRUE = `CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const FN_CHELT_TRUE = `CREATE OR REPLACE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const EXPORT_ALTFEL = `CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN '[]'::jsonb; END $f$`
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
  ['exportul cu alt corp (schimbat între timp: revenirea n-ar mai readuce textul de azi)', {}, /ofertare_clarificari_export\(bigint\) nu e cea de azi \(corp md5 328b25f3431c5fc51a016d5ef359e453/, EXPORT_ALTFEL],
  ['exportul deja SECURITY DEFINER', {}, /ofertare_clarificari_export\(bigint\) nu e cea de azi/, 'ALTER FUNCTION public.ofertare_clarificari_export(bigint) SECURITY DEFINER'],
  ['exportul cu EXECUTE pentru anon', {}, /ofertare_clarificari_export\(bigint\) nu e cea de azi/, 'GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) TO anon'],
  ['exportul fără EXECUTE pentru authenticated', {}, /ofertare_clarificari_export\(bigint\) nu e cea de azi/, 'REVOKE EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) FROM authenticated'],
  ['fn_ofertare_source_pack_poate_decide fără EXECUTE pentru authenticated (exportul o cheamă)', {}, /lipsesc fn_ofertare_source_pack_poate_decide/, 'REVOKE EXECUTE ON FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) FROM authenticated'],
  ['dispecerul ciornelor lipsă (exportul îl cheamă)', {}, /lipsesc fn_ofertare_source_pack_poate_decide\(bigint\) .* sau fn_ofertare_ciorna_auto_stare/, 'DROP FUNCTION public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text)'],
  ['temeiurile fără coloana citat_loc (exportul o întoarce)', {}, /lipsesc public\.ofertare_clarificari_temeiuri/, `ALTER TABLE ${TT} DROP COLUMN citat_loc`],
  ['deciziile CNSC cu verificat de alt tip', {}, /lipsesc public\.ofertare_clarificari_temeiuri .* sau public\.cnsc_decizii/, `ALTER TABLE ${TD} ALTER COLUMN verificat TYPE text`],
  ['o funcție cu același nume (altă semnătură) există deja', {}, /exista deja \(reaplicare sau coliziune de nume\)/, 'CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$'],
  ['poarta pe licitație există deja (alt corp)', {}, /exista deja \(reaplicare sau coliziune de nume\)/, 'CREATE FUNCTION public.fn_ofertare_lic_puncte_poarta(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$'],
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
  const eOw = await exporta(db, 'OWNER'), eAdm = await exporta(db, 'ADM')
  ok(v.ok && eVeche(s2) && s2.functie_export === STARE_VECHE.functie_export && JSON.stringify(await numaraVechi(db, 'NOMOD')) === '[5,2]' && !dOf.code && dOf.afectate === 1
    && !eOw.code && Array.isArray(eOw.data) && eOw.data.length === 2 && !eAdm.code && Array.isArray(eAdm.data),
    'revenirea: politicile de azi EXACT, exportul de azi EXACT (corp, INVOKER, drepturi — identic cu starea de dinainte), funcțiile și triggerul șterse, nimic altceva atins; orice cont logat vede iar, editorul șterge iar clarificarea cu puncte, exportul redevine tablou și îl poate chema adminul' + (v.ok ? '' : ': ' + v.eroare))
  const v2 = await revino(db)
  ok(!v2.ok && /starea nu e cea din 20270115a \(politicile ofertare_clarificari_puncte\): clar_puncte_rw: .*; clar_puncte_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 160))
  const a2 = await livreaza(db, MIG)
  ok(a2.ok && eNoua(await stare(db)) && (await verifica(db)).length === 0, 're-aplicarea după revenire + verificările' + (a2.ok ? '' : ': ' + a2.eroare))
  await db.close()
}
// deriva după livrare: revenirea refuză cu câmpul numit, nimic schimbat
const FN_NOU_TRUE = `CREATE OR REPLACE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const FN_LIC_TRUE = `CREATE OR REPLACE FUNCTION public.fn_ofertare_lic_puncte_poarta(p_licitatie_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`
const EXPORT_NOU_ALTFEL = `CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$`
for (const [nume, pregatire, re] of [
  ['politica SELECT schimbată altfel', `ALTER POLICY clar_puncte_sel ON ${T} USING (true)`, /\(politicile ofertare_clarificari_puncte\): clar_puncte_sel: r\|permisiva\|\{authenticated\}\|true\|-/],
  ['o politică în plus (dependentă de funcție)', `CREATE POLICY zz_sel ON ${T} FOR SELECT TO anon USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id))`, /\(politicile ofertare_clarificari_puncte\): \+zz_sel/],
  ['funcția nouă cu alt corp', FN_NOU_TRUE, /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270115a/],
  ['poarta pe licitație cu alt corp', FN_LIC_TRUE, /fn_ofertare_lic_puncte_poarta\(bigint\) nu e cea din 20270115a/],
  ['funcția nouă cu EXECUTE pentru anon', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO anon', /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270115a .*drepturi exacte/],
  ['funcția nouă fără EXECUTE pentru authenticated', 'REVOKE EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM authenticated', /fn_ofertare_clar_puncte_poarta\(bigint\) nu e cea din 20270115a .*drepturi exacte/],
  ['garda cu EXECUTE pentru authenticated', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() TO authenticated', /fn_ofertare_clar_parinte_puncte_garda\(\) nu e cea din 20270115a/],
  ['garda SECURITY DEFINER', 'ALTER FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() SECURITY DEFINER', /fn_ofertare_clar_parinte_puncte_garda\(\) nu e cea din 20270115a/],
  ['exportul schimbat după migrare (alt corp)', EXPORT_NOU_ALTFEL, /ofertare_clarificari_export\(bigint\) nu e cea din 20270115a/],
  ['exportul readus INVOKER de altcineva', 'ALTER FUNCTION public.ofertare_clarificari_export(bigint) SECURITY INVOKER', /ofertare_clarificari_export\(bigint\) nu e cea din 20270115a/],
  ['exportul cu EXECUTE pentru anon', 'GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) TO anon', /ofertare_clarificari_export\(bigint\) nu e cea din 20270115a .*drepturile de azi exacte/],
  ['triggerul dezactivat', `ALTER TABLE ${TP} DISABLE TRIGGER trg_ofertare_clar_parinte_puncte`, /triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270115a/],
  ['triggerul lipsă', `DROP TRIGGER trg_ofertare_clar_parinte_puncte ON ${TP}`, /triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270115a/],
  ['alt obiect construit pe funcție (politică pe alt tabel)', `CREATE POLICY zz_alt ON ${TP} FOR SELECT TO authenticated USING (public.fn_ofertare_clar_puncte_poarta(id))`, /depind si alte obiecte \(nu doar cele 2 politici si triggerul\): pg_policy:\d+/],
  ['alt obiect construit pe poarta pe licitație (politică pe temeiuri)', `CREATE POLICY zz_alt ON ${TT} FOR SELECT TO authenticated USING (public.fn_ofertare_lic_puncte_poarta(1))`, /depind si alte obiecte .*: pg_policy:\d+/],
  ['alt trigger pe garda', `CREATE TRIGGER zz_trg BEFORE DELETE ON ${T} FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()`, /depind si alte obiecte .*: pg_trigger:\d+/],
  ['un apelant cu corp text (nu e în pg_depend) care cheamă poarta', `CREATE FUNCTION public.zz_apelant(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_clar_puncte_poarta(p) $f$`, /alte functii numesc in corp functiile 20270115a .*: zz_apelant\(bigint\)/],
  ['un apelant care cheamă poarta pe licitație', `CREATE FUNCTION public.zz_apelant_lic(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_lic_puncte_poarta(p) $f$`, /alte functii numesc in corp functiile 20270115a .*: zz_apelant_lic\(bigint\)/],
  ['un apelant plpgsql care cheamă are_puncte', `CREATE FUNCTION public.zz_apelant2() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.fn_ofertare_clar_are_puncte(1); END $f$`, /alte functii numesc in corp functiile 20270115a .*: zz_apelant2\(\)/],
  // r2 P2: o OMONIMĂ din altă schemă e un apelant ca oricare (excluderea e pe OID, nu pe nume); numele scrise cu majuscule sunt prinse (ILIKE)
  ['o omonimă din altă schemă care cheamă poarta', `CREATE SCHEMA zz_alta; CREATE FUNCTION zz_alta.fn_ofertare_clar_are_puncte(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_clar_puncte_poarta(p) $f$`, /alte functii numesc in corp functiile 20270115a .*: zz_alta\.fn_ofertare_clar_are_puncte\(bigint\)/],
  ['un apelant care scrie numele cu majuscule', `CREATE FUNCTION public.zz_apelant3(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.FN_OFERTARE_CLAR_PUNCTE_POARTA(p) $f$`, /alte functii numesc in corp functiile 20270115a .*: zz_apelant3\(bigint\)/],
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
const CORP = corp(MIG, SIG_POARTA), CORP_L = corp(MIG, SIG_LIC), CORP_G = corp(MIG, SIG_GARDA), CORP_E = corp(MIG, SIG_EXPORT, '$function$')
const POARTA_EXPORT = `  IF NOT coalesce(public.fn_ofertare_lic_puncte_poarta(p_licitatie_id), false) THEN\n    RAISE EXCEPTION '${MSG_POARTA_EXPORT}' USING ERRCODE = '42501';\n  END IF;\n`
const MUTANTI = [
  ['M1 fără ALTER POLICY pe SELECT (orice cont logat citește în continuare)', [[ALTER_SEL, '']]],
  ['M2 fără ALTER POLICY pe ALL (editorul Ofertare citește și scrie în continuare, prin OR)', [[ALTER_RW, '']]],
  ['M3 poarta pe licitație fără verificarea modulului (responsabilul fără modul vede)', [[CORP_L, CORP_L.replace('     AND public.fn_are_acces_ofertare()\n', '')]]],
  ['M4 OR în loc de AND (modulul singur ajunge)', [[CORP_L, CORP_L.replace('     AND public.fn_ofertare_poate_cheltui', '     OR public.fn_ofertare_poate_cheltui')]]],
  ['M5 doar owner-ul (responsabilii nu mai văd)', [[CORP_L, '\n  SELECT auth.uid() IS NOT NULL AND coalesce((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = auth.uid()), false);\n']]],
  ['M6 dreptul de decizie în loc de poarta pe cheltuială (adminul Ofertare vede și exportă)', [[CORP_L, '\n  SELECT auth.uid() IS NOT NULL AND coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false);\n']]],
  ['M7 clarificare inexistentă = true (fallback-ul fail-open)', [[CORP, CORP.replace('), false);', '), true);')]]],
  ['M8 ALL doar cu USING (WITH CHECK rămâne pe modul: editorul scrie)', [[ALTER_RW, `ALTER POLICY clar_puncte_rw ON ${T} USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));`]]],
  ['M9 fără triggerul părintelui (editorul mută / șterge clarificarea cu puncte)', [[CREATE_TRG, '']]],
  ['M10 garda doar pe DELETE (mutarea rămâne liberă)', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE OF licitatie_id OR DELETE', 'BEFORE DELETE')]]],
  ['M11 garda doar pe UPDATE (ștergerea rămâne liberă)', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE OF licitatie_id OR DELETE', 'BEFORE UPDATE OF licitatie_id')]]],
  ['M12 garda fără poartă la ștergere (orice client cu modul șterge clarificarea cu puncte)', [[CORP_G, CORP_G.replace("  IF NOT coalesce(public.fn_ofertare_clar_puncte_poarta(OLD.id), false) THEN\n    RAISE EXCEPTION 'Clarificarea are puncte: o sterge doar ownerul sau un responsabil al licitatiei (stergerea ar sterge si punctele).' USING ERRCODE = '42501';\n  END IF;\n", '')]]],
  ['M13 garda și pentru service_role (serverul blocat)', [[CORP_G, CORP_G.replace("IF current_user NOT IN ('authenticated', 'anon') THEN", "IF current_user NOT IN ('authenticated', 'anon', 'service_role') THEN")]]],
  ['M14 garda la ștergere pe toate clarificările, nu doar pe cele cu puncte (editorul nu mai șterge clarificarea fără puncte)', [[CORP_G, CORP_G.replace('  IF NOT public.fn_ofertare_clar_are_puncte(OLD.id) THEN RETURN OLD; END IF;\n', '')]]],
  ['M15 mutarea permisă când clarificarea n-are (încă) puncte — forma r2, cu cursa (editorul mută C5)', [[CORP_G, CORP_G.replace('IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id THEN', 'IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id AND public.fn_ofertare_clar_are_puncte(OLD.id) THEN')]]],
  ['M16 mutarea permisă pentru cine trece poarta (ownerul / responsabilul mută)', [[CORP_G, CORP_G.replace('IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id THEN', 'IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id AND NOT coalesce(public.fn_ofertare_clar_puncte_poarta(OLD.id), false) THEN')]]],
  // varianta B: exportul
  ['M17 exportul fără poarta punctelor (adminul Ofertare / autonumitul exportă — forma de azi)', [[CORP_E, CORP_E.replace(POARTA_EXPORT, '')]]],
  ['M18 exportul cu poarta pe clarificare în loc de licitație doar pe întrebările exportate (fără întrebări „de_trimis” poarta nu se mai verifică)', [[CORP_E, CORP_E.replace(POARTA_EXPORT, '').replace("    v_out := v_out || jsonb_build_array(to_jsonb(c));\n", "    IF NOT coalesce(public.fn_ofertare_clar_puncte_poarta(c.id), false) THEN RAISE EXCEPTION '" + MSG_POARTA_EXPORT + "' USING ERRCODE = '42501'; END IF;\n    v_out := v_out || jsonb_build_array(to_jsonb(c));\n")]]],
  ['M19 temeiurile doar de pe întrebări (cele de pe puncte lipsesc din răspuns — exact adresa incompletă din r3)', [[CORP_E, CORP_E.replace('JOIN public.ofertare_clarificari q ON q.id = coalesce(t.clarificare_id, p.clarificare_id)', 'JOIN public.ofertare_clarificari q ON q.id = t.clarificare_id')]]],
  ['M20 temeiurile fără filtrul „include în adresă” (un temei nebifat iese în adresă)', [[CORP_E, CORP_E.replace('AND t.include_in_adresa AND t.confirmat', 'AND t.confirmat')]]],
  ['M21 temeiurile de pe toate întrebările, nu doar de pe cele „de_trimis” (C4 „propunere” iese)', [[CORP_E, CORP_E.replace("WHERE q.licitatie_id = p_licitatie_id AND q.status = 'de_trimis' AND", 'WHERE q.licitatie_id = p_licitatie_id AND')]]],
  ['M22 răspunsul rămâne tablou (UI-ul vechi ar exporta fără temeiurile de pe puncte)', [[CORP_E, CORP_E.replace("  RETURN jsonb_build_object('clarificari', v_out, 'temeiuri', v_tem);", '  RETURN v_out;')]]],
  ['M23 decizia doar cu id (fără câmpurile citării: UI-ul n-ar putea forma referința)', [[CORP_E, CORP_E.replace("ELSE jsonb_build_object('id', d.id, 'nr_decizie', d.nr_decizie, 'buletin_oficial', d.buletin_oficial, 'data', d.data,\n                                                                            'link_sursa', d.link_sursa, 'control_judiciar', d.control_judiciar, 'verificat', d.verificat) END", "ELSE jsonb_build_object('id', d.id, 'verificat', d.verificat) END")]]],
  ['M24 temeiurile pe altă licitație (filtrul pe p_licitatie_id scos: T5 de pe LIC2 iese în adresa LIC)', [[CORP_E, CORP_E.replace("WHERE q.licitatie_id = p_licitatie_id AND q.status = 'de_trimis'", "WHERE q.status = 'de_trimis'")]]],
  ['M25 poarta exportului cu alt cod de eroare (UI-ul n-ar recunoaște refuzul)', [[CORP_E, CORP_E.replace("' USING ERRCODE = '42501';\n  END IF;\n  FOR c IN", "';\n  END IF;\n  FOR c IN")]]],
]
for (const [nume, inl] of MUTANTI) {
  let ab
  try { ab = await comport(FARA_POST(aplica(MIG, inl))) } catch (e) { ab = ['excepție: ' + e.message] }
  ok(ab.length > 0 && !/^aplicare: /.test(ab[0]), `${nume} pică comportamental (${ab[0] || 'NU a picat'})`)
}
console.log('   structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat)')
const ANTET_EXPORT = 'RETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $function$'
for (const [nume, inl, re] of [
  ['S1 fără ALTER POLICY pe SELECT', MUTANTI[0][1], /postconditie: politicile ofertare_clarificari_puncte: clar_puncte_sel: r\|permisiva\|\{authenticated\}\|\(auth\.uid\(\) IS NOT NULL\)\|-/],
  ['S2 fără ALTER POLICY pe ALL', MUTANTI[1][1], /postconditie: politicile ofertare_clarificari_puncte: clar_puncte_rw: \*\|permisiva/],
  ['S3 poarta pe licitație cu alt corp', MUTANTI[2][1], /postconditie: fn_ofertare_lic_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S3b poarta pe clarificare cu alt corp', MUTANTI[6][1], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S4 poarta SECURITY INVOKER', [['STABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$\n  SELECT coalesce((SELECT public.fn_ofertare_lic_puncte_poarta', 'STABLE\nSET search_path = public, pg_temp\nAS $fn$\n  SELECT coalesce((SELECT public.fn_ofertare_lic_puncte_poarta']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S5 poarta fără REVOKE de la PUBLIC / anon', [['REVOKE ALL ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM PUBLIC, anon;\n', '']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S6 poarta cu GRANT și pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role, anon;']], /postconditie: fn_ofertare_clar_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S6b poarta pe licitație cu GRANT și pentru anon', [['GRANT EXECUTE ON FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint) TO authenticated, service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_lic_puncte_poarta(bigint) TO authenticated, service_role, anon;']], /postconditie: fn_ofertare_lic_puncte_poarta\(bigint\) nu are forma asteptata/],
  ['S7 garda SECURITY DEFINER', [['LANGUAGE plpgsql\nSET search_path = public, pg_temp\nAS $fn$\nBEGIN', 'LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$\nBEGIN']], /postconditie: fn_ofertare_clar_parinte_puncte_garda\(\) nu are forma asteptata/],
  ['S8 garda executabilă de authenticated', [['REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, service_role;']], /postconditie: fn_ofertare_clar_parinte_puncte_garda\(\) nu are forma asteptata/],
  ['S9 fără trigger', MUTANTI[8][1], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S10 trigger doar pe DELETE', MUTANTI[9][1], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S11 trigger AFTER', [[CREATE_TRG, CREATE_TRG.replace('BEFORE UPDATE', 'AFTER UPDATE')]], /postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata/],
  ['S12 REVOKE în plus pe tabelul de puncte', [[ALTER_RW, ALTER_RW + `\nREVOKE DELETE ON ${T} FROM authenticated;`]], /s-a schimbat altceva decat .*: acl_tabel \(era .*, acum /],
  ['S13 REVOKE în plus pe părinte', [[ALTER_RW, ALTER_RW + `\nREVOKE DELETE ON ${TP} FROM authenticated;`]], /s-a schimbat altceva decat .*: acl_parinte \(era .*, acum /],
  ['S13b GRANT în plus pe temeiuri', [[ALTER_RW, ALTER_RW + `\nGRANT SELECT ON ${TT} TO anon;`]], /s-a schimbat altceva decat .*: acl_temeiuri \(era .*, acum /],
  ['S13c politica deciziilor CNSC schimbată', [[ALTER_RW, ALTER_RW + `\nALTER POLICY cnsc_decizii_select ON ${TD} USING (true);`]], /s-a schimbat altceva decat .*: politici_cnsc \(era .*, acum /],
  ['S14 triggerul de semnare dezactivat', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${T} DISABLE TRIGGER trg_clar_punct_semneaza;`]], /s-a schimbat altceva decat .*: triggere \(era /],
  ['S15 un trigger existent al părintelui dezactivat', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${TP} DISABLE TRIGGER USER;\nALTER TABLE ${TP} ENABLE TRIGGER trg_ofertare_clar_parinte_puncte;`]], /s-a schimbat altceva decat .*: triggere_parinte \(era /],
  ['S16 politica părintelui schimbată', [[ALTER_RW, ALTER_RW + `\nALTER POLICY clar_all_sel ON ${TP} USING (true);`]], /s-a schimbat altceva decat .*: politici_parinte \(era /],
  ['S17 GRANT în plus pe fn_ofertare_poate_cheltui', [[ALTER_RW, ALTER_RW + '\nGRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO authenticated;']], /s-a schimbat altceva decat .*: functie_cheltuiala \(era /],
  ['S17b dreptul de decizie schimbat', [[ALTER_RW, ALTER_RW + '\nALTER FUNCTION public.fn_ofertare_source_pack_poate_decide(bigint) SECURITY INVOKER;']], /s-a schimbat altceva decat .*: functie_decide \(era /],
  ['S18 o politică în plus pe puncte', [[ALTER_RW, ALTER_RW + `\nCREATE POLICY zz_sel ON ${T} FOR SELECT TO anon USING (true);`]], /postconditie: politicile ofertare_clarificari_puncte: \+zz_sel: r\|permisiva\|\{anon\}\|true\|-/],
  ['S19 RLS oprit după ALTER', [[ALTER_RW, ALTER_RW + `\nALTER TABLE ${T} DISABLE ROW LEVEL SECURITY;`]], /s-a schimbat altceva decat .*: rls \(era true\|false\|true\|false\|true\|false\|true\|false, acum false\|false\|true\|false\|true\|false\|true\|false\)/],
  ['S20 exportul SECURITY INVOKER (citirile ar depinde iar de RLS-ul apelantului)', [[ANTET_EXPORT, ANTET_EXPORT.replace('SECURITY DEFINER\n', '')]], /postconditie: ofertare_clarificari_export\(bigint\) nu are forma asteptata/],
  ['S21 exportul cu GRANT pentru anon', [[ALTER_RW, ALTER_RW + '\nGRANT EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) TO anon;']], /postconditie: ofertare_clarificari_export\(bigint\) nu are forma asteptata/],
  ['S22 exportul fără EXECUTE pentru authenticated', [[ALTER_RW, ALTER_RW + '\nREVOKE EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) FROM authenticated;']], /postconditie: ofertare_clarificari_export\(bigint\) nu are forma asteptata/],
  ['S23 exportul cu alt corp (poarta scoasă)', MUTANTI[16][1], /postconditie: ofertare_clarificari_export\(bigint\) nu are forma asteptata/],
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
  exportDeriva: async (db, t) => { await db.exec(EXPORT_ALTFEL); return livreaza(db, t) },
  temeiuriFaraColoana: async (db, t) => { await db.exec(`ALTER TABLE ${TT} DROP COLUMN citat_loc`); return livreaza(db, t) },
  rlsOprit: async (db, t) => { await db.exec(`ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`); return livreaza(db, t) },
  fkLipsa: async (db, t) => { await db.exec(`ALTER TABLE ${T} DROP CONSTRAINT ofertare_clarificari_puncte_clarificare_id_fkey`); return livreaza(db, t) },
  // (garda „numele e liber” din $pre$ nu are scenariu propriu: fără ea, o supraîncărcare preexistentă e prinsă oricum de postcondiția „unică” — vezi
  //  refuzul din secțiunea 3; garda din $pre$ dă doar mesajul clar înaintea oricărei scrieri)
  revSelAltfel: async (db, t) => { await livreaza(db, MIG); await db.exec(`ALTER POLICY clar_puncte_sel ON ${T} USING (true)`); return revino(db, t) },
  revFnDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_NOU_TRUE); return revino(db, t) },
  revLicDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_LIC_TRUE); return revino(db, t) },
  revGardaDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec('ALTER FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() SECURITY DEFINER'); return revino(db, t) },
  revExportDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(EXPORT_NOU_ALTFEL); return revino(db, t) },
  revTrgDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(`ALTER TABLE ${TP} DISABLE TRIGGER trg_ofertare_clar_parinte_puncte`); return revino(db, t) },
  revApelant: async (db, t) => { await livreaza(db, MIG); await db.exec('CREATE FUNCTION public.zz_apelant(p bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT public.fn_ofertare_clar_puncte_poarta(p) $f$'); return revino(db, t) },
  revAccesDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_ACCES_TRUE); return revino(db, t) },
  revCheltDeriva: async (db, t) => { await livreaza(db, MIG); await db.exec(FN_CHELT_TRUE); return revino(db, t) },
}
for (const [nume, fisier, inl, scenariu] of [
  ['P1 migrare: fără verificarea exactă a politicilor', 'mig', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: politicile ofertare_clarificari_puncte difera de cele de azi (27.11.2026): %', v_rau; END IF;\n", '']], 'selAltfel'],
  ['P2 migrare: fără verificarea fn_are_acces_ofertare', 'mig', [["    RAISE EXCEPTION '20270115a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'accesDeriva'],
  ['P3 migrare: fără verificarea fn_ofertare_poate_cheltui', 'mig', [["    RAISE EXCEPTION '20270115a: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'cheltDeriva'],
  ['P4 migrare: fără verificarea RLS', 'mig', [["    RAISE EXCEPTION '20270115a: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';\n", '    NULL;\n']], 'rlsOprit'],
  ['P5 migrare: fără verificarea FK-ului', 'mig', [["    RAISE EXCEPTION '20270115a: lipseste FK-ul ofertare_clarificari_puncte.clarificare_id -> ofertare_clarificari(id)';\n", '    NULL;\n']], 'fkLipsa'],
  ['P6 migrare: fără verificarea exportului de azi (un export schimbat ar fi suprascris, iar revenirea n-ar readuce textul lui)', 'mig', [["    RAISE EXCEPTION '20270115a: ofertare_clarificari_export(bigint) nu e cea de azi (corp md5 328b25f3431c5fc51a016d5ef359e453 din 20270112a, plpgsql VOLATILE INVOKER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';\n", '    NULL;\n']], 'exportDeriva'],
  ['P7 migrare: fără verificarea coloanelor temeiurilor / deciziilor', 'mig', [["    RAISE EXCEPTION '20270115a: lipsesc public.ofertare_clarificari_temeiuri (id, clarificare_id, punct_id, cnsc_decizie_id, citat_idx, citat_text, citat_loc, include_in_adresa, confirmat) sau public.cnsc_decizii (id, nr_decizie, buletin_oficial, data, link_sursa, control_judiciar, verificat) — exportul le citeste';\n", '    NULL;\n']], 'temeiuriFaraColoana'],
  ['R1 revenire: fără verificarea exactă a politicilor (după migrare, politica SELECT schimbată altfel)', 'rev', [["  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: starea nu e cea din 20270115a (politicile ofertare_clarificari_puncte): %', v_rau; END IF;\n", '']], 'revSelAltfel'],
  ['R2 revenire: fără verificarea porții pe clarificare', 'rev', [["    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_puncte_poarta(bigint) nu e cea din 20270115a (corp md5 " + MD5_NOU + ", sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revFnDeriva'],
  ['R2b revenire: fără verificarea porții pe licitație', 'rev', [["    RAISE EXCEPTION '20270115a revenire: fn_ofertare_lic_puncte_poarta(bigint) nu e cea din 20270115a (corp md5 " + MD5_LIC + ", sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revLicDeriva'],
  ['R3 revenire: fără verificarea gărzii', 'rev', [["    RAISE EXCEPTION '20270115a revenire: fn_ofertare_clar_parinte_puncte_garda() nu e cea din 20270115a (corp md5 " + MD5_GARDA + ", plpgsql VOLATILE INVOKER, cale, proprietar, doar proprietarul executa, unica)';\n", '    NULL;\n']], 'revGardaDeriva'],
  ['R3b revenire: fără verificarea exportului (un export schimbat după migrare ar fi suprascris tăcut cu textul de azi)', 'rev', [["    RAISE EXCEPTION '20270115a revenire: ofertare_clarificari_export(bigint) nu e cea din 20270115a (corp md5 " + MD5_EXPORT_NOU + ", plpgsql VOLATILE DEFINER, cale, proprietar, drepturile de azi exacte, unica)';\n", '    NULL;\n']], 'revExportDeriva'],
  ['R4 revenire: fără verificarea triggerului', 'rev', [["    RAISE EXCEPTION '20270115a revenire: triggerul trg_ofertare_clar_parinte_puncte nu e cel din 20270115a (BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW, garda, fara WHEN / argumente, activ)';\n", '    NULL;\n']], 'revTrgDeriva'],
  ['R5 revenire: fără scanarea apelanților din corpuri', 'rev', [["  IF v_dep IS NOT NULL THEN RAISE EXCEPTION '20270115a revenire: alte functii numesc in corp functiile 20270115a (apelanti neinregistrati in pg_depend): %', v_dep; END IF;\n", '']], 'revApelant'],
  ['R6 revenire: fără verificarea fn_are_acces_ofertare', 'rev', [["    RAISE EXCEPTION '20270115a revenire: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revAccesDeriva'],
  ['R7 revenire: fără verificarea fn_ofertare_poate_cheltui', 'rev', [["    RAISE EXCEPTION '20270115a revenire: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari)';\n", '    NULL;\n']], 'revCheltDeriva'],
]) {
  const orig = fisier === 'mig' ? MIG : REV
  let ro, rm
  try { ro = await rezultat(SCEN[scenariu], orig); rm = await rezultat(SCEN[scenariu], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
  ok(ro !== rm && /^REFUZ/.test(ro) && /^APLICAT/.test(rm), `${nume} prins: original «${ro.slice(0, 80)}» / mutant «${rm.slice(0, 80)}»`)
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
