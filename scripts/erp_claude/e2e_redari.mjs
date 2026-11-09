// Test E2E al modulului Redări în ERP-ul LIVE, cu browser automat (cerere Răzvan 06.11.2026): contul claude@ (redari:admin) prin UI,
// nu prin API. Model de login / parolă: scripts/erp_claude/ofertare_cb.mjs (parola NU se afișează, nu se scrie în log, raport sau captură).
//
// LIMITE (impuse în cod, nu doar în brief):
//   • scrieri DOAR pe proiectul TEST-RAZVAN (id fix mai jos): înaintea fiecărui click care scrie, asiguraTest() citește selectorul de proiect
//     din pagină; dacă nu e TEST-RAZVAN, testul se OPREȘTE (Oprire), nu continuă pe alt proiect;
//   • LOT1-PRUNISOR-JUPA = doar citire: înainte de a-l selecta, garda de rețea trece în modul „citire” (blochează PATCH/PUT/DELETE,
//     POST pe tabele, upload în Storage, orice funcție edge), descărcările se anulează, capturile se decupează la bara de titlu + taburi
//     (fără nume / telefoane / adrese), iar în raport intră doar cifre;
//   • NICIODATĂ, pe niciun proiect: funcțiile edge cu sms / mail / email / smtp / trimite / send / notific în nume sunt blocate de gardă;
//     dialogurile window.confirm se acceptă DOAR pentru mesajele din lista pasului curent (import, generare convocatoare / plicuri pe
//     TEST-RAZVAN), restul se refuză; scriptul nu are niciun pas de trimitere, aprobare, autorizare TGZ, setări SMS / mail sau drepturi.
//
// Playwright: `playwright` / `playwright-core` din node_modules dacă există; altfel PLAYWRIGHT_CORE (cale spre index.mjs) sau driverul JS
// din pachetul Python (C:/Program Files/Python313/.../playwright/driver/package). Browser: Edge instalat (channel msedge), fără descărcări.
//
// Utilizare (din rădăcina repo-ului, pe serverul AI):
//   node scripts/erp_claude/e2e_redari.mjs [--doar-citire] [--fara-lot1] [--vizibil] [--out <dir>]
//     --doar-citire  sare peste pașii care scriu pe TEST-RAZVAN (import, contact, convocator, plicuri, PV)
//     --fara-lot1    nu deschide LOT1
//     --vizibil      browser cu fereastră (implicit headless)
//     --out          implicit C:/Users/Public/paw-data/out/teste_redari_<AAAA-LL-ZZ>  (NU în repo)
// Ieșire: capturi + descărcări + RAPORT.md + rezultat.json în --out. Cod: 0 toți pașii OK · 1 pași eșuați / oprire · 2 utilizare greșită.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as XLSXns from 'xlsx-js-style'
const XLSX = XLSXns.utils ? XLSXns : XLSXns.default   // CJS: în Node ESM vine sub `default`, în vitest direct

export const BAZA = process.env.ERP_URL || 'https://pontaj-pro-sooty.vercel.app'
export const TEST = { id: '8ae639ae-e591-4554-8c00-512285a27acd', cod: 'TEST-RAZVAN' }
export const LOT1 = { cod: 'LOT1-PRUNISOR-JUPA' }
const EMAIL = process.env.ERP_CLAUDE_EMAIL || 'claude@gazpet.ro'
const F_PAROLA = process.env.ERP_CLAUDE_PAROLA_FILE || 'C:/Users/Gazpet-Ai/.secrete/erp_claude_parola.txt'
const PW_PYTHON = 'C:/Program Files/Python313/Lib/site-packages/playwright/driver/package/index.mjs'
export const PREFIX_PROBA = 'TESTE2E'   // numele fictive din fișierul de probă (căutate apoi în Registru)

export class Oprire extends Error {}    // abatere de la limite → testul se oprește, nu continuă
export class EroareUtilizare extends Error {}

// ─── funcții pure (testate în e2e_redari.test.js) ──────────────────────────────────────────────────────────────────────────────

export function citesteArgs(argv) {
  const o = { doarCitire: false, faraLot1: false, vizibil: false, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--doar-citire') o.doarCitire = true
    else if (a === '--fara-lot1') o.faraLot1 = true
    else if (a === '--vizibil') o.vizibil = true
    else if (a === '--out') { o.out = argv[++i]; if (!o.out) throw new EroareUtilizare('--out cere o cale') }
    else throw new EroareUtilizare(`Argument necunoscut: ${a}`)
  }
  return o
}

const RE_INTERZIS = /sms|mail|smtp|trimite|send|notific/i
// LISTA ALBĂ a RPC-urilor care DOAR citesc: funcții declarate STABLE/IMMUTABLE în supabase/migrations (PostgreSQL refuză orice
// INSERT/UPDATE/DELETE dintr-o funcție STABLE/IMMUTABLE), chemate de aplicație; verificată pe migrări la 09.11.2026.
// În modul citire (LOT1) doar acestea trec; orice alt RPC e blocat. O funcție nouă de citire se adaugă aici explicit.
export const RPC_CITIRE = new Set([
  'fn_red_sms_stare', 'fn_sms_panou', 'fn_red_valoare_parcela', 'fn_red_informare_publicata',
  'fn_sms_lot_destinatari', 'fn_sms_loturi_lista', 'fn_izo_citire', 'fn_izo_proiecte_protejate', 'fn_cont_stare_angajati',
  'fn_garantii_tipuri', 'fn_hr_decizii_emitenti', 'fn_hr_decizii_poate', 'fn_are_acces_ofertare', 'fn_poate_citi_pf', 'fn_poate_scrie_pf',
  'iot_lumini_drept', 'probe_teren_drept', 'egress_statistici', 'fn_ai_cost_lunar',
])
// Ce poate scrie fluxul de test pe TEST-RAZVAN (modul scriere): DOAR aceste RPC-uri și tabele, și DOAR cu ID-uri dovedite ale
// proiectului de test (vezi idDovedit). Orice altceva (alt modul, ștergeri, proiecte, setări, drepturi) e blocat.
export const RPC_SCRIERE_TEST = new Set([
  'fn_red_seteaza_tronson', 'fn_red_pv_creeaza', 'fn_red_pv_c_creeaza', 'fn_red_plic_creeaza', 'fn_red_lot_plicuire_creeaza',
  'fn_red_convocare_leaga', 'fn_red_convocare_rezerva', 'fn_red_adresa_uat_rezerva', 'fn_red_valoare_parcela_seteaza',
])
export const TABELE_SCRIERE_TEST = new Set([
  'red_import_loturi', 'red_parcele', 'red_detinatori', 'red_detinatori_contact', 'red_uat', 'red_convocari', 'red_plicuri',
  'red_procese_verbale', 'red_corespondenta', 'red_corespondenta_fisiere',
])
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// Contextul gărzii: ID-urile DOVEDITE ca aparținând proiectului de test (id-ul proiectului + ce a apărut în răspunsurile cererilor
// filtrate pe TEST-RAZVAN sau ale scrierilor permise). Un ID care nu e aici nu poate fi atins de o scriere.
export const ctxGarda = () => ({ idTest: new Set([TEST.id.toLowerCase()]) })
const idDovedit = (ctx, v) => ctx.idTest.has(String(v).toLowerCase())
const parseCorp = (corp) => {
  if (corp == null || corp === '') return {}
  if (typeof corp === 'object') return corp
  try { return JSON.parse(corp) } catch { return undefined }
}
// toate UUID-urile dintr-o valoare JSON (adânc), cu cheia sub care stau
function uuiduri(v, cheie = '', out = []) {
  if (v == null) return out
  if (typeof v === 'string') { if (RE_UUID.test(v.trim())) out.push({ cheie, v: v.trim().toLowerCase() }); return out }
  if (Array.isArray(v)) { for (const x of v) uuiduri(x, cheie, out); return out }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) uuiduri(x, k, out); return out }
  return out
}
// UUID-urile din filtrele PostgREST din URL (id=eq.X, proiect_id=in.(X,Y), or=(…)), indiferent de coloană
const uuiduriQuery = (u) => [...u.searchParams.entries()].flatMap(([, v]) => String(v).match(RE_UUID_GLOBAL) || []).map(x => x.toLowerCase())
const esteUpsert = (u, antete) => u.searchParams.has('on_conflict') || /merge-duplicates/i.test(String(antete?.prefer || antete?.Prefer || ''))

