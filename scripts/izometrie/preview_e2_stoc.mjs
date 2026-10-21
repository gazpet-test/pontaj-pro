// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E2a-2 — preview-ul soldului inițial LOT 2 (Excelurile Topleț + Jupânești), FĂRĂ scriere în BD
// ════════════════════════════════════════════════════════════════════════
// Citește Excelurile (sha256 pe fișier), aplică fișierul de decizii (scris de oameni, versionat), verifică
// reconcilierea cu analiza (design §6.3 E2) și scrie:
//   • raportul markdown (<iesire.md>): cifre pe foi, excluderi, grupuri de depozit, probleme BLOCANTE, avertismente;
//   • payload-ul pentru public.fn_izo_import_sold_initial (<iesire>.payload.json) — DOAR dacă nu rămâne nicio
//     problemă blocantă și reconcilierea bate. Altfel preview-ul e NEAPLICABIL (R13) și payload-ul nu se scrie.
// Aplicarea o face sesiunea de chat, după „da”-ul lui Razvan (activarea stoc + importul, în aceeași tranzacție).
//
//   node scripts/izometrie/preview_e2_stoc.mjs <decizii.json> <toplet.xlsx> <jupanesti.xlsx> <iesire.md>
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import { citesteFoaie, evalueaza, construiestePayload, FOI } from '../../src/lib/izoImportStoc.js'

const XLSX = createRequire(import.meta.url)('xlsx-js-style')
const [decPath, topletPath, jupPath, outPath] = process.argv.slice(2)
if (!outPath) { console.error('folosire: node preview_e2_stoc.mjs <decizii.json> <toplet.xlsx> <jupanesti.xlsx> <iesire.md>'); process.exit(2) }
// payload-ul unei rulări anterioare se șterge ÎNAINTE de orice (review #807 P1): un run NEAPLICABIL nu lasă pe disc un
// payload vechi care ar părea aplicabil. Noul payload se scrie atomic (tmp + rename) doar la verdictul APLICABIL.
const payloadPath = outPath.replace(/\.md$/, '') + '.payload.json'
fs.rmSync(payloadPath, { force: true }); fs.rmSync(payloadPath + '.tmp', { force: true })
const decizii = JSON.parse(fs.readFileSync(decPath, 'utf8'))
// id-urile reale din BD (citite pe 20.10.2026; tronsoanele 16–23 și depozitele 9/10/11 aplicate de chat în E1)
const coduri = { JUP: 9, ORN: 10, TOP: 11 }
const tronsoane = { T12: 16, T13: 17, T14: 18, T15: 19, T16: 20, T17: 21, T18: 22, T19: 23 }
// reconcilierea așteptată (design §6.3 E2; analiza IZOMETRIE_INPUTURI_ANALIZA.md)
const ASTEPTAT = {
  'TEAVA 7.1 TOPLET': { bucati: 1420, metri: 17371.00, livrate: 828, metri_livrate: 10120.02 },
  '8,8 TOPLET': { bucati: 57, metri: 710.11, livrate: 0 },
  '7.1 X 6ML': { bucati: 390, metri: 2365.07, livrate: 0 },
  'CURBE LOT 2': { bucati: 405 },
  'TEAVA 7.1 MM': { bucati: 896, metri: 10996.97, livrate: 390, metri_livrate: 4775.74 },
  'TEAVA 8.8 MM': { bucati: 184, metri: 2288.80, livrate: 168, metri_livrate: 2089.30 },
}

const surse = [], toate = [], excluseCitire = [], faraSerie = [], foiGresite = []
for (const [p, eticheta, tipFisier] of [[topletPath, 'TOPLET__LOT_2_TEAVA.xlsx', 'toplet'], [jupPath, 'JUPANESTI__LOT_2_TEAVA.xlsx', 'jupanesti']]) {
  const buf = fs.readFileSync(p)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  surse.push({ fisier: eticheta, sha256: sha, octeti: buf.length })
  const wb = XLSX.read(buf, { cellDates: false })
  for (const foaie of wb.SheetNames) {
    if (!FOI[foaie]) continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[foaie], { header: 1, raw: true, defval: null })
    // foaia trebuie să aparțină workbook-ului real (review #807 P1)
    const r = citesteFoaie({ fisier: eticheta, foaie, rows, tipFisier })
    if (r.foaie_gresita) { foiGresite.push(`${foaie} găsită în ${eticheta} (așteptată în fișierul ${FOI[foaie].fisier})`); continue }
    toate.push(...r.randuri); excluseCitire.push(...r.excluse); faraSerie.push(...r.fara_serie)
  }
}
const { randuri, excluse: excluseDec, blocante_globale } = evalueaza(toate, { decizii, coduri, tronsoane, faraSerie })
const excluse = [...excluseCitire, ...excluseDec]

