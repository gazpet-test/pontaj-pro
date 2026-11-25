// Proba LOCALĂ a migrării 20270112a (Ofertare: cantități între documente, TKT-2026-0329 A) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20270112a_ofertare_cantitati_masuratori_schelet.sql (tabelele reale citite / modificate + corpurile EXACTE
//   ale circuitului R9b în ultima formă din repo). Migrarea rulează ca runnerul: plafonul 5000 (sesiune) + marcajele prologului + PAȘII REALI
//   L15 v2 (scripts/livrare_amprenta_gen.sh) + garda finală reală (lm_fin din scripts/livrare_mesaj.sh); revenirea cu plafonul 2000, fără AG.
// Secțiuni (--sectiune t1,t2,…; implicit toate): t1 liste / tabele / RLS / UNIQUE nr; t2 clasificare, număr, dovezi; t3 fotografie, propune,
//   publică; t4 circuitul auto_surse_*; t5 livrarea L15 v2 (manifest, refuzuri, revenire, dry-run) + mutanți.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs
//   (--scrie-obiecte rescrie lista revizuită L15 din manifestul generat)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'cm_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex')
const NUME = '20270112a_ofertare_cantitati_masuratori', NUME_REV = NUME + '_ROLLBACK'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME_REV}.sql`
const F_DRY = `supabase/tests/${NUME}_dryrun.sql`, F_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const F_SCHELET = `supabase/tests/${NUME}_schelet.sql`
const MIG = existsSync(join(ROOT, F_MIG)) ? citeste(F_MIG) : ''
const REV = existsSync(join(ROOT, F_REV)) ? citeste(F_REV) : ''
const DRY = existsSync(join(ROOT, F_DRY)) ? citeste(F_DRY) : ''
const SCHELET = citeste(F_SCHELET)
const SECTIUNI = (process.argv.find(a => a.startsWith('--sectiune=')) || '--sectiune=t1,t2,t3,t4,t5').slice('--sectiune='.length).split(',')
const vrea = s => SECTIUNI.includes(s)

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
const corp = (text, fn) => {
  const m = new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(').exec(text)
  if (!m) throw new Error('nu găsesc ' + fn)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(m.index)); const start = m.index + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}
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

// ── conturile (sintetice) ──
const U = {
  OWNER: '00000000-0000-4000-8000-0000000000d1', OF: '00000000-0000-4000-8000-0000000000d2', RESP: '00000000-0000-4000-8000-0000000000d3',
  STRAIN: '00000000-0000-4000-8000-0000000000d4', ADM: '00000000-0000-4000-8000-0000000000d5',
}
const LIC = 900001, LIC2 = 900002, LIC_LOT = 900003
async function bazaNoua() {
  const db = await PGlite.create()
  await db.exec(SCHELET)
  await db.exec(`
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.OF}', 'OF', false), ('${U.RESP}', 'RESP', false),
  ('${U.STRAIN}', 'STRAIN', false), ('${U.ADM}', 'ADM', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.OF}', 'ofertare', 'editor'), ('${U.RESP}', 'ofertare', 'editor'),
  ('${U.ADM}', 'ofertare', 'admin'), ('${U.STRAIN}', 'logistica', 'admin');
INSERT INTO public.ofertare_licitatii (id, nr_anunt, obiect, responsabil_id, stare_loturi) VALUES
  (${LIC}, 'T-1', 'licitatie de test', '${U.RESP}', 'fara_loturi'), (${LIC2}, 'T-2', 'alta licitatie', NULL, 'fara_loturi'),
  (${LIC_LOT}, 'T-3', 'licitatie cu loturi', '${U.RESP}', 'are_loturi');
