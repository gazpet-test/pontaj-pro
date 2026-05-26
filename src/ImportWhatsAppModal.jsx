// ImportWhatsAppModal.jsx v3
// 25.05.2026 - Import .zip WhatsApp grup motorină + match Rompetrol
// 26.05.2026 - FIX B: Suport pentru mesaje orfane (poze fără caption text)
// Parser hibrid: format strict v2 (după 26.05) + fallback tolerant (mai 2026 istoric)
// Pentru ANAF: stochează caption + autor + timestamp + poza bon ca dovadă auditabilă
//
// 26.05.2026 FIX B v3:
//   - Acceptă mesaje cu DOAR poze (caption gol/scurt)
//   - Upload pozele orfane în bucket cu prefix 'orphan/'
//   - Salvează în whatsapp_messages_processed cu status='pending_plate_detection'
//   - Plate detection se face ulterior cu Vision OCR (Edge Function separată)

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import JSZip from 'jszip'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', logistica:'#E3B341',
}

// ──────────────────────────────────────────────────────────────
// PARSER HELPERS
// ──────────────────────────────────────────────────────────────

function normalize(s) {
  if (!s) return ''
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizePlacuta(p) {
  return (p || '').toLowerCase().replace(/[\s\-\.]+/g, '')
}

function normalizeUt(s) {
  return (s || '').toLowerCase().replace(/[\s\-\.]+/g, '')
}

// Hash simplu pentru anti-dedup (SubtleCrypto async în browser)
async function hashMessage(autor, dt, caption) {
  const text = `${autor}|${dt.toISOString()}|${(caption || '').slice(0, 50)}`
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// Parser linii WhatsApp text - suportă AMBELE formate Android + iOS
// Format Android: "5/21/26, 13:24 - Author: text" + "IMG-NNN-WANNN.jpg (file attached)"
// Format iOS:     "[21.05.2026, 13:24:00] Author: text" + "<atașare: NNNN-PHOTO-YYYY-MM-DD-HH-MM-SS.jpg>"
// 25.05.2026: descoperit la export arhivă Razvan (iPhone) - vechea regex doar Android nu prindea nimic
function parseWhatsAppText(text) {
  // Detect format: prima linie de mesaj real (ignorăm header-ul criptat al WhatsApp)
  // Android: începe cu DIGIT (ex 5/21/26)  
  // iOS: începe cu '[' (cu/fără U+200E LRM înainte)
  const datePatAndroid = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}) - /
  const datePatIos     = /^\u200E?\[(\d{1,2})\.(\d{1,2})\.(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\]\s+/
  
  // 25.05.2026: arhiva iOS folosește CRLF — trebuie să normalizez line endings ÎNAINTE de split
  // Altfel `\r` la final strică regex match-ul cu `$`
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n')
  const messages = []
  let current = null
  
  for (const line of lines) {
    // Android line start?
    const matchAndroid = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}) - ([^:]+?): (.*)$/)
    // iOS line start?
    const matchIos = line.match(/^\u200E?\[(\d{1,2})\.(\d{1,2})\.(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\]\s+([^:]+?):\s?(.*)$/)
    
    if (matchAndroid) {
      if (current) messages.push(current)
      current = {
        format: 'android',
        date: matchAndroid[1], time: matchAndroid[2],
        author: matchAndroid[3].trim(),
        text: matchAndroid[4], extraLines: []
      }
    } else if (matchIos) {
      if (current) messages.push(current)
      current = {
        format: 'ios',
        // m[1]=day, m[2]=month, m[3]=year, m[4]=hh, m[5]=mm, m[6]=ss
        date: `${matchIos[1]}.${matchIos[2]}.${matchIos[3]}`, 
        time: `${matchIos[4]}:${matchIos[5]}`,
        iosParts: { day: matchIos[1], month: matchIos[2], year: matchIos[3], hh: matchIos[4], mm: matchIos[5], ss: matchIos[6] },
        author: matchIos[7].trim(),
        text: matchIos[8], extraLines: []
      }
    } else if (current) {
      current.extraLines.push(line)
    }
  }
  if (current) messages.push(current)
  
  // Combinez și extrag nume imagine
  for (const m of messages) {
    const full = m.text + (m.extraLines.length ? '\n' + m.extraLines.join('\n') : '')
    
    // Detect imagine atașată - DUAL format
    // Android: IMG-20260521-WA0001.jpg (file attached)
    // iOS:     <atașare: 00000123-PHOTO-2026-05-21-13-24-00.jpg>  (sau <attached:>, etc.)
    const imgAndroid = full.match(/IMG-[\w-]+\.(jpg|jpeg|png|webp)/i)
    const imgIos     = full.match(/<(?:ata[sș]are|attached|attachment):\s*([\w.-]+\.(?:jpg|jpeg|png|webp))>/i)
    
    if (imgAndroid) {
      m.imageFile = imgAndroid[0]
    } else if (imgIos) {
      m.imageFile = imgIos[1]  // doar filename, fără tag-ul <atașare:>
    } else {
      m.imageFile = null
    }
    
    // Caption curat: scot ambele formate de attachment + media-omitted
    m.caption = full
      .replace(/\u200E?<(?:ata[sș]are|attached|attachment):\s*[\w.-]+\.(?:jpg|jpeg|png|webp)>/gi, '')
      .replace(/IMG-[\w-]+\.(?:jpg|jpeg|png|webp)\s*\(file attached\)/gi, '')
      .replace(/<Media omitted>/gi, '')
      .replace(/\u200E?Imagine omis[ăa]/gi, '')  // iOS RO
      .replace(/\u200E/g, '')  // scot toate LRM-urile reziduale
      .replace(/\s+/g, ' ')  // normalizez whitespace
      .trim()
    
    // Parse data WhatsApp
    try {
      if (m.format === 'ios') {
        const p = m.iosParts
        m.dt = new Date(
          parseInt(p.year, 10), 
          parseInt(p.month, 10) - 1, 
          parseInt(p.day, 10), 
          parseInt(p.hh, 10), 
          parseInt(p.mm, 10), 
          parseInt(p.ss, 10)
        )
      } else {
        // Android M/D/YY HH:MM
        const parts = m.date.split('/')
        let year = parseInt(parts[2], 10)
        if (year < 100) year += 2000  // YY → 20YY
        const month = parseInt(parts[0], 10) - 1
        const day = parseInt(parts[1], 10)
        const [hh, mm] = m.time.split(':').map(x => parseInt(x, 10))
        m.dt = new Date(year, month, day, hh, mm)
      }
    } catch { m.dt = null }
  }
  
  return messages.filter(m => m.dt && !isNaN(m.dt.getTime()))
}

// Detect site din caption folosind aliases LIVE
function detectSite(text, sitesWithAliases) {
  if (!text) return null
  const norm = normalize(text)
  
  // Sortez aliases DESC by length pentru a prinde cele specifice primele
  const allPairs = []
  for (const s of sitesWithAliases) {
    for (const alias of (s.aliases || [])) {
      allPairs.push({ alias, site: s })
    }
  }
  allPairs.sort((a, b) => b.alias.length - a.alias.length)
  
  for (const { alias, site } of allPairs) {
    // Word boundary match
    const aliasEsc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp('(?<![a-z])' + aliasEsc + '(?![a-z])')
    if (pattern.test(norm)) {
      return site
    }
  }
  return null
}

