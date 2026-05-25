// ImportWhatsAppModal.jsx
// 25.05.2026 - Import .zip WhatsApp grup motorină + match Rompetrol
// Parser hibrid: format strict v2 (după 26.05) + fallback tolerant (mai 2026 istoric)
// Pentru ANAF: stochează caption + autor + timestamp + poza bon ca dovadă auditabilă

import { useState, useRef, useMemo, useCallback } from 'react'
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

// Parser linii WhatsApp text
function parseWhatsAppText(text) {
  const datePat = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}) - /
  const lines = text.split('\n')
  const messages = []
  let current = null
  
  for (const line of lines) {
    if (datePat.test(line)) {
      if (current) messages.push(current)
      const m = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}) - ([^:]+?): (.*)$/)
      if (m) {
        current = {
          date: m[1], time: m[2],
          author: m[3].trim(),
          text: m[4], extraLines: []
        }
      } else current = null
    } else if (current) {
      current.extraLines.push(line)
    }
  }
  if (current) messages.push(current)
  
  // Combinez și extrag nume imagine
  for (const m of messages) {
    const full = m.text + (m.extraLines.length ? '\n' + m.extraLines.join('\n') : '')
    // Detect imagine atașată
    const imgMatch = full.match(/IMG-[\w-]+\.jpg/)
    m.imageFile = imgMatch ? imgMatch[0] : null
    m.caption = full
      .replace(/IMG-[\w-]+\.jpg \(file attached\)/, '')
      .replace(/<Media omitted>/, '')
      .trim()
    
    // Parse data WhatsApp (M/D/YY HH:MM)
    try {
      const parts = m.date.split('/')
      let year = parseInt(parts[2], 10)
      if (year < 100) year += 2000  // YY → 20YY
      const month = parseInt(parts[0], 10) - 1
      const day = parseInt(parts[1], 10)
      const [hh, mm] = m.time.split(':').map(x => parseInt(x, 10))
      m.dt = new Date(year, month, day, hh, mm)
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
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState('')
  const [parsedMessages, setParsedMessages] = useState([])
  const [sites, setSites] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [alimentariFaraSantier, setAlimentariFaraSantier] = useState([])
  const [matches, setMatches] = useState([])  // rezultat match
  const [dateRangeFilter, setDateRangeFilter] = useState({ start: '2026-05-01', end: '' })
  const [confirmed, setConfirmed] = useState(new Set())  // ID-uri match-uri confirmate
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
      
      // 6. Doar mesaje cu caption non-empty (filtru basic)
      messages = messages.filter(m => m.caption && m.caption.length > 3)
      
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
          if (diffH > 36) continue
          
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
      let errors = []
      
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
        else updated++
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
      })
      
      // Salvez hash-urile mesajelor procesate (anti-dedup viitor)
      const toSaveHashes = parsedMessages.map(m => ({
        msg_hash: m.hash,
        msg_dt: m.dt.toISOString(),
        autor: m.author,
        caption_preview: (m.caption || '').slice(0, 200),
        status: matches.find(x => x.msg === m) ? 
          (confirmed.has(matches.find(x => x.msg === m).alim.id) ? 'matched' : 'ambig') : 'no_match',
      }))
      
      // Upsert hashes (în batches de 100)
      for (let i = 0; i < toSaveHashes.length; i += 100) {
        await supabase.from('whatsapp_messages_processed').upsert(
          toSaveHashes.slice(i, i + 100),
          { onConflict: 'msg_hash', ignoreDuplicates: true }
        )
      }
      
      if (errors.length === 0) {
        showToast(`✅ ${updated} alimentări actualizate cu succes!`, 'success')
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
  }, [matches, confirmed, profile, zipFile, parsedMessages, alimentariFaraSantier, dateRangeFilter, onImported, showToast])
  
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
                display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:20
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
              
              {matches.length === 0 ? (
                <div style={{
                  padding:40, textAlign:'center', background:G.bg, 
                  borderRadius:10, border:`1px solid ${G.border}`
                }}>
                  <div style={{fontSize:50, marginBottom:14}}>🤷</div>
                  <div style={{fontSize:15, color:G.text, fontWeight:700}}>
                    Niciun match găsit pentru această perioadă
                  </div>
                  <div style={{fontSize:12, color:G.muted, marginTop:10, lineHeight:1.6}}>
                    Posibile motive: mesajele din arhivă nu menționează plăcuțele auto ale<br/>
                    alimentărilor Rompetrol din BD, SAU mesajele sunt din altă perioadă.<br/>
                    Pentru istoricul mai 2026, va trebui editare manuală pe alimentări.
                  </div>
                </div>
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
                <button onClick={applyMatches} disabled={confirmed.size === 0 || processing}
                  style={{
                    padding:'10px 22px', background: confirmed.size ? G.green : G.dim, color:'#fff',
                    border:'none', borderRadius:8, fontSize:13, fontWeight:700,
                    cursor: confirmed.size ? 'pointer' : 'not-allowed'
                  }}>
                  {processing ? 'Salvez...' : `✅ Aplic ${confirmed.size} alocări`}
                </button>
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
              <div style={{fontSize:13, color:G.muted, marginBottom:30, lineHeight:1.6}}>
                {confirmed.size} alimentări au primit șantier alocat din WhatsApp.<br/>
                Audit log salvat pentru ANAF.
              </div>
              <button onClick={onClose} style={{
                padding:'12px 30px', background:G.logistica, color:'#000',
                border:'none', borderRadius:10, fontSize:14, fontWeight:800, cursor:'pointer'
              }}>Închide</button>
            </div>
          )}
          
        </div>
      </div>
    </div>
  )
}
