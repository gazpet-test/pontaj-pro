// ════════════════════════════════════════════════════════════════════════════
// TabScannerDocumenteHR.jsx — Scanner AI Documente HR (Etapa 12, 18.05.2026)
// ════════════════════════════════════════════════════════════════════════════
// Tab nou în HR (lângă Salarii) pentru scanare automată documente personale:
// Buletin, Pașaport, Permis Conducere.
//
// AI Vision (Claude Sonnet 4.5) detectează:
//   - Tip document (mapare la hr_documente_personale_tipuri)
//   - Nume complet angajat (fuzzy match → employees)
//   - Date emitere/expirare/emitent/număr
//
// NU extrage CNP (privacy GDPR strict, enforced server-side).
//
// Pentru Avize Medical / ISCIR / Permise profesionale → folosește tab Autorizații
// (acelea NU au fisier_path în BD curentă, refactor separat necesar).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100',
}

const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'10px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'10px 18px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}

const BUCKET = 'documente-personal'

// ============================================================================
// HELPERS
// ============================================================================

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritice
    .replace(/[^a-z0-9]/g, ' ').trim()
}

function fuzzyMatchEmployee(numeAI, employees) {
  if (!numeAI || !employees?.length) return null
  const target = normalize(numeAI)
  if (!target) return null

  // 1. Match exact (norm)
  let best = employees.find(e => normalize(e.name) === target)
  if (best) return best

  // 2. Match parțial — token overlap (≥2 tokens potriviți)
  const targetTokens = target.split(/\s+/).filter(t => t.length > 2)
  if (targetTokens.length < 2) return null

  const scored = employees.map(emp => {
    const empTokens = normalize(emp.name).split(/\s+/).filter(t => t.length > 2)
    const matches = targetTokens.filter(t =>
      empTokens.some(et => et === t || et.includes(t) || t.includes(et))
    ).length
    return { emp, score: matches }
  }).filter(x => x.score >= 2)

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.emp || null
}

function fuzzyMatchTip(tipAI, tipuri) {
  if (!tipAI || !tipuri?.length) return null
  const target = normalize(tipAI)

  // Mapare directă pe baza AI output
  const direct = {
    'buletin': 'buletin',
    'carte de identitate': 'buletin',
    'ci': 'buletin',
    'pasaport': 'pasaport',
    'passport': 'pasaport',
    'permis conducere': 'permis_conducere',
    'permis de conducere': 'permis_conducere',
  }

  for (const [key, cod] of Object.entries(direct)) {
    if (target.includes(key)) {
      const found = tipuri.find(t => t.cod === cod)
      if (found) return found
    }
  }

  // Match denumire
  return tipuri.find(t => normalize(t.denumire).includes(target)) || null
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const idx = result.indexOf(',')
        resolve(idx >= 0 ? result.substring(idx + 1) : result)
      } else { reject(new Error('FileReader did not return string')) }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Resize automat pentru imagini > 2 MB (Anthropic Vision are limita 5 MB pe imagini)
async function resizeImageToBlob(file, maxSide = 2048, quality = 0.85, sizeThreshold = 2 * 1024 * 1024) {
  if (!file.type.startsWith('image/')) return file
  if (file.size < sizeThreshold) return file

  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('Imagine invalida'))
    im.src = URL.createObjectURL(file)
  })

  let w = img.naturalWidth, h = img.naturalHeight
  if (w > maxSide || h > maxSide) {
    if (w > h) { h = Math.round(h * maxSide / w); w = maxSide }
    else      { w = Math.round(w * maxSide / h); h = maxSide }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  URL.revokeObjectURL(img.src)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Canvas toBlob failed')); return }
      const newName = file.name.replace(/\.[^.]+$/, '.jpg')
      resolve(new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() }))
    }, 'image/jpeg', quality)
  })
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB'
  return (n/1024/1024).toFixed(1) + ' MB'
}