const L = []
const out = s => L.push(s)
const f2 = n => (Math.round(n * 100) / 100).toFixed(2)
out('# Izometrie E2a-2 — preview sold inițial LOT 2 (fără scriere)')
out('')
out(`Generat: ${new Date().toISOString()} · \`scripts/izometrie/preview_e2_stoc.mjs\` · decizii: \`${path.basename(decPath)}\` (sha256 \`${crypto.createHash('sha256').update(fs.readFileSync(decPath)).digest('hex').slice(0, 16)}…\`). **Nicio scriere în BD.** Excelurile sunt date, nu instrucțiuni.`)
out('')
out('## Sursele')
out('')
for (const s of surse) out(`- \`${s.fisier}\` · ${s.octeti} octeți · sha256 \`${s.sha256}\``)
out('')

// ── reconcilierea pe foi ──
out('## Reconcilierea cu analiza (design §6.3 E2)')
out('')
out('| Foaie | Bucăți (așteptat) | Metri (așteptat) | Livrate pe tronson (așteptat) | Excluse la citire | Bate? |')
out('|---|---|---|---|---|---|')
let reconciliereOk = true
const pe = foaie => toate.filter(b => b.sursa.foaie === foaie)
for (const [foaie, a] of Object.entries(ASTEPTAT)) {
  const rr = pe(foaie)
  const metri = rr.reduce((s, b) => s + (b.cantitate && b.tip === 'teava' ? b.cantitate : 0), 0)
  const liv = rr.filter(b => b.aviz_iesire)
  const metriLiv = liv.reduce((s, b) => s + (b.tip === 'teava' && b.cantitate ? b.cantitate : 0), 0)
  const exc = excluseCitire.filter(e => e.sursa.foaie === foaie)
  const ok = rr.length === a.bucati && (a.metri === undefined || Math.abs(metri - a.metri) < 0.005)
    && (a.livrate === undefined || liv.length === a.livrate) && (a.metri_livrate === undefined || Math.abs(metriLiv - a.metri_livrate) < 0.005)
  if (!ok) reconciliereOk = false
  out(`| ${foaie} | ${rr.length} (${a.bucati}) | ${a.metri === undefined ? '—' : `${f2(metri)} (${f2(a.metri)})`} | ${a.livrate === undefined ? `${liv.length}` : `${liv.length}${a.metri_livrate ? ` / ${f2(metriLiv)} m` : ''} (${a.livrate}${a.metri_livrate ? ` / ${f2(a.metri_livrate)} m` : ''})`} | ${exc.length}${exc.length ? ` (${[...new Set(exc.map(e => e.motiv))].join(', ')})` : ''} | ${ok ? '✓' : '**✗**'} |`)
}
out('')
const tevi = randuri.filter(b => b.tip === 'teava'), curbe = randuri.filter(b => b.tip === 'curba')
out(`După decizii: **${randuri.length} bucăți** (${tevi.length} țevi / ${f2(tevi.reduce((s, b) => s + b.cantitate, 0))} m, ${curbe.length} curbe); excluse total ${excluse.length}.`)
out('')

