// /api/pdf-sparge — sparge automat PDF-urile mari din documentația de atribuire (regulă cerută de Răzvan 07.09.2026)
//
// De ce: citirea AI (ofertare-ingest-doc, edge fn) cade tăcut peste ~25 MB. Caietul de sarcini de la Mânăstirea
// (84 MB) a stat „în lucru” fără nicio eroare. Regula: orice PDF > PRAG_MB se sparge pe pagini în bucăți ≤ TINTA_MB,
// bucățile intră în procesare ca documente normale, iar originalul rămâne „ignorat” cu eticheta
// „spart de platformă în N bucăți” (UI-ul o afișează: „se citesc bucățile, fișierul acesta nu intră în analiză”).
// Dacă o singură pagină depășește ținta (planșe scanate mari), documentul e marcat planșă și se citește cu 📐 (plansa-felii).
//
// POST {doc_id}  · auth: x-import-secret (SEAP_IMPORT_SECRET) sau JWT de utilizator.
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

const PRAG_MB = 20      // peste asta se sparge
const TINTA_MB = 15     // mărimea maximă a unei bucăți

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' })
  const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const SECRET = process.env.SEAP_IMPORT_SECRET
  if (!SUPA_URL || !SERVICE) return res.status(500).json({ error: 'config lipsă' })
  if (!SECRET || req.headers['x-import-secret'] !== SECRET) {
    const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!jwt || !ANON) return res.status(401).json({ error: 'unauthorized' })
    const { data: u } = await createClient(SUPA_URL, ANON).auth.getUser(jwt)
    if (!u?.user) return res.status(401).json({ error: 'unauthorized' })
  }
  const docId = Number(req.body?.doc_id)
  if (!docId) return res.status(400).json({ error: 'doc_id lipsă' })
  const supa = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })

  const { data: doc } = await supa.from('ofertare_documente_atribuire').select('*').eq('id', docId).maybeSingle()
  if (!doc) return res.status(404).json({ error: 'document inexistent' })
  if (!/\.pdf$/i.test(doc.nume_original || '')) return res.status(400).json({ error: 'nu e PDF' })
  if (/spart .*în \d+ bucăți/i.test(doc.eroare || '')) return res.json({ ok: true, deja: true, mesaj: 'deja spart' })
  const mb = (doc.size_bytes || 0) / 1e6
  if (mb <= PRAG_MB) return res.json({ ok: true, sarit: true, mesaj: `${mb.toFixed(1)} MB ≤ ${PRAG_MB} MB — nu e nevoie` })

  const { data: blob, error: eD } = await supa.storage.from('ofertare').download(doc.fisier_path)
  if (eD || !blob) return res.status(500).json({ error: 'nu pot descărca fișierul: ' + (eD?.message || '') })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let src
  try { src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }) }
  catch (e) { await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: `PDF ilizibil la spargere: ${e.message}` }).eq('id', docId); return res.status(422).json({ error: 'PDF ilizibil: ' + e.message }) }
  const n = src.getPageCount()
  if (n < 2) return await caPlansa(supa, doc, mb, res, 'o singură pagină')

  // bucăți pe pagini: pornesc de la o estimare (bytes/pagină) și înjumătățesc dacă bucata iese peste țintă
  const tinta = TINTA_MB * 1e6
  let perParte = Math.max(1, Math.floor(tinta / (bytes.length / n)))
  const parti = []   // { de, pana, buf }
  let de = 0
  while (de < n) {
    let cate = Math.min(perParte, n - de)
    let buf = null
    while (true) {
      const out = await PDFDocument.create()
      const idx = Array.from({ length: cate }, (_, i) => de + i)
      const pages = await out.copyPages(src, idx)
      pages.forEach(p => out.addPage(p))
      buf = await out.save({ useObjectStreams: true })
      if (buf.length <= tinta || cate === 1) break
      cate = Math.max(1, Math.floor(cate / 2))
    }
    if (buf.length > tinta && cate === 1) return await caPlansa(supa, doc, mb, res, `pagina ${de + 1} are ${(buf.length / 1e6).toFixed(0)} MB`)
    parti.push({ de: de + 1, pana: de + cate, buf })
    de += cate
    if (parti.length > 60) return res.status(422).json({ error: 'prea multe bucăți (>60) — documentul e anormal' })
  }

  // urc bucățile + rândurile de document (același tip; originalul devine „ignorat” cu eticheta de spargere)
  const baza = (doc.nume_original || 'document.pdf').replace(/\.pdf$/i, '')
  const dir = doc.fisier_path.replace(/\/[^/]*$/, '')
  const ids = []
  for (let i = 0; i < parti.length; i++) {
    const p = parti[i]
    const nume = `${baza} — p${String(i + 1).padStart(2, '0')}_pag${p.de}-${p.pana}.pdf`
    const path = `${dir}/split_${docId}_p${String(i + 1).padStart(2, '0')}.pdf`
    const { error: eU } = await supa.storage.from('ofertare').upload(path, Buffer.from(p.buf), { contentType: 'application/pdf', upsert: true })
    if (eU) return res.status(500).json({ error: `upload bucata ${i + 1}: ${eU.message}`, partial: ids })
    const { data: ins, error: eI } = await supa.from('ofertare_documente_atribuire').insert({
      licitatie_id: doc.licitatie_id, fisier_path: path, nume_original: nume, tip: doc.tip, size_bytes: p.buf.length,
      status_procesare: 'neprocesat', eroare: null,
    }).select('id').single()
    if (eI) return res.status(500).json({ error: `insert bucata ${i + 1}: ${eI.message}`, partial: ids })
    ids.push(ins.id)
  }
  const eticheta = `${Math.round(mb)} MB — prea mare pentru citirea AI; spart de platformă în ${parti.length} bucăți (doc ${ids[0]}–${ids[ids.length - 1]}), rămâne aici doar ca fișier original`
  await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', eroare: eticheta, pagini: n, pagini_procesate: 0 }).eq('id', docId)
  return res.json({ ok: true, bucati: parti.length, ids, pagini: n })
}

// pagini scanate uriașe → nu ajută spargerea; se citește ca planșă (felii de imagine)
async function caPlansa(supa, doc, mb, res, motiv) {
  await supa.from('ofertare_documente_atribuire').update({ tip: 'plansa', status_procesare: 'ignorat',
    eroare: `${Math.round(mb)} MB, ${motiv} — pagini scanate mari, nu se poate sparge util; se citește ca planșă (📐 citește)` }).eq('id', doc.id)
  return res.json({ ok: true, plansa: true, motiv })
}
