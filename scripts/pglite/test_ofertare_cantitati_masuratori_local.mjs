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
async function bazaAplicata(text = MIG) {
  const db = await bazaNoua()
  const a = await livreaza(db, text)
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
    (SELECT string_agg(md5(replace(prosrc, chr(13), '')), ',' ORDER BY proname) FROM pg_proc WHERE proname IN ('fn_trg_ofertare_clarificari_baza', 'ofertare_clarificare_reconfirma', 'ofertare_clarificare_exceptie_identitate', 'ofertare_clarificari_export', 'ofertare_clarificari_notifica', 'fn_ofertare_surse_valideaza')) AS corpuri_r9b,
    md5(pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass)) AS view_md5,
    (SELECT count(*)::int FROM public.ofertare_clarificari) AS clarificari`)).rows[0]
let STARE_VECHE = null
const eVeche = s => s.tabele === null && s.triggere === STARE_VECHE.triggere && s.functii_noi === 0 && s.uq_nr === false && s.corpuri_r9b === STARE_VECHE.corpuri_r9b && s.view_md5 === STARE_VECHE.view_md5

// ── rularea ca un cont (ROLLBACK la final) / într-o tranzacție ──
// JWT-ul ca PostgREST: AMBELE surse (request.jwt.claim.sub și request.jwt.claims cu rolul) — triggerul de proveniență citește rolul din claims
const jwt = (uid, rol) => uid ? `SELECT set_config('request.jwt.claim.sub', '${uid}', true); SELECT set_config('request.jwt.claims', '{"sub": "${uid}", "role": "${rol}"}', true);`
  : `SELECT set_config('request.jwt.claims', '{"role": "${rol}"}', true);`
async function ca(db, cont, sql, params = [], { rol = 'authenticated' } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; ${jwt(uid, rol)}`)
  try { const r = await db.query(sql, params); await db.exec('ROLLBACK'); return { rows: r.rows, fields: r.fields.map(f => f.name) } }
  catch (e) { await db.exec('ROLLBACK'); return { code: e.code, message: e.message } }
}
// scriere COMISĂ ca un cont (sau ca service_role / postgres cu cont = null, rol dat)
async function scrieCa(db, cont, sql, params = [], { rol = 'authenticated' } = {}) {
  const uid = cont ? U[cont] : null
  await db.exec(`BEGIN; ${rol ? `SET LOCAL ROLE ${rol}; ${jwt(uid, rol)}` : ''}`)
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const TN = JSON.parse(citeste('supabase/tests/20270112a_cazuri_numar.json'))
const TP = JSON.parse(citeste('supabase/tests/20270112a_cazuri_plafon.json'))
let T2_REZUMAT = ''
// verificările t2 pe o bază cu migrarea aplicată (refolosite de mutanți): întoarce abaterile
async function verificaT2(db) {
  const ab = []
  const J = async (sql, params = []) => (await q(db, sql, params))[0].x
  // t2_numar_ro — tabelul comun de cazuri
  const decod = s => Object.entries(TN._marcaje).reduce((t, [k, [cod, ori]]) => t.split(k).join(String.fromCharCode(cod).repeat(ori)), s)
  for (const c of TN.cazuri) {
    const r = await J(`SELECT public.fn_ofertare_numar_ro($1) x`, [decod(c.text)])
    const bun = c.motiv ? (r.motiv === c.motiv && r.valoare === null) : (r.motiv === null && Number(r.valoare) === Number(c.valoare) && r.intreg === c.intreg)
    if (!bun) ab.push(`t2_numar_ro ${JSON.stringify(c.text)}: ${JSON.stringify(r)} (aștepta ${JSON.stringify(c)})`)
  }
  // t2_clasifica
  const CL = [
    [['TEAVA PE100 DN160', 'm', 'conducta', [160], 'PE100', 'material', 'f3'], { element: 'teava_pe_dn160', natura: 'furnizare', clasa: 'fizica', um_canonica: 'm', cunoscut: true }],
    [['conducta Dn 160', 'm', 'conducta', [160], null, 'lungime', 'atr'], { element: 'teava_dn160', natura: 'total_lucrare', clasa: 'fizica', um_canonica: 'm', cunoscut: true }],
    [['MONTAJ CONDUCTA PE100 DN160', 'm', 'conducta', [160], 'PE100', 'lungime', 'f3'], { element: 'teava_pe_dn160', natura: 'montaj', clasa: 'montaj', cunoscut: true }],
    [['teava DN160', 'm', 'conducta', [160], null, 'lungime', 'f3'], { element: 'teava_dn160', natura: null, clasa: 'necunoscuta', cunoscut: false, motiv: 'natura necunoscuta' }],
    [['robinet sertar Dn 100', 'buc', 'alt', [100], null, 'alt', 'f3'], { element: 'robinet_dn100', um_canonica: 'buc' }],
    [['Sapatura manuala', 'mc', 'alt', [], null, 'alt', 'f3'], { element: 'sapatura', um_canonica: 'mc' }],
    [['teava DN160 si DN110', 'm', 'conducta', [110, 160], null, 'lungime', 'atr'], { element: null, cunoscut: false }],
    [['Proba de presiune conducta PE DN160', 'm', 'conducta', [160], null, 'lungime', 'f3'], { element: 'teava_pe_dn160', natura: 'proba', clasa: 'proba', cunoscut: true }],
    [['Tub de protectie OL DN 250', 'm', 'protectie', [250], null, 'lungime', 'atr'], { element: 'tub_protectie_dn250', natura: 'total_lucrare', cunoscut: true }],
    [['Bransament PE DN32', 'buc', 'bransament', [32], 'PE', 'material', 'f3'], { element: 'bransament', natura: 'furnizare', um_canonica: 'buc', cunoscut: true }],
    [['teava PE100 DN999', 'm', 'conducta', [999], 'PE100', 'material', 'f3'], { element: null, cunoscut: false }],
  ]
  for (const [arg, astept] of CL) {
    const r = await J(`SELECT public.fn_ofertare_masura_clasifica($1, $2, $3, $4::numeric[], $5, $6, $7) x`, arg)
    const dif = Object.entries(astept).filter(([k, v]) => k === 'motiv' ? !String(r.motiv || '').includes(v) : r[k] !== v)
    if (dif.length) ab.push(`t2_clasifica ${arg[0]}: ${JSON.stringify(r)} (aștepta ${JSON.stringify(astept)})`)
  }
  const dn = await J(`SELECT jsonb_build_array(public.fn_ofertare_masura_dn('D= 90 MM'), public.fn_ofertare_masura_dn('teava DN160 si DN110'), public.fn_ofertare_masura_dn('conducta Ø 63 PE100 SDR11'), public.fn_ofertare_masura_dn('lungime 250 m')) x`)
  if (JSON.stringify(dn) !== JSON.stringify([[90], [110, 160], [63], []])) ab.push('t2_clasifica fn_ofertare_masura_dn: ' + JSON.stringify(dn))
  // t2_lot
  for (const [arg, astept] of [[['lista', [2], 'are_loturi'], { lot: 2, cunoscut: true }], [['lista', [1, 2], 'are_loturi'], { lot: null, cunoscut: false }],
    [['toate', [], 'fara_loturi'], { lot: null, cunoscut: true }], [['toate', [], 'are_loturi'], { lot: null, cunoscut: false }], [['toate', [], 'neinitializat'], { lot: null, cunoscut: false }],
    [[null, null, 'fara_loturi'], { lot: null, cunoscut: true }], [['necunoscut', [], 'fara_loturi'], { lot: null, cunoscut: false }]]) {
    const r = await J(`SELECT public.fn_ofertare_masura_lot($1, $2::int[], $3) x`, arg)
    if (JSON.stringify(r) !== JSON.stringify(astept)) ab.push(`t2_lot ${JSON.stringify(arg)}: ${JSON.stringify(r)}`)
  }
  // t2_um
  for (const [arg, astept] of [[['km', 'teava_pe_dn160'], { um: 'm', factor: 1000, motiv: null }], [['t', 'teava_pe_dn160'], { um: 'kg', factor: 1000, motiv: 'unitate_incompatibila' }],
    [['t', null], { um: 'kg', factor: 1000, motiv: null }], [['buc', 'teava_pe_dn160'], { um: 'buc', factor: 1, motiv: 'unitate_incompatibila' }], [['mm', null], { um: null, factor: null, motiv: 'diametru_nu_cantitate' }],
    [['ml', 'teava_pe_dn160'], { um: 'm', factor: 1, motiv: null }], [['bucati', 'robinet_dn100'], { um: 'buc', factor: 1, motiv: null }], [['ore', null], { um: null, factor: null, motiv: 'um_necunoscuta' }]]) {
    const r = await J(`SELECT public.fn_ofertare_um_canonica($1, $2) x`, arg)
    const bun = r.um === astept.um && r.motiv === astept.motiv && (astept.factor === null ? r.factor === null : Number(r.factor) === astept.factor)
    if (!bun) ab.push(`t2_um ${JSON.stringify(arg)}: ${JSON.stringify(r)}`)
  }
  // t2_pagini_permise — tabelul comun
  for (const c of TP.cazuri) {
    const r = await J(`SELECT public.fn_ofertare_masura_pagini_permise($1::jsonb, $2) x`, [JSON.stringify(c.documente), c.plafon])
    if (JSON.stringify(r.limita) !== JSON.stringify(c.limita) || r.plafon_atins !== c.plafon_atins) ab.push(`t2_pagini_permise ${c.nume}: ${JSON.stringify(r)}`)
    for (const f of c.felii) {
      const lim = r.limita.find(x => x.document_id === f.document_id)?.ultima_pagina_permisa ?? 0
      if ((f.pagina_pana_la <= lim) !== f.permisa) ab.push(`t2_pagini_permise ${c.nume}: felia ${JSON.stringify(f)} → limita ${lim}`)
    }
  }
  // dovezi: pagini sintetice
  const F3 = PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '001 SA11G0 SAPATURA MANUALA MC 120', '003 SA11G1 TEAVA PE100 DN160 M 6.400', '004 SA11G2 TEAVA PE100 DN110 M 3.995,50')
    + PAG(2, 'Nr. Cod Denumire UM Cantitate Pret Valoare', '005 SA11G3 TEAVA PE100 DN90 M 6.400 12,5 80000')
    + PAG(3, 'Nr. Denumire UM DN Cantitate', '006 TEAVA PE100 DN160 M 160 6.400', '', '', 'Nr. Denumire Cantitate', '007 TEAVA PE100 DN160 6.400', 'Nr. Denumire L (m)', '008 TEAVA PE100 DN160 1.200')
    + PAG(4, 'Nr. Cod Denumire UM Cantitate', '009 X TEAVA DN160 M 6.400', '009 X TEAVA DN160 M 6.400', 'Nr. Cod Denumire UM Cantitate', '010 Y TEAVA DN160 M 1.23', '011 Z TEAVA DN160 MM 160', '012 W TEAVA DN160 BUC 5')
  const V = async (pag, dov) => J(`SELECT public.fn_ofertare_masura_verifica($1, $2::jsonb) x`, [pag, JSON.stringify(dov)])
  const T = (rand, celula, pagina = 1, element = 'teava_pe_dn160') => ({ pagina, fel_dovada: 'tabel', rand, celula, element })
  const cazT = [
    ['t2_tabel_ok', T('003 SA11G1 TEAVA PE100 DN160 M 6.400', '6.400'), { verificare: 'ok', valoare: 6400, um_canonica: 'm', antet_coloana: 'cantitate', antet_um: 'um', valoare_text: '6.400', um_text: 'M' }],
    ['t2_tabel_ok preturi (index de la dreapta 2)', T('005 SA11G3 TEAVA PE100 DN90 M 6.400 12,5 80000', '6.400', 2, 'teava_pe_dn90'), { verificare: 'ok', valoare: 6400 }],
    ['t2_tabel_ok 3.995,50', T('004 SA11G2 TEAVA PE100 DN110 M 3.995,50', '3.995,50', 1, 'teava_pe_dn110'), { verificare: 'ok', valoare: 3995.5 }],
    ['t2_tabel_ok sapatura mc', T('001 SA11G0 SAPATURA MANUALA MC 120', '120', 1, 'sapatura'), { verificare: 'ok', valoare: 120, um_canonica: 'mc' }],
    ['t2_tabel_coloana_vecina celula 160', T('006 TEAVA PE100 DN160 M 160 6.400', '160', 3), { verificare: 'coloana_necunoscuta' }],
    ['t2_tabel_coloana_vecina celula 6.400', T('006 TEAVA PE100 DN160 M 160 6.400', '6.400', 3), { verificare: 'ok', valoare: 6400 }],
    ['t2_tabel um_lipsa', T('007 TEAVA PE100 DN160 6.400', '6.400', 3), { verificare: 'um_lipsa' }],
    ['t2_tabel L (m) dă UM-ul', T('008 TEAVA PE100 DN160 1.200', '1.200', 3), { verificare: 'ok', valoare: 1200, antet_coloana: 'l (m)', um_text: 'm' }],
    ['t2_tabel_alt_rand rand_lipsa', T('999 INEXISTENT M 1', '1', 1), { verificare: 'rand_lipsa' }],
    ['t2_tabel_alt_rand rand_ambiguu', T('009 X TEAVA DN160 M 6.400', '6.400', 4), { verificare: 'rand_ambiguu' }],
    ['t2_tabel numar_ambiguu', T('010 Y TEAVA DN160 M 1.23', '1.23', 4), { verificare: 'numar_ambiguu' }],
    ['t2_tabel diametru (UM mm)', T('011 Z TEAVA DN160 MM 160', '160', 4), { verificare: 'diametru_nu_cantitate' }],
    ['t2_tabel unitate_incompatibila (buc pe țeavă)', T('012 W TEAVA DN160 BUC 5', '5', 4), { verificare: 'unitate_incompatibila' }],
    ['t2_pagina_lipsa (tabel pe pagina 9)', T('003 SA11G1 TEAVA PE100 DN160 M 6.400', '6.400', 9), { verificare: 'rand_lipsa' }],
  ]
  for (const [nume, dov, astept] of cazT) {
    const r = await V(F3, dov)
    const dif = Object.entries(astept).filter(([k, v]) => (k === 'valoare' ? Number(r.valoare) !== v : r[k] !== v))
    if (dif.length) ab.push(`${nume}: ${JSON.stringify(r)} (aștepta ${JSON.stringify(astept)})`)
  }
  const ATR = PAG(1, 'AVIZ TEHNIC DE RACORDARE', 'Se va executa o conductă DN 160, lungime 250 m, din PE100.', 'Rețeaua este în lungime totală de 3.995 m.', 'L = 1.200 m pe strada A.',
    'număr de bucăți 12 buc robineți.', 'Tub DN160 montat.', 'Tubul are lungime 160 mm grosime.', 'lungime DN160 m', 'lungime Dn 160 m', 'conductă Dn 160, lungime 250 m',
    'aproximativ 250 de metri', '250 m de conductă', 'lungime 3.995,50 m', 'lungime 1.23 m', 'lungime 250 t', 'lungime 6' + String.fromCharCode(160) + '400 m', 'lungime 2 km', 'cablul 250 m',
    'conductă DN110, lungime 100 m; conductă DN160, lungime 250 m', 'tronson A lungime 100 m și tronson B în lungime totală de 250 m')
    + PAG(3, 'fragment prezent pe pagina 3')
  const X = (fragment, pagina = 1, element = 'teava_pe_dn160') => ({ pagina, fel_dovada: 'text', fragment, element })
  const cazX = [
    ['t2_text_ok lungime 250 m', X('conductă DN 160, lungime 250 m'), { verificare: 'ok', valoare: 250, um_canonica: 'm', valoare_text: '250', um_text: 'm' }],
    ['t2_text_ok în lungime totală de', X('în lungime totală de 3.995 m'), { verificare: 'ok', valoare: 3995 }],
    ['t2_text_ok L =', X('L = 1.200 m'), { verificare: 'ok', valoare: 1200 }],
    ['t2_text_ok număr de bucăți', X('număr de bucăți 12 buc', 1, 'robinet_dn100'), { verificare: 'ok', valoare: 12, um_canonica: 'buc' }],
    ['t2_text_ok km', X('lungime 2 km'), { verificare: 'ok', valoare: 2000 }],
    ['t2_text_ok NBSP', X('lungime 6' + String.fromCharCode(160) + '400 m'), { verificare: 'ok', valoare: 6400 }],
    ['t2_text_diametru DN160 fără cuvânt-cheie → tipar', X('Tub DN160 montat.'), { verificare: 'tipar_necunoscut' }],
    ['t2_text_diametru lungime 160 mm', X('lungime 160 mm'), { verificare: 'diametru_nu_cantitate' }],
    ['t2_text_diametru lungime DN160 m', X('lungime DN160 m'), { verificare: 'diametru_nu_cantitate' }],
    ['t2_text_diametru lungime Dn 160 m', X('lungime Dn 160 m'), { verificare: 'diametru_nu_cantitate' }],
    ['t2_text_diametru conductă Dn 160, lungime 250 m', X('conductă Dn 160, lungime 250 m'), { verificare: 'ok', valoare: 250 }],
    ['t2_text_nelegat aproximativ', X('aproximativ 250 de metri'), { verificare: 'tipar_necunoscut' }],
    ['t2_text_nelegat fără cuvânt-cheie înainte', X('250 m de conductă'), { verificare: 'tipar_necunoscut' }],
    ['t2_text_nelegat cuvântul-cheie „l” în interiorul unui cuvânt (cablul)', X('cablul 250 m'), { verificare: 'tipar_necunoscut' }],
    ['t2_text_nelegat neîntreg', X('lungime 3.995,50 m'), { verificare: 'numar_neintreg' }],
    ['t2_text_nelegat ambiguu', X('lungime 1.23 m'), { verificare: 'numar_ambiguu' }],
    ['t2_text_nelegat unitate_incompatibila', X('lungime 250 t'), { verificare: 'unitate_incompatibila' }],
    // r1 P1: două cantități cu cuvânt-cheie în același fragment → niciuna nu e dovedită (nu prima potrivire: ar da altei măsuri cantitatea vecinei)
    ['t2_text fragment_ambiguu (două cantități, două DN-uri)', X('conductă DN110, lungime 100 m; conductă DN160, lungime 250 m'), { verificare: 'fragment_ambiguu' }],
    ['t2_text fragment_ambiguu (două cuvinte-cheie diferite)', X('tronson A lungime 100 m și tronson B în lungime totală de 250 m'), { verificare: 'fragment_ambiguu' }],
    ['t2_text fragmentul tăiat la o singură cantitate → ok 250', X('conductă DN160, lungime 250 m'), { verificare: 'ok', valoare: 250 }],
    ['t2_text fragment_lipsa (altă pagină)', X('fragment prezent pe pagina 3', 4), { verificare: 'fragment_lipsa' }],
    ['t2_text fragment prezent pe pagina 3 → tipar', X('fragment prezent pe pagina 3', 3), { verificare: 'tipar_necunoscut' }],
    ['t2_text fragment inexistent', X('text care nu e in document'), { verificare: 'fragment_lipsa' }],
  ]
  for (const [nume, dov, astept] of cazX) {
    const r = await V(ATR, dov)
    const dif = Object.entries(astept).filter(([k, v]) => (k === 'valoare' ? Number(r.valoare) !== v : r[k] !== v))
    if (dif.length) ab.push(`${nume}: ${JSON.stringify(r)} (aștepta ${JSON.stringify(astept)})`)
  }
  // paginile unui text
  const pg = await J(`SELECT jsonb_build_array(public.fn_ofertare_masura_pagini($1), public.fn_ofertare_masura_pagini(''), public.fn_ofertare_masura_pagini('fara marcaje'), public.fn_ofertare_masura_pagina('fara marcaje', 1), public.fn_ofertare_masura_pagina($1, 3) IS NOT NULL, public.fn_ofertare_masura_pagina($1, 2)) x`, [ATR])
  if (JSON.stringify(pg) !== JSON.stringify([3, 0, 1, 'fara marcaje', true, null])) ab.push('t2 pagini: ' + JSON.stringify(pg))
  // fără EXECUTE pentru clienți pe funcțiile interne
  for (const fn of [`fn_ofertare_numar_ro('6')`, `fn_ofertare_masura_clasifica('x', 'm', 'alt', '{}', NULL, 'alt', 'f3')`, `fn_ofertare_masura_verifica('x', '{}')`, `fn_ofertare_masura_pagini_permise('[]', 1)`]) {
    for (const rol of ['authenticated', 'service_role']) asteptCod(await ca(db, 'OF', `SELECT public.${fn}`, [], { rol }), '42501', `t2 EXECUTE ${rol} pe ${fn.split('(')[0]}`, ab)
  }
  T2_REZUMAT = `${TN.cazuri.length} cazuri numerice, ${CL.length} clasificări, ${TP.cazuri.length} cazuri de plafon, ${cazT.length} dovezi tabel, ${cazX.length} dovezi text`
  return ab
}
if (vrea('t2') && MIG) {
  console.log('t2. regula numerică, clasificarea, lotul, paginile permise, verificarea dovezilor (tabel / text)')
  const db = await bazaAplicata()
  const ab = await verificaT2(db)
  ab.forEach(x => console.log('     ' + x))
  ok(ab.length === 0, `t2: ${T2_REZUMAT} (${ab.length} abateri)`)
  await db.close()
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// t3: fotografia, propunerea, publicarea. Fixtura cazului din tichet: DOC_F3_T (rândul 6.400) + DOC_ATR_T („în lungime totală de 3.995 m”), observații
// pe AMBELE documente, poziția F3 de 6400 m cu sursa DOC_F3_T. Decizia (a) a owner-ului: F3 fără cuvânt-cheie de natură = de_verificat → poziția poartă „Furnizare”.
const PAGINI_GOL = { plafon: 200, plafon_atins: false, pagini_necitite: [], documente_necitite: [], felii_incomplete: [] }
const F3_TEXT = PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400')
const ATR_TEXT = PAG(1, 'AVIZ TEHNIC DE RACORDARE', 'Rețeaua este în lungime totală de 3.995 m.')
const OBS_F3 = { rol: 'f3', denumire: 'TEAVA PE100 DN160', cantitate: 6400, pagina: 1, citat: '003 SA11G1 TEAVA PE100 DN160 M 6.400', cod: 'SA11G1', dn: [160], material: 'PE100', masura: 'material' }
const OBS_ATR = (c = 3995, extra = {}) => ({ rol: 'atr', denumire: 'conducta PE100 Dn 160', cantitate: c, pagina: 1, citat: `în lungime totală de ${c.toLocaleString('de-DE')} m`, dn: [160], material: 'PE100', masura: 'lungime', ...extra })
async function fixturaTichet(db, { lic = LIC, f3Text = F3_TEXT, atrText = ATR_TEXT, obsAtr = [OBS_ATR()], obsF3 = [OBS_F3], cantitati = null, atr = true } = {}) {
  const dF3 = await document(db, { lic, tip: 'formular', nume: 'DOC_F3_T', text: f3Text })
  const exF3 = await extragere(db, dF3, { obs: obsF3 })
  let dAtr = null, exAtr = null
  if (atr) { dAtr = await document(db, { lic, tip: 'alta', nume: 'DOC_ATR_T', text: atrText }); exAtr = await extragere(db, dAtr, { obs: obsAtr }) }
  const ids = []
  for (const c of cantitati ?? [{ denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1' }]) ids.push(await cantitate(db, { lic, surse: [dF3], ...c }))
  return { dF3, exF3, dAtr, exAtr, cant: ids }
}
const caService = async (db, sql, params = []) => { const r = await scrieCa(db, null, sql, params, { rol: 'service_role' }); if (!r.ok) throw new Error('service_role: ' + r.message); return r.rows[0]?.x }
const foto = (db, lic = LIC) => caService(db, `SELECT public.fn_ofertare_semnale_fotografie($1) x`, [lic])
async function propune(db, lic = LIC, { pagini = PAGINI_GOL, fotoDat = null } = {}) {
  const f = fotoDat ?? await foto(db, lic)
  const token = `0000000${Math.floor(Math.random() * 9) + 1}-0000-4000-8000-${String(++nextId).padStart(12, '0')}`
  const r = await caService(db, `SELECT public.fn_ofertare_masuratori_propune($1, $2::uuid, $3::jsonb, $4::jsonb) x`, [lic, token, JSON.stringify(f), JSON.stringify(pagini)])
  return { ...r, token, foto: f }
}
const publica = (db, lic, ev, token) => caService(db, `SELECT public.fn_ofertare_semnale_publica($1, $2, $3::uuid) x`, [lic, ev, token])
async function evalueaza(db, lic = LIC, opt = {}) {
  const p = await propune(db, lic, opt)
  if (p.refuz) return { propune: p, publica: null }
  const pub = await publica(db, lic, p.evaluare_id, p.token)
  return { propune: p, publica: pub, semnale: pub.semnale || [] }
}
const semnale = async (db, lic = LIC) => q(db, `SELECT s.*, public.fn_ofertare_semnal_rezolvat(s) AS rezolvat FROM public.ofertare_cantitati_semnale s WHERE licitatie_id = $1 ORDER BY id`, [lic])
const semnalCunoscut = async (db, lic = LIC, obiect = '*') => (await q(db, `SELECT * FROM public.ofertare_cantitati_semnale WHERE licitatie_id = $1 AND element <> 'necunoscut' AND obiect_cheie = $2 ORDER BY id`, [lic, obiect]))
const ciorne = async (db, lic = LIC) => q(db, `SELECT * FROM public.ofertare_clarificari WHERE licitatie_id = $1 AND cheie LIKE 'auto_surse_%' ORDER BY nr`, [lic])
const masuratori = (db, semnalId, ev = null) => q(db, `SELECT * FROM public.ofertare_cantitati_masuratori WHERE semnal_id = $1 ${ev ? 'AND evaluare_id = ' + ev : ''} ORDER BY parte, id`, [semnalId])
const stareBaza = async (db, clarId, mod = 'afisare') => {
  const exista = (await q(db, `SELECT to_regprocedure('public.ofertare_semnal_baza_stare(public.ofertare_clarificari, text)') IS NOT NULL AS e`))[0].e
  if (!exista) return null
  return (await q(db, `SELECT public.ofertare_semnal_baza_stare(c, $2) x FROM public.ofertare_clarificari c WHERE c.id = $1`, [clarId, mod]))[0]?.x
}
const S3 = {}, S4 = {}
async function scenariu(nume, fn, text = MIG) {
  const db = await bazaAplicata(text)
  const ab = []
  try { await fn(db, ab) } catch (e) { ab.push('excepție: ' + (e.message || e).toString().slice(0, 300) + ' @ ' + String((e.stack || '').split('\n')[1] || '').trim().slice(0, 120)) } finally { await db.close() }
  ab.forEach(x => console.log('     ' + x))
  ok(ab.length === 0, `${nume} (${ab.length} abateri)`)
}
const ast = (ab, cond, msg) => { if (!cond) ab.push(msg) }

{ // t3: scenariile (definite mereu; rulate doar cu --sectiune t3)
  S3._titlu = 't3. fotografia, propunerea, publicarea, ciorna auto_surse_*, răspunsul, lista, drepturile'
  S3['t3_cazul_tichetului'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    const r = await evalueaza(db)
    ast(ab, !r.propune.refuz, 'propune refuzat: ' + JSON.stringify(r.propune))
    ast(ab, r.propune.ignorate.length === 0, 'ignorate: ' + JSON.stringify(r.propune.ignorate))
    const s = (await semnalCunoscut(db))[0]
    ast(ab, s && s.verdict === 'diferenta' && Number(s.valoare_a) === 6400 && Number(s.valoare_b) === 3995 && s.valori_b.length === 1, 'semnal: ' + JSON.stringify(r.semnale))
    ast(ab, s && s.element === 'teava_pe_dn160' && s.clasa === 'fizica' && s.um_canonica === 'm' && s.obiect_cheie === '*' && s.lot_nr === null, 'identitatea: ' + JSON.stringify(s))
    if (!s) return   // abaterea e deja notată; fără semnal nu mai e nimic de verificat
    const m = await masuratori(db, s.id)
    ast(ab, m.filter(x => x.parte === 'a').length === 1 && m.filter(x => x.parte === 'b').length === 1 && m.every(x => x.verificare === 'ok'), 'măsurătorile (F3-ul nu intră în B): ' + JSON.stringify(m.map(x => [x.parte, x.verificare, x.valoare])))
    const c = (await ciorne(db))[0]
    ast(ab, c && c.status === 'propunere' && c.origine === 'automat' && c.cheie === 'auto_surse_' + s.identitate && c.nr === 1, 'ciorna: ' + JSON.stringify(c && { status: c.status, cheie: c.cheie, nr: c.nr }))
    if (!c) return   // fără ciornă (abatere notată), restul verificărilor n-au obiect
    ast(ab, c && /pagina 1, rândul „003 SA11G1 TEAVA PE100 DN160 M 6.400”/.test(c.intrebare) && /pagina 1, fragmentul „în lungime totală de 3.995 m”/.test(c.intrebare) && /6400 m/.test(c.intrebare) && /3995 m/.test(c.intrebare), 'textul ciornei: ' + (c && c.intrebare))
    ast(ab, c && JSON.stringify((c.surse_document_ids || []).map(Number).sort()) === JSON.stringify([f.dF3, f.dAtr].sort()) && JSON.stringify((c.surse_cantitati_ids || []).map(Number)) === JSON.stringify(f.cant), 'proveniența: ' + JSON.stringify([c?.surse_document_ids, c?.surse_cantitati_ids]))
    ast(ab, c && c.sursa === `surse_auto:${f.dAtr},gen_${md5(c.intrebare).slice(0, 12)},ev_${s.evaluare_amprenta.slice(0, 12)}`.replace(/,ev_.*/, ',ev_' + md5(s.evaluare_amprenta).slice(0, 12)), 'sursa: ' + c?.sursa)
    ast(ab, s.clarificare_id === c?.id && s.evaluare_in_curs_id === null && s.surse_sha === r.propune.foto.sha, 'legătura semnal → ciornă / evaluare închisă')
    const st = await stareBaza(db, c.id)
    if (st) ast(ab, st.stare === 'necesita_review', 'starea bazei: ' + JSON.stringify(st))
    const ev = (await q(db, `SELECT stare FROM public.ofertare_cantitati_evaluari WHERE id = $1`, [r.propune.evaluare_id]))[0]
    ast(ab, ev.stare === 'publicata', 'evaluarea publicată')
    // a doua evaluare, nimic schimbat → aceeași ciornă, neatinsă, aceeași amprentă
    const r2 = await evalueaza(db)
    ast(ab, r2.semnale.length === 1 && r2.semnale[0].clarificare === 'neatinsa' && (await ciorne(db)).length === 1, 'reevaluare fără schimbări: ' + JSON.stringify(r2.semnale))
    const s2 = (await semnalCunoscut(db))[0]
    ast(ab, s2.evaluare_amprenta === s.evaluare_amprenta, 'amprenta evaluării stabilă')
  }
  S3['t3_natura'] = async (db, ab) => {
    await fixturaTichet(db, { cantitati: [{ denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1' }, { denumire: 'Montaj teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1' }] })
    const r = await evalueaza(db)
    const ss = await semnale(db)
    const fiz = ss.find(x => x.clasa === 'fizica'), mon = ss.find(x => x.clasa === 'montaj')
    ast(ab, fiz && fiz.verdict === 'diferenta' && Number(fiz.valoare_a) === 6400, 'fizica: ' + JSON.stringify(fiz?.verdict))
    ast(ab, mon && mon.verdict === 'de_verificat' && mon.motiv === 'o singură sursă', 'montaj = altă măsură, fără semnal de diferență: ' + JSON.stringify([mon?.verdict, mon?.motiv]))
    ast(ab, (await ciorne(db)).length === 1, 'o singură ciornă (pe fizica)')
  }
  S3['t3_total_vs_tronson'] = async (db, ab) => {
    const f = await fixturaTichet(db, { f3Text: PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 4.000', '004 SA11G2 TEAVA PE100 DN160 M 2.400'),
      obsF3: [], cantitati: [{ denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 4000, cod: 'SA11G1', obiect: 'X' }, { denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 2400, cod: 'SA11G2', obiect: 'Y' }] })
    const r = await evalueaza(db)
    const star = (await semnalCunoscut(db, LIC, '*'))[0], sx = (await semnalCunoscut(db, LIC, 'x'))[0], sy = (await semnalCunoscut(db, LIC, 'y'))[0]
    ast(ab, star && star.verdict === 'diferenta' && Number(star.valoare_a) === 6400 && Number(star.valoare_b) === 3995, '*: ' + JSON.stringify([star?.verdict, star?.valoare_a, star?.valoare_b]))
    ast(ab, sx && sx.verdict === 'de_verificat' && sx.motiv === 'o singură sursă' && Number(sx.valoare_a) === 4000, 'X fără document: ' + JSON.stringify([sx?.verdict, sx?.motiv]))
    ast(ab, sy && sy.verdict === 'de_verificat', 'Y fără document')
    // ATR cu obiect X (3995) → măsura X: 4000 vs 3995 → in_regula; * nu primește valoarea lui
    await db.query(`UPDATE public.ofertare_cant_obs SET obiect_cheie = 'X' WHERE extragere_id = $1`, [f.exAtr.id]).catch(() => null)
    const ok2 = await incearca(db, `UPDATE public.ofertare_cant_obs SET obiect_cheie = 'X' WHERE extragere_id = $1`, [f.exAtr.id])
    if (!ok2.ok) {
      // observațiile sunt imuabile: o extragere nouă cu observația pe obiectul X
      await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = $1`, [f.dAtr])
      await extragere(db, f.dAtr, { obs: [OBS_ATR(3995, { obiect: 'X' })] })
    }
    const r2 = await evalueaza(db)
    const star2 = (await semnalCunoscut(db, LIC, '*'))[0], sx2 = (await semnalCunoscut(db, LIC, 'x'))[0]
    ast(ab, sx2 && sx2.verdict === 'in_regula' && Number(sx2.valoare_b) === 3995, 'X: 4000 vs 3995 → in_regula: ' + JSON.stringify([sx2?.verdict, sx2?.motiv, sx2?.valoare_b]))
    ast(ab, star2 && star2.verdict === 'de_verificat' && star2.motiv === 'o singură sursă' && star2.valoare_b === null, '* nu primește valoarea obiectului X: ' + JSON.stringify([star2?.verdict, star2?.motiv]))
    const c = await ciorne(db)
    ast(ab, c.length === 1 && c[0].status === 'retrasa' && c[0].baza_generare.retrasa_de === 'sistem', 'ciorna * retrasă de sistem: ' + JSON.stringify(c.map(x => [x.status, x.baza_generare?.retrasa_de])))
  }
  S3['t3_total_componente'] = async (db, ab) => {
    const txt = PAG(1, 'AVIZ TEHNIC DE RACORDARE', 'Tronson 1: în lungime totală de 2.000 m.', 'Tronson 2: în lungime totală de 1.995 m.', 'Total rețea: în lungime totală de 3.995 m.')
    const f = await fixturaTichet(db, { atrText: txt, obsAtr: [OBS_ATR(2000, { citat: 'în lungime totală de 2.000 m' }), OBS_ATR(1995, { citat: 'în lungime totală de 1.995 m' }), OBS_ATR(3995, { citat: 'în lungime totală de 3.995 m', e_total: true })] })
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'diferenta' && Number(s.valoare_b) === 3995, 'componente 2000 + 1995 cu total 3995 → B = 3995 (nu 7990): ' + JSON.stringify([s.verdict, s.valoare_b]))
    // total 4500 ≠ componente
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ TEHNIC DE RACORDARE', 'Tronson 1: în lungime totală de 2.000 m.', 'Tronson 2: în lungime totală de 1.995 m.', 'Total rețea: în lungime totală de 4.500 m.')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(2000, { citat: 'în lungime totală de 2.000 m' }), OBS_ATR(1995, { citat: 'în lungime totală de 1.995 m' }), OBS_ATR(4500, { citat: 'în lungime totală de 4.500 m', e_total: true })] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'de_verificat' && s.motiv === 'totalul documentului nu corespunde componentelor', 'total 4500: ' + JSON.stringify([s.verdict, s.motiv]))
    // doar total
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ TEHNIC DE RACORDARE', 'Total rețea: în lungime totală de 3.995 m.')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(3995, { e_total: true })] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'diferenta' && Number(s.valoare_b) === 3995, 'doar total → 3995: ' + JSON.stringify([s.verdict, s.valoare_b]))
  }
  S3['t3_doua_documente_b'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    const d2 = await document(db, { tip: 'alta', nume: 'DOC_ATR_T2', text: ATR_TEXT })
    await extragere(db, d2, { obs: [OBS_ATR(3995)] })
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'diferenta' && Number(s.valoare_b) === 3995 && s.valori_b.length === 2, 'două documente B cu 3995 → B = 3995, nu 7990: ' + JSON.stringify([s.verdict, s.valoare_b, s.valori_b.length]))
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [d2, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 6.400 m.')])
    await extragere(db, d2, { obs: [OBS_ATR(6400)] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'de_verificat' && s.motiv === 'documentele diferă între ele', 'DOC_ATR_T2 = 6400: ' + JSON.stringify([s.verdict, s.motiv]))
  }
  S3['t3_extrageri_duble + t3_identitate_pozitiei'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    const exB = await extragere(db, f.dAtr, { extractor: 'extr-B', obs: [OBS_ATR(3995)] })
    const r = await evalueaza(db)
    const s = (await semnalCunoscut(db))[0]
    const m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, m.filter(x => x.parte === 'b').length === 1 && Number(s.valoare_b) === 3995, 'o singură componentă B (extragerea cu id maxim): ' + JSON.stringify(m.map(x => [x.parte, x.obs_id])))
    ast(ab, r.propune.ignorate.length === 1 && Number(r.propune.ignorate[0].extragere_id) === f.exAtr.id && r.propune.ignorate[0].motiv === 'extragere_neautoritativa', 'ignorate: ' + JSON.stringify(r.propune.ignorate))
    ast(ab, Number(r.propune.foto.documente.find(x => Number(x.id) === f.dAtr).extragere_id) === exB.id, 'fotografia: extragerea autoritativă = B (id maxim)')
    // o extragere pe sha vechi → ignorată
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = $1`, [f.dAtr])
    const r2 = await evalueaza(db)
    ast(ab, r2.propune.ignorate.every(x => x.motiv === 'sha_vechi') && r2.propune.ignorate.length === 2, 'sha vechi ignorate: ' + JSON.stringify(r2.propune.ignorate))
    const s2 = (await semnalCunoscut(db))[0]
    ast(ab, s2.verdict === 'de_verificat' && s2.motiv === 'o singură sursă', 'fără extragere autoritativă pe textul nou → o singură sursă: ' + JSON.stringify([s2.verdict, s2.motiv]))
    // două poziții F3 cu aceeași denumire și surse diferite → ambele; aceeași poziție în două măsurători → o dată (numărată o dată în A)
    const d3 = await document(db, { tip: 'formular', nume: 'DOC_F3_T3', text: F3_TEXT })
    await extragere(db, d3, { obs: [] })
    await cantitate(db, { denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1', surse: [d3] })
    await extragere(db, f.dAtr, { obs: [OBS_ATR(3995)] })
    await evalueaza(db)
    const s3 = (await semnalCunoscut(db))[0]
    ast(ab, Number(s3.valoare_a) === 12800 && (await masuratori(db, s3.id, s3.evaluare_id)).filter(x => x.parte === 'a').length === 2, 'două poziții F3 → A = 12800: ' + JSON.stringify([s3.valoare_a]))
  }
  S3['t3_identitate_pozitiei_dublura'] = async (db, ab) => {
    // aceeași poziție scrisă de două ori ca măsurătoare `a` (între propune și publică, ca postgres) → numărată O dată
    await fixturaTichet(db)
    const p = await propune(db)
    const m = (await q(db, `SELECT * FROM public.ofertare_cantitati_masuratori WHERE evaluare_id = $1 AND parte = 'a' LIMIT 1`, [p.evaluare_id]))[0]
    await db.query(`INSERT INTO public.ofertare_cantitati_masuratori (licitatie_id, evaluare_id, semnal_id, parte, cantitate_id, document_id, revizie, doc_sha256, pagina, fel_dovada, rand, celula, valoare_text, um_text, valoare, um_canonica, natura, verificare)
      SELECT licitatie_id, evaluare_id, semnal_id, parte, cantitate_id, document_id, revizie, doc_sha256, pagina, fel_dovada, rand, celula, valoare_text, um_text, valoare, um_canonica, natura, verificare FROM public.ofertare_cantitati_masuratori WHERE id = $1`, [m.id])
    await publica(db, LIC, p.evaluare_id, p.token)
    const s = (await semnalCunoscut(db))[0]
    ast(ab, Number(s.valoare_a) === 6400 && s.inventar.a.componente === 1, 'cantitate_id dublat → A = 6400, o componentă: ' + JSON.stringify([s.valoare_a, s.inventar.a]))
  }
  S3['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua'] = async (db, ab) => {
    // r1 P1: codul articolului e ancoră ca TOKEN întreg — „SA11G1” NU e dovedit de rândul „SA11G10 … 6.400” (alt articol, aceeași cantitate)
    await fixturaTichet(db, { f3Text: PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G10 TEAVA PE100 DN110 M 6.400'), obsF3: [] })
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    let m = (await masuratori(db, s.id, s.evaluare_id)).filter(x => x.parte === 'a')
    ast(ab, m.length === 1 && m[0].verificare === 'nedovedit' && m[0].rand === null && s.verdict === 'neverificat', 'SA11G1 nu e dovedit de SA11G10: ' + JSON.stringify(m.map(x => [x.verificare, x.rand])))
    // același cod pe DOUĂ rânduri distincte cu aceeași cantitate → asocierea poziție → rând nu e neambiguă → rand_ambiguu (la om), nu „primul rând”
    const f2 = await fixturaTichet(db, { lic: LIC2, f3Text: PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400', '007 SA11G1 TEAVA PE100 DN160 M 6.400'), obsF3: [] })
    await evalueaza(db, LIC2)
    s = (await semnalCunoscut(db, LIC2))[0]
    m = (await masuratori(db, s.id, s.evaluare_id)).filter(x => x.parte === 'a')
    ast(ab, m.length === 1 && m[0].verificare === 'rand_ambiguu' && m[0].valoare === null && s.verdict === 'neverificat', 'două rânduri cu același cod și aceeași cantitate → rand_ambiguu: ' + JSON.stringify(m.map(x => [x.verificare, x.valoare])))
    // r2 P1: rândul-ancoră se alege INDEPENDENT de cantitate — două rânduri cu același cod și cantități DIFERITE (doar al doilea are 6.400) → rand_ambiguu, nu „ok pe rândul care are cantitatea”
    const reeval = async (text) => {
      await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE licitatie_id = $1 AND nume_original = 'DOC_F3_T'`, [LIC2, text])
      await evalueaza(db, LIC2)
      s = (await semnalCunoscut(db, LIC2))[0]
      return (await masuratori(db, s.id, s.evaluare_id)).filter(x => x.parte === 'a')
    }
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 250', '007 SA11G1 TEAVA PE100 DN110 M 6.400'))
    ast(ab, m.length === 1 && m[0].verificare === 'rand_ambiguu' && m[0].valoare === null && m[0].rand === '003 SA11G1 TEAVA PE100 DN160 M 250' && s.verdict === 'neverificat',
      'același cod pe două rânduri cu cantități diferite → rand_ambiguu (primul rând păstrat ca dovadă vizibilă): ' + JSON.stringify(m.map(x => [x.verificare, x.valoare, x.rand])))
    // un singur rând-ancoră, dar cu altă cantitate decât poziția din ERP → nedovedit, cu rândul păstrat (nu „ok” pe alt rând, nu dispare)
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 250'))
    ast(ab, m.length === 1 && m[0].verificare === 'nedovedit' && m[0].valoare === null && m[0].rand === '003 SA11G1 TEAVA PE100 DN160 M 250' && m[0].fel_dovada === 'tabel' && s.verdict === 'neverificat',
      'rândul unic al codului cu altă cantitate (250 ≠ 6400) → nedovedit, rândul păstrat: ' + JSON.stringify(m.map(x => [x.verificare, x.rand, x.celula])))
    // codul la începutul rândului și cu mai multe spații: tot token întreg → ok
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', 'SA11G1  TEAVA PE100 DN160   M  6.400'))
    ast(ab, m.length === 1 && m[0].verificare === 'ok' && Number(m[0].valoare) === 6400, 'codul ca token la început de rând, spații multiple → ok: ' + JSON.stringify(m.map(x => [x.verificare, x.valoare])))
    // rândul unic cu cantitatea în coloana greșită (DN = 6.400? nu: cantitatea 6.400 ca DN și 160 ca cantitate) → verificarea deterministă pică (coloana), rândul păstrat
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM DN Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400 160'))
    ast(ab, m.length === 1 && m[0].verificare === 'coloana_necunoscuta' && m[0].valoare === null && m[0].rand === '003 SA11G1 TEAVA PE100 DN160 M 6.400 160', 'cantitatea pe altă coloană → coloana_necunoscuta, nu ok: ' + JSON.stringify(m.map(x => [x.verificare, x.celula])))
    // r3 P1: același rând revendicat de DOUĂ poziții (același cod pe obiecte diferite, un singur rând în F3) → niciuna nu-l primește (rand_ambiguu la ambele), nu A = 12800 dintr-un rând de 6.400
    const p2 = await cantitate(db, { lic: LIC2, denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1', obiect: 'Y', surse: [f2.dF3] })
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400'))
    ast(ab, m.length === 2 && m.every(x => x.verificare === 'rand_ambiguu' && x.valoare === null && x.rand === '003 SA11G1 TEAVA PE100 DN160 M 6.400') && s.verdict === 'neverificat' && s.valoare_a === null,
      'un rând revendicat de două poziții → rand_ambiguu la ambele, A nedefinit: ' + JSON.stringify(m.map(x => [x.cantitate_id, x.verificare, x.valoare])))
    await db.query(`UPDATE public.ofertare_cantitati SET status = 'retrasa' WHERE id = $1`, [p2])
    // r3 P1: fără cod, denumiri incluse una în alta: ancora = denumirea URMATĂ de UM-ul poziției; rândul „… DN160 SDR17 M 100” e al poziției SDR17, nu și al celei scurte
    const p3 = await cantitate(db, { lic: LIC2, denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 100, cod: null, surse: [f2.dF3] })
    const p4 = await cantitate(db, { lic: LIC2, denumire: 'Furnizare teava PE100 DN160 SDR17', um: 'M', cantitate: 100, cod: null, surse: [f2.dF3] })
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400', 'Nr. Denumire UM Cantitate', '007 Furnizare teava PE100 DN160 SDR17 M 100'))
    const m3 = m.find(x => Number(x.cantitate_id) === p3), m4 = m.find(x => Number(x.cantitate_id) === p4), m1 = m.find(x => Number(x.cantitate_id) === f2.cant[0])
    ast(ab, m3 && m3.verificare === 'nedovedit' && m3.rand === null && m4 && m4.verificare === 'ok' && Number(m4.valoare) === 100 && m1 && m1.verificare === 'ok' && Number(s.valoare_a) === 6500,
      'denumirea scurtă NU ia rândul denumirii lungi (nedovedit); poziția SDR17 → ok 100; A = 6400 + 100 doar din rândurile dovedite… agregare incompletă: ' + JSON.stringify(m.map(x => [x.cantitate_id, x.verificare, x.valoare])))
    ast(ab, s.verdict === 'neverificat' && /agregare incompletă/.test(s.motiv), 'poziția nedovedită → neverificat (agregare incompletă): ' + s.motiv)
    // rândul scurt există și el: fiecare poziție își ia rândul ei (denumire + UM ca ancoră)
    m = await reeval(PAG(1, 'Formularul F3', 'Nr. Denumire UM Cantitate', '006 Furnizare teava PE100 DN160 M 100', '007 Furnizare teava PE100 DN160 SDR17 M 100', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 6.400'))
    ast(ab, m.filter(x => x.verificare === 'ok').length === 3 && m.find(x => Number(x.cantitate_id) === p3)?.rand === '006 Furnizare teava PE100 DN160 M 100' && m.find(x => Number(x.cantitate_id) === p4)?.rand === '007 Furnizare teava PE100 DN160 SDR17 M 100',
      'denumiri incluse una în alta, fiecare cu rândul ei → ambele ok, pe rândul propriu: ' + JSON.stringify(m.map(x => [x.cantitate_id, x.verificare, x.rand])))
  }
  S3['t3_loturi'] = async (db, ab) => {
    // licitație cu loturi: F3 lot 1 vs observație lista {2} → măsuri diferite, fără semnal
    const f = await fixturaTichet(db, { lic: LIC_LOT, obsAtr: [OBS_ATR(3995, { lot_domeniu: 'lista', lot_nr: [2] })], cantitati: [{ denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1', lot_domeniu: 'lista', lot_nr: [1] }] })
    await evalueaza(db, LIC_LOT)
    let ss = await semnale(db, LIC_LOT)
    ast(ab, ss.length === 2 && ss.every(x => x.verdict === 'de_verificat' && x.motiv === 'o singură sursă') && new Set(ss.map(x => x.lot_nr)).size === 2, 'loturi diferite = măsuri diferite: ' + JSON.stringify(ss.map(x => [x.lot_nr, x.verdict, x.motiv])))
    ast(ab, (await ciorne(db, LIC_LOT)).length === 0, 'nicio ciornă')
    // lista {1,2} → lot necunoscut
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = $1`, [f.dAtr])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(3995, { lot_domeniu: 'lista', lot_nr: [1, 2] })] })
    await evalueaza(db, LIC_LOT)
    ss = await semnale(db, LIC_LOT)
    const nec = ss.find(x => x.element === 'necunoscut')
    ast(ab, nec && nec.verdict === 'de_verificat' && nec.motiv === 'lot necunoscut' && (await masuratori(db, nec.id, nec.evaluare_id)).some(x => x.verificare === 'lot_necunoscut' && x.fragment), 'lista {1,2} → lot necunoscut cu dovada: ' + JSON.stringify(ss.map(x => [x.element, x.verdict, x.motiv])))
    // toate pe licitație cu loturi → lot necunoscut
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = $1`, [f.dAtr])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(3995, { lot_domeniu: 'toate', lot_nr: [] })] })
    await evalueaza(db, LIC_LOT)
    ss = await semnale(db, LIC_LOT)
    ast(ab, ss.some(x => x.element === 'necunoscut' && x.motiv === 'lot necunoscut'), 'toate pe licitație cu loturi → lot necunoscut')
    // fara_loturi + toate + F3 lot NULL → aceeași măsură (cazul tichetului pe LIC)
    await fixturaTichet(db)
    await evalueaza(db)
    ast(ab, (await semnalCunoscut(db))[0]?.verdict === 'diferenta', 'fara_loturi: aceeași măsură')
    // stare_loturi schimbată → schimbata imediat
    const sh0 = (await foto(db)).sha
    await db.query(`UPDATE public.ofertare_licitatii SET stare_loturi = 'are_loturi' WHERE id = $1`, [LIC])
    ast(ab, (await foto(db)).sha !== sh0, 'stare_loturi schimbată → fotografie nouă')
  }
  S3['t3_neclasificat'] = async (db, ab) => {
    const f = await fixturaTichet(db, { atrText: PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 3.995 m.', 'teava DN160 si DN110 în lungime totală de 100 m'),
      obsAtr: [OBS_ATR(3995), OBS_ATR(100, { denumire: 'teava DN160 si DN110', dn: [160, 110], citat: 'în lungime totală de 100 m' })] })
    await evalueaza(db)
    let ss = await semnale(db)
    const nec = ss.find(x => x.element === 'necunoscut'), cun = ss.find(x => x.element === 'teava_pe_dn160')
    ast(ab, nec && nec.verdict === 'de_verificat' && nec.motiv === 'element sau natură necunoscute', 'observația neclasificată → de_verificat: ' + JSON.stringify([nec?.verdict, nec?.motiv]))
    ast(ab, cun && cun.verdict === 'diferenta', 'măsura cunoscută neafectată de observația B neclasificată: ' + JSON.stringify([cun?.verdict, cun?.motiv]))
    // o poziție F3 neclasificată cu UM m pe același obiect → măsura cunoscută neverificat
    const cId = await cantitate(db, { denumire: 'Lucrari diverse retea', um: 'M', cantitate: 10, cod: 'ZZ1', surse: [f.dF3] })
    await evalueaza(db)
    ss = await semnale(db)
    const cun2 = ss.find(x => x.element === 'teava_pe_dn160')
    ast(ab, cun2.verdict === 'neverificat' && cun2.motiv === 'poziții F3 neclasificate', 'poziție F3 neclasificată (m) blochează: ' + JSON.stringify([cun2.verdict, cun2.motiv]))
    // aceeași cu UM ore → neafectată
    await db.query(`UPDATE public.ofertare_cantitati SET um = 'ore' WHERE id = $1`, [cId])
    await evalueaza(db)
    ss = await semnale(db)
    const cun3 = ss.find(x => x.element === 'teava_pe_dn160')
    ast(ab, cun3.verdict === 'diferenta', 'poziție neclasificată cu UM ore nu blochează: ' + JSON.stringify([cun3.verdict, cun3.motiv]))
  }
  S3['t3_incomplet'] = async (db, ab) => {
    // poziție F3 fără surse → fara_sursa
    const f = await fixturaTichet(db, { cantitati: [{ denumire: 'Furnizare teava PE100 DN160', um: 'M', cantitate: 6400, cod: 'SA11G1', surse: null }] })
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    let m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, s.verdict === 'neverificat' && /^agregare incompletă/.test(s.motiv) && m.some(x => x.parte === 'a' && x.verificare === 'fara_sursa' && x.document_id === null), 'fără surse: ' + JSON.stringify([s.verdict, s.motiv, m.map(x => x.verificare)]))
    // sursa inexistentă: triggerul de proveniență (20261026a) refuză un id inexistent la scriere → calea reală e documentul șters după scriere (t3_document_sters);
    // aici scriem ocolind triggerul (ca un rând vechi) ca să probăm fara_sursa pe un id care nu mai există
    await db.exec(`SET session_replication_role = replica`)
    await db.query(`UPDATE public.ofertare_cantitati SET surse_document_ids = ARRAY[999999]::bigint[] WHERE licitatie_id = $1`, [LIC])
    await db.exec(`SET session_replication_role = origin`)
    await evalueaza(db); s = (await semnalCunoscut(db))[0]; m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, m.some(x => x.parte === 'a' && x.verificare === 'fara_sursa' && x.document_id === null), 'sursa inexistentă → fara_sursa: ' + JSON.stringify(m.map(x => [x.parte, x.verificare])))
    // rând negăsit → nedovedit
    await db.query(`UPDATE public.ofertare_cantitati SET surse_document_ids = ARRAY[$2]::bigint[], cantitate = 6401 WHERE licitatie_id = $1`, [LIC, f.dF3])
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]; m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, s.verdict === 'neverificat' && m.some(x => x.parte === 'a' && x.verificare === 'nedovedit' && Number(x.document_id) === f.dF3), 'rând negăsit → nedovedit: ' + JSON.stringify(m.map(x => [x.parte, x.verificare])))
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = $1`, [LIC])
    // pagina ATR în pagini_necitite (ale rulării) → agregare incompletă
    let r = await evalueaza(db, LIC, { pagini: { ...PAGINI_GOL, pagini_necitite: [{ document_id: f.dAtr, pagini: [1] }] } })
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && /agregare incompletă \(DOC_ATR_T: pagini 1\)/.test(s.motiv), 'pagini_necitite ale rulării: ' + s.motiv)
    // felii_incomplete pe F3 (de la edge) → idem; inventarul intră în amprentă: aceleași măsurători / verdict / valori, alt inventar → altă amprentă
    const ampr0 = s.evaluare_amprenta
    r = await evalueaza(db, LIC, { pagini: { ...PAGINI_GOL, pagini_necitite: [{ document_id: f.dAtr, pagini: [1] }], felii_incomplete: [{ extragere_id: f.exF3.id, felie_nr: 0, motiv: 'deficit' }] } })
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && /DOC_F3_T: felii 0 deficit/.test(s.motiv) && s.evaluare_amprenta !== ampr0, 'felii_incomplete pe F3 + inventar diferit → altă amprentă: ' + s.motiv)
    // o pagină a ATR-ului fără felie gata → idem (pagina 2 adăugată în text, extragere nouă cu felia doar pe pagina 1)
    const txt2 = ATR_TEXT + PAG(2, 'pagina a doua')
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, txt2])
    await extragere(db, f.dAtr, { felii: [{ nr: 0, de_la: 0, pana_la: ATR_TEXT.length, stare: 'gata', obs: [OBS_ATR(3995)] }] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && /DOC_ATR_T: pagini 2/.test(s.motiv), 'pagină fără felie gata: ' + s.motiv)
    // observație nedovedită → nedovedit (alt extractor pe textul inițial: indexul unic al cache-ului nu lasă două extrageri gata pe același text / extractor)
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, ATR_TEXT])
    await extragere(db, f.dAtr, { extractor: 'extr-B', obs: [OBS_ATR(3995, { dovedita: false })] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]; m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, s.verdict === 'neverificat' && m.some(x => x.parte === 'b' && x.verificare === 'nedovedit' && x.fragment), 'pozitie_dovedita = false → nedovedit cu citatul: ' + JSON.stringify(m.map(x => [x.parte, x.verificare])))
    // pagina ATR în pagini_necitite ale DOCUMENTULUI
    await extragere(db, f.dAtr, { extractor: 'extr-C', obs: [OBS_ATR(3995)] })
    await db.query(`UPDATE public.ofertare_documente_atribuire SET pagini_necitite = '{1}' WHERE id = $1`, [f.dAtr])
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && /DOC_ATR_T: pagini 1/.test(s.motiv), 'pagini_necitite ale documentului: ' + s.motiv)
  }
  S3['t3_document_necitit + t3_incomplet_f3'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    const d2 = await document(db, { tip: 'alta', nume: 'DOC_ATR_T2', text: ATR_TEXT })
    await evalueaza(db, LIC, { pagini: { ...PAGINI_GOL, documente_necitite: [d2] } })
    let s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && s.motiv === 'document necitit (DOC_ATR_T2)', 'documente_necitite → toate neverificat: ' + s.motiv)
    ast(ab, (await ciorne(db)).length === 0, 'nicio ciornă pe neverificat')
    // felii_incomplete pe extragerea F3 (sursa A), deși A are dovadă ok
    await evalueaza(db, LIC, { pagini: { ...PAGINI_GOL, felii_incomplete: [{ extragere_id: f.exF3.id, felie_nr: 0, motiv: 'incerte' }] } })
    s = (await semnalCunoscut(db))[0]
    const m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, s.verdict === 'neverificat' && /agregare incompletă \(DOC_F3_T: felii 0 incerte\)/.test(s.motiv) && m.filter(x => x.parte === 'a').every(x => x.verificare === 'ok'), 'F3 cu felie incompletă: ' + s.motiv)
    // o pagină a F3-ului fără felie gata
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dF3, F3_TEXT + PAG(2, 'anexa')])
    await extragere(db, f.dF3, { felii: [{ nr: 0, de_la: 0, pana_la: F3_TEXT.length, stare: 'gata', obs: [OBS_F3] }] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat' && /DOC_F3_T: pagini 2/.test(s.motiv), 'pagina F3 fără felie gata: ' + s.motiv)
    // regula 1 înaintea tuturor: document necitit + felii incomplete → document necitit
    await evalueaza(db, LIC, { pagini: { ...PAGINI_GOL, documente_necitite: [d2], felii_incomplete: [{ extragere_id: f.exF3.id, felie_nr: 0, motiv: 'incerte' }] } })
    s = (await semnalCunoscut(db))[0]
    ast(ab, /^document necitit/.test(s.motiv), 'ordinea regulilor: (1) înaintea (4)')
  }
  S3['t3_ordinea_regulilor + t3_formula'] = async (db, ab) => {
    // nedovedit + total ≠ componente → neverificat (4 înaintea 6)
    const txt = PAG(1, 'AVIZ', 'Tronson 1: în lungime totală de 2.000 m.', 'Total rețea: în lungime totală de 4.500 m.')
    const f = await fixturaTichet(db, { atrText: txt, obsAtr: [OBS_ATR(2000, { citat: 'în lungime totală de 2.000 m' }), OBS_ATR(1995, { citat: 'în lungime totală de 1.995 m', dovedita: false }), OBS_ATR(4500, { citat: 'în lungime totală de 4.500 m', e_total: true })] })
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'neverificat', '(4) înaintea (6): ' + JSON.stringify([s.verdict, s.motiv]))
    // semnal necunoscut cu componentă neclasificat → de_verificat (2), nu neverificat
    const f2lic = LIC2
    await fixturaTichet(db, { lic: LIC2, atrText: PAG(1, 'AVIZ', 'ceva în lungime totală de 10 m'), obsAtr: [OBS_ATR(10, { denumire: 'ceva nedefinit', dn: [], tip: 'alt', citat: 'în lungime totală de 10 m' })] })
    await evalueaza(db, LIC2)
    const nec = (await semnale(db, LIC2)).find(x => x.element === 'necunoscut')
    ast(ab, nec && nec.verdict === 'de_verificat', '(2) pe necunoscut: ' + JSON.stringify([nec?.verdict, nec?.motiv]))
    // formula: 6400 vs 6080 → in_regula la 0,05; diferenta la 0,04
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', 'în lungime totală de 6.080 m')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(6080)] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'in_regula' && s.motiv === null, '6400 vs 6080 la 5 %: in_regula: ' + JSON.stringify([s.verdict, s.motiv]))
    await db.query(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag) VALUES ($1, 0.04)`, [LIC])
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'diferenta', '6400 vs 6080 la 4 %: diferenta: ' + JSON.stringify([s.verdict, s.motiv]))
    // 0 vs 0,5 → valoare zero (10 înaintea 11); 3 vs 3,5 → in_regula; a = b = 0 → in_regula; 0 vs 100 → valoare zero
    let pas = 0
    for (const [a, b, verdict, motiv] of [[0, 100, 'de_verificat', 'valoare zero'], [3, 3.5, 'in_regula', null], [0, 0, 'in_regula', null]]) {
      pas++
      await db.query(`UPDATE public.ofertare_cantitati SET cantitate = $2 WHERE licitatie_id = $1`, [LIC, a])
      await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dF3, PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', `003 SA11G1 TEAVA PE100 DN160 M ${String(a).replace('.', ',')}`, `pasul ${pas}`)])
      await extragere(db, f.dF3, { obs: [] })
      const bt = b === 3.5 ? '3,5' : String(b)
      await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', `în lungime totală de ${bt} m`, `pasul ${pas}`)])
      await extragere(db, f.dAtr, { obs: [OBS_ATR(b, { citat: `în lungime totală de ${bt} m` })] })
      await evalueaza(db)
      s = (await semnalCunoscut(db))[0]
      if (b === 3.5) ast(ab, s.verdict === 'neverificat', `3 vs 3,5: valoarea neîntreagă în text liber e refuzată (numar_neintreg) → neverificat: ${s.verdict} ${s.motiv}`)
      else ast(ab, s.verdict === verdict && s.motiv === motiv, `${a} vs ${b}: ${JSON.stringify([s.verdict, s.motiv])} (aștepta ${verdict})`)
    }
    // 3 vs 3,5 prin tabel (neîntreg acceptat la tabel): măsura din documentul B ca tabel nu e în B (rolurile F3 nu intră) → testat în t2; aici |a−b| < 1 cu valori întregi: 3 vs 4
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 3 WHERE licitatie_id = $1`, [LIC])
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dF3, PAG(1, 'Formularul F3', 'Nr. Cod Denumire UM Cantitate', '003 SA11G1 TEAVA PE100 DN160 M 3')])
    await extragere(db, f.dF3, { obs: [] })
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', 'în lungime totală de 4 m')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(4, { citat: 'în lungime totală de 4 m' })] })
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'diferenta', '3 vs 4 (33 %, |Δ| = 1 ≥ 1 unitate) → diferenta: ' + JSON.stringify([s.verdict, s.motiv]))
  }
  S3['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    // fotografie veche la propune
    const fv = await foto(db)
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE licitatie_id = $1`, [LIC])
    const p0 = await propune(db, LIC, { fotoDat: fv })
    ast(ab, p0.refuz === 'evaluare_depasita' && (await q(db, `SELECT count(*)::int n FROM public.ofertare_cantitati_evaluari`))[0].n === 0, 'fotografie veche la propune → evaluare_depasita, zero rânduri: ' + JSON.stringify(p0))
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = $1`, [LIC])
    // schimbare între propune și publică
    const p1 = await propune(db)
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE licitatie_id = $1`, [LIC])
    const pub1 = await publica(db, LIC, p1.evaluare_id, p1.token)
    const ev1 = (await q(db, `SELECT e.stare, (SELECT count(*)::int FROM public.ofertare_cantitati_masuratori m WHERE m.evaluare_id = e.id) AS m FROM public.ofertare_cantitati_evaluari e WHERE e.id = $1`, [p1.evaluare_id]))[0]
    ast(ab, pub1.refuz === 'evaluare_depasita' && ev1.stare === 'depasita' && ev1.m === 0 && (await semnale(db)).every(x => x.evaluare_in_curs_id === null && x.verdict === null), 'schimbare între propune și publică: ' + JSON.stringify([pub1, ev1]))
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = $1`, [LIC])
    // izolare: A-propune, B-propune → A depasita; A-publică → refuz; B-publică → publicată
    const pA = await propune(db), pB = await propune(db)
    const stA = (await q(db, `SELECT stare FROM public.ofertare_cantitati_evaluari WHERE id = $1`, [pA.evaluare_id]))[0].stare
    const pubA = await publica(db, LIC, pA.evaluare_id, pA.token)
    const nSem0 = (await semnale(db)).filter(x => x.verdict !== null).length
    const pubB = await publica(db, LIC, pB.evaluare_id, pB.token)
    ast(ab, stA === 'depasita' && pubA.refuz === 'evaluare_necunoscuta' && nSem0 === 0 && pubB.semnale?.length >= 1 && (await semnalCunoscut(db))[0].verdict === 'diferenta', 'izolare: ' + JSON.stringify([stA, pubA, nSem0, pubB.n]))
    // token greșit
    const pC = await propune(db)
    const pubC = await publica(db, LIC, pC.evaluare_id, '00000000-0000-4000-8000-000000000000')
    ast(ab, pubC.refuz === 'evaluare_necunoscuta', 'token greșit → evaluare_necunoscuta')
    await publica(db, LIC, pC.evaluare_id, pC.token)
    // extragere nouă între RPC-uri → fotografia se schimbă (extragere_id / obs_sha) → publică = depasita; semnalul publicat → schimbata
    const pD = await propune(db)
    await extragere(db, f.dAtr, { extractor: 'extr-B', obs: [OBS_ATR(3995)] })
    const pubD = await publica(db, LIC, pD.evaluare_id, pD.token)
    ast(ab, pubD.refuz === 'evaluare_depasita', 'extragere nouă autoritativă între RPC-uri → evaluare_depasita')
    const s = (await semnalCunoscut(db))[0]
    ast(ab, s.surse_sha !== (await foto(db)).sha, 'semnalul publicat anterior nu mai e actual (surse_sha ≠ fotografia de acum)')
    const stB = await stareBaza(db, s.clarificare_id)
    if (stB) ast(ab, stB.stare === 'schimbata', 'ofertare_semnal_baza_stare → schimbata: ' + JSON.stringify(stB))
    // plafon vechi: observații pe pagina 250 dintr-un document mare (plafon 200) → pagina_nepermisa, neverificat; cu două documente B → neverificat, nu in_regula
    const d2txt = Array.from({ length: 250 }, (_, i) => PAG(i + 1, i === 249 ? 'Rețeaua este în lungime totală de 6.400 m.' : 'pagina ' + (i + 1))).join('')
    const d2 = await document(db, { tip: 'alta', nume: 'DOC_ATR_T2', text: d2txt })
    await extragere(db, d2, { obs: [OBS_ATR(6400, { pagina: 250 })] })
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 6.400 m.')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(6400)] })
    await evalueaza(db)
    let s2 = (await semnalCunoscut(db))[0]
    let m2 = await masuratori(db, s2.id, s2.evaluare_id)
    ast(ab, s2.verdict === 'neverificat' && /agregare incompletă/.test(s2.motiv) && m2.some(x => x.verificare === 'pagina_nepermisa' && Number(x.document_id) === d2 && x.valoare === null && x.fel_dovada === null)
      && s2.inventar.pagini_lipsa.some(x => Number(x.document_id) === d2 && x.pagini.includes(250)), 'plafon 200, obs pe pagina 250 + DOC_ATR_T curat 6400 → neverificat, NU in_regula: ' + JSON.stringify([s2.verdict, s2.motiv?.slice(0, 80), m2.map(x => [x.parte, x.verificare])]))
    await db.query(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id, plafon_pagini) VALUES ($1, 300)`, [LIC])
    await evalueaza(db)
    s2 = (await semnalCunoscut(db))[0]; m2 = await masuratori(db, s2.id, s2.evaluare_id)
    ast(ab, s2.verdict === 'in_regula' && m2.filter(x => x.parte === 'b').every(x => x.verificare === 'ok') && s2.valori_b.length === 2, 'plafon 300 → incluse ca ok → in_regula: ' + JSON.stringify([s2.verdict, s2.motiv]))
    // felie reluată (încercarea 2, fără observații noi) între propune și publică: aceeași extragere, aceleași observații → doar felii_sha se schimbă → depasita
    const pE = await propune(db)
    const exA = (await q(db, `SELECT max(id) AS id FROM public.ofertare_cant_extrageri WHERE document_id = $1 AND stare = 'gata'`, [f.dAtr]))[0].id
    await db.query(`INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, stare, motiv_reluare, inchisa_la)
      SELECT munca_id, 2, extragere_id, felie_nr, de_la, pana_la, sha_felie, 'gata', 'reluata in proba', now() FROM public.ofertare_cant_felii WHERE extragere_id = $1 AND incercare = 1`, [exA])
    const pubE = await publica(db, LIC, pE.evaluare_id, pE.token)
    ast(ab, pubE.refuz === 'evaluare_depasita', 'felie reluată între RPC-uri (doar felii_sha schimbat) → evaluare_depasita: ' + JSON.stringify(pubE.refuz))
  }
  S3['t3_tranzitii + t3_document_sters + t3_identitate_disparuta'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    await evalueaza(db)
    let c = (await ciorne(db))[0], s = (await semnalCunoscut(db))[0]
    const text0 = c.intrebare
    // prag 0,5 → 37,6 % nu mai e diferență → ciorna retrasă de sistem
    await db.query(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag) VALUES ($1, 0.5)`, [LIC])
    let r = await evalueaza(db)
    c = (await ciorne(db))[0]
    ast(ab, r.semnale[0].clarificare === 'retrasa' && c.status === 'retrasa' && c.baza_generare.retrasa_de === 'sistem' && c.baza_generare.retrasa_motiv === 'verdict_in_regula', 'prag 0,5 → retrasa de sistem: ' + JSON.stringify([r.semnale[0].clarificare, c.status, c.baza_generare.retrasa_de, c.baza_generare.retrasa_motiv]))
    const jur = (await q(db, `SELECT eveniment FROM public.ofertare_clarificari_jurnal WHERE clarificare_id = $1`, [c.id]))
    ast(ab, jur.some(x => x.eveniment === 'retrasa'), 't5_jurnal: retragerea de sistem jurnalizată')
    // prag 0,05 → reactivată
    await db.query(`UPDATE public.ofertare_cantitati_setari SET prag = 0.05 WHERE licitatie_id = $1`, [LIC])
    r = await evalueaza(db)
    c = (await ciorne(db))[0]
    ast(ab, r.semnale[0].clarificare === 'reactivata' && c.status === 'propunere' && !('retrasa_de' in c.baza_generare) && c.intrebare === text0, 'prag 0,05 → reactivata: ' + JSON.stringify([r.semnale[0].clarificare, c.status]))
    // retrasă de OM (UPDATE ca authenticated cu drept) → retrasa_de = 'om' pus de trigger (Task 4) → rămâne retrasă, reaparut_dupa_respingere
    const w = await scrieCa(db, 'RESP', `UPDATE public.ofertare_clarificari SET status = 'retrasa' WHERE id = $1`, [c.id])
    ast(ab, w.ok, 'omul retrage ciorna: ' + (w.message || ''))
    c = (await ciorne(db))[0]
    const trgNou = (await q(db, `SELECT md5(replace(prosrc, chr(13), '')) <> '2183cb89a14d499311ac823bb41ce204' AS nou FROM pg_proc WHERE proname = 'fn_trg_ofertare_clarificari_baza'`))[0].nou
    if (trgNou) ast(ab, c.baza_generare.retrasa_de === 'om' && c.baza_generare.retrasa_de_uid === U.RESP, 'retrasa_de = om pus de trigger: ' + JSON.stringify(c.baza_generare))
    else await db.query(`UPDATE public.ofertare_clarificari SET baza_generare = baza_generare || '{"retrasa_de": "om"}' WHERE id = $1`, [c.id])
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 3.990 m.')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(3990)] })
    r = await evalueaza(db)
    c = (await ciorne(db))[0]; s = (await semnalCunoscut(db))[0]
    ast(ab, r.semnale[0].clarificare === 'neatinsa' && c.status === 'retrasa' && s.reaparut_dupa_respingere === true && s.verdict === 'diferenta', 'retrasă de om rămâne retrasă, reaparut_dupa_respingere: ' + JSON.stringify([r.semnale[0].clarificare, c.status, s.reaparut_dupa_respingere]))
    // regenerare: ciornă nouă liberă (alt semnal pe LIC2), B schimbat → regenerata; editată → neatinsa
    const g = await fixturaTichet(db, { lic: LIC2 })
    await evalueaza(db, LIC2)
    let c2 = (await ciorne(db, LIC2))[0]
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [g.dAtr, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 3.990 m.')])
    await extragere(db, g.dAtr, { obs: [OBS_ATR(3990)] })
    r = await evalueaza(db, LIC2)
    const c2b = (await ciorne(db, LIC2))[0]
    ast(ab, r.semnale[0].clarificare === 'regenerata' && c2b.intrebare !== c2.intrebare && /3990 m/.test(c2b.intrebare) && c2b.status === 'propunere', 'B 3995 → 3990 pe propunere needitată → regenerata: ' + JSON.stringify([r.semnale[0].clarificare]))
    const e = await scrieCa(db, 'RESP', `UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (editat de om)' WHERE id = $1`, [c2b.id])
    ast(ab, e.ok, 'editarea textului de om: ' + (e.message || ''))
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [g.dAtr, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 3.980 m.')])
    await extragere(db, g.dAtr, { obs: [OBS_ATR(3980)] })
    r = await evalueaza(db, LIC2)
    const c2c = (await ciorne(db, LIC2))[0]
    const trgNou2 = (await q(db, `SELECT md5(replace(prosrc, chr(13), '')) <> '2183cb89a14d499311ac823bb41ce204' AS nou FROM pg_proc WHERE proname = 'fn_trg_ofertare_clarificari_baza'`))[0].nou
    ast(ab, r.semnale[0].clarificare === 'neatinsa' && /editat de om/.test(c2c.intrebare) && (!trgNou2 || c2c.baza_generare.text_editat_de), 'editată → neatinsa: ' + JSON.stringify([r.semnale[0].clarificare, c2c.baza_generare?.text_editat_de]))
    // document șters: DOC_ATR_T2 pe LIC2 (fără extragere, doar ca sursă nu e cazul) → folosim DELETE pe un document B fără FK-uri străine: creăm DOC_ATR_T3 cu extragere → nu se poate șterge (FK extrageri)
    //   → ștergem măsurătorile prin CASCADE la un document fără extragere: documentul-sursă al pozițiilor A pe LIC2 e DOC_F3_T (are extragere) → testul de ștergere e pe o licitație nouă
    // t3_identitate_disparuta: F3 DN160 → DN200 și ATR la fel pe LIC2 → identitatea veche fără componente → sursă dispărută, ciorna ei retrasă; identitatea nouă → diferenta, ciornă nouă
    await db.query(`UPDATE public.ofertare_cantitati SET denumire = 'Furnizare teava PE100 DN200' WHERE licitatie_id = $1`, [LIC2])
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [g.dAtr, PAG(1, 'AVIZ', 'Conducta PE100 Dn 200 în lungime totală de 3.980 m.')])
    await extragere(db, g.dAtr, { obs: [OBS_ATR(3980, { denumire: 'conducta PE100 Dn 200', dn: [200] })] })
    r = await evalueaza(db, LIC2)
    const ss2 = await semnale(db, LIC2), cc2 = await ciorne(db, LIC2)
    const vechi = ss2.find(x => x.element === 'teava_pe_dn160'), nou = ss2.find(x => x.element === 'teava_pe_dn200')
    ast(ab, vechi && vechi.verdict === 'de_verificat' && vechi.motiv === 'sursă dispărută' && nou && nou.verdict === 'diferenta', 'identitate dispărută / nouă: ' + JSON.stringify(ss2.map(x => [x.element, x.verdict, x.motiv])))
    ast(ab, cc2.length === 2 && cc2.find(x => x.cheie === 'auto_surse_' + vechi.identitate).status === 'propunere' && cc2.find(x => x.cheie === 'auto_surse_' + nou.identitate).status === 'propunere', 'ciorna veche EDITATĂ rămâne (neatinsă), ciornă nouă pe identitatea nouă: ' + JSON.stringify(cc2.map(x => [x.cheie.slice(0, 16), x.status])))
    ast(ab, cc2.map(x => x.nr).join(',') === '1,2', 'nr-urile alocate în ordine: ' + cc2.map(x => x.nr).join(','))
  }
  S3['t3_document_sters'] = async (db, ab) => {
    // documentul B fără extragere nu are observații → B din observații cere extragere → ștergerea documentului e refuzată de FK-urile extragerii (comportament existent).
    // Dovada deciziei 9 pe calea posibilă: documentul-sursă al pozițiilor A, fără extragere → măsurătorile a dispar în cascadă, fotografia se schimbă imediat, reevaluarea dă fara_sursa.
    const f = await fixturaTichet(db)
    const dS = await document(db, { tip: 'formular', nume: 'DOC_F3_SURSA', text: F3_TEXT })
    await db.query(`UPDATE public.ofertare_cantitati SET surse_document_ids = ARRAY[$2]::bigint[] WHERE licitatie_id = $1`, [LIC, dS])
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    const c = (await ciorne(db))[0]
    ast(ab, s.verdict === 'neverificat' && /DOC_F3_SURSA: pagini 1/.test(s.motiv), 'sursa fără extragere → pagini neacoperite: ' + s.motiv)
    const sha0 = (await foto(db)).sha
    const del = await incearca(db, `DELETE FROM public.ofertare_documente_atribuire WHERE id = $1`, [dS])
    const mA = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, del.ok && mA.filter(x => x.parte === 'a').length === 0 && mA.filter(x => x.parte === 'b').length === 1, 'DELETE document → măsurătorile a dispar (CASCADE), b rămân: ' + JSON.stringify([del.message, mA.map(x => x.parte)]))
    ast(ab, (await foto(db)).sha !== sha0 && s.surse_sha !== (await foto(db)).sha, 'fotografia se schimbă imediat')
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    const m = await masuratori(db, s.id, s.evaluare_id)
    ast(ab, m.some(x => x.parte === 'a' && x.verificare === 'fara_sursa') && s.verdict === 'neverificat', 'reevaluare: fara_sursa: ' + JSON.stringify(m.map(x => [x.parte, x.verificare])))
  }
  S3['t3_raspuns'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    const dR = await document(db, { tip: 'raspuns_clarificare', nume: 'RASPUNS_1', text: PAG(1, 'raspuns'), revizie: 'R1' })
    const dAlt = await document(db, { tip: 'alta', nume: 'ALT', text: PAG(1, 'x') })
    const leaga = (cont, sid, did, val) => ca(db, cont, `SELECT public.fn_ofertare_semnal_raspuns_leaga($1, $2, $3) x`, [sid, did, val])
    asteptMesaj(await leaga('RESP', s.id, dAlt, 3995), /CM_DOCUMENT/, 'document de alt tip', ab)
    asteptMesaj(await leaga('RESP', s.id, dR, null), /CM_VALOARE/, 'fără valoare', ab)
    asteptCod(await leaga('OF', s.id, dR, 3995), '42501', 'fără drept de decizie', ab)
    asteptCod(await leaga('STRAIN', s.id, dR, 3995), '42501', 'fără acces', ab)
    const okL = await scrieCa(db, 'RESP', `SELECT public.fn_ofertare_semnal_raspuns_leaga($1, $2, $3) x`, [s.id, dR, 3995])
    ast(ab, okL.ok && okL.rows[0].x.clarificare === 'retrasa', 'legarea corectă: ' + JSON.stringify(okL))
    s = (await semnale(db))[0]
    let c = (await ciorne(db))[0]
    ast(ab, s.rezolvat === true && s.rezolvare.document_id === dR && s.rezolvare.revizie === 'R1' && Number(s.rezolvare.valoare) === 3995 && s.rezolvare.de === U.RESP, 'rezolvarea scrisă: ' + JSON.stringify(s.rezolvare))
    ast(ab, c.status === 'retrasa' && c.baza_generare.retrasa_motiv === 'rezolvat_de_raspuns', 'ciorna needitată retrasă cu rezolvat_de_raspuns')
    // la următoarea publicare cu rezolvat = true nu se creează / reactivează ciornă
    const r = await evalueaza(db)
    ast(ab, r.semnale[0].verdict === 'diferenta' && r.semnale[0].clarificare === 'neatinsa' && (await ciorne(db))[0].status === 'retrasa', 'rezolvat → nicio ciornă nouă: ' + JSON.stringify(r.semnale[0]))
    // revizie nouă → rezolvat = false imediat; DELETE pe răspuns → false, semnal intact
    await db.query(`UPDATE public.ofertare_documente_atribuire SET revizie = 'R2' WHERE id = $1`, [dR])
    ast(ab, (await semnale(db))[0].rezolvat === false, 'revizie nouă → rezolvat = false imediat')
    await db.query(`UPDATE public.ofertare_documente_atribuire SET revizie = 'R1' WHERE id = $1`, [dR])
    ast(ab, (await semnale(db))[0].rezolvat === true, 'revizia revenită → true')
    await db.query(`DELETE FROM public.ofertare_documente_atribuire WHERE id = $1`, [dR])
    s = (await semnale(db))[0]
    ast(ab, s.rezolvat === false && s.rezolvare !== null && s.verdict === 'diferenta', 'DELETE pe răspuns → rezolvat = false, semnalul intact')
    // ciornă editată → neatinsă la legare
    const g = await fixturaTichet(db, { lic: LIC2 })
    await evalueaza(db, LIC2)
    const c2 = (await ciorne(db, LIC2))[0]
    await scrieCa(db, 'OWNER', `UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (editat)' WHERE id = $1`, [c2.id])
    const dR2 = await document(db, { lic: LIC2, tip: 'raspuns_clarificare', nume: 'RASPUNS_2', text: PAG(1, 'r'), revizie: null })
    const s2 = (await semnalCunoscut(db, LIC2))[0]
    const okL2 = await scrieCa(db, 'OWNER', `SELECT public.fn_ofertare_semnal_raspuns_leaga($1, $2, $3) x`, [s2.id, dR2, 6400])
    ast(ab, okL2.ok && okL2.rows[0].x.clarificare === 'neatinsa' && (await ciorne(db, LIC2))[0].status === 'propunere' && (await semnale(db, LIC2))[0].rezolvat === true, 'ciornă editată → neatinsă; revizie NULL → „-”: ' + JSON.stringify(okL2))
  }
  S3['t3_drept + t3_lista_actual + t3_felii + t3_context'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    const r = await evalueaza(db)
    for (const [fn, args] of [['fn_ofertare_semnale_fotografie', [LIC]], ['fn_ofertare_masuratori_propune', [LIC, '00000000-0000-4000-8000-000000000001', '{}', '{}']], ['fn_ofertare_semnale_publica', [LIC, 1, '00000000-0000-4000-8000-000000000001']],
      ['fn_ofertare_semnale_felii', [LIC, '{}', null, null, 10]], ['fn_ofertare_semnale_context', [LIC, 'x', f.dF3]]]) {
      const ph = args.map((_, i) => '$' + (i + 1)).join(', ')
      asteptCod(await ca(db, 'OWNER', `SELECT * FROM public.${fn}(${ph})`, args), '42501', `authenticated (owner) pe ${fn}`, ab)
      asteptCod(await ca(db, null, `SELECT * FROM public.${fn}(${ph})`, args, { rol: 'anon' }), '42501', `anon pe ${fn}`, ab)
    }
    for (const fn of ['fn_ofertare_semnale_setari', 'fn_ofertare_semnal_raspuns_leaga', 'fn_ofertare_semnale_lista']) {
      const ph = fn === 'fn_ofertare_semnale_lista' ? '($1)' : '($1, $2, $3)'
      asteptCod(await ca(db, null, `SELECT * FROM public.${fn}${ph}`, fn === 'fn_ofertare_semnale_lista' ? [LIC] : [LIC, 1, 1], { rol: 'service_role' }), '42501', `service_role pe ${fn}`, ab)
    }
    asteptCod(await ca(db, 'OF', `SELECT public.fn_ofertare_semnale_setari($1, 0.1, 100)`, [LIC]), '42501', 'setări fără drept de decizie', ab)
    asteptMesaj(await ca(db, 'RESP', `SELECT public.fn_ofertare_semnale_setari($1, 0.9, 100)`, [LIC]), /CM_SETARI/, 'setări în afara limitelor', ab)
    const st = await scrieCa(db, 'RESP', `SELECT public.fn_ofertare_semnale_setari($1, 0.1, 100) x`, [LIC])
    ast(ab, st.ok && (await q(db, `SELECT prag, plafon_pagini, setat_de FROM public.ofertare_cantitati_setari WHERE licitatie_id = $1`, [LIC]))[0].setat_de === U.RESP, 'setări cu drept: ' + JSON.stringify(st))
    asteptCod(await ca(db, 'STRAIN', `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC]), '42501', 'lista fără acces Ofertare', ab)
    asteptCod(await ca(db, null, `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC]), '42501', 'lista fără JWT', ab)
    // lista: setările schimbate → fotografia s-a schimbat → actual = false
    let l = await ca(db, 'OF', `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC])
    ast(ab, !l.code && l.rows.length === 1 && l.rows[0].actual === false && l.rows[0].in_curs === false && l.rows[0].rezolvat === false && l.rows[0].masuratori.length === 2 && l.rows[0].semnal.verdict === 'diferenta', 'lista după schimbarea setărilor: actual = false: ' + JSON.stringify(l.rows?.[0] && [l.rows[0].actual, l.rows[0].in_curs, l.rows[0].masuratori.length]))
    await evalueaza(db)
    l = await ca(db, 'OF', `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC])
    ast(ab, l.rows[0].actual === true, 'după reevaluare: actual = true')
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE licitatie_id = $1`, [LIC])
    l = await ca(db, 'OF', `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC])
    ast(ab, l.rows[0].actual === false, 'cantitate schimbată fără extragere → actual = false imediat')
    const p = await propune(db)
    l = await ca(db, 'OF', `SELECT * FROM public.fn_ofertare_semnale_lista($1)`, [LIC])
    ast(ab, l.rows[0].in_curs === true && l.rows[0].masuratori.every(x => Number(x.evaluare_id) !== p.evaluare_id), 'evaluare în curs: in_curs = true, măsurătorile doar ale evaluării publicate')
    await publica(db, LIC, p.evaluare_id, p.token)
    // felii: keyset, filtrul extragerilor, reluare, observații neatribuibile
    const txt7 = Array.from({ length: 7 }, (_, i) => PAG(i + 1, `pagina ${i + 1} în lungime totală de ${100 * (i + 1)} m`)).join('')
    const d7 = await document(db, { tip: 'alta', nume: 'DOC_7', text: txt7 })
    const offs = Array.from({ length: 7 }, (_, i) => txt7.indexOf(`⟦PAGINA ${i + 1}⟧`))
    const felii7 = Array.from({ length: 7 }, (_, i) => ({ nr: i, de_la: offs[i], pana_la: i === 6 ? txt7.length : offs[i + 1], stare: 'gata', obs: [OBS_ATR(100 * (i + 1), { pagina: i + 1, citat: `în lungime totală de ${100 * (i + 1)} m` })] }))
    const ex7 = await extragere(db, d7, { felii: felii7 })
    const pagina = async (dupaE, dupaF) => caService(db, `SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.extragere_id, f.felie_nr), '[]') x FROM public.fn_ofertare_semnale_felii($1, $2::bigint[], $3, $4, 3) f`, [LIC, [ex7.id], dupaE, dupaF])
    const pg1 = await pagina(null, null), pg2 = await pagina(ex7.id, 2), pg3 = await pagina(ex7.id, 5), pg4 = await pagina(ex7.id, 6)
    ast(ab, pg1.length === 3 && pg2.length === 3 && pg3.length === 1 && pg4.length === 0 && pg1[0].felie_nr === 0 && pg3[0].felie_nr === 6 && pg1.every(x => x.obs.length === 1 && x.obs_atribuibile && x.incercari === 1), 'keyset 3 + 3 + 1 + gol: ' + JSON.stringify([pg1.length, pg2.length, pg3.length, pg4.length]))
    const alt = await caService(db, `SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]') x FROM public.fn_ofertare_semnale_felii($1, $2::bigint[], NULL, NULL, 200) f`, [LIC, [f.exAtr.id]])
    ast(ab, alt.length === 1 && Number(alt[0].extragere_id) === f.exAtr.id, 'doar extragerile cerute: ' + alt.length)
    // t3_felii_reluare: felia 2 esuat, reluată (fn_ofertare_cb_felie_reia ca om) și terminată gata → UN rând, incercare 2, gata; felii_sha se schimbă
    const txtR = PAG(1, 'a în lungime totală de 10 m') + PAG(2, 'b în lungime totală de 20 m') + PAG(3, 'c în lungime totală de 30 m')
    const dR = await document(db, { tip: 'alta', nume: 'DOC_RELUARE', text: txtR })
    const oR = [0, 1, 2].map(i => txtR.indexOf(`⟦PAGINA ${i + 1}⟧`))
    const exR = await extragere(db, dR, { stare: 'in_lucru', felii: [{ nr: 0, de_la: oR[0], pana_la: oR[1], stare: 'gata', obs: [OBS_ATR(10, { pagina: 1, citat: 'în lungime totală de 10 m' })] },
      { nr: 1, de_la: oR[1], pana_la: oR[2], stare: 'esuat', obs: [] }, { nr: 2, de_la: oR[2], pana_la: txtR.length, stare: 'gata', obs: [OBS_ATR(30, { pagina: 3, citat: 'în lungime totală de 30 m' })] }] })
    const fel1 = (await q(db, `SELECT id FROM public.ofertare_cant_felii WHERE extragere_id = $1 AND felie_nr = 1`, [exR.id]))[0].id
    const reia = await scrieCa(db, 'RESP', `SELECT public.fn_ofertare_cb_felie_reia($1, 'reluata in proba') x`, [fel1])
    ast(ab, reia.ok && reia.rows[0].x.incercare === 2, 'reluarea de om: ' + JSON.stringify(reia))
    await db.query(`UPDATE public.ofertare_cant_felii SET stare = 'gata', inchisa_la = now() WHERE id = $1`, [reia.rows[0].x.felie_id])
    await db.query(`UPDATE public.ofertare_cant_extrageri SET stare = 'gata', obs_relevante = 0, terminat_la = now() WHERE id = $1`, [exR.id])
    const sha1 = (await foto(db)).documente.find(x => Number(x.id) === dR).felii_sha
    const fr = await caService(db, `SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.felie_nr), '[]') x FROM public.fn_ofertare_semnale_felii($1, $2::bigint[], NULL, NULL, 200) f`, [LIC, [exR.id]])
    ast(ab, fr.length === 3 && fr[1].incercare === 2 && fr[1].stare === 'gata' && fr[1].incercari === 2 && fr[1].obs_atribuibile === true && fr[1].obs_numar === 0, 'felia reluată fără observații: un rând, încercarea 2, gata, atribuibilă: ' + JSON.stringify(fr.map(x => [x.felie_nr, x.incercare, x.incercari, x.stare, x.obs_atribuibile])))
    // t3_obs_neatribuibile: felia 1 cu observații din încercarea 1 (3995) ȘI din încercarea 2 (3990) → neatribuibile; propune scrie neatribuibil pentru ambele
    const dN = await document(db, { tip: 'alta', nume: 'DOC_ATR_T2', text: PAG(1, 'x în lungime totală de 1 m') + PAG(2, 'Rețeaua este în lungime totală de 3.995 m. Sau în lungime totală de 3.990 m.') })
    const tN = (await q(db, `SELECT text_extras FROM public.ofertare_documente_atribuire WHERE id = $1`, [dN]))[0].text_extras
    const o2 = tN.indexOf('⟦PAGINA 2⟧')
    const exN = await extragere(db, dN, { felii: [{ nr: 0, de_la: 0, pana_la: o2, stare: 'gata', obs: [OBS_ATR(1, { pagina: 1, citat: 'în lungime totală de 1 m', denumire: 'altceva', tip: 'alt', dn: [] })] },
      { nr: 1, de_la: o2, pana_la: tN.length, stare: 'esuat', incercare: 1, obs: [OBS_ATR(3995, { pagina: 2 })] },
      { nr: 1, de_la: o2, pana_la: tN.length, stare: 'gata', incercare: 2, obs: [OBS_ATR(3990, { pagina: 2, citat: 'în lungime totală de 3.990 m', hash_extra: 'inc2' })] }] })
    const fa = await q(db, `SELECT * FROM public.fn_ofertare_masura_felii_autoritative($1) ORDER BY felie_nr`, [exN.id])
    ast(ab, fa.length === 2 && fa[1].incercari === 2 && fa[1].obs_numar === 2 && fa[1].obs_atribuibile === false && fa[0].obs_atribuibile === true, 'felii_autoritative pe felia reluată cu observații: ' + JSON.stringify(fa.map(x => [x.felie_nr, x.incercare, x.incercari, x.obs_numar, x.obs_atribuibile])))
    const fN = await caService(db, `SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.felie_nr), '[]') x FROM public.fn_ofertare_semnale_felii($1, $2::bigint[], NULL, NULL, 200) f`, [LIC, [exN.id]])
    ast(ab, fN[1].obs_atribuibile === false && fN[1].obs.length === 0 && fN[1].obs_numar === 2 && fN[0].obs.length === 1, 'fn_ofertare_semnale_felii: obs = [] la neatribuibile: ' + JSON.stringify(fN.map(x => [x.felie_nr, x.obs_atribuibile, x.obs.length])))
    // DOC_ATR_T curat 6400, DOC_ATR_T2 cu toate observațiile măsurii în felia reluată, edge-ul nu semnalează nimic → neverificat, NU in_regula
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = $2 WHERE id = $1`, [f.dAtr, PAG(1, 'AVIZ', 'Rețeaua este în lungime totală de 6.400 m.')])
    await extragere(db, f.dAtr, { obs: [OBS_ATR(6400)] })
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = $1`, [LIC])
    await db.query(`DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = $1`, [LIC])
    await evalueaza(db)
    let s = (await semnalCunoscut(db))[0]
    let m = await masuratori(db, s.id, s.evaluare_id)
    const neat = m.filter(x => x.verificare === 'neatribuibil')
    ast(ab, s.verdict === 'neverificat' && /DOC_ATR_T2: felii 1 observatii_neatribuibile/.test(s.motiv) && neat.length === 2 && neat.every(x => x.valoare === null && x.fel_dovada === null && Number(x.document_id) === dN)
      && s.inventar.felii_incomplete.some(x => Number(x.extragere_id) === exN.id && x.felie_nr === 1 && x.motiv === 'observatii_neatribuibile') && s.inventar.componente_fara_ok.filter(x => x.verificare === 'neatribuibil').length === 2
      && !s.valori_b.some(x => x.valoare !== null && Number(x.document_id) === dN), 't3_obs_neatribuibile_doua_b: ' + JSON.stringify([s.verdict, s.motiv, neat.length, s.valori_b]))
    // măsura „altceva” (necunoscut) a DOC_ATR_T2 din felia 1 e separată; măsura DN160 e blocată de felia 1 a documentului (contribuie prin componentele neatribuibile)
    // după o reextragere curată (o singură încercare pe felie) → fotografia se schimbă → in_regula (6400 == 6400)
    await db.query(`UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = $1`, [dN])
    await extragere(db, dN, { obs: [OBS_ATR(6400, { pagina: 2, citat: 'în lungime totală de 3.995 m' })] })
    // (observația de mai sus are valoarea 6400 în câmpul AI, dar citatul spune 3.995: serverul decide din text → 3995, documentele diferă)
    await evalueaza(db)
    s = (await semnalCunoscut(db))[0]
    ast(ab, s.verdict === 'de_verificat' && s.motiv === 'documentele diferă între ele' && s.valori_b.some(x => Number(x.document_id) === dN && Number(x.valoare) === 3995), 'reextragere curată: valoarea vine din TEXT (3995), nu din câmpul AI (6400) → documentele diferă: ' + JSON.stringify([s.verdict, s.motiv, s.valori_b]))
    // t3_context
    const fo = await foto(db)
    const cx = await caService(db, `SELECT public.fn_ofertare_semnale_context($1, $2, $3) x`, [LIC, fo.sha, f.dF3])
    ast(ab, cx.document_id === f.dF3 && cx.text_extras === F3_TEXT && cx.tip === 'formular' && cx.nume_original === 'DOC_F3_T' && cx.sha === sha256(F3_TEXT) && cx.decizii.length === 0 && cx.decizii_sha === sha256(''), 'contextul legat de fotografie: ' + JSON.stringify(cx && [cx.document_id, cx.tip, cx.decizii_sha]))
    const cxv = await caService(db, `SELECT public.fn_ofertare_semnale_context($1, 'sha_vechi', $2) x`, [LIC, f.dF3])
    ast(ab, cxv.refuz === 'fotografie_schimbata', 'fotografie veche → fotografie_schimbata')
    // decizie de rol nouă pe același text → decizii_sha și fotografie.sha se schimbă → semnalul publicat devine schimbata; publica pe o evaluare începută înainte → depasita
    const pE = await propune(db)
    await db.query(`INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, rol, sectiune, decizie, motiv, decis_de) VALUES ($1, $2, $3, 'atr', '*', 'rol_confirmat', 'proba', $4)`, [LIC, f.dF3, sha256(F3_TEXT), U.RESP])
    const fo2 = await foto(db)
    ast(ab, fo2.sha !== fo.sha && fo2.documente.find(x => Number(x.id) === f.dF3).decizii_sha !== fo.documente.find(x => Number(x.id) === f.dF3).decizii_sha, 'decizia de rol schimbă decizii_sha și sha')
    const pubE = await publica(db, LIC, pE.evaluare_id, pE.token)
    ast(ab, pubE.refuz === 'evaluare_depasita', 'decizie între RPC-uri → evaluare_depasita')
    const cx2 = await caService(db, `SELECT public.fn_ofertare_semnale_context($1, $2, $3) x`, [LIC, fo2.sha, f.dF3])
    ast(ab, cx2.decizii.length === 1 && cx2.decizii[0].rol === 'atr' && cx2.decizii_sha === fo2.documente.find(x => Number(x.id) === f.dF3).decizii_sha, 'contextul nou conține decizia activă, cu același decizii_sha ca fotografia')
    // decizia revocată → iese din context și din sha
    const dz = Number((await q(db, `SELECT id FROM public.ofertare_cant_doc_decizii WHERE document_id = $1`, [f.dF3]))[0].id)
    await db.query(`INSERT INTO public.ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, revoca_id, motiv, decis_de) VALUES ($1, $2, $3, 'revocare', $4, 'proba', $5)`, [LIC, f.dF3, sha256(F3_TEXT), dz, U.RESP])
    const fo3 = await foto(db)
    ast(ab, fo3.documente.find(x => Number(x.id) === f.dF3).decizii_sha === sha256(''), 'revocarea scoate decizia din decizii_sha')
  }
}
if (vrea('t3') && MIG) { console.log(S3._titlu); for (const nume of Object.keys(S3).filter(k => k !== '_titlu')) await scenariu(nume, S3[nume]) }

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// t4: circuitul auto_planse_* extins la auto_surse_* (inventarul #2–#6, #9), ca authenticated cu / fără drept de decizie
// rândul ciornei din vedere; null = ciorna NU apare în vedere (abatere explicită la apelant, nu excepție de JS)
const vedere = async (db, cont, clarId) => { const r = await ca(db, cont, `SELECT * FROM public.v_ofertare_clarificari_baza WHERE id = $1`, [clarId]); if (r.code) throw new Error('view: ' + r.message); return r.rows[0] || null }
const reconfirma = (db, cont, clarId, amprenta, decizie = 'revizuit', nota = 'verificat de om in proba') => scrieCa(db, cont, `SELECT public.ofertare_clarificare_reconfirma($1, $2, $3, $4) x`, [clarId, amprenta, decizie, nota])
const upd = (db, cont, clarId, set, params = []) => scrieCa(db, cont, `UPDATE public.ofertare_clarificari SET ${set} WHERE id = $1 RETURNING id`, [clarId, ...params])
const exporta = (db, cont, lic = LIC) => scrieCa(db, cont, `SELECT public.ofertare_clarificari_export($1) x`, [lic])
const notifica = (db, cont, lic = LIC) => scrieCa(db, cont, `SELECT public.ofertare_clarificari_notifica($1) x`, [lic])
async function aproba(db, ab, clarId, cont = 'RESP') {
  const v = await vedere(db, cont, clarId)
  if (!v) { ast(ab, false, 'aprobarea: ciorna nu apare în vedere'); return null }
  const r = await reconfirma(db, cont, clarId, v.amprenta_curenta)
  ast(ab, r.ok && r.rows[0].x.ok === true, 'reconfirmarea: ' + JSON.stringify(r.rows?.[0]?.x || r.message))
  return v
}
{ // t4: scenariile (definite mereu; rulate doar cu --sectiune t4)
  S4._titlu = 't4. circuitul ciornelor automate pe auto_surse_*: trigger, reconfirmare, excepție, view, export, notificare, stări, lanțul authenticated'
  S4['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    await evalueaza(db)
    let c = (await ciorne(db))[0], s = (await semnalCunoscut(db))[0]
    // INSERT cu cheie auto_surse_x ca authenticated → refuz; UPDATE baza_generare → refuz; UPDATE sursa → păstrată; DELETE → refuz
    asteptMesaj(await scrieCa(db, 'RESP', `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, cheie) VALUES ($1, 50, 'x', 'propunere', 'auto_surse_0123456789abcdef')`, [LIC]), /generatorul controlat|doar serverul/, 'INSERT auto_surse_x ca authenticated', ab)
    asteptMesaj(await upd(db, 'RESP', c.id, `baza_generare = '{}'`), /reconfirmare|doar serverul/, 'UPDATE baza_generare', ab)
    // sursa unei ciorne automate: scrierea directă a clientului e refuzată de triggerul de proveniență (20261026a, INVOKER aici) — 42501, nu „păstrată” tăcut
    asteptCod(await upd(db, 'RESP', c.id, `sursa = 'altceva'`), '42501', 'UPDATE sursa ca authenticated', ab)
    ast(ab, (await ciorne(db))[0].sursa === c.sursa, 'sursa neschimbată după încercare')
    asteptMesaj(await scrieCa(db, 'RESP', `DELETE FROM public.ofertare_clarificari WHERE id = $1`, [c.id]), /retrage ciorna/, 'DELETE', ab)
    asteptMesaj(await scrieCa(db, 'OWNER', `DELETE FROM public.ofertare_clarificari WHERE id = $1`, [c.id]), /retrage ciorna/, 'DELETE ca owner', ab)
    // view: ciorna auto_surse_* apare cu stare, amprenta_curenta, text, detalii.evaluare = surse_v1; fără acces Ofertare → 0 rânduri
    let v = await vedere(db, 'OF', c.id)
    ast(ab, v && v.stare === 'necesita_review' && /^[0-9a-f]{32}$/.test(v.amprenta_curenta) && v.detalii.evaluare === 'surse_v1' && v.mod_ciorna === 'surse' && v.marcaj_planse === false && v.text, 'view: ' + JSON.stringify(v && [v.stare, v.mod_ciorna, v.detalii.evaluare]))
    const v0 = await ca(db, 'STRAIN', `SELECT count(*)::int n FROM public.v_ofertare_clarificari_baza`)
    ast(ab, !v0.code && v0.rows[0].n === 0, 'view fără acces Ofertare: 0 rânduri: ' + JSON.stringify(v0))
    ast(ab, v && JSON.stringify(Object.keys(v).sort()) === JSON.stringify(['amprenta_curenta', 'detalii', 'id', 'licitatie_id', 'marcaj_planse', 'mod_ciorna', 'mod_curent', 'nr', 'stare', 'status', 'text']), 'coloanele vechi ale view-ului: ' + Object.keys(v || {}).sort().join(','))
    // de_trimis fără reconfirmare → refuz; fără drept de decizie → refuz
    asteptMesaj(await upd(db, 'RESP', c.id, `status = 'de_trimis'`), /Clarificare blocată: necesită review/, 'de_trimis fără reconfirmare', ab)
    // reconfirmare: fără drept de decizie → eroare; cu drept → ok; tokenul = token_curent
    const rOF = await reconfirma(db, 'OF', c.id, v?.amprenta_curenta)
    ast(ab, rOF.ok && /fără drept de decizie/.test(rOF.rows[0].x.error || ''), 'reconfirmare fără drept de decizie: ' + JSON.stringify(rOF.rows?.[0]?.x))
    asteptMesaj(await upd(db, 'OF', c.id, `status = 'de_trimis'`), /drept de decizie/, 'de_trimis fără drept de decizie', ab)
    const rBad = await reconfirma(db, 'RESP', c.id, 'amprenta_gresita')
    ast(ab, /s-au schimbat/.test(rBad.rows?.[0]?.x?.error || ''), 'reconfirmare cu token greșit refuzată')
    await aproba(db, ab, c.id)
    c = (await ciorne(db))[0]
    const st = await stareBaza(db, c.id, 'tranzitie')
    ast(ab, st.stare === 'ok' && c.baza_generare.reconfirmare.token === st.token_aprobare && c.baza_generare.reconfirmare.token_curent === st.amprenta_curenta && c.baza_generare.reconfirmare.evaluare_amprenta === s.evaluare_amprenta && c.baza_generare.reconfirmare.surse_sha === s.surse_sha,
      'reconfirmarea scrie token_aprobare / token_curent / evaluare_amprenta / surse_sha: ' + JSON.stringify([st.stare, Object.keys(c.baza_generare.reconfirmare)]))
    ast(ab, (await vedere(db, 'OF', c.id))?.stare === 'ok', 'view după reconfirmare: ok')
    // ciorna aprobată, încă propunere (reconfirmare în bază): sursa se schimbă → alt text propus → sistemul NU o rescrie (nu e „liberă”), doar neatinsa
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6500 WHERE licitatie_id = $1`, [LIC])
    const evAp = await evalueaza(db)
    const cAp = (await ciorne(db))[0]
    ast(ab, cAp.intrebare === c.intrebare && cAp.status === 'propunere' && cAp.baza_generare.reconfirmare && evAp.semnale[0]?.clarificare === 'neatinsa',
      'propunere aprobată, sursă schimbată → textul aprobat NU e rescris (neatinsa): ' + JSON.stringify([cAp.intrebare === c.intrebare, cAp.status, evAp.semnale[0]?.clarificare]))
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = $1`, [LIC])
    await evalueaza(db)
    ast(ab, (await vedere(db, 'OF', c.id))?.stare === 'ok', 'sursa revenită, reevaluată: aceeași amprentă → ok')
    // de_trimis ok; export ok
    const dt = await upd(db, 'RESP', c.id, `status = 'de_trimis'`)
    ast(ab, dt.ok, 'de_trimis după reconfirmare: ' + (dt.message || 'ok'))
    let ex = await exporta(db, 'RESP')
    ast(ab, ex.ok && ex.rows[0].x.length === 1 && ex.rows[0].x[0].id === c.id, 'export: ciorna aprobată inclusă: ' + (ex.message || ex.rows?.[0]?.x?.length))
    asteptMesaj(await exporta(db, 'OF'), /fără drept de decizie/, 'export fără drept de decizie', ab)
    // invalidarea LIVE, fără extragere nouă, pe rând: fiecare sursă schimbată → Export blocat: baza s-a schimbat — de reverificat
    const BLOC = /Export blocat: baza s-a schimbat — de reverificat/
    const probe = [
      ['cantitate F3', `UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE licitatie_id = ${LIC}`, `UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE licitatie_id = ${LIC}`],
      ['revizie document', `UPDATE public.ofertare_documente_atribuire SET revizie = 'B' WHERE id = ${f.dAtr}`, `UPDATE public.ofertare_documente_atribuire SET revizie = 'A' WHERE id = ${f.dAtr}`],
      ['text_extras', `UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || ' ' WHERE id = ${f.dAtr}`, `UPDATE public.ofertare_documente_atribuire SET text_extras = left(text_extras, -1) WHERE id = ${f.dAtr}`],
      ['prag', `INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag) VALUES (${LIC}, 0.1)`, `DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = ${LIC}`],
      ['plafon', `INSERT INTO public.ofertare_cantitati_setari (licitatie_id, plafon_pagini) VALUES (${LIC}, 300)`, `DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = ${LIC}`],
      ['stare_loturi', `UPDATE public.ofertare_licitatii SET stare_loturi = 'are_loturi' WHERE id = ${LIC}`, `UPDATE public.ofertare_licitatii SET stare_loturi = 'fara_loturi' WHERE id = ${LIC}`],
      ['document adăugat', `INSERT INTO public.ofertare_documente_atribuire (id, licitatie_id, tip, nume_original) VALUES (799999, ${LIC}, 'alta', 'NOU')`, `DELETE FROM public.ofertare_documente_atribuire WHERE id = 799999`],
      ['document șters (fără extragere)', `INSERT INTO public.ofertare_documente_atribuire (id, licitatie_id, tip, nume_original) VALUES (799998, ${LIC}, 'alta', 'X'); DELETE FROM public.ofertare_documente_atribuire WHERE id = 799998`, null],
    ]
    for (const [nume, schimba, revino] of probe) {
      if (nume.startsWith('document șters')) {
        // documentul șters: adăugat + șters = fotografia revine la cea veche; ștergerea unui document EXISTENT din fotografie e proba de mai jos
        await db.exec(schimba)
        continue
      }
      await db.exec(schimba)
      const vv = await vedere(db, 'RESP', c.id)
      ast(ab, vv?.stare === 'schimbata' && vv?.text === 'baza s-a schimbat — de reverificat', `${nume}: view → schimbata: ${JSON.stringify([vv?.stare, vv?.text])}`)
      asteptMesaj(await exporta(db, 'RESP'), BLOC, `${nume}: export blocat`, ab)
      asteptMesaj(await upd(db, 'RESP', c.id, `status = 'trimisa'`), /Clarificare blocată: baza s-a schimbat/, `${nume}: trimisa refuzată`, ab)
      await db.exec(revino)
      const vr = await vedere(db, 'RESP', c.id)
      ast(ab, vr?.stare === 'ok', `${nume}: revenit → ok: ${vr?.stare}`)
    }
    // document existent șters (sursa A fără extragere): măsurătorile dispar → fotografia se schimbă → blocat
    const dS = await document(db, { tip: 'alta', nume: 'DOC_SURSA2' })
    const vAd = await vedere(db, 'RESP', c.id)
    ast(ab, vAd?.stare === 'schimbata', 'document adăugat în fotografie → schimbata')
    await db.query(`DELETE FROM public.ofertare_documente_atribuire WHERE id = $1`, [dS])
    ast(ab, (await vedere(db, 'RESP', c.id))?.stare === 'ok', 'documentul șters la loc → ok')
    // evaluare în curs → blocat; verdict devenit in_regula → blocat (fara_diferenta); răspuns confirmat → blocat (rezolvata_de_raspuns)
    const p = await propune(db)
    let vv = await vedere(db, 'RESP', c.id)
    ast(ab, vv?.stare === 'evaluare_in_curs' && vv?.text === 'baza s-a schimbat — de reverificat', 'evaluare în curs → evaluare_in_curs: ' + vv?.stare)
    asteptMesaj(await exporta(db, 'RESP'), BLOC, 'evaluare în curs: export blocat', ab)
    await publica(db, LIC, p.evaluare_id, p.token)
    ast(ab, (await vedere(db, 'RESP', c.id))?.stare === 'ok', 'publicată fără schimbări → ok (aceeași amprentă)')
    await db.query(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag) VALUES ($1, 0.5)`, [LIC])
    await evalueaza(db)
    c = (await ciorne(db))[0]
    ast(ab, c.status === 'de_trimis', 'ciorna aprobată (de_trimis) NU e retrasă de sistem la verdict schimbat: ' + c.status)
    vv = await vedere(db, 'RESP', c.id)
    ast(ab, vv?.stare === 'fara_diferenta' && vv?.text === 'baza s-a schimbat — de reverificat', 'verdict in_regula → fara_diferenta: ' + JSON.stringify([vv?.stare, vv?.text]))
    asteptMesaj(await exporta(db, 'RESP'), BLOC, 'fara_diferenta: export blocat', ab)
    await db.query(`DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = $1`, [LIC])
    await evalueaza(db)
    vv = await vedere(db, 'RESP', c.id)
    ast(ab, vv?.stare === 'ok', 'prag revenit, reevaluat: amprenta aceeași → ok: ' + vv?.stare)
    const dR = await document(db, { tip: 'raspuns_clarificare', nume: 'RASPUNS', text: PAG(1, 'r'), revizie: 'R1' })
    await evalueaza(db)
    const sId = (await semnalCunoscut(db))[0].id
    await scrieCa(db, 'RESP', `SELECT public.fn_ofertare_semnal_raspuns_leaga($1, $2, 3995) x`, [sId, dR])
    vv = await vedere(db, 'RESP', c.id)
    ast(ab, vv?.stare === 'rezolvata_de_raspuns' && /semnal rezolvat prin răspunsul Autorității/.test(vv?.text) && (await ciorne(db))[0].status === 'de_trimis', 'răspuns confirmat → rezolvata_de_raspuns, ciorna aprobată neatinsă: ' + JSON.stringify([vv?.stare, vv?.text]))
    asteptMesaj(await exporta(db, 'RESP'), /Export blocat: semnal rezolvat prin răspunsul Autorității/, 'rezolvata_de_raspuns: export blocat', ab)
  }
  S4['t4_trigger_new_nu_old + t4_stari + t4_notifica_surse + t4_exceptie_surse_refuz'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    await evalueaza(db)
    let c = (await ciorne(db))[0]
    await aproba(db, ab, c.id)
    // UN SINGUR UPDATE care schimbă textul ȘI pune trimisa → refuz (starea pe NEW, fără aprobare)
    asteptMesaj(await upd(db, 'RESP', c.id, `intrebare = intrebare || ' (modificat)', status = 'trimisa'`), /Clarificare blocată: necesită review/, 't4_trigger_new_nu_old', ab)
    // text + de_trimis dintr-o dată: ca în R9b, textul se salvează și statusul cade la propunere (editarea nu moștenește aprobarea)
    const td = await upd(db, 'RESP', c.id, `intrebare = intrebare || ' (modificat)', status = 'de_trimis'`)
    ast(ab, td.ok && (await ciorne(db))[0].status === 'propunere' && !(await ciorne(db))[0].baza_generare.reconfirmare, 'text + de_trimis dintr-o dată → propunere, fără aprobare: ' + (td.message || ''))
    await aproba(db, ab, c.id)
    // tranzitie pe un UPDATE candidat cu status trimisa și text nou → necesita_review (statusul candidat nu contează)
    const stT = (await q(db, `SELECT public.ofertare_semnal_baza_stare(c, 'tranzitie') x FROM public.ofertare_clarificari c WHERE c.id = $1`, [c.id]))[0].x
    ast(ab, stT.stare === 'ok', 'tranzitie pe rândul aprobat: ok: ' + stT.stare)
    const stT3 = (await q(db, `SELECT public.ofertare_semnal_baza_stare(ROW(c.id, c.licitatie_id, c.nr, 'text nou', c.sursa, c.cantitate_id, 'trimisa', c.raspuns, c.raspuns_la, c.created_at, c.updated_at, c.origine, c.cheie, c.baza_generare, c.fisier_path, c.creat_de, c.citita_la, c.citita_rezumat, c.raspuns_document_id, c.surse_document_ids, c.surse_cerinte_ids, c.surse_cantitati_ids)::public.ofertare_clarificari, 'tranzitie') x FROM public.ofertare_clarificari c WHERE c.id = $1`, [c.id]))[0].x
    ast(ab, stT3.stare === 'necesita_review', 'tranzitie: candidat „trimisa” cu text nou → necesita_review (statusul candidat nu se citește): ' + stT3.stare)
    // editarea textului → propunere + text_editat_de, aprobarea scoasă
    const e = await upd(db, 'RESP', c.id, `intrebare = intrebare || ' (editat)'`)
    c = (await ciorne(db))[0]
    ast(ab, e.ok && c.status === 'propunere' && c.baza_generare.text_editat_de === U.RESP && !c.baza_generare.reconfirmare && c.baza_generare.istoric_decizii.length === 2, 'editarea: propunere + text_editat_de, aprobările (2) în istoric: ' + JSON.stringify([c.status, c.baza_generare.istoric_decizii?.length]))
    ast(ab, (await vedere(db, 'RESP', c.id))?.stare === 'necesita_review', 'după editare: necesita_review')
    // reconfirmare → de_trimis → trimisa; apoi cantitate schimbată → doar luat_act, textul imuabil
    await aproba(db, ab, c.id)
    ast(ab, (await upd(db, 'RESP', c.id, `status = 'de_trimis'`)).ok && (await upd(db, 'RESP', c.id, `status = 'trimisa'`)).ok, 'de_trimis → trimisa pe baza reconfirmată')
    c = (await ciorne(db))[0]
    let v = await vedere(db, 'RESP', c.id)
    ast(ab, v.stare === 'ok' && c.status === 'trimisa', 'trimisa pe baza ei: afisare = ok')
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE licitatie_id = $1`, [LIC])
    v = await vedere(db, 'RESP', c.id)
    ast(ab, v.stare === 'schimbata', 'după trimitere, cantitate schimbată → schimbata (informativ)')
    asteptMesaj(await upd(db, 'RESP', c.id, `intrebare = 'alt text'`), /Documentul transmis este imuabil/, 'textul transmis imuabil', ab)
    asteptMesaj(await upd(db, 'RESP', c.id, `status = 'propunere'`), /imuabil/, 'revenirea la propunere refuzată', ab)
    const rRev = await reconfirma(db, 'RESP', c.id, v.amprenta_curenta, 'revizuit')
    ast(ab, /doar luat_act/.test(rRev.rows?.[0]?.x?.error || ''), 'după trimitere doar luat_act: ' + JSON.stringify(rRev.rows?.[0]?.x))
    const rLa = await reconfirma(db, 'RESP', c.id, v.amprenta_curenta, 'luat_act', 'am luat act de schimbare')
    c = (await ciorne(db))[0]
    ast(ab, rLa.ok && rLa.rows[0].x.ok && c.baza_generare.luat_act.token === v.amprenta_curenta, 'luat_act scrie token = token_curent')
    v = await vedere(db, 'RESP', c.id)
    ast(ab, v.stare === 'luat_act', 'după luat_act: luat_act (informativ, nu aprobare)')
    // o nouă schimbare → alt token_curent → din nou schimbata
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = 6402 WHERE licitatie_id = $1`, [LIC])
    ast(ab, (await vedere(db, 'RESP', c.id))?.stare === 'schimbata', 'a doua schimbare → schimbata din nou (token_curent include fotografia)')
    // ciorna trimisă pe evaluarea veche + semnalul reevaluat (altă amprentă) → schimbata în afisare, NU ok
    await evalueaza(db)
    v = await vedere(db, 'RESP', c.id)
    ast(ab, v.stare === 'schimbata', 'reevaluarea nu „reaprobă” un text trimis: ' + v.stare)
    // notificarea: bază schimbată → 1 notificare responsabilului; a doua rulare → 0; după luat_act pe noul token → 0
    const n0 = (await q(db, `SELECT count(*)::int n FROM public.notifications`))[0].n
    const n1 = await notifica(db, 'RESP')
    const n2 = await notifica(db, 'RESP')
    ast(ab, n1.ok && n1.rows[0].x.notificari === 1 && n2.rows[0].x.notificari === 0 && (await q(db, `SELECT count(*)::int n FROM public.notifications WHERE profile_id = $1`, [U.RESP]))[0].n === n0 + 1, 'notificarea: 1 apoi 0: ' + JSON.stringify([n1.rows?.[0]?.x, n2.rows?.[0]?.x]))
    asteptMesaj({ code: (await notifica(db, 'STRAIN')).rows?.[0]?.x?.error ? 'x' : undefined, message: (await notifica(db, 'STRAIN')).rows?.[0]?.x?.error }, /fără acces/, 'notificare fără acces', ab)
    // excepția de identitate pe surse → refuz explicit
    const ex = await scrieCa(db, 'RESP', `SELECT public.ofertare_clarificare_exceptie_identitate($1, $2, 'motiv suficient de lung') x`, [c.id, v.amprenta_curenta])
    ast(ab, ex.ok && ex.rows[0].x.error === 'nu se aplică ciornelor de surse', 't4_exceptie_surse_refuz: ' + JSON.stringify(ex.rows?.[0]?.x))
    // retragerea de om pe o ciornă nouă → retrasa_de = om; apoi semnalul la verdict diferenta cu altă amprentă rămâne retras
    const g = await fixturaTichet(db, { lic: LIC2 })
    await evalueaza(db, LIC2)
    const c2 = (await ciorne(db, LIC2))[0]
    ast(ab, (await upd(db, 'OWNER', c2.id, `status = 'retrasa'`)).ok, 'omul retrage')
    const c2b = (await ciorne(db, LIC2))[0]
    ast(ab, c2b.baza_generare.retrasa_de === 'om' && c2b.baza_generare.retrasa_de_uid === U.OWNER && c2b.baza_generare.retrasa_la, 'retrasa_de = om, uid, la: ' + JSON.stringify(c2b.baza_generare))
    ast(ab, (await ca(db, 'OWNER', `SELECT count(*)::int n FROM public.v_ofertare_clarificari_baza WHERE id = $1`, [c2.id])).rows[0].n === 0, 'ciorna retrasă nu apare în view')
    // stări: indisponibila când semnalul n-are evaluare publicată (ciornă orfană scrisă ca postgres)
    await db.query(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine, cheie) VALUES ($1, 90, 'orfana', 'propunere', 'automat', 'auto_surse_ffffffffffffffff')`, [LIC])
    const orf = (await q(db, `SELECT id FROM public.ofertare_clarificari WHERE cheie = 'auto_surse_ffffffffffffffff'`))[0].id
    const vo = await vedere(db, 'RESP', orf)
    ast(ab, vo.stare === 'indisponibila' && /necesită review/.test(vo.text), 'ciornă fără semnal → indisponibila: ' + JSON.stringify([vo.stare, vo.text]))
    asteptMesaj(await upd(db, 'RESP', orf, `status = 'de_trimis'`), /Clarificare blocată/, 'orfana nu trece la de_trimis', ab)
  }
  S4['t4_provenienta_directa'] = async (db, ab) => {
    // r1 P1: proveniența (surse_*, origine, sursa / baza_generare pe automat) rămâne a serverului: scrierea DIRECTĂ a clientului (current_user authenticated)
    // e refuzată cu 42501 de fn_ofertare_surse_valideaza (acum INVOKER), iar calea RPC DEFINER (reconfirmarea, legarea răspunsului) trece
    const f = await fixturaTichet(db)
    await evalueaza(db)
    const c = (await ciorne(db))[0]
    asteptCod(await upd(db, 'RESP', c.id, `surse_document_ids = ARRAY[${f.dF3}]::bigint[]`), '42501', 'UPDATE direct surse_document_ids (id valid, aceeași licitație) pe ciorna automată', ab)
    asteptCod(await upd(db, 'RESP', c.id, `surse_cantitati_ids = NULL`), '42501', 'UPDATE direct surse_cantitati_ids = NULL pe ciorna automată', ab)
    asteptCod(await upd(db, 'OWNER', c.id, `surse_document_ids = ARRAY[${f.dF3}]::bigint[]`), '42501', 'UPDATE direct surse ca owner (tot client)', ab)
    await db.query(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES ($1, 40, 'intrebare manuala', 'propunere')`, [LIC])
    const cm = (await q(db, `SELECT id FROM public.ofertare_clarificari WHERE licitatie_id = $1 AND nr = 40`, [LIC]))[0].id
    asteptCod(await upd(db, 'RESP', cm, `surse_document_ids = ARRAY[${f.dF3}]::bigint[]`), '42501', 'UPDATE direct surse pe o clarificare manuală', ab)
    asteptCod(await upd(db, 'RESP', cm, `origine = 'automat'`), '42501', 'UPDATE direct origine → automat', ab)
    asteptCod(await scrieCa(db, 'RESP', `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES ($1, 41, 'x', 'propunere', 'automat')`, [LIC]), '42501', 'INSERT cu origine automat ca authenticated', ab)
    asteptCod(await scrieCa(db, 'RESP', `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, surse_document_ids) VALUES ($1, 42, 'x', 'propunere', ARRAY[${f.dF3}]::bigint[])`, [LIC]), '42501', 'INSERT cu surse ca authenticated', ab)
    asteptCod(await scrieCa(db, 'RESP', `UPDATE public.ofertare_cantitati SET surse_document_ids = NULL WHERE id = $1 RETURNING id`, [f.cant[0]]), '42501', 'UPDATE direct surse_document_ids pe o poziție F3', ab)
    // textul rămâne editabil de om (proveniența nu); calea serverului (service_role direct, RPC DEFINER) scrie
    const e = await upd(db, 'RESP', c.id, `intrebare = intrebare || ' (editat)'`)
    ast(ab, e.ok, 'editarea textului de om trece: ' + (e.message || ''))
    const sr = await scrieCa(db, null, `UPDATE public.ofertare_cantitati SET surse_document_ids = ARRAY[${f.dF3}]::bigint[] WHERE id = $1 RETURNING id`, [f.cant[0]], { rol: 'service_role' })
    ast(ab, sr.ok && sr.rows.length === 1, 'service_role scrie sursele pe poziția F3: ' + (sr.message || ''))
    const c2 = (await ciorne(db))[0]
    ast(ab, JSON.stringify((c2.surse_document_ids || []).map(Number).sort()) === JSON.stringify([f.dF3, f.dAtr].sort()) && c2.origine === 'automat', 'proveniența ciornei neschimbată după încercări: ' + JSON.stringify(c2.surse_document_ids))
  }
  S4['t4_lant_authenticated + t4_planse_neschimbat + t4_fara_advisory + t4_drepturi'] = async (db, ab) => {
    const f = await fixturaTichet(db)
    await evalueaza(db)
    const c = (await ciorne(db))[0]
    // lanțul ca authenticated: view, export, reconfirmare funcționează; apelul direct al unei funcții interne = 42501
    const v = await vedere(db, 'RESP', c.id)
    ast(ab, v && v.stare === 'necesita_review', 'view ca authenticated')
    for (const fn of [`fn_ofertare_semnal_rezolvat((SELECT s FROM public.ofertare_cantitati_semnale s LIMIT 1))`, `fn_ofertare_masura_felii_autoritative(1)`, `fn_ofertare_semnal_text(1, 1)`, `fn_ofertare_semnal_upsert(1, 1, NULL, '*', 'x', 'fizica', 'm')`, `fn_ofertare_masura_norm('x')`]) {
      asteptCod(await ca(db, 'RESP', `SELECT * FROM public.${fn}`), '42501', 'apel direct al funcției interne ' + fn.split('(')[0], ab)
    }
    // starea prin dispecer ca authenticated (EXECUTE acordat) — întoarce doar stare / tokeni / diferențe, fără dovezi sau text de document
    const d = await ca(db, 'OF', `SELECT public.fn_ofertare_ciorna_auto_stare(c, 'afisare') x FROM public.ofertare_clarificari c WHERE c.id = $1`, [c.id])
    ast(ab, !d.code && d.rows[0].x.stare === 'necesita_review' && !('masuratori' in d.rows[0].x) && !JSON.stringify(d.rows[0].x).includes('6.400'), 'dispecerul ca authenticated: fără dovezi: ' + JSON.stringify(d.rows?.[0]?.x && Object.keys(d.rows[0].x)))
    // t4_planse_neschimbat: scenariul R9b pe o ciornă auto_planse_* (valorile din scripts/pglite/test_r9b_decisive.mjs: ok → de_trimis permis → cantitate schimbată → schimbata → trimisa refuzată; export blocat)
    const baza = (await q(db, `SELECT public.ofertare_f3_baza($1) x`, [LIC]))[0].x
    const textP = 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe\n\ntext de proba'
    await db.query(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare) VALUES ($1, 77, $2, $3, 'propunere', 'automat', 'auto_planse_1', $4::jsonb)`,
      [LIC, textP, `planse_auto:${f.dAtr},gen_${md5(textP).slice(0, 12)},ev_${md5('x').slice(0, 12)}`, JSON.stringify({ ...baza, la: new Date().toISOString(), sursa_generare: 'v6-r9b', text_hash: md5(textP) })])
    const cp = (await q(db, `SELECT id FROM public.ofertare_clarificari WHERE cheie = 'auto_planse_1'`))[0].id
    let vp = await vedere(db, 'RESP', cp)
    ast(ab, vp?.stare === 'necesita_review' && vp?.mod_ciorna === 'corespondenta' && vp?.detalii.evaluare === 'r9b', 'planșe: stare inițială necesita_review (R9b): ' + JSON.stringify([vp?.stare, vp?.mod_ciorna]))
    const rp = await reconfirma(db, 'RESP', cp, vp?.amprenta_curenta)
    ast(ab, rp.ok && rp.rows[0].x.ok === true, 'planșe: reconfirmarea: ' + JSON.stringify(rp.rows?.[0]?.x || rp.message))
    ast(ab, (await upd(db, 'RESP', cp, `status = 'de_trimis'`)).ok, 'planșe: după reconfirmare „de trimis” e permis (A3)')
    let exp = await exporta(db, 'RESP')
    ast(ab, exp.ok && exp.rows[0].x.some(x => x.id === cp), 'planșe: exportul include ciorna aprobată')
    await db.query(`UPDATE public.ofertare_cantitati SET cantitate = coalesce(cantitate, 0) + 1 WHERE licitatie_id = $1`, [LIC])
    vp = await vedere(db, 'RESP', cp)
    ast(ab, vp?.stare === 'schimbata', 'planșe: cantitate schimbată ⇒ baza „schimbata” (A3)')
    asteptMesaj(await upd(db, 'RESP', cp, `status = 'trimisa'`), /Clarificare blocată: baza s-a schimbat — de reverificat/, 'planșe: trimiterea pe baza schimbată e refuzată', ab)
    asteptMesaj(await exporta(db, 'RESP'), /Export blocat: baza s-a schimbat — de reverificat/, 'planșe: export blocat', ab)
    // A7: omul modifică cifra din text ⇒ aprobarea nu se transferă
    vp = await vedere(db, 'RESP', cp)
    await reconfirma(db, 'RESP', cp, vp?.amprenta_curenta, 'revizuit', 'reverificat după schimbare')
    ast(ab, (await upd(db, 'RESP', cp, `status = 'de_trimis'`)).ok, 'planșe: reaprobare')
    const r3 = await upd(db, 'RESP', cp, `intrebare = intrebare || ' (123 m)'`)
    ast(ab, r3.ok && (await q(db, `SELECT status FROM public.ofertare_clarificari WHERE id = $1`, [cp]))[0].status === 'propunere', 'planșe: textul editat se salvează și pierde aprobarea (A7)')
    // E1: proveniența nu se poate reseta; excepția pe planșe merge pe calea veche (aici baza nu cere excepție)
    asteptMesaj(await upd(db, 'RESP', cp, `cheie = NULL`), /imuabilă/, 'planșe: cheie = NULL refuzat', ab)
    asteptMesaj(await upd(db, 'RESP', cp, `baza_generare = NULL`), /reconfirmare|doar serverul/, 'planșe: baza_generare = NULL refuzat', ab)
    vp = await vedere(db, 'RESP', cp)
    const exP = await scrieCa(db, 'RESP', `SELECT public.ofertare_clarificare_exceptie_identitate($1, $2, 'motiv suficient de lung') x`, [cp, vp?.amprenta_curenta])
    ast(ab, exP.ok && exP.rows[0].x.error === 'baza curentă nu cere excepție de identitate', 'planșe: excepția pe calea veche: ' + JSON.stringify(exP.rows?.[0]?.x))
    // t4_fara_advisory: static, pe prosrc
    const adv = (await q(db, `SELECT proname, prosrc ~* 'pg_advisory' AS adv, prosrc ~* 'ORDER BY id FOR UPDATE' AS oid FROM pg_proc WHERE proname IN ('fn_trg_ofertare_clarificari_baza', 'ofertare_clarificare_reconfirma', 'ofertare_clarificare_exceptie_identitate', 'ofertare_clarificari_export', 'ofertare_clarificari_notifica', 'ofertare_clarificare_baza_stare', 'ofertare_semnal_baza_stare', 'fn_ofertare_ciorna_auto_stare', 'fn_ofertare_semnal_raspuns_leaga', 'fn_ofertare_semnale_setari', 'fn_ofertare_semnale_lista') ORDER BY proname`))
    ast(ab, adv.length === 11 && adv.every(x => !x.adv && !x.oid), 't4_fara_advisory: ' + JSON.stringify(adv.filter(x => x.adv || x.oid)))
    const advRpc = (await q(db, `SELECT proname, prosrc ~ 'pg_advisory_xact_lock' AS adv FROM pg_proc WHERE proname IN ('fn_ofertare_masuratori_propune', 'fn_ofertare_semnale_publica')`))
    ast(ab, advRpc.length === 2 && advRpc.every(x => x.adv), 'advisory-ul DOAR în propune / publica')
    const ord = (await q(db, `SELECT prosrc ~ 'ORDER BY k.nr FOR UPDATE' AS pub, (SELECT prosrc ~ 'ORDER BY nr FOR UPDATE' FROM pg_proc WHERE proname = 'ofertare_clarificari_notifica') AS notif, (SELECT prosrc ~ 'ORDER BY nr FOR SHARE' FROM pg_proc WHERE proname = 'ofertare_clarificari_export') AS exp FROM pg_proc WHERE proname = 'fn_ofertare_semnale_publica'`))[0]
    ast(ab, ord.pub && ord.notif && ord.exp, 'parcurgerile pe ciorne: ORDER BY nr peste tot: ' + JSON.stringify(ord))
    // drepturile funcțiilor rescrise, păstrate (CREATE OR REPLACE): ACL identic cu scheletul
    const acl = (await q(db, `SELECT proname, coalesce(proacl, acldefault('f', proowner))::text AS acl FROM pg_proc WHERE proname IN ('ofertare_clarificare_reconfirma', 'ofertare_clarificari_export', 'ofertare_clarificari_notifica', 'ofertare_clarificare_exceptie_identitate', 'fn_trg_ofertare_clarificari_baza') ORDER BY proname`))
    const aclAstept = { fn_trg_ofertare_clarificari_baza: '{postgres=X/postgres}', ofertare_clarificare_exceptie_identitate: '{postgres=X/postgres,authenticated=X/postgres}', ofertare_clarificare_reconfirma: '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
      ofertare_clarificari_export: '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}', ofertare_clarificari_notifica: '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' }
    ast(ab, acl.every(x => x.acl === aclAstept[x.proname]), 'ACL-urile funcțiilor rescrise neschimbate: ' + JSON.stringify(acl))
    const vacl = (await q(db, `SELECT string_agg(pg_get_userbyid(e.grantee) || ':' || e.privilege_type, ', ' ORDER BY pg_get_userbyid(e.grantee) || ':' || e.privilege_type) AS acl FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass`))[0].acl
    ast(ab, vacl === 'authenticated:SELECT, postgres:DELETE, postgres:INSERT, postgres:MAINTAIN, postgres:REFERENCES, postgres:SELECT, postgres:TRIGGER, postgres:TRUNCATE, postgres:UPDATE, service_role:DELETE, service_role:INSERT, service_role:MAINTAIN, service_role:REFERENCES, service_role:SELECT, service_role:TRIGGER, service_role:TRUNCATE, service_role:UPDATE',
      'ACL-ul vederii re-acordat identic (ca mulțime rol:drept, cea a scheletului): ' + vacl)
  }
}
if (vrea('t4') && MIG) { console.log(S4._titlu); for (const nume of Object.keys(S4).filter(k => k !== '_titlu')) await scenariu(nume, S4[nume]) }

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// t5: livrarea L15 v2 (validator, amprente, manifest, refuzuri, revenire, dry-run) și mutanții
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const FARA_POST = t => { const a = t.indexOf('DO $post$'), b = t.indexOf('END $post$;') + 'END $post$;'.length; return t.slice(0, a) + "DO $post$ BEGIN RAISE NOTICE 'postconditii scoase (mutant)'; END $post$;" + t.slice(b) }
const randuriBloc = (text, et) => text.slice(text.indexOf(`-- >>> ${et}`), text.indexOf(`-- <<< ${et}`)).split('\n').map(l => l.trim().replace(/,$/, '')).filter(l => l.startsWith("('"))
  .map(l => { const m = /^\('([^']+)', '([0-9a-f]{32})'/.exec(l); return m ? [m[1], m[2]] : null }).filter(Boolean)
if (vrea('t5') && MIG) {
  console.log('t5.0 validatorul runnerului')
  {
    const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
    ok(PLAFON_LIVRARE === 5000 && vm.ok && /^OK \d+ /.test(vm.out), `migrarea trece validatorul cu ${PLAFON_LIVRARE}: ${vm.out}`)
    const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
    ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz: ' + vm2.out.split('\n')[0].slice(0, 120))
    const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
    ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local: ' + vmf.out.split('\n')[0].slice(0, 120))
    if (REV) {
      const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
      ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
      const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
      ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz: ' + vr2.out.split('\n')[0].slice(0, 120))
    } else ok(false, 'revenirea lipsește: ' + F_REV)
    ok(!/^﻿/.test(readFileSync(join(ROOT, F_MIG), 'utf8')) && !/\r/.test(readFileSync(join(ROOT, F_MIG), 'utf8')) && (!REV || !/\r/.test(readFileSync(join(ROOT, F_REV), 'utf8'))), 'fișierele SQL: fără BOM, LF')
  }
  console.log('t5.1 amprentele scrise în migrare / revenire = calculate (LIVE pe schelet; NOI pe textul migrării și pe bază)')
  {
    const db = await bazaNoua()
    STARE_VECHE = STARE_VECHE || await stare(db)
    const live = randuriBloc(MIG, 'AMPRENTE LIVE')
    const dbLive = Object.fromEntries((await q(db, `SELECT p.oid::regprocedure::text AS fn, md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`)).map(r => [r.fn.replace(/^public\./, '').replace(/, /g, ','), r.m]))
    const difLive = live.filter(([fn, m]) => dbLive[fn.replace(/^public\./, '').replace(/, /g, ',')] !== m)
    ok(live.length === 7 && difLive.length === 0, `AMPRENTE LIVE (7) din $pre$ = corpurile scheletului (R5_MIGRARE_3 / 20261121a / 20261026a)${difLive.length ? ': ' + JSON.stringify(difLive) : ''}`)
    // corpurile scheletului = textul exact din fișierele-sursă (generatorul nu le-a modificat)
    for (const [fn, fis] of [['fn_trg_ofertare_clarificari_baza', 'docs/R5_MIGRARE_3_review_copilot.sql'], ['ofertare_clarificare_reconfirma', 'docs/R5_MIGRARE_3_review_copilot.sql'],
      ['ofertare_clarificari_export', 'docs/R5_MIGRARE_3_review_copilot.sql'], ['ofertare_clarificare_exceptie_identitate', 'docs/R5_MIGRARE_3_review_copilot.sql'],
      ['ofertare_clarificare_baza_stare', 'docs/R5_MIGRARE_3_review_copilot.sql'], ['ofertare_clarificari_notifica', 'supabase/migrations/20261121a_ofertare_responsabil2.sql'],
      ['fn_ofertare_surse_valideaza', 'supabase/migrations/20261026a_ofertare_rigoare_provenienta.sql']]) {
      const m = md5(corp(citeste(fis), fn))
      ok(live.some(([f, h]) => f.includes(fn) && h === m), `${fn}: amprenta din migrare = textul din ${fis} (${m})`)
    }
    const a = await livreaza(db, MIG)
    ok(a.ok, 'aplicarea (pentru amprentele de după)' + (a.ok ? '' : ': ' + a.eroare))
    const norm = s => s.replace(/public\./g, '').replace(/ /g, '')
    const noi = randuriBloc(MIG, 'AMPRENTE NOI')
    const dbNoi = Object.fromEntries((await q(db, `SELECT p.oid::regprocedure::text AS fn, md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`)).map(r => [norm(r.fn), r.m]))
    const difNoi = noi.filter(([fn, m]) => dbNoi[norm(fn)] !== m || md5(corp(MIG, fn.replace(/^public\./, '').split('(')[0])) !== m)
    ok(noi.length === 6 && difNoi.length === 0, `AMPRENTE NOI (6) din $post$ = textul migrării = baza după aplicare${difNoi.length ? ': ' + JSON.stringify(difNoi) : ''}`)
    if (REV) {
      ok(JSON.stringify(randuriBloc(REV, 'AMPRENTE NOI')) === JSON.stringify(noi) && JSON.stringify(randuriBloc(REV, 'AMPRENTE LIVE')) === JSON.stringify(live), 'revenirea: blocurile AMPRENTE NOI / LIVE = cele din migrare')
      const fnNoi = randuriBloc(REV, 'AMPRENTE FUNCTII NOI')
      const difFn = fnNoi.filter(([fn, m]) => dbNoi[norm(fn)] !== m)
      ok(fnNoi.length === 30 && difFn.length === 0, `revenirea: AMPRENTE FUNCTII NOI (30) = baza după aplicare${difFn.length ? ': ' + JSON.stringify(difFn.slice(0, 3)) : ''}`)
      for (const fn of ['fn_trg_ofertare_clarificari_baza', 'ofertare_clarificare_reconfirma', 'ofertare_clarificari_export', 'ofertare_clarificare_exceptie_identitate', 'ofertare_clarificari_notifica', 'fn_ofertare_surse_valideaza']) {
        ok(live.some(([f, h]) => f.includes(fn) && h === md5(corp(REV, fn))), `revenirea readuce ${fn} la corpul LIVE (textul din revenire = amprenta LIVE)`)
      }
    }
    const L = 'LOCK TABLE public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;'
    ok(MIG.split(L).length === 2 && MIG.indexOf('DO $lock$') > MIG.indexOf('END $pre$;') && MIG.indexOf('END $lock$;') < MIG.indexOf('DO $stare$')
      && MIG.indexOf('DO $stare$') < MIG.indexOf('CREATE TABLE public.ofertare_elemente_masura') && (!REV || REV.indexOf('IN ACCESS EXCLUSIVE MODE NOWAIT;') < REV.indexOf('DO $stare$')),
    'lock-ul (NOWAIT, buget) vine ÎNAINTEA verificărilor de stare, în migrare și în revenire (L14)')
    await db.close()
  }
  console.log('t5.2 livrarea L15 v2 completă: manifestul (ROLLBACK) = lista revizuită; livrarea aprobată + garda finală; refuzurile runnerului; dry-run')
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
      `# 20270112a: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + fara18.join('\n') + '\n')
    const revizuit = existsSync(join(ROOT, F_OBIECTE)) ? listaObiecte(citeste(F_OBIECTE)) : []
    const lipsa = revizuit.filter(x => !fara18.includes(x)), plus = fara18.filter(x => !revizuit.includes(x))
    ok(!lipsa.length && !plus.length, `manifestul generat (${fara18.length} obiecte) = lista revizuită ${F_OBIECTE}; lipsă [${lipsa.slice(0, 3).join(' | ')}] în plus [${plus.slice(0, 3).join(' | ')}]`)
    // L25: ce trebuie să conțină lista, independent de generator: 6 tabele create, 5 funcții schimbate, 30 create, vederea schimbată, UNIQUE-ul creat, 3 triggere create
    const fam = Object.fromEntries(['functie', 'relatie', 'trigger', 'constrangere', 'politica'].map(f => [f, revizuit.filter(x => x.startsWith(f + '\t'))]))
    ok(fam.functie.filter(x => x.endsWith('\tschimbat')).length === 6 && fam.functie.filter(x => x.endsWith('\tcreat')).length === 30
      && revizuit.filter(x => /^relatie\trelatie public\.ofertare_(elemente_masura|tipare_cantitate|cantitati_setari|cantitati_evaluari|cantitati_semnale|cantitati_masuratori)\tcreat$/.test(x)).length === 6
      && revizuit.some(x => /v_ofertare_clarificari_baza\tschimbat$/.test(x)) && revizuit.some(x => /ofertare_clarificari_licitatie_nr_uq\tcreat$/.test(x))
      && fam.trigger.filter(x => /trg_ofertare_(masuratori_licitatie|masuratori_imuabil|evaluari_imuabil)\tcreat$/.test(x)).length === 3
      && !revizuit.some(x => x.endsWith('\tsters')), `lista revizuită: 6 funcții schimbate, 30 create, 6 tabele, vederea schimbată, UNIQUE-ul, 3 triggere, nimic șters (${revizuit.length} rânduri)`)
    const fManifest = join(TMP, `${NUME}.l15.tsv`)
    writeFileSync(fManifest, manifest)
    const gr = await livreaza(b, MIG, { aprobat: 'f'.repeat(32), manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
    ok(!gr.ok && /AMPRENTA_GLOBALA_INAINTE/.test(gr.eroare) && JSON.stringify(await stare(b)) === JSON.stringify(s0), 'GLOBAL aprobat greșit = refuz AMPRENTA_GLOBALA_INAINTE, nimic schimbat')
    const fIncomplet = join(TMP, 'incomplet', `${NUME}.l15.tsv`)
    mkdirSync(dirname(fIncomplet), { recursive: true })
    writeFileSync(fIncomplet, manifest.split('\n').filter(l => !l.includes('ofertare_clarificari_licitatie_nr_uq')).join('\n'))
    const gi = await livreaza(b, MIG, { aprobat: G, manifest: fIncomplet, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
    ok(!gi.ok && /AMPRENTA_GLOBALA_DUPA/.test(gi.eroare) && /NEDECLARAT/.test(gi.eroare + gi.note.join('\n')) && JSON.stringify(await stare(b)) === JSON.stringify(s0),
      'manifest fără rândul UNIQUE-ului = refuz AMPRENTA_GLOBALA_DUPA (NEDECLARAT), nimic schimbat')
    const j = await livreaza(b, MIG, { aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
    ok(j.ok && j.note.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m))
      && j.note.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
      && j.note.some(m => new RegExp(`^LOCK_TINUT ${NUME}: `).test(m) && !/nedeclarat/.test(m)),
    'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000); LOCK_TINUT declarat' + (j.ok ? '' : ': ' + j.eroare))
    // dry-run-ul de pe clonă, aici (după aplicare): toate blocurile OK, nimic rămas
    if (DRY) {
      const nr0 = (await b.query(`SELECT (SELECT count(*) FROM public.ofertare_licitatii)::int AS l, (SELECT count(*) FROM public.profiles)::int AS u, (SELECT count(*) FROM public.ofertare_documente_atribuire)::int AS d,
          (SELECT count(*) FROM public.ofertare_clarificari)::int AS c, (SELECT count(*) FROM public.ofertare_cantitati_semnale)::int AS s`)).rows[0]
      const note = []; let eroareDry = null
      try { await b.exec(DRY, { onNotice: n => note.push(n.message) }) } catch (e) { eroareDry = e.message; try { await b.exec('ROLLBACK') } catch { /* închisă */ } }
      const asteptate = ['t_liste OK', 't_cazul_tichetului OK', 't_dovezi OK', 't_invalidare OK', 't_circuit OK', 't_acces OK', 'TOTUL OK']
      ok(!eroareDry && asteptate.every(t => note.some(n => n.startsWith('DRY 20270112a ' + t))), `dry-run: ${asteptate.length} blocuri OK` + (eroareDry ? ': ' + eroareDry.slice(0, 200) : ''))
      const nr1 = (await b.query(`SELECT (SELECT count(*) FROM public.ofertare_licitatii)::int AS l, (SELECT count(*) FROM public.profiles)::int AS u, (SELECT count(*) FROM public.ofertare_documente_atribuire)::int AS d,
          (SELECT count(*) FROM public.ofertare_clarificari)::int AS c, (SELECT count(*) FROM public.ofertare_cantitati_semnale)::int AS s`)).rows[0]
      ok(JSON.stringify(nr1) === JSON.stringify(nr0), 'dry-run: ROLLBACK, nimic rămas (licitații, conturi, documente, clarificări, semnale)')
      const fara = await bazaNoua()
      let ef = null
      try { await fara.exec(DRY) } catch (e) { ef = e.message; try { await fara.exec('ROLLBACK') } catch { /* închisă */ } }
      ok(/t_liste FAIL/.test(ef || ''), 'dry-run pe baza fără 20270112a = eșec (t_liste): ' + (ef || 'TRECE').slice(0, 90))
      await fara.close()
    } else ok(false, 'dry-run-ul lipsește: ' + F_DRY)
    await b.close()
  }
  console.log('t5.3 refuzurile migrării (pe bază nouă, nimic schimbat)')
  for (const [eticheta, opt, motiv, pregatire] of [
    ['fără marcajul runnerului', { marcaj: false }, /garda start invalida/],
    ['fără plafonul tranzacției', { plafon: null, marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
    ['cu plafonul 2000', { plafon: 2000, marcajPlafon: 2000 }, /PLAFON_TRANZACTIE lipsa/],
    ['plafon fără marcajul prologului', { marcajPlafon: null }, /PLAFON_TRANZACTIE lipsa/],
    ['fără pasul „înainte” L15 v2', { ag: false }, /AMPRENTA_GLOBALA_LIPSA/],
    ['alt trigger pe ofertare_clarificari', {}, /triggerele ofertare_clarificari difera/, `CREATE TRIGGER trg_zz BEFORE INSERT ON public.ofertare_clarificari FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cb_imuabil()`],
    ['CHECK-ul de status schimbat', {}, /CHECK-ul de status/, `ALTER TABLE public.ofertare_clarificari DROP CONSTRAINT ofertare_clarificari_status_check, ADD CONSTRAINT ofertare_clarificari_status_check CHECK (status <> '')`],
    ['UNIQUE (licitatie_id, nr) preexistent', {}, /exista deja o unicitate/, `CREATE UNIQUE INDEX zz_nr ON public.ofertare_clarificari (licitatie_id, nr)`],
    ['corp LIVE schimbat (exportul)', {}, /ofertare_clarificari_export\(bigint\) nu e corpul LIVE/, `CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$ BEGIN RETURN '[]'::jsonb; END $function$`],
    ['corp LIVE cu alt definer (notificarea INVOKER)', {}, /ofertare_clarificari_notifica\(bigint\) nu e corpul LIVE/, `ALTER FUNCTION public.ofertare_clarificari_notifica(bigint) SECURITY INVOKER`],
    ['coloană lipsă (ofertare_cantitati.specificatii)', {}, /coloana ofertare_cantitati\.specificatii lipseste/, `ALTER TABLE public.ofertare_cantitati DROP COLUMN specificatii`],
    ['coloană cu alt tip (lot_nr scalar)', {}, /coloana ofertare_cantitati\.lot_nr lipseste sau are alt tip/, `ALTER TABLE public.ofertare_cantitati DROP CONSTRAINT ofertare_cantitati_lot_nr_coerent, ALTER COLUMN lot_nr TYPE integer USING lot_nr[1]`],
    ['vederea cu drept pentru anon', {}, /drepturile v_ofertare_clarificari_baza difera/, `GRANT SELECT ON public.v_ofertare_clarificari_baza TO anon`],
    ['dependență fără cale sigură (fn_are_acces_ofertare)', {}, /dependenta public\.fn_are_acces_ofertare\(\)/, `ALTER FUNCTION public.fn_are_acces_ofertare() RESET search_path`],
  ]) {
    const b = await bazaNoua()
    if (pregatire) await b.exec(pregatire)
    const inainte = await stare(b)
    const r = await livreaza(b, MIG, opt)
    ok(!r.ok && motiv.test(r.eroare) && JSON.stringify(inainte) === JSON.stringify(await stare(b)), `${eticheta}: refuz, nimic schimbat (${(r.eroare || 'APLICAT').slice(0, 120)})`)
    await b.close()
  }
  console.log('t5.4 revenirea: apply → revenire → re-apply; refuzurile revenirii pe derivă și pe date')
  if (REV) {
    const db = await bazaNoua()
    const sVechi = await stare(db)
    const a = await livreaza(db, MIG)
    ok(a.ok, 'aplicare pentru revenire')
    const s1 = await stare(db)
    ok(!(await revino(db, REV, { plafon: 5000 })).ok && JSON.stringify(await stare(db)) === JSON.stringify(s1), 'revenirea cu plafonul 5000 = refuz (cere 2000)')
    ok(!(await revino(db, REV, { nume: NUME })).ok, 'revenirea cu marcajul migrării = refuz')
    ok(!(await revino(db, REV, { marcaj: false })).ok, 'revenirea fără marcaj = refuz')
    const v = await revino(db)
    const s2 = await stare(db)
    ok(v.ok && JSON.stringify(s2) === JSON.stringify(sVechi), 'revenirea: starea EXACT cea de dinainte (tabele, triggere, funcții, UNIQUE, corpuri R9b, vederea)' + (v.ok ? '' : ': ' + v.eroare))
    // după revenire: circuitul auto_planse_* merge ca înainte (view-ul vechi, reconfirmarea pe baza F3)
    const baza = (await q(db, `SELECT public.ofertare_f3_baza($1) x`, [LIC]))[0].x
    const textP = 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe\n\ntext'
    await db.query(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare) VALUES ($1, 1, $2, $3, 'propunere', 'automat', 'auto_planse_1', $4::jsonb)`,
      [LIC, textP, `planse_auto:1,gen_${md5(textP).slice(0, 12)},ev_${md5('x').slice(0, 12)}`, JSON.stringify({ ...baza, la: new Date().toISOString(), sursa_generare: 'v6-r9b', text_hash: md5(textP) })])
    const cp = (await q(db, `SELECT id FROM public.ofertare_clarificari WHERE cheie = 'auto_planse_1'`))[0].id
    const vp = await vedere(db, 'RESP', cp)
    // reconfirmarea ca utilizator (JWT authenticated) sub fn_ofertare_surse_valideaza READUSĂ (20261026a): refuzată de triggerul de proveniență —
    // comportamentul de dinainte de migrare (ABATEREA din antet, secțiunea 9i); cu identitatea contului dar fără rolul API în JWT, reconfirmarea pe baza F3 merge
    const rpU = await reconfirma(db, 'RESP', cp, vp.amprenta_curenta)
    const rp = await scrieCa(db, 'RESP', `SELECT public.ofertare_clarificare_reconfirma($1, $2, 'revizuit', 'verificat') x`, [cp, vp.amprenta_curenta], { rol: 'postgres' })
    ok(vp.stare === 'necesita_review' && rpU.code === '42501' && /o scrie doar serverul/.test(rpU.message) && rp.ok && rp.rows[0].x.ok === true && (await upd(db, 'RESP', cp, `status = 'de_trimis'`)).ok,
      'după revenire: ciorna auto_planse_* trece prin circuitul vechi (view, reconfirmare pe baza F3, de_trimis); reconfirmarea ca utilizator = refuzul de dinainte (42501)' + (rpU.code === '42501' ? '' : ': ' + JSON.stringify(rpU)))
    const dub = await incearca(db, `INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES ($1, 1, 'dublu', 'propunere')`, [LIC])
    ok(dub.ok, 'după revenire: nr dublu e din nou permis (UNIQUE-ul scos)')
    await db.query(`DELETE FROM public.ofertare_clarificari WHERE licitatie_id = $1`, [LIC]).catch(() => null)
    const v2 = await revino(db)
    ok(!v2.ok && /starea nu e cea din 20270112a/.test(v2.eroare), 'revenirea pe starea veche = refuz: ' + (v2.eroare || '').slice(0, 100))
    // re-aplicarea cere zero dubluri de nr (am lăsat una): refuz; apoi curățăm și re-aplicăm
    const ra0 = await livreaza(db, MIG)
    ok(!ra0.ok && /CM_NR_DUBLU/.test(ra0.eroare), 're-aplicarea cu dublura rămasă = CM_NR_DUBLU')
    await db.exec(`SET session_replication_role = replica; DELETE FROM public.ofertare_clarificari; SET session_replication_role = origin;`)
    const a2 = await livreaza(db, MIG)
    ok(a2.ok, 're-aplicarea după revenire' + (a2.ok ? '' : ': ' + a2.eroare))
    const ab = []; await S3['t3_cazul_tichetului'](db, ab)
    ok(ab.length === 0, `re-aplicarea după revenire + cazul tichetului (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
    await db.close()
    // deriva / datele după livrare: revenirea refuză cu câmpul numit, nimic șters
    for (const [nume, pregatire, re] of [
      ['evaluări / semnale existente', async d => { await fixturaTichet(d); await evalueaza(d) }, /exista date \(\d+ evaluari, \d+ semnale, \d+ masuratori, 0 setari, 1 ciorne auto_surse_\*\)/],
      ['setări existente', async d => { await d.exec(`INSERT INTO public.ofertare_cantitati_setari (licitatie_id) VALUES (${LIC})`) }, /exista date \(0 evaluari, 0 semnale, 0 masuratori, 1 setari, 0 ciorne/],
      ['funcție nouă schimbată', async d => { await d.exec(`CREATE OR REPLACE FUNCTION public.fn_ofertare_numar_ro(p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$`) }, /functia public\.fn_ofertare_numar_ro\(text\): corp/],
      ['corp rescris schimbat', async d => { await d.exec(`CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$ BEGIN RETURN '[]'::jsonb; END $function$`) }, /ofertare_clarificari_export\(bigint\): corp_md5/],
      ['GRANT în plus pe o funcție nouă', async d => { await d.exec(`GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) TO authenticated`) }, /functia public\.fn_ofertare_semnale_fotografie\(bigint\): corp \/ proprietati \/ drepturi/],
      ['alt obiect depinde de o funcție nouă', async d => { await d.exec(`CREATE FUNCTION public.zz_foloseste() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT public.fn_ofertare_numar_ro('1') $f$`) }, /alte obiecte depind de functiile noi/],
      ['trigger dezactivat', async d => { await d.exec(`ALTER TABLE public.ofertare_cantitati_masuratori DISABLE TRIGGER trg_ofertare_masuratori_imuabil`) }, /triggerele migrarii nu sunt toate active/],
    ]) {
      const d = await bazaAplicata()
      await pregatire(d)
      const s = await stare(d)
      const vr = await revino(d)
      ok(!vr.ok && re.test(vr.eroare) && JSON.stringify(await stare(d)) === JSON.stringify(s), `revenirea refuză (${nume}), nimic șters: ${(vr.eroare || 'APLICAT').slice(0, 140)}`)
      await d.close()
    }
  }
  console.log('t5.5 mutanți comportamentali (postcondițiile scoase: doar probele îi pot prinde)')
  const comport = async (text, scen) => {
    const db = await bazaNoua()
    const ab = []   // abaterile strânse PÂNĂ la o eventuală excepție rămân (excepția se adaugă la final, cu locul ei)
    try {
      const a = await livreaza(db, text)
      if (!a.ok) return ['aplicare: ' + a.eroare.slice(0, 120)]
      if (scen === 't2') return await verificaT2(db)
      await (S3[scen] || S4[scen])(db, ab); return ab
    } catch (e) { return [...ab, 'excepție: ' + String(e.message).slice(0, 160) + ' @ ' + String((e.stack || '').split('\n')[1] || '').trim().slice(0, 120)] } finally { await db.close() }
  }
  {
    const ab = await comport(FARA_POST(MIG), 't3_cazul_tichetului')
    ok(ab.length === 0, `martor: originalul fără postcondiții trece cazul tichetului (${ab.length} abateri${ab.length ? ': ' + ab[0] : ''})`)
  }
  const MUTANTI = [
    ['M01 dovada text acceptă diametrul (3c scos: „lungime DN160 m” → 160)', [["  IF m[1] IS NOT NULL OR m[3] = 'mm' THEN RETURN jsonb_build_object('verificare', 'diametru_nu_cantitate'", "  IF false THEN RETURN jsonb_build_object('verificare', 'diametru_nu_cantitate'"]], ['t2']],
    ['M01b dovada text fără ancora de cuvânt (\\m): fragment ca subșir', [["  v_re := '\\m(?:' || v_kw || ')", "  v_re := '(?:' || v_kw || ')"]], ['t2']],
    ['M02 coloana acceptată la indexul vecin (±1)', [["    IF cardinality(toks) - v_pos < 1 OR toks[cardinality(toks) - v_pos] IS DISTINCT FROM v_cel THEN RETURN jsonb_build_object('verificare', 'coloana_necunoscuta'); END IF;",
      "    IF cardinality(toks) - v_pos < 1 OR NOT (v_cel IN (toks[cardinality(toks) - v_pos], toks[cardinality(toks) - v_pos - 1], toks[cardinality(toks) - v_pos + 1])) THEN RETURN jsonb_build_object('verificare', 'coloana_necunoscuta'); END IF;"]], ['t2']],
    ['M03 numar_ro acceptă grup de 2 cifre după punct', [["  IF s ~ '^[0-9]{1,3}([.][0-9]{3})*(,[0-9]+)?$' OR s ~ '^[0-9]+(,[0-9]+)?$' THEN", "  IF s ~ '^[0-9]{1,3}([.][0-9]{2,3})*(,[0-9]+)?$' OR s ~ '^[0-9]+(,[0-9]+)?$' THEN"]], ['t2']],
    ['M04 baza_stare fără comparația surse_sha', [["    v_st := CASE WHEN (v_foto ->> 'sha') IS DISTINCT FROM s.surse_sha THEN 'schimbata'", "    v_st := CASE WHEN false THEN 'schimbata'"]], ['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    ['M05 modul tranzitie citește c.status (candidatul „trimisa” trece)', [["  IF v_mod = 'afisare' AND c.status IN ('trimisa', 'raspunsa') THEN", "  IF c.status IN ('trimisa', 'raspunsa') THEN"]], ['t4_trigger_new_nu_old + t4_stari + t4_notifica_surse + t4_exceptie_surse_refuz']],
    ['M06 modul afisare compară cu semnal.surse_sha în loc de baza la aprobare', [["    ELSIF (v_foto ->> 'sha') IS DISTINCT FROM (v_rc ->> 'surse_sha') OR s.evaluare_amprenta IS DISTINCT FROM (v_rc ->> 'evaluare_amprenta') THEN", "    ELSIF (v_foto ->> 'sha') IS DISTINCT FROM s.surse_sha THEN"]], ['t4_trigger_new_nu_old + t4_stari + t4_notifica_surse + t4_exceptie_surse_refuz']],
    ['M07 fotografia fără stare_loturi', [["'cantitati_sha', v_cant, 'prag', v_prag, 'plafon', v_plafon, 'v', 'surse_v1');", "'cantitati_sha', v_cant, 'prag', v_prag, 'plafon', v_plafon, 'v', 'surse_v1') - 'stare_loturi';"]], ['t3_loturi', 't4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    // obs_sha singur e redundant cu felii_sha (observațiile se scriu doar pe felii în zbor → orice observație nouă schimbă și încercările): mutantul pe felii_sha
    ['M08 fotografia fără felii_sha (feliile reluate nu schimbă fotografia)', [["'extragere_id', e.id, 'extractor_id', e.extractor_id, 'felii_distincte', coalesce(fa.n, 0), 'felii_sha', fa.sha, 'obs_sha', oa.sha, 'decizii_sha', da.sha)", "'extragere_id', e.id, 'extractor_id', e.extractor_id, 'felii_distincte', coalesce(fa.n, 0), 'felii_sha', 'x', 'obs_sha', oa.sha, 'decizii_sha', da.sha)"]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    ['M09 propune citește observațiile tuturor extragerilor gata pe sha (nu extragere_id din fotografie)', [["             JOIN public.ofertare_cant_obs ob ON ob.extragere_id = (x ->> 'extragere_id')::bigint", "             JOIN public.ofertare_cant_obs ob ON ob.document_id = (x ->> 'id')::bigint AND ob.doc_sha256 = x ->> 'sha'"]], ['t3_extrageri_duble + t3_identitate_pozitiei']],
    ['M10 observațiile de pe paginile peste plafon tratate ca ok', [["    ELSIF o.pagina IS NOT NULL AND o.pagina > o.lim THEN v_ver := 'pagina_nepermisa';", "    ELSIF false THEN v_ver := 'pagina_nepermisa';"]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    ['M11 observațiile de pe paginile peste plafon OMISE (asocierea dispare)', [["    ELSIF o.pagina IS NOT NULL AND o.pagina > o.lim THEN v_ver := 'pagina_nepermisa';", "    ELSIF o.pagina IS NOT NULL AND o.pagina > o.lim THEN CONTINUE;"]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    ['M12 pagini_permise permite tot documentul când plafonul cade în el', [["greatest(0, least(pagini, coalesce(p_plafon, 0) - (cumul - pagini)))", "CASE WHEN cumul - pagini < coalesce(p_plafon, 0) THEN pagini ELSE 0 END"]], ['t2']],
    ['M13 fn_ofertare_semnale_felii fără filtrul p_extrageri', [["        WHERE e.licitatie_id = p_licitatie_id AND e.id = ANY (coalesce(p_extrageri, '{}'))", "        WHERE e.licitatie_id = p_licitatie_id"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M14 fn_ofertare_semnale_felii servește obs la neatribuibile', [["              CASE WHEN f.obs_atribuibile THEN coalesce((SELECT jsonb_agg(", "              CASE WHEN true THEN coalesce((SELECT jsonb_agg("]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M15 felii_autoritative fără DISTINCT ON (încercarea esuat reapare)', [["AS $f$ WITH f AS (SELECT DISTINCT ON (x.felie_nr) x.id, x.felie_nr, x.incercare, x.de_la, x.pana_la, x.stare", "AS $f$ WITH f AS (SELECT x.id, x.felie_nr, x.incercare, x.de_la, x.pana_la, x.stare"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M16 obs_atribuibile mereu true', [["coalesce(o.obs_numar, 0), NOT (n.incercari > 1 AND coalesce(o.obs_numar, 0) > 0)", "coalesce(o.obs_numar, 0), true"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M17 propune tratează observațiile neatribuibile ca ok', [["    IF o.obs_atribuibile IS FALSE THEN v_ver := 'neatribuibil';", "    IF false THEN v_ver := 'neatribuibil';"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M18 propune OMITE observațiile neatribuibile (asocierea dispare)', [["    IF o.obs_atribuibile IS FALSE THEN v_ver := 'neatribuibil';", "    IF o.obs_atribuibile IS FALSE THEN CONTINUE;"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M19 publica nu adaugă feliile obs_atribuibile = false în felii_incomplete (se bazează pe edge)', [["              UNION ALL\n              SELECT jsonb_build_object('extragere_id', (x ->> 'extragere_id')::bigint, 'felie_nr', fa.felie_nr, 'motiv', 'observatii_neatribuibile')\n                FROM public.fn_ofertare_masura_felii_autoritative((x ->> 'extragere_id')::bigint) fa WHERE NOT fa.obs_atribuibile) w)", "              ) w)"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M20 publica: un document contribuie doar prin componente ok', [["      FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL;\n    IF v_a.n = 0", "      FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL AND m.verificare = 'ok';\n    IF v_a.n = 0"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M21 fn_ofertare_semnale_context fără refuzul fotografie_schimbata', [["  IF v_foto ->> 'sha' IS DISTINCT FROM p_fotografie_sha THEN RETURN jsonb_build_object('refuz', 'fotografie_schimbata'); END IF;\n  SELECT x.id, x.text_extras", "  SELECT x.id, x.text_extras"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M22 fotografia fără decizii_sha', [["'felii_sha', fa.sha, 'obs_sha', oa.sha, 'decizii_sha', da.sha) ORDER BY d.id)", "'felii_sha', fa.sha, 'obs_sha', oa.sha, 'decizii_sha', NULL) ORDER BY d.id)"]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M23 publica ignoră inventarul documentelor F3 (doar B contribuie)', [["      FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL;\n    IF v_a.n = 0", "      FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL AND m.parte = 'b';\n    IF v_a.n = 0"]], ['t3_document_necitit + t3_incomplet_f3']],
    ['M24 poziția F3 neclasificată nu blochează măsurile cunoscute', [["    v_neclas := s.element <> 'necunoscut' AND EXISTS (", "    v_neclas := false AND EXISTS ("]], ['t3_neclasificat']],
    ['M25 evaluare_amprenta fără inventar', [["             || '|' || v_inv::text || '|' || v_verdict || '|' || coalesce(v_va::text, '') || '|' || coalesce(v_vb::text, ''), 'UTF8')), 'hex')", "             || '|' || v_verdict || '|' || coalesce(v_va::text, '') || '|' || coalesce(v_vb::text, ''), 'UTF8')), 'hex')"]], ['t3_incomplet']],
    ['M26 publica fără verificarea token / in_curs', [["  IF NOT FOUND OR v_ev.licitatie_id <> p_licitatie_id OR v_ev.stare <> 'in_curs' OR v_ev.token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('refuz', 'evaluare_necunoscuta'); END IF;", "  IF NOT FOUND OR v_ev.licitatie_id <> p_licitatie_id THEN RETURN jsonb_build_object('refuz', 'evaluare_necunoscuta'); END IF;"]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    ['M27 propune nu marchează semnalele vechi (identitatea dispărută rămâne cu verdictul vechi)', [["  UPDATE public.ofertare_cantitati_semnale s SET evaluare_in_curs_id = v_ev WHERE s.licitatie_id = p_licitatie_id AND s.evaluare_in_curs_id IS NULL;\n  v_lim :=", "  v_lim :="]], ['t3_tranzitii + t3_document_sters + t3_identitate_disparuta']],
    ['M28 publica fără dedup pe cantitate_id', [["      FROM (SELECT DISTINCT ON (m.cantitate_id) m.* FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.parte = 'a'\n             ORDER BY m.cantitate_id, (m.verificare = 'ok') DESC, m.id) t;", "      FROM (SELECT m.* FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.parte = 'a') t;"]], ['t3_identitate_pozitiei_dublura']],
    ['M29 observațiile F3 intră în partea B', [["            WHERE x ->> 'extragere_id' IS NOT NULL AND ob.rol_sursa IN ('atr', 'cs', 'memoriu', 'plansa', 'raspuns')", "            WHERE x ->> 'extragere_id' IS NOT NULL AND ob.rol_sursa IN ('atr', 'cs', 'memoriu', 'plansa', 'raspuns', 'f3', 'c6', 'lista_alt')"]], ['t3_cazul_tichetului']],
    ['M30 totalul adunat peste componente', [["                                                 'valoare', CASE WHEN b.n_comp_ok > 0 THEN b.suma_comp WHEN b.n_total_ok > 0 THEN b.suma_tot END,", "                                                 'valoare', b.suma_comp + b.suma_tot,"]], ['t3_total_componente']],
    ['M31 extragerea autoritativă = cea mai veche (nu id maxim)', [["WHERE e.document_id = d.id AND e.doc_sha256 = s.sha AND e.stare = 'gata' ORDER BY e.id DESC LIMIT 1) e ON true", "WHERE e.document_id = d.id AND e.doc_sha256 = s.sha AND e.stare = 'gata' ORDER BY e.id ASC LIMIT 1) e ON true"]], ['t3_extrageri_duble + t3_identitate_pozitiei']],
    ['M32 B însumat peste documente', [["    SELECT (b ->> 'document_id')::bigint, (b ->> 'valoare')::numeric INTO v_doc_b_id, v_vb FROM jsonb_array_elements(v_docs_b) b ORDER BY (b ->> 'n_ok')::int DESC, (b ->> 'document_id')::bigint LIMIT 1;", "    SELECT max((b ->> 'document_id')::bigint), sum((b ->> 'valoare')::numeric) INTO v_doc_b_id, v_vb FROM jsonb_array_elements(v_docs_b) b;"]], ['t3_doua_documente_b']],
    ['M33 verdict cu inventar incomplet (regula 4 scoasă)', [["    ELSIF v_fara_ok > 0 OR v_probleme IS NOT NULL THEN v_verdict := 'neverificat'; v_motiv := 'agregare incompletă' || coalesce(' (' || v_probleme || ')', '');", "    ELSIF false THEN v_verdict := 'neverificat'; v_motiv := 'agregare incompletă' || coalesce(' (' || v_probleme || ')', '');"]], ['t3_incomplet']],
    ['M34 documente_necitite ignorat', [["    IF jsonb_array_length(v_necitite) > 0 THEN v_verdict := 'neverificat'; v_motiv := 'document necitit (' || v_necitite_txt || ')';", "    IF false THEN v_verdict := 'neverificat'; v_motiv := 'document necitit (' || v_necitite_txt || ')';"]], ['t3_document_necitit + t3_incomplet_f3']],
    ['M35 reactivarea ciornei retrase de om', [["      ELSIF c.status = 'retrasa' AND c.baza_generare ->> 'retrasa_de' = 'sistem' THEN", "      ELSIF c.status = 'retrasa' THEN"]], ['t3_tranzitii + t3_document_sters + t3_identitate_disparuta']],
    ['M36 triggerul fără marcajul retrasa_de = om', [["  IF TG_OP='UPDATE' AND NEW.status='retrasa' AND OLD.status IS DISTINCT FROM 'retrasa' AND current_user IN ('authenticated','anon') THEN\n    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) || jsonb_build_object('retrasa_de','om','retrasa_de_uid',auth.uid(),'retrasa_la',now());\n  END IF;\n", ""]], ['t4_trigger_new_nu_old + t4_stari + t4_notifica_surse + t4_exceptie_surse_refuz']],
    ['M37 triggerul cu starea pe rândul recitit (nu NEW)', [["    v_st := public.fn_ofertare_ciorna_auto_stare(NEW,'tranzitie');", "    SELECT public.fn_ofertare_ciorna_auto_stare(k,'tranzitie') INTO v_st FROM public.ofertare_clarificari k WHERE k.id = NEW.id;"]], ['t4_trigger_new_nu_old + t4_stari + t4_notifica_surse + t4_exceptie_surse_refuz']],
    ['M38 triggerul cu v_auto doar pe auto_planse_', [["  v_auto := coalesce(NEW.cheie,'') ~ '^auto_(planse|surse)_' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') ~ '^auto_(planse|surse)_');", "  v_auto := coalesce(NEW.cheie,'') LIKE 'auto_planse_%' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') LIKE 'auto_planse_%');"]], ['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    ['M39 exportul fără dispecer pe surse', [["    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN\n      v_st := public.fn_ofertare_ciorna_auto_stare(c,'tranzitie');", "    IF coalesce(c.cheie,'') LIKE 'auto_planse_%' THEN\n      v_st := public.fn_ofertare_ciorna_auto_stare(c,'tranzitie');"]], ['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    ['M40 notificarea cu ORDER BY id', [["AND cheie ~ '^auto_(planse|surse)_' AND status <> 'retrasa' ORDER BY nr FOR UPDATE LOOP", "AND cheie ~ '^auto_(planse|surse)_' AND status <> 'retrasa' ORDER BY id FOR UPDATE LOOP"]], ['t4_lant_authenticated + t4_planse_neschimbat + t4_fara_advisory + t4_drepturi']],
    ['M41 vederea fără prefixul nou', [[" WHERE coalesce(c.cheie, '') ~ '^auto_(planse|surse)_' AND c.status <> 'retrasa';", " WHERE coalesce(c.cheie, '') LIKE 'auto_planse_%' AND c.status <> 'retrasa';"]], ['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    ['M42 publicarea alocă nr fără lock pe ciornele auto_surse (ordinea protocolului)', [["  PERFORM 1 FROM (SELECT k.id FROM public.ofertare_clarificari k WHERE k.licitatie_id = p_licitatie_id AND k.cheie LIKE 'auto_surse_%' ORDER BY k.nr FOR UPDATE) x;\n", ""]], ['t4_lant_authenticated + t4_planse_neschimbat + t4_fara_advisory + t4_drepturi']],
    ['M43 lotul: toate → NULL și pe licitațiile cu loturi', [["                   WHEN coalesce(p_lot_domeniu, 'toate') = 'toate' AND p_stare_loturi = 'fara_loturi' THEN jsonb_build_object('lot', NULL, 'cunoscut', true)", "                   WHEN coalesce(p_lot_domeniu, 'toate') = 'toate' THEN jsonb_build_object('lot', NULL, 'cunoscut', true)"]], ['t2', 't3_loturi']],
    ['M44 element necunoscut acceptat (lista închisă ignorată)', [["  IF el IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ofertare_elemente_masura x WHERE x.cod = el AND x.activ AND x.familie <> 'necunoscut') THEN el := NULL; END IF;\n", ""]], ['t2']],
    ['M45 numărul neîntreg acceptat în text liber', [["  IF NOT (v_num ->> 'intreg')::boolean THEN RETURN jsonb_build_object('verificare', 'numar_neintreg', 'valoare_text', m[2], 'um_text', m[3]); END IF;\n", ""]], ['t2']],
    ['M46 răspunsul legat fără verificarea tipului documentului', [["  IF d.id IS NULL OR d.licitatie_id <> s.licitatie_id OR d.tip IS DISTINCT FROM 'raspuns_clarificare' THEN", "  IF d.id IS NULL OR d.licitatie_id <> s.licitatie_id THEN"]], ['t3_raspuns']],
    ['M47 rezolvat ignoră revizia', [["                        AND coalesce(d.revizie, '-') = s.rezolvare ->> 'revizie') $f$;", ") $f$;"]], ['t3_raspuns']],
    // (M48 „ciorna liberă fără text_editat_de” e un mutant ECHIVALENT: gen_<md5 text> din sursa nu mai coincide după editare — apărare dublă, nu lipsă de probă)
    ['M48 ciorna liberă fără condiția de aprobare (reconfirmare)', [["AS $f$ SELECT c.status = 'propunere' AND NOT coalesce(c.baza_generare, '{}'::jsonb) ? 'text_editat_de' AND NOT coalesce(c.baza_generare, '{}'::jsonb) ? 'reconfirmare'", "AS $f$ SELECT c.status = 'propunere' AND NOT coalesce(c.baza_generare, '{}'::jsonb) ? 'text_editat_de'"]], ['t4_trigger_surse + t4_reconfirmare_surse + t4_view_surse + t4_export_surse']],
    ['M49 setările fără dreptul de decizie', [["  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: setarile cer drept de decizie pe licitatie' USING ERRCODE = '42501'; END IF;\n", ""]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M50 lista fără verificarea accesului (fail-open)', [["  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: fara acces la Ofertare' USING ERRCODE = '42501'; END IF;\n  v_sha :=", "  v_sha :="]], ['t3_drept + t3_lista_actual + t3_felii + t3_context']],
    ['M51 propune fără refuzul fotografiei vechi', [["  IF p_fotografie ->> 'sha' IS DISTINCT FROM v_foto ->> 'sha' THEN RETURN jsonb_build_object('refuz', 'evaluare_depasita', 'sha_acum', v_foto ->> 'sha'); END IF;\n", ""]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    ['M52 publica fără refuzul fotografiei schimbate', [["  IF v_foto ->> 'sha' IS DISTINCT FROM v_ev.surse_sha THEN\n    PERFORM set_config('ofertare.masuratori_rpc', '1', true);", "  IF false THEN\n    PERFORM set_config('ofertare.masuratori_rpc', '1', true);"]], ['t3_depasita + t3_izolare + t3_extragere_noua_intre_rpc + t3_plafon_vechi']],
    // r1 (Jakarinos): P1 proveniența ca DEFINER (current_user = mereu postgres → protecția dispare), P1 codul ca subșir, P1 prima potrivire în text, ambiguitatea A
    ['M53 proveniența ca SECURITY DEFINER (forma r1)', [[" LANGUAGE plpgsql\n SECURITY INVOKER\n SET search_path = public, pg_temp\nAS $fn$", " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path = public, pg_temp\nAS $fn$"]], ['t4_provenienta_directa']],
    ['M54 codul articolului acceptat ca subșir (SA11G10 dovedește SA11G1)', [["THEN strpos(' ' || upper(btrim(regexp_replace(l.linie, '[ ' || chr(9) || ']+', ' ', 'g'))) || ' ', ' ' || upper(btrim(r.cod_articol)) || ' ') > 0", "THEN strpos(upper(l.linie), upper(btrim(r.cod_articol))) > 0"]], ['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua']],
    ['M55 textul liber ia prima potrivire (fragment cu două cantități)', [["  IF v_nn > 1 THEN RETURN jsonb_build_object('verificare', 'fragment_ambiguu'); END IF;\n", ""]], ['t2']],
    ['M56 mai multe rânduri-ancoră → primul (nu rand_ambiguu)', [["          IF v_anc_n > 1 THEN v_ver := 'rand_ambiguu'; END IF;\n", ""]], ['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua']],
    // r2 P1: ancora filtrată după cantitate ÎNAINTE de numărarea ambiguității (rândul cu altă cantitate dispare → „ok” pe rândul vecin)
    ['M57 rândul-ancoră ales după cantitate (forma r2)', [["END;   -- ancora, FARA cantitate", "END\n       AND EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(btrim(regexp_replace(l.linie, '[ ' || chr(9) || ']+', ' ', 'g')), ' ')) t WHERE (public.fn_ofertare_numar_ro(t) ->> 'valoare')::numeric = q.cantitate);   -- ancora, FARA cantitate"]], ['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua']],
    // r3 P1: același rând revendicat de două poziții; denumirea ca subșir al alteia (fără UM-ul poziției după ea)
    ['M58 rândul revendicat de două poziții → ambele ok (revendicările ignorate)', [["          IF v_anc_n > 1 OR v_rev > 0 THEN v_ver := 'rand_ambiguu'; END IF;", "          IF v_anc_n > 1 THEN v_ver := 'rand_ambiguu'; END IF;"]], ['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua']],
    ['M59 ancora pe denumire fără UM-ul poziției după ea (forma r3)', [["' ' || public.fn_ofertare_masura_norm(q.denumire) || ' ' || public.fn_ofertare_masura_norm(q.um) || ' ') > 0 END;", "' ' || public.fn_ofertare_masura_norm(q.denumire) || ' ') > 0 END;"]], ['t3_dovada_a_cod_intreg + t3_dovada_a_ambigua']],
  ]
  const DOAR_MUTANT = (process.argv.find(a => a.startsWith('--mutant=')) || '').slice('--mutant='.length)   // depanare: un singur mutant
  for (const [nume, inl, scenarii] of MUTANTI) {
    if (DOAR_MUTANT && !nume.startsWith(DOAR_MUTANT + ' ')) continue
    let text
    try { text = FARA_POST(aplica(MIG, inl)) } catch (e) { ok(false, `${nume}: ${e.message}`); continue }
    const rez = []
    for (const scen of scenarii) rez.push(await comport(text, scen))
    const prins = rez.some(ab => ab.length > 0)
    ok(prins, `${nume} pică comportamental (${rez.map(ab => ab.length).join('/')} abateri: ${rez.flat()[0] || 'NU a picat'})`)
  }
  console.log('t5.6 mutanți structurali (cu postcondiții: aplicarea e refuzată, nimic schimbat) și pe gărzile de stare / revenire')
  for (const [nume, inl, re] of [
    ['S1 un RPC edge cu EXECUTE pentru authenticated', [['GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) TO service_role, authenticated;']], /postconditie: functia public\.fn_ofertare_semnale_fotografie\(bigint\)/],
    ['S2 vederea fără security_invoker', [['CREATE VIEW public.v_ofertare_clarificari_baza WITH (security_invoker = on) AS\nSELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> \'stare\' AS stare, s.x ->> \'mod_ciorna\' AS mod_ciorna, s.x -> \'curent\' ->> \'mod\' AS mod_curent,\n       s.x ->> \'amprenta_curenta\' AS amprenta_curenta, coalesce((s.x ->> \'marcaj_planse\')::boolean, false) AS marcaj_planse, s.x ->> \'text\' AS text, s.x AS detalii\n  FROM public.ofertare_clarificari c\n CROSS JOIN LATERAL (SELECT public.fn_ofertare_ciorna_auto_stare(c, \'afisare\') AS x) s', 'CREATE VIEW public.v_ofertare_clarificari_baza AS\nSELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> \'stare\' AS stare, s.x ->> \'mod_ciorna\' AS mod_ciorna, s.x -> \'curent\' ->> \'mod\' AS mod_curent,\n       s.x ->> \'amprenta_curenta\' AS amprenta_curenta, coalesce((s.x ->> \'marcaj_planse\')::boolean, false) AS marcaj_planse, s.x ->> \'text\' AS text, s.x AS detalii\n  FROM public.ofertare_clarificari c\n CROSS JOIN LATERAL (SELECT public.fn_ofertare_ciorna_auto_stare(c, \'afisare\') AS x) s']], /postconditie: vederea/],
    ['S3 o funcție nouă cheamă altceva (fn_ofertare_cb_poate)', [["  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: fara acces la Ofertare' USING ERRCODE = '42501'; END IF;\n  v_sha :=", "  IF auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_cb_poate(p_licitatie_id), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: fara acces la Ofertare' USING ERRCODE = '42501'; END IF;\n  v_sha :="]], /cheama in afara lantului declarat: (public\.)?fn_ofertare_cb_poate\(bigint\)/],
    ['S4 fără triggerul de imuabilitate pe măsurători', [['CREATE TRIGGER trg_ofertare_masuratori_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cantitati_masuratori\n  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_masuratori_imuabil();\n', '']], /postconditie: triggerul trg_ofertare_masuratori_imuabil/],
    ['S5 fără UNIQUE (licitatie_id, nr)', [['ALTER TABLE public.ofertare_clarificari ADD CONSTRAINT ofertare_clarificari_licitatie_nr_uq UNIQUE (licitatie_id, nr);\n', '']], /postconditie: UNIQUE \(licitatie_id, nr\)/],
    ['S6 RLS lipsă pe semnale', [['ALTER TABLE public.ofertare_cantitati_semnale ENABLE ROW LEVEL SECURITY;\n', '']], /postconditie: RLS \/ politica \/ drepturile tabelului public\.ofertare_cantitati_semnale/],
    ['S7 un RPC UI SECURITY INVOKER', [["CREATE FUNCTION public.fn_ofertare_semnale_lista(p_licitatie_id bigint) RETURNS TABLE (semnal jsonb, rezolvat boolean, actual boolean, in_curs boolean, masuratori jsonb)\nLANGUAGE plpgsql STABLE SECURITY DEFINER", "CREATE FUNCTION public.fn_ofertare_semnale_lista(p_licitatie_id bigint) RETURNS TABLE (semnal jsonb, rezolvat boolean, actual boolean, in_curs boolean, masuratori jsonb)\nLANGUAGE plpgsql STABLE SECURITY INVOKER"]], /postconditie: functia public\.fn_ofertare_semnale_lista\(bigint\)/],
    ['S8 corp rescris cu alt text decât cel declarat (export)', [["    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;\n    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN", "    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN"]], /postconditie: public\.ofertare_clarificari_export\(bigint\) nu are corpul/],
    ['S9 advisory în notificare (protocolul lock-urilor)', [["DECLARE c public.ofertare_clarificari; v_st jsonb; v_resp uuid[]; v_n int := 0;\nBEGIN\n  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;\n  -- 20261121a", "DECLARE c public.ofertare_clarificari; v_st jsonb; v_resp uuid[]; v_n int := 0;\nBEGIN\n  PERFORM pg_advisory_xact_lock(hashtextextended('ofertare_cantitati_semnale:' || p_licitatie_id, 0));\n  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;\n  -- 20261121a"]], /postconditie: (protocolul lock-urilor|public\.ofertare_clarificari_notifica\(bigint\) nu are corpul)/],
  ]) {
    const db = await bazaNoua()
    const s = await stare(db)
    let r
    try { r = await livreaza(db, aplica(MIG, inl)) } catch (e) { r = { ok: false, eroare: 'mutant inaplicabil: ' + e.message } }
    ok(!r.ok && re.test(r.eroare) && JSON.stringify(await stare(db)) === JSON.stringify(s), `${nume}: refuzat de postcondiții (${(r.eroare || 'APLICAT').slice(0, 120)})`)
    await db.close()
  }
  const rezultat = async (scenariuFn, text) => {
    const db = await bazaNoua()
    try { const r = await scenariuFn(db, text); return `${r.ok ? 'APLICAT' : 'REFUZ ' + r.eroare} | ${JSON.stringify(await stare(db))}` } finally { await db.close() }
  }
  const SCEN = {
    dubluNr: async (db, t) => { await db.exec(`INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (${LIC}, 3, 'a', 'propunere'), (${LIC}, 3, 'b', 'propunere')`); return livreaza(db, t) },
    corpLive: async (db, t) => { await db.exec(`ALTER FUNCTION public.ofertare_clarificari_notifica(bigint) SECURITY INVOKER`); return livreaza(db, t) },
    revDate: async (db, t) => { await livreaza(db, MIG); await fixturaTichet(db); await evalueaza(db); return revino(db, t) },
    revCorp: async (db, t) => { await livreaza(db, MIG); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_ofertare_numar_ro(p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END $f$`); return revino(db, t) },
  }
  for (const [nume, fisier, inl, scenariu_] of [
    ['P1 migrare: fără preflight-ul dublurilor de nr', 'mig', [["  IF v_dublu > 0 THEN\n    RAISE EXCEPTION '20270112a: CM_NR_DUBLU", "  IF false THEN\n    RAISE EXCEPTION '20270112a: CM_NR_DUBLU"]], 'dubluNr'],
    ['P2 migrare: fără verificarea corpurilor LIVE', 'mig', [["      RAISE EXCEPTION '20270112a: % nu e corpul LIVE asteptat (corp md5 %, definer %, cale sau proprietar); coordonatorul da textul exact (pg_get_functiondef)', r.fn, r.corp_md5, r.definer;\n", "      NULL;\n"]], 'corpLive'],
    ['R1 revenire: fără refuzul pe date', 'rev', [["  IF v_ev + v_sem + v_mas + v_set + v_ciorne > 0 THEN", "  IF false THEN"]], 'revDate'],
    ['R2 revenire: fără amprentele funcțiilor noi', 'rev', [["                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil", "                     AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil"]], 'revCorp'],
  ]) {
    if (fisier === 'rev' && !REV) { ok(false, nume + ': revenirea lipsește'); continue }
    const orig = fisier === 'mig' ? MIG : REV
    let ro, rm
    try { ro = await rezultat(SCEN[scenariu_], orig); rm = await rezultat(SCEN[scenariu_], aplica(orig, inl)) } catch (e) { ro = 'x'; rm = 'x'; console.log('     ' + e.message) }
    ok(ro !== rm && /^REFUZ/.test(ro), `${nume} prins: original «${ro.slice(0, 80)}» ≠ mutant «${rm.slice(0, 80)}»`)
  }
}

console.log(esec ? `\nEȘEC: ${esec} verificări picate` : '\nTOATE VERIFICĂRILE AU TRECUT')
process.exit(esec ? 1 : 0)