INSERT INTO public.ofertare_licitatie_loturi (licitatie_id, nr, denumire) VALUES (${LIC_LOT}, 1, 'lot 1'), (${LIC_LOT}, 2, 'lot 2');
INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd) VALUES (${LIC}, 'cant_extragere', 10), (${LIC2}, 'cant_extragere', 10), (${LIC_LOT}, 'cant_extragere', 10);
INSERT INTO public.ofertare_ai_cereri (licitatie_id, lot_domeniu, scop, aprobat_de, valabil_pana) VALUES
  (${LIC}, 'toate', 'cant_extragere', '${U.OWNER}', now() + interval '1 day'), (${LIC2}, 'toate', 'cant_extragere', '${U.OWNER}', now() + interval '1 day'),
  (${LIC_LOT}, 'toate', 'cant_extragere', '${U.OWNER}', now() + interval '1 day');`)
  return db
}

// Livrarea migrării ca runnerul (tiparul 20270111a): plafonul de sesiune ÎNAINTE de BEGIN, marcajele prologului, pasul „înainte” REAL
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
async function bazaAplicata() {
  const db = await bazaNoua()
  const a = await livreaza(db, MIG)
  if (!a.ok) throw new Error('aplicarea migrarii a picat: ' + a.eroare)
  return db
}

// starea obiectelor (pentru „nimic schimbat”)
const stare = async db => (await db.query(`SELECT
    (SELECT string_agg(relname::text, ',' ORDER BY relname::text) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
       AND relname IN ('ofertare_elemente_masura', 'ofertare_tipare_cantitate', 'ofertare_cantitati_setari', 'ofertare_cantitati_evaluari', 'ofertare_cantitati_semnale', 'ofertare_cantitati_masuratori')) AS tabele,
    (SELECT string_agg(tgname::text, ',' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal) AS triggere,
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'fn\\_ofertare\\_masura%' OR proname LIKE 'fn\\_ofertare\\_semnal%' OR proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare'))) AS functii_noi,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofertare_clarificari_licitatie_nr_uq') AS uq_nr,
    (SELECT string_agg(md5(replace(prosrc, chr(13), '')), ',' ORDER BY proname) FROM pg_proc WHERE proname IN ('fn_trg_ofertare_clarificari_baza', 'ofertare_clarificare_reconfirma', 'ofertare_clarificare_exceptie_identitate', 'ofertare_clarificari_export', 'ofertare_clarificari_notifica')) AS corpuri_r9b,
    md5(pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass)) AS view_md5,
    (SELECT count(*)::int FROM public.ofertare_clarificari) AS clarificari`)).rows[0]
let STARE_VECHE = null
const eVeche = s => s.tabele === null && s.triggere === STARE_VECHE.triggere && s.functii_noi === 0 && s.uq_nr === false && s.corpuri_r9b === STARE_VECHE.corpuri_r9b && s.view_md5 === STARE_VECHE.view_md5

// ── rularea ca un cont (ROLLBACK la final) / într-o tranzacție ──
async function ca(db, cont, sql, params = [], { rol = 'authenticated' } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql, params); await db.exec('ROLLBACK'); return { rows: r.rows, fields: r.fields.map(f => f.name) } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
// scriere COMISĂ ca un cont (sau ca service_role / postgres cu cont = null, rol dat)
async function scrieCa(db, cont, sql, params = [], { rol = 'authenticated' } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; ${rol ? `SET LOCAL ROLE ${rol};` : ''} ${uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql, params); await db.exec('COMMIT'); return { ok: true, rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); return { ok: false, code: e.code, message: e.message } }
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows
async function incearca(db, sql, params = []) {
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows } } catch (e) { return { ok: false, code: e.code, message: e.message } }
}
const asteptCod = (r, cod, ce, ab) => { if (r.ok !== false && !r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if ((r.code || '') !== cod) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod})`) }
const asteptMesaj = (r, re, ce, ab) => { if (r.ok !== false && !r.code) ab.push(`${ce}: a trecut (aștepta /${re.source}/)`); else if (!re.test(r.message || '')) ab.push(`${ce}: ${r.code} ${r.message} (aștepta /${re.source}/)`) }