// Detect vehicul din caption (plăcuță auto sau cod UT/TST)
function findVehicleInText(text, vehicles) {
  if (!text || !vehicles?.length) return null
  
  // Caut UT/TST cod
  const utPat = /\b(UT|TST)\s*0?(\d{3,5})\b/gi
  let match
  while ((match = utPat.exec(text)) !== null) {
    const code = match[1].toUpperCase() + match[2]
    const codeNorm = code.toLowerCase()
    for (const v of vehicles) {
      if (v.nr_inmatriculare && normalizeUt(v.nr_inmatriculare) === codeNorm) {
        return { vehicle: v, source: 'nr_inmatriculare' }
      }
      if (v.cod_intern && normalizeUt(v.cod_intern) === codeNorm) {
        return { vehicle: v, source: 'cod_intern' }
      }
    }
  }
  
  // Caut plăcuță auto: 1-2 litere + 2-5 cifre + 2-4 litere
  const placPat = /\b([A-Z]{1,2})\s*0?\s*(\d{2,5})\s*([A-Z]{2,4})\b/gi
  while ((match = placPat.exec(text)) !== null) {
    const plac = (match[1] + match[2] + match[3]).toUpperCase()
    const placNorm = plac.toLowerCase()
    for (const v of vehicles) {
      if (v.nr_inmatriculare && normalizePlacuta(v.nr_inmatriculare) === placNorm) {
        return { vehicle: v, source: 'nr_inmatriculare' }
      }
    }
  }
  
  return null
}

// Extract litri din caption
function extractLitri(text) {
  if (!text) return null
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*l(?:itri)?\b/gi)]
  if (matches.length) {
    return parseFloat(matches[matches.length - 1][1].replace(',', '.'))
  }
  return null
}

// Parser principal — analizează un caption și returnează componentele identificate
function parseCaptionMessage(caption, sites, vehicles) {
  if (!caption) return null
  
  const site = detectSite(caption, sites)
  const vehicleResult = findVehicleInText(caption, vehicles)
  const litri = extractLitri(caption)
  
  let foundCount = 0
  if (site) foundCount++
  if (vehicleResult) foundCount++
  if (litri) foundCount++
  
  const hasSeparator = /[\-\/,]/.test(caption)
  const isShort = caption.length < 200
  
  let score = foundCount / 3
  if (foundCount >= 2 && hasSeparator && isShort) {
    score = Math.min(1, score + 0.15)
  }
  
  return {
    site,
    vehicle: vehicleResult?.vehicle || null,
    litri,
    foundCount,
    score: Math.round(score * 100) / 100,
    formatStrict: foundCount === 3 && hasSeparator && isShort,
  }
}

// 25.05.2026 — Etapa 4 OCR prerequisite: upload poza bon WhatsApp în bucket
// Path strategy: {YYYY-MM}/{alim_id}_{msg_hash[:8]}.{ext}
// Returnează { ok, path, reason, error }
async function uploadPozaForAlim(zip, alimId, msg) {
  if (!msg.imageFile) return { ok: false, reason: 'no_image' }
  if (!zip) return { ok: false, reason: 'no_zip' }
  
  // 1. Caut fișierul în zip (root sau subfolder)
  let file = zip.file(msg.imageFile)
  if (!file) {
    // Încerc lookup pe filename only (zip-ul WhatsApp uneori are subfolder)
    const fname = msg.imageFile.split('/').pop()
    zip.forEach((relPath, f) => {
      if (!file && relPath.endsWith(fname) && !f.dir) file = f
    })
  }
  if (!file) return { ok: false, reason: 'not_in_zip' }
  
  // 2. Path & content type
  const extMatch = msg.imageFile.match(/\.(jpg|jpeg|png|webp)$/i)
  const extRaw = (extMatch ? extMatch[1] : 'jpg').toLowerCase()
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw
  const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const ym = msg.dt.toISOString().slice(0, 7)  // YYYY-MM
  const hashShort = (msg.hash || '').slice(0, 8) || Date.now().toString(36)
  const path = `${ym}/${alimId}_${hashShort}.${ext}`
  
  // 3. Upload (upsert: true = idempotent la re-import)
  // 25.05.2026 BUGFIX: JSZip.async('blob') returnează 'application/octet-stream' care e respins
  // de bucket (allowed: image/jpeg, image/png, image/webp). Reconstrucție explicit cu MIME corect.
  const arrayBuffer = await file.async('arraybuffer')
  const blob = new Blob([arrayBuffer], { type: contentType })
  const { error: upErr } = await supabase.storage
    .from('whatsapp-motorina-bonuri')
    .upload(path, blob, { contentType, upsert: true })
  if (upErr) return { ok: false, reason: 'upload_error', error: upErr.message }
  
  // 4. Update alimentare cu path-ul + reset ocr_status la 'pending' ca să intre în următorul OCR bulk
  const { error: updErr } = await supabase
    .from('logistica_alimentari')
    .update({ 
      whatsapp_poza_path: path,
      ocr_status: 'pending',
      ocr_data: null,
      ocr_validated_at: null,
    })
    .eq('id', alimId)
  if (updErr) return { ok: false, reason: 'update_error', error: updErr.message }
  
  return { ok: true, path }
}

// ──────────────────────────────────────────────────────────────
// COMPONENTA MODAL
// ──────────────────────────────────────────────────────────────