// Garda de rețea: 'blocheaza' sau 'permite' pentru o cerere spre Supabase, în funcție de mod ('scriere' = TEST-RAZVAN, 'citire' = LOT1 /
// --doar-citire) și de conținutul REAL al cererii (corp + ID-uri), nu doar de URL.
//  • pe orice mod: funcțiile edge și RPC-urile de trimitere (sms / mail / trimite …) sunt blocate; orice funcție edge non-GET e blocată;
//  • citire: trec doar GET/HEAD/OPTIONS, reîmprospătarea sesiunii, linkurile semnate / listările Storage și RPC-urile din RPC_CITIRE;
//  • scriere: trec doar RPC_SCRIERE_TEST / TABELE_SCRIERE_TEST / încărcările în redari/TEST-RAZVAN/, și numai dacă fiecare UUID din cerere
//    (corp + filtre) e dovedit ca al proiectului de test; rândurile cu proiect_id trebuie să aibă proiect_id = TEST-RAZVAN;
//    ștergerile, proiectele și orice tabel din alt modul sunt blocate. Ce nu se poate dovedi = blocat (testul pică vizibil, nu scrie).
export function clasificaCerere({ url, metoda, corp, antete }, mod, ctx = ctxGarda()) {
  let u
  try { u = new URL(url) } catch { return 'permite' }
  if (!/supabase\.co$/.test(u.hostname)) return 'permite'
  const p = u.pathname, m = String(metoda || 'GET').toUpperCase()
  const doarCitire = m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
  if (p.startsWith('/functions/v1/')) {
    if (RE_INTERZIS.test(p.slice('/functions/v1/'.length))) return 'blocheaza'
    return doarCitire ? 'permite' : 'blocheaza'
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length)
    if (RPC_CITIRE.has(fn)) return 'permite'
    if (RE_INTERZIS.test(fn) || mod !== 'scriere' || !RPC_SCRIERE_TEST.has(fn)) return 'blocheaza'
    const c = parseCorp(corp)
    if (c === undefined) return 'blocheaza'
    const ids = [...uuiduri(c), ...uuiduriQuery(u).map(v => ({ cheie: '', v }))]
    return ids.length > 0 && ids.every(x => idDovedit(ctx, x.v)) ? 'permite' : 'blocheaza'
  }
  if (doarCitire) return 'permite'
  if (p.startsWith('/auth/v1/')) return 'permite'                     // reîmprospătarea sesiunii
  if (p.startsWith('/storage/v1/object/sign/') || p.startsWith('/storage/v1/object/list/')) return 'permite'   // linkuri semnate / listare = citire
  if (mod !== 'scriere') return 'blocheaza'
  if (p.startsWith('/storage/v1/object/')) {
    const seg = p.slice('/storage/v1/object/'.length).split('/').map(decodeURIComponent)
    return m === 'POST' && seg[0] === 'redari' && seg[1] === TEST.cod && seg.length >= 3 ? 'permite' : 'blocheaza'   // doar încărcări noi
  }
  if (!p.startsWith('/rest/v1/')) return 'blocheaza'
  const tabel = p.slice('/rest/v1/'.length)
  if (!TABELE_SCRIERE_TEST.has(tabel) || (m !== 'POST' && m !== 'PATCH')) return 'blocheaza'   // fără DELETE / PUT
  const idsUrl = uuiduriQuery(u)
  if (!idsUrl.every(v => idDovedit(ctx, v))) return 'blocheaza'
  if (m === 'PATCH' && idsUrl.length === 0) return 'blocheaza'         // UPDATE fără filtru pe ID-uri dovedite = refuz
  const c = parseCorp(corp)
  if (c === undefined || c === null || typeof c !== 'object') return 'blocheaza'
  const randuri = Array.isArray(c) ? c : [c]
  if (randuri.length === 0) return 'blocheaza'
  const upsert = esteUpsert(u, antete)
  for (const r of randuri) {
    if (r == null || typeof r !== 'object' || Array.isArray(r)) return 'blocheaza'
    if ('proiect_id' in r && String(r.proiect_id).toLowerCase() !== TEST.id.toLowerCase()) return 'blocheaza'
    const ids = uuiduri(r)
    // la INSERT simplu, cheia `id` a rândului nou poate fi un UUID nou; la upsert / update trebuie dovedită ca orice alt ID
    const deVerificat = ids.filter(x => !(m === 'POST' && !upsert && x.cheie === 'id'))
    if (!deVerificat.every(x => idDovedit(ctx, x.v))) return 'blocheaza'
    // rândul trebuie legat de proiectul de test: proiect_id = TEST, un ID dovedit în corp sau un filtru dovedit în URL
    if (!('proiect_id' in r) && deVerificat.length === 0 && idsUrl.length === 0) return 'blocheaza'
  }
  return 'permite'
}

