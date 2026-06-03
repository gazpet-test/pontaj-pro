/**
 * scanner_nas_ai_processor.js — Gazpet ERP · NAS AI Processor v1.0
 * ══════════════════════════════════════════════════════════════════
 * Rulează pe NAS TerraMaster în Docker (Node.js 18+)
 * Addon la scanner_nas.js v1 — procesează documentele DEJA INDEXATE
 * 
 * Ce face:
 * 1. Citește din nas_documente WHERE ai_procesat_la IS NULL
 *    + extensie PDF + proiect linkat la executie
 * 2. Prioritizează documentele cheie: contract > caiet_sarcini > grafic
 * 3. Extrage text cu pdf-parse
 * 4. Trimite la Edge Function ai-parse-project-docs (Supabase)
 * 5. Edge Function Haiku analizează → populează executie_proiecte + alerte
 * 
 * Instalare:
 *   npm install @supabase/supabase-js pdf-parse
 * 
 * Cron recomandat (crontab): 0 3 * * *  (03:00 zilnic, după scan-ul de la 22:00)
 * Manual: node scanner_nas_ai_processor.js
 * 
 * ENV vars (același .env ca scanner_nas.js):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   EDGE_FUNCTION_URL (ex: https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ai-parse-project-docs)
 *   NAS_BASE_PATH (ex: /share/Licitatii_Executate/Oferte)
 *   MAX_DOCS_PER_RUN (default: 20 — control cost AI)
 *   MIN_PDF_SIZE_KB (default: 100 — skip PDF-uri mici, probabil scanuri proaste)
 */

'use strict'

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const pdfParse = require('pdf-parse')
const fs = require('fs')
const path = require('path')
const https = require('https')

// ──────────────────────────────────────────
// Config
// ──────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EDGE_URL     = process.env.EDGE_FUNCTION_URL ||
  `${SUPABASE_URL}/functions/v1/ai-parse-project-docs`
const NAS_BASE     = process.env.NAS_BASE_PATH || '/share/Licitatii_Executate/Oferte'
const MAX_DOCS     = parseInt(process.env.MAX_DOCS_PER_RUN || '20')
const MIN_SIZE_KB  = parseInt(process.env.MIN_PDF_SIZE_KB || '100')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Lipsesc SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY în .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ──────────────────────────────────────────
// Prioritate documente (ordinea de procesare)
// ──────────────────────────────────────────
// Scor mai mare = prioritate mai mare
function scorPrioritate(denumire, nasPath) {
  const d = (denumire + nasPath).toLowerCase()

  // Contract principal (nu subcontractare)
  if (d.includes('contract') && !d.includes('subcontract') && !d.includes('autorizatii') &&
      !d.includes('angajament') && !d.includes('termocontract') && !d.includes('nisab')) return 100

  // Caiet de sarcini
  if (d.includes('caiet') || d.includes('sarcini')) return 80

  // Grafic de execuție
  if (d.includes('grafic') || d.includes('program_lucr') || d.includes('gantt')) return 60

  // Situații de plată
  if (d.includes('situatie') || d.includes('situație')) return 40

  // Propunere tehnică (volum mare, mai puțin util)
  if (d.includes('propunere') || d.includes('tehnic')) return 20

  return 5
}

// ──────────────────────────────────────────
// Construiesc calea fizică NAS din nas_path
// ──────────────────────────────────────────
function buildPhysicalPath(nasPath) {
  // nasPath = "Oferte/1.TRANSGAZ/141.../contract_Dragasani.pdf"
  // pe NAS: NAS_BASE + "/" + nasPath (fără prefixul "Oferte/")
  const relative = nasPath.startsWith('Oferte/')
    ? nasPath.slice('Oferte/'.length)
    : nasPath
  return path.join(NAS_BASE, relative)
}

// ──────────────────────────────────────────
// Extrage text din PDF cu pdf-parse
// ──────────────────────────────────────────
async function extractPdfText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath)
    const data = await pdfParse(buffer, {
      max: 50, // maxim 50 pagini (contractele au ~30-100p)
    })
    return data.text || ''
  } catch (e) {
    console.warn(`  ⚠️ pdf-parse failed: ${e.message}`)
    return null
  }
}

// ──────────────────────────────────────────
// Apelează Edge Function cu text extras
// ──────────────────────────────────────────
async function callEdgeFunction(proiectId, docIdHash, text, tipDoc, nasPath, filename) {
  const payload = JSON.stringify({
    proiect_id:    proiectId,
    doc_id_hash:   docIdHash,
    text_continut: text,
    tip_doc:       tipDoc,
    nas_path:      nasPath,
    filename:      filename,
  })

  return new Promise((resolve, reject) => {
    const url = new URL(EDGE_URL)
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: { raw: data } }) }
      })
    })

    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout 60s')) })
    req.write(payload)
    req.end()
  })
}