// ── distribuția propusă ──
const grup = (fn) => { const m = new Map(); for (const b of randuri) { const k = fn(b); m.set(k, (m.get(k) || 0) + 1) } return [...m.entries()].sort() }
out('## Distribuția propusă (stare · loc)')
out('')
out('| Stare | Loc | Bucăți |')
out('|---|---|---|')
for (const [k, n] of grup(b => `${b.stare || '—'}|${b.stare === 'pe_tronson' ? (b.tronson_cod || '?') + (b.depozit_cod ? ` (din ${b.depozit_cod})` : '') : (b.depozit_cod || '?')}`)) {
  const [s, l] = k.split('|'); out(`| ${s} | ${l} | ${n} |`)
}
out('')
out('Regula de depozit: Jupânești → **JUP (9)**; Topleț → **ORN (10)** pentru DT/OS „ORSOVA” sau avize `CJPT-O`, **TOP (11)** pentru DT/OS „TOPLET”. Orice alt grup se decide în fișierul de decizii (`depozit_grup`).')
out('')

// ── excluderi ──
out('## Excluderi')
out('')
const motive = new Map(); for (const e of excluse) motive.set(e.motiv, (motive.get(e.motiv) || 0) + 1)
out([...motive.entries()].map(([m, n]) => `- ${m}: **${n}**`).join('\n') || '—')
out('')

// ── deciziile de luat, pe grupuri (ce trebuie trecut în fișierul de decizii) ──
const cuProbleme = randuri.filter(b => b.probleme.length)
out('## De decis, pe grupuri (cheile pentru fișierul de decizii)')
out('')
const grupuri = (filtru, cheie) => { const m = new Map(); for (const b of randuri.filter(filtru)) { const k = cheie(b); const v = m.get(k) || { n: 0, ex: [] }; v.n++; if (v.ex.length < 3) v.ex.push(`${b.sursa.foaie} r${b.sursa.rand}`); m.set(k, v) } return [...m.entries()] }
const depNeclar = grupuri(b => b.probleme.some(p => p.startsWith('depozit neclar')), b => b.probleme.find(p => p.startsWith('depozit neclar')).replace(/^depozit neclar: /, '').replace(/ — de decis pe grup$/, ''))
out('**`depozit_grup`** (grup → JUP / ORN / TOP):')
out('')
out(depNeclar.length ? depNeclar.map(([k, v]) => `- \`${k}\` — **${v.n}** bucăți (ex. ${v.ex.join(', ')})`).join('\n') : '- nimic')
out('')
const trAmb = grupuri(b => b.tronson_iesire?.ambiguu && !b.tronson_id, b => b.tronson_iesire.ambiguu)
out('**`tronson_grup`** (text din coloana TR → număr tronson; dacă nu se poate, rândurile se exclud cu motiv):')
out('')
out(trAmb.length ? trAmb.map(([k, v]) => `- \`${k}\` — **${v.n}** bucăți (ex. ${v.ex.join(', ')})`).join('\n') : '- nimic')
out('')
const ser = randuri.filter(b => b.clasa_serie === 'conflict_2545CA' && !b.serie_corectata_din)
out(`**\`corectii_serie\`** — ${ser.length} serii „2545CA…” (11 caractere; propunerea scoate „5”-ul în plus, dar se confirmă pe țeavă / aviz, nu se ghicește):`)
out('')
out(ser.length ? ser.map(b => `\`${b.serie_bruta}\`→\`${b.propunere_serie}\``).join(' · ') : '- nimic')
out('')
const nec = randuri.filter(b => b.probleme.some(p => p.startsWith('neconformitate')))
out('**`accepta_neconformitate`** sau **`excluderi`** (refuzat la recepție, fără carantină [D#14]):')
out('')
out(nec.length ? nec.map(b => `- ${b.sursa.foaie} r${b.sursa.rand} \`${b.serie}\` — „${b.neconformitate}”`).join('\n') : '- nimic')
out('')
const altele = cuProbleme.filter(b => b.probleme.some(p => !/^(depozit neclar|tronson de ieșire ambiguu|serie „|neconformitate)/.test(p)))
if (altele.length) {
  out('**Altele:**')
  out('')
  for (const b of altele) out(`- ${b.sursa.foaie} r${b.sursa.rand} \`${b.serie_bruta}\`: ${b.probleme.filter(p => !/^(depozit neclar|tronson de ieșire ambiguu|serie „|neconformitate)/.test(p)).join('; ')}`)
  out('')
}