// Învățarea ID-urilor proiectului de test, din răspunsurile Supabase reușite, DOAR în modul scriere și DOAR pentru cereri legate dovedit
// de TEST-RAZVAN: filtrul din URL pe proiect_id = TEST, corpul cu proiect_id = TEST sau o scriere permisă de gardă.
export function invataIduri({ url, metoda, corp, permisa }, raspuns, mod, ctx) {
  if (mod !== 'scriere' || raspuns == null) return 0
  let u
  try { u = new URL(url) } catch { return 0 }
  if (!/supabase\.co$/.test(u.hostname) || !u.pathname.startsWith('/rest/v1/')) return 0
  const filtruTest = [...u.searchParams.entries()].some(([k, v]) => /^(proiect_id|p_proiect_id)$/.test(k) && String(v).toLowerCase() === `eq.${TEST.id.toLowerCase()}`)
  const c = parseCorp(corp)
  const corpTest = c && typeof c === 'object' && (Array.isArray(c) ? c : [c]).some(r => r && String(r.proiect_id ?? r.p_proiect_id ?? '').toLowerCase() === TEST.id.toLowerCase())
  const m = String(metoda || 'GET').toUpperCase()
  if (!(filtruTest || corpTest || (permisa && m !== 'GET'))) return 0
  let n = 0
  for (const x of uuiduri(raspuns)) if (!ctx.idTest.has(x.v)) { ctx.idTest.add(x.v); n++ }
  return n
}
// Răspunsuri de eroare AȘTEPTATE (sonde intenționate ale aplicației), scoase din „HTTP eșuate” și numărate separat
export const ERORI_ASTEPTATE = [
  { url: /\/rest\/v1\/rpc\/fn_red_convocare_rezerva$/, detaliu: /parametri lipsa/, motiv: 'sonda detecteazaRezervare (p_detinator_id null → 22023 = RPC-ul există)' },
]
export const esteAsteptata = (url, detaliu) => ERORI_ASTEPTATE.find(e => e.url.test(String(url).split('?')[0]) && e.detaliu.test(String(detaliu || ''))) || null

// Selectorul de proiect: valoare = id-ul proiectului, text = „COD — denumire”. Scrierile cer AMBELE potriviri (id + cod).
export const esteProiectTest = (sel) => !!sel && sel.value === TEST.id && String(sel.text || '').trim().startsWith(TEST.cod + ' ')
export const esteProiectLot1 = (sel) => !!sel && String(sel.text || '').trim().startsWith(LOT1.cod + ' ')

// URL scurtat pentru raport: calea + query tăiat (fără fragmente lungi); fără token-uri (Supabase le pune în antete, nu în URL)
export const urlScurt = (url) => { try { const u = new URL(url); const q = u.search.length > 160 ? u.search.slice(0, 160) + '…' : u.search; return u.host.split('.')[0] + u.pathname + q } catch { return String(url).slice(0, 200) } }

// Fișierul de probă TGZ: 3 parcele fictive (a treia cu 2 coproprietari), identitate pe poziția HG 9901–9903 (reimportul refolosește parcelele).
export function fisierProba({ uat, judet }) {
  const adr = (n) => `str. Fictivă nr. ${n}, sat Testare, com. Testare${judet ? `, jud. ${judet}` : ''}`
  const randuri = [
    ['Nr.Crt.', 'Poz. HG', 'UAT', 'Județ', 'Nume', 'Adresă', 'Suprafață (mp)', 'Categorie folosință', 'Tarla', 'Nr. cadastral'],
    ['9901', '9901', uat, judet || '', `${PREFIX_PROBA} PRIMUL`, adr(1), 120, 'arabil', 'T99', ''],
    ['9902', '9902', uat, judet || '', `${PREFIX_PROBA} DOILEA`, adr(2), 80, 'pasune', 'T99', ''],
    ['9903/1', '9903', uat, judet || '', `${PREFIX_PROBA} TREILEA`, adr(3), 60, 'arabil', 'T99', ''],
    ['9903/2', '9903', uat, judet || '', `${PREFIX_PROBA} PATRULEA`, adr(4), 60, 'arabil', 'T99', ''],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(randuri), 'TGZ')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

const escMd = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
export function raportMd({ pasi, meta, oprire }) {
  const ok = pasi.filter(p => p.rezultat === 'OK').length, esec = pasi.filter(p => p.rezultat === 'EȘUAT').length, sarit = pasi.filter(p => p.rezultat === 'SĂRIT').length
  const l = []
  l.push(`# Test E2E Redări — ${meta.data}`, '')
  l.push(`- ERP: ${meta.baza} · cont: ${meta.email} · browser: ${meta.browser}`)
  l.push(`- Mod: ${meta.doarCitire ? 'doar citire' : 'scriere pe TEST-RAZVAN'}${meta.faraLot1 ? ' · fără LOT1' : ' · LOT1 doar citire'}`)
  l.push(`- Pași: **${ok} OK**, **${esec} eșuați**, ${sarit} săriți (din ${pasi.length}) · durată ${meta.durata}`)
  if (oprire) l.push(`- ⛔ **Test oprit**: ${escMd(oprire)}`)
  l.push(`- Cereri blocate de gardă: ${meta.blocate.length}${meta.blocate.length ? ' — ' + meta.blocate.slice(0, 10).map(b => `${b.metoda} ${b.url}`).join('; ') : ''}`)
  if (meta.asteptate?.length) l.push(`- Erori HTTP așteptate (sonde ale aplicației, scoase din tabel): ${meta.asteptate.map(a => `pas ${a.pas} HTTP ${a.status} — ${a.motiv}`).join('; ')}`)
  if (meta.zgomotHead) l.push(`- Cereri HEAD (numărători) raportate de Chromium ca ERR_ABORTED fără eroare HTTP: ${meta.zgomotHead} — ignorate (zgomot cunoscut)`)
  l.push('', '| # | Pas | Proiect | Rezultat | Ce s-a văzut | Consolă | HTTP eșuate | Captură |', '|---|---|---|---|---|---|---|---|')
  for (const p of pasi) {
    l.push(`| ${p.nr} | ${escMd(p.nume)} | ${p.proiect} | ${p.rezultat} | ${escMd(p.vazut)} | ${p.consola.length} | ${p.http.length} | ${p.captura ? `[${p.captura}](${p.captura})` : '-'} |`)
  }
  const cuErori = pasi.filter(p => p.consola.length || p.http.length || p.rezultat === 'EȘUAT')
  l.push('', '## Detalii pe pas (erori consolă / HTTP)', '')
  if (!cuErori.length) l.push('Niciun pas cu erori de consolă sau cereri eșuate.')
  for (const p of cuErori) {
    l.push(`### ${p.nr}. ${escMd(p.nume)} — ${p.rezultat}`)
    if (p.rezultat === 'EȘUAT') l.push(`- eroare: ${escMd(p.vazut)}`)
    for (const c of p.consola.slice(0, 15)) l.push(`- consolă: \`${escMd(c).slice(0, 400)}\``)
    for (const h of p.http.slice(0, 15)) l.push(`- HTTP ${h.status} ${h.metoda} \`${escMd(h.url)}\`${h.detaliu ? ` — ${escMd(h.detaliu).slice(0, 300)}` : ''}`)
    l.push('')
  }
  l.push('## Bug-uri (cu reproducere)', '', '_Completat după analiza pașilor de mai sus._', '')
  return l.join('\n')
}

// ─── rularea în browser ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function incarcaPlaywright() {
  for (const m of ['playwright', 'playwright-core']) { try { return await import(m) } catch { /* următorul */ } }
  const cale = process.env.PLAYWRIGHT_CORE || PW_PYTHON
  try { const mod = await import(pathToFileURL(cale).href); return mod.default?.chromium ? mod.default : mod }
  catch (e) { throw new Error(`Playwright negăsit (node_modules, PLAYWRIGHT_CORE sau ${PW_PYTHON}): ${e.message}`) }
}

