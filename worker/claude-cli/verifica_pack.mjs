#!/usr/bin/env node
// verifica_pack.mjs — validator FĂRĂ AI pentru Source Pack (gazpet.source_pack/v1) produs de agentul CLI.
// Folosire: node verifica_pack.mjs <pack.json> <dir text (/work/text)> <iesire.json>
// Ce face: (1) schema minimă; (2) fiecare excerpt se caută LITERAL în textul extras al fișierului (normalizat pe spații),
// întâi în pagina declarată, apoi în tot documentul; (3) cerințele fără excerpt regăsit ies din "cerinte" și intră în
// "nereusite" (motiv: excerpt negăsit) — nu se corectează, nu se parafrazează; (4) raport pe stdout (o linie) pentru jurnal.
// Conținutul pack-ului e extern (scris de model din documente scrise de autoritate): aici e doar verificat, nu executat.
import fs from 'node:fs'
import path from 'node:path'

const [,, packF, textDir, outF] = process.argv
if (!packF || !textDir || !outF) { console.error('folosire: verifica_pack.mjs <pack.json> <dir text> <iesire.json>'); process.exit(2) }

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

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[„”"«»]/g, '"').replace(/[’‘]/g, "'").trim()
const cacheText = new Map()
function textFisier(rel) {
  if (cacheText.has(rel)) return cacheText.get(rel)
  const f = path.join(textDir, rel + '.txt')
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
  cacheText.set(rel, t); return t
}
function pagini(t) { // { n: text } după marcajele ⟦PAGINA n⟧
  const out = {}; const re = /⟦PAGINA (\d+)⟧/g; let m, last = null, lastIdx = 0
  while ((m = re.exec(t))) { if (last !== null) out[last] = (out[last] || '') + t.slice(lastIdx, m.index); last = Number(m[1]); lastIdx = m.index + m[0].length }
  if (last !== null) out[last] = (out[last] || '') + t.slice(lastIdx)
  return out
}
const cachePag = new Map()
function verificaLocator(loc) {
  if (!loc || !loc.nume_fisier) return { ok: false, motiv: 'locator fără nume_fisier' }
  const t = textFisier(loc.nume_fisier)
  if (t === null) return { ok: false, motiv: `fișier fără text extras: ${loc.nume_fisier}` }
  const ex = norm(loc.excerpt)
  if (ex.length < 20) return { ok: false, motiv: 'excerpt lipsă sau sub 20 caractere' }
  if (!cachePag.has(loc.nume_fisier)) cachePag.set(loc.nume_fisier, pagini(t))
  const pg = cachePag.get(loc.nume_fisier)
  const inPag = Number.isInteger(loc.pagina) && pg[loc.pagina] && norm(pg[loc.pagina]).includes(ex)
  if (inPag) return { ok: true, nivel: 'pagina' }
  const tn = norm(t)
  if (tn.includes(ex)) {
    const pagReala = Object.keys(pg).find(n => norm(pg[n]).includes(ex))
    return { ok: true, nivel: 'document', pagina_reala: pagReala ? Number(pagReala) : null }
  }
  return { ok: false, motiv: 'excerpt negăsit literal în text' }
}

let okPag = 0, okDoc = 0, cazute = 0
const cerinteOk = []
for (const c of pack.cerinte) {
  const v = verificaLocator(c.locator)
  if (v.ok) {
    c.verificat = v.nivel
    if (v.nivel === 'document' && v.pagina_reala && v.pagina_reala !== c.locator.pagina) { c.pagina_declarata = c.locator.pagina; c.locator.pagina = v.pagina_reala }
    v.nivel === 'pagina' ? okPag++ : okDoc++
    cerinteOk.push(c)
  } else {
    cazute++
    pack.nereusite.push({ nume_fisier: c.locator?.nume_fisier || null, pagini: Number.isInteger(c.locator?.pagina) ? [c.locator.pagina] : null, motiv: `cerință ${c.ref || '?'} respinsă de validator: ${v.motiv}`, text_respins: String(c.text || '').slice(0, 300) })
  }
}
pack.cerinte = cerinteOk
// solicitări/erate: se marchează, nu se elimină (întrebarea autorității poate fi într-un document fără text)
for (const s of pack.solicitari) { const v = s.locator?.excerpt ? verificaLocator(s.locator) : { ok: false, motiv: 'fără excerpt' }; s.verificat = v.ok ? v.nivel : 'neverificat' }
for (const e of pack.erate) { const v = verificaLocator(e.locator); e.verificat = v.ok ? v.nivel : 'neverificat' }

pack.validare = { la: new Date().toISOString(), cerinte_ok_pagina: okPag, cerinte_ok_document: okDoc, cerinte_respinse: cazute, probleme_schema: probleme }
fs.writeFileSync(outF, JSON.stringify(pack, null, 1))
console.log(`VALIDARE cerinte=${cerinteOk.length} (pagina=${okPag} document=${okDoc}) respinse=${cazute} nereusite=${pack.nereusite.length} solicitari=${pack.solicitari.length} erate=${pack.erate.length} probleme=${probleme.length ? probleme.join('; ') : 'niciuna'}`)
process.exit(probleme.length ? 3 : 0)
