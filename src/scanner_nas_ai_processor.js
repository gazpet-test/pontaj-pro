'use strict'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const EDGE_URL     = process.env.EDGE_FUNCTION_URL || `${SUPABASE_URL}/functions/v1/ai-parse-project-docs`
const NAS_BASE     = process.env.NAS_BASE_PATH || '/data/Oferte'
const MAX_DOCS     = parseInt(process.env.MAX_DOCS_PER_RUN || '20')
const MIN_SIZE_KB  = parseInt(process.env.MIN_PDF_SIZE_KB  || '100')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Lipsesc SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const { createClient } = require('@supabase/supabase-js')
global.WebSocket = require('ws')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
})

const pdfParse = require('pdf-parse')
const fs       = require('fs')
const path     = require('path')
const https    = require('https')

function scorPrioritate(denumire, nasPath) {
  const d = (denumire + nasPath).toLowerCase()
  if (d.includes('contract') && !d.includes('subcontract') &&
      !d.includes('autorizatii') && !d.includes('angajament')) return 100
  if (d.includes('caiet') || d.includes('sarcini'))             return 80
  if (d.includes('grafic') || d.includes('program_lucr'))       return 60
  if (d.includes('situatie'))                                    return 40
  return 5
}

function buildPhysicalPath(nasPath) {
  const relative = nasPath.startsWith('Oferte/') ? nasPath.slice('Oferte/'.length) : nasPath
  return path.join(NAS_BASE, relative)
}

async function extractPdfText(filePath) {
  try {
    const data = await pdfParse(fs.readFileSync(filePath), { max: 50 })
    return data.text || ''
  } catch (e) {
    console.warn(`  pdf-parse: ${e.message}`)
    return null
  }
}

async function callEdgeFunction(proiectId, docIdHash, text, nasPath, filename) {
  const payload = JSON.stringify({ proiect_id: proiectId, doc_id_hash: docIdHash,
    text_continut: text, nas_path: nasPath, filename })
  return new Promise((resolve, reject) => {
    const url = new URL(EDGE_URL)
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${SUPABASE_KEY}` }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: { raw: data } }) }
      })
    })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')) })
    req.write(payload); req.end()
  })
}

async function main() {
  console.log(`\n Scanner NAS AI Processor — ${new Date().toISOString()}`)
  console.log(`   NAS: ${NAS_BASE} · Max: ${MAX_DOCS} · Min: ${MIN_SIZE_KB} KB\n`)

  // Step 1: fetch proiecte linkate → map hash→proiect_id
  const { data: linkate, error: errLink } = await supabase
    .from('nas_proiecte')
    .select('id_hash, executie_proiect_id')
    .not('executie_proiect_id', 'is', null)

  if (errLink) { console.error('Eroare nas_proiecte:', errLink.message); process.exit(1) }

  const h2p = {}
  for (const x of (linkate || [])) h2p[x.id_hash] = x.executie_proiect_id
  const hashList = Object.keys(h2p)
  console.log(`   Proiecte linkate: ${hashList.length}\n`)

  if (!hashList.length) { console.log('Niciun proiect linkat. Stop.'); return }

  // Step 2: fetch documente PDF neprocesate DOAR din proiectele linkate
  const { data: docs, error } = await supabase
    .from('nas_documente')
    .select('id_hash, nas_path, denumire, size_bytes, proiect_id_hash')
    .eq('extensie', 'pdf')
    .is('ai_procesat_la', null)
    .gte('size_bytes', MIN_SIZE_KB * 1024)
    .in('proiect_id_hash', hashList)
    .limit(500)

  if (error) { console.error('Eroare nas_documente:', error.message); process.exit(1) }

  const docsFiltrate = (docs || [])
    .map(d => ({ ...d, proiect_id: h2p[d.proiect_id_hash], scor: scorPrioritate(d.denumire, d.nas_path) }))
    .sort((a, b) => b.scor - a.scor)
    .slice(0, MAX_DOCS)

  console.log(`   Candidate: ${(docs||[]).length} → selectate: ${docsFiltrate.length}\n`)
  if (!docsFiltrate.length) { console.log('Nimic de procesat.'); return }

  let ok = 0, erori = 0, skip = 0

  for (const doc of docsFiltrate) {
    const filePath = buildPhysicalPath(doc.nas_path)
    const filename = path.basename(doc.nas_path)
    console.log(`\n [proiect ${doc.proiect_id}] ${filename} (${(doc.size_bytes/1024/1024).toFixed(1)}MB scor=${doc.scor})`)

    if (!fs.existsSync(filePath)) {
      console.log(`   Fisier lipsa: ${filePath}`)
      await supabase.from('nas_documente').update({ ai_procesat_la: new Date().toISOString(),
        ai_date_extrase: { error: 'fisier_lipsa' } }).eq('id_hash', doc.id_hash)
      skip++; continue
    }

    const text = await extractPdfText(filePath)
    if (!text || text.trim().length < 200) {
      console.log(`   Text insuficient (${text?.length||0} chars)`)
      await supabase.from('nas_documente').update({ ai_procesat_la: new Date().toISOString(),
        text_extras: text||'', text_extras_la: new Date().toISOString(),
        ai_date_extrase: { error: 'text_insuficient' } }).eq('id_hash', doc.id_hash)
      skip++; continue
    }

    console.log(`   Text: ${text.length.toLocaleString()} chars`)
    await supabase.from('nas_documente').update({
      text_extras: text.slice(0, 100000), text_extras_la: new Date().toISOString()
    }).eq('id_hash', doc.id_hash)

    try {
      const res = await callEdgeFunction(doc.proiect_id, doc.id_hash, text, doc.nas_path, filename)
      if (res.status === 200 && res.body.success) {
        console.log(`   OK confidence:${res.body.confidence}% tip:${res.body.tip_doc} alerte:${res.body.alerte_generate}`)
        ok++
      } else {
        console.warn(`   Status ${res.status}:`, JSON.stringify(res.body).slice(0,200))
        erori++
      }
    } catch (e) {
      console.error(`   Edge Function:`, e.message)
      await supabase.from('nas_documente').update({ ai_procesat_la: new Date().toISOString(),
        ai_date_extrase: { error: e.message } }).eq('id_hash', doc.id_hash)
      erori++
    }
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`OK:${ok}  Skip:${skip}  Erori:${erori}  Cost:~$${(ok*0.012).toFixed(3)}`)
  console.log(`${'='.repeat(50)}\n`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
