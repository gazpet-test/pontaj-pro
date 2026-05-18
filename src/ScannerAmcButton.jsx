// ScannerAmcButton.jsx - Scanner AI buletine metrologice AMC (Gazpet ERP)
// Etapa 12 - Faza 2 (18.05.2026)
//
// Props:
//   - profile: object (din parent, contine can_use_document_scanner + is_owner)
//   - showToast: function (mesaj, tip)
//   - onSaved: function () - callback dupa save (refresh AMC list)
//   - tipuri: array logistica_amc_tipuri (incarcat in parent)
//
// Workflow:
//   1. Upload imagine/PDF buletin metrologic (drag-drop sau camera mobile)
//   2. Resize automat imagini > 2 MB la 2048px JPEG q0.85
//   3. Call scan-document Edge Function cu module='logistica_amc'
//   4. AI returneaza: tip_amc, denumire, producator, model, serie, clasa_presiune,
//      data_verificare, data_expirare, emitent, numar_buletin, cost_lei, observatii
//   5. Auto-match tip_amc -> tip_id (case+diacritic insensitive)
//   6. Review form editabil + Save in logistica_amc + Upload PDF/imagine in bucket documente-amc

import { useState, useRef, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0E0E12', card: '#16161C', border: '#26262E', text: '#E6E6E6', muted: '#9094A2',
  blue: '#3B82F6', green: '#22C55E', orange: '#F97316', red: '#EF4444', yellow: '#EAB308',
  purple: '#A855F7', logistica: '#FFCE40', pink: '#EC4899',
}