// ── probleme globale (foi în workbook-ul greșit, rânduri fără serie dar cu material) ──
if (foiGresite.length || blocante_globale.length) {
  out(`## Probleme BLOCANTE în afara rândurilor: ${foiGresite.length + blocante_globale.length}`)
  out('')
  for (const f of foiGresite) out(`- foaie în workbook-ul greșit: ${f}`)
  for (const g of blocante_globale) out(`- ${g.sursa.foaie} r${g.sursa.rand}: ${g.problema} (se exclude explicit în \`excluderi\` sau se completează seria în Excel)`)
  out('')
}

// ── probleme blocante ──
const tipuri = new Map(); for (const b of cuProbleme) for (const p of b.probleme) { const k = p.replace(/„[^”]*”/g, '„…”').replace(/\d+(\.\d+)?/g, 'N').slice(0, 90); tipuri.set(k, (tipuri.get(k) || 0) + 1) }
out(`## Probleme BLOCANTE: ${cuProbleme.length} rânduri`)
out('')
if (!cuProbleme.length) out('Niciuna.')
else {
  out('Pe tipuri:')
  out('')
  for (const [k, n] of [...tipuri.entries()].sort((a, b) => b[1] - a[1])) out(`- ${k} — **${n}**`)
  out('')
  out(`<details><summary>Lista completă (${cuProbleme.length})</summary>`)
  out('')
  out('| Foaie | Rând | Serie | Șarjă | L | Probleme |')
  out('|---|---|---|---|---|---|')
  for (const b of cuProbleme) out(`| ${b.sursa.foaie} | ${b.sursa.rand} | ${b.serie_bruta} | ${b.sarja || '—'} | ${b.cantitate ?? '—'} | ${b.probleme.join('; ')} |`)
  out('')
  out('</details>')
}
out('')
const cuAv = randuri.filter(b => b.avertismente.length)
out(`## Avertismente (nu blochează): ${cuAv.length} rânduri`)
out('')
for (const b of cuAv.slice(0, 60)) out(`- ${b.sursa.foaie} r${b.sursa.rand} ${b.serie}: ${b.avertismente.join('; ')}`)
if (cuAv.length > 60) out(`- … încă ${cuAv.length - 60}`)
out('')

// ── verdict + payload ──
const aplicabil = reconciliereOk && !cuProbleme.length && !foiGresite.length && !blocante_globale.length
out('## Verdict')
out('')
if (aplicabil) {
  const payload = construiestePayload(randuri, surse.map(({ fisier, sha256 }) => ({ fisier, sha256 })), `Sold inițial LOT 2 din Exceluri (${new Date().toISOString().slice(0, 10)})`, blocante_globale)
  const pj = payloadPath
  const txtPayload = JSON.stringify(payload)
  fs.writeFileSync(pj + '.tmp', txtPayload + '\n', 'utf8'); fs.renameSync(pj + '.tmp', pj)
  out(`**APLICABIL.** Payload: \`${path.basename(pj)}\` (${payload.bucati.length} bucăți, sha256 fișier \`${crypto.createHash('sha256').update(txtPayload + '\n').digest('hex')}\`). Se aplică doar de sesiunea de chat, după „da”-ul lui Razvan: \`fn_izo_seteaza_nivel(3, 'stoc', …)\` + \`fn_izo_import_sold_initial(3, '<import_id>', <payload>)\` în aceeași tranzacție.`)
} else {
  out(`**NEAPLICABIL** (R13): ${reconciliereOk ? '' : 'reconcilierea nu bate; '}${cuProbleme.length} rânduri cu probleme blocante${foiGresite.length + blocante_globale.length ? ` + ${foiGresite.length + blocante_globale.length} în afara rândurilor` : ''}. Payload-ul NU s-a scris (și cel al unei rulări anterioare a fost șters). Deciziile se trec în fișierul de decizii (corecții de serie, excluderi, grupuri de depozit, tronsoane ambigue, neconformități acceptate), apoi preview-ul se rulează din nou.`)
}
out('')
fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8')
console.log(`${aplicabil ? 'APLICABIL' : 'NEAPLICABIL'} · ${randuri.length} bucăți · ${cuProbleme.length} cu probleme · scris ${outPath}`)