function genStoragePath(employeeId, tipCod, fileName) {
  const ext = fileName.split('.').pop().toLowerCase()
  const today = new Date().toISOString().split('T')[0]
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${employeeId}/${tipCod}/${today}_${uuid}.${ext}`
}

// ============================================================================
// SUBCOMPONENTE
// ============================================================================

function ConfidenceBar({ pct }) {
  const safe = Math.max(0, Math.min(100, pct || 0))
  const color = safe >= 85 ? G.green : safe >= 70 ? G.yellow : G.red
  const label = safe >= 85 ? 'Încredere mare' : safe >= 70 ? 'Încredere medie' : 'Încredere mică'
  return (
    <div style={{display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
      background:color+'15', border:`1px solid ${color}55`, borderRadius:8, marginBottom:14}}>
      <div style={{fontSize:20}}>{safe >= 85 ? '✅' : safe >= 70 ? '⚠️' : '❌'}</div>
      <div style={{flex:1}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
          <span style={{fontSize:12, color:G.text, fontWeight:600}}>{label} ({safe}%)</span>
          {safe < 70 && <span style={{fontSize:10, color:G.muted}}>Verifică datele atent</span>}
        </div>
        <div style={{height:6, background:G.bg, borderRadius:3, overflow:'hidden'}}>
          <div style={{width:`${safe}%`, height:'100%', background:color, transition:'width .3s'}} />
        </div>
      </div>
    </div>
  )
}

function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const cameraRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          padding:40, textAlign:'center', cursor:'pointer',
          background: dragging ? G.hr+'20' : G.bg,
          border:`2px dashed ${dragging ? G.hr : G.border2}`,
          borderRadius:12, transition:'all .15s',
        }}>
        <div style={{fontSize:48, marginBottom:8}}>📷</div>
        <div style={{fontSize:14, color:G.text, fontWeight:600, marginBottom:6}}>
          {dragging ? 'Eliberează aici!' : 'Click sau drag&drop document'}
        </div>
        <div style={{fontSize:11, color:G.muted}}>Imagini (JPG/PNG/WEBP, auto-resize la 2048px) sau PDF · max 15MB</div>
      </div>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{display:'none'}} onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        style={{display:'none'}} onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />

      <button onClick={() => cameraRef.current?.click()}
        style={{ padding:'12px', width:'100%', marginTop:10, background:G.green+'22',
          color:G.green, border:`1px solid ${G.green}55`, borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer' }}>
        📸 Folosește camera (mobil)
      </button>
    </>
  )
}

// ============================================================================
// MODAL SCANNER HR
// ============================================================================

function ScannerHRModal({ onClose, profile, employees, showToast, onSaved }) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [propunere, setPropunere] = useState(null)
  const [meta, setMeta] = useState(null)

  const [tipuri, setTipuri] = useState([])
  const [loadingTipuri, setLoadingTipuri] = useState(true)
  const [warningTipNesuportat, setWarningTipNesuportat] = useState(null)

  const [form, setForm] = useState({
    employee_id: '',
    tip_id: '',
    data_emitere: '',
    data_expirare: '',
    emitent: '',
    numar_document: '',
    fara_expirare: false,
    observatii: '',
  })

  // Încarcă tipuri documente personale
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('hr_documente_personale_tipuri')
        .select('id, cod, denumire, categorie, are_expirare')
        .eq('activ', true)
        .order('ordine', { nullsFirst: false })
      if (cancelled) return
      if (error) showToast('Eroare tipuri: ' + error.message, 'error')
      setTipuri(data || [])
      setLoadingTipuri(false)
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup preview URL
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  const tipSelectat = useMemo(() => tipuri.find(t => t.id === Number(form.tip_id)), [tipuri, form.tip_id])
  const empSelectat = useMemo(() => employees.find(e => e.id === Number(form.employee_id)), [employees, form.employee_id])

  const handleFile = (f) => {
    if (!f) return
    if (f.size > 15 * 1024 * 1024) {
      showToast(`Fișier prea mare (${fmtBytes(f.size)}). Max 15 MB.`, 'error')
      return
    }
    const accepted = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!accepted.includes(f.type)) {
      showToast(`Tip fișier nesuportat: ${f.type}. Accept: JPG, PNG, WEBP, PDF.`, 'error')
      return
    }
    setFile(f)
    if (f.type.startsWith('image/')) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(f))
    } else {
      setPreviewUrl(null)
    }
  }

  const sendToAI = async () => {
    if (!file) return
    setStep(2)
    setWarningTipNesuportat(null)

    try {
      // Resize automat daca e imagine mare
      let fileToSend = file
      if (file.type.startsWith('image/') && file.size > 2 * 1024 * 1024) {
        try {
          fileToSend = await resizeImageToBlob(file, 2048, 0.85)
          console.log(`[scan-hr] Resized: ${(file.size/1024/1024).toFixed(1)}MB -> ${(fileToSend.size/1024/1024).toFixed(1)}MB`)
        } catch (e) {
          console.warn('[scan-hr] Resize fail:', e)
        }
      }

      const b64 = await fileToBase64(fileToSend)
      const { data, error } = await supabase.functions.invoke('scan-document', {
        body: {
          file_base64: b64,
          mime_type: fileToSend.type,
          module: 'hr_general',
        }
      })

      if (error) throw error
      if (data?.error) throw new Error(data.message || data.error)
      if (!data?.propunere) throw new Error('Răspuns AI invalid')

      setPropunere(data.propunere)
      setMeta(data.meta || null)

      // Auto-match angajat + tip
      const emp = fuzzyMatchEmployee(data.propunere.nume_complet, employees)
      const tip = fuzzyMatchTip(data.propunere.tip_document, tipuri)

      // Verific dacă tipul detectat NU e suportat în BD documente personale
      const tipDetectat = data.propunere.tip_document
      const tipuriSuportate = ['Buletin', 'Pasaport', 'Pașaport', 'Permis conducere', 'Permis de conducere']
      const tipUnsuported = !tip && tipDetectat &&
        !tipuriSuportate.some(t => normalize(tipDetectat).includes(normalize(t)))

      if (tipUnsuported) {
        setWarningTipNesuportat(tipDetectat)
      }

      const isFaraExpirare = tip ? !tip.are_expirare : false

      setForm({
        employee_id: emp?.id || '',
        tip_id: tip?.id || '',
        data_emitere: data.propunere.data_emitere || '',
        data_expirare: isFaraExpirare ? '' : (data.propunere.data_expirare || ''),
        emitent: data.propunere.emitent || '',
        numar_document: data.propunere.numar_document || '',
        fara_expirare: isFaraExpirare,
        observatii: data.propunere.observatii || '',
      })

      setStep(3)
    } catch (e) {
      showToast('Eroare AI: ' + (e.message || 'unknown'), 'error')
      setStep(1)
    }
  }

  const handleSave = async () => {
    if (!form.employee_id) { showToast('Selectează angajatul', 'error'); return }
    if (!form.tip_id)      { showToast('Selectează tipul documentului', 'error'); return }
    if (!tipSelectat) { showToast('Tip invalid', 'error'); return }

    const tipAreExpirare = tipSelectat.are_expirare
    if (tipAreExpirare && !form.fara_expirare && !form.data_expirare) {
      showToast('Completează data expirării (sau bifează „fără expirare")', 'error')
      return
    }

    setStep(4)

    try {
      // 1. Upload fișier
      const storagePath = genStoragePath(form.employee_id, tipSelectat.cod, file.name)
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })
      if (upErr) throw new Error('Upload bucket: ' + upErr.message)

      // 2. INSERT BD
      const payload = {
        employee_id: Number(form.employee_id),
        tip_id: Number(form.tip_id),
        numar_document: form.numar_document.trim() || null,
        emitent: form.emitent.trim() || null,
        data_emitere: form.data_emitere || null,
        data_expirare: form.fara_expirare || !tipAreExpirare ? null : (form.data_expirare || null),
        fara_expirare: form.fara_expirare || !tipAreExpirare,
        fisier_path: storagePath,
        fisier_nume: file.name,
        fisier_size_bytes: file.size,
        fisier_mime: file.type,
        observatii: form.observatii.trim() || null,
        uploadat_de: profile?.id || null,
        activ: true,
      }

      const { error: insErr } = await supabase.from('hr_documente_personale').insert(payload)
      if (insErr) {
        // Rollback storage
        await supabase.storage.from(BUCKET).remove([storagePath])
        throw new Error('INSERT BD: ' + insErr.message)
      }

      // 3. Marchez scanner_log ca saved_to_db (cel mai recent)
      if (profile?.id) {
        await supabase.from('scanner_logs')
          .update({ saved_to_db: true })
          .eq('user_id', profile.id)
          .eq('module', 'hr_general')
          .eq('success', true)
          .order('created_at', { ascending: false })
          .limit(1)
      }

      showToast('✓ Document salvat cu succes!', 'success')
      onSaved?.()
      onClose()
    } catch (e) {
      showToast('Eroare la salvare: ' + (e.message || 'unknown'), 'error')
      setStep(3)
    }
  }

  const costRon = useMemo(() => {
    if (!meta?.cost_usd) return null
    return (meta.cost_usd * 5).toFixed(2)
  }, [meta])

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:10000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'min(640px, 100%)', maxHeight:'92vh', display:'flex', flexDirection:'column',
          overflow:'hidden', boxShadow:'0 25px 70px rgba(0,0,0,.7)',
        }}>

        {/* Header */}
        <div style={{
          padding:'16px 20px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:`linear-gradient(135deg, ${G.hr}22, ${G.purple}15)`,
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:700, color:G.text}}>📷 Scanner Documente HR</div>
            <div style={{fontSize:11, color:G.muted, marginTop:2}}>
              {step === 1 && 'Pasul 1/3 · Selectează documentul'}
              {step === 2 && 'Pasul 2/3 · AI procesează…'}
              {step === 3 && 'Pasul 3/3 · Verifică și confirmă'}
              {step === 4 && 'Se salvează…'}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:'transparent', border:'none', color:G.muted, fontSize:24, cursor:'pointer', lineHeight:1}}>×</button>
        </div>

        {/* Body */}
        <div style={{flex:1, overflowY:'auto', padding:20}}>

          {/* STEP 1 */}
          {step === 1 && (
            <>
              {!file && (
                <>
                  <div style={{padding:12, background:G.blue+'11', border:`1px solid ${G.blue}44`, borderRadius:8, fontSize:11, color:G.text, marginBottom:14}}>
                    💡 <b>AI detectează automat:</b> Buletin, Pașaport, Permis Conducere · nume angajat (fuzzy match) · date emitere/expirare. <b style={{color:G.red}}>CNP-ul NU se extrage</b> (privacy GDPR).
                  </div>
                  <DropZone onFile={handleFile} />
                </>
              )}

              {file && (
                <div>
                  <div style={{display:'flex', gap:14, alignItems:'flex-start', marginBottom:14}}>
                    {previewUrl ? (
                      <img src={previewUrl} alt="preview"
                        style={{width:160, height:160, objectFit:'cover', borderRadius:8, border:`1px solid ${G.border2}`}} />
                    ) : (
                      <div style={{width:160, height:160, background:G.bg, border:`1px solid ${G.border2}`,
                        borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:40}}>📄</div>
                    )}
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, color:G.text, fontWeight:600, wordBreak:'break-word'}}>{file.name}</div>
                      <div style={{fontSize:11, color:G.muted, marginTop:4}}>{file.type} · {fmtBytes(file.size)}</div>
                      <button
                        onClick={() => { setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
                        style={{...S.btnS, marginTop:10, padding:'6px 12px', fontSize:11, color:G.red, borderColor:G.red+'66'}}>
                        ✕ Schimbă fișierul
                      </button>
                    </div>
                  </div>

                  <button onClick={sendToAI} disabled={loadingTipuri}
                    style={{
                      width:'100%', padding:'14px', fontSize:15, fontWeight:600,
                      background:G.hr, color:'#fff', border:'none', borderRadius:8,
                      opacity: loadingTipuri ? 0.6 : 1,
                      cursor: loadingTipuri ? 'not-allowed' : 'pointer',
                    }}>
                    {loadingTipuri ? '⏳ Se încarcă datele…' : '🪄 Trimite la AI pentru analiză'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div style={{padding:60, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:16, animation:'spinHR 2s linear infinite'}}>🤖</div>
              <div style={{fontSize:16, color:G.text, fontWeight:600, marginBottom:8}}>AI analizează documentul…</div>
              <div style={{fontSize:12, color:G.muted}}>Durează de obicei 3-8 secunde</div>
              <style>{'@keyframes spinHR{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && propunere && (
            <div>
              <ConfidenceBar pct={propunere.confidence_pct} />

              {warningTipNesuportat && (
                <div style={{padding:'10px 14px', background:G.orange+'15', border:`1px solid ${G.orange}55`,
                  borderRadius:8, marginBottom:14, fontSize:12, color:G.text}}>
                  ⚠️ AI a detectat <b>„{warningTipNesuportat}"</b> care NU se salvează în Documente Personale.
                  Pentru avize medicale / atestate, folosește tab-ul <b>Autorizații</b> pentru adăugare manuală.
                  Poți totuși să-l salvezi aici ca <b>„ALTUL"</b> dacă vrei.
                </div>
              )}

              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
                {/* Angajat */}
                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    👤 Angajat {propunere.nume_complet && <span style={{color:G.green}}>· detectat: <code>{propunere.nume_complet}</code></span>}
                  </label>
                  <select value={form.employee_id}
                    onChange={(e) => setForm(f => ({...f, employee_id: e.target.value}))}
                    style={{...S.input, borderColor: form.employee_id ? G.green+'77' : G.red+'77'}}>
                    <option value="">— Selectează angajat —</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name} {e.functie ? `· ${e.functie}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tip + Nr document */}
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    📄 Tip {propunere.tip_document && <span style={{color:G.green}}>· detectat: <code>{propunere.tip_document}</code></span>}
                  </label>
                  <select value={form.tip_id}
                    onChange={(e) => {
                      const newTipId = e.target.value
                      const newTip = tipuri.find(t => t.id === Number(newTipId))
                      setForm(f => ({...f, tip_id: newTipId, fara_expirare: newTip ? !newTip.are_expirare : false}))
                    }}
                    style={{...S.input, borderColor: form.tip_id ? G.green+'77' : G.red+'77'}}>
                    <option value="">— Selectează tipul —</option>
                    {tipuri.map(t => <option key={t.id} value={t.id}>{t.denumire}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>🔢 Număr document</label>
                  <input type="text" value={form.numar_document}
                    onChange={(e) => setForm(f => ({...f, numar_document: e.target.value}))}
                    style={S.input} placeholder="Serie + nr." />
                </div>

                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>📅 Data emitere</label>
                  <input type="date" value={form.data_emitere}
                    onChange={(e) => setForm(f => ({...f, data_emitere: e.target.value}))}
                    style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    ⏳ Data expirare {tipSelectat?.are_expirare && !form.fara_expirare && <span style={{color:G.red}}>*</span>}
                  </label>
                  <input type="date" value={form.data_expirare} disabled={form.fara_expirare || !tipSelectat?.are_expirare}
                    onChange={(e) => setForm(f => ({...f, data_expirare: e.target.value}))}
                    style={{...S.input, opacity: (form.fara_expirare || !tipSelectat?.are_expirare) ? 0.5 : 1}} />
                </div>

                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, color:G.text, cursor:'pointer'}}>
                    <input type="checkbox" checked={form.fara_expirare}
                      onChange={(e) => setForm(f => ({...f, fara_expirare: e.target.checked, data_expirare: e.target.checked ? '' : f.data_expirare}))} />
                    Fără expirare (document permanent)
                  </label>
                </div>

                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>🏢 Emitent</label>
                  <input type="text" value={form.emitent}
                    onChange={(e) => setForm(f => ({...f, emitent: e.target.value}))}
                    style={S.input} placeholder="Poliția Ploiești, etc." />
                </div>

                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>📝 Observații</label>
                  <textarea value={form.observatii} rows={2}
                    onChange={(e) => setForm(f => ({...f, observatii: e.target.value}))}
                    style={{...S.input, resize:'vertical', fontFamily:'inherit'}} />
                </div>
              </div>

              {meta && (
                <div style={{fontSize:10, color:G.dim, textAlign:'right', marginBottom:10, fontFamily:'monospace'}}>
                  AI: {meta.duration_ms}ms · {meta.tokens_in}+{meta.tokens_out} tok · ${meta.cost_usd?.toFixed(5)} (~{costRon} RON)
                </div>
              )}
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div style={{padding:60, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:16}}>💾</div>
              <div style={{fontSize:16, color:G.text, fontWeight:600, marginBottom:8}}>Se salvează în baza de date…</div>
              <div style={{fontSize:12, color:G.muted}}>Upload bucket + INSERT</div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 3 && (
          <div style={{padding:'14px 20px', borderTop:`1px solid ${G.border}`, display:'flex', gap:10, justifyContent:'space-between'}}>
            <button onClick={() => { setStep(1); setPropunere(null); setMeta(null); setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setWarningTipNesuportat(null) }}
              style={{...S.btnS, color:G.muted}}>
              ← Înapoi (alt document)
            </button>
            <button onClick={handleSave}
              style={{...S.btnP, background:G.green, padding:'12px 24px', fontSize:14}}>
              ✓ Confirmă & Salvează
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// COMPONENTĂ PRINCIPALĂ — TAB SCANNER HR
// ============================================================================

export default function TabScannerDocumenteHR({ profile, employees, showToast }) {
  const [openModal, setOpenModal] = useState(false)
  const [logs, setLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingLogs(true)
      const { data, error } = await supabase
        .from('scanner_logs')
        .select('id, user_email, detected_tip, detected_entity, confidence_pct, cost_usd, duration_ms, saved_to_db, success, created_at, error_msg')
        .eq('module', 'hr_general')
        .order('created_at', { ascending: false })
        .limit(10)
      if (cancelled) return
      if (error) {
        showToast('Eroare istoric: ' + error.message, 'error')
      } else {
        setLogs(data || [])
      }
      setLoadingLogs(false)
    })()
    return () => { cancelled = true }
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaved = () => setRefreshKey(k => k + 1)

  // Stats
  const stats = useMemo(() => {
    const s = { total: logs.length, saved: 0, costTotal: 0, avgConfidence: 0 }
    let sumConf = 0, nConf = 0
    for (const l of logs) {
      if (l.saved_to_db) s.saved++
      if (l.cost_usd) s.costTotal += Number(l.cost_usd)
      if (l.confidence_pct != null) { sumConf += l.confidence_pct; nConf++ }
    }
    s.avgConfidence = nConf > 0 ? Math.round(sumConf / nConf) : 0
    return s
  }, [logs])

  const costRonTotal = (stats.costTotal * 5).toFixed(2)

  return (
    <div>
      {/* Header explicativ */}
      <div style={{...S.card, padding:'20px 24px', marginBottom:18, background:`linear-gradient(135deg, ${G.hr}11, ${G.purple}08)`}}>
        <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
          <div style={{fontSize:36}}>📷</div>
          <div style={{flex:1}}>
            <div style={{fontSize:17, fontWeight:700, color:G.text, marginBottom:6}}>Scanner Documente AI</div>
            <div style={{fontSize:13, color:G.muted, lineHeight:1.6}}>
              Scanează automat <b style={{color:G.text}}>Buletin, Pașaport, Permis Conducere</b> cu Claude Vision.
              AI-ul detectează tipul, numele angajatului (fuzzy match), datele de emitere/expirare și emitentul.
              Tu doar verifici și salvezi.
            </div>
            <div style={{fontSize:11, color:G.muted, marginTop:8, padding:'8px 12px', background:G.red+'11', border:`1px solid ${G.red}33`, borderRadius:6}}>
              🔒 <b>Privacy GDPR:</b> CNP-ul NU se extrage niciodată din documente (forțat server-side).
            </div>
          </div>
        </div>

        <button onClick={() => setOpenModal(true)}
          style={{
            marginTop:18, width:'100%', padding:'16px', fontSize:16, fontWeight:700,
            background:`linear-gradient(135deg, ${G.hr}, ${G.purple})`, color:'#fff',
            border:'none', borderRadius:10, cursor:'pointer',
            boxShadow:'0 4px 14px rgba(236,108,185,.3)',
            transition:'all .15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}>
          📷 Scanează document nou
        </button>
      </div>

      {/* Stats */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:18}}>
        <div style={{...S.card, padding:'14px 18px'}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:6, textTransform:'uppercase'}}>📊 Total scanări (10 ult.)</div>
          <div style={{fontSize:26, fontWeight:800, color:G.text}}>{stats.total}</div>
        </div>
        <div style={{...S.card, padding:'14px 18px', borderColor:G.green+'33'}}>
          <div style={{fontSize:11, color:G.green, fontWeight:600, marginBottom:6, textTransform:'uppercase'}}>✓ Salvate</div>
          <div style={{fontSize:26, fontWeight:800, color:G.green}}>{stats.saved}</div>
        </div>
        <div style={{...S.card, padding:'14px 18px'}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:6, textTransform:'uppercase'}}>🎯 Încredere medie</div>
          <div style={{fontSize:26, fontWeight:800, color: stats.avgConfidence >= 85 ? G.green : stats.avgConfidence >= 70 ? G.yellow : G.red}}>{stats.avgConfidence}%</div>
        </div>
        <div style={{...S.card, padding:'14px 18px'}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:6, textTransform:'uppercase'}}>💰 Cost total</div>
          <div style={{fontSize:26, fontWeight:800, color:G.text}}>{costRonTotal} <span style={{fontSize:13, color:G.muted}}>RON</span></div>
        </div>
      </div>

      {/* Istoric */}
      <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:12}}>📜 Ultimele scanări</div>

      {loadingLogs && (
        <div style={{padding:40, textAlign:'center', color:G.muted}}>⏳ Se încarcă…</div>
      )}

      {!loadingLogs && logs.length === 0 && (
        <div style={{...S.card, padding:40, textAlign:'center', color:G.muted, fontSize:13, border:`1px dashed ${G.border2}`}}>
          Nicio scanare HR până acum. Folosește butonul de sus pentru prima scanare.
        </div>
      )}

      {!loadingLogs && logs.length > 0 && (
        <div style={{...S.card, overflow:'hidden'}}>
          {logs.map((l, i) => {
            const dt = new Date(l.created_at)
            const dtStr = dt.toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            const statusColor = !l.success ? G.red : (l.saved_to_db ? G.green : G.yellow)
            const statusIcon = !l.success ? '❌' : (l.saved_to_db ? '✓' : '⏸')
            const statusLabel = !l.success ? 'Eroare' : (l.saved_to_db ? 'Salvat' : 'Doar scanat')
            return (
              <div key={l.id} style={{
                padding:'12px 16px', display:'grid',
                gridTemplateColumns:'30px minmax(0,1.4fr) minmax(0,1.4fr) 100px 80px 90px',
                gap:12, alignItems:'center', fontSize:12,
                borderBottom: i < logs.length-1 ? `1px solid ${G.border}` : 'none',
              }}>
                <div style={{fontSize:16}}>{statusIcon}</div>
                <div style={{minWidth:0}}>
                  <div style={{color:G.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                    {l.detected_tip || (l.error_msg ? `Eroare: ${l.error_msg.substring(0, 40)}` : '—')}
                  </div>
                  <div style={{fontSize:10, color:G.muted, marginTop:2}}>{l.user_email}</div>
                </div>
                <div style={{minWidth:0, color:G.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {l.detected_entity || '—'}
                </div>
                <div style={{color:G.muted, fontVariantNumeric:'tabular-nums'}}>{dtStr}</div>
                <div style={{color: l.confidence_pct >= 85 ? G.green : l.confidence_pct >= 70 ? G.yellow : G.red, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>
                  {l.confidence_pct != null ? `${l.confidence_pct}%` : '—'}
                </div>
                <div style={{
                  padding:'3px 8px', borderRadius:4,
                  background: statusColor + '22', color: statusColor, fontWeight:600,
                  fontSize:10, textAlign:'center',
                }}>{statusLabel}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {openModal && (
        <ScannerHRModal
          onClose={() => setOpenModal(false)}
          profile={profile}
          employees={employees}
          showToast={showToast}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