export default function ImportWhatsAppModal({ 
  onClose, 
  onImported,
  showToast,
  profile,
}) {
  const [step, setStep] = useState(1)  // 1=upload, 2=parsing, 3=review, 4=done
  const [zipFile, setZipFile] = useState(null)
  const [zipInstance, setZipInstance] = useState(null)  // 25.05.2026: instanță JSZip pentru upload poze
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [parsedMessages, setParsedMessages] = useState([])
  const [sites, setSites] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [alimentariFaraSantier, setAlimentariFaraSantier] = useState([])
  const [matches, setMatches] = useState([])  // rezultat match
  const [dateRangeFilter, setDateRangeFilter] = useState({ start: '2026-05-01', end: '' })
  const [confirmed, setConfirmed] = useState(new Set())  // ID-uri match-uri confirmate
  // 25.05.2026: stats pentru poze (Etapa 4 OCR prerequisite)
  const [backfillStats, setBackfillStats] = useState({ checked: 0, uploaded: 0, skipped: 0, errors: 0 })
  const [backfillErrors, setBackfillErrors] = useState([])  // 25.05.2026: detalii erori backfill (vizibile Step 3)
  const [pozeUploadedNew, setPozeUploadedNew] = useState(0)  // poze uploadate pe match-uri noi
  // 25.05.2026: errori detaliate pentru debugging upload (vizibile în Step 4)
  const [uploadErrors, setUploadErrors] = useState([])
  // 26.05.2026 FIX B: state pentru procesare AI Vision pe pozele orfane
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiProgress, setAiProgress] = useState('')
  const [aiResults, setAiResults] = useState(null)  // { total, plates_detected, matched, cost_usd, batches }
  const [pendingPlateCount, setPendingPlateCount] = useState(0)  // câte mesaje pending în BD (refresh la step 4)
  const fileInputRef = useRef(null)
  
  // Drag&drop handlers
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.zip')) {
      setZipFile(file)
    } else {
      showToast('Doar fișiere .zip sunt acceptate', 'error')
    }
  }, [showToast])
  
  const handleDragOver = useCallback((e) => { e.preventDefault() }, [])
  
  // STEP 1 → STEP 2: Procesare .zip
  const processZip = useCallback(async () => {
    if (!zipFile) return
    setProcessing(true)
    setStep(2)
    
    try {
      // 1. Load BD data (sites cu aliases + vehicule active)
      setProgress('📚 Încarc datele din BD...')
      const [sitesRes, vehiclesRes, alimRes] = await Promise.all([
        supabase.from('sites').select('id, name, aliases').eq('active', true).order('name'),
        supabase.from('logistica_active')
          .select('id, marca, model, nr_inmatriculare, cod_intern')
          .eq('vandut', false).eq('deep_sleep', false),
        supabase.from('v_alimentari_fara_santier').select('*'),
      ])
      
      if (sitesRes.error || vehiclesRes.error || alimRes.error) {
        throw new Error('Eroare BD: ' + (sitesRes.error?.message || vehiclesRes.error?.message || alimRes.error?.message))
      }
      setSites(sitesRes.data || [])
      setVehicles(vehiclesRes.data || [])
      setAlimentariFaraSantier(alimRes.data || [])
      
      // 2. Dezarhivez .zip
      setProgress('📦 Dezarhivez fișierul .zip...')
      const zip = await JSZip.loadAsync(zipFile)
      setZipInstance(zip)  // 25.05.2026: salvez pentru upload poze în applyMatches
      
      // 3. Caut _chat.txt
      setProgress('📄 Caut _chat.txt...')
      let chatText = null
      zip.forEach((relPath, file) => {
        if (relPath.endsWith('.txt') && !file.dir) chatText = file
      })
      if (!chatText) throw new Error('Nu am găsit fișierul .txt în arhivă')
      const txtContent = await chatText.async('text')
      
      // 4. Parsez mesajele
      setProgress('✂️ Parsez mesajele...')
      let messages = parseWhatsAppText(txtContent)
      
      // 5. Filtrez pe data range
      const startDt = dateRangeFilter.start ? new Date(dateRangeFilter.start) : null
      const endDt = dateRangeFilter.end ? new Date(dateRangeFilter.end + 'T23:59:59') : null
      if (startDt) messages = messages.filter(m => m.dt >= startDt)
      if (endDt) messages = messages.filter(m => m.dt <= endDt)
      
      // 6. Filtru: acceptă mesaje cu caption non-empty SAU mesaje cu doar poze (FIX B 26.05.2026)
      // Înainte: messages.filter(m => m.caption && m.caption.length > 3) — ÎN BUG = ignora pozele orfane (cazul Shashika)
      messages = messages.filter(m => 
        (m.caption && m.caption.length > 3) || m.imageFile
      )
      
      setProgress(`🔍 Analizez ${messages.length} mesaje...`)
      
      // 7. Analizez fiecare mesaj
      const analyzed = messages.map(m => {
        const parsed = parseCaptionMessage(m.caption, sitesRes.data || [], vehiclesRes.data || [])
        return { ...m, parsed }
      })
      
      // 8. Anti-dedup: verific care mesaje sunt deja procesate
      setProgress('🔁 Verific dedup...')
      const hashes = await Promise.all(
        analyzed.map(m => hashMessage(m.author, m.dt, m.caption))
      )
      analyzed.forEach((m, idx) => { m.hash = hashes[idx] })
      
      const { data: existingHashes } = await supabase
        .from('whatsapp_messages_processed')
        .select('msg_hash')
        .in('msg_hash', hashes)
      
      const existingSet = new Set((existingHashes || []).map(h => h.msg_hash))
      const newMessages = analyzed.filter(m => !existingSet.has(m.hash))
      
      setProgress(`✅ ${newMessages.length} mesaje noi (${analyzed.length - newMessages.length} dedup)`)
      
      // 9. Match cu alimentări fără șantier din BD
      const rompetrolFaraSantier = (alimRes.data || []).filter(a => 
        a.statie_combustibil && a.statie_combustibil.toLowerCase().includes('rompetrol')
      )
      
      const matches = []
      for (const alim of rompetrolFaraSantier) {
        const alimDt = new Date(alim.data_alimentare)
        const alimPlac = normalizePlacuta(alim.nr_inmatriculare || '')
        
        // Caut mesajele din ±36h care menționează plăcuța
        let best = null
        for (const msg of newMessages) {
          const diffH = Math.abs((msg.dt - alimDt) / 3600000)
          // Window 96h (25.05.2026): șoferii postează uneori cu întârziere semnificativă
          // (cap tractor MAN PH 24 FAO, vehicule cu cursă lungă, weekend, concedii).
          // Tradeoff: mai multe match-uri legitime pentru istoric vs risc mic de false-positives
          // (filtrul vehicle.id strict pe plăcuța previne 99% din false matches).
          if (diffH > 96) continue
          
          if (!msg.parsed) continue
          // Match cu plăcuța vehiculului
          if (msg.parsed.vehicle && msg.parsed.vehicle.id === alim.active_id) {
            if (!best || diffH < best.diffH) {
              best = { msg, diffH }
            }
          }
        }
        
        if (best && best.msg.parsed?.site) {
          matches.push({
            alim,
            msg: best.msg,
            site: best.msg.parsed.site,
            diffH: best.diffH,
            confidence: best.msg.parsed.score >= 0.9 ? 'high' : 'medium',
            autoConfirm: best.msg.parsed.formatStrict && best.msg.parsed.score >= 0.95,
          })
        }
      }
      
      // Pre-confirm cei high confidence
      const autoConfirmed = new Set(
        matches.filter(m => m.autoConfirm).map(m => m.alim.id)
      )
      setConfirmed(autoConfirmed)
      setMatches(matches)
      setParsedMessages(newMessages)
      
      // 25.05.2026 — DUAL MODE: Backfill poze pentru alimentări deja procesate WhatsApp fără poză
      // Scanez TOATE mesajele (inclusiv cele dedup-uite) cu imageFile, caut alimentare matched
      // anterior cu (autor + msg_dt) DAR fără whatsapp_poza_path → upload poza retroactiv.
      setProgress('📷 Backfill poze pentru alimentări procesate anterior...')
      const messagesWithImages = analyzed.filter(m => m.imageFile)
      const bfStats = { checked: 0, uploaded: 0, skipped: 0, errors: 0 }
      const bfErrList = []  // 25.05.2026: erori detaliate backfill
      
      for (const msg of messagesWithImages) {
        bfStats.checked++
        // Caut alimentare deja matched cu acest mesaj DAR fără poză
        const { data: existingAlim } = await supabase
          .from('logistica_alimentari')
          .select('id, whatsapp_poza_path, active_id, logistica_active(nr_inmatriculare)')
          .eq('whatsapp_autor', msg.author)
          .eq('whatsapp_msg_dt', msg.dt.toISOString())
          .is('whatsapp_poza_path', null)
          .maybeSingle()
        
        if (!existingAlim) { bfStats.skipped++; continue }
        
        const result = await uploadPozaForAlim(zip, existingAlim.id, msg)
        if (result.ok) bfStats.uploaded++
        else { 
          bfStats.errors++ 
          console.warn(`Backfill failed pentru alim #${existingAlim.id}:`, result)
          bfErrList.push({
            alim_id: existingAlim.id,
            plac: existingAlim.logistica_active?.nr_inmatriculare || '?',
            imageFile: msg.imageFile,
            reason: result.reason,
            detail: result.error || '',
            autor: msg.author,
            data: msg.dt.toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
          })
        }
      }
      setBackfillStats(bfStats)
      setBackfillErrors(bfErrList)
      
      setStep(3)
      setProgress('')
    } catch (err) {
      console.error('Eroare import:', err)
      showToast('Eroare: ' + (err.message || String(err)), 'error')
      setStep(1)
    } finally {
      setProcessing(false)
    }
  }, [zipFile, dateRangeFilter, showToast])
  
  // STEP 3 → STEP 4: Aplic match-urile confirmate
  const applyMatches = useCallback(async () => {
    setProcessing(true)
    setProgress('💾 Salvez alocările...')
    
    try {
      const toUpdate = matches.filter(m => confirmed.has(m.alim.id))
      let updated = 0
      let pozeNew = 0  // 25.05.2026: count poze uploadate pe match-uri noi
      let errors = []
      const uploadErrList = []  // 25.05.2026: erori detaliate upload poze (vizibile în Step 4)
      
      // 25.05.2026: Verificare critică zipInstance înainte de loop
      if (!zipInstance) {
        uploadErrList.push({ 
          alim_id: 0, 
          plac: 'GLOBAL', 
          reason: 'no_zip', 
          detail: 'zipInstance e null la momentul Aplic! State React a pierdut referința. Probabil bug de timing.' 
        })
      }
      
      for (const m of toUpdate) {
        const { error } = await supabase
          .from('logistica_alimentari')
          .update({
            site_id: m.site.id,
            whatsapp_caption: m.msg.caption,
            whatsapp_autor: m.msg.author,
            whatsapp_msg_dt: m.msg.dt.toISOString(),
            sursa_alocare_santier: m.msg.parsed.formatStrict ? 'format_strict' : 'whatsapp',
            aloc_santier_de: profile?.id,
            aloc_santier_la: new Date().toISOString(),
          })
          .eq('id', m.alim.id)
        
        if (error) errors.push(`#${m.alim.id}: ${error.message}`)
        else {
          updated++
          // 25.05.2026: Upload poza bonului dacă mesajul are imageFile
          if (m.msg.imageFile && zipInstance) {
            const result = await uploadPozaForAlim(zipInstance, m.alim.id, m.msg)
            if (result.ok) pozeNew++
            else {
              console.warn(`Poza upload failed pentru alim #${m.alim.id}:`, result)
              uploadErrList.push({
                alim_id: m.alim.id,
                plac: m.alim.nr_inmatriculare || '?',
                imageFile: m.msg.imageFile,
                reason: result.reason,
                detail: result.error || ''
              })
            }
          } else if (!m.msg.imageFile) {
            // Fără poză = setez ocr_status la 'no_poza' explicit ca să nu apară în coada OCR
            await supabase
              .from('logistica_alimentari')
              .update({ ocr_status: 'no_poza' })
              .eq('id', m.alim.id)
          } else if (m.msg.imageFile && !zipInstance) {
            // Caz suspicios: ar trebui să avem zipInstance
            uploadErrList.push({
              alim_id: m.alim.id,
              plac: m.alim.nr_inmatriculare || '?',
              imageFile: m.msg.imageFile,
              reason: 'no_zip_in_state',
              detail: 'zipInstance era null deși mesajul are imageFile'
            })
          }
        }
      }
      setPozeUploadedNew(pozeNew)
      setUploadErrors(uploadErrList)
      
      // 26.05.2026 FIX B: Upload pozele orfane (caption gol/scurt fără plăcuța identificabilă)
      // Aceste mesaje vor fi procesate ulterior cu Vision OCR pentru identificare plăcuța
      setProgress('📤 Upload poze orfane...')
      const orphanUploads = new Map()  // msg.hash -> photo_path uploadat
      
      const orphanMsgs = parsedMessages.filter(m => {
        if (!m.imageFile) return false  // fără poză = nu e orfan
        if (!zipInstance) return false
        // Orfan = NU a fost matched cu o alimentare specifică prin parser (parsed.vehicle null)
        const isMatched = matches.find(x => x.msg === m)
        if (isMatched && confirmed.has(isMatched.alim.id)) return false
        // Plus, dacă parsed.vehicle există dar nu s-a confirmat, tot e orfan
        return !m.parsed?.vehicle
      })
      
      for (const om of orphanMsgs) {
        // Path special pentru orfani: orphan/{YYYY-MM}/{hash[:8]}_{filename}
        const yyyymm = om.dt.toISOString().slice(0, 7)  // 2026-05
        const ext = (om.imageFile.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg').toLowerCase()
        const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        const path = `orphan/${yyyymm}/${om.hash.slice(0, 8)}.${ext}`
        
        try {
          let file = zipInstance.file(om.imageFile)
          if (!file) {
            const fname = om.imageFile.split('/').pop()
            zipInstance.forEach((relPath, f) => {
              if (!file && relPath.endsWith(fname) && !f.dir) file = f
            })
          }
          if (!file) continue
          
          const arrayBuffer = await file.async('arraybuffer')
          const blob = new Blob([arrayBuffer], { type: contentType })
          const { error: upErr } = await supabase.storage
            .from('whatsapp-motorina-bonuri')
            .upload(path, blob, { contentType, upsert: true })
          
          if (!upErr) {
            orphanUploads.set(om.hash, path)
          }
        } catch (e) {
          console.warn('Orphan upload failed:', om.hash, e)
        }
      }
      
      // Audit log
      await supabase.from('whatsapp_imports_log').insert({
        uploaded_by: profile?.id,
        uploaded_at: new Date().toISOString(),
        filename: zipFile?.name || '',
        filesize_bytes: zipFile?.size || 0,
        total_messages: parsedMessages.length,
        messages_processed: parsedMessages.length,
        alimentari_matched: updated,
        alimentari_ambigue: matches.length - confirmed.size,
        alimentari_nematched: alimentariFaraSantier.length - matches.length,
        date_range_start: dateRangeFilter.start || null,
        date_range_end: dateRangeFilter.end || null,
        status: errors.length === 0 ? 'success' : 'partial',
        observatii: orphanUploads.size > 0 
          ? `Orphan poze uploadate: ${orphanUploads.size} (pending plate detection)` 
          : null,
      })
      
      // Salvez hash-urile mesajelor procesate (anti-dedup viitor)
      // 26.05.2026 FIX B: Includ și mesajele orfane cu photo_path + status='pending_plate_detection'
      const toSaveHashes = parsedMessages.map(m => {
        const matchInfo = matches.find(x => x.msg === m)
        const isConfirmedMatch = matchInfo && confirmed.has(matchInfo.alim.id)
        const orphanPath = orphanUploads.get(m.hash)
        
        let status
        if (isConfirmedMatch) {
          status = 'matched'
        } else if (matchInfo) {
          status = 'ambig'
        } else if (orphanPath) {
          status = 'pending_plate_detection'  // orfan cu poză - pentru procesare Vision ulterior
        } else {
          status = 'no_match'
        }
        
        return {
          msg_hash: m.hash,
          msg_dt: m.dt.toISOString(),
          autor: m.author,
          caption_preview: (m.caption || '').slice(0, 200),
          status,
          photo_path: orphanPath || null,
          alimentare_id: isConfirmedMatch ? matchInfo.alim.id : null,
        }
      })
      
      // Upsert hashes (în batches de 100)
      for (let i = 0; i < toSaveHashes.length; i += 100) {
        await supabase.from('whatsapp_messages_processed').upsert(
          toSaveHashes.slice(i, i + 100),
          { onConflict: 'msg_hash', ignoreDuplicates: true }
        )
      }
      
      if (errors.length === 0) {
        const orphanInfo = orphanUploads.size > 0 
          ? ` · ${orphanUploads.size} poze orfane salvate pentru procesare AI` 
          : ''
        showToast(`✅ ${updated} alimentări actualizate${orphanInfo}`, 'success')
      } else {
        showToast(`⚠️ ${updated} actualizate, ${errors.length} erori`, 'warn')
        console.error('Erori:', errors)
      }
      
      setStep(4)
      if (onImported) onImported()
    } catch (err) {
      console.error('Eroare aplicare:', err)
      showToast('Eroare: ' + err.message, 'error')
    } finally {
      setProcessing(false)
    }
  }, [matches, confirmed, profile, zipFile, zipInstance, parsedMessages, alimentariFaraSantier, dateRangeFilter, onImported, showToast])
  
  // 26.05.2026 FIX B: Procesare AI Vision pe pozele orfane (apel Edge Function detect_plate_orphan_msgs)
  const processOrphansWithAI = useCallback(async () => {
    setAiProcessing(true)
    setAiProgress('🤖 Pornesc Vision OCR...')
    
    let totalProcessed = 0, totalMatched = 0, totalPlatesDetected = 0
    let totalCost = 0, batchNr = 0, totalErrors = 0
    const allResults = []
    
    try {
      while (true) {
        batchNr++
        setAiProgress(`🤖 Batch ${batchNr} - procesez (max 30 mesaje per batch)...`)
        
        const t0 = Date.now()
        const { data, error } = await supabase.functions.invoke('detect_plate_orphan_msgs')
        const dt = ((Date.now() - t0) / 1000).toFixed(1)
        
        if (error) {
          console.error('Eroare Edge Function:', error)
          setAiProgress(`❌ Eroare batch ${batchNr}: ${error.message || 'unknown'}`)
          break
        }
        
        if (!data?.summary?.total || data.summary.total === 0) {
          setAiProgress(`✅ Gata - nu mai sunt mesaje orfane de procesat`)
          break
        }
        
        totalProcessed += data.summary.total
        totalMatched += data.summary.matched
        totalPlatesDetected += data.summary.plates_detected
        totalCost += data.meta?.cost_usd || 0
        totalErrors += data.summary.errors || 0
        if (data.results) allResults.push(...data.results)
        
        setAiProgress(
          `Batch ${batchNr}: ${data.summary.total} procesate · ${data.summary.plates_detected} plăcuțe · ${data.summary.matched} match-uri (${dt}s, $${data.meta?.cost_usd})`
        )
        
        // Pauză 1.5 sec între batch-uri (politicos cu Anthropic API)
        await new Promise(r => setTimeout(r, 1500))
        
        // Safety: nu mai mult de 20 batch-uri (= max 600 mesaje per sesiune)
        if (batchNr >= 20) {
          setAiProgress('⚠️ Limit safety - 20 batch-uri rulate. Re-lansează pentru restul.')
          break
        }
      }
      
      setAiResults({
        total: totalProcessed,
        plates_detected: totalPlatesDetected,
        matched: totalMatched,
        errors: totalErrors,
        cost_usd: totalCost,
        batches: batchNr,
        details: allResults,
      })
      
      // Refresh count pending plate (probabil 0 acum)
      const { count } = await supabase
        .from('whatsapp_messages_processed')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_plate_detection')
        .is('plate_detected', null)
      setPendingPlateCount(count || 0)
      
      // Refresh listă alimentări fără șantier (poate s-au alocat mai multe)
      if (onImported) onImported()
      
      showToast(
        `✅ AI procesat ${totalProcessed} poze · ${totalPlatesDetected} plăcuțe identificate · ${totalMatched} match-uri cu alimentări`,
        'success'
      )
    } catch (e) {
      console.error('Eroare procesare AI:', e)
      setAiProgress(`❌ Eroare: ${e.message || String(e)}`)
      showToast('Eroare procesare AI: ' + (e.message || String(e)), 'error')
    } finally {
      setAiProcessing(false)
    }
  }, [showToast, onImported])
  
  // 26.05.2026: La intrare în Step 4, fac count pending pentru a afișa butonul AI cu badge corect
  useEffect(() => {
    if (step !== 4) return
    let cancelled = false
    ;(async () => {
      const { count } = await supabase
        .from('whatsapp_messages_processed')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_plate_detection')
        .is('plate_detected', null)
      if (!cancelled) setPendingPlateCount(count || 0)
    })()
    return () => { cancelled = true }
  }, [step])
  
  // ────────────────────── RENDER ──────────────────────
  
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
      zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center',
      padding:20
    }} onClick={onClose}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:1100, maxHeight:'90vh', overflow:'hidden',
        display:'flex', flexDirection:'column'
      }} onClick={e => e.stopPropagation()}>
        
        {/* HEADER */}
        <div style={{
          padding:'16px 22px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center'
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.logistica}}>📲 Import WhatsApp - Grup Motorină</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Pas {step}/4 · {step===1?'Upload arhivă':step===2?'Procesare':step===3?'Confirmare alocări':'Gata!'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background:'transparent', border:'none', color:G.muted,
            fontSize:24, cursor:'pointer', padding:'4px 12px'
          }}>×</button>
        </div>
        
        {/* CONTENT */}
        <div style={{flex:1, overflow:'auto', padding:22}}>
          
          {/* STEP 1: UPLOAD */}
          {step === 1 && (
            <div>
              <div style={{
                border:`2px dashed ${zipFile ? G.green : G.border2}`,
                borderRadius:14, padding:50, textAlign:'center',
                background: zipFile ? G.green+'11' : G.bg,
                cursor:'pointer', transition:'all .2s'
              }}
              onDrop={handleDrop} onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}>
                <div style={{fontSize:60, marginBottom:10}}>{zipFile ? '✅' : '📦'}</div>
                {zipFile ? (
                  <>
                    <div style={{fontSize:16, fontWeight:700, color:G.green}}>{zipFile.name}</div>
                    <div style={{fontSize:13, color:G.muted, marginTop:4}}>
                      {(zipFile.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{fontSize:16, fontWeight:700, color:G.text}}>Trage aici arhiva .zip WhatsApp</div>
                    <div style={{fontSize:13, color:G.muted, marginTop:8}}>
                      sau click pentru a selecta fișier
                    </div>
                    <div style={{fontSize:11, color:G.dim, marginTop:14, lineHeight:1.6}}>
                      Settings → Export Chat → ✅ Include Media (din WhatsApp mobil)
                    </div>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".zip" style={{display:'none'}}
                  onChange={e => e.target.files[0] && setZipFile(e.target.files[0])} />
              </div>
              
              {/* Filtru data */}
              <div style={{marginTop:20, padding:16, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
                <div style={{fontSize:13, fontWeight:700, marginBottom:10, color:G.text}}>
                  🗓️ Procesează doar mesaje în intervalul:
                </div>
                <div style={{display:'flex', gap:12, alignItems:'center'}}>
                  <input type="date" value={dateRangeFilter.start}
                    onChange={e => setDateRangeFilter(s => ({...s, start: e.target.value}))}
                    style={{
                      background:G.bg, border:`1px solid ${G.border2}`, color:G.text,
                      borderRadius:8, padding:'8px 10px', fontSize:13
                    }} />
                  <span style={{color:G.muted}}>până la</span>
                  <input type="date" value={dateRangeFilter.end} placeholder="azi"
                    onChange={e => setDateRangeFilter(s => ({...s, end: e.target.value}))}
                    style={{
                      background:G.bg, border:`1px solid ${G.border2}`, color:G.text,
                      borderRadius:8, padding:'8px 10px', fontSize:13
                    }} />
                </div>
                <div style={{fontSize:11, color:G.dim, marginTop:8}}>
                  💡 Aprilie 2026 + mai vechi: nu re-procesăm (deja făcute manual)
                </div>
              </div>
              
              <button onClick={processZip} disabled={!zipFile || processing}
                style={{
                  marginTop:20, width:'100%', padding:'14px', fontSize:15, fontWeight:800,
                  background: zipFile ? G.logistica : G.dim, color:'#000',
                  border:'none', borderRadius:10,
                  cursor: zipFile && !processing ? 'pointer' : 'not-allowed',
                }}>
                {processing ? 'Procesare...' : '🚀 Începe import'}
              </button>
            </div>
          )}
          
          {/* STEP 2: PROCESSING */}
          {step === 2 && (
            <div style={{textAlign:'center', padding:'60px 20px'}}>
              <div style={{fontSize:50, marginBottom:20}}>⏳</div>
              <div style={{fontSize:16, fontWeight:700, color:G.text, marginBottom:12}}>
                Procesare în curs...
              </div>
              <div style={{fontSize:13, color:G.muted}}>{progress}</div>
            </div>
          )}
          
          {/* STEP 3: REVIEW MATCHES */}
          {step === 3 && (
            <div>
              {/* Stats */}
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:12
              }}>
                {[
                  { label:'Mesaje noi parsate', val: parsedMessages.length, color: G.blue },
                  { label:'Alimentări Rompetrol fără șantier', val: alimentariFaraSantier.length, color: G.muted },
                  { label:'Match-uri găsite', val: matches.length, color: G.green },
                  { label:'Confirmate', val: confirmed.size, color: G.logistica },
                ].map((s, i) => (
                  <div key={i} style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                    padding:14, textAlign:'center'
                  }}>
                    <div style={{fontSize:22, fontWeight:900, color:s.color}}>{s.val}</div>
                    <div style={{fontSize:11, color:G.muted, marginTop:4}}>{s.label}</div>
                  </div>
                ))}
              </div>
              
              {/* 25.05.2026 — Badge Backfill poze (dual-mode) */}
              {backfillStats.checked > 0 && (
                <div style={{
                  background:'#25D36622', border:`1px solid #25D36655`, borderRadius:10,
                  padding:'10px 14px', marginBottom:16, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'
                }}>
                  <span style={{fontSize:18}}>📷</span>
                  <span style={{fontSize:12, color:G.text, fontWeight:700}}>Backfill poze pe alimentări procesate anterior:</span>
                  <span style={{fontSize:12, color:G.green, fontWeight:800}}>✅ {backfillStats.uploaded} uploaded</span>
                  {backfillStats.skipped > 0 && <span style={{fontSize:11, color:G.muted}}>· {backfillStats.skipped} skip (deja au poza sau nu matchează BD)</span>}
                  {backfillStats.errors > 0 && <span style={{fontSize:11, color:G.red, fontWeight:700}}>· {backfillStats.errors} erori</span>}
                  <span style={{fontSize:10, color:G.muted, marginLeft:'auto'}}>pregătit pentru OCR ✨</span>
                </div>
              )}
              
              {/* 25.05.2026: BANNER ROȘU DETALII ERORI BACKFILL - vizibil în Step 3 */}
              {backfillErrors.length > 0 && (
                <div style={{
                  background:G.red+'22', border:`1px solid ${G.red}`, borderRadius:10,
                  padding:'12px 16px', marginBottom:16,
                }}>
                  <div style={{fontSize:13, color:G.red, fontWeight:800, marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                    ⚠️ {backfillErrors.length} {backfillErrors.length === 1 ? 'eroare' : 'erori'} la backfill poze 
                    <span style={{fontSize:11, color:G.muted, fontWeight:500}}>(alimentări cu sursa='whatsapp' care nu au primit poza din arhivă)</span>
                  </div>
                  <div style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                    maxHeight:240, overflow:'auto', fontSize:11, fontFamily:'monospace',
                  }}>
                    <table style={{width:'100%', borderCollapse:'collapse'}}>
                      <thead style={{position:'sticky', top:0, background:G.surface}}>
                        <tr>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>ALIM</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>PLĂCUȚA</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>AUTOR · DATA</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>FIȘIER IMG</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>MOTIV</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>DETALIU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backfillErrors.map((e, i) => (
                          <tr key={i} style={{borderTop:`1px solid ${G.border}66`}}>
                            <td style={{padding:'6px 10px', color:G.text}}>#{e.alim_id}</td>
                            <td style={{padding:'6px 10px', color:G.blue, fontWeight:700}}>{e.plac}</td>
                            <td style={{padding:'6px 10px', color:G.muted, maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.autor + ' · ' + e.data}>
                              {e.autor} · {e.data}
                            </td>
                            <td style={{padding:'6px 10px', color:G.muted, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.imageFile}>
                              {e.imageFile || '—'}
                            </td>
                            <td style={{padding:'6px 10px', color:G.red, fontWeight:700}}>{e.reason}</td>
                            <td style={{padding:'6px 10px', color:G.muted, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.detail}>
                              {e.detail || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{marginTop:10, fontSize:11, color:G.muted, lineHeight:1.6}}>
                    💡 <strong>reason</strong>: <code>not_in_zip</code>=fișier inexistent în arhivă (foarte probabil — pozele au fost șterse din telefon înainte de export) · <code>upload_error</code>=RLS storage policy · <code>update_error</code>=BD UPDATE eșuat
                  </div>
                </div>
              )}
              
              {/* Info poze noi pentru match-uri confirmate */}
              {(() => {
                const cuPoza = matches.filter(m => confirmed.has(m.alim.id) && m.msg.imageFile).length
                if (cuPoza === 0) return null
                return (
                  <div style={{
                    background: G.bg, border:`1px dashed #25D36655`, borderRadius:8,
                    padding:'8px 12px', marginBottom:14, fontSize:11, color:G.muted
                  }}>
                    📷 La salvare vom uploada și <strong style={{color:'#25D366'}}>{cuPoza} poze noi</strong> de bonuri pentru ANAF + Vision OCR.
                  </div>
                )
              })()}
              
              {matches.length === 0 ? (
                (() => {
                  const orphanCount = parsedMessages.filter(m => m.imageFile && !m.parsed?.vehicle).length
                  return (
                    <div style={{
                      padding:30, textAlign:'center', background:G.bg, 
                      borderRadius:10, border:`1px solid ${G.border}`
                    }}>
                      <div style={{fontSize:50, marginBottom:14}}>{orphanCount > 0 ? '🤖' : '🤷'}</div>
                      <div style={{fontSize:15, color:G.text, fontWeight:700, marginBottom:12}}>
                        {orphanCount > 0 
                          ? `${orphanCount} poze orfane găsite - gata pentru AI`
                          : 'Niciun match direct găsit pentru această perioadă'}
                      </div>
                      <div style={{fontSize:12, color:G.muted, lineHeight:1.7, maxWidth:550, margin:'0 auto'}}>
                        {orphanCount > 0 ? (
                          <>
                            Aceste mesaje au poze (bonuri / spate mașini) dar caption-ul nu identifică plăcuța.<br/>
                            Apasă <strong style={{color:G.green}}>💾 Salvez {orphanCount} poze orfane</strong> ca să le salvăm în BD pentru procesare AI.<br/>
                            Apoi rulezi <code style={{background:G.surface, padding:'2px 6px', borderRadius:4, color:G.blue}}>detect_plate_orphan_msgs</code> care identifică automat plăcuțele cu Vision OCR.
                          </>
                        ) : (
                          <>
                            Posibile motive: mesajele din arhivă nu menționează plăcuțele auto ale<br/>
                            alimentărilor Rompetrol din BD, SAU mesajele sunt din altă perioadă.<br/>
                            Pentru istoricul mai 2026, va trebui editare manuală pe alimentări.
                          </>
                        )}
                      </div>
                    </div>
                  )
                })()
              ) : (
                <div style={{maxHeight:'45vh', overflow:'auto', border:`1px solid ${G.border}`, borderRadius:10}}>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                    <thead style={{background:G.bg, position:'sticky', top:0, zIndex:1}}>
                      <tr>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`, width:30}}>✓</th>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`}}>Data alim.</th>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`}}>Vehicul</th>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`}}>Litri</th>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`}}>→ Șantier</th>
                        <th style={{padding:8, textAlign:'left', borderBottom:`1px solid ${G.border}`}}>Sursă caption</th>
                        <th style={{padding:8, textAlign:'center', borderBottom:`1px solid ${G.border}`}}>Scor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map(m => {
                        const isConf = confirmed.has(m.alim.id)
                        return (
                          <tr key={m.alim.id} style={{
                            background: isConf ? G.green+'11' : 'transparent',
                            borderBottom:`1px solid ${G.border}`
                          }}>
                            <td style={{padding:8}}>
                              <input type="checkbox" checked={isConf}
                                onChange={() => {
                                  const newSet = new Set(confirmed)
                                  if (isConf) newSet.delete(m.alim.id)
                                  else newSet.add(m.alim.id)
                                  setConfirmed(newSet)
                                }} />
                            </td>
                            <td style={{padding:8, color:G.muted, fontSize:11}}>
                              {new Date(m.alim.data_alimentare).toLocaleDateString('ro-RO')}
                            </td>
                            <td style={{padding:8, color:G.text, fontWeight:600}}>
                              {m.alim.marca} {m.alim.nr_inmatriculare}
                            </td>
                            <td style={{padding:8, color:G.orange, fontWeight:700}}>
                              {parseFloat(m.alim.cantitate_litri).toFixed(1)}L
                            </td>
                            <td style={{padding:8}}>
                              <span style={{
                                padding:'3px 8px', background:G.logistica+'22', color:G.logistica,
                                borderRadius:6, fontWeight:700, fontSize:11
                              }}>{m.site.name}</span>
                            </td>
                            <td style={{padding:8, color:G.dim, fontSize:11, maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                              <span style={{color:G.blue}}>{m.msg.author}:</span> {m.msg.caption.slice(0, 60)}
                            </td>
                            <td style={{padding:8, textAlign:'center'}}>
                              <span style={{
                                color: m.msg.parsed?.score >= 0.9 ? G.green : G.yellow,
                                fontWeight:700
                              }}>
                                {Math.round((m.msg.parsed?.score || 0) * 100)}%
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              
              <div style={{display:'flex', gap:10, marginTop:20, justifyContent:'flex-end'}}>
                <button onClick={onClose} style={{
                  padding:'10px 22px', background:G.surface, color:G.text,
                  border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600
                }}>Anulează</button>
                {/* 26.05.2026 FIX B: permite click chiar fara confirmari, daca exista mesaje cu poze orfane (vor fi salvate ca pending_plate_detection) */}
                {(() => {
                  const orphanCount = parsedMessages.filter(m => m.imageFile && !m.parsed?.vehicle).length
                  const canApply = confirmed.size > 0 || orphanCount > 0
                  const labelText = processing 
                    ? 'Salvez...' 
                    : confirmed.size > 0 
                      ? `✅ Aplic ${confirmed.size} alocări${orphanCount > 0 ? ` + ${orphanCount} poze orfane` : ''}`
                      : `💾 Salvez ${orphanCount} poze orfane pentru AI`
                  return (
                    <button onClick={applyMatches} disabled={!canApply || processing}
                      style={{
                        padding:'10px 22px', 
                        background: canApply ? G.green : G.dim, color:'#fff',
                        border:'none', borderRadius:8, fontSize:13, fontWeight:700,
                        cursor: canApply ? 'pointer' : 'not-allowed'
                      }}>
                      {labelText}
                    </button>
                  )
                })()}
              </div>
            </div>
          )}
          
          {/* STEP 4: DONE */}
          {step === 4 && (
            <div style={{textAlign:'center', padding:'60px 20px'}}>
              <div style={{fontSize:60, marginBottom:20}}>🎉</div>
              <div style={{fontSize:18, fontWeight:800, color:G.green, marginBottom:10}}>
                Import finalizat cu succes!
              </div>
              <div style={{fontSize:13, color:G.muted, marginBottom:20, lineHeight:1.6}}>
                {confirmed.size} alimentări au primit șantier alocat din WhatsApp.<br/>
                Audit log salvat pentru ANAF.
              </div>
              
              {/* 25.05.2026: Stats poze upload */}
              {(pozeUploadedNew > 0 || backfillStats.uploaded > 0) && (
                <div style={{
                  background:'#25D36622', border:`1px solid #25D36655`, borderRadius:10,
                  padding:'14px 18px', marginBottom:24, display:'inline-block', textAlign:'left',
                  maxWidth:520
                }}>
                  <div style={{fontSize:13, color:G.text, fontWeight:700, marginBottom:8}}>📷 Poze bonuri uploadate:</div>
                  <div style={{fontSize:12, color:G.muted, lineHeight:1.7}}>
                    {pozeUploadedNew > 0 && <div>✅ <strong style={{color:'#25D366'}}>{pozeUploadedNew} poze noi</strong> (pe match-urile alocate acum)</div>}
                    {backfillStats.uploaded > 0 && <div>♻️ <strong style={{color:'#25D366'}}>{backfillStats.uploaded} poze backfill</strong> (pe alimentări procesate anterior)</div>}
                    <div style={{marginTop:6, fontSize:11, color:G.dim}}>
                      → gata pentru validare Vision OCR (butonul 🔍 din header Alimentări)
                    </div>
                  </div>
                </div>
              )}
              
              {/* 25.05.2026: BANNER ERORI UPLOAD - vizibil pentru debugging */}
              {uploadErrors.length > 0 && (
                <div style={{
                  background:G.red+'22', border:`1px solid ${G.red}`, borderRadius:10,
                  padding:'14px 18px', marginBottom:24, textAlign:'left',
                  maxWidth:720, margin:'0 auto 24px',
                }}>
                  <div style={{fontSize:14, color:G.red, fontWeight:800, marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                    ⚠️ {uploadErrors.length} {uploadErrors.length === 1 ? 'eroare' : 'erori'} la upload poze 
                    <span style={{fontSize:11, color:G.muted, fontWeight:500}}>(alocările s-au făcut, dar pozele NU au ajuns în bucket)</span>
                  </div>
                  <div style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                    maxHeight:200, overflow:'auto', fontSize:11, fontFamily:'monospace',
                  }}>
                    <table style={{width:'100%', borderCollapse:'collapse'}}>
                      <thead style={{position:'sticky', top:0, background:G.surface}}>
                        <tr>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>ALIM</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>PLĂCUȚA</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>FIȘIER</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>MOTIV</th>
                          <th style={{padding:'6px 10px', textAlign:'left', color:G.muted, fontSize:10}}>DETALIU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadErrors.map((e, i) => (
                          <tr key={i} style={{borderTop:`1px solid ${G.border}66`}}>
                            <td style={{padding:'6px 10px', color:G.text}}>#{e.alim_id}</td>
                            <td style={{padding:'6px 10px', color:G.blue}}>{e.plac}</td>
                            <td style={{padding:'6px 10px', color:G.muted, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.imageFile}>
                              {e.imageFile || '—'}
                            </td>
                            <td style={{padding:'6px 10px', color:G.red, fontWeight:700}}>{e.reason}</td>
                            <td style={{padding:'6px 10px', color:G.muted, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={e.detail}>
                              {e.detail || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{marginTop:10, fontSize:11, color:G.muted, lineHeight:1.6}}>
                    💡 <strong>reason</strong>: <code>no_zip</code>=zipInstance null · <code>no_image</code>=msg fără imageFile · <code>not_in_zip</code>=fișier inexistent în zip · <code>upload_error</code>=storage policy/RLS · <code>update_error</code>=BD UPDATE eșuat
                  </div>
                  <div style={{marginTop:6, fontSize:11, color:G.dim, fontStyle:'italic'}}>
                    Trimite captura de ecran la dev. Alimentările alocate fără poză vor fi re-prinse la următorul import via backfill.
                  </div>
                </div>
              )}
              
              <div>
                {/* 26.05.2026 FIX B: BUTON AI VISION - vizibil daca exista poze pending */}
                {pendingPlateCount > 0 && !aiResults && (
                  <div style={{
                    background: G.purple+'18', border:`2px solid ${G.purple}66`, borderRadius:14,
                    padding:'20px 24px', marginBottom:20, maxWidth:600, margin:'0 auto 20px',
                    textAlign:'center'
                  }}>
                    <div style={{fontSize:14, fontWeight:800, color:G.purple, marginBottom:6}}>
                      🤖 {pendingPlateCount} poze orfane gata pentru AI
                    </div>
                    <div style={{fontSize:12, color:G.muted, marginBottom:14, lineHeight:1.6}}>
                      Vision OCR (Haiku 4.5) va identifica plăcuțele auto din poze și va face match cu alimentările fără șantier.
                      <br/>
                      Estimat: ~${(pendingPlateCount * 0.0035).toFixed(2)} cost · ~{Math.ceil(pendingPlateCount/30)*30}sec timp.
                    </div>
                    <button 
                      onClick={processOrphansWithAI} 
                      disabled={aiProcessing}
                      style={{
                        padding:'12px 28px', 
                        background: aiProcessing ? G.dim : G.purple, 
                        color:'#fff',
                        border:'none', borderRadius:10, fontSize:14, fontWeight:800,
                        cursor: aiProcessing ? 'wait' : 'pointer',
                        boxShadow: aiProcessing ? 'none' : `0 4px 12px ${G.purple}55`,
                      }}>
                      {aiProcessing ? '⏳ Procesez...' : `🤖 Identifică plăcuțele cu AI (${pendingPlateCount})`}
                    </button>
                    {aiProgress && (
                      <div style={{
                        marginTop:12, padding:'8px 14px', background:G.bg, borderRadius:8,
                        fontSize:11, fontFamily:'monospace', color:G.text
                      }}>
                        {aiProgress}
                      </div>
                    )}
                  </div>
                )}
                
                {/* 26.05.2026 FIX B: REZULTATE AI - vizibil dupa procesare */}
                {aiResults && (
                  <div style={{
                    background: G.green+'18', border:`2px solid ${G.green}66`, borderRadius:14,
                    padding:'20px 24px', marginBottom:20, maxWidth:600, margin:'0 auto 20px',
                    textAlign:'left'
                  }}>
                    <div style={{fontSize:14, fontWeight:800, color:G.green, marginBottom:12, textAlign:'center'}}>
                      🎯 AI Vision a terminat - {aiResults.batches} batch-uri rulate
                    </div>
                    <div style={{
                      display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:10, fontSize:12, color:G.muted, marginBottom:12
                    }}>
                      <div>📷 <strong style={{color:G.text}}>{aiResults.total}</strong> poze procesate</div>
                      <div>🔢 <strong style={{color:G.blue}}>{aiResults.plates_detected}</strong> plăcuțe identificate</div>
                      <div>✅ <strong style={{color:G.green}}>{aiResults.matched}</strong> match-uri cu alimentări</div>
                      <div>💸 <strong style={{color:G.text}}>${aiResults.cost_usd.toFixed(4)}</strong> cost total</div>
                    </div>
                    {aiResults.errors > 0 && (
                      <div style={{fontSize:11, color:G.red, marginBottom:8}}>
                        ⚠️ {aiResults.errors} erori la procesare (ilizibil / format Vision)
                      </div>
                    )}
                    <div style={{fontSize:11, color:G.dim, fontStyle:'italic', textAlign:'center', marginTop:8}}>
                      Alimentările match-uite au primit automat şantier + poză + intră la OCR Vision pentru validare cifre.
                    </div>
                  </div>
                )}
                
                <button onClick={onClose} style={{
                  padding:'12px 30px', background:G.logistica, color:'#000',
                  border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer'
                }}>Închide</button>
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  )
}
