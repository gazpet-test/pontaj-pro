#!/usr/bin/env node
// verifica_pack.mjs — validator FĂRĂ AI pentru Source Pack (gazpet.source_pack/v1) produs de agentul CLI.
// Folosire: node verifica_pack.mjs <pack.json> <dir text (/work/text)> <iesire.json>
//             [--licitatie-id N] [--nr-anunt X] [--data-dir /data] [--rulare '<json>']
// Ce face: (1) schema minimă; (2) fiecare excerpt se caută LITERAL în textul extras al fișierului (normalizat pe spații),
// întâi în pagina declarată, apoi în tot documentul; verdictul se scrie PER CERINȚĂ în locator.verificat ('pagina'|'document'),
// iar când pagina se corectează, locator.pagina_declarata păstrează ce a afirmat modelul și locator.pagina_validata pagina reală;
// (3) cerințele fără excerpt regăsit ies din "cerinte" și intră în "nereusite" (motiv) — nu se corectează, nu se parafrazează;
// (4) identitatea pack-ului (licitatie_id, nr_anunt) vine de la launcher (argumente), NU de la model; (5) pentru fiecare
// document din pack se scriu sha256 + size_bytes ale fișierului din /data (dovada „ce s-a citit”); (6) raport pe stdout.
// Marcajele de pagină acceptate: ⟦PAGINA n⟧ și ⟦PAGINA a-b⟧ (interval; textul aparține fiecărei pagini din interval).
// Conținutul pack-ului e extern (scris de model din documente scrise de autoritate): aici e doar verificat, nu executat.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const pos = [], opt = {}
for (let a = 2; a < process.argv.length; a++) {
  const x = process.argv[a]
  if (x.startsWith('--')) { opt[x.slice(2)] = process.argv[++a] } else pos.push(x)
}
const [packF, textDir, outF] = pos
if (!packF || !textDir || !outF) { console.error('folosire: verifica_pack.mjs <pack.json> <dir text> <iesire.json> [--licitatie-id N] [--nr-anunt X] [--data-dir D] [--rulare JSON]'); process.exit(2) }

let brut = fs.readFileSync(packF, 'utf8').trim()
// agentul răspunde uneori cu ```json … ``` sau cu o frază înainte/după: luăm primul { … ultimul }
const i = brut.indexOf('{'), j = brut.lastIndexOf('}')
if (i < 0 || j <= i) { console.log('INVALID: niciun obiect JSON în răspuns'); process.exit(4) }
let pack
try { pack = JSON.parse(brut.slice(i, j + 1)) } catch (e) { console.log('INVALID: JSON neparsabil: ' + String(e.message).slice(0, 120)); process.exit(4) }

const probleme = []
if (pack.schema !== 'gazpet.source_pack/v1') probleme.push('schema ≠ gazpet.source_pack/v1')
for (const k of ['documente', 'cerinte', 'nereusite']) if (!Array.isArray(pack[k])) { probleme.push(`lipsește lista "${k}"`); pack[k] = [] }
for (const k of ['solicitari', 'erate', 'participanti', 'observatii_siguranta', 'extensii_propuse']) if (!Array.isArray(pack[k])) pack[k] = []

