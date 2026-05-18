// ════════════════════════════════════════════════════════════════════════════
// DocumentScannerButton.jsx — Scanner Documente AI Vision (Etapa 12, 18.05.2026)
// ════════════════════════════════════════════════════════════════════════════
// Componentă reutilizabilă pentru scanare documente cu Claude Sonnet 4.5 Vision.
// Suport: imagini (JPG/PNG/WEBP) + PDF. Max 10MB.
//
// Props:
//   - module: 'logistica_flota' (Etapa 12 pilot)
//   - profile: { id, name, is_owner, can_use_document_scanner }
//   - showToast: function (mesaj, tip)
//   - onSaved: callback la salvare reușită → trigger refresh în părinte
//
// Workflow:
//   1. Click 📷 Scanează → modal
//   2. Upload imagine (drag&drop / select / cameră)
//   3. Trimite la Edge Function scan-document → AI returnează propunere JSON
//   4. UI afișează propunere cu dropdown-uri editabile + bar de încredere
//   5. User confirmă & salvează → upload bucket + INSERT BD + UPDATE log
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
  purple: '#BC8CFF', orange: '#F0883E', logistica: '#58A6FF',
  primary: '#1F6FEB',
}

const S = {
  input: {
    width:'100%', padding:'10px 13px', background:G.bg, color:G.text,
    border:`1px solid ${G.border2}`, borderRadius:8, fontSize:13, outline:'none',
  },
  btn: {
    padding:'10px 16px', borderRadius:8, fontSize:13, fontWeight:600,
    cursor:'pointer', border:'none', transition:'all .15s',
  },
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizePlacuta(s) {
  return (s || '').toUpperCase().replace(/\s+/g, '').trim()
}

function findUtilajByPlacuta(placuta, activeList) {
  if (!placuta || !activeList?.length) return null
  const norm = normalizePlacuta(placuta)
  if (!norm) return null
  // Match exact pe nr_inmatriculare
  let m = activeList.find(a => normalizePlacuta(a.nr_inmatriculare) === norm)
  if (m) return m
  // Match cod_intern (pentru utilaje fără plăcuță)
  m = activeList.find(a => normalizePlacuta(a.cod_intern) === norm)
  return m || null
}

function findTipByNume(tipDetectat, tipuri) {
  if (!tipDetectat || !tipuri?.length) return null
  const lower = String(tipDetectat).toLowerCase().trim()
  // Match exact
  let m = tipuri.find(t => t.nume.toLowerCase() === lower)
  if (m) return m
  // Match parțial (Vision poate returna "ITP" și BD are "ITP", sau "Inspecție tehnică" → "ITP")
  m = tipuri.find(t =>
    t.nume.toLowerCase().includes(lower) ||
    lower.includes(t.nume.toLowerCase())
  )
  return m || null
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const idx = result.indexOf(',')
        resolve(idx >= 0 ? result.substring(idx + 1) : result)
      } else {
        reject(new Error('FileReader did not return string'))
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB'
  return (n/1024/1024).toFixed(1) + ' MB'
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

function DropZone({ onFile, accept, hint }) {
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
          background: dragging ? G.primary+'20' : G.bg,
          border:`2px dashed ${dragging ? G.primary : G.border2}`,
          borderRadius:12, transition:'all .15s',
        }}>
        <div style={{fontSize:48, marginBottom:8}}>📷</div>
        <div style={{fontSize:14, color:G.text, fontWeight:600, marginBottom:6}}>
          {dragging ? 'Eliberează aici!' : 'Click sau drag&drop document'}
        </div>
        <div style={{fontSize:11, color:G.muted}}>{hint || 'Imagini (JPG/PNG/WEBP) sau PDF · max 10MB'}</div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept || 'image/jpeg,image/png,image/webp,application/pdf'}
        style={{display:'none'}}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]) }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{display:'none'}}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]) }}
      />

      <button
        onClick={() => cameraRef.current?.click()}
        style={{
          ...S.btn, width:'100%', marginTop:10, background:G.green+'22',
          color:G.green, border:`1px solid ${G.green}55`, fontSize:14, padding:'12px',
        }}>
        📸 Folosește camera (mobil)
      </button>
    </>
  )
}