// ──────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────
async function main() {
  console.log(`\n🤖 Scanner NAS AI Processor — ${new Date().toISOString()}`)
  console.log(`   Base path: ${NAS_BASE}`)
  console.log(`   Max docs/run: ${MAX_DOCS}`)
  console.log(`   Min PDF size: ${MIN_SIZE_KB} KB\n`)

  // Fetch documente PDF nererocesate, linkate la proiecte active
  const { data: docs, error } = await supabase
    .from('nas_documente')
    .select(`
      id_hash, nas_path, denumire, size_bytes, proiect_id_hash,
      nas_proiecte!inner(executie_proiect_id)
    `)
    .eq('extensie', 'pdf')
    .is('ai_procesat_la', null)
    .gte('size_bytes', MIN_SIZE_KB * 1024)
    .not('proiect_id_hash', 'is', null)
    .limit(500) // fetch mai multe, sortez local

  if (error) {
    console.error('❌ Eroare fetch BD:', error.message)
    process.exit(1)
  }

  // Filtrez doar cele cu proiect linkat + sortez după prioritate DESC
  const docsFiltrate = (docs || [])
    .filter(d => d.nas_proiecte?.executie_proiect_id)
    .map(d => ({
      ...d,
      proiect_id: d.nas_proiecte.executie_proiect_id,
      scor: scorPrioritate(d.denumire, d.nas_path),
    }))
    .sort((a, b) => b.scor - a.scor)
    .slice(0, MAX_DOCS)

  console.log(`📋 Documente candidate: ${(docs || []).length} total → ${docsFiltrate.length} selectate (top ${MAX_DOCS} prioritate)\n`)

  if (docsFiltrate.length === 0) {
    console.log('✅ Nimic de procesat azi. Totul e la zi.')
    return
  }

  let ok = 0, erori = 0, skip = 0

  for (const doc of docsFiltrate) {
    const filePath = buildPhysicalPath(doc.nas_path)
    const filename = path.basename(doc.nas_path)
    const sizeMB = (doc.size_bytes / 1024 / 1024).toFixed(1)

    console.log(`\n📄 [${doc.proiect_id}] ${filename} (${sizeMB}MB, scor=${doc.scor})`)

    // Verific dacă fișierul există fizic pe NAS
    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠️ Fișier lipsă fizic: ${filePath}`)
      // Marchez ca procesat cu error ca să nu reîncerce mereu
      await supabase.from('nas_documente').update({
        ai_procesat_la: new Date().toISOString(),
        ai_date_extrase: { error: 'fisier_lipsa_fizic', path: filePath },
      }).eq('id_hash', doc.id_hash)
      skip++
      continue
    }

    // Extrag text din PDF
    console.log(`   📑 Extrag text PDF...`)
    const text = await extractPdfText(filePath)

    if (!text || text.trim().length < 200) {
      console.log(`   ⚠️ Text insuficient (${text?.length || 0} chars) — PDF scanat sau gol`)
      await supabase.from('nas_documente').update({
        ai_procesat_la: new Date().toISOString(),
        text_extras: text || '',
        text_extras_la: new Date().toISOString(),
        ai_date_extrase: { error: 'text_insuficient', chars: text?.length || 0 },
      }).eq('id_hash', doc.id_hash)
      skip++
      continue
    }

    console.log(`   ✓ Text extras: ${text.length.toLocaleString()} chars`)

    // Salvez text în BD (util pentru debugging + re-procesare fără re-citire)
    await supabase.from('nas_documente').update({
      text_extras:    text.slice(0, 100000), // max 100k chars în BD
      text_extras_la: new Date().toISOString(),
    }).eq('id_hash', doc.id_hash)

    // Apel Edge Function AI
    console.log(`   🤖 Trimit la Haiku pentru analiză...`)
    try {
      const res = await callEdgeFunction(
        doc.proiect_id,
        doc.id_hash,
        text,
        null, // Edge Function detectează tipul din filename
        doc.nas_path,
        filename
      )

      if (res.status === 200 && res.body.success) {
        console.log(`   ✅ OK — confidence: ${res.body.confidence}% · tip: ${res.body.tip_doc} · alerte: ${res.body.alerte_generate}`)
        ok++
      } else {
        console.warn(`   ⚠️ Edge Function status ${res.status}:`, JSON.stringify(res.body).slice(0, 200))
        erori++
      }
    } catch (e) {
      console.error(`   ❌ Eroare apel Edge Function:`, e.message)
      // Marchez ca procesat cu error
      await supabase.from('nas_documente').update({
        ai_procesat_la: new Date().toISOString(),
        ai_date_extrase: { error: 'edge_function_failed', msg: e.message },
      }).eq('id_hash', doc.id_hash)
      erori++
    }

    // Pauză 1s între documente (evit rate limiting Anthropic)
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ Procesat: ${ok}  ⚠️ Skip: ${skip}  ❌ Erori: ${erori}`)
  console.log(`Cost estimat AI: ~$${(ok * 0.012).toFixed(3)} (Haiku ~$0.012/doc)`)
  console.log(`${'═'.repeat(50)}\n`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
