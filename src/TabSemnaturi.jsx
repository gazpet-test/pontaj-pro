// ===========================================================================
// MODUL HR — TabSemnaturi (Etapa 7.5 — Faza 1)
// Upload + gestionare semnături electronice angajați (PNG/JPG/WEBP)
// Folosite în: ordin deplasare PDF, contracte HR, formulare interne
// Gating: can_access_personal_data OR is_owner (din profiles)
// One active signature per employee (UNIQUE WHERE activ=true)
// Reutilizabilă: import în HR.jsx (tab Semnături) + Admin → Setări (tab dedicat)
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

// Theme (consistent cu HR.jsx și TabDocumentePersonale.jsx)
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100', orangeDim:'#3F2618', blueDim:'#0F1F3F',
}

const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}

const thStyle = { padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5 }
const tdStyle = { padding:'10px 12px', verticalAlign:'middle' }

const BUCKET = 'hr-semnaturi'
const MAX_SIZE_BYTES = 512000  // 500 KB
const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const RECOMMENDED_WIDTH = 300
const RECOMMENDED_HEIGHT = 100

const DEPARTMENTS = [
  { id: 'all', label: '🌐 Toate', emoji: '🌐' },
  { id: 'TESA', label: '🏢 TESA', emoji: '🏢' },
  { id: 'Logistică', label: '🚛 Logistică', emoji: '🚛' },
  { id: 'Execuție', label: '🔧 Execuție', emoji: '🔧' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function Lbl({ children }) {
  return <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>{children}</div>
}

// Generează storage path: {employee_id}/{YYYY-MM-DD}_{uuid8}.{ext}
function genStoragePath(employeeId, fileName) {
  const ext = (fileName.split('.').pop() || 'png').toLowerCase()
  const today = new Date().toISOString().split('T')[0]
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${employeeId}/${today}_${uuid}.${ext}`
}

// Citește dimensiunile reale ale unei imagini (pentru BD width_px/height_px)
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: null, height: null })
    }
    img.src = url
  })
}

// ─── Thumbnail cu signed URL caching ────────────────────────────────────────

function SemnaturaThumbnail({ path, height = 50, onClick }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(false)
  
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
        if (!cancelled) {
          if (error) { setErr(true); setUrl(null) }
          else setUrl(data.signedUrl)
        }
      } catch (e) {
        if (!cancelled) { setErr(true); setUrl(null) }
      }
    })()
    return () => { cancelled = true }
  }, [path])
  
  if (err) {
    return <div style={{height, padding:'0 12px', display:'flex', alignItems:'center', color:G.red, fontSize:11, fontStyle:'italic'}}>⚠ Eroare</div>
  }
  if (!url) {
    return <div style={{height, padding:'0 12px', display:'flex', alignItems:'center', color:G.dim, fontSize:11}}>⏳</div>
  }
  return (
    <img
      src={url}
      onClick={onClick}
      alt="Semnătură"
      style={{
        height,
        maxWidth: 220,
        objectFit: 'contain',
        background: '#fff',
        borderRadius: 4,
        border: `1px solid ${G.border}`,
        padding: 3,
        cursor: onClick ? 'zoom-in' : 'default',
      }}
    />
  )
}

// ─── SIGNATURE PAD (canvas pentru desen direct pe ecran) ────────────────────

function SignaturePad({ onCapture, height = 180 }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  
  // Init canvas la mount
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    // High-DPI support pentru desen clar (Retina etc.)
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = height * dpr
    
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    
    // Fundal alb (pentru export PNG fără transparency neagră în UI dark)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.width, height)
    
    ctxRef.current = ctx
  }, [height])
  
  // Convertește coordonate pointer la coordonate canvas
  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const isTouch = e.touches && e.touches[0]
    const clientX = isTouch ? e.touches[0].clientX : e.clientX
    const clientY = isTouch ? e.touches[0].clientY : e.clientY
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }
  }
  
  const startDraw = (e) => {
    e.preventDefault()
    setIsDrawing(true)
    setHasContent(true)
    const { x, y } = getPos(e)
    ctxRef.current.beginPath()
    ctxRef.current.moveTo(x, y)
  }
  
  const draw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const { x, y } = getPos(e)
    ctxRef.current.lineTo(x, y)
    ctxRef.current.stroke()
  }
  
  const endDraw = () => setIsDrawing(false)
  
  const clearCanvas = () => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const ctx = ctxRef.current
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.width, height)
    setHasContent(false)
  }
  
  const captureAsFile = () => {
    if (!hasContent) return
    canvasRef.current.toBlob((blob) => {
      if (!blob) return
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = new File([blob], `semnatura_desenata_${ts}.png`, { type: 'image/png' })
      onCapture(file)
    }, 'image/png', 0.95)
  }
  
  return (
    <div>
      <div style={{
        position:'relative',
        background:'#fff',
        border:`2px dashed ${G.border}`,
        borderRadius:10,
        marginBottom:10,
        overflow:'hidden',
      }}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          style={{
            display:'block',
            width:'100%',
            height,
            cursor:'crosshair',
            touchAction:'none',  // previne scroll pe touch
          }}
        />
        {!hasContent && (
          <div style={{
            position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
            color:'#aaa', fontSize:13, fontStyle:'italic', pointerEvents:'none',
          }}>
            ✍️ Desenează cu mouse-ul sau cu degetul (pe touch)
          </div>
        )}
      </div>
      
      <div style={{display:'flex', gap:10, marginBottom:14}}>
        <button
          onClick={clearCanvas}
          disabled={!hasContent}
          style={{...S.btnS, flex:1, opacity:hasContent?1:.5, color:G.red, borderColor:hasContent?G.red+'55':G.border}}
        >
          🗑️ Șterge & reia
        </button>
        <button
          onClick={captureAsFile}
          disabled={!hasContent}
          style={{...S.btnP, flex:2, opacity:hasContent?1:.5, background:hasContent?G.green:G.surface, color:hasContent?'#fff':G.muted}}
        >
          ✓ Folosește această semnătură
        </button>
      </div>
    </div>
  )
}

// ─── MODAL UPLOAD SEMNĂTURĂ ─────────────────────────────────────────────────

function ModalUploadSemnatura({ employee, existing, onClose, onSaved, showToast }) {
  const [mode, setMode] = useState('upload')  // 'upload' | 'draw'
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [dimensions, setDimensions] = useState(null)
  const [observatii, setObservatii] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  
  // Cleanup preview URL la unmount sau schimbare fișier
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])
  
  const handleFile = async (f) => {
    if (!f) return
    if (!ACCEPTED_MIMES.includes(f.type)) {
      showToast('Doar PNG, JPG sau WEBP acceptate', 'error')
      return
    }
    if (f.size > MAX_SIZE_BYTES) {
      showToast(`Fișierul depășește ${(MAX_SIZE_BYTES/1024).toFixed(0)} KB`, 'error')
      return
    }
    // Preview + dimensiuni
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const newUrl = URL.createObjectURL(f)
    setPreviewUrl(newUrl)
    setFile(f)
    const dims = await getImageDimensions(f)
    setDimensions(dims)
  }
  
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
  }
  
  const save = async () => {
    if (!file) { showToast('Selectează un fișier', 'warn'); return }
    setSaving(true)
    
    try {
      // 1. Dacă există deja o semnătură activă → o marcăm activ=false (istoric)
      if (existing) {
        const { error: deactErr } = await supabase
          .from('hr_semnaturi_electronice')
          .update({ activ: false })
          .eq('id', existing.id)
        if (deactErr) throw new Error('Dezactivare veche eșuată: ' + deactErr.message)
      }
      
      // 2. Upload fișier nou în Storage
      const storagePath = genStoragePath(employee.id, file.name)
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })
      if (upErr) throw new Error('Upload eșuat: ' + upErr.message)
      
      // 3. INSERT BD cu noua semnătură activă
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        employee_id: employee.id,
        fisier_path: storagePath,
        fisier_nume: file.name,
        fisier_size_bytes: file.size,
        fisier_mime: file.type,
        width_px: dimensions?.width || null,
        height_px: dimensions?.height || null,
        activ: true,
        observatii: observatii.trim() || null,
        uploadat_de: user?.id || null,
      }
      const { error: insErr } = await supabase.from('hr_semnaturi_electronice').insert(payload)
      if (insErr) {
        // Rollback: șterg fișierul Storage (BD nu s-a salvat)
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(()=>{})
        throw new Error('INSERT BD eșuat: ' + insErr.message)
      }
      
      showToast(`✓ Semnătură salvată pentru ${employee.name}`)
      onSaved?.()
      onClose()
    } catch (e) {
      showToast(e.message || String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{...S.card, width:580, maxHeight:'90vh', overflowY:'auto', borderTop:`3px solid ${G.hr}`}}>
        <div style={{padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div>
            <div style={{fontSize:15, fontWeight:800}}>🖋️ {existing ? 'Înlocuiește' : 'Upload'} semnătură</div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>{employee.name} · <span style={{color:G.blue}}>{employee.department || '—'}</span></div>
          </div>
          <button onClick={onClose} disabled={saving} style={{background:'none', border:'none', color:G.muted, cursor:'pointer', fontSize:20}}>×</button>
        </div>
        
        <div style={{padding:20}}>
          {/* Tab switcher: Upload imagine / Desenează */}
          <div style={{display:'flex', gap:6, marginBottom:14, padding:4, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
            <button
              onClick={()=>setMode('upload')}
              disabled={saving}
              style={{
                flex:1, padding:'10px 14px', borderRadius:7, border:'none', cursor:'pointer',
                background: mode==='upload' ? G.hr+'33' : 'transparent',
                color: mode==='upload' ? G.hr : G.muted,
                fontWeight:700, fontSize:13, transition:'all .15s',
                display:'flex', alignItems:'center', justifyContent:'center', gap:7,
              }}
            >
              <span style={{fontSize:16}}>📤</span> Upload imagine
            </button>
            <button
              onClick={()=>setMode('draw')}
              disabled={saving}
              style={{
                flex:1, padding:'10px 14px', borderRadius:7, border:'none', cursor:'pointer',
                background: mode==='draw' ? G.hr+'33' : 'transparent',
                color: mode==='draw' ? G.hr : G.muted,
                fontWeight:700, fontSize:13, transition:'all .15s',
                display:'flex', alignItems:'center', justifyContent:'center', gap:7,
              }}
            >
              <span style={{fontSize:16}}>✍️</span> Desenează direct
            </button>
          </div>
          
          {/* Specs */}
          <div style={{padding:12, background:G.blueDim, borderLeft:`3px solid ${G.blue}`, borderRadius:6, marginBottom:14, fontSize:11, lineHeight:1.6, color:'#9CC9FF'}}>
            {mode === 'upload' ? (
              <>
                <div><strong>📋 Specificații recomandate:</strong></div>
                <div>• Format: PNG transparent (recomandat), JPG, WEBP</div>
                <div>• Dimensiuni: <strong style={{color:G.text}}>{RECOMMENDED_WIDTH}×{RECOMMENDED_HEIGHT}px</strong> (proporție 3:1)</div>
                <div>• Mărime max: <strong style={{color:G.text}}>{(MAX_SIZE_BYTES/1024).toFixed(0)} KB</strong></div>
                <div>• Fundal transparent sau alb (semnătura clară, negru sau albastru închis)</div>
              </>
            ) : (
              <>
                <div><strong>✍️ Sfaturi pentru semnătura desenată:</strong></div>
                <div>• Pe <strong style={{color:G.text}}>telefon/tablet</strong>: folosește degetul direct pe ecran</div>
                <div>• Pe <strong style={{color:G.text}}>laptop</strong>: ține apăsat click stâng și mișcă mouse-ul</div>
                <div>• Desenează clar, ca pe hârtie — poți reface oricând cu „🗑️ Șterge & reia"</div>
                <div>• Salvare automată ca PNG la rezoluție optimă (~580×180px)</div>
              </>
            )}
          </div>
          
          {/* Existing warning */}
          {existing && (
            <div style={{padding:10, background:G.orangeDim, borderLeft:`3px solid ${G.orange}`, borderRadius:6, marginBottom:14, fontSize:11, color:'#FFC494'}}>
              ⚠ Există deja o semnătură activă pentru acest angajat. Va fi marcată inactivă (istoric păstrat) când salvezi una nouă.
            </div>
          )}
          
          {/* MODE: UPLOAD — Drop zone / file picker */}
          {mode === 'upload' && (
            <>
              <Lbl>Fișier semnătură</Lbl>
              <label
                onDragOver={e=>{e.preventDefault(); setDragOver(true)}}
                onDragLeave={()=>setDragOver(false)}
                onDrop={onDrop}
                style={{
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  padding:'24px 16px', background:dragOver?G.blueDim:G.bg,
                  border:`2px dashed ${dragOver?G.blue:G.border}`, borderRadius:10,
                  cursor:'pointer', transition:'all .15s', marginBottom:14,
                  minHeight:140,
                }}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e=>handleFile(e.target.files?.[0])}
                  style={{display:'none'}}
                  disabled={saving}
                />
                {!file ? (
                  <>
                    <div style={{fontSize:36, marginBottom:6}}>📁</div>
                    <div style={{fontSize:13, color:G.text, fontWeight:600}}>Click sau drag & drop</div>
                    <div style={{fontSize:11, color:G.muted, marginTop:4}}>PNG / JPG / WEBP · max {(MAX_SIZE_BYTES/1024).toFixed(0)} KB</div>
                  </>
                ) : (
                  <>
                    <img src={previewUrl} alt="preview" style={{maxHeight:120, maxWidth:'100%', background:'#fff', padding:6, borderRadius:6, marginBottom:10}}/>
                    <div style={{fontSize:12, color:G.green, fontWeight:600}}>✓ {file.name}</div>
                    <div style={{fontSize:10, color:G.muted, marginTop:3, display:'flex', gap:10}}>
                      <span>{(file.size/1024).toFixed(1)} KB</span>
                      {dimensions?.width && (
                        <span>
                          {dimensions.width}×{dimensions.height}px
                          {(dimensions.width < 100 || dimensions.height < 30) && <span style={{color:G.yellow}}> ⚠ prea mică</span>}
                          {(dimensions.width > 1200 || dimensions.height > 400) && <span style={{color:G.yellow}}> ⚠ prea mare</span>}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </label>
            </>
          )}
          
          {/* MODE: DRAW — Canvas signature pad */}
          {mode === 'draw' && (
            <>
              <Lbl>{file ? '✓ Semnătură capturată — poți redesenă dacă vrei' : 'Desenează semnătura'}</Lbl>
              {file && previewUrl ? (
                <div style={{marginBottom:12, padding:10, background:'#fff', borderRadius:8, border:`2px solid ${G.green}`, display:'flex', flexDirection:'column', alignItems:'center'}}>
                  <img src={previewUrl} alt="preview" style={{maxHeight:120, maxWidth:'100%'}}/>
                  <div style={{fontSize:11, color:G.green, fontWeight:700, marginTop:8}}>
                    ✓ {file.name} · {(file.size/1024).toFixed(1)} KB
                  </div>
                  <button
                    onClick={()=>{ setFile(null); if(previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setDimensions(null) }}
                    disabled={saving}
                    style={{...S.btnS, marginTop:10, color:G.yellow, borderColor:G.yellow+'55'}}
                  >
                    ✍️ Redesenă semnătura
                  </button>
                </div>
              ) : (
                <SignaturePad onCapture={handleFile} />
              )}
            </>
          )}
          
          {/* Observații */}
          <Lbl>Observații (opțional)</Lbl>
          <input
            style={S.input}
            value={observatii}
            onChange={e=>setObservatii(e.target.value)}
            placeholder="ex: Semnătură nouă conform buletin recent"
            disabled={saving}
            maxLength={200}
          />
        </div>
        
        <div style={{padding:'12px 20px', borderTop:`1px solid ${G.border}`, display:'flex', gap:10, justifyContent:'flex-end', background:G.bg}}>
          <button onClick={onClose} disabled={saving} style={S.btnS}>Anulează</button>
          <button
            onClick={save}
            disabled={saving || !file}
            style={{...S.btnP, opacity:(saving||!file)?.5:1, display:'flex', alignItems:'center', gap:7}}
          >
            {saving ? '⏳ Se salvează...' : `💾 ${existing ? 'Înlocuiește' : 'Upload'} semnătură`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL PREVIEW (full size) ──────────────────────────────────────────────

function ModalPreviewSemnatura({ semnatura, employee, onClose }) {
  const [url, setUrl] = useState(null)
  
  useEffect(() => {
    if (!semnatura?.fisier_path) return
    ;(async () => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(semnatura.fisier_path, 300)
      setUrl(data?.signedUrl || null)
    })()
  }, [semnatura?.fisier_path])
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{...S.card, padding:24, maxWidth:'90vw', maxHeight:'90vh'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
          <div>
            <div style={{fontSize:14, fontWeight:700}}>{employee?.name}</div>
            <div style={{fontSize:11, color:G.muted}}>
              {semnatura.width_px}×{semnatura.height_px}px · {(semnatura.fisier_size_bytes/1024).toFixed(1)} KB ·
              Uploadat {new Date(semnatura.uploadat_la).toLocaleString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none', border:'none', color:G.muted, cursor:'pointer', fontSize:22}}>×</button>
        </div>
        {url ? (
          <img src={url} alt="Semnătură" style={{display:'block', maxWidth:'80vw', maxHeight:'70vh', background:'#fff', padding:16, borderRadius:8}}/>
        ) : (
          <div style={{padding:60, textAlign:'center', color:G.muted}}>⏳ Se încarcă...</div>
        )}
      </div>
    </div>
  )
}

// ─── COMPONENTA PRINCIPALĂ ──────────────────────────────────────────────────

export default function TabSemnaturi({ profile, showToast }) {
  const [employees, setEmployees] = useState([])
  const [semnaturi, setSemnaturi] = useState({})  // map by employee_id
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [showOnlyMissing, setShowOnlyMissing] = useState(false)
  
  // Modale
  const [uploadFor, setUploadFor] = useState(null)  // { employee, existing }
  const [previewFor, setPreviewFor] = useState(null)  // { semnatura, employee }
  
  const hasAccess = profile?.can_access_personal_data === true || profile?.is_owner === true
  
  // ─── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasAccess) { setLoading(false); return }
    load()
  }, [hasAccess])
  
  const load = async () => {
    setLoading(true)
    try {
      const [empsRes, semRes] = await Promise.all([
        supabase.from('employees').select('id, name, department, position, sites(name)').eq('active', true).order('name'),
        supabase.from('hr_semnaturi_electronice').select('*').eq('activ', true).is('deleted_at', null),
      ])
      setEmployees(empsRes.data || [])
      const m = {}
      ;(semRes.data || []).forEach(s => { m[s.employee_id] = s })
      setSemnaturi(m)
    } catch (e) {
      showToast?.('Eroare încărcare: ' + (e.message || e), 'error')
    } finally {
      setLoading(false)
    }
  }
  
  // ─── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = employees.length
    const cu = Object.keys(semnaturi).length
    const fara = total - cu
    const perDept = DEPARTMENTS.filter(d => d.id !== 'all').map(d => {
      const empsDept = employees.filter(e => e.department === d.id)
      const cuSem = empsDept.filter(e => semnaturi[e.id]).length
      return { ...d, total: empsDept.length, cu: cuSem, fara: empsDept.length - cuSem }
    })
    return { total, cu, fara, perDept }
  }, [employees, semnaturi])
  
  // ─── Filtre ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = employees
    if (deptFilter !== 'all') list = list.filter(e => e.department === deptFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e => (e.name || '').toLowerCase().includes(q))
    }
    if (showOnlyMissing) list = list.filter(e => !semnaturi[e.id])
    return list
  }, [employees, semnaturi, deptFilter, search, showOnlyMissing])
  
  // ─── Ștergere semnătură (SOFT DELETE → coș cu retenție configurabilă) ─────
  const deleteSemnatura = async (emp, sem) => {
    if (!window.confirm(`Ștergi semnătura pentru ${emp.name}?\n\nVa fi mutată în Coșul HR și ștearsă definitiv automat după perioada de retenție (default 30 zile). Poate fi restaurată oricând până atunci.`)) return
    try {
      const { data: u } = await supabase.auth.getUser()
      const { error } = await supabase.from('hr_semnaturi_electronice')
        .update({ deleted_at: new Date().toISOString(), deleted_by: u?.user?.id })
        .eq('id', sem.id)
      if (error) throw error
      showToast?.(`🗑 Semnătură mutată în Coș: ${emp.name}`)
      load()
    } catch (e) {
      showToast?.('Eroare ștergere: ' + (e.message || e), 'error')
    }
  }
  
  // ─── Render ───────────────────────────────────────────────────────────────
  
  if (!hasAccess) {
    return (
      <div style={{...S.card, padding:40, textAlign:'center'}}>
        <div style={{fontSize:42, marginBottom:14}}>🔒</div>
        <div style={{fontSize:16, fontWeight:700, color:G.red, marginBottom:8}}>Acces restricționat</div>
        <div style={{fontSize:12, color:G.muted, maxWidth:480, margin:'0 auto', lineHeight:1.6}}>
          Tab-ul Semnături conține date personale GDPR-sensibile. Necesită bifa <strong style={{color:G.text}}>„Acces Date Personale"</strong> pe profil, setată de OWNER din Admin → Manageri.
        </div>
      </div>
    )
  }
  
  return (
    <div>
      {/* Stats top */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:16}}>
        <div style={{...S.card, padding:'14px 16px'}}>
          <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginBottom:4}}>👥 Total angajați activi</div>
          <div style={{fontSize:24, fontWeight:800, color:G.text}}>{stats.total}</div>
        </div>
        <div style={{...S.card, padding:'14px 16px'}}>
          <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginBottom:4}}>✓ Cu semnătură</div>
          <div style={{fontSize:24, fontWeight:800, color:G.green}}>{stats.cu}</div>
        </div>
        <div style={{...S.card, padding:'14px 16px'}}>
          <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginBottom:4}}>⚠ Fără semnătură</div>
          <div style={{fontSize:24, fontWeight:800, color:stats.fara > 0 ? G.orange : G.green}}>{stats.fara}</div>
        </div>
        <div style={{...S.card, padding:'14px 16px'}}>
          <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginBottom:4}}>📊 Acoperire</div>
          <div style={{fontSize:24, fontWeight:800, color:G.blue}}>{stats.total > 0 ? Math.round((stats.cu / stats.total) * 100) : 0}%</div>
        </div>
      </div>
      
      {/* Breakdown per departament */}
      <div style={{...S.card, padding:'12px 16px', marginBottom:16, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center'}}>
        <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.5}}>📈 Per departament:</div>
        {stats.perDept.map(d => (
          <div key={d.id} style={{display:'flex', alignItems:'center', gap:6, fontSize:12}}>
            <span>{d.emoji}</span>
            <span style={{color:G.text, fontWeight:600}}>{d.id}:</span>
            <span style={{color:G.green}}>{d.cu}</span>
            <span style={{color:G.muted}}>/</span>
            <span style={{color:G.text}}>{d.total}</span>
            {d.fara > 0 && <span style={{color:G.orange, fontSize:11}}>(⚠ {d.fara})</span>}
          </div>
        ))}
      </div>
      
      {/* Filtre */}
      <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        {DEPARTMENTS.map(d => (
          <button
            key={d.id}
            onClick={()=>setDeptFilter(d.id)}
            style={{
              ...S.btnS,
              background: deptFilter === d.id ? G.hr : G.surface,
              color: deptFilter === d.id ? '#fff' : G.text,
              borderColor: deptFilter === d.id ? G.hr : G.border,
              fontSize:12, fontWeight:600,
            }}
          >
            {d.label}
          </button>
        ))}
        <div style={{flex:1, minWidth:200, maxWidth:300}}>
          <input
            style={{...S.input, fontSize:12}}
            placeholder="🔍 Caută angajat..."
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
        </div>
        <label style={{display:'flex', alignItems:'center', gap:7, fontSize:12, cursor:'pointer', color:showOnlyMissing?G.orange:G.muted, fontWeight:600}}>
          <input
            type="checkbox"
            checked={showOnlyMissing}
            onChange={e=>setShowOnlyMissing(e.target.checked)}
            style={{accentColor:G.orange, width:15, height:15}}
          />
          ⚠ Doar fără semnătură
        </label>
        <div style={{marginLeft:'auto', fontSize:11, color:G.muted}}>
          <strong style={{color:G.text}}>{filtered.length}</strong> angajați afișați
        </div>
      </div>
      
      {/* Tabel */}
      <div style={{...S.card, overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>⏳ Se încarcă...</div>
        ) : filtered.length === 0 ? (
          <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>
            {showOnlyMissing ? '🎉 Toți angajații au semnătură! Felicitări.' : 'Niciun angajat în filtrul curent.'}
          </div>
        ) : (
          <div style={{maxHeight:'60vh', overflowY:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead style={{position:'sticky', top:0, background:G.surface, zIndex:1}}>
                <tr style={{borderBottom:`1px solid ${G.border}`}}>
                  <th style={thStyle}>Angajat</th>
                  <th style={thStyle}>Departament</th>
                  <th style={thStyle}>Funcție</th>
                  <th style={{...thStyle, textAlign:'center'}}>Semnătură</th>
                  <th style={{...thStyle, textAlign:'right'}}>Uploadat</th>
                  <th style={{...thStyle, textAlign:'center', width:180}}>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp, i) => {
                  const sem = semnaturi[emp.id]
                  return (
                    <tr key={emp.id} style={{background: i%2===0 ? 'transparent' : G.bg, borderBottom:`1px solid ${G.border2}`}}>
                      <td style={tdStyle}>
                        <div style={{fontSize:13, fontWeight:600, color:G.text}}>{emp.name}</div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{fontSize:11, padding:'2px 8px', background:G.blueDim, color:'#9CC9FF', borderRadius:4, fontWeight:600}}>
                          {emp.department || '—'}
                        </span>
                      </td>
                      <td style={{...tdStyle, color:G.muted, fontSize:12}}>
                        {emp.position || <span style={{color:G.dim}}>—</span>}
                      </td>
                      <td style={{...tdStyle, textAlign:'center'}}>
                        {sem ? (
                          <SemnaturaThumbnail
                            path={sem.fisier_path}
                            height={50}
                            onClick={()=>setPreviewFor({ semnatura: sem, employee: emp })}
                          />
                        ) : (
                          <span style={{fontSize:11, color:G.orange, fontWeight:600}}>⚠ Lipsește</span>
                        )}
                      </td>
                      <td style={{...tdStyle, textAlign:'right', fontSize:11, color:G.muted}}>
                        {sem ? (
                          <>
                            <div>{new Date(sem.uploadat_la).toLocaleDateString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric'})}</div>
                            <div style={{fontSize:10, color:G.dim}}>
                              {sem.width_px}×{sem.height_px}px · {(sem.fisier_size_bytes/1024).toFixed(0)}KB
                            </div>
                          </>
                        ) : <span style={{color:G.dim}}>—</span>}
                      </td>
                      <td style={{...tdStyle, textAlign:'center'}}>
                        <div style={{display:'flex', gap:5, justifyContent:'center'}}>
                          <button
                            onClick={()=>setUploadFor({ employee: emp, existing: sem })}
                            style={{...S.btnS, padding:'4px 10px', fontSize:11, color:sem?G.yellow:G.green, borderColor:(sem?G.yellow:G.green)+'66'}}
                            title={sem ? 'Înlocuiește semnătura existentă' : 'Upload semnătură nouă'}
                          >
                            {sem ? '🔄 Înlocuiește' : '📤 Upload'}
                          </button>
                          {sem && (
                            <button
                              onClick={()=>deleteSemnatura(emp, sem)}
                              style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'66'}}
                              title="Șterge semnătura (irreversibil)"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Footer info */}
      <div style={{marginTop:14, padding:'10px 14px', background:G.bg, borderRadius:8, fontSize:11, color:G.muted, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center'}}>
        <span>💡 <strong style={{color:G.text}}>Folosire viitoare:</strong> ordin deplasare PDF (Faza 2), contracte HR, formulare interne</span>
        <span style={{marginLeft:'auto'}}>🔐 RLS strict · semnăturile vechi păstrate ca istoric inactiv</span>
      </div>
      
      {/* Modale */}
      {uploadFor && (
        <ModalUploadSemnatura
          employee={uploadFor.employee}
          existing={uploadFor.existing}
          onClose={()=>setUploadFor(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
      {previewFor && (
        <ModalPreviewSemnatura
          semnatura={previewFor.semnatura}
          employee={previewFor.employee}
          onClose={()=>setPreviewFor(null)}
        />
      )}
    </div>
  )
}