const primaLinie = (f) => {
  let t
  try { t = readFileSync(f, 'utf8') } catch { throw new Error(`Lipsește fișierul parolei: ${f}`) }
  const v = t.replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim()
  if (!v) throw new Error(`Fișierul parolei e gol: ${f}`)
  return v
}

// Observă toast-urile (containerul fix cu z-index 9999 din comune.jsx / App) — istoric complet, citit după fiecare acțiune
const SCRIPT_TOAST = `(() => { window.__toasturi = []; const vezi = () => new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
  const p = n.parentElement; if (n.nodeType === 1 && p && p.style && p.style.position === 'fixed' && p.style.zIndex === '9999') window.__toasturi.push(n.textContent) } })
  .observe(document.documentElement || document, { childList: true, subtree: true }); if (document.documentElement) vezi(); else document.addEventListener('DOMContentLoaded', vezi) })()`

export async function ruleaza(opt) {
  const t0 = Date.now()
  const data = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })
  const out = path.resolve(opt.out || `C:/Users/Public/paw-data/out/teste_redari_${data}`)
  const dirDesc = path.join(out, 'descarcari')
  mkdirSync(dirDesc, { recursive: true })
  const pw = await incarcaPlaywright()
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: !opt.vizibil })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, locale: 'ro-RO', timezoneId: 'Europe/Bucharest' })
  await context.addInitScript(SCRIPT_TOAST)
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)

  // --doar-citire: garda pornește direct în modul „citire” (nu doar pașii de scriere săriți)
  const stare = { mod: opt.doarCitire ? 'citire' : 'scriere', proiect: '-', dialoguri: [], consola: [], http: [], blocate: [], asteptate: [], descarcari: [], pas: 0, inZbor: new Set() }
  // cererile spre Supabase în zbor — un ecran e „încărcat” abia când s-au terminat (vederile lente răspund după 8–12 s)
  const eSb = (r) => /supabase\.co\/(rest|storage|functions)\//.test(r.url())
  page.on('request', (r) => { if (eSb(r)) stare.inZbor.add(r) })
  page.on('requestfinished', (r) => stare.inZbor.delete(r))
  page.on('requestfailed', (r) => stare.inZbor.delete(r))
  const blocateUrl = new Set()
  const ctx = ctxGarda()                 // ID-urile dovedite ale proiectului de test (vezi clasificaCerere / invataIduri)
  const permise = new WeakSet()          // scrierile lăsate să treacă de gardă (din răspunsul lor se învață ID-uri noi)
  const corpCerere = (r) => { try { return r.postData() } catch { return undefined } }
  await context.route('**/*', (route) => {
    const r = route.request()
    const decizie = clasificaCerere({ url: r.url(), metoda: r.method(), corp: corpCerere(r), antete: r.headers() }, stare.mod, ctx)
    if (decizie === 'blocheaza') {
      const b = { metoda: r.method(), url: urlScurt(r.url()), pas: stare.pas }
      stare.blocate.push(b); blocateUrl.add(r.url())
      return route.abort('blockedbyclient')
    }
    permise.add(r)
    return route.continue()
  })
  page.on('console', (m) => { if (m.type() === 'error') stare.consola.push(m.text()) })
  page.on('pageerror', (e) => stare.consola.push('pageerror: ' + (e.message || e)))
  page.on('response', async (r) => {
    if (r.status() < 400) {
      // învățarea ID-urilor proiectului de test: doar modul scriere, doar răspunsuri JSON reușite ale cererilor legate de TEST-RAZVAN
      if (stare.mod === 'scriere' && /supabase\.co\/rest\//.test(r.url()) && /json/.test(r.headers()['content-type'] || '')) {
        try {
          const q = r.request()
          invataIduri({ url: r.url(), metoda: q.method(), corp: corpCerere(q), permisa: permise.has(q) }, await r.json(), stare.mod, ctx)
        } catch { /* fără corp JSON: nimic de învățat */ }
      }
      return
    }
    let detaliu = ''
    try { if (/json/.test(r.headers()['content-type'] || '')) { const j = await r.json(); detaliu = j?.message || j?.error || j?.msg || '' } } catch { /* fără corp */ }
    const asteptata = esteAsteptata(r.url(), detaliu)
    if (asteptata) { stare.asteptate.push({ pas: stare.pas, status: r.status(), motiv: asteptata.motiv }); return }
    stare.http.push({ status: r.status(), metoda: r.request().method(), url: urlScurt(r.url()), detaliu: stare.mod === 'citire' ? '' : String(detaliu) })
  })
  page.on('requestfailed', async (r) => {
    if (blocateUrl.has(r.url())) return
    const err = r.failure()?.errorText || ''
    // HEAD (numărătorile count:'exact', head:true) apar în Chromium ca ERR_ABORTED deși răspunsul a venit — zgomot, numărat separat
    if (r.method() === 'HEAD' && /ERR_ABORTED/.test(err)) { const resp = await r.response().catch(() => null); if (!resp || resp.status() < 400) { stare.zgomotHead = (stare.zgomotHead || 0) + 1; return } }
    stare.http.push({ status: 'fail', metoda: r.method(), url: urlScurt(r.url()), detaliu: err })
  })
  page.on('dialog', async (d) => {
    const ok = stare.mod === 'scriere' && stare.dialoguri.some(re => re.test(d.message()))
    stare.ultimDialog = { mesaj: stare.mod === 'citire' ? '(LOT1)' : d.message().slice(0, 200), acceptat: ok }
    try { ok ? await d.accept() : await d.dismiss() } catch { /* închis deja */ }
  })
  page.on('download', async (d) => {
    if (stare.mod === 'citire') { await d.cancel().catch(() => {}); stare.descarcari.push('(anulată — mod citire)'); return }
    const nume = `${String(stare.pas).padStart(2, '0')}_${d.suggestedFilename().replace(/[^\w.\-]+/g, '_')}`
    try { await d.saveAs(path.join(dirDesc, nume)); stare.descarcari.push(nume) } catch (e) { stare.descarcari.push(`(eșuată: ${e.message})`) }
  })

  const pasi = []
  let oprire = null
  const linisteste = async (ms = 600) => {
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    for (const lim = Date.now() + 60_000; stare.inZbor.size && Date.now() < lim;) await page.waitForTimeout(250)
    await page.waitForTimeout(ms)
  }
  // „Se încarcă…” (Gol din comune.jsx) / „Se încarcă...” trebuie să dispară; altfel ecranul nu s-a încărcat
  const asteaptaIncarcare = async (ms = 60_000) => {
    const inc = page.getByText(/^Se încarcă(…|\.\.\.)$/)
    for (const lim = Date.now() + ms; (await inc.count()) && Date.now() < lim;) await page.waitForTimeout(500)
    if (await inc.count()) throw new Error(`ecranul încă „Se încarcă…” după ${ms / 1000} s`)
  }
  // alertele vizibile ale ecranului (p / div role=alert): eroare de încărcare afișată utilizatorului
  const alerte = async () => (await page.locator('[role="alert"]:visible').allInnerTexts().catch(() => [])).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const ecran = async (eticheta, lot1 = false, gata = null) => {
    await tab(eticheta)
    await asteaptaIncarcare().catch(async (e) => { const a = await alerte(); if (!a.length) throw e })
    // gata = text care apare doar după încărcare (ecranele fără „Se încarcă…”, ex. Tronsoane)
    if (gata) await page.getByText(gata).first().waitFor({ timeout: 60_000 }).catch(async () => { if (!(await alerte()).length) throw new Error(`ecran neîncărcat după 60 s: „${gata}” nu apare, fără mesaj de eroare`) })
    const a = await alerte()
    if (a.length) throw new Error(`eroare afișată: „${a.map(x => x.slice(0, lot1 ? 120 : 200)).join(' / ')}”`)
  }
  const toasturi = async () => page.evaluate(() => (window.__toasturi || []).splice(0)).catch(() => [])
  const selectorProiect = () => page.locator('select:has(option:has-text("TEST-RAZVAN")), select:has(option:has-text("LOT1-PRUNISOR-JUPA"))').first()
  const proiectSelectat = async () => {
    const s = selectorProiect()
    if (!(await s.count())) return null
    return s.evaluate(el => ({ value: el.value, text: el.options[el.selectedIndex]?.textContent || '' }))
  }
  const asiguraTest = async () => {
    const sel = await proiectSelectat()
    if (stare.mod !== 'scriere' || !esteProiectTest(sel)) throw new Oprire(`proiectul selectat nu e TEST-RAZVAN (văzut: „${sel?.text?.slice(0, 40) || 'nimic'}”) — scriere refuzată`)
  }
  const tab = async (eticheta) => { await page.getByRole('button', { name: eticheta, exact: true }).click(); await linisteste() }
  const modal = () => page.locator('[data-modal-fundal]').last()
  const camp = (radacina, eticheta) => radacina.locator(`xpath=.//label[normalize-space(.)="${eticheta}"]/following-sibling::*[1]`).first()
  const captura = async (nume, lot1) => {
    const fis = `${String(stare.pas).padStart(2, '0')}_${nume.replace(/[^\w\-]+/g, '_').slice(0, 50)}.png`
    try {
      if (lot1) {
        // doar bara de titlu + taburi: deasupra conținutului (fără nume / adrese / telefoane)
        const bara = page.getByRole('button', { name: '⚙️ Setări proiect', exact: true })
        const bb = await bara.boundingBox()
        if (!bb) return null
        await page.screenshot({ path: path.join(out, fis), clip: { x: 0, y: 0, width: 1600, height: Math.min(1000, Math.ceil(bb.y + bb.height + 6)) } })
      } else await page.screenshot({ path: path.join(out, fis) })
      return fis
    } catch { return null }
  }

  // un pas: rulează fn, adună erorile apărute între timp, face captura. fn întoarce textul „ce s-a văzut” (sau {sarit:'motiv'}).
  async function pas(nume, fn, { lot1 = false, dialoguri = [], faraCaptura = false } = {}) {
    if (oprire) return null
    stare.pas++; stare.dialoguri = dialoguri; stare.ultimDialog = null
    const c0 = stare.consola.length, h0 = stare.http.length, d0 = stare.descarcari.length
    await toasturi()
    const p = { nr: stare.pas, nume, proiect: lot1 ? 'LOT1' : stare.proiect, rezultat: 'OK', vazut: '', consola: [], http: [], captura: null }
    try {
      const r = await fn()
      if (r && typeof r === 'object' && r.sarit) { p.rezultat = 'SĂRIT'; p.vazut = r.sarit }
      else p.vazut = String(r ?? '')
    } catch (e) {
      p.rezultat = 'EȘUAT'; p.vazut = String(e.message || e).split('\n')[0].slice(0, 300)
      if (e instanceof Oprire) oprire = e.message
    }
    await page.waitForTimeout(400)
    const ts = await toasturi()
    if (ts.length && !lot1) p.vazut += ` · toast: ${ts.map(t => t.slice(0, 160)).join(' / ')}`
    else if (ts.length) p.vazut += ` · ${ts.length} toast(uri)`
    if (stare.ultimDialog) p.vazut += ` · dialog ${stare.ultimDialog.acceptat ? 'acceptat' : 'refuzat'}: „${stare.ultimDialog.mesaj}”`
    const desc = stare.descarcari.slice(d0)
    if (desc.length) p.vazut += ` · descărcat: ${desc.join(', ')}`
    p.consola = stare.consola.slice(c0); p.http = stare.http.slice(h0)
    if (!faraCaptura) p.captura = await captura(nume, lot1)
    pasi.push(p)
    console.log(`${p.rezultat.padEnd(6)} ${String(p.nr).padStart(2)}. ${nume}${p.consola.length || p.http.length ? ` (consolă ${p.consola.length}, http ${p.http.length})` : ''}`)
    return p
  }

  // Dashboard: așteaptă să dispară „Se încarcă...” (până la 45 s), apoi raportează tabelul sau mesajul de eroare (p[role=alert])
  const dashboard = async () => {
    await tab('📊 Dashboard')
    await page.getByText('Se încarcă...', { exact: true }).waitFor({ state: 'detached', timeout: 45_000 }).catch(() => {})
    const alerta = page.locator('p[role="alert"]').first()
    if (await alerta.count()) throw new Error(`dashboard cu eroare: „${((await alerta.textContent()) || '').slice(0, 200)}”`)
    if (await page.getByText('Se încarcă...', { exact: true }).count()) throw new Error('dashboard încă „Se încarcă...” după 45 s')
    const nUat = await page.locator('h3', { hasText: 'Centralizator pe UAT' }).locator('xpath=following::table[1]//tbody/tr').count()
    return `centralizator pe UAT: ${nUat} rânduri (incl. TOTAL)`
  }
  const textRegistru = async () => (await page.locator('text=/\\d+ rânduri · pagina/').first().textContent({ timeout: 15_000 }).catch(() => '')).trim()
  const cauta = async (t) => {
    await page.getByPlaceholder('Caută id parcelă / nume…').fill(t)
    await page.getByRole('button', { name: 'Caută', exact: true }).click(); await linisteste(900)
  }
  const randDet = (nume) => page.locator('tbody tr', { hasText: nume }).first()
  const deschideFisa = async (nume) => {
    await tab('📋 Registru'); await cauta(PREFIX_PROBA)
    const r = randDet(nume)
    if (!(await r.count())) throw new Error(`rândul „${nume}” nu apare în Registru`)
    await r.locator('td').nth(1).click(); await linisteste()
    await page.getByRole('button', { name: '‹ Registru' }).waitFor()
  }
  const blocDet = (nume) => page.locator('div', { has: page.locator('b', { hasText: nume }) }).filter({ has: page.getByRole('button', { name: '✎', exact: true }) }).last()
  const inchideModal = async () => {
    if (!(await page.locator('[data-modal-fundal]').count())) return
    stare.dialoguri = [...stare.dialoguri, /modificări nesalvate/]
    await modal().getByTitle('Închide').first().click().catch(() => {})
    await page.waitForTimeout(400)
  }

  let uatProba = null
  try {
    // ── 1. login ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await pas('Login (contul Claude)', async () => {
      await page.goto(BAZA + '/login', { waitUntil: 'domcontentloaded' })
      await page.locator('input[type="email"]').fill(EMAIL)
      await page.locator('input[type="password"]').fill(primaLinie(F_PAROLA))
      await page.getByRole('button', { name: /Conectare/ }).click()
      await page.waitForURL(u => !String(u).includes('/login'), { timeout: 30_000 })
      await page.locator('input[type="password"]').fill('').catch(() => {})
      return `autentificat, URL ${new URL(page.url()).pathname}`
    }, { faraCaptura: true })
    if (pasi[0]?.rezultat !== 'OK') throw new Oprire('login eșuat')

    await pas('Deschide Redări + selectează TEST-RAZVAN', async () => {
      await page.goto(BAZA + `/redari?proiect=${TEST.id}`, { waitUntil: 'domcontentloaded' })
      await page.getByText('🌾 Redări teren').first().waitFor({ timeout: 30_000 })
      await selectorProiect().waitFor({ timeout: 30_000 })
      await selectorProiect().selectOption(TEST.id); await linisteste()
      const sel = await proiectSelectat()
      if (!esteProiectTest(sel)) throw new Oprire(`TEST-RAZVAN nu se poate selecta (văzut „${sel?.text || '-'}”)`)
      stare.proiect = 'TEST'
      const nivel = (await page.locator('span', { hasText: /^(admin|editor|viewer)$/ }).first().textContent().catch(() => '')) || '?'
      const nrProiecte = await selectorProiect().locator('option').count()
      return `proiect „${sel.text.trim()}”, nivel ${nivel}, ${nrProiecte} proiecte în selector`
    })

    // ── 2. ecrane de citire pe TEST ──────────────────────────────────────────────────────────────────────────────────────────
    await pas('Dashboard (TEST)', dashboard)
    await pas('Centralizator xlsx (TEST, descărcare)', async () => {
      const b = page.getByRole('button', { name: /Centralizator \(xlsx\)/ })
      if (!(await b.count())) return { sarit: 'butonul Centralizator nu apare în Dashboard' }
      const d = page.waitForEvent('download', { timeout: 90_000 }).catch(() => null)
      await b.click()
      // gata = descărcare SAU mesajul exportului (p[role=status], altul decât „Se pregătește…”)
      const mesaj = page.locator('p[role="status"]').filter({ hasNotText: 'Se pregătește' }).first()
      const cine = await Promise.race([d.then(x => x && 'descarcare'), mesaj.waitFor({ timeout: 90_000 }).then(() => 'mesaj').catch(() => null)])
      await page.waitForTimeout(800)
      const text = (await mesaj.textContent().catch(() => '')) || ''
      if (cine !== 'descarcare' && !/rânduri exportate/.test(text)) throw new Error(`fără descărcare; mesaj: „${text || '-'}”`)
      return `centralizator: ${text || 'descărcat'}`
    })
    await pas('UAT-uri — listă (TEST)', async () => {
      await tab('🏛️ UAT-uri')
      await page.waitForTimeout(1500)
      const randuri = await page.locator('table').last().locator('tbody tr').evaluateAll(trs => trs.map(tr => {
        const td = tr.querySelectorAll('td')
        return { nume: td[0]?.querySelector('b')?.textContent || '', judet: td[0]?.querySelector('div')?.textContent || '', uat3: td[1]?.textContent || '', parcele: td[6]?.textContent || '', gata: td[8]?.textContent || '' }
      }))
      if (!randuri.length) throw new Error('niciun UAT în proiectul TEST')
      uatProba = randuri.find(r => /✓ da/.test(r.gata)) || randuri[0]
      return `${randuri.length} UAT-uri: ${randuri.map(r => `${r.uat3} (${r.parcele} parc., ${/✓ da/.test(r.gata) ? 'gata' : 'negata'})`).join(', ')} · UAT ales pentru probă: ${uatProba.uat3}${/✓ da/.test(uatProba.gata) ? '' : ` — negata: ${uatProba.gata.slice(0, 160)}`}`
    })
    await pas('Tronsoane / PV C (TEST)', async () => { await ecran('🛤️ Tronsoane / PV C', false, /Parcele fără tronson: \d+/); return (await page.locator('body').innerText()).match(/Parcele fără tronson: \d+/)?.[0] || 'ecran încărcat' })
    await pas('Sesiune (TEST)', async () => { await ecran('🗓️ Sesiune'); return 'ecran încărcat' })
    await pas('Registru — listă (TEST)', async () => { await ecran('📋 Registru'); return await textRegistru() || 'fără text de paginare' })

    // ── 3. scrieri pe TEST ───────────────────────────────────────────────────────────────────────────────────────────────────
    const scrie = !opt.doarCitire
    const sariScriere = { sarit: '--doar-citire' }

    await pas('Import TGZ — fișier de probă (3 parcele fictive) + previzualizare', async () => {
      if (!scrie) return sariScriere
      if (!uatProba) throw new Error('fără UAT de probă')
      await tab('📥 Import TGZ'); await asiguraTest()
      const fis = path.join(out, `proba_tgz_${data}.xlsx`)
      writeFileSync(fis, fisierProba({ uat: uatProba.nume, judet: uatProba.judet }))
      await page.locator('input[type="file"]').first().setInputFiles(fis)
      await page.getByPlaceholder('ex. TGZ 13.07.2026').fill(`E2E ${data}`)
      await page.getByRole('button', { name: /Previzualizează/ }).click(); await linisteste()
      const stat = await page.locator('text=3. Previzualizare').locator('xpath=..').innerText({ timeout: 15_000 })
      const n = (et) => stat.match(new RegExp(et + '\\s*\\n\\s*([\\d.-]+)'))?.[1] ?? '?'
      return `previzualizare: rânduri ${n('Rânduri citite')}, parcele ${n('Parcele de importat')}, deținători ${n('Deținători de importat')}, contacte ${n('Contacte de importat')}, erori ${n('Erori')}`
    })
    await pas('Import TGZ — scriere (TEST)', async () => {
      if (!scrie) return sariScriere
      await asiguraTest()
      const b = page.getByRole('button', { name: /📥 Importă \d+ parcele/ })
      if (!(await b.count())) throw new Error('butonul de import lipsește (previzualizarea a eșuat?)')
      if (await b.isDisabled()) throw new Error(`butonul de import e dezactivat: „${await b.textContent()}”`)
      await b.click()
      await page.locator('text=/4\\. (Raport import|Import eșuat)/').first().waitFor({ timeout: 120_000 })
      const t = await page.locator('text=/4\\. (Raport import|Import eșuat)/').first().locator('xpath=..').innerText()
      if (/Import eșuat/.test(t)) throw new Error('import eșuat: ' + t.replace(/\s+/g, ' ').slice(0, 250))
      return t.replace(/\s+/g, ' ').slice(0, 260)
    }, { dialoguri: [/^Import \d+ parcele, \d+ deținători și \d+ contacte în TEST-RAZVAN/] })
    await pas('Registru — caută parcelele de probă', async () => {
      await tab('📋 Registru'); await cauta(PREFIX_PROBA)
      const n = await page.locator('tbody tr', { hasText: PREFIX_PROBA }).count()
      if (scrie && n < 4) throw new Error(`după import se așteptau 4 rânduri ${PREFIX_PROBA}, apar ${n}`)
      return `${n} rânduri ${PREFIX_PROBA} · ${await textRegistru()}`
    })
    await pas('Fișa parcelei — deținători + contact', async () => {
      if (!(await page.locator('tbody tr', { hasText: PREFIX_PROBA }).count())) return { sarit: 'nicio parcelă de probă' }
      await deschideFisa(`${PREFIX_PROBA} PRIMUL`)
      const titlu = (await page.locator('div', { hasText: /^[A-Z]{3}-\d{4}$/ }).first().textContent().catch(() => '')) || '?'
      const det = (await page.locator('text=/^Deținători \\(\\d+\\)$/').first().textContent().catch(() => '')) || '?'
      const contact = await blocDet(`${PREFIX_PROBA} PRIMUL`).locator('xpath=..').innerText().catch(() => '')
      return `fișa ${titlu.trim()} · ${det} · contact: ${contact.split('\n').find(x => /Fictivă|fără date|necunoscută/.test(x)) || '-'}`
    })
    await pas('Deținător — editare contact (cod poștal fictiv) + salvare', async () => {
      if (!scrie) return sariScriere
      await asiguraTest()
      await blocDet(`${PREFIX_PROBA} PRIMUL`).getByRole('button', { name: '✎', exact: true }).click()
      const m = modal(); await m.waitFor()
      await camp(m, 'Cod poștal').fill('999001')
      await asiguraTest()
      await m.getByRole('button', { name: 'Salvează', exact: true }).click(); await linisteste()
      if (await page.locator('[data-modal-fundal]').count()) { await inchideModal(); throw new Error('fereastra deținătorului a rămas deschisă după Salvează') }
      const contact = await blocDet(`${PREFIX_PROBA} PRIMUL`).locator('xpath=..').innerText().catch(() => '')
      if (!/999001/.test(contact)) throw new Error('codul poștal salvat nu apare în fișă')
      return 'contact salvat, cod poștal 999001 afișat în fișă'
    })
    await pas('Convocator individual (poștă) — generare DOCX fără trimitere', async () => {
      if (!scrie) return sariScriere
      await tab('📋 Registru'); await cauta(PREFIX_PROBA); await asiguraTest()
      const r = randDet(`${PREFIX_PROBA} PRIMUL`)
      const b = r.getByRole('button', { name: /Convocator/ })
      if (await b.isDisabled()) return { sarit: `butonul Convocator e blocat: ${(await b.getAttribute('title')) || '-'}` }
      await b.click()
      const m = modal(); await m.waitFor()
      await page.waitForTimeout(1500)   // citirea convocatoarelor existente
      const dinNou = m.getByRole('button', { name: /Descarcă din nou/ })
      if (await dinNou.count()) {
        const d = page.waitForEvent('download', { timeout: 30_000 }); await dinNou.first().click(); await d
        await inchideModal(); return 'există deja un convocator neexpediat (rulare anterioară) — redescărcat din arhivă, fără număr nou'
      }
      const canal = m.locator('select').first()
      if (await canal.count()) await canal.selectOption('posta')
      const g = m.getByRole('button', { name: 'Generează și descarcă', exact: true })
      if (await g.isDisabled()) { const tl = await g.getAttribute('title'); const txt = (await m.innerText()).replace(/\s+/g, ' ').slice(0, 300); await inchideModal(); return { sarit: `generare blocată: ${tl || txt}` } }
      await asiguraTest()
      const d = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null)
      await g.click(); const dl = await d; await linisteste()
      const lips = await page.locator('text=Lipsesc date').count()
      if (!dl) { const txt = (await m.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300); await inchideModal(); throw new Error(`fără descărcare${lips ? ' (lipsesc date)' : ''}: ${txt}`) }
      return `convocator generat: ${dl.suggestedFilename()}`
    })
    await pas('Convocatoare în masă — Verifică (+ generare limitată la 3)', async () => {
      if (!scrie) return sariScriere
      await tab('🏛️ UAT-uri'); await asiguraTest()
      const selUat = page.locator('select:has(option:has-text("— alege —"))').first()
      const opt = await selUat.locator('option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent })))
      const ales = opt.find(o => uatProba && o.t.includes(`(${uatProba.uat3.trim()})`)) || opt.find(o => o.v)
      if (!ales) return { sarit: 'niciun UAT în selector' }
      await selUat.selectOption(ales.v)
      await page.locator('input[type="number"]').first().fill('3')
      await page.getByRole('button', { name: 'Verifică', exact: true }).click(); await linisteste(1500)
      const txt = (await page.locator('body').innerText()).match(/(⛔ Lotul nu se poate genera[^\n]*|⚠ Convocatoare noi \/ regenerate blocate[^\n]*|În lotul ăsta:[^\n]*)/)?.[0] || '(fără rezultat de verificare)'
      const g = page.getByRole('button', { name: /Generează convocatoarele UAT-ului/ })
      if (await g.isDisabled()) return `verificare ${ales.t}: ${txt.slice(0, 260)} · generarea nu e disponibilă`
      await asiguraTest()
      await g.click()
      await page.locator('text=/✅ \\d+ noi/').first().waitFor({ timeout: 180_000 }).catch(() => {})
      await linisteste(1500)
      const rez = (await page.locator('body').innerText()).match(/✅[^\n]*/)?.[0] || '(fără rezultat)'
      return `verificare ${ales.t}: ${txt.slice(0, 160)} · generare: ${rez.slice(0, 200)}`
    }, { dialoguri: [/^Generez \d+ convocatoare pentru UAT /] })
    await pas('Poștă — plicuri propuse / creare plicuri (fără expediere)', async () => {
      await tab('✉️ Poștă'); await page.waitForTimeout(1500)
      const corp = await page.locator('body').innerText()
      const propuse = corp.match(/(\d+) plicuri propuse/)?.[1]
      const b = page.getByRole('button', { name: /^Creează \d+ plicuri$/ })
      if (!scrie || !(await b.count()) || await b.isDisabled()) return `${propuse ?? '?'} plicuri propuse · ${corp.match(/Fără adresă \(afișare\): \d+/)?.[0] || ''}${!scrie ? ' · (doar citire)' : ''}`
      await asiguraTest()
      await b.click(); await linisteste(2500)
      const msg = (await page.locator('[role="status"]').allInnerTexts()).join(' ').slice(0, 260)
      if (/erori: [1-9]/.test(msg)) throw new Error('creare plicuri: ' + msg)
      return `${propuse} plicuri propuse → ${msg || 'fără mesaj'}`
    }, { dialoguri: [/^Creează \d+ plicuri în TEST-RAZVAN\?$/] })
    await pas('PV A — creare + completare + salvare + generare DOCX', async () => {
      if (!scrie) return sariScriere
      await deschideFisa(`${PREFIX_PROBA} PRIMUL`); await asiguraTest()
      await blocDet(`${PREFIX_PROBA} PRIMUL`).getByRole('button', { name: 'PV A', exact: true }).click()
      const m = modal(); await m.waitFor(); await page.waitForTimeout(1500)
      const creeaza = m.getByRole('button', { name: 'Creează PV A', exact: true })
      if (await creeaza.count()) { await asiguraTest(); await creeaza.click(); await linisteste(1500) }
      const titlu = (await m.locator('div').first().innerText().catch(() => '')).split('\n')[0]
      if (await m.locator('fieldset').first().isDisabled().catch(() => false)) { await inchideModal(); return { sarit: `PV ${titlu} e final (semnat / anulat) — nu se mai completează` } }
      await camp(m, 'Locul încheierii').fill(`Primăria ${uatProba?.nume || 'TEST'} (probă E2E)`)
      await camp(m, 'Constatarea s-a făcut').selectOption('sediu')
      await camp(m, 'Identitatea deținătorului verificată').selectOption('true')
      await camp(m, 'Plan de situație anexat').selectOption('false')
      await camp(m, 'Obiecții privind readucerea terenului').selectOption('false')
      for (const et of ['Nivelare', 'Nivelat', 'Strat vegetal refăcut']) { const c = m.getByLabel(et, { exact: true }); if (await c.count()) await c.first().check() }
      const salv = m.getByRole('button', { name: 'Salvează PV', exact: true })
      if (await salv.isEnabled()) { await asiguraTest(); await salv.click(); await linisteste(1200) }
      const gen = m.getByRole('button', { name: /^(Generează DOCX|Regenerează)$/ })
      if (await gen.isDisabled()) { const t = (await m.innerText()).replace(/\s+/g, ' ').slice(0, 250); await inchideModal(); throw new Error(`generarea PV e dezactivată: ${t}`) }
      await asiguraTest()
      const d = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null)
      await gen.click(); const dl = await d; await linisteste(1200)
      const alerta = (await m.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' ')
      await inchideModal()
      if (!dl) throw new Error(`PV fără descărcare${alerta ? ': ' + alerta.slice(0, 250) : ''}`)
      return `PV ${titlu} generat: ${dl.suggestedFilename()} (aplicația generează DOCX, nu PDF)`
    }, { dialoguri: [/^Datele s-au schimbat\. Generez cu datele actuale/] })
    await pas('Corespondență — vizualizare (TEST)', async () => {
      await ecran('📨 Corespondență')
      const n = await page.locator('tbody tr').count()
      return `${n} rânduri în tabel`
    })
    await pas('Notificări — vizualizare (TEST)', async () => { await ecran('📬 Notificări'); return 'ecran încărcat' })
    await pas('Setări proiect — vizualizare (TEST, fără nicio modificare)', async () => { await ecran('⚙️ Setări proiect'); return 'ecran încărcat (niciun comutator atins)' })

    // ── 4. LOT1: doar citire ─────────────────────────────────────────────────────────────────────────────────────────────────
    if (!opt.faraLot1) {
      await pas('LOT1 — selectare (garda trece în „doar citire”)', async () => {
        stare.mod = 'citire'; stare.proiect = 'LOT1'
        await tab('📊 Dashboard')   // tab fără formulare deschise înainte de schimbare
        const s = selectorProiect()
        const v = await s.locator('option', { hasText: LOT1.cod }).first().getAttribute('value')
        if (!v) throw new Error('LOT1 nu apare în selector')
        await s.selectOption(v); await linisteste(1500)
        if (!esteProiectLot1(await proiectSelectat())) throw new Error('selectorul nu arată LOT1')
        return 'LOT1 selectat (mod citire: scrierile și descărcările sunt blocate)'
      }, { lot1: true })
      const ecrane = [['📊 Dashboard', 'Dashboard'], ['🗓️ Sesiune', 'Sesiune'], ['📋 Registru', 'Registru'], ['🛤️ Tronsoane / PV C', 'Tronsoane'], ['📥 Import TGZ', 'Import TGZ (fără fișier)'],
        ['✉️ Poștă', 'Poștă'], ['📨 Corespondență', 'Corespondență'], ['📬 Notificări', 'Notificări'], ['🏛️ UAT-uri', 'UAT-uri'], ['⚙️ Setări proiect', 'Setări proiect']]
      for (const [et, nume] of ecrane) {
        await pas(`LOT1 — ${nume}`, async () => {
          if (!esteProiectLot1(await proiectSelectat())) throw new Oprire('proiectul s-a schimbat în timpul citirii LOT1')
          if (nume === 'Dashboard') return dashboard()
          await ecran(et, true, nume === 'Tronsoane' ? /Parcele fără tronson: \d+/ : null)
          const corp = await page.locator('body').innerText()
          if (nume === 'Registru') return await textRegistru() || 'fără text de paginare'
          if (nume === 'UAT-uri') return corp.match(/\d+ UAT-uri\./)?.[0] || '?'
          if (nume === 'Tronsoane') return corp.match(/Parcele fără tronson: \d+/)?.[0] || 'ecran încărcat'
          return 'ecran încărcat'
        }, { lot1: true })
      }
    }
  } catch (e) {
    if (!oprire) oprire = String(e.message || e)
  } finally {
    await browser.close().catch(() => {})
  }

  const sec = Math.round((Date.now() - t0) / 1000)
  const meta = { data, baza: BAZA, email: EMAIL, browser: 'Edge (msedge, Playwright 1.63)', doarCitire: opt.doarCitire, faraLot1: opt.faraLot1, durata: `${Math.floor(sec / 60)}m${sec % 60}s`, blocate: stare.blocate, zgomotHead: stare.zgomotHead || 0, asteptate: stare.asteptate }
  writeFileSync(path.join(out, 'RAPORT.md'), raportMd({ pasi, meta, oprire }))
  writeFileSync(path.join(out, 'rezultat.json'), JSON.stringify({ meta, oprire, pasi }, null, 2))
  const esec = pasi.filter(p => p.rezultat === 'EȘUAT').length
  console.log(`${oprire ? `OPRIT: ${oprire}\n` : ''}${pasi.filter(p => p.rezultat === 'OK').length} OK · ${esec} eșuați · ${pasi.filter(p => p.rezultat === 'SĂRIT').length} săriți → ${path.join(out, 'RAPORT.md')}`)
  return oprire || esec ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let a
  try { a = citesteArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); console.error('Vezi antetul fișierului pentru utilizare.'); process.exit(e instanceof EroareUtilizare ? 2 : 1) }
  ruleaza(a).then(c => process.exit(c), e => { console.error(`✗ ${e.message}`); process.exit(1) })
}