// ── fixturi sintetice (documente, texte, extrageri, observații, poziții F3) ──
const PAG = (n, ...linii) => `⟦PAGINA ${n}⟧\n${linii.join('\n')}\n`
let nextId = 700000
async function document(db, { id, lic = LIC, tip = 'alta', nume = 'DOC', text = null, revizie = 'A', lot_stare = 'necunoscut', pagini_necitite = [] }) {
  const did = id ?? ++nextId
  await db.query(`INSERT INTO public.ofertare_documente_atribuire (id, licitatie_id, tip, nume_original, text_extras, revizie, lot_stare, pagini_necitite)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [did, lic, tip, nume, text, revizie, lot_stare, pagini_necitite])
  return did
}
// o extragere `gata` (sau altă stare) pe textul CURENT al documentului, cu feliile și observațiile date. Feliile: {nr, de_la, pana_la, stare, incercare,
// obs: [...]}; default: o felie pe tot textul. Observațiile: {rol, denumire, cantitate, um, pagina, citat, tip, masura, dn, material, obiect, lot_domeniu, lot_nr, e_total, e_subtotal, dovedita}
async function extragere(db, docId, { extractor = 'extr-A', stare = 'gata', felii = null, obs = [], lic = null } = {}) {
  const d = (await q(db, `SELECT licitatie_id, text_extras FROM public.ofertare_documente_atribuire WHERE id = $1`, [docId]))[0]
  const licId = lic ?? Number(d.licitatie_id); const text = d.text_extras ?? ''
  const sha = sha256(text)
  await db.query(`INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [licId, sha, text])
  const prov = (await q(db, `INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine)
    VALUES ($1, $2, $3, 'transcriere', 'proba', 'integral') RETURNING id`, [licId, docId, sha]))[0].id
  const cerere = (await q(db, `SELECT id FROM public.ofertare_ai_cereri WHERE licitatie_id = $1 ORDER BY id LIMIT 1`, [licId]))[0].id
  const f = felii ?? [{ nr: 0, de_la: 0, pana_la: text.length, stare: 'gata', obs }]
  const ex = (await q(db, `INSERT INTO public.ofertare_cant_extrageri (licitatie_id, document_id, doc_sha256, prov_id, familie_id, extractor_id, felii_total, stare, obs_relevante, cerere_id, terminat_la)
    VALUES ($1, $2, $3, $4, 'fam', $5, $6, $7, $8, $9, CASE WHEN $7 = 'in_lucru' THEN NULL ELSE now() END) RETURNING id`,
    [licId, docId, sha, prov, extractor, Math.max(1, new Set(f.map(x => x.nr)).size), stare, stare === 'gata' ? 0 : null, cerere]))[0].id
  const munca = nr => `${docId}:${sha}:${extractor}:${nr}:${sha256('felie' + nr)}`
  for (const fl of f) {
    const inc = fl.incercare ?? 1
    await db.query(`INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, stare, motiv_reluare, inchisa_la)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 = 'in_zbor' THEN NULL ELSE now() END)`,
      [munca(fl.nr), inc, ex, fl.nr, fl.de_la, fl.pana_la, sha256('felie' + fl.nr), fl.stare ?? 'gata', inc > 1 ? 'reluata in proba' : null])
    for (const o of fl.obs || []) await observatie(db, ex, fl.nr, o, { licId, docId, sha, extractor })
  }
  return { id: Number(ex), sha }
}
async function observatie(db, ex, felieNr, o, ctx) {
  const citat = o.citat ?? `${o.denumire} ${o.cantitate} ${o.um ?? 'm'}`
  const r = await q(db, `INSERT INTO public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256, familie_id, extragere_id, felie_nr, lot_domeniu, lot_nr, rol_sursa, rol_decis_de,
      pagina, cod_articol, denumire, rand_interval, citat_interval, cantitate_offset, pozitie_dovedita, tip_lucrare, masura, obiect_cheie, material, dn_mm, um_norm, cantitate,
      e_total, e_subtotal, citat, extractor_id, hash_rand)
    VALUES ($1, $2, $3, 'fam', $4, $5, $6, $7, $8, 'model', $9, $10, $11, $12, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING id`,
    [ctx.licId, ctx.docId, ctx.sha, ex, felieNr, o.lot_domeniu ?? 'toate', o.lot_nr ?? [], o.rol ?? 'atr', o.pagina ?? 1, o.cod ?? null, o.denumire,
      o.dovedita === false ? null : '[0,10)', o.dovedita === false ? null : 0, o.dovedita !== false, o.tip ?? 'conducta', o.masura ?? 'lungime', o.obiect ?? null,
      o.material ?? null, o.dn ?? [], o.um ?? 'm', o.cantitate ?? null, o.e_total ?? false, o.e_subtotal ?? false, citat, ctx.extractor,
      sha256(citat + '|' + (o.hash_extra ?? ''))])
  return Number(r[0].id)
}
async function cantitate(db, { lic = LIC, denumire, um = 'm', cantitate, obiect = null, cod = null, surse = null, status = 'validat', lot_domeniu = null, lot_nr = null, specificatii = null }) {
  const r = await q(db, `INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, um, cantitate, obiect, cod_articol, surse_document_ids, status, tip_sursa, extras_de_ai, lot_domeniu, lot_nr, specificatii)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lista_f3', false, $9, $10, $11) RETURNING id`, [lic, denumire, um, cantitate, obiect, cod, surse, status, lot_domeniu, lot_nr, specificatii])
  return Number(r[0].id)
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (!MIG) { console.log('  NU  migrarea lipsește: ' + F_MIG); esec++ }
if (vrea('t1') && MIG) {
  console.log('t1. liste, tabele, RLS, identitate, licitație, dovezi, imuabilitate, UNIQUE nr, reaplicare')
  const db = await bazaNoua()
  STARE_VECHE = await stare(db)
  const a = await livreaza(db, MIG)
  ok(a.ok && a.note.some(n => /^AMPRENTA_GLOBALA_CITITA inainte: [0-9a-f]{32}/.test(n)) && a.note.some(n => /^20270112a: lock la \d+ ms de la BEGIN \(1 incercari/.test(n)),
    'migrarea se aplică (pasul „înainte” real; lock din prima)' + (a.ok ? '' : ': ' + a.eroare))
  if (a.ok) {
    const ab = []
    // t1_liste
    const l = (await q(db, `SELECT (SELECT count(*)::int FROM public.ofertare_elemente_masura) n, (SELECT count(*)::int FROM public.ofertare_tipare_cantitate WHERE fel = 'antet_cantitate') ac,
      (SELECT count(*)::int FROM public.ofertare_tipare_cantitate WHERE fel = 'antet_um') au, (SELECT count(*)::int FROM public.ofertare_tipare_cantitate WHERE fel = 'cuvant_cheie') cc,
      (SELECT string_agg(cod, ',' ORDER BY cod) FROM public.ofertare_elemente_masura WHERE cod IN ('teava_pe_dn160', 'robinet_dn100', 'necunoscut', 'tub_protectie_dn63')) coduri`))[0]
    if (!(l.n === 27 * 4 + 27 + 4 && l.ac === 9 && l.au === 5 && l.cc === 5 && l.coduri === 'necunoscut,robinet_dn100,teava_pe_dn160,tub_protectie_dn63')) ab.push('t1_liste: ' + JSON.stringify(l))
    const ls = await ca(db, 'OF', `SELECT count(*)::int n FROM public.ofertare_elemente_masura`)
    if (ls.code || ls.rows[0].n !== 27 * 4 + 27 + 4) ab.push('t1_liste: authenticated nu citește lista: ' + JSON.stringify(ls))
    asteptCod(await ca(db, 'OF', `INSERT INTO public.ofertare_elemente_masura (cod, familie, um_canonica) VALUES ('xx_test', 'teava', 'm')`), '42501', 't1_liste: INSERT ca authenticated', ab)
    // t1_rls
    for (const t of ['ofertare_cantitati_setari', 'ofertare_cantitati_evaluari', 'ofertare_cantitati_semnale', 'ofertare_cantitati_masuratori']) {
      const p = (await q(db, `SELECT c.relrowsecurity rls, (SELECT string_agg(polcmd::text || ':' || array_to_string(polroles::regrole[]::text[], '+'), ',') FROM pg_policy WHERE polrelid = c.oid) pol,
        has_table_privilege('authenticated', c.oid, 'INSERT') ins, has_table_privilege('authenticated', c.oid, 'UPDATE') upd, has_table_privilege('authenticated', c.oid, 'DELETE') del,
        has_table_privilege('authenticated', c.oid, 'SELECT') sel, has_table_privilege('anon', c.oid, 'SELECT') anon
        FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [t]))[0]
      if (!(p.rls && p.pol === 'r:authenticated' && !p.ins && !p.upd && !p.del && p.sel && !p.anon)) ab.push(`t1_rls ${t}: ${JSON.stringify(p)}`)
    }
    await db.exec(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag, plafon_pagini) VALUES (${LIC}, 0.05, 200)`)
    const s0 = await ca(db, 'STRAIN', `SELECT count(*)::int n FROM public.ofertare_cantitati_setari`); if (s0.code || s0.rows[0].n !== 0) ab.push('t1_rls: STRAIN vede setări: ' + JSON.stringify(s0))
    const s1 = await ca(db, 'OF', `SELECT count(*)::int n FROM public.ofertare_cantitati_setari`); if (s1.code || s1.rows[0].n !== 1) ab.push('t1_rls: OF nu vede setările: ' + JSON.stringify(s1))
    asteptCod(await ca(db, 'OF', `INSERT INTO public.ofertare_cantitati_setari (licitatie_id) VALUES (${LIC2})`), '42501', 't1_rls: scriere directă setări', ab)
    asteptCod(await ca(db, 'OF', `UPDATE public.ofertare_cantitati_setari SET prag = 0.1`), '42501', 't1_rls: UPDATE direct setări', ab)
    // t1_identitate
    const i = (await q(db, `SELECT public.fn_ofertare_masura_identitate(${LIC}, NULL, '*', 'teava_pe_dn160', 'fizica', 'm') a, public.fn_ofertare_masura_identitate(${LIC}, NULL, '*', 'teava_pe_dn160', 'fizica', 'm') b,
      public.fn_ofertare_masura_identitate(${LIC}, 1, '*', 'teava_pe_dn160', 'fizica', 'm') c, public.fn_ofertare_masura_identitate(${LIC}, NULL, '*', 'necunoscut', 'necunoscuta', NULL) d,
      public.fn_ofertare_masura_identitate(${LIC}, NULL, '*', 'necunoscut', 'necunoscuta', NULL) e`))[0]
    if (!(i.a === i.b && i.a !== i.c && /^[0-9a-f]{16}$/.test(i.a) && i.d === i.e && /^[0-9a-f]{16}$/.test(i.d))) ab.push('t1_identitate: ' + JSON.stringify(i))
    asteptCod(await incearca(db, `INSERT INTO public.ofertare_cantitati_semnale (licitatie_id, obiect_cheie, element, clasa, um_canonica, identitate) VALUES (${LIC}, '*', 'teava_pe_dn160', 'fizica', 'm', '0123456789abcdef')`),
      '23514', 't1_identitate: identitate scrisă de mână', ab)
    // fixtura pentru măsurători: două licitații, câte un document / semnal / evaluare / poziție / observație
    const dA = await document(db, { lic: LIC, nume: 'DOC_F3_T', text: PAG(1, '003 SA11G1 TEAVA PE100 DN160 M 6.400') })
    const dB = await document(db, { lic: LIC2, nume: 'DOC_ALT', text: PAG(1, 'alt document') })
    const exA = await extragere(db, dA, { obs: [{ rol: 'atr', denumire: 'conducta Dn 160', cantitate: 3995, pagina: 1 }] })
    const exB = await extragere(db, dB, { obs: [{ rol: 'atr', denumire: 'conducta Dn 160', cantitate: 10, pagina: 1 }] })
    const obsA = Number((await q(db, `SELECT id FROM public.ofertare_cant_obs WHERE extragere_id = $1`, [exA.id]))[0].id)
    const obsB = Number((await q(db, `SELECT id FROM public.ofertare_cant_obs WHERE extragere_id = $1`, [exB.id]))[0].id)
    const cA = await cantitate(db, { lic: LIC, denumire: 'TEAVA PE100 DN160', cantitate: 6400, cod: 'SA11G1', surse: [dA] })
    const cB = await cantitate(db, { lic: LIC2, denumire: 'TEAVA PE100 DN160', cantitate: 10 })
    const ev = async lic => Number((await q(db, `INSERT INTO public.ofertare_cantitati_evaluari (licitatie_id, token, surse_sha, fotografie, pagini) VALUES ($1, gen_random_uuid(), $2, '{}', '{}') RETURNING id`, [lic, sha256('x' + lic)]))[0].id)
    const evA = await ev(LIC), evB = await ev(LIC2)
    const sem = async (lic, el = 'teava_pe_dn160') => Number((await q(db, `INSERT INTO public.ofertare_cantitati_semnale (licitatie_id, obiect_cheie, element, clasa, um_canonica, identitate)
      VALUES ($1, '*', $2, 'fizica', 'm', public.fn_ofertare_masura_identitate($1, NULL, '*', $2, 'fizica', 'm')) RETURNING id`, [lic, el]))[0].id)
    const sA = await sem(LIC), sB = await sem(LIC2)
    // documentul-sursa al pozitiilor A (fara extragere, ca stergerea lui sa fie posibila: in productie FK-urile extragerilor refuza stergerea unui document extras)
    const dC = await document(db, { lic: LIC, nume: 'DOC_F3_SURSA', text: PAG(1, '003 SA11G1 TEAVA PE100 DN160 M 6.400') })
    const shaA = sha256(PAG(1, '003 SA11G1 TEAVA PE100 DN160 M 6.400'))
    const M = (campuri) => {
      const v = { licitatie_id: LIC, evaluare_id: evA, semnal_id: sA, parte: 'a', cantitate_id: cA, obs_id: null, document_id: dC, revizie: 'A', doc_sha256: shaA, pagina: 1, fel_dovada: 'tabel',
        rand: '003 SA11G1 TEAVA PE100 DN160 M 6.400', celula: '6.400', fragment: null, valoare_text: '6.400', um_text: 'M', valoare: 6400, um_canonica: 'm', natura: 'furnizare', verificare: 'ok', ...campuri }
      const k = Object.keys(v)
      return [`INSERT INTO public.ofertare_cantitati_masuratori (${k.join(', ')}) VALUES (${k.map((_, j) => '$' + (j + 1)).join(', ')}) RETURNING id`, k.map(x => v[x])]
    }
    const ins = async (campuri) => incearca(db, ...M(campuri))
    // t1_alta_licitatie (cinci cazuri)
    asteptMesaj(await ins({ document_id: dB, doc_sha256: exB.sha }), /CM_ALTA_LICITATIE/, 't1_alta_licitatie: documentul', ab)
    asteptMesaj(await ins({ cantitate_id: cB }), /CM_ALTA_LICITATIE/, 't1_alta_licitatie: cantitate_id', ab)
    asteptMesaj(await ins({ parte: 'b', cantitate_id: null, obs_id: obsB, fel_dovada: 'text', rand: null, celula: null, fragment: 'x' }), /CM_ALTA_LICITATIE/, 't1_alta_licitatie: obs_id', ab)
    asteptMesaj(await ins({ semnal_id: sB }), /CM_ALTA_LICITATIE/, 't1_alta_licitatie: semnal_id', ab)
    asteptMesaj(await ins({ evaluare_id: evB }), /CM_ALTA_LICITATIE/, 't1_alta_licitatie: evaluare_id', ab)
    // t1_fara_dovada
    const r1 = await ins({ verificare: 'fara_sursa', document_id: null, revizie: null, doc_sha256: null, pagina: null, fel_dovada: null, rand: null, celula: null, valoare_text: null, um_text: null, valoare: null, um_canonica: null })
    if (!r1.ok) ab.push('t1_fara_dovada: fara_sursa fără document refuzată: ' + r1.message)
    asteptCod(await ins({ verificare: 'nedovedit', revizie: null, pagina: null, fel_dovada: null, rand: null, celula: null, valoare: null, valoare_text: null, um_text: null, um_canonica: null }), '23514', 't1_fara_dovada: nedovedit fără revizie', ab)
    asteptCod(await ins({ pagina: null }), '23514', 't1_fara_dovada: ok fără pagină', ab)
    asteptCod(await ins({ fragment: 'x' }), '23514', 't1_fara_dovada: tabel cu fragment', ab)
    const r2 = await ins({ parte: 'b', cantitate_id: null, obs_id: obsA, verificare: 'neatribuibil', pagina: 1, fel_dovada: null, rand: null, celula: null, valoare: null, valoare_text: null, um_text: null, um_canonica: null })
    if (!r2.ok) ab.push('t1_fara_dovada: neatribuibil pe b fără valoare refuzată: ' + r2.message)
    asteptCod(await ins({ parte: 'b', cantitate_id: null, obs_id: obsA, verificare: 'neatribuibil', fel_dovada: null, rand: null, celula: null, valoare: 5, valoare_text: null, um_text: null, um_canonica: null }), '23514', 't1_fara_dovada: neatribuibil cu valoare', ab)
    asteptCod(await ins({ verificare: 'pagina_nepermisa', fel_dovada: null, rand: null, celula: null, valoare: null, valoare_text: null, um_text: null, um_canonica: null }), '23514', 't1_fara_dovada: pagina_nepermisa pe partea a', ab)
    const r3 = await ins({}); if (!r3.ok) ab.push('t1_fara_dovada: măsurătoarea ok completă refuzată: ' + r3.message)
    const mOk = r3.ok ? Number(r3.rows[0].id) : null
    // t1_imuabil
    asteptMesaj(await incearca(db, `UPDATE public.ofertare_cantitati_masuratori SET valoare = 1 WHERE id = $1`, [mOk]), /CM_IMUABIL/, 't1_imuabil: UPDATE', ab)
    asteptMesaj(await incearca(db, `DELETE FROM public.ofertare_cantitati_masuratori WHERE id = $1`, [mOk]), /CM_IMUABIL/, 't1_imuabil: DELETE direct ca postgres fără marcaj', ab)
    asteptMesaj(await incearca(db, `DELETE FROM public.ofertare_cantitati_evaluari WHERE id = $1`, [evA]), /CM_IMUABIL/, 't1_imuabil: DELETE pe evaluare', ab)
    asteptMesaj(await incearca(db, `UPDATE public.ofertare_cantitati_evaluari SET stare = 'depasita', inchisa_la = now() WHERE id = $1`, [evA]), /CM_IMUABIL/, 't1_imuabil: UPDATE stare evaluare fără marcaj', ab)
    const nm0 = (await q(db, `SELECT count(*)::int n FROM public.ofertare_cantitati_masuratori WHERE document_id = $1`, [dC]))[0].n
    const del = await incearca(db, `DELETE FROM public.ofertare_documente_atribuire WHERE id = $1`, [dC])
    const nm1 = (await q(db, `SELECT count(*)::int n FROM public.ofertare_cantitati_masuratori WHERE document_id = $1`, [dC]))[0].n
    const sRamane = (await q(db, `SELECT count(*)::int n FROM public.ofertare_cantitati_semnale WHERE id = $1`, [sA]))[0].n
    if (!(del.ok && nm0 >= 2 && nm1 === 0 && sRamane === 1)) ab.push(`t1_imuabil: DELETE document → cascadă (${nm0} → ${nm1}, semnal ${sRamane}): ${del.message || ''}`)
    // t1_rezolvare (CHECK; predicatul fn_ofertare_semnal_rezolvat e probat în t3)
    asteptCod(await incearca(db, `UPDATE public.ofertare_cantitati_semnale SET rezolvare = '{"document_id": 1, "revizie": "A"}' WHERE id = $1`, [sA]), '23514', 't1_rezolvare: fără valoare', ab)
    const rz = await incearca(db, `UPDATE public.ofertare_cantitati_semnale SET rezolvare = '{"document_id": 1, "revizie": "A", "valoare": 5}' WHERE id = $1`, [sA])
    if (!rz.ok) ab.push('t1_rezolvare: rezolvare completă refuzată: ' + rz.message)
    // t1_nr_unic
    await db.exec(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 7, 'intrebare 7', 'propunere')`)
    asteptCod(await incearca(db, `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 7, 'alta 7', 'propunere')`), '23505', 't1_nr_unic', ab)
    const r7 = await incearca(db, `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC2}, 7, 'alta licitatie 7', 'propunere')`)
    if (!r7.ok) ab.push('t1_nr_unic: același nr pe altă licitație refuzat: ' + r7.message)
    ab.forEach(x => console.log('     ' + x))
    ok(ab.length === 0, `t1: liste / RLS / identitate / licitație / dovezi / imuabil / nr unic (${ab.length} abateri)`)
    const re = await livreaza(db, MIG)
    ok(!re.ok && /reaplicare/.test(re.eroare), 't1_reaplicare: a doua aplicare = refuz: ' + (re.eroare || 'APLICAT').slice(0, 100))
  }
  await db.close()
  // $stare$ cu o dublură preexistentă → CM_NR_DUBLU, nimic schimbat
  const b = await bazaNoua()
  await b.exec(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 3, 'a', 'propunere'), (${LIC}, 3, 'b', 'propunere')`)
  const s0 = await stare(b)
  const d = await livreaza(b, MIG)
  ok(!d.ok && /CM_NR_DUBLU: 1 perechi/.test(d.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 't1_nr_unic: $stare$ cu o dublură → CM_NR_DUBLU, nimic schimbat: ' + (d.eroare || 'APLICAT').slice(0, 120))
  await b.close()
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