// ============================================================================
// MODAL PRINCIPAL — Scanner Logistica Flotă
// ============================================================================

function ScannerModal({ onClose, profile, showToast, onSaved }) {
  const [step, setStep] = useState(1)  // 1=upload, 2=processing, 3=review, 4=saving
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [propunere, setPropunere] = useState(null)
  const [meta, setMeta] = useState(null)

  const [activeList, setActiveList] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [loadingData, setLoadingData] = useState(true)

  // Form fields editabile
  const [form, setForm] = useState({
    entitate_id: '',
    tip_id: '',
    data_emitere: '',
    data_expirare: '',
    emitent: '',
    numar_document: '',
    cost: '',
    observatii: '',
  })

  // Încarcă active + tipuri la mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [actRes, tipRes] = await Promise.all([
          supabase.from('logistica_active')
            .select('id, nr_inmatriculare, cod_intern, marca, model')
            .eq('vandut', false)
            .order('nr_inmatriculare', { ascending: true, nullsFirst: false }),
          supabase.from('logistica_tipuri_documente')
            .select('id, nume, perioada_default_zile')
            .eq('activ', true)
            .order('nume'),
        ])
        if (cancelled) return
        if (actRes.error) showToast('Eroare la încărcare utilaje: ' + actRes.error.message, 'error')
        if (tipRes.error) showToast('Eroare la încărcare tipuri: ' + tipRes.error.message, 'error')
        setActiveList(actRes.data || [])
        setTipuri(tipRes.data || [])
        setLoadingData(false)
      } catch (e) {
        if (!cancelled) {
          showToast('Eroare la încărcare: ' + (e.message || 'unknown'), 'error')
          setLoadingData(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup preview URL
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  const handleFile = (f) => {
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      showToast(`Fișier prea mare (${fmtBytes(f.size)}). Max 10 MB.`, 'error')
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

    try {
      const b64 = await fileToBase64(file)
      const { data, error } = await supabase.functions.invoke('scan-document', {
        body: {
          file_base64: b64,
          mime_type: file.type,
          module: 'logistica_flota',
        }
      })

      if (error) throw error
      if (data?.error) throw new Error(data.message || data.error)
      if (!data?.propunere) throw new Error('Răspuns AI invalid')

      setPropunere(data.propunere)
      setMeta(data.meta || null)

      // Auto-match pe utilaj + tip
      const utilaj = findUtilajByPlacuta(data.propunere.placuta_inmatriculare, activeList)
      const tip = findTipByNume(data.propunere.tip_document, tipuri)

      setForm({
        entitate_id: utilaj?.id || '',
        tip_id: tip?.id || '',
        data_emitere: data.propunere.data_emitere || '',
        data_expirare: data.propunere.data_expirare || '',
        emitent: data.propunere.emitent || '',
        numar_document: data.propunere.numar_document || '',
        cost: data.propunere.cost_lei || '',
        observatii: data.propunere.observatii || '',
      })

      setStep(3)
    } catch (e) {
      showToast('Eroare AI: ' + (e.message || 'unknown'), 'error')
      setStep(1)
    }
  }

  const handleSave = async () => {
    if (!form.entitate_id) { showToast('Selectează utilajul', 'error'); return }
    if (!form.tip_id)      { showToast('Selectează tipul documentului', 'error'); return }
    if (!form.data_expirare) { showToast('Completează data expirării', 'error'); return }

    setStep(4)

    try {
      // Upload fișier în bucket
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `${form.entitate_id}/scan_${form.tip_id}_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('documente-flota')
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        })
      if (upErr) throw new Error('Upload bucket: ' + upErr.message)

      // INSERT BD (dual write entitate_id + active_id pattern existent)
      const { error: insErr } = await supabase.from('logistica_documente').insert({
        entitate_tip: 'activ',
        entitate_id: form.entitate_id,
        active_id: form.entitate_id,
        tip_id: form.tip_id,
        data_emitere: form.data_emitere || null,
        data_expirare: form.data_expirare,
        emitent: form.emitent || null,
        numar_document: form.numar_document || null,
        cost: form.cost ? Number(form.cost) : null,
        pdf_url: path,
        pdf_locatie: 'supabase',
        observatii: form.observatii || null,
        created_by: profile?.id || null,
      })
      if (insErr) throw new Error('INSERT BD: ' + insErr.message)

      // Marchez scanner_log ca saved_to_db (cel mai recent log al userului pe acest modul)
      if (profile?.id) {
        await supabase.from('scanner_logs')
          .update({ saved_to_db: true })
          .eq('user_id', profile.id)
          .eq('module', 'logistica_flota')
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

  // Costul AI afișat user
  const costRon = useMemo(() => {
    if (!meta?.cost_usd) return null
    return (meta.cost_usd * 5).toFixed(2)  // ~5 RON/USD
  }, [meta])

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:10000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'min(640px, 100%)', maxHeight:'92vh', display:'flex', flexDirection:'column',
          overflow:'hidden', boxShadow:'0 25px 70px rgba(0,0,0,.7)',
        }}>

        {/* Header */}
        <div style={{
          padding:'16px 20px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background:`linear-gradient(135deg, ${G.primary}22, ${G.purple}15)`,
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:700, color:G.text}}>📷 Scanner Documente AI</div>
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

          {/* STEP 1 — UPLOAD */}
          {step === 1 && (
            <>
              {!file && <DropZone onFile={handleFile} />}

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
                        style={{...S.btn, marginTop:10, padding:'6px 12px', fontSize:11,
                          background:'transparent', color:G.red, border:`1px solid ${G.red}66`}}>
                        ✕ Schimbă fișierul
                      </button>
                    </div>
                  </div>

                  <div style={{padding:12, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:11, color:G.muted, marginBottom:14}}>
                    💡 AI-ul va detecta automat: tipul (ITP/RCA/CASCO/etc.), plăcuța, datele de emitere/expirare, emitentul și numărul documentului. Vei putea edita totul înainte de salvare.
                  </div>

                  <button
                    onClick={sendToAI}
                    disabled={loadingData}
                    style={{
                      ...S.btn, width:'100%', padding:'14px', fontSize:15,
                      background: G.primary, color:'#fff',
                      opacity: loadingData ? 0.6 : 1,
                      cursor: loadingData ? 'not-allowed' : 'pointer',
                    }}>
                    {loadingData ? '⏳ Se încarcă datele…' : '🪄 Trimite la AI pentru analiză'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* STEP 2 — PROCESSING */}
          {step === 2 && (
            <div style={{padding:60, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:16, animation:'spin 2s linear infinite'}}>🤖</div>
              <div style={{fontSize:16, color:G.text, fontWeight:600, marginBottom:8}}>AI analizează documentul…</div>
              <div style={{fontSize:12, color:G.muted}}>Durează de obicei 3-8 secunde</div>
              <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
            </div>
          )}

          {/* STEP 3 — REVIEW */}
          {step === 3 && propunere && (
            <div>
              <ConfidenceBar pct={propunere.confidence_pct} />

              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
                {/* Utilaj */}
                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    🚗 Utilaj {propunere.placuta_inmatriculare && <span style={{color:G.green}}>· detectat: <code>{propunere.placuta_inmatriculare}</code></span>}
                  </label>
                  <select
                    value={form.entitate_id}
                    onChange={(e) => setForm(f => ({...f, entitate_id: e.target.value}))}
                    style={{...S.input, borderColor: form.entitate_id ? G.green+'77' : G.red+'77'}}>
                    <option value="">— Selectează utilajul —</option>
                    {activeList.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.nr_inmatriculare || '(fără plăcuță)'} · {a.marca} {a.model} {a.cod_intern ? `· ${a.cod_intern}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tip + Nr document */}
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    📄 Tip {propunere.tip_document && <span style={{color:G.green}}>· detectat: <code>{propunere.tip_document}</code></span>}
                  </label>
                  <select
                    value={form.tip_id}
                    onChange={(e) => setForm(f => ({...f, tip_id: e.target.value}))}
                    style={{...S.input, borderColor: form.tip_id ? G.green+'77' : G.red+'77'}}>
                    <option value="">— Selectează —</option>
                    {tipuri.map(t => <option key={t.id} value={t.id}>{t.nume}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>🔢 Număr document</label>
                  <input type="text" value={form.numar_document}
                    onChange={(e) => setForm(f => ({...f, numar_document: e.target.value}))}
                    style={S.input} placeholder="Serie + nr." />
                </div>

                {/* Date */}
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>📅 Data emitere</label>
                  <input type="date" value={form.data_emitere}
                    onChange={(e) => setForm(f => ({...f, data_emitere: e.target.value}))}
                    style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>
                    ⏳ Data expirare <span style={{color:G.red}}>*</span>
                  </label>
                  <input type="date" value={form.data_expirare}
                    onChange={(e) => setForm(f => ({...f, data_expirare: e.target.value}))}
                    style={{...S.input, borderColor: form.data_expirare ? G.green+'77' : G.red+'77'}} />
                </div>

                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>🏢 Emitent</label>
                  <input type="text" value={form.emitent}
                    onChange={(e) => setForm(f => ({...f, emitent: e.target.value}))}
                    style={S.input} placeholder="RAR, ASIROM..." />
                </div>
                <div>
                  <label style={{fontSize:11, color:G.muted, marginBottom:5, display:'block'}}>💰 Cost (lei)</label>
                  <input type="number" step="0.01" value={form.cost}
                    onChange={(e) => setForm(f => ({...f, cost: e.target.value}))}
                    style={S.input} placeholder="0.00" />
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

          {/* STEP 4 — SAVING */}
          {step === 4 && (
            <div style={{padding:60, textAlign:'center'}}>
              <div style={{fontSize:48, marginBottom:16}}>💾</div>
              <div style={{fontSize:16, color:G.text, fontWeight:600, marginBottom:8}}>Se salvează în baza de date…</div>
              <div style={{fontSize:12, color:G.muted}}>Upload + INSERT</div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 3 && (
          <div style={{padding:'14px 20px', borderTop:`1px solid ${G.border}`, display:'flex', gap:10, justifyContent:'space-between'}}>
            <button onClick={() => { setStep(1); setPropunere(null); setMeta(null); setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
              style={{...S.btn, background:'transparent', color:G.muted, border:`1px solid ${G.border2}`}}>
              ← Înapoi (alt document)
            </button>
            <button onClick={handleSave}
              style={{...S.btn, background:G.green, color:'#fff', padding:'12px 24px', fontSize:14}}>
              ✓ Confirmă & Salvează
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// WRAPPER BUTON (exportat)
// ============================================================================

export default function DocumentScannerButton({ profile, showToast, onSaved, compact = false }) {
  const [open, setOpen] = useState(false)

  // Verificare acces — doar owner sau cu flag
  if (!profile?.is_owner && !profile?.can_use_document_scanner) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Scanează document cu AI Vision"
        style={{
          padding: compact ? '6px 12px' : '9px 14px',
          background: `linear-gradient(135deg, ${G.primary}, ${G.purple})`,
          color:'#fff', border:'none', borderRadius:8,
          fontSize: compact ? 12 : 13, fontWeight:600, cursor:'pointer',
          display:'flex', alignItems:'center', gap:6,
          boxShadow:'0 2px 8px rgba(31,111,235,.35)',
          transition:'all .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
      >
        📷 Scanează cu AI
      </button>
      {open && <ScannerModal onClose={() => setOpen(false)} profile={profile} showToast={showToast} onSaved={onSaved} />}
    </>
  )
}