const S = {
  card: { background: G.card, borderRadius: 10, border: `1px solid ${G.border}` },
  btnP: { background: '#fff', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', transition: 'opacity .15s' },
  btnS: { background: 'transparent', color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontWeight: 600, cursor: 'pointer' },
  input: { background: '#0A0A0E', color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none' },
}

// ============================================================================
// HELPERI
// ============================================================================

function normalizeTipNume(s) {
  if (!s) return ''
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function findTipAmc(tipDetectat, tipuri) {
  if (!tipDetectat || !tipuri?.length) return null
  const norm = normalizeTipNume(tipDetectat)
  // 1. Exact match
  let m = tipuri.find(t => t.activ && normalizeTipNume(t.nume) === norm)
  if (m) return m
  // 2. Contains bidirectional
  m = tipuri.find(t => {
    if (!t.activ) return false
    const tnorm = normalizeTipNume(t.nume)
    return tnorm.includes(norm) || norm.includes(tnorm)
  })
  if (m) return m
  // 3. Token overlap (cel putin 2 tokens comune si fiecare >= 4 chars)
  const tokensAI = norm.split(' ').filter(t => t.length >= 4)
  if (tokensAI.length < 1) return null
  let bestMatch = null, bestScore = 0
  for (const t of tipuri) {
    if (!t.activ) continue
    const tokensT = normalizeTipNume(t.nume).split(' ').filter(x => x.length >= 4)
    if (!tokensT.length) continue
    const common = tokensAI.filter(x => tokensT.includes(x))
    if (common.length > bestScore) { bestScore = common.length; bestMatch = t }
  }
  return (bestScore >= 1) ? bestMatch : null
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

function sanitizeFilename(s) {
  return String(s || 'amc').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60)
}

// ============================================================================
// SUBCOMPONENTE
// ============================================================================

function ConfidenceBar({ pct }) {
  const safe = Math.max(0, Math.min(100, pct || 0))
  const color = safe >= 85 ? G.green : safe >= 70 ? G.yellow : G.red
  return (
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      <div style={{flex:1,height:6,background:'#0A0A0E',borderRadius:3,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${safe}%`,background:color,transition:'width .4s'}}/>
      </div>
      <div style={{fontSize:11,fontWeight:700,color,minWidth:48,textAlign:'right'}}>{safe}% încredere</div>
    </div>
  )
}

function DropZone({ onFile, accept, hint }) {
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef(null)
  const camInputRef = useRef(null)

  const handleFile = (f) => {
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      alert('Fișier prea mare (max 10 MB).')
      return
    }
    onFile(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false)
        const f = e.dataTransfer.files?.[0]
        handleFile(f)
      }}
      style={{
        border: `2px dashed ${drag ? G.pink : G.border}`,
        background: drag ? '#1A0F1A' : '#0A0A0E',
        borderRadius: 12, padding: '40px 20px', textAlign: 'center', cursor: 'pointer',
        transition: 'all .2s',
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <div style={{fontSize:42, marginBottom:10}}>📐</div>
      <div style={{fontSize:14, fontWeight:700, marginBottom:6}}>
        Trage buletinul metrologic aici sau click pentru a alege
      </div>
      <div style={{fontSize:11, color:G.muted, marginBottom:16}}>{hint || 'PDF/JPG/PNG (max 10 MB)'}</div>
      <div style={{display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap'}}>
        <button
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
          style={{...S.btnS, padding:'8px 14px', fontSize:12}}
        >📁 Alege fișier</button>
        <button
          onClick={(e) => { e.stopPropagation(); camInputRef.current?.click() }}
          style={{...S.btnS, padding:'8px 14px', fontSize:12}}
        >📷 Cameră</button>
      </div>
      <input ref={fileInputRef} type="file" accept={accept} style={{display:'none'}}
        onChange={(e) => handleFile(e.target.files?.[0])}/>
      <input ref={camInputRef} type="file" accept="image/*" capture="environment" style={{display:'none'}}
        onChange={(e) => handleFile(e.target.files?.[0])}/>
    </div>
  )
}

// ============================================================================
// MODAL SCANNER AMC
// ============================================================================

function ScannerAmcModal({ onClose, profile, showToast, onSaved, tipuri }) {
  const [step, setStep] = useState(1)        // 1=upload, 2=processing, 3=review, 4=saving
  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [propunere, setPropunere] = useState(null)
  const [meta, setMeta] = useState(null)
  const [form, setForm] = useState({
    tip_id: '', denumire: '', producator: '', model: '', serie: '',
    clasa_presiune: '', data_verificare: '', data_expirare: '',
    emitent: '', cost: '', observatii: '', activ: true,
  })
  const [saving, setSaving] = useState(false)

  const handleFile = useCallback((f) => {
    setFile(f)
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f)
      setFilePreview(url)
    } else {
      setFilePreview(null)
    }
  }, [])

  const sendToAI = async () => {
    if (!file) return
    setStep(2)
    try {
      // Resize automat daca-i imagine > 2 MB
      let fileToSend = file
      if (file.type.startsWith('image/') && file.size > 2 * 1024 * 1024) {
        try {
          fileToSend = await resizeImageToBlob(file, 2048, 0.85)
        } catch (resizeErr) {
          console.warn('Resize failed, trimit original:', resizeErr)
        }
      }

      const b64 = await fileToBase64(fileToSend)
      const { data, error } = await supabase.functions.invoke('scan-document', {
        body: { file_base64: b64, mime_type: fileToSend.type, module: 'logistica_amc' }
      })

      if (error) throw error
      if (data?.error) throw new Error(data.message || data.error)
      if (!data?.propunere) throw new Error('Răspuns AI invalid')

      const p = data.propunere
      setPropunere(p)
      setMeta(data.meta || null)

      // Auto-match tip
      const tip = findTipAmc(p.tip_amc, tipuri)

      setForm({
        tip_id: tip?.id || '',
        denumire: p.denumire || '',
        producator: p.producator || '',
        model: p.model || '',
        serie: p.serie || '',
        clasa_presiune: p.clasa_presiune || '',
        data_verificare: p.data_verificare || '',
        data_expirare: p.data_expirare || '',
        emitent: p.emitent || '',
        cost: p.cost_lei != null ? String(p.cost_lei) : '',
        observatii: p.observatii || '',
        activ: true,
      })

      setStep(3)
    } catch (e) {
      const msg = e?.message || 'eroare necunoscută'
      showToast('Eroare scanare: ' + msg, 'error')
      setStep(1)
    }
  }

  const save = async () => {
    if (!form.tip_id) { showToast('Selectează tipul AMC', 'error'); return }
    if (!form.denumire?.trim()) { showToast('Denumirea e obligatorie', 'error'); return }
    if (!form.data_expirare) { showToast('Data expirare e obligatorie', 'error'); return }

    setStep(4); setSaving(true)
    try {
      // 1. Upload fișier in bucket documente-amc
      let pdfUrl = null
      if (file) {
        const ext = (file.type === 'application/pdf') ? 'pdf' :
                    (file.type === 'image/png' ? 'png' :
                     file.type === 'image/webp' ? 'webp' : 'jpg')
        const safeDen = sanitizeFilename(form.denumire)
        const safeSer = form.serie ? '_' + sanitizeFilename(form.serie) : ''
        const filename = `${safeDen}${safeSer}_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('documente-amc')
          .upload(filename, file, { contentType: file.type, upsert: false })
        if (upErr) throw new Error('Upload fișier eșuat: ' + upErr.message)
        pdfUrl = filename
      }

      // 2. INSERT logistica_amc
      const payload = {
        tip_id: parseInt(form.tip_id, 10),
        denumire: form.denumire.trim(),
        producator: form.producator?.trim() || null,
        model: form.model?.trim() || null,
        serie: form.serie?.trim() || null,
        clasa_presiune: form.clasa_presiune?.trim() || null,
        data_verificare: form.data_verificare || null,
        data_expirare: form.data_expirare,
        emitent: form.emitent?.trim() || null,
        cost: form.cost ? Number(form.cost) : null,
        observatii: form.observatii?.trim() || null,
        pdf_url: pdfUrl,
        activ: true,
        created_by: profile?.id || null,
      }

      const { error: insErr } = await supabase
        .from('logistica_amc')
        .insert(payload)

      if (insErr) throw new Error('Salvare AMC eșuată: ' + insErr.message)

      // 3. Mark scanner_log saved_to_db
      try {
        await supabase.from('scanner_logs')
          .update({ saved_to_db: true })
          .eq('user_id', profile?.id)
          .eq('module', 'logistica_amc')
          .eq('success', true)
          .order('created_at', { ascending: false })
          .limit(1)
      } catch (logErr) {
        console.warn('Update scanner_logs.saved_to_db:', logErr)
      }

      showToast('✅ AMC salvat: ' + form.denumire, 'success')
      onSaved?.()
      onClose()
    } catch (e) {
      const msg = e?.message || 'eroare necunoscută'
      showToast('Eroare salvare: ' + msg, 'error')
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  const tipuriActive = (tipuri || []).filter(t => t.activ)
  const conf = propunere?.confidence_pct ?? 0
  const tipDetectatNume = tipuriActive.find(t => t.id === parseInt(form.tip_id, 10))?.nume

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,padding:16}}>
      <div style={{...S.card,maxWidth:760,width:'100%',maxHeight:'94vh',display:'flex',flexDirection:'column',background:G.card}}>
        {/* Header */}
        <div style={{padding:'18px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:24}}>📐</div>
            <div>
              <div style={{fontSize:16,fontWeight:800}}>Scanner AI — Buletin Metrologic AMC</div>
              <div style={{fontSize:11,color:G.muted,marginTop:2}}>
                {step === 1 && 'Pas 1/3 — Încarcă buletinul de verificare'}
                {step === 2 && 'Pas 2/3 — AI analizează documentul…'}
                {step === 3 && 'Pas 3/3 — Verifică datele și salvează'}
                {step === 4 && 'Se salvează în baza de date…'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS,padding:'6px 10px',fontSize:14}}>✕</button>
        </div>

        {/* Body */}
        <div style={{flex:1,overflow:'auto',padding:'18px 20px'}}>
          {step === 1 && (
            <>
              <DropZone
                onFile={handleFile}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                hint="PDF buletin metrologic sau poză clară (max 10 MB)"
              />
              {file && (
                <div style={{marginTop:16,padding:12,background:'#0A0A0E',borderRadius:8,border:`1px solid ${G.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{fontSize:24}}>{file.type === 'application/pdf' ? '📄' : '🖼'}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div>
                      <div style={{fontSize:11,color:G.muted}}>{file.type} • {fmtBytes(file.size)}</div>
                    </div>
                    <button onClick={() => { setFile(null); setFilePreview(null) }} style={{...S.btnS,padding:'5px 10px',fontSize:11,color:G.red}}>✕</button>
                  </div>
                  {filePreview && (
                    <img src={filePreview} alt="preview" style={{maxWidth:'100%',maxHeight:200,marginTop:10,borderRadius:6}}/>
                  )}
                </div>
              )}
              <div style={{marginTop:16,padding:12,background:'#1A1A1F',borderRadius:8,fontSize:11,color:G.muted,lineHeight:1.6,border:`1px solid ${G.border}`}}>
                <strong style={{color:G.text}}>💡 Cum funcționează:</strong><br/>
                AI-ul (Claude Vision) extrage automat: <strong style={{color:G.pink}}>tipul AMC</strong> (Isotest/Manometru/Detector Gaz/etc.), <strong style={{color:G.pink}}>denumire</strong>, <strong style={{color:G.pink}}>serie</strong>, <strong style={{color:G.pink}}>data verificare</strong>, <strong style={{color:G.pink}}>data expirare</strong>, <strong style={{color:G.pink}}>clasa presiune</strong>, <strong style={{color:G.pink}}>emitent</strong>.<br/>
                Vei putea verifica și corecta datele înainte de salvare. Cost estimat: <strong style={{color:G.green}}>~$0.009/scanare (~0.05 RON)</strong>.
              </div>
            </>
          )}

          {step === 2 && (
            <div style={{textAlign:'center',padding:'60px 20px'}}>
              <div style={{fontSize:48,marginBottom:20}}>🤖</div>
              <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>AI analizează buletinul...</div>
              <div style={{fontSize:12,color:G.muted,marginBottom:24}}>Claude Vision extrage datele AMC (~5–10s)</div>
              <div style={{maxWidth:300,margin:'0 auto',height:4,background:'#0A0A0E',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',background:`linear-gradient(90deg, ${G.pink}, ${G.purple})`,animation:'scanloading 1.5s ease-in-out infinite'}}/>
              </div>
              <style>{`@keyframes scanloading{0%{width:0%;margin-left:0}50%{width:80%;margin-left:10%}100%{width:0%;margin-left:100%}}`}</style>
            </div>
          )}

          {step === 3 && propunere && (
            <>
              {/* Confidence + tip detectat */}
              <div style={{marginBottom:14,padding:14,background:'#0A0A0E',borderRadius:8,border:`1px solid ${G.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:700,color:G.muted,textTransform:'uppercase',letterSpacing:.5}}>📊 Rezultat AI</div>
                  {meta && <div style={{fontSize:10,color:G.muted}}>{meta.duration_ms}ms • ${meta.cost_usd?.toFixed(5)}</div>}
                </div>
                <ConfidenceBar pct={conf}/>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:12,fontSize:12}}>
                  <div>
                    <div style={{color:G.muted,fontSize:10,marginBottom:2}}>Tip detectat de AI</div>
                    <div style={{fontWeight:700,color:G.pink}}>{propunere.tip_amc || '—'}</div>
                  </div>
                  <div>
                    <div style={{color:G.muted,fontSize:10,marginBottom:2}}>Tip mapat în BD</div>
                    <div style={{fontWeight:700,color:tipDetectatNume?G.green:G.yellow}}>
                      {tipDetectatNume || '⚠ alege manual'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Form editabil */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Tip AMC *</label>
                  <select value={form.tip_id} onChange={e=>setForm({...form,tip_id:e.target.value})} style={{...S.input,cursor:'pointer'}}>
                    <option value="">— Selectează tip —</option>
                    {tipuriActive.map(t => <option key={t.id} value={t.id}>{t.nume}</option>)}
                  </select>
                </div>
                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Denumire * (cum apare în buletinul de verificare)</label>
                  <input style={S.input} value={form.denumire} onChange={e=>setForm({...form,denumire:e.target.value})}
                    placeholder="ex: Manometru analogic 0-25 bar"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Producător</label>
                  <input style={S.input} value={form.producator} onChange={e=>setForm({...form,producator:e.target.value})} placeholder="ex: WIKA"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Model</label>
                  <input style={S.input} value={form.model} onChange={e=>setForm({...form,model:e.target.value})} placeholder="ex: 213.53"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Serie</label>
                  <input style={S.input} value={form.serie} onChange={e=>setForm({...form,serie:e.target.value})} placeholder="ex: SN-12345"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Clasă presiune</label>
                  <input style={S.input} value={form.clasa_presiune} onChange={e=>setForm({...form,clasa_presiune:e.target.value})} placeholder="ex: 0-25 bar"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Data verificare</label>
                  <input type="date" style={S.input} value={form.data_verificare} onChange={e=>setForm({...form,data_verificare:e.target.value})}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Data expirare * (următoarea verificare)</label>
                  <input type="date" style={S.input} value={form.data_expirare} onChange={e=>setForm({...form,data_expirare:e.target.value})}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Emitent (laborator metrologic)</label>
                  <input style={S.input} value={form.emitent} onChange={e=>setForm({...form,emitent:e.target.value})} placeholder="ex: BRML, INM"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Cost (RON)</label>
                  <input type="number" step="0.01" style={S.input} value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})} placeholder="ex: 150.00"/>
                </div>
                <div style={{gridColumn:'1 / -1'}}>
                  <label style={{fontSize:11,color:G.muted,marginBottom:4,display:'block'}}>Observații</label>
                  <textarea style={{...S.input,minHeight:60,fontFamily:'inherit'}} value={form.observatii} onChange={e=>setForm({...form,observatii:e.target.value})} placeholder="(opțional)"/>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <div style={{textAlign:'center',padding:'60px 20px'}}>
              <div style={{fontSize:48,marginBottom:20}}>💾</div>
              <div style={{fontSize:16,fontWeight:700}}>Se salvează AMC…</div>
              <div style={{fontSize:12,color:G.muted,marginTop:8}}>Upload fișier + INSERT bază de date</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'14px 20px',borderTop:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',gap:10}}>
          <button onClick={onClose} disabled={saving} style={{...S.btnS,padding:'9px 16px',fontSize:13,opacity:saving?.5:1}}>Anulează</button>
          <div style={{display:'flex',gap:8}}>
            {step === 1 && (
              <button onClick={sendToAI} disabled={!file}
                style={{...S.btnP,padding:'9px 18px',fontSize:13,background:`linear-gradient(135deg, ${G.pink}, ${G.purple})`,color:'#fff',opacity:file?1:.5,cursor:file?'pointer':'not-allowed'}}>
                🤖 Analizează cu AI →
              </button>
            )}
            {step === 3 && (
              <>
                <button onClick={() => { setStep(1); setPropunere(null); setMeta(null) }} style={{...S.btnS,padding:'9px 14px',fontSize:13}}>← Reîncarcă</button>
                <button onClick={save} disabled={saving}
                  style={{...S.btnP,padding:'9px 18px',fontSize:13,background:G.green,color:'#000',opacity:saving?.5:1}}>
                  ✓ Salvează AMC
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// DEFAULT EXPORT — buton scanner
// ============================================================================

export default function ScannerAmcButton({ profile, showToast, onSaved, tipuri, compact = false }) {
  const [open, setOpen] = useState(false)
  const canUse = profile?.is_owner === true || profile?.can_use_document_scanner === true
  if (!canUse) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Scanare AI buletin metrologic AMC"
        style={{
          ...{ background: `linear-gradient(135deg, ${G.pink}, ${G.purple})`, color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
              padding: compact ? '9px 12px' : '9px 14px', fontSize: 13,
              boxShadow: '0 2px 8px rgba(236, 72, 153, 0.25)',
              display: 'inline-flex', alignItems: 'center', gap: 6 }
        }}
      >
        📷 {compact ? 'AI' : 'Scaner AI'}
      </button>
      {open && (
        <ScannerAmcModal
          onClose={() => setOpen(false)}
          profile={profile}
          showToast={showToast}
          onSaved={onSaved}
          tipuri={tipuri || []}
        />
      )}
    </>
  )
}