// ── identitate: de la launcher (om/ERP), nu de la model. Ce a scris modelul rămâne ca nr_anunt_model pentru diagnoză.
const licArg = opt['licitatie-id'] != null && opt['licitatie-id'] !== '' ? Number(opt['licitatie-id']) : null
const nrArg = opt['nr-anunt'] || null
const licModel = pack.licitatie && typeof pack.licitatie === 'object' ? pack.licitatie : {}
pack.licitatie = { licitatie_id: Number.isInteger(licArg) ? licArg : null, nr_anunt: nrArg || (typeof licModel.nr_anunt === 'string' ? licModel.nr_anunt : null) }
if (typeof licModel.nr_anunt === 'string' && licModel.nr_anunt && nrArg && licModel.nr_anunt !== nrArg) pack.licitatie.nr_anunt_model = licModel.nr_anunt
if (!Number.isInteger(pack.licitatie.licitatie_id)) probleme.push('licitatie_id lipsă (launcher-ul nu a primit LIC_ID)')

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[„”"«»]/g, '"').replace(/[’‘]/g, "'").trim()
const cacheText = new Map()
function textFisier(rel) {
  if (cacheText.has(rel)) return cacheText.get(rel)
  const f = path.join(textDir, rel + '.txt')
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
  cacheText.set(rel, t); return t
}
// segmente [{de_la, pana_la, text}] după marcajele ⟦PAGINA n⟧ / ⟦PAGINA a-b⟧
export function segmente(t) {
  const out = []; const re = /⟦PAGINA (\d+)(?:\s*[-–]\s*(\d+))?⟧/g; let m, cur = null, lastIdx = 0
  while ((m = re.exec(t))) {
    if (cur) cur.text += t.slice(lastIdx, m.index)
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
    cur = { de_la: Math.min(a, b), pana_la: Math.max(a, b), text: '' }; out.push(cur); lastIdx = m.index + m[0].length
  }
  if (cur) cur.text += t.slice(lastIdx)
  return out
}
const textPagina = (seg, n) => seg.filter(s => n >= s.de_la && n <= s.pana_la).map(s => s.text).join('\n')
const cacheSeg = new Map()
export function verificaLocator(loc) {
  if (!loc || !loc.nume_fisier) return { ok: false, motiv: 'locator fără nume_fisier' }
  const t = textFisier(loc.nume_fisier)
  if (t === null) return { ok: false, motiv: `fișier fără text extras: ${loc.nume_fisier}` }
  const ex = norm(loc.excerpt)
  if (ex.length < 20) return { ok: false, motiv: 'excerpt lipsă sau sub 20 caractere' }
  if (!cacheSeg.has(loc.nume_fisier)) cacheSeg.set(loc.nume_fisier, segmente(t))
  const seg = cacheSeg.get(loc.nume_fisier)
  const inPag = Number.isInteger(loc.pagina) && norm(textPagina(seg, loc.pagina)).includes(ex)
  if (inPag) return { ok: true, nivel: 'pagina' }
  if (norm(t).includes(ex)) {
    const s = seg.find(s => norm(s.text).includes(ex))
    return { ok: true, nivel: 'document', pagina_reala: s ? s.de_la : null, interval: s && s.pana_la !== s.de_la ? [s.de_la, s.pana_la] : null }
  }
  return { ok: false, motiv: 'excerpt negăsit literal în text' }
}
// verdictul intră în locator (P0a: importul citește locator.verificat / pagina_declarata / pagina_validata)
function aplicaVerdict(loc, v) {
  loc.verificat = v.nivel
  if (v.nivel === 'document') {
    if (Number.isInteger(loc.pagina)) loc.pagina_declarata = loc.pagina
    if (v.pagina_reala) { loc.pagina_validata = v.pagina_reala; loc.pagina = v.pagina_reala }
    if (v.interval) loc.pagina_interval = v.interval
  } else loc.pagina_validata = loc.pagina
}

let okPag = 0, okDoc = 0, cazute = 0
const cerinteOk = []
for (const c of pack.cerinte) {
  delete c.verificat; delete c.pagina_declarata   // formatul vechi (top-level) nu mai există
  const v = verificaLocator(c.locator)
  if (v.ok) { aplicaVerdict(c.locator, v); v.nivel === 'pagina' ? okPag++ : okDoc++; cerinteOk.push(c) }
  else {
    cazute++
    pack.nereusite.push({ nume_fisier: c.locator?.nume_fisier || null, pagini: Number.isInteger(c.locator?.pagina) ? [c.locator.pagina] : null, motiv: `cerință ${c.ref || '?'} respinsă de validator: ${v.motiv}`, text_respins: String(c.text || '').slice(0, 300) })
  }
}
pack.cerinte = cerinteOk
// solicitări/erate: se marchează, nu se elimină (întrebarea autorității poate fi într-un document fără text)
for (const s of pack.solicitari) { delete s.verificat; if (!s.locator) s.locator = {}; const v = s.locator?.excerpt ? verificaLocator(s.locator) : { ok: false, motiv: 'fără excerpt' }; if (v.ok) aplicaVerdict(s.locator, v); else s.locator.verificat = null }
for (const e of pack.erate) { delete e.verificat; if (!e.locator) e.locator = {}; const v = verificaLocator(e.locator); if (v.ok) aplicaVerdict(e.locator, v); else e.locator.verificat = null }

// ── dovada „ce s-a citit”: sha256 + size_bytes ale fișierelor din /data pentru fiecare document din pack
const dataDir = opt['data-dir'] || null
let docsHash = 0
if (dataDir) for (const d of pack.documente) {
  if (!d || typeof d.nume_fisier !== 'string') continue
  const f = path.join(dataDir, d.nume_fisier)
  try {
    const st = fs.statSync(f); if (!st.isFile()) continue
    d.size_bytes = st.size; d.sha256 = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); docsHash++
  } catch { d.sha256 = null; d.size_bytes = null; d.lipsa_in_data = true }
}
if (opt.rulare) { try { pack.rulare = JSON.parse(opt.rulare) } catch { probleme.push('rulare: JSON invalid') } }

pack.validare = { la: new Date().toISOString(), validator: 'verifica_pack.mjs/2', cerinte_ok_pagina: okPag, cerinte_ok_document: okDoc, cerinte_respinse: cazute, documente_cu_sha256: docsHash, probleme_schema: probleme }
fs.writeFileSync(outF, JSON.stringify(pack, null, 1))
console.log(`VALIDARE licitatie_id=${pack.licitatie.licitatie_id ?? 'null'} nr_anunt=${pack.licitatie.nr_anunt ?? 'null'} cerinte=${cerinteOk.length} (pagina=${okPag} document=${okDoc}) respinse=${cazute} nereusite=${pack.nereusite.length} solicitari=${pack.solicitari.length} erate=${pack.erate.length} sha256=${docsHash}/${pack.documente.length} probleme=${probleme.length ? probleme.join('; ') : 'niciuna'}`)
process.exit(probleme.length ? 3 : 0)
